// Line items editor — the same grid for the deal's pricing sheet, quotations, invoices and purchase orders.
// Selling price ↔ margin % ↔ purchase price stay in step; totals and profit update live.
import { html, money, qty, r2, UNITS, CATEGORIES } from '../lib.js';
import { Icon, useProducts } from '../ui.js';

export const specLine = (p) => [
  p.vlt != null && p.vlt !== '' && `VLT ${qty(p.vlt)}%`, p.heat_rejection != null && p.heat_rejection !== '' && `Heat rejection up to ${qty(p.heat_rejection)}%`,
  p.uv_block != null && p.uv_block !== '' && `UV block ${qty(p.uv_block)}%`, p.thickness, p.warranty_years ? `${p.warranty_years}-year warranty` : null,
].filter(Boolean).join(' · ');

export function lineTotals(items, discount = 0, vatRate = 5, priceKey = 'price') {
  const lines = items.filter((i) => i.kind !== 'header');
  const subtotal = r2(lines.reduce((s, i) => s + (Number(i.qty) || 0) * (Number(i[priceKey]) || 0), 0));
  const cost = r2(lines.reduce((s, i) => s + (Number(i.qty) || 0) * (Number(i.cost) || 0), 0));
  const disc = Math.min(Math.max(Number(discount) || 0, 0), Math.max(subtotal, 0));
  const vat = r2((subtotal - disc) * (Number(vatRate) || 0) / 100);
  return { subtotal, discount: disc, vat, total: r2(subtotal - disc + vat), cost, profit: r2(subtotal - disc - cost) };
}
const margin = (price, cost) => (Number(price) > 0 ? Math.round(((price - cost) / price) * 1000) / 10 : 0);
export const blankLine = (unit = 'SQM') => ({ kind: 'item', product_id: null, name: '', description: '', qty: 1, unit, price: 0, cost: 0, vendor_id: null });

export function LineEditor({ items, onChange, costs = false, vendors = null, priceKey = 'price', priceLabel = 'Selling price', readOnly = false }) {
  const products = useProducts();
  const set = (i, patch) => onChange(items.map((it, j) => (j === i ? { ...it, ...patch } : it)));
  const move = (i, d) => { const n = [...items]; const [x] = n.splice(i, 1); n.splice(Math.max(0, Math.min(n.length, i + d)), 0, x); onChange(n); };
  const pickProduct = (i, id) => {
    const p = products.find((x) => x.id === Number(id));
    if (!p) return set(i, { product_id: null });
    set(i, { product_id: p.id, name: p.name, description: items[i].description || specLine(p), unit: p.unit, ...(priceKey === 'price' ? { price: p.sell_price } : {}), ...(costs && p.cost_price !== undefined ? { cost: p.avg_cost || p.cost_price } : {}) });
  };
  const groups = {};
  for (const p of products) (groups[p.category_label || CATEGORIES[p.category]] ||= []).push(p);
  const showCost = costs && priceKey === 'price';
  const cols = 6 + (showCost ? 3 : 0) + (vendors ? 1 : 0);
  return html`<div class="table-wrap"><table class="lines">
    <thead><tr><th style=${{ width: '28px' }}></th><th>Item / description</th><th class="w-qty">Qty</th><th class="w-unit">Unit</th>
      <th class="w-money">${priceLabel}</th>${showCost && html`<th class="w-pct">Margin</th><th class="w-money">Purchase price</th>`}${vendors && html`<th class="w-vendor">Supplier</th>`}
      <th class="w-money" style=${{ textAlign: 'right' }}>Total</th>${showCost && html`<th class="w-money" style=${{ textAlign: 'right' }}>Profit</th>`}<th class="w-act"></th></tr></thead>
    <tbody>${items.map((it, i) => it.kind === 'header'
    ? html`<tr class="hd"><td class="drag-handle">§</td><td colspan=${cols - 2}><input value=${it.name} disabled=${readOnly} placeholder="Section title, e.g. Ground floor — living & dining" onInput=${(e) => set(i, { name: e.target.value })} /></td>
        <td>${!readOnly && html`<${RowActions} i=${i} n=${items.length} move=${move} remove=${() => onChange(items.filter((_, j) => j !== i))} />`}</td></tr>`
    : html`<tr>
        <td class="drag-handle">${items.slice(0, i + 1).filter((x) => x.kind !== 'header').length}</td>
        <td style=${{ minWidth: '260px' }}>
          <select value=${it.product_id || ''} disabled=${readOnly} onChange=${(e) => pickProduct(i, e.target.value)} style=${{ marginBottom: '4px' }}>
            <option value="">— Custom item —</option>
            ${Object.entries(groups).map(([g, ps]) => html`<optgroup label=${g}>${ps.map((p) => html`<option value=${p.id} selected=${p.id === it.product_id}>${p.name}</option>`)}</optgroup>`)}
          </select>
          <input value=${it.name} disabled=${readOnly} placeholder="Item name" onInput=${(e) => set(i, { name: e.target.value })} style=${{ fontWeight: 600, marginBottom: '4px' }} />
          <textarea rows="1" value=${it.description} disabled=${readOnly} placeholder="Description, location, specs" onInput=${(e) => set(i, { description: e.target.value })} />
        </td>
        <td><input type="number" step="0.01" value=${it.qty} disabled=${readOnly} onInput=${(e) => set(i, { qty: e.target.value })} /></td>
        <td><select value=${it.unit} disabled=${readOnly} onChange=${(e) => set(i, { unit: e.target.value })}>${[...new Set([it.unit, ...UNITS])].filter(Boolean).map((u) => html`<option>${u}</option>`)}</select></td>
        <td><input type="number" step="0.01" value=${it[priceKey]} disabled=${readOnly} onInput=${(e) => set(i, { [priceKey]: e.target.value })} /></td>
        ${showCost && html`<td><input type="number" step="0.1" value=${margin(it.price, it.cost)} disabled=${readOnly || !(Number(it.cost) > 0)} title="Margin on the selling price"
            onChange=${(e) => { const m = Math.min(95, Number(e.target.value) || 0); set(i, { price: r2(Number(it.cost) / (1 - m / 100)) }); }} /></td>
          <td><input type="number" step="0.01" value=${it.cost} disabled=${readOnly} onInput=${(e) => set(i, { cost: e.target.value })} /></td>`}
        ${vendors && html`<td><select value=${it.vendor_id || ''} disabled=${readOnly} onChange=${(e) => set(i, { vendor_id: Number(e.target.value) || null })}><option value="">—</option>${vendors.map((v) => html`<option value=${v.id} selected=${v.id === it.vendor_id}>${v.name}</option>`)}</select></td>`}
        <td class="calc">${money((Number(it.qty) || 0) * (Number(it[priceKey]) || 0))}</td>
        ${showCost && html`<td class="calc ${(it.price - it.cost) * it.qty >= 0 ? 'profit' : 'loss'}">${money((Number(it.qty) || 0) * ((Number(it.price) || 0) - (Number(it.cost) || 0)))}</td>`}
        <td>${!readOnly && html`<${RowActions} i=${i} n=${items.length} move=${move} remove=${() => onChange(items.filter((_, j) => j !== i))} copy=${() => { const n = [...items]; n.splice(i + 1, 0, { ...it, id: undefined }); onChange(n); }} />`}</td>
      </tr>`)}</tbody></table></div>
    ${!readOnly && html`<div class="btn-row" style=${{ marginTop: '10px' }}>
      <button type="button" class="btn ghost small" onClick=${() => onChange([...items, blankLine()])}><${Icon} name="plus" size=${14} /> Add item</button>
      <button type="button" class="btn ghost small" onClick=${() => onChange([...items, { kind: 'header', name: '' }])}><${Icon} name="plus" size=${14} /> Add section</button></div>`}`;
}
function RowActions({ i, n, move, remove, copy }) {
  return html`<div style=${{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
    <div style=${{ display: 'flex' }}><button type="button" class="icon-btn small" disabled=${i === 0} onClick=${() => move(i, -1)} title="Move up">↑</button><button type="button" class="icon-btn small" disabled=${i === n - 1} onClick=${() => move(i, 1)} title="Move down">↓</button></div>
    <div style=${{ display: 'flex' }}>${copy && html`<button type="button" class="icon-btn small" onClick=${copy} title="Duplicate"><${Icon} name="copy" size=${13} /></button>`}<button type="button" class="icon-btn small" onClick=${remove} title="Remove"><${Icon} name="trash" size=${13} /></button></div>
  </div>`;
}
export function TotalsBox({ t, costs = false, discount, onDiscount, vatRate = 5, canDiscount = false }) {
  return html`<div class="totals-box">
    <div><span>Subtotal</span><b>AED ${money(t.subtotal)}</b></div>
    ${onDiscount ? html`<div><span>Discount (AED)</span>${canDiscount ? html`<input type="number" min="0" step="0.01" value=${discount} onInput=${(e) => onDiscount(e.target.value)} style=${{ width: '110px', padding: '4px 8px', textAlign: 'right' }} />` : html`<b>${money(t.discount)}</b>`}</div>`
      : t.discount ? html`<div><span>Discount</span><b>− ${money(t.discount)}</b></div>` : null}
    <div><span>VAT ${qty(vatRate)}%</span><b>AED ${money(t.vat)}</b></div>
    <div class="grand"><span>Total</span><span>AED ${money(t.total)}</span></div>
    ${costs && html`<div style=${{ marginTop: '6px' }}><span class="muted">Purchase cost</span><span>AED ${money(t.cost)}</span></div>
      <div class="profit"><span>Profit</span><span>AED ${money(t.profit)} · ${t.subtotal - t.discount > 0 ? Math.round((t.profit / (t.subtotal - t.discount)) * 1000) / 10 : 0}%</span></div>`}
  </div>`;
}
