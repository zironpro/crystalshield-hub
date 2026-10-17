// Company profile, document defaults, drop-down lists, automations, numbering, email.
const { get, run } = require('./db');
const U = require('./util');

const COMPANY_DEFAULTS = {
  name: 'Crystal Shield',
  legal_name: 'Crystal Shield Tint Insulation LLC',
  tagline: 'Architectural Film Solutions',
  partner_line: 'Authorized Madico Partner · ISO Certified',
  trn: '',
  license_no: '',
  address: 'Abu Dhabi, United Arab Emirates',
  phone: '+971 50 385 8785',
  email: 'enquiry@crystalshield.ae',
  website: 'www.crystalshield.ae',
  bank_name: '',
  bank_account_name: 'Crystal Shield Tint Insulation LLC',
  bank_account_no: '',
  bank_iban: '',
  bank_swift: '',
  stamp_note: 'This is a computer-generated document.',
};
const DOC_DEFAULTS = {
  quote_intro: 'We are pleased to submit our quotation for the supply and installation of window films as per the specifications below.',
  quote_remarks: 'Supply and installation by certified technicians.\nGlass cleaning and edge sealing included.\nPayment terms as per agreement.',
  quote_terms: '50% advance on confirmation, balance on completion of installation.\nAccess to the glass, power and parking to be provided by the client.\nAny additional glass found on site will be charged at the same rate per SQM.\nWarranty as per manufacturer terms, from the date of installation.',
  quote_valid_days: 15,
  invoice_terms: 'Please pay by bank transfer and quote the invoice number as reference.',
  invoice_due_days: 7,
  vat_rate: 5,
  wastage_pct: 10,
  stock_mode: 'job',      // job = film is deducted when the installation is completed | invoice = when the invoice is issued
  advance_pct: 50,
  currency: 'AED',
  default_unit: 'cm',
};
const LIST_DEFAULTS = {
  sources: ['Website', 'Meta Ads', 'Google Ads', 'WhatsApp', 'Instagram', 'Facebook', 'TikTok', 'LinkedIn', 'Referral', 'Existing customer', 'Walk-in', 'Phone call', 'Other'],
  property_types: ['Villa', 'Apartment', 'Office', 'Retail / shop', 'Restaurant / café', 'Hotel', 'Hospital / clinic', 'School', 'Government', 'Commercial tower', 'Warehouse / industrial', 'Showroom', 'Other'],
  services: ['Solar control film', 'Safety & security film', 'Blast mitigation film', 'Surface protection film', 'Privacy / frosted film', 'Decorative film', 'Old film removal', 'Other'],
  tags: ['Residential', 'Commercial', 'Government', 'Repeat client', 'VIP', 'Contractor', 'Consultant'],
  lost_reasons: ['Price too high', 'Went with a competitor', 'No response', 'Project cancelled', 'Outside service area', 'Not a fit'],
  cities: ['Abu Dhabi', 'Dubai', 'Sharjah', 'Al Ain', 'Ajman', 'Ras Al Khaimah', 'Fujairah', 'Umm Al Quwain'],
  job_checklist: ['Glass cleaned and prepared', 'Film applied without bubbles or dust', 'Edges trimmed and sealed', 'Site cleaned, waste removed', 'Customer walk-through done'],
};
const AUTOMATION_DEFAULTS = {
  review_on: true, review_days: 2,                // ask for a Google review after sign-off
  checkin_on: true, checkin_days: 30,             // "how is the film?" call
  inspection_on: true, inspection_months: 6,      // free inspection visit
  warranty_on: true, warranty_days: 30,           // warn before warranty ends
  quote_on: true, quote_days: 3,                  // chase a sent quotation
  payment_on: true,                               // chase overdue invoices
  review_link: '',
  lead_assign: 'round_robin',                     // round_robin | none — who gets website/ad/WhatsApp leads
  lead_assign_ids: '',                            // comma list of user ids in the rotation (empty = all sales roles)
};

const company = () => ({ ...COMPANY_DEFAULTS, ...U.settingJSON('company', {}) });
const docs = () => ({ ...DOC_DEFAULTS, ...U.settingJSON('docs', {}) });
const lists = () => ({ ...LIST_DEFAULTS, ...U.settingJSON('lists', {}) });
const automation = () => ({ ...AUTOMATION_DEFAULTS, ...U.settingJSON('automation', {}) });
function logoFile() {
  const id = Number(U.setting('logo_file_id'));
  return id ? get('SELECT * FROM files WHERE id = ? AND entity = ?', id, 'company') : null;
}
function leadKey() {
  let k = U.setting('lead_webhook_key');
  if (!k) { k = U.token(18); U.setSetting('lead_webhook_key', k); }
  return k;
}

function pick(src, defaults, clean) {
  const out = {};
  for (const [k, def] of Object.entries(defaults)) {
    if (src[k] === undefined) continue;
    if (typeof def === 'number') out[k] = Number(src[k]) || 0;
    else if (typeof def === 'boolean') out[k] = !!src[k];
    else if (Array.isArray(def)) out[k] = (Array.isArray(src[k]) ? src[k] : String(src[k]).split('\n')).map((x) => clean(String(x), 80)).filter(Boolean).slice(0, 60);
    else out[k] = clean(String(src[k]), 3000);
  }
  return out;
}

function register(ctx) {
  const { app, h, ha, need, clean, fail, can, mail, receiveUpload, removeStored, sendStored } = ctx;

  app.get('/api/settings', h((req) => {
    const out = {
      company: company(), docs: docs(), lists: lists(), automation: automation(),
      logo: logoFile() ? `/api/company/logo?v=${logoFile().id}` : null,
    };
    if (can(req.user, 'settings')) {
      const base = (process.env.APP_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
      out.lead_webhook = { key: leadKey(), url: `${base}/api/public/leads?key=${leadKey()}` };
      out.meta = { verify_token: U.setting('meta_verify_token') || '', has_page_token: !!U.setting('meta_page_token'), webhook_url: `${base}/api/public/meta` };
      out.wa_inbound = { verify_token: U.setting('wa_verify_token') || '', webhook_url: `${base}/api/public/whatsapp` };
      out.numbering = Object.fromEntries(Object.entries(U.NUMBERING).map(([k, n]) => [k, {
        prefix: U.setting(`prefix_${k}`) ?? n.prefix, next: Number(U.setting(`seq_${k}`, n.start - 1)) + 1,
      }]));
    }
    return out;
  }));

  app.patch('/api/settings', need('settings', 'edit'), h((req) => {
    const b = req.body;
    if (b.company) U.setSetting('company', JSON.stringify({ ...U.settingJSON('company', {}), ...pick(b.company, COMPANY_DEFAULTS, clean) }));
    if (b.docs) {
      const d = pick(b.docs, DOC_DEFAULTS, clean);
      if (d.stock_mode && !['job', 'invoice'].includes(d.stock_mode)) delete d.stock_mode;
      U.setSetting('docs', JSON.stringify({ ...U.settingJSON('docs', {}), ...d }));
    }
    if (b.lists) U.setSetting('lists', JSON.stringify({ ...U.settingJSON('lists', {}), ...pick(b.lists, LIST_DEFAULTS, clean) }));
    if (b.automation) U.setSetting('automation', JSON.stringify({ ...U.settingJSON('automation', {}), ...pick(b.automation, AUTOMATION_DEFAULTS, clean) }));
    if (b.numbering) {
      for (const [k, v] of Object.entries(b.numbering)) {
        if (!U.NUMBERING[k] || !v) continue;
        if (v.prefix !== undefined) U.setSetting(`prefix_${k}`, clean(v.prefix, 20));
        if (v.next !== undefined && Number(v.next) > 0) U.setSetting(`seq_${k}`, Math.floor(Number(v.next)) - 1);
      }
    }
    if (b.meta) {
      if (b.meta.verify_token !== undefined) U.setSetting('meta_verify_token', clean(b.meta.verify_token, 100));
      if (b.meta.page_token) U.setSetting('meta_page_token', clean(b.meta.page_token, 1000));
    }
    if (b.wa_inbound?.verify_token !== undefined) U.setSetting('wa_verify_token', clean(b.wa_inbound.verify_token, 100));
    ctx.io.emit('settings');
    return { ok: true };
  }));

  app.post('/api/settings/lead-key', need('settings', 'edit'), h(() => {
    U.setSetting('lead_webhook_key', U.token(18));
    return { key: leadKey() };
  }));

  app.post('/api/settings/logo', need('settings', 'edit'), ha(async (req) => {
    const f = await receiveUpload(req, { max: 5 * 1048576, types: /^image\/(png|jpeg|webp|svg\+xml)$/ });
    const old = logoFile();
    const r = run('INSERT INTO files (token, entity, entity_id, kind, name, mime, size, user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      f.token, 'company', 0, 'logo', f.name, f.mime, f.size, req.user.id);
    U.setSetting('logo_file_id', Number(r.lastInsertRowid));
    if (old) { removeStored(old.token); run('DELETE FROM files WHERE id = ?', old.id); }
    ctx.io.emit('settings');
    return { logo: `/api/company/logo?v=${r.lastInsertRowid}` };
  }));
  app.delete('/api/settings/logo', need('settings', 'edit'), h(() => {
    const old = logoFile();
    if (old) { removeStored(old.token); run('DELETE FROM files WHERE id = ?', old.id); }
    U.setSetting('logo_file_id', null);
    return { ok: true };
  }));

  // Email (company mailbox) — used for notifications and for sending quotations / invoices
  app.get('/api/email/settings', need('settings'), h(() => mail.publicConfig()));
  app.patch('/api/email/settings', need('settings', 'edit'), h((req) => {
    const b = req.body;
    mail.saveConfig({ host: b.host, port: b.port, user: b.user, from: b.from, pass: b.pass, enabled: b.enabled });
    return mail.publicConfig();
  }));
  app.post('/api/email/test', need('settings', 'edit'), ha(async (req) => {
    try { await mail.sendMail(req.user.email, 'Test email', 'Email from Crystal Shield Hub is working.', '', { throwErrors: true }); }
    catch (err) { fail(400, `Email: ${err.message}`); }
    return { ok: true, to: req.user.email };
  }));
}

// Public: the logo is shown on customer documents and the sign-in page
function registerPublicLogo(app, sendStored) {
  app.get('/api/company/logo', (req, res) => {
    const f = logoFile();
    if (!f) return res.redirect('/img/logo-dark.png');
    sendStored(res, f.token, f.mime, f.name, { cache: 'public, max-age=86400' });
  });
}

module.exports = { register, registerPublicLogo, company, docs, lists, automation, logoFile, leadKey };
