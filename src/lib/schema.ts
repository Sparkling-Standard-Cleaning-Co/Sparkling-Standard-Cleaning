// Structured data helpers — JSON-LD nodes built ONLY from approved facts.
//
// Schema type decision (verified against schema.org, September 2026):
//   * `CleaningService` is NOT a valid schema.org type (schema.org/CleaningService
//     returns 404). Do not "upgrade" the type below to it.
//   * The most specific VALID type for this business is `LocalBusiness`.
//     `HomeAndConstructionBusiness` subtypes (HVACBusiness, Plumber, …) do not
//     describe cleaning, and no cleaning subtype exists.
//   * Service pages use the valid `Service` type.
// See docs/seo/SEO-STRATEGY.md for the full rationale.
//
// Rules:
//  - PENDING facts are omitted entirely (never placeholders in structured data).
//  - Never emit AggregateRating or Review markup without genuine, visible
//    reviews supplied by the owner.

import { business, isPending, siteName } from '../config/business';

type JsonLdNode = Record<string, unknown>;

function omitEmpty(node: JsonLdNode): JsonLdNode {
  const clean: JsonLdNode = {};
  for (const [key, value] of Object.entries(node)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value) && value.length === 0) continue;
    clean[key] = value;
  }
  return clean;
}

export function businessEntityId(site: URL): string {
  return new URL('/#business', site).href;
}

/** Global LocalBusiness entity rendered on every page. */
export function localBusinessNode(site: URL, socialUrls: string[]): JsonLdNode {
  const node: JsonLdNode = {
    '@context': 'https://schema.org',
    '@type': 'LocalBusiness',
    '@id': businessEntityId(site),
    name: siteName(),
    url: isPending(business.url) ? undefined : business.url,
    image: new URL('/brand/icon-512.png', site).href,
    logo: new URL('/brand/icon-512.png', site).href,
    priceRange: '$$',
    description: business.serviceArea.summary,
    slogan: 'The Details Are Our Standard.',
    telephone: isPending(business.phone) ? undefined : business.phone.e164,
    email: isPending(business.email) ? undefined : business.email,
    legalName: isPending(business.legalName) ? undefined : business.legalName,
    sameAs: socialUrls,
    openingHoursSpecification: [
      {
        '@type': 'OpeningHoursSpecification',
        dayOfWeek: [
          'Monday',
          'Tuesday',
          'Wednesday',
          'Thursday',
          'Friday',
          'Saturday',
          'Sunday',
        ],
        opens: business.hours.schema.opens,
        closes: business.hours.schema.closes,
      },
    ],
    areaServed: [
      { '@type': 'City', name: 'Pensacola' },
      { '@type': 'City', name: 'Cantonment' },
      { '@type': 'Text', name: business.serviceArea.surroundingLabel },
      { '@type': 'Text', name: business.serviceArea.alabamaLabel },
    ],
    paymentAccepted: [...business.payments.accepted, ...business.payments.alternate].join(', '),
    currenciesAccepted: 'USD',
  };
  return omitEmpty(node);
}

/** Service page node. */
export function serviceNode(input: {
  site: URL;
  name: string;
  description: string;
  path: string;
  serviceType: string;
}): JsonLdNode {
  return omitEmpty({
    '@context': 'https://schema.org',
    '@type': 'Service',
    name: input.name,
    description: input.description,
    serviceType: input.serviceType,
    url: new URL(input.path, input.site).href,
    provider: { '@id': businessEntityId(input.site) },
    areaServed: [
      { '@type': 'City', name: 'Pensacola' },
      { '@type': 'City', name: 'Cantonment' },
      { '@type': 'Text', name: business.serviceArea.surroundingLabel },
      { '@type': 'Text', name: business.serviceArea.alabamaLabel },
    ],
  });
}

export function breadcrumbNode(site: URL, trail: Array<{ name: string; path: string }>): JsonLdNode {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: trail.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.name,
      item: new URL(item.path, site).href,
    })),
  };
}

export function faqNode(entries: Array<{ question: string; answer: string }>): JsonLdNode {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: entries.map((entry) => ({
      '@type': 'Question',
      name: entry.question,
      acceptedAnswer: { '@type': 'Answer', text: entry.answer },
    })),
  };
}
