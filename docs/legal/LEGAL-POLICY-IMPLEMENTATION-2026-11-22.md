# Legal policy implementation — 2026-11-22

Status: **development-only.** No cancellation fee, late fee, interest, collection notice, lien, legal document or production signing packet is activated.

## Activation flags

`src/config/legal-policy.ts` keeps every production behavior disabled:

- `cancellationFees: false`
- `lateFees: false`
- `interest: false`
- `collections: false`
- `electronicSigning: false`
- `productionLegalDocuments: false`

No invoice, charge, customer email or contract may use these calculations until the owner approves the exact customer-facing wording and an effective date.

## Cancellation policy

Owner target, implemented as ceiling values in `assessCancellation()`:

| Notice | Ceiling |
|---|---:|
| 48 hours or more | $0 |
| 24–48 hours | $20 |
| Less than 24 hours | $40 |
| Failed access after arrival | $40 |

The function always evaluates the **documented supportable cost** first and charges the lower of that cost and the applicable ceiling. It does not stack cancellation and failed-access fees. Company cancellations, statutory rights, and approved emergency exceptions produce $0. One courtesy waiver in a rolling 12-month period can reduce a fee to $0.

The ceilings are not automatic penalties. Florida liquidated-damages principles require the amount to be a reasonable forecast of loss that is difficult to ascertain when contracting, not a penalty. The supportable-cost record must identify travel, allocated labor, lost slot and other documented categories. If research or actual records support a lower ceiling, use the lower amount.

Branch and service overrides are accepted by the function and must be recorded with the policy version and basis.

## Late payment and interest

`assessLatePayment()` implements:

- 30 calendar-day grace period after the contractual due date.
- One $20 late fee, only where lawful and not already assessed.
- 15% annual simple interest after grace.
- Actual days elapsed / 365.
- No compounding and no interest on fees.
- Disputed balances accrue no interest or fee while the dispute is under review.
- Partial payments and credits reduce eligible principal.
- The function returns the exact grace date, days accrued, principal, fee, interest and total.

`reviewLateChargeCompliance()` flags a combined fee/interest result whose annualized equivalent exceeds 18%. The flag requires owner/legal review before imposing both; it is not an automatic authorization. Florida Statutes §§687.02–687.03 set an 18% simple-interest usury ceiling for covered obligations. Whether a service invoice and a separately disclosed fee fall within that definition depends on the transaction; the conservative guard is intentional.

Do not use the invoice rate as a judgment rate. Post-judgment interest must use the CFO quarterly rate under Fla. Stat. §55.03. The rate for the quarter beginning October 1, 2026 is **7.87% per annum** (daily decimal `.000215616`), but the calculation accepts the rate as input rather than hard-coding a future rate.

Development-only collection tables are in `migrations/0051_legal_collections.sql`:

- `collection_cases`
- `collection_events`
- `judgment_records`

They are not applied to production. Ordinary cleaning work does **not** create a construction lien. A real-property judgment lien requires a court judgment, certified recording in the county, and the lienholder address or simultaneous affidavit. The initial lien is 10 years; extensions are by re-recording before expiration with a current-address affidavit; no extension may exceed 20 years from judgment entry. Homestead and other exemptions may apply. §55.10 and §55.081.

## Collection workflow

`collectionStage()` provides development stages:

1. Current
2. Reminder
3. Demand
4. Final demand
5. Collections review
6. Dispute hold

The workflow requires documented reminders, a final demand, evidence preservation (signed agreement, invoice, service completion, communications), manual review before referral, and a dispute hold. No notice, lien, garnishment, property claim or court filing is automated.

## Employee restrictive covenants

Prepared candidates are in the master workspace:

`00 START HERE/LEGAL-REVIEW/final-candidates/`

- Employee Confidentiality & Proprietary Information Agreement
- Employee Customer & Employee Nonsolicitation Agreement
- Role-Specific Employee Noncompetition Agreement
- Employee Property, Key, Credential & Access Return Agreement
- Workplace Conduct & Professional Standards Policy
- Form I-9 Onboarding Procedure (paper/PDF)

The noncompetition candidate is a role schedule, not a blanket three-year restriction. Ordinary cleaners are excluded from noncompetition; confidentiality, narrow customer nonsolicitation, property return and credential controls apply. Up to 24 months is available only where a documented legitimate interest supports it and the role schedule is completed. Crew leads, supervisors, operations/sales and senior management require role-specific analysis, a defined territory and, where applicable, separate consideration.

Florida Statutes §542.335 presumes a former employee restriction of more than two years unreasonable. The CHOICE Act permits up to four years only for a statutory “covered employee” meeting the salary threshold and notice/right-to-counsel/garden-leave requirements. A 24-month term alone does not establish enforceability. Alabama requires separate review.

The nonsolicitation candidate is limited to customers the employee actually served, managed or learned about through protected information, and to employees with whom the employee worked directly or learned about through protected information. It does not prohibit lawful customer choice or ordinary competition.

Confidentiality retains protected whistleblowing, government-communication, wage-discussion and concerted-activity carve-outs. Those carve-outs must not be removed to make a covenant look stronger; doing so can make it overbroad and unenforceable.

## I-9

Use the official current USCIS Form I-9. As of this writing the current edition is **01/20/25**; verify the edition and expiration at <https://www.uscis.gov/i-9> before use. The fillable PDF must be printed and manually signed unless a DHS-compliant electronic I-9 system under 8 CFR 274a.2 is used.

The current Sparkling Standard document-signing system is not a DHS-compliant electronic I-9 system. Use the official paper/PDF workflow, complete Section 1 by the first day and Section 2 within three business days (or first day for employment under three business days), restrict access, and retain three years after hire or one year after termination, whichever is later.

Florida private employers with 25 or more employees must use E-Verify; all employers must still complete the I-9 process. Do not over-document or discriminate based on citizenship, national origin or document choice.

## Still not implemented

- No live fee, interest or collection notices.
- No production migration application for `0051`.
- No admin collections UI or automated demand sending.
- No DOCX/PDF generation inside the production document-signing service.
- No dynamic field population for price, scope, line items, tax, discounts, arrival window, payment/cancellation terms or effective date.
- No production signing packet activation or published Terms change.
- No Community Support icon change in this legal implementation batch.

These remain gated pending owner-approved final wording, exact-version approval and controlled testing.

## Continuation implemented on 2026-11-22 (uncommitted)

The following items from "Still not implemented" are now implemented in the
working tree, but remain **inactive** until owner-approved templates are loaded
and activated:

- Dynamic agreement variables from the stored, server-verified booking request
  (`src/lib/documents/agreement-variables.ts`).
- Executed agreement PDF generation in the Function runtime
  (`src/lib/documents/agreement-pdf.ts`), stored in private R2 after signing.
- Pre-payment checkout resume after signing
  (`src/lib/documents/checkout-intent.ts`, `/estimate/payment-resume/`).
- Post-payment automatic confirmation retry after the customer signs.
- Branch scoping for admin signature download and verify/reject.
- Structured `document_template_incomplete` failure instead of a checkout 500
  when a template still contains unresolved placeholders.

Still not implemented: approved production templates and packets, live
cancellation/late/interest notices, production application of migration 0051,
an admin collections UI, and release of any revised legal packet.
