/* Real-interaction test of the LIVE site's back buttons via CDP.
 * Uses coordinate-based Input events (real hit-testing) and tracks the
 * history stack to expose the stale-entry bug.
 * Run: node supabase/back-buttons-test.js   (from Chatting_updated/)
 */
const { spawn } = require('child_process');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const URL = process.argv[2] || 'https://gamer-09.github.io/chat-site/';
const PORT = 9231;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const U = new globalThis.URL(URL);
const BASE = U.origin + (U.pathname.endsWith('/') ? U.pathname : U.pathname + '/');

async function main() {
  const chrome = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-sandbox',
    '--remote-debugging-port=' + PORT, '--window-size=420,900', 'about:blank'
  ], { stdio: 'ignore' });

  let page;
  for (let i = 0; i < 40; i++) {
    await sleep(400);
    try {
      const r = await fetch('http://127.0.0.1:' + PORT + '/json');
      const targets = await r.json();
      page = targets.find(t => t.type === 'page');
      if (page) break;
    } catch {}
  }
  if (!page) { console.log(JSON.stringify({ error: 'no target' })); chrome.kill(); process.exit(1); }

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let msgId = 0;
  const pending = new Map();
  const logs = [];
  const navigations = [];
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === 'Page.frameNavigated') navigations.push(m.params.frame.url);
    if (m.method === 'Runtime.exceptionThrown') {
      logs.push('EXC: ' + (m.params.exceptionDetails.exception && m.params.exceptionDetails.exception.description || m.params.exceptionDetails.text || '').slice(0, 250));
    }
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
      logs.push('ERR: ' + m.params.args.map(a => a.value !== undefined ? a.value : (a.description || '')).join(' ').slice(0, 200));
    }
  };
  const send = (method, params) => new Promise((res) => {
    const id = ++msgId;
    pending.set(id, res);
    ws.send(JSON.stringify({ id, method, params: params || {} }));
  });
  const ev = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.result && r.result.exceptionDetails) return 'JS-ERR: ' + (r.result.exceptionDetails.exception && r.result.exceptionDetails.exception.description || '').slice(0, 160);
    return r.result && r.result.result ? r.result.result.value : undefined;
  };
  const tapCenter = async (selector) => {
    const info = await ev(`(() => {
      const el = document.querySelector('${selector}');
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      const top = document.elementFromPoint(cx, cy);
      return { cx: Math.round(cx), cy: Math.round(cy), hit: top ? (top.id || top.className || top.tagName).toString().slice(0, 60) : 'none', matches: !!top || (top === el) };
    })()`);
    if (!info) return 'no-element';
    // Real hit-tested tap at the element's center
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: info.cx, y: info.cy, button: 'left', clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: info.cx, y: info.cy, button: 'left', clickCount: 1 });
    return info;
  };

  await send('Runtime.enable');
  await send('Page.enable');
  await send('Page.navigate', { url: URL });

  let uid = null;
  for (let i = 0; i < 40; i++) {
    await sleep(1000);
    uid = await ev('window.ChatAPI ? window.ChatAPI.uid : null');
    if (uid) break;
  }

  // Set a username profile and reload so joining works
  await ev(`localStorage.setItem('ptr29_profile_v2', JSON.stringify({username:'BackTester', avatar:'', termsAgreed:true}))`);
  await send('Page.reload');
  await sleep(7000);

  const out = { url: URL, uid };
  out.boot = {
    view: await ev(`document.body.className.match(/ptr29-view-\\w+/)?.[0] || 'none'`),
    isMobile: await ev(`document.body.classList.contains('ptr29-mobile')`)
  };

  // Force mobile mode (as the stylesheet media query would on a real phone)
  await ev(`document.body.classList.add('ptr29-mobile'); var ml=document.getElementById('ptr29-mobile-styles'); if(ml) ml.media='all';`);
  await sleep(1200);

  // 1. Ensure chat view: tap a room from the room list
  await ev(`var r=[...document.querySelectorAll('#room-list .room')].find(x=>x.textContent.includes('general')); if(r) r.click();`);
  await sleep(2500);
  out.chatView = {
    view: await ev(`document.body.className.match(/ptr29-view-\\w+/)?.[0] || 'none'`),
    historyState: await ev(`history.state ? JSON.stringify(history.state) : 'null'`)
  };

  // 2. REAL hit-test on the in-app back button
  out.backBtnHit = await tapCenter('#mobile-back-btn');
  await sleep(800);
  out.afterBackTap = {
    view: await ev(`document.body.className.match(/ptr29-view-\\w+/)?.[0] || 'none'`),
    historyState: await ev(`history.state ? JSON.stringify(history.state) : 'null'`)  // BUG: stays {view:chat}
  };

  // 3. Browser/Android back after the in-app back (this is where the dead press happens)
  const lenBefore = await ev('history.length');
  await ev(`history.back()`);
  await sleep(1000);
  out.browserBackAfterInApp = {
    view: await ev(`document.body.className.match(/ptr29-view-\\w+/)?.[0] || 'none'`),
    stillOnSite: (await ev('location.href')).startsWith(BASE),
    historyLenBefore: lenBefore,
    historyLenAfter: await ev('history.length')
  };

  // 4. Press back AGAIN — with the bug, this pops the stale entry (no visual change).
  //    With the fix, this exits (nothing left), which is correct on the root view.
  await ev(`history.back()`);
  await sleep(1000);
  out.secondBrowserBack = {
    view: await ev(`document.body.className.match(/ptr29-view-\\w+/)?.[0] || 'none'`),
    href: (await ev('location.href')).slice(0, 80)
  };

  // 5. Modal close buttons still work (real taps) — fresh page first
  await send('Page.navigate', { url: URL });
  await sleep(6000);
  await ev(`document.body.classList.add('ptr29-mobile'); var ml=document.getElementById('ptr29-mobile-styles'); if(ml) ml.media='all';`);
  await sleep(1000);
  await tapCenter('#edit-profile-btn');
  await sleep(700);
  out.editModalOpened = await ev(`document.getElementById('edit-profile-modal').classList.contains('open')`);
  const cancelHit = await tapCenter('#cancel-edit-profile');
  await sleep(500);
  out.editModalClosed = await ev(`!document.getElementById('edit-profile-modal').classList.contains('open')`);
  out.cancelHitInfo = cancelHit;

  // 6. Help modal close (real tap on ×)
  await tapCenter('#help-btn');
  await sleep(600);
  out.helpOpened = await ev(`document.getElementById('help-modal').classList.contains('open')`);
  await tapCenter('#help-close-btn');
  await sleep(500);
  out.helpClosed = await ev(`!document.getElementById('help-modal').classList.contains('open')`);

  out.logs = logs.slice(0, 8);
  out.navigations = navigations.slice(-6);
  console.log(JSON.stringify(out, null, 2));
  chrome.kill();
  process.exit(0);
}
main().catch(e => { console.error('TEST FAIL', e.message); process.exit(1); });
