export {};

interface EmployeeActor {
  id: string;
  name: string;
  role: string;
}

interface LocationPayload {
  lat?: number;
  lng?: number;
  accuracy?: number;
  status: 'captured' | 'denied' | 'unavailable';
  deviceTime: string;
}

let csrf = '';
let actor: EmployeeActor | null = null;
let resetToken = '';
let inviteToken = '';
let mfaChallenge = '';
let currentJobs: Array<Record<string, unknown>> = [];

const gate = document.querySelector<HTMLElement>('[data-employee-gate]');
const app = document.querySelector<HTMLElement>('[data-employee-app]');
const gateStatus = document.querySelector<HTMLElement>('[data-employee-gate-status]');
const loginForm = document.querySelector<HTMLFormElement>('[data-employee-login]');
const forgotForm = document.querySelector<HTMLFormElement>('[data-employee-forgot]');
const forgotStatus = document.querySelector<HTMLElement>('[data-employee-forgot-status]');
const resetForm = document.querySelector<HTMLFormElement>('[data-employee-reset]');
const resetStatus = document.querySelector<HTMLElement>('[data-employee-reset-status]');
const mfaForm = document.querySelector<HTMLFormElement>('[data-employee-mfa]');
const inviteForm = document.querySelector<HTMLFormElement>('[data-employee-invite]');
const inviteStatus = document.querySelector<HTMLElement>('[data-employee-invite-status]');
const clockStatus = document.querySelector<HTMLElement>('[data-employee-clock-status]');
const locationNote = document.querySelector<HTMLElement>('[data-employee-location-note]');

function esc(value: unknown): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function timeFormat(value: unknown, withZone = false): string {
  const date = new Date(String(value ?? ''));
  if (!Number.isFinite(date.getTime())) return '—';
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    ...(withZone ? { timeZoneName: 'short' as const } : {}),
  }).format(date);
}

function shortTime(value: unknown): string {
  const date = new Date(String(value ?? ''));
  if (!Number.isFinite(date.getTime())) return '—';
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

function setStatus(node: HTMLElement | null, message: string, state: 'info' | 'error' | 'success' = 'info'): void {
  if (!node) return;
  node.textContent = message;
  node.dataset.state = state;
}

function friendly(error: unknown): string {
  const code = error instanceof Error ? error.message : 'request_failed';
  const messages: Record<string, string> = {
    credentials_invalid: 'Email or password is incorrect.',
    rate_limited: 'Too many attempts. Wait a few minutes and try again.',
    mfa_invalid: 'That authenticator or recovery code is invalid.',
    reset_invalid: 'This reset link is invalid, expired or already used. Request a new one.',
    already_clocked_in: 'You are already clocked in.',
    not_clocked_in: 'You are not clocked in.',
    invalid_state: 'That action does not match your current clock state.',
    employee_profile_missing: 'Your account is not linked to a team-member profile yet. Ask the owner or manager.',
    employee_profile_inactive: 'Your employee profile is inactive. Ask the owner or manager.',
    job_not_assigned: 'That job is not assigned to you.',
    solo_rate_not_allowed: 'The solo rate applies only to a job assigned to one cleaner.',
    unauthorized: 'Your session expired. Sign in again.',
    csrf_failed: 'Your security token expired. Refresh and sign in again.',
    message_required: 'Describe the correction you need.',
  };
  return messages[code] ?? code.replaceAll('_', ' ');
}

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('Accept', 'application/json');
  if (init.body) headers.set('Content-Type', 'application/json');
  if (csrf && init.method && init.method !== 'GET') headers.set('X-CSRF-Token', csrf);
  const response = await fetch(path, { ...init, headers, credentials: 'same-origin' });
  const data = (await response.json().catch(() => ({}))) as T & { ok?: boolean; error?: string };
  if (!response.ok || data.ok === false) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

function showGate(mode: 'login' | 'forgot' | 'reset' | 'mfa' | 'invite'): void {
  if (gate) gate.hidden = false;
  if (app) app.hidden = true;
  for (const [form, visible] of [
    [loginForm, mode === 'login'],
    [forgotForm, mode === 'forgot'],
    [resetForm, mode === 'reset'],
    [mfaForm, mode === 'mfa'],
    [inviteForm, mode === 'invite'],
  ] as Array<[HTMLFormElement | null, boolean]>) {
    if (form) form.hidden = !visible;
  }
  if (gateStatus) {
    gateStatus.textContent = {
      login: 'Sign in to see your schedule and timeclock.',
      forgot: 'Request a single-use password reset link.',
      reset: 'Choose a new password.',
      mfa: 'Enter your second factor.',
      invite: 'Create your employee account.',
    }[mode];
  }
}

async function loadAuth(): Promise<void> {
  const params = new URLSearchParams(window.location.search);
  resetToken = params.get('reset') ?? '';
  inviteToken = params.get('invite') ?? '';
  if (inviteToken) {
    window.history.replaceState({}, '', '/employee/');
    showGate('invite');
    return;
  }
  if (resetToken) {
    window.history.replaceState({}, '', '/employee/');
    showGate('reset');
    try {
      const check = await api<{ valid?: boolean }>('/api/admin/auth', {
        method: 'POST',
        body: JSON.stringify({ action: 'reset_check', token: resetToken }),
      });
      if (!check.valid) {
        resetToken = '';
        showGate('forgot');
        setStatus(forgotStatus, 'This reset link is invalid or expired. Request a new one.', 'error');
      }
    } catch {
      // Allow the attempt; the reset endpoint will reject an invalid token.
    }
    return;
  }
  try {
    const data = await api<{ setupRequired?: boolean; authenticated?: boolean; actor?: EmployeeActor; csrf?: string }>(
      '/api/admin/auth',
    );
    csrf = data.csrf ?? '';
    if (data.setupRequired) {
      showGate('login');
      if (gateStatus) gateStatus.textContent = 'Ask the owner to create your employee account.';
      return;
    }
    if (data.authenticated && data.actor) {
      actor = data.actor;
      await showApp();
      return;
    }
    showGate('login');
  } catch (error) {
    showGate('login');
    if (gateStatus) gateStatus.textContent = friendly(error);
  }
}

async function showApp(): Promise<void> {
  if (!actor) return;
  if (!['cleaner', 'manager', 'owner'].includes(actor.role)) {
    showGate('login');
    if (gateStatus) gateStatus.textContent = 'This portal is for cleaning staff accounts.';
    return;
  }
  if (gate) gate.hidden = true;
  if (app) app.hidden = false;
  const name = document.querySelector<HTMLElement>('[data-employee-name]');
  if (name) name.textContent = actor.name;
  await loadMe();
}

async function loadMe(): Promise<void> {
  try {
    const data = await api<Record<string, unknown>>('/api/employee/me');
    const profile = (data.profile ?? {}) as Record<string, unknown>;
    const clock = (data.clock ?? {}) as Record<string, unknown>;
    const today = (data.today ?? {}) as Record<string, unknown>;
    const week = (data.week ?? {}) as Record<string, unknown>;
    currentJobs = (data.jobs as Array<Record<string, unknown>>) ?? [];

    const state = String(clock.state ?? 'out');
    const stateEl = document.querySelector<HTMLElement>('[data-employee-clock-state]');
    if (stateEl) {
      stateEl.dataset.state = state;
      stateEl.textContent =
        state === 'work' ? 'Clocked in' : state === 'break' ? 'On break' : state === 'meal' ? 'On meal' : 'Clocked out';
    }
    const since = document.querySelector<HTMLElement>('[data-employee-clock-time]');
    if (since) since.textContent = clock.since ? `Since ${shortTime(clock.since)}` : 'Ready when you are';
    const note = document.querySelector<HTMLElement>('[data-employee-clock-note]');
    if (note) {
      note.textContent =
        state === 'out'
          ? 'Clock in when you arrive at your assigned job.'
          : state === 'break'
            ? 'Short rest breaks are paid. End the break when you return to work.'
            : state === 'meal'
              ? 'Meal periods are unpaid unless you work through them; a manager can correct the timecard.'
              : 'Your paid work time is running.';
    }
    document.querySelector<HTMLElement>('[data-employee-today]')!.textContent = String(today.workLabel ?? '0h 00m');
    document.querySelector<HTMLElement>('[data-employee-week]')!.textContent = String(week.workLabel ?? '0h 00m');
    document.querySelector<HTMLElement>('[data-employee-overtime]')!.textContent = String(week.overtimeLabel ?? '0h 00m');
    document.querySelector<HTMLElement>('[data-employee-gross]')!.textContent = String(week.grossLabel ?? '$0.00');

    for (const button of document.querySelectorAll<HTMLButtonElement>('[data-employee-action]')) {
      const action = button.dataset.employeeAction ?? '';
      button.disabled =
        state === 'out'
          ? action !== 'clock_in'
          : action === 'clock_in'
            ? true
            : action === 'start_break' || action === 'start_meal'
              ? state !== 'work'
              : action === 'end_break'
                ? state !== 'break'
                : action === 'end_meal'
                  ? state !== 'meal'
                  : false;
    }
    const rate = String(profile.defaultRateType ?? 'regular');
    const rateSelect = document.querySelector<HTMLSelectElement>('[data-employee-rate]');
    if (rateSelect) rateSelect.value = rate;
    renderJobOptions(state);
    renderJobs();
    await loadTime();
  } catch (error) {
    if (String((error as Error).message) === 'employee_profile_missing' || String((error as Error).message) === 'employee_profile_inactive') {
      if (gate) gate.hidden = false;
      if (app) app.hidden = true;
      if (gateStatus) gateStatus.textContent = friendly(error);
      return;
    }
    setStatus(clockStatus, friendly(error), 'error');
  }
}

function renderJobOptions(state: string): void {
  const select = document.querySelector<HTMLSelectElement>('[data-employee-job]');
  if (!select) return;
  const current = select.value;
  select.innerHTML = '<option value="">No specific job</option>';
  for (const job of currentJobs) {
    const option = document.createElement('option');
    option.value = String(job.id);
    option.textContent = `${shortTime(job.startAt)} · ${String(job.service ?? 'Cleaning')} · ${String(job.address ?? '')}`;
    select.append(option);
  }
  if (current) select.value = current;
  const rate = document.querySelector<HTMLSelectElement>('[data-employee-rate]');
  const solo = rate?.querySelector<HTMLOptionElement>('option[value="solo"]');
  const selected = currentJobs.find((job) => job.id === select.value);
  const crew = Number(selected?.crewSize) || 1;
  const crewNames = Array.isArray(selected?.crew) ? (selected.crew as unknown[]).length : 1;
  if (solo) solo.disabled = state !== 'out' || !selected || crew !== 1 || crewNames > 1;
}

function renderJobs(): void {
  const target = document.querySelector<HTMLElement>('[data-employee-jobs]');
  if (!target) return;
  if (currentJobs.length === 0) {
    target.innerHTML = '<p class="employee-muted">No assigned jobs in the next three days.</p>';
    return;
  }
  target.innerHTML = currentJobs
    .map((job) => {
      const items = ((job.checklist as Record<string, unknown> | null)?.items as Array<Record<string, unknown>>) ?? [];
      return `<div class="employee-job">
        <p class="employee-job__time">${esc(timeFormat(job.startAt))} – ${esc(shortTime(job.endAt))}</p>
        <p class="employee-job__address">${esc(job.address || 'Address not recorded')}</p>
        <p class="employee-job__meta">${esc(job.service)} · ${esc(job.durationMinutes)} minutes · ${esc(String(job.status))}</p>
        ${job.customerFirstName ? `<p class="employee-job__meta">Customer: ${esc(job.customerFirstName)}</p>` : ''}
        ${Array.isArray(job.crew) && (job.crew as unknown[]).length ? `<p class="employee-job__crew">Crew: ${(job.crew as unknown[]).map(esc).join(', ')}</p>` : ''}
        ${job.instructions ? `<p class="employee-job__notes">${esc(job.instructions)}</p>` : ''}
        ${items.length ? `<ul class="employee-checklist">${items.map((item) => `<li>${item.completed ? '✓' : '○'} ${esc(item.label)}</li>`).join('')}</ul>` : ''}
      </div>`;
    })
    .join('');
}

async function loadTime(): Promise<void> {
  try {
    const data = await api<Record<string, unknown>>('/api/employee/time');
    const target = document.querySelector<HTMLElement>('[data-employee-time]');
    const intervals = (data.intervals as Array<Record<string, unknown>>) ?? [];
    const options = document.querySelector<HTMLSelectElement>('[data-employee-interval-options]');
    if (target) {
      target.innerHTML = intervals.length
        ? `<div class="employee-table">${intervals
            .map(
              (interval) =>
                `<p class="employee-muted">${esc(timeFormat(interval.started_at))} – ${esc(interval.ended_at ? shortTime(interval.ended_at) : 'open')} · ${esc(interval.kind)}${interval.status === 'corrected' ? ' · corrected' : ''}</p>`,
            )
            .join('')}</div>`
        : '<p class="employee-muted">No time recorded this week yet.</p>';
    }
    if (options) {
      options.innerHTML = '<option value="">General correction</option>';
      for (const interval of intervals) {
        const option = document.createElement('option');
        option.value = String(interval.id);
        option.textContent = `${timeFormat(interval.started_at)} · ${String(interval.kind)}`;
        options.append(option);
      }
    }
  } catch {
    // Time history is secondary; the clock still works.
  }
}

function locationPayload(): Promise<LocationPayload> {
  const deviceTime = new Date().toISOString();
  if (!('geolocation' in navigator)) return Promise.resolve({ status: 'unavailable', deviceTime });
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (position) =>
        resolve({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          accuracy: position.coords.accuracy,
          status: 'captured',
          deviceTime,
        }),
      (error) => resolve({ status: error.code === 1 || error.code === error.PERMISSION_DENIED ? 'denied' : 'unavailable', deviceTime }),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 },
    );
  });
}

async function clock(action: string): Promise<void> {
  setStatus(clockStatus, 'Recording…');
  const location = await locationPayload();
  if (locationNote) {
    locationNote.hidden = location.status !== 'denied';
    locationNote.textContent =
      location.status === 'denied'
        ? 'Location permission was denied. Your time is still recorded; a manager may review the event.'
        : '';
  }
  const job = document.querySelector<HTMLSelectElement>('[data-employee-job]')?.value ?? '';
  const rate = document.querySelector<HTMLSelectElement>('[data-employee-rate]')?.value ?? 'regular';
  try {
    await api('/api/employee/clock', {
      method: 'POST',
      body: JSON.stringify({ action, appointmentId: job || undefined, rateType: rate, location }),
    });
    setStatus(clockStatus, action === 'clock_in' ? 'Clocked in.' : 'Time recorded.', 'success');
    await loadMe();
  } catch (error) {
    setStatus(clockStatus, friendly(error), 'error');
  }
}

loginForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  setStatus(gateStatus as HTMLElement, '');
  const data = new FormData(loginForm);
  try {
    const result = await api<{ actor?: EmployeeActor; csrf?: string; mfaRequired?: boolean; challengeToken?: string }>(
      '/api/admin/auth',
      {
        method: 'POST',
        body: JSON.stringify({ action: 'login', email: data.get('email'), password: data.get('password') }),
      },
    );
    if (result.mfaRequired && result.challengeToken) {
      mfaChallenge = result.challengeToken;
      showGate('mfa');
      return;
    }
    csrf = result.csrf ?? '';
    actor = result.actor ?? null;
    await showApp();
  } catch (error) {
    setStatus(gateStatus as HTMLElement, friendly(error), 'error');
  }
});

mfaForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const data = new FormData(mfaForm);
  try {
    const result = await api<{ actor?: EmployeeActor; csrf?: string }>('/api/admin/auth', {
      method: 'POST',
      body: JSON.stringify({
        action: 'mfa_verify',
        challengeToken: mfaChallenge,
        code: data.get('code'),
        recoveryCode: data.get('recoveryCode'),
      }),
    });
    csrf = result.csrf ?? '';
    actor = result.actor ?? null;
    await showApp();
  } catch (error) {
    setStatus(gateStatus as HTMLElement, friendly(error), 'error');
  }
});

document.querySelector<HTMLButtonElement>('[data-employee-show-forgot]')?.addEventListener('click', () => {
  showGate('forgot');
  const email = loginForm?.querySelector<HTMLInputElement>('input[name="email"]')?.value;
  const target = forgotForm?.querySelector<HTMLInputElement>('input[name="email"]');
  if (target && email) target.value = email;
});
document.querySelector<HTMLButtonElement>('[data-employee-back]')?.addEventListener('click', () => showGate('login'));

forgotForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const data = new FormData(forgotForm);
  setStatus(forgotStatus, 'Sending…');
  try {
    const result = await api<{ message?: string }>('/api/admin/auth', {
      method: 'POST',
      body: JSON.stringify({ action: 'request_reset', email: data.get('email') }),
    });
    setStatus(forgotStatus, result.message ?? 'If the address is registered, a reset link is on its way.', 'success');
    forgotForm.reset();
  } catch (error) {
    setStatus(forgotStatus, friendly(error), 'error');
  }
});

inviteForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const data = new FormData(inviteForm);
  const password = String(data.get('password') ?? '');
  if (password !== String(data.get('confirmPassword') ?? '')) {
    setStatus(inviteStatus, 'The two passwords do not match.', 'error');
    return;
  }
  if (password.length < 8 || !/[^A-Za-z0-9\s]/.test(password)) {
    setStatus(inviteStatus, 'Use at least 8 characters, including one special character.', 'error');
    return;
  }
  try {
    const result = await api<{ actor?: EmployeeActor; csrf?: string }>('/api/admin/auth', {
      method: 'POST',
      body: JSON.stringify({ action: 'accept_invite', token: inviteToken, name: data.get('name'), password }),
    });
    inviteToken = '';
    csrf = result.csrf ?? '';
    actor = result.actor ?? null;
    await showApp();
  } catch (error) {
    setStatus(inviteStatus, friendly(error), 'error');
  }
});

resetForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const data = new FormData(resetForm);
  const password = String(data.get('password') ?? '');
  if (password !== String(data.get('confirmPassword') ?? '')) {
    setStatus(resetStatus, 'The two passwords do not match.', 'error');
    return;
  }
  try {
    await api('/api/admin/auth', {
      method: 'POST',
      body: JSON.stringify({ action: 'reset_password', token: resetToken, password }),
    });
    resetToken = '';
    showGate('login');
    setStatus(gateStatus as HTMLElement, 'Password updated. Sign in with your new password.', 'success');
  } catch (error) {
    setStatus(resetStatus, friendly(error), 'error');
  }
});

for (const button of document.querySelectorAll<HTMLButtonElement>('[data-employee-action]')) {
  button.addEventListener('click', () => void clock(button.dataset.employeeAction ?? ''));
}

document.querySelector<HTMLSelectElement>('[data-employee-job]')?.addEventListener('change', () => {
  const state = document.querySelector<HTMLElement>('[data-employee-clock-state]')?.dataset.state ?? 'out';
  renderJobOptions(state);
});

document.querySelector<HTMLFormElement>('[data-employee-correction]')?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const data = new FormData(event.currentTarget as HTMLFormElement);
  const status = document.querySelector<HTMLElement>('[data-employee-correction-status]');
  setStatus(status, 'Sending…');
  try {
    await api('/api/employee/correction', {
      method: 'POST',
      body: JSON.stringify({ intervalId: data.get('intervalId'), message: data.get('message') }),
    });
    setStatus(status, 'Correction request sent for review.', 'success');
    (event.currentTarget as HTMLFormElement).reset();
  } catch (error) {
    setStatus(status, friendly(error), 'error');
  }
});

document.querySelector<HTMLButtonElement>('[data-employee-logout]')?.addEventListener('click', async () => {
  try {
    await api('/api/admin/auth', { method: 'POST', body: JSON.stringify({ action: 'logout' }) });
  } finally {
    csrf = '';
    actor = null;
    showGate('login');
  }
});

void loadAuth();
