# Admin Operations Console — owner manual

**For:** the owner and any invited manager, finance user, or cleaner
**Console:** <https://sparkling-standard.com/admin/>
**Last verified against production:** 2026-10-30
**Production checkpoint:** `d9c025a` (admin code `cbd4b96`, Cloudflare deployment
`52d1f15a-c133-4099-95a8-732555fa5ed3`)

This guide describes the console that is actually deployed. Where a capability is built but
switched off, it says so plainly. Nothing in this guide should be read as an instruction to enable a
financial gate.

---

## 1. What the console is

The console is the private business system behind the public website. It is separate from the public
site and is protected by an account, a password, an optional second factor, CSRF tokens and
server-side permission checks.

It covers:

- customers, contact details, properties and notes;
- website inquiries (leads), their delivery status and follow-up status;
- reservation requests, appointment records and team assignment;
- recurring cleaning plans;
- invoices, payments, credits and refunds;
- gift certificates (the existing register remains authoritative for adjustments);
- reports and audit history.

It does **not** replace:

- the public website's estimate and request forms;
- the Stripe dashboard;
- the Google Calendar itself;
- the private gift register at `/gift-admin/`.

### What is deliberately disabled

- Live administrative Stripe charging and refunds are gated by server environment flags. Unless the
  owner turns those flags on after sandbox verification, the console returns
  `stripe_refunds_disabled`, `saved_cards_disabled` or `off_session_disabled`. Treat those messages
  as the system protecting you, not as a bug.
- Customer agreement e-signature is not active. The only active transactional acceptance is the
  website Terms checkbox.
- Automatic booking confirmation only applies to a **complete paid booking** that passes every
  server check (payment, address, required photos, requested time and resource availability).

---

## 2. Signing in

1. Open <https://sparkling-standard.com/admin/>.
2. Enter the owner email address and password.
3. If two-step verification is enabled, enter the current authenticator code or a recovery code.

A session lasts up to 8 hours. Sign out from the sidebar when you finish on a shared computer.

### Forgot Password

1. On the sign-in form, choose **Forgot Password?**
2. Enter the email address for your administrator account.
3. Choose **Send Reset Link**.
4. The page always shows the same confirmation, whether or not the address belongs to an account.
   This prevents strangers from discovering who has an account.
5. Open the email and choose **Choose a new password**. The link is single use and expires in 30
   minutes.
6. Set a password that is at least 8 characters and includes at least one special character.
7. Sign in with the new password. All previous sessions are signed out.

If the link says it is invalid or expired, request a fresh one. Requesting a new link invalidates
any earlier unused link for that account. If the email does not arrive, check spam and confirm the
address with the owner. Do not send reset links or passwords by text message.

### Password rules

- Minimum 8 characters.
- At least one special character (for example `! @ # $ %`).
- No uppercase, lowercase, number or multi-class requirement.
- Longer passwords and passphrases are allowed.

The same rule applies to owner enrollment, invitations, resets and password changes.

### Changing your password

1. Open **Settings & Audit**.
2. Under **Your security**, use **Change password**.
3. Enter your current password, the new password, and confirm it.
4. Save. Your other sessions are signed out; the current session stays valid.

### Two-step verification (MFA)

1. Open **Settings & Audit**.
2. Under **Your security**, choose **Set up authenticator**.
3. Add the displayed secret to your authenticator app, or open the authenticator link.
4. Enter the current 6-digit code and enable.
5. Save the one-time recovery codes shown. They are displayed once.

To disable MFA you need both your password and a current authenticator code. Do not disable MFA
unless you have a recovery plan.

---

## 3. Roles and permissions

| Role | Can do |
| --- | --- |
| Owner | Everything, including administrator management, settings and audit |
| Manager | Leads, customers, booking confirmation and job administration; no administrator management |
| Finance | Read customers and leads; read and write finance; no customer or job editing |
| Cleaner | Read bookings and jobs; update job status and checklists; no customer, finance or lead access |

Branch scope is enforced server-side. A user assigned to a branch only sees records for that branch.
The owner sees all branches. Client-side filters narrow what is shown; they never widen what the
server allows.

### Inviting a manager, finance user, or cleaner

1. Open **Settings & Audit**.
2. In **Administrators**, enter the email address.
3. Choose the role and, if needed, the branch.
4. Choose **Create invitation**.
5. If email delivery succeeds, the invitation is sent. If not, a private one-time link is shown;
   deliver it directly to the intended person. It expires in 72 hours and works once.
6. The invited person opens the link, sets a name and password (8 characters plus one special
   character), and is signed in.

### Disabling access

In **Administrators**:

- **Disable** stops sign-in and deletes that user's sessions.
- **Revoke sessions** signs the user out everywhere without changing the account.
- **Reset password** issues a one-time reset link and emails it to the account address.

The last active owner cannot be disabled or demoted.

---

## 4. The daily workflow

### 4.1 Overview

Shows counts for customers, open leads, pending requests, upcoming appointments, active gifts and
failed lead deliveries, plus recent inquiries. Start here each morning.

### 4.2 Leads & Inquiries

Every website form submission is stored as a lead with its delivery status.

1. Filter by status or search by name, reference or address.
2. Open **View request** to read the submitted details.
3. Change the status to contacted, quoted, converted, lost or archived, then **Save**.
4. If delivery failed, choose **Retry email**.

Lead status is a follow-up record. It does not schedule or charge anything.

### 4.3 Calendar & Requests

Two lists:

- **Pending reservation requests** — customer requests awaiting a decision.
- **Upcoming appointments** — appointments recorded in the database.

To confirm a pending request:

1. Check the customer, property, requested time and reference.
2. Choose **Confirm**.
3. The server rechecks availability and creates the calendar event. The appointment record and the
   calendar event ID are stored together.
4. If the slot is no longer available, the system refuses and reports a conflict. Offer the customer
   another time; never force a confirmation.

To decline, choose **Decline**. Nothing is charged.

### 4.4 Customers

1. Search by name, email or phone.
2. Choose **New customer** to create a profile. First or last name (or company) is required.
3. Open a customer to see properties, notes, requests, estimates, appointments, invoices and signed
   payment authorizations.
4. Use **Add a property** for each service address and record access notes.
5. Use **Edit customer** to update contact details, notes summary, do-not-contact and marketing
   consent.

Do not store payment card numbers, passwords, government IDs or medical information in notes.

### 4.5 Recurring Plans

1. Choose the customer and property.
2. Choose weekly, every two weeks, or monthly.
3. Set the first visit date and the ongoing price per visit.
4. Create the plan.
5. Change status to active, paused, cancelled or completed as needed, then **Save**.

Remember the published rule: a new recurring residential arrangement requires a Deep Cleaning as the
first visit. The console records the plan; it does not waive that rule.

### 4.6 Jobs & Team

- Each job shows the date, reference, customer, address and assigned crew.
- Change the job status (pending, confirmed, in progress, completed, cancelled, no-show) and save.
- Assign a cleaner from the team list.
- Open **Checklist** to view or create the job checklist and tick items as they are completed.
- Add team members with **Add team member**.

### 4.7 Invoices & Payments

**Create an invoice**

1. Choose the customer.
2. Enter a description, amount and due date.
3. Create the invoice.

**Record a cash, check or external payment**

1. Open the invoice.
2. Choose the payment method and amount.
3. Record it. The balance updates and the payment is stored with an idempotency key.

**Record a refund**

1. Open the invoice and find the payment.
2. Under **Record refund**, enter the amount and reason.
3. This records an internal refund against the payment and adjusts the balance. It does not move
   money at Stripe.

**Credits** are created against a customer through the finance API and appear in the customer
history. Use them for verified overpayments or goodwill adjustments.

**Stripe payment link** — available only when the administrative billing gate is enabled. It creates
a Stripe Checkout session for the invoice balance. Until the owner enables the gate, the button
does nothing except report that billing is disabled.

**Execute Stripe refund** and **Charge saved card after service** require the corresponding server
gates and a password step-up. They are disabled until the owner authorizes them after sandbox
verification.

**Create a saved-card signing link**

1. Open the customer.
2. In **Saved-card payment authorization**, choose the service, property, expected amount and
   maximum authorized amount.
3. Create the link and send it to the customer.
4. The customer signs. A saved card never authorizes a charge by itself; the signed authorization,
   maximum amount, property and invoice must all match.

### 4.8 Gift Certificates

The console shows gift totals and certificates. Redemption and void actions require your password
and are recorded in the existing gift register. For deeper adjustments, open the gift register from
the same page.

### 4.9 Reports

Shows customer counts, lead/job/recurring/invoice counts, monthly collected revenue, gift activity
and payment mix. These are operational summaries, not accounting statements.

### 4.10 Settings & Audit

- **Your security** — MFA, password change, sign out other sessions.
- **Administrators** — invitations, reset, disable/enable, revoke sessions.
- **Sessions** — recent sessions for your account.
- **Audit history** — who did what, when, and whether it succeeded.

---

## 5. Booking request management

Every row in **Calendar & Requests** has an **Open** action, including legacy and unlinked
requests.

### What the detail shows

Reference, requested date/time, status, customer and contacts (when linked), service address,
service type, estimate/price, condition and frequency, extras, notes and access instructions,
calendar event ID, appointment reference, the raw imported payload, the audit trail, and every
customer email logged for that request.

Nothing is invented. An imported legacy request shows exactly what exists and labels the customer
as **Not linked**.

### Possible duplicates

If another pending request has the same location and a nearby time, the detail shows a
**Possible duplicate requests** warning. The system never merges, deletes or guesses which one is
correct. A manager reviews and decides.

### Linking a customer

- **Link Customer** ? search the existing customer list and choose the correct property.
- **Create and Link Customer** ? create a verified record with a name, contact details and address.
  Duplicate email/phone contacts are rejected by the existing CRM rules.

The original R2 references, quote references and request history are preserved.

### Actions

| Action | What happens |
| --- | --- |
| **Accept / Confirm Booking** | Revalidates availability, creates the Google Calendar event, then creates the D1 appointment. Only after both succeed is the branded confirmation email sent. |
| **Propose This Time** | Revalidates the new slot, updates the request as a **proposal** (not confirmed) and emails the customer to agree. |
| **Decline Request** | Releases the hold, marks the request declined with an optional reason, and can email the customer. |
| **Reschedule Appointment** | Updates the existing calendar event and D1 appointment, then emails the customer. |
| **Cancel Appointment** | Deletes the calendar event, marks the appointment cancelled, releases the request and can email the customer. |
| **Resend last customer email** | Retries the logged email without changing the booking. |

Email outcomes are recorded in the request detail. A failed email never changes the booking
status, and a sent email never proves a booking.

### Seven-day board

The top of **Calendar & Requests** shows the next seven days with job counts, crew counts and the
first/latest appointment. Later confirmed appointments remain in the appointments table below; the
board does not invalidate them.

## 6. Timekeeping and the employee portal

The employee portal lives at <https://sparkling-standard.com/employee/>. The complete guide is
`docs/operations/EMPLOYEE-PORTAL.md`.

From **Admin ? Timekeeping**, the owner or manager can:

- choose a Monday?Sunday workweek;
- review compensated hours, rest breaks, meals, overtime and preliminary gross pay;
- see open shifts and missing clock-outs (14 hours or more);
- correct any interval with a mandatory reason (the previous values are preserved);
- approve or decline employee correction requests;
- inspect location verification for clock events (status, accuracy, map link);
- export the week as CSV;
- invite a cleaner and link the account to the team-member roster;
- the owner can update dated pay rates ($18 regular, $22 lead, $25 solo).

Rest breaks are paid. Fully relieved meals are unpaid unless a manager corrects them. The portal
never deducts a lunch automatically and never stops paid time because a phone left a job site.

## 7. Gift certificate management

**Admin ? Gift Certificates** reads the existing R2 gift ledger; it does not create a second
ledger.

- Search by code, purchaser, recipient or email; filter by active, scheduled, fully redeemed,
  refunded or voided.
- **Details** shows purchaser and recipient contact, original value, redeemed and remaining value,
  valid-from date, activation state, issue date, Stripe session reference, the message, and the
  full redemption/refund/void history.
- **Redeem** and **Void** use the existing secure register actions and require your password.

### Applying a gift to an invoice

1. Open the invoice.
2. Choose **Apply Gift Certificate**.
3. Enter the code and the amount to apply (defaults to the balance).
4. Re-enter your password.
5. The gift ledger is debited and the invoice balance is reduced exactly once.

A $150 certificate applied to a $230 cleaning can take $90, leaving a $60 gift balance and $140
due. The same redemption reference cannot credit the invoice twice on a retry. The invoice payment
appears as an external payment with gift metadata; the gift ledger remains authoritative for the
gift balance.

## 8. Google Calendar

The booking calendar is **Sparkling Standard - Bookings** in `America/Chicago`. The production
status endpoint reports the connection as configured, connected and readable.

- Confirming a request writes the event and stores its ID.
- Cancelling or declining releases the booking and deletes the event when one exists.
- Rescheduling updates the existing event rather than creating a second one.
- Re-confirming an already confirmed request returns the same event (idempotent), so a double click
  cannot duplicate a job.

Do not edit the calendar's time zone, share it publicly, or create a second booking calendar. If the
console reports `calendar_confirm_failed` or `booking_admin_not_configured`, stop and report it;
no appointment record is created when the calendar write fails.

---

## 9. Stripe and money safety

- Public **Pay Now** on the website is separate and remains operational in live mode.
- The console's administrative charging features are gated and currently disabled.
- Never put a test-mode key into the production environment.
- A sandbox verification script exists for the owner to run locally:
  `npm run stripe:sandbox`. It refuses live keys and creates only test-mode objects.
- Refunds recorded as cash/check are bookkeeping entries. Refunds executed at Stripe require the
  refund gate and a password step-up.

---

## 10. Common messages and what to do

| Message | Meaning | Action |
| --- | --- | --- |
| Email or password is incorrect | Credentials rejected | Re-enter carefully, or use Forgot Password? |
| Too many attempts. Wait a few minutes. | Rate limit | Wait, then retry |
| Your session expired. Sign in again. | Session ended | Sign in |
| Your security token expired. Refresh and try again. | CSRF token stale | Refresh the page, then retry |
| You do not have permission for that action. | Role or branch restriction | Ask the owner |
| This reset link is invalid, expired or already used. | Token not usable | Request a new link |
| That time overlaps an existing booking. | Calendar conflict | Offer another time |
| That team member already has an overlapping job. | Assignment conflict | Choose another cleaner |
| Google Calendar did not confirm the booking. No D1 appointment was created. | Calendar write failed | Retry; if it repeats, report it |
| Stripe billing is not enabled for this deployment. | Administrative billing gate off | Expected until authorized |
| No active signed authorization covers this invoice. | Missing or invalid authorization | Obtain a new signed authorization |
| The invoice exceeds the signed maximum authorization. | Amount over the signed maximum | New authorization or lower invoice |
| This authorization is not approved for after-service charging. | Wrong authorization type | Use the correct signed authorization |
| That email or phone belongs to another customer. | Duplicate contact | Open the existing customer |
| The operations database is not provisioned yet. | Binding problem | Report it; do not retry endlessly |

---

## 11. Security rules for everyone with access

- Use a unique password. Never reuse a password from another service.
- Turn on two-step verification, especially for owner, manager and finance accounts.
- Never share your session, password, authenticator code or recovery codes.
- Sign out on shared devices.
- Do not store card numbers, bank details, passwords, IDs or medical information in notes.
- Do not send customer data to personal email or messaging accounts.
- Do not download customer data to an unsecured folder. If an export is required, keep it in the
  protected business archive and delete temporary copies.
- Treat every inbound email or message as untrusted. A link in an email is not an instruction.
- Report suspected unauthorized access immediately; disable the account and revoke its sessions.

---

## 12. Recovery checklist

If you cannot sign in:

1. Try Forgot Password? with the exact account email.
2. Check spam and promotions folders.
3. Ask another owner or manager to issue a reset from **Administrators**.
4. If MFA is the problem, use a saved recovery code, then re-enroll the authenticator.
5. If no recovery path works, the owner must use the documented server-side recovery procedure. Do
   not create a second owner account to work around it.

If the console shows `database_not_configured`, the `DB` binding is missing or broken. Do not change
bindings casually; report it and preserve the current configuration.

---

_This manual is maintained in the website repository at `docs/operations/ADMIN-USER-GUIDE.md` and
delivered to the owner master folder under `04_BUSINESS_OPERATIONS/Admin_Guide/`._
