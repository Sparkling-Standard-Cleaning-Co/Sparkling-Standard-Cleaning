// Condition handling — how the home's current state changes expected labor.

import { pricing, type PricingConfig } from '../../config/pricing.ts';
import type { Condition, LastProfessionalClean, CalculationTraceEntry } from './types.ts';

export function conditionFactor(condition: Condition, config: PricingConfig = pricing): number {
  const entry = config.conditionFactors[condition];
  return entry ? entry.value : 1.1;
}

/** Severe condition is never instantly priced (directive §27). */
export function isSevereCondition(condition: Condition): boolean {
  return condition === 'severe';
}

export function conditionTrace(condition: Condition): CalculationTraceEntry {
  return {
    step: 'condition',
    detail: `Condition "${condition}" × ${conditionFactor(condition)}`,
    value: conditionFactor(condition),
  };
}

/** Conservative default when the customer is unsure (flagged for review). */
export function lastCleanFactor(lastClean: LastProfessionalClean | undefined, config: PricingConfig = pricing): number {
  if (!lastClean) return 1.05;
  return config.lastCleanFactors[lastClean]?.value ?? 1.05;
}
