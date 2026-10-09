// Owner tool — builds a commercial invoice (HTML + plain text + print/email PDF).
//
// Usage:
//   node scripts/commercial-invoice.mjs --data path/to/invoice.json
//   node scripts/commercial-invoice.mjs --sample
//
// The JSON source is the editable file (see
// assets/invoicing/commercial-invoice.example.json). Output goes to
// invoice-out/ (git-ignored — invoices contain customer data).
//
// Safety:
//  - the contact block is verified against src/config/business.ts so a printed
//    invoice can never carry a drifted phone/email/website;
//  - unset due date, payment terms and legal entity render as explicit
//    "[… — owner to complete]" placeholders, and the tool warns when any
//    placeholder remains — never inventing bank details, tax IDs or terms.

import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { buildInvoice, hasOwnerPlaceholders, formatMoney } from '../src/lib/invoicing/invoice.ts';

const DEFAULT_DATA = 'assets/invoicing/commercial-invoice.example.json';
const OUT_DIR = 'invoice-out';

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
  console.error(`Invoice not written: ${message}`);
  process.exit(1);
}

const args = parseArgs(process.argv.slice(2));
const dataPath = args.sample ? DEFAULT_DATA : typeof args.data === 'string' ? args.data : '';
if (!dataPath) {
  fail('missing --data <file>. See assets/invoicing/commercial-invoice.example.json.');
}
if (!fs.existsSync(dataPath)) fail(`data file not found: ${dataPath}`);

let data;
try {
  data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
} catch (error) {
  fail(`could not parse ${dataPath}: ${error.message}`);
}

// ── Validation ──────────────────────────────────────────────────────────────
if (!data.invoiceNumber || typeof data.invoiceNumber !== 'string') fail('invoiceNumber is required');
if (!/^\d{4}-\d{2}-\d{2}$/.test(data.issueDate ?? '')) fail('issueDate must be YYYY-MM-DD');
if (data.dueDate && !/^\d{4}-\d{2}-\d{2}$/.test(data.dueDate)) fail('dueDate must be YYYY-MM-DD when set');
if (!data.billedTo?.company || typeof data.billedTo.company !== 'string') fail('billedTo.company is required');
if (!Array.isArray(data.lineItems) || data.lineItems.length === 0) fail('at least one line item is required');
for (const [index, item] of data.lineItems.entries()) {
  if (!item?.description || typeof item.description !== 'string') fail(`line item ${index + 1}: description is required`);
  if (typeof item.quantity !== 'number' || !Number.isFinite(item.quantity) || item.quantity <= 0) {
    fail(`line item ${index + 1}: quantity must be a positive number`);
  }
  if (typeof item.unitPrice !== 'number' || !Number.isFinite(item.unitPrice) || item.unitPrice < 0) {
    fail(`line item ${index + 1}: unitPrice must be a non-negative number`);
  }
}
if (data.taxRatePercent !== null && data.taxRatePercent !== undefined) {
  if (typeof data.taxRatePercent !== 'number' || !Number.isFinite(data.taxRatePercent)) {
    fail('taxRatePercent must be a number when set (omit or null when no tax applies)');
  }
  if (!data.taxLabel || typeof data.taxLabel !== 'string') {
    fail('taxLabel is required when taxRatePercent is set — never guess a tax label');
  }
}

// ── Verified contact facts (drift guard) ────────────────────────────────────
const businessSource = fs.readFileSync('src/config/business.ts', 'utf8');
const requireSource = (value, label) => {
  if (!businessSource.includes(value)) {
    fail(`contact.${label} ("${value}") does not match src/config/business.ts — update the repo source first`);
  }
};
requireSource("'Sparkling Standard Cleaning Co.'", 'name');
requireSource("formatPhone('850-426-8479')", 'phone');
requireSource("'owner@sparkling-standard.com'", 'email');
requireSource("'https://sparkling-standard.com'", 'website');

const contact = data.contact ?? {};
if (contact.name !== 'Sparkling Standard Cleaning Co.') fail('contact.name must match the verified business name');
if (contact.phone !== '(850) 426-8479') fail('contact.phone must match the verified number');
if (contact.email !== 'owner@sparkling-standard.com') fail('contact.email must match the verified address');
if (contact.website !== 'sparkling-standard.com') fail('contact.website must match the verified domain');

// ── Build and write ─────────────────────────────────────────────────────────
const invoice = buildInvoice(data);
fs.mkdirSync(OUT_DIR, { recursive: true });
const base = String(data.invoiceNumber).replace(/[^A-Za-z0-9._-]+/g, '-');
const htmlPath = path.join(OUT_DIR, `invoice-${base}.html`);
const textPath = path.join(OUT_DIR, `invoice-${base}.txt`);
const pdfPath = path.join(OUT_DIR, `invoice-${base}.pdf`);

fs.writeFileSync(htmlPath, invoice.html);
fs.writeFileSync(textPath, invoice.text);

const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  await page.setContent(invoice.html, { waitUntil: 'load' });
  await page.pdf({ path: pdfPath, preferCSSPageSize: true, printBackground: true });
} finally {
  await browser.close();
}

console.log(`Invoice ${data.invoiceNumber}`);
console.log(`Subtotal:  ${formatMoney(invoice.totals.subtotal)}`);
if (invoice.totals.taxAmount !== null) console.log(`Tax:       ${formatMoney(invoice.totals.taxAmount)} (${data.taxLabel})`);
console.log(`Total due: ${formatMoney(invoice.totals.totalDue)}`);
console.log(`HTML: ${htmlPath}`);
console.log(`Text: ${textPath}`);
console.log(`PDF:  ${pdfPath}`);
if (hasOwnerPlaceholders(invoice)) {
  console.log('');
  console.log('! This invoice still contains [owner to complete] placeholders.');
  console.log('! Complete the due date, payment terms and legal entity (and tax, if it applies) before sending.');
} else {
  console.log('');
  console.log('All owner-completion fields are filled. Review the PDF before sending.');
}
console.log('invoice-out/ is git-ignored — never commit a completed invoice.');
