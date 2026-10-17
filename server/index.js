const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const http = require('node:http');
const express = require('express');
const { Server } = require('socket.io');
const { all, get, run, tx, dataDir } = require('./db');
const auth = require('./auth');
const mail = require('./mail');
const alerts = require('./alerts');
const perms = require('./perms');
const U = require('./util');

const PORT = Number(process.env.PORT || 4200);
const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: false, limit: '100kb' })); // plain HTML website forms

perms.seedRoles();
const roleId = (system) => get('SELECT id FROM roles WHERE system = ?', system)?.id;

// ---------- first run: create the admin account ----------
if (!get('SELECT id FROM users LIMIT 1')) {
  const email = (process.env.ADMIN_EMAIL || 'admin@crystalshield.ae').toLowerCase();
  const password = process.env.ADMIN_PASSWORD || crypto.randomBytes(6).toString('base64url');
  run('INSERT INTO users (name, email, password_hash, role_id, title) VALUES (?, ?, ?, ?, ?)',
    'Crystal Shield Admin', email, auth.hashPassword(password), roleId('admin'), 'Administrator');
  if (!process.env.ADMIN_PASSWORD) {
    fs.writeFileSync(path.join(dataDir, 'FIRST_ADMIN_LOGIN.txt'), `Email: ${email}\nPassword: ${password}\n\nSign in, change this password under Profile, then delete this file.\n`);
  }
  console.log(`[hub] created admin ${email} (password in data/FIRST_ADMIN_LOGIN.txt or ADMIN_PASSWORD)`);
}
// Recovery: ADMIN_RESET=1 with ADMIN_EMAIL + ADMIN_PASSWORD sets that admin's password on start-up.
if (process.env.ADMIN_RESET === '1' && process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD) {
  const email = process.env.ADMIN_EMAIL.trim().toLowerCase();
  const existing = get('SELECT id FROM users WHERE email = ?', email);
  if (existing) run('UPDATE users SET password_hash = ?, role_id = ?, active = 1 WHERE id = ?', auth.hashPassword(process.env.ADMIN_PASSWORD), roleId('admin'), existing.id);
  else run('INSERT INTO users (name, email, password_hash, role_id, title) VALUES (?, ?, ?, ?, ?)', 'Crystal Shield Admin', email, auth.hashPassword(process.env.ADMIN_PASSWORD), roleId('admin'), 'Administrator');
  run('DELETE FROM sessions WHERE user_id = (SELECT id FROM users WHERE email = ?)', email);
  console.log(`[hub] ADMIN_RESET: password set for ${email}. Remove ADMIN_RESET now.`);
}

// ---------- helpers ----------
const COLORS = ['#00386b', '#0069b7', '#3da4e4', '#e5484d', '#f76b15', '#12a594', '#d6409f', '#3e63dd', '#ad7f00', '#30a46c'];
class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
const fail = (status, message) => { throw new HttpError(status, message); };
const clean = (v, max = 5000) => (typeof v === 'string' ? v.trim().slice(0, max) : typeof v === 'number' ? String(v) : '');
const h = (fn) => (req, res) => {
  try {
    const out = fn(req, res);
    if (out !== undefined && !res.headersSent) res.json(out);
  } catch (err) {
    if (!(err instanceof HttpError)) console.error(err);
    if (!res.headersSent) res.status(err.status || 500).json({ error: err.status ? err.message : 'Server error' });
  }
};
const ha = (fn) => async (req, res) => {
  try {
    const out = await fn(req, res);
    if (out !== undefined && !res.headersSent) res.json(out);
  } catch (err) {
    if (!err.status) console.error(err);
    if (!res.headersSent) res.status(err.status || 500).json({ error: err.status ? err.message : 'Server error' });
  }
};
const { can, scope } = perms;
const need = (mod, action = 'view') => (req, res, next) => {
  if (!can(req.user, mod, action)) return res.status(403).json({ error: "You don't have access to do that" });
  next();
};
const isAdmin = (u) => perms.isAdmin(u);

function activeStatus(u) {
  if (!u.status_emoji && !u.status_text) return null;
  if (u.status_until && u.status_until < new Date().toISOString()) return null;
  return { emoji: u.status_emoji || '', text: u.status_text || '', until: u.status_until || null };
}
function publicUser(u) {
  if (!u) return null;
  const role = perms.roleOf(u);
  return {
    id: u.id, name: u.name, email: u.email, title: u.title, phone: u.phone, color: u.color, active: u.active,
    role_id: u.role_id, role: role?.name || '—', role_system: role?.system || null,
    email_notify: !!u.email_notify, sound: u.sound !== 0, whatsapp: u.whatsapp || '', whatsapp_alerts: u.whatsapp_alerts !== 0,
    office_id: u.office_id || null, shift_id: u.shift_id || null,
    avatar: u.avatar ? `/api/avatars/${u.id}?v=${u.avatar_v || 0}` : null,
    status: activeStatus(u), last_seen: u.last_seen,
    perms: perms.permsFor(u),
  };
}

function requireUser(req, res, next) {
  const user = auth.userFromCookieHeader(req.headers.cookie);
  if (!user) return res.status(401).json({ error: 'Not signed in' });
  req.user = user;
  try { auth.renewSession(req, res); } catch {}
  next();
}

const emitTo = (userIds, event, payload = {}) => { for (const id of new Set(userIds)) if (id) io.to(`u:${id}`).emit(event, payload); };
// Live refresh for everyone who can see a module (the screens re-load what they show)
const broadcast = (mod, event, payload = {}) => emitTo(all('SELECT * FROM users WHERE active = 1').filter((u) => can(u, mod)).map((u) => u.id), event, payload);
const online = new Map();
const isOnline = (id) => (online.get(id) || 0) > 0;

function notify(userIds, { type, title, body = '', link = '' }, { exclude, emailAlways = false } = {}) {
  for (const uid of new Set(userIds)) {
    if (!uid || uid === exclude) continue;
    const u = get('SELECT id, email, active, email_notify FROM users WHERE id = ?', uid);
    if (!u || !u.active) continue;
    const r = run('INSERT INTO notifications (user_id, type, title, body, link) VALUES (?, ?, ?, ?, ?)', uid, type, title, String(body).slice(0, 300), link);
    const row = get('SELECT * FROM notifications WHERE id = ?', r.lastInsertRowid);
    io.to(`u:${uid}`).emit('notification', row);
    alerts.deliver(uid, row, { online: isOnline(uid) });
    if (u.email_notify && (emailAlways || !isOnline(uid))) mail.sendMail(u.email, title, body, link);
  }
}
// Everyone with a given access (e.g. all who can edit invoices)
const usersWith = (mod, action = 'view') => all('SELECT * FROM users WHERE active = 1').filter((u) => can(u, mod, action)).map((u) => u.id);
const managers = () => all('SELECT * FROM users WHERE active = 1').filter((u) => isAdmin(u) || scope(u, 'crm') === 'all' && can(u, 'crm', 'edit')).map((u) => u.id);

// Record history (notes, stage changes, documents) shown on leads, deals, jobs …
function timeline(entity, entityId, userId, kind, body, data = null) {
  run('INSERT INTO timeline (entity, entity_id, user_id, kind, body, data) VALUES (?, ?, ?, ?, ?, ?)',
    entity, entityId, userId || null, kind, String(body).slice(0, 4000), data ? JSON.stringify(data) : null);
}
function mentionedUsers(body) {
  const lower = String(body).toLowerCase();
  return all('SELECT id, name FROM users WHERE active = 1').filter((u) => lower.includes('@' + u.name.toLowerCase())).map((u) => u.id);
}

app.get('/api/health', (req, res) => res.json({ ok: true }));
const BUILD_ID = (() => {
  const hash = crypto.createHash('sha1');
  const walk = (dir) => {
    for (const name of fs.readdirSync(dir).sort()) {
      const full = path.join(dir, name);
      if (fs.statSync(full).isDirectory()) walk(full);
      else if (/\.(js|css|html|webmanifest)$/.test(name)) hash.update(name).update(fs.readFileSync(full));
    }
  };
  try { walk(path.join(__dirname, '..', 'public')); } catch { hash.update(String(Date.now())); }
  return hash.digest('hex').slice(0, 12);
})();
app.get('/api/version', (req, res) => { res.set('Cache-Control', 'no-store'); res.json({ build: BUILD_ID }); });

// ---------- sign in ----------
const loginAttempts = new Map();
app.post('/api/login', h((req, res) => {
  const key = req.ip;
  const attempt = loginAttempts.get(key) || { n: 0, at: Date.now() };
  if (Date.now() - attempt.at > 15 * 60e3) { attempt.n = 0; attempt.at = Date.now(); }
  if (attempt.n >= 10) fail(429, 'Too many attempts. Try again in 15 minutes.');
  const email = clean(req.body.email, 200).toLowerCase();
  const user = get('SELECT * FROM users WHERE lower(email) = ? AND active = 1', email);
  if (!user || !auth.verifyPassword(String(req.body.password || ''), user.password_hash)) {
    attempt.n++; loginAttempts.set(key, attempt);
    fail(401, 'Wrong email or password');
  }
  loginAttempts.delete(key);
  const remember = req.body.remember !== false;
  auth.setSessionCookie(res, auth.createSession(user.id, remember), req.secure, remember);
  return { user: publicUser(user) };
}));
app.post('/api/logout', h((req, res) => { auth.destroySession(req, res); return { ok: true }; }));

// ---------- context shared with every module ----------
const ctx = {
  app, io, h, ha, fail, clean, need, can, scope, isAdmin, notify, emitTo, broadcast, usersWith, managers, timeline,
  mentionedUsers, publicUser, isOnline, U, mail, alerts, HttpError,
};

// Public pages & webhooks (no sign-in): customer documents, website / Meta / WhatsApp leads, warranty check
require('./docs').registerPublic(ctx);
require('./crm').registerPublic(ctx);

app.use('/api', (req, res, next) => {
  const t0 = process.hrtime.bigint();
  res.on('finish', () => {
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    if (ms > 400) console.warn(`[slow] ${Math.round(ms)}ms ${req.method} ${req.originalUrl.split('?')[0]}`);
  });
  next();
});
app.use('/api', requireUser);

app.get('/api/me', h((req) => ({ user: publicUser(req.user) })));
app.patch('/api/me', h((req) => {
  const b = req.body;
  if (b.new_password) {
    if (!auth.verifyPassword(String(b.current_password || ''), req.user.password_hash)) fail(400, 'Current password is wrong');
    if (String(b.new_password).length < 8) fail(400, 'New password must be at least 8 characters');
    run('UPDATE users SET password_hash = ? WHERE id = ?', auth.hashPassword(String(b.new_password)), req.user.id);
  }
  if (b.name !== undefined && clean(b.name, 80)) run('UPDATE users SET name = ? WHERE id = ?', clean(b.name, 80), req.user.id);
  if (b.title !== undefined) run('UPDATE users SET title = ? WHERE id = ?', clean(b.title, 80), req.user.id);
  if (b.phone !== undefined) run('UPDATE users SET phone = ? WHERE id = ?', clean(b.phone, 40), req.user.id);
  if (b.email_notify !== undefined) run('UPDATE users SET email_notify = ? WHERE id = ?', b.email_notify ? 1 : 0, req.user.id);
  if (b.sound !== undefined) run('UPDATE users SET sound = ? WHERE id = ?', b.sound ? 1 : 0, req.user.id);
  if (b.status !== undefined) {
    const st = b.status || {};
    const until = st.until && !isNaN(new Date(st.until)) ? new Date(st.until).toISOString() : null;
    run('UPDATE users SET status_emoji = ?, status_text = ?, status_until = ? WHERE id = ?', clean(st.emoji, 16) || null, clean(st.text, 80) || null, until, req.user.id);
    io.emit('team');
  }
  return { user: publicUser(get('SELECT * FROM users WHERE id = ?', req.user.id)) };
}));

// ---------- team & roles ----------
app.get('/api/users', h((req) => {
  const rows = all(`SELECT * FROM users ${can(req.user, 'team') ? '' : 'WHERE active = 1'} ORDER BY name`);
  return { users: rows.map((u) => ({ ...publicUser(u), perms: undefined, online: isOnline(u.id) })) };
}));
app.post('/api/users', need('team', 'edit'), h((req) => {
  const b = req.body;
  const name = clean(b.name, 80);
  const email = clean(b.email, 200).toLowerCase();
  const password = String(b.password || '');
  const role = get('SELECT * FROM roles WHERE id = ?', Number(b.role_id));
  if (!name || !/^\S+@\S+\.\S+$/.test(email)) fail(400, 'Name and a valid email are required');
  if (!role) fail(400, 'Pick a role');
  if (role.is_admin && !isAdmin(req.user)) fail(403, 'Only admins can add admins');
  if (password.length < 8) fail(400, 'Password must be at least 8 characters');
  if (get('SELECT id FROM users WHERE email = ?', email)) fail(400, 'That email already has an account');
  const color = COLORS[get('SELECT COUNT(*) n FROM users').n % COLORS.length];
  const r = run('INSERT INTO users (name, email, password_hash, role_id, title, phone, color, office_id, shift_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    name, email, auth.hashPassword(password), role.id, clean(b.title, 80), clean(b.phone, 40), color, Number(b.office_id) || null, Number(b.shift_id) || null);
  io.emit('team');
  return { user: publicUser(get('SELECT * FROM users WHERE id = ?', r.lastInsertRowid)) };
}));
app.patch('/api/users/:id', need('team', 'edit'), h((req) => {
  const u = get('SELECT * FROM users WHERE id = ?', req.params.id);
  if (!u) fail(404, 'User not found');
  const b = req.body;
  if (u.id === req.user.id && ((b.role_id && Number(b.role_id) !== u.role_id) || b.active === false)) fail(400, "You can't change your own role or switch off your own account");
  if (!isAdmin(req.user) && (isAdmin(u) || get('SELECT is_admin FROM roles WHERE id = ?', Number(b.role_id))?.is_admin)) fail(403, 'Only admins can change admins');
  if (b.name !== undefined && clean(b.name, 80)) run('UPDATE users SET name = ? WHERE id = ?', clean(b.name, 80), u.id);
  if (b.title !== undefined) run('UPDATE users SET title = ? WHERE id = ?', clean(b.title, 80), u.id);
  if (b.phone !== undefined) run('UPDATE users SET phone = ? WHERE id = ?', clean(b.phone, 40), u.id);
  if (b.role_id && get('SELECT id FROM roles WHERE id = ?', Number(b.role_id))) run('UPDATE users SET role_id = ? WHERE id = ?', Number(b.role_id), u.id);
  if (b.office_id !== undefined) run('UPDATE users SET office_id = ? WHERE id = ?', Number(b.office_id) || null, u.id);
  if (b.shift_id !== undefined) run('UPDATE users SET shift_id = ? WHERE id = ?', Number(b.shift_id) || null, u.id);
  if (b.email !== undefined) {
    const email = clean(b.email, 200).toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(email)) fail(400, 'Enter a valid email');
    if (get('SELECT id FROM users WHERE email = ? AND id != ?', email, u.id)) fail(400, 'That email already has an account');
    run('UPDATE users SET email = ? WHERE id = ?', email, u.id);
  }
  if (b.active !== undefined) {
    run('UPDATE users SET active = ? WHERE id = ?', b.active ? 1 : 0, u.id);
    if (!b.active) run('DELETE FROM sessions WHERE user_id = ?', u.id);
  }
  if (b.password) {
    if (String(b.password).length < 8) fail(400, 'Password must be at least 8 characters');
    run('UPDATE users SET password_hash = ? WHERE id = ?', auth.hashPassword(String(b.password)), u.id);
    run('DELETE FROM sessions WHERE user_id = ?', u.id);
  }
  io.emit('team');
  return { user: publicUser(get('SELECT * FROM users WHERE id = ?', u.id)) };
}));

app.get('/api/roles', h((req) => ({
  roles: all('SELECT r.*, (SELECT COUNT(*) FROM users u WHERE u.role_id = r.id AND u.active = 1) users FROM roles r ORDER BY r.is_admin DESC, r.id')
    .map((r) => ({ ...r, perms: perms.roleOf({ role_id: r.id }).perms })),
  modules: perms.MODULES, flags: perms.FLAGS,
})));
app.post('/api/roles', need('team', 'edit'), h((req) => {
  const name = clean(req.body.name, 60);
  if (!name) fail(400, 'Name the role');
  if (get('SELECT id FROM roles WHERE name = ?', name)) fail(400, 'A role with that name exists');
  const r = run('INSERT INTO roles (name, description, perms) VALUES (?, ?, ?)', name, clean(req.body.description, 200), JSON.stringify(perms.cleanPerms(req.body.perms)));
  perms.clearRoleCache(); io.emit('team');
  return { id: Number(r.lastInsertRowid) };
}));
app.patch('/api/roles/:id', need('team', 'edit'), h((req) => {
  const r = get('SELECT * FROM roles WHERE id = ?', req.params.id);
  if (!r) fail(404, 'Role not found');
  if (r.is_admin) fail(400, 'The Admin role always has full access');
  if (req.body.name !== undefined && clean(req.body.name, 60)) run('UPDATE roles SET name = ? WHERE id = ?', clean(req.body.name, 60), r.id);
  if (req.body.description !== undefined) run('UPDATE roles SET description = ? WHERE id = ?', clean(req.body.description, 200), r.id);
  if (req.body.perms) run('UPDATE roles SET perms = ? WHERE id = ?', JSON.stringify(perms.cleanPerms(req.body.perms)), r.id);
  perms.clearRoleCache(); io.emit('team');
  return { ok: true };
}));
app.delete('/api/roles/:id', need('team', 'edit'), h((req) => {
  const r = get('SELECT * FROM roles WHERE id = ?', req.params.id);
  if (!r) fail(404, 'Role not found');
  if (r.system) fail(400, 'Built-in roles can be renamed or changed, not deleted');
  if (get('SELECT id FROM users WHERE role_id = ?', r.id)) fail(400, 'Move the people in this role to another role first');
  run('DELETE FROM roles WHERE id = ?', r.id);
  perms.clearRoleCache();
  return { ok: true };
}));

// ---------- notifications ----------
app.get('/api/notifications', h((req) => ({
  notifications: all('SELECT * FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 60', req.user.id),
  unread: get('SELECT COUNT(*) n FROM notifications WHERE user_id = ? AND read = 0', req.user.id).n,
})));
app.post('/api/notifications/read', h((req) => {
  if (Array.isArray(req.body.ids)) for (const id of req.body.ids) run('UPDATE notifications SET read = 1 WHERE id = ? AND user_id = ?', Number(id), req.user.id);
  else run('UPDATE notifications SET read = 1 WHERE user_id = ?', req.user.id);
  return { ok: true };
}));

// ---------- uploads (site photos, drawings, receipts, product images, signatures) ----------
const UPLOAD_DIR = path.resolve(dataDir, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
const MAX_FILE = 50 * 1024 * 1024;
ctx.UPLOAD_DIR = UPLOAD_DIR;
// Streams the request body to disk; resolves { token, name, mime, size }
function receiveUpload(req, { max = MAX_FILE, types } = {}) {
  return new Promise((resolve, reject) => {
    const size = Number(req.headers['content-length']) || 0;
    if (size > max) return reject(new HttpError(413, `Files can be up to ${Math.round(max / 1048576)} MB`));
    const name = clean(decodeURIComponent(String(req.headers['x-file-name'] || 'file')), 200).replace(/[\\/]/g, '-') || 'file';
    const mime = clean(String(req.headers['x-file-type'] || 'application/octet-stream'), 120) || 'application/octet-stream';
    if (types && !types.test(mime)) return reject(new HttpError(400, 'That type of file is not allowed here'));
    const tok = crypto.randomBytes(16).toString('hex');
    const dest = path.join(UPLOAD_DIR, tok);
    const out = fs.createWriteStream(dest);
    let bytes = 0;
    let failed = false;
    req.on('data', (chunk) => {
      bytes += chunk.length;
      if (bytes > max && !failed) { failed = true; req.unpipe(out); out.destroy(); fs.rm(dest, () => {}); reject(new HttpError(413, 'File is too big')); }
    });
    req.pipe(out);
    out.on('finish', () => { if (!failed) resolve({ token: tok, name, mime, size: bytes }); });
    out.on('error', () => reject(new HttpError(500, 'Could not save the file')));
  });
}
ctx.receiveUpload = receiveUpload;
function sendStored(res, token, mime, name, { download = false, cache = 'private, max-age=86400' } = {}) {
  const inline = !download && /^(image\/(png|jpe?g|gif|webp|avif|heic)|video\/(mp4|webm|quicktime)|audio\/|application\/pdf)/.test(mime);
  res.set({
    'Content-Type': inline ? mime : 'application/octet-stream',
    'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(name)}`,
    'Cache-Control': cache, 'X-Content-Type-Options': 'nosniff',
  });
  res.sendFile(path.join(UPLOAD_DIR, token), (err) => { if (err && !res.headersSent) res.status(404).end(); });
}
ctx.sendStored = sendStored;
function removeStored(token) { try { fs.unlinkSync(path.join(UPLOAD_DIR, token)); } catch {} }
ctx.removeStored = removeStored;

// Who may see / add files on each kind of record (filled in by the modules)
const fileAccess = {};
ctx.fileAccess = fileAccess;
function checkFileAccess(user, entity, id, write) {
  const fn = fileAccess[entity];
  if (!fn || !fn(user, Number(id), write)) fail(404, 'Not found');
}
app.post('/api/files', ha(async (req) => {
  const entity = String(req.query.entity || '');
  const id = Number(req.query.id);
  checkFileAccess(req.user, entity, id, true);
  const kind = clean(String(req.query.kind || 'other'), 30) || 'other';
  const f = await receiveUpload(req, entity === 'product' || kind === 'signature' ? { max: 10 * 1048576, types: /^image\// } : {});
  const r = run('INSERT INTO files (token, entity, entity_id, kind, name, mime, size, user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    f.token, entity, id, kind, f.name, f.mime, f.size, req.user.id);
  const file = get('SELECT id, entity, entity_id, kind, name, mime, size, user_id, created_at FROM files WHERE id = ?', r.lastInsertRowid);
  if (['deal', 'job', 'lead', 'contact'].includes(entity)) timeline(entity, id, req.user.id, 'document', `Added ${kind.replace(/_/g, ' ')}: ${f.name}`, { file_id: file.id });
  emitTo(all('SELECT id FROM users WHERE active = 1').map((u) => u.id), 'files', { entity, id });
  return { file };
}));
app.get('/api/files', h((req) => {
  const entity = String(req.query.entity || '');
  const id = Number(req.query.id);
  checkFileAccess(req.user, entity, id, false);
  return { files: all('SELECT id, entity, entity_id, kind, name, mime, size, user_id, created_at FROM files WHERE entity = ? AND entity_id = ? ORDER BY id DESC', entity, id) };
}));
app.get('/api/files/:id', h((req, res) => {
  const f = get('SELECT * FROM files WHERE id = ?', req.params.id);
  if (!f) fail(404, 'File not found');
  if (f.entity !== 'product' && f.entity !== 'company') checkFileAccess(req.user, f.entity, f.entity_id, false);
  sendStored(res, f.token, f.mime, f.name, { download: !!req.query.download });
}));
app.patch('/api/files/:id', h((req) => {
  const f = get('SELECT * FROM files WHERE id = ?', req.params.id);
  if (!f) fail(404, 'File not found');
  checkFileAccess(req.user, f.entity, f.entity_id, true);
  if (req.body.kind) run('UPDATE files SET kind = ? WHERE id = ?', clean(req.body.kind, 30), f.id);
  if (req.body.name) run('UPDATE files SET name = ? WHERE id = ?', clean(req.body.name, 200), f.id);
  return { ok: true };
}));
app.delete('/api/files/:id', h((req) => {
  const f = get('SELECT * FROM files WHERE id = ?', req.params.id);
  if (!f) fail(404, 'File not found');
  checkFileAccess(req.user, f.entity, f.entity_id, true);
  if (f.user_id !== req.user.id && !isAdmin(req.user) && scope(req.user, 'crm') !== 'all') fail(403, 'Only the person who added it or a manager can remove it');
  removeStored(f.token);
  run('DELETE FROM files WHERE id = ?', f.id);
  return { ok: true };
}));

// ---------- profile photos ----------
async function saveAvatar(req, userId) {
  const f = await receiveUpload(req, { max: 3 * 1048576, types: /^image\/(jpeg|png|webp)$/ });
  const old = get('SELECT avatar FROM users WHERE id = ?', userId)?.avatar;
  run('UPDATE users SET avatar = ?, avatar_v = avatar_v + 1 WHERE id = ?', `${f.token}:${f.mime}`, userId);
  if (old) removeStored(old.split(':')[0]);
  io.emit('team');
  return { user: publicUser(get('SELECT * FROM users WHERE id = ?', userId)) };
}
app.post('/api/me/avatar', ha((req) => saveAvatar(req, req.user.id)));
app.post('/api/users/:id/avatar', need('team', 'edit'), ha((req) => saveAvatar(req, Number(req.params.id))));
app.get('/api/avatars/:id', (req, res) => {
  const a = get('SELECT avatar FROM users WHERE id = ?', req.params.id)?.avatar;
  if (!a) return res.status(404).end();
  const [tok, mime] = a.split(':');
  sendStored(res, tok, mime || 'image/jpeg', 'avatar', { cache: 'private, max-age=31536000, immutable' });
});

// ---------- business modules ----------
require('./settings').register(ctx);
require('./accounting').register(ctx);
require('./crm').register(ctx);
require('./catalog').register(ctx);
require('./sales').register(ctx);
require('./purchasing').register(ctx);
require('./expenses').register(ctx);
require('./jobs').register(ctx);
require('./reports').register(ctx);
require('./chat').register(ctx);
require('./attendance').register(ctx);
require('./search').register(ctx);
alerts.register(app, { h, ha, requirePerm: (p) => need(p === 'manage_settings' ? 'settings' : p, 'edit'), fail, clean, publicUser });
require('./backup').register(ctx);
require('./scheduler').start(ctx);

app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

// ---------- static frontend ----------
const nm = path.join(__dirname, '..', 'node_modules');
{
  const fast = require('./fast');
  const pub = path.join(__dirname, '..', 'public');
  const vendor = [['/vendor/preact', path.join(nm, 'preact', 'dist')], ['/vendor/hooks', path.join(nm, 'preact', 'hooks', 'dist')],
    ['/vendor/htm', path.join(nm, 'htm', 'dist')], ['/vendor/socket.io', path.join(nm, 'socket.io', 'client-dist')]];
  app.use(fast.compressedStatic([
    ...vendor.map(([prefix, dir]) => ({ prefix, dir, cache: 'public, max-age=86400' })),
    { prefix: '/', dir: pub, cache: 'no-cache' },
  ], { preload: ['/vendor/preact/preact.mjs', '/vendor/hooks/hooks.mjs', '/vendor/htm/htm.mjs', '/vendor/socket.io/socket.io.esm.min.js', ...fast.listJs(path.join(pub, 'js'), '/js')] }));
}
app.get('/sw.js', (req, res) => { res.set({ 'Cache-Control': 'no-cache', 'Service-Worker-Allowed': '/' }); res.sendFile(path.join(__dirname, '..', 'public', 'sw.js')); });
app.use(express.static(path.join(__dirname, '..', 'public'), {
  extensions: ['html'],
  setHeaders: (res, file) => { if (/\.(js|css|html)$/.test(file)) res.setHeader('Cache-Control', 'no-cache'); },
}));

// ---------- live connections ----------
io.use((socket, next) => {
  const user = auth.userFromCookieHeader(socket.handshake.headers.cookie);
  if (!user) return next(new Error('unauthorized'));
  socket.user = user;
  next();
});
io.on('connection', (socket) => {
  const uid = socket.user.id;
  socket.join(`u:${uid}`);
  online.set(uid, (online.get(uid) || 0) + 1);
  io.emit('presence', { id: uid, online: true });
  socket.on('typing', (channel) => {
    try {
      const members = require('./chat').channelMembers(socket.user, String(channel));
      emitTo(members.filter((id) => id !== uid), 'typing', { channel, user_id: uid });
    } catch { /* ignore bad channels */ }
  });
  socket.on('disconnect', () => {
    const n = (online.get(uid) || 1) - 1;
    online.set(uid, n);
    if (n <= 0) {
      run(`UPDATE users SET last_seen = datetime('now') WHERE id = ?`, uid);
      io.emit('presence', { id: uid, online: false });
    }
  });
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`[hub] Port ${PORT} is already in use — Crystal Shield Hub is probably already running: open http://localhost:${PORT}\n      (or stop the other copy: lsof -ti tcp:${PORT} | xargs kill)`);
    process.exit(1);
  }
  throw err;
});
server.listen(PORT, () => console.log(`[hub] Crystal Shield Hub running on http://localhost:${PORT}`));
module.exports = { app, ctx };
