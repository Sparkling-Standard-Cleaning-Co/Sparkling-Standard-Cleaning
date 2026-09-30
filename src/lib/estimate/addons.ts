// Add-on selection — maps chosen ids to labor contributions and flags the
// items that can never be instantly priced (specialty equipment, etc.).

import { pricing } from '../../config/pricing.ts';
import type { SelectedAddon } from './types.ts';

export interface AddonSelection {
  selected: SelectedAddon[];
  totalLaborHours: number;
  hasCustomQuoteAddon: boolean;
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
      customQuote: definition.customQuote,
    });
    totalLaborHours += definition.laborHours ?? 0;
    if (definition.customQuote) hasCustomQuoteAddon = true;
  }

  return { selected, totalLaborHours, hasCustomQuoteAddon };
}
