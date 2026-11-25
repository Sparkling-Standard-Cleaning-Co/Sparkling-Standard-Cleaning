# Agent execution and production-reliability audit - 2026-11-20

## Scope

Inspected the root `AGENTS.md`, nested instructions (none found beyond the root),
OpenCode project configuration (no project `.opencode` or `opencode.json` was
present), all repository workflows, the branch/pricing/booking/payment code and
the live production records for the November 23 checkout and recurring worker.

## Root-cause findings

1. **The root `AGENTS.md` is not the primary cause.** It already requires complete
   end-to-end implementation, visual verification, investigation of failures and
   preservation of data. The recurring failures came from execution choices that
   stopped at documentation, feature gates or a first blocker.
2. **Large directives were treated as sequential reports rather than one
   milestone.** Context pressure caused later phases (admin UX, activation,
   production incident tracing) to be summarized as "blocked" instead of
   implemented.
3. **A documented feature gate was mistaken for a finished feature.** Recurring
   checkout is explicitly blocked by `RECURRING_SCHEDULING_ENABLED`; the live
   customer still saw Pay Now. This is a product defect, not merely an owner
   approval issue.
4. **The branch activation request was declared blocked without first building
   the missing branch-aware travel/estimator path.** That was honest about the
   gap but did not satisfy the owner's directive to implement it.
5. **Admin observability was insufficient.** The dashboard showed "11 recurring
   failures" without distinguishing 11 failed daily runs from 2 affected plans,
   auth failures from holiday/slot conflicts, or last checkout reason.
6. **Static-site deployment assumptions were not reconciled with "no redeploy"
   requirements.** Tampa indexing/activation cannot be fully toggled on a static
   page without an edge/rendered path.
7. **Visual tests validated DOM behavior but not all visual clipping/scroll
   behavior.** Card height and clipping were accepted without enough viewport
   inspection.
8. **Historical prospect data is local and git-ignored.** Prior reports searched
   the repository but not the actual local master/Downloads workspace; the data
   was present all along.
9. **Release documentation mixes historical and current state.** Large release
   notes in `AGENTS.md` are useful history but can obscure what is actually live.

## Instructions changed

`AGENTS.md` now includes an **Execution reliability and production diagnosis**
section requiring:

- inspect the existing implementation and local data before proposing new work;
- trace production failures through records and code before declaring a blocker;
- distinguish missing configuration, missing implementation and owner approval;
- finish the admin workflow for any capability described as usable;
- verify live visual behavior at real viewport sizes;
- do not use a feature gate as a reason to leave a customer-facing dead end;
- report the exact residual gap and the next implementable step.

Higher-priority platform instructions and all security/privacy/payment controls
remain unchanged.

## External constraints

- Owner credentials for Stripe live actions, Google Calendar/GBP, OneDrive
  synchronization and password-manager key custody.
- Legal/insurance/tax approval.
- Google Business Profile eligibility.

## Technical blockers still real

- Tampa booking activation requires a branch-aware public estimator, branch
  travel origin and scheduling path. The county/ZIP registry and independent
  Tampa price book are now configured; the remaining path must be implemented,
  not represented by a fake switch.
- Scheduled GitHub backups need owner-provisioned secrets.
- Full document-packet usability needs a guided admin workflow and live signing
  walkthrough.

## Immediate corrections from this audit

- Recurring checkout gate enabled and made visible in readiness.
- Checkout failures now recorded in the request payload and shown in admin.
- Recurring worker failures now shown with classified causes.
- Admin times use Central Time.
- Durations display as hours/minutes.
- Admin tables are bounded with sticky headers.
- Review quotes scroll internally; cards keep equal height and no top clipping.
