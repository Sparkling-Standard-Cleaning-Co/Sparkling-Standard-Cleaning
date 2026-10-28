// Owner-operated live Google Calendar verification.
// Token: BOOKING_OWNER_TOKEN environment variable or masked TTY prompt.
// Usage: node scripts/booking-live-test.mjs [--date YYYY-MM-DD] [--lat 30.4111 --lng -87.2164]
// The token is never printed or stored. A typed YES is required before any calendar write.

import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import crypto from 'node:crypto';

const BASE = (process.argv.includes('--base')
  ? process.argv[process.argv.indexOf('--base') + 1]
  : 'https://sparkling-standard.com').replace(/\/+$/, '');
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const DURATION = Number(arg('duration', '120'));
const LAT = Number(arg('lat', '30.4111'));
const LNG = Number(arg('lng', '-87.2164'));
const LOCATION = arg('location', '100 S Baylen St, Pensacola, FL 32502');
const today = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Chicago',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
}).format(new Date());
const addDays = (date, n) => {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n, 12)).toISOString().slice(0, 10);
};
const START_DATE = arg('date', addDays(today, 1));

function readHidden(question) {
  return new Promise((resolve, reject) => {
    if (!input.isTTY) {
      reject(new Error('Set BOOKING_OWNER_TOKEN in the environment; interactive prompt needs a TTY.'));
      return;
    }
    output.write(question);
    input.setRawMode(true);
    input.resume();
    input.setEncoding('utf8');
    let value = '';
    const finish = (error) => {
      input.setRawMode(false);
      input.pause();
      input.removeListener('data', handler);
      output.write('\n');
      error ? reject(error) : resolve(value);
    };
    const handler = (chunk) => {
      if (chunk === '\u0003') return finish(new Error('cancelled'));
      if (chunk === '\r' || chunk === '\n') return finish();
      if (chunk === '\u007f' || chunk === '\b') value = value.slice(0, -1);
      else value += chunk;
    };
    input.on('data', handler);
  });
}

async function request(path, options = {}) {
  const response = await fetch(`${BASE}${path}`, {
    ...options,
    headers: { Accept: 'application/json', ...(options.headers ?? {}) },
  });
  const body = await response.json().catch(() => ({}));
  return { response, body };
}

let ownerToken = process.env.BOOKING_OWNER_TOKEN?.trim() || '';
let holdId = '';
let confirmed = false;
let rl = null;
try {
  if (!ownerToken) ownerToken = (await readHidden('BOOKING_OWNER_TOKEN (hidden): ')).trim();
  if (!ownerToken) throw new Error('missing owner token');
  rl = readline.createInterface({ input, output });
  output.write(`\nTarget: ${BASE}\n`);
  output.write('This will create, confirm, verify, and cancel one synthetic TEST appointment.\n');
  const yes = await rl.question('Type YES to authorize the live test: ');
  if (yes.trim() !== 'YES') throw new Error('not_authorized');

  let date = START_DATE;
  let slot = null;
  for (let i = 0; i < 14 && !slot; i += 1) {
    const a = await request(
      `/api/availability?date=${encodeURIComponent(date)}&durationMinutes=${DURATION}&lat=${LAT}&lng=${LNG}`,
    );
    if (!a.response.ok || a.body.ok !== true) throw new Error(`availability_failed:${a.response.status}:${a.body.reason ?? ''}`);
    if (a.body.enabled !== true) throw new Error(`booking_disabled:${a.body.reason ?? ''}`);
    slot = a.body.slots?.[0] ?? null;
    if (!slot) date = addDays(date, 1);
  }
  if (!slot) throw new Error('no_available_test_slot');

  const reference = `TEST-BOOKING-${crypto.randomUUID().slice(0, 8)}`;
  const hold = await request('/api/booking-hold', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      date,
      start: slot.start,
      end: slot.end,
      durationMinutes: DURATION,
      destination: { lat: LAT, lng: LNG },
      location: LOCATION,
      reference,
    }),
  });
  if (!hold.response.ok || hold.body.ok !== true) throw new Error(`hold_failed:${hold.response.status}:${hold.body.error ?? ''}`);
  holdId = hold.body.holdId;
  output.write(`Availability: PASS (${date}, ${slot.startLabel}–${slot.endLabel} Central)\nHold: PASS\n`);

  const confirm = await request('/api/booking-admin', {
    method: 'POST',
    headers: { Authorization: `Bearer ${ownerToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: holdId, action: 'confirm' }),
  });
  if (!confirm.response.ok || confirm.body.ok !== true || !confirm.body.eventId) {
    throw new Error(`confirm_failed:${confirm.response.status}:${confirm.body.error ?? ''}`);
  }
  confirmed = true;
  output.write(`Owner confirmation: PASS (event ${confirm.body.eventId})\n`);

  const inspect = await request(`/api/booking-admin?id=${encodeURIComponent(holdId)}`, {
    headers: { Authorization: `Bearer ${ownerToken}` },
  });
  if (!inspect.response.ok || !inspect.body.calendarEvent) throw new Error('event_verification_failed');
  output.write(
    `Google Calendar event: PASS (${inspect.body.calendarEvent.start ?? 'start?'} to ${inspect.body.calendarEvent.end ?? 'end?'})\n`,
  );

  const afterConfirm = await request(
    `/api/availability?date=${encodeURIComponent(date)}&durationMinutes=${DURATION}&lat=${LAT}&lng=${LNG}`,
  );
  const stillOffered = (afterConfirm.body.slots ?? []).some(
    (s) => s.start === slot.start && s.end === slot.end,
  );
  output.write(`Conflicting availability: ${stillOffered ? 'FAIL (still offered)' : 'PASS (slot removed)'}\n`);

  const cancel = await request('/api/booking-admin', {
    method: 'POST',
    headers: { Authorization: `Bearer ${ownerToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: holdId, action: 'cancel' }),
  });
  if (!cancel.response.ok || cancel.body.ok !== true) throw new Error(`cancel_failed:${cancel.response.status}:${cancel.body.error ?? ''}`);
  confirmed = false;
  output.write('Cancellation: PASS\n');

  await new Promise((resolve) => setTimeout(resolve, 2000));
  const afterCancel = await request(
    `/api/availability?date=${encodeURIComponent(date)}&durationMinutes=${DURATION}&lat=${LAT}&lng=${LNG}`,
  );
  const restored = (afterCancel.body.slots ?? []).some(
    (s) => s.start === slot.start && s.end === slot.end,
  );
  output.write(`Availability restored: ${restored ? 'PASS' : 'FAIL (check after Google propagation)'}\n`);
  output.write(`Cleanup: PASS (test event canceled; reference ${reference})\n`);
} catch (error) {
  output.write(`LIVE TEST FAILED: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
} finally {
  if (rl) rl.close();
  if (confirmed && holdId && ownerToken) {
    try {
      const cleanup = await request('/api/booking-admin', {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: holdId, action: 'cancel' }),
      });
      output.write(`Emergency cleanup: ${cleanup.response.ok ? 'PASS' : 'FAIL'}\n`);
    } catch {
      output.write('Emergency cleanup: FAIL — inspect Google Calendar manually.\n');
    }
  }
}
