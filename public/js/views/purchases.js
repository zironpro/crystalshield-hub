import { useState, useMemo, useEffect } from 'preact/hooks';
import { html, api, useLoad, can, go, toast, PO_STATUS, METHOD, aed, fmtDate, todayISO, sum, qty } from '../lib.js';
import { Icon, StatusBadge, Modal, Field, ErrorText, Spinner, Empty, PageHead, SearchBox, Chips, Tabs, Timeline, Info, useAction, useVendors, openExternal, WaIcon } from '../ui.js';
import { LineEditor, lineTotals, TotalsBox } from './lines.js';
import { SendEmail } from './quotes.js';

export function Purchases() {
  const [tab, setTab] = useState(new URLSearchParams(location.hash.split('?')[1] || '').get('tab') || 'orders');
  const [status, setStatus] = useState('open');
  const [q, setQ] = useState('');
  const [modal, setModal] = useState(null);
  const [data] = useLoad('/purchase-orders', ['purchases']);
  const vendors = useVendors();
  const all = data?.pos || [];
  const rows = useMemo(() => all.filter((p) => (status === 'open' ? ['draft', 'sent', 'partial'].includes(p.status) : status === 'unpaid' ? p.received_value - p.paid > 0.009 : !status || p.status === status)
    && (!q || [p.number, p.vendor_name, p.vendor_ref, p.deal_title].some((v) => String(v || '').toLowerCase().includes(q.toLowerCase())))), [all, status, q]);
  const owed = sum(all, (p) => Math.max(0, p.received_value - p.paid));
  return html`<div class="page wide">
    <${PageHead} eyebrow="Operations" title="Purchases" sub="Purchase orders to suppliers, goods received into stock, and what you owe.">
      ${can('purchases', 'create') && html`<button class="btn ghost" onClick=${() => setModal('vendor')}><${Icon} name="plus" size=${16} /> Supplier</button><button class="btn primary" onClick=${() => setModal('po')}><${Icon} name="plus" size=${16} /> Purchase order</button>`}
    <//>
    <div class="kpis"><div class="kpi navy"><span>Owed to suppliers</span><b>${aed(owed, { dp: 0 })}</b><small>for goods received</small></div>
      <div class="kpi"><span>Open orders</span><b>${all.filter((p) => ['draft', 'sent', 'partial'].includes(p.status)).length}</b><small>${aed(sum(all.filter((p) => ['sent', 'partial'].includes(p.status)), (p) => p.total - p.received_value), { dp: 0 })} still to arrive</small></div>
      <div class="kpi"><span>Suppliers</span><b>${vendors.length}</b></div></div>
    <${Tabs} value=${tab} onChange=${setTab} tabs=${[['orders', 'Purchase orders', all.length], ['vendors', 'Suppliers', vendors.length]]} />
    ${tab === 'orders' && html`<div class="toolbar"><${SearchBox} value=${q} onInput=${setQ} placeholder="PO, supplier, bill no…" />
      <${Chips} value=${status} onChange=${setStatus} options=${[['open', 'Open'], ['unpaid', 'To pay'], ['received', 'Received'], ['cancelled', 'Cancelled'], ['', 'All']]} /></div>
      ${!data ? html`<${Spinner} />` : !rows.length ? html`<div class="card"><${Empty} icon="truck" title="No purchase orders">Create them in one click from a deal’s pricing sheet, or for stock here.<//></div>`
        : html`<div class="card flush"><div class="table-wrap"><table class="table table-cards"><thead><tr><th>PO</th><th>Supplier</th><th class="hide-m">For</th><th class="hide-m">Date</th><th class="r">Total</th><th class="r hide-m">To pay</th><th>Status</th></tr></thead>
          <tbody>${rows.map((p) => html`<tr class="click" onClick=${() => go(`purchases/${p.id}`)}><td class="title">${p.number}${p.vendor_ref && html`<span class="sub">Bill ${p.vendor_ref}</span>`}</td><td>${p.vendor_name}</td>
            <td class="hide-m">${p.deal_code ? html`${p.deal_code}<span class="sub">${p.deal_title}</span>` : html`<span class="muted">Stock</span>`}</td><td class="hide-m">${fmtDate(p.date)}</td>
            <td class="r">${aed(p.total)}</td><td class="r hide-m strong">${p.received_value - p.paid > 0.009 ? aed(p.received_value - p.paid) : '—'}</td><td><${StatusBadge} map=${PO_STATUS} status=${p.status} /></td></tr>`)}</tbody></table></div></div>`}`}
    ${tab === 'vendors' && html`<div class="card flush"><div class="table-wrap"><table class="table table-cards"><thead><tr><th>Supplier</th><th class="hide-m">Contact</th><th class="hide-m">Phone</th><th class="r hide-m">Orders</th><th class="r">We owe</th></tr></thead>
      <tbody>${vendors.map((v) => html`<tr class="click" onClick=${() => go(`vendors/${v.id}`)}><td class="title">${v.name}${v.trn && html`<span class="sub">TRN ${v.trn}</span>`}</td><td class="hide-m">${v.contact_person}</td><td class="hide-m">${v.phone}</td><td class="r hide-m">${v.pos}</td><td class="r strong">${v.balance > 0 ? aed(v.balance) : '—'}</td></tr>`)}</tbody></table></div></div>`}
    ${modal === 'po' && html`<${NewPO} vendors=${vendors} onClose=${() => setModal(null)} />`}
    ${modal === 'vendor' && html`<${VendorForm} onClose=${() => setModal(null)} onSaved=${(v) => go(`vendors/${v.id}`)} />`}
  </div>`;
}

function NewPO({ vendors, onClose }) {
  const [v, setV] = useState('');
  const [error, setError] = useState('');
  return html`<${Modal} title="New purchase order" onClose=${onClose}>
    <div class="form"><${Field} label="Supplier"><select value=${v} onChange=${(e) => setV(e.target.value)} autoFocus><option value="">Pick…</option>${vendors.map((x) => html`<option value=${x.id}>${x.name}</option>`)}</select><//>
      <p class="muted small" style=${{ margin: 0 }}>For a customer job, it’s quicker from the deal: Pricing → Create purchase orders.</p><${ErrorText} error=${error} />
      <div class="form-actions"><button class="btn ghost" onClick=${onClose}>Cancel</button><button class="btn primary" disabled=${!v} onClick=${() => api('/purchase-orders', { method: 'POST', body: { vendor_id: v } }).then((r) => go(`purchases/${r.po.id}`)).catch((e) => setError(e.message))}>Create</button></div></div>
  <//>`;
}

export function VendorForm({ vendor, onClose, onSaved }) {
  const [f, setF] = useState(vendor ? { ...vendor } : { name: '', contact_person: '', phone: '', email: '', trn: '', address: '', notes: '' });
  const [error, setError] = useState('');
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  async function save(e) {
    e.preventDefault();
    try { const r = vendor ? await api(`/vendors/${vendor.id}`, { method: 'PATCH', body: f }) : await api('/vendors', { method: 'POST', body: f }); onSaved?.(r.vendor); onClose(); } catch (err) { setError(err.message); }
  }
  return html`<${Modal} title=${vendor ? 'Edit supplier' : 'New supplier'} onClose=${onClose}>
    <form class="form" onSubmit=${save}><div class="form-grid two">
      <${Field} label="Name *"><input required value=${f.name} onInput=${set('name')} /><//><${Field} label="Contact person"><input value=${f.contact_person} onInput=${set('contact_person')} /><//>
      <${Field} label="Phone"><input value=${f.phone} onInput=${set('phone')} /><//><${Field} label="Email"><input type="email" value=${f.email} onInput=${set('email')} /><//>
      <${Field} label="TRN"><input value=${f.trn} onInput=${set('trn')} /><//><${Field} label="Address"><input value=${f.address} onInput=${set('address')} /><//></div>
      <${Field} label="Notes"><textarea rows="2" value=${f.notes} onInput=${set('notes')} placeholder="Payment terms, lead time, rolls available…" /><//>
      <${ErrorText} error=${error} /><div class="form-actions"><button type="button" class="btn ghost" onClick=${onClose}>Cancel</button><button class="btn primary">Save</button></div></form>
  <//>`;
}

export function VendorView({ id }) {
  const [data, reload] = useLoad(`/vendors/${id}`, ['purchases', 'vendors']);
  const [edit, setEdit] = useState(false);
  if (!data) return html`<div class="page"><${Spinner} /></div>`;
  const v = data.vendor;
  const owed = sum(data.pos, (p) => Math.max(0, p.received_value - p.paid));
  return html`<div class="page">
    <a class="back-link" href="#/purchases?tab=vendors"><${Icon} name="back" size=${15} /> Suppliers</a>
    <div class="record-head"><div><p class="eyebrow">Supplier</p><h1>${v.name}</h1><div class="sub">${v.contact_person}${v.phone ? ` · ${v.phone}` : ''}${v.email ? ` · ${v.email}` : ''}</div></div>
      ${can('purchases', 'edit') && html`<button class="btn ghost" onClick=${() => setEdit(true)}><${Icon} name="edit" size=${15} /> Edit</button>`}</div>
    <div class="money-strip"><div><span>Orders</span><b>${data.pos.length}</b></div><div><span>Bought (received)</span><b>${aed(sum(data.pos, (p) => p.received_value), { dp: 0 })}</b></div><div><span>Paid</span><b>${aed(sum(data.payments, (p) => p.amount), { dp: 0 })}</b></div><div><span>We owe</span><b class=${owed > 0 ? 'orange' : ''}>${aed(owed, { dp: 0 })}</b></div></div>
    <div class="grid-main"><div class="stack">
      <div class="card"><h2 style=${{ marginBottom: '8px' }}>Purchase orders</h2>${data.pos.length ? html`<div class="list-rows">${data.pos.map((p) => html`<a class="list-row" href=${`#/purchases/${p.id}`}><span class="ico-sq">🚚</span><span class="grow"><b>${p.number}</b><small>${fmtDate(p.date)}${p.vendor_ref ? ` · bill ${p.vendor_ref}` : ''}</small></span><b>${aed(p.total)}</b><${StatusBadge} map=${PO_STATUS} status=${p.status} /></a>`)}</div>` : html`<p class="muted small">None yet.</p>`}</div>
      ${data.payments.length > 0 && html`<div class="card"><h2 style=${{ marginBottom: '8px' }}>Payments</h2><div class="list-rows">${data.payments.map((p) => html`<div class="list-row"><span class="ico-sq">💸</span><span class="grow"><b>${p.number}</b><small>${fmtDate(p.date)} · ${METHOD[p.method]}${p.reference ? ` · ${p.reference}` : ''}</small></span><b>${aed(p.amount)}</b></div>`)}</div></div>`}
    </div><aside class="card"><dl class="info-list"><${Info} label="TRN">${v.trn}<//><${Info} label="Address">${v.address}<//><${Info} label="Notes"><span style=${{ whiteSpace: 'pre-wrap' }}>${v.notes}</span><//></dl></aside></div>
    ${edit && html`<${VendorForm} vendor=${v} onClose=${() => setEdit(false)} onSaved=${reload} />`}
  </div>`;
}

export function POView({ id }) {
  const [data, reload, err] = useLoad(`/purchase-orders/${id}`, ['purchases']);
  const [f, setF] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [modal, setModal] = useState(null);
  const [busy, run] = useAction();
  const vendors = useVendors();
  useEffect(() => { if (data && !dirty) setF({ ...data.po, items: data.items.map((i) => ({ ...i, price: i.cost })) }); }, [data]);
  if (err) return html`<div class="page"><h1>Not found</h1></div>`;
  if (!data || !f) return html`<div class="page"><${Spinner} /></div>`;
  const po = data.po;
  const editable = can('purchases', 'edit') && !['received', 'cancelled'].includes(po.status);
  const t = lineTotals(f.items, 0, f.vat_rate, 'cost');
  const save = () => run(() => api(`/purchase-orders/${po.id}`, { method: 'PUT', body: { ...f, items: f.items.map((i) => ({ ...i })) } }).then(() => { setDirty(false); reload(); }), 'Saved');
  const status = (s) => run(() => api(`/purchase-orders/${po.id}/status`, { method: 'POST', body: { status: s } }).then(reload));
  return html`<div class="page wide" style=${{ maxWidth: '1240px' }}>
    <a class="back-link" href=${data.deal ? `#/deals/${data.deal.id}` : '#/purchases'}><${Icon} name="back" size=${15} /> ${data.deal ? data.deal.title : 'Purchases'}</a>
    <div class="record-head"><div><p class="eyebrow">Purchase order</p><h1>${po.number} · ${aed(po.total)}</h1>
      <div class="sub"><${StatusBadge} map=${PO_STATUS} status=${po.status} />${data.vendor && html`<a class="link" href=${`#/vendors/${data.vendor.id}`}>${data.vendor.name}</a>`}${data.deal && html`<span>for ${data.deal.code}</span>`}</div></div>
      <div class="btn-row"><a class="btn ghost" href=${po.url} target="_blank" rel="noopener"><${Icon} name="print" size=${15} /> Print / PDF</a>
        ${can('purchases', 'edit') && po.status !== 'cancelled' && html`<button class="btn wa" onClick=${() => run(() => api(`/purchase-orders/${po.id}/whatsapp`, { method: 'POST' })).then((r) => { if (r) { openExternal(r.link); reload(); } })}><${WaIcon} /> Send to supplier</button>
          <button class="btn ghost" onClick=${() => setModal('email')}><${Icon} name="mail" size=${15} /> Email</button>`}
        ${can('purchases', 'edit') && ['sent', 'partial'].includes(po.status) && html`<button class="btn primary" onClick=${() => setModal('receive')}>📦 Receive goods</button>`}
        ${can('purchases', 'edit') && po.received_value - po.paid > 0.009 && html`<button class="btn success" onClick=${() => setModal('pay')}>Pay supplier</button>`}</div></div>
    <div class="money-strip"><div><span>Order total</span><b>${aed(po.total)}</b></div><div><span>Received (bill)</span><b>${aed(po.received_value)}</b></div><div><span>Paid</span><b class="green">${aed(po.paid)}</b></div><div><span>We owe</span><b class=${po.balance > 0 ? 'orange' : ''}>${aed(po.balance)}</b></div></div>
    ${po.status === 'draft' && can('purchases', 'edit') && html`<div class="callout amber" style=${{ marginBottom: '14px' }}><span>📝</span><span class="grow">Draft — check quantities and prices, then send it to the supplier.</span><button class="btn primary small" onClick=${() => status('sent')}>Mark as sent</button></div>`}
    <div class="card" style=${{ marginBottom: '16px' }}><div class="form-grid">
      <${Field} label="Supplier"><select value=${f.vendor_id || ''} disabled=${!editable} onChange=${(e) => { setF({ ...f, vendor_id: Number(e.target.value) }); setDirty(true); }}>${vendors.map((v) => html`<option value=${v.id}>${v.name}</option>`)}</select><//>
      <${Field} label="Order date"><input type="date" value=${f.date} disabled=${!editable} onInput=${(e) => { setF({ ...f, date: e.target.value }); setDirty(true); }} /><//>
      <${Field} label="Needed by"><input type="date" value=${f.expected_date || ''} disabled=${!editable} onInput=${(e) => { setF({ ...f, expected_date: e.target.value }); setDirty(true); }} /><//>
      <${Field} label="Supplier's bill / invoice no."><input value=${f.vendor_ref} disabled=${!can('purchases', 'edit')} onInput=${(e) => { setF({ ...f, vendor_ref: e.target.value }); setDirty(true); }} /><//>
    </div></div>
    <div class="card"><${LineEditor} items=${f.items} onChange=${(items) => { setF({ ...f, items: items.map((i) => ({ ...i, cost: i.cost ?? i.price })) }); setDirty(true); }} priceKey="cost" priceLabel="Unit cost" costs=${can('see_costs')} readOnly=${!editable} />
      <div class="lines-foot"><${Field} label="Notes for the supplier"><textarea rows="2" style=${{ minWidth: '320px' }} value=${f.notes} disabled=${!editable} onInput=${(e) => { setF({ ...f, notes: e.target.value }); setDirty(true); }} /><//><${TotalsBox} t=${t} vatRate=${f.vat_rate} /></div>
      ${data.items.some((i) => i.received_qty > 0) && html`<p class="small muted">Received so far: ${data.items.filter((i) => i.received_qty > 0).map((i) => `${qty(i.received_qty)}/${qty(i.qty)} ${i.unit} ${i.name}`).join(' · ')}</p>`}
      ${can('purchases', 'edit') && html`<div class="row" style=${{ marginTop: '12px' }}>${po.status === 'draft' && can('purchases', 'delete') && html`<button class="btn danger-ghost" onClick=${() => confirm('Delete this draft?') && run(() => api(`/purchase-orders/${po.id}`, { method: 'DELETE' }).then(() => go('purchases')))}>Delete</button>`}
        ${['draft', 'sent'].includes(po.status) && !data.receipts.length && html`<button class="btn danger-ghost" onClick=${() => confirm('Cancel this order?') && status('cancelled')}>Cancel order</button>`}<span class="spacer" />
        <button class="btn primary" disabled=${busy || !dirty} onClick=${save}>${dirty ? 'Save' : 'Saved'}</button></div>`}</div>
    <div class="grid-2" style=${{ marginTop: '16px' }}>
      <div class="card"><h2 style=${{ marginBottom: '8px' }}>Goods received</h2>${data.receipts.length ? html`<div class="list-rows">${data.receipts.map((r) => html`<div class="list-row"><span class="ico-sq">📦</span><span class="grow"><b>${r.number} · ${aed(r.total)}</b><small>${fmtDate(r.date)} · ${JSON.parse(r.lines).map((l) => `${qty(l.qty)} ${l.unit} ${l.name}`).join(', ')}</small></span>
        ${can('purchases', 'delete') && html`<button class="icon-btn small" title="Undo" onClick=${() => confirm(`Undo ${r.number}? Stock and the supplier bill are reversed.`) && run(() => api(`/receipts/${r.id}`, { method: 'DELETE' }).then(reload))}><${Icon} name="trash" size=${14} /></button>`}</div>`)}</div>` : html`<p class="muted small">Nothing received yet.</p>`}</div>
      <div class="card"><h2 style=${{ marginBottom: '8px' }}>Payments to supplier</h2>${data.payments.length ? html`<div class="list-rows">${data.payments.map((p) => html`<div class="list-row"><span class="ico-sq">💸</span><span class="grow"><b>${p.number} · ${aed(p.amount)}</b><small>${fmtDate(p.date)} · ${METHOD[p.method]} · ${p.account_name}</small></span>
        ${can('purchases', 'delete') && html`<button class="icon-btn small" onClick=${() => confirm('Remove this payment?') && run(() => api(`/vendor-payments/${p.id}`, { method: 'DELETE' }).then(reload))}><${Icon} name="trash" size=${14} /></button>`}</div>`)}</div>` : html`<p class="muted small">No payments yet.</p>`}</div>
    </div>
    ${data.timeline.length > 0 && html`<div class="card" style=${{ marginTop: '16px' }}><h2 style=${{ marginBottom: '8px' }}>History</h2><${Timeline} items=${data.timeline} /></div>`}
    ${modal === 'receive' && html`<${ReceiveModal} po=${po} items=${data.items} onClose=${() => setModal(null)} onSaved=${reload} />`}
    ${modal === 'pay' && html`<${PaySupplier} po=${po} onClose=${() => setModal(null)} onSaved=${reload} />`}
    ${modal === 'email' && html`<${SendEmail} path=${`/purchase-orders/${po.id}/email`} to=${data.vendor?.email} title=${`Email ${po.number}`} onClose=${() => setModal(null)} onSent=${reload} />`}
  </div>`;
}

function ReceiveModal({ po, items, onClose, onSaved }) {
  const [lines, setLines] = useState(items.map((i) => ({ po_item_id: i.id, name: i.name, unit: i.unit, left: Math.max(0, i.qty - i.received_qty), qty: Math.max(0, i.qty - i.received_qty), cost: i.cost, stock: i.track_stock })));
  const [f, setF] = useState({ date: todayISO(), vendor_ref: po.vendor_ref || '', note: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const total = sum(lines, (l) => (Number(l.qty) || 0) * (Number(l.cost) || 0));
  async function save(e) {
    e.preventDefault(); setBusy(true); setError('');
    try { await api(`/purchase-orders/${po.id}/receive`, { method: 'POST', body: { ...f, lines } }); toast('📦 Received — stock updated'); onSaved(); onClose(); } catch (err) { setError(err.message); }
    setBusy(false);
  }
  return html`<${Modal} title=${`Receive goods — ${po.number}`} onClose=${onClose} wide>
    <form class="form" onSubmit=${save}>
      <div class="table-wrap"><table class="table compact"><thead><tr><th>Item</th><th class="r">Still due</th><th class="r">Received now</th><th class="r">Unit cost</th><th></th></tr></thead>
        <tbody>${lines.map((l, i) => html`<tr><td>${l.name}${l.stock ? html`<span class="sub">→ stock</span>` : html`<span class="sub">→ job cost</span>`}</td><td class="r">${qty(l.left)} ${l.unit}</td>
          <td class="r"><input type="number" step="0.01" min="0" max=${l.left} value=${l.qty} onInput=${(e) => setLines(lines.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)))} style=${{ width: '100px' }} /></td>
          <td class="r"><input type="number" step="0.01" value=${l.cost} onInput=${(e) => setLines(lines.map((x, j) => (j === i ? { ...x, cost: e.target.value } : x)))} style=${{ width: '100px' }} /></td><td>${l.unit}</td></tr>`)}</tbody></table></div>
      <div class="form-grid three"><${Field} label="Date received"><input type="date" value=${f.date} onInput=${(e) => setF({ ...f, date: e.target.value })} /><//>
        <${Field} label="Supplier bill no."><input value=${f.vendor_ref} onInput=${(e) => setF({ ...f, vendor_ref: e.target.value })} /><//>
        <${Field} label="Note"><input value=${f.note} onInput=${(e) => setF({ ...f, note: e.target.value })} placeholder="e.g. 3 rolls 1.52 m" /><//></div>
      <p class="muted small" style=${{ margin: 0 }}>Value ${aed(total)} + VAT ${aed(total * po.vat_rate / 100)} will be added to what you owe the supplier and posted to the books.</p>
      <${ErrorText} error=${error} /><div class="form-actions"><button type="button" class="btn ghost" onClick=${onClose}>Cancel</button><button class="btn primary" disabled=${busy}>Receive</button></div>
    </form>
  <//>`;
}
function PaySupplier({ po, onClose, onSaved }) {
  const [money, setMoney] = useState([]);
  const [f, setF] = useState({ amount: Math.round((po.received_value - po.paid) * 100) / 100, date: todayISO(), method: 'bank', reference: '', account_id: '' });
  const [error, setError] = useState('');
  useEffect(() => { api('/accounts').then((d) => setMoney(d.money)).catch(() => {}); }, []);
  async function save(e) {
    e.preventDefault();
    try { await api(`/purchase-orders/${po.id}/payments`, { method: 'POST', body: f }); toast('Payment recorded'); onSaved(); onClose(); } catch (err) { setError(err.message); }
  }
  return html`<${Modal} title=${`Pay supplier — ${po.number}`} onClose=${onClose}>
    <form class="form" onSubmit=${save}><div class="form-grid two">
      <${Field} label="Amount"><input type="number" step="0.01" required value=${f.amount} onInput=${(e) => setF({ ...f, amount: e.target.value })} /><//>
      <${Field} label="Date"><input type="date" value=${f.date} onInput=${(e) => setF({ ...f, date: e.target.value })} /><//>
      <${Field} label="Method"><select value=${f.method} onChange=${(e) => setF({ ...f, method: e.target.value })}>${['bank', 'cash', 'cheque', 'card'].map((m) => html`<option value=${m}>${METHOD[m]}</option>`)}</select><//>
      <${Field} label="From account"><select value=${f.account_id} onChange=${(e) => setF({ ...f, account_id: e.target.value })}><option value="">Default</option>${money.map((a) => html`<option value=${a.id}>${a.name}</option>`)}</select><//></div>
      <${Field} label="Reference"><input value=${f.reference} onInput=${(e) => setF({ ...f, reference: e.target.value })} placeholder="Transfer ref / cheque no." /><//>
      <${ErrorText} error=${error} /><div class="form-actions"><button type="button" class="btn ghost" onClick=${onClose}>Cancel</button><button class="btn success">Record payment</button></div></form>
  <//>`;
}
