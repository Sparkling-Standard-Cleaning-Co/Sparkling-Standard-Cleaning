# Business & institutional sales launchpad

**Master workspace:** `C:\Users\thoma\Downloads\SPARKLING STANDARD - MASTER\09 BUSINESS & INSTITUTIONAL SALES`

Open `01_START_HERE_AND_CAMPAIGN_CONTROL/START-HERE.html` first. It is linked
from the master `START-HERE.html`.

## What was produced

- 14 numbered campaign modules from control and prospect research through
  contracts, analytics, market intelligence and archive.
- Six branded, print-ready Pensacola one-pagers: churches, offices,
  property managers, STR hosts, retail/salons/gyms and realtors.
- A separate Tampa Bay prelaunch interest page. It makes no service, price,
  booking or local-profile promise.
- Introduction letters, call scripts, walkthrough checklists, email templates,
  follow-up sequence, onboarding checklist, weekly scorecard, pipeline CSV and
  competitor-research template.
- Real QR codes copied/created from the canonical marketing-link registry.

## Source of truth

- Campaign links: `src/config/marketing-links.ts` (existing IDs:
  `church_outreach`, `commercial_walkthrough`, `property_manager_commercial`,
  `str_host_turnover`, `realtor_moveout`).
- Brand: `src/config/brand.ts` and `public/brand/logo-mark.svg`.
- Generator: `scripts/b2b-campaign/generate.mjs`.
- Regenerate:

```powershell
node --experimental-strip-types scripts/b2b-campaign/generate.mjs
```

Set `B2B_OUTPUT` to a different master path if the authoritative workspace moves.

## Rules

- Pensacola is live; Tampa Bay is prelaunch and interest-only.
- No invented prices. Commercial/church quotes follow a walkthrough and the
  shared pricing engine.
- No fake reviews, references, certifications, insurance or staffing claims.
- No purchased lists, mass sends or invented decision-makers.
- Every prospect record needs a public source, branch, evidence date and next
  action.
- Legal templates remain drafts until owner and counsel approval.

## Owner use

1. Start with the Pensacola vertical that matches actual capacity.
2. Research a small named list; record provenance.
3. Deliver the one-pager, use the script, book a walkthrough.
4. Complete the walkthrough checklist and send a written scope within two
   business days.
5. Track every touch in the pipeline and review the weekly scorecard.
