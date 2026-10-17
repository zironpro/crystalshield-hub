// Daily backups: a consistent copy of the database every night (02:00 UAE), the last 14 kept on the server.
// Admins can run / download one any time (Settings → Backups).
const fs = require('node:fs');
const path = require('node:path');
const { db, all, dataDir } = require('./db');
const U = require('./util');

const DIR = path.resolve(dataDir, 'backups');
const KEEP = 14;
fs.mkdirSync(DIR, { recursive: true });

function list() {
  return fs.readdirSync(DIR).filter((f) => /^hub-[\dT-]+\.db$/.test(f)).sort().reverse()
    .map((name) => { const st = fs.statSync(path.join(DIR, name)); return { name, size: st.size, at: st.mtime.toISOString() }; });
}
function makeBackup(reason = 'daily') {
  const stamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
  const name = reason === 'daily' ? `hub-${stamp.slice(0, 10)}.db` : `hub-${stamp}.db`;
  const file = path.join(DIR, name);
  if (fs.existsSync(file)) fs.unlinkSync(file);
  db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  for (const old of list().slice(KEEP)) fs.unlinkSync(path.join(DIR, old.name));
  U.setSetting('backup_last_at', new Date().toISOString());
  console.log(`[backup] ${name} saved`);
  return { name };
}

function register(ctx) {
  const { app, h, need } = ctx;
  app.get('/api/backups', need('settings', 'edit'), h(() => ({ backups: list(), last_at: U.setting('backup_last_at'), keep: KEEP })));
  app.post('/api/backups/run', need('settings', 'edit'), h(() => makeBackup('manual')));
  app.get('/api/backups/:name', need('settings', 'edit'), (req, res) => {
    const name = path.basename(req.params.name);
    const file = path.join(DIR, name);
    if (!/^hub-[\dT-]+\.db$/.test(name) || !fs.existsSync(file)) return res.status(404).json({ error: 'Backup not found' });
    res.download(file, `crystalshield-${name}`);
  });
  setInterval(() => {
    if (U.uaeHour() < 2 || U.setting('backup_last_daily') === U.today()) return;
    U.setSetting('backup_last_daily', U.today());
    try { makeBackup('daily'); } catch (err) {
      console.error('[backup] failed:', err.message);
      ctx.notify(ctx.usersWith('settings', 'edit'), { type: 'urgent', title: '⚠ Nightly backup failed', body: err.message, link: 'settings' }, { emailAlways: true });
    }
  }, 10 * 60e3).unref();
}
module.exports = { register, makeBackup };
