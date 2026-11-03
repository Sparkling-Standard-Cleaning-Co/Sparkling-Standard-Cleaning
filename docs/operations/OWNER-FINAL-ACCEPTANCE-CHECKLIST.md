# Owner final acceptance checklist

Use this against the live admin at `/admin/`. It covers the capabilities that are
currently deployed. Items marked **not yet available** must not be treated as
working until their remediation is released.

## 1. Sign in

- [ ] Sign in with the owner account through `/admin/`.
- [ ] Confirm the correct name, role and owner sections appear.
- [ ] Confirm the browser session signs out when expected.

## 2. Customers and properties

- [ ] Create a customer and enter the first property.
- [ ] Confirm the property shows label, address, type, square footage, bedrooms,
      full/half bathrooms, stories, STR beds, pets, access, parking and internal notes.
- [ ] Add a second property and confirm it does not create a duplicate customer.
- [ ] Edit one property and confirm the other property is unchanged.
- [ ] Confirm the first/explicit primary property is marked Primary.
- [ ] Open an existing customer from before this release and confirm its original
      address and history still load.

## 3. Pricing & Estimator Control

- [ ] Open the Pricing & Estimator Control tab.
- [ ] Confirm every accordion starts closed and opens independently.
- [ ] Save a test draft and confirm its values remain in the draft after saving.
- [ ] Run the simulator and confirm published vs draft totals and labor differ only
      when edited values differ.
- [ ] Discard the test draft. Do not publish a real price change unless intended.
- [ ] Confirm the public estimator still quotes the published/source price.

## 4. Public estimates and requests

- [ ] Submit a test residential estimate request (use a clearly labeled test name).
- [ ] Confirm the request reaches the admin Calendar/Requests list.
- [ ] Confirm the owner notification arrives.
- [ ] Do not use a real customer or real payment for this test.

## 5. Payments

- [ ] Confirm `/api/estimate-checkout` reports enabled/live mode.
- [ ] Confirm no customer is charged until an authorized test-mode/live test is approved.
- [ ] For a real customer, review the Stripe payment and D1 invoice/payment records
      together before marking anything paid.

## 6. Documents

- [ ] Upload/approve final owner legal templates before activating them.
- [ ] Send a signing request to a test customer and complete the signing flow.
- [ ] Confirm an unsigned required agreement blocks confirmation.
- [ ] If a payment happens before signing, confirm the customer receives the signing
      link and the booking remains pending owner review.

## 7. Recurring plans

- [ ] Create a recurring plan for a test customer with an assigned crew.
- [ ] Confirm it appears in the recurring list and operational schedule.
- [ ] Pause, resume and cancel the test plan.
- [ ] Confirm a cancelled occurrence is not recreated by the daily Worker.
- [ ] Occurrence-level rescheduling and full Worker recovery are **not yet available**.

## 8. Employees

- [ ] Invite a test employee and complete account activation.
- [ ] Confirm only assigned jobs are visible.
- [ ] Clock in/out and record a break.
- [ ] Confirm the timecard appears for owner approval.
- [ ] Do not grant real production access until the test is complete.

## 9. Gifts and invoices

- [ ] Confirm an existing gift certificate shows the correct remaining balance.
- [ ] Apply a gift to a test invoice and confirm the balance.
- [ ] A gift-only cleaning booking lifecycle is **not yet available**.

## 10. Manual estimates and one-time bookings

**Not yet available.** The admin does not yet have the full manual estimate and
one-time booking creator. Continue using the public estimate request flow and
Calendar/Requests confirmation until that feature is released.

## 11. Failure and recovery checks

- [ ] Confirm failed payments or pending owner-review items are visibly listed.
- [ ] Confirm a calendar failure does not silently mark a booking confirmed.
- [ ] Confirm a paid booking with outstanding documents remains pending with a
      signing link.
- [ ] Monitoring dashboards, automated alerting and independent off-site backup
      verification are **not yet complete**.

## 12. Owner-only actions still required

1. Enroll owner MFA and store recovery codes offline.
2. Approve final legal agreement wording and activate approved templates.
3. Approve any Stripe test-mode or supervised live-payment test.
4. Choose an independent encrypted off-site backup destination.
5. Review the remaining audit tracker with the developer before treating the
   system as fully complete.
