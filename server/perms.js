// Roles & access. Each role has a grid of modules × actions (view / create / edit / delete).
// "view" can be 'all', 'own' (only records they own / are assigned to) or 'none'.
const { all, get, run } = require('./db');

const MODULES = [
  { key: 'crm', label: 'Leads, contacts & deals', own: 'Leads and deals they own', actions: ['view', 'create', 'edit', 'delete'] },
  { key: 'quotes', label: 'Quotations', own: 'Quotations for their own deals', actions: ['view', 'create', 'edit', 'delete'] },
  { key: 'invoices', label: 'Invoices & payments', own: 'Invoices for their own deals', actions: ['view', 'create', 'edit', 'delete'] },
  { key: 'jobs', label: 'Installations', own: 'Jobs they are assigned to (or for their deals)', actions: ['view', 'create', 'edit', 'delete'] },
  { key: 'warranty', label: 'Warranty, claims & follow-ups', own: 'For their own customers', actions: ['view', 'create', 'edit', 'delete'] },
  { key: 'purchases', label: 'Suppliers & purchase orders', actions: ['view', 'create', 'edit', 'delete'] },
  { key: 'inventory', label: 'Products & stock', actions: ['view', 'create', 'edit', 'delete'] },
  { key: 'expenses', label: 'Expenses', actions: ['view', 'create', 'edit', 'delete'] },
  { key: 'accounting', label: 'Accounting, journals & financial reports', actions: ['view', 'create', 'edit', 'delete'] },
  { key: 'reports', label: 'Sales dashboards & reports', actions: ['view'] },
  { key: 'attendance', label: "Team attendance & leave approval", actions: ['view', 'edit'] },
  { key: 'team', label: 'Team members & roles', actions: ['view', 'edit'] },
  { key: 'settings', label: 'Company settings', actions: ['view', 'edit'] },
];
const FLAGS = [
  { key: 'see_costs', label: 'See purchase prices, margins & profit' },
  { key: 'give_discount', label: 'Give discounts on quotations' },
];

const full = (m) => Object.fromEntries(m.actions.map((a) => [a, a === 'view' ? 'all' : true]));
const none = (m) => Object.fromEntries(m.actions.map((a) => [a, a === 'view' ? 'none' : false]));
const grid = (spec) => {
  const out = {};
  for (const m of MODULES) {
    const s = spec[m.key];
    if (!s) { out[m.key] = none(m); continue; }
    if (s === 'full') { out[m.key] = full(m); continue; }
    // short form: "all:cre-" = view all, create, edit, no delete ("own:ce-" etc.)
    const [view, flags = ''] = s.split(':');
    out[m.key] = Object.fromEntries(m.actions.map((a, i) => [a, a === 'view' ? view : flags[i - 1] !== undefined && flags[i - 1] !== '-']));
  }
  return out;
};

const BUILT_IN = [
  { system: 'admin', name: 'Admin', description: 'Full access to all modules', is_admin: 1, perms: { ...grid(Object.fromEntries(MODULES.map((m) => [m.key, 'full']))), see_costs: true, give_discount: true } },
  {
    system: 'manager', name: 'Sales Manager', description: 'All leads, deals, quotations and installations; team attendance',
    perms: {
      ...grid({ crm: 'full', quotes: 'full', invoices: 'all:ce-', jobs: 'full', warranty: 'full', purchases: 'all:ce-', inventory: 'all:---', expenses: 'all:c--', reports: 'all', attendance: 'all:e', team: 'all:-' }),
      see_costs: true, give_discount: true,
    },
  },
  {
    system: 'sales', name: 'Sales Executive', description: 'Own leads, deals and quotations only',
    perms: { ...grid({ crm: 'own:ce-', quotes: 'own:ce-', invoices: 'own:---', jobs: 'own:---', warranty: 'own:c--', inventory: 'all:---' }), see_costs: false, give_discount: false },
  },
  {
    system: 'accounts', name: 'Accounts', description: 'Invoices, purchases, expenses, stock and journals',
    perms: {
      ...grid({ crm: 'all:---', quotes: 'all:---', invoices: 'full', jobs: 'all:---', warranty: 'all:---', purchases: 'full', inventory: 'full', expenses: 'full', accounting: 'full', reports: 'all' }),
      see_costs: true, give_discount: false,
    },
  },
  {
    system: 'installer', name: 'Installation Team', description: 'Assigned jobs, calendar, photos and customer sign-off',
    perms: { ...grid({ jobs: 'own:-e-', warranty: 'own:---' }), see_costs: false, give_discount: false },
  },
];

function seedRoles() {
  for (const r of BUILT_IN) {
    if (get('SELECT id FROM roles WHERE system = ?', r.system)) continue;
    run('INSERT INTO roles (name, description, is_admin, perms, system) VALUES (?, ?, ?, ?, ?)',
      r.name, r.description, r.is_admin || 0, JSON.stringify(r.perms), r.system);
  }
}

// Cleans a permissions object sent from the Roles screen
function cleanPerms(p = {}) {
  const out = {};
  for (const m of MODULES) {
    const src = p[m.key] || {};
    out[m.key] = Object.fromEntries(m.actions.map((a) => [a, a === 'view'
      ? (['all', 'own', 'none'].includes(src.view) ? (src.view === 'own' && !m.own ? 'all' : src.view) : 'none')
      : !!src[a]]));
    if (out[m.key].view === 'none') for (const a of m.actions) if (a !== 'view') out[m.key][a] = false;
  }
  for (const f of FLAGS) out[f.key] = !!p[f.key];
  return out;
}

const roleCache = new Map(); // role id → parsed role (cleared when roles change)
function roleOf(user) {
  if (!user?.role_id) return null;
  if (!roleCache.has(user.role_id)) {
    const r = get('SELECT * FROM roles WHERE id = ?', user.role_id);
    if (!r) return null;
    let perms = {};
    try { perms = JSON.parse(r.perms || '{}'); } catch {}
    roleCache.set(r.id, { ...r, perms: cleanPerms(perms) });
  }
  return roleCache.get(user.role_id);
}
const clearRoleCache = () => roleCache.clear();
const isAdmin = (user) => !!roleOf(user)?.is_admin;

// can(user, 'crm') → can view at all; can(user, 'crm', 'edit') → may edit
function can(user, mod, action = 'view') {
  const r = roleOf(user);
  if (!r) return false;
  if (r.is_admin) return true;
  if (FLAGS.some((f) => f.key === mod)) return !!r.perms[mod];
  const m = r.perms[mod];
  if (!m) return false;
  if (action === 'view') return m.view === 'all' || m.view === 'own';
  return m.view !== 'none' && !!m[action];
}
// 'all' | 'own' | 'none'
function scope(user, mod) {
  const r = roleOf(user);
  if (!r) return 'none';
  if (r.is_admin) return 'all';
  return r.perms[mod]?.view || 'none';
}
function permsFor(user) {
  const r = roleOf(user);
  if (!r) return {};
  if (r.is_admin) return { ...cleanPerms(BUILT_IN[0].perms), admin: true };
  return { ...r.perms, admin: false };
}

module.exports = { MODULES, FLAGS, BUILT_IN, seedRoles, cleanPerms, roleOf, clearRoleCache, can, scope, permsFor, isAdmin };
