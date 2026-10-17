import { useState, useMemo } from 'preact/hooks';
import { html, api, useLoad, lists, can, scope, go, toast, STAGE, QUOTE_STATUS, INVOICE_STATUS, JOB_STATUS, aed, fmtDate, timeAgo, todayISO } from '../lib.js';
import {
  Icon, Avatar, Badge, StatusBadge, Modal, Field, ErrorText, Spinner, Empty, PageHead, SearchBox, Chips, Select, UserSelect, ContactActions,
  Timeline, NoteComposer, Info, Tabs, Files, Tags, useAction,
} from '../ui.js';
import { DealForm } from './deals.js';

export function Contacts() {
  const [q, setQ] = useState('');
  const [type, setType] = useState('');
  const [tag, setTag] = useState('');
  const [adding, setAdding] = useState(false);
  const [data] = useLoad('/contacts', ['contacts', 'deals']);
  const all = data?.contacts || [];
  const tags = [...new Set(all.flatMap((c) => String(c.tags || '').split(',').map((t) => t.trim()).filter(Boolean)))].sort();
  const rows = useMemo(() => all.filter((c) => (!type || c.type === type) && (!tag || (`,${c.tags},`).includes(`,${tag},`))
    && (!q || [c.name, c.contact_person, c.phone, c.email, c.code, c.area].some((x) => String(x || '').toLowerCase().includes(q.toLowerCase())))), [all, q, type, tag]);
  return html`<div class="page wide">
    <${PageHead} eyebrow="Sales" title="Customers" sub="Every customer and contact in one record. Tags classify them so you can segment and follow up.">
      ${can('crm', 'create') && html`<button class="btn primary" onClick=${() => setAdding(true)}><${Icon} name="plus" size=${16} /> Add customer</button>`}
    <//>
    <div class="toolbar">
      <${SearchBox} value=${q} onInput=${setQ} placeholder="Name, phone, email, area…" />
      <${Chips} value=${type} onChange=${setType} options=${[['', 'All', all.length], ['business', 'Business', all.filter((c) => c.type === 'business').length], ['individual', 'Individual', all.filter((c) => c.type === 'individual').length]]} />
      ${tags.length > 0 && html`<${Select} value=${tag} onChange=${setTag} options=${tags} placeholder="All tags" />`}
    </div>
    ${!data ? html`<${Spinner} />` : !rows.length ? html`<div class="card"><${Empty} icon="users" title="No customers found" /></div>`
      : html`<div class="card flush"><div class="table-wrap"><table class="table table-cards"><thead><tr><th>#</th><th>Name</th><th>Type</th><th class="hide-m">Phone</th><th>Tags</th><th class="hide-m r">Deals</th><th class="r">Invoiced</th><th class="hide-m">Owner</th></tr></thead>
      <tbody>${rows.map((c) => html`<tr class="click" onClick=${() => go(`contacts/${c.id}`)}>
        <td class="hide-m mono muted">${c.code}</td>
        <td class="title"><span class="person"><span class="avatar" style=${{ width: '30px', height: '30px', background: c.type === 'business' ? '#0069b7' : '#00386b', fontSize: '11px', borderRadius: '9px' }}>${c.name.split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase()}</span><span>${c.name}${c.contact_person && html`<small>${c.contact_person}</small>`}</span></span></td>
        <td class="hide-m">${c.type === 'business' ? 'Business' : 'Individual'}</td><td class="hide-m">${c.phone}</td><td><${Tags} tags=${c.tags} /></td>
        <td class="hide-m r">${c.deals || ''}</td><td class="r">${c.invoiced ? aed(c.invoiced, { dp: 0 }) : '—'}</td><td class="hide-m"><${Avatar} id=${c.owner_id} size=${22} /></td></tr>`)}</tbody></table></div></div>`}
    ${adding && html`<${ContactForm} onClose=${() => setAdding(false)} onSaved=${(c) => go(`contacts/${c.id}`)} />`}
  </div>`;
}

export function ContactForm({ contact, onClose, onSaved }) {
  const L = lists();
  const [f, setF] = useState(contact ? { ...contact } : { type: 'individual', name: '', contact_person: '', designation: '', phone: '', whatsapp: '', email: '', trn: '', address: '', area: '', city: 'Abu Dhabi', location_url: '', tags: '', source: '', notes: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const tagList = String(f.tags || '').split(',').map((t) => t.trim()).filter(Boolean);
  const toggleTag = (t) => setF({ ...f, tags: (tagList.includes(t) ? tagList.filter((x) => x !== t) : [...tagList, t]).join(',') });
  async function save(e, force = false) {
    e?.preventDefault(); setBusy(true); setError('');
    try {
      const r = contact ? await api(`/contacts/${contact.id}`, { method: 'PATCH', body: f }) : await api('/contacts', { method: 'POST', body: { ...f, force } });
      onSaved?.(r.contact); onClose();
    } catch (err) {
      if (err.status === 409 && confirm(`${err.message}. Add anyway?`)) return save(null, true);
      setError(err.message);
    }
    setBusy(false);
  }
  return html`<${Modal} title=${contact ? 'Edit customer' : 'Add customer'} onClose=${onClose} wide>
    <form class="form" onSubmit=${save}>
      <div class="seg" style=${{ alignSelf: 'flex-start' }}><button type="button" class=${f.type === 'individual' ? 'on' : ''} onClick=${() => setF({ ...f, type: 'individual' })}>Individual</button><button type="button" class=${f.type === 'business' ? 'on' : ''} onClick=${() => setF({ ...f, type: 'business' })}>Business</button></div>
      <div class="form-grid two">
        <${Field} label=${f.type === 'business' ? 'Company name *' : 'Full name *'}><input required value=${f.name} onInput=${set('name')} /><//>
        ${f.type === 'business' && html`<${Field} label="Contact person"><input value=${f.contact_person} onInput=${set('contact_person')} /><//>`}
        ${f.type === 'business' && html`<${Field} label="Designation"><input value=${f.designation} onInput=${set('designation')} placeholder="e.g. Facility Manager" /><//>`}
        <${Field} label="Phone"><input type="tel" value=${f.phone} onInput=${set('phone')} placeholder="+971 …" /><//>
        <${Field} label="WhatsApp (if different)"><input type="tel" value=${f.whatsapp} onInput=${set('whatsapp')} /><//>
        <${Field} label="Email"><input type="email" value=${f.email} onInput=${set('email')} /><//>
        ${f.type === 'business' && html`<${Field} label="TRN (VAT number)"><input value=${f.trn} onInput=${set('trn')} /><//>`}
        <${Field} label="Address"><input value=${f.address} onInput=${set('address')} /><//>
        <${Field} label="Area"><input value=${f.area} onInput=${set('area')} /><//>
        <${Field} label="City"><${Select} value=${f.city} onChange=${(v) => setF({ ...f, city: v })} options=${L.cities || []} placeholder="—" /><//>
        <${Field} label="Google Maps link"><input value=${f.location_url} onInput=${set('location_url')} /><//>
        <${Field} label="Source"><${Select} value=${f.source} onChange=${(v) => setF({ ...f, source: v })} options=${L.sources || []} placeholder="—" /><//>
      </div>
      <${Field} label="Tags"><div class="chips">${[...new Set([...(L.tags || []), ...tagList])].map((t) => html`<button type="button" class="chip ${tagList.includes(t) ? 'on' : ''}" onClick=${() => toggleTag(t)}>${t}</button>`)}</div><//>
      <${Field} label="Notes"><textarea rows="2" value=${f.notes} onInput=${set('notes')} /><//>
      <${ErrorText} error=${error} />
      <div class="form-actions"><button type="button" class="btn ghost" onClick=${onClose}>Cancel</button><button class="btn primary" disabled=${busy}>Save</button></div>
    </form>
  <//>`;
}

export function ContactView({ id }) {
  const [data, reload] = useLoad(`/contacts/${id}`, ['contacts', 'deals', 'invoices', 'jobs']);
  const [tab, setTab] = useState('overview');
  const [modal, setModal] = useState(null);
  const [busy, run] = useAction();
  if (!data) return html`<div class="page"><${Spinner} /></div>`;
  const { contact: c } = data;
  const edit = can('crm', 'edit');
  return html`<div class="page">
    <a class="back-link" href="#/contacts"><${Icon} name="back" size=${15} /> Customers</a>
    <div class="record-head">
      <div><p class="eyebrow">${c.code} · ${c.type === 'business' ? 'Business' : 'Individual'}</p><h1>${c.name}</h1>
        <div class="sub">${c.contact_person && html`<span>👤 ${c.contact_person}${c.designation ? `, ${c.designation}` : ''}</span>`}<${Tags} tags=${c.tags} />${c.owner_name && html`<span class="person"><${Avatar} id=${c.owner_id} size=${20} /> ${c.owner_name}</span>`}</div></div>
      <div class="btn-row">${edit && html`<button class="btn ghost" onClick=${() => setModal('edit')}><${Icon} name="edit" size=${15} /> Edit</button>`}
        ${can('crm', 'create') && html`<button class="btn primary" onClick=${() => setModal('deal')}><${Icon} name="plus" size=${15} /> New deal</button>`}</div>
    </div>
    <div class="money-strip"><div><span>Deals</span><b>${data.deals.length}</b></div><div><span>Won</span><b>${data.deals.filter((d) => d.stage === 'won').length}</b></div>
      <div><span>Invoiced</span><b>${aed(data.totals.invoiced, { dp: 0 })}</b></div><div><span>Paid</span><b class="green">${aed(data.totals.paid, { dp: 0 })}</b></div>
      <div><span>Outstanding</span><b class=${data.totals.invoiced - data.totals.paid > 0 ? 'orange' : ''}>${aed(data.totals.invoiced - data.totals.paid, { dp: 0 })}</b></div>
      <div><span>Active warranties</span><b>${data.warranties.filter((w) => w.status === 'active' && w.end_date >= todayISO()).length}</b></div></div>
    <div class="grid-main">
      <div>
        <${Tabs} value=${tab} onChange=${setTab} tabs=${[['overview', 'Overview'], ['history', 'History', data.timeline.length], ['files', 'Files']]} />
        ${tab === 'overview' && html`<div class="stack">
          <div class="card"><div class="card-head"><h2>Deals</h2></div>${data.deals.length ? html`<div class="list-rows">${data.deals.map((d) => html`<a class="list-row" href=${`#/deals/${d.id}`}><span class="ico-sq">💼</span><span class="grow"><b>${d.title}</b><small>${d.code} · ${d.service || ''} · ${timeAgo(d.updated_at)}</small></span><b>${aed(d.value, { dp: 0 })}</b><${StatusBadge} map=${STAGE} status=${d.stage} /></a>`)}</div>` : html`<p class="muted small">No deals yet.</p>`}</div>
          ${data.quotes.length > 0 && html`<div class="card"><h2 style=${{ marginBottom: '8px' }}>Quotations</h2><div class="list-rows">${data.quotes.map((q) => html`<a class="list-row" href=${`#/quotes/${q.id}`}><span class="ico-sq">📄</span><span class="grow"><b>${q.number}</b><small>${fmtDate(q.date)}</small></span><b>${aed(q.total)}</b><${StatusBadge} map=${QUOTE_STATUS} status=${q.status} /></a>`)}</div></div>`}
          ${data.invoices.length > 0 && html`<div class="card"><h2 style=${{ marginBottom: '8px' }}>Invoices</h2><div class="list-rows">${data.invoices.map((i) => html`<a class="list-row" href=${`#/invoices/${i.id}`}><span class="ico-sq">🧾</span><span class="grow"><b>${i.number}</b><small>${fmtDate(i.date)} · paid ${aed(i.paid)}</small></span><b>${aed(i.total)}</b><${StatusBadge} map=${INVOICE_STATUS} status=${i.status} /></a>`)}</div></div>`}
          ${data.jobs.length > 0 && html`<div class="card"><h2 style=${{ marginBottom: '8px' }}>Installations</h2><div class="list-rows">${data.jobs.map((j) => html`<a class="list-row" href=${`#/jobs/${j.id}`}><span class="ico-sq">🛠</span><span class="grow"><b>${j.number} · ${j.title}</b><small>${fmtDate(j.date)}</small></span><${StatusBadge} map=${JOB_STATUS} status=${j.status} /></a>`)}</div></div>`}
          ${data.warranties.length > 0 && html`<div class="card"><h2 style=${{ marginBottom: '8px' }}>Warranties</h2><div class="list-rows">${data.warranties.map((w) => html`<div class="list-row"><span class="ico-sq">🛡</span><span class="grow"><b>${w.number} · ${w.description || w.product_name}</b><small>${fmtDate(w.start_date)} → ${fmtDate(w.end_date)} · ${w.sqm} SQM</small></span><${Badge} tone=${w.end_date >= todayISO() && w.status === 'active' ? 'green' : 'grey'}>${w.end_date >= todayISO() && w.status === 'active' ? 'Valid' : 'Ended'}<//></div>`)}</div></div>`}
          ${data.leads.length > 0 && html`<div class="card"><h2 style=${{ marginBottom: '8px' }}>Enquiries</h2><div class="list-rows">${data.leads.map((l) => html`<a class="list-row" href=${`#/leads/${l.id}`}><span class="ico-sq">🎯</span><span class="grow"><b>${l.code} · ${l.source}</b><small>${fmtDate(l.created_at)}</small></span></a>`)}</div></div>`}
        </div>`}
        ${tab === 'history' && html`<div class="card"><${NoteComposer} followUp=${false} onSubmit=${(b) => api(`/contacts/${c.id}/notes`, { method: 'POST', body: b }).then(reload)} /><${Timeline} items=${data.timeline} /></div>`}
        ${tab === 'files' && html`<div class="card"><${Files} entity="contact" id=${c.id} canAdd=${edit} kinds=${[['document', 'Document'], ['site_photo', 'Photo'], ['other', 'Other']]} /></div>`}
      </div>
      <aside class="stack"><div class="card"><div class="card-head"><h2>Contact</h2></div><${ContactActions} c=${c} />
        <dl class="info-list" style=${{ marginTop: '14px' }}><${Info} label="Phone">${c.phone}<//><${Info} label="WhatsApp">${c.whatsapp !== c.phone && c.whatsapp}<//><${Info} label="Email">${c.email}<//>
          <${Info} label="Address">${[c.address, c.area, c.city].filter(Boolean).join(', ')}<//><${Info} label="TRN">${c.trn}<//><${Info} label="Source">${c.source}<//>
          <${Info} label="Customer since">${fmtDate(c.created_at)}<//>${c.notes && html`<${Info} label="Notes"><span style=${{ whiteSpace: 'pre-wrap' }}>${c.notes}</span><//>`}</dl></div>
        ${can('crm', 'delete') && html`<button class="btn danger-ghost small" style=${{ alignSelf: 'flex-start' }} disabled=${busy} onClick=${() => confirm(`Delete ${c.name}?`) && run(() => api(`/contacts/${c.id}`, { method: 'DELETE' }).then(() => go('contacts')), 'Deleted')}><${Icon} name="trash" size=${14} /> Delete customer</button>`}
      </aside>
    </div>
    ${modal === 'edit' && html`<${ContactForm} contact=${c} onClose=${() => setModal(null)} onSaved=${reload} />`}
    ${modal === 'deal' && html`<${DealForm} contactId=${c.id} onClose=${() => setModal(null)} onSaved=${(d) => go(`deals/${d.id}`)} />`}
  </div>`;
}
