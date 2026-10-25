# Customer photo uploads — secure intake, owner access and retention

**Implementation status:** **live in production** at `e635d7f` (Cloudflare Pages deployment
`877a241a-863b-423b-875b-1284182dcd39`). The private R2 bucket, `PHOTOS_BUCKET` binding and
`PHOTO_OWNER_TOKEN` are active. Real JPEGs and a converted iPhone HEIC uploaded successfully;
`/api/lead` returned `photoDelivery:"attached"` after Resend accepted owner emails with real MIME
attachments. The owner inbox receipt/download remains the final acceptance check.

Production `/api/photo-upload` reports `enabled:true`; the section is visible in all four
applicable estimate forms. No mock or local storage is presented as production storage.

## Customer experience

All four engines use the same `PhotoUploadSection` component and
`src/scripts/photo-uploads.ts` controller — one intake system, four category
sets:

| Engine | Categories |
| --- | --- |
| Residential | Bathroom, kitchen, main living/work area, additional |
| STR | Bedrooms, bathrooms, kitchen, laundry/linens, additional |
| Commercial | Facility/entry, floors, restrooms, special workload, additional |
| Church | Sanctuary, fellowship hall, classrooms, nursery, kitchen, church offices, additional |

- Optional; the request can be sent without photos.
- Select from the device; mobile browsers offer camera or library.
- Up to **6 photos**, **8 MB each**, **32 MB total** (server-enforced).
- Thumbnails, filenames, remove and replace; upload progress and explicit
  success/error states.
- State lives outside the DOM, so Back/Continue never loses attachments.
- A failed/partial upload keeps the photos that genuinely reached private
  storage and says exactly what remains; it never reports a partial set as
  complete and never blocks the request without explanation.
- iPhone HEIC/HEIF is converted to JPEG in the browser through `heic2any`
  (loaded lazily). A conversion failure gives an actionable instruction rather
  than a silent drop. The server rejects raw HEIC with
  `heic_conversion_required`.
- Uploads cannot change price, service, discount, tax, travel or validation.
  Submission is blocked only while an upload is in flight.

## Security and privacy controls

- **Private R2 only.** Objects have no public URL. Retrieval is through
  `/api/photo-view` with a time-limited HMAC link (default 90 days).
- **Server-generated keys:**
  `leads/<yyyy/mm>/<request-ref>/<category>-<32-hex>.<ext>`.
- **Content validation:** magic bytes for JPEG/PNG/WebP; PNG signature and
  chunk structure; JPEG marker parsing; WebP RIFF/chunk parsing; malformed
  files are rejected before storage.
- **Metadata stripping (server-side):**
  - JPEG: APP1 EXIF/XMP, APP13 IPTC and COM segments removed;
  - PNG: `eXIf`, `tEXt`, `zTXt`, `iTXt`, `tIME` chunks removed;
  - WebP: `EXIF`/`XMP ` chunks removed and VP8X flags cleared;
  - raw HEIC is not stored.
- **Abuse controls:** per-IP request throttle, per-file/per-request/total caps,
  same-origin check, and Cloudflare Turnstile verification when
  `TURNSTILE_SECRET_KEY` is configured. The browser resets its widget after an
  upload so the later lead submission can obtain a fresh token.
- **Attachment association:** `/api/lead` accepts only keys inside the
  submitted request reference, de-duplicates them, caps the count, and verifies
  each object with an R2 `head` before it appears in the owner notification.
  Invalid/foreign references are never linked or counted.
- **Owner access:** signed links in the owner notification include `exp` and
  `sig`; the master `PHOTO_OWNER_TOKEN` is never placed in a new URL. The
  legacy `t=` form is accepted only for already-delivered emails.
- **Response headers:** `Cache-Control: private, no-store`,
  `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`.
- **Analytics:** no photo content, key, URL, filename or count is sent to GA4.
  The only analytics events are the existing non-PII form events.
- **Retention:** operator-run cleanup removes objects (and `.meta.json`
  sidecars) older than the retention window, measured from the R2 upload time.
  Default 90 days; orphaned uploads from abandoned forms are removed by the same
  cutoff. Customer deletion requests can be honoured earlier.

## Owner email attachments

**Provider decision (2026-10-25):**

- **Web3Forms free plan does not support file attachments.** Attachments are a
  Pro feature (single file 5 MB by default; 5 GB storage), priced at
  **$15/month or $149/year** at the time of evaluation. It is not required for
  this implementation.
- **Resend** is already configured for this domain and supports attachments on
  its free tier (2026: **3,000 emails/month, 100/day, 40 MB per email after
  Base64**). No new account, API key, DNS record, or recurring cost is required.
  If the existing Resend account/key is not active, photo leads fall back to
  Web3Forms with private links and an explicit attachment-failure note.

**Delivery design:**

- `/api/lead` verifies each photo with R2 `head`, reads the validated,
  metadata-stripped bytes with R2 `get`, and sends the owner email through
  Resend with real MIME attachments.
- Filenames contain the request ID, sequence and category, e.g.
  `SS-20261025-ABC123_01_kitchen.jpg`.
- Attachment emails use a conservative **21.5 MB Base64 budget per email**
  (below Resend's 40 MB and common 25 MB inbox limits). Two 8 MB photos fit one
  email; the maximum six 8 MB photos arrive as up to three numbered emails
  sharing the same request ID. Each part carries the full summary and all
  private links.
- Resend retries once on retryable network/429/5xx errors and uses a stable
  `Idempotency-Key` per request part. Provider acceptance is reported as
  `accepted`, never as confirmed inbox delivery.
- If every Resend attachment email fails or is not configured, the lead is
  preserved through Web3Forms with `Photos - Attachment delivery: FAILED/NOT
  CONFIGURED` and all private links. Partial Resend delivery is reported as
  `partial`; accepted emails still contain every link. Images are never silently
  omitted.
- No photo bytes, attachment names, customer email or API key appear in logs.

`OWNER_NOTIFICATION_EMAIL` optionally overrides the recipient (default
`owner@sparkling-standard.com`). `RESEND_FROM_EMAIL` must remain a verified
sender.

Provider references: <https://resend.com/pricing>,
<https://resend.com/docs/dashboard/emails/attachments>,
<https://web3forms.com/pricing>,
<https://docs.web3forms.com/getting-started/pro-features/file-attachments>.

## Required Cloudflare provisioning (exact owner actions)

These are the only external actions that remain:

1. **Create a private R2 bucket**
   - Cloudflare dashboard → R2 → Create bucket.
   - Name: `sparkling-standard-lead-photos` (or another private name).
   - Keep public access **off**.

2. **Bind it to the Pages project**
   - Cloudflare dashboard → Workers & Pages → `sparkling-standard-cleaning` →
     Settings → Bindings → Add → **R2 bucket**.
   - Variable name: **`PHOTOS_BUCKET`**
   - Bucket: the bucket created above.
   - Production environment (add Preview only if preview uploads are wanted).

3. **Add the owner secret**
   - Settings → Variables and Secrets → Add → **Secret**
     `PHOTO_OWNER_TOKEN` = a long random value (at least 32 random bytes).
   - This secret signs photo links and authenticates cleanup. It is never
     exposed to the browser.
   - Optional: `PHOTO_LINK_TTL_DAYS` = `90` (1–365).
   - Optional: `PHOTOS_MAX_BYTES` = `8388608` (hard-capped at 12 MiB).

4. **Confirm Resend is active** — `RESEND_API_KEY` and the verified sending domain already used for customer confirmations. No new account/DNS/cost is required. Optionally set `OWNER_NOTIFICATION_EMAIL`; default `owner@sparkling-standard.com`.

5. **Turnstile**
   - If `TURNSTILE_SECRET_KEY` is already configured for the lead form, photo
     uploads verify Turnstile too; no additional key is needed.
   - If it is not configured, uploads use the per-IP throttle and limits. The
     lead form remains independently protected.

6. **Redeploy** the Pages project. Then verify:
   - `GET https://sparkling-standard.com/api/photo-upload` returns
     `{ "enabled": true, ... }`.
   - The estimator shows the photo section on all four engines.
   - Upload one real JPEG and one real iPhone HEIC photo; confirm the HEIC
     becomes a JPEG, the owner inbox contains **downloadable image attachments**
     with the request-ID filenames, every numbered attachment set arrives, and
     the private links also work.

The optional `wrangler.toml.example` documents the same binding for a
CLI-driven deployment. Do not commit a real `wrangler.toml` containing secrets.

## Production acceptance checklist

- [ ] Private R2 bucket exists; public access is off.
- [ ] `PHOTOS_BUCKET` binding and `PHOTO_OWNER_TOKEN` secret exist in the production Pages environment.
- [ ] `RESEND_API_KEY` is present and the sending domain is verified in Resend.
- [ ] `GET /api/photo-upload` reports `enabled: true` on production.
- [ ] A real JPEG upload appears in the owner email as a downloadable attachment with the request-ID filename.
- [ ] A real iPhone HEIC photo converts to JPEG and arrives as a downloadable attachment.
- [ ] A request with six photos either arrives complete or in clearly numbered attachment sets; no image is missing.
- [ ] The private signed links still open every photo.
- [ ] A simulated provider failure produces the Web3Forms fallback with an explicit failure note and links.
- [ ] No public bucket URL, credential, photo bytes, or customer PII appears in logs or analytics.
- [ ] `/api/photo-cleanup?days=90&dry=1` reports the expected retention window.

The first four are infrastructure prerequisites; the remaining items are the owner-run production acceptance test.
## Owner photo access

- Open the signed private link in the owner notification. The link is valid for
  the configured TTL (default 90 days) and displays only that photo.
- Do not forward the links. Download the photo if it must be retained for a
  job record; the R2 object remains private.
- For a permanent/manual workflow, use the Cloudflare dashboard (`R2` → bucket
  → object). The dashboard account is the authoritative owner access.

## Retention cleanup

Run from a trusted machine (never in client code):

```powershell
curl.exe -X POST "https://sparkling-standard.com/api/photo-cleanup?days=90" `
  -H "Authorization: Bearer $env:PHOTO_OWNER_TOKEN"
```

Preview without deleting:

```powershell
curl.exe -X POST "https://sparkling-standard.com/api/photo-cleanup?days=90&dry=1" `
  -H "Authorization: Bearer $env:PHOTO_OWNER_TOKEN"
```

The endpoint processes up to 500 objects per page, deletes old photo objects and
their sidecars, and reports `scanned`, `eligible`, `deleted`, `retentionDays`
and `truncated`. Repeat while `truncated` is true for a large backlog. The
retention clock is based on R2 `uploaded` time; unattached uploads are cleaned
by the same rule.

## Testing notes

- Unit tests cover magic bytes, metadata stripping, limits, Turnstile gating,
  partial storage failure, signed/expired/tampered links, cleanup auth/dry-run,
  lead association, attachment splitting, Resend request shape, retries,
  idempotency and provider-failure fallback.
- A local Cloudflare Pages / R2-compatible Miniflare smoke test passed: a real
  JPEG upload wrote a private object; the stored JPEG was 141,502 bytes
  (metadata-stripped from 141,758); and the signed retrieval returned
  `image/jpeg`, `no-store`, `no-referrer`, `X-Robots-Tag: noindex` with no
  `Exif` marker. This is local R2 emulation, not a real Cloudflare bucket
  upload.
- Browser tests cover all four category sets, thumbnails, remove/replace,
  Back/Continue persistence, a real CC0 HEIC fixture converted through
  `heic2any`, invalid files and disabled-storage hiding.
- R2 integration is **not** claimed as tested because this environment has no
  Cloudflare credentials. The mock uses the same `put`/`head`/`get`/`list`/
  `delete` interface as R2.

## Current limitations / owner decisions

1. R2 is provisioned and live; the owner must confirm inbox receipt/download for the final acceptance.
2. Retention is 90 days by default; confirm or change it and keep the privacy
   page consistent.
3. HEIC conversion happens in the browser. If a particular device/browser
   cannot decode HEIC, the customer receives an explicit instruction; the
   server never stores raw HEIC.
4. The in-memory throttle is best-effort per edge isolate. Turnstile is the
   stronger abuse control when configured.
5. No antivirus/content-disarm service is used (budget constraint); images are
   only ever served as images with `nosniff`.
