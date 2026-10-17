import { useState, useMemo, useRef, useEffect } from 'preact/hooks';
import {
  html, api, upload, shrinkImage, useLoad, store, can, scope, go, toast, errToast, JOB_STATUS, aed, qty, fmtDate, fmtDay, fmtDateTime, t12, todayISO, addDays,
  getPosition, waLink, isInstaller, company,
} from '../lib.js';
import {
  Icon, Avatar, AvatarStack, Badge, StatusBadge, Modal, Field, ErrorText, Spinner, Empty, PageHead, SearchBox, Chips, ContactActions, Timeline, NoteComposer,
  Info, Lightbox, useAction, openExternal, WaIcon, Copy,
} from '../ui.js';
import { JobModal } from './deals.js';

export function JobCard({ j }) {
  return html`<a class="job-card" href=${`#/jobs/${j.id}`}>
    <span class="time">${j.start_time ? t12(j.start_time).replace(' ', '') : '—'}<small>${j.date ? fmtDay(j.date).split(' ').slice(0, 1) : 'TBC'}</small></span>
    <span class="grow" style=${{ flex: 1, minWidth: 0 }}><b style=${{ display: 'block' }}>${j.contact_name || j.title}</b>
      <span class="small muted" style=${{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>${j.number} · ${j.address || j.title}</span>
      <span class="row" style=${{ marginTop: '6px', gap: '8px' }}><${StatusBadge} map=${JOB_STATUS} status=${j.status} /><${AvatarStack} ids=${j.installers || []} size=${22} />${j.date && j.end_date && j.end_date !== j.date && html`<span class="small muted">until ${fmtDay(j.end_date)}</span>`}</span></span>
    <span class="muted" style=${{ fontSize: '20px', alignSelf: 'center' }}>›</span>
  </a>`;
}

export function Jobs() {
  const [filter, setFilter] = useState('upcoming');
  const [q, setQ] = useState('');
  const mineOnly = scope('jobs') !== 'all';
  const [data] = useLoad('/jobs', ['jobs']);
  const today = todayISO();
  const all = data?.jobs || [];
  const match = (j) => !q || [j.number, j.title, j.contact_name, j.address].some((v) => String(v || '').toLowerCase().includes(q.toLowerCase()));
  const sets = {
    upcoming: all.filter((j) => j.date && (j.end_date || j.date) >= today && !['signed_off', 'cancelled'].includes(j.status)),
    unscheduled: all.filter((j) => !j.date && !['signed_off', 'cancelled'].includes(j.status)),
    signoff: all.filter((j) => j.status === 'completed'),
    late: all.filter((j) => j.date && (j.end_date || j.date) < today && !['signed_off', 'cancelled', 'completed'].includes(j.status)),
    done: all.filter((j) => j.status === 'signed_off').reverse(),
    all,
  };
  const rows = (sets[filter] || []).filter(match);
  const byDay = {};
  for (const j of rows) (byDay[filter === 'upcoming' ? (j.date < today ? today : j.date) : j.date || 'TBC'] ||= []).push(j);
  return html`<div class="page">
    <${PageHead} eyebrow="Operations" title=${mineOnly ? 'My installations' : 'Installations'} sub=${mineOnly ? 'Your jobs — tap one to start, add photos and get the customer’s sign-off.' : 'Schedule the team, follow progress on site and get the customer’s sign-off.'}>
      <a class="btn ghost" href="#/calendar"><${Icon} name="calendar" size=${15} /> Calendar</a>
    <//>
    <div class="toolbar"><${SearchBox} value=${q} onInput=${setQ} placeholder="Customer, job, area…" />
      <${Chips} value=${filter} onChange=${setFilter} options=${[['upcoming', 'Upcoming', sets.upcoming.length], ['late', 'Overdue', sets.late.length || null], !mineOnly && ['unscheduled', 'Not scheduled', sets.unscheduled.length], ['signoff', 'Awaiting sign-off', sets.signoff.length], ['done', 'Done'], ['all', 'All']]} /></div>
    ${!data ? html`<${Spinner} />` : !rows.length ? html`<div class="card"><${Empty} icon="tool" title="No jobs here">${filter === 'upcoming' ? 'Installations are scheduled from a won deal (Deal → Installation).' : ''}<//></div>`
      : Object.entries(byDay).map(([day, list]) => html`<p class="section-title" style=${{ margin: '16px 0 8px' }}>${day === 'TBC' ? 'Date to be confirmed' : day === today ? 'Today' : day === addDays(today, 1) ? 'Tomorrow' : fmtDay(day)}</p>${list.map((j) => html`<${JobCard} j=${j} />`)}`)}
  </div>`;
}

export function JobView({ id }) {
  const [data, reload, err] = useLoad(`/jobs/${id}`, ['jobs', 'files']);
  const [modal, setModal] = useState(null);
  const [view, setView] = useState(null);
  const [busy, run] = useAction();
  if (err) return html`<div class="page"><h1>Job not found</h1><a class="link" href="#/jobs">Back</a></div>`;
  if (!data) return html`<div class="page"><${Spinner} /></div>`;
  const { job: j, contact: c } = data;
  const me = store.get().me;
  const mine = j.installers.includes(me.id);
  const manage = can('jobs', 'create') || scope('jobs') === 'all';
  const canWork = can('jobs', 'edit') && !['signed_off', 'cancelled'].includes(j.status);
  const photos = data.files.filter((f) => ['before', 'after', 'site_photo'].includes(f.kind));
  const signature = data.files.find((f) => f.kind === 'signature');
  async function setStatus(status) {
    const pos = status === 'in_progress' ? await getPosition() : null;
    const r = await run(() => api(`/jobs/${j.id}/status`, { method: 'POST', body: { status, ...(pos || {}) } }).then((x) => { reload(); return x; }), { on_the_way: '🚐 On the way', in_progress: '▶ Job started', completed: '✅ Marked complete — now get the sign-off' }[status]);
    if (r?.whatsapp && confirm('Send the customer a WhatsApp that you are on the way?')) openExternal(r.whatsapp);
  }
  const signText = `Hello ${c?.contact_person || c?.name || ''}, thank you for choosing ${company().name || 'Crystal Shield'}. Please check the installation and sign off here: ${j.sign_url}`;
  return html`<div class="page narrow">
    <a class="back-link" href=${manage && j.deal_id ? `#/deals/${j.deal_id}` : '#/jobs'}><${Icon} name="back" size=${15} /> ${manage && data.deal ? data.deal.title : 'Installations'}</a>
    <div class="job-hero">
      <div class="row"><${Badge}>${j.number}<//><${Badge}>${JOB_STATUS[j.status].label}<//><span class="spacer" /><${AvatarStack} ids=${j.installers} size=${26} /></div>
      <h1>${c?.name || j.title}</h1>
      <div class="sub">${j.date ? `${fmtDay(j.date)}${j.end_date && j.end_date !== j.date ? ` → ${fmtDay(j.end_date)}` : ''}${j.start_time ? ` · ${t12(j.start_time)}${j.end_time ? `–${t12(j.end_time)}` : ''}` : ''}` : 'Date to be confirmed'}</div>
      <div class="sub" style=${{ margin: '4px 0 12px' }}>📍 ${j.address || '—'}</div>
      <${ContactActions} c=${{ ...c, location_url: j.location_url || c?.location_url, address: j.address }} />
    </div>

    ${canWork && (mine || manage) && html`<div class="next-step">
      ${j.status === 'scheduled' && html`<button class="btn ghost big block" disabled=${busy} onClick=${() => setStatus('on_the_way')}>🚐 On my way</button><button class="btn primary big block" disabled=${busy} onClick=${() => setStatus('in_progress')}>▶ Start job</button>`}
      ${j.status === 'on_the_way' && html`<button class="btn primary big block" disabled=${busy} onClick=${() => setStatus('in_progress')}>▶ Arrived — start job</button>`}
      ${j.status === 'in_progress' && html`<button class="btn success big block" disabled=${busy} onClick=${() => {
        if (!data.files.some((f) => f.kind === 'after') && !confirm('No “after” photos yet. Mark complete anyway?')) return;
        setStatus('completed');
      }}>✅ Work completed</button>`}
      ${j.status === 'completed' && html`<button class="btn amber big block" onClick=${() => setModal('sign')}>✍️ Customer sign-off on this phone</button>
        <div class="row"><a class="btn wa block" style=${{ flex: 1 }} href=${waLink(c?.whatsapp || c?.phone, signText)} target="_blank" rel="noopener"><${WaIcon} /> Send sign-off link</a><${Copy} text=${j.sign_url} label="Copy link" /></div>`}
    </div>`}
    ${j.status === 'signed_off' && html`<div class="callout ok" style=${{ marginBottom: '14px' }}><span style=${{ fontSize: '22px' }}>✍️</span><span class="grow"><b>Signed off by ${j.signed_name}</b> · ${fmtDateTime(j.signed_at)}${j.rating ? ` · ${'★'.repeat(j.rating)}${'☆'.repeat(5 - j.rating)}` : ''}${j.feedback && html`<br /><i>“${j.feedback}”</i>`}</span>
      ${signature && html`<img src=${`/api/files/${signature.id}`} alt="Signature" style=${{ height: '48px', background: '#fff', borderRadius: '8px', padding: '2px 6px' }} />`}</div>`}

    ${j.instructions && html`<div class="card" style=${{ marginBottom: '14px', background: 'var(--amber-bg)', borderColor: '#f5d39b' }}><p class="section-title">Instructions</p><p style=${{ margin: 0, whiteSpace: 'pre-wrap' }}>${j.instructions}</p></div>`}
    ${j.scope.length > 0 && html`<div class="card" style=${{ marginBottom: '14px' }}><p class="section-title">What to install</p><div class="list-rows">${j.scope.map((s) => html`<div class="list-row"><span class="ico-sq">🪟</span><span class="grow"><b>${s.name}</b>${s.description && html`<small style=${{ whiteSpace: 'pre-wrap' }}>${s.description}</small>`}</span><b>${qty(s.qty)} ${s.unit}</b></div>`)}</div></div>`}

    <div class="card" style=${{ marginBottom: '14px' }}><p class="section-title">Photos</p>
      <${PhotoStrip} job=${j} photos=${photos} canAdd=${can('jobs', 'edit') && (mine || manage)} onView=${setView} onChanged=${reload} /></div>

    ${j.checklist.length > 0 && html`<div class="card" style=${{ marginBottom: '14px' }}><p class="section-title">Checklist</p><ul class="checklist">${j.checklist.map((it, i) => html`<li><label class=${it.done ? 'done' : ''}>
      <input type="checkbox" checked=${it.done} disabled=${!canWork} onChange=${(e) => api(`/jobs/${j.id}/checklist`, { method: 'PATCH', body: { index: i, done: e.target.checked } }).then(reload).catch(errToast)} /><span>${it.text}</span></label></li>`)}</ul></div>`}

    ${data.materials.length > 0 && html`<${Materials} job=${j} rows=${data.materials} editable=${can('jobs', 'edit') && (mine || manage) && (j.status !== 'signed_off' || me.perms.admin)} onSaved=${reload} />`}

    ${data.warranties.length > 0 && html`<div class="card" style=${{ marginBottom: '14px' }}><p class="section-title">Warranty cards</p><div class="list-rows">${data.warranties.map((w) => html`<div class="list-row"><span class="ico-sq">🛡</span><span class="grow"><b>${w.number} · ${w.description}</b><small>${w.years} years · until ${fmtDate(w.end_date)} · ${qty(w.sqm)} SQM</small></span>
      <a class="btn ghost small" href=${w.url} target="_blank" rel="noopener">View</a><a class="btn wa small" href=${waLink(c?.whatsapp || c?.phone, `Hello ${c?.contact_person || c?.name || ''}, here is your warranty card ${w.number} from ${company().name || 'Crystal Shield'}: ${w.url}`)} target="_blank" rel="noopener"><${WaIcon} size=${13} /></a></div>`)}</div></div>`}

    <div class="card" style=${{ marginBottom: '14px' }}><div class="card-head"><p class="section-title" style=${{ margin: 0 }}>Notes & history</p><a class="btn ghost small" href=${`#/chat/j:${j.id}`}><${Icon} name="chat" size=${14} /> Job chat</a></div>
      <${NoteComposer} kinds=${['note']} followUp=${false} placeholder="Site note: issue found, extra glass, customer request…" onSubmit=${(b) => api(`/jobs/${j.id}/notes`, { method: 'POST', body: b }).then(reload)} /><${Timeline} items=${data.timeline} /></div>

    ${manage && html`<div class="card"><p class="section-title">Office</p><div class="btn-row">
      ${j.status !== 'signed_off' && html`<button class="btn ghost" onClick=${() => setModal('schedule')}><${Icon} name="calendar" size=${15} /> Reschedule / team</button>`}
      ${data.deal && html`<a class="btn ghost" href=${`#/deals/${data.deal.id}`}>Deal ${data.deal.code}</a>`}
      ${['scheduled', 'on_the_way'].includes(j.status) && html`<button class="btn ghost" onClick=${() => run(() => api(`/jobs/${j.id}`, { method: 'PATCH', body: { status: 'on_hold' } }).then(reload))}>Put on hold</button>`}
      ${j.status === 'on_hold' && html`<button class="btn ghost" onClick=${() => run(() => api(`/jobs/${j.id}`, { method: 'PATCH', body: { status: 'scheduled' } }).then(reload))}>Resume</button>`}
      ${!['signed_off', 'cancelled'].includes(j.status) && html`<button class="btn danger-ghost" onClick=${() => confirm('Cancel this installation?') && run(() => api(`/jobs/${j.id}`, { method: 'PATCH', body: { status: 'cancelled' } }).then(reload))}>Cancel job</button>`}
      ${can('jobs', 'delete') && j.status !== 'signed_off' && html`<button class="btn danger-ghost" onClick=${() => confirm('Delete this job?') && run(() => api(`/jobs/${j.id}`, { method: 'DELETE' }).then(() => go('jobs')))}>Delete</button>`}
      ${data.expenses.length > 0 && html`<span class="muted small">Job expenses: ${aed(data.expenses.reduce((s, e) => s + e.total, 0))}</span>`}
    </div></div>`}
    ${modal === 'sign' && html`<${SignOff} job=${j} contact=${c} onClose=${() => setModal(null)} onDone=${reload} />`}
    ${modal === 'schedule' && html`<${JobModal} job=${j} onClose=${() => setModal(null)} onSaved=${reload} />`}
    ${view && html`<${Lightbox} file=${view} onClose=${() => setView(null)} />`}
  </div>`;
}

function PhotoStrip({ job, photos, canAdd, onView, onChanged }) {
  const [kind, setKind] = useState(['scheduled', 'on_the_way'].includes(job.status) || (job.status === 'in_progress' && !photos.some((p) => p.kind === 'before')) ? 'before' : 'after');
  const [busy, setBusy] = useState(0);
  const input = useRef();
  async function add(files) {
    for (const f of [...files]) {
      setBusy((n) => n + 1);
      try { await upload(`/files?entity=job&id=${job.id}&kind=${kind}`, await shrinkImage(f), { name: `${kind}-${f.name}` }); } catch (e) { errToast(e); }
      setBusy((n) => n - 1);
    }
    onChanged();
  }
  return html`<div class="stack" style=${{ gap: '10px' }}>
    ${canAdd && html`<div class="seg" style=${{ alignSelf: 'flex-start' }}><button class=${kind === 'before' ? 'on' : ''} onClick=${() => setKind('before')}>Before</button><button class=${kind === 'after' ? 'on' : ''} onClick=${() => setKind('after')}>After</button></div>`}
    <div class="photo-strip">
      ${canAdd && html`<button class="photo-add" onClick=${() => input.current.click()}><span><${Icon} name="camera" size=${22} /><br />${busy ? `Uploading ${busy}…` : `Add ${kind} photo`}</span></button>
        <input ref=${input} type="file" accept="image/*" capture="environment" multiple hidden onChange=${(e) => { add(e.target.files); e.target.value = ''; }} />`}
      ${photos.map((p) => html`<button class="ph" style=${{ padding: 0, cursor: 'zoom-in' }} onClick=${() => onView(p)}><img src=${`/api/files/${p.id}`} alt="" loading="lazy" /><span>${p.kind.replace('_', ' ')}</span></button>`)}
    </div>
    ${!photos.length && !canAdd && html`<p class="muted small">No photos yet.</p>`}
  </div>`;
}

function Materials({ job, rows, editable, onSaved }) {
  const [vals, setVals] = useState(Object.fromEntries(rows.map((m) => [m.id, m.used_qty ?? ''])));
  const [busy, run] = useAction();
  const dirty = rows.some((m) => String(m.used_qty ?? '') !== String(vals[m.id]));
  return html`<div class="card" style=${{ marginBottom: '14px' }}><p class="section-title">Film & materials</p>
    <table class="table compact"><thead><tr><th>Item</th><th class="r">Take</th><th class="r">Used</th></tr></thead><tbody>${rows.map((m) => html`<tr><td>${m.name}<span class="sub">${m.code} · ${qty(m.stock)} ${m.unit} in stock</span></td><td class="r">${qty(m.planned_qty)} ${m.unit}</td>
      <td class="r">${editable ? html`<input type="number" inputmode="decimal" step="0.1" value=${vals[m.id]} placeholder=${qty(m.planned_qty)} onInput=${(e) => setVals({ ...vals, [m.id]: e.target.value })} style=${{ width: '96px', textAlign: 'right' }} />` : m.used_qty != null ? qty(m.used_qty) : '—'}</td></tr>`)}</tbody></table>
    ${editable && html`<div class="row" style=${{ marginTop: '8px' }}><span class="muted small">Enter what was actually used (incl. offcuts). Blank = planned amount.</span><span class="spacer" /><button class="btn primary small" disabled=${!dirty || busy} onClick=${() => run(() => api(`/jobs/${job.id}/materials`, { method: 'PUT', body: { materials: rows.map((m) => ({ id: m.id, used_qty: vals[m.id] })) } }).then(onSaved), 'Saved')}>Save</button></div>`}
  </div>`;
}

export function SignaturePad({ onChange }) {
  const ref = useRef();
  const state = useRef({ drawing: false, inked: false });
  useEffect(() => {
    const c = ref.current; const ctx = c.getContext('2d');
    const fit = () => { const r = c.getBoundingClientRect(); const d = window.devicePixelRatio || 1; c.width = r.width * d; c.height = r.height * d; ctx.scale(d, d); ctx.lineWidth = 2.4; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#141c2f'; };
    fit();
    const pt = (e) => { const r = c.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    const down = (e) => { state.current.drawing = true; state.current.inked = true; ctx.beginPath(); ctx.moveTo(...pt(e)); c.setPointerCapture(e.pointerId); };
    const move = (e) => { if (!state.current.drawing) return; ctx.lineTo(...pt(e)); ctx.stroke(); };
    const up = () => { if (state.current.drawing) { state.current.drawing = false; onChange(c.toDataURL('image/png')); } };
    c.addEventListener('pointerdown', down); c.addEventListener('pointermove', move); c.addEventListener('pointerup', up);
    return () => { c.removeEventListener('pointerdown', down); c.removeEventListener('pointermove', move); c.removeEventListener('pointerup', up); };
  }, []);
  const clear = () => { const c = ref.current; c.getContext('2d').clearRect(0, 0, c.width, c.height); state.current.inked = false; onChange(null); };
  return html`<div><canvas ref=${ref} class="sigpad" /><div class="row" style=${{ marginTop: '6px' }}><span class="muted small">Sign with a finger</span><span class="spacer" /><button type="button" class="btn ghost small" onClick=${clear}>Clear</button></div></div>`;
}

function SignOff({ job, contact, onClose, onDone }) {
  const [name, setName] = useState(contact?.contact_person || contact?.name || '');
  const [rating, setRating] = useState(5);
  const [feedback, setFeedback] = useState('');
  const [sig, setSig] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true); setError('');
    try { await api(`/jobs/${job.id}/signoff`, { method: 'POST', body: { name, rating, feedback, signature: sig } }); toast('✍️ Signed off — warranty created'); onDone(); onClose(); } catch (e) { setError(e.message); }
    setBusy(false);
  }
  return html`<${Modal} title="Customer sign-off" onClose=${onClose}>
    <div class="form">
      <p class="muted" style=${{ margin: 0 }}>Hand the phone to the customer. By signing, they confirm the installation of ${job.number} is complete and to their satisfaction.</p>
      <${Field} label="Customer name"><input value=${name} onInput=${(e) => setName(e.target.value)} /><//>
      <${Field} label="How happy are you with the work?"><div class="stars">${[1, 2, 3, 4, 5].map((n) => html`<button type="button" class=${n <= rating ? 'on' : ''} onClick=${() => setRating(n)} aria-label=${`${n} stars`}>★</button>`)}</div><//>
      <${Field} label="Comments (optional)"><textarea rows="2" value=${feedback} onInput=${(e) => setFeedback(e.target.value)} /><//>
      <${Field} label="Signature"><${SignaturePad} onChange=${setSig} /><//>
      <${ErrorText} error=${error} />
      <div class="form-actions"><button class="btn ghost" onClick=${onClose}>Cancel</button><button class="btn success big" disabled=${busy || !sig || !name.trim()} onClick=${save}>✓ Confirm & sign</button></div>
    </div>
  <//>`;
}
