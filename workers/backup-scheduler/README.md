# Backup scheduler Worker

GitHub evaluates scheduled workflows only on the repository default branch
(`main`), but production and `backup.yml` live on `production-safe`. This Worker
sends an authenticated `workflow_dispatch` for `backup.yml` on
`production-safe` every day at 08:30 UTC.

It does not change `main`, `production-safe`, the default branch or any
Cloudflare Pages deployment source.

## Owner setup

1. Create a fine-grained GitHub token for the repository with **Actions: write**
   only.
2. Store it as the Worker secret `GITHUB_DISPATCH_TOKEN`.
3. Store a random `BACKUP_SCHEDULER_TOKEN` for manual health checks.
4. Deploy:

```powershell
cd workers/backup-scheduler
Copy-Item wrangler.toml.example wrangler.toml
npx wrangler deploy --config wrangler.toml
```

5. Manual check:

```powershell
curl -H "Authorization: Bearer <scheduler-token>" https://<worker-url>/
```

The response reports whether GitHub accepted the dispatch. A dispatch is not
proof that the backup succeeded; verify the Actions run and the recorded backup
health.
