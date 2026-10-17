// Expenses: labour, transport, materials, rent, ads… optionally against a deal / installation so the job's real
// profit is known. Each one posts to the books (expense + input VAT / cash or bank).
const { all, get, run, tx } = require('./db');
const U = require('./util');
const books = require('./accounting');
const { can } = require('./perms');

function postExpense(e, userId) {
  books.post({
    source: 'expense', source_id: e.id, date: e.date, user_id: userId,
    description: `${e.number} · ${e.description || get('SELECT name FROM accounts WHERE id = ?', e.account_id)?.name || 'Expense'}`,
    lines: [{ account_id: e.account_id, debit: e.amount }, { key: 'vat_in', debit: e.vat }, { account_id: e.paid_from, credit: e.total }],
  });
}

function register(ctx) {
  const { app, h, need, fail, clean, timeline } = ctx;

  app.get('/api/expenses', need('expenses'), h((req) => {
    const q = req.query; const where = ['1=1']; const p = [];
    if (U.isDate(q.from)) { where.push('e.date >= ?'); p.push(q.from); }
    if (U.isDate(q.to)) { where.push('e.date <= ?'); p.push(q.to); }
    if (q.category) { where.push('e.account_id = ?'); p.push(Number(q.category)); }
    if (q.deal) { where.push('e.deal_id = ?'); p.push(Number(q.deal)); }
    if (q.q) { where.push('(e.number LIKE ? OR e.description LIKE ? OR e.payee LIKE ? OR v.name LIKE ?)'); p.push(...Array(4).fill(`%${q.q}%`)); }
    const rows = all(`SELECT e.*, a.name category, m.name paid_from_name, d.code deal_code, d.title deal_title, j.number job_number, v.name vendor_name, u.name user_name,
      (SELECT COUNT(*) FROM files f WHERE f.entity = 'expense' AND f.entity_id = e.id) receipts
      FROM expenses e LEFT JOIN accounts a ON a.id = e.account_id LEFT JOIN accounts m ON m.id = e.paid_from LEFT JOIN deals d ON d.id = e.deal_id
      LEFT JOIN jobs j ON j.id = e.job_id LEFT JOIN vendors v ON v.id = e.vendor_id LEFT JOIN users u ON u.id = e.created_by
      WHERE ${where.join(' AND ')} ORDER BY e.date DESC, e.id DESC LIMIT 2000`, ...p);
    return { expenses: rows };
  }));

  function values(b, existing = {}) {
    const date = U.isDate(b.date) ? b.date : existing.date || U.today();
    const accountId = Number(b.account_id ?? existing.account_id);
    if (!get('SELECT id FROM accounts WHERE id = ? AND type = ?', accountId, 'expense')) fail(400, 'Pick a category');
    const amount = U.r2(b.amount ?? existing.amount);
    if (amount <= 0) fail(400, 'Enter the amount');
    const vat = U.r2(b.vat ?? existing.vat ?? 0);
    const paidFrom = Number(b.paid_from ?? existing.paid_from) || books.accountForMethod(b.method || existing.method || 'cash');
    if (!get('SELECT id FROM accounts WHERE id = ? AND is_money = 1', paidFrom)) fail(400, 'Pick where it was paid from');
    let jobId = b.job_id !== undefined ? Number(b.job_id) || null : existing.job_id || null;
    let dealId = b.deal_id !== undefined ? Number(b.deal_id) || null : existing.deal_id || null;
    if (jobId && !dealId) dealId = get('SELECT deal_id FROM jobs WHERE id = ?', jobId)?.deal_id || null;
    return {
      date, account_id: accountId, amount, vat, total: U.r2(amount + vat), paid_from: paidFrom,
      method: ['cash', 'bank', 'card', 'cheque'].includes(b.method) ? b.method : existing.method || 'cash',
      deal_id: dealId, job_id: jobId, vendor_id: b.vendor_id !== undefined ? Number(b.vendor_id) || null : existing.vendor_id || null,
      payee: b.payee !== undefined ? clean(b.payee, 120) : existing.payee || '',
      description: b.description !== undefined ? clean(b.description, 500) : existing.description || '',
      reference: b.reference !== undefined ? clean(b.reference, 120) : existing.reference || '',
    };
  }
  app.post('/api/expenses', need('expenses', 'create'), h((req) => {
    const f = values(req.body);
    const e = tx(() => {
      const keys = Object.keys(f);
      const id = Number(run(`INSERT INTO expenses (number, created_by, ${keys.join(', ')}) VALUES (?, ?, ${keys.map(() => '?').join(', ')})`, U.nextNumber('expense'), req.user.id, ...keys.map((k) => f[k])).lastInsertRowid);
      const row = get('SELECT * FROM expenses WHERE id = ?', id);
      postExpense(row, req.user.id);
      return row;
    });
    if (e.deal_id) timeline('deal', e.deal_id, req.user.id, 'system', `Expense ${e.number}: ${e.description || 'cost'} ${U.fmtAED(e.total)}`);
    ctx.broadcast('expenses', 'expenses'); ctx.broadcast('crm', 'deals', { id: e.deal_id });
    return { expense: e };
  }));
  app.patch('/api/expenses/:id', need('expenses', 'edit'), h((req) => {
    const e = get('SELECT * FROM expenses WHERE id = ?', req.params.id);
    if (!e) fail(404, 'Expense not found');
    const f = values(req.body, e);
    tx(() => {
      const keys = Object.keys(f);
      run(`UPDATE expenses SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`, ...keys.map((k) => f[k]), e.id);
      postExpense(get('SELECT * FROM expenses WHERE id = ?', e.id), req.user.id);
    });
    ctx.broadcast('expenses', 'expenses', { id: e.id });
    return { expense: get('SELECT * FROM expenses WHERE id = ?', e.id) };
  }));
  app.delete('/api/expenses/:id', need('expenses', 'delete'), h((req) => {
    const e = get('SELECT * FROM expenses WHERE id = ?', req.params.id);
    if (!e) fail(404, 'Expense not found');
    tx(() => {
      books.unpost('expense', e.id);
      for (const f of all(`SELECT * FROM files WHERE entity = 'expense' AND entity_id = ?`, e.id)) { ctx.removeStored(f.token); run('DELETE FROM files WHERE id = ?', f.id); }
      run('DELETE FROM expenses WHERE id = ?', e.id);
    });
    ctx.broadcast('expenses', 'expenses');
    return { ok: true };
  }));
  ctx.fileAccess.expense = (u, id, write) => can(u, 'expenses', write ? 'edit' : 'view') || (write && can(u, 'expenses', 'create') && get('SELECT created_by FROM expenses WHERE id = ?', id)?.created_by === u.id);
}

module.exports = { register };
