// Installations (jobs) for the installation team: schedule, on the way → started → completed → customer
// sign-off with signature; film used comes out of stock; warranties and after-sales follow-ups are created
// automatically. Also warranty claims and the follow-up list.
const { all, get, run, tx } = require('./db');
const U = require('./util');
const S = require('./settings');
const catalog = require('./catalog');
const crm = require('./crm');
const { can, scope } = require('./perms');

const STATUSES = ['scheduled', 'on_the_way', 'in_progress', 'completed', 'signed_off', 'on_hold', 'cancelled'];
const STATUS_LABEL = { scheduled: 'Scheduled', on_the_way: 'On the way', in_progress: 'In progress', completed: 'Completed — awaiting sign-off', signed_off: 'Signed off', on_hold: 'On hold', cancelled: 'Cancelled' };
const FOLLOWUP_LABEL = { review: 'Ask for a Google review', check_in: 'Check-in call', inspection: 'Free inspection visit', warranty_expiry: 'Warranty ending', quote: 'Quotation follow-up', payment: 'Payment follow-up', custom: 'Follow-up' };

const ids = (s) => String(s || '').split(',').map(Number).filter(Boolean);
const installersOf = (j) => [...new Set([...ids(j.installer_ids), j.lead_installer_id].filter(Boolean))];
function canSeeJob(u, j) {
  if (!j) return false;
  const s = scope(u, 'jobs');
  if (s === 'all') return true;
  if (s !== 'own') return false;
  if (installersOf(j).includes(u.id) || j.created_by === u.id) return true;
  const d = j.deal_id ? get('SELECT owner_id, created_by FROM deals WHERE id = ?', j.deal_id) : null;
  return !!d && (d.owner_id === u.id || d.created_by === u.id);
}
const jobOwnSql = (u) => (scope(u, 'jobs') === 'all' ? '1=1'
  : `((',' || j.installer_ids || ',') LIKE '%,${u.id},%' OR j.lead_installer_id = ${u.id} OR j.created_by = ${u.id} OR j.deal_id IN (SELECT id FROM deals WHERE owner_id = ${u.id} OR created_by = ${u.id}))`);

// After-sales follow-ups (unique: don't add the same kind twice for the same record)
function addFollowup(ctx, f) {
  if (f.unique) {
    const keyCol = f.quote_id ? 'quote_id' : f.invoice_id ? 'invoice_id' : f.warranty_id ? 'warranty_id' : f.job_id ? 'job_id' : null;
    if (keyCol && get(`SELECT id FROM followups WHERE type = ? AND ${keyCol} = ? AND status = 'pending'`, f.type, f[keyCol])) return null;
  }
  const r = run(`INSERT INTO followups (type, title, note, due_date, assigned_to, contact_id, deal_id, job_id, warranty_id, invoice_id, quote_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    f.type, f.title || FOLLOWUP_LABEL[f.type], f.note || '', f.due_date, f.assigned_to || null, f.contact_id || null, f.deal_id || null, f.job_id || null, f.warranty_id || null, f.invoice_id || null, f.quote_id || null);
  if (ctx) ctx.broadcast('warranty', 'followups');
  return Number(r.lastInsertRowid);
}

function jobScopeFromDeal(dealId) {
  const q = get(`SELECT * FROM quotes WHERE deal_id = ? AND status = 'accepted' ORDER BY id DESC LIMIT 1`, dealId)
    || get(`SELECT * FROM quotes WHERE deal_id = ? AND status != 'rejected' ORDER BY id DESC LIMIT 1`, dealId);
  const items = q ? all(`SELECT * FROM quote_items WHERE quote_id = ? AND kind = 'item' ORDER BY position`, q.id) : all(`SELECT * FROM deal_items WHERE deal_id = ? AND kind = 'item' ORDER BY position`, dealId);
  return { quote: q, items };
}

function register(ctx) {
  const { app, h, need, fail, clean, timeline, notify } = ctx;

  app.get('/api/jobs', need('jobs'), h((req) => {
    const q = req.query; const where = [jobOwnSql(req.user)]; const p = [];
    if (q.status === 'open') where.push(`j.status IN ('scheduled','on_the_way','in_progress','completed','on_hold')`);
    else if (q.status) { where.push('j.status = ?'); p.push(String(q.status)); }
    if (U.isDate(q.from)) { where.push('COALESCE(j.end_date, j.date) >= ?'); p.push(q.from); }
    if (U.isDate(q.to)) { where.push('j.date <= ?'); p.push(q.to); }
    if (q.mine) where.push(`((',' || j.installer_ids || ',') LIKE '%,${req.user.id},%' OR j.lead_installer_id = ${req.user.id})`);
    if (q.q) { where.push('(j.number LIKE ? OR j.title LIKE ? OR c.name LIKE ? OR j.address LIKE ?)'); p.push(...Array(4).fill(`%${q.q}%`)); }
    const rows = all(`SELECT j.*, c.name contact_name, c.phone contact_phone, d.code deal_code,
      (SELECT COUNT(*) FROM files f WHERE f.entity = 'job' AND f.entity_id = j.id AND f.kind IN ('before','after')) photos
      FROM jobs j LEFT JOIN contacts c ON c.id = j.contact_id LEFT JOIN deals d ON d.id = j.deal_id
      WHERE ${where.join(' AND ')} ORDER BY COALESCE(j.date, '9999'), j.start_time LIMIT 1000`, ...p);
    return { jobs: rows.map((j) => ({ ...j, sign_token: undefined, installers: installersOf(j), scope: JSON.parse(j.scope || '[]') })) };
  }));

  function scheduleValues(b) {
    const f = {};
    if (b.title !== undefined) f.title = clean(b.title, 200);
    for (const k of ['date', 'end_date']) if (b[k] !== undefined) f[k] = U.isDate(b[k]) ? b[k] : null;
    for (const k of ['start_time', 'end_time']) if (b[k] !== undefined) f[k] = /^\d{2}:\d{2}$/.test(b[k]) ? b[k] : null;
    if (b.installer_ids !== undefined) f.installer_ids = (Array.isArray(b.installer_ids) ? b.installer_ids : ids(b.installer_ids)).map(Number).filter((id) => get('SELECT id FROM users WHERE id = ? AND active = 1', id)).join(',');
    if (b.lead_installer_id !== undefined) f.lead_installer_id = Number(b.lead_installer_id) || null;
    for (const k of ['instructions', 'address', 'location_url']) if (b[k] !== undefined) f[k] = clean(b[k], k === 'instructions' ? 3000 : 500);
    if (f.end_date && f.date && f.end_date < f.date) f.end_date = f.date;
    return f;
  }
  app.post('/api/jobs', need('jobs', 'create'), h((req) => {
    const b = req.body;
    const deal = b.deal_id ? get('SELECT * FROM deals WHERE id = ?', Number(b.deal_id)) : null;
    if (b.deal_id && !deal) fail(404, 'Deal not found');
    const contactId = deal?.contact_id || Number(b.contact_id) || null;
    if (!contactId) fail(400, 'Pick the deal or customer');
    const contact = get('SELECT * FROM contacts WHERE id = ?', contactId);
    const f = scheduleValues(b);
    const { items } = deal ? jobScopeFromDeal(deal.id) : { items: [] };
    const scopeList = items.map((i) => ({ name: i.name, description: i.description, qty: i.qty, unit: i.unit, product_id: i.product_id }));
    const wastage = U.num(S.docs().wastage_pct);
    const id = tx(() => {
      const jid = Number(run(`INSERT INTO jobs (number, deal_id, contact_id, title, address, location_url, date, end_date, start_time, end_time, installer_ids, lead_installer_id, instructions, scope, checklist, sign_token, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, U.nextNumber('job'), deal?.id || null, contactId,
      f.title || `${deal?.service || 'Window film installation'} — ${contact.name}`,
      f.address ?? ([deal?.address || contact.address, deal?.area || contact.area, deal?.city || contact.city].filter(Boolean).join(', ')),
      f.location_url ?? (deal?.location_url || contact.location_url || ''), f.date || null, f.end_date || null, f.start_time || null, f.end_time || null,
      f.installer_ids || '', f.lead_installer_id || null, f.instructions || '', JSON.stringify(scopeList),
      JSON.stringify(S.lists().job_checklist.map((text) => ({ text, done: false }))), U.token(), req.user.id).lastInsertRowid);
      // film to take: the quoted SQM plus the cutting allowance
      const byProduct = new Map();
      for (const i of items) {
        const p = i.product_id ? get('SELECT * FROM products WHERE id = ?', i.product_id) : null;
        if (!p || !p.track_stock) continue;
        byProduct.set(p.id, U.r2((byProduct.get(p.id) || 0) + i.qty * (/sqm/i.test(p.unit) ? 1 + wastage / 100 : 1)));
      }
      for (const [pid, qty] of byProduct) run('INSERT INTO job_materials (job_id, product_id, planned_qty) VALUES (?, ?, ?)', jid, pid, qty);
      return jid;
    });
    const job = get('SELECT * FROM jobs WHERE id = ?', id);
    if (deal) timeline('deal', deal.id, req.user.id, 'system', `Installation ${job.number} ${job.date ? `scheduled for ${job.date}${job.start_time ? ` ${job.start_time}` : ''}` : 'created (not scheduled yet)'}`);
    timeline('job', id, req.user.id, 'system', 'Job created');
    notify(installersOf(job), { type: 'job', title: `🛠 New installation: ${job.title}`, body: `${job.date || 'Date to be confirmed'}${job.start_time ? ` ${job.start_time}` : ''} · ${job.address}`, link: `jobs/${id}` }, { exclude: req.user.id });
    ctx.broadcast('jobs', 'jobs'); ctx.emitTo(installersOf(job), 'jobs');
    return { job };
  }));
  function loadJob(user, id) {
    const j = get('SELECT * FROM jobs WHERE id = ?', id);
    if (!canSeeJob(user, j)) fail(404, 'Job not found');
    return j;
  }
  ctx.loadJob = loadJob;
  app.get('/api/jobs/:id', need('jobs'), h((req) => {
    const j = loadJob(req.user, req.params.id);
    const c = j.contact_id ? get('SELECT id, name, contact_person, phone, whatsapp, email, address, area, city, location_url FROM contacts WHERE id = ?', j.contact_id) : null;
    const base = (process.env.APP_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
    return {
      job: { ...j, scope: JSON.parse(j.scope || '[]'), checklist: JSON.parse(j.checklist || '[]'), installers: installersOf(j), sign_url: `${base}/doc/signoff/${j.sign_token}`, sign_token: undefined },
      contact: c,
      deal: j.deal_id ? get('SELECT id, code, title, owner_id FROM deals WHERE id = ?', j.deal_id) : null,
      materials: all('SELECT m.*, p.name, p.code, p.unit FROM job_materials m JOIN products p ON p.id = m.product_id WHERE job_id = ?', j.id).map((m) => ({ ...m, stock: catalog.stockOf(m.product_id) })),
      files: all(`SELECT id, kind, name, mime, size, user_id, created_at FROM files WHERE entity = 'job' AND entity_id = ? ORDER BY id`, j.id),
      timeline: all(`SELECT t.*, u.name user_name FROM timeline t LEFT JOIN users u ON u.id = t.user_id WHERE entity = 'job' AND entity_id = ? ORDER BY id DESC`, j.id),
      warranties: all('SELECT w.*, p.name product_name FROM warranties w LEFT JOIN products p ON p.id = w.product_id WHERE job_id = ?', j.id).map((w) => ({ ...w, url: `${base}/doc/warranty/${w.token}` })),
      expenses: can(req.user, 'expenses') ? all('SELECT e.*, a.name category FROM expenses e LEFT JOIN accounts a ON a.id = e.account_id WHERE job_id = ?', j.id) : [],
    };
  }));
  app.patch('/api/jobs/:id', need('jobs', 'edit'), h((req) => {
    const j = loadJob(req.user, req.params.id);
    const b = req.body;
    const manager = scope(req.user, 'jobs') === 'all' || can(req.user, 'jobs', 'create');
    const f = manager ? scheduleValues(b) : {};
    if (b.status && ['scheduled', 'on_hold', 'cancelled'].includes(b.status) && manager) f.status = b.status;
    const keys = Object.keys(f);
    if (!keys.length) return { ok: true };
    run(`UPDATE jobs SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = datetime('now') WHERE id = ?`, ...keys.map((k) => f[k]), j.id);
    const n = get('SELECT * FROM jobs WHERE id = ?', j.id);
    const moved = (f.date !== undefined && f.date !== j.date) || (f.start_time !== undefined && f.start_time !== j.start_time);
    if (moved) {
      timeline('job', j.id, req.user.id, 'system', `Rescheduled to ${n.date || 'TBC'}${n.start_time ? ` ${n.start_time}` : ''}`);
      if (j.deal_id) timeline('deal', j.deal_id, req.user.id, 'system', `Installation ${j.number} rescheduled to ${n.date || 'TBC'}`);
      run(`UPDATE jobs SET reminded = '' WHERE id = ?`, j.id);
    }
    const added = installersOf(n).filter((id) => !installersOf(j).includes(id));
    if (added.length) notify(added, { type: 'job', title: `🛠 Installation assigned to you: ${n.title}`, body: `${n.date || 'Date TBC'}${n.start_time ? ` ${n.start_time}` : ''} · ${n.address}`, link: `jobs/${j.id}` }, { exclude: req.user.id });
    if (moved) notify(installersOf(n).filter((id) => !added.includes(id)), { type: 'job', title: `📅 Job moved: ${n.title}`, body: `${n.date || 'TBC'}${n.start_time ? ` ${n.start_time}` : ''}`, link: `jobs/${j.id}` }, { exclude: req.user.id });
    if (f.status && f.status !== j.status) timeline('job', j.id, req.user.id, 'stage', `Status: ${STATUS_LABEL[f.status]}`);
    if (f.status === 'cancelled') catalog.releaseFor('job', j.id);
    ctx.broadcast('jobs', 'jobs', { id: j.id }); ctx.emitTo([...installersOf(n), ...installersOf(j)], 'jobs', { id: j.id });
    return { ok: true };
  }));
  app.delete('/api/jobs/:id', need('jobs', 'delete'), h((req) => {
    const j = loadJob(req.user, req.params.id);
    if (j.status === 'signed_off') fail(400, 'Signed-off jobs are kept for the warranty record');
    tx(() => {
      catalog.releaseFor('job', j.id);
      for (const f of all(`SELECT * FROM files WHERE entity = 'job' AND entity_id = ?`, j.id)) { ctx.removeStored(f.token); run('DELETE FROM files WHERE id = ?', f.id); }
      run("DELETE FROM timeline WHERE entity = 'job' AND entity_id = ?", j.id);
      run('DELETE FROM jobs WHERE id = ?', j.id);
    });
    if (j.deal_id) timeline('deal', j.deal_id, req.user.id, 'system', `Installation ${j.number} deleted`);
    ctx.broadcast('jobs', 'jobs');
    return { ok: true };
  }));

  // ---------- installer actions (phone) ----------
  app.post('/api/jobs/:id/status', need('jobs', 'edit'), h((req) => {
    const j = loadJob(req.user, req.params.id);
    const s = req.body.status;
    if (!['on_the_way', 'in_progress', 'completed', 'scheduled'].includes(s)) fail(400, 'Unknown status');
    if (['signed_off', 'cancelled'].includes(j.status)) fail(400, `This job is ${STATUS_LABEL[j.status].toLowerCase()}`);
    const lat = Number(req.body.lat) || null; const lng = Number(req.body.lng) || null;
    if (s === 'on_the_way') run(`UPDATE jobs SET status = ?, on_way_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`, s, j.id);
    if (s === 'in_progress') run(`UPDATE jobs SET status = ?, started_at = COALESCE(started_at, datetime('now')), start_lat = COALESCE(?, start_lat), start_lng = COALESCE(?, start_lng), updated_at = datetime('now') WHERE id = ?`, s, lat, lng, j.id);
    if (s === 'completed') run(`UPDATE jobs SET status = ?, completed_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`, s, j.id);
    if (s === 'scheduled') run(`UPDATE jobs SET status = ?, updated_at = datetime('now') WHERE id = ?`, s, j.id);
    timeline('job', j.id, req.user.id, 'stage', `${STATUS_LABEL[s]}${lat ? ` (location ${lat.toFixed(5)}, ${lng.toFixed(5)})` : ''}`);
    const deal = j.deal_id ? get('SELECT * FROM deals WHERE id = ?', j.deal_id) : null;
    if (deal) timeline('deal', deal.id, req.user.id, 'system', `Installation ${j.number}: ${STATUS_LABEL[s]}`);
    if (s === 'in_progress' || s === 'completed') {
      notify([deal?.owner_id, ...ctx.usersWith('jobs', 'create')], { type: 'job', title: s === 'completed' ? `✅ ${j.number} completed — waiting for customer sign-off` : `🛠 ${req.user.name} started ${j.number}`, body: j.title, link: `jobs/${j.id}` }, { exclude: req.user.id });
    }
    ctx.broadcast('jobs', 'jobs', { id: j.id }); ctx.emitTo(installersOf(j), 'jobs', { id: j.id });
    // a ready-made WhatsApp message for the customer
    const c = j.contact_id ? get('SELECT * FROM contacts WHERE id = ?', j.contact_id) : null;
    const msg = s === 'on_the_way' ? `Hello ${c?.contact_person || c?.name || ''}, this is ${req.user.name} from ${S.company().name}. Our installation team is on the way to your site for the window film installation (${j.number}).` : null;
    return { ok: true, whatsapp: msg && c ? `https://wa.me/${crm.normPhone(c.whatsapp || c.phone)}?text=${encodeURIComponent(msg)}` : null };
  }));
  app.patch('/api/jobs/:id/checklist', need('jobs', 'edit'), h((req) => {
    const j = loadJob(req.user, req.params.id);
    const list = JSON.parse(j.checklist || '[]');
    const i = Number(req.body.index);
    if (req.body.add) list.push({ text: clean(req.body.add, 200), done: false });
    else if (list[i]) Object.assign(list[i], { done: !!req.body.done, by: req.body.done ? req.user.id : null, at: req.body.done ? new Date().toISOString() : null });
    run(`UPDATE jobs SET checklist = ?, updated_at = datetime('now') WHERE id = ?`, JSON.stringify(list), j.id);
    ctx.emitTo([...installersOf(j)], 'jobs', { id: j.id });
    return { checklist: list };
  }));
  app.put('/api/jobs/:id/materials', need('jobs', 'edit'), h((req) => {
    const j = loadJob(req.user, req.params.id);
    if (j.status === 'signed_off' && !ctx.isAdmin(req.user)) fail(400, 'The job is signed off');
    for (const m of req.body.materials || []) {
      if (m.id) run('UPDATE job_materials SET used_qty = ? WHERE id = ? AND job_id = ?', m.used_qty === '' || m.used_qty === null ? null : U.num(m.used_qty), Number(m.id), j.id);
      else if (m.product_id && get('SELECT id FROM products WHERE id = ?', Number(m.product_id))) run('INSERT INTO job_materials (job_id, product_id, planned_qty, used_qty) VALUES (?, ?, ?, ?)', j.id, Number(m.product_id), 0, U.num(m.used_qty));
    }
    if (j.stock_done) consumeJobStock(ctx, get('SELECT * FROM jobs WHERE id = ?', j.id), req.user.id);
    ctx.emitTo(installersOf(j), 'jobs', { id: j.id });
    return { ok: true };
  }));
  app.post('/api/jobs/:id/notes', need('jobs'), h((req) => {
    const j = loadJob(req.user, req.params.id);
    const body = clean(req.body.body, 4000);
    if (!body) fail(400, 'Write something');
    timeline('job', j.id, req.user.id, 'note', body);
    ctx.emitTo(installersOf(j), 'jobs', { id: j.id });
    return { ok: true };
  }));

  // Customer sign-off on the installer's phone (signature drawn on screen)
  app.post('/api/jobs/:id/signoff', need('jobs', 'edit'), h((req) => {
    const j = loadJob(req.user, req.params.id);
    return signOff(ctx, j, req.body, req.user);
  }));

  ctx.fileAccess.job = (u, id, write) => { const j = get('SELECT * FROM jobs WHERE id = ?', id); return canSeeJob(u, j) && (!write || can(u, 'jobs', 'edit')); };

  // ======================= WARRANTIES =======================
  const wOwn = (u) => (scope(u, 'warranty') === 'all' ? '1=1' : `w.deal_id IN (SELECT id FROM deals WHERE owner_id = ${u.id} OR created_by = ${u.id}) OR w.job_id IN (SELECT id FROM jobs j WHERE ${jobOwnSql(u)})`);
  app.get('/api/warranties', need('warranty'), h((req) => {
    const q = req.query; const where = [`(${wOwn(req.user)})`]; const p = [];
    if (q.status === 'active') { where.push(`w.status = 'active' AND w.end_date >= ?`); p.push(U.today()); }
    if (q.status === 'expiring') { where.push(`w.status = 'active' AND w.end_date BETWEEN ? AND ?`); p.push(U.today(), U.addDays(U.today(), 90)); }
    if (q.status === 'expired') { where.push(`w.end_date < ?`); p.push(U.today()); }
    if (q.q) { where.push('(w.number LIKE ? OR c.name LIKE ? OR p.name LIKE ?)'); p.push(...Array(3).fill(`%${q.q}%`)); }
    const base = (process.env.APP_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
    return { warranties: all(`SELECT w.*, c.name contact_name, c.phone contact_phone, p.name product_name, j.number job_number FROM warranties w
      LEFT JOIN contacts c ON c.id = w.contact_id LEFT JOIN products p ON p.id = w.product_id LEFT JOIN jobs j ON j.id = w.job_id
      WHERE ${where.join(' AND ')} ORDER BY w.id DESC LIMIT 2000`, ...p).map((w) => ({ ...w, url: `${base}/doc/warranty/${w.token}` })) };
  }));
  app.post('/api/warranties', need('warranty', 'create'), h((req) => {
    const b = req.body;
    const contactId = Number(b.contact_id);
    if (!get('SELECT id FROM contacts WHERE id = ?', contactId)) fail(400, 'Pick the customer');
    const start = U.isDate(b.start_date) ? b.start_date : U.today();
    const years = Math.max(1, Math.round(U.num(b.years, 1)));
    const r = run(`INSERT INTO warranties (number, contact_id, deal_id, job_id, product_id, description, location, sqm, years, start_date, end_date, token, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      U.nextNumber('warranty'), contactId, Number(b.deal_id) || null, Number(b.job_id) || null, Number(b.product_id) || null, clean(b.description, 300), clean(b.location, 300),
      U.num(b.sqm), years, start, U.addYears(start, years), U.token(), clean(b.notes, 1000));
    ctx.broadcast('warranty', 'warranties');
    return { id: Number(r.lastInsertRowid) };
  }));
  app.patch('/api/warranties/:id', need('warranty', 'edit'), h((req) => {
    const w = get('SELECT * FROM warranties WHERE id = ?', req.params.id);
    if (!w) fail(404, 'Not found');
    const b = req.body; const f = {};
    if (b.status && ['active', 'void'].includes(b.status)) f.status = b.status;
    if (b.notes !== undefined) f.notes = clean(b.notes, 1000);
    if (b.location !== undefined) f.location = clean(b.location, 300);
    if (b.years !== undefined) { f.years = Math.max(1, Math.round(U.num(b.years))); f.end_date = U.addYears(w.start_date, f.years); }
    const keys = Object.keys(f);
    if (keys.length) run(`UPDATE warranties SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`, ...keys.map((k) => f[k]), w.id);
    ctx.broadcast('warranty', 'warranties');
    return { ok: true };
  }));

  // ---------- claims ----------
  app.get('/api/claims', need('warranty'), h((req) => {
    const where = scope(req.user, 'warranty') === 'all' ? '1=1' : `(cl.assigned_to = ${req.user.id} OR cl.created_by = ${req.user.id})`;
    return { claims: all(`SELECT cl.*, c.name contact_name, c.phone contact_phone, w.number warranty_number, w.end_date warranty_end, p.name product_name, u.name assigned_name, j.number job_number
      FROM claims cl LEFT JOIN contacts c ON c.id = cl.contact_id LEFT JOIN warranties w ON w.id = cl.warranty_id LEFT JOIN products p ON p.id = w.product_id
      LEFT JOIN users u ON u.id = cl.assigned_to LEFT JOIN jobs j ON j.id = cl.job_id WHERE ${where} ORDER BY cl.status = 'open' DESC, cl.id DESC LIMIT 1000`) };
  }));
  app.post('/api/claims', need('warranty', 'create'), h((req) => {
    const b = req.body;
    const w = b.warranty_id ? get('SELECT * FROM warranties WHERE id = ?', Number(b.warranty_id)) : null;
    const contactId = w?.contact_id || Number(b.contact_id);
    if (!contactId) fail(400, 'Pick the warranty or customer');
    if (!clean(b.issue, 2000)) fail(400, 'Describe the problem');
    const r = run('INSERT INTO claims (number, warranty_id, contact_id, date, issue, assigned_to, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)',
      U.nextNumber('claim'), w?.id || null, contactId, U.isDate(b.date) ? b.date : U.today(), clean(b.issue, 2000), Number(b.assigned_to) || null, req.user.id);
    const cl = get('SELECT * FROM claims WHERE id = ?', r.lastInsertRowid);
    notify([cl.assigned_to, ...ctx.usersWith('jobs', 'create')], { type: 'claim', title: `⚠️ Warranty claim ${cl.number}`, body: cl.issue, link: 'warranty' }, { exclude: req.user.id });
    ctx.broadcast('warranty', 'claims');
    return { claim: cl };
  }));
  app.patch('/api/claims/:id', need('warranty', 'edit'), h((req) => {
    const cl = get('SELECT * FROM claims WHERE id = ?', req.params.id);
    if (!cl) fail(404, 'Not found');
    const b = req.body; const f = {};
    if (b.status && ['open', 'inspecting', 'fixed', 'rejected'].includes(b.status)) f.status = b.status;
    if (b.resolution !== undefined) f.resolution = clean(b.resolution, 2000);
    if (b.assigned_to !== undefined) f.assigned_to = Number(b.assigned_to) || null;
    const keys = Object.keys(f);
    if (keys.length) run(`UPDATE claims SET ${keys.map((k) => `${k} = ?`).join(', ')}${['fixed', 'rejected'].includes(f.status) ? ", closed_at = datetime('now')" : ''} WHERE id = ?`, ...keys.map((k) => f[k]), cl.id);
    if (f.assigned_to && f.assigned_to !== cl.assigned_to) notify([f.assigned_to], { type: 'claim', title: `Warranty claim ${cl.number} assigned to you`, body: cl.issue, link: 'warranty' }, { exclude: req.user.id });
    ctx.broadcast('warranty', 'claims');
    return { ok: true };
  }));
  // A visit to inspect / fix a claim becomes a job for the installation team
  app.post('/api/claims/:id/job', need('jobs', 'create'), h((req) => {
    const cl = get('SELECT * FROM claims WHERE id = ?', req.params.id);
    if (!cl) fail(404, 'Not found');
    const w = cl.warranty_id ? get('SELECT * FROM warranties WHERE id = ?', cl.warranty_id) : null;
    const contact = get('SELECT * FROM contacts WHERE id = ?', cl.contact_id);
    const f = scheduleValues(req.body);
    const id = Number(run(`INSERT INTO jobs (number, deal_id, contact_id, title, address, location_url, date, start_time, installer_ids, lead_installer_id, instructions, scope, checklist, sign_token, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', ?, ?, ?)`, U.nextNumber('job'), w?.deal_id || null, contact.id, `Warranty visit ${cl.number} — ${contact.name}`,
    [contact.address, contact.area, contact.city].filter(Boolean).join(', '), contact.location_url, f.date || null, f.start_time || null, f.installer_ids || '', f.lead_installer_id || null,
    `Claim: ${cl.issue}`, JSON.stringify([{ text: 'Inspect the reported issue', done: false }, { text: 'Fix / replace the film if covered', done: false }, { text: 'Photos before and after', done: false }]), U.token(), req.user.id).lastInsertRowid);
    run(`UPDATE claims SET job_id = ?, status = 'inspecting' WHERE id = ?`, id, cl.id);
    const job = get('SELECT * FROM jobs WHERE id = ?', id);
    notify(installersOf(job), { type: 'job', title: `🛠 Warranty visit: ${contact.name}`, body: `${job.date || 'Date TBC'} · ${cl.issue}`, link: `jobs/${id}` }, { exclude: req.user.id });
    ctx.broadcast('jobs', 'jobs'); ctx.broadcast('warranty', 'claims');
    return { job_id: id };
  }));
  ctx.fileAccess.claim = (u, id, write) => can(u, 'warranty', write ? 'edit' : 'view') && !!get('SELECT id FROM claims WHERE id = ?', id);

  // ======================= FOLLOW-UPS =======================
  const fOwn = (u) => (scope(u, 'warranty') === 'all' || scope(u, 'crm') === 'all' ? '1=1' : `f.assigned_to = ${u.id}`);
  app.get('/api/followups', h((req) => {
    if (!can(req.user, 'warranty') && !can(req.user, 'crm')) fail(403, 'No access');
    const q = req.query; const where = [fOwn(req.user)]; const p = [];
    if (q.status === 'due') { where.push(`f.status = 'pending' AND f.due_date <= ?`); p.push(U.today()); }
    else if (q.status) { where.push('f.status = ?'); p.push(String(q.status)); }
    if (q.mine) where.push(`f.assigned_to = ${req.user.id}`);
    if (q.type) { where.push('f.type = ?'); p.push(String(q.type)); }
    return { followups: all(`SELECT f.*, c.name contact_name, c.phone contact_phone, c.whatsapp contact_whatsapp, u.name assigned_name, d.code deal_code, j.number job_number, w.number warranty_number, w.end_date warranty_end
      FROM followups f LEFT JOIN contacts c ON c.id = f.contact_id LEFT JOIN users u ON u.id = f.assigned_to LEFT JOIN deals d ON d.id = f.deal_id
      LEFT JOIN jobs j ON j.id = f.job_id LEFT JOIN warranties w ON w.id = f.warranty_id
      WHERE ${where.join(' AND ')} ORDER BY f.status = 'pending' DESC, f.due_date LIMIT 1000`, ...p) };
  }));
  app.post('/api/followups', h((req) => {
    if (!can(req.user, 'warranty', 'create') && !can(req.user, 'crm', 'create')) fail(403, 'No access');
    const b = req.body;
    if (!U.isDate(b.due_date)) fail(400, 'Pick a date');
    if (!clean(b.title, 200)) fail(400, 'Add a title');
    const id = addFollowup(ctx, { type: 'custom', title: clean(b.title, 200), note: clean(b.note, 1000), due_date: b.due_date, assigned_to: Number(b.assigned_to) || req.user.id, contact_id: Number(b.contact_id) || null, deal_id: Number(b.deal_id) || null });
    return { id };
  }));
  app.patch('/api/followups/:id', h((req) => {
    const f = get('SELECT * FROM followups WHERE id = ?', req.params.id);
    if (!f || !(fOwn(req.user) === '1=1' || f.assigned_to === req.user.id)) fail(404, 'Not found');
    const b = req.body; const u = {};
    if (b.status && ['pending', 'done', 'skipped'].includes(b.status)) u.status = b.status;
    if (b.outcome !== undefined) u.outcome = clean(b.outcome, 1000);
    if (b.due_date !== undefined && U.isDate(b.due_date)) u.due_date = b.due_date;
    if (b.assigned_to !== undefined) u.assigned_to = Number(b.assigned_to) || null;
    const keys = Object.keys(u);
    if (keys.length) run(`UPDATE followups SET ${keys.map((k) => `${k} = ?`).join(', ')}${u.status === 'done' ? `, done_at = datetime('now'), done_by = ${req.user.id}` : ''} WHERE id = ?`, ...keys.map((k) => u[k]), f.id);
    if (u.status === 'done' && f.contact_id) timeline('contact', f.contact_id, req.user.id, 'note', `${f.title} — done${u.outcome ? `: ${u.outcome}` : ''}`);
    if (u.status === 'done' && f.deal_id) timeline('deal', f.deal_id, req.user.id, 'note', `${f.title} — done${u.outcome ? `: ${u.outcome}` : ''}`);
    ctx.broadcast('warranty', 'followups'); ctx.emitTo([f.assigned_to], 'followups');
    return { ok: true };
  }));
  // Ready-made WhatsApp message for the follow-up (review request, check-in, inspection, warranty)
  app.post('/api/followups/:id/whatsapp', h((req) => {
    const f = get('SELECT * FROM followups WHERE id = ?', req.params.id);
    if (!f || !(fOwn(req.user) === '1=1' || f.assigned_to === req.user.id)) fail(404, 'Not found');
    const c = f.contact_id ? get('SELECT * FROM contacts WHERE id = ?', f.contact_id) : null;
    const co = S.company(); const a = S.automation();
    const name = c?.contact_person || c?.name || '';
    const w = f.warranty_id ? get('SELECT * FROM warranties WHERE id = ?', f.warranty_id) : null;
    const text = {
      review: `Hello ${name}, thank you for choosing ${co.name}! We hope you're enjoying your new window film. Could you spare a minute to leave us a review? It really helps us.${a.review_link ? `\n${a.review_link}` : ''}`,
      check_in: `Hello ${name}, this is ${req.user.name} from ${co.name}. It's been a few weeks since your window film installation — is everything performing well? Let us know if you need anything.`,
      inspection: `Hello ${name}, ${co.name} here. Your window film is due for a free inspection visit. When would be a good time for our team to come by?`,
      warranty_expiry: `Hello ${name}, ${co.name} here. The warranty on your window film${w ? ` (${w.number})` : ''} ends on ${w?.end_date || 'soon'}. We'd be happy to inspect the film or quote for an upgrade.`,
      quote: `Hello ${name}, ${req.user.name} from ${co.name} here. Just following up on the quotation we sent — do you have any questions, or shall we schedule the installation?`,
      payment: `Hello ${name}, ${co.name} here. A gentle reminder about the outstanding invoice. Please let us know once the payment is done. Thank you!`,
    }[f.type] || `Hello ${name}, ${co.name} here.`;
    return { link: `https://wa.me/${crm.normPhone(c?.whatsapp || c?.phone)}?text=${encodeURIComponent(text)}`, text };
  }));
}

// Sign-off from the installer's phone, or by the customer from the link
function signOff(ctx, j, b, user = null) {
  if (j.status === 'signed_off') ctx.fail(400, 'Already signed off');
  if (j.status === 'cancelled') ctx.fail(400, 'This job is cancelled');
  const name = ctx.clean(b.name, 120);
  if (!name) ctx.fail(400, 'Enter the customer’s name');
  const sig = String(b.signature || '');
  const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(sig);
  if (!m) ctx.fail(400, 'The customer needs to sign');
  const buf = Buffer.from(m[1], 'base64');
  if (buf.length < 500 || buf.length > 2 * 1048576) ctx.fail(400, 'The customer needs to sign');
  const fs = require('node:fs'); const path = require('node:path'); const crypto = require('node:crypto');
  const tok = crypto.randomBytes(16).toString('hex');
  fs.writeFileSync(path.join(ctx.UPLOAD_DIR, tok), buf);
  const rating = Math.min(5, Math.max(0, Math.round(U.num(b.rating)))) || null;
  const today = U.today();
  tx(() => {
    const fid = Number(run('INSERT INTO files (token, entity, entity_id, kind, name, mime, size, user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      tok, 'job', j.id, 'signature', `Signature — ${name}.png`, 'image/png', buf.length, user?.id || null).lastInsertRowid);
    run(`UPDATE jobs SET status = 'signed_off', signed_name = ?, signed_at = datetime('now'), signature_file_id = ?, rating = ?, feedback = ?,
      completed_at = COALESCE(completed_at, datetime('now')), updated_at = datetime('now') WHERE id = ?`, name, fid, rating, ctx.clean(b.feedback, 2000), j.id);
    if (S.docs().stock_mode === 'job') consumeJobStock(ctx, get('SELECT * FROM jobs WHERE id = ?', j.id), user?.id || null);
    createWarranties(ctx, get('SELECT * FROM jobs WHERE id = ?', j.id), today);
    afterSales(ctx, get('SELECT * FROM jobs WHERE id = ?', j.id), today);
  });
  ctx.timeline('job', j.id, user?.id || null, 'stage', `Signed off by ${name}${rating ? ` · ${'★'.repeat(rating)}` : ''}${b.feedback ? ` — “${ctx.clean(b.feedback, 300)}”` : ''}`);
  const deal = j.deal_id ? get('SELECT * FROM deals WHERE id = ?', j.deal_id) : null;
  if (deal) ctx.timeline('deal', deal.id, user?.id || null, 'stage', `Installation ${j.number} signed off by the customer (${name})`);
  const due = deal ? U.r2((get(`SELECT COALESCE(SUM(subtotal - discount), 0) n FROM quotes WHERE deal_id = ? AND status = 'accepted'`, deal.id).n)
    - get(`SELECT COALESCE(SUM(subtotal - discount), 0) n FROM invoices WHERE deal_id = ? AND status != 'cancelled'`, deal.id).n) : 0;
  ctx.notify([deal?.owner_id, ...ctx.managers(), ...(due > 0 ? ctx.usersWith('invoices', 'create') : [])], {
    type: 'job', title: `✍️ ${j.number} signed off by ${name}`, body: `${j.title}${rating ? ` · ${rating}/5` : ''}${due > 0 ? ` · ${U.fmtAED(due)} still to invoice` : ''}`, link: `jobs/${j.id}`,
  }, { exclude: user?.id });
  ctx.broadcast('jobs', 'jobs', { id: j.id }); ctx.emitTo(installersOf(j), 'jobs', { id: j.id });
  ctx.broadcast('warranty', 'warranties');
  return { ok: true };
}
function consumeJobStock(ctx, j, userId) {
  const mats = all('SELECT * FROM job_materials WHERE job_id = ?', j.id);
  catalog.consumeFor(ctx, 'job', j.id, mats.map((m) => ({ product_id: m.product_id, qty: m.used_qty ?? m.planned_qty })), { userId, note: `Installation ${j.number}` });
  run('UPDATE jobs SET stock_done = 1 WHERE id = ?', j.id);
}
function createWarranties(ctx, j, start) {
  if (get('SELECT id FROM warranties WHERE job_id = ?', j.id)) return;
  const byProduct = new Map();
  for (const s of JSON.parse(j.scope || '[]')) {
    const p = s.product_id ? get('SELECT * FROM products WHERE id = ?', s.product_id) : null;
    if (!p || !p.warranty_years) continue;
    const prev = byProduct.get(p.id) || { p, sqm: 0, names: [] };
    prev.sqm += /sqm/i.test(s.unit) ? U.num(s.qty) : 0;
    if (s.description) prev.names.push(s.description);
    byProduct.set(p.id, prev);
  }
  for (const { p, sqm, names } of byProduct.values()) {
    run(`INSERT INTO warranties (number, job_id, deal_id, contact_id, product_id, description, location, sqm, years, start_date, end_date, token) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      U.nextNumber('warranty'), j.id, j.deal_id, j.contact_id, p.id, `${p.brand ? `${p.brand} ` : ''}${p.name}`, names.join('; ').slice(0, 300) || j.address, U.r2(sqm), p.warranty_years, start, U.addYears(start, p.warranty_years), U.token());
  }
}
function afterSales(ctx, j, today) {
  const a = S.automation();
  const owner = j.deal_id ? get('SELECT owner_id FROM deals WHERE id = ?', j.deal_id)?.owner_id : j.created_by;
  const base = { contact_id: j.contact_id, deal_id: j.deal_id, job_id: j.id, assigned_to: owner, unique: true };
  if (a.review_on) addFollowup(ctx, { ...base, type: 'review', due_date: U.addDays(today, Number(a.review_days) || 2) });
  if (a.checkin_on) addFollowup(ctx, { ...base, type: 'check_in', due_date: U.addDays(today, Number(a.checkin_days) || 30) });
  if (a.inspection_on) addFollowup(ctx, { ...base, type: 'inspection', due_date: U.addDays(today, Math.round((Number(a.inspection_months) || 6) * 30.4)) });
  if (a.warranty_on) {
    for (const w of all('SELECT * FROM warranties WHERE job_id = ?', j.id)) {
      addFollowup(ctx, { ...base, job_id: null, warranty_id: w.id, type: 'warranty_expiry', title: `Warranty ${w.number} ends ${w.end_date}`, due_date: U.addDays(w.end_date, -(Number(a.warranty_days) || 30)) });
    }
  }
}

module.exports = { register, signOff, canSeeJob, installersOf, addFollowup, STATUS_LABEL, FOLLOWUP_LABEL, consumeJobStock };
