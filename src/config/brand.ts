// ─────────────────────────────────────────────────────────────────────────────
// Shared brand mark — SINGLE SOURCE for the crest artwork, wordmark words and
// the print palette. Imported by the site header/footer (Logo.astro) and by the
// physical print system (scripts/print/). Business FACTS stay in business.ts;
// this module holds only the mark's geometry and words so the site and print
// can never drift apart.
//
// The crest uses design-token CSS variables so it inherits the site palette;
// the print system defines the same variables from `printPalette` below.
// ─────────────────────────────────────────────────────────────────────────────

/** Wordmark words. `caps` is the source casing; the site uppercases via CSS. */
export const brandWords = {
  script: 'Sparkling',
  caps: 'Standard',
  capsDisplay: 'STANDARD',
  descriptor: 'Cleaning Co.',
  tagline: 'The Details Are Our Standard.',
} as const;

/** Exact token values used by the print system (verified against tokens.css). */
export const printPalette = {
  cream50: '#fdfbf8',
  cream100: '#f9f3ed',
  cream200: '#f1e7dd',
  sand300: '#e4d5c7',
  sand400: '#cdb9a8',
  taupe500: '#8c7a70',
  taupe600: '#6f5f57',
  ink700: '#4a3b40',
  ink800: '#3d3036',
  ink900: '#302429',
  rose100: '#f9e6e9',
  rose300: '#e8b3bf',
  rose500: '#c97285',
  rose600: '#b15a6f',
  rose700: '#93475b',
  champagne100: '#f7efdf',
  champagne300: '#e3cda4',
  champagne500: '#c6a369',
  champagne700: '#8a6d38',
} as const;

/** Gold gradient stops used by the crest. */
export const crestGradient = {
  light: '#e2c07c',
  mid: '#c6a369',
  dark: '#9d7736',
} as const;

/**
 * The approved crest SVG (gold ring, italic S, sparkles, blossom). The caller
 * supplies a unique gradient id so multiple instances on one page are safe.
 */
export function crestSvg(gradientId: string): string {
  return `<svg viewBox="0 0 64 64" focusable="false" aria-hidden="true">
  <defs>
    <linearGradient id="${gradientId}" x1="0" y1="0" x2="0.85" y2="1">
      <stop offset="0" stop-color="${crestGradient.light}"></stop>
      <stop offset="0.55" stop-color="${crestGradient.mid}"></stop>
      <stop offset="1" stop-color="${crestGradient.dark}"></stop>
    </linearGradient>
  </defs>
  <g fill="none" stroke="url(#${gradientId})">
    <circle cx="32" cy="32" r="26.5" stroke-width="1.5"></circle>
    <path d="M24.6 55.4c-6.1-2.5-11-7.4-13.4-13.6" stroke-width="3.4" stroke-linecap="round"></path>
  </g>
  <g fill="url(#${gradientId})">
    <path d="M17.5 9.5 19 15l5.5 1.5L19 18l-1.5 5.5L16 18l-5.5-1.5L16 15z"></path>
    <path d="M12.5 22.5 13.4 26l3.6.9-3.6.9-.9 3.6-.9-3.6-3.6-.9 3.6-.9z"></path>
    <path d="M50.5 16.5 52 22l5.5 1.5L52 25l-1.5 5.5L49 25l-5.5-1.5L49 22z"></path>
  </g>
  <text x="33.5" y="43.5" text-anchor="middle" font-family="Fraunces, Georgia, serif" font-style="italic" font-weight="600" font-size="34" fill="url(#${gradientId})">S</text>
  <g>
    <circle cx="47.2" cy="46.6" r="2.9" fill="var(--color-rose-300)"></circle>
    <circle cx="51.9" cy="50.3" r="2.9" fill="var(--color-rose-500)"></circle>
    <circle cx="49.6" cy="55.8" r="2.9" fill="var(--color-rose-300)"></circle>
    <circle cx="43.9" cy="55.6" r="2.9" fill="var(--color-rose-500)"></circle>
    <circle cx="41.7" cy="50.1" r="2.9" fill="var(--color-rose-300)"></circle>
    <circle cx="46.9" cy="51.4" r="2.4" fill="var(--color-champagne-500)"></circle>
  </g>
</svg>`;
}
