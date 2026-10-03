# GTM container setup for GA4 (owner guide)

**Status 2026-10-03:** the website side is complete and verified — it loads the GTM container
`GTM-KSQ26HMG` only after an explicit analytics consent choice and pushes the fixed events below
into `window.dataLayer`. The **container side was found empty** (the owner's GTM workspace showed
zero tags on 2026-10-03), which is why the GA4 property appeared to receive nothing. This document
closes that gap.

> **Distinguish two layers**
> **Generation** = the website sent the event (verifiable in GTM Preview / browser tests).
> **Receipt** = the event arrived in the GA4 property (verifiable only in the owner's GA4
> dashboard). Nothing in this repository can confirm receipt.

## 1. Confirmed identifiers (use these — never create new ones)

| Item | Value |
| --- | --- |
| GTM container | `GTM-KSQ26HMG` |
| GA4 measurement ID | `G-LG222LQRQ2` |
| GA4 web stream | Sparkling Standard Cleaning Co. (https://sparkling-standard.com) |

Do **not** create another GTM container, GA4 property or web stream, and never paste a second
`gtag.js`/Google tag into the website. The website's only Google entry point is the GTM container.

## 2. What the website already emits (verified in code and browser tests)

Events push `{ event: '<name>', ...allowlisted payload }` to `window.dataLayer` **only after**
analytics consent (`src/lib/analytics/events.ts`, `consent-controller.ts`, `lead-forms.ts`,
`estimate-wizard.ts`, `analytics-clicks.ts`). Submit events fire only after the form provider
acknowledges the request; a provider failure fires nothing.

**Never forwarded to GA4:** names, emails, phone numbers, addresses, ZIP codes, photos, free-form
notes or any other customer content. Only the parameter columns below may be passed.

## 3. Exact GTM mapping

Trigger type for every row: **Custom Event**, condition `{{_event}}` **equals** the event name.
Tag type for every row: **Google Analytics: GA4 Event**, Measurement ID `G-LG222LQRQ2`,
**once per event**.

| # | `_event` (website) | Fires when | GTM trigger name | GTM tag name | Permitted parameters | GA4 key event |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `call_click` | Any `tel:` link clicked | `CE - call_click` | `GA4 - Event - call_click` | `cta_slot` | no — engagement |
| 2 | `text_click` | Any `sms:` link clicked | `CE - text_click` | `GA4 - Event - text_click` | `cta_slot` | no — engagement |
| 3 | `estimate_start` | First interaction with the estimate flow | `CE - estimate_start` | `GA4 - Event - estimate_start` | `service_type` | secondary |
| 4 | `estimate_step` | Valid step advanced in the estimator | `CE - estimate_step` | `GA4 - Event - estimate_step` | `step`, `service_type` | no — funnel diagnostics |
| 5 | `estimate_complete` | First valid estimated range shown | `CE - estimate_complete` | `GA4 - Event - estimate_complete` | `service_type`, `outcome` | secondary |
| 6 | `cleaning_request_submit` | Residential request delivered to the provider | `CE - cleaning_request_submit` | `GA4 - Event - cleaning_request_submit` | `service_type`, `journey` | **primary** |
| 7 | `commercial_quote_start` | First interaction with the commercial form | `CE - commercial_quote_start` | `GA4 - Event - commercial_quote_start` | — | no — funnel entry |
| 8 | `commercial_quote_submit` | Commercial request delivered | `CE - commercial_quote_submit` | `GA4 - Event - commercial_quote_submit` | `facility_type` | **primary** |
| 9 | `str_request_start` | First interaction with the STR form | `CE - str_request_start` | `GA4 - Event - str_request_start` | — | no — funnel entry |
| 10 | `str_request_submit` | STR request delivered | `CE - str_request_submit` | `GA4 - Event - str_request_submit` | — | **primary** |
| 11 | `booking_request` | Request included a preferred date | `CE - booking_request` | `GA4 - Event - booking_request` | `service_type` | secondary |
| 12 | `review_link_click` | A review link was clicked (once a real link exists) | `CE - review_link_click` | `GA4 - Event - review_link_click` | `platform` | no — engagement |

Also required once, on **Initialization – All Pages**:

| # | Tag name | Tag type | Setting | Trigger |
| --- | --- | --- | --- | --- |
| 13 | `Google Tag — Sparkling Standard GA4` | Google tag | Tag ID `G-LG222LQRQ2` | Initialization – All Pages |

**These are inquiries, not bookings or revenue.** `cleaning_request_submit`,
`commercial_quote_submit` and `str_request_submit` mean "the request reached the provider" — not
"booked", not "paid". `booking_request` means "a preferred date was included". There is
deliberately **no event for a confirmed appointment or completed job**: no booking system exists,
Hayli confirms each job personally, and payment happens after the cleaning. Never treat any of
these events as a scheduled or completed job, and never rename or repurpose them to imply one.

Each parameter needs a Data Layer Variable in GTM: `DLV - cta_slot`, `DLV - service_type`,
`DLV - step`, `DLV - outcome`, `DLV - journey`, `DLV - facility_type`, `DLV - platform`.

## 4. Import the prepared configuration (recommended)

Two import files are generated from this repository by `scripts/generate-gtm-import.mjs` and kept
in sync by `npm run validate`:

| File | Use when | Contents |
| --- | --- | --- |
| `docs/analytics/gtm-import/gtm-ga4-full-setup.json` | No working Google tag in the container | Google tag + 12 triggers + 12 event tags + 7 variables |
| `docs/analytics/gtm-import/gtm-ga4-events-only.json` | A correct Google tag for `G-LG222LQRQ2` already exists | 12 triggers + 12 event tags + 7 variables |

Import steps (owner action, browser):

1. Sign in at https://tagmanager.google.com with the account that owns `GTM-KSQ26HMG`.
2. Open the container → **Admin** → **Import Container**.
3. **Choose container file** and pick one of the two JSON files above.
4. Choose **Existing workspace** (the one you were working in) → **Merge** → **Overwrite
   conflicting tags, triggers, and variables**.
5. **Continue** → open **View Detailed Changes**. Expected: full setup adds/updates **13 tags,
   12 triggers, 7 variables**; events-only adds/updates **12 tags, 12 triggers, 7 variables**.
6. **Confirm**. The items appear in the workspace — **do not publish yet**.
7. In **Tags**, compare against the section 3 table:
   - exactly **one** Google tag (if an earlier attempt left a second, differently named Google
     tag, delete the extra one so page views are never sent twice);
   - exactly one `GA4 - Event - <name>` tag per event and one `CE - <name>` trigger per event —
     delete any earlier attempts with different names so nothing fires twice.
8. Verify (section 5), then **Submit → Publish** with a version name such as
   `GA4 website event tracking (verified)`.

## 5. Verify before publishing (owner action)

Use GTM **Preview** (Tag Assistant) and GA4 **DebugView**:

1. GTM → **Preview** → enter `https://sparkling-standard.com` → **Connect**.
2. On the site, click **Allow** in the analytics banner (nothing loads before this; that is by
   design and must stay that way).
3. Confirm the Google tag fires on the Initialization event with tag ID `G-LG222LQRQ2`.
4. Click a phone or text link → `call_click` / `text_click` fire their event tags.
5. Open `/estimate/`, start the estimator, advance steps and finish → `estimate_start`,
   `estimate_step`, `estimate_complete`.
6. Submit one owner-approved test inquiry (it really does email the owner inbox) → the submit
   event fires **after** the success message; add a preferred date to also see `booking_request`.
7. In GTM Preview, click each fired tag and confirm only the allowed parameters are forwarded.
8. With Preview still connected, open GA4 → **Admin → DebugView**. The same events should appear
   within about a minute — this is the first true proof of receipt.
9. Publish. Then have a real visitor (or owner device, after publishing) consent and watch GA4
   **Realtime** — `page_view` plus any triggered events.

## 6. GA4 property settings (owner action)

1. **Key events:** GA4 → **Admin → Events**. Mark as key events:
   - **Primary:** `cleaning_request_submit`, `commercial_quote_submit`, `str_request_submit`
   - **Secondary:** `estimate_start`, `estimate_complete`, `booking_request`
   - Counting method: **once per event** for the six above.
2. **Enhanced Measurement:** GA4 → **Admin → Data streams → web stream → Enhanced measurement**.
   - **Turn OFF "Form interactions."** The site sends its own honest submit events only after the
     provider confirms; GA4's automatic form tracking can fire on a submit that failed or was
     rejected, creating misleading duplicate data.
   - Page views, scrolls, outbound clicks and file downloads may stay on; on this static site the
     page-view setting does not duplicate the Google tag's `page_view`.
   - "Site search" is unused by this website.
3. **Internal traffic:** add an internal-traffic rule for owner devices before heavy testing so
   test visits do not pollute reports.
4. **Attribution:** see section 7.

## 7. Marketing attribution (UTMs)

- Campaign links are generated from `src/config/marketing-links.ts`
  (`npm run marketing:links`); generated lists: `docs/marketing/UTM-MASTER-LINKS.md/.csv` and
  `docs/marketing/WHERE-TO-PASTE-UTM-LINKS.md`.
- GA4 attributes a visit to a campaign when the landing URL carries the UTM parameters and the
  visitor has consented. UTMs are **never** placed on internal navigation, canonical URLs, the
  sitemap, `tel:`/`sms:`/`mailto:` links or outbound social/profile links.
- Because GTM loads only after consent, a visitor who declines analytics (or leaves the landing
  page before consenting) is not attributed in GA4. The **lead record is the authoritative
  channel → inquiry source**: the site stores first-touch and latest-touch campaign context in the
  form fields the owner receives (never in analytics).
- Google Ads auto-tagging (`gclid`/`gbraid`/`wbraid`) is preserved on lead records; never add
  manual Google Ads UTMs.

## 8. What still needs owner confirmation

- The import was completed and the container published (nothing here can do it for you).
- GA4 DebugView / Realtime shows the events (receipt, not just generation).
- Key events and Enhanced Measurement changes in section 6 are saved.
- Google Business Profile verification result (independent of analytics).
