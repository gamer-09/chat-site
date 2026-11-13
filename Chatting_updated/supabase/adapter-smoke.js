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
  const results = { checks: [], errors: [] };
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

    check('adapter becomes ready', await waitFor('!!(window.ChatAPI && window.ChatAPI.ready)', 60000));

    // Warm the connection (and the PostgREST plan cache) before timing
    // anything: the very first query to a paused/idle project can take 10s+.
    await ev(`window.ChatAPI.getHistory('general', 1).then(function (r) { return r.length; })`, 90000);

    const name = 'smoke' + Math.random().toString(36).slice(2, 8);
    smokeName = name;
    await ev(`window.ChatAPI.setUsername(${JSON.stringify(name)}, '')`);
    // Count adapter events instead of DOM nodes: this test exercises the
    // Supabase adapter, not the rendering layer (the app gates its own UI
    // behind the account screen, which the adapter has no part in).
    await ev(`window.__smoke = { history: 0, messages: 0 };
      window.ChatAPI.on('history', function (e) { window.__smoke.history += (e.messages || []).length; });
      window.ChatAPI.on('chat-message', function (e) {
        if (e && String(e.message || '').indexOf('smoke-') === 0) window.__smoke.messages += 1;
      });`);
    await ev(`window.ChatAPI.emit('join', { room: 'general', username: ${JSON.stringify(name)}, avatar: '' })`);

    check('join completes', await waitFor('!!window.ChatAPI._joined', 40000));
    check('history loads', await waitFor('window.__smoke.history > 0', 60000));
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
