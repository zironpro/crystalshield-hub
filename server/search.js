// ⌘K search across customers, leads, deals, quotations, invoices, jobs, products and purchase orders.
const { all } = require('./db');
const crm = require('./crm');
const sales = require('./sales');
const jobs = require('./jobs');
const { can } = require('./perms');

function register(ctx) {
  ctx.app.get('/api/search', ctx.h((req) => {
    const q = String(req.query.q || '').trim();
    if (q.length < 2) return { results: [] };
    const like = `%${q}%`;
    const digits = q.replace(/[^\d]/g, '');
    const phone = digits.length >= 5 ? `%${digits.slice(-7)}%` : '__none__';
    const u = req.user;
    const out = [];
    const add = (type, rows, map) => { for (const r of rows) { const m = map(r); if (m) out.push({ type, ...m }); } };
    if (can(u, 'crm')) {
      add('contact', all(`SELECT * FROM contacts WHERE name LIKE ? OR contact_person LIKE ? OR email LIKE ? OR code LIKE ? OR replace(replace(phone, ' ', ''), '-', '') LIKE ? LIMIT 12`, like, like, like, like, phone),
        (c) => crm.canSeeContact(u, c) && { id: c.id, title: c.name, sub: [c.code, c.phone, c.contact_person].filter(Boolean).join(' · '), link: `contacts/${c.id}` });
      add('lead', all(`SELECT * FROM leads WHERE name LIKE ? OR company LIKE ? OR email LIKE ? OR code LIKE ? OR replace(replace(phone, ' ', ''), '-', '') LIKE ? ORDER BY id DESC LIMIT 12`, like, like, like, like, phone),
        (l) => crm.canSeeLead(u, l) && { id: l.id, title: l.name, sub: [l.code, l.source, l.status, l.phone].filter(Boolean).join(' · '), link: `leads/${l.id}` });
      add('deal', all(`SELECT d.*, c.name contact_name FROM deals d LEFT JOIN contacts c ON c.id = d.contact_id WHERE d.title LIKE ? OR d.code LIKE ? OR c.name LIKE ? ORDER BY d.id DESC LIMIT 12`, like, like, like),
        (d) => crm.canSeeDeal(u, d) && { id: d.id, title: d.title, sub: [d.code, crm.STAGE_LABEL[d.stage], d.contact_name].filter(Boolean).join(' · '), link: `deals/${d.id}` });
    }
    if (can(u, 'quotes')) add('quote', all(`SELECT q.*, c.name contact_name FROM quotes q LEFT JOIN contacts c ON c.id = q.contact_id WHERE q.number LIKE ? OR q.subject LIKE ? OR c.name LIKE ? ORDER BY q.id DESC LIMIT 10`, like, like, like),
      (x) => sales.canSeeQuote(u, x) && { id: x.id, title: `${x.number} · ${x.contact_name || ''}`, sub: `${x.status} · AED ${x.total.toLocaleString('en-US')}`, link: `quotes/${x.id}` });
    if (can(u, 'invoices')) add('invoice', all(`SELECT i.*, c.name contact_name FROM invoices i LEFT JOIN contacts c ON c.id = i.contact_id WHERE i.number LIKE ? OR c.name LIKE ? ORDER BY i.id DESC LIMIT 10`, like, like),
      (x) => sales.canSeeInvoice(u, x) && { id: x.id, title: `${x.number} · ${x.contact_name || ''}`, sub: `${x.status} · AED ${x.total.toLocaleString('en-US')}`, link: `invoices/${x.id}` });
    if (can(u, 'jobs')) add('job', all(`SELECT j.*, c.name contact_name FROM jobs j LEFT JOIN contacts c ON c.id = j.contact_id WHERE j.number LIKE ? OR j.title LIKE ? OR c.name LIKE ? OR j.address LIKE ? ORDER BY j.id DESC LIMIT 10`, like, like, like, like),
      (j) => jobs.canSeeJob(u, j) && { id: j.id, title: `${j.number} · ${j.contact_name || j.title}`, sub: [j.date, jobs.STATUS_LABEL[j.status], j.address].filter(Boolean).join(' · '), link: `jobs/${j.id}` });
    if (can(u, 'inventory') || can(u, 'crm')) add('product', all(`SELECT * FROM products WHERE name LIKE ? OR code LIKE ? OR brand LIKE ? LIMIT 8`, like, like, like),
      (p) => ({ id: p.id, title: p.name, sub: [p.code, p.brand, `AED ${p.sell_price}/${p.unit}`].filter(Boolean).join(' · '), link: `products/${p.id}` }));
    if (can(u, 'purchases')) add('po', all(`SELECT p.*, v.name vendor_name FROM purchase_orders p LEFT JOIN vendors v ON v.id = p.vendor_id WHERE p.number LIKE ? OR v.name LIKE ? OR p.vendor_ref LIKE ? ORDER BY p.id DESC LIMIT 8`, like, like, like),
      (p) => ({ id: p.id, title: `${p.number} · ${p.vendor_name || ''}`, sub: `${p.status} · AED ${p.total.toLocaleString('en-US')}`, link: `purchases/${p.id}` }));
    return { results: out.slice(0, 60) };
  }));
}
module.exports = { register };
