// Builds the owner-review package of proposed customer agreements.
//
// Every document is DRAFT language for owner and Florida counsel review.
// Nothing here activates an agreement, collects a signature or changes the
// published Terms of Service.
//
// Usage:
//   node scripts/agreements/build-review-package.mjs [--out <directory>] [--no-pdf]
//
// Default output:
//   C:\Users\thoma\Downloads\Sparkling-Standard-Master\05_AGREEMENTS_AND_LEGAL\REVIEW_REQUIRED

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { htmlDocument } from '../lib/markdown-doc.mjs';

const args = process.argv.slice(2);
const outIndex = args.indexOf('--out');
const OUT =
  outIndex >= 0 && args[outIndex + 1]
    ? path.resolve(args[outIndex + 1])
    : path.join(
        process.env.USERPROFILE ?? 'C:\\Users\\thoma',
        'Downloads',
        'Sparkling-Standard-Master',
        '05_AGREEMENTS_AND_LEGAL',
        'REVIEW_REQUIRED',
      );
const producePdf = !args.includes('--no-pdf');

const TODAY = '2026-10-30';
const VERSION = '2026-10-30.draft.v1';
const BUSINESS = 'Sparkling Standard LLC';
const BRAND = 'Sparkling Standard';
const TERMS_VERSION = '2026-10-28.terms.v2';
const CONTACT_PHONE = '(850) 426-8479';
const CONTACT_EMAIL = 'owner@sparkling-standard.com';
const SITE = 'https://sparkling-standard.com';

const BANNER = `> **DRAFT FOR OWNER AND LEGAL REVIEW — NOT IN EFFECT.**
>
> This is proposed contract language prepared ${TODAY}. It is not a binding agreement, has not
> been reviewed by a Florida attorney, and must not be shown to a customer or signed until the
> owner approves it and every activation gate in \`src/config/agreements.ts\` is satisfied.
>
> Labels used throughout:
>
> - **[EXISTING POLICY]** — already published or configured by the owner and in effect today.
> - **[PROPOSED]** — new contract wording offered for the owner's decision.
> - **[OWNER DECISION]** — a business choice only the owner can make; the draft does not invent it.
> - **[LEGAL REVIEW]** — wording that must be settled by counsel before use.
> - **[NOT ACTIVE]** — describes functionality that exists but is deliberately switched off.`;

function header(title, subtitle) {
  return `# ${title}

**Status:** DRAFT — owner and legal review required — **not in effect**

**Draft version:** ${VERSION} | **Prepared:** ${TODAY}

**Provider:** ${BUSINESS}, doing business as ${BRAND}

**Provider contact:** ${CONTACT_PHONE} · ${CONTACT_EMAIL} · ${SITE}

**Related published policy:** Terms of Service ${TERMS_VERSION}

${subtitle ? `_${subtitle}_\n` : ''}
${BANNER}
`;
}

const parties = `## 1. Parties, property, and authority

**[EXISTING POLICY]** This agreement is between ${BUSINESS} ("we", "us", "our") and the customer
identified in the signature block ("you"). It applies only to the service address written in the
signature block or the attached service schedule.

**[PROPOSED]** You confirm that you are the property owner, the owner's authorized agent, the
tenant authorized to arrange cleaning, or the property manager authorized to bind the owner. If you
are arranging service for a property you do not own, you confirm that you have authority to grant
access and to approve the scope and charges.

**[PROPOSED]** A signed service schedule, written proposal, or written change order becomes part of
this agreement. If those documents conflict, the most specific signed document controls, then this
agreement, then the published Terms of Service.

**[EXISTING POLICY]** No employee or representative may orally waive a term unless the waiver is
confirmed in writing by an authorized owner.
`;

const scheduling = `## 3. Scheduling, arrival, and duration

**[EXISTING POLICY]** A submitted request or temporary hold is not a confirmed appointment. An
appointment is confirmed only when we confirm the scope, date and price with you, or when a
complete paid booking passes every server verification.

**[EXISTING POLICY]** The first appointment of the day may be scheduled for an exact arrival time.
Later appointments use an arrival window to account for travel and the honest duration of earlier
work. A requested time is a preference until confirmed.

**[EXISTING POLICY]** Published service hours are 7:00 a.m. to 7:00 p.m., seven days per week,
Central Time. Commercial and church work is scheduled within the same published hours unless a
written schedule says otherwise.

**[PROPOSED]** A home or facility takes as long as it honestly takes. We do not rush work to
protect a clock. If the agreed scope cannot be completed in the scheduled window, we will tell you
and agree on the next step before leaving.

**[PROPOSED]** You agree to provide accurate contact information for the day of service and to
respond to access questions within a reasonable time. Repeated unresponsiveness may require
rescheduling.
`;

const access = `## 4. Access, keys, alarms, and security

**[EXISTING POLICY]** We do not retain customer physical keys. Access uses an authorized temporary
method or a customer-controlled lockbox.

**[PROPOSED]** You will provide working entry instructions, gate or building codes, parking
information, alarm instructions, and any building requirements before the appointment. You are
responsible for making sure the information is current.

**[PROPOSED]** If an alarm is armed, you will either disarm it, provide a temporary code, or tell us
not to enter. We will not attempt to bypass a security system, force a door, or remain in a property
where we are not authorized to be.

**[PROPOSED]** If access is unavailable, if the authorized contact cannot be reached when presence
is required, or if access is withdrawn after we arrive, we will attempt to contact you and document
the visit. A disclosed and accepted failed-access fee may apply only as stated in the service
schedule; no automatic failed-access fee is currently collected by the website. **[OWNER DECISION]**

**[PROPOSED]** You will secure cash, jewelry, firearms, medications, financial documents, and other
valuables. You will tell us before work begins about fragile, antique, improperly secured, damaged,
or unusually delicate items and surfaces.
`;

const condition = `## 5. Condition, scope changes, and on-site reassessment

**[EXISTING POLICY]** The estimate depends on the accuracy of the information you provide,
including square footage, room counts, condition, buildup, pets, access, photos, and specialty
conditions. If the actual conditions differ materially, we may need to reassess before work begins.

**[EXISTING POLICY]** An on-site reassessment is a documented review, not a punishment and not
automatically a fee. After reassessment we may confirm the original scope and price; offer a revised
written quote for your approval; adjust the scope to fit the agreed amount; reschedule the work; or
decline unsafe, hazardous, or specialist work.

**[EXISTING POLICY]** We will not charge more than the amount you approved. If you decline a
necessary revised scope before work begins, either party may decline to proceed.

**[PROPOSED]** A change order may be recorded in writing (including email or text) before the
additional work is performed. If you authorize additional work orally during a visit, we will
confirm the added scope and price in writing as soon as practicable.

**[PROPOSED]** Photographs and notes taken during reassessment are handled under Section 6.
`;

const photos = `## 6. Photo documentation and privacy

**[EXISTING POLICY]** Photos you upload are private and are used only to prepare and confirm your
estimate and cleaning. They are never posted publicly. Please upload only the areas being cleaned —
no identification documents, screens, mail, or personal paperwork.

**[PROPOSED]** We may take before-and-after or condition photographs for quality control, dispute
resolution, and internal records. We will not publish identifiable photographs of your home or
belongings for marketing without your separate written permission.

**[PROPOSED]** Photographs are stored in private storage with access limited to authorized personnel
and are retained only as long as needed for the purposes above or as required by law. You may ask
us to delete non-essential photographs, subject to records we must keep for tax, insurance, or
dispute purposes.

**[PROPOSED]** You agree not to upload or provide unlawful content, and you confirm you have the
right to share any photograph you provide.
`;

function priceSection({ recurring = false, commercial = false, church = false, str = false }) {
  const lines = [
    `## 7. Price, payment timing, invoices, and nonpayment`,
    '',
    '**[EXISTING POLICY]** The online estimate is a proposed estimate, not a guaranteed final price.',
    'Final scope, condition, access, and unique circumstances can affect the confirmed price.',
    '',
  ];
  if (recurring) {
    lines.push(
      '**[EXISTING POLICY]** A new recurring residential arrangement is quoted as its required first',
      'visit (a Deep Cleaning) with the ongoing per-visit price shown separately. The ongoing price is',
      'not discounted by a first-visit promotion.',
      '',
    );
  }
  if (commercial) {
    lines.push(
      '**[EXISTING POLICY]** Commercial cleaning is invoiced monthly with Net 15 terms unless a',
      'written proposal says otherwise.',
      '',
    );
  } else if (church) {
    lines.push(
      '**[EXISTING POLICY]** Church cleaning follows the written walkthrough scope and is invoiced',
      'under the terms in that proposal. The 10% church discount applies only to eligible cleaning,',
      'never to travel, third-party costs, or taxes, and is not a donation or tithe.',
      '',
    );
  } else if (str) {
    lines.push(
      '**[EXISTING POLICY]** Short-term rental turnover is priced per turnover. Additional charges',
      'apply only when the agreed scope, linen arrangement, or turnover conditions change.',
      '',
    );
  } else {
    lines.push(
      '**[EXISTING POLICY]** Residential cleaning may be paid securely online through Stripe when',
      'Pay Now is offered, or upon completion when you choose a reservation without upfront payment.',
      'A complete paid booking confirms automatically only when payment, address, required photos,',
      'requested time, and resource availability all verify.',
      '',
    );
  }
  lines.push(
    '**[EXISTING POLICY]** Accepted methods include major credit and debit cards, Apple Pay, Google',
    'Pay, and ACH bank transfer, plus cash, check, Cash App, Venmo, Zelle, and PayPal where agreed in',
    'advance.',
    '',
    '**[OWNER DECISION]** No standard deposit, late fee, or interest charge is approved today. This',
    'draft does not invent one. If the owner later adopts a late or nonpayment charge, it must be',
    'disclosed in a written fee schedule, accepted before it applies, and reviewed by counsel for',
    'compliance with Florida and Alabama law.',
    '',
    '**[PROPOSED OPTION — NOT APPROVED]** If the owner adopts a nonpayment policy, the draft could',
    'provide that an undisputed invoice more than 15 days past due may suspend future service until',
    'paid, and that a disclosed late charge may apply only to the extent permitted by law. This is an',
    'option for discussion, not a term of this draft.',
    '',
    '**[PROPOSED]** If you believe a charge is wrong, contact us first so we can investigate. We will',
    'not retaliate against a customer for exercising a legitimate cardholder dispute right.',
    '',
    '**[PROPOSED]** Overpayments and duplicate payments are refunded or credited after verification.',
    'Do not send payment to an account or link that did not come from an authorized Sparkling',
    'Standard communication.',
    '',
    '**[PROPOSED]** Any saved-card or after-service charging requires a separate signed payment',
    'authorization. See the Payment Authorization and Saved Card Addendum. That capability is',
    '**[NOT ACTIVE]** in production until the owner authorizes it.',
    '',
  );
  return lines.join('\n');
}

const cancellation = `## 8. Cancellation, rescheduling, and failed access

**[EXISTING POLICY]** We ask for at least 24 hours' notice so the time can be offered to someone
else. To cancel or reschedule, contact us using the phone, text, email, or contact form listed on
this website and keep the confirmation we send.

**[EXISTING POLICY — STATUTORY RIGHT]** For a contract for future consumer services to be provided
on a continuing basis, Florida law gives you the right to cancel without penalty or obligation
within three business days after you enter the contract, and to a full refund of payments made. You
may also cancel if a doctor orders that you cannot physically receive the services, or if the
services cease to be offered as stated. If you cancel for either of those reasons, we may keep only
the pro rata portion of the price for services already used or completed, plus the cost of related
goods you consumed or retained. Refunds for a valid cancellation will be issued within 20 days after
we receive notice. This right is in addition to any other right you have.

**[EXISTING POLICY]** No standard cancellation fee currently applies. If the owner later approves a
cancellation or late-rescheduling fee, it will be disclosed in writing, in a clearly identified fee
schedule, before you accept it, and will be limited to a reasonable estimate of documented business
loss. It will not be enforced during the statutory three-business-day cancellation period.

**[EXISTING POLICY]** Repeated cancellations, repeated access failures, or abusive scheduling
behavior may lead to declining future bookings.

**[EXISTING POLICY]** If you cancel after we have already traveled to the property or begun setting
up, we may discuss reimbursement of documented, reasonable travel and preparation costs. No such
charge is automatically collected by this website. **[OWNER DECISION]**
`;

const satisfaction = `## 9. Satisfaction, complaints, and make-it-right

**[EXISTING POLICY — NEEDS OWNER RECONCILIATION]** The published Terms of Service contain two
different reporting windows for concerns: the satisfaction statement asks for a report within 24
hours, while the damage paragraph suggests reporting within seven days. This draft does not choose
between them. The owner must settle one clear rule before this agreement is used.

**[EXISTING POLICY]** If something within the agreed cleaning scope was missed, report it promptly.
We will review it and provide reasonable corrective cleaning at no additional charge for verified
missed work. This is not an unconditional refund promise, and it does not extend to unrelated work,
restoration, repair, or conditions outside the scope.

**[PROPOSED]** Please allow us a reasonable opportunity to inspect and correct the work before
arranging a third-party remedy. We will respond in writing where appropriate.

**[PROPOSED]** A complaint about damage is handled under Section 10. A complaint about the quality
of cleaning is handled under this section.
`;

const damage = `## 10. Damage, liability, and insurance

**[EXISTING POLICY]** We work carefully and treat every home with respect. You are responsible for
telling us about fragile, antique, improperly secured, damaged, or unusually delicate items and
surfaces before work begins, and for securing valuables.

**[EXISTING POLICY]** We are responsible for damage caused by our own negligent work within the
agreed scope. We are not responsible for pre-existing damage, ordinary wear, improperly installed
fixtures, damage caused by defective products you supplied, or conditions we could not reasonably
see or access. This is not a waiver of liability for our own negligence.

**[EXISTING POLICY]** If you believe we damaged something, tell us promptly and preserve the item
and any photographs. We will investigate, document the claim, and work toward a fair resolution.
Nothing in this agreement limits a right that cannot legally be limited.

**[OWNER DECISION / LEGAL REVIEW]** Verified insurance, bonding, and licensing details have not been
supplied to the website. This draft therefore makes no insurance, bonding, or licensing claim. If
the owner supplies verified coverage details, counsel should decide how they are disclosed and
whether any limitation of liability is lawful and appropriate.

**[PROPOSED]** Each party will cooperate in good faith with an insurance or damage investigation,
including providing photographs, receipts where available, and a written description of the loss.
`;

const safety = `## 11. Safety and declined work

**[EXISTING POLICY]** We do not perform biohazard remediation, sharps cleanup, crime-scene cleanup,
severe hoarding, mold remediation, fire restoration, hazardous chemical remediation, or unsafe
height work. We may stop work immediately if conditions are unsafe, threatening, infested,
structurally unsound, or outside the agreed scope.

**[EXISTING POLICY]** Please secure aggressive or uncontrolled animals before the visit. Pets are
welcome when they are safe and do not prevent the work from being done properly. Harassment,
threats, or unsafe conduct toward our team ends the appointment.

**[PROPOSED]** If work is stopped for safety reasons, we will document why and discuss the
reasonable next step. Charges for work actually performed before a safety stop remain payable.
`;

const esign = `## 13. Electronic records and signatures

**[PROPOSED — NOT ACTIVE]** Electronic signature is not enabled for customer agreements. The
current transactional acceptance is the website Terms checkbox, which remains the only active
acceptance in production.

**[PROPOSED]** If electronic signature is activated after legal review, the parties would agree to
use electronic records and signatures under the Florida Electronic Signature Act and the federal
E-SIGN Act, to receive disclosures electronically, and to the retention of an immutable signed copy
with version, timestamp, signer evidence, and document hash. A paper alternative would remain
available on request.

**[LEGAL REVIEW]** Counsel must approve the E-SIGN/UETA consent language, the paper-copy procedure,
the retention period, and the evidence package before any signature is collected.
`;

function lawSection({ commercial = false }) {
  return `## 14. Governing law and disputes

**[EXISTING POLICY]** Please contact us first so we have a chance to resolve the issue. We will
review the facts, respond in writing where appropriate, and try to reach a fair resolution.

**[PROPOSED]** This agreement is governed by Florida law. Any dispute that cannot be resolved may be
brought in a court of competent jurisdiction serving Escambia County, Florida, except where a
consumer protection law gives you a non-waivable right to another forum.${commercial ? ' For a commercial client with a principal place of business in Alabama, the parties may agree in the signed proposal that Alabama law and an Alabama forum apply to the commercial relationship.' : ''}

**[EXISTING POLICY]** These terms do not create an arbitration agreement, a class-action waiver, or
a waiver of any right that cannot lawfully be waived. No provision should be read as a penalty or as
an attempt to collect an undisclosed charge.
`;
}

const notices = `## 15. Notices and contact

**[PROPOSED]** Written notices to us may be sent to ${CONTACT_EMAIL} or by text or call to
${CONTACT_PHONE}. Written notices to you may be sent to the email address or mobile number you
provided, or by mail to the service property if no other address is given.

**[PROPOSED]** You agree to tell us promptly if your contact information changes. A notice sent to
the last contact information you provided is effective unless you have told us it is no longer
valid.
`;

function signatureBlock({ title, extra = [] }) {
  return `## 16. Signatures

**[PROPOSED — NOT ACTIVE]** This signature block is a draft layout only. Do not use it until the
owner approves the agreement and electronic or paper signing is authorized.

**Customer**

Name: ______________________________

Title (if signing for a company, church, or property owner): ______________________________

Signature: ______________________________   Date: __________________

Service address: ______________________________________________________________

Email: ______________________________   Phone: ______________________________

${extra.map((line) => `${line}\n`).join('\n')}
**${BUSINESS}**

Name: ______________________________

Title: ______________________________

Signature: ______________________________   Date: __________________

---

_Document: ${title} · Draft ${VERSION} · Prepared ${TODAY} · Not in effect_
`;
}

const scopeHeading = `## 2. Service scope

**[PROPOSED]** The scope below is the agreed baseline. Anything marked optional is performed only
if selected in writing and priced. Anything marked custom quote requires a separate written quote.
Anything marked excluded is not performed under this agreement.

**[EXISTING POLICY]** "Do not promise removal of every stain" applies to all detail work; finishes
come first.

`;

const exclusions = `### Excluded everywhere

Post-construction cleaning; biohazards or human waste; severe animal waste; needles or sharps; crime
scenes; severe hoarding; mold remediation; serious infestations including bedbugs; hazardous
chemical remediation; fire restoration; unsafe height or ladder work; and any work requiring
specialist certification, equipment, or insurance the company does not hold.

**[PROPOSED]** If a condition requiring specialist work is discovered, we will stop and tell you.
We will not attempt work outside our competence or insurance.
`;

const services = [
  {
    id: '01',
    file: '01_RESIDENTIAL_ONE_TIME_CLEANING_AGREEMENT_DRAFT',
    title: 'Residential One-Time Cleaning Agreement',
    subtitle: 'Standard residential cleaning for a single visit',
    scope: `### Included in a standard residential clean

Counters and sinks; appliance exteriors; bathrooms (sinks, toilets, tubs, showers, mirrors);
dusting of reachable surfaces; floors vacuumed and mopped including edges; beds made and rooms
tidied; light switches and door handles; trash emptied and liners replaced.

### Optional (priced only when selected)

Inside cabinets, drawers, or closets; inside refrigerator or oven; interior windows; exterior
ground-reachable windows; laundry (one load); bed linen change; dishes; general organization;
pet-hair intensive work.

### Custom quote only

Carpet cleaning; upholstery cleaning; pressure washing, garage, or patio work.

### Not included in a standard clean

Hand-wiped baseboards (dusting only), full door and frame detailing, wall spot-cleaning, blinds and
sills, and any restoration or repair.

${exclusions}`,
    price: () => priceSection({}),
    term: `## 12. Term

**[PROPOSED]** This agreement covers one cleaning visit on the date confirmed in the service
schedule. It ends when that visit is completed and paid, unless the parties sign a new schedule.
`,
    extra: [],
  },
  {
    id: '02',
    file: '02_RECURRING_RESIDENTIAL_CLEANING_AGREEMENT_DRAFT',
    title: 'Recurring Residential Cleaning Agreement',
    subtitle: 'Ongoing residential maintenance after a required initial Deep Cleaning',
    scope: `### Required first visit

**[EXISTING POLICY]** A new recurring residential maintenance arrangement requires a Deep Cleaning
before maintenance service begins. There are no exceptions. The initial Deep Cleaning is scoped and
priced separately; recurring visits begin after it is complete.

### Included in each recurring maintenance visit

Counters and sinks; appliance exteriors; bathrooms; dusting of reachable surfaces; floors vacuumed
and mopped including edges; beds made and rooms tidied; light switches and door handles; trash
emptied and liners replaced.

### Optional (priced only when selected)

Inside cabinets, drawers, or closets; inside refrigerator or oven; interior windows; exterior
ground-reachable windows; laundry (one load); bed linen change; dishes; general organization;
pet-hair intensive work.

### Custom quote only

Carpet cleaning; upholstery cleaning; pressure washing, garage, or patio work.

### Not included in a maintenance visit

Baseboards are dusted only; full door and frame detailing, wall spot-cleaning, blinds and sills,
and restoration or repair are not included.

${exclusions}`,
    price: () => priceSection({ recurring: true }),
    term: `## 12. Term, frequency, pause, and termination

**[EXISTING POLICY]** Recurring frequency, scope, and pricing may be adjusted when the condition of
the home, the scope, or the number of visits changes. We will discuss a change with you before it
takes effect.

**[EXISTING POLICY]** Skipped or paused visits do not automatically create a credit, and recurring
service is not an automatic-renewal card charge. Payment authorization is handled separately and
only as disclosed.

**[PROPOSED]** Either party may end the recurring arrangement with the notice stated in the
confirmed plan or, where no period is stated, with reasonable written notice. Amounts owed for
completed visits remain payable.

**[PROPOSED]** If the home's condition materially degrades, we may recommend a new Deep Cleaning
before maintenance continues. This is a scope recommendation, not an automatic charge.
`,
    extra: ['Recurring frequency (weekly / every two weeks / monthly): ______________________\n'],
  },
  {
    id: '03',
    file: '03_DEEP_CLEANING_AGREEMENT_DRAFT',
    title: 'Deep Cleaning Agreement',
    subtitle: 'Detailed top-to-bottom cleaning for a single visit',
    scope: `### Included in a Deep Cleaning

Everything in a standard residential clean, plus hand-wiped baseboards; doors, frames, and jamb
detail; finish-safe wall spot-cleaning; blinds and sills; inside cabinets, drawers, and closets;
inside refrigerator and oven; and interior reachable windows.

### Optional (priced only when selected)

Exterior ground-reachable windows; laundry (one load); bed linen change; dishes; general
organization; pet-hair intensive work.

### Custom quote only

Carpet cleaning; upholstery cleaning; pressure washing, garage, or patio work.

### Not included

Restoration, repair, stain removal guarantees, and any work listed as excluded below.

${exclusions}`,
    price: () => priceSection({}),
    term: `## 12. Term

**[PROPOSED]** This agreement covers one Deep Cleaning visit on the date confirmed in the service
schedule. It ends when that visit is completed and paid.
`,
    extra: [],
  },
  {
    id: '04',
    file: '04_MOVE_IN_MOVE_OUT_CLEANING_AGREEMENT_DRAFT',
    title: 'Move-In / Move-Out Cleaning Agreement',
    subtitle: 'Vacant or soon-to-be-vacant property cleaning',
    scope: `### Included

Everything in a Deep Cleaning, plus inside cabinets, drawers, and closets; inside refrigerator and
oven; and interior reachable windows.

### Optional (priced only when selected)

Exterior ground-reachable windows; laundry (one load); bed linen change; dishes; general
organization; pet-hair intensive work.

### Custom quote only

Carpet cleaning; upholstery cleaning; pressure washing, garage, or patio work.

### Property condition

**[PROPOSED]** The property must be vacant or made accessible as agreed. Personal belongings,
furniture, and construction debris must be removed before the visit unless the written schedule says
otherwise. A property that is not emptied as agreed may require a revised scope and price.

${exclusions}`,
    price: () => priceSection({}),
    term: `## 12. Term

**[PROPOSED]** This agreement covers the move-in or move-out cleaning on the date confirmed in the
service schedule. A real-estate closing deadline does not create a guarantee until the date, access,
and scope are confirmed in writing.
`,
    extra: ['Property will be vacant at service start:  ☐ Yes   ☐ No — agreed exception: ______________________\n'],
  },
  {
    id: '05',
    file: '05_SHORT_TERM_RENTAL_TURNOVER_AGREEMENT_DRAFT',
    title: 'Short-Term Rental Turnover Agreement',
    subtitle: 'Per-turnover cleaning for Airbnb, VRBO, and similar short-term rentals',
    scope: `### Included in each turnover

Counters and sinks; appliance exteriors; bathrooms; dusting of reachable surfaces; floors vacuumed
and mopped including edges; bed reset; light switches and door handles; trash emptied and liners
replaced; sills; laundry processed on site; bed linen change; consumable check and report; and a
completion checklist.

### Optional (priced only when selected)

Inside cabinets, drawers, or closets; dishes; turnover photographs when requested.

### Custom quote only

Carpet cleaning; upholstery cleaning; pressure washing, garage, or patio work; restocking
arrangements (separate agreement).

### Not included

Inside refrigerator or oven cleaning (check only), interior or exterior windows, and organization.

### Turnover specifics

**[PROPOSED]** You will provide the checkout and check-in times, the linen and laundry arrangement,
the consumable standard, and the property access method for each turnover. Changes to those details
may change the per-turnover price.

**[PROPOSED]** We are not responsible for guest damage, missing inventory, or guest-caused
conditions beyond the agreed turnover scope. We will report conditions we observe.

${exclusions}`,
    price: () => priceSection({ str: true }),
    term: `## 12. Term and turnover scheduling

**[PROPOSED]** This agreement covers the turnovers listed in the attached schedule. Either party
may end the arrangement with reasonable written notice. Turnovers already confirmed remain payable.

**[PROPOSED]** A same-day turnover requires a confirmed checkout time and reasonable access. Late
guest checkout or an unavailable unit may require rescheduling or a revised price.
`,
    extra: ['Typical checkout time: __________   Typical check-in time: __________\n'],
  },
  {
    id: '06',
    file: '06_COMMERCIAL_CLEANING_AGREEMENT_DRAFT',
    title: 'Commercial Cleaning Agreement',
    subtitle: 'Facility cleaning defined by a written walkthrough scope',
    scope: `### Scope is written per facility

**[EXISTING POLICY]** Commercial scopes are written per facility from a walkthrough. The baseline
vocabulary below is not a substitute for seeing the space.

### Baseline vocabulary

Counters, sinks, and appliance exteriors per scope; restrooms; dusting of reachable surfaces;
floors; high-touch surfaces per scope; trash and liners; baseboards, doors, frames, and wall
spot-cleaning only where the written scope says so; interior windows and blinds only where the
written scope says so; consumables and restocking only under a separate written arrangement.

### Custom quote only

Carpet cleaning; upholstery cleaning; pressure washing, garage, or exterior work; post-construction
or specialist work.

${exclusions}`,
    price: () => priceSection({ commercial: true }),
    term: `## 12. Term, schedule, and termination

**[PROPOSED]** The initial term, service frequency, access window, and renewal or termination
notice are stated in the signed commercial proposal. If no term is stated, either party may end the
arrangement with 30 days' written notice.

**[PROPOSED]** Additional work, one-time projects, and scope changes require written authorization
before work begins.

**[PROPOSED]** Either party may suspend service for a documented safety issue, nonpayment, or a
material breach after written notice and a reasonable opportunity to cure.
`,
    extra: [
      'Facility name: ______________________________\n',
      'Service frequency and access window: ______________________________\n',
      'Purchase order / reference (if required): ______________________________\n',
    ],
  },
  {
    id: '07',
    file: '07_CHURCH_CLEANING_AGREEMENT_DRAFT',
    title: 'Church Cleaning Agreement',
    subtitle: 'Facility cleaning for churches, with the owner-approved 10% church discount',
    scope: `### Scope is written per facility

**[EXISTING POLICY]** Church scopes are written per facility from a walkthrough. Sanctuary,
classrooms, restrooms, fellowship areas, offices, and high-touch surfaces are included only as the
written scope states.

### Custom quote only

Carpet cleaning; upholstery cleaning; pressure washing, exterior work, and specialist restoration.

### Discount

**[EXISTING POLICY]** A 10% discount applies to eligible church cleaning under terms
2026-10-24.church10.v1. It applies after the minimum-job rule, is never stacked with another
discount or promotion, and does not apply to travel, third-party costs, or taxes. It is not a
donation or tithe. Tier C or custom work shows the entitlement and the owner confirms it personally.

${exclusions}`,
    price: () => priceSection({ church: true }),
    term: `## 12. Term, schedule, and termination

**[PROPOSED]** The initial term, service frequency, access window, and termination notice are stated
in the signed church proposal. If no term is stated, either party may end the arrangement with 30
days' written notice.

**[PROPOSED]** Volunteer and staff access, alarm procedures, event schedules, and off-limits areas
must be documented before the first visit. Additional event cleanup requires written authorization.
`,
    extra: [
      'Church / facility name: ______________________________\n',
      'Church discount eligibility confirmed:  ☐ Yes   ☐ No\n',
    ],
  },
];

function renderService(service) {
  return [
    header(service.title, service.subtitle),
    parties,
    scopeHeading + service.scope,
    scheduling,
    access,
    condition,
    photos,
    service.price(),
    cancellation,
    satisfaction,
    damage,
    safety,
    service.term,
    esign,
    lawSection({ commercial: service.id === '06' }),
    notices,
    signatureBlock({ title: service.title, extra: service.extra }),
  ].join('\n');
}

const readme = `${header('Customer Agreement Review Package', 'What this package is and how to review it')}

## What you are holding

This folder contains proposed customer agreement drafts for **${BUSINESS}**. They were prepared
because the owner asked, repeatedly, for the actual agreement language — not a status note.

Nothing in this folder is in effect. The public website continues to rely on the published Terms of
Service (${TERMS_VERSION}) and the transactional terms checkbox. No agreement here has been
approved by an attorney, activated in software, or shown to a customer.

## The documents

| File | Purpose |
| --- | --- |
| \`COMBINED_CUSTOMER_AGREEMENTS_REVIEW_DRAFT\` | Every service draft in one continuous document |
| \`01_RESIDENTIAL_ONE_TIME_CLEANING_AGREEMENT_DRAFT\` | Standard one-visit residential cleaning |
| \`02_RECURRING_RESIDENTIAL_CLEANING_AGREEMENT_DRAFT\` | Recurring maintenance, including the required first Deep Cleaning |
| \`03_DEEP_CLEANING_AGREEMENT_DRAFT\` | Detailed top-to-bottom cleaning |
| \`04_MOVE_IN_MOVE_OUT_CLEANING_AGREEMENT_DRAFT\` | Vacant-property cleaning |
| \`05_SHORT_TERM_RENTAL_TURNOVER_AGREEMENT_DRAFT\` | Per-turnover STR cleaning |
| \`06_COMMERCIAL_CLEANING_AGREEMENT_DRAFT\` | Facility cleaning from a walkthrough |
| \`07_CHURCH_CLEANING_AGREEMENT_DRAFT\` | Church cleaning with the 10% discount terms |
| \`08_PAYMENT_AUTHORIZATION_AND_SAVED_CARD_ADDENDUM_DRAFT\` | Separate saved-card and after-service authorization |
| \`09_ELECTRONIC_SIGNATURE_AND_RECORDS_ADDENDUM_DRAFT\` | E-SIGN consent and record retention |
| \`10_OWNER_REVIEW_CHECKLIST\` | The decisions only the owner can make |

Each document is supplied as Markdown (the editable source), HTML (opens in any browser), and PDF
(print or email). The Markdown is the source of truth for edits.

## How the labels work

- **[EXISTING POLICY]** — current published or configured policy; already true today.
- **[PROPOSED]** — new contract wording offered for approval.
- **[OWNER DECISION]** — a business choice reserved to the owner.
- **[LEGAL REVIEW]** — wording that counsel must settle.
- **[NOT ACTIVE]** — software exists but is switched off.

## The most important thing

Do not activate, publish, or sign these documents yet. The activation gates in
\`src/config/agreements.ts\` deliberately fail closed while any document is a draft. Owner approval
and a qualified Florida attorney's review are required first. Alabama counsel should review the
commercial and cross-state terms where applicable.

## Where the language comes from

- The published Terms of Service (${TERMS_VERSION}) and Pricing configuration.
- The internal Service Scope Matrix and the four estimator engines.
- The reservation, cancellation, satisfaction, and financial workflow documentation.
- The existing agreement catalog and its status flags.
- Owner-approved discount terms (Community Support, church 10%, add-on bundles).

No late fee, penalty, guarantee, insurance claim, or broad liability waiver has been invented.
Where such a term would normally appear, the draft says so and leaves the decision to the owner.
`;

const paymentAddendum = `${header('Payment Authorization and Saved Card Addendum', 'Separate authorization for cards on file and after-service charging')}

This addendum would be signed separately from the cleaning agreement. It does not authorize any
charge by itself. It is **[NOT ACTIVE]**: production off-session charging and saved-card setup are
disabled behind server-enforced gates until the owner authorizes them and the sandbox verification
passes.

## A1. Scope of authorization

**[PROPOSED]** You may authorize ${BUSINESS} to save a payment method and to charge it for cleaning
services described in a specific invoice or service schedule. The authorization states:

- the customer and property it covers;
- the service or invoice it covers;
- the maximum amount that may be charged;
- whether a single charge or after-service charging is authorized;
- the expiry date of the authorization.

**[PROPOSED]** A charge must never exceed the signed maximum, must match the covered property and
customer, and must be supported by an invoice or agreed service record.

## A2. How a saved card is created

**[PROPOSED]** The card is entered directly with our payment processor, Stripe. We do not receive
or store the full card number. Stripe returns a token or payment-method reference that we store with
the authorization record.

## A3. After-service charging

**[PROPOSED]** If you authorize after-service charging, you agree that the final invoice amount may
be charged after the service is completed, up to the signed maximum. You will receive the invoice
and a receipt. If the invoice exceeds the maximum, we will contact you for a new authorization.

## A4. Declined, expired, or revoked authorization

**[PROPOSED]** An authorization is invalid if it is expired, revoked, used, or does not match the
customer, property, service, or amount. We will not charge on an invalid authorization. If a card
declines or requires customer authentication, we will contact you and will not retry
indefinitely.

## A5. Revocation

**[PROPOSED]** You may revoke an authorization at any time in writing. Revocation does not affect a
charge already processed for completed work. We will mark the authorization revoked and stop future
charges.

## A6. Records

**[PROPOSED]** We retain the signed authorization, its version, timestamp, and the related invoice
and receipt records. We do not store full card numbers or security codes.

## A7. Current status

**[EXISTING SYSTEM BEHAVIOR]** The administrative saved-card and off-session charging features are
gated by server environment flags and are disabled until the owner enables them. The public Pay Now
checkout is separate and remains operational.

${signatureBlock({
  title: 'Payment Authorization and Saved Card Addendum',
  extra: [
    'Maximum authorized amount (USD): $__________________\n',
    'Authorization applies to:  ☐ One invoice   ☐ After-service charging (within the maximum)\n',
    'Authorization expiry date: __________________\n',
  ],
})}`;

const esignAddendum = `${header('Electronic Signature and Records Addendum', 'Consent, delivery, and retention if electronic signing is activated')}

**[NOT ACTIVE]** Electronic signature is not enabled. This addendum is proposed language for the
future activation described in the agreement catalog.

## B1. Consent to electronic records

**[PROPOSED]** The parties agree to use electronic records and signatures for this agreement and
related notices, under the Florida Electronic Signature Act and the federal E-SIGN Act. Consent
covers the agreement, change orders, invoices, receipts, and service records delivered
electronically.

## B2. Hardware and software

**[PROPOSED]** You confirm you can access and retain electronic records through a current browser or
email client. You may request a paper copy at no charge.

## B3. How signatures are captured

**[PROPOSED]** A signature may be a typed name, a drawn signature, or an authenticated acceptance
recorded by the signing service. Each signature records the signer's name, email, timestamp,
document version, and document hash.

## B4. Copies and retention

**[PROPOSED]** Each signer receives a copy of the completed document. We retain the signed document
and its evidence package for the period required by law and our records policy.

## B5. Withdrawing consent

**[PROPOSED]** You may withdraw consent to future electronic records in writing. Withdrawal does not
affect the validity of records already signed or delivered.

## B6. Legal review gate

**[LEGAL REVIEW]** Counsel must approve this consent, the paper-copy procedure, the evidence
package, and the retention period before activation.

${signatureBlock({ title: 'Electronic Signature and Records Addendum' })}`;

const checklist = `${header('Owner Review Checklist', 'The decisions required before any agreement can be used')}

This is the shortest path to a usable, defensible agreement set. Each item states the decision and
the consequence of leaving it open.

## Blocking decisions

| # | Decision | Why it blocks | Suggested owner input |
| --- | --- | --- | --- |
| 1 | Confirm the contracting entity and notice address | The drafts name ${BUSINESS}; a notice address is not yet supplied | Approve entity and provide a business mailing address |
| 2 | Resolve the satisfaction window conflict (24 hours vs 7 days) | The published Terms contain both; an agreement cannot leave it ambiguous | Choose one window |
| 3 | Adopt or reject a cancellation / late-reschedule fee | No fee is approved today; the draft invents none | "No fee" or provide the exact schedule and amount |
| 4 | Adopt or reject a late-payment charge or service suspension | The draft offers an option, not a term | "None" or exact wording and rate |
| 5 | Confirm the damage-reporting window and process | The Terms suggest seven days; the draft follows the Terms | Confirm the window |
| 6 | Supply verified insurance, bonding, and licensing details | The site and drafts make no such claims today | Provide verified details or confirm the omission |
| 7 | Approve commercial invoice terms (Net 15) and any deposit | Net 15 is published; a deposit is not | Confirm Net 15 and whether a deposit applies |
| 8 | Confirm STR linen, consumables, and restocking responsibility | The turnover price depends on it | State what is included |
| 9 | Confirm the church discount eligibility wording | The 10% discount has owner terms already | Confirm or correct the wording |
| 10 | Approve photo documentation and retention | The drafts add quality-control photos | Approve or limit |
| 11 | Approve the saved-card authorization maximum and revocation process | Off-session charging is disabled | Approve the model; do not enable charging yet |
| 12 | Approve the E-SIGN consent and paper alternative | Electronic signing is disabled | Approve for legal review |

## Legal review

- Florida counsel: consumer cancellation, payment, liability, damage, E-SIGN, and privacy language.
- Alabama counsel: commercial and church work performed in Alabama, if applicable.
- Confirm that no clause is an unlawful penalty or an unenforceable waiver.
- Confirm the refund and cancellation language matches Florida law for continuing services.

## Activation rules

1. The owner approves the final wording in writing.
2. Counsel completes review.
3. Approved templates are stored in private storage, not in the public repository.
4. The signing workflow is tested, including retention and retrieval.
5. Only then may \`agreementConfig.enabled\` and \`electronicSignatureEnabled\` be changed.

## What must not happen

- Do not publish a draft as a binding agreement.
- Do not collect a signature on an unapproved draft.
- Do not add a late fee, penalty, guarantee, or liability waiver that the owner has not approved.
- Do not claim insurance, bonding, or licensing that has not been verified.
`;

function buildCombined() {
  const parts = [readme, '\n\n---\n\n# Part II — Service agreement drafts\n'];
  for (const service of services) {
    parts.push('\n\n---\n\n');
    parts.push(renderService(service));
  }
  parts.push('\n\n---\n\n');
  parts.push(paymentAddendum);
  parts.push('\n\n---\n\n');
  parts.push(esignAddendum);
  parts.push('\n\n---\n\n');
  parts.push(checklist);
  return parts.join('\n');
}

// ── Minimal Markdown renderer (headings, lists, tables, quotes, emphasis) ───

fs.mkdirSync(OUT, { recursive: true });
const documents = [
  { file: '00_READ_ME_FIRST', title: 'Customer Agreement Review Package', markdown: readme },
  ...services.map((service) => ({
    file: service.file,
    title: service.title,
    markdown: renderService(service),
  })),
  {
    file: '08_PAYMENT_AUTHORIZATION_AND_SAVED_CARD_ADDENDUM_DRAFT',
    title: 'Payment Authorization and Saved Card Addendum',
    markdown: paymentAddendum,
  },
  {
    file: '09_ELECTRONIC_SIGNATURE_AND_RECORDS_ADDENDUM_DRAFT',
    title: 'Electronic Signature and Records Addendum',
    markdown: esignAddendum,
  },
  { file: '10_OWNER_REVIEW_CHECKLIST', title: 'Owner Review Checklist', markdown: checklist },
  {
    file: 'COMBINED_CUSTOMER_AGREEMENTS_REVIEW_DRAFT',
    title: 'Customer Agreements — Combined Review Draft',
    markdown: buildCombined(),
  },
];

for (const document of documents) {
  fs.writeFileSync(path.join(OUT, `${document.file}.md`), document.markdown, 'utf8');
  fs.writeFileSync(path.join(OUT, `${document.file}.html`), htmlDocument(document.title, document.markdown), 'utf8');
}
console.log(`Wrote ${documents.length} Markdown and HTML documents to ${OUT}`);

if (producePdf) {
  const { chromium } = await import('playwright');
  let browser;
  try {
    browser = await chromium.launch();
    const page = await browser.newPage();
    for (const document of documents) {
      await page.goto(pathToFileURL(path.join(OUT, `${document.file}.html`)).href, {
        waitUntil: 'load',
      });
      await page.pdf({
        path: path.join(OUT, `${document.file}.pdf`),
        format: 'Letter',
        printBackground: true,
        margin: { top: '0.75in', bottom: '0.75in', left: '0.75in', right: '0.75in' },
        displayHeaderFooter: true,
        headerTemplate: '<div></div>',
        footerTemplate:
          '<div style="width:100%;font-size:8px;color:#8a7a72;text-align:center;font-family:Georgia,serif">' +
          'DRAFT — NOT IN EFFECT · Sparkling Standard LLC · page <span class="pageNumber"></span> of <span class="totalPages"></span>' +
          '</div>',
      });
      console.log(`PDF: ${document.file}.pdf`);
    }
  } finally {
    await browser?.close();
  }
}
console.log('Done.');
