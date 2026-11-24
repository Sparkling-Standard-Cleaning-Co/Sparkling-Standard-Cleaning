# Admin Operations Release A — 2026-11-24

**Branch:** `production-safe`
**Base:** `c696c50`
**Scope:** alert navigation, Google Reviews job selection, lead management.

## Root causes

1. **Alert record navigation:** every affected-record button used the
   `request-open` action, even when the record was a signing request or invoice.
   The resulting `/api/admin/requests?id=<signing_request_id>` lookup returned
   “Request Not Found.” Signing-request details also lived behind the Documents
   → Signing Requests tab, so the detail could exist but remain hidden.
2. **Google Reviews:** the queue form required the owner to type an internal
   `appt_…` identifier. There was no completed-cleaning selector, searchable
   list, or invitation-status view.
3. **Leads:** the screen exposed status changes and a payload accordion only.
   There was no open-record detail, archive/restore, disposable-delete or bulk
   management.

## Implemented

### Alerts

- Alert affected-record buttons now select the correct action:
  - signing request → Documents → Signing Requests → open the actual request
  - invoice → Finance → open the actual invoice
  - reservation request → open the request
- The same fix switches to the signing-request tab before opening the detail.
- Existing alert acknowledge/investigate/resolve/recheck/dismiss actions remain
  authenticated, CSRF-protected, audited and unchanged.

### Google Reviews

- Removed the manual appointment-ID form entirely.
- Added a searchable list of completed cleanings showing customer, service,
  completed date, property, branch, invitation status and last invitation.
- Filters: all completed, not invited, queued, sent, failed, suppressed.
- Queue action uses a branded confirmation; no internal ID is shown.
- Added an exact-email preview (`subject`, branded HTML) using the configured
  branch review URL and the real customer, without sending.
- Review requests are queued only when the branch review workflow is enabled;
  sending remains an explicit owner action.
- Existing deduplication, frequency limits and review-link validation remain in
  the server path.
- Added owner-gated queue attempts after a completed service is recorded and
  after a completed appointment’s invoice payment succeeds. They create only a
  queued request when the branch settings allow it; no email is sent by those
  hooks.

### Leads & Inquiries

- Added a real detail view with customer, property, payload, delivery state and
  audit history.
- Added selection checkboxes, select-all-visible, bulk archive, bulk restore and
  bulk disposable-delete.
- Added per-record archive/restore/delete actions with branded confirmations.
- Permanent deletion is owner-only and fails closed for any lead with a linked
  customer, reservation request or quote history. Linked history is preserved.
- Search/status/sort/page-size filters remain functional.

## Tests

- `tests/admin.test.ts`: real lead handler archive/restore/delete and protected
  history behavior.
- `tests/browser/admin-release-a.test.mjs`: alert signing-request and invoice
  opening, lead bulk archive, lead detail, reviews completed-cleaning list,
  branded queue confirmation and no native prompts.
- `tests/browser/admin-reviews.test.mjs`: searchable completed cleanings,
  invitation status, preview and mobile layout with no appointment-ID input.
- Full regression: unit **1,101** (1,100 pass, 1 pre-existing skip); browser
  **275/275**; `astro check` 0 errors/0 warnings; build 41 pages; validation
  2,631 links; smoke 21 pages.

## Deployment evidence

Appended after the authorized production deployment.
