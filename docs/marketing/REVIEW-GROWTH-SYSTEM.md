# Review growth system

Reviews are earned, honest, and never gamed. The philosophy ("make it right") makes this
system work: a customer whose concern was fixed well often leaves the strongest review.

## The workflow

```
job complete
  → confirm satisfaction (in person or same-day message)
  → if anything was missed, fix it first (satisfaction policy)
  → send the review request (with the configured review link)
  → one reasonable reminder after ~3 days (if no review and no response)
  → stop
```

## Hard rules

- **No fake reviews. No buying reviews. No incentivizing reviews** (a discount for a review is
  against platform rules and the company's honesty policy).
- **No review gating** — never ask only "happy" customers. Every customer gets the same
  request at the same point in the process.
- **No invented star counts or review totals** displayed anywhere — the site shows genuine
  review content only when the owner supplies it.
- Fix complaints before requesting a review. Requesting a review from an unhappy customer is
  how you earn a one-star.
- One reminder, then stop. Two asks maximum.

## Message templates (adapt to the channel)

**After a completed job (SMS/WhatsApp-style):**
> Hi [name], thank you for having us today! If you have 30 seconds, a quick review helps a small
> local business more than you'd think: [review link]. And if anything wasn't right, tell me
> first — I'll make it right. — [founder name]

**Reminder (once, ~3 days later):**
> Hi [name], just a gentle follow-up on the review request — no pressure at all. If anything
> about the clean wasn't perfect, reply here and I'll take care of it.

**Recurring customers (after 2–3 visits):**
> You've been with us for a few visits now — if you're happy, a review would mean a lot:
> [review link]. If not, I want to know first.

## Where the review link comes from

The review link is an owner-provided fact, captured and configured (2026-10-08):
`business.reviews.submissionUrl` = `https://g.page/r/CXAcv1Pp7OI2ECE/review` — the exact Google
"Ask for reviews" short link. **Google Business Profile is VERIFIED (owner-confirmed 2026-10-08)**
and its public profile URL is also captured in `business.reviews.profileUrl` and
`business.socials.googleProfile` (both the exact owner-supplied URL). The site's `/leave-review/`
utility page is live with the real CTA.

Use the configured link exactly as supplied — never modify, shorten, reconstruct or hand-build it.
Review requests are **unblocked**: ask after satisfaction (in person or same-day message), one
reminder after ~3 days, then stop.

## Follow-up after a review

- Reply to every review (public, short, human). Negative reviews: acknowledge, take
  responsibility, offer to make it right, never argue.
- After a review lands, the customer is a strong candidate for the referral program
  (`REFERRAL-PROGRAM.md`) — but never tie a referral reward to leaving a review.
