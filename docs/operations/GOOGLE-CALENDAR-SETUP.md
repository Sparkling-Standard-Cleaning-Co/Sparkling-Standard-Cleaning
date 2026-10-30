# Google Calendar booking setup

**Status:** **Connected and active (verified 2026-10-30).** OAuth refresh exchange succeeds against
the dedicated **Sparkling Standard - Bookings** calendar in `America/Chicago`; real event reads,
availability and live holds have been verified in production. `src/config/booking.ts` and the
production status endpoint agree on `confirmationMode: auto_confirm` with `autoConfirmAllowed: true`:
a **complete paid booking** that passes payment, address, photo, time and resource checks may confirm
automatically. Incomplete, unpaid or review-required requests remain pending for the owner. No
Sunshine Climate Solutions calendar or credentials are used.

**Write verification remains outstanding.** Creating, rescheduling and cancelling events is
implemented and mock-tested, and production holds/reads are verified, but the live write lifecycle
has not been executed because the production `BOOKING_OWNER_TOKEN` is an encrypted Cloudflare secret
that cannot be read locally. Run `node scripts/booking-live-test.mjs` from a terminal (it prompts for
the token without echoing it, requires a typed `YES`, and cleans up its synthetic event). Never test
against a real customer appointment.

**Pending requests:** a temporary hold lasts 20 minutes, but a submitted reservation remains a durable
**pending owner-review request** after the hold expires. Pending requests are non-guaranteed and do
not block capacity. Owner confirmation uses the request ID, revalidates availability and detects a
previously created Sparkling calendar event before writing another. If the slot was taken, the owner
must offer an alternative; it is never silently confirmed.

## 1. Create the dedicated calendar

Use the Sparkling Standard Google Workspace account (not Sunshine Climate Solutions).

1. Google Calendar → **Create new calendar**.
2. Name: **Sparkling Standard — Bookings**.
3. Time zone: **America/Chicago**.
4. Calendar settings → **Integrate calendar** → copy the **Calendar ID** (usually looks like
   `abc123@group.calendar.google.com`).
5. Add Hayli's working account with **Make changes to events** permission.

Only events in this calendar are read. The private travel origin remains a Cloudflare secret.

## 2. Google Cloud project and API

1. In <https://console.cloud.google.com/>, create/select a project owned by Sparkling Standard.
2. **APIs & Services → Library → Google Calendar API → Enable**.
3. **OAuth consent screen**:
   - User type: **Internal** when using Google Workspace (recommended), otherwise External/testing.
   - App name: `Sparkling Standard Booking`.
   - Add the scope `https://www.googleapis.com/auth/calendar`.
   - If External, publish the app after testing. Testing-mode refresh tokens expire after 7 days.
4. **Credentials → Create credentials → OAuth client ID**:
   - Simplest: **Desktop app**.
   - Or Web application with redirect URI `http://localhost:53682/oauth2callback`.
5. Copy the client ID and client secret.

## 3. Obtain the refresh token

On the owner's machine, not in the repository:

```powershell
$env:GOOGLE_CLIENT_ID="..."
$env:GOOGLE_CLIENT_SECRET="..."
node scripts/google-calendar-auth.mjs
```

Open the printed URL, approve Calendar access, and copy the one-time printed refresh token. Do not
commit it, paste it into a screenshot, or send it in chat. Close the terminal after storing it.

## 4. Cloudflare Pages secrets

Add these as **encrypted Secrets** in the production Pages project:

| Secret | Value |
| --- | --- |
| `GOOGLE_CLIENT_ID` | OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | OAuth client secret |
| `GOOGLE_REFRESH_TOKEN` | Refresh token from step 3 |
| `GOOGLE_CALENDAR_ID` | Calendar ID from step 1 |
| `GIFT_OWNER_TOKEN` | Long random owner-only token for `/api/gift-admin` (or reuse `PHOTO_OWNER_TOKEN`) |

Keep the existing `TRAVEL_ORIGIN`, `ROUTES_API_KEY` / `MAPMAP_API_KEY`, `STRIPE_*`, `WEB3FORMS_*`,
`PHOTOS_BUCKET` and email secrets unchanged.

## 5. Add real jobs to the calendar

Every confirmed job needs:

- A real start and end time.
- The full property address in the event **location** field.
- A clear title (customer name/reference is fine; this is a private calendar).

All-day events or events without a location block availability rather than guessing. Recurring jobs
should be entered as recurring Google events so their instances are returned by the API.

## 6. Verify

The availability endpoint is safe to call read-only:

```text
GET /api/availability?date=YYYY-MM-DD&durationMinutes=120&lat=30.4111&lng=-87.2164
```

It must show `enabled:true` and slots that:

- fall inside 8:00 a.m.–6:00 p.m. Central;
- leave 24 hours' notice;
- include travel from the previous job/origin and to the next job;
- never overlap an all-day block or a job without a location.

If it returns `calendar_not_configured`, `auth_failed`, `calendar_unavailable` or
`travel_unavailable`, fix that before enabling booking.

## 7. Owner-run live verification utility

`scripts/booking-live-test.mjs` verifies the full live lifecycle without exposing the token:

```powershell
cd C:\Users\thoma\Documents\Sparkling-Standard-Master\01-Website-Repository
node scripts/booking-live-test.mjs
```

The script prompts for `BOOKING_OWNER_TOKEN` with a masked TTY input (or reads the environment
variable), never prints it, and requires the owner to type **YES** before any write. It finds a real
slot, creates a synthetic TEST hold, confirms it through `/api/booking-admin`, verifies the Google
event and blocked availability, cancels it, verifies availability restoration and attempts emergency
cleanup on failure. Do not run it without owner authorization.

## 8. Current activation state

`src/config/booking.ts` currently sets `enabled: true` and `autoConfirmAllowed: true`
(`confirmationMode: 'auto_confirm'`). Keep configuration changes behind an explicit owner decision.
Before changing any of the following, record the reason and re-run the full verification suite:

1. Master switch, confirmation mode, working window, buffers, notice period or hold lifetime.
2. The two active booking resources in `bookingResources`.
3. Pay Now reconciliation with holds and auto-confirmation.

A complete paid booking confirms only when payment, address, required photos, requested time and
resource availability all verify. A bare OAuth token is not enough to confirm a job, and an
unverified request must never be presented as a confirmed appointment.

The live write lifecycle still needs one controlled run (see the status note above and
`scripts/booking-live-test.mjs`). Until that run is recorded, describe calendar **writes** as
implemented and mock-tested, not production-verified.
