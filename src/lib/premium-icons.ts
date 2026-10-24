// Premium icon collection — type registry (owner-supplied artwork,
// 2026-10-24). The SVG assets live in src/assets/icons/premium/ and render
// through PremiumIcon.astro. This is the ONE registry for the premium
// collection; never add a competing icon system for these services/values.

export type PremiumIconName =
  | 'locally-owned'
  | 'flexible-scheduling'
  | 'christian-values'
  | 'competitive-pricing'
  | 'recurring-residential'
  | 'deep-cleaning'
  | 'move-in-move-out'
  | 'short-term-rental'
  | 'commercial-cleaning'
  | 'church-cleaning';

/** The service-icon slugs accepted by the services content schema. */
export const PREMIUM_SERVICE_ICONS = [
  'recurring-residential',
  'deep-cleaning',
  'move-in-move-out',
  'short-term-rental',
  'commercial-cleaning',
  'church-cleaning',
] as const;
