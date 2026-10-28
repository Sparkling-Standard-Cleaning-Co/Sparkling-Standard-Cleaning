# Service-location sales tax

**Status (2026-10-28):** the numeric service-location tax engine is implemented and tested. It
calculates tax from the confirmed cleaning address, stores the jurisdiction and amount with the
quote, adds the tax to the Stripe total, and fails closed when the jurisdiction or rate cannot be
verified. The engine does not silently use the billing address or a flat 7%.

## Configuration

- `src/config/tax.ts` — effective-dated county rates, ZIP → county reference, state rules, official
  sources and the church-exemption gate.
- `src/lib/tax/engine.ts` — pure calculation and review-required states.
- `functions/api/lead.ts` and `functions/api/estimate-checkout.ts` — server-owned tax calculation;
  client-supplied tax amounts are discarded.
- `src/scripts/facility-estimate.ts` — the commercial/church quote shows the tax and all-in total
  when verified. Pay Now is withheld when tax needs personal confirmation.

## Official sources

- Florida Department of Revenue, **Sales and Use Tax on Cleaning Services** (GT-800015):
  https://floridarevenue.com/Forms_library/current/brochure/gt800015.pdf
- Rule **12A-1.0091**, Florida Administrative Code — Cleaning Services:
  https://www.flrules.org/gateway/ruleNo.asp?id=12A-1.0091
- Florida **DR-15DSS** discretionary sales surtax information for calendar year 2026:
  https://floridarevenue.com/Forms_library/current/dr15dss_26.pdf
- FDOR discretionary surtax rate table:
  https://pointmatch.floridarevenue.com/General/DiscretionarySalesSurtaxRates.aspx
- FDOR **TIP 99A01-42** — transient accommodations:
  https://floridarevenue.com/taxes/tips/documents/TIP_99A01-42.pdf
- Alabama sales tax application (tangible personal property / public amusements):
  https://www.revenue.alabama.gov/tax-types/sales-tax
- Ala. Code §40-23-2:
  https://law.justia.com/codes/alabama/title-40/chapter-23/article-1/division-1/section-40-23-2

## Treatment used by the engine

| Service | Florida | Alabama |
| --- | --- | --- |
| Residential cleaning, deep, move-in/out, Community Support | **Not taxable** — Rule 12A-1.0091(1)(b); GT-800015 | **Not taxable** — Alabama sales tax applies to tangible personal property and public amusements, not cleaning labor (§40-23-2) |
| STR turnover billed to the owner/host | **Not taxable** — the host's separately charged mandatory guest fee is the host's transient-rental charge | **Not taxable** — same service-tax reasoning |
| Commercial / nonresidential cleaning | **Taxable** — 6% state + county discretionary surtax (Escambia 1.5%, Santa Rosa 1.0% for 2026) | **Not taxable** — see above |
| Church / nonprofit facility | **Taxable unless** a current DR-14 is on file and the church pays directly | **Not taxable** — see above |

Tax is calculated on the post-discount service amount including the separately stated travel
adjustment. Gift-certificate credit is a payment method applied after tax; it does not reduce the
taxable base.

## Fail-closed rules

The result is `review_required` (and online payment is withheld) when:

- the service state is unknown;
- the confirmed ZIP and stated state conflict;
- a Florida taxable service has a ZIP outside the approved county reference;
- the date is outside the verified rate year (the 2026 table must be re-verified for 2027);
- the service category is unknown.

The request is still delivered. The customer can Reserve Without Payment, and the owner confirms
the tax personally.

## 2026 Florida rates

| County | State | Surtax | Combined |
| --- | --- | --- | --- |
| Escambia | 6.0% | 1.5% | 7.5% |
| Santa Rosa | 6.0% | 1.0% | 7.0% |

The DR-15DSS notes that Santa Rosa's current components expire 2026-12-31. The table therefore
stops at 2026-12-31 and requires owner re-verification before 2027 charges.

## Alabama caveat

Alabama does not impose its sales tax on building-cleaning labor under the cited statute and the
Department's sales-tax application. The owner should confirm this treatment with the company's tax
adviser before the first Alabama commercial invoice and should verify any local business-license
obligation separately. Local business licenses are not sales tax and are not collected by this
engine.

## Calculation boundaries

- Tax is never included in a cleaning base rate, discount, engine calibration factor or travel
  adjustment used to derive the service price.
- The server stores the jurisdiction, rate, taxable amount, tax and total with the checkout record.
- No tax is invented when the address is ambiguous. A ZIP-level fallback may be used for travel
  estimates, but it does not by itself authorize a county tax rate where a ZIP could cross a
  jurisdictional boundary.
