import { useState, useEffect } from 'preact/hooks';
import { html, api, useLoad, useStore, can, toast, errToast, timeAgo, loadUsers } from '../lib.js';
import { Icon, Avatar, Badge, Modal, Field, ErrorText, Spinner, PageHead, Tabs, useAction } from '../ui.js';

export function Team() {
  const [tab, setTab] = useState('people');
  return html`<div class="page">
    <${PageHead} eyebrow="Team" title="Team & roles" sub="Each person sees only what their role allows. Sales can be limited to their own leads; installers see only their jobs." />
    <${Tabs} value=${tab} onChange=${setTab} tabs=${[['people', 'People'], ['roles', 'Roles & access']]} />
    ${tab === 'people' ? html`<${People} />` : html`<${Roles} />`}
  </div>`;
}

function People() {
  const s = useStore();
  const [roles] = useLoad('/roles', ['team']);
  const [offices] = useLoad('/offices');
  const [edit, setEdit] = useState(null);
  const [created, setCreated] = useState(null);
  const editable = can('team', 'edit');
  const groups = (roles?.roles || []).map((r) => ({ r, people: s.users.filter((u) => u.role_id === r.id) })).filter((g) => g.people.length);
  return html`<div class="stack">
    <div class="row"><span class="muted small">${s.users.filter((u) => u.active).length} active people</span><span class="spacer" />${editable && html`<button class="btn primary" onClick=${() => setEdit({})}><${Icon} name="plus" size=${15} /> Add person</button>`}</div>
    ${groups.map(({ r, people }) => html`<div><p class="section-title">${r.name} · ${people.length}</p><div class="grid-3">${people.map((u) => html`<div class="card row" style=${{ alignItems: 'flex-start', opacity: u.active ? 1 : 0.5 }}>
      <${Avatar} user=${u} size=${42} showOnline=${true} /><span style=${{ flex: 1, minWidth: 0 }}><b style=${{ display: 'block' }}>${u.name}</b><span class="small muted" style=${{ display: 'block' }}>${u.title || r.name}</span>
        <span class="small" style=${{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis' }}>${u.email}</span>${u.phone && html`<span class="small muted">${u.phone}</span>`}
        <span class="row" style=${{ marginTop: '6px', gap: '6px' }}>${!u.active && html`<${Badge} tone="red">Switched off<//>`}${u.last_seen && html`<span class="tiny faint">seen ${timeAgo(u.last_seen)}</span>`}</span></span>
      ${editable && html`<button class="icon-btn small" onClick=${() => setEdit(u)} aria-label="Edit"><${Icon} name="edit" size=${15} /></button>`}</div>`)}</div></div>`)}
    ${edit && roles && html`<${PersonForm} person=${edit.id ? edit : null} roles=${roles.roles} offices=${offices} onClose=${() => setEdit(null)} onCreated=${setCreated} />`}
    ${created && html`<${Modal} title="Account ready" onClose=${() => setCreated(null)}><p>Send ${created.name} these sign-in details (they can change the password under Profile):</p>
      <pre class="card mono" style=${{ whiteSpace: 'pre-wrap' }}>${`Crystal Shield Hub\n${location.origin}\nEmail: ${created.email}\nPassword: ${created.password}`}</pre>
      <div class="form-actions"><button class="btn primary" onClick=${() => navigator.clipboard.writeText(`Crystal Shield Hub\n${location.origin}\nEmail: ${created.email}\nPassword: ${created.password}`).then(() => toast('Copied'))}>Copy</button></div><//>`}
  </div>`;
}
const tempPassword = () => Array.from(crypto.getRandomValues(new Uint8Array(9)), (b) => 'abcdefghjkmnpqrstuvwxyz23456789'[b % 31]).join('');
function PersonForm({ person, roles, offices, onClose, onCreated }) {
  const me = useStore().me;
  const [f, setF] = useState(person ? { ...person, password: '' } : { name: '', email: '', title: '', phone: '', role_id: roles.find((r) => r.system === 'sales')?.id, password: tempPassword(), office_id: '', shift_id: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  async function save(e) {
    e.preventDefault(); setBusy(true); setError('');
    try {
      if (person) await api(`/users/${person.id}`, { method: 'PATCH', body: { ...f, password: f.password || undefined } });
      else { await api('/users', { method: 'POST', body: f }); onCreated({ name: f.name, email: f.email, password: f.password }); }
      await loadUsers(); onClose();
    } catch (err) { setError(err.message); }
    setBusy(false);
  }
  const role = roles.find((r) => r.id === Number(f.role_id));
  return html`<${Modal} title=${person ? `Edit ${person.name}` : 'Add person'} onClose=${onClose}>
    <form class="form" onSubmit=${save}>
      <div class="form-grid two"><${Field} label="Full name"><input required value=${f.name} onInput=${set('name')} /><//><${Field} label="Job title"><input value=${f.title} onInput=${set('title')} placeholder="e.g. Installation Technician" /><//>
        <${Field} label="Email (to sign in)"><input type="email" required value=${f.email} onInput=${set('email')} /><//><${Field} label="Phone"><input value=${f.phone} onInput=${set('phone')} /><//></div>
      <${Field} label="Role" hint=${role?.description}><select value=${f.role_id} disabled=${person?.id === me.id} onChange=${set('role_id')}>${roles.map((r) => html`<option value=${r.id}>${r.name}</option>`)}</select><//>
      ${offices && html`<div class="form-grid two"><${Field} label="Office"><select value=${f.office_id || ''} onChange=${set('office_id')}><option value="">—</option>${offices.offices.map((o) => html`<option value=${o.id}>${o.name}</option>`)}</select><//>
        <${Field} label="Shift"><select value=${f.shift_id || ''} onChange=${set('shift_id')}><option value="">Default</option>${offices.shifts.map((x) => html`<option value=${x.id}>${x.name}</option>`)}</select><//></div>`}
      <${Field} label=${person ? 'New password (leave empty to keep)' : 'Temporary password'}><div class="inline-input"><input value=${f.password} onInput=${set('password')} minLength="8" /><button type="button" class="btn ghost small" onClick=${() => setF({ ...f, password: tempPassword() })}>New</button></div><//>
      ${person && person.id !== me.id && html`<label class="check"><input type="checkbox" checked=${!!f.active} onChange=${(e) => setF({ ...f, active: e.target.checked })} /> Account active (untick when someone leaves — they’re signed out at once)</label>`}
      <${ErrorText} error=${error} />
      <div class="form-actions"><button type="button" class="btn ghost" onClick=${onClose}>Cancel</button><button class="btn primary" disabled=${busy}>${person ? 'Save' : 'Add person'}</button></div>
    </form>
  <//>`;
}

function Roles() {
  const [data, reload] = useLoad('/roles', ['team']);
  const [sel, setSel] = useState(null);
  const [draft, setDraft] = useState(null);
  const [busy, run] = useAction();
  useEffect(() => { if (data && !sel) setSel(data.roles.find((r) => !r.is_admin)?.id || data.roles[0].id); }, [data]);
  useEffect(() => { const r = data?.roles.find((x) => x.id === sel); if (r) setDraft({ name: r.name, description: r.description, perms: JSON.parse(JSON.stringify(r.perms)) }); }, [sel, data]);
  if (!data || !draft) return html`<${Spinner} />`;
  const role = data.roles.find((r) => r.id === sel);
  const editable = can('team', 'edit') && !role.is_admin;
  const setPerm = (mod, action, value) => {
    const p = { ...draft.perms, [mod]: { ...draft.perms[mod], [action]: value } };
    if (action === 'view' && value === 'none') for (const a of Object.keys(p[mod])) if (a !== 'view') p[mod][a] = false;
    setDraft({ ...draft, perms: p });
  };
  async function addRole() {
    const name = prompt('Name of the new role (e.g. Storekeeper):');
    if (!name) return;
    const r = await run(() => api('/roles', { method: 'POST', body: { name, perms: role.perms } }));
    if (r) { await reload(); setSel(r.id); }
  }
  return html`<div class="grid-main" style=${{ gridTemplateColumns: '260px minmax(0, 1fr)' }}>
    <div class="card" style=${{ padding: '10px' }}>${data.roles.map((r) => html`<button class="list-row" style=${{ background: r.id === sel ? 'var(--accent-soft)' : '' }} onClick=${() => setSel(r.id)}><span class="grow"><b>${r.name}</b><small>${r.users} ${r.users === 1 ? 'person' : 'people'}</small></span></button>`)}
      ${can('team', 'edit') && html`<button class="btn ghost small block" style=${{ marginTop: '8px' }} onClick=${addRole}><${Icon} name="plus" size=${14} /> New role (copy of ${role.name})</button>`}</div>
    <div class="card">
      ${editable ? html`<div class="form-grid two" style=${{ marginBottom: '12px' }}><${Field} label="Role name"><input value=${draft.name} onInput=${(e) => setDraft({ ...draft, name: e.target.value })} /><//><${Field} label="Description"><input value=${draft.description} onInput=${(e) => setDraft({ ...draft, description: e.target.value })} /><//></div>`
        : html`<h2>${role.name}</h2><p class="muted">${role.description}${role.is_admin ? ' — admins always have full access so nobody gets locked out.' : ''}</p>`}
      <div class="table-wrap"><table class="perm-grid"><thead><tr><th>Module</th><th>View</th><th>Create</th><th>Edit</th><th>Delete</th></tr></thead>
        <tbody>${data.modules.map((m) => { const p = draft.perms[m.key] || {}; return html`<tr><td><b>${m.label}</b>${p.view === 'own' && m.own && html`<span class="sub" style=${{ display: 'block', fontSize: '12px', color: 'var(--faint)' }}>Own: ${m.own}</span>`}</td>
          <td><select value=${p.view} disabled=${!editable} onChange=${(e) => setPerm(m.key, 'view', e.target.value)}><option value="all">All</option>${m.own && html`<option value="own">Own only</option>`}<option value="none">No access</option></select></td>
          ${['create', 'edit', 'delete'].map((a) => html`<td>${m.actions.includes(a) ? html`<input type="checkbox" checked=${!!p[a]} disabled=${!editable || p.view === 'none'} onChange=${(e) => setPerm(m.key, a, e.target.checked)} />` : html`<span class="faint">—</span>`}</td>`)}</tr>`; })}
          ${data.flags.map((fl) => html`<tr><td><b>${fl.label}</b></td><td colspan="4" style=${{ textAlign: 'left' }}><label class="check"><input type="checkbox" checked=${!!draft.perms[fl.key]} disabled=${!editable} onChange=${(e) => setDraft({ ...draft, perms: { ...draft.perms, [fl.key]: e.target.checked } })} /> Allowed</label></td></tr>`)}
        </tbody></table></div>
      ${editable && html`<div class="form-actions" style=${{ marginTop: '14px' }}>${!role.system && html`<button class="btn danger-ghost" onClick=${() => confirm(`Delete role ${role.name}?`) && run(() => api(`/roles/${role.id}`, { method: 'DELETE' }).then(() => { setSel(null); reload(); }))}>Delete role</button>`}<span class="spacer" />
        <button class="btn primary" disabled=${busy} onClick=${() => run(() => api(`/roles/${role.id}`, { method: 'PATCH', body: draft }).then(reload), 'Role saved — access updates right away')}>Save role</button></div>`}
    </div></div>`;
}
