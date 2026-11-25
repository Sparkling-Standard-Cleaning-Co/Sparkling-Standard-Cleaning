# Release Acceptance Evidence — 2026-11-22

**Branch:** `production-safe` before the review branch
**HEAD:** `459383d5618a304f56390bb542de77e7a332aed6`
**Production activation:** not performed. No merge, deployment, migration or
live charge.

## 1. Legal approval queue

- 29 revised candidates plus 1 new Commercial Key Custody candidate = **30
  approval rows**.
- 29 full original-vs-revised comparison PDFs, each containing:
  - the full original extraction;
  - the full revised candidate text;
  - a line-by-line diff;
  - every owner comment with its disposition;
  - an exact-version/hash approval block.
- Registry decisions and hashes preserved; the registry was read, not
  overwritten.
- Protected-activity carve-out retained.
- 10% church discount wording preserved pending exact eligibility confirmation.
- Owner proposed as I-9 custodian pending written confirmation.
- Commercial Key Custody candidate:
  - DOCX SHA-256 `f0ea664d18a022ba50dd2e31066f7322845d653f877e59e7ea437c5ed526a9ec`
  - PDF SHA-256 `c425a26d573e3614653f04e1ca9917c446ccce66b9993aed91df11768e155c2e`
- Queue workbook SHA-256
  `24a9802faacf4c2a79b33252b71a77477c069718a5c7efd59fcea4b82f281759`

Locations:

- `00 START HERE\LEGAL-REVIEW\OWNER-APPROVAL-2026-11-22\`
- `00 START HERE\LEGAL-REVIEW\RECONCILIATION-2026-11-22.md`
- `00 START HERE\LEGAL-REVIEW\final-candidates-v2\SS-CUST-COM-KEY-2026-11.*`

## 2. Real Stripe test readiness

- No Stripe key value is configured in the local `.env`; no test-mode or live
  Stripe request was made.
- `npm run stripe:checkout-sandbox` added. It refuses non-test keys, creates only
  a synthetic test customer and an unpaid Checkout Session, verifies the
  idempotent replay, retrieves and expires the session, deletes the customer and
  creates no charge.
- `docs/operations/STRIPE-TEST-MODE-RUNBOOK.md` defines the controlled test-mode
  API run and the full preview-environment journeys.
- Existing stubbed tests already prove: server-side pricing, pre-payment signing
  gate, signing resume, single session on first resume, reuse on repeat,
  expired-hold rejection before Stripe, intent expiry, checkout idempotency,
  webhook replay handling and no duplicate booking.

Owner action required: provide a rotated **test-mode** key and matching webhook
secret, and authorize a preview/test D1/R2 environment. Live keys are refused.

## 3. Backup automation

Local scheduled tasks registered:

| Task | Schedule | Status |
|---|---|---|
| `Sparkling Standard Encrypted Backup - Daily` | Daily 02:30 | Ready |
| `Sparkling Standard Encrypted Backup - Weekly Restore Test` | Sunday 03:30 | Ready |
| `Sparkling Standard Backup Health Check` | Every 6 hours | Ready; first tick healthy |

Unattended run proved:

- Fresh production D1 export succeeded (wrangler OAuth), SHA-256
  `480a7f47c1a97c4db9b7dee125e589c77218034d3867a98500736e86db04d625`.
- Encrypted archive 1,868 files / 263,313,055 plain bytes.
- Archive SHA-256
  `4a65c30648564cb3b9a930d2ae6bb781dc396233c2e468df820bf3b45e028708`.
- OneDrive upload accepted; independent download hash matched; verify passed.
- Isolated restore passed; restored D1 50 migrations, 95 data tables, 0
  foreign-key violations.
- Retention 7/4/6 applied once; newest and protected archives preserved.
- `LAST-RUN.json`, `HEALTH.json` and visible failure-alert files are written.
- Optional email alerting is supported only when the owner supplies Resend
  environment values.

Full details: `docs/operations/BACKUP-AUTOMATION.md`.

## 4. Release candidate verification

| Check | Result |
|---|---|
| `npm test` | **1,001 tests: 1,000 pass, 1 pre-existing skip, 0 fail** |
| `npm run test:browser` | **248 pass** |
| `npm run check` | 0 errors, 2 pre-existing hints |
| `npm run build` | 40 pages |
| `npm run validate` | 2,558 links, SEO, marketing, QR and leak checks passed |
| `npm run smoke` | 21 pages passed |

## 5. Unverified production dependencies

- No approved document templates exist in production; the legal packets are
  inactive.
- No real Stripe test-mode checkout run has been performed.
- The GitHub Actions cloud backup workflow is not scheduled on the default
  branch and its repository secrets are not all configured.
- No production deployment, merge, migration or live customer action was
  performed.
- The full media/master workspace is not in the daily local backup; the daily
  archive covers legal, I-9, website source and D1.

## 6. Review branch

See the final release acceptance report for the review branch name, commit and
PR URL. The branch is not merged and does not deploy production.
