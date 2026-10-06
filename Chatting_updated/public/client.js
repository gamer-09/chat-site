/*
 * © 2026 gamer-09. All rights reserved.
 * This code is proprietary. Unauthorized copying, modification,
 * distribution, or use of this software is strictly prohibited.
 */
(() => {
  // Socket.IO is replaced by the Supabase adapter (window.ChatAPI) for the
  // GitHub Pages edition — same event/emit interface, backend lives in the cloud.
  // Crash-proof fallback: if supabase-js or the facade failed to load
  // (blocked CDN, dead network), boot anyway in offline mode instead of
  // white-screening.
  if (!window.ChatAPI) {
    window.ChatAPI = {
      uid: null, _joined: false, _offline: true,
      on: function () { return this; },
      emit: function (ev, p, cb) { if (typeof cb === 'function') cb({ error: 'offline' }); return this; },
      presenceAll: function () { return []; },
      heartbeat: function () { return Promise.resolve(); },
      inbox: function () { return Promise.resolve([]); },
      publicProfile: function () { return Promise.resolve(null); },
      sendIdRequest: function () { return Promise.resolve({ ok: false, error: 'offline' }); },
      resolveRequest: function () { return Promise.resolve({ ok: false, error: 'offline' }); },
      stopSharingClientId: function () { return Promise.resolve({ ok: false, error: 'offline' }); },
      upload: function () { return Promise.resolve({ ok: false, error: 'offline' }); },
      checkUsername: function () { return Promise.resolve({ available: false, error: 'offline' }); },
      searchMessages: function () { return Promise.resolve({ results: [] }); },
      createRoom: function () { return Promise.resolve({ ok: false, error: 'offline' }); },
      deleteRoom: function () { return Promise.resolve({ ok: false, error: 'offline' }); },
      clearRoom: function () { return Promise.resolve({ ok: false, error: 'offline' }); },
      deleteUser: function () { return Promise.resolve(false); },
      purgeMessagesFor: function () { return Promise.resolve({ ok: false }); },
      updateProfile: function () { return Promise.resolve(); },
      setClientId: function () {},
    };
  }
  const socket = window.ChatAPI;

  // ── DOM Elements ───────────────────────────────────────────────────────────
  const elements = {
    messages:         document.getElementById('messages'),
    typing:           document.getElementById('typing'),
    form:             document.getElementById('chat-form'),
    username:         document.getElementById('username'),
    mobileUsername:   document.getElementById('mobile-username'),
    avatar:           document.getElementById('avatar'),
    text:             document.getElementById('text'),
    roomList:         document.getElementById('room-list'),
    roomName:         document.getElementById('room-name-display'),
    roomTypeTag:      document.getElementById('room-type-tag'),
    roomRoleTag:      document.getElementById('room-role-tag'),
    onlineList:       document.getElementById('online-list'),
    lightbox:         document.getElementById('lightbox'),
    lightboxImg:      document.getElementById('lightbox-img'),
    contextMenu:      document.getElementById('context-menu'),
    replyPreviewBar:  document.getElementById('reply-preview-bar'),
    userAvatarPreview:document.getElementById('user-avatar-preview'),
    userUsername:     document.querySelector('#user-info .username'),
    userClientId:     document.querySelector('#user-info .client-id'),
    // Room management
    createRoomBtn:    document.getElementById('open-create-room'),
    refreshRoomsBtn:  document.getElementById('refresh-rooms'),
    leaveBtn:         document.getElementById('leave-btn'),
    clearBtn:         document.getElementById('clear-room-btn'),
    roomSettingsBtn:  document.getElementById('room-settings-btn'),
    roomSettingsPanel:document.getElementById('room-settings-panel'),
    closeSettingsBtn: document.getElementById('close-settings-btn'),
    roomOwner:        document.getElementById('room-owner'),
    roomAdminsList:   document.getElementById('room-admins-list'),
    roomMembersList:  document.getElementById('room-members-list'),
    renameInput:      document.getElementById('rename-input'),
    renameBtn:        document.getElementById('rename-btn'),
    privacyCheckbox:  document.getElementById('privacy-checkbox'),
    savePrivacyBtn:   document.getElementById('save-privacy-btn'),
    passkeyInput:     document.getElementById('passkey-input'),
    generatePasskeyBtn:document.getElementById('generate-passkey-btn'),
    copyPasskeyBtn:   document.getElementById('copy-passkey-btn'),
    savePasskeyBtn:   document.getElementById('save-passkey-btn'),
    clearPasskeyBtn:  document.getElementById('clear-passkey-btn'),
    deleteRoomRow:    document.getElementById('delete-room-row'),
    deleteRoomBtn:    document.getElementById('delete-room-btn'),
    passkeyJoinInput: document.getElementById('passkey-join-input'),
    passkeyJoinBtn:   document.getElementById('passkey-join-btn'),
    // Modals
    createRoomModal:  document.getElementById('create-room-modal'),
    createRoomForm:   document.getElementById('create-room-form'),
    createRoomName:   document.getElementById('create-room-name'),
    createRoomPrivate:document.getElementById('create-room-private'),
    cancelCreateRoomBtn:document.getElementById('cancel-create-room'),
    deleteUserModal:  document.getElementById('delete-user-modal'),
    deleteUserBtn:    document.getElementById('delete-user-btn'),
    cancelDeleteUserBtn:document.getElementById('cancel-delete-user'),
    confirmDeleteUserBtn:document.getElementById('confirm-delete-user'),
    deleteRoomModal:  document.getElementById('delete-room-modal'),
    deleteRoomNameDisplay:document.getElementById('delete-room-name'),
    cancelDeleteRoomBtn:document.getElementById('cancel-delete-room'),
    confirmDeleteRoomBtn:document.getElementById('confirm-delete-room'),
    editProfileModal: document.getElementById('edit-profile-modal'),
    editProfileForm:  document.getElementById('edit-profile-form'),
    editClientId:     document.getElementById('edit-client-id'),
    copyClientIdBtn:  document.getElementById('copy-client-id-btn'),
    contactBtn:       document.getElementById('contact-btn'),
    contactModal:     document.getElementById('contact-modal'),
    closeContactBtn:  document.getElementById('close-contact'),
    editUsername:     document.getElementById('edit-username'),
    usernameChangeWarning:document.getElementById('username-change-warning'),
    editAvatar:       document.getElementById('edit-avatar'),
    avatarUploadBtn:  document.getElementById('avatar-upload-btn'),
    avatarFile:       document.getElementById('avatar-file'),
    editProfileBtn:   document.getElementById('edit-profile-btn'),
    glassUiToggle:    document.getElementById('glass-ui-toggle'),
    glassMotionToggle:document.getElementById('glass-motion-toggle'),
    glassStrength:    document.getElementById('glass-strength'),
    glassStrengthWrap:document.getElementById('glass-strength-wrap'),
    glassStrengthVal: document.getElementById('glass-strength-val'),
    cancelEditProfileBtn:document.getElementById('cancel-edit-profile'),
    imageBtn:         document.getElementById('image-btn'),
    imageFile:        document.getElementById('image-file'),
    toastContainer:   document.getElementById('toast-container'),
  };

  // Check for critical missing elements
  if (!elements.messages || !elements.form || !elements.username || !elements.text) {
    console.error('Critical DOM elements missing. Chat functionality may not work.');
  }

  // Build tag from this script's own ?v= query — shows which bundle you're on
  window.__BUILD = ((document.currentScript && document.currentScript.src || '').match(/[?&]v=([^&]+)/) || [])[1] || 'cached-shell';

  // ── State ──────────────────────────────────────────────────────────────────
  const state = {
    currentRoom: 'general',
    myClientId: null,
    joined: false,
    replyTarget: null,
    typers: new Map(),
    typingTimer: null,
    currentRoomMeta: null,
    canManageCurrentRoom: false,
    canDeleteRoom: false,
    unreadCounts: {},
    readSent: new Set(),
    inboxNotifiedIds: new Set(),
    rooms: [],
    currentRoomPresence: [],
  };

  // ── Constants ──────────────────────────────────────────────────────────────
  const CONSTANTS = {
    EDIT_WINDOW_MS: 5 * 60 * 1000,
    STORAGE_KEY:   'ptr29_profile_v2',
    CLIENT_ID_KEY: 'ptr29_client_id_v2',
    CLIENT_ID_ISSUED_KEY: 'ptr29_client_id_issued_v1',
    PASSKEYS_KEY:  'ptr29_room_keys_v2',
    UNREAD_KEY:    'ptr29_unread_v2',
    INBOX_SEEN_KEY:'ptr29_inbox_seen_v1',
    GLASS_UI_KEY:  'ptr29_wenny_glass_ui_v1',
    GLASS_MOTION_KEY: 'ptr29_glass_motion_v1',
    GLASS_STRENGTH_KEY: 'ptr29_glass_strength_v1',
    GLASS_STRENGTH_MAX: 15,   // final, operator-set cap: glass never goes more solid than this
    DEFAULT_AVATAR:'https://api.dicebear.com/7.x/thumbs/svg?seed=',
    MAX_IMAGE_BYTES: 5 * 1024 * 1024,
    MAX_FILE_BYTES: 10 * 1024 * 1024,
    MAX_AVATAR_BYTES: 1 * 1024 * 1024,
    ALLOWED_IMAGE_MIME: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
    ALLOWED_FILE_MIME: {
      'application/pdf': ['pdf'],
      'text/plain': ['txt', 'text', 'log'],
      'text/csv': ['csv'],
      'application/json': ['json'],
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['docx'],
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['xlsx'],
      'application/vnd.openxmlformats-officedocument.presentationml.presentation': ['pptx'],
    },
    BLOCKED_UPLOAD_EXT: ['html', 'htm', 'svg', 'js', 'mjs', 'exe', 'dll', 'bat', 'cmd', 'sh', 'php', 'py', 'jar', 'apk', 'ipa', 'dmg', 'msi', 'wasm'],
    MAX_LINKS_PER_MESSAGE: 5,
    MAX_LINK_LENGTH: 2048,
    BLOCKED_LINK_EXT: ['exe', 'msi', 'apk', 'ipa', 'dmg', 'pkg', 'bat', 'cmd', 'sh', 'ps1', 'vbs', 'scr', 'jar', 'js', 'mjs', 'wasm'],
  };

  // ── Utilities ──────────────────────────────────────────────────────────────
  const utils = {
    generateId: () =>
      (typeof crypto !== 'undefined' && crypto.randomUUID)
        ? crypto.randomUUID()
        : 'c_' + Math.random().toString(36).slice(2) + Date.now().toString(36),

    getOrCreateClientId: () => {
      try {
        let id = localStorage.getItem(CONSTANTS.CLIENT_ID_KEY);
        if (id && id.length) return id;
        // first run: seed from the stable auth uid when available
        id = (window.ChatAPI && window.ChatAPI.uid) || utils.generateId();
        localStorage.setItem(CONSTANTS.CLIENT_ID_KEY, id);
        return id;
      } catch { return utils.generateId(); }
    },

    fileExt: (name) => {
      const m = String(name || '').toLowerCase().match(/\.([a-z0-9]+)(?:[?#]|$)/);
      return m ? m[1] : '';
    },

    isBlockedUploadExt: (name) => CONSTANTS.BLOCKED_UPLOAD_EXT.includes(utils.fileExt(name)),

    mimeForFileExt: (ext) => {
      const e = String(ext || '').toLowerCase();
      if (e === 'jpg' || e === 'jpeg') return 'image/jpeg';
      if (e === 'png') return 'image/png';
      if (e === 'gif') return 'image/gif';
      if (e === 'webp') return 'image/webp';
      for (const [mime, exts] of Object.entries(CONSTANTS.ALLOWED_FILE_MIME)) {
        if ((exts || []).includes(e)) return mime;
      }
      return '';
    },

    validateImageFile: (file, label = 'Image', maxBytes = CONSTANTS.MAX_IMAGE_BYTES) => {
      if (!file) return { ok: false, message: 'Choose a file first.' };
      const ext = utils.fileExt(file.name);
      const mime = file.type || utils.mimeForFileExt(ext);
      if (!CONSTANTS.ALLOWED_IMAGE_MIME.includes(mime)) {
        return { ok: false, message: `${label} type not allowed. Use JPG, PNG, GIF, or WebP.` };
      }
      if (file.size <= 0) return { ok: false, message: `${label} is empty.` };
      if (file.size > maxBytes) return { ok: false, message: `${label} too large (max ${utils.formatFileSize(maxBytes)}).` };
      return { ok: true };
    },

    validateGeneralUpload: (file) => {
      if (!file) return { ok: false, message: 'Choose a file first.' };
      if (file.size <= 0) return { ok: false, message: 'File is empty.' };
      if (file.size > CONSTANTS.MAX_FILE_BYTES) return { ok: false, message: `File too large (max ${utils.formatFileSize(CONSTANTS.MAX_FILE_BYTES)}).` };
      if (utils.isBlockedUploadExt(file.name)) return { ok: false, message: 'That file type is blocked for security.' };
      const ext = utils.fileExt(file.name);
      const mime = file.type || utils.mimeForFileExt(ext);
      if (CONSTANTS.ALLOWED_IMAGE_MIME.includes(mime)) return utils.validateImageFile(file);
      const allowedExts = CONSTANTS.ALLOWED_FILE_MIME[mime] || [];
      if (!allowedExts.includes(ext)) {
        return { ok: false, message: 'File type not allowed. Use PDF, TXT, CSV, JSON, DOCX, XLSX, PPTX, JPG, PNG, GIF, or WebP.' };
      }
      return { ok: true };
    },

    validatePassword: (password, username) => {
      const pw = String(password || '');
      const un = String(username || '').toLowerCase();
      const missing = [];
      if (pw.length < 8) missing.push('8+ characters');
      if (!/[a-z]/.test(pw)) missing.push('lowercase');
      if (!/[A-Z]/.test(pw)) missing.push('uppercase');
      if (!/\d/.test(pw)) missing.push('number');
      if (!/[^A-Za-z0-9]/.test(pw)) missing.push('symbol');
      if (un && pw.toLowerCase().includes(un)) missing.push('not your username');
      return missing.length ? { ok: false, message: 'Password needs: ' + missing.join(', ') + '.' } : { ok: true };
    },

    fileToImageDataUrl: (file, cb) => {
      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image();
        img.onload = () => {
          const max = 1280;
          const scale = Math.min(1, max / Math.max(img.width, img.height));
          const w = Math.round(img.width * scale), h = Math.round(img.height * scale);
          const c = document.createElement('canvas');
          c.width = w; c.height = h;
          c.getContext('2d').drawImage(img, 0, 0, w, h);
          cb(c.toDataURL('image/jpeg', 0.82));
        };
        img.onerror = () => cb(reader.result);
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    },
        fileToAvatarDataUrl: (file, cb) => {
      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image();
        img.onload = () => {
          const size = 128;
          const c = document.createElement('canvas');
          c.width = size; c.height = size;
          const scale = Math.max(size / img.width, size / img.height);
          const w = img.width * scale, h = img.height * scale;
          c.getContext('2d').drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
          cb(c.toDataURL('image/png'));
        };
        img.onerror = () => cb(reader.result);
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    },

    saveToStorage: (key, data) => { try { localStorage.setItem(key, JSON.stringify(data)); } catch {} },
    loadFromStorage: (key, defaultValue = {}) => {
      try { return JSON.parse(localStorage.getItem(key)) ?? defaultValue; } catch { return defaultValue; }
    },

    generatePasskey: () => {
      const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
      let r = '';
      for (let i = 0; i < 12; i++) {
        r += chars.charAt(Math.floor(Math.random() * chars.length));
        if (i === 3 || i === 7) r += '-';
      }
      return r;
    },

    escapeHtml: (text) => {
      const d = document.createElement('div');
      d.textContent = String(text ?? '');
      return d.innerHTML;
    },

    formatTime: (ts) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),

    formatReadBy: (names, maxShow = 3) => {
      const list = names || [];
      const shown = list.slice(0, maxShow).map(n => utils.escapeHtml(n));
      const rest = list.length - shown.length;
      return shown.join(', ') + (rest > 0 ? ` <span class="receipts-more">+${rest}</span>` : '');
    },
    truncate: (str, maxLen) => {
      const s = String(str ?? '');
      return s.length > maxLen ? s.slice(0, maxLen) + '…' : s;
    },

    isReservedUsername: (name) => String(name || '').trim().toLowerCase().includes('anonymous'),

    formatFileSize: (bytes) => {
      if (bytes < 1024) return bytes + ' B';
      if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
      return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    },

    trimLinkToken: (raw) => {
      let s = String(raw || '').trim();
      while (/[),.!?;:'"\]]$/.test(s)) s = s.slice(0, -1);
      return s;
    },

    extractLinks: (text) => {
      const out = [];
      const re = /\b((?:https?:\/\/|www\.)[^\s<>"'()\[\]]+)/gi;
      String(text || '').replace(re, (m) => { const u = utils.trimLinkToken(m); if (u) out.push(u); return m; });
      return out;
    },

    isPrivateIpv4Host: (host) => {
      const parts = String(host || '').split('.');
      if (parts.length !== 4 || !parts.every(p => /^\d+$/.test(p))) return false;
      const n = parts.map(p => Number(p));
      if (n.some(x => x < 0 || x > 255)) return true;
      const [a, b] = n;
      return a === 0 || a === 10 || a === 127 || a >= 224 ||
        (a === 100 && b >= 64 && b <= 127) ||
        (a === 169 && b === 254) ||
        (a === 172 && b >= 16 && b <= 31) ||
        (a === 192 && b === 168);
    },

    validateLink: (raw) => {
      const original = utils.trimLinkToken(raw);
      if (!original) return { ok: false, reason: 'empty link' };
      if (original.length > CONSTANTS.MAX_LINK_LENGTH) return { ok: false, reason: 'link is too long' };
      let url;
      try {
        url = new URL(/^www\./i.test(original) ? `https://${original}` : original);
      } catch { return { ok: false, reason: 'invalid link format' }; }
      if (!['http:', 'https:'].includes(url.protocol)) return { ok: false, reason: 'only http/https links are allowed' };
      if (url.username || url.password) return { ok: false, reason: 'links with hidden usernames/passwords are blocked' };
      const host = url.hostname.toLowerCase().replace(/\.$/, '');
      if (!host || host === 'localhost' || host.endsWith('.localhost')) return { ok: false, reason: 'local links are blocked' };
      if (host.includes(':') || host.startsWith('[') || host.endsWith(']')) return { ok: false, reason: 'IPv6/local-style links are blocked' };
      if (host === '0.0.0.0' || utils.isPrivateIpv4Host(host)) return { ok: false, reason: 'private network links are blocked' };
      if (host.startsWith('xn--') || host.includes('.xn--')) return { ok: false, reason: 'look-alike internationalized domains are blocked' };
      const ext = (url.pathname.match(/\.([a-z0-9]{1,8})$/i) || [])[1]?.toLowerCase();
      if (ext && CONSTANTS.BLOCKED_LINK_EXT.includes(ext)) return { ok: false, reason: `links to .${ext} files are blocked` };
      return { ok: true, url: url.href, display: original };
    },

    validateMessageLinks: (text) => {
      if (/\b(?:javascript|data|file|vbscript)\s*:/i.test(String(text || ''))) {
        return { ok: false, message: 'Blocked unsafe link protocol.' };
      }
      const links = utils.extractLinks(text);
      if (links.length > CONSTANTS.MAX_LINKS_PER_MESSAGE) {
        return { ok: false, message: `Too many links (max ${CONSTANTS.MAX_LINKS_PER_MESSAGE} per message).` };
      }
      for (const link of links) {
        const check = utils.validateLink(link);
        if (!check.ok) return { ok: false, message: `Blocked unsafe link: ${check.reason}.` };
      }
      return { ok: true };
    },

    validateAvatarValue: (avatar) => {
      const v = String(avatar || '').trim();
      if (!v) return { ok: true, value: '' };
      if (/^data:image\/(png|jpeg|jpg|gif|webp);base64,[a-z0-9+/=\r\n]+$/i.test(v)) {
        if (v.length > 1500000) return { ok: false, message: 'Avatar image is too large.' };
        return { ok: true, value: v };
      }
      let url;
      try { url = new URL(v); } catch { return { ok: false, message: 'Avatar URL is invalid.' }; }
      if (url.protocol !== 'https:') return { ok: false, message: 'Avatar URL must use HTTPS.' };
      const check = utils.validateLink(url.href);
      if (!check.ok) return { ok: false, message: 'Avatar URL blocked: ' + check.reason + '.' };
      return { ok: true, value: url.href };
    },

    replaceOutsideTags: (html, regex, replacer) => String(html || '').split(/(<[^>]+>)/g)
      .map(part => part.startsWith('<') ? part : part.replace(regex, replacer)).join(''),

    linkifySafeHtml: (html) => utils.replaceOutsideTags(html, /\b((?:https?:\/\/|www\.)[^\s<>"'()\[\]]+)/gi, (match) => {
      const trailing = match.slice(utils.trimLinkToken(match).length);
      const clean = utils.trimLinkToken(match);
      const check = utils.validateLink(clean);
      if (!check.ok) return match;
      const href = utils.escapeHtml(check.url);
      const label = utils.escapeHtml(clean.length > 80 ? clean.slice(0, 77) + '…' : clean);
      return `<a class="safe-link" href="${href}" data-url="${href}" target="_blank" rel="noopener noreferrer nofollow ugc">${label}</a>${utils.escapeHtml(trailing)}`;
    }),

    uniqueSafeLinks: (text, max = 2) => {
      const seen = new Set();
      const out = [];
      for (const raw of utils.extractLinks(text)) {
        const check = utils.validateLink(raw);
        if (!check.ok) continue;
        if (seen.has(check.url)) continue;
        seen.add(check.url);
        out.push(check.url);
        if (out.length >= max) break;
      }
      return out;
    },

    linkPreviewData: (href) => {
      const url = new URL(href);
      const host = url.hostname.replace(/^www\./, '');
      const path = url.pathname.replace(/\/$/, '');
      const labelPath = path && path !== '' ? path.split('/').filter(Boolean).slice(-2).join(' / ') : '';
      const known = {
        'gamer-09.github.io/wippyio': {
          title: 'wippy — Every project I have ever built',
          desc: 'Project/service site by gamer-09.'
        },
        'gamer-09.github.io/note_vault': {
          title: 'Note Vault',
          desc: 'A notes project hosted on GitHub Pages.'
        },
        'www.youtube.com/@whitewanderer-j4w': {
          title: 'childerviews2025',
          desc: 'YouTube channel link.'
        },
        'youtube.com/@whitewanderer-j4w': {
          title: 'childerviews2025',
          desc: 'YouTube channel link.'
        },
        'www.instagram.com/not_udo2025': {
          title: 'not_udo2025',
          desc: 'Instagram profile link.'
        },
        'instagram.com/not_udo2025': {
          title: 'not_udo2025',
          desc: 'Instagram profile link.'
        }
      };
      const key = (host + path).toLowerCase();
      const meta = known[key] || {};
      const title = meta.title || (labelPath ? `${host} — ${labelPath}` : host);
      const desc = meta.desc || `Preview for ${host}${labelPath ? ' · ' + labelPath : ''}`;
      const favicon = `${url.origin}/favicon.ico`;
      return { href: url.href, host, title, desc, favicon };
    },

    renderLinkPreviews: (text) => {
      const links = utils.uniqueSafeLinks(text, 2);
      if (!links.length) return '';
      return `<div class="link-previews">${links.map(href => {
        let p;
        try { p = utils.linkPreviewData(href); } catch { return ''; }
        return `<a class="link-preview-card safe-link" href="${utils.escapeHtml(p.href)}" data-url="${utils.escapeHtml(p.href)}" target="_blank" rel="noopener noreferrer nofollow ugc">
          <div class="link-preview-top">${utils.escapeHtml(p.href)}</div>
          <div class="link-preview-main">
            <div class="link-preview-thumb"><img src="${utils.escapeHtml(p.favicon)}" alt="" loading="lazy" onerror="this.style.display='none'"></div>
            <div class="link-preview-copy">
              <div class="link-preview-title">${utils.escapeHtml(p.title)}</div>
              <div class="link-preview-desc">${utils.escapeHtml(p.desc)}</div>
              <div class="link-preview-host">${utils.escapeHtml(p.host)}</div>
            </div>
          </div>
        </a>`;
      }).join('')}</div>`;
    },

    renderTextBody: (text) => `<span class="msg-content">${utils.renderMarkdown(text || '')}</span>${utils.renderLinkPreviews(text || '')}`,

    renderMarkdown: (text) => {
      try {
        let safe = utils.escapeHtml(text);
        // Bold: **text** — replace first so double-* is consumed before italic pass
        safe = safe.replace(/\*\*([^*<>]+)\*\*/g, '<strong>$1</strong>');
        // Italic: *text* — only remaining single * pairs after bold consumed
        safe = safe.replace(/\*([^*<>]+)\*/g, '<em>$1</em>');
        safe = utils.linkifySafeHtml(safe);
        // @mentions outside links
        safe = utils.replaceOutsideTags(safe, /@([\w.-]+)/g, '<span class="mention">@$1</span>');
        return safe;
      } catch (e) {
        return utils.escapeHtml(text);
      }
    },
  };

  // ── Toast ──────────────────────────────────────────────────────────────────
  const showToast = (message, type = 'info') => {
    const t = document.createElement('div');
    t.className = `toast ${type}`;
    t.textContent = message;
    elements.toastContainer.appendChild(t);
    setTimeout(() => t.remove(), 4000);
  };

  // ── Modals ─────────────────────────────────────────────────────────────────
  const modals = {
    open: (m) => {
      // Dismiss the on-screen keyboard before showing the modal so it
      // doesn't cover the modal content (especially the checkbox / Save
      // button at the bottom of the terms-agreement form on mobile).
      if (document.activeElement && document.activeElement !== document.body) {
        document.activeElement.blur();
      }
      m?.classList.add('open');
    },
    close:    (m) => m?.classList.remove('open'),
    closeAll: ()  => document.querySelectorAll('.modal-overlay').forEach(m => m.classList.remove('open')),
  };

  function canUseGlassUi(username) {
    return String(username || '').trim().toLowerCase() === 'wenny';
  }
  function setGlassUiEnabled(enabled) {
    document.body.classList.toggle('ptr29-glass-ui', !!enabled);
    if (elements.glassUiToggle) {
      elements.glassUiToggle.textContent = enabled ? '↩ Normal UI' : '🫧 Glass UI';
      elements.glassUiToggle.title = enabled ? 'Return to normal UI' : 'Try glass UI';
    }
    if (elements.glassStrengthWrap) elements.glassStrengthWrap.style.display = enabled ? '' : 'none';
    if (elements.glassMotionToggle) {
      elements.glassMotionToggle.style.display = enabled ? '' : 'none';
      elements.glassMotionToggle.textContent = glassBackdropMotion() ? '⏸ Still' : '▶ Animate';
      elements.glassMotionToggle.title = glassBackdropMotion()
        ? 'Freeze the live backdrop (saves battery)'
        : 'Resume the live backdrop animation';
    }
    // Live canvas backdrop: only runs while glass mode is on, so normal UI costs nothing.
    const gb = window.PTR29GlassBackdrop;
    if (gb) {
      gb.setTheme(document.documentElement.classList.contains('ptr29-light-theme'));
      gb.setEnabled(!!enabled);
    }
  }
  // ── glass thickness: one slider drives every translucent surface ──────────
  const GLASS_ALPHA_BASE = {
    dark:  { panel: .42,  item: .075, strip: .34, msgsA: .24, msgsB: .12, scrimA: .11, scrimB: .24 },
    light: { panel: .40,  item: .52,  strip: .36, msgsA: .22, msgsB: .10, scrimA: .02, scrimB: .10 },
  };
  function glassStrength() {
    const max = CONSTANTS.GLASS_STRENGTH_MAX;
    let v = max;
    try { const raw = localStorage.getItem(CONSTANTS.GLASS_STRENGTH_KEY); if (raw !== null) v = Number(raw); } catch {}
    if (!Number.isFinite(v)) v = max;
    return Math.min(max, Math.max(0, v));
  }
  function applyGlassStrength(pct) {
    const max = CONSTANTS.GLASS_STRENGTH_MAX;
    const p = Number.isFinite(Number(pct)) ? Math.min(max, Math.max(0, Number(pct))) : glassStrength();
    const light = document.documentElement.classList.contains('ptr29-light-theme');
    const base = light ? GLASS_ALPHA_BASE.light : GLASS_ALPHA_BASE.dark;
    // 0 = bare glass, 15 (the cap) = the final shipped level: panels sit at ~15%
    // opacity with a light blur, so the waves always stay clearly visible.
    const n = p / max;
    const k = 0.14 + n * 0.222;
    const a = (x) => Math.min(0.96, Math.max(0.015, x)).toFixed(3);
    const r = document.documentElement.style;
    r.setProperty('--gb-panel',   a(base.panel   * k));
    r.setProperty('--gb-item',    a(base.item    * k));
    r.setProperty('--gb-strip',   a(base.strip   * k));
    r.setProperty('--gb-msgs-a',  a(base.msgsA   * k));
    r.setProperty('--gb-msgs-b',  a(base.msgsB   * k));
    r.setProperty('--gb-scrim-a', a(base.scrimA  * k));
    r.setProperty('--gb-scrim-b', a(base.scrimB  * k));
    r.setProperty('--gb-blur',    (4 + n * 2.4).toFixed(1) + 'px');
    r.setProperty('--gb-blur-sm', (3 + n * 1.8).toFixed(1) + 'px');
    // show the exact level on the control so it can be quoted back to the operator
    const pctLabel = Math.round(p) + '%';
    if (elements.glassStrengthVal) elements.glassStrengthVal.textContent = pctLabel;
    if (elements.glassStrengthWrap) {
      const panelPct = Math.round(Number(r.getPropertyValue('--gb-panel')) * 100);
      const blurPx = Number(r.getPropertyValue('--gb-blur').replace('px', ''));
      elements.glassStrengthWrap.title =
        'Glass thickness ' + pctLabel + ' of ' + max + '% (capped) — panels ' + panelPct +
        '% opaque, blur ' + blurPx.toFixed(1) + 'px.';
    }
  }
  function glassBackdropMotion() {
    const gb = window.PTR29GlassBackdrop;
    if (gb) return gb.motionOn();
    try { return localStorage.getItem(CONSTANTS.GLASS_MOTION_KEY) !== '0'; } catch { return true; }
  }
  function syncGlassUiAccess(username) {
    const allowed = canUseGlassUi(username);
    if (elements.glassUiToggle) elements.glassUiToggle.style.display = allowed ? '' : 'none';
    if (!allowed) {
      setGlassUiEnabled(false);
      try { localStorage.removeItem(CONSTANTS.GLASS_UI_KEY); } catch {}
      return;
    }
    let enabled = false;
    try { enabled = localStorage.getItem(CONSTANTS.GLASS_UI_KEY) === '1'; } catch {}
    setGlassUiEnabled(enabled);
  }

  // ── Profile ────────────────────────────────────────────────────────────────
  const profile = {
    load: () => {
      const data = utils.loadFromStorage(CONSTANTS.STORAGE_KEY, {});
      state.myClientId = utils.getOrCreateClientId();
      if (window.ChatAPI && window.ChatAPI.setClientId) window.ChatAPI.setClientId(state.myClientId);
      // Set myUsername immediately so reaction "mine" detection works
      // before the socket connect handler fires.
      state.myUsername = data.username || '';
      elements.username.value = data.username || '';
      elements.avatar.value   = data.avatar   || '';
      profile.updateUI(data.username || 'Anonymous', data.avatar || '', state.myClientId);
      return data;
    },

    save: (username, avatar, termsAgreed = false) => {
      const prev = utils.loadFromStorage(CONSTANTS.STORAGE_KEY, {});
      const oldUsername = String(prev.username || '').trim();
      const oldClientId = state.myClientId;
      const newName = String(username || '').trim();
      const renamed = !!(oldUsername && newName && oldUsername !== newName);
      const data = { username, avatar, termsAgreed };
      utils.saveToStorage(CONSTANTS.STORAGE_KEY, data);
      try {
        const sess = getAccountSession && getAccountSession();
        if (sess && sess.id) {
          const nextSess = { ...sess, username: username || sess.username, avatar: avatar || '', termsAccepted: !!(termsAgreed || sess.termsAccepted) };
          localStorage.setItem(ACCOUNT_KEY, JSON.stringify(nextSess));
          if (window.ChatAPI && window.ChatAPI.accountUpdateProfile) {
            window.ChatAPI.accountUpdateProfile(nextSess.id, avatar || '', !!termsAgreed).catch(() => {});
          }
        }
      } catch {}
      if (renamed) {
        // New identity: a brand-new client ID on EVERY rename (never the
        // same one again, even if you switch back to an old name) and
        // everything sent under the old name is purged everywhere.
        const newId = utils.generateId();
        try { localStorage.setItem(CONSTANTS.CLIENT_ID_KEY, newId); } catch {}
        try { localStorage.setItem(CONSTANTS.CLIENT_ID_ISSUED_KEY, 'rename'); } catch {}
        state.myClientId = newId;
        if (window.ChatAPI && window.ChatAPI.setClientId) window.ChatAPI.setClientId(newId);
        socket.emit('rename-identity', { oldClientId, oldUsername, newUsername: newName });
        document.querySelectorAll('.msg').forEach(m => {
          if (m.dataset.clientId === oldClientId || (oldUsername && m.dataset.username === oldUsername)) m.remove();
        });
        if (state.joined) {
          socket.emit('join', { room: state.currentRoom, clientId: newId, username: newName, avatar: avatar || '', passkey: '' });
        }
      }
      state.myUsername = username || '';
      profile.updateUI(username, avatar, state.myClientId);
      document.querySelectorAll('.msg').forEach(m => m.classList.toggle('me', isMineDataset(m)));
      return data;
    },

    updateUI: (username, avatar, clientId) => {
      const seed = encodeURIComponent(username || 'Anonymous');
      const avatarUrl = avatar || `${CONSTANTS.DEFAULT_AVATAR}${seed}`;
      if (elements.userAvatarPreview) elements.userAvatarPreview.src = avatarUrl;
      if (elements.userUsername) elements.userUsername.textContent = username || 'Anonymous';
      if (elements.userClientId) elements.userClientId.textContent = clientId ? `ID: ${clientId.slice(0, 16)}…` : 'Not connected';
      if (elements.editUsername) elements.editUsername.value = username || '';
      if (elements.editAvatar) elements.editAvatar.value = avatar || '';
      if (elements.mobileUsername) elements.mobileUsername.value = username || '';
      syncGlassUiAccess(username || '');
    },

    // Debounced live username availability checker
    _checkTimer: null,
    checkUsername: (inputEl, value) => {
      clearTimeout(profile._checkTimer);
      // Find or create the hint element right after the input
      let hint = inputEl.parentElement?.querySelector('.username-hint');
      if (!hint) {
        hint = document.createElement('div');
        hint.className = 'username-hint';
        inputEl.after(hint);
      }
      const val = String(value || '').trim();
      if (!val) { hint.textContent = ''; hint.className = 'username-hint'; return; }
      if (val.length < 2) {
        hint.className = 'username-hint taken';
        hint.textContent = 'Too short (min 2 characters)';
        return;
      }
      if (utils.isReservedUsername(val)) {
        hint.className = 'username-hint taken';
        hint.textContent = '✗ Usernames containing "anonymous" are reserved';
        return;
      }
      hint.className = 'username-hint checking';
      hint.textContent = 'Checking…';
      profile._checkTimer = setTimeout(() => {
        socket.emit('check-username', { username: val }, (resp) => {
          if (!hint) return;
          if (resp && resp.available) {
            hint.className = 'username-hint available';
            hint.textContent = '✓ Username is available';
          } else {
            hint.className = 'username-hint taken';
            hint.textContent = '✗ Username already taken — please choose another';
          }
        });
      }, 400);
    },

    updateUsernameChangeWarning: (value) => {
      const warn = elements.usernameChangeWarning || document.getElementById('username-change-warning');
      if (!warn) return false;
      const saved = utils.loadFromStorage(CONSTANTS.STORAGE_KEY, {});
      const oldU = String(saved.username || '').trim();
      const newU = String(value || '').trim();
      const willRename = !!(oldU && newU && oldU !== newU);
      warn.style.display = willRename ? 'block' : 'none';
      return willRename;
    },

    confirmUsernameChange: (oldUsername, newUsername) => {
      const oldU = String(oldUsername || '').trim();
      const newU = String(newUsername || '').trim();
      if (!oldU || !newU || oldU === newU) return true;
      return window.confirm(
        'Username change warning:\n\n' +
        'Saving this username will create a brand-new Client ID.\n' +
        'If you later change back to a previous username, your Client ID will still change again. Old Client IDs are not reused.\n\n' +
        'Current username: ' + oldU + '\n' +
        'New username: ' + newU + '\n\n' +
        'Continue saving?'
      );
    },

    // Validate then save; returns a Promise<boolean>
    validateAndSave: (username, avatar, termsAgreed = false) => new Promise((resolve) => {
      const val = String(username || '').trim();
      if (!val || val.length < 2) {
        showToast('Username must be at least 2 characters', 'error');
        return resolve(false);
      }
      if (utils.isReservedUsername(val)) {
        showToast('Usernames containing "anonymous" are reserved — please choose another name', 'error');
        return resolve(false);
      }
      const avatarCheck = utils.validateAvatarValue(avatar);
      if (!avatarCheck.ok) {
        showToast(avatarCheck.message, 'error');
        return resolve(false);
      }
      avatar = avatarCheck.value;
      socket.emit('check-username', { username: val }, (resp) => {
        const saved = utils.loadFromStorage(CONSTANTS.STORAGE_KEY, {});
        const isOwnSaved = String(saved.username || '').trim().toLowerCase() === val.toLowerCase();
        if (!resp || (!resp.available && !isOwnSaved)) {
          showToast('Username already taken — please choose another', 'error');
          return resolve(false);
        }
        const oldU = String(saved.username || '').trim();
        const willRename = !!(oldU && oldU !== val);
        if (willRename && !profile.confirmUsernameChange(oldU, val)) {
          if (elements.editUsername) elements.editUsername.value = oldU;
          if (elements.username) elements.username.value = oldU;
          if (elements.mobileUsername) elements.mobileUsername.value = oldU;
          profile.updateUsernameChangeWarning(oldU);
          showToast('Username change cancelled — your Client ID was not changed.', 'info');
          return resolve(false);
        }
        const done = () => { profile.save(val, avatar, termsAgreed); resolve(true); };
        if (willRename && window.ChatAPI.purgeMessagesFor) {
          // full wipe of the old name happens while it is still "you" (RLS)
          window.ChatAPI.purgeMessagesFor(oldU).then(
            () => { showToast('Old identity wiped — every message under "' + oldU + '" removed', 'info'); done(); },
            () => done()
          );
        } else done();
      });
    }),

    delete: async () => {
      try {
        const un = state.myUsername || String((utils.loadFromStorage(CONSTANTS.STORAGE_KEY, {}) || {}).username || '').trim();
        const sess = getAccountSession();
        if (sess) {
          // Full erase: password-verified server-side deletion of the
          // account AND every trace of the user.
          const pwInput = document.getElementById('delete-pass');
          const pw = pwInput ? pwInput.value : '';
          if (!pw) { showToast('Enter your account password to confirm the full erase.', 'error'); return; }
          const h = await sha256hex(pw + ':' + String(sess.username || un).toLowerCase());
          if (!h) { showToast('Crypto unavailable in this browser.', 'error'); return; }
          const res = await window.ChatAPI.accountDelete(sess.id, h);
          if (pwInput) pwInput.value = '';
          if (!res || !res.ok) {
            showToast(res && res.error === 'invalid_credentials' ? 'Wrong password — nothing was deleted.' : 'Failed to delete the account.', 'error');
            return;
          }
          try { localStorage.removeItem(ACCOUNT_KEY); } catch {}
        } else if (un && window.ChatAPI.purgeMessagesFor) {
          try { await window.ChatAPI.purgeMessagesFor(un); } catch (e) {}
        }
        try { await window.ChatAPI.deleteUser(); } catch (e) {}
        [CONSTANTS.STORAGE_KEY, CONSTANTS.CLIENT_ID_KEY, CONSTANTS.PASSKEYS_KEY, CONSTANTS.UNREAD_KEY, ACCOUNT_KEY]
          .forEach(k => { try { localStorage.removeItem(k); } catch {} });
        showToast(sess
          ? 'Account and every trace of "' + (sess.username || un) + '" erased.'
          : 'Profile and all messages under "' + (un || 'your name') + '" removed.', 'success');
        setTimeout(() => window.location.reload(), 1500);
      } catch { showToast('Failed to delete profile data', 'error'); }
    },
  };

  // ── Rooms ──────────────────────────────────────────────────────────────────
  const rooms = {
    // Use socket instead of REST so ephemeral passkey rooms stay visible
    fetch: () => socket.emit('list-rooms'),

    render: () => {
      if (!elements.roomList) return;
      elements.roomList.innerHTML = '';
      state.rooms.forEach(roomData => {
        if (String(roomData.name).startsWith('tour-') && !state.tourMode) return;
        const el = document.createElement('div');
        el.className = `room${roomData.name === state.currentRoom ? ' active' : ''}${roomData.isPrivate ? ' room-private' : ''}`;
        const unread = state.unreadCounts[roomData.name] || 0;
        el.innerHTML = `
          <span class="room-icon">#</span>
          <span class="room-name">${utils.escapeHtml(roomData.name)}</span>
          ${unread > 0 ? `<span class="room-badge">${unread}</span>` : ''}
        `;
        el.addEventListener('click', () => {
          const savedPasskeys = utils.loadFromStorage(CONSTANTS.PASSKEYS_KEY, {});
          rooms.join(roomData.name, savedPasskeys[roomData.name] || '');
        });
        elements.roomList.appendChild(el);
      });
    },

    join: (roomName, passkey = '') => {
      // On mobile, username is hidden in the chat form — fall back to stored profile
      const storedProfile = utils.loadFromStorage(CONSTANTS.STORAGE_KEY, {});
      const currentUsername = elements.username.value.trim() || storedProfile.username || '';
      const isTourRoom = String(roomName).startsWith('tour-');
      if (!currentUsername && !isTourRoom) {
        showToast('Please enter a username first', 'error');
        // On mobile: stay on rooms view so they can set username; on desktop focus the field
        if (elements.username.offsetParent !== null) elements.username.focus();
        return;
      }
      // Keep hidden username input in sync with stored profile
      if (!elements.username.value.trim() && currentUsername) {
        elements.username.value = currentUsername;
      }

      if (state.joined) socket.emit('leave', { room: state.currentRoom });

      state.currentRoom = roomName;
      state.joined = true;
      delete state.unreadCounts[roomName];
      state.typers.clear();
      state.currentRoomPresence = [];
      elements.typing.textContent = '';
      utils.saveToStorage(CONSTANTS.UNREAD_KEY, state.unreadCounts);

      elements.roomName.textContent = `#${roomName}`;
      rooms.render();
      elements.messages.innerHTML = '';

      // Server sends 'history' and 'rooms' after successful join — no REST needed
      socket.emit('join', {
        room: roomName,
        clientId: state.myClientId,
        username: currentUsername || '🎓 guest',
        avatar: elements.avatar.value || storedProfile.avatar || '',
        passkey: passkey || '',
      });

      rooms.fetchMeta(roomName);
    },

    fetchMeta: (roomName) => {
      socket.emit('get-room-meta', { room: roomName }, (meta) => {
        if (meta) { state.currentRoomMeta = meta; rooms.renderMeta(meta); }
      });
    },

    renderMeta: (meta) => {
      const isOwner = isMine(meta.ownerId);
      const isAdmin = isMineAny(meta.admins);
      state.canManageCurrentRoom = isOwner || isAdmin;
      state.canDeleteRoom = isOwner || isAdmin;

      elements.roomTypeTag.textContent = meta.isPrivate ? 'Private' : 'Public';

      if (isOwner) {
        elements.roomRoleTag.style.display = 'inline';
        elements.roomRoleTag.textContent = 'Owner';
        elements.roomRoleTag.className = 'room-tag owner';
      } else if (isAdmin) {
        elements.roomRoleTag.style.display = 'inline';
        elements.roomRoleTag.textContent = 'Admin';
        elements.roomRoleTag.className = 'room-tag admin';
      } else {
        elements.roomRoleTag.style.display = 'none';
      }

      elements.roomOwner.textContent = meta.ownerInfo
        ? meta.ownerInfo.username
        : (meta.ownerId ? meta.ownerId.slice(0, 16) + '…' : '-');
      if (!meta.ownerInfo && meta.ownerId && window.ChatAPI.resolveName) {
        window.ChatAPI.resolveName(meta.ownerId).then(n => { if (n) elements.roomOwner.textContent = n; });
      }

      // during the tour, fake volunteer IDs get display names
      const augment = (ids, infos) => {
        const have = new Set((infos || []).map(x => x.clientId));
        const extra = (ids || []).filter(id => state.tourMode && !have.has(id) && String(id).startsWith('tour-fake-'))
          .map(id => ({ clientId: id, username: id.indexOf('nova') !== -1 ? 'Nova' : 'Rex' }));
        return (infos || []).concat(extra);
      };
      // Admins chips (resolve usernames from message history when needed)
      const renderAdminChips = (list) => {
        elements.roomAdminsList.innerHTML = list.length === 0
          ? '<span style="color:var(--text-dim)">None</span>'
          : list.map(u => {
              const isOwnerChip = isMine(u.clientId) || String(u.clientId) === String(meta.ownerId || '');
              const canRemove = state.canManageCurrentRoom && !isOwnerChip && state.currentRoom !== 'general';
              return `<span class="chip member-chip" title="${utils.escapeHtml(u.username)}">
                ${utils.escapeHtml(u.username)}${isOwnerChip ? ' 👑' : ''}
                ${canRemove ? `<button class="chip-remove" data-action="remove-admin" data-id="${u.clientId}" title="Remove admin">×</button>` : ''}
              </span>`;
            }).join('');
        elements.roomAdminsList.querySelectorAll('.chip-remove[data-action="remove-admin"]').forEach(btn => {
          btn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (confirm('Remove admin access from this user?'))
              socket.emit('remove-room-admin', { room: state.currentRoom, adminId: btn.dataset.id });
          });
        });
      };
      const adminsInfo = augment(meta.admins, meta.adminsInfo);
      if (adminsInfo.length) {
        renderAdminChips(adminsInfo);
      } else if ((meta.admins || []).length && window.ChatAPI.resolveName) {
        Promise.all(meta.admins.map(id => window.ChatAPI.resolveName(id).then(n => ({ clientId: id, username: n || (id.slice(0, 8) + '…') })))).then(renderAdminChips);
      } else {
        renderAdminChips([]);
      }

      // Members chips (stored access-control list for private rooms)
      const membersInfo = augment(meta.members, meta.membersInfo);
      elements.roomMembersList.innerHTML = membersInfo.length === 0
        ? '<span style="color:var(--text-dim)">None</span>'
        : membersInfo.map(u => {
            const canRemove = state.canManageCurrentRoom && state.currentRoom !== 'general';
            return `<span class="chip member-chip" title="${utils.escapeHtml(u.username)}">
              ${utils.escapeHtml(u.username)}
              ${canRemove ? `<button class="chip-remove" data-action="remove-member" data-id="${u.clientId}" title="Remove member">×</button>` : ''}
            </span>`;
          }).join('');

      // Bind remove buttons (members only — admin chips bind in renderAdminChips)
      elements.roomMembersList.querySelectorAll('.chip-remove[data-action="remove-member"]').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          if (confirm('Remove this member from the room?'))
            socket.emit('remove-room-member', { room: state.currentRoom, memberId: btn.dataset.id });
        });
      });

      // Show add-admin / add-member rows only for managers
      const mgr = state.canManageCurrentRoom && state.currentRoom !== 'general';
      document.getElementById('add-admin-row')?.style.setProperty('display', mgr ? 'flex' : 'none');
      document.getElementById('add-member-row')?.style.setProperty('display', mgr ? 'flex' : 'none');

      // Controls
      const isGeneral = state.currentRoom === 'general';
      elements.renameInput.value = state.currentRoom;
      elements.renameInput.disabled = !state.canManageCurrentRoom || isGeneral;
      elements.renameBtn.disabled   = !state.canManageCurrentRoom || isGeneral;
      elements.privacyCheckbox.checked  = meta.isPrivate;
      elements.privacyCheckbox.disabled = !state.canManageCurrentRoom || isGeneral;
      elements.savePrivacyBtn.disabled  = !state.canManageCurrentRoom || isGeneral;
      elements.passkeyInput.value = meta.passkey || '';
      [elements.passkeyInput, elements.generatePasskeyBtn, elements.copyPasskeyBtn,
       elements.savePasskeyBtn, elements.clearPasskeyBtn].forEach(el => {
        el.disabled = !state.canManageCurrentRoom || isGeneral;
      });
      elements.clearBtn.disabled = !state.canManageCurrentRoom;
      elements.deleteRoomRow.style.display = (state.canDeleteRoom && !isGeneral) ? 'flex' : 'none';

      rooms.renderInfoBanner(meta);
    },

    renderInfoBanner: (meta) => {
      let banner = document.getElementById('room-info-banner');
      if (!banner) {
        banner = document.createElement('div');
        banner.id = 'room-info-banner';
        elements.messages.parentNode.insertBefore(banner, elements.messages);
      }
      let ownerName = meta.ownerInfo
        ? meta.ownerInfo.username
        : (meta.ownerId ? meta.ownerId.slice(0, 16) + '…' : 'None');

      // "Users" = live presence (people currently in this room)
      const usersInRoom = state.currentRoomPresence.length;
      const adminCount = (meta.adminsInfo || []).length;

      banner.innerHTML = `
        <span class="banner-item" id="banner-owner">👑 <strong>Owner:</strong> ${utils.escapeHtml(ownerName)}</span>
        <span class="banner-sep">·</span>
        <span class="banner-item">👥 <strong>Users:</strong> ${usersInRoom}</span>
        <span class="banner-sep">·</span>
        <span class="banner-item">🛡 <strong>Admins:</strong> ${adminCount}</span>
        <button class="banner-view-btn" id="banner-view-btn">View Info</button>
      `;
      if (!meta.ownerInfo && meta.ownerId && window.ChatAPI.resolveName) {
        window.ChatAPI.resolveName(meta.ownerId).then(n => {
          if (!n) return;
          const el2 = banner.querySelector('#banner-owner');
          if (el2) el2.innerHTML = '👑 <strong>Owner:</strong> ' + utils.escapeHtml(n);
          if (elements.roomOwner) elements.roomOwner.textContent = n;
        });
      }
      banner.querySelector('#banner-view-btn').onclick = () => {
        elements.roomSettingsPanel.style.display = 'block';
        document.getElementById('room-info-section')?.scrollIntoView({ behavior: 'smooth' });
      };
    },

    create: async (name, isPrivate) => {
      try {
        const data = await window.ChatAPI.createRoom(name, isPrivate);
        if (data.ok) {
          showToast(`Room "#${data.name}" created!`, 'success');
          rooms.fetch();
          rooms.join(data.name);
          modals.close(elements.createRoomModal);
          elements.createRoomForm.reset();
        } else {
          showToast(data.error || 'Failed to create room', 'error');
        }
      } catch { showToast('Failed to create room', 'error'); }
    },

    // Rename via socket (no REST endpoint exists for this)
    rename: (newName) => {
      socket.emit('rename-room', { room: state.currentRoom, newName }, (resp) => {
        if (resp && resp.ok) {
          window.dispatchEvent(new CustomEvent('ptr29-room-renamed', { detail: { from: resp.from || state.currentRoom, to: resp.to } }));
          showToast(`Room renamed to #${resp.to}`, 'success');
        } else {
          showToast(resp?.error || 'Failed to rename room', 'error');
        }
      });
    },

    setPrivacy: (isPrivate) => {
      socket.emit('set-room-privacy', { room: state.currentRoom, isPrivate }, (resp) => {
        if (resp && resp.ok) {
          showToast(`Room is now ${isPrivate ? 'private' : 'public'}`, 'success');
          rooms.fetchMeta(state.currentRoom);
          rooms.fetch();
        } else {
          showToast(resp?.error || 'Failed to update privacy', 'error');
        }
      });
    },

    setPasskey: (passkey) => {
      socket.emit('set-room-passkey', { room: state.currentRoom, passkey }, (resp) => {
        if (resp && resp.ok) {
          showToast('Passkey saved', 'success');
          // Remember it so you can re-join your own room without typing it again
          const passkeys = utils.loadFromStorage(CONSTANTS.PASSKEYS_KEY, {});
          if (passkey) passkeys[state.currentRoom] = passkey;
          else delete passkeys[state.currentRoom];
          utils.saveToStorage(CONSTANTS.PASSKEYS_KEY, passkeys);
          rooms.fetchMeta(state.currentRoom);
        } else {
          showToast(resp?.error || 'Failed to save passkey', 'error');
        }
      });
    },

    delete: async () => {
      modals.close(elements.deleteRoomModal);
      showToast('Deleting room…', 'info');
      try {
        const data = await window.ChatAPI.deleteRoom(state.currentRoom);
        if (data.ok) {
          showToast(`Room "#${data.room}" deleted`, 'success');
          rooms.join('general');
          rooms.fetch();
        } else {
          showToast(data.error || 'Failed to delete room', 'error');
        }
      } catch { showToast('Failed to delete room', 'error'); }
    },

    clear: async () => {
      if (!confirm('Clear all messages in this room?')) return;
      try {
        const data = await window.ChatAPI.clearRoom(state.currentRoom);
        if (data.ok) {
          showToast('Messages cleared', 'success');
          elements.messages.innerHTML = '';
        } else {
          showToast(data.error || 'Failed to clear messages', 'error');
        }
      } catch { showToast('Failed to clear messages', 'error'); }
    },

    joinByPasskey: () => {
      const passkey = elements.passkeyJoinInput.value.trim();
      if (!passkey) return;

      socket.emit('find-room-by-passkey', { passkey }, (resp) => {
        if (!resp?.ok || !resp.room) { showToast('No room found with that passkey', 'error'); return; }
        const roomName = resp.room;

        socket.emit('enter-passkey', { room: roomName, passkey }, (enterResp) => {
          if (!enterResp?.ok) { showToast('Invalid passkey', 'error'); return; }
          // Persist for future page loads
          const passkeys = utils.loadFromStorage(CONSTANTS.PASSKEYS_KEY, {});
          passkeys[roomName] = passkey;
          utils.saveToStorage(CONSTANTS.PASSKEYS_KEY, passkeys);
          // Refresh room list so the private room appears in the sidebar
          socket.emit('list-rooms');
          elements.passkeyJoinInput.value = '';
          rooms.join(roomName, passkey);
        });
      });
    },
  };

  // Ownership rule: same client AND same CURRENT username.
  // After a rename, messages sent under the old name are no longer
  // yours — they shift to the left and lose edit/delete rights.
  function isMineMsg(msg) {
    if (!msg) return false;
    const u = String(msg.username || '').trim();
    const me = String(state.myUsername || '').trim();
    if (isMine(msg.clientId) || msg.clientId === state.myClientId) {
      // renamed away from these? then they're not yours anymore
      if (u && me && u !== me) return false;
      return true;
    }
    // identity rotation (new auth uid): same username still means you
    return !!(me && u && u === me);
  }
  function isMineDataset(el) {
    if (!el) return false;
    const u = String(el.dataset.username || '').trim();
    const me = String(state.myUsername || '').trim();
    if (isMine(el.dataset.clientId) || el.dataset.clientId === state.myClientId) {
      if (u && me && u !== me) return false;
      return true;
    }
    return !!(me && u && u === me);
  }

  // ── Messages ───────────────────────────────────────────────────────────────
  const messages = {
    render: (msg, prepend = false) => {
      if (!elements.messages) return;
      const isMe = isMineMsg(msg);
      const el = document.createElement('div');
      el.className = `msg${isMe ? ' me' : ''}`;
      el.dataset.id        = msg.id;
      el.dataset.type      = msg.type || 'text';
      el.dataset.clientId  = msg.clientId;
      el.dataset.username  = msg.username;
      el.dataset.timestamp = msg.timestamp;

      const seed = encodeURIComponent(msg.username || 'Anonymous');
      const avatarUrl = msg.avatar || `${CONSTANTS.DEFAULT_AVATAR}${seed}`;
      const canEdit = isMe && (Date.now() - msg.timestamp) < CONSTANTS.EDIT_WINDOW_MS;

      let content = '';

      if (msg.replyTo) {
        const excerpt = msg.replyTo.excerpt || msg.replyTo.message || (msg.replyTo.type === 'image' ? '[image]' : '');
        content += `
          <div class="reply-preview" data-reply-id="${msg.replyTo.id}">
            <div class="user">${utils.escapeHtml(msg.replyTo.username)}</div>
            <div class="excerpt">${utils.escapeHtml(utils.truncate(excerpt, 200))}</div>
          </div>`;
      }

      // Build body based on message type
      const fileIsImage = msg.type === 'file' && (
        String(msg.mimeType || '').startsWith('image/') ||
        /\.(png|jpe?g|gif|webp|avif|bmp)(\?|#|$)/i.test(msg.fileUrl || '') ||
        /\.(png|jpe?g|gif|webp|avif|bmp)$/i.test(msg.message || ''));
      if (msg.type === 'image' || fileIsImage) el.classList.add('image-msg');
      const bodyHtml = (msg.type === 'image' || fileIsImage)
        ? `<img class="msg-image" src="${msg.dataUrl || msg.imageUrl || msg.fileUrl || ''}" alt="Shared image" loading="lazy">`
        : msg.type === 'file'
          ? `<a class="file-attachment" href="${msg.fileUrl || '#'}" download="${utils.escapeHtml(msg.message || 'file')}" target="_blank" rel="noopener noreferrer"><span>📎</span><span>${utils.escapeHtml(msg.message || 'File')}</span>${msg.fileSize ? `<span style="color:var(--text-dim);font-size:11px">${utils.formatFileSize(msg.fileSize)}</span>` : ''}</a>`
          : utils.renderTextBody(msg.message || '');

      const reactionEntries = msg.reactions ? Object.entries(msg.reactions).filter(([,u]) => u.length > 0) : [];
      const reactionsHtml = reactionEntries.length > 0
        ? `<div class="reactions">${reactionEntries.map(([emoji, users]) => {
            const myUid = window.ChatAPI && window.ChatAPI.uid;
            const isMeU = (u) => u.userId === state.myClientId || u.userId === myUid || u.username === state.myUsername;
            const mine = users.some(isMeU);
            const names = users.map(u => isMeU(u) ? 'you' : u.username).join(', ');
            return `<button class="reaction-pill${mine ? ' active' : ''}" data-emoji="${emoji}" data-msg-id="${msg.id}" data-names="${utils.escapeHtml(names)}">${emoji} ${users.length}</button>`;
          }).join('')}</div>`
        : '<div class="reactions"></div>';

      const readByOthers = (msg.readBy || []).filter(r => r.username !== (msg.username || 'Anonymous'));
      const receiptsHtml = isMe && readByOthers.length > 0
        ? `<div class="receipts" title="Read by ${utils.escapeHtml(readByOthers.map(r => r.username).join(', '))}">✓ Read by ${utils.formatReadBy(readByOthers.map(r => r.username))}</div>`
        : '<div class="receipts"></div>';

      content += `
        <div class="msg-actions">
          <button class="msg-action-btn" data-action="reply" title="Reply">↩</button>
          <button class="msg-action-btn" data-action="react" title="React">😊</button>
          ${msg.message && msg.type === 'text' ? `<button class="msg-action-btn" data-action="copy" title="Copy">📋</button>` : ''}
          ${canEdit  ? `<button class="msg-action-btn" data-action="edit"   title="Edit">✏️</button>` : ''}
          ${isMe     ? `<button class="msg-action-btn danger" data-action="delete" title="Delete">🗑</button>` : ''}
        </div>
        <div class="meta">
          <img class="avatar" src="${avatarUrl}" alt="">
          <span class="name">${utils.escapeHtml(msg.username || 'Anonymous')}</span>
          <span class="time">${utils.formatTime(msg.timestamp)}</span>
          ${msg.edited ? '<span class="edited">(edited)</span>' : ''}
        </div>
        <div class="body">${bodyHtml}</div>
        ${reactionsHtml}
        ${receiptsHtml}`;

      el.innerHTML = content;

      // Resolve storage-backed media to signed URLs (Supabase)
      if (msg.storagePath && window.PtrMedia) {
        window.PtrMedia.resolveStorageUrl(msg.storagePath, (url) => {
          if (!url) return;
          const img = el.querySelector('img.msg-image');
          if (img) img.src = url;
          const link = el.querySelector('a.file-attachment');
          if (link) link.href = url;
        });
      }

      // Inline action buttons
      el.querySelectorAll('.msg-action-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          messages.handleAction(btn.dataset.action, el, msg);
        });
      });
      // Reaction pill clicks
      el.querySelectorAll('.reaction-pill').forEach(pill => {
        pill.addEventListener('click', (e) => {
          e.stopPropagation();
          socket.emit('react-message', { messageId: msg.id, emoji: pill.dataset.emoji });
        });
      });

      // Right-click context menu fallback
      el.addEventListener('contextmenu', (e) => { e.preventDefault(); messages.showContextMenu(e, el, msg); });

      // Reply preview click → scroll to original
      el.querySelector('.reply-preview')?.addEventListener('click', () => {
        const target = document.querySelector(`[data-id="${el.querySelector('.reply-preview').dataset.replyId}"]`);
        if (target) {
          target.scrollIntoView({ behavior: 'smooth', block: 'center' });
          target.style.animation = 'highlight 1s';
          setTimeout(() => target.style.animation = '', 1000);
        }
      });

      // Supabase backend: resolve storagePath to a signed URL so images
      // actually render and file links actually open
      if (msg.storagePath && !(msg.dataUrl || msg.imageUrl || msg.fileUrl) && window.PtrMedia) {
        window.PtrMedia.resolveStorageUrl(msg.storagePath, (url) => {
          const img = el.querySelector('img.msg-image');
          if (!url) {
            // legacy upload whose bytes were never stored — show a clean
            // placeholder instead of a broken image icon
            if (img) {
              const ph = document.createElement('div');
              ph.textContent = '🖼️ image no longer available';
              ph.style.cssText = 'font-size:12px;color:var(--text-dim);background:var(--panel2,#111827);border:1px dashed var(--border-light,#334155);border-radius:8px;padding:6px 10px;';
              img.replaceWith(ph);
            }
            return;
          }
          if (img) img.src = url;
          const a = el.querySelector('a.file-attachment');
          if (a) a.href = url;
        });
      }

      prepend ? elements.messages.prepend(el) : elements.messages.appendChild(el);
      elements.messages.scrollTop = elements.messages.scrollHeight;

      if (!isMe && !state.readSent.has(msg.id)) {
        socket.emit('mark-read', { room: state.currentRoom, messageId: msg.id });
        state.readSent.add(msg.id);
      }
    },

    send: (text) => {
      if (!text.trim() || !state.joined) return;
      const reg = (utils.loadFromStorage(CONSTANTS.STORAGE_KEY, {}) || {}).username || (elements.username && elements.username.value.trim());
      if (String(state.currentRoom).startsWith('tour-') && !reg) {
        showToast('👀 View-only during the tour — register & accept the Terms to chat', 'error');
        return;
      }
      const linkCheck = utils.validateMessageLinks(text);
      if (!linkCheck.ok) { showToast(linkCheck.message, 'error'); return; }
      socket.emit('chat-message', { text, replyTo: state.replyTarget?.id || '' });
      messages.clearReply();
    },

    sendImage: async (dataUrl, filename) => {
      try {
        const res = await window.ChatAPI.upload(state.currentRoom, { dataUrl, filename, kind: 'image' });
        if (!res.ok) showToast(res.error || 'Failed to upload image', 'error');
      } catch { showToast('Failed to upload image', 'error'); }
    },

    // Both use socket so they work for passkey sessions
    edit: (id, newText) => {
      const linkCheck = utils.validateMessageLinks(newText);
      if (!linkCheck.ok) { showToast(linkCheck.message, 'error'); return; }
      socket.emit('edit-message', { messageId: id, text: newText });
    },
    delete: (id)          => socket.emit('delete-message', { messageId: id }),

    setReply: (msgEl) => {
      const type = msgEl.dataset.type;
      const body = msgEl.querySelector('.body')?.textContent || '';
      state.replyTarget = {
        id:      msgEl.dataset.id,
        username:msgEl.dataset.username,
        excerpt: type === 'image' ? '[image]' : utils.truncate(body, 100),
        type,
      };
      elements.replyPreviewBar.style.display = 'flex';
      elements.replyPreviewBar.querySelector('.who').textContent     = state.replyTarget.username;
      elements.replyPreviewBar.querySelector('.excerpt').textContent = state.replyTarget.excerpt;
    },

    clearReply: () => {
      state.replyTarget = null;
      elements.replyPreviewBar.style.display = 'none';
    },

    sendFile: async (dataUrl, filename) => {
      try {
        const res = await window.ChatAPI.upload(state.currentRoom, { dataUrl, filename, kind: 'file' });
        if (!res.ok) showToast(res.error || 'Failed to upload file', 'error');
        else showToast('File sent!', 'success');
      } catch { showToast('Failed to upload file', 'error'); }
    },

    renderReactions: (msgEl, reactions) => {
      let div = msgEl.querySelector('.reactions');
      if (!div) { div = document.createElement('div'); div.className = 'reactions'; msgEl.appendChild(div); }
      const entries = reactions ? Object.entries(reactions).filter(([,u]) => u.length > 0) : [];
      if (entries.length === 0) { div.innerHTML = ''; return; }
      div.innerHTML = entries.map(([emoji, users]) => {
        const myUid = window.ChatAPI && window.ChatAPI.uid;
        const isMeU = (u) => u.userId === state.myClientId || u.userId === myUid || u.username === state.myUsername;
        const mine = users.some(isMeU);
        const names = users.map(u => isMeU(u) ? 'you' : u.username).join(', ');
        return `<button class="reaction-pill${mine ? ' active' : ''}" data-emoji="${emoji}" data-names="${utils.escapeHtml(names)}">${emoji} ${users.length}</button>`;
      }).join('');
      const msgId = msgEl.dataset.id;
      div.querySelectorAll('.reaction-pill').forEach(pill => {
        pill.addEventListener('click', (e) => {
          e.stopPropagation();
          socket.emit('react-message', { messageId: msgId, emoji: pill.dataset.emoji });
        });
      });
    },

    renderReceipts: (msgEl, readBy) => {
      let div = msgEl.querySelector('.receipts');
      if (!div) { div = document.createElement('div'); div.className = 'receipts'; msgEl.appendChild(div); }
      const senderUsername = msgEl.dataset.username;
      const isMyMsg = isMineDataset(msgEl);
      const readByOthers = (readBy || []).filter(r => r.username !== senderUsername);
      if (isMyMsg && readByOthers.length > 0) {
        div.title = 'Read by ' + readByOthers.map(r => r.username).join(', ');
        div.innerHTML = '✓ Read by ' + utils.formatReadBy(readByOthers.map(r => r.username));
      } else {
        div.textContent = '';
        div.title = '';
      }
    },

    showContextMenu: (e, msgEl, msg) => {
      const isMe = isMineMsg(msg);
      const canEdit = isMe && (Date.now() - msg.timestamp) < CONSTANTS.EDIT_WINDOW_MS;
      elements.contextMenu.innerHTML = `
        <button data-action="reply">↩️ Reply</button>
        <button data-action="react">😊 React</button>
        ${msg.message ? '<button data-action="copy">📋 Copy</button>' : ''}
        ${canEdit ? '<button data-action="edit">✏️ Edit</button>' : ''}
        ${isMe ? '<button data-action="delete" class="danger">🗑️ Delete</button>' : ''}
      `;
      elements.contextMenu.classList.add('open');
      const mw = elements.contextMenu.offsetWidth || 180;
      const mh = elements.contextMenu.offsetHeight || 220;
      elements.contextMenu.style.left = Math.max(8, Math.min(e.clientX, window.innerWidth - mw - 8)) + 'px';
      elements.contextMenu.style.top  = Math.max(8, Math.min(e.clientY, window.innerHeight - mh - 8)) + 'px';
      // Remove old listeners by replacing innerHTML (already done above); bind fresh ones
      elements.contextMenu.querySelectorAll('button').forEach(btn => {
        btn.addEventListener('click', () => {
          messages.handleAction(btn.dataset.action, msgEl, msg);
          elements.contextMenu.classList.remove('open');
        });
      });
    },

    handleAction: (action, msgEl, msg) => {
      switch (action) {
        case 'reply':
          messages.setReply(msgEl);
          elements.text.focus();
          break;
        case 'copy':
          navigator.clipboard.writeText(msg.message).then(() => showToast('Copied', 'success'));
          break;
        case 'edit': {
          const newText = prompt('Edit message:', msg.message);
          if (newText !== null && newText.trim() && newText !== msg.message)
            messages.edit(msg.id, newText.trim());
          break;
        }
        case 'delete':
          if (confirm('Delete this message?')) messages.delete(msg.id);
          break;
        case 'react':
          messages.showEmojiReactPicker(msgEl, msg);
          break;
      }
    },

    showEmojiReactPicker: (msgEl, msg) => {
      const existing = document.getElementById('react-picker-popup');
      if (existing) existing.remove();
      const QUICK_EMOJIS = ['👍','❤️','😂','😮','😢','🔥','👏','🎉','✅','💯'];
      const picker = document.createElement('div');
      picker.id = 'react-picker-popup';
      picker.style.cssText = 'position:fixed;z-index:99999;background:var(--panel2);border:1px solid var(--border);border-radius:8px;padding:8px;display:grid;grid-template-columns:repeat(5,1fr);gap:4px;box-shadow:0 4px 16px rgba(0,0,0,0.4)';
      QUICK_EMOJIS.forEach(em => {
        const btn = document.createElement('button');
        btn.textContent = em; btn.type = 'button';
        btn.style.cssText = 'background:none;border:none;font-size:20px;cursor:pointer;padding:4px;border-radius:6px';
        btn.onmouseenter = () => btn.style.background = 'rgba(255,255,255,0.1)';
        btn.onmouseleave = () => btn.style.background = 'none';
        btn.addEventListener('click', () => {
          socket.emit('react-message', { messageId: msg.id, emoji: em });
          picker.remove();
        });
        picker.appendChild(btn);
      });
      const rect = msgEl.getBoundingClientRect();
      picker.style.top = `${Math.min(rect.bottom + 4, window.innerHeight - 130)}px`;
      picker.style.left = `${Math.min(rect.left, window.innerWidth - 210)}px`;
      document.body.appendChild(picker);
      setTimeout(() => {
        document.addEventListener('click', function once(e) {
          if (!picker.contains(e.target)) { picker.remove(); document.removeEventListener('click', once); }
        });
      }, 0);
    },
  };

  // ── Offline users ─────────────────────────────────────────────────────────
  const offline = {
    refresh: () => {
      const box = document.getElementById('offline-list');
      if (!box || !window.ChatAPI.offlineUsers) return;
      window.ChatAPI.offlineUsers().then(list => {
        box.innerHTML = '';
        const seen = {};
        const arr = (list || []).filter(u => {
          const nm = (u.username || '').trim();
          if (!nm || nm === 'Anonymous' || nm.startsWith('🎓')) return false;
          const k = nm.toLowerCase();
          if (seen[k]) return false;
          seen[k] = true;
          return true;
        });
        const pq2 = (state.peopleQuery || '').toLowerCase();
        const arrShown = pq2 ? arr.filter(u => (u.username || '').toLowerCase().includes(pq2)) : arr;
        const fb = document.getElementById('show-offline-btn');
        if (!arrShown.length) {
          if (fb) fb.textContent = 'Offline (0)';
          box.innerHTML = '<div style="color:var(--text-dim);font-size:12px;padding:4px 8px">everyone is online ✨</div>';
          return;
        }
        // escape any old markup variant: hoist out of #offline-section if trapped
        if (box.parentElement && box.parentElement.id === 'offline-section') {
          const sec = box.parentElement;
          sec.parentElement.appendChild(box);
          sec.remove();
        }
        box.style.padding = '12px';
        const agoMs = (ms) => {
          const sec = (Date.now() - ms) / 1000;
          if (sec < 60) return 'just now';
          const steps = [[31536000, 'y'], [2592000, 'mo'], [86400, 'd'], [3600, 'h'], [60, 'm']];
          for (const [ss, n] of steps) if (sec >= ss) return Math.floor(sec / ss) + n + ' ago';
          return 'now';
        };
        const escFn = (t) => String(t).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
        let rendered = 0;
        arrShown.slice(0, 40).forEach(u => {
        try {
          const d = document.createElement('div');
          d.style.cssText = 'display:flex;align-items:center;gap:10px;padding:7px 8px;';
          const av = u.avatar || ('https://api.dicebear.com/7.x/thumbs/svg?seed=' + encodeURIComponent(u.username));
          const nm = (u.username || '').trim() || '(unknown)';
          const ls = Number(u.last_seen);
          const statusTxt = (u.last_seen && Number.isFinite(ls) && ls > 0)
            ? 'seen ' + agoMs(ls)
            : 'offline';
          d.innerHTML = `<img src="${av}" alt="" style="width:28px;height:28px;border-radius:50%;opacity:.55;filter:grayscale(1);border:1px solid var(--border);object-fit:cover">
            <div style="min-width:0">
              <div style="font-size:13px;opacity:.85;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escFn(nm)}</div>
              <div style="font-size:11px;color:var(--text-dim)">${statusTxt}</div>
            </div>`;
          box.appendChild(d);
          rendered++;
        } catch (e) {
          const dbg = document.createElement('div');
          dbg.style.cssText = 'font-size:10px;color:var(--danger);padding:4px 8px;word-break:break-all';
          dbg.textContent = '(row error) ' + JSON.stringify(u).slice(0, 120);
          box.appendChild(dbg);
          rendered++;
        }
        });
        if (fb) fb.textContent = 'Offline (' + rendered + ')';
      }).catch(() => {});
    },
  };

  function setPeopleView(off) {
    const ol = document.getElementById('online-list');
    const of = document.getElementById('offline-list');
    const b1 = document.getElementById('show-online-btn');
    const b2 = document.getElementById('show-offline-btn');
    if (ol) {
      ol.hidden = !!off;
      ol.style.display = off ? 'none' : '';
    }
    if (of) {
      of.hidden = !off;
      of.style.display = off ? 'block' : 'none';
      of.setAttribute('aria-hidden', off ? 'false' : 'true');
    }
    if (b1) b1.classList.toggle('active', !off);
    if (b2) b2.classList.toggle('active', !!off);
    state.peopleView = off ? 'offline' : 'online';
    if (off) offline.refresh();
  }

  // Permanent delegated People toggle: works even if the Supabase connect
  // event fired before socketHandlers were attached (common on mobile reloads).
  let lastPeopleToggleAt = 0;
  function handlePeopleToggleEvent(e) {
    const offlineBtn = e.target.closest && e.target.closest('#show-offline-btn');
    const onlineBtn = e.target.closest && e.target.closest('#show-online-btn');
    if (!offlineBtn && !onlineBtn) return;
    const now = Date.now();
    if (now - lastPeopleToggleAt < 120) return;
    lastPeopleToggleAt = now;
    e.preventDefault();
    e.stopPropagation();
    setPeopleView(!!offlineBtn);
  }
  document.addEventListener('pointerup', handlePeopleToggleEvent, true);
  document.addEventListener('click', handlePeopleToggleEvent, true);

  // ── Online users ───────────────────────────────────────────────────────────
  const online = {
    update: (users) => {
      if (!elements.onlineList) return;
      setTimeout(() => offline.refresh(), 250);
      elements.onlineList.innerHTML = '';
      const listAll = (users || [])
        .filter(u => {
          const n = String(u && u.username || '').trim();
          return n && !utils.isReservedUsername(n) && n !== 'Anonymous';
        })
        .concat(state.tourMode ? (state.tourFakes || []) : []);
      state.lastPresenceUsers = listAll;
      const pq = (state.peopleQuery || '').toLowerCase();
      const shown = pq ? listAll.filter(u => (u.username || '').toLowerCase().includes(pq)) : listAll;
      const ob = document.getElementById('show-online-btn');
      if (ob) ob.textContent = 'Online (' + shown.length + ')';
      shown.forEach(user => {
        const seed = encodeURIComponent(user.username || 'Anonymous');
        const av = user.avatar || `${CONSTANTS.DEFAULT_AVATAR}${seed}`;
        const el = document.createElement('div');
        el.className = 'online-item';
        el.innerHTML = `
          <img src="${av}" alt="">
          <div class="info">
            <div class="name">${utils.escapeHtml(user.username || 'Anonymous')}</div>
            <div class="status">${user.room ? `in #${user.room}` : 'online'}</div>
          </div>
          <button type="button" class="online-menu-btn" data-menu-user="${utils.escapeHtml(user.username || 'Anonymous')}" title="Options">⋮</button>
          <div class="online-indicator"></div>
        `;
        elements.onlineList.appendChild(el);
      });
    },
  };

  // ── Socket event handlers ──────────────────────────────────────────────────
  const socketHandlers = {
    connect: () => {
      const idIssued = localStorage.getItem(CONSTANTS.CLIENT_ID_ISSUED_KEY);
      // A signed-in account always owns the identity. The browser's anonymous
      // auth uid must never replace it: doing so made new rooms/rows belong to
      // whoever had last used this browser (e.g. a previous account).
      const acct = getAccountSession();
      if (acct && acct.id) {
        state.myClientId = acct.id;
        try { localStorage.setItem(CONSTANTS.CLIENT_ID_KEY, acct.id); } catch {}
      } else if (idIssued === 'rename') {
        state.myClientId = utils.getOrCreateClientId();
      } else if (window.ChatAPI && window.ChatAPI.uid) {
        state.myClientId = window.ChatAPI.uid;
        try { localStorage.setItem(CONSTANTS.CLIENT_ID_KEY, window.ChatAPI.uid); } catch {}
      } else {
        state.myClientId = utils.getOrCreateClientId();
      }
      if (window.ChatAPI && window.ChatAPI.setClientId) window.ChatAPI.setClientId(state.myClientId);
      if (acct && acct.id && window.ChatAPI && window.ChatAPI.setAccountId) window.ChatAPI.setAccountId(acct.id);
      try { const d = JSON.parse(localStorage.getItem(CONSTANTS.STORAGE_KEY) || '{}'); state.myUsername = d.username || ''; } catch {}
      // keep the server-side profile row (name + avatar) in sync
      if (state.myUsername) socket.emit('update-profile', { room: state.currentRoom, username: state.myUsername, avatar: (utils.loadFromStorage(CONSTANTS.STORAGE_KEY, {}) || {}).avatar || '' });
      // tab closed -> offline; tab open -> online even without a room
      window.addEventListener('pagehide', () => { if (window.ChatAPI.goOffline) window.ChatAPI.goOffline(); });
      window.addEventListener('beforeunload', () => { if (window.ChatAPI.goOffline) window.ChatAPI.goOffline(); });
      setInterval(() => offline.refresh(), 60000);
      const psBox = document.getElementById('people-search');
      if (psBox) psBox.addEventListener('input', () => {
        state.peopleQuery = psBox.value.trim();
        online.update(state.lastPresenceUsers || []);
        offline.refresh();
      });
      document.getElementById('show-online-btn')?.addEventListener('click', () => setPeopleView(false));
      document.getElementById('show-offline-btn')?.addEventListener('click', () => setPeopleView(true));
      setPeopleView(state.peopleView === 'offline');
      // silently remove leftover tour rooms from crashed tours
      if (window.ChatAPI.tourRooms) window.ChatAPI.tourRooms().then(l => (l || []).forEach(n => window.ChatAPI.deleteRoom(n).catch(() => {}))).catch(() => {});

      // Re-enter saved passkeys so the server restores ephemeral access after reconnect
      const savedPasskeys = utils.loadFromStorage(CONSTANTS.PASSKEYS_KEY, {});
      Object.entries(savedPasskeys).forEach(([room, passkey]) => {
        socket.emit('enter-passkey', { room, passkey }, () => {});
      });

      rooms.fetch();

      const params = new URLSearchParams(window.location.search);
      const target = params.get('room') || state.currentRoom || 'general';
      rooms.join(target, savedPasskeys[target] || '');
    },

    'chat-message': (data) => {
      if (document.querySelector(`[data-id="${data.id}"]`)) return; // dedupe (realtime + optimistic)
      if (data.room === state.currentRoom) {
        messages.render(data);
        if (!isMine(data.clientId) && data.clientId !== state.myClientId)
          socket.emit('mark-read', { room: state.currentRoom, messageId: data.id });
      } else {
        state.unreadCounts[data.room] = (state.unreadCounts[data.room] || 0) + 1;
        utils.saveToStorage(CONSTANTS.UNREAD_KEY, state.unreadCounts);
        rooms.render();
      }
    },

    'message-updated': (data) => {
      const msgEl = document.querySelector(`[data-id="${data.id}"]`);
      if (!msgEl) return;
      const bodyEl = msgEl.querySelector('.body');
      if (bodyEl) bodyEl.innerHTML = utils.renderTextBody(data.message || '');
      if (!msgEl.querySelector('.edited')) {
        msgEl.querySelector('.time')?.insertAdjacentHTML('afterend', '<span class="edited">(edited)</span>');
      }
    },

    'message-deleted': (data) => document.querySelector(`[data-id="${data.messageId}"]`)?.remove(),

    'history': (data) => {
      if (data.room !== state.currentRoom) return;
      if (elements.messages) elements.messages.innerHTML = '';
      data.messages.forEach(msg => messages.render(msg));
      document.querySelectorAll('.msg').forEach(m => m.classList.toggle('me', isMineDataset(m)));
    },

    'presence': (data) => {
      if (data && data.room === state.currentRoom) {
        state.currentRoomPresence = data.users || [];
        if (state.currentRoomMeta) rooms.renderInfoBanner(state.currentRoomMeta);
      }
    },

    'presence-all': (data) => online.update(data.users),

    'inbox-changed': () => {
      refreshInboxBadge({ notify: true });
      if (window.__ptrRefreshInboxUI) window.__ptrRefreshInboxUI();
      if (window.__ptrRefreshUserProfileIdSection) window.__ptrRefreshUserProfileIdSection();
    },

    'typing': (data) => {
      if (!data.isTyping) { state.typers.delete(data.userId); }
      else { state.typers.set(data.userId, data.username); }
      const names = Array.from(state.typers.values());
      if      (names.length === 0) elements.typing.textContent = '';
      else if (names.length === 1) elements.typing.textContent = `${names[0]} is typing…`;
      else if (names.length === 2) elements.typing.textContent = `${names[0]} and ${names[1]} are typing…`;
      else                          elements.typing.textContent = `${names.length} people are typing…`;
    },

    'rooms': (data) => {
      state.rooms = Array.isArray(data) ? data : (data.rooms || []);
      rooms.render();
    },

    'room-deleted': (data) => {
      showToast(`Room "#${data.room}" was deleted`, 'info');
      if (state.currentRoom === data.room) rooms.join('general');
      rooms.fetch();
    },

    'room-meta': (data) => {
      if (data && data.meta && data.room === state.currentRoom) {
        state.currentRoomMeta = data.meta;
        rooms.renderMeta(data.meta);
      }
    },

    'room-renamed': (data) => {
      window.dispatchEvent(new CustomEvent('ptr29-room-renamed', { detail: { from: data.from, to: data.to } }));
      // Update current room if we were in the renamed one
      if (state.currentRoom === data.from) {
        state.currentRoom = data.to;
        elements.roomName.textContent = `#${data.to}`;
        // Update stored passkey key if we have one
        const passkeys = utils.loadFromStorage(CONSTANTS.PASSKEYS_KEY, {});
        if (passkeys[data.from]) {
          passkeys[data.to] = passkeys[data.from];
          delete passkeys[data.from];
          utils.saveToStorage(CONSTANTS.PASSKEYS_KEY, passkeys);
        }
      }
      rooms.fetch();
    },

    'system': (data) => {
      if (data.type === 'notify') showToast(data.message, 'info');
      else if (data.type === 'error') showToast(data.message, 'error');
      else if (data.type === 'welcome') showToast(`Joined #${state.currentRoom}`, 'success');
    },

    'user-deleted': () => { showToast('A user was deleted', 'info'); rooms.fetch(); },

    'error': (data) => {
      const map = {
        edit_window_expired: 'Edit window has expired (5 min limit)',
        forbidden:           'You can only edit/delete your own messages',
        not_found:           'Message not found',
        safe_link_policy_rejected: 'The database link policy rejected this link. Run the latest safe-link SQL migration (020), then try again.',
      };
      showToast(map[data?.error] || data?.error || 'Action failed', 'error');
    },

    'identity-purged': (data) => {
      document.querySelectorAll('.msg').forEach(el => {
        if ((data.clientId && el.dataset.clientId === data.clientId) ||
            (data.username && el.dataset.username === data.username)) el.remove();
      });
    },

    'read-receipt': (data) => {
      const msgEl = document.querySelector(`[data-id="${data.messageId}"]`);
      if (!msgEl) return;
      const div = msgEl.querySelector('.receipts');
      if (!div) return;
      if (!isMineDataset(msgEl)) return;
      const current = div.textContent.replace('✓ Read by ', '');
      const names = current ? current.split(', ').filter(Boolean) : [];
      if (!names.includes(data.username)) names.push(data.username);
      div.textContent = `✓ Read by ${names.join(', ')}`;
    },

    'message-reaction': (data) => {
      const msgEl = document.querySelector(`[data-id="${data.messageId}"]`);
      if (msgEl) messages.renderReactions(msgEl, data.reactions);
    },
  };

  // ── Event listeners ────────────────────────────────────────────────────────
  const bindEvents = () => {
    // ── Help modal ────────────────────────────────────────────────────
    const helpModal   = document.getElementById('help-modal');
    const helpSub = document.querySelector('.help-sub');
    if (helpSub && window.__BUILD) helpSub.textContent += ' · build ' + window.__BUILD;
    const helpSlides  = Array.from(document.querySelectorAll('.help-slide'));
    const helpDots    = document.getElementById('help-dots');
    const helpCounter = document.getElementById('help-step-counter');
    const helpPrev    = document.getElementById('help-prev');
    const helpNext    = document.getElementById('help-next');
    let helpStep = 0;

    // Build step dots
    helpSlides.forEach((_, i) => {
      const dot = document.createElement('div');
      dot.className = 'help-dot' + (i === 0 ? ' active' : '');
      dot.addEventListener('click', () => goToStep(i));
      helpDots.appendChild(dot);
    });

    function goToStep(next) {
      const prev = helpStep;
      if (next === prev) return;
      helpSlides[prev].classList.remove('active');
      helpStep = next;
      helpSlides[next].classList.add('active');
      document.querySelectorAll('.help-dot').forEach((d, i) => d.classList.toggle('active', i === next));
      helpCounter.textContent = `${next + 1} / ${helpSlides.length}`;
      helpPrev.disabled = next === 0;
      helpNext.textContent = next === helpSlides.length - 1 ? 'Done ✓' : 'Next →';
    }

    function openHelp() {
      helpModal.classList.add('open');
      helpStep = 0;
      // Reset all slides
      helpSlides.forEach(s => s.classList.remove('active'));
      // Activate first slide
      helpSlides[0].classList.add('active');
      document.querySelectorAll('.help-dot').forEach((d, i) => d.classList.toggle('active', i === 0));
      helpCounter.textContent = `1 / ${helpSlides.length}`;
      helpPrev.disabled = true;
      helpNext.textContent = 'Next →';
    }

    document.getElementById('help-btn').addEventListener('click', openHelp);
    document.getElementById('help-close-btn').addEventListener('click', () => helpModal.classList.remove('open'));
    helpModal.addEventListener('click', (e) => { if (e.target === helpModal) helpModal.classList.remove('open'); });
    if (elements.contactBtn && elements.contactModal) {
      elements.contactBtn.addEventListener('click', () => modals.open(elements.contactModal));
      elements.contactModal.addEventListener('click', (e) => { if (e.target === elements.contactModal) modals.close(elements.contactModal); });
      if (elements.closeContactBtn) elements.closeContactBtn.addEventListener('click', () => modals.close(elements.contactModal));
    }
    helpPrev.addEventListener('click', () => { if (helpStep > 0) goToStep(helpStep - 1); });
    helpNext.addEventListener('click', () => {
      if (helpStep < helpSlides.length - 1) goToStep(helpStep + 1);
      else helpModal.classList.remove('open');
    });
    document.addEventListener('keydown', (e) => {
      if (!helpModal.classList.contains('open')) return;
      if (e.key === 'ArrowRight') helpNext.click();
      if (e.key === 'ArrowLeft')  helpPrev.click();
    });

    // Send message
    if (elements.form) {
      elements.form.addEventListener('submit', (e) => {
        e.preventDefault();
        const text = elements.text ? elements.text.value.trim() : '';
        if (text) {
          messages.send(text);
          if (elements.text) elements.text.value = '';
        }
      });
    }

    // Typing indicator
    if (elements.text) {
      elements.text.addEventListener('input', () => {
        if (!state.joined) return;
        socket.emit('typing', { isTyping: true });
        clearTimeout(state.typingTimer);
        state.typingTimer = setTimeout(() => socket.emit('typing', { isTyping: false }), 2000);
      });
    }

    // Username live check (main sidebar input)
    if (elements.username) {
      elements.username.addEventListener('input', () =>
        profile.checkUsername(elements.username, elements.username.value));
    }

    if (elements.username) {
      elements.username.addEventListener('change', async () => {
        const val = elements.username.value.trim();
        if (!val) return;
        const data = utils.loadFromStorage(CONSTANTS.STORAGE_KEY, {});
        if (!data.termsAgreed) {
          elements.username.value = data.username || '';
          elements.editUsername.value = val;
          elements.editClientId.textContent = state.myClientId || '';
          document.querySelector('#edit-profile-modal h3').textContent = 'Create Account';
          profile.updateUsernameChangeWarning(elements.editUsername ? elements.editUsername.value : '');
          modals.open(elements.editProfileModal);
          showToast('Please agree to the Terms and Conditions to create an account.', 'info');
          return;
        }
        const ok = await profile.validateAndSave(val, elements.avatar ? elements.avatar.value : '', data.termsAgreed);
        if (ok && state.joined) {
          socket.emit('update-profile', {
            room: state.currentRoom, clientId: state.myClientId,
            username: val, avatar: elements.avatar ? elements.avatar.value : '',
          });
        }
        // Sync mobile input
        if (elements.mobileUsername) elements.mobileUsername.value = val;
      });
    }

    // Mobile username input (sidebar on mobile view)
    if (elements.mobileUsername) {
      elements.mobileUsername.addEventListener('input', () =>
        profile.checkUsername(elements.mobileUsername, elements.mobileUsername.value));

      elements.mobileUsername.addEventListener('change', async () => {
        const val = elements.mobileUsername.value.trim();
        if (!val) return;
        const data = utils.loadFromStorage(CONSTANTS.STORAGE_KEY, {});
        if (!data.termsAgreed) {
          elements.mobileUsername.value = data.username || '';
          elements.editUsername.value = val;
          elements.editClientId.textContent = state.myClientId || '';
          document.querySelector('#edit-profile-modal h3').textContent = 'Create Account';
          profile.updateUsernameChangeWarning(elements.editUsername ? elements.editUsername.value : '');
          modals.open(elements.editProfileModal);
          showToast('Please agree to the Terms and Conditions to create an account.', 'info');
          return;
        }
        const ok = await profile.validateAndSave(val, elements.avatar ? elements.avatar.value : '', data.termsAgreed);
        if (ok && state.joined) {
          socket.emit('update-profile', {
            room: state.currentRoom, clientId: state.myClientId,
            username: val, avatar: elements.avatar ? elements.avatar.value : '',
          });
        }
        // Sync desktop input
        if (elements.username) elements.username.value = val;
      });
    }

    // Image upload
    if (elements.imageBtn && elements.imageFile) {
      elements.imageBtn.addEventListener('click', () => elements.imageFile.click());
      elements.imageFile.addEventListener('change', async () => {
        const file = elements.imageFile.files?.[0];
        if (!file) return;
        const check = utils.validateImageFile(file);
        if (!check.ok) { showToast(check.message, 'error'); elements.imageFile.value = ''; return; }
        utils.fileToImageDataUrl(file, (dataUrl) => { messages.sendImage(dataUrl, file.name); elements.imageFile.value = ''; });
      });
    }

    // Room sidebar
    if (elements.createRoomBtn && elements.createRoomModal) {
      elements.createRoomBtn.addEventListener('click', () => modals.open(elements.createRoomModal));
    }
    if (elements.refreshRoomsBtn) {
      elements.refreshRoomsBtn.addEventListener('click', rooms.fetch);
    }

    if (elements.createRoomForm && elements.createRoomName && elements.createRoomPrivate) {
      elements.createRoomForm.addEventListener('submit', (e) => {
        e.preventDefault();
        rooms.create(elements.createRoomName.value, elements.createRoomPrivate.checked);
      });
    }
    if (elements.cancelCreateRoomBtn && elements.createRoomModal && elements.createRoomForm) {
      elements.cancelCreateRoomBtn.addEventListener('click', () => {
        modals.close(elements.createRoomModal);
        elements.createRoomForm.reset();
      });
    }

    elements.leaveBtn.addEventListener('click', () => {
      socket.emit('leave', { room: state.currentRoom });
      state.joined = false;
      showToast('Left room', 'info');
    });

    elements.clearBtn.addEventListener('click', rooms.clear);

    // Add admin / member
    const addAdminBtn   = document.getElementById('add-admin-btn');
    const addAdminInput = document.getElementById('add-admin-input');
    if (addAdminBtn && addAdminInput) {
      addAdminBtn.addEventListener('click', () => {
        const val = addAdminInput.value.trim();
        if (!val) return;
        socket.emit('add-room-admins', { room: state.currentRoom, admins: [val] });
        addAdminInput.value = '';
      });
    }
    const addMemberBtn   = document.getElementById('add-member-btn');
    const addMemberInput = document.getElementById('add-member-input');
    if (addMemberBtn && addMemberInput) {
      addMemberBtn.addEventListener('click', () => {
        const val = addMemberInput.value.trim();
        if (!val) return;
        socket.emit('add-room-members', { room: state.currentRoom, members: [val] });
        addMemberInput.value = '';
      });
    }

    // Room settings panel
    elements.roomSettingsBtn.addEventListener('click', () => {
      // Compare against 'block' (not 'none'): the panel starts display:none via CSS,
      // so the inline style is empty on first click and a 'none' check would no-op.
      elements.roomSettingsPanel.style.display =
        elements.roomSettingsPanel.style.display === 'block' ? 'none' : 'block';
    });
    elements.closeSettingsBtn.addEventListener('click', () =>
      elements.roomSettingsPanel.style.display = 'none');

    // ── Tablet people-panel slide-in toggle ──────────────────────────────
    const tabletPeopleBtn = document.getElementById('tablet-people-btn');
    const onlinePanel     = document.getElementById('online-panel');
    const peopleBackdrop  = document.getElementById('tablet-people-backdrop');
    const closeTabletPeople = () => {
      if (onlinePanel) onlinePanel.classList.remove('tablet-open');
      if (peopleBackdrop) peopleBackdrop.classList.remove('open');
    };
    if (tabletPeopleBtn && onlinePanel) {
      tabletPeopleBtn.addEventListener('click', () => {
        const opening = !onlinePanel.classList.contains('tablet-open');
        if (opening) {
          onlinePanel.classList.add('tablet-open');
          if (peopleBackdrop) peopleBackdrop.classList.add('open');
        } else {
          closeTabletPeople();
        }
      });
      if (peopleBackdrop) {
        peopleBackdrop.addEventListener('click', closeTabletPeople);
      }
      // Close when switching rooms (on mobile/tablet view)
      const _origJoin2 = rooms.join;
      rooms.join = (roomName, passkey) => {
        closeTabletPeople();
        return _origJoin2(roomName, passkey);
      };
    }

    elements.renameBtn.addEventListener('click', () => {
      const newName = elements.renameInput.value.trim();
      if (newName && newName !== state.currentRoom) rooms.rename(newName);
    });

    elements.savePrivacyBtn.addEventListener('click', () =>
      rooms.setPrivacy(elements.privacyCheckbox.checked));

    elements.generatePasskeyBtn.addEventListener('click', () =>
      elements.passkeyInput.value = utils.generatePasskey());

    elements.copyPasskeyBtn.addEventListener('click', () =>
      navigator.clipboard.writeText(elements.passkeyInput.value)
        .then(() => showToast('Passkey copied', 'success')));

    elements.savePasskeyBtn.addEventListener('click', () =>
      rooms.setPasskey(elements.passkeyInput.value));

    elements.clearPasskeyBtn.addEventListener('click', () => {
      elements.passkeyInput.value = '';
      rooms.setPasskey('');
    });

    // Delete room
    elements.deleteRoomBtn.addEventListener('click', () => {
      elements.deleteRoomNameDisplay.textContent = state.currentRoom;
      modals.open(elements.deleteRoomModal);
    });
    elements.cancelDeleteRoomBtn.addEventListener('click', () => modals.close(elements.deleteRoomModal));
    elements.confirmDeleteRoomBtn.addEventListener('click', rooms.delete);

    // Passkey join
    elements.passkeyJoinBtn.addEventListener('click', rooms.joinByPasskey);
    elements.passkeyJoinInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') rooms.joinByPasskey();
    });

    // Delete user
    elements.deleteUserBtn.addEventListener('click', () => modals.open(elements.deleteUserModal));
    elements.cancelDeleteUserBtn.addEventListener('click', () => modals.close(elements.deleteUserModal));
    elements.confirmDeleteUserBtn.addEventListener('click', profile.delete);

    // Edit profile
    if (elements.glassUiToggle) {
      elements.glassUiToggle.addEventListener('click', () => {
        if (!canUseGlassUi(state.myUsername)) return;
        const next = !document.body.classList.contains('ptr29-glass-ui');
        setGlassUiEnabled(next);
        try { localStorage.setItem(CONSTANTS.GLASS_UI_KEY, next ? '1' : '0'); } catch {}
      });
    }
    if (elements.glassStrength) {
      const capped = glassStrength();
      elements.glassStrength.max = String(CONSTANTS.GLASS_STRENGTH_MAX);
      elements.glassStrength.value = String(capped);
      try { localStorage.setItem(CONSTANTS.GLASS_STRENGTH_KEY, String(capped)); } catch {}
      elements.glassStrength.addEventListener('input', () => {
        applyGlassStrength(elements.glassStrength.value);
        try { localStorage.setItem(CONSTANTS.GLASS_STRENGTH_KEY, String(elements.glassStrength.value)); } catch {}
      });
    }
    if (elements.glassMotionToggle) {
      elements.glassMotionToggle.addEventListener('click', () => {
        if (!canUseGlassUi(state.myUsername)) return;
        const gb = window.PTR29GlassBackdrop;
        const next = !glassBackdropMotion();
        if (gb) gb.setMotion(next);
        else { try { localStorage.setItem(CONSTANTS.GLASS_MOTION_KEY, next ? '1' : '0'); } catch {} }
        setGlassUiEnabled(document.body.classList.contains('ptr29-glass-ui'));
      });
    }

    elements.editProfileBtn.addEventListener('click', () => {
      elements.editClientId.textContent = state.myClientId || '';
      const data = utils.loadFromStorage(CONSTANTS.STORAGE_KEY, {});
      document.querySelector('#edit-profile-modal h3').textContent = data.username ? 'Edit Profile' : 'Create Account';
      const termsCheckbox = document.getElementById('edit-terms');
      if (termsCheckbox) {
        termsCheckbox.checked = !!data.termsAgreed;
      }
      profile.updateUsernameChangeWarning(elements.editUsername ? elements.editUsername.value : '');
      modals.open(elements.editProfileModal);
    });
    elements.cancelEditProfileBtn.addEventListener('click', () => modals.close(elements.editProfileModal));
    
    // Avatar upload (mobile + desktop)
    if (elements.avatarUploadBtn && elements.avatarFile) {
      elements.avatarUploadBtn.addEventListener('click', () => elements.avatarFile.click());
      elements.avatarFile.addEventListener('change', () => {
        const f = elements.avatarFile.files && elements.avatarFile.files[0];
        if (!f) return;
        const check = utils.validateImageFile(f, 'Avatar', CONSTANTS.MAX_AVATAR_BYTES);
        if (!check.ok) { showToast(check.message, 'error'); elements.avatarFile.value = ''; return; }
        utils.fileToAvatarDataUrl(f, (dataUrl) => {
          if (elements.editAvatar) elements.editAvatar.value = dataUrl;
          if (elements.userAvatarPreview) elements.userAvatarPreview.src = dataUrl;
          showToast('Avatar ready — save your profile to apply it', 'success');
        });
        elements.avatarFile.value = '';
      });
    }

    // Copy Client ID button
    if (elements.copyClientIdBtn) {
      elements.copyClientIdBtn.addEventListener('click', () => {
        const id = elements.editClientId.textContent;
        if (id) {
          navigator.clipboard.writeText(id).then(() => showToast('Client ID copied!', 'success'));
        }
      });
    }
    elements.editUsername.addEventListener('input', () => {
      profile.checkUsername(elements.editUsername, elements.editUsername.value);
      profile.updateUsernameChangeWarning(elements.editUsername.value);
    });

    elements.editProfileForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const newUsername = elements.editUsername.value.trim();
      const newAvatar   = elements.editAvatar.value;
      const termsCheckbox = document.getElementById('edit-terms');
      const termsAgreed = termsCheckbox ? termsCheckbox.checked : true;

      if (!newUsername) return;
      if (termsCheckbox && !termsAgreed) {
        showToast('You must agree to the Terms and Conditions to create an account.', 'error');
        return;
      }

      const ok = await profile.validateAndSave(newUsername, newAvatar, termsAgreed);
      if (!ok) return;
      elements.username.value = newUsername;
      elements.avatar.value   = newAvatar;
      socket.emit('update-profile', {
        room: state.currentRoom, clientId: state.myClientId,
        username: newUsername, avatar: newAvatar,
      });
      modals.close(elements.editProfileModal);
      showToast('Profile updated', 'success');
    });

    // Reply bar close
    elements.replyPreviewBar.querySelector('.close-btn').addEventListener('click', messages.clearReply);

    // Lightbox
    elements.lightbox.addEventListener('click', () => elements.lightbox.classList.remove('open'));

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        elements.lightbox.classList.remove('open');
        elements.contextMenu.classList.remove('open');
        modals.closeAll();
        document.querySelectorAll('.msg.actions-visible').forEach(m => m.classList.remove('actions-visible'));
      }
    });

    // Messages area clicks: lightbox + tap-to-reveal action bar
    elements.messages.addEventListener('click', (e) => {
      if (e.target.classList.contains('msg-image')) {
        elements.lightboxImg.src = e.target.src;
        elements.lightbox.classList.add('open');
        return;
      }
      const msgEl = e.target.closest('.msg');
      if (msgEl && !e.target.closest('.msg-action-btn') && !e.target.closest('.reply-preview')) {
        const wasVisible = msgEl.classList.contains('actions-visible');
        document.querySelectorAll('.msg.actions-visible').forEach(m => m.classList.remove('actions-visible'));
        if (!wasVisible) msgEl.classList.add('actions-visible');
      }
    });

    // Safe external links: validate again and ask before leaving the chat.
    document.addEventListener('click', (e) => {
      const link = e.target.closest('a.safe-link[data-url]');
      if (!link) return;
      e.preventDefault();
      const url = link.dataset.url || link.href || '';
      const check = utils.validateLink(url);
      if (!check.ok) { showToast('Blocked unsafe link: ' + check.reason, 'error'); return; }
      if (confirm('Open this external link?\n\n' + check.url)) {
        window.open(check.url, '_blank', 'noopener,noreferrer');
      }
    });

    // Hide menus when clicking elsewhere
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.context-menu')) elements.contextMenu.classList.remove('open');
      if (!e.target.closest('.msg'))           document.querySelectorAll('.msg.actions-visible').forEach(m => m.classList.remove('actions-visible'));
    });

    // ── Emoji picker for input ──────────────────────────────────────────────
    const EMOJI_LIST = ['😀','😂','😍','🥺','😎','🤔','😅','😭','🥳','🤩','👍','❤️','🔥','🎉','✅','💯','😊','🙏','🤝','💪','🙄','😤','😜','🤗','💀','👀','😏','🤣','🫡','💬'];
    const emojiPopup = document.createElement('div');
    emojiPopup.id = 'emoji-input-popup';
    // Use fixed positioning so it escapes overflow:hidden parents
    emojiPopup.style.cssText = 'display:none;position:fixed;z-index:99999;background:var(--panel2);border:1px solid var(--border-light);border-radius:12px;padding:10px;grid-template-columns:repeat(5,40px);gap:4px;box-shadow:0 8px 28px rgba(0,0,0,0.7);width:220px;box-sizing:border-box';
    EMOJI_LIST.forEach(em => {
      const btn = document.createElement('button');
      btn.textContent = em; btn.type = 'button';
      btn.style.cssText = 'background:none;border:none;font-size:20px;cursor:pointer;width:40px;height:40px;border-radius:6px;display:flex;align-items:center;justify-content:center;flex-shrink:0';
      btn.onmouseenter = () => btn.style.background = 'rgba(255,255,255,0.1)';
      btn.onmouseleave = () => btn.style.background = 'none';
      btn.addEventListener('click', () => {
        const inp = elements.text;
        if (!inp) return;
        try { inp.focus({ preventScroll: true }); } catch { inp.focus(); }
        const start = inp.selectionStart != null ? inp.selectionStart : inp.value.length;
        const end = inp.selectionEnd != null ? inp.selectionEnd : start;
        // Use setRangeText so the browser moves the caret after the complete
        // UTF-16 emoji sequence. The old [...emoji].length cursor math could
        // place the caret inside surrogate pairs/ZWJ sequences, causing � chars
        // after repeated emoji insertions.
        if (typeof inp.setRangeText === 'function') {
          inp.setRangeText(em, start, end, 'end');
        } else {
          inp.value = inp.value.slice(0, start) + em + inp.value.slice(end);
          const next = start + em.length;
          inp.selectionStart = inp.selectionEnd = next;
        }
        inp.dispatchEvent(new Event('input', { bubbles: true }));
      });
      emojiPopup.appendChild(btn);
    });
    document.body.appendChild(emojiPopup);

    const positionEmojiPopup = () => {
      const emojiBtn = document.getElementById('emoji-btn');
      if (!emojiBtn) return;
      const rect = emojiBtn.getBoundingClientRect();
      // Always open upward (input bar is at bottom of screen)
      const popupWidth = 220;
      const popupHeight = emojiPopup.offsetHeight || 260;
      let top = rect.top - popupHeight - 8;
      if (top < 8) top = rect.bottom + 8; // fallback: open downward if no space
      let left = rect.left;
      if (left + popupWidth > window.innerWidth - 8) left = window.innerWidth - popupWidth - 8;
      if (left < 8) left = 8;
      emojiPopup.style.top = top + 'px';
      emojiPopup.style.bottom = '';
      emojiPopup.style.left = left + 'px';
    };

    const emojiBtn = document.getElementById('emoji-btn');
    if (emojiBtn) {
      emojiBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const visible = emojiPopup.style.display === 'grid';
        if (!visible) {
          emojiPopup.style.display = 'grid';
          positionEmojiPopup();
        } else {
          emojiPopup.style.display = 'none';
        }
      });
    }
    document.addEventListener('click', (e) => {
      if (!e.target.closest('#emoji-btn') && !e.target.closest('#emoji-input-popup'))
        emojiPopup.style.display = 'none';
    });

    // ── File upload ─────────────────────────────────────────────────────────
    const fileBtn = document.getElementById('file-btn');
    const generalFile = document.getElementById('general-file');
    if (fileBtn && generalFile) {
      fileBtn.addEventListener('click', () => {
        if (!state.joined) { showToast('Join a room first', 'error'); return; }
        generalFile.click();
      });
      generalFile.addEventListener('change', async () => {
        const file = generalFile.files[0];
        if (!file) return;
        const check = utils.validateGeneralUpload(file);
        if (!check.ok) { showToast(check.message, 'error'); generalFile.value = ''; return; }
        if (CONSTANTS.ALLOWED_IMAGE_MIME.includes(file.type)) {
          // images always render inline, never as a download chip
          utils.fileToImageDataUrl(file, (dataUrl) => messages.sendImage(dataUrl, file.name));
          generalFile.value = '';
          return;
        }
        showToast('Uploading…', 'info');
        const reader = new FileReader();
        reader.onload = async (ev) => {
          await messages.sendFile(ev.target.result, file.name);
        };
        reader.readAsDataURL(file);
        generalFile.value = '';
      });
    }

    // ── Search messages ─────────────────────────────────────────────────────
    const searchInput = document.getElementById('search-messages-input');
    if (searchInput) {
      let searchTimer = null;
      searchInput.addEventListener('input', () => {
        clearTimeout(searchTimer);
        const q = searchInput.value.trim();
        if (!q) { document.querySelectorAll('.msg').forEach(m => m.style.display = ''); return; }
        searchTimer = setTimeout(async () => {
          try {
            const data = await window.ChatAPI.searchMessages(state.currentRoom, q);
            if (!data || !data.results) return;
            const matchIds = new Set((data.results || []).map(m => m.id));
            document.querySelectorAll('.msg').forEach(m => {
              m.style.display = matchIds.has(m.dataset.id) ? '' : 'none';
            });
          } catch {}
        }, 300);
      });
      searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          searchInput.value = '';
          document.querySelectorAll('.msg').forEach(m => m.style.display = '');
        }
      });
    }

    // ── Browser notifications ───────────────────────────────────────────────
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
    socket.on('system', (data) => {
      if (data.type !== 'notify') return;
      if (document.hasFocus()) return;
      if (Notification.permission !== 'granted') return;
      try {
        const n = new Notification('ptr_29 Chat', { body: data.message, icon: 'icon-192.png' });
        setTimeout(() => n.close(), 5000);
      } catch {}
    });
  };

  // ── Composer viewport sync: keeps lower input bar in the visible screen
  // on mobile/tablet and when the on-screen keyboard changes VisualViewport.
  let composerViewportSyncReady = false;
  function setupComposerViewportSync() {
    if (composerViewportSyncReady) return;
    composerViewportSyncReady = true;
    const syncComposerViewport = () => {
      const root = document.documentElement;
      const inputArea = document.getElementById('input-area');
      if (inputArea) root.style.setProperty('--ptr29-composer-h', Math.ceil(inputArea.getBoundingClientRect().height || 64) + 'px');
      if (window.visualViewport) {
        const vv = window.visualViewport;
        const keyboardOffset = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
        root.style.setProperty('--ptr29-keyboard-offset', keyboardOffset + 'px');
      } else {
        root.style.setProperty('--ptr29-keyboard-offset', '0px');
      }
    };
    syncComposerViewport();
    window.addEventListener('resize', syncComposerViewport);
    if (window.visualViewport) {
      let lastVVHeight = window.visualViewport.height;
      const onViewportChange = () => {
        syncComposerViewport();
        const vv = window.visualViewport;
        const keyboardOpen = vv.height < lastVVHeight - 80;
        if (keyboardOpen && document.body.classList.contains('ptr29-view-chat')) {
          const msgs = document.getElementById('messages');
          if (msgs) setTimeout(() => { msgs.scrollTop = msgs.scrollHeight; }, 80);
        }
        if (!keyboardOpen) lastVVHeight = vv.height;
      };
      window.visualViewport.addEventListener('resize', onViewportChange);
      window.visualViewport.addEventListener('scroll', onViewportChange);
    }
  }

  // ── Init ───────────────────────────────────────────────────────────────────
  const init = () => {
    if (window.ChatAPI._offline) setTimeout(() => showToast('Backend unreachable — offline mode. Check your connection and reload.', 'error'), 600);
    profile.load();
    state.unreadCounts = utils.loadFromStorage(CONSTANTS.UNREAD_KEY, {});
    Object.entries(socketHandlers).forEach(([event, handler]) => socket.on(event, handler));
    setTimeout(refreshInboxBadge, 800);
    bindEvents();
    setupComposerViewportSync();
    const roomFromUrl = new URLSearchParams(window.location.search).get('room');
    if (roomFromUrl) state.currentRoom = roomFromUrl;

    // Theme toggle
    const themeBtn = document.getElementById('theme-toggle');
    const root = document.documentElement;
    const savedTheme = localStorage.getItem('ptr29_theme') || 'dark';
    applyGlassStrength();
    if (savedTheme === 'light') applyLightTheme();
    if (themeBtn) {
      themeBtn.addEventListener('click', () => {
        const isLight = root.style.getPropertyValue('--bg') === '#f8fafc';
        if (isLight) { applyDarkTheme(); localStorage.setItem('ptr29_theme', 'dark'); }
        else          { applyLightTheme(); localStorage.setItem('ptr29_theme', 'light'); }
      });
    }
  };

  function applyLightTheme() {
    const r = document.documentElement;
    r.style.setProperty('color-scheme',   'light');
    r.style.setProperty('--bg',           '#f8fafc');
    r.style.setProperty('--panel',        '#eef2f7');
    r.style.setProperty('--panel2',       '#ffffff');
    r.style.setProperty('--border',       '#dbe3ec');
    r.style.setProperty('--border-light', '#b6c2d2');
    r.style.setProperty('--text',         '#0b1526');
    r.style.setProperty('--text-muted',   '#3f4c60');
    r.style.setProperty('--text-dim',     '#5b6b81');
    r.style.setProperty('--success',      '#15803d');
    r.style.setProperty('--danger',       '#b91c1c');
    r.style.setProperty('--warning',      '#b45309');
    r.style.setProperty('--composer-bg',  '#f8fafc');
    r.style.setProperty('--composer-surface', '#ffffff');
    r.classList.add('ptr29-light-theme');
    document.getElementById('theme-toggle').textContent = '☀️';
    if (window.PTR29GlassBackdrop) window.PTR29GlassBackdrop.setTheme(true);
    applyGlassStrength();
  }

  function applyDarkTheme() {
    const r = document.documentElement;
    r.style.removeProperty('color-scheme');
    ['--success','--danger','--warning','--composer-bg','--composer-surface'].forEach((k) => r.style.removeProperty(k));
    r.classList.remove('ptr29-light-theme');
    if (window.PTR29GlassBackdrop) window.PTR29GlassBackdrop.setTheme(false);
    applyGlassStrength();
    r.style.removeProperty('--bg');
    r.style.removeProperty('--panel');
    r.style.removeProperty('--panel2');
    r.style.removeProperty('--border');
    r.style.removeProperty('--border-light');
    r.style.removeProperty('--text');
    r.style.removeProperty('--text-muted');
    r.style.removeProperty('--text-dim');
    document.getElementById('theme-toggle').textContent = '🌙';
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // MOBILE SUPPORT - Dynamically loaded for ≤640px screens.
  // Turns the 3-pane desktop layout into 3 tabs (Rooms / Chat / Online)
  // switched via the bottom nav bar, driven by body.ptr29-view-* classes.
  // ═══════════════════════════════════════════════════════════════════════════
  const MOBILE_BREAKPOINT = '(max-width: 768px)';
  let mobileInitialized = false;
  let currentMobileView = 'rooms';

  const setMobileView = (view) => {
    currentMobileView = view;
    document.body.classList.remove('ptr29-view-rooms', 'ptr29-view-chat', 'ptr29-view-online');
    document.body.classList.add(`ptr29-view-${view}`);
    document.querySelectorAll('.mobile-nav-btn').forEach(btn =>
      btn.classList.toggle('active', btn.dataset.view === view));
    if (view === 'online') {
      online.update(state.lastPresenceUsers || []);
      setPeopleView(state.peopleView === 'offline');
    }
  };

  const loadMobileStyles = () => new Promise((resolve) => {
    const existing = document.getElementById('ptr29-mobile-styles');
    if (existing) {
      // If preloaded with media="(max-width:768px)", remove media filter when JS confirms mobile
      if (existing.media && existing.media !== 'all') existing.media = 'all';
      // Already loaded or loading — resolve on next tick once styles applied
      if (existing.sheet) return resolve();
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener('error', () => resolve(), { once: true });
      // If already in DOM but sheet not yet ready, fallback timeout
      setTimeout(resolve, 400);
      return;
    }
    const link = document.createElement('link');
    link.id = 'ptr29-mobile-styles';
    link.rel = 'stylesheet';
    link.href = 'mobile.css';
    link.onload = () => resolve();
    link.onerror = () => resolve();
    document.head.appendChild(link);
  });

  const enableMobile = async () => {
    document.body.classList.add('ptr29-mobile');
    await loadMobileStyles();
    // Ensure the preloaded media query link is fully active
    const ml = document.getElementById('ptr29-mobile-styles');
    if (ml && ml.media && ml.media !== 'all') ml.media = 'all';
    setMobileView(state.joined ? 'chat' : 'rooms');

    if (mobileInitialized) return;
    mobileInitialized = true;

    // Entering chat view pushes history state so the browser/Android
    // back button behaves exactly like the in-app ← Back button.
    const goChatView = () => {
      if (document.body.classList.contains('ptr29-view-chat')) return;
      try {
        // Never stack multiple chat entries: if the top entry already says
        // chat (e.g. the boot auto-join pushed one, then the user re-entered
        // chat), replace it instead of pushing, so a single ← Back press
        // always returns to the room list instead of an older chat entry.
        if (history.state && history.state.view === 'chat') history.replaceState({ view: 'chat' }, '');
        else history.pushState({ view: 'chat' }, '');
      } catch (e) {}
      setMobileView('chat');
    };

    // Bottom nav tab clicks
    document.querySelectorAll('.mobile-nav-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        if (btn.dataset.view === 'chat') goChatView();
        else setMobileView(btn.dataset.view);
      });
    });

    // In-app back button (visible only in chat view) → room list.
    // If a history entry was pushed for the chat view, pop it so the
    // browser/Android back button stays in sync — otherwise a stale entry
    // lingers and the hardware back button needs two presses (a dead press,
    // then it exits the site).
    const backBtn = document.getElementById('mobile-back-btn');
    if (backBtn) {
      backBtn.addEventListener('click', (e) => {
        e.preventDefault();
        setMobileView('rooms');
        if (history.state && history.state.view === 'chat') {
          try { history.back(); } catch (err) {}
        }
      });
    }

    // Browser / Android hardware back: restore the chat view when the
    // pushed state says chat, otherwise collapse chat back to the list.
    window.addEventListener('popstate', () => {
      if (!document.body.classList.contains('ptr29-mobile')) return;
      if (history.state && history.state.view === 'chat') {
        setMobileView('chat');
      } else if (document.body.classList.contains('ptr29-view-chat')) {
        setMobileView('rooms');
      }
    });

    // Leaving a room sends you back to the room list
    const originalLeave = socketHandlers.leave;
    socketHandlers.leave = (data) => {
      if (document.body.classList.contains('ptr29-mobile')) setMobileView('rooms');
      if (originalLeave) originalLeave(data);
    };

    // ── Mobile search bar toggle ────────────────────────────────────────
    const mobileSearchBtn       = document.getElementById('mobile-search-btn');
    const mobileSearchBar       = document.getElementById('mobile-search-bar');
    const mobileSearchInput     = document.getElementById('mobile-search-input');
    const mobileSearchCloseBtn  = document.getElementById('mobile-search-close-btn');

    const clearMobileSearch = () => {
      if (mobileSearchInput) mobileSearchInput.value = '';
      if (mobileSearchBar)   mobileSearchBar.style.display = 'none';
      document.querySelectorAll('.msg').forEach(m => m.style.display = '');
    };

    if (mobileSearchBtn && mobileSearchBar && mobileSearchInput) {
      mobileSearchBtn.addEventListener('click', () => {
        const visible = mobileSearchBar.style.display === 'flex';
        if (visible) {
          clearMobileSearch();
        } else {
          mobileSearchBar.style.display = 'flex';
          setTimeout(() => mobileSearchInput.focus(), 50);
        }
      });

      if (mobileSearchCloseBtn) {
        mobileSearchCloseBtn.addEventListener('click', clearMobileSearch);
      }

      let mobileSearchTimer = null;
      mobileSearchInput.addEventListener('input', () => {
        clearTimeout(mobileSearchTimer);
        const q = mobileSearchInput.value.trim();
        if (!q) { document.querySelectorAll('.msg').forEach(m => m.style.display = ''); return; }
        mobileSearchTimer = setTimeout(async () => {
          try {
            const data = await window.ChatAPI.searchMessages(state.currentRoom, q);
            if (!data || !data.results) return;
            const matchIds = new Set((data.results || []).map(m => m.id));
            document.querySelectorAll('.msg').forEach(m => {
              m.style.display = matchIds.has(m.dataset.id) ? '' : 'none';
            });
          } catch {}
        }, 300);
      });

      mobileSearchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') clearMobileSearch();
      });
    }

    // Unified rooms.join wrapper: clear search AND switch to chat view
    const _originalJoin = rooms.join;
    rooms.join = (roomName, passkey) => {
      clearMobileSearch();
      const result = _originalJoin(roomName, passkey);
      if (state.joined && document.body.classList.contains('ptr29-mobile')) {
        goChatView();
        // ensure messages scrolled to bottom after switch
        setTimeout(() => {
          const msgs = document.getElementById('messages');
          if (msgs) msgs.scrollTop = msgs.scrollHeight;
        }, 100);
      }
      return result;
    };

    // Keep the Online tab badge in sync with the online users list
    const originalOnlineUpdate = online.update;
    online.update = (users) => {
      originalOnlineUpdate(users);
      const badge = document.getElementById('mobile-nav-online-badge');
      if (badge) {
        const count = (users || []).length;
        badge.textContent = count > 99 ? '99+' : String(count);
        badge.style.display = count > 0 ? 'flex' : 'none';
      }
    };

    // ── Prevent double-tap zoom on fast button presses ──────────────────
    let lastTouch = 0;
    document.addEventListener('touchend', (e) => {
      const now = Date.now();
      if (now - lastTouch < 300) e.preventDefault();
      lastTouch = now;
    }, { passive: false });
  };

  const disableMobile = () => {
    document.body.classList.remove('ptr29-mobile', 'ptr29-view-rooms', 'ptr29-view-chat', 'ptr29-view-online');
  };

  const initMobile = () => {
    const mq = window.matchMedia(MOBILE_BREAKPOINT);
    const sync = () => { if (mq.matches) enableMobile(); else disableMobile(); };
    sync();
    // addEventListener('change', ...) is the modern API; addListener is the
    // Safari <14 fallback some ptr_29 users still run.
    if (mq.addEventListener) mq.addEventListener('change', sync);
    else if (mq.addListener) mq.addListener(sync);
  };

  // ── Public user profiles + consent-based client-ID requests ────────────────
  const copyText = (t) => {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(t).then(() => showToast('Copied!', 'success')).catch(() => prompt('Copy:', t));
    } else prompt('Copy:', t);
  };

  const inboxUI = (() => {
    let ov = null;
    let activeTab = 'rec';
    let refreshTimer = null;
    const fmtDate = (t) => t ? new Date(t).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
    function ensure() {
      if (ov) return ov;
      ov = document.createElement('div');
      ov.className = 'modal-overlay';
      ov.id = 'inbox-modal';
      ov.innerHTML = '<div class="modal" style="max-width:520px">' +
        '<h3>📥 Inbox</h3>' +
        '<div style="display:flex;gap:8px;margin:8px 0 12px">' +
        '<button class="secondary" id="ib-tab-rec" type="button">Requests for you</button>' +
        '<button class="secondary" id="ib-tab-sent" type="button">Your requests</button>' +
        '<button class="secondary" id="ib-tab-shared" type="button">Stop sharing</button></div>' +
        '<div id="ib-body" style="max-height:55vh;overflow-y:auto"></div>' +
        '<div style="display:flex;justify-content:flex-end;margin-top:12px"><button class="secondary" id="ib-close" type="button">Close</button></div></div>';
      document.body.appendChild(ov);
      ov.addEventListener('click', (e) => { if (e.target === ov) ov.classList.remove('open'); });
      ov.querySelector('#ib-close').addEventListener('click', () => ov.classList.remove('open'));
      ov.querySelector('#ib-tab-rec').addEventListener('click', () => render('rec'));
      ov.querySelector('#ib-tab-sent').addEventListener('click', () => render('sent'));
      ov.querySelector('#ib-tab-shared').addEventListener('click', () => render('shared'));
      return ov;
    }
    function row(html) { const d = document.createElement('div'); d.style.cssText = 'border:1px solid var(--border);border-radius:10px;padding:10px 12px;margin-bottom:8px;background:var(--panel2)'; d.innerHTML = html; return d; }
    function render(tab, opts = {}) {
      activeTab = tab || activeTab || 'rec';
      const body = ov.querySelector('#ib-body');
      if (!opts.silent) body.innerHTML = '<p style="color:var(--text-dim)">Loading…</p>';
      window.ChatAPI.inbox().then(rows => {
        const me = inboxIdentity().toLowerCase();
        const allRows = rows || [];
        const sharedMap = {};
        allRows.forEach(r => {
          const isMine = String(r.target_username || '').trim().toLowerCase() === me;
          const activeShare = String(r.status || '').toLowerCase() === 'approved' && !!r.disclosed_client_id;
          if (!isMine || !activeShare) return;
          const key = String(r.requester_username || '').trim().toLowerCase();
          if (!key) return;
          if (!sharedMap[key] || String(r.resolved_at || r.created_at || '') > String(sharedMap[key].resolved_at || sharedMap[key].created_at || '')) sharedMap[key] = r;
        });
        const list = activeTab === 'shared'
          ? Object.values(sharedMap).sort((a, b) => String(b.resolved_at || b.created_at || '').localeCompare(String(a.resolved_at || a.created_at || '')))
          : allRows.filter(r => activeTab === 'rec'
              ? String(r.target_username || '').trim().toLowerCase() === me
              : String(r.requester_username || '').trim().toLowerCase() === me);
        body.innerHTML = '';
        if (!list.length) {
          const msg = activeTab === 'rec'
            ? 'No requests received.'
            : (activeTab === 'shared' ? 'You are not currently sharing your Client ID with anyone.' : 'You haven\'t requested any Client IDs.');
          body.innerHTML = '<p style="color:var(--text-dim);padding:8px 0">' + msg + '</p>';
          return;
        }
        list.forEach(r => {
          if (activeTab === 'shared') {
            const elr = row(`
              <div style="font-size:13.5px;color:var(--text)">You are sharing your Client ID with <b>${utils.escapeHtml(r.requester_username)}</b></div>
              <div style="font-size:11px;color:var(--text-dim);margin-top:4px">Approved ${fmtDate(r.resolved_at || r.created_at)}</div>
              <div style="font-size:12px;color:var(--text-muted);margin-top:6px">Stopping sharing removes their visible copy in the app. They will need to request your Client ID again.</div>
              <div class="ib-actions" style="display:flex;gap:8px;justify-content:flex-end;margin-top:10px"></div>`);
            const stop = document.createElement('button');
            stop.type = 'button'; stop.className = 'danger'; stop.textContent = 'Stop sharing';
            stop.addEventListener('click', () => {
              if (!confirm('Stop sharing your Client ID with ' + r.requester_username + '?\n\nThey will need to request it again.')) return;
              stop.disabled = true; stop.textContent = 'Stopping…';
              window.ChatAPI.stopSharingClientId(r.requester_username).then(res => {
                stop.disabled = false; stop.textContent = 'Stop sharing';
                if (res && res.ok) {
                  showToast('Stopped sharing your Client ID with ' + r.requester_username, 'success');
                  render('shared', { silent: true });
                  refreshInboxBadge({ notify: false });
                  if (window.__ptrRefreshUserProfileIdSection) window.__ptrRefreshUserProfileIdSection();
                } else showToast((res && res.error) || 'Failed to stop sharing', 'error');
              });
            });
            elr.querySelector('.ib-actions').appendChild(stop);
            body.appendChild(elr);
          } else if (activeTab === 'rec') {
            const elr = row(`
              <div style="font-size:13.5px;color:var(--text)"><b>${utils.escapeHtml(r.requester_username)}</b> <span style="color:var(--text-dim)">asks for your Client ID</span></div>
              <div style="font-size:12.5px;color:var(--text-muted);margin:6px 0">“${utils.escapeHtml(r.reason)}”</div>
              <div style="font-size:11px;color:var(--text-dim)">${fmtDate(r.created_at)}</div>
              <div class="ib-actions" style="display:flex;gap:8px;margin-top:8px"></div>`);
            const acts = elr.querySelector('.ib-actions');
            if (r.status === 'pending') {
              const ap = document.createElement('button'); ap.textContent = '✅ Approve'; ap.type = 'button';
              const dn = document.createElement('button'); dn.textContent = '❌ Deny'; dn.className = 'secondary'; dn.type = 'button';
              ap.addEventListener('click', () => window.ChatAPI.resolveRequest(r.id, true).then(res => { if (res.ok) { showToast('Approved — your ID was shared with ' + r.requester_username, 'success'); render('rec'); refreshInboxBadge({ notify: false }); } else showToast(res.error || 'Failed', 'error'); }));
              dn.addEventListener('click', () => window.ChatAPI.resolveRequest(r.id, false).then(res => { if (res.ok) { showToast('Denied', 'info'); render('rec'); refreshInboxBadge({ notify: false }); } else showToast(res.error || 'Failed', 'error'); }));
              acts.append(ap, dn);
            } else {
              acts.innerHTML = `<span style="font-size:12px;color:${r.status === 'approved' ? 'var(--success)' : (r.status === 'revoked' ? 'var(--warning)' : 'var(--danger)')}">${r.status === 'approved' ? '✅ Approved — ID shared' : (r.status === 'revoked' ? '🔒 Sharing stopped' : '❌ Denied')} · ${fmtDate(r.resolved_at)}</span>`;
            }
            body.appendChild(elr);
          } else {
            const elr = row(`
              <div style="font-size:13.5px;color:var(--text)">You asked <b>${utils.escapeHtml(r.target_username)}</b></div>
              <div style="font-size:12.5px;color:var(--text-muted);margin:6px 0">“${utils.escapeHtml(r.reason)}”</div>
              <div style="font-size:11px;color:var(--text-dim)">${fmtDate(r.created_at)}</div>
              <div class="ib-status" style="margin-top:8px"></div>`);
            const st = elr.querySelector('.ib-status');
            if (r.status === 'approved' && r.disclosed_client_id) {
              st.innerHTML = `<span style="font-size:12px;color:var(--success)">✅ Approved — their ID:</span>
                <div style="display:flex;gap:8px;align-items:center;margin-top:6px">
                  <code style="flex:1;font-size:11px;background:var(--panel);border:1px solid var(--border);border-radius:6px;padding:6px 8px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${utils.escapeHtml(r.disclosed_client_id)}</code>
                  <button class="secondary ib-copy" type="button">Copy</button>
                </div>`;
              st.querySelector('.ib-copy').addEventListener('click', () => copyText(r.disclosed_client_id));
            } else if (r.status === 'revoked') {
              st.innerHTML = '<span style="font-size:12px;color:var(--warning)">🔒 Sharing stopped — request again if you still need it.</span>';
            } else {
              st.innerHTML = `<span style="font-size:12px;color:${r.status === 'denied' ? 'var(--danger)' : 'var(--warning)'}">${r.status === 'denied' ? '❌ Denied' : '⏳ Pending'}</span>`;
            }
            body.appendChild(elr);
          }
        });
      }).catch(e => { body.innerHTML = '<p style="color:var(--danger)">Could not load inbox — is the id_requests table created? (' + utils.escapeHtml(e.message || e) + ')</p>'; });
    }
    function refresh() {
      if (!ov || !ov.classList.contains('open')) return;
      clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => render(activeTab || 'rec', { silent: true }), 120);
    }
    function open() { ensure(); ov.classList.add('open'); render('rec'); refreshInboxBadge({ notify: false }); }
    return { open, render, refresh };
  })();
  window.__ptrRefreshInboxUI = () => inboxUI.refresh();

  function inboxIdentity() {
    const stored = utils.loadFromStorage(CONSTANTS.STORAGE_KEY, {});
    return String(state.myUsername || stored.username || (window.ChatAPI && window.ChatAPI._username) || '').trim();
  }

  function setInboxBadgeCount(n) {
    const badge = document.getElementById('inbox-badge');
    if (!badge) return;
    if (!n) {
      badge.textContent = '';
      badge.hidden = true;
      return;
    }
    badge.hidden = false;
    badge.textContent = n > 9 ? '9+' : String(n);
  }

  function notifyBrowser(title, body) {
    if (!('Notification' in window)) return;
    const fire = () => {
      try {
        const n = new Notification(title, { body, icon: 'icon-192.png' });
        n.onclick = () => { try { window.focus(); inboxUI.open(); } catch {} n.close(); };
        setTimeout(() => n.close(), 8000);
      } catch {}
    };
    if (Notification.permission === 'granted') fire();
    else if (Notification.permission === 'default') {
      try { Notification.requestPermission().then(p => { if (p === 'granted') fire(); }); } catch {}
    }
  }

  function showInboxPopup(row) {
    const id = String(row && row.id || '');
    const safeId = id.replace(/[^a-zA-Z0-9_-]/g, '');
    if (!id || document.querySelector(`[data-inbox-popup-id="${safeId}"]`)) return;
    const from = String(row.requester_username || 'Someone');
    const reason = String(row.reason || '').trim();
    const pop = document.createElement('div');
    pop.className = 'inbox-popup';
    pop.dataset.inboxPopupId = safeId;
    pop.innerHTML = `
      <div class="inbox-popup-title">📥 New Inbox Request</div>
      <div class="inbox-popup-body"><b>${utils.escapeHtml(from)}</b> is asking for your Client ID${reason ? `:<br>“${utils.escapeHtml(utils.truncate(reason, 140))}”` : '.'}</div>
      <div class="inbox-popup-actions">
        <button type="button" class="secondary inbox-dismiss">Dismiss</button>
        <button type="button" class="inbox-open">Open Inbox</button>
      </div>`;
    const remove = () => pop.remove();
    pop.querySelector('.inbox-dismiss')?.addEventListener('click', remove);
    pop.querySelector('.inbox-open')?.addEventListener('click', () => { remove(); inboxUI.open(); });
    document.body.appendChild(pop);
    setTimeout(remove, 15000);
  }

  function notifyNewInboxRows(rows) {
    const me = inboxIdentity().toLowerCase();
    if (!me) return;
    const seen = utils.loadFromStorage(CONSTANTS.INBOX_SEEN_KEY, {});
    let changed = false;
    (rows || []).forEach(row => {
      const id = String(row && row.id || '');
      if (!id || seen[id] || state.inboxNotifiedIds.has(id)) return;
      const isForMe = String(row.target_username || '').trim().toLowerCase() === me;
      const isPending = String(row.status || '').toLowerCase() === 'pending';
      const isFromMe = String(row.requester_username || '').trim().toLowerCase() === me;
      if (!isForMe || !isPending || isFromMe) return;
      seen[id] = Date.now();
      state.inboxNotifiedIds.add(id);
      changed = true;
      const from = String(row.requester_username || 'Someone');
      showToast(`📥 New inbox request from ${from}`, 'info');
      showInboxPopup(row);
      notifyBrowser('ptr_29 Inbox', `${from} is asking for your Client ID.`);
    });
    if (changed) utils.saveToStorage(CONSTANTS.INBOX_SEEN_KEY, seen);
  }

  function refreshInboxBadge(options = {}) {
    const badge = document.getElementById('inbox-badge');
    if (!badge) return;
    const notify = options.notify !== false;
    const me = inboxIdentity().toLowerCase();
    if (!me) { setInboxBadgeCount(0); return; }
    window.ChatAPI.inbox().then(rows => {
      const pending = (rows || []).filter(r =>
        String(r.target_username || '').trim().toLowerCase() === me &&
        String(r.status || '').toLowerCase() === 'pending'
      );
      setInboxBadgeCount(pending.length);
      if (notify) notifyNewInboxRows(pending);
    }).catch(() => setInboxBadgeCount(0));
  }
  setInboxBadgeCount(0);
  // Poll only the badge/notification state. Open panels update from realtime/local
  // request events so they do not blink when nothing changed.
  setInterval(() => refreshInboxBadge({ notify: true }), 10000);
  const inboxBtnEl = document.getElementById('inbox-btn');
  if (inboxBtnEl) inboxBtnEl.addEventListener('click', () => { inboxUI.open(); });

  // ── Member profiles (rebuilt: light data, no heavy fields) ─────────────────
  const userProfile = (() => {
    let ov = null;
    let currentIdBox = null;
    let currentProfileUsername = '';
    let refreshTimer = null;
    const stat = (label, v) => `<div class="up-stat"><b>${v}</b><span>${label}</span></div>`;
    const fmtDate = (t) => t ? new Date(t).toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
    function ensure() {
      if (ov) return ov;
      ov = document.createElement('div');
      ov.className = 'modal-overlay';
      ov.id = 'user-profile-modal';
      ov.innerHTML = '<div class="modal" style="max-width:440px">' +
        '<h3>Member profile</h3><div id="up-body"></div>' +
        '<div style="display:flex;justify-content:flex-end;margin-top:12px"><button class="secondary" id="up-close" type="button">Close</button></div></div>';
      document.body.appendChild(ov);
      ov.addEventListener('click', (e) => { if (e.target === ov) ov.classList.remove('open'); });
      ov.querySelector('#up-close').addEventListener('click', () => ov.classList.remove('open'));
      return ov;
    }

    function renderIdSection(box, username, opts = {}) {
      if (!box) return;
      const me = state.myUsername || '';
      const setHtml = (signature, html, attach) => {
        if (!opts.force && box.dataset.idreqSig === signature) return;
        box.dataset.idreqSig = signature;
        box.innerHTML = html;
        if (typeof attach === 'function') attach();
      };
      if (!me || username.toLowerCase() === me.toLowerCase()) {
        setHtml('self', '<div style="font-size:11px;color:var(--text-dim);margin-top:10px">This is you — your Client ID lives in Edit Profile.</div>');
        return;
      }
      if (!opts.silent && !box.dataset.idreqSig) {
        box.innerHTML = '<p style="color:var(--text-dim);font-size:12px;margin-top:10px">Loading…</p>';
      }
      window.ChatAPI.inbox().then(rows => {
        const meLc = String(me || '').trim().toLowerCase();
        const targetLc = String(username || '').trim().toLowerCase();
        const rel = rows.find(r =>
          String(r.requester_username || '').trim().toLowerCase() === meLc &&
          String(r.target_username || '').trim().toLowerCase() === targetLc
        );
        if (rel && rel.status === 'pending') {
          setHtml(
            'pending:' + rel.id + ':' + String(rel.created_at || ''),
            `<div style="margin-top:10px;font-size:12.5px;color:var(--warning)">⏳ Request pending — sent ${fmtDate(rel.created_at)}</div>`
          );
        } else if (rel && rel.status === 'approved' && rel.disclosed_client_id) {
          setHtml(
            'approved:' + rel.id + ':' + String(rel.disclosed_client_id || ''),
            `<div style="margin-top:10px;font-size:12.5px;color:var(--success)">✅ ${utils.escapeHtml(username)} approved your request:</div>
              <div style="display:flex;gap:8px;align-items:center;margin-top:6px">
                <code style="flex:1;font-size:11px;background:var(--panel2);border:1px solid var(--border);border-radius:6px;padding:6px 8px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${utils.escapeHtml(rel.disclosed_client_id)}</code>
                <button class="secondary" type="button" id="up-copy">Copy</button>
              </div>`,
            () => box.querySelector('#up-copy')?.addEventListener('click', () => copyText(rel.disclosed_client_id))
          );
        } else {
          const deniedNote = rel && rel.status === 'denied'
            ? '<div style="font-size:11.5px;color:var(--danger);margin-top:8px">❌ Your previous request was denied — you may ask again.</div>'
            : (rel && rel.status === 'revoked' ? '<div style="font-size:11.5px;color:var(--warning);margin-top:8px">🔒 Sharing was stopped — you may request the Client ID again.</div>' : '');
          setHtml(
            (rel ? 'denied:' + rel.id + ':' + String(rel.resolved_at || '') : 'none') + ':' + targetLc,
            deniedNote + `<button class="secondary" type="button" id="up-req" style="margin-top:10px">🔑 Request Client ID</button><div id="up-req-form"></div>`,
            () => {
              box.querySelector('#up-req')?.addEventListener('click', () => {
                const form = box.querySelector('#up-req-form');
                form.innerHTML = `
                  <textarea id="up-reason" rows="3" placeholder="State your reason (required)…" style="width:100%;margin-top:8px"></textarea>
                  <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:8px">
                    <button class="secondary" type="button" id="up-cancel">Cancel</button>
                    <button type="button" id="up-send">Send request</button>
                  </div>`;
                form.querySelector('#up-cancel').addEventListener('click', () => { form.innerHTML = ''; });
                form.querySelector('#up-send').addEventListener('click', () => {
                  const why = form.querySelector('#up-reason').value.trim();
                  if (!why) { showToast('Please state a reason', 'error'); return; }
                  window.ChatAPI.sendIdRequest(username, why).then(r => {
                    if (r.ok) { showToast('Request sent to ' + username, 'success'); renderIdSection(box, username, { silent: true, force: true }); }
                    else if (r.error === 'already_pending') showToast('A request is already pending', 'error');
                    else showToast(r.error || 'Failed to send', 'error');
                  });
                });
              });
            }
          );
        }
      }).catch(() => {
        if (!opts.silent) setHtml('error', '');
      });
    }

    async function open(username, opts) {
      const m = ensure();
      m.classList.add('open');
      const body = m.querySelector('#up-body');
      body.innerHTML = '<p style="color:var(--text-dim);padding:12px 0">Loading profile…</p>';
      let d = null, err = '';
      try { d = await window.ChatAPI.publicProfile(username); } catch (e) { console.error(e); err = String(e && e.message || e); }
      if (!d) d = { username, avatar: 'https://api.dicebear.com/7.x/thumbs/svg?seed=' + encodeURIComponent(username), online: false, room: null, lastSeen: null, messages: 0, roomsCount: 0, images: 0, reactionsReceived: 0, firstSeen: null };
      body.innerHTML = `
        <div style="text-align:center;padding:6px 0 2px">
          <div style="position:relative;display:inline-block">
            <img src="${d.avatar}" alt="" style="width:96px;height:96px;border-radius:50%;border:3px solid ${d.online ? 'var(--success)' : 'var(--border-light)'}">
            <span style="position:absolute;bottom:4px;right:4px;width:16px;height:16px;border-radius:50%;background:${d.online ? 'var(--success)' : 'var(--text-dim)'};border:3px solid var(--panel)"></span>
          </div>
          <div style="font-size:22px;font-weight:700;color:var(--text);margin-top:10px">${utils.escapeHtml(d.username)}</div>
          <div style="font-size:13px;color:var(--text-dim)">@${utils.escapeHtml(d.username.toLowerCase())}</div>
          <div style="font-size:12.5px;margin-top:6px;color:${d.online ? 'var(--success)' : 'var(--text-dim)'}">${d.online ? '● Online now' + (d.room ? ' in #' + utils.escapeHtml(d.room) : '') : '○ Last seen ' + fmtDate(d.lastSeen)}</div>
          <div style="font-size:12.5px;color:var(--text-muted);font-style:italic;margin-top:10px">“Hey there! I'm using ptr_29 Chat.”</div>
        </div>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:16px 0 4px">
          ${stat('Messages', d.messages)}${stat('Images', d.images)}${stat('Reacts', d.reactionsReceived)}
        </div>
        <div style="text-align:center;font-size:11.5px;color:var(--text-dim);margin-bottom:6px">Here since ${fmtDate(d.firstSeen)}</div>
        <div id="up-idreq"></div>
        ${err ? `<div style="color:var(--danger);font-size:11px;margin-top:8px">profile data error: ${utils.escapeHtml(err)}</div>` : ''}
        <div style="color:var(--text-dim);font-size:11px;margin-top:10px">Client IDs are private — shared only by explicit approval · build ${utils.escapeHtml(window.__BUILD || '?')}</div>`;
      currentProfileUsername = d.username;
      currentIdBox = body.querySelector('#up-idreq');
      renderIdSection(currentIdBox, d.username);
      if (opts && opts.focusRequest) setTimeout(() => { const r = body.querySelector('#up-req'); if (r) r.click(); }, 150);
    }
    function refreshIdSection() {
      if (!ov || !ov.classList.contains('open') || !currentIdBox || !currentProfileUsername) return;
      clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => renderIdSection(currentIdBox, currentProfileUsername, { silent: true }), 120);
    }
    return { open, refreshIdSection };
  })();
  window.__ptrRefreshUserProfileIdSection = () => userProfile.refreshIdSection();


  // ── Online-list dropdown (the ONLY entry point to profiles) ────────────────
  let openMenu = null;
  const closeMenu = () => { if (openMenu) { openMenu.remove(); openMenu = null; } };
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-menu-user]');
    if (btn) {
      e.stopPropagation();
      const name = btn.getAttribute('data-menu-user');
      const wasOpen = openMenu && openMenu._for === name;
      closeMenu();
      if (!wasOpen) {
        const menu = document.createElement('div');
        menu.className = 'online-menu';
        menu._for = name;
        menu.innerHTML = '<button type="button" data-act="profile">👤 View profile</button>' +
                         '<button type="button" data-act="req">🔑 Request Client ID</button>';
        const r = btn.getBoundingClientRect();
        menu.style.top = Math.min(r.bottom + 6, innerHeight - 110) + 'px';
        menu.style.right = Math.max(8, innerWidth - r.right) + 'px';
        menu.addEventListener('click', (ev) => {
          const act = (ev.target.closest('button') || {}).dataset ? ev.target.closest('button').dataset.act : null;
          closeMenu();
          if (act === 'profile') userProfile.open(name);
          if (act === 'req') userProfile.open(name, { focusRequest: true });
        });
        document.body.appendChild(menu);
        openMenu = menu;
      }
      return;
    }
    if (openMenu && !e.target.closest('.online-menu')) closeMenu();
  });

  // ── Guided onboarding tour (live demo rooms) ───────────────────────────────
  const tour = (() => {
    const KEY = 'ptr29_tour_done_v1';
    let overlay, spot, card, titleEl, bodyEl, countEl, backBtn, nextBtn, skipBtn;
    let idx = 0, active = false, starting = false, cleaning = false, steps = [];
    let pubRoom = '', privRoom = '', unwatch = null, spotTTimer = null;
    const PEOPLE_BTN_SEL = '#tablet-people-btn';

    const isMobileDev = () => document.body.classList.contains('ptr29-mobile');
    const isTabletDev = () => !isMobileDev() && window.innerWidth >= 769 && window.innerWidth <= 1024;

    // Device-aware target: tablets must point at the 👥 room-bar button —
    // the panel itself is a slide-in that only exists while opened.
    function targetFor(st) {
      const sels = (isTabletDev() && st.tabletPeople)
        ? [PEOPLE_BTN_SEL].concat(st.sel || [])
        : (st.sel || []);
      for (const ssel of sels) {
        const t = document.querySelector(ssel);
        if (t && t.getClientRects().length) return t;
      }
      return null;
    }

    function setWatch(st) {
      if (unwatch) { unwatch(); unwatch = null; }
      if (!st || !st.watch) return;
      const handler = (e) => {
        if (!(e.target && e.target.closest && e.target.closest(st.watch))) return;
        setTimeout(() => { if (active) (idx >= steps.length - 1 ? end(true) : show(idx + 1)); }, 800);
      };
      document.addEventListener('click', handler, true);
      unwatch = () => document.removeEventListener('click', handler, true);
    }
    window.addEventListener('ptr29-room-renamed', (e) => {
      const d = e.detail || {};
      if (pubRoom === d.from) pubRoom = d.to;
      if (privRoom === d.from) privRoom = d.to;
    });

    function openSettings() { if (elements.roomSettingsPanel) elements.roomSettingsPanel.style.display = 'block'; }
    function closeSettings() { if (elements.roomSettingsPanel) elements.roomSettingsPanel.style.display = 'none'; }
    function openTabletPeople() {
      if (!isTabletDev()) return;
      const panel = document.getElementById('online-panel');
      const backdrop = document.getElementById('tablet-people-backdrop');
      if (panel) panel.classList.add('tablet-open');
      if (backdrop) backdrop.classList.add('open');
    }
    function closeTabletPeople() {
      const panel = document.getElementById('online-panel');
      const backdrop = document.getElementById('tablet-people-backdrop');
      const bdrop = backdrop;
      if (panel) panel.classList.remove('tablet-open');
      if (bdrop) bdrop.classList.remove('open');
    }
    async function joinRoom(name) {
      if (!name) return;
      if (state.currentRoom !== name) rooms.join(name);
      await new Promise(r => setTimeout(r, 650));
    }

    const emitP = (ev, p) => new Promise(res => socket.emit(ev, p, res));
    const fakeAvatar = (n) => 'https://api.dicebear.com/7.x/thumbs/svg?seed=' + encodeURIComponent(n);
    const fakePeople = () => [
      { username: 'Nova', avatar: fakeAvatar('Nova'), room: state.currentRoom },
      { username: 'Rex', avatar: fakeAvatar('Rex'), room: state.currentRoom },
    ];
    const fakeIds = ['tour-fake-nova-01', 'tour-fake-rex-01'];
    function refreshOnline() {
      online.update((state.currentRoomPresence || []).concat(state.tourFakes || []));
    }
    function fakeMessage(who, text) {
      messages.render({ id: 'tour-fake-' + Math.random().toString(36).slice(2), username: who, avatar: fakeAvatar(who), message: text, timestamp: Date.now(), type: 'text', reactions: {} });
      const sc = elements.messages; if (sc) sc.scrollTop = sc.scrollHeight;
    }

    function buildSteps() {
      return [
        { title: 'Welcome 🎓', html: 'Sit back — the guide does everything while you watch. Two demo rooms were created; fake volunteers <b>Nova</b> and <b>Rex</b> will help demonstrate. Press <b>Next</b> to continue.' },
        { sel: ['#user-section'], mobile: 'rooms', title: '1 · Account identity', html: 'You entered through the 🔐 account gate — login/register is required before anything else. New signups must confirm 13+, accept Terms, and usernames containing <b>anonymous</b> are blocked.' },
        { sel: ['#room-list'], mobile: 'rooms', title: '2 · Demo rooms', html: `The guide created <b>#${pubRoom}</b> (public) and 🔒 <b>#${privRoom}</b> (private). You own them for this tour; they vanish at the end.` },
        { sel: ['#messages'], mobile: 'chat', run: async () => { closeSettings(); await joinRoom(pubRoom); }, title: '3 · Entering the room', html: 'The guide just walked into the public demo room. Watch the chat panel light up.' },
        { sel: [PEOPLE_BTN_SEL, '#online-panel'], mobile: 'online', tabletPeople: true, before: openTabletPeople, title: '4 · Meet the volunteers', html: '<b>Nova</b> and <b>Rex</b> just appeared in the <span class="show-desktop-only">Online list</span><span class="show-tablet-only">People panel — it slides in from the 👥 button highlighted above</span><span class="show-mobile-only">Online tab</span> — the fake people who help demonstrate management.' },
        { sel: ['#messages'], mobile: 'chat', run: async () => { fakeMessage('Nova', 'Hey! Ready to help with the demo 👋'); }, title: '5 · A message arrives', html: 'That is what incoming messages look like. Safe http/https links can be sent after validation; unsafe/local/risky links are blocked before posting.' },
        { sel: ['#room-settings-panel'], mobile: 'chat', run: async () => { openSettings(); }, title: '6 · Control panel', html: '⚙️ Settings opened. Every management feature lives here — watch the guide use each one on this room.' },
        { sel: ['#rename-input'], run: async () => { await emitP('rename-room', { room: state.currentRoom, newName: 'guided-demo' }); rooms.fetch(); }, title: '7 · Rename (done for you)', html: 'The guide just renamed the room to <b>#guided-demo</b> — see the sidebar update. Owners can rename any room except #general.' },
        { sel: ['#passkey-input'], run: async () => { await emitP('set-room-passkey', { room: state.currentRoom, passkey: 'DEMO-1234' }); if (elements.passkeyInput) elements.passkeyInput.value = 'DEMO-1234'; }, title: '8 · Passkey (done for you)', html: 'A passkey <b>DEMO-1234</b> was generated and saved. Anyone with it can enter once the room is private.' },
        { sel: ['#save-privacy-btn'], run: async () => { await emitP('set-room-privacy', { room: state.currentRoom, isPrivate: true }); rooms.fetch(); }, title: '9 · Going private (done)', html: 'The room is now 🔒 private: only owner / admins / members / passkey-holders get in. Flipping back is the same button.' },
        { sel: ['#room-members-list'], run: async () => { socket.emit('add-room-members', { room: state.currentRoom, members: fakeIds }); await new Promise(r => setTimeout(r, 500)); socket.emit('get-room-meta', { room: state.currentRoom }, () => {}); }, title: '10 · Adding people (done)', html: 'Nova and Rex were just granted private-room access via <b>+ Add User</b> — their chips appear in the users list.' },
        { sel: ['#room-admins-list'], run: async () => { socket.emit('add-room-admins', { room: state.currentRoom, admins: [fakeIds[1]] }); await new Promise(r => setTimeout(r, 500)); socket.emit('get-room-meta', { room: state.currentRoom }, () => {}); }, title: '11 · Promoting an admin', html: 'Rex just became an <b>admin 👑</b> — admins can rename, clear, and manage access. Trust only the right people.' },
        { sel: ['#room-members-list'], run: async () => { socket.emit('remove-room-admin', { room: state.currentRoom, adminId: fakeIds[1] }); await new Promise(r => setTimeout(r, 400)); socket.emit('remove-room-member', { room: state.currentRoom, memberId: fakeIds[1] }); await new Promise(r => setTimeout(r, 400)); socket.emit('get-room-meta', { room: state.currentRoom }, () => {}); }, title: '12 · Removing people', html: 'The guide demoted and removed <b>Rex</b> with the ✕ buttons — access revoked instantly. Add, promote, remove: the full cycle.' },
        { sel: ['#clear-room-btn'], mobile: 'chat', run: async () => { closeSettings(); await window.ChatAPI.clearRoom(state.currentRoom); }, title: '13 · Clearing a room', html: 'The room’s messages were just wiped with <b>Clear</b> (owner/admins only). Messages gone, room intact.' },
        { sel: ['#room-settings-panel'], mobile: 'rooms', run: async () => { await joinRoom(privRoom); openSettings(); }, title: '14 · The private room', html: `Now inside 🔒 <b>#${privRoom}</b> — same controls, already private. Everything you just watched works here too.` },
        { sel: [PEOPLE_BTN_SEL, '#online-panel'], mobile: 'online', tabletPeople: true, before: closeTabletPeople, title: '15 · Volunteers leave', html: 'Nova and Rex left the demo. The <span class="show-desktop-only">Online list</span><span class="show-tablet-only">People panel (reopen it anytime from 👥)</span><span class="show-mobile-only">Online tab</span> always reflects live presence.' },
        { sel: ['#inbox-btn'], title: '16 · Done 🎉', html: '📥 Inbox = Client-ID requests, approvals, denials and Stop sharing · ❓ full guide · 🎓 replay. Finishing now deletes both demo rooms.' },
      ];
    }

    function build() {
      overlay = document.createElement('div'); overlay.id = 'tour-overlay';
      spot = document.createElement('div'); spot.id = 'tour-spot';
      card = document.createElement('div'); card.id = 'tour-card';
      card.innerHTML = '<h4 id="tour-title"></h4><p id="tour-body"></p>' +
        '<div class="tour-nav"><span class="tour-step-count" id="tour-count"></span>' +
        '<button class="secondary" id="tour-skip" type="button">Skip</button>' +
        '<button class="secondary" id="tour-back" type="button">Back</button>' +
        '<button id="tour-next" type="button">Next ➤</button></div>';
      document.body.append(overlay, spot, card);
      titleEl = card.querySelector('#tour-title');
      bodyEl  = card.querySelector('#tour-body');
      countEl = card.querySelector('#tour-count');
      backBtn = card.querySelector('#tour-back');
      nextBtn = card.querySelector('#tour-next');
      skipBtn = card.querySelector('#tour-skip');
      nextBtn.addEventListener('click', async () => {
        if (!active || nextBtn.disabled) return;
        idx >= steps.length - 1 ? end(true) : await show(idx + 1);
      });
      backBtn.addEventListener('click', async () => {
        if (!active || backBtn.disabled) return;
        await show(Math.max(0, idx - 1));
      });
      skipBtn.addEventListener('click', () => end(true));
      window.addEventListener('resize', () => { if (active) place(); });
      window.addEventListener('keydown', (e) => {
        if (!active) return;
        if (e.key === 'Escape') { end(true); }
        else if (e.key === 'ArrowRight' || e.key === 'Enter') { nextBtn.click(); }
        else if (e.key === 'ArrowLeft') { backBtn.click(); }
      });
    }

    function place() {
      const st = steps[idx];
      if (!st) return;
      const isMobile = isMobileDev();
      if (st.mobile && isMobile) setMobileView(st.mobile);
      const target = targetFor(st);
      if (target) {
        try { target.scrollIntoView({ block: 'nearest' }); } catch {}
        const r = target.getBoundingClientRect();
        const pad = 6;
        spot.style.left   = (r.left - pad) + 'px';
        spot.style.top    = (r.top - pad) + 'px';
        spot.style.width  = (r.width + pad * 2) + 'px';
        spot.style.height = (r.height + pad * 2) + 'px';
        spot.style.display = 'block';
        spot.classList.add('tour-pulse');
      } else {
        spot.style.display = 'none';
        spot.classList.remove('tour-pulse');
      }
      titleEl.textContent = st.title;
      bodyEl.innerHTML = st.html;
      countEl.textContent = (idx + 1) + ' / ' + steps.length;
      backBtn.style.display = idx === 0 ? 'none' : '';
      nextBtn.textContent = idx === steps.length - 1 ? 'Finish 🎉' : 'Next ➤';
      // Fade the card out during repositioning, then settle it in place
      card.classList.add('hidden');
      requestAnimationFrame(() => {
        const cw = card.offsetWidth, ch = card.offsetHeight;
        if (isMobile) {
          card.style.left = '12px'; card.style.right = '12px';
          card.style.width = 'auto'; card.style.top = 'auto';
          card.style.bottom = 'calc(var(--mobile-nav-h, 56px) + 12px)';
        } else {
          card.style.right = 'auto'; card.style.width = 'min(360px, 92vw)';
          let top, left;
          if (target) {
            const r = target.getBoundingClientRect();
            top = r.bottom + 14;
            if (top + ch > innerHeight - 12) top = Math.max(12, r.top - ch - 14);
            left = Math.min(Math.max(12, r.left), Math.max(12, innerWidth - cw - 12));
          } else {
            top = Math.max(12, (innerHeight - ch) / 2);
            left = Math.max(12, (innerWidth - cw) / 2);
          }
          card.style.top = top + 'px'; card.style.left = left + 'px';
          card.style.bottom = 'auto';
        }
        requestAnimationFrame(() => card.classList.remove('hidden'));
      });
    }

    async function show(i) {
      if (!steps.length) return;
      idx = Math.max(0, Math.min(i, steps.length - 1));
      active = true;
      overlay.classList.add('open');
      card.style.display = 'block';
      const st = steps[idx];
      setWatch(st);
      if (nextBtn) nextBtn.disabled = true;
      if (backBtn) backBtn.disabled = true;
      if (skipBtn) skipBtn.disabled = true;
      if (st && st.before) { try { await st.before(); } catch (e) { console.warn('tour before failed', e); } await new Promise(r => setTimeout(r, 150)); }
      if (st && st.run) { try { await st.run(); } catch (e) { console.warn('tour step failed', e); } await new Promise(r => setTimeout(r, 300)); }
      if (active) place();
      if (nextBtn) nextBtn.disabled = false;
      if (backBtn) backBtn.disabled = false;
      if (skipBtn) skipBtn.disabled = false;
    }

    async function setup() {
      state.tourMode = true;
      try {
        const left = await window.ChatAPI.tourRooms();
        for (const n of left || []) { try { await window.ChatAPI.deleteRoom(n); } catch {} }
      } catch (e) { console.warn('tour stale cleanup failed', e); }
      const suf = Math.random().toString(36).slice(2, 7);
      pubRoom = 'tour-public-' + suf;
      privRoom = 'tour-private-' + suf;
      const pub = await window.ChatAPI.createRoom(pubRoom, false).catch(e => ({ ok: false, error: e && e.message }));
      const priv = await window.ChatAPI.createRoom(privRoom, true).catch(e => ({ ok: false, error: e && e.message }));
      if ((pub && pub.ok === false) || (priv && priv.ok === false)) {
        console.warn('tour room creation warning', pub, priv);
      }
      rooms.fetch();
      await new Promise(r => setTimeout(r, 500));
    }

    function cleanup() {
      if (cleaning) return;
      cleaning = true;
      state.tourMode = false;
      state.tourFakes = [];
      if (spotTTimer) { clearTimeout(spotTTimer); spotTTimer = null; }
      closeSettings();
      closeTabletPeople();
      const a = pubRoom, b = privRoom;
      pubRoom = privRoom = '';
      if (state.currentRoom === a || state.currentRoom === b) {
        const stored = utils.loadFromStorage(CONSTANTS.STORAGE_KEY, {});
        if (stored.username) { rooms.join('general'); }
        else {
          state.currentRoom = 'general'; state.joined = false;
          if (elements.messages) elements.messages.innerHTML = '';
          if (elements.roomName) elements.roomName.textContent = '#general';
        }
      }
      if (a) socket.emit('leave', { room: a });
      if (b) socket.emit('leave', { room: b });
      if (a) window.ChatAPI.deleteRoom(a).catch(() => {});
      if (b) window.ChatAPI.deleteRoom(b).catch(() => {});
      setTimeout(() => { rooms.fetch(); cleaning = false; }, 400);
    }

    function end(done) {
      active = false;
      starting = false;
      setWatch(null);
      if (overlay) overlay.classList.remove('open');
      if (spot) { spot.style.display = 'none'; spot.classList.remove('tour-pulse'); }
      if (card) { card.style.display = 'none'; card.classList.remove('hidden'); }
      if (done) { try { localStorage.setItem(KEY, '1'); } catch {} }
      cleanup();
    }

    async function start() {
      if (starting) return;
      starting = true;
      try {
        if (active) end(false);
        if (!overlay) build();
        if (!window.ChatAPI || window.ChatAPI._offline) { showToast('Tour needs the backend connection. Reload and try again.', 'error'); return; }
        await setup();
        steps = buildSteps();
        idx = 0;
        await show(0);
      } catch (e) {
        console.error('Tour failed:', e);
        showToast('Could not start the guided tour. Please reload and try again.', 'error');
        cleanup();
      } finally {
        starting = false;
      }
    }
    return { start, end };
  })();

  // Replay entry inside the help modal
  const helpInner = document.querySelector('.help-modal-inner');
  if (helpInner && !document.getElementById('tour-replay-btn')) {
    const tb = document.createElement('button');
    tb.id = 'tour-replay-btn'; tb.type = 'button'; tb.className = 'secondary';
    tb.textContent = '▶ Replay guided tour';
    tb.style.margin = '10px 0 0';
    tb.addEventListener('click', () => {
      document.getElementById('help-modal').classList.remove('open');
      setTimeout(() => tour.start(), 250);
    });
    helpInner.appendChild(tb);
  }

  // Dedicated header button — second way into the live tour
  const tourBtn = document.getElementById('tour-btn');
  if (tourBtn) tourBtn.addEventListener('click', () => tour.start());

  // ── Accounts: gate, login, register, logout ──────────────────────────────
  const ACCOUNT_KEY = 'ptr29_account_session';
  const TOUR_PENDING_KEY = 'ptr29_tour_pending_after_signup_v1';
  const getAccountSession = () => { try { return JSON.parse(localStorage.getItem(ACCOUNT_KEY) || 'null'); } catch { return null; } };

  // Every id that legitimately means "me" on this device.
  function myIds() {
    const out = [];
    const push = (v) => { const s = String(v || '').trim(); if (s && !out.includes(s)) out.push(s); };
    push(state.myClientId);
    if (window.ChatAPI) { push(window.ChatAPI.uid); push(window.ChatAPI._clientId); push(window.ChatAPI._accountId); }
    const sess = getAccountSession();
    if (sess && sess.id) push(sess.id);
    return out;
  }
  function isMine(id) { const v = String(id || '').trim(); return !!v && myIds().includes(v); }
  function isMineAny(ids) { return Array.isArray(ids) && ids.some((x) => isMine(x)); }

  // One-time repair: rooms created on this browser before the identity fix were
  // stored with owner_id = the browser's anonymous auth uid, so they showed a
  // previous account as owner. The server only lets an account claim rooms whose
  // owner_id is that browser's own uid, so this cannot take someone else's room.
  const ROOMS_CLAIMED_KEY = 'ptr29_rooms_claimed_v1_';
  async function claimRoomsFor(sess) {
    if (!sess || !sess.id || !window.ChatAPI || !window.ChatAPI.claimRooms) return;
    const flag = ROOMS_CLAIMED_KEY + sess.id;
    try { if (localStorage.getItem(flag) === '1') return; } catch {}
    const res = await window.ChatAPI.claimRooms(sess.id).catch(() => null);
    if (res && res.ok) {
      try { localStorage.setItem(flag, '1'); } catch {}
      if (res.rooms) {
        showToast('Re-assigned ' + res.rooms + ' room' + (res.rooms === 1 ? '' : 's') +
          ' you created under an older login to ' + (sess.username || 'this account') + '.', 'success');
        if (window.ChatAPI.refreshRooms) window.ChatAPI.refreshRooms();
        if (typeof rooms !== 'undefined' && rooms.refreshRoomMeta) { try { rooms.refreshRoomMeta(); } catch {} }
      }
    }
  }
  async function sha256hex(str) {
    try {
      const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
      return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
    } catch { return null; }
  }
  function el(tag, attrs) {
    const n = document.createElement(tag);
    if (attrs) for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') n.className = v; else n.setAttribute(k, v);
    }
    return n;
  }
  const BRAND_SVG = '<svg viewBox="0 0 48 48" width="34" height="34" aria-hidden="true"><defs><linearGradient id="ptr29g2" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#22d3ee"/><stop offset=".55" stop-color="#3b82f6"/><stop offset="1" stop-color="#a855f7"/></linearGradient></defs><path d="M24 5C13 5 4 12.8 4 22.4c0 5.4 2.9 10.2 7.5 13.4-.2 2.9-1.4 5.5-3.4 7.5 4.4-.4 8.2-1.8 10.9-3.7 1.6.3 3.3.5 5 .5 11 0 20-7.8 20-17.4S35 5 24 5z" fill="none" stroke="url(#ptr29g2)" stroke-width="3.2" stroke-linejoin="round"/><path d="M26.8 13.5 18.6 25h5.6l-2.3 9.5L30.4 22h-5.6l2-8.5z" fill="url(#ptr29g2)"/></svg>';

  function showAuthGate(message = '') {
    let mode = 'login';
    const ov = el('div', { class: 'ag-overlay', id: 'ag-overlay' });
    ov.innerHTML = `
      <div class="ag-card" role="dialog" aria-modal="true" aria-label="REPLICA account">
        <div class="ag-brand">${BRAND_SVG}<div class="ag-title">ptr_29 <b>Chat</b></div></div>
        <p class="ag-sub">Your content follows your <b>account</b> across devices. Passwords are SHA-256-salted on this device, then <b>bcrypt-hashed with a server-side pepper</b> — hashes stay unreadable through the API and logins are rate-limited.</p>
        <div class="ag-tabs">
          <button type="button" class="ag-tab active" data-m="login">Log in</button>
          <button type="button" class="ag-tab" data-m="reg">Create account</button>
        </div>
        <input id="ag-user" placeholder="Username" autocomplete="username">
        <div id="ag-user-note" style="display:none;font-size:11.5px;color:var(--text-dim);line-height:1.35;margin:-4px 0 10px">
          Email-style usernames such as <b>name@gmail.com</b> are allowed, but they are treated only as usernames — no email verification, email login, or password recovery is provided. Names containing “anonymous” are not allowed.
        </div>
        <input id="ag-pass" type="password" placeholder="Password" autocomplete="current-password">
        <label id="ag-age-row" style="display:none;align-items:flex-start;gap:8px;font-size:12px;color:var(--text-muted);line-height:1.35;margin:-2px 0 10px">
          <input id="ag-age" type="checkbox" style="margin-top:2px">
          <span>I confirm I am at least 13 years old. Children under 13 may not create an account.</span>
        </label>
        <label id="ag-terms-row" style="display:none;align-items:flex-start;gap:8px;font-size:12px;color:var(--text-muted);line-height:1.35;margin:-2px 0 10px">
          <input id="ag-terms" type="checkbox" style="margin-top:2px">
          <span>I agree to the <a href="terms.html" target="_blank" rel="noopener noreferrer" style="color:var(--accent);text-decoration:none">Terms and Conditions</a> and <a href="privacy.html" target="_blank" rel="noopener noreferrer" style="color:var(--accent);text-decoration:none">Privacy Policy</a>.</span>
        </label>
        <div id="ag-err" class="ag-err"></div>
        <button id="ag-go" class="ag-go" type="button">Continue ➤</button>
        <div class="ag-foot">🔒 No plaintext passwords ever stored</div>
      </div>`;
    document.body.append(ov);
    if (message) {
      const err = ov.querySelector('#ag-err');
      if (err) err.textContent = message;
    }
    try { document.body.style.overflow = 'hidden'; } catch {}
    ov.querySelectorAll('.ag-tab').forEach(b => b.addEventListener('click', () => {
      mode = b.dataset.m;
      ov.querySelectorAll('.ag-tab').forEach(x => x.classList.toggle('active', x === b));
      const p = ov.querySelector('#ag-pass');
      const ageRow = ov.querySelector('#ag-age-row');
      const termsRow = ov.querySelector('#ag-terms-row');
      const userNote = ov.querySelector('#ag-user-note');
      p.placeholder = mode === 'reg' ? 'Strong password (8+ chars, upper/lower/number/symbol)' : 'Password';
      p.setAttribute('autocomplete', mode === 'reg' ? 'new-password' : 'current-password');
      if (ageRow) ageRow.style.display = mode === 'reg' ? 'flex' : 'none';
      if (termsRow) termsRow.style.display = mode === 'reg' ? 'flex' : 'none';
      if (userNote) userNote.style.display = mode === 'reg' ? 'block' : 'none';
    }));
    ov.querySelector('#ag-go').addEventListener('click', async () => {
      const un = ov.querySelector('#ag-user').value.trim();
      const pw = ov.querySelector('#ag-pass').value;
      const err = ov.querySelector('#ag-err');
      const btn = ov.querySelector('#ag-go');
      err.textContent = '';
      if (!un || !pw) { err.textContent = 'Enter username and password.'; return; }
      if (utils.isReservedUsername(un)) { err.textContent = 'Usernames containing "anonymous" are not allowed.'; return; }
      if (mode === 'reg') {
        const pwCheck = utils.validatePassword(pw, un);
        if (!pwCheck.ok) { err.textContent = pwCheck.message; return; }
        if (!ov.querySelector('#ag-age')?.checked) { err.textContent = 'Confirm you are at least 13 years old to create an account.'; return; }
        if (!ov.querySelector('#ag-terms')?.checked) { err.textContent = 'You must agree to the Terms and Conditions to create an account.'; return; }
      } else if (pw.length < 6) { err.textContent = 'Password too short.'; return; }
      const h = await sha256hex(pw + ':' + un.toLowerCase());
      if (!h) { err.textContent = 'Crypto unavailable in this browser.'; return; }
      btn.disabled = true;
      btn.textContent = mode === 'reg' ? 'Creating account…' : 'Logging in…';
      const res = mode === 'login'
        ? await window.ChatAPI.accountLogin(un, h)
        : await window.ChatAPI.accountRegister(un, h, true, true);
      btn.disabled = false;
      btn.textContent = 'Continue ➤';
      if (!res || !res.ok) {
        const map = {
          taken: 'That username already has an account — log in instead.',
          invalid_credentials: 'Wrong username or password.',
          locked: 'Too many failed attempts — locked for 15 minutes.',
          invalid_username: 'Invalid username. Usernames containing anonymous are not allowed.',
          age_required: 'You must confirm you are at least 13 years old to create an account.',
          terms_required: 'You must agree to the Terms and Conditions to create an account.',
        };
        err.textContent = (map[res && res.error]) || (res && res.error) || 'Failed.';
        return;
      }
      try {
        const accountSession = {
          id: res.id,
          username: res.username,
          ageConfirmed: mode === 'reg' ? true : !!res.age_confirmed,
          termsAccepted: mode === 'reg' ? true : !!res.terms_accepted,
          avatar: res.avatar || ''
        };
        localStorage.setItem(ACCOUNT_KEY, JSON.stringify(accountSession));
        localStorage.setItem(CONSTANTS.CLIENT_ID_KEY, res.id);
        localStorage.removeItem(CONSTANTS.CLIENT_ID_ISSUED_KEY);
        utils.saveToStorage(CONSTANTS.STORAGE_KEY, {
          username: res.username,
          avatar: res.avatar || '',
          termsAgreed: accountSession.termsAccepted
        });
        localStorage.removeItem(CONSTANTS.PASSKEYS_KEY);
        localStorage.removeItem(CONSTANTS.UNREAD_KEY);
        localStorage.removeItem(CONSTANTS.INBOX_SEEN_KEY);
        if (mode === 'reg') sessionStorage.setItem(TOUR_PENDING_KEY, '1');
      } catch {}
      location.reload();
    });
    const u = ov.querySelector('#ag-user');
    if (u) u.focus();
  }

  function waitForChatAPIReady(timeoutMs = 5000) {
    return new Promise(resolve => {
      const started = Date.now();
      const tick = () => {
        if (!window.ChatAPI || window.ChatAPI.ready || window.ChatAPI._offline || Date.now() - started > timeoutMs) return resolve();
        setTimeout(tick, 80);
      };
      tick();
    });
  }

  function showAgeVerifyGate(sess) {
    return new Promise(resolve => {
      const ov = el('div', { class: 'ag-overlay', id: 'ag-age-overlay' });
      ov.innerHTML = `
        <div class="ag-card" role="dialog" aria-modal="true" aria-label="Age verification">
          <div class="ag-brand">${BRAND_SVG}<div class="ag-title">Age verification</div></div>
          <p class="ag-sub">Before continuing, this existing account must confirm the age requirement.</p>
          <label style="display:flex;align-items:flex-start;gap:8px;font-size:13px;color:var(--text);line-height:1.4;margin:8px 0 12px">
            <input id="ag-existing-age" type="checkbox" style="margin-top:2px">
            <span>I confirm I am at least 13 years old. Children under 13 may not create an account or use this service.</span>
          </label>
          <div id="ag-age-err" class="ag-err"></div>
          <button id="ag-age-go" class="ag-go" type="button">Confirm and continue ➤</button>
          <button id="ag-age-logout" class="secondary" type="button" style="width:100%;margin-top:8px">Log out instead</button>
        </div>`;
      document.body.append(ov);
      try { document.body.style.overflow = 'hidden'; } catch {}
      ov.querySelector('#ag-age-logout').addEventListener('click', async () => { ov.remove(); await logout(); });
      ov.querySelector('#ag-age-go').addEventListener('click', async () => {
        const err = ov.querySelector('#ag-age-err');
        const btn = ov.querySelector('#ag-age-go');
        err.textContent = '';
        if (!ov.querySelector('#ag-existing-age')?.checked) { err.textContent = 'Confirm you are at least 13 years old to continue.'; return; }
        btn.disabled = true; btn.textContent = 'Saving…';
        const res = await window.ChatAPI.accountConfirmAge(sess.id);
        btn.disabled = false; btn.textContent = 'Confirm and continue ➤';
        if (!res || !res.ok) {
          const code = res && res.error;
          if (code === 'forbidden' || code === 'not_authenticated') {
            err.textContent = 'Please log in again to verify this older account securely.';
            try { localStorage.removeItem(ACCOUNT_KEY); localStorage.removeItem(CONSTANTS.CLIENT_ID_KEY); } catch {}
            setTimeout(() => location.reload(), 1200);
            return;
          }
          err.textContent = code || 'Failed to save age confirmation.';
          return;
        }
        try { localStorage.setItem(ACCOUNT_KEY, JSON.stringify({ ...sess, ageConfirmed: true })); } catch {}
        ov.remove();
        try { document.body.style.overflow = ''; } catch {}
        resolve(true);
      });
    });
  }

  function showTermsVerifyGate(sess) {
    return new Promise(resolve => {
      const ov = el('div', { class: 'ag-overlay', id: 'ag-terms-overlay' });
      ov.innerHTML = `
        <div class="ag-card" role="dialog" aria-modal="true" aria-label="Terms and Privacy verification">
          <div class="ag-brand">${BRAND_SVG}<div class="ag-title">Terms & Privacy</div></div>
          <p class="ag-sub">Before continuing, this existing account must accept the current Terms and Privacy Policy.</p>
          <label style="display:flex;align-items:flex-start;gap:8px;font-size:13px;color:var(--text);line-height:1.4;margin:8px 0 12px">
            <input id="ag-existing-terms" type="checkbox" style="margin-top:2px">
            <span>I agree to the <a href="terms.html" target="_blank" rel="noopener noreferrer" style="color:var(--accent);text-decoration:none">Terms and Conditions</a> and <a href="privacy.html" target="_blank" rel="noopener noreferrer" style="color:var(--accent);text-decoration:none">Privacy Policy</a>.</span>
          </label>
          <div id="ag-terms-err" class="ag-err"></div>
          <button id="ag-terms-go" class="ag-go" type="button">Accept and continue ➤</button>
          <button id="ag-terms-logout" class="secondary" type="button" style="width:100%;margin-top:8px">Log out instead</button>
        </div>`;
      document.body.append(ov);
      try { document.body.style.overflow = 'hidden'; } catch {}
      ov.querySelector('#ag-terms-logout').addEventListener('click', async () => { ov.remove(); await logout(); });
      ov.querySelector('#ag-terms-go').addEventListener('click', async () => {
        const err = ov.querySelector('#ag-terms-err');
        const btn = ov.querySelector('#ag-terms-go');
        err.textContent = '';
        if (!ov.querySelector('#ag-existing-terms')?.checked) { err.textContent = 'You must agree to the Terms and Privacy Policy to continue.'; return; }
        btn.disabled = true; btn.textContent = 'Saving…';
        const res = await window.ChatAPI.accountConfirmTerms(sess.id);
        btn.disabled = false; btn.textContent = 'Accept and continue ➤';
        if (!res || !res.ok) {
          const code = res && res.error;
          if (code === 'forbidden' || code === 'not_authenticated') {
            err.textContent = 'Please log in again to accept Terms securely.';
            clearLocalAccountState();
            setTimeout(() => location.reload(), 1200);
            return;
          }
          err.textContent = code || 'Failed to save Terms acceptance.';
          return;
        }
        try {
          localStorage.setItem(ACCOUNT_KEY, JSON.stringify({ ...sess, termsAccepted: true }));
          const prof = utils.loadFromStorage(CONSTANTS.STORAGE_KEY, {});
          utils.saveToStorage(CONSTANTS.STORAGE_KEY, { ...prof, termsAgreed: true });
        } catch {}
        ov.remove();
        try { document.body.style.overflow = ''; } catch {}
        resolve(true);
      });
    });
  }

  async function ensureExistingAccountTermsAccepted(sess) {
    if (!sess || !sess.id) return true;
    // Always ask Supabase. Local session flags are only cache and must not be
    // allowed to skip the required Terms gate.
    if (!window.ChatAPI || !window.ChatAPI.accountTermsStatus) return showTermsVerifyGate(sess);
    await waitForChatAPIReady();
    const status = await window.ChatAPI.accountTermsStatus(sess.id).catch(e => ({ ok: false, error: String(e && e.message || e || 'terms_status_failed') }));
    if (status && status.ok && status.terms_accepted) {
      try {
        localStorage.setItem(ACCOUNT_KEY, JSON.stringify({ ...sess, termsAccepted: true }));
        const prof = utils.loadFromStorage(CONSTANTS.STORAGE_KEY, {});
        utils.saveToStorage(CONSTANTS.STORAGE_KEY, { ...prof, termsAgreed: true });
      } catch {}
      return true;
    }
    if (status && status.ok === false) {
      const code = String(status.error || '');
      if (code === 'forbidden' || code === 'not_authenticated') {
        clearLocalAccountState();
        showAuthGate('For security, this older account must log in again before Terms acceptance can be saved.');
        return false;
      }
      if (/function|schema|rpc|not found|PGRST/i.test(code)) {
        showAuthGate('Terms verification needs the latest Supabase SQL migration. Please run 026, then log in again.');
        return false;
      }
    }
    return showTermsVerifyGate(sess);
  }

  async function ensureExistingAccountAgeVerified(sess) {
    if (!sess || !sess.id) return true;
    // Always ask Supabase. Local session flags are only cache and must not be
    // allowed to skip the required 13+ age gate.
    if (!window.ChatAPI || !window.ChatAPI.accountAgeStatus) return showAgeVerifyGate(sess);
    await waitForChatAPIReady();
    const status = await window.ChatAPI.accountAgeStatus(sess.id).catch(e => ({ ok: false, error: String(e && e.message || e || 'age_status_failed') }));
    if (status && status.ok && status.age_confirmed) {
      try { localStorage.setItem(ACCOUNT_KEY, JSON.stringify({ ...sess, ageConfirmed: true })); } catch {}
      return true;
    }
    if (status && status.ok === false) {
      const code = String(status.error || '');
      if (code === 'forbidden' || code === 'not_authenticated') {
        try { localStorage.removeItem(ACCOUNT_KEY); localStorage.removeItem(CONSTANTS.CLIENT_ID_KEY); } catch {}
        showAuthGate('For security, this older account must log in again before age verification can be saved.');
        return false;
      }
      if (/function|schema|rpc|not found|PGRST/i.test(code)) {
        showAuthGate('Age verification needs the latest Supabase SQL migration. Please run 017, then log in again.');
        return false;
      }
    }
    return showAgeVerifyGate(sess);
  }

  async function hydrateAccountSessionProfile(sess) {
    const out = { ...(sess || {}) };
    if (!out || !out.id) return out;
    let avatar = String(out.avatar || '').trim();
    try {
      const currentProfile = utils.loadFromStorage(CONSTANTS.STORAGE_KEY, {});
      const sameUser = String(currentProfile.username || '').trim().toLowerCase() === String(out.username || '').trim().toLowerCase();
      if (!avatar && sameUser && currentProfile.avatar) avatar = String(currentProfile.avatar || '').trim();
    } catch {}
    if (!avatar && window.ChatAPI && window.ChatAPI.accountProfile) {
      try {
        const prof = await window.ChatAPI.accountProfile(out.id, out.username);
        if (prof && prof.ok && prof.avatar) avatar = String(prof.avatar || '').trim();
      } catch {}
    }
    out.avatar = avatar || '';
    try { localStorage.setItem(ACCOUNT_KEY, JSON.stringify(out)); } catch {}
    return out;
  }

  function clearLocalAccountState() {
    try {
      [
        ACCOUNT_KEY,
        CONSTANTS.STORAGE_KEY,
        CONSTANTS.CLIENT_ID_KEY,
        CONSTANTS.CLIENT_ID_ISSUED_KEY,
        CONSTANTS.PASSKEYS_KEY,
        CONSTANTS.UNREAD_KEY,
        CONSTANTS.INBOX_SEEN_KEY,
      ].forEach(k => localStorage.removeItem(k));
    } catch {}
  }

  async function logout() {
    const sess = getAccountSession();
    try {
      if (window.ChatAPI && window.ChatAPI.accountLogout) await window.ChatAPI.accountLogout(sess && sess.id);
    } catch {}
    clearLocalAccountState();
    location.reload();
  }

  // Gated startup: no account session → auth gate blocks the whole app
  (async () => {
    let sess = getAccountSession();
    if (!sess) { showAuthGate(); return; }
    if (utils.isReservedUsername(sess.username)) {
      clearLocalAccountState();
      showAuthGate('This username is no longer allowed because it contains "anonymous". Please use another account.');
      return;
    }
    sess = await hydrateAccountSessionProfile(sess);
    if (utils.isReservedUsername(sess.username)) {
      clearLocalAccountState();
      showAuthGate('This username is no longer allowed because it contains "anonymous". Please use another account.');
      return;
    }
    const ageOk = await ensureExistingAccountAgeVerified(sess);
    if (!ageOk) return;
    sess = getAccountSession() || sess;
    const termsOk = await ensureExistingAccountTermsAccepted(sess);
    if (!termsOk) return;
    sess = getAccountSession() || sess;
    try { localStorage.setItem(CONSTANTS.CLIENT_ID_KEY, sess.id); } catch {}
    // Always adopt the authenticated account identity for this browser session.
    // This prevents a previously logged-out account's cached local profile from
    // being reused when the user logs into a different account on any device.
    try {
      utils.saveToStorage(CONSTANTS.STORAGE_KEY, {
        username: sess.username || '',
        avatar: sess.avatar || '',
        termsAgreed: !!sess.termsAccepted,
      });
      localStorage.removeItem(CONSTANTS.CLIENT_ID_ISSUED_KEY);
    } catch {}
    if (window.ChatAPI && window.ChatAPI.setClientId) window.ChatAPI.setClientId(sess.id);
    if (window.ChatAPI && window.ChatAPI.setAccountId) window.ChatAPI.setAccountId(sess.id);
    if (window.ChatAPI && window.ChatAPI.syncIdentityRow) window.ChatAPI.syncIdentityRow();
    claimRoomsFor(sess);
    document.getElementById('logout-btn')?.addEventListener('click', logout);
    init();
    initMobile();  // Run after init
    // Launch the tour once after a successful new account creation only.
    // Do not auto-create tour rooms on ordinary login/relogin.
    try {
      if (sessionStorage.getItem(TOUR_PENDING_KEY) === '1') {
        sessionStorage.removeItem(TOUR_PENDING_KEY);
        setTimeout(() => tour.start(), 900);
      }
    } catch {}
  })();

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js?v=260831b').catch(() => {});
    });
  }
})();
