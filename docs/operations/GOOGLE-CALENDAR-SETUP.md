# Google Calendar booking setup

**Status:** **Connected and active (2026-10-28).** OAuth refresh exchange succeeds against the dedicated
**Sparkling Standard - Bookings** calendar in `America/Chicago`; real event reads and live
availability/holds have been verified. Booking remains `owner_approval`; auto-confirm is disabled.
No Sunshine Climate Solutions calendar or credentials are used. The owner still needs to add real
jobs with full addresses and run one owner-confirmation/event-creation test.

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

## 7. Activation gate

`src/config/booking.ts` has `enabled:false` and `autoConfirmAllowed:false`. Keep both false until:

1. The calendar is connected and the read-only probe passes.
2. Existing jobs and crew capacity are reviewed.
3. The owner approves the working window, buffers, notice period and confirmation mode.
4. A controlled test proves holds, concurrency, rescheduling and cancellation.
5. Pay Now is reconciled with the hold/booking state.

Live booking must not be switched on with only an OAuth token. The availability engine is only
half of the booking lifecycle; the durable hold/confirmation layer and customer UI activation still
need to be verified.
