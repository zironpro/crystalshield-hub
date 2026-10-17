import { useState, useEffect, useRef } from 'preact/hooks';
import { html, api, go, debounce } from '../lib.js';

let openFn = null;
export const openSearch = () => openFn?.();
const ICON = { contact: '👤', lead: '🎯', deal: '💼', quote: '📄', invoice: '🧾', job: '🛠', product: '🪟', po: '🚚' };
const TYPE = { contact: 'Customer', lead: 'Lead', deal: 'Deal', quote: 'Quotation', invoice: 'Invoice', job: 'Installation', product: 'Product', po: 'Purchase order' };

export function SearchPalette() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [res, setRes] = useState([]);
  const [on, setOn] = useState(0);
  const input = useRef();
  openFn = () => { setOpen(true); setQ(''); setRes([]); setOn(0); };
  useEffect(() => {
    const k = (e) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openFn(); } if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k);
  }, []);
  useEffect(() => { if (open) setTimeout(() => input.current?.focus(), 30); }, [open]);
  const search = useRef(debounce((s) => (s.length < 2 ? setRes([]) : api(`/search?q=${encodeURIComponent(s)}`).then((d) => { setRes(d.results); setOn(0); }).catch(() => {})), 200)).current;
  useEffect(() => { search(q); }, [q]);
  if (!open) return null;
  const pick = (r) => { setOpen(false); go(r.link); };
  return html`<div class="overlay" style=${{ paddingTop: '10vh' }} onMouseDown=${(e) => e.target === e.currentTarget && setOpen(false)}>
    <div class="palette"><input ref=${input} value=${q} placeholder="Search customers, phone numbers, deals, quotations, invoices, jobs…" onInput=${(e) => setQ(e.target.value)}
      onKeyDown=${(e) => { if (e.key === 'ArrowDown') { e.preventDefault(); setOn(Math.min(res.length - 1, on + 1)); } if (e.key === 'ArrowUp') { e.preventDefault(); setOn(Math.max(0, on - 1)); } if (e.key === 'Enter' && res[on]) pick(res[on]); }} />
      <div class="results">${q.length < 2 ? html`<p class="muted small" style=${{ padding: '10px' }}>Type a name, phone number, QT-/INV-/JOB- number…</p>`
        : !res.length ? html`<p class="muted small" style=${{ padding: '10px' }}>Nothing found.</p>`
          : res.map((r, i) => html`<button class="search-item ${i === on ? 'on' : ''}" onMouseEnter=${() => setOn(i)} onClick=${() => pick(r)}><span class="si-icon">${ICON[r.type]}</span><span class="si-main"><strong>${r.title}</strong><small>${r.sub}</small></span><span class="si-type">${TYPE[r.type]}</span></button>`)}</div></div>
  </div>`;
}
