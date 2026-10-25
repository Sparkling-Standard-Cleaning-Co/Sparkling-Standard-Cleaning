// Regression guard for Hayli's six-page homepage audit.
//
// Reads the RENDERED homepage output (dist/index.html) and verifies that the
// six complete approved service descriptions are actually present — including
// the mandatory Deep Cleaning prerequisite, which the prior implementation
// silently omitted from the homepage card.
//
// Run after the build (called by npm run validate).

import fs from 'node:fs';

const HOMEPAGE = 'dist/index.html';

if (!fs.existsSync(HOMEPAGE)) {
  console.error('homepage audit: dist/index.html not found — run npm run build first');
  process.exit(1);
}

const html = fs.readFileSync(HOMEPAGE, 'utf8');
const text = html
  .replace(/<script[\s\S]*?<\/script>/gi, ' ')
  .replace(/<style[\s\S]*?<\/style>/gi, ' ')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&amp;/g, '&')
  .replace(/&rsquo;|&#8217;|&#39;/g, '’')
  .replace(/&ldquo;|&rdquo;|&quot;/g, '"')
  .replace(/&mdash;|&#8212;/g, '—')
  .replace(/&ndash;|&#8211;/g, '–')
  .replace(/&nbsp;/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const required = [
  {
    label: 'Recurring Residential Cleaning',
    copy:
      'A consistent, scheduled cleaning that keeps your home maintained, tidy, and sparkling. Choose a weekly, biweekly, or monthly schedule to keep your home looking its best.',
  },
  {
    label: 'Deep Cleaning — service scope',
    copy:
      'An in-depth reset for a home that needs extra care and attention. Our deep cleaning service focuses on areas that can get buildup over time, from hand wiping baseboards and blinds to detailing walls and doors (See our Deep Cleaning procedure and available add-ons for a full list of services). We go beyond the basics to leave your home feeling renewed, and thoroughly clean.',
  },
  {
    label: 'Deep Cleaning — mandatory recurring prerequisite and returning-client recommendation',
    copy:
      'This service is ideal for one-time cleanings and is required before beginning recurring residential maintenance cleaning. It’s also recommended for returning clients when dirt, grime, or buildup begins to accumulate beyond what routine maintenance cleaning is designed to address.',
  },
  {
    label: 'Move-in and Move-out Cleaning',
    copy:
      'Give your home a fresh start with a thorough, top-to-bottom cleaning. Whether you’re moving into a new home or preparing to sell or rent your property, we’ll leave it sparkling clean, and ready for its next residents.',
  },
  {
    label: 'Short-term Rental Turnover Cleaning',
    copy:
      'A complete turnover service for Airbnb and Vrbo hosts that protects your reviews and keeps bookings coming. More than a quick clean, we provide a reset between guests to help ensure your rental is sanitary, refreshed, and ready for the next arrival.',
  },
  {
    label: 'Commercial Cleaning',
    copy:
      'Recurring or one-time commercial cleaning for local businesses and facilities. Each service is professionally scoped to your space, with scheduling tailored to your operation’s needs.',
  },
  {
    label: 'Church Cleaning',
    copy:
      'A complete church cleaning service for sanctuaries, fellowship halls, nurseries, restrooms, and offices — scheduled around services and church life.',
  },
];

const missing = required.filter((entry) => !text.includes(entry.copy));
const removedSections = ['Details We Notice', 'Detail proof', 'How It Works', 'How it works'];
const stillPresent = removedSections.filter((entry) => text.includes(entry));

if (missing.length > 0) {
  console.error('HOMEPAGE AUDIT FAILED — missing approved copy:');
  for (const entry of missing) console.error(` - ${entry.label}`);
  process.exit(1);
}

if (stillPresent.length > 0) {
  console.error('HOMEPAGE AUDIT FAILED — removed sections are still rendered:');
  for (const entry of stillPresent) console.error(` - ${entry}`);
  process.exit(1);
}

console.log(`homepage audit: all ${required.length} approved service-copy blocks rendered; removed sections absent`);
