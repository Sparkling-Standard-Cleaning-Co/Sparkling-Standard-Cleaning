# Capability review — against a mature reference operating system

Purpose: compare this project's engineering and operational patterns with a publicly visible,
mature service-business website system used purely as an architectural reference, and record
which practical capabilities are worth adopting for Sparkling Standard Cleaning Co.

Method: read-only inspection of the reference project's public repository structure and its
operations hub / onboarding documentation. No business information, branding, credentials,
infrastructure identifiers or content was copied. Every recommendation below is re-expressed in
this project's own terminology and implemented (or not) against this repository's architecture.

Date: **2026-10-01**.

## Capability comparison

| Capability | Reference pattern | Sparkling Standard status | Action |
| --- | --- | --- | --- |
| Single operations entry point | An operations hub as the primary entry for every system, with governance rules | ❌ did not exist | ✅ **Implemented** — `docs/OPERATIONS-HUB.md` |
| Live platform-status register | One register for external-platform status (verified vs owner-reported vs pending) | ❌ scattered across launch docs | ✅ **Implemented** — `docs/operations/PLATFORM-STATUS.md` |
| Automation inventory | Explicit list of automatic vs manual work, with triggers and recovery | ❌ implicit in scripts | ✅ **Implemented** — `docs/operations/AUTOMATION-REGISTER.md` |
| Deployment guide | Complete build config, variables, staging, validation, rollback, troubleshooting | ⚠️ existed, incomplete | ✅ **Rewritten** — `docs/deployment/DEPLOYMENT.md` with the current Cloudflare branch-access fix |
| Deployment config package | GitHub-safe non-secret template + local secret workflow | ❌ did not exist | ✅ **Implemented** — `.node-version`, `wrangler.toml.example`, `deploy/*.example`, `npm run deploy:secrets` |
| Function fail-safe tests | Regression tests around deployment-critical endpoints | ⚠️ estimator only | ✅ **Implemented** — `tests/api.test.ts` (18 tests; 45 total) |
| Verification record | What was actually run, with results and pending items | ✅ exists | ✅ maintained — `docs/verification/VERIFICATION.md` |
| Browser/visual auditing methodology | Committed browser scripts (smoke, layout, a11y) run against a preview server | ⚠️ static smoke only; browser checks run with a temporary harness | ⏳ **Next** — commit a Playwright-based harness + devDependency after owner approval (see backlog) |
| Visual evidence archive in-repo | Screenshot folders under `docs/verification/` | ⚠️ screenshots produced but kept outside the repo | ⏳ optional — add curated before/after screenshots when the owner reviews the staging site |
| Marketing operating system | 90-day plan, weekly workflow, calendar, scorecard, review system | ✅ exists | done — `docs/marketing/` |
| UTM/QR attribution system | Central registry, generated docs, decode-verified QR | ✅ exists | done — `src/config/marketing-links.ts` + generated docs |
| Consent-gated analytics | Nothing loads before consent; fixed event names; no PII | ✅ live (owner-confirmed 2026-10-03): GTM `GTM-KSQ26HMG` loads after consent and GA4 `G-LG222LQRQ2` receives page views, `estimate_start` and all three inquiry key events; Enhanced Measurement form interactions disabled; Umami awaits an ID | Optional: add an internal-traffic filter |
| SEO organization | Page ownership map, strategy, audits | ✅ core exists | maintained — `docs/seo/SEO-STRATEGY.md` |
| Role onboarding | Separate developer/marketer/owner start-here documents | ⚠️ hub section only | acceptable for a solo owner; split only when a second operator joins |
| Maintenance schedule | Recurring operational cadence document | ❌ does not exist | ⏳ small addition, see backlog |
| GTM container import JSON | Versioned container structure for analytics setup | ✅ **Implemented 2026-10-03** — generated `docs/analytics/gtm-import/*.json` (full setup + events-only), kept in sync by `npm run analytics:gtm:verify` / `npm run validate` | None — import is an owner dashboard action |
| Fundraising layer | Separate noindex campaign layer | ❌ not applicable | not in this business model |
| Multi-role access/ownership doc | Dashboard access and offboarding | ❌ not needed yet (single owner) | defer until staff/agency exist |

## Implemented this session

1. **Operations hub** — one entry point for website, estimate system, lead flow, analytics,
   marketing, deployment and maintenance.
2. **Platform-status register** — the only place current external-platform status lives, with
   evidence levels and dates.
3. **Automation register** — automatic vs manual work with triggers and recovery.
4. **Deployment guide + configuration package** — exact build/runtime config, build-time vs
   runtime variables, the confirmed `wrangler pages secret bulk` workflow, staging noindex
   procedure, launch authorization, rollback and troubleshooting.
5. **Function fail-safe tests** — 18 new tests locking the deployment contract: no false success
   on form relay, missing-configuration behavior, travel and fuel fallbacks.

## Prioritized backlog (next, when the deployment is unblocked)

1. **Commit the browser regression harness** (owner approval needed for the Playwright
   devDependency): page loads, overflow, console errors, sticky bar, estimator wizard flow and an
   axe WCAG scan — the exact checks already run during recovery, made repeatable in CI.
2. **Maintenance schedule** — monthly/quarterly cadence: dependency health, estimator
   recalibration, marketing registry refresh, platform-status review, backup/export checks.
3. **Analytics activation — complete (owner-confirmed 2026-10-03).** GTM Version 3 published; GA4
   receives page views, `estimate_start` and the three inquiry key events; Enhanced Measurement
   form interactions disabled. Optional remaining: internal-traffic filter; Umami still needs a
   website ID. Reference: `docs/analytics/GTM-CONTAINER-SETUP.md`.
4. **Search/local launch package** — Google Business Profile created (verification pending;
   checklist in `docs/marketing/SOCIAL-ACCOUNT-SETUP.md`), Search Console configured, sitemap
   submitted, citation list prepared.
5. **Curated visual evidence** — store owner-approved staging screenshots under
   `docs/verification/` for future regressions.

## Deliberately not adopted

- Multi-role access documentation (no staff or agency yet).
- Fundraising-layer patterns (not part of this business).
- Content patterns from the reference business (different industry, different claims).
- Any reference-business identifiers, credentials, analytics IDs or branding.
