// Customer-facing documents served by secret link (no sign-in): quotation (customer can accept online),
// invoice, payment receipt, purchase order, warranty card, and the remote installation sign-off page.
// Branded A4 layout; "Print / Save as PDF" uses the browser.
const { all, get, run } = require('./db');
const U = require('./util');
const S = require('./settings');

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const money = (n) => U.r2(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qty = (n) => (Math.round(Number(n) * 100) / 100).toLocaleString('en-US', { maximumFractionDigits: 2 });
const dmy = (d) => (d ? new Date(d.length === 10 ? d + 'T00:00:00Z' : d.replace(' ', 'T') + (d.includes('T') ? '' : 'Z')).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '—');
const lines = (s) => String(s || '').split('\n').map((x) => x.replace(/^[•\-*]\s*/, '').trim()).filter(Boolean);

// 18640.5 → "Eighteen Thousand Six Hundred Forty Dirhams and Fifty Fils Only"
function words(n) {
  const a = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const b = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  const three = (x) => {
    let s = '';
    if (x >= 100) { s += `${a[Math.floor(x / 100)]} Hundred`; x %= 100; if (x) s += ' '; }
    if (x >= 20) { s += b[Math.floor(x / 10)]; if (x % 10) s += ` ${a[x % 10]}`; } else if (x) s += a[x];
    return s;
  };
  const say = (x) => {
    if (!x) return 'Zero';
    const parts = [];
    for (const [v, name] of [[1e9, 'Billion'], [1e6, 'Million'], [1e3, 'Thousand'], [1, '']]) {
      if (x >= v) { parts.push(`${three(Math.floor(x / v))}${name ? ` ${name}` : ''}`); x %= v; }
    }
    return parts.join(' ');
  };
  const whole = Math.floor(Math.abs(n));
  const fils = Math.round((Math.abs(n) - whole) * 100);
  return `${say(whole)} Dirham${whole === 1 ? '' : 's'}${fils ? ` and ${say(fils)} Fils` : ''} Only`;
}

function layout({ title, kind, body, toolbar = '', status = '' }) {
  const co = S.company();
  const logo = S.logoFile() ? '/api/company/logo' : '/img/logo-dark.png';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} — ${esc(co.name)}</title><meta name="robots" content="noindex,nofollow">
<link rel="icon" href="/icons/favicon-64.png"><link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Poppins:wght@500;600;700&display=swap" rel="stylesheet">
<style>
:root{--navy:#00386b;--ink:#141c2f;--blue:#0069b7;--sky:#3da4e4;--amber:#fdb13e;--muted:#5d6678;--line:#e3e7ee;--soft:#f4f7fb}
*{box-sizing:border-box}html,body{margin:0}body{background:#e9edf3;color:var(--ink);font:13px/1.5 Inter,system-ui,sans-serif;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.bar{position:sticky;top:0;z-index:5;display:flex;gap:10px;align-items:center;justify-content:center;flex-wrap:wrap;padding:12px 16px;background:#fff;border-bottom:1px solid var(--line)}
.bar .st{font-weight:600;color:var(--muted);margin-right:auto}.bar .st b{color:var(--navy)}
.btn{display:inline-flex;align-items:center;gap:7px;height:40px;padding:0 18px;border-radius:10px;border:1px solid var(--line);background:#fff;color:var(--ink);font:500 14px Inter,sans-serif;text-decoration:none;cursor:pointer}
.btn.primary{background:var(--navy);border-color:var(--navy);color:#fff}.btn.go{background:#1f9d55;border-color:#1f9d55;color:#fff}
.page{width:210mm;min-height:297mm;margin:22px auto;background:#fff;box-shadow:0 18px 50px -24px rgba(0,30,70,.35);padding:16mm 15mm 14mm;position:relative;display:flex;flex-direction:column}
.top{display:flex;justify-content:space-between;align-items:flex-start;gap:20px;padding-bottom:14px;border-bottom:3px solid var(--navy);position:relative}
.top:after{content:"";position:absolute;left:0;bottom:-3px;width:90px;height:3px;background:var(--amber)}
.top img{height:38px;display:block;margin-bottom:8px}.co{font-size:11px;color:var(--muted);line-height:1.55}.co b{color:var(--ink);font-weight:600}
.doctitle{text-align:right}.doctitle h1{font:700 28px Poppins,sans-serif;letter-spacing:.06em;color:var(--navy);margin:0 0 6px}
.meta{border-collapse:collapse;margin-left:auto;font-size:12px}.meta td{padding:2px 0 2px 14px;text-align:right}.meta td:first-child{color:var(--muted)}.meta td:last-child{font-weight:600}
.chip{display:inline-block;padding:3px 10px;border-radius:999px;font:600 11px Inter;letter-spacing:.04em;text-transform:uppercase;background:var(--soft);color:var(--navy);margin-top:6px}
.chip.ok{background:#e3f6ea;color:#17703f}.chip.warn{background:#fff3df;color:#9a5b00}.chip.bad{background:#fdecec;color:#b42318}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin:16px 0 4px}
.box{background:var(--soft);border-radius:10px;padding:12px 14px}.box h3{font:600 10.5px Inter;letter-spacing:.12em;text-transform:uppercase;color:var(--blue);margin:0 0 6px}
.kv{display:grid;grid-template-columns:96px 1fr;gap:3px 10px;font-size:12.5px}.kv span{color:var(--muted)}.kv b{font-weight:600}
.intro{margin:14px 0 6px;color:#333b4d}
h2.sec{font:600 11px Inter;letter-spacing:.12em;text-transform:uppercase;color:var(--blue);margin:16px 0 8px}
table.items{width:100%;border-collapse:collapse;font-size:12.5px}
.items th{background:var(--navy);color:#fff;font:600 10.5px Inter;letter-spacing:.08em;text-transform:uppercase;text-align:left;padding:8px 10px}
.items th.r,.items td.r{text-align:right}.items td{padding:9px 10px;border-bottom:1px solid var(--line);vertical-align:top}
.items tr.hd td{background:#eef3f9;font-weight:600;color:var(--navy);padding:7px 10px}
.it{display:flex;gap:12px;align-items:flex-start}.it img{width:58px;height:58px;object-fit:cover;border-radius:8px;border:1px solid var(--line);flex-shrink:0}
.it b{display:block;font-weight:600;font-size:13px}.it small{display:block;color:var(--muted);font-size:11.5px;white-space:pre-line;margin-top:2px}
.num{color:var(--muted);width:26px}
.sum{display:flex;justify-content:space-between;gap:24px;margin-top:14px;align-items:flex-start}
.words{flex:1;font-size:12px;color:var(--muted);padding-top:6px}.words b{color:var(--ink);display:block;font-weight:600;margin-top:2px}
.totals{width:280px;border-collapse:collapse;font-size:13px}.totals td{padding:5px 0}.totals td:last-child{text-align:right;font-weight:600}
.totals tr.grand td{border-top:2px solid var(--navy);padding-top:9px;font:700 17px Poppins;color:var(--navy)}
.totals tr.paid td{color:#17703f}.totals tr.due td{color:#b42318;font-weight:700}
ul.bul{margin:4px 0 0;padding-left:18px;font-size:12px;color:#333b4d}ul.bul li{margin:2px 0}
.cols{display:grid;grid-template-columns:1fr 1fr;gap:18px}
.sign{display:grid;grid-template-columns:1fr 1fr;gap:28px;margin-top:26px;font-size:12px}.sign div{border-top:1px solid #9aa3b5;padding-top:6px;color:var(--muted)}
.sign b{color:var(--ink);display:block}.sign img{height:56px;display:block;margin-bottom:-4px}
.foot{margin-top:auto;padding-top:14px;border-top:1px solid var(--line);display:flex;justify-content:space-between;gap:10px;font-size:10.5px;color:var(--muted)}
.foot b{color:var(--navy)}
.accept{max-width:210mm;margin:0 auto 30px;background:#fff;border-radius:14px;padding:18px 20px;box-shadow:0 18px 50px -30px rgba(0,30,70,.35)}
.accept h2{font:600 17px Poppins;margin:0 0 4px;color:var(--navy)}.accept form{display:flex;gap:10px;flex-wrap:wrap;margin-top:10px}
.accept input,.accept textarea{font:inherit;padding:10px 12px;border:1px solid var(--line);border-radius:10px;min-width:240px;flex:1}
.stamp{position:absolute;right:18mm;top:58mm;transform:rotate(-12deg);border:3px solid #17703f;color:#17703f;font:700 22px Poppins;letter-spacing:.1em;padding:6px 16px;border-radius:10px;opacity:.85}
.stamp.void{border-color:#b42318;color:#b42318}
@media (max-width:820px){.page{width:auto;min-height:0;margin:0;padding:18px 16px;box-shadow:none}.grid2,.cols,.sign{grid-template-columns:1fr}.top{flex-direction:column}.doctitle{text-align:left}.meta{margin-left:0}.meta td{text-align:left;padding:2px 14px 2px 0}.sum{flex-direction:column}.totals{width:100%}.it img{width:44px;height:44px}.stamp{top:14px;right:14px;font-size:15px}}
@media (hover:none) and (pointer:coarse){input,select,textarea{font-size:16px!important}}
@media print{body{background:#fff}.bar,.accept,.noprint{display:none!important}.page{margin:0;box-shadow:none;width:auto;min-height:0;padding:0}@page{size:A4;margin:12mm}tr{page-break-inside:avoid}}
</style></head><body>
<div class="bar noprint"><span class="st">${status}</span>${toolbar}<button class="btn primary" onclick="window.print()">⎙ Print / Save as PDF</button></div>
<div class="page">
  <div class="top">
    <div><img src="${logo}" alt="${esc(co.name)}"><div class="co"><b>${esc(co.legal_name)}</b><br>${esc(co.address)}${co.trn ? `<br>TRN: ${esc(co.trn)}` : ''}<br>${esc(co.phone)} · ${esc(co.email)} · ${esc(co.website)}</div></div>
    <div class="doctitle"><h1>${esc(kind)}</h1>${body.meta}</div>
  </div>
  ${body.main}
  <div class="foot"><span><b>${esc(co.name)}</b> · ${esc(co.tagline)}${co.partner_line ? ` · ${esc(co.partner_line)}` : ''}</span><span>${esc(co.website)}</span></div>
</div>
${body.after || ''}
</body></html>`;
}
const metaTable = (rows) => `<table class="meta">${rows.filter(Boolean).map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join('')}</table>`;
function itemsTable(items, { images = false, showQty = true } = {}) {
  let n = 0;
  const rows = items.map((i) => {
    if (i.kind === 'header') return `<tr class="hd"><td colspan="${showQty ? 6 : 3}">${esc(i.name)}</td></tr>`;
    n++;
    const img = images && i.image_file_id ? `<img src="/api/public/product-image/${i.image_file_id}" alt="">` : '';
    return `<tr><td class="num">${n}</td><td><div class="it">${img}<div><b>${esc(i.name)}</b>${i.description ? `<small>${esc(i.description)}</small>` : ''}</div></div></td>
      ${showQty ? `<td class="r">${qty(i.qty)}</td><td>${esc(i.unit)}</td><td class="r">${money(i.price ?? i.cost)}</td>` : ''}<td class="r">${money(U.num(i.qty) * U.num(i.price ?? i.cost))}</td></tr>`;
  }).join('');
  return `<table class="items"><thead><tr><th>#</th><th>Description</th>${showQty ? '<th class="r">Qty</th><th>Unit</th><th class="r">Rate</th>' : ''}<th class="r">Amount (AED)</th></tr></thead><tbody>${rows}</tbody></table>`;
}
function totalsBlock(d, { paid = null } = {}) {
  return `<div class="sum"><div class="words">Amount in words<b>${esc(words(d.total))}</b></div><table class="totals">
    <tr><td>Subtotal</td><td>AED ${money(d.subtotal)}</td></tr>
    ${d.discount ? `<tr><td>Discount</td><td>− AED ${money(d.discount)}</td></tr>` : ''}
    <tr><td>VAT ${qty(d.vat_rate)}%</td><td>AED ${money(d.vat)}</td></tr>
    <tr class="grand"><td>Total</td><td>AED ${money(d.total)}</td></tr>
    ${paid !== null ? `<tr class="paid"><td>Paid</td><td>AED ${money(paid)}</td></tr><tr class="due"><td>Balance due</td><td>AED ${money(d.total - paid)}</td></tr>` : ''}
  </table></div>`;
}
function partyBox(title, c, extra = []) {
  if (!c) return `<div class="box"><h3>${esc(title)}</h3>—</div>`;
  const rows = [
    c.attention && ['Attention', c.attention],
    ['Customer', c.name], c.trn && ['TRN', c.trn],
    (c.location || c.address) && ['Location', c.location || [c.address, c.area, c.city].filter(Boolean).join(', ')],
    c.phone && ['Phone', c.phone], c.email && ['Email', c.email], ...extra,
  ].filter(Boolean);
  return `<div class="box"><h3>${esc(title)}</h3><div class="kv">${rows.map(([k, v]) => `<span>${esc(k)}</span><b>${esc(v)}</b>`).join('')}</div></div>`;
}
function bankBox() {
  const co = S.company();
  if (!co.bank_iban && !co.bank_account_no) return '';
  const rows = [['Account name', co.bank_account_name], co.bank_name && ['Bank', co.bank_name], co.bank_account_no && ['Account no.', co.bank_account_no], co.bank_iban && ['IBAN', co.bank_iban], co.bank_swift && ['SWIFT', co.bank_swift]].filter(Boolean);
  return `<div class="box"><h3>Bank details</h3><div class="kv">${rows.map(([k, v]) => `<span>${esc(k)}</span><b>${esc(v)}</b>`).join('')}</div></div>`;
}
const page404 = (res) => res.status(404).send(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><body style="font-family:system-ui;padding:40px;text-align:center;color:#5d6678"><h2 style="color:#00386b">Document not found</h2><p>This link is not valid any more. Please contact ${esc(S.company().name)} at ${esc(S.company().phone)}.</p></body>`);
const waLink = (text) => `https://wa.me/${require('./crm').normPhone(S.company().phone)}?text=${encodeURIComponent(text)}`;

function registerPublic(ctx) {
  const { app } = ctx;
  require('./settings').registerPublicLogo(app, (...a) => ctx.sendStored(...a));
  const noindex = (res) => res.set({ 'X-Robots-Tag': 'noindex, nofollow', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });

  // ---------- quotation ----------
  app.get('/doc/quote/:token', (req, res) => {
    noindex(res);
    const q = get('SELECT * FROM quotes WHERE token = ?', req.params.token);
    if (!q) return page404(res);
    const c = q.contact_id ? get('SELECT * FROM contacts WHERE id = ?', q.contact_id) : null;
    const deal = q.deal_id ? get('SELECT code FROM deals WHERE id = ?', q.deal_id) : null;
    const items = all('SELECT qi.*, p.image_file_id FROM quote_items qi LEFT JOIN products p ON p.id = qi.product_id WHERE quote_id = ? ORDER BY position, id', q.id);
    const signedIn = !!require('./auth').userFromCookieHeader(req.headers.cookie);
    if (!signedIn && !q.viewed_at && q.status === 'sent') {
      run(`UPDATE quotes SET viewed_at = datetime('now') WHERE id = ?`, q.id);
      ctx.timeline('quote', q.id, null, 'system', 'Customer opened the quotation');
      ctx.notify([q.owner_id], { type: 'quote', title: `👀 ${c?.name || 'Customer'} opened quotation ${q.number}`, body: `AED ${money(q.total)}`, link: `quotes/${q.id}` });
    }
    const expired = q.valid_until && q.valid_until < U.today() && q.status !== 'accepted';
    const chip = q.status === 'accepted' ? '<span class="chip ok">Accepted</span>' : q.status === 'rejected' ? '<span class="chip bad">Declined</span>' : expired ? '<span class="chip warn">Expired</span>' : '';
    const meta = metaTable([['Quote ref', q.number], ['Date', dmy(q.date)], q.valid_until && ['Valid until', dmy(q.valid_until)], deal && ['Deal ref', deal.code]]) + chip;
    const main = `
      <div class="grid2">${partyBox('Addressed to', c && { ...c, attention: q.attention, location: q.site_location })}
        <div class="box"><h3>Glass specifications</h3><div class="kv"><span>Glass area</span><b>${q.glass_area ? `${qty(q.glass_area)} SQM` : '—'}</b><span>Location</span><b>${esc(q.glass_location || '—')}</b><span>Subject</span><b>${esc(q.subject)}</b></div></div></div>
      ${q.intro ? `<p class="intro">${esc(q.intro)}</p>` : ''}
      <h2 class="sec">Scope of work / pricing</h2>${itemsTable(items, { images: !!q.show_images })}${totalsBlock(q)}
      <div class="cols">${lines(q.remarks).length ? `<div><h2 class="sec">Remarks</h2><ul class="bul">${lines(q.remarks).map((l) => `<li>${esc(l)}</li>`).join('')}</ul></div>` : ''}
        ${lines(q.terms).length ? `<div><h2 class="sec">Terms &amp; conditions</h2><ul class="bul">${lines(q.terms).map((l) => `<li>${esc(l)}</li>`).join('')}</ul></div>` : ''}</div>
      <div class="sign"><div><b>For ${esc(S.company().legal_name)}</b>${esc(q.owner_id ? get('SELECT name FROM users WHERE id = ?', q.owner_id)?.name || '' : '')}</div>
        <div><b>Customer acceptance</b>${q.status === 'accepted' ? `Accepted online by ${esc(q.accepted_name || '')} on ${dmy(q.accepted_at)}` : 'Name, signature &amp; date'}</div></div>`;
    const canAccept = q.status === 'sent' && !expired;
    const after = canAccept ? `<div class="accept noprint"><h2>Happy with this quotation?</h2><div style="color:#5d6678">Accept it online and our team will contact you to schedule the installation.</div>
      <form method="post" action="/doc/quote/${esc(q.token)}/accept"><input name="name" required placeholder="Your full name" autocomplete="name"><button class="btn go" type="submit">✓ Accept quotation ${esc(q.number)}</button></form></div>`
      : q.status === 'accepted' ? '<div class="accept noprint"><h2>✓ Thank you — this quotation is accepted</h2><div style="color:#5d6678">Our team will contact you to schedule the installation.</div></div>' : '';
    res.send(layout({
      title: `Quotation ${q.number}`, kind: 'Quotation', status: `Quotation <b>${esc(q.number)}</b> · AED ${money(q.total)}`,
      toolbar: `<a class="btn" href="${waLink(`Hello, about quotation ${q.number}: `)}" target="_blank" rel="noopener">💬 Ask a question</a>`,
      body: { meta, main, after },
    }));
  });
  app.post('/doc/quote/:token/accept', (req, res) => {
    const q = get('SELECT * FROM quotes WHERE token = ?', req.params.token);
    if (!q) return page404(res);
    const name = String(req.body?.name || '').trim().slice(0, 120);
    if (q.status === 'sent' && name && !(q.valid_until && q.valid_until < U.today())) ctx.setQuoteStatus(null, q, 'accepted', { name });
    res.redirect(303, `/doc/quote/${q.token}`);
  });

  // ---------- invoice ----------
  app.get('/doc/invoice/:token', (req, res) => {
    noindex(res);
    const i = get('SELECT * FROM invoices WHERE token = ?', req.params.token);
    if (!i || i.status === 'draft' && !require('./auth').userFromCookieHeader(req.headers.cookie)) return page404(res);
    const c = i.contact_id ? get('SELECT * FROM contacts WHERE id = ?', i.contact_id) : null;
    const q = i.quote_id ? get('SELECT number FROM quotes WHERE id = ?', i.quote_id) : null;
    const items = all('SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY position, id', i.id);
    const chip = { paid: '<span class="chip ok">Paid</span>', partial: '<span class="chip warn">Part paid</span>', cancelled: '<span class="chip bad">Cancelled</span>', draft: '<span class="chip">Draft</span>' }[i.status]
      || (i.due_date < U.today() ? '<span class="chip bad">Overdue</span>' : '<span class="chip">Unpaid</span>');
    const meta = metaTable([['Invoice no.', i.number], ['Date', dmy(i.date)], ['Due date', dmy(i.due_date)], q && ['Quote ref', q.number]]) + chip;
    const main = `
      ${i.status === 'paid' ? '<div class="stamp">PAID</div>' : i.status === 'cancelled' ? '<div class="stamp void">CANCELLED</div>' : ''}
      <div class="grid2">${partyBox('Bill to', c)}${bankBox() || `<div class="box"><h3>Subject</h3>${esc(i.subject)}</div>`}</div>
      ${i.subject ? `<h2 class="sec">${esc(i.subject)}</h2>` : ''}${itemsTable(items)}${totalsBlock(i, { paid: i.paid })}
      <div class="cols">${lines(i.terms).length ? `<div><h2 class="sec">Payment terms</h2><ul class="bul">${lines(i.terms).map((l) => `<li>${esc(l)}</li>`).join('')}</ul></div>` : ''}
        ${i.notes ? `<div><h2 class="sec">Notes</h2><ul class="bul">${lines(i.notes).map((l) => `<li>${esc(l)}</li>`).join('')}</ul></div>` : ''}</div>
      <div class="sign"><div><b>For ${esc(S.company().legal_name)}</b>Authorised signatory</div><div><b>Received by</b>Name, signature &amp; date</div></div>`;
    res.send(layout({ title: `Tax invoice ${i.number}`, kind: 'Tax Invoice', status: `Invoice <b>${esc(i.number)}</b> · balance AED ${money(i.total - i.paid)}`,
      toolbar: `<a class="btn" href="${waLink(`Hello, about invoice ${i.number}: `)}" target="_blank" rel="noopener">💬 Contact us</a>`, body: { meta, main } }));
  });

  // ---------- payment receipt ----------
  app.get('/doc/receipt/:token', (req, res) => {
    noindex(res);
    const p = get('SELECT * FROM payments WHERE token = ?', req.params.token);
    if (!p) return page404(res);
    const i = get('SELECT * FROM invoices WHERE id = ?', p.invoice_id);
    const c = p.contact_id ? get('SELECT * FROM contacts WHERE id = ?', p.contact_id) : null;
    const method = { cash: 'Cash', bank: 'Bank transfer', cheque: 'Cheque', card: 'Card', link: 'Payment link' }[p.method] || p.method;
    const meta = metaTable([['Receipt no.', p.number], ['Date', dmy(p.date)], ['Invoice', i?.number]]) + '<span class="chip ok">Received</span>';
    const main = `<div class="grid2">${partyBox('Received from', c)}<div class="box"><h3>Payment</h3><div class="kv"><span>Amount</span><b>AED ${money(p.amount)}</b><span>Method</span><b>${esc(method)}</b>${p.reference ? `<span>Reference</span><b>${esc(p.reference)}</b>` : ''}<span>For invoice</span><b>${esc(i?.number || '')}</b></div></div></div>
      <div class="sum"><div class="words">Amount in words<b>${esc(words(p.amount))}</b></div><table class="totals"><tr><td>Invoice total</td><td>AED ${money(i?.total)}</td></tr><tr><td>This payment</td><td>AED ${money(p.amount)}</td></tr>
      <tr class="grand"><td>Balance</td><td>AED ${money((i?.total || 0) - (i?.paid || 0))}</td></tr></table></div>
      <p class="intro">Thank you for your payment.</p>
      <div class="sign"><div><b>For ${esc(S.company().legal_name)}</b>Received by</div><div></div></div>`;
    res.send(layout({ title: `Receipt ${p.number}`, kind: 'Receipt', status: `Receipt <b>${esc(p.number)}</b>`, body: { meta, main } }));
  });

  // ---------- purchase order ----------
  app.get('/doc/po/:token', (req, res) => {
    noindex(res);
    const po = get('SELECT * FROM purchase_orders WHERE token = ?', req.params.token);
    if (!po) return page404(res);
    const v = po.vendor_id ? get('SELECT * FROM vendors WHERE id = ?', po.vendor_id) : null;
    const deal = po.deal_id ? get('SELECT code, address, area, city FROM deals WHERE id = ?', po.deal_id) : null;
    const items = all('SELECT * FROM po_items WHERE po_id = ? ORDER BY position, id', po.id).map((i) => ({ ...i, price: i.cost }));
    const meta = metaTable([['PO number', po.number], ['Date', dmy(po.date)], po.expected_date && ['Needed by', dmy(po.expected_date)], deal && ['Project ref', deal.code]]);
    const main = `<div class="grid2">${partyBox('Supplier', v && { ...v, attention: v.contact_person })}<div class="box"><h3>Deliver to</h3><div class="kv"><span>Company</span><b>${esc(S.company().legal_name)}</b><span>Address</span><b>${esc(S.company().address)}</b><span>Contact</span><b>${esc(S.company().phone)}</b></div></div></div>
      ${po.notes ? `<p class="intro">${esc(po.notes)}</p>` : ''}${itemsTable(items)}${totalsBlock({ ...po, discount: 0 })}
      <div class="sign"><div><b>For ${esc(S.company().legal_name)}</b>Authorised signatory</div><div><b>Supplier confirmation</b>Name, signature &amp; date</div></div>`;
    res.send(layout({ title: `Purchase order ${po.number}`, kind: 'Purchase Order', status: `PO <b>${esc(po.number)}</b>`, body: { meta, main } }));
  });

  // ---------- warranty card ----------
  app.get('/doc/warranty/:token', (req, res) => {
    noindex(res);
    const w = get('SELECT * FROM warranties WHERE token = ?', req.params.token);
    if (!w) return page404(res);
    const c = w.contact_id ? get('SELECT * FROM contacts WHERE id = ?', w.contact_id) : null;
    const p = w.product_id ? get('SELECT * FROM products WHERE id = ?', w.product_id) : null;
    const j = w.job_id ? get('SELECT number, address FROM jobs WHERE id = ?', w.job_id) : null;
    const valid = w.status === 'active' && w.end_date >= U.today();
    const meta = metaTable([['Warranty no.', w.number], ['Installed', dmy(w.start_date)], ['Valid until', dmy(w.end_date)]]) + `<span class="chip ${valid ? 'ok' : 'bad'}">${valid ? 'Valid' : w.status === 'void' ? 'Void' : 'Expired'}</span>`;
    const specs = p ? [p.vlt != null && `VLT ${qty(p.vlt)}%`, p.heat_rejection != null && `Heat rejection ${qty(p.heat_rejection)}%`, p.uv_block != null && `UV block ${qty(p.uv_block)}%`, p.thickness].filter(Boolean).join(' · ') : '';
    const main = `<div class="grid2">${partyBox('Customer', c && { ...c, location: j?.address })}
      <div class="box"><h3>Film installed</h3><div class="kv"><span>Product</span><b>${esc(w.description || p?.name || '')}</b>${specs ? `<span>Specs</span><b>${esc(specs)}</b>` : ''}<span>Area</span><b>${w.sqm ? `${qty(w.sqm)} SQM` : '—'}</b><span>Location</span><b>${esc(w.location || '—')}</b><span>Cover</span><b>${w.years} year${w.years === 1 ? '' : 's'}</b>${j ? `<span>Job</span><b>${esc(j.number)}</b>` : ''}</div></div></div>
      <h2 class="sec">What's covered</h2><ul class="bul"><li>Peeling, cracking, crazing, delamination and bubbling of the film under normal use.</li><li>Loss of adhesion and discolouration caused by a manufacturing defect.</li><li>Labour to remove and re-install defective film during the warranty period.</li></ul>
      <h2 class="sec">Care instructions</h2><ul class="bul"><li>Do not clean the glass for 30 days after installation; small water haze clears as the film cures.</li><li>Clean with a soft cloth and mild, ammonia-free soap. No abrasive pads, blades or tape on the film.</li><li>Keep this card. To claim, contact us with the warranty number and photos.</li></ul>
      ${w.notes ? `<p class="intro">${esc(w.notes)}</p>` : ''}
      <div class="sign"><div><b>For ${esc(S.company().legal_name)}</b>${esc(S.company().partner_line || '')}</div><div><b>Claims &amp; service</b>${esc(S.company().phone)} · ${esc(S.company().email)}</div></div>`;
    res.send(layout({ title: `Warranty ${w.number}`, kind: 'Warranty', status: `Warranty <b>${esc(w.number)}</b> · ${valid ? 'valid' : 'not valid'}`,
      toolbar: `<a class="btn" href="${waLink(`Hello, I have a question about warranty ${w.number}: `)}" target="_blank" rel="noopener">💬 Make a claim</a>`, body: { meta, main } }));
  });

  // ---------- installation sign-off by the customer (remote link) ----------
  app.get('/doc/signoff/:token', (req, res) => {
    noindex(res);
    const j = get('SELECT * FROM jobs WHERE sign_token = ?', req.params.token);
    if (!j || j.status === 'cancelled') return page404(res);
    const c = j.contact_id ? get('SELECT * FROM contacts WHERE id = ?', j.contact_id) : null;
    const scope = JSON.parse(j.scope || '[]');
    const meta = metaTable([['Job', j.number], ['Date', dmy(j.date)]]) + (j.status === 'signed_off' ? '<span class="chip ok">Signed off</span>' : '');
    const done = j.status === 'signed_off';
    const main = `<div class="grid2">${partyBox('Customer', c && { ...c, location: j.address })}<div class="box"><h3>Work</h3><div class="kv"><span>Job</span><b>${esc(j.title)}</b><span>Status</span><b>${esc(require('./jobs').STATUS_LABEL[j.status])}</b></div></div></div>
      ${scope.length ? `<h2 class="sec">Work completed</h2><table class="items"><thead><tr><th>#</th><th>Item</th><th class="r">Qty</th><th>Unit</th></tr></thead><tbody>${scope.map((s, n) => `<tr><td class="num">${n + 1}</td><td><div class="it"><div><b>${esc(s.name)}</b>${s.description ? `<small>${esc(s.description)}</small>` : ''}</div></div></td><td class="r">${qty(s.qty)}</td><td>${esc(s.unit)}</td></tr>`).join('')}</tbody></table>` : ''}
      ${done ? `<div class="sign"><div><b>Signed off by ${esc(j.signed_name)}</b>${dmy(j.signed_at)}${j.rating ? ` · ${'★'.repeat(j.rating)}` : ''}</div><div>${j.signature_file_id ? '' : ''}</div></div>` : `
      <form id="sf" class="noprint" style="margin-top:18px" onsubmit="return go(event)"><h2 class="sec">Your sign-off</h2>
        <p class="intro">Please check the work, then sign below to confirm the installation is complete.</p>
        <div style="display:flex;gap:10px;flex-wrap:wrap"><input name="name" required placeholder="Your full name" style="flex:1;min-width:220px;font:inherit;padding:10px 12px;border:1px solid var(--line);border-radius:10px"></div>
        <div style="margin:10px 0 4px;color:var(--muted)">How happy are you with the installation?</div><div id="stars" style="font-size:30px;cursor:pointer;color:#c9ced8">${[1, 2, 3, 4, 5].map((n) => `<span data-n="${n}">★</span>`).join('')}</div>
        <textarea name="feedback" rows="2" placeholder="Comments (optional)" style="width:100%;margin-top:8px;font:inherit;padding:10px 12px;border:1px solid var(--line);border-radius:10px"></textarea>
        <div style="margin:12px 0 6px;color:var(--muted)">Sign here</div>
        <canvas id="pad" style="width:100%;height:180px;border:1.5px dashed #9aa3b5;border-radius:12px;touch-action:none;background:#fff"></canvas>
        <div style="display:flex;gap:10px;margin-top:10px"><button type="button" class="btn" onclick="clr()">Clear</button><button class="btn go" type="submit">✓ Confirm &amp; sign</button></div><p id="err" style="color:#b42318"></p></form>
      <script>
      const pad=document.getElementById('pad'),cx=pad.getContext('2d');let drawing=false,inked=false,rating=0;
      function fit(){const r=pad.getBoundingClientRect(),d=window.devicePixelRatio||1;pad.width=r.width*d;pad.height=r.height*d;cx.scale(d,d);cx.lineWidth=2.2;cx.lineCap='round';cx.strokeStyle='#141c2f'}fit();
      const pt=e=>{const r=pad.getBoundingClientRect(),t=e.touches?e.touches[0]:e;return[t.clientX-r.left,t.clientY-r.top]};
      pad.addEventListener('pointerdown',e=>{drawing=true;inked=true;cx.beginPath();cx.moveTo(...pt(e));pad.setPointerCapture(e.pointerId)});
      pad.addEventListener('pointermove',e=>{if(!drawing)return;cx.lineTo(...pt(e));cx.stroke()});
      pad.addEventListener('pointerup',()=>drawing=false);
      function clr(){cx.clearRect(0,0,pad.width,pad.height);inked=false}
      document.querySelectorAll('#stars span').forEach(s=>s.onclick=()=>{rating=+s.dataset.n;document.querySelectorAll('#stars span').forEach(x=>x.style.color=+x.dataset.n<=rating?'#fdb13e':'#c9ced8')});
      async function go(e){e.preventDefault();const f=e.target;if(!inked){document.getElementById('err').textContent='Please sign in the box.';return false}
        const r=await fetch(location.pathname,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:f.name.value,feedback:f.feedback.value,rating,signature:pad.toDataURL('image/png')})});
        const d=await r.json().catch(()=>({}));if(r.ok)location.reload();else document.getElementById('err').textContent=d.error||'Could not save';return false}
      </script>`}`;
    res.send(layout({ title: `Sign-off ${j.number}`, kind: 'Job Completion', status: `Installation <b>${esc(j.number)}</b>`, body: { meta, main } }));
  });
  app.post('/doc/signoff/:token', (req, res) => {
    const j = get('SELECT * FROM jobs WHERE sign_token = ?', req.params.token);
    if (!j) return res.status(404).json({ error: 'Not found' });
    try { res.json(require('./jobs').signOff(ctx, j, req.body || {}, null)); }
    catch (err) { res.status(err.status || 500).json({ error: err.status ? err.message : 'Could not save' }); }
  });
}

module.exports = { registerPublic, words };
