/**
 * Central config for optional customer gratuities.
 *
 * The customer always starts at zero. Suggested amounts are presentation only;
 * the server validates every submitted amount against this file.
 */
export const tipsConfig = {
  /** Optional tips are offered on secure invoice payment pages. */
  enabled: true,
  /** Initial suggestions. These are not business rules and may be edited here. */
  suggestionsUsd: [10, 15, 25] as const,
  defaultCents: 0,
  minimumCents: 0,
  maximumCents: 100_000,
  linkTtlDays: 30,
  allocationRule: 'equal_participants',
} as const;

export function tipsEnabled(env: { TIPS_ENABLED?: string } = {}): boolean {
  return env.TIPS_ENABLED !== 'false' && tipsConfig.enabled;
}

export function normalizeTipCents(value: unknown): number {
  const parsed = Math.round(Number(value));
  if (!Number.isFinite(parsed)) return 0;
  return Math.min(tipsConfig.maximumCents, Math.max(tipsConfig.minimumCents, parsed));
}

export function suggestedTipCents(): number[] {
  return tipsConfig.suggestionsUsd.map((amount) => amount * 100);
}
