# Lead notification format

How a website inquiry arrives in the owner's inbox. The presentation is built in code:
`functions/api/lead.ts` passes the sanitized field map through
`src/lib/forms/lead-notification.ts`, producing an ordered, readable summary. Every collected value
is preserved — unmapped fields appear under “More details” — and the customer's email becomes the
reply-to address.

The email opens with an **at-a-glance summary** (request, customer, location, price/verdict, and a
next-action line when something needs attention) so the owner can triage from the inbox preview
before scrolling. The detail sections follow in reading order.

**Photo leads:** Web3Forms free does not support attachments, so a lead with photos is sent through
Resend with the actual metadata-stripped images attached. Web3Forms remains the fallback lead
channel with links and an explicit attachment-failure note. A no-photo lead keeps the existing
Web3Forms notification. The customer confirmation is always a separate Resend email
(`docs/operations/CUSTOMER-CONFIRMATION-EMAIL.md`).

## Section order

| Section | Contents |
| --- | --- |
| **Summary** | Request type · service · frequency; customer name/organization/phone/email; location; price + verdict; an explicit action line when something needs attention (price mismatch, unverifiable, out-of-area review, discarded date, street-level pin, gift payment link, walkthrough scheduling, turnover details) |
| **Inquiry** | Type (estimate / preliminary / reservation request), service, frequency, required initial Deep Cleaning + acknowledgment (new recurring residential requests), submitted time (Central), preferred date, estimate status |
| **Contact** | Name, organization (commercial), phone, email |
| **Location** | Entered address, unit, city/state/ZIP, entry method, confirmation + precision, map pin |
| **Home** | Property type, size, rooms, beds to reset, condition, last professional clean, pets |
| **Extras** | Selected add-ons, priced detail with charges, add-on ids |
| **Pricing** | Customer-proposed price, range, base, extras, discount, rounding, server recalculated price/range, verification verdict, explicit ACTION REQUIRED on a mismatch. For a NEW recurring residential request the proposed price is labeled **First visit (required Deep Cleaning)** and a second line carries the server-recomputed **Ongoing visits** per-visit price for the chosen rhythm (the browser's own ongoing figure is a claim — the server's number wins, and a diverging claim surfaces as a verification uncertainty) |
| **Travel** | Qualification, one-way distance/time, method, destination source |
| **Scheduling** | Arrival preference, days/time preferences, STR turnover details, date note |
| **Notes** | The customer's notes verbatim, website message, current situation |
| **Internal** | Raw verdict code, quote reference, config versions/match, verification path/status/note, pin check + distance, labor hours, rate, travel codes |
| **Attribution** | First-touch and latest-touch source/medium/campaign/content, ad click id, latest-touch landing page/referrer — lead records only |

Rules: success/verdict language is honest (a delivered request is never called “booked”); a price
mismatch never hides the lead — it is delivered with an explicit review warning; no private
operating coordinates, credentials or customer data beyond the submitted form are included; values
are plain text (no HTML), and labels are fixed by code, so the customer cannot inject fields.

## Example (synthetic data)

Input: 3/2 biweekly reservation, two add-ons, verified route, a note about parking.

```
Summary — Request: Reservation request · Residential house cleaning · Every two weeks
Summary — Customer: Synthetic Customer · 8500000000 · synthetic@example.com
Summary — Location: 100 S Baylen St, Pensacola, FL 32502
Summary — Price: Proposed $235 · Then $185 per biweekly ongoing · VERIFIED
Inquiry — Type: Reservation request — proposed price, subject to personal confirmation
Inquiry — Service: Residential house cleaning
Inquiry — Frequency: Every two weeks
Inquiry — Initial Deep Cleaning: REQUIRED before recurring residential maintenance service
Inquiry — Deep Cleaning acknowledged: Yes
Inquiry — Submitted: Oct 2, 2026, 4:04 PM Central
Inquiry — Preferred date: 2026-12-15
Inquiry — Estimate status: estimated
Contact — Name: Synthetic Customer
Contact — Phone: 8500000000
Contact — Email: synthetic@example.com
Location — Address: 100 S Baylen St
Location — City / State / ZIP: Pensacola, FL 32502
Location — Address entered via: Typed address
Location — Destination confirmed: Yes
Location — Map pin: 30.41108, -87.21641
Home — Property type: House
Home — Approximate size: 1600 sq ft
Home — Rooms: 3 bed · 2 full bath
Home — Condition: Maintained
Home — Last professional clean: Within the last month
Home — Pets: One pet
Extras — Selected: Inside oven, Bed linen change
Extras — Add-on ids: inside_oven,bed_linen_change
Extras — Priced detail: Inside oven $25.20; Bed linen change $29.40
Pricing — First visit (required Deep Cleaning): $235
Pricing — Ongoing visits (after the required first deep clean): $185 per biweekly visit
Pricing — Estimated range: $210–$255
Pricing — Base cleaning price: $195.91
Pricing — Extras subtotal: $54.60
Pricing — Rounding adjustment: $4.49
Pricing — Server recalculated price: $235
Pricing — Verification result: VERIFIED — price and travel confirmed by the server
Travel — Status: Verified route to the confirmed address
Travel — One-way: 12 mi · 16 min
Travel — Method: route · mapmap
Travel — Destination source: Server-geocoded address
Scheduling — Arrival preference: Morning window
Notes — Customer (verbatim): Please focus on the kitchen and the master bath. The back gate sticks — please lift it. Park in the driveway, not the street.
Internal — Verdict code: verified
Internal — Destination source code: address_geocode
Internal — Received at (ISO): 2026-10-02T21:04:00.000Z
Internal — Quote reference: SS-20261002-XYZ789
Internal — Config version (quote): 2026-10-01.option-c.v1
Internal — Config version (server): 2026-10-01.option-c.v1
Internal — Config match: match
Internal — Reference format valid: true
Internal — Verification path: server_relay
Internal — Verification status: authoritative
Internal — Pin check: ok
Internal — Pricing category: recurring_maintenance
Internal — Estimated labor hours: 5.82
Internal — Rate per labor hour: $42
Internal — Travel zone: core
Internal — Travel mode: routed
Attribution — First-touch source: facebook
Attribution — First-touch medium: organic_social
Attribution — First-touch campaign: recurring
Attribution — First-touch content: feed
Attribution — Latest-touch source: facebook
Attribution — Latest-touch medium: organic_social
Attribution — Latest-touch campaign: recurring
Attribution — Latest-touch content: feed
Attribution — Latest-touch landing page: /recurring-cleaning/
More details — Address method: manual
```

## Attribution rules (lead records only)

- **First-touch is captured once and never overwritten**; **latest-touch** is the most recent
  meaningful touch. A new campaign or ad click updates it; internal navigation, refreshes and
  ordinary direct views never erase it.
- Landing page and referrer describe the latest meaningful touch. A same-domain referrer
  (internal navigation) is never recorded as a referral.
- An ad click id (`gclid` / `gbraid` / `wbraid`) is preserved even when a later campaign touch
  replaced the latest record: the collector prefers the latest touch and falls back to the first.
- Field names are stable (`first_utm_*`, `latest_utm_*`, `landing_page`, `referrer_origin`,
  `gclid`/`gbraid`/`wbraid`). Plain `utm_*` keys are still accepted as a legacy fallback for the
  latest-touch labels. Rules and implementation: `src/lib/attribution.ts`.

A `MISMATCH` verdict adds:

```
Pricing — ACTION REQUIRED: The submitted price differs from the server recalculation. Review the scope and confirm the correct price with the customer before scheduling.
```

## Testing

- Unit: `tests/lead-notification.test.ts` covers residential, recurring, preliminary, mismatch,
  out-of-area, commercial, STR, many add-ons, long notes, missing optionals, unmapped-field
  preservation and the no-credentials invariant, plus first/latest attribution labeling, the
  legacy `utm_*` fallback, and the at-a-glance summary (triage facts, action lines, omissions).
- Unit: `tests/attribution.test.ts` locks the collector rules (first-touch preservation, new
  campaigns updating latest-touch, internal/direct views never erasing a campaign, external
  referrals vs same-domain navigation, ad click id survival).
- Browser: `tests/browser/attribution.test.mjs` proves the full chain — a Facebook campaign
  arrival, internal navigation to the estimator, and the first/latest fields in the submitted
  lead payload.
- Resend attachment contract: `tests/owner-email.test.ts` covers Base64 splitting, request-ID filenames, retries, idempotency keys, partial/failed provider outcomes, and the no-PII log line; `tests/photo-intake.test.ts` covers the full R2-to-owner-email path and Web3Forms fallback.
- Server contract: `tests/api-verification.test.ts` asserts the server verdict replaces forged
  claims and that the origin/credentials never appear in the forwarded payload.
- Live: after an owner-authorized, clearly labeled test submission, confirm the inbox shows the
  sections above and that replying goes to the customer's address.

## Customer photos and owner attachments

Photo leads are sent to the owner through **Resend** so the actual
metadata-stripped image files are MIME attachments. Web3Forms remains the
fallback lead channel when Resend is unavailable or rejects every attachment
email.

The owner email adds:

- `Photos - Attached` — the exact number of objects confirmed in private storage
  with an explicit "metadata stripped" note;
- `Photos - Attached files` — meaningful filenames containing the request ID,
  sequence and category (for example `SS-20261025-ABC123_01_kitchen.jpg`);
- `Photos - Private owner links` — one time-limited signed link per photo
  (default 90 days), separated by ` | `;
- `Photos - Note` — a reminder that the files/links are private and must not be
  forwarded outside Sparkling Standard.

Attachment emails are numbered (`[Photos 1/3] …`) with the same request ID.
Each part carries the full summary and every private link. The organization
uses a conservative 21.5 MB Base64 budget per email so two 8 MB photos fit
under common inbox limits; six 8 MB photos may therefore arrive as three
clearly labelled emails. No image is silently omitted.

If Resend rejects an attachment email, the lead is preserved through
Web3Forms with an explicit `FAILED — …` note and the private links. If Resend
accepts only some parts, the operation is reported as `partial` and every
accepted email still contains links to all photos. Provider acceptance is not
proof of inbox delivery.

A photo reference that fails the request-prefix, R2 existence, or R2 read check
is never counted as an attachment. Raw keys are not shown in the customer-facing
summary or confirmation.