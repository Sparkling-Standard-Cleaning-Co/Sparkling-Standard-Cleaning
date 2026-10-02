import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

// ─────────────────────────────────────────────────────────────────────────────
// Content collections. Zod-validated: a bad frontmatter value fails the build
// with a clear error instead of publishing nonsense.
//
// Business FACTS (phone, email, hours, pricing, service area) never live here —
// they come from src/config/business.ts and src/config/pricing.ts.
// ─────────────────────────────────────────────────────────────────────────────

const iconEnum = z.enum([
  'home',
  'refresh',
  'star',
  'box',
  'key',
  'briefcase',
  'church',
  'leaf',
  'shield',
  'heart',
  'clipboard',
  'camera',
  'clock',
  'map-pin',
  'users',
  'card',
  'droplet',
  'paw',
]);

// Service pages (src/content/services/*.md) — one owning page per query cluster.
const services = defineCollection({
  loader: glob({ pattern: '*.md', base: './src/content/services' }),
  schema: z.object({
    title: z.string(),
    metaTitle: z.string().optional(),
    metaDescription: z.string(),
    summary: z.string(),
    icon: iconEnum,
    order: z.number().int(),
    /** Public top-level path this service owns (trailing slash). */
    path: z.string().regex(/^\/[a-z0-9-]+\/$/),
    /** schema.org Service.serviceType value (plain descriptive string). */
    serviceType: z.string(),
    heroEyebrow: z.string().optional(),
    heroLead: z.string(),
    /** Marketing-safe list of what is normally included (checked against the checklist). */
    includes: z.array(z.string()).default([]),
    /** Valid uses of this service, honestly scoped. */
    goodFor: z.array(z.string()).default([]),
    /** What this service deliberately does not cover. */
    notIncluded: z.array(z.string()).default([]),
    /** FAQ ids from the faqs collection shown on this page. */
    faqIds: z.array(z.string()).default([]),
    /** Related service paths. */
    related: z.array(z.string()).default([]),
    /** Primary CTA label (href is always /estimate/ unless set). */
    ctaLabel: z.string().default('Get Instant Estimate'),
    ctaHref: z.string().default('/estimate/'),
    /** Slug of the matching checklist entry (src/content/checklists/*.md). */
    checklistId: z.string().optional(),
    /**
     * Embed a dedicated request form on the page (commercial walkthrough or
     * STR turnover). Renders in a section whose id matches the CTA target.
     */
    embedForm: z.enum(['commercial', 'str']).optional(),
  }),
});

// FAQs (src/content/faqs/*.md)
const faqs = defineCollection({
  loader: glob({ pattern: '*.md', base: './src/content/faqs' }),
  schema: z.object({
    question: z.string(),
    answer: z.string(),
    category: z.enum([
      'pricing',
      'process',
      'service-area',
      'recurring',
      'deep-cleaning',
      'move-cleaning',
      'str',
      'commercial',
      'pets',
      'payments',
      'policies',
      'products',
      'exclusions',
    ]),
    order: z.number().int().default(99),
  }),
});

// Cleaning checklists (src/content/checklists/*.md).
// visibility 'internal' entries are operational documentation ONLY and are
// never rendered on the public site (enforced by scripts/validate-site.mjs).
const checklists = defineCollection({
  loader: glob({ pattern: '*.md', base: './src/content/checklists' }),
  schema: z.object({
    title: z.string(),
    service: z.enum([
      'standard',
      'deep',
      'move_in_out',
      'str_turnover',
      'commercial',
      'church',
      'recurring',
    ]),
    visibility: z.enum(['public', 'internal']),
    items: z.array(z.string()).default([]),
    /** Short honest note shown under the public checklist. */
    note: z.string().optional(),
    order: z.number().int().default(99),
  }),
});

// Detail proof — REAL before/after work only (directive §41). EMPTY by design
// until the owner supplies genuine photos with permission (directive §77).
const proof = defineCollection({
  loader: glob({ pattern: '*.md', base: './src/content/proof' }),
  schema: ({ image }) =>
    z.object({
      title: z.string(),
      summary: z.string(),
      category: z.enum([
        'baseboard-detail',
        'bathroom',
        'kitchen',
        'turnover',
        'move-out',
        'small-fixture',
        'before-after',
        'checklist',
        'other',
      ]),
      photos: z
        .array(
          z.object({
            image: image(),
            alt: z.string(),
            label: z.enum(['before', 'after', 'during', 'detail']).default('detail'),
            position: z.string().optional(),
          }),
        )
        .default([]),
      order: z.number().int().default(99),
    }),
});

// Customer reviews — EMPTY by design until genuine owner-supplied reviews
// exist. Never fabricate (directive §56, §77).
const reviews = defineCollection({
  loader: glob({ pattern: '*.md', base: './src/content/reviews' }),
  schema: z.object({
    quote: z.string(),
    author: z.string(),
    context: z.string().optional(),
    source: z.enum(['google', 'direct', 'other']).default('direct'),
    order: z.number().int().default(99),
  }),
});

// Editable page copy (src/content/site/*.md) — one entry per page.
// Business facts still come from config; only copy lives here.
const heroSchema = z.object({
  headline: z.string().optional(),
  accent: z.string().optional(),
  tail: z.string().optional(),
  lead: z.string(),
  ctaLabel: z.string().optional(),
});

const sectionSchema = z.object({
  id: z.string().optional(),
  eyebrow: z.string().optional(),
  heading: z.string(),
  lead: z.string().optional(),
  paragraphs: z.array(z.string()).default([]),
  items: z
    .array(z.object({ title: z.string(), text: z.string() }))
    .default([]),
});

const site = defineCollection({
  loader: glob({ pattern: '*.md', base: './src/content/site' }),
  schema: z.object({
    metaTitle: z.string(),
    metaDescription: z.string(),
    hero: heroSchema,

    // Home
    servicesIntro: z
      .object({ eyebrow: z.string(), heading: z.string(), lead: z.string().optional() })
      .optional(),
    recurringPlans: z
      .object({
        eyebrow: z.string(),
        heading: z.string(),
        text: z.string(),
        linkLabel: z.string(),
        items: z
          .array(
            z.object({
              title: z.string(),
              frequency: z.enum(['weekly', 'biweekly', 'monthly']),
              text: z.string(),
            }),
          )
          .default([]),
      })
      .optional(),
    founderBand: z
      .object({
        eyebrow: z.string(),
        heading: z.string(),
        paragraphs: z.array(z.string()),
        linkLabel: z.string().optional(),
      })
      .optional(),
    estimateBand: z
      .object({ eyebrow: z.string(), heading: z.string(), text: z.string(), ctaLabel: z.string() })
      .optional(),
    recurringBand: z
      .object({ eyebrow: z.string(), heading: z.string(), text: z.string(), linkLabel: z.string() })
      .optional(),
    strBand: z
      .object({ eyebrow: z.string(), heading: z.string(), text: z.string(), linkLabel: z.string() })
      .optional(),
    moveoutBand: z
      .object({ eyebrow: z.string(), heading: z.string(), text: z.string(), linkLabel: z.string() })
      .optional(),
    commercialBand: z
      .object({ eyebrow: z.string(), heading: z.string(), text: z.string(), linkLabel: z.string() })
      .optional(),
    proof: z
      .object({ eyebrow: z.string(), heading: z.string(), lead: z.string() })
      .optional(),
    process: z
      .object({
        eyebrow: z.string(),
        heading: z.string(),
        steps: z.array(z.object({ title: z.string(), text: z.string() })).default([]),
      })
      .optional(),
    areaBand: z
      .object({ eyebrow: z.string(), heading: z.string(), text: z.string() })
      .optional(),
    finalCta: z
      .object({ heading: z.string(), text: z.string().optional() })
      .optional(),

    // About
    sections: z.array(sectionSchema).default([]),
    infoTitles: z
      .object({ call: z.string(), hours: z.string(), area: z.string(), values: z.string() })
      .optional(),

    // Contact
    waysHeading: z.string().optional(),
    formHeading: z.string().optional(),
    contactNote: z.string().optional(),

    // Service area
    communities: z
      .object({ heading: z.string(), lead: z.string(), list: z.array(z.string()) })
      .optional(),
    beyond: z.object({ heading: z.string(), text: z.string() }).optional(),
    coverageNote: z.string().optional(),

    // Estimate page
    steps: z.array(z.object({ title: z.string(), text: z.string() })).default([]),
    estimateNote: z.string().optional(),
    estimateFaqIds: z.array(z.string()).default([]),

    // Service page shared section labels (optional overrides)
    scopeHeading: z.string().optional(),
    notIncludedHeading: z.string().optional(),
    faqHeading: z.string().optional(),

    ctaBand: z
      .object({ heading: z.string(), text: z.string().optional(), label: z.string().optional() })
      .optional(),
  }),
});

export const collections = { services, faqs, checklists, proof, reviews, site };
