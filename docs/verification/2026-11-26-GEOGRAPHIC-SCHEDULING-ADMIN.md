# Geographic, scheduling and administrative stabilization — 2026-11-26

## Release scope

This release completes the geographic and scheduling acceptance required after
the pilot booking recovery, corrects the remaining administrative defects, and
does not create production customer records, charges or bookings.

## Geographic acceptance

- All **168 approved service-area ZIPs** audited against the U.S. Census 2020
  ZCTA-to-county relationship file: **35 live Pensacola ZIPs + 133 prepared
  Tampa ZIPs**. Snapshot: `scripts/data/census-zcta-counties.json`.
- **70 representative addresses** (two per live Pensacola ZIP) built from Census
  TIGER/Line 2024 address ranges; **70/70** independently confirmed by the Census
  Geocoder.
- **70/70** assigned to `branch_pensacola`; **70/70** production travel lookups
  were verified live routes; **70/70** production calendar probes returned an
  enabled Pensacola calendar.
- Tax corrections: ZIP `32534` added (Escambia), ZIP `32577` corrected to
  Escambia, and split ZIP `32561` now requires the confirmed address county
  (Escambia/Pensacola Beach or Santa Rosa/Gulf Breeze).
- Prepared Tampa: 14 cross-county ZIPs and 9 ZIPs with land outside the
  configured Pasco/Pinellas/Hillsborough counties are recorded as an explicit
  pre-launch owner decision. Tampa remains non-bookable.
- Full evidence: `docs/verification/2026-11-26-geographic-scheduling/README.md`
  and `geographic-acceptance.json`. Reproduce with
  `npm run geography:acceptance -- --live --travel --calendar`.

## Scheduling acceptance

- Added `tests/scheduling-conflict-matrix.test.ts`: active/expired holds,
  simultaneous independent crews, joint-crew consumption, roster insufficiency,
  first-job start without origin travel, travel/buffer between real jobs, branch
  time zones and all-day blocks.
- Initial Deep Cleaning duration and subsequent recurring maintenance duration
  are now separately derived. The server stores verified `ongoing_labor_hours`;
  the first visit keeps its own duration and recurring visits use the approved
  crew-efficiency calculation instead of inheriting the first visit.
- Existing recurring-conflict and paid-first-visit-preservation tests remain
  green.

## Administrative corrections

- **Invoice voiding:** owner action with confirmation; a payable Stripe session
  is inspected and expired before voiding; invoices with any recorded payment
  are refused; the financial record and audit history are preserved.
- **Recurring worker failures:** active failures are measured only after the most
  recent successful run; failed plan IDs and classified causes are inspectable,
  with a per-plan Retry sync action.
- **Checkout session inspection:** read-only Finance table with status, amount,
  Stripe session, classification (setup/provider failure vs abandoned), and a
  link to the booking request. Overview navigation scrolls to it.
- **Booking review reasons:** request list/detail now states the specific reason
  (checkout failure, unsigned requirements, missing customer/property, address
  not confirmed, photos outstanding, staffing pending, closure reason). Bulk
  deny requires a specific stored reason instead of a generic label.
- **Persistent alert resolution:** a resolved/dismissed alert stays suppressed
  for the records that existed at resolution and reopens only when a newer record
  appears.

## Verification

- `npm run check`: 0 errors, 0 warnings.
- Unit: **1,190 tests, 1,189 pass, 1 pre-existing skip, 0 fail**.
- Browser: **289/289 pass**.
- `npm run verify`: integrity gate passed; 41 pages; 2,636 links; SEO, marketing,
  QR and checklist checks passed.
- Source integrity: valid UTF-8, no mid-file BOMs, conflict markers, control
  characters or malformed JSON. `.editorconfig` and
  `docs/operations/SOURCE-INTEGRITY.md` document the safe edit workflow.
- No production customer record, charge, booking or email was created.

## Owner actions

- Provide the Stripe test-mode credentials and test webhook described in
  `docs/operations/STRIPE-TEST-MODE-ACCEPTANCE.md` for a completed payment test.
  An abandoned live Checkout Session is not acceptable evidence.
- Decide the prepared Tampa cross-county ZIP scope before any Tampa activation.
