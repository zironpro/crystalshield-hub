import { h } from 'preact';
import { useEffect, useReducer, useRef, useState } from 'preact/hooks';
import htm from 'htm';
import { io } from 'socket.io-client';

export const html = htm.bind(h);

// ---------- API ----------
export async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch('/api' + path, {
    method, credentials: 'same-origin',
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && path !== '/login') store.set({ me: null });
  if (!res.ok) throw Object.assign(new Error(data.error || 'Something went wrong'), { status: res.status });
  return data;
}
// Raw file upload (the body is the file itself)
export async function upload(path, file, { name } = {}) {
  const res = await fetch('/api' + path, {
    method: 'POST', credentials: 'same-origin', body: file,
    headers: { 'Content-Type': 'application/octet-stream', 'X-File-Name': encodeURIComponent(name || file.name || 'file'), 'X-File-Type': file.type || 'application/octet-stream' },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Upload failed');
  return data;
}
// Phone photos are huge: shrink images before upload (keeps quality for site photos)
export async function shrinkImage(file, max = 1800, quality = 0.82) {
  if (!/^image\/(jpeg|png|webp|heic|heif)$/i.test(file.type) || file.size < 600 * 1024) return file;
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', quality));
    return blob ? new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' }) : file;
  } catch { return file; }
}

// ---------- events ----------
const listeners = new Map();
export const bus = {
  on(evt, fn) { if (!listeners.has(evt)) listeners.set(evt, new Set()); listeners.get(evt).add(fn); return () => listeners.get(evt).delete(fn); },
  emit(evt, data) { for (const fn of listeners.get(evt) || []) fn(data); },
};
const INSTANT = new Set(['message', 'typing', 'message-updated', 'notification', 'channels']);
// Live refresh: bursts of server events re-load the screen once
export function useEvent(evt, fn, { wait = 350, maxWait = 1500 } = {}) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    const evts = Array.isArray(evt) ? evt : [evt];
    if (evts.every((e) => INSTANT.has(e))) { const offs = evts.map((e) => bus.on(e, (d) => ref.current(d))); return () => offs.forEach((o) => o()); }
    let timer = null; let first = 0; let last;
    const flush = () => { timer = null; first = 0; ref.current(last); };
    const offs = evts.map((e) => bus.on(e, (d) => {
      last = d; const now = Date.now(); if (!first) first = now;
      clearTimeout(timer); timer = setTimeout(flush, now - first >= maxWait ? 0 : wait);
    }));
    return () => { clearTimeout(timer); offs.forEach((o) => o()); };
  }, [String(evt)]);
}

// ---------- store ----------
const state = { me: undefined, users: [], online: new Set(), unread: 0, chatUnread: 0, toast: null, settings: null };
const subs = new Set();
let version = 0;
export const store = {
  get: () => state,
  set(patch) { Object.assign(state, patch); version++; subs.forEach((fn) => fn()); },
};
export function useStore() {
  const [, force] = useReducer((n) => n + 1, 0);
  const seen = version;
  useEffect(() => { subs.add(force); if (version !== seen) force(); return () => subs.delete(force); }, []);
  return state;
}
export const userById = (id) => state.users.find((u) => u.id === id);
export const userName = (id) => userById(id)?.name || '—';
export async function loadUsers() {
  const { users } = await api('/users');
  store.set({ users, online: new Set(users.filter((u) => u.online).map((u) => u.id)) });
}
export async function loadSettings() {
  try { store.set({ settings: await api('/settings') }); } catch {}
}
export const lists = () => state.settings?.lists || {};
export const company = () => state.settings?.company || {};
export async function refreshChatUnread() {
  try {
    const d = await api('/channels');
    store.set({ chatUnread: [...d.channels, ...d.records, ...d.dms].reduce((s, c) => s + c.unread, 0) });
    return d;
  } catch { return null; }
}

// Load-on-mount helper with live refresh: const [data, reload] = useLoad('/deals', ['deals'])
export function useLoad(path, events = [], deps = []) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const pathRef = useRef(path);
  pathRef.current = path;
  const load = () => {
    if (!pathRef.current) return Promise.resolve();
    const p = pathRef.current;
    return api(p).then((d) => { if (pathRef.current === p) { setData(d); setError(null); } }).catch((e) => setError(e));
  };
  useEffect(() => { setData(null); load(); }, [path, ...deps]);
  useEvent([...events, 'reconnect'], () => load());
  return [data, load, error, setData];
}

// ---------- socket ----------
let socket = null;
const EVENTS = ['message', 'typing', 'notification', 'team', 'channels', 'message-updated', 'leads', 'deals', 'contacts', 'activities', 'quotes', 'invoices',
  'purchases', 'vendors', 'stock', 'expenses', 'jobs', 'warranties', 'claims', 'followups', 'attendance', 'leaves', 'files', 'settings'];
export function connectSocket() {
  if (socket) return socket;
  socket = io({ withCredentials: true });
  for (const evt of EVENTS) socket.on(evt, (d) => bus.emit(evt, d));
  socket.on('presence', ({ id, online }) => { const s = new Set(state.online); online ? s.add(id) : s.delete(id); store.set({ online: s }); });
  socket.on('connect', () => { bus.emit('reconnect'); loadUsers().catch(() => {}); });
  socket.on('notification', (n) => {
    store.set({ unread: state.unread + 1 });
    chime(['lead', 'urgent', 'job', 'payment'].includes(n.type) ? 'important' : 'normal');
    toast(n.title, n.link);
    desktopNotify(n);
  });
  socket.on('message', ({ channel, message }) => {
    if (message.user_id === state.me?.id) return;
    refreshChatUnread();
    const viewing = document.visibilityState === 'visible' && location.hash.startsWith(`#/chat/${channel}`);
    if (channel.startsWith('dm:') && !viewing) chime('message');
  });
  socket.on('team', () => { loadUsers().catch(() => {}); api('/me').then((d) => store.set({ me: d.user })).catch(() => {}); });
  socket.on('settings', () => loadSettings());
  return socket;
}
export function disconnectSocket() { socket?.disconnect(); socket = null; }
export const sendTyping = (channel) => socket?.emit('typing', channel);
function desktopNotify(n) {
  if (!('Notification' in window) || Notification.permission !== 'granted' || document.hasFocus()) return;
  try { if (localStorage.getItem('cs-push') === '1') return; } catch {}
  const note = new Notification(n.title, { body: n.body, icon: '/icons/notify-192.png', tag: n.id ? `n${n.id}` : undefined });
  note.onclick = () => { window.focus(); openLink(n.link); };
}
export async function logout() {
  await api('/logout', { method: 'POST' }).catch(() => {});
  disconnectSocket();
  store.set({ me: null, unread: 0, chatUnread: 0 });
  go('');
}

// ---------- router ----------
export const currentRoute = () => location.hash.replace(/^#\/?/, '').split('?')[0];
export function useRoute() {
  const [, force] = useReducer((n) => n + 1, 0);
  useEffect(() => { window.addEventListener('hashchange', force); return () => window.removeEventListener('hashchange', force); }, []);
  return currentRoute();
}
export const go = (path) => { location.hash = '#/' + String(path || '').replace(/^#?\/?/, ''); };
export const hashParam = (name) => new URLSearchParams(location.hash.split('?')[1] || '').get(name);
export function setHashParam(name, value) {
  const [p, q] = location.hash.split('?');
  const sp = new URLSearchParams(q || '');
  if (value === null || value === undefined || value === '') sp.delete(name); else sp.set(name, value);
  history.replaceState(null, '', `${p}${sp.toString() ? `?${sp}` : ''}`);
}
export function openLink(link) { if (link !== undefined && link !== null) go(link); }

// ---------- toast ----------
let toastTimer;
export function toast(text, link) {
  clearTimeout(toastTimer);
  store.set({ toast: { text, link } });
  toastTimer = setTimeout(() => store.set({ toast: null }), 4500);
}
export const errToast = (e) => toast(`⚠️ ${e.message || e}`);

// ---------- access ----------
export const can = (mod, action = 'view', user = state.me) => {
  const p = user?.perms;
  if (!p) return false;
  if (p.admin) return true;
  if (typeof p[mod] === 'boolean') return p[mod];
  const m = p[mod];
  if (!m) return false;
  if (action === 'view') return m.view === 'all' || m.view === 'own';
  return m.view !== 'none' && !!m[action];
};
export const scope = (mod, user = state.me) => (user?.perms?.admin ? 'all' : user?.perms?.[mod]?.view || 'none');
export const isInstaller = () => state.me?.role_system === 'installer' || (scope('jobs') === 'own' && !can('crm'));

// ---------- formatting ----------
const nf2 = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const nf0 = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
export const aed = (n, { dp = 2 } = {}) => `AED ${(dp ? nf2 : nf0).format(Number(n) || 0)}`;
export const money = (n) => nf2.format(Number(n) || 0);
export const kaed = (n) => { const v = Number(n) || 0; return Math.abs(v) >= 1e6 ? `AED ${(v / 1e6).toFixed(2)}M` : Math.abs(v) >= 1e4 ? `AED ${(v / 1e3).toFixed(1)}k` : aed(v, { dp: 0 }); };
export const qty = (n) => (Math.round((Number(n) || 0) * 100) / 100).toLocaleString('en-US', { maximumFractionDigits: 2 });
export const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
export const parseDate = (s) => new Date(s.length === 10 ? s + 'T00:00:00' : s.includes('T') ? s : s.replace(' ', 'T') + 'Z');
export const fmtDate = (s, opts = {}) => (s ? parseDate(s).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', ...(opts.year === false ? {} : { year: 'numeric' }), ...(opts.weekday ? { weekday: 'short' } : {}) }) : '—');
export const fmtDay = (s) => (s ? parseDate(s).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }) : '—');
export const fmtTime = (s) => parseDate(s).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Dubai' });
export const fmtDateTime = (s) => (s ? `${fmtDate(s)} ${fmtTime(s)}` : '—');
export const t12 = (hhmm) => { if (!hhmm) return ''; const [h, m] = hhmm.split(':').map(Number); return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`; };
export function timeAgo(s) {
  const sec = (Date.now() - parseDate(s)) / 1000;
  if (sec < 60) return 'just now';
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  if (sec < 7 * 86400) return `${Math.floor(sec / 86400)}d ago`;
  return fmtDate(s, { year: false });
}
export const todayISO = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Dubai' });
export const addDays = (date, n) => { const d = new Date(date + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
export const daysBetween = (a, b) => Math.round((new Date(b + 'T00:00:00Z') - new Date(a + 'T00:00:00Z')) / 864e5);
export function dueLabel(date) {
  if (!date) return null;
  const d = daysBetween(todayISO(), date);
  const label = d === 0 ? 'Today' : d === 1 ? 'Tomorrow' : d === -1 ? 'Yesterday' : d < 0 ? `${-d} days overdue` : d < 7 ? fmtDay(date) : fmtDate(date, { year: false });
  return { label, tone: d < 0 ? 'red' : d === 0 ? 'orange' : 'grey', overdue: d < 0 };
}
export const initials = (name = '') => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');
export const dmChannel = (a, b) => `dm:${Math.min(a, b)}:${Math.max(a, b)}`;
export function normPhone(p) {
  let d = String(p || '').replace(/[^\d]/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  if (d.length === 10 && d.startsWith('0')) d = '971' + d.slice(1);
  if (d.length === 9 && d.startsWith('5')) d = '971' + d;
  return d;
}
export const waLink = (phone, text = '') => `https://wa.me/${normPhone(phone)}${text ? `?text=${encodeURIComponent(text)}` : ''}`;
export const telLink = (phone) => `tel:+${normPhone(phone)}`;
export const mapLink = (c) => c?.location_url || (c?.address || c?.area || c?.city ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([c.address, c.area, c.city, 'UAE'].filter(Boolean).join(', '))}` : null);
export const debounce = (fn, ms = 300) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
export const sum = (arr, f = (x) => x) => arr.reduce((s, x) => s + (Number(f(x)) || 0), 0);
export const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : 0);
export const fileSize = (n) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

// ---------- statuses ----------
export const LEAD_STATUS = {
  new: { label: 'New', tone: 'blue' }, contacted: { label: 'Contacted', tone: 'violet' }, qualified: { label: 'Qualified', tone: 'green' },
  unqualified: { label: 'Unqualified', tone: 'grey' }, converted: { label: 'Converted to deal', tone: 'navy' },
};
export const STAGES = ['new', 'site_visit', 'measured', 'quoted', 'negotiation', 'won', 'lost'];
export const STAGE = {
  new: { label: 'New', tone: 'blue', color: '#3da4e4' }, site_visit: { label: 'Site visit', tone: 'violet', color: '#7c5cdb' }, measured: { label: 'Measured', tone: 'amber', color: '#e09a2d' },
  quoted: { label: 'Quotation sent', tone: 'orange', color: '#e0712d' }, negotiation: { label: 'Negotiation', tone: 'red', color: '#d04d4d' },
  won: { label: 'Won', tone: 'green', color: '#1f9d55' }, lost: { label: 'Lost', tone: 'grey', color: '#8b93a5' },
};
export const QUOTE_STATUS = { draft: { label: 'Draft', tone: 'grey' }, sent: { label: 'Sent', tone: 'blue' }, accepted: { label: 'Accepted', tone: 'green' }, rejected: { label: 'Rejected', tone: 'red' }, expired: { label: 'Expired', tone: 'orange' } };
export const INVOICE_STATUS = { draft: { label: 'Draft', tone: 'grey' }, unpaid: { label: 'Unpaid', tone: 'orange' }, partial: { label: 'Part paid', tone: 'amber' }, paid: { label: 'Paid', tone: 'green' }, cancelled: { label: 'Cancelled', tone: 'red' } };
export const PO_STATUS = { draft: { label: 'Draft', tone: 'grey' }, sent: { label: 'Sent', tone: 'blue' }, partial: { label: 'Part received', tone: 'amber' }, received: { label: 'Received', tone: 'green' }, cancelled: { label: 'Cancelled', tone: 'red' } };
export const JOB_STATUS = {
  scheduled: { label: 'Scheduled', tone: 'blue' }, on_the_way: { label: 'On the way', tone: 'violet' }, in_progress: { label: 'In progress', tone: 'amber' },
  completed: { label: 'Awaiting sign-off', tone: 'orange' }, signed_off: { label: 'Signed off', tone: 'green' }, on_hold: { label: 'On hold', tone: 'grey' }, cancelled: { label: 'Cancelled', tone: 'red' },
};
export const ACTIVITY = {
  call: { label: 'Call', icon: '📞' }, meeting: { label: 'Meeting', icon: '🤝' }, site_visit: { label: 'Site visit', icon: '📍' }, measurement: { label: 'Measurement', icon: '📐' },
  follow_up: { label: 'Follow-up', icon: '🔁' }, task: { label: 'Task', icon: '✔️' }, payment_follow_up: { label: 'Payment follow-up', icon: '💸' },
};
export const FOLLOWUP = {
  review: { label: 'Google review', icon: '⭐' }, check_in: { label: 'Check-in call', icon: '📞' }, inspection: { label: 'Free inspection', icon: '🔍' },
  warranty_expiry: { label: 'Warranty ending', icon: '🛡' }, quote: { label: 'Quotation follow-up', icon: '📄' }, payment: { label: 'Payment', icon: '💸' }, custom: { label: 'Follow-up', icon: '🔁' },
};
export const CATEGORIES = {
  solar: 'Solar control film', safety: 'Safety & security film', blast: 'Blast mitigation film', surface: 'Surface protection film',
  privacy: 'Privacy / frosted film', decorative: 'Decorative film', material: 'Materials & consumables', service: 'Service / labour',
};
export const UNITS = ['SQM', 'LM', 'Roll', 'Pcs', 'Job', 'LS', 'Hour'];
export const METHOD = { cash: 'Cash', bank: 'Bank transfer', cheque: 'Cheque', card: 'Card', link: 'Payment link' };

// ---------- sound ----------
let audioCtx = null;
export function chime(kind = 'normal', force = false) {
  if (!force && state.me && state.me.sound === false) return;
  try {
    audioCtx ||= new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const notes = kind === 'message' ? [880, 1175] : kind === 'important' ? [659, 880, 1319] : [784, 1047];
    const t0 = audioCtx.currentTime;
    notes.forEach((f, i) => {
      const o = audioCtx.createOscillator(); const g = audioCtx.createGain();
      o.type = 'sine'; o.frequency.value = f;
      const t = t0 + i * 0.11;
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.16, t + 0.015); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
      o.connect(g).connect(audioCtx.destination); o.start(t); o.stop(t + 0.4);
    });
  } catch { /* no audio */ }
}
document.addEventListener('pointerdown', () => { try { audioCtx ||= new (window.AudioContext || window.webkitAudioContext)(); audioCtx.resume(); } catch {} }, { once: true });

// Current GPS position (installers / clock-in); resolves null if not allowed
export function getPosition(timeout = 8000) {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition((p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }), () => resolve(null), { enableHighAccuracy: true, timeout, maximumAge: 60000 });
  });
}
