# Administrator MFA and Step-Up

Updated: 2026-11-21

## Available methods

| Method | Status | Login use | Enrollment | Recovery |
|---|---|---|---|---|
| Authenticator app (TOTP) | Implemented, preserved | Existing accounts with `mfa_method = 'totp'` use a six-digit authenticator code | Settings → Set up authenticator | Single-use recovery codes |
| Email verification code | Implemented this session, available to enable | Six-digit code sent to the account's administrator email | Settings → Use email verification codes | Single-use recovery codes or a fresh email code |
| SMS verification code | Not implemented or enabled | — | — | — |

The production owner account currently has `mfa_enabled = 0`. The previously pending authenticator secret was invalidated by migration `0049_email_mfa.sql`; a fresh authenticator enrollment will generate a new secret. Existing login enforcement is unchanged until the owner enrolls and successfully verifies a new method.

## Email-code security properties

- Six digits generated with a rejection-sampled cryptographically random value.
- Stored only as a hash bound to the random challenge token; the plaintext code appears only in the email.
- Five-minute expiry.
- Five verification attempts per challenge; failed attempts are counted and exhausted challenges are removed.
- Resend cooldown of 60 seconds, plus IP and account rate limits.
- Challenge is bound to the administrator user and, for enrollment, checked against the authenticated actor.
- Codes and challenge tokens are never placed in URLs, logs, analytics, local storage or session storage. The login challenge token remains in page memory only.
- Verification accepts a one-time recovery code as a fallback.
- Email delivery is through the existing server-only Resend integration.

## SMS assessment

SMS is **not enabled**. Enabling it requires an owner-approved paid provider and a verified mobile number. A provider such as Twilio or Amazon SNS would add recurring costs including:

- a monthly phone-number fee (often roughly $1–$2/month for a US long code, depending on provider),
- a per-message US SMS fee (typically around $0.008–$0.01 per message before carrier surcharges in current published ranges), and
- A2P 10DLC registration/campaign fees where required.

These are planning ranges, not quotes; current provider pricing and carrier fees must be confirmed before activation. SMS also needs opt-in, STOP/HELP handling, abuse monitoring and a verified-phone recovery policy. It should not replace email/authenticator MFA without those controls. No SMS message was sent in this work.

## Step-up status

A fresh second-factor step-up is now enforced for MFA-enabled accounts on:

- permanent customer deletion;
- business-record data exports;
- storage cleanup, retention-policy and legal-hold changes;
- administrator invitations, role/status changes, password resets and session revocation;
- invoice creation, payments, refunds, credits, payment links and invoice emailing;
- Stripe refunds.

The step-up window is ten minutes. A successful MFA login counts as a fresh
step-up for its new session. When a protected action is attempted with an older
session, the server returns `mfa_step_up_required`; the admin interface sends a
fresh authenticator or email challenge and retries the original action once
after verification. The challenge is bound to the authenticated administrator
and a single challenge token; codes remain hashed at rest.

Accounts without MFA (including the production owner until enrollment is
verified) continue to operate without this gate. Existing password step-up for
Stripe refunds, gift redemption/void and saved-card charging remains in place.

The step-up policy is not yet applied to every administrative endpoint. Booking
creation/cancellation, dispatch assignment, document sending, pricing publication,
communications settings and other operational writes should be reviewed for the
same policy as their risk is assessed. Do not describe the system as fully
step-up protected across every endpoint.

## Owner activation checklist

1. Sign in at `/admin/`.
2. Open Settings → Your security.
3. Choose **Use email verification codes** or **Set up authenticator**. Email enrollment asks for the current account password before sending the first code.
4. For email, enter the six-digit code sent to the account email within five minutes.
5. Save the one-time recovery codes in the approved password manager/offline location.
6. Sign out, sign in again using the selected method, and verify the session is issued only after the code.
7. Verify a recovery code once in a controlled session and revoke other sessions.
8. Do not enable SMS until the owner approves the provider and budget.

If a code does not arrive, use the resend control after the cooldown. Do not request codes repeatedly; rate limits will temporarily block the account/IP.