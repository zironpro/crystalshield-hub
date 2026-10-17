const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');

const dataDir = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
fs.mkdirSync(dataDir, { recursive: true });

const db = new DatabaseSync(path.join(dataDir, 'hub.db'));
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');

db.exec(`
-- ---------- people, roles, sessions ----------
CREATE TABLE IF NOT EXISTS roles (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  description TEXT NOT NULL DEFAULT '',
  is_admin INTEGER NOT NULL DEFAULT 0,
  perms TEXT NOT NULL DEFAULT '{}',          -- {"crm":{"view":"own","create":true,...},"see_costs":true}
  system TEXT,                                -- admin | manager | sales | accounts | installer (built-in roles)
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  role_id INTEGER REFERENCES roles(id),
  title TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  color TEXT NOT NULL DEFAULT '#00386b',
  active INTEGER NOT NULL DEFAULT 1,
  email_notify INTEGER NOT NULL DEFAULT 1,
  sound INTEGER NOT NULL DEFAULT 1,
  whatsapp TEXT,
  whatsapp_alerts INTEGER NOT NULL DEFAULT 1,
  avatar TEXT,
  avatar_v INTEGER NOT NULL DEFAULT 0,
  office_id INTEGER,
  shift_id INTEGER,
  status_emoji TEXT, status_text TEXT, status_until TEXT,
  last_seen TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  remember INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  link TEXT NOT NULL DEFAULT '',
  read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS notifications_user ON notifications(user_id, id);
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  keys TEXT NOT NULL,
  device TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------- files (site photos, drawings, receipts, product images, signatures) ----------
CREATE TABLE IF NOT EXISTS files (
  id INTEGER PRIMARY KEY,
  token TEXT NOT NULL UNIQUE,          -- random file name on disk (DATA_DIR/uploads)
  entity TEXT NOT NULL,                -- deal | lead | contact | job | expense | product | claim | po | company
  entity_id INTEGER NOT NULL,
  kind TEXT NOT NULL DEFAULT 'other',  -- site_photo | drawing | measurement | document | before | after | signature | receipt | image | other
  name TEXT NOT NULL,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  user_id INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS files_entity ON files(entity, entity_id);

-- ---------- CRM ----------
CREATE TABLE IF NOT EXISTS contacts (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'individual',   -- individual | business
  name TEXT NOT NULL,                        -- person or company name
  contact_person TEXT NOT NULL DEFAULT '',   -- for businesses
  designation TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  whatsapp TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  trn TEXT NOT NULL DEFAULT '',              -- UAE VAT registration number
  address TEXT NOT NULL DEFAULT '',
  city TEXT NOT NULL DEFAULT '',
  area TEXT NOT NULL DEFAULT '',
  location_url TEXT NOT NULL DEFAULT '',
  tags TEXT NOT NULL DEFAULT '',             -- comma separated
  source TEXT NOT NULL DEFAULT '',
  owner_id INTEGER REFERENCES users(id),
  notes TEXT NOT NULL DEFAULT '',
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS leads (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  company TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'Other',
  campaign TEXT NOT NULL DEFAULT '',
  property_type TEXT NOT NULL DEFAULT '',
  service TEXT NOT NULL DEFAULT '',
  city TEXT NOT NULL DEFAULT '',
  area TEXT NOT NULL DEFAULT '',
  message TEXT NOT NULL DEFAULT '',
  est_value REAL NOT NULL DEFAULT 0,
  tags TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'new',        -- new | contacted | qualified | unqualified | converted
  lost_reason TEXT NOT NULL DEFAULT '',
  owner_id INTEGER REFERENCES users(id),
  contact_id INTEGER REFERENCES contacts(id) ON DELETE SET NULL,
  deal_id INTEGER,
  next_follow_up TEXT,
  raw TEXT,                                  -- original webhook payload
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  status_changed_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS leads_status ON leads(status);
CREATE TABLE IF NOT EXISTS deals (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL,
  title TEXT NOT NULL,
  contact_id INTEGER REFERENCES contacts(id) ON DELETE SET NULL,
  lead_id INTEGER REFERENCES leads(id) ON DELETE SET NULL,
  owner_id INTEGER REFERENCES users(id),
  stage TEXT NOT NULL DEFAULT 'new',         -- new | site_visit | measured | quoted | negotiation | won | lost
  value REAL NOT NULL DEFAULT 0,
  property_type TEXT NOT NULL DEFAULT '',
  service TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  city TEXT NOT NULL DEFAULT '',
  area TEXT NOT NULL DEFAULT '',
  location_url TEXT NOT NULL DEFAULT '',
  expected_close TEXT,
  next_follow_up TEXT,
  lost_reason TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  won_at TEXT, lost_at TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  stage_changed_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS deals_stage ON deals(stage);
-- Everything that happened on a record (notes, calls, stage changes, forms, documents)
CREATE TABLE IF NOT EXISTS timeline (
  id INTEGER PRIMARY KEY,
  entity TEXT NOT NULL,                      -- lead | deal | contact | job | invoice | quote | po | warranty
  entity_id INTEGER NOT NULL,
  user_id INTEGER REFERENCES users(id),
  kind TEXT NOT NULL DEFAULT 'note',         -- note | call | whatsapp | email | meeting | site_visit | stage | system | form | document | payment
  body TEXT NOT NULL DEFAULT '',
  data TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS timeline_entity ON timeline(entity, entity_id, id);
-- Calendar: calls, meetings, site visits, measurements, follow-ups, tasks
CREATE TABLE IF NOT EXISTS activities (
  id INTEGER PRIMARY KEY,
  type TEXT NOT NULL DEFAULT 'task',         -- call | meeting | site_visit | measurement | follow_up | task | payment_follow_up
  title TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  date TEXT NOT NULL,
  start_time TEXT, end_time TEXT,
  assigned_to INTEGER REFERENCES users(id),
  lead_id INTEGER REFERENCES leads(id) ON DELETE CASCADE,
  deal_id INTEGER REFERENCES deals(id) ON DELETE CASCADE,
  contact_id INTEGER REFERENCES contacts(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'planned',    -- planned | done | cancelled
  outcome TEXT NOT NULL DEFAULT '',
  reminded INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  done_at TEXT
);
CREATE INDEX IF NOT EXISTS activities_date ON activities(date);

-- ---------- estimation: glass measured on site ----------
CREATE TABLE IF NOT EXISTS measurements (
  id INTEGER PRIMARY KEY,
  deal_id INTEGER NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  location TEXT NOT NULL DEFAULT '',         -- e.g. "Lobby – north façade"
  length REAL NOT NULL DEFAULT 0,
  width REAL NOT NULL DEFAULT 0,
  qty INTEGER NOT NULL DEFAULT 1,
  unit TEXT NOT NULL DEFAULT 'cm',           -- mm | cm | m | in | ft
  sqm REAL NOT NULL DEFAULT 0,
  product_id INTEGER,
  notes TEXT NOT NULL DEFAULT '',
  position INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------- products & stock ----------
CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'solar',    -- solar | safety | blast | surface | privacy | decorative | service | material
  brand TEXT NOT NULL DEFAULT '',
  vlt REAL, heat_rejection REAL, uv_block REAL, thickness TEXT NOT NULL DEFAULT '',
  warranty_years INTEGER NOT NULL DEFAULT 0,
  description TEXT NOT NULL DEFAULT '',
  unit TEXT NOT NULL DEFAULT 'SQM',
  sell_price REAL NOT NULL DEFAULT 0,
  cost_price REAL NOT NULL DEFAULT 0,
  track_stock INTEGER NOT NULL DEFAULT 1,
  min_stock REAL NOT NULL DEFAULT 0,
  image_file_id INTEGER,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS stock_moves (
  id INTEGER PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  qty REAL NOT NULL,                         -- + in, − out
  unit_cost REAL NOT NULL DEFAULT 0,
  kind TEXT NOT NULL,                        -- opening | purchase | sale | job | adjustment | return
  ref_type TEXT, ref_id INTEGER,             -- grn | invoice | job | adjustment
  note TEXT NOT NULL DEFAULT '',
  user_id INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS stock_moves_product ON stock_moves(product_id, date);
CREATE INDEX IF NOT EXISTS stock_moves_ref ON stock_moves(ref_type, ref_id);
CREATE TABLE IF NOT EXISTS vendors (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  contact_person TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  trn TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------- pricing sheet on a deal: one set of items for the quotation AND the purchase orders ----------
CREATE TABLE IF NOT EXISTS deal_items (
  id INTEGER PRIMARY KEY,
  deal_id INTEGER NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0,
  kind TEXT NOT NULL DEFAULT 'item',         -- item | header
  product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
  name TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  qty REAL NOT NULL DEFAULT 0,
  unit TEXT NOT NULL DEFAULT 'SQM',
  price REAL NOT NULL DEFAULT 0,             -- selling price per unit
  cost REAL NOT NULL DEFAULT 0,              -- purchase price per unit
  vendor_id INTEGER REFERENCES vendors(id) ON DELETE SET NULL
);

-- ---------- quotations ----------
CREATE TABLE IF NOT EXISTS quotes (
  id INTEGER PRIMARY KEY,
  number TEXT NOT NULL,
  deal_id INTEGER REFERENCES deals(id) ON DELETE SET NULL,
  contact_id INTEGER REFERENCES contacts(id) ON DELETE SET NULL,
  subject TEXT NOT NULL DEFAULT '',
  date TEXT NOT NULL,
  valid_until TEXT,
  status TEXT NOT NULL DEFAULT 'draft',      -- draft | sent | accepted | rejected | expired
  attention TEXT NOT NULL DEFAULT '',
  site_location TEXT NOT NULL DEFAULT '',
  glass_location TEXT NOT NULL DEFAULT '',
  glass_area REAL NOT NULL DEFAULT 0,
  intro TEXT NOT NULL DEFAULT '',
  remarks TEXT NOT NULL DEFAULT '',
  terms TEXT NOT NULL DEFAULT '',
  discount REAL NOT NULL DEFAULT 0,
  vat_rate REAL NOT NULL DEFAULT 5,
  subtotal REAL NOT NULL DEFAULT 0,
  vat REAL NOT NULL DEFAULT 0,
  total REAL NOT NULL DEFAULT 0,
  cost_total REAL NOT NULL DEFAULT 0,
  show_images INTEGER NOT NULL DEFAULT 1,
  token TEXT NOT NULL,
  owner_id INTEGER REFERENCES users(id),
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  sent_at TEXT, accepted_at TEXT, accepted_name TEXT, rejected_reason TEXT NOT NULL DEFAULT '', viewed_at TEXT
);
CREATE TABLE IF NOT EXISTS quote_items (
  id INTEGER PRIMARY KEY,
  quote_id INTEGER NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0,
  kind TEXT NOT NULL DEFAULT 'item',
  product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
  name TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  qty REAL NOT NULL DEFAULT 0,
  unit TEXT NOT NULL DEFAULT 'SQM',
  price REAL NOT NULL DEFAULT 0,
  cost REAL NOT NULL DEFAULT 0,
  vendor_id INTEGER REFERENCES vendors(id) ON DELETE SET NULL
);

-- ---------- invoices & payments ----------
CREATE TABLE IF NOT EXISTS invoices (
  id INTEGER PRIMARY KEY,
  number TEXT NOT NULL,
  quote_id INTEGER REFERENCES quotes(id) ON DELETE SET NULL,
  deal_id INTEGER REFERENCES deals(id) ON DELETE SET NULL,
  contact_id INTEGER REFERENCES contacts(id) ON DELETE SET NULL,
  kind TEXT NOT NULL DEFAULT 'standard',     -- standard | advance | balance
  subject TEXT NOT NULL DEFAULT '',
  date TEXT NOT NULL,
  due_date TEXT,
  status TEXT NOT NULL DEFAULT 'draft',      -- draft | unpaid | partial | paid | cancelled
  discount REAL NOT NULL DEFAULT 0,
  vat_rate REAL NOT NULL DEFAULT 5,
  subtotal REAL NOT NULL DEFAULT 0,
  vat REAL NOT NULL DEFAULT 0,
  total REAL NOT NULL DEFAULT 0,
  paid REAL NOT NULL DEFAULT 0,
  notes TEXT NOT NULL DEFAULT '',
  terms TEXT NOT NULL DEFAULT '',
  token TEXT NOT NULL,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  issued_at TEXT, sent_at TEXT, next_follow_up TEXT
);
CREATE TABLE IF NOT EXISTS invoice_items (
  id INTEGER PRIMARY KEY,
  invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0,
  kind TEXT NOT NULL DEFAULT 'item',
  product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
  name TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  qty REAL NOT NULL DEFAULT 0,
  unit TEXT NOT NULL DEFAULT 'SQM',
  price REAL NOT NULL DEFAULT 0,
  cost REAL NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY,
  number TEXT NOT NULL,
  invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  contact_id INTEGER REFERENCES contacts(id) ON DELETE SET NULL,
  date TEXT NOT NULL,
  amount REAL NOT NULL,
  method TEXT NOT NULL DEFAULT 'bank',       -- cash | bank | cheque | card | link
  reference TEXT NOT NULL DEFAULT '',
  account_id INTEGER,                        -- cash / bank account it went into
  notes TEXT NOT NULL DEFAULT '',
  token TEXT NOT NULL,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------- purchasing ----------
CREATE TABLE IF NOT EXISTS purchase_orders (
  id INTEGER PRIMARY KEY,
  number TEXT NOT NULL,
  vendor_id INTEGER REFERENCES vendors(id) ON DELETE SET NULL,
  deal_id INTEGER REFERENCES deals(id) ON DELETE SET NULL,
  date TEXT NOT NULL,
  expected_date TEXT,
  status TEXT NOT NULL DEFAULT 'draft',      -- draft | sent | partial | received | cancelled
  vendor_ref TEXT NOT NULL DEFAULT '',       -- the supplier's invoice / bill number
  notes TEXT NOT NULL DEFAULT '',
  vat_rate REAL NOT NULL DEFAULT 5,
  subtotal REAL NOT NULL DEFAULT 0,
  vat REAL NOT NULL DEFAULT 0,
  total REAL NOT NULL DEFAULT 0,
  received_value REAL NOT NULL DEFAULT 0,    -- incl. VAT, what we now owe the supplier
  paid REAL NOT NULL DEFAULT 0,
  token TEXT NOT NULL,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  sent_at TEXT
);
CREATE TABLE IF NOT EXISTS po_items (
  id INTEGER PRIMARY KEY,
  po_id INTEGER NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0,
  product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
  name TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  qty REAL NOT NULL DEFAULT 0,
  unit TEXT NOT NULL DEFAULT 'SQM',
  cost REAL NOT NULL DEFAULT 0,
  received_qty REAL NOT NULL DEFAULT 0
);
-- Goods received against a purchase order (each one posts stock + a supplier bill)
CREATE TABLE IF NOT EXISTS receipts (
  id INTEGER PRIMARY KEY,
  number TEXT NOT NULL,
  po_id INTEGER NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  lines TEXT NOT NULL DEFAULT '[]',          -- [{po_item_id, qty, cost}]
  subtotal REAL NOT NULL DEFAULT 0,
  vat REAL NOT NULL DEFAULT 0,
  total REAL NOT NULL DEFAULT 0,
  note TEXT NOT NULL DEFAULT '',
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS vendor_payments (
  id INTEGER PRIMARY KEY,
  number TEXT NOT NULL,
  vendor_id INTEGER REFERENCES vendors(id) ON DELETE SET NULL,
  po_id INTEGER REFERENCES purchase_orders(id) ON DELETE SET NULL,
  date TEXT NOT NULL,
  amount REAL NOT NULL,
  method TEXT NOT NULL DEFAULT 'bank',
  reference TEXT NOT NULL DEFAULT '',
  account_id INTEGER,
  notes TEXT NOT NULL DEFAULT '',
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------- expenses ----------
CREATE TABLE IF NOT EXISTS expenses (
  id INTEGER PRIMARY KEY,
  number TEXT NOT NULL,
  date TEXT NOT NULL,
  account_id INTEGER NOT NULL,               -- expense category (an expense account)
  deal_id INTEGER REFERENCES deals(id) ON DELETE SET NULL,
  job_id INTEGER,
  vendor_id INTEGER REFERENCES vendors(id) ON DELETE SET NULL,
  payee TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  amount REAL NOT NULL DEFAULT 0,            -- before VAT
  vat REAL NOT NULL DEFAULT 0,
  total REAL NOT NULL DEFAULT 0,
  paid_from INTEGER,                         -- cash / bank account
  method TEXT NOT NULL DEFAULT 'cash',
  reference TEXT NOT NULL DEFAULT '',
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------- accounting ----------
CREATE TABLE IF NOT EXISTS accounts (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  type TEXT NOT NULL,                        -- asset | liability | equity | income | expense
  key TEXT UNIQUE,                           -- system account (cash, bank, ar, ap, inventory, vat_in, vat_out, sales, cogs, ...)
  is_money INTEGER NOT NULL DEFAULT 0,       -- payments can go in / out of it (cash, bank)
  is_expense_category INTEGER NOT NULL DEFAULT 0,
  description TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS journals (
  id INTEGER PRIMARY KEY,
  number TEXT NOT NULL,
  date TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'manual',     -- invoice | payment | receipt | vendor_payment | expense | stock | manual | opening
  source_id INTEGER,
  status TEXT NOT NULL DEFAULT 'posted',     -- posted | draft
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS journals_source ON journals(source, source_id);
CREATE TABLE IF NOT EXISTS journal_lines (
  id INTEGER PRIMARY KEY,
  journal_id INTEGER NOT NULL REFERENCES journals(id) ON DELETE CASCADE,
  account_id INTEGER NOT NULL REFERENCES accounts(id),
  debit REAL NOT NULL DEFAULT 0,
  credit REAL NOT NULL DEFAULT 0,
  party TEXT,                                -- contact:12 | vendor:3
  memo TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS journal_lines_account ON journal_lines(account_id);

-- ---------- installations ----------
CREATE TABLE IF NOT EXISTS jobs (
  id INTEGER PRIMARY KEY,
  number TEXT NOT NULL,
  deal_id INTEGER REFERENCES deals(id) ON DELETE SET NULL,
  contact_id INTEGER REFERENCES contacts(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  address TEXT NOT NULL DEFAULT '',
  location_url TEXT NOT NULL DEFAULT '',
  date TEXT,                                 -- scheduled day
  end_date TEXT,                             -- multi-day jobs
  start_time TEXT, end_time TEXT,
  status TEXT NOT NULL DEFAULT 'scheduled',  -- scheduled | on_the_way | in_progress | completed | signed_off | on_hold | cancelled
  installer_ids TEXT NOT NULL DEFAULT '',
  lead_installer_id INTEGER REFERENCES users(id),
  instructions TEXT NOT NULL DEFAULT '',
  scope TEXT NOT NULL DEFAULT '[]',          -- [{name, qty, unit, location}] copied from the quotation
  checklist TEXT NOT NULL DEFAULT '[]',      -- [{text, done, by, at}]
  started_at TEXT, completed_at TEXT, on_way_at TEXT,
  start_lat REAL, start_lng REAL,
  signed_name TEXT, signed_at TEXT, signature_file_id INTEGER,
  rating INTEGER, feedback TEXT NOT NULL DEFAULT '',
  stock_done INTEGER NOT NULL DEFAULT 0,
  sign_token TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  reminded TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS jobs_date ON jobs(date);
CREATE TABLE IF NOT EXISTS job_materials (
  id INTEGER PRIMARY KEY,
  job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  planned_qty REAL NOT NULL DEFAULT 0,
  used_qty REAL
);

-- ---------- warranty & follow-ups ----------
CREATE TABLE IF NOT EXISTS warranties (
  id INTEGER PRIMARY KEY,
  number TEXT NOT NULL,
  job_id INTEGER REFERENCES jobs(id) ON DELETE SET NULL,
  deal_id INTEGER REFERENCES deals(id) ON DELETE SET NULL,
  contact_id INTEGER REFERENCES contacts(id) ON DELETE SET NULL,
  product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
  description TEXT NOT NULL DEFAULT '',
  location TEXT NOT NULL DEFAULT '',
  sqm REAL NOT NULL DEFAULT 0,
  years INTEGER NOT NULL DEFAULT 0,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',     -- active | void
  token TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS claims (
  id INTEGER PRIMARY KEY,
  number TEXT NOT NULL,
  warranty_id INTEGER REFERENCES warranties(id) ON DELETE SET NULL,
  contact_id INTEGER REFERENCES contacts(id) ON DELETE SET NULL,
  date TEXT NOT NULL,
  issue TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open',       -- open | inspecting | fixed | rejected
  resolution TEXT NOT NULL DEFAULT '',
  job_id INTEGER REFERENCES jobs(id) ON DELETE SET NULL,
  assigned_to INTEGER REFERENCES users(id),
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  closed_at TEXT
);
CREATE TABLE IF NOT EXISTS followups (
  id INTEGER PRIMARY KEY,
  type TEXT NOT NULL,                        -- review | check_in | inspection | warranty_expiry | quote | payment | custom
  title TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  due_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',    -- pending | done | skipped
  assigned_to INTEGER REFERENCES users(id),
  contact_id INTEGER REFERENCES contacts(id) ON DELETE CASCADE,
  deal_id INTEGER REFERENCES deals(id) ON DELETE SET NULL,
  job_id INTEGER REFERENCES jobs(id) ON DELETE SET NULL,
  warranty_id INTEGER REFERENCES warranties(id) ON DELETE SET NULL,
  invoice_id INTEGER REFERENCES invoices(id) ON DELETE SET NULL,
  quote_id INTEGER REFERENCES quotes(id) ON DELETE SET NULL,
  outcome TEXT NOT NULL DEFAULT '',
  done_at TEXT, done_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS followups_due ON followups(status, due_date);

-- ---------- attendance & leave ----------
CREATE TABLE IF NOT EXISTS offices (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  address TEXT NOT NULL DEFAULT '',
  lat REAL, lng REAL,
  radius_m INTEGER NOT NULL DEFAULT 200,     -- clock-in allowed within this distance (when GPS lock is on)
  allowed_ips TEXT NOT NULL DEFAULT '',      -- comma separated office internet addresses
  field INTEGER NOT NULL DEFAULT 0           -- 1 = field staff (installers): clock in anywhere, location recorded
);
CREATE TABLE IF NOT EXISTS shifts (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  start TEXT NOT NULL,
  end TEXT NOT NULL,
  days TEXT NOT NULL DEFAULT '1,2,3,4,5,6',
  grace INTEGER NOT NULL DEFAULT 15,
  color TEXT NOT NULL DEFAULT '#0069b7'
);
CREATE TABLE IF NOT EXISTS attendance (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  clock_in TEXT NOT NULL,
  clock_out TEXT,
  in_lat REAL, in_lng REAL, in_place TEXT NOT NULL DEFAULT '',
  out_lat REAL, out_lng REAL, out_place TEXT NOT NULL DEFAULT '',
  ip TEXT,
  auto_closed INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS attendance_user_date ON attendance(user_id, date);
CREATE TABLE IF NOT EXISTS leaves (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL DEFAULT 'annual',       -- annual | sick | casual | unpaid | missed_punch | other
  from_date TEXT NOT NULL,
  to_date TEXT NOT NULL,
  half_day INTEGER NOT NULL DEFAULT 0,
  data TEXT NOT NULL DEFAULT '{}',           -- missed punch: {"in":"09:00","out":"18:00"}
  reason TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',    -- pending | approved | rejected | cancelled
  reviewer_id INTEGER REFERENCES users(id),
  review_note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------- team chat ----------
CREATE TABLE IF NOT EXISTS channels (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  description TEXT NOT NULL DEFAULT '',
  private INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS channel_members (
  channel_id INTEGER NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (channel_id, user_id)
);
-- channel: 'c:<id>' team channel | 'dm:<low>:<high>' direct message | 'd:<dealId>' deal chat | 'j:<jobId>' job chat
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY,
  channel TEXT NOT NULL,
  user_id INTEGER NOT NULL REFERENCES users(id),
  body TEXT NOT NULL,
  parent_id INTEGER REFERENCES messages(id) ON DELETE CASCADE,
  edited_at TEXT,
  deleted INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS messages_channel ON messages(channel, id);
CREATE INDEX IF NOT EXISTS messages_parent ON messages(parent_id);
CREATE TABLE IF NOT EXISTS reactions (
  message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  emoji TEXT NOT NULL,
  PRIMARY KEY (message_id, user_id, emoji)
);
CREATE TABLE IF NOT EXISTS channel_reads (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  channel TEXT NOT NULL,
  last_read_id INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, channel)
);
CREATE TABLE IF NOT EXISTS chat_files (
  id INTEGER PRIMARY KEY,
  token TEXT NOT NULL UNIQUE,
  channel TEXT NOT NULL,
  message_id INTEGER REFERENCES messages(id) ON DELETE SET NULL,
  user_id INTEGER NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

// ---------- migrations for databases created by earlier versions ----------
function addColumn(table, column, definition) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  if (!cols.includes(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

if (!db.prepare("SELECT id FROM channels WHERE name = 'general'").get()) {
  db.prepare("INSERT INTO channels (name, description) VALUES ('general', 'Company-wide announcements and chat')").run();
  db.prepare("INSERT INTO channels (name, description) VALUES ('installations', 'Site updates, photos and questions from the installation team')").run();
}

const all = (sql, ...p) => db.prepare(sql).all(...p);
const get = (sql, ...p) => db.prepare(sql).get(...p);
const run = (sql, ...p) => db.prepare(sql).run(...p);
// Run several writes as one unit (all or nothing). Nested calls become savepoints.
let depth = 0;
function tx(fn) {
  const sp = `sp${depth}`;
  db.exec(depth ? `SAVEPOINT ${sp}` : 'BEGIN');
  depth++;
  try {
    const out = fn();
    depth--;
    db.exec(depth ? `RELEASE ${sp}` : 'COMMIT');
    return out;
  } catch (err) {
    depth--;
    db.exec(depth ? `ROLLBACK TO ${sp}; RELEASE ${sp}` : 'ROLLBACK');
    throw err;
  }
}

module.exports = { db, all, get, run, tx, addColumn, dataDir };
