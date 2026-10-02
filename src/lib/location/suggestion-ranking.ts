// Suggestion filtering + ranking — geographically intelligent address search.
//
// Pure functions shared by the /api/geocode proxy and the unit tests.
//
// Rules:
//  - When a state is selected, ONLY suggestions that name that state are
//    displayed. Out-of-state and non-US results are never shown.
//  - A supplied ZIP hard-filters suggestions that carry a different ZIP.
//  - Street names must match on a distinctive token (or a numbered-road
//    match), handling Highway/Hwy/State Road/SR/FL-N route variations, so
//    "6360 Peppermill Lane" can never answer a "6360 Haupert Lane" search.
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

const STATE_NAMES: Record<string, string[]> = {
  FL: ['florida'],
  AL: ['alabama'],
};

/** Other US states/territories + common non-US regions, used to drop results
 *  that explicitly belong somewhere else. */
const OTHER_REGIONS = [
  'alabama', 'alaska', 'arizona', 'arkansas', 'california', 'colorado', 'connecticut', 'delaware',
  'district of columbia', 'florida', 'georgia', 'hawaii', 'idaho', 'illinois', 'indiana', 'iowa',
  'kansas', 'kentucky', 'louisiana', 'maine', 'maryland', 'massachusetts', 'michigan', 'minnesota',
  'mississippi', 'missouri', 'montana', 'nebraska', 'nevada', 'new hampshire', 'new jersey',
  'new mexico', 'new york', 'north carolina', 'north dakota', 'ohio', 'oklahoma', 'oregon',
  'pennsylvania', 'rhode island', 'south carolina', 'south dakota', 'tennessee', 'texas', 'utah',
  'vermont', 'virginia', 'washington', 'west virginia', 'wisconsin', 'wyoming',
  'canada', 'ontario', 'quebec', 'manitoba', 'alberta', 'british columbia', 'saskatchewan',
  'mexico', 'united kingdom', 'england', 'france', 'germany', 'pakistan', 'india', 'punjab',
];

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

/** True when a suggestion's street text plausibly matches the requested street. */
export function streetMatches(requestedStreet: string, candidateText: string): boolean {
  if (!requestedStreet.trim()) return true;
  const candidateTokens = new Set(normalizeStreetTokens(candidateText));
  const requestedDistinctive = distinctiveTokens(requestedStreet);
  if (requestedDistinctive.some((token) => candidateTokens.has(token))) return true;
  // Numbered roads: Highway 97 ≈ Hwy 97 ≈ SR 97 ≈ State Road 97.
  const requestedNumbers = routeNumbers(requestedStreet);
  if (requestedNumbers.some((number) => candidateTokens.has(number))) return true;
  return false;
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
 * Filters and ranks provider suggestions for the entered address parts.
 * `houseNumber` is the customer's typed house number, if any.
 */
export function rankSuggestions(
  rows: RawSuggestion[],
  location: SuggestionLocation,
  houseNumber: string | null,
): RankResult {
  const stateCode = (location.state ?? '').trim().toUpperCase();
  const stateNames = STATE_NAMES[stateCode] ?? [];
  const requestedZip = (location.zip ?? '').trim().match(/^(\d{5})/)?.[1] ?? null;
  const requestedCity = (location.city ?? '').trim().toLowerCase();
  const requestedStreet = (location.street ?? '').trim();

  const kept: RankedSuggestion[] = [];
  rows.forEach((row, providerIndex) => {
    const label = suggestionLabel(row);
    const haystack = `${row.name} ${row.context}`.toLowerCase();

    // State rule: when a state is selected, require that state by name and
    // reject anything naming a different region.
    if (stateNames.length > 0) {
      const namesSelectedState = stateNames.some((name) => haystack.includes(name));
      if (!namesSelectedState) return;
      const namesOther = OTHER_REGIONS.filter((name) => !stateNames.includes(name));
      // A row cannot name both; the selected-state check above already passed.
      if (namesOther.some((name) => haystack.includes(name))) return;
    }

    // ZIP rule: a conflicting ZIP is never displayed.
    const zip = suggestionZip(row);
    if (requestedZip && zip && zip !== requestedZip) return;

    // Street rule: the street must match on a distinctive token or route number.
    if (requestedStreet && !streetMatches(requestedStreet, `${row.name} ${row.context}`)) return;

    let score = 100 - providerIndex;
    const rowHouseNumber = suggestionHouseNumber(row);
    if (houseNumber && rowHouseNumber === houseNumber) score += 60;
    else if (houseNumber && rowHouseNumber && rowHouseNumber !== houseNumber) score -= 25;
    if (requestedZip && zip === requestedZip) score += 20;
    if (requestedCity && haystack.includes(requestedCity)) score += 15;
    if (row.kind === 'address') score += 10;

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

/**
 * Alternative query forms for the provider, in priority order:
 *  1. suffix/direction expansion (Haupert Ln → Haupert Lane, S → South);
 *  2. numbered-road expansion (Hwy 97 → Highway 97, SR 97 → State Road 97);
 *  3. suffix abbreviation (Haupert Lane → Haupert Ln) when the input already
 *     used the full word, for providers indexed by abbreviations.
 * The customer's original entry is never modified — these are only alternate
 * provider requests, and the caller stops at the first variant that returns
 * usable rows.
 */
export function suggestQueryVariants(street: string, city?: string): string[] {
  if (!street.trim()) return [];
  const withCity = (part: string) => (city ? `${part}, ${city}` : part);
  const variants: string[] = [];
  const add = (part: string) => {
    const value = withCity(part);
    if (part !== street.trim() && !variants.includes(value) && variants.length < 2) variants.push(value);
  };

  const expanded = expandStreetWords(street);
  add(expanded);

  const roadExpanded = expanded
    .replace(/\b(hwy|hgwy)\b/gi, 'Highway')
    .replace(/\b(sr|state route)\b/gi, 'State Road')
    .replace(/\bfl\b[\s-]*(\d+)/gi, 'State Road $1')
    .replace(/\bcr\b[\s-]*(\d+)/gi, 'County Road $1');
  add(roadExpanded);

  const abbreviated = abbreviateStreetSuffix(expanded);
  add(abbreviated);

  return variants;
}
