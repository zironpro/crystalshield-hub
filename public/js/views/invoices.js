import { useState, useMemo, useEffect } from 'preact/hooks';
import { html, api, useLoad, store, can, go, toast, INVOICE_STATUS, METHOD, aed, fmtDate, timeAgo, todayISO, sum, daysBetween } from '../lib.js';
import {
  Icon, Badge, StatusBadge, Modal, Field, ErrorText, Spinner, Empty, PageHead, SearchBox, Chips, ContactPicker, Tabs, Timeline, NoteComposer, useAction, openExternal, WaIcon,
} from '../ui.js';
import { LineEditor, lineTotals, TotalsBox } from './lines.js';
import { SendEmail } from './quotes.js';

export function Invoices() {
  const [tab, setTab] = useState('invoices');
  const [status, setStatus] = useState('open');
  const [q, setQ] = useState('');
  const [adding, setAdding] = useState(false);
  const [data] = useLoad('/invoices', ['invoices']);
  const [pays] = useLoad(tab === 'payments' ? '/payments' : null, ['invoices']);
  const all = data?.invoices || [];
  const today = todayISO();
  const isOverdue = (i) => ['unpaid', 'partial'].includes(i.status) && i.due_date < today;
  const rows = useMemo(() => all.filter((i) => (status === 'open' ? ['unpaid', 'partial'].includes(i.status) : status === 'overdue' ? isOverdue(i) : !status || i.status === status)
    && (!q || [i.number, i.contact_name, i.subject, i.quote_number].some((v) => String(v || '').toLowerCase().includes(q.toLowerCase())))), [all, status, q]);
  const outstanding = sum(all.filter((i) => ['unpaid', 'partial'].includes(i.status)), (i) => i.balance);
  const overdue = sum(all.filter(isOverdue), (i) => i.balance);
  const month = today.slice(0, 7);
  const issuedMonth = sum(all.filter((i) => i.date.slice(0, 7) === month && !['draft', 'cancelled'].includes(i.status)), (i) => i.total);
  return html`<div class="page wide">
    <${PageHead} eyebrow="Money" title="Invoices & payments">
      ${can('invoices', 'create') && html`<button class="btn ghost" onClick=${() => setAdding(true)}><${Icon} name="plus" size=${16} /> Manual invoice</button>`}
    <//>
    <div class="kpis"><div class="kpi navy"><span>Outstanding</span><b>${aed(outstanding, { dp: 0 })}</b><small>${all.filter((i) => ['unpaid', 'partial'].includes(i.status)).length} invoices</small></div>
      <div class="kpi ${overdue > 0 ? 'bad' : ''}"><span>Overdue</span><b>${aed(overdue, { dp: 0 })}</b><small>${all.filter(isOverdue).length} past due date</small></div>
      <div class="kpi"><span>Invoiced this month</span><b>${aed(issuedMonth, { dp: 0 })}</b><small>incl. VAT</small></div>
      <div class="kpi"><span>Drafts</span><b>${all.filter((i) => i.status === 'draft').length}</b><small>not yet issued</small></div></div>
    <${Tabs} value=${tab} onChange=${setTab} tabs=${[['invoices', 'Invoices'], ['payments', 'Payments received']]} />
    ${tab === 'invoices' && html`<div class="toolbar"><${SearchBox} value=${q} onInput=${setQ} placeholder="Number, customer…" />
      <${Chips} value=${status} onChange=${setStatus} options=${[['open', 'Unpaid'], ['overdue', 'Overdue'], ['draft', 'Draft'], ['paid', 'Paid'], ['cancelled', 'Cancelled'], ['', 'All']]} /></div>
    ${!data ? html`<${Spinner} />` : !rows.length ? html`<div class="card"><${Empty} icon="receipt" title="No invoices here">Invoices are created from accepted quotations (Quotation → Convert to invoice).<//></div>`
      : html`<div class="card flush"><div class="table-wrap"><table class="table table-cards"><thead><tr><th>Invoice</th><th>Customer</th><th class="hide-m">Date</th><th class="hide-m">Due</th><th class="r">Total</th><th class="r">Balance</th><th>Status</th></tr></thead>
        <tbody>${rows.map((i) => html`<tr class="click" onClick=${() => go(`invoices/${i.id}`)}>
          <td class="title">${i.number}<span class="sub">${i.kind !== 'standard' ? `${i.kind} · ` : ''}${i.quote_number || i.subject}</span></td><td class="hide-m">${i.contact_name}</td>
          <td class="hide-m">${fmtDate(i.date)}</td><td class="hide-m">${['unpaid', 'partial'].includes(i.status) && i.due_date < today ? html`<span class="red">${daysBetween(i.due_date, today)}d overdue</span>` : fmtDate(i.due_date)}</td>
          <td class="r">${aed(i.total)}</td><td class="r strong">${i.balance > 0 && !['draft', 'cancelled'].includes(i.status) ? aed(i.balance) : '—'}</td><td><${StatusBadge} map=${INVOICE_STATUS} status=${i.status} /></td></tr>`)}</tbody></table></div></div>`}`}
    ${tab === 'payments' && (!pays ? html`<${Spinner} />` : html`<div class="card flush"><div class="table-wrap"><table class="table table-cards"><thead><tr><th>Receipt</th><th>Customer</th><th>Date</th><th>Method</th><th class="hide-m">Into</th><th class="r">Amount</th></tr></thead>
      <tbody>${pays.payments.map((p) => html`<tr class="click" onClick=${() => go(`invoices/${p.invoice_id}`)}><td class="title">${p.number}<span class="sub">${p.invoice_number}</span></td><td>${p.contact_name}</td><td>${fmtDate(p.date)}</td><td>${METHOD[p.method]}${p.reference && html`<span class="sub">${p.reference}</span>`}</td><td class="hide-m">${p.account_name}</td><td class="r strong green">${aed(p.amount)}</td></tr>`)}</tbody></table></div></div>`)}
    ${adding && html`<${NewInvoice} onClose=${() => setAdding(false)} />`}
  </div>`;
}

function NewInvoice({ onClose }) {
  const [contact, setContact] = useState(null);
  const [error, setError] = useState('');
  return html`<${Modal} title="Manual invoice" onClose=${onClose}>
    <div class="form"><p class="muted small" style=${{ margin: 0 }}>For sales without a quotation (e.g. supply only, small repairs).</p>
      <${Field} label="Customer"><${ContactPicker} value=${contact} allowNew=${false} onChange=${setContact} autoFocus /><//><${ErrorText} error=${error} />
      <div class="form-actions"><button class="btn ghost" onClick=${onClose}>Cancel</button><button class="btn primary" disabled=${!contact} onClick=${() => api('/invoices', { method: 'POST', body: { contact_id: contact } }).then((r) => go(`invoices/${r.invoice.id}`)).catch((e) => setError(e.message))}>Create draft</button></div></div>
  <//>`;
}

export function InvoiceView({ id }) {
  const [data, reload, err] = useLoad(`/invoices/${id}`, ['invoices']);
  const [f, setF] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [modal, setModal] = useState(null);
  const [tab, setTab] = useState('details');
  const [busy, run] = useAction();
  useEffect(() => { if (data && !dirty) setF({ ...data.invoice, items: data.items.map((i) => ({ ...i })) }); }, [data]);
  if (err) return html`<div class="page"><h1>Not found</h1></div>`;
  if (!data || !f) return html`<div class="page"><${Spinner} /></div>`;
  const i = data.invoice;
  const costs = can('see_costs');
  const editable = can('invoices', 'edit') && i.status !== 'cancelled';
  const itemsEditable = editable && i.paid <= 0;
  const t = lineTotals(f.items, f.discount, f.vat_rate);
  const set = (k) => (e) => { setF({ ...f, [k]: e.target.value }); setDirty(true); };
  const save = () => run(() => api(`/invoices/${i.id}`, { method: 'PUT', body: f }).then(() => { setDirty(false); reload(); }), 'Invoice saved');
  async function issue() {
    if (dirty) await api(`/invoices/${i.id}`, { method: 'PUT', body: f });
    await run(() => api(`/invoices/${i.id}/issue`, { method: 'POST' }).then(() => { setDirty(false); reload(); }), '🧾 Invoice issued and posted to the books');
  }
  const overdue = ['unpaid', 'partial'].includes(i.status) && i.due_date < todayISO();
  return html`<div class="page wide" style=${{ maxWidth: '1280px' }}>
    <a class="back-link" href=${data.deal ? `#/deals/${data.deal.id}` : '#/invoices'}><${Icon} name="back" size=${15} /> ${data.deal ? data.deal.title : 'Invoices'}</a>
    <div class="record-head">
      <div><p class="eyebrow">Tax invoice${i.kind !== 'standard' ? ` · ${i.kind}` : ''}</p><h1>${i.number} · ${aed(i.total)}</h1>
        <div class="sub"><${StatusBadge} map=${INVOICE_STATUS} status=${i.status} />${overdue && html`<${Badge} tone="red">Overdue ${daysBetween(i.due_date, todayISO())} days<//>`}
          ${data.contact && html`<a class="link" href=${`#/contacts/${data.contact.id}`}>${data.contact.name}</a>`}${data.quote && html`<a class="link" href=${`#/quotes/${data.quote.id}`}>${data.quote.number}</a>`}
          ${data.journal && html`<span class="small muted">Posted: ${data.journal.number}</span>`}</div></div>
      <div class="btn-row">
        <a class="btn ghost" href=${i.url} target="_blank" rel="noopener"><${Icon} name="print" size=${15} /> Print / PDF</a>
        ${i.status === 'draft' && can('invoices', 'edit') && html`<button class="btn primary" disabled=${busy} onClick=${issue}>Issue invoice</button>`}
        ${!['draft', 'cancelled'].includes(i.status) && html`<button class="btn wa" onClick=${() => run(() => api(`/invoices/${i.id}/whatsapp`, { method: 'POST' })).then((r) => r && openExternal(r.link))}><${WaIcon} /> WhatsApp</button>
          <button class="btn ghost" onClick=${() => setModal('email')}><${Icon} name="mail" size=${15} /> Email</button>`}
        ${['unpaid', 'partial'].includes(i.status) && can('invoices', 'edit') && html`<button class="btn success" onClick=${() => setModal('pay')}>💰 Record payment</button>`}
      </div>
    </div>
    <div class="money-strip"><div><span>Total (incl. VAT)</span><b>${aed(i.total)}</b></div><div><span>Paid</span><b class="green">${aed(i.paid)}</b></div><div><span>Balance</span><b class=${i.balance > 0 ? 'orange' : ''}>${aed(i.balance)}</b></div>
      <div><span>Issued</span><b>${fmtDate(i.date)}</b></div><div><span>Due</span><b class=${overdue ? 'red' : ''}>${fmtDate(i.due_date)}</b></div></div>
    <${Tabs} value=${tab} onChange=${setTab} tabs=${[['details', 'Details'], ['payments', 'Payments', data.payments.length], ['followup', 'Follow-up', data.timeline.length], ['preview', 'Customer view']]} />
    ${tab === 'details' && html`<div class="stack">
      <div class="card"><div class="form-grid">
        <${Field} label="Subject"><input value=${f.subject} disabled=${!editable} onInput=${set('subject')} /><//>
        <${Field} label="Invoice date"><input type="date" value=${f.date} disabled=${!editable} onInput=${set('date')} /><//>
        <${Field} label="Due date"><input type="date" value=${f.due_date || ''} disabled=${!editable} onInput=${set('due_date')} /><//>
      </div></div>
      <div class="card">${!itemsEditable && i.paid > 0 && html`<p class="muted small" style=${{ marginTop: 0 }}>🔒 Items are locked because payments were recorded.</p>`}
        <${LineEditor} items=${f.items} onChange=${(items) => { setF({ ...f, items }); setDirty(true); }} costs=${costs} readOnly=${!itemsEditable} />
        <div class="lines-foot"><span /><${TotalsBox} t=${t} vatRate=${f.vat_rate} discount=${f.discount} onDiscount=${itemsEditable ? (v) => { setF({ ...f, discount: v }); setDirty(true); } : null} canDiscount=${itemsEditable} /></div></div>
      <div class="card"><div class="form-grid" style=${{ gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' }}>
        <${Field} label="Payment terms"><textarea rows="3" value=${f.terms} disabled=${!editable} onInput=${set('terms')} /><//>
        <${Field} label="Notes on the invoice"><textarea rows="3" value=${f.notes} disabled=${!editable} onInput=${set('notes')} /><//></div></div>
      ${editable && html`<div class="row" style=${{ justifyContent: 'flex-end', position: 'sticky', bottom: '12px' }}>
        ${i.status === 'draft' && can('invoices', 'delete') && html`<button class="btn danger-ghost" onClick=${() => confirm('Delete this draft?') && run(() => api(`/invoices/${i.id}`, { method: 'DELETE' }).then(() => go('invoices')))}>Delete draft</button>`}
        ${!['draft', 'cancelled'].includes(i.status) && i.paid <= 0 && html`<button class="btn danger-ghost" onClick=${() => { const r = prompt('Cancel this invoice? Reason:'); if (r !== null) run(() => api(`/invoices/${i.id}/cancel`, { method: 'POST', body: { reason: r } }).then(reload), 'Invoice cancelled'); }}>Cancel invoice</button>`}
        <span class="spacer" /><button class="btn primary big" style=${{ boxShadow: 'var(--shadow)' }} disabled=${busy || !dirty} onClick=${save}>${dirty ? 'Save changes' : 'Saved'}</button></div>`}
    </div>`}
    ${tab === 'payments' && html`<div class="card">${data.payments.length ? html`<div class="table-wrap"><table class="table"><thead><tr><th>Receipt</th><th>Date</th><th>Method</th><th>Into</th><th class="r">Amount</th><th></th></tr></thead>
      <tbody>${data.payments.map((p) => html`<tr><td class="title">${p.number}<span class="sub">by ${p.user_name || '—'}</span></td><td>${fmtDate(p.date)}</td><td>${METHOD[p.method]}${p.reference && html`<span class="sub">${p.reference}</span>`}</td><td>${p.account_name}</td><td class="r strong green">${aed(p.amount)}</td>
        <td class="nowrap"><a class="btn ghost small" href=${p.url} target="_blank" rel="noopener">Receipt</a> <button class="btn ghost small" onClick=${() => run(() => api(`/payments/${p.id}/whatsapp`, { method: 'POST' })).then((r) => r && openExternal(r.link))}><${WaIcon} size=${13} /></button>
          ${can('invoices', 'delete') && html`<button class="icon-btn small" title="Remove" onClick=${() => confirm(`Remove payment ${p.number}?`) && run(() => api(`/payments/${p.id}`, { method: 'DELETE' }).then(reload), 'Payment removed')}><${Icon} name="trash" size=${14} /></button>`}</td></tr>`)}</tbody></table></div>`
      : html`<${Empty} icon="wallet" title="No payments yet" />`}</div>`}
    ${tab === 'followup' && html`<div class="card"><${NoteComposer} kinds=${['call', 'whatsapp', 'email', 'note']} placeholder="Log a payment follow-up: who you spoke to, promised date…" onSubmit=${(b) => api(`/invoices/${i.id}/followup`, { method: 'POST', body: b }).then(reload)} /><${Timeline} items=${data.timeline} /></div>`}
    ${tab === 'preview' && html`<div class="card flush"><iframe src=${i.url} key=${i.status + i.paid} style=${{ width: '100%', height: '80vh', border: 0, display: 'block' }} title="Invoice" /></div>`}
    ${modal === 'pay' && html`<${PaymentModal} inv=${i} onClose=${() => setModal(null)} onSaved=${reload} />`}
    ${modal === 'email' && html`<${SendEmail} path=${`/invoices/${i.id}/email`} to=${data.contact?.email} title=${`Email ${i.number}`} onClose=${() => setModal(null)} onSent=${reload} />`}
  </div>`;
}

function PaymentModal({ inv, onClose, onSaved }) {
  const [money, setMoney] = useState([]);
  const [f, setF] = useState({ amount: inv.balance, date: todayISO(), method: 'bank', reference: '', account_id: '', notes: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { api('/accounts').then((d) => setMoney(d.money)).catch(() => {}); }, []);
  async function save(e) {
    e.preventDefault(); setBusy(true); setError('');
    try { const r = await api(`/invoices/${inv.id}/payments`, { method: 'POST', body: f }); toast(r.status === 'paid' ? '✅ Fully paid' : '💰 Payment recorded'); onSaved(); onClose(); } catch (err) { setError(err.message); }
    setBusy(false);
  }
  return html`<${Modal} title=${`Payment for ${inv.number}`} onClose=${onClose}>
    <form class="form" onSubmit=${save}>
      <div class="form-grid two">
        <${Field} label=${`Amount (balance ${aed(inv.balance)})`}><input type="number" step="0.01" min="0.01" required value=${f.amount} onInput=${(e) => setF({ ...f, amount: e.target.value })} /><//>
        <${Field} label="Date received"><input type="date" required value=${f.date} onInput=${(e) => setF({ ...f, date: e.target.value })} /><//>
        <${Field} label="Method"><select value=${f.method} onChange=${(e) => setF({ ...f, method: e.target.value, account_id: '' })}>${Object.entries(METHOD).map(([k, v]) => html`<option value=${k}>${v}</option>`)}</select><//>
        <${Field} label="Into account"><select value=${f.account_id} onChange=${(e) => setF({ ...f, account_id: e.target.value })}><option value="">${f.method === 'cash' ? 'Cash in hand' : 'Bank — current account'} (default)</option>${money.map((a) => html`<option value=${a.id}>${a.name}</option>`)}</select><//>
      </div>
      <${Field} label="Reference" hint="Transfer reference, cheque number…"><input value=${f.reference} onInput=${(e) => setF({ ...f, reference: e.target.value })} /><//>
      <${ErrorText} error=${error} />
      <div class="form-actions"><button type="button" class="btn ghost" onClick=${onClose}>Cancel</button><button class="btn success" disabled=${busy}>Record payment</button></div>
    </form>
  <//>`;
}
