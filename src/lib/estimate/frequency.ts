// Frequency handling — recurring homes are more maintainable, so the same
// home takes less labor per visit. This is a labor-efficiency model, not a
// stacked marketing discount (directive §28).

import { pricing } from '../../config/pricing.ts';
import type { Frequency, LastProfessionalClean } from './types.ts';

export function frequencyFactor(frequency: Frequency, serviceType: string): number {
  // Frequency efficiency only applies to repeatable residential cleaning.
  // Move-outs and STR turnovers are always one-off scopes.
  if (serviceType === 'move_in_out' || serviceType === 'str_turnover') return 1.0;
  return pricing.frequencyFactors[frequency]?.value ?? 1.0;
}

/**
 * Recurring reset suggestion (directive §29): flag — never force — an initial
 * detailed clean when a recurring customer's home has been neglected.
 */
export function recurringResetSuggested(
  frequency: Frequency,
  lastClean: LastProfessionalClean | undefined,
): boolean {
  if (frequency === 'one_time' || !lastClean) return false;
  return (pricing.recurringReset.flagWhenLastCleanIn as readonly string[]).includes(lastClean);
}
