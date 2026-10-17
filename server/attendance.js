// Attendance: clock in / out (office staff from the office — by location or office internet; installers anywhere,
// with their location recorded), shifts, monthly register with CSV export, and leave / missed-punch requests.
const { all, get, run, tx } = require('./db');
const U = require('./util');
const { can } = require('./perms');

const LEAVE_TYPES = { annual: 'Annual leave', sick: 'Sick leave', casual: 'Casual leave', unpaid: 'Unpaid leave', missed_punch: 'Missed punch', other: 'Other' };

if (!get('SELECT id FROM offices LIMIT 1')) {
  run(`INSERT INTO offices (name, address, field) VALUES ('Abu Dhabi office', 'Abu Dhabi, UAE', 0)`);
  run(`INSERT INTO offices (name, address, field) VALUES ('Field / site work', 'Customer sites across the UAE', 1)`);
  run(`INSERT INTO shifts (name, start, end, days, grace, color) VALUES ('Office 9–6', '09:00', '18:00', '1,2,3,4,5,6', 15, '#00386b')`);
  run(`INSERT INTO shifts (name, start, end, days, grace, color) VALUES ('Installation team 8–5', '08:00', '17:00', '1,2,3,4,5,6', 15, '#0069b7')`);
}

const localTime = (iso) => new Date(iso).toLocaleTimeString('en-GB', { timeZone: U.TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const toMin = (hhmm) => { const [h, m] = String(hhmm || '0:0').split(':').map(Number); return h * 60 + (m || 0); };
const weekday = (date) => new Date(date + 'T12:00:00Z').getUTCDay();
function shiftOf(u) {
  return (u.shift_id && get('SELECT * FROM shifts WHERE id = ?', u.shift_id)) || get('SELECT * FROM shifts ORDER BY id LIMIT 1');
}
function distanceM(a1, o1, a2, o2) {
  const R = 6371000; const rad = (x) => (x * Math.PI) / 180;
  const dLat = rad(a2 - a1); const dLon = rad(o2 - o1);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a1)) * Math.cos(rad(a2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}
const sessionMinutes = (s) => Math.max(0, Math.round((new Date(s.clock_out || Date.now()) - new Date(s.clock_in)) / 60000));

function daySummary(u, date) {
  const sessions = all('SELECT * FROM attendance WHERE user_id = ? AND date = ? ORDER BY clock_in', u.id, date);
  const shift = shiftOf(u);
  const working = shift ? String(shift.days).split(',').map(Number).includes(weekday(date)) : true;
  const leave = get(`SELECT * FROM leaves WHERE user_id = ? AND status = 'approved' AND type != 'missed_punch' AND ? BETWEEN from_date AND to_date`, u.id, date);
  const minutes = sessions.reduce((s, x) => s + sessionMinutes(x), 0);
  const first = sessions[0];
  let late = 0;
  if (first && shift && working) late = Math.max(0, toMin(localTime(first.clock_in)) - toMin(shift.start) - (shift.grace || 0));
  let status;
  if (sessions.length) status = late > 0 ? 'late' : 'present';
  else if (leave) status = leave.half_day ? 'half_leave' : 'leave';
  else if (!working) status = 'off';
  else if (date < U.today()) status = 'absent';
  else status = 'not_in';
  return {
    date, status, minutes, late_minutes: late, working: sessions.some((s) => !s.clock_out), leave_type: leave?.type || null,
    first_in: first?.clock_in || null, last_out: sessions.length && sessions.every((s) => s.clock_out) ? sessions[sessions.length - 1].clock_out : null,
    place: first?.in_place || '', sessions,
  };
}

function register(ctx) {
  const { app, h, need, fail, clean, notify } = ctx;
  const managers = () => ctx.usersWith('attendance', 'edit');

  app.get('/api/attendance/me', h((req) => {
    const u = req.user;
    const office = u.office_id ? get('SELECT * FROM offices WHERE id = ?', u.office_id) : null;
    return { today: daySummary(u, U.today()), shift: shiftOf(u), office: office ? { ...office, allowed_ips: undefined } : null };
  }));
  app.post('/api/attendance/clock-in', h((req) => {
    const u = req.user;
    if (get('SELECT id FROM attendance WHERE user_id = ? AND clock_out IS NULL', u.id)) fail(400, 'You are already clocked in');
    const lat = Number(req.body.lat) || null; const lng = Number(req.body.lng) || null;
    const office = u.office_id ? get('SELECT * FROM offices WHERE id = ?', u.office_id) : null;
    let place = office?.name || '';
    if (office && !office.field) {
      const ips = office.allowed_ips.split(',').map((s) => s.trim()).filter(Boolean);
      const gpsLock = office.lat && office.lng;
      const ipOk = ips.length && ips.includes(req.ip);
      const near = gpsLock && lat && lng && distanceM(lat, lng, office.lat, office.lng) <= (office.radius_m || 200);
      const wfh = get(`SELECT id FROM leaves WHERE user_id = ? AND status = 'approved' AND type = 'other' AND ? BETWEEN from_date AND to_date`, u.id, U.today());
      if ((ips.length || gpsLock) && !ipOk && !near && !wfh) {
        fail(400, gpsLock ? `You need to be at ${office.name} to clock in${lat ? ` (you are ${Math.round(distanceM(lat, lng, office.lat, office.lng))} m away)` : ' — allow location access'}` : `Clock in from the ${office.name} Wi-Fi`);
      }
    }
    // installers: name the site if they have a job today
    const job = all(`SELECT * FROM jobs WHERE status NOT IN ('cancelled','signed_off') AND date <= ? AND COALESCE(end_date, date) >= ?`, U.today(), U.today())
      .find((j) => require('./jobs').installersOf(j).includes(u.id));
    if (job) place = `${job.number} · ${job.title}`;
    run('INSERT INTO attendance (user_id, date, clock_in, in_lat, in_lng, in_place, ip) VALUES (?, ?, ?, ?, ?, ?, ?)', u.id, U.today(), new Date().toISOString(), lat, lng, place, req.ip);
    ctx.broadcast('attendance', 'attendance');
    ctx.emitTo([u.id], 'attendance');
    return { today: daySummary(u, U.today()) };
  }));
  app.post('/api/attendance/clock-out', h((req) => {
    const u = req.user;
    const s = get('SELECT * FROM attendance WHERE user_id = ? AND clock_out IS NULL ORDER BY id DESC LIMIT 1', u.id);
    if (!s) fail(400, 'You are not clocked in');
    run('UPDATE attendance SET clock_out = ?, out_lat = ?, out_lng = ? WHERE id = ?', new Date().toISOString(), Number(req.body.lat) || null, Number(req.body.lng) || null, s.id);
    ctx.broadcast('attendance', 'attendance');
    ctx.emitTo([u.id], 'attendance');
    return { today: daySummary(u, U.today()) };
  }));

  app.get('/api/attendance/today', need('attendance'), h((req) => {
    const date = U.isDate(req.query.date) ? req.query.date : U.today();
    const people = all('SELECT * FROM users WHERE active = 1 ORDER BY name').map((u) => {
      const d = daySummary(u, date);
      return { user_id: u.id, name: u.name, office_id: u.office_id, ...d, shift: shiftOf(u)?.name, in_time: d.first_in ? localTime(d.first_in) : null, out_time: d.last_out ? localTime(d.last_out) : null };
    });
    return { date, people };
  }));
  app.get('/api/attendance/month', h((req) => {
    const uid = Number(req.query.user) || req.user.id;
    if (uid !== req.user.id && !can(req.user, 'attendance')) fail(403, 'No access');
    const u = get('SELECT * FROM users WHERE id = ?', uid);
    if (!u) fail(404, 'Not found');
    const month = /^\d{4}-\d{2}$/.test(req.query.month) ? req.query.month : U.today().slice(0, 7);
    const days = [];
    for (let d = `${month}-01`; d <= U.monthEnd(`${month}-01`) && d <= U.today(); d = U.addDays(d, 1)) {
      const s = daySummary(u, d);
      days.push({ ...s, in_time: s.first_in ? localTime(s.first_in) : null, out_time: s.last_out ? localTime(s.last_out) : null, sessions: s.sessions.map((x) => ({ ...x, in_time: localTime(x.clock_in), out_time: x.clock_out ? localTime(x.clock_out) : null })) });
    }
    const count = (st) => days.filter((d) => d.status === st).length;
    return { user: { id: u.id, name: u.name }, month, days, totals: { present: count('present') + count('late'), late: count('late'), absent: count('absent'), leave: count('leave') + count('half_leave') / 2, hours: Math.round(days.reduce((s, d) => s + d.minutes, 0) / 6) / 10 } };
  }));
  app.get('/api/attendance/export', need('attendance'), h((req, res) => {
    const month = /^\d{4}-\d{2}$/.test(req.query.month) ? req.query.month : U.today().slice(0, 7);
    const end = U.monthEnd(`${month}-01`);
    const dates = []; for (let d = `${month}-01`; d <= end; d = U.addDays(d, 1)) dates.push(d);
    const code = { present: 'P', late: 'L', absent: 'A', leave: 'LV', half_leave: 'HL', off: '-', not_in: '' };
    const lines = [['Name', ...dates.map((d) => d.slice(8)), 'Present', 'Late', 'Absent', 'Leave', 'Hours'].join(',')];
    for (const u of all('SELECT * FROM users WHERE active = 1 ORDER BY name')) {
      const ds = dates.map((d) => (d <= U.today() ? daySummary(u, d) : null));
      const n = (st) => ds.filter((x) => x?.status === st).length;
      lines.push([`"${u.name.replace(/"/g, '""')}"`, ...ds.map((x) => (x ? code[x.status] : '')), n('present') + n('late'), n('late'), n('absent'), n('leave') + n('half_leave') / 2,
        Math.round(ds.reduce((s, x) => s + (x?.minutes || 0), 0) / 6) / 10].join(','));
    }
    res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="attendance-${month}.csv"` });
    res.send('﻿' + lines.join('\n'));
  }));
  app.patch('/api/attendance/sessions/:id', need('attendance', 'edit'), h((req) => {
    const s = get('SELECT * FROM attendance WHERE id = ?', req.params.id);
    if (!s) fail(404, 'Not found');
    const at = (hhmm) => new Date(`${s.date}T${hhmm}:00+04:00`).toISOString();
    if (req.body.delete) { run('DELETE FROM attendance WHERE id = ?', s.id); return { ok: true }; }
    if (/^\d{2}:\d{2}$/.test(req.body.in)) run('UPDATE attendance SET clock_in = ? WHERE id = ?', at(req.body.in), s.id);
    if (/^\d{2}:\d{2}$/.test(req.body.out)) run('UPDATE attendance SET clock_out = ?, auto_closed = 0 WHERE id = ?', at(req.body.out), s.id);
    ctx.broadcast('attendance', 'attendance');
    return { ok: true };
  }));

  // ---------- leave & missed punch ----------
  app.get('/api/leaves', h((req) => {
    const all_ = can(req.user, 'attendance') && req.query.all;
    return { leaves: all(`SELECT l.*, u.name user_name, r.name reviewer_name FROM leaves l JOIN users u ON u.id = l.user_id LEFT JOIN users r ON r.id = l.reviewer_id
      ${all_ ? '' : `WHERE l.user_id = ${req.user.id}`} ORDER BY l.status = 'pending' DESC, l.from_date DESC LIMIT 500`).map((l) => ({ ...l, data: JSON.parse(l.data || '{}') })), types: LEAVE_TYPES };
  }));
  app.post('/api/leaves', h((req) => {
    const b = req.body;
    const type = LEAVE_TYPES[b.type] ? b.type : 'annual';
    if (!U.isDate(b.from_date)) fail(400, 'Pick the date');
    const to = U.isDate(b.to_date) && b.to_date >= b.from_date ? b.to_date : b.from_date;
    const data = type === 'missed_punch' ? { in: /^\d{2}:\d{2}$/.test(b.in) ? b.in : null, out: /^\d{2}:\d{2}$/.test(b.out) ? b.out : null } : {};
    if (type === 'missed_punch' && !data.in && !data.out) fail(400, 'Enter the time you came in and/or left');
    if (!clean(b.reason, 1000) && type !== 'annual') fail(400, 'Add a reason');
    const r = run('INSERT INTO leaves (user_id, type, from_date, to_date, half_day, data, reason) VALUES (?, ?, ?, ?, ?, ?, ?)',
      req.user.id, type, b.from_date, type === 'missed_punch' ? b.from_date : to, b.half_day ? 1 : 0, JSON.stringify(data), clean(b.reason, 1000));
    notify(managers(), { type: 'leave', title: `${LEAVE_TYPES[type]} request from ${req.user.name}`, body: `${b.from_date}${to !== b.from_date ? ` → ${to}` : ''} ${clean(b.reason, 200)}`, link: 'attendance?tab=requests' }, { exclude: req.user.id });
    ctx.broadcast('attendance', 'leaves'); ctx.emitTo([req.user.id], 'leaves');
    return { id: Number(r.lastInsertRowid) };
  }));
  app.post('/api/leaves/:id/review', need('attendance', 'edit'), h((req) => {
    const l = get('SELECT * FROM leaves WHERE id = ?', req.params.id);
    if (!l) fail(404, 'Not found');
    if (l.user_id === req.user.id) fail(400, "You can't approve your own request");
    if (l.status !== 'pending') fail(400, 'Already answered');
    const status = req.body.approve ? 'approved' : 'rejected';
    tx(() => {
      run('UPDATE leaves SET status = ?, reviewer_id = ?, review_note = ? WHERE id = ?', status, req.user.id, clean(req.body.note, 500), l.id);
      if (status === 'approved' && l.type === 'missed_punch') {
        const d = JSON.parse(l.data || '{}');
        const at = (hhmm) => new Date(`${l.from_date}T${hhmm}:00+04:00`).toISOString();
        const open = get('SELECT * FROM attendance WHERE user_id = ? AND date = ? ORDER BY clock_in LIMIT 1', l.user_id, l.from_date);
        if (open) {
          if (d.in) run('UPDATE attendance SET clock_in = ? WHERE id = ?', at(d.in), open.id);
          if (d.out) run('UPDATE attendance SET clock_out = ?, auto_closed = 0 WHERE id = (SELECT id FROM attendance WHERE user_id = ? AND date = ? ORDER BY clock_in DESC LIMIT 1)', at(d.out), l.user_id, l.from_date);
        } else if (d.in) run(`INSERT INTO attendance (user_id, date, clock_in, clock_out, in_place) VALUES (?, ?, ?, ?, 'Missed punch (approved)')`, l.user_id, l.from_date, at(d.in), d.out ? at(d.out) : null);
      }
    });
    notify([l.user_id], { type: 'leave', title: `${LEAVE_TYPES[l.type]} ${status}`, body: `${l.from_date}${l.to_date !== l.from_date ? ` → ${l.to_date}` : ''}${req.body.note ? ` — ${clean(req.body.note, 200)}` : ''}`, link: 'attendance' });
    ctx.broadcast('attendance', 'leaves'); ctx.emitTo([l.user_id], 'leaves');
    return { ok: true };
  }));
  app.post('/api/leaves/:id/cancel', h((req) => {
    const l = get('SELECT * FROM leaves WHERE id = ? AND user_id = ?', req.params.id, req.user.id);
    if (!l || l.status !== 'pending') fail(400, 'Only pending requests can be cancelled');
    run(`UPDATE leaves SET status = 'cancelled' WHERE id = ?`, l.id);
    ctx.broadcast('attendance', 'leaves'); ctx.emitTo([req.user.id], 'leaves');
    return { ok: true };
  }));

  // ---------- offices & shifts ----------
  app.get('/api/offices', h((req) => ({
    offices: all('SELECT * FROM offices ORDER BY id').map((o) => (can(req.user, 'settings') ? o : { ...o, allowed_ips: undefined })),
    shifts: all('SELECT * FROM shifts ORDER BY id'), my_ip: req.ip,
  })));
  const officeValues = (b) => ({
    name: clean(b.name, 80), address: clean(b.address, 300), lat: b.lat === '' || b.lat === null || b.lat === undefined ? null : Number(b.lat) || null,
    lng: b.lng === '' || b.lng === null || b.lng === undefined ? null : Number(b.lng) || null, radius_m: Math.max(50, Math.round(U.num(b.radius_m, 200))),
    allowed_ips: clean(b.allowed_ips, 500), field: b.field ? 1 : 0,
  });
  app.post('/api/offices', need('settings', 'edit'), h((req) => {
    const f = officeValues(req.body);
    if (!f.name) fail(400, 'Name the office');
    run('INSERT INTO offices (name, address, lat, lng, radius_m, allowed_ips, field) VALUES (?, ?, ?, ?, ?, ?, ?)', f.name, f.address, f.lat, f.lng, f.radius_m, f.allowed_ips, f.field);
    return { ok: true };
  }));
  app.patch('/api/offices/:id', need('settings', 'edit'), h((req) => {
    const o = get('SELECT * FROM offices WHERE id = ?', req.params.id);
    if (!o) fail(404, 'Not found');
    const f = officeValues({ ...o, ...req.body });
    run('UPDATE offices SET name = ?, address = ?, lat = ?, lng = ?, radius_m = ?, allowed_ips = ?, field = ? WHERE id = ?', f.name || o.name, f.address, f.lat, f.lng, f.radius_m, f.allowed_ips, f.field, o.id);
    return { ok: true };
  }));
  app.delete('/api/offices/:id', need('settings', 'edit'), h((req) => {
    run('UPDATE users SET office_id = NULL WHERE office_id = ?', Number(req.params.id));
    run('DELETE FROM offices WHERE id = ?', Number(req.params.id));
    return { ok: true };
  }));
  const shiftValues = (b) => {
    if (!/^\d{2}:\d{2}$/.test(b.start) || !/^\d{2}:\d{2}$/.test(b.end)) fail(400, 'Enter start and end times');
    return { name: clean(b.name, 60) || `${b.start}–${b.end}`, start: b.start, end: b.end, days: (Array.isArray(b.days) ? b.days : String(b.days || '').split(',')).map(Number).filter((d) => d >= 0 && d <= 6).join(','), grace: Math.max(0, Math.round(U.num(b.grace, 15))), color: clean(b.color, 20) || '#0069b7' };
  };
  app.post('/api/shifts', need('attendance', 'edit'), h((req) => {
    const f = shiftValues(req.body);
    run('INSERT INTO shifts (name, start, end, days, grace, color) VALUES (?, ?, ?, ?, ?, ?)', f.name, f.start, f.end, f.days, f.grace, f.color);
    return { ok: true };
  }));
  app.patch('/api/shifts/:id', need('attendance', 'edit'), h((req) => {
    const s = get('SELECT * FROM shifts WHERE id = ?', req.params.id);
    if (!s) fail(404, 'Not found');
    const f = shiftValues({ ...s, ...req.body });
    run('UPDATE shifts SET name = ?, start = ?, end = ?, days = ?, grace = ?, color = ? WHERE id = ?', f.name, f.start, f.end, f.days, f.grace, f.color, s.id);
    return { ok: true };
  }));
  app.delete('/api/shifts/:id', need('attendance', 'edit'), h((req) => {
    run('UPDATE users SET shift_id = NULL WHERE shift_id = ?', Number(req.params.id));
    run('DELETE FROM shifts WHERE id = ?', Number(req.params.id));
    return { ok: true };
  }));
}

// Runs every few minutes from the scheduler: close forgotten clock-outs, remind people who haven't clocked in
function tick(ctx) {
  const now = new Date();
  for (const s of all('SELECT a.*, u.shift_id FROM attendance a JOIN users u ON u.id = a.user_id WHERE a.clock_out IS NULL')) {
    const sh = shiftOf({ shift_id: s.shift_id });
    const end = new Date(`${s.date}T${sh?.end || '18:00'}:00+04:00`);
    if (now - end > 4 * 3600e3) run(`UPDATE attendance SET clock_out = ?, auto_closed = 1 WHERE id = ?`, end.toISOString(), s.id);
  }
  const today = U.today();
  const nowMin = toMin(new Date().toLocaleTimeString('en-GB', { timeZone: U.TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }));
  for (const u of all('SELECT * FROM users WHERE active = 1')) {
    const sh = shiftOf(u);
    if (!sh || !String(sh.days).split(',').map(Number).includes(weekday(today))) continue;
    if (nowMin < toMin(sh.start) + 30 || nowMin > toMin(sh.start) + 120) continue;
    const key = `att_nudge_${u.id}`;
    if (U.setting(key) === today) continue;
    if (get('SELECT id FROM attendance WHERE user_id = ? AND date = ?', u.id, today)) continue;
    if (get(`SELECT id FROM leaves WHERE user_id = ? AND status = 'approved' AND type != 'missed_punch' AND ? BETWEEN from_date AND to_date`, u.id, today)) continue;
    U.setSetting(key, today);
    ctx.notify([u.id], { type: 'attendance', title: '⏰ You haven’t clocked in yet', body: `Your shift started at ${sh.start}.`, link: 'attendance' });
  }
}

module.exports = { register, tick, daySummary, LEAVE_TYPES };
