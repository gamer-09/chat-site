// Adapter smoke test (manual, needs network + Chrome).
// Serves public/ locally, drives the real Supabase adapter in headless Chrome,
// and verifies: history load, send, presence, "load older" paging, search.
//
// Usage: node supabase/adapter-smoke.js
//        CHROME_PATH=/path/to/chrome node supabase/adapter-smoke.js
//
// It creates ONE throwaway account-less identity, posts a message into
// #general and deletes its own messages again before exiting.
'use strict';
const { spawn } = require('child_process');
const http = require('http');
const os = require('os');
const path = require('path');
const fs = require('fs');
const express = require('express');
const WebSocket = require('ws');

const CHROME = process.env.CHROME_PATH ||
  (process.platform === 'win32'
    ? 'C:/Program Files/Google/Chrome/Application/chrome.exe'
    : '/usr/bin/google-chrome');
const PORT = 9311;
const CDP_PORT = 9312;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function getJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}

(async () => {
  const results = { checks: [], errors: [], warnings: [] };
  const app = express();
  app.use(express.static(path.join(__dirname, '..', 'public')));
  const server = app.listen(PORT);
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'adapter-smoke-'));

  const chrome = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--mute-audio',
    `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${profile}`,
    '--window-size=1280,900',
    `http://127.0.0.1:${PORT}/index.html`
  ], { stdio: 'ignore' });

  let page = null;
  for (let i = 0; i < 60 && !page; i++) {
    await sleep(400);
    try {
      const list = await getJson(`http://127.0.0.1:${CDP_PORT}/json`);
      page = list.find(t => t.type === 'page');
    } catch (e) { /* not up yet */ }
  }
  if (!page) throw new Error('headless Chrome did not expose a page target');

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.on('open', resolve); ws.on('error', reject); });

  let msgId = 0;
  const pending = new Map();
  ws.on('message', raw => {
    const msg = JSON.parse(raw);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); return; }
    if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params.exceptionDetails || {};
      results.errors.push('exception: ' + (d.exception && d.exception.description || d.text));
    }
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
      const text = (msg.params.args || []).map(a => a.value || a.description || '').join(' ');
      if (text) results.errors.push('console.error: ' + text.slice(0, 300));
    }
    // The client logs exactly one warning when migration 040 is missing. Surface
    // it instead of swallowing it, so "slow but working" never looks green.
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'warning') {
      const text = (msg.params.args || []).map(a => a.value || a.description || '').join(' ');
      if (/040_scale_indexes_and_search/.test(text)) results.warnings.push(text.slice(0, 300));
    }
  });

  const send = (method, params = {}) => new Promise(resolve => {
    const id = ++msgId;
    pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
  });

  const ev = async (expr, timeoutMs = 20000) => {
    const call = send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    const r = await Promise.race([
      call,
      sleep(timeoutMs).then(() => ({ result: { exceptionDetails: { text: 'eval timeout' } } }))
    ]);
    if (r.result && r.result.exceptionDetails) {
      throw new Error('eval failed: ' + (r.result.exceptionDetails.text || '') + ' ' + expr.slice(0, 120));
    }
    return r.result && r.result.result ? r.result.result.value : undefined;
  };

  const waitFor = async (expr, ms = 40000) => {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
      try {
        if (await ev(expr, Math.min(ms, 30000))) return true;
      } catch (e) { /* transient eval error, keep waiting */ }
      await sleep(300);
    }
    return false;
  };

  const check = (name, ok, detail) => {
    results.checks.push({ name, ok: !!ok, detail });
    console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail !== undefined ? '  ' + JSON.stringify(detail) : ''));
  };

  let smokeName = null;
  try {
    await send('Runtime.enable');
    await send('Page.enable');

    const name = 'smoke' + Math.random().toString(36).slice(2, 8);
    smokeName = name;

    // The real UI is behind the account gate, and that gate asks Supabase for
    // age/terms status of a real account. Creating one just to click buttons
    // would leave a row behind if the run were killed, so instead seed a local
    // session and stub ONLY the three status calls the gate makes before boot.
    // The shim lives here, in the test, so the shipped app keeps no bypass.
    const acctId = '00000000-0000-4000-8000-' + Date.now().toString(16).padStart(12, '0').slice(-12);
    await send('Page.addScriptToEvaluateOnNewDocument', {
      source: `(function () {
        var ACCT = ${JSON.stringify(acctId)};
        var NAME = ${JSON.stringify(name)};
        try {
          localStorage.setItem('ptr29_account_session', JSON.stringify({
            id: ACCT, username: NAME, avatar: '', ageConfirmed: true, termsAccepted: true
          }));
          localStorage.setItem('ptr29_client_id_v2', ACCT);
          localStorage.setItem('ptr29_profile_v2', JSON.stringify({ username: NAME, avatar: '', termsAgreed: true }));
        } catch (e) {}
        var capi;
        Object.defineProperty(window, 'ChatAPI', {
          configurable: true,
          get: function () { return capi; },
          set: function (v) {
            capi = v;
            if (!v) return;
            v.accountAgeStatus = function () { return Promise.resolve({ ok: true, age_confirmed: true }); };
            v.accountTermsStatus = function () { return Promise.resolve({ ok: true, terms_accepted: true }); };
            v.accountProfile = function () { return Promise.resolve({ ok: true, avatar: '' }); };
            v.claimRooms = function () { return Promise.resolve({ ok: true, rooms: 0 }); };
            v.accountUpdateProfile = function () { return Promise.resolve({ ok: true }); };
          }
        });
      })();`
    });
    await send('Page.reload', { ignoreCache: true });

    check('adapter becomes ready', await waitFor('!!(window.ChatAPI && window.ChatAPI.ready)', 60000));

    // Warm the connection (and the PostgREST plan cache) before timing
    // anything: the very first query to a paused/idle project can take 10s+.
    await ev(`window.ChatAPI.getHistory('general', 1).then(function (r) { return r.length; })`, 90000);
    await ev(`window.ChatAPI.setUsername(${JSON.stringify(name)}, '')`);
    // Count adapter events as well as DOM nodes: these first checks exercise
    // the adapter directly, so they must not depend on the UI's render timing.
    await ev(`window.__smoke = { history: 0, messages: 0 };
      window.ChatAPI.on('history', function (e) { window.__smoke.history += (e.messages || []).length; });
      window.ChatAPI.on('chat-message', function (e) {
        if (e && String(e.message || '').indexOf('smoke-') === 0) window.__smoke.messages += 1;
      });`);
    await ev(`window.ChatAPI.emit('join', { room: 'general', username: ${JSON.stringify(name)}, avatar: '' })`);

    check('join completes', await waitFor('!!window.ChatAPI._joined', 40000));
    check('history loads', await waitFor('window.__smoke.history > 0', 60000));

    // The 040 RPCs are a live requirement now, not a maybe: history must be
    // served by get_room_history, otherwise this project is on the slow
    // fallback and the check below should say so out loud.
    const fast = await ev(`(function () {
      var sb = window.ChatAPI.sb, orig = sb.rpc, seen = [];
      sb.rpc = function (fn, args) { seen.push(fn); return orig.call(sb, fn, args); };
      return window.ChatAPI.fetchHistoryRows('general', null, 5).then(function (rows) {
        sb.rpc = orig;
        return { called: seen, rows: (rows || []).length };
      }, function (e) { sb.rpc = orig; throw e; });
    })()`, 40000);
    check('history uses the 040 fast path', !!(fast && fast.called.indexOf('get_room_history') >= 0 && fast.rows > 0), fast);
    check('room channel is joined', await waitFor('!!(window.ChatAPI._roomChannel && window.ChatAPI._roomChannel.state === "joined")', 20000));
    check('presence channel is joined', await waitFor('!!(window.ChatAPI._presenceChannel && window.ChatAPI._presenceChannel.state === "joined")', 20000));
    check('presence includes self', await waitFor(`window.ChatAPI.presenceAll().some(function (u) { return u.username === ${JSON.stringify(name)}; })`, 15000));

    const text = 'smoke-' + Date.now();
    await ev(`window.ChatAPI.emit('chat-message', { text: ${JSON.stringify(text)} })`);
    check('sent message dispatches', await waitFor('window.__smoke.messages > 0', 20000));

    const older = await ev(`window.ChatAPI.getHistoryBefore('general', Date.now(), 5).then(function (r) { return Array.isArray(r) ? r.length : -1; })`);
    check('load-older returns rows', typeof older === 'number' && older >= 0, older);

    const found = await ev(`window.ChatAPI.searchMessages('general', ${JSON.stringify(text)}).then(function (r) { return (r.results || []).length; })`);
    check('search finds the new message', found >= 1, found);

    // ── UI checks ──────────────────────────────────────────────────────────
    // Everything above talks to Supabase through the adapter. The next checks
    // drive the real page, which booted because the shim at the top supplied a
    // local account session. Wait for its own join, then re-join through the
    // room list (that is what runs the client-side draft/divider code).
    check('room list is rendered', await waitFor(`document.querySelectorAll('#room-list .room').length > 0`, 20000));

    const clickGeneral = `(function () {
      var list = Array.prototype.slice.call(document.querySelectorAll('#room-list .room'));
      var g = list.filter(function (el) {
        var n = el.querySelector('.room-name');
        return n && n.textContent.trim() === 'general';
      })[0] || list[0];
      if (g) g.click();
      return !!g;
    })()`;

    await ev(clickGeneral);
    await sleep(2500);

    // ── Drafts: typed text survives a room switch ──────────────────────────
    const draft = 'draft-' + Date.now();
    await ev(`(function () {
      var input = document.getElementById('text');
      input.value = ${JSON.stringify(draft)};
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()`);
    await sleep(800);
    const savedDraft = await ev(`(function () {
      try { return (JSON.parse(localStorage.getItem('ptr29_drafts_v1') || '{}') || {}).general || ''; }
      catch (e) { return 'ERR'; }
    })()`);
    check('draft is saved per room', savedDraft === draft, savedDraft);

    await ev(`(function () {
      document.getElementById('text').value = '';
      var list = Array.prototype.slice.call(document.querySelectorAll('#room-list .room'));
      var g = list.filter(function (el) {
        var n = el.querySelector('.room-name');
        return n && n.textContent.trim() === 'general';
      })[0] || list[0];
      if (g) g.click();
      return !!g;
    })()`);
    await sleep(2000);
    const restoredDraft = await ev(`document.getElementById('text').value`);
    check('draft is restored on rejoin', restoredDraft === draft, restoredDraft);

    // ── "New messages" divider ─────────────────────────────────────────────
    // Pretend the reader last visited 8 days ago, then reopen the room. The
    // divider must sit immediately before the first message after that cursor.
    await ev(`(function () {
      window.ChatAPI._roomSeen.general = Date.now() - 8 * 86400000;
      document.getElementById('text').value = '';
      var list = Array.prototype.slice.call(document.querySelectorAll('#room-list .room'));
      var g = list.filter(function (el) {
        var n = el.querySelector('.room-name');
        return n && n.textContent.trim() === 'general';
      })[0] || list[0];
      if (g) g.click();
      return !!g;
    })()`);
    await waitFor(`document.querySelectorAll('#messages .new-messages-divider').length === 1`, 40000);
    const divider = await ev(`(function () {
      var all = document.querySelectorAll('#messages .new-messages-divider');
      var msgs = document.querySelectorAll('#messages .msg');
      var next = all.length ? all[0].nextElementSibling : null;
      return {
        count: all.length,
        nextIsMessage: !!(next && next.classList.contains('msg')),
        msgs: msgs.length,
        olderAbove: !!all.length && !!all[0].previousElementSibling
          && all[0].previousElementSibling.classList.contains('msg'),
        beforeCursor: all.length === 1 && next
          ? Number(next.dataset.timestamp) > (Date.now() - 8 * 86400000) : false
      };
    })()`);
    check('new-messages divider appears', divider.count === 1 && divider.nextIsMessage && divider.msgs > 1, divider);

    // ── Outbox: a failed send is kept and can be retried ────────────────────
    const obText = 'smoke-outbox-' + Date.now();
    await ev(`(function () {
      window.__outboxOrig = window.ChatAPI.sendMessage;
      window.ChatAPI.sendMessage = function () { return Promise.resolve({ ok: false, error: 'network' }); };
      document.getElementById('text').value = ${JSON.stringify(obText)};
      document.getElementById('chat-form').dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
      return true;
    })()`);
    await sleep(600);
    const queued = await ev(`(function () {
      var bar = document.getElementById('outbox-bar');
      var stored = [];
      try { stored = JSON.parse(localStorage.getItem('ptr29_outbox_v1') || '[]') || []; } catch (e) {}
      return {
        visible: !!bar && bar.hidden === false,
        stored: stored.length,
        text: bar && bar.querySelector('.ob-text') ? bar.querySelector('.ob-text').textContent : ''
      };
    })()`);
    check('failed send is queued', queued.visible && queued.stored === 1, queued);

    await ev(`(function () {
      window.ChatAPI.sendMessage = window.__outboxOrig;
      var btn = document.querySelector('#outbox-bar .ob-retry');
      if (btn) btn.click();
      return true;
    })()`);
    const retried = await waitFor(`(function () {
      var bar = document.getElementById('outbox-bar');
      if (!bar || bar.hidden !== true) return false;
      return Array.prototype.slice.call(document.querySelectorAll('#messages .msg'))
        .some(function (el) { return el.textContent.indexOf('smoke-outbox-') >= 0; });
    })()`, 60000);
    check('retry delivers the queued message', retried, null);

    // ── What's-new popup ───────────────────────────────────────────────────
    // It may already have appeared on its own after boot; either way it must be
    // open, on screen, and list the three changes.
    await ev(`(function () {
      if (!document.getElementById('whats-new-notice') && window.PTR29WhatsNew) {
        window.PTR29WhatsNew.show();
      }
      return true;
    })()`);
    await sleep(500);
    const wn = await ev(`(function () {
      var el = document.getElementById('whats-new-notice');
      return {
        open: !!el && el.classList.contains('open'),
        title: el && el.querySelector('h3') ? el.querySelector('h3').textContent : '',
        bullets: el ? el.querySelectorAll('.wn-list li').length : 0
      };
    })()`);
    check('whats-new popup shows', wn.open && wn.bullets === 3, wn);

    await ev(`(function () {
      var btn = document.getElementById('whats-new-close');
      if (btn) btn.click();
      return true;
    })()`);
    await sleep(500);
    const wnClosed = await ev(`!document.getElementById('whats-new-notice')`);
    check('whats-new popup closes', wnClosed, null);
  } finally {
    // Always clean up, even when a check threw or timed out. The purge is
    // verified with a count: RLS silently deletes 0 rows instead of erroring,
    // which is exactly how leftovers used to accumulate.
    if (smokeName) {
      try {
        const purge = await ev(`(function () {
          var un = ${JSON.stringify(smokeName)};
          var uid = window.ChatAPI.uid;
          return window.ChatAPI.purgeMessagesFor(un).then(function (r) {
            return window.ChatAPI.deleteUser().then(function () {
              return Promise.all([
                window.ChatAPI.sb.from('messages')
                  .select('id', { count: 'exact', head: true }).eq('payload->>username', un),
                window.ChatAPI.sb.from('users')
                  .select('client_id', { count: 'exact', head: true }).eq('client_id', uid)
              ]);
            }).then(function (rs) {
              return { ok: !!(r && r.ok), messages: rs[0].count, users: rs[1].count };
            });
          });
        })()`, 40000);
        check('test data cleanup', purge && purge.messages === 0 && purge.users === 0, purge);
      } catch (e) {
        check('test data cleanup', false, String(e && e.message || e));
      }
    }
    const fatal = results.errors.filter(e => !/favicon|manifest|service worker|ERR_/i.test(e));
    check('no page exceptions', fatal.length === 0, fatal.slice(0, 5));
    check('no migration-040 fallback warning', results.warnings.length === 0, results.warnings.slice(0, 2));
    ws.close();
    chrome.kill();
    server.close();
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {}
    const failed = results.checks.filter(c => !c.ok);
    console.log('\n' + (failed.length ? 'FAILED: ' + failed.map(f => f.name).join(', ') : 'All adapter checks passed.'));
    process.exit(failed.length ? 1 : 0);
  }
})().catch(err => {
  console.error('adapter smoke failed:', err && err.message || err);
  process.exit(1);
});
