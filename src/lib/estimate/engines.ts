// The four estimate engines — ONE registry for the hub cards, contextual
// service-page links, and wizard pre-selection.
//
// Residential and Short-Term Rental Turnovers run through the instant
// calculator; Commercial and Church open the specialized facility request
// engine. Numeric facility pricing is governed by
// `commercialTierConfig.numericEstimatesEnabled` (enabled: Tier A/B preliminary
// estimates; disabled: scope review only).

import type { Frequency } from '../../config/pricing.ts';
import type { ServiceType } from './types.ts';

export type EstimateEngine = 'residential' | 'commercial' | 'str' | 'church';

export interface EngineDefinition {
  id: EstimateEngine;
  label: string;
  shortLabel: string;
  description: string;
  includes: string;
  ctaLabel: string;
  requestLabel: string;
  /** Wizard family when this engine uses the instant calculator. */
  wizard: 'residential' | 'str' | null;
  href: string;
}

export const ESTIMATE_ENGINES: readonly EngineDefinition[] = [
  {
    id: 'residential',
    label: 'Residential Cleaning',
    shortLabel: 'Residential',
    description:
      'Homes, apartments and condos — recurring cleaning, deep cleaning, move-in/move-out and community support cleaning.',
    includes: 'Recurring · Deep · Move-in/out · Community Support',
    ctaLabel: 'Get My Cleaning Estimate',
    requestLabel: 'Residential cleaning request',
    wizard: 'residential',
    href: '/estimate/residential/',
  },
  {
    id: 'commercial',
    label: 'Commercial Cleaning',
    shortLabel: 'Commercial',
    description:
      'Offices, retail, salons, gyms, professional facilities and other light-commercial spaces.',
    includes: 'Offices · Retail · Salons · Gyms',
    ctaLabel: 'Estimate My Facility Cleaning',
    requestLabel: 'Commercial cleaning request',
    wizard: null,
    href: '/estimate/commercial/',
  },
  {
    id: 'str',
    label: 'Short-Term Rental Turnovers',
    shortLabel: 'Turnovers',
    description:
      'Airbnb, Vrbo and vacation-rental turnovers — guest-ready resets, bed and linen handling, and recurring host arrangements.',
    includes: 'Airbnb · Vrbo · Guest-ready resets',
    ctaLabel: 'Get a Turnover Estimate',
    requestLabel: 'Turnover request',
    wizard: 'str',
    href: '/estimate/str/',
  },
  {
    id: 'church',
    label: 'Church Cleaning',
    shortLabel: 'Church',
    description:
      'Sanctuaries, fellowship halls, nurseries, classrooms and offices — scheduled respectfully around church life, with our 10% church discount.',
    includes: 'Sanctuaries · Fellowship halls · 10% church discount',
    ctaLabel: 'Estimate Church Cleaning',
    requestLabel: 'Church cleaning request',
    wizard: null,
    href: '/estimate/church/',
  },
] as const;

export function engineDefinition(id: EstimateEngine): EngineDefinition {
  return ESTIMATE_ENGINES.find((engine) => engine.id === id) ?? ESTIMATE_ENGINES[0]!;
}

/** Allowlisted engine parameter — anything unknown falls back to residential. */
export function parseEngineParam(value: string | null | undefined): EstimateEngine {
  return ESTIMATE_ENGINES.some((engine) => engine.id === value) ? (value as EstimateEngine) : 'residential';
}

export interface ResidentialPreset {
  serviceType: ServiceType;
  frequency?: Frequency;
  supportive?: boolean;
}

/**
 * Allowlisted residential service parameter used by service-page CTAs.
 * Unknown values return null (no preselection).
 */
export function parseResidentialServiceParam(value: string | null | undefined): ResidentialPreset | null {
  switch (value) {
    case 'recurring':
      return { serviceType: 'standard' };
    case 'deep':
      return { serviceType: 'deep', frequency: 'one_time' };
    case 'move':
    case 'move-in':
    case 'move-out':
      return { serviceType: 'move_in_out', frequency: 'one_time' };
    case 'supportive':
      return { serviceType: 'standard', supportive: true };
    case 'one-time':
      return { serviceType: 'standard', frequency: 'one_time' };
    default:
      return null;
  }
}

/** Build a hub/contextual link without ever exposing arbitrary query state. */
export function engineEstimateHref(
  engine: EstimateEngine,
  service?: string | null,
  extraParams: Record<string, string | null | undefined> = {},
): string {
  const base = engineDefinition(engine).href;
  const url = new URL(base, 'https://sparkling-standard.invalid');
  if (service) url.searchParams.set('service', service);
  for (const [key, value] of Object.entries(extraParams)) {
    if (typeof value === 'string' && value.trim() !== '') url.searchParams.set(key, value);
  }
  return `${url.pathname}${url.search}${url.hash}`;
}

/**
 * Wizard step titles per calculator family. Residential keeps the owner's
 * six-step journey; turnover hosts see a property/linen-specific sequence.
 * The DOM derives its headings, labels, and progress text from this registry.
 */
export interface EngineSteps {
  titles: readonly [string, string, string, string, string, string];
  blurbs: readonly [string, string, string, string, string, string];
}

export const ENGINE_STEPS: Record<'residential' | 'str', EngineSteps> = {
  residential: {
    titles: [
      'Service & Address',
      'Your Home',
      'Condition & Frequency',
      'Optional Extras',
      'Scheduling',
      'Your Estimate',
    ],
    blurbs: [
      'Choose your cleaning and confirm your address on the map.',
      'Size, bedrooms and bathrooms — the facts that actually move labor time.',
      'How the home has been kept, and how often you would like it cleaned.',
      'Focused extras with the price shown beside each one before you choose.',
      'Your preferred date and the arrival window that works for you.',
      'Your proposed price, the full scope and your reservation request.',
    ],
  },
  str: {
    titles: [
      'Property & Address',
      'Rental Details',
      'Turnover Setup',
      'Turnover Extras',
      'Scheduling',
      'Your Turnover Estimate',
    ],
    blurbs: [
      'Confirm the rental property on the map.',
      'Property size, bedrooms, bathrooms and beds to reset.',
      'Turnover rhythm, linen handling and guest windows.',
      'Focused extras with the price shown beside each one before you choose.',
      'Your preferred turnover date and arrival window.',
      'Your per-turnover estimate and host request.',
    ],
  },
};

/** Step titles for the facility engines (commercial / church). */
export const FACILITY_STEPS: Record<'commercial' | 'church', readonly string[]> = {
  commercial: ['Facility & Address', 'Space & Workload', 'Schedule & Access', 'Contact & Review'],
  church: ['Ministry & Address', 'Spaces & Workload', 'Schedule & Access', 'Contact & Review'],
};
