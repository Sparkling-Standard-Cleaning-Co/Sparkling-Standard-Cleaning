# Document management and electronic signatures

**Admin:** `/admin/` → **Documents & Agreements**
**Public signing:** `/document-sign/?token=…`
**Last verified:** 2026-11-22 (local verification; migration `0052` is additive and unapplied in production)

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

## 3a. Packet builder (2026-11-19)

The Documents & Agreements section is now a complete packet builder, not only a
template list:

- **Templates:** create text, upload PDF, edit a draft, duplicate as a new draft,
  preview, download, view audit history, approve, retire and restore to draft.
  Approved content is immutable; a change requires a new version.
- **Packets:** create a reusable packet with a purpose, packet type and recipient
  instructions; duplicate it with its documents; archive and restore it; reorder
  documents; add or remove templates; preview the exact resolved packet.
- **Supported variables:** `customer.first_name`, `customer.last_name`,
  `customer.company_name`, `customer.email`, `customer.phone`,
  `employee.name`, `employee.email`, `property.label`, `property.address`,
  `booking.reference`, `service.code`, `service.frequency`,
  `company.name`, `company.legal_name`, `company.slogan`, `company.phone`,
  `company.email`, `company.website`, `document.version`, `document.date`.
- **Fail closed on variables:** an unresolved variable in a required document
  blocks sending. The preview lists every unresolved key. The signing page shows
  the packet name and recipient instructions above the documents.
- **Initial packet starters:** First-Time Customer, Residential One-Time,
  Recurring Residential, Move-In/Move-Out, Commercial Client and Employee
  Onboarding. Starters are templates only: `is_system = 1` packets are excluded
  from automatic bundle resolution, so they cannot silently become a gate.
  Duplicate a starter to make an editable, auto-resolvable packet.
- **Smart suggestion:** a manual booking quote already reports its missing
  requirements; the owner can send the matching packet from the booking result
  without a new booking being created by the paperwork alone.
- **Branch protection:** sending, previewing and resending a packet checks the
  customer/employee branch unless the actor is the owner.
- **Snapshots:** a signing request stores the resolved text, hash, template
  version, packet name and instructions. Later template or packet edits cannot
  rewrite the issued request. Gate matching uses template version plus the
  subject identity; approved content is immutable by policy.

### Template variables and hashes

`src/lib/documents/service.ts` resolves variables at send/preview time. The
resolved hash is stored in the requirement snapshot and the signature evidence.
The original template hash is retained as `templateSha256`. Empty values are
never silently removed from a legal document.
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
- A rejected signature remains immutable evidence and never counts as signed.
  Re-signing creates a new attempt; the gate and signing page use the latest
  attempt only. A rejected signature cannot be verified without a new signature.
- Reusable customer agreements satisfy future bookings by customer/version/hash
  unless the item is marked **per booking**.
- Items requiring verification or countersignature remain
  `awaiting_verification` until an authorized admin verifies them.
- Cross-customer and cross-employee access is prohibited: a token only resolves
  its own request, and gate lookups match the subject identity.

## 5a. Document revisions and re-signing review (2026-11-22)

A new template version is created by duplicating an approved template. The
duplicate starts as `draft`, keeps the same `family_key`, and records
`supersedes_template_id`; the approved and executed versions remain immutable.

**Admin → Documents & Agreements → Document Updates** shows, for each revision:

- the previous and new version and the approval state;
- every packet that references either version;
- customers who signed the previous version and have not signed the new one;
- their next upcoming appointment, when one exists;
- the owner review state and the material/nonmaterial classification.

The owner acknowledges a revision as **material** or **formatting/nonmaterial**.
A material revision with customers still on the old version becomes
**Re-signing recommended**. Nothing is sent automatically. **Use in composer**
prefills the existing admin composer with the customer and affected packet; the
owner reviews the rendered PDF and sends the request individually. Historical
executed copies are never replaced or deleted.

When a revision is created, an owner notification is sent if
`OWNER_NOTIFICATION_EMAIL` and Resend are configured; the audit record
`documents.revision_notification` records whether the alert was sent. No
customer is contacted by the notification.

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
templates or invent legal wording. The 27 owner-approved 2026-11-22 documents
are imported in production and live electronic signing is enabled for the four
verified residential packets. Facility, specialty, property-management, STR and
employee packets remain imported but inactive until their own acceptance run.
Do not weaken the server-side `before_payment` and `per_booking` enforcement.

## 9. Provisioning

- Apply migrations `0018_document_management_and_signing.sql`,
  `0019_recurring_worker_runs.sql`, `0023_document_signature_attempts.sql`,
  `0031_document_execution_integrity.sql` and
  `0038_document_packet_builder.sql`.
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

## 11. Signing reminders and link lifetime

- A signing link expires after **7 days**. Expiry never cancels the
  appointment, booking, recurring plan or agreement.
- Reminders default to **24 hours** and **72 hours** after request creation and
  are owner-configurable in **Admin -> Documents & Agreements**.
- An expired link is replaced with a fresh 7-day link only when a reminder can
  actually be delivered. The previous link is invalidated at that point.
- Reminders stop on signed, declined, void or expired requests.
- Each attempt is recorded in `document_signing_reminders` and audited.
- Deployment: migration `0047_document_reminders.sql` and the
  `workers/document-reminders` hourly Worker.

## 12. Portal document access

Customers can download their own executed copies and signed PDFs from
`/portal/`. The portal verifies the session's `customer_id` before any
document lookup and records each download in `customer_portal_audit`.

## 13. Admin document center (2026-11-22)

Admin -> Documents & Agreements is divided into seven subviews:

1. **Overview** — awaiting signature, completed, expired, ready packets, packets
   with no approved documents, and document revisions needing review.
2. **Send for Signature** — guided recipient search, service/property/transaction
   selection, automatic packet selection, verified details, preview and send.
3. **Signing Requests** — searchable/filterable request list with open, resend,
   countersignature and executed-copy actions.
4. **Document Library** — approved/draft templates and template creation.
5. **Packets** — service packets, packet starters, document counts and readiness.
6. **Versions & Updates** — owner revision review and re-signing queue.
7. **Settings** — signing reminder settings.

The guided composer never requires staff to type a `cust_`, `prop_`, `team_` or
packet identifier. It searches the existing CRM, loads the customer's properties
and recent reference/date/price, and uses human-readable service and packet
labels. Raw identifiers remain available only under **Advanced**.

## 14. Packet readiness and empty packets

- A packet is routable only when it is `active`, is not a system starter, and has
  at least one `approved` template.
- An active packet with zero approved documents is shown as **No approved
  documents** and cannot be selected in the send selector.
- `createSigningRequest` rejects an explicitly selected empty packet with
  `packet_has_no_documents`.
- `previewPacket` returns `ready`, `approvedDocumentCount` and
  `totalDocuments`, so the UI can distinguish an empty packet from a packet with
  no applicable conditional documents.
- System starter packets (codes beginning `packet.*`) remain in the library as
  templates. They are not authoritative service packets and never override a
  real `customer.*` or `employee.*` packet.
- A later signature for a different booking, bundle or document version cannot
  satisfy the current gate.

## 15. Customer signing ceremony and service schedule

The public signing page is a wide, mobile-first three-step ceremony:

1. **Confirm details** — customer, property, service, date, arrival window,
   price and payment terms are loaded from the verified request.
2. **Access and instructions** — service-specific choices (access method,
   day-of-service contact, entry/parking instructions, pets, restricted areas,
   other instructions). Required access choices fail closed server-side.
3. **Review and sign** — readable full-width document reader, per-document
   acknowledgment, one legal-name field, typed or drawn signature, and one
   explicit adoption action for every selected document.

The customer enters their legal name once. Required documents each require an
independent acknowledgment. Optional documents are never preselected. The
e-sign consent remains a separate affirmative choice.

Customer-provided access/instruction values are stored in
`signing_requests.customer_fields_json` (migration
`0052_signing_customer_fields.sql`), reproduced in the executed text record and
the executed PDF under **Customer Instructions and Access Schedule**, and covered
by the executed-copy hash. The approved agreement wording is not rewritten.
Never collect a permanent master code, banking credential, or account password
in these fields.

If migration `0052` is not applied yet, signing still works, but the customer
fields are not persisted and cannot appear in the executed evidence. Apply the
additive migration before activating this part of the flow in production.

## 16. Operational notifications for documents

- A signing request creation is sent internally to the configured
  `document_signing_request` departments (default: Bookings and Admin). The
  secure signing token is never included in the internal notice.
- A fully executed package is sent to `document_executed` departments (default:
  Admin and Owner) with the executed copy attached.
- A new document revision notification uses `document_revision` (default: Admin
  and Owner).
- These deliveries respect the owner-controlled routing in
  **Communications & Notifications** and are recorded in
  `notification_delivery_events`. Provider acceptance is not proof of inbox
  delivery.

## 17. Pricing, signature boxes and visual editor (2026-11-23, local)

Migration `0053_signing_pricing_snapshot.sql` adds
`signing_requests.pricing_snapshot_json` (default `{}`). The snapshot is written
once when a signing request is created from the verified checkout or the admin
composer and is never recalculated by the signing page. It carries the service,
property, schedule, scope, add-ons, line items, base, travel, discount, tax,
total, amount due now, remaining balance and payment terms. The signing page's
**Details & price** step, the executed text copy, the executed PDF and the admin
request detail all read the same snapshot.

The signing ceremony now shows a visible **X � Sign here** box for every
unsigned document. The first box opens the signature pad (typed or drawn;
Clear, Cancel, Adopt Signature); later boxes apply the adopted signature only
when clicked. Each application is recorded with an `appliedAt` timestamp in
`document_signatures.signature_json`. The page tracks signature progress and
scrolls to the next required box. Changing the adopted signature clears the
applied boxes so the customer must sign each one again.

Checkout signing redirects straight to the payment page after completion. The
payment page shows the signed total, the signed-PDF download, the recorded
customer-email status and customer-portal access. The old three-option success
screen is retired for checkout flows.

The template editor is a visual contenteditable canvas with headings, fonts,
font sizes, colours, bold/italic/underline, alignment, lists, basic tables,
page breaks, dynamic fields, signature-line placement, optional headers and
footers, live preview, print/PDF, draft saving, compare and Approve & Publish.
Rich HTML is sanitized server-side (no scripts, event handlers, links, images,
iframes, forms or external URLs). Legacy Markdown masters remain readable.
Owner-facing version labels are conventional (`Version 1.0`, `Version 1.1`, .);
internal version strings and hashes are retained for audit and signatures.

**Branding is applied at render time, not stored in the legal template.** The
approved circular logo, letterhead, company identity, brand colours, typography,
footer and page numbers come from `src/lib/documents/branding.ts`. The admin
editor shows a non-editable branded page frame; the live preview, customer
signing screen and executed PDF use the same identity. Legacy Markdown tables
render as real tables in HTML and PDF, and technical metadata lines are excluded
from customer-facing output. Historical signed snapshots are never rewritten.
Evidence and side-by-side renders:
`docs/verification/2026-11-23-DOCUMENT-BRANDING.md`.

Automated tests must never call live Resend. `npm test` preloads
`tests/helpers/no-live-email.mjs`, which blocks `api.resend.com` unless
`ALLOW_LIVE_RESEND_TESTS=1` is explicitly set for an owner-authorized live test.
See `docs/verification/2026-11-23-SIGNING-PRICING-EDITOR.md`.
