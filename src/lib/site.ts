// Navigation + footer link data — one source for Header, Footer and scripts.

export interface NavItem {
  label: string;
  href: string;
}

/** Desktop primary navigation (keep short). */
export const primaryNav: NavItem[] = [
  { label: 'House Cleaning', href: '/house-cleaning/' },
  { label: 'Recurring', href: '/recurring-cleaning/' },
  { label: 'Deep Cleaning', href: '/deep-cleaning/' },
  { label: 'Rentals', href: '/short-term-rental-cleaning/' },
  { label: 'Commercial', href: '/commercial-cleaning/' },
];

/** Footer services column (includes the long-tail pages). */
export const footerServicesNav: NavItem[] = [
  { label: 'House Cleaning', href: '/house-cleaning/' },
  { label: 'Recurring Cleaning', href: '/recurring-cleaning/' },
  { label: 'Deep Cleaning', href: '/deep-cleaning/' },
  { label: 'Move-In / Move-Out', href: '/move-in-move-out-cleaning/' },
  { label: 'Short-Term Rental Turnovers', href: '/short-term-rental-cleaning/' },
  { label: 'Commercial Cleaning', href: '/commercial-cleaning/' },
  { label: 'Church Cleaning', href: '/church-cleaning/' },
];

export const footerCompanyNav: NavItem[] = [
  { label: 'About Us', href: '/about/' },
  { label: 'Service Area', href: '/service-area/' },
  { label: 'Get an Estimate', href: '/estimate/' },
  { label: 'Contact', href: '/contact/' },
  { label: 'FAQ', href: '/faq/' },
];

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
