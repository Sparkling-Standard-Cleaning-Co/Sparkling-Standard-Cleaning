# Recurring replenishment Worker

Daily Cloudflare Worker trigger that keeps the rolling 60-day recurring
horizon populated.

## Architecture

The recurring engine runs inside the existing Pages Functions environment via
the protected endpoint:

`POST /api/internal/recurring-replenish`

That endpoint uses the existing D1 database, Google Calendar credentials and
MapMap/Google routing configuration already configured for the production
Pages project. The Worker does **not** receive copies of those credentials.

The Worker holds only:

- `RECURRING_WORKER_ENABLED=true`
- `RECURRING_REPLENISH_URL=https://sparkling-standard.com/api/internal/recurring-replenish`
- `RECURRING_WORKER_TOKEN` — a single-purpose bearer secret also configured on
  the Pages project.

This avoids duplicating Google/OAuth secrets into a second runtime.

## What it does

- Claims one durable run per Central-Time date (`recurring_worker_runs`).
- Reads active recurring plans.
- Reconciles missing, changed and failed occurrences.
- Never duplicates an existing confirmed appointment or calendar event.
- Records conflicts and errors for owner review.
- Respects paused, cancelled and completed plans.
- Does nothing unless `RECURRING_WORKER_ENABLED=true` on both the Worker and the
  Pages endpoint.

Cron runs in UTC. `0 9 * * *` is 3:00/4:00 AM America/Chicago depending on DST.

## Deployment

The Worker has already been deployed to the existing Cloudflare account as
`sparkling-standard-recurring` with the `0 9 * * *` trigger. To redeploy:

1. Use a Wrangler configuration with the existing production D1 id.
2. Set `RECURRING_WORKER_TOKEN` with `wrangler secret bulk` or
   `wrangler secret put`.
3. Run `npx wrangler deploy --config <config>`.
4. Verify the trigger in the Cloudflare dashboard and a completed row in
   `recurring_worker_runs`.

Do not commit the production database id or the bearer token.
