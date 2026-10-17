import { useState, useMemo, useRef } from 'preact/hooks';
import { html, api, upload, shrinkImage, useLoad, can, go, toast, CATEGORIES, UNITS, aed, qty, fmtDate, todayISO } from '../lib.js';
import { Icon, Badge, Modal, Field, ErrorText, Spinner, Empty, PageHead, SearchBox, Chips, useAction } from '../ui.js';
import { specLine } from './lines.js';

export function Products() {
  const [cat, setCat] = useState('');
  const [q, setQ] = useState('');
  const [low, setLow] = useState(false);
  const [adding, setAdding] = useState(false);
  const [data] = useLoad('/products?active=all', ['stock']);
  const costs = can('see_costs');
  const all = data?.products || [];
  const rows = useMemo(() => all.filter((p) => (!cat || p.category === cat) && (!low || (p.track_stock && p.min_stock > 0 && p.stock < p.min_stock))
    && (!q || [p.name, p.code, p.brand].some((v) => String(v || '').toLowerCase().includes(q.toLowerCase())))), [all, cat, q, low]);
  const value = all.filter((p) => p.track_stock).reduce((s, p) => s + Math.max(0, p.stock) * (p.avg_cost || 0), 0);
  const lows = all.filter((p) => p.active && p.track_stock && p.min_stock > 0 && p.stock < p.min_stock).length;
  return html`<div class="page wide">
    <${PageHead} eyebrow="Operations" title="Products & stock" sub="Films, materials and services with prices. Stock in SQM updates with every purchase and installation.">
      ${can('inventory', 'create') && html`<button class="btn primary" onClick=${() => setAdding(true)}><${Icon} name="plus" size=${16} /> Product</button>`}
    <//>
    <div class="kpis"><div class="kpi navy"><span>Products</span><b>${all.filter((p) => p.active).length}</b><small>${Object.keys(CATEGORIES).filter((c) => all.some((p) => p.category === c)).length} categories</small></div>
      ${costs && html`<div class="kpi"><span>Stock value</span><b>${aed(value, { dp: 0 })}</b><small>at average cost</small></div>`}
      <div class="kpi ${lows ? 'warn' : ''}"><span>Low stock</span><b>${lows}</b><small>${lows ? 'below minimum' : 'all good'}</small></div>
      <div class="kpi"><span>Film in stock</span><b>${qty(all.filter((p) => p.track_stock && /sqm/i.test(p.unit)).reduce((s, p) => s + Math.max(0, p.stock), 0))} SQM</b></div></div>
    <div class="toolbar"><${SearchBox} value=${q} onInput=${setQ} placeholder="Name, code, brand…" />
      <${Chips} value=${cat} onChange=${setCat} options=${[['', 'All'], ...Object.entries(CATEGORIES).filter(([k]) => all.some((p) => p.category === k)).map(([k, v]) => [k, v.replace(/ film$/, '')])]} />
      <label class="check small"><input type="checkbox" checked=${low} onChange=${(e) => setLow(e.target.checked)} /> Low stock only</label></div>
    ${!data ? html`<${Spinner} />` : !rows.length ? html`<div class="card"><${Empty} icon="box" title="No products" /></div>`
      : html`<div class="card flush"><div class="table-wrap"><table class="table table-cards"><thead><tr><th>Product</th><th class="hide-m">Specs</th><th class="r">Selling</th>${costs && html`<th class="r hide-m">Avg cost</th>`}<th class="r">Stock</th></tr></thead>
        <tbody>${rows.map((p) => html`<tr class="click" onClick=${() => go(`products/${p.id}`)} style=${{ opacity: p.active ? 1 : 0.5 }}>
          <td class="title"><span class="person">${p.image ? html`<img class="prod-thumb" src=${p.image} alt="" />` : html`<span class="prod-thumb" style=${{ display: 'grid', placeItems: 'center' }}>🪟</span>`}<span>${p.name}<small>${p.code} · ${p.brand || p.category_label}${p.active ? '' : ' · archived'}</small></span></span></td>
          <td class="hide-m small muted">${specLine(p) || '—'}</td><td class="r">${aed(p.sell_price)}<span class="sub">per ${p.unit}</span></td>
          ${costs && html`<td class="r hide-m">${aed(p.avg_cost)}</td>`}
          <td class="r">${p.track_stock ? html`<b class=${p.min_stock > 0 && p.stock < p.min_stock ? 'red' : ''}>${qty(p.stock)}</b> <span class="small muted">${p.unit}</span>` : html`<span class="faint">—</span>`}</td></tr>`)}</tbody></table></div></div>`}
    ${adding && html`<${ProductForm} onClose=${() => setAdding(false)} onSaved=${(p) => go(`products/${p.id}`)} />`}
  </div>`;
}

export function ProductForm({ product, onClose, onSaved }) {
  const costs = can('see_costs');
  const [f, setF] = useState(product ? { ...product } : { code: '', name: '', category: 'solar', brand: 'Madico', vlt: '', heat_rejection: '', uv_block: '', thickness: '', warranty_years: 5, unit: 'SQM', sell_price: '', cost_price: '', track_stock: true, min_stock: '', opening_stock: '', description: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const film = !['service', 'material'].includes(f.category);
  async function save(e) {
    e.preventDefault(); setBusy(true); setError('');
    try { const r = product ? await api(`/products/${product.id}`, { method: 'PATCH', body: f }) : await api('/products', { method: 'POST', body: f }); onSaved?.(r.product); onClose(); } catch (err) { setError(err.message); }
    setBusy(false);
  }
  return html`<${Modal} title=${product ? 'Edit product' : 'New product'} onClose=${onClose} wide>
    <form class="form" onSubmit=${save}>
      <div class="form-grid">
        <${Field} label="Name *"><input required value=${f.name} onInput=${set('name')} placeholder="e.g. Solar Control Film · Smoke 35%" /><//>
        <${Field} label="Item code" hint="Leave empty to number automatically"><input value=${f.code} onInput=${set('code')} placeholder="FLM-S35" /><//>
        <${Field} label="Category"><select value=${f.category} onChange=${set('category')}>${Object.entries(CATEGORIES).map(([k, v]) => html`<option value=${k}>${v}</option>`)}</select><//>
        <${Field} label="Brand"><input value=${f.brand} onInput=${set('brand')} /><//>
      </div>
      ${film && html`<div class="form-grid"><${Field} label="VLT %"><input type="number" step="0.1" value=${f.vlt ?? ''} onInput=${set('vlt')} /><//><${Field} label="Heat rejection %"><input type="number" step="0.1" value=${f.heat_rejection ?? ''} onInput=${set('heat_rejection')} /><//>
        <${Field} label="UV block %"><input type="number" step="0.1" value=${f.uv_block ?? ''} onInput=${set('uv_block')} /><//><${Field} label="Thickness"><input value=${f.thickness} onInput=${set('thickness')} placeholder="e.g. 8 mil" /><//>
        <${Field} label="Warranty (years)"><input type="number" min="0" value=${f.warranty_years} onInput=${set('warranty_years')} /><//></div>`}
      <div class="form-grid">
        <${Field} label="Unit"><select value=${f.unit} onChange=${set('unit')}>${UNITS.map((u) => html`<option>${u}</option>`)}</select><//>
        <${Field} label="Selling price (AED / unit)"><input type="number" step="0.01" value=${f.sell_price} onInput=${set('sell_price')} /><//>
        ${costs && html`<${Field} label="Purchase price (AED / unit)"><input type="number" step="0.01" value=${f.cost_price} onInput=${set('cost_price')} /><//>`}
        <${Field} label="Low-stock alert below"><input type="number" step="0.01" value=${f.min_stock} onInput=${set('min_stock')} disabled=${!f.track_stock} /><//>
        ${!product && f.track_stock && html`<${Field} label="Opening stock"><input type="number" step="0.01" value=${f.opening_stock} onInput=${set('opening_stock')} /><//>`}
      </div>
      <label class="check"><input type="checkbox" checked=${!!f.track_stock} onChange=${set('track_stock')} /> Keep stock of this item</label>
      <${Field} label="Description (shown on quotations)"><textarea rows="3" value=${f.description} onInput=${set('description')} placeholder="Up to 60% heat rejection, 99% UV block. Ideal for sun-facing living areas." /><//>
      ${product && html`<label class="check"><input type="checkbox" checked=${!!f.active} onChange=${set('active')} /> Active (shown when pricing)</label>`}
      <${ErrorText} error=${error} />
      <div class="form-actions"><button type="button" class="btn ghost" onClick=${onClose}>Cancel</button><button class="btn primary" disabled=${busy}>Save</button></div>
    </form>
  <//>`;
}

export function ProductView({ id }) {
  const [data, reload] = useLoad(`/products/${id}`, ['stock']);
  const [modal, setModal] = useState(null);
  const [busy, run] = useAction();
  const input = useRef();
  if (!data) return html`<div class="page"><${Spinner} /></div>`;
  const p = data.product;
  const costs = can('see_costs');
  async function setImage(file) {
    const r = await run(async () => upload(`/files?entity=product&id=${p.id}&kind=image`, await shrinkImage(file, 1200), { name: file.name }));
    if (r) await run(() => api(`/products/${p.id}`, { method: 'PATCH', body: { image_file_id: r.file.id } }).then(reload), 'Image updated');
  }
  const KIND = { opening: 'Opening stock', purchase: 'Purchase received', job: 'Used on installation', sale: 'Sold (invoice)', adjustment: 'Adjustment', return: 'Return' };
  return html`<div class="page">
    <a class="back-link" href="#/products"><${Icon} name="back" size=${15} /> Products & stock</a>
    <div class="record-head"><div class="row" style=${{ alignItems: 'flex-start', gap: '16px' }}>
        <div style=${{ position: 'relative' }}>${p.image ? html`<img class="prod-thumb big" src=${p.image} alt="" />` : html`<span class="prod-thumb big" style=${{ display: 'grid', placeItems: 'center', fontSize: '26px' }}>🪟</span>`}
          ${can('inventory', 'edit') && html`<button class="btn ghost small" style=${{ marginTop: '6px', width: '64px', padding: 0 }} onClick=${() => input.current.click()}>Photo</button><input ref=${input} type="file" accept="image/*" hidden onChange=${(e) => e.target.files[0] && setImage(e.target.files[0])} />`}</div>
        <div><p class="eyebrow">${p.code} · ${p.category_label}</p><h1>${p.name}</h1><div class="sub">${p.brand && html`<span>${p.brand}</span>`}<span>${specLine(p)}</span>${!p.active && html`<${Badge}>Archived<//>`}</div></div></div>
      <div class="btn-row">${can('inventory', 'edit') && html`<button class="btn ghost" onClick=${() => setModal('edit')}><${Icon} name="edit" size=${15} /> Edit</button>${p.track_stock && html`<button class="btn primary" onClick=${() => setModal('adjust')}>Adjust stock</button>`}`}</div></div>
    <div class="money-strip"><div><span>Stock quantity</span><b class=${p.min_stock > 0 && p.stock < p.min_stock ? 'red' : ''}>${p.track_stock ? `${qty(p.stock)} ${p.unit}` : 'Not stocked'}</b></div>
      <div><span>Selling price</span><b>${aed(p.sell_price)} / ${p.unit}</b></div>${costs && html`<div><span>Purchase price</span><b>${aed(p.cost_price)}</b></div><div><span>Average cost</span><b>${aed(p.avg_cost)}</b></div>
      <div><span>Margin</span><b class="green">${p.sell_price ? Math.round(((p.sell_price - p.avg_cost) / p.sell_price) * 100) : 0}%</b></div>`}<div><span>Warranty</span><b>${p.warranty_years ? `${p.warranty_years} years` : '—'}</b></div></div>
    ${p.description && html`<div class="card" style=${{ marginBottom: '16px' }}><p style=${{ margin: 0, whiteSpace: 'pre-wrap' }}>${p.description}</p></div>`}
    ${p.track_stock && can('inventory') && html`<div class="card flush"><div class="card-head" style=${{ padding: '16px 18px 0' }}><h2>Stock update history</h2><span class="muted small">Every purchase and installation updates stock automatically</span></div>
      <div class="table-wrap"><table class="table"><thead><tr><th>Date</th><th>What</th><th class="r">Stock</th>${costs && html`<th class="r">Cost</th>`}<th>Reference</th></tr></thead>
        <tbody>${data.moves.map((m) => html`<tr><td class="nowrap">${fmtDate(m.date)}</td><td>${KIND[m.kind] || m.kind}${m.note && html`<span class="sub">${m.note}</span>`}</td>
          <td class="r strong ${m.qty < 0 ? 'red' : 'green'}">${m.qty > 0 ? '+' : '−'}${qty(Math.abs(m.qty))}</td>${costs && html`<td class="r">${m.qty > 0 ? aed(m.unit_cost) : '—'}</td>`}
          <td>${m.ref ? m.ref_type === 'job' ? html`<a class="link" href=${`#/jobs/${m.ref.id}`}>${m.ref.number}</a>` : m.ref_type === 'invoice' ? html`<a class="link" href=${`#/invoices/${m.ref.id}`}>${m.ref.number}</a>` : m.ref_type === 'grn' ? html`<a class="link" href=${`#/purchases/${m.ref.po_id}`}>${m.ref.po_number}</a>` : '' : html`<span class="faint">${m.user_name || ''}</span>`}</td></tr>`)}
        ${!data.moves.length && html`<tr><td colspan="5" class="muted">No movements yet.</td></tr>`}</tbody></table></div></div>`}
    ${can('inventory', 'delete') && html`<button class="btn danger-ghost small" style=${{ marginTop: '14px' }} disabled=${busy} onClick=${() => confirm('Delete (or archive if used) this product?') && run(() => api(`/products/${p.id}`, { method: 'DELETE' }).then((r) => (r.archived ? reload() : go('products'))), 'Done')}><${Icon} name="trash" size=${14} /> Delete product</button>`}
    ${modal === 'edit' && html`<${ProductForm} product=${p} onClose=${() => setModal(null)} onSaved=${reload} />`}
    ${modal === 'adjust' && html`<${AdjustModal} p=${p} onClose=${() => setModal(null)} onSaved=${reload} />`}
  </div>`;
}
function AdjustModal({ p, onClose, onSaved }) {
  const [f, setF] = useState({ qty: '', unit_cost: p.avg_cost || p.cost_price || '', note: '', date: todayISO(), kind: 'adjustment' });
  const [error, setError] = useState('');
  async function save(e) {
    e.preventDefault();
    try { await api(`/products/${p.id}/adjust`, { method: 'POST', body: f }); toast('Stock updated'); onSaved(); onClose(); } catch (err) { setError(err.message); }
  }
  return html`<${Modal} title=${`Adjust stock — ${p.name}`} onClose=${onClose}>
    <form class="form" onSubmit=${save}><p class="muted small" style=${{ margin: 0 }}>Now: ${qty(p.stock)} ${p.unit}. Use + to add (found / returned) or − to remove (damaged, count difference). Purchases and installations update stock by themselves.</p>
      <div class="form-grid two"><${Field} label="Change (+/−)"><input type="number" step="0.01" required value=${f.qty} onInput=${(e) => setF({ ...f, qty: e.target.value })} placeholder="-5.5" /><//>
        ${Number(f.qty) > 0 && can('see_costs') && html`<${Field} label="Unit cost"><input type="number" step="0.01" value=${f.unit_cost} onInput=${(e) => setF({ ...f, unit_cost: e.target.value })} /><//>`}
        <${Field} label="Date"><input type="date" value=${f.date} onInput=${(e) => setF({ ...f, date: e.target.value })} /><//></div>
      <${Field} label="Reason *"><input required value=${f.note} onInput=${(e) => setF({ ...f, note: e.target.value })} placeholder="e.g. Monthly stock count, damaged roll end" /><//>
      <${ErrorText} error=${error} /><div class="form-actions"><button type="button" class="btn ghost" onClick=${onClose}>Cancel</button><button class="btn primary">Save</button></div></form>
  <//>`;
}
