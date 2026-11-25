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
| Active-first lead workspace | High | No | Implemented | `lead-default-filter.test.ts` | This release | Default excludes archived, lost and converted; All is explicit. |
| Local backup schedule | High | No | **Verified operational** | Archive verify + isolated restore | 2026-11-24 daily run | Latest archive 07:30 UTC, 2,572 files, D1 102 tables, restore passed. |
| GitHub backup workflow visibility | High | Partial | Implemented visibility, blocked on secrets | Controlled dispatch `45513633447` | `0b9bcd7` on `main` | Workflow visible/dispatchable; zero repository secrets; fails closed. |
| Backup dashboard heartbeat | High | No | Implemented | D1 `backup_runs` query | 2026-11-24 | Stale incident resolved after verified run. |
| Branch consolidation | High | Yes | Plan only | Read-only divergence analysis | Not changed | `main` 1 ahead / 133 behind; merge cutover requires owner approval. |
| Master workspace cleanup | Medium | Partial | **Executed reversible cleanup** | Three-root hash inventory | 2026-11-24 | Legacy workspace renamed/archived; two duplicate tasks disabled; 6,072 duplicate copies listed; no deletions. |
| Change orders / amendments | Medium | Yes | **Implemented** | `change-orders.test.ts` | This release | Admin/owner workflow; employee-initiated requests not exposed. |
| Unified customer timeline | Medium | Yes | **Implemented** | `customer-timeline.test.ts`, browser test | This release | Source links for jobs, invoices and agreements. |
| Full job file | Medium | Yes | **Implemented** | Browser customer/job test | This release | Crew, finance, photos, communications, change orders and timeline together. |
| One primary invoice per job | High | No | **Implemented** | `migration-0059.test.ts` | Migration 0059 | Partial unique index; supplemental invoices explicit. |
| Signing request revocation | High | No | **Implemented** | `documents.test.ts` | This release | Pending/partially signed only; captured signatures preserved. |
| Missing packet association crash | High | No | **Fixed** | `documents.test.ts`, browser library test | This release | Null-safe request detail and family packet data. |
| Admin monolith reduction | Low | Yes | Deferred | None | Not started | `src/scripts/admin.ts` remains large. |
| Lead/reservation archive workflows | High | No | Inherited | Prior Release A tests | Prior release | Verified present; not re-driven against production data. |
| Photo deletion and retention | High | No | Inherited | Prior Release B/C tests | Prior release | No photo was deleted in this audit. |

## Verification evidence for this milestone

| Check | Result |
| --- | --- |
| `npm run check` | 0 errors, 0 warnings (11 hints) |
| Unit suite | 1,118 tests; 1,117 pass; 0 fail; 1 pre-existing skip |
| Browser suite | 279/279 pass |
| Build | 41 pages |
| Validation | 2,631 links, SEO, QRs, checklist leak checks pass |
| Smoke | 21 pages |
| Production D1 export restore | 57 migrations, 101 tables, 0 FK violations before migration 0058; latest backup restore passed |
| Production migrations | 60 |
| Production foreign keys | 0 violations |
| Production orphan/duplicate checks | 0 orphans, 0 duplicate invoice numbers, 0 duplicate per-appointment invoices |
| Review automation | Disabled on both branches; 1 historical sent request |

## Release identity

- Application commit: `aaa4c83`
- Cloudflare Pages deployment: `9cea2813-c777-4dd6-97ab-f8e62c2ea845`
- Live verification: served admin asset
  `/_astro/index.astro_astro_type_script_index_0_lang.DLPf6bre.js`
- GitHub CI: `45518441282` (validate and browser passed)
- Production migrations: `0059`, `0060`; 60 applied; 0 foreign-key violations
- Release evidence: `docs/verification/2026-11-24-PLATFORM-COMPLETION.md`
