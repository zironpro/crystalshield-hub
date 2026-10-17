import { useState } from 'preact/hooks';
import { html, useLoad, useStore, can, scope, go, aed, kaed, qty, fmtDay, todayISO, addDays, timeAgo, isInstaller, LEAD_STATUS, FOLLOWUP } from '../lib.js';
import { Icon, Spinner, Badge, Due, StatusBadge } from '../ui.js';
import { ActivityList, Funnel, HBars, VBars, Trend } from './shared.js';
import { JobCard } from './jobs.js';
import { useClock } from './attendance.js';

function greeting() { const h = Number(new Date().toLocaleString('en-GB', { timeZone: 'Asia/Dubai', hour: '2-digit', hourCycle: 'h23' })); return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'; }

export function Home() {
  const s = useStore();
  const [d, reload] = useLoad('/dashboard', ['leads', 'deals', 'jobs', 'activities', 'followups', 'quotes', 'invoices', 'stock']);
  const first = s.me.name.split(' ')[0];
  if (!d) return html`<div class="page"><${Spinner} /></div>`;
  if (isInstaller()) return html`<${InstallerHome} d=${d} first=${first} />`;
  const t = todayISO();
  const mine = scope('crm') !== 'all';
  return html`<div class="page wide">
    <div class="page-head"><div><p class="eyebrow">${new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Asia/Dubai' })}</p><h1>${greeting()}, ${first}</h1></div>
      <div class="btn-row">${can('crm', 'create') && html`<a class="btn ghost" href="#/leads"><${Icon} name="target" size=${15} /> Leads</a><a class="btn primary" href="#/deals"><${Icon} name="deal" size=${15} /> Pipeline</a>`}</div></div>
    <div class="kpis">
      ${can('crm') && html`<a class="kpi navy" href="#/leads?status=new"><span>New leads</span><b>${d.leads_new}</b><small>waiting for a first call</small></a>`}
      ${can('crm') && html`<a class="kpi ${(d.leads_due?.length || 0) + (d.followups_due?.length || 0) > 0 ? 'warn' : ''}" href="#/leads"><span>To follow up today</span><b>${(d.leads_due?.length || 0) + (d.deals_due?.length || 0) + (d.followups_due?.length || 0)}</b><small>leads, deals & customers</small></a>`}
      ${d.pipeline && html`<a class="kpi" href="#/deals"><span>${mine ? 'My pipeline' : 'Open pipeline'}</span><b>${kaed(d.pipeline.reduce((a, p) => a + p.value, 0))}</b><small>${d.pipeline.reduce((a, p) => a + p.count, 0)} open deals</small></a>`}
      ${d.this_month && html`<a class="kpi" href="#/reports"><span>Sales this month</span><b>${kaed(d.this_month.total)}</b><${Trend} now=${d.this_month.total} before=${d.last_month.total} /></a>`}
      ${d.receivables && html`<a class="kpi ${d.receivables.overdue > 0 ? 'bad' : ''}" href="#/invoices"><span>Customers owe</span><b>${kaed(d.receivables.total)}</b><small>${d.receivables.count ? `${kaed(d.receivables.overdue)} overdue (${d.receivables.count})` : 'nothing overdue'}</small></a>`}
      ${d.jobs_today && html`<a class="kpi" href="#/jobs"><span>Installations today</span><b>${d.jobs_today.filter((j) => j.date <= t).length}</b><small>${d.jobs_awaiting_signoff ? `${d.jobs_awaiting_signoff} awaiting sign-off` : `${d.jobs_unscheduled || 0} not scheduled`}</small></a>`}
    </div>
    ${d.funnel && html`<div class="card" style=${{ marginBottom: '16px' }}><div class="card-head"><h2>Leads to won <span class="muted">this month${mine ? ' · mine' : ''}</span></h2>${can('reports') && html`<a class="link small" href="#/reports">Full report →</a>`}</div><${Funnel} f=${d.funnel} /></div>`}
    <div class="grid-2">
      <div class="stack">
        <div class="card"><div class="card-head"><h2>My day</h2><a class="link small" href="#/calendar">Calendar →</a></div>
          <${ActivityList} items=${d.my_activities} onChanged=${reload} empty="No calls or visits planned. Schedule them from a lead or deal." />
          ${d.leads_due?.length > 0 && html`<p class="section-title" style=${{ margin: '14px 0 4px' }}>Leads to call</p><div class="list-rows">${d.leads_due.slice(0, 8).map((l) => html`<a class="list-row" href=${`#/leads/${l.id}`}><span class="ico-sq">🎯</span><span class="grow"><b>${l.name}</b><small>${l.source} · ${l.phone}</small></span><${StatusBadge} map=${LEAD_STATUS} status=${l.status} /><${Due} date=${l.next_follow_up || t} /></a>`)}</div>`}
          ${d.deals_due?.length > 0 && html`<p class="section-title" style=${{ margin: '14px 0 4px' }}>Deals to follow up</p><div class="list-rows">${d.deals_due.map((x) => html`<a class="list-row" href=${`#/deals/${x.id}`}><span class="ico-sq">💼</span><span class="grow"><b>${x.title}</b><small>${x.code} · ${kaed(x.value)}</small></span><${Due} date=${x.next_follow_up} /></a>`)}</div>`}
          ${d.followups_due?.length > 0 && html`<p class="section-title" style=${{ margin: '14px 0 4px' }}>Customer follow-ups</p><div class="list-rows">${d.followups_due.slice(0, 6).map((f) => html`<a class="list-row" href="#/warranty"><span class="ico-sq">${FOLLOWUP[f.type]?.icon}</span><span class="grow"><b>${f.title}</b><small>${f.contact_name || ''}</small></span><${Due} date=${f.due_date} /></a>`)}</div>`}
        </div>
        ${d.quotes_waiting?.length > 0 && html`<div class="card"><div class="card-head"><h2>Quotations waiting for the customer</h2><a class="link small" href="#/quotes">All →</a></div><div class="list-rows">${d.quotes_waiting.map((q) => html`<a class="list-row" href=${`#/quotes/${q.id}`}><span class="ico-sq">📄</span><span class="grow"><b>${q.number} · ${q.contact_name || ''}</b><small>Sent ${timeAgo(q.sent_at)}${q.viewed_at ? ' · 👀 opened' : ' · not opened yet'}</small></span><b>${aed(q.total, { dp: 0 })}</b></a>`)}</div></div>`}
      </div>
      <div class="stack">
        ${d.jobs_today?.length > 0 && html`<div class="card"><div class="card-head"><h2>Installations today & tomorrow</h2><a class="link small" href="#/jobs">All →</a></div>${d.jobs_today.map((j) => html`<${JobCard} j=${j} />`)}</div>`}
        ${d.sources?.length > 0 && html`<div class="card"><div class="card-head"><h2>Leads by source <span class="muted">this month</span></h2><span class="muted small">${d.sources.reduce((a, r) => a + r.n, 0)} total</span></div><${HBars} rows=${d.sources} value=${(r) => r.n} label=${(r) => r.source} fmt=${(v, r) => `${v} · ${r.share}%`} /></div>`}
        ${d.weekly && html`<div class="card"><div class="card-head"><h2>Sales this month by week</h2><b>${aed(d.this_month.total, { dp: 0 })}</b></div><${VBars} rows=${d.weekly.map((w) => ({ label: w.label, a: w.total }))} height=${150} /></div>`}
        ${d.to_invoice?.length > 0 && html`<div class="card"><div class="card-head"><h2>Accepted — still to invoice</h2></div><div class="list-rows">${d.to_invoice.map((x) => html`<a class="list-row" href=${`#/quotes/${x.quote_id}`}><span class="ico-sq">🧾</span><span class="grow"><b>${x.title}</b><small>${x.number}</small></span><b>${aed(x.remaining, { dp: 0 })}</b></a>`)}</div></div>`}
        ${d.money && html`<div class="card"><div class="card-head"><h2>Cash & bank</h2><a class="link small" href="#/books">Accounting →</a></div><div class="list-rows">${d.money.map((a) => html`<div class="list-row"><span class="grow"><b>${a.name}</b></span><b>${aed(a.balance, { dp: 0 })}</b></div>`)}</div></div>`}
        ${d.low_stock?.length > 0 && html`<div class="card" style=${{ borderColor: '#f5d39b' }}><div class="card-head"><h2>📦 Low stock</h2><a class="link small" href="#/products">Products →</a></div><div class="list-rows">${d.low_stock.map((p) => html`<a class="list-row" href=${`#/products/${p.id}`}><span class="grow"><b>${p.name}</b><small>${p.code} · alert below ${qty(p.min_stock)}</small></span><b class="red">${qty(p.stock)} ${p.unit}</b></a>`)}</div></div>`}
      </div>
    </div>
  </div>`;
}

function InstallerHome({ d, first }) {
  const { att, toggle } = useClock();
  const t = todayISO();
  const today = (d.jobs_today || []).filter((j) => j.date <= t);
  const tomorrow = (d.jobs_today || []).filter((j) => j.date > t);
  return html`<div class="page narrow">
    <div class="page-head"><div><p class="eyebrow">${new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Asia/Dubai' })}</p><h1>${greeting()}, ${first}</h1></div></div>
    ${att && html`<div class="job-hero" style=${{ display: 'flex', alignItems: 'center', gap: '14px' }}><span style=${{ fontSize: '30px' }}>⏱</span>
      <span style=${{ flex: 1 }}><b style=${{ fontSize: '16px' }}>${att.today.working ? 'You are clocked in' : att.today.first_in ? 'Clocked out' : 'Not clocked in yet'}</b><div class="sub">${att.shift ? `Shift ${att.shift.start}–${att.shift.end}` : ''}${att.today.place ? ` · ${att.today.place}` : ''}</div></span>
      <button class="btn ${att.today.working ? 'ghost' : 'amber'} big" onClick=${toggle}>${att.today.working ? 'Clock out' : 'Clock in'}</button></div>`}
    <p class="section-title" style=${{ marginTop: '18px' }}>Today</p>
    ${today.length ? today.map((j) => html`<${JobCard} j=${j} />`) : html`<div class="card"><p class="muted" style=${{ margin: 0 }}>No installation today.</p></div>`}
    ${tomorrow.length > 0 && html`<p class="section-title" style=${{ marginTop: '18px' }}>Tomorrow</p>${tomorrow.map((j) => html`<${JobCard} j=${j} />`)}`}
    ${d.my_activities?.length > 0 && html`<p class="section-title" style=${{ marginTop: '18px' }}>Visits & tasks</p><div class="card"><${ActivityList} items=${d.my_activities} /></div>`}
    <a class="btn ghost block" style=${{ marginTop: '18px' }} href="#/jobs">All my jobs</a>
  </div>`;
}
