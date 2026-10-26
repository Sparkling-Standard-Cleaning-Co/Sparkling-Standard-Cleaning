# Florida sales-tax treatment for estimates (Initiative 6.2)

Sparkling Standard does **not** calculate or collect sales tax on the website yet. Estimates
communicate the treatment honestly and the final confirmed quote/invoice handles any tax.

## Official sources

- Florida Department of Revenue, **Sales and Use Tax on Cleaning Services** (GT-800015):
  https://floridarevenue.com/Forms_library/current/brochure/gt800015.pdf
- Rule **12A-1.0091**, Florida Administrative Code — Cleaning Services:
  https://www.flrules.org/gateway/ruleNo.asp?id=12A-1.0091
- FDOR **TIP 99A01-42** — condominiums, beach houses and vacation homes providing transient
  accommodations: https://floridarevenue.com/taxes/tips/documents/TIP_99A01-42.pdf
- FDOR discretionary sales surtax information (current county rates):
  https://floridarevenue.com/taxes/rates

## Treatment used on the website

| Service | Website presentation | Reason |
| --- | --- | --- |
| Residential cleaning (standard, deep, move-in/move-out, Community Support) | **No sales tax applicable** | Residential cleaning services are not taxable. Rule 12A-1.0091(1)(b); GT-800015. |
| Short-term rental turnover cleaning billed to the host/owner | **No sales tax applicable** | The charge to the owner for cleaning a residential facility is not taxable. A host's separately stated **mandatory guest cleaning fee** is part of the taxable transient rental charge and is the host's responsibility, not Sparkling Standard's cleaning charge. TIP 99A01-42; GT-800015. |
| Commercial / nonresidential cleaning | **+ applicable tax** | Nonresidential cleaning is taxable at Florida's 6% state rate plus any applicable county discretionary sales surtax. The final quote will show the tax for the confirmed service address. Rule 12A-1.0091(1)(a); GT-800015. |
| Church / nonprofit facility cleaning | **+ applicable tax unless exempt** | Nonresidential cleaning is taxable unless the seller receives a current Florida Consumer's Certificate of Exemption (Form DR-14) and payment is made directly by the exempt organization. Rule 12A-1.038; GT-800015. |

## Why no numeric tax is shown

The applicable county discretionary surtax depends on the confirmed service address and current
county rates. The site has no tax-rate service and does not guess. Showing a separate tax amount
from an unverified address could be worse than showing the correct provisional disclosure. The
final quote/invoice confirms the exact amount.

If the owner later wants numeric tax display, the correct implementation is a dated, sourced
county-rate table plus an address→county resolver, not a hard-coded rate. That is deliberately not
part of 6.2.

## Calculation boundaries

- Tax is never included in a cleaning base rate, discount, engine calibration factor or travel
  adjustment.
- The website does not collect tax, charge a card, or create a binding invoice.
- The customer-facing tax notes live in `src/lib/estimate/tax.ts`; the owner notification,
  customer confirmation and request summary use the same text.
