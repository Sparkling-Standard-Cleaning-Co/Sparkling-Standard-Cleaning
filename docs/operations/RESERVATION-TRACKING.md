# Reservation tracking

Simple, operational recordkeeping for advance reservation requests. No database, no paid
scheduling platform: the company's existing tools (the website notification inbox + a private
Google Sheet) are the system of record. Sensitive records never enter the public repository.

## 1. The reservation reference

Every reservation gets a unique reference:

- **Website requests**: the estimate flow already produces a quote reference
  `SS-YYYYMMDD-XXXXXX` shown in the owner notification (`Internal — Quote reference`). It is the
  reservation reference — do not invent a second one.
- **Phone/email/manual requests**: assign `SS-<YYYYMMDD>-<4 random letters>` using the same
  format (e.g. `SS-20261003-KQ7M`).

Never reuse a reference. The reference is how the request, the confirmation, messages and the
ledger row stay connected.

## 2. Status vocabulary (the only statuses used)

| Status | Meaning |
| --- | --- |
| `request_received` | The customer submitted a request. **No appointment exists yet.** |
| `availability_confirmation` | Hayli is checking the calendar / scope with the customer. |
| `appointment_confirmed` | Hayli has explicitly confirmed date, arrival arrangement, scope and price. The confirmation message (template B) is sent at this point. |
| `completed` | The cleaning happened. |
| `rescheduled` | A confirmed appointment moved to a new date (record both dates). |
| `canceled` | The request or appointment was canceled (record who/why briefly). |

Submitting the website form **never** creates `appointment_confirmed`. There is no live calendar
integration, so availability is checked by Hayli personally — the website must never imply
otherwise. The 60-day scheduling window applies to *requests*, never to gift-certificate validity.

## 3. The ledger (Google Sheet — owner-only)

1. Create a new Google Sheet in the company Google account named
   **“Sparkling Standard — Reservations (private)”**.
2. Import `docs/operations/RESERVATION-LEDGER-TEMPLATE.csv` (File → Import → Replace
   spreadsheet) to get the header row and column order.
3. Format: freeze row 1, add a filter on row 1, and use conditional formatting on the `status`
   column (e.g. amber for `request_received`/`availability_confirmation`, green for
   `appointment_confirmed`, grey for `completed`/`canceled`).
4. Never share this sheet publicly or paste customer rows anywhere else. It contains names and
   addresses.

| Column | What goes in it |
| --- | --- |
| `reservation_reference` | The unique `SS-…` reference. |
| `received_date` | When the request arrived (from the notification). |
| `requested_date` / `confirmed_date` | What the customer asked for / what was actually agreed. |
| `status` | One of the six statuses above. |
| `customer_name`, `phone`, `email` | From the request. |
| `service_address`, `city`, `state`, `zip` | Confirmed destination. |
| `service_type`, `frequency` | What was booked; for recurring, the agreed recurrence. |
| `scope_notes` | Condition, add-ons, pets, access — the essentials for the visit. |
| `quoted_price`, `agreed_price` | Proposed vs finally agreed. |
| `payment_status` | `pay_after_cleaning` (default), `gift_certificate`, `paid`, `refunded`. |
| `gift_certificate_code`, `gift_amount_applied` | When a certificate is redeemed. |
| `first_visit_confirmed` | For recurring: `yes` once the first visit is confirmed. |
| `future_visits_proposed` | For recurring: note that later visits are proposed, not confirmed. |
| `communication_log` | Short dated notes (request reply, confirmation sent, reminder…). |
| `estimate_reference` / `lead_note` | Any extra traceability. |

## 4. The daily flow (5 minutes)

1. A request arrives (email via the website notification) → create a ledger row with status
   `request_received`.
2. Check the calendar and the property details → status `availability_confirmation`; reply using
   template A if the customer has not already received the on-page acknowledgment.
3. Agree the date/arrival window, scope and price → status `appointment_confirmed`; send the
   branded confirmation (template B, `docs/operations/COMMUNICATION-TEMPLATES.md`).
4. After the cleaning → status `completed`; payment notes; for recurring, record whether the next
   visit is proposed (and its date) — only ever one confirmed visit at a time.
5. If a date moves → keep the row, set `rescheduled`, record both dates. Cancellations → `canceled`
   with a one-line reason.

## 5. SPARKLE100 promotion redemption inside a reservation

The $100-off welcome campaign is **claim-based**: it only ever applies because the customer
claimed `SPARKLE100` (site popup, `?promo=SPARKLE100` link, or the quarter-sheet QR), and the
engine already recorded `promotion_code` with the request and applied the discount to the
first qualifying clean. Two things the software cannot prove, so Hayli confirms them
**before honoring the discount at booking**:

1. **New recurring residential customer** — this is their first recurring service with
   Sparkling Standard (weekly or biweekly only).
2. **One per household** — no household has redeemed SPARKLE100 before.

Check the ledger for the household (name, address, phone) before confirming. If either check
fails, tell the customer honestly and price the job without the discount. When both pass,
honor the $100 off the first clean exactly as quoted and note `SPARKLE100 redeemed` plus the
date on the ledger row. Never stack it with another promotion; never apply it retroactively;
never apply it to commercial/STR/one-time work. If the campaign is ever retracted, set
`enabled: false` in `src/config/estimators/pricing-values.ts` — the site, verification and print builds
all fail closed automatically.

## 6. Gift-certificate redemption inside a reservation

When a customer redeems a gift certificate:

1. Verify the certificate code in the gift-certificate ledger
   (`docs/operations/GIFT-CERTIFICATES.md`) and check its remaining balance.
2. Set `payment_status = gift_certificate`, record the code and the amount applied.
3. Apply the value to the agreed price; any balance is handled directly with the customer.
4. Update the certificate ledger's redemption history and remaining balance — one redemption
   record per appointment, never a silent second application.

## 7. Privacy and retention

- The website stores nothing beyond the notification email; the private sheet is the record.
- Do not commit ledger exports, customer rows or addresses to the repository.
- Keep records only as long as needed for service, tax and dispute purposes; the owner decides the
  retention period with their accountant.
