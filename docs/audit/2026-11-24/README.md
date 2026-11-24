# Sparkling Standard master audit - 2026-11-24

This folder is the durable index for the complete platform audit, cleanup and
operational rebuild authorized on 2026-11-24.

| Document | Purpose |
| --- | --- |
| [MASTER-AUDIT-REPORT.md](MASTER-AUDIT-REPORT.md) | Executive findings, verified baseline, module inventory, P0-P3 issues and corrective actions. |
| [CONSOLIDATION-CLEANUP-MANIFEST.md](CONSOLIDATION-CLEANUP-MANIFEST.md) | Active, duplicate, superseded, protected and deletion-candidate resources in the two local master workspaces. No destructive action was taken. |
| [CUSTOMER-FILE-JOB-LIFECYCLE.md](CUSTOMER-FILE-JOB-LIFECYCLE.md) | Current customer/job implementation, target structure, data relationships and remaining phases. |
| [REVIEW-AUTOMATION-SUPPRESSION.md](REVIEW-AUTOMATION-SUPPRESSION.md) | Customer-level review eligibility, suppression, manual overrides, timing, delivery evidence and activation controls. |
| [BRANCH-CONSOLIDATION-PLAN.md](BRANCH-CONSOLIDATION-PLAN.md) | `main` versus `production-safe` divergence, CI/CD consequences, cutover and rollback. Approval gate is explicit. |
| [IMPLEMENTATION-TRACKER.md](IMPLEMENTATION-TRACKER.md) | What was implemented, tested, deployed, deferred or blocked in this milestone. |

Related operating references:

- `docs/operations/DOCUMENT-MANAGEMENT.md` - document library lifecycle.
- `docs/operations/GOOGLE-REVIEWS.md` - owner procedure for review requests.
- `docs/operations/CUSTOMER-FILE-JOB-LIFECYCLE.md` - existing lifecycle reference.
- `docs/operations/OFFSITE-BACKUPS.md` - backup runbook.
- `docs/verification/VERIFICATION.md` - release evidence ledger.

## Baseline

- Repository: `Sparkling-Standard-Cleaning-Co/Sparkling-Standard-Cleaning`
- Branch: `production-safe`
- Application HEAD at audit start: `eeeb505`
- Live deployment at audit start: `2b9e98fa-10d4-4282-957c-6520facaf53e`
- Cloudflare account: `e751c8bfeee06d7a530609f81ee79a12`
- Production D1: `sparkling-standard-operations`
  (`82af5623-e4a0-48c5-b5da-b3aea5e84105`)
- Applied migrations at audit start: 57

No production customer, invoice, payment, signed document or lead record was
mutated by the audit. Production reads were aggregate/schema inspection only.
