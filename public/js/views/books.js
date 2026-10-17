import { useState, useEffect } from 'preact/hooks';
import { html, api, useLoad, can, go, toast, aed, money, fmtDate, todayISO, sum, r2, hashParam, setHashParam } from '../lib.js';
import { Icon, Badge, Modal, Field, ErrorText, Spinner, Empty, PageHead, SearchBox, Tabs, Select } from '../ui.js';

const SOURCE = { invoice: 'Invoice', payment: 'Customer payment', receipt: 'Goods received', vendor_payment: 'Supplier payment', expense: 'Expense', stock_job: 'Film used (job)', stock_invoice: 'Stock sold', stock_adj: 'Stock adjustment', manual: 'Manual', opening: 'Opening balance' };
const TYPE = { asset: 'Assets', liability: 'Liabilities', equity: 'Equity', income: 'Income', expense: 'Expenses' };
const yearStart = () => `${todayISO().slice(0, 4)}-01-01`;

export function Books() {
  const [tab, setTabState] = useState(hashParam('tab') || 'overview');
  const setTab = (t) => { setTabState(t); setHashParam('tab', t === 'overview' ? null : t); };
  return html`<div class="page wide">
    <${PageHead} eyebrow="Money" title="Accounting" sub="Sales, purchases, payments and expenses post to the journals automatically — the books stay in step with the work." />
    <${Tabs} value=${tab} onChange=${setTab} tabs=${[['overview', 'Overview'], ['pnl', 'Profit & loss'], ['bs', 'Balance sheet'], ['vat', 'VAT return'], ['ageing', 'Receivables & payables'], ['journals', 'Journals'], ['accounts', 'Chart of accounts'], ['tb', 'Trial balance']]} />
    ${tab === 'overview' && html`<${Overview} setTab=${setTab} />`}
    ${tab === 'journals' && html`<${Journals} />`}
    ${tab === 'accounts' && html`<${Accounts} />`}
    ${tab === 'pnl' && html`<${PnL} />`}
    ${tab === 'bs' && html`<${BalanceSheet} />`}
    ${tab === 'tb' && html`<${TrialBalance} />`}
    ${tab === 'vat' && html`<${Vat} />`}
    ${tab === 'ageing' && html`<${Ageing} />`}
  </div>`;
}

function Overview({ setTab }) {
  const t = todayISO();
  const [money_] = useLoad('/books/money', ['invoices', 'purchases', 'expenses']);
  const [pm] = useLoad(`/books/pnl?from=${t.slice(0, 7)}-01&to=${t}`, ['invoices', 'expenses']);
  const [py] = useLoad(`/books/pnl?from=${yearStart()}&to=${t}`, ['invoices', 'expenses']);
  const [age] = useLoad('/books/ageing', ['invoices', 'purchases']);
  const q = Math.floor((Number(t.slice(5, 7)) - 1) / 3);
  const qFrom = `${t.slice(0, 4)}-${String(q * 3 + 1).padStart(2, '0')}-01`;
  const [vat] = useLoad(`/books/vat?from=${qFrom}&to=${t}`, ['invoices', 'expenses', 'purchases']);
  if (!money_ || !pm || !py || !age || !vat) return html`<${Spinner} />`;
  return html`<div class="stack">
    <div class="kpis">${money_.accounts.map((a) => html`<div class="kpi ${a.key === 'bank' ? 'navy' : ''}"><span>${a.name}</span><b>${aed(a.balance, { dp: 0 })}</b></div>`)}
      <div class="kpi"><span>Customers owe us</span><b>${aed(sum(age.receivables, (r) => r.balance), { dp: 0 })}</b><small>${age.receivables.filter((r) => r.days_overdue > 0).length} overdue</small></div>
      <div class="kpi"><span>We owe suppliers</span><b>${aed(sum(age.payables, (r) => r.balance), { dp: 0 })}</b></div></div>
    <div class="grid-3">
      ${[['This month', pm], ['This year', py]].map(([lbl, p]) => html`<button class="card" style=${{ textAlign: 'left' }} onClick=${() => setTab('pnl')}><p class="section-title">${lbl}</p>
        <div class="totals-box" style=${{ border: 0, padding: 0, minWidth: 0 }}><div><span>Revenue</span><b>${aed(p.revenue, { dp: 0 })}</b></div><div><span>Cost of sales</span><b>${aed(p.cost_of_sales, { dp: 0 })}</b></div>
          <div><span>Gross profit</span><b>${aed(p.gross_profit, { dp: 0 })}</b></div><div><span>Overheads</span><b>${aed(p.expenses, { dp: 0 })}</b></div>
          <div class="grand"><span>Net profit</span><span class=${p.net_profit < 0 ? 'red' : ''}>${aed(p.net_profit, { dp: 0 })}</span></div></div></button>`)}
      <button class="card" style=${{ textAlign: 'left' }} onClick=${() => setTab('vat')}><p class="section-title">VAT this quarter (so far)</p>
        <div class="totals-box" style=${{ border: 0, padding: 0, minWidth: 0 }}><div><span>Output VAT (sales)</span><b>${aed(vat.output_vat)}</b></div><div><span>Input VAT (purchases)</span><b>${aed(vat.input_vat)}</b></div>
          <div class="grand"><span>${vat.net_vat >= 0 ? 'Payable' : 'Refundable'}</span><span>${aed(Math.abs(vat.net_vat))}</span></div></div></button>
    </div></div>`;
}

function Range({ from, to, setFrom, setTo, single }) {
  return html`<div class="toolbar">${!single && html`<label class="row small" style=${{ gap: '6px' }}>From <input type="date" value=${from} onInput=${(e) => setFrom(e.target.value)} style=${{ width: 'auto' }} /></label>`}
    <label class="row small" style=${{ gap: '6px' }}>${single ? 'As of' : 'To'} <input type="date" value=${to} onInput=${(e) => setTo(e.target.value)} style=${{ width: 'auto' }} /></label>
    ${!single && html`<span class="chips">${[['This month', `${todayISO().slice(0, 7)}-01`, todayISO()], ['This year', yearStart(), todayISO()], ['Last year', `${Number(todayISO().slice(0, 4)) - 1}-01-01`, `${Number(todayISO().slice(0, 4)) - 1}-12-31`]].map(([l, a, b]) => html`<button class="chip ${from === a && to === b ? 'on' : ''}" onClick=${() => { setFrom(a); setTo(b); }}>${l}</button>`)}</span>`}
    <span class="spacer" /><button class="btn ghost small" onClick=${() => window.print()}><${Icon} name="print" size=${14} /> Print</button></div>`;
}
const Section = ({ title, rows, total, onRow }) => html`<tr class="group-row"><td colspan="2">${title}</td></tr>
  ${rows.map((a) => html`<tr class=${onRow ? 'click' : ''} onClick=${() => onRow?.(a)}><td>${a.code} · ${a.name}</td><td class="r">${money(a.amount)}</td></tr>`)}
  <tr><td class="strong">Total ${title.toLowerCase()}</td><td class="r strong">${money(total)}</td></tr>`;

function PnL() {
  const [from, setFrom] = useState(`${todayISO().slice(0, 7)}-01`);
  const [to, setTo] = useState(todayISO());
  const [ledgerOf, setLedgerOf] = useState(null);
  const [p] = useLoad(`/books/pnl?from=${from}&to=${to}`, [], [from, to]);
  return html`<div><${Range} from=${from} to=${to} setFrom=${setFrom} setTo=${setTo} />
    ${!p ? html`<${Spinner} />` : html`<div class="card flush" style=${{ maxWidth: '760px' }}><table class="table"><tbody>
      <${Section} title="Income" rows=${p.income} total=${p.revenue} onRow=${setLedgerOf} />
      <${Section} title="Cost of sales" rows=${p.cos} total=${p.cost_of_sales} onRow=${setLedgerOf} />
      <tr><td class="strong" style=${{ fontSize: '15px' }}>Gross profit</td><td class="r strong" style=${{ fontSize: '15px' }}>${money(p.gross_profit)}</td></tr>
      <${Section} title="Overheads" rows=${p.opex} total=${p.expenses} onRow=${setLedgerOf} /></tbody>
      <tfoot><tr><td style=${{ fontSize: '16px' }}>Net profit</td><td class="r ${p.net_profit < 0 ? 'red' : 'green'}" style=${{ fontSize: '16px' }}>AED ${money(p.net_profit)}</td></tr></tfoot></table></div>`}
    ${ledgerOf && html`<${Ledger} account=${ledgerOf} from=${from} to=${to} onClose=${() => setLedgerOf(null)} />`}</div>`;
}
function BalanceSheet() {
  const [to, setTo] = useState(todayISO());
  const [ledgerOf, setLedgerOf] = useState(null);
  const [b] = useLoad(`/books/balance-sheet?to=${to}`, [], [to]);
  return html`<div><${Range} to=${to} setTo=${setTo} single />
    ${!b ? html`<${Spinner} />` : html`<div class="grid-2"><div class="card flush"><table class="table"><tbody><${Section} title="Assets" rows=${b.assets} total=${b.total_assets} onRow=${setLedgerOf} /></tbody></table></div>
      <div class="card flush"><table class="table"><tbody><${Section} title="Liabilities" rows=${b.liabilities} total=${b.total_liabilities} onRow=${setLedgerOf} />
        <${Section} title="Equity" rows=${[...b.equity, { code: '—', name: 'Profit not yet closed (current earnings)', amount: b.earnings }]} total=${b.total_equity} onRow=${(a) => a.id && setLedgerOf(a)} /></tbody>
        <tfoot><tr><td>Liabilities + equity</td><td class="r">${money(b.total_liabilities + b.total_equity)}</td></tr></tfoot></table></div></div>
      ${Math.abs(b.total_assets - b.total_liabilities - b.total_equity) > 0.05 && html`<p class="red">Out of balance by ${money(b.total_assets - b.total_liabilities - b.total_equity)} — check manual journals.</p>`}`}
    ${ledgerOf && html`<${Ledger} account=${ledgerOf} from=${yearStart()} to=${to} onClose=${() => setLedgerOf(null)} />`}</div>`;
}
function TrialBalance() {
  const [to, setTo] = useState(todayISO());
  const [tb] = useLoad(`/books/trial-balance?to=${to}`, [], [to]);
  return html`<div><${Range} to=${to} setTo=${setTo} single />
    ${!tb ? html`<${Spinner} />` : html`<div class="card flush" style=${{ maxWidth: '860px' }}><table class="table"><thead><tr><th>Account</th><th class="r">Debit</th><th class="r">Credit</th></tr></thead>
      <tbody>${tb.rows.map((a) => html`<tr><td>${a.code} · ${a.name}</td><td class="r">${a.balance > 0 ? money(a.balance) : ''}</td><td class="r">${a.balance < 0 ? money(-a.balance) : ''}</td></tr>`)}</tbody>
      <tfoot><tr><td>Total</td><td class="r">${money(tb.total_dr)}</td><td class="r">${money(tb.total_cr)}</td></tr></tfoot></table></div>`}</div>`;
}
function Vat() {
  const t = todayISO();
  const q = Math.floor((Number(t.slice(5, 7)) - 1) / 3);
  const [from, setFrom] = useState(`${t.slice(0, 4)}-${String(q * 3 + 1).padStart(2, '0')}-01`);
  const [to, setTo] = useState(t);
  const [v] = useLoad(`/books/vat?from=${from}&to=${to}`, [], [from, to]);
  return html`<div><${Range} from=${from} to=${to} setFrom=${setFrom} setTo=${setTo} />
    ${!v ? html`<${Spinner} />` : html`<div class="card flush" style=${{ maxWidth: '760px' }}><table class="table"><thead><tr><th>VAT return (UAE FTA)</th><th class="r">Amount</th><th class="r">VAT</th></tr></thead><tbody>
      <tr><td>Standard-rated supplies (sales)</td><td class="r">${money(v.sales_net)}</td><td class="r">${money(v.output_vat)}</td></tr>
      <tr><td>Standard-rated expenses & purchases</td><td class="r">${money(v.purchases_net)}</td><td class="r">${money(v.input_vat)}</td></tr></tbody>
      <tfoot><tr><td colspan="2">Net VAT ${v.net_vat >= 0 ? 'payable to FTA' : 'refundable'}</td><td class="r">AED ${money(Math.abs(v.net_vat))}</td></tr></tfoot></table></div>
      <p class="muted small">From posted journals (output VAT on issued invoices; input VAT on goods received and expenses with a tax invoice). Check against your filing before submitting.</p>`}</div>`;
}
function Ageing() {
  const [d] = useLoad('/books/ageing', ['invoices', 'purchases']);
  if (!d) return html`<${Spinner} />`;
  const B = [['current', 'Not due'], ['d30', '1–30 days'], ['d60', '31–60'], ['d90', '61–90'], ['d90p', '90+']];
  const table = (rows, kind) => {
    const tot = Object.fromEntries(B.map(([k]) => [k, sum(rows.filter((r) => r.bucket === k), (r) => r.balance)]));
    return html`<div class="table-wrap"><table class="table"><thead><tr><th>${kind === 'ar' ? 'Customer' : 'Supplier'}</th><th>Document</th>${B.map(([, l]) => html`<th class="r">${l}</th>`)}</tr></thead>
      <tbody>${rows.map((r) => html`<tr class="click" onClick=${() => go(kind === 'ar' ? `invoices/${r.id}` : `purchases/${r.id}`)}><td>${r.contact_name || r.vendor_name}</td><td>${r.number}<span class="sub">${fmtDate(r.due_date || r.date)}</span></td>${B.map(([k]) => html`<td class="r">${r.bucket === k ? money(r.balance) : ''}</td>`)}</tr>`)}
        ${!rows.length && html`<tr><td colspan="7" class="muted">Nothing outstanding.</td></tr>`}</tbody>
      <tfoot><tr><td colspan="2">Total ${money(sum(rows, (r) => r.balance))}</td>${B.map(([k]) => html`<td class="r">${money(tot[k])}</td>`)}</tr></tfoot></table></div>`;
  };
  return html`<div class="stack"><div class="card flush"><div class="card-head" style=${{ padding: '16px 18px 0' }}><h2>Receivables — customers owe us</h2></div>${table(d.receivables, 'ar')}</div>
    <div class="card flush"><div class="card-head" style=${{ padding: '16px 18px 0' }}><h2>Payables — we owe suppliers</h2><span class="muted small">30-day terms assumed</span></div>${table(d.payables, 'ap')}</div></div>`;
}

function Journals() {
  const [q, setQ] = useState('');
  const [source, setSource] = useState('');
  const [open, setOpen] = useState(null);
  const [editing, setEditing] = useState(null);
  const [data, reload] = useLoad(`/journals?source=${source}&q=${encodeURIComponent(q)}`, ['invoices', 'expenses', 'purchases', 'stock'], [q, source]);
  return html`<div>
    <div class="toolbar"><${SearchBox} value=${q} onInput=${setQ} placeholder="JV number or description" /><${Select} value=${source} onChange=${setSource} options=${Object.entries(SOURCE)} placeholder="All sources" />
      <span class="spacer" />${can('accounting', 'create') && html`<button class="btn primary" onClick=${() => setEditing({})}><${Icon} name="plus" size=${15} /> Journal entry</button>`}</div>
    ${!data ? html`<${Spinner} />` : !data.journals.length ? html`<div class="card"><${Empty} icon="book" title="No journals" /></div>`
      : html`<div class="card flush"><div class="table-wrap"><table class="table table-cards"><thead><tr><th>Date</th><th>Ref</th><th>Description</th><th class="hide-m">Source</th><th class="r">Amount</th><th class="hide-m">Status</th></tr></thead>
        <tbody>${data.journals.map((j) => html`<tr class="click" onClick=${() => setOpen(j.id)}><td class="nowrap">${fmtDate(j.date)}</td><td class="mono">${j.number}</td><td class="title">${j.description}</td>
          <td class="hide-m"><${Badge} tone=${['manual', 'opening'].includes(j.source) ? 'violet' : 'blue'}>${['manual', 'opening'].includes(j.source) ? '' : 'Auto · '}${SOURCE[j.source] || j.source}<//></td><td class="r">${aed(j.amount || 0)}</td>
          <td class="hide-m"><${Badge} tone=${j.status === 'posted' ? 'green' : 'grey'}>${j.status === 'posted' ? 'Posted' : 'Draft'}<//></td></tr>`)}</tbody></table></div></div>`}
    ${open && html`<${JournalModal} id=${open} onClose=${() => setOpen(null)} onEdit=${(j) => { setOpen(null); setEditing(j); }} onChanged=${reload} />`}
    ${editing && html`<${JournalForm} journal=${editing.journal ? editing : null} onClose=${() => setEditing(null)} onSaved=${reload} />`}
  </div>`;
}
function JournalModal({ id, onClose, onEdit, onChanged }) {
  const [d] = useLoad(`/journals/${id}`);
  if (!d) return null;
  const j = d.journal;
  const manual = ['manual', 'opening'].includes(j.source);
  return html`<${Modal} title=${`${j.number} · ${fmtDate(j.date)}`} onClose=${onClose} wide>
    <p style=${{ margin: '0 0 10px' }}>${j.description}</p><p class="muted small" style=${{ marginTop: 0 }}>${manual ? 'Manual entry' : `Posted automatically from ${SOURCE[j.source] || j.source}`}</p>
    <table class="table"><thead><tr><th>Account</th><th>Memo</th><th class="r">Debit</th><th class="r">Credit</th></tr></thead>
      <tbody>${d.lines.map((l) => html`<tr><td>${l.code} · ${l.account_name}</td><td class="small muted">${l.memo}</td><td class="r">${l.debit ? money(l.debit) : ''}</td><td class="r">${l.credit ? money(l.credit) : ''}</td></tr>`)}</tbody>
      <tfoot><tr><td colspan="2">Total</td><td class="r">${money(sum(d.lines, (l) => l.debit))}</td><td class="r">${money(sum(d.lines, (l) => l.credit))}</td></tr></tfoot></table>
    ${manual && html`<div class="form-actions" style=${{ marginTop: '14px' }}>${can('accounting', 'delete') && html`<button class="btn danger-ghost" onClick=${() => confirm('Delete this journal?') && api(`/journals/${j.id}`, { method: 'DELETE' }).then(() => { onChanged(); onClose(); })}>Delete</button>`}
      ${can('accounting', 'edit') && html`<button class="btn primary" onClick=${() => onEdit(d)}>Edit</button>`}</div>`}
  <//>`;
}
function JournalForm({ journal, onClose, onSaved }) {
  const [accounts, setAccounts] = useState([]);
  const [f, setF] = useState(journal ? { date: journal.journal.date, description: journal.journal.description, status: journal.journal.status, source: journal.journal.source, lines: journal.lines.map((l) => ({ account_id: l.account_id, debit: l.debit || '', credit: l.credit || '', memo: l.memo })) }
    : { date: todayISO(), description: '', status: 'posted', source: 'manual', lines: [{ account_id: '', debit: '', credit: '', memo: '' }, { account_id: '', debit: '', credit: '', memo: '' }] });
  const [error, setError] = useState('');
  useEffect(() => { api('/accounts').then((d) => setAccounts(d.accounts.filter((a) => a.active))).catch(() => {}); }, []);
  const setLine = (i, k, v) => setF({ ...f, lines: f.lines.map((l, j) => (j === i ? { ...l, [k]: v } : l)) });
  const dr = r2(sum(f.lines, (l) => l.debit)); const cr = r2(sum(f.lines, (l) => l.credit));
  async function save(e) {
    e.preventDefault();
    try { journal ? await api(`/journals/${journal.journal.id}`, { method: 'PUT', body: f }) : await api('/journals', { method: 'POST', body: f }); toast('Journal saved'); onSaved(); onClose(); } catch (err) { setError(err.message); }
  }
  return html`<${Modal} title=${journal ? `Edit ${journal.journal.number}` : 'Journal entry'} onClose=${onClose} wide>
    <form class="form" onSubmit=${save}>
      <div class="form-grid"><${Field} label="Date"><input type="date" value=${f.date} onInput=${(e) => setF({ ...f, date: e.target.value })} /><//>
        <${Field} label="Type"><select value=${f.source} onChange=${(e) => setF({ ...f, source: e.target.value })}><option value="manual">Manual journal</option><option value="opening">Opening balance</option></select><//>
        <${Field} label="Status"><select value=${f.status} onChange=${(e) => setF({ ...f, status: e.target.value })}><option value="posted">Posted</option><option value="draft">Draft</option></select><//></div>
      <${Field} label="Description"><input required value=${f.description} onInput=${(e) => setF({ ...f, description: e.target.value })} placeholder="e.g. Equipment depreciation — October" /><//>
      <div class="table-wrap"><table class="lines"><thead><tr><th>Account</th><th>Memo</th><th class="w-money">Debit</th><th class="w-money">Credit</th><th class="w-act"></th></tr></thead>
        <tbody>${f.lines.map((l, i) => html`<tr><td><select value=${l.account_id} onChange=${(e) => setLine(i, 'account_id', e.target.value)}><option value="">Pick…</option>${Object.entries(TYPE).map(([t, lbl]) => html`<optgroup label=${lbl}>${accounts.filter((a) => a.type === t).map((a) => html`<option value=${a.id}>${a.code} · ${a.name}</option>`)}</optgroup>`)}</select></td>
          <td><input value=${l.memo} onInput=${(e) => setLine(i, 'memo', e.target.value)} /></td><td><input type="number" step="0.01" value=${l.debit} onInput=${(e) => setLine(i, 'debit', e.target.value)} /></td>
          <td><input type="number" step="0.01" value=${l.credit} onInput=${(e) => setLine(i, 'credit', e.target.value)} /></td><td><button type="button" class="icon-btn small" onClick=${() => setF({ ...f, lines: f.lines.filter((_, j) => j !== i) })}><${Icon} name="x" size=${14} /></button></td></tr>`)}</tbody></table></div>
      <div class="row"><button type="button" class="btn ghost small" onClick=${() => setF({ ...f, lines: [...f.lines, { account_id: '', debit: '', credit: '', memo: '' }] })}><${Icon} name="plus" size=${14} /> Line</button><span class="spacer" />
        <span class=${dr === cr && dr > 0 ? 'green strong' : 'red strong'}>Debit ${money(dr)} · Credit ${money(cr)} ${dr === cr && dr > 0 ? '✓ balanced' : '— must balance'}</span></div>
      <${ErrorText} error=${error} /><div class="form-actions"><button type="button" class="btn ghost" onClick=${onClose}>Cancel</button><button class="btn primary" disabled=${dr !== cr || !dr}>Save</button></div>
    </form>
  <//>`;
}

function Accounts() {
  const [data, reload] = useLoad('/accounts', ['invoices', 'expenses', 'purchases']);
  const [ledgerOf, setLedgerOf] = useState(null);
  const [adding, setAdding] = useState(false);
  if (!data) return html`<${Spinner} />`;
  return html`<div><div class="toolbar"><span class="muted small">Click an account to see its ledger.</span><span class="spacer" />${can('accounting', 'create') && html`<button class="btn ghost" onClick=${() => setAdding(true)}><${Icon} name="plus" size=${15} /> Account</button>`}</div>
    <div class="card flush"><div class="table-wrap"><table class="table"><thead><tr><th>Code</th><th>Account</th><th class="hide-m">Type</th><th class="r">Balance</th></tr></thead>
      <tbody>${Object.keys(TYPE).map((t) => html`<tr class="group-row"><td colspan="4">${TYPE[t]}</td></tr>${data.accounts.filter((a) => a.type === t).map((a) => html`<tr class="click" onClick=${() => setLedgerOf(a)} style=${{ opacity: a.active ? 1 : 0.5 }}>
        <td class="mono">${a.code}</td><td>${a.name}${a.is_money ? html` <${Badge} tone="blue">Cash/bank<//>` : ''}${a.is_expense_category ? html` <${Badge}>Expense category<//>` : ''}</td><td class="hide-m small muted">${t}</td><td class="r">${a.natural ? money(a.natural) : '—'}</td></tr>`)}`)}</tbody></table></div></div>
    ${ledgerOf && html`<${Ledger} account=${ledgerOf} from=${yearStart()} to=${todayISO()} onClose=${() => setLedgerOf(null)} />`}
    ${adding && html`<${AccountForm} onClose=${() => setAdding(false)} onSaved=${reload} />`}</div>`;
}
function AccountForm({ onClose, onSaved }) {
  const [f, setF] = useState({ code: '', name: '', type: 'expense', is_money: false, is_expense_category: true });
  const [error, setError] = useState('');
  return html`<${Modal} title="New account" onClose=${onClose}><form class="form" onSubmit=${(e) => { e.preventDefault(); api('/accounts', { method: 'POST', body: f }).then(() => { onSaved(); onClose(); }).catch((err) => setError(err.message)); }}>
    <div class="form-grid three"><${Field} label="Code"><input required value=${f.code} onInput=${(e) => setF({ ...f, code: e.target.value })} placeholder="6550" /><//>
      <${Field} label="Type"><select value=${f.type} onChange=${(e) => setF({ ...f, type: e.target.value })}>${Object.entries(TYPE).map(([k, v]) => html`<option value=${k}>${v}</option>`)}</select><//></div>
    <${Field} label="Name"><input required value=${f.name} onInput=${(e) => setF({ ...f, name: e.target.value })} /><//>
    ${f.type === 'asset' && html`<label class="check"><input type="checkbox" checked=${f.is_money} onChange=${(e) => setF({ ...f, is_money: e.target.checked })} /> Cash or bank account (payments can go in/out)</label>`}
    ${f.type === 'expense' && html`<label class="check"><input type="checkbox" checked=${f.is_expense_category} onChange=${(e) => setF({ ...f, is_expense_category: e.target.checked })} /> Show as an expense category</label>`}
    <${ErrorText} error=${error} /><div class="form-actions"><button type="button" class="btn ghost" onClick=${onClose}>Cancel</button><button class="btn primary">Add</button></div></form><//>`;
}
function Ledger({ account, from: f0, to: t0, onClose }) {
  const [from, setFrom] = useState(f0);
  const [to, setTo] = useState(t0);
  const [d] = useLoad(`/books/ledger/${account.id}?from=${from}&to=${to}`, [], [from, to]);
  const link = (r) => ({ invoice: `invoices/${r.source_id}`, payment: null, expense: 'expenses', receipt: null }[r.source]);
  return html`<${Modal} title=${`${account.code} · ${account.name}`} onClose=${onClose} xwide>
    <div class="toolbar"><input type="date" value=${from} onInput=${(e) => setFrom(e.target.value)} style=${{ width: 'auto' }} /> → <input type="date" value=${to} onInput=${(e) => setTo(e.target.value)} style=${{ width: 'auto' }} /></div>
    ${!d ? html`<${Spinner} />` : html`<div class="table-wrap"><table class="table compact"><thead><tr><th>Date</th><th>Ref</th><th>Description</th><th class="r">Debit</th><th class="r">Credit</th><th class="r">Balance</th></tr></thead>
      <tbody><tr><td colspan="5" class="muted">Opening balance</td><td class="r">${money(d.opening)}</td></tr>
        ${d.rows.map((r) => html`<tr class=${link(r) ? 'click' : ''} onClick=${() => link(r) && (onClose(), go(link(r)))}><td class="nowrap">${fmtDate(r.date)}</td><td class="mono">${r.number}</td><td>${r.description}${r.memo && html`<span class="sub">${r.memo}</span>`}</td><td class="r">${r.debit ? money(r.debit) : ''}</td><td class="r">${r.credit ? money(r.credit) : ''}</td><td class="r">${money(r.balance)}</td></tr>`)}</tbody>
      <tfoot><tr><td colspan="5">Closing balance</td><td class="r">${money(d.closing)}</td></tr></tfoot></table></div>`}
  <//>`;
}
