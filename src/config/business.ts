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

import { schedulingConfig } from './scheduling.ts';

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
   * Public business name — owner-confirmed October 21, 2026. The brand is
   * "Sparkling Standard"; the former descriptor is discontinued.
   */
  displayName: envFact(import.meta.env.PUBLIC_BUSINESS_NAME) ?? 'Sparkling Standard',

  /** Short public wordmark (site header and footer). */
  wordmark: 'Sparkling Standard',

  /**
   * Registered legal entity name — owner-confirmed October 21, 2026.
   * Retained for contracts, tax documents, formal disclosures and schema;
   * not displayed as marketing copy.
   */
  legalName:
    envFact(import.meta.env.PUBLIC_BUSINESS_LEGAL_NAME) ?? 'Sparkling Standard LLC',

  /** Production origin without trailing slash — owner-confirmed domain. */
  url: envFact(import.meta.env.PUBLIC_SITE_URL) ?? 'https://sparkling-standard.com',

  /**
   * Public contact phone — owner-confirmed number.
   * Corrected 2026-10-02: the previously published (850) 246-8479 was a typo.
   * The owner-confirmed number is (850) 426-8479. The PUBLIC_BUSINESS_PHONE
   * environment override, when set, must also carry the corrected digits.
   */
  phone: phoneEnv ?? formatPhone('850-426-8479') ?? PENDING,

  /** Public contact email — owner-confirmed address. */
  email: envFact(import.meta.env.PUBLIC_BUSINESS_EMAIL) ?? 'owner@sparkling-standard.com',

  // ── Founder (approved background from the owner's directive) ──────────────
  // Owner-approved for publication (October 2026). Never invent details.
  founder: {
    firstName: 'Hayli' as Fact<string>,
    /** Public role wording (owner revision, 2026-10-23 audit). */
    role: 'Founder / Owner-Operator',
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
    residentialWindow: '7:00 a.m. – 7:00 p.m.',
    /** Availability. */
    days: 'Seven days a week',
    display: 'Seven days a week · 7:00 a.m. – 7:00 p.m.',
    /** Commercial work is scheduled within the same published hours. */
    commercialNote:
      'Commercial accounts are scheduled within our published hours, with the exact timing agreed during the walkthrough.',
    /** Scheduling honesty: first appointment of the day gets an exact arrival time. */
    firstAppointmentNote:
      'The first appointment of the day is scheduled for an exact arrival time.',
    arrivalWindowNote:
      'Later appointments use an arrival window — a home takes as long as it takes, and we will not rush yours to hit a clock.',
    timezone: 'America/Chicago',
    schema: { opens: '07:00', closes: '19:00' },
  },

  // ── Reservation scheduling (advance requests, no priority pricing) ────────
  // Single source shared with the Pages Functions via src/config/scheduling.ts.
  scheduling: {
    /** Customers may request a preferred date up to this many days ahead. */
    advanceReservationDays: schedulingConfig.advanceReservationDays,
    /** Requests never confirm an appointment by themselves. */
    statuses: [
      'request_received',
      'availability_confirmation',
      'appointment_confirmed',
      'completed',
      'rescheduled',
      'canceled',
    ] as const,
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

  // ── Social profiles — ONLY confirmed, owner-supplied URLs ─────────────────
  // Confirmed 2026-10-02 (owner): Facebook + Nextdoor. Confirmed 2026-10-03
  // (owner-supplied, reachable; not independently authenticated): TikTok,
  // Pinterest, Rumble, Gab, Parler and Locals. Google Business Profile is
  // VERIFIED and its public profile URL was supplied by the owner
  // (2026-10-08); use the exact URL — never modify, shorten or reconstruct it.
  // Owner-confirmed active 2026-10-27: Instagram, YouTube and X. Use the exact
  // supplied URLs. The remaining platforms stay PENDING until the owner
  // supplies a real profile URL; the Follow Us section never renders a PENDING
  // platform and never invents a handle. Adding a platform later means editing
  // only this block (the platform register is docs/marketing/PLATFORM-REGISTER.md).
  socials: {
    // Local discovery — exact owner-supplied Google Business Profile URL.
    googleProfile:
      'https://www.google.com/search?kgmid=/g/11zz5t1059&hl=en-US&q=Sparkling+Standard+Cleaning+Co.',
    bingPlaces: PENDING as Fact<string>,
    // Confirmed (owner-supplied 2026-10-02)
    facebook: 'https://www.facebook.com/profile.php?id=61595026949584',
    nextdoor: 'https://nextdoor.com/page/sparkling-standard-cleaning-co/',
    yelp: PENDING as Fact<string>,
    // Visual and video — confirmed 2026-10-03; Instagram/YouTube 2026-10-27
    instagram: 'https://www.instagram.com/sparkling_standard_cleaning/',
    tiktok: 'https://www.tiktok.com/@sparkling_standard?lang=en',
    youtube: 'https://youtube.com/@sparklingstandardcleaning?si=XowTyCK2KJbYnvD9',
    pinterest: 'https://www.pinterest.com/SparklingStandard/',
    rumble: 'https://rumble.com/user/SparklingStandard',
    // Additional social distribution — all confirmed 2026-10-03
    gab: 'https://gab.com/Sparkling_Standard',
    parler: 'https://app.parler.com/Sparkling-Standard',
    locals: 'https://sparkling-standards.locals.com',
    x: 'https://x.com/SparklnStandard',
    threads: PENDING as Fact<string>,
    // Professional networking
    linkedin: PENDING as Fact<string>,
    alignable: PENDING as Fact<string>,
    // Community engagement
    reddit: PENDING as Fact<string>,
  },
  reviews: {
    /**
     * Link that READS existing reviews — the canonical Google Maps place URL
     * (CID 3954983909661285488). Provenance: the owner-supplied "Ask for
     * reviews" short link `https://g.page/r/CXAcv1Pp7OI2ECE` (2026-10-08) was
     * resolved through its own redirect chain on 2026-10-23 and lands here
     * (HTTP 200, canonical Maps place page). This is the same place the
     * owner-supplied link reaches — not a hand-built or guessed URL. Do not
     * "restore" the older kgmid search URL below; this one is verified.
     */
    profileUrl: 'https://www.google.com/maps?cid=3954983909661285488&hl=en',
    /**
     * Direct review-submission link (leave-review page / QR destination) — the
     * exact owner-supplied "Ask for reviews" short link (2026-10-08). Never
     * modify, shorten or hand-build this URL.
     */
    submissionUrl: 'https://g.page/r/CXAcv1Pp7OI2ECE/review',
    /**
     * No review counts are ever displayed unless the owner supplies a verified
     * figure AND real reviews exist in the reviews collection. Never invent.
     */
  },

  // ── Payments (owner-approved methods; Stripe confirmed 2026-10-21) ────────
  payments: {
    /** Emphasized professional methods confirmed by the owner. */
    accepted: [
      'Major credit and debit cards',
      'Apple Pay',
      'Google Pay',
      'ACH bank transfer',
    ],
    /** Documented selectively, not as a logo wall. */
    alternate: ['Cash', 'Check', 'Cash App', 'Venmo', 'Zelle', 'PayPal'],
    /** Residential payment timing, owner-approved October 21, 2026. */
    residentialTiming:
      'Residential cleaning may be paid securely online through Stripe when Pay Now is offered for an exact estimate, or upon completion when you choose a reservation without upfront payment. Pay Now does not by itself confirm a date. Commercial cleaning is invoiced monthly with Net 15 terms. No standard deposit or late fee applies initially; large projects may be considered separately with written terms.',
    /** Owner-confirmed processor. */
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
      /**
       * Owner-provided Google Tag Manager container (2026-10-02). Container
       * IDs are public client identifiers by design; PUBLIC_GTM_CONTAINER_ID
       * still overrides this default when set in the build environment.
       */
      containerId: envFact(import.meta.env.PUBLIC_GTM_CONTAINER_ID) ?? 'GTM-KSQ26HMG',
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
     * Text-message CTAs. ENABLED 2026-10-01: the owner verified that the
     * business number receives SMS and explicitly authorized text contact.
     * Never enable without that verification.
     */
    smsEnabled: true,
    /** Reviews section/nav visibility is automatic once genuine entries exist. */
    reviewsVisibleWhenPresent: true,
  },

  // ── Launch status ──────────────────────────────────────────────────────────
  launch: {
    /** Formal pre-launch sign-off. Remains FALSE while individual owner
     *  checklist items (legal entity spelling, insurance claims, review links)
     *  are genuinely outstanding; it only gates scripts/validate-production-env.mjs
     *  and does not describe deployment state — the site is live. */
    productionApproved: false,
    /** The production site is LIVE (Cloudflare Pages via GitHub main). */
    status: 'live' as const,
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
