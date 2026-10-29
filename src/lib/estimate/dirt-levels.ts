// Owner-directed 10-level dirt guide (2026-10-29).
//
// The guide is the customer-facing way to describe the home's current
// workload. It does NOT create a second pricing model: every level maps to one
// of the existing five condition tiers, whose multipliers already drive the
// labor-hour calculation, visit duration and owner review rules.

import type { Condition } from '../../config/pricing.ts';

export type DirtLevel = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;

export interface DirtLevelDefinition {
  level: DirtLevel;
  label: string;
  description: string;
  /** Plain-language workload note shown with the selected level. */
  impact: string;
  /** The existing condition tier this level uses in the pricing model. */
  condition: Condition;
}

export const DIRT_LEVELS: readonly DirtLevelDefinition[] = [
  {
    level: 1,
    label: 'Disney Princess Clean',
    description:
      'Already sparkling. You mainly need light maintenance: dusting, surfaces, floors and bathrooms.',
    impact: 'Light maintenance',
    condition: 'maintained',
  },
  {
    level: 2,
    label: 'Tidy & Well-Kept',
    description:
      'Tidy and well-kept. A little dust and normal daily use, but no areas need extra scrubbing.',
    impact: 'Routine upkeep',
    condition: 'maintained',
  },
  {
    level: 3,
    label: 'Regular Home Lived-In Clean',
    description:
      'A regular lived-in home. Normal dust, kitchen and bathroom use, and floors that need routine attention.',
    impact: 'Standard lived-in home',
    condition: 'average',
  },
  {
    level: 4,
    label: 'Weekly Cleaning Needed',
    description:
      'Weekly cleaning is slipping. Visible dust, bathroom film or kitchen grease is starting to build.',
    impact: 'Frequent upkeep',
    condition: 'average',
  },
  {
    level: 5,
    label: 'Surface Clean but Needs Elbow Grease',
    description:
      'It looks surface-clean, but edges, fixtures and corners need extra scrubbing and detail time.',
    impact: 'Extra detail time',
    condition: 'needs_attention',
  },
  {
    level: 6,
    label: 'It’s Been a While',
    description:
      'It has been a while. Buildup in bathrooms, kitchens and floors will take extra detail time.',
    impact: 'Catch-up detail',
    condition: 'needs_attention',
  },
  {
    level: 7,
    label: 'Deep Clean Recommended',
    description:
      'A deep clean is recommended. Multiple rooms need detail work beyond routine maintenance.',
    impact: 'Deep-clean workload',
    condition: 'heavy',
  },
  {
    level: 8,
    label: 'Multiple Areas Need Heavy Detail',
    description:
      'Several areas need heavy detail: noticeable buildup, grime or neglected corners across the home.',
    impact: 'Heavy-detail workload',
    condition: 'heavy',
  },
  {
    level: 9,
    label: 'Move-In/Out Level Dirty',
    description:
      'Move-in/move-out level. Empty-home detail, inside cabinets or appliances and heavy buildup are likely.',
    impact: 'Move-in / move-out workload',
    condition: 'heavy',
  },
  {
    level: 10,
    label: 'Full Restoration Clean',
    description:
      'Full restoration. Long-neglected or extreme conditions need a personal scope review before we quote.',
    impact: 'Personal scope review',
    condition: 'severe',
  },
] as const;

/** Parses a submitted level into the canonical 1–10 union, or null. */
export function parseDirtLevel(value: unknown): DirtLevel | null {
  const numeric =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim() !== ''
        ? Number(value)
        : Number.NaN;
  if (!Number.isInteger(numeric) || numeric < 1 || numeric > 10) return null;
  return numeric as DirtLevel;
}

export function dirtLevelDefinition(level: DirtLevel | null | undefined): DirtLevelDefinition | null {
  if (level === null || level === undefined) return null;
  return DIRT_LEVELS.find((definition) => definition.level === level) ?? null;
}

/** The existing five-tier condition used by the pricing model. */
export function conditionForDirtLevel(level: DirtLevel | null | undefined): Condition | null {
  return dirtLevelDefinition(level)?.condition ?? null;
}

export function dirtLevelLabel(level: DirtLevel | null | undefined): string {
  const definition = dirtLevelDefinition(level);
  return definition ? `Level ${definition.level} — ${definition.label}` : '';
}
