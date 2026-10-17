// Small shared helpers: settings, document numbers, money, UAE dates.
const crypto = require('node:crypto');
const { get, run } = require('./db');

const TZ = 'Asia/Dubai';

function setting(key, fallback = null) {
  const v = get('SELECT value FROM settings WHERE key = ?', key)?.value;
  return v === undefined || v === null ? fallback : v;
}
function setSetting(key, value) {
  if (value === null || value === undefined) return run('DELETE FROM settings WHERE key = ?', key);
  run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, String(value));
}
const settingJSON = (key, fallback) => { try { return JSON.parse(setting(key)) ?? fallback; } catch { return fallback; } };

// ---------- document numbers ----------
const NUMBERING = {
  contact: { prefix: 'CT-', start: 1001 },
  lead: { prefix: 'LD-', start: 1001 },
  deal: { prefix: 'DL-', start: 101 },
  quote: { prefix: 'QT-', start: 1001 },
  invoice: { prefix: 'INV-{YYYY}-', start: 1001 },
  payment: { prefix: 'RCT-{YYYY}-', start: 1001 },
  po: { prefix: 'PO-{YYYY}-', start: 101 },
  grn: { prefix: 'GRN-', start: 1001 },
  vendor_payment: { prefix: 'PV-', start: 1001 },
  expense: { prefix: 'EXP-', start: 1001 },
  journal: { prefix: 'JV-', start: 1001 },
  manual_journal: { prefix: 'MJ-', start: 1 },
  job: { prefix: 'JOB-', start: 1001 },
  warranty: { prefix: 'WR-', start: 10001 },
  claim: { prefix: 'CL-', start: 101 },
  product: { prefix: 'FLM-', start: 101 },
};
function nextNumber(type) {
  const n = NUMBERING[type];
  const last = Number(setting(`seq_${type}`, n.start - 1));
  const next = last + 1;
  setSetting(`seq_${type}`, next);
  const prefix = (setting(`prefix_${type}`) ?? n.prefix).replace('{YYYY}', today().slice(0, 4));
  return `${prefix}${next}`;
}

// ---------- money ----------
const r2 = (n) => Math.round((Number(n) || 0) * 100 + Number.EPSILON * 100) / 100;
const num = (v, fallback = 0) => { const n = Number(v); return Number.isFinite(n) ? n : fallback; };

// ---------- dates (the company works on UAE time) ----------
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: TZ });
const nowUAE = () => new Date().toLocaleString('sv-SE', { timeZone: TZ }).replace(' ', 'T'); // 2026-10-17T09:30:00
const uaeHour = () => Number(new Date().toLocaleString('en-GB', { timeZone: TZ, hour: '2-digit', hourCycle: 'h23' }));
function addDays(date, days) {
  const d = new Date(date + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
function addYears(date, years) {
  const d = new Date(date + 'T00:00:00Z');
  d.setUTCFullYear(d.getUTCFullYear() + years);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}
const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(new Date(s + 'T00:00:00Z'));
const monthStart = (date = today()) => date.slice(0, 7) + '-01';
function monthEnd(date = today()) {
  const d = new Date(date.slice(0, 7) + '-01T00:00:00Z');
  d.setUTCMonth(d.getUTCMonth() + 1); d.setUTCDate(0);
  return d.toISOString().slice(0, 10);
}

const token = (bytes = 18) => crypto.randomBytes(bytes).toString('base64url');
const fmtAED = (n) => `AED ${r2(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// Area of one measured piece of glass, in square metres
const UNIT_TO_M = { mm: 0.001, cm: 0.01, m: 1, in: 0.0254, ft: 0.3048 };
const sqmOf = (length, width, qty, unit) => r2(num(length) * (UNIT_TO_M[unit] || 0.01) * num(width) * (UNIT_TO_M[unit] || 0.01) * Math.max(0, num(qty, 1)));

module.exports = {
  TZ, setting, setSetting, settingJSON, NUMBERING, nextNumber, r2, num, today, nowUAE, uaeHour, addDays, addYears, isDate,
  monthStart, monthEnd, token, fmtAED, UNIT_TO_M, sqmOf,
};
