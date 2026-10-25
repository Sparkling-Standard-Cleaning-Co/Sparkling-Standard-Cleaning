// Navigation + footer link data — one source for Header, Footer and scripts.

export interface NavItem {
  label: string;
  href: string;
  children?: NavItem[];
}

/**
 * The cleaning categories shown in the desktop "Types of Cleanings" dropdown
 * and the footer services column, in the owner-approved order. Church
 * Cleaning is a legitimate offering and appears here (Sparkling Standard 4.0
 * §3B). The homepage renders all six core service cards — see the explicit
 * path list below and src/pages/index.astro.
 */
export const cleaningTypesNav: NavItem[] = [
  { label: 'Recurring Residential Cleaning', href: '/recurring-cleaning/' },
  { label: 'Deep Cleaning', href: '/deep-cleaning/' },
  { label: 'Move-in and Move-out Cleaning', href: '/move-in-move-out-cleaning/' },
  { label: 'Supportive Home Cleaning', href: '/supportive-home-cleaning/' },
  { label: 'Short-term Rental Turnover Cleaning', href: '/short-term-rental-cleaning/' },
  { label: 'Commercial Cleaning', href: '/commercial-cleaning/' },
  { label: 'Church Cleaning', href: '/church-cleaning/' },
];

/**
 * Paths that render as homepage service cards, in owner-approved order.
 * Church Cleaning is a core service and renders as the sixth card.
 */
export const homepageServicePaths: string[] = [
  '/recurring-cleaning/',
  '/deep-cleaning/',
  '/move-in-move-out-cleaning/',
  '/short-term-rental-cleaning/',
  '/commercial-cleaning/',
  '/church-cleaning/',
];

/** Desktop primary navigation: the Types of Cleanings dropdown plus About. */
export const primaryNav: NavItem[] = [
  {
    label: 'Types of Cleanings',
    href: '/recurring-cleaning/',
    children: cleaningTypesNav,
  },
  { label: 'About', href: '/about/' },
];

/**
 * Mobile navigation hierarchy (directive §6): a bold "Cleaning Services" group
 * with every service, then top-level pages. Labels are mobile-tuned display
 * names; hrefs always point at the canonical owning pages. House Cleaning is
 * NOT a standalone offering (owner directive, 2026-10-24): residential
 * cleaning lives in Recurring Residential Cleaning and Deep Cleaning.
 */
export const mobileCleaningNav: NavItem[] = [
  { label: 'Recurring Cleaning', href: '/recurring-cleaning/' },
  { label: 'Deep Cleaning', href: '/deep-cleaning/' },
  { label: 'Move-In / Move-Out', href: '/move-in-move-out-cleaning/' },
  { label: 'Supportive Home Cleaning', href: '/supportive-home-cleaning/' },
  { label: 'Vacation Rental Turnovers', href: '/short-term-rental-cleaning/' },
  { label: 'Commercial Cleaning', href: '/commercial-cleaning/' },
  { label: 'Church Cleaning', href: '/church-cleaning/' },
];

export const mobileTopNav: NavItem[] = [
  { label: 'Service Area', href: '/service-area/' },
  { label: 'Reviews', href: '/#reviews' },
  { label: 'About', href: '/about/' },
  { label: 'Contact', href: '/contact/' },
];

/** Footer services column — every service category, including Supportive Home. */
export const footerServicesNav: NavItem[] = [...cleaningTypesNav];

export const footerCompanyNav: NavItem[] = [
  { label: 'About Us', href: '/about/' },
  { label: 'Service Area', href: '/service-area/' },
  { label: 'Get an Estimate', href: '/estimate/' },
  { label: 'FAQ', href: '/faq/' },
  { label: 'Privacy Policy', href: '/privacy/' },
  { label: 'Terms of Service', href: '/terms/' },
];

/** Kept for scripts that reference the historical footer resources list. */
export const footerResourcesNav: NavItem[] = [
  { label: 'Instant Estimate', href: '/estimate/' },
  { label: 'Privacy Policy', href: '/privacy/' },
  { label: 'Terms of Service', href: '/terms/' },
];

/** All internal page paths — used by scripts/links.mjs expectations. */
export const publicPaths: string[] = [
  '/',
  '/house-cleaning/',
  '/recurring-cleaning/',
  '/deep-cleaning/',
  '/move-in-move-out-cleaning/',
  '/short-term-rental-cleaning/',
  '/commercial-cleaning/',
  '/church-cleaning/',
  '/supportive-home-cleaning/',
  '/estimate/',
  '/estimate/residential/',
  '/estimate/str/',
  '/estimate/commercial/',
  '/estimate/church/',
  '/about/',
  '/service-area/',
  '/contact/',
  '/faq/',
  '/privacy/',
  '/terms/',
  '/thank-you/',
];
