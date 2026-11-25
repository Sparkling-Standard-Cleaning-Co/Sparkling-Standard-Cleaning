# Backup monitor Worker

Evaluates the recorded backup heartbeat every 15 minutes.

- **No successful run beyond the daily window** or **latest run failed**:
  opens one `backup_stale` incident and alerts `admin@sparkling-standard.com`
  and `owner@sparkling-standard.com` immediately.
- **Unresolved incident beyond the configured escalation interval**
  (default 30 minutes): sends one escalation to `owner@`.
- **Successful run after an incident**: resolves the incident and sends a
  recovery notice.

It records provider acceptance in `notification_delivery_events`. It cannot
prove inbox delivery or backup restorability.

## Prerequisites

1. Migration `0044_communications.sql` applied.
2. The existing production D1 database bound as `DB`.
3. Resend runtime secret and verified sender.
4. A random monitor token for the manual health check.

## Deploy

1. Copy `wrangler.toml.example` to `wrangler.toml`.
2. Replace the D1 database id locally.
3. `npx wrangler secret put RESEND_API_KEY --config wrangler.toml`
4. `npx wrangler secret put RESEND_FROM_EMAIL --config wrangler.toml`
5. `npx wrangler secret put BACKUP_MONITOR_TOKEN --config wrangler.toml`
6. `npx wrangler deploy --config wrangler.toml`
7. Manual check:
   `curl -H "Authorization: Bearer <token>" https://<worker-url>/`

The scheduled trigger then runs every 15 minutes. Do not treat a green Worker
as a verified backup; complete the independent restore rehearsal in
`docs/operations/OFFSITE-BACKUPS.md`.
