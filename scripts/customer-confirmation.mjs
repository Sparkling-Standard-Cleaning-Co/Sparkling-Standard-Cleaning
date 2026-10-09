// Owner tool — generates the branded customer confirmation email (HTML + text)
// from a submission field map, so the owner can send it from Gmail.
//
// Usage:
//   node scripts/customer-confirmation.mjs --sample
//   node scripts/customer-confirmation.mjs --data path/to/request.json
//
// The JSON is a flat field map (the same keys the website submits, e.g. from
// the owner notification email). Output goes to confirmation-out/ (git-ignored
// — it contains customer data).
//
// The automatic path (the lead relay sends this same template through Resend)
// is documented in docs/operations/CUSTOMER-CONFIRMATION-EMAIL.md. This tool
// remains the offline/manual fallback.

import fs from 'node:fs';
import path from 'node:path';
import { buildCustomerConfirmation } from '../src/lib/forms/customer-confirmation.ts';

const OUT_DIR = 'confirmation-out';

const SAMPLE = {
  request_type: 'reservation_request',
  service_type: 'standard',
  frequency: 'biweekly',
  square_feet: '1600',
  bedrooms: '3',
  full_baths: '2',
  service_address: '100 S Baylen St',
  address_city: 'Pensacola',
  address_state: 'FL',
  zip: '32502',
  preferred_date: '2026-12-15',
  arrival_preference: 'morning',
  quoted_price: '200',
  quoted_range: '$180–$220',
  quote_reference: 'SS-SAMPLE-0001',
};

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[index + 1];
    if (next && !next.startsWith('--')) {
      args[key] = next;
      index += 1;
    } else {
      args[key] = true;
    }
  }
  return args;
}

function fail(message) {
  console.error(`Confirmation not written: ${message}`);
  process.exit(1);
}

const args = parseArgs(process.argv.slice(2));
let fields;
let label;
if (args.sample) {
  fields = SAMPLE;
  label = 'sample';
} else if (typeof args.data === 'string') {
  if (!fs.existsSync(args.data)) fail(`data file not found: ${args.data}`);
  try {
    fields = JSON.parse(fs.readFileSync(args.data, 'utf8'));
  } catch (error) {
    fail(`could not parse ${args.data}: ${error.message}`);
  }
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) fail('the data file must be a flat field map');
  label = path.basename(args.data, path.extname(args.data)).replace(/[^A-Za-z0-9._-]+/g, '-');
} else {
  fail('missing --data <file> (or use --sample). See docs/operations/CUSTOMER-CONFIRMATION-EMAIL.md.');
}

// Verified contact facts — the same drift guard the invoice tool uses.
const businessSource = fs.readFileSync('src/config/business.ts', 'utf8');
for (const [value, fact] of [
  ["'Sparkling Standard Cleaning Co.'", 'business name'],
  ["formatPhone('850-426-8479')", 'phone'],
  ["'owner@sparkling-standard.com'", 'email'],
  ["'https://sparkling-standard.com'", 'website'],
]) {
  if (!businessSource.includes(value)) fail(`${fact} does not match src/config/business.ts — update the repo source first`);
}

const confirmation = buildCustomerConfirmation(fields, {
  name: 'Sparkling Standard Cleaning Co.',
  founder: 'Hayli',
  phone: '(850) 426-8479',
  email: 'owner@sparkling-standard.com',
  website: 'sparkling-standard.com',
});

fs.mkdirSync(OUT_DIR, { recursive: true });
const htmlPath = path.join(OUT_DIR, `confirmation-${label}.html`);
const textPath = path.join(OUT_DIR, `confirmation-${label}.txt`);
fs.writeFileSync(htmlPath, confirmation.html);
fs.writeFileSync(textPath, confirmation.text);

console.log(`Subject: ${confirmation.subject}`);
console.log(`HTML: ${htmlPath}`);
console.log(`Text: ${textPath}`);
console.log('');
console.log('To send: open the HTML file in a browser, copy the content into a Gmail message');
console.log('(or paste the .txt version), or attach the printed PDF. Never commit these files —');
console.log('confirmation-out/ is git-ignored.');
