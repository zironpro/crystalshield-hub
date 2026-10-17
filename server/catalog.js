// Products (films, materials, services) with stock in SQM, stock movements, and suppliers.
// Stock is valued at weighted average cost; every movement posts to the books.
const { all, get, run, tx } = require('./db');
const U = require('./util');
const books = require('./accounting');
const { can } = require('./perms');

const CATEGORIES = {
  solar: 'Solar control film', safety: 'Safety & security film', blast: 'Blast mitigation film', surface: 'Surface protection film',
  privacy: 'Privacy / frosted film', decorative: 'Decorative film', material: 'Materials & consumables', service: 'Service / labour',
};

const stockOf = (productId) => U.r2(get('SELECT COALESCE(SUM(qty), 0) q FROM stock_moves WHERE product_id = ?', productId).q);
function avgCost(productId) {
  const r = get('SELECT COALESCE(SUM(qty * unit_cost), 0) v, COALESCE(SUM(qty), 0) q FROM stock_moves WHERE product_id = ? AND qty > 0', productId);
  if (r.q > 0) return U.r2(r.v / r.q);
  return U.r2(get('SELECT cost_price FROM products WHERE id = ?', productId)?.cost_price || 0);
}
const imageUrl = (p) => (p.image_file_id ? `/api/public/product-image/${p.image_file_id}` : null);

// Takes film/material out of stock for an installation or invoice (replacing what was taken before for it)
function consumeFor(ctx, refType, refId, lines, { date = U.today(), userId = null, note = '' } = {}) {
  return tx(() => {
    run('DELETE FROM stock_moves WHERE ref_type = ? AND ref_id = ?', refType, refId);
    let value = 0;
    const low = [];
    for (const l of lines) {
      const p = get('SELECT * FROM products WHERE id = ?', Number(l.product_id));
      const qty = U.r2(l.qty);
      if (!p || !p.track_stock || qty <= 0) continue;
      const cost = avgCost(p.id);
      run('INSERT INTO stock_moves (product_id, date, qty, unit_cost, kind, ref_type, ref_id, note, user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        p.id, date, -qty, cost, refType === 'job' ? 'job' : 'sale', refType, refId, note, userId);
      value += qty * cost;
      const left = stockOf(p.id);
      if (p.min_stock > 0 && left < p.min_stock) low.push(`${p.name}: ${left} ${p.unit} left`);
    }
    value = U.r2(value);
    books.post({
      source: `stock_${refType}`, source_id: refId, date, user_id: userId, description: `Film & materials used — ${note}`,
      lines: [{ key: 'cogs', debit: value }, { key: 'inventory', credit: value }],
    });
    if (low.length && ctx) ctx.notify(ctx.usersWith('inventory', 'edit'), { type: 'stock', title: '📦 Low stock', body: low.join(' · '), link: 'products' });
    if (ctx) ctx.broadcast('inventory', 'stock');
    return value;
  });
}
function releaseFor(refType, refId) {
  run('DELETE FROM stock_moves WHERE ref_type = ? AND ref_id = ?', refType, refId);
  books.unpost(`stock_${refType}`, refId);
}

function register(ctx) {
  const { app, h, need, fail, clean } = ctx;

  const productOut = (p, user) => {
    const out = { ...p, stock: stockOf(p.id), image: imageUrl(p), category_label: CATEGORIES[p.category] || p.category };
    if (can(user, 'see_costs')) out.avg_cost = avgCost(p.id);
    else { delete out.cost_price; }
    return out;
  };

  app.get('/api/products', h((req) => {
    // everyone who prices deals or installs needs the list; costs only for those allowed
    if (!can(req.user, 'inventory') && !can(req.user, 'crm') && !can(req.user, 'quotes') && !can(req.user, 'jobs') && !can(req.user, 'purchases')) fail(403, 'No access');
    const where = []; const p = [];
    if (req.query.active !== 'all') where.push('active = 1');
    if (req.query.category) { where.push('category = ?'); p.push(String(req.query.category)); }
    if (req.query.q) { where.push('(name LIKE ? OR code LIKE ? OR brand LIKE ?)'); p.push(...Array(3).fill(`%${req.query.q}%`)); }
    const rows = all(`SELECT * FROM products ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY category, name`, ...p);
    return { products: rows.map((r) => productOut(r, req.user)), categories: CATEGORIES };
  }));

  const FIELDS = ['code', 'name', 'category', 'brand', 'thickness', 'description', 'unit'];
  function values(b) {
    const f = {};
    for (const k of FIELDS) if (b[k] !== undefined) f[k] = clean(b[k], k === 'description' ? 2000 : 120);
    for (const k of ['vlt', 'heat_rejection', 'uv_block']) if (b[k] !== undefined) f[k] = b[k] === '' || b[k] === null ? null : U.num(b[k]);
    for (const k of ['sell_price', 'cost_price', 'min_stock']) if (b[k] !== undefined) f[k] = U.num(b[k]);
    if (b.warranty_years !== undefined) f.warranty_years = Math.max(0, Math.round(U.num(b.warranty_years)));
    if (b.track_stock !== undefined) f.track_stock = b.track_stock ? 1 : 0;
    if (b.active !== undefined) f.active = b.active ? 1 : 0;
    if (f.category && !CATEGORIES[f.category]) f.category = 'solar';
    return f;
  }
  app.post('/api/products', need('inventory', 'create'), h((req) => {
    const f = values(req.body);
    if (!f.name) fail(400, 'Enter the product name');
    if (!f.code) f.code = U.nextNumber('product');
    if (get('SELECT id FROM products WHERE code = ?', f.code)) fail(400, 'That item code is already used');
    if (f.category === 'service' && f.track_stock === undefined) f.track_stock = 0;
    const keys = Object.keys(f);
    const r = run(`INSERT INTO products (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`, ...keys.map((k) => f[k]));
    const id = Number(r.lastInsertRowid);
    const opening = U.num(req.body.opening_stock);
    if (opening > 0) adjust(ctx, id, { qty: opening, unit_cost: f.cost_price || 0, kind: 'opening', note: 'Opening stock' }, req.user.id);
    ctx.broadcast('inventory', 'stock');
    return { product: productOut(get('SELECT * FROM products WHERE id = ?', id), req.user) };
  }));
  app.get('/api/products/:id', h((req) => {
    if (!can(req.user, 'inventory') && !can(req.user, 'crm')) fail(403, 'No access');
    const p = get('SELECT * FROM products WHERE id = ?', req.params.id);
    if (!p) fail(404, 'Product not found');
    const costs = can(req.user, 'see_costs');
    const moves = can(req.user, 'inventory') ? all(`SELECT m.*, u.name user_name FROM stock_moves m LEFT JOIN users u ON u.id = m.user_id WHERE product_id = ? ORDER BY m.date DESC, m.id DESC LIMIT 300`, p.id).map((m) => {
      let ref = null;
      if (m.ref_type === 'job') ref = get('SELECT id, number FROM jobs WHERE id = ?', m.ref_id);
      if (m.ref_type === 'invoice') ref = get('SELECT id, number FROM invoices WHERE id = ?', m.ref_id);
      if (m.ref_type === 'grn') ref = get('SELECT r.id, r.number, r.po_id, p.number po_number FROM receipts r JOIN purchase_orders p ON p.id = r.po_id WHERE r.id = ?', m.ref_id);
      return { ...m, ref, unit_cost: costs ? m.unit_cost : undefined };
    }) : [];
    return { product: productOut(p, req.user), moves };
  }));
  app.patch('/api/products/:id', need('inventory', 'edit'), h((req) => {
    const p = get('SELECT * FROM products WHERE id = ?', req.params.id);
    if (!p) fail(404, 'Product not found');
    const f = values(req.body);
    if (f.name === '') fail(400, 'Name is required');
    if (f.code && get('SELECT id FROM products WHERE code = ? AND id != ?', f.code, p.id)) fail(400, 'That item code is already used');
    if (!can(req.user, 'see_costs')) delete f.cost_price;
    const keys = Object.keys(f);
    if (keys.length) run(`UPDATE products SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`, ...keys.map((k) => f[k]), p.id);
    if (req.body.image_file_id !== undefined) run('UPDATE products SET image_file_id = ? WHERE id = ?', Number(req.body.image_file_id) || null, p.id);
    ctx.broadcast('inventory', 'stock');
    return { product: productOut(get('SELECT * FROM products WHERE id = ?', p.id), req.user) };
  }));
  app.delete('/api/products/:id', need('inventory', 'delete'), h((req) => {
    const p = get('SELECT * FROM products WHERE id = ?', req.params.id);
    if (!p) fail(404, 'Product not found');
    const used = get(`SELECT 1 FROM stock_moves WHERE product_id = ? UNION SELECT 1 FROM quote_items WHERE product_id = ? UNION SELECT 1 FROM invoice_items WHERE product_id = ? UNION SELECT 1 FROM po_items WHERE product_id = ?`, p.id, p.id, p.id, p.id);
    if (used) { run('UPDATE products SET active = 0 WHERE id = ?', p.id); return { ok: true, archived: true }; }
    run('DELETE FROM products WHERE id = ?', p.id);
    ctx.broadcast('inventory', 'stock');
    return { ok: true };
  }));
  app.post('/api/products/:id/adjust', need('inventory', 'edit'), h((req) => {
    const p = get('SELECT * FROM products WHERE id = ?', req.params.id);
    if (!p) fail(404, 'Product not found');
    const qty = U.num(req.body.qty);
    if (!qty) fail(400, 'Enter how much to add (+) or remove (−)');
    if (!clean(req.body.note, 300)) fail(400, 'Say why (e.g. stock count, damaged roll)');
    adjust(ctx, p.id, { qty, unit_cost: U.num(req.body.unit_cost) || avgCost(p.id), kind: req.body.kind === 'opening' ? 'opening' : 'adjustment', note: clean(req.body.note, 300), date: U.isDate(req.body.date) ? req.body.date : U.today() }, req.user.id);
    return { stock: stockOf(p.id) };
  }));

  // Product images are shown on quotations sent to customers, so they're public
  app.get('/api/public/product-image/:id', (req, res) => {
    const f = get(`SELECT * FROM files WHERE id = ? AND entity = 'product'`, req.params.id);
    if (!f) return res.status(404).end();
    ctx.sendStored(res, f.token, f.mime, f.name, { cache: 'public, max-age=604800' });
  });
  ctx.fileAccess.product = (u, id, write) => (write ? can(u, 'inventory', 'edit') : true);

  // ======================= SUPPLIERS =======================
  app.get('/api/vendors', h((req) => {
    if (!can(req.user, 'purchases') && !can(req.user, 'expenses') && !can(req.user, 'see_costs')) fail(403, 'No access');
    const rows = all(`SELECT v.*,
      (SELECT COALESCE(SUM(received_value - paid), 0) FROM purchase_orders p WHERE p.vendor_id = v.id AND p.status != 'cancelled') balance,
      (SELECT COUNT(*) FROM purchase_orders p WHERE p.vendor_id = v.id) pos
      FROM vendors v ${req.query.all ? '' : 'WHERE v.active = 1'} ORDER BY v.name`);
    return { vendors: rows };
  }));
  const VF = ['name', 'contact_person', 'phone', 'email', 'trn', 'address', 'notes'];
  const vvalues = (b) => Object.fromEntries(VF.filter((k) => b[k] !== undefined).map((k) => [k, clean(b[k], k === 'notes' ? 2000 : 200)]));
  app.post('/api/vendors', need('purchases', 'create'), h((req) => {
    const f = vvalues(req.body);
    if (!f.name) fail(400, 'Enter the supplier name');
    const keys = Object.keys(f);
    const r = run(`INSERT INTO vendors (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`, ...keys.map((k) => f[k]));
    ctx.broadcast('purchases', 'vendors');
    return { vendor: get('SELECT * FROM vendors WHERE id = ?', r.lastInsertRowid) };
  }));
  app.get('/api/vendors/:id', need('purchases'), h((req) => {
    const v = get('SELECT * FROM vendors WHERE id = ?', req.params.id);
    if (!v) fail(404, 'Supplier not found');
    return {
      vendor: v,
      pos: all('SELECT * FROM purchase_orders WHERE vendor_id = ? ORDER BY id DESC', v.id),
      payments: all('SELECT * FROM vendor_payments WHERE vendor_id = ? ORDER BY date DESC, id DESC', v.id),
      expenses: all('SELECT e.*, a.name category FROM expenses e LEFT JOIN accounts a ON a.id = e.account_id WHERE vendor_id = ? ORDER BY date DESC', v.id),
    };
  }));
  app.patch('/api/vendors/:id', need('purchases', 'edit'), h((req) => {
    const v = get('SELECT * FROM vendors WHERE id = ?', req.params.id);
    if (!v) fail(404, 'Supplier not found');
    const f = vvalues(req.body);
    if (req.body.active !== undefined) f.active = req.body.active ? 1 : 0;
    if (f.name === '') fail(400, 'Name is required');
    const keys = Object.keys(f);
    if (keys.length) run(`UPDATE vendors SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`, ...keys.map((k) => f[k]), v.id);
    ctx.broadcast('purchases', 'vendors');
    return { vendor: get('SELECT * FROM vendors WHERE id = ?', v.id) };
  }));
  app.delete('/api/vendors/:id', need('purchases', 'delete'), h((req) => {
    const v = get('SELECT * FROM vendors WHERE id = ?', req.params.id);
    if (!v) fail(404, 'Supplier not found');
    if (get('SELECT 1 FROM purchase_orders WHERE vendor_id = ? UNION SELECT 1 FROM expenses WHERE vendor_id = ?', v.id, v.id)) {
      run('UPDATE vendors SET active = 0 WHERE id = ?', v.id);
      return { ok: true, archived: true };
    }
    run('DELETE FROM vendors WHERE id = ?', v.id);
    return { ok: true };
  }));
}

function adjust(ctx, productId, { qty, unit_cost, kind, note, date = U.today() }, userId) {
  return tx(() => {
    const id = Number(run('INSERT INTO stock_moves (product_id, date, qty, unit_cost, kind, ref_type, note, user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      productId, date, U.r2(qty), U.r2(unit_cost), kind, 'adjustment', note, userId).lastInsertRowid);
    const value = U.r2(Math.abs(qty) * unit_cost);
    const p = get('SELECT name FROM products WHERE id = ?', productId);
    const other = kind === 'opening' ? 'opening' : 'stock_adj';
    books.post({
      source: 'stock_adj', source_id: id, date, user_id: userId, description: `${kind === 'opening' ? 'Opening stock' : 'Stock adjustment'} — ${p.name}: ${note}`,
      lines: qty > 0 ? [{ key: 'inventory', debit: value }, { key: other, credit: value }] : [{ key: other, debit: value }, { key: 'inventory', credit: value }],
    });
    if (ctx) ctx.broadcast('inventory', 'stock');
    return id;
  });
}

module.exports = { register, stockOf, avgCost, consumeFor, releaseFor, adjust, imageUrl, CATEGORIES };
