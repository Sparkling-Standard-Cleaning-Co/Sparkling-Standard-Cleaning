// ─────────────────────────────────────────────────────────────────────────────
// Print facts — verified against the repository sources at build time.
//
//   src/config/business.ts        business facts (single source of truth)
//   src/config/brand.ts           crest, wordmark, palette (shared with the site)
//   src/styles/tokens.css         design tokens (palette verification)
//   src/content/services/*.md     verified service names
//   src/components/Logo.astro     must consume the shared brand module
//
// The build fails if any fact drifts. Never hand-edit a printed fact here
// without changing the repository source first.
// ─────────────────────────────────────────────────────────────────────────────
import fs from 'node:fs';
import path from 'node:path';
import { brandWords, printPalette } from '../../src/config/brand.ts';

const businessSource = fs.readFileSync('src/config/business.ts', 'utf8');
const logoSource = fs.readFileSync('src/components/Logo.astro', 'utf8');
const tokensCss = fs.readFileSync('src/styles/tokens.css', 'utf8');
const serviceTitles = fs
  .readdirSync('src/content/services')
  .filter((file) => file.endsWith('.md'))
  .map((file) => {
    const text = fs.readFileSync(path.join('src/content/services', file), 'utf8');
    const match = text.match(/^title:\s*(.+)$/m);
    return match ? match[1].trim() : '';
  })
  .filter(Boolean);

function requireSource(value, label) {
  if (!businessSource.includes(value)) {
    throw new Error(`Print facts drift from src/config/business.ts: missing ${label} (${value}).`);
  }
}

const serviceAreaMatch = businessSource.match(/summary:\s*\n\s*'([^']+)'/);
if (!serviceAreaMatch) {
  throw new Error('Print facts: could not read serviceArea.summary from business.ts.');
}
const serviceAreaFull = serviceAreaMatch[1];
const serviceAreaShort = serviceAreaFull.replace(' within about an hour of Cantonment', '');

const hoursLiteral = 'Seven days a week · 8:00 AM – 6:00 PM';
requireSource(`display: '${hoursLiteral}'`, 'hours.display');

/** Verified print facts. */
export const FACTS = {
  displayName: 'Sparkling Standard Cleaning Co.',
  wordmark: 'Sparkling Standard',
  scriptWord: brandWords.script,
  capsWord: brandWords.capsDisplay,
  descriptor: brandWords.descriptor,
  tagline: brandWords.tagline,
  founder: 'Hayli',
  founderRole: 'Founder & Owner-Operator',
  phoneDisplay: '(850) 426-8479',
  phoneTel: '+18504268479',
  email: 'owner@sparkling-standard.com',
  domain: 'sparkling-standard.com',
  serviceAreaFull,
  serviceAreaShort,
  hours: hoursLiteral,
  services: [
    'Recurring house cleaning',
    'Deep cleaning',
    'Move-in / move-out',
    'Short-term rentals',
    'Commercial spaces',
    'Churches',
  ],
};

const SERVICE_TITLE_MAP = {
  'Recurring house cleaning': 'Recurring House Cleaning',
  'Deep cleaning': 'Deep Cleaning',
  'Move-in / move-out': 'Move-In & Move-Out Cleaning',
  'Short-term rentals': 'Short-Term Rental Turnover Cleaning',
  'Commercial spaces': 'Commercial Cleaning',
  Churches: 'Church Cleaning',
};

export function verifyFacts() {
  requireSource("'Sparkling Standard Cleaning Co.'", 'displayName');
  requireSource("firstName: 'Hayli'", 'founder.firstName');
  requireSource("role: 'Founder & Owner-Operator'", 'founder.role');
  requireSource("formatPhone('850-426-8479')", 'phone');
  requireSource("'owner@sparkling-standard.com'", 'email');
  requireSource("'https://sparkling-standard.com'", 'url');
  requireSource("wordmark: 'Sparkling Standard'", 'wordmark');

  if (FACTS.phoneDisplay.replace(/\D/g, '') !== '8504268479') {
    throw new Error('Print facts: phone formatting drifted from the owner-confirmed number.');
  }
  if (!serviceAreaFull.includes('Pensacola') || !serviceAreaFull.includes('Cantonment') || !serviceAreaFull.includes('Alabama')) {
    throw new Error('Print facts: service-area sentence is missing verified components.');
  }
  if (serviceAreaShort.includes('about an hour')) {
    throw new Error('Print facts: short service-area form must not silently drop the qualifier incorrectly.');
  }

  for (const [printed, sourceTitle] of Object.entries(SERVICE_TITLE_MAP)) {
    if (!FACTS.services.includes(printed)) {
      throw new Error(`Print facts: service "${printed}" is not declared.`);
    }
    if (!serviceTitles.includes(sourceTitle)) {
      throw new Error(`Print facts: service title "${sourceTitle}" not found in src/content/services/.`);
    }
  }

  for (const [name, hex] of Object.entries(printPalette)) {
    if (!tokensCss.toLowerCase().includes(hex.toLowerCase())) {
      throw new Error(`Print facts: palette value ${name} (${hex}) is not present in tokens.css.`);
    }
  }

  if (!logoSource.includes('crestSvg')) {
    throw new Error('Print facts: Logo.astro no longer consumes the shared crest (src/config/brand.ts).');
  }
  if (!logoSource.includes('brandWords')) {
    throw new Error('Print facts: Logo.astro no longer consumes the shared wordmark (src/config/brand.ts).');
  }
  if (logoSource.includes('#e2c07c')) {
    throw new Error('Print facts: Logo.astro still contains an inline crest gradient; use crestSvg().');
  }
}
