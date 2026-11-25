/**
 * Owner-facing duration formatting.
 *
 * Pricing calculations keep their exact floating-point labor hours. These
 * helpers round only the presentation to the scheduling grid (15 minutes) and
 * never feed the rounded value back into a price.
 */

export const SCHEDULING_INCREMENT_MINUTES = 15;

export function roundMinutesToIncrement(minutes: number, increment = SCHEDULING_INCREMENT_MINUTES): number {
  if (!Number.isFinite(minutes) || minutes <= 0) return 0;
  const step = Math.max(1, Math.trunc(increment));
  return Math.round(minutes / step) * step;
}

export function roundHoursToIncrement(hours: number, increment = SCHEDULING_INCREMENT_MINUTES): number {
  if (!Number.isFinite(hours) || hours <= 0) return 0;
  return roundMinutesToIncrement(hours * 60, increment) / 60;
}

/** "7 hours", "4 hours 15 minutes", "45 minutes". */
export function formatDurationMinutes(minutes: number): string {
  const rounded = roundMinutesToIncrement(minutes);
  if (rounded <= 0) return '0 minutes';
  const hours = Math.floor(rounded / 60);
  const remainder = rounded % 60;
  if (hours === 0) return `${remainder} minute${remainder === 1 ? '' : 's'}`;
  if (remainder === 0) return `${hours} hour${hours === 1 ? '' : 's'}`;
  return `${hours} hour${hours === 1 ? '' : 's'} ${remainder} minute${remainder === 1 ? '' : 's'}`;
}

export function formatDurationHours(hours: number): string {
  return formatDurationMinutes(hours * 60);
}

export function formatLaborHours(hours: number | null | undefined): string {
  if (hours === null || hours === undefined || !Number.isFinite(hours)) return 'Not calculated';
  return `Estimated labor: ${formatDurationHours(hours)}`;
}

export function formatOnSiteMinutes(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined || !Number.isFinite(minutes)) return 'Expected time on site: not calculated';
  return `Expected time on site: ${formatDurationMinutes(minutes)}`;
}

export function formatLaborAndSite(
  laborHours: number | null | undefined,
  onSiteMinutes: number | null | undefined,
): string {
  return `${formatLaborHours(laborHours)} · ${formatOnSiteMinutes(onSiteMinutes)}`;
}
