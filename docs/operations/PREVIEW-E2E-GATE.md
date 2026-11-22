# Preview E2E Gate

The Preview E2E gate exists only to let one disposable `*.pages.dev` host run
owner-authorized acceptance workflows. It is **not** a production feature and
must remain disabled outside an approved test window.

## Security model

- `E2E_ALLOWED_HOSTS` — comma-separated exact `*.pages.dev` hosts. Wildcards,
  production domains and malformed hosts are rejected.
- `E2E_AUTH_TOKEN` — a high-entropy secret stored only in the Cloudflare
  Preview environment. It is never committed, placed in a URL or exposed to
  browser assets.
- `POST /api/e2e/session` exchanges the token for a host-bound, HMAC-signed,
  HttpOnly, Secure, SameSite=Lax cookie with a four-hour lifetime.
- The token may also be sent as the `x-e2e-token` header for server-to-server
  test calls. The header is never sent to Stripe or another third party.
- Cookie-authenticated state-changing requests must carry the exact same-origin
  `Origin` header. Stripe webhooks are exempt from the cookie **only on the
  exact allowlisted host** and still require a valid Stripe signature.
- Production hosts, ordinary Preview hosts, missing tokens and malformed
  configuration all fail closed to the existing
  `503 {"error":"preview_read_only"}` response.

## Enabling for an authorized test window

1. Create a disposable D1 and R2 resources and bind them to Preview only.
2. Set Preview `E2E_ALLOWED_HOSTS` to the exact deployment host.
3. Generate a random token locally and set it as Preview `E2E_AUTH_TOKEN`.
4. Deploy the release candidate to that host only.
5. Create a test-mode Stripe webhook endpoint for the exact host and store its
   signing secret as Preview `STRIPE_TEST_WEBHOOK_SECRET`; never reuse the
   production webhook secret.
6. Use a dedicated Google test calendar, never the production calendar.
7. Run the acceptance journey and retain evidence outside the product
   repository.

## Disabling after the test window

1. Remove `E2E_ALLOWED_HOSTS`, `E2E_AUTH_TOKEN` and
   `STRIPE_TEST_WEBHOOK_SECRET` from Preview.
2. Delete the temporary Stripe test webhook endpoint.
3. Expire open test-mode Checkout Sessions.
4. Delete the dedicated test calendar.
5. Redeploy a clean artifact and verify the Preview returns
   `503 preview_read_only` even with the old token.

`npm test` includes host, token, cookie, webhook and production-isolation
coverage in `tests/preview-e2e.test.ts`.

## Current state

Disabled after the 2026-11-22 acceptance run. See
`docs/verification/2026-11-22-E2E-PREVIEW-ACCEPTANCE.md`.
