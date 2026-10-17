import { useState, useMemo, useEffect } from 'preact/hooks';
import { html, api, useLoad, store, can, go, toast, errToast, QUOTE_STATUS, INVOICE_STATUS, aed, fmtDate, timeAgo, todayISO, sum } from '../lib.js';
import {
  Icon, Avatar, Badge, StatusBadge, Modal, Field, ErrorText, Spinner, Empty, PageHead, SearchBox, Chips, ContactPicker, Tabs, Timeline, useAction, useVendors, openExternal, WaIcon,
} from '../ui.js';
import { LineEditor, lineTotals, TotalsBox } from './lines.js';

export function Quotes() {
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [adding, setAdding] = useState(false);
  const [data] = useLoad('/quotes', ['quotes']);
  const all = data?.quotes || [];
  const rows = useMemo(() => all.filter((x) => (!status || x.status === status) && (!q || [x.number, x.contact_name, x.subject, x.deal_code].some((v) => String(v || '').toLowerCase().includes(q.toLowerCase())))), [all, status, q]);
  const n = (s) => all.filter((x) => x.status === s).length;
  return html`<div class="page wide">
    <${PageHead} eyebrow="Sales" title="Quotations" sub=${`${n('sent')} waiting for the customer · ${aed(sum(all.filter((x) => x.status === 'sent'), (x) => x.total), { dp: 0 })}`}>
      ${can('quotes', 'create') && html`<button class="btn ghost" onClick=${() => setAdding(true)}><${Icon} name="plus" size=${16} /> Blank quotation</button>`}
    <//>
    <div class="callout info" style=${{ marginBottom: '14px' }}><span>💡</span><span class="grow">The quickest way: open a deal → <b>Pricing</b> → <b>Create quotation</b>. Items, SQM and site details are filled in for you.</span></div>
    <div class="toolbar"><${SearchBox} value=${q} onInput=${setQ} placeholder="Number, customer, subject…" />
      <${Chips} value=${status} onChange=${setStatus} options=${[['', 'All', all.length], ['draft', 'Draft', n('draft')], ['sent', 'Sent', n('sent')], ['accepted', 'Accepted', n('accepted')], ['rejected', 'Rejected', n('rejected')], ['expired', 'Expired', n('expired')]]} /></div>
    ${!data ? html`<${Spinner} />` : !rows.length ? html`<div class="card"><${Empty} icon="file" title="No quotations" /></div>`
      : html`<div class="card flush"><div class="table-wrap"><table class="table table-cards"><thead><tr><th>Quotation</th><th>Customer</th><th class="hide-m">Date</th><th class="hide-m">Valid until</th><th class="r">Total</th><th>Status</th><th class="hide-m">Owner</th></tr></thead>
        <tbody>${rows.map((x) => html`<tr class="click" onClick=${() => go(`quotes/${x.id}`)}>
          <td class="title">${x.number}<span class="sub">${x.subject}</span></td><td class="hide-m">${x.contact_name || '—'}${x.deal_code && html`<span class="sub">${x.deal_code}</span>`}</td>
          <td class="hide-m">${fmtDate(x.date)}</td><td class="hide-m">${x.valid_until ? html`<span class=${x.status === 'sent' && x.valid_until < todayISO() ? 'red' : ''}>${fmtDate(x.valid_until)}</span>` : '—'}</td>
          <td class="r strong">${aed(x.total)}</td><td><${StatusBadge} map=${QUOTE_STATUS} status=${x.status} />${x.viewed_at && x.status === 'sent' && html`<span class="sub">👀 opened ${timeAgo(x.viewed_at)}</span>`}</td>
          <td class="hide-m"><${Avatar} id=${x.owner_id} size=${22} /></td></tr>`)}</tbody></table></div></div>`}
    ${adding && html`<${BlankQuote} onClose=${() => setAdding(false)} />`}
  </div>`;
}

function BlankQuote({ onClose }) {
  const [contact, setContact] = useState(null);
  const [error, setError] = useState('');
  return html`<${Modal} title="Blank quotation" onClose=${onClose}>
    <div class="form"><${Field} label="Customer"><${ContactPicker} value=${contact} allowNew=${false} onChange=${setContact} autoFocus /><//>
      <${ErrorText} error=${error} />
      <div class="form-actions"><button class="btn ghost" onClick=${onClose}>Cancel</button><button class="btn primary" disabled=${!contact} onClick=${() => api('/quotes', { method: 'POST', body: { contact_id: contact } }).then((r) => go(`quotes/${r.quote.id}`)).catch((e) => setError(e.message))}>Create</button></div></div>
  <//>`;
}

export function QuoteView({ id }) {
  const [data, reload, err] = useLoad(`/quotes/${id}`, ['quotes', 'invoices']);
  const [tab, setTab] = useState('edit');
  const [f, setF] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [modal, setModal] = useState(null);
  const [busy, run] = useAction();
  const vendors = useVendors();
  useEffect(() => { if (data && !dirty) setF({ ...data.quote, items: data.items.map((i) => ({ ...i })) }); }, [data]);
  if (err) return html`<div class="page"><h1>Not found</h1></div>`;
  if (!data || !f) return html`<div class="page"><${Spinner} /></div>`;
  const q = data.quote;
  const costs = can('see_costs');
  const locked = q.status === 'accepted' && !store.get().me.perms.admin;
  const editable = can('quotes', 'edit') && !locked;
  const t = lineTotals(f.items, f.discount, f.vat_rate);
  const set = (k) => (e) => { setF({ ...f, [k]: e.target ? (e.target.type === 'checkbox' ? e.target.checked : e.target.value) : e }); setDirty(true); };
  const save = () => run(() => api(`/quotes/${q.id}`, { method: 'PUT', body: f }).then(() => { setDirty(false); reload(); }), 'Quotation saved');
  const status = async (s, extra = {}) => { if (dirty) await api(`/quotes/${q.id}`, { method: 'PUT', body: f }); await run(() => api(`/quotes/${q.id}/status`, { method: 'POST', body: { status: s, ...extra } }).then(() => { setDirty(false); reload(); }), `Marked ${QUOTE_STATUS[s].label.toLowerCase()}`); };
  async function whatsapp() {
    if (dirty) await api(`/quotes/${q.id}`, { method: 'PUT', body: f });
    const r = await run(() => api(`/quotes/${q.id}/whatsapp`, { method: 'POST' }));
    if (r) { openExternal(r.link); setDirty(false); reload(); }
  }
  const invoiced = data.invoiced;
  const remaining = Math.round((q.subtotal - q.discount - invoiced) * 100) / 100;
  return html`<div class="page wide" style=${{ maxWidth: '1320px' }}>
    <a class="back-link" href=${data.deal ? `#/deals/${data.deal.id}` : '#/quotes'}><${Icon} name="back" size=${15} /> ${data.deal ? data.deal.title : 'Quotations'}</a>
    <div class="record-head">
      <div><p class="eyebrow">Quotation</p><h1>${q.number} · ${aed(t.total)}</h1>
        <div class="sub"><${StatusBadge} map=${QUOTE_STATUS} status=${q.status} />${data.contact && html`<a class="link" href=${`#/contacts/${data.contact.id}`}>${data.contact.name}</a>`}
          ${q.sent_at && html`<span>Sent ${timeAgo(q.sent_at)}</span>`}${q.viewed_at && html`<span>👀 Customer opened it ${timeAgo(q.viewed_at)}</span>`}${q.accepted_at && html`<span class="green">✓ Accepted ${q.accepted_name ? `by ${q.accepted_name} ` : ''}${timeAgo(q.accepted_at)}</span>`}</div></div>
      <div class="btn-row">
        <a class="btn ghost" href=${q.url} target="_blank" rel="noopener"><${Icon} name="print" size=${15} /> Print / PDF</a>
        ${can('quotes', 'edit') && html`<button class="btn wa" disabled=${busy} onClick=${whatsapp}><${WaIcon} /> Send on WhatsApp</button>
          <button class="btn ghost" onClick=${() => setModal('email')}><${Icon} name="mail" size=${15} /> Email</button>`}
        ${can('invoices', 'create') && ['sent', 'accepted'].includes(q.status) && remaining > 0.009 && html`<button class="btn primary" onClick=${() => setModal('invoice')}><${Icon} name="receipt" size=${15} /> Convert to invoice</button>`}
      </div>
    </div>
    ${can('quotes', 'edit') && html`<div class="row" style=${{ marginBottom: '14px' }}>
      ${q.status === 'draft' && html`<button class="btn ghost small" onClick=${() => status('sent')}>Mark as sent</button>`}
      ${['sent', 'expired', 'draft'].includes(q.status) && html`<button class="btn success small" onClick=${() => status('accepted', { name: data.contact?.contact_person || data.contact?.name })}>✓ Customer accepted</button><button class="btn ghost small" onClick=${() => setModal('reject')}>Customer declined</button>`}
      ${['accepted', 'rejected', 'expired'].includes(q.status) && can('quotes', 'create') && html`<button class="btn ghost small" onClick=${() => run(() => api(`/quotes/${q.id}/duplicate`, { method: 'POST' }).then((r) => go(`quotes/${r.quote.id}`)), 'Revised copy created')}><${Icon} name="copy" size=${14} /> Revise (new copy)</button>`}
      ${q.status === 'sent' && html`<span class="muted small">Valid until ${fmtDate(q.valid_until)}. The customer can accept online from the link.</span>`}
      ${locked && html`<span class="muted small">🔒 Accepted quotations are locked — revise to make changes.</span>`}
    </div>`}
    ${data.invoices.length > 0 && html`<div class="callout ok" style=${{ marginBottom: '14px' }}><span>🧾</span><span class="grow">Invoiced ${aed(invoiced)} of ${aed(q.subtotal - q.discount)} (excl. VAT): ${data.invoices.map((i) => html`<a class="link" href=${`#/invoices/${i.id}`} style=${{ marginRight: '10px' }}>${i.number} (${INVOICE_STATUS[i.status].label})</a>`)}</span></div>`}
    <${Tabs} value=${tab} onChange=${setTab} tabs=${[['edit', editable ? 'Edit' : 'Details'], ['preview', 'Customer view'], ['history', 'History', data.timeline.length]]} />
    ${tab === 'edit' && html`<div class="stack">
      <div class="card"><div class="form-grid">
        <${Field} label="Subject"><input value=${f.subject} disabled=${!editable} onInput=${set('subject')} /><//>
        <${Field} label="Date"><input type="date" value=${f.date} disabled=${!editable} onInput=${set('date')} /><//>
        <${Field} label="Valid until"><input type="date" value=${f.valid_until || ''} disabled=${!editable} onInput=${set('valid_until')} /><//>
        <${Field} label="Attention"><input value=${f.attention} disabled=${!editable} onInput=${set('attention')} /><//>
        <${Field} label="Site location"><input value=${f.site_location} disabled=${!editable} onInput=${set('site_location')} /><//>
        <${Field} label="Glass area (SQM)"><input type="number" step="0.01" value=${f.glass_area} disabled=${!editable} onInput=${set('glass_area')} /><//>
        <${Field} label="Glass location"><input value=${f.glass_location} disabled=${!editable} onInput=${set('glass_location')} placeholder="e.g. Lobby & entrance" /><//>
      </div><label class="check" style=${{ marginTop: '10px' }}><input type="checkbox" checked=${!!f.show_images} disabled=${!editable} onChange=${set('show_images')} /> Show product images on the quotation</label></div>
      <div class="card"><h2 style=${{ marginBottom: '10px' }}>Scope of work / pricing</h2>
        <${LineEditor} items=${f.items} onChange=${(items) => { setF({ ...f, items }); setDirty(true); }} costs=${costs} vendors=${costs && can('purchases') ? vendors : null} readOnly=${!editable} />
        <div class="lines-foot"><span />${html`<${TotalsBox} t=${t} costs=${costs} vatRate=${f.vat_rate} discount=${f.discount} onDiscount=${(v) => { setF({ ...f, discount: v }); setDirty(true); }} canDiscount=${editable && can('give_discount')} />`}</div></div>
      <div class="card"><div class="form-grid" style=${{ gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
        <${Field} label="Introduction"><textarea rows="4" value=${f.intro} disabled=${!editable} onInput=${set('intro')} /><//>
        <${Field} label="Remarks (one per line)"><textarea rows="4" value=${f.remarks} disabled=${!editable} onInput=${set('remarks')} /><//>
        <${Field} label="Terms & conditions (one per line)"><textarea rows="4" value=${f.terms} disabled=${!editable} onInput=${set('terms')} /><//>
      </div></div>
      ${editable && html`<div class="row" style=${{ position: 'sticky', bottom: '12px', justifyContent: 'flex-end' }}>
        ${can('quotes', 'delete') && q.status !== 'accepted' && html`<button class="btn danger-ghost" onClick=${() => confirm('Delete this quotation?') && run(() => api(`/quotes/${q.id}`, { method: 'DELETE' }).then(() => go(data.deal ? `deals/${data.deal.id}` : 'quotes')), 'Deleted')}>Delete</button>`}
        <span class="spacer" />
        <button class="btn primary big" style=${{ boxShadow: 'var(--shadow)' }} disabled=${busy || !dirty} onClick=${save}>${dirty ? 'Save changes' : 'Saved'}</button></div>`}
    </div>`}
    ${tab === 'preview' && html`<div class="card flush"><iframe src=${`${q.url}${dirty ? '' : ''}`} key=${q.updated_at} style=${{ width: '100%', height: '80vh', border: 0, display: 'block' }} title="Quotation preview" /></div>${dirty && html`<p class="muted small">Save your changes to see them here.</p>`}`}
    ${tab === 'history' && html`<div class="card"><${Timeline} items=${data.timeline} /></div>`}
    ${modal === 'invoice' && html`<${ToInvoice} q=${q} invoiced=${invoiced} onClose=${() => setModal(null)} />`}
    ${modal === 'email' && html`<${SendEmail} path=${`/quotes/${q.id}/email`} to=${data.contact?.email} title=${`Email ${q.number}`} onClose=${() => setModal(null)} onSent=${reload} />`}
    ${modal === 'reject' && html`<${RejectModal} onClose=${() => setModal(null)} onSave=${(reason) => status('rejected', { reason }).then(() => setModal(null))} />`}
  </div>`;
}

function ToInvoice({ q, invoiced, onClose }) {
  const advance = store.get().settings?.docs?.advance_pct || 50;
  const [kind, setKind] = useState(invoiced > 0 ? 'balance' : 'advance');
  const [pct, setPct] = useState(advance);
  const [busy, run] = useAction();
  const net = q.subtotal - q.discount;
  async function go_() {
    const r = await run(() => api(`/quotes/${q.id}/invoice`, { method: 'POST', body: { kind: kind === 'balance' ? 'standard' : kind, percent: pct } }));
    if (r) { toast(`🧾 ${r.invoice.number} drafted`); go(`invoices/${r.invoice.id}`); }
  }
  return html`<${Modal} title="Convert to invoice" onClose=${onClose}>
    <div class="form">
      <p class="muted" style=${{ margin: 0 }}>No re-typing — the items come straight from ${q.number}. You can review the draft before issuing it.</p>
      <div class="stack" style=${{ gap: '8px' }}>
        ${invoiced <= 0 && html`<label class="check"><input type="radio" name="k" checked=${kind === 'advance'} onChange=${() => setKind('advance')} /><span><b>Advance invoice</b> — <input type="number" min="1" max="100" value=${pct} onInput=${(e) => setPct(e.target.value)} style=${{ width: '70px', padding: '3px 6px' }} />% = ${aed(net * pct / 100)} + VAT</span></label>`}
        <label class="check"><input type="radio" name="k" checked=${kind === 'standard' || kind === 'balance'} onChange=${() => setKind(invoiced > 0 ? 'balance' : 'standard')} /><span><b>${invoiced > 0 ? 'Balance invoice' : 'Full invoice'}</b> — ${aed(net - invoiced)} + VAT${invoiced > 0 ? ` (all items, less ${aed(invoiced)} invoiced earlier)` : ''}</span></label>
      </div>
      <div class="form-actions"><button class="btn ghost" onClick=${onClose}>Cancel</button><button class="btn primary" disabled=${busy} onClick=${go_}>Create draft invoice</button></div>
    </div>
  <//>`;
}

export function SendEmail({ path, to, title, onClose, onSent }) {
  const [f, setF] = useState({ to: to || '', message: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function send(e) {
    e.preventDefault(); setBusy(true); setError('');
    try { await api(path, { method: 'POST', body: f }); toast('✉️ Email sent'); onSent?.(); onClose(); } catch (err) { setError(err.message); }
    setBusy(false);
  }
  return html`<${Modal} title=${title} onClose=${onClose}>
    <form class="form" onSubmit=${send}>
      <${Field} label="To"><input type="email" required value=${f.to} onInput=${(e) => setF({ ...f, to: e.target.value })} /><//>
      <${Field} label="Message" hint="Leave empty for the standard message with the link"><textarea rows="5" value=${f.message} onInput=${(e) => setF({ ...f, message: e.target.value })} /><//>
      <${ErrorText} error=${error} />
      <div class="form-actions"><button type="button" class="btn ghost" onClick=${onClose}>Cancel</button><button class="btn primary" disabled=${busy}>${busy ? 'Sending…' : 'Send'}</button></div>
    </form>
  <//>`;
}
function RejectModal({ onClose, onSave }) {
  const [r, setR] = useState('');
  const opts = ['Price too high', 'Went with a competitor', 'Postponed', 'Changed scope'];
  return html`<${Modal} title="Customer declined" onClose=${onClose}>
    <div class="form"><div class="chips">${opts.map((o) => html`<button type="button" class="chip ${r === o ? 'on' : ''}" onClick=${() => setR(o)}>${o}</button>`)}</div>
      <input value=${r} onInput=${(e) => setR(e.target.value)} placeholder="Reason" />
      <div class="form-actions"><button class="btn ghost" onClick=${onClose}>Cancel</button><button class="btn danger" disabled=${!r.trim()} onClick=${() => onSave(r.trim())}>Save</button></div></div>
  <//>`;
}
