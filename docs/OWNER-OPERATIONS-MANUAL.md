# OWNER OPERATIONS MANUAL

The practical guide to running the Sparkling Standard website. It explains the
ordinary work, the safe way to change it, and how to recover if something goes
wrong. Technical depth lives in the linked documents; you do not need to read
code to operate the business.

**Start here every time:** [START HERE — OWNER CONTROL CENTER](../START-HERE-OWNER-CONTROL-CENTER.md).

**Estimator specifics:** [Estimator Control Center](ESTIMATOR-CONTROL-CENTER.md).

---

## 1. The four layers — keep them separate

| Layer | What it is | Where | Who edits |
| --- | --- | --- | --- |
| Business settings | Phone, hours, service area, socials, launch flags | `src/config/business.ts`, `.env` | Owner |
| Estimator settings | Rates, labour hours, discounts, add-ons, travel, input options | `src/config/estimators/` | Owner; engineer for new rules |
| Content | Page copy, services, FAQs, reviews, checklists | `src/content/` | Owner |
| Application code and secrets | Pages, components, functions, Cloudflare environment | `src/`, `functions/`, dashboard | Developer / protected |

Never put a password, API key, token, customer record, private address or
private operating coordinate in Git.

## 2. Edit website content

1. Find the page copy in `src/content/site/` or a service in
   `src/content/services/`.
2. Edit the Markdown text, not the layout component.
3. Keep claims factual. `PENDING` facts are never turned into public claims.
4. Commit with a plain description.
5. Watch the `validate` GitHub check and review the live page.

Page-to-file map: `docs/CONTENT-GUIDE.md`.

## 3. Adjust estimator variables

Open `src/config/estimators/pricing-values.ts` for numbers or
`src/config/estimators/input-definitions.ts` for options and limits. Use the
[Estimator Control Center](ESTIMATOR-CONTROL-CENTER.md) for the full variable
directory and worked examples.

Rule of thumb:

- Changing a number that already exists → owner edit.
- Adding a new option the calculator does not understand → engineering review.
- Never edit `src/lib/estimate/` to make a routine price change.

## 4. Update service pricing

1. Edit `hourlyRates`, `minimumJob`, labour units, condition/frequency factors,
   add-on hours or the four `estimatorCalibration` factors in
   `pricing-values.ts`.
2. If the effective quote changes, bump `instantQuote.configVersion` in
   `src/config/pricing.ts`.
3. Run `npm run estimate:quotes` to see the representative effect.
4. Run `npm test` and `npm run check`.
5. Commit/push, wait for deployment, then inspect live desktop and mobile
   estimates.

Do not change multiple unrelated pricing assumptions in one commit. One clear
change is easier to verify and reverse.

## 5. Update discounts and offers

Discounts live in `pricing-values.ts` under the specific block
(`supportiveHomeDiscount`, `churchDiscount`, or `promotions`). At most one
discount applies to a quote; travel and tax are never discounted. Disabled
programs must stay disabled until exact written terms are approved and the
financial review is updated. SPARKLE100 is owner-approved and claim-based.

## 6. Replace website images or icons

- Photos: follow `docs/design/IMAGE-GUIDE.md` and record the source/licence in
  `docs/design/IMAGE-SOURCE-REGISTER.md`.
- White-tile icons: keep the supplied white background, rounded tile and exact
  artwork. Use the WebP files in `src/assets/icons/white-tile/` and register any
  replacement in `docs/design/WHITE-TILE-ICON-INVENTORY.md`.
- Never crop, recolour or stretch a tile. If a new icon is needed, add it to the
  registry (`src/lib/premium-icons.ts`) and `PremiumIcon.astro`.
- Original PNG masters belong in the local master folder, not deployed in
  `public/`.

## 7. Add a new service

This is a coordinated product change, not just a card:

1. Add a service entry in `src/content/services/` with title, summary,
   description, CTA and icon.
2. Add its path to `homepageServicePaths` in `src/lib/site.ts` only if it belongs
   in the core homepage grid.
3. Update navigation in `src/lib/site.ts` and any estimate-engine mapping.
4. Add or adjust the calculation/service matrix and server validation if the
   service is estimable.
5. Add tests and verify mobile/desktop layout.
6. Update SEO/page ownership documentation if a new page owns a query cluster.

Do not add a new service without an approved business scope, price model and
customer-facing description.

## 8. Customer photo storage

The intake is optional and server-controlled. Production uses private
Cloudflare R2 (`PHOTOS_BUCKET`), strips metadata server-side, and sends signed
owner links plus Resend attachments. A stored credential is not proof of an
active integration.

Owner checklist:

- Confirm `/api/photo-upload` reports `enabled:true`.
- Submit one real JPEG test and one iPhone HEIC test only when authorized.
- Confirm the business inbox receives the attachments.
- Remember signed links expire (default 90 days); download important photos.
- Run `/api/photo-cleanup` with the owner token to enforce retention.
- Never move customer photos into Git or marketing without consent.

Full procedure: `docs/operations/PHOTO-UPLOADS.md`.

## 9. Resend notification settings

Secrets live in Cloudflare, not the repository:

- `RESEND_API_KEY`
- `RESEND_FROM_EMAIL` / `RESEND_REPLY_TO` (optional overrides)
- owner notification recipient in `business.ts`

The owner notification goes first; the customer confirmation is attempted after
it succeeds. Do not claim delivery from a provider acceptance alone. Confirm
inbox receipt and domain verification in Resend.

## 10. Analytics and conversion events

Analytics loads only after explicit consent. GA4 property `G-LG222LQRQ2` is
installed through GTM `GTM-KSQ26HMG`. Event names are a closed taxonomy; never
send names, emails, phones, addresses, photos or form contents.

To review performance:

1. Open GA4 → Realtime/DebugView.
2. Check page views and the three inquiry events.
3. Verify the newer church/promotion events in DebugView.
4. Never add a second Google tag or republish the prepared container over the
   live configuration.

References: `docs/analytics/ANALYTICS-SETUP.md` and
`docs/analytics/GTM-CONTAINER-SETUP.md`.

## 11. Run the tests

From the active repository:

```powershell
npm run check          # TypeScript/Astro diagnostics
npm test               # unit + server + pricing regression
npm run test:browser   # real Chromium flows
npm run verify         # check + build + static validation
npm run smoke          # required pages present
npm run pending        # no unresolved PENDING facts in build
npm run testimonials   # no fake review fixtures
npm run audit:facts    # no unsupported claims
npm run live:check     # production reachability/configuration
```

A passing suite is a requirement, not a substitute for looking at the page.
Check desktop and phone.

## 12. Publish an update

1. Make one coherent change.
2. Run `npm run check`, `npm test`, and `npm run verify`.
3. Review `git status`, `git diff --stat`, and `git diff`.
4. Commit with a clear message.
5. Push to `main` only when authorized.
6. Cloudflare Pages deploys `main`; monitor GitHub checks.
7. Run `npm run live:check`.
8. Open the changed page on production on desktop and mobile; use hard refresh
   if the old page is cached.

Never force-push, rewrite history, reset owner work, or push unreviewed files.

## 13. Maintain the local master directory

The master folder holds the active repository and all business/creative assets
outside Git. Read `SPARKLING-STANDARD-MASTER-FILE-DIRECTORY.md` in that folder.
The active repository must retain its `.git` directory and history. Large
originals, customer files and archives never belong in the public repo.

## 14. Diagnose common problems

| Symptom | Check | Safe fix |
| --- | --- | --- |
| Site shows old content | Cloudflare deployment, hard refresh | Wait for deployment; verify commit SHA |
| `validate` fails | GitHub Actions log | Fix the reported file; do not bypass |
| Estimate wrong | `estimate:quotes`, pricing config, config version | Revert the one change; rerun tests |
| Form cannot send | `/api/lead` status, Web3Forms/Resend config | Use call/email; do not fake success |
| Photos missing | `/api/photo-upload`, R2 binding, retention | Check owner link expiry and R2 |
| Review not showing | `src/content/reviews/` frontmatter | Fix content; never invent a review |
| Icon blurry | Rendered size and source file | Use the correct tile and size; never stretch |
| Analytics missing | consent, GTM DebugView, event allowlist | Verify consent and live container |
| Deployment failed | Cloudflare/GitHub check | Read log; roll back the small change if needed |

## 15. Recover from a mistake

1. Stop making further edits.
2. Identify the last known-good commit (`git log --oneline`).
3. If the change is local and uncommitted, review the diff and restore the
   specific file — do not reset unrelated work.
4. If already pushed, create a **new revert commit**; never rewrite shared
   history or force-push.
5. Re-run the tests and redeploy.
6. Record what happened in the relevant verification document.

**Emergency contacts / accounts:** owner-controlled GitHub, Cloudflare, Resend,
Stripe and Google accounts. No credentials belong in this repository.
