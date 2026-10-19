// Navigation + footer link data — one source for Header, Footer and scripts.

export interface NavItem {
  label: string;
  href: string;
  children?: NavItem[];
}

/** The five primary cleaning categories, in the owner-approved order. */
export const cleaningTypesNav: NavItem[] = [
  { label: 'Recurring Residential Cleaning', href: '/recurring-cleaning/' },
  { label: 'Deep Cleaning', href: '/deep-cleaning/' },
  { label: 'Move-in and Move-out Cleaning', href: '/move-in-move-out-cleaning/' },
  { label: 'Short-term Rental Turnover Cleaning', href: '/short-term-rental-cleaning/' },
  { label: 'Commercial Cleaning', href: '/commercial-cleaning/' },
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

/** Footer services column — the five primary categories plus the supporting pages. */
export const footerServicesNav: NavItem[] = [
  ...cleaningTypesNav,
  { label: 'House Cleaning', href: '/house-cleaning/' },
  { label: 'Church Cleaning', href: '/church-cleaning/' },
];

export const footerCompanyNav: NavItem[] = [
  { label: 'About Us', href: '/about/' },
  { label: 'Service Area', href: '/service-area/' },
  { label: 'Get an Estimate', href: '/estimate/' },
  { label: 'Contact', href: '/contact/' },
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
  '/estimate/',
  '/about/',
  '/service-area/',
  '/contact/',
  '/faq/',
  '/privacy/',
  '/terms/',
  '/thank-you/',
];
