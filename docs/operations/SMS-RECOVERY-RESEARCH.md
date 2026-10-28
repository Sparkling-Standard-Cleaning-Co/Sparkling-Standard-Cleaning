# SMS recovery research and design

**Status:** research complete. No provider account, phone number, billable message, credential or
production integration has been purchased or activated. SMS recovery remains a development track
and does **not** block email recovery or gift administration.

**Date checked:** 2026-10-28. Prices are list prices from the providers' public pages and can change.
Carrier surcharges, taxes and A2P registration fees are additional where noted.

## Requirement

One administrator (Hayli), low volume, United States numbers, password recovery as a fallback to
the already-implemented verified-email flow. Any provider must work from a Cloudflare Pages Function
over HTTPS, support short-lived one-time codes, expose delivery/error status, and not require a
dedicated inbound support line.

## Provider comparison

| Provider | Platform fee | US SMS/channel cost | Number / registration | Monthly minimum | Operational notes |
| --- | --- | --- | --- | --- | --- |
| **Twilio Verify** | **$0.05 per successful verification** | **$0.0083 per US SMS** (attempts are billed even if not completed) | Managed number pool; Verify handles templates/compliance; no separate number rental documented for the managed pool | None documented for pay-as-you-go | Turnkey OTP API, configurable TTL, rate limiting, Fraud Guard, localized templates. Best fit for one low-volume admin. |
| **Vonage Verify** | **$0.06084 per successful verification** (Verify Conversion) | Additional messaging/voice rates apply to attempted and successful verifications | Pre-approved short/long code; no virtual number purchase required | None documented for pay-as-you-go | Similar managed OTP model; Fraud Defender Advanced included. Channel fees must be added to compare exactly. |
| **Telnyx Verify** | **$0.03 per successful verification** | **SMS API from $0.004/part** plus carrier passthrough | 10DLC number **$1/month**; low-volume campaign **$2/month**; brand registration **$4.50 one-time** (plus carrier/10DLC rules) | None on pay-as-you-go | Lowest published platform fee, but requires 10DLC registration and number management. |
| **AWS End User Messaging SMS** | No separate Verify-style platform fee documented; OTP must be built or use a separate AWS OTP feature | US SMS is priced by carrier; a third-party check on 2026-10-15 reported **$0.00774/message + $0.00421 carrier fee**, but AWS presents this through a dynamic pricing tool. Confirm in the AWS calculator. | 10DLC: **$4.50** company registration, **$41.50** optional vetting, **$2/month** low-volume or **$10/month** regular campaign, **$1/month** number. The $50 T-Mobile campaign fee was listed as postponed. | No minimum documented | Strong if the business already uses AWS/IAM/CloudTrail; substantially more setup than Twilio Verify. |

Sources (official unless marked):

- Twilio Verify pricing: <https://www.twilio.com/en-us/verify/pricing> (pricing current as of August 2026)
- Vonage Verify pricing: <https://www.vonage.com/communications-apis/verify/pricing/>
- Telnyx Verify pricing: <https://telnyx.com/pricing/verify-api>
- AWS End User Messaging pricing: <https://aws.amazon.com/end-user-messaging/pricing/>
- AWS 10DLC registration: <https://docs.aws.amazon.com/sms-voice/latest/userguide/registrations-10dlc.html>
- Third-party AWS US message check (not official): <https://proofyo.com/products/aws-end-user-messaging>, facts checked 2026-10-15

## Low-volume cost model

Assumes one SMS per successful verification and the published platform/SMS rates above. Carrier
passthrough and taxes are excluded; failed delivery attempts can add SMS charges.

| Successful recoveries / month | Twilio Verify | Telnyx Verify + SMS | AWS SMS (reported rate) | Vonage |
| --- | --- | --- | --- | --- |
| 5 | ~$0.29 | ~$0.17 + fixed 10DLC | ~$0.06 + fixed 10DLC | ~$0.30 + SMS channel fee |
| 25 | ~$1.46 | ~$0.85 + fixed 10DLC | ~$0.30 + fixed 10DLC | ~$1.52 + SMS channel fee |
| 100 | ~$5.83 | ~$3.40 + fixed 10DLC | ~$1.20 + fixed 10DLC | ~$6.08 + SMS channel fee |

At the expected scale of a handful of administrator recoveries per year, all four are inexpensive.
The meaningful differences are setup effort, compliance ownership and the risk of SMS pumping if
the endpoint is ever exposed publicly.

## Recommendation

**Twilio Verify** is the recommended first integration if the owner approves a paid provider: it has
no documented monthly minimum, includes the managed number pool and compliance handling, exposes a
simple OTP API from a Pages Function, and includes fraud/rate controls. Expected operating cost at
this volume is under $1 per month.

Telnyx is the cheapest per verification but adds 10DLC registration, a number and monthly campaign
maintenance. AWS is sensible only if the business wants the integration inside an existing AWS
account; its US per-message price should be confirmed in the AWS calculator before approval.
Vonage is a viable alternative with a higher platform fee and additional channel fees.

**Approval boundary:** no account, number, 10DLC registration, message or integration will be
purchased or activated without a separate owner approval listing the provider, exact fees and
credentials needed.

## Security design (for the future integration)

- SMS is a **secondary** recovery channel, never a replacement for the verified email path and
  never sufficient alone to bypass the administrator password.
- Phone enrollment requires the authenticated administrator session, password reauthentication and
  a one-time code sent to the new number. The number is stored in E.164 form; no free-text labels.
- Codes are six digits, generated with a CSPRNG, stored only as a hash, expire after 10 minutes,
  allow at most five attempts, and are single-use.
- Resend throttling: 60 seconds between sends, at most five sends per hour per account and per
  number. Provider-level fraud controls are enabled.
- A phone-number change starts a cooling-off period (recommended 24 hours) before it can be used for
  recovery; both the old email and the new number are notified.
- SIM-swap risk: SMS recovery alone cannot restore the account. A successful SMS check requires the
  administrator password and, where possible, a verified-email confirmation. Recovery events are
  audited (provider reference, result, IP hash, timestamp) without logging codes.
- Provider outage: fall back to the verified email link; never invent a successful send. If neither
  channel is available, the owner uses the existing manual recovery procedure.
- Opt-out/help language and A2P 10DLC/toll-free verification are handled per provider before launch.
- No phone numbers, OTPs or provider credentials in analytics, logs, emails to third parties or the
  repository.

## Not implemented

The UI currently reports SMS recovery as unavailable (`sms_provider_not_configured`). No provider
API call exists. This document is a design and cost input for the owner's approval, not a working
SMS feature.
