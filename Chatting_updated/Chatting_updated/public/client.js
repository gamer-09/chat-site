(() => {
  const socket = io({ reconnection: true, reconnectionAttempts: 10, reconnectionDelay: 1000 });

  // ── DOM Elements ───────────────────────────────────────────────────────────
  const elements = {
    messages:         document.getElementById('messages'),
    typing:           document.getElementById('typing'),
    form:             document.getElementById('chat-form'),
    username:         document.getElementById('username'),
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
    open:     (m) => m?.classList.add('open'),
    close:    (m) => m?.classList.remove('open'),
    closeAll: ()  => document.querySelectorAll('.modal-overlay').forEach(m => m.classList.remove('open')),
  };

  // ── Profile ────────────────────────────────────────────────────────────────
  const profile = {
    load: () => {
      const data = utils.loadFromStorage(CONSTANTS.STORAGE_KEY, {});
      state.myClientId = utils.getOrCreateClientId();
      elements.username.value = data.username || '';
      elements.avatar.value   = data.avatar   || '';
      profile.updateUI(data.username || 'Anonymous', data.avatar || '', state.myClientId);
      return data;
    },

    save: (username, avatar) => {
      const data = { username, avatar };
      utils.saveToStorage(CONSTANTS.STORAGE_KEY, data);
      profile.updateUI(username, avatar, state.myClientId);
      return data;
    },

    updateUI: (username, avatar, clientId) => {
      const seed = encodeURIComponent(username || 'Anonymous');
      const avatarUrl = avatar || `${CONSTANTS.DEFAULT_AVATAR}${seed}`;
      elements.userAvatarPreview.src = avatarUrl;
      elements.userUsername.textContent = username || 'Anonymous';
      elements.userClientId.textContent = clientId ? `ID: ${clientId.slice(0, 16)}…` : 'Not connected';
      elements.editUsername.value = username || '';
      elements.editAvatar.value   = avatar   || '';
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
    validateAndSave: (username, avatar) => new Promise((resolve) => {
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
        profile.save(val, avatar);
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

      // On mobile: slide sidebar away, show chat view
      document.body.classList.add('mobile-chat-active');

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

      content += `
        <div class="msg-actions">
          <button class="msg-action-btn" data-action="reply" title="Reply">↩</button>
          ${msg.message ? `<button class="msg-action-btn" data-action="copy" title="Copy">📋</button>` : ''}
          ${canEdit  ? `<button class="msg-action-btn" data-action="edit"   title="Edit">✏️</button>` : ''}
          ${isMe     ? `<button class="msg-action-btn danger" data-action="delete" title="Delete">🗑</button>` : ''}
        </div>
        <div class="meta">
          <img class="avatar" src="${avatarUrl}" alt="">
          <span class="name">${utils.escapeHtml(msg.username || 'Anonymous')}</span>
          <span class="time">${utils.formatTime(msg.timestamp)}</span>
          ${msg.edited ? '<span class="edited">(edited)</span>' : ''}
        </div>
        <div class="body">${msg.type === 'image'
          ? `<img class="msg-image" src="${msg.imageUrl}" alt="Shared image" loading="lazy">`
          : utils.escapeHtml(msg.message)}</div>`;

      el.innerHTML = content;

      // Inline action buttons
      el.querySelectorAll('.msg-action-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          messages.handleAction(btn.dataset.action, el, msg);
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

    showContextMenu: (e, msgEl, msg) => {
      const isMe = msg.clientId === state.myClientId;
      const canEdit = isMe && (Date.now() - msg.timestamp) < CONSTANTS.EDIT_WINDOW_MS;
      elements.contextMenu.innerHTML = `
        <button data-action="reply">↩️ Reply</button>
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
      }
    },
  };

  // ── Online users ───────────────────────────────────────────────────────────
  const online = {
    update: (users) => {
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

      // Re-enter saved passkeys so the server restores ephemeral access after reconnect
      const savedPasskeys = utils.loadFromStorage(CONSTANTS.PASSKEYS_KEY, {});
      Object.entries(savedPasskeys).forEach(([room, passkey]) => {
        socket.emit('enter-passkey', { room, passkey }, () => {});
      });

      rooms.fetch();

      // Only auto-join if we have a username — prevents mobile getting stuck
      // with mobile-chat-active on but an empty username blocking join
      const storedProfile = utils.loadFromStorage(CONSTANTS.STORAGE_KEY, {});
      const hasUsername = elements.username.value.trim() || storedProfile.username || '';
      if (!hasUsername) return; // user will join manually after setting a name

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
      elements.messages.innerHTML = '';
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
  };

  // ── Event listeners ────────────────────────────────────────────────────────
  const bindEvents = () => {
    // ── Mobile navigation ─────────────────────────────────────────────
    // On phones the sidebar (rooms view) and chat are stacked full-screen.
    // body.mobile-chat-active slides the sidebar off-screen and shows chat.
    // Back button: return to sidebar from chat on mobile
    const mobileBackBtn = document.getElementById('mobile-back-btn');
    if (mobileBackBtn) {
      mobileBackBtn.addEventListener('click', () => {
        document.body.classList.remove('mobile-chat-active');
      });
    }

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
    elements.form.addEventListener('submit', (e) => {
      e.preventDefault();
      const text = elements.text.value.trim();
      if (text) { 
        messages.send(text); 
        elements.text.value = ''; 
        // Refocus input on mobile for continuous typing
        if (window.matchMedia('(pointer: coarse)').matches) {
          setTimeout(() => elements.text.focus(), 10);
        }
      }
    });
    
    // Mobile input touch handling - prevent default scroll/zoom on send
    elements.text.addEventListener('touchstart', (e) => {
      // Allow normal behavior but ensure focus works
    }, { passive: true });
    
    elements.text.addEventListener('focus', () => {
      // Scroll input into view on mobile
      if (window.innerWidth <= 640) {
        setTimeout(() => {
          elements.text.scrollIntoView({ behavior: 'smooth', block: 'end' });
          // Also scroll messages to bottom so new messages will be visible
          elements.messages.scrollTop = elements.messages.scrollHeight;
        }, 300);
      }
    });
    
    // Handle keyboard appearance on mobile (resize event)
    let mobileKeyboardOpen = false;
    let originalWindowHeight = window.innerHeight;
    window.addEventListener('resize', () => {
      if (window.innerWidth <= 640) {
        const currentHeight = window.innerHeight;
        if (currentHeight < originalWindowHeight * 0.75) {
          // Keyboard likely opened
          mobileKeyboardOpen = true;
          // Scroll to keep input visible
          setTimeout(() => {
            elements.text.scrollIntoView({ behavior: 'smooth', block: 'end' });
          }, 100);
        } else if (mobileKeyboardOpen) {
          // Keyboard likely closed
          mobileKeyboardOpen = false;
        }
      }
      originalWindowHeight = currentHeight || window.innerHeight;
    });
    
    // Visual Viewport API for better mobile keyboard handling (iOS Safari)
    if (window.visualViewport) {
      const inputArea = document.getElementById('input-area');
      window.visualViewport.addEventListener('resize', function() {
        const vv = window.visualViewport;
        // When keyboard opens, visual viewport shrinks
        if (window.innerHeight - vv.height > 100) {
          // Keyboard is open - scroll the chat area into view
          inputArea.style.position = 'fixed';
          inputArea.style.bottom = '0';
          inputArea.style.left = '0';
          inputArea.style.right = '0';
          inputArea.style.zIndex = '1000';
          
          // Scroll messages to bottom so newest message is visible
          setTimeout(() => {
            elements.messages.scrollTop = elements.messages.scrollHeight;
          }, 100);
        } else {
          // Keyboard is closed
          inputArea.style.position = '';
          inputArea.style.bottom = '';
          inputArea.style.left = '';
          inputArea.style.right = '';
          inputArea.style.zIndex = '';
        }
      });
    }

    // Typing indicator
    elements.text.addEventListener('input', () => {
      if (!state.joined) return;
      socket.emit('typing', { isTyping: true });
      clearTimeout(state.typingTimer);
      state.typingTimer = setTimeout(() => socket.emit('typing', { isTyping: false }), 2000);
    });

    // Username live check (main sidebar input)
    elements.username.addEventListener('input', () =>
      profile.checkUsername(elements.username, elements.username.value));

    elements.username.addEventListener('change', async () => {
      const val = elements.username.value.trim();
      if (!val) return;
      const ok = await profile.validateAndSave(val, elements.avatar.value);
      if (ok && state.joined) {
        socket.emit('update-profile', {
          room: state.currentRoom, clientId: state.myClientId,
          username: val, avatar: elements.avatar.value,
        });
      }
    });

    // Image upload
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

    // Room sidebar
    elements.createRoomBtn.addEventListener('click', () => modals.open(elements.createRoomModal));
    elements.refreshRoomsBtn.addEventListener('click', rooms.fetch);

    elements.createRoomForm.addEventListener('submit', (e) => {
      e.preventDefault();
      rooms.create(elements.createRoomName.value, elements.createRoomPrivate.checked);
    });
    elements.cancelCreateRoomBtn.addEventListener('click', () => {
      modals.close(elements.createRoomModal);
      elements.createRoomForm.reset();
    });

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
      elements.roomSettingsPanel.style.display =
        elements.roomSettingsPanel.style.display === 'none' ? 'block' : 'none';
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
      if (!newUsername) return;
      const ok = await profile.validateAndSave(newUsername, newAvatar);
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

  init();
})();
