const path = require('path');
const fs = require('fs');
const express = require('express');
const http = require('http');
const net = require('net');
const crypto = require('crypto');
const { Server } = require('socket.io');
const {
  ensureRoom,
  getRooms,
  getMessages,
  getMessageById,
  addMessage,
  addReceipt,
  clearRoom,
  clearAll,
  deleteRoom,
  editMessage,
  deleteMessage,
  purgeIdentity,
  createRoom,
  getRoomMeta,
  canManageRoom,
  canAccessRoom,
  addRoomAdmins,
  addRoomMembers,
  setRoomAdmins,
  setRoomMembers,
  setRoomPasskey,
  verifyRoomPasskey,
  findRoomByPasskey,
  recordUser,
  getAllUsers,
  isUsernameAvailable,
  pruneAdminsToUsernames,
  renameRoom,
  setRoomPrivacy,
  deleteUser,
  transferRoomOwnership,
  updateMessageReactions,
} = require('./data/store');

const HOST = process.env.HOST || '0.0.0.0';   // listen on all interfaces → LAN accessible
const PORT = process.env.PORT || 3000;
const DEFAULT_ROOM = 'general';
ensureRoom(DEFAULT_ROOM, {});
try { pruneAdminsToUsernames(['gg_games']); } catch {}

const MAX_IMAGE_BYTES = parseInt(process.env.MAX_IMAGE_BYTES || String(5 * 1024 * 1024), 10);
const MAX_FILE_BYTES = parseInt(process.env.MAX_FILE_BYTES || String(10 * 1024 * 1024), 10);
const MAX_JSON_BYTES = parseInt(process.env.MAX_JSON_BYTES || String(16 * 1024 * 1024), 10);
const ADMIN_TOKEN = String(process.env.ADMIN_TOKEN || '').trim();
const ALLOWED_ORIGINS = String(process.env.ALLOWED_ORIGINS || '')
  .split(',').map(s => s.trim()).filter(Boolean);
const ALLOWED_IMAGE_MIME = new Map([
  ['image/jpeg', { ext: 'jpg', magic: b => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff }],
  ['image/png',  { ext: 'png', magic: b => b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 }],
  ['image/gif',  { ext: 'gif', magic: b => b.length > 6 && b.toString('ascii', 0, 6).startsWith('GIF') }],
  ['image/webp', { ext: 'webp', magic: b => b.length > 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP' }],
]);
const ALLOWED_FILE_MIME = new Map([
  ['application/pdf', ['pdf']],
  ['text/plain', ['txt', 'text', 'log']],
  ['text/csv', ['csv']],
  ['application/json', ['json']],
  ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', ['docx']],
  ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', ['xlsx']],
  ['application/vnd.openxmlformats-officedocument.presentationml.presentation', ['pptx']],
]);
const BLOCKED_FILE_EXT = new Set(['html', 'htm', 'svg', 'js', 'mjs', 'exe', 'dll', 'bat', 'cmd', 'sh', 'php', 'py', 'jar', 'apk', 'ipa', 'dmg', 'msi', 'wasm']);
const MAX_LINKS_PER_MESSAGE = parseInt(process.env.MAX_LINKS_PER_MESSAGE || '5', 10);
const MAX_LINK_LENGTH = parseInt(process.env.MAX_LINK_LENGTH || '2048', 10);
const BLOCKED_LINK_EXT = new Set(['exe', 'msi', 'apk', 'ipa', 'dmg', 'pkg', 'bat', 'cmd', 'sh', 'ps1', 'vbs', 'scr', 'jar', 'js', 'mjs', 'wasm']);
const apiLimiter = createRateLimiter({ windowMs: 60 * 1000, limit: 180 });
const uploadLimiter = createRateLimiter({ windowMs: 60 * 1000, limit: 20 });

const app = express();
app.disable('x-powered-by');
app.use(securityHeaders);
app.use(corsGuard);
app.use(express.json({ limit: MAX_JSON_BYTES }));
app.use('/api/', apiLimiter);
app.use(express.static(path.join(__dirname, 'public'), { fallthrough: true, setHeaders: securityStaticHeaders }));

const UPLOAD_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "form-action 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co ws: wss:",
  "media-src 'self' data: blob: https:",
  "manifest-src 'self'",
  "worker-src 'self' blob:",
  "upgrade-insecure-requests"
].join('; ');
function securityHeaders(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('Content-Security-Policy', CONTENT_SECURITY_POLICY);
  next();
}
function securityStaticHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Content-Security-Policy', CONTENT_SECURITY_POLICY);
}
function createRateLimiter({ windowMs, limit }) {
  const hits = new Map();
  setInterval(() => {
    const now = Date.now();
    for (const [key, bucket] of hits.entries()) if (bucket.reset <= now) hits.delete(key);
  }, Math.min(windowMs, 60 * 1000)).unref?.();
  return (req, res, next) => {
    const ip = req.headers['x-forwarded-for'] ? String(req.headers['x-forwarded-for']).split(',')[0].trim() : req.socket.remoteAddress;
    const key = `${ip}:${req.method}:${req.path}`;
    const now = Date.now();
    const bucket = hits.get(key) || { count: 0, reset: now + windowMs };
    if (bucket.reset <= now) { bucket.count = 0; bucket.reset = now + windowMs; }
    bucket.count += 1;
    hits.set(key, bucket);
    res.setHeader('RateLimit-Limit', String(limit));
    res.setHeader('RateLimit-Remaining', String(Math.max(0, limit - bucket.count)));
    res.setHeader('RateLimit-Reset', String(Math.ceil(bucket.reset / 1000)));
    if (bucket.count > limit) return res.status(429).json({ error: 'rate_limited' });
    next();
  };
}
function isOriginAllowed(origin, host) {
  if (!origin) return true;
  try {
    const u = new URL(origin);
    if (host && u.host === host) return true;
    if (ALLOWED_ORIGINS.includes(origin) || ALLOWED_ORIGINS.includes(u.host)) return true;
    return false;
  } catch { return false; }
}
function corsGuard(req, res, next) {
  const origin = req.get('Origin');
  const host = req.get('Host');
  if (!isOriginAllowed(origin, host)) {
    if (req.method === 'OPTIONS') return res.sendStatus(403);
    return res.status(403).json({ error: 'cors_denied' });
  }
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Admin-Token');
  res.setHeader('Access-Control-Max-Age', '600');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
}
function requireAdminToken(req, res, next) {
  if (!ADMIN_TOKEN) return res.status(404).json({ error: 'not_found' });
  const auth = String(req.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
  const header = String(req.get('X-Admin-Token') || '').trim();
  const candidate = auth || header;
  const a = Buffer.from(candidate);
  const b = Buffer.from(ADMIN_TOKEN);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return res.status(403).json({ error: 'forbidden' });
  next();
}
function cleanFileBase(name, fallback) {
  return String(name || fallback || 'file').toLowerCase().replace(/\.[^/.]+$/, '').replace(/[^a-z0-9_-]/g, '').slice(0, 30) || fallback || 'file';
}
function displayFileName(name) {
  return String(name || 'file').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 80) || 'file';
}
function fileExt(name) {
  const m = String(name || '').toLowerCase().match(/\.([a-z0-9]+)(?:[?#]|$)/);
  return m ? m[1] : '';
}
function trimLinkToken(raw) {
  let s = String(raw || '').trim();
  while (/[),.!?;:'"\]]$/.test(s)) s = s.slice(0, -1);
  return s;
}
function extractLinks(text) {
  const out = [];
  String(text || '').replace(/\b((?:https?:\/\/|www\.)[^\s<>"'()\[\]]+)/gi, (m) => { const u = trimLinkToken(m); if (u) out.push(u); return m; });
  return out;
}
function isPrivateIpv4Host(host) {
  if (net.isIP(host) !== 4) return false;
  const n = host.split('.').map(x => Number(x));
  if (n.some(x => x < 0 || x > 255)) return true;
  const [a, b] = n;
  return a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168);
}
function validateLink(raw) {
  const original = trimLinkToken(raw);
  if (!original) return { ok: false, reason: 'empty link' };
  if (original.length > MAX_LINK_LENGTH) return { ok: false, reason: 'link is too long' };
  let url;
  try { url = new URL(/^www\./i.test(original) ? `https://${original}` : original); }
  catch { return { ok: false, reason: 'invalid link format' }; }
  if (!['http:', 'https:'].includes(url.protocol)) return { ok: false, reason: 'only http/https links are allowed' };
  if (url.username || url.password) return { ok: false, reason: 'links with hidden usernames/passwords are blocked' };
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (!host || host === 'localhost' || host.endsWith('.localhost')) return { ok: false, reason: 'local links are blocked' };
  if (net.isIP(host) === 6 || host.includes(':') || host.startsWith('[') || host.endsWith(']')) return { ok: false, reason: 'IPv6/local-style links are blocked' };
  if (host === '0.0.0.0' || isPrivateIpv4Host(host)) return { ok: false, reason: 'private network links are blocked' };
  if (host.startsWith('xn--') || host.includes('.xn--')) return { ok: false, reason: 'look-alike internationalized domains are blocked' };
  const ext = (url.pathname.match(/\.([a-z0-9]{1,8})$/i) || [])[1]?.toLowerCase();
  if (ext && BLOCKED_LINK_EXT.has(ext)) return { ok: false, reason: `links to .${ext} files are blocked` };
  return { ok: true, url: url.href };
}
function validateMessageLinks(text) {
  if (/\b(?:javascript|data|file|vbscript)\s*:/i.test(String(text || ''))) return { ok: false, reason: 'unsafe link protocol' };
  const links = extractLinks(text);
  if (links.length > MAX_LINKS_PER_MESSAGE) return { ok: false, reason: `too many links (max ${MAX_LINKS_PER_MESSAGE})` };
  for (const link of links) {
    const check = validateLink(link);
    if (!check.ok) return check;
  }
  return { ok: true };
}
function sanitizeAvatarUrl(avatar) {
  const v = String(avatar || '').trim();
  if (!v) return '';
  if (/^data:image\/(png|jpeg|jpg|gif|webp);base64,[a-z0-9+/=\r\n]+$/i.test(v)) return v.length <= 1500000 ? v : '';
  try {
    const url = new URL(v);
    if (url.protocol !== 'https:') return '';
    const check = validateLink(url.href);
    return check.ok ? url.href : '';
  } catch { return ''; }
}
function mimeForExt(ext) {
  const e = String(ext || '').toLowerCase();
  if (e === 'jpg' || e === 'jpeg') return 'image/jpeg';
  if (e === 'png') return 'image/png';
  if (e === 'gif') return 'image/gif';
  if (e === 'webp') return 'image/webp';
  for (const [mime, exts] of ALLOWED_FILE_MIME.entries()) if ((exts || []).includes(e)) return mime;
  return '';
}
function normalizeUploadMime(mime, ext) {
  const m = String(mime || '').toLowerCase();
  if (!m || m === 'application/octet-stream' || m === 'binary/octet-stream') return mimeForExt(ext) || m;
  return m;
}
function parseBase64DataUrl(dataUrl) {
  if (typeof dataUrl !== 'string' || dataUrl.length > Math.ceil(MAX_JSON_BYTES * 1.05)) return null;
  const m = dataUrl.match(/^data:([^;,]*);base64,([A-Za-z0-9+/=\r\n]+)$/);
  if (!m) return null;
  const b64 = m[2].replace(/[\r\n]/g, '');
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) return null;
  return { mime: (m[1] || 'application/octet-stream').toLowerCase(), buf: Buffer.from(b64, 'base64') };
}
function validateImageUpload(dataUrl) {
  const parsed = parseBase64DataUrl(dataUrl);
  if (!parsed) return { ok: false, error: 'invalid_image' };
  const allowed = ALLOWED_IMAGE_MIME.get(parsed.mime);
  if (!allowed) return { ok: false, error: 'unsupported_type' };
  if (!parsed.buf.length) return { ok: false, error: 'empty_image' };
  if (parsed.buf.length > MAX_IMAGE_BYTES) return { ok: false, error: 'too_large' };
  if (!allowed.magic(parsed.buf)) return { ok: false, error: 'invalid_image_bytes' };
  return { ok: true, mime: parsed.mime, ext: allowed.ext, buf: parsed.buf };
}
function validateFileUpload(dataUrl, originalName) {
  const parsed = parseBase64DataUrl(dataUrl);
  if (!parsed) return { ok: false, error: 'invalid_file' };
  const ext = fileExt(originalName);
  parsed.mime = normalizeUploadMime(parsed.mime, ext);
  if (BLOCKED_FILE_EXT.has(ext)) return { ok: false, error: 'blocked_file_type' };
  if (!parsed.buf.length) return { ok: false, error: 'empty_file' };
  if (parsed.buf.length > MAX_FILE_BYTES) return { ok: false, error: 'too_large' };
  if (ALLOWED_IMAGE_MIME.has(parsed.mime)) {
    const img = validateImageUpload(dataUrl);
    return img.ok ? { ...img, kind: 'image' } : img;
  }
  const allowedExts = ALLOWED_FILE_MIME.get(parsed.mime) || [];
  if (!allowedExts.includes(ext)) return { ok: false, error: 'unsupported_type' };
  if (parsed.mime === 'application/pdf' && parsed.buf.toString('ascii', 0, 4) !== '%PDF') return { ok: false, error: 'invalid_file_bytes' };
  return { ok: true, mime: parsed.mime, ext, buf: parsed.buf, kind: 'file' };
}
function socketRateOk(socket, key, limit, windowMs) {
  const now = Date.now();
  socket.data.rate = socket.data.rate || {};
  const bucket = socket.data.rate[key] || { count: 0, reset: now + windowMs };
  if (bucket.reset <= now) { bucket.count = 0; bucket.reset = now + windowMs; }
  bucket.count += 1;
  socket.data.rate[key] = bucket;
  if (bucket.count > limit) {
    socket.emit('system', { type: 'error', message: 'Slow down — too many requests.' });
    return false;
  }
  return true;
}

// ── Signed upload URLs ─────────────────────────────────────────────────────
// Uploaded images/files can only be opened through a signed ?sig= link that
// the server embeds in chat messages, so files are not publicly guessable.
// Set UPLOAD_SECRET to a fixed value in production so links survive restarts.
const UPLOAD_SECRET = process.env.UPLOAD_SECRET || crypto.randomBytes(32).toString('hex');
function signUpload(name) { return crypto.createHmac('sha256', UPLOAD_SECRET).update(String(name)).digest('hex'); }
function sigMatches(a, b) {
  try {
    const ba = Buffer.from(String(a || ''));
    const bb = Buffer.from(String(b || ''));
    return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
  } catch { return false; }
}
app.use('/uploads', (req, res, next) => {
  const name = path.basename(req.path);
  if (!name || !sigMatches(req.query.sig, signUpload(name))) return res.status(403).send('forbidden');
  next();
}, express.static(UPLOAD_DIR));

app.get('/favicon.ico', (req, res) => {
  const b64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=';
  res.set('Cache-Control', 'public, max-age=86400, immutable');
  res.type('image/png').send(Buffer.from(b64, 'base64'));
});

app.get('/health', (req, res) => res.json({ status: 'ok' }));

// ── REST: rooms ──────────────────────────────────────────────────────────────
app.get('/api/rooms', (req, res) => {
  return res.json({ rooms: getRooms() });
});

app.post('/api/rooms', (req, res) => {
  const name = String((req.body && req.body.name) || '').trim().toLowerCase().replace(/[^a-z0-9_-]/gi, '-').slice(0, 50);
  if (!name) return res.status(400).json({ error: 'Invalid room name' });
  const isPrivate = !!(req.body && req.body.isPrivate);
  const ownerId = (req.body && req.body.ownerId) ? String(req.body.ownerId).trim().slice(0, 64) : null;
  const admins = Array.isArray(req.body && req.body.admins) ? req.body.admins.map(x => String(x).trim().slice(0, 64)).filter(Boolean) : [];
  const members = Array.isArray(req.body && req.body.members) ? req.body.members.map(x => String(x).trim().slice(0, 64)).filter(Boolean) : [];
  const result = createRoom(name, { isPrivate, ownerId, admins, members });
  if (!result.ok) return res.status(400).json({ error: result.error || 'failed' });
  return res.status(201).json({ ok: true, name: result.name, created: result.created });
});

app.get('/api/rooms/:room/messages', (req, res) => {
  const room = sanitizeRoomName(req.params.room) || DEFAULT_ROOM;
  const limit = Math.max(1, Math.min(1000, parseInt(req.query.limit || '100', 10)));
  ensureRoom(room);
  const clientId = String(req.query.clientId || '').trim();
  // Also allow if this clientId has ephemeral passkey access on any active socket
  if (!canAccessRoom(room, clientId) && !hasEphemeralAccess(room, clientId)) {
    return res.status(403).json({ error: 'forbidden' });
  }
  return res.json({ room, messages: getMessages(room, limit) });
});

// ── REST: file/image upload ───────────────────────────────────────────────────────
app.post('/api/rooms/:room/images', uploadLimiter, async (req, res) => {
  try {
    const room = sanitizeRoomName(req.params.room) || DEFAULT_ROOM;
    ensureRoom(room);
    const { dataUrl, clientId, filename } = req.body || {};
    const cid = (clientId || '').trim();
    if (!canAccessRoom(room, cid) && !hasEphemeralAccess(room, cid)) {
      return res.status(403).json({ error: 'forbidden' });
    }
    const checked = validateImageUpload(dataUrl);
    if (!checked.ok) return res.status(checked.error === 'too_large' ? 413 : 400).json({ error: checked.error });
    const safeBase = cleanFileBase(filename, 'img').slice(0, 24) || 'img';
    const fileName = `${safeBase}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}.${checked.ext}`;
    fs.writeFileSync(path.join(UPLOAD_DIR, fileName), checked.buf, { flag: 'wx' });
    const imageUrl = `/uploads/${fileName}?sig=${signUpload(fileName)}`;

    let username = 'Anonymous', avatar = '';
    try {
      const u = getAllUsers().find(x => x.clientId === cid);
      if (u) { username = u.username || 'Anonymous'; avatar = u.avatar || ''; }
    } catch {}
    if (!avatar) avatar = `https://api.dicebear.com/7.x/thumbs/svg?seed=${encodeURIComponent(username)}`;

    const payload = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      room, userId: null, clientId: cid || null, username, avatar,
      message: '', type: 'image', imageUrl, timestamp: Date.now(), readBy: [], reactions: {}
    };
    addMessage(room, payload);
    io.to(room).emit('chat-message', payload);
    notifyNewMessage(room, username, '[image]', cid);
    return res.status(201).json({ ok: true, message: payload });
  } catch {
    return res.status(500).json({ error: 'upload_failed' });
  }
});

app.post('/api/rooms/:room/files', uploadLimiter, async (req, res) => {
  try {
    const room = sanitizeRoomName(req.params.room) || DEFAULT_ROOM;
    ensureRoom(room);
    const { dataUrl, clientId, filename } = req.body || {};
    const cid = (clientId || '').trim();
    if (!canAccessRoom(room, cid) && !hasEphemeralAccess(room, cid)) {
      return res.status(403).json({ error: 'forbidden' });
    }
    const originalName = displayFileName(filename);
    const checked = validateFileUpload(dataUrl, originalName);
    if (!checked.ok) return res.status(checked.error === 'too_large' ? 413 : 400).json({ error: checked.error });

    // Sanitize and keep the original filename for the user-facing display, but create a unique safe server filename.
    const safeBase = cleanFileBase(originalName, 'file');
    const serverFileName = `${safeBase}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}.${checked.ext}`;
    fs.writeFileSync(path.join(UPLOAD_DIR, serverFileName), checked.buf, { flag: 'wx' });
    const mime = checked.mime;
    const fileUrl = `/uploads/${serverFileName}?sig=${signUpload(serverFileName)}`;

    let username = 'Anonymous', avatar = '';
    try {
      const u = getAllUsers().find(x => x.clientId === cid);
      if (u) { username = u.username || 'Anonymous'; avatar = u.avatar || ''; }
    } catch {}
    if (!avatar) avatar = `https://api.dicebear.com/7.x/thumbs/svg?seed=${encodeURIComponent(username)}`;

    const payload = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      room, userId: null, clientId: cid || null, username, avatar,
      message: originalName, type: checked.kind === 'image' ? 'image' : 'file', fileUrl, imageUrl: checked.kind === 'image' ? fileUrl : undefined, fileSize: checked.buf.length, mimeType: mime, timestamp: Date.now(), readBy: [], reactions: {}
    };
    addMessage(room, payload);
    io.to(room).emit('chat-message', payload);
    notifyNewMessage(room, username, `[File: ${originalName}]`, cid);
    return res.status(201).json({ ok: true, message: payload });
  } catch {
    return res.status(500).json({ error: 'upload_failed' });
  }
});

// ── REST: messages edit/delete ───────────────────────────────────────────────
app.post('/api/rooms/:room/messages/:id/edit', (req, res) => {
  const room = sanitizeRoomName(req.params.room) || DEFAULT_ROOM;
  const id = String(req.params.id || '').trim();
  const text = (req.body && req.body.text) || '';
  const clientId = (req.body && req.body.clientId) || '';
  ensureRoom(room);
  if (!canAccessRoom(room, clientId) && !hasEphemeralAccess(room, clientId)) return res.status(403).json({ error: 'forbidden' });
  const linkCheck = validateMessageLinks(text);
  if (!linkCheck.ok) return res.status(400).json({ error: 'unsafe_link', reason: linkCheck.reason });
  const result = editMessage(room, id, '', text, Date.now(), clientId);
  if (!result.ok) return res.status(400).json({ error: result.error });
  io.to(room).emit('message-updated', result.message);
  return res.json({ ok: true, message: result.message });
});

app.post('/api/rooms/:room/messages/:id/delete', (req, res) => {
  const room = sanitizeRoomName(req.params.room) || DEFAULT_ROOM;
  const id = String(req.params.id || '').trim();
  const clientId = (req.body && req.body.clientId) || '';
  ensureRoom(room);
  if (!canAccessRoom(room, clientId) && !hasEphemeralAccess(room, clientId)) return res.status(403).json({ error: 'forbidden' });
  const result = deleteMessage(room, id, '', clientId);
  if (!result.ok) return res.status(400).json({ error: result.error });
  io.to(room).emit('message-deleted', { messageId: id, room });
  return res.json({ ok: true });
});

// ── REST: room management ────────────────────────────────────────────────────
app.post('/api/rooms/:room/clear', (req, res) => {
  const room = sanitizeRoomName(req.params.room) || DEFAULT_ROOM;
  ensureRoom(room);
  const clientId = (req.body && req.body.clientId) ? String(req.body.clientId).trim() : '';
  if (!canManageRoom(room, clientId)) return res.status(403).json({ error: 'forbidden' });
  clearRoom(room);
  io.to(room).emit('history', { room, messages: [] });
  broadcastRooms();
  return res.json({ ok: true, room });
});

app.post('/api/clear-all', requireAdminToken, (req, res) => {
  clearAll();
  broadcastRooms();
  return res.json({ ok: true });
});

app.post('/api/rooms/:room/delete', (req, res) => {
  const room = sanitizeRoomName(req.params.room) || DEFAULT_ROOM;
  if (room === DEFAULT_ROOM) return res.status(400).json({ error: 'Cannot delete default room' });
  const clientId = (req.body && req.body.clientId) ? String(req.body.clientId).trim() : '';
  if (!canManageRoom(room, clientId)) return res.status(403).json({ error: 'forbidden' });
  const ok = deleteRoom(room);
  if (!ok) return res.status(404).json({ error: 'Room not found' });
  io.in(room).emit('room-deleted', { room });
  io.socketsLeave(room);
  presence.delete(room);
  broadcastRooms();
  return res.json({ ok: true, room });
});

// ── REST: users ──────────────────────────────────────────────────────────────
app.post('/api/users/delete', (req, res) => {
  const clientId = (req.body && req.body.clientId) ? String(req.body.clientId).trim() : '';
  if (!clientId) return res.status(400).json({ error: 'clientId required' });
  const result = deleteUser(clientId);
  if (!result.ok) return res.status(400).json({ error: result.error });
  io.emit('user-deleted', { clientId });
  broadcastRooms();
  return res.json({ ok: true });
});

app.post('/api/rooms/:room/transfer', (req, res) => {
  const room = sanitizeRoomName(req.params.room) || DEFAULT_ROOM;
  if (room === DEFAULT_ROOM) return res.status(400).json({ error: 'Cannot transfer default room' });
  const clientId = (req.body && req.body.clientId) ? String(req.body.clientId).trim() : '';
  const newOwnerId = (req.body && req.body.newOwnerId) ? String(req.body.newOwnerId).trim() : '';
  const meta = getRoomMeta(room);
  if (!meta.ownerId || meta.ownerId !== clientId) return res.status(403).json({ error: 'forbidden' });
  const result = transferRoomOwnership(room, newOwnerId);
  if (!result.ok) return res.status(400).json({ error: result.error });
  broadcastRooms();
  return res.json({ ok: true });
});

app.get('/api/users', (req, res) => res.json({ users: getAllUsers() }));

// Check username availability (case-insensitive, ignores own current name)
app.get('/api/users/check-username', (req, res) => {
  const raw = String(req.query.username || '').trim();
  const ownClientId = String(req.query.clientId || '').trim();
  if (!raw) return res.json({ available: false, error: 'empty' });
  if (raw.length < 2) return res.json({ available: false, error: 'too_short' });
  if (raw.length > 50) return res.json({ available: false, error: 'too_long' });
  if (isReservedUsername(raw)) return res.json({ available: false, error: 'reserved' });
  const lc = raw.toLowerCase();
  const taken = getAllUsers().some(u => {
    if (ownClientId && u.clientId === ownClientId) return false;
    return (u.username || '').toLowerCase() === lc;
  });
  return res.json({ available: !taken, username: raw });
});

app.post('/api/admins/prune', requireAdminToken, (req, res) => {
  const names = Array.isArray((req.body || {}).usernames) ? req.body.usernames : ['gg_games'];
  const result = pruneAdminsToUsernames(names);
  broadcastRooms();
  return res.json({ ok: true, ...result, usernames: names });
});

// ── REST: search ──────────────────────────────────────────────────────────────
app.get('/api/rooms/:room/search', (req, res) => {
  const room = sanitizeRoomName(req.params.room) || DEFAULT_ROOM;
  const q = String(req.query.q || '').trim().toLowerCase();
  const clientId = String(req.query.clientId || '').trim();
  
  if (!q) return res.json({ room, results: [] });
  ensureRoom(room);
  
  if (!canAccessRoom(room, clientId) && !hasEphemeralAccess(room, clientId)) {
    return res.status(403).json({ error: 'forbidden' });
  }
  
  const allMessages = getMessages(room, 1000); // Search up to last 1000 messages
  const results = allMessages.filter(m => (m.message || '').toLowerCase().includes(q) || (m.username || '').toLowerCase().includes(q));
  
  return res.json({ room, query: q, results });
});

// ── Server & Socket.IO ───────────────────────────────────────────────────────
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: true,
    methods: ['GET', 'POST']
  },
  allowRequest: (req, cb) => cb(null, isOriginAllowed(req.headers.origin, req.headers.host))
});

app.post('/admin/shutdown', requireAdminToken, (req, res) => {
  res.json({ ok: true });
  setTimeout(() => { try { server.close(() => process.exit(0)); } catch { process.exit(0); } }, 50);
});

// ── Helpers ──────────────────────────────────────────────────────────────────
function sanitizeRoomName(input) {
  return String(input || DEFAULT_ROOM).trim().toLowerCase().replace(/[^a-z0-9_-]/gi, '-').slice(0, 50) || DEFAULT_ROOM;
}
function isReservedUsername(input) {
  return String(input || '').trim().toLowerCase().includes('anonymous');
}

// Check if any active socket for this clientId has ephemeral passkey access to the room
function hasEphemeralAccess(room, clientId) {
  if (!room || !clientId) return false;
  for (const s of io.sockets.sockets.values()) {
    if (s.data && s.data.clientId === clientId && s.data.passkeyAccess && s.data.passkeyAccess.has(room)) return true;
  }
  return false;
}

// Check if a clientId is a passkey-only guest (no stored DB access)
function isPasskeyGuest(room, clientId) {
  if (!room || !clientId) return false;
  if (canAccessRoom(room, clientId)) return false;
  return hasEphemeralAccess(room, clientId);
}

let broadcastRooms = () => {
  io.sockets.sockets.forEach(s => s.emit('rooms', getVisibleRoomsForClient(s)));
};

function getVisibleRoomsForClient(client) {
  const rooms = getRooms();
  const cid = client && client.data ? client.data.clientId : null;
  return rooms.filter(room => {
    if (!room.isPrivate) return true;
    if (canAccessRoom(room.name, cid)) return true;
    return client.data && client.data.passkeyAccess && client.data.passkeyAccess.has(room.name);
  });
}

function notifyNewMessage(room, fromUsername, preview, senderId) {
  const r = String(room || '').trim();
  const snippet = (typeof preview === 'string' && preview.trim()) ? preview.trim().slice(0, 60) : '';
  const text = `🔔 New in #${r} from ${fromUsername || 'Someone'}${snippet ? `: ${snippet}` : ''}`;
  io.sockets.sockets.forEach(s => {
    const cid = s.data && s.data.clientId;
    if (s.data && s.data.currentRoom === r) return; // already viewing
    if (cid === senderId) return; // sender
    const canSee = canAccessRoom(r, cid) || (s.data && s.data.passkeyAccess && s.data.passkeyAccess.has(r));
    if (!canSee) return;
    s.emit('system', { type: 'notify', room: r, from: fromUsername || 'Someone', preview: snippet, message: text });
  });
}

// ── Presence ─────────────────────────────────────────────────────────────────
const presence = new Map();

function getPresence(room) {
  const map = presence.get(String(room || '').trim());
  return map ? Array.from(map.values()) : [];
}

function aggregatePresenceAll() {
  const all = [], seen = new Set();
  for (const [room, map] of presence.entries()) {
    for (const info of map.values()) {
      const key = info.clientId || `${room}:${info.userId}`;
      if (seen.has(key)) continue;
      all.push({ username: info.username || 'Anonymous', avatar: info.avatar || '', clientId: info.clientId, room });
      seen.add(key);
    }
  }
  return all;
}

function broadcastPresenceAll() { io.emit('presence-all', { users: aggregatePresenceAll() }); }

function presenceJoin(room, socket) {
  const r = String(room || '').trim();
  let map = presence.get(r);
  if (!map) { map = new Map(); presence.set(r, map); }
  map.set(socket.id, {
    username: socket.data.username || 'Anonymous',
    avatar: socket.data.avatar || '',
    clientId: socket.data.clientId || null,
    userId: socket.data.userId,
    since: Date.now(),
  });
  io.to(r).emit('presence', { room: r, users: getPresence(r) });
  broadcastPresenceAll();
}

function presenceLeave(room, socket) {
  const r = String(room || '').trim();
  const map = presence.get(r);
  if (!map) return;
  map.delete(socket.id);
  if (map.size === 0) presence.delete(r);
  io.to(r).emit('presence', { room: r, users: getPresence(r) });
  broadcastPresenceAll();
}

// ── Socket.IO events ──────────────────────────────────────────────────────────
io.on('connection', (socket) => {
  socket.data.userId = socket.id;
  socket.data.passkeyAccess = new Set();
  socket.emit('presence-all', { users: aggregatePresenceAll() });
  socket.emit('rooms', getVisibleRoomsForClient(socket));

  function defaultAvatar(name) {
    return `https://api.dicebear.com/7.x/thumbs/svg?seed=${encodeURIComponent(String(name || 'Anonymous'))}`;
  }

  function buildEnrichedMeta(r, requesterId) {
    const meta = getRoomMeta(r);
    const isManager = canManageRoom(r, requesterId);
    const out = isManager ? meta : { ...meta, passkey: '' };
    const users = getAllUsers();
    const resolve = id => {
      const u = users.find(u => u.clientId === id);
      return u ? { clientId: id, username: u.username, avatar: u.avatar || '' }
               : { clientId: id, username: id.slice(0, 12) + '…', avatar: '' };
    };
    return {
      ...out,
      ownerInfo: out.ownerId ? resolve(out.ownerId) : null,
      adminsInfo: (out.admins || []).map(resolve),
      membersInfo: (out.members || []).map(resolve),
    };
  }

  // join ─────────────────────────────────────────────────────────────────────
  socket.on('rename-identity', (p) => {
    const oc = String((p && p.oldClientId) || '').trim().slice(0, 64);
    const ou = String((p && p.oldUsername) || '').trim().slice(0, 50);
    if (!oc && !ou) return;
    purgeIdentity(oc, ou);
    io.emit('identity-purged', { clientId: oc, username: ou });
  });

  socket.on('join', (payload) => {
    if (!socketRateOk(socket, 'join', 60, 60 * 1000)) return;
    let p = payload;
    if (typeof p === 'string') p = { username: p, room: DEFAULT_ROOM };
    const username = (typeof p.username === 'string' && p.username.trim()) ? p.username.trim().slice(0, 50) : 'Anonymous';
    if (username !== 'Anonymous' && isReservedUsername(username)) {
      socket.emit('system', { type: 'error', message: 'Usernames containing "anonymous" are reserved.' });
      return;
    }
    const room     = sanitizeRoomName(p.room);
    const avatar   = sanitizeAvatarUrl(p.avatar) || defaultAvatar(username);
    const clientId = (typeof p.clientId === 'string' && p.clientId.trim()) ? p.clientId.trim().slice(0, 64) : null;
    const passkey  = (typeof p.passkey === 'string') ? p.passkey.trim() : '';

    // Leave previous room (keep passkeyAccess — no need to re-enter each switch)
    if (socket.data.currentRoom && socket.data.currentRoom !== room) {
      const prev = socket.data.currentRoom;
      presenceLeave(prev, socket);
      socket.leave(prev);
      socket.to(prev).emit('system', { type: 'leave', message: `${socket.data.username || 'Someone'} left #${prev}` });
    }

    ensureRoom(room);
    if (!canAccessRoom(room, clientId)) {
      const meta = getRoomMeta(room);
      if (meta && meta.isPrivate) {
        const alreadyGranted = socket.data.passkeyAccess.has(room);
        const payloadOk = passkey && verifyRoomPasskey(room, passkey);
        if (alreadyGranted || payloadOk) {
          socket.data.passkeyAccess.add(room);
        } else {
          socket.emit('system', { type: 'error', message: `#${room} is private. Enter its passkey to join.` });
          return;
        }
      } else {
        socket.emit('system', { type: 'error', message: `Access denied to #${room}` });
        socket.emit('rooms', getVisibleRoomsForClient(socket));
        return;
      }
    }

    socket.data.username = username;
    socket.data.avatar = avatar;
    socket.data.clientId = clientId;
    socket.data.currentRoom = room;
    socket.join(room);

    if (clientId) recordUser(clientId, { username, avatar });

    socket.emit('system', { type: 'welcome', message: `Welcome, ${username}! You joined #${room}` });
    socket.to(room).emit('system', { type: 'join', message: `${username} joined #${room}` });
    socket.emit('rooms', getVisibleRoomsForClient(socket));
    socket.emit('history', { room, messages: getMessages(room, 100) });
    presenceJoin(room, socket);
  });

  // leave — handle both event names the client may emit
  function handleLeave() {
    const room = socket.data.currentRoom;
    if (!room) return;
    presenceLeave(room, socket);
    socket.leave(room);
    socket.to(room).emit('system', { type: 'leave', message: `${socket.data.username || 'Someone'} left #${room}` });
    socket.data.currentRoom = null;
  }
  socket.on('leave', handleLeave);
  socket.on('leave-room', handleLeave);

  socket.on('list-rooms', () => socket.emit('rooms', getVisibleRoomsForClient(socket)));

  socket.on('create-room', (payload) => {
    if (!socketRateOk(socket, 'create-room', 10, 10 * 60 * 1000)) return;
    let name = '', isPrivate = false, admins = [], members = [];
    if (typeof payload === 'string') { name = sanitizeRoomName(payload); }
    else if (payload && typeof payload === 'object') {
      name = sanitizeRoomName(payload.name);
      isPrivate = !!payload.isPrivate;
      admins = Array.isArray(payload.admins) ? payload.admins.map(x => String(x).trim().slice(0, 64)).filter(Boolean) : [];
      members = Array.isArray(payload.members) ? payload.members.map(x => String(x).trim().slice(0, 64)).filter(Boolean) : [];
    }
    if (!name) return;
    const result = createRoom(name, { isPrivate, ownerId: socket.data.clientId || null, admins, members });
    if (!result.ok) return;
    broadcastRooms();
  });

  // chat-message ──────────────────────────────────────────────────────────────
  socket.on('chat-message', (text) => {
    if (!socketRateOk(socket, 'chat-message', 40, 60 * 1000)) return;
    let msg = '', replyToId = '';
    if (typeof text === 'string') { msg = text.trim(); }
    else if (text && typeof text === 'object') {
      msg = typeof text.text === 'string' ? text.text.trim() : '';
      replyToId = typeof text.replyTo === 'string' ? text.replyTo.trim() : '';
    }
    const room = socket.data.currentRoom;
    if (!msg || !room) return;
    const hasEphemeral = socket.data.passkeyAccess.has(room);
    if (!canAccessRoom(room, socket.data.clientId) && !hasEphemeral) return;
    const linkCheck = validateMessageLinks(msg);
    if (!linkCheck.ok) {
      socket.emit('system', { type: 'error', message: `Blocked unsafe link: ${linkCheck.reason}.` });
      return;
    }

    let replySnapshot = null;
    if (replyToId) {
      try {
        const orig = getMessageById(room, replyToId);
        if (orig) {
          replySnapshot = {
            id: orig.id,
            username: orig.username || 'Anonymous',
            message: orig.type === 'image' ? '' : (orig.message || ''),
            type: orig.type || 'text',
            imageUrl: orig.imageUrl || '',
          };
        }
      } catch {}
    }

    const payload = {
      id: `${Date.now()}-${socket.id}`,
      room,
      userId: socket.data.userId,
      clientId: socket.data.clientId || null,
      username: socket.data.username || 'Anonymous',
      avatar: socket.data.avatar || defaultAvatar(socket.data.username),
      message: msg.slice(0, 2000),
      timestamp: Date.now(),
      readBy: [{ userId: socket.data.userId, username: socket.data.username, at: Date.now() }],
      reactions: {},
      ...(replySnapshot ? { replyTo: replySnapshot } : {}),
    };
    addMessage(room, payload);
    io.to(room).emit('chat-message', payload);
    notifyNewMessage(room, payload.username, msg, socket.data.clientId);
  });

  socket.on('typing', ({ isTyping } = {}) => {
    if (!socketRateOk(socket, 'typing', 120, 60 * 1000)) return;
    const room = socket.data.currentRoom;
    if (!room) return;
    socket.to(room).emit('typing', { userId: socket.data.userId, username: socket.data.username || 'Anonymous', isTyping: !!isTyping });
  });

  socket.on('edit-message', ({ messageId, text } = {}) => {
    const room = socket.data.currentRoom;
    if (!room || !messageId || typeof text !== 'string') return;
    const linkCheck = validateMessageLinks(text);
    if (!linkCheck.ok) { socket.emit('system', { type: 'error', message: `Blocked unsafe link: ${linkCheck.reason}.` }); return; }
    const result = editMessage(room, messageId, socket.data.userId, text, Date.now(), socket.data.clientId);
    if (result.ok) { io.to(room).emit('message-updated', result.message); }
    else { socket.emit('error', { action: 'edit-message', error: result.error }); }
  });

  socket.on('delete-message', ({ messageId } = {}) => {
    const room = socket.data.currentRoom;
    if (!room || !messageId) return;
    const result = deleteMessage(room, messageId, socket.data.userId, socket.data.clientId);
    if (result.ok) { io.to(room).emit('message-deleted', { messageId, room }); }
    else { socket.emit('error', { action: 'delete-message', error: result.error }); }
  });

  socket.on('react-message', ({ messageId, emoji } = {}) => {
    const room = socket.data.currentRoom;
    if (!room || !messageId || !emoji) return;
    const hasEphemeral = socket.data.passkeyAccess.has(room);
    if (!canAccessRoom(room, socket.data.clientId) && !hasEphemeral) return;
    
    const msg = getMessageById(room, messageId);
    if (!msg) return;
    
    const userId = socket.data.clientId || socket.data.userId;
    const username = socket.data.username || 'Anonymous';
    
    if (!msg.reactions) msg.reactions = {};
    if (!msg.reactions[emoji]) msg.reactions[emoji] = [];
    
    // Match by userId, or by username as a fallback for reactions stored
    // in older sessions that used the transient socket.id as userId.
    const existingIdx = msg.reactions[emoji].findIndex(
      r => r.userId === userId || (username !== 'Anonymous' && r.username === username)
    );

    if (existingIdx !== -1) {
      // Toggle off
      msg.reactions[emoji].splice(existingIdx, 1);
      if (msg.reactions[emoji].length === 0) delete msg.reactions[emoji];
    } else {
      // Guard against duplicate reaction from same user on same emoji
      // (shouldn't happen with correct toggle, but be safe)
      const alreadyHas = msg.reactions[emoji].some(
        r => r.userId === userId || (username !== 'Anonymous' && r.username === username)
      );
      if (!alreadyHas) {
        // Toggle on — always store with persistent clientId as userId
        msg.reactions[emoji].push({ userId, username });
      }
    }

    // Persist reactions to storage so they survive refreshes
    updateMessageReactions(room, messageId, msg.reactions);

    io.to(room).emit('message-reaction', { messageId, room, reactions: msg.reactions });
  });

  socket.on('mark-read', ({ room, messageId }) => {
    const r = sanitizeRoomName(room || socket.data.currentRoom);
    if (!r || !messageId) return;
    const hasEphemeral = socket.data.passkeyAccess.has(r);
    if (!canAccessRoom(r, socket.data.clientId) && !hasEphemeral) return;
    const ok = addReceipt(r, messageId, socket.data.userId, socket.data.username || 'Anonymous');
    if (ok) io.to(r).emit('read-receipt', { messageId, userId: socket.data.userId, username: socket.data.username || 'Anonymous' });
  });

  socket.on('clear-room', () => {
    const room = socket.data.currentRoom;
    if (!room || !canManageRoom(room, socket.data.clientId)) return;
    clearRoom(room);
    io.to(room).emit('history', { room, messages: [] });
    broadcastRooms();
  });

  socket.on('delete-room', () => {
    const room = socket.data.currentRoom;
    if (!room || room === DEFAULT_ROOM) return;
    if (!canManageRoom(room, socket.data.clientId)) return;
    const ok = deleteRoom(room);
    if (!ok) return;
    io.in(room).emit('room-deleted', { room });
    io.socketsLeave(room);
    presence.delete(room);
    broadcastRooms();
  });

  // Room meta / settings ──────────────────────────────────────────────────────
  socket.on('get-room-meta', (payload = {}, ack) => {
    const target = payload && payload.room ? sanitizeRoomName(payload.room) : (socket.data.currentRoom || DEFAULT_ROOM);
    if (!target) return;
    const hasEphemeral = socket.data.passkeyAccess.has(target);
    if (!canAccessRoom(target, socket.data.clientId) && !hasEphemeral) return;
    const enriched = buildEnrichedMeta(target, socket.data.clientId);
    if (typeof ack === 'function') ack(enriched);
    socket.emit('room-meta', { room: target, meta: enriched });
  });

  socket.on('rename-room', ({ room, newName } = {}, ack) => {
    const from = sanitizeRoomName(room || socket.data.currentRoom || DEFAULT_ROOM);
    const to = sanitizeRoomName(newName || '');
    if (!from || !to) { if (typeof ack === 'function') ack({ ok: false, error: 'invalid' }); return; }
    if (from === DEFAULT_ROOM || to === DEFAULT_ROOM) { if (typeof ack === 'function') ack({ ok: false, error: 'default_room' }); return; }
    if (!canManageRoom(from, socket.data.clientId)) { if (typeof ack === 'function') ack({ ok: false, error: 'forbidden' }); return; }
    const result = renameRoom(from, to);
    if (!result.ok) { if (typeof ack === 'function') ack({ ok: false, error: result.error }); return; }
    io.sockets.sockets.forEach(s => {
      if (s && s.data && s.data.currentRoom === from) {
        presenceLeave(from, s);
        s.leave(from);
        s.join(to);
        s.data.currentRoom = to;
        presenceJoin(to, s);
        s.emit('room-renamed', { from, to });
      }
    });
    broadcastRooms();
    if (typeof ack === 'function') ack({ ok: true, from, to });
  });

  socket.on('set-room-privacy', ({ room, isPrivate } = {}, ack) => {
    const r = sanitizeRoomName(room || socket.data.currentRoom || DEFAULT_ROOM);
    if (!r) { if (typeof ack === 'function') ack({ ok: false, error: 'invalid_room' }); return; }
    if (!canManageRoom(r, socket.data.clientId)) { if (typeof ack === 'function') ack({ ok: false, error: 'forbidden' }); return; }
    const res = setRoomPrivacy(r, !!isPrivate);
    const enriched = buildEnrichedMeta(r, socket.data.clientId);
    socket.emit('room-meta', { room: r, meta: enriched });
    broadcastRooms();
    if (typeof ack === 'function') ack({ ok: true, room: r, isPrivate: res.isPrivate });
  });

  socket.on('add-room-admins', ({ room, admins } = {}) => {
    const r = sanitizeRoomName(room);
    if (!r || !canManageRoom(r, socket.data.clientId)) return;
    const allowed = (Array.isArray(admins) ? admins.map(x => String(x).trim().slice(0, 64)).filter(Boolean) : [])
      .filter(id => !isPasskeyGuest(r, id));
    addRoomAdmins(r, allowed);
    socket.emit('room-meta', { room: r, meta: buildEnrichedMeta(r, socket.data.clientId) });
    broadcastRooms();
  });

  socket.on('add-room-members', ({ room, members } = {}) => {
    const r = sanitizeRoomName(room);
    if (!r || !canManageRoom(r, socket.data.clientId)) return;
    addRoomMembers(r, Array.isArray(members) ? members : []);
    socket.emit('room-meta', { room: r, meta: buildEnrichedMeta(r, socket.data.clientId) });
    broadcastRooms();
  });

  socket.on('set-room-admins', ({ room, admins } = {}) => {
    const r = sanitizeRoomName(room);
    if (!r || !canManageRoom(r, socket.data.clientId)) return;
    const meta = getRoomMeta(r);
    const list = (Array.isArray(admins) ? admins.map(x => String(x || '').trim().slice(0, 64)).filter(Boolean) : [])
      .filter(id => !isPasskeyGuest(r, id));
    // Owner always stays in the admin list
    setRoomAdmins(r, Array.from(new Set([...list, meta.ownerId].filter(Boolean))));
    socket.emit('room-meta', { room: r, meta: buildEnrichedMeta(r, socket.data.clientId) });
    broadcastRooms();
  });

  socket.on('set-room-members', ({ room, members } = {}) => {
    const r = sanitizeRoomName(room);
    if (!r || !canManageRoom(r, socket.data.clientId)) return;
    setRoomMembers(r, (Array.isArray(members) ? members : []).map(x => String(x || '').trim().slice(0, 64)).filter(Boolean));
    socket.emit('room-meta', { room: r, meta: buildEnrichedMeta(r, socket.data.clientId) });
    broadcastRooms();
  });

  socket.on('remove-room-admin', ({ room, adminId } = {}, ack) => {
    const r = sanitizeRoomName(room || socket.data.currentRoom);
    if (!r) { if (typeof ack === 'function') ack({ ok: false, error: 'invalid_room' }); return; }
    if (!canManageRoom(r, socket.data.clientId)) { if (typeof ack === 'function') ack({ ok: false, error: 'forbidden' }); return; }
    const meta = getRoomMeta(r);
    if (meta.ownerId && adminId === meta.ownerId) {
      socket.emit('system', { type: 'error', message: 'The room owner cannot be removed from admins.' });
      if (typeof ack === 'function') ack({ ok: false, error: 'cannot_remove_owner' });
      return;
    }
    const newAdmins = (meta.admins || []).filter(id => id !== adminId);
    if (meta.ownerId && !newAdmins.includes(meta.ownerId)) newAdmins.push(meta.ownerId);
    setRoomAdmins(r, newAdmins);
    socket.emit('room-meta', { room: r, meta: buildEnrichedMeta(r, socket.data.clientId) });
    broadcastRooms();
    if (typeof ack === 'function') ack({ ok: true });
  });

  socket.on('remove-room-member', ({ room, memberId } = {}, ack) => {
    const r = sanitizeRoomName(room || socket.data.currentRoom);
    if (!r) { if (typeof ack === 'function') ack({ ok: false, error: 'invalid_room' }); return; }
    if (!canManageRoom(r, socket.data.clientId)) { if (typeof ack === 'function') ack({ ok: false, error: 'forbidden' }); return; }
    const meta = getRoomMeta(r);
    setRoomMembers(r, (meta.members || []).filter(id => id !== memberId));
    socket.emit('room-meta', { room: r, meta: buildEnrichedMeta(r, socket.data.clientId) });
    broadcastRooms();
    if (typeof ack === 'function') ack({ ok: true });
  });

  // Passkey ───────────────────────────────────────────────────────────────────
  socket.on('find-room-by-passkey', (payload = {}, ack) => {
    if (!socketRateOk(socket, 'find-room-by-passkey', 20, 60 * 1000)) { if (typeof ack === 'function') ack({ ok: false, error: 'rate_limited' }); return; }
    const passkey = (payload && typeof payload.passkey === 'string') ? payload.passkey.trim() : '';
    const room = passkey ? findRoomByPasskey(passkey) : null;
    const resp = room ? { ok: true, room } : { ok: false, error: 'not_found' };
    if (typeof ack === 'function') ack(resp);
    else socket.emit('find-room-by-passkey-result', resp);
  });

  socket.on('enter-passkey', ({ room, passkey } = {}, ack) => {
    if (!socketRateOk(socket, 'enter-passkey', 20, 60 * 1000)) { if (typeof ack === 'function') ack({ ok: false, message: 'Too many attempts' }); return; }
    const r = sanitizeRoomName(room);
    const key = String(passkey || '').trim();
    if (verifyRoomPasskey(r, key)) {
      socket.data.passkeyAccess.add(r);
      if (typeof ack === 'function') ack({ ok: true, room: r });
    } else {
      if (typeof ack === 'function') ack({ ok: false, message: 'Invalid passkey' });
    }
  });

  function randomPasskey(len = 8) {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let out = '';
    for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)];
    return out;
  }

  socket.on('generate-room-passkey', ({ room } = {}, ack) => {
    const r = sanitizeRoomName(room || socket.data.currentRoom || DEFAULT_ROOM);
    if (!r || r === DEFAULT_ROOM || !canManageRoom(r, socket.data.clientId)) {
      if (typeof ack === 'function') ack({ ok: false, error: r === DEFAULT_ROOM ? 'default_room_public' : 'forbidden' });
      return;
    }
    let key = randomPasskey(8), tries = 0;
    while (tries++ < 20) { const other = findRoomByPasskey(key); if (!other || other === r) break; key = randomPasskey(8); }
    setRoomPasskey(r, key);
    socket.emit('room-meta', { room: r, meta: buildEnrichedMeta(r, socket.data.clientId) });
    if (typeof ack === 'function') ack({ ok: true, room: r, passkey: key });
  });

  socket.on('set-room-passkey', ({ room, passkey } = {}, ack) => {
    const r = sanitizeRoomName(room || socket.data.currentRoom || DEFAULT_ROOM);
    if (!r || r === DEFAULT_ROOM || !canManageRoom(r, socket.data.clientId)) {
      if (typeof ack === 'function') ack({ ok: false, error: r === DEFAULT_ROOM ? 'default_room_public' : 'forbidden' });
      return;
    }
    const key = (typeof passkey === 'string') ? passkey.trim() : '';
    if (key) { const other = findRoomByPasskey(key); if (other && other !== r) { if (typeof ack === 'function') ack({ ok: false, error: 'in_use' }); return; } }
    setRoomPasskey(r, key);
    socket.emit('room-meta', { room: r, meta: buildEnrichedMeta(r, socket.data.clientId) });
    if (typeof ack === 'function') ack({ ok: true, room: r, passkey: key });
  });

  // Profile ───────────────────────────────────────────────────────────────────
  socket.on('update-profile', ({ room, username, avatar } = {}) => {
    const r = sanitizeRoomName(room || socket.data.currentRoom);
    if (!r) return;
    const oldUsername = socket.data.username;
    const newUsername = (typeof username === 'string' && username.trim()) ? username.trim().slice(0, 50) : oldUsername;
    if (isReservedUsername(newUsername)) {
      socket.emit('system', { type: 'error', message: 'Usernames containing "anonymous" are reserved.' });
      return;
    }

    // Prevent username theft: check if the new name is taken by someone else
    if (newUsername !== oldUsername) {
      const lc = newUsername.toLowerCase();
      const taken = getAllUsers().some(u => u.clientId !== socket.data.clientId && (u.username || '').toLowerCase() === lc);
      if (taken) {
        socket.emit('system', { type: 'error', message: `Username "${newUsername}" is already taken.` });
        return;
      }
    }

    socket.data.username = newUsername;
    socket.data.avatar = sanitizeAvatarUrl(avatar) || `https://api.dicebear.com/7.x/thumbs/svg?seed=${encodeURIComponent(newUsername)}`;
    if (socket.data.clientId) recordUser(socket.data.clientId, { username: socket.data.username, avatar: socket.data.avatar });

    const map = presence.get(r);
    if (map && map.has(socket.id)) {
      const entry = map.get(socket.id);
      entry.username = socket.data.username;
      entry.avatar = socket.data.avatar;
      io.to(r).emit('presence', { room: r, users: getPresence(r) });
      broadcastPresenceAll();
    }
  });

  // Username check ────────────────────────────────────────────────────────────
  socket.on('check-username', ({ username } = {}, ack) => {
    const raw = String(username || '').trim();
    if (!raw) { if (typeof ack === 'function') ack({ available: false, error: 'empty' }); return; }
    if (raw.length < 2) { if (typeof ack === 'function') ack({ available: false, error: 'too_short' }); return; }
    if (raw.length > 50) { if (typeof ack === 'function') ack({ available: false, error: 'too_long' }); return; }
    if (isReservedUsername(raw)) { if (typeof ack === 'function') ack({ available: false, error: 'reserved' }); return; }
    const lc = raw.toLowerCase();
    const taken = getAllUsers().some(u => u.clientId !== socket.data.clientId && (u.username || '').toLowerCase() === lc);
    if (typeof ack === 'function') ack({ available: !taken, username: raw });
  });

  // Users ─────────────────────────────────────────────────────────────────────
  socket.on('list-users', () => socket.emit('users', getAllUsers()));

  // Disconnect ────────────────────────────────────────────────────────────────
  socket.on('disconnect', () => {
    const room = socket.data.currentRoom;
    if (room) {
      presenceLeave(room, socket);
      socket.to(room).emit('system', { type: 'leave', message: `${socket.data.username || 'Someone'} left #${room}` });
    }
    broadcastPresenceAll();
  });
});

server.listen(PORT, HOST, async () => {
  // ── Print every LAN IP (same Wi-Fi) ──────────────────────────────────
  const { networkInterfaces } = require('os');
  const nets = networkInterfaces();
  const lanIPs = [];
  for (const iface of Object.values(nets)) {
    for (const addr of iface) {
      if (addr.family === 'IPv4' && !addr.internal) lanIPs.push(addr.address);
    }
  }
  console.log('Chat server running — same Wi-Fi:');
  lanIPs.forEach(ip => console.log(`  http://${ip}:${PORT}`));
  if (lanIPs.length === 0) console.log(`  http://localhost:${PORT}`);

  // ── Public tunnel (any network / different Wi-Fi) ─────────────────────
  // Start with:  TUNNEL=1 node server.js
  if (process.env.TUNNEL === '1') {
    try {
      const localtunnel = require('localtunnel');
      const tunnel = await localtunnel({ port: PORT });
      console.log('\nPublic URL (any network):');
      console.log(`  ${tunnel.url}`);
      console.log('  Share this link — works from any Wi-Fi or mobile data.\n');
      tunnel.on('close', () => console.log('Tunnel closed.'));
      tunnel.on('error', err => console.error('Tunnel error:', err.message));
    } catch (err) {
      console.error('Could not open tunnel:', err.message);
      console.error('localtunnel is no longer a production dependency; run  npm install localtunnel  only on trusted dev machines, or use a reverse proxy.');
    }
  }
});
