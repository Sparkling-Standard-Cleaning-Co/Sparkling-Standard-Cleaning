import {
  passwordConfirmationMessage,
  passwordConfirmationProblem,
  passwordPolicyMessage,
  passwordProblem,
} from '../lib/password-policy.ts';

interface AdminActor {
  id: string;
  email: string;
  name: string;
  role: string;
  branchId: string | null;
  permissions: string[];
  mfaEnabled: boolean;
}

type GateMode = 'setup' | 'login' | 'forgot' | 'mfa' | 'invite' | 'reset';

const gate = document.querySelector<HTMLElement>('[data-admin-gate]');
const app = document.querySelector<HTMLElement>('[data-admin-app]');
const setupForm = document.querySelector<HTMLFormElement>('[data-admin-setup]');
const loginForm = document.querySelector<HTMLFormElement>('[data-admin-login]');
const forgotForm = document.querySelector<HTMLFormElement>('[data-admin-forgot-form]');
const forgotStatus = document.querySelector<HTMLElement>('[data-admin-forgot-status]');
const resetStatus = document.querySelector<HTMLElement>('[data-admin-reset-status]');
const successEl = document.querySelector<HTMLElement>('[data-admin-success]');
const mfaForm = document.querySelector<HTMLFormElement>('[data-admin-mfa]');
const inviteForm = document.querySelector<HTMLFormElement>('[data-admin-invite]');
const resetForm = document.querySelector<HTMLFormElement>('[data-admin-reset]');
const passwordChangeForm = document.querySelector<HTMLFormElement>('[data-admin-password-change]');
const gateStatus = document.querySelector<HTMLElement>('[data-admin-gate-status]');
const errorEl = document.querySelector<HTMLElement>('[data-admin-error]');
const appError = document.querySelector<HTMLElement>('[data-admin-app-error]');
const userEl = document.querySelector<HTMLElement>('[data-admin-user]');
const roleEl = document.querySelector<HTMLElement>('[data-admin-role]');
const titleEl = document.querySelector<HTMLElement>('[data-admin-view-title]');
const subEl = document.querySelector<HTMLElement>('[data-admin-view-sub]');
const navButtons = [...document.querySelectorAll<HTMLButtonElement>('[data-admin-nav]')];
const views = [...document.querySelectorAll<HTMLElement>('[data-admin-view]')];

let csrf = '';
let actor: AdminActor | null = null;
let mfaChallenge = '';
let currentView = 'overview';
let inviteToken = '';
let resetToken = '';

const viewMeta: Record<string, [string, string]> = {
  overview: ['Overview', 'Live cleaning-company operations.'],
  calendar: ['Calendar & Requests', 'Pending reservations and upcoming appointments.'],
  leads: ['Leads & Inquiries', 'Website inquiries, delivery status and follow-up.'],
  customers: ['Customers', 'Customer profiles, properties and history.'],
  recurring: ['Recurring Plans', 'Recurring cleaning administration.'],
  jobs: ['Jobs & Team', 'Cleaning jobs, assignments and checklists.'],
  timekeeping: ['Timekeeping', 'Employee hours, corrections and location verification.'],
  finance: ['Invoices & Payments', 'Invoicing, payments, credits and reconciliation.'],
  gift: ['Gift Certificates', 'Existing production gift register.'],
  reports: ['Reports', 'Operational and financial reporting.'],
  settings: ['Settings & Audit', 'Access, security, configuration and audit history.'],
};

const navPermission: Record<string, string> = {
  calendar: 'booking.read',
  leads: 'lead.read',
  customers: 'customer.read',
  recurring: 'job.read',
  jobs: 'job.read',
  timekeeping: 'job.write',
  finance: 'finance.read',
  gift: 'finance.read',
  reports: 'finance.read',
};

function esc(value: unknown): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function money(cents: unknown): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(cents ?? 0) / 100);
}

function dateTime(value: unknown): string {
  const raw = String(value ?? '');
  if (!raw) return '—';
  const parsed = new Date(raw.includes('T') ? raw : `${raw}T12:00:00`);
  if (!Number.isFinite(parsed.getTime())) return raw;
  return new Intl.DateTimeFormat('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    ...(raw.includes('T') ? { hour: 'numeric', minute: '2-digit' } : {}),
  }).format(parsed);
}

function titleCase(value: unknown): string {
  return String(value ?? '').replaceAll('_', ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function setError(message = ''): void {
  if (errorEl) errorEl.textContent = message;
}

function setSuccess(message = ''): void {
  if (successEl) successEl.textContent = message;
}

function setStatusMessage(node: HTMLElement | null, message = ''): void {
  if (node) node.textContent = message;
}

function setAppError(message = ''): void {
  if (appError) appError.textContent = message;
}

function friendly(error: unknown): string {
  const code = error instanceof Error ? error.message : 'request_failed';
  const messages: Record<string, string> = {
    database_not_configured: 'The operations database is not provisioned yet.',
    unauthorized: 'Your session expired. Sign in again.',
    forbidden: 'You do not have permission for that action.',
    csrf_failed: 'Your security token expired. Refresh and try again.',
    rate_limited: 'Too many attempts. Wait a few minutes and try again.',
    credentials_invalid: 'Email or password is incorrect.',
    mfa_invalid: 'That authenticator or recovery code is invalid.',
    reset_invalid: 'This reset link is invalid, expired or already used. Request a new one.',
    origin_rejected: 'The request came from an unexpected origin. Reload and try again.',
    email_not_configured: 'Email delivery is not configured.',
    password_required: passwordPolicyMessage('password_required'),
    password_too_short: passwordPolicyMessage('password_too_short'),
    password_too_long: passwordPolicyMessage('password_too_long'),
    password_needs_special: passwordPolicyMessage('password_needs_special'),
    password_mismatch: passwordConfirmationMessage('password_mismatch'),
    schedule_conflict: 'That time overlaps an existing booking.',
    team_conflict: 'That team member already has an overlapping job.',
    booking_admin_not_configured: 'The Google Calendar booking connection is not configured.',
    calendar_confirm_failed: 'Google Calendar did not confirm the booking. No D1 appointment was created.',
    reauth_failed: 'Your password could not be verified.',
    stripe_billing_disabled: 'Stripe billing is not enabled for this deployment.',
    stripe_refunds_disabled: 'Stripe refund execution is not enabled for this deployment.',
    saved_cards_disabled: 'Saved-card setup is not enabled for this deployment.',
    off_session_disabled: 'After-service charging is not enabled for this deployment.',
    authorization_amount_exceeded: 'The invoice exceeds the signed maximum authorization.',
    valid_authorization_not_found: 'No active signed authorization covers this invoice.',
    authorization_not_for_after_service: 'This authorization is not approved for after-service charging.',
    authorization_property_mismatch: 'The signed authorization is for a different property.',
    stripe_not_configured: 'Stripe is not configured.',
    invoice_not_payable: 'This invoice is not payable in its current state.',
    customer_email_required: 'The customer needs an email address for a payment link.',
    reserved: 'This gift is reserved by an active booking.',
    redeemed: 'This gift has already been redeemed.',
    insufficient_balance: 'The redemption exceeds the available gift balance.',
    not_active_yet: 'This gift is not active yet.',
    d1_confirm_failed: 'Calendar confirmed, but the local appointment record failed. Retry safely.',
    contact_in_use: 'That email or phone belongs to another customer.',
  };
  return messages[code] ?? titleCase(code);
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

function showGate(mode: GateMode): void {
  if (gate) gate.hidden = false;
  if (app) app.hidden = true;
  for (const [form, visible] of [
    [setupForm, mode === 'setup'],
    [loginForm, mode === 'login'],
    [forgotForm, mode === 'forgot'],
    [mfaForm, mode === 'mfa'],
    [inviteForm, mode === 'invite'],
    [resetForm, mode === 'reset'],
  ] as Array<[HTMLFormElement | null, boolean]>) {
    if (form) form.hidden = !visible;
  }
  if (gateStatus) {
    gateStatus.textContent = {
      setup: 'First-run owner enrollment.',
      login: 'Sign in to continue.',
      forgot: 'Request a single-use password reset link.',
      mfa: 'Enter your second factor to continue.',
      invite: 'Create your administrator account.',
      reset: 'Choose a new password.',
    }[mode];
  }
}

function can(permission: string): boolean {
  return actor?.role === 'owner' || Boolean(actor?.permissions.includes(permission));
}

function showApp(nextActor: AdminActor): void {
  if (nextActor.role === 'cleaner') {
    // Cleaners use the dedicated mobile employee portal, not the owner console.
    window.location.replace('/employee/');
    return;
  }
  actor = nextActor;
  if (gate) gate.hidden = true;
  if (app) app.hidden = false;
  setError();
  setAppError();
  if (userEl) userEl.textContent = `${nextActor.name} · ${nextActor.role}`;
  if (roleEl) roleEl.textContent = nextActor.role;
  for (const button of navButtons) {
    const permission = navPermission[button.dataset.adminNav ?? ''];
    button.hidden = Boolean(permission && !can(permission));
  }
  for (const element of document.querySelectorAll<HTMLElement>('[data-admin-customer-new]')) {
    element.hidden = !can('customer.write');
  }
  for (const element of document.querySelectorAll<HTMLElement>('[data-admin-recurring-create], [data-admin-team-create]')) {
    element.hidden = !can('job.write');
  }
  for (const element of document.querySelectorAll<HTMLElement>('[data-admin-invoice-create]')) {
    element.hidden = !can('finance.write');
  }
  for (const element of document.querySelectorAll<HTMLElement>('[data-admin-invite-create], [data-admin-owner-section]')) {
    element.hidden = !can('admin.manage');
  }
  void loadView('overview');
}

function applySession(data: { actor?: AdminActor; csrf?: string }): boolean {
  csrf = data.csrf ?? '';
  if (!data.actor) return false;
  showApp(data.actor);
  return true;
}

async function loadAuth(): Promise<void> {
  const params = new URLSearchParams(window.location.search);
  inviteToken = params.get('invite') ?? '';
  resetToken = params.get('reset') ?? '';
  if (inviteToken || resetToken) {
    // Remove the one-time secret from the address bar and session history.
    window.history.replaceState({}, '', '/admin/');
  }
  if (inviteToken) return showGate('invite');
  if (resetToken) {
    showGate('reset');
    try {
      const data = await api<{ valid?: boolean }>('/api/admin/auth', {
        method: 'POST',
        body: JSON.stringify({ action: 'reset_check', token: resetToken }),
      });
      if (!data.valid) {
        resetToken = '';
        setError('This reset link is invalid, expired or already used. Request a new one below.');
        showGate('forgot');
        setStatusMessage(forgotStatus, 'Enter your account email to receive a fresh single-use link.');
        return;
      }
      if (gateStatus) gateStatus.textContent = 'Choose a new password. This link works once and expires soon.';
    } catch {
      if (gateStatus) gateStatus.textContent = 'Choose a new password.';
    }
    return;
  }
  try {
    const data = await api<{ setupRequired?: boolean; authenticated?: boolean; actor?: AdminActor; csrf?: string }>(
      '/api/admin/auth',
    );
    csrf = data.csrf ?? '';
    if (data.setupRequired) return showGate('setup');
    if (data.authenticated && data.actor) return showApp(data.actor);
    showGate('login');
  } catch (error) {
    if (gateStatus) gateStatus.textContent = friendly(error);
  }
}

function renderEmpty(container: HTMLElement, text: string): void {
  container.innerHTML = `<div class="admin-empty">${esc(text)}</div>`;
}

function renderTable(container: HTMLElement, columns: string[], rows: unknown[][], empty: string): void {
  if (rows.length === 0) return renderEmpty(container, empty);
  const head = columns.map((column) => `<th>${esc(column)}</th>`).join('');
  const body = rows.map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join('')}</tr>`).join('');
  container.innerHTML = `<div class="admin-table-scroll"><table class="admin-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}

function leadDetails(value: unknown): string {
  if (!value || typeof value !== 'object') return '';
  return Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined && item !== null && String(item).trim() !== '')
    .slice(0, 16)
    .map(([key, item]) => `<dt>${esc(titleCase(key))}</dt><dd>${esc(String(item))}</dd>`)
    .join('');
}

async function loadOverview(): Promise<void> {
  const data = await api<{ counts?: Record<string, number>; recentLeads?: Array<Record<string, unknown>> }>('/api/admin/overview');
  const counts = data.counts ?? {};
  const kpis = document.querySelector<HTMLElement>('[data-admin-kpis]');
  if (kpis) {
    kpis.innerHTML = [
      ['Customers', counts.customers ?? 0],
      ['Open leads', counts.leads ?? 0],
      ['Pending requests', counts.requests ?? 0],
      ['Upcoming appointments', counts.upcomingAppointments ?? 0],
      ['Active gifts', counts.activeGifts ?? 0],
      ['Lead delivery failures', counts.failedLeadDeliveries ?? 0],
    ].map(([label, value]) => `<div class="admin-card admin-kpi"><p class="admin-kpi__label">${esc(label)}</p><p class="admin-kpi__value">${esc(value)}</p></div>`).join('');
  }
  const recent = document.querySelector<HTMLElement>('[data-admin-recent]');
  if (recent) {
    renderTable(recent, ['Date', 'Type', 'Customer', 'Email', 'Status', 'Reference'], (data.recentLeads ?? []).map((lead) => [
      esc(dateTime(lead.created_at)),
      esc(lead.request_type),
      esc([lead.first_name, lead.last_name].filter(Boolean).join(' ') || 'Unlinked lead'),
      esc(lead.email),
      `<span class="admin-status">${esc(lead.status)}</span>`,
      esc(lead.quote_reference),
    ]), 'No inquiries have been persisted yet.');
  }
}

function centralDateKey(value: unknown): string {
  const date = new Date(String(value ?? ''));
  if (!Number.isFinite(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Chicago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function requestLocation(request: Record<string, unknown>): string {
  const joined = [request.line1, request.city].filter(Boolean).join(', ');
  if (joined) return joined;
  try {
    const payload = JSON.parse(String(request.payload_json ?? '{}')) as Record<string, unknown>;
    return String(payload.locationText ?? payload.location_text ?? 'Legacy request — address not linked');
  } catch {
    return 'Legacy request — address not linked';
  }
}

function renderWeekBoard(appointments: Array<Record<string, unknown>>): void {
  const target = document.querySelector<HTMLElement>('[data-admin-week-board]');
  if (!target) return;
  const byDay = new Map<string, Array<Record<string, unknown>>>();
  for (const appointment of appointments) {
    if (['cancelled', 'no_show'].includes(String(appointment.status))) continue;
    const key = centralDateKey(appointment.start_at);
    if (!key) continue;
    const list = byDay.get(key) ?? [];
    list.push(appointment);
    byDay.set(key, list);
  }
  const days: string[] = [];
  for (let offset = 0; offset < 7; offset += 1) {
    const day = new Date(Date.now() + offset * 86_400_000);
    days.push(centralDateKey(day));
  }
  target.innerHTML = `<div class="admin-table-scroll"><table class="admin-table"><thead><tr><th>Day</th><th>Jobs</th><th>Crew</th><th>First appointment</th><th>Latest</th></tr></thead><tbody>${days
    .map((day) => {
      const jobs = (byDay.get(day) ?? []).sort((a, b) => String(a.start_at).localeCompare(String(b.start_at)));
      const crew = jobs.reduce((total, job) => total + (Number(job.crew_size) || 1), 0);
      const first = jobs[0];
      const last = jobs[jobs.length - 1];
      return `<tr><td>${esc(dateTime(day))}</td><td>${jobs.length}</td><td>${crew}</td><td>${first ? `${esc(dateTime(first.start_at))} · ${esc(first.reference)}` : '—'}</td><td>${last ? esc(dateTime(last.start_at)) : '—'}</td></tr>`;
    })
    .join('')}</tbody></table></div>`;
}

async function loadCalendar(): Promise<void> {
  const data = await api<{ requests?: Array<Record<string, unknown>>; appointments?: Array<Record<string, unknown>> }>('/api/admin/requests');
  const requests = document.querySelector<HTMLElement>('[data-admin-requests]');
  if (requests) {
    renderTable(requests, ['Start', 'Reference', 'Customer', 'Property', 'Status', 'Action'], (data.requests ?? []).map((request) => [
      esc(dateTime(request.start_at)),
      esc(request.quote_reference),
      esc([request.first_name, request.last_name].filter(Boolean).join(' ') || 'Unlinked request'),
      esc(requestLocation(request)),
      `<span class="admin-status">${esc(request.status)}</span>`,
      `<button class="btn btn--ghost btn--small" type="button" data-admin-action="request-open" data-id="${esc(request.id)}">Open</button>`,
    ]), 'No reservation requests are waiting.');
  }
  renderWeekBoard(data.appointments ?? []);
  const appointments = document.querySelector<HTMLElement>('[data-admin-appointments]');
  if (appointments) {
    renderTable(appointments, ['Start', 'Reference', 'Customer', 'Property', 'Crew', 'Status'], (data.appointments ?? []).map((appointment) => [
      esc(dateTime(appointment.start_at)),
      esc(appointment.reference),
      esc([appointment.first_name, appointment.last_name].filter(Boolean).join(' ')),
      esc([appointment.line1, appointment.city].filter(Boolean).join(', ')),
      esc(appointment.crew_size),
      `<span class="admin-status">${esc(appointment.status)}</span>`,
    ]), 'No appointments are recorded yet.');
  }
}

function payloadSummary(payload: Record<string, unknown>): string {
  const keys = [
    'serviceType',
    'service_label',
    'frequency',
    'condition',
    'addonIds',
    'addons',
    'squareFeet',
    'bedrooms',
    'fullBaths',
    'halfBaths',
    'beds',
    'price',
    'expectedPrice',
    'total',
    'notes',
    'special_instructions',
    'access_notes',
    'quote_reference',
  ];
  const rows = keys
    .filter((key) => payload[key] !== undefined && payload[key] !== null && String(payload[key]).trim() !== '')
    .map((key) => `<dt>${esc(titleCase(key))}</dt><dd>${esc(Array.isArray(payload[key]) ? (payload[key] as unknown[]).join(', ') : payload[key])}</dd>`)
    .join('');
  return rows ? `<dl class="admin-definition">${rows}</dl>` : '';
}

async function loadRequestProperties(customerId: string, select: HTMLSelectElement): Promise<void> {
  select.innerHTML = '<option value="">No specific property</option>';
  if (!customerId) return;
  try {
    const data = await api<Record<string, unknown>>(`/api/admin/customers?id=${encodeURIComponent(customerId)}`);
    for (const property of (data.properties as Array<Record<string, unknown>>) ?? []) {
      select.insertAdjacentHTML(
        'beforeend',
        `<option value="${esc(property.id)}">${esc([property.label, property.line1, property.city].filter(Boolean).join(' — '))}</option>`,
      );
    }
  } catch {
    // The customer may have no properties; a request can still be linked.
  }
}

async function openRequest(requestId: string): Promise<void> {
  const target = document.querySelector<HTMLElement>('[data-admin-request-detail]');
  if (!target) return;
  const data = await api<Record<string, unknown>>(`/api/admin/requests?id=${encodeURIComponent(requestId)}`);
  const request = (data.request ?? {}) as Record<string, unknown>;
  const payload = (data.payload ?? {}) as Record<string, unknown>;
  const contacts = (data.contacts as Array<Record<string, unknown>>) ?? [];
  const properties = (data.properties as Array<Record<string, unknown>>) ?? [];
  const notifications = (data.notifications as Array<Record<string, unknown>>) ?? [];
  const auditRows = (data.audit as Array<Record<string, unknown>>) ?? [];
  const duplicates = (data.possibleDuplicates as Array<Record<string, unknown>>) ?? [];
  const linked = Boolean(request.customer_id);
  const status = String(request.status ?? '');
  const pending = status === 'pending';
  const confirmed = Boolean(request.appointment_id);
  const customerName = [request.first_name, request.last_name].filter(Boolean).join(' ') || request.company_name || '';
  const email = String(data.email ?? '');

  let customerOptions = '';
  try {
    const customers = await api<{ customers?: Array<Record<string, unknown>> }>('/api/admin/customers?limit=200');
    customerOptions = (customers.customers ?? [])
      .map((customer) => {
        const label = [customer.first_name, customer.last_name].filter(Boolean).join(' ') || customer.company_name || customer.id;
        return `<option value="${esc(customer.id)}"${customer.id === request.customer_id ? ' selected' : ''}>${esc(label)}${customer.email ? ` — ${esc(customer.email)}` : ''}</option>`;
      })
      .join('');
  } catch {
    customerOptions = '';
  }

  const association = !linked
    ? `<div class="admin-card" style="margin-top:1rem;">
        <h3>Link this request to a customer</h3>
        <p class="admin-muted">No identity is guessed from the address. Link an existing match or create a verified customer record.</p>
        <form class="admin-form admin-form--grid" data-form="request-link">
          <input type="hidden" name="requestId" value="${esc(requestId)}" />
          <label>Existing customer <select name="customerId" data-request-customer required><option value="">Choose a customer</option>${customerOptions}</select></label>
          <label>Property <select name="propertyId" data-request-property><option value="">No specific property</option>${properties.map((property) => `<option value="${esc(property.id)}">${esc([property.label, property.line1, property.city].filter(Boolean).join(' — '))}</option>`).join('')}</select></label>
          <button class="btn btn--secondary btn--small" type="submit">Link Customer</button>
        </form>
        <details class="admin-detail-toggle" style="margin-top:1rem;"><summary>Create a new customer</summary>
          <form class="admin-form admin-form--grid" data-form="request-create">
            <input type="hidden" name="requestId" value="${esc(requestId)}" />
            <label>First name <input name="firstName" required /></label>
            <label>Last name <input name="lastName" /></label>
            <label>Email <input name="email" type="email" /></label>
            <label>Phone <input name="phone" /></label>
            <label class="admin-field--wide">Service address <input name="addressLine1" value="${esc(String(payload.locationText ?? ''))}" required /></label>
            <label>City <input name="city" value="${esc(String(payload.city ?? ''))}" /></label>
            <label>State <input name="state" maxlength="2" value="FL" /></label>
            <label>ZIP <input name="postalCode" maxlength="10" /></label>
            <button class="btn btn--primary btn--small" type="submit">Create and Link Customer</button>
          </form>
        </details>
      </div>`
    : `<div class="admin-card" style="margin-top:1rem;">
        <h3>Customer</h3>
        <dl class="admin-definition">
          <dt>Name</dt><dd>${esc(customerName || '—')}</dd>
          <dt>Contacts</dt><dd>${contacts.map((contact) => `${esc(titleCase(contact.kind))}: ${esc(contact.value)}`).join('<br />') || '—'}</dd>
          <dt>Property</dt><dd>${esc([request.property_label, request.line1, request.city, request.state, request.postal_code].filter(Boolean).join(', ') || '—')}</dd>
        </dl>
        <details class="admin-detail-toggle"><summary>Change linked customer</summary>
          <form class="admin-form" data-form="request-link">
            <input type="hidden" name="requestId" value="${esc(requestId)}" />
            <label>Customer <select name="customerId" data-request-customer required><option value="">Choose a customer</option>${customerOptions}</select></label>
            <label>Property <select name="propertyId" data-request-property><option value="">No specific property</option>${properties.map((property) => `<option value="${esc(property.id)}">${esc([property.label, property.line1, property.city].filter(Boolean).join(' — '))}</option>`).join('')}</select></label>
            <button class="btn btn--secondary btn--small" type="submit">Update Link</button>
          </form>
        </details>
      </div>`;

  const actions = can('booking.write')
    ? pending
      ? `<div class="admin-card" style="margin-top:1rem;">
          <h3>Actions</h3>
          <p class="admin-muted">Confirmation checks the calendar and creates the appointment before any customer email is sent.</p>
          <form class="admin-form" data-form="request-confirm">
            <input type="hidden" name="requestId" value="${esc(requestId)}" />
            <button class="btn btn--primary btn--small" type="submit">Accept / Confirm Booking</button>
          </form>
          <details class="admin-detail-toggle" style="margin-top:1rem;"><summary>Propose a new time</summary>
            <form class="admin-form" data-form="request-propose">
              <input type="hidden" name="requestId" value="${esc(requestId)}" />
              <label>Start (Central) <input name="start" type="datetime-local" required /></label>
              <label>End (Central) <input name="end" type="datetime-local" required /></label>
              <button class="btn btn--secondary btn--small" type="submit">Propose This Time</button>
            </form>
          </details>
          <details class="admin-detail-toggle" style="margin-top:1rem;"><summary>Decline request</summary>
            <form class="admin-form" data-form="request-decline">
              <input type="hidden" name="requestId" value="${esc(requestId)}" />
              <label>Reason (optional) <input name="reason" maxlength="500" /></label>
              <label><input type="checkbox" name="notify" value="yes"${email ? '' : ' disabled'} /> Email the customer${email ? '' : ' (no email on file)'}</label>
              <button class="btn btn--danger btn--small" type="submit">Decline Request</button>
            </form>
          </details>
        </div>`
      : confirmed
        ? `<div class="admin-card" style="margin-top:1rem;">
            <h3>Confirmed appointment actions</h3>
            <dl class="admin-definition"><dt>Appointment</dt><dd>${esc(request.appointment_reference || '—')} · ${esc(request.appointment_status || '')}</dd><dt>Calendar event</dt><dd>${esc(request.calendar_event_id || 'Not linked')}</dd></dl>
            <details class="admin-detail-toggle"><summary>Reschedule</summary>
              <form class="admin-form" data-form="request-reschedule">
                <input type="hidden" name="requestId" value="${esc(requestId)}" />
                <label>New start (Central) <input name="start" type="datetime-local" required /></label>
                <label>New end (Central) <input name="end" type="datetime-local" required /></label>
                <button class="btn btn--secondary btn--small" type="submit">Reschedule Appointment</button>
              </form>
            </details>
            <details class="admin-detail-toggle" style="margin-top:1rem;"><summary>Cancel appointment</summary>
              <form class="admin-form" data-form="request-cancel">
                <input type="hidden" name="requestId" value="${esc(requestId)}" />
                <label>Reason (optional) <input name="reason" maxlength="500" /></label>
                <label><input type="checkbox" name="notify" value="yes"${email ? '' : ' disabled'} /> Email the customer${email ? '' : ' (no email on file)'}</label>
                <button class="btn btn--danger btn--small" type="submit">Cancel Appointment</button>
              </form>
            </details>
          </div>`
        : ''
    : '';

  const notificationRows = notifications.length
    ? `<div class="admin-table-scroll"><table class="admin-table"><thead><tr><th>When</th><th>Type</th><th>Status</th><th>Detail</th></tr></thead><tbody>${notifications
        .map((notification) => `<tr><td>${esc(dateTime(notification.created_at))}</td><td>${esc(titleCase(notification.kind))}</td><td>${esc(notification.status)}</td><td>${esc(notification.error_detail || '')}</td></tr>`)
        .join('')}</tbody></table></div>`
    : '<p class="admin-muted">No customer emails have been logged for this request.</p>';

  target.hidden = false;
  target.innerHTML = `<div class="admin-card">
    <div class="admin-detail-head">
      <h2 class="admin-section-title">${esc(request.quote_reference || requestId)}</h2>
      <div class="admin-actions">
        <span class="admin-status">${esc(titleCase(status))}</span>
        <button class="btn btn--ghost btn--small" type="button" data-admin-action="request-close">Close</button>
      </div>
    </div>
    ${duplicates.length ? `<div class="admin-warning"><strong>Possible duplicate requests.</strong> ${duplicates.map((duplicate) => `${esc(duplicate.quote_reference)} (${esc(dateTime(duplicate.start_at))})`).join(', ')}. Nothing was merged or deleted. Review before confirming.</div>` : ''}
    <dl class="admin-definition">
      <dt>Requested</dt><dd>${esc(dateTime(request.start_at))} – ${esc(dateTime(request.end_at))}</dd>
      <dt>Status</dt><dd>${esc(titleCase(status))}</dd>
      <dt>Customer</dt><dd>${esc(customerName || 'Not linked')}</dd>
      <dt>Contact</dt><dd>${esc(email || '—')}</dd>
      <dt>Property</dt><dd>${esc([request.line1, request.city, request.state, request.postal_code].filter(Boolean).join(', ') || String(payload.locationText ?? '—'))}</dd>
      <dt>Service</dt><dd>${esc(String(payload.service_label ?? payload.serviceType ?? payload.service ?? '—'))}</dd>
      <dt>Estimate / price</dt><dd>${esc(String(payload.price ?? payload.expectedPrice ?? payload.total ?? '—'))}</dd>
      <dt>Calendar event</dt><dd>${esc(request.calendar_event_id || '—')}</dd>
      <dt>Appointment</dt><dd>${esc(request.appointment_reference || '—')}</dd>
    </dl>
    ${payloadSummary(payload)}
    <details class="admin-detail-toggle"><summary>Raw request data</summary><pre style="white-space:pre-wrap">${esc(JSON.stringify(payload, null, 2))}</pre></details>
    <details class="admin-detail-toggle"><summary>Request audit trail (${auditRows.length})</summary><pre style="white-space:pre-wrap">${esc(auditRows.map((entry) => `${entry.created_at} · ${entry.action} · ${entry.success ? 'ok' : 'failed'}`).join('\n'))}</pre></details>
    <h3 style="margin-top:1rem;">Customer email history</h3>
    ${notificationRows}
    ${email ? `<form class="admin-inline-form" data-form="request-notify" style="margin-top:.75rem;"><input type="hidden" name="requestId" value="${esc(requestId)}" /><button class="btn btn--ghost btn--small" type="submit">Resend last customer email</button></form>` : ''}
  </div>${association}${actions}`;
}

async function submitRequestAction(body: Record<string, unknown>): Promise<void> {
  setAppError();
  const requestId = String(body.requestId ?? '');
  try {
    await api('/api/admin/requests', { method: 'POST', body: JSON.stringify(body) });
    await loadCalendar();
    if (requestId) await openRequest(requestId);
  } catch (error) {
    setAppError(friendly(error));
  }
}

async function loadLeads(status = '', query = ''): Promise<void> {
  const data = await api<{ leads?: Array<Record<string, unknown>> }>(`/api/admin/leads?status=${encodeURIComponent(status)}&q=${encodeURIComponent(query)}`);
  const target = document.querySelector<HTMLElement>('[data-admin-leads]');
  if (!target) return;
  renderTable(target, ['Date', 'Type', 'Customer', 'Reference', 'Delivery', 'Status', 'Action'], (data.leads ?? []).map((lead) => [
    esc(dateTime(lead.created_at)),
    esc(lead.request_type),
    esc([lead.first_name, lead.last_name].filter(Boolean).join(' ') || 'Unlinked'),
    esc(lead.quote_reference),
    `${esc(lead.delivery_status)}${lead.last_delivery_error ? ` · ${esc(lead.last_delivery_error)}` : ''}`,
    can('lead.write') ? `<select class="admin-select" data-lead-status="${esc(lead.id)}">${['new', 'contacted', 'quoted', 'converted', 'lost', 'archived'].map((value) => `<option value="${value}"${value === lead.status ? ' selected' : ''}>${esc(titleCase(value))}</option>`).join('')}</select>` : `<span class="admin-status">${esc(titleCase(lead.status))}</span>`,
    `<div class="admin-actions">${can('lead.write') ? `<button class="btn btn--ghost btn--small" type="button" data-admin-action="lead-save" data-id="${esc(lead.id)}">Save</button>${lead.delivery_status === 'failed' ? `<button class="btn btn--ghost btn--small" type="button" data-admin-action="lead-retry" data-id="${esc(lead.id)}">Retry email</button>` : ''}` : ''}</div><details class="admin-detail-toggle"><summary>View request</summary><dl>${leadDetails(lead.payload)}</dl></details>`,
  ]), 'No inquiries match this filter.');
}

async function loadCustomerOptions(): Promise<void> {
  const data = await api<{ customers?: Array<Record<string, unknown>> }>('/api/admin/customers?limit=200');
  const options = (data.customers ?? []).map((customer) => {
    const name = [customer.first_name, customer.last_name].filter(Boolean).join(' ') || customer.company_name || customer.id;
    return `<option value="${esc(customer.id)}">${esc(name)}${customer.email ? ` — ${esc(customer.email)}` : ''}</option>`;
  }).join('');
  for (const select of document.querySelectorAll<HTMLSelectElement>('[data-admin-customer-options]')) {
    const current = select.value;
    select.innerHTML = `<option value="">Choose a customer</option>${options}`;
    if (current) select.value = current;
  }
}

async function loadCustomers(query = ''): Promise<void> {
  const data = await api<{ customers?: Array<Record<string, unknown>> }>(`/api/admin/customers?q=${encodeURIComponent(query)}`);
  const list = document.querySelector<HTMLElement>('[data-admin-customers]');
  const detail = document.querySelector<HTMLElement>('[data-admin-customer-detail]');
  if (!list) return;
  if (detail) { detail.hidden = true; detail.innerHTML = ''; }
  if ((data.customers ?? []).length === 0) return renderEmpty(list, query ? 'No matching customers.' : 'No customers have been persisted yet.');
  list.innerHTML = `<div class="admin-table-scroll"><table class="admin-table"><thead><tr><th>Name</th><th>Email</th><th>Phone</th><th>Properties</th><th>Branch</th><th></th></tr></thead><tbody>${(data.customers ?? []).map((customer) => `<tr><td>${esc([customer.first_name, customer.last_name].filter(Boolean).join(' ') || customer.company_name)}</td><td>${esc(customer.email)}</td><td>${esc(customer.phone)}</td><td>${esc(customer.property_count)}</td><td>${esc(customer.branch_name)}</td><td><button class="btn btn--ghost btn--small" type="button" data-admin-action="customer-open" data-id="${esc(customer.id)}">Open</button></td></tr>`).join('')}</tbody></table></div>`;
  void loadCustomerOptions();
}

function customerForm(customer: Record<string, unknown> = {}): string {
  return `<form class="admin-form admin-form--grid" data-form="${customer.id ? 'customer-update' : 'customer-create'}">
    ${customer.id ? `<input type="hidden" name="customerId" value="${esc(customer.id)}" />` : ''}
    <label>First name <input name="firstName" value="${esc(customer.first_name)}" /></label>
    <label>Last name <input name="lastName" value="${esc(customer.last_name)}" /></label>
    <label>Company <input name="companyName" value="${esc(customer.company_name)}" /></label>
    <label>Email <input name="email" type="email" value="${esc(customer.email)}" /></label>
    <label>Phone <input name="phone" value="${esc(customer.phone)}" /></label>
    <label>Status <select name="status"><option value="active"${customer.status !== 'archived' ? ' selected' : ''}>Active</option><option value="archived"${customer.status === 'archived' ? ' selected' : ''}>Archived</option></select></label>
    <label class="admin-field--wide">Notes summary <textarea name="notesSummary" rows="3">${esc(customer.notes_summary)}</textarea></label>
    <label><input type="checkbox" name="doNotContact" value="yes"${Number(customer.do_not_contact) ? ' checked' : ''} /> Do not contact</label>
    <label><input type="checkbox" name="marketingConsent" value="yes"${Number(customer.marketing_consent) ? ' checked' : ''} /> Marketing consent</label>
    ${customer.id ? '' : `<label class="admin-field--wide">Service address <input name="addressLine1" placeholder="Street address" /></label><label>City <input name="city" /></label><label>State <input name="state" value="FL" maxlength="2" /></label><label>ZIP <input name="postalCode" inputmode="numeric" maxlength="10" /></label>`}
    <button class="btn btn--primary btn--small" type="submit">${customer.id ? 'Save customer' : 'Create customer'}</button>
  </form>`;
}

function renderCustomerCreate(): void {
  const detail = document.querySelector<HTMLElement>('[data-admin-customer-detail]');
  if (!detail) return;
  detail.hidden = false;
  detail.innerHTML = `<div class="admin-card"><h2 class="admin-section-title">New customer</h2>${customerForm()}</div>`;
}

async function openCustomer(customerId: string): Promise<void> {
  const data = await api<Record<string, unknown>>(`/api/admin/customers?id=${encodeURIComponent(customerId)}`);
  const detail = document.querySelector<HTMLElement>('[data-admin-customer-detail]');
  if (!detail) return;
  const customer = (data.customer ?? {}) as Record<string, unknown>;
  const contacts = (data.contacts as Array<Record<string, unknown>>) ?? [];
  const properties = (data.properties as Array<Record<string, unknown>>) ?? [];
  const notes = (data.notes as Array<Record<string, unknown>>) ?? [];
  const leads = (data.leads as Array<Record<string, unknown>>) ?? [];
  const estimates = (data.estimates as Array<Record<string, unknown>>) ?? [];
  const appointments = (data.appointments as Array<Record<string, unknown>>) ?? [];
  const invoices = (data.invoices as Array<Record<string, unknown>>) ?? [];
  const paymentAuthorizations = (data.paymentAuthorizations as Array<Record<string, unknown>>) ?? [];
  const email = contacts.find((contact) => contact.kind === 'email')?.value ?? customer.email ?? '';
  const phone = contacts.find((contact) => contact.kind === 'phone')?.value ?? customer.phone ?? '';
  detail.hidden = false;
  detail.innerHTML = `<div class="admin-card">
    <div class="admin-detail-head"><h2 class="admin-section-title">${esc([customer.first_name, customer.last_name].filter(Boolean).join(' ') || customer.company_name || 'Customer')}</h2><button class="btn btn--ghost btn--small" type="button" data-admin-action="customer-create">Close</button></div>
    <dl class="admin-definition"><dt>Status</dt><dd>${esc(customer.status)}</dd><dt>Branch</dt><dd>${esc(customer.branch_name)}</dd><dt>Source</dt><dd>${esc(customer.source)}</dd><dt>Contacts</dt><dd>${contacts.map((contact) => `${esc(titleCase(contact.kind))}: ${esc(contact.value)}`).join('<br />') || '—'}</dd></dl>
    <h3>Properties</h3>
    ${properties.map((property) => `<div class="admin-record"><strong>${esc(property.label)}</strong><p>${esc([property.line1, property.city, property.state, property.postal_code].filter(Boolean).join(', '))}</p>${property.access_notes ? `<p class="admin-muted">Access: ${esc(property.access_notes)}</p>` : ''}</div>`).join('') || '<p class="admin-muted">No properties.</p>'}
    <details class="admin-detail-toggle"><summary>Add a property</summary><form class="admin-form" data-form="property-add"><input type="hidden" name="customerId" value="${esc(customerId)}" /><label>Label <input name="label" value="Service property" /></label><label>Address <input name="line1" required /></label><label>City <input name="city" /></label><label>State <input name="state" value="FL" maxlength="2" /></label><label>ZIP <input name="postalCode" maxlength="10" /></label><label>Access notes <textarea name="accessNotes" rows="2"></textarea></label><button class="btn btn--secondary btn--small" type="submit">Add property</button></form></details>
    <h3>History</h3><div class="admin-history">${leads.length ? `<p><strong>Requests:</strong> ${leads.map((lead) => `${esc(lead.request_type)} (${esc(lead.status)})`).join(', ')}</p>` : ''}${estimates.length ? `<p><strong>Estimates:</strong> ${estimates.map((estimate) => `${esc(estimate.quote_reference)} (${money(estimate.total_cents)})`).join(', ')}</p>` : ''}${appointments.length ? `<p><strong>Appointments:</strong> ${appointments.map((appointment) => `${esc(appointment.reference)} (${esc(appointment.status)})`).join(', ')}</p>` : ''}${invoices.length ? `<p><strong>Invoices:</strong> ${invoices.map((invoice) => `${esc(invoice.number)} (${money(invoice.balance_cents)} balance)`).join(', ')}</p>` : ''}</div>
    <h3>Notes</h3>${notes.map((note) => `<div class="admin-record"><p>${esc(note.body)}</p><p class="admin-muted">${esc(dateTime(note.created_at))}</p></div>`).join('') || '<p class="admin-muted">No notes.</p>'}
    <form class="admin-form" data-form="note-add" style="max-width:none;"><input type="hidden" name="customerId" value="${esc(customerId)}" /><label>Add note <textarea name="body" rows="3" required></textarea></label><button class="btn btn--secondary btn--small" type="submit">Add note</button></form>
    <details class="admin-detail-toggle"><summary>Edit customer</summary>${customerForm({ ...customer, email, phone })}</details>
  </div>`;
  if (!can('customer.write')) {
    for (const form of detail.querySelectorAll<HTMLElement>('[data-form]')) form.hidden = true;
  }
  if (can('finance.write')) {
    detail.insertAdjacentHTML(
      'beforeend',
      `<div class="admin-card" style="margin-top:1rem;"><h3>Saved-card payment authorization</h3><p class="admin-muted">Create a one-time signing link. The customer signs before any card is saved; a saved card never authorizes a charge by itself.</p><form class="admin-form" data-form="payment-auth"><input type="hidden" name="customerId" value="${esc(customerId)}" /><label>Service <input name="serviceCode" value="residential-cleaning" required /></label><label>Property <select name="propertyId"><option value="">No specific property</option>${properties.map((property) => `<option value="${esc(property.id)}">${esc([property.label, property.line1, property.city].filter(Boolean).join(' — '))}</option>`).join('')}</select></label><label>Expected amount (USD) <input name="amount" type="number" min="0.01" step="0.01" required /></label><label>Maximum authorized (USD) <input name="maxAmount" type="number" min="0.01" step="0.01" required /></label><button class="btn btn--secondary btn--small" type="submit">Create signing link</button></form><div data-payment-auth-result></div></div>`,
    );
  }
  if (paymentAuthorizations.length > 0) {
    const rows = paymentAuthorizations.map((authorization) => `<div class="admin-record"><strong>${esc(titleCase(authorization.status))}</strong> · ${esc(money(authorization.max_amount_cents))} max · signed ${esc(dateTime(authorization.signed_at))}<p class="admin-muted">SHA-256 ${esc(authorization.sha256)}</p><details class="admin-detail-toggle"><summary>View signed authorization</summary><pre style="white-space:pre-wrap">${esc(authorization.signed_content_text)}</pre></details></div>`).join('');
    detail.insertAdjacentHTML('beforeend', `<div class="admin-card" style="margin-top:1rem;"><h3>Signed payment authorizations</h3>${rows}</div>`);
  }
}

async function loadRecurring(): Promise<void> {
  const data = await api<{ recurring?: Array<Record<string, unknown>> }>('/api/admin/operations?view=recurring');
  const target = document.querySelector<HTMLElement>('[data-admin-recurring]');
  if (target) {
    renderTable(target, ['Customer', 'Property', 'Frequency', 'Price', 'Next visit', 'Status', 'Action'], (data.recurring ?? []).map((plan) => [
      esc([plan.first_name, plan.last_name].filter(Boolean).join(' ')),
      esc([plan.line1, plan.city].filter(Boolean).join(', ')),
      esc(titleCase(plan.frequency)),
      esc(money(plan.ongoing_price_cents)),
      esc(dateTime(plan.next_visit_date)),
      can('job.write') ? `<select class="admin-select" data-recurring-status="${esc(plan.id)}">${['active', 'paused', 'cancelled', 'completed'].map((status) => `<option value="${status}"${status === plan.status ? ' selected' : ''}>${esc(titleCase(status))}</option>`).join('')}</select>` : `<span class="admin-status">${esc(titleCase(plan.status))}</span>`,
      can('job.write') ? `<button class="btn btn--ghost btn--small" type="button" data-admin-action="recurring-save" data-id="${esc(plan.id)}">Save</button>` : '',
    ]), 'No recurring plans are recorded yet.');
  }
  await loadCustomerOptions();
}

async function loadPropertiesFor(customerId: string): Promise<void> {
  const select = document.querySelector<HTMLSelectElement>('[data-admin-property-options]');
  if (!select) return;
  select.innerHTML = '<option value="">Choose a property</option>';
  if (!customerId) return;
  const detail = await api<Record<string, unknown>>(`/api/admin/customers?id=${encodeURIComponent(customerId)}`);
  for (const property of (detail.properties as Array<Record<string, unknown>>) ?? []) {
    select.insertAdjacentHTML('beforeend', `<option value="${esc(property.id)}">${esc([property.label, property.line1, property.city].filter(Boolean).join(' — '))}</option>`);
  }
}

async function loadJobs(): Promise<void> {
  const data = await api<{ jobs?: Array<Record<string, unknown>>; team?: Array<Record<string, unknown>> }>('/api/admin/operations?view=jobs');
  const team = data.team ?? [];
  const target = document.querySelector<HTMLElement>('[data-admin-jobs]');
  if (target) {
    target.innerHTML = (data.jobs ?? []).map((job) => `<div class="admin-record admin-job"><div><strong>${esc(dateTime(job.start_at))}</strong> · ${esc(job.reference)} · ${esc([job.first_name, job.last_name].filter(Boolean).join(' '))}<p class="admin-muted">${esc([job.line1, job.city].filter(Boolean).join(', '))}${job.crew ? ` · ${esc(job.crew)}` : ''}</p></div><div class="admin-actions">${can('job.write') ? `<select class="admin-select" data-job-status="${esc(job.id)}">${['pending', 'confirmed', 'in_progress', 'completed', 'cancelled', 'no_show'].map((status) => `<option value="${status}"${status === job.status ? ' selected' : ''}>${esc(titleCase(status))}</option>`).join('')}</select><button class="btn btn--ghost btn--small" type="button" data-admin-action="job-save" data-id="${esc(job.id)}">Save</button><select class="admin-select" data-job-team="${esc(job.id)}"><option value="">Assign cleaner</option>${team.map((member) => `<option value="${esc(member.id)}">${esc(member.display_name)}</option>`).join('')}</select><button class="btn btn--ghost btn--small" type="button" data-admin-action="job-assign" data-id="${esc(job.id)}">Assign</button>` : `<span class="admin-status">${esc(titleCase(job.status))}</span>`}<button class="btn btn--secondary btn--small" type="button" data-admin-action="job-checklist" data-id="${esc(job.id)}">Checklist</button></div></div>`).join('') || '<div class="admin-empty">No jobs are recorded yet.</div>';
  }
  const teamTarget = document.querySelector<HTMLElement>('[data-admin-team]');
  if (teamTarget) {
    renderTable(teamTarget, ['Name', 'Email', 'Status', 'Bookable'], team.map((member) => [esc(member.display_name), esc(member.email), `<span class="admin-status">${esc(member.status)}</span>`, Number(member.is_bookable) ? 'Yes' : 'No']), 'No team members are recorded yet.');
  }
}

async function openChecklist(appointmentId: string): Promise<void> {
  const target = document.querySelector<HTMLElement>('[data-admin-checklist]');
  if (!target) return;
  const data = await api<{ checklist?: Record<string, unknown> | null }>(`/api/admin/operations?view=checklist&appointmentId=${encodeURIComponent(appointmentId)}`);
  if (!data.checklist) {
    target.innerHTML = `<p class="admin-muted">No checklist yet.</p><button class="btn btn--secondary btn--small" type="button" data-admin-action="checklist-create" data-id="${esc(appointmentId)}">Create checklist</button>`;
    return;
  }
  const checklist = data.checklist.checklist as Record<string, unknown>;
  const items = data.checklist.items as Array<Record<string, unknown>>;
  target.innerHTML = `<h3>Checklist · ${esc(titleCase(checklist.status))}</h3>${items.map((item) => `<label class="admin-check"><input type="checkbox" data-checklist-item="${esc(item.id)}"${Number(item.completed) ? ' checked' : ''} /> ${esc(item.label)}</label>`).join('')}`;
}

async function loadFinance(): Promise<void> {
  const data = await api<{ invoices?: Array<Record<string, unknown>>; summary?: Record<string, Record<string, number>> }>('/api/admin/finance');
  const summary = data.summary ?? {};
  const summaryTarget = document.querySelector<HTMLElement>('[data-admin-finance-summary]');
  if (summaryTarget) {
    summaryTarget.innerHTML = [['Invoiced', money(summary.invoices?.total)], ['Collected', money(summary.payments?.total)], ['Outstanding', money(summary.outstanding?.total)], ['Gift balances', money(summary.gifts?.balance)]].map(([label, value]) => `<div class="admin-card admin-kpi"><p class="admin-kpi__label">${esc(label)}</p><p class="admin-kpi__value">${esc(value)}</p></div>`).join('');
  }
  const target = document.querySelector<HTMLElement>('[data-admin-invoices]');
  if (target) {
    renderTable(target, ['Number', 'Customer', 'Total', 'Balance', 'Due', 'Status', 'Action'], (data.invoices ?? []).map((invoice) => [
      esc(invoice.number),
      esc([invoice.first_name, invoice.last_name].filter(Boolean).join(' ')),
      esc(money(invoice.total_cents)),
      esc(money(invoice.balance_cents)),
      esc(dateTime(invoice.due_date)),
      `<span class="admin-status">${esc(titleCase(invoice.status))}</span>`,
      `<button class="btn btn--ghost btn--small" type="button" data-admin-action="invoice-open" data-id="${esc(invoice.id)}">Open</button>`,
    ]), 'No invoices are recorded yet.');
  }
  await loadCustomerOptions();
}

async function openInvoice(invoiceId: string): Promise<void> {
  const data = await api<Record<string, unknown>>(`/api/admin/finance?id=${encodeURIComponent(invoiceId)}`);
  const target = document.querySelector<HTMLElement>('[data-admin-invoice-detail]');
  if (!target) return;
  const invoice = data.invoice as Record<string, unknown>;
  const lines = (data.lines as Array<Record<string, unknown>>) ?? [];
  const payments = (data.payments as Array<Record<string, unknown>>) ?? [];
  target.innerHTML = `<div class="admin-card"><div class="admin-detail-head"><h2 class="admin-section-title">${esc(invoice.number)}</h2><span class="admin-status">${esc(titleCase(invoice.status))}</span></div><dl class="admin-definition"><dt>Customer</dt><dd>${esc([invoice.first_name, invoice.last_name].filter(Boolean).join(' '))}</dd><dt>Total</dt><dd>${esc(money(invoice.total_cents))}</dd><dt>Paid</dt><dd>${esc(money(invoice.amount_paid_cents))}</dd><dt>Balance</dt><dd>${esc(money(invoice.balance_cents))}</dd><dt>Due</dt><dd>${esc(dateTime(invoice.due_date))}</dd></dl><h3>Lines</h3>${lines.map((line) => `<div class="admin-record">${esc(line.description)} · ${esc(money(line.total_cents))}</div>`).join('') || '<p class="admin-muted">No lines.</p>'}<h3>Payments</h3>${payments.map((payment) => `<div class="admin-record">${esc(titleCase(payment.provider))} · ${esc(money(payment.amount_cents))} · ${esc(payment.status)} · ${esc(dateTime(payment.created_at))}<details class="admin-detail-toggle"><summary>Record refund</summary><form class="admin-form" data-form="refund"><input type="hidden" name="paymentId" value="${esc(payment.id)}" /><label>Refund amount <input name="amount" type="number" min="0.01" step="0.01" required /></label><label>Reason <input name="reason" /></label><button class="btn btn--secondary btn--small" type="submit">Record refund</button></form></details></div>`).join('') || '<p class="admin-muted">No payments.</p>'}${Number(invoice.balance_cents) > 0 ? `<form class="admin-form" data-form="payment"><input type="hidden" name="invoiceId" value="${esc(invoiceId)}" /><input type="hidden" name="idempotencyKey" value="${esc(crypto.randomUUID())}" /><label>Payment method <select name="provider"><option value="cash">Cash</option><option value="check">Check</option><option value="external">External</option></select></label><label>Amount <input name="amount" type="number" min="0.01" step="0.01" value="${(Number(invoice.balance_cents) / 100).toFixed(2)}" required /></label><label>Reference <input name="reference" /></label><button class="btn btn--primary btn--small" type="submit">Record payment</button></form>` : ''}<form class="admin-form" data-form="credit"><input type="hidden" name="customerId" value="${esc(invoice.customer_id)}" /><label>Customer credit amount <input name="amount" type="number" min="0.01" step="0.01" required /></label><label>Reason <input name="source" /></label><button class="btn btn--secondary btn--small" type="submit">Add credit</button></form></div>`;
  const controls = document.querySelector<HTMLElement>('[data-admin-invoice-controls]');
  if (controls) {
    controls.innerHTML = '';
    if (can('finance.write') && !invoice.payment_url && Number(invoice.balance_cents) > 0) {
      controls.insertAdjacentHTML(
        'beforeend',
        `<button class="btn btn--secondary btn--small" type="button" data-admin-action="invoice-link" data-id="${esc(invoiceId)}">Create Stripe payment link</button>`,
      );
    }
    if (invoice.payment_url) {
      controls.insertAdjacentHTML(
        'beforeend',
        `<p><a class="btn btn--secondary btn--small" href="${esc(invoice.payment_url)}" target="_blank" rel="noopener noreferrer">Open Stripe payment link</a></p>`,
      );
    }
    const stripePayments = payments.filter((payment) => payment.provider === 'stripe');
    if (can('finance.write') && stripePayments.length > 0) {
      controls.insertAdjacentHTML(
        'beforeend',
        `<details class="admin-detail-toggle"><summary>Execute Stripe refund</summary><form class="admin-form" data-form="stripe-refund"><label>Stripe payment <select name="paymentId">${stripePayments.map((payment) => `<option value="${esc(payment.id)}">${esc(money(payment.amount_cents))} · ${esc(dateTime(payment.created_at))}</option>`).join('')}</select></label><label>Refund amount (USD) <input name="amount" type="number" min="0.01" step="0.01" required /></label><label>Your password (step-up) <input name="password" type="password" required /></label><button class="btn btn--secondary btn--small" type="submit">Execute Stripe refund</button></form></details>`,
      );
    }
    if (can('finance.write') && Number(invoice.balance_cents) > 0) {
      controls.insertAdjacentHTML(
        'beforeend',
        `<details class="admin-detail-toggle"><summary>Apply Gift Certificate</summary><form class="admin-form" data-form="gift-invoice"><input type="hidden" name="invoiceId" value="${esc(invoiceId)}" /><label>Certificate code <input name="code" placeholder="SSGC-XXXX-XXXX" required /></label><label>Amount to apply (USD) <input name="amount" type="number" min="0.01" step="0.01" value="${(Number(invoice.balance_cents) / 100).toFixed(2)}" required /></label><label>Your password (step-up) <input name="password" type="password" autocomplete="current-password" required /></label><button class="btn btn--secondary btn--small" type="submit">Apply Gift to Invoice</button></form></details>`,
      );
    }
    if (can('finance.write') && Number(invoice.balance_cents) > 0) {
      void api<{ authorizations?: Array<Record<string, unknown>> }>(
        `/api/admin/payment-authorizations?customerId=${encodeURIComponent(String(invoice.customer_id ?? ''))}`,
      )
        .then((result) => {
          const active = (result.authorizations ?? []).filter((authorization) => authorization.status === 'active');
          if (active.length === 0) return;
          controls.insertAdjacentHTML(
            'beforeend',
            `<details class="admin-detail-toggle"><summary>Charge saved card after service</summary><form class="admin-form" data-form="offsession"><label>Signed authorization <select name="authorizationId">${active.map((authorization) => `<option value="${esc(authorization.id)}">${esc(money(authorization.max_amount_cents))} max · signed ${esc(dateTime(authorization.signed_at))}</option>`).join('')}</select></label><label>Your password (step-up) <input name="password" type="password" required /></label><input type="hidden" name="invoiceId" value="${esc(invoiceId)}" /><button class="btn btn--secondary btn--small" type="submit">Charge authorized card</button></form></details>`,
          );
        })
        .catch(() => undefined);
    }
  }
}

let timeIntervals: Array<Record<string, unknown>> = [];

function centralInputValue(value: unknown): string {
  const date = new Date(String(value ?? ''));
  if (!Number.isFinite(date.getTime())) return '';
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
    })
      .formatToParts(date)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value]),
  ) as Record<string, string>;
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour === '24' ? '00' : parts.hour}:${parts.minute}`;
}

async function loadTimekeeping(): Promise<void> {
  const weekInput = document.querySelector<HTMLInputElement>('[data-time-week]');
  const week = weekInput?.value ?? '';
  try {
    const data = await api<Record<string, unknown>>(`/api/admin/timekeeping${week ? `?weekStart=${encodeURIComponent(week)}` : ''}`);
    if (weekInput) weekInput.value = String(data.weekStart ?? '');
    const employees = (data.employees as Array<Record<string, unknown>>) ?? [];
    const events = (data.events as Array<Record<string, unknown>>) ?? [];
    const corrections = (data.corrections as Array<Record<string, unknown>>) ?? [];
    timeIntervals = employees.flatMap((employee) =>
      ((employee.intervals as Array<Record<string, unknown>>) ?? []).map((interval) => ({
        ...interval,
        employee_name: employee.display_name,
      })),
    );

    const summary = document.querySelector<HTMLElement>('[data-admin-time-summary]');
    if (summary) {
      const totalWork = employees.reduce((total, employee) => total + Number((employee.totals as Record<string, unknown>)?.workMinutes ?? 0), 0);
      const overtime = employees.reduce((total, employee) => total + Number((employee.totals as Record<string, unknown>)?.overtimeMinutes ?? 0), 0);
      const openCount = employees.filter((employee) => employee.openInterval).length;
      const missing = employees.filter((employee) => employee.missingClockOut).length;
      summary.innerHTML = [
        ['Week', `${esc(data.weekStart)} ? ${esc(data.weekEnd)}`],
        ['Compensated hours', (totalWork / 60).toFixed(2)],
        ['Overtime hours', (overtime / 60).toFixed(2)],
        ['Open shifts', openCount],
        ['Missing clock-outs', missing],
      ].map(([label, value]) => `<div class="admin-card admin-kpi"><p class="admin-kpi__label">${esc(label)}</p><p class="admin-kpi__value">${esc(value)}</p></div>`).join('');
    }

    const employeeTarget = document.querySelector<HTMLElement>('[data-admin-time-employees]');
    if (employeeTarget) {
      renderTable(employeeTarget, ['Employee', 'Work', 'Rest', 'Meal', 'Overtime', 'Est. gross', 'State'], employees.map((employee) => {
        const totals = (employee.totals as Record<string, unknown>) ?? {};
        const state = employee.missingClockOut ? 'Missing clock-out' : employee.openInterval ? 'On the clock' : '?';
        return [
          esc(employee.display_name),
          esc(totals.workLabel),
          esc(totals.breakLabel),
          esc(totals.mealLabel),
          esc(totals.overtimeLabel),
          esc(totals.grossLabel),
          esc(state),
        ];
      }), 'No team members are linked to the roster yet.');
    }

    const intervalTarget = document.querySelector<HTMLElement>('[data-admin-time-intervals]');
    if (intervalTarget) {
      renderTable(intervalTarget, ['Employee', 'Start', 'End', 'Kind', 'Rate', 'Paid', 'Status', 'Action'], timeIntervals.map((interval) => [
        esc(interval.employee_name),
        esc(dateTime(interval.started_at)),
        esc(interval.ended_at ? dateTime(interval.ended_at) : 'open'),
        esc(interval.kind),
        esc(interval.rate_type),
        Number(interval.paid) ? 'Yes' : 'No',
        esc(interval.status),
        `<button class="btn btn--ghost btn--small" type="button" data-admin-action="time-edit" data-id="${esc(interval.id)}">Edit</button>`,
      ]), 'No intervals recorded for this week.');
    }

    const correctionTarget = document.querySelector<HTMLElement>('[data-admin-time-corrections]');
    if (correctionTarget) {
      renderTable(correctionTarget, ['Requested', 'Employee', 'Message', 'Action'], corrections.map((correction) => [
        esc(dateTime(correction.created_at)),
        esc(correction.display_name),
        esc(correction.message),
        `<div class="admin-actions"><button class="btn btn--ghost btn--small" type="button" data-admin-action="time-review" data-id="${esc(correction.id)}" data-approve="yes">Approve</button><button class="btn btn--ghost btn--small" type="button" data-admin-action="time-review" data-id="${esc(correction.id)}" data-approve="no">Decline</button></div>`,
      ]), 'No pending correction requests.');
    }

    const eventTarget = document.querySelector<HTMLElement>('[data-admin-time-events]');
    if (eventTarget) {
      renderTable(eventTarget, ['When', 'Employee', 'Action', 'Location', 'Accuracy', 'Map'], events.slice(0, 100).map((event) => [
        esc(dateTime(event.occurred_at)),
        esc(event.display_name),
        esc(titleCase(event.action)),
        esc(titleCase(event.location_status)),
        event.accuracy_m ? `${Math.round(Number(event.accuracy_m))} m` : '?',
        event.lat && event.lng ? `<a href="https://www.google.com/maps?q=${esc(event.lat)},${esc(event.lng)}" target="_blank" rel="noopener noreferrer">Open</a>` : '?',
      ]), 'No clock events recorded this week.');
    }

    const options = employees
      .map((employee) => `<option value="${esc(employee.id)}">${esc(employee.display_name)}</option>`)
      .join('');
    for (const select of document.querySelectorAll<HTMLSelectElement>('[data-time-team-options]')) {
      const current = select.value;
      select.innerHTML = `<option value="">Choose a team member</option>${options}`;
      if (current) select.value = current;
    }
    const ownerRates = document.querySelector<HTMLElement>('[data-admin-owner-time-rates]');
    if (ownerRates) ownerRates.hidden = actor?.role !== 'owner';
    setAppError();
  } catch (error) {
    setAppError(friendly(error));
  }
}

let giftRecords: Array<Record<string, unknown>> = [];

async function loadGifts(query = '', status = ''): Promise<void> {
  const params = new URLSearchParams();
  if (query) params.set('q', query);
  if (status) params.set('status', status);
  const data = await api<{ configured?: boolean; summary?: Record<string, number>; records?: Array<Record<string, unknown>> }>(
    `/api/admin/gifts${params.toString() ? `?${params.toString()}` : ''}`,
  );
  const target = document.querySelector<HTMLElement>('[data-admin-gifts]');
  if (!target) return;
  if (!data.configured) return renderEmpty(target, 'Gift storage is not configured on this deployment.');
  giftRecords = data.records ?? [];
  const summary = data.summary ?? {};
  target.innerHTML = `<div class="admin-grid">${[
    ['Issued', summary.issuedCount ?? 0],
    ['Active now', summary.activeCount ?? 0],
    ['Scheduled', summary.futureCount ?? 0],
    ['Partially redeemed', summary.partialCount ?? 0],
    ['Outstanding', money(summary.outstandingCents)],
    ['Redeemed', money(summary.redeemedCents)],
  ].map(([label, value]) => `<div class="admin-card admin-kpi"><p class="admin-kpi__label">${esc(label)}</p><p class="admin-kpi__value">${esc(value)}</p></div>`).join('')}</div><div style="margin-top:1rem;" data-admin-gift-table></div><div data-admin-gift-action style="margin-top:1rem;"></div>`;
  const table = target.querySelector<HTMLElement>('[data-admin-gift-table]');
  if (table) {
    renderTable(table, ['Code', 'Purchaser', 'Recipient', 'Value', 'Redeemed', 'Remaining', 'Valid from', 'State', 'Action'], (data.records ?? []).map((record) => [
      esc(record.code),
      esc(record.purchaserName),
      esc(record.recipientName),
      esc(money(record.valueCents)),
      esc(money(record.redeemedCents)),
      esc(money(record.remainingCents)),
      esc(record.validFromDate),
      `<span class="admin-status">${esc(titleCase(record.activationState))}</span>`,
      `<div class="admin-actions"><button class="btn btn--ghost btn--small" type="button" data-gift-code="${esc(record.code)}" data-gift-action="details">Details</button><button class="btn btn--ghost btn--small" type="button" data-gift-code="${esc(record.code)}" data-gift-action="redeem">Redeem</button><button class="btn btn--ghost btn--small" type="button" data-gift-code="${esc(record.code)}" data-gift-action="void">Void</button></div>`,
    ]), 'No gift certificates match this filter.');
  }
}

function renderGiftDetails(code: string): void {
  const target = document.querySelector<HTMLElement>('[data-admin-gift-detail]');
  const record = giftRecords.find((entry) => entry.code === code);
  if (!target || !record) return;
  const history = (record.history as Array<Record<string, unknown>>) ?? [];
  const adjustments = (record.adjustments as Array<Record<string, unknown>>) ?? [];
  target.hidden = false;
  target.innerHTML = `<div class="admin-card">
    <div class="admin-detail-head"><h3>${esc(record.code)}</h3><button class="btn btn--ghost btn--small" type="button" data-gift-action="details-close">Close</button></div>
    <dl class="admin-definition">
      <dt>State</dt><dd>${esc(titleCase(record.activationState))}</dd>
      <dt>Purchaser</dt><dd>${esc(record.purchaserName)} ? ${esc(record.purchaserEmail)}</dd>
      <dt>Recipient</dt><dd>${esc(record.recipientName)} ? ${esc(record.recipientEmail || 'No recipient email')}</dd>
      <dt>Value</dt><dd>${esc(money(record.valueCents))} ? redeemed ${esc(money(record.redeemedCents))} ? remaining ${esc(money(record.remainingCents))}</dd>
      <dt>Valid from</dt><dd>${esc(record.validFromDate)} (12:00 AM America/Chicago)</dd>
      <dt>Issued</dt><dd>${esc(dateTime(record.issuedAt))}</dd>
      <dt>Stripe session</dt><dd>${esc(record.stripeSessionId || '?')}</dd>
      <dt>Message</dt><dd>${esc(record.message || '?')}</dd>
    </dl>
    <h4>Redemption history</h4>
    ${history.length ? history.map((entry) => `<p class="admin-muted">${esc(dateTime(entry.at))} ? ${esc(money(entry.amountCents))} ? ${esc(entry.reference || 'no reference')} ? ${esc(entry.note || '')}</p>`).join('') : '<p class="admin-muted">Not redeemed yet.</p>'}
    <h4>Refunds and voids</h4>
    ${adjustments.length ? adjustments.map((entry) => `<p class="admin-muted">${esc(dateTime(entry.at))} ? ${esc(titleCase(entry.kind))} ? ${esc(money(entry.amountCents))} ? ${esc(entry.note || '')}</p>`).join('') : '<p class="admin-muted">None.</p>'}
  </div>`;
  target.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function renderGiftAction(code: string, action: string): void {
  const target = document.querySelector<HTMLElement>('[data-admin-gift-action]');
  if (!target) return;
  if (action === 'details') return renderGiftDetails(code);
  if (action === 'details-close') {
    const detail = document.querySelector<HTMLElement>('[data-admin-gift-detail]');
    if (detail) { detail.hidden = true; detail.innerHTML = ''; }
    return;
  }
  target.innerHTML = `<div class="admin-card"><h3>${action === 'redeem' ? 'Redeem' : 'Void'} ${esc(code)}</h3><form class="admin-form" data-form="gift-action"><input type="hidden" name="code" value="${esc(code)}" /><input type="hidden" name="giftAction" value="${esc(action)}" />${action === 'redeem' ? '<label>Amount (USD) <input name="amount" type="number" min="0.01" step="0.01" required /></label><label>Reference <input name="reference" /></label>' : ''}<label>Reason / note <input name="note" /></label><label>Your password (step-up) <input name="password" type="password" autocomplete="current-password" required /></label><button class="btn btn--primary btn--small" type="submit">Confirm ${action === 'redeem' ? 'redemption' : 'void'}</button></form></div>`;
}

async function loadReports(): Promise<void> {
  const [data, giftData] = await Promise.all([
    api<{ report?: Record<string, unknown> }>('/api/admin/reports'),
    api<{ configured?: boolean; summary?: Record<string, number> }>('/api/admin/gifts').catch(() => ({ configured: false, summary: {} })),
  ]);
  const report = data.report ?? {};
  const giftSummary = (giftData.summary ?? {}) as Record<string, number>;
  const target = document.querySelector<HTMLElement>('[data-admin-reports]');
  if (!target) return;
  const sum = (rows: unknown) => Array.isArray(rows) ? rows.reduce((total, row) => total + Number((row as Record<string, number>).count ?? 0), 0) : 0;
  const customers = report.customers as Record<string, number> | undefined;
  target.innerHTML = `<div class="admin-grid">${[['Active customers', customers?.active ?? 0], ['Archived customers', customers?.archived ?? 0], ['Leads', sum(report.leads)], ['Jobs', sum(report.appointments)], ['Recurring plans', sum(report.recurring)], ['Invoices', sum(report.invoices)]].map(([label, value]) => `<div class="admin-card admin-kpi"><p class="admin-kpi__label">${esc(label)}</p><p class="admin-kpi__value">${esc(value)}</p></div>`).join('')}</div><div class="admin-card" style="margin-top:1rem;"><h2 class="admin-section-title">Monthly collected revenue</h2><div data-admin-report-monthly></div></div><div class="admin-card" style="margin-top:1rem;"><h2 class="admin-section-title">Gift activity</h2><div class="admin-grid">${giftData.configured ? [['Issued', giftSummary.issuedCount ?? 0], ['Active', giftSummary.activeCount ?? 0], ['Outstanding', money(giftSummary.outstandingCents)], ['Redeemed', money(giftSummary.redeemedCents)]].map(([label, value]) => `<div class="admin-card admin-kpi"><p class="admin-kpi__label">${esc(label)}</p><p class="admin-kpi__value">${esc(value)}</p></div>`).join('') : '<p class="admin-muted">Gift storage is not configured.</p>'}</div></div><div class="admin-card" style="margin-top:1rem;"><h2 class="admin-section-title">Payment mix</h2><div data-admin-report-payments></div></div>`;
  const monthly = target.querySelector<HTMLElement>('[data-admin-report-monthly]');
  if (monthly) renderTable(monthly, ['Month', 'Payments', 'Collected'], ((report.monthly as Array<Record<string, unknown>>) ?? []).map((row) => [esc(row.month), esc(row.payment_count), esc(money(row.payment_cents))]), 'No payment history yet.');
  const payments = target.querySelector<HTMLElement>('[data-admin-report-payments]');
  if (payments) renderTable(payments, ['Provider', 'Status', 'Count', 'Total'], ((report.payments as Array<Record<string, unknown>>) ?? []).map((row) => [esc(titleCase(row.provider)), esc(row.status), esc(row.count), esc(money(row.total_cents))]), 'No payment history yet.');
}

async function loadSettings(): Promise<void> {
  const [admins, sessions, audit] = await Promise.all([
    can('admin.manage')
      ? api<{ admins?: Array<Record<string, unknown>> }>('/api/admin/accounts?view=admins')
      : Promise.resolve({ admins: [] }),
    api<{ sessions?: Array<Record<string, unknown>> }>('/api/admin/accounts?view=sessions'),
    can('admin.manage')
      ? api<{ audit?: Array<Record<string, unknown>> }>('/api/admin/accounts?view=audit&limit=100')
      : Promise.resolve({ audit: [] }),
  ]);
  const mfaStatus = document.querySelector<HTMLElement>('[data-admin-mfa-status]');
  if (mfaStatus) {
    mfaStatus.innerHTML = actor?.mfaEnabled
      ? '<p><strong>Two-step verification is enabled.</strong></p><details class="admin-detail-toggle"><summary>Disable two-step verification</summary><form class="admin-form" data-form="mfa-disable"><label>Password <input name="password" type="password" required /></label><label>Current authenticator code <input name="code" inputmode="numeric" maxlength="6" required /></label><button class="btn btn--secondary btn--small" type="submit">Disable</button></form></details>'
      : '<p>Two-step verification is not enabled.</p><button class="btn btn--primary btn--small" type="button" data-admin-action="mfa-start">Set up authenticator</button>';
  }
  const adminsTarget = document.querySelector<HTMLElement>('[data-admin-admins]');
  if (adminsTarget) {
    renderTable(adminsTarget, ['Name', 'Email', 'Role', 'Branch', 'MFA', 'Status', 'Actions'], (admins.admins ?? []).map((admin) => [
      esc(admin.display_name),
      esc(admin.email),
      esc(admin.role_id),
      esc(admin.branch_name || 'All branches'),
      Number(admin.mfa_enabled) ? 'Enabled' : 'Not enabled',
      `<span class="admin-status">${esc(admin.status)}</span>`,
      `<div class="admin-actions"><button class="btn btn--ghost btn--small" type="button" data-admin-action="admin-reset" data-id="${esc(admin.id)}">Reset password</button><button class="btn btn--ghost btn--small" type="button" data-admin-action="admin-toggle" data-id="${esc(admin.id)}" data-status="${admin.status === 'active' ? 'disabled' : 'active'}">${admin.status === 'active' ? 'Disable' : 'Enable'}</button><button class="btn btn--ghost btn--small" type="button" data-admin-action="admin-revoke" data-id="${esc(admin.id)}">Revoke sessions</button></div>`,
    ]), 'No administrators except the owner yet.');
  }
  const sessionsTarget = document.querySelector<HTMLElement>('[data-admin-sessions]');
  if (sessionsTarget) {
    renderTable(sessionsTarget, ['Created', 'Expires', 'Current'], (sessions.sessions ?? []).map((session) => [esc(dateTime(session.created_at)), esc(dateTime(session.expires_at)), Number(session.current) ? 'This session' : '']), 'No sessions recorded.');
  }
  const auditTarget = document.querySelector<HTMLElement>('[data-admin-audit]');
  if (auditTarget) {
    renderTable(auditTarget, ['When', 'Actor', 'Action', 'Entity', 'Success'], (audit.audit ?? []).map((entry) => [esc(dateTime(entry.created_at)), esc(entry.display_name || 'System'), esc(entry.action), esc([entry.entity_type, entry.entity_id].filter(Boolean).join(':')), Number(entry.success) ? 'Yes' : 'No']), 'No audit records yet.');
  }
}

async function loadView(view: string): Promise<void> {
  const permission = navPermission[view];
  if (permission && !can(permission)) {
    setAppError('You do not have permission for that section.');
    return;
  }
  currentView = view;
  for (const button of navButtons) {
    if (button.dataset.adminNav === view) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  }
  for (const section of views) section.hidden = section.dataset.adminView !== view;
  if (titleEl) titleEl.textContent = viewMeta[view]?.[0] ?? 'Operations';
  if (subEl) subEl.textContent = viewMeta[view]?.[1] ?? '';
  setAppError();
  try {
    if (view === 'overview') await loadOverview();
    if (view === 'calendar') await loadCalendar();
    if (view === 'leads') await loadLeads();
    if (view === 'customers') await loadCustomers();
    if (view === 'recurring') await loadRecurring();
    if (view === 'jobs') await loadJobs();
    if (view === 'timekeeping') await loadTimekeeping();
    if (view === 'finance') await loadFinance();
    if (view === 'gift') await loadGifts();
    if (view === 'reports') await loadReports();
    if (view === 'settings') await loadSettings();
  } catch (error) {
    setAppError(friendly(error));
  }
}

async function action(path: string, body: Record<string, unknown>): Promise<void> {
  setAppError();
  try {
    await api(path, { method: 'POST', body: JSON.stringify(body) });
    await loadView(currentView);
  } catch (error) {
    setAppError(friendly(error));
  }
}

setupForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  setError();
  const data = new FormData(setupForm);
  try {
    const result = await api<{ actor?: AdminActor; csrf?: string }>('/api/admin/auth', {
      method: 'POST',
      body: JSON.stringify({ action: 'setup', setupCode: data.get('setupCode'), name: data.get('name'), email: data.get('email'), password: data.get('password') }),
    });
    applySession(result);
  } catch (error) { setError(friendly(error)); }
});

loginForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  setError();
  const data = new FormData(loginForm);
  try {
    const result = await api<{ actor?: AdminActor; csrf?: string; mfaRequired?: boolean; challengeToken?: string }>('/api/admin/auth', {
      method: 'POST',
      body: JSON.stringify({ action: 'login', email: data.get('email'), password: data.get('password') }),
    });
    if (result.mfaRequired && result.challengeToken) {
      mfaChallenge = result.challengeToken;
      showGate('mfa');
      return;
    }
    applySession(result);
  } catch (error) { setError(friendly(error)); }
});

mfaForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  setError();
  const data = new FormData(mfaForm);
  try {
    const result = await api<{ actor?: AdminActor; csrf?: string }>('/api/admin/auth', {
      method: 'POST',
      body: JSON.stringify({ action: 'mfa_verify', challengeToken: mfaChallenge, code: data.get('code'), recoveryCode: data.get('recoveryCode') }),
    });
    applySession(result);
  } catch (error) { setError(friendly(error)); }
});

document.querySelector<HTMLButtonElement>('[data-admin-mfa-cancel]')?.addEventListener('click', () => {
  mfaChallenge = '';
  showGate('login');
});

function passwordConfirmationIssue(form: HTMLFormElement, passwordField: string): string {
  const data = new FormData(form);
  const password = String(data.get(passwordField) ?? '');
  const confirmation = String(data.get('confirmPassword') ?? '');
  const problem = passwordConfirmationProblem(password, confirmation);
  return problem ? passwordConfirmationMessage(problem) : '';
}

document.querySelector<HTMLButtonElement>('[data-admin-forgot]')?.addEventListener('click', () => {
  setError();
  setSuccess();
  setStatusMessage(forgotStatus);
  const emailInput = forgotForm?.querySelector<HTMLInputElement>('input[name="email"]');
  if (emailInput && !emailInput.value) {
    const loginEmail = loginForm?.querySelector<HTMLInputElement>('input[name="email"]');
    if (loginEmail?.value) emailInput.value = loginEmail.value;
  }
  showGate('forgot');
  emailInput?.focus();
});

for (const button of document.querySelectorAll<HTMLButtonElement>('[data-admin-back-to-login]')) {
  button.addEventListener('click', () => {
    setError();
    setSuccess();
    showGate('login');
  });
}

forgotForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  setError();
  const data = new FormData(forgotForm);
  const submit = forgotForm.querySelector<HTMLButtonElement>('button[type="submit"]');
  setStatusMessage(forgotStatus, 'Sending…');
  if (submit) submit.disabled = true;
  try {
    const result = await api<{ message?: string }>('/api/admin/auth', {
      method: 'POST',
      body: JSON.stringify({ action: 'request_reset', email: data.get('email') }),
    });
    const message =
      result.message ??
      'If that email belongs to an active administrator account, a single-use reset link is on its way.';
    setStatusMessage(forgotStatus, `${message} The link expires in 30 minutes.`);
    forgotForm.reset();
  } catch (error) {
    setStatusMessage(forgotStatus, '');
    setError(friendly(error));
  } finally {
    if (submit) submit.disabled = false;
  }
});

inviteForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  setError();
  const issue = passwordConfirmationIssue(inviteForm, 'password');
  if (issue) return setError(issue);
  const data = new FormData(inviteForm);
  try {
    const result = await api<{ actor?: AdminActor; csrf?: string }>('/api/admin/auth', {
      method: 'POST',
      body: JSON.stringify({ action: 'accept_invite', token: inviteToken, name: data.get('name'), password: data.get('password') }),
    });
    inviteToken = '';
    applySession(result);
  } catch (error) { setError(friendly(error)); }
});

resetForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  setError();
  setStatusMessage(resetStatus);
  const issue = passwordConfirmationIssue(resetForm, 'password');
  if (issue) return setError(issue);
  if (!resetToken) {
    return setError('This reset link is invalid or has expired. Request a new one below.');
  }
  const data = new FormData(resetForm);
  try {
    await api('/api/admin/auth', {
      method: 'POST',
      body: JSON.stringify({ action: 'reset_password', token: resetToken, password: data.get('password') }),
    });
    resetToken = '';
    resetForm.reset();
    showGate('login');
    setSuccess('Password updated. Sign in with your new password.');
  } catch (error) {
    setError(friendly(error));
    if (error instanceof Error && error.message === 'reset_invalid') {
      resetToken = '';
      setStatusMessage(
        resetStatus,
        'This link no longer works. Use Forgot Password? to request a fresh single-use link.',
      );
    }
  }
});

passwordChangeForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  setAppError();
  const status = document.querySelector<HTMLElement>('[data-admin-password-change-status]');
  setStatusMessage(status);
  const issue = passwordConfirmationIssue(passwordChangeForm, 'newPassword');
  if (issue) return setStatusMessage(status, issue);
  const data = new FormData(passwordChangeForm);
  try {
    await api('/api/admin/accounts', {
      method: 'POST',
      body: JSON.stringify({
        action: 'change_password',
        currentPassword: data.get('currentPassword'),
        newPassword: data.get('newPassword'),
      }),
    });
    passwordChangeForm.reset();
    setStatusMessage(status, 'Password updated. Your other sessions were signed out.');
  } catch (error) {
    setStatusMessage(status, friendly(error));
  }
});

for (const input of document.querySelectorAll<HTMLInputElement>('[data-admin-password-new]')) {
  input.addEventListener('input', () => {
    const problem = passwordProblem(input.value);
    input.setCustomValidity(problem && input.value.length > 0 ? passwordPolicyMessage(problem) : '');
  });
  input.addEventListener('blur', () => {
    const problem = passwordProblem(input.value);
    input.setCustomValidity(problem ? passwordPolicyMessage(problem) : '');
  });
}

for (const input of document.querySelectorAll<HTMLInputElement>('[data-admin-password-confirm]')) {
  input.addEventListener('input', () => {
    const form = input.form;
    const passwordField = form?.querySelector<HTMLInputElement>('input[name="password"], input[name="newPassword"]');
    const mismatch = Boolean(passwordField?.value) && input.value !== passwordField?.value;
    input.setCustomValidity(mismatch ? passwordConfirmationMessage('password_mismatch') : '');
  });
}

document.querySelector<HTMLButtonElement>('[data-admin-logout]')?.addEventListener('click', async () => {
  try { await api('/api/admin/auth', { method: 'POST', body: JSON.stringify({ action: 'logout' }) }); }
  finally { csrf = ''; actor = null; setSuccess(); showGate('login'); }
});

for (const button of navButtons) button.addEventListener('click', () => void loadView(button.dataset.adminNav ?? 'overview'));

document.querySelector<HTMLFormElement>('[data-admin-gift-filter]')?.addEventListener('submit', (event) => {
  event.preventDefault();
  const data = new FormData(event.currentTarget as HTMLFormElement);
  void loadGifts(String(data.get('q') ?? ''), String(data.get('status') ?? ''));
});

document.querySelector<HTMLFormElement>('[data-admin-customer-search]')?.addEventListener('submit', (event) => {
  event.preventDefault();
  const data = new FormData(event.currentTarget as HTMLFormElement);
  void loadCustomers(String(data.get('q') ?? ''));
});

document.querySelector<HTMLFormElement>('[data-admin-lead-filter]')?.addEventListener('submit', (event) => {
  event.preventDefault();
  const data = new FormData(event.currentTarget as HTMLFormElement);
  void loadLeads(String(data.get('status') ?? ''), String(data.get('q') ?? ''));
});

document.addEventListener('change', (event) => {
  const target = event.target as HTMLInputElement | HTMLSelectElement;
  if (target.matches('[data-admin-customer-options]') && currentView === 'recurring') void loadPropertiesFor(target.value);
  if (target.matches('[data-request-customer]')) {
    const form = target.closest('form');
    const property = form?.querySelector<HTMLSelectElement>('[data-request-property]');
    if (property) void loadRequestProperties(target.value, property);
  }
  if (target.matches('[data-checklist-item]')) {
    void api('/api/admin/operations', {
      method: 'POST',
      body: JSON.stringify({ action: 'checklist_item', itemId: target.dataset.checklistItem, completed: (target as HTMLInputElement).checked }),
    }).catch((error) => setAppError(friendly(error)));
  }
});

document.addEventListener('submit', (event) => {
  const form = event.target as HTMLFormElement;
  const kind = form.dataset.form ?? '';
  if (!kind) return;
  event.preventDefault();
  const data = new FormData(form);
  const value = (key: string) => String(data.get(key) ?? '');
  const checked = (key: string) => data.get(key) === 'yes';
  if (kind === 'customer-create' || kind === 'customer-update') {
    void action('/api/admin/customers', {
      action: kind === 'customer-update' ? 'update' : 'create',
      customerId: value('customerId'), firstName: value('firstName'), lastName: value('lastName'),
      companyName: value('companyName'), email: value('email'), phone: value('phone'),
      status: value('status'), notesSummary: value('notesSummary'), doNotContact: checked('doNotContact'),
      marketingConsent: checked('marketingConsent'), addressLine1: value('addressLine1'),
      city: value('city'), state: value('state'), postalCode: value('postalCode'),
    });
  }
  if (kind === 'property-add') void action('/api/admin/customers', { action: 'add_property', customerId: value('customerId'), label: value('label'), line1: value('line1'), city: value('city'), state: value('state'), postalCode: value('postalCode'), accessNotes: value('accessNotes') });
  if (kind === 'note-add') void action('/api/admin/customers', { action: 'add_note', customerId: value('customerId'), body: value('body') });
  if (kind === 'payment') void action('/api/admin/finance', { action: 'record_payment', invoiceId: value('invoiceId'), provider: value('provider'), amount: value('amount'), reference: value('reference'), idempotencyKey: value('idempotencyKey') });
  if (kind === 'refund') void action('/api/admin/finance', { action: 'record_refund', paymentId: value('paymentId'), amount: value('amount'), reason: value('reason') });
  if (kind === 'credit') void action('/api/admin/finance', { action: 'create_credit', customerId: value('customerId'), amount: value('amount'), source: value('source') });
  if (kind === 'offsession') {
    setAppError();
    void api<Record<string, unknown>>('/api/admin/payment-authorizations', {
      method: 'POST',
      body: JSON.stringify({
        action: 'charge_invoice',
        invoiceId: value('invoiceId'),
        authorizationId: value('authorizationId'),
        password: value('password'),
      }),
    }).then((result) => {
      if (result.clientSecret) {
        setAppError('The card requires customer authentication before the charge can complete.');
        return;
      }
      return openInvoice(value('invoiceId'));
    }).catch((error) => setAppError(friendly(error)));
  }
  if (kind === 'stripe-refund') {
    void action('/api/admin/finance', {
      action: 'stripe_refund',
      paymentId: value('paymentId'),
      amountCents: Math.round(Number(value('amount')) * 100),
      password: value('password'),
    });
  }
  if (kind === 'payment-auth') {
    setAppError();
    void api<{ link: string; expiresAt: string }>('/api/admin/payment-authorizations', {
      method: 'POST',
      body: JSON.stringify({
        action: 'create',
        customerId: value('customerId'),
        propertyId: value('propertyId'),
        serviceCode: value('serviceCode'),
        amountCents: Math.round(Number(value('amount')) * 100),
        maxAmountCents: Math.round(Number(value('maxAmount')) * 100),
        chargeAfterService: true,
      }),
    }).then((result) => {
      const target = document.querySelector<HTMLElement>('[data-payment-auth-result]');
      if (target) target.innerHTML = `<p><a href="${esc(result.link)}" target="_blank" rel="noopener noreferrer">${esc(result.link)}</a></p><p class="admin-muted">Single-use signing link. Expires ${esc(dateTime(result.expiresAt))}.</p>`;
    }).catch((error) => setAppError(friendly(error)));
  }
  if (kind === 'gift-action') {
    void action('/api/admin/gifts', {
      action: value('giftAction'),
      code: value('code'),
      amountCents: Math.round(Number(value('amount')) * 100),
      note: value('note'),
      reference: value('reference'),
      password: value('password'),
    }).then(() => loadGifts());
  }
  const iso = (raw: string): string => {
    const parsed = new Date(raw);
    return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : '';
  };
  if (kind === 'request-link') void submitRequestAction({ action: 'link_customer', requestId: value('requestId'), customerId: value('customerId'), propertyId: value('propertyId') });
  if (kind === 'request-create') void submitRequestAction({
    action: 'create_customer', requestId: value('requestId'), firstName: value('firstName'), lastName: value('lastName'),
    email: value('email'), phone: value('phone'), addressLine1: value('addressLine1'), city: value('city'),
    state: value('state'), postalCode: value('postalCode'),
  });
  if (kind === 'request-confirm') void submitRequestAction({ action: 'confirm', requestId: value('requestId') });
  if (kind === 'request-decline') void submitRequestAction({ action: 'decline', requestId: value('requestId'), reason: value('reason'), notify: checked('notify') });
  if (kind === 'request-notify') void submitRequestAction({ action: 'notify', requestId: value('requestId') });
  if (kind === 'request-propose' || kind === 'request-reschedule') {
    const start = iso(value('start'));
    const end = iso(value('end'));
    if (!start || !end) {
      setAppError('Choose a valid start and end time in Central Time.');
    } else {
      void submitRequestAction({
        action: kind === 'request-propose' ? 'propose' : 'reschedule',
        requestId: value('requestId'),
        date: value('start').slice(0, 10),
        start,
        end,
      });
    }
  }
  if (kind === 'request-cancel') void submitRequestAction({ action: 'cancel', requestId: value('requestId'), reason: value('reason'), notify: checked('notify') });
  if (kind === 'time-correct') {
    const start = iso(value('startedAt'));
    const end = iso(value('endedAt'));
    if (!start || !end) {
      setAppError('Choose a valid start and end time in Central Time.');
    } else {
      void action('/api/admin/timekeeping', {
        action: 'correct_interval', intervalId: value('intervalId'), startedAt: start, endedAt: end,
        kind: value('kind'), rateType: value('rateType'), paid: checked('paid'), reason: value('reason'),
      });
    }
  }
  if (kind === 'time-invite') {
    setAppError();
    void api<{ token?: string; expiresAt?: string; emailSent?: boolean }>('/api/admin/timekeeping', {
      method: 'POST',
      body: JSON.stringify({ action: 'invite_employee', email: value('email') }),
    }).then((result) => {
      const target = document.querySelector<HTMLElement>('[data-time-invite-result]');
      if (!target) return;
      const link = result.token ? `${window.location.origin}/employee/?invite=${encodeURIComponent(result.token)}` : '';
      target.innerHTML = result.emailSent
        ? '<p class="admin-muted">Invitation email sent.</p>'
        : `<p class="admin-muted">Email was not sent. Share this one-time link directly:</p><p><a href="${esc(link)}">${esc(link)}</a></p>`;
      form.reset();
    }).catch((error) => setAppError(friendly(error)));
  }
  if (kind === 'time-link') void action('/api/admin/timekeeping', { action: 'link_member', email: value('email'), teamMemberId: value('teamMemberId') });
  if (kind === 'time-rate') {
    const hourly = Number(value('hourly'));
    if (!Number.isFinite(hourly) || hourly < 0) {
      setAppError('Enter a valid hourly rate.');
    } else {
      void action('/api/admin/timekeeping', {
        action: 'set_rate', teamMemberId: value('teamMemberId'), rateType: value('rateType'),
        hourlyCents: Math.round(hourly * 100), effectiveFrom: value('effectiveFrom'),
      });
    }
  }
  if (kind === 'gift-invoice') {
    setAppError();
    void api('/api/admin/gifts', {
      method: 'POST',
      body: JSON.stringify({
        action: 'redeem',
        invoiceId: value('invoiceId'),
        code: value('code'),
        amountCents: Math.round(Number(value('amount')) * 100),
        password: value('password'),
        note: `Applied to invoice ${value('invoiceId')}`,
      }),
    }).then(() => openInvoice(value('invoiceId'))).catch((error) => setAppError(friendly(error)));
  }
  if (kind === 'mfa-disable') {
    void api('/api/admin/accounts', { method: 'POST', body: JSON.stringify({ action: 'mfa_disable', password: value('password'), code: value('code') }) })
      .then(() => { if (actor) actor.mfaEnabled = false; return loadView('settings'); })
      .catch((error) => setAppError(friendly(error)));
  }
  if (kind === 'mfa-enable') {
    void api<{ recoveryCodes?: string[] }>('/api/admin/accounts', { method: 'POST', body: JSON.stringify({ action: 'mfa_enable', code: value('code') }) })
      .then((result) => {
        const target = document.querySelector<HTMLElement>('[data-admin-mfa-setup]');
        if (target) target.innerHTML = `<div class="admin-card"><p><strong>Two-step verification enabled.</strong></p><p>Save these one-time recovery codes now. They will not be shown again.</p><pre>${(result.recoveryCodes ?? []).map(esc).join('\n')}</pre></div>`;
        if (actor) actor.mfaEnabled = true;
      })
      .catch((error) => setAppError(friendly(error)));
  }
});

for (const form of [
  document.querySelector<HTMLFormElement>('[data-admin-recurring-create]'),
  document.querySelector<HTMLFormElement>('[data-admin-team-create]'),
  document.querySelector<HTMLFormElement>('[data-admin-invoice-create]'),
  document.querySelector<HTMLFormElement>('[data-admin-invite-create]'),
]) {
  form?.addEventListener('submit', (event) => {
    event.preventDefault();
    const data = new FormData(form);
    if (form.matches('[data-admin-recurring-create]')) {
      void action('/api/admin/operations', { action: 'create_recurring', customerId: data.get('customerId'), propertyId: data.get('propertyId'), frequency: data.get('frequency'), startDate: data.get('startDate'), ongoingPrice: data.get('ongoingPrice') });
    }
    if (form.matches('[data-admin-team-create]')) {
      void action('/api/admin/operations', { action: 'create_team', displayName: data.get('displayName'), email: data.get('email') });
    }
    if (form.matches('[data-admin-invoice-create]')) {
      const amount = Number(data.get('amount'));
      void action('/api/admin/finance', { action: 'create_invoice', customerId: data.get('customerId'), dueDate: data.get('dueDate'), lines: [{ kind: 'service', description: data.get('description'), quantity: 1, unitAmountCents: Math.round(amount * 100), totalCents: Math.round(amount * 100) }] });
    }
    if (form.matches('[data-admin-invite-create]')) {
      setAppError();
      void api<{ token: string; expiresAt: string; emailSent?: boolean }>('/api/admin/accounts', {
        method: 'POST',
        body: JSON.stringify({ action: 'invite', email: data.get('email'), role: data.get('role'), branchId: data.get('branchId') }),
      }).then((result) => {
        const link = `${window.location.origin}/admin/?invite=${encodeURIComponent(result.token)}`;
        const target = document.querySelector<HTMLElement>('[data-admin-invite-result]');
        if (target) target.innerHTML = `<div class="admin-card"><p><strong>One-time invitation</strong> (expires ${esc(dateTime(result.expiresAt))})</p><p><a href="${esc(link)}">${esc(link)}</a></p><p class="admin-muted">${result.emailSent ? 'Invitation email sent.' : 'Email is not configured or failed; copy this private link. It works once.'}</p></div>`;
        form.reset();
      }).catch((error) => setAppError(friendly(error)));
    }
  });
}

document.addEventListener('click', (event) => {
  const target = (event.target as HTMLElement).closest<HTMLElement>('[data-admin-action]');
  const newCustomer = (event.target as HTMLElement).closest<HTMLElement>('[data-admin-customer-new]');
  if (newCustomer) { renderCustomerCreate(); return; }
  const revokeOthers = (event.target as HTMLElement).closest<HTMLElement>('[data-admin-revoke-others]');
  if (revokeOthers) { void action('/api/admin/accounts', { action: 'revoke_others' }); return; }
  const giftAction = (event.target as HTMLElement).closest<HTMLElement>('[data-gift-action]');
  if (giftAction) {
    renderGiftAction(giftAction.dataset.giftCode ?? '', giftAction.dataset.giftAction ?? 'redeem');
    return;
  }
  if (!target) return;
  const actionName = target.dataset.adminAction ?? '';
  const id = target.dataset.id ?? '';
  if (actionName === 'time-load') void loadTimekeeping();
  if (actionName === 'time-export') {
    const week = document.querySelector<HTMLInputElement>('[data-time-week]')?.value ?? '';
    void fetch(`/api/admin/timekeeping?export=csv${week ? `&weekStart=${encodeURIComponent(week)}` : ''}`, {
      credentials: 'same-origin',
      headers: { Accept: 'text/csv' },
    })
      .then(async (response) => {
        if (!response.ok) throw new Error('export_failed');
        const blob = await response.blob();
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `sparkling-standard-timecards-${week || 'week'}.csv`;
        link.click();
        URL.revokeObjectURL(link.href);
      })
      .catch((error) => setAppError(friendly(error)));
  }
  if (actionName === 'time-edit') {
    const interval = timeIntervals.find((entry) => entry.id === id);
    const correctionForm = document.querySelector<HTMLFormElement>('[data-form="time-correct"]');
    if (interval && correctionForm) {
      const field = (name: string) => correctionForm.querySelector<HTMLInputElement | HTMLSelectElement>(`[name="${name}"]`);
      const intervalId = field('intervalId') as HTMLInputElement | null;
      if (intervalId) intervalId.value = id;
      const start = field('startedAt') as HTMLInputElement | null;
      const end = field('endedAt') as HTMLInputElement | null;
      const kind = field('kind') as HTMLSelectElement | null;
      const rate = field('rateType') as HTMLSelectElement | null;
      const paid = correctionForm.querySelector<HTMLInputElement>('input[name="paid"]');
      if (start) start.value = centralInputValue(interval.started_at);
      if (end) end.value = centralInputValue(interval.ended_at);
      if (kind) kind.value = String(interval.kind ?? 'work');
      if (rate) rate.value = String(interval.rate_type ?? 'regular');
      if (paid) paid.checked = Boolean(Number(interval.paid));
      correctionForm.closest('details')?.setAttribute('open', '');
      correctionForm.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }
  if (actionName === 'time-review') {
    void action('/api/admin/timekeeping', { action: 'review_correction', correctionId: id, approve: target.dataset.approve === 'yes' });
  }
  if (actionName === 'request-open') void openRequest(id).catch((error) => setAppError(friendly(error)));
  if (actionName === 'request-close') { const detail = document.querySelector<HTMLElement>('[data-admin-request-detail]'); if (detail) { detail.hidden = true; detail.innerHTML = ''; } }
  if (actionName === 'customer-open') void openCustomer(id).catch((error) => setAppError(friendly(error)));
  if (actionName === 'customer-create') renderCustomerCreate();
  if (actionName === 'lead-save') {
    const select = document.querySelector<HTMLSelectElement>(`[data-lead-status="${CSS.escape(id)}"]`);
    void action('/api/admin/leads', { action: 'update', leadId: id, status: select?.value ?? '' });
  }
  if (actionName === 'lead-retry') void action('/api/admin/leads', { action: 'retry_notification', leadId: id });
  if (actionName === 'recurring-save') {
    const select = document.querySelector<HTMLSelectElement>(`[data-recurring-status="${CSS.escape(id)}"]`);
    void action('/api/admin/operations', { action: 'update_recurring', planId: id, status: select?.value ?? '' });
  }
  if (actionName === 'job-save') {
    const select = document.querySelector<HTMLSelectElement>(`[data-job-status="${CSS.escape(id)}"]`);
    void action('/api/admin/operations', { action: 'job_status', appointmentId: id, status: select?.value ?? '' });
  }
  if (actionName === 'job-assign') {
    const select = document.querySelector<HTMLSelectElement>(`[data-job-team="${CSS.escape(id)}"]`);
    if (select?.value) void action('/api/admin/operations', { action: 'assign_team', appointmentId: id, teamMemberIds: [select.value] });
  }
  if (actionName === 'job-checklist') void openChecklist(id).catch((error) => setAppError(friendly(error)));
  if (actionName === 'checklist-create') void action('/api/admin/operations', { action: 'create_checklist', appointmentId: id }).then(() => openChecklist(id));
  if (actionName === 'invoice-open') void openInvoice(id).catch((error) => setAppError(friendly(error)));
  if (actionName === 'invoice-link') {
    setAppError();
    void api<{ url: string }>('/api/admin/finance', { method: 'POST', body: JSON.stringify({ action: 'payment_link', invoiceId: id }) })
      .then(() => openInvoice(id))
      .catch((error) => setAppError(friendly(error)));
  }
  if (actionName === 'mfa-start') {
    setAppError();
    void api<{ secret: string; uri: string }>('/api/admin/accounts', { method: 'POST', body: JSON.stringify({ action: 'mfa_setup' }) })
      .then((result) => {
        const target = document.querySelector<HTMLElement>('[data-admin-mfa-setup]');
        if (target) target.innerHTML = `<div class="admin-card"><p><strong>Add this account to your authenticator.</strong></p><p class="admin-code">${esc(result.secret)}</p><p><a href="${esc(result.uri)}">Open authenticator link</a></p><form class="admin-form" data-form="mfa-enable"><label>Current code <input name="code" inputmode="numeric" maxlength="6" required /></label><button class="btn btn--primary btn--small" type="submit">Enable two-step verification</button></form></div>`;
      }).catch((error) => setAppError(friendly(error)));
  }
  if (actionName === 'admin-reset') {
    setAppError();
    void api<{ token: string; expiresAt: string; email: string; emailSent?: boolean }>('/api/admin/accounts', { method: 'POST', body: JSON.stringify({ action: 'issue_reset', userId: id }) })
      .then((result) => {
        const link = `${window.location.origin}/admin/?reset=${encodeURIComponent(result.token)}`;
        const target = document.querySelector<HTMLElement>('[data-admin-invite-result]');
        if (target) target.innerHTML = `<div class="admin-card"><p><strong>One-time reset for ${esc(result.email)}</strong> (expires ${esc(dateTime(result.expiresAt))})</p><p><a href="${esc(link)}">${esc(link)}</a></p><p class="admin-muted">${result.emailSent ? 'Reset email sent.' : 'Email is not configured or failed; copy this private link.'}</p></div>`;
      }).catch((error) => setAppError(friendly(error)));
  }
  if (actionName === 'admin-toggle') void action('/api/admin/accounts', { action: 'status', userId: id, status: target.dataset.status });
  if (actionName === 'admin-revoke') void action('/api/admin/accounts', { action: 'revoke_user', userId: id });
  if (actionName === 'revoke-others') void action('/api/admin/accounts', { action: 'revoke_others' });
});

void loadAuth();
