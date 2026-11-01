# Recurring scheduling, employee capacity and replenishment

**Feature gate:** `RECURRING_SCHEDULING_ENABLED` (remains **OFF** until the
release gates in the owner directive pass)
**Timezone:** America/Chicago
**Last verified:** 2026-11-01

## 1. Authoritative capacity

`team_members` is the roster. A resource is bookable only when:

- `status = 'active'`
- `is_bookable = 1`
- `booking_resource_id` is non-empty and unique
- the employee is not on time off for that date

Qualifications are independent of login:

- `is_solo = 1` — may work alone.
- `is_lead = 1` — may lead a crew.
- A helper has neither flag. Helpers may fill a second seat but never create an
  independent bookable slot.

Hayli keeps the historical booking resource id `hayli`. Migration
`0017_dynamic_booking_resources.sql` seeds `team_hayli`; the application links
the existing `owner@sparkling-standard.com` account by email without creating a
second login.

`bookingConfig.maxCrewSize` is the per-job crew limit, not the number of
simultaneous independent crews. Capacity is derived from the roster:

| Staffing | Independent jobs |
| --- | --- |
| Hayli alone | 1 |
| Hayli + helper | 1 |
| Hayli + second solo | 2 |
| Lead + helper | 1 |
| Two helpers | 0 |

Adding a qualified employee through the admin roster adds capacity immediately;
no deployment is required.

## 2. Availability and holds

`availabilityForDate` and `availabilityForRange` load the roster from D1 and
pass anchor/qualification data into the pure availability engine. A crew must
contain at least one anchor. Holds reserve the actual employee/time interval and
are stored in the existing durable ledger. A hold is temporary and is never a
confirmed booking.

## 3. Recurrence and the horizon

- Frequencies: weekly, biweekly, monthly (month-end anchored, no cumulative
  drift).
- Horizon: `bookingConfig.maxAdvanceDays` (60 days).
- First visit may use `first_duration_minutes`; ongoing visits use
  `duration_minutes`.
- Each occurrence tracks its appointment, calendar event, resource ids, status
  and sync error.

## 4. Non-destructive rescheduling

`prepareRecurringScheduleChange` validates every proposed date in the horizon
against qualified employee availability and the live calendar, excluding the
plan's own verified events. A conflict on **any** later occurrence returns the
conflict without changing the plan or any existing booking.

`applyRecurringScheduleChange` writes and verifies the new commitments before
changing the plan row. If an external write fails, it restores the snapshot of
the previous plan and occurrences and reports `rolledBack`. The original
confirmed visits are never erased first.

## 5. Idempotency and calendar safety

- Occurrence ids and calendar references are deterministic.
- Existing events are inspected before reuse. Found, cancelled, missing,
  authentication-failed and unavailable states are distinguished.
- A missing/cancelled event is recreated; an unverified authentication/API
  failure is recorded as `calendar_unverified` rather than guessed.
- Events are updated in place when the time or resource assignment changes.
- Superseded occurrences are cancelled only after every desired occurrence has
  been written successfully.

## 6. Customer paid recurring checkout

`commitConfirmedBooking` is the shared confirmation path. It:

1. resolves/creates the customer and property idempotently;
2. enforces the customer document gate;
3. revalidates the slot and resources;
4. creates/reuses one calendar event by quote reference;
5. creates one D1 appointment by the same reference;
6. links the calendar event;
7. creates the recurring plan once, keyed by `recurring_plans.booking_reference`;
8. syncs future occurrences through the same recurring engine.

Repeated Stripe webhooks and repeated calls do not duplicate the customer,
property, plan, appointment or event. Future conflicts are recorded honestly;
the paid first visit remains confirmed and the plan reports
`partially_scheduled`/`conflict`.

No Stripe subscription or future off-session charge is created by this flow.

## 7. Admin recurring operations

- Create a plan from the admin **Recurring Plans** view.
- Edit frequency, window, exact start time, duration, crew size and price.
- Pause, resume, cancel or complete a plan.
- Assign/remove employees on confirmed jobs; the capacity and onboarding gates
  are revalidated.
- Confirmed admin recurring appointments create calendar events and D1
  appointments; future occurrences are synchronized.

## 8. Daily replenishment Worker

`workers/recurring-replenish/` contains a daily Cloudflare Worker using the
existing D1 database and Google Calendar credentials. It claims one durable run
per Central date in `recurring_worker_runs`, reconciles active plans and records
conflicts/errors. Cron `0 9 * * *` UTC is early morning Central.

Deployment requires the owner to fill the existing production D1 database id and
add the existing secrets; those values are intentionally not committed. See
`workers/recurring-replenish/README.md`.

## 9. Release gate

Do not enable `RECURRING_SCHEDULING_ENABLED` until:

- employee capacity and Hayli's linked profile are verified in production;
- admin recurring creation and non-destructive rescheduling are verified;
- the document/signature gates are configured as intended;
- the daily Worker is deployed and its trigger is observed;
- the recurring lifecycle, capacity and customer recurring tests pass;
- a controlled real-calendar create/update/cancel test succeeds.

Normal one-time bookings remain available while recurring writes are gated.
