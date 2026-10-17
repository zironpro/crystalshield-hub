import { useState, useEffect, useRef } from 'preact/hooks';
import { html, api, upload, useStore, store, toast, errToast, logout, chime } from '../lib.js';
import { Icon, Avatar, Field, ErrorText, PageHead, useAction } from '../ui.js';
import { pushSupported, pushStatus, enablePush, disablePush, isIOS, isStandalone, canPromptInstall, promptInstall } from '../pwa.js';

export function Profile() {
  const s = useStore();
  const me = s.me;
  const [f, setF] = useState({ name: me.name, title: me.title, phone: me.phone });
  const [pw, setPw] = useState({ current_password: '', new_password: '' });
  const [wa, setWa] = useState(me.whatsapp || '');
  const [push, setPush] = useState(null);
  const [error, setError] = useState('');
  const [busy, run] = useAction();
  const input = useRef();
  useEffect(() => { if (pushSupported()) pushStatus().then(setPush).catch(() => {}); }, []);
  const saveMe = (body, msg = 'Saved') => run(() => api('/me', { method: 'PATCH', body }).then((r) => store.set({ me: r.user })), msg);
  async function photo(file) {
    const c = document.createElement('canvas'); const bmp = await createImageBitmap(file); const n = Math.min(bmp.width, bmp.height);
    c.width = c.height = 320; c.getContext('2d').drawImage(bmp, (bmp.width - n) / 2, (bmp.height - n) / 2, n, n, 0, 0, 320, 320);
    const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.85));
    run(() => upload('/me/avatar', new File([blob], 'me.jpg', { type: 'image/jpeg' })).then((r) => store.set({ me: r.user })), 'Photo updated');
  }
  return html`<div class="page narrow">
    <${PageHead} title="My profile" />
    <div class="card row" style=${{ marginBottom: '16px' }}><${Avatar} user=${me} size=${64} /><span style=${{ flex: 1 }}><h2>${me.name}</h2><span class="muted">${me.role} · ${me.email}</span></span>
      <button class="btn ghost small" onClick=${() => input.current.click()}><${Icon} name="camera" size=${14} /> Photo</button><input ref=${input} type="file" accept="image/*" hidden onChange=${(e) => e.target.files[0] && photo(e.target.files[0])} /></div>
    <div class="card" style=${{ marginBottom: '16px' }}><div class="form-grid two"><${Field} label="Name"><input value=${f.name} onInput=${(e) => setF({ ...f, name: e.target.value })} /><//><${Field} label="Job title"><input value=${f.title} onInput=${(e) => setF({ ...f, title: e.target.value })} /><//><${Field} label="Phone"><input value=${f.phone} onInput=${(e) => setF({ ...f, phone: e.target.value })} /><//></div>
      <div class="form-actions" style=${{ marginTop: '12px' }}><button class="btn primary" disabled=${busy} onClick=${() => saveMe(f)}>Save</button></div></div>
    <div class="card" style=${{ marginBottom: '16px' }}><h2 style=${{ marginBottom: '10px' }}>Notifications</h2><div class="stack">
      <label class="check"><input type="checkbox" checked=${me.email_notify} onChange=${(e) => saveMe({ email_notify: e.target.checked })} /> Email me when I’m not in the hub</label>
      <label class="check"><input type="checkbox" checked=${me.sound} onChange=${(e) => saveMe({ sound: e.target.checked })} /> Sound for new alerts <button class="link-btn small" onClick=${(e) => { e.preventDefault(); chime('important', true); }}>test</button></label>
      ${push && html`<div class="row"><span class="grow" style=${{ flex: 1 }}><b>Phone / desktop alerts</b><br /><span class="muted small">${push.subscribed ? 'On for this device' : push.permission === 'denied' ? 'Blocked in this browser — allow notifications for this site in the browser settings' : 'Off on this device'}</span></span>
        ${push.subscribed ? html`<button class="btn ghost small" onClick=${() => run(() => disablePush().then(() => pushStatus().then(setPush)), 'Turned off')}>Turn off</button><button class="btn ghost small" onClick=${() => run(() => api('/push/test', { method: 'POST' }), 'Test sent')}>Test</button>`
          : push.permission !== 'denied' && html`<button class="btn primary small" onClick=${() => run(() => enablePush().then(() => pushStatus().then(setPush)), '🔔 Alerts on')}>Turn on</button>`}</div>`}
      <${Field} label="My WhatsApp (for alerts when I’m offline)"><div class="inline-input"><input value=${wa} onInput=${(e) => setWa(e.target.value)} placeholder="+971 50 123 4567" /><button class="btn ghost small" onClick=${() => run(() => api('/me/whatsapp', { method: 'PATCH', body: { whatsapp: wa } }).then((r) => store.set({ me: r.user })), 'Saved')}>Save</button></div><//>
    </div></div>
    <div class="card" style=${{ marginBottom: '16px' }}><h2 style=${{ marginBottom: '6px' }}>Install the app on your phone</h2>
      ${isStandalone() ? html`<p class="muted small">✅ You’re using the installed app.</p>` : isIOS() ? html`<p class="muted small">iPhone: open this page in Safari → tap Share → <b>Add to Home Screen</b>. Then open Crystal Shield from your home screen and turn on alerts above.</p>`
        : canPromptInstall() ? html`<button class="btn primary small" onClick=${() => promptInstall()}>Install app</button>` : html`<p class="muted small">Android (Chrome): menu ⋮ → <b>Install app</b> / Add to home screen. Computer: the install icon in the address bar.</p>`}</div>
    <div class="card" style=${{ marginBottom: '16px' }}><h2 style=${{ marginBottom: '10px' }}>Change password</h2><div class="form-grid two"><${Field} label="Current password"><input type="password" autocomplete="current-password" value=${pw.current_password} onInput=${(e) => setPw({ ...pw, current_password: e.target.value })} /><//>
      <${Field} label="New password (8+ characters)"><input type="password" autocomplete="new-password" value=${pw.new_password} onInput=${(e) => setPw({ ...pw, new_password: e.target.value })} /><//></div><${ErrorText} error=${error} />
      <div class="form-actions" style=${{ marginTop: '12px' }}><button class="btn primary" disabled=${!pw.new_password} onClick=${() => api('/me', { method: 'PATCH', body: pw }).then(() => { setPw({ current_password: '', new_password: '' }); setError(''); toast('Password changed'); }).catch((e) => setError(e.message))}>Change password</button></div></div>
    <button class="btn ghost" onClick=${logout}><${Icon} name="logout" size=${15} /> Sign out</button>
  </div>`;
}
