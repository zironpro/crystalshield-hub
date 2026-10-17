import { useState, useEffect } from 'preact/hooks';
import { html, api, useLoad, useEvent, useStore, can, toast, errToast, getPosition, fmtTime, fmtDay, fmtDate, todayISO, hashParam, setHashParam } from '../lib.js';
import { Icon, Avatar, Badge, Modal, Field, ErrorText, Spinner, Empty, PageHead, Tabs, UserSelect, useAction } from '../ui.js';

// Clock in / out — used by the sidebar, the phone top bar and the installer home
export function useClock() {
  const [att, setAtt] = useState(null);
  const load = () => api('/attendance/me').then(setAtt).catch(() => {});
  useEffect(() => { load(); const t = setInterval(load, 5 * 60e3); return () => clearInterval(t); }, []);
  useEvent('attendance', load);
  async function toggle() {
    const working = att?.today?.working;
    const pos = await getPosition();
    try {
      await api(`/attendance/${working ? 'clock-out' : 'clock-in'}`, { method: 'POST', body: pos || {} });
      toast(working ? '👋 Clocked out' : `✅ Clocked in at ${new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`);
      load();
    } catch (e) { errToast(e); }
  }
  return { att, toggle };
}

const ST = { present: ['Present', 'green'], late: ['Late', 'orange'], absent: ['Absent', 'red'], leave: ['Leave', 'violet'], half_leave: ['Half day leave', 'violet'], off: ['Day off', 'grey'], not_in: ['Not in yet', 'grey'] };
const LT = { annual: 'Annual leave', sick: 'Sick leave', casual: 'Casual leave', unpaid: 'Unpaid leave', missed_punch: 'Missed punch', other: 'Other / work outside office' };
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function Attendance() {
  const [tab, setTabS] = useState(hashParam('tab') || 'me');
  const setTab = (t) => { setTabS(t); setHashParam('tab', t === 'me' ? null : t); };
  const manage = can('attendance');
  return html`<div class="page">
    <${PageHead} eyebrow="Team" title="Attendance & leave" sub="Clock in from the office or on site (installers’ location is recorded), apply for leave, fix a missed punch." />
    <${Tabs} value=${tab} onChange=${setTab} tabs=${[['me', 'My attendance'], ['requests', 'Leave & requests'], manage && ['today', 'Team today'], manage && ['register', 'Monthly register'], can('attendance', 'edit') && ['approvals', 'Approvals'], (can('attendance', 'edit') || can('settings', 'edit')) && ['setup', 'Shifts & offices']]} />
    ${tab === 'me' && html`<${MyMonth} />`}
    ${tab === 'requests' && html`<${Requests} />`}
    ${tab === 'today' && html`<${Today} />`}
    ${tab === 'register' && html`<${Register} />`}
    ${tab === 'approvals' && html`<${Approvals} />`}
    ${tab === 'setup' && html`<${Setup} />`}
  </div>`;
}

function MyMonth({ userId }) {
  const s = useStore();
  const [month, setMonth] = useState(todayISO().slice(0, 7));
  const [d] = useLoad(`/attendance/month?month=${month}${userId ? `&user=${userId}` : ''}`, ['attendance', 'leaves'], [month, userId]);
  const { att, toggle } = useClock();
  return html`<div class="stack">
    ${!userId && att && html`<div class="card row"><span style=${{ fontSize: '26px' }}>⏱</span><span style=${{ flex: 1 }}><b>${att.today.working ? `Clocked in since ${fmtTime(att.today.first_in)}` : att.today.first_in ? `Clocked out · ${Math.round(att.today.minutes / 6) / 10} h today` : 'Not clocked in today'}</b>
      <div class="muted small">${att.shift ? `${att.shift.name}: ${att.shift.start}–${att.shift.end}` : 'No shift set'}${att.office ? ` · ${att.office.name}` : ''}</div></span><button class="btn ${att.today.working ? 'ghost' : 'amber'}" onClick=${toggle}>${att.today.working ? 'Clock out' : 'Clock in'}</button></div>`}
    <div class="toolbar"><input type="month" value=${month} onInput=${(e) => setMonth(e.target.value)} style=${{ width: 'auto' }} />${d && html`<span class="muted small">${d.user.name}</span>`}</div>
    ${!d ? html`<${Spinner} />` : html`<div class="kpis"><div class="kpi"><span>Present</span><b>${d.totals.present}</b></div><div class="kpi ${d.totals.late ? 'warn' : ''}"><span>Late</span><b>${d.totals.late}</b></div><div class="kpi ${d.totals.absent ? 'bad' : ''}"><span>Absent</span><b>${d.totals.absent}</b></div><div class="kpi"><span>Leave</span><b>${d.totals.leave}</b></div><div class="kpi"><span>Hours</span><b>${d.totals.hours}</b></div></div>
      <div class="card flush"><div class="table-wrap"><table class="table compact"><thead><tr><th>Day</th><th>Status</th><th>In</th><th>Out</th><th class="r">Hours</th><th class="hide-m">Where</th></tr></thead>
        <tbody>${[...d.days].reverse().map((x) => html`<tr><td class="nowrap">${fmtDay(x.date)}</td><td><${Badge} tone=${ST[x.status][1]}>${ST[x.status][0]}${x.late_minutes ? ` ${x.late_minutes}m` : ''}<//></td><td>${x.in_time || '—'}</td><td>${x.out_time || (x.working ? 'working' : '—')}</td><td class="r">${x.minutes ? Math.round(x.minutes / 6) / 10 : ''}</td><td class="hide-m small muted">${x.place}${x.sessions.some((y) => y.in_lat) ? html` <a class="link" target="_blank" rel="noopener" href=${`https://maps.google.com/?q=${x.sessions.find((y) => y.in_lat).in_lat},${x.sessions.find((y) => y.in_lat).in_lng}`}>map</a>` : ''}</td></tr>`)}</tbody></table></div></div>`}
  </div>`;
}

function Requests() {
  const [data, reload] = useLoad('/leaves', ['leaves']);
  const [adding, setAdding] = useState(false);
  return html`<div class="stack"><div class="row"><span class="muted small">Leave, sick days, missed punches. Your manager is notified and approves in the hub.</span><span class="spacer" /><button class="btn primary" onClick=${() => setAdding(true)}><${Icon} name="plus" size=${15} /> New request</button></div>
    ${!data ? html`<${Spinner} />` : !data.leaves.length ? html`<div class="card"><${Empty} icon="calendar" title="No requests yet" /></div>` : html`<div class="card"><div class="list-rows">${data.leaves.map((l) => html`<div class="list-row"><span class="ico-sq">${l.type === 'missed_punch' ? '⏰' : l.type === 'sick' ? '🤒' : '🌴'}</span>
      <span class="grow"><b>${LT[l.type]} · ${fmtDate(l.from_date)}${l.to_date !== l.from_date ? ` → ${fmtDate(l.to_date)}` : ''}${l.half_day ? ' (half day)' : ''}</b><small>${l.reason}${l.data?.in ? ` · in ${l.data.in}` : ''}${l.data?.out ? ` · out ${l.data.out}` : ''}${l.review_note ? ` · “${l.review_note}”` : ''}</small></span>
      <${Badge} tone=${{ pending: 'orange', approved: 'green', rejected: 'red', cancelled: 'grey' }[l.status]}>${l.status}<//>${l.status === 'pending' && html`<button class="btn ghost small" onClick=${() => api(`/leaves/${l.id}/cancel`, { method: 'POST' }).then(reload).catch(errToast)}>Cancel</button>`}</div>`)}</div></div>`}
    ${adding && html`<${LeaveForm} onClose=${() => setAdding(false)} onSaved=${reload} />`}</div>`;
}
function LeaveForm({ onClose, onSaved }) {
  const [f, setF] = useState({ type: 'annual', from_date: todayISO(), to_date: todayISO(), half_day: false, reason: '', in: '', out: '' });
  const [error, setError] = useState('');
  return html`<${Modal} title="New request" onClose=${onClose}><form class="form" onSubmit=${(e) => { e.preventDefault(); api('/leaves', { method: 'POST', body: f }).then(() => { toast('Request sent'); onSaved(); onClose(); }).catch((err) => setError(err.message)); }}>
    <${Field} label="Type"><select value=${f.type} onChange=${(e) => setF({ ...f, type: e.target.value })}>${Object.entries(LT).map(([k, v]) => html`<option value=${k}>${v}</option>`)}</select><//>
    <div class="form-grid two"><${Field} label=${f.type === 'missed_punch' ? 'Date' : 'From'}><input type="date" value=${f.from_date} onInput=${(e) => setF({ ...f, from_date: e.target.value })} /><//>
      ${f.type === 'missed_punch' ? html`<${Field} label="Came in at"><input type="time" value=${f.in} onInput=${(e) => setF({ ...f, in: e.target.value })} /><//><${Field} label="Left at"><input type="time" value=${f.out} onInput=${(e) => setF({ ...f, out: e.target.value })} /><//>`
        : html`<${Field} label="To"><input type="date" value=${f.to_date} onInput=${(e) => setF({ ...f, to_date: e.target.value })} /><//>`}</div>
    ${f.type !== 'missed_punch' && html`<label class="check"><input type="checkbox" checked=${f.half_day} onChange=${(e) => setF({ ...f, half_day: e.target.checked })} /> Half day</label>`}
    <${Field} label="Reason"><textarea rows="2" value=${f.reason} onInput=${(e) => setF({ ...f, reason: e.target.value })} /><//>
    <${ErrorText} error=${error} /><div class="form-actions"><button type="button" class="btn ghost" onClick=${onClose}>Cancel</button><button class="btn primary">Send</button></div></form><//>`;
}

function Today() {
  const [date, setDate] = useState(todayISO());
  const [person, setPerson] = useState(null);
  const [d] = useLoad(`/attendance/today?date=${date}`, ['attendance', 'leaves'], [date]);
  if (person) return html`<div><button class="back-link link-btn" onClick=${() => setPerson(null)}><${Icon} name="back" size=${15} /> Team today</button><${MyMonth} userId=${person} /></div>`;
  return html`<div class="stack"><div class="toolbar"><input type="date" value=${date} onInput=${(e) => setDate(e.target.value)} style=${{ width: 'auto' }} />
    ${d && html`<span class="muted small">${d.people.filter((p) => ['present', 'late'].includes(p.status)).length} in · ${d.people.filter((p) => p.status === 'late').length} late · ${d.people.filter((p) => ['absent', 'not_in'].includes(p.status)).length} not in · ${d.people.filter((p) => ['leave', 'half_leave'].includes(p.status)).length} on leave</span>`}</div>
    ${!d ? html`<${Spinner} />` : html`<div class="card flush"><div class="table-wrap"><table class="table table-cards"><thead><tr><th>Person</th><th>Status</th><th>In</th><th>Out</th><th class="hide-m">Where</th><th class="hide-m">Shift</th></tr></thead>
      <tbody>${d.people.map((p) => html`<tr class="click" onClick=${() => setPerson(p.user_id)}><td class="title"><span class="person"><${Avatar} id=${p.user_id} size=${26} showOnline=${true} />${p.name}</span></td>
        <td><${Badge} tone=${p.working ? 'green' : ST[p.status][1]}>${p.working ? 'Working' : ST[p.status][0]}${p.late_minutes ? ` (${p.late_minutes}m late)` : ''}<//></td><td>${p.in_time || '—'}</td><td>${p.out_time || '—'}</td>
        <td class="hide-m small">${p.place || '—'}${p.sessions?.find((x) => x.in_lat) && html` · <a class="link" target="_blank" rel="noopener" onClick=${(e) => e.stopPropagation()} href=${`https://maps.google.com/?q=${p.sessions.find((x) => x.in_lat).in_lat},${p.sessions.find((x) => x.in_lat).in_lng}`}>map</a>`}</td><td class="hide-m small muted">${p.shift}</td></tr>`)}</tbody></table></div></div>`}</div>`;
}

function Register() {
  const [month, setMonth] = useState(todayISO().slice(0, 7));
  return html`<div class="card"><div class="row"><input type="month" value=${month} onInput=${(e) => setMonth(e.target.value)} style=${{ width: 'auto' }} />
    <a class="btn primary" href=${`/api/attendance/export?month=${month}`}><${Icon} name="download" size=${15} /> Download Excel (CSV)</a><span class="muted small">One row per person: P present · L late · A absent · LV leave · HL half-day leave.</span></div></div>`;
}

function Approvals() {
  const [data, reload] = useLoad('/leaves?all=1', ['leaves']);
  const [busy, run] = useAction();
  if (!data) return html`<${Spinner} />`;
  const pending = data.leaves.filter((l) => l.status === 'pending');
  const answer = (l, approve) => { const note = approve ? '' : prompt('Reason (optional)') || ''; run(() => api(`/leaves/${l.id}/review`, { method: 'POST', body: { approve, note } }).then(reload), approve ? 'Approved' : 'Rejected'); };
  return html`<div class="stack">${!pending.length ? html`<div class="card"><${Empty} icon="check" title="Nothing waiting" /></div>` : html`<div class="card"><div class="list-rows">${pending.map((l) => html`<div class="list-row"><${Avatar} id=${l.user_id} size=${30} />
    <span class="grow"><b>${l.user_name} — ${LT[l.type]}</b><small>${fmtDate(l.from_date)}${l.to_date !== l.from_date ? ` → ${fmtDate(l.to_date)}` : ''}${l.half_day ? ' (half)' : ''}${l.data?.in ? ` · in ${l.data.in}` : ''}${l.data?.out ? ` · out ${l.data.out}` : ''} · ${l.reason}</small></span>
    <button class="btn success small" disabled=${busy} onClick=${() => answer(l, true)}>Approve</button><button class="btn ghost small" disabled=${busy} onClick=${() => answer(l, false)}>Reject</button></div>`)}</div></div>`}
    <div class="card"><h3 style=${{ marginBottom: '8px' }}>Recent</h3><div class="list-rows">${data.leaves.filter((l) => l.status !== 'pending').slice(0, 20).map((l) => html`<div class="list-row"><span class="grow"><b>${l.user_name} — ${LT[l.type]}</b><small>${fmtDate(l.from_date)} · ${l.reviewer_name || ''}</small></span><${Badge} tone=${l.status === 'approved' ? 'green' : 'grey'}>${l.status}<//></div>`)}</div></div></div>`;
}

function Setup() {
  const s = useStore();
  const [d, reload] = useLoad('/offices', []);
  const [shift, setShift] = useState(null);
  const [office, setOffice] = useState(null);
  if (!d) return html`<${Spinner} />`;
  const assign = (u, body) => api(`/users/${u.id}`, { method: 'PATCH', body }).catch(errToast);
  return html`<div class="stack">
    <div class="card"><div class="card-head"><h2>Shifts</h2>${can('attendance', 'edit') && html`<button class="btn ghost small" onClick=${() => setShift({ name: '', start: '09:00', end: '18:00', days: '1,2,3,4,5,6', grace: 15 })}><${Icon} name="plus" size=${14} /> Shift</button>`}</div>
      <div class="list-rows">${d.shifts.map((x) => html`<button class="list-row" onClick=${() => setShift(x)}><span class="dot" style=${{ background: x.color }} /><span class="grow"><b>${x.name}</b><small>${x.start}–${x.end} · ${String(x.days).split(',').map((n) => DAYS[n]).join(' ')} · ${x.grace} min grace</small></span></button>`)}</div></div>
    <div class="card"><div class="card-head"><h2>Offices & sites</h2>${can('settings', 'edit') && html`<button class="btn ghost small" onClick=${() => setOffice({ name: '', address: '', radius_m: 200, allowed_ips: '', field: false })}><${Icon} name="plus" size=${14} /> Office</button>`}</div>
      <div class="list-rows">${d.offices.map((o) => html`<button class="list-row" onClick=${() => can('settings', 'edit') && setOffice(o)}><span class="ico-sq">${o.field ? '🚐' : '🏢'}</span><span class="grow"><b>${o.name}</b><small>${o.field ? 'Field staff — clock in anywhere, location recorded' : o.lat ? `Clock in within ${o.radius_m} m of the office${o.allowed_ips ? ' or on the office Wi-Fi' : ''}` : o.allowed_ips ? 'Clock in on the office Wi-Fi only' : 'Clock in from anywhere'}</small></span></button>`)}</div></div>
    ${can('team', 'edit') && html`<div class="card flush"><div class="card-head" style=${{ padding: '16px 18px 0' }}><h2>Who works where</h2></div><div class="table-wrap"><table class="table compact"><thead><tr><th>Person</th><th>Office</th><th>Shift</th></tr></thead>
      <tbody>${s.users.filter((u) => u.active).map((u) => html`<tr><td><span class="person"><${Avatar} user=${u} size=${24} />${u.name}</span></td>
        <td><select value=${u.office_id || ''} onChange=${(e) => assign(u, { office_id: e.target.value })}><option value="">—</option>${d.offices.map((o) => html`<option value=${o.id}>${o.name}</option>`)}</select></td>
        <td><select value=${u.shift_id || ''} onChange=${(e) => assign(u, { shift_id: e.target.value })}><option value="">Default</option>${d.shifts.map((x) => html`<option value=${x.id}>${x.name}</option>`)}</select></td></tr>`)}</tbody></table></div></div>`}
    ${shift && html`<${ShiftForm} shift=${shift} onClose=${() => setShift(null)} onSaved=${reload} />`}
    ${office && html`<${OfficeForm} office=${office} myIp=${d.my_ip} onClose=${() => setOffice(null)} onSaved=${reload} />`}
  </div>`;
}
function ShiftForm({ shift, onClose, onSaved }) {
  const [f, setF] = useState({ ...shift, days: String(shift.days).split(',').map(Number) });
  const [error, setError] = useState('');
  const save = () => (shift.id ? api(`/shifts/${shift.id}`, { method: 'PATCH', body: f }) : api('/shifts', { method: 'POST', body: f })).then(() => { onSaved(); onClose(); }).catch((e) => setError(e.message));
  return html`<${Modal} title=${shift.id ? 'Edit shift' : 'New shift'} onClose=${onClose}><div class="form">
    <${Field} label="Name"><input value=${f.name} onInput=${(e) => setF({ ...f, name: e.target.value })} /><//>
    <div class="form-grid three"><${Field} label="Start"><input type="time" value=${f.start} onInput=${(e) => setF({ ...f, start: e.target.value })} /><//><${Field} label="End"><input type="time" value=${f.end} onInput=${(e) => setF({ ...f, end: e.target.value })} /><//><${Field} label="Grace (min)"><input type="number" value=${f.grace} onInput=${(e) => setF({ ...f, grace: e.target.value })} /><//></div>
    <${Field} label="Working days"><div class="chips">${DAYS.map((d, i) => html`<button type="button" class="chip ${f.days.includes(i) ? 'on' : ''}" onClick=${() => setF({ ...f, days: f.days.includes(i) ? f.days.filter((x) => x !== i) : [...f.days, i].sort() })}>${d}</button>`)}</div><//>
    <${ErrorText} error=${error} /><div class="form-actions">${shift.id && html`<button class="btn danger-ghost" onClick=${() => confirm('Delete shift?') && api(`/shifts/${shift.id}`, { method: 'DELETE' }).then(() => { onSaved(); onClose(); })}>Delete</button>`}<span class="spacer" /><button class="btn ghost" onClick=${onClose}>Cancel</button><button class="btn primary" onClick=${save}>Save</button></div></div><//>`;
}
function OfficeForm({ office, myIp, onClose, onSaved }) {
  const [f, setF] = useState({ ...office, field: !!office.field });
  const [error, setError] = useState('');
  const save = () => (office.id ? api(`/offices/${office.id}`, { method: 'PATCH', body: f }) : api('/offices', { method: 'POST', body: f })).then(() => { onSaved(); onClose(); }).catch((e) => setError(e.message));
  return html`<${Modal} title=${office.id ? 'Edit office' : 'New office'} onClose=${onClose}><div class="form">
    <${Field} label="Name"><input value=${f.name} onInput=${(e) => setF({ ...f, name: e.target.value })} /><//><${Field} label="Address"><input value=${f.address} onInput=${(e) => setF({ ...f, address: e.target.value })} /><//>
    <label class="check"><input type="checkbox" checked=${f.field} onChange=${(e) => setF({ ...f, field: e.target.checked })} /> Field staff (installers): clock in from anywhere, location recorded</label>
    ${!f.field && html`<div class="callout info"><span>📍</span><span class="grow">Lock clock-in to the office: stand in the office and press <b>Use my location</b>, and/or add the office internet address.</span></div>
      <div class="form-grid three"><${Field} label="Latitude"><input value=${f.lat ?? ''} onInput=${(e) => setF({ ...f, lat: e.target.value })} /><//><${Field} label="Longitude"><input value=${f.lng ?? ''} onInput=${(e) => setF({ ...f, lng: e.target.value })} /><//><${Field} label="Radius (m)"><input type="number" value=${f.radius_m} onInput=${(e) => setF({ ...f, radius_m: e.target.value })} /><//></div>
      <div class="row"><button class="btn ghost small" onClick=${async () => { const p = await getPosition(); if (p) setF({ ...f, lat: p.lat.toFixed(6), lng: p.lng.toFixed(6) }); else errToast('Allow location access first'); }}>📍 Use my location</button>
        <button class="btn ghost small" onClick=${() => setF({ ...f, allowed_ips: [...new Set([...String(f.allowed_ips || '').split(',').map((x) => x.trim()).filter(Boolean), myIp])].join(', ') })}>🌐 Add this network (${myIp})</button></div>
      <${Field} label="Office internet addresses"><input value=${f.allowed_ips || ''} onInput=${(e) => setF({ ...f, allowed_ips: e.target.value })} /><//>`}
    <${ErrorText} error=${error} /><div class="form-actions">${office.id && html`<button class="btn danger-ghost" onClick=${() => confirm('Delete office?') && api(`/offices/${office.id}`, { method: 'DELETE' }).then(() => { onSaved(); onClose(); })}>Delete</button>`}<span class="spacer" /><button class="btn ghost" onClick=${onClose}>Cancel</button><button class="btn primary" onClick=${save}>Save</button></div></div><//>`;
}
