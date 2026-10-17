import { useEffect, useRef, useState } from 'preact/hooks';
import {
  html, api, upload, shrinkImage, store, useStore, userById, initials, useEvent, toast, errToast, fmtDate, timeAgo, dueLabel,
  waLink, telLink, mapLink, fileSize, debounce, can, qty, aed,
} from './lib.js';

const P = {
  home: 'M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
  target: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 18a6 6 0 1 0 0-12 6 6 0 0 0 0 12zM12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
  users: 'M16 20v-1a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM22 20v-1a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8',
  user: 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  deal: 'M3 7h18v13H3zM8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 13h18',
  file: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M8 13h8M8 17h5',
  receipt: 'M5 2h14v20l-3-2-2 2-2-2-2 2-2-2-3 2zM9 7h6M9 11h6M9 15h4',
  truck: 'M1 4h14v12H1zM15 9h4l3 4v3h-7M5.5 21a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM18.5 21a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
  box: 'M21 8 12 3 3 8v8l9 5 9-5zM3 8l9 5 9-5M12 13v8',
  wallet: 'M20 7H5a2 2 0 0 1 0-4h13v4M3 5v14a2 2 0 0 0 2 2h15V7M16 14h.01',
  book: 'M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5zM4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5',
  tool: 'M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.6 2.6-2.4-.6-.6-2.4z',
  shield: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z',
  calendar: 'M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z',
  chart: 'M3 3v18h18M7 15l4-4 3 3 6-6',
  bars: 'M6 20V10M12 20V4M18 20v-7',
  chat: 'M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z',
  clock: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 6v6l4 2',
  gear: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  bell: 'M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0',
  plus: 'M12 5v14M5 12h14',
  x: 'M18 6 6 18M6 6l12 12',
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3',
  back: 'M19 12H5M12 19l-7-7 7-7',
  menu: 'M3 6h18M3 12h18M3 18h18',
  edit: 'M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z',
  trash: 'M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6',
  external: 'M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6',
  phone: 'M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z',
  mail: 'M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM22 6l-10 7L2 6',
  map: 'M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 1 1 18 0zM12 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  camera: 'M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2zM12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  upload: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12',
  download: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3',
  print: 'M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2M6 14h12v8H6z',
  send: 'M22 2 11 13M22 2l-7 20-4-9-9-4z',
  check: 'M20 6 9 17l-5-5',
  copy: 'M20 9h-9a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2v-9a2 2 0 0 0-2-2zM5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1',
  list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
  board: 'M4 3h4a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM11 3h4a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1h-4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM18 3h2a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-2a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z',
  logout: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9',
  link: 'M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7',
  paperclip: 'M21.4 11.1l-9.2 9.2a6 6 0 0 1-8.5-8.5l9.2-9.2a4 4 0 0 1 5.7 5.7l-9.2 9.2a2 2 0 0 1-2.8-2.8l8.5-8.5',
  ruler: 'M21.3 8.7 8.7 21.3a1 1 0 0 1-1.4 0l-4.6-4.6a1 1 0 0 1 0-1.4L15.3 2.7a1 1 0 0 1 1.4 0l4.6 4.6a1 1 0 0 1 0 1.4zM7.5 10.5l2 2M10.5 7.5l2 2M13.5 4.5l2 2M4.5 13.5l2 2',
  star: 'M12 2l3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z',
  more: 'M12 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM19 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM5 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2z',
  eye: 'M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  play: 'M6 4l14 8-14 8z',
  pin: 'M12 22s-7-6.2-7-12a7 7 0 1 1 14 0c0 5.8-7 12-7 12z',
  refresh: 'M23 4v6h-6M1 20v-6h6M3.5 9a9 9 0 0 1 14.8-3.4L23 10M1 14l4.7 4.4A9 9 0 0 0 20.5 15',
};
export function Icon({ name, size = 18, class: cls = '' }) {
  return html`<svg class="icon ${cls}" width=${size} height=${size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d=${P[name] || P.file} /></svg>`;
}
export const WaIcon = ({ size = 16 }) => html`<svg width=${size} height=${size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M17.5 14.4c-.3-.1-1.8-.9-2-1s-.5-.1-.7.1-.8 1-.9 1.2-.3.2-.6.1a8 8 0 0 1-2.4-1.5 9 9 0 0 1-1.7-2.1c-.2-.3 0-.5.1-.6l.4-.5.3-.5v-.5l-.9-2.2c-.2-.6-.5-.5-.7-.5h-.6a1.1 1.1 0 0 0-.8.4 3.4 3.4 0 0 0-1 2.5 6 6 0 0 0 1.2 3.1 13.4 13.4 0 0 0 5.2 4.6c.7.3 1.3.5 1.7.6a4.2 4.2 0 0 0 1.9.1 3.2 3.2 0 0 0 2.1-1.5 2.6 2.6 0 0 0 .2-1.5c-.1-.1-.3-.2-.6-.3zM12 21.8a9.9 9.9 0 0 1-5-1.4l-.4-.2-3.7 1 1-3.6-.2-.4a9.9 9.9 0 1 1 8.3 4.6zm8.4-18.3A11.8 11.8 0 0 0 1.7 17.8L0 24l6.3-1.7a11.8 11.8 0 0 0 5.7 1.5A11.9 11.9 0 0 0 20.4 3.5z"/></svg>`;

export function Avatar({ user, id, size = 30, showOnline = false }) {
  const { online } = store.get();
  const u = user || userById(id);
  const px = size + 'px';
  if (!u) return html`<span class="avatar empty" style=${{ width: px, height: px }} title="Not assigned"><${Icon} name="user" size=${Math.round(size * 0.5)} /></span>`;
  return html`<span class="avatar" title=${u.name} style=${{ width: px, height: px, background: u.color || '#00386b', fontSize: Math.round(size * 0.38) + 'px' }}>
    ${u.avatar ? html`<img src=${u.avatar} alt="" loading="lazy" />` : initials(u.name)}
    ${showOnline && html`<i class="presence ${online.has(u.id) ? 'on' : ''}" />`}
  </span>`;
}
export const AvatarStack = ({ ids = [], size = 24 }) => html`<span class="avatar-stack">${ids.slice(0, 5).map((id) => html`<${Avatar} id=${id} size=${size} />`)}</span>`;
export const Person = ({ id, sub }) => { const u = userById(id); return u ? html`<span class="person"><${Avatar} user=${u} size=${26} /><span>${u.name}${sub && html`<small>${sub}</small>`}</span></span>` : html`<span class="faint">—</span>`; };

export const Badge = ({ tone = 'grey', children }) => html`<span class="badge tone-${tone}">${children}</span>`;
export const StatusBadge = ({ map, status }) => (map[status] ? html`<${Badge} tone=${map[status].tone}>${map[status].label}<//>` : null);
export function Due({ date, prefix = '' }) {
  const d = dueLabel(date);
  if (!d) return null;
  return html`<span class="small" style=${{ color: d.tone === 'red' ? 'var(--red)' : d.tone === 'orange' ? 'var(--orange)' : 'var(--muted)' }}>${prefix}${d.label}</span>`;
}
export const Tags = ({ tags }) => {
  const list = String(tags || '').split(',').map((t) => t.trim()).filter(Boolean);
  return list.length ? html`<span class="tags">${list.map((t) => html`<span class="tag">${t}</span>`)}</span>` : null;
};

export function Modal({ title, onClose, children, wide, xwide, footer }) {
  const box = useRef();
  useEffect(() => { const el = box.current?.querySelector('[autofocus], input:not([type=hidden]):not([type=checkbox]), textarea, select'); el?.focus(); }, []);
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return html`<div class="overlay" onMouseDown=${(e) => e.target === e.currentTarget && onClose()}>
    <div class="modal ${wide ? 'wide' : ''} ${xwide ? 'xwide' : ''}" ref=${box} role="dialog" aria-modal="true" aria-label=${title}>
      <header class="modal-head"><h2>${title}</h2><button class="icon-btn" onClick=${onClose} aria-label="Close"><${Icon} name="x" /></button></header>
      <div class="modal-body">${children}</div>
      ${footer && html`<footer class="modal-foot">${footer}</footer>`}
    </div>
  </div>`;
}
export const Empty = ({ icon = 'file', title, children }) => html`<div class="empty"><span class="empty-icon"><${Icon} name=${icon} size=${22} /></span><strong>${title}</strong>${children && html`<p>${children}</p>`}</div>`;
export const Field = ({ label, hint, children, class: cls = '' }) => html`<label class="field ${cls}"><span class="field-label">${label}</span>${children}${hint && html`<span class="field-hint">${hint}</span>`}</label>`;
export const ErrorText = ({ error }) => (error ? html`<p class="error-text" role="alert">${error}</p>` : null);
export const Spinner = () => html`<div class="spinner" aria-label="Loading"></div>`;
export const PageHead = ({ eyebrow, title, sub, children }) => html`<div class="page-head"><div>${eyebrow && html`<p class="eyebrow">${eyebrow}</p>`}<h1>${title}</h1>${sub && html`<p>${sub}</p>`}</div><div class="btn-row">${children}</div></div>`;
export function Tabs({ tabs, value, onChange }) {
  return html`<div class="tabs" role="tablist">${tabs.filter(Boolean).map(([key, label, n]) => html`<button role="tab" class="tab ${value === key ? 'on' : ''}" onClick=${() => onChange(key)}>${label}${n ? html` <span class="n">${n}</span>` : ''}</button>`)}</div>`;
}
export function SearchBox({ value, onInput, placeholder = 'Search…' }) {
  return html`<label class="search-box"><${Icon} name="search" size=${16} /><input value=${value} placeholder=${placeholder} onInput=${(e) => onInput(e.target.value)} /></label>`;
}
export function Chips({ options, value, onChange }) {
  return html`<div class="chips">${options.filter(Boolean).map(([k, label, n]) => html`<button class="chip ${value === k ? 'on' : ''}" onClick=${() => onChange(k)}>${label}${n !== undefined && n !== null ? html`<span class="n">${n}</span>` : ''}</button>`)}</div>`;
}
export function Select({ value, onChange, options, placeholder, class: cls = '' }) {
  return html`<select class=${cls} value=${value ?? ''} onChange=${(e) => onChange(e.target.value)}>
    ${placeholder !== undefined && html`<option value="">${placeholder}</option>`}
    ${options.map((o) => (Array.isArray(o) ? html`<option value=${o[0]}>${o[1]}</option>` : html`<option value=${o}>${o}</option>`))}
  </select>`;
}
export function UserSelect({ value, onChange, filter, placeholder = 'Not assigned' }) {
  const { users } = useStore();
  const list = users.filter((u) => u.active && (!filter || filter(u)));
  return html`<select value=${value || ''} onChange=${(e) => onChange(Number(e.target.value) || null)}>
    <option value="">${placeholder}</option>${list.map((u) => html`<option value=${u.id}>${u.name}${u.title ? ` — ${u.title}` : ''}</option>`)}</select>`;
}
export function UserMulti({ value = [], onChange, filter }) {
  const { users } = useStore();
  const list = users.filter((u) => u.active && (!filter || filter(u)));
  const toggle = (id) => onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);
  return html`<div class="chips">${list.map((u) => html`<button type="button" class="chip ${value.includes(u.id) ? 'on' : ''}" onClick=${() => toggle(u.id)}><${Avatar} user=${u} size=${20} /> ${u.name}</button>`)}</div>`;
}

// Searchable customer picker (with "add new")
export function ContactPicker({ value, onChange, allowNew = true, autoFocus }) {
  const [q, setQ] = useState('');
  const [res, setRes] = useState([]);
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState(null);
  useEffect(() => { if (value && (!picked || picked.id !== value)) api(`/contacts/${value}`).then((d) => setPicked(d.contact)).catch(() => {}); if (!value) setPicked(null); }, [value]);
  const search = useRef(debounce((s) => api(`/contacts?q=${encodeURIComponent(s)}`).then((d) => setRes(d.contacts.slice(0, 12))).catch(() => {}), 220)).current;
  useEffect(() => { if (open) search(q); }, [q, open]);
  if (picked && value) return html`<div class="picked"><span class="grow"><b>${picked.name}</b> <span class="muted small">${picked.code}${picked.phone ? ` · ${picked.phone}` : ''}</span></span><button type="button" class="icon-btn small" onClick=${() => { onChange(null); setPicked(null); }} aria-label="Change"><${Icon} name="x" size=${15} /></button></div>`;
  return html`<div class="picker">
    <input value=${q} placeholder="Search customer by name or phone…" autoFocus=${autoFocus} onFocus=${() => setOpen(true)} onBlur=${() => setTimeout(() => setOpen(false), 180)} onInput=${(e) => setQ(e.target.value)} />
    ${open && html`<div class="picker-menu">
      ${res.map((c) => html`<button type="button" onMouseDown=${(e) => { e.preventDefault(); setPicked(c); onChange(c.id, c); setOpen(false); }}>${c.name}<small>${[c.code, c.phone, c.contact_person].filter(Boolean).join(' · ')}</small></button>`)}
      ${!res.length && html`<div class="muted small" style=${{ padding: '8px 10px' }}>${q ? 'No customer found' : 'Type to search'}</div>`}
      ${allowNew && q && html`<button type="button" onMouseDown=${(e) => { e.preventDefault(); onChange(null, { new: true, name: q }); setOpen(false); }}><b>+ Add “${q}” as a new customer</b></button>`}
    </div>`}
  </div>`;
}

// Products are loaded once and kept fresh
let productCache = null; let productWaiters = [];
export function loadProducts(force = false) {
  if (productCache && !force) return Promise.resolve(productCache);
  return new Promise((resolve) => {
    productWaiters.push(resolve);
    if (productWaiters.length > 1) return;
    api('/products').then((d) => { productCache = d.products; }).catch(() => { productCache = productCache || []; })
      .finally(() => { const w = productWaiters; productWaiters = []; w.forEach((r) => r(productCache)); });
  });
}
export function useProducts() {
  const [list, setList] = useState(productCache || []);
  useEffect(() => { loadProducts().then(setList); }, []);
  useEvent('stock', () => loadProducts(true).then(setList));
  return list;
}
export function ProductSelect({ value, onChange, placeholder = 'Pick a product / film…' }) {
  const products = useProducts();
  const groups = {};
  for (const p of products) (groups[p.category_label] ||= []).push(p);
  return html`<select value=${value || ''} onChange=${(e) => onChange(Number(e.target.value) || null, products.find((p) => p.id === Number(e.target.value)))}>
    <option value="">${placeholder}</option>
    ${Object.entries(groups).map(([g, ps]) => html`<optgroup label=${g}>${ps.map((p) => html`<option value=${p.id} selected=${p.id === value}>${p.name}${p.code ? ` (${p.code})` : ''}</option>`)}</optgroup>`)}
  </select>`;
}
let vendorCache = null;
export function useVendors() {
  const [list, setList] = useState(vendorCache || []);
  const load = () => (can('purchases') || can('see_costs') || can('expenses')) && api('/vendors').then((d) => { vendorCache = d.vendors; setList(d.vendors); }).catch(() => {});
  useEffect(() => { if (!vendorCache) load(); }, []);
  useEvent('vendors', load);
  return list;
}

// ---------- contact buttons ----------
export function ContactActions({ c, text = '' }) {
  if (!c) return null;
  const phone = c.phone || c.contact_phone;
  const wa = c.whatsapp || phone;
  const map = mapLink(c);
  return html`<div class="contact-actions">
    ${phone && html`<a href=${telLink(phone)}><${Icon} name="phone" size=${15} /> Call</a>`}
    ${wa && html`<a class="wa" href=${waLink(wa, text)} target="_blank" rel="noopener"><${WaIcon} size=${15} /> WhatsApp</a>`}
    ${c.email && html`<a href=${`mailto:${c.email}`}><${Icon} name="mail" size=${15} /> Email</a>`}
    ${map && html`<a href=${map} target="_blank" rel="noopener"><${Icon} name="map" size=${15} /> Map</a>`}
  </div>`;
}

// ---------- timeline (history of a record) ----------
const TL_ICON = { note: '📝', call: '📞', whatsapp: '💬', email: '✉️', meeting: '🤝', site_visit: '📍', stage: '➜', system: '•', form: '📐', document: '📄', payment: '💰' };
export function Timeline({ items }) {
  if (!items?.length) return html`<p class="muted small">Nothing here yet.</p>`;
  return html`<ul class="tl">${items.map((t) => {
    let data = null; try { data = t.data ? JSON.parse(t.data) : null; } catch {}
    return html`<li class="k-${t.kind}"><span class="tl-ico">${TL_ICON[t.kind] || '•'}</span><div class="tl-body">
      <span class="who">${t.user_name || 'System'} · ${timeAgo(t.created_at)}</span>
      <p>${t.body}</p>
      ${data?.rows && html`<table class="table compact form-rows"><thead><tr><th>Location</th><th class="r">L × W</th><th class="r">Qty</th><th class="r">SQM</th></tr></thead>
        <tbody>${data.rows.map((r) => html`<tr><td>${r.location || '—'}</td><td class="r">${qty(r.length)} × ${qty(r.width)} ${r.unit}</td><td class="r">${r.qty}</td><td class="r">${qty(r.sqm)}</td></tr>`)}</tbody></table>`}
    </div></li>`;
  })}</ul>`;
}
export function NoteComposer({ onSubmit, kinds = ['note', 'call', 'whatsapp', 'email', 'meeting', 'site_visit'], followUp = true, placeholder = 'Add a note, or log a call / WhatsApp…' }) {
  const [body, setBody] = useState('');
  const [kind, setKind] = useState(kinds[0]);
  const [next, setNext] = useState('');
  const [busy, setBusy] = useState(false);
  const label = { note: 'Note', call: '📞 Call', whatsapp: '💬 WhatsApp', email: '✉️ Email', meeting: '🤝 Meeting', site_visit: '📍 Site visit' };
  async function send() {
    if (!body.trim()) return;
    setBusy(true);
    try { await onSubmit({ body, kind, next_follow_up: next || undefined }); setBody(''); setNext(''); } catch (e) { errToast(e); }
    setBusy(false);
  }
  return html`<div class="composer-box">
    <textarea value=${body} placeholder=${placeholder} onInput=${(e) => setBody(e.target.value)} onKeyDown=${(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) send(); }} />
    <div class="bar"><span class="chips kinds">${kinds.map((k) => html`<button type="button" class=${kind === k ? 'on' : ''} onClick=${() => setKind(k)}>${label[k]}</button>`)}</span>
      <span class="spacer" />
      ${followUp && html`<label class="small muted row" style=${{ gap: '6px' }}>Next follow-up <input type="date" value=${next} onInput=${(e) => setNext(e.target.value)} style=${{ width: '150px', padding: '5px 8px' }} /></label>`}
      <button class="btn primary small" disabled=${busy || !body.trim()} onClick=${send}>Save</button></div>
  </div>`;
}

// ---------- files (photos, drawings, documents) ----------
const isImg = (f) => /^image\//.test(f.mime);
export function Lightbox({ file, onClose }) {
  useEffect(() => { const k = (e) => e.key === 'Escape' && onClose(); window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, []);
  if (!file) return null;
  const url = file.url || `/api/files/${file.id}`;
  return html`<div class="lightbox" onClick=${(e) => e.target === e.currentTarget && onClose()}>
    <button class="icon-btn" onClick=${onClose} aria-label="Close"><${Icon} name="x" /></button>
    ${/pdf/.test(file.mime) ? html`<iframe src=${url} title=${file.name} />` : html`<img src=${url} alt=${file.name} />`}
  </div>`;
}
export function Files({ entity, id, kinds = [['site_photo', 'Site photo'], ['drawing', 'Drawing'], ['document', 'Document'], ['other', 'Other']], canAdd = true, compact = false }) {
  const [files, setFiles] = useState(null);
  const [kind, setKind] = useState(kinds[0][0]);
  const [busy, setBusy] = useState(0);
  const [view, setView] = useState(null);
  const [over, setOver] = useState(false);
  const input = useRef();
  const load = () => api(`/files?entity=${entity}&id=${id}`).then((d) => setFiles(d.files)).catch(() => setFiles([]));
  useEffect(() => { load(); }, [entity, id]);
  useEvent('files', (d) => { if (!d || (d.entity === entity && d.id === id)) load(); });
  async function add(list) {
    for (const f of [...list]) {
      setBusy((n) => n + 1);
      try { await upload(`/files?entity=${entity}&id=${id}&kind=${kind}`, await shrinkImage(f), { name: f.name }); } catch (e) { errToast(e); }
      setBusy((n) => n - 1);
    }
    load();
  }
  async function remove(f) {
    if (!confirm(`Remove ${f.name}?`)) return;
    try { await api(`/files/${f.id}`, { method: 'DELETE' }); load(); } catch (e) { errToast(e); }
  }
  if (!files) return html`<${Spinner} />`;
  return html`<div class="stack">
    ${canAdd && html`<div class="row">
      <${Select} value=${kind} onChange=${setKind} options=${kinds} class="compact" />
      <div class="dropzone ${over ? 'over' : ''}" style=${{ flex: 1 }} onClick=${() => input.current.click()}
        onDragOver=${(e) => { e.preventDefault(); setOver(true); }} onDragLeave=${() => setOver(false)} onDrop=${(e) => { e.preventDefault(); setOver(false); add(e.dataTransfer.files); }}>
        <${Icon} name="upload" /> ${busy ? `Uploading ${busy}…` : 'Drop files here or click to add photos, drawings, PDFs'}
      </div>
      <input ref=${input} type="file" multiple hidden onChange=${(e) => { add(e.target.files); e.target.value = ''; }} />
    </div>`}
    ${files.length ? html`<div class="files">${files.map((f) => html`<div class="file">
      <span class="kind">${(kinds.find((k) => k[0] === f.kind) || [0, f.kind.replace(/_/g, ' ')])[1]}</span>
      <a class="thumb" href=${`/api/files/${f.id}`} onClick=${(e) => { if (isImg(f) || /pdf/.test(f.mime)) { e.preventDefault(); setView(f); } }} target="_blank">
        ${isImg(f) ? html`<img src=${`/api/files/${f.id}`} alt="" loading="lazy" />` : (f.name.split('.').pop() || 'FILE').toUpperCase().slice(0, 5)}</a>
      <div class="meta"><b title=${f.name}>${f.name}</b><span>${fileSize(f.size)} · ${fmtDate(f.created_at, { year: false })}</span></div>
      ${canAdd && html`<button class="icon-btn small x" onClick=${() => remove(f)} aria-label="Remove"><${Icon} name="trash" size=${14} /></button>`}
    </div>`)}</div>` : !compact && html`<p class="muted small">No files yet.</p>`}
    ${view && html`<${Lightbox} file=${view} onClose=${() => setView(null)} />`}
  </div>`;
}

// Small helpers
export const Info = ({ label, children }) => (children || children === 0 ? html`<div><dt>${label}</dt><dd>${children}</dd></div>` : null);
export function Copy({ text, label = 'Copy' }) {
  return html`<button class="btn ghost small" onClick=${() => navigator.clipboard.writeText(text).then(() => toast('Copied'))}><${Icon} name="copy" size=${14} /> ${label}</button>`;
}
export function Money({ v, strong }) { return html`<span class="nowrap ${strong ? 'strong' : ''}" style=${{ fontVariantNumeric: 'tabular-nums' }}>${aed(v)}</span>`; }
// Run an action with a busy state and error toast
export function useAction() {
  const [busy, setBusy] = useState(false);
  const run = async (fn, okText) => {
    setBusy(true);
    try { const r = await fn(); if (okText) toast(okText); return r; } catch (e) { errToast(e); return undefined; } finally { setBusy(false); }
  };
  return [busy, run];
}
// Open a URL returned by the server (WhatsApp links) in a new tab
export const openExternal = (url) => { const w = window.open(url, '_blank', 'noopener'); if (!w) location.href = url; };
