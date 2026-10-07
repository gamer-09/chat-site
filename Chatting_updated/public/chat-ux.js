/*
 * © 2026 gamer-09. All rights reserved.
 * This code is proprietary. Unauthorized copying, modification,
 * distribution, or use of this software is strictly prohibited.
 *
 * In-chat search, @mention autocomplete/highlighting and system notifications.
 * Exposes window.PTR29Chat:
 *   search.attach(inputEl, wrapperEl, opts)   – per-composer search UI
 *   search.cancel()                           – clear highlights, restore view
 *   mentions.refreshNames()                   – rebuild the mention name index
 *   mentions.decorate(rootEl)                 – wrap @names inside a message
 *   notify.enable(force) / notify.setPref()   – system notification plumbing
 *   notify.fire(title, body, opts)            – send one notification
 */
(function () {
  'use strict';

  // ═══════════════════════════════════════════════════════════════════════════
  // Search: highlights matches, counts them and steps through them
  // ═══════════════════════════════════════════════════════════════════════════
  var current = null;          // active search controller
  var hits = [];               // <mark> elements in document order
  var activeIndex = -1;
  var savedScroll = null;

  function messagesRoot() { return document.getElementById('messages'); }

  function clearHighlights() {
    document.querySelectorAll('mark.search-hit').forEach(function (m) {
      var parent = m.parentNode;
      if (!parent) return;
      parent.replaceChild(document.createTextNode(m.textContent), m);
      parent.normalize();
    });
    hits = [];
    activeIndex = -1;
  }

  // Wrap every occurrence of `query` inside text nodes of the messages list.
  function highlight(query) {
    var root = messagesRoot();
    if (!root || !query) return 0;
    var needle = query.toLowerCase();
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: function (node) {
        if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
        if (node.parentNode && /^(SCRIPT|STYLE|MARK|TEXTAREA)$/.test(node.parentNode.nodeName)) return NodeFilter.FILTER_REJECT;
        if (node.parentNode && node.parentNode.closest && node.parentNode.closest('.link-preview-card')) return NodeFilter.FILTER_REJECT;
        return node.nodeValue.toLowerCase().indexOf(needle) !== -1 ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      }
    });
    var targets = [];
    var node;
    while ((node = walker.nextNode())) targets.push(node);

    targets.forEach(function (textNode) {
      var text = textNode.nodeValue;
      var lower = text.toLowerCase();
      var frag = document.createDocumentFragment();
      var from = 0;
      var at = lower.indexOf(needle);
      while (at !== -1) {
        if (at > from) frag.appendChild(document.createTextNode(text.slice(from, at)));
        var mark = document.createElement('mark');
        mark.className = 'search-hit';
        mark.textContent = text.slice(at, at + needle.length);
        frag.appendChild(mark);
        from = at + needle.length;
        at = lower.indexOf(needle, from);
      }
      if (from < text.length) frag.appendChild(document.createTextNode(text.slice(from)));
      textNode.parentNode.replaceChild(frag, textNode);
    });
    hits = Array.prototype.slice.call(document.querySelectorAll('mark.search-hit'));
    return hits.length;
  }

  function step(delta) {
    if (!hits.length) return;
    if (activeIndex >= 0 && hits[activeIndex]) hits[activeIndex].classList.remove('active');
    activeIndex = (activeIndex + delta + hits.length) % hits.length;
    var el = hits[activeIndex];
    if (!el) return;
    el.classList.add('active');
    try { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (e) { try { el.scrollIntoView(); } catch (e2) {} }
    return activeIndex;
  }

  function setControls(ctx, visible) {
    [].slice.call(ctx.wrap.querySelectorAll('.search-count, .search-nav')).forEach(function (el) {
      el.hidden = !visible;
    });
    // the mobile bar keeps its own close button always visible
    var close = ctx.wrap.querySelector('#mobile-search-close-btn');
    if (close) close.hidden = false;
  }

  function updateCount(ctx, domHits, serverTotal) {
    var label = ctx.wrap.querySelector('.search-count');
    if (!label) return;
    if (!domHits) { label.textContent = serverTotal ? serverTotal + ' found' : 'no matches'; return; }
    var extra = (serverTotal && serverTotal > domHits) ? ' (+' + (serverTotal - domHits) + ' older)' : '';
    label.textContent = (activeIndex >= 0 ? (activeIndex + 1) + '/' + domHits : domHits + ' found') + extra;
  }

  function runSearch(ctx, query) {
    var root = messagesRoot();
    if (!query) { cancelSearch(); return; }
    if (!savedScroll && root) savedScroll = root.scrollTop;
    clearHighlights();
    var domHits = highlight(query);
    activeIndex = -1;
    setControls(ctx, true);
    updateCount(ctx, domHits, 0);
    if (domHits) step(1);
    // ask the server how many matches exist in total (older messages may not be loaded)
    try {
      if (window.ChatAPI && window.ChatAPI.searchMessages) {
        window.ChatAPI.searchMessages(ctx.room(), query).then(function (data) {
          var total = data && data.results ? data.results.length : 0;
          updateCount(ctx, domHits, total);
        }).catch(function () {});
      }
    } catch (e) {}
  }

  function cancelSearch() {
    var ctx = current;
    clearHighlights();
    if (ctx) {
      setControls(ctx, false);
      if (ctx.input) { ctx.input.value = ''; try { ctx.input.blur(); } catch (e) {} }
      if (ctx.wrap && ctx.wrap.id === 'mobile-search-bar') ctx.wrap.style.display = 'none';
      if (ctx.onCancel) { try { ctx.onCancel(); } catch (e) {} }
    }
    var root = messagesRoot();
    if (root && savedScroll != null) { try { root.scrollTop = savedScroll; } catch (e) {} }
    savedScroll = null;
  }

  function attach(input, wrap, opts) {
    if (!input || !wrap) return null;
    opts = opts || {};
    var ctx = {
      input: input, wrap: wrap,
      room: opts.room || function () { return ''; },
      onCancel: opts.onCancel || null
    };
    var timer = null;
    input.addEventListener('input', function () {
      clearTimeout(timer);
      var q = input.value.trim();
      if (!q) { cancelSearch(); return; }
      timer = setTimeout(function () { runSearch(ctx, q); }, 220);
    });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { e.preventDefault(); cancelSearch(); return; }
      if (e.key === 'Enter') { e.preventDefault(); step(e.shiftKey ? -1 : 1); updateCount(ctx, hits.length, 0); }
      if (e.key === 'F3' || (e.key === 'g' && (e.ctrlKey || e.metaKey))) { e.preventDefault(); step(e.shiftKey ? -1 : 1); }
    });
    var prev = wrap.querySelector('.search-prev');
    var next = wrap.querySelector('.search-next');
    var cancel = wrap.querySelector('.search-cancel');
    if (prev) prev.addEventListener('click', function () { step(-1); updateCount(ctx, hits.length, 0); });
    if (next) next.addEventListener('click', function () { step(1); updateCount(ctx, hits.length, 0); });
    if (cancel) cancel.addEventListener('click', function () { cancelSearch(); });
    current = ctx;
    return ctx;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // @mentions: autocomplete in the composer, highlighting in messages
  // ═══════════════════════════════════════════════════════════════════════════
  var knownNames = [];      // [{username, avatar, online}]
  var menu = null;
  var menuState = { open: false, items: [], index: 0, start: 0, end: 0, input: null };

  function collectNames() {
    var map = {};
    var add = function (u, online) {
      var name = String(u && u.username || '').trim();
      if (!name || name === 'Anonymous') return;
      if (name.toLowerCase().indexOf('anonymous') !== -1) return;
      var key = name.toLowerCase();
      if (!map[key]) map[key] = { username: name, avatar: u.avatar || '', online: !!online };
      else if (online) map[key].online = true;
    };
    try { (window.PTR29HostState && window.PTR29HostState.presence() || []).forEach(function (u) { add(u, true); }); } catch (e) {}
    try { (window.PTR29HostState && window.PTR29HostState.offline() || []).forEach(function (u) { add(u, false); }); } catch (e) {}
    knownNames = Object.keys(map).map(function (k) { return map[k]; });
    knownNames.sort(function (a, b) { return a.username.localeCompare(b.username); });
    return knownNames;
  }

  function ensureMenu() {
    if (menu && menu.isConnected) return menu;
    menu = document.createElement('div');
    menu.className = 'mention-menu';
    menu.hidden = true;
    document.body.appendChild(menu);
    return menu;
  }

  function closeMenu() {
    if (menu) { menu.hidden = true; menu.innerHTML = ''; }
    menuState.open = false;
    menuState.items = [];
  }

  function placeMenu(input) {
    var m = ensureMenu();
    var r = input.getBoundingClientRect();
    m.style.left = Math.max(8, Math.min(r.left, window.innerWidth - m.offsetWidth - 8)) + 'px';
    m.style.top = Math.max(8, r.top - m.offsetHeight - 8) + 'px';
    m.style.width = Math.min(320, Math.max(190, r.width)) + 'px';
  }

  function renderMenu(query) {
    var input = menuState.input;
    if (!input) return;
    var q = String(query || '').toLowerCase();
    var pool = knownNames.length ? knownNames : collectNames();
    var starts = pool.filter(function (u) { return u.username.toLowerCase().indexOf(q) === 0; });
    var contains = pool.filter(function (u) { return u.username.toLowerCase().indexOf(q) > 0; });
    var items = starts.concat(contains);
    // show everyone when nothing typed yet, capped
    items = items.slice(0, 8);
    menuState.items = items;
    menuState.index = 0;
    var m = ensureMenu();
    if (!items.length) {
      m.innerHTML = '<div class="mention-empty">No user matches “' + q.replace(/[<>&]/g, '') + '”</div>';
    } else {
      m.innerHTML = '<div class="mention-head">Mention someone</div>' + items.map(function (u, i) {
        var av = u.avatar || 'icon-192.png';
        return '<div class="mention-item' + (i === 0 ? ' active' : '') + (u.online ? '' : ' offline') + '" data-name="' + u.username.replace(/"/g, '&quot;') + '">' +
          '<img src="' + av.replace(/"/g, '&quot;') + '" alt="">' +
          '<span class="mi-name">@' + u.username.replace(/[<>&]/g, '') + '</span>' +
          (u.online ? '<span class="mi-dot">online</span>' : '') +
          '</div>';
      }).join('');
    }
    m.hidden = false;
    menuState.open = true;
    placeMenu(input);
    m.querySelectorAll('.mention-item').forEach(function (el) {
      el.addEventListener('mousedown', function (e) {
        e.preventDefault();       // keep focus in the composer
        insertMention(el.dataset.name);
      });
    });
  }

  function moveMenu(delta) {
    if (!menuState.open || !menuState.items.length) return;
    menuState.index = (menuState.index + delta + menuState.items.length) % menuState.items.length;
    var nodes = menu.querySelectorAll('.mention-item');
    nodes.forEach(function (n, i) { n.classList.toggle('active', i === menuState.index); });
    if (nodes[menuState.index] && nodes[menuState.index].scrollIntoView) {
      try { nodes[menuState.index].scrollIntoView({ block: 'nearest' }); } catch (e) {}
    }
  }

  function insertMention(name) {
    var input = menuState.input;
    if (!input || !name) { closeMenu(); return; }
    var value = input.value;
    var before = value.slice(0, menuState.start);
    var after = value.slice(menuState.end);
    var insertion = '@' + name + ' ';
    input.value = before + insertion + after;
    var caret = (before + insertion).length;
    try { input.setSelectionRange(caret, caret); } catch (e) {}
    input.dispatchEvent(new Event('input', { bubbles: true }));
    if (typeof input.focus === 'function') input.focus();
    closeMenu();
  }

  // Called from the composer on every input/keydown.
  function composerInput(input, caretOverride) {
    if (!input) return false;
    var value = input.value || '';
    var caret = typeof caretOverride === 'number' ? caretOverride
      : (typeof input.selectionStart === 'number' ? input.selectionStart : value.length);
    var before = value.slice(0, caret);
    var at = before.lastIndexOf('@');
    if (at === -1) { closeMenu(); return false; }
    // must be the start of a word
    var prev = at > 0 ? before.charAt(at - 1) : '';
    if (prev && !/\s/.test(prev) && prev !== '(' ) { closeMenu(); return false; }
    var query = before.slice(at + 1);
    if (/[\n\r]/.test(query) || query.length > 24 || /\s{2,}/.test(query)) { closeMenu(); return false; }
    menuState.input = input;
    menuState.start = at;
    menuState.end = caret;
    renderMenu(query);
    return menuState.open;
  }

  function composerKey(e) {
    if (!menuState.open) return false;
    if (e.key === 'ArrowDown') { e.preventDefault(); moveMenu(1); return true; }
    if (e.key === 'ArrowUp') { e.preventDefault(); moveMenu(-1); return true; }
    if (e.key === 'Enter' || e.key === 'Tab') {
      var chosen = menuState.items[menuState.index];
      if (chosen) { e.preventDefault(); e.stopPropagation(); insertMention(chosen.username); return true; }
    }
    if (e.key === 'Escape') { e.preventDefault(); closeMenu(); return true; }
    return false;
  }

  // Wrap @names inside a rendered message body.
  function decorate(rootEl, myName) {
    if (!rootEl) return;
    var names = knownNames.length ? knownNames : collectNames();
    if (!names.length) return;
    var sorted = names.map(function (u) { return u.username; })
      .sort(function (a, b) { return b.length - a.length; })
      .map(function (n) { return n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); });
    var re = new RegExp('@(' + sorted.join('|') + ')', 'gi');
    var me = String(myName || '').toLowerCase();
    var walker = document.createTreeWalker(rootEl, NodeFilter.SHOW_TEXT, {
      acceptNode: function (node) {
        if (!node.nodeValue || node.nodeValue.indexOf('@') === -1) return NodeFilter.FILTER_REJECT;
        var p = node.parentNode;
        if (!p) return NodeFilter.FILTER_REJECT;
        if (/^(A|MARK|CODE|PRE|TEXTAREA)$/.test(p.nodeName)) return NodeFilter.FILTER_REJECT;
        if (p.closest && p.closest('a.file-attachment, .file-attachment')) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    var targets = [];
    var node;
    while ((node = walker.nextNode())) targets.push(node);
    targets.forEach(function (textNode) {
      var text = textNode.nodeValue;
      if (!re.test(text)) { re.lastIndex = 0; return; }
      re.lastIndex = 0;
      var frag = document.createDocumentFragment();
      var from = 0, m;
      while ((m = re.exec(text)) !== null) {
        if (m.index > from) frag.appendChild(document.createTextNode(text.slice(from, m.index)));
        var span = document.createElement('span');
        span.className = 'mention' + (me && m[1].toLowerCase() === me ? ' mention-me' : '');
        span.textContent = '@' + m[1];
        frag.appendChild(span);
        from = m.index + m[0].length;
      }
      if (from < text.length) frag.appendChild(document.createTextNode(text.slice(from)));
      textNode.parentNode.replaceChild(frag, textNode);
    });
  }

  function mentionedMe(text, myName) {
    if (!myName) return false;
    var esc = String(myName).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp('(^|[^\\w@])@' + esc + '(\\b|$)', 'i').test(String(text || ''));
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // System notifications (outside the app)
  // ═══════════════════════════════════════════════════════════════════════════
  var NOTIFY_KEY = 'ptr29_notify_v1';
  var notifyPref = true;
  try { notifyPref = localStorage.getItem(NOTIFY_KEY) !== '0'; } catch (e) {}

  function permission() { return ('Notification' in window) ? Notification.permission : 'unsupported'; }

  function requestPermission() {
    if (!('Notification' in window)) return Promise.resolve('unsupported');
    if (Notification.permission === 'granted' || Notification.permission === 'denied') {
      return Promise.resolve(Notification.permission);
    }
    try {
      var p = Notification.requestPermission();
      return (p && typeof p.then === 'function') ? p : new Promise(function (res) { res(Notification.permission); });
    } catch (e) { return Promise.resolve('denied'); }
  }

  function fire(title, body, opts) {
    opts = opts || {};
    if (!notifyPref) return false;
    if (permission() !== 'granted') return false;
    var room = opts.room || '';
    var payload = { body: String(body || '').slice(0, 220), icon: 'icon-192.png', badge: 'icon-192.png',
                    tag: opts.tag || ('ptr29-' + (room || 'app')), renotify: !!opts.renotify, data: { room: room, url: room ? '?room=' + encodeURIComponent(room) : '.' } };
    // preferred path: the service worker shows it, so it also appears when the
    // tab is in the background or the phone is locked
    try {
      if (navigator.serviceWorker && navigator.serviceWorker.ready) {
        navigator.serviceWorker.ready.then(function (reg) {
          try { reg.showNotification(String(title || 'ptr_29 Chat'), payload); }
          catch (e) { legacy(); }
        }).catch(function () { legacy(); });
        return true;
      }
    } catch (e) {}
    legacy();
    return true;

    function legacy() {
      try {
        var n = new Notification(String(title || 'ptr_29 Chat'), payload);
        n.onclick = function () { try { window.focus(); } catch (e) {} try { n.close(); } catch (e) {} };
        setTimeout(function () { try { n.close(); } catch (e) {} }, 9000);
      } catch (e) {}
    }
  }

  function setPref(on, askPermission) {
    notifyPref = !!on;
    try { localStorage.setItem(NOTIFY_KEY, notifyPref ? '1' : '0'); } catch (e) {}
    if (notifyPref && askPermission !== false && permission() === 'default') {
      return requestPermission();
    }
    return Promise.resolve(permission());
  }

  // host state shared with client.js (presence + offline caches)
  window.PTR29HostState = window.PTR29HostState || {
    presence: function () { return []; },
    offline: function () { return []; }
  };

  window.PTR29Chat = {
    search: {
      attach: attach,
      cancel: cancelSearch,
      run: function (query, ctx) { runSearch(ctx || current || { wrap: document.getElementById('room-bar'), input: null, room: function () { return ''; } }, query); },
      step: step,
      count: function () { return hits.length; }
    },
    mentions: {
      composerInput: composerInput,
      composerKey: composerKey,
      close: closeMenu,
      decorate: decorate,
      refreshNames: collectNames,
      names: function () { return knownNames; },
      mentionedMe: mentionedMe
    },
    notify: {
      fire: fire,
      setPref: setPref,
      pref: function () { return notifyPref; },
      permission: permission,
      requestPermission: requestPermission
    }
  };
})();
