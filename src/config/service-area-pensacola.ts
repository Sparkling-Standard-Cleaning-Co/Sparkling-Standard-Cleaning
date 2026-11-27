// Pensacola service-area inventory derived from the canonical geography config
// and the verified 2020 Census ZCTA-to-county relationship snapshot.
//
// This is an administrative reference only. It does not change coverage, add
// ZIPs or make an extended ZIP instantly bookable.

import { zipReference, zoneForZip, type ServiceZone } from './geography.ts';

export interface PensacolaServiceAreaEntry {
  zip: string;
  city: string;
  state: 'FL' | 'AL';
  zone: ServiceZone;
  counties: string[];
  direct: boolean;
  arrangement: boolean;
}

export const PENSACOLA_ZIP_COUNTIES: Readonly<Record<string, readonly string[]>> = {
  '32501': ['Escambia'],
  '32502': ['Escambia'],
  '32503': ['Escambia'],
  '32504': ['Escambia'],
  '32505': ['Escambia'],
  '32506': ['Escambia'],
  '32507': ['Escambia'],
  '32508': ['Escambia'],
  '32511': ['Escambia'],
  '32514': ['Escambia'],
  '32526': ['Escambia'],
  '32533': ['Escambia'],
  '32534': ['Escambia'],
  '32530': ['Santa Rosa'],
  '32561': ['Escambia', 'Santa Rosa'],
  '32563': ['Santa Rosa'],
  '32565': ['Santa Rosa'],
  '32566': ['Santa Rosa'],
  '32570': ['Santa Rosa'],
  '32571': ['Santa Rosa'],
  '32577': ['Escambia'],
  '32583': ['Santa Rosa'],
  '36426': ['Escambia', 'Conecuh'],
  '36502': ['Escambia', 'Baldwin', 'Monroe', 'Conecuh'],
  '36507': ['Baldwin'],
  '36526': ['Baldwin'],
  '36527': ['Baldwin'],
  '36530': ['Baldwin'],
  '36532': ['Baldwin'],
  '36535': ['Baldwin'],
  '36542': ['Baldwin'],
  '36551': ['Baldwin'],
  '36561': ['Baldwin'],
  '36567': ['Baldwin'],
  '36580': ['Baldwin'],
};

const DIRECT_ZONES = new Set<ServiceZone>(['core', 'surrounding']);

export function pensacolaServiceAreaEntry(zip: string): PensacolaServiceAreaEntry | null {
  const reference = zipReference[zip];
  if (!reference) return null;
  const counties = [...(PENSACOLA_ZIP_COUNTIES[zip] ?? [])];
  const zone = zoneForZip(zip);
  return {
    zip,
    city: reference.city,
    state: reference.state,
    zone,
    counties,
    direct: reference.state === 'FL' && DIRECT_ZONES.has(zone),
    arrangement: zone === 'extended',
  };
}

export interface PensacolaServiceAreaGroup {
  key: string;
  label: string;
  detail: string;
  entries: PensacolaServiceAreaEntry[];
}

export function pensacolaServiceAreaGroups(zips: readonly string[]): PensacolaServiceAreaGroup[] {
  const entries = [...new Set(zips)].sort().map(pensacolaServiceAreaEntry).filter((entry): entry is PensacolaServiceAreaEntry => Boolean(entry));
  const directGroups: Array<{ key: string; label: string; detail: string; county: string; state: 'FL' | 'AL' }> = [
    { key: 'escambia-fl', label: 'Escambia County, Florida', detail: 'Direct Pensacola and Cantonment coverage.', county: 'Escambia', state: 'FL' },
    { key: 'santa-rosa-fl', label: 'Santa Rosa County, Florida', detail: 'Direct surrounding-community coverage.', county: 'Santa Rosa', state: 'FL' },
    { key: 'baldwin-al', label: 'Baldwin County, Alabama', detail: 'Nearby Alabama communities confirmed as inquiries or by arrangement.', county: 'Baldwin', state: 'AL' },
  ];
  const groups = directGroups.map((group) => ({
    key: group.key,
    label: group.label,
    detail: group.detail,
    entries: entries.filter(
      (entry) => entry.state === group.state && entry.counties.length === 1 && entry.counties[0] === group.county,
    ),
  }));
  const cross = entries.filter((entry) => entry.counties.length > 1);
  groups.push({
    key: 'cross-county',
    label: 'Cross-county ZIP codes',
    detail: 'Shared ZIP boundaries are assigned from the confirmed service address county, not the ZIP alone.',
    entries: cross,
  });
  return groups;
}

export function pensacolaServiceAreaSummary(zips: readonly string[]): {
  total: number;
  direct: number;
  arrangement: number;
  crossCounty: number;
  unknown: number;
} {
  const entries = zips.map(pensacolaServiceAreaEntry);
  return {
    total: entries.filter(Boolean).length,
    direct: entries.filter((entry) => entry?.direct).length,
    arrangement: entries.filter((entry) => entry?.arrangement).length,
    crossCounty: entries.filter((entry) => (entry?.counties.length ?? 0) > 1).length,
    unknown: entries.filter((entry) => !entry).length,
  };
}
