// Home dashboard (what each person needs today) and sales reports: funnel, leads by source, sales by person,
// month vs last month, product mix, profit per deal.
const { all, get } = require('./db');
const U = require('./util');
const books = require('./accounting');
const crm = require('./crm');
const catalog = require('./catalog');
const jobs = require('./jobs');
const { can, scope } = require('./perms');

function prevMonth(date) {
  const d = new Date(date.slice(0, 7) + '-01T00:00:00Z');
  d.setUTCMonth(d.getUTCMonth() - 1);
  return d.toISOString().slice(0, 10);
}
const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : 0);

function funnel(from, to, ownerId = null) {
  const own = ownerId ? ` AND owner_id = ${Number(ownerId)}` : '';
  const leads = get(`SELECT COUNT(*) n FROM leads WHERE date(created_at) BETWEEN ? AND ?${own}`, from, to).n;
  const deals = get(`SELECT COUNT(*) n, COALESCE(SUM(value), 0) v FROM deals WHERE date(created_at) BETWEEN ? AND ?${own}`, from, to);
  const quotes = get(`SELECT COUNT(DISTINCT COALESCE(deal_id, -id)) n, COALESCE(SUM(subtotal - discount), 0) v FROM quotes WHERE status != 'draft' AND date BETWEEN ? AND ?${own}`, from, to);
  const won = get(`SELECT COUNT(*) n, COALESCE(SUM(value), 0) v FROM deals WHERE stage = 'won' AND date(won_at) BETWEEN ? AND ?${own}`, from, to);
  return {
    leads, deals: deals.n, deals_value: U.r2(deals.v), quotes: quotes.n, quotes_value: U.r2(quotes.v), won: won.n, won_value: U.r2(won.v),
    lead_to_deal: pct(deals.n, leads), deal_to_quote: pct(quotes.n, deals.n), quote_to_won: pct(won.n, quotes.n),
  };
}
function bySource(from, to) {
  const rows = all(`SELECT source, COUNT(*) n, SUM(status = 'converted') converted FROM leads WHERE date(created_at) BETWEEN ? AND ? GROUP BY source ORDER BY n DESC`, from, to);
  const total = rows.reduce((s, r) => s + r.n, 0);
  return rows.map((r) => ({
    ...r, share: pct(r.n, total),
    won_value: U.r2(get(`SELECT COALESCE(SUM(d.value), 0) v FROM deals d WHERE d.stage = 'won' AND d.source = ? AND date(d.created_at) BETWEEN ? AND ?`, r.source, from, to).v),
  }));
}
function pipeline(ownerId = null) {
  const own = ownerId ? ` AND owner_id = ${Number(ownerId)}` : '';
  return crm.STAGES.filter((s) => !['won', 'lost'].includes(s)).map((s) => {
    const r = get(`SELECT COUNT(*) n, COALESCE(SUM(value), 0) v FROM deals WHERE stage = ?${own}`, s);
    return { stage: s, label: crm.STAGE_LABEL[s], count: r.n, value: U.r2(r.v) };
  });
}
function salesMonth(date) {
  const from = U.monthStart(date); const to = U.monthEnd(date);
  const inv = get(`SELECT COUNT(*) n, COALESCE(SUM(total), 0) t, COALESCE(SUM(subtotal - discount), 0) net FROM invoices WHERE status NOT IN ('draft','cancelled') AND date BETWEEN ? AND ?`, from, to);
  const incoming = get('SELECT COALESCE(SUM(amount), 0) t FROM payments WHERE date BETWEEN ? AND ?', from, to).t;
  const outgoing = get('SELECT COALESCE(SUM(amount), 0) t FROM vendor_payments WHERE date BETWEEN ? AND ?', from, to).t + get('SELECT COALESCE(SUM(total), 0) t FROM expenses WHERE date BETWEEN ? AND ?', from, to).t;
  return { from, to, invoices: inv.n, total: U.r2(inv.t), net: U.r2(inv.net), incoming: U.r2(incoming), outgoing: U.r2(outgoing) };
}
// Invoiced per week of the month (for the chart)
function weekly(date) {
  const from = U.monthStart(date); const end = U.monthEnd(date);
  const out = [];
  for (let w = 0; w < 5; w++) {
    const a = U.addDays(from, w * 7); if (a > end) break;
    const b = w === 4 ? end : U.addDays(a, 6) > end ? end : U.addDays(a, 6);
    out.push({ label: `Week ${w + 1}`, from: a, to: b, total: U.r2(get(`SELECT COALESCE(SUM(total), 0) t FROM invoices WHERE status NOT IN ('draft','cancelled') AND date BETWEEN ? AND ?`, a, b).t) });
  }
  return out;
}
function monthly(months = 12) {
  const out = [];
  let d = U.monthStart();
  const list = [];
  for (let i = 0; i < months; i++) { list.unshift(d); d = prevMonth(d); }
  for (const m of list) {
    const r = get(`SELECT COALESCE(SUM(subtotal - discount), 0) net FROM invoices WHERE status NOT IN ('draft','cancelled') AND date BETWEEN ? AND ?`, m, U.monthEnd(m));
    const won = get(`SELECT COALESCE(SUM(value), 0) v, COUNT(*) n FROM deals WHERE stage = 'won' AND date(won_at) BETWEEN ? AND ?`, m, U.monthEnd(m));
    const paid = get('SELECT COALESCE(SUM(amount), 0) t FROM payments WHERE date BETWEEN ? AND ?', m, U.monthEnd(m)).t;
    out.push({ month: m.slice(0, 7), invoiced: U.r2(r.net), won: U.r2(won.v), won_count: won.n, collected: U.r2(paid) });
  }
  return out;
}
function byPerson(from, to) {
  return all('SELECT id, name, color FROM users WHERE active = 1 ORDER BY name').map((u) => {
    const leads = get('SELECT COUNT(*) n FROM leads WHERE owner_id = ? AND date(created_at) BETWEEN ? AND ?', u.id, from, to).n;
    const won = get(`SELECT COUNT(*) n, COALESCE(SUM(value), 0) v FROM deals WHERE owner_id = ? AND stage = 'won' AND date(won_at) BETWEEN ? AND ?`, u.id, from, to);
    const lost = get(`SELECT COUNT(*) n FROM deals WHERE owner_id = ? AND stage = 'lost' AND date(lost_at) BETWEEN ? AND ?`, u.id, from, to).n;
    const quotes = get(`SELECT COUNT(*) n, COALESCE(SUM(subtotal - discount), 0) v FROM quotes WHERE owner_id = ? AND status != 'draft' AND date BETWEEN ? AND ?`, u.id, from, to);
    const invoiced = get(`SELECT COALESCE(SUM(i.subtotal - i.discount), 0) v FROM invoices i JOIN deals d ON d.id = i.deal_id WHERE d.owner_id = ? AND i.status NOT IN ('draft','cancelled') AND i.date BETWEEN ? AND ?`, u.id, from, to).v;
    const open = get(`SELECT COUNT(*) n, COALESCE(SUM(value), 0) v FROM deals WHERE owner_id = ? AND stage NOT IN ('won','lost')`, u.id);
    return { ...u, leads, won: won.n, won_value: U.r2(won.v), lost, quotes: quotes.n, quotes_value: U.r2(quotes.v), invoiced: U.r2(invoiced), open: open.n, open_value: U.r2(open.v), win_rate: pct(won.n, won.n + lost) };
  }).filter((r) => r.leads || r.won || r.quotes || r.open || r.invoiced);
}
function productMix(from, to) {
  return all(`SELECT COALESCE(p.category, 'other') category, SUM(ii.qty) qty, SUM(ii.qty * ii.price) value FROM invoice_items ii JOIN invoices i ON i.id = ii.invoice_id
    LEFT JOIN products p ON p.id = ii.product_id WHERE i.status NOT IN ('draft','cancelled') AND i.kind != 'advance' AND ii.kind = 'item' AND ii.price > 0 AND i.date BETWEEN ? AND ?
    GROUP BY category ORDER BY value DESC`, from, to).map((r) => ({ ...r, label: catalog.CATEGORIES[r.category] || 'Other', qty: U.r2(r.qty), value: U.r2(r.value) }));
}
function topCustomers(from, to) {
  return all(`SELECT c.id, c.name, COUNT(i.id) invoices, SUM(i.total) total, SUM(i.paid) paid FROM invoices i JOIN contacts c ON c.id = i.contact_id
    WHERE i.status NOT IN ('draft','cancelled') AND i.date BETWEEN ? AND ? GROUP BY c.id ORDER BY total DESC LIMIT 10`, from, to).map((r) => ({ ...r, total: U.r2(r.total), paid: U.r2(r.paid) }));
}
function dealProfits(from, to) {
  return all(`SELECT d.id, d.code, d.title, c.name contact_name, u.name owner_name, d.won_at FROM deals d LEFT JOIN contacts c ON c.id = d.contact_id LEFT JOIN users u ON u.id = d.owner_id
    WHERE d.stage = 'won' AND date(d.won_at) BETWEEN ? AND ? ORDER BY d.won_at DESC LIMIT 200`, from, to).map((d) => {
    const s = crm.dealSummary(d.id);
    // until the installation is signed off, costs aren't all in yet: use the quotation's planned cost
    const installed = !!get(`SELECT 1 FROM jobs WHERE deal_id = ? AND status = 'signed_off'`, d.id);
    const planned = !installed && s.quote_id ? get('SELECT cost_total FROM quotes WHERE id = ?', s.quote_id).cost_total : null;
    const revenue = installed ? s.invoiced_net || s.quoted : s.quoted;
    const cost = planned !== null ? Math.max(s.cost, planned) : s.cost;
    return { ...d, quoted: s.quoted, invoiced: s.invoiced_net, paid: s.paid, cost, planned: planned !== null, profit: U.r2(revenue - cost), margin: pct(revenue - cost, revenue), sqm: s.sqm };
  });
}

function register(ctx) {
  const { app, h, need } = ctx;

  app.get('/api/dashboard', h((req) => {
    const u = req.user;
    const t = U.today();
    const out = { today: t };
    // my day
    out.my_activities = all(`SELECT a.*, d.title deal_title, l.name lead_name, c.name contact_name, c.phone contact_phone FROM activities a
      LEFT JOIN deals d ON d.id = a.deal_id LEFT JOIN leads l ON l.id = a.lead_id LEFT JOIN contacts c ON c.id = a.contact_id
      WHERE a.assigned_to = ? AND a.status = 'planned' AND a.date <= ? ORDER BY a.date, a.start_time LIMIT 30`, u.id, U.addDays(t, 1));
    if (can(u, 'jobs')) {
      const own = scope(u, 'jobs') !== 'all';
      out.jobs_today = all(`SELECT j.*, c.name contact_name, c.phone contact_phone FROM jobs j LEFT JOIN contacts c ON c.id = j.contact_id
        WHERE j.status NOT IN ('cancelled','signed_off') AND j.date IS NOT NULL AND j.date <= ? AND COALESCE(j.end_date, j.date) >= ? ORDER BY j.date, j.start_time`, U.addDays(t, 1), t)
        .filter((j) => (own ? jobs.installersOf(j).includes(u.id) || jobs.canSeeJob(u, j) : true))
        .map((j) => ({ ...j, sign_token: undefined, installers: jobs.installersOf(j) }));
      out.jobs_unscheduled = scope(u, 'jobs') === 'all' ? get(`SELECT COUNT(*) n FROM jobs WHERE date IS NULL AND status = 'scheduled'`).n : 0;
      out.jobs_awaiting_signoff = get(`SELECT COUNT(*) n FROM jobs WHERE status = 'completed'`).n;
    }
    if (can(u, 'crm')) {
      const mine = scope(u, 'crm') !== 'all';
      const ownL = mine ? ` AND (owner_id = ${u.id} OR created_by = ${u.id})` : '';
      out.leads_new = get(`SELECT COUNT(*) n FROM leads WHERE status = 'new'${ownL}`).n;
      out.leads_due = all(`SELECT id, code, name, phone, source, status, next_follow_up FROM leads WHERE status IN ('new','contacted','qualified') AND (next_follow_up IS NULL OR next_follow_up <= ?) AND owner_id = ? ORDER BY next_follow_up LIMIT 20`, t, u.id);
      out.deals_due = all(`SELECT id, code, title, stage, value, next_follow_up FROM deals WHERE stage NOT IN ('won','lost') AND next_follow_up <= ? AND owner_id = ? ORDER BY next_follow_up LIMIT 20`, t, u.id);
      out.pipeline = pipeline(mine ? u.id : null);
      out.funnel = funnel(U.monthStart(t), t, mine ? u.id : null);
      if (!mine) out.sources = bySource(U.monthStart(t), t);
    }
    if (can(u, 'warranty') || can(u, 'crm')) {
      out.followups_due = all(`SELECT f.*, c.name contact_name FROM followups f LEFT JOIN contacts c ON c.id = f.contact_id WHERE f.status = 'pending' AND f.due_date <= ? AND f.assigned_to = ? ORDER BY f.due_date LIMIT 20`, t, u.id);
    }
    if (can(u, 'quotes')) {
      const own = scope(u, 'quotes') === 'all' ? '' : ` AND owner_id = ${u.id}`;
      out.quotes_waiting = all(`SELECT q.id, q.number, q.total, q.sent_at, q.valid_until, q.viewed_at, c.name contact_name FROM quotes q LEFT JOIN contacts c ON c.id = q.contact_id WHERE q.status = 'sent'${own} ORDER BY q.sent_at LIMIT 10`);
    }
    if (can(u, 'invoices') && scope(u, 'invoices') === 'all') {
      out.this_month = salesMonth(t);
      out.last_month = salesMonth(prevMonth(t));
      out.weekly = weekly(t);
      const ar = books.receivablesAgeing();
      out.receivables = { total: U.r2(ar.reduce((s, r) => s + r.balance, 0)), overdue: U.r2(ar.filter((r) => r.days_overdue > 0).reduce((s, r) => s + r.balance, 0)), count: ar.filter((r) => r.days_overdue > 0).length };
      out.to_invoice = all(`SELECT d.id, d.code, d.title, q.id quote_id, q.number, (q.subtotal - q.discount) - COALESCE((SELECT SUM(subtotal - discount) FROM invoices i WHERE i.quote_id = q.id AND i.status != 'cancelled'), 0) remaining
        FROM quotes q JOIN deals d ON d.id = q.deal_id WHERE q.status = 'accepted' ORDER BY q.accepted_at DESC LIMIT 50`).filter((r) => r.remaining > 0.009).slice(0, 8);
    }
    if (can(u, 'accounting')) out.money = books.moneyBalances();
    if (can(u, 'inventory')) {
      out.low_stock = all('SELECT id, code, name, unit, min_stock FROM products WHERE active = 1 AND track_stock = 1 AND min_stock > 0')
        .map((p) => ({ ...p, stock: catalog.stockOf(p.id) })).filter((p) => p.stock < p.min_stock);
    }
    return out;
  }));

  app.get('/api/reports/sales', need('reports'), h((req) => {
    const to = U.isDate(req.query.to) ? req.query.to : U.today();
    const from = U.isDate(req.query.from) ? req.query.from : U.monthStart(to);
    const out = {
      from, to, funnel: funnel(from, to), sources: bySource(from, to), people: byPerson(from, to), pipeline: pipeline(),
      this_month: salesMonth(to), last_month: salesMonth(prevMonth(to)), weekly: weekly(to), monthly: monthly(12),
      products: productMix(from, to), customers: topCustomers(from, to),
      lost_reasons: all(`SELECT COALESCE(NULLIF(lost_reason, ''), 'Not given') reason, COUNT(*) n, COALESCE(SUM(value), 0) v FROM deals WHERE stage = 'lost' AND date(lost_at) BETWEEN ? AND ? GROUP BY reason ORDER BY n DESC`, from, to),
      jobs: {
        done: get(`SELECT COUNT(*) n FROM jobs WHERE status = 'signed_off' AND date(signed_at) BETWEEN ? AND ?`, from, to).n,
        sqm: U.r2(get(`SELECT COALESCE(SUM(-m.qty), 0) q FROM stock_moves m WHERE m.qty < 0 AND m.date BETWEEN ? AND ?`, from, to).q),
        rating: get(`SELECT ROUND(AVG(rating), 1) r, COUNT(rating) n FROM jobs WHERE rating IS NOT NULL AND date(signed_at) BETWEEN ? AND ?`, from, to),
      },
    };
    if (can(req.user, 'see_costs')) out.profits = dealProfits(from, to);
    return out;
  }));
}

module.exports = { register, funnel, salesMonth, pipeline };
