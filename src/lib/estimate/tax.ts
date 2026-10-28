// Florida sales-tax presentation for estimates (Initiative 6.2).
//
// This module NEVER computes a tax rate or a tax amount. It provides the
// transparent, legally appropriate language every estimate needs until the
// owner has a confirmed tax configuration for the service address. The rules
// below are taken from official Florida Department of Revenue guidance:
//
//  - Nonresidential cleaning services are taxable at Florida's 6% state rate
//    plus any applicable county discretionary sales surtax.
//    FDOR "Sales and Use Tax on Cleaning Services" (GT-800015);
//    Rule 12A-1.0091(1)(a), F.A.C.
//  - Residential cleaning services are not taxable, including residential
//    rentals, even when the rental itself is taxable.
//    Rule 12A-1.0091(1)(b), F.A.C.; GT-800015.
//  - A mandatory cleaning fee charged by a host to a guest is part of the
//    taxable transient rental charge. That is the host's charge, not this
//    company's cleaning charge to the host. FDOR TIP 99A01-42; GT-800015.
//  - Sales to nonprofit/governmental organizations are exempt when the seller
//    receives a current Florida Consumer's Certificate of Exemption (DR-14)
//    and payment is made directly by the exempt organization. GT-800015;
//    Rule 12A-1.038, F.A.C.
//
// Sources:
//   https://floridarevenue.com/Forms_library/current/brochure/gt800015.pdf
//   https://www.flrules.org/gateway/ruleNo.asp?id=12A-1.0091
//   https://floridarevenue.com/taxes/tips/documents/TIP_99A01-42.pdf
//
// No rate is configured here because the applicable county surtax depends on
// the confirmed service address and current DR-15DSS rates. Estimates show
// "+ applicable tax" where tax may apply; the final quote/invoice confirms
// the exact amount. Tax is never folded into the cleaning price, a discount,
// the engine calibration factor or travel.

export type TaxTreatment = 'not_taxable' | 'taxable_pending' | 'exemption_pending' | 'unknown';

export interface TaxPresentation {
  treatment: TaxTreatment;
  /** Compact label shown beside a numerical estimate. */
  label: string;
  /** One-line customer-facing explanation. */
  note: string;
  /** Whether a tax amount may apply to the final confirmed invoice. */
  mayApply: boolean;
}

const RESIDENTIAL_NOTE =
  'Florida does not impose sales tax on cleaning services for residential facilities.';
const STR_NOTE =
  'Cleaning billed to the property owner or host for a residential rental is not taxable. A mandatory cleaning fee a host charges guests is part of the host’s taxable transient rental charge.';
const COMMERCIAL_NOTE =
  'Nonresidential cleaning is subject to Florida’s 6% state sales tax plus the county discretionary sales surtax for the confirmed service address. The exact tax is calculated from that address; if the jurisdiction cannot be verified, online payment is withheld until it is confirmed.';
const CHURCH_NOTE =
  'Nonresidential cleaning is taxable unless the church provides a current Florida Consumer’s Certificate of Exemption (Form DR-14) and pays directly. The exact tax is calculated from the confirmed service address; any exemption is verified before it is applied.';
const UNKNOWN_NOTE =
  'Sales-tax treatment will be confirmed with your final quote for the service address.';

const PRESENTATIONS: Record<'residential' | 'str' | 'commercial' | 'church' | 'unknown', TaxPresentation> = {
  residential: {
    treatment: 'not_taxable',
    label: 'No sales tax applicable',
    note: RESIDENTIAL_NOTE,
    mayApply: false,
  },
  str: {
    treatment: 'not_taxable',
    label: 'No sales tax applicable',
    note: STR_NOTE,
    mayApply: false,
  },
  commercial: {
    treatment: 'taxable_pending',
    label: '+ applicable tax',
    note: COMMERCIAL_NOTE,
    mayApply: true,
  },
  church: {
    treatment: 'exemption_pending',
    label: '+ applicable tax unless exempt',
    note: CHURCH_NOTE,
    mayApply: true,
  },
  unknown: {
    treatment: 'unknown',
    label: '+ applicable tax',
    note: UNKNOWN_NOTE,
    mayApply: true,
  },
};

/**
 * Maps a submitted/selected service to its tax presentation. Unknown values
 * fail transparently (never silently "no tax").
 */
export function taxPresentationForService(serviceType: string | null | undefined): TaxPresentation {
  switch ((serviceType ?? '').trim().toLowerCase()) {
    case 'standard':
    case 'deep':
    case 'move_in_out':
    case 'house':
    case 'residential':
      return PRESENTATIONS.residential;
    case 'str_turnover':
    case 'str':
      return PRESENTATIONS.str;
    case 'commercial_cleaning':
    case 'commercial':
      return PRESENTATIONS.commercial;
    case 'church_cleaning':
    case 'church':
      return PRESENTATIONS.church;
    default:
      return PRESENTATIONS.unknown;
  }
}

/** Official source references retained for documentation and tests. */
export const TAX_SOURCES = {
  cleaningServicesBrochure: 'https://floridarevenue.com/Forms_library/current/brochure/gt800015.pdf',
  cleaningServicesRule: 'https://www.flrules.org/gateway/ruleNo.asp?id=12A-1.0091',
  transientRentalTip: 'https://floridarevenue.com/taxes/tips/documents/TIP_99A01-42.pdf',
  surtaxRates: 'https://floridarevenue.com/taxes/rates',
} as const;
