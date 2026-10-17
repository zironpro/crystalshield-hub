// Team chat: channels (#general, #installations…), direct messages, and a chat on every deal and job.
// channel keys: 'c:<id>' | 'dm:<low>:<high>' | 'd:<dealId>' | 'j:<jobId>'
const { all, get, run } = require('./db');
const { can, scope } = require('./perms');

let CTX = null;
function fail(status, message) { throw Object.assign(new Error(message), { status }); }

function channelMembers(user, channel) {
  let m = /^c:(\d+)$/.exec(channel);
  if (m) {
    const c = get('SELECT * FROM channels WHERE id = ?', Number(m[1]));
    if (!c) fail(404, 'Channel not found');
    if (c.private) {
      const ids = all('SELECT user_id FROM channel_members WHERE channel_id = ?', c.id).map((r) => r.user_id);
      if (!ids.includes(user.id)) fail(404, 'Channel not found');
      return ids;
    }
    return all('SELECT id FROM users WHERE active = 1').map((r) => r.id);
  }
  m = /^dm:(\d+):(\d+)$/.exec(channel);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    if (a >= b || (user.id !== a && user.id !== b)) fail(404, 'Channel not found');
    if (!get('SELECT id FROM users WHERE id = ?', a === user.id ? b : a)) fail(404, 'Channel not found');
    return [a, b];
  }
  m = /^d:(\d+)$/.exec(channel);
  if (m) {
    const crm = require('./crm');
    const d = get('SELECT * FROM deals WHERE id = ?', Number(m[1]));
    if (!crm.canSeeDeal(user, d)) fail(404, 'Channel not found');
    return all('SELECT * FROM users WHERE active = 1').filter((u) => crm.canSeeDeal(u, d)).map((u) => u.id);
  }
  m = /^j:(\d+)$/.exec(channel);
  if (m) {
    const jobs = require('./jobs');
    const j = get('SELECT * FROM jobs WHERE id = ?', Number(m[1]));
    if (!jobs.canSeeJob(user, j)) fail(404, 'Channel not found');
    return all('SELECT * FROM users WHERE active = 1').filter((u) => jobs.canSeeJob(u, j)).map((u) => u.id);
  }
  fail(404, 'Channel not found');
}
function channelLabel(channel) {
  if (channel.startsWith('c:')) return '#' + (get('SELECT name FROM channels WHERE id = ?', channel.slice(2))?.name || 'channel');
  if (channel.startsWith('d:')) return get('SELECT title FROM deals WHERE id = ?', channel.slice(2))?.title || 'a deal';
  if (channel.startsWith('j:')) return get('SELECT number FROM jobs WHERE id = ?', channel.slice(2))?.number || 'a job';
  return 'a direct message';
}
function enrichMessages(rows) {
  if (!rows.length) return rows;
  const ids = rows.map((m) => m.id);
  const marks = ids.map(() => '?').join(',');
  const reactions = all(`SELECT message_id, emoji, user_id FROM reactions WHERE message_id IN (${marks}) ORDER BY rowid`, ...ids);
  const threads = all(`SELECT parent_id, COUNT(*) n, MAX(created_at) last_at, GROUP_CONCAT(DISTINCT user_id) users FROM messages WHERE parent_id IN (${marks}) AND deleted = 0 GROUP BY parent_id`, ...ids);
  const files = all(`SELECT id, message_id, name, mime, size FROM chat_files WHERE message_id IN (${marks}) ORDER BY id`, ...ids);
  return rows.map((m) => {
    const grouped = {};
    for (const r of reactions) if (r.message_id === m.id) (grouped[r.emoji] ||= []).push(r.user_id);
    const t = threads.find((x) => x.parent_id === m.id);
    return {
      ...m, body: m.deleted ? '' : m.body,
      reactions: Object.entries(grouped).map(([emoji, users]) => ({ emoji, users })),
      reply_count: t?.n || 0, last_reply_at: t?.last_at || null, reply_users: t ? String(t.users).split(',').map(Number).slice(0, 5) : [],
      files: m.deleted ? [] : files.filter((f) => f.message_id === m.id),
    };
  });
}
const enrichOne = (m) => enrichMessages([m])[0];
function markRead(userId, channel, lastId) {
  run(`INSERT INTO channel_reads (user_id, channel, last_read_id) VALUES (?, ?, ?)
    ON CONFLICT(user_id, channel) DO UPDATE SET last_read_id = MAX(last_read_id, excluded.last_read_id)`, userId, channel, lastId);
}

function register(ctx) {
  CTX = ctx;
  const { app, h, ha, clean, emitTo, notify, isOnline } = ctx;

  app.get('/api/channels', h((req) => {
    const uid = req.user.id;
    const unread = (channel) => get(`SELECT COUNT(*) n FROM messages WHERE channel = ? AND user_id != ? AND parent_id IS NULL AND deleted = 0
      AND id > COALESCE((SELECT last_read_id FROM channel_reads WHERE user_id = ? AND channel = ?), 0)`, channel, uid, uid, channel).n;
    const lastMsg = (channel) => get('SELECT body, created_at, user_id FROM messages WHERE channel = ? AND parent_id IS NULL AND deleted = 0 ORDER BY id DESC LIMIT 1', channel);
    const channels = all(`SELECT c.*, (SELECT COUNT(*) FROM channel_members cm WHERE cm.channel_id = c.id) member_count FROM channels c
      WHERE c.private = 0 OR c.id IN (SELECT channel_id FROM channel_members WHERE user_id = ?) ORDER BY c.name = 'general' DESC, c.name`, uid);
    const dms = all(`SELECT DISTINCT channel FROM messages WHERE channel LIKE 'dm:%' AND (channel LIKE ? OR channel LIKE ?)`, `dm:${uid}:%`, `dm:%:${uid}`).map((r) => {
      const [, a, b] = r.channel.split(':').map(Number);
      return { channel: r.channel, user_id: a === uid ? b : a, unread: unread(r.channel), last: lastMsg(r.channel) };
    });
    // deal & job chats that have messages and that I can see
    const records = [];
    for (const r of all(`SELECT DISTINCT channel FROM messages WHERE channel LIKE 'd:%' OR channel LIKE 'j:%'`)) {
      try { channelMembers(req.user, r.channel); } catch { continue; }
      records.push({ channel: r.channel, name: channelLabel(r.channel), unread: unread(r.channel), last: lastMsg(r.channel) });
    }
    records.sort((a, b) => String(b.last?.created_at || '').localeCompare(String(a.last?.created_at || '')));
    return {
      channels: channels.map((c) => ({ ...c, channel: `c:${c.id}`, unread: unread(`c:${c.id}`), last: lastMsg(`c:${c.id}`),
        member_ids: c.private ? all('SELECT user_id FROM channel_members WHERE channel_id = ?', c.id).map((r) => r.user_id) : null })),
      records: records.slice(0, 40), dms,
    };
  }));
  const slug = (name) => clean(name, 60).toLowerCase().replace(/^#/, '').replace(/[^a-z0-9؀-ۿ]+/g, '-').replace(/^-+|-+$/g, '');
  const canManage = (u, c) => c.created_by === u.id || can(u, 'team', 'edit');
  app.post('/api/channels', h((req) => {
    const name = slug(req.body.name);
    if (!name) fail(400, 'Give the channel a name');
    if (get('SELECT id FROM channels WHERE name = ?', name)) fail(400, `#${name} already exists`);
    const priv = req.body.private ? 1 : 0;
    const id = Number(run('INSERT INTO channels (name, description, private, created_by) VALUES (?, ?, ?, ?)', name, clean(req.body.description, 300), priv, req.user.id).lastInsertRowid);
    if (priv) for (const uid of new Set([req.user.id, ...(req.body.member_ids || []).map(Number)])) if (get('SELECT id FROM users WHERE id = ?', uid)) run('INSERT OR IGNORE INTO channel_members (channel_id, user_id) VALUES (?, ?)', id, uid);
    emitTo(channelMembers(req.user, `c:${id}`), 'channels');
    return { channel: { ...get('SELECT * FROM channels WHERE id = ?', id), channel: `c:${id}` } };
  }));
  app.patch('/api/channels/:id', h((req) => {
    const c = get('SELECT * FROM channels WHERE id = ?', req.params.id);
    if (!c) fail(404, 'Channel not found');
    if (!canManage(req.user, c)) fail(403, 'Only the channel creator or an admin can change it');
    const before = channelMembers(req.user, `c:${c.id}`);
    const name = c.name === 'general' ? 'general' : req.body.name !== undefined ? slug(req.body.name) : c.name;
    if (!name) fail(400, 'Give the channel a name');
    run('UPDATE channels SET name = ?, description = ? WHERE id = ?', name, req.body.description !== undefined ? clean(req.body.description, 300) : c.description, c.id);
    if (c.private && Array.isArray(req.body.member_ids)) {
      run('DELETE FROM channel_members WHERE channel_id = ?', c.id);
      for (const uid of new Set([req.user.id, ...req.body.member_ids.map(Number)])) if (get('SELECT id FROM users WHERE id = ?', uid)) run('INSERT INTO channel_members (channel_id, user_id) VALUES (?, ?)', c.id, uid);
    }
    emitTo([...before, ...channelMembers(req.user, `c:${c.id}`)], 'channels');
    return { ok: true };
  }));
  app.delete('/api/channels/:id', h((req) => {
    const c = get('SELECT * FROM channels WHERE id = ?', req.params.id);
    if (!c) fail(404, 'Channel not found');
    if (c.name === 'general') fail(400, "#general can't be deleted");
    if (!canManage(req.user, c)) fail(403, 'Only the channel creator or an admin can delete it');
    const members = channelMembers(req.user, `c:${c.id}`);
    run('DELETE FROM messages WHERE channel = ?', `c:${c.id}`);
    run('DELETE FROM channels WHERE id = ?', c.id);
    emitTo(members, 'channels');
    return { ok: true };
  }));

  app.get('/api/messages/:channel', h((req) => {
    channelMembers(req.user, req.params.channel);
    const before = Number(req.query.before) || Number.MAX_SAFE_INTEGER;
    const rows = all('SELECT * FROM messages WHERE channel = ? AND parent_id IS NULL AND id < ? ORDER BY id DESC LIMIT 60', req.params.channel, before).reverse();
    return { messages: enrichMessages(rows), label: channelLabel(req.params.channel) };
  }));
  app.get('/api/messages/:channel/thread/:id', h((req) => {
    channelMembers(req.user, req.params.channel);
    const parent = get('SELECT * FROM messages WHERE id = ? AND channel = ?', req.params.id, req.params.channel);
    if (!parent) fail(404, 'Message not found');
    return { parent: enrichOne(parent), replies: enrichMessages(all('SELECT * FROM messages WHERE parent_id = ? ORDER BY id', parent.id)) };
  }));
  app.post('/api/messages/:channel', h((req) => {
    const channel = req.params.channel;
    const members = channelMembers(req.user, channel);
    const body = clean(req.body.body, 4000);
    const fileIds = Array.isArray(req.body.file_ids) ? req.body.file_ids.map(Number).filter(Boolean).slice(0, 10) : [];
    const files = fileIds.map((id) => get('SELECT * FROM chat_files WHERE id = ? AND user_id = ? AND channel = ? AND message_id IS NULL', id, req.user.id, channel)).filter(Boolean);
    if (!body && !files.length) fail(400, 'Empty message');
    let parent = null;
    if (req.body.parent_id) {
      parent = get('SELECT * FROM messages WHERE id = ? AND channel = ? AND parent_id IS NULL', Number(req.body.parent_id), channel);
      if (!parent) fail(404, 'That message no longer exists');
    }
    const r = run('INSERT INTO messages (channel, user_id, body, parent_id) VALUES (?, ?, ?, ?)', channel, req.user.id, body, parent?.id || null);
    for (const f of files) run('UPDATE chat_files SET message_id = ? WHERE id = ?', r.lastInsertRowid, f.id);
    const message = enrichOne(get('SELECT * FROM messages WHERE id = ?', r.lastInsertRowid));
    const preview = body || (files.some((f) => /^audio\//.test(f.mime)) ? '🎤 Voice message' : `📎 ${files.map((f) => f.name).join(', ')}`);
    if (!parent) markRead(req.user.id, channel, message.id);
    emitTo(members, 'message', { channel, message, parent: parent ? enrichOne(parent) : null });
    const where = channelLabel(channel);
    const notified = new Set([req.user.id]);
    const send = (ids, payload) => {
      const fresh = ids.filter((id) => !notified.has(id));
      fresh.forEach((id) => notified.add(id));
      notify(fresh, payload, { exclude: req.user.id });
    };
    const link = `chat/${channel}${parent ? `?thread=${parent.id}` : ''}`;
    if (!channel.startsWith('dm:') && /(^|\s)@(channel|everyone|here)\b/i.test(body)) {
      const here = /@here\b/i.test(body);
      send(members.filter((id) => !here || isOnline(id)), { type: 'mention', title: `${req.user.name} notified ${where}`, body: preview, link });
    }
    send(ctx.mentionedUsers(body).filter((id) => members.includes(id)), { type: 'mention', title: `${req.user.name} mentioned you in ${where}`, body: preview, link });
    if (parent) {
      const inThread = [parent.user_id, ...all('SELECT DISTINCT user_id FROM messages WHERE parent_id = ?', parent.id).map((x) => x.user_id)];
      send(inThread, { type: 'thread', title: `${req.user.name} replied in ${where}`, body: preview, link });
    } else if (channel.startsWith('dm:')) {
      const other = members.find((id) => id !== req.user.id);
      if (!isOnline(other)) send([other], { type: 'dm', title: `Message from ${req.user.name}`, body: preview, link });
    } else if (/^[dj]:/.test(channel)) {
      // deal / job chat: tell the people working on it
      const rec = channel.startsWith('d:') ? get('SELECT owner_id FROM deals WHERE id = ?', channel.slice(2)) : get('SELECT * FROM jobs WHERE id = ?', channel.slice(2));
      const who = channel.startsWith('d:') ? [rec?.owner_id] : require('./jobs').installersOf(rec || {});
      send(who.filter(Boolean).filter((id) => !isOnline(id)), { type: 'message', title: `${req.user.name} in ${where}`, body: preview, link });
    }
    return { message };
  }));
  function forEdit(user, id) {
    const m = get('SELECT * FROM messages WHERE id = ?', id);
    if (!m || m.deleted) fail(404, 'Message not found');
    return { m, members: channelMembers(user, m.channel) };
  }
  function emitUpdate(members, m) {
    const fresh = enrichOne(get('SELECT * FROM messages WHERE id = ?', m.id));
    emitTo(members, 'message-updated', { channel: m.channel, message: fresh });
    return fresh;
  }
  app.patch('/api/messages/:id', h((req) => {
    const { m, members } = forEdit(req.user, req.params.id);
    if (m.user_id !== req.user.id) fail(403, 'You can only edit your own messages');
    const body = clean(req.body.body, 4000);
    if (!body) fail(400, 'Empty message');
    run(`UPDATE messages SET body = ?, edited_at = datetime('now') WHERE id = ?`, body, m.id);
    return { message: emitUpdate(members, m) };
  }));
  app.delete('/api/messages/:id', h((req) => {
    const { m, members } = forEdit(req.user, req.params.id);
    if (m.user_id !== req.user.id && !can(req.user, 'team', 'edit')) fail(403, 'You can only delete your own messages');
    run(`UPDATE messages SET deleted = 1, body = '' WHERE id = ?`, m.id);
    for (const f of all('SELECT * FROM chat_files WHERE message_id = ?', m.id)) { ctx.removeStored(f.token); run('DELETE FROM chat_files WHERE id = ?', f.id); }
    run('DELETE FROM reactions WHERE message_id = ?', m.id);
    return { message: emitUpdate(members, m) };
  }));
  app.post('/api/messages/:id/reactions', h((req) => {
    const { m, members } = forEdit(req.user, req.params.id);
    const emoji = clean(req.body.emoji, 16);
    if (!emoji) fail(400, 'Pick an emoji');
    if (get('SELECT 1 FROM reactions WHERE message_id = ? AND user_id = ? AND emoji = ?', m.id, req.user.id, emoji)) run('DELETE FROM reactions WHERE message_id = ? AND user_id = ? AND emoji = ?', m.id, req.user.id, emoji);
    else run('INSERT INTO reactions (message_id, user_id, emoji) VALUES (?, ?, ?)', m.id, req.user.id, emoji);
    return { message: emitUpdate(members, m) };
  }));
  app.post('/api/channels/:channel/read', h((req) => {
    channelMembers(req.user, req.params.channel);
    markRead(req.user.id, req.params.channel, Number(req.body.last_id) || 0);
    return { ok: true };
  }));

  // chat attachments (photos from site, PDFs, voice notes)
  app.post('/api/chat-files', ha(async (req) => {
    const channel = String(req.query.channel || '');
    channelMembers(req.user, channel);
    const f = await ctx.receiveUpload(req, { max: 25 * 1048576 });
    const r = run('INSERT INTO chat_files (token, channel, user_id, name, mime, size) VALUES (?, ?, ?, ?, ?, ?)', f.token, channel, req.user.id, f.name, f.mime, f.size);
    return { file: { id: Number(r.lastInsertRowid), name: f.name, mime: f.mime, size: f.size } };
  }));
  app.get('/api/chat-files/:id', h((req, res) => {
    const f = get('SELECT * FROM chat_files WHERE id = ?', req.params.id);
    if (!f) fail(404, 'File not found');
    if (f.user_id !== req.user.id || f.message_id) channelMembers(req.user, f.channel);
    ctx.sendStored(res, f.token, f.mime, f.name, { download: !!req.query.download });
  }));
}

module.exports = { register, channelMembers, channelLabel };
