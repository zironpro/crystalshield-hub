import { useState } from 'preact/hooks';
import { html, useLoad, can, go, aed, kaed, qty, todayISO, pct, STAGE } from '../lib.js';
import { Icon, Avatar, Spinner, PageHead, Chips } from '../ui.js';
import { Funnel, HBars, VBars, Trend } from './shared.js';

function rangeOf(k) {
  const t = todayISO(); const y = t.slice(0, 4);
  if (k === 'month') return [`${t.slice(0, 7)}-01`, t];
  if (k === 'last') { const d = new Date(`${t.slice(0, 7)}-01T00:00:00Z`); d.setUTCDate(0); const e = d.toISOString().slice(0, 10); return [`${e.slice(0, 7)}-01`, e]; }
  if (k === 'quarter') { const q = Math.floor((Number(t.slice(5, 7)) - 1) / 3); return [`${y}-${String(q * 3 + 1).padStart(2, '0')}-01`, t]; }
  return [`${y}-01-01`, t];
}

export function Reports() {
  const [period, setPeriod] = useState('month');
  const [from, to] = rangeOf(period);
  const [d] = useLoad(`/reports/sales?from=${from}&to=${to}`, ['invoices', 'deals', 'leads'], [period]);
  return html`<div class="page wide">
    <${PageHead} eyebrow="Insights" title="Sales performance" sub="Leads to won, sales by person, source and product, and the real profit on each job.">
      <${Chips} value=${period} onChange=${setPeriod} options=${[['month', 'This month'], ['last', 'Last month'], ['quarter', 'This quarter'], ['year', 'This year']]} />
      <button class="btn ghost" onClick=${() => window.print()}><${Icon} name="print" size=${15} /> Print</button>
    <//>
    ${!d ? html`<${Spinner} />` : html`<div class="stack">
      <div class="kpis">
        <div class="kpi navy"><span>Sales this month</span><b>${aed(d.this_month.total, { dp: 0 })}</b><small>${d.this_month.invoices} invoices</small><${Trend} now=${d.this_month.total} before=${d.last_month.total} /></div>
        <div class="kpi"><span>Last month</span><b>${aed(d.last_month.total, { dp: 0 })}</b><small>${d.last_month.invoices} invoices</small></div>
        <div class="kpi"><span>Money in (this month)</span><b class="green">${aed(d.this_month.incoming, { dp: 0 })}</b><small>payments received</small></div>
        <div class="kpi"><span>Money out (this month)</span><b>${aed(d.this_month.outgoing, { dp: 0 })}</b><small>suppliers + expenses</small></div>
        <div class="kpi"><span>Installations signed off</span><b>${d.jobs.done}</b><small>${d.jobs.rating?.r ? `avg ${d.jobs.rating.r}★ (${d.jobs.rating.n})` : ''} · ${qty(d.jobs.sqm)} SQM film used</small></div>
      </div>
      <div class="card"><div class="card-head"><h2>Leads to won <span class="muted">${from} → ${to}</span></h2></div><${Funnel} f=${d.funnel} /></div>
      <div class="grid-2">
        <div class="card"><div class="card-head"><h2>Sales by week (this month)</h2></div><${VBars} rows=${d.weekly.map((w) => ({ label: w.label, a: w.total }))} /></div>
        <div class="card"><div class="card-head"><h2>Last 12 months</h2><span class="legend"><span><i style=${{ background: 'var(--navy)' }} />Invoiced</span><span><i style=${{ background: 'var(--sky)' }} />Collected</span></span></div>
          <${VBars} rows=${d.monthly.map((m) => ({ label: new Date(m.month + '-01').toLocaleDateString('en-GB', { month: 'short' }), a: m.invoiced, b: m.collected }))} series=${[['a', 'navy'], ['b', 'sky']]} /></div>
      </div>
      <div class="grid-2">
        <div class="card"><div class="card-head"><h2>Leads by source</h2><span class="muted small">${d.sources.reduce((s, r) => s + r.n, 0)} total</span></div>
          ${d.sources.length ? html`<${HBars} rows=${d.sources} value=${(r) => r.n} label=${(r) => r.source} fmt=${(v, r) => `${v} · ${r.share}%`} />
            <table class="table compact" style=${{ marginTop: '10px' }}><thead><tr><th>Source</th><th class="r">Leads</th><th class="r">Converted</th><th class="r">Won value</th></tr></thead><tbody>${d.sources.map((r) => html`<tr><td>${r.source}</td><td class="r">${r.n}</td><td class="r">${r.converted} (${pct(r.converted, r.n)}%)</td><td class="r">${kaed(r.won_value)}</td></tr>`)}</tbody></table>` : html`<p class="muted small">No leads in this period.</p>`}</div>
        <div class="card"><div class="card-head"><h2>Open pipeline</h2></div><${HBars} rows=${d.pipeline} value=${(r) => r.value} label=${(r) => `${r.label} (${r.count})`} fmt=${kaed} />
          ${d.lost_reasons.length > 0 && html`<h3 style=${{ margin: '16px 0 6px' }}>Why deals were lost</h3><${HBars} rows=${d.lost_reasons} value=${(r) => r.n} label=${(r) => r.reason} color="#d04d4d" fmt=${(v, r) => `${v} · ${kaed(r.v)}`} />`}</div>
      </div>
      <div class="card flush"><div class="card-head" style=${{ padding: '16px 18px 0' }}><h2>Sales by person</h2></div><div class="table-wrap"><table class="table"><thead><tr><th>Person</th><th class="r">Leads</th><th class="r">Quotes sent</th><th class="r">Won</th><th class="r">Won value</th><th class="r">Invoiced</th><th class="r">Win rate</th><th class="r">Open pipeline</th></tr></thead>
        <tbody>${d.people.map((p) => html`<tr><td><span class="person"><${Avatar} id=${p.id} size=${24} />${p.name}</span></td><td class="r">${p.leads}</td><td class="r">${p.quotes}<span class="sub">${kaed(p.quotes_value)}</span></td><td class="r">${p.won}</td><td class="r strong">${aed(p.won_value, { dp: 0 })}</td><td class="r">${aed(p.invoiced, { dp: 0 })}</td><td class="r">${p.win_rate}%</td><td class="r">${p.open} · ${kaed(p.open_value)}</td></tr>`)}
          ${!d.people.length && html`<tr><td colspan="8" class="muted">No activity in this period.</td></tr>`}</tbody></table></div></div>
      <div class="grid-2">
        <div class="card"><div class="card-head"><h2>What sells (invoiced)</h2></div>${d.products.length ? html`<${HBars} rows=${d.products} value=${(r) => r.value} label=${(r) => r.label} fmt=${(v, r) => `${kaed(v)} · ${qty(r.qty)}`} />` : html`<p class="muted small">No invoices in this period.</p>`}</div>
        <div class="card"><div class="card-head"><h2>Top customers</h2></div>${d.customers.length ? html`<div class="list-rows">${d.customers.map((c) => html`<a class="list-row" href=${`#/contacts/${c.id}`}><span class="grow"><b>${c.name}</b><small>${c.invoices} invoices · paid ${aed(c.paid, { dp: 0 })}</small></span><b>${aed(c.total, { dp: 0 })}</b></a>`)}</div>` : html`<p class="muted small">—</p>`}</div>
      </div>
      ${d.profits && html`<div class="card flush"><div class="card-head" style=${{ padding: '16px 18px 0' }}><h2>Profit per won deal</h2><span class="muted small">Revenue (excl. VAT) − film used − direct purchases − job expenses</span></div><div class="table-wrap"><table class="table"><thead><tr><th>Deal</th><th class="r">SQM</th><th class="r">Revenue</th><th class="r">Cost</th><th class="r">Profit</th><th class="r">Margin</th></tr></thead>
        <tbody>${d.profits.map((p) => html`<tr class="click" onClick=${() => go(`deals/${p.id}`)}><td class="title">${p.title}<span class="sub">${p.code} · ${p.contact_name || ''} · ${p.owner_name || ''}</span></td><td class="r">${qty(p.sqm)}</td><td class="r">${aed(p.invoiced || p.quoted, { dp: 0 })}${!p.invoiced && html`<span class="sub">quoted</span>`}</td><td class="r">${aed(p.cost, { dp: 0 })}${p.planned && html`<span class="sub">planned — not installed yet</span>`}</td><td class="r strong ${p.profit < 0 ? 'red' : 'green'}">${aed(p.profit, { dp: 0 })}</td><td class="r">${p.margin}%</td></tr>`)}
          ${!d.profits.length && html`<tr><td colspan="6" class="muted">No deals won in this period.</td></tr>`}</tbody></table></div></div>`}
    </div>`}
  </div>`;
}
