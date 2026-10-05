# Physical brand system audit — Sparkling Standard Cleaning Co.

Purpose: establish, from repository evidence only, what the brand actually is before extending it into
physical customer-acquisition media. This audit is the authority for every printed piece; the
owner's Grok-generated business-card concept is treated as inspiration, never as authority.

## 1. Who Sparkling Standard is

- **Legal/public name:** "Sparkling Standard Cleaning Co." (public wordmark "Sparkling Standard"),
  source of truth `src/config/business.ts:74,80`.
- **Founder-led:** Hayli, Founder & Owner-Operator, an owner-operated residential and commercial
  cleaning company (`business.ts` `founder`; visible identification on `/about/`).
- **Place:** Cantonment base, serving Pensacola and surrounding communities within about an hour of
  Cantonment, with select nearby service into Alabama (`business.ts` `serviceArea.summary`).
- **Contact:** (850) 426-8479 (owner-corrected 2026-10-02), owner@sparkling-standard.com,
  sparkling-standard.com (`business.ts:98`; AGENTS.md owner-confirmed facts).
- **Promise:** "The Details Are Our Standard." (`src/components/Logo.astro:38`).
- **Standard:** estimates built from real labor hours; a home that needs four and a half hours gets
  four and a half hours; later appointments use an arrival window rather than a rushed exact time
  (`src/content/site/about.md:18-24`).
- **Model:** every request is a request — Hayli personally confirms scope, date and price before
  anything is scheduled; payment is due after the cleaning (`business.ts` payments + copy).

## 2. Emotional response the website creates

Evidence from the design tokens and copy:

- **Calm, warm, premium:** warm cream surfaces (`--color-cream-50/100`, `tokens.css:12-14`), soft
  rose primary (`--color-rose-700`, `tokens.css:29`), restrained champagne accent used only as an
  accent (`tokens.css:42-46`), deep warm ink for contrast bands (`--color-ink-900`,
  `tokens.css:20`).
- **Feminine boutique + family warmth:** the brand direction comment names it explicitly
  (`tokens.css:4-7`); the blossom-and-sparkle crest and the romantic-script wordmark carry it
  visually (`Logo.astro`; owner-selected Brand A2, 2026-10-03).
- **Unhurried:** generous spacing scale (`tokens.css:99-109`), arrival-window honesty, and copy such
  as "A home is not a stop on a route" (`about.md:18-24`).
- **Trustworthy without shouting:** no review counts, no guarantees, no discount banners anywhere on
  the site; the publication flags keep unapproved claims internal (AGENTS.md publication discipline).

## 3. Customer being targeted

- Homeowners, not renters: the acquisition system scores owner-occupancy first (25 of 100 points),
  using homestead exemption plus mailing-address match (`docs/marketing/CANVASSING-SYSTEM.md`).
- Established, detail-conscious households: the estimator prices condition, frequency, pets and
  extras honestly; the content targets "the details most people never clean".
- Local: the service area is deliberately bounded to about an hour's drive; route density is a
  scored input.
- Recurring-first: the business objective is dependable weekly/biweekly residential customers
  (AGENTS.md marketing phase).

## 4. Trust signals emphasized

| Signal | Evidence |
| --- | --- |
| Real, named founder with a genuine portrait | `/about/` founder card + owner-supplied `hayli-founder.webp` |
| Personal confirmation before scheduling | Site copy + reservation receipts ("not booked yet") |
| Honest pricing method | Labor-hour estimates (`about.md`, `src/lib/estimate/`) |
| No fabricated proof | `proof`/`reviews` collections intentionally empty; no-fabrication audit passes |
| Detail-first differentiation | "The details she noticed" checklist (`about.astro`); slogan |
| Privacy and consent | Consent-gated analytics; photo privacy SOP; no PII in analytics |
| Direct contact | Working phone, SMS enabled, owner email, sticky mobile call bar |

## 5. Visual characteristics that create recognition

- **Crest:** gold gradient ring with italic "S", sparkles and a pink blossom cluster
  (`Logo.astro:49-84`).
- **Wordmark (Brand A2):** Great Vibes "Sparkling" + spaced Fraunces "STANDARD" + "Cleaning Co."
  + the tagline, all in one rose/ink tone (`Logo.astro:8-10,35-38`).
- **Palette:** cream, sand, taupe, warm ink, rose, sage, champagne — gold/champagne is an accent
  only, never small text on light (`tokens.css:4-52`).
- **Type:** Fraunces display serif + Nunito Sans body (`tokens.css:76-78`), self-hosted.
- **Form language:** pill radii, soft shadows, generous white space, editorial photography
  (representative stock labeled as such; founder portrait is genuine).

## 6. Differentiation

| Competitor type | Their signal | Sparkling Standard's answer |
| --- | --- | --- |
| Franchises | Volume, uniforms, call centers | Owner-operated; Hayli answers and confirms |
| Maid services | Hourly generic cleaning | Detail-first standard; labor-hour honest estimates |
| Gig cleaners | Lowest price, no consistency | Recurring plans with the same careful standard |
| Discount cleaners | Coupons and % off | No price games; the standard is the offer |
| Generic home services | Broad, impersonal | A named founder and a specific promise |

## 7. Reference concept analysis (`C:\Users\thoma\Downloads\bizcard.png`)

The owner supplied one Grok-generated business-card review sheet ("Regular (Support Copy)" plus a
navy/green front/back concept with an evaluation column). Candidate search of Downloads/Desktop
found no other business-card artwork; this is the intended reference.

**What works (keep):**

- Two-sided card logic: identity + contact on the front, value proposition + QR on the back.
- A QR-first call to action ("Scan for a fast estimate") with a phone fallback.
- The value framing "A cleaner home. Less stress. More time." — matches the site's customer outcome
  (time, relief, consistency).
- Local identity front and center (Pensacola, Cantonment, Escambia County).
- The evaluation column's instincts: strong hierarchy, generous spacing, one clear action.

**What conflicts with the repository (reject):**

| Concept element | Repository fact |
| --- | --- |
| Green tree/house logo | The approved gold "S" crest with sparkles and blossom (`Logo.astro`) |
| Navy/olive/green palette (#0D1B34, #2E5A40, #F7F4EE) | Cream/rose/champagne/warm ink (`tokens.css`) |
| Phone (850) 292-5555 and (850) 972-0044 | Owner-confirmed (850) 426-8479; wrong numbers must never appear |
| hayli@sparklingstandardcleaning.com | owner@sparkling-standard.com |
| sparklingstandard.com | sparkling-standard.com (hyphenated) |
| 25% OFF first clean | No promotion is approved; all programs ship disabled |
| AI/stock portrait of a woman | The genuine owner-supplied portrait of Hayli exists |
| "Fully trusted" style claims | No unverified trust claims are permitted |

The concept's **layout thinking** informed this system; its **brand execution** was replaced
entirely with repository-accurate assets.

## 8. The required test

> "If a homeowner receives this piece and then visits Sparkling-Standard.com, will they immediately
> believe they are interacting with the same company?"

Every piece in this system uses the same crest, wordmark, tagline, palette, fonts, phone, email and
domain as the live site. The QR codes resolve to the live estimate/recurring/move-out pages. The
answer is yes by construction, and the QR verification script proves the destinations.

## 9. Design principles derived for physical media

1. **3-second hierarchy:** brand mark → one promise → one action (QR) → phone.
2. **Cream background, warm ink text:** maximum legibility in sunlight; dark ink used only for
   contrast panels.
3. **Champagne is an accent, never body text** (mirrors `tokens.css`).
4. **One action per side.** No competing offers, no discount language.
5. **Honest scarcity only:** "Now scheduling in your neighborhood" is true; invented deadlines are
   not used.
6. **Founder-forward where it matters:** the genuine portrait appears on the event poster and foam
   board only.
7. **Print reality:** ≥0.125in bleed, crop marks, 300 DPI previews, QR quiet zones, die-cut spec on
   the door hanger, and a phone number large enough to read from a porch.
