# Crystal Shield Hub

CRM + operations + books for **Crystal Shield Tint Insulation LLC** (architectural window film, Abu Dhabi).
One system for the whole job: lead → site visit → measurement → pricing → quotation → advance invoice → purchase order →
installation → customer sign-off → final invoice → warranty & after-sales follow-ups.

Built by ZironPro on the same stack as ZironPro Hub: Node 22.13+ (built-in `node:sqlite`), Express 5, Socket.IO,
Preact + htm served without a build step.

## Modules

| Area | What it does |
|---|---|
| **Leads** | Every enquiry with its source. Website forms, Meta lead ads and WhatsApp (Cloud API) post straight in; UTM tags set the source; duplicates by phone are merged; round-robin assignment. List & board, notes, calls/WhatsApp log, follow-up dates. |
| **Customers** | Business / individual records with tags, TRN, location; all deals, quotes, invoices, jobs and warranties per customer. |
| **Deals** | Pipeline New → Site visit → Measured → Quotation sent → Negotiation → Won / Lost (drag & drop). Next-step coach, history, files (site photos, drawings), deal chat. |
| **Estimation form** | Glass length × width × qty (mm/cm/m/in/ft) → SQM automatically, logged on the deal timeline. |
| **Pricing sheet** | Selling price, margin %, purchase price, supplier per item with live totals & profit. One click → quotation; one click → purchase orders per supplier (with cutting allowance). |
| **Quotations** | Branded A4 quotation with product images, amount in words, remarks & terms. Send by WhatsApp / email; the customer opens a link (you're told when) and can accept online. Revisions, expiry. |
| **Invoices & payments** | From the quotation without re-typing: advance %, full, or balance (less earlier invoices). VAT 5 %, payments (cash/bank/cheque/card), receipts, overdue chasing. |
| **Purchases** | Purchase orders, goods received (stock in), supplier bills & payments, what you owe. |
| **Products & stock** | Films with VLT / heat rejection / UV / thickness / warranty, images, stock in SQM at average cost, movement history, low-stock alerts. Film leaves stock on installation sign-off (or on invoice — setting). |
| **Expenses** | By category (expense accounts), optional job link so job profit is real; receipts attached. |
| **Accounting** | Double-entry journals posted automatically (invoices, payments, goods received, supplier payments, expenses, stock). Manual & opening-balance journals, chart of accounts & ledgers, P&L, balance sheet, trial balance, VAT return, receivables/payables ageing. |
| **Installations** | Scheduling & team, installer phone view: on my way (WhatsApp to customer) → start (GPS) → checklist, before/after photos, film used → complete → customer signature on the phone or by link. |
| **Warranty & follow-ups** | Warranty card per film at sign-off (public link), claims → inspection visit. Automatic review request, check-in call, free inspection, warranty-ending and quotation/payment follow-ups with ready WhatsApp messages. |
| **Calendar** | Calls, meetings, site visits, installations and follow-ups on one shared month view (agenda on phones). |
| **Reports** | Funnel leads → deals → quotations → won, leads by source, sales by person, this vs last month, 12-month chart, product mix, top customers, lost reasons, profit per deal. |
| **Team** | Chat (#channels, deal & job chats, DMs, photos, voice notes), attendance (office location / Wi-Fi lock, GPS for field staff, shifts, register CSV), leave & missed punch, roles with a view/create/edit/delete grid per module ("own only" for sales). |
| **Phone app** | Installable PWA with push notifications; optional WhatsApp alerts to staff. Nightly database backups. |

## Run locally

```bash
npm install
DATA_DIR=./data-dev PORT=4200 ADMIN_EMAIL=admin@crystalshield.ae ADMIN_PASSWORD='choose-one' node server/index.js
# demo data (server must be running):
HUB=http://localhost:4200 ADMIN_EMAIL=admin@crystalshield.ae ADMIN_PASSWORD='choose-one' DATA_DIR=./data-dev node scripts/seed-demo.js
```
Demo logins are written to `data-dev/DEMO_LOGINS.txt` (all `Demo2026!`): manager@, anjali@, faisal@ (sales), mary@ (accounts), ramesh@, suresh@, imran@ (installers) — `@crystalshield.ae`.

## Deploy (Dokploy / Docker)

- Build from the `Dockerfile`, port **4200**, health check `/api/health`.
- **Mount a persistent volume on `/app/data`** (database, photos, signatures, backups).
- Env: `APP_URL=https://<domain>` (used in links sent to customers), `ADMIN_EMAIL`, `ADMIN_PASSWORD` (first start only).
- After launch: Settings → Company (TRN, bank details, logo), Quotes & invoices (terms), Email, Lead capture (copy the website form address), Numbering (continue from the old system).
- Recovery: start once with `ADMIN_RESET=1` + `ADMIN_EMAIL` + `ADMIN_PASSWORD`, then remove `ADMIN_RESET`.

## Lead capture

`POST /api/public/leads?key=…` (JSON or HTML form): `name, phone, email, company, service, property_type, area, city, message, source, utm_source, utm_campaign, redirect`.
Meta lead ads: `/api/public/meta` (verify token + Page token in Settings). WhatsApp Cloud API: `/api/public/whatsapp`.
