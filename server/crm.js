// CRM: leads (every enquiry with its source), contacts (customers with tags), deals (qualified leads moving
// through the pipeline), measurements (estimation form), the deal's pricing sheet, calendar activities,
// and the public webhooks that bring in leads from the website, Meta lead ads and WhatsApp.
const { all, get, run, tx } = require('./db');
const U = require('./util');
const S = require('./settings');
const { can, scope } = require('./perms');

const LEAD_STATUSES = ['new', 'contacted', 'qualified', 'unqualified', 'converted'];
const STAGES = ['new', 'site_visit', 'measured', 'quoted', 'negotiation', 'won', 'lost'];
const STAGE_LABEL = { new: 'New', site_visit: 'Site visit', measured: 'Measured', quoted: 'Quotation sent', negotiation: 'Negotiation', won: 'Won', lost: 'Lost' };
const ACTIVITY_TYPES = ['call', 'meeting', 'site_visit', 'measurement', 'follow_up', 'task', 'payment_follow_up'];
const ACTIVITY_LABEL = { call: 'Call', meeting: 'Meeting', site_visit: 'Site visit', measurement: 'Measurement', follow_up: 'Follow-up', task: 'Task', payment_follow_up: 'Payment follow-up' };
const NOTE_KINDS = ['note', 'call', 'whatsapp', 'email', 'meeting', 'site_visit'];

// ---------- phone numbers: compare UAE numbers in any format (050…, +971 50…, 00971…) ----------
function normPhone(p) {
  let d = String(p || '').replace(/[^\d]/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  if (d.length === 10 && d.startsWith('0')) d = '971' + d.slice(1);
  if (d.length === 9 && d.startsWith('5')) d = '971' + d;
  return d;
}
const phoneKey = (p) => normPhone(p).slice(-9);

// ---------- access ----------
const owns = (u, r) => r && (r.owner_id === u.id || r.created_by === u.id);
function canSeeLead(u, l) { const s = scope(u, 'crm'); return !!l && (s === 'all' || (s === 'own' && owns(u, l))); }
function canSeeDeal(u, d) { const s = scope(u, 'crm'); return !!d && (s === 'all' || (s === 'own' && owns(u, d))); }
function canSeeContact(u, c) {
  const s = scope(u, 'crm');
  if (!c) return false;
  if (s === 'all') return true;
  if (s !== 'own') return false;
  return owns(u, c) || !!get('SELECT 1 FROM deals WHERE contact_id = ? AND (owner_id = ? OR created_by = ?) UNION SELECT 1 FROM leads WHERE contact_id = ? AND (owner_id = ? OR created_by = ?)', c.id, u.id, u.id, c.id, u.id, u.id);
}
// SQL filter for lists ("own" scope)
const ownSql = (u, alias = '') => (scope(u, 'crm') === 'all' ? '1=1' : `(${alias}owner_id = ${Number(u.id)} OR ${alias}created_by = ${Number(u.id)})`);

// ---------- who gets new leads from the website / ads / WhatsApp ----------
function salesPool() {
  const a = S.automation();
  const ids = String(a.lead_assign_ids || '').split(',').map(Number).filter(Boolean);
  const users = all('SELECT * FROM users WHERE active = 1');
  const pool = ids.length ? users.filter((u) => ids.includes(u.id)) : users.filter((u) => can(u, 'crm', 'create') && !require('./perms').isAdmin(u));
  return pool.map((u) => u.id).sort((x, y) => x - y);
}
function nextOwner() {
  if (S.automation().lead_assign !== 'round_robin') return null;
  const pool = salesPool();
  if (!pool.length) return null;
  const last = Number(U.setting('rr_last') || 0);
  const next = pool.find((id) => id > last) || pool[0];
  U.setSetting('rr_last', next);
  return next;
}

function sourceFrom(b) {
  const given = String(b.source || '').trim();
  const known = S.lists().sources;
  const match = known.find((s) => s.toLowerCase() === given.toLowerCase());
  if (match) return match;
  const utm = `${b.utm_source || ''} ${b.utm_medium || ''} ${given}`.toLowerCase();
  if (/facebook|instagram|meta|fb|ig/.test(utm)) return /instagram|ig/.test(utm) && !/paid|cpc|ads/.test(utm) ? 'Instagram' : 'Meta Ads';
  if (/google|gclid|adwords|cpc/.test(utm) || b.gclid) return 'Google Ads';
  if (/whatsapp|wa\b/.test(utm)) return 'WhatsApp';
  if (/tiktok/.test(utm)) return 'TikTok';
  if (/linkedin/.test(utm)) return 'LinkedIn';
  return given || 'Website';
}

// Creates a lead (or adds the enquiry to an open lead with the same phone) — used by the forms and webhooks
function captureLead(ctx, b, { userId = null, via = 'website' } = {}) {
  const name = String(b.name || b.full_name || [b.first_name, b.last_name].filter(Boolean).join(' ') || '').trim().slice(0, 120) || 'Website visitor';
  const phone = String(b.phone || b.phone_number || b.mobile || b.whatsapp || '').trim().slice(0, 40);
  const email = String(b.email || '').trim().slice(0, 200);
  const message = String(b.message || b.details || b.notes || b.requirement || '').trim().slice(0, 3000);
  const source = sourceFrom(b);
  const key = phoneKey(phone);
  if (key.length >= 8) {
    const open = all(`SELECT * FROM leads WHERE status NOT IN ('converted','unqualified') ORDER BY id DESC LIMIT 400`).find((l) => phoneKey(l.phone) === key);
    if (open) {
      ctx.timeline('lead', open.id, null, 'system', `New enquiry again via ${source}${message ? `: ${message}` : ''}`);
      run(`UPDATE leads SET updated_at = datetime('now') WHERE id = ?`, open.id);
      ctx.notify([open.owner_id || 0, ...(open.owner_id ? [] : ctx.managers())], { type: 'lead', title: `🔁 ${open.name} enquired again (${source})`, body: message || phone, link: `leads/${open.id}` });
      ctx.broadcast('crm', 'leads');
      return { lead: open, duplicate: true };
    }
  }
  const contact = key.length >= 8 ? all('SELECT * FROM contacts ORDER BY id DESC LIMIT 2000').find((c) => phoneKey(c.phone) === key || phoneKey(c.whatsapp) === key) : null;
  const owner = Number(b.owner_id) || contact?.owner_id || nextOwner();
  const r = run(`INSERT INTO leads (code, name, company, phone, email, source, campaign, property_type, service, city, area, message, est_value, tags, owner_id, contact_id, raw, created_by, next_follow_up)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    U.nextNumber('lead'), name, String(b.company || '').slice(0, 120), phone, email, source, String(b.campaign || b.utm_campaign || b.ad_name || '').slice(0, 160),
    String(b.property_type || '').slice(0, 60), String(b.service || '').slice(0, 80), String(b.city || b.emirate || '').slice(0, 60), String(b.area || '').slice(0, 80),
    message, U.num(b.est_value), contact ? 'Repeat client' : String(b.tags || '').slice(0, 300), owner || null, contact?.id || null,
    via === 'manual' ? null : JSON.stringify(b).slice(0, 8000), userId, U.isDate(b.next_follow_up) ? b.next_follow_up : U.today());
  const lead = get('SELECT * FROM leads WHERE id = ?', r.lastInsertRowid);
  ctx.timeline('lead', lead.id, userId, 'system', via === 'manual' ? 'Lead created' : `New ${source} enquiry received${message ? `: ${message}` : ''}`);
  if (via !== 'manual') {
    ctx.notify(owner ? [owner] : ctx.managers(), { type: 'lead', title: `🆕 New lead: ${name} (${source})`, body: [phone, lead.service, message].filter(Boolean).join(' · '), link: `leads/${lead.id}` });
    if (owner) ctx.notify(ctx.managers().filter((id) => id !== owner), { type: 'lead', title: `New ${source} lead → ${get('SELECT name FROM users WHERE id = ?', owner)?.name}`, body: name, link: `leads/${lead.id}` });
  } else if (owner && owner !== userId) {
    ctx.notify([owner], { type: 'lead', title: `Lead assigned to you: ${name}`, body: [phone, lead.service].filter(Boolean).join(' · '), link: `leads/${lead.id}` });
  }
  ctx.broadcast('crm', 'leads');
  return { lead, duplicate: false };
}

function leadRow(l) {
  return { ...l, raw: undefined, owner_name: l.owner_id ? get('SELECT name FROM users WHERE id = ?', l.owner_id)?.name : null };
}

// ---------- deal money summary: quoted, invoiced, paid, costs, profit ----------
function dealSummary(dealId) {
  const items = all("SELECT * FROM deal_items WHERE deal_id = ? AND kind = 'item'", dealId);
  const itemsTotal = U.r2(items.reduce((s, i) => s + i.qty * i.price, 0));
  const itemsCost = U.r2(items.reduce((s, i) => s + i.qty * i.cost, 0));
  const sqm = U.r2(get('SELECT COALESCE(SUM(sqm), 0) s FROM measurements WHERE deal_id = ?', dealId).s);
  const q = get(`SELECT * FROM quotes WHERE deal_id = ? AND status = 'accepted' ORDER BY id DESC LIMIT 1`, dealId)
    || get(`SELECT * FROM quotes WHERE deal_id = ? AND status NOT IN ('rejected','expired') ORDER BY id DESC LIMIT 1`, dealId);
  const inv = get(`SELECT COALESCE(SUM(subtotal - discount), 0) net, COALESCE(SUM(total), 0) total, COALESCE(SUM(paid), 0) paid FROM invoices WHERE deal_id = ? AND status NOT IN ('draft','cancelled')`, dealId);
  // costs: film used (cost of goods) + direct purchases (non-stock lines received) + expenses on the deal
  const film = get(`SELECT COALESCE(SUM(-m.qty * m.unit_cost), 0) c FROM stock_moves m
    LEFT JOIN jobs j ON m.ref_type = 'job' AND j.id = m.ref_id LEFT JOIN invoices i ON m.ref_type = 'invoice' AND i.id = m.ref_id
    WHERE m.qty < 0 AND (j.deal_id = ? OR i.deal_id = ?)`, dealId, dealId).c;
  let direct = 0;
  for (const r of all(`SELECT r.lines FROM receipts r JOIN purchase_orders p ON p.id = r.po_id WHERE p.deal_id = ?`, dealId)) {
    for (const l of JSON.parse(r.lines || '[]')) if (!l.stock) direct += U.num(l.qty) * U.num(l.cost);
  }
  const exp = get('SELECT COALESCE(SUM(amount), 0) a FROM expenses WHERE deal_id = ? OR job_id IN (SELECT id FROM jobs WHERE deal_id = ?)', dealId, dealId).a;
  const cost = U.r2(film + direct + exp);
  return {
    sqm, items_total: itemsTotal, items_cost: itemsCost, items_profit: U.r2(itemsTotal - itemsCost),
    quote_id: q?.id || null, quote_number: q?.number || null, quoted: q ? U.r2(q.subtotal - q.discount) : 0, quoted_total: q?.total || 0,
    invoiced_net: U.r2(inv.net), invoiced: U.r2(inv.total), paid: U.r2(inv.paid), balance: U.r2(inv.total - inv.paid),
    cost_film: U.r2(film), cost_direct: U.r2(direct), cost_expenses: U.r2(exp), cost, profit: U.r2(inv.net - cost),
  };
}

// Moves a deal forward automatically (never backwards, never out of won/lost)
function advanceDeal(ctx, dealId, stage, userId, why) {
  const d = get('SELECT * FROM deals WHERE id = ?', dealId);
  if (!d || ['won', 'lost'].includes(d.stage)) return;
  if (STAGES.indexOf(stage) <= STAGES.indexOf(d.stage)) return;
  setStage(ctx, d, stage, userId, why);
}
function setStage(ctx, d, stage, userId, why = '') {
  if (d.stage === stage) return;
  run(`UPDATE deals SET stage = ?, stage_changed_at = datetime('now'), updated_at = datetime('now'),
    won_at = CASE WHEN ? = 'won' THEN datetime('now') ELSE won_at END, lost_at = CASE WHEN ? = 'lost' THEN datetime('now') ELSE lost_at END WHERE id = ?`,
  stage, stage, stage, d.id);
  ctx.timeline('deal', d.id, userId, 'stage', `Stage: ${STAGE_LABEL[d.stage]} → ${STAGE_LABEL[stage]}${why ? ` (${why})` : ''}`);
  if (stage === 'won') {
    const who = [d.owner_id, ...ctx.managers(), ...ctx.usersWith('invoices', 'create')];
    ctx.notify(who, { type: 'urgent', title: `🏆 Deal won: ${d.title}`, body: `${d.code} · ${U.fmtAED(d.value)} — raise the advance invoice and schedule the installation`, link: `deals/${d.id}` }, { exclude: userId });
  }
  ctx.broadcast('crm', 'deals', { id: d.id });
}
function refreshDealValue(dealId) {
  const s = dealSummary(dealId);
  const value = s.quoted || s.items_total;
  run(`UPDATE deals SET value = ?, updated_at = datetime('now') WHERE id = ?`, value, dealId);
}

function register(ctx) {
  const { app, h, need, fail, clean, timeline, notify } = ctx;
  const L = () => S.lists();

  // ======================= LEADS =======================
  app.get('/api/leads', need('crm'), h((req) => {
    const q = req.query;
    const where = [ownSql(req.user, 'l.')]; const p = [];
    if (q.status && q.status !== 'open') { where.push('l.status = ?'); p.push(String(q.status)); }
    if (q.status === 'open') where.push(`l.status IN ('new','contacted','qualified')`);
    if (q.source) { where.push('l.source = ?'); p.push(String(q.source)); }
    if (q.owner) { where.push('l.owner_id = ?'); p.push(Number(q.owner)); }
    if (U.isDate(q.from)) { where.push('date(l.created_at) >= ?'); p.push(q.from); }
    if (U.isDate(q.to)) { where.push('date(l.created_at) <= ?'); p.push(q.to); }
    if (q.q) { where.push('(l.name LIKE ? OR l.company LIKE ? OR l.phone LIKE ? OR l.email LIKE ? OR l.code LIKE ?)'); p.push(...Array(5).fill(`%${q.q}%`)); }
    const leads = all(`SELECT l.*, u.name owner_name, d.code deal_code FROM leads l LEFT JOIN users u ON u.id = l.owner_id LEFT JOIN deals d ON d.id = l.deal_id
      WHERE ${where.join(' AND ')} ORDER BY l.id DESC LIMIT 1000`, ...p).map((l) => ({ ...l, raw: undefined }));
    return { leads };
  }));
  app.post('/api/leads', need('crm', 'create'), h((req) => {
    const b = req.body;
    if (!clean(b.name, 120)) fail(400, 'Enter the name');
    if (!clean(b.phone, 40) && !clean(b.email, 200)) fail(400, 'Add a phone number or email');
    const ownerOk = scope(req.user, 'crm') === 'all';
    const { lead, duplicate } = captureLead(ctx, { ...b, owner_id: ownerOk && b.owner_id ? b.owner_id : req.user.id }, { userId: req.user.id, via: 'manual' });
    return { lead: leadRow(lead), duplicate };
  }));
  function loadLead(user, id) {
    const l = get('SELECT * FROM leads WHERE id = ?', id);
    if (!canSeeLead(user, l)) fail(404, 'Lead not found');
    return l;
  }
  app.get('/api/leads/:id', need('crm'), h((req) => {
    const l = loadLead(req.user, req.params.id);
    let raw = null; try { raw = l.raw ? JSON.parse(l.raw) : null; } catch {}
    return {
      lead: { ...leadRow(l), raw },
      timeline: all('SELECT t.*, u.name user_name FROM timeline t LEFT JOIN users u ON u.id = t.user_id WHERE entity = ? AND entity_id = ? ORDER BY id DESC', 'lead', l.id),
      activities: all('SELECT a.*, u.name assigned_name FROM activities a LEFT JOIN users u ON u.id = a.assigned_to WHERE lead_id = ? ORDER BY date DESC', l.id),
      contact: l.contact_id ? get('SELECT * FROM contacts WHERE id = ?', l.contact_id) : null,
      deal: l.deal_id ? get('SELECT id, code, title, stage, value FROM deals WHERE id = ?', l.deal_id) : null,
      similar: phoneKey(l.phone).length >= 8 ? all('SELECT id, code, name, phone, status, created_at FROM leads WHERE id != ? ORDER BY id DESC LIMIT 2000', l.id).filter((x) => phoneKey(x.phone) === phoneKey(l.phone)).slice(0, 5) : [],
    };
  }));
  app.patch('/api/leads/:id', need('crm', 'edit'), h((req) => {
    const l = loadLead(req.user, req.params.id);
    const b = req.body;
    const f = {};
    for (const k of ['name', 'company', 'phone', 'email', 'source', 'campaign', 'property_type', 'service', 'city', 'area', 'message', 'tags', 'lost_reason']) if (b[k] !== undefined) f[k] = clean(b[k], k === 'message' ? 3000 : 200);
    if (b.est_value !== undefined) f.est_value = U.num(b.est_value);
    if (b.next_follow_up !== undefined) f.next_follow_up = U.isDate(b.next_follow_up) ? b.next_follow_up : null;
    if (b.owner_id !== undefined && scope(req.user, 'crm') === 'all') f.owner_id = Number(b.owner_id) || null;
    if (b.status !== undefined && LEAD_STATUSES.includes(b.status) && b.status !== 'converted') f.status = b.status;
    if (f.name === '') fail(400, 'Name is required');
    const keys = Object.keys(f);
    if (keys.length) run(`UPDATE leads SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = datetime('now')${f.status && f.status !== l.status ? ", status_changed_at = datetime('now')" : ''} WHERE id = ?`, ...keys.map((k) => f[k]), l.id);
    if (f.status && f.status !== l.status) timeline('lead', l.id, req.user.id, 'stage', `Status: ${l.status} → ${f.status}${f.status === 'unqualified' && f.lost_reason ? ` (${f.lost_reason})` : ''}`);
    if (f.owner_id && f.owner_id !== l.owner_id) {
      timeline('lead', l.id, req.user.id, 'system', `Assigned to ${get('SELECT name FROM users WHERE id = ?', f.owner_id)?.name}`);
      notify([f.owner_id], { type: 'lead', title: `Lead assigned to you: ${l.name}`, body: [l.phone, l.service].filter(Boolean).join(' · '), link: `leads/${l.id}` }, { exclude: req.user.id });
    }
    ctx.broadcast('crm', 'leads', { id: l.id });
    return { lead: leadRow(get('SELECT * FROM leads WHERE id = ?', l.id)) };
  }));
  app.delete('/api/leads/:id', need('crm', 'delete'), h((req) => {
    const l = loadLead(req.user, req.params.id);
    run("DELETE FROM timeline WHERE entity = 'lead' AND entity_id = ?", l.id);
    run('DELETE FROM leads WHERE id = ?', l.id);
    ctx.broadcast('crm', 'leads');
    return { ok: true };
  }));
  app.post('/api/leads/:id/notes', need('crm'), h((req) => {
    const l = loadLead(req.user, req.params.id);
    const kind = NOTE_KINDS.includes(req.body.kind) ? req.body.kind : 'note';
    const body = clean(req.body.body, 4000);
    if (!body) fail(400, 'Write something');
    timeline('lead', l.id, req.user.id, kind, body);
    const patch = [];
    if (l.status === 'new' && ['call', 'whatsapp', 'email', 'meeting'].includes(kind)) patch.push("status = 'contacted', status_changed_at = datetime('now')");
    if (U.isDate(req.body.next_follow_up)) patch.push(`next_follow_up = '${req.body.next_follow_up}'`);
    run(`UPDATE leads SET ${[...patch, "updated_at = datetime('now')"].join(', ')} WHERE id = ?`, l.id);
    ctx.broadcast('crm', 'leads', { id: l.id });
    return { ok: true };
  }));
  // Qualified lead → customer (contact) + deal. Owner, source and history carry over.
  app.post('/api/leads/:id/convert', need('crm', 'create'), h((req) => {
    const l = loadLead(req.user, req.params.id);
    if (l.status === 'converted' && l.deal_id) fail(400, 'This lead is already a deal');
    const b = req.body;
    return tx(() => {
      let contactId = Number(b.contact_id) || l.contact_id;
      if (!contactId) {
        const type = b.contact_type === 'business' || (l.company && b.contact_type !== 'individual') ? 'business' : 'individual';
        contactId = Number(run(`INSERT INTO contacts (code, type, name, contact_person, phone, whatsapp, email, city, area, tags, source, owner_id, created_by)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, U.nextNumber('contact'), type, type === 'business' ? (l.company || l.name) : l.name,
        type === 'business' ? l.name : '', l.phone, l.phone, l.email, l.city, l.area,
        [l.tags, /villa|apartment/i.test(l.property_type) ? 'Residential' : l.property_type ? 'Commercial' : ''].filter(Boolean).join(','),
        l.source, l.owner_id || req.user.id, req.user.id).lastInsertRowid);
        timeline('contact', contactId, req.user.id, 'system', `Customer created from lead ${l.code}`);
      }
      const title = clean(b.title, 160) || `${l.company || l.name} — ${l.service || 'Window film'}`;
      const dealId = Number(run(`INSERT INTO deals (code, title, contact_id, lead_id, owner_id, stage, value, property_type, service, source, city, area, expected_close, next_follow_up, notes, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, U.nextNumber('deal'), title, contactId, l.id, l.owner_id || req.user.id,
      STAGES.includes(b.stage) && !['won', 'lost'].includes(b.stage) ? b.stage : 'new', U.num(b.value ?? l.est_value), l.property_type, l.service, l.source, l.city, l.area,
      U.isDate(b.expected_close) ? b.expected_close : null, l.next_follow_up, l.message, req.user.id).lastInsertRowid);
      run(`UPDATE leads SET status = 'converted', contact_id = ?, deal_id = ?, status_changed_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`, contactId, dealId, l.id);
      // the lead's history moves along with it
      run(`INSERT INTO timeline (entity, entity_id, user_id, kind, body, data, created_at) SELECT 'deal', ?, user_id, kind, body, data, created_at FROM timeline WHERE entity = 'lead' AND entity_id = ?`, dealId, l.id);
      run('UPDATE activities SET deal_id = ?, contact_id = ? WHERE lead_id = ?', dealId, contactId, l.id);
      run("UPDATE files SET entity = 'deal', entity_id = ? WHERE entity = 'lead' AND entity_id = ?", dealId, l.id);
      timeline('deal', dealId, req.user.id, 'stage', `Deal created from lead ${l.code} (${l.source})`);
      timeline('lead', l.id, req.user.id, 'stage', 'Converted to a deal');
      ctx.broadcast('crm', 'leads'); ctx.broadcast('crm', 'deals');
      return { deal_id: dealId, contact_id: contactId };
    });
  }));

  // ======================= CONTACTS =======================
  app.get('/api/contacts', need('crm'), h((req) => {
    const q = req.query; const where = []; const p = [];
    if (scope(req.user, 'crm') !== 'all') {
      where.push(`(c.owner_id = ? OR c.created_by = ? OR c.id IN (SELECT contact_id FROM deals WHERE owner_id = ? OR created_by = ?))`);
      p.push(req.user.id, req.user.id, req.user.id, req.user.id);
    }
    if (q.type) { where.push('c.type = ?'); p.push(String(q.type)); }
    if (q.tag) { where.push("(',' || c.tags || ',') LIKE ?"); p.push(`%,${q.tag},%`); }
    if (q.q) { where.push('(c.name LIKE ? OR c.contact_person LIKE ? OR c.phone LIKE ? OR c.email LIKE ? OR c.code LIKE ?)'); p.push(...Array(5).fill(`%${q.q}%`)); }
    const contacts = all(`SELECT c.*, u.name owner_name,
      (SELECT COUNT(*) FROM deals d WHERE d.contact_id = c.id) deals,
      (SELECT COALESCE(SUM(total), 0) FROM invoices i WHERE i.contact_id = c.id AND i.status NOT IN ('draft','cancelled')) invoiced
      FROM contacts c LEFT JOIN users u ON u.id = c.owner_id ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY c.id DESC LIMIT 2000`, ...p);
    return { contacts };
  }));
  const CONTACT_FIELDS = ['type', 'name', 'contact_person', 'designation', 'phone', 'whatsapp', 'email', 'trn', 'address', 'city', 'area', 'location_url', 'tags', 'source', 'notes'];
  function contactValues(b) {
    const f = {};
    for (const k of CONTACT_FIELDS) if (b[k] !== undefined) f[k] = clean(b[k], k === 'notes' ? 3000 : 300);
    if (f.type && !['business', 'individual'].includes(f.type)) f.type = 'individual';
    return f;
  }
  app.post('/api/contacts', need('crm', 'create'), h((req) => {
    const f = contactValues(req.body);
    if (!f.name) fail(400, 'Enter the name');
    const dupe = f.phone && phoneKey(f.phone).length >= 8 && all('SELECT id, name, phone FROM contacts').find((c) => phoneKey(c.phone) === phoneKey(f.phone));
    if (dupe && !req.body.force) fail(409, `${dupe.name} already has this phone number`);
    f.owner_id = scope(req.user, 'crm') === 'all' && req.body.owner_id ? Number(req.body.owner_id) : req.user.id;
    const keys = Object.keys(f);
    const r = run(`INSERT INTO contacts (code, created_by, ${keys.join(', ')}) VALUES (?, ?, ${keys.map(() => '?').join(', ')})`, U.nextNumber('contact'), req.user.id, ...keys.map((k) => f[k]));
    timeline('contact', Number(r.lastInsertRowid), req.user.id, 'system', 'Customer added');
    ctx.broadcast('crm', 'contacts');
    return { contact: get('SELECT * FROM contacts WHERE id = ?', r.lastInsertRowid) };
  }));
  function loadContact(user, id) {
    const c = get('SELECT * FROM contacts WHERE id = ?', id);
    if (!canSeeContact(user, c)) fail(404, 'Customer not found');
    return c;
  }
  app.get('/api/contacts/:id', need('crm'), h((req) => {
    const c = loadContact(req.user, req.params.id);
    const own = scope(req.user, 'crm') !== 'all';
    const dealFilter = own ? `AND (d.owner_id = ${req.user.id} OR d.created_by = ${req.user.id})` : '';
    return {
      contact: { ...c, owner_name: c.owner_id ? get('SELECT name FROM users WHERE id = ?', c.owner_id)?.name : null },
      deals: all(`SELECT d.*, u.name owner_name FROM deals d LEFT JOIN users u ON u.id = d.owner_id WHERE d.contact_id = ? ${dealFilter} ORDER BY d.id DESC`, c.id),
      leads: all('SELECT id, code, name, source, status, created_at FROM leads WHERE contact_id = ? ORDER BY id DESC', c.id),
      quotes: ctx.can(req.user, 'quotes') ? all('SELECT id, number, date, status, total, deal_id FROM quotes WHERE contact_id = ? ORDER BY id DESC', c.id) : [],
      invoices: ctx.can(req.user, 'invoices') ? all('SELECT id, number, date, due_date, status, total, paid FROM invoices WHERE contact_id = ? ORDER BY id DESC', c.id) : [],
      jobs: ctx.can(req.user, 'jobs') ? all('SELECT id, number, title, date, status FROM jobs WHERE contact_id = ? ORDER BY id DESC', c.id) : [],
      warranties: ctx.can(req.user, 'warranty') ? all('SELECT w.*, p.name product_name FROM warranties w LEFT JOIN products p ON p.id = w.product_id WHERE w.contact_id = ? ORDER BY w.id DESC', c.id) : [],
      timeline: all(`SELECT t.*, u.name user_name FROM timeline t LEFT JOIN users u ON u.id = t.user_id WHERE entity = 'contact' AND entity_id = ? ORDER BY id DESC LIMIT 100`, c.id),
      totals: get(`SELECT COALESCE(SUM(total), 0) invoiced, COALESCE(SUM(paid), 0) paid FROM invoices WHERE contact_id = ? AND status NOT IN ('draft','cancelled')`, c.id),
    };
  }));
  app.patch('/api/contacts/:id', need('crm', 'edit'), h((req) => {
    const c = loadContact(req.user, req.params.id);
    const f = contactValues(req.body);
    if (f.name === '') fail(400, 'Name is required');
    if (req.body.owner_id !== undefined && scope(req.user, 'crm') === 'all') f.owner_id = Number(req.body.owner_id) || null;
    const keys = Object.keys(f);
    if (keys.length) run(`UPDATE contacts SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = datetime('now') WHERE id = ?`, ...keys.map((k) => f[k]), c.id);
    ctx.broadcast('crm', 'contacts', { id: c.id });
    return { contact: get('SELECT * FROM contacts WHERE id = ?', c.id) };
  }));
  app.delete('/api/contacts/:id', need('crm', 'delete'), h((req) => {
    const c = loadContact(req.user, req.params.id);
    if (get('SELECT id FROM invoices WHERE contact_id = ? UNION SELECT id FROM quotes WHERE contact_id = ? UNION SELECT id FROM jobs WHERE contact_id = ?', c.id, c.id, c.id)) fail(400, 'This customer has quotations, invoices or jobs — it can’t be deleted');
    run('DELETE FROM deals WHERE contact_id = ?', c.id);
    run("DELETE FROM timeline WHERE entity = 'contact' AND entity_id = ?", c.id);
    run('DELETE FROM contacts WHERE id = ?', c.id);
    ctx.broadcast('crm', 'contacts');
    return { ok: true };
  }));
  app.post('/api/contacts/:id/notes', need('crm'), h((req) => {
    const c = loadContact(req.user, req.params.id);
    const body = clean(req.body.body, 4000);
    if (!body) fail(400, 'Write something');
    timeline('contact', c.id, req.user.id, NOTE_KINDS.includes(req.body.kind) ? req.body.kind : 'note', body);
    return { ok: true };
  }));

  // ======================= DEALS =======================
  app.get('/api/deals', need('crm'), h((req) => {
    const q = req.query; const where = [ownSql(req.user, 'd.')]; const p = [];
    if (q.stage === 'open') where.push(`d.stage NOT IN ('won','lost')`);
    else if (q.stage) { where.push('d.stage = ?'); p.push(String(q.stage)); }
    if (q.owner) { where.push('d.owner_id = ?'); p.push(Number(q.owner)); }
    if (q.contact) { where.push('d.contact_id = ?'); p.push(Number(q.contact)); }
    if (q.q) { where.push('(d.title LIKE ? OR d.code LIKE ? OR c.name LIKE ?)'); p.push(...Array(3).fill(`%${q.q}%`)); }
    const deals = all(`SELECT d.*, c.name contact_name, c.phone contact_phone, u.name owner_name,
      (SELECT COUNT(*) FROM quotes q WHERE q.deal_id = d.id) quotes,
      (SELECT COALESCE(SUM(sqm), 0) FROM measurements m WHERE m.deal_id = d.id) sqm
      FROM deals d LEFT JOIN contacts c ON c.id = d.contact_id LEFT JOIN users u ON u.id = d.owner_id
      WHERE ${where.join(' AND ')} ORDER BY d.updated_at DESC LIMIT 1000`, ...p);
    return { deals, stages: STAGES };
  }));
  const DEAL_FIELDS = ['title', 'property_type', 'service', 'source', 'address', 'city', 'area', 'location_url', 'lost_reason', 'notes'];
  app.post('/api/deals', need('crm', 'create'), h((req) => {
    const b = req.body;
    let contactId = Number(b.contact_id) || null;
    return tx(() => {
      if (!contactId && b.contact) {
        const c = contactValues(b.contact);
        if (!c.name) fail(400, 'Enter the customer name');
        const keys = Object.keys(c);
        contactId = Number(run(`INSERT INTO contacts (code, owner_id, created_by, ${keys.join(', ')}) VALUES (?, ?, ?, ${keys.map(() => '?').join(', ')})`,
          U.nextNumber('contact'), req.user.id, req.user.id, ...keys.map((k) => c[k])).lastInsertRowid);
      }
      if (!contactId || !get('SELECT id FROM contacts WHERE id = ?', contactId)) fail(400, 'Pick or add the customer');
      const contact = get('SELECT * FROM contacts WHERE id = ?', contactId);
      const title = clean(b.title, 160) || `${contact.name} — ${clean(b.service, 80) || 'Window film'}`;
      const owner = scope(req.user, 'crm') === 'all' && b.owner_id ? Number(b.owner_id) : req.user.id;
      const r = run(`INSERT INTO deals (code, title, contact_id, owner_id, stage, value, property_type, service, source, address, city, area, location_url, expected_close, next_follow_up, notes, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, U.nextNumber('deal'), title, contactId, owner,
      STAGES.includes(b.stage) && !['won', 'lost'].includes(b.stage) ? b.stage : 'new', U.num(b.value), clean(b.property_type, 60), clean(b.service, 80),
      clean(b.source, 60) || contact.source, clean(b.address, 300) || contact.address, clean(b.city, 60) || contact.city, clean(b.area, 80) || contact.area,
      clean(b.location_url, 500) || contact.location_url, U.isDate(b.expected_close) ? b.expected_close : null, U.isDate(b.next_follow_up) ? b.next_follow_up : null, clean(b.notes, 3000), req.user.id);
      const id = Number(r.lastInsertRowid);
      timeline('deal', id, req.user.id, 'stage', 'Deal created');
      if (owner !== req.user.id) notify([owner], { type: 'assigned', title: `Deal assigned to you: ${title}`, body: contact.name, link: `deals/${id}` });
      ctx.broadcast('crm', 'deals');
      return { deal: get('SELECT * FROM deals WHERE id = ?', id) };
    });
  }));
  function loadDeal(user, id) {
    const d = get('SELECT * FROM deals WHERE id = ?', id);
    if (!canSeeDeal(user, d)) fail(404, 'Deal not found');
    return d;
  }
  ctx.loadDeal = loadDeal;
  app.get('/api/deals/:id', need('crm'), h((req) => {
    const d = loadDeal(req.user, req.params.id);
    const u = req.user;
    const costs = can(u, 'see_costs');
    const items = all('SELECT di.*, p.code product_code, p.image_file_id, v.name vendor_name FROM deal_items di LEFT JOIN products p ON p.id = di.product_id LEFT JOIN vendors v ON v.id = di.vendor_id WHERE deal_id = ? ORDER BY position, id', d.id)
      .map((i) => (costs ? i : { ...i, cost: undefined, vendor_id: undefined, vendor_name: undefined }));
    const summary = dealSummary(d.id);
    if (!costs) for (const k of ['items_cost', 'items_profit', 'cost_film', 'cost_direct', 'cost_expenses', 'cost', 'profit']) delete summary[k];
    return {
      deal: { ...d, owner_name: d.owner_id ? get('SELECT name FROM users WHERE id = ?', d.owner_id)?.name : null },
      contact: d.contact_id ? get('SELECT * FROM contacts WHERE id = ?', d.contact_id) : null,
      lead: d.lead_id ? get('SELECT id, code, source, campaign, message, created_at FROM leads WHERE id = ?', d.lead_id) : null,
      measurements: all('SELECT m.*, p.name product_name FROM measurements m LEFT JOIN products p ON p.id = m.product_id WHERE deal_id = ? ORDER BY position, id', d.id),
      items, summary,
      quotes: can(u, 'quotes') ? all('SELECT id, number, date, valid_until, status, subtotal, discount, vat, total, sent_at, accepted_at, viewed_at FROM quotes WHERE deal_id = ? ORDER BY id DESC', d.id) : [],
      invoices: can(u, 'invoices') ? all('SELECT id, number, kind, date, due_date, status, total, paid FROM invoices WHERE deal_id = ? ORDER BY id DESC', d.id) : [],
      pos: can(u, 'purchases') ? all('SELECT p.id, p.number, p.date, p.status, p.total, v.name vendor_name FROM purchase_orders p LEFT JOIN vendors v ON v.id = p.vendor_id WHERE deal_id = ? ORDER BY p.id DESC', d.id) : [],
      jobs: can(u, 'jobs') ? all('SELECT id, number, title, date, end_date, start_time, status, installer_ids FROM jobs WHERE deal_id = ? ORDER BY id DESC', d.id) : [],
      expenses: can(u, 'expenses') ? all('SELECT e.*, a.name category FROM expenses e LEFT JOIN accounts a ON a.id = e.account_id WHERE e.deal_id = ? ORDER BY e.date DESC', d.id) : [],
      activities: all('SELECT a.*, u.name assigned_name FROM activities a LEFT JOIN users u ON u.id = a.assigned_to WHERE deal_id = ? ORDER BY date DESC, start_time DESC', d.id),
      timeline: all(`SELECT t.*, u.name user_name FROM timeline t LEFT JOIN users u ON u.id = t.user_id WHERE entity = 'deal' AND entity_id = ? ORDER BY id DESC`, d.id),
      file_count: get(`SELECT COUNT(*) n FROM files WHERE entity = 'deal' AND entity_id = ?`, d.id).n,
    };
  }));
  app.patch('/api/deals/:id', need('crm', 'edit'), h((req) => {
    const d = loadDeal(req.user, req.params.id);
    const b = req.body;
    const f = {};
    for (const k of DEAL_FIELDS) if (b[k] !== undefined) f[k] = clean(b[k], k === 'notes' ? 3000 : 300);
    if (b.value !== undefined) f.value = U.num(b.value);
    if (b.expected_close !== undefined) f.expected_close = U.isDate(b.expected_close) ? b.expected_close : null;
    if (b.next_follow_up !== undefined) f.next_follow_up = U.isDate(b.next_follow_up) ? b.next_follow_up : null;
    if (b.contact_id !== undefined && get('SELECT id FROM contacts WHERE id = ?', Number(b.contact_id))) f.contact_id = Number(b.contact_id);
    if (b.owner_id !== undefined && scope(req.user, 'crm') === 'all') f.owner_id = Number(b.owner_id) || null;
    if (f.title === '') fail(400, 'Title is required');
    const keys = Object.keys(f);
    if (keys.length) run(`UPDATE deals SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = datetime('now') WHERE id = ?`, ...keys.map((k) => f[k]), d.id);
    if (f.owner_id && f.owner_id !== d.owner_id) {
      timeline('deal', d.id, req.user.id, 'system', `Owner changed to ${get('SELECT name FROM users WHERE id = ?', f.owner_id)?.name}`);
      notify([f.owner_id], { type: 'assigned', title: `Deal assigned to you: ${d.title}`, body: d.code, link: `deals/${d.id}` }, { exclude: req.user.id });
    }
    if (b.stage && STAGES.includes(b.stage) && b.stage !== d.stage) {
      if (b.stage === 'lost' && !clean(b.lost_reason, 300) && !d.lost_reason) fail(400, 'Pick why the deal was lost');
      setStage(ctx, get('SELECT * FROM deals WHERE id = ?', d.id), b.stage, req.user.id, b.stage === 'lost' ? clean(b.lost_reason, 300) : '');
    }
    ctx.broadcast('crm', 'deals', { id: d.id });
    return { deal: get('SELECT * FROM deals WHERE id = ?', d.id) };
  }));
  app.delete('/api/deals/:id', need('crm', 'delete'), h((req) => {
    const d = loadDeal(req.user, req.params.id);
    if (get(`SELECT id FROM invoices WHERE deal_id = ? AND status != 'draft'`, d.id)) fail(400, 'This deal has invoices — mark it lost instead');
    tx(() => {
      run("DELETE FROM timeline WHERE entity = 'deal' AND entity_id = ?", d.id);
      run('UPDATE leads SET deal_id = NULL, status = ? WHERE deal_id = ?', 'qualified', d.id);
      run('DELETE FROM deals WHERE id = ?', d.id);
    });
    ctx.broadcast('crm', 'deals');
    return { ok: true };
  }));
  app.post('/api/deals/:id/notes', need('crm'), h((req) => {
    const d = loadDeal(req.user, req.params.id);
    const body = clean(req.body.body, 4000);
    if (!body) fail(400, 'Write something');
    timeline('deal', d.id, req.user.id, NOTE_KINDS.includes(req.body.kind) ? req.body.kind : 'note', body);
    for (const uid of ctx.mentionedUsers(body)) notify([uid], { type: 'mention', title: `${req.user.name} mentioned you on ${d.title}`, body, link: `deals/${d.id}` }, { exclude: req.user.id });
    if (U.isDate(req.body.next_follow_up)) run('UPDATE deals SET next_follow_up = ? WHERE id = ?', req.body.next_follow_up, d.id);
    run(`UPDATE deals SET updated_at = datetime('now') WHERE id = ?`, d.id);
    ctx.broadcast('crm', 'deals', { id: d.id });
    return { ok: true };
  }));

  // ---------- estimation form: glass length × width × quantity → SQM ----------
  app.post('/api/deals/:id/measurements', need('crm', 'edit'), h((req) => {
    const d = loadDeal(req.user, req.params.id);
    const rows = Array.isArray(req.body.rows) ? req.body.rows : [req.body];
    const unit = Object.keys(U.UNIT_TO_M).includes(req.body.unit) ? req.body.unit : S.docs().default_unit;
    let pos = get('SELECT COALESCE(MAX(position), 0) p FROM measurements WHERE deal_id = ?', d.id).p;
    const added = [];
    tx(() => {
      for (const r of rows.slice(0, 200)) {
        const len = U.num(r.length); const wid = U.num(r.width); const qty = Math.max(1, Math.round(U.num(r.qty, 1)));
        const u = Object.keys(U.UNIT_TO_M).includes(r.unit) ? r.unit : unit;
        if (len <= 0 || wid <= 0) continue;
        const sqm = U.sqmOf(len, wid, qty, u);
        const id = Number(run('INSERT INTO measurements (deal_id, location, length, width, qty, unit, sqm, product_id, notes, position, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          d.id, clean(r.location, 120), len, wid, qty, u, sqm, Number(r.product_id) || null, clean(r.notes, 300), ++pos, req.user.id).lastInsertRowid);
        added.push({ id, len, wid, qty, u, sqm, location: clean(r.location, 120) });
      }
    });
    if (!added.length) fail(400, 'Enter the glass length and width');
    const total = U.r2(added.reduce((s, a) => s + a.sqm, 0));
    timeline('deal', d.id, req.user.id, 'form', `Estimation form: ${added.length} glass ${added.length === 1 ? 'entry' : 'entries'} = ${total} SQM`, {
      rows: added.map((a) => ({ location: a.location, length: a.len, width: a.wid, qty: a.qty, unit: a.u, sqm: a.sqm })), total,
    });
    advanceDeal(ctx, d.id, 'measured', req.user.id, 'glass measured');
    ctx.broadcast('crm', 'deals', { id: d.id });
    return { added: added.length, sqm: total };
  }));
  app.patch('/api/measurements/:id', need('crm', 'edit'), h((req) => {
    const m = get('SELECT * FROM measurements WHERE id = ?', req.params.id);
    if (!m) fail(404, 'Not found');
    loadDeal(req.user, m.deal_id);
    const b = req.body;
    const n = {
      location: b.location !== undefined ? clean(b.location, 120) : m.location,
      length: b.length !== undefined ? U.num(b.length) : m.length,
      width: b.width !== undefined ? U.num(b.width) : m.width,
      qty: b.qty !== undefined ? Math.max(1, Math.round(U.num(b.qty, 1))) : m.qty,
      unit: Object.keys(U.UNIT_TO_M).includes(b.unit) ? b.unit : m.unit,
      product_id: b.product_id !== undefined ? Number(b.product_id) || null : m.product_id,
      notes: b.notes !== undefined ? clean(b.notes, 300) : m.notes,
    };
    if (n.length <= 0 || n.width <= 0) fail(400, 'Length and width must be more than 0');
    run('UPDATE measurements SET location = ?, length = ?, width = ?, qty = ?, unit = ?, sqm = ?, product_id = ?, notes = ? WHERE id = ?',
      n.location, n.length, n.width, n.qty, n.unit, U.sqmOf(n.length, n.width, n.qty, n.unit), n.product_id, n.notes, m.id);
    ctx.broadcast('crm', 'deals', { id: m.deal_id });
    return { ok: true };
  }));
  app.delete('/api/measurements/:id', need('crm', 'edit'), h((req) => {
    const m = get('SELECT * FROM measurements WHERE id = ?', req.params.id);
    if (!m) fail(404, 'Not found');
    loadDeal(req.user, m.deal_id);
    run('DELETE FROM measurements WHERE id = ?', m.id);
    ctx.broadcast('crm', 'deals', { id: m.deal_id });
    return { ok: true };
  }));

  // ---------- pricing sheet (deal items): selling price, margin, purchase price, vendor ----------
  app.put('/api/deals/:id/items', need('crm', 'edit'), h((req) => {
    const d = loadDeal(req.user, req.params.id);
    const costs = can(req.user, 'see_costs');
    const old = all('SELECT * FROM deal_items WHERE deal_id = ?', d.id);
    const items = (Array.isArray(req.body.items) ? req.body.items : []).slice(0, 200);
    tx(() => {
      run('DELETE FROM deal_items WHERE deal_id = ?', d.id);
      items.forEach((it, i) => {
        const kind = it.kind === 'header' ? 'header' : 'item';
        const product = it.product_id ? get('SELECT * FROM products WHERE id = ?', Number(it.product_id)) : null;
        const prev = it.id ? old.find((o) => o.id === Number(it.id)) : null;
        // people who can't see costs keep the existing purchase price / vendor (or the product's)
        const cost = costs ? U.num(it.cost) : prev?.cost ?? product?.cost_price ?? 0;
        const vendor = costs ? Number(it.vendor_id) || null : prev?.vendor_id ?? null;
        run('INSERT INTO deal_items (deal_id, position, kind, product_id, name, description, qty, unit, price, cost, vendor_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          d.id, i, kind, product?.id || null, clean(it.name, 200) || product?.name || '', clean(it.description, 1000), kind === 'header' ? 0 : U.num(it.qty),
          clean(it.unit, 12) || product?.unit || 'SQM', kind === 'header' ? 0 : U.num(it.price), kind === 'header' ? 0 : cost, vendor);
      });
    });
    refreshDealValue(d.id);
    const s = dealSummary(d.id);
    timeline('deal', d.id, req.user.id, 'system', `Pricing updated: ${items.filter((i) => i.kind !== 'header').length} items, ${U.fmtAED(s.items_total)}${costs ? ` · profit ${U.fmtAED(s.items_profit)}` : ''}`);
    ctx.broadcast('crm', 'deals', { id: d.id });
    return { ok: true, summary: costs ? s : { items_total: s.items_total } };
  }));

  // ======================= ACTIVITIES & CALENDAR =======================
  const actScope = (u) => (scope(u, 'crm') === 'all' ? '1=1' : `(a.assigned_to = ${Number(u.id)} OR a.created_by = ${Number(u.id)})`);
  app.get('/api/activities', h((req) => {
    const q = req.query; const where = [actScope(req.user)]; const p = [];
    if (U.isDate(q.from)) { where.push('a.date >= ?'); p.push(q.from); }
    if (U.isDate(q.to)) { where.push('a.date <= ?'); p.push(q.to); }
    if (q.status) { where.push('a.status = ?'); p.push(String(q.status)); }
    if (q.mine) { where.push('a.assigned_to = ?'); p.push(req.user.id); }
    const rows = all(`SELECT a.*, u.name assigned_name, d.title deal_title, d.code deal_code, l.name lead_name, c.name contact_name, c.phone contact_phone
      FROM activities a LEFT JOIN users u ON u.id = a.assigned_to LEFT JOIN deals d ON d.id = a.deal_id LEFT JOIN leads l ON l.id = a.lead_id LEFT JOIN contacts c ON c.id = a.contact_id
      WHERE ${where.join(' AND ')} ORDER BY a.date, a.start_time LIMIT 2000`, ...p);
    return { activities: rows };
  }));
  function activityValues(b) {
    const f = {};
    if (b.type !== undefined) f.type = ACTIVITY_TYPES.includes(b.type) ? b.type : 'task';
    if (b.title !== undefined) f.title = clean(b.title, 200);
    if (b.notes !== undefined) f.notes = clean(b.notes, 3000);
    if (b.date !== undefined) { if (!U.isDate(b.date)) fail(400, 'Pick a date'); f.date = b.date; }
    for (const k of ['start_time', 'end_time']) if (b[k] !== undefined) f[k] = /^\d{2}:\d{2}$/.test(b[k]) ? b[k] : null;
    if (b.assigned_to !== undefined) f.assigned_to = Number(b.assigned_to) || null;
    return f;
  }
  app.post('/api/activities', h((req) => {
    if (!can(req.user, 'crm', 'create') && !can(req.user, 'jobs', 'create')) fail(403, 'No access');
    const b = req.body;
    const f = activityValues({ type: 'task', ...b });
    if (!f.date) fail(400, 'Pick a date');
    let dealId = Number(b.deal_id) || null; let leadId = Number(b.lead_id) || null; let contactId = Number(b.contact_id) || null;
    if (dealId) { const d = loadDeal(req.user, dealId); contactId = contactId || d.contact_id; }
    if (leadId) loadLead(req.user, leadId);
    if (!f.title) f.title = `${ACTIVITY_LABEL[f.type]}${dealId ? ` · ${get('SELECT title FROM deals WHERE id = ?', dealId).title}` : leadId ? ` · ${get('SELECT name FROM leads WHERE id = ?', leadId).name}` : ''}`;
    const assigned = f.assigned_to || req.user.id;
    const r = run(`INSERT INTO activities (type, title, notes, date, start_time, end_time, assigned_to, lead_id, deal_id, contact_id, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      f.type, f.title, f.notes || '', f.date, f.start_time || null, f.end_time || null, assigned, leadId, dealId, contactId, req.user.id);
    const when = `${f.date}${f.start_time ? ` ${f.start_time}` : ''}`;
    if (dealId) timeline('deal', dealId, req.user.id, 'system', `${ACTIVITY_LABEL[f.type]} scheduled for ${when}`);
    if (leadId) timeline('lead', leadId, req.user.id, 'system', `${ACTIVITY_LABEL[f.type]} scheduled for ${when}`);
    if (dealId && f.type === 'site_visit') advanceDeal(ctx, dealId, 'site_visit', req.user.id, 'site visit booked');
    if (assigned !== req.user.id) notify([assigned], { type: 'activity', title: `${ACTIVITY_LABEL[f.type]} for you: ${f.title}`, body: when, link: 'calendar' });
    ctx.broadcast('crm', 'activities');
    ctx.emitTo([assigned], 'activities');
    return { id: Number(r.lastInsertRowid) };
  }));
  function loadActivity(user, id) {
    const a = get('SELECT * FROM activities WHERE id = ?', id);
    if (!a || !(scope(user, 'crm') === 'all' || a.assigned_to === user.id || a.created_by === user.id)) fail(404, 'Not found');
    return a;
  }
  app.patch('/api/activities/:id', h((req) => {
    const a = loadActivity(req.user, req.params.id);
    const f = activityValues(req.body);
    if (req.body.status && ['planned', 'done', 'cancelled'].includes(req.body.status)) f.status = req.body.status;
    if (req.body.outcome !== undefined) f.outcome = clean(req.body.outcome, 2000);
    const keys = Object.keys(f);
    if (keys.length) run(`UPDATE activities SET ${keys.map((k) => `${k} = ?`).join(', ')}${f.status === 'done' ? ", done_at = datetime('now')" : ''} WHERE id = ?`, ...keys.map((k) => f[k]), a.id);
    if (f.status === 'done' && a.status !== 'done') {
      const text = `${ACTIVITY_LABEL[a.type]} done: ${a.title}${f.outcome ? ` — ${f.outcome}` : ''}`;
      const kind = { call: 'call', meeting: 'meeting', site_visit: 'site_visit' }[a.type] || 'note';
      if (a.deal_id) timeline('deal', a.deal_id, req.user.id, kind, text);
      if (a.lead_id) {
        timeline('lead', a.lead_id, req.user.id, kind, text);
        run(`UPDATE leads SET status = CASE WHEN status = 'new' THEN 'contacted' ELSE status END, updated_at = datetime('now') WHERE id = ?`, a.lead_id);
      }
    }
    if (f.assigned_to && f.assigned_to !== a.assigned_to) notify([f.assigned_to], { type: 'activity', title: `${ACTIVITY_LABEL[a.type]} for you: ${a.title}`, body: f.date || a.date, link: 'calendar' }, { exclude: req.user.id });
    ctx.broadcast('crm', 'activities');
    ctx.emitTo([a.assigned_to, f.assigned_to], 'activities');
    return { ok: true };
  }));
  app.delete('/api/activities/:id', h((req) => {
    const a = loadActivity(req.user, req.params.id);
    run('DELETE FROM activities WHERE id = ?', a.id);
    ctx.broadcast('crm', 'activities');
    ctx.emitTo([a.assigned_to], 'activities');
    return { ok: true };
  }));

  // One feed for the shared calendar: activities + installations + follow-ups
  app.get('/api/calendar', h((req) => {
    const from = U.isDate(req.query.from) ? req.query.from : U.monthStart();
    const to = U.isDate(req.query.to) ? req.query.to : U.monthEnd();
    const mine = !!req.query.mine;
    const events = [];
    const actWhere = mine ? `a.assigned_to = ${req.user.id}` : actScope(req.user);
    for (const a of all(`SELECT a.*, u.name assigned_name, d.title deal_title FROM activities a LEFT JOIN users u ON u.id = a.assigned_to LEFT JOIN deals d ON d.id = a.deal_id
      WHERE ${actWhere} AND a.date BETWEEN ? AND ? AND a.status != 'cancelled'`, from, to)) {
      events.push({ kind: 'activity', id: a.id, type: a.type, date: a.date, start: a.start_time, end: a.end_time, title: a.title, notes: a.notes, who: a.assigned_to, who_name: a.assigned_name, done: a.status === 'done', link: a.deal_id ? `deals/${a.deal_id}` : a.lead_id ? `leads/${a.lead_id}` : null, deal_id: a.deal_id, lead_id: a.lead_id });
    }
    if (can(req.user, 'jobs')) {
      const jobs = require('./jobs');
      for (const j of all(`SELECT j.*, c.name contact_name FROM jobs j LEFT JOIN contacts c ON c.id = j.contact_id WHERE j.status != 'cancelled' AND j.date IS NOT NULL AND j.date <= ? AND COALESCE(j.end_date, j.date) >= ?`, to, from)) {
        if (!jobs.canSeeJob(req.user, j)) continue;
        if (mine && !jobs.installersOf(j).includes(req.user.id)) continue;
        events.push({ kind: 'job', id: j.id, type: 'install', date: j.date, end_date: j.end_date, start: j.start_time, end: j.end_time, title: `${j.number} · ${j.contact_name || j.title}`, status: j.status, done: ['completed', 'signed_off'].includes(j.status), who_ids: jobs.installersOf(j), link: `jobs/${j.id}` });
      }
    }
    if (can(req.user, 'warranty') || can(req.user, 'crm')) {
      const fw = scope(req.user, 'warranty') === 'all' || scope(req.user, 'crm') === 'all' ? '1=1' : `f.assigned_to = ${req.user.id}`;
      for (const f of all(`SELECT f.*, c.name contact_name FROM followups f LEFT JOIN contacts c ON c.id = f.contact_id WHERE ${mine ? `f.assigned_to = ${req.user.id}` : fw} AND f.status = 'pending' AND f.due_date BETWEEN ? AND ?`, from, to)) {
        events.push({ kind: 'followup', id: f.id, type: f.type, date: f.due_date, title: `${f.title}${f.contact_name ? ` · ${f.contact_name}` : ''}`, who: f.assigned_to, link: 'followups' });
      }
    }
    return { from, to, events };
  }));

  // ---------- files on CRM records ----------
  ctx.fileAccess.lead = (u, id, write) => { const l = get('SELECT * FROM leads WHERE id = ?', id); return canSeeLead(u, l) && (!write || can(u, 'crm', 'edit')); };
  ctx.fileAccess.contact = (u, id, write) => { const c = get('SELECT * FROM contacts WHERE id = ?', id); return canSeeContact(u, c) && (!write || can(u, 'crm', 'edit')); };
  ctx.fileAccess.deal = (u, id, write) => {
    const d = get('SELECT * FROM deals WHERE id = ?', id);
    if (!d) return false;
    if (canSeeDeal(u, d)) return !write || can(u, 'crm', 'edit') || can(u, 'quotes', 'edit');
    // installers can open the drawings & photos of deals they install (read only)
    return !write && can(u, 'jobs') && all('SELECT * FROM jobs WHERE deal_id = ?', d.id).some((j) => require('./jobs').canSeeJob(u, j));
  };
}

// ---------- public: website forms, Meta lead ads, WhatsApp ----------
function registerPublic(ctx) {
  const { app } = ctx;
  const cors = (req, res) => { res.set({ 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' }); };
  app.options('/api/public/leads', (req, res) => { cors(req, res); res.status(204).end(); });
  const hits = new Map(); // simple flood protection per IP
  app.post('/api/public/leads', (req, res) => {
    cors(req, res);
    if (String(req.query.key || req.body?.key || '') !== S.leadKey()) return res.status(403).json({ error: 'Wrong key' });
    const now = Date.now(); const h = (hits.get(req.ip) || []).filter((t) => now - t < 10 * 60e3);
    if (h.length >= 20) return res.status(429).json({ error: 'Too many requests' });
    hits.set(req.ip, [...h, now]);
    const b = { ...(req.body || {}) };
    if (b.website || b._gotcha) return res.json({ ok: true }); // spam trap field
    if (!b.phone && !b.email && !b.phone_number && !b.mobile) return res.status(400).json({ error: 'Phone or email is required' });
    try {
      const { lead, duplicate } = captureLead(ctx, b, { via: 'website' });
      const back = String(b.redirect || req.query.redirect || '');
      if (/^https?:\/\//.test(back)) return res.redirect(303, back);
      res.json({ ok: true, id: lead.id, duplicate });
    } catch (err) { console.error('[leads webhook]', err); res.status(500).json({ error: 'Could not save' }); }
  });

  // Meta (Facebook / Instagram) lead ads: subscribe the page's "leadgen" webhook to this address
  app.get('/api/public/meta', (req, res) => {
    const token = U.setting('meta_verify_token');
    if (token && req.query['hub.mode'] === 'subscribe' && req.query['hub.verify_token'] === token) return res.send(String(req.query['hub.challenge'] || ''));
    res.status(403).send('Forbidden');
  });
  app.post('/api/public/meta', async (req, res) => {
    res.sendStatus(200); // answer Meta at once; fetch the lead details after
    const pageToken = U.setting('meta_page_token');
    if (!pageToken) return;
    for (const entry of req.body?.entry || []) {
      for (const ch of entry.changes || []) {
        const leadId = ch.value?.leadgen_id;
        if (!leadId) continue;
        try {
          const r = await fetch(`https://graph.facebook.com/v20.0/${encodeURIComponent(leadId)}?fields=field_data,ad_name,form_id,campaign_name,platform&access_token=${encodeURIComponent(pageToken)}`);
          const data = await r.json();
          if (!r.ok) throw new Error(data.error?.message || r.status);
          const b = { source: data.platform === 'ig' ? 'Instagram' : 'Meta Ads', campaign: data.campaign_name || data.ad_name || '' };
          for (const f of data.field_data || []) b[String(f.name).toLowerCase()] = (f.values || []).join(', ');
          b.message = Object.entries(b).filter(([k]) => !['source', 'campaign', 'full_name', 'phone_number', 'email', 'first_name', 'last_name'].includes(k)).map(([k, v]) => `${k.replace(/_/g, ' ')}: ${v}`).join('\n');
          captureLead(ctx, b, { via: 'meta' });
        } catch (err) { console.error('[meta lead]', err.message); }
      }
    }
  });

  // WhatsApp Business Cloud API: customer messages to the business number become leads (or notes on their open lead)
  app.get('/api/public/whatsapp', (req, res) => {
    const token = U.setting('wa_verify_token');
    if (token && req.query['hub.mode'] === 'subscribe' && req.query['hub.verify_token'] === token) return res.send(String(req.query['hub.challenge'] || ''));
    res.status(403).send('Forbidden');
  });
  app.post('/api/public/whatsapp', (req, res) => {
    res.sendStatus(200);
    try {
      for (const entry of req.body?.entry || []) {
        for (const ch of entry.changes || []) {
          const v = ch.value || {};
          const names = Object.fromEntries((v.contacts || []).map((c) => [c.wa_id, c.profile?.name]));
          for (const m of v.messages || []) {
            const text = m.text?.body || m.button?.text || m.interactive?.button_reply?.title || (m.type ? `[${m.type}]` : '');
            captureLead(ctx, { name: names[m.from] || `WhatsApp +${m.from}`, phone: `+${m.from}`, source: 'WhatsApp', message: text }, { via: 'whatsapp' });
          }
        }
      }
    } catch (err) { console.error('[whatsapp inbound]', err.message); }
  });
}

module.exports = {
  register, registerPublic, captureLead, dealSummary, advanceDeal, setStage, refreshDealValue, canSeeDeal, canSeeLead, canSeeContact,
  normPhone, phoneKey, STAGES, STAGE_LABEL, LEAD_STATUSES, ACTIVITY_LABEL,
};
