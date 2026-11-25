# Branch consolidation plan - 2026-11-24

## 1. Current state (verified)

| Fact | Value |
| --- | --- |
| Cloudflare production branch | `production-safe` |
| Live deployment at this milestone | `9cea2813-c777-4dd6-97ab-f8e62c2ea845` |
| Live application HEAD | `aaa4c83` |
| `main` relative to `production-safe` | **1 ahead, 133 behind** |
| `main` unique commit | `0b9bcd7` - default-branch backup workflow visibility |
| Remote branches not merged into `production-safe` | none |
| Local branches not merged | `feat/admin-overhaul`, `initiative-6.1-facility-pricing` (9 commits, October, superseded) |
| Default GitHub branch | `main` |
| Workflows on `main` | `validate`, `photo-cleanup`, `backup` |
| Workflows on `production-safe` | `validate`, `photo-cleanup`, `backup` |
| Production migrations | 60 |

`main` is no longer a strict ancestor because it has the workflow-visibility
commit `0b9bcd7`. A fast-forward is no longer possible; cutover requires one
merge commit. The inverse is clean: `production-safe` contains everything from
`main` except that one workflow commit.

## 2. Why this matters

1. GitHub now exposes `backup.yml` from the default branch. A controlled dispatch
   succeeded technically but failed fast because the repository has **zero
   Actions secrets or variables** (run `45513633447`; `CLOUDFLARE_API_TOKEN`
   missing). The GitHub cloud path remains dormant until the owner adds secrets.
2. The local Windows daily backup is operational and verified; it is the current
   protection path. Cutover is therefore no longer required merely to obtain
   backup coverage.
3. Two production concepts (`main` and `production-safe`) still create release
   ambiguity and make it easy to merge or deploy the wrong tree.
4. Cutover now needs a merge commit, not a fast-forward. The workflow on `main`
   currently checks out `production-safe`; it must be changed to `main` as part
   of cutover so it survives retirement of `production-safe`.

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
   - application HEAD `aaa4c83` or later,
   - Cloudflare deployment `9cea2813-c777-4dd6-97ab-f8e62c2ea845` or later,
   - production D1 migration count 60.
3. Create a temporary branch from `main` and merge `production-safe`:
   `git switch main; git merge --no-ff production-safe`.
4. Resolve the expected `.github/workflows/backup.yml` add/add conflict by
   keeping the default-branch version and changing its checkout ref from
   `production-safe` to `main`.
5. Run `npm run verify` and the focused backup workflow inspection.
6. Push `main` and verify CI.
7. In Cloudflare Pages, change the production branch from `production-safe` to
   `main` and deploy.
8. Verify the live site, admin bundle and a controlled backup workflow dispatch
   after repository secrets exist.
9. Keep `production-safe` unchanged for at least one release cycle.
10. After stability, delete `production-safe` only with owner approval.

**Expected file conflict:** `main` has `backup.yml` with
`ref: production-safe`; `production-safe` has the older workflow without that
ref. Keeping `main`'s version and updating the ref to `main` is the intended
resolution. No application source conflict is expected because `main` contains
nothing else unique.

## 5. Rollback

- Cloudflare: set the production branch back to `production-safe` and redeploy the
  last verified deployment.
- Git: `main` can remain at the new commit; no history rewrite is required.
- Database: migrations `0058`, `0059` and `0060` are additive. A code rollback
  does not require a schema rollback; the new tables/columns remain harmless to
  the previous code.
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
- running the first controlled GitHub backup after cutover.

Owner action is also required to add the repository backup secrets and decide
whether the GitHub workflow or the verified local schedule is the primary path.
