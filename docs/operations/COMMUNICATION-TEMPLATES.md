# Communication templates

Branded, mobile-readable copy for the three customer communications. Replace `[bracketed]` text;
never invent facts. These are paste-ready for Gmail (the company's existing tool). The website
now sends the request acknowledgment automatically — on-page immediately, and by email through
Resend once configured (`docs/operations/CUSTOMER-CONFIRMATION-EMAIL.md`) — so these templates
remain for personal replies, confirmed-appointment messages and gift-certificate delivery, which
the website does not send.

Stage vocabulary is fixed by `docs/operations/FINANCIAL-WORKFLOW.md` — a request is never a
booking.

Related: `docs/operations/RESERVATION-TRACKING.md` (statuses + ledger),
`docs/operations/GIFT-CERTIFICATES.md` (certificate workflow).

---

## A. Reservation request acknowledgment

Sent when a request arrives (the website already shows an on-page acknowledgment; send this if the
customer wrote by phone/email or if a personal reply adds value).

**Subject:** `We have your request — [reservation reference]`

> Hi [customer name],
>
> Thank you for your request — I have it and nothing is booked yet. Here is what I recorded:
>
> • **Service:** [service + frequency, e.g. recurring house cleaning, every two weeks]
> • **Home:** [square footage, bedrooms/bathrooms, condition notes]
> • **Location:** [street, city, ZIP]
> • **Requested date:** [date + arrival preference]
> • **Proposed estimate:** [price or range from the notification]
> • **Reference:** [SS-…]
>
> Next I check availability and confirm the scope, arrival window and final price with you before
> your appointment is confirmed. If anything above is wrong, just reply and I will fix it.
>
> — Hayli, Sparkling Standard Cleaning Co.
> (850) 426-8479 · owner@sparkling-standard.com

---

## B. Confirmed appointment

Sent **only after Hayli has confirmed date, arrival arrangement, scope and price**. This is the
first moment an appointment exists.

**Subject:** `Confirmed: [service] on [confirmed date] — [reservation reference]`

> Hi [customer name],
>
> Your appointment is confirmed. Here are the details:
>
> • **Service:** [service + scope summary]
> • **Date:** [confirmed date]
> • **Arrival:** [exact time for the first appointment of the day, or the window]
> • **Price:** [agreed price, or the clearly stated pricing terms]
> • **Location:** [street, city, ZIP] [unit]
> • **Reference:** [SS-…]
> • **Frequency:** [one-time / weekly / every two weeks / monthly]
>
> **Before I arrive:** [preparation instructions relevant to the visit — clear counters where
> possible, secure pets that may not do well with a visitor, leave access instructions in the
> notes if you will be out.]
>
> **For recurring service:** only this first visit is confirmed. Future visits are proposed and
> confirmed one at a time with you.
>
> If anything changes, call or text (850) 426-8479 — a reply to this email reaches me too.
>
> — Hayli, Sparkling Standard Cleaning Co.

*QR (optional):* only add a QR if it leads somewhere genuinely useful. The natural target is the
contact page (`https://sparkling-standard.com/contact/`); never present a decorative QR as
functional.

---

## C. Gift-certificate purchase and delivery

**C1 — Purchase confirmation (to the purchaser only):**

**Subject:** `Gift certificate purchase confirmed — [SSGC-…]`

> Hi [purchaser name],
>
> Thank you — your gift certificate purchase is confirmed and the payment receipt has been sent to
> you separately by our payment provider. Here is what I prepared:
>
> • **Gift value:** [$ amount]
> • **Certificate code:** [SSGC-…]
> • **Certificate:** attached, printable, with a QR that opens the redemption instructions
> • **Recipient:** [name]
> • **Delivery:** [sent directly to the recipient / delivered to you to give]
>
> The certificate value is applied to the service the recipient chooses; because every home is
> different, the final scope and price are confirmed with them first. The full terms are on the
> certificate.
>
> — Hayli, Sparkling Standard Cleaning Co.
> (850) 426-8479 · owner@sparkling-standard.com

*Do not send payment/financial details to the recipient.* Keep proof of purchase and the
certificate as separate messages; the recipient receives only C2 (or a private handoff).

**C2 — Delivery to the recipient (or a gift note when the purchaser delivers it themselves):**

**Subject:** `A gift for you — Sparkling Standard gift certificate`

> Hi [recipient name],
>
> [Personal message from the purchaser — use their words verbatim.]
>
> This gift certificate is for [value] toward Sparkling Standard cleaning services. To use it,
> just contact me with the code below and we will choose a service and a date together:
>
> • **Certificate code:** [SSGC-…]
> • **Contact:** (850) 426-8479 · owner@sparkling-standard.com
>
> The printable certificate (with a scannable QR) is attached. There is no rush — contact me when
> you are ready.
>
> — Hayli, Sparkling Standard Cleaning Co.

---

## Rules

- Send from the company mailbox/form identity in use today (`owner@sparkling-standard.com`).
- Never describe a request as a booking; state status honestly (`request received`, `confirmed`).
- Never include card details, credentials, another customer's information, or the private
  operating origin.
- Attach the generated certificate HTML/PDF only to the purchaser and/or recipient — never commit
  it to the repository (`gift-out/` is git-ignored).
