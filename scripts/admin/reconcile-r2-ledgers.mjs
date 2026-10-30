// Build an idempotent D1 reconciliation SQL file from exported R2 JSON ledgers.
// This script never connects to production. Export the private R2 objects first
// and pass the directory containing the exported JSON files.
//
// Expected layouts (either flat export or mirrored keys):
//   gifts/certificates/SSGC-XXXX-XXXX.json
//   booking/requests/BR-....json
//
// Usage:
//   node scripts/admin/reconcile-r2-ledgers.mjs --bookings <dir> --gifts <dir> --out reconcile.sql
import fs from 'node:fs';
import path from 'node:path';

function arg(name, fallback = '') {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] ?? fallback : fallback;
}

const root = arg('root', '');
const giftsDir = arg('gifts', root ? path.join(root, 'gifts', 'certificates') : '');
const bookingsDir = arg('bookings', root ? path.join(root, 'booking', 'requests') : '');
const out = arg('out', 'reconcile-r2.sql');

function sqlValue(value) {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'NULL';
  return `'${String(value).replaceAll("'", "''")}'`;
}

function readJsonFiles(directory) {
  if (!directory || !fs.existsSync(directory)) return [];
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...readJsonFiles(full));
    else if (entry.name.endsWith('.json')) files.push(full);
  }
  return files;
}

const statements = ['PRAGMA foreign_keys = ON;'];
let giftCount = 0;
let bookingCount = 0;

for (const file of readJsonFiles(giftsDir)) {
  let record;
  try {
    record = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    continue;
  }
  if (!record?.code || !record?.status) continue;
  const value = Number(record.valueCents) || 0;
  const reserved = (record.reservations ?? [])
    .filter((item) => item.status === 'reserved' && Date.parse(item.expiresAt) > Date.now())
    .reduce((sum, item) => sum + (Number(item.amountCents) || 0), 0);
  const balance = Math.max(0, value - (Number(record.redeemedCents) || 0) - reserved);
  const id = `gift_r2_${String(record.code).replace(/[^A-Z0-9-]/gi, '')}`;
  statements.push(`INSERT INTO gift_certificates
    (id, code, status, value_cents, balance_cents, valid_from_date, activates_at,
     stripe_event_id, stripe_session_id, terms_version, branch_id)
    VALUES (${sqlValue(id)}, ${sqlValue(record.code)}, ${sqlValue(record.status)}, ${value}, ${balance},
      ${sqlValue(record.validFromDate ?? null)}, ${sqlValue(record.activatesAt ?? null)},
      ${sqlValue(record.stripeEventId ?? '')}, ${sqlValue(record.stripeSessionId ?? '')},
      ${sqlValue(record.termsVersion ?? 'r2-import')}, 'branch_pensacola')
    ON CONFLICT(code) DO UPDATE SET
      status = excluded.status,
      value_cents = excluded.value_cents,
      balance_cents = excluded.balance_cents,
      valid_from_date = excluded.valid_from_date,
      activates_at = excluded.activates_at,
      updated_at = CURRENT_TIMESTAMP;`);
  giftCount += 1;
}

for (const file of readJsonFiles(bookingsDir)) {
  let record;
  try {
    record = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    continue;
  }
  if (!record?.id || !record?.holdId || !record?.start || !record?.end) continue;
  const start = String(record.start);
  const end = String(record.end);
  const date = String(record.date ?? start.slice(0, 10));
  statements.push(`INSERT INTO booking_requests
    (id, hold_id, branch_id, status, quote_reference, requested_date, start_at, end_at,
     duration_minutes, payload_json)
    VALUES (${sqlValue(record.id)}, ${sqlValue(record.holdId)}, 'branch_pensacola',
      ${sqlValue(record.status === 'declined' ? 'declined' : record.status === 'confirmed' ? 'confirmed' : 'pending')},
      ${sqlValue(record.reference ?? '')}, ${sqlValue(date)}, ${sqlValue(start)}, ${sqlValue(end)},
      ${Number(record.durationMinutes) || 120}, ${sqlValue(JSON.stringify({ source: 'r2_backfill', locationText: record.locationText ?? '', destination: record.destination ?? null, resourceIds: record.resourceIds ?? [], crewSize: record.crewSize ?? null, calendarEventId: record.calendarEventId ?? '' }))})
    ON CONFLICT(hold_id) DO UPDATE SET
      status = excluded.status,
      quote_reference = excluded.quote_reference,
      requested_date = excluded.requested_date,
      start_at = excluded.start_at,
      end_at = excluded.end_at,
      duration_minutes = excluded.duration_minutes,
      payload_json = excluded.payload_json,
      updated_at = CURRENT_TIMESTAMP,
      branch_id = COALESCE(booking_requests.branch_id, excluded.branch_id);`);
  bookingCount += 1;
}

fs.writeFileSync(out, `${statements.join('\n')}\n`);
console.log(`wrote ${out}: ${giftCount} gifts, ${bookingCount} booking requests`);
console.log('Review the SQL before applying it with:');
console.log(`npx wrangler d1 execute <database> --remote --file ${out}`);
