// ─────────────────────────────────────────────────────────────────────────────
// Central business configuration — SINGLE SOURCE OF TRUTH.
//
// Every business fact the website displays comes from this file (or from the
// approved copy it references). Components and pages import from here — never
// hard-code a phone number, email, name, price or claim anywhere else.
//
// ── THE NO-FABRICATION RULE ──────────────────────────────────────────────────
// Anything the owner has not confirmed is the literal string 'PENDING'.
// PENDING values render as honest placeholders in preview builds, are excluded
// from structured data and public claims, and BLOCK production deployment
// (scripts/validate-production-env.mjs + scripts/check-pending-facts.mjs).
//
// Never replace a PENDING value with a plausible-looking guess. Ever.
//
// Owner-fillable values can also be supplied through public environment
// variables (see .env.example) so the authoritative fact lives in one place
// even before this file is edited. Env values win when present.
// ─────────────────────────────────────────────────────────────────────────────

export const PENDING = 'PENDING' as const;
export type Pending = typeof PENDING;
/** A business fact that is either owner-approved or explicitly PENDING. */
export type Fact<T> = T | Pending;

export function isPending<T>(value: Fact<T>): value is Pending {
  return value === PENDING;
}

function envFact(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

// ── Phone ────────────────────────────────────────────────────────────────────
export interface Phone {
  /** Human display form, e.g. (850) 555-0123 */
  display: string;
  /** tel: href, e.g. tel:+18505550123 */
  href: string;
  /** sms: href */
  sms: string;
  /** E.164 for structured data, e.g. +18505550123 */
  e164: string;
}

/** Formats a US phone number. Returns null when the value is not a valid NANP number. */
export function formatPhone(raw: string | undefined): Phone | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, '');
  const national = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
  if (national.length !== 10 || national[0] === '0' || national[0] === '1') return null;
  const area = national.slice(0, 3);
  const prefix = national.slice(3, 6);
  const line = national.slice(6);
  return {
    display: `(${area}) ${prefix}-${line}`,
    href: `tel:+1${national}`,
    sms: `sms:+1${national}`,
    e164: `+1${national}`,
  };
}

const phoneEnv = formatPhone(envFact(import.meta.env.PUBLIC_BUSINESS_PHONE));

// ── Business entity ──────────────────────────────────────────────────────────
export const business = {
  /**
   * Final company name — owner-confirmed October 2026 (public brand:
   * "Sparkling Standard", with "Cleaning Co." as the descriptor).
   */
  displayName: envFact(import.meta.env.PUBLIC_BUSINESS_NAME) ?? 'Sparkling Standard Cleaning Co.',

  /**
   * Registered legal entity name. The owner has registered the business as
   * "Sparkling Standard Cleaning Co."; the precise legal spelling/entity
   * suffix is still being verified. Do not publish until confirmed.
   */
  legalName: envFact(import.meta.env.PUBLIC_BUSINESS_LEGAL_NAME) ?? PENDING,

  /** Production origin without trailing slash — owner-confirmed domain. */
  url: envFact(import.meta.env.PUBLIC_SITE_URL) ?? 'https://sparkling-standard.com',

  /** Public contact phone — owner-confirmed number. */
  phone: phoneEnv ?? formatPhone('850-246-8479') ?? PENDING,

  /** Public contact email — owner-confirmed address. */
  email: envFact(import.meta.env.PUBLIC_BUSINESS_EMAIL) ?? 'owner@sparkling-standard.com',

  // ── Founder (approved background from the owner's directive) ──────────────
  // Owner-approved for publication (October 2026). Never invent details.
  founder: {
    firstName: 'Hayli' as Fact<string>,
    /** Public role wording. */
    role: 'Founder & Owner-Operator',
    /** True: the business is currently owner-operated by the founder. */
    ownerOperated: true,
    /**
     * Approved public background facts (see directive §3). Copy built from
     * this list may be edited, but do not add numbers (years, home counts,
     * certifications) that the owner has not supplied.
     */
    approvedBackground: [
      'An 18-year-old college student who started the company to give customers the detailed attention rushed cleaning does not allow',
      'Started in residential cleaning and grew up around a grandmother who owned a cleaning business',
      'Worked with that family cleaning business, then for established local cleaning companies',
      'Worked directly with customers through every clean',
      'Performed quality inspection of cleaning work',
      'Saw how rushed production cleaning leaves the small things undone — and decided to build something better',
      'Studies interior design and plans to grow into related home services over time',
    ] as const,
    /** The core, approved founder story idea. */
    coreStory:
      'Customers deserved more detailed attention than the rushed production model she experienced elsewhere. This company exists to deliver cleaning where the small things are noticed.',
    /** Approved examples of the detail philosophy, for service/process copy. */
    detailExamples: [
      'Cleaning the toothbrush holder — the spot most people never think about',
      'Noticing fingerprints and buildup instead of working around them',
      'Addressing the neglected details that a quick clean skips',
      'Wiping surfaces when the situation calls for it, not just dusting them',
      'Treating your home with the care she would want in her own home',
    ] as const,
    /** Approved, modest faith/values statement. Do not expand beyond this. */
    faithStatement:
      'Faith shapes how our founder works: honestly, carefully, and with respect for the people and homes she serves. Everyone is welcome here — quality, respect and integrity are what matter most.',
  },

  // ── Hours (directive §8) ───────────────────────────────────────────────────
  hours: {
    /** Residential booking window. */
    residentialWindow: '8:00 AM – 6:00 PM',
    /** Availability. */
    days: 'Seven days a week',
    display: 'Seven days a week · 8:00 AM – 6:00 PM',
    /** Commercial work can be scheduled outside the residential window. */
    commercialNote:
      'Commercial accounts can be scheduled day or evening, including early-morning and overnight work when the facility needs it.',
    /** Scheduling honesty: first appointment of the day gets an exact arrival time. */
    firstAppointmentNote:
      'The first appointment of the day is scheduled for an exact arrival time.',
    arrivalWindowNote:
      'Later appointments use an arrival window — a home takes as long as it takes, and we will not rush yours to hit a clock.',
    timezone: 'America/Chicago',
    schema: { opens: '08:00', closes: '18:00' },
  },

  // ── Service area (directive §9 — approved broad language only) ────────────
  serviceArea: {
    /** The one approved public description. */
    summary:
      'Serving Pensacola, Cantonment and surrounding communities within about an hour of Cantonment, with select nearby service into Alabama.',
    /** Approved primary communities (no radius claims until approved). */
    primaryCommunities: ['Pensacola', 'Cantonment'],
    /** Approved broad region labels for structured data / copy. */
    surroundingLabel: 'Surrounding Pensacola-area communities',
    alabamaLabel: 'Select nearby areas into Alabama',
    /** The exact base/operating origin is PENDING (directive §31). */
    operatingOrigin: PENDING as Fact<string>,
  },

  // ── Social + review profiles — ALL PENDING until real URLs exist ──────────
  socials: {
    facebook: PENDING as Fact<string>,
    instagram: PENDING as Fact<string>,
    tiktok: PENDING as Fact<string>,
    youtube: PENDING as Fact<string>,
    nextdoor: PENDING as Fact<string>,
    googleProfile: PENDING as Fact<string>,
    linkedin: PENDING as Fact<string>,
  },
  reviews: {
    /** Link that READS existing reviews. PENDING until a profile exists. */
    profileUrl: PENDING as Fact<string>,
    /** Direct review-submission link (future QR destination). PENDING. */
    submissionUrl: PENDING as Fact<string>,
    /**
     * No review counts are ever displayed unless the owner supplies a verified
     * figure AND real reviews exist in the reviews collection. Never invent.
     */
  },

  // ── Payments (owner-approved methods; processor is PENDING) ───────────────
  payments: {
    /** Emphasized professional methods. */
    accepted: [
      'Major credit and debit cards',
      'Apple Pay',
      'Google Pay',
      'ACH bank transfer',
    ],
    /** Documented selectively, not as a logo wall. */
    alternate: ['Cash', 'Check', 'Cash App', 'Venmo', 'Zelle', 'PayPal'],
    /** Residential payment timing, owner-approved. */
    residentialTiming:
      'Payment is due after the cleaning is complete — you see the result before you pay.',
    /** Owner-confirmed processor. Enabled methods are confirmed separately. */
    processor: 'Stripe',
  },

  // ── Insurance / licensing (never claimed until approved) ──────────────────
  insurance: PENDING as Fact<string>,
  bonding: PENDING as Fact<string>,
  licenses: PENDING as Fact<string>,

  // ── Products / supplies philosophy (directive §59) ────────────────────────
  products: {
    summary: 'We normally bring our own professional supplies.',
    preferenceNote:
      'Product preferences? Let us know. We can accommodate many customer-supplied or lower-toxicity cleaning preferences.',
  },

  // ── Analytics — public client identifiers; empty disables the integration ─
  analytics: {
    /** Umami Cloud — cookieless aggregate analytics. */
    umami: {
      websiteId: envFact(import.meta.env.PUBLIC_UMAMI_WEBSITE_ID) ?? '',
    },
    /** GTM container (GA4 configured inside; gtag.js is never loaded directly). */
    gtm: {
      containerId: envFact(import.meta.env.PUBLIC_GTM_CONTAINER_ID) ?? '',
    },
    /**
     * Consent state storage key. Analytics (both services) load only after an
     * explicit analytics consent choice; advertising consent is never granted
     * by the site (see ConsentBanner.astro and src/lib/analytics/).
     */
    consentStorageKey: 'pcc-consent-v1',
  },

  // ── Forms ──────────────────────────────────────────────────────────────────
  forms: {
    /** Web3Forms public (client-safe) access key. Empty = honest fallback UI. */
    web3formsAccessKey: envFact(import.meta.env.PUBLIC_WEB3FORMS_ACCESS_KEY) ?? '',
    web3formsEndpoint: 'https://api.web3forms.com/submit',
    /**
     * Preferred submission path when deployed with Cloudflare functions:
     * POST /api/lead performs server-side validation + spam checks before
     * forwarding. The client falls back to a direct provider submission when
     * the function is unavailable (local preview/static hosting) and the
     * public key is configured.
     */
    serverSubmitPath: '/api/lead',
    /**
     * Cloudflare Turnstile site key — public by design (it is rendered into
     * the page). The matching secret lives ONLY in the serverless function
     * environment (TURNSTILE_SECRET_KEY read by functions/api/lead.ts) and is
     * never imported here, so it can never reach a client bundle.
     */
    turnstileSiteKey: envFact(import.meta.env.PUBLIC_TURNSTILE_SITE_KEY) ?? '',
  },

  // ── Feature flags ──────────────────────────────────────────────────────────
  flags: {
    /**
     * Publish provisional add-on prices publicly. FALSE by design: provisional
     * pricing is internal until the owner approves it (directive §19).
     */
    publishProvisionalAddonPricing: false,
    /**
     * Publish the emergency/booking confirmation promise. FALSE until a
     * legitimate backend confirms bookings; the site only takes REQUESTS.
     */
    instantBooking: false,
    /**
     * Text-message CTAs. FALSE until the owner confirms the business number
     * can receive SMS — a number being mobile-style is not proof. Flip only
     * after a real text has been sent and received.
     */
    smsEnabled: false,
    /** Reviews section/nav visibility is automatic once genuine entries exist. */
    reviewsVisibleWhenPresent: true,
  },

  // ── Launch status ──────────────────────────────────────────────────────────
  launch: {
    /** Flipped to true by the owner only after every blocker in
     *  docs/launch/OWNER-INPUT-REQUIRED.md is resolved and verified. */
    productionApproved: false,
    /** Business is in immediate launch mode; preview is noindexed. */
    status: 'pre-launch' as const,
  },
};

// ── Convenience helpers (keep PENDING handling consistent everywhere) ────────

export function isFormEnabled(): boolean {
  return Boolean(business.forms.web3formsAccessKey) || business.forms.turnstileSiteKey !== '';
}

export function hasContactPhone(): boolean {
  return !isPending(business.phone);
}

/** The approved phone fact, or null while PENDING (never a placeholder link). */
export function contactPhone(): Phone | null {
  return isPending(business.phone) ? null : business.phone;
}

export function hasEmail(): boolean {
  return !isPending(business.email);
}

/** Safe display name for components: the approved name or the dev placeholder. */
export function displayName(): string {
  return isPending(business.displayName) ? 'PENDING_BUSINESS_NAME' : business.displayName;
}

/** Human site name used in titles and schema; placeholder in preview only. */
export function siteName(): string {
  return isPending(business.displayName) ? 'PENDING_BUSINESS_NAME' : business.displayName;
}

/** Confirmed public profile URLs only (PENDING values filtered out). */
export function socialUrls(): string[] {
  return Object.values(business.socials).filter(
    (value): value is string => typeof value === 'string' && value.length > 0 && value !== PENDING,
  );
}
