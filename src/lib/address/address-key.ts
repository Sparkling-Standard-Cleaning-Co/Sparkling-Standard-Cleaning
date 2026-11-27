/**
 * Shared, dependency-free address and contact normalization.
 *
 * The purpose is deliberately narrow: recognise repeated checkout attempts for
 * the same property without ever merging distinct units, customers or genuine
 * apartments. These helpers are used by the booking commitment, lead
 * persistence and the owner's duplicate-property review.
 */

const STREET_SUFFIXES: Readonly<Record<string, string>> = {
  alley: 'aly',
  avenue: 'ave',
  av: 'ave',
  boulevard: 'blvd',
  blvd: 'blvd',
  circle: 'cir',
  court: 'ct',
  cove: 'cv',
  crossing: 'xing',
  drive: 'dr',
  expressway: 'expy',
  freeway: 'fwy',
  highway: 'hwy',
  lane: 'ln',
  loop: 'loop',
  parkway: 'pkwy',
  place: 'pl',
  plaza: 'plz',
  road: 'rd',
  route: 'rte',
  square: 'sq',
  street: 'st',
  terrace: 'ter',
  trail: 'trl',
  turnpike: 'tpke',
  way: 'way',
};

const UNIT_PATTERN = /(?:^|[\s,]+)(?:apt|apartment|unit|ste|suite|#)\s*([a-z0-9-]+)\s*$/i;

export function normalizeEmail(value: unknown): string {
  return String(value ?? '').trim().toLowerCase();
}

/** Ten-digit US phone key; tolerates +1, spaces, punctuation and extensions. */
export function phoneKey(value: unknown): string {
  const digits = String(value ?? '').replace(/\D/g, '');
  return digits.length >= 10 ? digits.slice(-10) : digits;
}

function stripPunctuation(value: string): string {
  return value
    .replace(/[.,;:()'"!?]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeStreetWord(word: string): string {
  return STREET_SUFFIXES[word] ?? word;
}

export interface NormalizedAddressParts {
  street: string;
  unit: string;
}

/**
 * Normalizes a street line. A unit written inside line 1 (e.g. "12 Main St
 * Apt 4") is separated so it can never collapse into a neighbour's unit.
 */
export function normalizeAddressLine(value: unknown, unitValue: unknown = ''): NormalizedAddressParts {
  let line = String(value ?? '').split(',')[0] ?? '';
  line = stripPunctuation(line.toLowerCase());
  let unit = stripPunctuation(String(unitValue ?? '').toLowerCase()).replace(/^#\s*/, '');
  const inline = UNIT_PATTERN.exec(line);
  if (inline) {
    const inlineUnit = inline[1] ?? '';
    if (!unit) unit = inlineUnit;
    line = line.slice(0, inline.index).trim();
  }
  const words = line.split(/\s+/).filter(Boolean).map(normalizeStreetWord);
  return {
    street: words.join(' '),
    unit: unit.replace(/^(apt|apartment|unit|ste|suite)\s+/, '').replace(/\s+/g, ''),
  };
}

function postal5(value: unknown): string {
  const match = /^(\d{5})/.exec(String(value ?? '').trim());
  return match?.[1] ?? '';
}

/**
 * Stable grouping key for duplicate review. Postal code (or, when absent, the
 * normalized city) keeps identically named streets in different places apart.
 */
export function addressKey(input: {
  line1?: unknown;
  line2?: unknown;
  postalCode?: unknown;
  city?: unknown;
}): string {
  const { street, unit } = normalizeAddressLine(input.line1, input.line2);
  if (!street) return '';
  const locality = postal5(input.postalCode) || stripPunctuation(String(input.city ?? '').toLowerCase());
  return [street, unit, locality].filter(Boolean).join('|');
}

/**
 * Same-customer property identity. A missing ZIP, city casing or suffix
 * abbreviation must not create a second property for the same customer.
 */
export function samePropertyAddress(
  left: { line1?: unknown; line2?: unknown; postalCode?: unknown },
  right: { line1?: unknown; line2?: unknown; postalCode?: unknown },
): boolean {
  const a = normalizeAddressLine(left.line1, left.line2);
  const b = normalizeAddressLine(right.line1, right.line2);
  if (!a.street || !b.street || a.street !== b.street || a.unit !== b.unit) return false;
  const aPostal = postal5(left.postalCode);
  const bPostal = postal5(right.postalCode);
  return !aPostal || !bPostal || aPostal === bPostal;
}

/** True when the final street token is a recognized street suffix. */
export function streetHasSuffix(street: string): boolean {
  const words = street.split(/\s+/).filter(Boolean);
  const last = words.at(-1) ?? '';
  return Object.values(STREET_SUFFIXES).includes(last) || Object.keys(STREET_SUFFIXES).includes(last);
}
/** Owner-confirmed consolidation may combine a truncated suffix, not two real suffixes. */
export function sameStreetForConsolidation(left: string, right: string): boolean {
  const a = left.split(/\s+/).filter(Boolean);
  const b = right.split(/\s+/).filter(Boolean);
  if (a.join(' ') === b.join(' ')) return true;
  if (a.length < 2 || b.length < 2) return false;
  const aBase = a.slice(0, -1).join(' ');
  const bBase = b.slice(0, -1).join(' ');
  const aSuffix = a.at(-1) ?? '';
  const bSuffix = b.at(-1) ?? '';
  if (aBase === bBase) {
    const known = (word: string): boolean =>
      Object.values(STREET_SUFFIXES).includes(word) || Object.keys(STREET_SUFFIXES).includes(word);
    return !(known(aSuffix) && known(bSuffix) && aSuffix !== bSuffix);
  }
  const shorter = a.length <= b.length ? a : b;
  const longer = shorter === a ? b : a;
  const base = shorter.join(' ');
  if (longer.slice(0, shorter.length).join(' ') !== base) return false;
  if (longer.length !== shorter.length + 1) return false;
  const remainder = longer.at(-1) ?? '';
  if (remainder.length > 3) return false;
  return !streetHasSuffix(base);
}
/** Human-friendly key used only in aggregate diagnostics, never as a public ID. */
export function addressKeyParts(key: string): { street: string; unit: string; locality: string } {
  const [street = '', unit = '', locality = ''] = key.split('|');
  return { street, unit, locality };
}
