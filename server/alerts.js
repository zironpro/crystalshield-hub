// Extra alert channels for notifications: phone push (installed app / browser) and WhatsApp
// (WhatsApp Business Cloud API with an approved message template).
const webpush = require('web-push');
const { all, get, run } = require('./db');

const setting = (k) => get('SELECT value FROM settings WHERE key = ?', k)?.value || null;
const setSetting = (k, v) => (v === null
  ? run('DELETE FROM settings WHERE key = ?', k)
  : run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', k, String(v)));

// VAPID keys are created once and kept in the database
let vapid = null;
function vapidKeys() {
  if (vapid) return vapid;
  let pub = setting('vapid_public');
  let priv = setting('vapid_private');
  if (!pub || !priv) {
    const k = webpush.generateVAPIDKeys();
    pub = k.publicKey; priv = k.privateKey;
    setSetting('vapid_public', pub); setSetting('vapid_private', priv);
  }
  const contact = process.env.SMTP_FROM?.match(/<(.+)>/)?.[1] || 'admin@crystalshield.ae';
  webpush.setVapidDetails(`mailto:${contact}`, pub, priv);
  vapid = { pub, priv };
  return vapid;
}

// Which notification types go to WhatsApp (the important ones only)
const WA_TYPES = ['urgent', 'lead', 'assigned', 'job', 'quote', 'payment', 'followup', 'activity', 'leave', 'stock', 'claim'];

async function sendPush(userId, n) {
  vapidKeys();
  const subs = all('SELECT * FROM push_subscriptions WHERE user_id = ?', userId);
  const unread = get('SELECT COUNT(*) n FROM notifications WHERE user_id = ? AND read = 0', userId)?.n || 0;
  const payload = JSON.stringify({ title: n.title, body: n.body || '', link: n.link || '', id: n.id, type: n.type, unread });
  for (const s of subs) {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: JSON.parse(s.keys) }, payload, { TTL: 60 * 60 * 24 });
    } catch (err) {
      if (err.statusCode === 404 || err.statusCode === 410) run('DELETE FROM push_subscriptions WHERE id = ?', s.id); // phone uninstalled / expired
      else console.error('[push]', err.statusCode || '', err.message);
    }
  }
}

function waConfig() {
  return {
    phone_id: setting('wa_phone_id') || '', token: setting('wa_token') || '',
    template: setting('wa_template') || 'hub_alert', lang: setting('wa_lang') || 'en',
    enabled: setting('wa_enabled') === '1',
  };
}
async function sendWhatsApp(to, title, body) {
  const c = waConfig();
  if (!c.enabled || !c.phone_id || !c.token) throw Object.assign(new Error('WhatsApp is not set up'), { status: 400 });
  const number = String(to || '').replace(/[^\d]/g, '');
  if (number.length < 8) throw Object.assign(new Error('Add the WhatsApp number with country code (e.g. 971501234567)'), { status: 400 });
  const res = await fetch(`https://graph.facebook.com/v20.0/${encodeURIComponent(c.phone_id)}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${c.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp', to: number, type: 'template',
      template: {
        name: c.template, language: { code: c.lang },
        components: [{ type: 'body', parameters: [{ type: 'text', text: title.slice(0, 200) }, { type: 'text', text: (body || '—').slice(0, 900) }] }],
      },
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error?.message || `WhatsApp error ${res.status}`), { status: 400 });
  return data;
}

// Called for every notification the hub creates
function deliver(userId, n, { online }) {
  sendPush(userId, n).catch((e) => console.error('[push]', e.message));
  if (online || !WA_TYPES.includes(n.type)) return; // WhatsApp only when they're not in the hub
  const u = get('SELECT whatsapp, whatsapp_alerts, active FROM users WHERE id = ?', userId);
  if (!u?.active || !u.whatsapp || !u.whatsapp_alerts || !waConfig().enabled) return;
  const appUrl = (process.env.APP_URL || '').replace(/\/$/, '');
  sendWhatsApp(u.whatsapp, n.title, `${n.body || ''}${appUrl ? `\n${appUrl}/#/${(n.link || '').replace(/^#?\/?/, '')}` : ''}`)
    .catch((e) => console.error('[whatsapp]', e.message));
}

function register(app, { h, ha, requirePerm, fail, clean, publicUser }) {
  app.get('/api/push/key', h(() => ({ key: vapidKeys().pub })));
  app.post('/api/push/subscribe', h((req) => {
    const s = req.body?.subscription;
    if (!s?.endpoint || !s?.keys?.p256dh || !s?.keys?.auth) fail(400, 'Bad subscription');
    run(`INSERT INTO push_subscriptions (user_id, endpoint, keys, device) VALUES (?, ?, ?, ?)
         ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, keys = excluded.keys`,
      req.user.id, s.endpoint, JSON.stringify(s.keys), clean(req.body.device, 120));
    return { ok: true, devices: get('SELECT COUNT(*) n FROM push_subscriptions WHERE user_id = ?', req.user.id).n };
  }));
  app.post('/api/push/unsubscribe', h((req) => {
    run('DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?', req.user.id, String(req.body?.endpoint || ''));
    return { ok: true };
  }));
  app.post('/api/push/test', ha(async (req) => {
    if (!get('SELECT id FROM push_subscriptions WHERE user_id = ?', req.user.id)) fail(400, 'Turn on phone notifications on this device first');
    await sendPush(req.user.id, { title: '🔔 Test from Crystal Shield Hub', body: 'Phone notifications are working.', link: '' });
    return { ok: true };
  }));
  app.get('/api/push/devices', h((req) => ({ devices: get('SELECT COUNT(*) n FROM push_subscriptions WHERE user_id = ?', req.user.id).n })));

  // Personal WhatsApp number
  app.patch('/api/me/whatsapp', h((req) => {
    const number = clean(req.body.whatsapp, 30);
    if (number && number.replace(/[^\d]/g, '').length < 8) fail(400, 'Use the full number with country code, e.g. +971 50 123 4567');
    run('UPDATE users SET whatsapp = ?, whatsapp_alerts = ? WHERE id = ?', number || null, req.body.whatsapp_alerts === false ? 0 : 1, req.user.id);
    return { user: publicUser(get('SELECT * FROM users WHERE id = ?', req.user.id)) };
  }));

  // Company WhatsApp Business settings
  app.get('/api/whatsapp/settings', requirePerm('manage_settings'), h(() => {
    const c = waConfig();
    return { ...c, token: '', has_token: !!c.token };
  }));
  app.patch('/api/whatsapp/settings', requirePerm('manage_settings'), h((req) => {
    const b = req.body;
    if (b.phone_id !== undefined) setSetting('wa_phone_id', clean(b.phone_id, 60));
    if (b.token) setSetting('wa_token', clean(b.token, 1000));
    if (b.template !== undefined) setSetting('wa_template', clean(b.template, 120) || 'hub_alert');
    if (b.lang !== undefined) setSetting('wa_lang', clean(b.lang, 10) || 'en');
    if (b.enabled !== undefined) setSetting('wa_enabled', b.enabled ? '1' : '0');
    const c = waConfig();
    return { ...c, token: '', has_token: !!c.token };
  }));
  app.post('/api/whatsapp/test', requirePerm('manage_settings'), ha(async (req) => {
    const to = clean(req.body.to, 30) || get('SELECT whatsapp FROM users WHERE id = ?', req.user.id)?.whatsapp;
    try { await sendWhatsApp(to, 'Test from Crystal Shield Hub', 'WhatsApp alerts are working ✅'); }
    catch (err) { fail(400, `WhatsApp: ${err.message}`); }
    return { ok: true, to };
  }));
}

module.exports = { register, deliver, sendWhatsApp, waConfig };
