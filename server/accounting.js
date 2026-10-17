// Double-entry books. Invoices, payments, goods received, supplier payments, expenses and stock use post()
// to write their journal automatically; accountants can add manual journals. Reports: trial balance,
// profit & loss, balance sheet, VAT return, ledger, receivables / payables ageing.
const { all, get, run, tx } = require('./db');
const U = require('./util');

const CHART = [
  // code, name, type, key, money, expense category
  ['1000', 'Cash in hand', 'asset', 'cash', 1, 0],
  ['1010', 'Petty cash', 'asset', 'petty_cash', 1, 0],
  ['1020', 'Bank — current account', 'asset', 'bank', 1, 0],
  ['1100', 'Accounts receivable (customers)', 'asset', 'ar', 0, 0],
  ['1200', 'Inventory — film & materials', 'asset', 'inventory', 0, 0],
  ['1300', 'VAT recoverable (input VAT)', 'asset', 'vat_in', 0, 0],
  ['1400', 'Prepaid expenses & deposits', 'asset', 'prepaid', 0, 0],
  ['1500', 'Tools & equipment', 'asset', 'equipment', 0, 0],
  ['1510', 'Vehicles', 'asset', 'vehicles', 0, 0],
  ['1590', 'Accumulated depreciation', 'asset', 'acc_dep', 0, 0],
  ['2000', 'Accounts payable (suppliers)', 'liability', 'ap', 0, 0],
  ['2100', 'VAT payable (output VAT)', 'liability', 'vat_out', 0, 0],
  ['2200', 'Customer advances', 'liability', 'customer_adv', 0, 0],
  ['2300', 'Salaries payable', 'liability', 'salaries_payable', 0, 0],
  ['3000', "Owner's capital", 'equity', 'capital', 0, 0],
  ['3100', 'Retained earnings', 'equity', 'retained', 0, 0],
  ['3200', 'Opening balance equity', 'equity', 'opening', 0, 0],
  ['3300', "Owner's drawings", 'equity', 'drawings', 0, 0],
  ['4000', 'Sales — window film supply & installation', 'income', 'sales', 0, 0],
  ['4100', 'Other income', 'income', 'other_income', 0, 0],
  ['5000', 'Cost of goods sold — film used', 'expense', 'cogs', 0, 0],
  ['5050', 'Purchases — direct (job materials)', 'expense', 'purchases', 0, 1],
  ['5100', 'Installation labour', 'expense', 'labour', 0, 1],
  ['5200', 'Subcontractors', 'expense', 'subcontract', 0, 1],
  ['5300', 'Materials & consumables', 'expense', 'materials', 0, 1],
  ['5400', 'Stock adjustments & wastage', 'expense', 'stock_adj', 0, 0],
  ['6000', 'Salaries & wages', 'expense', 'salaries', 0, 1],
  ['6100', 'Rent', 'expense', 'rent', 0, 1],
  ['6200', 'Transportation & fuel', 'expense', 'transport', 0, 1],
  ['6300', 'Advertising & marketing', 'expense', 'marketing', 0, 1],
  ['6400', 'Utilities & telecom', 'expense', 'utilities', 0, 1],
  ['6500', 'Visa & government fees', 'expense', 'gov_fees', 0, 1],
  ['6600', 'Office & admin', 'expense', 'office', 0, 1],
  ['6700', 'Small tools & equipment', 'expense', 'tools', 0, 1],
  ['6800', 'Bank charges', 'expense', 'bank_charges', 0, 1],
  ['6900', 'Depreciation', 'expense', 'depreciation', 0, 0],
  ['6950', 'Other expenses', 'expense', 'other_exp', 0, 1],
];
function seedChart() {
  for (const [code, name, type, key, money, cat] of CHART) {
    if (get('SELECT id FROM accounts WHERE key = ? OR code = ?', key, code)) continue;
    run('INSERT INTO accounts (code, name, type, key, is_money, is_expense_category) VALUES (?, ?, ?, ?, ?, ?)', code, name, type, key, money, cat);
  }
}
seedChart();

const idCache = new Map();
function acct(key) {
  if (!idCache.has(key)) {
    const a = get('SELECT id FROM accounts WHERE key = ?', key);
    if (!a) throw new Error(`Missing system account ${key}`);
    idCache.set(key, a.id);
  }
  return idCache.get(key);
}

// Writes (or rewrites) the journal for one source document. lines: [{ key | account_id, debit, credit, party, memo }]
function post({ source, source_id, date, description, lines, user_id = null }) {
  return tx(() => {
    const old = get('SELECT * FROM journals WHERE source = ? AND source_id = ?', source, source_id);
    const clean = lines
      .map((l) => ({ account_id: l.account_id || acct(l.key), debit: U.r2(l.debit || 0), credit: U.r2(l.credit || 0), party: l.party || null, memo: l.memo || '' }))
      .filter((l) => l.debit || l.credit)
      // negative amounts flip sides
      .map((l) => (l.debit < 0 || l.credit < 0 ? { ...l, debit: Math.max(0, l.debit) + Math.max(0, -l.credit), credit: Math.max(0, l.credit) + Math.max(0, -l.debit) } : l));
    const dr = U.r2(clean.reduce((s, l) => s + l.debit, 0));
    const cr = U.r2(clean.reduce((s, l) => s + l.credit, 0));
    if (Math.abs(dr - cr) > 0.011) throw Object.assign(new Error(`Journal does not balance (${dr} vs ${cr})`), { status: 400 });
    if (!clean.length) { if (old) run('DELETE FROM journals WHERE id = ?', old.id); return null; }
    // put any rounding cent on the largest line
    if (dr !== cr) { const big = clean.reduce((a, b) => (a.credit > b.credit ? a : b)); big.credit = U.r2(big.credit + dr - cr); }
    let id;
    if (old) {
      run('UPDATE journals SET date = ?, description = ? WHERE id = ?', date, description, old.id);
      run('DELETE FROM journal_lines WHERE journal_id = ?', old.id);
      id = old.id;
    } else {
      id = Number(run('INSERT INTO journals (number, date, description, source, source_id, status, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)',
        U.nextNumber('journal'), date, description, source, source_id, 'posted', user_id).lastInsertRowid);
    }
    for (const l of clean) run('INSERT INTO journal_lines (journal_id, account_id, debit, credit, party, memo) VALUES (?, ?, ?, ?, ?, ?)', id, l.account_id, l.debit, l.credit, l.party, l.memo);
    return id;
  });
}
function unpost(source, source_id) {
  run('DELETE FROM journals WHERE source = ? AND source_id = ?', source, source_id);
}

// Balance of each account (debit − credit) for a date range (posted journals only)
function balances({ from = null, to = null } = {}) {
  const where = ["j.status = 'posted'"];
  const params = [];
  if (from) { where.push('j.date >= ?'); params.push(from); }
  if (to) { where.push('j.date <= ?'); params.push(to); }
  const rows = all(`SELECT a.*, COALESCE(t.dr, 0) dr, COALESCE(t.cr, 0) cr FROM accounts a
    LEFT JOIN (SELECT l.account_id, SUM(l.debit) dr, SUM(l.credit) cr FROM journal_lines l JOIN journals j ON j.id = l.journal_id
      WHERE ${where.join(' AND ')} GROUP BY l.account_id) t ON t.account_id = a.id
    ORDER BY a.code`, ...params);
  return rows.map((a) => ({ ...a, dr: U.r2(a.dr), cr: U.r2(a.cr), balance: U.r2(a.dr - a.cr) }));
}
const NATURAL_DEBIT = { asset: true, expense: true, liability: false, equity: false, income: false };
// Shown the "normal" way round: assets/expenses positive when debit, the rest positive when credit
const natural = (a) => (NATURAL_DEBIT[a.type] ? a.balance : -a.balance);

function profitAndLoss(from, to) {
  const b = balances({ from, to });
  const income = b.filter((a) => a.type === 'income' && a.balance).map((a) => ({ ...a, amount: natural(a) }));
  const cos = b.filter((a) => a.type === 'expense' && a.code < '6000' && a.balance).map((a) => ({ ...a, amount: natural(a) }));
  const opex = b.filter((a) => a.type === 'expense' && a.code >= '6000' && a.balance).map((a) => ({ ...a, amount: natural(a) }));
  const sum = (xs) => U.r2(xs.reduce((s, a) => s + a.amount, 0));
  const revenue = sum(income);
  const costOfSales = sum(cos);
  const expenses = sum(opex);
  return { from, to, income, cos, opex, revenue, cost_of_sales: costOfSales, gross_profit: U.r2(revenue - costOfSales), expenses, net_profit: U.r2(revenue - costOfSales - expenses) };
}

function balanceSheet(asOf) {
  const b = balances({ to: asOf });
  const pick = (type) => b.filter((a) => a.type === type && a.balance).map((a) => ({ ...a, amount: natural(a) }));
  const assets = pick('asset');
  const liabilities = pick('liability');
  const equity = pick('equity');
  // profit not yet closed into retained earnings
  const earnings = U.r2(b.filter((a) => a.type === 'income').reduce((s, a) => s - a.balance, 0) - b.filter((a) => a.type === 'expense').reduce((s, a) => s + a.balance, 0));
  const sum = (xs) => U.r2(xs.reduce((s, a) => s + a.amount, 0));
  return {
    as_of: asOf, assets, liabilities, equity, earnings,
    total_assets: sum(assets), total_liabilities: sum(liabilities), total_equity: U.r2(sum(equity) + earnings),
  };
}

function vatReturn(from, to) {
  const lines = (key) => get(`SELECT COALESCE(SUM(l.debit), 0) dr, COALESCE(SUM(l.credit), 0) cr FROM journal_lines l JOIN journals j ON j.id = l.journal_id
    WHERE l.account_id = ? AND j.status = 'posted' AND j.date BETWEEN ? AND ?`, acct(key), from, to);
  const out = lines('vat_out');
  const inn = lines('vat_in');
  const sales = get(`SELECT COALESCE(SUM(subtotal - discount), 0) net, COALESCE(SUM(vat), 0) vat FROM invoices WHERE status NOT IN ('draft','cancelled') AND date BETWEEN ? AND ?`, from, to);
  const purchases = get(`SELECT COALESCE(SUM(subtotal), 0) net, COALESCE(SUM(vat), 0) vat FROM receipts WHERE date BETWEEN ? AND ?`, from, to);
  const expenses = get(`SELECT COALESCE(SUM(amount), 0) net, COALESCE(SUM(vat), 0) vat FROM expenses WHERE date BETWEEN ? AND ?`, from, to);
  const outputVat = U.r2(out.cr - out.dr);
  const inputVat = U.r2(inn.dr - inn.cr);
  return {
    from, to, sales_net: U.r2(sales.net), output_vat: outputVat,
    purchases_net: U.r2(purchases.net + expenses.net), input_vat: inputVat, net_vat: U.r2(outputVat - inputVat),
  };
}

function ledger(accountId, from, to) {
  const a = get('SELECT * FROM accounts WHERE id = ?', accountId);
  if (!a) return null;
  const opening = get(`SELECT COALESCE(SUM(l.debit - l.credit), 0) b FROM journal_lines l JOIN journals j ON j.id = l.journal_id
    WHERE l.account_id = ? AND j.status = 'posted' AND j.date < ?`, a.id, from).b;
  let bal = U.r2(opening);
  const rows = all(`SELECT l.*, j.number, j.date, j.description, j.source, j.source_id FROM journal_lines l JOIN journals j ON j.id = l.journal_id
    WHERE l.account_id = ? AND j.status = 'posted' AND j.date BETWEEN ? AND ? ORDER BY j.date, j.id`, a.id, from, to)
    .map((r) => { bal = U.r2(bal + r.debit - r.credit); return { ...r, balance: bal }; });
  return { account: a, opening: U.r2(opening), closing: bal, rows };
}

function bucket(days) {
  if (days <= 0) return 'current';
  if (days <= 30) return 'd30';
  if (days <= 60) return 'd60';
  if (days <= 90) return 'd90';
  return 'd90p';
}
function receivablesAgeing(asOf = U.today()) {
  const rows = all(`SELECT i.id, i.number, i.date, i.due_date, i.total, i.paid, c.id contact_id, c.name contact_name FROM invoices i
    LEFT JOIN contacts c ON c.id = i.contact_id WHERE i.status IN ('unpaid','partial') ORDER BY i.due_date`);
  return rows.map((r) => {
    const days = Math.floor((new Date(asOf) - new Date(r.due_date || r.date)) / 864e5);
    return { ...r, balance: U.r2(r.total - r.paid), days_overdue: days, bucket: bucket(days) };
  }).filter((r) => r.balance > 0.009);
}
function payablesAgeing(asOf = U.today()) {
  const rows = all(`SELECT p.id, p.number, p.date, p.expected_date, p.received_value, p.paid, v.id vendor_id, v.name vendor_name FROM purchase_orders p
    LEFT JOIN vendors v ON v.id = p.vendor_id WHERE p.received_value - p.paid > 0.009 AND p.status != 'cancelled' ORDER BY p.date`);
  return rows.map((r) => {
    const days = Math.floor((new Date(asOf) - new Date(r.date)) / 864e5) - 30; // suppliers: 30-day terms
    return { ...r, balance: U.r2(r.received_value - r.paid), days_overdue: days, bucket: bucket(days) };
  });
}
const moneyAccounts = () => all('SELECT id, code, name, key FROM accounts WHERE is_money = 1 AND active = 1 ORDER BY code');
function moneyBalances() {
  return moneyAccounts().map((a) => ({
    ...a, balance: U.r2(get(`SELECT COALESCE(SUM(l.debit - l.credit), 0) b FROM journal_lines l JOIN journals j ON j.id = l.journal_id WHERE l.account_id = ? AND j.status = 'posted'`, a.id).b),
  }));
}
// Which cash/bank account a payment method lands in by default
const accountForMethod = (method) => acct(method === 'cash' ? 'cash' : 'bank');

function register(ctx) {
  const { app, h, need, fail, clean } = ctx;

  app.get('/api/accounts', h((req) => ({
    accounts: (ctx.can(req.user, 'accounting') ? balances() : []).map((a) => ({ ...a, natural: natural(a) })),
    money: moneyAccounts(),
    expense_categories: all('SELECT id, code, name FROM accounts WHERE is_expense_category = 1 AND active = 1 ORDER BY code'),
  })));
  app.post('/api/accounts', need('accounting', 'create'), h((req) => {
    const b = req.body;
    const code = clean(b.code, 10); const name = clean(b.name, 120);
    if (!code || !name) fail(400, 'Code and name are required');
    if (!['asset', 'liability', 'equity', 'income', 'expense'].includes(b.type)) fail(400, 'Pick a type');
    if (get('SELECT id FROM accounts WHERE code = ?', code)) fail(400, 'That code is already used');
    const r = run('INSERT INTO accounts (code, name, type, is_money, is_expense_category, description) VALUES (?, ?, ?, ?, ?, ?)',
      code, name, b.type, b.type === 'asset' && b.is_money ? 1 : 0, b.type === 'expense' && b.is_expense_category ? 1 : 0, clean(b.description, 300));
    return { id: Number(r.lastInsertRowid) };
  }));
  app.patch('/api/accounts/:id', need('accounting', 'edit'), h((req) => {
    const a = get('SELECT * FROM accounts WHERE id = ?', req.params.id);
    if (!a) fail(404, 'Account not found');
    const b = req.body;
    if (b.name !== undefined && clean(b.name, 120)) run('UPDATE accounts SET name = ? WHERE id = ?', clean(b.name, 120), a.id);
    if (b.description !== undefined) run('UPDATE accounts SET description = ? WHERE id = ?', clean(b.description, 300), a.id);
    if (b.active !== undefined && !a.key) run('UPDATE accounts SET active = ? WHERE id = ?', b.active ? 1 : 0, a.id);
    if (b.is_money !== undefined && a.type === 'asset') run('UPDATE accounts SET is_money = ? WHERE id = ?', b.is_money ? 1 : 0, a.id);
    if (b.is_expense_category !== undefined && a.type === 'expense') run('UPDATE accounts SET is_expense_category = ? WHERE id = ?', b.is_expense_category ? 1 : 0, a.id);
    return { ok: true };
  }));

  app.get('/api/journals', need('accounting'), h((req) => {
    const where = ['1=1']; const p = [];
    if (U.isDate(req.query.from)) { where.push('j.date >= ?'); p.push(req.query.from); }
    if (U.isDate(req.query.to)) { where.push('j.date <= ?'); p.push(req.query.to); }
    if (req.query.source) { where.push('j.source = ?'); p.push(String(req.query.source)); }
    if (req.query.q) { where.push('(j.number LIKE ? OR j.description LIKE ?)'); p.push(`%${req.query.q}%`, `%${req.query.q}%`); }
    const rows = all(`SELECT j.*, (SELECT SUM(debit) FROM journal_lines WHERE journal_id = j.id) amount FROM journals j WHERE ${where.join(' AND ')} ORDER BY j.date DESC, j.id DESC LIMIT 500`, ...p);
    return { journals: rows };
  }));
  app.get('/api/journals/:id', need('accounting'), h((req) => {
    const j = get('SELECT * FROM journals WHERE id = ?', req.params.id);
    if (!j) fail(404, 'Journal not found');
    return { journal: j, lines: all('SELECT l.*, a.code, a.name account_name FROM journal_lines l JOIN accounts a ON a.id = l.account_id WHERE l.journal_id = ? ORDER BY l.debit DESC, l.id', j.id) };
  }));
  function saveManual(req, existing) {
    const b = req.body;
    if (!U.isDate(b.date)) fail(400, 'Pick a date');
    const lines = (b.lines || []).map((l) => ({ account_id: Number(l.account_id), debit: U.num(l.debit), credit: U.num(l.credit), memo: clean(l.memo, 200) }))
      .filter((l) => l.account_id && (l.debit || l.credit));
    if (lines.length < 2) fail(400, 'A journal needs at least two lines');
    for (const l of lines) if (!get('SELECT id FROM accounts WHERE id = ?', l.account_id)) fail(400, 'Unknown account');
    const dr = U.r2(lines.reduce((s, l) => s + l.debit, 0)); const cr = U.r2(lines.reduce((s, l) => s + l.credit, 0));
    if (Math.abs(dr - cr) > 0.009) fail(400, `Debits (${dr}) and credits (${cr}) must be equal`);
    const status = b.status === 'draft' ? 'draft' : 'posted';
    return tx(() => {
      let id = existing?.id;
      if (existing) {
        run('UPDATE journals SET date = ?, description = ?, status = ? WHERE id = ?', b.date, clean(b.description, 300), status, id);
        run('DELETE FROM journal_lines WHERE journal_id = ?', id);
      } else {
        id = Number(run('INSERT INTO journals (number, date, description, source, status, created_by) VALUES (?, ?, ?, ?, ?, ?)',
          U.nextNumber('manual_journal'), b.date, clean(b.description, 300), b.source === 'opening' ? 'opening' : 'manual', status, req.user.id).lastInsertRowid);
      }
      for (const l of lines) run('INSERT INTO journal_lines (journal_id, account_id, debit, credit, memo) VALUES (?, ?, ?, ?, ?)', id, l.account_id, U.r2(l.debit), U.r2(l.credit), l.memo);
      return { id };
    });
  }
  app.post('/api/journals', need('accounting', 'create'), h((req) => saveManual(req, null)));
  app.put('/api/journals/:id', need('accounting', 'edit'), h((req) => {
    const j = get('SELECT * FROM journals WHERE id = ?', req.params.id);
    if (!j) fail(404, 'Journal not found');
    if (!['manual', 'opening'].includes(j.source)) fail(400, 'Automatic journals change when their document changes');
    return saveManual(req, j);
  }));
  app.delete('/api/journals/:id', need('accounting', 'delete'), h((req) => {
    const j = get('SELECT * FROM journals WHERE id = ?', req.params.id);
    if (!j) fail(404, 'Journal not found');
    if (!['manual', 'opening'].includes(j.source)) fail(400, 'Automatic journals are removed with their document');
    run('DELETE FROM journals WHERE id = ?', j.id);
    return { ok: true };
  }));

  const range = (q) => {
    const to = U.isDate(q.to) ? q.to : U.today();
    const from = U.isDate(q.from) ? q.from : `${to.slice(0, 4)}-01-01`;
    return { from, to };
  };
  app.get('/api/books/trial-balance', need('accounting'), h((req) => {
    const to = U.isDate(req.query.to) ? req.query.to : U.today();
    const rows = balances({ to }).filter((a) => a.dr || a.cr);
    return { to, rows, total_dr: U.r2(rows.reduce((s, a) => s + Math.max(a.balance, 0), 0)), total_cr: U.r2(rows.reduce((s, a) => s + Math.max(-a.balance, 0), 0)) };
  }));
  app.get('/api/books/pnl', need('accounting'), h((req) => { const { from, to } = range(req.query); return profitAndLoss(from, to); }));
  app.get('/api/books/balance-sheet', need('accounting'), h((req) => balanceSheet(U.isDate(req.query.to) ? req.query.to : U.today())));
  app.get('/api/books/vat', need('accounting'), h((req) => {
    const to = U.isDate(req.query.to) ? req.query.to : U.monthEnd();
    const from = U.isDate(req.query.from) ? req.query.from : U.monthStart();
    return vatReturn(from, to);
  }));
  app.get('/api/books/ledger/:id', need('accounting'), h((req) => {
    const { from, to } = range(req.query);
    const l = ledger(Number(req.params.id), from, to);
    if (!l) fail(404, 'Account not found');
    return { from, to, ...l };
  }));
  app.get('/api/books/ageing', h((req) => {
    if (!ctx.can(req.user, 'accounting') && !ctx.can(req.user, 'invoices')) fail(403, 'No access');
    return { receivables: receivablesAgeing(), payables: ctx.can(req.user, 'purchases') || ctx.can(req.user, 'accounting') ? payablesAgeing() : [] };
  }));
  app.get('/api/books/money', need('accounting'), h(() => ({ accounts: moneyBalances() })));
}

module.exports = {
  register, post, unpost, acct, balances, profitAndLoss, balanceSheet, vatReturn, receivablesAgeing, payablesAgeing,
  moneyAccounts, moneyBalances, accountForMethod, natural,
};
