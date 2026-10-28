/**
 * Service-location sales-tax configuration.
 *
 * The tax is determined by the jurisdiction where the cleaning is performed,
 * never by a billing address, mailing address or gift-recipient address.
 *
 * Florida rules (official):
 *  - Residential cleaning services are not taxable. Rule 12A-1.0091(1)(b),
 *    F.A.C.; FDOR GT-800015.
 *  - Nonresidential/commercial cleaning is taxable at 6% state plus the
 *    county discretionary sales surtax. Rule 12A-1.0091(1)(a); GT-800015.
 *  - A church is exempt only with a current Florida Consumer's Certificate of
 *    Exemption (Form DR-14) received before the sale and direct payment by the
 *    exempt organization. Rule 12A-1.038; GT-800015.
 *  - County surtax rates below are the calendar-year 2026 DR-15DSS rates.
 *    Santa Rosa's current components are shown by FDOR as expiring
 *    2026-12-31; the table therefore fails closed for dates after 2026-12-31
 *    until the owner verifies the next year's rates.
 *
 * Alabama rules (official):
 *  - Alabama sales tax applies to retail sales of tangible personal property
 *    and public amusements, not generally to building-cleaning services.
 *    Ala. Code §40-23-2; ADOR Sales Tax application.
 *  - Cleaning labor is therefore not taxed by this engine for Alabama service
 *    addresses. Materials/supplies the company purchases are a separate cost
 *    and not a customer tax line. Verify with the owner's tax adviser before
 *    the first Alabama commercial invoice; local business-license taxes are
 *    not sales tax and are not collected here.
 *
 * If the jurisdiction cannot be established safely, the result is
 * `review_required` and online payment is blocked rather than inventing a
 * rate. The owner can still confirm the quote personally.
 *
 * Sources:
 *  - https://floridarevenue.com/Forms_library/current/brochure/gt800015.pdf
 *  - https://www.flrules.org/gateway/ruleNo.asp?id=12A-1.0091
 *  - https://floridarevenue.com/Forms_library/current/dr15dss_26.pdf
 *  - https://pointmatch.floridarevenue.com/General/DiscretionarySalesSurtaxRates.aspx
 *  - https://www.revenue.alabama.gov/tax-types/sales-tax
 *  - https://law.justia.com/codes/alabama/title-40/chapter-23/article-1/division-1/section-40-23-2
 */

export type TaxTreatment = 'not_taxable' | 'taxable' | 'exempt' | 'review_required';

export type TaxServiceCategory = 'residential' | 'str' | 'commercial' | 'church' | 'unknown';

export interface ZipTaxJurisdiction {
  state: 'FL' | 'AL';
  county: string;
  /** Internal stable key, e.g. FL-Escambia. */
  key: string;
}

export interface CountyTaxRate {
  state: 'FL';
  county: string;
  stateRatePercent: number;
  countySurtaxPercent: number;
  /** Combined rate used for the tax line. */
  combinedRatePercent: number;
  effectiveFrom: string;
  effectiveThrough: string;
  source: string;
}

export const taxConfig = {
  /** Engine switch. Turn off only to force every quote to review_required. */
  enabled: true,
  /** The table is verified only through this date; later dates fail closed. */
  ratesVerifiedThrough: '2026-12-31',
  /** Alabama cleaning services are outside the Alabama sales-tax base. */
  alabamaServiceTaxable: false,
  /** Church exemption requires an owner-verified DR-14 on file. */
  churchExemptionRequiresCertificate: true,
  sources: {
    floridaCleaningBrochure:
      'https://floridarevenue.com/Forms_library/current/brochure/gt800015.pdf',
    floridaCleaningRule: 'https://www.flrules.org/gateway/ruleNo.asp?id=12A-1.0091',
    floridaSurtax2026: 'https://floridarevenue.com/Forms_library/current/dr15dss_26.pdf',
    floridaSurtaxTable:
      'https://pointmatch.floridarevenue.com/General/DiscretionarySalesSurtaxRates.aspx',
    alabamaSalesTax: 'https://www.revenue.alabama.gov/tax-types/sales-tax',
    alabamaStatute:
      'https://law.justia.com/codes/alabama/title-40/chapter-23/article-1/division-1/section-40-23-2',
  },
} as const;

/** Calendar-year 2026 Florida surtax rates for the approved service counties. */
export const floridaCountyTaxRates: Record<string, CountyTaxRate> = {
  'FL-Escambia': {
    state: 'FL',
    county: 'Escambia',
    stateRatePercent: 6,
    countySurtaxPercent: 1.5,
    combinedRatePercent: 7.5,
    effectiveFrom: '2026-01-01',
    effectiveThrough: '2026-12-31',
    source: 'FDOR Form DR-15DSS (calendar year 2026)',
  },
  'FL-Santa Rosa': {
    state: 'FL',
    county: 'Santa Rosa',
    stateRatePercent: 6,
    countySurtaxPercent: 1,
    combinedRatePercent: 7,
    effectiveFrom: '2026-01-01',
    effectiveThrough: '2026-12-31',
    source: 'FDOR Form DR-15DSS (calendar year 2026)',
  },
};

/**
 * Approved service-area ZIPs mapped to their county. This is an intentional,
 * conservative table: a ZIP that is not listed fails closed for taxable
 * services. The approved public territory is the four owner-confirmed
 * counties; no statewide lookup is claimed.
 */
export const zipTaxJurisdictions: Record<string, ZipTaxJurisdiction> = {
  // Escambia County, Florida
  '32501': { state: 'FL', county: 'Escambia', key: 'FL-Escambia' },
  '32502': { state: 'FL', county: 'Escambia', key: 'FL-Escambia' },
  '32503': { state: 'FL', county: 'Escambia', key: 'FL-Escambia' },
  '32504': { state: 'FL', county: 'Escambia', key: 'FL-Escambia' },
  '32505': { state: 'FL', county: 'Escambia', key: 'FL-Escambia' },
  '32506': { state: 'FL', county: 'Escambia', key: 'FL-Escambia' },
  '32507': { state: 'FL', county: 'Escambia', key: 'FL-Escambia' },
  '32508': { state: 'FL', county: 'Escambia', key: 'FL-Escambia' },
  '32511': { state: 'FL', county: 'Escambia', key: 'FL-Escambia' },
  '32514': { state: 'FL', county: 'Escambia', key: 'FL-Escambia' },
  '32526': { state: 'FL', county: 'Escambia', key: 'FL-Escambia' },
  '32533': { state: 'FL', county: 'Escambia', key: 'FL-Escambia' },
  // Santa Rosa County, Florida
  '32530': { state: 'FL', county: 'Santa Rosa', key: 'FL-Santa Rosa' },
  '32561': { state: 'FL', county: 'Santa Rosa', key: 'FL-Santa Rosa' },
  '32563': { state: 'FL', county: 'Santa Rosa', key: 'FL-Santa Rosa' },
  '32565': { state: 'FL', county: 'Santa Rosa', key: 'FL-Santa Rosa' },
  '32566': { state: 'FL', county: 'Santa Rosa', key: 'FL-Santa Rosa' },
  '32570': { state: 'FL', county: 'Santa Rosa', key: 'FL-Santa Rosa' },
  '32571': { state: 'FL', county: 'Santa Rosa', key: 'FL-Santa Rosa' },
  '32577': { state: 'FL', county: 'Santa Rosa', key: 'FL-Santa Rosa' },
  '32583': { state: 'FL', county: 'Santa Rosa', key: 'FL-Santa Rosa' },
  // Baldwin County, Alabama
  '36507': { state: 'AL', county: 'Baldwin', key: 'AL-Baldwin' },
  '36526': { state: 'AL', county: 'Baldwin', key: 'AL-Baldwin' },
  '36527': { state: 'AL', county: 'Baldwin', key: 'AL-Baldwin' },
  '36530': { state: 'AL', county: 'Baldwin', key: 'AL-Baldwin' },
  '36532': { state: 'AL', county: 'Baldwin', key: 'AL-Baldwin' },
  '36535': { state: 'AL', county: 'Baldwin', key: 'AL-Baldwin' },
  '36542': { state: 'AL', county: 'Baldwin', key: 'AL-Baldwin' },
  '36551': { state: 'AL', county: 'Baldwin', key: 'AL-Baldwin' },
  '36561': { state: 'AL', county: 'Baldwin', key: 'AL-Baldwin' },
  '36567': { state: 'AL', county: 'Baldwin', key: 'AL-Baldwin' },
  '36580': { state: 'AL', county: 'Baldwin', key: 'AL-Baldwin' },
  // Escambia County, Alabama
  '36426': { state: 'AL', county: 'Escambia', key: 'AL-Escambia' },
  '36502': { state: 'AL', county: 'Escambia', key: 'AL-Escambia' },
};
