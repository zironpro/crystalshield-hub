// Pieces used on several screens: schedule a call / visit / task, list of activities, simple charts.
import { useState } from 'preact/hooks';
import { html, api, store, toast, errToast, todayISO, ACTIVITY, fmtDay, t12, can, qty, kaed, aed } from '../lib.js';
import { Modal, Field, ErrorText, UserSelect, Icon, Avatar, Due, Badge } from '../ui.js';

export function ActivityModal({ onClose, onSaved, initial = {}, link = {} }) {
  const me = store.get().me;
  const [f, setF] = useState({ type: 'call', title: '', date: todayISO(), start_time: '', end_time: '', assigned_to: me.id, notes: '', ...initial });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target ? e.target.value : e });
  async function save(e) {
    e.preventDefault(); setBusy(true); setError('');
    try {
      if (initial.id) await api(`/activities/${initial.id}`, { method: 'PATCH', body: f });
      else await api('/activities', { method: 'POST', body: { ...f, ...link } });
      toast(initial.id ? 'Updated' : `${ACTIVITY[f.type].label} scheduled`);
      onSaved?.(); onClose();
    } catch (err) { setError(err.message); }
    setBusy(false);
  }
  return html`<${Modal} title=${initial.id ? 'Edit activity' : 'Schedule'} onClose=${onClose}>
    <form class="form" onSubmit=${save}>
      <div class="chips">${Object.entries(ACTIVITY).filter(([k]) => k !== 'payment_follow_up' || can('invoices')).map(([k, a]) => html`<button type="button" class="chip ${f.type === k ? 'on' : ''}" onClick=${() => setF({ ...f, type: k })}>${a.icon} ${a.label}</button>`)}</div>
      <${Field} label="Title" hint="Leave empty to name it automatically"><input value=${f.title} onInput=${set('title')} placeholder=${`${ACTIVITY[f.type].label}…`} /><//>
      <div class="form-grid three">
        <${Field} label="Date"><input type="date" required value=${f.date} onInput=${set('date')} /><//>
        <${Field} label="From"><input type="time" value=${f.start_time || ''} onInput=${set('start_time')} /><//>
        <${Field} label="To"><input type="time" value=${f.end_time || ''} onInput=${set('end_time')} /><//>
      </div>
      <${Field} label="Who"><${UserSelect} value=${f.assigned_to} onChange=${(v) => setF({ ...f, assigned_to: v })} /><//>
      <${Field} label="Notes"><textarea rows="3" value=${f.notes} onInput=${set('notes')} placeholder="What to discuss, address, access…" /><//>
      <${ErrorText} error=${error} />
      <div class="form-actions"><button type="button" class="btn ghost" onClick=${onClose}>Cancel</button><button class="btn primary" disabled=${busy}>Save</button></div>
    </form>
  <//>`;
}

export function ActivityList({ items, onChanged, empty = 'Nothing scheduled.' }) {
  const [editing, setEditing] = useState(null);
  const [doneFor, setDoneFor] = useState(null);
  const [outcome, setOutcome] = useState('');
  async function done(a) {
    try { await api(`/activities/${a.id}`, { method: 'PATCH', body: { status: 'done', outcome } }); setDoneFor(null); setOutcome(''); onChanged?.(); } catch (e) { errToast(e); }
  }
  if (!items?.length) return html`<p class="muted small">${empty}</p>`;
  return html`<div class="list-rows">${items.map((a) => html`<div class="list-row" style=${{ alignItems: 'flex-start', opacity: a.status === 'cancelled' ? 0.5 : 1 }}>
    <span class="ico-sq">${ACTIVITY[a.type]?.icon || '•'}</span>
    <span class="grow"><b style=${{ textDecoration: a.status === 'done' ? 'line-through' : 'none' }}>${a.title}</b>
      <small>${fmtDay(a.date)}${a.start_time ? ` · ${t12(a.start_time)}` : ''}${a.assigned_name ? ` · ${a.assigned_name}` : ''}${a.outcome ? ` — ${a.outcome}` : ''}</small>
      ${doneFor === a.id && html`<div class="inline-input" style=${{ marginTop: '6px' }}><input autoFocus placeholder="Outcome (optional): e.g. customer asked for samples" value=${outcome} onInput=${(e) => setOutcome(e.target.value)} onKeyDown=${(e) => e.key === 'Enter' && done(a)} /><button class="btn success small" onClick=${() => done(a)}>Done</button></div>`}
    </span>
    ${a.status === 'planned' ? html`<${Due} date=${a.date} />
      <button class="btn ghost small" onClick=${() => setDoneFor(doneFor === a.id ? null : a.id)}><${Icon} name="check" size=${14} /> Done</button>
      <button class="icon-btn small" onClick=${() => setEditing(a)} aria-label="Edit"><${Icon} name="edit" size=${15} /></button>` : html`<${Badge} tone=${a.status === 'done' ? 'green' : 'grey'}>${a.status}<//>`}
  </div>`)}
  ${editing && html`<${ActivityModal} initial=${editing} onClose=${() => setEditing(null)} onSaved=${onChanged} />`}
  </div>`;
}

// Horizontal bars (leads by source, sales by person…)
export function HBars({ rows, value = (r) => r.value, label = (r) => r.label, fmt = (v) => v, color }) {
  const max = Math.max(1, ...rows.map(value));
  return html`<div>${rows.map((r) => html`<div class="hbar"><span title=${label(r)} style=${{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>${label(r)}</span>
    <span class="track"><span style=${{ width: `${(value(r) / max) * 100}%`, background: color || undefined }} /></span><span class="v">${fmt(value(r), r)}</span></div>`)}</div>`;
}
// Vertical bars, one or two series: rows [{label, a, b}]
export function VBars({ rows, series = [['a', 'navy']], fmt = kaed, height = 180 }) {
  const max = Math.max(1, ...rows.flatMap((r) => series.map(([k]) => Number(r[k]) || 0)));
  return html`<div><div class="vchart" style=${{ height: height + 'px' }}>${rows.map((r) => html`<div class="col"><div class="bars">${series.map(([k, c]) => html`<div class="bar ${c === 'sky' ? 'alt' : c === 'amber' ? 'amber' : ''}" data-v=${fmt(r[k])} style=${{ height: `${((Number(r[k]) || 0) / max) * 100}%` }} />`)}</div></div>`)}</div>
    <div class="vchart-labels">${rows.map((r) => html`<span>${r.label}</span>`)}</div></div>`;
}
export function Funnel({ f }) {
  if (!f) return null;
  const steps = [['Leads', f.leads, null, null], ['Deals', f.deals, f.deals_value, f.lead_to_deal], ['Quotations', f.quotes, f.quotes_value, f.deal_to_quote], ['Won', f.won, f.won_value, f.quote_to_won]];
  const max = Math.max(1, f.leads);
  return html`<div class="funnel">${steps.map(([lbl, n, v, conv], i) => html`<div class="funnel-step">
    <span class="lbl">${lbl}${conv !== null && html`<em title=${`${conv}% of the step before`}>${conv}%</em>`}</span><b>${n}</b><span class="val">${v !== null ? kaed(v) : 'this period'}</span>
    <div class="funnel-bar"><span style=${{ width: `${Math.max(3, (n / max) * 100)}%` }} /></div>
  </div>`)}</div>`;
}
export const Trend = ({ now, before }) => {
  if (!before) return null;
  const g = Math.round(((now - before) / Math.abs(before)) * 1000) / 10;
  return html`<span class="trend ${g >= 0 ? 'up' : 'down'}">${g >= 0 ? '▲' : '▼'} ${Math.abs(g)}% vs last month</span>`;
};
export { aed, qty };
