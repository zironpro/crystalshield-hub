// Quotations (from the deal's pricing sheet), invoices (from an accepted quotation: full, advance % or
// balance), customer payments and receipts. Issuing an invoice / recording a payment posts to the books.
const { all, get, run, tx } = require('./db');
const U = require('./util');
const S = require('./settings');
const books = require('./accounting');
const crm = require('./crm');
const catalog = require('./catalog');
const { can, scope } = require('./perms');

const QUOTE_STATUSES = ['draft', 'sent', 'accepted', 'rejected', 'expired'];

function totals(items, discount, vatRate) {
  const lines = items.filter((i) => i.kind !== 'header');
  const subtotal = U.r2(lines.reduce((s, i) => s + U.num(i.qty) * U.num(i.price), 0));
  const cost = U.r2(lines.reduce((s, i) => s + U.num(i.qty) * U.num(i.cost), 0));
  const disc = Math.min(Math.max(U.r2(discount), 0), Math.max(subtotal, 0));
  const vat = U.r2((subtotal - disc) * U.num(vatRate) / 100);
  return { subtotal, discount: disc, vat, total: U.r2(subtotal - disc + vat), cost_total: cost };
}

// ---------- access ----------
function dealOwned(u, dealId) { const d = dealId ? get('SELECT owner_id, created_by FROM deals WHERE id = ?', dealId) : null; return !!d && (d.owner_id === u.id || d.created_by === u.id); }
function canSeeQuote(u, q) {
  const s = scope(u, 'quotes');
  return !!q && (s === 'all' || (s === 'own' && (q.owner_id === u.id || q.created_by === u.id || dealOwned(u, q.deal_id))));
}
function canSeeInvoice(u, i) {
  const s = scope(u, 'invoices');
  return !!i && (s === 'all' || (s === 'own' && (i.created_by === u.id || dealOwned(u, i.deal_id))));
}
const quoteOwnSql = (u) => (scope(u, 'quotes') === 'all' ? '1=1' : `(q.owner_id = ${u.id} OR q.created_by = ${u.id} OR q.deal_id IN (SELECT id FROM deals WHERE owner_id = ${u.id} OR created_by = ${u.id}))`);
const invOwnSql = (u) => (scope(u, 'invoices') === 'all' ? '1=1' : `(i.created_by = ${u.id} OR i.deal_id IN (SELECT id FROM deals WHERE owner_id = ${u.id} OR created_by = ${u.id}))`);

function appUrl(req) { return (process.env.APP_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, ''); }
const waNumber = (p) => crm.normPhone(p);

// ---------- invoices: books & stock ----------
function postInvoice(ctx, inv, userId) {
  books.post({
    source: 'invoice', source_id: inv.id, date: inv.date, user_id: userId,
    description: `Invoice ${inv.number}${inv.contact_id ? ` · ${get('SELECT name FROM contacts WHERE id = ?', inv.contact_id)?.name || ''}` : ''}`,
    lines: [
      { key: 'ar', debit: inv.total, party: `contact:${inv.contact_id}` },
      { key: 'sales', credit: U.r2(inv.subtotal - inv.discount) },
      { key: 'vat_out', credit: inv.vat },
    ],
  });
  // stock leaves when the invoice is issued — unless installations on this deal take care of it
  const mode = S.docs().stock_mode;
  const hasJob = inv.deal_id && get(`SELECT id FROM jobs WHERE deal_id = ? AND status != 'cancelled'`, inv.deal_id);
  if (inv.kind === 'standard' && (mode === 'invoice' || !hasJob)) {
    const lines = all("SELECT product_id, qty FROM invoice_items WHERE invoice_id = ? AND kind = 'item' AND product_id IS NOT NULL", inv.id);
    catalog.consumeFor(ctx, 'invoice', inv.id, lines, { date: inv.date, userId, note: `Invoice ${inv.number}` });
  }
}
function refreshPaid(invoiceId) {
  const inv = get('SELECT * FROM invoices WHERE id = ?', invoiceId);
  const paid = U.r2(get('SELECT COALESCE(SUM(amount), 0) p FROM payments WHERE invoice_id = ?', invoiceId).p);
  let status = inv.status;
  if (!['draft', 'cancelled'].includes(status)) status = paid >= inv.total - 0.009 ? 'paid' : paid > 0 ? 'partial' : 'unpaid';
  run('UPDATE invoices SET paid = ?, status = ? WHERE id = ?', paid, status, invoiceId);
  return { paid, status };
}

function register(ctx) {
  const { app, h, ha, need, fail, clean, timeline, notify } = ctx;

  // ======================= QUOTATIONS =======================
  app.get('/api/quotes', need('quotes'), h((req) => {
    const q = req.query; const where = [quoteOwnSql(req.user)]; const p = [];
    if (q.status) { where.push('q.status = ?'); p.push(String(q.status)); }
    if (q.deal) { where.push('q.deal_id = ?'); p.push(Number(q.deal)); }
    if (U.isDate(q.from)) { where.push('q.date >= ?'); p.push(q.from); }
    if (U.isDate(q.to)) { where.push('q.date <= ?'); p.push(q.to); }
    if (q.q) { where.push('(q.number LIKE ? OR q.subject LIKE ? OR c.name LIKE ?)'); p.push(...Array(3).fill(`%${q.q}%`)); }
    const rows = all(`SELECT q.*, c.name contact_name, d.code deal_code, d.title deal_title, u.name owner_name FROM quotes q
      LEFT JOIN contacts c ON c.id = q.contact_id LEFT JOIN deals d ON d.id = q.deal_id LEFT JOIN users u ON u.id = q.owner_id
      WHERE ${where.join(' AND ')} ORDER BY q.id DESC LIMIT 1000`, ...p);
    const costs = can(req.user, 'see_costs');
    return { quotes: rows.map((r) => ({ ...r, token: undefined, cost_total: costs ? r.cost_total : undefined })) };
  }));

  function createQuote(req, { deal, contactId, items, extra = {} }) {
    const d = S.docs();
    const date = U.isDate(extra.date) ? extra.date : U.today();
    const contact = contactId ? get('SELECT * FROM contacts WHERE id = ?', contactId) : null;
    const ms = deal ? all('SELECT * FROM measurements WHERE deal_id = ?', deal.id) : [];
    const t = totals(items, 0, d.vat_rate);
    return tx(() => {
      const r = run(`INSERT INTO quotes (number, deal_id, contact_id, subject, date, valid_until, attention, site_location, glass_location, glass_area, intro, remarks, terms,
        vat_rate, subtotal, vat, total, cost_total, token, owner_id, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      U.nextNumber('quote'), deal?.id || null, contact?.id || null,
      clean(extra.subject, 200) || `Supply & Installation of ${deal?.service || 'Window Film'}`,
      date, U.addDays(date, Number(d.quote_valid_days) || 15),
      contact ? (contact.type === 'business' ? contact.contact_person || contact.name : contact.name) : '',
      [deal?.address, deal?.area, deal?.city].filter(Boolean).join(', ') || [contact?.address, contact?.area, contact?.city].filter(Boolean).join(', '),
      [...new Set(ms.map((m) => m.location.split(/[–—-]/)[0].trim()).filter(Boolean))].slice(0, 6).join(', '),
      U.r2(ms.reduce((s, m) => s + m.sqm, 0)), d.quote_intro, d.quote_remarks, d.quote_terms,
      d.vat_rate, t.subtotal, t.vat, t.total, t.cost_total, U.token(), deal?.owner_id || req.user.id, req.user.id);
      const id = Number(r.lastInsertRowid);
      items.forEach((it, i) => run('INSERT INTO quote_items (quote_id, position, kind, product_id, name, description, qty, unit, price, cost, vendor_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        id, i, it.kind === 'header' ? 'header' : 'item', it.product_id || null, it.name || '', it.description || '', U.num(it.qty), it.unit || 'SQM', U.num(it.price), U.num(it.cost), it.vendor_id || null));
      const q = get('SELECT * FROM quotes WHERE id = ?', id);
      if (deal) { timeline('deal', deal.id, req.user.id, 'document', `Quotation ${q.number} created · ${U.fmtAED(q.total)}`, { quote_id: id }); crm.refreshDealValue(deal.id); }
      ctx.broadcast('quotes', 'quotes'); ctx.broadcast('crm', 'deals', { id: deal?.id });
      return q;
    });
  }
  // From a deal's pricing sheet (one click), or blank for a customer
  app.post('/api/quotes', need('quotes', 'create'), h((req) => {
    const b = req.body;
    if (b.deal_id) {
      const deal = ctx.loadDeal(req.user, Number(b.deal_id));
      const items = all('SELECT * FROM deal_items WHERE deal_id = ? ORDER BY position, id', deal.id);
      if (!items.some((i) => i.kind === 'item')) fail(400, 'Add items to the pricing sheet first');
      return { quote: createQuote(req, { deal, contactId: deal.contact_id, items, extra: b }) };
    }
    const contactId = Number(b.contact_id);
    if (!contactId || !get('SELECT id FROM contacts WHERE id = ?', contactId)) fail(400, 'Pick the customer');
    return { quote: createQuote(req, { deal: null, contactId, items: [], extra: b }) };
  }));
  function loadQuote(user, id) {
    const q = get('SELECT * FROM quotes WHERE id = ?', id);
    if (!canSeeQuote(user, q)) fail(404, 'Quotation not found');
    return q;
  }
  app.get('/api/quotes/:id', need('quotes'), h((req) => {
    const q = loadQuote(req.user, req.params.id);
    const costs = can(req.user, 'see_costs');
    const items = all('SELECT qi.*, p.code product_code, p.image_file_id, v.name vendor_name FROM quote_items qi LEFT JOIN products p ON p.id = qi.product_id LEFT JOIN vendors v ON v.id = qi.vendor_id WHERE quote_id = ? ORDER BY position, id', q.id)
      .map((i) => ({ ...i, image: i.image_file_id ? `/api/public/product-image/${i.image_file_id}` : null, ...(costs ? {} : { cost: undefined, vendor_id: undefined, vendor_name: undefined }) }));
    return {
      quote: { ...q, cost_total: costs ? q.cost_total : undefined, url: `${appUrl(req)}/doc/quote/${q.token}` },
      items,
      contact: q.contact_id ? get('SELECT * FROM contacts WHERE id = ?', q.contact_id) : null,
      deal: q.deal_id ? get('SELECT id, code, title, stage, owner_id FROM deals WHERE id = ?', q.deal_id) : null,
      invoices: can(req.user, 'invoices') ? all('SELECT id, number, kind, date, status, total, paid FROM invoices WHERE quote_id = ? ORDER BY id', q.id) : [],
      invoiced: U.r2(get(`SELECT COALESCE(SUM(subtotal - discount), 0) n FROM invoices WHERE quote_id = ? AND status != 'cancelled'`, q.id).n),
      timeline: all(`SELECT t.*, u.name user_name FROM timeline t LEFT JOIN users u ON u.id = t.user_id WHERE entity = 'quote' AND entity_id = ? ORDER BY id DESC`, q.id),
    };
  }));
  app.put('/api/quotes/:id', need('quotes', 'edit'), h((req) => {
    const q = loadQuote(req.user, req.params.id);
    if (q.status === 'accepted' && !ctx.isAdmin(req.user)) fail(400, 'This quotation was accepted — duplicate it to make changes');
    const b = req.body;
    const costs = can(req.user, 'see_costs');
    const oldItems = all('SELECT * FROM quote_items WHERE quote_id = ?', q.id);
    let discount = b.discount !== undefined ? U.num(b.discount) : q.discount;
    if (discount !== q.discount && !can(req.user, 'give_discount')) fail(403, 'Ask a manager to give a discount');
    const items = Array.isArray(b.items) ? b.items.slice(0, 200).map((it) => {
      const prev = it.id ? oldItems.find((o) => o.id === Number(it.id)) : null;
      const product = it.product_id ? get('SELECT * FROM products WHERE id = ?', Number(it.product_id)) : null;
      return {
        kind: it.kind === 'header' ? 'header' : 'item', product_id: product?.id || null, name: clean(it.name, 200) || product?.name || '',
        description: clean(it.description, 1000), qty: U.num(it.qty), unit: clean(it.unit, 12) || 'SQM', price: U.num(it.price),
        cost: costs ? U.num(it.cost) : prev?.cost ?? product?.cost_price ?? 0, vendor_id: costs ? Number(it.vendor_id) || null : prev?.vendor_id ?? null,
      };
    }) : oldItems;
    const vatRate = b.vat_rate !== undefined ? U.num(b.vat_rate) : q.vat_rate;
    const t = totals(items, discount, vatRate);
    tx(() => {
      const f = {};
      for (const k of ['subject', 'attention', 'site_location', 'glass_location', 'intro', 'remarks', 'terms']) if (b[k] !== undefined) f[k] = clean(b[k], 4000);
      for (const k of ['date', 'valid_until']) if (b[k] !== undefined && U.isDate(b[k])) f[k] = b[k];
      if (b.glass_area !== undefined) f.glass_area = U.num(b.glass_area);
      if (b.show_images !== undefined) f.show_images = b.show_images ? 1 : 0;
      Object.assign(f, { discount: t.discount, vat_rate: vatRate, subtotal: t.subtotal, vat: t.vat, total: t.total, cost_total: t.cost_total });
      const keys = Object.keys(f);
      run(`UPDATE quotes SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = datetime('now') WHERE id = ?`, ...keys.map((k) => f[k]), q.id);
      if (Array.isArray(b.items)) {
        run('DELETE FROM quote_items WHERE quote_id = ?', q.id);
        items.forEach((it, i) => run('INSERT INTO quote_items (quote_id, position, kind, product_id, name, description, qty, unit, price, cost, vendor_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          q.id, i, it.kind, it.product_id, it.name, it.description, it.qty, it.unit, it.price, it.cost, it.vendor_id));
      }
    });
    if (q.deal_id) crm.refreshDealValue(q.deal_id);
    ctx.broadcast('quotes', 'quotes', { id: q.id }); ctx.broadcast('crm', 'deals', { id: q.deal_id });
    return { ok: true, totals: t };
  }));
  function setQuoteStatus(req, q, status, extra = {}) {
    if (!QUOTE_STATUSES.includes(status)) fail(400, 'Unknown status');
    const name = clean(extra.name, 120);
    run(`UPDATE quotes SET status = ?, updated_at = datetime('now'),
      sent_at = CASE WHEN ? = 'sent' AND sent_at IS NULL THEN datetime('now') ELSE sent_at END,
      accepted_at = CASE WHEN ? = 'accepted' THEN datetime('now') ELSE accepted_at END,
      accepted_name = CASE WHEN ? = 'accepted' THEN ? ELSE accepted_name END,
      rejected_reason = CASE WHEN ? = 'rejected' THEN ? ELSE rejected_reason END WHERE id = ?`,
    status, status, status, status, name || null, status, clean(extra.reason, 500), q.id);
    const userId = req?.user?.id || null;
    const label = { draft: 'back to draft', sent: 'sent to the customer', accepted: `accepted${name ? ` by ${name}` : ''}`, rejected: `rejected${extra.reason ? ` (${clean(extra.reason, 200)})` : ''}`, expired: 'expired' }[status];
    timeline('quote', q.id, userId, 'stage', `Quotation ${label}`);
    if (q.deal_id) {
      timeline('deal', q.deal_id, userId, 'document', `Quotation ${q.number} ${label}`);
      if (status === 'sent') crm.advanceDeal(ctx, q.deal_id, 'quoted', userId, `${q.number} sent`);
      if (status === 'accepted') crm.setStage(ctx, get('SELECT * FROM deals WHERE id = ?', q.deal_id), 'won', userId, `${q.number} accepted`);
      if (status === 'rejected') crm.advanceDeal(ctx, q.deal_id, 'negotiation', userId, `${q.number} rejected`);
      crm.refreshDealValue(q.deal_id);
    }
    const jobs = require('./jobs');
    if (status === 'sent' && S.automation().quote_on) jobs.addFollowup(ctx, {
      type: 'quote', title: `Follow up quotation ${q.number}`, due_date: U.addDays(U.today(), Number(S.automation().quote_days) || 3),
      assigned_to: q.owner_id, contact_id: q.contact_id, deal_id: q.deal_id, quote_id: q.id, unique: true,
    });
    if (['accepted', 'rejected'].includes(status)) run(`UPDATE followups SET status = 'done', done_at = datetime('now'), outcome = ? WHERE quote_id = ? AND status = 'pending'`, `Quotation ${status}`, q.id);
    if (!req) { // the customer did it from the link
      const deal = q.deal_id ? get('SELECT * FROM deals WHERE id = ?', q.deal_id) : null;
      notify([q.owner_id, deal?.owner_id, ...ctx.managers()], { type: 'quote', title: status === 'accepted' ? `✅ ${q.number} accepted by the customer` : `Quotation ${q.number} ${status} by the customer`, body: `${name || ''} ${extra.reason || ''}`.trim(), link: `quotes/${q.id}` });
    }
    ctx.broadcast('quotes', 'quotes', { id: q.id });
  }
  ctx.setQuoteStatus = setQuoteStatus;
  app.post('/api/quotes/:id/status', need('quotes', 'edit'), h((req) => {
    const q = loadQuote(req.user, req.params.id);
    if (req.body.status === 'rejected' && !clean(req.body.reason, 300)) fail(400, 'Add the reason');
    setQuoteStatus(req, q, req.body.status, req.body);
    return { ok: true };
  }));
  app.post('/api/quotes/:id/duplicate', need('quotes', 'create'), h((req) => {
    const q = loadQuote(req.user, req.params.id);
    const items = all('SELECT * FROM quote_items WHERE quote_id = ? ORDER BY position, id', q.id);
    const n = tx(() => {
      const copy = createQuote(req, { deal: q.deal_id ? get('SELECT * FROM deals WHERE id = ?', q.deal_id) : null, contactId: q.contact_id, items, extra: { subject: q.subject } });
      run('UPDATE quotes SET attention = ?, site_location = ?, glass_location = ?, glass_area = ?, intro = ?, remarks = ?, terms = ?, discount = ?, show_images = ? WHERE id = ?',
        q.attention, q.site_location, q.glass_location, q.glass_area, q.intro, q.remarks, q.terms, q.discount, q.show_images, copy.id);
      const t = totals(items, q.discount, q.vat_rate);
      run('UPDATE quotes SET subtotal = ?, vat = ?, total = ? WHERE id = ?', t.subtotal, t.vat, t.total, copy.id);
      timeline('quote', copy.id, req.user.id, 'system', `Copied from ${q.number}`);
      return copy;
    });
    return { quote: n };
  }));
  app.delete('/api/quotes/:id', need('quotes', 'delete'), h((req) => {
    const q = loadQuote(req.user, req.params.id);
    if (get(`SELECT id FROM invoices WHERE quote_id = ? AND status != 'cancelled'`, q.id)) fail(400, 'This quotation has invoices');
    run('DELETE FROM quotes WHERE id = ?', q.id);
    if (q.deal_id) { timeline('deal', q.deal_id, req.user.id, 'document', `Quotation ${q.number} deleted`); crm.refreshDealValue(q.deal_id); }
    ctx.broadcast('quotes', 'quotes');
    return { ok: true };
  }));

  // Send by WhatsApp (opens WhatsApp with the message ready) or by email
  function docMessage(req, kind, d, contact) {
    const co = S.company();
    const url = `${appUrl(req)}/doc/${kind}/${d.token}`;
    const greet = `Dear ${contact?.type === 'business' ? contact?.contact_person || contact?.name : contact?.name || 'Customer'},`;
    if (kind === 'quote') return { url, text: `${greet}\n\nThank you for your enquiry. Please find our quotation ${d.number} for ${U.fmtAED(d.total)} here:\n${url}\n\nYou can accept it online from the same link. For any questions, reply here or call ${co.phone}.\n\n${co.name}` };
    if (kind === 'invoice') return { url, text: `${greet}\n\nPlease find invoice ${d.number} for ${U.fmtAED(d.total)}${d.due_date ? `, due ${d.due_date}` : ''}:\n${url}\n\nThank you for choosing ${co.name}.` };
    return { url, text: `${greet}\n\nThank you for your payment. Your receipt ${d.number}:\n${url}\n\n${co.name}` };
  }
  ctx.docMessage = docMessage;
  app.post('/api/quotes/:id/whatsapp', need('quotes', 'edit'), h((req) => {
    const q = loadQuote(req.user, req.params.id);
    const c = q.contact_id ? get('SELECT * FROM contacts WHERE id = ?', q.contact_id) : null;
    const m = docMessage(req, 'quote', q, c);
    if (q.status === 'draft') setQuoteStatus(req, q, 'sent');
    timeline('quote', q.id, req.user.id, 'whatsapp', 'Sent by WhatsApp');
    return { link: `https://wa.me/${waNumber(c?.whatsapp || c?.phone)}?text=${encodeURIComponent(m.text)}`, text: m.text, url: m.url };
  }));
  app.post('/api/quotes/:id/email', need('quotes', 'edit'), ha(async (req) => {
    const q = loadQuote(req.user, req.params.id);
    const c = q.contact_id ? get('SELECT * FROM contacts WHERE id = ?', q.contact_id) : null;
    const to = clean(req.body.to, 200) || c?.email;
    if (!to || !/^\S+@\S+\.\S+$/.test(to)) fail(400, 'Add the customer’s email');
    const m = docMessage(req, 'quote', q, c);
    const text = clean(req.body.message, 4000) || m.text;
    await ctx.mail.sendDocument({ to, subject: `Quotation ${q.number} — ${S.company().name}`, text, html: docEmailHtml(text, m.url, 'View quotation'), replyTo: req.user.email });
    if (q.status === 'draft') setQuoteStatus(req, q, 'sent');
    timeline('quote', q.id, req.user.id, 'email', `Emailed to ${to}`);
    return { ok: true };
  }));

  // ======================= INVOICES =======================
  app.get('/api/invoices', need('invoices'), h((req) => {
    const q = req.query; const where = [invOwnSql(req.user)]; const p = [];
    if (q.status === 'open') where.push(`i.status IN ('unpaid','partial')`);
    else if (q.status === 'overdue') { where.push(`i.status IN ('unpaid','partial') AND i.due_date < ?`); p.push(U.today()); }
    else if (q.status) { where.push('i.status = ?'); p.push(String(q.status)); }
    if (q.contact) { where.push('i.contact_id = ?'); p.push(Number(q.contact)); }
    if (U.isDate(q.from)) { where.push('i.date >= ?'); p.push(q.from); }
    if (U.isDate(q.to)) { where.push('i.date <= ?'); p.push(q.to); }
    if (q.q) { where.push('(i.number LIKE ? OR c.name LIKE ? OR i.subject LIKE ?)'); p.push(...Array(3).fill(`%${q.q}%`)); }
    const rows = all(`SELECT i.*, c.name contact_name, c.phone contact_phone, d.code deal_code, qq.number quote_number FROM invoices i
      LEFT JOIN contacts c ON c.id = i.contact_id LEFT JOIN deals d ON d.id = i.deal_id LEFT JOIN quotes qq ON qq.id = i.quote_id
      WHERE ${where.join(' AND ')} ORDER BY i.id DESC LIMIT 1000`, ...p);
    return { invoices: rows.map((r) => ({ ...r, token: undefined, balance: U.r2(r.total - r.paid) })) };
  }));

  function insertInvoice(req, { quote, contactId, dealId, kind, items, discount, subject, date }) {
    const d = S.docs();
    const vatRate = quote ? quote.vat_rate : d.vat_rate;
    const t = totals(items, discount, vatRate);
    const invDate = U.isDate(date) ? date : U.today();
    return tx(() => {
      const r = run(`INSERT INTO invoices (number, quote_id, deal_id, contact_id, kind, subject, date, due_date, discount, vat_rate, subtotal, vat, total, terms, token, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, U.nextNumber('invoice'), quote?.id || null, dealId || null, contactId || null, kind,
      subject, invDate, U.addDays(invDate, Number(d.invoice_due_days) || 7), t.discount, vatRate, t.subtotal, t.vat, t.total, d.invoice_terms, U.token(), req.user.id);
      const id = Number(r.lastInsertRowid);
      items.forEach((it, i) => run('INSERT INTO invoice_items (invoice_id, position, kind, product_id, name, description, qty, unit, price, cost) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        id, i, it.kind === 'header' ? 'header' : 'item', it.product_id || null, it.name || '', it.description || '', U.num(it.qty), it.unit || 'SQM', U.num(it.price), U.num(it.cost)));
      const inv = get('SELECT * FROM invoices WHERE id = ?', id);
      if (dealId) timeline('deal', dealId, req.user.id, 'document', `Invoice ${inv.number} drafted · ${U.fmtAED(inv.total)}`, { invoice_id: id });
      if (quote) timeline('quote', quote.id, req.user.id, 'document', `Converted to invoice ${inv.number}`);
      ctx.broadcast('invoices', 'invoices');
      return inv;
    });
  }
  // Quotation → invoice without re-typing: full, an advance %, or the balance after advances
  app.post('/api/quotes/:id/invoice', need('invoices', 'create'), h((req) => {
    const q = loadQuote(req.user, req.params.id);
    if (q.status === 'draft' || q.status === 'rejected') fail(400, 'Send or accept the quotation first');
    const kind = ['standard', 'advance', 'balance'].includes(req.body.kind) ? req.body.kind : 'standard';
    const qItems = all('SELECT * FROM quote_items WHERE quote_id = ? ORDER BY position, id', q.id);
    const net = U.r2(q.subtotal - q.discount);
    const prior = all(`SELECT * FROM invoices WHERE quote_id = ? AND status != 'cancelled'`, q.id);
    const priorNet = U.r2(prior.reduce((s, i) => s + i.subtotal - i.discount, 0));
    if (priorNet >= net - 0.009) fail(400, 'This quotation is fully invoiced');
    let items; let discount = 0; let subject = q.subject;
    if (kind === 'advance') {
      const pct = Math.min(100, Math.max(1, U.num(req.body.percent, S.docs().advance_pct)));
      items = [{ kind: 'item', name: `Advance payment — ${pct}% of quotation ${q.number}`, description: q.subject, qty: 1, unit: 'LS', price: U.r2(net * pct / 100), cost: 0 }];
      subject = `${pct}% advance — ${q.subject}`;
    } else {
      items = qItems.map((i) => ({ ...i }));
      discount = q.discount;
      if (prior.length) {
        for (const p of prior) items.push({ kind: 'item', name: `Less: invoiced earlier (${p.number})`, description: '', qty: 1, unit: 'LS', price: -U.r2(p.subtotal - p.discount), cost: 0 });
        subject = `Balance — ${q.subject}`;
      }
    }
    const inv = insertInvoice(req, { quote: q, contactId: q.contact_id, dealId: q.deal_id, kind: prior.length && kind !== 'advance' ? 'balance' : kind, items, discount, subject });
    return { invoice: inv };
  }));
  app.post('/api/invoices', need('invoices', 'create'), h((req) => {
    const b = req.body;
    const contactId = Number(b.contact_id);
    if (!contactId || !get('SELECT id FROM contacts WHERE id = ?', contactId)) fail(400, 'Pick the customer');
    const inv = insertInvoice(req, { quote: null, contactId, dealId: Number(b.deal_id) || null, kind: 'standard', items: [], discount: 0, subject: clean(b.subject, 200) || 'Supply & installation of window film', date: b.date });
    return { invoice: inv };
  }));
  function loadInvoice(user, id) {
    const i = get('SELECT * FROM invoices WHERE id = ?', id);
    if (!canSeeInvoice(user, i)) fail(404, 'Invoice not found');
    return i;
  }
  app.get('/api/invoices/:id', need('invoices'), h((req) => {
    const i = loadInvoice(req.user, req.params.id);
    const costs = can(req.user, 'see_costs');
    return {
      invoice: { ...i, balance: U.r2(i.total - i.paid), url: `${appUrl(req)}/doc/invoice/${i.token}` },
      items: all('SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY position, id', i.id).map((x) => (costs ? x : { ...x, cost: undefined })),
      payments: all('SELECT p.*, a.name account_name, u.name user_name FROM payments p LEFT JOIN accounts a ON a.id = p.account_id LEFT JOIN users u ON u.id = p.created_by WHERE invoice_id = ? ORDER BY date, id', i.id)
        .map((p) => ({ ...p, url: `${appUrl(req)}/doc/receipt/${p.token}` })),
      contact: i.contact_id ? get('SELECT * FROM contacts WHERE id = ?', i.contact_id) : null,
      deal: i.deal_id ? get('SELECT id, code, title FROM deals WHERE id = ?', i.deal_id) : null,
      quote: i.quote_id ? get('SELECT id, number, total FROM quotes WHERE id = ?', i.quote_id) : null,
      journal: ctx.can(req.user, 'accounting') ? get(`SELECT id, number FROM journals WHERE source = 'invoice' AND source_id = ?`, i.id) : null,
      timeline: all(`SELECT t.*, u.name user_name FROM timeline t LEFT JOIN users u ON u.id = t.user_id WHERE entity = 'invoice' AND entity_id = ? ORDER BY id DESC`, i.id),
    };
  }));
  app.put('/api/invoices/:id', need('invoices', 'edit'), h((req) => {
    const i = loadInvoice(req.user, req.params.id);
    if (['cancelled'].includes(i.status)) fail(400, 'This invoice is cancelled');
    if (i.paid > 0 && Array.isArray(req.body.items)) fail(400, 'This invoice has payments — remove them before changing the items');
    const b = req.body;
    const old = all('SELECT * FROM invoice_items WHERE invoice_id = ?', i.id);
    const costs = can(req.user, 'see_costs');
    const items = Array.isArray(b.items) ? b.items.slice(0, 200).map((it) => {
      const prev = it.id ? old.find((o) => o.id === Number(it.id)) : null;
      const product = it.product_id ? get('SELECT * FROM products WHERE id = ?', Number(it.product_id)) : null;
      return { kind: it.kind === 'header' ? 'header' : 'item', product_id: product?.id || null, name: clean(it.name, 200) || product?.name || '', description: clean(it.description, 1000),
        qty: U.num(it.qty), unit: clean(it.unit, 12) || 'SQM', price: U.num(it.price), cost: costs ? U.num(it.cost) : prev?.cost ?? product?.cost_price ?? 0 };
    }) : old;
    const discount = b.discount !== undefined ? U.num(b.discount) : i.discount;
    if (discount !== i.discount && !can(req.user, 'give_discount') && !can(req.user, 'invoices', 'edit')) fail(403, 'No discount access');
    const vatRate = b.vat_rate !== undefined ? U.num(b.vat_rate) : i.vat_rate;
    const t = totals(items, discount, vatRate);
    if (i.paid > t.total + 0.009) fail(400, 'The total can’t be less than what was already paid');
    tx(() => {
      const f = {};
      for (const k of ['subject', 'notes', 'terms']) if (b[k] !== undefined) f[k] = clean(b[k], 4000);
      for (const k of ['date', 'due_date']) if (b[k] !== undefined && U.isDate(b[k])) f[k] = b[k];
      Object.assign(f, { discount: t.discount, vat_rate: vatRate, subtotal: t.subtotal, vat: t.vat, total: t.total });
      const keys = Object.keys(f);
      run(`UPDATE invoices SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`, ...keys.map((k) => f[k]), i.id);
      if (Array.isArray(b.items)) {
        run('DELETE FROM invoice_items WHERE invoice_id = ?', i.id);
        items.forEach((it, n) => run('INSERT INTO invoice_items (invoice_id, position, kind, product_id, name, description, qty, unit, price, cost) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          i.id, n, it.kind, it.product_id, it.name, it.description, it.qty, it.unit, it.price, it.cost));
      }
      const fresh = get('SELECT * FROM invoices WHERE id = ?', i.id);
      if (fresh.status !== 'draft') { postInvoice(ctx, fresh, req.user.id); refreshPaid(i.id); }
    });
    ctx.broadcast('invoices', 'invoices', { id: i.id });
    return { ok: true, totals: t };
  }));
  app.post('/api/invoices/:id/issue', need('invoices', 'edit'), h((req) => {
    const i = loadInvoice(req.user, req.params.id);
    if (i.status !== 'draft') fail(400, 'Already issued');
    if (!all("SELECT id FROM invoice_items WHERE invoice_id = ? AND kind = 'item'", i.id).length) fail(400, 'Add at least one item');
    if (i.total <= 0) fail(400, 'The invoice total must be more than zero');
    tx(() => {
      run(`UPDATE invoices SET status = 'unpaid', issued_at = datetime('now') WHERE id = ?`, i.id);
      postInvoice(ctx, get('SELECT * FROM invoices WHERE id = ?', i.id), req.user.id);
      refreshPaid(i.id);
    });
    timeline('invoice', i.id, req.user.id, 'stage', 'Invoice issued');
    if (i.deal_id) timeline('deal', i.deal_id, req.user.id, 'document', `Invoice ${i.number} issued · ${U.fmtAED(i.total)}`);
    ctx.broadcast('invoices', 'invoices', { id: i.id }); ctx.broadcast('crm', 'deals', { id: i.deal_id });
    return { ok: true };
  }));
  app.post('/api/invoices/:id/cancel', need('invoices', 'edit'), h((req) => {
    const i = loadInvoice(req.user, req.params.id);
    if (i.paid > 0) fail(400, 'Remove the payments first');
    tx(() => {
      run(`UPDATE invoices SET status = 'cancelled' WHERE id = ?`, i.id);
      books.unpost('invoice', i.id);
      catalog.releaseFor('invoice', i.id);
    });
    timeline('invoice', i.id, req.user.id, 'stage', `Invoice cancelled${req.body.reason ? `: ${clean(req.body.reason, 300)}` : ''}`);
    if (i.deal_id) timeline('deal', i.deal_id, req.user.id, 'document', `Invoice ${i.number} cancelled`);
    ctx.broadcast('invoices', 'invoices', { id: i.id });
    return { ok: true };
  }));
  app.delete('/api/invoices/:id', need('invoices', 'delete'), h((req) => {
    const i = loadInvoice(req.user, req.params.id);
    if (i.status !== 'draft') fail(400, 'Only drafts can be deleted — cancel issued invoices instead');
    run('DELETE FROM invoices WHERE id = ?', i.id);
    ctx.broadcast('invoices', 'invoices');
    return { ok: true };
  }));
  app.post('/api/invoices/:id/followup', need('invoices', 'edit'), h((req) => {
    const i = loadInvoice(req.user, req.params.id);
    const body = clean(req.body.body, 2000);
    if (body) timeline('invoice', i.id, req.user.id, ['call', 'whatsapp', 'email'].includes(req.body.kind) ? req.body.kind : 'note', body);
    if (req.body.next_follow_up !== undefined) run('UPDATE invoices SET next_follow_up = ? WHERE id = ?', U.isDate(req.body.next_follow_up) ? req.body.next_follow_up : null, i.id);
    return { ok: true };
  }));

  // ---------- payments ----------
  app.post('/api/invoices/:id/payments', need('invoices', 'edit'), h((req) => {
    const i = loadInvoice(req.user, req.params.id);
    if (['draft', 'cancelled'].includes(i.status)) fail(400, 'Issue the invoice first');
    const amount = U.r2(req.body.amount);
    if (amount <= 0) fail(400, 'Enter the amount received');
    if (amount > U.r2(i.total - i.paid) + 0.009) fail(400, `The balance is only ${U.fmtAED(i.total - i.paid)}`);
    const method = ['cash', 'bank', 'cheque', 'card', 'link'].includes(req.body.method) ? req.body.method : 'bank';
    const account = Number(req.body.account_id) && get('SELECT id FROM accounts WHERE id = ? AND is_money = 1', Number(req.body.account_id)) ? Number(req.body.account_id) : books.accountForMethod(method);
    const date = U.isDate(req.body.date) ? req.body.date : U.today();
    const out = tx(() => {
      const r = run('INSERT INTO payments (number, invoice_id, contact_id, date, amount, method, reference, account_id, notes, token, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        U.nextNumber('payment'), i.id, i.contact_id, date, amount, method, clean(req.body.reference, 120), account, clean(req.body.notes, 500), U.token(), req.user.id);
      const p = get('SELECT * FROM payments WHERE id = ?', r.lastInsertRowid);
      books.post({ source: 'payment', source_id: p.id, date, user_id: req.user.id, description: `Payment ${p.number} for ${i.number}`,
        lines: [{ account_id: account, debit: amount }, { key: 'ar', credit: amount, party: `contact:${i.contact_id}` }] });
      return { payment: p, ...refreshPaid(i.id) };
    });
    timeline('invoice', i.id, req.user.id, 'payment', `Payment received ${U.fmtAED(amount)} (${method}${req.body.reference ? ` · ${clean(req.body.reference, 60)}` : ''})`);
    if (i.deal_id) {
      timeline('deal', i.deal_id, req.user.id, 'payment', `${U.fmtAED(amount)} received against ${i.number}`);
      const d = get('SELECT owner_id, title FROM deals WHERE id = ?', i.deal_id);
      notify([d?.owner_id], { type: 'payment', title: `💰 ${U.fmtAED(amount)} received — ${d?.title}`, body: `${i.number} · ${out.status === 'paid' ? 'fully paid' : `balance ${U.fmtAED(i.total - out.paid)}`}`, link: `invoices/${i.id}` }, { exclude: req.user.id });
    }
    run(`UPDATE followups SET status = 'done', done_at = datetime('now'), outcome = 'Paid' WHERE invoice_id = ? AND status = 'pending' AND ? = 'paid'`, i.id, out.status);
    ctx.broadcast('invoices', 'invoices', { id: i.id }); ctx.broadcast('crm', 'deals', { id: i.deal_id });
    return out;
  }));
  app.delete('/api/payments/:id', need('invoices', 'delete'), h((req) => {
    const p = get('SELECT * FROM payments WHERE id = ?', req.params.id);
    if (!p) fail(404, 'Payment not found');
    const i = loadInvoice(req.user, p.invoice_id);
    tx(() => {
      run('DELETE FROM payments WHERE id = ?', p.id);
      books.unpost('payment', p.id);
      refreshPaid(i.id);
    });
    timeline('invoice', i.id, req.user.id, 'payment', `Payment ${p.number} (${U.fmtAED(p.amount)}) removed`);
    ctx.broadcast('invoices', 'invoices', { id: i.id });
    return { ok: true };
  }));
  app.get('/api/payments', need('invoices'), h((req) => {
    const where = [invOwnSql(req.user)]; const p = [];
    if (U.isDate(req.query.from)) { where.push('p.date >= ?'); p.push(req.query.from); }
    if (U.isDate(req.query.to)) { where.push('p.date <= ?'); p.push(req.query.to); }
    return { payments: all(`SELECT p.*, i.number invoice_number, c.name contact_name, a.name account_name FROM payments p JOIN invoices i ON i.id = p.invoice_id
      LEFT JOIN contacts c ON c.id = p.contact_id LEFT JOIN accounts a ON a.id = p.account_id WHERE ${where.join(' AND ')} ORDER BY p.date DESC, p.id DESC LIMIT 1000`, ...p).map((x) => ({ ...x, token: undefined })) };
  }));

  app.post('/api/invoices/:id/whatsapp', need('invoices'), h((req) => {
    const i = loadInvoice(req.user, req.params.id);
    if (i.status === 'draft') fail(400, 'Issue the invoice first');
    const c = i.contact_id ? get('SELECT * FROM contacts WHERE id = ?', i.contact_id) : null;
    const m = docMessage(req, 'invoice', i, c);
    run(`UPDATE invoices SET sent_at = COALESCE(sent_at, datetime('now')) WHERE id = ?`, i.id);
    timeline('invoice', i.id, req.user.id, 'whatsapp', 'Sent by WhatsApp');
    return { link: `https://wa.me/${waNumber(c?.whatsapp || c?.phone)}?text=${encodeURIComponent(m.text)}`, text: m.text, url: m.url };
  }));
  app.post('/api/invoices/:id/email', need('invoices'), ha(async (req) => {
    const i = loadInvoice(req.user, req.params.id);
    if (i.status === 'draft') fail(400, 'Issue the invoice first');
    const c = i.contact_id ? get('SELECT * FROM contacts WHERE id = ?', i.contact_id) : null;
    const to = clean(req.body.to, 200) || c?.email;
    if (!to || !/^\S+@\S+\.\S+$/.test(to)) fail(400, 'Add the customer’s email');
    const m = docMessage(req, 'invoice', i, c);
    const text = clean(req.body.message, 4000) || m.text;
    await ctx.mail.sendDocument({ to, subject: `Invoice ${i.number} — ${S.company().name}`, text, html: docEmailHtml(text, m.url, 'View invoice'), replyTo: req.user.email });
    run(`UPDATE invoices SET sent_at = COALESCE(sent_at, datetime('now')) WHERE id = ?`, i.id);
    timeline('invoice', i.id, req.user.id, 'email', `Emailed to ${to}`);
    return { ok: true };
  }));
  app.post('/api/payments/:id/whatsapp', need('invoices'), h((req) => {
    const p = get('SELECT * FROM payments WHERE id = ?', req.params.id);
    if (!p) fail(404, 'Payment not found');
    loadInvoice(req.user, p.invoice_id);
    const c = p.contact_id ? get('SELECT * FROM contacts WHERE id = ?', p.contact_id) : null;
    const m = docMessage(req, 'receipt', p, c);
    return { link: `https://wa.me/${waNumber(c?.whatsapp || c?.phone)}?text=${encodeURIComponent(m.text)}`, text: m.text, url: m.url };
  }));
}

function docEmailHtml(text, url, button) {
  const { escapeHtml } = require('./mail');
  const co = S.company();
  return `<div style="font-family:Inter,Arial,sans-serif;font-size:15px;color:#141c2f;max-width:560px">
    <p style="white-space:pre-wrap;margin:0 0 18px">${escapeHtml(text.replace(url, '').trim())}</p>
    <a href="${url}" style="background:#00386b;color:#fff;padding:11px 20px;border-radius:10px;text-decoration:none;display:inline-block">${button}</a>
    <p style="margin:24px 0 0;color:#6b7280;font-size:12px">${escapeHtml(co.legal_name)} · ${escapeHtml(co.phone)} · ${escapeHtml(co.email)}</p></div>`;
}

module.exports = { register, totals, canSeeQuote, canSeeInvoice, refreshPaid, postInvoice };
