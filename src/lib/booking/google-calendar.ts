/**
 * Minimal Google Calendar API client for Cloudflare Pages Functions.
 *
 * Authentication: OAuth 2.0 refresh token for the dedicated bookings calendar.
 * The refresh token, client credentials and calendar id are server-only
 * environment values. No credential is ever returned to a browser or logged.
 */
import { zonedTimeToUtc } from './time.ts';

export interface GoogleCalendarEnv {
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  GOOGLE_REFRESH_TOKEN?: string;
  GOOGLE_CALENDAR_ID?: string;
}

export interface GoogleCalendarEvent {
  id: string;
  summary?: string;
  location?: string;
  start: { dateTime?: string; date?: string };
  end: { dateTime?: string; date?: string };
  transparency?: string;
  status?: string;
  extendedProperties?: { private?: Record<string, string> };
}

export interface CalendarJob {
  id: string;
  summary: string;
  start: Date;
  end: Date;
  locationText: string;
  blocksDay: boolean;
  /**
   * Cleaning resources assigned to the job. Absent for legacy/owner events,
   * which conservatively block every resource.
   */
  resourceIds?: string[];
}

/** Parses the private comma-separated resource assignment on an event. */
export function eventResourceIds(
  event: Pick<GoogleCalendarEvent, 'extendedProperties'>,
): string[] {
  const raw = event.extendedProperties?.private?.sparkling_resources ?? '';
  const ids = raw
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  return ids.length > 0 ? [...new Set(ids)] : [];
}

export interface GoogleCalendarStatus {
  configured: boolean;
  connected: boolean;
  calendarName?: string;
  timeZone?: string;
  reason?: 'not_configured' | 'auth_failed' | 'calendar_unavailable';
}

let cachedToken: { value: string; expiresAt: number } | null = null;

export function googleConfigured(env: GoogleCalendarEnv): boolean {
  return Boolean(
    env.GOOGLE_CLIENT_ID?.trim() &&
      env.GOOGLE_CLIENT_SECRET?.trim() &&
      env.GOOGLE_REFRESH_TOKEN?.trim() &&
      env.GOOGLE_CALENDAR_ID?.trim(),
  );
}

async function accessToken(env: GoogleCalendarEnv): Promise<string | null> {
  if (!googleConfigured(env)) return null;
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.value;
  const body = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID!.trim(),
    client_secret: env.GOOGLE_CLIENT_SECRET!.trim(),
    refresh_token: env.GOOGLE_REFRESH_TOKEN!.trim(),
    grant_type: 'refresh_token',
  });
  try {
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(10_000),
    });
    const data = (await response.json().catch(() => ({}))) as {
      access_token?: string;
      expires_in?: number;
    };
    if (!response.ok || !data.access_token) return null;
    cachedToken = {
      value: data.access_token,
      expiresAt: Date.now() + Math.max(60, data.expires_in ?? 3600) * 1000,
    };
    return data.access_token;
  } catch {
    return null;
  }
}

function calendarPath(env: GoogleCalendarEnv): string {
  return encodeURIComponent(env.GOOGLE_CALENDAR_ID!.trim());
}

export async function calendarStatus(env: GoogleCalendarEnv): Promise<GoogleCalendarStatus> {
  if (!googleConfigured(env)) return { configured: false, connected: false, reason: 'not_configured' };
  const token = await accessToken(env);
  if (!token) return { configured: true, connected: false, reason: 'auth_failed' };
  try {
    const response = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${calendarPath(env)}`,
      { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10_000) },
    );
    if (!response.ok) return { configured: true, connected: false, reason: 'calendar_unavailable' };
    const data = (await response.json().catch(() => ({}))) as {
      summary?: string;
      timeZone?: string;
    };
    return {
      configured: true,
      connected: true,
      ...(data.summary ? { calendarName: data.summary } : {}),
      ...(data.timeZone ? { timeZone: data.timeZone } : {}),
    };
  } catch {
    return { configured: true, connected: false, reason: 'calendar_unavailable' };
  }
}

function eventJob(event: GoogleCalendarEvent, timeZone: string): CalendarJob | null {
  if (event.status === 'cancelled' || event.transparency === 'transparent') return null;
  const resourceIds = eventResourceIds(event);
  if (event.start.date || event.end.date) {
    const day = event.start.date ?? event.end.date ?? '';
    const start = zonedTimeToUtc(day, '00:00', timeZone);
    return {
      id: event.id,
      summary: event.summary ?? 'Owner unavailable',
      start,
      end: new Date(start.getTime() + 24 * 60 * 60 * 1000),
      locationText: '',
      blocksDay: true,
      ...(resourceIds.length > 0 ? { resourceIds } : {}),
    };
  }
  if (!event.start.dateTime || !event.end.dateTime) return null;
  const start = new Date(event.start.dateTime);
  const end = new Date(event.end.dateTime);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start) return null;
  return {
    id: event.id,
    summary: event.summary ?? 'Cleaning job',
    start,
    end,
    locationText: event.location?.trim() ?? '',
    blocksDay: false,
    ...(resourceIds.length > 0 ? { resourceIds } : {}),
  };
}

export async function calendarJobsForDate(
  env: GoogleCalendarEnv,
  date: string,
  timeZone: string,
): Promise<{ ok: boolean; jobs: CalendarJob[]; reason?: 'auth_failed' | 'calendar_unavailable' }> {
  const token = await accessToken(env);
  if (!token) return { ok: false, jobs: [], reason: 'auth_failed' };
  const start = zonedTimeToUtc(date, '00:00', timeZone);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  const params = new URLSearchParams({
    timeMin: start.toISOString(),
    timeMax: end.toISOString(),
    singleEvents: 'true',
    orderBy: 'startTime',
    maxResults: '100',
  });
  try {
    const response = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${calendarPath(env)}/events?${params}`,
      { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10_000) },
    );
    if (!response.ok) return { ok: false, jobs: [], reason: 'calendar_unavailable' };
    const data = (await response.json().catch(() => ({}))) as { items?: GoogleCalendarEvent[] };
    const jobs = (data.items ?? [])
      .map((event) => eventJob(event, timeZone))
      .filter((job): job is CalendarJob => job !== null);
    return { ok: true, jobs };
  } catch {
    return { ok: false, jobs: [], reason: 'calendar_unavailable' };
  }
}


export async function calendarJobsForRange(
  env: GoogleCalendarEnv,
  fromDate: string,
  toDate: string,
  timeZone: string,
): Promise<{ ok: boolean; jobs: CalendarJob[]; reason?: 'auth_failed' | 'calendar_unavailable' }> {
  const token = await accessToken(env);
  if (!token) return { ok: false, jobs: [], reason: 'auth_failed' };
  const start = zonedTimeToUtc(fromDate, '00:00', timeZone);
  const endDay = new Date(Date.parse(`${toDate}T12:00:00Z`) + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const end = zonedTimeToUtc(endDay, '00:00', timeZone);
  const params = new URLSearchParams({
    timeMin: start.toISOString(),
    timeMax: end.toISOString(),
    singleEvents: 'true',
    orderBy: 'startTime',
    maxResults: '2500',
  });
  try {
    const response = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${calendarPath(env)}/events?${params}`,
      { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(12_000) },
    );
    if (!response.ok) return { ok: false, jobs: [], reason: 'calendar_unavailable' };
    const data = (await response.json().catch(() => ({}))) as { items?: GoogleCalendarEvent[] };
    const jobs = (data.items ?? [])
      .map((event) => eventJob(event, timeZone))
      .filter((job): job is CalendarJob => job !== null);
    return { ok: true, jobs };
  } catch {
    return { ok: false, jobs: [], reason: 'calendar_unavailable' };
  }
}

export interface NewCalendarJob {
  summary: string;
  description: string;
  location: string;
  start: string;
  end: string;
  timeZone: string;
  reference: string;
  /** Assigned cleaning resources (comma-separated on the event). */
  resourceIds: string[];
}

export interface CalendarEventPatch {
  summary?: string;
  description?: string;
  location?: string;
  start?: string;
  end?: string;
  timeZone?: string;
  resourceIds?: string[];
}

function eventPrivateProperties(
  reference: string | undefined,
  resourceIds: ReadonlyArray<string> | undefined,
): Record<string, string> {
  const properties: Record<string, string> = {};
  if (reference) properties.sparkling_reference = reference;
  if (resourceIds && resourceIds.length > 0) {
    properties.sparkling_resources = [...new Set(resourceIds)].join(',');
  }
  return properties;
}

export async function createCalendarEvent(
  env: GoogleCalendarEnv,
  job: NewCalendarJob,
): Promise<{ ok: boolean; eventId?: string; reason?: 'auth_failed' | 'calendar_unavailable' }> {
  const token = await accessToken(env);
  if (!token) return { ok: false, reason: 'auth_failed' };
  try {
    const response = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${calendarPath(env)}/events`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          summary: job.summary,
          description: job.description,
          location: job.location,
          start: { dateTime: job.start, timeZone: job.timeZone },
          end: { dateTime: job.end, timeZone: job.timeZone },
          extendedProperties: {
            private: eventPrivateProperties(job.reference, job.resourceIds),
          },
        }),
        signal: AbortSignal.timeout(10_000),
      },
    );
    const data = (await response.json().catch(() => ({}))) as { id?: string };
    if (!response.ok || !data.id) return { ok: false, reason: 'calendar_unavailable' };
    return { ok: true, eventId: data.id };
  } catch {
    return { ok: false, reason: 'calendar_unavailable' };
  }
}

/** Updates an existing confirmed event (reschedule or owner reassignment). */
export async function updateCalendarEvent(
  env: GoogleCalendarEnv,
  eventId: string,
  patch: CalendarEventPatch,
): Promise<{ ok: boolean; reason?: 'auth_failed' | 'calendar_unavailable' }> {
  const token = await accessToken(env);
  if (!token) return { ok: false, reason: 'auth_failed' };
  const body: Record<string, unknown> = {};
  if (patch.summary !== undefined) body.summary = patch.summary;
  if (patch.description !== undefined) body.description = patch.description;
  if (patch.location !== undefined) body.location = patch.location;
  if (patch.start !== undefined) {
    body.start = { dateTime: patch.start, ...(patch.timeZone ? { timeZone: patch.timeZone } : {}) };
  }
  if (patch.end !== undefined) {
    body.end = { dateTime: patch.end, ...(patch.timeZone ? { timeZone: patch.timeZone } : {}) };
  }
  if (patch.resourceIds !== undefined) {
    body.extendedProperties = {
      private: { sparkling_resources: [...new Set(patch.resourceIds)].join(',') },
    };
  }
  if (Object.keys(body).length === 0) return { ok: true };
  try {
    const response = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${calendarPath(env)}/events/${encodeURIComponent(eventId)}`,
      {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10_000),
      },
    );
    return response.ok ? { ok: true } : { ok: false, reason: 'calendar_unavailable' };
  } catch {
    return { ok: false, reason: 'calendar_unavailable' };
  }
}

export async function deleteCalendarEvent(
  env: GoogleCalendarEnv,
  eventId: string,
): Promise<{ ok: boolean; reason?: 'auth_failed' | 'calendar_unavailable' }> {
  const token = await accessToken(env);
  if (!token) return { ok: false, reason: 'auth_failed' };
  try {
    const response = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${calendarPath(env)}/events/${encodeURIComponent(eventId)}`,
      { method: 'DELETE', headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10_000) },
    );
    return response.ok || response.status === 404
      ? { ok: true }
      : { ok: false, reason: 'calendar_unavailable' };
  } catch {
    return { ok: false, reason: 'calendar_unavailable' };
  }
}
export async function findCalendarEventByReference(
  env: GoogleCalendarEnv,
  reference: string,
): Promise<string | null> {
  const token = await accessToken(env);
  if (!token || !reference.trim()) return null;
  const params = new URLSearchParams({
    privateExtendedProperty: `sparkling_reference=${reference}`,
    maxResults: '1',
    singleEvents: 'true',
  });
  try {
    const response = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${calendarPath(env)}/events?${params}`,
      { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10_000) },
    );
    if (!response.ok) return null;
    const data = (await response.json().catch(() => ({}))) as { items?: Array<{ id?: string }> };
    return data.items?.[0]?.id ?? null;
  } catch {
    return null;
  }
}
export interface CalendarEventDetails {
  id: string;
  summary?: string;
  location?: string;
  start?: string;
  end?: string;
  status?: string;
  resourceIds?: string[];
}

export async function getCalendarEvent(
  env: GoogleCalendarEnv,
  eventId: string,
): Promise<CalendarEventDetails | null> {
  const token = await accessToken(env);
  if (!token) return null;
  try {
    const response = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${calendarPath(env)}/events/${encodeURIComponent(eventId)}`,
      { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10_000) },
    );
    if (!response.ok) return null;
    const data = (await response.json().catch(() => ({}))) as {
      id?: string;
      summary?: string;
      location?: string;
      status?: string;
      start?: { dateTime?: string; date?: string };
      end?: { dateTime?: string; date?: string };
      extendedProperties?: { private?: Record<string, string> };
    };
    if (!data.id) return null;
    const rawResources = data.extendedProperties?.private?.sparkling_resources ?? '';
    const resources = [
      ...new Set(
        rawResources
          .split(',')
          .map((value) => value.trim())
          .filter(Boolean),
      ),
    ];
    return {
      id: data.id,
      ...(data.summary ? { summary: data.summary } : {}),
      ...(data.location ? { location: data.location } : {}),
      ...(data.status ? { status: data.status } : {}),
      ...(data.start?.dateTime ? { start: data.start.dateTime } : {}),
      ...(data.end?.dateTime ? { end: data.end.dateTime } : {}),
      ...(resources.length > 0 ? { resourceIds: resources } : {}),
    };
  } catch {
    return null;
  }
}