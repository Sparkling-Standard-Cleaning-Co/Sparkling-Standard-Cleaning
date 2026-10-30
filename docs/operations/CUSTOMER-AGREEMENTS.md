# Customer agreements and electronic signatures

**Status (2026-10-28): cataloged; mandatory electronic signing is DISABLED.** Every located owner
agreement is a draft requiring owner and/or attorney completion. No draft contract is presented to a
customer, no signature is collected and no mandatory checkout/booking gate is active.

Source library: private Business HQ `12_FORMS_CHECKLISTS_AND_SOPS/` (not committed to this public
repository). Original documents are version 1.0, revision 2026-10-20.

## Located forms and applicability

| ID | Document | Service applicability | Status |
| --- | --- | --- | --- |
| RES-002 | Residential Customer Intake | residential, deep, move-in/out, recurring | Draft - owner review |
| RES-006 | Residential Service Agreement | residential, deep, move-in/out, recurring | Draft - legal review required |
| RES-009 | Customer Cleaning Preferences | residential, deep, move-in/out, recurring | Draft - owner review |
| RES-011 | Home Access / Key Authorization | residential when access is authorized | Draft - legal review required |
| RES-012 | Customer-Supplied Product Request | any home/STR job using customer products | Draft - owner review |
| STR-001 | STR Property Owner / Manager Intake | STR turnover | Draft - owner review |
| STR-003 | STR Turnover Service Agreement | STR turnover | Draft - legal review required |
| COM-009 | Commercial Service Agreement | commercial and church | Draft - legal review required |
| COM-010 | Commercial Cleaning Schedule and Frequency Agreement | commercial and church | Draft - owner review |
| COM-012 | Commercial Site Access and Security Authorization | commercial and church with access | Draft - legal review required |
| COM-014 | Commercial Client Onboarding | commercial and church | Draft - owner review |

The catalog is `src/config/agreements.ts`; selection rules and the activation lock are
`agreementsForService()` and `agreementActivationBlocked()`.

## Why activation is blocked

The originals explicitly state **LEGAL REVIEW REQUIRED** and contain unfilled placeholders for
insurance, liability, cancellation, term, fees and dispute terms. They also require owner decisions
and a qualified Florida attorney's review (Alabama where applicable). Publishing them as binding
e-signatures now would create unenforceable or misleading agreements.

`agreementConfig.enabled`, `electronicSignatureEnabled` and every document status must remain
inactive until:

1. The owner supplies the final approved wording for each required form.
2. Florida counsel reviews the contracts, cancellation/payment/liability terms, E-SIGN/UETA
   disclosures, electronic-delivery consent and paper alternative.
3. Approved templates are uploaded to private R2 (never GitHub).
4. The signing workflow, immutable record, PDF/HTML copy and owner retrieval are tested.
5. The mandatory gate is enabled only for services whose approved forms are complete.

## Required owner upload/import path

Place final approved source files in the private archive folder corresponding to the form family,
or provide them to the owner-controlled import step. Do not commit them to this repository. The
website must load only approved, versioned templates from private R2.

## What is implemented now

- Accurate catalog of the existing forms, versions, status, service applicability, required fields,
  initials/countersignature flags and conditions.
- Pure service-selection rules and an activation lock that fails closed while any document is draft.
- Tests proving the real form IDs, conditional selection and blocked activation.

## What is not implemented

- Customer signing UI, typed/drawn signature capture, E-SIGN consent, PDF generation, signed-copy
  email, owner retrieval, signing links, booking/Stripe signature gates, and durable signed
  document records. These must be built and tested only after approved templates exist.
- No existing Terms acceptance is being replaced. The current terms checkbox remains the only
  transactional acceptance in production.

## Integration constraints for the future build

- Do not attach signed documents to Google Calendar events.
- Do not put signed documents or template text in public assets, GitHub, analytics or logs.
- Use private R2 with authenticated owner access and customer-scoped links only.
- Preserve the exact signed content, version, hash, signer evidence and UTC timestamp.
- Keep gift-certificate terms separate from cleaning-service authorization.
- Preserve Stripe idempotency, Google Calendar booking holds/owner approval and the 6.10 social
  integrations.
