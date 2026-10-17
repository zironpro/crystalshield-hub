import { useState, useMemo, useEffect } from 'preact/hooks';
import { html, api, useLoad, can, toast, aed, fmtDate, todayISO, sum, METHOD, r2 } from '../lib.js';
import { Icon, Modal, Field, ErrorText, Spinner, Empty, PageHead, SearchBox, Select, Files, useVendors } from '../ui.js';
import { HBars } from './shared.js';

export function Expenses() {
  const [month, setMonth] = useState(todayISO().slice(0, 7));
  const [cat, setCat] = useState('');
  const [q, setQ] = useState('');
  const [modal, setModal] = useState(null);
  const from = month ? `${month}-01` : ''; const to = month ? `${month}-31` : '';
  const [data, reload] = useLoad(`/expenses?from=${from}&to=${to}`, ['expenses'], [month]);
  const [accts, setAccts] = useState({ expense_categories: [] });
  useEffect(() => { api('/accounts').then(setAccts).catch(() => {}); }, []);
  const all = data?.expenses || [];
  const rows = useMemo(() => all.filter((e) => (!cat || String(e.account_id) === cat) && (!q || [e.number, e.description, e.payee, e.vendor_name, e.deal_code].some((v) => String(v || '').toLowerCase().includes(q.toLowerCase())))), [all, cat, q]);
  const byCat = {};
  for (const e of all) byCat[e.category] = (byCat[e.category] || 0) + e.total;
  return html`<div class="page wide">
    <${PageHead} eyebrow="Money" title="Expenses" sub="Costs against a job show up in that deal’s profit. Everything posts to the books automatically.">
      ${can('expenses', 'create') && html`<button class="btn primary" onClick=${() => setModal({})}><${Icon} name="plus" size=${16} /> Expense</button>`}
    <//>
    <div class="grid-main" style=${{ marginBottom: '16px' }}>
      <div class="kpis" style=${{ marginBottom: 0 }}><div class="kpi navy"><span>Total ${month ? new Date(month + '-01').toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }) : ''}</span><b>${aed(sum(all, (e) => e.total), { dp: 0 })}</b><small>incl. ${aed(sum(all, (e) => e.vat), { dp: 0 })} VAT</small></div>
        <div class="kpi"><span>On customer jobs</span><b>${aed(sum(all.filter((e) => e.deal_id), (e) => e.total), { dp: 0 })}</b><small>${all.filter((e) => e.deal_id).length} expenses</small></div>
        <div class="kpi"><span>Overheads</span><b>${aed(sum(all.filter((e) => !e.deal_id), (e) => e.total), { dp: 0 })}</b></div></div>
      <div class="card"><h3 style=${{ marginBottom: '8px' }}>By category</h3>${Object.keys(byCat).length ? html`<${HBars} rows=${Object.entries(byCat).sort((a, b) => b[1] - a[1]).map(([label, value]) => ({ label, value }))} fmt=${(v) => aed(v, { dp: 0 })} />` : html`<p class="muted small">No expenses this month.</p>`}</div>
    </div>
    <div class="toolbar"><input type="month" value=${month} onInput=${(e) => setMonth(e.target.value)} style=${{ width: 'auto' }} />
      <${SearchBox} value=${q} onInput=${setQ} placeholder="Description, payee, job…" />
      <${Select} value=${cat} onChange=${setCat} options=${accts.expense_categories.map((a) => [String(a.id), a.name])} placeholder="All categories" /></div>
    ${!data ? html`<${Spinner} />` : !rows.length ? html`<div class="card"><${Empty} icon="wallet" title="No expenses" /></div>`
      : html`<div class="card flush"><div class="table-wrap"><table class="table table-cards"><thead><tr><th>Date</th><th>Expense</th><th class="hide-m">Category</th><th class="hide-m">Job</th><th class="hide-m">Paid from</th><th class="r">Amount</th></tr></thead>
        <tbody>${rows.map((e) => html`<tr class="click" onClick=${() => setModal(e)}><td class="nowrap">${fmtDate(e.date)}<span class="sub">${e.number}</span></td>
          <td class="title">${e.description || e.category}<span class="sub">${e.vendor_name || e.payee || ''}${e.receipts ? ` · 📎 ${e.receipts}` : ''}</span></td><td class="hide-m">${e.category}</td>
          <td class="hide-m">${e.deal_code ? html`<a class="link" href=${`#/deals/${e.deal_id}`} onClick=${(ev) => ev.stopPropagation()}>${e.deal_code}</a>` : html`<span class="faint">—</span>`}${e.job_number && html`<span class="sub">${e.job_number}</span>`}</td>
          <td class="hide-m">${e.paid_from_name}</td><td class="r strong">${aed(e.total)}${e.vat > 0 && html`<span class="sub">VAT ${aed(e.vat)}</span>`}</td></tr>`)}</tbody>
        <tfoot><tr><td colspan="5">Total</td><td class="r">${aed(sum(rows, (e) => e.total))}</td></tr></tfoot></table></div></div>`}
    ${modal && html`<${ExpenseModal} expense=${modal.id ? modal : null} initial=${modal.id ? {} : modal} onClose=${() => setModal(null)} onSaved=${reload} />`}
  </div>`;
}

export function ExpenseModal({ expense, initial = {}, onClose, onSaved }) {
  const vendors = useVendors();
  const [accts, setAccts] = useState({ expense_categories: [], money: [] });
  const [deals, setDeals] = useState([]);
  const [f, setF] = useState(expense ? { ...expense } : { date: todayISO(), account_id: '', amount: '', vat: 0, paid_from: '', method: 'cash', vendor_id: null, payee: '', description: '', reference: '', deal_id: null, job_id: null, ...initial });
  const [withVat, setWithVat] = useState(expense ? expense.vat > 0 : false);
  const [saved, setSaved] = useState(expense);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api('/accounts').then((d) => { setAccts(d); if (!f.account_id && d.expense_categories[0]) setF((x) => ({ ...x, account_id: x.account_id || d.expense_categories.find((c) => /transport/i.test(c.name))?.id || d.expense_categories[0].id })); }).catch(() => {});
    if (can('crm')) api('/deals').then((d) => setDeals(d.deals.filter((x) => x.stage !== 'lost'))).catch(() => {});
  }, []);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const vat = withVat ? r2((Number(f.amount) || 0) * 0.05) : 0;
  async function save(e) {
    e.preventDefault(); setBusy(true); setError('');
    const body = { ...f, vat, paid_from: f.paid_from || undefined };
    try {
      const r = saved ? await api(`/expenses/${saved.id}`, { method: 'PATCH', body }) : await api('/expenses', { method: 'POST', body });
      toast(saved ? 'Saved' : `Expense ${r.expense.number} added — attach the receipt below`);
      setSaved(r.expense); onSaved?.();
      if (saved) onClose();
    } catch (err) { setError(err.message); }
    setBusy(false);
  }
  const editable = saved ? can('expenses', 'edit') : can('expenses', 'create');
  return html`<${Modal} title=${saved ? `Expense ${saved.number}` : 'New expense'} onClose=${onClose} wide>
    <form class="form" onSubmit=${save}>
      <div class="form-grid">
        <${Field} label="Date"><input type="date" required value=${f.date} disabled=${!editable} onInput=${set('date')} /><//>
        <${Field} label="Category"><select required value=${f.account_id} disabled=${!editable} onChange=${set('account_id')}>${accts.expense_categories.map((a) => html`<option value=${a.id}>${a.name}</option>`)}</select><//>
        <${Field} label="Amount before VAT (AED)"><input type="number" step="0.01" required value=${f.amount} disabled=${!editable} onInput=${set('amount')} /><//>
        <${Field} label=${`VAT ${withVat ? aed(vat) : ''}`}><label class="check" style=${{ paddingTop: '8px' }}><input type="checkbox" checked=${withVat} disabled=${!editable} onChange=${(e) => setWithVat(e.target.checked)} /> Includes 5% VAT (tax invoice)</label><//>
        <${Field} label="Paid with"><select value=${f.method} disabled=${!editable} onChange=${(e) => setF({ ...f, method: e.target.value, paid_from: '' })}>${['cash', 'bank', 'card', 'cheque'].map((m) => html`<option value=${m}>${METHOD[m]}</option>`)}</select><//>
        <${Field} label="From account"><select value=${f.paid_from || ''} disabled=${!editable} onChange=${set('paid_from')}><option value="">Default</option>${accts.money.map((a) => html`<option value=${a.id}>${a.name}</option>`)}</select><//>
        <${Field} label="Supplier"><select value=${f.vendor_id || ''} disabled=${!editable} onChange=${(e) => setF({ ...f, vendor_id: Number(e.target.value) || null })}><option value="">— or type a payee →</option>${vendors.map((v) => html`<option value=${v.id}>${v.name}</option>`)}</select><//>
        ${!f.vendor_id && html`<${Field} label="Payee"><input value=${f.payee} disabled=${!editable} onInput=${set('payee')} placeholder="e.g. ENOC, labour supplier" /><//>`}
      </div>
      <${Field} label="Description"><input value=${f.description} disabled=${!editable} onInput=${set('description')} placeholder="e.g. Installation labour — Al Noor Towers" /><//>
      <div class="form-grid two">
        ${deals.length > 0 && html`<${Field} label="For a customer job (deal)" hint="Counts towards that job's cost & profit"><select value=${f.deal_id || ''} disabled=${!editable} onChange=${(e) => setF({ ...f, deal_id: Number(e.target.value) || null })}><option value="">— Overhead (not a job) —</option>${deals.map((d) => html`<option value=${d.id}>${d.code} · ${d.title}</option>`)}</select><//>`}
        <${Field} label="Reference"><input value=${f.reference} disabled=${!editable} onInput=${set('reference')} placeholder="Receipt / bill number" /><//>
      </div>
      <p class="small muted" style=${{ margin: 0 }}>Total ${aed((Number(f.amount) || 0) + vat)}</p>
      <${ErrorText} error=${error} />
      ${editable && html`<div class="form-actions">${saved && can('expenses', 'delete') && html`<button type="button" class="btn danger-ghost" onClick=${() => confirm('Delete this expense?') && api(`/expenses/${saved.id}`, { method: 'DELETE' }).then(() => { onSaved?.(); onClose(); })}>Delete</button>`}<span class="spacer" />
        <button type="button" class="btn ghost" onClick=${onClose}>${saved ? 'Close' : 'Cancel'}</button><button class="btn primary" disabled=${busy}>${saved ? 'Save' : 'Add expense'}</button></div>`}
      ${saved && html`<div><h3 style=${{ margin: '6px 0 8px' }}>Receipt</h3><${Files} entity="expense" id=${saved.id} kinds=${[['receipt', 'Receipt'], ['other', 'Other']]} canAdd=${can('expenses', 'create')} compact /></div>`}
    </form>
  <//>`;
}
