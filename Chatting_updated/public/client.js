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
    editUsername:     document.getElementById('edit-username'),
    editAvatar:       document.getElementById('edit-avatar'),
    avatarUploadBtn:  document.getElementById('avatar-upload-btn'),
    avatarFile:       document.getElementById('avatar-file'),
    editProfileBtn:   document.getElementById('edit-profile-btn'),
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
    DEFAULT_AVATAR:'https://api.dicebear.com/7.x/thumbs/svg?seed=',
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

    truncate: (str, maxLen) => {
      const s = String(str ?? '');
      return s.length > maxLen ? s.slice(0, maxLen) + '…' : s;
    },

    formatFileSize: (bytes) => {
      if (bytes < 1024) return bytes + ' B';
      if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
      return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    },

    renderMarkdown: (text) => {
      try {
        let safe = utils.escapeHtml(text);
        // Bold: **text** — replace first so double-* is consumed before italic pass
        safe = safe.replace(/\*\*([^*<>]+)\*\*/g, '<strong>$1</strong>');
        // Italic: *text* — only remaining single * pairs after bold consumed
        safe = safe.replace(/\*([^*<>]+)\*/g, '<em>$1</em>');
        // @mentions
        safe = safe.replace(/@([\w.-]+)/g, '<span class="mention">@$1</span>');
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

    save: (username, avatar, termsAgreed = true) => {
      const prev = utils.loadFromStorage(CONSTANTS.STORAGE_KEY, {});
      const oldUsername = String(prev.username || '').trim();
      const oldClientId = state.myClientId;
      const newName = String(username || '').trim();
      const renamed = !!(oldUsername && newName && oldUsername !== newName);
      const data = { username, avatar, termsAgreed };
      utils.saveToStorage(CONSTANTS.STORAGE_KEY, data);
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

    // Validate then save; returns a Promise<boolean>
    validateAndSave: (username, avatar, termsAgreed = true) => new Promise((resolve) => {
      const val = String(username || '').trim();
      if (!val || val.length < 2) {
        showToast('Username must be at least 2 characters', 'error');
        return resolve(false);
      }
      if (val.toLowerCase() === 'anonymous') {
        showToast('"Anonymous" is reserved — please choose another name', 'error');
        return resolve(false);
      }
      socket.emit('check-username', { username: val }, (resp) => {
        const saved = utils.loadFromStorage(CONSTANTS.STORAGE_KEY, {});
        const isOwnSaved = String(saved.username || '').trim().toLowerCase() === val.toLowerCase();
        if (!resp || (!resp.available && !isOwnSaved)) {
          showToast('Username already taken — please choose another', 'error');
          return resolve(false);
        }
        const oldU = String(saved.username || '').trim();
        const willRename = !!(oldU && oldU.toLowerCase() !== val.toLowerCase());
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
        if (un && window.ChatAPI.purgeMessagesFor) {
          try { await window.ChatAPI.purgeMessagesFor(un); } catch (e) {}
        }
        const ok = await window.ChatAPI.deleteUser();
        if (ok) {
          [CONSTANTS.STORAGE_KEY, CONSTANTS.CLIENT_ID_KEY, CONSTANTS.PASSKEYS_KEY, CONSTANTS.UNREAD_KEY]
            .forEach(k => localStorage.removeItem(k));
          showToast('Profile and all messages under "' + (un || 'your name') + '" removed.', 'success');
          setTimeout(() => window.location.reload(), 1500);
        } else {
          showToast('Failed to delete profile data', 'error');
        }
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
      const isOwner = meta.ownerId === state.myClientId;
      const isAdmin = (meta.admins || []).includes(state.myClientId);
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
              const isOwnerChip = meta.ownerId === u.clientId;
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
    if (msg.clientId === state.myClientId) {
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
    if (el.dataset.clientId === state.myClientId) {
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
      const bodyHtml = (msg.type === 'image' || fileIsImage)
        ? `<img class="msg-image" src="${msg.dataUrl || msg.imageUrl || msg.fileUrl || ''}" alt="Shared image" loading="lazy">`
        : msg.type === 'file'
          ? `<a class="file-attachment" href="${msg.fileUrl || '#'}" download="${utils.escapeHtml(msg.message || 'file')}" target="_blank" rel="noopener"><span>📎</span><span>${utils.escapeHtml(msg.message || 'File')}</span>${msg.fileSize ? `<span style="color:var(--text-dim);font-size:11px">${utils.formatFileSize(msg.fileSize)}</span>` : ''}</a>`
          : `<span class="msg-content">${utils.renderMarkdown(msg.message || '')}</span>`;

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
        ? `<div class="receipts">✓ Read by ${readByOthers.map(r => utils.escapeHtml(r.username)).join(', ')}</div>`
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
    edit: (id, newText) => socket.emit('edit-message', { messageId: id, text: newText }),
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
      div.textContent = (isMyMsg && readByOthers.length > 0) ? `✓ Read by ${readByOthers.map(r=>r.username).join(', ')}` : '';
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

  // ── Online users ───────────────────────────────────────────────────────────
  const online = {
    update: (users) => {
      if (!elements.onlineList) return;
      setTimeout(() => offline.refresh(), 250);
      elements.onlineList.innerHTML = '';
      const listAll = (users || []).concat(state.tourMode ? (state.tourFakes || []) : []);
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
      if (idIssued === 'rename') {
        state.myClientId = utils.getOrCreateClientId();
      } else if (window.ChatAPI && window.ChatAPI.uid) {
        state.myClientId = window.ChatAPI.uid;
        try { localStorage.setItem(CONSTANTS.CLIENT_ID_KEY, window.ChatAPI.uid); } catch {}
      } else {
        state.myClientId = utils.getOrCreateClientId();
      }
      if (window.ChatAPI && window.ChatAPI.setClientId) window.ChatAPI.setClientId(state.myClientId);
      try { const d = JSON.parse(localStorage.getItem(CONSTANTS.STORAGE_KEY) || '{}'); state.myUsername = d.username || ''; } catch {}
      // keep the server-side profile row (name + avatar) in sync
      if (state.myUsername) socket.emit('update-profile', { room: state.currentRoom, username: state.myUsername, avatar: (utils.loadFromStorage(CONSTANTS.STORAGE_KEY, {}) || {}).avatar || '' });
      // tab closed -> offline; tab open -> online even without a room
      window.addEventListener('pagehide', () => { if (window.ChatAPI.goOffline) window.ChatAPI.goOffline(); });
      window.addEventListener('beforeunload', () => { if (window.ChatAPI.goOffline) window.ChatAPI.goOffline(); });
      setInterval(() => offline.refresh(), 60000);
      const setPeopleView = (off) => {
        const ol = document.getElementById('online-list'), of = document.getElementById('offline-list');
        if (ol) ol.hidden = !!off;
        if (of) of.hidden = !off;
        const b1 = document.getElementById('show-online-btn'), b2 = document.getElementById('show-offline-btn');
        if (b1) b1.classList.toggle('active', !off);
        if (b2) b2.classList.toggle('active', !!off);
        if (off) offline.refresh();
      };
      const psBox = document.getElementById('people-search');
      if (psBox) psBox.addEventListener('input', () => {
        state.peopleQuery = psBox.value.trim();
        online.update(state.lastPresenceUsers || []);
        offline.refresh();
      });
      document.getElementById('show-online-btn')?.addEventListener('click', () => setPeopleView(false));
      document.getElementById('show-offline-btn')?.addEventListener('click', () => setPeopleView(true));
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
        if (data.clientId !== state.myClientId)
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
      if (bodyEl) bodyEl.textContent = data.message;
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
        if (!file.type?.startsWith('image/')) { showToast('Please select an image file', 'error'); return; }
        if (file.size > 10 * 1024 * 1024) { showToast('Image too large (max 10MB)', 'error'); return; }
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
    elements.editProfileBtn.addEventListener('click', () => {
      elements.editClientId.textContent = state.myClientId || '';
      const data = utils.loadFromStorage(CONSTANTS.STORAGE_KEY, {});
      document.querySelector('#edit-profile-modal h3').textContent = data.username ? 'Edit Profile' : 'Create Account';
      const termsCheckbox = document.getElementById('edit-terms');
      if (termsCheckbox) {
        termsCheckbox.checked = !!data.termsAgreed;
      }
      modals.open(elements.editProfileModal);
    });
    elements.cancelEditProfileBtn.addEventListener('click', () => modals.close(elements.editProfileModal));
    
    // Avatar upload (mobile + desktop)
    if (elements.avatarUploadBtn && elements.avatarFile) {
      elements.avatarUploadBtn.addEventListener('click', () => elements.avatarFile.click());
      elements.avatarFile.addEventListener('change', () => {
        const f = elements.avatarFile.files && elements.avatarFile.files[0];
        if (!f) return;
        if (!f.type || !f.type.startsWith('image/')) { showToast('Please choose an image', 'error'); return; }
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
    elements.editUsername.addEventListener('input', () =>
      profile.checkUsername(elements.editUsername, elements.editUsername.value));

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
        const pos = inp.selectionStart != null ? inp.selectionStart : inp.value.length;
        inp.value = inp.value.slice(0, pos) + em + inp.value.slice(pos);
        inp.selectionStart = inp.selectionEnd = pos + [...em].length;
        inp.focus();
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
        if (file.size > 25 * 1024 * 1024) { showToast('File too large (max 25 MB)', 'error'); generalFile.value = ''; return; }
        if (file.type && file.type.startsWith('image/')) {
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

  // ── Init ───────────────────────────────────────────────────────────────────
  const init = () => {
    if (window.ChatAPI._offline) setTimeout(() => showToast('Backend unreachable — offline mode. Check your connection and reload.', 'error'), 600);
    profile.load();
    state.unreadCounts = utils.loadFromStorage(CONSTANTS.UNREAD_KEY, {});
    Object.entries(socketHandlers).forEach(([event, handler]) => socket.on(event, handler));
    bindEvents();
    const roomFromUrl = new URLSearchParams(window.location.search).get('room');
    if (roomFromUrl) state.currentRoom = roomFromUrl;

    // Theme toggle
    const themeBtn = document.getElementById('theme-toggle');
    const root = document.documentElement;
    const savedTheme = localStorage.getItem('ptr29_theme') || 'dark';
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
    document.getElementById('theme-toggle').textContent = '☀️';
  }

  function applyDarkTheme() {
    const r = document.documentElement;
    r.style.removeProperty('color-scheme');
    ['--success','--danger','--warning'].forEach((k) => r.style.removeProperty(k));
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

    // ── VisualViewport: keep input visible when keyboard opens (iOS/Android) ─
    if (window.visualViewport) {
      let lastVVHeight = window.visualViewport.height;
      window.visualViewport.addEventListener('resize', () => {
        if (!document.body.classList.contains('ptr29-mobile')) return;
        const vv = window.visualViewport;
        const keyboardOpen = vv.height < lastVVHeight - 80;
        // When keyboard opens, scroll messages to bottom so latest is visible
        if (keyboardOpen && document.body.classList.contains('ptr29-view-chat')) {
          const msgs = document.getElementById('messages');
          if (msgs) setTimeout(() => { msgs.scrollTop = msgs.scrollHeight; }, 80);
        }
        // When keyboard closes, restore
        if (!keyboardOpen) lastVVHeight = vv.height;
      });
    }

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
        '<button class="secondary" id="ib-tab-sent" type="button">Your requests</button></div>' +
        '<div id="ib-body" style="max-height:55vh;overflow-y:auto"></div>' +
        '<div style="display:flex;justify-content:flex-end;margin-top:12px"><button class="secondary" id="ib-close" type="button">Close</button></div></div>';
      document.body.appendChild(ov);
      ov.addEventListener('click', (e) => { if (e.target === ov) ov.classList.remove('open'); });
      ov.querySelector('#ib-close').addEventListener('click', () => ov.classList.remove('open'));
      ov.querySelector('#ib-tab-rec').addEventListener('click', () => render('rec'));
      ov.querySelector('#ib-tab-sent').addEventListener('click', () => render('sent'));
      return ov;
    }
    function row(html) { const d = document.createElement('div'); d.style.cssText = 'border:1px solid var(--border);border-radius:10px;padding:10px 12px;margin-bottom:8px;background:var(--panel2)'; d.innerHTML = html; return d; }
    function render(tab) {
      const body = ov.querySelector('#ib-body');
      body.innerHTML = '<p style="color:var(--text-dim)">Loading…</p>';
      window.ChatAPI.inbox().then(rows => {
        const me = state.myUsername || '';
        const list = rows.filter(r => tab === 'rec' ? r.target_username === me : r.requester_username === me);
        body.innerHTML = '';
        if (!list.length) { body.innerHTML = '<p style="color:var(--text-dim);padding:8px 0">' + (tab === 'rec' ? 'No requests received.' : 'You haven\'t requested any Client IDs.') + '</p>'; return; }
        list.forEach(r => {
          if (tab === 'rec') {
            const elr = row(`
              <div style="font-size:13.5px;color:var(--text)"><b>${utils.escapeHtml(r.requester_username)}</b> <span style="color:var(--text-dim)">asks for your Client ID</span></div>
              <div style="font-size:12.5px;color:var(--text-muted);margin:6px 0">“${utils.escapeHtml(r.reason)}”</div>
              <div style="font-size:11px;color:var(--text-dim)">${fmtDate(r.created_at)}</div>
              <div class="ib-actions" style="display:flex;gap:8px;margin-top:8px"></div>`);
            const acts = elr.querySelector('.ib-actions');
            if (r.status === 'pending') {
              const ap = document.createElement('button'); ap.textContent = '✅ Approve'; ap.type = 'button';
              const dn = document.createElement('button'); dn.textContent = '❌ Deny'; dn.className = 'secondary'; dn.type = 'button';
              ap.addEventListener('click', () => window.ChatAPI.resolveRequest(r.id, true).then(res => { if (res.ok) { showToast('Approved — your ID was shared with ' + r.requester_username, 'success'); render('rec'); refreshInboxBadge(); } else showToast(res.error || 'Failed', 'error'); }));
              dn.addEventListener('click', () => window.ChatAPI.resolveRequest(r.id, false).then(res => { if (res.ok) { showToast('Denied', 'info'); render('rec'); } else showToast(res.error || 'Failed', 'error'); }));
              acts.append(ap, dn);
            } else {
              acts.innerHTML = `<span style="font-size:12px;color:${r.status === 'approved' ? 'var(--success)' : 'var(--danger)'}">${r.status === 'approved' ? '✅ Approved — ID shared' : '❌ Denied'} · ${fmtDate(r.resolved_at)}</span>`;
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
            } else {
              st.innerHTML = `<span style="font-size:12px;color:${r.status === 'denied' ? 'var(--danger)' : 'var(--warning)'}">${r.status === 'denied' ? '❌ Denied' : '⏳ Pending'}</span>`;
            }
            body.appendChild(elr);
          }
        });
      }).catch(e => { body.innerHTML = '<p style="color:var(--danger)">Could not load inbox — is the id_requests table created? (' + utils.escapeHtml(e.message || e) + ')</p>'; });
    }
    function open() { ensure(); ov.classList.add('open'); render('rec'); }
    return { open, render };
  })();

  function refreshInboxBadge() {
    const badge = document.getElementById('inbox-badge');
    if (!badge || !state.myUsername) return;
    window.ChatAPI.inbox().then(rows => {
      const n = rows.filter(r => r.target_username === state.myUsername && r.status === 'pending').length;
      badge.hidden = !n;
      badge.textContent = n > 9 ? '9+' : String(n);
    }).catch(() => {});
  }
  setInterval(refreshInboxBadge, 30000);
  const inboxBtnEl = document.getElementById('inbox-btn');
  if (inboxBtnEl) inboxBtnEl.addEventListener('click', () => { inboxUI.open(); });

  // ── Member profiles (rebuilt: light data, no heavy fields) ─────────────────
  const userProfile = (() => {
    let ov = null;
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

    function renderIdSection(box, username) {
      const me = state.myUsername || '';
      if (!me || username.toLowerCase() === me.toLowerCase()) {
        box.innerHTML = '<div style="font-size:11px;color:var(--text-dim);margin-top:10px">This is you — your Client ID lives in Edit Profile.</div>';
        return;
      }
      box.innerHTML = '<p style="color:var(--text-dim);font-size:12px;margin-top:10px">Loading…</p>';
      window.ChatAPI.inbox().then(rows => {
        const rel = rows.find(r => r.requester_username === me && r.target_username === username);
        if (rel && rel.status === 'pending') {
          box.innerHTML = `<div style="margin-top:10px;font-size:12.5px;color:var(--warning)">⏳ Request pending — sent ${fmtDate(rel.created_at)}</div>`;
        } else if (rel && rel.status === 'approved' && rel.disclosed_client_id) {
          box.innerHTML = `<div style="margin-top:10px;font-size:12.5px;color:var(--success)">✅ ${utils.escapeHtml(username)} approved your request:</div>
            <div style="display:flex;gap:8px;align-items:center;margin-top:6px">
              <code style="flex:1;font-size:11px;background:var(--panel2);border:1px solid var(--border);border-radius:6px;padding:6px 8px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${utils.escapeHtml(rel.disclosed_client_id)}</code>
              <button class="secondary" type="button" id="up-copy">Copy</button>
            </div>`;
          box.querySelector('#up-copy').addEventListener('click', () => copyText(rel.disclosed_client_id));
        } else {
          const deniedNote = rel && rel.status === 'denied' ? '<div style="font-size:11.5px;color:var(--danger);margin-top:8px">❌ Your previous request was denied — you may ask again.</div>' : '';
          box.innerHTML = deniedNote + `<button class="secondary" type="button" id="up-req" style="margin-top:10px">🔑 Request Client ID</button><div id="up-req-form"></div>`;
          box.querySelector('#up-req').addEventListener('click', () => {
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
                if (r.ok) { showToast('Request sent to ' + username, 'success'); renderIdSection(box, username); }
                else if (r.error === 'already_pending') showToast('A request is already pending', 'error');
                else showToast(r.error || 'Failed to send', 'error');
              });
            });
          });
        }
      }).catch(() => { box.innerHTML = ''; });
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
      renderIdSection(body.querySelector('#up-idreq'), d.username);
      if (opts && opts.focusRequest) setTimeout(() => { const r = body.querySelector('#up-req'); if (r) r.click(); }, 150);
    }
    return { open };
  })();


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
    let idx = 0, active = false, steps = [];
    let pubRoom = '', privRoom = '';
    let unwatch = null;

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
    async function joinRoom(name) {
      if (!name || state.currentRoom === name) return;
      rooms.join(name);
      await new Promise(r => setTimeout(r, 400));
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
        { sel: ['#user-section'], mobile: 'rooms', title: '1 · Guest mode', html: 'You are browsing as a guest: everything is viewable; chatting unlocks after registration + Terms. (“Anonymous” is reserved as a name.)' },
        { sel: ['#room-list'], mobile: 'rooms', title: '2 · Demo rooms', html: `The guide created <b>#${pubRoom}</b> (public) and 🔒 <b>#${privRoom}</b> (private). You own them for this tour; they vanish at the end.` },
        { sel: ['#messages'], mobile: 'chat', run: async () => { closeSettings(); await joinRoom(pubRoom); }, title: '3 · Entering the room', html: 'The guide just walked into the public demo room. Watch the chat panel light up.' },
        { sel: ['#online-panel'], mobile: 'online', run: async () => { state.tourFakes = fakePeople(); refreshOnline(); }, title: '4 · Volunteers join', html: '<b>Nova</b> and <b>Rex</b> just appeared in the Online list — the fake people who help demonstrate management.' },
        { sel: ['#messages'], mobile: 'chat', run: async () => { fakeMessage('Nova', 'Hey! Ready to help with the demo 👋'); }, title: '5 · A message arrives', html: 'That is what incoming messages look like — avatar, name, time, bubbles on the left; yours would sit on the right.' },
        { sel: ['#room-settings-panel'], run: async () => { openSettings(); }, title: '6 · Control panel', html: '⚙️ Settings opened. Every management feature lives here — watch the guide use each one on this room.' },
        { sel: ['#rename-input'], run: async () => { await emitP('rename-room', { room: state.currentRoom, newName: 'guided-demo' }); rooms.fetch(); }, title: '7 · Rename (done for you)', html: 'The guide just renamed the room to <b>#guided-demo</b> — see the sidebar update. Owners can rename any room except #general.' },
        { sel: ['#passkey-input'], run: async () => { await emitP('set-room-passkey', { room: state.currentRoom, passkey: 'DEMO-1234' }); if (elements.passkeyInput) elements.passkeyInput.value = 'DEMO-1234'; }, title: '8 · Passkey (done for you)', html: 'A passkey <b>DEMO-1234</b> was generated and saved. Anyone with it can enter once the room is private.' },
        { sel: ['#save-privacy-btn'], run: async () => { await emitP('set-room-privacy', { room: state.currentRoom, isPrivate: true }); rooms.fetch(); }, title: '9 · Going private (done)', html: 'The room is now 🔒 private: only owner / admins / members / passkey-holders get in. Flipping back is the same button.' },
        { sel: ['#room-members-list'], run: async () => { socket.emit('add-room-members', { room: state.currentRoom, members: fakeIds }); await new Promise(r => setTimeout(r, 500)); socket.emit('get-room-meta', { room: state.currentRoom }, () => {}); }, title: '10 · Adding people (done)', html: 'Nova and Rex were just granted private-room access via <b>+ Add User</b> — their chips appear in the users list.' },
        { sel: ['#room-admins-list'], run: async () => { socket.emit('add-room-admins', { room: state.currentRoom, admins: [fakeIds[1]] }); await new Promise(r => setTimeout(r, 500)); socket.emit('get-room-meta', { room: state.currentRoom }, () => {}); }, title: '11 · Promoting an admin', html: 'Rex just became an <b>admin 👑</b> — admins can rename, clear, and manage access. Trust only the right people.' },
        { sel: ['#room-members-list'], run: async () => { socket.emit('remove-room-admin', { room: state.currentRoom, adminId: fakeIds[1] }); await new Promise(r => setTimeout(r, 400)); socket.emit('remove-room-member', { room: state.currentRoom, memberId: fakeIds[1] }); await new Promise(r => setTimeout(r, 400)); socket.emit('get-room-meta', { room: state.currentRoom }, () => {}); }, title: '12 · Removing people', html: 'The guide demoted and removed <b>Rex</b> with the ✕ buttons — access revoked instantly. Add, promote, remove: the full cycle.' },
        { sel: ['#clear-room-btn'], mobile: 'chat', run: async () => { closeSettings(); await window.ChatAPI.clearRoom(state.currentRoom); }, title: '13 · Clearing a room', html: 'The room’s messages were just wiped with <b>Clear</b> (owner/admins only). Messages gone, room intact.' },
        { sel: ['#room-settings-panel'], mobile: 'rooms', run: async () => { await joinRoom(privRoom); openSettings(); }, title: '14 · The private room', html: `Now inside 🔒 <b>#${privRoom}</b> — same controls, already private. Everything you just watched works here too.` },
        { sel: ['#online-panel'], mobile: 'online', run: async () => { closeSettings(); state.tourFakes = []; refreshOnline(); }, title: '15 · Volunteers leave', html: 'Nova and Rex left the demo. The Online list always reflects live presence.' },
        { sel: ['#inbox-btn'], title: '16 · Done 🎉', html: '📥 Inbox = Client-ID requests · ❓ full guide · 🎓 replay. Finishing now deletes both demo rooms.' },
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
      nextBtn.addEventListener('click', async () => { idx >= steps.length - 1 ? end(true) : await show(idx + 1); });
      backBtn.addEventListener('click', async () => { await show(Math.max(0, idx - 1)); });
      skipBtn.addEventListener('click', () => end(true));
      window.addEventListener('resize', () => { if (active) place(); });
    }

    function targetFor(st) {
      for (const ssel of (st.sel || [])) {
        const t = document.querySelector(ssel);
        if (t && t.getClientRects().length) return t;
      }
      return null;
    }

    function place() {
      const st = steps[idx];
      if (!st) return;
      const isMobile = document.body.classList.contains('ptr29-mobile');
      if (st.mobile && isMobile) setMobileView(st.mobile);
      const target = targetFor(st);
      if (target) {
        try { target.scrollIntoView({ block: 'center' }); } catch {}
        const r = target.getBoundingClientRect();
        const pad = 6;
        spot.style.display = 'block';
        spot.style.left   = (r.left - pad) + 'px';
        spot.style.top    = (r.top - pad) + 'px';
        spot.style.width  = (r.width + pad * 2) + 'px';
        spot.style.height = (r.height + pad * 2) + 'px';
      } else {
        spot.style.display = 'none';
      }
      titleEl.textContent = st.title;
      bodyEl.innerHTML = st.html;
      countEl.textContent = (idx + 1) + ' / ' + steps.length;
      backBtn.style.display = idx === 0 ? 'none' : '';
      nextBtn.textContent = idx === steps.length - 1 ? 'Finish 🎉' : 'Next ➤';
      requestAnimationFrame(() => {
        const cw = card.offsetWidth, ch = card.offsetHeight;
        card.style.display = 'block';
        if (isMobile) {
          card.style.left = '12px'; card.style.right = '12px';
          card.style.width = 'auto'; card.style.top = 'auto';
          card.style.bottom = 'calc(var(--mobile-nav-h, 56px) + 12px)';
          return;
        }
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
      });
    }

    async function show(i) {
      idx = i; active = true; overlay.classList.add('open');
      const st = steps[idx];
      setWatch(st);
      if (st && st.enter) { try { await st.enter(); } catch {} await new Promise(r => setTimeout(r, 150)); }
      if (st && st.run) { try { await st.run(); } catch {} await new Promise(r => setTimeout(r, 300)); }
      place();
    }

    async function setup() {
      state.tourMode = true;
      try {
        const left = await window.ChatAPI.tourRooms();
        for (const n of left || []) { try { await window.ChatAPI.deleteRoom(n); } catch {} }
      } catch {}
      const suf = Math.random().toString(36).slice(2, 7);
      pubRoom = 'tour-public-' + suf;
      privRoom = 'tour-private-' + suf;
      try { await window.ChatAPI.createRoom(pubRoom, false); } catch {}
      try { await window.ChatAPI.createRoom(privRoom, true); } catch {}
      rooms.fetch();
    }

    function cleanup() {
      state.tourMode = false;
      state.tourFakes = [];
      closeSettings();
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
      setTimeout(() => rooms.fetch(), 400);
    }

    function end(done) {
      active = false;
      setWatch(null);
      overlay.classList.remove('open');
      spot.style.display = 'none';
      card.style.display = 'none';
      if (done) { try { localStorage.setItem(KEY, '1'); } catch {} }
      cleanup();
    }

    async function start() {
      if (!overlay) build();
      await setup();
      steps = buildSteps();
      idx = 0;
      await show(0);
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
  const getAccountSession = () => { try { return JSON.parse(localStorage.getItem(ACCOUNT_KEY) || 'null'); } catch { return null; } };
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
  function showAuthGate() {
    const boot = document.getElementById('boot');
    if (boot) { boot.classList.remove('off'); boot.innerHTML = ''; }
    let mode = 'login';
    const card = el('div', { class: 'modal', style: 'max-width:430px;width:94%;padding:24px' });
    card.innerHTML = `
      <h3 style="font-size:20px;margin-bottom:6px">🔐 REPLICA Account</h3>
      <p style="font-size:12.5px;color:var(--text-muted);margin-bottom:14px">Your content follows your <b>account</b> across devices. Passwords are SHA-256-salted on this device, then <b>bcrypt-hashed with a server-side pepper</b>. Hashes are unreadable through the API and logins are rate-limited.</p>
      <div class="people-toggle" style="margin-bottom:12px">
        <button type="button" class="pt-btn ag-tab active" data-m="login">Log in</button>
        <button type="button" class="pt-btn ag-tab" data-m="reg">Create account</button>
      </div>
      <input id="ag-user" placeholder="Username" autocomplete="username" style="margin-bottom:10px">
      <input id="ag-pass" type="password" placeholder="Password (min 6 characters)" autocomplete="current-password" style="margin-bottom:10px">
      <div id="ag-err" style="color:var(--danger);font-size:12px;min-height:18px;margin-bottom:8px"></div>
      <button id="ag-go" class="btn primary" style="width:100%;justify-content:center">Continue ➤</button>`;
    (boot || document.body).append(card);
    card.querySelectorAll('.ag-tab').forEach(b => b.addEventListener('click', () => {
      mode = b.dataset.m;
      card.querySelectorAll('.ag-tab').forEach(x => x.classList.toggle('active', x === b));
      card.querySelector('#ag-pass').placeholder = mode === 'reg' ? 'Choose a password (min 6 characters)' : 'Password';
    }));
    card.querySelector('#ag-go').addEventListener('click', async () => {
      const un = card.querySelector('#ag-user').value.trim();
      const pw = card.querySelector('#ag-pass').value;
      const err = card.querySelector('#ag-err');
      err.textContent = '';
      if (!un || !pw) { err.textContent = 'Enter username and password.'; return; }
      if (pw.length < 6) { err.textContent = 'Password too short (min 6 characters).'; return; }
      const h = await sha256hex(pw + ':' + un.toLowerCase());
      if (!h) { err.textContent = 'Crypto unavailable in this browser.'; return; }
      const res = mode === 'login'
        ? await window.ChatAPI.accountLogin(un, h)
        : await window.ChatAPI.accountRegister(un, h);
      if (!res || !res.ok) {
        const map = {
          taken: 'That username already has an account — log in instead.',
          invalid_credentials: 'Wrong username or password.',
          locked: 'Too many failed attempts — locked for 15 minutes.',
          invalid_username: 'Invalid username.',
        };
        err.textContent = (map[res && res.error]) || (res && res.error) || 'Failed.';
        return;
      }
      try {
        localStorage.setItem(ACCOUNT_KEY, JSON.stringify({ id: res.id, username: res.username }));
        localStorage.setItem(CONSTANTS.CLIENT_ID_KEY, res.id);
      } catch {}
      location.reload();
    });
  }
  function logout() {
    try { localStorage.removeItem(ACCOUNT_KEY); localStorage.removeItem(CONSTANTS.CLIENT_ID_KEY); } catch {}
    location.reload();
  }

  // Gated startup: no account session → auth gate blocks the whole app
  (async () => {
    const sess = getAccountSession();
    if (!sess) { showAuthGate(); return; }
    try { localStorage.setItem(CONSTANTS.CLIENT_ID_KEY, sess.id); } catch {}
    // fresh world: adopt account identity as local profile if none exists yet
    try {
      const prof = utils.loadFromStorage(CONSTANTS.STORAGE_KEY, {});
      if (!prof.username && sess.username) {
        utils.saveToStorage(CONSTANTS.STORAGE_KEY, { username: sess.username, avatar: '', termsAgreed: true });
      }
    } catch {}
    if (window.ChatAPI && window.ChatAPI.setClientId) window.ChatAPI.setClientId(sess.id);
    document.getElementById('logout-btn')?.addEventListener('click', logout);
    init();
    initMobile();  // Run after init
    // Auto-start for first-time visitors
    let tourDone = false;
    try { tourDone = !!localStorage.getItem('ptr29_tour_done_v1'); } catch {}
    if (!tourDone) setTimeout(() => tour.start(), 900);
  })();

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js?v=260846').catch(() => {});
    });
  }
})();
