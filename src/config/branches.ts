// Canonical operating-branch definitions.
//
// One legal entity, two operating branches. These IDs are stable and must be
// reused by data, pricing, documents and reporting. The database can advance a
// branch lifecycle, but it can never invent a new branch identity here.
//
// Public pages and server routes treat only a `live` branch as bookable and
// payable. Tampa Bay is prepared in `setup` and must remain prelaunch until its
// staffing, licensing, insurance, tax, capacity and Google Business Profile
// eligibility are verified by the owner.

import { zipReference } from './geography.ts';

export const BRANCH_PENSACOLA = 'branch_pensacola' as const;
export const BRANCH_TAMPA = 'branch_tampa' as const;

export type BranchId = typeof BRANCH_PENSACOLA | typeof BRANCH_TAMPA;

export type BranchLifecycle =
  | 'draft'
  | 'setup'
  | 'internally_testable'
  | 'approved_to_launch'
  | 'live'
  | 'paused'
  | 'retired';

export type ServiceMode = 'disabled' | 'request_only' | 'estimate_enabled' | 'bookable';

export interface BranchServiceMode {
  readonly residential: ServiceMode;
  readonly str: ServiceMode;
  readonly commercial: ServiceMode;
  readonly church: ServiceMode;
}

export interface BranchPublicConfig {
  readonly id: BranchId;
  readonly name: string;
  readonly publicName: string;
  readonly publicSlug: string;
  readonly regionLabel: string;
  readonly timezone: string;
  readonly lifecycle: BranchLifecycle;
  readonly publicPage: boolean;
  readonly indexable: boolean;
  readonly bookable: boolean;
  readonly paymentsEnabled: boolean;
  readonly publishedPricingAllowed: boolean;
  readonly services: BranchServiceMode;
  readonly serviceAreaZips: ReadonlyArray<string>;
  readonly serviceStates: ReadonlyArray<'FL' | 'AL'>;
  readonly publicPhone: string;
  readonly publicEmail: string;
  readonly hoursLabel: string;
  readonly gbpStatus: 'not_created' | 'eligibility_review' | 'prepared' | 'submitted' | 'verified' | 'paused';
  readonly gbpUrl: string;
  readonly launchNote: string;
}

const sevenDays = 'Seven days a week, 7:00 a.m. - 7:00 p.m.';

function pensacolaZips(): string[] {
  return Object.keys(zipReference).sort();
}

export const branchConfigs: Readonly<Record<BranchId, BranchPublicConfig>> = {
  [BRANCH_PENSACOLA]: {
    id: BRANCH_PENSACOLA,
    name: 'Pensacola',
    publicName: 'Pensacola',
    publicSlug: 'pensacola',
    regionLabel: 'Pensacola & surrounding communities',
    timezone: 'America/Chicago',
    lifecycle: 'live',
    publicPage: true,
    indexable: true,
    bookable: true,
    paymentsEnabled: true,
    publishedPricingAllowed: true,
    services: {
      residential: 'bookable',
      str: 'estimate_enabled',
      commercial: 'estimate_enabled',
      church: 'estimate_enabled',
    },
    serviceAreaZips: pensacolaZips(),
    serviceStates: ['FL', 'AL'],
    publicPhone: '(850) 426-8479',
    publicEmail: 'owner@sparkling-standard.com',
    hoursLabel: sevenDays,
    gbpStatus: 'verified',
    gbpUrl: 'https://www.google.com/search?kgmid=/g/11zz5t1059&hl=en-US&q=Sparkling+Standard+Cleaning+Co.',
    launchNote: '',
  },
  [BRANCH_TAMPA]: {
    id: BRANCH_TAMPA,
    name: 'Tampa Bay (future)',
    publicName: 'Tampa Bay',
    publicSlug: 'tampa-bay',
    regionLabel: 'Tampa Bay prelaunch',
    timezone: 'America/New_York',
    lifecycle: 'setup',
    publicPage: true,
    indexable: false,
    bookable: false,
    paymentsEnabled: false,
    publishedPricingAllowed: false,
    services: {
      residential: 'request_only',
      str: 'disabled',
      commercial: 'request_only',
      church: 'request_only',
    },
    serviceAreaZips: [],
    serviceStates: ['FL'],
    publicPhone: '',
    publicEmail: 'owner@sparkling-standard.com',
    hoursLabel: 'By appointment after launch',
    gbpStatus: 'not_created',
    gbpUrl: '',
    launchNote:
      'Tampa Bay is preparing for a future launch. No online booking, payment, published pricing or local Google Business Profile is active yet.',
  },
};

export const branchList: ReadonlyArray<BranchPublicConfig> = Object.values(branchConfigs);

export function branchConfig(id: string | null | undefined): BranchPublicConfig | null {
  if (!id) return null;
  return (branchConfigs as Record<string, BranchPublicConfig>)[id] ?? null;
}

export function branchByPublicSlug(slug: string | null | undefined): BranchPublicConfig | null {
  if (!slug) return null;
  return branchList.find((branch) => branch.publicSlug === slug) ?? null;
}

export function isPubliclyBookable(id: string | null | undefined): boolean {
  return branchConfig(id)?.bookable === true;
}

export function isPubliclyIndexable(id: string | null | undefined): boolean {
  const branch = branchConfig(id);
  return Boolean(branch?.publicPage && branch.indexable && branch.lifecycle === 'live');
}
