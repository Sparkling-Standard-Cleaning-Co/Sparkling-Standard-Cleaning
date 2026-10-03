# Lead notification format

How a website inquiry arrives in the owner's inbox. The form provider (Web3Forms, free plan)
renders the submitted field labels and values in order and does **not** support custom HTML
templates on the free plan, so the presentation is built in code: `functions/api/lead.ts` passes
the sanitized field map through `src/lib/forms/lead-notification.ts`, which produces an ordered,
readable summary. Every collected value is preserved — unmapped fields appear under
“More details” — and the customer's email becomes the provider **reply-to** address.

## Section order

| Section | Contents |
| --- | --- |
| **Inquiry** | Type (estimate / preliminary / reservation request), service, frequency, submitted time (Central), preferred date, estimate status |
| **Contact** | Name, organization (commercial), phone, email |
| **Location** | Entered address, unit, city/state/ZIP, entry method, confirmation + precision, map pin |
| **Home** | Property type, size, rooms, beds to reset, condition, last professional clean, pets |
| **Extras** | Selected add-ons, priced detail with charges, add-on ids |
| **Pricing** | Customer-proposed price, range, base, extras, discount, rounding, server recalculated price/range, verification verdict, explicit ACTION REQUIRED on a mismatch |
| **Travel** | Qualification, one-way distance/time, method, destination source |
| **Scheduling** | Arrival preference, days/time preferences, STR turnover details, date note |
| **Notes** | The customer's notes verbatim, website message, current situation |
| **Internal** | Raw verdict code, quote reference, config versions/match, verification path/status/note, pin check + distance, labor hours, rate, travel codes |
| **Attribution** | UTM source/medium/campaign/content, click ids, landing page, referrer — lead records only |

Rules: success/verdict language is honest (a delivered request is never called “booked”); a price
mismatch never hides the lead — it is delivered with an explicit review warning; no private
operating coordinates, credentials or customer data beyond the submitted form are included; values
are plain text (no HTML), and labels are fixed by code, so the customer cannot inject fields.

## Example (synthetic data)

Input: 3/2 biweekly reservation, two add-ons, verified route, a note about parking.

```
Inquiry — Type: Reservation request — proposed price, subject to personal confirmation
Inquiry — Service: House cleaning (standard)
Inquiry — Frequency: Every two weeks
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
Pricing — Customer-proposed price: $235
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
Attribution — Source: facebook
Attribution — Medium: organic_social
Attribution — Campaign: recurring
Attribution — Landing page: /recurring-cleaning/
More details — Address method: manual
```

A `MISMATCH` verdict adds:

```
Pricing — ACTION REQUIRED: The submitted price differs from the server recalculation. Review the scope and confirm the correct price with the customer before scheduling.
```

## Testing

- Unit: `tests/lead-notification.test.ts` covers residential, recurring, preliminary, mismatch,
  out-of-area, commercial, STR, many add-ons, long notes, missing optionals, unmapped-field
  preservation and the no-credentials invariant.
- Server contract: `tests/api-verification.test.ts` asserts the server verdict replaces forged
  claims and that the origin/credentials never appear in the forwarded payload.
- Live: after an owner-authorized, clearly labeled test submission, confirm the inbox shows the
  sections above and that replying goes to the customer's address.
