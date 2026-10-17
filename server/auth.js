const crypto = require('node:crypto');
const { get, run } = require('./db');

const COOKIE = 'cs_session';
const SESSION_DAYS = 90; // and renewed while in use, so people who use the hub stay signed in

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = String(stored).split(':');
  if (!salt || !hash) return false;
  const test = crypto.scryptSync(password, salt, 64);
  return crypto.timingSafeEqual(test, Buffer.from(hash, 'hex'));
}

function createSession(userId, remember = true) {
  const token = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + (remember ? SESSION_DAYS * 864e5 : 12 * 3600e3)).toISOString();
  run('INSERT INTO sessions (token, user_id, expires_at, remember) VALUES (?, ?, ?, ?)', token, userId, expires, remember ? 1 : 0);
  return token;
}

function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function userFromCookieHeader(header) {
  const token = parseCookies(header)[COOKIE];
  if (!token) return null;
  const row = get(
    `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token = ? AND s.expires_at > ? AND u.active = 1`,
    token, new Date().toISOString()
  );
  return row || null;
}

function setSessionCookie(res, token, secure, remember = true) {
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure,
    ...(remember ? { maxAge: SESSION_DAYS * 864e5 } : {}), // not remembered = ends when the browser closes
    path: '/',
  });
}

// Keep active people signed in: push the expiry out again (at most once a day per session)
function renewSession(req, res) {
  const token = parseCookies(req.headers.cookie)[COOKIE];
  if (!token) return;
  const row = get('SELECT expires_at, remember FROM sessions WHERE token = ?', token);
  if (!row || !row.remember || Date.parse(row.expires_at) - Date.now() > (SESSION_DAYS - 1) * 864e5) return;
  run('UPDATE sessions SET expires_at = ? WHERE token = ?', new Date(Date.now() + SESSION_DAYS * 864e5).toISOString(), token);
  setSessionCookie(res, token, req.secure);
}

function destroySession(req, res) {
  const token = parseCookies(req.headers.cookie)[COOKIE];
  if (token) run('DELETE FROM sessions WHERE token = ?', token);
  res.clearCookie(COOKIE, { path: '/' });
}

module.exports = {
  hashPassword, verifyPassword, createSession, userFromCookieHeader, setSessionCookie, destroySession, renewSession,
};
