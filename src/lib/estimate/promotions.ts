// Promotion engine — pure functions shared by the browser estimator, the
// server-side quote verification and the unit tests.
//
// Guarantees enforced here (not in the UI):
//  - at most ONE promotion discount is ever applied to a quote (no stacking);
//  - every program is owner-gated (`enabled`) and term-gated (`value`);
//  - a program with a null value, a zero/negative value or a past expiry can
//    never apply;
//  - the minimum-job floor always wins: a discount can never reduce a quote
//    below `minimumJob`;
//  - specialty/custom-quote add-ons are never part of a discount base;
//  - programs that require a customer kind the estimator cannot prove
//    ('new' / 'established_recurring') fail closed rather than guessing.
//
// The server recomputes the same function from the same shared configuration,
// so the frontend and backend cannot disagree about promotion eligibility.

import type {
  AddonBundleDefinition,
  FoundingTenConfig,
  PromotionCustomerKind,
  PromotionEligibility,
  PromotionTerms,
} from '../../config/owner-pricing.ts';
import type { Frequency, PricingServiceType } from '../../config/pricing.ts';

export type PromotionSource = 'addon_incentive' | 'addon_bundle' | 'appreciation' | 'founding';

export interface PromotionCandidate {
  id: string;
  source: PromotionSource;
  label: string;
  /** Configured percent for percent programs; 0 for fixed programs. */
  percent: number;
  /** Effective price reduction in USD (never below the minimum job). */
  amount: number;
}

export interface PromotionGrant {
  id: string;
  label: string;
  /** Complimentary upgrade — recorded but never a price change. */
  grant: true;
}

export interface PromotionEvaluation {
  discount: PromotionCandidate | null;
  /** Present when the (disabled) founding upgrade mechanism would apply. */
  grant: PromotionGrant | null;
}

export interface PromotionConfig {
  enabled: boolean;
  tiers: Array<{ minAddons: number; percent: number }>;
  maxDiscount?: number | null;
}

export interface PromotionInput {
  serviceType: PricingServiceType;
  frequency: Frequency;
  /** Non-specialty selected add-on ids (the only discountable extras). */
  eligibleAddonIds: string[];
  /** Resolved charge per selected add-on id, for complimentary upgrades. */
  addonChargesById?: Record<string, number>;
  addonSubtotal: number;
  /** Price before any discount (minimum already applied). */
  gross: number;
  minimumJob: number;
  /** ISO date (YYYY-MM-DD) used for expiry checks; injectable for tests. */
  todayIso: string;
  /** What the flow can prove about the customer; 'unknown' fails closed. */
  customerKind: 'unknown' | PromotionCustomerKind;
  /** Existing multi-add-on incentive configuration. */
  addonIncentive: PromotionConfig;
  appreciationDiscounts: PromotionTerms[];
  addonBundles: AddonBundleDefinition[];
  foundingTen: FoundingTenConfig;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function notExpired(expiresOn: string | null, todayIso: string): boolean {
  if (!expiresOn) return true;
  // ISO date strings compare lexicographically; an invalid date fails closed.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(expiresOn)) return false;
  return todayIso <= expiresOn;
}

function customerMatches(required: PromotionCustomerKind, actual: PromotionInput['customerKind']): boolean {
  if (required === 'any') return true;
  // The estimator cannot yet prove a customer kind, so anything requiring one
  // fails closed instead of being guessed from browser state.
  if (actual === 'unknown') return false;
  return required === actual;
}

function eligibilityMatches(eligibility: PromotionEligibility, input: PromotionInput): boolean {
  if (eligibility.services.length > 0 && !eligibility.services.includes(input.serviceType)) return false;
  if (eligibility.frequencies.length > 0 && !eligibility.frequencies.includes(input.frequency)) return false;
  return customerMatches(eligibility.customer, input.customerKind);
}

/**
 * Applies one program's terms to a base amount with the mandatory floors.
 * Returns the effective price reduction (0 means the program cannot apply).
 */
function effectiveAmount(input: {
  kind: 'percent' | 'fixed';
  value: number | null;
  base: number;
  cap: number | null;
  gross: number;
  minimumJob: number;
}): number {
  const { kind, value, base, cap, gross, minimumJob } = input;
  if (value === null || !Number.isFinite(value) || value <= 0) return 0;
  if (base <= 0) return 0;
  const raw = kind === 'percent' ? base * value : value;
  const capped = Math.min(raw, cap ?? Number.POSITIVE_INFINITY, base);
  if (capped <= 0) return 0;
  const discounted = Math.max(minimumJob, gross - capped);
  return Math.max(0, round2(gross - discounted));
}

function addonIncentiveCandidate(input: PromotionInput): PromotionCandidate | null {
  const incentive = input.addonIncentive;
  if (!incentive.enabled || input.eligibleAddonIds.length < 2 || input.addonSubtotal <= 0) return null;
  const tier = [...incentive.tiers]
    .sort((a, b) => b.minAddons - a.minAddons)
    .find((candidate) => input.eligibleAddonIds.length >= candidate.minAddons);
  if (!tier || tier.percent <= 0) return null;
  const amount = effectiveAmount({
    kind: 'percent',
    value: tier.percent,
    base: input.addonSubtotal,
    cap: incentive.maxDiscount ?? null,
    gross: input.gross,
    minimumJob: input.minimumJob,
  });
  if (amount <= 0) return null;
  const percentLabel = `${Math.round(tier.percent * 100)}%`;
  return {
    id: 'addon-incentive',
    source: 'addon_incentive',
    label:
      input.eligibleAddonIds.length >= 3
        ? `${percentLabel} off extras (${input.eligibleAddonIds.length} add-ons)`
        : `${percentLabel} off extras`,
    percent: tier.percent,
    amount,
  };
}

function bundleCandidate(bundle: AddonBundleDefinition, input: PromotionInput): PromotionCandidate | null {
  if (!bundle.enabled || !notExpired(bundle.expiresOn, input.todayIso)) return null;
  if (bundle.requiredAddonIds.length === 0) return null;
  const selected = new Set(input.eligibleAddonIds);
  if (!bundle.requiredAddonIds.every((id) => selected.has(id))) return null;
  if (bundle.requiresRecurring && input.frequency === 'one_time') return null;
  if (bundle.eligibleFrequencies.length > 0 && !bundle.eligibleFrequencies.includes(input.frequency)) return null;
  const amount = effectiveAmount({
    kind: bundle.kind,
    value: bundle.value,
    base: input.addonSubtotal,
    cap: bundle.maxDiscountUsd,
    gross: input.gross,
    minimumJob: input.minimumJob,
  });
  if (amount <= 0) return null;
  return {
    id: bundle.id,
    source: 'addon_bundle',
    label: bundle.label,
    percent: bundle.kind === 'percent' ? (bundle.value ?? 0) : 0,
    amount,
  };
}

function appreciationCandidate(terms: PromotionTerms, input: PromotionInput): PromotionCandidate | null {
  if (!terms.enabled || !notExpired(terms.expiresOn, input.todayIso)) return null;
  if (!eligibilityMatches(terms.eligibility, input)) return null;
  const base =
    terms.appliesTo === 'addons' ? input.addonSubtotal : input.gross;
  const amount = effectiveAmount({
    kind: terms.kind,
    value: terms.value,
    base,
    cap: terms.maxDiscountUsd,
    gross: input.gross,
    minimumJob: input.minimumJob,
  });
  if (amount <= 0) return null;
  return {
    id: terms.id,
    source: 'appreciation',
    label: terms.kind === 'percent' ? 'Appreciation discount' : 'Appreciation credit',
    percent: terms.kind === 'percent' ? (terms.value ?? 0) : 0,
    amount,
  };
}

function foundingEvaluation(config: FoundingTenConfig, input: PromotionInput): {
  discount: PromotionCandidate | null;
  grant: PromotionGrant | null;
} {
  if (!config.enabled || config.mechanism === null || !notExpired(config.expiresOn, input.todayIso)) {
    return { discount: null, grant: null };
  }
  if (config.mechanism === 'first_clean_discount') {
    if (input.customerKind !== 'new') return { discount: null, grant: null };
    const amount = effectiveAmount({
      kind: config.firstClean.kind,
      value: config.firstClean.value,
      base: input.gross,
      cap: config.firstClean.maxDiscountUsd,
      gross: input.gross,
      minimumJob: input.minimumJob,
    });
    return {
      discount:
        amount > 0
          ? {
              id: 'founding-ten-first-clean',
              source: 'founding',
              label: 'Founding customer first-clean discount',
              percent: config.firstClean.kind === 'percent' ? (config.firstClean.value ?? 0) : 0,
              amount,
            }
          : null,
      grant: null,
    };
  }
  if (config.mechanism === 'recurring_discount') {
    if (!config.recurring.qualifyingFrequencies.includes(input.frequency)) return { discount: null, grant: null };
    const amount = effectiveAmount({
      kind: config.recurring.kind,
      value: config.recurring.value,
      base: input.gross,
      cap: config.recurring.maxDiscountUsd,
      gross: input.gross,
      minimumJob: input.minimumJob,
    });
    return {
      discount:
        amount > 0
          ? {
              id: 'founding-ten-recurring',
              source: 'founding',
              label: 'Founding customer recurring discount',
              percent: config.recurring.kind === 'percent' ? (config.recurring.value ?? 0) : 0,
              amount,
            }
          : null,
      grant: null,
    };
  }
  // Complimentary upgrade: the granted add-on's charge is waived (never the
  // base cleaning price), capped at the approved value. The scheduled labor
  // hours still count, so the owner can see the real cost of the gesture.
  if (config.mechanism === 'complimentary_upgrade') {
    const applies =
      config.upgrade.appliesToFrequencies.length === 0 ||
      config.upgrade.appliesToFrequencies.includes(input.frequency);
    if (!applies || config.upgrade.addonIds.length === 0) return { discount: null, grant: null };
    const charges = input.addonChargesById ?? {};
    const selected = new Set(input.eligibleAddonIds);
    const grantBase = config.upgrade.addonIds
      .filter((id) => selected.has(id))
      .reduce((sum, id) => sum + (Number.isFinite(charges[id]) ? (charges[id] as number) : 0), 0);
    if (grantBase <= 0) return { discount: null, grant: null };
    const amount = effectiveAmount({
      kind: 'fixed',
      value: grantBase,
      base: input.addonSubtotal,
      cap: config.upgrade.maxValueUsd,
      gross: input.gross,
      minimumJob: input.minimumJob,
    });
    if (amount <= 0) return { discount: null, grant: null };
    return {
      discount: {
        id: 'founding-ten-upgrade',
        source: 'founding',
        label: 'Founding customer complimentary upgrade',
        percent: 0,
        amount,
      },
      grant: {
        id: 'founding-ten-upgrade',
        label: 'Founding customer complimentary upgrade',
        grant: true,
      },
    };
  }
  return { discount: null, grant: null };
}

/**
 * Evaluates every enabled program and returns at most one discount — the
 * largest effective reduction — plus an optional complimentary-upgrade grant.
 * With every program disabled (the shipped state) this returns nulls.
 */
export function evaluatePromotions(input: PromotionInput): PromotionEvaluation {
  const candidates: PromotionCandidate[] = [];
  const incentive = addonIncentiveCandidate(input);
  if (incentive) candidates.push(incentive);
  for (const bundle of input.addonBundles) {
    const candidate = bundleCandidate(bundle, input);
    if (candidate) candidates.push(candidate);
  }
  for (const terms of input.appreciationDiscounts) {
    const candidate = appreciationCandidate(terms, input);
    if (candidate) candidates.push(candidate);
  }
  const founding = foundingEvaluation(input.foundingTen, input);
  if (founding.discount) candidates.push(founding.discount);

  if (candidates.length === 0) return { discount: null, grant: founding.grant };
  candidates.sort((a, b) => b.amount - a.amount);
  return { discount: candidates[0] ?? null, grant: founding.grant };
}
