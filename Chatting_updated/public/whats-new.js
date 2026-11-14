/**
 * whats-new.js — one-time "what's new" popup.
 *
 * Shows once per CONTENT_VERSION, per browser. Bump the version string when the
 * copy changes and every returning visitor sees it again exactly once.
 *
 * Deliberately self-contained (like update-check.js / halloween-notice.js): it
 * touches no app state, never auto-closes anything, and waits for the account
 * gates and the guided tour to finish before covering the screen.
 */
(function () {
  'use strict';

  // Bump this when the bullets change: it is the storage value, not the build id,
  // so a normal deploy stays quiet and a real announcement does not.
  var CONTENT_VERSION = '2026-11-14-unsent-drafts-divider';
  var SEEN_KEY = 'ptr29_whatsnew_seen_v1';
  var MAX_WAIT_MS = 2 * 60 * 1000;

  var overlay = null;
  var pollTimer = null;
  var startedAt = Date.now();

  function alreadySeen() {
    try { return localStorage.getItem(SEEN_KEY) === CONTENT_VERSION; } catch (e) { return false; }
  }

  function markSeen() {
    try { localStorage.setItem(SEEN_KEY, CONTENT_VERSION); } catch (e) {}
  }

  // Anything that already owns the screen wins. We try again shortly.
  function blocked() {
    if (document.getElementById('ag-overlay')) return true;
    if (document.getElementById('ag-age-overlay')) return true;
    if (document.getElementById('ag-terms-overlay')) return true;
    if (document.getElementById('tour-overlay')) return true;
    if (document.getElementById('update-notice')) return true;
    if (document.getElementById('hw-notice')) return true;
    return !!document.querySelector('.modal-overlay.open, .lightbox.open');
  }

  function appReady() {
    return !!(window.ChatAPI && window.ChatAPI.ready);
  }

  function close() {
    if (!overlay) return;
    var node = overlay;
    overlay = null;
    node.classList.remove('open');
    setTimeout(function () { if (node.parentNode) node.remove(); }, 260);
    if (window.PTR29WhatsNew && window.PTR29WhatsNew._restoreFocus) {
      try { window.PTR29WhatsNew._restoreFocus(); } catch (e) {}
    }
  }

  function dismiss() {
    markSeen();
    close();
  }

  function build() {
    var previouslyFocused = document.activeElement;

    overlay = document.createElement('div');
    overlay.id = 'whats-new-notice';
    overlay.className = 'modal-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'whats-new-title');

    overlay.innerHTML =
      '<div class="modal wn-card">' +
        '<div class="wn-icon" aria-hidden="true">✨</div>' +
        '<h3 id="whats-new-title">What\'s new</h3>' +
        '<p class="wn-sub">Three small changes that make the chat harder to lose things in.</p>' +
        '<ul class="wn-list">' +
          '<li><span class="wn-emoji" aria-hidden="true">🛟</span><div>' +
            '<b>Unsent messages are kept</b>' +
            '<span>If a message cannot be delivered it waits in a bar above the composer. Retry it, ' +
            'or let it resend itself when your connection is back. Nothing is thrown away.</span>' +
          '</div></li>' +
          '<li><span class="wn-emoji" aria-hidden="true">✍️</span><div>' +
            '<b>A draft for every room</b>' +
            '<span>Switch rooms without losing what you were typing, and without carrying it into ' +
            'the wrong room. Each room remembers its own draft.</span>' +
          '</div></li>' +
          '<li><span class="wn-emoji" aria-hidden="true">🔖</span><div>' +
            '<b>Pick up where you stopped</b>' +
            '<span>A <i>New messages</i> line marks the first message you have not read yet, and the ' +
            'tab title shows your unread total.</span>' +
          '</div></li>' +
        '</ul>' +
        '<div class="wn-actions">' +
          '<button type="button" id="whats-new-close">Got it</button>' +
        '</div>' +
      '</div>';

    document.body.appendChild(overlay);

    var btn = overlay.querySelector('#whats-new-close');
    btn.addEventListener('click', dismiss);
    overlay.addEventListener('click', function (e) { if (e.target === overlay) dismiss(); });
    document.addEventListener('keydown', function onKey(e) {
      if (!overlay) { document.removeEventListener('keydown', onKey); return; }
      if (e.key === 'Escape') dismiss();
    });

    window.PTR29WhatsNew._restoreFocus = function () {
      if (previouslyFocused && previouslyFocused.focus && document.contains(previouslyFocused)) {
        try { previouslyFocused.focus(); } catch (e) {}
      }
    };

    // Only steal focus if the person was not already typing somewhere.
    if (!previouslyFocused || previouslyFocused === document.body) {
      setTimeout(function () { try { btn.focus(); } catch (e) {} }, 80);
    }

    requestAnimationFrame(function () { if (overlay) overlay.classList.add('open'); });
  }

  function show(force) {
    if (!force && alreadySeen()) return false;
    if (overlay) return false;
    if (!appReady()) return false;
    // A manual replay (demo / smoke test) may cover the gate; the automatic
    // path waits its turn so it never stacks on the age/terms screens.
    if (!force && blocked()) return false;
    build();
    if (!force) markSeen();
    return true;
  }

  function tick() {
    if (overlay) return;
    if (!forceWanted() && alreadySeen()) return stop();
    if (Date.now() - startedAt > MAX_WAIT_MS) return stop();   // try again next visit
    if (!appReady() || blocked()) {
      pollTimer = setTimeout(tick, 1500);
      return;
    }
    show(forceWanted());
    stop();
  }

  // `?whatsnew` replays the popup without touching storage, for demos/testing.
  var forceFlag = false;
  function forceWanted() {
    if (forceFlag) return true;
    try { return new URLSearchParams(location.search).has('whatsnew'); } catch (e) { return false; }
  }

  function stop() {
    if (pollTimer) { clearTimeout(pollTimer); pollTimer = null; }
  }

  function start() {
    // Give the first paint, the account gate and the initial history a moment.
    setTimeout(tick, 2500);
  }

  window.PTR29WhatsNew = {
    show: function () { forceFlag = true; return show(true); },
    close: close,
    _version: CONTENT_VERSION,
    _restoreFocus: null
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();
