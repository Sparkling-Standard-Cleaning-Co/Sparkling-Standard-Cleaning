# Customer confirmation email

What a customer receives after submitting a website request, and exactly how it
is delivered. The automatic path is **Resend** (server-side, after the owner
notification); a manual generator remains available as a fallback.

Related: `docs/deployment/DEPLOYMENT.md` §4a (owner setup + live test),
`docs/operations/LEAD-NOTIFICATION-FORMAT.md` (the owner's email),
`docs/operations/FINANCIAL-WORKFLOW.md` (request → estimate → booking → invoice → receipt),
`docs/operations/COMMUNICATION-TEMPLATES.md` (paste-ready messages for every stage).

## 1. What the customer receives

| Layer | Delivery | Status |
| --- | --- | --- |
| On-page success message | The form itself | **Automatic** |
| Thank-you page summary | Single-use session storage, rendered from the same summary builder | **Automatic** |
| Confirmation email | `functions/api/lead.ts` → Resend → customer's submitted address | **Automatic once `RESEND_API_KEY` is set and the sending domain is verified** (`DEPLOYMENT.md` §4a) |
| Manual send (fallback) | `node scripts/customer-confirmation.mjs --data <request.json>` | Always available |

If the Resend path is not configured or fails, the lead and the on-page summary
are unaffected — see §3.

## 2. The email (single source of truth)

`src/lib/forms/customer-confirmation.ts` builds the message; nothing else
defines a competing template.

- **Subject:** `We received your Sparkling Standard request` — fixed for every
  request type; never "booking confirmed", "your receipt" or "your invoice".
- **Branded HTML:** email-client-safe (table layout, inline styles, no scripts,
  no external images, no tracking), brand palette and tagline.
- **Plain-text fallback:** the same content without markup.
- **Sender:** `Sparkling Standard Cleaning Co. <notifications@sparkling-standard.com>`
  (override with `RESEND_FROM_EMAIL` only to another verified sender).
- **Reply-to:** `owner@sparkling-standard.com` — replying reaches Hayli.
- **Wording rules (tested):** "We received your request" / "Here's a summary of
  what you submitted" / "This is not a confirmed appointment" / "Final scope,
  pricing and availability may require confirmation" / "Please don't send
  payment until we've confirmed an amount and a payment method with you."
  It never says booked, paid, invoice or receipt.

The same summary builder powers the thank-you page, so the on-page and emailed
wording cannot drift apart.

## 3. Delivery path and failure behavior

```
Customer form
  → /api/lead (validate, spam-check, Turnstile, quote verification)
  → Web3Forms owner notification          ← the lead
  → (only after that succeeds) Resend customer confirmation
  → on-page success + thank-you summary (immediate, independent)
```

| Case | Behavior |
| --- | --- |
| Owner delivery fails | The submission is a delivery failure (`502 provider_failed`); the client shows honest failure copy with call/email alternatives. **No customer confirmation is sent.** |
| Owner delivery succeeds, customer email fails (provider rejection, network, unverified domain) | The lead is **successful** (`200 { ok: true }`). The failure is logged server-side as `customer-confirmation: failed (provider N)` — no PII, no secrets. The customer is never asked to resubmit. |
| No customer email in the request (phone-only) | The confirmation is skipped (`skipped_no_email`); the lead succeeds. |
| Invalid customer email | Skipped server-side (`skipped_invalid_email`); the client forms already block invalid emails natively. |
| `RESEND_API_KEY` not set | Skipped (`skipped_not_configured`); the lead succeeds. |
| Static provider fallback (relay unavailable) | The lead is delivered directly to Web3Forms; **no customer email** is possible on this path — the on-page summary remains. |

**Duplicates:** one accepted server request sends at most one confirmation
(one call per invocation), and the browser disables the submit button while
sending. There is no database and therefore no cross-request dedupe: a customer
who manually submits the form again creates a new request and receives a new
confirmation — this is documented as an accepted limit of the current
architecture.

## 4. Owner setup (Resend)

Exact steps — Cloudflare secret, DNS records, sender address and the one
controlled live test — live in `docs/deployment/DEPLOYMENT.md` §4a. Summary:

1. Resend account + API key → Cloudflare **Secret** `RESEND_API_KEY` (never a
   `PUBLIC_*` value, never committed).
2. Add `sparkling-standard.com` in Resend → Domains; add the generated DNS
   records in Cloudflare exactly as shown (DNS-only). Do **not** alter the
   existing Google Workspace MX/SPF/DKIM records.
3. Wait for Resend to report the domain **Verified**.
4. Redeploy so the Functions receive the secret.
5. One owner-approved live test with an owner-controlled address.

## 5. Manual send (fallback, free)

```
node scripts/customer-confirmation.mjs --data path/to/request.json
node scripts/customer-confirmation.mjs --sample
```

The JSON is the flat field map from the owner notification (or any subset of
the same keys). Output goes to git-ignored `confirmation-out/`:
`confirmation-<label>.html` and `.txt`. Use it when a personal reply adds value
or when Resend is not yet configured.

## 6. What the email never does

- Never implies a confirmed appointment, a booking or a scheduled visit.
- Never presents a provisional estimate as a final price.
- Never acts as an invoice or a payment receipt; no payment is taken by a form.
- Never contains another customer's information, internal verification codes,
  labor math, credentials or the private operating origin.

## 7. Testing

- `tests/customer-email.test.ts` — Resend delivery module: fixed subject,
  recipient, HTML/text, overrides, skips, provider failure, no PII/secret.
- `tests/api.test.ts` — `/api/lead` integration with the Resend API mocked:
  one send after owner success, no send after owner failure, failure after
  success still returns a successful lead, no duplicate send, no secret leaks.
- `tests/customer-confirmation.test.ts` — wording rules, email-safe HTML,
  escaping, estimate labeling, gift/commercial variants.
- `tests/request-summary.test.ts` / `tests/submission-receipt.test.ts` — the
  shared summary and single-use session receipt.
- Browser: the thank-you summary, invalid-email blocking and double-submit
  prevention (`tests/browser/journey.test.mjs`).

No real email is ever sent by the automated tests (all provider calls are
mocked).

## 8. Owner decisions

1. Complete the Resend setup (API key + domain verification) to activate the
   automatic customer email — see `DEPLOYMENT.md` §4a.
2. Run the one controlled live test (owner-approved).
