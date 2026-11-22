import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  assessCancellation,
  assessLatePayment,
  assessPostJudgmentInterest,
  collectionStage,
  judgmentLienDeadlines,
  reviewLateChargeCompliance,
} from '../src/lib/legal/fees.ts';
import { legalPolicyConfig } from '../src/config/legal-policy.ts';

test('cancellation tiers are progressive, capped, non-stacking and waiver-aware', () => {
  const free = assessCancellation({ noticeHours: 48, supportableCostCents: 4_000 });
  assert.equal(free.tier, 'free_48_hours');
  assert.equal(free.amountCents, 0);

  const mid = assessCancellation({ noticeHours: 24, supportableCostCents: 4_000 });
  assert.equal(mid.tier, 'reduced_24_to_48_hours');
  assert.equal(mid.ceilingCents, 2_000);
  assert.equal(mid.amountCents, 2_000);

  const late = assessCancellation({ noticeHours: 12, supportableCostCents: 1_500 });
  assert.equal(late.tier, 'under_24_hours');
  assert.equal(late.amountCents, 1_500);

  const access = assessCancellation({ noticeHours: 12, failedAccess: true, supportableCostCents: 9_000 });
  assert.equal(access.tier, 'failed_access');
  assert.equal(access.amountCents, 4_000);

  const waived = assessCancellation({ noticeHours: 12, supportableCostCents: 4_000, courtesyWaiverAvailable: true });
  assert.equal(waived.tier, 'waived');
  assert.equal(waived.amountCents, 0);
  assert.equal(waived.waiverConsumed, true);

  assert.equal(assessCancellation({ noticeHours: 1, companyCancelled: true, supportableCostCents: 4_000 }).amountCents, 0);
  assert.equal(assessCancellation({ noticeHours: 1, emergencyOrStatutory: true, supportableCostCents: 4_000 }).amountCents, 0);
  assert.equal(legalPolicyConfig.activation.cancellationFees, false);
});

test('late payment uses 15% simple interest after a 30-day grace period and a one-time fee', () => {
  const due = assessLatePayment({ principalCents: 100_000, dueDate: '2026-01-01', asOf: '2026-01-31' });
  assert.equal(due.interestCents, 0);
  assert.equal(due.lateFeeCents, 0);
  assert.equal(due.daysAccrued, 0);

  const overdue = assessLatePayment({ principalCents: 100_000, dueDate: '2026-01-01', asOf: '2026-03-01' });
  assert.equal(overdue.annualRateBps, 1_500);
  assert.equal(overdue.graceEndsOn, '2026-01-31');
  assert.equal(overdue.feeAssessed, true);
  assert.equal(overdue.lateFeeCents, 2_000);
  assert.ok(overdue.interestCents > 0);
  assert.equal(overdue.totalCents, overdue.interestCents + overdue.lateFeeCents);

  const already = assessLatePayment({ principalCents: 100_000, dueDate: '2026-01-01', asOf: '2026-03-01', lateFeeAlreadyAssessed: true });
  assert.equal(already.lateFeeCents, 0);

  const disputed = assessLatePayment({ principalCents: 100_000, dueDate: '2026-01-01', asOf: '2026-03-01', disputed: true });
  assert.equal(disputed.interestCents, 0);
  assert.equal(disputed.lateFeeCents, 0);

  const paid = assessLatePayment({ principalCents: 100_000, dueDate: '2026-01-01', asOf: '2026-03-01', paymentsCents: 60_000 });
  assert.equal(paid.eligiblePrincipalCents, 40_000);
  assert.ok(paid.interestCents < overdue.interestCents);
  assert.equal(legalPolicyConfig.activation.interest, false);
});

test('combined late fee and interest is flagged when it exceeds the conservative usury guard', () => {
  const review = reviewLateChargeCompliance(10_000, 30, 2_500);
  assert.equal(review.exceedsEighteenPercent, true);
  assert.equal(review.requiresOwnerOrLegalReview, true);
  const small = reviewLateChargeCompliance(100_000, 365, 2_500);
  assert.equal(small.exceedsEighteenPercent, false);
});
test('post-judgment interest is simple and lien deadlines are ten/twenty years', () => {
  const interest = assessPostJudgmentInterest({
    judgmentPrincipalCents: 1_000_000,
    judgmentDate: '2026-01-01',
    asOf: '2027-01-01',
    annualRateBps: 787,
  });
  assert.equal(interest.compounding, false);
  assert.equal(interest.daysAccrued, 365);
  assert.equal(interest.interestCents, 78_700);

  const deadlines = judgmentLienDeadlines('2026-01-01', '2026-02-01');
  assert.equal(deadlines.initialLienExpiresOn, '2036-02-01');
  assert.equal(deadlines.outerLimitOn, '2046-01-01');
  assert.match(deadlines.note, /judgment lien|recorded/i);
});

test('collection stages preserve disputes and require final demand before review', () => {
  assert.equal(collectionStage({ daysPastDue: 0 }), 'current');
  assert.equal(collectionStage({ daysPastDue: 8 }), 'reminder');
  assert.equal(collectionStage({ daysPastDue: 20 }), 'demand');
  assert.equal(collectionStage({ daysPastDue: 35 }), 'final_demand');
  assert.equal(collectionStage({ daysPastDue: 35, finalDemandSentAt: '2026-02-01' }), 'collections_review');
  assert.equal(collectionStage({ daysPastDue: 35, disputed: true }), 'dispute_hold');
});
