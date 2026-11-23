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
import { EMAIL_ROUTING } from './email-routing.ts';

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

export interface BranchCapabilities {
  readonly marketing: boolean;
  readonly inquiries: boolean;
  readonly commercialLeads: boolean;
  readonly pricingConfigured: boolean;
  readonly publicEstimates: boolean;
  readonly scheduling: boolean;
  readonly payments: boolean;
  readonly fulfillmentVerified: boolean;
  readonly googleProfileVerified: boolean;
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
  readonly capabilities: BranchCapabilities;
  readonly serviceAreaZips: ReadonlyArray<string>;
  readonly serviceStates: ReadonlyArray<'FL' | 'AL'>;
  readonly serviceCounties: ReadonlyArray<string>;
  readonly travelLimitMiles: number;
  readonly publicPhone: string;
  readonly publicEmail: string;
  readonly hoursLabel: string;
  readonly gbpStatus: 'not_created' | 'eligibility_review' | 'prepared' | 'submitted' | 'verified' | 'paused';
  readonly gbpUrl: string;
  /** Official Google review link for this branch. Empty until the owner supplies one. */
  readonly reviewUrl: string;
  readonly launchNote: string;
}

const tampaZips = [
  '33503', '33510', '33511', '33523', '33525', '33527', '33530', '33534', '33540', '33541',
  '33542', '33543', '33544', '33545', '33547', '33548', '33549', '33550', '33556', '33558',
  '33559', '33563', '33565', '33566', '33567', '33569', '33570', '33572', '33573', '33574',
  '33576', '33578', '33579', '33584', '33592', '33594', '33596', '33597', '33598', '33602',
  '33603', '33604', '33605', '33606', '33607', '33609', '33610', '33611', '33612', '33613',
  '33614', '33615', '33616', '33617', '33618', '33619', '33620', '33621', '33624', '33625',
  '33626', '33629', '33634', '33635', '33637', '33647', '33701', '33702', '33703', '33704',
  '33705', '33706', '33707', '33708', '33709', '33710', '33711', '33712', '33713', '33714',
  '33715', '33716', '33744', '33755', '33756', '33759', '33760', '33761', '33762', '33763',
  '33764', '33765', '33767', '33770', '33771', '33772', '33773', '33774', '33776', '33777',
  '33778', '33781', '33782', '33785', '33786', '33809', '33810', '33849', '33860', '34610',
  '34609', '34637', '34638', '34639', '34652', '34653', '34654', '34655', '34667', '34668', '34669',
  '34677', '34679', '34681', '34683', '34684', '34685', '34688', '34689', '34690', '34691',
  '34695', '34698',
] as const;

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
    capabilities: {
      marketing: true,
      inquiries: true,
      commercialLeads: true,
      pricingConfigured: true,
      publicEstimates: true,
      scheduling: true,
      payments: true,
      fulfillmentVerified: true,
      googleProfileVerified: true,
    },
    serviceAreaZips: pensacolaZips(),
    serviceStates: ['FL', 'AL'],
    serviceCounties: ['Escambia County, FL', 'Santa Rosa County, FL', 'Baldwin County, AL', 'Escambia County, AL'],
    travelLimitMiles: 45,
    publicPhone: '(850) 426-8479',
    publicEmail: EMAIL_ROUTING.customerService,
    hoursLabel: sevenDays,
    gbpStatus: 'verified',
    gbpUrl: 'https://www.google.com/search?kgmid=/g/11zz5t1059&hl=en-US&q=Sparkling+Standard+Cleaning+Co.',
    reviewUrl: 'https://g.page/r/CXAcv1Pp7OI2ECE/review',
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
    publishedPricingAllowed: true,
    services: {
      residential: 'request_only',
      str: 'disabled',
      commercial: 'request_only',
      church: 'request_only',
    },
    capabilities: {
      marketing: true,
      inquiries: true,
      commercialLeads: true,
      pricingConfigured: false,
      publicEstimates: false,
      scheduling: false,
      payments: false,
      fulfillmentVerified: false,
      googleProfileVerified: false,
    },
    serviceAreaZips: [...tampaZips],
    serviceStates: ['FL'],
    serviceCounties: ['Pasco County, FL', 'Pinellas County, FL', 'Hillsborough County, FL'],
    travelLimitMiles: 20,
    publicPhone: '',
    publicEmail: EMAIL_ROUTING.customerService,
    hoursLabel: 'By appointment after launch',
    gbpStatus: 'not_created',
    gbpUrl: '',
    reviewUrl: '',
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
