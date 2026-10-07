/*
 * © 2026 gamer-09. All rights reserved.
 * This code is proprietary. Unauthorized copying, modification,
 * distribution, or use of this software is strictly prohibited.
 */
/* ═══════════════════════════════════════════════════════════════════════════
 * ptr_29 Chat — Supabase backend adapter (GitHub Pages edition)
 *
 * Replaces the Node/Socket.IO server with Supabase:
 *   • anonymous auth  → every browser gets a stable auth uid (= clientId)
 *   • RLS            → private rooms + uploads are genuinely access-controlled
 *   • Realtime       → postgres_changes + broadcast replace socket events
 *   • Storage        → private bucket, signed URLs for images/files
 *
 * Exposes `window.ChatAPI` — a socket-compatible facade so public/client.js
 * can keep using socket.emit(...) / socket.on(...) with minimal changes.
 * ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  // ── Config (Supabase project) ──────────────────────────────────────────────
  var SUPABASE_URL = 'https://vjrnabnawhegjdsvbyrc.supabase.co';
  var SUPABASE_ANON_KEY = 'sb_publishable_4fjpMTduDSiC5JaYJfwDGg_z_Ha2k-0';

  if (!window.supabase) {
    console.error('supabase-js not loaded — add the CDN script before supabase-client.js');
    return;
  }

  var sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  var DEFAULT_AVATAR = 'https://api.dicebear.com/7.x/thumbs/svg?seed=';
  var MAX_IMAGE_BYTES = 5 * 1024 * 1024;
  var MAX_FILE_BYTES = 10 * 1024 * 1024;
  var ALLOWED_IMAGE_MIME = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
  var ALLOWED_FILE_MIME = {
    'application/pdf': ['pdf'],
    'text/plain': ['txt', 'text', 'log'],
    'text/csv': ['csv'],
    'application/json': ['json'],
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['docx'],
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['xlsx'],
    'application/vnd.openxmlformats-officedocument.presentationml.presentation': ['pptx']
  };
  var BLOCKED_UPLOAD_EXT = ['html', 'htm', 'svg', 'js', 'mjs', 'exe', 'dll', 'bat', 'cmd', 'sh', 'php', 'py', 'jar', 'apk', 'ipa', 'dmg', 'msi', 'wasm'];
  var MAX_LINKS_PER_MESSAGE = 5;
  var MAX_LINK_LENGTH = 2048;
  var BLOCKED_LINK_EXT = ['exe', 'msi', 'apk', 'ipa', 'dmg', 'pkg', 'bat', 'cmd', 'sh', 'ps1', 'vbs', 'scr', 'jar', 'js', 'mjs', 'wasm'];
  var HISTORY_LIMIT = 50;
  var SEARCH_LIMIT = 150;
  var PEOPLE_LIMIT = 120;

  // ── Event dispatch ─────────────────────────────────────────────────────────
  var handlers = {};
  function dispatch(ev, data) {
    var list = handlers[ev];
    if (!list) return;
    for (var i = 0; i < list.length; i++) {
      try { list[i](data); } catch (e) { console.error('ChatAPI handler error on', ev, e); }
    }
  }

  // ── Helpers ────────────────────────────────────────────────────────────────
  function genId() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'c_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
  }
  function sanitizeRoom(name) {
    var s = String(name || 'general').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '-').slice(0, 50);
    return s || 'general';
  }
  function defaultAvatar(name) {
    return DEFAULT_AVATAR + encodeURIComponent(String(name || 'Anonymous'));
  }
  function isReservedUsername(name) { return String(name || '').trim().toLowerCase().indexOf('anonymous') !== -1; }
  function isDisplayableUsername(name) {
    var n = String(name || '').trim();
    return !!n && !isReservedUsername(n) && n !== 'Anonymous' && n.indexOf('🎓') !== 0;
  }
  function uni(arr) { return Array.from(new Set((arr || []).filter(Boolean))); }
  function extOf(name) {
    var m = String(name || '').toLowerCase().match(/\.([a-z0-9]+)(?:[?#]|$)/);
    return m ? m[1] : '';
  }
  function safeDisplayName(name) {
    return String(name || 'file').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 80) || 'file';
  }
  function extForMime(mime, fallback) {
    if (mime === 'image/jpeg') return 'jpg';
    if (mime === 'image/png') return 'png';
    if (mime === 'image/gif') return 'gif';
    if (mime === 'image/webp') return 'webp';
    var list = ALLOWED_FILE_MIME[mime] || [];
    return list[0] || fallback || 'bin';
  }
  function mimeForExt(ext) {
    var e = String(ext || '').toLowerCase();
    if (e === 'jpg' || e === 'jpeg') return 'image/jpeg';
    if (e === 'png') return 'image/png';
    if (e === 'gif') return 'image/gif';
    if (e === 'webp') return 'image/webp';
    for (var mime in ALLOWED_FILE_MIME) if ((ALLOWED_FILE_MIME[mime] || []).indexOf(e) !== -1) return mime;
    return '';
  }
  function normalizeUploadMime(mime, ext) {
    var m = String(mime || '').toLowerCase();
    if (!m || m === 'application/octet-stream' || m === 'binary/octet-stream') return mimeForExt(ext) || m;
    return m;
  }
  function validateUpload(kind, originalName, blob) {
    var ext = extOf(originalName);
    var mime = normalizeUploadMime(blob && blob.type, ext);
    if (!blob || !blob.size) return { ok: false, error: 'empty_file' };
    if (BLOCKED_UPLOAD_EXT.indexOf(ext) !== -1) return { ok: false, error: 'blocked_file_type' };
    if (kind === 'image') {
      if (ALLOWED_IMAGE_MIME.indexOf(mime) === -1) return { ok: false, error: 'unsupported_image_type' };
      if (blob.size > MAX_IMAGE_BYTES) return { ok: false, error: 'image_too_large' };
      return { ok: true, mime: mime, ext: extForMime(mime, ext), max: MAX_IMAGE_BYTES };
    }
    if (ALLOWED_IMAGE_MIME.indexOf(mime) !== -1) {
      if (blob.size > MAX_IMAGE_BYTES) return { ok: false, error: 'image_too_large' };
      return { ok: true, mime: mime, ext: extForMime(mime, ext), max: MAX_IMAGE_BYTES, kind: 'image' };
    }
    if (blob.size > MAX_FILE_BYTES) return { ok: false, error: 'file_too_large' };
    var allowedExts = ALLOWED_FILE_MIME[mime] || [];
    if (allowedExts.indexOf(ext) === -1) return { ok: false, error: 'unsupported_file_type' };
    return { ok: true, mime: mime, ext: ext, max: MAX_FILE_BYTES };
  }
  function dataUrlToBlob(dataUrl) {
    var m = String(dataUrl || '').match(/^data:([^;,]*)(;base64)?,([\s\S]*)$/);
    if (!m) throw new Error('invalid_data_url');
    var mime = (m[1] || 'application/octet-stream').toLowerCase();
    var isB64 = !!m[2];
    var raw = m[3] || '';
    var bin;
    if (isB64) {
      bin = atob(raw.replace(/[\r\n]/g, ''));
    } else {
      bin = decodeURIComponent(raw);
    }
    var len = bin.length;
    var arr = new Uint8Array(len);
    for (var i = 0; i < len; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: mime });
  }

  function trimLinkToken(raw) {
    var s = String(raw || '').trim();
    while (/[),.!?;:'"\]]$/.test(s)) s = s.slice(0, -1);
    return s;
  }
  function extractLinks(text) {
    var out = [];
    String(text || '').replace(/\b((?:https?:\/\/|www\.)[^\s<>"'()\[\]]+)/gi, function (m) { var u = trimLinkToken(m); if (u) out.push(u); return m; });
    return out;
  }
  function isPrivateIpv4Host(host) {
    var parts = String(host || '').split('.');
    if (parts.length !== 4 || !parts.every(function (p) { return /^\d+$/.test(p); })) return false;
    var n = parts.map(function (p) { return Number(p); });
    if (n.some(function (x) { return x < 0 || x > 255; })) return true;
    var a = n[0], b = n[1];
    return a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168);
  }
  function validateLink(raw) {
    var original = trimLinkToken(raw);
    if (!original) return { ok: false, reason: 'empty link' };
    if (original.length > MAX_LINK_LENGTH) return { ok: false, reason: 'link is too long' };
    var url;
    try { url = new URL(/^www\./i.test(original) ? 'https://' + original : original); }
    catch (e) { return { ok: false, reason: 'invalid link format' }; }
    if (['http:', 'https:'].indexOf(url.protocol) === -1) return { ok: false, reason: 'only http/https links are allowed' };
    if (url.username || url.password) return { ok: false, reason: 'links with hidden usernames/passwords are blocked' };
    var host = url.hostname.toLowerCase().replace(/\.$/, '');
    if (!host || host === 'localhost' || host.endsWith('.localhost')) return { ok: false, reason: 'local links are blocked' };
    if (host.indexOf(':') !== -1 || host[0] === '[' || host[host.length - 1] === ']') return { ok: false, reason: 'IPv6/local-style links are blocked' };
    if (host === '0.0.0.0' || isPrivateIpv4Host(host)) return { ok: false, reason: 'private network links are blocked' };
    if (host.indexOf('xn--') === 0 || host.indexOf('.xn--') !== -1) return { ok: false, reason: 'look-alike internationalized domains are blocked' };
    var m = url.pathname.match(/\.([a-z0-9]{1,8})$/i);
    var ext = m && m[1] ? m[1].toLowerCase() : '';
    if (ext && BLOCKED_LINK_EXT.indexOf(ext) !== -1) return { ok: false, reason: 'links to .' + ext + ' files are blocked' };
    return { ok: true, url: url.href };
  }
  function validateMessageLinks(text) {
    if (/\b(?:javascript|data|file|vbscript)\s*:/i.test(String(text || ''))) return { ok: false, error: 'unsafe_link', reason: 'unsafe link protocol' };
    var links = extractLinks(text);
    if (links.length > MAX_LINKS_PER_MESSAGE) return { ok: false, error: 'too_many_links' };
    for (var i = 0; i < links.length; i++) {
      var check = validateLink(links[i]);
      if (!check.ok) return { ok: false, error: 'unsafe_link', reason: check.reason };
    }
    return { ok: true };
  }

  function sanitizeAvatarUrl(avatar) {
    var v = String(avatar || '').trim();
    if (!v) return '';
    if (/^data:image\/(png|jpeg|jpg|gif|webp);base64,[a-z0-9+/=\r\n]+$/i.test(v)) return v.length <= 1500000 ? v : '';
    try {
      var url = new URL(v);
      if (url.protocol !== 'https:') return '';
      return validateLink(url.href).ok ? url.href : '';
    } catch (e) { return ''; }
  }

  function friendlyUploadError(message, where) {
    var msg = String(message || 'Upload failed');
    if (/row-level security|violates.*policy|not authorized|permission/i.test(msg)) {
      return where === 'message'
        ? 'Upload saved, but posting it was blocked by the database message policy. Run Supabase migration 029_upload_policy_and_message_fix.sql.'
        : 'Upload blocked by Supabase Storage policy. Run Supabase migration 029_upload_policy_and_message_fix.sql.';
    }
    return msg;
  }

  // ── API object ─────────────────────────────────────────────────────────────
  var api = {
    sb: sb,
    uid: null,
    ready: false,
    _username: '',
    _avatar: '',
    _currentRoom: null,
    _joined: false,
    _heartbeatTimer: null,
    _pruneTimer: null,
    _typingChannel: null,
    _reactions: {},   // room -> messageId -> { emoji: [{userId, username}] }
    _receipts: {},    // room -> messageId -> [{userId, username, at}]
    _presence: {},    // uid -> row
    _urlCache: {},
    _urlPromises: {},

    on: function (ev, fn) {
      (handlers[ev] = handlers[ev] || []).push(fn);
      return api;
    },

    emit: function (ev, payload, ack) {
      var p = payload || {};
      var respond = function (resp) { if (typeof ack === 'function') { try { ack(resp); } catch (e) {} } };
      switch (ev) {
        case 'check-username':       api.checkUsername(p.username).then(respond); break;
        case 'list-rooms':           api.refreshRooms(); break;
        case 'join':                 api.doJoin(p); break;
        case 'leave':                api.doLeave(p && p.room); break;
        case 'get-room-meta':        api.getRoomMeta(p.room || api._currentRoom).then(respond); break;
        case 'remove-room-admin':    api.updateRoomArray(p.room, 'admins',  'remove', p.adminId); break;
        case 'remove-room-member':   api.updateRoomArray(p.room, 'members', 'remove', p.memberId); break;
        case 'add-room-admins':      api.roomAddAdmin(p.room, p.identifier || (p.admins || [])[0]).then(respond); break;
        case 'add-room-members':     api.roomAddMember(p.room, p.identifier || (p.members || [])[0]).then(respond); break;
        case 'kick-room-user':       api.roomKick(p.room, p.identifier || p.userId).then(respond); break;
        case 'rename-room':          api.renameRoom(p.room, p.newName).then(respond); break;
        case 'set-room-privacy':     api.setRoomPrivacy(p.room, !!p.isPrivate).then(respond); break;
        case 'set-room-passkey':     api.setRoomPasskey(p.room, p.passkey).then(respond); break;
        case 'find-room-by-passkey': api.findRoomByPasskey(p.passkey).then(respond); break;
        case 'enter-passkey':        api.enterPasskey(p.room, p.passkey).then(respond); break;
        case 'chat-message':         api.sendMessage(p); break;
        case 'typing':               api.sendTyping(!!p.isTyping); break;
        case 'edit-message':         api.editMessage(p.messageId, p.text); break;
        case 'delete-message':       api.deleteMessage(p.messageId); break;
        case 'react-message':        api.toggleReaction(p.messageId, p.emoji); break;
        case 'mark-read':            api.markRead(p.room || api._currentRoom, p.messageId); break;
        case 'update-profile':       api.updateProfile(p.room, p.username, p.avatar); break;
        case 'delete-user':          api.deleteUser().then(respond); break;
        case 'rename-identity':      if (typeof cb === 'function') cb({ ok: true }); break;
        default: console.warn('ChatAPI: unhandled emit', ev);
      }
      return api;
    },

    // ── Identity ─────────────────────────────────────────────────────────────
    init: function () {
      return sb.auth.getSession().then(function (s0) {
        var session = s0.data && s0.data.session ? s0.data.session : null;
        if (!session) {
          return sb.auth.signInAnonymously().then(function (r) {
            if (r.error) throw r.error;
            return r.data.session;
          });
        }
        return session;
      }).then(function (session) {
        api.uid = session.user.id;
        api._username = session.user.user_metadata && session.user.user_metadata.username || '';
        api._avatar = session.user.user_metadata && session.user.user_metadata.avatar || '';
        return sb.rpc('seed_general');
      }).then(function () {
        api.subscribeRealtime();
        api._typingChannel = sb.channel('typing-broadcast');
        api._typingChannel
          .on('broadcast', { event: 'typing' }, function (msg) {
            var pl = msg.payload || {};
            if (pl.room === api._currentRoom) dispatch('typing', pl);
          })
          .subscribe();
        api._heartbeatTimer = setInterval(function () { api.heartbeat(false); }, 45000);
        api._pruneTimer = setInterval(function () {
          sb.rpc('prune_stale_presence', { older_than_ms: 120000 }).then(function () {}, function () {});
          api.heartbeat(true);
        }, 90000);
        api.ready = true;
        api._connected = true;
        dispatch('connect');
      }).catch(function (e) {
        console.error('ChatAPI init failed:', e);
        api._connected = true;
        dispatch('system', { type: 'error', message: 'Sign-in failed. Make sure "Anonymous sign-ins" are enabled in Supabase (Authentication → Sign In / Providers → Anonymous).' });
        dispatch('connect');
      });
    },

    // ── Users ────────────────────────────────────────────────────────────────
    checkUsername: function (username) {
      var raw = String(username || '').trim();
      if (!raw) return Promise.resolve({ available: false, error: 'empty' });
      if (raw.length < 2) return Promise.resolve({ available: false, error: 'too_short' });
      if (raw.length > 50) return Promise.resolve({ available: false, error: 'too_long' });
      if (isReservedUsername(raw)) return Promise.resolve({ available: false, error: 'reserved' });
      var cid = api._clientId || api.uid || '';
      return sb.rpc('username_available', { un: raw, cid: cid }).then(function (res) {
        if (res.error) {
          return sb.from('users').select('client_id').ilike('username', raw.toLowerCase()).limit(1)
            .then(function (r2) {
              if (r2.error) return { available: false, error: 'db_error' };
              var row = r2.data && r2.data[0];
              var mine = row && (row.client_id === cid || row.client_id === api.uid);
              return { available: !row || mine, username: raw };
            });
        }
        var v = res.data;
        return { available: v === 'available' || v === 'mine', username: raw };
      });
    },

    upsertProfile: function (username, avatar) {
      if (!api.uid) return Promise.resolve();
      var un = String(username || '').trim().slice(0, 50) || 'Anonymous';
      if (isReservedUsername(un) && un !== 'Anonymous') return Promise.resolve({ error: 'reserved_username' });
      var av = sanitizeAvatarUrl(avatar) || defaultAvatar(un);
      api._username = un;
      api._avatar = av;
      // users rows are RLS-keyed to the auth uid (users_insert/users_update only
      // permit client_id = auth.uid()), so always upsert with the uid. Trying
      // the browser clientId first was rejected every time (409) and the
      // fallback merely repeated the same write.
      return sb.from('users').upsert({
        client_id: api.uid, username: un, avatar: av, last_seen: Date.now()
      }, { onConflict: 'client_id' }).then(function () {
        // the room owner is stored as this browser's uid, so that row must carry
        // the CURRENT account's name or rooms show the previous account's name
        return api.syncIdentityRow();
      }).then(function () {
        var acct = api._clientId || api.uid;
        if (acct && api.accountUpdateProfile) return api.accountUpdateProfile(acct, av, false).then(function () {}, function () {});
      });
    },

    updateProfile: function (room, username, avatar) {
      var un = String(username || '').trim().slice(0, 50);
      if (isReservedUsername(un)) { dispatch('system', { type: 'error', message: 'Usernames containing "anonymous" are reserved.' }); return; }
      var av = sanitizeAvatarUrl(avatar);
      api._username = un || api._username;
      api._avatar = av || api._avatar;
      api.upsertProfile(un, av).then(function () { api.heartbeat(true); });
    },

    deleteUser: function () {
      if (!api.uid) return Promise.resolve(false);
      var jobs = [
        sb.from('users').delete().eq('client_id', (api._clientId || api.uid)),
        sb.from('users').delete().eq('client_id', api.uid),
        sb.from('presence').delete().eq('uid', api.uid)
      ];
      return Promise.all(jobs).then(function () { return true; }).catch(function () { return false; });
    },

    // ── Rooms ────────────────────────────────────────────────────────────────
    _lastRooms: [],

    refreshRooms: function () {
      if (!api.uid) return Promise.resolve();
      return sb.from('rooms')
        .select('name, is_private, created_at')
        .order('created_at', { ascending: true })
        .then(function (res) {
          if (res.error) return;
          var rooms = (res.data || []).map(function (r) {
            return { name: r.name, isPrivate: r.is_private, created_at: r.created_at };
          });
          rooms.sort(function (a, b) {
            if (a.name === 'general') return -1;
            if (b.name === 'general') return 1;
            return (a.created_at || 0) - (b.created_at || 0);
          });
          if (!rooms.some(function (r) { return r.name === 'general'; })) {
            // fresh world: seed the default room once
            sb.from('rooms').insert({
              name: 'general', is_private: false,
              owner_id: api._clientId || api.uid,
              admins: [api._clientId || api.uid],
              members: [], passkey: '', created_at: Date.now()
            }).then(function () { setTimeout(function () { api.refreshRooms(); }, 400); });
            return;
          }
          api._lastRooms = rooms;
          dispatch('rooms', rooms);
        });
    },

    getRoomMeta: function (room) {
      if (!api.uid) return Promise.resolve(null);
      var r = sanitizeRoom(room);
      return sb.from('rooms').select('*').eq('name', r).maybeSingle()
        .then(function (res) {
          if (res.error || !res.data) return null;
          var d = res.data;
          var isManager = api.isMine(d.owner_id)
            || (d.admins || []).some(function (x) { return api.isMine(x); });
          var ids = uni([].concat(d.owner_id || [], d.admins || [], d.members || []));
          return sb.from('users').select('client_id, username, avatar').in('client_id', ids.length ? ids : ['__none__'])
            .then(function (ures) {
              var users = ures.data || [];
              var resolve = function (id) {
                if (!id) return null;
                var u = users.filter(function (x) { return x.client_id === id; })[0];
                return u
                  ? { clientId: id, username: u.username, avatar: u.avatar || '' }
                  : null;
              };
              return {
                name: d.name,
                isPrivate: d.is_private,
                ownerId: d.owner_id,
                admins: d.admins || [],
                members: d.members || [],
                passkey: isManager ? d.passkey : '',
                ownerInfo: resolve(d.owner_id),
                adminsInfo: (d.admins || []).map(resolve).filter(Boolean),
                membersInfo: (d.members || []).map(resolve).filter(Boolean)
              };
            });
        });
    },

    // Every id that legitimately means "me" on this device: the signed-in
    // account id, this browser's auth uid, and the current client id. Rooms and
    // rows created before or after the account model must both read as mine.
    identityAliases: function () {
      var out = [];
      var push = function (v) { v = String(v || '').trim(); if (v && out.indexOf(v) === -1) out.push(v); };
      push(api._clientId);
      push(api.uid);
      if (api._accountId) push(api._accountId);
      return out;
    },

    isMine: function (id) {
      var v = String(id || '').trim();
      if (!v) return false;
      return api.identityAliases().indexOf(v) !== -1;
    },

    isMineAny: function (ids) {
      if (!Array.isArray(ids)) return false;
      return ids.some(function (x) { return api.isMine(x); });
    },

    // Keep the users row for THIS browser's uid showing the signed-in account's
    // name/avatar, so a room created now is displayed under the right account
    // even though ownership is stored as the auth uid.
    syncIdentityRow: function () {
      if (!api.uid) return Promise.resolve();
      if (!api._accountId) return Promise.resolve();
      if (!isDisplayableUsername(api._username)) return Promise.resolve();
      return sb.from('users').upsert({
        client_id: api.uid,
        username: api._username,
        avatar: api._avatar || '',
        last_seen: Date.now()
      }, { onConflict: 'client_id' }).then(function () {}, function () {});
    },

    // Re-point any room this browser owns so the owner shows the signed-in
    // account, and refresh this browser's users row. Never moves ownership to a
    // different identity (server RPCs must keep accepting it).
    claimRooms: function (acct) {
      if (!acct) return Promise.resolve({ ok: false, error: 'no_account' });
      return sb.rpc('claim_browser_rooms', { p_acct: String(acct) })
        .then(function (r) {
          if (r.error) return { ok: false, error: r.error.message || 'claim_failed' };
          return r.data || { ok: false, error: 'claim_failed' };
        })
        .catch(function (e) { return { ok: false, error: String(e && e.message || e) }; });
    },

    createRoom: function (name, isPrivate) {
      var clean = sanitizeRoom(name);
      if (!clean) return Promise.resolve({ ok: false, error: 'Invalid room name' });
      if (clean === 'general') return Promise.resolve({ ok: false, error: 'Room already exists' });
      return api.syncIdentityRow().then(function () {
      return sb.from('rooms').select('name').eq('name', clean).maybeSingle()
        .then(function (chk) {
          if (chk.data) return { ok: false, error: 'Room already exists' };
          // owner_id must stay the browser's auth uid: RLS and the room RPCs
          // (delete_room, rename_room, …) compare against auth.uid(). The owner
          // NAME is resolved from the users row, which we keep in sync with the
          // signed-in account (see syncIdentityRow).
          return sb.from('rooms').insert({
            name: clean,
            is_private: !!isPrivate,
            owner_id: api.uid,
            admins: [api.uid],
            members: [],
            passkey: '',
            created_at: Date.now()
          }).then(function (res) {
            if (res.error) return { ok: false, error: res.error.message || 'Failed to create room' };
            api.refreshRooms();
            return { ok: true, name: clean, created: true };
          });
        });
      });
    },

    doJoin: function (p) {
      if (!api.uid) return;
      var room = sanitizeRoom(p.room);
      // Owners / admins / existing members never need the passkey: check
      // membership first so re-joining your own private room just works.
      var proceed = function (res) {
        if (!res || !res.ok) {
          var err = (res && res.error) || 'forbidden';
          var msg = err === 'invalid_passkey'
            ? '#' + room + ' is private. Enter its passkey to join.'
            : (err === 'not_authenticated' ? 'Not signed in yet.' : 'Access denied to #' + room);
          dispatch('system', { type: 'error', message: msg });
          api.refreshRooms();
          return;
        }
        api._currentRoom = room;
        api._joined = true;
        var username = String(p.username || '').trim() || api._username || 'Anonymous';
        var avatar = sanitizeAvatarUrl(p.avatar) || api._avatar || defaultAvatar(username);
          api.upsertProfile(username, avatar);
          api.heartbeat(true);

          api.getHistory(room, HISTORY_LIMIT).then(function (messages) {
            dispatch('history', { room: room, messages: messages });
          });
          api.getRoomMeta(room).then(function (meta) {
            if (meta) dispatch('room-meta', { room: room, meta: meta });
          });
        api.refreshRooms();
        api.pushPresence();
        dispatch('system', { type: 'welcome', message: 'Joined #' + room });
      };
      var viaRpc = function () {
        sb.rpc('join_room', { room_name: room, passkey: String(p.passkey || '') })
          .then(function (res) { proceed(res.data || { ok: false, error: 'rpc_error' }); })
          .catch(function () { proceed({ ok: false, error: 'rpc_error' }); });
      };
      api.getRoomMeta(room).then(function (meta) {
        var isMember = meta && (api.isMine(meta.ownerId)
          || (meta.admins || []).some(function (x) { return api.isMine(x); })
          || meta.members.indexOf(api.uid) !== -1);
        if (isMember) {
          proceed({ ok: true });
        } else {
          viaRpc();
        }
      }).catch(viaRpc);
    },

    doLeave: function (room) {
      if (!api.uid) return;
      api._joined = false;
      api._currentRoom = null;
      // tab is still open -> stay online, just no room
      api.heartbeat(true);
      api.pushPresence();
    },

    goOffline: function () {
      if (!api.uid) return;
      sb.from('presence').delete().eq('uid', api.uid)
        .then(function () {}).catch(function () {});
    },

    offlineUsers: function () {
      return Promise.all([
        sb.from('users').select('username,avatar,last_seen').limit(PEOPLE_LIMIT),
        sb.from('presence').select('username').limit(PEOPLE_LIMIT)
      ]).then(function (rs) {
        var on = {};
        (rs[1].data || []).forEach(function (x) { on[String(x.username || '').toLowerCase()] = true; });
        return (rs[0].data || []).filter(function (u) {
          return !on[String(u.username || '').toLowerCase()];
        });
      }).catch(function () { return []; });
    },

    renameRoom: function (from, to) {
      return sb.rpc('rename_room', { from_name: sanitizeRoom(from), to_name: String(to || '') })
        .then(function (res) { return res.data || { ok: false, error: 'rename failed' }; });
    },

    setRoomPrivacy: function (room, isPrivate) {
      var r = sanitizeRoom(room);
      return sb.from('rooms').update({ is_private: !!isPrivate }).eq('name', r)
        .then(function (res) {
          if (res.error) return { ok: false, error: res.error.message };
          api.getRoomMeta(r).then(function (meta) {
            if (meta) dispatch('room-meta', { room: r, meta: meta });
          });
          api.refreshRooms();
          return { ok: true, room: r, isPrivate: !!isPrivate };
        });
    },

    setRoomPasskey: function (room, passkey) {
      var r = sanitizeRoom(room);
      return sb.from('rooms').update({ passkey: String(passkey || '') }).eq('name', r)
        .then(function (res) {
          if (res.error) return { ok: false, error: res.error.message };
          api.getRoomMeta(r).then(function (meta) {
            if (meta) dispatch('room-meta', { room: r, meta: meta });
          });
          return { ok: true, room: r, passkey: String(passkey || '') };
        });
    },

    // ── Room roles: resolved + manager-checked server-side ───────────────────
    // The UI may hand us a Client ID, an auth uid or a username; the server
    // resolves every identity that person owns, so membership actually works.
    roomAddMember: function (room, identifier) {
      return sb.rpc('room_add_member', { room_name: sanitizeRoom(room), identifier: String(identifier || '') })
        .then(function (r) {
          if (r.error) return { ok: false, error: r.error.message || 'failed' };
          var out = r.data || { ok: false, error: 'failed' };
          if (out.ok) { api.getRoomMeta(room).then(function (m) { if (m) dispatch('room-meta', { room: room, meta: m }); }); api.refreshRooms(); }
          return out;
        });
    },
    roomAddAdmin: function (room, identifier) {
      return sb.rpc('room_add_admin', { room_name: sanitizeRoom(room), identifier: String(identifier || '') })
        .then(function (r) {
          if (r.error) return { ok: false, error: r.error.message || 'failed' };
          var out = r.data || { ok: false, error: 'failed' };
          if (out.ok) { api.getRoomMeta(room).then(function (m) { if (m) dispatch('room-meta', { room: room, meta: m }); }); api.refreshRooms(); }
          return out;
        });
    },
    roomKick: function (room, identifier) {
      return sb.rpc('room_kick', { room_name: sanitizeRoom(room), identifier: String(identifier || '') })
        .then(function (r) {
          if (r.error) return { ok: false, error: r.error.message || 'failed' };
          var out = r.data || { ok: false, error: 'failed' };
          if (out.ok) { api.getRoomMeta(room).then(function (m) { if (m) dispatch('room-meta', { room: room, meta: m }); }); api.refreshRooms(); }
          return out;
        });
    },
    roomIsManager: function (room) {
      return sb.rpc('room_is_manager', { room_name: sanitizeRoom(room) })
        .then(function (r) { return r.error ? null : !!r.data; })
        .catch(function () { return null; });
    },
    roomUnban: function (room, identifier) {
      return sb.rpc('room_unban', { room_name: sanitizeRoom(room), identifier: String(identifier || '') })
        .then(function (r) {
          if (r.error) return { ok: false, error: r.error.message || 'failed' };
          return r.data || { ok: false, error: 'failed' };
        });
    },
    roomListBans: function (room) {
      return sb.rpc('room_list_bans', { room_name: sanitizeRoom(room) })
        .then(function (r) {
          if (r.error) return { ok: false, error: r.error.message || 'failed' };
          return r.data || { ok: false, error: 'failed' };
        })
        .catch(function (e) { return { ok: false, error: String(e && e.message || e) }; });
    },
    roomClaimOwnership: function (room) {
      return sb.rpc('room_claim_ownership', { room_name: sanitizeRoom(room) })
        .then(function (r) {
          if (r.error) return { ok: false, error: r.error.message || 'failed' };
          var out = r.data || { ok: false, error: 'failed' };
          if (out.ok) { api.getRoomMeta(room).then(function (m) { if (m) dispatch('room-meta', { room: room, meta: m }); }); api.refreshRooms(); }
          return out;
        });
    },

    updateRoomArray: function (room, col, op, value) {
      if (!api.uid) return;
      var r = sanitizeRoom(room);
      var vals = Array.isArray(value) ? value : [value];
      sb.from('rooms').select('*').eq('name', r).maybeSingle().then(function (res) {
        if (res.error || !res.data) return;
        var cur = res.data[col] || [];
        var next = op === 'remove'
          ? cur.filter(function (x) { return vals.indexOf(x) === -1; })
          : uni(cur.concat(vals));
        return sb.from('rooms').update({ [col]: next }).eq('name', r).then(function (ures) {
          if (ures.error) {
            dispatch('system', { type: 'error', message: 'Could not update this room: ' + (ures.error.message || 'permission denied') });
            return;
          }
          api.getRoomMeta(r).then(function (meta) {
            if (meta) dispatch('room-meta', { room: r, meta: meta });
          });
          api.refreshRooms();
        });
      });
    },

    findRoomByPasskey: function (passkey) {
      var key = String(passkey || '').trim();
      if (!key) return Promise.resolve({ ok: false, error: 'not_found' });
      return sb.rpc('find_room_by_passkey', { passkey: key })
        .then(function (res) {
          var room = res.data;
          return room ? { ok: true, room: room } : { ok: false, error: 'not_found' };
        });
    },

    enterPasskey: function (room, passkey) {
      var r = sanitizeRoom(room);
      return sb.rpc('join_room', { room_name: r, passkey: String(passkey || '') })
        .then(function (res) {
          if (res.data && res.data.ok) return { ok: true, room: r };
          return { ok: false, message: res.data && res.data.error === 'invalid_passkey' ? 'Invalid passkey' : 'Access denied' };
        });
    },

    deleteRoom: function (room) {
      var r = sanitizeRoom(room);
      return sb.rpc('delete_room', { room_name: r })
        .then(function (res) {
          if (res.data && res.data.ok) { api.refreshRooms(); return { ok: true, room: r }; }
          return { ok: false, error: (res.data && res.data.error) || 'Failed to delete room' };
        });
    },

    clearRoom: function (room) {
      var r = sanitizeRoom(room);
      return sb.rpc('clear_room', { room_name: r })
        .then(function (res) {
          if (res.data && res.data.ok) return { ok: true, room: r };
          return { ok: false, error: (res.data && res.data.error) || 'Failed to clear room' };
        });
    },

    // ── Messages ─────────────────────────────────────────────────────────────
    getHistory: function (room, limit) {
      var r = sanitizeRoom(room);
      var lim = Math.max(1, Math.min(Number(limit || HISTORY_LIMIT) || HISTORY_LIMIT, 100));
      return sb.from('messages').select('id, room, payload').eq('room', r)
        .order('payload->>timestamp', { ascending: false }).limit(lim)
        .then(function (res) {
          var msgs = (res.data || [])
            .map(function (row) { return row.payload; })
            .filter(Boolean)
            .sort(function (a, b) { return (a.timestamp || 0) - (b.timestamp || 0); })
            .slice(-lim);
          var ids = msgs.map(function (m) { return m && m.id; }).filter(Boolean);
          return api.loadMetaTables(r, ids).then(function () {
            return msgs.map(function (m) { return api.mergeMeta(r, m); });
          });
        });
    },

    loadMetaTables: function (room, messageIds) {
      var ids = (messageIds || []).filter(Boolean);
      if (!ids.length) { api._reactions[room] = {}; api._receipts[room] = {}; return Promise.resolve(); }
      var jobs = [
        sb.from('reactions').select('*').eq('room', room).in('message_id', ids).limit(ids.length * 20),
        sb.from('receipts').select('*').eq('room', room).in('message_id', ids).limit(ids.length * 20)
      ];
      return Promise.all(jobs).then(function (results) {
        var reac = {};
        (results[0].data || []).forEach(function (x) {
          (reac[x.message_id] = reac[x.message_id] || {});
          (reac[x.message_id][x.emoji] = reac[x.message_id][x.emoji] || []);
          reac[x.message_id][x.emoji].push({ userId: x.uid, username: x.username });
        });
        api._reactions[room] = reac;
        var rec = {};
        (results[1].data || []).forEach(function (x) {
          (rec[x.message_id] = rec[x.message_id] || []);
          rec[x.message_id].push({ userId: x.uid, username: x.username, at: x.at });
        });
        api._receipts[room] = rec;
      }).catch(function () {});
    },

    mergeMeta: function (room, msg) {
      var copy = Object.assign({}, msg);
      copy.reactions = (api._reactions[room] && api._reactions[room][msg.id]) || {};
      copy.readBy = (api._receipts[room] && api._receipts[room][msg.id]) || [];
      return copy;
    },

    sendMessage: function (p) {
      if (!api.uid || !api._joined || !api._currentRoom) return;
      var text = String((typeof p.text === 'string') ? p.text : (p.text || '')).trim();
      if (!text) return;
      var linkCheck = validateMessageLinks(text);
      if (!linkCheck.ok) {
        dispatch('system', { type: 'error', message: 'Blocked unsafe link' + (linkCheck.reason ? ': ' + linkCheck.reason : '.') });
        return;
      }
      var room = api._currentRoom;
      var payload = {
        id: genId(),
        room: room,
        userId: api.uid,
        clientId: api._clientId || api.uid,
        username: api._username || 'Anonymous',
        avatar: api._avatar || defaultAvatar(api._username),
        message: text.slice(0, 2000),
        timestamp: Date.now(),
        reactions: {},
        readBy: [{ userId: api.uid, username: api._username, at: Date.now() }]
      };
      var replyToId = String(p.replyTo || '');
      if (replyToId) {
        sb.from('messages').select('payload').eq('id', replyToId).maybeSingle()
          .then(function (res) {
            if (!res.error && res.data && res.data.payload) {
              var o = res.data.payload;
              payload.replyTo = {
                id: o.id,
                username: o.username || 'Anonymous',
                message: o.type === 'image' ? '' : (o.message || ''),
                type: o.type || 'text',
                imageUrl: o.imageUrl || ''
              };
            }
            return insertMessage();
          })
          .catch(insertMessage);
        return;
      }
      insertMessage();

      function insertMessage() {
        sb.from('messages').insert({ id: payload.id, room: room, payload: payload })
          .then(function (res) {
            if (res.error) {
              var errMsg = res.error.message || '';
              if (/row-level security/i.test(errMsg) && extractLinks(text).length) errMsg = 'safe_link_policy_rejected';
              dispatch('error', { action: 'chat-message', error: errMsg });
              return;
            }
            dispatch('chat-message', api.mergeMeta(room, payload));
          });
      }
    },

    editMessage: function (id, text) {
      if (!api.uid || !api._currentRoom) return;
      var room = api._currentRoom;
      sb.from('messages').select('payload').eq('id', id).maybeSingle()
        .then(function (res) {
          if (res.error || !res.data) {
            dispatch('error', { action: 'edit-message', error: 'not_found' });
            return;
          }
          var newText = String(text || '').slice(0, 2000);
          var linkCheck = validateMessageLinks(newText);
          if (!linkCheck.ok) {
            dispatch('system', { type: 'error', message: 'Blocked unsafe link' + (linkCheck.reason ? ': ' + linkCheck.reason : '.') });
            return;
          }
          var merged = Object.assign({}, res.data.payload, {
            message: newText,
            edited: true,
            editedAt: Date.now()
          });
          return sb.from('messages').update({ payload: merged }).eq('id', id).then(function (ures) {
            if (ures.error) {
              dispatch('error', { action: 'edit-message', error: ures.error.code === '42501' ? 'forbidden' : 'Action failed' });
              return;
            }
            dispatch('message-updated', Object.assign({ id: id }, merged));
          });
        });
    },

    deleteMessage: function (id) {
      if (!api.uid || !api._currentRoom) return;
      var room = api._currentRoom;
      sb.from('messages').delete().eq('id', id).then(function (res) {
        if (res.error) {
          dispatch('error', { action: 'delete-message', error: res.error.code === '42501' ? 'forbidden' : 'Action failed' });
          return;
        }
        dispatch('message-deleted', { messageId: id, room: room });
      });
    },

    toggleReaction: function (messageId, emoji) {
      if (!api.uid || !api._currentRoom) return;
      var room = api._currentRoom;
      var uid = api.uid;
      var username = api._username || 'Anonymous';
      sb.from('reactions').delete()
        .eq('message_id', messageId).eq('emoji', emoji)
        .or('uid.eq.' + uid + ',username.eq.' + encodeURIComponent(username))
        .select()
        .then(function (res) {
          var removed = !res.error && res.data && res.data.length > 0;
          if (removed) {
            api._applyReaction(room, messageId, emoji, uid, username, false);
            return;
          }
          return sb.from('reactions').insert({
            message_id: messageId, room: room, emoji: emoji, uid: uid,
            username: username, created_at: Date.now()
          }).then(function (ires) {
            if (!ires.error) api._applyReaction(room, messageId, emoji, uid, username, true);
          });
        });
    },

    _applyReaction: function (room, messageId, emoji, uid, username, adding) {
      var bucket = api._reactions[room] = api._reactions[room] || {};
      var list = bucket[messageId] = bucket[messageId] || {};
      var arr = list[emoji] = list[emoji] || [];
      if (adding) {
        if (!arr.some(function (r) { return r.userId === uid; })) arr.push({ userId: uid, username: username });
      } else {
        list[emoji] = arr.filter(function (r) { return r.userId !== uid; });
        if (!list[emoji].length) delete list[emoji];
      }
      dispatch('message-reaction', { room: room, messageId: messageId, reactions: bucket[messageId] || {} });
    },

    markRead: function (room, messageId) {
      if (!api.uid || !room || !messageId) return;
      sb.from('receipts').upsert({
        message_id: messageId, room: room, uid: api.uid,
        username: api._username || 'Anonymous', at: Date.now()
      }, { onConflict: 'message_id,uid' }).then(function () {});
    },

    searchMessages: function (room, q) {
      var r = sanitizeRoom(room);
      var query = String(q || '').trim().toLowerCase();
      if (!query) return Promise.resolve({ results: [] });
      return sb.from('messages').select('id, room, payload').eq('room', r).limit(SEARCH_LIMIT)
        .then(function (res) {
          var out = (res.data || [])
            .map(function (row) { return row.payload; })
            .filter(Boolean)
            .filter(function (m) {
              return (m.message || '').toLowerCase().indexOf(query) !== -1 ||
                     (m.username || '').toLowerCase().indexOf(query) !== -1;
            });
          return { results: out };
        });
    },

    // ── Uploads ──────────────────────────────────────────────────────────────
    upload: function (room, opts) {
      var self = this;
      var kind = opts.kind || 'file';
      var dataUrl = String(opts.dataUrl || '');
      var originalName = String(opts.filename || 'file').trim();
      var r = sanitizeRoom(room);
      if (!api.uid || !api._joined) return Promise.resolve({ ok: false, error: 'Join a room first' });

      return Promise.resolve().then(function () { return dataUrlToBlob(dataUrl); }).then(function (blob) {
        var check = validateUpload(kind, originalName, blob);
        if (!check.ok) return { ok: false, error: check.error };
        if (check.kind === 'image') kind = 'image';
        var mime = check.mime;
        var ext = check.ext;
        var displayName = safeDisplayName(originalName);
        var safeBase = displayName.replace(/\.[^/.]+$/, '').replace(/[^a-z0-9_-]/gi, '').slice(0, 30) || 'file';
        var path = r + '/' + safeBase + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8) + '.' + ext;

        return sb.storage.from('chat-uploads').upload(path, blob, { contentType: mime, upsert: false })
          .then(function (up) {
            if (up.error) return { ok: false, error: friendlyUploadError(up.error.message, 'storage') };
            var payload = {
              id: genId(),
              room: r,
              userId: api.uid,
              clientId: api._clientId || api.uid,
              username: api._username || 'Anonymous',
              avatar: api._avatar || defaultAvatar(api._username),
              message: kind === 'file' ? displayName : '',
              type: kind,
              storagePath: path,
              fileSize: blob.size,
              mimeType: mime,
              timestamp: Date.now(),
              reactions: {},
              readBy: []
            };
            return sb.from('messages').insert({ id: payload.id, room: r, payload: payload })
              .then(function (res) {
                if (res.error) return { ok: false, error: friendlyUploadError(res.error.message, 'message') };
                dispatch('chat-message', api.mergeMeta(r, payload));
                return { ok: true, message: payload };
              });
          });
      }).catch(function () { return { ok: false, error: 'Upload failed' }; });
    },

    // ── Client-ID requests (consent-based disclosure) ────────────────────────
    sendIdRequest: function (targetUsername, reason) {
      var me = String(api._username || '');
      var tgt = String(targetUsername || '').trim();
      var why = String(reason || '').trim().slice(0, 500);
      if (!me || !tgt || !why) return Promise.resolve({ ok: false, error: 'missing' });
      if (me.toLowerCase() === tgt.toLowerCase()) return Promise.resolve({ ok: false, error: 'self' });
      return sb.from('id_requests').select('id').ilike('target_username', tgt).ilike('requester_username', me).eq('status', 'pending').limit(1)
        .then(function (res) {
          if (res.data && res.data.length) return { ok: false, error: 'already_pending' };
          return sb.from('id_requests').insert({
            requester_username: me,
            requester_client_id: api._clientId || api.uid,
            requester_uid: api.uid,
            target_username: tgt,
            reason: why,
            status: 'pending'
          }).then(function (r2) {
            if (r2.error) return { ok: false, error: r2.error.message };
            dispatch('inbox-changed', { action: 'sent' });
            return { ok: true };
          });
        });
    },

    inbox: function () {
      var me = String(api._username || '');
      if (!me) return Promise.resolve([]);
      return Promise.all([
        sb.from('id_requests').select('*').ilike('requester_username', me).limit(200),
        sb.from('id_requests').select('*').ilike('target_username', me).limit(200)
      ]).then(function (rs) {
        var map = {};
        (rs[0].data || []).concat(rs[1].data || []).forEach(function (r) { map[r.id] = r; });
        return Object.values(map).sort(function (x, y) { return String(y.created_at).localeCompare(String(x.created_at)); });
      });
    },

    resolveRequest: function (id, approve) {
      return sb.from('id_requests').update({
        status: approve ? 'approved' : 'denied',
        resolved_at: new Date().toISOString(),
        disclosed_client_id: approve ? (api._clientId || api.uid) : null
      }).eq('id', id).ilike('target_username', String(api._username || ''))
        .then(function (res) {
          if (res.error) return { ok: false, error: res.error.message };
          dispatch('inbox-changed', { action: approve ? 'approved' : 'denied' });
          return { ok: true };
        });
    },

    stopSharingClientId: function (requesterUsername) {
      var me = String(api._username || '').trim();
      var requester = String(requesterUsername || '').trim();
      if (!me || !requester) return Promise.resolve({ ok: false, error: 'missing' });
      return sb.from('id_requests').update({
        status: 'revoked',
        resolved_at: new Date().toISOString(),
        disclosed_client_id: null
      }).ilike('target_username', me).ilike('requester_username', requester).eq('status', 'approved')
        .then(function (res) {
          if (res.error) return { ok: false, error: res.error.message };
          dispatch('inbox-changed', { action: 'revoked', requester: requester });
          return { ok: true };
        });
    },

    accountUpdateProfile: function (id, avatar, termsAccepted) {
      var acct = String(id || '').trim();
      if (!acct) return Promise.resolve({ ok: false, error: 'missing' });
      return sb.rpc('update_account_profile', {
        acct: acct,
        avatar_in: String(avatar || ''),
        terms_accepted_in: !!termsAccepted
      }).then(function (r) { return r.data || { ok: false, error: (r.error && r.error.message) || 'failed' }; });
    },

    accountProfile: function (id, username) {
      var acct = String(id || '').trim();
      var un = String(username || '').trim();
      var byId = acct
        ? sb.from('users').select('username,avatar,last_seen').eq('client_id', acct).limit(1)
        : Promise.resolve({ data: [] });
      return byId.then(function (r1) {
        var row = r1.data && r1.data[0];
        if (row && row.avatar) return { ok: true, username: row.username || un, avatar: row.avatar || '' };
        if (!un) return { ok: true, username: un, avatar: '' };
        return sb.from('users').select('username,avatar,last_seen').ilike('username', un).order('last_seen', { ascending: false }).limit(1)
          .then(function (r2) {
            var row2 = r2.data && r2.data[0];
            return { ok: true, username: (row2 && row2.username) || un, avatar: (row2 && row2.avatar) || '' };
          });
      }).catch(function () { return { ok: false, avatar: '' }; });
    },

    accountLogin: function (un, hash) {
      if (isReservedUsername(un)) return Promise.resolve({ ok: false, error: 'invalid_username' });
      return sb.rpc('login_account', { un: un, pass: hash }).then(function (r) {
        var out = r.data || { ok: false, error: (r.error && r.error.message) || 'failed' };
        if (!out || !out.ok || out.avatar) return out;
        // Older accounts often stored avatars in public.users, not accounts.avatar.
        // Hydrate from the Supabase profile row so switching/login restores the image.
        return sb.from('users').select('avatar').eq('client_id', String(out.id || '')).limit(1)
          .then(function (u1) {
            var row = u1.data && u1.data[0];
            if (row && row.avatar) { out.avatar = row.avatar; return out; }
            return sb.from('users').select('avatar').ilike('username', String(out.username || '')).limit(1)
              .then(function (u2) {
                var row2 = u2.data && u2.data[0];
                if (row2 && row2.avatar) out.avatar = row2.avatar;
                return out;
              });
          }).catch(function () { return out; });
      });
    },
    accountRegister: function (un, hash, ageConfirmed, termsAccepted) {
      return sb.rpc('register_account', { un: un, pass: hash, age_confirmed: !!ageConfirmed, terms_accepted: !!termsAccepted }).then(function (r) { return r.data || { ok: false, error: (r.error && r.error.message) || 'failed' }; });
    },
    accountAgeStatus: function (id) {
      return sb.rpc('account_age_status', { acct: id }).then(function (r) { return r.data || { ok: false, error: (r.error && r.error.message) || 'failed' }; });
    },
    accountConfirmAge: function (id) {
      return sb.rpc('confirm_account_age', { acct: id }).then(function (r) { return r.data || { ok: false, error: (r.error && r.error.message) || 'failed' }; });
    },
    accountTermsStatus: function (id) {
      return sb.rpc('account_terms_status', { acct: id }).then(function (r) { return r.data || { ok: false, error: (r.error && r.error.message) || 'failed' }; });
    },
    accountConfirmTerms: function (id) {
      return sb.rpc('confirm_account_terms', { acct: id }).then(function (r) { return r.data || { ok: false, error: (r.error && r.error.message) || 'failed' }; });
    },
    accountDelete: function (id, hash) {
      return sb.rpc('delete_account', { acct: id, pass: hash }).then(function (r) { return r.data || { ok: false, error: (r.error && r.error.message) || 'failed' }; });
    },
    accountLogout: function (id) {
      return sb.rpc('logout_account', { acct: id || null }).then(function (r) { return r.data || { ok: !r.error }; }).catch(function () { return { ok: true }; });
    },

    tourRooms: function () {
      var cid = api._clientId || api.uid;
      return sb.from('rooms').select('name,owner_id').like('name', 'tour-%')
        .then(function (r) {
          return (r.data || []).filter(function (x) { return x.owner_id === cid; })
            .map(function (x) { return x.name; });
        }).catch(function () { return []; });
    },

    purgeMessagesFor: function (username) {
      var un = String(username || '').trim();
      if (!un || !api.uid) return Promise.resolve({ ok: false });
      return sb.from('messages').delete().eq('payload->>username', un)
        .then(function (res) {
          return res.error ? { ok: false, error: res.error.message } : { ok: true };
        });
    },

    resolveName: function (cid) {
      if (!cid) return Promise.resolve(null);
      return sb.from('messages').select('payload->>username,payload->>clientId')
        .eq('payload->>clientId', cid).limit(1)
        .then(function (r) { return (r.data && r.data[0] && r.data[0].username) || null; })
        .catch(function () { return null; });
    },

    // Public profile data for any username — NEVER includes client IDs
    publicProfile: function (username) {
      var un = String(username || '').trim();
      if (!un) return Promise.resolve(null);
      var lc = un.toLowerCase();
      var pres = null;
      var all = api.presenceAll ? api.presenceAll() : [];
      for (var i = 0; i < all.length; i++) {
        if (String(all[i].username || '').toLowerCase() === lc) { pres = all[i]; break; }
      }
      // every query is independently caught — one failure never kills the card
      var userQ = sb.from('users').select('username,avatar,last_seen').ilike('username', un).limit(1)
        .then(function (r) { return (r.data && r.data[0]) || null; }).catch(function () { return null; });
      var statsQ = sb.from('messages')
        .select('payload->>room,payload->>timestamp,payload->>type,payload->>reactions')
        .eq('payload->>username', un).limit(120)
        .then(function (r) { return r.data || []; }).catch(function () { return []; });
      return Promise.all([userQ, statsQ]).then(function (rs) {
        var urow = rs[0], rows = rs[1];
        var rooms = {}, images = 0, react = 0, first = null, last = null;
        rows.forEach(function (r) {
          rooms[r.room] = (rooms[r.room] || 0) + 1;
          if (r.type === 'image') images++;
          if (r.reactions) {
            var rx = r.reactions;
            if (typeof rx === 'string') { try { rx = JSON.parse(rx); } catch (e2) { rx = null; } }
            if (rx && typeof rx === 'object') Object.keys(rx).forEach(function (k) {
              var arr = rx[k];
              if (arr && arr.forEach) arr.forEach(function (u2) {
                if (String(u2.username || '').toLowerCase() === lc) react++;
              });
            });
          }
          var t = Number(r.timestamp) || 0;
          if (t && (!first || t < first)) first = t;
          if (t && (!last || t > last)) last = t;
        });
        return {
          username: un,
          avatar: (pres && pres.avatar) || (urow && urow.avatar) || ('https://api.dicebear.com/7.x/thumbs/svg?seed=' + encodeURIComponent(un)),
          online: !!pres,
          room: pres ? pres.room : null,
          lastSeen: (pres && pres.updated_at) || (urow && urow.last_seen) || last,
          messages: rows.length,
          roomsCount: Object.keys(rooms).length,
          images: images,
          reactionsReceived: react,
          firstSeen: first
        };
      });
    },

    storageUrl: function (path) {
      if (!path) return Promise.resolve('');
      if (api._urlCache[path]) return Promise.resolve(api._urlCache[path]);
      if (!api._urlPromises[path]) {
        api._urlPromises[path] = sb.storage.from('chat-uploads').createSignedUrl(path, 60 * 60 * 24 * 7)
          .then(function (res) {
            var url = (res.data && res.data.signedUrl) ? res.data.signedUrl : '';
            api._urlCache[path] = url;
            return url;
          }).catch(function () { api._urlCache[path] = ''; return ''; });
      }
      return api._urlPromises[path];
    },

    // ── Presence ─────────────────────────────────────────────────────────────
    heartbeat: function (force) {
      if (!api.uid) return Promise.resolve();
      if (!force && !api._joined) return Promise.resolve();
      if (!isDisplayableUsername(api._username)) {
        return sb.from('presence').delete().eq('uid', api.uid).then(function () {}).catch(function () {});
      }
      return sb.from('presence').upsert({
        uid: api.uid,
        username: api._username,
        avatar: api._avatar || '',
        room: api._currentRoom || '',
        updated_at: Date.now()
      }, { onConflict: 'uid' }).then(function () {}).catch(function () {});
    },

    presenceInRoom: function (room) {
      var out = [];
      var seen = {};
      Object.keys(api._presence).forEach(function (k) {
        var row = api._presence[k];
        if (row.room === room && !seen[row.uid] && isDisplayableUsername(row.username)) {
          seen[row.uid] = true;
          out.push({ username: row.username, avatar: row.avatar || '', clientId: row.uid });
        }
      });
      return out;
    },

    presenceAll: function () {
      var out = [];
      var seen = {};
      Object.keys(api._presence).forEach(function (k) {
        var row = api._presence[k];
        if (!seen[row.uid] && isDisplayableUsername(row.username)) {
          seen[row.uid] = true;
          out.push({ username: row.username, avatar: row.avatar || '', clientId: row.uid, room: row.room });
        }
      });
      return out;
    },

    pushPresence: function () {
      dispatch('presence', { room: api._currentRoom, users: api.presenceInRoom(api._currentRoom) });
      dispatch('presence-all', { users: api.presenceAll() });
    },

    // ── Typing (broadcast) ───────────────────────────────────────────────────
    sendTyping: function (isTyping) {
      if (!api._typingChannel || !api._currentRoom) return;
      api._typingChannel.send({
        type: 'broadcast',
        event: 'typing',
        payload: {
          room: api._currentRoom,
          userId: api.uid,
          username: api._username || 'Anonymous',
          isTyping: !!isTyping
        }
      });
    },

    // ── Realtime ─────────────────────────────────────────────────────────────
    subscribeRealtime: function () {
      var ch = sb.channel('chat-sync');

      ch.on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, function (p) {
        var row = p.new;
        var msg = api.mergeMeta(row.room, row.payload);
        dispatch('chat-message', msg);
        if (row.room !== api._currentRoom && msg.clientId !== api.uid) {
          var snippet = msg.type === 'image' ? '[image]' : (msg.type === 'file' ? '[file]' : String(msg.message || '').slice(0, 60));
          dispatch('system', {
            type: 'notify',
            message: '🔔 New in #' + row.room + ' from ' + (msg.username || 'Someone') + (snippet ? ': ' + snippet : '')
          });
        }
      });

      ch.on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages' }, function (p) {
        var row = p.new;
        var payload = row.payload || {};
        var oldPayload = (p.old && p.old.payload) || {};
        if (payload.edited || (payload.message && payload.message !== oldPayload.message)) {
          dispatch('message-updated', Object.assign({ id: row.id }, payload));
        }
      });

      ch.on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'messages' }, function (p) {
        dispatch('message-deleted', { messageId: p.old.id, room: p.old.room });
      });

      ch.on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'reactions' }, function (p) {
        if (p.new.uid === api.uid) return; // already applied locally — no flicker
        api._applyReaction(p.new.room, p.new.message_id, p.new.emoji, p.new.uid, p.new.username, true);
      });
      ch.on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'reactions' }, function (p) {
        if (p.old.uid === api.uid) return;
        api._applyReaction(p.old.room, p.old.message_id, p.old.emoji, p.old.uid, p.old.username, false);
      });

      ch.on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'receipts' }, function (p) {
        var rec = api._receipts[p.new.room] = api._receipts[p.new.room] || {};
        var list = rec[p.new.message_id] = rec[p.new.message_id] || [];
        if (!list.some(function (r) { return r.userId === p.new.uid; })) {
          list.push({ userId: p.new.uid, username: p.new.username, at: p.new.at });
        }
        dispatch('read-receipt', { messageId: p.new.message_id, room: p.new.room, username: p.new.username, userId: p.new.uid });
      });

      ch.on('postgres_changes', { event: '*', schema: 'public', table: 'rooms' }, function (p) {
        if (p.eventType === 'DELETE') {
          dispatch('room-deleted', { room: p.old.name });
          api.refreshRooms();
          return;
        }
        if (p.eventType === 'UPDATE' && p.old && p.new && p.old.name !== p.new.name) {
          dispatch('room-renamed', { from: p.old.name, to: p.new.name });
        }
        api.refreshRooms();
        var touched = false;
        if (p.new && p.new.name === api._currentRoom) touched = true;
        if (p.old && p.old.name === api._currentRoom) touched = true;
        if (touched && api._currentRoom) {
          api.getRoomMeta(api._currentRoom).then(function (meta) {
            if (meta) dispatch('room-meta', { room: api._currentRoom, meta: meta });
          });
        }
      });

      ch.on('postgres_changes', { event: '*', schema: 'public', table: 'id_requests' }, function (p) {
        dispatch('inbox-changed', { action: 'realtime', eventType: p.eventType, row: p.new || p.old || null });
      });

      ch.on('postgres_changes', { event: '*', schema: 'public', table: 'presence' }, function (p) {
        if (p.eventType === 'DELETE') {
          delete api._presence[p.old.uid];
        } else {
          var row = p.new || p.old;
          if (row) api._presence[row.uid] = row;
        }
        api.pushPresence();
      });

      ch.subscribe(function (status) {
        if (status === 'SUBSCRIBED' && api.uid) {
          // Load initial presence snapshot
          sb.from('presence').select('*').limit(PEOPLE_LIMIT).then(function (res) {
            if (!res.error) {
              api._presence = {};
              (res.data || []).forEach(function (row) { api._presence[row.uid] = row; });
              api.pushPresence();
            }
          });
          api.refreshRooms();
        }
      });
    }
  };

  // Client-issued identity override (set after a rename)
  api.setClientId = function (id) { api._clientId = id || null; };
  api.setAccountId = function (id) { api._accountId = id || null; };

  // ── Public helpers for rendering media (signed URLs) ───────────────────────
  window.PtrMedia = {
    resolveStorageUrl: function (path, cb) {
      api.storageUrl(path).then(function (url) { if (typeof cb === 'function') cb(url); });
    }
  };

  window.ChatAPI = api;

  // Kick off auth + sync immediately.
  api.init();
})();
