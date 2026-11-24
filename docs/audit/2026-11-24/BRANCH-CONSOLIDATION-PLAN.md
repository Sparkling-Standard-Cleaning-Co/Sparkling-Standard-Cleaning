# Branch consolidation plan - 2026-11-24

## 1. Current state (verified)

| Fact | Value |
| --- | --- |
| Cloudflare production branch | `production-safe` |
| Live deployment | `2b9e98fa-10d4-4282-957c-6520facaf53e` |
| Live application HEAD | `eeeb505` |
| `main` relative to `production-safe` | 0 ahead, 125 behind (before this release) |
| Remote branches not merged into `production-safe` | none |
| Local branches not merged | `feat/admin-overhaul`, `initiative-6.1-facility-pricing` (9 commits, October, superseded) |
| Default GitHub branch | `main` |
| Workflows on `main` | `validate`, `photo-cleanup` |
| Workflows on `production-safe` | `validate`, `photo-cleanup`, `backup` |

`main` is a strict ancestor. There is no divergent history to reconcile.

## 2. Why this matters

1. GitHub schedules and exposes `workflow_dispatch` workflows from the default
   branch. Because `backup.yml` exists only on `production-safe`, the encrypted
   backup workflow is not registered. Manual dispatch returns HTTP 404. This is
   why the newest local encrypted backup is 2026-11-21.
2. Two production concepts (`main` and `production-safe`) create release
   ambiguity and make it easy to merge or deploy the wrong tree.
3. A fast-forward cutover is available and low risk because `main` has no unique
   commits.

## 3. Target

- `main` is the single canonical production source.
- Short-lived feature branches are used for development.
- Pull requests run `validate` and `browser` checks.
- Cloudflare Pages deploys `main`.
- `production-safe` remains as a short-term rollback ref, then is retired.
- The `backup` workflow becomes available on the default branch.

## 4. Cutover sequence (requires explicit owner approval)

Do not start until the owner approves this plan.

1. Confirm the working tree is clean.
2. Record rollback point:
   - application HEAD,
   - Cloudflare deployment id,
   - production D1 migration count.
3. Fast-forward `main` to `production-safe`:
   `git switch main; git merge --ff-only production-safe`.
4. Push `main`.
5. Verify GitHub Actions on `main`, including the presence of `backup.yml`.
6. In Cloudflare Pages, change the production branch from `production-safe` to
   `main` and deploy.
7. Verify the live site and serving asset hash.
8. Keep `production-safe` unchanged for at least one release cycle.
9. After stability, delete `production-safe` only with owner approval.

## 5. Rollback

- Cloudflare: set the production branch back to `production-safe` and redeploy the
  last verified deployment.
- Git: `main` can remain at the new commit; no history rewrite is required.
- Database: migration `0058` is additive. A code rollback does not require a
  schema rollback; the new tables remain harmless to the previous code.
- Backups: do not delete any archive as part of cutover.

## 6. CI/CD consequences

- `validate` and `browser` already run on both `main` and `production-safe` and
  on pull requests.
- No repository deployment configuration changes are required; Cloudflare Pages
  settings live in the dashboard.
- Branch protection for `main` should be enabled after cutover: require
  `validate`, require the PR flow, disallow force pushes.

## 7. Local branch cleanup (separate approval)

After the cutover, the following are deletion candidates only after confirming
they contain no unique owner work:

- `feat/admin-overhaul` (5 unique October commits, superseded)
- `initiative-6.1-facility-pricing` (2 unique October commits, superseded)

All other local and remote branches are already contained in
`production-safe`; they can be retired after owner approval.

## 8. Decision required

Owner approval is required before:

- changing the Cloudflare production branch,
- deleting or renaming any branch, or
- running the first controlled backup after cutover.
