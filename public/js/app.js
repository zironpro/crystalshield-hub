import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import {
  html, api, store, useStore, useRoute, useEvent, openLink, connectSocket, can, scope, isInstaller, loadUsers, loadSettings,
  refreshChatUnread, timeAgo, toast, go, getPosition, fmtTime, errToast,
} from './lib.js';
import { Icon, Avatar, Spinner, ErrorText } from './ui.js';
import { registerSW, pushSupported, pushStatus, enablePush, isMobile, isStandalone } from './pwa.js';
import { Home } from './views/home.js';
import { Leads, LeadView } from './views/leads.js';
import { Deals, DealView } from './views/deals.js';
import { Contacts, ContactView } from './views/contacts.js';
import { Quotes, QuoteView } from './views/quotes.js';
import { Invoices, InvoiceView } from './views/invoices.js';
import { Purchases, POView, VendorView } from './views/purchases.js';
import { Products, ProductView } from './views/products.js';
import { Expenses } from './views/expenses.js';
import { Books } from './views/books.js';
import { Jobs, JobView } from './views/jobs.js';
import { Warranty } from './views/warranty.js';
import { Calendar } from './views/calendar.js';
import { Reports } from './views/reports.js';
import { Chat } from './views/chat.js';
import { Attendance, useClock } from './views/attendance.js';
import { Team } from './views/team.js';
import { Settings } from './views/settings.js';
import { Profile } from './views/profile.js';
import { SearchPalette, openSearch } from './views/search.js';

function Login() {
  const saved = (() => { try { return localStorage.getItem('csEmail') || ''; } catch { return ''; } })();
  const [email, setEmail] = useState(saved);
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(e) {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      const { user } = await api('/login', { method: 'POST', body: { email: email.trim(), password, remember: true } });
      try { localStorage.setItem('csEmail', email.trim()); } catch {}
      try { if (window.PasswordCredential && navigator.credentials?.store) await navigator.credentials.store(new window.PasswordCredential({ id: email.trim(), password, name: user.name })); } catch {}
      await boot(user);
    } catch (err) { setError(err.message); }
    setBusy(false);
  }
  return html`<main class="login">
    <section class="login-art">
      <img src="/img/logo-white.png" alt="Crystal Shield" />
      <div>
        <h2>Every enquiry, quotation and installation — <span>in one place.</span></h2>
        <p>Crystal Shield Hub runs the whole job: lead → site visit → measurement → quotation → installation → sign-off → invoice → warranty.</p>
        <ul><li>Leads from website, ads & WhatsApp</li><li>Quotations in one click</li><li>Installer app with sign-off</li><li>Invoices, stock & books</li></ul>
      </div>
      <span class="small" style=${{ opacity: 0.6 }}>Crystal Shield Tint Insulation LLC · Abu Dhabi</span>
      <img class="mark" src="/img/mark-white.png" alt="" />
    </section>
    <section class="login-form">
      <form class="login-card" onSubmit=${submit} autocomplete="on">
        <img src="/img/logo-dark.png" alt="Crystal Shield" style=${{ height: '30px', alignSelf: 'flex-start', marginBottom: '8px' }} />
        <h1>Sign in</h1>
        <p class="muted" style=${{ margin: '-6px 0 4px' }}>Use the email and password your manager gave you.</p>
        <label class="field"><span class="field-label">Email</span>
          <input type="email" name="email" autocomplete="username" autocapitalize="none" spellcheck="false" required value=${email} onInput=${(e) => setEmail(e.target.value)} autoFocus=${!saved} /></label>
        <label class="field"><span class="field-label">Password</span>
          <span class="pw-wrap"><input type=${show ? 'text' : 'password'} name="password" autocomplete="current-password" required value=${password} onInput=${(e) => setPassword(e.target.value)} autoFocus=${!!saved} />
          <button type="button" class="pw-eye" onClick=${() => setShow(!show)}>${show ? 'Hide' : 'Show'}</button></span></label>
        <${ErrorText} error=${error} />
        <button class="btn primary block big" type="submit" disabled=${busy}>${busy ? 'Signing in…' : 'Sign in'}</button>
        <p class="muted small">Forgot your password? Ask your admin to reset it.</p>
      </form>
    </section>
  </main>`;
}

const N_ICON = { lead: '🆕', assigned: '👤', urgent: '🏆', quote: '📄', payment: '💰', job: '🛠', followup: '🔁', activity: '⏰', leave: '🌴', stock: '📦', claim: '⚠️', mention: '@', dm: '💬', message: '💬', thread: '💬', digest: '☀️', attendance: '⏰' };
function NotificationsPanel({ onClose, fromTop = false }) {
  const st = useStore();
  const [items, setItems] = useState(null);
  const [onlyUnread, setOnlyUnread] = useState(true);
  const load = () => api('/notifications').then((d) => { setItems(d.notifications); store.set({ unread: d.unread }); });
  useEffect(() => { load(); }, []);
  useEvent('notification', load);
  useEffect(() => {
    const close = (e) => !e.target.closest('.notif-panel, .notif-trigger') && onClose();
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);
  async function open(n) {
    if (!n.read) await api('/notifications/read', { method: 'POST', body: { ids: [n.id] } }).catch(() => {});
    load(); onClose(); openLink(n.link);
  }
  const shown = (items || []).filter((n) => !onlyUnread || !n.read);
  return html`<div class="notif-panel ${fromTop ? 'from-top' : ''}">
    <header><strong>Notifications</strong>
      <span class="seg"><button class=${onlyUnread ? 'on' : ''} onClick=${() => setOnlyUnread(true)}>Unread${st.unread ? ` ${st.unread}` : ''}</button><button class=${!onlyUnread ? 'on' : ''} onClick=${() => setOnlyUnread(false)}>All</button></span>
      <button class="link-btn small" onClick=${() => api('/notifications/read', { method: 'POST', body: {} }).then(load)}>Mark all read</button></header>
    ${st.chatUnread > 0 && html`<button class="list-row" style=${{ margin: '6px 8px 0', width: 'auto' }} onClick=${() => { onClose(); go('chat'); }}><span class="ico-sq">💬</span><span class="grow"><b>${st.chatUnread} unread message${st.chatUnread === 1 ? '' : 's'}</b><small>Open Messages</small></span></button>`}
    ${items === null ? html`<${Spinner} />` : shown.length === 0 ? html`<p class="notif-empty">${onlyUnread ? 'You’re all caught up.' : 'No notifications yet.'}</p>`
      : html`<ul>${shown.map((n) => html`<li class=${n.read ? '' : 'unread'}><button onClick=${() => open(n)}>
          <span class="notif-icon">${N_ICON[n.type] || '🔔'}</span>
          <span class="notif-text"><strong>${n.title}</strong>${n.body && html`<span>${n.body}</span>`}<small>${timeAgo(n.created_at)}</small></span></button></li>`)}</ul>`}
  </div>`;
}

// Clock in / out (sidebar on computers, top bar chip on phones)
function ClockWidget() {
  const { att, toggle } = useClock();
  if (!att) return null;
  const t = att.today;
  return html`<div class="clock-card"><${Icon} name="clock" size=${18} />
    <span class="grow">${t.working ? html`<b>Working</b><small>since ${fmtTime(t.sessions.find((s) => !s.clock_out)?.clock_in || t.first_in)}</small>` : t.first_in ? html`<b>Clocked out</b><small>${Math.round(t.minutes / 6) / 10} h today</small>` : html`<b>Not clocked in</b><small>${att.shift ? `Shift ${att.shift.start}–${att.shift.end}` : ''}</small>`}</span>
    <button class="btn ${t.working ? 'ghost' : 'amber'}" onClick=${toggle}>${t.working ? 'Clock out' : 'Clock in'}</button></div>`;
}
function ClockChip() {
  const { att, toggle } = useClock();
  if (!att) return null;
  const w = att.today.working;
  return html`<button class="btn small ${w ? 'ghost' : 'amber'}" style=${{ height: '30px' }} onClick=${toggle}>${w ? '⏱ Out' : '⏱ Clock in'}</button>`;
}

function Sidebar({ route, open, onNavigate }) {
  const s = useStore();
  const [notifOpen, setNotifOpen] = useState(false);
  const [counts, setCounts] = useState({});
  const loadCounts = () => api('/dashboard').then((d) => setCounts({
    leads: d.leads_new || 0, follow: (d.followups_due || []).length, jobs: (d.jobs_today || []).length,
  })).catch(() => {});
  useEffect(() => { loadCounts(); const t = setInterval(loadCounts, 5 * 60e3); return () => clearInterval(t); }, []);
  useEvent(['leads', 'followups', 'jobs'], loadCounts);
  const top = route.split('/')[0];
  const [closed, setClosed] = useState(() => { try { return JSON.parse(localStorage.getItem('csNav') || '{}'); } catch { return {}; } });
  const toggle = (k) => { const n = { ...closed, [k]: !closed[k] }; setClosed(n); try { localStorage.setItem('csNav', JSON.stringify(n)); } catch {} };
  const item = (path, icon, label, count) => html`<a href=${'#/' + path} class="nav-item ${top === path.split('/')[0] ? 'active' : ''}" onClick=${onNavigate}>
    <${Icon} name=${icon} size=${18} /> <span>${label}</span>${count > 0 && html`<span class="count">${count}</span>`}</a>`;
  const group = (k, label, items) => {
    const visible = items.filter(Boolean);
    if (!visible.length) return null;
    const isOpen = !closed[k];
    return html`<button class="nav-group" onClick=${() => toggle(k)}>${label}<span class="chev">${isOpen ? '▾' : '▸'}</span></button>${isOpen && visible}`;
  };
  const installer = isInstaller();
  return html`<aside class="sidebar ${open ? 'open' : ''}">
    <div class="sidebar-brand"><img src="/img/logo-white.png" alt="Crystal Shield" /><span>Hub</span></div>
    <button class="search-trigger" onClick=${() => { openSearch(); onNavigate(); }}><span>🔍  Search</span><kbd>${/Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl'} K</kbd></button>
    <nav>
      ${item('', 'home', installer ? 'My jobs' : 'Home')}
      ${group('sales', 'Sales', [
        can('crm') && item('leads', 'target', 'Leads', counts.leads),
        can('crm') && item('deals', 'deal', 'Deals'),
        can('crm') && item('contacts', 'users', 'Customers'),
        can('quotes') && item('quotes', 'file', 'Quotations'),
        (can('crm') || can('jobs')) && item('calendar', 'calendar', 'Calendar'),
      ])}
      ${group('ops', 'Operations', [
        can('jobs') && item('jobs', 'tool', 'Installations', counts.jobs),
        (can('warranty') || can('crm')) && item('warranty', 'shield', 'Warranty & follow-ups', counts.follow),
        can('inventory') && item('products', 'box', 'Products & stock'),
        can('purchases') && item('purchases', 'truck', 'Purchases'),
      ])}
      ${group('money', 'Money', [
        can('invoices') && item('invoices', 'receipt', 'Invoices & payments'),
        can('expenses') && item('expenses', 'wallet', 'Expenses'),
        can('accounting') && item('books', 'book', 'Accounting'),
        can('reports') && item('reports', 'bars', 'Reports'),
      ])}
      ${group('team', 'Team', [
        item('chat', 'chat', 'Messages', s.chatUnread),
        item('attendance', 'clock', 'Attendance & leave'),
        can('team') && item('team', 'users', 'Team & roles'),
        can('settings') && item('settings', 'gear', 'Settings'),
      ])}
    </nav>
    <div class="sidebar-foot">
      <${ClockWidget} />
      <button class="nav-item notif-trigger" onClick=${() => setNotifOpen(!notifOpen)}><${Icon} name="bell" size=${18} /> <span>Notifications</span>${s.unread > 0 && html`<span class="count">${s.unread}</span>`}</button>
      ${notifOpen && html`<${NotificationsPanel} onClose=${() => setNotifOpen(false)} />`}
      <a href="#/profile" class="me-card" onClick=${onNavigate}><${Avatar} user=${s.me} size=${32} /><span><strong>${s.me.name}</strong><small>${s.me.role}</small></span></a>
    </div>
  </aside>`;
}

function BottomBar({ route, menuOpen, onMenu }) {
  const s = useStore();
  const top = route.split('/')[0];
  const tab = (path, icon, label, count) => html`<a href=${'#/' + path} class="bb-item ${top === path ? 'on' : ''}"><span class="bb-icon"><${Icon} name=${icon} size=${22} />${count > 0 && html`<span class="bb-count">${count > 99 ? '99+' : count}</span>`}</span><span>${label}</span></a>`;
  const installer = isInstaller();
  return html`<nav class="bottom-bar">
    ${tab('', 'home', installer ? 'Jobs' : 'Home')}
    ${installer ? tab('calendar', 'calendar', 'Calendar') : can('crm') ? tab('leads', 'target', 'Leads') : tab('jobs', 'tool', 'Jobs')}
    ${installer ? tab('attendance', 'clock', 'Attendance') : can('crm') ? tab('deals', 'deal', 'Deals') : tab('calendar', 'calendar', 'Calendar')}
    ${tab('chat', 'chat', 'Messages', s.chatUnread)}
    <button class="bb-item ${menuOpen ? 'on' : ''}" onClick=${onMenu}><span class="bb-icon"><${Icon} name=${menuOpen ? 'x' : 'menu'} size=${22} /></span><span>${menuOpen ? 'Close' : 'More'}</span></button>
  </nav>`;
}

function Toast() {
  const { toast: t } = useStore();
  if (!t) return null;
  return html`<button class="toast" onClick=${() => { store.set({ toast: null }); if (t.link !== undefined && t.link !== null) openLink(t.link); }}><${Icon} name="bell" size=${16} /> ${t.text}</button>`;
}

function Page({ route }) {
  const [a, b] = route.split('/');
  const id = b ? Number(b) : null;
  const noAccess = html`<div class="page"><h1>No access</h1><p class="muted">Your role doesn’t include this page. Ask an admin if you need it.</p></div>`;
  switch (a) {
    case '': return html`<${Home} />`;
    case 'leads': return !can('crm') ? noAccess : id ? html`<${LeadView} key=${id} id=${id} />` : html`<${Leads} />`;
    case 'deals': return !can('crm') ? noAccess : id ? html`<${DealView} key=${id} id=${id} />` : html`<${Deals} />`;
    case 'contacts': return !can('crm') ? noAccess : id ? html`<${ContactView} key=${id} id=${id} />` : html`<${Contacts} />`;
    case 'quotes': return !can('quotes') ? noAccess : id ? html`<${QuoteView} key=${id} id=${id} />` : html`<${Quotes} />`;
    case 'invoices': return !can('invoices') ? noAccess : id ? html`<${InvoiceView} key=${id} id=${id} />` : html`<${Invoices} />`;
    case 'purchases': return !can('purchases') ? noAccess : id ? html`<${POView} key=${id} id=${id} />` : html`<${Purchases} />`;
    case 'vendors': return !can('purchases') ? noAccess : html`<${VendorView} key=${id} id=${id} />`;
    case 'products': return !can('inventory') && !can('crm') ? noAccess : id ? html`<${ProductView} key=${id} id=${id} />` : html`<${Products} />`;
    case 'expenses': return !can('expenses') ? noAccess : html`<${Expenses} />`;
    case 'books': return !can('accounting') ? noAccess : html`<${Books} />`;
    case 'jobs': return !can('jobs') ? noAccess : id ? html`<${JobView} key=${id} id=${id} />` : html`<${Jobs} />`;
    case 'warranty': case 'followups': return html`<${Warranty} />`;
    case 'calendar': return html`<${Calendar} />`;
    case 'reports': return !can('reports') ? noAccess : html`<${Reports} />`;
    case 'chat': return html`<${Chat} channel=${b ? decodeURIComponent(b) : null} />`;
    case 'attendance': return html`<${Attendance} />`;
    case 'team': return !can('team') ? noAccess : html`<${Team} />`;
    case 'settings': return !can('settings') ? noAccess : html`<${Settings} />`;
    case 'profile': return html`<${Profile} />`;
    default: return html`<div class="page"><h1>Page not found</h1><a class="link" href="#/">Go home</a></div>`;
  }
}

function UpdateNotice() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let build = null;
    const check = async () => {
      try {
        const { build: b } = await (await fetch('/api/version', { cache: 'no-store' })).json();
        if (!build) { build = b; return; }
        if (b !== build) {
          const busy = document.querySelector('.modal, textarea:focus, input:focus');
          if (!busy && document.visibilityState === 'hidden') location.reload(); else setReady(true);
        }
      } catch {}
    };
    check();
    const t = setInterval(check, 3 * 60e3);
    const onVis = () => document.visibilityState === 'visible' && check();
    document.addEventListener('visibilitychange', onVis);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', onVis); };
  }, []);
  return ready ? html`<div class="update-bar">🔄 A new version is ready. <button class="btn primary small" onClick=${() => location.reload()}>Refresh</button></div>` : null;
}
function NotifyBanner() {
  const [st, setSt] = useState(null);
  const snoozed = () => { try { return Number(localStorage.getItem('cs-notify-snooze') || 0) > Date.now(); } catch { return false; } };
  useEffect(() => { if (pushSupported() && !snoozed()) pushStatus().then(setSt).catch(() => {}); }, []);
  if (!st || st.subscribed || st.permission === 'denied' || (isMobile() && !isStandalone())) return null;
  const later = () => { try { localStorage.setItem('cs-notify-snooze', String(Date.now() + 3 * 864e5)); } catch {} setSt(null); };
  return html`<div class="notify-banner"><span>🔔</span><span class="nb-text"><b>Turn on alerts</b> — new leads, jobs and payments pop up ${isMobile() ? 'on your phone' : 'on your screen'} even when the hub is closed.</span>
    <button class="btn primary small" onClick=${async () => { try { await enablePush(); toast('🔔 Alerts are on for this device'); setSt(null); } catch (e) { errToast(e); } }}>Turn on</button>
    <button class="link-btn small" onClick=${later}>Later</button></div>`;
}

function App() {
  const s = useStore();
  const route = useRoute();
  const [menuOpen, setMenuOpen] = useState(false);
  const [topNotif, setTopNotif] = useState(false);
  useEffect(() => { setMenuOpen(false); setTopNotif(false); window.scrollTo(0, 0); }, [route]);
  useEffect(() => {
    if (!('setAppBadge' in navigator)) return;
    const n = (s.unread || 0) + (s.chatUnread || 0);
    (n ? navigator.setAppBadge(n) : navigator.clearAppBadge()).catch(() => {});
  }, [s.unread, s.chatUnread]);
  if (s.me === undefined) return html`<div class="boot"><${Spinner} /></div>`;
  if (s.me === null) return html`<${Login} />`;
  return html`<div class="shell">
    <header class="mobile-bar">
      <button class="icon-btn" aria-label="Menu" onClick=${() => setMenuOpen(true)}><${Icon} name="menu" /></button>
      <img src="/img/logo-white.png" alt="Crystal Shield" />
      <span class="spacer" />
      <button class="icon-btn" aria-label="Search" onClick=${openSearch}><${Icon} name="search" /></button>
      <${ClockChip} />
      <button class="icon-btn notif-trigger top-bell" aria-label="Notifications" onClick=${() => setTopNotif(!topNotif)}><${Icon} name="bell" />${s.unread > 0 && html`<span class="dot-count">${s.unread}</span>`}</button>
    </header>
    ${menuOpen && html`<div class="scrim" onClick=${() => setMenuOpen(false)} />`}
    <${Sidebar} route=${route} open=${menuOpen} onNavigate=${() => setMenuOpen(false)} />
    <main class="main"><${UpdateNotice} /><${NotifyBanner} /><${Page} route=${route} /></main>
    <${SearchPalette} />
    ${topNotif && html`<${NotificationsPanel} fromTop=${true} onClose=${() => setTopNotif(false)} />`}
    <${BottomBar} route=${route} menuOpen=${menuOpen} onMenu=${() => setMenuOpen(!menuOpen)} />
    <${Toast} />
  </div>`;
}

async function boot(user) {
  await Promise.all([loadUsers(), loadSettings()]);
  const { unread } = await api('/notifications');
  store.set({ me: user, unread });
  connectSocket();
  refreshChatUnread();
  registerSW(openLink);
}
api('/me').then((d) => boot(d.user)).catch(() => store.set({ me: null }));
render(html`<${App} />`, document.getElementById('app'));
