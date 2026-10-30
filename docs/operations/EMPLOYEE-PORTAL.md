# Employee portal and timekeeping

**Portal:** <https://sparkling-standard.com/employee/>
**Install help:** <https://sparkling-standard.com/employee/install/>
**Audience:** cleaners, the manager and the owner
**Last verified:** 2026-10-30

The employee portal is a private, mobile-first web application for assigned cleaning
staff. It is not the owner dashboard and it has no public self-registration. Employees use
the same secure account system as the operations console; a cleaner account is tied to one
row in the existing team-member roster.

## 1. Accounts and invitations

1. The owner or manager opens **Admin → Timekeeping → Staff access**.
2. Enter the cleaner's email under **Invite a cleaner** and send the invitation.
3. The cleaner opens the one-time link (72 hours, single use), creates a name and password,
   and is signed in to `/employee/`.
4. After the account exists, the manager links it to the roster: enter the account email and
   choose the matching team member under **Link an account to the roster**.
5. Rates default to the owner-approved values:
   - Regular cleaner: **$18.00/hour**
   - Lead cleaner: **$22.00/hour**
   - Solo assignment: **$25.00/hour**
6. Only the owner can change a rate (**Pay rates**). Each change is dated and audited.

Managers cannot create owner accounts. A cleaner account can never open the owner console:
`/admin/` redirects cleaners to `/employee/`, and the owner APIs reject cleaner sessions.

## 2. Signing in

- Open the portal link on a phone.
- Sign in with the invited email and password.
- Password rule: **at least 8 characters and one special character**.
- **Forgot Password?** sends a single-use link that expires in 30 minutes.
- MFA, if enrolled, is preserved. Recovery codes work on the sign-in screen.
- Sessions expire after 8 hours. Use **Sign out** on a shared phone.

## 3. Installing on a phone

Open `/employee/install/` for illustrated steps. The portal is a home-screen web app, not a
native App Store or Google Play application.

**iPhone/iPad (Safari):** Share → Add to Home Screen → name it “SS Team” → Add.

**Android (Chrome):** three-dot menu → Install app (or Add to Home screen) → confirm.

The manifest uses the approved Sparkling Standard icon and opens in standalone display mode.

## 4. The three-day schedule

The portal shows only the employee's **assigned jobs for today, tomorrow and the day after**.
This limit is enforced by the server, not by the phone screen. Each assignment shows:

- date and arrival/start time, expected duration;
- service address;
- service category;
- assigned crew names;
- the essential job instructions and access notes;
- the job checklist;
- appointment status.

The portal never exposes other customers, contact details, payment methods, profit margins,
other employees' time or the wider administrative calendar.

## 5. Timeclock

The clock card is the first control on the page. The available actions depend on the current
state:

| State | Actions |
| --- | --- |
| Clocked out | **Clock In** (optionally choose the assigned job and rate) |
| Working | **Start Break**, **Start Meal**, **Clock Out** |
| On break | **End Break**, **Clock Out** |
| On meal | **End Meal**, **Clock Out** |

Rules enforced by the server:

- One open interval per employee. Double clock-in is rejected.
- A rest break is **paid** and ends when the employee returns to work.
- A fully relieved meal period is **unpaid** by default. A manager can mark a meal paid if the
  employee actually worked through it.
- Clocking out closes the current interval; it never invents a lunch deduction.
- The workweek is **Monday 00:00 through Sunday 23:59:59 America/Chicago**. Overtime is the
  compensated work time beyond 40 hours in that week.
- All times are stored in UTC; the screen displays Central Time.
- Employees cannot edit verified records. They can send a **correction request** with an
  explanation, which a manager reviews.

Preliminary gross earnings use the rate attached to each interval. They are labeled
preliminary until management reviews and approves the timecard. No payroll disbursement or
tax filing is performed.

## 6. Location verification and privacy

Location is requested **only when an employee taps a clock action**. There is no background
or continuous tracking.

When permitted, the event records latitude, longitude, GPS accuracy, the device-reported time,
the server timestamp, the account, the action and the related job. When permission is denied
or unavailable, the event records the exact status (`denied`, `unavailable` or `inaccurate`)
and **the time is still recorded**. No coordinates are invented.

Managers and the owner can review the verification status and a map link in
**Admin → Timekeeping → Location verification**. Employees cannot see another employee's
location. Coordinates are never shown publicly and are not sent to analytics.

## 7. Manager timekeeping tools

**Admin → Timekeeping** provides:

- a week selector and the Monday–Sunday workweek;
- compensated, break, meal and overtime totals per employee;
- open shifts and **missing clock-out** flags (an open shift of 14 hours or more);
- every interval with an **Edit** action;
- mandatory correction reasons, with the before/after values stored in
  `time_entry_corrections` and the audit log;
- pending employee correction requests with Approve/Decline;
- location verification events;
- **Export CSV** for the selected week;
- employee invitations and roster linking;
- owner-only pay-rate updates with effective dates.

Corrections never overwrite the audit history: the original interval values are preserved in
the correction record.

## 8. What is intentionally not included

- No payroll provider, direct deposit, tax withholding or filing.
- No automatic deduction of a scheduled lunch.
- No automatic clock-out based on GPS leaving a job site.
- No public employee directory or self-registration.
- No App Store or Google Play application.

## 9. Troubleshooting

| Message | Meaning | Action |
| --- | --- | --- |
| Your account is not linked to a team-member profile yet | The admin account exists but the roster link is missing | Ask the owner/manager to link it under Timekeeping → Staff access |
| Your employee profile is inactive | The team-member record is disabled | Ask management |
| You are already clocked in | An open interval exists | Clock out or end the current break/meal |
| That action does not match your current clock state | Wrong action for the state | Use the action shown for the current state |
| That job is not assigned to you | The selected job is not on this employee's roster | Refresh and choose an assigned job |
| The solo rate applies only to a job assigned to one cleaner | Solo rate was selected for a crew job | Choose regular/lead, or ask a manager to correct the timecard |
| Location permission was denied | The browser blocked GPS | Time is still recorded; a manager may review the event |

## 10. Verification status

- Employee authentication, role restriction, clock actions, break/meal handling, denied
  location, three-day visibility and manager correction review are covered by automated API
  and browser tests.
- The portal has not been activated for real staff until the owner and manager complete one
  supervised clock-in/clock-out and confirm the timecard totals.
- Real GPS accuracy varies by phone and location; the recorded accuracy is displayed rather
  than hidden.
