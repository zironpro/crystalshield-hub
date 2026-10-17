import { useState, useMemo, useEffect } from 'preact/hooks';
import {
  html, api, useLoad, store, useStore, lists, can, scope, go, toast, errToast, STAGE, STAGES, QUOTE_STATUS, INVOICE_STATUS, PO_STATUS, JOB_STATUS,
  aed, kaed, qty, fmtDate, fmtDay, timeAgo, todayISO, t12, sum, mapLink, r2, company,
} from '../lib.js';
import {
  Icon, Avatar, AvatarStack, Badge, StatusBadge, Modal, Field, ErrorText, Spinner, Empty, PageHead, SearchBox, Select, UserSelect, UserMulti,
  ContactActions, Timeline, NoteComposer, Info, Due, ContactPicker, Tabs, Files, Tags, useAction, useVendors, useProducts, ProductSelect,
} from '../ui.js';
import { ActivityModal, ActivityList } from './shared.js';
import { ReasonModal } from './leads.js';
import { LineEditor, lineTotals, TotalsBox, specLine, blankLine } from './lines.js';
import { ExpenseModal } from './expenses.js';

const OPEN_STAGES = STAGES.filter((s) => !['won', 'lost'].includes(s));

export function Deals() {
  const s = useStore();
  const [q, setQ] = useState('');
  const [owner, setOwner] = useState('');
  const [view, setView] = useState(() => { try { return localStorage.getItem('csDealsView') || 'board'; } catch { return 'board'; } });
  const [showClosed, setShowClosed] = useState(false);
  const [adding, setAdding] = useState(false);
  const [lost, setLost] = useState(null);
  const [data, reload] = useLoad('/deals', ['deals']);
  const deals = useMemo(() => (data?.deals || []).filter((d) => (!owner || String(d.owner_id) === owner)
    && (!q || [d.title, d.code, d.contact_name, d.contact_phone].some((x) => String(x || '').toLowerCase().includes(q.toLowerCase())))), [data, q, owner]);
  const setV = (v) => { setView(v); try { localStorage.setItem('csDealsView', v); } catch {} };
  async function move(d, stage) {
    if (stage === 'lost') return setLost(d);
    try { await api(`/deals/${d.id}`, { method: 'PATCH', body: { stage } }); reload(); } catch (e) { errToast(e); }
  }
  const cols = showClosed ? STAGES : OPEN_STAGES;
  const openValue = sum(deals.filter((d) => OPEN_STAGES.includes(d.stage)), (d) => d.value);
  return html`<div class="page wide">
    <${PageHead} eyebrow="Sales" title="Deals" sub=${`${deals.filter((d) => OPEN_STAGES.includes(d.stage)).length} open · ${kaed(openValue)} in the pipeline (excl. VAT)`}>
      <span class="seg"><button class=${view === 'board' ? 'on' : ''} onClick=${() => setV('board')}><${Icon} name="board" size=${15} /> Pipeline</button><button class=${view === 'list' ? 'on' : ''} onClick=${() => setV('list')}><${Icon} name="list" size=${15} /> List</button></span>
      ${can('crm', 'create') && html`<button class="btn primary" onClick=${() => setAdding(true)}><${Icon} name="plus" size=${16} /> New deal</button>`}
    <//>
    <div class="toolbar">
      <${SearchBox} value=${q} onInput=${setQ} placeholder="Search deal, customer, phone…" />
      ${scope('crm') === 'all' && html`<select value=${owner} onChange=${(e) => setOwner(e.target.value)} style=${{ width: 'auto' }}><option value="">Everyone</option>${s.users.filter((u) => u.active).map((u) => html`<option value=${u.id}>${u.name}</option>`)}</select>`}
      ${view === 'board' && html`<label class="check small"><input type="checkbox" checked=${showClosed} onChange=${(e) => setShowClosed(e.target.checked)} /> Show won & lost</label>`}
    </div>
    ${!data ? html`<${Spinner} />` : view === 'board' ? html`<${DealBoard} deals=${deals} cols=${cols} onMove=${move} />`
      : html`<div class="card flush"><div class="table-wrap"><table class="table table-cards"><thead><tr><th>Deal</th><th>Customer</th><th>Stage</th><th class="r">Value</th><th class="hide-m r">SQM</th><th>Owner</th><th class="hide-m">Updated</th></tr></thead>
        <tbody>${deals.map((d) => html`<tr class="click" onClick=${() => go(`deals/${d.id}`)}>
          <td class="title">${d.title}<span class="sub">${d.code}${d.service ? ` · ${d.service}` : ''}</span></td>
          <td class="hide-m">${d.contact_name || '—'}</td>
          <td><${StatusBadge} map=${STAGE} status=${d.stage} /></td><td class="r strong">${aed(d.value, { dp: 0 })}</td><td class="hide-m r">${d.sqm ? qty(d.sqm) : '—'}</td>
          <td><${Avatar} id=${d.owner_id} size=${22} /></td><td class="hide-m small muted">${timeAgo(d.updated_at)}</td></tr>`)}</tbody></table></div></div>`}
    ${adding && html`<${DealForm} onClose=${() => setAdding(false)} onSaved=${(d) => go(`deals/${d.id}`)} />`}
    ${lost && html`<${ReasonModal} title=${`Lost: ${lost.title}`} reasons=${lists().lost_reasons || []} onClose=${() => setLost(null)} onSave=${(r) => api(`/deals/${lost.id}`, { method: 'PATCH', body: { stage: 'lost', lost_reason: r } }).then(() => { setLost(null); reload(); }).catch(errToast)} />`}
  </div>`;
}

function DealBoard({ deals, cols, onMove }) {
  const [drag, setDrag] = useState(null);
  const [over, setOver] = useState(null);
  return html`<div class="board">${cols.map((c) => {
    const list = deals.filter((d) => d.stage === c);
    return html`<section class="column ${over === c ? 'droppable' : ''}" onDragOver=${(e) => { e.preventDefault(); setOver(c); }} onDragLeave=${() => setOver(null)}
      onDrop=${(e) => { e.preventDefault(); setOver(null); if (drag && drag.stage !== c) onMove(drag, c); }}>
      <header><span class="dot" style=${{ background: STAGE[c].color }} />${STAGE[c].label}<span class="muted">${list.length} · ${kaed(sum(list, (d) => d.value))}</span></header>
      ${list.map((d) => html`<a class="board-card ${drag?.id === d.id ? 'dragging' : ''}" href=${`#/deals/${d.id}`} draggable="true" onDragStart=${() => setDrag(d)} onDragEnd=${() => setDrag(null)}>
        <span class="t">${d.title}</span>
        <span class="meta">${d.contact_name || ''}${d.sqm ? ` · ${qty(d.sqm)} SQM` : ''}</span>
        <span class="meta"><${Avatar} id=${d.owner_id} size=${20} />${d.next_follow_up && !['won', 'lost'].includes(d.stage) ? html`<${Due} date=${d.next_follow_up} />` : html`<span>${timeAgo(d.updated_at)}</span>`}<span class="spacer" /><span class="val">${kaed(d.value)}</span></span>
      </a>`)}
      ${!list.length && html`<p class="faint small" style=${{ textAlign: 'center', margin: '18px 0' }}>Drop deals here</p>`}
    </section>`;
  })}</div>`;
}

export function DealForm({ deal, contactId, onClose, onSaved }) {
  const L = lists();
  const me = store.get().me;
  const [f, setF] = useState(deal ? { ...deal } : { title: '', contact_id: contactId || null, service: '', property_type: '', value: '', stage: 'new', source: 'Phone call', address: '', area: '', city: 'Abu Dhabi', location_url: '', expected_close: '', owner_id: me.id, notes: '' });
  const [newContact, setNewContact] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  async function save(e) {
    e.preventDefault(); setBusy(true); setError('');
    try {
      const body = { ...f, contact: newContact || undefined };
      const r = deal ? await api(`/deals/${deal.id}`, { method: 'PATCH', body }) : await api('/deals', { method: 'POST', body });
      onSaved?.(r.deal); onClose();
    } catch (err) { setError(err.message); }
    setBusy(false);
  }
  return html`<${Modal} title=${deal ? 'Edit deal' : 'New deal'} onClose=${onClose} wide>
    <form class="form" onSubmit=${save}>
      ${!deal && html`<${Field} label="Customer *">${newContact ? html`<div class="stack" style=${{ gap: '8px', padding: '12px', background: 'var(--surface-2)', borderRadius: '12px' }}>
          <div class="row"><b>New customer</b><span class="spacer" /><button type="button" class="link-btn small" onClick=${() => setNewContact(null)}>Pick existing instead</button></div>
          <div class="form-grid two"><input required placeholder="Name" value=${newContact.name} onInput=${(e) => setNewContact({ ...newContact, name: e.target.value })} />
            <input placeholder="Phone" value=${newContact.phone || ''} onInput=${(e) => setNewContact({ ...newContact, phone: e.target.value })} />
            <input placeholder="Email" value=${newContact.email || ''} onInput=${(e) => setNewContact({ ...newContact, email: e.target.value })} />
            <select value=${newContact.type} onChange=${(e) => setNewContact({ ...newContact, type: e.target.value })}><option value="individual">Person</option><option value="business">Business</option></select></div></div>`
        : html`<${ContactPicker} value=${f.contact_id} onChange=${(id, c) => (c?.new ? setNewContact({ name: c.name, type: 'individual', phone: '', email: '' }) : setF({ ...f, contact_id: id, address: f.address || c?.address || '', area: f.area || c?.area || '', city: c?.city || f.city }))} />`}<//>`}
      <${Field} label="Deal title" hint="Leave empty to use “Customer — service”"><input value=${f.title} onInput=${set('title')} placeholder="e.g. Villa 23 — solar film, living & bedrooms" /><//>
      <div class="form-grid two">
        <${Field} label="Service"><${Select} value=${f.service} onChange=${(v) => setF({ ...f, service: v })} options=${L.services || []} placeholder="—" /><//>
        <${Field} label="Property type"><${Select} value=${f.property_type} onChange=${(v) => setF({ ...f, property_type: v })} options=${L.property_types || []} placeholder="—" /><//>
        <${Field} label="Estimated value (AED, excl. VAT)" hint="Updates from the pricing sheet / quotation"><input type="number" min="0" value=${f.value} onInput=${set('value')} /><//>
        <${Field} label="Source"><${Select} value=${f.source} onChange=${(v) => setF({ ...f, source: v })} options=${L.sources || []} placeholder="—" /><//>
        <${Field} label="Site address"><input value=${f.address} onInput=${set('address')} placeholder="Villa / building, street" /><//>
        <${Field} label="Area"><input value=${f.area} onInput=${set('area')} placeholder="e.g. Saadiyat Island" /><//>
        <${Field} label="City"><${Select} value=${f.city} onChange=${(v) => setF({ ...f, city: v })} options=${L.cities || []} placeholder="—" /><//>
        <${Field} label="Google Maps link"><input value=${f.location_url} onInput=${set('location_url')} placeholder="https://maps.app.goo.gl/…" /><//>
        <${Field} label="Expected to close"><input type="date" value=${f.expected_close || ''} onInput=${set('expected_close')} /><//>
        ${scope('crm') === 'all' && html`<${Field} label="Owner"><${UserSelect} value=${f.owner_id} onChange=${(v) => setF({ ...f, owner_id: v })} filter=${(u) => u.role_system !== 'installer'} /><//>`}
      </div>
      <${Field} label="Notes"><textarea rows="2" value=${f.notes} onInput=${set('notes')} /><//>
      <${ErrorText} error=${error} />
      <div class="form-actions"><button type="button" class="btn ghost" onClick=${onClose}>Cancel</button><button class="btn primary" disabled=${busy}>${deal ? 'Save' : 'Create deal'}</button></div>
    </form>
  <//>`;
}

export function DealView({ id }) {
  const [data, reload] = useLoad(`/deals/${id}`, ['deals', 'quotes', 'invoices', 'jobs', 'purchases', 'expenses', 'activities']);
  const [tab, setTab] = useState(() => new URLSearchParams(location.hash.split('?')[1] || '').get('tab') || 'overview');
  const [modal, setModal] = useState(null);
  const [busy, run] = useAction();
  if (!data) return html`<div class="page"><${Spinner} /></div>`;
  const { deal: d, contact: c, summary: s } = data;
  const edit = can('crm', 'edit');
  const costs = can('see_costs');
  const patch = (body) => run(() => api(`/deals/${d.id}`, { method: 'PATCH', body }).then(reload));
  const setStage = (st) => (st === 'lost' ? setModal('lost') : patch({ stage: st }));
  const openActs = data.activities.filter((a) => a.status === 'planned');
  return html`<div class="page wide" style=${{ maxWidth: '1320px' }}>
    <a class="back-link" href="#/deals"><${Icon} name="back" size=${15} /> Deals</a>
    <div class="record-head">
      <div><p class="eyebrow">${d.code} · Deal</p><h1>${d.title}</h1>
        <div class="sub"><${StatusBadge} map=${STAGE} status=${d.stage} />${c && html`<a class="link" href=${`#/contacts/${c.id}`}>${c.name}</a>`}<span>${d.service || ''}</span>${d.source && html`<span>via ${d.source}</span>`}<span class="person"><${Avatar} id=${d.owner_id} size=${20} /> ${d.owner_name || 'No owner'}</span></div>
      </div>
      <div class="btn-row">
        ${edit && html`<button class="btn ghost" onClick=${() => setModal('edit')}><${Icon} name="edit" size=${15} /> Edit</button>`}
        <button class="btn ghost" onClick=${() => setModal('activity')}><${Icon} name="calendar" size=${15} /> Schedule</button>
        <a class="btn ghost" href=${`#/chat/d:${d.id}`}><${Icon} name="chat" size=${15} /> Chat</a>
        ${can('quotes', 'create') && html`<button class="btn primary" onClick=${() => setTab('pricing')}><${Icon} name="file" size=${15} /> Price & quote</button>`}
      </div>
    </div>
    ${edit && html`<div class="stagebar">${STAGES.map((st, i) => html`<button onClick=${() => setStage(st)}
      class=${d.stage === st ? (st === 'won' ? 'won' : st === 'lost' ? 'lost' : 'on') : STAGES.indexOf(d.stage) > i && !['won', 'lost'].includes(st) && d.stage !== 'lost' ? 'done' : ''}>${STAGE[st].label}</button>`)}</div>`}
    <div class="money-strip">
      <div><span>Glass measured</span><b>${s.sqm ? `${qty(s.sqm)} SQM` : '—'}</b></div>
      <div><span>${s.quote_number ? `Quoted (${s.quote_number})` : 'Pricing sheet'}</span><b>${aed(s.quoted || s.items_total, { dp: 0 })}</b></div>
      <div><span>Invoiced</span><b>${aed(s.invoiced, { dp: 0 })}</b></div>
      <div><span>Paid</span><b class="green">${aed(s.paid, { dp: 0 })}</b></div>
      <div><span>Balance</span><b class=${s.balance > 0 ? 'orange' : ''}>${aed(s.balance, { dp: 0 })}</b></div>
      ${costs && html`<div><span>Job cost so far</span><b>${aed(s.cost, { dp: 0 })}</b></div><div><span>Profit ${s.invoiced_net ? '' : '(planned)'}</span><b class=${(s.invoiced_net ? s.profit : s.items_profit) >= 0 ? 'green' : 'red'}>${aed(s.invoiced_net ? s.profit : s.items_profit, { dp: 0 })}</b></div>`}
    </div>
    <${Tabs} value=${tab} onChange=${setTab} tabs=${[
      ['overview', 'Overview'], ['measure', 'Measurements', data.measurements.length], ['pricing', 'Pricing', data.items.filter((i) => i.kind === 'item').length],
      can('quotes') && ['quotes', 'Quotations', data.quotes.length], can('jobs') && ['jobs', 'Installation', data.jobs.length],
      (can('invoices') || can('purchases') || can('expenses')) && ['money', 'Invoices & costs', data.invoices.length + data.pos.length + data.expenses.length],
      ['files', 'Files', data.file_count], ['history', 'History', data.timeline.length]]} />

    ${tab === 'overview' && html`<div class="grid-main">
      <div class="stack">
        ${nextStep(d, data, setTab, setModal)}
        <div class="card"><div class="card-head"><h2>Calls, visits & tasks</h2><button class="btn ghost small" onClick=${() => setModal('activity')}><${Icon} name="plus" size=${14} /> Schedule</button></div>
          <${ActivityList} items=${data.activities.slice(0, 12)} onChanged=${reload} empty="Nothing scheduled — book the site visit or a follow-up call." /></div>
        <div class="card"><h2 style=${{ marginBottom: '10px' }}>Latest</h2><${NoteComposer} onSubmit=${(b) => api(`/deals/${d.id}/notes`, { method: 'POST', body: b }).then(reload)} /><${Timeline} items=${data.timeline.slice(0, 8)} />
          ${data.timeline.length > 8 && html`<button class="link-btn small" onClick=${() => setTab('history')}>See all ${data.timeline.length} →</button>`}</div>
      </div>
      <aside class="stack">
        ${c && html`<div class="card"><div class="card-head"><h2>Customer</h2><a class="link small" href=${`#/contacts/${c.id}`}>Open →</a></div>
          <p style=${{ margin: '0 0 2px', fontWeight: 600 }}>${c.name}</p>${c.contact_person && html`<p class="muted small" style=${{ margin: 0 }}>${c.contact_person}${c.designation ? `, ${c.designation}` : ''}</p>`}
          <p class="muted small" style=${{ margin: '2px 0 10px' }}>${[c.phone, c.email].filter(Boolean).join(' · ')}</p><${ContactActions} c=${{ ...c, location_url: d.location_url || c.location_url, address: d.address || c.address, area: d.area || c.area, city: d.city || c.city }} /></div>`}
        <div class="card"><h2 style=${{ marginBottom: '12px' }}>Details</h2><dl class="info-list">
          <${Info} label="Site">${[d.address, d.area, d.city].filter(Boolean).join(', ')}${mapLink(d) && html` · <a href=${mapLink(d)} target="_blank" rel="noopener">map</a>`}<//>
          <${Info} label="Property">${d.property_type}<//><${Info} label="Service">${d.service}<//>
          ${data.lead && html`<${Info} label="From lead"><a href=${`#/leads/${data.lead.id}`}>${data.lead.code}</a> · ${data.lead.source}${data.lead.campaign ? ` · ${data.lead.campaign}` : ''}<//>`}
          <div><dt>Next follow-up</dt><dd>${edit ? html`<input type="date" value=${d.next_follow_up || ''} onChange=${(e) => patch({ next_follow_up: e.target.value || null })} />` : fmtDate(d.next_follow_up)}</dd></div>
          <div><dt>Expected to close</dt><dd>${edit ? html`<input type="date" value=${d.expected_close || ''} onChange=${(e) => patch({ expected_close: e.target.value || null })} />` : fmtDate(d.expected_close)}</dd></div>
          ${scope('crm') === 'all' && edit && html`<div><dt>Owner</dt><dd><${UserSelect} value=${d.owner_id} onChange=${(v) => patch({ owner_id: v })} filter=${(u) => u.role_system !== 'installer'} /></dd></div>`}
          ${d.stage === 'lost' && html`<${Info} label="Lost because">${d.lost_reason}<//>`}
          ${d.notes && html`<${Info} label="Notes"><span style=${{ whiteSpace: 'pre-wrap' }}>${d.notes}</span><//>`}
        </dl></div>
        ${can('crm', 'delete') && html`<button class="btn danger-ghost small" style=${{ alignSelf: 'flex-start' }} disabled=${busy} onClick=${() => confirm('Delete this deal?') && run(() => api(`/deals/${d.id}`, { method: 'DELETE' }).then(() => go('deals')), 'Deal deleted')}><${Icon} name="trash" size=${14} /> Delete deal</button>`}
      </aside></div>`}
    ${tab === 'measure' && html`<${Measurements} deal=${d} rows=${data.measurements} onChanged=${reload} editable=${edit} goPricing=${() => setTab('pricing')} />`}
    ${tab === 'pricing' && html`<${Pricing} deal=${d} items=${data.items} measurements=${data.measurements} onChanged=${reload} />`}
    ${tab === 'quotes' && html`<div class="card"><div class="card-head"><h2>Quotations</h2>${can('quotes', 'create') && html`<button class="btn primary small" onClick=${() => setTab('pricing')}>New from pricing sheet</button>`}</div>
      ${data.quotes.length ? html`<div class="list-rows">${data.quotes.map((q) => html`<a class="list-row" href=${`#/quotes/${q.id}`}><span class="ico-sq">📄</span><span class="grow"><b>${q.number} · ${aed(q.total)}</b><small>${fmtDate(q.date)} · valid until ${fmtDate(q.valid_until)}${q.viewed_at ? ' · 👀 customer opened it' : ''}${q.accepted_at ? ` · accepted ${fmtDate(q.accepted_at)}` : ''}</small></span><${StatusBadge} map=${QUOTE_STATUS} status=${q.status} /></a>`)}</div>`
        : html`<${Empty} icon="file" title="No quotation yet">Price the job on the Pricing tab, then create the quotation in one click.<//>`}</div>`}
    ${tab === 'jobs' && html`<div class="card"><div class="card-head"><h2>Installation</h2>${can('jobs', 'create') && html`<button class="btn primary small" onClick=${() => setModal('job')}><${Icon} name="plus" size=${14} /> Schedule installation</button>`}</div>
      ${data.jobs.length ? html`<div class="list-rows">${data.jobs.map((j) => html`<a class="list-row" href=${`#/jobs/${j.id}`}><span class="ico-sq">🛠</span><span class="grow"><b>${j.number} · ${j.title}</b><small>${j.date ? `${fmtDay(j.date)}${j.end_date && j.end_date !== j.date ? ` → ${fmtDay(j.end_date)}` : ''}${j.start_time ? ` · ${t12(j.start_time)}` : ''}` : 'Not scheduled yet'}</small></span><${AvatarStack} ids=${String(j.installer_ids || '').split(',').map(Number).filter(Boolean)} /><${StatusBadge} map=${JOB_STATUS} status=${j.status} /></a>`)}</div>`
        : html`<${Empty} icon="tool" title="No installation yet">Once the quotation is accepted, schedule the installation team here.<//>`}</div>`}
    ${tab === 'money' && html`<div class="grid-2">
      ${can('invoices') && html`<div class="card"><div class="card-head"><h2>Invoices</h2></div>${data.invoices.length ? html`<div class="list-rows">${data.invoices.map((i) => html`<a class="list-row" href=${`#/invoices/${i.id}`}><span class="ico-sq">🧾</span><span class="grow"><b>${i.number} · ${aed(i.total)}</b><small>${i.kind !== 'standard' ? `${i.kind} · ` : ''}${fmtDate(i.date)} · paid ${aed(i.paid)}</small></span><${StatusBadge} map=${INVOICE_STATUS} status=${i.status} /></a>`)}</div>` : html`<p class="muted small">Create invoices from the accepted quotation.</p>`}</div>`}
      ${can('purchases') && html`<div class="card"><div class="card-head"><h2>Purchase orders</h2></div>${data.pos.length ? html`<div class="list-rows">${data.pos.map((p) => html`<a class="list-row" href=${`#/purchases/${p.id}`}><span class="ico-sq">🚚</span><span class="grow"><b>${p.number} · ${p.vendor_name || ''}</b><small>${fmtDate(p.date)} · ${aed(p.total)}</small></span><${StatusBadge} map=${PO_STATUS} status=${p.status} /></a>`)}</div>` : html`<p class="muted small">Create purchase orders from the pricing sheet (pick a supplier per item).</p>`}</div>`}
      ${can('expenses') && html`<div class="card"><div class="card-head"><h2>Expenses on this job</h2>${can('expenses', 'create') && html`<button class="btn ghost small" onClick=${() => setModal('expense')}><${Icon} name="plus" size=${14} /> Add</button>`}</div>
        ${data.expenses.length ? html`<div class="list-rows">${data.expenses.map((e) => html`<div class="list-row"><span class="ico-sq">💳</span><span class="grow"><b>${e.description || e.category}</b><small>${e.number} · ${fmtDate(e.date)} · ${e.category}</small></span><b>${aed(e.total)}</b></div>`)}</div>` : html`<p class="muted small">Labour, transport, materials bought for this job…</p>`}</div>`}
    </div>`}
    ${tab === 'files' && html`<div class="card"><${Files} entity="deal" id=${d.id} canAdd=${edit} kinds=${[['site_photo', 'Site photo'], ['drawing', 'Drawing'], ['measurement', 'Measurement sheet'], ['document', 'Document'], ['other', 'Other']]} /></div>`}
    ${tab === 'history' && html`<div class="card"><${NoteComposer} onSubmit=${(b) => api(`/deals/${d.id}/notes`, { method: 'POST', body: b }).then(reload)} /><${Timeline} items=${data.timeline} /></div>`}

    ${modal === 'edit' && html`<${DealForm} deal=${d} onClose=${() => setModal(null)} onSaved=${reload} />`}
    ${modal === 'activity' && html`<${ActivityModal} link=${{ deal_id: d.id }} initial=${{ type: ['new'].includes(d.stage) ? 'site_visit' : 'call', assigned_to: d.owner_id }} onClose=${() => setModal(null)} onSaved=${reload} />`}
    ${modal === 'lost' && html`<${ReasonModal} title="Why was it lost?" reasons=${lists().lost_reasons || []} onClose=${() => setModal(null)} onSave=${(r) => patch({ stage: 'lost', lost_reason: r }).then(() => setModal(null))} />`}
    ${modal === 'job' && html`<${JobModal} deal=${d} onClose=${() => setModal(null)} />`}
    ${modal === 'expense' && html`<${ExpenseModal} initial=${{ deal_id: d.id }} onClose=${() => setModal(null)} onSaved=${reload} />`}
  </div>`;
}

// What to do next on this deal (one clear suggestion)
function nextStep(d, data, setTab, setModal) {
  const callout = (icon, text, btn, fn) => html`<div class="callout amber"><span style=${{ fontSize: '20px' }}>${icon}</span><span class="grow">${text}</span>${btn && html`<button class="btn primary small" onClick=${fn}>${btn}</button>`}</div>`;
  if (d.stage === 'lost') return callout('🗂', `This deal was lost${d.lost_reason ? `: ${d.lost_reason}` : ''}.`);
  if (!data.measurements.length && d.stage !== 'won') return callout('📐', 'Next: visit the site and record the glass measurements.', 'Add measurements', () => setTab('measure'));
  if (!data.items.some((i) => i.kind === 'item')) return callout('💲', `${data.summary.sqm} SQM measured. Next: price the films on the pricing sheet.`, 'Open pricing', () => setTab('pricing'));
  if (!data.quotes.length) return callout('📄', 'Pricing is ready. Create the quotation and send it by WhatsApp.', 'Create quotation', () => setTab('pricing'));
  const accepted = data.quotes.find((q) => q.status === 'accepted');
  if (!accepted) {
    const sent = data.quotes.find((q) => q.status === 'sent');
    return sent ? callout('⏳', `Quotation ${sent.number} sent ${timeAgo(sent.sent_at)}${sent.viewed_at ? ' — the customer opened it' : ''}. Follow up with the customer.`, 'Open quotation', () => go(`quotes/${sent.id}`))
      : callout('📤', 'Send the quotation to the customer.', 'Open quotation', () => go(`quotes/${data.quotes[0].id}`));
  }
  if (!data.invoices.length && can('invoices', 'create')) return callout('🧾', `${accepted.number} accepted. Raise the advance invoice.`, 'Open quotation', () => go(`quotes/${accepted.id}`));
  if (!data.jobs.length && can('jobs', 'create')) return callout('🛠', 'Schedule the installation team.', 'Schedule installation', () => setModal('job'));
  const job = data.jobs.find((j) => j.status !== 'signed_off' && j.status !== 'cancelled');
  if (job) return callout('🛠', `Installation ${job.number}: ${JOB_STATUS[job.status].label.toLowerCase()}${job.date ? ` (${fmtDay(job.date)})` : ''}.`, 'Open job', () => go(`jobs/${job.id}`));
  if (data.summary.balance > 0) return callout('💸', `Installation done. ${aed(data.summary.balance)} still to collect.`, can('invoices') ? 'Invoices' : null, () => setTab('money'));
  return callout('✅', 'All done — installed, signed off and paid. Warranty and follow-ups are running automatically.');
}

// ---------- estimation form ----------
function Measurements({ deal, rows, onChanged, editable, goPricing }) {
  const unitDefault = store.get().settings?.docs?.default_unit || 'cm';
  const blank = () => ({ location: '', length: '', width: '', qty: 1, unit: unitDefault, product_id: null });
  const [form, setForm] = useState(rows.length ? null : [blank(), blank(), blank()]);
  const [busy, run] = useAction();
  const UNIT = { mm: 0.001, cm: 0.01, m: 1, in: 0.0254, ft: 0.3048 };
  const sqm = (r) => r2((Number(r.length) || 0) * (UNIT[r.unit] || 0.01) * (Number(r.width) || 0) * (UNIT[r.unit] || 0.01) * (Number(r.qty) || 0));
  const set = (i, k, v) => setForm(form.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  const formTotal = form ? r2(sum(form, sqm)) : 0;
  async function submit() {
    const good = form.filter((r) => Number(r.length) > 0 && Number(r.width) > 0);
    if (!good.length) return errToast('Enter at least one length and width');
    await run(() => api(`/deals/${deal.id}/measurements`, { method: 'POST', body: { rows: good } }).then(() => { setForm(null); onChanged(); }), `${good.length} added`);
  }
  const total = r2(sum(rows, (r) => r.sqm));
  const byLocation = {};
  return html`<div class="stack">
    ${form && editable && html`<div class="card"><div class="card-head"><div><h2>Estimation form</h2><p class="muted small" style=${{ margin: '2px 0 0' }}>Glass length × width × quantity. The area in SQM is worked out automatically and logged on the deal.</p></div></div>
      <div class="table-wrap"><table class="lines"><thead><tr><th>Location / window</th><th class="w-money">Length</th><th class="w-money">Width</th><th class="w-qty">Qty</th><th class="w-unit">Unit</th><th>Film (optional)</th><th class="w-money" style=${{ textAlign: 'right' }}>SQM</th><th class="w-act"></th></tr></thead>
        <tbody>${form.map((r, i) => html`<tr>
          <td><input value=${r.location} placeholder="e.g. Living room – west window" onInput=${(e) => set(i, 'location', e.target.value)} /></td>
          <td><input type="number" inputmode="decimal" step="0.1" value=${r.length} onInput=${(e) => set(i, 'length', e.target.value)} /></td>
          <td><input type="number" inputmode="decimal" step="0.1" value=${r.width} onInput=${(e) => set(i, 'width', e.target.value)} /></td>
          <td><input type="number" inputmode="numeric" min="1" value=${r.qty} onInput=${(e) => set(i, 'qty', e.target.value)} /></td>
          <td><select value=${r.unit} onChange=${(e) => setForm(form.map((x, j) => (j >= i ? { ...x, unit: e.target.value } : x)))}>${Object.keys(UNIT).map((u) => html`<option>${u}</option>`)}</select></td>
          <td style=${{ minWidth: '180px' }}><${ProductSelect} value=${r.product_id} onChange=${(v) => set(i, 'product_id', v)} placeholder="—" /></td>
          <td class="calc">${qty(sqm(r))}</td>
          <td><button class="icon-btn small" onClick=${() => setForm(form.filter((_, j) => j !== i))}><${Icon} name="x" size=${14} /></button></td></tr>`)}</tbody></table></div>
      <div class="row" style=${{ marginTop: '10px' }}><button class="btn ghost small" onClick=${() => setForm([...form, { ...blank(), unit: form[form.length - 1]?.unit || unitDefault, location: form[form.length - 1]?.location || '' }])}><${Icon} name="plus" size=${14} /> Add row</button>
        <span class="spacer" /><b>Total ${qty(formTotal)} SQM</b>
        ${rows.length > 0 && html`<button class="btn ghost" onClick=${() => setForm(null)}>Cancel</button>`}<button class="btn primary" disabled=${busy} onClick=${submit}>Submit</button></div></div>`}
    <div class="card"><div class="card-head"><h2>Measured glass <span class="muted">${qty(total)} SQM · ${sum(rows, (r) => r.qty)} pieces</span></h2>
      <div class="btn-row">${editable && !form && html`<button class="btn ghost small" onClick=${() => setForm([blank(), blank()])}><${Icon} name="plus" size=${14} /> Add measurements</button>`}${rows.length > 0 && html`<button class="btn primary small" onClick=${goPricing}>Price it →</button>`}</div></div>
      ${rows.length ? html`<div class="table-wrap"><table class="table compact"><thead><tr><th>Location</th><th class="r">Length × width</th><th class="r">Qty</th><th class="r">SQM</th><th>Film</th><th></th></tr></thead>
        <tbody>${rows.map((m) => html`<${MRow} m=${m} editable=${editable} onChanged=${onChanged} />`)}</tbody>
        <tfoot><tr><td>Total</td><td></td><td class="r">${sum(rows, (r) => r.qty)}</td><td class="r">${qty(total)}</td><td colspan="2"></td></tr></tfoot></table></div>` : !form && html`<p class="muted small">No measurements yet.</p>`}
    </div></div>`;
}
function MRow({ m, editable, onChanged }) {
  const [e, setE] = useState(null);
  if (e) return html`<tr><td><input value=${e.location} onInput=${(ev) => setE({ ...e, location: ev.target.value })} /></td>
    <td class="r"><span class="row" style=${{ flexWrap: 'nowrap', gap: '4px' }}><input type="number" value=${e.length} onInput=${(ev) => setE({ ...e, length: ev.target.value })} style=${{ width: '80px' }} />×<input type="number" value=${e.width} onInput=${(ev) => setE({ ...e, width: ev.target.value })} style=${{ width: '80px' }} /></span></td>
    <td class="r"><input type="number" value=${e.qty} onInput=${(ev) => setE({ ...e, qty: ev.target.value })} style=${{ width: '64px' }} /></td><td></td>
    <td><${ProductSelect} value=${e.product_id} onChange=${(v) => setE({ ...e, product_id: v })} placeholder="—" /></td>
    <td class="nowrap"><button class="btn primary small" onClick=${() => api(`/measurements/${m.id}`, { method: 'PATCH', body: e }).then(() => { setE(null); onChanged(); }).catch(errToast)}>Save</button></td></tr>`;
  return html`<tr><td>${m.location || '—'}${m.notes && html`<span class="sub">${m.notes}</span>`}</td><td class="r nowrap">${qty(m.length)} × ${qty(m.width)} ${m.unit}</td><td class="r">${m.qty}</td><td class="r strong">${qty(m.sqm)}</td><td class="small">${m.product_name || '—'}</td>
    <td class="nowrap">${editable && html`<button class="icon-btn small" onClick=${() => setE({ ...m })}><${Icon} name="edit" size=${14} /></button><button class="icon-btn small" onClick=${() => confirm('Remove this row?') && api(`/measurements/${m.id}`, { method: 'DELETE' }).then(onChanged).catch(errToast)}><${Icon} name="trash" size=${14} /></button>`}</td></tr>`;
}

// ---------- pricing sheet → quotation & purchase orders ----------
function Pricing({ deal, items: initial, measurements, onChanged }) {
  const costs = can('see_costs');
  const vendors = useVendors();
  const products = useProducts();
  const [items, setItems] = useState(initial.length ? initial.map((i) => ({ ...i })) : []);
  const [dirty, setDirty] = useState(false);
  const [busy, run] = useAction();
  useEffect(() => { if (!dirty) setItems(initial.map((i) => ({ ...i }))); }, [initial]);
  const change = (n) => { setItems(n); setDirty(true); };
  const vat = store.get().settings?.docs?.vat_rate ?? 5;
  const t = lineTotals(items, 0, vat);
  const edit = can('crm', 'edit');
  // measured SQM grouped by the film chosen on site
  function fillFromMeasurements() {
    const groups = new Map();
    for (const m of measurements) {
      const key = m.product_id || 0;
      if (!groups.has(key)) groups.set(key, { sqm: 0, locs: new Set() });
      groups.get(key).sqm += m.sqm;
      if (m.location) groups.get(key).locs.add(m.location.split(/[–—-]/)[0].trim());
    }
    const lines = [...groups.entries()].map(([pid, g]) => {
      const p = products.find((x) => x.id === pid);
      return { ...blankLine(), product_id: p?.id || null, name: p?.name || 'Window film supply & installation', description: [p ? specLine(p) : '', [...g.locs].slice(0, 5).join(', ')].filter(Boolean).join('\n'),
        qty: r2(g.sqm), unit: 'SQM', price: p?.sell_price || 0, cost: costs ? p?.avg_cost || p?.cost_price || 0 : 0 };
    });
    change([...items.filter((i) => i.kind === 'header' || i.name), ...lines]);
  }
  async function save() {
    await run(() => api(`/deals/${deal.id}/items`, { method: 'PUT', body: { items } }).then(() => { setDirty(false); onChanged(); }), 'Pricing saved');
  }
  async function quote() {
    if (dirty) await api(`/deals/${deal.id}/items`, { method: 'PUT', body: { items } });
    const r = await run(() => api('/quotes', { method: 'POST', body: { deal_id: deal.id } }));
    if (r) { toast(`📄 Quotation ${r.quote.number} created`); go(`quotes/${r.quote.id}`); }
  }
  async function pos() {
    if (dirty) await api(`/deals/${deal.id}/items`, { method: 'PUT', body: { items } });
    const r = await run(() => api(`/deals/${deal.id}/purchase-orders`, { method: 'POST', body: {} }));
    if (r) { toast(`🚚 ${r.pos.map((p) => p.number).join(', ')} created`); go(r.pos.length === 1 ? `purchases/${r.pos[0].id}` : 'purchases'); }
  }
  return html`<div class="card">
    <div class="card-head"><div><h2>Pricing sheet</h2><p class="muted small" style=${{ margin: '2px 0 0' }}>${costs ? 'Selling price, margin, purchase price and supplier on one screen. The quotation and the purchase orders come from these same items.' : 'Items and selling prices. The quotation comes from these items.'}</p></div>
      ${edit && measurements.length > 0 && html`<button class="btn ghost small" onClick=${fillFromMeasurements}><${Icon} name="ruler" size=${14} /> Fill from measurements (${qty(sum(measurements, (m) => m.sqm))} SQM)</button>`}</div>
    ${items.length === 0 && !edit ? html`<p class="muted">No items yet.</p>` : html`<${LineEditor} items=${items} onChange=${change} costs=${costs} vendors=${costs && can('purchases') ? vendors : null} readOnly=${!edit} />`}
    <div class="lines-foot">
      <div class="stack" style=${{ gap: '8px' }}>
        ${costs && items.length > 0 && html`<span class="profit-pill ${t.profit < 0 ? 'neg' : ''}">Live profit ${aed(t.profit)} · ${t.subtotal ? Math.round((t.profit / t.subtotal) * 1000) / 10 : 0}%</span>`}
        <div class="btn-row">
          ${edit && html`<button class="btn ${dirty ? 'primary' : 'ghost'}" disabled=${busy || !dirty} onClick=${save}>${dirty ? 'Save items' : 'Saved'}</button>`}
          ${can('quotes', 'create') && items.some((i) => i.kind === 'item') && html`<button class="btn amber" disabled=${busy} onClick=${quote}><${Icon} name="file" size=${15} /> Create quotation</button>`}
          ${can('purchases', 'create') && costs && items.some((i) => i.vendor_id) && html`<button class="btn ghost" disabled=${busy} onClick=${pos}><${Icon} name="truck" size=${15} /> Create purchase orders</button>`}
        </div>
      </div>
      <${TotalsBox} t=${t} costs=${costs} vatRate=${vat} />
    </div>
  </div>`;
}

// ---------- schedule an installation ----------
export function JobModal({ deal, job, onClose, onSaved }) {
  const [f, setF] = useState(job ? { ...job, installer_ids: job.installers || [] } : { date: '', end_date: '', start_time: '08:00', end_time: '', installer_ids: [], lead_installer_id: null, instructions: '', deal_id: deal?.id });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const installerFilter = (u) => u.role_system === 'installer' || /install|tech|fitter/i.test(u.title || '');
  async function save(e) {
    e.preventDefault(); setBusy(true); setError('');
    try {
      if (job) { await api(`/jobs/${job.id}`, { method: 'PATCH', body: f }); onSaved?.(); onClose(); }
      else { const r = await api('/jobs', { method: 'POST', body: f }); toast(`🛠 ${r.job.number} scheduled`); go(`jobs/${r.job.id}`); }
    } catch (err) { setError(err.message); setBusy(false); }
  }
  return html`<${Modal} title=${job ? `Reschedule ${job.number}` : 'Schedule installation'} onClose=${onClose}>
    <form class="form" onSubmit=${save}>
      ${!job && html`<p class="muted small" style=${{ margin: 0 }}>The scope (films and SQM) comes from the accepted quotation; film to take from stock includes the cutting allowance.</p>`}
      <div class="form-grid two">
        <${Field} label="Date"><input type="date" value=${f.date || ''} onInput=${(e) => setF({ ...f, date: e.target.value })} /><//>
        <${Field} label="Until (multi-day jobs)"><input type="date" value=${f.end_date || ''} onInput=${(e) => setF({ ...f, end_date: e.target.value })} /><//>
        <${Field} label="Start time"><input type="time" value=${f.start_time || ''} onInput=${(e) => setF({ ...f, start_time: e.target.value })} /><//>
        <${Field} label="Finish (approx.)"><input type="time" value=${f.end_time || ''} onInput=${(e) => setF({ ...f, end_time: e.target.value })} /><//>
      </div>
      <${Field} label="Installation team"><${UserMulti} value=${f.installer_ids} onChange=${(v) => setF({ ...f, installer_ids: v, lead_installer_id: v.includes(f.lead_installer_id) ? f.lead_installer_id : v[0] || null })} filter=${(u) => installerFilter(u) || (f.installer_ids || []).includes(u.id)} /><//>
      ${f.installer_ids.length > 1 && html`<${Field} label="Team leader"><${UserSelect} value=${f.lead_installer_id} onChange=${(v) => setF({ ...f, lead_installer_id: v })} filter=${(u) => f.installer_ids.includes(u.id)} /><//>`}
      <${Field} label="Instructions for the team"><textarea rows="3" value=${f.instructions} onInput=${(e) => setF({ ...f, instructions: e.target.value })} placeholder="Access, parking, building permit, which rooms first, contact on site…" /><//>
      <${ErrorText} error=${error} />
      <div class="form-actions"><button type="button" class="btn ghost" onClick=${onClose}>Cancel</button><button class="btn primary" disabled=${busy}>${job ? 'Save' : 'Schedule'}</button></div>
    </form>
  <//>`;
}
