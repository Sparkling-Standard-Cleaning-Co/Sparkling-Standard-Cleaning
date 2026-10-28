# R2 storage, retention and backup inventory

**Status:** implemented storage map and safety design; production usage counts and backup
activation require Cloudflare access and owner approval. This document does not invent bucket
names, object counts or byte sizes.

## Binding model

The application uses private Cloudflare R2 through a small storage interface:

- `PAYMENT_LEDGER` — preferred dedicated binding for payment, booking and gift records.
- `PHOTOS_BUCKET` — existing private photo binding; also the fallback ledger binding.
- `GIFT_LEDGER` — optional dedicated gift binding, falling back to the payment/photo binding.

Source: `src/lib/payments/ledger.ts:26-45`; `src/lib/gift/ledger.ts:38-44`.

The actual production bucket name is dashboard configuration and is not committed. No credentials
or full bucket identifiers are reproduced here. The `wrangler.toml.example` name is an example, not
proof of the production bucket.

## Prefix inventory

| Binding | Prefix | Data type | Written by | Retention / cleanup |
|---|---|---|---|---|
| `PHOTOS_BUCKET` | `leads/YYYY/MM/<request-ref>/<category>-<hash>.<ext>` | Customer photos, metadata stripped | `/api/photo-upload` | 30-day policy; owner-authenticated cleanup, prefix-limited |
| `PHOTOS_BUCKET` | `legal/acceptances/YYYY-MM-DD/<id>.json` | Terms acceptance audit | `/api/lead` | Business/legal record; no automatic deletion |
| `PAYMENT_LEDGER` or fallback | `payments/checkouts/<sha256>.json` | Checkout attempt/idempotency | `/api/estimate-checkout` | Financial reconciliation; no automatic deletion |
| `PAYMENT_LEDGER` or fallback | `payments/events/<stripe-event-id>.json` | Paid webhook event claim | `/api/stripe-webhook` | Financial reconciliation; no automatic deletion |
| `PAYMENT_LEDGER` or fallback | `booking/holds/<date>__<uuid>.json` | Temporary 20-minute holds | `/api/booking-hold` | Expire/release; no blanket deletion |
| `PAYMENT_LEDGER` or fallback | `booking/locks/<date>.json` | Per-day conditional lock | `src/lib/booking/holds.ts` | Short-lived; no blanket deletion |
| `PAYMENT_LEDGER` or fallback | `booking/requests/BR-<hold>.json` | Durable owner-review booking requests | `/api/lead`, `/api/booking-admin` | Business record; no automatic deletion |
| Gift ledger or fallback | `gifts/certificates/<code>.json` | Gift certificate value, redemption history | Stripe webhook; gift admin | Financial liability; no automatic deletion |
| Gift ledger or fallback | `gifts/deliveries/<code>.json` | Durable scheduled gift deliveries | Stripe webhook; gift delivery processor | Pending until sent; retained for audit |
| Planned private R2 | `agreements/templates/` | Approved agreement templates | Future owner upload | Versioned; no automatic deletion |
| Planned private R2 | `agreements/signed/` | Signed customer artifacts | Future e-sign workflow | Legal record; no automatic deletion |
| Planned private R2 | `agreements/audit/` | Signature/audit events | Future e-sign workflow | Legal record; no automatic deletion |

## Current retention status

- Customer photos: **30-day public privacy commitment**. The automated scheduler is not configured
  in this repository; cleanup is currently owner-run through `POST /api/photo-cleanup?days=30`.
- Payment, booking, gift, terms and agreement records: **not subject to photo cleanup**.
- `photo-cleanup` now requires both the `leads/` prefix and the server-generated photo key shape via
  `isPhotoKey()`. A future object under `leads/` that is not a photo is not eligible.
- No production deletion schedule is active. No destructive operation was run in this work.

## Backup status

**No independent backup is implemented or verified.** R2 object persistence is not a backup.
There is no committed backup destination, snapshot schedule, restore test or recovery runbook yet.

Recommended owner-controlled baseline (requires a separately configured destination and owner
approval before any paid service):

1. Daily incremental export of `payments/`, `booking/`, `gifts/`, `legal/` and `agreements/` to a
   separate protected bucket or encrypted archive.
2. Weekly full snapshot with integrity hash/manifest.
3. Monthly restoration test into a non-production bucket; record counts and checksums.
4. Retention distinct from cleanup: financial/legal records stay; backup generations roll.
5. Restricted credentials; no customer data in personal storage or public repositories.
6. Cost review before enabling any paid storage/egress.

Cloudflare R2 usage and lifecycle rules must be checked in the Cloudflare dashboard. This
environment has no Cloudflare account credential, so object counts, byte totals, lifecycle rules,
and backup coverage cannot be verified from the repository. The owner must provide dashboard
evidence or a read-only API credential before the inventory can show actual usage.

## Photo cleanup safety

`POST /api/photo-cleanup?days=30[&dry=1]` is owner-token protected and:

- lists only `leads/`;
- requires the full server-generated photo key pattern;
- computes a cutoff from the object upload time;
- pages in batches of 500, maximum 20 pages per invocation;
- supports `dry=1`;
- deletes only photo keys, never payment, gift, booking, legal or agreement records.

Automated daily execution is **not active**. Before activation:

1. Run a production dry run and inspect the eligible key list.
2. Verify the retention threshold and object count.
3. Confirm no non-photo record is eligible.
4. Obtain explicit owner approval for the destructive schedule.
5. Configure a scheduler only after that approval.

## Recovery limitations

- The photo bucket and financial records may share a binding. A bucket-level loss affects both.
- A dedicated `PAYMENT_LEDGER` is recommended before financial volume grows.
- A backup plan must not use photo cleanup to stay below the R2 free allowance.
- Restoration must be tested; a successful backup write is not a successful restore.
