# Review-request delivery worker

This optional Cloudflare Worker sends queued Google review invitations after the
owner enables review automation for a branch.

It is intentionally **not deployed by the website release**. Deploying it requires
the owner's Cloudflare account and the production D1 binding.

## Safety behavior

- Only `queued` requests whose `scheduled_at` is due are sent.
- A request more than six hours past due is skipped, so enabling automation does
  not flush an old backlog.
- The branch `review_requests_enabled` switch is rechecked at send time.
- The deterministic `review-<request id>` idempotency key prevents duplicate
  provider sends.
- Every result is written to `review_requests` and
  `notification_delivery_events`; provider acceptance is not described as inbox
  delivery.
- Owner-initiated manual sends in Admin → Google Reviews do not require this
  worker and bypass the automation switch one invitation at a time.

## Deploy

1. Copy `wrangler.toml.example` to `wrangler.toml` and set the D1 database ID for
   `sparkling-standard-operations`.
2. Set `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `RESEND_REPLY_TO` and a long random
   `REVIEW_MONITOR_TOKEN` with `wrangler secret put`.
3. Deploy with `wrangler deploy`.
4. Confirm the cron schedule is every 15 minutes.
5. Test manually with the bearer token while automation is still OFF. The worker
   should report `skipped` and send nothing.
6. Enable the branch review switch only after confirming the customer email,
   branch review URL and wording.
7. Send one controlled owner-initiated invitation first, then monitor
   Communications → delivery health and the review registry.
