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
  var SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZqcm5hYm5hd2hlZ2pkc3ZieXJjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY0NTU1NTYsImV4cCI6MjEwMjAzMTU1Nn0.7MbTlgMz3v2GsXuhKKGxdFacKZckUbUte_TKKehCQSM';

  if (!window.supabase) {
    console.error('supabase-js not loaded — add the CDN script before supabase-client.js');
    return;
  }

  var sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  var DEFAULT_AVATAR = 'https://api.dicebear.com/7.x/thumbs/svg?seed=';

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
  function uni(arr) { return Array.from(new Set((arr || []).filter(Boolean))); }

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
        case 'add-room-admins':      api.updateRoomArray(p.room, 'admins',  'add', p.admins || []); break;
        case 'add-room-members':     api.updateRoomArray(p.room, 'members', 'add', p.members || []); break;
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
        api._heartbeatTimer = setInterval(function () { api.heartbeat(false); }, 15000);
        api._pruneTimer = setInterval(function () {
          sb.rpc('prune_stale_presence', { older_than_ms: 45000 }).catch(function () {});
        }, 30000);
        api.ready = true;
        dispatch('connect');
      }).catch(function (e) {
        console.error('ChatAPI init failed:', e);
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
      var lc = raw.toLowerCase();
      return sb.from('users').select('client_id').ilike('username', lc).limit(1)
        .then(function (res) {
          if (res.error) return { available: false, error: 'db_error' };
          var taken = !!(res.data && res.data.length && res.data[0].client_id !== api.uid);
          return { available: !taken, username: raw };
        });
    },

    upsertProfile: function (username, avatar) {
      if (!api.uid) return Promise.resolve();
      var un = String(username || '').trim().slice(0, 50) || 'Anonymous';
      var av = String(avatar || '').trim() || defaultAvatar(un);
      api._username = un;
      api._avatar = av;
      return sb.from('users').upsert({
        client_id: api.uid, username: un, avatar: av, last_seen: Date.now()
      }, { onConflict: 'client_id' }).then(function (res) {
        if (res.error) {
          // Likely a duplicate username — surface it but don't break the join.
          dispatch('system', { type: 'error', message: 'Username "' + un + '" is already taken.' });
        }
      });
    },

    updateProfile: function (room, username, avatar) {
      var un = String(username || '').trim().slice(0, 50);
      var av = String(avatar || '').trim();
      api._username = un || api._username;
      api._avatar = av || api._avatar;
      api.upsertProfile(un, av).then(function () { api.heartbeat(true); });
    },

    deleteUser: function () {
      if (!api.uid) return Promise.resolve(false);
      var jobs = [
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
          var isManager = d.owner_id === api.uid || (d.admins || []).indexOf(api.uid) !== -1;
          var ids = uni([].concat(d.owner_id || [], d.admins || [], d.members || []));
          return sb.from('users').select('client_id, username, avatar').in('client_id', ids.length ? ids : ['__none__'])
            .then(function (ures) {
              var users = ures.data || [];
              var resolve = function (id) {
                if (!id) return null;
                var u = users.filter(function (x) { return x.client_id === id; })[0];
                return u
                  ? { clientId: id, username: u.username, avatar: u.avatar || '' }
                  : { clientId: id, username: String(id).slice(0, 12) + '…', avatar: '' };
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

    createRoom: function (name, isPrivate) {
      var clean = sanitizeRoom(name);
      if (!clean) return Promise.resolve({ ok: false, error: 'Invalid room name' });
      if (clean === 'general') return Promise.resolve({ ok: false, error: 'Room already exists' });
      return sb.from('rooms').select('name').eq('name', clean).maybeSingle()
        .then(function (chk) {
          if (chk.data) return { ok: false, error: 'Room already exists' };
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
        var avatar = String(p.avatar || '').trim() || api._avatar || defaultAvatar(username);
          api.upsertProfile(username, avatar);
          api.heartbeat(true);

          api.getHistory(room, 100).then(function (messages) {
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
        var isMember = meta && (meta.ownerId === api.uid
          || meta.admins.indexOf(api.uid) !== -1
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
      sb.from('presence').delete().eq('uid', api.uid).then(function () {
        api.pushPresence();
      });
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
          if (ures.error) return;
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
      return sb.from('messages').select('*').eq('room', r)
        .order('payload->>timestamp', { ascending: false }).limit(limit || 100)
        .then(function (res) {
          var msgs = (res.data || [])
            .map(function (row) { return row.payload; })
            .filter(Boolean)
            .sort(function (a, b) { return (a.timestamp || 0) - (b.timestamp || 0); })
            .slice(-(limit || 100));
          return api.loadMetaTables(r).then(function () {
            return msgs.map(function (m) { return api.mergeMeta(r, m); });
          });
        });
    },

    loadMetaTables: function (room) {
      var jobs = [
        sb.from('reactions').select('*').eq('room', room),
        sb.from('receipts').select('*').eq('room', room)
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
      var room = api._currentRoom;
      var payload = {
        id: genId(),
        room: room,
        userId: api.uid,
        clientId: api.uid,
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
              dispatch('error', { action: 'chat-message', error: res.error.message });
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
          var merged = Object.assign({}, res.data.payload, {
            message: String(text || '').slice(0, 2000),
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
        .eq('message_id', messageId).eq('emoji', emoji).eq('uid', uid)
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
      return sb.from('messages').select('*').eq('room', r).limit(500)
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

      return fetch(dataUrl).then(function (resp) { return resp.blob(); }).then(function (blob) {
        var mime = blob.type || (kind === 'image' ? 'image/png' : 'application/octet-stream');
        var extMatch = originalName.match(/\.([0-9a-z]+)(?:[?#]|$)/i);
        var ext = extMatch ? extMatch[1].toLowerCase() : (kind === 'image' ? 'png' : 'bin');
        var safeBase = originalName.replace(/\.[^/.]+$/, '').replace(/[^a-z0-9_-]/gi, '').slice(0, 30) || 'file';
        var path = r + '/' + safeBase + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8) + '.' + ext;

        return sb.storage.from('chat-uploads').upload(path, blob, { contentType: mime, upsert: false })
          .then(function (up) {
            if (up.error) return { ok: false, error: up.error.message || 'Upload failed' };
            var payload = {
              id: genId(),
              room: r,
              userId: api.uid,
              clientId: api.uid,
              username: api._username || 'Anonymous',
              avatar: api._avatar || defaultAvatar(api._username),
              message: kind === 'file' ? originalName : '',
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
                if (res.error) return { ok: false, error: res.error.message || 'Upload failed' };
                dispatch('chat-message', api.mergeMeta(r, payload));
                return { ok: true, message: payload };
              });
          });
      }).catch(function () { return { ok: false, error: 'Upload failed' }; });
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
      return sb.from('presence').upsert({
        uid: api.uid,
        username: api._username || 'Anonymous',
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
        if (row.room === room && !seen[row.uid]) {
          seen[row.uid] = true;
          out.push({ username: row.username || 'Anonymous', avatar: row.avatar || '', clientId: row.uid });
        }
      });
      return out;
    },

    presenceAll: function () {
      var out = [];
      var seen = {};
      Object.keys(api._presence).forEach(function (k) {
        var row = api._presence[k];
        if (!seen[row.uid]) {
          seen[row.uid] = true;
          out.push({ username: row.username || 'Anonymous', avatar: row.avatar || '', clientId: row.uid, room: row.room });
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
        api._applyReaction(p.new.room, p.new.message_id, p.new.emoji, p.new.uid, p.new.username, true);
      });
      ch.on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'reactions' }, function (p) {
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
          sb.from('presence').select('*').then(function (res) {
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
