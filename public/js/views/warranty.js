import { useState, useMemo } from 'preact/hooks';
import { html, api, useLoad, store, can, scope, go, toast, errToast, FOLLOWUP, fmtDate, todayISO, addDays, qty, hashParam, setHashParam, waLink } from '../lib.js';
import { Icon, Avatar, Badge, Modal, Field, ErrorText, Spinner, Empty, PageHead, SearchBox, Chips, Tabs, UserSelect, ContactPicker, ProductSelect, Due, useAction, openExternal, WaIcon } from '../ui.js';
import { JobModal } from './deals.js';

export function Warranty() {
  const [tab, setTabS] = useState(hashParam('tab') || 'followups');
  const setTab = (t) => { setTabS(t); setHashParam('tab', t === 'followups' ? null : t); };
  return html`<div class="page wide">
    <${PageHead} eyebrow="After-sales" title="Warranty & follow-ups" sub="After every sign-off the hub plans the review request, a check-in call, a free inspection and a reminder before the warranty ends." />
    <${Tabs} value=${tab} onChange=${setTab} tabs=${[['followups', 'Follow-ups'], can('warranty') && ['warranties', 'Warranties'], can('warranty') && ['claims', 'Claims']]} />
    ${tab === 'followups' && html`<${Followups} />`}
    ${tab === 'warranties' && html`<${Warranties} />`}
    ${tab === 'claims' && html`<${Claims} />`}
  </div>`;
}

function Followups() {
  const [filter, setFilter] = useState('due');
  const [mine, setMine] = useState(scope('warranty') !== 'all' && scope('crm') !== 'all');
  const [adding, setAdding] = useState(false);
  const [data, reload] = useLoad('/followups', ['followups']);
  const today = todayISO();
  const all = (data?.followups || []).filter((f) => !mine || f.assigned_to === store.get().me.id);
  const sets = {
    due: all.filter((f) => f.status === 'pending' && f.due_date <= today),
    week: all.filter((f) => f.status === 'pending' && f.due_date > today && f.due_date <= addDays(today, 7)),
    later: all.filter((f) => f.status === 'pending' && f.due_date > addDays(today, 7)),
    done: all.filter((f) => f.status !== 'pending'),
  };
  return html`<div>
    <div class="toolbar"><${Chips} value=${filter} onChange=${setFilter} options=${[['due', 'Due now', sets.due.length], ['week', 'Next 7 days', sets.week.length], ['later', 'Later', sets.later.length], ['done', 'Done']]} />
      ${(scope('warranty') === 'all' || scope('crm') === 'all') && html`<label class="check small"><input type="checkbox" checked=${mine} onChange=${(e) => setMine(e.target.checked)} /> Only mine</label>`}
      <span class="spacer" /><button class="btn ghost" onClick=${() => setAdding(true)}><${Icon} name="plus" size=${15} /> Follow-up</button></div>
    ${!data ? html`<${Spinner} />` : !sets[filter].length ? html`<div class="card"><${Empty} icon="shield" title=${filter === 'due' ? 'Nothing due — nice work' : 'Nothing here'}>Follow-ups are created automatically after each installation sign-off and when quotations are sent.<//></div>`
      : html`<div class="card"><div class="list-rows">${sets[filter].map((f) => html`<${FollowRow} f=${f} onChanged=${reload} />`)}</div></div>`}
    ${adding && html`<${FollowupForm} onClose=${() => setAdding(false)} onSaved=${reload} />`}
  </div>`;
}
function FollowRow({ f, onChanged }) {
  const [busy, run] = useAction();
  const [outcome, setOutcome] = useState('');
  const [closing, setClosing] = useState(false);
  const done = (status) => run(() => api(`/followups/${f.id}`, { method: 'PATCH', body: { status, outcome } }).then(onChanged), status === 'done' ? 'Done ✓' : 'Skipped');
  return html`<div class="list-row" style=${{ alignItems: 'flex-start', flexWrap: 'wrap' }}>
    <span class="ico-sq">${FOLLOWUP[f.type]?.icon || '🔁'}</span>
    <span class="grow" style=${{ minWidth: '220px' }}><b>${f.title}</b>
      <small>${f.contact_name ? html`<a class="link" href=${`#/contacts/${f.contact_id}`}>${f.contact_name}</a>` : ''}${f.deal_code ? ` · ${f.deal_code}` : ''}${f.job_number ? ` · ${f.job_number}` : ''}${f.warranty_number ? ` · ${f.warranty_number}` : ''}${f.assigned_name ? ` · ${f.assigned_name}` : ''}</small>
      ${f.outcome && html`<small>→ ${f.outcome}</small>`}
      ${closing && html`<div class="inline-input" style=${{ marginTop: '6px' }}><input autoFocus placeholder="What happened? (optional)" value=${outcome} onInput=${(e) => setOutcome(e.target.value)} onKeyDown=${(e) => e.key === 'Enter' && done('done')} /><button class="btn success small" onClick=${() => done('done')}>Done</button></div>`}
    </span>
    ${f.status === 'pending' ? html`<${Due} date=${f.due_date} />
      ${f.contact_id && html`<button class="btn wa small" disabled=${busy} onClick=${() => run(() => api(`/followups/${f.id}/whatsapp`, { method: 'POST' })).then((r) => r && openExternal(r.link))}><${WaIcon} size=${13} /> Message</button>`}
      <button class="btn ghost small" onClick=${() => setClosing(!closing)}><${Icon} name="check" size=${14} /> Done</button>
      <button class="btn ghost small" title="Snooze a week" onClick=${() => run(() => api(`/followups/${f.id}`, { method: 'PATCH', body: { due_date: addDays(todayISO(), 7) } }).then(onChanged), 'Moved to next week')}>+7d</button>
      <button class="icon-btn small" title="Skip" onClick=${() => done('skipped')}><${Icon} name="x" size=${14} /></button>`
      : html`<${Badge} tone=${f.status === 'done' ? 'green' : 'grey'}>${f.status}<//><span class="small muted">${fmtDate(f.done_at || f.due_date)}</span>`}
  </div>`;
}
function FollowupForm({ onClose, onSaved }) {
  const [f, setF] = useState({ title: '', due_date: addDays(todayISO(), 1), assigned_to: store.get().me.id, contact_id: null, note: '' });
  const [error, setError] = useState('');
  return html`<${Modal} title="New follow-up" onClose=${onClose}><form class="form" onSubmit=${(e) => { e.preventDefault(); api('/followups', { method: 'POST', body: f }).then(() => { onSaved(); onClose(); }).catch((err) => setError(err.message)); }}>
    <${Field} label="What"><input required value=${f.title} onInput=${(e) => setF({ ...f, title: e.target.value })} placeholder="e.g. Call about the second floor" /><//>
    <${Field} label="Customer"><${ContactPicker} value=${f.contact_id} allowNew=${false} onChange=${(v) => setF({ ...f, contact_id: v })} /><//>
    <div class="form-grid two"><${Field} label="When"><input type="date" value=${f.due_date} onInput=${(e) => setF({ ...f, due_date: e.target.value })} /><//><${Field} label="Who"><${UserSelect} value=${f.assigned_to} onChange=${(v) => setF({ ...f, assigned_to: v })} /><//></div>
    <${ErrorText} error=${error} /><div class="form-actions"><button type="button" class="btn ghost" onClick=${onClose}>Cancel</button><button class="btn primary">Add</button></div></form><//>`;
}

function Warranties() {
  const [status, setStatus] = useState('active');
  const [q, setQ] = useState('');
  const [adding, setAdding] = useState(false);
  const [claimFor, setClaimFor] = useState(null);
  const [data, reload] = useLoad(`/warranties?status=${status}&q=${encodeURIComponent(q)}`, ['warranties'], [status, q]);
  return html`<div>
    <div class="toolbar"><${SearchBox} value=${q} onInput=${setQ} placeholder="Warranty no, customer, film…" />
      <${Chips} value=${status} onChange=${setStatus} options=${[['active', 'Valid'], ['expiring', 'Ending in 90 days'], ['expired', 'Expired'], ['', 'All']]} /><span class="spacer" />
      ${can('warranty', 'create') && html`<button class="btn ghost" onClick=${() => setAdding(true)}><${Icon} name="plus" size=${15} /> Add warranty</button>`}</div>
    ${!data ? html`<${Spinner} />` : !data.warranties.length ? html`<div class="card"><${Empty} icon="shield" title="No warranties">They’re created automatically when a customer signs off an installation, one per film with warranty years.<//></div>`
      : html`<div class="card flush"><div class="table-wrap"><table class="table table-cards"><thead><tr><th>Warranty</th><th>Customer</th><th class="hide-m">Film</th><th class="r hide-m">SQM</th><th>Valid until</th><th></th></tr></thead>
        <tbody>${data.warranties.map((w) => { const ok = w.status === 'active' && w.end_date >= todayISO(); return html`<tr>
          <td class="title">${w.number}${w.job_number && html`<span class="sub">${w.job_number}</span>`}</td><td>${w.contact_name}</td><td class="hide-m">${w.description || w.product_name}<span class="sub">${w.years} years${w.location ? ` · ${w.location}` : ''}</span></td>
          <td class="r hide-m">${qty(w.sqm)}</td><td><${Badge} tone=${ok ? 'green' : 'grey'}>${ok ? fmtDate(w.end_date) : w.status === 'void' ? 'Void' : `Ended ${fmtDate(w.end_date)}`}<//></td>
          <td class="nowrap"><a class="btn ghost small" href=${w.url} target="_blank" rel="noopener">Card</a> <a class="btn wa small" href=${waLink(w.contact_phone, `Your Crystal Shield warranty card ${w.number}: ${w.url}`)} target="_blank" rel="noopener"><${WaIcon} size=${13} /></a>
            ${can('warranty', 'create') && html` <button class="btn ghost small" onClick=${() => setClaimFor(w)}>Claim</button>`}</td></tr>`; })}</tbody></table></div></div>`}
    ${adding && html`<${WarrantyForm} onClose=${() => setAdding(false)} onSaved=${reload} />`}
    ${claimFor && html`<${ClaimForm} warranty=${claimFor} onClose=${() => setClaimFor(null)} onSaved=${() => go('warranty?tab=claims')} />`}
  </div>`;
}
function WarrantyForm({ onClose, onSaved }) {
  const [f, setF] = useState({ contact_id: null, product_id: null, start_date: todayISO(), years: 5, sqm: '', location: '', description: '' });
  const [error, setError] = useState('');
  return html`<${Modal} title="Add warranty (e.g. older installations)" onClose=${onClose}><form class="form" onSubmit=${(e) => { e.preventDefault(); api('/warranties', { method: 'POST', body: f }).then(() => { toast('Warranty added'); onSaved(); onClose(); }).catch((err) => setError(err.message)); }}>
    <${Field} label="Customer"><${ContactPicker} value=${f.contact_id} allowNew=${false} onChange=${(v) => setF({ ...f, contact_id: v })} /><//>
    <${Field} label="Film"><${ProductSelect} value=${f.product_id} onChange=${(v, p) => setF({ ...f, product_id: v, years: p?.warranty_years || f.years, description: p ? `${p.brand ? `${p.brand} ` : ''}${p.name}` : f.description })} /><//>
    <div class="form-grid three"><${Field} label="Installed on"><input type="date" value=${f.start_date} onInput=${(e) => setF({ ...f, start_date: e.target.value })} /><//><${Field} label="Years"><input type="number" min="1" value=${f.years} onInput=${(e) => setF({ ...f, years: e.target.value })} /><//><${Field} label="SQM"><input type="number" step="0.01" value=${f.sqm} onInput=${(e) => setF({ ...f, sqm: e.target.value })} /><//></div>
    <${Field} label="Location"><input value=${f.location} onInput=${(e) => setF({ ...f, location: e.target.value })} placeholder="e.g. Ground floor living & dining" /><//>
    <${ErrorText} error=${error} /><div class="form-actions"><button type="button" class="btn ghost" onClick=${onClose}>Cancel</button><button class="btn primary" disabled=${!f.contact_id}>Add</button></div></form><//>`;
}

const CLAIM = { open: { label: 'Open', tone: 'red' }, inspecting: { label: 'Inspecting', tone: 'orange' }, fixed: { label: 'Fixed', tone: 'green' }, rejected: { label: 'Not covered', tone: 'grey' } };
function Claims() {
  const [data, reload] = useLoad('/claims', ['claims']);
  const [adding, setAdding] = useState(false);
  const [visit, setVisit] = useState(null);
  if (!data) return html`<${Spinner} />`;
  const patch = (c, body) => api(`/claims/${c.id}`, { method: 'PATCH', body }).then(reload).catch(errToast);
  return html`<div>
    <div class="toolbar"><span class="muted small">Customer reports a problem (peeling, bubbles, scratches) → inspect → fix or close.</span><span class="spacer" />${can('warranty', 'create') && html`<button class="btn primary" onClick=${() => setAdding(true)}><${Icon} name="plus" size=${15} /> New claim</button>`}</div>
    ${!data.claims.length ? html`<div class="card"><${Empty} icon="shield" title="No warranty claims" /></div>` : html`<div class="stack">${data.claims.map((c) => html`<div class="card">
      <div class="card-head"><div><h3>${c.number} · ${c.contact_name}</h3><p class="muted small" style=${{ margin: '2px 0 0' }}>${fmtDate(c.date)}${c.warranty_number ? ` · ${c.warranty_number} (${c.product_name || ''}, until ${fmtDate(c.warranty_end)})` : ' · no warranty linked'}</p></div><${Badge} tone=${CLAIM[c.status].tone}>${CLAIM[c.status].label}<//></div>
      <p style=${{ margin: '0 0 10px', whiteSpace: 'pre-wrap' }}>${c.issue}</p>
      ${c.resolution && html`<p class="small" style=${{ margin: '0 0 10px' }}><b>Resolution:</b> ${c.resolution}</p>`}
      ${can('warranty', 'edit') && html`<div class="row">
        <span style=${{ width: '200px' }}><${UserSelect} value=${c.assigned_to} onChange=${(v) => patch(c, { assigned_to: v })} placeholder="Assign to…" /></span>
        ${c.job_id ? html`<a class="btn ghost small" href=${`#/jobs/${c.job_id}`}>Visit ${c.job_number}</a>` : can('jobs', 'create') && html`<button class="btn ghost small" onClick=${() => setVisit(c)}>Schedule inspection visit</button>`}
        ${['open', 'inspecting'].includes(c.status) && html`<button class="btn success small" onClick=${() => { const r = prompt('How was it fixed?'); if (r !== null) patch(c, { status: 'fixed', resolution: r }); }}>Fixed</button>
          <button class="btn ghost small" onClick=${() => { const r = prompt('Why is it not covered?'); if (r !== null) patch(c, { status: 'rejected', resolution: r }); }}>Not covered</button>`}
        ${c.contact_phone && html`<a class="btn wa small" href=${waLink(c.contact_phone, `Hello, Crystal Shield here about your warranty claim ${c.number}. `)} target="_blank" rel="noopener"><${WaIcon} size=${13} /></a>`}
      </div>`}</div>`)}</div>`}
    ${adding && html`<${ClaimForm} onClose=${() => setAdding(false)} onSaved=${reload} />`}
    ${visit && html`<${VisitModal} claim=${visit} onClose=${() => setVisit(null)} onSaved=${reload} />`}
  </div>`;
}
function ClaimForm({ warranty, onClose, onSaved }) {
  const [f, setF] = useState({ warranty_id: warranty?.id || null, contact_id: warranty?.contact_id || null, issue: '', assigned_to: null });
  const [error, setError] = useState('');
  return html`<${Modal} title=${warranty ? `Claim on ${warranty.number}` : 'New warranty claim'} onClose=${onClose}><form class="form" onSubmit=${(e) => { e.preventDefault(); api('/claims', { method: 'POST', body: f }).then(() => { toast('Claim logged'); onSaved(); onClose(); }).catch((err) => setError(err.message)); }}>
    ${!warranty && html`<${Field} label="Customer"><${ContactPicker} value=${f.contact_id} allowNew=${false} onChange=${(v) => setF({ ...f, contact_id: v })} /><//>`}
    <${Field} label="Problem reported"><textarea required rows="4" value=${f.issue} onInput=${(e) => setF({ ...f, issue: e.target.value })} placeholder="What, where, since when — ask for photos on WhatsApp" /><//>
    <${Field} label="Handled by"><${UserSelect} value=${f.assigned_to} onChange=${(v) => setF({ ...f, assigned_to: v })} /><//>
    <${ErrorText} error=${error} /><div class="form-actions"><button type="button" class="btn ghost" onClick=${onClose}>Cancel</button><button class="btn primary">Log claim</button></div></form><//>`;
}
function VisitModal({ claim, onClose, onSaved }) {
  const [f, setF] = useState({ date: addDays(todayISO(), 1), start_time: '10:00', installer_ids: [] });
  const [error, setError] = useState('');
  return html`<${Modal} title=${`Inspection visit — ${claim.contact_name}`} onClose=${onClose}><div class="form">
    <div class="form-grid two"><${Field} label="Date"><input type="date" value=${f.date} onInput=${(e) => setF({ ...f, date: e.target.value })} /><//><${Field} label="Time"><input type="time" value=${f.start_time} onInput=${(e) => setF({ ...f, start_time: e.target.value })} /><//></div>
    <${Field} label="Installer"><${UserSelect} value=${f.installer_ids[0]} onChange=${(v) => setF({ ...f, installer_ids: v ? [v] : [], lead_installer_id: v })} /><//>
    <${ErrorText} error=${error} /><div class="form-actions"><button class="btn ghost" onClick=${onClose}>Cancel</button><button class="btn primary" onClick=${() => api(`/claims/${claim.id}/job`, { method: 'POST', body: f }).then((r) => { toast('Visit scheduled'); onSaved(); go(`jobs/${r.job_id}`); }).catch((e) => setError(e.message))}>Schedule</button></div></div><//>`;
}
