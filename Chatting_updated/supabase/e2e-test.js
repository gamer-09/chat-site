/* End-to-end feature test against the live Supabase backend.
 * Simulates exactly what the web app does: anonymous auth, rooms, messages,
 * reactions, receipts, RLS denials, private rooms + passkeys, room deletion.
 *
 * Run:  node supabase/e2e-test.js   (from Chatting_updated/)
 */
const URL = 'https://vjrnabnawhegjdsvbyrc.supabase.co';
const ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZqcm5hYm5hd2hlZ2pkc3ZieXJjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY0NTU1NTYsImV4cCI6MjEwMjAzMTU1Nn0.7MbTlgMz3v2GsXuhKKGxdFacKZckUbUte_TKKehCQSM';

async function anon() {
  const r = await fetch(URL + '/auth/v1/signup', {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: '{}'
  });
  const j = await r.json();
  if (!j.access_token) throw new Error('anon signup failed: ' + JSON.stringify(j).slice(0, 200));
  return { token: j.access_token, uid: j.user.id };
}

const hdrs = (u, json) => {
  const h = { apikey: ANON, Authorization: 'Bearer ' + u.token };
  if (json) h['Content-Type'] = 'application/json';
  return h;
};

async function rpc(u, fn, args) {
  const r = await fetch(URL + '/rest/v1/rpc/' + fn, { method: 'POST', headers: hdrs(u, true), body: JSON.stringify(args || {}) });
  const text = await r.text();
  let j; try { j = JSON.parse(text); } catch { j = text; }
  return { status: r.status, body: j };
}
async function post(u, table, row) {
  const r = await fetch(URL + '/rest/v1/' + table, { method: 'POST', headers: hdrs(u, true), body: JSON.stringify(row) });
  return r.status;
}
async function get(u, table, qs) {
  const r = await fetch(URL + '/rest/v1/' + table + (qs ? '?' + qs : ''), { headers: hdrs(u, false) });
  const text = await r.text();
  let j; try { j = JSON.parse(text); } catch { j = text; }
  return { status: r.status, body: j };
}
async function patch(u, table, qs, row) {
  const r = await fetch(URL + '/rest/v1/' + table + '?' + qs, { method: 'PATCH', headers: hdrs(u, true), body: JSON.stringify(row) });
  return r.status;
}
async function del(u, table, qs) {
  const r = await fetch(URL + '/rest/v1/' + table + '?' + qs, { method: 'DELETE', headers: hdrs(u, false) });
  return r.status;
}

(async () => {
  const results = [];
  const check = (name, cond, extra) => results.push(Object.assign({ name, pass: !!cond }, extra || {}));

  const A = await anon();
  const B = await anon();
  const C = await anon();
  console.log('users:', A.uid.slice(0, 8), '(owner)', B.uid.slice(0, 8), '(member)', C.uid.slice(0, 8), '(outsider)');

  // ── general room ──
  await rpc(A, 'seed_general');
  const g = await get(A, 'rooms', 'name=eq.general&select=name');
  check('general room seeded', g.status === 200 && Array.isArray(g.body) && g.body.length === 1);

  // ── public room: create + message + reaction + edit ──
  await post(A, 'rooms', { name: 'e2e-pub', is_private: false, owner_id: A.uid, admins: [A.uid], members: [], passkey: '', created_at: Date.now() });
  const m1 = 'm1-' + Date.now();
  await post(A, 'messages', { id: m1, room: 'e2e-pub', payload: { id: m1, room: 'e2e-pub', clientId: A.uid, username: 'TestA', avatar: '', message: 'hello e2e', timestamp: Date.now() } });
  const pubMsgs = await get(B, 'messages', 'room=eq.e2e-pub&select=id');
  check('any user reads public messages', pubMsgs.body.some(m => m.id === m1));

  await post(B, 'reactions', { message_id: m1, room: 'e2e-pub', emoji: '👍', uid: B.uid, username: 'TestB', created_at: Date.now() });
  const reac = await get(A, 'reactions', 'message_id=eq.' + m1 + '&select=emoji,uid');
  check('reaction persisted', reac.body.length === 1 && reac.body[0].emoji === '👍');

  const edited = { id: m1, room: 'e2e-pub', clientId: A.uid, username: 'TestA', avatar: '', message: 'edited text', timestamp: Date.now(), edited: true };
  check('A edits own message', (await patch(A, 'messages', 'id=eq.' + m1, { payload: edited })) === 204);
  // B tries to edit A's message → RLS must block it (PostgREST: 403 or 404), content unchanged
  const hacker = Object.assign({}, edited, { message: 'HACKED BY B', edited: false });
  const hackStatus = await patch(B, 'messages', 'id=eq.' + m1, { payload: hacker });
  const afterHack = await get(A, 'messages', 'id=eq.' + m1 + '&select=payload');
  // PostgREST returns 204 for 0 rows affected (RLS-hidden row) — the content
  // check is what proves B could not modify A's message.
  check('B CANNOT edit A message (RLS)', (hackStatus === 204 || hackStatus === 403 || hackStatus === 404) && afterHack.body[0].payload.message === 'edited text');

  // ── private room with passkey ──
  await post(A, 'rooms', { name: 'e2e-priv', is_private: true, owner_id: A.uid, admins: [A.uid], members: [], passkey: 'SECRETKEY', created_at: Date.now() });

  // ══ BUG REPRO: owner joins own private room without the passkey ══
  // NOTE: passes once the fixed schema.sql has been re-run in the SQL editor.
  const ownerJoin = await rpc(A, 'join_room', { room_name: 'e2e-priv', passkey: '' });
  check('OWNER joins own private room WITHOUT passkey', !!(ownerJoin.body && ownerJoin.body.ok === true), { actual: JSON.stringify(ownerJoin.body) });

  const bNo = await rpc(B, 'join_room', { room_name: 'e2e-priv', passkey: '' });
  check('outsider without passkey DENIED', !bNo.body.ok);
  const bWrong = await rpc(B, 'join_room', { room_name: 'e2e-priv', passkey: 'WRONG' });
  check('outsider wrong passkey DENIED', !bWrong.body.ok);
  const bOk = await rpc(B, 'join_room', { room_name: 'e2e-priv', passkey: 'SECRETKEY' });
  check('outsider correct passkey JOINS', !!(bOk.body && bOk.body.ok === true));
  const bMember = await get(A, 'rooms', 'name=eq.e2e-priv&select=members');
  check('joiner added to members', Array.isArray(bMember.body[0].members) && bMember.body[0].members.includes(B.uid));

  // private messages: outsider denied, member allowed
  const m2 = 'm2-' + Date.now();
  await post(A, 'messages', { id: m2, room: 'e2e-priv', payload: { id: m2, room: 'e2e-priv', clientId: A.uid, username: 'TestA', message: 'private hello', timestamp: Date.now() } });
  const cRead = await get(C, 'messages', 'room=eq.e2e-priv&select=id');
  check('outsider CANNOT read private messages', cRead.body.length === 0);
  const bRead = await get(B, 'messages', 'room=eq.e2e-priv&select=id');
  check('member reads private messages', bRead.body.some(m => m.id === m2));

  // member posts + deletes own message; cannot delete owner's
  const m3 = 'm3-' + Date.now();
  check('member posts in private room', (await post(B, 'messages', { id: m3, room: 'e2e-priv', payload: { id: m3, room: 'e2e-priv', clientId: B.uid, username: 'TestB', message: 'hi owner', timestamp: Date.now() } })) === 201);
  check('member deletes own message', (await del(B, 'messages', 'id=eq.' + m3)) === 204);
  const m4 = 'm4-' + Date.now();
  await post(A, 'messages', { id: m4, room: 'e2e-priv', payload: { id: m4, room: 'e2e-priv', clientId: A.uid, username: 'TestA', message: 'keep me', timestamp: Date.now() } });
  const delOtherStatus = await del(B, 'messages', 'id=eq.' + m4);
  const m4After = await get(A, 'messages', 'id=eq.' + m4 + '&select=id');
  check('member CANNOT delete owner message (RLS)', (delOtherStatus === 204 || delOtherStatus === 403 || delOtherStatus === 404) && m4After.body.length === 1);

  // read receipts
  await post(B, 'receipts', { message_id: m2, room: 'e2e-priv', uid: B.uid, username: 'TestB', at: Date.now() });
  const rec = await get(A, 'receipts', 'message_id=eq.' + m2 + '&select=uid');
  check('read receipt recorded', rec.body.some(x => x.uid === B.uid));

  // uploads storage path access (RLS via room folder)
  const cUpload = await get(C, 'storage/object/chat-uploads/e2e-priv/x.png', '');
  check('outsider storage read denied (403 or empty)', cUpload.status === 400 || cUpload.status === 403 || cUpload.status === 404);

  // ── owner deletes private room ──
  const delRoom = await rpc(A, 'delete_room', { room_name: 'e2e-priv' });
  check('owner deletes private room', !!(delRoom.body && delRoom.body.ok === true), { actual: JSON.stringify(delRoom.body) });
  const gone = await get(C, 'rooms', 'name=eq.e2e-priv&select=name');
  check('deleted room gone', gone.body.length === 0);

  // cleanup
  await rpc(A, 'delete_room', { room_name: 'e2e-pub' });

  console.log('\n=== RESULTS ===');
  let fails = 0;
  results.forEach(r => { console.log((r.pass ? '✅' : '❌') + ' ' + r.name + (r.actual ? '  → ' + r.actual : '')); if (!r.pass) fails++; });
  console.log(fails === 0 ? '\nALL PASS' : '\n' + fails + ' FAILED');
  process.exit(fails === 0 ? 0 : 1);
})().catch(e => { console.error('TEST ERROR:', e); process.exit(1); });
