// Shared customer-facing currency formatting.
//
// Whole-dollar amounts stay clean ($145); fractional amounts always show both
// cents ($14.50, $130.50). `forceCents` is used where a reconciliation line
// should always show two decimals (e.g. a discount line).

export function formatUsd(value: number | null | undefined, options: { forceCents?: boolean } = {}): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  const rounded = Math.round((value + Number.EPSILON) * 100) / 100;
  const fractional = Math.round(rounded * 100) % 100 !== 0;
  const digits = options.forceCents || fractional ? 2 : 0;
  return `$${rounded.toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: 2,
  })}`;
}
