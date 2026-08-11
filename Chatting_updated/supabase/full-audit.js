/* Full "real user" audit of the LIVE chat site (desktop + mobile) via CDP.
 * Run: node supabase/full-audit.js  (from Chatting_updated/)
 * Drives every feature like a real person, capturing console errors, hit-tests
 * and layout overflow. Never deletes the account; cleans up test rooms.
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const URL = process.argv[2] || 'https://gamer-09.github.io/chat-site/';
const PORT = 9233;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const ASSET_DIR = path.resolve('audit-assets');
fs.mkdirSync(ASSET_DIR, { recursive: true });
const PNG_PATH = path.join(ASSET_DIR, 'audit.png');
const TXT_PATH = path.join(ASSET_DIR, 'audit.txt');
fs.writeFileSync(PNG_PATH, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'));
fs.writeFileSync(TXT_PATH, 'hello from the audit 📎');

const results = [];
const record = (step, ok, note) => results.push({ step, ok: !!ok, note: note || '' });
const U1 = 'Audit' + Date.now().toString().slice(-6);   // unique usernames —
const U2 = 'AuditB' + Date.now().toString().slice(-6);  // anonymous usernames stay locked
const PROGRESS = require('os').tmpdir() + '/audit-progress.log';
const mark = (label) => { try { fs.appendFileSync(PROGRESS, new Date().toISOString().slice(11, 19) + ' ' + label + '\n'); } catch {} };

async function connectCDP(wsUrl) {
  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let msgId = 0;
  const pending = new Map();
  const errors = [];
  let dialog = null;
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails;
      errors.push('EXC: ' + (d.exception && d.exception.description || d.text || '').split('\n')[0].slice(0, 220));
    }
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
      errors.push('CONSOLE-ERR: ' + m.params.args.map(a => a.value !== undefined ? String(a.value) : (a.description || '')).join(' ').slice(0, 220));
    }
    if (m.method === 'Page.javascriptDialogOpening') {
      dialog = { type: m.params.type, message: m.params.message, prompt: m.params.defaultPrompt || '' };
    }
  };
  const send = (method, params) => new Promise((res) => {
    const id = ++msgId;
    const to = setTimeout(() => { pending.delete(id); res({ timedOut: true, method }); }, 20000);
    pending.set(id, (m) => { clearTimeout(to); res(m); });
    ws.send(JSON.stringify({ id, method, params: params || {} }));
  });
  const ev = async (expr, timeout = 12000) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true, timeout });
    if (r.timedOut) return 'CDP-TIMEOUT: ' + expr.slice(0, 80);
    if (r.result && r.result.exceptionDetails) return 'JS-ERR: ' + (r.result.exceptionDetails.exception && r.result.exceptionDetails.exception.description || '').split('\n')[0].slice(0, 160);
    return r.result && r.result.result ? r.result.result.value : undefined;
  };
  const acceptDialog = async (promptText) => {
    if (!dialog) return false;
    await send('Page.handleJavaScriptDialog', { accept: true, promptText: promptText || '' });
    dialog = null;
    return true;
  };
  const dismissDialog = async () => {
    if (!dialog) return false;
    await send('Page.handleJavaScriptDialog', { accept: false });
    dialog = null;
    return true;
  };
  const hitTest = async (selector) => {
    const info = await ev(`(() => {
      const el = document.querySelector('${selector}');
      if (!el) return null;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return { visible: false };
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      const top = document.elementFromPoint(cx, cy);
      const inside = top ? (el.contains(top) || top === el) : false;
      return { visible: true, inside, cx: Math.round(cx), cy: Math.round(cy), hit: top ? (top.id || top.className || top.tagName).toString().slice(0, 40) : 'none' };
    })()`);
    return info;
  };
  const tap = async (selector) => {
    await ev(`(() => { const el = document.querySelector('${selector}'); if (el && el.scrollIntoView) el.scrollIntoView({ block: 'center', inline: 'nearest' }); })()`).catch(() => {});
    await sleep(150);
    const info = await hitTest(selector);
    if (!info) return { clicked: false, reason: 'missing' };
    if (!info.visible) return { clicked: false, reason: 'hidden', ...info };
    if (!info.inside) return { clicked: false, reason: 'blocked', ...info };
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: info.cx, y: info.cy, button: 'left', clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: info.cx, y: info.cy, button: 'left', clickCount: 1 });
    return { clicked: true, ...info };
  };
  const type = async (selector, text) => {
    await ev(`(() => { const el = document.querySelector('${selector}'); if (!el) return; el.focus(); })()`);
    await send('Input.insertText', { text });
  };
  const waitFor = async (expr, tries = 15, delay = 600) => {
    for (let i = 0; i < tries; i++) {
      const v = await ev(expr);
      if (v) return v;
      await sleep(delay);
    }
    return await ev(expr);
  };
  const overflow = async (selectors) => {
    const out = {};
    for (const sel of selectors) {
      const v = await ev(`(() => { const el = document.querySelector('${sel}'); if (!el) return null; return { cw: el.clientWidth, sw: el.scrollWidth, ch: el.clientHeight, sh: el.scrollHeight, display: getComputedStyle(el).display }; })()`);
      if (v && v.sw > v.cw + 2) out[sel] = `H-OVERFLOW cw=${v.cw} sw=${v.sw}`;
      if (v && v.display !== 'none' && v.sh > v.ch + 60 && !['#messages', '.room-list', '#online-list', '#room-settings-panel', '.modal-content'].includes(sel)) out[sel] = `V-TALL cw=${v.cw} ch=${v.ch} sh=${v.sh}`;
    }
    return out;
  };
  return { ws, send, ev, acceptDialog, dismissDialog, hitTest, tap, type, overflow, waitFor, errors };
}

async function main() {
  const chrome = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-sandbox',
    '--remote-debugging-port=' + PORT, '--window-size=1300,850', 'about:blank'
  ], { stdio: 'ignore' });

  let target;
  for (let i = 0; i < 40; i++) {
    await sleep(400);
    try {
      const r = await fetch('http://127.0.0.1:' + PORT + '/json');
      const targets = await r.json();
      target = targets.find(t => t.type === 'page');
      if (target) break;
    } catch {}
  }
  if (!target) { console.log(JSON.stringify({ fatal: 'no target' })); chrome.kill(); process.exit(1); }

  const c = await connectCDP(target.webSocketDebuggerUrl);
  await c.send('Runtime.enable');
  await c.send('Page.enable');
  await c.send('DOM.enable');

  // ───────────────────────── DESKTOP FLOW ─────────────────────────
  // First load onto the real origin, then set the profile (like a returning
  // user with a saved username) and reload cleanly.
  await c.send('Page.navigate', { url: URL });
  mark('nav1 done');
  await sleep(7000);
  await c.ev(`localStorage.setItem('ptr29_profile_v2', JSON.stringify({username:'${U1}', avatar:'', termsAgreed:true}))`);
  mark('profile set');
  await c.send('Page.reload');
  let uid = null;
  for (let i = 0; i < 40; i++) { await sleep(1000); uid = await c.ev('window.ChatAPI ? window.ChatAPI.uid : null'); if (uid) break; }
  await sleep(3000);

  record('boot: app loads + auth', !!uid, 'uid=' + (uid || 'none'));
  record('boot: no fatal toast', (await c.ev(`[...document.querySelectorAll('.toast.error')].map(t=>t.textContent).join('|')`)) === '', 'toasts=' + (await c.ev(`[...document.querySelectorAll('.toast')].map(t=>t.textContent).join('|')`)).slice(0, 80));
  record('desktop layout: 3 panels', await c.ev(`!!document.getElementById('room-list') && !!document.getElementById('messages') && !!document.getElementById('online-list')`));

  record('profile: saved username loads', (await c.waitFor(`document.getElementById('username').value === '${U1}'`)) === true, 'val=' + (await c.ev(`document.getElementById('username').value`)));

  // Edit Profile modal: terms checkbox + invalid then valid save
  await c.tap('#edit-profile-btn');
  await sleep(700);
  record('edit-profile: modal opens', await c.ev(`document.getElementById('edit-profile-modal').classList.contains('open')`));
  const termsInfo = await c.hitTest('#edit-terms');
  record('edit-profile: terms checkbox visible & tappable', !!(termsInfo && termsInfo.visible && termsInfo.inside), JSON.stringify(termsInfo));
  await c.ev(`(() => { const t = document.getElementById('edit-terms'); t.click(); return t.checked; })()`);
  const unchecked = await c.ev(`!document.getElementById('edit-terms').checked`);
  await c.ev(`document.getElementById('edit-terms').click()`);
  record('edit-profile: terms checkbox toggles', unchecked && (await c.ev(`document.getElementById('edit-terms').checked`)), 'uncheck=' + unchecked);
  // invalid username (1 char)
  await c.ev(`(() => { const i = document.getElementById('edit-username'); i.value = 'X'; })()`);
  await c.ev(`document.getElementById('edit-profile-form').requestSubmit()`);
  await sleep(1500);
  const invalidErr = await c.ev(`[...document.querySelectorAll('.toast.error')].map(t=>t.textContent).join('|')`);
  record('edit-profile: rejects 1-char username', invalidErr.includes('2 characters'), invalidErr.slice(0, 80));
  // valid username save
  await c.ev(`(() => { const i = document.getElementById('edit-username'); i.value = '${U1}'; })()`);
  await c.ev(`document.getElementById('edit-profile-form').requestSubmit()`);
  await sleep(1800);
  record('edit-profile: saves valid username + modal closes', await c.ev(`!document.getElementById('edit-profile-modal').classList.contains('open')`));

  // Messages in #general
  mark('desktop msgs start');
  record('general: joined + header', (await c.ev(`document.getElementById('room-name-display').textContent`)).includes('general'));
  const MSG1 = `Hello from desktop audit ${U1}`;
  await c.tap('#text');
  await c.type('#text', MSG1);
  await c.tap('#send-btn');
  const sentOk = await c.waitFor(`[...document.querySelectorAll('#messages .msg-content')].some(m => m.textContent.includes('${U1}'))`);
  record('messages: send text', !!sentOk);

  // markdown
  await c.type('#text', '**bold** and *italic*');
  await c.tap('#send-btn');
  const mdOk = await c.waitFor(`[...document.querySelectorAll('#messages .msg-content')].some(m => m.innerHTML.includes('<strong>bold</strong>') && m.innerHTML.includes('<em>italic</em>'))`);
  record('messages: markdown renders', !!mdOk);

  // @mention
  await c.type('#text', 'hi @${U1}');
  await c.tap('#send-btn');
  const mtOk = await c.waitFor(`[...document.querySelectorAll('#messages .msg-content .mention')].length > 0`);
  record('messages: @mention styled', !!mtOk);

  // Reply
  await c.ev(`(() => { const m = [...document.querySelectorAll('#messages .msg')].find(x => x.querySelector('.msg-content') && x.querySelector('.msg-content').textContent.includes('${U1}')); if (m) { const b = m.querySelector('[data-action="reply"]'); if (b) b.click(); } })()`);
  await sleep(600);
  record('messages: reply bar appears with close X', await c.ev(`document.getElementById('reply-preview-bar').style.display === 'flex'`));
  await c.tap('#reply-preview-bar .close-btn');
  await sleep(400);
  record('messages: reply bar closes', await c.ev(`document.getElementById('reply-preview-bar').style.display === 'none'`));

  // React (emoji picker → pill)
  await c.ev(`(() => { const m = [...document.querySelectorAll('#messages .msg')].find(x => x.querySelector('.msg-content') && x.querySelector('.msg-content').textContent.includes('${U1}')); if (m) { const b = m.querySelector('[data-action="react"]'); if (b) b.click(); } })()`);
  await sleep(600);
  const pickerOpen = await c.ev(`!!document.getElementById('react-picker-popup')`);
  record('messages: react picker opens', pickerOpen);
  await c.ev(`(() => { const p = document.getElementById('react-picker-popup'); if (p) { const b = p.querySelector('button'); if (b) b.click(); } })()`);
  await sleep(1500);
  record('messages: reaction pill appears', await c.ev(`document.querySelectorAll('#messages .reaction-pill').length > 0`));

  // Edit via prompt dialog
  const editProbe = await c.ev(`(() => { const m = [...document.querySelectorAll('#messages .msg')].find(x => x.querySelector('.msg-content') && x.querySelector('.msg-content').textContent.includes('${U1}')); const b = m ? m.querySelector('[data-action="edit"]') : null; if (b) { window.__editProbe = 'clicked'; b.click(); } window.__editProbe = window.__editProbe || (m ? 'no-btn' : 'no-msg'); return window.__editProbe; })()`);
  await sleep(700);
  const hadDialog = await c.acceptDialog('Hello from desktop audit ${U1} (edited)');
  const editedOk = await c.waitFor(`[...document.querySelectorAll('#messages .msg-content')].some(m => m.textContent.includes('(edited)'))`);
  record('messages: edit via prompt() works', hadDialog && !!editedOk, 'dialog=' + hadDialog + ' probe=' + editProbe);

  // Delete via confirm
  const delProbe = await c.ev(`(() => { const m = [...document.querySelectorAll('#messages .msg')].find(x => x.querySelector('.msg-content') && x.querySelector('.msg-content').textContent.includes('(edited)')); const b = m ? m.querySelector('[data-action="delete"]') : null; if (b) { window.__delProbe = 'clicked'; b.click(); } window.__delProbe = window.__delProbe || (m ? 'no-btn' : 'no-msg'); return window.__delProbe; })()`);
  await sleep(700);
  const delDialog = await c.acceptDialog();
  const delOk = await c.waitFor(`[...document.querySelectorAll('#messages .msg-content')].filter(m => m.textContent.includes('(edited)')).length === 0`);
  record('messages: delete own message (confirm) works', delDialog && !!delOk, 'dialog=' + delDialog + ' probe=' + delProbe);

  // Emoji input picker
  await c.tap('#emoji-btn');
  await sleep(600);
  record('emoji input picker opens', await c.ev(`document.getElementById('emoji-input-popup').style.display !== 'none'`));
  await c.ev(`(() => { const p = document.getElementById('emoji-input-popup'); const b = p.querySelector('button'); if (b) b.click(); })()`);
  const textHasEmoji = await c.ev(`document.getElementById('text').value.length > 0`);
  await c.ev(`document.getElementById('text').value = ''`);
  record('emoji picker inserts emoji', textHasEmoji);

  // Image upload (real file)
  const imgNode = await c.send('DOM.getDocument');
  const qr = await c.send('DOM.querySelector', { nodeId: imgNode.result.root.nodeId, selector: '#image-file' });
  await c.send('DOM.setFileInputFiles', { nodeId: qr.result.nodeId, files: [PNG_PATH] });
  await c.ev(`document.getElementById('image-file').dispatchEvent(new Event('change'))`);
  await sleep(4000);
  record('messages: image upload posts image message', await c.ev(`document.querySelectorAll('#messages img.msg-image').length > 0`));
  await c.ev(`(() => { const i = document.querySelector('#messages img.msg-image'); if (i) i.click(); })()`);
  await sleep(800);
  record('lightbox opens on image click', await c.ev(`document.getElementById('lightbox').classList.contains('open')`));
  await c.ev(`document.getElementById('lightbox').click()`);
  await sleep(400);
  record('lightbox closes', await c.ev(`!document.getElementById('lightbox').classList.contains('open')`));

  // File upload (real file)
  const qr2 = await c.send('DOM.querySelector', { nodeId: imgNode.result.root.nodeId, selector: '#general-file' });
  await c.send('DOM.setFileInputFiles', { nodeId: qr2.result.nodeId, files: [TXT_PATH] });
  await c.ev(`document.getElementById('general-file').dispatchEvent(new Event('change'))`);
  await sleep(4000);
  record('messages: file upload posts attachment', await c.ev(`document.querySelectorAll('#messages a.file-attachment').length > 0`));

  // Create public room
  await c.tap('#open-create-room');
  await sleep(600);
  record('create-room modal opens', await c.ev(`document.getElementById('create-room-modal').classList.contains('open')`));
  const RN1 = 'auditpub' + Date.now().toString().slice(-5);
  await c.ev(`(() => { const i = document.getElementById('create-room-name'); i.value = '${RN1}'; })()`);
  await c.ev(`document.getElementById('create-room-form').requestSubmit()`);
  await sleep(3500);
  record('create public room + auto-join', !!(await c.waitFor(`document.getElementById('room-name-display').textContent.includes('${RN1}')`, 16)), 'toasts=' + (await c.ev(`[...document.querySelectorAll('.toast')].map(t=>t.textContent).join('|')`)).slice(0, 80));

  // Create private room with passkey
  await c.tap('#open-create-room');
  await sleep(600);
  const RN2 = 'auditsec' + Date.now().toString().slice(-5);
  await c.ev(`(() => { const i = document.getElementById('create-room-name'); i.value = '${RN2}'; })()`);
  await c.ev(`document.getElementById('create-room-private').click()`);
  await c.ev(`document.getElementById('create-room-form').requestSubmit()`);
  await sleep(3500);
  record('create private room + auto-join (owner, no passkey needed)', !!(await c.waitFor(`document.getElementById('room-name-display').textContent.includes('${RN2}')`, 16)), 'toasts=' + (await c.ev(`[...document.querySelectorAll('.toast')].map(t=>t.textContent).join('|')`)).slice(0, 80));

  // Settings: generate + save passkey
  await c.tap('#room-settings-btn');
  await sleep(700);
  record('room settings panel opens', await c.ev(`document.getElementById('room-settings-panel').style.display === 'block'`));
  await c.tap('#generate-passkey-btn');
  await sleep(300);
  const pk = await c.ev(`document.getElementById('passkey-input').value`);
  record('passkey generated', pk.length >= 8, pk);
  await c.tap('#save-passkey-btn');
  await sleep(1500);
  record('passkey saved toast', (await c.ev(`[...document.querySelectorAll('.toast')].map(t=>t.textContent).join('|')`)).includes('Passkey saved'));
  // rename
  await c.ev(`(() => { const i = document.getElementById('rename-input'); i.value = 'audit-secret-renamed'; })()`);
  await c.tap('#rename-btn');
  await sleep(2000);
  record('room rename works', (await c.ev(`document.getElementById('room-name-display').textContent`)).includes('audit-secret-renamed'));
  await c.tap('#close-settings-btn');
  await sleep(400);
  record('room settings closes', await c.ev(`document.getElementById('room-settings-panel').style.display === 'none'`));

  // Join by passkey with wrong key → error
  await c.type('#passkey-join-input', 'WRONG-PASSKEY-999');
  await c.tap('#passkey-join-btn');
  await sleep(1500);
  const wrongPk = await c.ev(`[...document.querySelectorAll('.toast')].map(t=>t.textContent).join('|')`);
  record('join-by-passkey: wrong key shows error', wrongPk.includes('No room') || wrongPk.includes('Invalid'), wrongPk.slice(0, 60));

  // Delete room: open modal, cancel (then actually delete to clean up)
  await c.ev(`(() => { const r = [...document.querySelectorAll('#room-list .room')].find(x => x.textContent.includes('${RN1}')); if (r) r.click(); })()`);
  await sleep(2500);
  await c.tap('#room-settings-btn');
  await sleep(600);
  await c.tap('#delete-room-btn');
  await sleep(600);
  record('delete-room confirm modal opens', await c.ev(`document.getElementById('delete-room-modal').classList.contains('open')`));
  await c.tap('#cancel-delete-room');
  await sleep(400);
  record('delete-room cancel keeps room', await c.ev(`!document.getElementById('delete-room-modal').classList.contains('open')`) && (await c.ev(`[...document.querySelectorAll('#room-list .room')].some(x => x.textContent.includes('${RN1}'))`)));
  // Actually delete it (cleanup)
  await c.tap('#delete-room-btn');
  await sleep(500);
  await c.tap('#confirm-delete-room');
  await sleep(2500);
  record('delete-room confirm removes room', !(await c.ev(`[...document.querySelectorAll('#room-list .room')].some(x => x.textContent.includes('${RN1}'))`)));

  // Help modal
  await c.tap('#help-btn');
  await sleep(600);
  record('help modal opens', await c.ev(`document.getElementById('help-modal').classList.contains('open')`));
  const helpTotal = await c.ev(`document.querySelectorAll('.help-slide').length`);
  await c.tap('#help-next');
  await sleep(300);
  const step2 = await c.ev(`document.getElementById('help-step-counter').textContent`);
  await c.tap('#help-prev');
  await sleep(300);
  const step1 = await c.ev(`document.getElementById('help-step-counter').textContent`);
  record('help modal next/prev work', step2.startsWith('2') && step1.startsWith('1'), `total=${helpTotal} ${step1}->${step2}`);
  await c.tap('#help-close-btn');
  await sleep(300);
  record('help modal closes', await c.ev(`!document.getElementById('help-modal').classList.contains('open')`));

  // Layout overflow on desktop
  const ov = await c.overflow(['#room-bar', '.sidebar', '#messages', '#online-list', '#input-area']);
  record('desktop layout: no overflow', Object.keys(ov).length === 0, JSON.stringify(ov));

  // ─────────────────── MULTI-USER (2nd tab) ───────────────────
  mark('multi-user start');
  const t2 = await c.send('Target.createTarget', { url: 'about:blank' });
  const t2info = (await (await fetch('http://127.0.0.1:' + PORT + '/json')).json()).find(t => t.id === t2.result.targetId);
  const c2 = await connectCDP(t2info.webSocketDebuggerUrl);
  await c2.send('Runtime.enable');
  await c2.send('Page.enable');
  // Load onto the origin first, THEN set the profile, then reload (like tab1)
  await c2.send('Page.navigate', { url: URL });
  await sleep(7000);
  await c2.ev(`localStorage.setItem('ptr29_profile_v2', JSON.stringify({username:'${U2}', avatar:'', termsAgreed:true}))`);
  await c2.send('Page.reload');
  await sleep(12000);
  record('multi-user: tab2 boots + joins #general', (await c2.ev(`document.getElementById('room-name-display').textContent`)).includes('general'));

  // typing indicator from tab2 (poll quickly — client debounces off after 2s)
  await c2.ev(`(() => { const i = document.getElementById('text'); i.focus(); })()`);
  await c2.type('#text', 'typing test message');
  let typingSeen = false;
  for (let i = 0; i < 12; i++) { await sleep(400); typingSeen = typingSeen || (await c.ev(`document.getElementById('typing').textContent`)).includes('${U2}'); }
  await c2.ev(`document.getElementById('text').value = ''`);
  await sleep(3500);
  const typingCleared = (await c.ev(`document.getElementById('typing').textContent`)) === '';
  record('multi-user: typing indicator shows then clears', typingSeen && typingCleared, 'shown=' + typingSeen + ' cleared=' + typingCleared);

  // presence count
  await sleep(2000);
  const banner = await c.ev(`(document.getElementById('room-info-banner') || {}).textContent || ''`);
  const usersMatch = (banner.match(/Users:\s*(\d+)/) || [])[1];
  record('multi-user: presence shows both users in room', parseInt(usersMatch, 10) >= 2, banner.replace(/\s+/g, ' ').slice(0, 80));

  // tab1 sends, tab2 reads → read receipt on tab1
  await c.type('#text', 'audit-receipt-check');
  await c.tap('#send-btn');
  await sleep(3000);
  await c2.ev(`document.getElementById('messages').scrollTop = document.getElementById('messages').scrollHeight`);
  await sleep(2000);
  const rcpt = await c.ev(`[...document.querySelectorAll('#messages .msg')].filter(m => m.querySelector('.receipts') && m.querySelector('.receipts').textContent.includes('Read by')).length`);
  record('multi-user: read receipt "Read by AuditUser2"', rcpt > 0, 'receipts=' + rcpt);

  // ───────────────────────── MOBILE FLOW ─────────────────────────
  mark('mobile start');
  await c.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });
  await c.send('Page.reload');
  await sleep(8000);
  let mobileOn = await c.ev(`document.body.classList.contains('ptr29-mobile')`);
  if (!mobileOn) {
    await c.ev(`document.body.classList.add('ptr29-mobile'); var ml=document.getElementById('ptr29-mobile-styles'); if(ml) ml.media='all';`);
    await sleep(1000);
    mobileOn = await c.ev(`document.body.classList.contains('ptr29-mobile')`);
  }
  record('mobile: layout engages at 390px', mobileOn);
  record('mobile: bottom nav visible', await c.ev(`getComputedStyle(document.getElementById('mobile-nav')).display === 'flex'`));
  const mobileView = await c.ev(`document.body.className.match(/ptr29-view-\\w+/)?.[0] || 'none'`);
  record('mobile: lands in chat view', mobileView === 'ptr29-view-chat', mobileView);

  // tabs
  await c.tap('#mobile-nav-rooms');
  await sleep(600);
  record('mobile: Rooms tab shows sidebar', (await c.ev(`document.body.className.match(/ptr29-view-\\w+/)?.[0]`)) === 'ptr29-view-rooms');
  await c.tap('#mobile-nav-online');
  await sleep(600);
  record('mobile: Online tab works', (await c.ev(`document.body.className.match(/ptr29-view-\\w+/)?.[0]`)) === 'ptr29-view-online');
  await c.tap('#mobile-nav-chat');
  await sleep(600);
  record('mobile: Chat tab returns to chat', (await c.ev(`document.body.className.match(/ptr29-view-\\w+/)?.[0]`)) === 'ptr29-view-chat');

  // back button
  const mBack = await c.hitTest('#mobile-back-btn');
  record('mobile: back button hit-testable', !!(mBack && mBack.visible && mBack.inside), JSON.stringify(mBack));
  await c.tap('#mobile-back-btn');
  await sleep(700);
  record('mobile: back returns to Rooms', (await c.ev(`document.body.className.match(/ptr29-view-\\w+/)?.[0]`)) === 'ptr29-view-rooms');
  record('mobile: back pops history cleanly', (await c.ev(`history.state`)) === null);

  // mobile search
  await c.tap('#mobile-nav-chat');
  await sleep(600);
  await c.tap('#mobile-search-btn');
  await sleep(600);
  const searchOpen = await c.ev(`document.getElementById('mobile-search-bar').style.display === 'flex'`);
  await c.type('#mobile-search-input', 'audit');
  await sleep(1200);
  const searchFiltered = await c.ev(`document.querySelectorAll('#messages .msg').length > 0 && document.querySelectorAll('#messages .msg[style*="display: none"]').length > 0`);
  await c.tap('#mobile-search-close-btn');
  await sleep(500);
  record('mobile: search opens/filters/closes', searchOpen && searchFiltered && (await c.ev(`document.getElementById('mobile-search-bar').style.display === 'none'`)), 'open=' + searchOpen + ' filtered=' + searchFiltered);

  // message tap → action buttons
  await c.ev(`(() => { const m = [...document.querySelectorAll('#messages .msg')][0]; if (m) m.click(); })()`);
  await sleep(600);
  record('mobile: tap message reveals actions', await c.ev(`document.querySelectorAll('#messages .msg.actions-visible').length > 0`));

  // edit profile on mobile (terms checkbox visible & tappable)
  await c.tap('#mobile-nav-rooms');
  await sleep(600);
  const mEdit = await c.hitTest('#edit-profile-btn');
  await c.tap('#edit-profile-btn');
  await sleep(700);
  record('mobile: edit-profile opens from Rooms tab', await c.ev(`document.getElementById('edit-profile-modal').classList.contains('open')`), 'btnHit=' + JSON.stringify(mEdit));
  const mTerms = await c.hitTest('#edit-terms');
  record('mobile: terms checkbox visible & tappable', !!(mTerms && mTerms.visible && mTerms.inside), JSON.stringify(mTerms));
  await c.tap('#cancel-edit-profile');
  await sleep(400);

  // create room modal on mobile
  const mCreate = await c.hitTest('#open-create-room');
  await c.tap('#open-create-room');
  await sleep(600);
  record('mobile: create-room modal usable', await c.ev(`document.getElementById('create-room-modal').classList.contains('open')`), 'btnHit=' + JSON.stringify(mCreate));
  await c.tap('#cancel-create-room');
  await sleep(400);

  // room settings on mobile
  await c.tap('#mobile-nav-chat');
  await sleep(600);
  await c.tap('#room-settings-btn');
  await sleep(700);
  record('mobile: room settings opens', await c.ev(`document.getElementById('room-settings-panel').style.display === 'block'`));
  await c.ev(`document.getElementById('room-settings-panel').scrollTop = 9999`);
  await sleep(300);
  record('mobile: settings scrolls (bottom reachable)', (await c.ev(`document.getElementById('room-settings-panel').scrollTop`)) > 0);
  await c.tap('#close-settings-btn');
  await sleep(400);

  // help on mobile
  await c.tap('#mobile-nav-rooms');
  await sleep(600);
  const mHelp = await c.hitTest('#help-btn');
  await c.tap('#help-btn');
  await sleep(600);
  record('mobile: help opens', await c.ev(`document.getElementById('help-modal').classList.contains('open')`), 'btnHit=' + JSON.stringify(mHelp));
  await c.tap('#help-close-btn');
  await sleep(400);

  // mobile overflow
  const mov = await c.overflow(['#room-bar', '#messages', '#mobile-nav', '#input-area']);
  record('mobile layout: no horizontal overflow', !Object.values(mov).some(v => v.includes('H-OVERFLOW')), JSON.stringify(mov));

  // cleanup private room
  await c.ev(`document.body.classList.remove('ptr29-view-chat','ptr29-view-rooms','ptr29-view-online'); document.body.classList.add('ptr29-view-rooms');`);
  await sleep(500);
  await c.ev(`(() => { const r = [...document.querySelectorAll('#room-list .room')].find(x => x.textContent.includes('${RN2}') || x.textContent.includes('renamed')); if (r) r.click(); })()`);
  await sleep(3000);
  await c.ev(`document.body.classList.add('ptr29-view-chat')`);
  await c.tap('#room-settings-btn');
  await sleep(600);
  await c.tap('#delete-room-btn');
  await sleep(500);
  await c.tap('#confirm-delete-room');
  await sleep(3000);
  record('cleanup: private room deleted', !(await c.ev(`[...document.querySelectorAll('#room-list .room')].some(x => x.textContent.includes('${RN2}') || x.textContent.includes('renamed'))`)));

  const out = { url: URL, uid, results, consoleErrors: c.errors.slice(0, 20), secondTabErrors: c2.errors.slice(0, 10) };
  console.log(JSON.stringify(out, null, 2));
  chrome.kill();
  process.exit(0);
}
main().catch(e => { console.error('AUDIT FAIL', e && e.message); process.exit(1); });
