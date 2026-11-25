// Legal and financial policy values approved for controlled implementation.
// No live fee, interest, collection or signing behavior is activated here.

export const LEGAL_POLICY_VERSION = '2026-11-22.legal-policy.v1';

export interface FeePolicy {
  /** Percentage points expressed in basis points. */
  annualRateBps: number;
  graceDays: number;
  lateFeeCents: number;
  feeAssessedOnce: boolean;
  compounding: false;
  dayDenominator: 365;
  chargeFeeOnInterest: boolean;
  consumerDisclosureRequired: boolean;
  disputedBalanceAccrual: boolean;
}

export const legalPolicyConfig = {
  version: LEGAL_POLICY_VERSION,
  activation: {
    cancellationFees: false,
    lateFees: false,
    interest: false,
    collections: false,
    electronicSigning: true,
    productionLegalDocuments: true,
  },
  cancellation: {
    freeNoticeHours: 48,
    reducedNoticeMaxHours: 24,
    reducedFeeCeilingCents: 2_000,
    underNoticeFeeCeilingCents: 4_000,
    failedAccessFeeCeilingCents: 4_000,
    courtesyWaiversPerRollingMonths: 12,
    stackFees: false,
    statutoryRightsPreserved: true,
    automaticCharges: false,
  },
  latePayment: {
    annualRateBps: 1_500,
    graceDays: 30,
    lateFeeCents: 2_000,
    feeAssessedOnce: true,
    compounding: false,
    dayDenominator: 365,
    chargeFeeOnInterest: false,
    consumerDisclosureRequired: true,
    disputedBalanceAccrual: false,
  } satisfies FeePolicy,
  postJudgment: {
    // The CFO sets this quarterly under Fla. Stat. §55.03. Never hard-code a
    // current rate in an invoice or judgment calculation.
    annualRateSource: 'Fla. Stat. §55.03 quarterly CFO rate',
    compounding: false,
    ordinaryServiceInvoiceDoesNotCreateJudgmentRate: true,
  },
  collections: {
    reminderDays: [7, 14, 21] as readonly number[],
    finalDemandAfterGraceDays: 30,
    manualReviewBeforeReferral: true,
    preserveEvidence: true,
    automaticLienRecording: false,
    cleaningServiceCreatesConstructionLien: false,
    realPropertyLienRequiresRecordedJudgment: true,
    homesteadExemptionApplies: true,
  },
  documentActivation: {
    requireExactApprovedHash: true,
    allowPreviousApprovalAfterWordingChange: false,
    allowUnresolvedPlaceholders: false,
    electronicSignatureConsentVersion: '2026-11-01.esign-consent.v1',
  },
} as const;

export function isLegalPolicyActivated(
  key: keyof typeof legalPolicyConfig.activation,
): boolean {
  const activation: Record<string, boolean> = legalPolicyConfig.activation;
  return activation[key] === true;
}
