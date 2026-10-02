// Suggestion filtering + ranking — geographically intelligent address search.
//
// Pure functions shared by the /api/geocode proxy and the unit tests.
//
// Rules:
//  - When a state is selected, ONLY suggestions that carry a positive signal
//    for that state are displayed. Contexts are parsed structurally (comma
//    separated), accepting both the full state name ("Florida") and the
//    two-letter USPS code ("FL") so no supplier format silently drops every
//    result. Out-of-state and non-US results are never shown.
//  - A supplied ZIP hard-filters suggestions that carry a different ZIP.
//  - Street names must match on their distinctive tokens (with safe prefix
//    matching for partially typed names) or on a numbered-road match, so
//    "9999 Birchwood Lane" can never answer a "4242 Maplewood Lane" search.
//  - Nearby matches (within the public Pensacola service centre radius) rank
//    above far-away same-state results; proximity reorders, it never excludes,
//    because address discovery is not service eligibility.
//  - Exact house numbers rank first; a result with a different house number
//    is never treated as an exact match (the client enforces exactness too).
//  - When nothing in-state survives and the customer has not supplied a city
//    or ZIP, callers should prompt for one instead of showing nationwide rows.

export interface RawSuggestion {
  id: string;
  name: string;
  context: string;
  kind?: string | undefined;
  lat?: number | undefined;
  lng?: number | undefined;
}

export interface SuggestionLocation {
  street?: string | undefined;
  city?: string | undefined;
  state?: string | undefined;
  zip?: string | undefined;
}

export interface RankedSuggestion extends RawSuggestion {
  label: string;
  score: number;
}

/**
 * Every US state/territory + DC: full names and USPS codes. Used to parse a
 * suggestion's region structurally instead of substring guessing. Substring
 * guessing produced false positives (e.g. "Indiana Avenue, Florida" matched
 * "india") and false negatives (a supplier sending "FL" never matched
 * "florida").
 */
const US_STATES: ReadonlyArray<readonly [string, string]> = [
  ['AL', 'alabama'], ['AK', 'alaska'], ['AZ', 'arizona'], ['AR', 'arkansas'],
  ['CA', 'california'], ['CO', 'colorado'], ['CT', 'connecticut'], ['DE', 'delaware'],
  ['DC', 'district of columbia'], ['FL', 'florida'], ['GA', 'georgia'], ['HI', 'hawaii'],
  ['ID', 'idaho'], ['IL', 'illinois'], ['IN', 'indiana'], ['IA', 'iowa'],
  ['KS', 'kansas'], ['KY', 'kentucky'], ['LA', 'louisiana'], ['ME', 'maine'],
  ['MD', 'maryland'], ['MA', 'massachusetts'], ['MI', 'michigan'], ['MN', 'minnesota'],
  ['MS', 'mississippi'], ['MO', 'missouri'], ['MT', 'montana'], ['NE', 'nebraska'],
  ['NV', 'nevada'], ['NH', 'new hampshire'], ['NJ', 'new jersey'], ['NM', 'new mexico'],
  ['NY', 'new york'], ['NC', 'north carolina'], ['ND', 'north dakota'], ['OH', 'ohio'],
  ['OK', 'oklahoma'], ['OR', 'oregon'], ['PA', 'pennsylvania'], ['RI', 'rhode island'],
  ['SC', 'south carolina'], ['SD', 'south dakota'], ['TN', 'tennessee'], ['TX', 'texas'],
  ['UT', 'utah'], ['VT', 'vermont'], ['VA', 'virginia'], ['WA', 'washington'],
  ['WV', 'west virginia'], ['WI', 'wisconsin'], ['WY', 'wyoming'],
] as const;

const STATE_NAMES: Record<string, string[]> = {
  FL: ['florida'],
  AL: ['alabama'],
};

const STATE_CODE_SET = new Set(US_STATES.map(([code]) => code));
const STATE_NAME_TO_CODE = new Map(US_STATES.map(([code, name]) => [name, code]));

/**
 * Positive state signals for one suggestion. Comma-separated context parts
 * that are exactly a USPS code or exactly a state name are authoritative;
 * when the context carries no such part, full state names embedded in the
 * name/context are accepted as a fallback so non-comma label formats (e.g.
 * "Maplewood Lane, Florida, United States") still resolve.
 */
function stateSignals(suggestion: RawSuggestion): Set<string> {
  const signals = new Set<string>();
  for (const rawPart of `${suggestion.context}`.split(',')) {
    const part = rawPart.trim();
    if (!part) continue;
    if (/^[A-Za-z]{2}$/.test(part) && STATE_CODE_SET.has(part.toUpperCase())) {
      signals.add(part.toUpperCase());
      continue;
    }
    const byName = STATE_NAME_TO_CODE.get(part.toLowerCase());
    if (byName) signals.add(byName);
  }
  if (signals.size === 0) {
    const haystack = `${suggestion.name} ${suggestion.context}`.toLowerCase();
    for (const [code, name] of US_STATES) {
      const pattern = new RegExp(`\\b${name}\\b`);
      if (pattern.test(haystack)) signals.add(code);
    }
  }
  return signals;
}

const ROAD_WORDS = new Set([
  'street', 'st', 'road', 'rd', 'lane', 'ln', 'avenue', 'ave', 'boulevard', 'blvd', 'drive', 'dr',
  'court', 'ct', 'circle', 'cir', 'place', 'pl', 'terrace', 'ter', 'parkway', 'pkwy', 'highway',
  'hwy', 'way', 'trail', 'trl', 'loop', 'square', 'sq', 'state', 'route',
]);

const DIRECTIONS = new Set(['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw', 'north', 'south', 'east', 'west']);

const TOKEN_SYNONYMS: Record<string, string> = {
  hwy: 'highway',
  hgwy: 'highway',
  sr: 'state road',
  'state route': 'state road',
  fl: 'state road',
  st: 'street',
  rd: 'road',
  ln: 'lane',
  ave: 'avenue',
  blvd: 'boulevard',
  dr: 'drive',
  ct: 'court',
  cir: 'circle',
  pl: 'place',
  ter: 'terrace',
  pkwy: 'parkway',
  n: 'north',
  s: 'south',
  e: 'east',
  w: 'west',
  ne: 'northeast',
  nw: 'northwest',
  se: 'southeast',
  sw: 'southwest',
};

function words(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[.,#]/g, ' ')
    .replace(/-/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

/** Normalized street tokens with road/direction synonyms expanded. */
export function normalizeStreetTokens(street: string): string[] {
  const expanded: string[] = [];
  for (const word of words(street)) {
    const mapped = TOKEN_SYNONYMS[word];
    if (mapped) expanded.push(...mapped.split(' '));
    else expanded.push(word);
  }
  return expanded;
}

/** Route numbers mentioned in a street line (house number excluded). */
export function routeNumbers(street: string): string[] {
  const tokens = normalizeStreetTokens(street);
  const numbers: string[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index] ?? '';
    const previous = tokens[index - 1] ?? '';
    if (/^\d+$/.test(token) && (previous === 'highway' || previous === 'state' || previous === 'road' || previous === 'route')) {
      numbers.push(token);
    }
  }
  return numbers;
}

/** Distinctive (non-generic, non-direction, non-house-number) street tokens. */
export function distinctiveTokens(street: string): string[] {
  const tokens = normalizeStreetTokens(street).filter((token) => !/^\d/.test(token));
  return tokens.filter((token) => token.length > 2 && !ROAD_WORDS.has(token) && !DIRECTIONS.has(token));
}

/**
 * True when `requested` token matches a candidate token exactly, or — for a
 * partially typed word of at least 3 characters — as a prefix of a longer
 * candidate. "Bayl" matches "Baylen"; "Maplewood" never matches "Birchwood".
 * Because every distinctive requested token must match, a shared prefix alone
 * (e.g. "Pine" in "Pine Hollow") can never smuggle in an unrelated street.
 */
function tokenMatches(requested: string, candidateTokens: Set<string>): boolean {
  if (candidateTokens.has(requested)) return true;
  if (requested.length < 3) return false;
  for (const token of candidateTokens) {
    if (token.length > requested.length && token.startsWith(requested)) return true;
  }
  return false;
}

/**
 * True when a suggestion's street text plausibly matches the requested street.
 * Every distinctive requested token must match (or route numbers must match
 * for numbered highways); a single shared generic word ("Pine Forest" vs
 * "Pine Hollow") is not enough.
 */
export function streetMatches(requestedStreet: string, candidateText: string): boolean {
  if (!requestedStreet.trim()) return true;
  const candidateTokens = new Set(normalizeStreetTokens(candidateText));
  const requestedDistinctive = distinctiveTokens(requestedStreet);
  const requestedNumbers = routeNumbers(requestedStreet);
  if (requestedDistinctive.length > 0) {
    return requestedDistinctive.every((token) => tokenMatches(token, candidateTokens));
  }
  // Numbered roads: Highway 97 ≈ Hwy 97 ≈ SR 97 ≈ State Road 97.
  if (requestedNumbers.length > 0) {
    return requestedNumbers.some((number) => candidateTokens.has(number));
  }
  return true;
}

/** Normalizes a suggestion to the label shown to customers. */
export function suggestionLabel(suggestion: RawSuggestion): string {
  return [suggestion.name, suggestion.context].filter(Boolean).join(', ');
}

/** Extracts a 5-digit ZIP from a suggestion's name/context when present. */
export function suggestionZip(suggestion: RawSuggestion): string | null {
  const match = `${suggestion.name} ${suggestion.context}`.match(/\b(\d{5})(?:-\d{4})?\b/);
  return match ? (match[1] as string) : null;
}

/** Extracts a house number from the start of a suggestion name, if any. */
export function suggestionHouseNumber(suggestion: RawSuggestion): string | null {
  const match = suggestion.name.trim().match(/^(\d+[a-z]?)\b/i);
  return match ? (match[1] as string).toLowerCase() : null;
}

export interface RankResult {
  ranked: RankedSuggestion[];
  /** Provider returned rows, but nothing survived the geographic/street filter. */
  filteredOutAll: boolean;
  /** True when the customer should be asked for a city or ZIP. */
  needsLocation: boolean;
}

/**
 * Public service-area centre (Pensacola city centre). This is a coarse,
 * public reference point — never the private operating origin — and is only
 * used to prefer nearer results. It never excludes a valid same-state match.
 */
export const SERVICE_CENTER = { lat: 30.4213, lng: -87.2169 } as const;

/** Great-circle distance in miles (public reference point only). */
function distanceMiles(lat: number, lng: number): number {
  const toRad = (value: number) => (value * Math.PI) / 180;
  const earthRadiusMiles = 3958.8;
  const dLat = toRad(lat - SERVICE_CENTER.lat);
  const dLng = toRad(lng - SERVICE_CENTER.lng);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(SERVICE_CENTER.lat)) * Math.cos(toRad(lat)) * Math.sin(dLng / 2) ** 2;
  return earthRadiusMiles * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Proximity adjustment: near matches rank up, far ones rank down. The weights
 * deliberately exceed a coincidental exact-house-number score (+60) when the
 * customer typed their local city, so "100 S Bayl, Pensacola" prefers the
 * Pensacola street over a same-numbered street 500 miles away.
 */
function proximityScore(lat: number | undefined, lng: number | undefined): number {
  if (typeof lat !== 'number' || typeof lng !== 'number') return 0;
  const miles = distanceMiles(lat, lng);
  if (miles <= 25) return 35;
  if (miles <= 60) return 15;
  if (miles <= 120) return -15;
  return -40;
}

/**
 * Filters and ranks provider suggestions for the entered address parts.
 * `houseNumber` is the customer's typed house number, if any.
 */
export function rankSuggestions(
  rows: RawSuggestion[],
  location: SuggestionLocation,
  houseNumber: string | null,
): RankResult {
  const stateCode = (location.state ?? '').trim().toUpperCase();
  const hasStateFilter = Boolean(STATE_NAMES[stateCode]);
  const requestedZip = (location.zip ?? '').trim().match(/^(\d{5})/)?.[1] ?? null;
  const requestedCity = (location.city ?? '').trim().toLowerCase();
  const requestedStreet = (location.street ?? '').trim();

  const kept: RankedSuggestion[] = [];
  rows.forEach((row, providerIndex) => {
    const label = suggestionLabel(row);
    const haystack = `${row.name} ${row.context}`.toLowerCase();

    // State rule: when a state is selected, require a positive signal for that
    // state. Rows with no state signal at all are dropped (fail closed) so an
    // unrelated Atlanta/Georgia match can never answer a Florida search.
    if (hasStateFilter && !stateSignals(row).has(stateCode)) return;

    // ZIP rule: a conflicting ZIP is never displayed.
    const zip = suggestionZip(row);
    if (requestedZip && zip && zip !== requestedZip) return;

    // Street rule: the street must match on its distinctive tokens or route number.
    if (requestedStreet && !streetMatches(requestedStreet, `${row.name} ${row.context}`)) return;

    let score = 100 - providerIndex;
    const rowHouseNumber = suggestionHouseNumber(row);
    if (houseNumber && rowHouseNumber === houseNumber) score += 60;
    else if (houseNumber && rowHouseNumber && rowHouseNumber !== houseNumber) score -= 25;
    if (requestedZip && zip === requestedZip) score += 20;
    if (requestedCity && haystack.includes(requestedCity)) score += 15;
    if (row.kind === 'address') score += 10;
    score += proximityScore(row.lat, row.lng);

    kept.push({ ...row, label, score });
  });

  kept.sort((a, b) => b.score - a.score);
  return {
    ranked: kept,
    filteredOutAll: rows.length > 0 && kept.length === 0,
    needsLocation: rows.length > 0 && kept.length === 0 && !requestedCity && !requestedZip,
  };
}

/** Street-suffix abbreviations → the full USPS word, for QUERY expansion only. */
const SUFFIX_EXPANSIONS: Record<string, string> = {
  ln: 'Lane',
  rd: 'Road',
  st: 'Street',
  dr: 'Drive',
  ave: 'Avenue',
  blvd: 'Boulevard',
  ct: 'Court',
  cir: 'Circle',
  pl: 'Place',
  ter: 'Terrace',
  pkwy: 'Parkway',
  hwy: 'Highway',
  trl: 'Trail',
  expy: 'Expressway',
  fwy: 'Freeway',
  cr: 'County Road',
  hgwy: 'Highway',
};

/** Full street words → the common abbreviation, used as a fallback variant. */
const SUFFIX_ABBREVIATIONS: Record<string, string> = {
  lane: 'Ln',
  road: 'Rd',
  street: 'St',
  drive: 'Dr',
  avenue: 'Ave',
  boulevard: 'Blvd',
  court: 'Ct',
  circle: 'Cir',
  place: 'Pl',
  terrace: 'Ter',
  parkway: 'Pkwy',
  highway: 'Hwy',
  trail: 'Trl',
  expressway: 'Expy',
  freeway: 'Fwy',
};

const DIRECTION_EXPANSIONS: Record<string, string> = {
  n: 'North',
  s: 'South',
  e: 'East',
  w: 'West',
  ne: 'Northeast',
  nw: 'Northwest',
  se: 'Southeast',
  sw: 'Southwest',
};

/**
 * Rewrites street-suffix and direction abbreviations in their legitimate
 * positions. The suffix is only expanded when it is the FINAL token (the
 * street-suffix position), so "St Andrews Dr" keeps "St" (Saint) while
 * "123 Main St" becomes "123 Main Street". Directions are expanded except
 * when a lone direction is the entire entry.
 */
function expandStreetWords(street: string): string {
  const tokens = street.trim().split(/\s+/);
  return tokens
    .map((token, index) => {
      const bare = token.replace(/[.,]/g, '');
      const lower = bare.toLowerCase();
      const isLast = index === tokens.length - 1;
      if (isLast && index > 0 && SUFFIX_EXPANSIONS[lower] && !/\d/.test(lower)) {
        return SUFFIX_EXPANSIONS[lower];
      }
      if (DIRECTION_EXPANSIONS[lower] && tokens.length > 1 && !/\d/.test(lower)) {
        return DIRECTION_EXPANSIONS[lower];
      }
      return token;
    })
    .join(' ');
}

/** Replaces a full final suffix word with its common abbreviation. */
function abbreviateStreetSuffix(street: string): string {
  const tokens = street.trim().split(/\s+/);
  const last = tokens[tokens.length - 1] ?? '';
  const bare = last.replace(/[.,]/g, '').toLowerCase();
  if (tokens.length > 1 && SUFFIX_ABBREVIATIONS[bare]) {
    tokens[tokens.length - 1] = SUFFIX_ABBREVIATIONS[bare];
    return tokens.join(' ');
  }
  return street;
}

/** Removes a leading house number from a street line (street-level fallback). */
function stripHouseNumber(street: string): string {
  return street.replace(/^\d+[a-z]?(?:-\d+[a-z]?)?\s+/i, '').trim();
}

/** Maximum alternate provider queries attempted for one search. */
export const MAX_SUGGEST_VARIANTS = 4;

/**
 * Alternative query forms for the provider, in priority order:
 *  1. suffix/direction expansion (Maplewood Ln → Maplewood Lane, S → South);
 *  2. numbered-road expansion (Hwy 97 → Highway 97, SR 97 → State Road 97);
 *  3. suffix abbreviation (Maplewood Lane → Maplewood Ln) when the input already
 *     used the full word, for providers indexed by abbreviations;
 *  4. house-numberless street-level fallback (4242 Maplewood Ln → Maplewood
 *     Lane). Verified provider behavior: some house-number queries return
 *     nothing while the bare street resolves, so this turns a dead end into
 *     a credible street-level suggestion the customer can pin on the map.
 * The customer's original entry is never modified — these are only alternate
 * provider requests, and the caller stops at the first variant that returns
 * usable rows.
 */
export function suggestQueryVariants(street: string, city?: string): string[] {
  const original = street.trim();
  if (!original) return [];
  const withCity = (part: string) => (city ? `${part}, ${city}` : part);
  const forms: string[] = [];
  const add = (part: string) => {
    const value = part.trim();
    if (value && value !== original && !forms.includes(value)) forms.push(value);
  };

  const expanded = expandStreetWords(original);
  add(expanded);

  const roadExpanded = expanded
    .replace(/\b(hwy|hgwy)\b/gi, 'Highway')
    .replace(/\b(sr|state route)\b/gi, 'State Road')
    .replace(/\bfl\b[\s-]*(\d+)/gi, 'State Road $1')
    .replace(/\bcr\b[\s-]*(\d+)/gi, 'County Road $1');
  add(roadExpanded);

  add(abbreviateStreetSuffix(expanded));

  // Street-level forms only when a house number was typed; a bare street name
  // is never a substitute for a resolved property.
  if (stripHouseNumber(original) !== original) {
    add(stripHouseNumber(expanded));
    add(stripHouseNumber(roadExpanded));
    add(stripHouseNumber(original));
  }

  return forms.slice(0, MAX_SUGGEST_VARIANTS).map(withCity);
}
