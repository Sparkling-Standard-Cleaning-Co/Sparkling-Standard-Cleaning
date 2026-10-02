// Add-on selection — maps chosen ids to labor contributions and flags the
// items that can never be instantly priced (specialty equipment, etc.).
//
// ONE charge resolution path for every non-specialty add-on: an owner-set
// fixed price when present, otherwise labor-hours × the applicable rate. The
// estimator uses this helper for the per-add-on display, the selected extras,
// the add-on subtotal and the instant quote, so those values cannot drift.

import { pricing } from '../../config/pricing.ts';
import type { AddonDefinition } from '../../config/pricing.ts';
import type { SelectedAddon } from './types.ts';

export interface AddonSelection {
  selected: SelectedAddon[];
  totalLaborHours: number;
  hasCustomQuoteAddon: boolean;
}

/** The definition fields the charge resolver needs. */
export type AddonChargeDefinition = Pick<AddonDefinition, 'customQuote' | 'laborHours' | 'fixedPriceUsd'>;

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Resolves the charge for one add-on:
 *  - `null` for custom-quote (specialty) work — never priced instantly;
 *  - the owner-set fixed price when `fixedPriceUsd` is a positive finite
 *    number;
 *  - otherwise `laborHours × ratePerLaborHour`.
 * Labor-hours are untouched by a fixed price: scheduling still uses them.
 */
export function resolveAddonCharge(
  definition: AddonChargeDefinition,
  ratePerLaborHour: number,
): number | null {
  if (definition.customQuote) return null;
  const fixed = definition.fixedPriceUsd;
  if (typeof fixed === 'number' && Number.isFinite(fixed) && fixed > 0) return round2(fixed);
  return round2((definition.laborHours ?? 0) * ratePerLaborHour);
}

export function selectAddons(addonIds: string[]): AddonSelection {
  const selected: SelectedAddon[] = [];
  let totalLaborHours = 0;
  let hasCustomQuoteAddon = false;

  for (const id of addonIds) {
    const definition = pricing.addons.items.find((item) => item.id === id);
    if (!definition) continue;
    selected.push({
      id: definition.id,
      label: definition.label,
      laborHours: definition.laborHours ?? 0,
      ...(definition.fixedPriceUsd !== undefined ? { fixedPriceUsd: definition.fixedPriceUsd } : {}),
      customQuote: definition.customQuote,
    });
    totalLaborHours += definition.laborHours ?? 0;
    if (definition.customQuote) hasCustomQuoteAddon = true;
  }

  return { selected, totalLaborHours, hasCustomQuoteAddon };
}
