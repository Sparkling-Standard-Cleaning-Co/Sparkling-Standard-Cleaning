// Pure helpers for the built-site SEO validator (scripts/verify-seo.mjs).
// Kept dependency-free and separately testable — regression tests live in
// tests/seo-checks.test.ts (Initiative 5.0, Phase 1.3).

export interface RobotsDirectives {
  /** Lowercased directive tokens in document order. */
  directives: string[];
  /** Effective noindex (Google applies the most restrictive directive:
   *  `noindex` beats `index`; `none` means noindex,nofollow). */
  noindex: boolean;
  /** Effective nofollow. */
  nofollow: boolean;
}

/**
 * Parse a robots meta content value into directives.
 * Handles commas, semicolons, whitespace, mixed case, repeated directives and
 * conflicting groups (the most restrictive rule wins, matching Google's
 * documented behavior for index/noindex conflicts).
 */
export function parseRobotsContent(content: string): RobotsDirectives {
  const directives = content
    .toLowerCase()
    .split(/[,;]/)
    .flatMap((part) => part.trim().split(/\s+/))
    .filter((token) => token.length > 0);

  const tokens = new Set(directives);
  return {
    directives,
    noindex: tokens.has('noindex') || tokens.has('none'),
    nofollow: tokens.has('nofollow') || tokens.has('none'),
  };
}

/**
 * True when a robots meta value prevents indexing.
 * Regression note: the previous validator used `content.includes('index')`,
 * which incorrectly accepted `noindex` (Initiative 5.0 §4.3).
 */
export function isEffectivelyNoindex(content: string): boolean {
  return parseRobotsContent(content).noindex;
}

/** True when the value explicitly allows indexing (used for diagnostics). */
export function isEffectivelyIndexable(content: string): boolean {
  return !isEffectivelyNoindex(content);
}

/** Normalize a configured site origin (tolerates a trailing slash). */
export function normalizeOrigin(value: string, fallback = 'https://sparkling-standard.com'): string {
  const source = value.trim() === '' ? fallback : value.trim();
  return source.replace(/\/+$/, '');
}

/** Extract the scheme+host origin of an absolute URL, or null. */
export function originOf(url: string): string | null {
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return null;
  }
}
