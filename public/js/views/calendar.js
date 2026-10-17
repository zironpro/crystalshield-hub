import { useState, useMemo } from 'preact/hooks';
import { html, useLoad, store, can, go, todayISO, addDays, fmtDay, t12, isInstaller, ACTIVITY, FOLLOWUP } from '../lib.js';
import { Icon, Spinner, PageHead, Chips } from '../ui.js';
import { ActivityModal } from './shared.js';

const monthStart = (d) => `${d.slice(0, 7)}-01`;
function shiftMonth(d, n) { const x = new Date(monthStart(d) + 'T00:00:00Z'); x.setUTCMonth(x.getUTCMonth() + n); return x.toISOString().slice(0, 10); }
const KINDS = [['', 'Everything'], ['activity', 'Calls & meetings'], ['job', 'Installations'], ['followup', 'Follow-ups']];

export function Calendar() {
  const [month, setMonth] = useState(monthStart(todayISO()));
  const [mine, setMine] = useState(isInstaller());
  const [kind, setKind] = useState('');
  const [adding, setAdding] = useState(null);
  const [editing, setEditing] = useState(null);
  const [mobileList, setMobileList] = useState(window.innerWidth < 760);
  // grid: Sunday before the 1st → 6 weeks
  const first = new Date(month + 'T00:00:00Z');
  const gridStart = addDays(month, -first.getUTCDay());
  const gridEnd = addDays(gridStart, 41);
  const [data, reload] = useLoad(`/calendar?from=${gridStart}&to=${gridEnd}${mine ? '&mine=1' : ''}`, ['activities', 'jobs', 'followups'], [month, mine]);
  const events = (data?.events || []).filter((e) => !kind || e.kind === kind);
  const byDay = useMemo(() => {
    const m = {};
    for (const e of events) {
      const end = e.end_date && e.end_date > e.date ? e.end_date : e.date;
      for (let d = e.date; d <= end && d <= gridEnd; d = addDays(d, 1)) (m[d] ||= []).push(e);
    }
    for (const k of Object.keys(m)) m[k].sort((a, b) => String(a.start || '99').localeCompare(String(b.start || '99')));
    return m;
  }, [data, kind]);
  const today = todayISO();
  const label = new Date(month + 'T00:00:00Z').toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const open = (e) => {
    if (e.kind === 'activity' && !e.link) return setEditing(e);
    if (e.link) go(e.link);
  };
  const evLabel = (e) => `${e.start ? `${t12(e.start).replace(':00', '')} ` : ''}${e.kind === 'activity' ? `${ACTIVITY[e.type]?.icon || ''} ` : e.kind === 'followup' ? `${FOLLOWUP[e.type]?.icon || ''} ` : '🛠 '}${e.title}`;
  const canAdd = can('crm', 'create') || can('jobs', 'create');
  return html`<div class="page wide">
    <${PageHead} eyebrow="Sales & operations" title="Calendar" sub="Calls, meetings, site visits, installations and follow-ups on one shared calendar.">
      ${canAdd && html`<button class="btn primary" onClick=${() => setAdding(today)}><${Icon} name="plus" size=${16} /> Schedule</button>`}
    <//>
    <div class="cal-head">
      <button class="icon-btn" onClick=${() => setMonth(shiftMonth(month, -1))} aria-label="Previous month">‹</button><h2>${label}</h2><button class="icon-btn" onClick=${() => setMonth(shiftMonth(month, 1))} aria-label="Next month">›</button>
      <button class="btn ghost small" onClick=${() => setMonth(monthStart(today))}>Today</button>
      <${Chips} value=${kind} onChange=${setKind} options=${KINDS} />
      <span class="spacer" />
      <label class="check small"><input type="checkbox" checked=${mine} onChange=${(e) => setMine(e.target.checked)} /> Only mine</label>
      <span class="seg"><button class=${!mobileList ? 'on' : ''} onClick=${() => setMobileList(false)}>Month</button><button class=${mobileList ? 'on' : ''} onClick=${() => setMobileList(true)}>List</button></span>
    </div>
    <div class="legend" style=${{ marginBottom: '10px' }}><span><i style=${{ background: '#0069b7' }} />Calls</span><span><i style=${{ background: '#5b3fc4' }} />Meetings</span><span><i style=${{ background: '#e08a00' }} />Site visits & measuring</span><span><i style=${{ background: '#00386b' }} />Installations</span><span><i style=${{ background: '#1f9d55' }} />Follow-ups</span><span><i style=${{ background: '#8b93a5' }} />Tasks</span></div>
    ${!data ? html`<${Spinner} />` : mobileList ? html`<div class="card agenda">${(() => {
      const days = Object.keys(byDay).filter((d) => d >= month && d <= addDays(shiftMonth(month, 1), -1)).sort();
      if (!days.length) return html`<p class="muted">Nothing this month.</p>`;
      return days.map((d) => html`<p class="ag-day">${d === today ? 'Today · ' : ''}${fmtDay(d)}</p>${byDay[d].map((e) => html`<button class="ev ev-${e.type}${e.done ? ' done' : ''}" style=${{ fontSize: '13px', padding: '7px 10px', marginBottom: '4px', whiteSpace: 'normal' }} onClick=${() => open(e)}>${evLabel(e)}${e.who_name ? ` · ${e.who_name}` : ''}</button>`)}`);
    })()}</div>`
      : html`<div class="cal">${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => html`<div class="dow">${d}</div>`)}
        ${Array.from({ length: 42 }, (_, i) => addDays(gridStart, i)).map((d) => html`<div class="day ${d.slice(0, 7) !== month.slice(0, 7) ? 'other' : ''} ${d === today ? 'today' : ''}">
          <div class="row" style=${{ gap: '2px', flexWrap: 'nowrap' }}><span class="dn">${Number(d.slice(8))}</span>${canAdd && html`<button class="add" title="Schedule" onClick=${() => setAdding(d)}>+</button>`}</div>
          ${(byDay[d] || []).slice(0, 4).map((e) => html`<button class="ev ev-${e.type}${e.done ? ' done' : ''}" title=${evLabel(e)} onClick=${() => open(e)}>${evLabel(e)}</button>`)}
          ${(byDay[d] || []).length > 4 && html`<button class="link-btn tiny" onClick=${() => setMobileList(true)}>+${byDay[d].length - 4} more</button>`}
        </div>`)}</div>`}
    ${adding && html`<${ActivityModal} initial=${{ date: adding, type: 'site_visit' }} onClose=${() => setAdding(null)} onSaved=${reload} />`}
    ${editing && html`<${ActivityModal} initial=${{ id: editing.id, type: editing.type, title: editing.title, date: editing.date, start_time: editing.start, end_time: editing.end, assigned_to: editing.who, notes: editing.notes || '' }} onClose=${() => setEditing(null)} onSaved=${reload} />`}
  </div>`;
}
