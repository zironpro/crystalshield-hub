import { useState, useMemo } from 'preact/hooks';
import {
  html, api, useLoad, store, useStore, lists, can, scope, go, toast, errToast, LEAD_STATUS, timeAgo, fmtDate, aed, todayISO, hashParam, setHashParam,
} from '../lib.js';
import {
  Icon, Avatar, Badge, StatusBadge, Modal, Field, ErrorText, Spinner, Empty, PageHead, SearchBox, Chips, Select, UserSelect, ContactActions,
  Timeline, NoteComposer, Info, Due, ContactPicker, Tags, Files, Tabs, useAction,
} from '../ui.js';
import { ActivityModal, ActivityList } from './shared.js';

const OPEN = ['new', 'contacted', 'qualified'];

export function Leads() {
  const s = useStore();
  const [status, setStatus] = useState(hashParam('status') || 'open');
  const [q, setQ] = useState('');
  const [source, setSource] = useState('');
  const [owner, setOwner] = useState('');
  const [view, setView] = useState(() => { try { return localStorage.getItem('csLeadsView') || 'list'; } catch { return 'list'; } });
  const [adding, setAdding] = useState(false);
  const [data, reload] = useLoad('/leads', ['leads']);
  const all = data?.leads || [];
  const filtered = useMemo(() => all.filter((l) => {
    if (status === 'open' ? !OPEN.includes(l.status) : status !== 'all' && l.status !== status) return false;
    if (source && l.source !== source) return false;
    if (owner && String(l.owner_id) !== owner) return false;
    if (q) { const t = q.toLowerCase(); if (![l.name, l.company, l.phone, l.email, l.code, l.message].some((x) => String(x || '').toLowerCase().includes(t))) return false; }
    return true;
  }), [all, status, source, owner, q]);
  const count = (st) => all.filter((l) => (st === 'open' ? OPEN.includes(l.status) : st === 'all' || l.status === st)).length;
  const month = todayISO().slice(0, 7);
  const bySource = {};
  for (const l of all) if (l.created_at.slice(0, 7) === month) bySource[l.source] = (bySource[l.source] || 0) + 1;
  const setV = (v) => { setView(v); try { localStorage.setItem('csLeadsView', v); } catch {} };

  async function move(id, st) {
    try { await api(`/leads/${id}`, { method: 'PATCH', body: { status: st } }); reload(); } catch (e) { errToast(e); }
  }
  return html`<div class="page wide">
    <${PageHead} eyebrow="Sales" title="Leads" sub="Every enquiry from the website, ads, WhatsApp and calls — with its source and owner.">
      <span class="seg"><button class=${view === 'list' ? 'on' : ''} onClick=${() => setV('list')}><${Icon} name="list" size=${15} /></button><button class=${view === 'board' ? 'on' : ''} onClick=${() => setV('board')}><${Icon} name="board" size=${15} /></button></span>
      ${can('crm', 'create') && html`<button class="btn primary" onClick=${() => setAdding(true)}><${Icon} name="plus" size=${16} /> New lead</button>`}
    <//>
    ${Object.keys(bySource).length > 0 && html`<div class="card" style=${{ marginBottom: '14px', padding: '12px 16px' }}><div class="row" style=${{ gap: '8px 18px' }}>
      <span class="section-title" style=${{ margin: 0 }}>This month by source</span>
      ${Object.entries(bySource).sort((a, b) => b[1] - a[1]).map(([src, n]) => html`<button class="link-btn" style=${{ color: source === src ? 'var(--navy)' : 'var(--muted)', fontWeight: source === src ? 700 : 500 }} onClick=${() => setSource(source === src ? '' : src)}>${src} <b style=${{ color: 'var(--text)' }}>${n}</b></button>`)}
    </div></div>`}
    <div class="toolbar">
      <${SearchBox} value=${q} onInput=${setQ} placeholder="Search name, phone, company…" />
      <${Chips} value=${status} onChange=${(v) => { setStatus(v); setHashParam('status', v === 'open' ? null : v); }} options=${[['open', 'Open', count('open')], ['new', 'New', count('new')], ['contacted', 'Contacted', count('contacted')], ['qualified', 'Qualified', count('qualified')], ['unqualified', 'Unqualified'], ['converted', 'Converted'], ['all', 'All']]} />
      <${Select} value=${source} onChange=${setSource} options=${lists().sources || []} placeholder="All sources" />
      ${scope('crm') === 'all' && html`<select value=${owner} onChange=${(e) => setOwner(e.target.value)} style=${{ width: 'auto' }}><option value="">Everyone</option>${s.users.filter((u) => u.active).map((u) => html`<option value=${u.id}>${u.name}</option>`)}</select>`}
    </div>
    ${!data ? html`<${Spinner} />` : view === 'board' ? html`<${LeadBoard} leads=${filtered.filter((l) => l.status !== 'converted')} onMove=${move} />`
      : filtered.length === 0 ? html`<div class="card"><${Empty} icon="target" title="No leads here">New enquiries from your website, ads and WhatsApp appear here automatically.<//></div>`
      : html`<div class="card flush"><div class="table-wrap"><table class="table table-cards"><thead><tr><th>Lead</th><th>Source</th><th class="hide-m">Interested in</th><th>Owner</th><th>Status</th><th>Follow-up</th><th class="hide-m">Received</th></tr></thead>
        <tbody>${filtered.map((l) => html`<tr class="click" onClick=${() => go(`leads/${l.id}`)}>
          <td class="title">${l.name}${l.company && html`<span class="sub">${l.company}</span>`}<span class="sub">${l.phone}</span></td>
          <td><${Badge} tone=${/meta|insta|face/i.test(l.source) ? 'blue' : /whats/i.test(l.source) ? 'green' : /google/i.test(l.source) ? 'orange' : 'grey'}>${l.source}<//>${l.campaign && html`<span class="sub">${l.campaign}</span>`}</td>
          <td class="hide-m">${l.service || '—'}${l.property_type && html`<span class="sub">${l.property_type}${l.area ? ` · ${l.area}` : ''}</span>`}</td>
          <td>${l.owner_id ? html`<span class="person"><${Avatar} id=${l.owner_id} size=${22} /><span class="small">${l.owner_name}</span></span>` : html`<span class="faint small">Unassigned</span>`}</td>
          <td><${StatusBadge} map=${LEAD_STATUS} status=${l.status} /></td>
          <td>${OPEN.includes(l.status) ? html`<${Due} date=${l.next_follow_up} />` : html`<span class="faint">—</span>`}</td>
          <td class="hide-m small muted">${timeAgo(l.created_at)}</td>
        </tr>`)}</tbody></table></div></div>`}
    ${adding && html`<${LeadForm} onClose=${() => setAdding(false)} onSaved=${(l) => go(`leads/${l.id}`)} />`}
  </div>`;
}

function LeadBoard({ leads, onMove }) {
  const [drag, setDrag] = useState(null);
  const [over, setOver] = useState(null);
  const cols = ['new', 'contacted', 'qualified', 'unqualified'];
  return html`<div class="board">${cols.map((c) => {
    const list = leads.filter((l) => l.status === c);
    return html`<section class="column ${over === c ? 'droppable' : ''}" onDragOver=${(e) => { e.preventDefault(); setOver(c); }} onDragLeave=${() => setOver(null)}
      onDrop=${(e) => { e.preventDefault(); setOver(null); if (drag && drag.status !== c) onMove(drag.id, c); }}>
      <header><${Badge} tone=${LEAD_STATUS[c].tone}>${LEAD_STATUS[c].label}<//><span class="muted">${list.length}</span></header>
      ${list.map((l) => html`<a class="board-card ${drag?.id === l.id ? 'dragging' : ''}" href=${`#/leads/${l.id}`} draggable="true" onDragStart=${() => setDrag(l)} onDragEnd=${() => setDrag(null)}>
        <span class="t">${l.name}</span>
        <span class="meta">${l.source}${l.service ? ` · ${l.service}` : ''}</span>
        <span class="meta"><${Avatar} id=${l.owner_id} size=${20} /><${Due} date=${l.next_follow_up} /><span class="spacer" />${l.est_value > 0 && html`<span class="val">${aed(l.est_value, { dp: 0 })}</span>`}</span>
      </a>`)}
    </section>`;
  })}</div>`;
}

export function LeadForm({ lead, onClose, onSaved }) {
  const L = lists();
  const me = store.get().me;
  const [f, setF] = useState(lead ? { ...lead } : { name: '', company: '', phone: '', email: '', source: 'Phone call', campaign: '', property_type: '', service: '', city: 'Abu Dhabi', area: '', message: '', est_value: '', owner_id: me.id, next_follow_up: todayISO() });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  async function save(e) {
    e.preventDefault(); setBusy(true); setError('');
    try {
      const r = lead ? await api(`/leads/${lead.id}`, { method: 'PATCH', body: f }) : await api('/leads', { method: 'POST', body: f });
      if (r.duplicate) toast('This number already has an open lead — the enquiry was added to it');
      onSaved?.(r.lead); onClose();
    } catch (err) { setError(err.message); }
    setBusy(false);
  }
  return html`<${Modal} title=${lead ? 'Edit lead' : 'New lead'} onClose=${onClose} wide>
    <form class="form" onSubmit=${save}>
      <div class="form-grid two">
        <${Field} label="Name *"><input required value=${f.name} onInput=${set('name')} /><//>
        <${Field} label="Company"><input value=${f.company} onInput=${set('company')} placeholder="If it's a business" /><//>
        <${Field} label="Phone / WhatsApp"><input type="tel" value=${f.phone} onInput=${set('phone')} placeholder="+971 50 123 4567" /><//>
        <${Field} label="Email"><input type="email" value=${f.email} onInput=${set('email')} /><//>
        <${Field} label="Source"><${Select} value=${f.source} onChange=${(v) => setF({ ...f, source: v })} options=${L.sources || []} /><//>
        <${Field} label="Campaign / ad"><input value=${f.campaign} onInput=${set('campaign')} placeholder="e.g. Villa heat — Oct" /><//>
        <${Field} label="Property type"><${Select} value=${f.property_type} onChange=${(v) => setF({ ...f, property_type: v })} options=${L.property_types || []} placeholder="—" /><//>
        <${Field} label="Interested in"><${Select} value=${f.service} onChange=${(v) => setF({ ...f, service: v })} options=${L.services || []} placeholder="—" /><//>
        <${Field} label="City"><${Select} value=${f.city} onChange=${(v) => setF({ ...f, city: v })} options=${L.cities || []} placeholder="—" /><//>
        <${Field} label="Area / community"><input value=${f.area} onInput=${set('area')} placeholder="e.g. Khalifa City, Al Reem" /><//>
        <${Field} label="Estimated value (AED)"><input type="number" min="0" value=${f.est_value} onInput=${set('est_value')} /><//>
        <${Field} label="Next follow-up"><input type="date" value=${f.next_follow_up || ''} onInput=${set('next_follow_up')} /><//>
      </div>
      ${scope('crm') === 'all' && html`<${Field} label="Owner"><${UserSelect} value=${f.owner_id} onChange=${(v) => setF({ ...f, owner_id: v })} filter=${(u) => u.role_system !== 'installer'} /><//>`}
      <${Field} label="Enquiry / notes"><textarea rows="3" value=${f.message} onInput=${set('message')} placeholder="What they asked for: rooms, sun side, heat, privacy…" /><//>
      <${ErrorText} error=${error} />
      <div class="form-actions"><button type="button" class="btn ghost" onClick=${onClose}>Cancel</button><button class="btn primary" disabled=${busy}>${lead ? 'Save' : 'Add lead'}</button></div>
    </form>
  <//>`;
}

export function LeadView({ id }) {
  const [data, reload] = useLoad(`/leads/${id}`, ['leads', 'activities']);
  const [edit, setEdit] = useState(false);
  const [convert, setConvert] = useState(false);
  const [schedule, setSchedule] = useState(false);
  const [unq, setUnq] = useState(false);
  const [tab, setTab] = useState('history');
  const [busy, run] = useAction();
  if (!data) return html`<div class="page"><${Spinner} /></div>`;
  const { lead: l, timeline, activities, deal, contact, similar } = data;
  const editable = can('crm', 'edit');
  const patch = (body) => run(() => api(`/leads/${l.id}`, { method: 'PATCH', body }).then(reload));
  const raw = l.raw && typeof l.raw === 'object' ? Object.entries(l.raw).filter(([k, v]) => v && typeof v !== 'object' && !['key', 'redirect', 'name', 'phone', 'email', 'message'].includes(k)) : [];
  return html`<div class="page">
    <a class="back-link" href="#/leads"><${Icon} name="back" size=${15} /> Leads</a>
    <div class="record-head">
      <div><p class="eyebrow">${l.code} · Lead</p><h1>${l.name}</h1>
        <div class="sub"><${StatusBadge} map=${LEAD_STATUS} status=${l.status} /><span>${l.source}${l.campaign ? ` · ${l.campaign}` : ''}</span><span>Received ${timeAgo(l.created_at)}</span>${l.company && html`<span>🏢 ${l.company}</span>`}</div>
      </div>
      <div class="btn-row">
        ${editable && html`<button class="btn ghost" onClick=${() => setEdit(true)}><${Icon} name="edit" size=${15} /> Edit</button>`}
        <button class="btn ghost" onClick=${() => setSchedule(true)}><${Icon} name="calendar" size=${15} /> Schedule</button>
        ${deal ? html`<a class="btn primary" href=${`#/deals/${deal.id}`}>Open deal ${deal.code} →</a>`
          : can('crm', 'create') && l.status !== 'unqualified' && html`<button class="btn primary" onClick=${() => setConvert(true)}>Convert to deal →</button>`}
      </div>
    </div>
    ${l.status !== 'converted' && editable && html`<div class="stagebar">${['new', 'contacted', 'qualified'].map((st, i) => html`<button class=${l.status === st ? 'on' : ['new', 'contacted', 'qualified'].indexOf(l.status) > i ? 'done' : ''} onClick=${() => patch({ status: st })}>${LEAD_STATUS[st].label}</button>`)}
      <button class=${l.status === 'unqualified' ? 'lost' : ''} onClick=${() => (l.status === 'unqualified' ? patch({ status: 'contacted' }) : setUnq(true))}>${l.status === 'unqualified' ? 'Unqualified' : 'Not a fit'}</button></div>`}
    <div class="grid-main">
      <div>
        <div class="card" style=${{ marginBottom: '16px' }}><div class="card-head"><h2>Contact</h2><${ContactActions} c=${l} text=${`Hello ${l.name.split(' ')[0]}, this is ${store.get().me.name} from Crystal Shield regarding your enquiry about window film.`} /></div>
          ${l.message && html`<p style=${{ margin: '0 0 6px', whiteSpace: 'pre-wrap' }}>${l.message}</p>`}
          ${raw.length > 0 && html`<details><summary class="small muted" style=${{ cursor: 'pointer' }}>Form details (${raw.length})</summary><dl class="info-list" style=${{ marginTop: '8px' }}>${raw.map(([k, v]) => html`<${Info} label=${k.replace(/_/g, ' ')}>${String(v)}<//>`)}</dl></details>`}
        </div>
        <${Tabs} value=${tab} onChange=${setTab} tabs=${[['history', 'History', timeline.length], ['activities', 'Calls & visits', activities.filter((a) => a.status === 'planned').length], ['files', 'Files']]} />
        ${tab === 'history' && html`<${NoteComposer} onSubmit=${(b) => api(`/leads/${l.id}/notes`, { method: 'POST', body: b }).then(reload)} /><${Timeline} items=${timeline} />`}
        ${tab === 'activities' && html`<div class="card"><div class="card-head"><h2>Scheduled</h2><button class="btn ghost small" onClick=${() => setSchedule(true)}><${Icon} name="plus" size=${14} /> Add</button></div><${ActivityList} items=${activities} onChanged=${reload} /></div>`}
        ${tab === 'files' && html`<div class="card"><${Files} entity="lead" id=${l.id} canAdd=${editable} /></div>`}
      </div>
      <aside class="stack">
        <div class="card"><h2 style=${{ marginBottom: '12px' }}>Details</h2><dl class="info-list">
          <${Info} label="Phone">${l.phone}<//><${Info} label="Email">${l.email}<//>
          <${Info} label="Interested in">${l.service}<//><${Info} label="Property">${l.property_type}<//>
          <${Info} label="Location">${[l.area, l.city].filter(Boolean).join(', ')}<//>
          <${Info} label="Estimated value">${l.est_value > 0 && aed(l.est_value)}<//>
          <${Info} label="Tags"><${Tags} tags=${l.tags} /><//>
          <div><dt>Owner</dt><dd>${scope('crm') === 'all' && editable ? html`<${UserSelect} value=${l.owner_id} onChange=${(v) => patch({ owner_id: v })} filter=${(u) => u.role_system !== 'installer'} placeholder="Unassigned" />` : l.owner_name || 'Unassigned'}</dd></div>
          <div><dt>Next follow-up</dt><dd>${editable ? html`<input type="date" value=${l.next_follow_up || ''} onChange=${(e) => patch({ next_follow_up: e.target.value || null })} />` : fmtDate(l.next_follow_up)}</dd></div>
          ${l.status === 'unqualified' && html`<${Info} label="Reason">${l.lost_reason}<//>`}
        </dl></div>
        ${contact && html`<a class="card list-row" href=${`#/contacts/${contact.id}`} style=${{ borderTop: 0 }}><span class="ico-sq">👤</span><span class="grow"><b>${contact.name}</b><small>Existing customer · ${contact.code}</small></span></a>`}
        ${similar?.length > 0 && html`<div class="card"><h3 style=${{ marginBottom: '6px' }}>Earlier enquiries from this number</h3>${similar.map((x) => html`<a class="list-row" href=${`#/leads/${x.id}`}><span class="grow"><b>${x.code} · ${x.name}</b><small>${fmtDate(x.created_at)} · ${LEAD_STATUS[x.status]?.label}</small></span></a>`)}</div>`}
        ${can('crm', 'delete') && html`<button class="btn danger-ghost small" style=${{ alignSelf: 'flex-start' }} disabled=${busy} onClick=${() => confirm('Delete this lead and its history?') && run(() => api(`/leads/${l.id}`, { method: 'DELETE' }).then(() => go('leads')), 'Lead deleted')}><${Icon} name="trash" size=${14} /> Delete lead</button>`}
      </aside>
    </div>
    ${edit && html`<${LeadForm} lead=${l} onClose=${() => setEdit(false)} onSaved=${reload} />`}
    ${schedule && html`<${ActivityModal} link=${{ lead_id: l.id }} initial=${{ type: 'call', assigned_to: l.owner_id || store.get().me.id }} onClose=${() => setSchedule(false)} onSaved=${reload} />`}
    ${convert && html`<${ConvertModal} lead=${l} onClose=${() => setConvert(false)} />`}
    ${unq && html`<${ReasonModal} title="Not a fit" reasons=${lists().lost_reasons || []} onClose=${() => setUnq(false)} onSave=${(r) => patch({ status: 'unqualified', lost_reason: r }).then(() => setUnq(false))} />`}
  </div>`;
}

export function ReasonModal({ title, reasons, onClose, onSave }) {
  const [r, setR] = useState(reasons[0] || '');
  const [other, setOther] = useState('');
  return html`<${Modal} title=${title} onClose=${onClose}>
    <div class="form"><div class="chips">${reasons.map((x) => html`<button type="button" class="chip ${r === x ? 'on' : ''}" onClick=${() => setR(x)}>${x}</button>`)}<button type="button" class="chip ${r === '' ? 'on' : ''}" onClick=${() => setR('')}>Other…</button></div>
      ${r === '' && html`<input autoFocus value=${other} onInput=${(e) => setOther(e.target.value)} placeholder="Reason" />`}
      <div class="form-actions"><button class="btn ghost" onClick=${onClose}>Cancel</button><button class="btn danger" disabled=${!(r || other.trim())} onClick=${() => onSave(r || other.trim())}>Save</button></div></div>
  <//>`;
}

function ConvertModal({ lead, onClose }) {
  const [f, setF] = useState({ title: `${lead.company || lead.name} — ${lead.service || 'Window film'}`, value: lead.est_value || '', stage: 'site_visit', contact_type: lead.company ? 'business' : 'individual', contact_id: lead.contact_id || null, expected_close: '' });
  const [linkExisting, setLinkExisting] = useState(!!lead.contact_id);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function save(e) {
    e.preventDefault(); setBusy(true); setError('');
    try {
      const r = await api(`/leads/${lead.id}/convert`, { method: 'POST', body: { ...f, contact_id: linkExisting ? f.contact_id : null } });
      toast('🎯 Deal created');
      go(`deals/${r.deal_id}`);
    } catch (err) { setError(err.message); setBusy(false); }
  }
  return html`<${Modal} title="Convert to deal" onClose=${onClose}>
    <form class="form" onSubmit=${save}>
      <p class="muted" style=${{ margin: 0 }}>The lead becomes a customer and a deal in the pipeline. Owner, source and history carry over.</p>
      <${Field} label="Deal title"><input required value=${f.title} onInput=${(e) => setF({ ...f, title: e.target.value })} /><//>
      <div class="form-grid two">
        <${Field} label="Estimated value (AED)"><input type="number" min="0" value=${f.value} onInput=${(e) => setF({ ...f, value: e.target.value })} /><//>
        <${Field} label="Start at stage"><select value=${f.stage} onChange=${(e) => setF({ ...f, stage: e.target.value })}><option value="new">New</option><option value="site_visit">Site visit</option><option value="measured">Measured</option></select><//>
      </div>
      <label class="check"><input type="checkbox" checked=${linkExisting} onChange=${(e) => setLinkExisting(e.target.checked)} /><span>This is an existing customer</span></label>
      ${linkExisting ? html`<${Field} label="Customer"><${ContactPicker} value=${f.contact_id} allowNew=${false} onChange=${(v) => setF({ ...f, contact_id: v })} /><//>`
        : html`<${Field} label="New customer is a…"><div class="seg"><button type="button" class=${f.contact_type === 'individual' ? 'on' : ''} onClick=${() => setF({ ...f, contact_type: 'individual' })}>Person</button><button type="button" class=${f.contact_type === 'business' ? 'on' : ''} onClick=${() => setF({ ...f, contact_type: 'business' })}>Business</button></div><//>`}
      <${ErrorText} error=${error} />
      <div class="form-actions"><button type="button" class="btn ghost" onClick=${onClose}>Cancel</button><button class="btn primary" disabled=${busy || (linkExisting && !f.contact_id)}>Create deal</button></div>
    </form>
  <//>`;
}
