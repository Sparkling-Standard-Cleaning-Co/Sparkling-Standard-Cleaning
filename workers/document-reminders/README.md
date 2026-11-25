# Document signing reminders Worker

Runs hourly and evaluates pending signing requests.

- Default reminders at **24 hours** and **72 hours** after the request was
  created; the owner can change the intervals in the Documents admin view.
- Stops on signed, declined, void or expired requests.
- Never cancels an appointment or agreement.
- If the stored signing link has expired, a fresh 7-day link is issued.
- Every attempt is recorded in `document_signing_reminders` and audited.

## Deploy

1. Apply migration `0047_document_reminders.sql`.
2. Copy `wrangler.toml.example` to `wrangler.toml`; replace the D1 id locally.
3. Add `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `REMINDER_MONITOR_TOKEN`.
4. `npx wrangler deploy --config wrangler.toml`
5. Manual check: `curl -H "Authorization: Bearer <token>" https://<worker-url>/`

A provider acceptance is not inbox proof. Confirm one reminder in a mailbox
before treating the route as verified.
