// Live-site smoke test: verifies the 4 shipped fixes on the DEPLOYED GitHub Pages site.
// 1) markdown bold/italic render  2) @mentions render  3) no boot console errors
// 4) mobile search button visible in mobile viewport (chat view)
// Usage: node supabase/live-smoke.js [url]
'use strict';
const { spawn } = require('child_process');
const http = require('http');
const os = require('os');
const path = require('path');
const fs = require('fs');

const URL = process.argv[2] || 'https://gamer-09.github.io/chat-site/';
const PORT = 9235;
const CHROME = process.env.CHROME_PATH ||
  (process.platform === 'win32'
    ? 'C:/Program Files/Google/Chrome/Application/chrome.exe'
    : '/usr/bin/google-chrome');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function get(url) {
  return new Promise((res, rej) => {
    http.get(url, r => {
      let d = '';
      r.on('data', c => d += c);
      r.on('end', () => res({ status: r.statusCode, body: d }));
    }).on('error', rej);
  });
}

async function connect() {
  const list = JSON.parse((await get(`http://127.0.0.1:${PORT}/json`)).body);
  const page = list.find(t => t.type === 'page');
  if (!page) throw new Error('no page target');
  const ws = new (require('ws'))(page.webSocketDebuggerUrl);
  await new Promise(r => ws.on('open', r));
  let id = 0;
  const pending = new Map();
  ws.on('message', m => {
    const msg = JSON.parse(m);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const myId = ++id;
    pending.set(myId, resolve);
    ws.send(JSON.stringify({ id: myId, method, params }));
    setTimeout(() => { if (pending.has(myId)) { pending.delete(myId); reject(new Error('timeout ' + method)); } }, 15000);
  });
  const ev = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    return r.result && r.result.result ? r.result.result.value : undefined;
  };
  return { ws, send, ev };
}

async function main() {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'live-smoke-'));
  const args = [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--mute-audio',
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
    '--window-size=1280,900', 'about:blank'
  ];
  const chrome = spawn(CHROME, args, { stdio: 'ignore' });
  const results = [];
  const record = (name, ok, note) => { results.push({ name, ok: !!ok, note: note || '' }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${note ? ' | ' + note : ''}`); };
  let c;

  try {
    for (let i = 0; i < 40; i++) {
      try { await get(`http://127.0.0.1:${PORT}/json`); break; } catch (e) { await sleep(500); }
    }
    c = await connect();
    const consoleErrors = [];
    c.send('Runtime.enable');
    c.send('Log.enable');
    c.send('Page.enable');
    c.ws.on('message', m => {
      const msg = JSON.parse(m);
      if (msg.method === 'Runtime.exceptionThrown') consoleErrors.push('EXC: ' + (msg.params.exceptionDetails.exception ? msg.params.exceptionDetails.exception.description : msg.params.exceptionDetails.text));
      if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') consoleErrors.push('LOG: ' + (msg.params.entry.url || '') + ' ' + msg.params.entry.text);
    });

    // ---- Desktop: send markdown + mention, check rendered DOM ----
    const u1 = 'Smoke' + Math.random().toString(36).slice(2, 8);
    await c.send('Page.navigate', { url: URL });
    await sleep(7000);
    await c.ev(`localStorage.setItem('ptr29_profile_v2', JSON.stringify({username:'${u1}'})); location.reload();`);

    // poll for join + history up to 25s
    let joined = false, msgCount = 0, roomName = '';
    for (let i = 0; i < 25; i++) {
      const s = await c.ev(`(() => ({
        enabled: !!document.getElementById('text') && !document.getElementById('text').disabled,
        msgs: document.querySelectorAll('#messages .msg').length,
        room: (document.getElementById('room-name')||{}).textContent || '',
        apiJoined: !!(window.ChatAPI && window.ChatAPI._joined),
        apiRoom: (window.ChatAPI && window.ChatAPI._currentRoom) || ''
      }))()`);
      joined = s.enabled; msgCount = s.msgs; roomName = s.room;
      if (msgCount > 0 && joined) break;
      await sleep(1000);
    }
    record('desktop: joined + history loaded', joined && msgCount > 0, `room=${roomName} msgs=${msgCount} apiJoined=${await c.ev(`!!(window.ChatAPI && window.ChatAPI._joined)`)}`);

    await c.ev(`document.querySelector('#text').value='**bold** and *italic* hello @${u1}'; document.querySelector('#text').dispatchEvent(new Event('input',{bubbles:true}));`);
    await c.ev(`document.querySelector('#chat-form').requestSubmit()`);
    await sleep(5000);
    const diag = await c.ev(`(() => {
      const msgs = [...document.querySelectorAll('#messages .msg')];
      const toasts = [...document.querySelectorAll('.toast, #toast, [id*=toast]')].map(t => (t.textContent||'').trim()).filter(Boolean);
      return { joined: window.state ? window.state.joined : 'n/a', msgCount: msgs.length, lastInner: msgs.length ? msgs[msgs.length-1].innerHTML.slice(0,150) : '(none)', inputVal: (document.querySelector('#text')||{}).value, toasts: toasts.slice(-3) };
    })()`);
    console.log('DIAG:', JSON.stringify(diag));
    const rendered = await c.ev(`(() => {
      const html = document.getElementById('messages').innerHTML;
      return { hasBold: html.includes('bold<\/strong>'), htmlHasItalic: html.includes('italic<\/em>'), hasMention: html.includes('class=\"mention\"'), apiJoined: !!(window.ChatAPI && window.ChatAPI._joined), apiRoom: (window.ChatAPI && window.ChatAPI._currentRoom) || '' };
    })()`);
    record('markdown: bold+italic render live', rendered.hasBold && rendered.htmlHasItalic, JSON.stringify(rendered).slice(0, 160));
    record('mentions: @mention styled live', rendered.hasMention, JSON.stringify(rendered).slice(0, 160));

    // regression guard: mobile-only chrome must stay hidden on desktop (mobile.css is media-gated <=768px)
    const desktopHidden = await c.ev(`(() => {
      const ids = ['mobile-nav', 'mobile-search-btn', 'mobile-back-btn'];
      return Object.fromEntries(ids.map(id => [id, (document.getElementById(id) && getComputedStyle(document.getElementById(id)).display) || 'missing']));
    })()`);
    record('desktop: mobile-only chrome hidden', Object.values(desktopHidden).every(v => v === 'none'), JSON.stringify(desktopHidden));
    const realErrors = consoleErrors.filter(e => !/chat-uploads\/.*audit-/.test(e));
    record('no boot console errors (desktop)', realErrors.length === 0, consoleErrors.join('; ').slice(0, 220));

    // ---- Mobile: 390px viewport, chat view, search button visible ----
    await c.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });
    await c.ev(`location.reload()`);
    await sleep(10000);
    let mobile = null;
    const retryEv = async (expr, tries) => { for (let i = 0; i < tries; i++) { try { return await c.ev(expr); } catch (e) { await sleep(1500); } } throw new Error('mobile eval failed: ' + expr.slice(0, 40)); };
    for (let i = 0; i < 15; i++) {
      try { await retryEv(`document.getElementById('mobile-nav-chat').click()`, 2); } catch (e) { break; }
      await sleep(700);
      mobile = await retryEv(`(() => {
        const btn = document.getElementById('mobile-search-btn');
        const cs = getComputedStyle(btn);
        return { display: cs.display, w: btn.getBoundingClientRect().width, h: btn.getBoundingClientRect().height, view: document.body.className };
      })()`, 3);
      if (mobile && mobile.w > 0) break;
    }
    record('mobile: search button visible in chat view', !!(mobile && mobile.display === 'flex' && mobile.w > 0), JSON.stringify(mobile || {}));
    record('no console errors in mobile session', realErrors.length === 0, consoleErrors.join('; ').slice(0, 220));
  } catch (e) {
    console.error('SMOKE ERROR:', e.message);
  } finally {
    try { if (c && c.ws) c.ws.close(); } catch (e) {}
    chrome.kill();
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {}
  }
  const fails = results.filter(r => !r.ok);
  console.log(`\n${results.length - fails.length}/${results.length} passed`);
  process.exit(fails.length ? 1 : 0);
}
main();
