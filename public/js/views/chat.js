// Team chat: #channels, a chat on every deal and installation, and direct messages. Live, with threads,
// reactions, photos/files and voice notes (handy for installers on site).
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { html, api, useStore, useEvent, go, userById, refreshChatUnread, sendTyping, dmChannel, parseDate, timeAgo, toast, hashParam, can, fileSize, shrinkImage } from '../lib.js';
import { Avatar, Icon, Spinner, Empty, Modal, Field, ErrorText, Lightbox } from '../ui.js';

const EMOJIS = ['👍', '✅', '🙏', '😂', '🔥', '👀', '❤️', '🎉'];
const clock = (s) => parseDate(s).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
const dayLabel = (s) => { const d = parseDate(s); const t = new Date(); const y = new Date(); y.setDate(t.getDate() - 1); return d.toDateString() === t.toDateString() ? 'Today' : d.toDateString() === y.toDateString() ? 'Yesterday' : d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }); };

function RichText({ text }) {
  const names = useStore().users.map((u) => u.name).sort((a, b) => b.length - a.length).map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const re = new RegExp(`(https?://[^\\s]+)${names.length ? `|@(${names.join('|')}|channel|here|everyone)` : ''}`, 'gi');
  const parts = []; let last = 0; let m;
  while ((m = re.exec(text))) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    parts.push(m[1] ? html`<a class="inline-link" href=${m[1]} target="_blank" rel="noopener noreferrer">${m[1]}</a>` : html`<span class="mention">@${m[2]}</span>`);
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

function ChannelList({ channel, data, onNew }) {
  const s = useStore();
  const [q, setQ] = useState('');
  const match = (n) => String(n).toLowerCase().includes(q.toLowerCase());
  const dms = new Map((data?.dms || []).map((d) => [d.user_id, d]));
  const people = s.users.filter((u) => u.active && u.id !== s.me.id && match(u.name))
    .sort((a, b) => String(dms.get(b.id)?.last?.created_at || '').localeCompare(String(dms.get(a.id)?.last?.created_at || '')) || a.name.localeCompare(b.name));
  const row = (key, icon, name, unread, sub) => html`<a href=${`#/chat/${key}`} class="channel ${channel === key ? 'active' : ''}">${icon}<span class="channel-name">${name}${sub && html`<small>${sub}</small>`}</span>${unread > 0 && html`<span class="count">${unread}</span>`}</a>`;
  return html`<aside class="channel-list">
    <label class="search-box" style=${{ maxWidth: 'none' }}><${Icon} name="search" size=${15} /><input placeholder="Search" value=${q} onInput=${(e) => setQ(e.target.value)} /></label>
    <h4>Channels <button class="icon-btn small" title="New channel" onClick=${onNew}><${Icon} name="plus" size=${15} /></button></h4>
    ${(data?.channels || []).filter((c) => match(c.name)).map((c) => row(c.channel, html`<span class="hash">${c.private ? '🔒' : '#'}</span>`, c.name, c.unread))}
    ${(data?.records || []).length > 0 && html`<h4>Deals & jobs</h4>${data.records.filter((r) => match(r.name)).map((r) => row(r.channel, html`<span class="hash">${r.channel.startsWith('d:') ? '💼' : '🛠'}</span>`, r.name, r.unread, r.last?.body?.slice(0, 40)))}`}
    <h4>Direct messages</h4>
    ${people.map((u) => { const dm = dms.get(u.id); return row(dmChannel(s.me.id, u.id), html`<${Avatar} user=${u} size=${26} showOnline=${true} />`, u.name, dm?.unread, dm?.last ? (dm.last.body || '📎 Attachment').slice(0, 40) : u.title); })}
  </aside>`;
}

function Files({ files }) {
  const [view, setView] = useState(null);
  return html`<div class="msg-files">
    ${files.map((f) => (f.mime.startsWith('image/') ? html`<img src=${`/api/chat-files/${f.id}`} alt=${f.name} loading="lazy" onClick=${() => setView({ ...f, url: `/api/chat-files/${f.id}` })} />`
      : f.mime.startsWith('audio/') ? html`<audio controls preload="metadata" src=${`/api/chat-files/${f.id}`} />`
        : html`<a class="fchip" href=${`/api/chat-files/${f.id}`} target="_blank" rel="noopener">📎 ${f.name} <span class="muted small">${fileSize(f.size)}</span></a>`))}
    ${view && html`<${Lightbox} file=${view} onClose=${() => setView(null)} />`}
  </div>`;
}

function Message({ m, prev, inThread, onThread, onChanged }) {
  const s = useStore();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const u = userById(m.user_id);
  const mine = m.user_id === s.me.id;
  const grouped = prev && !prev.deleted && prev.user_id === m.user_id && dayLabel(prev.created_at) === dayLabel(m.created_at) && parseDate(m.created_at) - parseDate(prev.created_at) < 5 * 60e3 && !prev.reply_count;
  const act = (p, body, method = 'POST') => api(p, { method, body }).then((r) => onChanged(r.message)).catch((e) => toast(e.message));
  if (m.deleted) return html`<div class="msg grouped"><span class="msg-gutter" /><div class="msg-body"><p class="muted small"><i>Message deleted</i></p></div></div>`;
  return html`<div class="msg ${grouped ? 'grouped' : ''}">
    ${grouped ? html`<span class="msg-gutter"><span>${clock(m.created_at)}</span></span>` : html`<${Avatar} user=${u} size=${34} />`}
    <div class="msg-body">
      ${!grouped && html`<header><strong>${u?.name || 'Unknown'}</strong><small class="muted">${clock(m.created_at)}</small></header>`}
      ${editing ? html`<div class="inline-input"><textarea rows="2" value=${draft} onInput=${(e) => setDraft(e.target.value)} onKeyDown=${(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); act(`/messages/${m.id}`, { body: draft }, 'PATCH').then(() => setEditing(false)); } if (e.key === 'Escape') setEditing(false); }} /><button class="btn primary small" onClick=${() => act(`/messages/${m.id}`, { body: draft }, 'PATCH').then(() => setEditing(false))}>Save</button></div>`
        : html`${m.body && html`<p><${RichText} text=${m.body} />${m.edited_at && html` <small class="muted">(edited)</small>`}</p>`}${m.files?.length > 0 && html`<${Files} files=${m.files} />`}`}
      ${m.reactions?.length > 0 && html`<div class="reactions">${m.reactions.map((r) => html`<button class="reaction ${r.users.includes(s.me.id) ? 'mine' : ''}" title=${r.users.map((id) => userById(id)?.name.split(' ')[0]).join(', ')} onClick=${() => act(`/messages/${m.id}/reactions`, { emoji: r.emoji })}>${r.emoji} ${r.users.length}</button>`)}</div>`}
      ${!inThread && m.reply_count > 0 && html`<button class="thread-link" onClick=${() => onThread(m)}>💬 ${m.reply_count} ${m.reply_count === 1 ? 'reply' : 'replies'} · ${timeAgo(m.last_reply_at)}</button>`}
    </div>
    ${!editing && html`<div class="msg-actions">${EMOJIS.slice(0, 3).map((e) => html`<button class="icon-btn small" onClick=${() => act(`/messages/${m.id}/reactions`, { emoji: e })}>${e}</button>`)}
      ${!inThread && html`<button class="icon-btn small" title="Reply in thread" onClick=${() => onThread(m)}><${Icon} name="chat" size=${15} /></button>`}
      ${mine && html`<button class="icon-btn small" title="Edit" onClick=${() => { setDraft(m.body); setEditing(true); }}><${Icon} name="edit" size=${15} /></button>`}
      ${(mine || can('team', 'edit')) && html`<button class="icon-btn small" title="Delete" onClick=${() => confirm('Delete this message?') && act(`/messages/${m.id}`, null, 'DELETE')}><${Icon} name="trash" size=${15} /></button>`}</div>`}
  </div>`;
}
const MessageList = ({ messages, inThread, onThread, onChanged }) => messages.map((m, i) => {
  const prev = messages[i - 1];
  const newDay = !inThread && (!prev || dayLabel(prev.created_at) !== dayLabel(m.created_at));
  return html`${newDay && html`<div class="day-divider">${dayLabel(m.created_at)}</div>`}<${Message} key=${m.id} m=${m} prev=${newDay ? null : prev} inThread=${inThread} onThread=${onThread} onChanged=${onChanged} />`;
});

async function uploadChatFile(channel, file) {
  const f = await shrinkImage(file);
  const res = await fetch(`/api/chat-files?channel=${encodeURIComponent(channel)}`, { method: 'POST', body: f, credentials: 'same-origin', headers: { 'Content-Type': 'application/octet-stream', 'X-File-Type': f.type || 'application/octet-stream', 'X-File-Name': encodeURIComponent(f.name || `photo-${Date.now()}.jpg`) } });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(d.error || 'Upload failed');
  return d.file;
}

function Composer({ channel, parentId, placeholder, onSent }) {
  const s = useStore();
  const [text, setText] = useState('');
  const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState(0);
  const [mq, setMq] = useState(null);
  const [rec, setRec] = useState(null);
  const ta = useRef(); const picker = useRef(); const lastTyping = useRef(0);
  const matches = mq === null ? [] : s.users.filter((u) => u.active && u.name.toLowerCase().includes(mq.toLowerCase())).slice(0, 6);
  useEffect(() => { const el = ta.current; if (el) { el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight, 180) + 'px'; } }, [text]);
  async function add(list) {
    for (const f of list) { setBusy((n) => n + 1); try { const up = await uploadChatFile(channel, f); setFiles((x) => [...x, up]); } catch (e) { toast(e.message); } setBusy((n) => n - 1); }
  }
  async function send() {
    const body = text.trim();
    if ((!body && !files.length) || busy) return;
    const ids = files.map((f) => f.id);
    setText(''); setFiles([]);
    try { const { message } = await api(`/messages/${channel}`, { method: 'POST', body: { body, parent_id: parentId || undefined, file_ids: ids } }); onSent?.(message); } catch (e) { setText(body); toast(e.message); }
  }
  function onInput(e) {
    setText(e.target.value);
    const m = /(^|\s)@([\w ]{0,24})$/.exec(e.target.value.slice(0, e.target.selectionStart));
    setMq(m ? m[2] : null);
    if (!parentId && Date.now() - lastTyping.current > 2000) { lastTyping.current = Date.now(); sendTyping(channel); }
  }
  function pick(u) {
    const el = ta.current;
    const before = el.value.slice(0, el.selectionStart).replace(/@([\w ]{0,24})$/, `@${u.name} `);
    setText(before + el.value.slice(el.selectionStart)); setMq(null); el.focus();
  }
  async function startVoice() {
    if (!window.MediaRecorder) return toast('Voice notes are not supported in this browser');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const type = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm'].find((t) => MediaRecorder.isTypeSupported?.(t)) || '';
      const r = new MediaRecorder(stream, type ? { mimeType: type } : undefined); const chunks = [];
      r.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      r.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        if (r.cancelled) return setRec(null);
        const mt = (r.mimeType || 'audio/webm').split(';')[0];
        const blob = new Blob(chunks, { type: mt });
        setRec(null);
        if (blob.size < 1500) return toast('Too short');
        const file = new File([blob], `Voice note.${mt.includes('mp4') ? 'm4a' : 'webm'}`, { type: mt });
        try { const up = await uploadChatFile(channel, file); const { message } = await api(`/messages/${channel}`, { method: 'POST', body: { body: '', parent_id: parentId || undefined, file_ids: [up.id] } }); onSent?.(message); } catch (e) { toast(e.message); }
      };
      r.start(250); setRec(r);
    } catch { toast('Allow the microphone to send voice notes'); }
  }
  if (rec) return html`<footer class="composer"><button class="btn ghost" onClick=${() => { rec.cancelled = true; rec.stop(); }}>Cancel</button><span class="grow red strong" style=${{ flex: 1 }}>● Recording…</span><button class="btn primary" onClick=${() => rec.stop()}>Send voice note</button></footer>`;
  return html`<div>
    ${(files.length > 0 || busy > 0) && html`<div class="pending-files">${files.map((f) => html`<span class="fchip tag">📎 ${f.name}<button class="icon-btn small" onClick=${() => setFiles(files.filter((x) => x.id !== f.id))}>×</button></span>`)}${busy > 0 && html`<span class="muted small">Uploading…</span>`}</div>`}
    <footer class="composer" onPaste=${(e) => { const fs = [...(e.clipboardData?.files || [])]; if (fs.length) { e.preventDefault(); add(fs); } }}>
      <input type="file" multiple hidden ref=${picker} onChange=${(e) => { add([...e.target.files]); e.target.value = ''; }} />
      <button class="icon-btn" title="Photo / file" onClick=${() => picker.current.click()}><${Icon} name="paperclip" size=${19} /></button>
      <div class="mention-wrap">${matches.length > 0 && html`<ul class="mention-menu">${matches.map((u) => html`<li onMouseDown=${(e) => { e.preventDefault(); pick(u); }}><${Avatar} user=${u} size=${22} /> ${u.name}</li>`)}</ul>`}
        <textarea ref=${ta} rows="1" value=${text} placeholder=${placeholder} onInput=${onInput} onKeyDown=${(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (matches.length) pick(matches[0]); else send(); } }} /></div>
      ${!text.trim() && !files.length ? html`<button class="btn primary" style=${{ width: '42px', padding: 0 }} title="Voice note" onClick=${startVoice}>🎤</button>`
        : html`<button class="btn primary" style=${{ width: '42px', padding: 0 }} disabled=${busy > 0} onClick=${send} aria-label="Send"><${Icon} name="send" size=${17} /></button>`}
    </footer></div>`;
}

function Thread({ channel, parentId, onClose }) {
  const [d, setD] = useState(null);
  const end = useRef();
  useEffect(() => { setD(null); api(`/messages/${channel}/thread/${parentId}`).then(setD).catch(onClose); }, [parentId]);
  useEvent('message', ({ channel: ch, message }) => { if (ch === channel && message.parent_id === parentId) setD((x) => (x && !x.replies.some((r) => r.id === message.id) ? { ...x, replies: [...x.replies, message] } : x)); });
  useEvent('message-updated', ({ message }) => setD((x) => x && { parent: x.parent.id === message.id ? message : x.parent, replies: x.replies.map((r) => (r.id === message.id ? message : r)) }));
  useLayoutEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [d?.replies.length]);
  const upd = (m) => setD((x) => ({ parent: x.parent.id === m.id ? m : x.parent, replies: x.replies.map((r) => (r.id === m.id ? m : r)) }));
  return html`<aside class="thread-pane"><header class="conv-head"><strong>Thread</strong><span class="spacer" /><button class="icon-btn" onClick=${onClose}><${Icon} name="x" /></button></header>
    <div class="messages">${!d ? html`<${Spinner} />` : html`<${Message} m=${d.parent} inThread=${true} onChanged=${upd} /><div class="day-divider">${d.replies.length} ${d.replies.length === 1 ? 'reply' : 'replies'}</div><${MessageList} messages=${d.replies} inThread=${true} onChanged=${upd} /><span ref=${end} />`}</div>
    <${Composer} channel=${channel} parentId=${parentId} placeholder="Reply…" onSent=${(m) => setD((x) => (x.replies.some((r) => r.id === m.id) ? x : { ...x, replies: [...x.replies, m] }))} /></aside>`;
}

function Conversation({ channel, info, onManage, thread, setThread }) {
  const s = useStore();
  const [messages, setMessages] = useState(null);
  const [label, setLabel] = useState('');
  const [hasMore, setHasMore] = useState(false);
  const [typing, setTyping] = useState({});
  const scroller = useRef(); const stick = useRef(true);
  const markRead = (list) => { const last = list[list.length - 1]; if (last && document.visibilityState === 'visible') api(`/channels/${channel}/read`, { method: 'POST', body: { last_id: last.id } }).then(refreshChatUnread).catch(() => {}); };
  useEffect(() => {
    setMessages(null); stick.current = true;
    api(`/messages/${channel}`).then((d) => { setMessages(d.messages); setLabel(d.label); setHasMore(d.messages.length === 60); markRead(d.messages); }).catch(() => setMessages([]));
  }, [channel]);
  const replace = (m) => setMessages((list) => list && list.map((x) => (x.id === m.id ? { ...x, ...m } : x)));
  useEvent('message', ({ channel: ch, message, parent }) => {
    if (ch !== channel) return;
    if (parent) return replace(parent);
    setMessages((m) => (m && !m.some((x) => x.id === message.id) ? [...m, message] : m));
    setTyping((t) => ({ ...t, [message.user_id]: 0 }));
    if (message.user_id !== s.me.id) markRead([message]);
  });
  useEvent('message-updated', ({ channel: ch, message }) => ch === channel && replace(message));
  useEvent('typing', ({ channel: ch, user_id }) => { if (ch === channel) { setTyping((t) => ({ ...t, [user_id]: Date.now() })); setTimeout(() => setTyping((t) => ({ ...t })), 3200); } });
  useLayoutEffect(() => { const el = scroller.current; if (el && stick.current) el.scrollTop = el.scrollHeight; }, [messages]);
  async function older() {
    const el = scroller.current; const h = el.scrollHeight;
    const d = await api(`/messages/${channel}?before=${messages[0].id}`);
    stick.current = false; setMessages([...d.messages, ...messages]); setHasMore(d.messages.length === 60);
    requestAnimationFrame(() => { el.scrollTop = el.scrollHeight - h; });
  }
  const isDm = channel.startsWith('dm:');
  const other = isDm ? userById(channel.split(':').slice(1).map(Number).find((id) => id !== s.me.id)) : null;
  const team = channel.startsWith('c:') ? info?.channels?.find((c) => c.channel === channel) : null;
  const record = /^[dj]:/.test(channel);
  const typers = Object.entries(typing).filter(([, at]) => Date.now() - at < 3000).map(([id]) => userById(Number(id))?.name.split(' ')[0]);
  const name = isDm ? other?.name : team ? `#${team.name}` : label;
  return html`<section class="conversation">
    <header class="conv-head"><a href="#/chat" class="icon-btn mobile-only" aria-label="Back"><${Icon} name="back" /></a>
      ${isDm ? html`<${Avatar} user=${other} size=${34} showOnline=${true} /><div><strong>${other?.name}</strong><small class="muted">${s.online.has(other?.id) ? 'Online' : 'Offline'}${other?.title ? ` · ${other.title}` : ''}</small></div>`
        : html`<span class="hash" style=${{ width: '34px', height: '34px' }}>${record ? (channel.startsWith('d:') ? '💼' : '🛠') : '#'}</span><div><strong>${name}</strong><small class="muted">${record ? 'Everyone working on it can read this' : team?.description || ''}</small></div>`}
      <span class="spacer" />
      ${record && html`<a class="btn ghost small" href=${`#/${channel.startsWith('d:') ? 'deals' : 'jobs'}/${channel.slice(2)}`}>Open ${channel.startsWith('d:') ? 'deal' : 'job'}</a>`}
      ${team && (team.created_by === s.me.id || can('team', 'edit')) && html`<button class="btn ghost small" onClick=${() => onManage(team)}><${Icon} name="edit" size=${14} /> Edit</button>`}
    </header>
    <div class="messages" ref=${scroller} onScroll=${(e) => { const el = e.target; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80; }}>
      ${messages === null ? html`<${Spinner} />` : messages.length === 0 ? html`<${Empty} icon="chat" title=${isDm ? `Say hi to ${other?.name.split(' ')[0] || ''}` : `Start the conversation in ${name || 'this chat'}`}>Type @ to mention someone. Photos from site can be added with 📎.<//>`
        : html`${hasMore && html`<button class="btn ghost small" style=${{ alignSelf: 'center' }} onClick=${older}>Load earlier messages</button>`}<${MessageList} messages=${messages} onThread=${(m) => setThread(m.id)} onChanged=${replace} />`}
    </div>
    <div class="typing">${typers.length > 0 && `${typers.join(', ')} ${typers.length > 1 ? 'are' : 'is'} typing…`}</div>
    <${Composer} channel=${channel} placeholder=${`Message ${name || ''}`} onSent=${(m) => { stick.current = true; setMessages((list) => (list.some((x) => x.id === m.id) ? list : [...list, m])); }} />
  </section>`;
}

function ChannelModal({ channel, onClose, onSaved }) {
  const s = useStore();
  const [f, setF] = useState(channel ? { name: channel.name, description: channel.description || '', private: !!channel.private, member_ids: channel.member_ids || [] } : { name: '', description: '', private: false, member_ids: [] });
  const [error, setError] = useState('');
  async function submit(e) {
    e.preventDefault();
    try { if (channel) { await api(`/channels/${channel.id}`, { method: 'PATCH', body: f }); onSaved(channel.channel); } else onSaved((await api('/channels', { method: 'POST', body: f })).channel.channel); onClose(); } catch (err) { setError(err.message); }
  }
  return html`<${Modal} title=${channel ? `Edit #${channel.name}` : 'New channel'} onClose=${onClose}><form class="form" onSubmit=${submit}>
    <${Field} label="Name"><input required value=${f.name} disabled=${channel?.name === 'general'} placeholder="e.g. sales-team" onInput=${(e) => setF({ ...f, name: e.target.value })} /><//>
    <${Field} label="What's it for?"><input value=${f.description} onInput=${(e) => setF({ ...f, description: e.target.value })} /><//>
    ${!channel && html`<label class="check"><input type="checkbox" checked=${f.private} onChange=${(e) => setF({ ...f, private: e.target.checked })} /> Private — only people you choose</label>`}
    ${f.private && html`<${Field} label="Members"><div class="chips">${s.users.filter((u) => u.active && u.id !== s.me.id).map((u) => html`<button type="button" class="chip ${f.member_ids.includes(u.id) ? 'on' : ''}" onClick=${() => setF({ ...f, member_ids: f.member_ids.includes(u.id) ? f.member_ids.filter((x) => x !== u.id) : [...f.member_ids, u.id] })}>${u.name}</button>`)}</div><//>`}
    <${ErrorText} error=${error} /><div class="form-actions">${channel && channel.name !== 'general' && html`<button type="button" class="btn danger-ghost" onClick=${() => confirm(`Delete #${channel.name}?`) && api(`/channels/${channel.id}`, { method: 'DELETE' }).then(() => { onClose(); go('chat'); })}>Delete</button>`}<span class="spacer" /><button type="button" class="btn ghost" onClick=${onClose}>Cancel</button><button class="btn primary">Save</button></div></form><//>`;
}

export function Chat({ channel }) {
  const [data, setData] = useState(null);
  const [modal, setModal] = useState(null);
  const [thread, setThread] = useState(() => Number(hashParam('thread')) || null);
  const load = () => refreshChatUnread().then((d) => d && setData(d));
  useEffect(() => { load(); setThread(Number(hashParam('thread')) || null); }, [channel]);
  useEvent(['message', 'channels', 'reconnect'], load);
  useEffect(() => { if (!channel && data && window.innerWidth > 900) { const first = data.channels[0]?.channel; if (first) go(`chat/${first}`); } }, [channel, data]);
  return html`<div class="chat ${channel ? 'has-channel' : ''} ${thread ? 'with-thread' : ''}">
    <${ChannelList} channel=${channel} data=${data} onNew=${() => setModal('new')} />
    ${channel ? html`<${Conversation} key=${channel} channel=${channel} info=${data} onManage=${setModal} thread=${thread} setThread=${setThread} />` : html`<section class="conversation" style=${{ justifyContent: 'center' }}><${Empty} icon="chat" title="Pick a conversation">Channels, deal and job chats, and direct messages — all live.<//></section>`}
    ${channel && thread && html`<${Thread} channel=${channel} parentId=${thread} onClose=${() => setThread(null)} />`}
    ${modal && html`<${ChannelModal} channel=${modal === 'new' ? null : modal} onClose=${() => setModal(null)} onSaved=${(k) => { load(); go(`chat/${k}`); }} />`}
  </div>`;
}
