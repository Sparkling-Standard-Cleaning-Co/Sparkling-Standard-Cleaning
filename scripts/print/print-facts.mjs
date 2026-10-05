// Print-system facts — single source is src/config/business.ts.
// The build fails if these values no longer match the repository facts.
import fs from 'node:fs';

const source =
  fs.readFileSync('src/config/business.ts', 'utf8') + fs.readFileSync('src/components/Logo.astro', 'utf8');

export const FACTS = {
  displayName: 'Sparkling Standard Cleaning Co.',
  wordmark: 'Sparkling Standard',
  scriptWord: 'Sparkling',
  capsWord: 'STANDARD',
  descriptor: 'Cleaning Co.',
  tagline: 'The Details Are Our Standard.',
  founder: 'Hayli',
  founderRole: 'Founder & Owner-Operator',
  phoneDisplay: '(850) 426-8479',
  phoneTel: '+18504268479',
  email: 'owner@sparkling-standard.com',
  domain: 'sparkling-standard.com',
  serviceArea:
    'Serving Pensacola, Cantonment and surrounding communities, with select nearby service into Alabama.',
  hours: 'Seven days a week, 8:00 AM - 6:00 PM',
};

const REQUIRED_SOURCE_STRINGS = [
  '850-426-8479',
  'owner@sparkling-standard.com',
  'sparkling-standard.com',
  'Sparkling Standard Cleaning Co.',
  'The Details Are Our Standard.',
  'Founder & Owner-Operator',
  'Hayli',
];

export function verifyFacts() {
  const missing = REQUIRED_SOURCE_STRINGS.filter((value) => !source.includes(value));
  if (missing.length > 0) {
    throw new Error(
      `Print facts drift from src/config/business.ts. Missing: ${missing.join(', ')}. ` +
        'Update scripts/print/print-facts.mjs before printing.',
    );
  }
  if (FACTS.phoneDisplay.replace(/\D/g, '') !== '8504268479') {
    throw new Error('Phone formatting drifted from the owner-confirmed number.');
  }
}
