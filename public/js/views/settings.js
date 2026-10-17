import { useState, useEffect, useRef } from 'preact/hooks';
import { html, api, upload, useLoad, useStore, can, toast, errToast, loadSettings, fmtDateTime, fileSize, hashParam, setHashParam } from '../lib.js';
import { Icon, Field, ErrorText, Spinner, PageHead, Tabs, useAction, Copy, UserMulti } from '../ui.js';

export function Settings() {
  const [tab, setTabS] = useState(hashParam('tab') || 'company');
  const setTab = (t) => { setTabS(t); setHashParam('tab', t === 'company' ? null : t); };
  const [data, reload] = useLoad('/settings', ['settings']);
  if (!data) return html`<div class="page"><${Spinner} /></div>`;
  return html`<div class="page">
    <${PageHead} eyebrow="Admin" title="Settings" />
    <${Tabs} value=${tab} onChange=${setTab} tabs=${[['company', 'Company'], ['docs', 'Quotes & invoices'], ['leads', 'Lead capture'], ['auto', 'Follow-ups'], ['lists', 'Lists'], ['numbers', 'Numbering'], ['email', 'Email & WhatsApp'], ['backup', 'Backups']]} />
    ${tab === 'company' && html`<${Company} data=${data} reload=${reload} />`}
    ${tab === 'docs' && html`<${Docs} data=${data} reload=${reload} />`}
    ${tab === 'leads' && html`<${Leads} data=${data} reload=${reload} />`}
    ${tab === 'auto' && html`<${Auto} data=${data} reload=${reload} />`}
    ${tab === 'lists' && html`<${Lists} data=${data} reload=${reload} />`}
    ${tab === 'numbers' && html`<${Numbers} data=${data} reload=${reload} />`}
    ${tab === 'email' && html`<${EmailWa} />`}
    ${tab === 'backup' && html`<${Backups} />`}
  </div>`;
}
function useSection(initial, key, reload) {
  const [f, setF] = useState(initial);
  const [busy, run] = useAction();
  const save = (extra) => run(() => api('/settings', { method: 'PATCH', body: { [key]: { ...f, ...extra } } }).then(() => { reload(); loadSettings(); }), 'Saved');
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  return { f, setF, set, save, busy };
}
const SaveBar = ({ save, busy }) => html`<div class="form-actions" style=${{ marginTop: '14px' }}><button class="btn primary" disabled=${busy} onClick=${() => save()}>Save</button></div>`;

function Company({ data, reload }) {
  const { f, set, save, busy } = useSection(data.company, 'company', reload);
  const input = useRef();
  const [, run] = useAction();
  return html`<div class="stack"><div class="card"><div class="card-head"><h2>Logo</h2></div><div class="row">
      <img src=${data.logo || '/img/logo-dark.png'} alt="" style=${{ height: '44px', maxWidth: '260px', objectFit: 'contain', background: '#fff', padding: '6px', borderRadius: '8px', border: '1px solid var(--line)' }} />
      <button class="btn ghost small" onClick=${() => input.current.click()}>Upload logo</button>${data.logo && html`<button class="btn ghost small" onClick=${() => run(() => api('/settings/logo', { method: 'DELETE' }).then(reload))}>Use default</button>`}
      <input ref=${input} type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" hidden onChange=${(e) => e.target.files[0] && run(() => upload('/settings/logo', e.target.files[0]).then(reload), 'Logo updated')} />
      <span class="muted small">Shown on quotations, invoices, receipts, purchase orders and warranty cards.</span></div></div>
    <div class="card"><h2 style=${{ marginBottom: '12px' }}>Company details (on documents)</h2><div class="form-grid two">
      <${Field} label="Short name"><input value=${f.name} onInput=${set('name')} /><//><${Field} label="Legal name"><input value=${f.legal_name} onInput=${set('legal_name')} /><//>
      <${Field} label="TRN (VAT number)"><input value=${f.trn} onInput=${set('trn')} /><//><${Field} label="Trade licence no."><input value=${f.license_no} onInput=${set('license_no')} /><//>
      <${Field} label="Address"><input value=${f.address} onInput=${set('address')} /><//><${Field} label="Phone"><input value=${f.phone} onInput=${set('phone')} /><//>
      <${Field} label="Email"><input value=${f.email} onInput=${set('email')} /><//><${Field} label="Website"><input value=${f.website} onInput=${set('website')} /><//>
      <${Field} label="Tagline"><input value=${f.tagline} onInput=${set('tagline')} /><//><${Field} label="Partner / certification line"><input value=${f.partner_line} onInput=${set('partner_line')} /><//></div>
      <h3 style=${{ margin: '18px 0 10px' }}>Bank details (shown on invoices)</h3><div class="form-grid two">
      <${Field} label="Bank"><input value=${f.bank_name} onInput=${set('bank_name')} /><//><${Field} label="Account name"><input value=${f.bank_account_name} onInput=${set('bank_account_name')} /><//>
      <${Field} label="Account number"><input value=${f.bank_account_no} onInput=${set('bank_account_no')} /><//><${Field} label="IBAN"><input value=${f.bank_iban} onInput=${set('bank_iban')} /><//><${Field} label="SWIFT"><input value=${f.bank_swift} onInput=${set('bank_swift')} /><//></div>
      <${SaveBar} save=${save} busy=${busy} /></div></div>`;
}
function Docs({ data, reload }) {
  const { f, set, save, busy } = useSection(data.docs, 'docs', reload);
  return html`<div class="card"><div class="form-grid">
      <${Field} label="VAT rate %"><input type="number" step="0.01" value=${f.vat_rate} onInput=${set('vat_rate')} /><//>
      <${Field} label="Quotation valid for (days)"><input type="number" value=${f.quote_valid_days} onInput=${set('quote_valid_days')} /><//>
      <${Field} label="Invoice due after (days)"><input type="number" value=${f.invoice_due_days} onInput=${set('invoice_due_days')} /><//>
      <${Field} label="Default advance %"><input type="number" value=${f.advance_pct} onInput=${set('advance_pct')} /><//>
      <${Field} label="Cutting allowance (wastage) %" hint="Added to film taken from stock / ordered"><input type="number" value=${f.wastage_pct} onInput=${set('wastage_pct')} /><//>
      <${Field} label="Measurement unit"><select value=${f.default_unit} onChange=${set('default_unit')}>${['cm', 'mm', 'm', 'in', 'ft'].map((u) => html`<option>${u}</option>`)}</select><//>
      <${Field} label="Film leaves stock when…"><select value=${f.stock_mode} onChange=${set('stock_mode')}><option value="job">The installation is signed off (actual film used)</option><option value="invoice">The invoice is issued</option></select><//></div>
    <div class="form-grid" style=${{ gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', marginTop: '12px' }}>
      <${Field} label="Quotation introduction"><textarea rows="4" value=${f.quote_intro} onInput=${set('quote_intro')} /><//>
      <${Field} label="Quotation remarks (one per line)"><textarea rows="4" value=${f.quote_remarks} onInput=${set('quote_remarks')} /><//>
      <${Field} label="Quotation terms (one per line)"><textarea rows="6" value=${f.quote_terms} onInput=${set('quote_terms')} /><//>
      <${Field} label="Invoice payment terms"><textarea rows="4" value=${f.invoice_terms} onInput=${set('invoice_terms')} /><//></div>
    <${SaveBar} save=${save} busy=${busy} /></div>`;
}
function Leads({ data, reload }) {
  const s = useStore();
  const a = useSection(data.automation, 'automation', reload);
  const [meta, setMeta] = useState({ verify_token: data.meta?.verify_token || '', page_token: '' });
  const [wa, setWa] = useState({ verify_token: data.wa_inbound?.verify_token || '' });
  const [busy, run] = useAction();
  const ids = String(a.f.lead_assign_ids || '').split(',').map(Number).filter(Boolean);
  const snippet = `<form action="${data.lead_webhook?.url}" method="POST">
  <input name="name" placeholder="Name" required>
  <input name="phone" placeholder="Phone / WhatsApp" required>
  <input name="email" placeholder="Email">
  <select name="service"><option>Solar control film</option><option>Safety & security film</option><option>Privacy / frosted film</option></select>
  <textarea name="message" placeholder="Tell us about your windows"></textarea>
  <input type="hidden" name="source" value="Website">
  <input type="hidden" name="redirect" value="https://www.crystalshield.ae/thank-you">
  <input name="website" style="display:none" tabindex="-1" autocomplete="off">
  <button>Get a free quote</button>
</form>`;
  return html`<div class="stack">
    <div class="card"><h2>Website enquiry form</h2><p class="muted small">Point any website form (abudhabiwindowtint.com, crystalshield.ae, landing pages) at this address. JSON or normal form posts both work; UTM tags set the source automatically (facebook → Meta Ads, google → Google Ads).</p>
      <div class="inline-input"><input readonly value=${data.lead_webhook?.url} class="mono" /><${Copy} text=${data.lead_webhook?.url} /><button class="btn ghost small" onClick=${() => confirm('Old forms stop working until updated. New key?') && run(() => api('/settings/lead-key', { method: 'POST' }).then(reload), 'New key made')}>New key</button></div>
      <details style=${{ marginTop: '10px' }}><summary class="link small" style=${{ cursor: 'pointer' }}>Example HTML form</summary><pre class="card mono" style=${{ whiteSpace: 'pre-wrap', fontSize: '12px', marginTop: '8px' }}>${snippet}</pre><${Copy} text=${snippet} /></details></div>
    <div class="card"><h2>Who gets new leads</h2><p class="muted small">Leads from the website, ads and WhatsApp are shared in turn (round robin). Repeat customers go to their usual owner.</p>
      <label class="check"><input type="checkbox" checked=${a.f.lead_assign === 'round_robin'} onChange=${(e) => a.setF({ ...a.f, lead_assign: e.target.checked ? 'round_robin' : 'none' })} /> Assign automatically in turn</label>
      ${a.f.lead_assign === 'round_robin' && html`<${Field} label="Between (none picked = all sales roles)"><${UserMulti} value=${ids} onChange=${(v) => a.setF({ ...a.f, lead_assign_ids: v.join(',') })} filter=${(u) => u.role_system !== 'installer'} /><//>`}
      <${SaveBar} save=${a.save} busy=${a.busy} /></div>
    <div class="card"><h2>Meta lead ads (Facebook & Instagram)</h2><p class="muted small">In Meta for Developers → your app → Webhooks → Page → subscribe to <b>leadgen</b> with this callback URL and verify token. Then paste a Page access token (with leads_retrieval) below.</p>
      <div class="form-grid two"><${Field} label="Callback URL"><div class="inline-input"><input readonly class="mono" value=${data.meta?.webhook_url} /><${Copy} text=${data.meta?.webhook_url} /></div><//>
        <${Field} label="Verify token"><input value=${meta.verify_token} onInput=${(e) => setMeta({ ...meta, verify_token: e.target.value })} placeholder="any secret word" /><//>
        <${Field} label=${`Page access token ${data.meta?.has_page_token ? '(saved — paste to replace)' : ''}`}><input type="password" value=${meta.page_token} onInput=${(e) => setMeta({ ...meta, page_token: e.target.value })} /><//></div>
      <div class="form-actions"><button class="btn primary" disabled=${busy} onClick=${() => run(() => api('/settings', { method: 'PATCH', body: { meta } }).then(reload), 'Saved')}>Save</button></div></div>
    <div class="card"><h2>WhatsApp Business (incoming messages)</h2><p class="muted small">If the business WhatsApp number runs on the WhatsApp Cloud API, set this webhook (messages field) so every new chat becomes a lead — or a note on the customer’s open lead.</p>
      <div class="form-grid two"><${Field} label="Callback URL"><div class="inline-input"><input readonly class="mono" value=${data.wa_inbound?.webhook_url} /><${Copy} text=${data.wa_inbound?.webhook_url} /></div><//>
        <${Field} label="Verify token"><input value=${wa.verify_token} onInput=${(e) => setWa({ verify_token: e.target.value })} /><//></div>
      <div class="form-actions"><button class="btn primary" disabled=${busy} onClick=${() => run(() => api('/settings', { method: 'PATCH', body: { wa_inbound: wa } }).then(reload), 'Saved')}>Save</button></div></div>
  </div>`;
}
function Auto({ data, reload }) {
  const { f, set, save, busy } = useSection(data.automation, 'automation', reload);
  const row = (on, dk, label, unit, hint) => html`<div class="list-row"><label class="check" style=${{ flex: 1 }}><input type="checkbox" checked=${!!f[on]} onChange=${set(on)} /><span><b>${label}</b><br /><span class="muted small">${hint}</span></span></label>
    ${dk && html`<span class="row" style=${{ gap: '6px' }}><input type="number" min="1" value=${f[dk]} onInput=${set(dk)} style=${{ width: '80px' }} disabled=${!f[on]} /><span class="small muted">${unit}</span></span>`}</div>`;
  return html`<div class="card"><h2 style=${{ marginBottom: '6px' }}>Automatic follow-ups</h2><p class="muted small">Created for the deal owner, shown on their home screen and calendar, each with a ready WhatsApp message.</p>
    <div class="list-rows">
      ${row('quote_on', 'quote_days', 'Chase sent quotations', 'days after sending', 'Closed automatically when the quotation is accepted or declined.')}
      ${row('review_on', 'review_days', 'Ask for a Google review', 'days after sign-off', 'Uses the review link below.')}
      ${row('checkin_on', 'checkin_days', 'Check-in call', 'days after sign-off', '“Is the film performing well?” — good moment to ask for referrals.')}
      ${row('inspection_on', 'inspection_months', 'Free inspection visit', 'months after sign-off', 'Keeps customers coming back for more rooms.')}
      ${row('warranty_on', 'warranty_days', 'Warranty ending', 'days before it ends', 'Offer an inspection or upgrade.')}
      ${row('payment_on', null, 'Chase overdue invoices', '', 'Every morning, overdue invoices get a payment follow-up for accounts.')}
    </div>
    <${Field} label="Google review link"><input value=${f.review_link} onInput=${set('review_link')} placeholder="https://g.page/r/…/review" /><//>
    <${SaveBar} save=${save} busy=${busy} /></div>`;
}
function Lists({ data, reload }) {
  const [f, setF] = useState(Object.fromEntries(Object.entries(data.lists).map(([k, v]) => [k, v.join('\n')])));
  const [busy, run] = useAction();
  const L = { sources: 'Lead sources', property_types: 'Property types', services: 'Services', tags: 'Customer tags', lost_reasons: 'Lost reasons', cities: 'Cities / emirates', job_checklist: 'Installation checklist' };
  return html`<div class="card"><p class="muted small" style=${{ marginTop: 0 }}>One per line. These fill the drop-downs across the hub.</p>
    <div class="form-grid" style=${{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>${Object.entries(L).map(([k, l]) => html`<${Field} label=${l}><textarea rows="8" value=${f[k]} onInput=${(e) => setF({ ...f, [k]: e.target.value })} /><//>`)}</div>
    <div class="form-actions" style=${{ marginTop: '12px' }}><button class="btn primary" disabled=${busy} onClick=${() => run(() => api('/settings', { method: 'PATCH', body: { lists: f } }).then(() => { reload(); loadSettings(); }), 'Saved')}>Save</button></div></div>`;
}
function Numbers({ data, reload }) {
  const [f, setF] = useState(data.numbering);
  const [busy, run] = useAction();
  const L = { quote: 'Quotations', invoice: 'Invoices', payment: 'Receipts', po: 'Purchase orders', grn: 'Goods received', vendor_payment: 'Supplier payments', expense: 'Expenses', journal: 'Auto journals', manual_journal: 'Manual journals', job: 'Installations', warranty: 'Warranties', claim: 'Claims', lead: 'Leads', deal: 'Deals', contact: 'Customers', product: 'Products' };
  return html`<div class="card"><p class="muted small" style=${{ marginTop: 0 }}>{YYYY} becomes the current year. Change the next number to continue from your old system.</p>
    <table class="table compact" style=${{ maxWidth: '620px' }}><thead><tr><th>Document</th><th>Prefix</th><th>Next number</th><th>Looks like</th></tr></thead><tbody>${Object.entries(L).map(([k, l]) => html`<tr><td>${l}</td>
      <td><input value=${f[k].prefix} onInput=${(e) => setF({ ...f, [k]: { ...f[k], prefix: e.target.value } })} style=${{ width: '130px' }} /></td><td><input type="number" value=${f[k].next} onInput=${(e) => setF({ ...f, [k]: { ...f[k], next: e.target.value } })} style=${{ width: '110px' }} /></td>
      <td class="mono muted">${f[k].prefix.replace('{YYYY}', new Date().getFullYear())}${f[k].next}</td></tr>`)}</tbody></table>
    <div class="form-actions"><button class="btn primary" disabled=${busy} onClick=${() => run(() => api('/settings', { method: 'PATCH', body: { numbering: f } }).then(reload), 'Saved')}>Save</button></div></div>`;
}
function EmailWa() {
  const [mail, setMail] = useState(null);
  const [wa, setWa] = useState(null);
  const [busy, run] = useAction();
  useEffect(() => { api('/email/settings').then((d) => setMail({ ...d, pass: '' })).catch(errToast); api('/whatsapp/settings').then((d) => setWa({ ...d, token: '' })).catch(errToast); }, []);
  if (!mail || !wa) return html`<${Spinner} />`;
  return html`<div class="stack">
    <div class="card"><h2>Email (company mailbox)</h2><p class="muted small">Used to email quotations, invoices and POs to customers and suppliers, and for notifications when someone is offline.</p>
      <div class="form-grid two"><${Field} label="SMTP server"><input value=${mail.host} onInput=${(e) => setMail({ ...mail, host: e.target.value })} placeholder="smtp.office365.com / mail.spacemail.com" /><//>
        <${Field} label="Port"><input type="number" value=${mail.port} onInput=${(e) => setMail({ ...mail, port: e.target.value })} /><//>
        <${Field} label="Username"><input value=${mail.user} onInput=${(e) => setMail({ ...mail, user: e.target.value })} placeholder="hub@crystalshield.ae" /><//>
        <${Field} label=${`Password ${mail.has_password ? '(saved)' : ''}`}><input type="password" value=${mail.pass} onInput=${(e) => setMail({ ...mail, pass: e.target.value })} /><//>
        <${Field} label="From"><input value=${mail.from} onInput=${(e) => setMail({ ...mail, from: e.target.value })} placeholder="Crystal Shield <enquiry@crystalshield.ae>" /><//></div>
      <label class="check" style=${{ marginTop: '10px' }}><input type="checkbox" checked=${mail.enabled} onChange=${(e) => setMail({ ...mail, enabled: e.target.checked })} /> Email on</label>
      <div class="form-actions"><button class="btn ghost" disabled=${busy} onClick=${() => run(() => api('/email/test', { method: 'POST' }).then((r) => toast(`Test sent to ${r.to}`)))}>Send test</button><button class="btn primary" disabled=${busy} onClick=${() => run(() => api('/email/settings', { method: 'PATCH', body: mail }), 'Saved')}>Save</button></div></div>
    <div class="card"><h2>WhatsApp alerts to staff</h2><p class="muted small">Optional: important alerts (new lead, job assigned, payment) reach staff on WhatsApp when they’re not in the hub. Needs a WhatsApp Business Cloud API number and an approved template with two text variables (title, details).</p>
      <div class="form-grid two"><${Field} label="Phone number ID"><input value=${wa.phone_id} onInput=${(e) => setWa({ ...wa, phone_id: e.target.value })} /><//>
        <${Field} label=${`Access token ${wa.has_token ? '(saved)' : ''}`}><input type="password" value=${wa.token} onInput=${(e) => setWa({ ...wa, token: e.target.value })} /><//>
        <${Field} label="Template name"><input value=${wa.template} onInput=${(e) => setWa({ ...wa, template: e.target.value })} /><//><${Field} label="Language"><input value=${wa.lang} onInput=${(e) => setWa({ ...wa, lang: e.target.value })} /><//></div>
      <label class="check" style=${{ marginTop: '10px' }}><input type="checkbox" checked=${wa.enabled} onChange=${(e) => setWa({ ...wa, enabled: e.target.checked })} /> WhatsApp alerts on</label>
      <div class="form-actions"><button class="btn ghost" disabled=${busy} onClick=${() => run(() => api('/whatsapp/test', { method: 'POST', body: {} }).then((r) => toast(`Test sent to ${r.to}`)))}>Send test to me</button><button class="btn primary" disabled=${busy} onClick=${() => run(() => api('/whatsapp/settings', { method: 'PATCH', body: wa }), 'Saved')}>Save</button></div></div>
  </div>`;
}
function Backups() {
  const [d, reload] = useLoad('/backups');
  const [busy, run] = useAction();
  if (!d) return html`<${Spinner} />`;
  return html`<div class="card"><div class="card-head"><div><h2>Backups</h2><p class="muted small" style=${{ margin: '2px 0 0' }}>A full copy of the database every night at 02:00 (last ${d.keep} kept). Last: ${d.last_at ? fmtDateTime(d.last_at) : 'not yet'}.</p></div>
    <button class="btn primary" disabled=${busy} onClick=${() => run(() => api('/backups/run', { method: 'POST' }).then(reload), 'Backup made')}>Back up now</button></div>
    <div class="list-rows">${d.backups.map((b) => html`<div class="list-row"><span class="ico-sq">💾</span><span class="grow"><b>${b.name}</b><small>${fmtDateTime(b.at)} · ${fileSize(b.size)}</small></span><a class="btn ghost small" href=${`/api/backups/${b.name}`}><${Icon} name="download" size=${14} /> Download</a></div>`)}</div></div>`;
}
