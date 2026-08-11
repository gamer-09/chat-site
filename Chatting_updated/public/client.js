(() => {
  const socket = io({ reconnection: true, reconnectionAttempts: 10, reconnectionDelay: 1000 });

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
        id = utils.generateId();
        localStorage.setItem(CONSTANTS.CLIENT_ID_KEY, id);
        return id;
      } catch { return utils.generateId(); }
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
        safe = safe.replace(/**([^*<>
]+)**/g, '<strong>$1</strong>');
        // Italic: *text* — only remaining single * pairs after bold consumed
        safe = safe.replace(/*([^*<>
]+)*/g, '<em>$1</em>');
        // @mentions
        safe = safe.replace(/@([w.-]+)/g, '<span class="mention">@$1</span>');
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
      // Set myUsername immediately so reaction "mine" detection works
      // before the socket connect handler fires.
      state.myUsername = data.username || '';
      elements.username.value = data.username || '';
      elements.avatar.value   = data.avatar   || '';
      profile.updateUI(data.username || 'Anonymous', data.avatar || '', state.myClientId);
      return data;
    },

    save: (username, avatar, termsAgreed = true) => {
      const data = { username, avatar, termsAgreed };
      utils.saveToStorage(CONSTANTS.STORAGE_KEY, data);
      state.myUsername = username || '';
      profile.updateUI(username, avatar, state.myClientId);
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
      socket.emit('check-username', { username: val }, (resp) => {
        if (!resp || !resp.available) {
          showToast('Username already taken — please choose another', 'error');
          return resolve(false);
        }
        profile.save(val, avatar, termsAgreed);
        resolve(true);
      });
    }),

    delete: async () => {
      try {
        const res = await fetch('/api/users/delete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ clientId: state.myClientId }),
        });
        if (res.ok) {
          [CONSTANTS.STORAGE_KEY, CONSTANTS.CLIENT_ID_KEY, CONSTANTS.PASSKEYS_KEY, CONSTANTS.UNREAD_KEY]
            .forEach(k => localStorage.removeItem(k));
          showToast('Account deleted successfully', 'success');
          setTimeout(() => window.location.reload(), 1500);
        } else {
          const err = await res.json();
          showToast(err.error || 'Failed to delete account', 'error');
        }
      } catch { showToast('Failed to delete account', 'error'); }
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
        const el = document.createElement('div');
        el.className = `room${roomData.name === state.currentRoom ? ' active' : ''}${roomData.isPrivate ? ' room-private' : ''}`;
        const unread = state.unreadCounts[roomData.name] || 0;
        el.innerHTML = `
          <span class="room-icon">${roomData.isPrivate ? '🔒' : '#'}</span>
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
      if (!currentUsername) {
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
        username: currentUsername,
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

      // Admins chips
      const adminsInfo = meta.adminsInfo || [];
      elements.roomAdminsList.innerHTML = adminsInfo.length === 0
        ? '<span style="color:var(--text-dim)">None</span>'
        : adminsInfo.map(u => {
            const isOwnerChip = meta.ownerId === u.clientId;
            const canRemove = state.canManageCurrentRoom && !isOwnerChip && state.currentRoom !== 'general';
            return `<span class="chip member-chip" title="${u.clientId}">
              ${utils.escapeHtml(u.username)}${isOwnerChip ? ' 👑' : ''}
              ${canRemove ? `<button class="chip-remove" data-action="remove-admin" data-id="${u.clientId}" title="Remove admin">×</button>` : ''}
            </span>`;
          }).join('');

      // Members chips (stored access-control list for private rooms)
      const membersInfo = meta.membersInfo || [];
      elements.roomMembersList.innerHTML = membersInfo.length === 0
        ? '<span style="color:var(--text-dim)">None</span>'
        : membersInfo.map(u => {
            const canRemove = state.canManageCurrentRoom && state.currentRoom !== 'general';
            return `<span class="chip member-chip" title="${u.clientId}">
              ${utils.escapeHtml(u.username)}
              ${canRemove ? `<button class="chip-remove" data-action="remove-member" data-id="${u.clientId}" title="Remove member">×</button>` : ''}
            </span>`;
          }).join('');

      // Bind remove buttons
      elements.roomAdminsList.querySelectorAll('.chip-remove[data-action="remove-admin"]').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          if (confirm('Remove admin access from this user?'))
            socket.emit('remove-room-admin', { room: state.currentRoom, adminId: btn.dataset.id });
        });
      });
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
      const ownerName = meta.ownerInfo
        ? meta.ownerInfo.username
        : (meta.ownerId ? meta.ownerId.slice(0, 16) + '…' : 'None');

      // "Users" = live presence (people currently in this room)
      const usersInRoom = state.currentRoomPresence.length;
      const adminCount = (meta.adminsInfo || []).length;

      banner.innerHTML = `
        <span class="banner-item">👑 <strong>Owner:</strong> ${utils.escapeHtml(ownerName)}</span>
        <span class="banner-sep">·</span>
        <span class="banner-item">👥 <strong>Users:</strong> ${usersInRoom}</span>
        <span class="banner-sep">·</span>
        <span class="banner-item">🛡 <strong>Admins:</strong> ${adminCount}</span>
        <button class="banner-view-btn" id="banner-view-btn">View Info</button>
      `;
      banner.querySelector('#banner-view-btn').onclick = () => {
        elements.roomSettingsPanel.style.display = 'block';
        document.getElementById('room-info-section')?.scrollIntoView({ behavior: 'smooth' });
      };
    },

    create: async (name, isPrivate) => {
      try {
        const res = await fetch('/api/rooms', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, isPrivate, ownerId: state.myClientId }),
        });
        const data = await res.json();
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
          rooms.fetchMeta(state.currentRoom);
        } else {
          showToast(resp?.error || 'Failed to save passkey', 'error');
        }
      });
    },

    delete: async () => {
      try {
        const res = await fetch(`/api/rooms/${encodeURIComponent(state.currentRoom)}/delete`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ clientId: state.myClientId }),
        });
        const data = await res.json();
        if (data.ok) {
          showToast(`Room "#${data.room}" deleted`, 'success');
          modals.close(elements.deleteRoomModal);
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
        const res = await fetch(`/api/rooms/${encodeURIComponent(state.currentRoom)}/clear`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ clientId: state.myClientId }),
        });
        const data = await res.json();
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

  // ── Messages ───────────────────────────────────────────────────────────────
  const messages = {
    render: (msg, prepend = false) => {
      if (!elements.messages) return;
      const isMe = msg.clientId === state.myClientId;
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
      const bodyHtml = msg.type === 'image'
        ? `<img class="msg-image" src="${msg.imageUrl}" alt="Shared image" loading="lazy">`
        : msg.type === 'file'
          ? `<a class="file-attachment" href="${msg.fileUrl}" download="${utils.escapeHtml(msg.message || 'file')}" target="_blank" rel="noopener"><span>📎</span><span>${utils.escapeHtml(msg.message || 'File')}</span>${msg.fileSize ? `<span style="color:var(--text-dim);font-size:11px">${utils.formatFileSize(msg.fileSize)}</span>` : ''}</a>`
          : `<span class="msg-content">${utils.renderMarkdown(msg.message || '')}</span>`;

      const reactionEntries = msg.reactions ? Object.entries(msg.reactions).filter(([,u]) => u.length > 0) : [];
      const reactionsHtml = reactionEntries.length > 0
        ? `<div class="reactions">${reactionEntries.map(([emoji, users]) => {
            const mine = users.some(u => u.userId === state.myClientId || u.username === state.myUsername);
            return `<button class="reaction-pill${mine ? ' active' : ''}" data-emoji="${emoji}" data-msg-id="${msg.id}" title="${users.map(u=>u.username).join(', ')}">${emoji} ${users.length}</button>`;
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

      prepend ? elements.messages.prepend(el) : elements.messages.appendChild(el);
      elements.messages.scrollTop = elements.messages.scrollHeight;

      if (!isMe && !state.readSent.has(msg.id)) {
        socket.emit('mark-read', { room: state.currentRoom, messageId: msg.id });
        state.readSent.add(msg.id);
      }
    },

    send: (text) => {
      if (!text.trim() || !state.joined) return;
      socket.emit('chat-message', { text, replyTo: state.replyTarget?.id || '' });
      messages.clearReply();
    },

    sendImage: async (dataUrl, filename) => {
      try {
        const res = await fetch(`/api/rooms/${encodeURIComponent(state.currentRoom)}/images`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ dataUrl, clientId: state.myClientId, filename }),
        });
        if (!res.ok) { const e = await res.json(); showToast(e.error || 'Failed to upload image', 'error'); }
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
        const res = await fetch(`/api/rooms/${encodeURIComponent(state.currentRoom)}/files`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ dataUrl, clientId: state.myClientId, filename }),
        });
        if (!res.ok) { const e = await res.json(); showToast(e.error || 'Failed to upload file', 'error'); }
        else showToast('File sent!', 'success');
      } catch { showToast('Failed to upload file', 'error'); }
    },

    renderReactions: (msgEl, reactions) => {
      let div = msgEl.querySelector('.reactions');
      if (!div) { div = document.createElement('div'); div.className = 'reactions'; msgEl.appendChild(div); }
      const entries = reactions ? Object.entries(reactions).filter(([,u]) => u.length > 0) : [];
      if (entries.length === 0) { div.innerHTML = ''; return; }
      div.innerHTML = entries.map(([emoji, users]) => {
        const mine = users.some(u => u.userId === state.myClientId || u.username === state.myUsername);
        return `<button class="reaction-pill${mine ? ' active' : ''}" data-emoji="${emoji}" title="${users.map(u=>u.username).join(', ')}">${emoji} ${users.length}</button>`;
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
      const isMyMsg = msgEl.dataset.clientId === state.myClientId;
      const readByOthers = (readBy || []).filter(r => r.username !== senderUsername);
      div.textContent = (isMyMsg && readByOthers.length > 0) ? `✓ Read by ${readByOthers.map(r=>r.username).join(', ')}` : '';
    },

    showContextMenu: (e, msgEl, msg) => {
      const isMe = msg.clientId === state.myClientId;
      const canEdit = isMe && (Date.now() - msg.timestamp) < CONSTANTS.EDIT_WINDOW_MS;
      elements.contextMenu.innerHTML = `
        <button data-action="reply">↩️ Reply</button>
        <button data-action="react">😊 React</button>
        ${msg.message ? '<button data-action="copy">📋 Copy</button>' : ''}
        ${canEdit ? '<button data-action="edit">✏️ Edit</button>' : ''}
        ${isMe ? '<button data-action="delete" class="danger">🗑️ Delete</button>' : ''}
      `;
      elements.contextMenu.style.left = `${Math.min(e.clientX, window.innerWidth - 160)}px`;
      elements.contextMenu.style.top  = `${Math.min(e.clientY, window.innerHeight - 160)}px`;
      elements.contextMenu.classList.add('open');
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

  // ── Online users ───────────────────────────────────────────────────────────
  const online = {
    update: (users) => {
      if (!elements.onlineList) return;
      elements.onlineList.innerHTML = '';
      (users || []).forEach(user => {
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
          <div class="online-indicator"></div>
        `;
        elements.onlineList.appendChild(el);
      });
    },
  };

  // ── Socket event handlers ──────────────────────────────────────────────────
  const socketHandlers = {
    connect: () => {
      state.myClientId = utils.getOrCreateClientId();
      try { const d = JSON.parse(localStorage.getItem(CONSTANTS.STORAGE_KEY) || '{}'); state.myUsername = d.username || ''; } catch {}

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

    'read-receipt': (data) => {
      const msgEl = document.querySelector(`[data-id="${data.messageId}"]`);
      if (!msgEl) return;
      const div = msgEl.querySelector('.receipts');
      if (!div) return;
      if (msgEl.dataset.clientId !== state.myClientId) return;
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
        const reader = new FileReader();
        reader.onload = () => { messages.sendImage(reader.result, file.name); elements.imageFile.value = ''; };
        reader.readAsDataURL(file);
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
            const url = `/api/rooms/${encodeURIComponent(state.currentRoom)}/search?q=${encodeURIComponent(q)}&clientId=${encodeURIComponent(state.myClientId || '')}`;
            const res = await fetch(url);
            if (!res.ok) return;
            const data = await res.json();
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
        const n = new Notification('ptr_29 Chat', { body: data.message, icon: '/favicon.ico' });
        setTimeout(() => n.close(), 5000);
      } catch {}
    });
  };

  // ── Init ───────────────────────────────────────────────────────────────────
  const init = () => {
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
    r.style.setProperty('--bg',           '#f8fafc');
    r.style.setProperty('--panel',        '#f1f5f9');
    r.style.setProperty('--panel2',       '#ffffff');
    r.style.setProperty('--border',       '#e2e8f0');
    r.style.setProperty('--border-light', '#cbd5e1');
    r.style.setProperty('--text',         '#0f172a');
    r.style.setProperty('--text-muted',   '#475569');
    r.style.setProperty('--text-dim',     '#94a3b8');
    document.getElementById('theme-toggle').textContent = '☀️';
  }

  function applyDarkTheme() {
    const r = document.documentElement;
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
    link.href = '/mobile.css';
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

    // Bottom nav tab clicks
    document.querySelectorAll('.mobile-nav-btn').forEach(btn => {
      btn.addEventListener('click', () => setMobileView(btn.dataset.view));
    });

    // Back button (visible only in chat view) returns to the room list
    const backBtn = document.getElementById('mobile-back-btn');
    if (backBtn) {
      backBtn.addEventListener('click', (e) => {
        e.preventDefault();
        setMobileView('rooms');
      });
    }

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
            const url = `/api/rooms/${encodeURIComponent(state.currentRoom)}/search?q=${encodeURIComponent(q)}&clientId=${encodeURIComponent(state.myClientId || '')}`;
            const res = await fetch(url);
            if (!res.ok) return;
            const data = await res.json();
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
        setMobileView('chat');
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

  init();
  initMobile();  // Run after init
})();
