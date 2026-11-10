# Customer-photo retention cleanup Worker

Deletes eligible customer photos and their `.meta.json` sidecars older than the
approved retention window (default 30 days) from the private
`sparkling-standard-lead-photos` R2 bucket.

The Worker only matches server-generated keys under `leads/`; payment, booking,
gift, legal, agreement and document records can never match. It does not need
the Pages `PHOTO_OWNER_TOKEN`, so it works even when the GitHub photo-cleanup
secret is absent.

## Deploy

1. Copy `wrangler.toml.example` to `wrangler.toml`.
2. `npx wrangler secret put CLEANUP_TOKEN --config wrangler.toml`
3. `npx wrangler deploy --config wrangler.toml`
4. Dry run: `curl -H "Authorization: Bearer <token>" "https://<worker-url>/?days=30&dry=1"`
5. Confirm `eligible`/`deleted` counts and that only photo keys are eligible.
6. Run a real cleanup only after the dry-run review.

The scheduled trigger runs daily. Never commit the token.
