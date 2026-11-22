# Service Packet Matrix — 2026-11-22

**Status:** 27 active documents are owner-approved as exact versions (2026-11-22).
**Zero imported into production D1. Zero active production signing packets.**
Staging import and packet verification are complete; production activation
remains owner-gated.

## Core packet for every customer service

| Document | ID | Status |
|---|---|---|
| Core Cleaning Service Terms | LEG-AB060020 | Owner review draft |
| Residential Access Authorization (or commercial key custody) | LEG-A636DDB4 / SS-CUST-COM-KEY-2026-11 | Owner review draft |
| Cancellation and Rescheduling Terms | LEG-89D28996 | Owner review draft |
| Electronic Signature and Records Addendum | LEG-0E4847B5 | Owner review draft |
| Additional Service and Add-On Authorization | LEG-75D90DBB | Owner review draft |
| Customer Photo and Marketing Consent (optional) | LEG-6467D94C | Owner review draft |

## Service packets

| Service | Required service documents | Optional / conditional | Ready for owner approval |
|---|---|---|---|
| Residential Deep / one-time | Core packet; Residential Deep Cleaning Agreement (LEG-4A9FC934); Deep Cleaning Scope and Terms (LEG-633AE35B) | Photo consent; saved-method authorization if after-service charging is activated | Yes — all documents drafted |
| Residential Recurring | Core packet; Residential Recurring Cleaning Agreement (LEG-8EFF2E52); Residential Deep Cleaning Agreement and Deep Scope for the mandatory initial Deep Cleaning | Recurring Payment Authorization (LEG-F99EEE42) only if recurring autopay is activated; photo consent | Yes — all documents drafted |
| Move-In / Move-Out | Core packet; Move-In / Move-Out Cleaning Agreement (LEG-6C749FA3) | Photo consent; add-on authorization | Yes — all documents drafted |
| Short-Term Rental | Core packet; Vacation Rental / STR Turnover Agreement (LEG-B329F61E) | Photo consent; add-on authorization; linen/laundry and inventory schedule | Yes — all documents drafted |
| Commercial | Core packet; Commercial Cleaning Service Agreement (LEG-D25F29B4); Commercial Key Custody and Access Authorization (SS-CUST-COM-KEY-2026-11) when keys, fobs, badges or access cards are held | Photo consent; add-on authorization | Yes — all documents drafted |
| Church / Institutional | Core packet; Church and Facility Cleaning Agreement (LEG-9F30E030); 10% church discount in the signed schedule | Special-event schedule; commercial key custody when keys are held | Yes — all documents drafted |
| Property Manager / Real Estate | Core packet; Property Manager / Real Estate Master Service Agreement (LEG-PM-2026-11); property-specific schedule identifying authorized agent, responsible payer and access method | Commercial key custody for key-holding properties; photo consent; add-on authorization | Yes — owner review candidate |
| Specialty / Add-Ons | Base service packet; Additional Service and Add-On Authorization (LEG-75D90DBB) | Service-specific schedule and written change authorization | Yes — all documents drafted |

## Employee onboarding packet

| Document | ID | Status |
|---|---|---|
| Employee Handbook | LEG-2E96A176 | Owner review draft |
| Employee Confidentiality and Client Privacy Agreement | LEG-37752488 | Owner review draft |
| Employee Timekeeping and Location Acknowledgment | LEG-03B75BAA | Owner review draft |
| Employee Information and Emergency Contact Form | LEG-4E42F45A | Owner review draft — prior abbreviated version rejected; rebuilt |
| Payroll Direct Deposit Authorization | LEG-1D7849C8 | Owner review draft — prior abbreviated version rejected; rebuilt |
| Workplace Conduct and Professional Standards Policy | SS-EMP-CONDUCT-2026-11 | Owner review draft |
| Employee Customer and Employee Nonsolicitation Agreement | SS-EMP-NONSOLICIT-2026-11 | Owner review draft |
| Role-Specific Employee Noncompetition Agreement | SS-EMP-NONCOMPETE-2026-11 | Optional; role schedule required |
| Employee Property, Key, Credential and Access Return Agreement | SS-EMP-RETURN-2026-11 | Owner review draft |
| Form I-9 Onboarding Procedure | SS-EMP-I9-2026-11 | Owner review draft; official Form I-9 edition 01/20/25 remains a separate paper/manual process |

## Packet rules

1. **Precedence:** Core Terms → service-specific agreement → signed service
   schedule → signed add-on or payment authorization.
2. **No unresolved variables:** a packet must fail closed if any supported
   variable is empty. Customer, property, price, tax, discount, date, arrival
   window and payment terms must come from the verified request and signed
   schedule.
3. **No unnecessary documents:** optional photo consent, recurring autopay and
   saved-method authorization are included only when the service and customer
   election require them. Role-specific noncompetition is offered only where a
   completed role schedule supports it.
4. **Keys:** residential physical house keys are never retained. Commercial
   keys, fobs, badges and access cards require the separate custody
   authorization.
5. **Payment authorizations:** recurring autopay and saved-method after-service
   charging remain inactive until the owner activates them. No automatic
   stored-card charge may be used for a cancellation or failed-access fee.
6. **I-9:** the ordinary signing portal is not a DHS-compliant electronic I-9
   system. Use the official paper/PDF process.
7. **Retention:** the executed combined PDF, exact document version, content
   SHA-256, signer, consent version, timestamp and execution evidence are
   retained privately and made available to the signer.

## Production import readiness

| Gate | State |
|---|---|
| 27 active documents complete | Yes |
| Owner exact-version approval | **Not yet recorded** |
| Approved-only manifest export | Available from the Legal Registry after decisions |
| Template import into D1 | **Not performed** |
| Packet/bundle activation | **Not performed** |
| Signing link issuance | **Not performed for any real customer** |
| Live Stripe charge | **Not performed** |

The production sequence is:

**Estimate → temporary hold → complete agreement → electronic signature →
verified payment → confirmed booking.**

No step may skip the exact approved document version, hash verification,
unresolved-variable check, signature record or payment verification.
