# Implementation tracker - 2026-11-24

Legend: implemented and tested in this milestone; inherited (present before this
milestone); partial; deferred; blocked.

| Feature | Priority | Owner decision | Status | Tests | Commit / deployment | Known limitation |
| --- | --- | --- | --- | --- | --- | --- |
| Document Library active-only view | High | No | Implemented | `document-library.test.ts`, browser library test | This release | Existing 28 families display one current card each. |
| Drafts workspace separated | High | No | Implemented | `document-library.test.ts`, browser test | This release | Draft rows are visible in their own tab, not normal selectors. |
| Retired history and family archive | High | No | Implemented | `document-library.test.ts` | This release | Archive is blocked while a family is in an active packet. |
| Family restore | High | No | Implemented | `document-library.test.ts` | This release | Restores the family to the library; individual retired versions restore to draft. |
| Guarded draft deletion | High | No | Implemented | `document-library.test.ts` | This release | Only unreferenced drafts; signed, packet-linked or snapshot-linked drafts are refused. |
| Transactional revision publish | High | No | Implemented | `document-library.test.ts` | This release | Uses D1 `batch` when available, sequential fallback in the test adapter. |
| Customer review state | High | No | Implemented | `review-suppression.test.ts` | This release | One relationship per customer; no Google identity matching. |
| Automatic repeat-review suppression | High | No | Implemented | `review-suppression.test.ts`, delivery tests | This release | Automation remains disabled in production. |
| Invoice/PDF review suppression | High | No | Implemented | `review-suppression.test.ts` | This release | Legacy sent requests suppress through the fallback count. |
| Review retry and manual status | High | No | Implemented | API/service tests, browser reviews suite | This release | Retry returns to queue; sending remains explicit. |
| Customer File quick actions | Medium | No | Implemented | Browser admin suites, type check | This release | Opens existing workflows; does not duplicate them. |
| Customer File review card | Medium | No | Implemented | Browser admin suites | This release | Read-only summary with link to Google Reviews controls. |
| Backup automation | High | Yes | Blocked | Read-only audit only | Not changed | Workflow absent from default branch; manual dispatch 404; encryption key unavailable in session. |
| Fresh D1 export + restore proof | High | No | Implemented | `verify-d1-export.mjs` | 2026-11-24 export | Export is local private evidence, not committed. |
| Branch consolidation | High | Yes | Plan only | Read-only divergence analysis | Not changed | `main` 125 behind; cutover requires owner approval. |
| Master workspace cleanup | Medium | Yes | Manifest only | Hash inventory | Not changed | 1,985 duplicate groups, about 1.03 GB; no moves without approval. |
| Change orders / amendments | Medium | Yes | Deferred | None | Not started | Requires product design and new records. |
| Unified customer timeline | Medium | Yes | Deferred | None | Not started | Current detail is grouped tables, not a merged feed. |
| Full job file | Medium | Yes | Partial (inherited) | Prior job invoice tests | Prior release | Crew time, photos, payments and communications are not on one job page. |
| Admin monolith reduction | Low | Yes | Deferred | None | Not started | `src/scripts/admin.ts` remains large. |
| Lead/reservation archive workflows | High | No | Inherited | Prior Release A tests | Prior release | Verified present; not re-driven against production data. |
| Photo deletion and retention | High | No | Inherited | Prior Release B/C tests | Prior release | No photo was deleted in this audit. |

## Verification evidence for this milestone

| Check | Result |
| --- | --- |
| `npm run check` | 0 errors, 0 warnings (11 hints) |
| Unit suite | 1,113 tests; 1,112 pass; 0 fail; 1 pre-existing skip |
| Browser suite | 278/278 pass |
| Build | 41 pages |
| Validation | 2,631 links, SEO, QRs, checklist leak checks pass |
| Smoke | 21 pages |
| Production D1 export restore | 57 migrations, 101 tables, 0 FK violations before migration 0058 |
| Production foreign keys | 0 violations |
| Production orphan/duplicate checks | 0 orphans, 0 duplicate invoice numbers, 0 duplicate per-appointment invoices |
| Review automation | Disabled on both branches; 1 historical sent request |

Release commit, deployment id and live verification are recorded in
`docs/verification/VERIFICATION.md` and the release evidence document.
