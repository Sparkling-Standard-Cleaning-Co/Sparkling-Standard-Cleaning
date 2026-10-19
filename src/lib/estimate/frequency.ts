// Frequency handling — recurring homes are more maintainable, so the same
// home takes less labor per visit. This is a labor-efficiency model, not a
// stacked marketing discount (directive §28).

import { pricing } from '../../config/pricing.ts';
import { schedulingConfig } from '../../config/scheduling.ts';
import type { Frequency, LastProfessionalClean } from './types.ts';

export function frequencyFactor(frequency: Frequency, serviceType: string): number {
  // Frequency efficiency only applies to repeatable residential cleaning.
  // Move-outs and STR turnovers are always one-off scopes.
  if (serviceType === 'move_in_out' || serviceType === 'str_turnover') return 1.0;
  return pricing.frequencyFactors[frequency]?.value ?? 1.0;
}

/**
 * Owner policy (2026-10-19): a new recurring residential maintenance
 * arrangement always begins with a Deep Cleaning. Standard recurring requests
 * carry the requirement; one-off scopes do not.
 */
export function requiresInitialDeepClean(serviceType: string, frequency: Frequency): boolean {
  return (
    schedulingConfig.recurringResidential.requiresInitialDeepClean &&
    serviceType === 'standard' &&
    frequency !== 'one_time'
  );
}

/**
 * Recurring reset suggestion for returning clients whose home has been
 * neglected. The mandatory first-visit requirement is handled separately by
 * requiresInitialDeepClean().
 */
export function recurringResetSuggested(
  frequency: Frequency,
  lastClean: LastProfessionalClean | undefined,
): boolean {
  if (frequency === 'one_time' || !lastClean) return false;
  return (pricing.recurringReset.flagWhenLastCleanIn as readonly string[]).includes(lastClean);
}
