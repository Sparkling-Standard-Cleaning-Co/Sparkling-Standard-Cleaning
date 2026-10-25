// White-tile premium icon registry — owner-supplied artwork, 2026-10-25.
// The optimized WebP tiles live in src/assets/icons/white-tile/ and render
// through PremiumIcon.astro. This is the ONE registry for the collection;
// never add a competing icon system for these services, values, community
// groups or review calls to action.

export type PremiumIconName =
  | 'recurring-residential'
  | 'deep-cleaning'
  | 'move-in-move-out'
  | 'short-term-rental'
  | 'commercial-cleaning'
  | 'church-cleaning'
  | 'community-support'
  | 'read-reviews'
  | 'locally-owned'
  | 'christian-values'
  | 'flexible-scheduling'
  | 'competitive-pricing'
  | 'seniors'
  | 'first-responders'
  | 'military-veterans'
  | 'disability-support'
  | 'other-community';

/** The service-icon slugs accepted by the services content schema. */
export const PREMIUM_SERVICE_ICONS = [
  'recurring-residential',
  'deep-cleaning',
  'move-in-move-out',
  'short-term-rental',
  'commercial-cleaning',
  'church-cleaning',
] as const;
