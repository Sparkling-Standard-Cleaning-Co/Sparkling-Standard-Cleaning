# Analytics setup (GTM / GA4 / Umami)

Analytics are **consent-gated, PII-free, and optional**. Empty IDs disable each service
completely (no banner, no requests, no storage). This document covers dashboard setup; the
privacy page must stay in sync with whatever is actually enabled.

## 0. Current verified state (2026-10-03, updated)

- **GTM container `GTM-KSQ26HMG`** is installed on the site and live. Production browser
  verification: zero Google requests before a consent choice, zero after declining, and **exactly
  one** GTM load after accepting analytics.
- **Website event generation is verified** in code and browser tests: after consent the site
  pushes the fixed events (section 3) into `window.dataLayer`; submit events fire only after the
  provider acknowledges a request.
- **GA4 `G-LG222LQRQ2` is operational (owner-confirmed external verification, 2026-10-03).** The
  container initially had zero tags; the owner then published their reviewed GTM configuration —
  **GTM Version 3**, containing **one Google tag, twelve custom event tags, twelve custom event
  triggers and seven data-layer variables**. GA4 receives page views, `estimate_start` and all
  three successful inquiry events (`cleaning_request_submit`, `commercial_quote_submit`,
  `str_request_submit`). For each inquiry event the owner confirmed the full chain: the website
  showed the success confirmation, the owner inbox received the email, and GA4 registered the
  event. The three primary key events are configured; automatic Enhanced Measurement **form
  interactions were disabled** so the site's explicit, honest submit events are the only form
  signal. Analytics consent testing passed (no Google requests before consent or after refusal;
  requests appear after acceptance).
- These are **owner-confirmed external results**, not automated tests performed by this
  repository. The repository-side generation tests and the owner-confirmed dashboard results
  together form the evidence.
- The prepared import files remain in the repository as a rebuild reference
  (`docs/analytics/GTM-CONTAINER-SETUP.md`); the live account configuration is authoritative.
  Never republish or overwrite the owner's container without authorization, and never add a second
  Google tag or Google's manual `gtag.js` snippet.
- **Umami** has no website ID; it does not load and is not named on the privacy page.
- **UTMs** are captured client-side for lead records; internal links/canonicals never carry them
  (enforced by `npm run validate`). Advertising features remain off; no paid analytics.

## 1. IDs

| Service | Variable | Where |
| --- | --- | --- |
| Umami Cloud (cookieless aggregate) | `PUBLIC_UMAMI_WEBSITE_ID` | `.env` / Cloudflare dashboard |
| Google Tag Manager (GA4 event tags live in the container) | `PUBLIC_GTM_CONTAINER_ID` | `.env` / Cloudflare dashboard |

`gtag.js` is **never loaded directly** — GA4 lives inside the GTM container.

## 2. Consent behavior (already implemented — verify, don't rebuild)

- Nothing loads before an explicit analytics choice (`ConsentBanner.astro` +
  `src/scripts/consent-controller.ts`).
- Consent Mode v2 defaults are all-denied; the granted state is applied before GTM loads.
- Advertising consent is never granted (the site runs no ads).
- Withdrawal stops storage immediately; queued conversions from before permission are never
  replayed after a refusal.
- The choice is stored under `pcc-consent-v1` (localStorage) and shown on `/privacy/`.

## 3. Event taxonomy (fixed names — do not add custom names casually)

| Event | Fires when | Payload keys (allowlisted) |
| --- | --- | --- |
| `call_click` | Any `tel:` link clicked | `cta_slot` |
| `text_click` | Any `sms:` link clicked | `cta_slot` |
| `estimate_start` | First interaction with the estimate flow | `service_type` |
| `estimate_step` | Advancing a step | `step`, `service_type` |
| `estimate_complete` | First valid estimated range shown | `service_type`, `outcome` |
| `cleaning_request_submit` | Residential/contact request confirmed | `service_type`, `journey` |
| `commercial_quote_start` | First interaction with the commercial form | — |
| `commercial_quote_submit` | Commercial request confirmed | `facility_type` |
| `str_request_start` | First interaction with the STR form | — |
| `str_request_submit` | STR request confirmed | — |
| `booking_request` | Estimate request sent with a preferred date | `service_type` |
| `review_link_click` | Review link clicked (once a real link exists) | `platform` |

**Never sent to analytics:** names, emails, phones, addresses, ZIP codes, photos, freeform
notes, or any form content. Lead details live only in the owner's inbox/records.

## 4. GTM / GA4 dashboard setup — completed (owner-confirmed)

The owner completed this setup on 2026-10-03 (GTM Version 3 published; see section 0). The exact
procedure is retained in **`docs/analytics/GTM-CONTAINER-SETUP.md`** (tag/trigger names,
parameters, import files, verification and key events) as the rebuild reference. Summary of what
was done:

1. The prepared container configuration was imported/created in GTM (`GTM-KSQ26HMG`): one Google
   tag (`G-LG222LQRQ2`), twelve custom-event triggers, twelve GA4 event tags, seven data-layer
   variables.
2. Verified in GTM Preview and GA4 DebugView before publishing; published as Version 3 with owner
   authorization.
3. Marked `cleaning_request_submit` / `commercial_quote_submit` / `str_request_submit` as GA4 key
   events. `estimate_start`, `estimate_complete` and `booking_request` remain secondary.
4. In the GA4 web stream, **"Form interactions" under Enhanced Measurement is disabled**; the
   site's explicit, consent-gated submit events (fired only after provider acknowledgment) are
   the only form signal.
5. Recommended still-open housekeeping (owner action): add an internal-traffic filter for owner
   devices so testing does not pollute reports.

## 4b. Website event → GA4 key-event mapping (owner dashboard)

The website emits **fixed event names**; GA4 receives them through GTM. "Key event" is a GA4
dashboard setting — marking an event here never changes the site. Distinguish the two:
**generation** = the site sent the event (visible in GTM Preview); **receipt** = the event appears
in GA4 Realtime/Reports (requires the owner's dashboard).

| Website event | Recommended GA4 key event | Why |
| --- | --- | --- |
| `call_click` | no (engagement signal) | Phone intent; useful as an audience/segment. |
| `text_click` | no (engagement signal) | Text intent. |
| `estimate_start` | **yes (secondary)** | Flow entry volume. |
| `estimate_step` | no | Funnel diagnostics only. |
| `estimate_complete` | **yes (secondary)** | A usable price was shown. |
| `cleaning_request_submit` | **yes (primary)** | A residential inquiry was *delivered*. |
| `booking_request` | **yes (secondary)** | Request included a preferred date. |
| `commercial_quote_start` | no | Top of the commercial funnel. |
| `commercial_quote_submit` | **yes (primary)** | Commercial inquiry delivered. |
| `str_request_start` | no | Top of the STR funnel. |
| `str_request_submit` | **yes (primary)** | STR inquiry delivered. |
| `review_link_click` | no (engagement signal) | Review funnel interest. |

Notes:

- Submit events fire **only after provider acknowledgment** (the same code path that shows the
  success message), so a key event means "delivered", not "button pressed".
- Key events should use a counting method of **once per event** for submits (a customer can send
  one request); engagement signals can count once per session.
- Event payload keys are allowlisted (`src/lib/analytics/events.ts`); no names, contact details,
  addresses, ZIPs, notes or form content are ever included.
- After marking key events, verify with GA4 **Realtime** while doing one synthetic in-house
  journey (accept consent, open the estimator, click call/text, submit nothing), then confirm the
  submit events when a real (or owner-authorized test) inquiry is sent.

## 5. Umami

- Create the website in Umami Cloud; copy the website ID into `PUBLIC_UMAMI_WEBSITE_ID`.
- Events arrive with the same fixed names (no payload).
- Umami is cookieless aggregate only; it also loads consent-gated on this site.

## 6. Testing

1. Load any page with DevTools Network open and consent undecided → expect **zero** requests to
   Google or Umami.
2. Allow analytics → GTM loads once (Umami only once a website ID exists); dataLayer receives
   `consent update`.
3. Trigger a `tel:` click → `call_click` appears in GTM Preview with its tag firing.
4. Submit a form (test mode) → confirmation event fires only after provider success.
5. Refuse/withdraw → no further collection; queued conversion receipts are dropped.
6. Verify the privacy page matches the enabled services before launch.
7. `npm run analytics:gtm:verify` confirms the import artifacts still match the event taxonomy;
   `npm run validate` runs it with the other static checks.
