# Document management and electronic signatures

**Admin:** `/admin/` → **Documents & Agreements**
**Public signing:** `/document-sign/?token=…`
**Last verified:** 2026-11-01

The owner controls document templates, bundles, enforcement stages and signing
status from the existing admin console. Policy is stored in D1; changing a
requirement does not require a code change or redeployment.

## 1. Data model

| Table | Purpose |
| --- | --- |
| `document_templates` | Title, category, version, status (`draft`, `approved`, `retired`), text or private-R2 PDF, SHA-256, signer party, countersignature/verification flags. |
| `document_bundles` | Reusable bundle code/name, customer or employee subject, service category, active state, version. |
| `document_bundle_items` | Which template belongs to a bundle, order, required flag, enforcement stage, condition and per-booking flag. |
| `signing_requests` | A single-purpose signing link with a snapshot of the exact requirement set, versions, hashes and subject references. |
| `document_signatures` | Immutable typed signature, signer identity, consent version, timestamp, IP/UA hashes, content hash and verification state. |

Signed text is stored privately in D1; uploaded PDFs and signed PDF references
live in the private `DOCUMENTS_BUCKET` R2 binding. Nothing is written to the
public repository or a public bucket.

## 2. Bundle codes and resolution

The service is normalized first (`residential`, `deep`, `move_in_out`, `str`,
`commercial`, `church`, `recurring`, `employee`). The resolver tries:

1. `customer.<service>` (or `employee.onboarding`);
2. the residential bundle for `recurring`, `deep` and `move_in_out`;
3. an active bundle whose `service_category` matches.

Bundle codes are owner-editable. Example codes:

- `customer.residential`
- `customer.recurring`
- `customer.move_in_out`
- `customer.str`
- `customer.commercial`
- `customer.church`
- `employee.onboarding`

Conditions:

| `condition_key` | Match |
| --- | --- |
| `frequency` | Comma-separated `weekly`, `biweekly`, `monthly`, `one_time`. |
| `access_authorization` | Customer selected an access method requiring authorization. |
| `customer_products` | Customer requested their own products. |
| `role` | Employee qualification/role. |
| `service` | Normalized service. |

Unknown condition keys are treated as applicable (fail closed, never silently
drop a requirement).

## 3. Enforcement stages

- `before_payment` — checkout is refused and the customer is redirected to the
  signing flow.
- `before_confirmation` — a request may be submitted or paid, but no appointment
  or Google Calendar commitment is confirmed until signatures are valid.
- `before_employee_activation` — the employee cannot be assigned to work until
  onboarding requirements are complete; verification/countersignature items
  must be `verified`.
- `optional` — shown for information, never blocks.

The server enforces every stage. A date selection or temporary hold is never a
confirmed booking.

## 4. Admin workflow

1. **Add a document template** — paste approved text or upload an approved PDF.
   New templates start as `draft`.
2. **Approve** the template. Draft and retired templates never create a gate.
3. **Create a bundle** and add approved templates. Set order, required flag,
   stage, condition and per-booking behaviour.
4. **Create a signing link** for a customer/employee context, or resend an
   existing request. The recipient receives a single-purpose link.
5. **Review signatures** — signed, awaiting verification, verified or rejected.
   Download the retained copy from the request detail.
6. **Retire** a template instead of deleting it. Historical signatures remain.

Only the owner may approve templates or change bundle policy. Managers may send
and verify paperwork. Cleaners cannot change policy.

## 5. Signature lifecycle

- A signing request snapshots the exact templates, versions, content hashes and
  stages. Later policy changes do not rewrite an active request.
- Signing requires affirmative electronic-signature consent and a typed legal
  name. Duplicate callbacks are idempotent and never overwrite the first
  signature.
- Reusable customer agreements satisfy future bookings by customer/version/hash
  unless the item is marked **per booking**.
- Items requiring verification or countersignature remain
  `awaiting_verification` until an authorized admin verifies them.
- Cross-customer and cross-employee access is prohibited: a token only resolves
  its own request, and gate lookups match the subject identity.

## 6. Integration points

| Flow | Gate |
| --- | --- |
| Estimator Pay Now | `/api/estimate-checkout` checks `before_payment` before creating Stripe Checkout. |
| Paid webhook / auto-confirm | `commitConfirmedBooking` checks `before_confirmation` before any calendar event or D1 appointment. |
| Pay Later admin confirm | `confirmRequest` checks `before_confirmation` before creating the appointment. |
| Admin assignment | `setAppointmentTeam` checks employee onboarding before assigning. |
| Recurring plan | Created only from a confirmed booking whose gate passed; future occurrences use the same recurring engine. |

## 7. Employee onboarding

`invite_employee` creates/updates the roster profile, sends the employee
invitation, then creates the employee-onboarding signing request when an active
`employee.onboarding` bundle exists. The invitation email and the signing email
are separate so a lost signing link can be resent. The account is linked to the
roster automatically on invitation acceptance.

Do not treat a signed generic PDF as proof of a separate legal process such as
employment-eligibility or tax-withholding verification. Configure those items
with `requires_verification` and complete the actual review independently.

## 8. Legal safety

`src/config/agreements.ts` remains the draft catalog. Do not activate draft
templates or invent legal wording. The document engine is live and tested, but
real customer/employee signature workflows remain gated until the owner supplies
approved templates and the required legal review. The catalog and e-signature
activation flags must remain off until then.

## 9. Provisioning

- Apply migrations `0018_document_management_and_signing.sql` and
  `0019_recurring_worker_runs.sql`.
- Add a private `DOCUMENTS_BUCKET` R2 binding for PDF uploads. Without it, text
  templates and signing still work; PDF upload returns
  `document_storage_not_configured`.
- No new authentication system, database or signature vendor is used.

## 10. Tests

`tests/documents.test.ts` proves owner-configured bundles, exact document
selection, milestone gating, partial and complete signing, idempotent duplicate
callbacks, immutable signatures, policy changes without redeployment, employee
verification, commercial/church bundle resolution, per-booking conditions,
PDF upload/approval and the confirmation gate.
