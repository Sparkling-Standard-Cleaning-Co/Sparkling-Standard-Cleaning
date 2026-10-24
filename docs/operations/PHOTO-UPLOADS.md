# Customer photo uploads — architecture and provisioning

Owner directive: Smart Estimate System 2.0, Part 2 (2026-10-24). Optional customer
photos on the estimator help Hayli assess a property before confirming scope.

**Production status: DISABLED until the R2 bucket is provisioned.** The upload
section is hidden by default; it appears only when the server reports that private
storage is genuinely configured. Nothing ever fakes a successful upload.

## Architecture (implemented)

- **Client** (`src/scripts/photo-uploads.ts` + the estimator's final step):
  - Availability probe `GET /api/photo-upload` → `{ enabled, maxBytes, maxCount }`.
    The section stays hidden unless `enabled: true`.
  - Section heading "Help Us Get to Know Your Space" with the owner's exact copy
    (bathroom / kitchen / main living or work area; additional photos welcome).
  - STR turnovers switch the categories to Bedrooms / Bathrooms / Kitchen /
    Laundry-linens.
  - Category selector, multi-file picker (camera capture on phones), desktop
    drag-and-drop, thumbnails, remove/replace, upload progress, clear errors.
  - Client pre-validation mirrors the server (JPEG/PNG/WebP/HEIC, size cap,
    count cap); uploaded references persist across wizard steps; a failed upload
    is never reported as success.
- **Upload** (`functions/api/photo-upload.ts`): multipart POST → private R2.
  Server-generated random object keys (`leads/<yyyy/mm>/<requestRef>/<category>-<32-hex>.<ext>`)
  — a guessed name can never retrieve a file. Magic-byte content sniffing
  (JPEG/PNG/WebP/HEIC), per-file cap (8 MiB default, 12 MiB hard), per-IP
  throttle, no credentials in the browser. iPhone HEIC uploads as-is.
- **Retrieval** (`functions/api/photo-view.ts`): private owner-only. Requires
  `PHOTO_OWNER_TOKEN`; objects served with a fixed photo content type,
  `nosniff`, `no-store`. Keys are pattern-validated before any bucket read.
- **Owner notification** (`functions/api/lead.ts`): submitted `photo_keys` become
  private viewing links (token added server-side, only inside the owner email).
  A note reminds the owner not to forward the links.
- **Privacy**: photos are used only to assess the cleaning request; the section
  copy asks customers not to include ID documents or personal paperwork.
  Retention: objects live under `leads/<month>/<requestRef>/…` — delete the
  request's folder in the R2 console when a lead is resolved or on request.

## Required Cloudflare provisioning (owner action)

1. **R2 bucket** (Cloudflare dashboard → R2): create a PRIVATE bucket, e.g.
   `sparkling-standard-lead-photos`. R2's free tier (10 GB storage, no egress
   fees) covers this use comfortably; confirm current pricing before enabling.
2. **API token for Pages binding** — instead of a token, bind the bucket
   directly: Cloudflare Pages project → Settings → Bindings → R2 bucket →
   Variable name `PHOTOS_BUCKET`.
3. **Owner viewing secret**: Pages → Settings → Environment variables → add
   `PHOTO_OWNER_TOKEN` = a long random string (production AND preview as
   desired). This token appears only in function code and the owner email.
4. Optional: `PHOTOS_MAX_BYTES` (bytes; default 8388608).
5. Redeploy. `GET /api/photo-upload` then reports `enabled: true` and the
   estimator shows the photo section. **Verify end to end with a real upload
   before announcing the feature.**

## Testing notes

- Local/unit: functions are testable with a mocked R2 binding (the bucket
  interface is `put`/`get`/`head`).
- The wizard hides the section automatically in every environment where the
  binding or token is missing — including today's production.

## Owner decisions required

1. Provision R2 (or authorize the storage choice).
2. Set `PHOTO_OWNER_TOKEN`.
3. Confirm photo retention period (e.g. delete lead folders 90 days after
   resolution) and add it to the privacy policy if desired.
