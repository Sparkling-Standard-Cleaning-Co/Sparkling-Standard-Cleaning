// Pricing tokens for owner-editable content copy.
//
// Markdown keeps its normal prose while supporting two tokens:
//   {{communityDiscount}} -> the configured Community Support percentage + %
//   {{churchDiscount}}    -> the configured church percentage + %
//
// This keeps public discount copy aligned when the owner changes a percentage
// in pricing-values.ts. It is intentionally a tiny presentation helper, not a
// second pricing system.

import { pricing } from '../../config/pricing.ts';

export function replacePricingTokens<T>(value: T): T {
  const tokens: Record<string, string> = {
    '{{communityDiscount}}': `${pricing.supportiveHomeDiscount.percent.value}%`,
    '{{churchDiscount}}': `${pricing.churchDiscount.percent.value}%`,
  };

  const walk = (entry: unknown): unknown => {
    if (typeof entry === 'string') {
      let next = entry;
      for (const [token, replacement] of Object.entries(tokens)) {
        next = next.replaceAll(token, replacement);
      }
      return next;
    }
    if (Array.isArray(entry)) return entry.map(walk);
    if (entry && typeof entry === 'object') {
      return Object.fromEntries(
        Object.entries(entry as Record<string, unknown>).map(([key, child]) => [key, walk(child)]),
      );
    }
    return entry;
  };

  return walk(value) as T;
}
