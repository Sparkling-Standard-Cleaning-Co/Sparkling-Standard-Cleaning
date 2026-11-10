import {
  passwordConfirmationMessage,
  passwordConfirmationProblem,
  passwordPolicyMessage,
  passwordProblem,
} from '../lib/password-policy.ts';
import { loadPricingView } from './pricing-admin';
import { PET_OPTIONS, PROPERTY_TYPE_OPTIONS, RESIDENTIAL_INPUT_LIMITS } from '../config/estimators/input-definitions';
import { pricing } from '../config/pricing';

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
  'new-booking': ['New Booking', 'Create a one-time estimate and booking from a saved customer and property.'],
  recurring: ['Recurring Plans', 'Recurring cleaning administration.'],
  jobs: ['Jobs & Team', 'Cleaning jobs, assignments and checklists.'],
  documents: ['Documents & Agreements', 'Owner-controlled templates, bundles and electronic signatures.'],
  timekeeping: ['Timekeeping', 'Employee hours, corrections and location verification.'],
  finance: ['Invoices & Payments', 'Invoicing, payments, credits and reconciliation.'],
  gift: ['Gift Certificates', 'Existing production gift register.'],
  reports: ['Reports', 'Operational and financial reporting.'],
  storage: ['Data & Storage', 'Database health, business-record counts, exports and photo retention.'],
  promotions: ['Promotions & Discounts', 'Owner-controlled codes, schedules, limits and redemption reporting.'],
  pricing: ['Pricing & Estimator Control', 'Published prices, draft changes, simulations and version history.'],
  settings: ['Settings & Audit', 'Access, security, configuration and audit history.'],
};

const navPermission: Record<string, string> = {
  calendar: 'booking.read',
  leads: 'lead.read',
  customers: 'customer.read',
  'new-booking': 'booking.write',
  recurring: 'job.read',
  jobs: 'job.read',
  documents: 'job.read',
  timekeeping: 'job.write',
  finance: 'finance.read',
  gift: 'finance.read',
  reports: 'finance.read',
  pricing: 'settings.write',
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
    recurring_scheduling_gated:
      'Recurring scheduling is temporarily disabled in this deployment. Existing plans and appointments are unchanged. Ask the owner to enable recurring scheduling.',
    recurring_property_location_missing:
      'The property address could not be located for scheduling. Check the saved address or add the map coordinates, then use Sync.',
    recurring_property_coordinates_missing:
      'The property has no usable map coordinates. Correct the saved property location, then use Sync.',
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
  const data = await api<{
    counts?: Record<string, number>;
    alerts?: Array<Record<string, unknown>>;
    recentLeads?: Array<Record<string, unknown>>;
  }>('/api/admin/overview');
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
      ['Booking recovery', counts.failedCommitments ?? 0],
      ['Financial issues', counts.financialIssues ?? 0],
      ['Failed emails', counts.failedNotifications ?? 0],
      ['Failed payment events', counts.failedPaymentEvents ?? 0],
      ['Recurring failures', counts.failedWorkerRuns ?? 0],
    ].map(([label, value]) => `<div class="admin-card admin-kpi"><p class="admin-kpi__label">${esc(label)}</p><p class="admin-kpi__value">${esc(value)}</p></div>`).join('');
  }
  const alerts = document.querySelector<HTMLElement>('[data-admin-alerts]');
  if (alerts) {
    const rows = data.alerts ?? [];
    alerts.innerHTML = rows.length
      ? `<div class="admin-card"><h2 class="admin-section-title">Action required</h2>${rows
          .map(
            (alert) =>
              `<p class="${String(alert.severity) === 'high' ? 'admin-error' : 'admin-muted'}">${esc(
                alert.message,
              )} <button class="btn btn--ghost btn--small" type="button" data-admin-action="overview-open" data-view="${esc(
                alert.view,
              )}">Open</button></p>`,
          )
          .join('')}</div>`
      : '<p class="admin-muted">No operational exceptions are open.</p>';
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

function requestStage(request: Record<string, unknown>): string {
  if (request.archived_at) return 'Archived';
  if (request.duplicate_of_request_id) return 'Closed as duplicate';
  if (request.closed_at) return 'Closed';
  const appointment = String(request.appointment_status ?? '');
  if (appointment === 'in_progress') return 'In progress';
  if (appointment === 'completed') return 'Completed';
  if (appointment === 'cancelled' || appointment === 'no_show') return 'Declined / cancelled';
  if (['declined', 'released', 'expired'].includes(String(request.status))) return 'Declined / cancelled';
  if (String(request.status) === 'confirmed') return 'Confirmed appointment';
  if (String(request.status) === 'pending') return 'Pending request';
  return titleCase(String(request.status ?? ''));
}

function requestPayment(request: Record<string, unknown>): string {
  const status = String(request.payment_status ?? 'unpaid');
  const amount = Number(request.payment_amount_cents);
  const label =
    status === 'paid_confirmed' ? 'Paid ? confirmed'
      : status === 'paid_awaiting_photos' ? 'Paid ? awaiting photos'
        : status === 'paid_awaiting_confirmation' ? 'Paid ? awaiting confirmation'
          : status === 'payment_failed' ? 'Payment incomplete / failed'
            : status === 'refunded' || status === 'disputed' ? titleCase(status)
              : 'Unpaid ? awaiting approval';
  const reference = String(request.payment_reference ?? '').trim();
  return `${label}${Number.isFinite(amount) && amount > 0 ? ` ? ${money(amount)}` : ''}${reference ? ` (${reference})` : ''}`;
}

async function loadCalendar(view = 'actionable', query = ''): Promise<void> {
  const data = await api<{ requests?: Array<Record<string, unknown>>; appointments?: Array<Record<string, unknown>> }>(
    `/api/admin/requests?view=${encodeURIComponent(view)}&q=${encodeURIComponent(query)}`,
  );
  const requests = document.querySelector<HTMLElement>('[data-admin-requests]');
  if (requests) {
    renderTable(requests, ['Start', 'Reference', 'Customer', 'Property', 'Payment', 'Status', 'Action'], (data.requests ?? []).map((request) => [
      esc(dateTime(request.start_at)),
      esc(request.quote_reference),
      esc([request.first_name, request.last_name].filter(Boolean).join(' ') || 'Unlinked request'),
      esc(requestLocation(request)),
      esc(requestPayment(request)),
      `<span class="admin-status">${esc(requestStage(request))}</span>`,
      `<button class="btn btn--ghost btn--small" type="button" data-admin-action="request-open" data-id="${esc(request.id)}">Open</button>`,
    ]), query ? 'No requests match this search.' : 'No requests match this view.');
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
  const documentRequests = request.quote_reference
    ? await api<{ requests?: Array<Record<string, unknown>> }>(
        `/api/admin/documents?view=requests&bookingReference=${encodeURIComponent(String(request.quote_reference))}`,
      ).then((result) => result.requests ?? []).catch(() => [])
    : [];
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
            <dl class="admin-definition"><dt>Appointment</dt><dd>${esc(request.appointment_reference || '—')} · ${esc(request.appointment_status || '')}</dd><dt>Payment</dt><dd>${esc(requestPayment(request))}</dd>
      <dt>Calendar event</dt><dd>${esc(request.calendar_event_id || 'Not linked')}</dd></dl>
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

  const lifecycleActions = !can('booking.write')
    ? ''
    : pending
      ? `<div class="admin-card" style="margin-top:1rem;">
          <h3>Close this request</h3>
          <p class="admin-muted">Closing releases any temporary hold. Records and customer history are preserved.</p>
          <form class="admin-form" data-form="request-close">
            <input type="hidden" name="requestId" value="${esc(requestId)}" />
            <label>Reason (optional) <input name="reason" maxlength="500" /></label>
            <button class="btn btn--danger btn--small" type="submit">Close Request</button>
          </form>
          <details class="admin-detail-toggle" style="margin-top:1rem;"><summary>Close as duplicate</summary>
            <form class="admin-form" data-form="request-duplicate">
              <input type="hidden" name="requestId" value="${esc(requestId)}" />
              <label>Original reference or request ID <input name="duplicateOf" required maxlength="120" /></label>
              ${duplicates.length ? `<p class="admin-muted">Possible originals: ${duplicates.map((item) => esc(item.quote_reference)).join(', ')}</p>` : ''}
              <button class="btn btn--danger btn--small" type="submit">Close as Duplicate</button>
            </form>
          </details>
        </div>`
      : '';
  const archiveAction = !can('booking.write') || request.archived_at
    ? ''
    : status === 'pending' || status === 'confirmed' || ['pending', 'confirmed', 'in_progress'].includes(String(request.appointment_status ?? ''))
      ? ''
      : `<form class="admin-inline-form" data-form="request-archive" style="margin-top:.75rem;"><input type="hidden" name="requestId" value="${esc(requestId)}" /><button class="btn btn--ghost btn--small" type="submit">Archive Request</button></form>`;
  const reopenAction = !can('booking.write') || (!request.closed_at && !request.archived_at)
    ? ''
    : `<form class="admin-inline-form" data-form="request-reopen" style="margin-top:.75rem;"><input type="hidden" name="requestId" value="${esc(requestId)}" /><button class="btn btn--secondary btn--small" type="submit">Reopen Request</button></form>`;
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
    <h3 style="margin-top:1rem;">Documents &amp; agreements</h3>
    ${documentRequests.length ? documentRequests.map((entry) => `<div class="admin-record"><p><strong>${esc(entry.bundle_code)}</strong> — ${esc(titleCase(entry.status))}</p><p class="admin-muted">Signed ${esc(entry.signed_count)} · Awaiting verification ${esc(entry.awaiting_verification)}</p></div>`).join('') : '<p class="admin-muted">No signing requests recorded for this booking.</p>'}
    <h3 style="margin-top:1rem;">Customer email history</h3>
    ${notificationRows}
    ${email ? `<form class="admin-inline-form" data-form="request-notify" style="margin-top:.75rem;"><input type="hidden" name="requestId" value="${esc(requestId)}" /><button class="btn btn--ghost btn--small" type="submit">Resend last customer email</button></form>` : ''}
  </div>${association}${actions}${lifecycleActions}${archiveAction}${reopenAction}`;
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

function optionMarkup(
  options: readonly { value: string; label: string }[],
  current: unknown,
  blankLabel: string,
): string {
  const selected = String(current ?? '');
  return `<option value="">${esc(blankLabel)}</option>${options
    .map((option) => `<option value="${esc(option.value)}"${option.value === selected ? ' selected' : ''}>${esc(option.label)}</option>`)
    .join('')}`;
}

function propertyFields(property: Record<string, unknown> = {}, options: { firstProperty?: boolean } = {}): string {
  const propertyType = String(property.property_type ?? '');
  const pets = String(property.pets ?? '');
  const isPrimary = options.firstProperty ? true : Number(property.is_primary) === 1;
  const numberInput = (name: string, label: string, limits: { min: number; max: number; step?: number }, value: unknown, hint = '') =>
    `<label>${esc(label)}${hint ? ` <span class="admin-muted">${esc(hint)}</span>` : ''}<input name="${name}" type="number" min="${limits.min}" max="${limits.max}" step="${limits.step ?? 1}" value="${value === null || value === undefined ? '' : esc(value)}" /></label>`;
  return `<div class="admin-form--grid">
    <label>Property label <input name="label" value="${esc(property.label ?? 'Service property')}" maxlength="80" /></label>
    <label class="admin-field--wide">Street address <input name="line1" value="${esc(property.line1 ?? '')}" maxlength="200" required /></label>
    <label>Address line 2 <input name="line2" value="${esc(property.line2 ?? '')}" maxlength="120" /></label>
    <label>City <input name="city" value="${esc(property.city ?? '')}" maxlength="80" /></label>
    <label>State <input name="state" value="${esc(property.state ?? 'FL')}" maxlength="2" /></label>
    <label>ZIP <input name="postalCode" value="${esc(property.postal_code ?? '')}" inputmode="numeric" maxlength="10" /></label>
    <label>Property type <select name="propertyType">${optionMarkup(PROPERTY_TYPE_OPTIONS, propertyType, 'Not specified')}</select></label>
    ${numberInput('squareFeet', 'Square footage', RESIDENTIAL_INPUT_LIMITS.squareFeet, property.square_feet)}
    ${numberInput('bedrooms', 'Bedrooms', RESIDENTIAL_INPUT_LIMITS.bedrooms, property.bedrooms)}
    ${numberInput('fullBaths', 'Full bathrooms', RESIDENTIAL_INPUT_LIMITS.fullBaths, property.full_baths)}
    ${numberInput('halfBaths', 'Half bathrooms', RESIDENTIAL_INPUT_LIMITS.halfBaths, property.half_baths)}
    ${numberInput('stories', 'Floors / stories', { min: 0, max: 20, step: 1 }, property.stories)}
    ${numberInput('beds', 'Beds to reset (STR)', RESIDENTIAL_INPUT_LIMITS.beds, property.beds)}
    <label>Pets <select name="pets">${optionMarkup(PET_OPTIONS, pets, 'Not specified')}</select></label>
    <label class="admin-field--wide">Access instructions <textarea name="accessNotes" rows="2" maxlength="1000">${esc(property.access_notes ?? '')}</textarea></label>
    <label class="admin-field--wide">Parking instructions <textarea name="parkingNotes" rows="2" maxlength="1000">${esc(property.parking_notes ?? '')}</textarea></label>
    <label class="admin-field--wide">Internal property notes <textarea name="internalNotes" rows="2" maxlength="4000">${esc(property.internal_notes ?? '')}</textarea></label>
    <label><input type="checkbox" name="isPrimary" value="yes"${isPrimary ? ' checked' : ''} /> Primary property</label>
  </div>`;
}

function propertyProfileSummary(property: Record<string, unknown>): string {
  const type = PROPERTY_TYPE_OPTIONS.find((option) => option.value === property.property_type)?.label;
  const pet = PET_OPTIONS.find((option) => option.value === property.pets)?.label;
  const specs = [
    type,
    property.square_feet ? `${property.square_feet} sq ft` : '',
    property.bedrooms !== null && property.bedrooms !== undefined ? `${property.bedrooms} bedrooms` : '',
    property.full_baths !== null && property.full_baths !== undefined ? `${property.full_baths} full baths` : '',
    property.half_baths ? `${property.half_baths} half baths` : '',
    property.stories ? `${property.stories} stories` : '',
    property.beds ? `${property.beds} beds to reset` : '',
    pet,
  ].filter(Boolean);
  return `<p>${esc([property.line1, property.line2, property.city, property.state, property.postal_code].filter(Boolean).join(', '))}</p>
    ${specs.length ? `<p class="admin-muted">${esc(specs.join(' · '))}</p>` : ''}
    ${property.access_notes ? `<p class="admin-muted"><strong>Access:</strong> ${esc(property.access_notes)}</p>` : ''}
    ${property.parking_notes ? `<p class="admin-muted"><strong>Parking:</strong> ${esc(property.parking_notes)}</p>` : ''}
    ${property.internal_notes ? `<p class="admin-muted"><strong>Internal property note:</strong> ${esc(property.internal_notes)}</p>` : ''}`;
}

function customerForm(customer: Record<string, unknown> = {}): string {
  return `<form class="admin-form admin-form--grid" style="max-width:none" data-form="${customer.id ? 'customer-update' : 'customer-create'}">
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
    ${customer.id ? '' : `<fieldset class="admin-field--wide"><legend>First property (optional)</legend>${propertyFields({}, { firstProperty: true })}</fieldset>`}
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
  const documentRequests = await api<{ requests?: Array<Record<string, unknown>> }>(
    `/api/admin/documents?view=requests&customerId=${encodeURIComponent(customerId)}`,
  ).then((result) => result.requests ?? []).catch(() => []);
  const email = contacts.find((contact) => contact.kind === 'email')?.value ?? customer.email ?? '';
  const phone = contacts.find((contact) => contact.kind === 'phone')?.value ?? customer.phone ?? '';
  detail.hidden = false;
  detail.innerHTML = `<div class="admin-card">
    <div class="admin-detail-head"><h2 class="admin-section-title">${esc([customer.first_name, customer.last_name].filter(Boolean).join(' ') || customer.company_name || 'Customer')}</h2><div class="admin-actions"><button class="btn btn--ghost btn--small" type="button" data-admin-action="customer-edit">Edit Customer</button><form class="admin-inline-form" data-form="customer-archive"><input type="hidden" name="customerId" value="${esc(customerId)}" /><input type="hidden" name="targetStatus" value="${customer.status === 'archived' ? 'active' : 'archived'}" /><button class="btn btn--ghost btn--small" type="submit">${customer.status === 'archived' ? 'Restore Archived Customer' : 'Archive Customer'}</button></form>${actor?.role === 'owner' ? `<form class="admin-inline-form" data-form="customer-delete"><input type="hidden" name="customerId" value="${esc(customerId)}" /><button class="btn btn--danger btn--small" type="submit">Delete Customer</button></form>` : ''}<button class="btn btn--ghost btn--small" type="button" data-admin-action="customer-create">Close</button></div></div>
    <dl class="admin-definition"><dt>Status</dt><dd>${esc(customer.status)}</dd><dt>Branch</dt><dd>${esc(customer.branch_name)}</dd><dt>Source</dt><dd>${esc(customer.source)}</dd><dt>Contacts</dt><dd>${contacts.map((contact) => `${esc(titleCase(contact.kind))}: ${esc(contact.value)}`).join('<br />') || '—'}</dd></dl>
    <h3>Properties</h3>
    ${properties.map((property) => `<div class="admin-record"><strong>${esc(property.label)}${Number(property.is_primary) === 1 ? ' · Primary' : ''}</strong>${propertyProfileSummary(property)}<details class="admin-detail-toggle"><summary>Edit property</summary><form class="admin-form" style="max-width:none" data-form="property-update"><input type="hidden" name="customerId" value="${esc(customerId)}" /><input type="hidden" name="propertyId" value="${esc(property.id)}" />${propertyFields(property)}<label>Status <select name="status"><option value="active"${property.status !== 'archived' ? ' selected' : ''}>Active</option><option value="archived"${property.status === 'archived' ? ' selected' : ''}>Archived</option></select></label><button class="btn btn--secondary btn--small" type="submit">Save property</button></form></details></div>`).join('') || '<p class="admin-muted">No properties.</p>'}
    <details class="admin-detail-toggle"><summary>Add a property</summary><form class="admin-form" style="max-width:none" data-form="property-add"><input type="hidden" name="customerId" value="${esc(customerId)}" />${propertyFields({})}<button class="btn btn--secondary btn--small" type="submit">Add property</button></form></details>
    <h3>History</h3><div class="admin-history">${leads.length ? `<p><strong>Requests:</strong> ${leads.map((lead) => `${esc(lead.request_type)} (${esc(lead.status)})`).join(', ')}</p>` : ''}${estimates.length ? `<p><strong>Estimates:</strong> ${estimates.map((estimate) => `${esc(estimate.quote_reference)} (${money(estimate.total_cents)})`).join(', ')}</p>` : ''}${appointments.length ? `<p><strong>Appointments:</strong> ${appointments.map((appointment) => `${esc(appointment.reference)} (${esc(appointment.status)})`).join(', ')}</p>` : ''}${invoices.length ? `<p><strong>Invoices:</strong> ${invoices.map((invoice) => `${esc(invoice.number)} (${money(invoice.balance_cents)} balance)`).join(', ')}</p>` : ''}</div>
    <h3>Documents &amp; agreements</h3>${documentRequests.length ? documentRequests.map((request) => `<div class="admin-record"><p><strong>${esc(request.bundle_code)}</strong> — ${esc(titleCase(request.status))}</p><p class="admin-muted">Signed ${esc(request.signed_count)} · Awaiting verification ${esc(request.awaiting_verification)} · ${esc(dateTime(request.created_at))}</p></div>`).join('') : '<p class="admin-muted">No signing requests recorded.</p>'}
    <h3>Notes</h3>${notes.map((note) => `<div class="admin-record"><p>${esc(note.body)}</p><p class="admin-muted">${esc(dateTime(note.created_at))}</p></div>`).join('') || '<p class="admin-muted">No notes.</p>'}
    <form class="admin-form" data-form="note-add" style="max-width:none;"><input type="hidden" name="customerId" value="${esc(customerId)}" /><label>Add note <textarea name="body" rows="3" required></textarea></label><button class="btn btn--secondary btn--small" type="submit">Add note</button></form>
    <details class="admin-detail-toggle" data-customer-edit><summary>Edit customer</summary>${customerForm({ ...customer, email, phone })}</details>
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

let recurringSchedulingAvailable = true;

function recurringReasonLabel(reason: string): string {
  const labels: Record<string, string> = {
    travel_unavailable: 'travel route could not be established',
    slot_unavailable: 'no available start time for the requested duration',
    fully_booked: 'fully booked',
    insufficient_resources: 'no qualified crew available',
    crew_unavailable: 'no qualified crew available',
    property_location_missing: 'property address could not be located',
    property_coordinates_missing: 'property map coordinates are missing',
    past_cutoff: 'date is inside the booking cutoff',
    day_closed: 'day is closed',
    beyond_window: 'date is beyond the booking window',
    resource_unavailable: 'assigned resource is unavailable',
    calendar_unavailable: 'Google Calendar is temporarily unavailable',
    calendar_auth_failed: 'Google Calendar authentication failed',
    calendar_write_pending: 'calendar write is pending a retry',
    calendar_update_pending: 'calendar update is pending a retry',
    calendar_write_failed: 'Google Calendar write failed',
    calendar_update_failed: 'Google Calendar update failed',
    calendar_event_missing: 'calendar event is missing',
    calendar_event_unverified: 'calendar event could not be verified',
  };
  return labels[reason] ?? titleCase(reason);
}

function recurringSyncDetail(value: unknown): string {
  return String(value ?? '')
    .split(';')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const separator = entry.indexOf(':');
      if (separator <= 0) return recurringReasonLabel(entry);
      const date = entry.slice(0, separator);
      const reason = entry.slice(separator + 1);
      return `${date}: ${recurringReasonLabel(reason)}`;
    })
    .join(' · ');
}

async function createRecurringPlan(form: HTMLFormElement): Promise<void> {
  const data = new FormData(form);
  const submit = form.querySelector<HTMLButtonElement>('button[type="submit"]');
  if (submit) submit.disabled = true;
  setAppError();
  setSuccess();
  try {
    const result = await api<{
      planId?: string;
      scheduling?: string;
      sync?: { conflicts?: Array<{ date?: string; reason?: string }>; errors?: string[] };
    }>('/api/admin/operations', {
      method: 'POST',
      body: JSON.stringify({
        action: 'create_recurring',
        customerId: data.get('customerId'),
        propertyId: data.get('propertyId'),
        frequency: data.get('frequency'),
        startDate: data.get('startDate'),
        ongoingPrice: data.get('ongoingPrice'),
        window: data.get('window'),
        startTime: data.get('startTime'),
        durationMinutes: data.get('durationMinutes'),
        firstDurationMinutes: data.get('firstDurationMinutes'),
        crewSize: data.get('crewSize'),
      }),
    });
    await loadRecurring();
    if (result.scheduling === 'scheduled') {
      setSuccess('Recurring plan saved and scheduled.');
    } else if (result.scheduling === 'sync_pending') {
      setAppError(
        'Recurring plan saved. Calendar synchronization is pending; the plan already exists, so use Sync to retry and do not submit it again.',
      );
    } else {
      const affected = (result.sync?.conflicts ?? [])
        .map((conflict) => `${conflict.date ?? 'date'}: ${recurringReasonLabel(conflict.reason ?? '')}`)
        .join(' · ');
      setAppError(
        `Recurring plan saved, but scheduling needs attention${affected ? ` — ${affected}` : ''}. The plan already exists; do not create it again. Use Sync to retry.`,
      );
    }
  } catch (error) {
    setAppError(friendly(error));
    await loadRecurring().catch(() => undefined);
  } finally {
    if (submit) submit.disabled = false;
  }
}

async function loadRecurring(): Promise<void> {
  const data = await api<{ recurring?: Array<Record<string, unknown>>; recurringEnabled?: boolean }>(
    '/api/admin/operations?view=recurring',
  );
  const recurringEnabled = data.recurringEnabled !== false;
  recurringSchedulingAvailable = recurringEnabled;
  const notice = document.querySelector<HTMLElement>('[data-admin-recurring-notice]');
  if (notice) {
    notice.innerHTML = recurringEnabled
      ? ''
      : '<p class="admin-error" role="status">Recurring scheduling is temporarily disabled in this deployment. Existing plans and appointments are unchanged. Ask the owner to enable recurring scheduling.</p>';
  }
  const createForm = document.querySelector<HTMLFormElement>('[data-admin-recurring-create]');
  if (createForm) createForm.hidden = !recurringEnabled;
  const writable = can('job.write') && recurringEnabled;
  const target = document.querySelector<HTMLElement>('[data-admin-recurring]');
  if (target) {
    renderTable(target, ['Customer', 'Property', 'Frequency', 'Window', 'Start', 'Duration', 'Price', 'Next visit', 'Sync', 'Status', 'Action'], (data.recurring ?? []).map((plan) => [
      esc([plan.first_name, plan.last_name].filter(Boolean).join(' ')),
      esc([plan.line1, plan.city].filter(Boolean).join(', ')),
      esc(titleCase(plan.frequency)),
      writable ? `<select class="admin-select" data-recurring-window="${esc(plan.id)}"><option value="">Not scheduled</option><option value="morning"${plan.window === 'morning' ? ' selected' : ''}>Morning</option><option value="afternoon"${plan.window === 'afternoon' ? ' selected' : ''}>Afternoon</option></select>` : esc(plan.window ? titleCase(String(plan.window)) : 'Not scheduled'),
      writable ? `<input class="input" type="time" step="900" min="07:00" max="14:30" value="${esc(plan.start_time ?? '')}" data-recurring-start="${esc(plan.id)}" />` : esc(plan.start_time ?? '?'),
      writable ? `<span class="admin-duration"><input class="input" type="number" min="30" max="600" step="15" value="${esc(plan.duration_minutes ?? '')}" data-recurring-duration="${esc(plan.id)}" aria-label="Duration in minutes" /><span class="admin-duration__unit" aria-hidden="true">min</span></span>` : esc(plan.duration_minutes ? `${plan.duration_minutes} min` : '?'),
      esc(money(plan.ongoing_price_cents)),
      esc(dateTime(plan.next_visit_date)),
      `<span class="admin-status">${esc(titleCase(plan.sync_status ?? 'pending'))}</span>${
        plan.sync_error
          ? `<p class="admin-muted">${esc(recurringSyncDetail(plan.sync_error))}</p>`
          : ''
      }`,
      writable ? `<select class="admin-select" data-recurring-status="${esc(plan.id)}">${['active', 'paused', 'cancelled', 'completed'].map((status) => `<option value="${status}"${status === plan.status ? ' selected' : ''}>${esc(titleCase(status))}</option>`).join('')}</select>` : `<span class="admin-status">${esc(titleCase(plan.status))}</span>`,
      `<div class="admin-actions">${writable ? `<button class="btn btn--ghost btn--small" type="button" data-admin-action="recurring-save" data-id="${esc(plan.id)}">Save</button>` : ''}<button class="btn btn--ghost btn--small" type="button" data-admin-action="recurring-occurrences" data-id="${esc(plan.id)}">Occurrences</button>${writable ? `<button class="btn btn--ghost btn--small" type="button" data-admin-action="recurring-sync" data-id="${esc(plan.id)}">Sync</button>` : ''}</div>`,
    ]), 'No recurring plans are recorded yet.');
  }
  await loadCustomerOptions();
}

async function loadRecurringOccurrences(planId: string): Promise<void> {
  const data = await api<{ occurrences?: Array<Record<string, unknown>> }>(
    `/api/admin/operations?view=occurrences&planId=${encodeURIComponent(planId)}`,
  );
  const target = document.querySelector<HTMLElement>('[data-admin-recurring-occurrences]');
  if (!target) return;
  renderTable(
    target,
    ['Date', 'Status', 'Appointment', 'Sync note', 'Actions'],
    (data.occurrences ?? []).map((occurrence) => [
      esc(dateTime(occurrence.occurrence_date)),
      esc(titleCase(occurrence.status)),
      esc(occurrence.appointment_reference || '—'),
      esc(occurrence.sync_error || occurrence.appointment_status || '—'),
      recurringSchedulingAvailable && can('job.write')
        ? `<div class="admin-actions"><button class="btn btn--ghost btn--small" type="button" data-admin-action="recurring-occurrence-skip" data-plan="${esc(
            planId,
          )}" data-id="${esc(occurrence.id)}">Skip</button><input class="input" type="date" value="${esc(
            occurrence.occurrence_date,
          )}" data-occurrence-date /><input class="input" type="time" step="900" min="07:00" max="14:30" value="${esc(
            occurrence.start_at ? new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Chicago', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(String(occurrence.start_at))) : '08:00',
          )}" data-occurrence-time /><button class="btn btn--ghost btn--small" type="button" data-admin-action="recurring-occurrence-reschedule" data-plan="${esc(
            planId,
          )}" data-id="${esc(occurrence.id)}">Reschedule</button></div>`
        : '<span class="admin-muted">View only while recurring scheduling is disabled.</span>',
    ]),
    'No occurrences found for this plan.',
  );
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

interface ManualQuoteView {
  engine: string;
  status: string;
  totalCents: number | null;
  range: { low: number; high: number } | null;
  laborHours: number | null;
  durationMinutes: number | null;
  cleaningSubtotalCents: number | null;
  extrasSubtotalCents: number | null;
  discountAmountCents: number | null;
  discountLabel: string | null;
  travelAdjustmentCents: number | null;
  ongoingPerVisitCents: number | null;
  ongoingFrequency: string | null;
  tier: string | null;
  pricingVersion: string;
  serviceCode: string;
  message: string | null;
  travel: { oneWayMiles: number | null; durationMinutes: number | null; verified: boolean; method: string };
  fields: Record<string, string>;
  documentsRequired: Array<{ title: string; stage: string }>;
  breakdown: {
    basePrice: number;
    extrasSubtotal: number;
    travelAdjustment: number;
    discount: { label: string; amount: number } | null;
    globalFactor: number;
    globalAdjustment: number;
    roundingAdjustment: number;
    totalLaborHours: number;
  } | null;
}

interface ManualAvailabilityView {
  ok: boolean;
  reason?: string;
  date: string;
  durationMinutes: number;
  crewSize: number;
  slots: Array<{ start: string; end: string; label: string; resourceIds: string[] }>;
  staff: Array<{ id: string; name: string; resourceId: string; isSolo: boolean; isLead: boolean }>;
}

interface ManualCreatedView {
  requestId: string;
  reference: string;
  quote: ManualQuoteView;
}

let manualContext: { customer: Record<string, unknown>; properties: Array<Record<string, unknown>> } | null = null;
let manualQuote: ManualQuoteView | null = null;
let manualAvailabilityResult: ManualAvailabilityView | null = null;
let manualCreated: ManualCreatedView | null = null;

function manualForm(): HTMLFormElement | null {
  return document.querySelector<HTMLFormElement>('[data-manual-booking-form]');
}

function manualField<T extends HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(name: string): T | null {
  return manualForm()?.querySelector<T>(`[name="${name}"]`) ?? null;
}

function manualNumber(name: string): number | undefined {
  const value = manualField<HTMLInputElement>(name)?.value ?? '';
  if (value.trim() === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function manualChecked(name: string): boolean {
  return manualField<HTMLInputElement>(name)?.checked === true;
}

function localToday(offsetDays = 0): string {
  const date = new Date(Date.now() + offsetDays * 86_400_000);
  return new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

function renderManualOptionLists(): void {
  const addonList = document.querySelector<HTMLElement>('[data-manual-addon-list]');
  if (addonList && addonList.childElementCount === 0) {
    addonList.innerHTML = pricing.addons.items
      .map(
        (addon) =>
          `<label><input type="checkbox" data-manual-addon value="${esc(addon.id)}" /> ${esc(addon.label)}${
            addon.customQuote ? ' <span class="admin-muted">(custom quote)</span>' : ''
          }</label>`,
      )
      .join('');
  }
  const bundleList = document.querySelector<HTMLElement>('[data-manual-bundle-list]');
  if (bundleList && bundleList.childElementCount === 0) {
    const enabled = pricing.promotions.addonBundles.filter((bundle) => bundle.enabled);
    bundleList.innerHTML = enabled.length
      ? enabled
          .map(
            (bundle) =>
              `<label><input type="checkbox" data-manual-bundle value="${esc(bundle.id)}" data-bundle-required="${esc(
                bundle.requiredAddonIds.join(','),
              )}" /> ${esc(bundle.label)} <span class="admin-muted">(selecting this checks the required extras)</span></label>`,
          )
          .join('')
      : '<p class="admin-muted">No add-on bundles are enabled.</p>';
  }
}

function syncManualEngine(): void {
  const engine = manualField<HTMLSelectElement>('engine')?.value ?? 'residential';
  const residential = document.querySelector<HTMLElement>('[data-manual-residential]');
  const facility = document.querySelector<HTMLElement>('[data-manual-facility]');
  const service = manualField<HTMLSelectElement>('serviceType');
  const extras = document.querySelector<HTMLElement>('[data-manual-extras]');
  const isFacility = engine === 'commercial' || engine === 'church';
  if (residential) residential.hidden = isFacility;
  if (facility) facility.hidden = !isFacility;
  if (extras) extras.hidden = isFacility;
  if (service) {
    service.closest('label')?.toggleAttribute('hidden', isFacility || engine === 'str');
    if (engine === 'str') service.value = 'str_turnover';
  }
  manualQuote = null;
  manualAvailabilityResult = null;
  manualCreated = null;
  const quoteBox = document.querySelector<HTMLElement>('[data-manual-quote-result]');
  if (quoteBox) quoteBox.innerHTML = '';
  const resultBox = document.querySelector<HTMLElement>('[data-manual-booking-result]');
  if (resultBox) resultBox.innerHTML = '';
  renderManualSlots();
}

function populateManualProperties(): void {
  const select = manualField<HTMLSelectElement>('propertyId');
  if (!select) return;
  const properties = manualContext?.properties ?? [];
  select.innerHTML = properties.length
    ? `<option value="">Choose a property</option>${properties
        .map(
          (property) =>
            `<option value="${esc(property.id)}">${esc(
              [property.label, property.line1, property.city].filter(Boolean).join(' — '),
            )}</option>`,
        )
        .join('')}`
    : '<option value="">No active property for this customer</option>';
}

function applyManualProperty(): void {
  const propertyId = manualField<HTMLSelectElement>('propertyId')?.value ?? '';
  const property = manualContext?.properties.find((entry) => entry.id === propertyId);
  if (!property) return;
  const type = manualField<HTMLSelectElement>('propertyType');
  if (type && property.property_type) type.value = String(property.property_type);
  const values: Record<string, unknown> = {
    squareFeet: property.square_feet,
    bedrooms: property.bedrooms,
    fullBaths: property.full_baths,
    halfBaths: property.half_baths,
    beds: property.beds,
  };
  for (const [name, value] of Object.entries(values)) {
    const field = manualField<HTMLInputElement>(name);
    if (field) field.value = value === null || value === undefined ? '' : String(value);
  }
  const pets = manualField<HTMLSelectElement>('pets');
  if (pets && property.pets) pets.value = String(property.pets);
  const facilityType = manualField<HTMLSelectElement>('facilityType');
  if (facilityType && manualField<HTMLSelectElement>('engine')?.value === 'church') facilityType.value = 'church';
  manualQuote = null;
  manualAvailabilityResult = null;
  renderManualSlots();
}

async function loadManualContext(customerId: string): Promise<void> {
  manualContext = null;
  manualQuote = null;
  manualAvailabilityResult = null;
  manualCreated = null;
  populateManualProperties();
  const resultBox = document.querySelector<HTMLElement>('[data-manual-booking-result]');
  if (resultBox) resultBox.innerHTML = '';
  if (!customerId) return;
  const data = await api<Record<string, unknown>>(
    `/api/admin/bookings?view=context&customerId=${encodeURIComponent(customerId)}`,
  );
  manualContext = {
    customer: (data.customer ?? {}) as Record<string, unknown>,
    properties: (data.properties as Array<Record<string, unknown>>) ?? [],
  };
  populateManualProperties();
  const only = manualContext.properties[0];
  if (only) {
    const select = manualField<HTMLSelectElement>('propertyId');
    if (select) select.value = String(only.id);
    applyManualProperty();
  }
}

function manualPayload(): Record<string, unknown> {
  const engine = (manualField<HTMLSelectElement>('engine')?.value ?? 'residential') as string;
  const facility = engine === 'commercial' || engine === 'church';
  const payload: Record<string, unknown> = {
    engine,
    customerId: manualField<HTMLSelectElement>('customerId')?.value ?? '',
    propertyId: manualField<HTMLSelectElement>('propertyId')?.value ?? '',
    serviceType: engine === 'str' ? 'str_turnover' : manualField<HTMLSelectElement>('serviceType')?.value ?? 'standard',
    propertyType: manualField<HTMLSelectElement>('propertyType')?.value || undefined,
    squareFeet: manualNumber('squareFeet'),
    bedrooms: manualNumber('bedrooms'),
    fullBaths: manualNumber('fullBaths'),
    halfBaths: manualNumber('halfBaths'),
    beds: manualNumber('beds'),
    frequency: manualField<HTMLSelectElement>('frequency')?.value || undefined,
    condition: manualField<HTMLSelectElement>('condition')?.value || undefined,
    lastClean: manualField<HTMLSelectElement>('lastClean')?.value || undefined,
    pets: manualField<HTMLSelectElement>('pets')?.value || undefined,
    supportiveEligible: manualChecked('supportiveEligible'),
    addonIds: [...document.querySelectorAll<HTMLInputElement>('[data-manual-addon]:checked')].map((input) => input.value),
    facility: facility
      ? {
          cleanableSqft: manualNumber('cleanableSqft'),
          restroomFixtures: manualNumber('restroomFixtures'),
          breakroom: manualField<HTMLSelectElement>('breakroom')?.value !== 'none',
          facilityType: engine === 'church' ? 'church' : manualField<HTMLSelectElement>('facilityType')?.value,
          condition: manualField<HTMLSelectElement>('facilityCondition')?.value || 'average',
          traffic: manualField<HTMLSelectElement>('traffic')?.value || 'average',
          flooring: manualField<HTMLSelectElement>('flooring')?.value || 'mixed',
          firstClean: manualChecked('firstClean'),
          specialty: manualChecked('specialty'),
          frequency:
            manualField<HTMLSelectElement>('facilityFrequency')?.value === 'one-time'
              ? 'one_time'
              : manualField<HTMLSelectElement>('facilityFrequency')?.value || 'weekly',
        }
      : undefined,
  };
  return payload;
}

function renderManualSlots(): void {
  const select = manualField<HTMLSelectElement>('slot');
  const staffTarget = document.querySelector<HTMLElement>('[data-manual-staff]');
  const availability = manualAvailabilityResult;
  if (!select) return;
  if (!availability?.ok || availability.slots.length === 0) {
    select.innerHTML = `<option value="">${
      availability && !availability.ok ? esc(titleCase(availability.reason ?? 'unavailable')) : 'No available times — choose another date or crew'
    }</option>`;
    if (staffTarget) staffTarget.innerHTML = '';
    return;
  }
  select.innerHTML = availability.slots
    .map(
      (slot) =>
        `<option value="${esc(slot.start)}" data-slot-end="${esc(slot.end)}">${esc(slot.label)} — ${
          slot.resourceIds.length
        } cleaner${slot.resourceIds.length === 1 ? '' : 's'}</option>`,
    )
    .join('');
  if (staffTarget) {
    staffTarget.innerHTML = availability.staff.length
      ? `<p class="admin-muted">Preferred staff (optional — leave blank to use the server assignment)</p><div class="admin-form admin-form--grid">${availability.staff
          .map(
            (member) =>
              `<label><input type="checkbox" data-manual-staff-pick value="${esc(member.id)}" /> ${esc(
                member.name,
              )} <span class="admin-muted">${member.isSolo ? 'Solo-qualified' : member.isLead ? 'Lead' : 'Helper'}</span></label>`,
          )
          .join('')}</div>`
      : '<p class="admin-muted">No bookable staff are configured.</p>';
  }
}

function renderManualQuote(quote: ManualQuoteView): void {
  manualQuote = quote;
  const target = document.querySelector<HTMLElement>('[data-manual-quote-result]');
  if (!target) return;
  const travelNote = quote.travel.oneWayMiles === null
    ? 'Travel could not be established from the saved property; review before confirming.'
    : `${quote.travel.oneWayMiles} mi one-way (${quote.travel.verified ? 'live route' : 'preliminary'})`;
  const docs = quote.documentsRequired.length
    ? `<p class="admin-error">Required before confirmation: ${quote.documentsRequired
        .map((item) => esc(item.title))
        .join(', ')}. Send the signing request after creating the pending booking.</p>`
    : '<p class="admin-muted">No approved document requirements are active for this booking.</p>';
  if (quote.status !== 'priced' || quote.totalCents === null) {
    target.innerHTML = `<div class="admin-card"><h3>Estimate requires review</h3><p>${esc(
      quote.message ?? 'This scope cannot receive an instant price.',
    )}</p>${docs}</div>`;
    return;
  }
  const breakdown = quote.breakdown;
  const rows: string[] = [];
  if (breakdown) {
    rows.push(`<tr><td>Base cleaning</td><td>${esc(money(Math.round(breakdown.basePrice * 100)))}</td></tr>`);
    if (breakdown.extrasSubtotal > 0) {
      rows.push(`<tr><td>Selected extras</td><td>${esc(money(Math.round(breakdown.extrasSubtotal * 100)))}</td></tr>`);
    }
    if (breakdown.discount) {
      rows.push(
        `<tr><td>${esc(breakdown.discount.label)}</td><td>−${esc(money(Math.round(breakdown.discount.amount * 100)))}</td></tr>`,
      );
    }
    if (breakdown.travelAdjustment !== 0) {
      rows.push(`<tr><td>Travel</td><td>${esc(money(Math.round(breakdown.travelAdjustment * 100)))}</td></tr>`);
    }
  }
  target.innerHTML = `<div class="admin-card">
    <h3>Estimate ${esc(quote.pricingVersion)}</h3>
    <p><strong>${esc(money(quote.totalCents))}</strong>${
      quote.range ? ` · typical range ${esc(money(Math.round(quote.range.low * 100)))}–${esc(money(Math.round(quote.range.high * 100)))}` : ''
    }</p>
    <p class="admin-muted">${esc(quote.laborHours ?? '—')} labor hours · ${esc(quote.durationMinutes ?? '—')} minutes on site · ${esc(travelNote)}</p>
    ${rows.length ? `<div class="admin-table-scroll"><table class="admin-table"><tbody>${rows.join('')}</tbody></table></div>` : ''}
    ${quote.ongoingPerVisitCents !== null ? `<p class="admin-muted">Ongoing (${esc(quote.ongoingFrequency)}): ${esc(money(quote.ongoingPerVisitCents))} per visit after the first deep clean.</p>` : ''}
    ${quote.tier ? `<p class="admin-muted">Facility tier ${esc(quote.tier)}</p>` : ''}
    ${docs}
  </div>`;
}

async function generateManualQuote(autoAvailability = true): Promise<void> {
  setAppError();
  const form = manualForm();
  if (!form) return;
  try {
    const quote = await api<{ quote: ManualQuoteView }>('/api/admin/bookings', {
      method: 'POST',
      body: JSON.stringify({ action: 'quote', ...manualPayload() }),
    }).then((result) => result.quote);
    renderManualQuote(quote);
    manualAvailabilityResult = null;
    renderManualSlots();
    if (autoAvailability && quote.status === 'priced' && manualField<HTMLInputElement>('date')?.value) {
      await checkManualAvailability();
    }
  } catch (error) {
    setAppError(friendly(error));
  }
}

async function checkManualAvailability(): Promise<void> {
  setAppError();
  if (!manualQuote || manualQuote.status !== 'priced') {
    setAppError('Generate a priced estimate before checking available times.');
    return;
  }
  const form = manualForm();
  if (!form) return;
  const customerId = manualField<HTMLSelectElement>('customerId')?.value ?? '';
  const propertyId = manualField<HTMLSelectElement>('propertyId')?.value ?? '';
  const date = manualField<HTMLInputElement>('date')?.value ?? '';
  if (!customerId || !propertyId || !date) {
    setAppError('Choose the customer, property and cleaning date first.');
    return;
  }
  try {
    const teamMemberIds = [...document.querySelectorAll<HTMLInputElement>('[data-manual-staff-pick]:checked')].map(
      (input) => input.value,
    );
    const params = new URLSearchParams({
      view: 'availability',
      customerId,
      propertyId,
      date,
      durationMinutes: String(manualQuote.durationMinutes ?? 120),
      crewSize: manualField<HTMLSelectElement>('crewSize')?.value ?? '1',
      ...(teamMemberIds.length ? { teamMemberIds: teamMemberIds.join(',') } : {}),
    });
    const data = await api<{ availability: ManualAvailabilityView }>(`/api/admin/bookings?${params.toString()}`);
    manualAvailabilityResult = data.availability;
    renderManualSlots();
    if (!data.availability.ok) {
      setAppError(`No availability: ${titleCase(data.availability.reason ?? 'unavailable')}.`);
    }
  } catch (error) {
    setAppError(friendly(error));
  }
}

function selectedManualTeam(): string[] {
  return [...document.querySelectorAll<HTMLInputElement>('[data-manual-staff-pick]:checked')].map((input) => input.value);
}

function renderManualCreated(): void {
  const target = document.querySelector<HTMLElement>('[data-manual-booking-result]');
  if (!target || !manualCreated) return;
  const email = String(manualContext?.customer.email ?? '');
  target.innerHTML = `<div class="admin-card">
    <h3>Pending booking ${esc(manualCreated.reference)}</h3>
    <p class="admin-muted">Saved for ${esc(String(manualContext?.customer.first_name ?? ''))} ${esc(
      String(manualContext?.customer.last_name ?? ''),
    )}. Confirmation re-validates the slot, staff assignment, documents and calendar.</p>
    <div class="admin-actions">
      <button class="btn btn--primary btn--small" type="button" data-admin-action="manual-confirm" data-id="${esc(
        manualCreated.requestId,
      )}">Confirm Booking</button>
      <button class="btn btn--secondary btn--small" type="button" data-admin-action="manual-send-documents" data-id="${esc(
        manualCreated.requestId,
      )}">Send Required Documents${email ? ` to ${esc(email)}` : ''}</button>
      <button class="btn btn--ghost btn--small" type="button" data-admin-action="manual-invoice" data-id="${esc(
        manualCreated.requestId,
      )}">Create Invoice (Pay Later)</button>
      <button class="btn btn--ghost btn--small" type="button" data-admin-action="manual-invoice-link" data-id="${esc(
        manualCreated.requestId,
      )}">Create Invoice + Payment Link</button>
    </div>
    <div data-manual-booking-followup style="margin-top:.75rem;"></div>
  </div>`;
}

async function saveManualBooking(confirmNow: boolean): Promise<void> {
  setAppError();
  if (!manualQuote || manualQuote.status !== 'priced') {
    setAppError('Generate a priced estimate before saving the booking.');
    return;
  }
  const start = manualField<HTMLSelectElement>('slot')?.value ?? '';
  const selected = manualField<HTMLSelectElement>('slot')?.selectedOptions[0];
  const end = selected?.getAttribute('data-slot-end') ?? '';
  const date = manualField<HTMLInputElement>('date')?.value ?? '';
  if (!start || !end || !date) {
    setAppError('Choose an available appointment time first.');
    return;
  }
  try {
    const created = await api<ManualCreatedView>('/api/admin/bookings', {
      method: 'POST',
      body: JSON.stringify({
        action: 'create',
        ...manualPayload(),
        date,
        start,
        end,
        crewSize: manualField<HTMLSelectElement>('crewSize')?.value ?? '1',
        teamMemberIds: selectedManualTeam(),
        notes: manualField<HTMLTextAreaElement>('notes')?.value ?? '',
      }),
    });
    manualCreated = created;
    renderManualCreated();
    if (confirmNow) await confirmManualBooking(created.requestId);
  } catch (error) {
    setAppError(friendly(error));
  }
}

async function confirmManualBooking(requestId: string): Promise<void> {
  setAppError();
  try {
    const result = await api<{ appointmentId: string; eventId: string; reference: string }>('/api/admin/bookings', {
      method: 'POST',
      body: JSON.stringify({ action: 'confirm', requestId, teamMemberIds: selectedManualTeam() }),
    });
    const target = document.querySelector<HTMLElement>('[data-manual-booking-followup]');
    if (target) {
      target.innerHTML = `<p class="admin-status-message" role="status">Confirmed ${esc(
        result.reference,
      )}. Appointment ${esc(result.appointmentId)} and calendar event ${esc(result.eventId)} are recorded.</p>`;
    }
    await refreshManualCommitments();
  } catch (error) {
    setAppError(friendly(error));
    await refreshManualCommitments();
  }
}

async function sendManualDocuments(_requestId: string): Promise<void> {
  setAppError();
  if (!manualQuote) return;
  try {
    const result = await api<{ required?: boolean; signingUrl?: string; emailSent?: boolean; message?: string }>(
      '/api/admin/documents',
      {
        method: 'POST',
        body: JSON.stringify({
          action: 'send_request',
          subjectType: 'customer',
          customerId: manualField<HTMLSelectElement>('customerId')?.value ?? '',
          propertyId: manualField<HTMLSelectElement>('propertyId')?.value ?? '',
          serviceCode: manualQuote.serviceCode,
          frequency: manualQuote.fields.frequency ?? '',
          bookingReference: manualCreated?.reference ?? '',
          email: String(manualContext?.customer.email ?? ''),
        }),
      },
    );
    const target = document.querySelector<HTMLElement>('[data-manual-booking-followup]');
    if (target) {
      target.innerHTML = result.required
        ? `<p class="admin-muted">${result.emailSent ? 'Signing email sent.' : 'Email was not sent; share this private link with the customer.'} <a href="${esc(
            result.signingUrl,
          )}">${esc(result.signingUrl)}</a></p>`
        : `<p class="admin-muted">${esc(result.message ?? 'No approved document requirements are active for this booking.')}</p>`;
    }
  } catch (error) {
    setAppError(friendly(error));
  }
}

async function createManualInvoice(requestId: string, paymentLink: boolean): Promise<void> {
  setAppError();
  try {
    const result = await api<{
      invoice?: { id: string; number: string };
      paymentLink?: { url?: string };
      paymentLinkError?: string;
    }>('/api/admin/bookings', {
      method: 'POST',
      body: JSON.stringify({ action: 'invoice', requestId, paymentLink }),
    });
    const target = document.querySelector<HTMLElement>('[data-manual-booking-followup]');
    if (target) {
      target.innerHTML = `<p class="admin-status-message" role="status">Invoice ${esc(
        result.invoice?.number ?? '',
      )} created.${result.paymentLink?.url ? ` Payment link: <a href="${esc(result.paymentLink.url)}">${esc(result.paymentLink.url)}</a>` : ''}${
        result.paymentLinkError ? ` Payment link unavailable: ${esc(titleCase(result.paymentLinkError))}.` : ''
      }</p>`;
    }
  } catch (error) {
    setAppError(friendly(error));
  }
}

async function refreshManualCommitments(): Promise<void> {
  const target = document.querySelector<HTMLElement>('[data-manual-commitments]');
  if (!target) return;
  try {
    const data = await api<{ commitments?: Array<Record<string, unknown>> }>(
      '/api/admin/bookings?view=commitments',
    );
    renderTable(
      target,
      ['Reference', 'State', 'Customer', 'Start', 'Last error', 'Updated', ''],
      (data.commitments ?? []).map((row) => [
        esc(row.quote_reference ?? row.reference),
        esc(titleCase(row.state)),
        esc([row.first_name, row.last_name].filter(Boolean).join(' ') || '—'),
        esc(dateTime(row.start_at)),
        esc(row.last_error || '—'),
        esc(dateTime(row.updated_at)),
        `<button class="btn btn--ghost btn--small" type="button" data-admin-action="commitment-retry" data-id="${esc(
          row.booking_request_id ?? '',
        )}">Reconcile</button>`,
      ]),
      'No booking recovery items.',
    );
  } catch (error) {
    renderEmpty(target, friendly(error));
  }
}

async function loadManualBooking(): Promise<void> {
  renderManualOptionLists();
  const customerSelect = manualField<HTMLSelectElement>('customerId');
  if (customerSelect) {
    customerSelect.innerHTML = '<option value="">Choose a customer</option>';
    const data = await api<{ customers?: Array<Record<string, unknown>> }>('/api/admin/customers?limit=200');
    for (const customer of data.customers ?? []) {
      customerSelect.insertAdjacentHTML(
        'beforeend',
        `<option value="${esc(customer.id)}">${esc(
          [customer.first_name, customer.last_name].filter(Boolean).join(' ') || customer.company_name || customer.id,
        )}${customer.email ? ` — ${esc(customer.email)}` : ''}</option>`,
      );
    }
  }
  const dateField = manualField<HTMLInputElement>('date');
  if (dateField && !dateField.value) dateField.value = localToday(1);
  syncManualEngine();
  manualContext = null;
  manualQuote = null;
  manualAvailabilityResult = null;
  manualCreated = null;
  const quoteBox = document.querySelector<HTMLElement>('[data-manual-quote-result]');
  if (quoteBox) quoteBox.innerHTML = '';
  const resultBox = document.querySelector<HTMLElement>('[data-manual-booking-result]');
  if (resultBox) resultBox.innerHTML = '';
  await refreshManualCommitments();
}

async function loadJobs(): Promise<void> {
  const data = await api<{ jobs?: Array<Record<string, unknown>>; team?: Array<Record<string, unknown>> }>('/api/admin/operations?view=jobs');
  const team = data.team ?? [];
  const target = document.querySelector<HTMLElement>('[data-admin-jobs]');
  if (target) {
    target.innerHTML = (data.jobs ?? []).map((job) => {
      const crewIds = String(job.crew_ids ?? '').split(',').filter(Boolean);
      const crewNames = String(job.crew ?? '').split(',').map((name) => name.trim()).filter(Boolean);
      const crewDetail = crewIds.map((memberId, index) => {
        const name = team.find((member) => member.id === memberId)?.display_name ?? crewNames[index] ?? memberId;
        return `<span class="admin-muted">${esc(name)}</span>${can('job.write') ? `<button class="btn btn--ghost btn--small" type="button" data-admin-action="job-unassign" data-id="${esc(job.id)}" data-member="${esc(memberId)}">Remove</button>` : ''}`;
      }).join(' ');
      return `<div class="admin-record admin-job"><div><strong>${esc(dateTime(job.start_at))}</strong> — ${esc(job.reference)} — ${esc([job.first_name, job.last_name].filter(Boolean).join(' '))}<p class="admin-muted">${esc([job.line1, job.city].filter(Boolean).join(', '))}${crewDetail ? ` — ${crewDetail}` : ''}</p></div><div class="admin-actions">${can('job.write') ? `<select class="admin-select" data-job-status="${esc(job.id)}">${['pending', 'confirmed', 'in_progress', 'completed', 'cancelled', 'no_show'].map((status) => `<option value="${status}"${status === job.status ? ' selected' : ''}>${esc(titleCase(status))}</option>`).join('')}</select><button class="btn btn--ghost btn--small" type="button" data-admin-action="job-save" data-id="${esc(job.id)}">Save</button><select class="admin-select" data-job-team="${esc(job.id)}"><option value="">Assign cleaner</option>${team.map((member) => `<option value="${esc(member.id)}">${esc(member.display_name)}</option>`).join('')}</select><button class="btn btn--ghost btn--small" type="button" data-admin-action="job-assign" data-id="${esc(job.id)}">Add</button>` : `<span class="admin-status">${esc(titleCase(job.status))}</span>`}<button class="btn btn--secondary btn--small" type="button" data-admin-action="job-checklist" data-id="${esc(job.id)}">Checklist</button></div></div>`;
    }).join('') || '<div class="admin-empty">No jobs are recorded yet.</div>';
  }
  const teamTarget = document.querySelector<HTMLElement>('[data-admin-team]');
  if (teamTarget) {
    renderTable(teamTarget, ['Name', 'Email', 'Qualification', 'Bookable', 'Status', 'Actions'], team.map((member) => {
      const solo = Number(member.is_solo) === 1;
      const lead = Number(member.is_lead) === 1;
      const qualification = solo ? 'Solo-qualified' : lead ? 'Lead' : 'Helper';
      return [
        esc(member.display_name),
        esc(member.email),
        can('job.write') ? `<select class="admin-select" data-team-qualification="${esc(member.id)}"><option value="helper"${!solo && !lead ? ' selected' : ''}>Helper</option><option value="lead"${lead && !solo ? ' selected' : ''}>Lead</option><option value="solo"${solo ? ' selected' : ''}>Solo-qualified</option></select>` : esc(qualification),
        can('job.write') ? `<input type="checkbox" data-team-bookable="${esc(member.id)}"${Number(member.is_bookable) ? ' checked' : ''} />` : Number(member.is_bookable) ? 'Yes' : 'No',
        `<span class="admin-status">${esc(member.status)}</span>`,
        can('job.write') ? `<button class="btn btn--ghost btn--small" type="button" data-admin-action="team-save" data-id="${esc(member.id)}">Save</button>` : '',
      ];
    }), 'No team members are recorded yet.');
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
  target.innerHTML = `<div class="admin-card"><div class="admin-detail-head"><h2 class="admin-section-title">${esc(invoice.number)}</h2><span class="admin-status">${esc(titleCase(invoice.status))}</span></div><dl class="admin-definition"><dt>Customer</dt><dd>${esc([invoice.first_name, invoice.last_name].filter(Boolean).join(' '))}</dd><dt>Total</dt><dd>${esc(money(invoice.total_cents))}</dd><dt>Paid</dt><dd>${esc(money(invoice.amount_paid_cents))}</dd><dt>Balance</dt><dd>${esc(money(invoice.balance_cents))}</dd><dt>Due</dt><dd>${esc(dateTime(invoice.due_date))}</dd></dl><h3>Lines</h3>${lines.map((line) => `<div class="admin-record">${esc(line.description)} · ${esc(money(line.total_cents))}</div>`).join('') || '<p class="admin-muted">No lines.</p>'}<h3>Payments</h3>${payments.map((payment) => `<div class="admin-record">${esc(titleCase(payment.provider))} · ${esc(money(payment.amount_cents))} · ${esc(payment.status)} · ${esc(dateTime(payment.created_at))}<details class="admin-detail-toggle"><summary>Record refund</summary><form class="admin-form" data-form="refund"><input type="hidden" name="paymentId" value="${esc(payment.id)}" /><input type="hidden" name="idempotencyKey" value="${esc(crypto.randomUUID())}" /><label>Refund amount <input name="amount" type="number" min="0.01" step="0.01" required /></label><label>Reason <input name="reason" /></label><button class="btn btn--secondary btn--small" type="submit">Record refund</button></form></details></div>`).join('') || '<p class="admin-muted">No payments.</p>'}${Number(invoice.balance_cents) > 0 ? `<form class="admin-form" data-form="payment"><input type="hidden" name="invoiceId" value="${esc(invoiceId)}" /><input type="hidden" name="idempotencyKey" value="${esc(crypto.randomUUID())}" /><label>Payment method <select name="provider"><option value="cash">Cash</option><option value="check">Check</option><option value="external">External</option></select></label><label>Amount <input name="amount" type="number" min="0.01" step="0.01" value="${(Number(invoice.balance_cents) / 100).toFixed(2)}" required /></label><label>Reference <input name="reference" /></label><button class="btn btn--primary btn--small" type="submit">Record payment</button></form>` : ''}<form class="admin-form" data-form="credit"><input type="hidden" name="customerId" value="${esc(invoice.customer_id)}" /><label>Customer credit amount <input name="amount" type="number" min="0.01" step="0.01" required /></label><label>Reason <input name="source" /></label><button class="btn btn--secondary btn--small" type="submit">Add credit</button></form></div>`;
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
        `<details class="admin-detail-toggle"><summary>Execute Stripe refund</summary><form class="admin-form" data-form="stripe-refund"><input type="hidden" name="idempotencyKey" value="${esc(crypto.randomUUID())}" /><label>Stripe payment <select name="paymentId">${stripePayments.map((payment) => `<option value="${esc(payment.id)}">${esc(money(payment.amount_cents))} · ${esc(dateTime(payment.created_at))}</option>`).join('')}</select></label><label>Refund amount (USD) <input name="amount" type="number" min="0.01" step="0.01" required /></label><label>Your password (step-up) <input name="password" type="password" required /></label><button class="btn btn--secondary btn--small" type="submit">Execute Stripe refund</button></form></details>`,
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
    if (can('finance.write') && Number(invoice.balance_cents) > 0 && invoice.customer_id) {
      void api<{ credits?: Array<Record<string, unknown>> }>(
        `/api/admin/finance?view=credits&customerId=${encodeURIComponent(String(invoice.customer_id))}`,
      )
        .then((result) => {
          const active = (result.credits ?? []).filter(
            (credit) => credit.status === 'active' && Number(credit.remaining_cents) > 0,
          );
          if (active.length === 0 || !controls) return;
          controls.insertAdjacentHTML(
            'beforeend',
            `<details class="admin-detail-toggle"><summary>Apply customer credit</summary><form class="admin-form" data-form="credit-apply"><input type="hidden" name="invoiceId" value="${esc(
              invoiceId,
            )}" /><label>Credit <select name="creditId">${active
              .map(
                (credit) =>
                  `<option value="${esc(credit.id)}">${esc(credit.source || 'Credit')} — ${esc(
                    money(credit.remaining_cents),
                  )} remaining</option>`,
              )
              .join('')}</select></label><label>Amount to apply (USD) <input name="amount" type="number" min="0.01" step="0.01" value="${(
                Number(invoice.balance_cents) / 100
              ).toFixed(2)}" required /></label><button class="btn btn--secondary btn--small" type="submit">Apply credit</button></form></details>`,
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
  target.innerHTML = `<div class="admin-card"><h3>${action === 'redeem' ? 'Redeem' : 'Void'} ${esc(code)}</h3><form class="admin-form" data-form="gift-action"><input type="hidden" name="code" value="${esc(code)}" /><input type="hidden" name="giftAction" value="${esc(action)}" />${action === 'redeem' ? '<label>Amount (USD) <input name="amount" type="number" min="0.01" step="0.01" required /></label><label>Apply to booking request (optional) <input name="bookingRequestId" placeholder="request_..." /></label><label>Reference <input name="reference" /></label>' : ''}<label>Reason / note <input name="note" /></label><label>Your password (step-up) <input name="password" type="password" autocomplete="current-password" required /></label><button class="btn btn--primary btn--small" type="submit">Confirm ${action === 'redeem' ? 'redemption' : 'void'}</button></form></div>`;
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

async function loadDocuments(): Promise<void> {
  const [templateData, bundleData, requestData] = await Promise.all([
    api<{ templates?: Array<Record<string, unknown>> }>('/api/admin/documents?view=templates'),
    api<{ bundles?: Array<Record<string, unknown>> }>('/api/admin/documents?view=bundles'),
    api<{ requests?: Array<Record<string, unknown>> }>('/api/admin/documents?view=requests'),
  ]);
  const templates = templateData.templates ?? [];
  const bundles = bundleData.bundles ?? [];
  const requests = requestData.requests ?? [];
  const templateTarget = document.querySelector<HTMLElement>('[data-admin-documents-templates]');
  if (templateTarget) {
    renderTable(templateTarget, ['Title', 'Category', 'Version', 'Status', 'Actions'], templates.map((template) => [
      esc(template.title),
      esc(template.category),
      esc(template.version),
      `<span class="admin-status">${esc(titleCase(template.status))}</span>`,
      `<div class="admin-actions">${template.status === 'draft' && actor?.role === 'owner' ? `<button class="btn btn--ghost btn--small" type="button" data-admin-action="document-approve" data-id="${esc(template.id)}">Approve</button>` : ''}${template.status !== 'retired' && actor?.role === 'owner' ? `<button class="btn btn--ghost btn--small" type="button" data-admin-action="document-retire" data-id="${esc(template.id)}">Retire</button>` : ''}</div>`,
    ]), 'No document templates are configured yet.');
  }
  const bundleTarget = document.querySelector<HTMLElement>('[data-admin-documents-bundles]');
  if (bundleTarget) {
    renderTable(bundleTarget, ['Code', 'Name', 'Subject', 'Documents', 'Status', 'Actions'], bundles.map((bundle) => [
      esc(bundle.code),
      esc(bundle.name),
      esc(titleCase(bundle.subject_type)),
      esc(bundle.document_count),
      `<span class="admin-status">${esc(titleCase(bundle.status))}</span>`,
      `<button class="btn btn--ghost btn--small" type="button" data-admin-action="document-bundle-open" data-id="${esc(bundle.id)}">View documents</button>`,
    ]), 'No document bundles are configured yet.');
  }
  const requestTarget = document.querySelector<HTMLElement>('[data-admin-documents-requests]');
  if (requestTarget) {
    renderTable(requestTarget, ['Subject', 'Bundle', 'Status', 'Signed', 'Awaiting verification', 'Created', 'Actions'], requests.map((request) => [
      esc([request.first_name, request.last_name].filter(Boolean).join(' ') || request.display_name || request.subject_type),
      esc(request.bundle_code),
      `<span class="admin-status">${esc(titleCase(request.status))}</span>`,
      esc(request.signed_count),
      esc(request.awaiting_verification),
      esc(dateTime(request.created_at)),
      `<div class="admin-actions"><button class="btn btn--ghost btn--small" type="button" data-admin-action="document-request-open" data-id="${esc(request.id)}">Open</button><button class="btn btn--ghost btn--small" type="button" data-admin-action="document-request-resend" data-id="${esc(request.id)}">Resend</button></div>`,
    ]), 'No signing requests have been created yet.');
  }
  for (const select of document.querySelectorAll<HTMLSelectElement>('[data-document-template-options]')) {
    select.innerHTML = `<option value="">Choose a template</option>${templates.filter((template) => template.status === 'approved').map((template) => `<option value="${esc(template.id)}">${esc(template.title)} (v${esc(template.version)})</option>`).join('')}`;
  }
  for (const select of document.querySelectorAll<HTMLSelectElement>('[data-document-bundle-options]')) {
    select.innerHTML = `<option value="">Choose a bundle</option>${bundles.map((bundle) => `<option value="${esc(bundle.id)}">${esc(bundle.name)}</option>`).join('')}`;
  }
}

async function loadDocumentBundleItems(bundleId: string): Promise<void> {
  const target = document.querySelector<HTMLElement>('[data-document-bundle-items]');
  if (!target) return;
  if (!bundleId) {
    target.innerHTML = '<p class="admin-muted">Choose a bundle to view its documents.</p>';
    return;
  }
  const data = await api<{ items?: Array<Record<string, unknown>> }>(`/api/admin/documents?view=items&bundleId=${encodeURIComponent(bundleId)}`);
  renderTable(target, ['Order', 'Document', 'Version', 'Stage', 'Condition', 'Required', 'Actions'], (data.items ?? []).map((item) => [
    esc(item.sort_order),
    esc(item.title),
    esc(item.version),
    esc(titleCase(item.enforcement_stage)),
    esc([item.condition_key, item.condition_value].filter(Boolean).join(': ') || '—'),
    Number(item.required) ? 'Yes' : 'No',
    `<button class="btn btn--ghost btn--small" type="button" data-admin-action="document-item-remove" data-id="${esc(item.template_id)}" data-bundle="${esc(bundleId)}">Remove</button>`,
  ]), 'This bundle has no documents yet.');
}

async function openDocumentRequest(id: string): Promise<void> {
  const target = document.querySelector<HTMLElement>('[data-document-request-detail]');
  if (!target) return;
  const data = await api<{
    request?: Record<string, unknown> | null;
    ownerEmail?: { status: string; attempts: number; lastError: string } | null;
  }>(`/api/admin/documents?view=request&id=${encodeURIComponent(id)}`);
  const detail = data.request;
  if (!detail) {
    target.innerHTML = '<p class="admin-muted">That signing request could not be loaded.</p>';
    target.hidden = false;
    return;
  }
  const request = detail.request as Record<string, unknown>;
  const signatures = (detail.signatures as Array<Record<string, unknown>>) ?? [];
  const awaiting = signatures.some((signature) => signature.status === 'awaiting_verification');
  const ownerEmail = data.ownerEmail;
  const ownerEmailLabel = ownerEmail
    ? `${titleCase(ownerEmail.status)}${ownerEmail.attempts ? ` (${ownerEmail.attempts} attempt${ownerEmail.attempts === 1 ? '' : 's'})` : ''}${ownerEmail.lastError ? ` - ${ownerEmail.lastError}` : ''}`
    : request.executed_at
      ? 'Pending first attempt'
      : 'Not sent until fully executed';
  target.hidden = false;
  target.innerHTML = `<div class="admin-card"><div class="admin-detail-head"><h2 class="admin-section-title">Signing request ${esc(request.bundle_code)}</h2><div class="admin-actions">${request.executed_at ? `<a class="btn btn--ghost btn--small" href="/api/admin/documents?view=executed&id=${encodeURIComponent(id)}">Executed copy</a>` : ''}${request.executed_at && ownerEmail?.status !== 'completed' ? `<button class="btn btn--secondary btn--small" type="button" data-admin-action="document-owner-email-retry" data-id="${esc(id)}">Retry owner email</button>` : ''}${awaiting ? `<button class="btn btn--secondary btn--small" type="button" data-admin-action="document-countersign" data-id="${esc(id)}">Countersign and verify</button>` : ''}<button class="btn btn--ghost btn--small" type="button" data-admin-action="document-request-close">Close</button></div></div>
    <dl class="admin-definition"><dt>Status</dt><dd>${esc(titleCase(request.status))}</dd><dt>Subject</dt><dd>${esc(request.subject_type)}</dd><dt>Branch</dt><dd>${esc(request.branch_id || '—')}</dd><dt>Bound signer</dt><dd>${esc(request.signer_email || 'not bound')}</dd><dt>Booking reference</dt><dd>${esc(request.booking_reference || '-')}</dd><dt>Countersigned</dt><dd>${request.counter_signed_at ? `${esc(request.counter_signature_name)} · ${esc(dateTime(request.counter_signed_at))}` : 'Not countersigned'}</dd><dt>Executed copy</dt><dd>${request.executed_at ? `${esc(dateTime(request.executed_at))} · SHA-256 ${esc(request.executed_sha256)}` : 'Not available until fully signed'}</dd><dt>Owner email</dt><dd>${esc(ownerEmailLabel)}</dd></dl>
    ${signatures.length ? `<div class="admin-table-scroll"><table class="admin-table"><thead><tr><th>Document</th><th>Version</th><th>Signer</th><th>Status</th><th>Signed</th><th>Actions</th></tr></thead><tbody>${signatures.map((signature) => `<tr><td>${esc(signature.title)}</td><td>${esc(signature.template_version)}</td><td>${esc(signature.signer_name)}</td><td><span class="admin-status">${esc(titleCase(signature.status))}</span></td><td>${esc(dateTime(signature.signed_at))}</td><td><div class="admin-actions"><a class="btn btn--ghost btn--small" href="/api/admin/documents?view=download&signatureId=${encodeURIComponent(String(signature.id))}">Download</a>${signature.status === 'awaiting_verification' ? `<button class="btn btn--ghost btn--small" type="button" data-admin-action="document-signature-verify" data-id="${esc(signature.id)}">Verify</button><button class="btn btn--ghost btn--small" type="button" data-admin-action="document-signature-reject" data-id="${esc(signature.id)}">Reject</button>` : ''}</div></td></tr>`).join('')}</tbody></table></div>` : '<p class="admin-muted">No signatures yet.</p>'}</div>`;
}

document.querySelector<HTMLElement>('[data-admin-view="storage"]')?.addEventListener('click', (event) => {
  const exportKind = (event.target as HTMLElement).closest<HTMLElement>('[data-admin-export]')?.dataset.adminExport;
  if (exportKind) window.location.assign(`/api/admin/storage?export=${encodeURIComponent(exportKind)}`);
});
async function loadStorage(): Promise<void> {
  const data = await api<{
    database?: { bytes?: number | null; counts?: Record<string, number | null> };
    storage?: { photos?: { configured?: boolean; sampledObjects?: number }; documents?: { configured?: boolean; sampledObjects?: number } };
    settings?: Array<Record<string, unknown>>;
    note?: string;
  }>('/api/admin/storage');
  const kpis = document.querySelector<HTMLElement>('[data-admin-storage-kpis]');
  const counts = data.database?.counts ?? {};
  if (kpis) {
    kpis.innerHTML = [
      ['D1 size', data.database?.bytes ? `${(Number(data.database.bytes) / 1024 / 1024).toFixed(2)} MB` : 'not reported'],
      ['Customers', counts.customers ?? 0],
      ['Properties', counts.properties ?? 0],
      ['Appointments', counts.appointments ?? 0],
      ['Invoices', counts.invoices ?? 0],
      ['Document templates', counts.documents ?? 0],
      ['Photo bucket objects (sampled)', data.storage?.photos?.sampledObjects ?? 0],
      ['Document bucket objects (sampled)', data.storage?.documents?.sampledObjects ?? 0],
    ].map(([label, value]) => `<div class="admin-card admin-kpi"><p class="admin-kpi__label">${esc(label)}</p><p class="admin-kpi__value">${esc(value)}</p></div>`).join('');
  }
  const note = document.querySelector<HTMLElement>('[data-admin-storage-note]');
  if (note) note.textContent = data.note ?? '';
  const target = document.querySelector<HTMLElement>('[data-admin-storage-settings]');
  if (target) {
    target.innerHTML = (data.settings ?? []).length
      ? `<div class="admin-table-scroll"><table class="admin-table"><thead><tr><th>Record</th><th>Value</th><th>Updated</th></tr></thead><tbody>${(data.settings ?? []).map((row) => `<tr><td>${esc(row.key)}</td><td><code>${esc(String(row.value_json ?? '').slice(0, 500))}</code></td><td>${esc(dateTime(row.updated_at))}</td></tr>`).join('')}</tbody></table></div>`
      : '<p class="admin-muted">No backup or cleanup status has been recorded yet.</p>';
  }
  const status = document.querySelector<HTMLElement>('[data-admin-storage-status]');
  if (status) status.textContent = `Last refreshed ${new Date().toLocaleString()}.`;
}

async function storageCleanup(dryRun: boolean): Promise<void> {
  const status = document.querySelector<HTMLElement>('[data-admin-storage-status]');
  if (status) status.textContent = dryRun ? 'Previewing eligible photos...' : 'Deleting eligible photos...';
  try {
    const result = await api<{ eligible?: number; deleted?: number; scanned?: number; dryRun?: boolean }>('/api/admin/storage', {
      method: 'POST',
      body: JSON.stringify({ action: 'photo_cleanup', days: 30, dryRun }),
    });
    if (status) {
      status.textContent = dryRun
        ? `${result.eligible ?? 0} eligible photo object(s) older than 30 days; nothing deleted.`
        : `${result.deleted ?? 0} eligible photo object(s) deleted safely.`;
    }
    await loadStorage();
  } catch (error) {
    if (status) status.textContent = friendly(error);
  }
}

document.querySelector<HTMLElement>('[data-admin-view="storage"]')?.addEventListener('click', (event) => {
  const action = (event.target as HTMLElement).closest<HTMLElement>('[data-admin-action]')?.dataset.adminAction;
  if (action === 'storage-refresh') void loadStorage().catch((error) => setAppError(friendly(error)));
  if (action === 'storage-cleanup-preview') void storageCleanup(true);
  if (action === 'storage-cleanup-run') {
    if (window.confirm('Delete only eligible customer photos older than 30 days? Financial, legal, booking and agreement records are never touched.')) {
      void storageCleanup(false);
    }
  }
});
async function loadPromotions(): Promise<void> {
  const target = document.querySelector<HTMLElement>('[data-admin-promotions]');
  if (!target) return;
  const data = await api<{ promotions?: Array<Record<string, unknown>> }>('/api/admin/promotions');
  const promotions = data.promotions ?? [];
  renderTable(target, ['Name', 'Code', 'Type', 'Discount', 'Services', 'Branches', 'Window', 'Used', 'Status', 'Actions'], promotions.map((promotion) => [
    esc(promotion.name),
    esc(promotion.code),
    esc(titleCase(promotion.kind)),
    promotion.kind === 'percent' ? `${esc(promotion.percent)}%` : money(promotion.valueCents),
    esc((promotion.services as string[] | undefined)?.join(', ') || '-'),
    esc((promotion.branches as string[] | undefined)?.join(', ') || '-'),
    `${esc(dateTime(promotion.startsAt))} - ${esc(dateTime(promotion.expiresAt))}`,
    `${esc(promotion.redeemedCount ?? 0)} / ${promotion.maxRedemptions ? esc(promotion.maxRedemptions) : 'unlimited'}`,
    `<span class="admin-status">${esc(titleCase(promotion.displayStatus ?? promotion.status))}</span>`,
    `<div class="admin-actions"><button class="btn btn--ghost btn--small" type="button" data-promotion-edit="${esc(promotion.id)}">Edit</button>${promotion.status === 'active' ? `<button class="btn btn--ghost btn--small" type="button" data-promotion-status="${esc(promotion.id)}" data-status="disabled">Deactivate</button>` : `<button class="btn btn--ghost btn--small" type="button" data-promotion-status="${esc(promotion.id)}" data-status="active">Activate</button>`}<button class="btn btn--ghost btn--small" type="button" data-promotion-duplicate="${esc(promotion.id)}">Duplicate</button></div>`,
  ]), 'No promotions yet. The Thanksgiving draft appears after migration 0032 is applied.');
  (window as unknown as { __ssPromotions?: Array<Record<string, unknown>> }).__ssPromotions = promotions;
}

function promotionForm(): HTMLFormElement | null {
  return document.querySelector<HTMLFormElement>('[data-promotion-form]');
}

function fillPromotionForm(promotion: Record<string, unknown>): void {
  const form = promotionForm();
  if (!form) return;
  const set = (name: string, value: unknown): void => {
    const field = form.elements.namedItem(name) as HTMLInputElement | HTMLSelectElement | null;
    if (field) field.value = value === null || value === undefined ? '' : String(value);
  };
  set('id', promotion.id);
  set('name', promotion.name);
  set('code', promotion.code);
  set('kind', promotion.kind);
  set('value', promotion.kind === 'fixed' ? Number(promotion.valueCents ?? 0) / 100 : '');
  set('percent', promotion.percent ?? '');
  set('minPurchase', Number(promotion.minPurchaseCents ?? 0) / 100);
  set('maxDiscount', Number(promotion.maxDiscountCents ?? 0) / 100);
  set('startsAt', promotion.startsAt ? String(promotion.startsAt).slice(0, 16) : '');
  set('expiresAt', promotion.expiresAt ? String(promotion.expiresAt).slice(0, 16) : '');
  set('maxRedemptions', promotion.maxRedemptions ?? 0);
  set('perCustomerLimit', promotion.perCustomerLimit ?? 1);
  set('status', promotion.status ?? 'draft');
  for (const box of form.querySelectorAll<HTMLInputElement>('input[name="services"]')) {
    box.checked = Array.isArray(promotion.services) && promotion.services.includes(box.value);
  }
  for (const box of form.querySelectorAll<HTMLInputElement>('input[name="branches"]')) {
    box.checked = Array.isArray(promotion.branches) && promotion.branches.includes(box.value);
  }
  for (const [name, value] of [['newCustomersOnly', promotion.newCustomersOnly], ['recurringOnly', promotion.recurringOnly], ['firstVisitOnly', promotion.firstVisitOnly], ['combinable', promotion.combinable]] as Array<[string, unknown]>) {
    const box = form.elements.namedItem(name) as HTMLInputElement | null;
    if (box) box.checked = Boolean(value);
  }
  form.scrollIntoView({ block: 'center', behavior: 'smooth' });
}

document.querySelector<HTMLFormElement>('[data-promotion-form]')?.addEventListener('submit', (event) => {
  event.preventDefault();
  const form = event.currentTarget as HTMLFormElement;
  const data = new FormData(form);
  const status = document.querySelector<HTMLElement>('[data-promotion-status]');
  const services = [...form.querySelectorAll<HTMLInputElement>('input[name="services"]:checked')].map((box) => box.value);
  const branches = [...form.querySelectorAll<HTMLInputElement>('input[name="branches"]:checked')].map((box) => box.value);
  const iso = (value: FormDataEntryValue | null): string => {
    const raw = String(value ?? '').trim();
    if (!raw) return '';
    const parsed = new Date(raw);
    return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : '';
  };
  const payload = {
    action: data.get('id') ? 'update' : 'create',
    id: String(data.get('id') ?? ''),
    name: data.get('name'),
    code: data.get('code'),
    kind: data.get('kind'),
    valueCents: Math.round(Number(data.get('value') ?? 0) * 100),
    percent: Number(data.get('percent') ?? 0),
    services,
    branches,
    minPurchaseCents: Math.round(Number(data.get('minPurchase') ?? 0) * 100),
    maxDiscountCents: Math.round(Number(data.get('maxDiscount') ?? 0) * 100),
    startsAt: iso(data.get('startsAt')),
    expiresAt: iso(data.get('expiresAt')),
    maxRedemptions: Number(data.get('maxRedemptions') ?? 0),
    perCustomerLimit: Number(data.get('perCustomerLimit') ?? 1),
    status: data.get('status'),
    newCustomersOnly: data.get('newCustomersOnly') === 'on',
    recurringOnly: data.get('recurringOnly') === 'on',
    firstVisitOnly: data.get('firstVisitOnly') === 'on',
    combinable: data.get('combinable') === 'on',
  };
  if (status) status.textContent = 'Saving...';
  void api('/api/admin/promotions', { method: 'POST', body: JSON.stringify(payload) })
    .then(() => {
      if (status) status.textContent = 'Promotion saved. Drafts stay hidden from customers until activated.';
      form.reset();
      return loadPromotions();
    })
    .catch((error) => {
      if (status) status.textContent = friendly(error);
    });
});

document.querySelector<HTMLElement>('[data-admin-promotions]')?.addEventListener('click', (event) => {
  const target = (event.target as HTMLElement).closest<HTMLElement>('[data-promotion-edit], [data-promotion-status], [data-promotion-duplicate]');
  if (!target) return;
  const editId = target.dataset.promotionEdit;
  const statusId = target.dataset.promotionStatus;
  const duplicateId = target.dataset.promotionDuplicate;
  const promotions = (window as unknown as { __ssPromotions?: Array<Record<string, unknown>> }).__ssPromotions ?? [];
  if (editId) {
    const promotion = promotions.find((entry) => String(entry.id) === editId);
    if (promotion) fillPromotionForm(promotion);
    return;
  }
  if (duplicateId) {
    void api('/api/admin/promotions', { method: 'POST', body: JSON.stringify({ action: 'duplicate', id: duplicateId }) })
      .then(() => loadPromotions())
      .catch((error) => setAppError(friendly(error)));
    return;
  }
  if (statusId && target.dataset.status) {
    void api('/api/admin/promotions', { method: 'POST', body: JSON.stringify({ action: 'status', id: statusId, status: target.dataset.status }) })
      .then(() => loadPromotions())
      .catch((error) => setAppError(friendly(error)));
  }
});

document.querySelector<HTMLElement>('[data-promotion-reset]')?.addEventListener('click', () => {
  document.querySelector<HTMLFormElement>('[data-promotion-form]')?.reset();
});
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
    if (view === 'new-booking') await loadManualBooking();
    if (view === 'recurring') await loadRecurring();
    if (view === 'jobs') await loadJobs();
    if (view === 'documents') await loadDocuments();
    if (view === 'timekeeping') await loadTimekeeping();
    if (view === 'finance') await loadFinance();
    if (view === 'gift') await loadGifts();
    if (view === 'reports') await loadReports();
    if (view === 'storage') await loadStorage();
    if (view === 'promotions') await loadPromotions();
    if (view === 'pricing') await loadPricingView();
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

manualField<HTMLSelectElement>('customerId')?.addEventListener('change', (event) => {
  void loadManualContext((event.target as HTMLSelectElement).value).catch((error) => setAppError(friendly(error)));
});
manualField<HTMLSelectElement>('propertyId')?.addEventListener('change', () => applyManualProperty());
manualField<HTMLSelectElement>('engine')?.addEventListener('change', () => syncManualEngine());
for (const name of ['date', 'crewSize']) {
  manualField<HTMLInputElement | HTMLSelectElement>(name)?.addEventListener('change', () => {
    manualAvailabilityResult = null;
    renderManualSlots();
  });
}

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

document.querySelector<HTMLFormElement>('[data-admin-request-filter]')?.addEventListener('submit', (event) => {
  event.preventDefault();
  const data = new FormData(event.currentTarget as HTMLFormElement);
  void loadCalendar(String(data.get('view') ?? 'actionable'), String(data.get('q') ?? ''));
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
  const propertyPayload = {
    label: value('label'), line1: value('line1'), line2: value('line2'), city: value('city'),
    state: value('state'), postalCode: value('postalCode'), propertyType: value('propertyType'),
    squareFeet: value('squareFeet'), bedrooms: value('bedrooms'), fullBaths: value('fullBaths'),
    halfBaths: value('halfBaths'), stories: value('stories'), beds: value('beds'), pets: value('pets'),
    accessNotes: value('accessNotes'), parkingNotes: value('parkingNotes'),
    internalNotes: value('internalNotes'), isPrimary: checked('isPrimary'),
  };
  if (kind === 'customer-create' || kind === 'customer-update') {
    const customerId = value('customerId');
    const body = {
      action: kind === 'customer-update' ? 'update' : 'create',
      customerId, firstName: value('firstName'), lastName: value('lastName'),
      companyName: value('companyName'), email: value('email'), phone: value('phone'),
      status: value('status'), notesSummary: value('notesSummary'), doNotContact: checked('doNotContact'),
      marketingConsent: checked('marketingConsent'), addressLine1: value('line1'),
      ...propertyPayload,
    };
    void api<Record<string, unknown>>('/api/admin/customers', { method: 'POST', body: JSON.stringify(body) })
      .then(async (result) => {
        await loadCustomers();
        await openCustomer(String(result.id ?? customerId));
      })
      .catch((error) => setAppError(friendly(error)));
  }
  if (kind === 'customer-archive') {
    const customerId = value('customerId');
    const targetStatus = value('targetStatus') === 'active' ? 'active' : 'archived';
    void api('/api/admin/customers', {
      method: 'POST',
      body: JSON.stringify({ action: targetStatus === 'active' ? 'restore' : 'archive', customerId }),
    }).then(() => openCustomer(customerId)).catch((error) => setAppError(friendly(error)));
  }
  if (kind === 'customer-delete') {
    const customerId = value('customerId');
    const confirmation = window.prompt('Type DELETE to permanently delete this customer. Records with financial or booking history will be anonymized instead.');
    if (confirmation === 'DELETE') {
      void api<Record<string, unknown>>('/api/admin/customers', {
        method: 'POST',
        body: JSON.stringify({ action: 'delete', customerId, confirmation: 'DELETE' }),
      }).then((result) => {
        const mode = String(result.mode ?? 'deleted');
        const detail = document.querySelector<HTMLElement>('[data-admin-customer-detail]');
        if (detail) { detail.hidden = true; detail.innerHTML = ''; }
        window.alert(mode === 'anonymized' ? 'Customer identifiers removed. Retained financial and audit history was anonymized.' : 'Customer permanently deleted.');
        return loadCustomers();
      }).catch((error) => setAppError(friendly(error)));
    }
  }
  if (kind === 'property-add') {
    const customerId = value('customerId');
    void api('/api/admin/customers', { method: 'POST', body: JSON.stringify({ action: 'add_property', customerId, ...propertyPayload }) })
      .then(() => openCustomer(customerId))
      .catch((error) => setAppError(friendly(error)));
  }
  if (kind === 'property-update') {
    const customerId = value('customerId');
    void api('/api/admin/customers', { method: 'POST', body: JSON.stringify({ action: 'update_property', customerId, propertyId: value('propertyId'), status: value('status'), ...propertyPayload }) })
      .then(() => openCustomer(customerId))
      .catch((error) => setAppError(friendly(error)));
  }
  if (kind === 'note-add') void action('/api/admin/customers', { action: 'add_note', customerId: value('customerId'), body: value('body') });
  if (kind === 'payment') void action('/api/admin/finance', { action: 'record_payment', invoiceId: value('invoiceId'), provider: value('provider'), amount: value('amount'), reference: value('reference'), idempotencyKey: value('idempotencyKey') });
  if (kind === 'refund') void action('/api/admin/finance', { action: 'record_refund', paymentId: value('paymentId'), amount: value('amount'), reason: value('reason'), idempotencyKey: value('idempotencyKey') });
  if (kind === 'credit') void action('/api/admin/finance', { action: 'create_credit', customerId: value('customerId'), amount: value('amount'), source: value('source') });
  if (kind === 'credit-apply') {
    void action('/api/admin/finance', {
      action: 'apply_credit',
      invoiceId: value('invoiceId'),
      creditId: value('creditId'),
      amountCents: Math.round(Number(value('amount')) * 100),
    }).then(() => openInvoice(value('invoiceId')));
  }
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
      idempotencyKey: value('idempotencyKey'),
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
      bookingRequestId: value('bookingRequestId'),
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
  if (kind === 'request-close') { if (window.confirm('Close this pending request and release its hold?')) void submitRequestAction({ action: 'close', requestId: value('requestId'), reason: value('reason') }); }
  if (kind === 'request-duplicate') { if (window.confirm('Close this request as a duplicate? The original is not changed.')) void submitRequestAction({ action: 'duplicate', requestId: value('requestId'), duplicateOf: value('duplicateOf') }); }
  if (kind === 'request-archive') { if (window.confirm('Archive this request? Its calendar and appointment history are not changed.')) void submitRequestAction({ action: 'archive', requestId: value('requestId') }); }
  if (kind === 'request-reopen') { if (window.confirm('Reopen this request?')) void submitRequestAction({ action: 'reopen', requestId: value('requestId') }); }
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
    void api<{
      token?: string;
      expiresAt?: string;
      emailSent?: boolean;
      onboardingRequired?: boolean;
      onboardingUrl?: string;
    }>('/api/admin/timekeeping', {
      method: 'POST',
      body: JSON.stringify({
        action: 'invite_employee',
        email: value('email'),
        displayName: value('displayName'),
        qualification: value('qualification'),
        isBookable: checked('isBookable'),
      }),
    }).then((result) => {
      const target = document.querySelector<HTMLElement>('[data-time-invite-result]');
      if (!target) return;
      const link = result.token ? `${window.location.origin}/employee/?invite=${encodeURIComponent(result.token)}` : '';
      target.innerHTML = `${result.emailSent
        ? '<p class="admin-muted">Invitation email sent.</p>'
        : `<p class="admin-muted">Email was not sent. Share this one-time link directly:</p><p><a href="${esc(link)}">${esc(link)}</a></p>`}${result.onboardingRequired ? `<p class="admin-muted">Onboarding paperwork is required before work assignments.${result.onboardingUrl ? ` <a href="${esc(result.onboardingUrl)}">Open the signing link</a>.` : ''}</p>` : ''}`;
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
      void createRecurringPlan(form);
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

function documentResult(message: string, kind: 'ok' | 'error' = 'ok'): void {
  const target = document.querySelector<HTMLElement>('[data-document-template-result]');
  if (!target) return;
  target.innerHTML = `<p class="admin-${kind === 'error' ? 'error' : 'muted'}">${esc(message)}</p>`;
}

document.querySelector<HTMLFormElement>('[data-document-template-text]')?.addEventListener('submit', (event) => {
  event.preventDefault();
  const data = new FormData(event.currentTarget as HTMLFormElement);
  void api('/api/admin/documents', {
    method: 'POST',
    body: JSON.stringify({
      action: 'create_template',
      title: data.get('title'),
      category: data.get('category'),
      version: data.get('version'),
      signerParty: data.get('signerParty'),
      contentText: data.get('contentText'),
      requiresVerification: data.get('requiresVerification') === 'yes',
      requiresCountersignature: data.get('requiresCountersignature') === 'yes',
    }),
  }).then(() => {
    documentResult('Draft template saved. Approve it before it can be required.');
    return loadDocuments();
  }).catch((error) => documentResult(friendly(error), 'error'));
});

document.querySelector<HTMLFormElement>('[data-document-template-upload]')?.addEventListener('submit', (event) => {
  event.preventDefault();
  const form = event.currentTarget as HTMLFormElement;
  const formData = new FormData(form);
  formData.set('action', 'upload_template');
  const headers = new Headers({ Accept: 'application/json' });
  if (csrf) headers.set('X-CSRF-Token', csrf);
  void fetch('/api/admin/documents', { method: 'POST', headers, body: formData, credentials: 'same-origin' })
    .then(async (response) => {
      const result = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!response.ok || !result.ok) throw new Error(result.error ?? `HTTP ${response.status}`);
      documentResult('PDF template uploaded as a draft. Approve it before use.');
      form.reset();
      return loadDocuments();
    })
    .catch((error) => documentResult(friendly(error), 'error'));
});

document.querySelector<HTMLFormElement>('[data-document-bundle-create]')?.addEventListener('submit', (event) => {
  event.preventDefault();
  const data = new FormData(event.currentTarget as HTMLFormElement);
  void api('/api/admin/documents', {
    method: 'POST',
    body: JSON.stringify({
      action: 'create_bundle',
      code: data.get('code'),
      name: data.get('name'),
      subjectType: data.get('subjectType'),
      serviceCategory: data.get('serviceCategory'),
    }),
  }).then(() => {
    documentResult('Bundle created.');
    return loadDocuments();
  }).catch((error) => documentResult(friendly(error), 'error'));
});

document.querySelector<HTMLFormElement>('[data-document-bundle-item]')?.addEventListener('submit', (event) => {
  event.preventDefault();
  const data = new FormData(event.currentTarget as HTMLFormElement);
  void api('/api/admin/documents', {
    method: 'POST',
    body: JSON.stringify({
      action: 'add_item',
      bundleId: data.get('bundleId'),
      templateId: data.get('templateId'),
      enforcementStage: data.get('enforcementStage'),
      sortOrder: Number(data.get('sortOrder') ?? 0),
      conditionKey: data.get('conditionKey'),
      conditionValue: data.get('conditionValue'),
      perBooking: data.get('perBooking') === 'yes',
      required: true,
    }),
  }).then(() => {
    documentResult('Bundle requirement saved.');
    return loadDocuments().then(() => loadDocumentBundleItems(String(data.get('bundleId') ?? '')));
  }).catch((error) => documentResult(friendly(error), 'error'));
});

document.querySelector<HTMLFormElement>('[data-document-send]')?.addEventListener('submit', (event) => {
  event.preventDefault();
  const data = new FormData(event.currentTarget as HTMLFormElement);
  const target = document.querySelector<HTMLElement>('[data-document-send-result]');
  void api<{ required?: boolean; signingUrl?: string; emailSent?: boolean; message?: string }>('/api/admin/documents', {
    method: 'POST',
    body: JSON.stringify({
      action: 'send_request',
      subjectType: data.get('subjectType'),
      customerId: data.get('customerId'),
      teamMemberId: data.get('teamMemberId'),
      serviceCode: data.get('serviceCode'),
      frequency: data.get('frequency'),
      bookingReference: data.get('bookingReference'),
      email: data.get('email'),
    }),
  }).then((result) => {
    if (target) {
      target.innerHTML = result.required
        ? `<div class="admin-card"><p><strong>Signing link created.</strong> ${result.emailSent ? 'The email was sent.' : 'Email was not sent; share this private link.'}</p><p><a href="${esc(result.signingUrl)}">${esc(result.signingUrl)}</a></p></div>`
        : `<p class="admin-muted">${esc(result.message ?? 'No active required documents for this context.')}</p>`;
    }
    return loadDocuments();
  }).catch((error) => {
    if (target) target.innerHTML = `<p class="admin-error">${esc(friendly(error))}</p>`;
  });
});

document.addEventListener('change', (event) => {
  const target = event.target as HTMLSelectElement;
  if (target.matches('[data-document-bundle-options]')) {
    void loadDocumentBundleItems(target.value).catch((error) => setAppError(friendly(error)));
  }
  const bundle = (event.target as HTMLElement).closest<HTMLInputElement>('[data-manual-bundle]');
  if (bundle) {
    const required = (bundle.dataset.bundleRequired ?? '').split(',').filter(Boolean);
    for (const id of required) {
      const addon = document.querySelector<HTMLInputElement>(
        `[data-manual-addon][value="${CSS.escape(id)}"]`,
      );
      if (addon && bundle.checked) addon.checked = true;
    }
  }
});

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
  if (actionName === 'customer-edit') { document.querySelector<HTMLDetailsElement>('[data-customer-edit]')?.setAttribute('open', ''); }
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
    const start = document.querySelector<HTMLInputElement>(`[data-recurring-start="${CSS.escape(id)}"]`);
    const duration = document.querySelector<HTMLInputElement>(`[data-recurring-duration="${CSS.escape(id)}"]`);
    const window = document.querySelector<HTMLSelectElement>(`[data-recurring-window="${CSS.escape(id)}"]`);
    void action('/api/admin/operations', { action: 'update_recurring', planId: id, status: select?.value ?? '', window: window?.value ?? '', startTime: start?.value ?? '', durationMinutes: duration?.value ?? '' });
  }
  if (actionName === 'recurring-occurrences') {
    void loadRecurringOccurrences(id).catch((error) => setAppError(friendly(error)));
  }
  if (actionName === 'recurring-sync') {
    setAppError();
    void api('/api/admin/operations', {
      method: 'POST',
      body: JSON.stringify({ action: 'sync_recurring', planId: id, cancelSuperseded: false }),
    })
      .then(() => loadRecurringOccurrences(id))
      .catch((error) => setAppError(friendly(error)));
  }
  if (actionName === 'recurring-occurrence-skip') {
    void action('/api/admin/operations', {
      action: 'update_occurrence',
      occurrenceAction: 'skip',
      planId: target.dataset.plan ?? '',
      occurrenceId: id,
    }).then(() => loadRecurringOccurrences(target.dataset.plan ?? ''));
  }
  if (actionName === 'recurring-occurrence-reschedule') {
    const row = target.closest('tr');
    const date = row?.querySelector<HTMLInputElement>('[data-occurrence-date]')?.value ?? '';
    const startTime = row?.querySelector<HTMLInputElement>('[data-occurrence-time]')?.value ?? '';
    void action('/api/admin/operations', {
      action: 'update_occurrence',
      occurrenceAction: 'reschedule',
      planId: target.dataset.plan ?? '',
      occurrenceId: id,
      date,
      startTime,
    }).then(() => loadRecurringOccurrences(target.dataset.plan ?? ''));
  }
  if (actionName === 'team-save') {
    const qualification = document.querySelector<HTMLSelectElement>(`[data-team-qualification="${CSS.escape(id)}"]`);
    const bookable = document.querySelector<HTMLInputElement>(`[data-team-bookable="${CSS.escape(id)}"]`);
    void action('/api/admin/operations', {
      action: 'update_team',
      memberId: id,
      isSolo: qualification?.value === 'solo',
      isLead: qualification?.value === 'lead',
      isBookable: bookable?.checked ?? true,
    });
  }
  if (actionName === 'job-save') {
    const select = document.querySelector<HTMLSelectElement>(`[data-job-status="${CSS.escape(id)}"]`);
    void action('/api/admin/operations', { action: 'job_status', appointmentId: id, status: select?.value ?? '' });
  }
  if (actionName === 'job-assign') {
    const select = document.querySelector<HTMLSelectElement>(`[data-job-team="${CSS.escape(id)}"]`);
    if (select?.value) void action('/api/admin/operations', { action: 'assign_team', appointmentId: id, teamMemberIds: [select.value] });
  }
  if (actionName === 'document-approve') void action('/api/admin/documents', { action: 'approve_template', templateId: id });
  if (actionName === 'document-retire') void action('/api/admin/documents', { action: 'retire_template', templateId: id });
  if (actionName === 'document-bundle-open') void loadDocumentBundleItems(id).catch((error) => setAppError(friendly(error)));
  if (actionName === 'document-item-remove') {
    void action('/api/admin/documents', {
      action: 'remove_item',
      bundleId: target.dataset.bundle ?? '',
      templateId: id,
    });
  }
  if (actionName === 'document-request-open') void openDocumentRequest(id).catch((error) => setAppError(friendly(error)));
  if (actionName === 'document-request-close') {
    const detail = document.querySelector<HTMLElement>('[data-document-request-detail]');
    if (detail) { detail.hidden = true; detail.innerHTML = ''; }
  }
  if (actionName === 'document-request-resend') {
    setAppError();
    void api<{ signingUrl?: string; emailSent?: boolean }>('/api/admin/documents', {
      method: 'POST',
      body: JSON.stringify({ action: 'resend_request', requestId: id }),
    }).then((result) => {
      const detail = document.querySelector<HTMLElement>('[data-document-send-result]');
      if (detail) detail.innerHTML = `<p class="admin-muted">${result.emailSent ? 'Signing email resent.' : 'Email was not sent; share this private link.'} <a href="${esc(result.signingUrl)}">${esc(result.signingUrl)}</a></p>`;
    }).catch((error) => setAppError(friendly(error)));
  }
  if (actionName === 'document-signature-verify') {
    void action('/api/admin/documents', { action: 'verify_signature', signatureId: id });
  }
  if (actionName === 'document-owner-email-retry') {
    setAppError();
    void api('/api/admin/documents', {
      method: 'POST',
      body: JSON.stringify({ action: 'retry_executed_notifications', requestId: id }),
    })
      .then(() => openDocumentRequest(id))
      .catch((error) => setAppError(friendly(error)));
  }
  if (actionName === 'document-countersign') {
    setAppError();
    void api('/api/admin/documents', {
      method: 'POST',
      body: JSON.stringify({ action: 'countersign', requestId: id, name: actor?.name ?? '' }),
    })
      .then(() => openDocumentRequest(id))
      .catch((error) => setAppError(friendly(error)));
  }
  if (actionName === 'document-signature-reject') {
    void action('/api/admin/documents', { action: 'reject_signature', signatureId: id, reason: 'Rejected by owner' });
  }
  if (actionName === 'job-unassign') {
    void action('/api/admin/operations', {
      action: 'remove_team',
      appointmentId: id,
      teamMemberId: target.dataset.member ?? '',
    });
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
  if (actionName === 'manual-quote') void generateManualQuote();
  if (actionName === 'overview-open') void loadView(target.dataset.view ?? 'overview');
  if (actionName === 'manual-manage-customer') {
    const customerId = manualField<HTMLSelectElement>('customerId')?.value ?? '';
    void loadView('customers')
      .then(() => (customerId ? openCustomer(customerId) : undefined))
      .catch((error) => setAppError(friendly(error)));
  }
  if (actionName === 'manual-availability') void checkManualAvailability();
  if (actionName === 'manual-create') void saveManualBooking(false);
  if (actionName === 'manual-create-confirm') void saveManualBooking(true);
  if (actionName === 'manual-confirm') void confirmManualBooking(id);
  if (actionName === 'manual-send-documents') void sendManualDocuments(id);
  if (actionName === 'manual-invoice') void createManualInvoice(id, false);
  if (actionName === 'manual-invoice-link') void createManualInvoice(id, true);
  if (actionName === 'commitment-retry') {
    setAppError();
    void api('/api/admin/bookings', {
      method: 'POST',
      body: JSON.stringify({ action: 'reconcile', requestId: id }),
    })
      .then(() => refreshManualCommitments())
      .catch((error) => setAppError(friendly(error)));
  }
});

void loadAuth();
