// Purchase orders (one click from a deal's pricing sheet, grouped by supplier, or for stock), goods received
// (adds stock and books the supplier bill) and supplier payments.
const { all, get, run, tx } = require('./db');
const U = require('./util');
const S = require('./settings');
const books = require('./accounting');
const catalog = require('./catalog');
const crm = require('./crm');
const { can } = require('./perms');

const appUrl = (req) => (process.env.APP_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
function poTotals(items, vatRate) {
  const subtotal = U.r2(items.reduce((s, i) => s + U.num(i.qty) * U.num(i.cost), 0));
  const vat = U.r2(subtotal * U.num(vatRate) / 100);
  return { subtotal, vat, total: U.r2(subtotal + vat) };
}
function refreshPO(poId) {
  const po = get('SELECT * FROM purchase_orders WHERE id = ?', poId);
  const received = U.r2(get('SELECT COALESCE(SUM(total), 0) t FROM receipts WHERE po_id = ?', poId).t);
  const paid = U.r2(get('SELECT COALESCE(SUM(amount), 0) t FROM vendor_payments WHERE po_id = ?', poId).t);
  const items = all('SELECT qty, received_qty FROM po_items WHERE po_id = ?', poId);
  let status = po.status;
  if (status !== 'cancelled' && status !== 'draft') {
    const anyIn = items.some((i) => i.received_qty > 0);
    const allIn = items.length && items.every((i) => i.received_qty >= i.qty - 0.0001);
    status = allIn ? 'received' : anyIn ? 'partial' : 'sent';
  }
  run('UPDATE purchase_orders SET received_value = ?, paid = ?, status = ? WHERE id = ?', received, paid, status, poId);
}

function register(ctx) {
  const { app, h, ha, need, fail, clean, timeline, notify } = ctx;

  app.get('/api/purchase-orders', need('purchases'), h((req) => {
    const q = req.query; const where = ['1=1']; const p = [];
    if (q.status === 'open') where.push(`po.status IN ('draft','sent','partial')`);
    else if (q.status === 'unpaid') where.push('po.received_value - po.paid > 0.009');
    else if (q.status) { where.push('po.status = ?'); p.push(String(q.status)); }
    if (q.vendor) { where.push('po.vendor_id = ?'); p.push(Number(q.vendor)); }
    if (q.deal) { where.push('po.deal_id = ?'); p.push(Number(q.deal)); }
    if (q.q) { where.push('(po.number LIKE ? OR v.name LIKE ? OR po.vendor_ref LIKE ?)'); p.push(...Array(3).fill(`%${q.q}%`)); }
    return { pos: all(`SELECT po.*, v.name vendor_name, d.code deal_code, d.title deal_title FROM purchase_orders po LEFT JOIN vendors v ON v.id = po.vendor_id
      LEFT JOIN deals d ON d.id = po.deal_id WHERE ${where.join(' AND ')} ORDER BY po.id DESC LIMIT 1000`, ...p).map((r) => ({ ...r, token: undefined })) };
  }));

  function insertPO(req, { vendorId, dealId, items, notes = '' }) {
    const vat = S.docs().vat_rate;
    const t = poTotals(items, vat);
    return tx(() => {
      const id = Number(run(`INSERT INTO purchase_orders (number, vendor_id, deal_id, date, expected_date, notes, vat_rate, subtotal, vat, total, token, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, U.nextNumber('po'), vendorId, dealId || null, U.today(), U.addDays(U.today(), 3), notes, vat, t.subtotal, t.vat, t.total, U.token(), req.user.id).lastInsertRowid);
      items.forEach((it, i) => run('INSERT INTO po_items (po_id, position, product_id, name, description, qty, unit, cost) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        id, i, it.product_id || null, it.name || '', it.description || '', U.num(it.qty), it.unit || 'SQM', U.num(it.cost)));
      const po = get('SELECT * FROM purchase_orders WHERE id = ?', id);
      if (dealId) timeline('deal', dealId, req.user.id, 'document', `Purchase order ${po.number} drafted for ${get('SELECT name FROM vendors WHERE id = ?', vendorId)?.name || 'supplier'} · ${U.fmtAED(po.total)}`);
      return po;
    });
  }
  // Single click: the deal's priced items become one purchase order per supplier
  app.post('/api/deals/:id/purchase-orders', need('purchases', 'create'), h((req) => {
    const d = ctx.loadDeal(req.user, req.params.id);
    const items = all(`SELECT * FROM deal_items WHERE deal_id = ? AND kind = 'item' AND vendor_id IS NOT NULL AND qty > 0 ORDER BY position`, d.id);
    if (!items.length) fail(400, 'Pick a supplier (and purchase price) for the items on the pricing sheet first');
    const wastage = U.num(req.body.wastage_pct ?? S.docs().wastage_pct);
    const byVendor = new Map();
    for (const it of items) {
      if (!byVendor.has(it.vendor_id)) byVendor.set(it.vendor_id, []);
      const product = it.product_id ? get('SELECT * FROM products WHERE id = ?', it.product_id) : null;
      // film is ordered with an allowance for cutting waste
      const qty = product?.track_stock && /sqm/i.test(it.unit) ? U.r2(it.qty * (1 + wastage / 100)) : it.qty;
      byVendor.get(it.vendor_id).push({ ...it, qty, description: it.description });
    }
    const pos = [...byVendor.entries()].map(([vendorId, list]) => insertPO(req, { vendorId, dealId: d.id, items: list, notes: `For ${d.code} · ${d.title}` }));
    ctx.broadcast('purchases', 'purchases'); ctx.broadcast('crm', 'deals', { id: d.id });
    return { pos: pos.map((p) => ({ id: p.id, number: p.number })) };
  }));
  app.post('/api/purchase-orders', need('purchases', 'create'), h((req) => {
    const vendorId = Number(req.body.vendor_id);
    if (!vendorId || !get('SELECT id FROM vendors WHERE id = ?', vendorId)) fail(400, 'Pick the supplier');
    const po = insertPO(req, { vendorId, dealId: Number(req.body.deal_id) || null, items: [], notes: clean(req.body.notes, 1000) });
    ctx.broadcast('purchases', 'purchases');
    return { po };
  }));
  function loadPO(id) {
    const po = get('SELECT * FROM purchase_orders WHERE id = ?', id);
    if (!po) fail(404, 'Purchase order not found');
    return po;
  }
  app.get('/api/purchase-orders/:id', need('purchases'), h((req) => {
    const po = loadPO(req.params.id);
    return {
      po: { ...po, url: `${appUrl(req)}/doc/po/${po.token}`, balance: U.r2(po.received_value - po.paid) },
      items: all('SELECT pi.*, p.code product_code, p.track_stock FROM po_items pi LEFT JOIN products p ON p.id = pi.product_id WHERE po_id = ? ORDER BY position, id', po.id),
      vendor: po.vendor_id ? get('SELECT * FROM vendors WHERE id = ?', po.vendor_id) : null,
      deal: po.deal_id ? get('SELECT id, code, title FROM deals WHERE id = ?', po.deal_id) : null,
      receipts: all('SELECT r.*, u.name user_name FROM receipts r LEFT JOIN users u ON u.id = r.created_by WHERE po_id = ? ORDER BY date, id', po.id),
      payments: all('SELECT p.*, a.name account_name FROM vendor_payments p LEFT JOIN accounts a ON a.id = p.account_id WHERE po_id = ? ORDER BY date, id', po.id),
      timeline: all(`SELECT t.*, u.name user_name FROM timeline t LEFT JOIN users u ON u.id = t.user_id WHERE entity = 'po' AND entity_id = ? ORDER BY id DESC`, po.id),
    };
  }));
  app.put('/api/purchase-orders/:id', need('purchases', 'edit'), h((req) => {
    const po = loadPO(req.params.id);
    if (['received', 'cancelled'].includes(po.status)) fail(400, 'This purchase order is closed');
    const b = req.body;
    const old = all('SELECT * FROM po_items WHERE po_id = ?', po.id);
    if (Array.isArray(b.items) && old.some((o) => o.received_qty > 0)) {
      // after goods arrived only quantities can grow; removing received lines is blocked
      for (const o of old.filter((x) => x.received_qty > 0)) {
        const n = b.items.find((x) => Number(x.id) === o.id);
        if (!n || U.num(n.qty) < o.received_qty) fail(400, `${o.name}: ${o.received_qty} already received`);
      }
    }
    const items = Array.isArray(b.items) ? b.items.slice(0, 200).map((it) => {
      const product = it.product_id ? get('SELECT * FROM products WHERE id = ?', Number(it.product_id)) : null;
      return { id: Number(it.id) || null, product_id: product?.id || null, name: clean(it.name, 200) || product?.name || '', description: clean(it.description, 1000), qty: U.num(it.qty), unit: clean(it.unit, 12) || product?.unit || 'SQM', cost: U.num(it.cost) };
    }).filter((i) => i.name) : old;
    const vatRate = b.vat_rate !== undefined ? U.num(b.vat_rate) : po.vat_rate;
    const t = poTotals(items, vatRate);
    tx(() => {
      const f = {};
      for (const k of ['notes', 'vendor_ref']) if (b[k] !== undefined) f[k] = clean(b[k], 2000);
      for (const k of ['date', 'expected_date']) if (b[k] !== undefined && U.isDate(b[k])) f[k] = b[k];
      if (b.vendor_id && get('SELECT id FROM vendors WHERE id = ?', Number(b.vendor_id))) f.vendor_id = Number(b.vendor_id);
      Object.assign(f, { vat_rate: vatRate, ...t });
      const keys = Object.keys(f);
      run(`UPDATE purchase_orders SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`, ...keys.map((k) => f[k]), po.id);
      if (Array.isArray(b.items)) {
        const keep = new Set(items.filter((i) => i.id).map((i) => i.id));
        for (const o of old) if (!keep.has(o.id)) run('DELETE FROM po_items WHERE id = ?', o.id);
        items.forEach((it, i) => {
          if (it.id && old.some((o) => o.id === it.id)) run('UPDATE po_items SET position = ?, product_id = ?, name = ?, description = ?, qty = ?, unit = ?, cost = ? WHERE id = ?', i, it.product_id, it.name, it.description, it.qty, it.unit, it.cost, it.id);
          else run('INSERT INTO po_items (po_id, position, product_id, name, description, qty, unit, cost) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', po.id, i, it.product_id, it.name, it.description, it.qty, it.unit, it.cost);
        });
      }
    });
    ctx.broadcast('purchases', 'purchases', { id: po.id });
    return { ok: true, totals: t };
  }));
  app.post('/api/purchase-orders/:id/status', need('purchases', 'edit'), h((req) => {
    const po = loadPO(req.params.id);
    const s = req.body.status;
    if (s === 'sent') {
      if (!all('SELECT id FROM po_items WHERE po_id = ?', po.id).length) fail(400, 'Add items first');
      run(`UPDATE purchase_orders SET status = CASE WHEN status = 'draft' THEN 'sent' ELSE status END, sent_at = COALESCE(sent_at, datetime('now')) WHERE id = ?`, po.id);
    } else if (s === 'cancelled') {
      if (get('SELECT id FROM receipts WHERE po_id = ?', po.id)) fail(400, 'Goods were already received on this order');
      run(`UPDATE purchase_orders SET status = 'cancelled' WHERE id = ?`, po.id);
    } else if (s === 'draft') {
      if (get('SELECT id FROM receipts WHERE po_id = ?', po.id)) fail(400, 'Goods were already received on this order');
      run(`UPDATE purchase_orders SET status = 'draft' WHERE id = ?`, po.id);
    } else fail(400, 'Unknown status');
    timeline('po', po.id, req.user.id, 'stage', `Purchase order ${s === 'sent' ? 'sent to supplier' : s}`);
    if (po.deal_id) timeline('deal', po.deal_id, req.user.id, 'document', `Purchase order ${po.number} ${s === 'sent' ? 'sent to supplier' : s}`);
    ctx.broadcast('purchases', 'purchases', { id: po.id });
    return { ok: true };
  }));
  app.delete('/api/purchase-orders/:id', need('purchases', 'delete'), h((req) => {
    const po = loadPO(req.params.id);
    if (po.status !== 'draft' && po.status !== 'cancelled') fail(400, 'Only draft or cancelled orders can be deleted');
    if (get('SELECT id FROM receipts WHERE po_id = ? UNION SELECT id FROM vendor_payments WHERE po_id = ?', po.id, po.id)) fail(400, 'This order has goods received or payments');
    run('DELETE FROM purchase_orders WHERE id = ?', po.id);
    ctx.broadcast('purchases', 'purchases');
    return { ok: true };
  }));

  // ---------- goods received: stock in + supplier bill ----------
  function postReceipt(rc, po, userId) {
    const lines = JSON.parse(rc.lines || '[]');
    const stockValue = U.r2(lines.filter((l) => l.stock).reduce((s, l) => s + l.qty * l.cost, 0));
    const direct = U.r2(lines.filter((l) => !l.stock).reduce((s, l) => s + l.qty * l.cost, 0));
    books.post({
      source: 'receipt', source_id: rc.id, date: rc.date, user_id: userId,
      description: `Goods received ${rc.number} · ${po.number}${po.vendor_ref ? ` (bill ${po.vendor_ref})` : ''}`,
      lines: [
        { key: 'inventory', debit: stockValue }, { key: 'purchases', debit: direct }, { key: 'vat_in', debit: rc.vat },
        { key: 'ap', credit: rc.total, party: `vendor:${po.vendor_id}` },
      ],
    });
  }
  app.post('/api/purchase-orders/:id/receive', need('purchases', 'edit'), h((req) => {
    const po = loadPO(req.params.id);
    if (['cancelled', 'received'].includes(po.status)) fail(400, po.status === 'received' ? 'Everything on this order was received' : 'This order is cancelled');
    if (po.status === 'draft') fail(400, 'Mark the order as sent first');
    const date = U.isDate(req.body.date) ? req.body.date : U.today();
    const items = all('SELECT pi.*, p.track_stock FROM po_items pi LEFT JOIN products p ON p.id = pi.product_id WHERE po_id = ?', po.id);
    const lines = [];
    for (const l of req.body.lines || []) {
      const it = items.find((i) => i.id === Number(l.po_item_id));
      const qty = U.r2(l.qty);
      if (!it || qty <= 0) continue;
      if (qty > U.r2(it.qty - it.received_qty) + 0.0001) fail(400, `${it.name}: only ${U.r2(it.qty - it.received_qty)} left to receive`);
      lines.push({ po_item_id: it.id, product_id: it.product_id, name: it.name, qty, unit: it.unit, cost: U.num(l.cost ?? it.cost), stock: !!(it.product_id && it.track_stock) });
    }
    if (!lines.length) fail(400, 'Enter what arrived');
    const subtotal = U.r2(lines.reduce((s, l) => s + l.qty * l.cost, 0));
    const vat = U.r2(subtotal * po.vat_rate / 100);
    const rc = tx(() => {
      if (req.body.vendor_ref !== undefined) run('UPDATE purchase_orders SET vendor_ref = ? WHERE id = ?', clean(req.body.vendor_ref, 60), po.id);
      const id = Number(run('INSERT INTO receipts (number, po_id, date, lines, subtotal, vat, total, note, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        U.nextNumber('grn'), po.id, date, JSON.stringify(lines), subtotal, vat, U.r2(subtotal + vat), clean(req.body.note, 500), req.user.id).lastInsertRowid);
      for (const l of lines) {
        run('UPDATE po_items SET received_qty = received_qty + ? WHERE id = ?', l.qty, l.po_item_id);
        if (l.stock) run('INSERT INTO stock_moves (product_id, date, qty, unit_cost, kind, ref_type, ref_id, note, user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
          l.product_id, date, l.qty, l.cost, 'purchase', 'grn', id, `Received on ${po.number}`, req.user.id);
      }
      const r = get('SELECT * FROM receipts WHERE id = ?', id);
      postReceipt(r, get('SELECT * FROM purchase_orders WHERE id = ?', po.id), req.user.id);
      refreshPO(po.id);
      return r;
    });
    timeline('po', po.id, req.user.id, 'document', `Goods received ${rc.number}: ${lines.map((l) => `${l.qty} ${l.unit} ${l.name}`).join(', ')}`);
    if (po.deal_id) {
      timeline('deal', po.deal_id, req.user.id, 'document', `Material received for ${po.number} (${rc.number})`);
      const d = get('SELECT owner_id, title FROM deals WHERE id = ?', po.deal_id);
      notify([d?.owner_id], { type: 'stock', title: `📦 Material arrived for ${d?.title}`, body: lines.map((l) => `${l.qty} ${l.unit} ${l.name}`).join(', '), link: `deals/${po.deal_id}` }, { exclude: req.user.id });
    }
    ctx.broadcast('purchases', 'purchases', { id: po.id }); ctx.broadcast('inventory', 'stock');
    return { receipt: rc };
  }));
  app.delete('/api/receipts/:id', need('purchases', 'delete'), h((req) => {
    const rc = get('SELECT * FROM receipts WHERE id = ?', req.params.id);
    if (!rc) fail(404, 'Not found');
    tx(() => {
      for (const l of JSON.parse(rc.lines || '[]')) run('UPDATE po_items SET received_qty = MAX(0, received_qty - ?) WHERE id = ?', l.qty, l.po_item_id);
      run(`DELETE FROM stock_moves WHERE ref_type = 'grn' AND ref_id = ?`, rc.id);
      books.unpost('receipt', rc.id);
      run('DELETE FROM receipts WHERE id = ?', rc.id);
      refreshPO(rc.po_id);
    });
    timeline('po', rc.po_id, req.user.id, 'document', `Goods received ${rc.number} removed`);
    ctx.broadcast('purchases', 'purchases', { id: rc.po_id }); ctx.broadcast('inventory', 'stock');
    return { ok: true };
  }));

  // ---------- paying the supplier ----------
  app.post('/api/purchase-orders/:id/payments', need('purchases', 'edit'), h((req) => {
    const po = loadPO(req.params.id);
    const amount = U.r2(req.body.amount);
    if (amount <= 0) fail(400, 'Enter the amount paid');
    if (amount > U.r2(po.received_value - po.paid) + 0.009) fail(400, `Only ${U.fmtAED(po.received_value - po.paid)} is owed for goods received`);
    const method = ['cash', 'bank', 'cheque', 'card'].includes(req.body.method) ? req.body.method : 'bank';
    const account = Number(req.body.account_id) && get('SELECT id FROM accounts WHERE id = ? AND is_money = 1', Number(req.body.account_id)) ? Number(req.body.account_id) : books.accountForMethod(method);
    const date = U.isDate(req.body.date) ? req.body.date : U.today();
    const p = tx(() => {
      const id = Number(run('INSERT INTO vendor_payments (number, vendor_id, po_id, date, amount, method, reference, account_id, notes, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        U.nextNumber('vendor_payment'), po.vendor_id, po.id, date, amount, method, clean(req.body.reference, 120), account, clean(req.body.notes, 500), req.user.id).lastInsertRowid);
      books.post({ source: 'vendor_payment', source_id: id, date, user_id: req.user.id, description: `Payment to ${get('SELECT name FROM vendors WHERE id = ?', po.vendor_id)?.name || 'supplier'} for ${po.number}`,
        lines: [{ key: 'ap', debit: amount, party: `vendor:${po.vendor_id}` }, { account_id: account, credit: amount }] });
      refreshPO(po.id);
      return get('SELECT * FROM vendor_payments WHERE id = ?', id);
    });
    timeline('po', po.id, req.user.id, 'payment', `Paid ${U.fmtAED(amount)} to supplier (${method})`);
    ctx.broadcast('purchases', 'purchases', { id: po.id });
    return { payment: p };
  }));
  app.delete('/api/vendor-payments/:id', need('purchases', 'delete'), h((req) => {
    const p = get('SELECT * FROM vendor_payments WHERE id = ?', req.params.id);
    if (!p) fail(404, 'Not found');
    tx(() => { run('DELETE FROM vendor_payments WHERE id = ?', p.id); books.unpost('vendor_payment', p.id); if (p.po_id) refreshPO(p.po_id); });
    ctx.broadcast('purchases', 'purchases', { id: p.po_id });
    return { ok: true };
  }));

  app.post('/api/purchase-orders/:id/whatsapp', need('purchases', 'edit'), h((req) => {
    const po = loadPO(req.params.id);
    const v = po.vendor_id ? get('SELECT * FROM vendors WHERE id = ?', po.vendor_id) : null;
    const url = `${appUrl(req)}/doc/po/${po.token}`;
    const text = `Dear ${v?.contact_person || v?.name || 'Sir/Madam'},\n\nPlease find our purchase order ${po.number}:\n${url}\n\nKindly confirm availability and delivery date.\n\n${S.company().name}`;
    if (po.status === 'draft') run(`UPDATE purchase_orders SET status = 'sent', sent_at = datetime('now') WHERE id = ?`, po.id);
    timeline('po', po.id, req.user.id, 'whatsapp', 'Sent to supplier by WhatsApp');
    ctx.broadcast('purchases', 'purchases', { id: po.id });
    return { link: `https://wa.me/${crm.normPhone(v?.phone)}?text=${encodeURIComponent(text)}`, url };
  }));
  app.post('/api/purchase-orders/:id/email', need('purchases', 'edit'), ha(async (req) => {
    const po = loadPO(req.params.id);
    const v = po.vendor_id ? get('SELECT * FROM vendors WHERE id = ?', po.vendor_id) : null;
    const to = clean(req.body.to, 200) || v?.email;
    if (!to || !/^\S+@\S+\.\S+$/.test(to)) fail(400, 'Add the supplier’s email');
    const url = `${appUrl(req)}/doc/po/${po.token}`;
    const text = `Dear ${v?.contact_person || v?.name || 'Sir/Madam'},\n\nPlease find our purchase order ${po.number}: ${url}\n\nKindly confirm availability and delivery date.\n\n${S.company().name}`;
    await ctx.mail.sendDocument({ to, subject: `Purchase order ${po.number} — ${S.company().name}`, text, replyTo: req.user.email });
    if (po.status === 'draft') run(`UPDATE purchase_orders SET status = 'sent', sent_at = datetime('now') WHERE id = ?`, po.id);
    timeline('po', po.id, req.user.id, 'email', `Emailed to ${to}`);
    return { ok: true };
  }));
  ctx.fileAccess.po = (u, id, write) => can(u, 'purchases', write ? 'edit' : 'view') && !!get('SELECT id FROM purchase_orders WHERE id = ?', id);
}

module.exports = { register, refreshPO };
