// Pure legal-policy calculations. These functions do not write to the database,
// charge a card, send a notice or activate a fee. Callers must check the
// activation flags in `src/config/legal-policy.ts` before using any result for
// billing or customer communication.

import { legalPolicyConfig, LEGAL_POLICY_VERSION } from '../../config/legal-policy.ts';

export type CancellationTier =
  | 'free_48_hours'
  | 'reduced_24_to_48_hours'
  | 'under_24_hours'
  | 'failed_access'
  | 'company_cancelled'
  | 'emergency_or_statutory'
  | 'waived';

export interface CancellationInput {
  noticeHours: number;
  failedAccess?: boolean;
  companyCancelled?: boolean;
  emergencyOrStatutory?: boolean;
  supportableCostCents: number;
  courtesyWaiverAvailable?: boolean;
  /** Overrides for branch/service configuration. */
  reducedFeeCeilingCents?: number;
  underNoticeFeeCeilingCents?: number;
  failedAccessFeeCeilingCents?: number;
}

export interface CancellationAssessment {
  policyVersion: string;
  tier: CancellationTier;
  ceilingCents: number;
  supportableCostCents: number;
  amountCents: number;
  waiverApplied: boolean;
  waiverConsumed: boolean;
  automaticCharge: false;
  explanation: string;
}

function nonNegativeCents(value: unknown): number {
  const cents = Math.round(Number(value));
  return Number.isFinite(cents) && cents > 0 ? cents : 0;
}

export function assessCancellation(input: CancellationInput): CancellationAssessment {
  const supportable = nonNegativeCents(input.supportableCostCents);
  const policy = legalPolicyConfig.cancellation;
  const base = {
    policyVersion: LEGAL_POLICY_VERSION,
    supportableCostCents: supportable,
    automaticCharge: false as const,
  };

  if (input.companyCancelled === true) {
    return { ...base, tier: 'company_cancelled', ceilingCents: 0, amountCents: 0, waiverApplied: false, waiverConsumed: false, explanation: 'No fee applies when Sparkling Standard cancels.' };
  }
  if (input.emergencyOrStatutory === true) {
    return { ...base, tier: 'emergency_or_statutory', ceilingCents: 0, amountCents: 0, waiverApplied: false, waiverConsumed: false, explanation: 'No fee applies while a statutory cancellation right or approved emergency exception applies.' };
  }
  if (input.failedAccess === true) {
    const ceiling = nonNegativeCents(input.failedAccessFeeCeilingCents ?? policy.failedAccessFeeCeilingCents);
    return { ...base, tier: 'failed_access', ceilingCents: ceiling, amountCents: Math.min(supportable, ceiling), waiverApplied: false, waiverConsumed: false, explanation: 'Failed-access assessment is limited to documented recoverable costs and never stacked with a cancellation fee.' };
  }

  const hours = Number.isFinite(Number(input.noticeHours)) ? Number(input.noticeHours) : 0;
  let tier: CancellationTier;
  let ceiling: number;
  if (hours >= policy.freeNoticeHours) {
    tier = 'free_48_hours';
    ceiling = 0;
  } else if (hours >= policy.reducedNoticeMaxHours) {
    tier = 'reduced_24_to_48_hours';
    ceiling = nonNegativeCents(input.reducedFeeCeilingCents ?? policy.reducedFeeCeilingCents);
  } else {
    tier = 'under_24_hours';
    ceiling = nonNegativeCents(input.underNoticeFeeCeilingCents ?? policy.underNoticeFeeCeilingCents);
  }
  let amount = Math.min(supportable, ceiling);
  let waiverApplied = false;
  let waiverConsumed = false;
  if (amount > 0 && input.courtesyWaiverAvailable === true) {
    waiverApplied = true;
    waiverConsumed = true;
    amount = 0;
    tier = 'waived';
  }
  return {
    ...base,
    tier,
    ceilingCents: ceiling,
    amountCents: amount,
    waiverApplied,
    waiverConsumed,
    explanation: ceiling === 0
      ? 'The appointment was outside the fee window.'
      : 'The assessment is capped by the approved ceiling and further limited to documented recoverable costs.',
  };
}

export interface LatePaymentInput {
  principalCents: number;
  dueDate: string;
  asOf: string;
  lateFeeAlreadyAssessed?: boolean;
  disputed?: boolean;
  annualRateBps?: number;
  graceDays?: number;
  lateFeeCents?: number;
  paymentsCents?: number;
  creditsCents?: number;
}

export interface LatePaymentAssessment {
  policyVersion: string;
  eligiblePrincipalCents: number;
  graceEndsOn: string;
  interestStartDate: string | null;
  daysAccrued: number;
  annualRateBps: number;
  interestCents: number;
  lateFeeCents: number;
  feeAssessed: boolean;
  disputed: boolean;
  totalCents: number;
  explanation: string;
}

function dateOnly(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) ? date : null;
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86_400_000);
}

export function assessLatePayment(input: LatePaymentInput): LatePaymentAssessment {
  const policy = legalPolicyConfig.latePayment;
  const due = dateOnly(input.dueDate);
  const asOf = dateOnly(input.asOf);
  const principal = Math.max(0, nonNegativeCents(input.principalCents) - nonNegativeCents(input.paymentsCents) - nonNegativeCents(input.creditsCents));
  const rate = Number.isFinite(Number(input.annualRateBps)) ? Math.max(0, Math.min(1_800, Number(input.annualRateBps))) : policy.annualRateBps;
  const graceDays = Number.isFinite(Number(input.graceDays)) ? Math.max(0, Number(input.graceDays)) : policy.graceDays;
  const feeCeiling = nonNegativeCents(input.lateFeeCents ?? policy.lateFeeCents);
  if (!due || !asOf || principal <= 0) {
    return {
      policyVersion: LEGAL_POLICY_VERSION, eligiblePrincipalCents: principal,
      graceEndsOn: due ? addDays(due, graceDays).toISOString().slice(0, 10) : '',
      interestStartDate: null, daysAccrued: 0, annualRateBps: rate,
      interestCents: 0, lateFeeCents: 0, feeAssessed: false,
      disputed: Boolean(input.disputed), totalCents: 0,
      explanation: 'No eligible unpaid principal or valid dates were supplied.',
    };
  }
  const graceEnd = addDays(due, graceDays);
  const dispute = input.disputed === true;
  const daysAccrued = dispute ? 0 : Math.max(0, Math.floor((asOf.getTime() - graceEnd.getTime()) / 86_400_000));
  const interestCents = daysAccrued > 0
    ? Math.floor(principal * (rate / 10_000) * (daysAccrued / policy.dayDenominator))
    : 0;
  const feeAssessed = !dispute && asOf > graceEnd && input.lateFeeAlreadyAssessed !== true && feeCeiling > 0;
  const lateFee = feeAssessed ? feeCeiling : 0;
  return {
    policyVersion: LEGAL_POLICY_VERSION,
    eligiblePrincipalCents: principal,
    graceEndsOn: graceEnd.toISOString().slice(0, 10),
    interestStartDate: daysAccrued > 0 ? graceEnd.toISOString().slice(0, 10) : null,
    daysAccrued,
    annualRateBps: rate,
    interestCents,
    lateFeeCents: lateFee,
    feeAssessed,
    disputed: dispute,
    totalCents: interestCents + lateFee,
    explanation: dispute
      ? 'Interest and fees are paused while a legitimate billing dispute is under review.'
      : 'Simple interest accrues only on unpaid principal after the grace period; the one-time fee is separate, and interest is never charged on fees.',
  };
}

export interface LateChargeCompliance {
  effectiveAnnualizedBps: number;
  exceedsEighteenPercent: boolean;
  requiresOwnerOrLegalReview: boolean;
  note: string;
}

export function reviewLateChargeCompliance(principalCents: number, daysAccrued: number, chargesCents: number): LateChargeCompliance {
  const principal = Math.max(0, Number(principalCents) || 0);
  const days = Math.max(1, Number(daysAccrued) || 0);
  const charges = Math.max(0, Number(chargesCents) || 0);
  const effectiveAnnualizedBps = principal > 0 ? Math.round((charges / principal) * (365 / days) * 10_000) : 0;
  return {
    effectiveAnnualizedBps,
    exceedsEighteenPercent: effectiveAnnualizedBps > 1_800,
    requiresOwnerOrLegalReview: effectiveAnnualizedBps > 1_800,
    note: 'The $20 late fee is a separate disclosed charge, not interest. Review the combined charge against the 18% simple-interest usury limit under Fla. Stat. sections 687.02-687.03 before imposing both, especially on small balances. Do not charge interest on fees.',
  };
}
export interface PostJudgmentInput {
  judgmentPrincipalCents: number;
  judgmentDate: string;
  asOf: string;
  annualRateBps: number;
}

export interface PostJudgmentAssessment {
  annualRateBps: number;
  daysAccrued: number;
  interestCents: number;
  compounding: false;
  note: string;
}

export function assessPostJudgmentInterest(input: PostJudgmentInput): PostJudgmentAssessment {
  const start = dateOnly(input.judgmentDate);
  const end = dateOnly(input.asOf);
  const principal = nonNegativeCents(input.judgmentPrincipalCents);
  const rate = Math.max(0, Number(input.annualRateBps) || 0);
  const days = start && end ? Math.max(0, Math.floor((end.getTime() - start.getTime()) / 86_400_000)) : 0;
  return {
    annualRateBps: rate,
    daysAccrued: days,
    interestCents: Math.floor(principal * (rate / 10_000) * (days / 365)),
    compounding: false,
    note: 'Use the quarterly CFO rate under Fla. Stat. §55.03 for a judgment; do not use the invoice rate as a judgment rate.',
  };
}

export interface LienDeadlines {
  initialLienExpiresOn: string | null;
  outerLimitOn: string | null;
  renewalRequiredBefore: string | null;
  note: string;
}

function iso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function judgmentLienDeadlines(judgmentDate: string, recordingDate: string): LienDeadlines {
  const judgment = dateOnly(judgmentDate);
  const recording = dateOnly(recordingDate);
  if (!judgment || !recording) {
    return { initialLienExpiresOn: null, outerLimitOn: null, renewalRequiredBefore: null, note: 'A judgment and a county recording date are required.' };
  }
  const initial = new Date(Date.UTC(recording.getUTCFullYear() + 10, recording.getUTCMonth(), recording.getUTCDate()));
  const outer = new Date(Date.UTC(judgment.getUTCFullYear() + 20, judgment.getUTCMonth(), judgment.getUTCDate()));
  return {
    initialLienExpiresOn: iso(initial),
    outerLimitOn: iso(outer),
    renewalRequiredBefore: iso(initial),
    note: 'A real-property judgment lien requires a certified judgment recorded in the county with the required lienholder address or simultaneous affidavit; the initial lien is ten years and no extension may exceed twenty years from judgment entry. Homestead and other exemptions may apply.',
  };
}

export function collectionStage(input: {
  daysPastDue: number;
  finalDemandSentAt?: string | null;
  disputed?: boolean;
}): 'current' | 'reminder' | 'demand' | 'final_demand' | 'collections_review' | 'dispute_hold' {
  if (input.disputed) return 'dispute_hold';
  if (input.daysPastDue < 7) return 'current';
  if (input.daysPastDue < 14) return 'reminder';
  if (input.daysPastDue < 30) return 'demand';
  if (!input.finalDemandSentAt) return 'final_demand';
  return 'collections_review';
}
