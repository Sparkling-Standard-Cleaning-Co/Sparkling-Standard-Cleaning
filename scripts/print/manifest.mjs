// ─────────────────────────────────────────────────────────────────────────────
// Canonical physical-piece manifest — SINGLE SOURCE for the print generator,
// the verifiers, the tests and the owner documentation.
//
// Facts stay in src/config/business.ts; the mark stays in src/config/brand.ts;
// QR destinations stay in src/config/marketing-links.ts. This file only defines
// the physical pieces, their variants and their production requirements.
// ─────────────────────────────────────────────────────────────────────────────

/** The three finished suite variants. One brand, three medium-led treatments. */
export const VARIANTS = [
  {
    id: 'neighbor',
    letter: 'B',
    label: 'From a Neighbor',
    role: 'Warm, founder-led pieces for door-to-door and neighborhood contact.',
  },
  {
    id: 'utility',
    letter: 'C',
    label: 'The Detail Standard',
    role: 'Structured, scannable pieces for QR/utility and professional desks.',
  },
  {
    id: 'editorial',
    letter: 'A',
    label: 'The Standard',
    role: 'Premium editorial pieces for large-format and community presence.',
  },
];

/**
 * Recommended production mix (owner delegated the direction choice):
 * neighbor for contact-heavy pieces, utility for QR/professional pieces,
 * editorial for large-format presence.
 */
export const PRODUCTION_MIX = {
  'business-card': 'neighbor',
  'quarter-sheet': 'neighbor',
  'door-hanger': 'neighbor',
  'qr-estimate-card': 'utility',
  'event-poster': 'editorial',
  'foam-board': 'editorial',
  'community-leave-behind': 'neighbor',
  'realtor-card': 'utility',
};

/** Physical pieces. `qr` is a public/marketing/qr asset id (registry-driven). */
export const PIECES = [
  {
    id: 'business-card',
    name: 'Business card',
    width: 3.5,
    height: 2,
    safeMargin: 0.14,
    sides: [
      { id: 'front', qr: null },
      { id: 'back', qr: 'business-card', caption: 'Scan for a fast, free estimate', captionMin: 0.055 },
    ],
    qrMin: 0.85,
    stock: '16 pt matte or soft-touch, uncoated',
    print: 'Double-sided (front identity + back value/QR)',
    firstRun: '500–1,000',
  },
  {
    id: 'quarter-sheet',
    name: 'Quarter sheet',
    width: 4.25,
    height: 5.5,
    safeMargin: 0.18,
    sides: [
      { id: 'front', qr: 'quarter-sheet', caption: 'Scan to start your free estimate', captionMin: 0.06 },
    ],
    qrMin: 0.85,
    stock: '100 lb matte text',
    print: 'Single-sided',
    firstRun: '250',
  },
  {
    id: 'door-hanger',
    name: 'Door hanger',
    width: 3.5,
    height: 8.5,
    safeMargin: 0.2,
    sides: [
      { id: 'front', qr: 'door-hanger', caption: 'Scan for your free estimate', captionMin: 0.065 },
    ],
    qrMin: 0.85,
    die: {
      holeDiameter: 1.25,
      centerFromTop: 0.925,
      minClearanceBelowHole: 0.25,
      topKeepClear: 1.8,
    },
    stock: '14–16 pt coated',
    print: 'Single-sided; die-cut hole 1.25 in centered 0.925 in from the top',
    firstRun: '500 (targeted routes only)',
  },
  {
    id: 'qr-estimate-card',
    name: 'QR estimate card',
    width: 4,
    height: 6,
    safeMargin: 0.2,
    sides: [
      { id: 'front', qr: 'qr-estimate-card', caption: 'Scan me', captionMin: 0.07 },
    ],
    qrMin: 0.85,
    stock: '14–16 pt matte',
    print: 'Single-sided',
    firstRun: '500',
  },
  {
    id: 'event-poster',
    name: 'Event poster',
    width: 11,
    height: 17,
    safeMargin: 0.5,
    sides: [
      { id: 'front', qr: 'event-poster', caption: 'Scan for a free instant estimate', captionMin: 0.13 },
    ],
    qrMin: 2.0,
    stock: '100 lb gloss text or 8 mil poster',
    print: 'Single-sided',
    firstRun: '5',
  },
  {
    id: 'foam-board',
    name: 'Foam board',
    width: 24,
    height: 36,
    safeMargin: 0.9,
    sides: [
      { id: 'front', qr: 'foam-board', caption: 'Scan for a free instant estimate', captionMin: 0.3 },
    ],
    qrMin: 4.0,
    stock: '3/16 in white foam core, matte laminate',
    print: 'Single-sided display board',
    firstRun: '2',
  },
  {
    id: 'community-leave-behind',
    name: 'Community leave-behind',
    width: 5,
    height: 7,
    safeMargin: 0.25,
    sides: [
      { id: 'front', qr: 'community-leave-behind', caption: 'Scan for your free estimate', captionMin: 0.055 },
    ],
    qrMin: 0.85,
    stock: '14–16 pt matte',
    print: 'Single-sided; keep-on-desk card',
    firstRun: '250',
  },
  {
    id: 'realtor-card',
    name: 'Realtor referral card',
    width: 3.5,
    height: 2,
    safeMargin: 0.13,
    sides: [
      { id: 'front', qr: 'realtor-packet', caption: 'Move-out page', captionMin: 0.05 },
    ],
    qrMin: 0.85,
    stock: '16 pt matte',
    print: 'Single-sided; realtor desk card',
    firstRun: '250',
  },
];

/** Bleed and crop-mark geometry. */
export const PRINT_GEOMETRY = {
  bleed: 0.125,
  cropMarkLength: 0.07,
  cropMarkGap: 0.02,
  cropMarkThickness: 0.008,
  minQrQuietZoneModules: 4,
};

/** Default output root (never the original packet folder). */
export function defaultOutputRoot(home = process.env.USERPROFILE ?? process.env.HOME ?? '.') {
  return `${home}/Downloads/Door Knocking - Stage 2 Review`;
}

export function pieceById(id) {
  return PIECES.find((piece) => piece.id === id);
}

export function variantById(id) {
  return VARIANTS.find((variant) => variant.id === id);
}
