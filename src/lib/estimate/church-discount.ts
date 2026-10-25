// Owner-directed church discount (2026-10-24).
//
// Terms implemented exactly as directed:
//  - 10% off eligible CHURCH cleaning services.
//  - The normal cleaning subtotal is calculated first; the reduction is then
//    applied to that subtotal.
//  - The minimum-job rule applies BEFORE the discount, so the promised
//    benefit is never silently erased by the floor.
//  - Travel and third-party costs are excluded.
//  - Exactly one promotion may apply; the church discount never stacks.
//  - This is a SERVICE DISCOUNT, never a charitable donation or a
//    tax-deductible tithe, and it is never described as one.

import { pricing } from '../../config/pricing.ts';

export interface ChurchDiscountResult {
  enabled: boolean;
  applied: boolean;
  percent: number;
  /** Whole cents off the cleaning subtotal (0 when not applied). */
  amount: number;
  /** Cleaning subtotal after the discount (input unchanged when not applied). */
  discountedSubtotal: number;
  label: string;
  termsVersion: string;
  /** Customer-safe reason when the benefit could not apply. */
  reason?: string;
}

export interface ChurchDiscountOptions {
  /** True when another promotion already applies; stacking is prohibited. */
  otherDiscountApplied?: boolean;
}

export function calculateChurchDiscount(
  cleaningSubtotalUsd: number,
  options: ChurchDiscountOptions = {},
): ChurchDiscountResult {
  const enabled = pricing.churchDiscount.enabled.value;
  const percent = pricing.churchDiscount.percent.value;
  const label = '10% church discount';
  const termsVersion = pricing.churchDiscount.termsVersion.value;
  const subtotal = Number.isFinite(cleaningSubtotalUsd) && cleaningSubtotalUsd > 0 ? cleaningSubtotalUsd : 0;

  const base: ChurchDiscountResult = {
    enabled,
    applied: false,
    percent,
    amount: 0,
    discountedSubtotal: subtotal,
    label,
    termsVersion,
  };

  if (!enabled || percent <= 0 || subtotal <= 0) return base;
  if (options.otherDiscountApplied) {
    return {
      ...base,
      reason: 'The church discount cannot be combined with another promotion.',
    };
  }

  const amount = Math.round(subtotal * percent) / 100;
  return {
    ...base,
    applied: true,
    amount,
    discountedSubtotal: Math.max(0, Math.round((subtotal - amount) * 100) / 100),
  };
}
