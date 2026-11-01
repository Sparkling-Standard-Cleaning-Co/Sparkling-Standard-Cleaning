# Recurring replenishment Worker

Daily Cloudflare Worker that keeps the rolling 60-day recurring horizon
populated. It reuses the production recurring engine, the existing D1 database
and the existing Google Calendar credentials. It does not create a second
calendar, identity system or database.

## What it does

- Claims one durable run per Central-Time date (`recurring_worker_runs`).
- Reads active recurring plans.
- Reconciles missing, changed and failed occurrences.
- Never duplicates an existing confirmed appointment or calendar event.
- Records conflicts and errors for owner review.
- Respects paused, cancelled and completed plans.
- Does nothing unless `RECURRING_SCHEDULING_ENABLED=true`.

Cron runs in UTC. `0 9 * * *` is 3:00/4:00 AM America/Chicago depending on DST.

## Deployment (owner action)

1. Copy `wrangler.toml.example` to `wrangler.toml`.
2. Fill the **existing** production D1 `database_id` from the Cloudflare
   dashboard. Do not create a new database.
3. Add the same secrets already used by the Pages project:
   `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`,
   `GOOGLE_CALENDAR_ID`, `TRAVEL_ORIGIN`, the MapMap keys, and
   `RECURRING_SCHEDULING_ENABLED`.
4. Run `npx wrangler deploy --config wrangler.toml`.
5. Verify the Cron Trigger exists in the Cloudflare dashboard and that a run
   row appears in `recurring_worker_runs`.

The worker cannot be deployed from the repository alone because the production
database id and secrets are intentionally not committed.
