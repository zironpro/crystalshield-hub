// Timed jobs: morning plan for everyone, reminders before calls / site visits / installations, overdue
// invoices → payment follow-ups, quotations past their validity → expired, attendance clean-up.
const { all, get, run } = require('./db');
const U = require('./util');
const S = require('./settings');
const jobs = require('./jobs');
const attendance = require('./attendance');
const { ACTIVITY_LABEL } = require('./crm');

function onceADay(key, hour, fn) {
  if (U.uaeHour() < hour) return;
  const k = `sched_${key}`;
  if (U.setting(k) === U.today()) return;
  U.setSetting(k, U.today());
  try { fn(); } catch (err) { console.error(`[scheduler] ${key}`, err); }
}
const nowMin = () => { const [h, m] = U.nowUAE().slice(11, 16).split(':').map(Number); return h * 60 + m; };
const toMin = (t) => { const [h, m] = String(t).split(':').map(Number); return h * 60 + m; };

function start(ctx) {
  const tick = () => {
    try { attendance.tick(ctx); } catch (err) { console.error('[scheduler] attendance', err); }
    const today = U.today();

    // 30 minutes before a timed activity
    for (const a of all(`SELECT * FROM activities WHERE status = 'planned' AND date = ? AND start_time IS NOT NULL AND reminded = 0`, today)) {
      const diff = toMin(a.start_time) - nowMin();
      if (diff > 30 || diff < -5) continue;
      run('UPDATE activities SET reminded = 1 WHERE id = ?', a.id);
      ctx.notify([a.assigned_to], { type: 'activity', title: `⏰ ${ACTIVITY_LABEL[a.type]} at ${a.start_time}: ${a.title}`, body: a.notes, link: a.deal_id ? `deals/${a.deal_id}` : a.lead_id ? `leads/${a.lead_id}` : 'calendar' });
    }
    // installations: evening before (18:00) and one hour before start
    for (const j of all(`SELECT j.*, c.name contact_name FROM jobs j LEFT JOIN contacts c ON c.id = j.contact_id WHERE j.status = 'scheduled' AND j.date IN (?, ?)`, today, U.addDays(today, 1))) {
      const done = new Set(String(j.reminded || '').split(',').filter(Boolean));
      const who = jobs.installersOf(j);
      if (!who.length) continue;
      if (j.date !== today && nowMin() >= 18 * 60 && !done.has('eve')) {
        done.add('eve');
        ctx.notify(who, { type: 'job', title: `🛠 Tomorrow: ${j.contact_name || j.title}${j.start_time ? ` at ${j.start_time}` : ''}`, body: j.address, link: `jobs/${j.id}` });
      }
      if (j.date === today && j.start_time && toMin(j.start_time) - nowMin() <= 60 && toMin(j.start_time) - nowMin() > -30 && !done.has('soon')) {
        done.add('soon');
        ctx.notify(who, { type: 'job', title: `🚐 ${j.number} starts at ${j.start_time}`, body: `${j.contact_name || ''} · ${j.address}`, link: `jobs/${j.id}` });
      }
      run('UPDATE jobs SET reminded = ? WHERE id = ?', [...done].join(','), j.id);
    }

    // 08:30 — everyone's plan for the day
    onceADay('digest', 8, () => {
      if (nowMin() < 8 * 60 + 30) { U.setSetting('sched_digest', ''); return; }
      for (const u of all('SELECT * FROM users WHERE active = 1')) {
        const acts = get(`SELECT COUNT(*) n FROM activities WHERE assigned_to = ? AND status = 'planned' AND date <= ?`, u.id, today).n;
        const fups = get(`SELECT COUNT(*) n FROM followups WHERE assigned_to = ? AND status = 'pending' AND due_date <= ?`, u.id, today).n;
        const leads = get(`SELECT COUNT(*) n FROM leads WHERE owner_id = ? AND status IN ('new','contacted','qualified') AND (next_follow_up IS NULL OR next_follow_up <= ?)`, u.id, today).n;
        const myJobs = all(`SELECT * FROM jobs WHERE status NOT IN ('cancelled','signed_off') AND date <= ? AND COALESCE(end_date, date) >= ?`, today, today).filter((j) => jobs.installersOf(j).includes(u.id)).length;
        const parts = [acts && `${acts} call${acts === 1 ? '' : 's'} / visit${acts === 1 ? '' : 's'}`, myJobs && `${myJobs} installation${myJobs === 1 ? '' : 's'}`, leads && `${leads} lead${leads === 1 ? '' : 's'} to follow up`, fups && `${fups} customer follow-up${fups === 1 ? '' : 's'}`].filter(Boolean);
        if (parts.length) ctx.notify([u.id], { type: 'digest', title: '☀️ Your day', body: parts.join(' · '), link: '' });
      }
    });

    // 09:00 — overdue invoices get a payment follow-up; expired quotations
    onceADay('money', 9, () => {
      if (S.automation().payment_on) {
        const accounts = ctx.usersWith('invoices', 'edit');
        for (const i of all(`SELECT i.*, c.name contact_name FROM invoices i LEFT JOIN contacts c ON c.id = i.contact_id WHERE i.status IN ('unpaid','partial') AND i.due_date < ?`, today)) {
          const owner = i.deal_id ? get('SELECT owner_id FROM deals WHERE id = ?', i.deal_id)?.owner_id : null;
          const id = jobs.addFollowup(ctx, {
            type: 'payment', title: `Collect ${U.fmtAED(i.total - i.paid)} — ${i.number}`, due_date: today, unique: true,
            assigned_to: accounts[0] || owner, contact_id: i.contact_id, deal_id: i.deal_id, invoice_id: i.id,
          });
          if (id) ctx.notify([accounts[0] || owner, owner], { type: 'payment', title: `💸 Overdue: ${i.number} (${i.contact_name || ''})`, body: `${U.fmtAED(i.total - i.paid)} was due ${i.due_date}`, link: `invoices/${i.id}` });
        }
      }
      for (const q of all(`SELECT * FROM quotes WHERE status = 'sent' AND valid_until < ?`, today)) {
        run(`UPDATE quotes SET status = 'expired' WHERE id = ?`, q.id);
        ctx.timeline('quote', q.id, null, 'stage', 'Quotation expired');
        if (q.deal_id) ctx.timeline('deal', q.deal_id, null, 'document', `Quotation ${q.number} expired`);
        ctx.notify([q.owner_id], { type: 'quote', title: `Quotation ${q.number} expired`, body: 'Follow up with the customer or send a revised quotation.', link: `quotes/${q.id}` });
      }
    });
  };
  setTimeout(tick, 5000).unref();
  setInterval(tick, 5 * 60e3).unref();
}

module.exports = { start };
