// Demo data for showing the hub to Crystal Shield: realistic leads, deals at every stage, quotations,
// invoices, payments, purchases, stock, installations with sign-off, warranties, follow-ups, chat.
// Runs against a RUNNING server (it uses the real API, so every flow is exercised), then back-dates a few
// records directly in the database so the charts have history.
//   HUB=http://localhost:4200 ADMIN_EMAIL=… ADMIN_PASSWORD=… DATA_DIR=./data-dev node scripts/seed-demo.js
const zlib = require('node:zlib');
const path = require('node:path');
const fs = require('node:fs');

const HUB = (process.env.HUB || 'http://localhost:4200').replace(/\/$/, '');
const EMAIL = process.env.ADMIN_EMAIL || 'admin@crystalshield.ae';
const PASS = process.env.ADMIN_PASSWORD || 'CrystalDemo2026';
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, '..', 'data-dev'));
const DEMO_PASS = 'Demo2026!';

let cookie = '';
async function call(method, p, body, raw) {
  const res = await fetch(HUB + '/api' + p, {
    method, headers: { cookie, ...(raw ? raw.headers : body ? { 'Content-Type': 'application/json' } : {}) },
    body: raw ? raw.body : body ? JSON.stringify(body) : undefined,
  });
  const sc = res.headers.get('set-cookie');
  if (sc) cookie = sc.split(';')[0];
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${p} → ${res.status} ${data.error || ''}`);
  return data;
}
const get = (p) => call('GET', p);
const post = (p, b) => call('POST', p, b || {});
const patch = (p, b) => call('PATCH', p, b);
const put = (p, b) => call('PUT', p, b);
const uploadPng = (p, buf, name) => call('POST', p, null, { headers: { 'Content-Type': 'application/octet-stream', 'X-File-Name': encodeURIComponent(name), 'X-File-Type': 'image/png' }, body: buf });

// ---------- tiny PNG encoder (product swatches, site photos, signatures) ----------
const CRC = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(w, h, px) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; for (let x = 0; x < w; x++) { const [r, g, b] = px(x, y); const o = y * (w * 3 + 1) + 1 + x * 3; raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; } }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
// a pane of tinted glass with a highlight streak
function swatch(tint, shine = 0.35) {
  return png(240, 240, (x, y) => {
    const base = mix(tint, [255, 255, 255], 0.12 * (1 - y / 240));
    const streak = Math.abs(x - y * 0.6 - 60) < 26 ? shine : Math.abs(x - y * 0.6 - 120) < 8 ? shine * 0.6 : 0;
    const edge = x < 8 || y < 8 || x > 231 || y > 231 ? 0.55 : 0;
    return mix(mix(base, [255, 255, 255], streak), [40, 44, 52], edge);
  });
}
// a "site photo": window wall, sunny (before) or tinted (after)
function sitePhoto(after) {
  const sky = after ? [86, 120, 140] : [200, 225, 245];
  const sun = after ? [150, 160, 150] : [255, 236, 170];
  return png(480, 320, (x, y) => {
    const frame = x % 120 < 6 || y % 160 < 6 || y > 310;
    if (frame) return [235, 235, 232];
    const glow = Math.max(0, 1 - Math.hypot(x - 360, y - 70) / 160);
    const c = mix(mix(sky, [255, 255, 255], (1 - y / 320) * 0.3), sun, glow * (after ? 0.35 : 0.9));
    return y > 250 ? mix(c, after ? [70, 80, 75] : [190, 170, 120], 0.6) : c;
  });
}
// a scribbled signature
function signature() {
  const w = 420; const h = 140; const ink = new Set();
  let x = 30; let y = 80;
  for (let t = 0; t < 900; t++) {
    x += 0.4 + Math.sin(t / 9) * 1.6; y = 75 + Math.sin(t / 7) * 28 * Math.cos(t / 40) + Math.sin(t / 3) * 4;
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) ink.add(`${Math.round(x + dx)},${Math.round(y + dy)}`);
    if (x > w - 30) break;
  }
  return `data:image/png;base64,${png(w, h, (px, py) => (ink.has(`${px},${py}`) ? [20, 28, 47] : [255, 255, 255])).toString('base64')}`;
}

// ---------- dates ----------
const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Dubai' });
const day = (n) => { const d = new Date(today + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const ts = (n, hhmm = '10:00') => `${day(n)} ${hhmm}:00`;

(async () => {
  await post('/login', { email: EMAIL, password: PASS });
  const already = await get('/deals');
  if (already.deals.length) { console.log('The database already has deals — seed skipped.'); return; }
  console.log('Seeding demo data…');

  // ---------- company ----------
  await patch('/settings', {
    company: { trn: '', address: 'Mussafah Industrial Area, Abu Dhabi, UAE' },
    automation: { review_link: 'https://g.page/r/crystal-shield/review' },
  });

  // ---------- team ----------
  const { roles } = await get('/roles');
  const role = (s) => roles.find((r) => r.system === s).id;
  const off = await get('/offices');
  const officeId = off.offices.find((o) => !o.field).id; const fieldId = off.offices.find((o) => o.field).id;
  const officeShift = off.shifts[0].id; const fieldShift = off.shifts[1].id;
  const people = {};
  for (const [key, name, title, r, phone, field] of [
    ['manager', 'Rashid Khan', 'Sales Manager', 'manager', '+971 50 111 2233', 0],
    ['anjali', 'Anjali Menon', 'Sales Executive', 'sales', '+971 55 222 3344', 0],
    ['faisal', 'Faisal Ahmed', 'Sales Executive', 'sales', '+971 52 333 4455', 0],
    ['mary', 'Mary Joseph', 'Accountant', 'accounts', '+971 56 444 5566', 0],
    ['ramesh', 'Ramesh Kumar', 'Lead Installer', 'installer', '+971 50 555 6677', 1],
    ['suresh', 'Suresh Nair', 'Installation Technician', 'installer', '+971 55 666 7788', 1],
    ['imran', 'Imran Ali', 'Installation Technician', 'installer', '+971 52 777 8899', 1],
  ]) {
    const email = `${key}@crystalshield.ae`;
    const { user } = await post('/users', { name, title, email, phone, password: DEMO_PASS, role_id: role(r), office_id: field ? fieldId : officeId, shift_id: field ? fieldShift : officeShift });
    people[key] = user.id;
  }
  await patch('/settings', { automation: { lead_assign: 'round_robin', lead_assign_ids: `${people.anjali},${people.faisal}` } });

  // ---------- suppliers & products ----------
  const vendors = {};
  for (const [k, v] of Object.entries({
    madico: { name: 'Madico Middle East FZE', contact_person: 'Daniel Brooks', phone: '+971 4 880 1200', email: 'orders@madico-me.example', trn: '100234567800003', address: 'JAFZA, Dubai', notes: 'Main film supplier. 1.52 m × 30 m rolls. 2–3 days delivery.' },
    gulf: { name: 'Gulf Film Trading LLC', contact_person: 'Sameer', phone: '+971 6 543 2100', email: 'sales@gulffilm.example', address: 'Industrial Area 4, Sharjah', notes: 'Frosted & decorative films, fast delivery.' },
    tools: { name: 'Al Noor Building Materials', contact_person: 'Hussain', phone: '+971 2 555 9090', address: 'Mussafah M-12, Abu Dhabi', notes: 'Sealant, blades, squeegees, cleaning supplies.' },
  })) vendors[k] = (await post('/vendors', v)).vendor.id;

  const P = {};
  const products = [
    ['s35', { code: 'FLM-S35', name: 'Solar Control Film · Smoke 35%', category: 'solar', brand: 'Madico', vlt: 35, heat_rejection: 60, uv_block: 99, thickness: '2 mil', warranty_years: 5, sell_price: 160, cost_price: 95, min_stock: 150, opening_stock: 412.6, description: 'Neutral smoke tint. Up to 60% heat rejection and 99% UV block — ideal for sun-facing living rooms and offices.' }, [70, 76, 84]],
    ['sr20', { code: 'FLM-SR20', name: 'Solar Control Film · Silver Reflective 20%', category: 'solar', brand: 'Madico', vlt: 20, heat_rejection: 78, uv_block: 99, thickness: '2 mil', warranty_years: 5, sell_price: 185, cost_price: 110, min_stock: 100, opening_stock: 236, description: 'Mirror-look reflective film for maximum heat rejection and daytime privacy on west façades.' }, [150, 160, 170]],
    ['sx70', { code: 'FLM-SX70', name: 'Spectrally Selective Clear 70', category: 'solar', brand: 'Madico', vlt: 70, heat_rejection: 55, uv_block: 99, thickness: '2 mil', warranty_years: 10, sell_price: 240, cost_price: 150, min_stock: 80, opening_stock: 64, description: 'Almost invisible film that blocks heat without darkening — keeps the view and daylight.' }, [170, 200, 205]],
    ['sc8', { code: 'FLM-SC8', name: 'Safety & Security Film · 8 mil Clear', category: 'safety', brand: 'Madico', uv_block: 99, thickness: '8 mil', warranty_years: 10, sell_price: 238, cost_price: 140, min_stock: 60, opening_stock: 180, description: 'Holds shattered glass in place on impact or break-in. For schools, clinics, entrances and glass doors.' }, [205, 215, 220]],
    ['sc4', { code: 'FLM-SC4', name: 'Safety Film · 4 mil Clear', category: 'safety', brand: 'Madico', uv_block: 99, thickness: '4 mil', warranty_years: 7, sell_price: 170, cost_price: 95, min_stock: 40, opening_stock: 95, description: 'Entry-level safety film for shower screens, partitions and furniture glass.' }, [215, 222, 226]],
    ['bm15', { code: 'FLM-BM15', name: 'Blast Mitigation Film · 15 mil', category: 'blast', brand: 'Madico', uv_block: 99, thickness: '15 mil', warranty_years: 10, sell_price: 420, cost_price: 260, min_stock: 30, opening_stock: 74, description: 'High-security film that reduces glass fragmentation from blast pressure. Used with wet-glaze or mechanical attachment.' }, [190, 200, 215]],
    ['fr', { code: 'FLM-FR01', name: 'Frosted Privacy Film · White Matte', category: 'privacy', brand: 'Gulf Film', warranty_years: 3, sell_price: 140, cost_price: 70, min_stock: 40, opening_stock: 120, description: 'Sandblasted look for meeting rooms, bathrooms and office partitions.' }, [232, 234, 236]],
    ['sp', { code: 'FLM-SP01', name: 'Surface Protection Film · Clear Gloss', category: 'surface', brand: 'Madico', warranty_years: 3, sell_price: 120, cost_price: 65, min_stock: 30, opening_stock: 22, description: 'Protects marble, lacquer and stainless steel from scratches and stains.' }, [240, 238, 230]],
    ['rm', { code: 'SRV-RM', name: 'Old film removal & glass cleaning', category: 'service', unit: 'SQM', sell_price: 25, cost_price: 0, track_stock: false, description: 'Removal of old / bubbled film and adhesive, glass deep-cleaned before new film.' }, null],
    ['seal', { code: 'MAT-ES', name: 'Edge sealant (cartridge)', category: 'material', unit: 'Pcs', sell_price: 0, cost_price: 18, min_stock: 10, opening_stock: 36, description: 'Clear silicone edge seal for safety and blast films.' }, null],
  ];
  for (const [k, p, tint] of products) {
    const { product } = await post('/products', p);
    P[k] = product;
    if (tint) {
      const { file } = await uploadPng(`/files?entity=product&id=${product.id}&kind=image`, swatch(tint), `${p.code}.png`);
      await patch(`/products/${product.id}`, { image_file_id: file.id });
    }
  }
  const spec = (p) => [p.vlt && `VLT ${p.vlt}%`, p.heat_rejection && `Heat rejection up to ${p.heat_rejection}%`, p.uv_block && `UV block ${p.uv_block}%`, p.thickness, p.warranty_years && `${p.warranty_years}-year warranty`].filter(Boolean).join(' · ');
  const line = (k, qty, desc, vendor = 'madico', priceOverride) => ({ product_id: P[k].id, name: P[k].name, description: [spec(P[k]), desc].filter(Boolean).join('\n'), qty, unit: P[k].unit, price: priceOverride ?? P[k].sell_price, cost: P[k].cost_price, vendor_id: vendor ? vendors[vendor] : null });

  // ---------- leads: website form & ads (round robin), WhatsApp, calls ----------
  const { lead_webhook: hook } = await get('/settings');
  const web = async (b) => (await (await fetch(hook.url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) })).json());
  const leadIds = [];
  const leadData = [
    { name: 'Khalid Rahman', company: 'Al Noor Towers LLC', phone: '+971 50 214 7781', email: 'khalid.r@alnoortowers.example', source: 'Meta Ads', utm_campaign: 'Commercial heat — Sep', service: 'Solar control film', property_type: 'Commercial tower', area: 'Al Reem Island', city: 'Abu Dhabi', message: 'Lobby and entrance glazing gets very hot after 2 pm. Need heat control + safety film on entrance doors.' },
    { name: 'Rashid Al Mansoori', phone: '+971 55 610 3302', source: 'WhatsApp', service: 'Solar control film', property_type: 'Villa', area: 'Khalifa City A', city: 'Abu Dhabi', message: 'Villa living room and bedrooms facing west. Want darker film for privacy too.' },
    { name: 'Laila Haddad', company: 'Palm View Villas', phone: '+971 2 678 4410', email: 'facilities@palmview.example', source: 'Website', service: 'Solar control film', property_type: 'Villa', area: 'Saadiyat Island', city: 'Abu Dhabi', message: 'Community of 6 show villas — need a quote for clear heat-control film that does not change the look.' },
    { name: 'Fatima Hassan', phone: '+971 52 448 9015', source: 'Instagram', service: 'Privacy / frosted film', property_type: 'Apartment', area: 'Al Raha Beach', city: 'Abu Dhabi', message: 'Bathroom window and balcony glass, need privacy.' },
    { name: 'Omar Siddiqui', company: 'Gulf Star Motors', phone: '+971 50 903 1145', email: 'omar@gulfstarmotors.example', source: 'Google Ads', utm_source: 'google', service: 'Solar control film', property_type: 'Showroom', area: 'Mussafah', city: 'Abu Dhabi', message: 'Showroom front glass 40 m long, cars are fading. Also office glass partitions.' },
    { name: 'Sara Williams', company: 'Horizon Office Park', phone: '+971 56 117 2290', source: 'Referral', service: 'Safety & security film', property_type: 'Office', area: 'Al Maryah Island', city: 'Abu Dhabi', message: 'Referred by Al Noor Towers. Ground floor offices need safety film.' },
    { name: 'Mohammed Al Hammadi', phone: '+971 50 772 5521', source: 'Meta Ads', utm_campaign: 'Villa summer heat', service: 'Solar control film', property_type: 'Villa', area: 'Al Shamkha', city: 'Abu Dhabi', message: 'Full villa — 2 floors.' },
    { name: 'Dr. Nadia Karim', company: 'Sea Breeze Medical Clinic', phone: '+971 2 641 0098', source: 'Website', service: 'Privacy / frosted film', property_type: 'Hospital / clinic', area: 'Corniche', city: 'Abu Dhabi', message: 'Consultation room partitions — frosted with logo strip.' },
    { name: 'Ahmed Al Kaabi', company: 'Emirates Science School', phone: '+971 2 555 3311', email: 'admin@ess.example', source: 'Phone call', service: 'Safety & security film', property_type: 'School', area: 'Mohammed Bin Zayed City', city: 'Abu Dhabi', message: 'Safety film for classroom windows before term starts.' },
    { name: 'Priya Sharma', phone: '+971 54 309 8877', source: 'Meta Ads', service: 'Solar control film', property_type: 'Apartment', area: 'Al Reem Island', city: 'Abu Dhabi', message: 'Two bedroom apartment, west facing.' },
    { name: 'John Mathews', phone: '+971 55 801 2234', source: 'Meta Ads', service: 'Solar control film', property_type: 'Villa', area: 'Yas Island', city: 'Abu Dhabi', message: 'How much per meter?' },
    { name: 'Hessa Al Dhaheri', phone: '+971 50 190 4321', source: 'Instagram', service: 'Decorative film', property_type: 'Villa', area: 'Al Bateen', city: 'Abu Dhabi', message: 'Decorative film for the majlis glass door.' },
    { name: 'Vikram Patel', company: 'VP Logistics', phone: '+971 52 667 1188', source: 'Google Ads', utm_source: 'google', service: 'Solar control film', property_type: 'Warehouse / industrial', area: 'KEZAD', city: 'Abu Dhabi', message: 'Office block windows in warehouse, approx 120 sqm.' },
    { name: 'Aisha Noor', phone: '+971 56 222 8890', source: 'WhatsApp', service: 'Solar control film', property_type: 'Apartment', area: 'Al Khalidiyah', city: 'Abu Dhabi', message: 'Price for 3 windows?' },
    { name: 'Thomas Becker', company: 'Becker Interiors', phone: '+971 50 448 0912', source: 'LinkedIn', service: 'Surface protection film', property_type: 'Showroom', area: 'Al Wahda', city: 'Abu Dhabi', message: 'Protect new marble counters in a showroom during fit-out.' },
    { name: 'Mariam Al Suwaidi', phone: '+971 55 331 7765', source: 'Meta Ads', service: 'Solar control film', property_type: 'Villa', area: 'Mohammed Bin Zayed City', city: 'Abu Dhabi', message: 'Kids room very hot.' },
    { name: 'Ravi Shankar', phone: '+971 52 118 6650', source: 'Meta Ads', service: 'Solar control film', property_type: 'Apartment', area: 'Al Reef', city: 'Abu Dhabi', message: '' },
    { name: 'Noura Al Ali', company: 'Capital Heights Hotel', phone: '+971 2 699 1200', source: 'Website', service: 'Solar control film', property_type: 'Hotel', area: 'Corniche', city: 'Abu Dhabi', message: 'Lobby atrium glass — need site visit.' },
    { name: 'Saeed Al Marri', phone: '+971 50 663 2201', source: 'TikTok', service: 'Solar control film', property_type: 'Villa', area: 'Al Falah', city: 'Abu Dhabi', message: 'Saw your video, interested.' },
    { name: 'Grace Okafor', phone: '+971 54 776 1192', source: 'Meta Ads', service: 'Privacy / frosted film', property_type: 'Office', area: 'Al Zahiyah', city: 'Abu Dhabi', message: 'Meeting room glass frosting.' },
  ];
  for (const b of leadData) {
    const r = await web({ ...b, campaign: b.utm_campaign });
    leadIds.push(r.id);
  }
  const L = (i) => leadIds[i];

  // ---------- helper: lead → deal with measurements & pricing ----------
  const owner = async (leadId) => (await get(`/leads/${leadId}`)).lead.owner_id;
  async function toDeal(i, { stage = 'site_visit', title, address } = {}) {
    await post(`/leads/${L(i)}/notes`, { kind: 'call', body: 'Called — confirmed requirement, booked a site visit.' });
    await patch(`/leads/${L(i)}`, { status: 'qualified' });
    const r = await post(`/leads/${L(i)}/convert`, { stage, title, contact_type: leadData[i].company ? 'business' : 'individual' });
    if (address) await patch(`/deals/${r.deal_id}`, { address, location_url: '' });
    return r;
  }
  const measure = (dealId, rows, unit = 'cm') => post(`/deals/${dealId}/measurements`, { unit, rows });

  // 1) Al Noor Towers — won, advance paid, installed & signed off, balance invoiced (part paid)
  const d1 = await toDeal(0, { title: 'Al Noor Towers — lobby & entrance glazing', address: 'Al Noor Towers, Tower B lobby' });
  await measure(d1.deal_id, [
    { location: 'Lobby – south façade', length: 320, width: 280, qty: 6 },
    { location: 'Lobby – west façade', length: 300, width: 250, qty: 4 },
    { location: 'Mezzanine glazing', length: 250, width: 180, qty: 4 },
    { location: 'Entrance doors', length: 240, width: 110, qty: 4 },
    { location: 'Entrance side lights', length: 240, width: 140, qty: 4 },
  ]);
  await put(`/deals/${d1.deal_id}/items`, { items: [
    { kind: 'header', name: 'Lobby glazing — heat control' }, line('s35', 80.8, 'Lobby south & west façades, mezzanine'),
    { kind: 'header', name: 'Entrance — safety' }, line('sc8', 24, 'Entrance doors and side lights. Edges sealed.'),
    line('rm', 24, 'Remove old film on entrance glass', null),
  ] });
  const q1 = (await post('/quotes', { deal_id: d1.deal_id })).quote;
  await post(`/quotes/${q1.id}/status`, { status: 'sent' });
  await post(`/quotes/${q1.id}/status`, { status: 'accepted', name: 'Khalid Rahman' });
  const inv1a = (await post(`/quotes/${q1.id}/invoice`, { kind: 'advance', percent: 50 })).invoice;
  await post(`/invoices/${inv1a.id}/issue`);
  const inv1aFull = (await get(`/invoices/${inv1a.id}`)).invoice;
  await post(`/invoices/${inv1a.id}/payments`, { amount: inv1aFull.total, date: day(-14), method: 'bank', reference: 'FT-ENBD-88213' });
  const pos1 = (await post(`/deals/${d1.deal_id}/purchase-orders`, {})).pos;
  for (const po of pos1) {
    await post(`/purchase-orders/${po.id}/status`, { status: 'sent' });
    const full = await get(`/purchase-orders/${po.id}`);
    await post(`/purchase-orders/${po.id}/receive`, { date: day(-12), vendor_ref: 'MME-INV-55120', lines: full.items.map((it) => ({ po_item_id: it.id, qty: it.qty, cost: it.cost })) });
    await post(`/purchase-orders/${po.id}/payments`, { amount: (await get(`/purchase-orders/${po.id}`)).po.balance, date: day(-6), method: 'bank', reference: 'Supplier transfer' });
  }
  const j1 = (await post('/jobs', { deal_id: d1.deal_id, date: day(-10), end_date: day(-9), start_time: '08:00', end_time: '17:00', installer_ids: [people.ramesh, people.suresh, people.imran], lead_installer_id: people.ramesh, instructions: 'Security pass at Tower B reception. Work after 7 pm on entrance doors (mall traffic). Use scaffolding for mezzanine.' })).job;
  for (const [k, after] of [['before', false], ['after', true]]) for (let n = 1; n <= 2; n++) await uploadPng(`/files?entity=job&id=${j1.id}&kind=${k}`, sitePhoto(after), `${k}-lobby-${n}.png`);
  await post(`/jobs/${j1.id}/status`, { status: 'in_progress', lat: 24.4989, lng: 54.4058 });
  const jd1 = await get(`/jobs/${j1.id}`);
  for (let i = 0; i < jd1.job.checklist.length; i++) await patch(`/jobs/${j1.id}/checklist`, { index: i, done: true });
  await put(`/jobs/${j1.id}/materials`, { materials: jd1.materials.map((m) => ({ id: m.id, used_qty: Math.round(m.planned_qty * 0.97 * 10) / 10 })) });
  await post(`/jobs/${j1.id}/status`, { status: 'completed' });
  await post(`/jobs/${j1.id}/signoff`, { name: 'Khalid Rahman', rating: 5, feedback: 'Very clean work, lobby is noticeably cooler.', signature: signature() });
  const inv1b = (await post(`/quotes/${q1.id}/invoice`, { kind: 'standard' })).invoice;
  await post(`/invoices/${inv1b.id}/issue`);
  await post(`/invoices/${inv1b.id}/payments`, { amount: 5000, date: day(-2), method: 'cheque', reference: 'CHQ 004512' });
  await post('/expenses', { date: day(-10), account_id: (await get('/accounts')).expense_categories.find((c) => /labour/i.test(c.name)).id, amount: 2400, deal_id: d1.deal_id, method: 'cash', payee: 'Night shift labour (3 men × 2 nights)', description: 'Installation labour — Al Noor Towers' });
  await post('/expenses', { date: day(-10), account_id: (await get('/accounts')).expense_categories.find((c) => /transport/i.test(c.name)).id, amount: 350, vat: 17.5, deal_id: d1.deal_id, method: 'card', payee: 'Careem / van fuel', description: 'Site transport — Al Reem' });

  // 2) Rashid Al Mansoori villa — won, advance paid, installation tomorrow
  const d2 = await toDeal(1, { title: 'Villa Khalifa City A — living & bedrooms', address: 'Villa 23, Street 14' });
  await measure(d2.deal_id, [
    { location: 'Living room – west', length: 260, width: 220, qty: 3, product_id: P.sr20.id },
    { location: 'Master bedroom', length: 200, width: 160, qty: 2, product_id: P.s35.id },
    { location: 'Kids bedroom', length: 180, width: 150, qty: 2, product_id: P.s35.id },
    { location: 'Staircase window', length: 300, width: 120, qty: 1, product_id: P.s35.id },
  ]);
  await put(`/deals/${d2.deal_id}/items`, { items: [line('sr20', 17.16, 'Living room west windows'), line('s35', 14.6, 'Bedrooms and staircase')] });
  const q2 = (await post('/quotes', { deal_id: d2.deal_id })).quote;
  await post(`/quotes/${q2.id}/status`, { status: 'sent' });
  await post(`/quotes/${q2.id}/status`, { status: 'accepted', name: 'Rashid Al Mansoori' });
  const inv2 = (await post(`/quotes/${q2.id}/invoice`, { kind: 'advance', percent: 50 })).invoice;
  await post(`/invoices/${inv2.id}/issue`);
  await post(`/invoices/${inv2.id}/payments`, { amount: (await get(`/invoices/${inv2.id}`)).invoice.total, date: day(-3), method: 'card', reference: 'POS 7781' });
  await post('/jobs', { deal_id: d2.deal_id, date: day(1), start_time: '09:00', end_time: '14:00', installer_ids: [people.suresh, people.imran], lead_installer_id: people.suresh, instructions: 'Family at home — call Mr Rashid 30 min before. Park in front of the villa, not on the sidewalk.' });

  // 3) Palm View Villas — quotation sent, customer opened it, negotiating
  const d3 = await toDeal(2, { title: 'Palm View Villas — 6 show villas, clear heat control', address: 'Palm View community, Saadiyat' });
  await measure(d3.deal_id, Array.from({ length: 6 }, (_, i) => ({ location: `Show villa ${i + 1} – living & dining`, length: 280, width: 240, qty: 4 })));
  await put(`/deals/${d3.deal_id}/items`, { items: [line('sx70', 161.28, 'Living & dining glass, 6 villas — invisible heat control')] });
  const q3 = (await post('/quotes', { deal_id: d3.deal_id })).quote;
  await post(`/quotes/${q3.id}/status`, { status: 'sent' });
  await patch(`/deals/${d3.deal_id}`, { stage: 'negotiation', next_follow_up: day(0) });
  await post(`/deals/${d3.deal_id}/notes`, { kind: 'call', body: 'Laila asked if we can do 220/SQM for the full community (42 villas) — checking with Rashid.' });

  // 4) Fatima Hassan — measured, priced, no quotation yet
  const d4 = await toDeal(3, { title: 'Al Raha apartment — bathroom & balcony privacy' });
  await measure(d4.deal_id, [{ location: 'Bathroom window', length: 120, width: 90, qty: 1, product_id: P.fr.id }, { location: 'Balcony sliding door', length: 230, width: 180, qty: 2, product_id: P.fr.id }]);
  await put(`/deals/${d4.deal_id}/items`, { items: [line('fr', 9.36, 'Bathroom window, balcony sliding doors', 'gulf')] });

  // 5) Gulf Star Motors — site visit booked
  const d5 = await toDeal(4, { stage: 'site_visit', title: 'Gulf Star Motors — showroom front & offices' });
  await post('/activities', { type: 'site_visit', deal_id: d5.deal_id, date: day(0), start_time: '15:00', end_time: '16:00', assigned_to: await owner(L(4)), notes: 'Bring film samples (S35, SR20, SX70) and the IR heat lamp demo.' });
  // 6) Horizon Office Park — new deal, call scheduled
  const d6 = await toDeal(5, { stage: 'new', title: 'Horizon Office Park — ground floor safety film' });
  await post('/activities', { type: 'call', deal_id: d6.deal_id, date: day(0), start_time: '11:30', assigned_to: await owner(L(5)), notes: 'Confirm number of offices and access hours.' });

  // 7) Mohammed Al Hammadi — installation in progress today
  const d7 = await toDeal(6, { title: 'Villa Al Shamkha — full villa solar film' });
  await measure(d7.deal_id, [{ location: 'Ground floor', length: 240, width: 200, qty: 10, product_id: P.s35.id }, { location: 'First floor', length: 200, width: 160, qty: 8, product_id: P.s35.id }]);
  await put(`/deals/${d7.deal_id}/items`, { items: [line('s35', 73.6, 'All windows, ground and first floor', 'madico', 150), line('rm', 12, 'Remove old film in majlis', null)] });
  const q7 = (await post('/quotes', { deal_id: d7.deal_id })).quote;
  await post(`/quotes/${q7.id}/status`, { status: 'sent' });
  await post(`/quotes/${q7.id}/status`, { status: 'accepted', name: 'Mohammed Al Hammadi' });
  const inv7 = (await post(`/quotes/${q7.id}/invoice`, { kind: 'advance', percent: 50 })).invoice;
  await post(`/invoices/${inv7.id}/issue`);
  await post(`/invoices/${inv7.id}/payments`, { amount: (await get(`/invoices/${inv7.id}`)).invoice.total, date: day(-1), method: 'bank', reference: 'FT-ADCB-11902' });
  const j7 = (await post('/jobs', { deal_id: d7.deal_id, date: day(0), start_time: '08:00', end_time: '17:00', installer_ids: [people.ramesh], lead_installer_id: people.ramesh, instructions: 'Start with the majlis (old film removal), then ground floor.' })).job;
  await uploadPng(`/files?entity=job&id=${j7.id}&kind=before`, sitePhoto(false), 'before-majlis.png');
  await post(`/jobs/${j7.id}/status`, { status: 'on_the_way' });
  await post(`/jobs/${j7.id}/status`, { status: 'in_progress', lat: 24.5502, lng: 54.7101 });
  await patch(`/jobs/${j7.id}/checklist`, { index: 0, done: true });

  // 8) Sea Breeze Clinic — lost on price
  const d8 = await toDeal(7, { title: 'Sea Breeze Clinic — consultation room frosting' });
  await measure(d8.deal_id, [{ location: 'Consultation rooms', length: 210, width: 100, qty: 6, product_id: P.fr.id }]);
  await put(`/deals/${d8.deal_id}/items`, { items: [line('fr', 12.6, '6 partitions with 30 cm clear strip', 'gulf')] });
  const q8 = (await post('/quotes', { deal_id: d8.deal_id })).quote;
  await post(`/quotes/${q8.id}/status`, { status: 'sent' });
  await post(`/quotes/${q8.id}/status`, { status: 'rejected', reason: 'Price too high' });
  await patch(`/deals/${d8.deal_id}`, { stage: 'lost', lost_reason: 'Price too high' });

  // 9) Emirates Science School — accepted, full invoice issued, overdue
  const d9 = await toDeal(8, { title: 'Emirates Science School — classroom safety film' });
  await measure(d9.deal_id, [{ location: 'Classrooms block A', length: 150, width: 120, qty: 24, product_id: P.sc4.id }]);
  await put(`/deals/${d9.deal_id}/items`, { items: [line('sc4', 43.2, '24 classroom windows, block A')] });
  const q9 = (await post('/quotes', { deal_id: d9.deal_id })).quote;
  await post(`/quotes/${q9.id}/status`, { status: 'sent' });
  await post(`/quotes/${q9.id}/status`, { status: 'accepted', name: 'Ahmed Al Kaabi' });
  const inv9 = (await post(`/quotes/${q9.id}/invoice`, { kind: 'standard' })).invoice;
  await post(`/invoices/${inv9.id}/issue`);
  const j9 = (await post('/jobs', { deal_id: d9.deal_id, date: day(-20), start_time: '07:00', installer_ids: [people.suresh, people.imran], lead_installer_id: people.suresh })).job;
  await uploadPng(`/files?entity=job&id=${j9.id}&kind=after`, sitePhoto(true), 'after-classroom.png');
  await post(`/jobs/${j9.id}/status`, { status: 'in_progress' });
  await post(`/jobs/${j9.id}/status`, { status: 'completed' });
  await post(`/jobs/${j9.id}/signoff`, { name: 'Ahmed Al Kaabi', rating: 4, feedback: 'Good job, finished before term.', signature: signature() });

  // a stock purchase and a few overheads
  const stockPo = (await post('/purchase-orders', { vendor_id: vendors.madico, notes: 'Stock top-up' })).po;
  await put(`/purchase-orders/${stockPo.id}`, { items: [{ product_id: P.sx70.id, name: P.sx70.name, qty: 91.2, unit: 'SQM', cost: 150 }, { product_id: P.sp.id, name: P.sp.name, qty: 45.6, unit: 'SQM', cost: 65 }] });
  await post(`/purchase-orders/${stockPo.id}/status`, { status: 'sent' });
  const cats = (await get('/accounts')).expense_categories;
  const cat = (re) => cats.find((c) => re.test(c.name)).id;
  for (const e of [
    { date: day(-16), account_id: cat(/rent/i), amount: 6500, method: 'bank', payee: 'Mussafah warehouse landlord', description: 'Warehouse rent — October' },
    { date: day(-5), account_id: cat(/advert/i), amount: 2500, vat: 125, method: 'card', payee: 'Meta Platforms', description: 'Meta Ads campaign — October' },
    { date: day(-3), account_id: cat(/transport/i), amount: 420, vat: 21, method: 'card', payee: 'ADNOC', description: 'Van fuel — week 2' },
    { date: day(-8), account_id: cat(/small tools/i), amount: 380, vat: 19, method: 'cash', vendor_id: vendors.tools, description: 'Blades, squeegees, spray bottles' },
  ]) await post('/expenses', e);

  // leads: a few followed up, one unqualified
  for (const i of [9, 10, 13]) await post(`/leads/${L(i)}/notes`, { kind: 'whatsapp', body: 'Sent price range and asked for window sizes / photos.', next_follow_up: day(1) });
  await patch(`/leads/${L(16)}`, { status: 'unqualified', lost_reason: 'No response' });
  await post('/activities', { type: 'site_visit', lead_id: L(17), date: day(2), start_time: '10:00', assigned_to: await owner(L(17)), title: 'Site visit · Capital Heights Hotel lobby' });
  await post('/activities', { type: 'meeting', date: day(3), start_time: '16:00', assigned_to: people.manager, title: 'Madico rep visit — new spectrally selective range' });

  // team chat
  await post('/messages/c:1', { body: 'Welcome to Crystal Shield Hub 👋 Leads, quotations, installations and invoices are all here now. Installers: open your jobs from the phone app every morning.' });
  await post('/messages/c:2', { body: 'Reminder: before/after photos and the customer sign-off on every job — the warranty card is created from it.' });

  // ---------- history: back-date records directly so charts and ageing look real ----------
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(path.join(DATA_DIR, 'hub.db'));
  db.exec('PRAGMA busy_timeout = 5000');
  const runQ = (sql, ...p) => db.prepare(sql).run(...p);
  const leadAges = [26, 9, 21, 12, 7, 5, 6, 30, 38, 2, 1, 3, 4, 0, 8, 0, 11, 1, 0, 2];
  leadIds.forEach((id, i) => runQ('UPDATE leads SET created_at = ?, updated_at = ?, status_changed_at = ? WHERE id = ?', ts(-leadAges[i], '09:30'), ts(-leadAges[i], '11:00'), ts(-leadAges[i], '11:00'), id));
  const dealAge = { [d1.deal_id]: 24, [d2.deal_id]: 8, [d3.deal_id]: 19, [d4.deal_id]: 10, [d5.deal_id]: 6, [d6.deal_id]: 4, [d7.deal_id]: 5, [d8.deal_id]: 28, [d9.deal_id]: 36 };
  for (const [id, a] of Object.entries(dealAge)) runQ(`UPDATE deals SET created_at = ?, updated_at = ?, stage_changed_at = ?, won_at = CASE WHEN won_at IS NOT NULL THEN ? END, lost_at = CASE WHEN lost_at IS NOT NULL THEN ? END WHERE id = ?`,
    ts(-a), ts(-Math.max(0, a - 3)), ts(-Math.max(0, a - 3)), ts(-Math.max(0, a - 6)), ts(-Math.max(0, a - 6)), Number(id));
  const backDoc = (table, id, date, due) => {
    if (table === 'quotes') runQ(`UPDATE quotes SET date = ?, valid_until = ?, sent_at = ?, created_at = ? WHERE id = ?`, date, due, `${date} 12:00:00`, `${date} 11:00:00`, id);
    if (table === 'invoices') {
      runQ(`UPDATE invoices SET date = ?, due_date = ?, issued_at = ?, created_at = ? WHERE id = ?`, date, due, `${date} 12:00:00`, `${date} 11:00:00`, id);
      runQ(`UPDATE journals SET date = ? WHERE source IN ('invoice','stock_invoice') AND source_id = ?`, date, id);
    }
  };
  backDoc('quotes', q1.id, day(-20), day(-5)); backDoc('quotes', q2.id, day(-6), day(9)); backDoc('quotes', q3.id, day(-15), day(5));
  backDoc('quotes', q7.id, day(-4), day(11)); backDoc('quotes', q8.id, day(-26), day(-11)); backDoc('quotes', q9.id, day(-34), day(-19));
  backDoc('invoices', inv1a.id, day(-16), day(-9)); backDoc('invoices', inv1b.id, day(-8), day(-1)); backDoc('invoices', inv2.id, day(-4), day(3));
  backDoc('invoices', inv7.id, day(-2), day(5)); backDoc('invoices', inv9.id, day(-28), day(-21));
  runQ(`UPDATE quotes SET viewed_at = ? WHERE id = ?`, ts(-14, '20:15'), q3.id);
  runQ(`UPDATE quotes SET accepted_at = ? WHERE id IN (?, ?)`, ts(-17), q1.id, q9.id);
  // Al Noor & school installations were signed off earlier
  for (const [jobId, d] of [[j1.id, -9], [j9.id, -20]]) {
    runQ(`UPDATE jobs SET started_at = ?, completed_at = ?, signed_at = ? WHERE id = ?`, ts(d, '08:10'), ts(d, '17:30'), ts(d, '17:45'), jobId);
    runQ(`UPDATE stock_moves SET date = ? WHERE ref_type = 'job' AND ref_id = ?`, day(d), jobId);
    runQ(`UPDATE journals SET date = ? WHERE source = 'stock_job' AND source_id = ?`, day(d), jobId);
    for (const w of db.prepare('SELECT * FROM warranties WHERE job_id = ?').all(jobId)) {
      const end = new Date(day(d) + 'T00:00:00Z'); end.setUTCFullYear(end.getUTCFullYear() + w.years); end.setUTCDate(end.getUTCDate() - 1);
      runQ('UPDATE warranties SET start_date = ?, end_date = ? WHERE id = ?', day(d), end.toISOString().slice(0, 10), w.id);
    }
    for (const f of db.prepare(`SELECT * FROM followups WHERE job_id = ? AND type IN ('review','check_in','inspection')`).all(jobId)) {
      const shift = new Date(f.due_date + 'T00:00:00Z'); shift.setUTCDate(shift.getUTCDate() + d);
      runQ('UPDATE followups SET due_date = ? WHERE id = ?', shift.toISOString().slice(0, 10), f.id);
    }
  }
  runQ(`UPDATE followups SET status = 'done', done_at = ?, outcome = 'Left a 5★ Google review' WHERE job_id = ? AND type = 'review'`, ts(-7), j9.id);
  // last month's sales, so "this month vs last month" has something to compare
  const sepFirst = (() => { const d = new Date(today.slice(0, 7) + '-01T00:00:00Z'); d.setUTCMonth(d.getUTCMonth() - 1); return d.toISOString().slice(0, 10); })();
  const addDaysTo = (d, n) => { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
  // attendance today for the field team and office
  const nowIso = (h, m) => new Date(`${today}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00+04:00`).toISOString();
  db.prepare('INSERT INTO attendance (user_id, date, clock_in, in_lat, in_lng, in_place) VALUES (?, ?, ?, ?, ?, ?)').run(people.ramesh, today, nowIso(7, 52), 24.5502, 54.7101, 'Villa Al Shamkha');
  db.prepare('INSERT INTO attendance (user_id, date, clock_in, in_place) VALUES (?, ?, ?, ?)').run(people.anjali, today, nowIso(9, 4), 'Abu Dhabi office');
  db.prepare('INSERT INTO attendance (user_id, date, clock_in, in_place) VALUES (?, ?, ?, ?)').run(people.faisal, today, nowIso(9, 26), 'Abu Dhabi office');
  db.prepare('INSERT INTO attendance (user_id, date, clock_in, in_place) VALUES (?, ?, ?, ?)').run(people.mary, today, nowIso(8, 55), 'Abu Dhabi office');
  db.close();

  // previous month: two small jobs invoiced and paid (through the API, then dated)
  for (const [i, k, sqm, d0] of [[11, 'fr', 6.5, 6], [14, 'sp', 18, 18]]) {
    const r = await toDeal(i, { title: `${leadData[i].name} — ${leadData[i].service}` });
    await put(`/deals/${r.deal_id}/items`, { items: [line(k, sqm, leadData[i].message, k === 'fr' ? 'gulf' : 'madico')] });
    const q = (await post('/quotes', { deal_id: r.deal_id })).quote;
    await post(`/quotes/${q.id}/status`, { status: 'sent' });
    await post(`/quotes/${q.id}/status`, { status: 'accepted', name: leadData[i].name });
    const inv = (await post(`/quotes/${q.id}/invoice`, { kind: 'standard' })).invoice;
    await post(`/invoices/${inv.id}/issue`);
    const date = addDaysTo(sepFirst, d0);
    await post(`/invoices/${inv.id}/payments`, { amount: (await get(`/invoices/${inv.id}`)).invoice.total, date: addDaysTo(date, 2), method: 'cash' });
    const db2 = new DatabaseSync(path.join(DATA_DIR, 'hub.db'));
    db2.prepare(`UPDATE invoices SET date = ?, due_date = ?, issued_at = ? WHERE id = ?`).run(date, addDaysTo(date, 7), `${date} 12:00:00`, inv.id);
    db2.prepare(`UPDATE journals SET date = ? WHERE source IN ('invoice','stock_invoice') AND source_id = ?`).run(date, inv.id);
    db2.prepare(`UPDATE stock_moves SET date = ? WHERE ref_type = 'invoice' AND ref_id = ?`).run(date, inv.id);
    db2.prepare(`UPDATE deals SET won_at = ?, created_at = ?, stage_changed_at = ? WHERE id = ?`).run(`${date} 10:00:00`, `${addDaysTo(date, -5)} 10:00:00`, `${date} 10:00:00`, r.deal_id);
    db2.prepare(`UPDATE quotes SET date = ?, valid_until = ?, sent_at = ? WHERE id = ?`).run(addDaysTo(date, -3), addDaysTo(date, 12), `${addDaysTo(date, -3)} 10:00:00`, q.id);
    db2.prepare(`UPDATE leads SET created_at = ? WHERE id = ?`).run(`${addDaysTo(date, -8)} 10:00:00`, L(i));
    db2.close();
  }

  const lines = [`Crystal Shield Hub — demo logins (password for all: ${DEMO_PASS})`, '',
    `Admin            ${EMAIL} (your admin password)`, 'Sales Manager    manager@crystalshield.ae', 'Sales Executive  anjali@crystalshield.ae', 'Sales Executive  faisal@crystalshield.ae',
    'Accounts         mary@crystalshield.ae', 'Installer        ramesh@crystalshield.ae', 'Installer        suresh@crystalshield.ae', 'Installer        imran@crystalshield.ae', ''];
  fs.writeFileSync(path.join(DATA_DIR, 'DEMO_LOGINS.txt'), lines.join('\n'));
  console.log(lines.join('\n'));
  console.log('Done.');
})().catch((err) => { console.error(err); process.exit(1); });
