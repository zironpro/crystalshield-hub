// Email through the company mailbox (quotations, invoices, notifications).
// Configured under Settings → Email in the hub; SMTP_* environment variables still work as a fallback.
const nodemailer = require('nodemailer');
const { get, run } = require('./db');

const setting = (k) => get('SELECT value FROM settings WHERE key = ?', `smtp_${k}`)?.value ?? null;
function config() {
  const host = setting('host') ?? process.env.SMTP_HOST ?? '';
  const port = Number(setting('port') ?? process.env.SMTP_PORT ?? 465);
  return {
    host, port,
    user: setting('user') ?? process.env.SMTP_USER ?? '',
    pass: setting('pass') ?? process.env.SMTP_PASS ?? '',
    from: setting('from') ?? process.env.SMTP_FROM ?? '',
    enabled: !!host && setting('enabled') !== '0',
  };
}
function saveConfig(c) {
  for (const k of ['host', 'port', 'user', 'from']) if (c[k] !== undefined) run(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', `smtp_${k}`, String(c[k]).trim()
  );
  if (c.pass) run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', 'smtp_pass', c.pass);
  if (c.enabled !== undefined) run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', 'smtp_enabled', c.enabled ? '1' : '0');
  transport = null;
}
function publicConfig() {
  const c = config();
  return { host: c.host, port: c.port, user: c.user, from: c.from, enabled: c.enabled, has_password: !!c.pass };
}

let transport = null;
let transportKey = '';
function getTransport() {
  const c = config();
  if (!c.enabled) return null;
  const key = JSON.stringify(c);
  if (!transport || key !== transportKey) {
    transport = nodemailer.createTransport({
      host: c.host, port: c.port, secure: c.port === 465,
      auth: c.user ? { user: c.user, pass: c.pass } : undefined,
    });
    transportKey = key;
  }
  return transport;
}

const appUrl = () => (process.env.APP_URL || 'http://localhost:4100').replace(/\/$/, '');

async function sendMail(to, subject, text, link, { throwErrors = false } = {}) {
  const t = getTransport();
  if (!t) { if (throwErrors) throw new Error('Email is not set up yet'); return; }
  const c = config();
  const url = link ? `${appUrl()}/${String(link).replace(/^#?\/?/, '#/')}` : appUrl();
  try {
    await t.sendMail({
      from: c.from || c.user,
      to,
      subject: `[Crystal Shield] ${subject}`,
      text: `${text}\n\nOpen in Crystal Shield Hub: ${url}`,
      html: `<div style="font-family:Inter,Arial,sans-serif;font-size:15px;color:#141c2f;max-width:520px">
        <p style="margin:0 0 6px;font-weight:600">${escapeHtml(subject)}</p>
        <p style="margin:0 0 18px;color:#5a6275;white-space:pre-wrap">${escapeHtml(text)}</p>
        <a href="${url}" style="background:#00386b;color:#fff;padding:10px 18px;border-radius:10px;text-decoration:none;display:inline-block">Open in Crystal Shield Hub</a>
        <p style="margin:22px 0 0;color:#8a91a3;font-size:12px">You get these because email notifications are on in your Crystal Shield Hub profile.</p>
      </div>`,
    });
  } catch (err) {
    console.error('[mail] failed:', err.message);
    if (throwErrors) throw err;
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
}

// Customer-facing email (quotation / invoice / receipt link) — no "open the hub" button
async function sendDocument({ to, subject, text, html, replyTo }) {
  const t = getTransport();
  if (!t) throw Object.assign(new Error('Email is not set up yet (Settings → Email)'), { status: 400 });
  const c = config();
  await t.sendMail({ from: c.from || c.user, to, subject, text, html, replyTo: replyTo || undefined });
}

module.exports = { sendMail, sendDocument, config, saveConfig, publicConfig, escapeHtml };
