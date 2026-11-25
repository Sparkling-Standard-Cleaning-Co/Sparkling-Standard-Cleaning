import {
  passwordConfirmationMessage,
  passwordConfirmationProblem,
  passwordPolicyMessage,
  passwordProblem,
} from '../lib/password-policy.ts';
import { loadPricingView } from './pricing-admin';
import { loadBranchView } from './admin-branches';
import './admin-address-autocomplete';
import { PET_OPTIONS, PROPERTY_TYPE_OPTIONS, RESIDENTIAL_INPUT_LIMITS } from '../config/estimators/input-definitions';
import { pricing } from '../config/pricing';
import { normalizeRichDocumentHtml, renderDocumentHtml } from '../lib/documents/rich-text.ts';
import { DOCUMENT_BRAND_CSS, renderBrandedDocumentHtml } from '../lib/documents/branding.ts';
import { displayVersion } from '../lib/documents/version-labels.ts';
import { formatLaborAndSite } from '../lib/format/duration.ts';

interface AdminActor {
  id: string;
  email: string;
  name: string;
  role: string;
  branchId: string | null;
  canSelectBranch?: boolean;
  permissions: string[];
  mfaEnabled: boolean;
  mfaMethod?: 'totp' | 'email';
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
const mfaCopy = document.querySelector<HTMLElement>('[data-admin-mfa-copy]');
const mfaCodeLabel = document.querySelector<HTMLElement>('[data-admin-mfa-code-label]');
const mfaResend = document.querySelector<HTMLButtonElement>('[data-admin-mfa-resend]');
const mfaGateStatus = document.querySelector<HTMLElement>('[data-admin-mfa-gate-status]');
const inviteForm = document.querySelector<HTMLFormElement>('[data-admin-invite]');
const resetForm = document.querySelector<HTMLFormElement>('[data-admin-reset]');
const passwordChangeForm = document.querySelector<HTMLFormElement>('[data-admin-password-change]');
const gateStatus = document.querySelector<HTMLElement>('[data-admin-gate-status]');
const errorEl = document.querySelector<HTMLElement>('[data-admin-error]');
const appError = document.querySelector<HTMLElement>('[data-admin-app-error]');
const userEl = document.querySelector<HTMLElement>('[data-admin-user]');
const roleEl = document.querySelector<HTMLElement>('[data-admin-role]');
const branchViewWrap = document.querySelector<HTMLElement>('[data-admin-branch-view-wrap]');
const branchViewSelect = document.querySelector<HTMLSelectElement>('[data-admin-branch-view]');
const titleEl = document.querySelector<HTMLElement>('[data-admin-view-title]');
const subEl = document.querySelector<HTMLElement>('[data-admin-view-sub]');
const navButtons = [...document.querySelectorAll<HTMLButtonElement>('[data-admin-nav]')];
const views = [...document.querySelectorAll<HTMLElement>('[data-admin-view]')];

let csrf = '';
let actor: AdminActor | null = null;
let mfaChallenge = '';
let mfaMethod: 'totp' | 'email' = 'totp';
let mfaResendAt = 0;
let emailMfaChallenge = '';
let currentView = 'overview';

function configureMfaGate(): void {
  if (mfaCopy) {
    mfaCopy.textContent =
      mfaMethod === 'email'
        ? 'Enter the six-digit code sent to the account email address. A recovery code also works.'
        : 'Enter the current authenticator code. A recovery code also works.';
  }
  if (mfaCodeLabel) {
    mfaCodeLabel.textContent = mfaMethod === 'email' ? 'Email verification code' : 'Authenticator code';
  }
  if (mfaResend) {
    mfaResend.hidden = mfaMethod !== 'email';
    mfaResend.disabled = Date.now() < mfaResendAt;
    mfaResend.textContent =
      Date.now() < mfaResendAt
        ? `Send another code in ${Math.ceil((mfaResendAt - Date.now()) / 1000)}s`
        : 'Send a new email code';
  }
}
let inviteToken = '';
let resetToken = '';

branchViewSelect?.addEventListener('change', () => {
  const value = branchViewSelect.value;
  void fetch('/api/admin/auth', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
    body: JSON.stringify({ action: 'branch_view', branchView: value }),
  }).then((response) => { if (response.ok) window.location.reload(); });
});

const viewMeta: Record<string, [string, string]> = {
  overview: ['Overview', 'Live cleaning-company operations.'],
  calendar: ['Calendar & Requests', 'Pending reservations and upcoming appointments.'],
  leads: ['Leads & Inquiries', 'Website inquiries, delivery status and follow-up.'],
  customers: ['Customers', 'Customer profiles, properties and history.'],
  'new-booking': ['New Booking', 'Create a one-time estimate and booking from a saved customer and property.'],
  'quick-estimate': ['Quick Estimate', 'Price a phone inquiry with live promotions, then save or convert it to a booking.'],
  recurring: ['Recurring Plans', 'Recurring cleaning administration.'],
  jobs: ['Jobs & Team', 'Cleaning jobs, assignments and checklists.'],
  careers: ['Careers', 'Private applications and hiring workflow.'],
  communications: ['Communications & Notifications', 'Department routing, approved templates, delivery health and version history.'],
  documents: ['Documents & Agreements', 'Owner-controlled templates, bundles and electronic signatures.'],
  timekeeping: ['Timekeeping', 'Employee hours, corrections and location verification.'],
  finance: ['Invoices & Payments', 'Invoicing, payments, credits and reconciliation.'],
  gift: ['Gift Certificates', 'Existing production gift register.'],
  reports: ['Reports', 'Operational and financial reporting.'],
  storage: ['Data & Storage', 'Database health, business-record counts, exports and photo retention.'],
  promotions: ['Promotions & Discounts', 'Owner-controlled codes, schedules, limits and redemption reporting.'],
  reviews: ['Google Reviews', 'Completed-service review invitations, branch review links and owner controls.'],
  pricing: ['Pricing & Estimator Control', 'Published prices, draft changes, simulations and version history.'],
  branches: ['Branches & Launch', 'Pensacola live operations and Tampa Bay prelaunch readiness.'],
  settings: ['Settings & Audit', 'Access, security, configuration and audit history.'],
};

const navPermission: Record<string, string> = {
  calendar: 'booking.read',
  leads: 'lead.read',
  customers: 'customer.read',
  'new-booking': 'booking.write',
  'quick-estimate': 'booking.write',
  recurring: 'job.read',
  jobs: 'job.read',
  communications: 'settings.write',
  documents: 'job.read',
  timekeeping: 'job.write',
  finance: 'finance.read',
  gift: 'finance.read',
  reports: 'finance.read',
  pricing: 'settings.write',
  branches: 'settings.write',
  reviews: 'settings.write',
};

function esc(value: unknown): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function durationLabel(value: unknown): string {
  const total = Number(value);
  if (!Number.isFinite(total) || total <= 0) return '-';
  const minutes = Math.round(total);
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (hours <= 0) return `${remainder} min`;
  return remainder ? `${hours} hr ${remainder} min` : `${hours} hr`;
}

function money(cents: unknown): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(cents ?? 0) / 100);
}

const BRANCH_TIME_ZONES: Record<string, string> = {
  branch_pensacola: 'America/Chicago',
  branch_tampa: 'America/New_York',
};

function dateTime(value: unknown, branchId?: unknown): string {
  const raw = String(value ?? '');
  if (!raw) return '—';
  const parsed = new Date(raw.includes('T') ? raw : `${raw}T12:00:00`);
  if (!Number.isFinite(parsed.getTime())) return raw;
  return new Intl.DateTimeFormat('en-US', {
    timeZone: BRANCH_TIME_ZONES[String(branchId ?? '')] ?? 'America/Chicago',
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

interface AdminConfirmInput {
  title: string;
  body: string;
  confirmLabel?: string;
  danger?: boolean;
}

function adminConfirm(input: AdminConfirmInput): Promise<boolean> {
  const dialog = document.querySelector<HTMLDialogElement>('[data-admin-dialog]');
  if (!dialog || typeof dialog.showModal !== 'function') {
    const plain = input.body.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    return Promise.resolve(window.confirm(`${input.title}\n\n${plain}`));
  }
  const title = dialog.querySelector<HTMLElement>('[data-admin-dialog-title]');
  const body = dialog.querySelector<HTMLElement>('[data-admin-dialog-body]');
  const confirmButton = dialog.querySelector<HTMLButtonElement>('[data-admin-dialog-confirm]');
  const cancelButton = dialog.querySelector<HTMLButtonElement>('[data-admin-dialog-cancel]');
  if (!title || !body || !confirmButton || !cancelButton) {
    return Promise.resolve(window.confirm(input.title));
  }
  title.textContent = input.title;
  body.innerHTML = input.body;
  confirmButton.textContent = input.confirmLabel ?? 'Confirm';
  confirmButton.classList.toggle('btn--danger', input.danger === true);
  confirmButton.classList.toggle('btn--primary', input.danger !== true);
  dialog.returnValue = 'cancel';
  const previousFocus = document.activeElement as HTMLElement | null;
  return new Promise((resolve) => {
    const onClose = (): void => {
      dialog.removeEventListener('close', onClose);
      previousFocus?.focus?.();
      resolve(dialog.returnValue === 'confirm');
    };
    dialog.addEventListener('close', onClose);
    dialog.showModal();
    cancelButton.focus();
  });
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
    mfa_invalid: 'That verification or recovery code is invalid.',
    mfa_code_invalid: 'That verification code is invalid or expired.',
    mfa_email_unavailable: 'Email verification could not be sent. Try again or use another MFA method.',
    mfa_challenge_invalid: 'That verification session expired. Sign in again.',
    mfa_resend_cooldown: 'Please wait before requesting another code.',
    email_mfa_not_configured: 'Email verification is not configured yet.',
    mfa_already_enabled: 'Two-step verification is already enabled.',
    mfa_step_up_required: 'Confirm your identity again before continuing.',
    mfa_not_enabled: 'Two-step verification is not enabled for this account.',
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
    electronic_signing_not_activated: 'Live electronic signing is not activated for this environment.',
    packet_has_no_documents:
      'This packet has no owner-approved documents. Add approved documents before sending it.',
    packet_not_found: 'That document packet could not be found or is not active.',
    document_variables_missing:
      'Required agreement details are missing. Fill the highlighted fields or select the correct customer, booking, and property.',
    invoice_not_payable: 'This invoice is not payable in its current state.',
    invoice_not_sendable: 'Only open, partially paid or overdue invoices can be emailed.',
    invoice_paid: 'This invoice has no outstanding balance.',
    customer_email_missing: 'The customer has no email address on file.',
    customer_email_invalid: 'The customer email address is not valid.',
    invoice_email_failed: 'The invoice email could not be sent. Check the Resend configuration and try again.',
    invoice_document_failed: 'The invoice PDF could not be generated.',
    payment_link_failed: 'The secure Stripe payment link could not be created. No email was sent.',
    invoice_session_unverified: 'The existing Stripe session could not be verified. Try again.',
    invoice_payment_processing: 'A Stripe payment is already processing for this invoice.',
    invoice_not_paid: 'Only a paid invoice can produce a payment receipt.',
    entitlement_preview_required: 'Preview the benefit before applying it.',
    entitlement_not_found: 'That benefit could not be found.',
    promotion_inactive: 'That promotion is not active.',
    promotion_not_percent: 'This persistent benefit requires a percentage promotion.',
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
    customer_archived:
      'This customer is archived. Restore the customer before creating a new booking.',
    appointment_not_reschedulable:
      'This appointment is not linked to a reservation request, so it cannot be moved here. Use the recurring schedule controls in Jobs & Team.',
    appointment_not_cancellable:
      'This appointment is not linked to a reservation request or recurring plan, so it cannot be cancelled here.',
    recurring_occurrence_not_scheduled: 'That recurring visit is no longer in a schedulable state.',
    recurring_occurrence_date_conflict: 'Another recurring visit already exists on that date.',
    recurring_occurrence_time_required: 'Choose a valid new date and start time.',
    recurring_occurrence_in_past: 'The new recurring date cannot be in the past.',
    crew_not_feasible:
      'That exact crew set is not feasible for this job. Review qualifications, availability, travel and crew size.',
    crew_selection_invalid: 'Select between one and the maximum crew size.',
    appointment_already_assigned:
      'This appointment already has a crew. Use Jobs & Team to change an established assignment.',
    active_request_must_close_or_cancel:
      'An active request with a held or confirmed appointment must be closed or cancelled before it can be archived.',
    request_not_approvable: 'Only pending, unclosed requests can be approved.',
    request_not_deniable: 'Only pending requests without an appointment can be denied.',
    paid_request_requires_refund_review:
      'This request has a payment. Refund review is required before it can be denied.',
    recurring_plan_records_are_not_test_data:
      'Recurring-plan appointments cannot be marked as disposable test data.',
    legal_hold_active: 'A legal hold prevents deletion of this protected record until the hold is released.',
  };
  return messages[code] ?? titleCase(code);
}

let stepUpPromise: Promise<boolean> | null = null;

async function confirmStepUp(): Promise<boolean> {
  if (!actor?.mfaEnabled) return false;
  if (stepUpPromise) return stepUpPromise;
  stepUpPromise = (async () => {
    try {
      const started = await api<{
        challengeToken?: string;
        mfaMethod?: 'totp' | 'email';
        expiresAt?: string;
      }>('/api/admin/auth', {
        method: 'POST',
        body: JSON.stringify({ action: 'step_up_start' }),
      });
      if (!started.challengeToken) throw new Error('mfa_challenge_invalid');
      const code = window.prompt(
        started.mfaMethod === 'email'
          ? 'Enter the six-digit code sent to your account email.'
          : 'Enter the current authenticator code.',
      );
      if (!code) {
        setAppError('A fresh verification code is required for this sensitive action.');
        return false;
      }
      await api('/api/admin/auth', {
        method: 'POST',
        body: JSON.stringify({
          action: 'step_up_verify',
          challengeToken: started.challengeToken,
          code,
        }),
      });
      setSuccess('Identity confirmed. Continuing the sensitive action.');
      return true;
    } catch (error) {
      setAppError(friendly(error));
      return false;
    } finally {
      stepUpPromise = null;
    }
  })();
  return stepUpPromise;
}

async function api<T>(path: string, init: RequestInit = {}, stepUpRetried = false): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('Accept', 'application/json');
  if (init.body) headers.set('Content-Type', 'application/json');
  if (csrf && init.method && init.method !== 'GET') headers.set('X-CSRF-Token', csrf);
  const response = await fetch(path, { ...init, headers, credentials: 'same-origin' });
  const data = (await response.json().catch(() => ({}))) as T & { ok?: boolean; error?: string; details?: string[] };
  if (
    response.status === 403 &&
    data.error === 'mfa_step_up_required' &&
    !stepUpRetried &&
    path !== '/api/admin/auth'
  ) {
    if (await confirmStepUp()) return api<T>(path, init, true);
  }
  if (!response.ok || data.ok === false) {
    const error = new Error(data.error || `HTTP ${response.status}`) as Error & { details?: string[] };
    error.details = Array.isArray(data.details) ? data.details : [];
    throw error;
  }
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
  if (mode === 'mfa') configureMfaGate();
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
  if (nextActor.canSelectBranch && branchViewWrap && branchViewSelect) {
    branchViewWrap.hidden = false;
    branchViewSelect.value = nextActor.branchId ?? 'all';
  }
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
    alertHistory?: Array<Record<string, unknown>>;
    recentLeads?: Array<Record<string, unknown>>;
  }>('/api/admin/overview');
  const counts = data.counts ?? {};
  const kpis = document.querySelector<HTMLElement>('[data-admin-kpis]');
  if (kpis) {
    kpis.innerHTML = [
      ['Today\'s jobs', counts.todayJobs ?? 0],
      ['Tomorrow', counts.tomorrowJobs ?? 0],
      ['Pending requests', counts.requests ?? 0],
      ['Unassigned jobs', counts.unassignedJobs ?? 0],
      ['Open leads', counts.leads ?? 0],
      ['Unsigned agreements', counts.unsignedAgreements ?? 0],
      ['Outstanding invoices', counts.outstandingInvoices ?? 0],
      ['Failed communications', counts.failedCommunications ?? 0],
      ['Customers', counts.customers ?? 0],
      ['Active gifts', counts.activeGifts ?? 0],
      ['Booking recovery', counts.failedCommitments ?? 0],
      ['Financial issues', counts.financialIssues ?? 0],
      ['Active recurring failures', counts.failedWorkerRuns ?? 0],
      ['Historical recurring failures', counts.failedWorkerRunsHistory ?? 0],
      ['Checkout failures', counts.failedCheckouts ?? 0],
      ['Abandoned checkouts', counts.abandonedCheckouts ?? 0],
    ].map(([label, value]) => `<div class="admin-card admin-kpi"><p class="admin-kpi__label">${esc(label)}</p><p class="admin-kpi__value">${esc(value)}</p></div>`).join('');
  }
  const alerts = document.querySelector<HTMLElement>('[data-admin-alerts]');
  if (alerts) {
    const rows = data.alerts ?? [];
    const history = data.alertHistory ?? [];
    alerts.innerHTML = rows.length
      ? `<div class="admin-card"><h2 class="admin-section-title">Operational alerts</h2><p class="admin-muted">Each alert explains what happened, why, and what to do next. Resolving or dismissing an alert never changes the underlying financial or operational record.</p>${rows
          .map((alert) => {
            const key = String(alert.key ?? alert.kind ?? '');
            const severity = String(alert.severity ?? 'medium');
            const status = titleCase(String(alert.status ?? 'new'));
            const records = Array.isArray(alert.records)
              ? (alert.records as Array<Record<string, unknown>>)
              : [];
            return `<details class="admin-alert admin-alert--${esc(severity)}">
              <summary><span class="admin-status">${esc(status)}</span> <strong>${esc(alert.title ?? alert.message ?? 'Operational alert')}</strong> <span class="admin-muted">${esc(alert.count ?? 0)} record(s)</span></summary>
              <div class="admin-alert__body">
                <p>${esc(alert.explanation ?? alert.message ?? '')}</p>
                <dl class="admin-definition">
                  <dt>First seen</dt><dd>${esc(alert.firstSeen ? dateTime(alert.firstSeen) : 'Not recorded')}</dd>
                  <dt>Most recent</dt><dd>${esc(alert.lastSeen ? dateTime(alert.lastSeen) : 'Not recorded')}</dd>
                  <dt>Root cause</dt><dd>${esc(alert.rootCause ?? 'Review the affected records for the exact cause.')}</dd>
                  <dt>Recommended action</dt><dd>${esc(alert.recommendation ?? 'Open the affected area and review the records.')}</dd>
                </dl>
                ${records.length ? `<h4>Affected records</h4><ul class="admin-alert__records">${records.map((record) => `<li><strong>${esc(record.label ?? '')}</strong> <span class="admin-muted">${esc(record.detail ?? '')}</span>${record.id ? ` <button class="btn btn--ghost btn--small" type="button" data-admin-action="${key === 'documents.unsigned' ? 'alert-document-open' : key === 'finance.outstanding_invoices' ? 'alert-invoice-open' : 'request-open'}" data-id="${esc(record.id)}">Open</button>` : ''}</li>`).join('')}</ul>` : ''}
                <div class="admin-actions">
                  <button class="btn btn--primary btn--small" type="button" data-admin-action="overview-open" data-view="${esc(alert.view ?? 'overview')}" data-filter="${esc(alert.filter ?? '')}">Open affected area</button>
                  <button class="btn btn--ghost btn--small" type="button" data-admin-action="overview-recheck">Recheck now</button>
                  <button class="btn btn--ghost btn--small" type="button" data-admin-action="alert-action" data-key="${esc(key)}" data-alert-action="acknowledge" data-kind="${esc(alert.kind ?? '')}" data-title="${esc(alert.title ?? '')}">Acknowledge</button>
                  <button class="btn btn--ghost btn--small" type="button" data-admin-action="alert-action" data-key="${esc(key)}" data-alert-action="investigate" data-kind="${esc(alert.kind ?? '')}" data-title="${esc(alert.title ?? '')}">Investigating</button>
                  <button class="btn btn--secondary btn--small" type="button" data-admin-action="alert-action" data-key="${esc(key)}" data-alert-action="resolve" data-kind="${esc(alert.kind ?? '')}" data-title="${esc(alert.title ?? '')}">Resolve</button>
                  ${actor?.role === 'owner' ? `<button class="btn btn--ghost btn--small" type="button" data-admin-action="alert-action" data-key="${esc(key)}" data-alert-action="dismiss" data-kind="${esc(alert.kind ?? '')}" data-title="${esc(alert.title ?? '')}">Dismiss as non-actionable</button>` : ''}
                </div>
                <label class="admin-field--wide" style="display:block;margin-top:.5rem;">Resolution note (required when resolving)
                  <input data-alert-note="${esc(key)}" maxlength="1000" placeholder="What was wrong and what fixed it?" />
                </label>
                ${alert.resolutionNote ? `<p class="admin-muted">Resolved: ${esc(alert.resolutionNote)}</p>` : ''}
              </div>
            </details>`;
          })
          .join('')}</div>`
      : '<div class="admin-card"><h2 class="admin-section-title">Operational alerts</h2><p class="admin-muted">No operational exceptions are open.</p></div>';
    if (history.length) {
      alerts.insertAdjacentHTML(
        'beforeend',
        `<details class="admin-detail-toggle" style="margin-top:.75rem;"><summary>Resolved and dismissed alert history (${history.length})</summary>${history.map((entry) => `<div class="admin-record"><p><strong>${esc(entry.key)}</strong> <span class="admin-status">${esc(titleCase(String(entry.status)))}</span></p><p class="admin-muted">${esc(entry.note || 'No resolution note recorded.')} · ${esc(dateTime(entry.resolvedAt || entry.dismissedAt || entry.updatedAt || ''))}</p></div>`).join('')}</details>`,
      );
    }
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

let weekOffset = 0;
let weekAppointments: Array<Record<string, unknown>> = [];
let weekEmployeeFilter = '';
let weekServiceFilter = '';
let weekStatusFilter = '';
let weekBranchFilter = '';
let loadedAppointments: Array<Record<string, unknown>> = [];
let appointmentStatusFilter = 'active';
let appointmentRangeFilter = '30';
let appointmentEmployeeFilter = '';
let appointmentServiceFilter = '';
let appointmentPage = 0;
const APPOINTMENT_PAGE_SIZE = 20;

function centralTodayKey(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Chicago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function addDateKey(key: string, days: number): string {
  const date = new Date(`${key}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function weekDateKeys(): string[] {
  const today = centralTodayKey();
  const weekday = new Date(`${today}T12:00:00Z`).getUTCDay();
  const start = addDateKey(today, -weekday + weekOffset * 7);
  return Array.from({ length: 7 }, (_, index) => addDateKey(start, index));
}

function appointmentService(request: Record<string, unknown>): string {
  try {
    const payload = JSON.parse(String(request.request_payload ?? '{}')) as Record<string, unknown>;
    const raw = String(payload.service_label ?? payload.service_type ?? payload.serviceType ?? 'Cleaning');
    return raw.replaceAll('_', ' ').replaceAll('-', ' ').replace(/\b\w/g, (character) => character.toUpperCase());
  } catch {
    return 'Cleaning';
  }
}

function appointmentReference(appointment: Record<string, unknown>): string {
  const reference = String(appointment.reference ?? '').trim();
  if (reference && !/^RECURRING-rec_/i.test(reference)) return reference;
  const customer = [appointment.first_name, appointment.last_name].filter(Boolean).join(' ') || 'Recurring customer';
  return `${customer} · ${appointmentService(appointment)}`;
}

function appointmentBranchZone(branchId: unknown): string {
  return BRANCH_TIME_ZONES[String(branchId ?? '')] ?? 'America/Chicago';
}

function appointmentZoneLabel(branchId: unknown): string {
  return String(branchId ?? '') === 'branch_tampa' ? 'ET' : 'CT';
}

function appointmentDateKey(value: unknown, branchId?: unknown): string {
  const date = new Date(String(value ?? ''));
  if (!Number.isFinite(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: appointmentBranchZone(branchId),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function appointmentLocalHour(value: unknown, branchId?: unknown): number {
  const date = new Date(String(value ?? ''));
  if (!Number.isFinite(date.getTime())) return 12;
  const hour = new Intl.DateTimeFormat('en-US', {
    timeZone: appointmentBranchZone(branchId),
    hour: 'numeric',
    hourCycle: 'h23',
  }).format(date);
  return Number(hour) || 0;
}

function appointmentLocalTime(value: unknown, branchId?: unknown): string {
  const date = new Date(String(value ?? ''));
  if (!Number.isFinite(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-US', {
    timeZone: appointmentBranchZone(branchId),
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

function appointmentTimeRange(appointment: Record<string, unknown>): string {
  const start = new Date(String(appointment.start_at ?? ''));
  const end = new Date(String(appointment.end_at ?? ''));
  if (!Number.isFinite(start.getTime())) return 'Time not recorded';
  const zone = appointmentZoneLabel(appointment.branch_id);
  return `${appointmentLocalTime(start, appointment.branch_id)}${
    Number.isFinite(end.getTime()) ? ` — ${appointmentLocalTime(end, appointment.branch_id)}` : ''
  } ${zone}`;
}

function appointmentStatusClass(status: string): string {
  if (status === 'confirmed') return 'is-confirmed';
  if (status === 'pending') return 'is-pending';
  if (status === 'in_progress') return 'is-progress';
  if (status === 'completed') return 'is-completed';
  if (status === 'cancelled' || status === 'no_show') return 'is-cancelled';
  return 'is-neutral';
}

function weekFilteredAppointments(): Array<Record<string, unknown>> {
  return weekAppointments.filter((appointment) => {
    const status = String(appointment.status ?? '');
    if (!weekStatusFilter && ['cancelled', 'no_show'].includes(status)) return false;
    if (weekStatusFilter && weekStatusFilter !== 'all' && status !== weekStatusFilter) return false;
    if (weekEmployeeFilter) {
      const assigned = String(appointment.assigned_names ?? '');
      if (!assigned.split(',').map((entry) => entry.trim()).includes(weekEmployeeFilter)) return false;
    }
    if (weekServiceFilter && appointmentService(appointment) !== weekServiceFilter) return false;
    if (weekBranchFilter && String(appointment.branch_id ?? '') !== weekBranchFilter) return false;
    return true;
  });
}

function refreshWeekFilterOptions(): void {
  const employeeSelect = document.querySelector<HTMLSelectElement>('[data-admin-week-employee]');
  if (employeeSelect) {
    const names = new Set<string>();
    for (const appointment of weekAppointments) {
      for (const name of String(appointment.assigned_names ?? '').split(',').map((entry) => entry.trim()).filter(Boolean)) {
        names.add(name);
      }
    }
    const current = employeeSelect.value;
    employeeSelect.innerHTML = `<option value="">All employees</option>${[...names].sort().map((name) => `<option value="${esc(name)}">${esc(name)}</option>`).join('')}`;
    employeeSelect.value = names.has(current) ? current : '';
    weekEmployeeFilter = employeeSelect.value;
  }
  const serviceSelect = document.querySelector<HTMLSelectElement>('[data-admin-week-service]');
  if (serviceSelect) {
    const services = new Set(weekAppointments.map((appointment) => appointmentService(appointment)));
    const current = serviceSelect.value;
    serviceSelect.innerHTML = `<option value="">All services</option>${[...services].sort().map((name) => `<option value="${esc(name)}">${esc(name)}</option>`).join('')}`;
    serviceSelect.value = services.has(current) ? current : '';
    weekServiceFilter = serviceSelect.value;
  }
}

const weekAppointmentIndex = new Map<string, Record<string, unknown>>();
const weekCycleIndices = new Map<string, number>();

function appointmentRecurring(appointment: Record<string, unknown>): boolean {
  return Boolean(appointment.recurring_plan_id || appointment.recurring_occurrence_id)
    || /^RECURRING-rec_/i.test(String(appointment.reference ?? ''));
}

function appointmentCardMarkup(
  appointment: Record<string, unknown>,
  index: number,
  sectionKey: string,
): string {
  const id = String(appointment.id ?? '');
  weekAppointmentIndex.set(id, appointment);
  const status = String(appointment.status ?? 'pending');
  const customer = [appointment.first_name, appointment.last_name].filter(Boolean).join(' ') || 'Unlinked customer';
  const property = [appointment.line1, appointment.city].filter(Boolean).join(', ') || 'Property not linked';
  const current = weekCycleIndices.get(sectionKey) ?? 0;
  const hidden = current === index ? '' : ' hidden';
  const active = ['pending', 'confirmed', 'in_progress'].includes(status);
  const actions = can('booking.write')
    ? `<div class="admin-appointment-actions">
        <button class="btn btn--ghost btn--small" type="button" data-admin-appointment-action="open" data-appointment-id="${esc(id)}">Open</button>
        <button class="btn btn--ghost btn--small" type="button" data-admin-appointment-action="customer" data-appointment-id="${esc(id)}"${appointment.customer_id ? '' : ' disabled'}>Customer</button>
        ${active ? `<button class="btn btn--ghost btn--small" type="button" data-admin-appointment-action="reschedule" data-appointment-id="${esc(id)}">Move</button>
        <button class="btn btn--ghost btn--small" type="button" data-admin-appointment-action="cancel" data-appointment-id="${esc(id)}">Cancel</button>` : ''}
        <button class="btn btn--ghost btn--small" type="button" data-admin-appointment-action="documents" data-appointment-id="${esc(id)}">Docs</button>
        <button class="btn btn--ghost btn--small" type="button" data-admin-appointment-action="invoice" data-appointment-id="${esc(id)}">Invoice</button>
      </div>`
    : '';
  return `<article class="admin-appointment-card ${appointmentStatusClass(status)}" tabindex="0" role="button" draggable="${active && can('booking.write') ? 'true' : 'false'}" data-week-appointment="${esc(id)}" data-week-section="${esc(sectionKey)}" data-week-index="${index}" data-admin-action="appointment-open" data-request="${esc(appointment.booking_request_id ?? '')}" aria-label="${esc(`${appointmentTimeRange(appointment)} ${customer} ${appointmentService(appointment)}${appointmentRecurring(appointment) ? ' recurring' : ''}`)}"${hidden}>
    <p class="admin-appointment-card__time">${esc(appointmentTimeRange(appointment))}</p>
    <p class="admin-appointment-card__customer">${esc(customer)}</p>
    <p class="admin-appointment-card__service">${esc(appointmentService(appointment))}${appointmentRecurring(appointment) ? ' · Recurring' : ''}</p>
    <p class="admin-appointment-card__meta">Crew: ${esc(String(appointment.assigned_names || 'Unassigned'))}</p>
    <p class="admin-appointment-card__meta">${esc(property)}</p>
    <span class="admin-appointment-card__status">${esc(titleCase(status.replaceAll('_', ' ')))}</span>
    <span class="admin-appointment-card__ref">${esc(appointmentReference(appointment))}</span>
    ${actions}
  </article>`;
}

function weekDateLabel(key: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(`${key}T12:00:00Z`));
}

function weekSectionMarkup(
  day: string,
  label: string,
  jobs: Array<Record<string, unknown>>,
): string {
  const sectionKey = `${day}-${label.toLowerCase()}`;
  const current = Math.min(weekCycleIndices.get(sectionKey) ?? 0, Math.max(0, jobs.length - 1));
  if (current !== (weekCycleIndices.get(sectionKey) ?? 0)) weekCycleIndices.set(sectionKey, current);
  const popover = jobs.length > 1
    ? `<div class="admin-week-popover" aria-hidden="true">${jobs
        .map((job) => `<p><strong>${esc(appointmentLocalTime(job.start_at, job.branch_id))}</strong> ${esc(
          [job.first_name, job.last_name].filter(Boolean).join(' ') || 'Unlinked customer',
        )} — ${esc(appointmentService(job))}${appointmentRecurring(job) ? ' · Recurring' : ''}</p>`)
        .join('')}</div>`
    : '';
  return `<div class="admin-week-section" data-week-drop="${esc(day)}">
    <div class="admin-week-section__head"><span>${esc(label)}</span><span class="admin-week-section__count">${jobs.length}</span></div>
    ${
      jobs.length
        ? `<div class="admin-week-stack">${jobs.map((job, index) => appointmentCardMarkup(job, index, sectionKey)).join('')}${popover}</div>
           ${jobs.length > 1 ? `<button class="admin-week-more" type="button" data-week-cycle="${esc(sectionKey)}">+${jobs.length - 1} more</button>` : ''}`
        : '<p class="admin-week-empty">No appointments</p>'
    }
  </div>`;
}

function renderWeekBoard(appointments: Array<Record<string, unknown>>): void {
  const target = document.querySelector<HTMLElement>('[data-admin-week-board]');
  if (!target) return;
  weekAppointments = appointments;
  weekAppointmentIndex.clear();
  refreshWeekFilterOptions();
  const days = weekDateKeys();
  const filtered = weekFilteredAppointments();
  const byDay = new Map<string, Array<Record<string, unknown>>>();
  for (const appointment of filtered) {
    const key = appointmentDateKey(appointment.start_at, appointment.branch_id);
    if (!key) continue;
    const list = byDay.get(key) ?? [];
    list.push(appointment);
    byDay.set(key, list);
  }
  const label = document.querySelector<HTMLElement>('[data-admin-week-label]');
  if (label) {
    const zone = weekBranchFilter ? appointmentZoneLabel(weekBranchFilter) : 'each branch’s local time';
    label.textContent = `${weekDateLabel(days[0] ?? centralTodayKey())} – ${weekDateLabel(days[6] ?? centralTodayKey())} · ${zone}${weekOffset === 0 ? ' · Current week' : ''}`;
  }
  const today = centralTodayKey();
  target.innerHTML = `<div class="admin-week-grid">${days.map((day) => {
    const jobs = (byDay.get(day) ?? []).sort((a, b) => String(a.start_at).localeCompare(String(b.start_at)));
    const morning = jobs.filter((appointment) => appointmentLocalHour(appointment.start_at, appointment.branch_id) < 12);
    const afternoon = jobs.filter((appointment) => appointmentLocalHour(appointment.start_at, appointment.branch_id) >= 12);
    const dayLabel = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'short' }).format(new Date(`${day}T12:00:00Z`));
    const dateLabel = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' }).format(new Date(`${day}T12:00:00Z`));
    return `<section class="admin-week-day${day === today ? ' is-today' : ''}">
      <header><span>${esc(dayLabel)}</span><strong>${esc(dateLabel)}</strong>${day === today ? '<span class="admin-week-today">Today</span>' : ''}</header>
      <div class="admin-week-day__jobs">
        ${weekSectionMarkup(day, 'Morning', morning)}
        ${weekSectionMarkup(day, 'Afternoon', afternoon)}
      </div>
    </section>`;
  }).join('')}</div>`;
}

function appointmentLocalHhmm(value: unknown, branchId?: unknown): string {
  const date = new Date(String(value ?? ''));
  if (!Number.isFinite(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: appointmentBranchZone(branchId),
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(date);
}

function zonedIso(date: string, time: string, timeZone: string): string {
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  if (!year || !month || !day || !Number.isFinite(hour) || !Number.isFinite(minute)) return '';
  const guess = Date.UTC(year, month - 1, day, hour, minute, 0);
  const offsetAt = (timestamp: number): number => {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(new Date(timestamp));
    const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    const asUtc = Date.UTC(
      Number(map.year),
      Number(map.month) - 1,
      Number(map.day),
      Number(map.hour) % 24,
      Number(map.minute),
      Number(map.second),
    );
    return asUtc - timestamp;
  };
  let utc = guess - offsetAt(guess);
  utc = guess - offsetAt(utc);
  return new Date(utc).toISOString();
}

function calendarDialogContainer(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-admin-calendar-dialog]');
}

function closeCalendarDialog(): void {
  const container = calendarDialogContainer();
  if (container) container.innerHTML = '';
}

function openCalendarReschedule(appointment: Record<string, unknown>, proposedDate = ''): void {
  const container = calendarDialogContainer();
  if (!container || !can('booking.write')) return;
  const branchId = appointment.branch_id;
  const timeZone = appointmentBranchZone(branchId);
  const date = proposedDate || appointmentDateKey(appointment.start_at, branchId) || appointmentDateKey(new Date(), branchId);
  const time = appointmentLocalHhmm(appointment.start_at, branchId);
  const recurring = appointmentRecurring(appointment);
  const hasPlan = Boolean(appointment.recurring_plan_id && appointment.recurring_occurrence_id);
  const customer = [appointment.first_name, appointment.last_name].filter(Boolean).join(' ') || 'Unlinked customer';
  const property = [appointment.line1, appointment.city].filter(Boolean).join(', ') || 'Property not linked';
  container.innerHTML = `<div class="admin-calendar-dialog-card" role="dialog" aria-modal="true" aria-labelledby="calendar-reschedule-title">
    <div class="admin-detail-head"><h2 class="admin-section-title" id="calendar-reschedule-title">Reschedule appointment</h2><button class="btn btn--ghost btn--small" type="button" data-calendar-close>Close</button></div>
    <dl class="admin-definition">
      <dt>Customer</dt><dd>${esc(customer)}</dd>
      <dt>Service</dt><dd>${esc(appointmentService(appointment))}${recurring ? ' · Recurring' : ''}</dd>
      <dt>Property</dt><dd>${esc(property)}</dd>
      <dt>Current</dt><dd>${esc(appointmentTimeRange(appointment))}</dd>
      <dt>Duration</dt><dd>${esc(durationLabel(appointment.duration_minutes))}</dd>
      <dt>Crew</dt><dd>${esc(String(appointment.assigned_names || 'Unassigned'))}</dd>
      <dt>Branch time</dt><dd>${esc(timeZone)} (${esc(appointmentZoneLabel(branchId))})</dd>
    </dl>
    ${
      hasPlan
        ? `<div class="admin-calendar-scope"><p><strong>How would you like to change this recurring cleaning?</strong></p>
            <label><input type="radio" name="calendar-recurring-scope" value="occurrence" checked /> <span><strong>This appointment only</strong><br /><span class="admin-muted">Preserves the recurrence rule and every other appointment.</span></span></label>
            <label><input type="radio" name="calendar-recurring-scope" value="future" /> <span><strong>This appointment and future cleanings</strong><br /><span class="admin-muted">Applies the new date and time to the eligible future schedule. Completed and historical visits are never rewritten.</span></span></label>
          </div>`
        : ''
    }
    <form class="admin-form admin-form--grid" data-calendar-form="reschedule" data-appointment-id="${esc(String(appointment.id ?? ''))}">
      <label>New date <input name="date" type="date" value="${esc(date)}" required /></label>
      <label>Start time (${esc(appointmentZoneLabel(branchId))}) <input name="time" type="time" value="${esc(time)}" required /></label>
      ${
        recurring
          ? '<p class="admin-field--wide admin-muted">Recurring changes are validated against the branch calendar, operating hours and existing crew assignments. No customer email is sent by this action.</p>'
          : `<label class="admin-field--wide"><input type="checkbox" name="notify" value="yes" /> Email the customer after the move</label>`
      }
      <p class="admin-field--wide admin-muted">A drop or click is a proposal. The new date and exact start time are validated before anything changes.</p>
      <div class="admin-actions admin-field--wide"><button class="btn btn--primary btn--small" type="submit">Review and move appointment</button><button class="btn btn--ghost btn--small" type="button" data-calendar-close>Cancel</button></div>
    </form>
    <p class="admin-error" data-calendar-error role="alert"></p>
  </div>`;
  container.querySelector<HTMLElement>('[data-calendar-error]')!.textContent = '';
}

function openCalendarCancel(appointment: Record<string, unknown>): void {
  const container = calendarDialogContainer();
  if (!container || !can('booking.write')) return;
  const recurring = appointmentRecurring(appointment);
  const hasPlan = Boolean(appointment.recurring_plan_id);
  const customer = [appointment.first_name, appointment.last_name].filter(Boolean).join(' ') || 'Unlinked customer';
  container.innerHTML = `<div class="admin-calendar-dialog-card" role="dialog" aria-modal="true" aria-labelledby="calendar-cancel-title">
    <div class="admin-detail-head"><h2 class="admin-section-title" id="calendar-cancel-title">Cancel appointment</h2><button class="btn btn--ghost btn--small" type="button" data-calendar-close>Close</button></div>
    <dl class="admin-definition">
      <dt>Customer</dt><dd>${esc(customer)}</dd>
      <dt>Service</dt><dd>${esc(appointmentService(appointment))}${recurring ? ' · Recurring' : ''}</dd>
      <dt>Time</dt><dd>${esc(appointmentTimeRange(appointment))}</dd>
      <dt>Crew</dt><dd>${esc(String(appointment.assigned_names || 'Unassigned'))}</dd>
    </dl>
    ${
      hasPlan
        ? `<div class="admin-calendar-scope"><p><strong>Cancel this occurrence or the whole recurring plan?</strong></p>
            <label><input type="radio" name="calendar-cancel-scope" value="occurrence" checked /> <span><strong>This appointment only</strong><br /><span class="admin-muted">Cancels this visit and leaves the rest of the plan scheduled.</span></span></label>
            <label><input type="radio" name="calendar-cancel-scope" value="plan" /> <span><strong>Cancel the entire recurring plan</strong><br /><span class="admin-muted">Stops future visits. Completed and historical visits are preserved.</span></span></label>
          </div>`
        : ''
    }
    <form class="admin-form" data-calendar-form="cancel" data-appointment-id="${esc(String(appointment.id ?? ''))}">
      <label>Reason (optional) <input name="reason" maxlength="500" /></label>
      <label><input type="checkbox" name="notify" value="yes" /> Email the customer about this cancellation</label>
      <div class="admin-actions"><button class="btn btn--danger btn--small" type="submit">Review and cancel</button><button class="btn btn--ghost btn--small" type="button" data-calendar-close>Keep appointment</button></div>
    </form>
    <p class="admin-error" data-calendar-error role="alert"></p>
  </div>`;
}

async function openCalendarJob(appointmentId: string): Promise<void> {
  const container = calendarDialogContainer();
  if (!container) return;
  const data = await api<{
    job: Record<string, unknown>;
    invoice: Record<string, unknown> | null;
    documents: Array<Record<string, unknown>>;
    invoices?: Array<Record<string, unknown>>;
    payments?: Array<Record<string, unknown>>;
    photos?: Array<Record<string, unknown>>;
    communications?: Array<Record<string, unknown>>;
    crew?: Array<Record<string, unknown>>;
    changeOrders?: Array<Record<string, unknown>>;
    timeline?: Array<Record<string, unknown>>;
  }>(`/api/admin/bookings?view=job&appointmentId=${encodeURIComponent(appointmentId)}`);
  const job = data.job;
  const invoice = data.invoice;
  const customer = [job.first_name, job.last_name].filter(Boolean).join(' ') || 'Customer';
  const property = [job.property_label, job.line1, job.city, job.state, job.postal_code].filter(Boolean).join(', ');
  const service = String(job.service_name ?? job.service_code ?? 'Cleaning service');
  const documents = data.documents ?? [];
  const invoices = data.invoices ?? [];
  const payments = data.payments ?? [];
  const photos = data.photos ?? [];
  const communications = data.communications ?? [];
  const crew = data.crew ?? [];
  const changeOrders = data.changeOrders ?? [];
  const timeline = data.timeline ?? [];
  container.innerHTML = `<div class="admin-calendar-dialog-card" role="dialog" aria-modal="true" aria-labelledby="calendar-job-title">
    <div class="admin-detail-head"><h2 class="admin-section-title" id="calendar-job-title">Job ${esc(String(job.reference ?? ''))}</h2><button class="btn btn--ghost btn--small" type="button" data-calendar-close>Close</button></div>
    <dl class="admin-definition">
      <dt>Customer</dt><dd>${esc(customer)}</dd>
      <dt>Property</dt><dd>${esc(property || 'Not linked')}</dd>
      <dt>Service</dt><dd>${esc(service)}</dd>
      <dt>Status</dt><dd>${esc(titleCase(String(job.status ?? '').replaceAll('_', ' ')))}</dd>
      <dt>Date</dt><dd>${esc(dateTime(job.start_at, job.branch_id))}</dd>
      <dt>Agreed price</dt><dd>${esc(Number(job.total_cents) > 0 ? money(job.total_cents) : 'Not recorded')}</dd>
      <dt>Crew</dt><dd>${esc(crew.length ? crew.map((member) => String(member.display_name ?? '')).join(', ') : String(job.assigned_names || 'Unassigned'))}</dd>
      <dt>Photos</dt><dd>${esc(String(photos.length))} linked</dd>
      <dt>Primary invoice</dt><dd>${invoice ? `${esc(invoice.number)} · ${esc(titleCase(String(invoice.status)))} · balance ${esc(money(invoice.balanceCents))}` : 'No invoice yet'}</dd>
    </dl>
    <h3>Change orders</h3>
    ${changeOrders.length ? `<div class="admin-table-scroll"><table class="admin-table"><thead><tr><th>Reference</th><th>Status</th><th>Adjustment</th><th>Revised price</th><th>Actions</th></tr></thead><tbody>${changeOrders.map((row) => {
      const status = String(row.effective_status ?? row.status ?? '');
      const actions = [
        status === 'pending_approval' ? `<button class="btn btn--secondary btn--small" type="button" data-admin-action="change-order-approve" data-id="${esc(row.id)}" data-appointment="${esc(appointmentId)}">Approve</button>` : '',
        status === 'pending_approval' ? `<button class="btn btn--ghost btn--small" type="button" data-admin-action="change-order-decline" data-id="${esc(row.id)}" data-appointment="${esc(appointmentId)}">Decline</button>` : '',
        status === 'approved' ? `<button class="btn btn--primary btn--small" type="button" data-admin-action="change-order-send" data-id="${esc(row.id)}" data-appointment="${esc(appointmentId)}">Send for signature</button>` : '',
        row.signing_request_id ? `<button class="btn btn--ghost btn--small" type="button" data-admin-action="document-request-open" data-id="${esc(row.signing_request_id)}">Open agreement</button>` : '',
        status === 'signed' && !row.supplemental_invoice_id ? `<button class="btn btn--secondary btn--small" type="button" data-admin-action="change-order-invoice" data-id="${esc(row.id)}" data-appointment="${esc(appointmentId)}">Create supplemental invoice</button>` : '',
        row.supplemental_invoice_id ? `<button class="btn btn--ghost btn--small" type="button" data-admin-action="invoice-open" data-id="${esc(row.supplemental_invoice_id)}">Open supplemental invoice</button>` : '',
      ].filter(Boolean).join('');
      return `<tr><td>${esc(row.reference)}</td><td><span class="admin-status">${esc(titleCase(status))}</span></td><td>${esc(money(row.adjustment_cents))}</td><td>${esc(money(row.revised_price_cents))}</td><td><div class="admin-actions">${actions || '<span class="admin-muted">No action</span>'}</div></td></tr>`;
    }).join('')}</tbody></table></div>` : '<p class="admin-muted">No change orders are recorded for this job.</p>'}
    <details class="admin-detail-toggle" style="margin-top:.75rem;"><summary>Create change order</summary>
      <form class="admin-form" style="max-width:none" data-form="change-order-create">
        <input type="hidden" name="appointmentId" value="${esc(appointmentId)}" />
        <input type="hidden" name="customerId" value="${esc(String(job.customer_id ?? ''))}" />
        <label>Original scope <textarea name="originalScope" rows="2" maxlength="4000">${esc(service)}</textarea></label>
        <label>Revised / added scope <textarea name="revisedScope" rows="3" maxlength="4000" required></textarea></label>
        <label>Additional amount (USD, negative for a reduction) <input name="adjustment" type="number" step="0.01" required /></label>
        <label>Reason for the change <textarea name="reason" rows="2" maxlength="2000" required></textarea></label>
        <label>Effective date <input name="effectiveDate" type="date" value="${localToday(0)}" /></label>
        <button class="btn btn--primary btn--small" type="submit">Create change order for approval</button>
      </form>
    </details>
    <div data-change-order-result role="status" aria-live="polite"></div>
    <h3>Finance</h3>
    ${invoices.length ? `<div class="admin-table-scroll"><table class="admin-table"><thead><tr><th>Invoice</th><th>Type</th><th>Status</th><th>Total</th><th>Balance</th><th></th></tr></thead><tbody>${invoices.map((row) => `<tr><td>${esc(row.number)}</td><td>${esc(titleCase(String(row.invoice_role || 'primary')))}</td><td>${esc(titleCase(String(row.status)))}</td><td>${esc(money(row.total_cents))}</td><td>${esc(money(row.balance_cents))}</td><td><button class="btn btn--ghost btn--small" type="button" data-admin-action="invoice-open" data-id="${esc(row.id)}">Open</button></td></tr>`).join('')}</tbody></table></div>` : '<p class="admin-muted">No invoice is linked to this job.</p>'}
    ${payments.length ? `<div class="admin-history">${payments.map((payment) => `<div class="admin-record"><p><strong>${esc(money(payment.amount_cents))}</strong> · ${esc(titleCase(String(payment.status)))} · ${esc(titleCase(String(payment.provider)))}${Number(payment.tip_cents ?? 0) > 0 ? ` · ${esc(money(payment.tip_cents))} gratuity` : ''}</p><p class="admin-muted">${esc(dateTime(payment.received_at || payment.created_at))}</p></div>`).join('')}</div>` : '<p class="admin-muted">No payment is linked to this job.</p>'}
    <h3>Documents &amp; agreements</h3>
    ${documents.length ? `<div class="admin-table-scroll"><table class="admin-table"><thead><tr><th>Packet</th><th>Status</th><th>Executed</th><th></th></tr></thead><tbody>${documents.map((document) => `<tr><td>${esc(document.packet_name || document.bundle_code || 'Agreement')}</td><td>${esc(titleCase(String(document.status ?? '')))}</td><td>${esc(document.executed_at ? dateTime(document.executed_at) : '—')}</td><td>${document.executed_at ? `<a class="btn btn--ghost btn--small" href="/api/admin/documents?view=executed&id=${encodeURIComponent(String(document.id))}">Executed copy</a>` : ''}</td></tr>`).join('')}</tbody></table></div>` : '<p class="admin-muted">No document request is linked to this job.</p>'}
    <h3>Communications</h3>
    ${communications.length ? `<div class="admin-history">${communications.map((message) => `<div class="admin-record"><p><strong>${esc(titleCase(String(message.channel ?? '')))} ${esc(titleCase(String(message.direction ?? '')))}</strong> · ${esc(titleCase(String(message.status ?? '')))}</p><p class="admin-muted">${esc(message.subject || message.template || '')} · ${esc(dateTime(message.created_at))}</p></div>`).join('')}</div>` : '<p class="admin-muted">No communications are linked to this job.</p>'}
    <h3>Activity timeline</h3>
    ${timeline.length ? `<div class="admin-history">${timeline.map((event) => `<div class="admin-record"><p><strong>${esc(event.title)}</strong> <span class="admin-muted">· ${esc(dateTime(event.at))}</span></p><p class="admin-muted">${esc(event.detail)}</p></div>`).join('')}</div>` : '<p class="admin-muted">No activity is recorded for this job.</p>'}
    <div class="admin-actions" style="margin-top:1rem;">
      <button class="btn btn--secondary btn--small" type="button" data-calendar-job-action="customer" data-id="${esc(String(job.customer_id ?? ''))}">Open Customer</button>
      <button class="btn btn--primary btn--small" type="button" data-calendar-job-action="invoice" data-id="${esc(appointmentId)}">${invoice ? 'Open Invoice' : 'Create Invoice'}</button>
      <button class="btn btn--ghost btn--small" type="button" data-calendar-close>Close</button>
    </div>
  </div>`;
}

async function openCalendarJobInvoice(appointmentId: string): Promise<void> {
  const data = await api<{
    job: Record<string, unknown>;
    invoice: Record<string, unknown> | null;
  }>(`/api/admin/bookings?view=job&appointmentId=${encodeURIComponent(appointmentId)}`);
  if (data.invoice) {
    await loadView('finance');
    await openInvoice(String(data.invoice.id));
    return;
  }
  const job = data.job;
  const customer = [job.first_name, job.last_name].filter(Boolean).join(' ') || 'Customer';
  const service = String(job.service_name ?? job.service_code ?? 'Cleaning service');
  const total = Number(job.total_cents);
  if (!Number.isFinite(total) || total <= 0) {
    setAppError('This job has no agreed price snapshot, so an invoice cannot be created automatically.');
    return;
  }
  const confirmed = await adminConfirm({
    title: 'Create the invoice for this completed job?',
    body: `<p><strong>${esc(customer)}</strong> · ${esc(service)}</p><p>Completed ${esc(dateTime(job.start_at, job.branch_id))} · agreed service amount <strong>${esc(money(total))}</strong>.</p><p>The invoice will be linked to this existing job and will <strong>not</strong> be emailed or charged.</p>`,
    confirmLabel: `Create ${money(total)} invoice`,
  });
  if (!confirmed) return;
  try {
    const result = await api<{ invoice?: { id: string; number?: string } }>('/api/admin/bookings', {
      method: 'POST',
      body: JSON.stringify({ action: 'invoice_job', appointmentId, paymentLink: false }),
    });
    if (!result.invoice?.id) throw new Error('invoice_not_created');
    setSuccess(`Invoice ${result.invoice.number ?? ''} created from the existing completed job.`);
    await loadView('finance');
    await openInvoice(result.invoice.id);
  } catch (error) {
    setAppError(friendly(error));
  }
}

async function handleCalendarAppointmentAction(button: HTMLElement): Promise<void> {
  const appointment = weekAppointmentIndex.get(button.dataset.appointmentId ?? '');
  if (!appointment) return;
  const action = button.dataset.adminAppointmentAction ?? '';
  if (action === 'open') {
    const requestId = String(appointment.booking_request_id ?? '');
    if (requestId) {
      await openRequest(requestId);
    } else {
      await openCalendarJob(String(appointment.id ?? ''));
    }
    return;
  }
  if (action === 'customer') {
    const customerId = String(appointment.customer_id ?? '');
    if (!customerId) return;
    await loadView('customers');
    await openCustomer(customerId);
    return;
  }
  if (action === 'documents') {
    const requestId = String(appointment.booking_request_id ?? '');
    if (requestId) {
      await openRequest(requestId);
      const detail = document.querySelector<HTMLElement>('[data-admin-request-detail]');
      detail?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else {
      await openCalendarJob(String(appointment.id ?? ''));
    }
    return;
  }
  if (action === 'invoice') {
    const requestId = String(appointment.booking_request_id ?? '');
    if (requestId) {
      await openRequest(requestId);
      const cards = [...document.querySelectorAll<HTMLElement>('[data-admin-request-detail] h3')];
      cards.find((heading) => heading.textContent?.trim() === 'Invoice')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else {
      await openCalendarJobInvoice(String(appointment.id ?? ''));
    }
    return;
  }
  if (action === 'reschedule') {
    openCalendarReschedule(appointment);
    return;
  }
  if (action === 'cancel') {
    openCalendarCancel(appointment);
  }
}

async function submitCalendarReschedule(form: HTMLFormElement): Promise<void> {
  const appointment = weekAppointmentIndex.get(form.dataset.appointmentId ?? '');
  const errorNode = form.parentElement?.querySelector<HTMLElement>('[data-calendar-error]') ?? null;
  if (!appointment) return;
  const data = new FormData(form);
  const date = String(data.get('date') ?? '');
  const time = String(data.get('time') ?? '');
  const notify = data.get('notify') === 'yes';
  const branchId = appointment.branch_id;
  const timeZone = appointmentBranchZone(branchId);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) {
    if (errorNode) errorNode.textContent = 'Choose a valid new date and start time.';
    return;
  }
  const duration = Number(appointment.duration_minutes) || 120;
  const start = zonedIso(date, time, timeZone);
  const end = new Date(Date.parse(start) + duration * 60_000).toISOString();
  const scope = (form.parentElement?.querySelector<HTMLInputElement>('input[name="calendar-recurring-scope"]:checked')?.value) ?? 'occurrence';
  const recurring = appointmentRecurring(appointment);
  const hasPlan = Boolean(appointment.recurring_plan_id && appointment.recurring_occurrence_id);
  const customer = [appointment.first_name, appointment.last_name].filter(Boolean).join(' ') || 'Unlinked customer';
  if (recurring && scope === 'future') {
    const confirmed = await adminConfirm({
      title: 'Change future recurring appointments?',
      body: `<p>Move <strong>${esc(customer)}</strong> to <strong>${esc(date)} at ${esc(time)}</strong> (${esc(appointmentZoneLabel(branchId))}) beginning with this appointment.</p>
      <p>The server will validate the branch calendar, operating hours, travel and crew feasibility. Eligible future occurrences are regenerated; completed and historical visits are preserved. Conflicts are reported before the plan is left inconsistent.</p>`,
      confirmLabel: 'Change future schedule',
    });
    if (!confirmed) return;
    try {
      const result = await api<Record<string, unknown>>('/api/admin/operations', {
        method: 'POST',
        body: JSON.stringify({
          action: 'update_recurring',
          planId: String(appointment.recurring_plan_id),
          startDate: date,
          startTime: time,
        }),
      });
      closeCalendarDialog();
      await loadCalendar(currentRequestView);
      const sync = result.sync as { created?: number; cancelled?: number; errors?: unknown[] } | undefined;
      setSuccess(
        `Recurring schedule updated${sync ? ` · ${Number(sync.created ?? 0)} future visit(s) scheduled · ${Number(sync.cancelled ?? 0)} superseded` : ''}.`,
      );
    } catch (error) {
      if (errorNode) errorNode.textContent = friendly(error);
    }
    return;
  }
  const confirmed = await adminConfirm({
    title: 'Move this appointment?',
    body: `<p><strong>${esc(customer)}</strong> · ${esc(appointmentService(appointment))}</p><p>${esc(appointmentTimeRange(appointment))} → <strong>${esc(date)} at ${esc(time)} ${esc(appointmentZoneLabel(branchId))}</strong></p><p>Duration ${esc(durationLabel(duration))} · Crew ${esc(String(appointment.assigned_names || 'Unassigned'))}</p><p>The server will re-validate the slot, calendar, operating hours and crew availability before saving.</p>${notify ? '<p><strong>A customer reschedule email will be sent.</strong></p>' : ''}`,
    confirmLabel: 'Move appointment',
  });
  if (!confirmed) return;
  try {
    if (hasPlan) {
      await api('/api/admin/operations', {
        method: 'POST',
        body: JSON.stringify({
          action: 'update_occurrence',
          planId: String(appointment.recurring_plan_id),
          occurrenceId: String(appointment.recurring_occurrence_id),
          occurrenceAction: 'reschedule',
          date,
          startTime: time,
        }),
      });
    } else {
      const requestId = String(appointment.booking_request_id ?? '');
      if (!requestId) throw new Error('appointment_not_reschedulable');
      await api('/api/admin/requests', {
        method: 'POST',
        body: JSON.stringify({ action: 'reschedule', requestId, date, start, end, notify }),
      });
    }
    closeCalendarDialog();
    await loadCalendar(currentRequestView);
    setSuccess('Appointment moved.');
  } catch (error) {
    if (errorNode) errorNode.textContent = friendly(error);
  }
}

async function submitCalendarCancel(form: HTMLFormElement): Promise<void> {
  const appointment = weekAppointmentIndex.get(form.dataset.appointmentId ?? '');
  const errorNode = form.parentElement?.querySelector<HTMLElement>('[data-calendar-error]') ?? null;
  if (!appointment) return;
  const data = new FormData(form);
  const reason = String(data.get('reason') ?? '').trim();
  const notify = data.get('notify') === 'yes';
  const scope = (form.parentElement?.querySelector<HTMLInputElement>('input[name="calendar-cancel-scope"]:checked')?.value) ?? 'occurrence';
  const customer = [appointment.first_name, appointment.last_name].filter(Boolean).join(' ') || 'Unlinked customer';
  const planCancel = scope === 'plan';
  const confirmed = await adminConfirm({
    title: planCancel ? 'Cancel the entire recurring plan?' : 'Cancel this appointment?',
    body: `<p><strong>${esc(customer)}</strong> · ${esc(appointmentService(appointment))}</p><p>${esc(appointmentTimeRange(appointment))}</p>${
      planCancel
        ? '<p>Future recurring visits will be cancelled. Completed and historical appointments, signed agreements and financial records are preserved.</p>'
        : '<p>Only this appointment is cancelled. Cancellation history is preserved.</p>'
    }${notify ? '<p><strong>A customer cancellation email will be sent.</strong></p>' : '<p>No customer email will be sent.</p>'}`,
    confirmLabel: planCancel ? 'Cancel plan' : 'Cancel appointment',
    danger: true,
  });
  if (!confirmed) return;
  try {
    if (planCancel) {
      await api('/api/admin/operations', {
        method: 'POST',
        body: JSON.stringify({ action: 'update_recurring', planId: String(appointment.recurring_plan_id), status: 'cancelled' }),
      });
    } else if (appointment.recurring_plan_id && appointment.recurring_occurrence_id) {
      await api('/api/admin/operations', {
        method: 'POST',
        body: JSON.stringify({
          action: 'update_occurrence',
          planId: String(appointment.recurring_plan_id),
          occurrenceId: String(appointment.recurring_occurrence_id),
          occurrenceAction: 'skip',
        }),
      });
    } else {
      const requestId = String(appointment.booking_request_id ?? '');
      if (!requestId) throw new Error('appointment_not_cancellable');
      await api('/api/admin/requests', {
        method: 'POST',
        body: JSON.stringify({ action: 'cancel', requestId, reason, notify }),
      });
    }
    closeCalendarDialog();
    await loadCalendar(currentRequestView);
    setSuccess(planCancel ? 'Recurring plan cancelled. History was preserved.' : 'Appointment cancelled.');
  } catch (error) {
    if (errorNode) errorNode.textContent = friendly(error);
  }
}

document.addEventListener('submit', (event) => {
  const form = event.target as HTMLFormElement;
  const kind = form.dataset.calendarForm;
  if (!kind) return;
  event.preventDefault();
  void (kind === 'reschedule' ? submitCalendarReschedule(form) : submitCalendarCancel(form));
});

document.addEventListener('click', (event) => {
  const calendarContainer = (event.target as HTMLElement).closest<HTMLElement>('[data-admin-calendar-dialog]');
  if (calendarContainer && event.target === calendarContainer) {
    closeCalendarDialog();
    return;
  }
  const close = (event.target as HTMLElement).closest<HTMLElement>('[data-calendar-close]');
  if (close) {
    closeCalendarDialog();
    return;
  }
  const cycle = (event.target as HTMLElement).closest<HTMLElement>('[data-week-cycle]');
  if (cycle) {
    const key = cycle.dataset.weekCycle ?? '';
    const section = cycle.closest('.admin-week-section');
    if (!section) return;
    const cards = [...section.querySelectorAll<HTMLElement>('[data-week-appointment]')];
    if (cards.length < 2) return;
    const next = ((weekCycleIndices.get(key) ?? 0) + 1) % cards.length;
    weekCycleIndices.set(key, next);
    cards.forEach((card, index) => {
      card.hidden = index !== next;
    });
    cycle.textContent = next === 0 ? `+${cards.length - 1} more` : `Next · ${next + 1} of ${cards.length}`;
    return;
  }
  const jobAction = (event.target as HTMLElement).closest<HTMLElement>('[data-calendar-job-action]');
  if (jobAction) {
    event.preventDefault();
    event.stopImmediatePropagation();
    const jobActionName = jobAction.dataset.calendarJobAction ?? '';
    const jobId = jobAction.dataset.id ?? '';
    if (jobActionName === 'customer' && jobId) {
      void loadView('customers').then(() => openCustomer(jobId)).catch((error) => setAppError(friendly(error)));
    } else if (jobActionName === 'invoice' && jobId) {
      void openCalendarJobInvoice(jobId).catch((error) => setAppError(friendly(error)));
    }
    return;
  }
  const appointmentAction = (event.target as HTMLElement).closest<HTMLElement>('[data-admin-appointment-action]');
  if (appointmentAction) {
    event.preventDefault();
    event.stopImmediatePropagation();
    void handleCalendarAppointmentAction(appointmentAction);
  }
});

document.addEventListener('dragstart', (event) => {
  const card = (event.target as HTMLElement).closest<HTMLElement>('[data-week-appointment]');
  if (!card || card.getAttribute('draggable') !== 'true') return;
  const id = card.dataset.weekAppointment ?? '';
  if (!id || !event.dataTransfer) return;
  event.dataTransfer.setData('text/plain', id);
  event.dataTransfer.effectAllowed = 'move';
  card.classList.add('is-dragging');
});

document.addEventListener('dragend', (event) => {
  const card = (event.target as HTMLElement).closest<HTMLElement>('[data-week-appointment]');
  card?.classList.remove('is-dragging');
  for (const zone of document.querySelectorAll<HTMLElement>('[data-week-drop]')) {
    zone.classList.remove('is-drop-target');
  }
});

document.addEventListener('dragover', (event) => {
  const zone = (event.target as HTMLElement).closest<HTMLElement>('[data-week-drop]');
  if (!zone) return;
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
  zone.classList.add('is-drop-target');
});

document.addEventListener('dragleave', (event) => {
  const zone = (event.target as HTMLElement).closest<HTMLElement>('[data-week-drop]');
  if (zone && !zone.contains(event.relatedTarget as Node | null)) zone.classList.remove('is-drop-target');
});

document.addEventListener('drop', (event) => {
  const zone = (event.target as HTMLElement).closest<HTMLElement>('[data-week-drop]');
  if (!zone) return;
  event.preventDefault();
  zone.classList.remove('is-drop-target');
  const id = event.dataTransfer?.getData('text/plain') ?? '';
  const appointment = weekAppointmentIndex.get(id);
  if (!appointment) return;
  openCalendarReschedule(appointment, zone.dataset.weekDrop ?? '');
});

function renderUpcomingAppointments(): void {
  const target = document.querySelector<HTMLElement>('[data-admin-appointments]');
  if (!target) return;
  const employeeSelect = document.querySelector<HTMLSelectElement>('[data-admin-appointment-employee]');
  const serviceSelect = document.querySelector<HTMLSelectElement>('[data-admin-appointment-service]');
  if (employeeSelect) {
    const names = new Set<string>();
    for (const appointment of loadedAppointments) {
      for (const name of String(appointment.assigned_names ?? '').split(',').map((entry) => entry.trim()).filter(Boolean)) names.add(name);
    }
    const current = employeeSelect.value;
    employeeSelect.innerHTML = `<option value="">All employees</option>${[...names].sort().map((name) => `<option value="${esc(name)}">${esc(name)}</option>`).join('')}`;
    employeeSelect.value = names.has(current) ? current : '';
    appointmentEmployeeFilter = employeeSelect.value;
  }
  if (serviceSelect) {
    const services = new Set(loadedAppointments.map((appointment) => appointmentService(appointment)));
    const current = serviceSelect.value;
    serviceSelect.innerHTML = `<option value="">All services</option>${[...services].sort().map((name) => `<option value="${esc(name)}">${esc(name)}</option>`).join('')}`;
    serviceSelect.value = services.has(current) ? current : '';
    appointmentServiceFilter = serviceSelect.value;
  }
  const now = Date.now();
  const limit = appointmentRangeFilter === 'all' ? null : now + Number(appointmentRangeFilter) * 86_400_000;
  const rows = loadedAppointments.filter((appointment) => {
    const status = String(appointment.status ?? '');
    if (appointmentStatusFilter === 'active' && !['confirmed', 'pending', 'in_progress'].includes(status)) return false;
    if (appointmentStatusFilter === 'confirmed' && status !== 'confirmed') return false;
    if (appointmentStatusFilter === 'pending' && status !== 'pending') return false;
    if (appointmentStatusFilter === 'cancelled' && !['cancelled', 'no_show'].includes(status)) return false;
    if (appointmentStatusFilter === 'completed' && status !== 'completed') return false;
    const start = Date.parse(String(appointment.start_at ?? ''));
    if (!Number.isFinite(start)) return false;
    if (appointmentStatusFilter !== 'all' && appointmentStatusFilter !== 'completed' && start < now - 86_400_000) return false;
    if (limit !== null && start > limit) return false;
    if (appointmentEmployeeFilter) {
      const assigned = String(appointment.assigned_names ?? '').split(',').map((entry) => entry.trim());
      if (!assigned.includes(appointmentEmployeeFilter)) return false;
    }
    if (appointmentServiceFilter && appointmentService(appointment) !== appointmentServiceFilter) return false;
    return true;
  }).sort((a, b) => String(a.start_at).localeCompare(String(b.start_at)));
  const totalPages = Math.max(1, Math.ceil(rows.length / APPOINTMENT_PAGE_SIZE));
  appointmentPage = Math.min(Math.max(0, appointmentPage), totalPages - 1);
  const pageRows = rows.slice(appointmentPage * APPOINTMENT_PAGE_SIZE, (appointmentPage + 1) * APPOINTMENT_PAGE_SIZE);
  const pager = document.querySelector<HTMLElement>('[data-admin-appointments-pagination]');
  if (pager) {
    pager.innerHTML = rows.length > APPOINTMENT_PAGE_SIZE
      ? `<div class="admin-actions"><button class="btn btn--ghost btn--small" type="button" data-admin-action="appointments-page" data-page="${appointmentPage - 1}"${appointmentPage === 0 ? ' disabled' : ''}>Previous</button><span class="admin-muted">Page ${appointmentPage + 1} of ${totalPages} · ${rows.length} appointments</span><button class="btn btn--ghost btn--small" type="button" data-admin-action="appointments-page" data-page="${appointmentPage + 1}"${appointmentPage >= totalPages - 1 ? ' disabled' : ''}>Next</button></div>`
      : `<p class="admin-muted">${rows.length} appointment${rows.length === 1 ? '' : 's'} in this view.</p>`;
  }
  if (pageRows.length === 0) {
    renderEmpty(target, 'No appointments match this view.');
    return;
  }
  target.innerHTML = `<div class="admin-table-scroll"><table class="admin-table"><thead><tr><th>Start</th><th>Customer</th><th>Service</th><th>Property</th><th>Assigned</th><th>Status</th><th>Reference</th></tr></thead><tbody>${pageRows.map((appointment) => {
    const customer = [appointment.first_name, appointment.last_name].filter(Boolean).join(' ') || 'Unlinked customer';
    const property = [appointment.line1, appointment.city].filter(Boolean).join(', ') || 'Not linked';
    return `<tr><td>${esc(dateTime(appointment.start_at))}</td><td><button class="btn btn--ghost btn--small" type="button" data-admin-action="customer-open" data-id="${esc(appointment.customer_id ?? '')}"${appointment.customer_id ? '' : ' disabled'}>${esc(customer)}</button></td><td>${esc(appointmentService(appointment))}</td><td>${esc(property)}</td><td>${esc(String(appointment.assigned_names || 'Unassigned'))}</td><td><span class="admin-status">${esc(titleCase(String(appointment.status ?? '').replaceAll('_', ' ')))}</span></td><td>${esc(appointmentReference(appointment))}</td></tr>`;
  }).join('')}</tbody></table></div>`;
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

const selectedRequestIds = new Set<string>();
let visibleRequestIds: string[] = [];
let filteredRequestIds: string[] = [];
let loadedRequests: Array<Record<string, unknown>> = [];
let requestServiceFilter = '';
let requestFromFilter = '';
let requestToFilter = '';
let currentRequestView = 'actionable';

function requestServiceLabel(request: Record<string, unknown>): string {
  try {
    const payload = JSON.parse(String(request.payload_json ?? '{}')) as Record<string, unknown>;
    const raw = String(payload.service_label ?? payload.service_type ?? payload.serviceType ?? 'Cleaning');
    return raw.replaceAll('_', ' ').replaceAll('-', ' ').replace(/\b\w/g, (character) => character.toUpperCase());
  } catch {
    return 'Cleaning';
  }
}

function updateRequestBulkToolbar(): void {
  const toolbar = document.querySelector<HTMLElement>('[data-admin-request-bulk]');
  if (!toolbar) return;
  toolbar.hidden = selectedRequestIds.size === 0;
  const count = toolbar.querySelector<HTMLElement>('[data-admin-request-bulk-count]');
  if (count) count.textContent = `${selectedRequestIds.size} selected`;
  for (const checkbox of document.querySelectorAll<HTMLInputElement>('[data-admin-request-select]')) {
    checkbox.checked = selectedRequestIds.has(checkbox.value);
  }
  const allVisible = visibleRequestIds.length > 0 && visibleRequestIds.every((id) => selectedRequestIds.has(id));
  const master = document.querySelector<HTMLInputElement>('[data-admin-request-select-all-visible]');
  if (master) master.checked = allVisible;
}

function renderRequestRows(): void {
  const target = document.querySelector<HTMLElement>('[data-admin-requests]');
  if (!target) return;
  const rows = loadedRequests.filter((request) => {
    const service = requestServiceLabel(request).toLowerCase();
    if (requestServiceFilter && !service.includes(requestServiceFilter)) return false;
    const start = String(request.start_at ?? '').slice(0, 10);
    if (requestFromFilter && start && start < requestFromFilter) return false;
    if (requestToFilter && start && start > requestToFilter) return false;
    return true;
  });
  filteredRequestIds = rows.map((request) => String(request.id));
  visibleRequestIds = rows.slice(0, 200).map((request) => String(request.id));
  if (rows.length === 0) {
    renderEmpty(target, 'No requests match this view and filter.');
    updateRequestBulkToolbar();
    return;
  }
  target.innerHTML = `<div class="admin-table-scroll"><table class="admin-table"><thead><tr><th><input type="checkbox" data-admin-request-select-all-visible aria-label="Select all visible requests" /></th><th>Start</th><th>Reference</th><th>Customer</th><th>Service</th><th>Property</th><th>Payment</th><th>Status</th><th>Action</th></tr></thead><tbody>${rows.map((request) => {
    const id = String(request.id);
    return `<tr><td><input type="checkbox" data-admin-request-select value="${esc(id)}" aria-label="Select request ${esc(request.quote_reference ?? id)}" /></td><td>${esc(dateTime(request.start_at))}</td><td>${esc(request.quote_reference)}${Number(request.is_test) === 1 ? ' <span class="admin-status">Test</span>' : ''}</td><td>${esc([request.first_name, request.last_name].filter(Boolean).join(' ') || 'Unlinked request')}</td><td>${esc(requestServiceLabel(request))}</td><td>${esc(requestLocation(request))}</td><td>${esc(requestPayment(request))}</td><td><span class="admin-status">${esc(requestStage(request))}</span></td><td><button class="btn btn--ghost btn--small" type="button" data-admin-action="request-open" data-id="${esc(id)}">Open</button></td></tr>`;
  }).join('')}</tbody></table></div>`;
  updateRequestBulkToolbar();
}

async function loadCalendar(view = 'actionable', query = ''): Promise<void> {
  currentRequestView = view;
  const data = await api<{ requests?: Array<Record<string, unknown>>; appointments?: Array<Record<string, unknown>> }>(
    `/api/admin/requests?view=${encodeURIComponent(view)}&q=${encodeURIComponent(query)}`,
  );
  loadedRequests = data.requests ?? [];
  for (const button of document.querySelectorAll<HTMLButtonElement>(
    '[data-admin-request-bulk] [data-operation="mark_test"], [data-admin-request-bulk] [data-operation="delete_test"]',
  )) {
    button.hidden = actor?.role !== 'owner';
  }
  renderRequestRows();
  renderWeekBoard(data.appointments ?? []);
  loadedAppointments = data.appointments ?? [];
  appointmentPage = 0;
  renderUpcomingAppointments();
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
  const checkout = await api<{ enabled?: boolean; recurringScheduling?: boolean; mode?: string; checks?: Record<string, boolean | null> }>('/api/estimate-checkout').catch(() => null);
  const linked = Boolean(request.customer_id);
  const status = String(request.status ?? '');
  const pending = status === 'pending';
  const confirmed = Boolean(request.appointment_id);
  const customerName = [request.first_name, request.last_name].filter(Boolean).join(' ') || request.company_name || '';
  const email = String(data.email ?? '');

  let customerOptions = '';
  try {
    const customers = await api<{ customers?: Array<Record<string, unknown>> }>('/api/admin/customers?status=active&limit=200');
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
            <div class="admin-field--wide admin-address-block" data-admin-address-block>
              <div class="admin-address-grid">
                <label class="admin-field--wide">Service address
                  <input name="addressLine1" value="${esc(String(payload.locationText ?? ''))}" maxlength="200" autocomplete="off" data-admin-address-input required />
                </label>
                <label>Apartment / unit <input name="addressUnit" maxlength="40" data-admin-address-unit /></label>
                <label>City <input name="city" value="${esc(String(payload.city ?? ''))}" maxlength="80" data-admin-address-city /></label>
                <label>State <input name="state" maxlength="2" value="FL" data-admin-address-state /></label>
                <label>ZIP <input name="postalCode" maxlength="10" data-admin-address-zip /></label>
                <input type="hidden" name="latitude" data-admin-address-lat />
                <input type="hidden" name="longitude" data-admin-address-lng />
                <input type="hidden" name="precision" data-admin-address-precision />
              </div>
              <p class="admin-address-status" data-admin-address-status role="status" aria-live="polite"></p>
            </div>
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

  const checkoutFailure = String(payload.checkout_failure_reason ?? payload.checkout_error ?? '').trim();
  const checkoutCard = `<div class="admin-card" style="margin-top:1rem;"><h3>Payment &amp; checkout</h3><dl class="admin-definition"><dt>Payment state</dt><dd>${esc(requestPayment(request))}</dd><dt>Checkout readiness</dt><dd>${checkout?.enabled ? 'Ready' : 'Unavailable'}</dd><dt>Recurring scheduling</dt><dd>${checkout?.recurringScheduling ? 'Enabled' : 'Disabled - recurring checkout is blocked'}</dd><dt>Last checkout issue</dt><dd>${esc(checkoutFailure || 'No failed checkout is recorded for this request.')}</dd><dt>Last issue time</dt><dd>${esc(dateTime(payload.checkout_failure_at || '', request.branch_id))}</dd></dl></div>`;

  const invoice = (data.invoice ?? null) as Record<string, unknown> | null;
  const invoiceCard = `<div class="admin-card" style="margin-top:1rem;"><h3>Invoice</h3>${
    invoice
      ? `<dl class="admin-definition"><dt>Number</dt><dd>${esc(invoice.number)}</dd><dt>Status</dt><dd>${esc(titleCase(invoice.status))}</dd><dt>Total</dt><dd>${esc(money(invoice.total_cents))}</dd><dt>Balance</dt><dd>${esc(money(invoice.balance_cents))}</dd><dt>Due</dt><dd>${esc(String(invoice.due_date ?? '—'))}</dd></dl><div class="admin-actions">${can('finance.read') ? `<button class="btn btn--secondary btn--small" type="button" data-admin-action="request-open-invoice" data-invoice-id="${esc(invoice.id)}">Open in Finance</button>` : ''}</div>`
      : `<p class="admin-muted">No invoice exists for this booking. Creating an invoice uses the agreed estimate price and does not email the customer or charge a card.</p>${can('finance.write') ? `<button class="btn btn--secondary btn--small" type="button" data-admin-action="request-create-invoice" data-id="${esc(requestId)}">Create Invoice</button>` : ''}`
  }</div>`;

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
      <dt>Requested</dt><dd>${esc(dateTime(request.start_at, request.branch_id))} – ${esc(dateTime(request.end_at, request.branch_id))}</dd>
      <dt>Status</dt><dd>${esc(titleCase(status))}</dd>
      <dt>Customer</dt><dd>${esc(customerName || 'Not linked')}</dd>
      <dt>Contact</dt><dd>${esc(email || '—')}</dd>
      <dt>Property</dt><dd>${esc([request.line1, request.city, request.state, request.postal_code].filter(Boolean).join(', ') || String(payload.locationText ?? '—'))}</dd>
      <dt>Service</dt><dd>${esc(String(payload.service_label ?? payload.serviceType ?? payload.service ?? '—'))}</dd>
      <dt>Estimate / price</dt><dd>${esc(String(payload.price ?? payload.expectedPrice ?? payload.total ?? '—'))}</dd>
      <dt>Branch</dt><dd>${esc(request.branch_id ? `${titleCase(String(request.branch_id).replace('branch_', ''))} · ${appointmentBranchZone(request.branch_id)}` : '—')}</dd>
      <dt>Crew</dt><dd>${esc(request.assigned_names || 'Unassigned')}</dd>
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
  </div>${association}${checkoutCard}${invoiceCard}${actions}${lifecycleActions}${archiveAction}${reopenAction}`;
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

interface PageState {
  limit: number;
  offset: number;
  sort: string;
}

const leadPage: PageState & { status: string; q: string } = { status: 'active', q: '', limit: 25, offset: 0, sort: 'created_at' };
const customerPage: PageState & { q: string; status: string } = { q: '', status: 'active', limit: 25, offset: 0, sort: 'created_at' };
const careerPage: PageState & { status: string; branch: string; q: string } = { status: '', branch: '', q: '', limit: 25, offset: 0, sort: 'created_at' };
const financePage: PageState & { status: string; q: string } = { status: '', q: '', limit: 25, offset: 0, sort: 'created_at' };

function renderPager(
  target: HTMLElement | null,
  meta: { total?: number; limit?: number; offset?: number },
  actionName: string,
): void {
  if (!target) return;
  const total = Math.max(0, Number(meta.total) || 0);
  const limit = Math.max(1, Number(meta.limit) || 25);
  const offset = Math.max(0, Number(meta.offset) || 0);
  const page = Math.floor(offset / limit) + 1;
  const pages = Math.max(1, Math.ceil(total / limit));
  target.innerHTML = `<p class="admin-muted">${total} matching record${total === 1 ? '' : 's'} - page ${page} of ${pages}</p><div class="admin-actions"><button class="btn btn--ghost btn--small" type="button" data-admin-action="${esc(actionName)}" data-offset="${Math.max(0, offset - limit)}"${offset <= 0 ? ' disabled' : ''}>Previous</button><button class="btn btn--ghost btn--small" type="button" data-admin-action="${esc(actionName)}" data-offset="${offset + limit}"${offset + limit >= total ? ' disabled' : ''}>Next</button></div>`;
}

const selectedLeadIds = new Set<string>();
let loadedLeads: Array<Record<string, unknown>> = [];

function updateLeadBulkToolbar(): void {
  const toolbar = document.querySelector<HTMLElement>('[data-admin-lead-bulk]');
  if (!toolbar) return;
  toolbar.hidden = selectedLeadIds.size === 0;
  const count = toolbar.querySelector<HTMLElement>('[data-admin-lead-bulk-count]');
  if (count) count.textContent = `${selectedLeadIds.size} selected`;
  for (const checkbox of document.querySelectorAll<HTMLInputElement>('[data-lead-select]')) {
    checkbox.checked = selectedLeadIds.has(checkbox.value);
  }
}

function renderLeadRows(): void {
  const target = document.querySelector<HTMLElement>('[data-admin-leads]');
  if (!target) return;
  if (loadedLeads.length === 0) {
    renderEmpty(target, 'No inquiries match this filter.');
    updateLeadBulkToolbar();
    return;
  }
  target.innerHTML = `<div class="admin-table-scroll"><table class="admin-table"><thead><tr><th><input type="checkbox" data-lead-select-all aria-label="Select all visible inquiries" /></th><th>Date</th><th>Type</th><th>Customer</th><th>Reference</th><th>Delivery</th><th>Status</th><th>Actions</th></tr></thead><tbody>${loadedLeads
    .map((lead) => {
      const id = String(lead.id);
      const customer = [lead.first_name, lead.last_name].filter(Boolean).join(' ') || 'Unlinked';
      return `<tr><td><input type="checkbox" data-lead-select value="${esc(id)}" aria-label="Select inquiry ${esc(lead.quote_reference || id)}" /></td><td>${esc(dateTime(lead.created_at))}</td><td>${esc(titleCase(String(lead.request_type ?? '').replaceAll('_', ' ')))}</td><td>${esc(customer)}</td><td>${esc(lead.quote_reference)}</td><td>${esc(lead.delivery_status)}${lead.last_delivery_error ? ` · ${esc(lead.last_delivery_error)}` : ''}</td><td><span class="admin-status">${esc(titleCase(lead.status))}</span></td><td><div class="admin-actions"><button class="btn btn--ghost btn--small" type="button" data-admin-action="lead-open" data-id="${esc(id)}">Open</button>${can('lead.write') ? (lead.status === 'archived' ? `<button class="btn btn--ghost btn--small" type="button" data-admin-action="lead-restore" data-id="${esc(id)}">Restore</button>` : `<button class="btn btn--ghost btn--small" type="button" data-admin-action="lead-archive" data-id="${esc(id)}">Archive</button>`) : ''}${actor?.role === 'owner' ? `<button class="btn btn--danger btn--small" type="button" data-admin-action="lead-delete" data-id="${esc(id)}">Delete</button>` : ''}</div></td></tr>`;
    })
    .join('')}</tbody></table></div>`;
  updateLeadBulkToolbar();
}

async function openLead(leadId: string): Promise<void> {
  const target = document.querySelector<HTMLElement>('[data-admin-lead-detail]');
  if (!target) return;
  const data = await api<{ lead?: Record<string, unknown>; audit?: Array<Record<string, unknown>> }>(
    `/api/admin/leads?id=${encodeURIComponent(leadId)}`,
  );
  const lead = data.lead ?? {};
  const payload = (lead.payload ?? {}) as Record<string, unknown>;
  const name = [lead.first_name, lead.last_name].filter(Boolean).join(' ') || lead.company_name || 'Unlinked inquiry';
  const property = [lead.line1, lead.city, lead.state, lead.postal_code].filter(Boolean).join(', ');
  target.hidden = false;
  target.innerHTML = `<div class="admin-card"><div class="admin-detail-head"><h2 class="admin-section-title">${esc(name)}</h2><div class="admin-actions"><button class="btn btn--ghost btn--small" type="button" data-admin-action="lead-close">Close</button></div></div>
    <dl class="admin-definition"><dt>Type</dt><dd>${esc(titleCase(String(lead.request_type ?? '').replaceAll('_', ' ')))}</dd><dt>Status</dt><dd>${esc(titleCase(lead.status))}</dd><dt>Reference</dt><dd>${esc(lead.quote_reference || '—')}</dd><dt>Delivery</dt><dd>${esc(lead.delivery_status)}${lead.last_delivery_error ? ` · ${esc(lead.last_delivery_error)}` : ''}</dd><dt>Created</dt><dd>${esc(dateTime(lead.created_at))}</dd><dt>Property</dt><dd>${esc(property || 'Not linked')}</dd><dt>Customer</dt><dd>${lead.customer_id ? `<button class="btn btn--ghost btn--small" type="button" data-admin-action="customer-open" data-id="${esc(lead.customer_id)}">Open linked customer</button>` : 'Unlinked inquiry'}</dd></dl>
    <h3>Request details</h3><dl class="admin-definition">${leadDetails(payload)}</dl>
    <h3>History</h3>${(data.audit ?? []).length ? `<ul class="admin-result-list">${(data.audit ?? []).map((entry) => `<li>${esc(dateTime(entry.created_at))} — ${esc(titleCase(String(entry.action ?? '').replaceAll('_', ' ')))}${entry.success ? '' : ' (failed)'}</li>`).join('')}</ul>` : '<p class="admin-muted">No recorded history.</p>'}
  </div>`;
  target.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function loadLeads(status = leadPage.status, query = leadPage.q): Promise<void> {
  if (status !== leadPage.status || query !== leadPage.q) {
    leadPage.status = status;
    leadPage.q = query;
    leadPage.offset = 0;
  }
  const params = new URLSearchParams({
    status: leadPage.status,
    q: leadPage.q,
    limit: String(leadPage.limit),
    offset: String(leadPage.offset),
    sort: leadPage.sort,
  });
  const data = await api<{ leads?: Array<Record<string, unknown>>; total?: number; limit?: number; offset?: number }>(`/api/admin/leads?${params.toString()}`);
  const target = document.querySelector<HTMLElement>('[data-admin-leads]');
  if (!target) return;
  loadedLeads = data.leads ?? [];
  renderPager(document.querySelector<HTMLElement>('[data-admin-leads-pagination]'), data, 'leads-page');
  renderLeadRows();
}

async function leadBulkAction(operation: 'archive' | 'restore' | 'delete'): Promise<void> {
  const ids = [...selectedLeadIds];
  if (ids.length === 0) return;
  const confirmed = await adminConfirm({
    title: `${titleCase(operation)} ${ids.length} selected inquir${ids.length === 1 ? 'y' : 'ies'}?`,
    body: `<p><strong>${ids.length} selected</strong></p><p>${operation === 'delete' ? 'Permanent deletion is limited to unlinked, non-reservation inquiries with no quote history. Linked customers, reservations and quoted history are protected and will be skipped.' : operation === 'restore' ? 'Archived inquiries return to the New queue.' : 'Archived inquiries leave the active queue. Historical delivery and request data are preserved.'}</p>`,
    confirmLabel: `${titleCase(operation)} ${ids.length}`,
    danger: operation === 'delete',
  });
  if (!confirmed) return;
  const result = await api<{ succeeded?: number; failed?: number; results?: Array<{ id: string; ok: boolean; error?: string }> }>(
    '/api/admin/leads',
    {
      method: 'POST',
      body: JSON.stringify({ action: 'bulk', operation, leadIds: ids, confirm: true }),
    },
  );
  const failures = (result.results ?? []).filter((entry) => !entry.ok);
  const target = document.querySelector<HTMLElement>('[data-admin-lead-bulk-result]');
  if (target) {
    target.innerHTML = `<ul class="admin-result-list"><li><strong>${result.succeeded ?? 0} completed</strong> · ${result.failed ?? 0} skipped</li>${failures.slice(0, 20).map((entry) => `<li class="is-failed">${esc(entry.error ?? 'failed')}</li>`).join('')}</ul>`;
  }
  selectedLeadIds.clear();
  if (failures.length) setAppError(`${result.succeeded ?? 0} updated, ${failures.length} skipped. See reasons above.`);
  else setSuccess(`${result.succeeded ?? 0} inquiry record(s) updated.`);
  await loadLeads();
}
async function loadCustomerOptions(): Promise<void> {
  const data = await api<{ customers?: Array<Record<string, unknown>> }>('/api/admin/customers?status=active&limit=200');
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

async function loadCustomers(query = customerPage.q): Promise<void> {
  if (query !== customerPage.q) {
    customerPage.q = query;
    customerPage.offset = 0;
  }
  const params = new URLSearchParams({
    q: customerPage.q,
    status: customerPage.status,
    limit: String(customerPage.limit),
    offset: String(customerPage.offset),
    sort: customerPage.sort,
  });
  const data = await api<{ customers?: Array<Record<string, unknown>>; total?: number; limit?: number; offset?: number }>(`/api/admin/customers?${params.toString()}`);
  const list = document.querySelector<HTMLElement>('[data-admin-customers]');
  const detail = document.querySelector<HTMLElement>('[data-admin-customer-detail]');
  if (!list) return;
  if (detail) { detail.hidden = true; detail.innerHTML = ''; }
  renderPager(document.querySelector<HTMLElement>('[data-admin-customers-pagination]'), data, 'customers-page');
  if ((data.customers ?? []).length === 0) {
    const label =
      customerPage.status === 'deleted'
        ? 'No deleted or anonymized customer records match this view.'
        : customerPage.status === 'archived'
          ? 'No archived customers match this view.'
          : customerPage.status === 'active'
            ? 'No active customers match this search.'
            : 'No customers match this search.';
    return renderEmpty(list, query ? 'No matching customers.' : label);
  }
  list.innerHTML = `<div class="admin-table-scroll"><table class="admin-table"><thead><tr><th>Name</th><th>Status</th><th>Email</th><th>Phone</th><th>Properties</th><th>Branch</th><th></th></tr></thead><tbody>${(data.customers ?? []).map((customer) => {
    const name = [customer.first_name, customer.last_name].filter(Boolean).join(' ') || customer.company_name || 'Customer';
    const anonymized = name === 'Deleted Customer';
    return `<tr><td>${esc(anonymized ? 'Anonymized customer record' : name)}</td><td><span class="admin-status">${esc(anonymized ? 'Deleted' : titleCase(String(customer.status ?? 'active')))}</span></td><td>${esc(anonymized ? 'Removed for privacy' : customer.email)}</td><td>${esc(anonymized ? 'Removed for privacy' : customer.phone)}</td><td>${esc(customer.property_count)}</td><td>${esc(customer.branch_name)}</td><td><button class="btn btn--ghost btn--small" type="button" data-admin-action="customer-open" data-id="${esc(customer.id)}">Open</button></td></tr>`;
  }).join('')}</tbody></table></div>`;
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
    <div class="admin-field--wide admin-address-block" data-admin-address-block>
      <div class="admin-address-grid">
        <label class="admin-field--wide">Street address
          <input name="line1" value="${esc(property.line1 ?? '')}" maxlength="200" autocomplete="off" data-admin-address-input required />
        </label>
        <label>Apartment / unit <input name="line2" value="${esc(property.line2 ?? '')}" maxlength="120" data-admin-address-unit /></label>
        <label>City <input name="city" value="${esc(property.city ?? '')}" maxlength="80" data-admin-address-city /></label>
        <label>State <input name="state" value="${esc(property.state ?? 'FL')}" maxlength="2" data-admin-address-state /></label>
        <label>ZIP <input name="postalCode" value="${esc(property.postal_code ?? '')}" inputmode="numeric" maxlength="10" data-admin-address-zip /></label>
        <input type="hidden" name="latitude" value="${property.latitude === null || property.latitude === undefined ? '' : esc(property.latitude)}" data-admin-address-lat />
        <input type="hidden" name="longitude" value="${property.longitude === null || property.longitude === undefined ? '' : esc(property.longitude)}" data-admin-address-lng />
        <input type="hidden" name="precision" value="${esc(property.precision ?? '')}" data-admin-address-precision />
      </div>
      <p class="admin-address-status" data-admin-address-status role="status" aria-live="polite"></p>
    </div>
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

const customerObligations = new Map<
  string,
  { appointments: number; plans: number; invoices: number; documents: number }
>();
let openCustomerId = '';

async function openCustomer(customerId: string): Promise<void> {  const data = await api<Record<string, unknown>>(`/api/admin/customers?id=${encodeURIComponent(customerId)}`);
  openCustomerId = customerId;
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
  const recurringPlans = (data.recurringPlans as Array<Record<string, unknown>>) ?? [];
  const quickEstimates = (data.quickEstimates as Array<Record<string, unknown>>) ?? [];
  const gifts = (data.gifts as Array<Record<string, unknown>>) ?? [];
  const reviewState = (data.reviewState as Record<string, unknown> | null) ?? null;
  const payments = (data.payments as Array<Record<string, unknown>>) ?? [];
  const communications = (data.communications as Array<Record<string, unknown>>) ?? [];
  const jobMedia = (data.jobMedia as Array<Record<string, unknown>>) ?? [];
  const timeline = (data.timeline as Array<Record<string, unknown>>) ?? [];
  const documentRequests = (data.signingRequests as Array<Record<string, unknown>> | undefined)?.length
    ? (data.signingRequests as Array<Record<string, unknown>>)
    : await api<{ requests?: Array<Record<string, unknown>> }>(
        `/api/admin/documents?view=requests&customerId=${encodeURIComponent(customerId)}`,
      ).then((result) => result.requests ?? []).catch(() => []);
  const benefitData = actor?.role === 'owner'
    ? await api<{ entitlements?: Array<Record<string, unknown>>; history?: Array<Record<string, unknown>> }>(
        `/api/admin/entitlements?customerId=${encodeURIComponent(customerId)}`,
      ).catch(() => ({ entitlements: [], history: [] }))
    : { entitlements: [], history: [] };
  const activeBenefit = (benefitData.entitlements ?? []).find((entry) => entry.status === 'active');
  const benefitsHtml = actor?.role === 'owner'
    ? `<div class="admin-card" style="margin-top:1rem"><div class="admin-detail-head"><h3>Discounts &amp; Benefits</h3>${activeBenefit ? `<span class="admin-status">${esc(activeBenefit.code)} active · ${esc(activeBenefit.percent)}%</span>` : '<span class="admin-muted">No persistent benefit</span>'}</div><p class="admin-muted">Persistent benefits survive rebooking and recurring-plan regeneration. They never stack with Community Care.</p>${activeBenefit ? `<div class="admin-actions"><button class="btn btn--ghost btn--small" type="button" data-admin-action="benefit-remove" data-id="${esc(customerId)}" data-benefit-id="${esc(activeBenefit.id)}">Remove ${esc(activeBenefit.code)}</button></div>` : `<button class="btn btn--secondary btn--small" type="button" data-admin-action="benefit-preview" data-id="${esc(customerId)}" data-code="FRIENDS15">Preview FRIENDS15</button>`}<div data-customer-benefit-preview></div><h4>Benefit history</h4>${(benefitData.history ?? []).length ? (benefitData.history ?? []).slice(0, 10).map((entry) => `<div class="admin-record">${esc(entry.code)} · ${esc(titleCase(entry.action))} · ${esc(dateTime(entry.created_at))}</div>`).join('') : '<p class="admin-muted">No benefit history.</p>'}</div>`
    : '';
  const email = contacts.find((contact) => contact.kind === 'email')?.value ?? customer.email ?? '';
  const phone = contacts.find((contact) => contact.kind === 'phone')?.value ?? customer.phone ?? '';
  const anonymized =
    String(customer.first_name ?? '').trim().toLowerCase() === 'deleted' &&
    String(customer.last_name ?? '').trim().toLowerCase() === 'customer';
  const obligationNow = Date.now();
  customerObligations.set(customerId, {
    appointments: appointments.filter((appointment) => {
      const status = String(appointment.status ?? '');
      const start = Date.parse(String(appointment.start_at ?? ''));
      return ['pending', 'confirmed', 'in_progress'].includes(status) && Number.isFinite(start) && start >= obligationNow - 86_400_000;
    }).length,
    plans: recurringPlans.filter((plan) => ['active', 'paused'].includes(String(plan.status ?? ''))).length,
    invoices: invoices.filter((invoice) => Number(invoice.balance_cents ?? 0) > 0 && !['paid', 'void'].includes(String(invoice.status ?? ''))).length,
    documents: documentRequests.filter((request) =>
      ['prepared', 'sent', 'viewed', 'partially_signed'].includes(String(request.status ?? '')),
    ).length,
  });
  const reviewStatusLabels: Record<string, string> = {
    never_invited: 'Never invited',
    queued: 'Invitation queued',
    sent: 'Invitation sent',
    failed: 'Delivery failed',
    unknown: 'Review status unknown',
    reviewed: 'Confirmed reviewed',
    do_not_ask: 'Do not ask again',
    opted_out: 'Customer opted out',
  };
  const reviewStatus = String(reviewState?.status ?? 'never_invited');
  const reviewLabel = reviewStatusLabels[reviewStatus] ?? 'Never invited';
  const reviewInvitations = Number(reviewState?.invitation_count ?? 0);
  const reviewCard = `<div class="admin-card" style="margin-top:1rem;">
    <div class="admin-detail-head"><div><h3 style="margin:0;">Review relationship</h3><p class="admin-muted" style="margin:.25rem 0 0;">Tracked per customer so repeat cleanings do not generate repetitive review requests.</p></div><span class="admin-status">${esc(reviewLabel)}</span></div>
    <dl class="admin-definition"><dt>Invitations sent</dt><dd>${esc(String(reviewInvitations))}</dd><dt>Last invited</dt><dd>${esc(reviewState?.last_invited_at ? dateTime(reviewState.last_invited_at) : '—')}</dd><dt>Marked reviewed</dt><dd>${esc(reviewState?.marked_reviewed_at ? dateTime(reviewState.marked_reviewed_at) : '—')}</dd></dl>
    <div class="admin-actions"><button class="btn btn--secondary btn--small" type="button" data-customer-quick="reviews">Manage review status</button></div>
  </div>`;
  const quickActions = anonymized
    ? ''
    : `<div class="admin-actions" style="flex-wrap:wrap;margin:.6rem 0 1rem;" data-customer-quick-actions>
        <button class="btn btn--secondary btn--small" type="button" data-customer-quick="booking">New Booking</button>
        <button class="btn btn--ghost btn--small" type="button" data-customer-quick="completed">Record Completed Cleaning</button>
        <button class="btn btn--ghost btn--small" type="button" data-customer-quick="estimate">New Estimate</button>
        <button class="btn btn--ghost btn--small" type="button" data-customer-quick="invoice">Create Invoice</button>
        <button class="btn btn--ghost btn--small" type="button" data-customer-quick="agreement">Send Agreement</button>
        ${email ? `<a class="btn btn--ghost btn--small" href="mailto:${esc(email)}">Email Customer</a>` : ''}
        ${phone ? `<a class="btn btn--ghost btn--small" href="tel:${esc(String(phone).replace(/[^0-9+]/g, ''))}">Call Customer</a>` : ''}
      </div>`;
  detail.hidden = false;
  detail.innerHTML = `<div class="admin-card">
    <div class="admin-detail-head"><h2 class="admin-section-title">${esc(anonymized ? 'Anonymized customer record' : [customer.first_name, customer.last_name].filter(Boolean).join(' ') || customer.company_name || 'Customer')}</h2><div class="admin-actions">${anonymized ? '' : `<button class="btn btn--ghost btn--small" type="button" data-admin-action="customer-edit">Edit Customer</button><form class="admin-inline-form" data-form="customer-archive"><input type="hidden" name="customerId" value="${esc(customerId)}" /><input type="hidden" name="targetStatus" value="${customer.status === 'archived' ? 'active' : 'archived'}" /><button class="btn btn--ghost btn--small" type="submit">${customer.status === 'archived' ? 'Restore Archived Customer' : 'Archive Customer'}</button></form>`}${actor?.role === 'owner' && !anonymized ? `<form class="admin-inline-form" data-form="customer-delete"><input type="hidden" name="customerId" value="${esc(customerId)}" /><button class="btn btn--danger btn--small" type="submit">Delete Customer</button></form>` : ''}<button class="btn btn--ghost btn--small" type="button" data-admin-action="customer-create">Close</button></div></div>
    ${quickActions}
    <dl class="admin-definition"><dt>Status</dt><dd>${esc(anonymized ? 'Deleted and anonymized' : customer.status)}</dd>${customer.archived_at ? `<dt>Archived / deleted</dt><dd>${esc(dateTime(customer.archived_at))}</dd>` : ''}<dt>Branch</dt><dd>${esc(customer.branch_name)}</dd><dt>Source</dt><dd>${esc(customer.source)}</dd><dt>Contacts</dt><dd>${anonymized ? 'Removed for privacy' : contacts.map((contact) => `${esc(titleCase(contact.kind))}: ${esc(contact.value)}`).join('<br />') || '—'}</dd></dl>
    <h3>Properties</h3>
    ${properties.map((property) => `<div class="admin-record"><strong>${esc(property.label)}${Number(property.is_primary) === 1 ? ' · Primary' : ''}</strong>${propertyProfileSummary(property)}<details class="admin-detail-toggle"><summary>Edit property</summary><form class="admin-form" style="max-width:none" data-form="property-update"><input type="hidden" name="customerId" value="${esc(customerId)}" /><input type="hidden" name="propertyId" value="${esc(property.id)}" />${propertyFields(property)}<label>Status <select name="status"><option value="active"${property.status !== 'archived' ? ' selected' : ''}>Active</option><option value="archived"${property.status === 'archived' ? ' selected' : ''}>Archived</option></select></label><button class="btn btn--secondary btn--small" type="submit">Save property</button></form></details></div>`).join('') || '<p class="admin-muted">No properties.</p>'}
    <details class="admin-detail-toggle"><summary>Add a property</summary><form class="admin-form" style="max-width:none" data-form="property-add"><input type="hidden" name="customerId" value="${esc(customerId)}" />${propertyFields({})}<button class="btn btn--secondary btn--small" type="submit">Add property</button></form></details>
    <h3>Jobs</h3>
    ${appointments.length ? appointments.map((appointment) => `<div class="admin-record"><p><strong>${esc(appointment.reference)}</strong> · ${esc(titleCase(String(appointment.status ?? '')))} · ${esc(dateTime(appointment.start_at))}</p><p class="admin-muted">${esc(jobMedia.filter((media) => String(media.appointment_id) === String(appointment.id)).length)} photo(s) linked</p><div class="admin-actions"><button class="btn btn--secondary btn--small" type="button" data-admin-action="job-open" data-id="${esc(appointment.id)}">Open Job File</button><button class="btn btn--ghost btn--small" type="button" data-admin-action="job-invoice-open" data-id="${esc(appointment.id)}">${invoices.some((invoice) => String(invoice.appointment_id) === String(appointment.id)) ? 'Open Invoice' : 'Create Invoice'}</button></div></div>`).join('') : '<p class="admin-muted">No jobs are recorded.</p>'}
    <h3>Payments</h3>
    ${payments.length ? payments.map((payment) => `<div class="admin-record"><p><strong>${esc(money(payment.amount_cents))}</strong> · ${esc(titleCase(String(payment.status ?? '')))} · ${esc(titleCase(String(payment.provider ?? '')))}${Number(payment.tip_cents ?? 0) > 0 ? ` · ${esc(money(payment.tip_cents))} gratuity` : ''}</p><p class="admin-muted">${esc(dateTime(payment.received_at || payment.created_at))}${payment.invoice_id ? ` · invoice ${esc(payment.invoice_id)}` : ''}</p>${payment.invoice_id ? `<div class="admin-actions"><button class="btn btn--ghost btn--small" type="button" data-admin-action="invoice-open" data-id="${esc(payment.invoice_id)}">Open Invoice</button></div>` : ''}</div>`).join('') : '<p class="admin-muted">No payments are recorded.</p>'}
    <h3>Communications</h3>
    ${communications.length ? communications.map((message) => `<div class="admin-record"><p><strong>${esc(titleCase(String(message.channel ?? '')))} ${esc(titleCase(String(message.direction ?? '')))}</strong> · ${esc(titleCase(String(message.status ?? '')))}</p><p class="admin-muted">${esc(message.subject || message.template || '')} · ${esc(dateTime(message.created_at))}</p></div>`).join('') : '<p class="admin-muted">No customer communications are recorded.</p>'}
    ${benefitsHtml}
    ${anonymized ? '' : reviewCard}
    <h3>Activity timeline</h3>
    ${timeline.length ? `<div class="admin-history">${timeline.map((event) => {
      const actions = [
        event.appointmentId ? `<button class="btn btn--ghost btn--small" type="button" data-admin-action="job-open" data-id="${esc(event.appointmentId)}">Job</button>` : '',
        event.invoiceId ? `<button class="btn btn--ghost btn--small" type="button" data-admin-action="invoice-open" data-id="${esc(event.invoiceId)}">Invoice</button>` : '',
        event.requestId ? `<button class="btn btn--ghost btn--small" type="button" data-admin-action="document-request-open" data-id="${esc(event.requestId)}">Agreement</button>` : '',
        event.leadId ? `<button class="btn btn--ghost btn--small" type="button" data-admin-action="lead-open" data-id="${esc(event.leadId)}">Inquiry</button>` : '',
      ].filter(Boolean).join('');
      return `<div class="admin-record"><p><strong>${esc(event.title)}</strong> <span class="admin-muted">· ${esc(dateTime(event.at))}</span></p><p class="admin-muted">${esc(event.detail)}</p>${actions ? `<div class="admin-actions">${actions}</div>` : ''}</div>`;
    }).join('')}</div>` : '<p class="admin-muted">No activity is recorded yet.</p>'}
    <h3>History</h3><div class="admin-history">${leads.length ? `<p><strong>Requests:</strong> ${leads.map((lead) => `${esc(lead.request_type)} (${esc(lead.status)})`).join(', ')}</p>` : ''}${estimates.length ? `<p><strong>Estimates:</strong> ${estimates.map((estimate) => `${esc(estimate.quote_reference)} (${money(estimate.total_cents)})`).join(', ')}</p>` : ''}${appointments.length ? `<p><strong>Appointments:</strong> ${appointments.map((appointment) => `${esc(appointment.reference)} (${esc(appointment.status)})`).join(', ')}</p>` : ''}${recurringPlans.length ? `<p><strong>Recurring plans:</strong> ${recurringPlans.map((plan) => `${esc(titleCase(plan.frequency))} (${esc(plan.status)})`).join(', ')}</p>` : ''}${invoices.length ? `<p><strong>Invoices:</strong> ${invoices.map((invoice) => `${esc(invoice.number)} (${money(invoice.balance_cents)} balance)`).join(', ')}</p>` : ''}</div>
    <h3>Quick Estimates</h3>${quickEstimates.length ? quickEstimates.map((estimate) => `<div class="admin-record"><p><strong>${esc(titleCase(estimate.engine))}</strong> · ${money(estimate.total_cents)} · ${esc(titleCase(estimate.status))}</p><p class="admin-muted">${esc(estimate.address_text || 'Address not recorded')} · ${esc(dateTime(estimate.created_at))}${estimate.converted_request_id ? ` · Converted to ${esc(estimate.converted_request_id)}` : ''}</p></div>`).join('') : '<p class="admin-muted">No Quick Estimates recorded.</p>'}
    <h3>Gift certificates</h3>${gifts.length ? gifts.map((gift) => `<div class="admin-record"><p><strong>${esc(gift.code)}</strong> · ${esc(titleCase(gift.status))} · ${money(gift.balance_cents)} remaining</p><p class="admin-muted">${esc(titleCase(gift.role))} · ${money(gift.value_cents)} original value · ${esc(dateTime(gift.created_at))}</p></div>`).join('') : '<p class="admin-muted">No gift certificates for this customer.</p>'}
    <h3>Documents &amp; agreements</h3>${documentRequests.length ? documentRequests.map((request) => `<div class="admin-record"><p><strong>${esc(request.packet_name || request.bundle_code || 'Agreement')}</strong> — ${esc(titleCase(request.status))}</p><p class="admin-muted">Signed ${esc(request.signed_count)} · Awaiting verification ${esc(request.awaiting_verification)} · ${esc(dateTime(request.created_at))}</p></div>`).join('') : '<p class="admin-muted">No signing requests recorded.</p>'}
    <h3>Notes</h3>${notes.map((note) => `<div class="admin-record"><p>${esc(note.body)}</p><p class="admin-muted">${esc(dateTime(note.created_at))}</p></div>`).join('') || '<p class="admin-muted">No notes.</p>'}
    <form class="admin-form" data-form="note-add" style="max-width:none;"><input type="hidden" name="customerId" value="${esc(customerId)}" /><label>Add note <textarea name="body" rows="3" required></textarea></label><button class="btn btn--secondary btn--small" type="submit">Add note</button></form>
    <details class="admin-detail-toggle" data-customer-edit><summary>Edit customer</summary>${customerForm({ ...customer, email, phone })}</details>
    ${actor?.role === 'owner' && !anonymized ? `<details class="admin-detail-toggle"><summary>Privacy erasure (irreversible)</summary><p class="admin-muted">Use only for a verified legal or privacy erasure request. Ordinary removal from active operations is the Delete action, which archives the customer and preserves their history.</p><form class="admin-form" data-form="customer-erase" style="max-width:none"><input type="hidden" name="customerId" value="${esc(customerId)}" /><p class="admin-error">This permanently deletes identifiers or anonymizes retained financial and signed history. It cannot be undone.</p><button class="btn btn--danger btn--small" type="submit">Permanently erase identifiers</button></form></details>` : ''}
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

async function ensureCustomerSelectOption(
  select: HTMLSelectElement,
  customerId: string,
): Promise<void> {
  if ([...select.options].some((option) => option.value === customerId)) return;
  const data = await api<Record<string, unknown>>(`/api/admin/customers?id=${encodeURIComponent(customerId)}`);
  const customer = (data.customer ?? {}) as Record<string, unknown>;
  const name =
    [customer.first_name, customer.last_name].filter(Boolean).join(' ') ||
    String(customer.company_name ?? '') ||
    'Selected customer';
  select.insertAdjacentHTML('beforeend', `<option value="${esc(customerId)}">${esc(name)}</option>`);
}

async function runCustomerQuickAction(customerId: string, action: string): Promise<void> {
  if (!customerId) return;
  if (action === 'booking' || action === 'completed') {
    await loadView('new-booking');
    const select = manualField<HTMLSelectElement>('customerId');
    if (!select) return;
    await ensureCustomerSelectOption(select, customerId);
    select.value = customerId;
    select.dispatchEvent(new Event('change', { bubbles: true }));
    if (action === 'completed') {
      const type = manualField<HTMLSelectElement>('appointmentType');
      if (type) {
        type.value = 'completed';
        type.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }
    manualForm()?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    return;
  }
  if (action === 'estimate') {
    await loadView('quick-estimate');
    const select = quickField<HTMLSelectElement>('customerId');
    if (!select) return;
    await ensureCustomerSelectOption(select, customerId);
    select.value = customerId;
    select.dispatchEvent(new Event('change', { bubbles: true }));
    quickForm()?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    return;
  }
  if (action === 'invoice') {
    await loadView('finance');
    const select = document.querySelector<HTMLSelectElement>(
      '[data-admin-invoice-create] select[name="customerId"]',
    );
    if (!select) return;
    await ensureCustomerSelectOption(select, customerId);
    select.value = customerId;
    document.querySelector<HTMLElement>('[data-admin-invoice-create]')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    return;
  }
  if (action === 'agreement') {
    await loadView('documents');
    showDocumentTab('send');
    const detail = await api<Record<string, unknown>>(`/api/admin/customers?id=${encodeURIComponent(customerId)}`);
    applyCustomerToComposer(detail);
    document.querySelector<HTMLElement>('[data-document-send]')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    return;
  }
  if (action === 'reviews') {
    await loadView('reviews');
    const data = await api<Record<string, unknown>>(`/api/admin/customers?id=${encodeURIComponent(customerId)}`);
    const customer = (data.customer ?? {}) as Record<string, unknown>;
    const name = [customer.first_name, customer.last_name].filter(Boolean).join(' ');
    const search = document.querySelector<HTMLInputElement>('[data-review-search]');
    if (search && name) {
      search.value = name;
      await loadReviewEligible();
    }
    document.querySelector<HTMLElement>('[data-review-eligible-list]')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

document.addEventListener('click', (event) => {
  const button = (event.target as HTMLElement).closest<HTMLElement>('[data-customer-quick]');
  if (!button) return;
  event.preventDefault();
  void runCustomerQuickAction(openCustomerId, button.dataset.customerQuick ?? '').catch((error) =>
    setAppError(friendly(error)),
  );
});

async function previewCustomerBenefit(customerId: string, code: string): Promise<void> {
  const target = document.querySelector<HTMLElement>('[data-customer-benefit-preview]');
  if (!target) return;
  target.innerHTML = '<p class="admin-muted">Loading benefit preview…</p>';
  try {
    const result = await api<{ preview: Record<string, unknown> }>(
      `/api/admin/entitlements?view=preview&customerId=${encodeURIComponent(customerId)}&code=${encodeURIComponent(code)}`,
    );
    const preview = result.preview;
    const plans = (preview.recurringPlans as Array<Record<string, unknown>>) ?? [];
    const appointments = (preview.appointments as Array<Record<string, unknown>>) ?? [];
    const invoices = (preview.invoices as Array<Record<string, unknown>>) ?? [];
    const warnings = (preview.warnings as string[]) ?? [];
    target.innerHTML = `<div class="admin-card" style="margin-top:1rem;background:var(--color-surface-alt);">
      <h4>${esc(preview.code)} preview — ${esc(preview.percent)}%</h4>
      ${warnings.map((warning) => `<p class="admin-error">${esc(warning)}</p>`).join('')}
      <h4>Recurring plans</h4>${plans.length ? plans.map((plan) => `<div class="admin-record">${esc(plan.frequency)} · ${esc(money(plan.currentPriceCents))} → ${esc(money(plan.discountedPriceCents))} per visit · ${esc(plan.futureAppointments)} future appointment(s)${plan.willApply ? '' : ' · already applied'}</div>`).join('') : '<p class="admin-muted">No active recurring plan.</p>'}
      <h4>Upcoming unpaid appointments</h4>${appointments.length ? appointments.map((appointment) => `<div class="admin-record">${esc(appointment.reference)} · ${esc(dateTime(appointment.startAt))} · ${esc(appointment.status)}</div>`).join('') : '<p class="admin-muted">No upcoming pending/confirmed appointments.</p>'}
      <h4>Issued invoices</h4>${invoices.length ? invoices.map((invoice) => `<div class="admin-record">${esc(invoice.number)} · ${esc(money(invoice.balanceCents))} balance · ${esc(invoice.action === 'apply' ? 'safe automatic discount' : invoice.action === 'excluded' ? 'historical / excluded' : 'manual adjustment required')}<p class="admin-muted">${esc(invoice.reason)}</p></div>`).join('') : '<p class="admin-muted">No appointment-linked invoices.</p>'}
      <p class="admin-muted">This preview does not modify records. Applying updates active plan prices and only safe open/unpaid invoices; other invoices require manual adjustment.</p>
      <button class="btn btn--primary btn--small" type="button" data-admin-action="benefit-apply" data-id="${esc(customerId)}" data-code="${esc(preview.code)}">Apply ${esc(preview.code)}</button>
    </div>`;
  } catch (error) {
    target.innerHTML = `<p class="admin-error">${esc(friendly(error))}</p>`;
  }
}

async function applyCustomerBenefit(customerId: string, code: string): Promise<void> {
  setAppError();
  setSuccess();
  try {
    const result = await api<{ appliedPlans: number; appliedInvoices: number }>('/api/admin/entitlements', {
      method: 'POST',
      body: JSON.stringify({ action: 'apply', customerId, code, previewToken: 'confirmed' }),
    });
    await openCustomer(customerId);
    setSuccess(`Benefit applied. ${result.appliedPlans} recurring plan(s) and ${result.appliedInvoices} invoice(s) updated.`);
  } catch (error) {
    setAppError(friendly(error));
  }
}

async function removeCustomerBenefit(customerId: string, entitlementId: string): Promise<void> {
  if (!window.confirm('Remove this persistent benefit? Active recurring plans will return to their normal price. Issued invoices are not rewritten.')) return;
  setAppError();
  setSuccess();
  try {
    const result = await api<{ removed: boolean; restoredPlans: number }>('/api/admin/entitlements', {
      method: 'POST',
      body: JSON.stringify({ action: 'remove', customerId, entitlementId }),
    });
    await openCustomer(customerId);
    setSuccess(`Benefit removed. ${result.restoredPlans} recurring plan(s) restored to normal pricing.`);
  } catch (error) {
    setAppError(friendly(error));
  }
}

let recurringSchedulingAvailable = true;
let recurringStatusFilter = 'active';

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
  const data = await api<{ recurring?: Array<Record<string, unknown>>; recurringEnabled?: boolean; workerRuns?: Array<Record<string, unknown>> }>(
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
    const plans = (data.recurring ?? []).filter((plan) => {
      const status = String(plan.status ?? '');
      if (recurringStatusFilter === 'all') return true;
      if (recurringStatusFilter === 'active-only') return status === 'active';
      if (recurringStatusFilter === 'paused') return status === 'paused';
      if (recurringStatusFilter === 'cancelled') return status === 'cancelled';
      return status === 'active' || status === 'paused';
    });
    renderTable(target, ['Customer', 'Property', 'Service', 'Frequency', 'Window / start', 'Duration', 'Price', 'Next visit', 'Assigned', 'Sync', 'Status', 'Action'], plans.map((plan) => [
      esc([plan.first_name, plan.last_name].filter(Boolean).join(' ') || 'Customer'),
      esc([plan.line1, plan.city].filter(Boolean).join(', ') || 'Property not linked'),
      esc(titleCase(String(plan.service_code ?? 'Residential cleaning').replaceAll('_', ' ').replaceAll('-', ' '))),
      esc(titleCase(plan.frequency)),
      writable
        ? `<div class="admin-inline-form"><select class="admin-select" data-recurring-window="${esc(plan.id)}" aria-label="Preferred window"><option value="">Not scheduled</option><option value="morning"${plan.window === 'morning' ? ' selected' : ''}>Morning</option><option value="afternoon"${plan.window === 'afternoon' ? ' selected' : ''}>Afternoon</option></select><input class="input" type="time" step="900" min="07:00" max="14:30" value="${esc(plan.start_time ?? '')}" data-recurring-start="${esc(plan.id)}" aria-label="Preferred start time" /></div>`
        : esc(plan.window ? `${titleCase(String(plan.window))}${plan.start_time ? ` · ${String(plan.start_time)}` : ''}` : 'Not scheduled'),
      writable
        ? `<span class="admin-duration"><input class="input" type="number" min="30" max="600" step="15" value="${esc(plan.duration_minutes ?? '')}" data-recurring-duration="${esc(plan.id)}" aria-label="Duration in minutes" /><span class="admin-duration__unit" aria-hidden="true">min</span></span>`
        : esc(plan.duration_minutes ? durationLabel(plan.duration_minutes) : 'Not set'),
      esc(money(plan.ongoing_price_cents)),
      esc(plan.next_visit_date ? dateTime(plan.next_visit_date) : 'Not scheduled'),
      esc(String(plan.assigned_names || 'Unassigned')),
      `<span class="admin-status">${esc(
        String(plan.sync_status) === 'failed'
          ? 'Needs retry'
          : String(plan.sync_status) === 'pending'
            ? 'Pending sync'
            : String(plan.sync_status) === 'synced'
              ? 'Synced'
              : titleCase(String(plan.sync_status ?? 'Pending')),
      )}</span>${plan.sync_error ? `<p class="admin-muted">${esc(recurringSyncDetail(plan.sync_error))}</p>` : ''}`,
      writable
        ? `<select class="admin-select" data-recurring-status="${esc(plan.id)}" aria-label="Plan status">${['active', 'paused', 'cancelled', 'completed'].map((status) => `<option value="${status}"${status === plan.status ? ' selected' : ''}>${esc(titleCase(status))}</option>`).join('')}</select>`
        : `<span class="admin-status">${esc(titleCase(plan.status))}</span>`,
      `<div class="admin-actions">${writable ? `<button class="btn btn--ghost btn--small" type="button" data-admin-action="recurring-save" data-id="${esc(plan.id)}">Save</button>` : ''}<button class="btn btn--ghost btn--small" type="button" data-admin-action="recurring-occurrences" data-id="${esc(plan.id)}">View schedule</button>${writable ? `<button class="btn btn--ghost btn--small" type="button" data-admin-action="recurring-sync" data-id="${esc(plan.id)}">Retry sync</button>` : ''}<button class="btn btn--ghost btn--small" type="button" data-admin-action="customer-open" data-id="${esc(plan.customer_id)}">Customer</button></div>`,
    ]), recurringStatusFilter === 'cancelled' ? 'No canceled plans match this view.' : 'No recurring plans match this view.');
  }
  const runsTarget = document.querySelector<HTMLElement>('[data-admin-recurring-runs]');
  if (runsTarget) {
    const runs = data.workerRuns ?? [];
    renderTable(runsTarget, ['Date', 'Status', 'Plans', 'Synced', 'Errors', 'Cause'], runs.map((run) => {
      let details: Array<Record<string, unknown>> = [];
      try { details = JSON.parse(String(run.detail_json ?? '[]')) as Array<Record<string, unknown>>; } catch { details = []; }
      const reasons = new Map<string, string>();
      for (const detail of details) {
        for (const conflict of (detail.conflictDetails as Array<Record<string, unknown>>) ?? []) {
          const reason = String(conflict.reason ?? 'unknown');
          reasons.set(reason, recurringReasonLabel(reason));
        }
        for (const error of (detail.errors as string[]) ?? []) {
          const reason = error.split(':').pop() ?? error;
          reasons.set(reason, recurringReasonLabel(reason));
        }
      }
      const cause = reasons.size ? [...reasons.values()].join('; ') : (String(run.status) === 'completed' ? 'No failure' : 'Unclassified');
      return [esc(run.run_key), esc(titleCase(run.status)), esc(run.plans_scanned ?? 0), esc(run.plans_synced ?? 0), esc(run.errors ?? 0), esc(cause)];
    }), 'No recurring worker runs recorded.');
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
let manualContextRequestSeq = 0;
let manualQuote: ManualQuoteView | null = null;
let manualAvailabilityResult: ManualAvailabilityView | null = null;
let manualCreated: ManualCreatedView | null = null;
let manualSaving = false;

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
    addonList.innerHTML = extrasMarkup(
      pricing.addons.items as unknown as Array<Record<string, unknown>>,
      'data-manual-addon',
    );
    addonList.addEventListener('change', () => updateExtrasSummary('manual'));
    updateExtrasSummary('manual');
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
  syncManualAppointmentMode();
}

function manualAppointmentType(): 'scheduled' | 'completed' {
  return manualField<HTMLSelectElement>('appointmentType')?.value === 'completed' ? 'completed' : 'scheduled';
}

function syncManualPricingFields(): void {
  const method = manualField<HTMLSelectElement>('pricingMethod')?.value === 'custom' ? 'custom' : 'estimated';
  const discountType = manualField<HTMLSelectElement>('discountType')?.value ?? 'none';
  const customWrap = document.querySelector<HTMLElement>('[data-manual-custom-price-wrap]');
  const discountWrap = document.querySelector<HTMLElement>('[data-manual-discount-value-wrap]');
  const reasonWrap = document.querySelector<HTMLElement>('[data-manual-discount-reason-wrap]');
  if (customWrap) customWrap.hidden = method !== 'custom';
  if (discountWrap) discountWrap.hidden = discountType === 'none';
  if (reasonWrap) reasonWrap.hidden = discountType === 'none';
  updateManualPricingSummary();
}

function manualPricingSummary(): { baseCents: number; discountCents: number; totalCents: number } | null {
  const method = manualField<HTMLSelectElement>('pricingMethod')?.value === 'custom' ? 'custom' : 'estimated';
  if (method === 'estimated') {
    if (!manualQuote || manualQuote.status !== 'priced' || manualQuote.totalCents === null) return null;
    const discountCents = manualQuote.discountAmountCents ?? 0;
    return {
      baseCents: manualQuote.totalCents + discountCents,
      discountCents,
      totalCents: manualQuote.totalCents,
    };
  }
  let baseCents = Math.round(Number(manualField<HTMLInputElement>('customPrice')?.value ?? 0) * 100);
  if (!Number.isFinite(baseCents) || baseCents <= 0) baseCents = 0;
  const discountType = manualField<HTMLSelectElement>('discountType')?.value ?? 'none';
  const discountValue = Number(manualField<HTMLInputElement>('discountValue')?.value ?? 0);
  let discountCents = 0;
  if (discountType === 'percent' && Number.isFinite(discountValue)) {
    discountCents = Math.round((baseCents * Math.min(100, Math.max(0, discountValue))) / 100);
  } else if (discountType === 'fixed' && Number.isFinite(discountValue)) {
    discountCents = Math.round(Math.max(0, discountValue) * 100);
  }
  discountCents = Math.min(discountCents, baseCents);
  return { baseCents, discountCents, totalCents: baseCents - discountCents };
}

function updateManualPricingSummary(): void {
  const target = document.querySelector<HTMLElement>('[data-manual-pricing-summary]');
  if (!target) return;
  const summary = manualPricingSummary();
  if (!summary || summary.baseCents <= 0) {
    target.textContent = 'Generate a priced estimate or enter a custom agreed price to see the final amount.';
    return;
  }
  const discountText = summary.discountCents > 0 ? ` · Discount −${money(summary.discountCents)}` : '';
  target.textContent = `Pricing method: ${manualField<HTMLSelectElement>('pricingMethod')?.value === 'custom' ? 'custom agreed price' : 'calculated estimator price'} · Base ${money(summary.baseCents)}${discountText} · Final service amount ${money(summary.totalCents)} before separately applicable tax.`;
}

async function loadManualCompletedCrew(): Promise<void> {
  const target = document.querySelector<HTMLElement>('[data-manual-staff]');
  if (!target || manualAppointmentType() !== 'completed') return;
  target.innerHTML = '<p class="admin-muted">Loading team members…</p>';
  try {
    const data = await api<{ team?: Array<Record<string, unknown>> }>('/api/admin/operations?view=team');
    const members = (data.team ?? []).filter((member) => String(member.status ?? '') === 'active');
    target.innerHTML = members.length
      ? `<p class="admin-muted">Actual cleaners who performed the completed service (required)</p><div class="admin-form admin-form--grid">${members
          .map(
            (member) =>
              `<label><input type="checkbox" data-manual-completed-crew value="${esc(String(member.id))}" /> ${esc(String(member.display_name ?? member.name ?? member.id))}</label>`,
          )
          .join('')}</div>`
      : '<p class="admin-error">No active team members are available. Add the actual cleaners before recording a completed service.</p>';
  } catch (error) {
    target.innerHTML = `<p class="admin-error">${esc(friendly(error))}</p>`;
  }
}

async function loadManualAgreements(customerId: string): Promise<void> {
  const select = manualField<HTMLSelectElement>('signingRequestId');
  if (!select) return;
  select.innerHTML = '<option value="">No agreement link</option>';
  if (!customerId) return;
  try {
    const data = await api<{ requests?: Array<Record<string, unknown>> }>(
      `/api/admin/documents?view=requests&customerId=${encodeURIComponent(customerId)}`,
    );
    if ((manualField<HTMLSelectElement>('customerId')?.value ?? '') !== customerId) return;
    const signed = (data.requests ?? []).filter(
      (request) => String(request.status) === 'signed' || Boolean(request.executed_at),
    );
    for (const request of signed) {
      select.insertAdjacentHTML(
        'beforeend',
        `<option value="${esc(String(request.id))}">${esc(String(request.packet_name ?? request.bundle_code ?? 'Signed agreement'))} — ${esc(dateTime(request.executed_at || request.updated_at))}</option>`,
      );
    }
  } catch {
    // Agreement linking is optional; the completed job can still be saved.
  }
}

function syncManualAppointmentMode(): void {
  const completed = manualAppointmentType() === 'completed';
  const scheduleDateWrap = document.querySelector<HTMLElement>('[data-manual-schedule-date-wrap]');
  const completedDateWrap = document.querySelector<HTMLElement>('[data-manual-completed-date-wrap]');
  const completedAgreementWrap = document.querySelector<HTMLElement>('[data-manual-completed-agreement-wrap]');
  const scheduledPricing = document.querySelector<HTMLElement>('[data-manual-scheduled-pricing]');
  const quoteBox = document.querySelector<HTMLElement>('[data-manual-quote-result]');
  const slotWrap = document.querySelector<HTMLElement>('[data-manual-slot-wrap]');
  const scheduledActions = document.querySelector<HTMLElement>('[data-manual-scheduled-actions]');
  const completedActions = document.querySelector<HTMLElement>('[data-manual-completed-actions]');
  const crewSizeWrap = document.querySelector<HTMLElement>('[data-manual-crew-size-wrap]');
  if (scheduleDateWrap) scheduleDateWrap.hidden = completed;
  if (completedDateWrap) completedDateWrap.hidden = !completed;
  if (completedAgreementWrap) completedAgreementWrap.hidden = !completed;
  if (scheduledPricing) scheduledPricing.hidden = completed;
  if (quoteBox) quoteBox.hidden = completed;
  if (slotWrap) slotWrap.hidden = completed;
  if (scheduledActions) scheduledActions.hidden = completed;
  if (completedActions) completedActions.hidden = !completed;
  if (crewSizeWrap) crewSizeWrap.hidden = completed;
  const dateField = manualField<HTMLInputElement>('date');
  if (dateField) dateField.required = !completed;
  const completedDate = manualField<HTMLInputElement>('completedDate');
  if (completedDate) {
    completedDate.required = completed;
    if (completed && !completedDate.value) completedDate.value = localToday(0);
  }
  if (completed) {
    const method = manualField<HTMLSelectElement>('pricingMethod');
    if (method && method.value !== 'custom') method.value = 'custom';
    const price = manualField<HTMLInputElement>('customPrice');
    if (price && !price.value) price.required = true;
    void loadManualCompletedCrew();
  }
  syncManualPricingFields();
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

async function createManualCustomer(): Promise<void> {
  setAppError();
  const form = manualForm();
  const resultNode = document.querySelector<HTMLElement>('[data-manual-customer-result]');
  if (!form || !resultNode) return;
  const data = new FormData(form);
  const field = (name: string): string => String(data.get(name) ?? '').trim();
  const firstName = field('newFirstName');
  const lastName = field('newLastName');
  const email = field('newEmail');
  const addressLine1 = field('newAddressLine1');
  if (!firstName && !lastName) {
    setAppError('Enter the new customer’s name.');
    return;
  }
  if (!email) {
    setAppError('An email address is required to send agreements and invoices.');
    return;
  }
  if (!addressLine1) {
    setAppError('Enter the service address for the new customer.');
    return;
  }
  resultNode.textContent = 'Creating customer…';
  try {
    const created = await api<{ id?: string }>('/api/admin/customers', {
      method: 'POST',
      body: JSON.stringify({
        action: 'create',
        firstName,
        lastName,
        email,
        phone: field('newPhone'),
        addressLine1,
        city: field('newCity'),
        state: field('newState') || 'FL',
        postalCode: field('newPostalCode'),
        source: 'admin_booking',
      }),
    });
    const customerId = String(created.id ?? '');
    if (!customerId) throw new Error('customer_create_failed');
    const select = manualField<HTMLSelectElement>('customerId');
    if (select) {
      select.insertAdjacentHTML(
        'beforeend',
        `<option value="${esc(customerId)}">${esc([firstName, lastName].filter(Boolean).join(' ') || email)} — ${esc(email)}</option>`,
      );
      select.value = customerId;
    }
    await loadManualContext(customerId);
    resultNode.textContent = 'Customer created and selected. Continue the booking below.';
    setSuccess('Customer created without losing the estimate details.');
  } catch (error) {
    resultNode.textContent = '';
    setAppError(friendly(error));
  }
}

async function loadManualContext(customerId: string): Promise<void> {
  const requestSeq = ++manualContextRequestSeq;
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
  if (requestSeq !== manualContextRequestSeq || (manualField<HTMLSelectElement>('customerId')?.value ?? '') !== customerId) {
    return;
  }
  manualContext = {
    customer: (data.customer ?? {}) as Record<string, unknown>,
    properties: (data.properties as Array<Record<string, unknown>>) ?? [],
  };
  const branchId = String(manualContext.customer.primary_branch_id ?? '');
  const branchNode = document.querySelector<HTMLElement>('[data-manual-branch]');
  if (branchNode) {
    branchNode.textContent = branchId
      ? `Branch: ${titleCase(branchId.replace('branch_', ''))} · ${appointmentBranchZone(branchId)} (${appointmentZoneLabel(branchId)}). Appointment times use this branch's local timezone.`
      : 'Branch and timezone are determined from the customer and service address.';
  }
  populateManualProperties();
  const only = manualContext.properties[0];
  if (only) {
    const select = manualField<HTMLSelectElement>('propertyId');
    if (select) select.value = String(only.id);
    applyManualProperty();
  }
  void loadManualAgreements(customerId);
  syncManualAppointmentMode();
}

function manualPayload(): Record<string, unknown> {
  const engine = (manualField<HTMLSelectElement>('engine')?.value ?? 'residential') as string;
  const facility = engine === 'commercial' || engine === 'church';
  const payload: Record<string, unknown> = {
    engine,
    customerId: manualField<HTMLSelectElement>('customerId')?.value ?? '',
    propertyId: manualField<HTMLSelectElement>('propertyId')?.value ?? '',
    serviceType: engine === 'str' ? 'str_turnover' : manualField<HTMLSelectElement>('serviceType')?.value ?? 'standard',
    serviceLabel: manualField<HTMLSelectElement>('serviceType')?.selectedOptions[0]?.textContent?.trim() || undefined,
    promotionCode: manualField<HTMLSelectElement>('promotionCode')?.value || undefined,
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
    appointmentType: manualAppointmentType(),
    pricingMethod: manualField<HTMLSelectElement>('pricingMethod')?.value || 'estimated',
    customPrice: manualNumber('customPrice'),
    discountType: manualField<HTMLSelectElement>('discountType')?.value || 'none',
    discountValue: manualNumber('discountValue'),
    discountReason: manualField<HTMLInputElement>('discountReason')?.value ?? '',
    completedDate: manualField<HTMLInputElement>('completedDate')?.value ?? '',
    signingRequestId: manualField<HTMLSelectElement>('signingRequestId')?.value || undefined,
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
    <h3>Pricing estimate</h3>
    <p><strong>${esc(money(quote.totalCents))}</strong>${
      quote.range ? ` · typical range ${esc(money(Math.round(quote.range.low * 100)))}–${esc(money(Math.round(quote.range.high * 100)))}` : ''
    }</p>
    <p class="admin-muted">${esc(formatLaborAndSite(quote.laborHours, quote.durationMinutes))} · ${esc(travelNote)}</p>
    ${rows.length ? `<div class="admin-table-scroll"><table class="admin-table"><tbody>${rows.join('')}</tbody></table></div>` : ''}
    ${quote.ongoingPerVisitCents !== null ? `<p class="admin-muted">Ongoing (${esc(quote.ongoingFrequency)}): ${esc(money(quote.ongoingPerVisitCents))} per visit after the first deep clean.</p>` : ''}
    ${quote.tier ? `<p class="admin-muted">Facility tier ${esc(quote.tier)}</p>` : ''}
    ${docs}
    <details class="admin-detail-toggle"><summary>Pricing diagnostics</summary><p class="admin-muted">Pricing version ${esc(quote.pricingVersion)}</p></details>
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

type ManualBookingMode = 'save' | 'confirm' | 'documents' | 'documents-invoice';

async function saveManualBooking(mode: ManualBookingMode): Promise<void> {
  setAppError();
  if (manualSaving) return;
  if (!manualQuote || manualQuote.status !== 'priced') {
    setAppError('Generate a priced estimate before saving the booking.');
    return;
  }
  const slotSelect = manualField<HTMLSelectElement>('slot');
  const start = slotSelect?.value ?? '';
  const selected = slotSelect?.selectedOptions[0];
  const end = selected?.getAttribute('data-slot-end') ?? '';
  const date = manualField<HTMLInputElement>('date')?.value ?? '';
  if (!start || !end || !date) {
    setAppError('Choose an available appointment time first.');
    return;
  }
  const customer = manualContext?.customer ?? {};
  const customerName = [customer.first_name, customer.last_name].filter(Boolean).join(' ') || 'Customer';
  const email = String(customer.email ?? '');
  const propertyId = manualField<HTMLSelectElement>('propertyId')?.value ?? '';
  const property = manualContext?.properties.find((entry) => entry.id === propertyId);
  const propertyLabel = property
    ? [property.label, property.line1, property.city].filter(Boolean).join(' — ')
    : 'Selected property';
  const branchId = String(customer.primary_branch_id ?? '');
  const timeLabel = selected?.textContent?.split('—')[0]?.trim() ?? '';
  const serviceLabel = manualField<HTMLSelectElement>('serviceType')?.selectedOptions[0]?.textContent ?? 'Cleaning';
  const documents = manualQuote.documentsRequired.map((item) => item.title).filter(Boolean);
  if (mode !== 'save' && mode !== 'confirm') {
    const intent =
      mode === 'documents'
        ? `<p>A secure signing invitation will be prepared and emailed to <strong>${esc(email || 'no email on file')}</strong>.</p>
           <p>Required documents: ${documents.length ? esc(documents.join(', ')) : 'none active for this booking'}.</p>`
        : `<p>A secure signing invitation will be prepared and emailed to <strong>${esc(email || 'no email on file')}</strong>, and a pre-service invoice <strong>draft</strong> will be created.</p>
           <p>Required documents: ${documents.length ? esc(documents.join(', ')) : 'none active for this booking'}.</p>
           <p>The invoice will not be emailed and no card will be charged. Sending the invoice is a separate explicit action in Finance.</p>`;
    const confirmed = await adminConfirm({
      title: mode === 'documents' ? 'Book and send agreements?' : 'Book, send agreements and prepare an invoice?',
      body: `<dl class="admin-definition">
          <dt>Customer</dt><dd>${esc(customerName)}</dd>
          <dt>Recipient</dt><dd>${esc(email || 'No email on file')}</dd>
          <dt>Property</dt><dd>${esc(propertyLabel)}</dd>
          <dt>Branch</dt><dd>${esc(branchId ? `${titleCase(branchId.replace('branch_', ''))} · ${appointmentBranchZone(branchId)}` : 'Not recorded')}</dd>
          <dt>Service</dt><dd>${esc(serviceLabel)}</dd>
          <dt>Appointment</dt><dd>${esc(timeLabel)}</dd>
          <dt>Price</dt><dd>${esc(manualQuote.totalCents === null ? 'Review required' : money(manualQuote.totalCents))}</dd>
        </dl>${intent}`,
      confirmLabel: mode === 'documents' ? 'Book & send agreements' : 'Book, send & prepare invoice',
    });
    if (!confirmed) return;
  }
  manualSaving = true;
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
    if (mode === 'confirm') {
      await confirmManualBooking(created.requestId);
      return;
    }
    if (mode === 'save') {
      setSuccess(`Booking ${created.reference} saved. Required agreements remain visibly outstanding until sent and signed.`);
      return;
    }
    const documentsSent = await sendManualDocuments(created.requestId, true);
    let invoiceCreated = true;
    if (mode === 'documents-invoice') {
      invoiceCreated = await createManualInvoice(created.requestId, false, true);
    }
    if (documentsSent && invoiceCreated) {
      setSuccess(
        mode === 'documents'
          ? `Booking ${created.reference} saved and agreement invitation prepared.`
          : `Booking ${created.reference} saved, agreement invitation prepared and invoice draft created. The invoice was not sent.`,
      );
    } else {
      setAppError(
        `Booking ${created.reference} was saved, but ${!documentsSent ? 'the agreement invitation' : 'the invoice draft'} did not complete. Use the follow-up actions on the booking; do not recreate the booking.`,
      );
    }
  } catch (error) {
    setAppError(friendly(error));
  } finally {
    manualSaving = false;
  }
}

function selectedCompletedCrew(): string[] {
  return [...document.querySelectorAll<HTMLInputElement>('[data-manual-completed-crew]:checked')].map(
    (input) => input.value,
  );
}

async function saveCompletedService(createInvoiceAfter: boolean): Promise<void> {
  setAppError();
  if (manualSaving) return;
  const customerId = manualField<HTMLSelectElement>('customerId')?.value ?? '';
  const propertyId = manualField<HTMLSelectElement>('propertyId')?.value ?? '';
  const completedDate = manualField<HTMLInputElement>('completedDate')?.value ?? '';
  const customPrice = Number(manualField<HTMLInputElement>('customPrice')?.value ?? '');
  const crew = selectedCompletedCrew();
  if (!customerId || !propertyId) {
    setAppError('Choose the customer and property for the completed service.');
    return;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(completedDate)) {
    setAppError('Enter the actual completed service date.');
    return;
  }
  if (!Number.isFinite(customPrice) || customPrice <= 0) {
    setAppError('Enter the agreed service price.');
    return;
  }
  if (crew.length === 0) {
    setAppError('Select the cleaner(s) who actually performed the completed service.');
    return;
  }
  const pricing = manualPricingSummary();
  const customerName =
    [manualContext?.customer.first_name, manualContext?.customer.last_name].filter(Boolean).join(' ') || 'Customer';
  const property = manualContext?.properties.find((entry) => entry.id === propertyId);
  const propertyLabel = property
    ? [property.label, property.line1, property.city].filter(Boolean).join(' — ')
    : 'Selected property';
  const serviceLabel = manualField<HTMLSelectElement>('serviceType')?.selectedOptions[0]?.textContent ?? 'Cleaning';
  const confirmed = await adminConfirm({
    title: createInvoiceAfter ? 'Record completed service and create invoice?' : 'Record completed service?',
    body: `<dl class="admin-definition">
        <dt>Customer</dt><dd>${esc(customerName)}</dd>
        <dt>Property</dt><dd>${esc(propertyLabel)}</dd>
        <dt>Service</dt><dd>${esc(serviceLabel)}</dd>
        <dt>Completed date</dt><dd>${esc(completedDate)}</dd>
        <dt>Agreed service price</dt><dd>${esc(money(customPrice * 100))}</dd>
        <dt>Discount</dt><dd>${esc(money(pricing?.discountCents ?? 0))}</dd>
        <dt>Final service amount</dt><dd><strong>${esc(money(pricing?.totalCents ?? customPrice * 100))}</strong> before separately applicable tax</dd>
        <dt>Crew</dt><dd>${esc(crew.length)} cleaner${crew.length === 1 ? '' : 's'}</dd>
      </dl><p>The job will be recorded as Completed with no future appointment, no Google Calendar event and no automatic signing packet.${createInvoiceAfter ? ' One invoice will be created at the agreed price and will not be sent automatically.' : ''}</p>`,
    confirmLabel: createInvoiceAfter ? 'Save & create invoice' : 'Save completed job',
  });
  if (!confirmed) return;
  manualSaving = true;
  const target = document.querySelector<HTMLElement>('[data-manual-booking-result]');
  try {
    const created = await api<{
      appointmentId: string;
      reference: string;
      serviceDate: string;
      totalCents: number;
      linkedSigningRequestId?: string | null;
    }>('/api/admin/bookings', {
      method: 'POST',
      body: JSON.stringify({
        action: 'create_completed',
        ...manualPayload(),
        completedDate,
        teamMemberIds: crew,
        signingRequestId: manualField<HTMLSelectElement>('signingRequestId')?.value || undefined,
        notes: manualField<HTMLTextAreaElement>('notes')?.value ?? '',
      }),
    });
    let invoiceMarkup = '';
    if (createInvoiceAfter) {
      try {
        const invoiced = await api<{ invoice?: { number?: string; id?: string } }>('/api/admin/bookings', {
          method: 'POST',
          body: JSON.stringify({ action: 'invoice_job', appointmentId: created.appointmentId, paymentLink: false }),
        });
        invoiceMarkup = `<p class="admin-status-message" role="status">Invoice ${esc(invoiced.invoice?.number ?? '')} created as a draft at the agreed price. It has not been sent.</p>`;
      } catch (error) {
        invoiceMarkup = `<p class="admin-error">The completed job was saved, but the invoice was not created: ${esc(friendly(error))}. Retry from the job or Finance; do not duplicate the job.</p>`;
      }
    }
    if (target) {
      target.innerHTML = `<div class="admin-card"><h3>Completed service ${esc(created.reference)}</h3>
        <dl class="admin-definition"><dt>Customer</dt><dd>${esc(customerName)}</dd><dt>Property</dt><dd>${esc(propertyLabel)}</dd><dt>Service</dt><dd>${esc(serviceLabel)}</dd><dt>Completed date</dt><dd>${esc(created.serviceDate)}</dd><dt>Service amount</dt><dd>${esc(money(created.totalCents))}</dd><dt>Crew</dt><dd>${esc(crew.length)} cleaner${crew.length === 1 ? '' : 's'}</dd><dt>Signed agreement</dt><dd>${created.linkedSigningRequestId ? 'Linked without altering evidence' : 'Not linked'}</dd></dl>
        ${invoiceMarkup}<p class="admin-muted">This record is Completed and is not an active reservation. No calendar event or signing packet was created.</p></div>`;
    }
    setSuccess(createInvoiceAfter ? 'Completed service and invoice created.' : 'Completed service recorded.');
  } catch (error) {
    setAppError(friendly(error));
  } finally {
    manualSaving = false;
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

async function sendManualDocuments(_requestId: string, quiet = false): Promise<boolean> {
  if (!quiet) setAppError();
  if (!manualQuote) return false;
  try {
    const result = await api<{
      required?: boolean;
      signingUrl?: string;
      emailSent?: boolean;
      duplicate?: boolean;
      message?: string;
    }>(
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
      target.innerHTML = result.duplicate
        ? `<p class="admin-muted">${esc(result.message ?? 'An active signing request already exists for this booking. Use Resend in Documents & Agreements if a fresh link is needed.')}</p>`
        : result.required
          ? `<p class="admin-muted">${result.emailSent ? 'Signing email sent.' : 'Email was not sent; share this private link with the customer.'} <a href="${esc(
              result.signingUrl,
            )}">${esc(result.signingUrl)}</a></p>`
          : `<p class="admin-muted">${esc(result.message ?? 'No approved document requirements are active for this booking.')}</p>`;
    }
    return true;
  } catch (error) {
    if (!quiet) setAppError(friendly(error));
    return false;
  }
}

async function createManualInvoice(requestId: string, paymentLink: boolean, quiet = false): Promise<boolean> {
  if (!quiet) setAppError();
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
      )} created as a draft. It has not been emailed and no charge was made.${result.paymentLink?.url ? ` Payment link: <a href="${esc(result.paymentLink.url)}">${esc(result.paymentLink.url)}</a>` : ''}${
        result.paymentLinkError ? ` Payment link unavailable: ${esc(titleCase(result.paymentLinkError))}.` : ''
      }</p>`;
    }
    return true;
  } catch (error) {
    if (!quiet) setAppError(friendly(error));
    return false;
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

const ADDON_CATEGORY_LABELS: Record<string, string> = {
  kitchen: 'Kitchen',
  windows: 'Windows',
  bath_laundry: 'Bathrooms & laundry',
  organization: 'Organization',
  pets: 'Pets',
  interior_detail: 'Interior detail',
  specialty: 'Specialty services',
};

function extrasMarkup(items: Array<Record<string, unknown>>, attribute: string): string {
  const groups = new Map<string, Array<Record<string, unknown>>>();
  for (const item of items) {
    const category = String(item.category ?? 'other');
    const list = groups.get(category) ?? [];
    list.push(item);
    groups.set(category, list);
  }
  return [...groups.entries()]
    .map(
      ([category, entries]) =>
        `<fieldset class="admin-extras__group" data-extra-group><legend>${esc(ADDON_CATEGORY_LABELS[category] ?? titleCase(category.replaceAll('_', ' ')))}</legend>${entries
          .map(
            (item) =>
              `<label class="admin-extra-card" data-extra-text="${esc(`${item.label ?? ''} ${item.blurb ?? ''}`.toLowerCase())}"><input type="checkbox" ${attribute} value="${esc(item.id)}" /><span><strong>${esc(item.label)}</strong>${item.blurb ? `<small>${esc(item.blurb)}</small>` : ''}<em>${item.customQuote ? 'Custom quote' : 'Priced in the estimate'}</em></span></label>`,
          )
          .join('')}</fieldset>`,
    )
    .join('');
}

function updateExtrasSummary(prefix: 'manual' | 'quick'): void {
  const checked = [...document.querySelectorAll<HTMLInputElement>(`[data-${prefix}-addon]:checked`)];
  const summary = document.querySelector<HTMLElement>(`[data-${prefix}-extras-summary]`);
  const selected = document.querySelector<HTMLElement>(`[data-${prefix}-extras-selected]`);
  if (summary) {
    summary.textContent = checked.length
      ? `${checked.length} extra${checked.length === 1 ? '' : 's'} selected`
      : 'Choose extras';
  }
  if (selected) {
    selected.innerHTML = checked.length
      ? checked
          .map((box) => {
            const label = box.closest('label')?.querySelector('strong')?.textContent ?? box.value;
            return `<span class="admin-extra-chip">${esc(label)} <button type="button" data-admin-action="extra-remove" data-target="${esc(box.value)}" data-prefix="${prefix}" aria-label="Remove ${esc(label)}">×</button></span>`;
          })
          .join('')
      : '<span class="admin-muted">No extras selected.</span>';
  }
}

function filterExtras(prefix: 'manual' | 'quick', query: string): void {
  const value = query.trim().toLowerCase();
  for (const card of document.querySelectorAll<HTMLElement>(`[data-${prefix}-addon-list] [data-extra-text]`)) {
    card.hidden = Boolean(value) && !(card.dataset.extraText ?? '').includes(value);
  }
  for (const group of document.querySelectorAll<HTMLElement>(`[data-${prefix}-addon-list] [data-extra-group]`)) {
    group.hidden = ![...group.querySelectorAll<HTMLElement>('[data-extra-text]')].some((card) => !card.hidden);
  }
}

async function loadManualBooking(): Promise<void> {
  renderManualOptionLists();
  const customerSelect = manualField<HTMLSelectElement>('customerId');
  if (customerSelect) {
    customerSelect.innerHTML = '<option value="">Choose a customer</option>';
    const data = await api<{ customers?: Array<Record<string, unknown>> }>('/api/admin/customers?status=active&limit=200');
    for (const customer of data.customers ?? []) {
      customerSelect.insertAdjacentHTML(
        'beforeend',
        `<option value="${esc(customer.id)}">${esc(
          [customer.first_name, customer.last_name].filter(Boolean).join(' ') || customer.company_name || customer.id,
        )}${customer.email ? ` — ${esc(customer.email)}` : ''}</option>`,
      );
    }
  }
  const promotionSelect = manualField<HTMLSelectElement>('promotionCode');
  if (promotionSelect) {
    const current = promotionSelect.value;
    promotionSelect.innerHTML = '<option value="">No one-time promotion</option>';
    const promotionData = await api<{ promotions?: Array<Record<string, unknown>> }>('/api/admin/promotions').catch(() => ({ promotions: [] }));
    for (const promotion of promotionData.promotions ?? []) {
      if (String(promotion.displayStatus ?? promotion.status) !== 'active') continue;
      const discount = promotion.kind === 'percent' ? `${promotion.percent}%` : money(promotion.valueCents);
      const services = Array.isArray(promotion.services) ? ` · ${promotion.services.join('/')}` : '';
      promotionSelect.insertAdjacentHTML(
        'beforeend',
        `<option value="${esc(promotion.code)}">${esc(promotion.code)} — ${esc(promotion.name)} (${esc(discount)}${esc(services)})</option>`,
      );
    }
    if (current) promotionSelect.value = current;
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

interface QuickQuoteView {
  status: string;
  totalCents: number | null;
  range: { low: number; high: number } | null;
  laborHours: number | null;
  durationMinutes: number | null;
  cleaningSubtotalCents: number | null;
  extrasSubtotalCents: number | null;
  travelAdjustmentCents: number | null;
  discountAmountCents: number | null;
  discountLabel: string | null;
  ongoingPerVisitCents: number | null;
  ongoingFrequency: string | null;
  pricingVersion: string;
  serviceCode: string;
  message: string | null;
  entitlement: { code: string; percent: number; discountCents: number; label: string } | null;
  travel?: { oneWayMiles: number | null; verified: boolean };
}

let quickEstimateId = '';
let quickEstimateNumber = '';
let quickLastQuote: QuickQuoteView | null = null;
let quickPropertyData: Array<Record<string, unknown>> = [];
let quickCustomerRequestSeq = 0;

function quickForm(): HTMLFormElement | null {
  return document.querySelector<HTMLFormElement>('[data-quick-form]');
}

function quickField<T extends HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(name: string): T | null {
  return quickForm()?.elements.namedItem(name) as T | null;
}

function quickValue(name: string): string {
  return quickField<HTMLInputElement>(name)?.value.trim() ?? '';
}

function quickPayload(): Record<string, unknown> {
  const addonIds = [...document.querySelectorAll<HTMLInputElement>('[data-quick-addon]:checked')].map((box) => box.value);
  return {
    ...(quickEstimateId ? { id: quickEstimateId } : {}),
    customerId: quickValue('customerId'),
    propertyId: quickValue('propertyId'),
    branchId: quickValue('branchId'),
    customerName: quickValue('customerName'),
    customerEmail: quickValue('customerEmail'),
    customerPhone: quickValue('customerPhone'),
    addressLine1: quickValue('addressLine1'),
    addressUnit: quickValue('addressUnit'),
    city: quickValue('city'),
    state: quickValue('state'),
    postalCode: quickValue('postalCode'),
    latitude: quickValue('latitude'),
    longitude: quickValue('longitude'),
    placeId: quickValue('placeId'),
    county: quickValue('county'),
    formattedAddress: quickValue('formattedAddress'),
    serviceDate: quickValue('serviceDate'),
    engine: quickValue('engine'),
    serviceType: quickValue('serviceType'),
    propertyType: quickValue('propertyType'),
    squareFeet: quickValue('squareFeet'),
    bedrooms: quickValue('bedrooms'),
    fullBaths: quickValue('fullBaths'),
    halfBaths: quickValue('halfBaths'),
    beds: quickValue('beds'),
    pets: quickValue('pets'),
    condition: quickValue('condition'),
    lastClean: quickValue('lastClean'),
    frequency: quickValue('frequency'),
    supportiveEligible: quickField<HTMLInputElement>('supportiveEligible')?.checked ?? false,
    promotionCode: quickValue('promotionCode'),
    addonIds,
    notes: quickValue('notes'),
    facility: {
      facilityType: quickValue('facilityType'),
      cleanableSqft: quickValue('cleanableSqft'),
      restroomFixtures: quickValue('restroomFixtures'),
      breakroom: quickValue('breakroom') === 'breakroom' || quickValue('breakroom') === 'kitchen',
      condition: quickValue('facilityCondition'),
      traffic: quickValue('traffic'),
      flooring: quickValue('flooring'),
      firstClean: quickField<HTMLInputElement>('firstClean')?.checked ?? false,
      specialty: quickField<HTMLInputElement>('specialty')?.checked ?? false,
      frequency: quickValue('facilityFrequency'),
    },
  };
}

function syncQuickEngine(): void {
  const engine = quickValue('engine') || 'residential';
  const facility = engine === 'commercial' || engine === 'church';
  const residential = document.querySelector<HTMLElement>('[data-quick-residential]');
  const facilityFields = document.querySelector<HTMLElement>('[data-quick-facility]');
  if (residential) residential.hidden = facility;
  if (facilityFields) facilityFields.hidden = !facility;
  const service = quickField<HTMLSelectElement>('serviceType');
  if (service) {
    service.closest('label')?.toggleAttribute('hidden', facility);
    if (facility) service.value = 'standard';
  }
  const note = document.querySelector<HTMLElement>('[data-quick-benefit-note]');
  if (note) {
    note.textContent = quickValue('customerId')
      ? 'FRIENDS15 is applied automatically when this customer has an active account benefit. Community Support requires the eligibility checkbox.'
      : 'FRIENDS15 requires the estimate to be assigned to an existing customer. Community Support is a self-attested eligibility discount. Gift certificates are applied as payment at checkout, not as a discount.';
  }
}

function renderQuickOptionLists(): void {
  const addonList = document.querySelector<HTMLElement>('[data-quick-addon-list]');
  if (addonList && addonList.childElementCount === 0) {
    addonList.innerHTML = extrasMarkup(
      pricing.addons.items as unknown as Array<Record<string, unknown>>,
      'data-quick-addon',
    );
    addonList.addEventListener('change', () => updateExtrasSummary('quick'));
    updateExtrasSummary('quick');
  }
  const bundleList = document.querySelector<HTMLElement>('[data-quick-bundle-list]');
  if (bundleList && bundleList.childElementCount === 0) {
    const enabled = pricing.promotions.addonBundles.filter((bundle) => bundle.enabled);
    bundleList.innerHTML = enabled.length
      ? enabled
          .map(
            (bundle) =>
              `<label><input type="checkbox" data-quick-bundle value="${esc(bundle.id)}" data-bundle-required="${esc(
                bundle.requiredAddonIds.join(','),
              )}" /> ${esc(bundle.label)}</label>`,
          )
          .join('')
      : '<p class="admin-muted">No add-on bundles are enabled.</p>';
  }
}

async function loadQuickCustomerOptions(): Promise<void> {
  const select = quickField<HTMLSelectElement>('customerId');
  if (!select) return;
  const data = await api<{ customers?: Array<Record<string, unknown>> }>('/api/admin/customers?status=active&limit=200');
  select.innerHTML = `<option value="">New inquiry</option>${(data.customers ?? [])
    .map((customer) => `<option value="${esc(customer.id)}">${esc(
      [customer.first_name, customer.last_name].filter(Boolean).join(' ') || customer.company_name || 'Customer',
    )}${customer.email ? ` - ${esc(customer.email)}` : ''}</option>`)
    .join('')}`;
}

function quickCustomerNote(message: string): void {
  const note = document.querySelector<HTMLElement>('[data-quick-customer-note]');
  if (note) note.textContent = message;
}

async function loadQuickPropertyOptions(customerId: string, selected = ''): Promise<void> {
  const select = quickField<HTMLSelectElement>('propertyId');
  if (!select || !customerId) return;
  const requestSeq = ++quickCustomerRequestSeq;
  const data = await api<{ properties?: Array<Record<string, unknown>> }>(
    `/api/admin/bookings?view=context&customerId=${encodeURIComponent(customerId)}`,
  );
  if (requestSeq !== quickCustomerRequestSeq || quickValue('customerId') !== customerId) return;
  quickPropertyData = data.properties ?? [];
  select.innerHTML = `<option value="">No property selected</option>${quickPropertyData
    .map((property) => `<option value="${esc(property.id)}"${String(property.id) === selected ? ' selected' : ''}>${esc(
      property.label || property.line1 || 'Property',
    )} - ${esc([property.line1, property.city].filter(Boolean).join(', '))}</option>`)
    .join('')}`;
}

function clearQuickSelection(): void {
  quickPropertyData = [];
  for (const name of [
    'customerName',
    'customerEmail',
    'customerPhone',
    'addressLine1',
    'addressUnit',
    'city',
    'postalCode',
    'latitude',
    'longitude',
    'precision',
    'placeId',
    'county',
    'formattedAddress',
    'squareFeet',
    'bedrooms',
    'fullBaths',
    'halfBaths',
    'beds',
  ]) {
    const field = quickField<HTMLInputElement>(name);
    if (field) field.value = '';
  }
  const state = quickField<HTMLSelectElement>('state');
  if (state) state.value = 'FL';
  const propertyType = quickField<HTMLSelectElement>('propertyType');
  if (propertyType) propertyType.value = 'house';
  const pets = quickField<HTMLSelectElement>('pets');
  if (pets) pets.value = 'none';
  const propertySelect = quickField<HTMLSelectElement>('propertyId');
  if (propertySelect) {
    propertySelect.disabled = false;
    propertySelect.innerHTML = '<option value="">Choose a customer first</option>';
  }
  const block = document.querySelector<HTMLElement>('[data-quick-form] [data-admin-address-block]');
  block?.dispatchEvent(new Event('admin-address-reset'));
  window.refreshAdminAddressFields?.(quickForm() ?? document);
  quickCustomerNote('');
}

async function applyQuickCustomer(): Promise<void> {
  const customerId = quickValue('customerId');
  const requestSeq = ++quickCustomerRequestSeq;
  clearQuickSelection();
  syncQuickEngine();
  if (!customerId) return;
  const propertySelect = quickField<HTMLSelectElement>('propertyId');
  if (propertySelect) {
    propertySelect.disabled = true;
    propertySelect.innerHTML = '<option value="">Loading properties...</option>';
  }
  quickCustomerNote('Loading the selected customer and their saved properties...');
  let data: { customer?: Record<string, unknown>; properties?: Array<Record<string, unknown>> };
  try {
    data = await api<{ customer?: Record<string, unknown>; properties?: Array<Record<string, unknown>> }>(
      `/api/admin/bookings?view=context&customerId=${encodeURIComponent(customerId)}`,
    );
  } catch (error) {
    if (requestSeq === quickCustomerRequestSeq && quickValue('customerId') === customerId) {
      quickCustomerNote('This customer could not be loaded. Select them again or refresh the page.');
      throw error;
    }
    return;
  }
  if (requestSeq !== quickCustomerRequestSeq || quickValue('customerId') !== customerId) return;
  const customer = data.customer ?? {};
  const name = [customer.first_name, customer.last_name].filter(Boolean).join(' ').trim();
  const nameField = quickField<HTMLInputElement>('customerName');
  if (nameField) nameField.value = name;
  const emailField = quickField<HTMLInputElement>('customerEmail');
  if (emailField) emailField.value = String(customer.email ?? '');
  const phoneField = quickField<HTMLInputElement>('customerPhone');
  if (phoneField) phoneField.value = String(customer.phone ?? '');
  const properties = data.properties ?? [];
  quickPropertyData = properties;
  if (propertySelect) {
    propertySelect.disabled = false;
    propertySelect.innerHTML = `<option value="">No property selected</option>${properties
      .map((property) => `<option value="${esc(property.id)}">${esc(
        property.label || property.line1 || 'Property',
      )} - ${esc([property.line1, property.city].filter(Boolean).join(', '))}</option>`)
      .join('')}`;
  }
  const primary = properties.find((property) => Number(property.is_primary) === 1)
    ?? (properties.length === 1 ? properties[0] : undefined);
  if (primary && propertySelect) {
    propertySelect.value = String(primary.id);
    applyQuickProperty();
    quickCustomerNote(
      String(customer.email ?? '').trim()
        ? `${name || 'Customer'} loaded with ${properties.length === 1 ? 'their saved property' : 'the primary saved property'}.`
        : `${name || 'Customer'} loaded. No email is on file, so add one before emailing an estimate.`,
    );
  } else if (properties.length > 1) {
    quickCustomerNote('This customer has multiple properties. Choose the service property, or enter a new address.');
  } else {
    quickCustomerNote('This customer has no saved active property. Enter the service address before continuing.');
  }
  syncQuickEngine();
}

function applyQuickProperty(): void {
  const propertyId = quickValue('propertyId');
  const select = quickField<HTMLSelectElement>('propertyId');
  if (!propertyId || !select) return;
  const property = quickPropertyData.find((entry) => String(entry.id) === propertyId);
  const block = document.querySelector<HTMLElement>('[data-quick-form] [data-admin-address-block]');
  block?.dispatchEvent(new Event('admin-address-reset'));
  if (!property) return;
  const set = (name: string, value: unknown): void => {
    const field = quickField<HTMLInputElement>(name);
    if (field) field.value = value === null || value === undefined ? '' : String(value);
  };
  set('addressLine1', property.line1 ?? '');
  set('addressUnit', property.line2 ?? '');
  set('city', property.city ?? '');
  set('state', property.state ?? 'FL');
  set('postalCode', property.postal_code ?? '');
  set('latitude', property.latitude ?? '');
  set('longitude', property.longitude ?? '');
  set('precision', property.precision ?? '');
  const propertyType = quickField<HTMLSelectElement>('propertyType');
  if (propertyType) propertyType.value = String(property.property_type ?? 'house') || 'house';
  const pets = quickField<HTMLSelectElement>('pets');
  if (pets) pets.value = String(property.pets ?? 'none') || 'none';
  set('squareFeet', property.square_feet ?? '');
  set('bedrooms', property.bedrooms ?? '');
  set('fullBaths', property.full_baths ?? '');
  set('halfBaths', property.half_baths ?? '');
  set('beds', property.beds ?? '');
  window.refreshAdminAddressFields?.(quickForm() ?? document);
}

function renderQuickQuote(quote: QuickQuoteView): void {
  const target = document.querySelector<HTMLElement>('[data-quick-result]');
  if (!target) return;
  if (quote.status !== 'priced') {
    target.innerHTML = `<p class="admin-error">${esc(quote.message ?? 'This scope needs personal confirmation.')}</p>`;
    return;
  }
  const rows: Array<[string, string]> = [];
  if (quote.cleaningSubtotalCents !== null) rows.push(['Cleaning service', money(quote.cleaningSubtotalCents)]);
  if (quote.extrasSubtotalCents) rows.push(['Extras', money(quote.extrasSubtotalCents)]);
  if (quote.travelAdjustmentCents) rows.push(['Travel adjustment', money(quote.travelAdjustmentCents)]);
  if (quote.discountAmountCents) rows.push([quote.discountLabel ?? 'Discount', `-${money(quote.discountAmountCents)}`]);
  rows.push(['Estimated total', money(quote.totalCents)]);
  if (quote.ongoingPerVisitCents !== null) {
    rows.push([`Ongoing ${titleCase(quote.ongoingFrequency ?? 'visit')} visit`, money(quote.ongoingPerVisitCents)]);
  }
  const estimateLabel = quickEstimateNumber ? `Estimate #${quickEstimateNumber}` : 'Estimate';
  target.innerHTML = `<div class="admin-card">
    <h3>${esc(estimateLabel)}</h3>
    <p><strong>${esc(money(quote.totalCents))}</strong>${quote.range ? ` <span class="admin-muted">(${esc(money(quote.range.low))} - ${esc(money(quote.range.high))})</span>` : ''}</p>
    <p class="admin-muted">${esc(formatLaborAndSite(quote.laborHours, quote.durationMinutes))}${quote.travel?.oneWayMiles !== null && quote.travel?.oneWayMiles !== undefined ? ` · ${esc(quote.travel.oneWayMiles)} mi one way${quote.travel.verified ? ' verified' : ' preliminary'}` : ''}</p>
    ${quote.entitlement ? `<p class="admin-muted">${esc(quote.entitlement.label)} ${esc(quote.entitlement.percent)}% account benefit applied.</p>` : ''}
    <div class="admin-table-scroll"><table class="admin-table"><tbody>${rows.map(([label, value]) => `<tr><td>${esc(label)}</td><td style="text-align:right">${esc(value)}</td></tr>`).join('')}</tbody></table></div>
    <details class="admin-detail-toggle"><summary>Pricing diagnostics</summary><p class="admin-muted">Pricing version ${esc(quote.pricingVersion)}</p></details>
  </div>`;
}

async function quickCalculate(): Promise<QuickQuoteView | null> {
  const target = document.querySelector<HTMLElement>('[data-quick-result]');
  if (target) target.textContent = 'Calculating with the published pricing...';
  try {
    const result = await api<{ quote?: QuickQuoteView }>('/api/admin/quick-estimates', {
      method: 'POST',
      body: JSON.stringify({ action: 'calculate', ...quickPayload() }),
    });
    const quote = result.quote ?? null;
    quickLastQuote = quote;
    if (quote) renderQuickQuote(quote);
    return quote;
  } catch (error) {
    if (target) target.innerHTML = `<p class="admin-error">${esc(friendly(error))}</p>`;
    return null;
  }
}

async function quickSave(status: 'saved' | 'draft'): Promise<void> {
  const target = document.querySelector<HTMLElement>('[data-quick-result]');
  try {
    const result = await api<{ id: string; status: string; estimateNumber?: string; quote: QuickQuoteView }>('/api/admin/quick-estimates', {
      method: 'POST',
      body: JSON.stringify({ action: 'save', status, ...quickPayload() }),
    });
    quickEstimateId = result.id;
    quickEstimateNumber = result.estimateNumber ?? quickEstimateNumber;
    quickLastQuote = result.quote;
    renderQuickQuote(result.quote);
    if (target) target.insertAdjacentHTML('afterbegin', `<p class="admin-status-message" role="status">${esc(quickEstimateNumber ? `Estimate #${quickEstimateNumber}` : 'Estimate')} ${status === 'draft' ? 'draft ' : ''}saved.</p>`);
    await loadQuickList();
  } catch (error) {
    if (target) target.innerHTML = `<p class="admin-error">${esc(friendly(error))}</p>`;
  }
}

async function loadQuickList(status = '', q = ''): Promise<void> {
  const target = document.querySelector<HTMLElement>('[data-quick-list]');
  if (!target) return;
  const data = await api<{ estimates?: Array<Record<string, unknown>> }>(
    `/api/admin/quick-estimates?view=list&status=${encodeURIComponent(status)}&q=${encodeURIComponent(q)}`,
  );
  renderTable(target, ['Estimate #', 'Updated', 'Customer', 'Service', 'Address', 'Total', 'Status', 'Actions'], (data.estimates ?? []).map((estimate) => [
    esc(estimate.estimate_number ? `#${estimate.estimate_number}` : 'Not assigned'),
    esc(dateTime(estimate.updated_at)),
    esc([estimate.customer_name, estimate.customer_email].filter(Boolean).join(' - ') || [estimate.first_name, estimate.last_name].filter(Boolean).join(' ') || 'Inquiry'),
    esc(titleCase(estimate.engine ?? '')),
    esc(estimate.address_text ?? ''),
    money(estimate.total_cents),
    `<span class="admin-status">${esc(titleCase(estimate.status ?? ''))}</span>`,
    `<div class="admin-actions"><button class="btn btn--ghost btn--small" type="button" data-quick-open="${esc(estimate.id)}">Open</button><a class="btn btn--ghost btn--small" href="/api/admin/quick-estimates?view=pdf&id=${encodeURIComponent(String(estimate.id))}">PDF</a>${estimate.status !== 'converted' && estimate.status !== 'discarded' ? `<button class="btn btn--ghost btn--small" type="button" data-quick-convert="${esc(estimate.id)}">Convert</button><button class="btn btn--ghost btn--small" type="button" data-quick-discard="${esc(estimate.id)}">Discard</button>` : ''}</div>`,
  ]), 'No Quick Estimates yet.');
}

async function openQuickEstimate(id: string): Promise<void> {
  const data = await api<{ estimate?: Record<string, unknown>; input?: Record<string, unknown>; quote?: QuickQuoteView }>(
    `/api/admin/quick-estimates?view=open&id=${encodeURIComponent(id)}`,
  );
  const record = data.estimate;
  const input = data.input;
  if (!record || !input) return;
  quickEstimateId = String(record.id);
  quickEstimateNumber = String(record.estimate_number ?? '');
  const form = quickForm();
  if (!form) return;
  const set = (name: string, value: unknown): void => {
    const field = form.elements.namedItem(name) as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | null;
    if (field) field.value = value === null || value === undefined ? '' : String(value);
  };
  set('customerId', input.customerId ?? record.customer_id ?? '');
  set('branchId', input.branchId ?? record.branch_id ?? 'branch_pensacola');
  set('customerName', input.customerName ?? record.customer_name ?? '');
  set('customerEmail', input.customerEmail ?? record.customer_email ?? '');
  set('customerPhone', input.customerPhone ?? record.customer_phone ?? '');
  set('addressLine1', input.addressLine1 ?? '');
  set('city', input.city ?? '');
  set('state', input.state ?? 'FL');
  set('postalCode', input.postalCode ?? '');
  set('serviceDate', input.serviceDate ?? '');
  set('engine', input.engine ?? 'residential');
  set('serviceType', input.serviceType ?? 'standard');
  set('propertyType', input.propertyType ?? 'house');
  set('squareFeet', input.squareFeet ?? '');
  set('bedrooms', input.bedrooms ?? '');
  set('fullBaths', input.fullBaths ?? '');
  set('halfBaths', input.halfBaths ?? '');
  set('beds', input.beds ?? '');
  set('pets', input.pets ?? 'none');
  set('condition', input.condition ?? 'maintained');
  set('lastClean', input.lastClean ?? 'within_month');
  set('frequency', input.frequency ?? 'one_time');
  set('promotionCode', input.promotionCode ?? '');
  set('notes', input.notes ?? '');
  set('facilityType', (input.facility as Record<string, unknown> | undefined)?.facilityType ?? 'office');
  set('cleanableSqft', (input.facility as Record<string, unknown> | undefined)?.cleanableSqft ?? '');
  set('restroomFixtures', (input.facility as Record<string, unknown> | undefined)?.restroomFixtures ?? '');
  set('facilityCondition', (input.facility as Record<string, unknown> | undefined)?.condition ?? 'average');
  set('traffic', (input.facility as Record<string, unknown> | undefined)?.traffic ?? 'average');
  set('flooring', (input.facility as Record<string, unknown> | undefined)?.flooring ?? 'mixed');
  set('facilityFrequency', (input.facility as Record<string, unknown> | undefined)?.frequency ?? 'weekly');
  const supportive = form.elements.namedItem('supportiveEligible') as HTMLInputElement | null;
  if (supportive) supportive.checked = Boolean(input.supportiveEligible);
  await loadQuickPropertyOptions(String(input.customerId ?? ''), String(input.propertyId ?? ''));
  syncQuickEngine();
  if (data.quote) {
    quickLastQuote = data.quote;
    renderQuickQuote(data.quote);
  }
  form.scrollIntoView({ block: 'start', behavior: 'smooth' });
}

async function quickDiscard(): Promise<void> {
  if (!quickEstimateId) throw new Error('Save the estimate before discarding it.');
  if (!window.confirm('Discard this Quick Estimate? It stays in the audit record and is never hard-deleted.')) return;
  await api('/api/admin/quick-estimates', { method: 'POST', body: JSON.stringify({ action: 'discard', id: quickEstimateId }) });
  await loadQuickList();
  quickEstimateId = '';
  quickEstimateNumber = '';
  quickForm()?.reset();
  const target = document.querySelector<HTMLElement>('[data-quick-result]');
  if (target) target.innerHTML = '<p class="admin-muted">Estimate discarded.</p>';
}

async function quickDownloadPdf(): Promise<void> {
  const headers = new Headers({ 'Content-Type': 'application/json', Accept: 'application/pdf' });
  if (csrf) headers.set('X-CSRF-Token', csrf);
  const response = await fetch('/api/admin/quick-estimates', {
    method: 'POST',
    headers,
    credentials: 'same-origin',
    body: JSON.stringify({ action: 'pdf', ...quickPayload() }),
  });
  if (!response.ok) {
    const result = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(result.error ?? `HTTP ${response.status}`);
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `quick-estimate-${quickEstimateId || 'draft'}.pdf`;
  anchor.click();
  URL.revokeObjectURL(url);
}

async function quickEmail(): Promise<void> {
  if (!quickEstimateId) throw new Error('Save the estimate before emailing it.');
  const result = await api<{ status?: string }>('/api/admin/quick-estimates', {
    method: 'POST',
    body: JSON.stringify({
      action: 'email',
      id: quickEstimateId,
      email: quickValue('customerEmail'),
    }),
  });
  const target = document.querySelector<HTMLElement>('[data-quick-result]');
  if (target) target.insertAdjacentHTML('afterbegin', `<p class="admin-status-message" role="status">${result.status === 'sent' ? 'Estimate emailed.' : 'Estimate email not sent.'}</p>`);
}

async function quickConvertTimes(): Promise<void> {
  const form = document.querySelector<HTMLFormElement>('[data-quick-convert]');
  const status = document.querySelector<HTMLElement>('[data-quick-convert-status]');
  if (!form || !status) return;
  const data = new FormData(form);
  const date = String(data.get('date') ?? '');
  const customerId = quickValue('customerId');
  const propertyId = quickValue('propertyId');
  if (!customerId || !propertyId) {
    status.textContent = 'Assign the estimate to a customer and property before converting.';
    return;
  }
  if (!date) {
    status.textContent = 'Choose a date first.';
    return;
  }
  status.textContent = 'Checking real availability...';
  try {
    const result = await api<{ availability?: { ok: boolean; reason?: string; slots: Array<{ start: string; end: string; label: string }> } }>(
      `/api/admin/bookings?view=availability&customerId=${encodeURIComponent(customerId)}&propertyId=${encodeURIComponent(propertyId)}&date=${encodeURIComponent(date)}&durationMinutes=${encodeURIComponent(String(quickLastQuote?.durationMinutes ?? 120))}&crewSize=${encodeURIComponent(String(data.get('crewSize') ?? '1'))}`,
    );
    const availability = result.availability;
    const select = form.elements.namedItem('start') as HTMLSelectElement | null;
    if (!availability?.ok) {
      status.textContent = `No availability: ${friendly(availability?.reason ?? 'unavailable')}`;
      return;
    }
    if (select) {
      select.innerHTML = `<option value="">Choose a time</option>${availability.slots.map((slot) => `<option value="${esc(slot.start)}" data-end="${esc(slot.end)}">${esc(slot.label)}</option>`).join('')}`;
    }
    status.textContent = `${availability.slots.length} real appointment time(s) available.`;
  } catch (error) {
    status.textContent = friendly(error);
  }
}

async function loadQuickEstimate(): Promise<void> {
  renderQuickOptionLists();
  await loadQuickCustomerOptions();
  const promotionSelect = quickField<HTMLSelectElement>('promotionCode');
  if (promotionSelect) {
    const data = await api<{ promotions?: Array<Record<string, unknown>> }>('/api/admin/promotions');
    const active = (data.promotions ?? []).filter((promotion) =>
      promotion.editable !== false && ['active'].includes(String(promotion.displayStatus ?? promotion.status ?? '')),
    );
    promotionSelect.innerHTML = `<option value="">Automatic eligible benefit</option>${active.map((promotion) => `<option value="${esc(promotion.code)}">${esc(promotion.name)} (${esc(promotion.code)})</option>`).join('')}`;
  }
  syncQuickEngine();
  await loadQuickList();
}

interface DispatchTeamMember {
  id: string;
  name: string;
  status: string;
  bookable: boolean;
  role: string;
  services?: string[];
  equipment?: string[];
  transportMode: string;
  canDrive: boolean;
  seats: number;
  canTransportEquipment: boolean;
  maxWeeklyHours: number;
  overtimeApproved: boolean;
  workdays?: number[];
  workdayStart?: string;
  workdayEnd?: string;
  originConfigured: boolean;
  originAddress: string;
  originLat: number | null;
  originLng: number | null;
  altOriginAddress: string;
  altOriginLat: number | null;
  altOriginLng: number | null;
  notes: string;
  readiness?: string[];
  onboarding?: { satisfied: boolean; bundleCode?: string; missing: string[] };
}

interface DispatchDashboard {
  branchId: string;
  timezone: string;
  settings: {
    mode: string;
    autoAssignEnabled: boolean;
    reassignmentRecommendations: boolean;
    customerReschedulingRecommendations: boolean;
    paused: boolean;
    minSavingsCents: number;
    maxCandidates: number;
    vehicleCostCentsPerMile: number;
    travelPayPercent: number;
    weights: Record<string, number>;
  };
  counts: {
    unassigned: number;
    assignedToday: number;
    autoAssignedToday: number;
    pendingRecommendations: number;
    coverageExceptions: number;
    team: number;
    dispatchReady: number;
  };
  unassigned: Array<Record<string, unknown>>;
  recommendations: Array<Record<string, unknown>>;
  exceptions: Array<Record<string, unknown>>;
  decisions: Array<Record<string, unknown>>;
  lanes: Array<{ id: string; name: string; jobs: Array<Record<string, unknown>> }>;
  team: DispatchTeamMember[];
  metadata: {
    services: Array<{ code: string; label: string }>;
    equipment: Array<{ code: string; label: string }>;
    branches: Array<{ id: string; name: string; timezone: string }>;
  };
}

let dispatchTeam: DispatchTeamMember[] = [];

function dispatchMemberName(id: string): string {
  return dispatchTeam.find((member) => member.id === id)?.name ?? id;
}

function dispatchTeamNames(value: unknown): string {
  return Array.isArray(value) ? value.map((id) => dispatchMemberName(String(id))).join(', ') : '';
}

function dispatchBranchValue(): string {
  return document.querySelector<HTMLSelectElement>('[data-dispatch-branch]')?.value || actor?.branchId || 'branch_pensacola';
}

function dispatchResult(message: string, kind: 'ok' | 'error' = 'ok'): void {
  const target = document.querySelector<HTMLElement>('[data-dispatch-result]');
  if (!target) return;
  target.textContent = message;
  target.className = kind === 'error' ? 'admin-error' : 'admin-status-message';
}

function dispatchSettingsForm(): HTMLFormElement | null {
  return document.querySelector<HTMLFormElement>('[data-dispatch-settings]');
}

function dispatchProfileForm(): HTMLFormElement | null {
  return document.querySelector<HTMLFormElement>('[data-dispatch-profile]');
}

function setDispatchProfile(memberId: string): void {
  const form = dispatchProfileForm();
  const member = dispatchTeam.find((entry) => entry.id === memberId);
  if (!form || !member) return;
  const field = (name: string): HTMLInputElement | HTMLSelectElement | null =>
    form.elements.namedItem(name) as HTMLInputElement | HTMLSelectElement | null;
  const set = (name: string, value: unknown): void => {
    const input = field(name);
    if (input) input.value = value === null || value === undefined ? '' : String(value);
  };
  const block = form.querySelector<HTMLElement>('[data-admin-address-block]');
  block?.dispatchEvent(new Event('admin-address-reset'));
  set('memberId', member.id);
  set('transportMode', member.transportMode);
  set('seats', member.seats);
  set('maxWeeklyHours', member.maxWeeklyHours);
  set('workdayStart', member.workdayStart ?? '07:00');
  set('workdayEnd', member.workdayEnd ?? '18:00');
  set('notes', member.notes);
  for (const box of form.querySelectorAll<HTMLInputElement>('input[name="workdays"]')) box.checked = (member.workdays ?? []).includes(Number(box.value));
  const drive = field('canDrive');
  if (drive instanceof HTMLInputElement) drive.checked = member.canDrive;
  const equipment = field('canTransportEquipment');
  if (equipment instanceof HTMLInputElement) equipment.checked = member.canTransportEquipment;
  const overtime = field('overtimeApproved');
  if (overtime instanceof HTMLInputElement) overtime.checked = member.overtimeApproved;
  for (const box of form.querySelectorAll<HTMLInputElement>('input[name="services"]')) box.checked = (member.services ?? []).includes(box.value);
  for (const box of form.querySelectorAll<HTMLInputElement>('input[name="equipment"]')) box.checked = (member.equipment ?? []).includes(box.value);
  set('addressLine1', member.originAddress);
  set('latitude', member.originLat);
  set('longitude', member.originLng);
  const status = form.querySelector<HTMLElement>('[data-admin-address-status]');
  if (status) {
    status.textContent = member.originConfigured
      ? 'Verified dispatch origin is saved.'
      : 'No dispatch origin is saved. Automatic assignment will block until verified.';
    status.className = 'admin-address-status admin-address-status--muted';
  }
  const readiness = document.querySelector<HTMLElement>('[data-dispatch-readiness]');
  if (readiness) {
    const labels: Record<string, string> = {
      employee_inactive: 'Employee is inactive.',
      employee_not_bookable: 'Employee is not bookable.',
      service_qualifications_missing: 'No approved service qualifications.',
      equipment_qualifications_missing: 'No approved equipment.',
      transport_not_configured: 'Transportation is not configured.',
      dispatch_origin_missing: 'No verified dispatch origin.',
      availability_missing: 'No regular workdays.',
      onboarding_requirements_missing: 'Employee onboarding requirements are incomplete.',
    };
    const reasons = member.readiness ?? [];
    const missing = member.onboarding?.missing ?? [];
    readiness.innerHTML = reasons.length === 0
      ? '<p class="admin-dispatch-good"><strong>Dispatch-ready.</strong> This employee has the recorded qualifications, equipment, transport, origin, availability and onboarding clearance required for automatic assignment.</p>'
      : '<div class="admin-dispatch-warning"><strong>Not dispatch-ready.</strong><ul>' +
        reasons.map((reason) => '<li>' + esc(labels[reason] ?? reason) + '</li>').join('') +
        (missing.length ? '<li>Missing documents: ' + esc(missing.join(', ')) + '</li>' : '') +
        '</ul></div>';
  }
}

function showDispatchTab(tab: string): void {
  const active = ['board', 'team', 'coverage', 'settings', 'history'].includes(tab) ? tab : 'board';
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-dispatch-tab]')) {
    if (button.dataset.dispatchTab === active) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  }
  for (const section of document.querySelectorAll<HTMLElement>('[data-dispatch-section]')) {
    section.hidden = section.dataset.dispatchSection !== active;
  }
}

for (const button of document.querySelectorAll<HTMLButtonElement>('[data-dispatch-tab]')) {
  button.addEventListener('click', () => showDispatchTab(button.dataset.dispatchTab ?? 'board'));
}
showDispatchTab('board');

async function loadDispatch(): Promise<void> {
  const branchSelect = document.querySelector<HTMLSelectElement>('[data-dispatch-branch]');
  if (!branchSelect) return;
  const branchId = branchSelect.value || actor?.branchId || 'branch_pensacola';
  const data = await api<DispatchDashboard>('/api/admin/dispatch?branchId=' + encodeURIComponent(branchId));
  dispatchTeam = data.team;
  if (branchSelect.options.length <= 1) {
    branchSelect.innerHTML = data.metadata.branches
      .map((branch) => '<option value="' + esc(branch.id) + '">' + esc(branch.name) + ' - ' + esc(branch.timezone) + '</option>')
      .join('');
  }
  branchSelect.value = branchId;
  const hiddenBranch = dispatchProfileForm()?.elements.namedItem('branchId') as HTMLInputElement | null;
  if (hiddenBranch) hiddenBranch.value = branchId;
  const form = dispatchSettingsForm();
  if (form) {
    const field = (name: string): HTMLInputElement | HTMLSelectElement | null =>
      form.elements.namedItem(name) as HTMLInputElement | HTMLSelectElement | null;
    const mode = field('mode');
    if (mode) mode.value = data.settings.mode;
    for (const [name, value] of [
      ['autoAssignEnabled', data.settings.autoAssignEnabled],
      ['paused', data.settings.paused],
      ['reassignmentRecommendations', data.settings.reassignmentRecommendations],
    ] as Array<[string, boolean]>) {
      const box = field(name);
      if (box instanceof HTMLInputElement) box.checked = value;
    }
    const savings = field('minSavingsCents');
    if (savings) savings.value = String(data.settings.minSavingsCents / 100);
    const maxCandidates = field('maxCandidates');
    if (maxCandidates) maxCandidates.value = String(data.settings.maxCandidates);
    const mileage = field('vehicleCostCentsPerMile');
    if (mileage) mileage.value = String(data.settings.vehicleCostCentsPerMile);
    const travel = field('travelPayPercent');
    if (travel) travel.value = String(data.settings.travelPayPercent);
  }
  const weights = document.querySelector<HTMLFormElement>('[data-dispatch-weights]');
  if (weights) {
    for (const [name, value] of Object.entries(data.settings.weights)) {
      const input = weights.elements.namedItem(name) as HTMLInputElement | null;
      if (input) input.value = String(value);
    }
  }
  const kpis = document.querySelector<HTMLElement>('[data-dispatch-kpis]');
  if (kpis) {
    kpis.innerHTML = [
      ['Unassigned', data.counts.unassigned],
      ['Assigned today', data.counts.assignedToday],
      ['Auto-assigned today', data.counts.autoAssignedToday],
      ['Recommendations', data.counts.pendingRecommendations],
      ['Coverage exceptions', data.counts.coverageExceptions],
      ['Dispatch-ready staff', data.counts.dispatchReady + '/' + data.counts.team],
    ].map(([label, value]) =>
      '<div class="admin-dispatch-kpi"><strong>' + esc(value) + '</strong><span>' + esc(label) + '</span></div>',
    ).join('');
  }
  const unassigned = document.querySelector<HTMLElement>('[data-admin-dispatch-unassigned]');
  if (unassigned) {
    const ready = data.team.filter((member) => (member.readiness ?? []).length === 0);
    unassigned.innerHTML = data.unassigned.length
      ? `<p class="admin-muted">Select the full crew for each job. The server validates the exact crew set, qualifications, travel, branch and time before assigning. Customer appointment times never change.</p><div class="admin-dispatch-unassigned">${data.unassigned
          .map((job) => {
            const crewSize = Math.max(1, Number(job.crewSize ?? 1));
            const options = ready.length
              ? `<div class="admin-dispatch-crew" data-dispatch-crew="${esc(String(job.id))}">${ready
                  .map(
                    (member) =>
                      `<label><input type="checkbox" data-dispatch-crew-member="${esc(String(job.id))}" value="${esc(member.id)}" /> <span><strong>${esc(member.name)}</strong> <span class="admin-muted">${esc(titleCase(member.role))} · ${esc(member.workdayStart ?? '07:00')}–${esc(member.workdayEnd ?? '18:00')}</span></span></label>`,
                  )
                  .join('')}</div><button class="btn btn--primary btn--small" type="button" data-admin-action="dispatch-assign" data-id="${esc(String(job.id))}">Assign selected crew</button>`
              : '<span class="admin-muted">No dispatch-ready cleaner. Complete a team profile first.</span>';
            return `<div class="admin-dispatch-job-card"><div><strong>${esc(String(job.reference ?? ''))}</strong><p class="admin-muted">${esc(dateTime(job.startAt, branchId))} · ${esc(String(job.customer ?? 'Customer'))} · ${esc(String(job.location ?? ''))} · ${esc(String(job.serviceCode ?? ''))} · crew ${crewSize}</p></div>${options}</div>`;
          })
          .join('')}</div>`
      : '<p class="admin-muted">No unassigned jobs in the dispatch window.</p>';
  }
  const recommendations = document.querySelector<HTMLElement>('[data-admin-dispatch-recommendations]');
  if (recommendations) {
    recommendations.innerHTML = data.recommendations.length
      ? data.recommendations.map((entry) =>
          '<div class="admin-record"><p><strong>' + esc(entry.reference ?? entry.appointment_id) + '</strong> - ' + esc(entry.reason ?? '') + '</p>' +
          '<p class="admin-muted">Current: ' + esc(dispatchTeamNames(entry.currentTeam)) + ' | Proposed: ' + esc(dispatchTeamNames(entry.chosenTeam)) + '</p>' +
          '<div class="admin-actions"><button class="btn btn--primary btn--small" type="button" data-admin-action="dispatch-approve" data-id="' + esc(entry.id) + '">Approve</button>' +
          '<button class="btn btn--ghost btn--small" type="button" data-admin-action="dispatch-reject" data-id="' + esc(entry.id) + '">Reject</button>' +
          '<button class="btn btn--ghost btn--small" type="button" data-admin-action="dispatch-defer" data-id="' + esc(entry.id) + '">Defer</button></div></div>',
        ).join('')
      : '<p class="admin-muted">No pending reassignment recommendations. Existing assignments are never changed automatically.</p>';
  }
  const exceptions = document.querySelector<HTMLElement>('[data-admin-dispatch-exceptions]');
  if (exceptions) {
    exceptions.innerHTML = data.exceptions.length
      ? data.exceptions.map((entry) =>
          '<div class="admin-dispatch-warning"><strong>' + esc(entry.reference ?? entry.appointment_id) + '</strong> - ' + esc(entry.reason ?? 'Coverage exception') + '</div>',
        ).join('')
      : '<p class="admin-muted">No open coverage exceptions.</p>';
  }
  const lanes = document.querySelector<HTMLElement>('[data-admin-dispatch-lanes]');
  if (lanes) {
    lanes.innerHTML = '<div class="admin-dispatch-lanes">' + data.lanes.map((lane) =>
      '<div class="admin-dispatch-lane"><h4>' + esc(lane.name) + '</h4>' + (lane.jobs.length
        ? lane.jobs.map((job) =>
            '<div class="admin-dispatch-job"><strong>' + esc(dateTime(job.startAt, branchId)) + ' - ' + esc(job.reference) + '</strong>' +
            '<span>' + esc(job.customer) + ' - ' + esc(job.location) + '</span></div>',
          ).join('')
        : '<p class="admin-muted">No jobs in this window.</p>') + '</div>',
    ).join('') + '</div>';
  }
  const log = document.querySelector<HTMLElement>('[data-admin-dispatch-log]');
  if (log) {
    renderTable(log, ['Created', 'Job', 'Decision', 'Status', 'Calendar', 'Reason', 'Alternatives', 'Action'], data.decisions.map((entry) => [
      esc(dateTime(entry.createdAt, branchId)),
      esc(entry.reference ?? entry.appointmentId),
      esc(titleCase(entry.kind)),
      esc(titleCase(entry.status)),
      esc(entry.calendarStatus ?? '-'),
      esc(entry.reason ?? '-'),
      esc(entry.candidateNames || '-'),
      entry.calendarStatus === 'failed'
        ? '<button class="btn btn--ghost btn--small" type="button" data-admin-action="dispatch-retry-calendar" data-id="' + esc(entry.id) + '">Retry calendar</button>'
        : '-',
    ]), 'No dispatch decisions recorded yet.');
  }
  const profileSelect = document.querySelector<HTMLSelectElement>('[data-dispatch-profile-select]');
  if (profileSelect) {
    const selected = profileSelect.value;
    profileSelect.innerHTML = '<option value="">Choose a team member</option>' + data.team
      .map((member) => '<option value="' + esc(member.id) + '">' + esc(member.name) + ' - ' + esc(member.status) + '</option>')
      .join('');
    if (selected && data.team.some((member) => member.id === selected)) {
      profileSelect.value = selected;
      setDispatchProfile(selected);
    }
  }
}

async function dispatchAction(body: Record<string, unknown>): Promise<void> {
  try {
    const result = await api<{ summary?: Record<string, unknown> }>('/api/admin/dispatch', {
      method: 'POST',
      body: JSON.stringify({ ...body, branchId: dispatchBranchValue() }),
    });
    const summary = result.summary;
    if (summary) {
      dispatchResult(
        'Scanned ' + String(summary.scanned ?? 0) +
        ' jobs, assigned ' + String(summary.assigned ?? 0) +
        ', exceptions ' + String(summary.exceptions ?? 0) +
        ', recommendations ' + String(summary.recommendations ?? 0) + '.',
      );
    } else {
      dispatchResult('Dispatch updated.');
    }
    await loadDispatch();
  } catch (error) {
    dispatchResult(friendly(error), 'error');
  }
}

document.querySelector<HTMLSelectElement>('[data-dispatch-branch]')?.addEventListener('change', () => {
  void loadDispatch().catch((error) => setAppError(friendly(error)));
});

document.querySelector<HTMLSelectElement>('[data-dispatch-profile-select]')?.addEventListener('change', (event) => {
  const value = (event.target as HTMLSelectElement).value;
  if (value) setDispatchProfile(value);
});

dispatchSettingsForm()?.addEventListener('submit', (event) => {
  event.preventDefault();
  const form = event.currentTarget as HTMLFormElement;
  const data = new FormData(form);
  void dispatchAction({
    action: 'update_settings',
    mode: String(data.get('mode') ?? 'analysis_only'),
    autoAssignEnabled: data.get('autoAssignEnabled') === 'on',
    paused: data.get('paused') === 'on',
    reassignmentRecommendations: data.get('reassignmentRecommendations') === 'on',
    customerReschedulingRecommendations: false,
    minSavingsCents: Math.round(Number(data.get('minSavingsCents') ?? 0) * 100),
    maxCandidates: Number(data.get('maxCandidates') ?? 8),
    vehicleCostCentsPerMile: Number(data.get('vehicleCostCentsPerMile') ?? 0),
    travelPayPercent: Number(data.get('travelPayPercent') ?? 0),
  });
});

document.querySelector<HTMLFormElement>('[data-dispatch-weights]')?.addEventListener('submit', (event) => {
  event.preventDefault();
  const form = event.currentTarget as HTMLFormElement;
  const data = new FormData(form);
  void dispatchAction({
    action: 'update_settings',
    weights: {
      travel: Number(data.get('travel') ?? 1),
      miles: Number(data.get('miles') ?? 0.2),
      labor: Number(data.get('labor') ?? 0.1),
      workload: Number(data.get('workload') ?? 0.5),
      continuity: Number(data.get('continuity') ?? 12),
      shared: Number(data.get('shared') ?? 0),
    },
  });
});

dispatchProfileForm()?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget as HTMLFormElement;
  const data = new FormData(form);
  const memberId = String(data.get('memberId') ?? '');
  if (!memberId) {
    dispatchResult('Choose a team member before saving a dispatch profile.', 'error');
    return;
  }
  const services = [...form.querySelectorAll<HTMLInputElement>('input[name="services"]:checked')].map((box) => box.value);
  const equipment = [...form.querySelectorAll<HTMLInputElement>('input[name="equipment"]:checked')].map((box) => box.value);
  try {
    await api('/api/admin/dispatch', {
      method: 'POST',
      body: JSON.stringify({
        action: 'update_profile',
        branchId: dispatchBranchValue(),
        memberId,
        services,
        equipment,
        transportMode: String(data.get('transportMode') ?? 'unknown'),
        canDrive: data.get('canDrive') === 'on',
        seats: Number(data.get('seats') ?? 0),
        canTransportEquipment: data.get('canTransportEquipment') === 'on',
        maxWeeklyHours: Number(data.get('maxWeeklyHours') ?? 40),
        overtimeApproved: data.get('overtimeApproved') === 'on',
        workdays: [...form.querySelectorAll<HTMLInputElement>('input[name="workdays"]:checked')].map((box) => Number(box.value)),
        workdayStart: String(data.get('workdayStart') ?? '07:00'),
        workdayEnd: String(data.get('workdayEnd') ?? '18:00'),
        originAddress: String(data.get('addressLine1') ?? ''),
        originLat: data.get('latitude') ? Number(data.get('latitude')) : null,
        originLng: data.get('longitude') ? Number(data.get('longitude')) : null,
        originPlaceId: String(data.get('placeId') ?? ''),
        notes: String(data.get('notes') ?? ''),
      }),
    });
    dispatchResult('Dispatch profile saved for ' + dispatchMemberName(memberId) + '.');
    await loadDispatch();
  } catch (error) {
    dispatchResult(friendly(error), 'error');
  }
});

interface CareerApplication {
  id: string;
  reference: string;
  created_at: string;
  name: string;
  email: string;
  phone: string;
  experience_level: string;
  desired_role: string;
  branch_preference: string;
  availability: string;
  transportation: string;
  status: string;
  notes: string;
  resume_key: string;
  resume_name: string;
  hiring_notified_at?: string | null;
  applicant_notified_at?: string | null;
}

let careerApplications: CareerApplication[] = [];

async function loadCareers(status?: string): Promise<void> {
  if (status !== undefined && status !== careerPage.status) {
    careerPage.status = status;
    careerPage.offset = 0;
  }
  const target = document.querySelector<HTMLElement>('[data-careers-list]');
  if (!target) return;
  const params = new URLSearchParams({
    status: careerPage.status,
    branch: careerPage.branch,
    q: careerPage.q,
    limit: String(careerPage.limit),
    offset: String(careerPage.offset),
    sort: careerPage.sort,
  });
  const data = await api<{ applications?: CareerApplication[]; total?: number; limit?: number; offset?: number }>('/api/admin/careers?' + params.toString());
  careerApplications = data.applications ?? [];
  renderPager(document.querySelector<HTMLElement>('[data-careers-pagination]'), data, 'careers-page');
  renderTable(target, ['Submitted', 'Applicant', 'Role', 'Branch', 'Experience', 'Status', 'Action'], careerApplications.map((application) => [
    esc(dateTime(application.created_at)),
    '<strong>' + esc(application.name) + '</strong><br /><span class="admin-muted">' + esc(application.email) + ' - ' + esc(application.reference) + '</span>',
    esc(titleCase(application.desired_role)),
    esc(titleCase(application.branch_preference)),
    esc(titleCase(application.experience_level)),
    esc(titleCase(application.status)),
    '<button class="btn btn--ghost btn--small" type="button" data-admin-action="career-open" data-id="' + esc(application.id) + '">Open</button>',
  ]), 'No career applications have been received yet.');
}

async function openCareer(id: string): Promise<void> {
  const data = await api<{ application?: CareerApplication }>('/api/admin/careers?view=detail&id=' + encodeURIComponent(id));
  const application = data.application;
  const target = document.querySelector<HTMLElement>('[data-career-detail]');
  if (!application || !target) return;
  target.innerHTML = '<div class="admin-card"><div class="admin-detail-head"><h2 class="admin-section-title">' + esc(application.name) + '</h2><span class="admin-status">' + esc(titleCase(application.status)) + '</span></div>' +
    '<dl class="admin-definition"><dt>Reference</dt><dd>' + esc(application.reference) + '</dd><dt>Email</dt><dd><a href="mailto:' + esc(application.email) + '">' + esc(application.email) + '</a></dd><dt>Phone</dt><dd>' + esc(application.phone) + '</dd><dt>Experience</dt><dd>' + esc(titleCase(application.experience_level)) + '</dd><dt>Desired role</dt><dd>' + esc(titleCase(application.desired_role)) + '</dd><dt>Branch</dt><dd>' + esc(titleCase(application.branch_preference)) + '</dd><dt>Transportation</dt><dd>' + esc(titleCase(application.transportation)) + '</dd><dt>Availability</dt><dd>' + esc(application.availability) + '</dd><dt>Resume</dt><dd>' + (application.resume_key ? '<a class="btn btn--ghost btn--small" href="/api/admin/careers?view=resume&id=' + encodeURIComponent(application.id) + '">Download private copy</a>' : 'Not attached') + '</dd></dl>' +
    '<form class="admin-form" data-career-update><input type="hidden" name="applicationId" value="' + esc(application.id) + '" /><label>Status <select name="status">' + ['new','reviewing','interview','offer','declined','archived'].map((status) => '<option value="' + status + '"' + (status === application.status ? ' selected' : '') + '>' + esc(titleCase(status)) + '</option>').join('') + '</select></label><label>Private notes <textarea name="notes" rows="4">' + esc(application.notes) + '</textarea></label><button class="btn btn--primary btn--small" type="submit">Save application</button></form></div>';
  target.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

document.addEventListener('submit', (event) => {
  const form = event.target as HTMLFormElement;
  if (!form.matches('[data-career-update]')) return;
  event.preventDefault();
  const data = new FormData(form);
  const applicationId = String(data.get('applicationId') ?? '');
  void api('/api/admin/careers', {
    method: 'POST',
    body: JSON.stringify({ action: 'update', applicationId, status: String(data.get('status') ?? ''), notes: String(data.get('notes') ?? '') }),
  }).then(() => openCareer(applicationId)).then(() => loadCareers()).catch((error) => setAppError(friendly(error)));
});

document.querySelector<HTMLFormElement>('[data-careers-search]')?.addEventListener('submit', (event) => {
  event.preventDefault();
  const data = new FormData(event.currentTarget as HTMLFormElement);
  careerPage.status = String(data.get('status') ?? '');
  careerPage.branch = String(data.get('branch') ?? '');
  careerPage.q = String(data.get('q') ?? '');
  careerPage.sort = String(data.get('sort') ?? 'created_at');
  careerPage.limit = Number(data.get('pageSize') ?? 25) || 25;
  careerPage.offset = 0;
  void loadCareers().catch((error) => setAppError(friendly(error)));
});


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
  await loadDispatch().catch((error) => setAppError(friendly(error)));
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

let reviewEligibleRows: Array<Record<string, unknown>> = [];

function reviewServiceLabel(row: Record<string, unknown>): string {
  try {
    const fields = JSON.parse(String(row.input_snapshot_json ?? '{}')) as Record<string, unknown>;
    const label = String(fields.service_label ?? fields.service_type ?? '').trim();
    if (label) return label.replaceAll('_', ' ').replaceAll('-', ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  } catch {}
  const code = String(row.service_code ?? '').replaceAll('_', ' ').replaceAll('-', ' ');
  return code ? code.replace(/\b\w/g, (c) => c.toUpperCase()) : 'Cleaning service';
}

function reviewInvitationStatus(row: Record<string, unknown>): { label: string; key: string } {
  const state = String(row.customer_review_status ?? 'never_invited');
  const count = Number(row.customer_review_invitation_count ?? 0);
  const latest = String(row.latest_status ?? '');
  if (state === 'reviewed') return { label: 'Confirmed reviewed', key: 'reviewed' };
  if (state === 'do_not_ask') return { label: 'Do not ask again', key: 'do_not_ask' };
  if (state === 'opted_out') return { label: 'Customer opted out', key: 'opted_out' };
  if (latest === 'queued' || state === 'queued') return { label: 'Invitation queued', key: 'queued' };
  if (latest === 'sent' || state === 'sent' || count > 0) return { label: 'Invitation sent', key: 'sent' };
  if (latest === 'failed' || state === 'failed') return { label: 'Delivery failed', key: 'failed' };
  if (state === 'unknown') return { label: 'Review status unknown', key: 'unknown' };
  return { label: 'Never invited', key: 'never_invited' };
}

function reviewStateSelect(row: Record<string, unknown>): string {
  const customerId = String(row.customer_id ?? '');
  if (!customerId) return '';
  return `<select class="admin-select" data-review-state-select="${esc(customerId)}" aria-label="Customer review status"><option value="">Review relationship…</option><option value="mark_reviewed">Mark as reviewed</option><option value="do_not_ask">Do not ask again</option><option value="opt_out">Customer opted out</option><option value="mark_unknown">Review status unknown</option><option value="mark_eligible">Mark eligible again</option></select><button class="btn btn--ghost btn--small" type="button" data-review-state-apply="${esc(customerId)}">Apply</button>`;
}

function renderReviewEligible(): void {
  const target = document.querySelector<HTMLElement>('[data-review-eligible-list]');
  if (!target) return;
  const filter = document.querySelector<HTMLSelectElement>('[data-review-eligible-filter]')?.value ?? '';
  const rows = reviewEligibleRows.filter((row) => {
    const status = reviewInvitationStatus(row).key;
    if (filter === 'not_invited') return status === 'never_invited';
    if (filter) return status === filter;
    return true;
  });
  if (rows.length === 0) {
    renderEmpty(target, 'No completed cleanings match this search and invitation filter.');
    return;
  }
  target.innerHTML = `<p class="admin-muted" style="margin:0 0 .5rem;">Review eligibility is tracked per customer. A customer already invited, reviewed or opted out is not asked again automatically. Marking a review manually records the owner's confirmation; it never claims that Google verified the review.</p><div class="admin-table-scroll"><table class="admin-table"><thead><tr><th>Customer</th><th>Service</th><th>Completed</th><th>Property</th><th>Branch</th><th>Review relationship</th><th>Invitation</th><th>Last invited</th><th>Actions</th></tr></thead><tbody>${rows
    .map((row) => {
      const customer = [row.first_name, row.last_name].filter(Boolean).join(' ') || 'Customer';
      const property = [row.line1, row.city].filter(Boolean).join(', ') || 'Property not linked';
      const status = reviewInvitationStatus(row);
      const hasReviewUrl = Boolean(String(row.review_url ?? '').trim());
      const hasEmail = Boolean(String(row.customer_email ?? '').trim());
      const enabled = Number(row.review_requests_enabled ?? 0) === 1;
      const suppressing = ['reviewed', 'do_not_ask', 'opted_out'].includes(status.key);
      const canQueue = status.key === 'never_invited' && !suppressing && hasReviewUrl && hasEmail;
      const action = canQueue
        ? `<button class="btn btn--primary btn--small" type="button" data-review-send-id="${esc(String(row.id))}">Send Review Invitation</button>${enabled ? '' : '<p class="admin-muted" style="margin:.25rem 0 0;">Automation is off; this sends only after your confirmation.</p>'}`
        : status.key === 'failed'
          ? '<span class="admin-muted">Retry from the invitation list below</span>'
          : status.key === 'queued'
            ? '<span class="admin-muted">Queued — send when due</span>'
            : !hasReviewUrl
              ? '<span class="admin-muted">Review link not configured</span>'
              : !hasEmail
                ? '<span class="admin-muted">No customer email on file</span>'
                : `<span class="admin-muted">${esc(status.label)}</span>`;
      return `<tr><td>${esc(customer)}</td><td>${esc(reviewServiceLabel(row))}</td><td>${esc(dateTime(row.start_at, row.branch_id))}</td><td>${esc(property)}</td><td>${esc(row.branch_name || row.branch_id)}</td><td><span class="admin-status">${esc(status.label)}</span></td><td>${esc(status.key === 'never_invited' ? 'Eligible after completion' : status.label)}</td><td>${esc(row.latest_sent_at ? dateTime(row.latest_sent_at) : '—')}</td><td><div class="admin-actions">${action}${hasReviewUrl ? ` <button class="btn btn--ghost btn--small" type="button" data-review-preview-id="${esc(String(row.id))}">Preview</button>` : ''}<div class="admin-actions" style="margin-top:.35rem;flex-wrap:wrap;">${reviewStateSelect(row)}</div></div></td></tr>`;
    })
    .join('')}</tbody></table></div>`;
}

async function loadReviewEligible(): Promise<void> {
  const branchId = document.querySelector<HTMLSelectElement>('[data-review-branch]')?.value ?? '';
  const q = document.querySelector<HTMLInputElement>('[data-review-search]')?.value.trim() ?? '';
  const params = new URLSearchParams({ view: 'eligible', branchId, q });
  const data = await api<{ appointments?: Array<Record<string, unknown>> }>(`/api/admin/reviews?${params.toString()}`);
  reviewEligibleRows = data.appointments ?? [];
  renderReviewEligible();
}

async function loadReviews(): Promise<void> {
  const branchId = document.querySelector<HTMLSelectElement>('[data-review-branch]')?.value ?? '';
  const status = document.querySelector<HTMLSelectElement>('[data-review-status]')?.value ?? '';
  const params = new URLSearchParams({ branchId, status });
  const data = await api<{ requests?: Array<Record<string, unknown>> }>(`/api/admin/reviews?${params.toString()}`);
  const target = document.querySelector<HTMLElement>('[data-admin-review-list]');
  if (!target) return;
  const requests = data.requests ?? [];
  target.innerHTML = requests.length
    ? `<div class="admin-table-scroll"><table class="admin-table"><thead><tr><th>Customer</th><th>Completed</th><th>Property</th><th>Branch</th><th>Status</th><th>Scheduled</th><th>Sent</th><th>Reason</th><th>Action</th></tr></thead><tbody>${requests
        .map((request) => {
          const customer = [request.first_name, request.last_name].filter(Boolean).join(' ') || 'Customer';
          const property = [request.line1, request.city].filter(Boolean).join(', ') || 'Property not linked';
          return `<tr><td>${esc(customer)}</td><td>${esc(request.appointment_start ? dateTime(request.appointment_start) : '—')}</td><td>${esc(property)}</td><td>${esc(request.branch_name || request.branch_id)}</td><td><span class="admin-status">${esc(titleCase(request.status))}</span></td><td>${esc(request.scheduled_at ? dateTime(request.scheduled_at) : '')}</td><td>${esc(request.sent_at ? dateTime(request.sent_at) : '')}</td><td>${esc(request.suppressed_reason || request.error_detail || '')}</td><td>${String(request.status) === 'queued' ? `<button class="btn btn--primary btn--small" type="button" data-review-action="send" data-id="${esc(request.id)}">Send now</button> ` : ''}${String(request.status) === 'failed' ? `<button class="btn btn--secondary btn--small" type="button" data-review-action="retry" data-id="${esc(request.id)}">Retry delivery</button> ` : ''}${['queued', 'failed'].includes(String(request.status)) ? `<button class="btn btn--ghost btn--small" type="button" data-review-action="cancel" data-id="${esc(request.id)}">Cancel</button>` : ''}</td></tr>`;
        })
        .join('')}</tbody></table></div>`
    : '<p class="admin-muted">No review requests match this filter.</p>';
  await loadReviewEligible();
}
async function loadFinance(): Promise<void> {
  const params = new URLSearchParams({
    status: financePage.status,
    q: financePage.q,
    limit: String(financePage.limit),
    offset: String(financePage.offset),
    sort: financePage.sort,
  });
  const data = await api<{
    invoices?: Array<Record<string, unknown>>;
    total?: number;
    limit?: number;
    offset?: number;
    summary?: Record<string, Record<string, number>>;
    services?: Array<Record<string, unknown>>;
  }>(`/api/admin/finance?${params.toString()}`);
  const summary = data.summary ?? {};
  for (const select of document.querySelectorAll<HTMLSelectElement>('[data-admin-invoice-services]')) {
    const current = select.value;
    const options = (data.services ?? [])
      .map(
        (service) =>
          `<option value="${esc(service.code)}">${esc(service.name)}${Number(service.taxable) === 1 ? '' : ' — tax exempt'}</option>`,
      )
      .join('');
    select.innerHTML = `<option value="">Choose a service</option>${options}<option value="move_in_out">Move-Out Cleaning</option><option value="move_in_out">Move-In Cleaning</option>`;
    if (current && (data.services ?? []).some((service) => service.code === current)) select.value = current;
  }
  const serviceDateInput = document.querySelector<HTMLInputElement>('[data-admin-invoice-create] input[name="serviceDate"]');
  if (serviceDateInput) serviceDateInput.max = localToday(0);
  renderPager(document.querySelector<HTMLElement>('[data-admin-invoices-pagination]'), data, 'invoices-page');
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

const invoiceSendInFlight = new Set<string>();
const invoiceSendKeys = new Map<string, string>();

async function sendInvoiceWithConfirmation(invoiceId: string, includePaymentLink: boolean): Promise<void> {
  if (invoiceSendInFlight.has(invoiceId)) return;
  setAppError();
  setSuccess();
  const data = await api<{ invoice?: Record<string, unknown> }>(
    `/api/admin/finance?id=${encodeURIComponent(invoiceId)}`,
  ).catch((error) => {
    setAppError(friendly(error));
    return null;
  });
  const invoice = data?.invoice;
  if (!invoice) return;
  const customerName = [invoice.first_name, invoice.last_name].filter(Boolean).join(' ') || 'Customer';
  const email = String(invoice.customer_email ?? '').trim();
  const number = String(invoice.number ?? '');
  const amount = money(invoice.balance_cents);
  const confirmed = await adminConfirm({
    title: 'Send this invoice?',
    body: `<dl class="admin-definition">
        <dt>Customer</dt><dd>${esc(customerName)}</dd>
        <dt>Recipient</dt><dd>${esc(email || 'No email on file')}</dd>
        <dt>Invoice</dt><dd>${esc(number)}</dd>
        <dt>Amount due</dt><dd>${esc(amount)}</dd>
        <dt>Secure payment link</dt><dd>${includePaymentLink ? 'Included in this email' : 'Not included - PDF only'}</dd>
      </dl><p>${includePaymentLink ? 'The customer will receive a secure payment page with an optional gratuity defaulting to $0.00. No payment is taken by sending this invoice.' : 'The customer will receive the invoice PDF only.'}</p>`,
    confirmLabel: includePaymentLink ? 'Confirm & Send Invoice' : 'Confirm & Send PDF',
  });
  if (!confirmed) return;
  invoiceSendInFlight.add(invoiceId);
  const idempotencyKey =
    invoiceSendKeys.get(invoiceId) ||
    `invoice-email-${invoiceId}-${crypto.randomUUID()}`;
  invoiceSendKeys.set(invoiceId, idempotencyKey);
  try {
    const result = await api<{ status?: string }>('/api/admin/finance', {
      method: 'POST',
      body: JSON.stringify({ action: 'email_invoice', invoiceId, includePaymentLink, idempotencyKey }),
    });
    invoiceSendKeys.delete(invoiceId);
    setSuccess(
      includePaymentLink
        ? `Invoice ${number} sent to ${email || 'the customer'} with its secure payment link.`
        : `Invoice ${number} sent to ${email || 'the customer'} with its PDF attached.`,
    );
    if (result.status && result.status !== 'sent') {
      setAppError('The email provider did not confirm delivery. Review the invoice communication history.');
    }
  } catch (error) {
    setAppError(friendly(error));
  } finally {
    invoiceSendInFlight.delete(invoiceId);
  }
}

async function openInvoice(invoiceId: string): Promise<void> {
  const data = await api<Record<string, unknown>>(`/api/admin/finance?id=${encodeURIComponent(invoiceId)}`);
  const target = document.querySelector<HTMLElement>('[data-admin-invoice-detail]');
  if (!target) return;
  const invoice = data.invoice as Record<string, unknown>;
  const lines = (data.lines as Array<Record<string, unknown>>) ?? [];
  const payments = (data.payments as Array<Record<string, unknown>>) ?? [];
  const receipts = (data.receipts as Array<Record<string, unknown>>) ?? [];
  const tips = (data.tips ?? {}) as {
    payments?: Array<Record<string, unknown>>;
    allocations?: Array<Record<string, unknown>>;
    summary?: {
      collectedCents?: number;
      refundedCents?: number;
      allocatedCents?: number;
      unallocatedCents?: number;
      paidOutCents?: number;
    };
  };
  const tipPayments = tips.payments ?? [];
  const tipAllocations = tips.allocations ?? [];
  const tipSummary = tips.summary ?? {};
  const unallocatedTipPayments = tipPayments.filter((payment) =>
    tipAllocations.some(
      (allocation) => allocation.payment_id === payment.id && !allocation.team_member_id &&
        Number(allocation.amount_cents) > Number(allocation.refunded_cents),
    ),
  );
  const teamForTips = unallocatedTipPayments.length > 0 && can('finance.write')
    ? await api<{ team?: Array<Record<string, unknown>> }>('/api/admin/operations?view=team')
        .then((result) => result.team ?? [])
        .catch(() => [])
    : [];
  const tipSection = `<h3>Optional gratuities</h3>${
    tipPayments.length
      ? `<dl class="admin-definition"><dt>Collected</dt><dd>${esc(money(tipSummary.collectedCents ?? 0))}</dd><dt>Allocated</dt><dd>${esc(money(tipSummary.allocatedCents ?? 0))}</dd><dt>Unallocated</dt><dd>${esc(money(tipSummary.unallocatedCents ?? 0))}</dd><dt>Refunded</dt><dd>${esc(money(tipSummary.refundedCents ?? 0))}</dd><dt>Recorded paid out</dt><dd>${esc(money(tipSummary.paidOutCents ?? 0))}</dd></dl>
         ${tipPayments.map((payment) => `<div class="admin-record"><p><strong>${esc(money(payment.tip_cents))} gratuity</strong> · service ${esc(money(payment.service_cents))} · ${esc(titleCase(payment.status))}</p><p class="admin-muted">Collected ${esc(dateTime(payment.received_at))}${payment.stripe_payment_intent_id ? ` · ${esc(payment.stripe_payment_intent_id)}` : ''}</p>${
           unallocatedTipPayments.some((entry) => entry.id === payment.id) && can('finance.write')
             ? `<form class="admin-form" data-form="tip-allocate"><input type="hidden" name="invoiceId" value="${esc(invoiceId)}" /><input type="hidden" name="paymentId" value="${esc(payment.id)}" /><p class="admin-muted">Actual crew participation is not recorded, so this gratuity is unallocated. Select only the cleaners who performed the service.</p><div class="admin-form admin-form--grid">${teamForTips.map((member) => `<label><input type="checkbox" name="teamMemberIds" value="${esc(member.id)}" /> ${esc(member.display_name)}</label>`).join('')}</div><button class="btn btn--secondary btn--small" type="submit">Confirm participating cleaners</button></form>`
             : ''
         }</div>`).join('')}
         ${tipAllocations.length ? `<div class="admin-table-scroll"><table class="admin-table"><thead><tr><th>Cleaner</th><th>Allocated</th><th>Refunded</th><th>Status</th></tr></thead><tbody>${tipAllocations.map((allocation) => `<tr><td>${esc(allocation.team_member_name || 'Unallocated')}</td><td>${esc(money(allocation.amount_cents))}</td><td>${esc(money(allocation.refunded_cents))}</td><td>${esc(titleCase(allocation.status))}</td></tr>`).join('')}</tbody></table></div>` : ''}`
      : '<p class="admin-muted">No optional gratuity has been collected for this invoice. Tips are never required or added automatically.</p>'
  }`;
  target.innerHTML = `<div class="admin-card"><div class="admin-detail-head"><h2 class="admin-section-title">${esc(invoice.number)}</h2><span class="admin-status">${esc(titleCase(invoice.status))}</span></div><dl class="admin-definition"><dt>Customer</dt><dd>${esc([invoice.first_name, invoice.last_name].filter(Boolean).join(' '))}</dd><dt>Email</dt><dd>${esc(invoice.customer_email || 'Not recorded')}</dd><dt>Service</dt><dd>${esc(invoice.service_name || invoice.service_code || 'Not recorded')}</dd><dt>Service date</dt><dd>${esc(invoice.service_date ? dateTime(`${String(invoice.service_date)}T12:00:00Z`) : 'Not recorded')}</dd><dt>Total</dt><dd>${esc(money(invoice.total_cents))}</dd><dt>Paid</dt><dd>${esc(money(invoice.amount_paid_cents))}</dd><dt>Balance</dt><dd>${esc(money(invoice.balance_cents))}</dd><dt>Due</dt><dd>${esc(dateTime(invoice.due_date))}</dd></dl><h3>Lines</h3>${lines.map((line) => `<div class="admin-record">${esc(line.description)} · ${esc(money(line.total_cents))}</div>`).join('') || '<p class="admin-muted">No lines.</p>'}<h3>Payments</h3>${payments.map((payment) => `<div class="admin-record">${esc(titleCase(payment.provider))} · ${esc(money(payment.amount_cents))} · ${esc(payment.status)} · ${esc(dateTime(payment.created_at))}<details class="admin-detail-toggle"><summary>Record refund</summary><form class="admin-form" data-form="refund"><input type="hidden" name="paymentId" value="${esc(payment.id)}" /><input type="hidden" name="idempotencyKey" value="${esc(crypto.randomUUID())}" /><label>Refund amount <input name="amount" type="number" min="0.01" step="0.01" required /></label><label>Reason <input name="reason" /></label><button class="btn btn--secondary btn--small" type="submit">Record refund</button></form></details></div>`).join('') || '<p class="admin-muted">No payments.</p>'}${tipSection}${Number(invoice.balance_cents) > 0 ? `<form class="admin-form" data-form="payment"><input type="hidden" name="invoiceId" value="${esc(invoiceId)}" /><input type="hidden" name="idempotencyKey" value="${esc(crypto.randomUUID())}" /><label>Payment method <select name="provider"><option value="cash">Cash</option><option value="check">Check</option><option value="external">External</option></select></label><label>Amount <input name="amount" type="number" min="0.01" step="0.01" value="${(Number(invoice.balance_cents) / 100).toFixed(2)}" required /></label><label>Reference <input name="reference" /></label><button class="btn btn--primary btn--small" type="submit">Record payment</button></form>` : ''}<form class="admin-form" data-form="credit"><input type="hidden" name="customerId" value="${esc(invoice.customer_id)}" /><label>Customer credit amount <input name="amount" type="number" min="0.01" step="0.01" required /></label><label>Reason <input name="source" /></label><button class="btn btn--secondary btn--small" type="submit">Add credit</button></form></div>`;
  const controls = document.querySelector<HTMLElement>('[data-admin-invoice-controls]');
  if (controls) {
    controls.innerHTML = `<a class="btn btn--secondary btn--small" href="/api/admin/invoice-document?id=${encodeURIComponent(invoiceId)}">Download invoice PDF</a>` +
      (can('finance.write') ? `<button class="btn btn--secondary btn--small" type="button" data-admin-action="customer-billing-portal" data-id="${esc(invoice.customer_id)}">Open secure billing portal</button>` : '');
    if (String(invoice.status) === 'paid' && can('finance.write')) {
      const latestReceipt = receipts[0];
      controls.insertAdjacentHTML(
        'beforeend',
        `<p class="admin-muted">Payment receipt: ${esc(latestReceipt ? `${titleCase(latestReceipt.status)} · ${dateTime(latestReceipt.sent_at || latestReceipt.updated_at)}` : 'not sent')}</p><button class="btn btn--secondary btn--small" type="button" data-admin-action="invoice-receipt-resend" data-id="${esc(invoiceId)}">Resend payment receipt</button><button class="btn btn--ghost btn--small" type="button" data-admin-action="invoice-tip-link" data-id="${esc(invoiceId)}">Create optional tip link</button>`,
      );
    }
    if (
      can('finance.write') &&
      invoice.customer_email &&
      Number(invoice.balance_cents) > 0 &&
      ['open', 'partially_paid', 'overdue'].includes(String(invoice.status))
    ) {
      controls.insertAdjacentHTML(
        'beforeend',
        `<button class="btn btn--secondary btn--small" type="button" data-admin-action="invoice-email-preview" data-id="${esc(invoiceId)}">Preview invoice email</button>`,
      );
      controls.insertAdjacentHTML(
        'beforeend',
        `<button class="btn btn--primary btn--small" type="button" data-admin-action="invoice-email-link" data-id="${esc(invoiceId)}">Email Invoice + Payment Link</button>`,
      );
      controls.insertAdjacentHTML(
        'beforeend',
        `<button class="btn btn--secondary btn--small" type="button" data-admin-action="invoice-email" data-id="${esc(invoiceId)}">Email invoice PDF only</button>`,
      );
    }
    if (can('finance.write') && !invoice.payment_url && Number(invoice.balance_cents) > 0) {
      controls.insertAdjacentHTML(
        'beforeend',
        `<button class="btn btn--secondary btn--small" type="button" data-admin-action="invoice-link" data-id="${esc(invoiceId)}">Create secure payment page</button>`,
      );
    }
    if (invoice.payment_url) {
      controls.insertAdjacentHTML(
        'beforeend',
        `<p><a class="btn btn--secondary btn--small" href="${esc(invoice.payment_url)}" target="_blank" rel="noopener noreferrer">Open secure payment page</a></p>`,
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
  const financial = (report.financial ?? {}) as Record<string, number>;
  target.innerHTML = `<div class="admin-grid">${[
    ['Active customers', customers?.active ?? 0],
    ['Archived customers', customers?.archived ?? 0],
    ['Leads', sum(report.leads)],
    ['Jobs', sum(report.appointments)],
    ['Recurring plans', sum(report.recurring)],
    ['Invoices', sum(report.invoices)],
  ].map(([label, value]) => `<div class="admin-card admin-kpi"><p class="admin-kpi__label">${esc(label)}</p><p class="admin-kpi__value">${esc(value)}</p></div>`).join('')}</div>
  <div class="admin-card" style="margin-top:1rem;"><h2 class="admin-section-title">Revenue, by actual stage</h2>
    <p class="admin-muted">Quoted work is not cash. Invoiced work is not collected. Each figure below is a separate accounting fact.</p>
    <div class="admin-grid">${[
      ['Open quoted estimates', money(financial.quotedCents)],
      ['Invoiced (non-void)', money(financial.invoicedCents)],
      ['Collected payments', money(financial.collectedCents)],
      ['Outstanding balances', money(financial.outstandingCents)],
      ['Discounts on invoices', money(financial.discountCents)],
      ['Refunded', money(financial.refundedCents)],
      ['Net collected', money(financial.netCollectedCents)],
      ['Recurring monthly value', money(financial.recurringMonthlyCents)],
    ].map(([label, value]) => `<div class="admin-card admin-kpi"><p class="admin-kpi__label">${esc(label)}</p><p class="admin-kpi__value">${esc(value)}</p></div>`).join('')}</div>
  </div>
  <div class="admin-card" style="margin-top:1rem;"><h2 class="admin-section-title">Monthly collected revenue</h2><div data-admin-report-monthly></div></div><div class="admin-card" style="margin-top:1rem;"><h2 class="admin-section-title">Gift activity</h2><div class="admin-grid">${giftData.configured ? [['Issued', giftSummary.issuedCount ?? 0], ['Active', giftSummary.activeCount ?? 0], ['Outstanding', money(giftSummary.outstandingCents)], ['Redeemed', money(giftSummary.redeemedCents)]].map(([label, value]) => `<div class="admin-card admin-kpi"><p class="admin-kpi__label">${esc(label)}</p><p class="admin-kpi__value">${esc(value)}</p></div>`).join('') : '<p class="admin-muted">Gift storage is not configured.</p>'}</div></div><div class="admin-card" style="margin-top:1rem;"><h2 class="admin-section-title">Payment mix</h2><div data-admin-report-payments></div></div>`;
  const monthly = target.querySelector<HTMLElement>('[data-admin-report-monthly]');
  if (monthly) renderTable(monthly, ['Month', 'Payments', 'Collected'], ((report.monthly as Array<Record<string, unknown>>) ?? []).map((row) => [esc(row.month), esc(row.payment_count), esc(money(row.payment_cents))]), 'No payment history yet.');
  const payments = target.querySelector<HTMLElement>('[data-admin-report-payments]');
  if (payments) renderTable(payments, ['Provider', 'Status', 'Count', 'Total'], ((report.payments as Array<Record<string, unknown>>) ?? []).map((row) => [esc(titleCase(row.provider)), esc(row.status), esc(row.count), esc(money(row.total_cents))]), 'No payment history yet.');
}

interface CommunicationSettingsShape {
  schemaVersion: number;
  departments: Record<string, { address: string; enabled: boolean }>;
  routing: Record<string, string[]>;
  replyTo: Record<string, string>;
  templates: Record<string, { subject: string; body: string; enabled: boolean }>;
  alerts: { escalationMinutes: number; failureThreshold: number };
}

interface CommunicationMetadataShape {
  departments: Array<{ key: string; label: string }>;
  events: Array<{ key: string; label: string; critical: boolean; defaults: string[]; description: string }>;
  replyTo: Array<{ key: string; label: string }>;
  templates: Array<{ key: string; label?: string; variables?: readonly string[] }>;
}

interface CommunicationsPayload {
  settings?: CommunicationSettingsShape;
  source?: string;
  valid?: boolean;
  errors?: string[];
  versions?: Array<Record<string, unknown>>;
  health?: {
    summary?: Record<string, number>;
    recent?: Array<Record<string, unknown>>;
    leadFailures?: Array<Record<string, unknown>>;
    bookingFailures?: Array<Record<string, unknown>>;
    receiptFailures?: Array<Record<string, unknown>>;
    note?: string;
  };
  provider?: Record<string, unknown>;
  metadata?: CommunicationMetadataShape;
}

let communicationsPayload: CommunicationsPayload | null = null;
let communicationsActiveTemplate = 'booking_confirmation';

function communicationDepartmentOptions(selected: string): string {
  const departments = communicationsPayload?.metadata?.departments ?? [];
  return departments.map((department) => `<option value="${esc(department.key)}"${department.key === selected ? ' selected' : ''}>${esc(department.label)}</option>`).join('');
}

function populateCommunicationForm(): void {
  const payload = communicationsPayload;
  const settings = payload?.settings;
  if (!settings || !payload.metadata) return;
  const routingTarget = document.querySelector<HTMLElement>('[data-communications-routing]');
  if (routingTarget) {
    routingTarget.innerHTML = payload.metadata.events.map((event) => {
      const selected = settings.routing[event.key] ?? [];
      const options = payload.metadata!.departments.map((department) => {
        const checked = selected.includes(department.key);
        return `<label style="display:inline-flex;align-items:center;gap:.35rem;margin-right:1rem;"><input type="checkbox" data-communication-route="${esc(event.key)}" value="${esc(department.key)}"${checked ? ' checked' : ''}${event.critical ? ' disabled' : ''} /> ${esc(department.label)}</label>`;
      }).join('');
      return `<div class="admin-record"><p><strong>${esc(event.label)}</strong>${event.critical ? ' <span class="admin-status">Critical</span>' : ''}</p><p class="admin-muted">${esc(event.description)}</p><div>${options}</div>${event.critical ? '<p class="admin-muted">Admin and Owner are required and cannot be changed.</p>' : ''}</div>`;
    }).join('');
  }
  const replyTarget = document.querySelector<HTMLElement>('[data-communications-reply-to]');
  if (replyTarget) {
    replyTarget.innerHTML = payload.metadata.replyTo.map((entry) => `<label>${esc(entry.label)} <select data-communication-reply-to="${esc(entry.key)}">${communicationDepartmentOptions(settings.replyTo[entry.key] ?? '')}</select></label>`).join('');
  }
  const templateSelect = document.querySelector<HTMLSelectElement>('[data-communications-template-select]');
  if (templateSelect) {
    templateSelect.innerHTML = payload.metadata.templates.map((template) => `<option value="${esc(template.key)}"${template.key === communicationsActiveTemplate ? ' selected' : ''}>${esc(template.label ?? titleCase(template.key.replaceAll('_', ' ')))}</option>`).join('');
  }
  loadCommunicationTemplateEditor();
  const escalation = document.querySelector<HTMLInputElement>('[data-communications-escalation]');
  if (escalation) escalation.value = String(settings.alerts.escalationMinutes);
  const threshold = document.querySelector<HTMLInputElement>('[data-communications-threshold]');
  if (threshold) threshold.value = String(settings.alerts.failureThreshold);
  const testSelect = document.querySelector<HTMLSelectElement>('[data-communications-test-department]');
  if (testSelect) {
    const previous = testSelect.value;
    testSelect.innerHTML = payload.metadata.departments.map((department) => `<option value="${esc(department.key)}">${esc(department.label)} - ${esc(settings.departments[department.key]?.address ?? '')}</option>`).join('');
    if (previous) testSelect.value = previous;
  }
}

function communicationTemplateMeta(): { key: string; label?: string; variables?: readonly string[] } | undefined {
  return communicationsPayload?.metadata?.templates.find((template) => template.key === communicationsActiveTemplate);
}

function communicationVariableLabel(variable: string): string {
  return titleCase(variable.replaceAll('_', ' '));
}

function communicationEditorHtml(body: string): string {
  return esc(body)
    .replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, variable: string) => `<span class="admin-email-token" contenteditable="false" data-email-variable="${esc(variable)}">${esc(communicationVariableLabel(variable))}</span>`)
    .replace(/\n/g, '<br>');
}

function serializeCommunicationEditor(root: HTMLElement): string {
  let output = '';
  const walk = (node: Node): void => {
    if (node.nodeType === Node.TEXT_NODE) {
      output += node.nodeValue ?? '';
      return;
    }
    if (!(node instanceof HTMLElement)) return;
    const variable = node.dataset.emailVariable;
    if (variable) {
      output += `{{${variable}}}`;
      return;
    }
    if (node.tagName === 'BR') {
      output += '\n';
      return;
    }
    const block = node.tagName === 'DIV' || node.tagName === 'P';
    for (const child of Array.from(node.childNodes)) walk(child);
    if (block && !output.endsWith('\n')) output += '\n';
  };
  for (const child of Array.from(root.childNodes)) walk(child);
  return output
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function insertCommunicationVariable(variable: string): void {
  const editor = document.querySelector<HTMLElement>('[data-communications-body]');
  if (!editor || !variable) return;
  const chip = document.createElement('span');
  chip.className = 'admin-email-token';
  chip.contentEditable = 'false';
  chip.dataset.emailVariable = variable;
  chip.textContent = communicationVariableLabel(variable);
  const space = document.createTextNode(' ');
  const selection = window.getSelection();
  editor.focus();
  if (selection && selection.rangeCount > 0 && editor.contains(selection.anchorNode)) {
    const range = selection.getRangeAt(0);
    range.deleteContents();
    range.insertNode(space);
    range.insertNode(chip);
    range.setStartAfter(space);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
    return;
  }
  editor.append(chip, space);
}

function communicationErrorText(raw: string): string {
  const separator = raw.indexOf(':');
  const scope = separator > 0 ? raw.slice(0, separator) : '';
  const message = (separator > 0 ? raw.slice(separator + 1) : raw).trim();
  let scopeLabel = '';
  if (scope.startsWith('routing.')) {
    const key = scope.slice('routing.'.length);
    scopeLabel = communicationsPayload?.metadata?.events.find((event) => event.key === key)?.label ?? 'Notification routing';
  } else if (scope.startsWith('departments.')) {
    scopeLabel = 'Department address';
  } else if (scope.startsWith('replyTo.')) {
    scopeLabel = 'Reply-to department';
  } else if (scope.startsWith('alerts.')) {
    scopeLabel = 'Alert thresholds';
  } else if (scope) {
    scopeLabel = communicationsPayload?.metadata?.templates.find((template) => template.key === scope)?.label ?? titleCase(scope.replaceAll('_', ' '));
  }
  const readable = message
    .replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, variable: string) => `“${communicationVariableLabel(variable)}”`)
    .replace(/\bvariable\b/g, 'field');
  return scopeLabel ? `${scopeLabel}: ${readable}` : readable;
}

function renderCommunicationErrors(errors: HTMLElement | null, error: unknown): void {
  if (!errors) return;
  const details = (error as Error & { details?: string[] }).details ?? [];
  errors.innerHTML = `<p>${esc(friendly(error))}</p>${details.length ? `<ul>${details.slice(0, 12).map((detail) => `<li>${esc(communicationErrorText(detail))}</li>`).join('')}</ul>` : ''}`;
}

function loadCommunicationTemplateEditor(): void {
  const settings = communicationsPayload?.settings;
  if (!settings) return;
  const meta = communicationTemplateMeta();
  const template = settings.templates[communicationsActiveTemplate];
  const subject = document.querySelector<HTMLElement>('[data-communications-subject]');
  const body = document.querySelector<HTMLElement>('[data-communications-body]');
  if (subject) subject.innerHTML = communicationEditorHtml(template?.subject ?? '').replace(/<br>/g, ' ');
  if (body) body.innerHTML = communicationEditorHtml(template?.body ?? '');
  const variables = meta?.variables ?? [];
  const variableSelect = document.querySelector<HTMLSelectElement>('[data-communications-variable-select]');
  if (variableSelect) {
    variableSelect.innerHTML = variables.length
      ? variables.map((variable) => `<option value="${esc(variable)}">${esc(communicationVariableLabel(variable))}</option>`).join('')
      : '<option value="">No automatic fields for this email</option>';
  }
  const guide = document.querySelector<HTMLElement>('[data-communications-template-guide]');
  if (guide) {
    guide.innerHTML = `<p><strong>${esc(meta?.label ?? titleCase(communicationsActiveTemplate.replaceAll('_', ' ')))}</strong></p><p class="admin-muted">${variables.length ? 'The labeled fields below fill automatically from the customer and job record. Place them wherever they belong in the message.' : 'This email uses fixed wording and no automatic fields.'}</p>${variables.length ? `<p>${variables.map((variable) => `<span class="admin-email-token">${esc(communicationVariableLabel(variable))}</span>`).join(' ')}</p>` : ''}`;
  }
  const preview = document.querySelector<HTMLElement>('[data-communications-preview]');
  if (preview) preview.innerHTML = '';
}

function readCommunicationSettingsFromForm(): CommunicationSettingsShape | null {
  const payload = communicationsPayload;
  if (!payload?.settings) return null;
  const settings: CommunicationSettingsShape = {
    schemaVersion: payload.settings.schemaVersion,
    departments: payload.settings.departments,
    routing: { ...payload.settings.routing },
    replyTo: { ...payload.settings.replyTo },
    templates: { ...payload.settings.templates },
    alerts: { ...payload.settings.alerts },
  };
  for (const checkbox of document.querySelectorAll<HTMLInputElement>('[data-communication-route]')) {
    const eventKey = checkbox.dataset.communicationRoute ?? '';
    if (!eventKey) continue;
    const current = new Set(settings.routing[eventKey] ?? []);
    if (checkbox.checked) current.add(checkbox.value); else current.delete(checkbox.value);
    settings.routing[eventKey] = [...current];
  }
  for (const select of document.querySelectorAll<HTMLSelectElement>('[data-communication-reply-to]')) {
    const key = select.dataset.communicationReplyTo ?? '';
    if (key) settings.replyTo[key] = select.value;
  }
  const subject = document.querySelector<HTMLElement>('[data-communications-subject]');
  const body = document.querySelector<HTMLElement>('[data-communications-body]');
  if (settings.templates[communicationsActiveTemplate]) {
    settings.templates[communicationsActiveTemplate] = {
      ...settings.templates[communicationsActiveTemplate]!,
      subject: subject ? serializeCommunicationEditor(subject).replace(/\n/g, ' ') : '',
      body: body ? serializeCommunicationEditor(body) : '',
    };
  }
  const escalation = document.querySelector<HTMLInputElement>('[data-communications-escalation]');
  const threshold = document.querySelector<HTMLInputElement>('[data-communications-threshold]');
  if (escalation) settings.alerts.escalationMinutes = Number(escalation.value);
  if (threshold) settings.alerts.failureThreshold = Number(threshold.value);
  return settings;
}

function renderCommunicationHealth(payload: CommunicationsPayload): void {
  const providerTarget = document.querySelector<HTMLElement>('[data-admin-communications-provider]');
  if (providerTarget) {
    const provider = payload.provider ?? {};
    providerTarget.innerHTML = `<div class="admin-table-scroll"><table class="admin-table"><tbody>${[
      ['Provider', provider.provider ?? 'resend'],
      ['Resend API key configured', provider.resendConfigured ? 'Yes' : 'No'],
      ['Sender address configured', provider.senderConfigured ? 'Yes' : 'No'],
      ['Reply-to configured', provider.replyToConfigured ? 'Yes' : 'No'],
      ['Sending domain', provider.domain ?? 'sparkling-standard.com'],
    ].map(([label, value]) => `<tr><th>${esc(label)}</th><td>${esc(value)}</td></tr>`).join('')}</tbody></table></div><p class="admin-muted">${esc(provider.note ?? '')}</p>`;
  }
  const healthTarget = document.querySelector<HTMLElement>('[data-admin-communications-health]');
  if (healthTarget) {
    const health = payload.health ?? {};
    const summary = health.summary ?? {};
    healthTarget.innerHTML = `<div class="admin-grid">${Object.entries(summary).map(([status, count]) => `<div class="admin-card admin-kpi"><p class="admin-kpi__label">${esc(titleCase(status))}</p><p class="admin-kpi__value">${esc(count)}</p></div>`).join('') || '<p class="admin-muted">No recorded delivery events yet.</p>'}</div>` +
      ((health.recent ?? []).length ? `<div class="admin-table-scroll" style="margin-top:1rem;"><table class="admin-table"><thead><tr><th>When</th><th>Event</th><th>Department</th><th>Recipient</th><th>Status</th><th>Detail</th></tr></thead><tbody>${(health.recent ?? []).map((event) => `<tr><td>${esc(dateTime(event.created_at))}</td><td>${esc(event.event_key)}</td><td>${esc(event.department)}</td><td>${esc(event.recipient)}</td><td>${esc(titleCase(event.status))}</td><td>${esc(event.error_code || '-')}</td></tr>`).join('')}</tbody></table></div>` : '') +
      `<p class="admin-muted">${esc(health.note ?? '')}</p>`;
  }
  const failureTarget = document.querySelector<HTMLElement>('[data-admin-communications-failures]');
  if (failureTarget) {
    const failures: Array<[string, Array<Record<string, unknown>>]> = [
      ['Lead notifications', payload.health?.leadFailures ?? []],
      ['Booking notifications', payload.health?.bookingFailures ?? []],
      ['Payment receipts', payload.health?.receiptFailures ?? []],
    ];
    failureTarget.innerHTML = failures.map(([label, rows]) => `<h3 style="font-size:.95rem;">${esc(label)} (${rows.length})</h3>${rows.length ? `<div class="admin-table-scroll"><table class="admin-table"><thead><tr><th>Record</th><th>Status</th><th>Detail</th><th>When</th></tr></thead><tbody>${rows.map((row) => `<tr><td>${esc(row.quote_reference || row.invoice_id || row.id)}</td><td>${esc(row.status || row.delivery_status)}</td><td>${esc(row.last_delivery_error || row.error_detail || row.error_code)}</td><td>${esc(dateTime(row.created_at))}</td></tr>`).join('')}</tbody></table></div>` : '<p class="admin-muted">None recorded.</p>'}`).join('');
  }
}

async function loadCommunications(): Promise<void> {
  const data = await api<CommunicationsPayload>('/api/admin/communications');
  communicationsPayload = data;
  const status = document.querySelector<HTMLElement>('[data-admin-communications-status]');
  if (status) {
    const stored = data.source === 'stored';
    status.innerHTML = `<p>${stored ? 'Saved configuration is active.' : 'Approved defaults are active; no saved configuration exists yet.'}${data.valid === false ? ' <strong>The stored configuration is invalid and defaults are being used until corrected.</strong>' : ''}</p>` +
      (data.valid === false && data.errors?.length ? `<ul class="admin-muted">${data.errors.map((error) => `<li>${esc(error)}</li>`).join('')}</ul>` : '');
  }
  renderCommunicationHealth(data);
  populateCommunicationForm();
  const versionsTarget = document.querySelector<HTMLElement>('[data-communications-versions]');
  if (versionsTarget) {
    const versions = data.versions ?? [];
    versionsTarget.innerHTML = versions.length
      ? `<div class="admin-table-scroll"><table class="admin-table"><thead><tr><th>Version</th><th>Saved</th><th>By</th><th>Change note</th></tr></thead><tbody>${versions.map((version) => `<tr><td>${esc(version.version)}</td><td>${esc(dateTime(version.created_at))}</td><td>${esc(version.created_by || 'system')}</td><td>${esc(version.change_note || '-')}</td></tr>`).join('')}</tbody></table></div>`
      : '<p class="admin-muted">No configuration versions have been saved yet.</p>';
  }
}

document.querySelector<HTMLSelectElement>('[data-communications-template-select]')?.addEventListener('change', (event) => {
  communicationsActiveTemplate = (event.target as HTMLSelectElement).value;
  loadCommunicationTemplateEditor();
});

document.querySelector<HTMLElement>('[data-admin-view="communications"]')?.addEventListener('click', (event) => {
  const action = (event.target as HTMLElement).closest<HTMLElement>('[data-admin-action]')?.dataset.adminAction;
  if (action === 'communications-insert-variable') {
    const variable = document.querySelector<HTMLSelectElement>('[data-communications-variable-select]')?.value ?? '';
    insertCommunicationVariable(variable);
  }
  if (action === 'communications-approved-wording') {
    const status = document.querySelector<HTMLElement>('[data-communications-form-status]');
    void api<{ settings?: CommunicationSettingsShape }>('/api/admin/communications?view=defaults')
      .then((defaults) => {
        const template = defaults.settings?.templates[communicationsActiveTemplate];
        if (!template) throw new Error('template_key_invalid');
        const subject = document.querySelector<HTMLElement>('[data-communications-subject]');
        const body = document.querySelector<HTMLElement>('[data-communications-body]');
        if (subject) subject.innerHTML = communicationEditorHtml(template.subject).replace(/<br>/g, ' ');
        if (body) body.innerHTML = communicationEditorHtml(template.body);
        if (status) status.textContent = 'Approved wording loaded. Save configuration to apply it.';
      })
      .catch((error) => {
        if (status) status.textContent = friendly(error);
      });
  }
  if (action === 'communications-preview') {
    const settings = readCommunicationSettingsFromForm();
    if (!settings) return;
    const target = document.querySelector<HTMLElement>('[data-communications-preview]');
    void api<{ preview?: { subject?: string; body?: string }; details?: string[] }>('/api/admin/communications', {
      method: 'POST',
      body: JSON.stringify({ action: 'preview', templateKey: communicationsActiveTemplate, settings }),
    }).then((result) => {
      if (target) target.innerHTML = `<div class="admin-record"><p><strong>${esc(result.preview?.subject ?? '')}</strong></p><pre style="white-space:pre-wrap">${esc(result.preview?.body ?? '')}</pre></div>`;
    }).catch((error) => {
      if (target) target.innerHTML = `<p class="admin-error">${esc(friendly(error))}</p>${(error as Error & { details?: string[] }).details?.length ? `<ul>${(error as Error & { details?: string[] }).details!.slice(0, 8).map((detail) => `<li>${esc(communicationErrorText(detail))}</li>`).join('')}</ul>` : ''}`;
    });
  }
  if (action === 'communications-reset') {
    void loadCommunications().catch((error) => setAppError(friendly(error)));
  }
  if (action === 'communications-test') {
    const select = document.querySelector<HTMLSelectElement>('[data-communications-test-department]');
    const department = select?.value ?? '';
    const label = select?.selectedOptions[0]?.textContent ?? department;
    void adminConfirm({
      title: 'Send a test email?',
      body: `<p>This sends a clearly marked test message with no customer data to <strong>${esc(label)}</strong>.</p><p>Only continue when you can check that mailbox. Provider acceptance is not proof that the message reached the inbox.</p>`,
      confirmLabel: 'Send test email',
    }).then((confirmed) => {
      if (!confirmed) return;
      const target = document.querySelector<HTMLElement>('[data-communications-test-status]');
      if (target) target.textContent = 'Sending test message...';
      void api<{ status?: string; recipient?: string; error?: string }>('/api/admin/communications', {
        method: 'POST',
        body: JSON.stringify({ action: 'send_test', department }),
      }).then((result) => {
        if (target) target.textContent = result.status === 'sent' ? `Provider accepted the test message for ${result.recipient ?? label}. Confirm it actually arrived in that inbox.` : `Test message status: ${result.status ?? 'unknown'}${result.error ? ` (${result.error})` : ''}.`;
        return loadCommunications();
      }).catch((error) => {
        if (target) target.textContent = friendly(error);
      });
    });
  }
});

document.addEventListener('submit', (event) => {
  const form = event.target as HTMLFormElement;
  if (!form.matches('[data-communications-form]')) return;
  event.preventDefault();
  const settings = readCommunicationSettingsFromForm();
  if (!settings) return;
  const note = document.querySelector<HTMLInputElement>('[data-communications-note]')?.value ?? '';
  const status = document.querySelector<HTMLElement>('[data-communications-form-status]');
  const errors = document.querySelector<HTMLElement>('[data-communications-errors]');
  if (errors) errors.textContent = '';
  if (status) status.textContent = 'Saving...';
  void api<{ version?: number; details?: string[] }>('/api/admin/communications', {
    method: 'POST',
    body: JSON.stringify({ action: 'save', settings, note }),
  }).then((result) => {
    if (status) status.textContent = `Saved as version ${result.version ?? ''}.`;
    const noteInput = document.querySelector<HTMLInputElement>('[data-communications-note]');
    if (noteInput) noteInput.value = '';
    return loadCommunications();
  }).catch((error) => {
    if (status) status.textContent = 'The configuration was not saved. Correct the highlighted items below.';
    renderCommunicationErrors(errors, error);
  });
});

const auditPage = { limit: 50, offset: 0 };

async function loadSettings(): Promise<void> {
  const [admins, sessions, audit] = await Promise.all([
    can('admin.manage')
      ? api<{ admins?: Array<Record<string, unknown>> }>('/api/admin/accounts?view=admins')
      : Promise.resolve({ admins: [] }),
    api<{ sessions?: Array<Record<string, unknown>> }>('/api/admin/accounts?view=sessions'),
    can('admin.manage')
      ? api<{ audit?: Array<Record<string, unknown>>; total?: number; limit?: number; offset?: number }>(
          `/api/admin/accounts?view=audit&limit=${auditPage.limit}&offset=${auditPage.offset}`,
        )
      : Promise.resolve({ audit: [] as Array<Record<string, unknown>>, total: 0, limit: 50, offset: 0 }),
  ]);
  const mfaStatus = document.querySelector<HTMLElement>('[data-admin-view="settings"] [data-admin-mfa-status]');
  if (mfaStatus) {
    const method = actor?.mfaMethod === 'email' ? 'email' : 'totp';
    mfaStatus.innerHTML = actor?.mfaEnabled
      ? `<p><strong>Two-step verification is enabled (${method === 'email' ? 'email code' : 'authenticator app'}).</strong></p><details class="admin-detail-toggle"><summary>Disable two-step verification</summary><form class="admin-form" data-form="mfa-disable"><label>Password <input name="password" type="password" required /></label>${method === 'email' ? '<label>Recovery code <input name="recoveryCode" autocomplete="off" maxlength="40" required /></label>' : '<label>Current authenticator code <input name="code" inputmode="numeric" maxlength="6" required /></label>'}<button class="btn btn--secondary btn--small" type="submit">Disable</button></form></details>`
      : '<p>Two-step verification is not enabled.</p><p class="admin-muted">Email verification is recommended. We will send a six-digit code to your administrator email each time you sign in.</p><div class="admin-actions"><button class="btn btn--primary btn--small" type="button" data-admin-action="mfa-email-start">Set up email verification codes</button><button class="btn btn--ghost btn--small" type="button" data-admin-action="mfa-start">Set up authenticator app</button></div>';
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
  renderPager(document.querySelector<HTMLElement>('[data-admin-audit-pagination]'), audit, 'audit-page');
}

interface DocumentLibraryFamily {
  familyKey: string;
  title: string;
  category: string;
  approvedTemplateId: string | null;
  approvedVersionLabel: string | null;
  approvedSourceKind: string;
  approvedAt: string | null;
  legalReviewStatus: string;
  draftTemplateId: string | null;
  draftVersionLabel: string | null;
  draftUpdatedAt: string | null;
  draftCount: number;
  retiredCount: number;
  versionCount: number;
  packetCount: number;
  activePacketCount: number;
  packetNames: string[];
  archivedAt: string | null;
  state: 'active' | 'draft_only' | 'no_approved' | 'archived';
}

async function loadDocuments(): Promise<void> {
  const [libraryData, bundleData, requestData, reminderData] = await Promise.all([
    api<{ library?: { families?: DocumentLibraryFamily[]; drafts?: Array<Record<string, unknown>>; totals?: Record<string, number> } }>(
      '/api/admin/documents?view=library',
    ),
    api<{ bundles?: Array<Record<string, unknown>> }>('/api/admin/documents?view=bundles'),
    api<{ requests?: Array<Record<string, unknown>> }>('/api/admin/documents?view=requests'),
    actor?.role === 'owner'
      ? api<{ settings?: { enabled?: boolean; firstHours?: number; secondHours?: number } }>('/api/admin/documents?view=reminder-settings')
      : Promise.resolve({ settings: undefined }),
  ]);
  const families = libraryData.library?.families ?? [];
  const drafts = libraryData.library?.drafts ?? [];
  const bundles = bundleData.bundles ?? [];
  const requests = requestData.requests ?? [];
  const reminderForm = document.querySelector<HTMLFormElement>('[data-document-reminders]');
  if (reminderForm && reminderData.settings) {
    const enabled = reminderForm.querySelector<HTMLInputElement>('input[name="enabled"]');
    const first = reminderForm.querySelector<HTMLInputElement>('input[name="firstHours"]');
    const second = reminderForm.querySelector<HTMLInputElement>('input[name="secondHours"]');
    if (enabled) enabled.checked = reminderData.settings.enabled !== false;
    if (first) first.value = String(reminderData.settings.firstHours ?? 24);
    if (second) second.value = String(reminderData.settings.secondHours ?? 72);
  }
  const templateTarget = document.querySelector<HTMLElement>('[data-admin-documents-templates]');
  if (templateTarget) {
    const owner = actor?.role === 'owner';
    const activeFamilies = families.filter((family) => family.state === 'active');
    const draftOnlyFamilies = families.filter((family) => family.state === 'draft_only');
    const archivedFamilies = families.filter((family) => family.state === 'archived');
    const draftRows = drafts;
    templateTarget.innerHTML = `
      <div class="admin-actions" role="tablist" aria-label="Document library sections" style="margin:0 0 .6rem;">
        <button class="btn btn--secondary btn--small" type="button" role="tab" data-document-library-tab="active" aria-current="page">Current documents (${activeFamilies.length + draftOnlyFamilies.length})</button>
        <button class="btn btn--ghost btn--small" type="button" role="tab" data-document-library-tab="drafts">Drafts (${draftRows.length})</button>
        <button class="btn btn--ghost btn--small" type="button" role="tab" data-document-library-tab="archive">History &amp; archive (${archivedFamilies.length})</button>
      </div>
      <p class="admin-muted">One entry per document family shows the current approved version. Draft revisions and retired versions are kept out of the normal document selectors.</p>
      <section data-document-library-panel="active">
        <div data-document-library-active></div>
        ${draftOnlyFamilies.length ? `<h3 style="font-size:.95rem;margin:1.2rem 0 .5rem;">Awaiting first approval</h3><p class="admin-muted" style="margin:0 0 .5rem;">These documents cannot be sent or satisfy a requirement until an owner approves them.</p><div data-document-library-pending></div>` : ''}
      </section>
      <section data-document-library-panel="drafts" hidden>
        <h3 style="font-size:.95rem;margin:.3rem 0 .5rem;">Draft revisions</h3>
        <p class="admin-muted" style="margin:0 0 .5rem;">Editing an approved document creates a draft here. The published version stays live until Approve &amp; Publish moves packets to the new version.</p>
        <div data-document-library-drafts></div>
      </section>
      <section data-document-library-panel="archive" hidden>
        <h3 style="font-size:.95rem;margin:.3rem 0 .5rem;">History and archive</h3>
        <p class="admin-muted" style="margin:0 0 .5rem;">Retired versions and archived document families remain available for audit and executed-copy evidence. Archived families are hidden from the normal library and from packet selectors.</p>
        <div data-document-family-history></div>
        <div data-document-library-archive></div>
      </section>`;
    const activeTarget = templateTarget.querySelector<HTMLElement>('[data-document-library-active]');
    if (activeTarget) {
      renderTable(
        activeTarget,
        ['Document', 'Category', 'Current version', 'Approved', 'Working draft', 'Used in packets', 'Actions'],
        activeFamilies.map((family) => {
          const actions = [
            owner && family.approvedTemplateId && family.approvedSourceKind === 'text'
              ? `<button class="btn btn--secondary btn--small" type="button" data-admin-action="document-revise" data-id="${esc(family.approvedTemplateId)}">Edit &amp; revise</button>`
              : '',
            family.approvedTemplateId
              ? `<a class="btn btn--ghost btn--small" href="/api/admin/documents?view=template-download&id=${encodeURIComponent(String(family.approvedTemplateId))}">Download</a>`
              : '',
            `<button class="btn btn--ghost btn--small" type="button" data-admin-action="document-family-history" data-family="${esc(family.familyKey)}">History</button>`,
            owner
              ? `<button class="btn btn--ghost btn--small" type="button" data-admin-action="document-family-archive" data-family="${esc(family.familyKey)}"${family.activePacketCount > 0 ? ' disabled title="Remove this document from active packets before archiving it."' : ''}>Archive</button>`
              : '',
          ].filter(Boolean).join('');
          return [
            esc(family.title),
            esc(titleCase(family.category)),
            esc(family.approvedVersionLabel ?? '—'),
            esc(family.approvedAt ? dateTime(family.approvedAt) : '—'),
            family.draftCount > 0
              ? `<span class="admin-status">${esc(family.draftVersionLabel ?? 'Draft')} pending review</span>`
              : '<span class="admin-muted">None</span>',
            family.packetNames?.length
              ? esc(`${family.packetNames.join(', ')}${family.activePacketCount ? '' : ' (archived packet)'}`)
              : '<span class="admin-muted">Not in a packet</span>',
            `<div class="admin-actions">${actions}</div>`,
          ];
        }),
        'No approved documents are in the active library yet.',
      );
    }
    const pendingTarget = templateTarget.querySelector<HTMLElement>('[data-document-library-pending]');
    if (pendingTarget) {
      renderTable(
        pendingTarget,
        ['Document', 'Category', 'Draft', 'Last edited', 'Actions'],
        draftOnlyFamilies.map((family) => [
          esc(family.title),
          esc(titleCase(family.category)),
          esc(family.draftVersionLabel ?? 'Draft'),
          esc(dateTime(family.draftUpdatedAt ?? family.approvedAt ?? '')),
          `<div class="admin-actions">${family.draftTemplateId ? `<button class="btn btn--ghost btn--small" type="button" data-admin-action="document-edit" data-id="${esc(family.draftTemplateId)}">Open draft</button><button class="btn btn--ghost btn--small" type="button" data-admin-action="document-approve" data-id="${esc(family.draftTemplateId)}">Approve</button>` : ''}<button class="btn btn--ghost btn--small" type="button" data-admin-action="document-family-history" data-family="${esc(family.familyKey)}">History</button></div>`,
        ]),
        'No documents are awaiting approval.',
      );
    }
    const draftsTarget = templateTarget.querySelector<HTMLElement>('[data-document-library-drafts]');
    if (draftsTarget) {
      renderTable(
        draftsTarget,
        ['Document', 'Draft version', 'Based on', 'Last edited', 'Legal review', 'Actions'],
        draftRows.map((draft) => {
          const revision = Boolean(draft.supersedes_template_id);
          const actions = [
            `<button class="btn btn--secondary btn--small" type="button" data-admin-action="document-edit" data-id="${esc(draft.id)}">${revision ? 'Review &amp; publish' : 'Open draft'}</button>`,
            !revision ? `<button class="btn btn--ghost btn--small" type="button" data-admin-action="document-approve" data-id="${esc(draft.id)}">Approve</button>` : '',
            owner ? `<button class="btn btn--ghost btn--small" type="button" data-admin-action="document-delete-draft" data-id="${esc(draft.id)}">Delete draft</button>` : '',
          ].filter(Boolean).join('');
          return [
            esc(draft.title),
            esc(draft.version_label ?? draft.version),
            esc(draft.supersedes_version_label ?? 'First approved version'),
            esc(dateTime(draft.updated_at ?? draft.created_at ?? '')),
            esc(titleCase(draft.legal_review_status ?? 'not_reviewed')),
            `<div class="admin-actions">${actions}</div>`,
          ];
        }),
        'No draft revisions. Editing an approved document creates a draft here.',
      );
    }
    const archiveTarget = templateTarget.querySelector<HTMLElement>('[data-document-library-archive]');
    if (archiveTarget) {
      renderTable(
        archiveTarget,
        ['Document', 'Current approved', 'Versions', 'Retired', 'Library state', 'Actions'],
        families
          .filter((family) => family.state === 'archived' || family.retiredCount > 0)
          .map((family) => [
            esc(family.title),
            esc(family.approvedVersionLabel ?? 'None'),
            esc(String(family.versionCount)),
            esc(String(family.retiredCount)),
            family.state === 'archived'
              ? `<span class="admin-status">Archived ${esc(family.archivedAt ? dateTime(family.archivedAt) : '')}</span>`
              : '<span class="admin-muted">In library</span>',
            `<div class="admin-actions"><button class="btn btn--ghost btn--small" type="button" data-admin-action="document-family-history" data-family="${esc(family.familyKey)}">Versions</button>${owner && family.state === 'archived' ? `<button class="btn btn--ghost btn--small" type="button" data-admin-action="document-family-restore" data-family="${esc(family.familyKey)}">Restore family</button>` : ''}${owner && family.state !== 'archived' ? `<button class="btn btn--ghost btn--small" type="button" data-admin-action="document-family-archive" data-family="${esc(family.familyKey)}"${family.activePacketCount > 0 ? ' disabled title="Remove this document from active packets before archiving it."' : ''}>Archive</button>` : ''}</div>`,
          ]),
        'No retired versions or archived families.',
      );
    }
  }
  const bundleTarget = document.querySelector<HTMLElement>('[data-admin-documents-bundles]');
  if (bundleTarget) {
    const serviceBundles = bundles.filter((bundle) => Number(bundle.is_system) !== 1);
    const starterBundles = bundles.filter((bundle) => Number(bundle.is_system) === 1);
    const bundleRows = (rows: Array<Record<string, unknown>>) => rows.map((bundle) => {
      const approved = Number(bundle.approved_document_count ?? bundle.document_count ?? 0);
      const required = Number(bundle.required_document_count ?? 0);
      const ready = bundle.status === 'active' && approved > 0;
      return [
        esc(bundle.code),
        esc(bundle.name),
        esc(titleCase(bundle.purpose ?? bundle.subject_type)),
        esc(titleCase(bundle.packet_type ?? 'custom')),
        esc(`${approved} approved / ${required} required`),
        `<span class="admin-status">${esc(ready ? 'Ready' : bundle.status === 'inactive' ? 'Archived' : 'No approved documents')}</span>`,
        `<div class="admin-actions"><button class="btn btn--ghost btn--small" type="button" data-admin-action="document-bundle-open" data-id="${esc(bundle.id)}">Manage documents</button><button class="btn btn--ghost btn--small" type="button" data-admin-action="document-packet-preview" data-id="${esc(bundle.id)}">Preview</button>${actor?.role === 'owner' ? `<button class="btn btn--ghost btn--small" type="button" data-admin-action="document-packet-duplicate" data-id="${esc(bundle.id)}">Duplicate</button><button class="btn btn--ghost btn--small" type="button" data-admin-action="${bundle.status === 'active' ? 'document-packet-archive' : 'document-packet-restore'}" data-id="${esc(bundle.id)}">${bundle.status === 'active' ? 'Archive' : 'Restore'}</button>` : ''}</div>`,
      ];
    });
    bundleTarget.innerHTML = `
      <h3 style="font-size:.95rem;margin:.3rem 0 .5rem;">Service packets</h3>
      <p class="admin-muted" style="margin:0 0 .5rem;">Only an active packet with at least one owner-approved document can be sent or satisfy a gate.</p>
      <div data-bundle-service></div>
      <h3 style="font-size:.95rem;margin:1.2rem 0 .5rem;">Packet starters</h3>
      <p class="admin-muted" style="margin:0 0 .5rem;">Reusable starters from the approved packet library. They remain visibly empty until approved documents are added, and they cannot be sent while empty.</p>
      <div data-bundle-starters></div>`;
    const serviceTarget = bundleTarget.querySelector<HTMLElement>('[data-bundle-service]');
    if (serviceTarget) {
      renderTable(
        serviceTarget,
        ['Code', 'Name', 'Purpose', 'Type', 'Documents', 'Readiness', 'Actions'],
        bundleRows(serviceBundles),
        'No service packets are configured yet.',
      );
    }
    const starterTarget = bundleTarget.querySelector<HTMLElement>('[data-bundle-starters]');
    if (starterTarget) {
      renderTable(
        starterTarget,
        ['Code', 'Name', 'Purpose', 'Type', 'Documents', 'Readiness', 'Actions'],
        bundleRows(starterBundles),
        'No packet starters remain in the library.',
      );
    }
  }
  const requestTarget = document.querySelector<HTMLElement>('[data-admin-documents-requests]');
  if (requestTarget) {
    (window as unknown as { __ssRequests?: Array<Record<string, unknown>> }).__ssRequests = requests;
    renderDocumentRequests();
  }
  for (const select of document.querySelectorAll<HTMLSelectElement>('[data-document-template-options]')) {
    select.innerHTML = `<option value="">Choose a template</option>${families.filter((family) => family.state === 'active' && family.approvedTemplateId).map((family) => `<option value="${esc(family.approvedTemplateId)}">${esc(family.title)} (${esc(family.approvedVersionLabel ?? '')})</option>`).join('')}`;
  }
  for (const select of document.querySelectorAll<HTMLSelectElement>('[data-document-bundle-options]')) {
    select.innerHTML = `<option value="">Choose a packet</option>${bundles.map((bundle) => {
      const approved = Number(bundle.approved_document_count ?? bundle.document_count ?? 0);
      return `<option value="${esc(bundle.id)}">${esc(bundle.name)} (${approved} approved${Number(bundle.is_system) === 1 ? ' - starter' : ''})</option>`;
    }).join('')}`;
  }
  for (const select of document.querySelectorAll<HTMLSelectElement>('[data-document-send-bundle]')) {
    const readyBundles = bundles.filter(
      (bundle) =>
        bundle.status === 'active' &&
        Number(bundle.is_system) !== 1 &&
        Number(bundle.approved_document_count ?? bundle.document_count ?? 0) > 0,
    );
    select.innerHTML = `<option value="">Automatic (service rules)</option>${readyBundles.map((bundle) => `<option value="${esc(bundle.id)}">${esc(bundle.name)} (${esc(bundle.code)})</option>`).join('')}`;
  }
  (window as unknown as { __ssDocuments?: Array<Record<string, unknown>> }).__ssDocuments = families as unknown as Array<Record<string, unknown>>;
  (window as unknown as { __ssPackets?: Array<Record<string, unknown>> }).__ssPackets = bundles;
  setupDocumentComposer();
  renderDocumentOverview(requests, bundles);
  if (actor?.role === 'owner') {
    await loadDocumentUpdates().catch(() => undefined);
  }
}

function showDocumentTab(name: string): void {
  const allowed = new Set(['overview', 'send', 'requests', 'library', 'packets', 'updates', 'settings']);
  const target = allowed.has(name) ? name : 'overview';
  for (const button of document.querySelectorAll<HTMLElement>('[data-document-tab]')) {
    if (button.dataset.documentTab === target) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  }
  for (const panel of document.querySelectorAll<HTMLElement>('[data-document-panel]')) {
    panel.hidden = panel.dataset.documentPanel !== target;
  }
}

document.addEventListener('click', (event) => {
  const tab = (event.target as HTMLElement).closest<HTMLElement>('[data-document-tab]');
  if (!tab) return;
  event.preventDefault();
  showDocumentTab(tab.dataset.documentTab ?? 'overview');
  const view = document.querySelector<HTMLElement>('[data-admin-view="documents"]');
  view?.scrollIntoView({ behavior: 'smooth', block: 'start' });
});

function showDocumentLibraryTab(name: string): void {
  const target = ['active', 'drafts', 'archive'].includes(name) ? name : 'active';
  for (const button of document.querySelectorAll<HTMLElement>('[data-document-library-tab]')) {
    const selected = button.dataset.documentLibraryTab === target;
    if (selected) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
    button.classList.toggle('btn--secondary', selected);
    button.classList.toggle('btn--ghost', !selected);
  }
  for (const panel of document.querySelectorAll<HTMLElement>('[data-document-library-panel]')) {
    panel.hidden = panel.dataset.documentLibraryPanel !== target;
  }
}

document.addEventListener('click', (event) => {
  const tab = (event.target as HTMLElement).closest<HTMLElement>('[data-document-library-tab]');
  if (!tab) return;
  event.preventDefault();
  showDocumentLibraryTab(tab.dataset.documentLibraryTab ?? 'active');
});

async function showFamilyHistory(familyKey: string): Promise<void> {
  const target = document.querySelector<HTMLElement>('[data-document-family-history]');
  if (!target || !familyKey) return;
  showDocumentLibraryTab('archive');
  target.innerHTML = '<p class="admin-muted">Loading version history…</p>';
  const data = await api<{
    history?: {
      familyKey?: string;
      archivedAt?: string | null;
      templates?: Array<Record<string, unknown>>;
      audit?: Array<Record<string, unknown>>;
      executedRequests?: number;
    };
  }>(`/api/admin/documents?view=family-history&familyKey=${encodeURIComponent(familyKey)}`);
  const history = data.history ?? {};
  const versions = history.templates ?? [];
  const audit = history.audit ?? [];
  const title = String(versions[versions.length - 1]?.title ?? 'Document');
  const rows = versions
    .map((version) => {
      const status = String(version.status ?? 'draft');
      const actions = [
        `<a class="btn btn--ghost btn--small" href="/api/admin/documents?view=template-download&id=${encodeURIComponent(String(version.id))}">Download</a>`,
        status === 'retired' && actor?.role === 'owner'
          ? `<button class="btn btn--ghost btn--small" type="button" data-admin-action="document-restore" data-id="${esc(version.id)}">Restore as draft</button>`
          : '',
      ].filter(Boolean).join('');
      return `<tr>
        <td>${esc(version.version_label ?? version.version)}</td>
        <td><span class="admin-status">${esc(titleCase(status))}</span></td>
        <td>${esc(dateTime(version.created_at))}</td>
        <td>${esc(version.approved_at ? dateTime(version.approved_at) : '—')}</td>
        <td>${esc(String(version.signature_count ?? 0))}${version.last_signed_at ? `<span class="admin-muted"> · last ${esc(dateTime(version.last_signed_at))}</span>` : ''}</td>
        <td>${esc(((version.packet_names as string[] | undefined) ?? []).join(', ') || 'Not in a packet')}</td>
        <td><div class="admin-actions">${actions}</div></td>
      </tr>`;
    })
    .join('');
  target.innerHTML = `<div class="admin-card" style="margin-bottom:1rem;">
    <div class="admin-detail-head">
      <div>
        <h3 style="margin:0;font-size:1rem;">${esc(title)} — version history</h3>
        <p class="admin-muted" style="margin:.25rem 0 0;">${esc(String(versions.length))} version(s) · ${esc(String(history.executedRequests ?? 0))} signing request(s) reference this family · ${history.archivedAt ? `archived ${esc(dateTime(history.archivedAt))}` : 'in the active library'}.</p>
      </div>
      <button class="btn btn--ghost btn--small" type="button" data-admin-action="document-family-history-close">Close</button>
    </div>
    <div class="admin-table-scroll"><table class="admin-table"><thead><tr><th>Version</th><th>Status</th><th>Created</th><th>Approved</th><th>Signatures</th><th>Packets</th><th>Actions</th></tr></thead><tbody>${rows}</tbody></table></div>
    <details class="admin-detail-toggle" style="margin-top:.75rem;"><summary>Audit trail (${audit.length})</summary>
      ${audit.length ? `<div class="admin-table-scroll"><table class="admin-table"><thead><tr><th>When</th><th>Action</th><th>Result</th></tr></thead><tbody>${audit.map((entry) => `<tr><td>${esc(dateTime(entry.created_at))}</td><td>${esc(titleCase(String(entry.action ?? '').replace(/^documents\\./, '').replace(/_/g, ' ')))}</td><td>${Number(entry.success) ? 'Recorded' : 'Failed'}</td></tr>`).join('')}</tbody></table></div>` : '<p class="admin-muted">No audit events recorded for this family.</p>'}
    </details>
  </div>`;
  target.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function renderDocumentRequests(): void {
  const target = document.querySelector<HTMLElement>('[data-admin-documents-requests]');
  if (!target) return;
  const requests = (window as unknown as { __ssRequests?: Array<Record<string, unknown>> }).__ssRequests ?? [];
  const query = (document.querySelector<HTMLInputElement>('[data-document-request-search]')?.value ?? '').trim().toLowerCase();
  const status = document.querySelector<HTMLSelectElement>('[data-document-request-status]')?.value ?? '';
  const filtered = requests.filter((request) => {
    if (status === 'active') {
      if (!['pending', 'partially_signed'].includes(String(request.status))) return false;
    } else if (status && String(request.status) !== status) {
      return false;
    }
    if (!query) return true;
    const haystack = [
      request.first_name,
      request.last_name,
      request.display_name,
      request.packet_name,
      request.bundle_code,
      request.booking_reference,
      request.signer_email,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    return haystack.includes(query);
  });
  renderTable(
    target,
    ['Recipient', 'Packet', 'Status', 'Signed', 'Verification', 'Created', 'Actions'],
    filtered.map((request) => [
      esc(
        [request.first_name, request.last_name].filter(Boolean).join(' ') ||
          request.display_name ||
          request.signer_email ||
          titleCase(String(request.subject_type ?? '')),
      ),
      esc(request.packet_name || request.bundle_code || 'Signing request'),
      `<span class="admin-status">${esc(titleCase(request.status))}</span>`,
      esc(`${Number(request.signed_count ?? 0)}`),
      esc(Number(request.awaiting_verification ?? 0) ? `Awaiting review (${request.awaiting_verification})` : 'Clear'),
      esc(dateTime(request.created_at)),
      `<div class="admin-actions"><button class="btn btn--ghost btn--small" type="button" data-admin-action="document-request-open" data-id="${esc(request.id)}">Open</button>${['pending', 'partially_signed'].includes(String(request.status)) ? `<button class="btn btn--ghost btn--small" type="button" data-admin-action="document-request-resend" data-id="${esc(request.id)}">Resend</button><button class="btn btn--danger btn--small" type="button" data-admin-action="document-request-revoke" data-id="${esc(request.id)}">Revoke</button>` : ''}</div>`,
    ]),
    requests.length ? 'No signing requests match that search or status.' : 'No signing requests have been created yet.',
  );
}

document.querySelector<HTMLInputElement>('[data-document-request-search]')?.addEventListener('input', renderDocumentRequests);
document.querySelector<HTMLSelectElement>('[data-document-request-status]')?.addEventListener('change', renderDocumentRequests);

async function renderDocumentOverview(
  requests: Array<Record<string, unknown>>,
  bundles: Array<Record<string, unknown>>,
): Promise<void> {
  const target = document.querySelector<HTMLElement>('[data-document-overview]');
  if (!target) return;
  const count = (status: string) => requests.filter((request) => String(request.status) === status).length;
  const awaiting = requests.filter((request) => ['pending', 'partially_signed'].includes(String(request.status))).length;
  const readyPackets = bundles.filter(
    (bundle) =>
      bundle.status === 'active' &&
      Number(bundle.is_system) !== 1 &&
      Number(bundle.approved_document_count ?? bundle.document_count ?? 0) > 0,
  ).length;
  const emptyPackets = bundles.filter(
    (bundle) =>
      bundle.status === 'active' &&
      Number(bundle.approved_document_count ?? bundle.document_count ?? 0) === 0,
  ).length;
  const signingAttention = count('signed');
  const recent = requests.slice(0, 6);
  target.innerHTML = `
    <div class="document-overview-grid">
      <button class="document-overview-card" type="button" data-document-tab="requests" style="text-align:left;cursor:pointer;"><strong>${awaiting}</strong><span>Awaiting signature</span></button>
      <button class="document-overview-card" type="button" data-document-tab="requests" style="text-align:left;cursor:pointer;"><strong>${signingAttention}</strong><span>Completed requests</span></button>
      <button class="document-overview-card" type="button" data-document-tab="requests" style="text-align:left;cursor:pointer;"><strong>${count('expired')}</strong><span>Expired links</span></button>
      <button class="document-overview-card" type="button" data-document-tab="packets" style="text-align:left;cursor:pointer;"><strong>${readyPackets}</strong><span>Ready packets</span></button>
      <button class="document-overview-card" type="button" data-document-tab="packets" style="text-align:left;cursor:pointer;"><strong>${emptyPackets}</strong><span>Packets needing documents</span></button>
      <button class="document-overview-card" type="button" data-document-tab="updates" style="text-align:left;cursor:pointer;"><strong data-document-overview-updates>-</strong><span>Updated agreements to review</span></button>
    </div>
    <div class="document-overview-actions">
      <button class="btn btn--primary btn--small" type="button" data-document-tab="send">Send for signature</button>
      <button class="btn btn--secondary btn--small" type="button" data-document-tab="requests">View signing requests</button>
      <button class="btn btn--ghost btn--small" type="button" data-document-tab="packets">Check packet readiness</button>
    </div>
    <h3 style="margin:1.1rem 0 .45rem;font-size:.95rem;">Recent signing activity</h3>
    ${
      recent.length
        ? `<div class="admin-table-scroll"><table class="admin-table"><thead><tr><th>Recipient</th><th>Packet</th><th>Status</th><th>Created</th></tr></thead><tbody>${recent
            .map(
              (request) =>
                `<tr><td>${esc([request.first_name, request.last_name].filter(Boolean).join(' ') || request.display_name || request.signer_email || titleCase(String(request.subject_type ?? '')))}</td><td>${esc(request.packet_name || request.bundle_code || 'Signing request')}</td><td><span class="admin-status">${esc(titleCase(request.status))}</span></td><td>${esc(dateTime(request.created_at))}</td></tr>`,
            )
            .join('')}</tbody></table></div>`
        : '<p class="admin-muted">No signing requests yet. Use Send for Signature to create the first one.</p>'
    }`;
  if (actor?.role === 'owner') {
    const updateTarget = target.querySelector<HTMLElement>('[data-document-overview-updates]');
    if (updateTarget) {
      try {
        const data = await api<{ updates?: Array<Record<string, unknown>> }>('/api/admin/documents?view=updates');
        updateTarget.textContent = String(data.updates?.length ?? 0);
      } catch {
        updateTarget.textContent = '—';
      }
    }
  }
}

function documentFormField(name: string): HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | null {
  return document.querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
    `[data-document-send] [name="${name}"]`,
  );
}

function packetForService(serviceCode: string, subjectType: string): Record<string, unknown> | undefined {
  if (subjectType === 'employee') {
    return ((window as unknown as { __ssPackets?: Array<Record<string, unknown>> }).__ssPackets ?? []).find(
      (bundle) =>
        String(bundle.code) === 'employee.onboarding' &&
        Number(bundle.approved_document_count ?? bundle.document_count ?? 0) > 0,
    );
  }
  const map: Record<string, string> = {
    'residential-deep': 'customer.deep',
    'recurring-residential': 'customer.recurring',
    'move-in-move-out': 'customer.move_in_out',
    'residential-cleaning': 'customer.residential',
    'str-turnover': 'customer.str',
    'commercial-cleaning': 'customer.commercial',
    'church-cleaning': 'customer.church',
    'property-management': 'customer.property_management',
    'specialty-addons': 'customer.specialty_addons',
  };
  const code = map[serviceCode];
  if (!code) return undefined;
  return ((window as unknown as { __ssPackets?: Array<Record<string, unknown>> }).__ssPackets ?? []).find(
    (bundle) =>
      String(bundle.code) === code &&
      bundle.status === 'active' &&
      Number(bundle.approved_document_count ?? bundle.document_count ?? 0) > 0,
  );
}

function selectPacketForService(): void {
  const subjectType = document.querySelector<HTMLSelectElement>('[data-document-subject-type]')?.value ?? 'customer';
  const service = documentFormField('serviceCode')?.value ?? '';
  const packetSelect = document.querySelector<HTMLSelectElement>('[data-document-send] select[name="bundleId"]');
  if (!packetSelect) return;
  const packet = packetForService(service, subjectType);
  packetSelect.value = packet ? String(packet.id) : '';
  updateDocumentSendReadiness();
}

function applyCustomerToComposer(detail: Record<string, unknown>): void {
  const customer = (detail.customer ?? {}) as Record<string, unknown>;
  const contacts = (detail.contacts ?? []) as Array<Record<string, unknown>>;
  const properties = (detail.properties ?? []) as Array<Record<string, unknown>>;
  const leads = (detail.leads ?? []) as Array<Record<string, unknown>>;
  const estimates = (detail.estimates ?? []) as Array<Record<string, unknown>>;
  const appointments = (detail.appointments ?? []) as Array<Record<string, unknown>>;
  const recurring = (detail.recurringPlans ?? []) as Array<Record<string, unknown>>;
  const quickEstimates = (detail.quickEstimates ?? []) as Array<Record<string, unknown>>;
  const name =
    String(customer.company_name ?? '').trim() ||
    [customer.first_name, customer.last_name].filter(Boolean).join(' ');
  const email = String(
    contacts.find((contact) => contact.kind === 'email')?.value ?? '',
  ).trim();
  const phone = String(
    contacts.find((contact) => contact.kind === 'phone')?.value ?? '',
  ).trim();
  const customerId = String(customer.id ?? '');
  const customerIdField = document.querySelector<HTMLInputElement>('[data-document-send] input[name="customerId"]');
  if (customerIdField) customerIdField.value = customerId;
  const emailField = documentFormField('email');
  if (emailField) emailField.value = email;
  const selected = document.querySelector<HTMLElement>('[data-document-selected-recipient]');
  if (selected) {
    selected.hidden = false;
    selected.innerHTML = `<strong>${esc(name || 'Customer')}</strong>${customer.company_name ? ` <span class="admin-muted">${esc(customer.first_name ?? '')} ${esc(customer.last_name ?? '')}</span>` : ''}<dl><dt>Email</dt><dd>${esc(email || 'No email on file')}</dd><dt>Phone</dt><dd>${esc(phone || '—')}</dd><dt>Properties</dt><dd>${esc(String(properties.length))}</dd></dl><button class="btn btn--ghost btn--small document-selected-recipient__clear" type="button" data-document-clear-recipient>Choose a different customer</button>`;
  }
  const propertySelect = document.querySelector<HTMLSelectElement>('[data-document-property]');
  if (propertySelect) {
    propertySelect.innerHTML = `<option value="">No specific property</option>${properties
      .map((property) => {
        const label = [property.label, property.line1, property.city, property.state]
          .filter(Boolean)
          .join(' — ');
        return `<option value="${esc(property.id)}"${Number(property.is_primary) === 1 ? ' selected' : ''}>${esc(label)}</option>`;
      })
      .join('')}`;
  }
  const reference = String(leads[0]?.quote_reference ?? appointments[0]?.reference ?? '');
  const referenceField = documentFormField('bookingReference');
  if (referenceField && !referenceField.value && reference) referenceField.value = reference;
  const dateField = documentFormField('serviceDate');
  if (dateField && !dateField.value && appointments[0]?.start_at) {
    dateField.value = String(appointments[0].start_at).slice(0, 10);
  }
  const arrivalField = documentFormField('arrivalWindow');
  if (arrivalField && !arrivalField.value && appointments[0]?.start_at) {
    const formatter = new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      timeZone: 'America/Chicago',
    });
    const start = new Date(String(appointments[0].start_at));
    const end = appointments[0]?.end_at ? new Date(String(appointments[0].end_at)) : null;
    if (Number.isFinite(start.getTime())) {
      arrivalField.value = `${formatter.format(start)}${end && Number.isFinite(end.getTime()) ? ` – ${formatter.format(end)}` : ''} Central`;
    }
  }
  const priceField = documentFormField('priceSummary');
  if (priceField && !priceField.value && estimates[0]?.total_cents) {
    priceField.value = `$${(Number(estimates[0].total_cents) / 100).toFixed(2)}`;
  }
  const serviceField = documentFormField('serviceCode');
  if (serviceField && !serviceField.value) {
    const suggestedService =
      String(quickEstimates[0]?.service_code ?? '') ||
      (recurring.length ? 'recurring-residential' : estimates.length ? 'residential-cleaning' : '');
    if (suggestedService) serviceField.value = suggestedService;
  }
  if (recurring.length) {
    const frequency = documentFormField('frequency');
    if (frequency && recurring[0]?.frequency) frequency.value = String(recurring[0].frequency);
  }
  const hint = document.querySelector<HTMLElement>('[data-document-context-hint]');
  if (hint) {
    hint.textContent = [
      `Loaded ${properties.length} propert${properties.length === 1 ? 'y' : 'ies'} for ${name || 'this customer'}.`,
      reference ? `Latest reference ${reference}.` : '',
      estimates[0]?.total_cents ? `Latest recorded estimate $${(Number(estimates[0].total_cents) / 100).toFixed(2)}.` : '',
      'Confirm the service, packet, date, scope, and price before sending.',
    ]
      .filter(Boolean)
      .join(' ');
  }
  selectPacketForService();
  updateDocumentSendReadiness();
}

async function chooseDocumentCustomer(customerId: string): Promise<void> {
  const results = document.querySelector<HTMLElement>('[data-document-customer-results]');
  if (results) results.textContent = 'Loading customer and property details…';
  try {
    const detail = await api<Record<string, unknown>>(`/api/admin/customers?id=${encodeURIComponent(customerId)}`);
    if (results) results.innerHTML = '';
    applyCustomerToComposer(detail);
  } catch (error) {
    if (results) results.innerHTML = `<p class="admin-error">${esc(friendly(error))}</p>`;
  }
}

function renderCustomerResults(customers: Array<Record<string, unknown>>): void {
  const results = document.querySelector<HTMLElement>('[data-document-customer-results]');
  if (!results) return;
  results.innerHTML = customers.length
    ? customers
        .map((customer) => {
          const name =
            String(customer.company_name ?? '').trim() ||
            [customer.first_name, customer.last_name].filter(Boolean).join(' ');
          return `<button class="document-recipient-result" type="button" data-document-customer-id="${esc(customer.id)}"><strong>${esc(name || 'Customer')}</strong><span>${esc(customer.email || 'No email on file')} · ${esc(customer.phone || 'No phone')} · ${esc(customer.branch_name || 'No branch')}</span></button>`;
        })
        .join('')
    : '<p class="admin-muted">No customer matched that search.</p>';
}

function updateDocumentSendReadiness(): void {
  const target = document.querySelector<HTMLElement>('[data-document-send-readiness]');
  if (!target) return;
  const subjectType = document.querySelector<HTMLSelectElement>('[data-document-subject-type]')?.value ?? 'customer';
  const customerId =
    document.querySelector<HTMLInputElement>('[data-document-send] input[name="customerId"]')?.value ||
    document.querySelector<HTMLInputElement>('[data-document-send] input[name="manualCustomerId"]')?.value ||
    '';
  const employeeId =
    document.querySelector<HTMLInputElement>('[data-document-send] input[name="teamMemberId"]')?.value ||
    document.querySelector<HTMLInputElement>('[data-document-send] input[name="manualTeamMemberId"]')?.value ||
    '';
  const email = documentFormField('email')?.value.trim() ?? '';
  const service = documentFormField('serviceCode')?.value ?? '';
  const packet = document.querySelector<HTMLSelectElement>('[data-document-send] select[name="bundleId"]')?.selectedOptions[0];
  const packetLabel = packet?.value ? packet.textContent ?? '' : '';
  const missing: string[] = [];
  if (subjectType === 'customer' && !customerId) missing.push('choose a customer');
  if (subjectType === 'employee' && !employeeId) missing.push('choose an employee');
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) missing.push('enter a valid recipient email');
  if (subjectType === 'customer' && !service) missing.push('choose the service');
  target.dataset.ready = missing.length ? 'no' : 'yes';
  target.textContent = missing.length
    ? `Before sending: ${missing.join(', ')}.`
    : `Ready for preview. ${packetLabel ? `Packet: ${packetLabel}. ` : 'The packet will be selected from the service rules. '}Preview to confirm every required detail resolves.`;
}

async function loadDocumentEmployees(): Promise<void> {
  const select = document.querySelector<HTMLSelectElement>('[data-document-employee-select]');
  if (!select || select.dataset.loaded === 'yes') return;
  try {
    const data = await api<{ team?: Array<Record<string, unknown>> }>('/api/admin/operations?view=jobs');
    const team = data.team ?? [];
    select.innerHTML = `<option value="">Choose an employee</option>${team
      .map((member) => `<option value="${esc(member.id)}" data-email="${esc(member.email ?? '')}">${esc(member.display_name)} · ${esc(member.email ?? '')}</option>`)
      .join('')}`;
    select.dataset.loaded = 'yes';
  } catch {
    select.innerHTML = '<option value="">Employee list unavailable</option>';
  }
}

function setupDocumentComposer(): void {
  const form = document.querySelector<HTMLFormElement>('[data-document-send]');
  if (!form || form.dataset.ready === 'yes') return;
  form.dataset.ready = 'yes';
  let searchTimer: number | undefined;
  document.querySelector<HTMLInputElement>('[data-document-customer-search]')?.addEventListener('input', (event) => {
    const query = (event.target as HTMLInputElement).value.trim();
    window.clearTimeout(searchTimer);
    if (query.length < 2) {
      const results = document.querySelector<HTMLElement>('[data-document-customer-results]');
      if (results) results.innerHTML = '';
      return;
    }
    searchTimer = window.setTimeout(async () => {
      try {
        const data = await api<{ customers?: Array<Record<string, unknown>> }>(
          `/api/admin/customers?q=${encodeURIComponent(query)}&limit=8`,
        );
        renderCustomerResults(data.customers ?? []);
      } catch (error) {
        const results = document.querySelector<HTMLElement>('[data-document-customer-results]');
        if (results) results.innerHTML = `<p class="admin-error">${esc(friendly(error))}</p>`;
      }
    }, 250);
  });
  document.querySelector<HTMLElement>('[data-document-customer-results]')?.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest<HTMLElement>('[data-document-customer-id]');
    if (button?.dataset.documentCustomerId) void chooseDocumentCustomer(button.dataset.documentCustomerId);
  });
  document.querySelector<HTMLElement>('[data-document-selected-recipient]')?.addEventListener('click', (event) => {
    if (!(event.target as HTMLElement).closest('[data-document-clear-recipient]')) return;
    const hidden = document.querySelector<HTMLInputElement>('[data-document-send] input[name="customerId"]');
    if (hidden) hidden.value = '';
    const selected = document.querySelector<HTMLElement>('[data-document-selected-recipient]');
    if (selected) {
      selected.hidden = true;
      selected.innerHTML = '';
    }
    const property = document.querySelector<HTMLSelectElement>('[data-document-property]');
    if (property) property.innerHTML = '<option value="">No specific property</option>';
    const email = documentFormField('email');
    if (email) email.value = '';
    updateDocumentSendReadiness();
  });
  document.querySelector<HTMLSelectElement>('[data-document-subject-type]')?.addEventListener('change', (event) => {
    const subject = (event.target as HTMLSelectElement).value;
    const employeePicker = document.querySelector<HTMLElement>('[data-document-employee-picker]');
    if (employeePicker) employeePicker.hidden = subject !== 'employee';
    const customerSearch = document.querySelector<HTMLInputElement>('[data-document-customer-search]');
    if (customerSearch) customerSearch.disabled = subject === 'employee';
    if (subject === 'employee') {
      const customerId = document.querySelector<HTMLInputElement>('[data-document-send] input[name="customerId"]');
      if (customerId) customerId.value = '';
      void loadDocumentEmployees();
      const service = documentFormField('serviceCode');
      if (service) service.value = '';
    } else {
      const employeeId = document.querySelector<HTMLInputElement>('[data-document-send] input[name="teamMemberId"]');
      if (employeeId) employeeId.value = '';
    }
    selectPacketForService();
  });
  document.querySelector<HTMLSelectElement>('[data-document-employee-select]')?.addEventListener('change', (event) => {
    const option = (event.target as HTMLSelectElement).selectedOptions[0];
    const id = (event.target as HTMLSelectElement).value;
    const hidden = document.querySelector<HTMLInputElement>('[data-document-send] input[name="teamMemberId"]');
    if (hidden) hidden.value = id;
    const email = documentFormField('email');
    if (email) email.value = option?.dataset.email ?? '';
    const service = documentFormField('serviceCode');
    if (service) service.value = '';
    selectPacketForService();
    updateDocumentSendReadiness();
  });
  document.querySelector<HTMLSelectElement>('[data-document-service]')?.addEventListener('change', selectPacketForService);
  document.querySelector<HTMLSelectElement>('[data-document-property]')?.addEventListener('change', updateDocumentSendReadiness);
  form.addEventListener('input', updateDocumentSendReadiness);
  form.addEventListener('change', updateDocumentSendReadiness);
  for (const manual of ['manualCustomerId', 'manualTeamMemberId', 'manualPropertyId']) {
    form.querySelector<HTMLInputElement>(`[name="${manual}"]`)?.addEventListener('input', updateDocumentSendReadiness);
  }
  updateDocumentSendReadiness();
}

async function loadDocumentUpdates(): Promise<void> {
  const target = document.querySelector<HTMLElement>('[data-admin-document-updates]');
  if (!target) return;
  if (actor?.role !== 'owner') {
    target.innerHTML = '<p class="admin-muted">Only the owner can review document revisions.</p>';
    return;
  }
  target.textContent = 'Loading document updates...';
  try {
    const data = await api<{ updates?: Array<Record<string, unknown>> }>(
      '/api/admin/documents?view=updates',
    );
    const updates = data.updates ?? [];
    if (!updates.length) {
      target.innerHTML =
        '<p class="admin-muted">No new document revisions are waiting for review.</p>';
      return;
    }
    target.innerHTML = updates
      .map((update) => {
        const counts = (update.counts ?? {}) as Record<string, unknown>;
        const review = (update.review ?? {}) as Record<string, unknown>;
        const packets = (update.affectedPackets ?? []) as Array<Record<string, unknown>>;
        const customers = (update.affectedCustomers ?? []) as Array<Record<string, unknown>>;
        const status = String(update.status ?? '');
        const statusLabel =
          status === 'pending_approval'
            ? 'Pending approval'
            : status === 'owner_review_required'
              ? 'Owner review required'
              : status === 'resigning_recommended'
                ? 'Re-signing recommended'
                : 'Reviewed';
        const queue = customers.filter((customer) => customer.needsResigning);
        const actions =
          status === 'owner_review_required'
            ? `<label class="admin-field--wide" style="display:block;margin:.65rem 0 .4rem;">Plain-English description of the changes
                 <textarea data-document-update-note="${esc(update.templateId)}" rows="2" maxlength="1000" placeholder="Example: Added the updated cancellation notice and corrected the payment timing. No pricing terms changed.">${esc(review.note ?? '')}</textarea>
               </label>
               <div class="admin-actions"><button class="btn btn--primary btn--small" type="button" data-admin-action="document-update-ack" data-id="${esc(update.templateId)}" data-material="yes">Acknowledge material change</button><button class="btn btn--secondary btn--small" type="button" data-admin-action="document-update-ack" data-id="${esc(update.templateId)}" data-material="no">Acknowledge formatting / nonmaterial</button></div>`
            : review.acknowledgedAt
              ? `<p class="admin-muted">Reviewed ${esc(dateTime(review.acknowledgedAt))}${review.materialChange === true ? ' - marked material' : review.materialChange === false ? ' - marked nonmaterial' : ''}.${review.note ? ` ${esc(review.note)}` : ''}</p>`
              : '';
        const packetLabels = packets.length
          ? packets
              .map(
                (packet) =>
                  `${esc(packet.name)} (${esc(packet.code)}${packet.status === 'active' ? '' : ' - inactive'})`,
              )
              .join(', ')
          : 'No packet currently references this document.';
        const queueRows = queue.length
          ? `<div class="admin-table-scroll"><table class="admin-table"><thead><tr><th>Customer</th><th>Last signed</th><th>Next appointment</th><th>Action</th></tr></thead><tbody>${queue
              .slice(0, 50)
              .map(
                (customer) =>
                  `<tr><td>${esc(customer.name)}</td><td>${esc(dateTime(customer.lastSignedAt))}</td><td>${customer.nextAppointmentAt ? esc(dateTime(customer.nextAppointmentAt)) : '-'}</td><td><button class="btn btn--ghost btn--small" type="button" data-admin-action="document-update-compose" data-customer="${esc(customer.customerId)}" data-packet="${esc(packets[0]?.code ?? '')}">Use in composer</button></td></tr>`,
              )
              .join('')}</tbody></table></div>${queue.length > 50 ? '<p class="admin-muted">Only the first 50 matching records are shown here. Use the customer record for the full history.</p>' : ''}`
          : '<p class="admin-muted">No executed copies of the previous version require review.</p>';
        return `<div class="admin-record" style="margin-top:1rem;">
          <p><strong>${esc(update.title)}</strong> ${esc(update.previousVersionLabel ?? 'Version 1.0')} &rarr; ${esc(update.newVersionLabel ?? update.newVersion)} <span class="admin-status">${esc(statusLabel)}</span></p>
          <p class="admin-muted">${esc(String(counts.customers ?? 0))} customer(s) signed the previous version &middot; ${esc(String(counts.needingResigning ?? 0))} still need the new version &middot; ${esc(String(counts.upcomingAppointments ?? 0))} with an upcoming appointment.</p>
          <p class="admin-muted">Affected packets: ${packetLabels}</p>
          <details class="admin-detail-toggle"><summary>Re-signing queue (${queue.length})</summary>${queueRows}</details>
          ${actions}
        </div>`;
      })
      .join('');
  } catch (error) {
    target.innerHTML = `<p class="admin-error">${esc(friendly(error))}</p>`;
  }
}

function prefillComposerFromUpdate(customerId: string, packetCode: string): void {
  const form = document.querySelector<HTMLFormElement>('[data-document-send]');
  if (!form) return;
  const customerField = form.querySelector<HTMLInputElement>('input[name="customerId"]');
  if (customerField && customerId) customerField.value = customerId;
  const packetSelect = form.querySelector<HTMLSelectElement>('select[name="bundleId"]');
  if (packetSelect && packetCode) {
    const packet = (
      window as unknown as { __ssPackets?: Array<Record<string, unknown>> }
    ).__ssPackets?.find((entry) => entry.code === packetCode);
    if (packet?.id) packetSelect.value = String(packet.id);
  }
  form.scrollIntoView({ behavior: 'smooth', block: 'start' });
  customerField?.focus({ preventScroll: true });
}

function documentEditForm(): HTMLFormElement | null {
  return document.querySelector<HTMLFormElement>('[data-document-template-edit]');
}

async function showTemplateHistory(templateId: string): Promise<void> {
  const target = document.querySelector<HTMLElement>('[data-document-template-result]');
  if (!target) return;
  const data = await api<{ history?: Array<Record<string, unknown>> }>(
    `/api/admin/documents?view=history&entityType=document_template&id=${encodeURIComponent(templateId)}`,
  );
  const rows = data.history ?? [];
  target.innerHTML = rows.length
    ? `<div class="admin-table-scroll"><table class="admin-table"><thead><tr><th>When</th><th>Action</th><th>Result</th></tr></thead><tbody>${rows.map((row) => `<tr><td>${esc(dateTime(row.created_at))}</td><td>${esc(row.action)}</td><td>${Number(row.success) ? 'Success' : 'Failed'}</td></tr>`).join('')}</tbody></table></div>`
    : '<p class="admin-muted">No audit history for this template yet.</p>';
}

function documentSendPayload(): Record<string, unknown> {
  const form = document.querySelector<HTMLFormElement>('[data-document-send]');
  const data = form ? new FormData(form) : new FormData();
  const variables: Record<string, string> = {};
  const mapping: Array<[string, string, number]> = [
    ['serviceScope', 'service.scope', 8000],
    ['serviceAdditions', 'service.additions', 4000],
    ['serviceExclusions', 'service.exclusions', 4000],
    ['serviceDate', 'service.date', 40],
    ['arrivalWindow', 'service.arrival_window', 120],
    ['priceSummary', 'price.summary', 2000],
    ['priceLineItems', 'price.line_items', 8000],
    ['priceTax', 'price.tax', 1000],
    ['priceDiscount', 'price.discount', 1000],
    ['paymentTerms', 'payment.terms', 4000],
    ['cancellationTerms', 'cancellation.terms', 4000],
  ];
  for (const [field, key, limit] of mapping) {
    const value = String(data.get(field) ?? '').trim().slice(0, limit);
    if (value) variables[key] = value;
  }
  return {
    subjectType: String(data.get('subjectType') ?? 'customer'),
    customerId: String(data.get('customerId') || data.get('manualCustomerId') || ''),
    teamMemberId: String(data.get('teamMemberId') || data.get('manualTeamMemberId') || ''),
    propertyId: String(data.get('propertyId') || data.get('manualPropertyId') || ''),
    serviceCode: String(data.get('serviceCode') ?? ''),
    frequency: String(data.get('frequency') ?? ''),
    bookingReference: String(data.get('bookingReference') ?? ''),
    email: String(data.get('email') ?? ''),
    bundleId: String(data.get('bundleId') ?? ''),
    instructions: String(data.get('instructions') ?? ''),
    variables,
  };
}

function composerPreviewFrame(): HTMLIFrameElement | null {
  return document.querySelector<HTMLIFrameElement>('[data-document-preview-frame]');
}

function applyComposerZoom(): void {
  const frame = composerPreviewFrame();
  const zoom = document.querySelector<HTMLSelectElement>('[data-document-preview-zoom]')?.value ?? '1';
  const doc = frame?.contentWindow?.document;
  if (doc?.body) doc.body.style.zoom = zoom;
}

function renderComposerPreview(preview: Record<string, unknown>): void {
  const frame = composerPreviewFrame();
  if (!frame) return;
  const requirements = (preview.requirements as Array<Record<string, unknown>>) ?? [];
  const missing = (preview.missingVariables as string[]) ?? [];
  const contentProblems = (preview.contentProblems as string[]) ?? [];
  const sectionSelect = document.querySelector<HTMLSelectElement>('[data-document-preview-section]');
  if (sectionSelect) {
    sectionSelect.innerHTML = requirements.length
      ? requirements.map((item, index) => `<option value="${index}">${esc(String(item.title ?? 'Document'))}</option>`).join('')
      : '<option value="">No documents</option>';
  }
  const body = requirements.map((item, index) => {
    const text = String(item.contentText ?? '').trim();
    const itemMissing = (item.missingVariables as string[] | undefined) ?? [];
    const rendered = text
      ? renderBrandedDocumentHtml(text, { variant: 'preview' })
      : '<p>PDF template - use the Download action to review the source PDF.</p>';
    return `<section class="doc" id="doc-${index}"><div class="doc-preview-label">Document ${index + 1} of ${requirements.length} · ${esc(String(item.title ?? 'Document'))} · ${Number(item.required) ? 'Required agreement' : 'Optional agreement'}</div>${itemMissing.length ? `<p class="warn">Unresolved: ${itemMissing.map((key) => esc(key)).join(', ')}</p>` : ''}${rendered}</section>`;
  }).join('');
  const warning = contentProblems.length
    ? `<div class="warn banner">Internal review wording blocks customer delivery: ${contentProblems.map((term) => esc(term)).join(', ')}</div>`
    : missing.length
      ? `<div class="warn banner">Unresolved variables block sending: ${missing.map((key) => esc(key)).join(', ')}</div>`
      : '<div class="ok banner">All supported values resolve for this draft.</div>';
  frame.srcdoc = `<!doctype html><html><head><meta charset="utf-8"><style>
    @page{size:Letter;margin:.7in .75in}
    body{margin:0;background:#f4ece3;padding:14px}
    .banner{padding:8px 12px;border-radius:8px;font-family:Segoe UI,Arial,sans-serif;font-size:9pt;margin:0 0 12px}
    .warn{background:#fff3d8;border:1px solid #e7cf9a;color:#6b4e12}.ok{background:#e8f4ec;border:1px solid #b9dbc6;color:#245c3c}
    ${DOCUMENT_BRAND_CSS}
    section.doc{margin:0 0 18px;break-after:page}
    .doc-preview-label{max-width:50rem;margin:0 auto 6px;font-family:Segoe UI,Arial,sans-serif;font-size:8pt;letter-spacing:.08em;text-transform:uppercase;color:#8a6d38}
    @media print{body{background:#fff;padding:0}section.doc{margin:0;break-after:page}}
  </style></head><body>${warning}${body || '<p>No approved documents matched this packet and context.</p>'}</body></html>`;
  frame.onload = () => applyComposerZoom();
}

async function sendDocumentPacket(draft: boolean): Promise<void> {
  const payload = documentSendPayload();
  const target = document.querySelector<HTMLElement>('[data-document-send-result]');
  const result = await api<{ required?: boolean; signingUrl?: string; emailSent?: boolean; draft?: boolean; message?: string }>('/api/admin/documents', {
    method: 'POST',
    body: JSON.stringify({ action: 'send_request', ...payload, draft }),
  });
  if (target) {
    target.innerHTML = result.required
      ? `<div class="admin-card"><p><strong>${result.draft ? 'Draft signing link saved.' : 'Signing link created.'}</strong> ${result.emailSent ? 'The email was sent.' : 'Email was not sent; share this private link when ready.'}</p><p><a href="${esc(result.signingUrl)}">${esc(result.signingUrl)}</a></p></div>`
      : `<p class="admin-muted">${esc(result.message ?? 'No active required documents for this context.')}</p>`;
  }
  await loadDocuments();
}

async function previewDocumentPacket(bundleId = ''): Promise<void> {
  const target = document.querySelector<HTMLElement>('[data-document-preview-result]');
  if (target) target.textContent = 'Building packet preview...';
  try {
    const payload = documentSendPayload();
    if (bundleId) payload.bundleId = bundleId;
    const result = await api<{ preview?: Record<string, unknown> }>('/api/admin/documents', {
      method: 'POST',
      body: JSON.stringify({ action: 'preview_packet', ...payload }),
    });
    const preview = result.preview;
    if (!target || !preview) {
      if (target) target.textContent = 'No packet matched this context.';
      return;
    }
    const requirements = (preview.requirements as Array<Record<string, unknown>>) ?? [];
    const missing = (preview.missingVariables as string[]) ?? [];
    const approvedCount = Number(preview.approvedDocumentCount ?? preview.totalDocuments ?? 0);
    const ready = preview.ready === undefined ? approvedCount > 0 : preview.ready === true;
    renderComposerPreview(preview);
    target.innerHTML = `<div class="admin-card"><h3>${esc(preview.bundleName)}</h3><p class="admin-muted">${esc(preview.bundleCode)} v${esc(preview.bundleVersion)} - ${esc(preview.approvedDocumentCount ?? preview.totalDocuments)} approved document(s), ${esc(preview.totalDocuments)} applicable, ${esc(preview.requiredDocuments)} required</p>${preview.instructions ? `<p>${esc(preview.instructions)}</p>` : ''}${!ready ? '<p class="admin-error">This packet has no approved documents and cannot be sent.</p>' : missing.length ? `<p class="admin-error">Unresolved variables block sending: ${missing.map((key) => `<code>${esc(key)}</code>`).join(', ')}</p>` : '<p class="admin-status-message">All supported variables resolve for this draft.</p>'}${requirements.length ? '<p class="admin-muted">The live preview is open in the pane beside the form. Use the section selector to jump between documents.</p>' : '<p class="admin-muted">This packet has no documents yet. Add owner-approved templates below.</p>'}</div>`;
  } catch (error) {
    if (target) target.textContent = friendly(error);
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
  renderTable(target, ['Order', 'Document', 'Version', 'Stage', 'Condition', 'Required', 'Actions'], (data.items ?? []).map((item, index, all) => [
    esc(item.sort_order),
    esc(item.title),
    esc(item.version_label ?? item.version),
    esc(titleCase(item.enforcement_stage)),
    esc([item.condition_key, item.condition_value].filter(Boolean).join(': ') || '—'),
    Number(item.required) ? 'Yes' : 'No',
    `<div class="admin-actions">${index > 0 ? `<button class="btn btn--ghost btn--small" type="button" data-admin-action="document-item-move" data-dir="up" data-id="${esc(item.template_id)}" data-bundle="${esc(bundleId)}" data-stage="${esc(item.enforcement_stage)}" data-required="${Number(item.required) ? '1' : '0'}">Up</button>` : ''}${index < all.length - 1 ? `<button class="btn btn--ghost btn--small" type="button" data-admin-action="document-item-move" data-dir="down" data-id="${esc(item.template_id)}" data-bundle="${esc(bundleId)}" data-stage="${esc(item.enforcement_stage)}" data-required="${Number(item.required) ? '1' : '0'}">Down</button>` : ''}<button class="btn btn--ghost btn--small" type="button" data-admin-action="document-item-remove" data-id="${esc(item.template_id)}" data-bundle="${esc(bundleId)}">Remove</button></div>`,
  ]), 'This bundle has no documents yet.');
}

async function openDocumentRequest(id: string): Promise<void> {
  showDocumentTab('requests');
  const target = document.querySelector<HTMLElement>('[data-document-request-detail]');
  if (!target) return;
  const data = await api<{
    request?: Record<string, unknown> | null;
    ownerEmail?: { status: string; attempts: number; lastError: string } | null;
  }>(`/api/admin/documents?view=request&id=${encodeURIComponent(id)}`);
  const detail = data.request;
  if (!detail || !detail.request) {
    target.innerHTML = '<p class="admin-muted">That signing request could not be loaded. It may have been removed, or your link may refer to a different record. Open it from Signing Requests.</p>';
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
  let pricingHtml = '';
  try {
    const pricing = JSON.parse(String(request.pricing_snapshot_json ?? '{}')) as Record<string, unknown>;
    if (Number.isFinite(Number(pricing.totalCents))) {
      const money = (value: unknown): string =>
        Number.isFinite(Number(value))
          ? `$${(Number(value) / 100).toFixed(2)}`
          : 'Not recorded';
      const lines = Array.isArray(pricing.lines)
        ? (pricing.lines as Array<Record<string, unknown>>)
            .map((line) => `${esc(line.label)}: ${money(line.amountCents)}`)
            .join(' · ')
        : '';
      pricingHtml = `<div class="admin-record"><p><strong>Signed price</strong> ${money(pricing.totalCents)} · Amount due now ${money(pricing.amountDueNowCents)}${Number(pricing.remainingBalanceCents) ? ` · Remaining ${money(pricing.remainingBalanceCents)}` : ''}</p>${pricing.propertyAddress ? `<p class="admin-muted">${esc(String(pricing.propertyAddress))}</p>` : ''}${lines ? `<p class="admin-muted">${lines}</p>` : ''}</div>`;
    }
  } catch {
    pricingHtml = '';
  }
  target.hidden = false;
  target.innerHTML = `<div class="admin-card"><div class="admin-detail-head"><h2 class="admin-section-title">${esc(request.packet_name || 'Signing request')}</h2><div class="admin-actions">${request.executed_at ? `<a class="btn btn--ghost btn--small" href="/api/admin/documents?view=executed&id=${encodeURIComponent(id)}">Executed copy</a>` : ''}${request.executed_at && ownerEmail?.status !== 'completed' ? `<button class="btn btn--secondary btn--small" type="button" data-admin-action="document-owner-email-retry" data-id="${esc(id)}">Retry owner email</button>` : ''}${awaiting ? `<button class="btn btn--secondary btn--small" type="button" data-admin-action="document-countersign" data-id="${esc(id)}">Countersign and verify</button>` : ''}<button class="btn btn--ghost btn--small" type="button" data-admin-action="document-request-close">Close</button></div></div>
    <dl class="admin-definition"><dt>Status</dt><dd>${esc(titleCase(request.status))}</dd><dt>Subject</dt><dd>${esc(request.subject_type)}</dd><dt>Branch</dt><dd>${esc(request.branch_id || '—')}</dd><dt>Bound signer</dt><dd>${esc(request.signer_email || 'not bound')}</dd><dt>Booking reference</dt><dd>${esc(request.booking_reference || '-')}</dd><dt>Countersigned</dt><dd>${request.counter_signed_at ? `${esc(request.counter_signature_name)} · ${esc(dateTime(request.counter_signed_at))}` : 'Not countersigned'}</dd><dt>Executed copy</dt><dd>${request.executed_at ? `${esc(dateTime(request.executed_at))} · signed copy retained privately` : 'Not available until fully signed'}</dd><dt>Owner email</dt><dd>${esc(ownerEmailLabel)}</dd></dl>${pricingHtml}
    ${signatures.length ? `<div class="admin-table-scroll"><table class="admin-table"><thead><tr><th>Document</th><th>Version</th><th>Signer</th><th>Status</th><th>Signed</th><th>Actions</th></tr></thead><tbody>${signatures.map((signature) => `<tr><td>${esc(signature.title)}</td><td>${esc(signature.template_version)}</td><td>${esc(signature.signer_name)}</td><td><span class="admin-status">${esc(titleCase(signature.status))}</span></td><td>${esc(dateTime(signature.signed_at))}</td><td><div class="admin-actions"><a class="btn btn--ghost btn--small" href="/api/admin/documents?view=download&signatureId=${encodeURIComponent(String(signature.id))}">Download</a>${signature.status === 'awaiting_verification' ? `<button class="btn btn--ghost btn--small" type="button" data-admin-action="document-signature-verify" data-id="${esc(signature.id)}">Verify</button><button class="btn btn--ghost btn--small" type="button" data-admin-action="document-signature-reject" data-id="${esc(signature.id)}">Reject</button>` : ''}</div></td></tr>`).join('')}</tbody></table></div>` : '<p class="admin-muted">No signatures yet.</p>'}</div>`;
}

function storageBranch(): string {
  return document.querySelector<HTMLSelectElement>('[data-admin-storage-branch]')?.value ?? '';
}

function storageFormat(): string {
  return document.querySelector<HTMLSelectElement>('[data-admin-storage-format]')?.value ?? 'csv';
}

async function downloadStorageExport(exportKind: string): Promise<void> {
  const params = new URLSearchParams({ export: exportKind, format: storageFormat() });
  if (storageBranch()) params.set('branch', storageBranch());
  const path = `/api/admin/storage?${params.toString()}`;
  setAppError();
  try {
    let response = await fetch(path, { credentials: 'same-origin' });
    if (response.status === 403) {
      const data = (await response.clone().json().catch(() => ({}))) as { error?: string };
      if (data.error === 'mfa_step_up_required' && (await confirmStepUp())) {
        response = await fetch(path, { credentials: 'same-origin' });
      }
    }
    if (!response.ok) {
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      throw new Error(data.error || `HTTP ${response.status}`);
    }
    const blob = await response.blob();
    const disposition = response.headers.get('Content-Disposition') ?? '';
    const match = /filename="([^"]+)"/i.exec(disposition);
    const filename = match?.[1] ?? `${exportKind}.${storageFormat()}`;
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    setSuccess(`Exported ${filename}.`);
  } catch (error) {
    setAppError(friendly(error));
  }
}

document.querySelector<HTMLElement>('[data-admin-view="storage"]')?.addEventListener('click', (event) => {
  const exportKind = (event.target as HTMLElement).closest<HTMLElement>('[data-admin-export]')?.dataset.adminExport;
  if (exportKind) void downloadStorageExport(exportKind);
});
async function loadStorage(): Promise<void> {
  const params = new URLSearchParams();
  if (storageBranch()) params.set('branch', storageBranch());
  const data = await api<{
    branch?: string;
    database?: { bytes?: number | null; counts?: Record<string, number | null> };
    storage?: { photos?: { configured?: boolean; sampledObjects?: number }; documents?: { configured?: boolean; sampledObjects?: number } };
    backup?: { recentRuns?: Array<Record<string, unknown>>; openIncidents?: Array<Record<string, unknown>> };
    retention?: { policies?: Array<Record<string, unknown>>; holds?: Array<Record<string, unknown>> };
    settings?: Array<Record<string, unknown>>;
    holdOptions?: Array<{ type?: string; id?: string; label?: string }>;
    note?: string;
  }>(`/api/admin/storage${params.toString() ? `?${params.toString()}` : ''}`);
  const kpis = document.querySelector<HTMLElement>('[data-admin-storage-kpis]');
  const counts = data.database?.counts ?? {};
  const latestBackup = (data.backup?.recentRuns ?? []).find((run) => run.status === 'success');
  const backupTime = latestBackup?.recorded_at ? new Date(String(latestBackup.recorded_at)).getTime() : Number.NaN;
  const backupAgeHours = Number.isFinite(backupTime) ? (Date.now() - backupTime) / 3_600_000 : Number.POSITIVE_INFINITY;
  const backupLabel = !latestBackup || !Number.isFinite(backupTime)
    ? 'No successful backup recorded'
    : backupAgeHours > 36
      ? 'Backup is stale'
      : 'Backup is current';
  if (kpis) {
    kpis.innerHTML = [
      ['Database size', data.database?.bytes ? `${(Number(data.database.bytes) / 1024 / 1024).toFixed(2)} MB` : 'Not reported'],
      ['Customers', counts.customers ?? 0],
      ['Appointments', counts.appointments ?? 0],
      ['Invoices', counts.invoices ?? 0],
      ['Document templates', counts.documents ?? 0],
      ['Backup health', backupLabel],
    ].map(([label, value]) => `<div class="admin-card admin-kpi"><p class="admin-kpi__label">${esc(label)}</p><p class="admin-kpi__value">${esc(value)}</p></div>`).join('');
  }
  const note = document.querySelector<HTMLElement>('[data-admin-storage-note]');
  if (note) note.textContent = 'Cloudflare storage totals are controlled in the Cloudflare dashboard. Counts here come from your live operations database.';
  let photoCount = 0;
  let protectedPhotos = 0;
  try {
    const photos = await api<{
      configured?: boolean;
      photos?: Array<Record<string, unknown>>;
      total?: number;
      truncated?: boolean;
      protectedCount?: number;
    }>('/api/admin/storage?view=photos');
    photoCount = Number(photos.total ?? 0);
    protectedPhotos = Number(photos.protectedCount ?? 0);
    const photoTarget = document.querySelector<HTMLElement>('[data-admin-photo-list]');
    if (photoTarget) {
      const records = photos.photos ?? [];
      if (!photos.configured) {
        photoTarget.innerHTML = '<p class="admin-muted">Customer photo storage is not connected in this environment.</p>';
      } else if (!records.length) {
        photoTarget.innerHTML = '<p class="admin-muted">No customer photos are stored.</p>';
      } else {
        photoTarget.innerHTML = `<p class="admin-muted">${photoCount} photo${photoCount === 1 ? '' : 's'} stored${protectedPhotos ? `, ${protectedPhotos} protected by a legal hold` : ''}${photos.truncated ? '. Showing the most recent 300.' : '.'}</p><div class="admin-table-scroll"><table class="admin-table"><thead><tr><th>Customer</th><th>Area</th><th>Received</th><th>Size</th><th>Status</th><th></th></tr></thead><tbody>${records.map((photo) => {
          const uploaded = photo.uploadedAt ? new Date(String(photo.uploadedAt)) : null;
          const older = uploaded ? Date.now() - uploaded.getTime() >= 30 * 86_400_000 : false;
          const status = photo.protected ? 'Protected by legal hold' : older ? 'Older than 30 days' : 'Within 30 days';
          const bytes = Number(photo.bytes ?? 0);
          return `<tr><td>${esc(photo.customer ?? 'Unlinked photo')}${photo.property ? `<br /><span class="admin-muted">${esc(photo.property)}</span>` : ''}</td><td>${esc(titleCase(photo.category))}</td><td>${uploaded ? esc(dateTime(uploaded.toISOString())) : 'Unknown'}</td><td>${bytes ? esc(`${(bytes / 1024 / 1024).toFixed(2)} MB`) : '-'}</td><td>${esc(status)}</td><td>${photo.protected ? '' : `<button class="btn btn--ghost btn--small" type="button" data-admin-action="photo-delete" data-key="${esc(photo.key)}" data-customer="${esc(photo.customer ?? '')}">Delete</button>`}</td></tr>`;
        }).join('')}</tbody></table></div>`;
      }
    }
  } catch {
    photoCount = 0;
    const photoTarget = document.querySelector<HTMLElement>('[data-admin-photo-list]');
    if (photoTarget) photoTarget.innerHTML = '<p class="admin-muted">Customer photos could not be read. Try Refresh.</p>';
  }
  const target = document.querySelector<HTMLElement>('[data-admin-storage-settings]');
  if (target) {
    const cleanup = (data.settings ?? []).find((row) => row.key === 'storage.photo_cleanup_last');
    if (cleanup) {
      try {
        const value = JSON.parse(String(cleanup.value_json ?? '{}')) as Record<string, unknown>;
        target.innerHTML = `<p class="admin-muted">Last photo check: ${esc(dateTime(value.at))}. ${Number(value.dryRun) ? 'Preview only' : `${Number(value.deleted ?? 0)} deleted`}${Number(value.protectedEligible ?? 0) ? `, ${Number(value.protectedEligible)} protected by a legal hold` : ''}.</p>`;
      } catch {
        target.innerHTML = '<p class="admin-muted">Cleanup history could not be read.</p>';
      }
    } else {
      target.innerHTML = '<p class="admin-muted">No photo cleanup has been recorded yet.</p>';
    }
  }
  const holdSelect = document.querySelector<HTMLSelectElement>('[data-admin-hold-options]');
  if (holdSelect) {
    const groups: Array<[string, string]> = [['customer', 'Customers'], ['property', 'Properties'], ['booking', 'Bookings']];
    holdSelect.innerHTML = '<option value="">Choose a customer, property or booking</option>' + groups.map(([type, label]) => {
      const options = (data.holdOptions ?? []).filter((option) => option.type === type && option.id);
      return options.length
        ? `<optgroup label="${esc(label)}">${options.map((option) => `<option value="${esc(type)}|${esc(option.id)}">${esc(option.label)}</option>`).join('')}</optgroup>`
        : '';
    }).join('');
  }
  const backupTarget = document.querySelector<HTMLElement>('[data-admin-storage-backup]');
  if (backupTarget) {
    const runs = data.backup?.recentRuns ?? [];
    const incidents = data.backup?.openIncidents ?? [];
    backupTarget.innerHTML = `<p class="admin-muted">${latestBackup ? `Last successful backup: ${esc(dateTime(latestBackup.recorded_at))}.` : 'No successful backup has been recorded. The scheduled encrypted backup has not run because its GitHub backup credentials are not configured.'} ${incidents.length ? `${incidents.length} open backup incident${incidents.length === 1 ? '' : 's'} need attention.` : ''}</p>` +
      (runs.length ? `<div class="admin-table-scroll"><table class="admin-table"><thead><tr><th>Run</th><th>Status</th><th>Summary</th><th>Recorded</th></tr></thead><tbody>${runs.map((run) => `<tr><td>${esc(run.run_key)}</td><td>${esc(titleCase(run.status))}</td><td>${esc(run.summary)}</td><td>${esc(dateTime(run.recorded_at))}</td></tr>`).join('')}</tbody></table></div>` : '<p class="admin-muted">No backup has been recorded.</p>') +
      (incidents.length ? `<h3 style="font-size:.95rem;margin-top:1rem;">Open incidents</h3><div class="admin-table-scroll"><table class="admin-table"><thead><tr><th>Incident</th><th>Status</th><th>Summary</th><th>Opened</th><th>Escalated</th></tr></thead><tbody>${incidents.map((incident) => `<tr><td>${esc(incident.incident_key)}</td><td>${esc(incident.status)}</td><td>${esc(incident.summary)}</td><td>${esc(dateTime(incident.opened_at))}</td><td>${esc(incident.escalation_sent_at ? dateTime(incident.escalation_sent_at) : 'No')}</td></tr>`).join('')}</tbody></table></div>` : '<p class="admin-muted">No open backup incidents.</p>');
  }
  const retentionTarget = document.querySelector<HTMLElement>('[data-admin-retention]');
  if (retentionTarget) {
    const policies = data.retention?.policies ?? [];
    const holds = data.retention?.holds ?? [];
    retentionTarget.innerHTML = `<h3 style="font-size:.95rem;">Retention policies</h3>`
      + (policies.length
        ? `<div class="admin-table-scroll"><table class="admin-table"><thead><tr><th>Record type</th><th>Retention</th><th>Automatic cleanup</th><th>Status</th><th>Approved</th></tr></thead><tbody>${policies.map((policy) => `<tr><td>${esc(titleCase(policy.record_type))}</td><td>${esc(policy.retention_months)} months</td><td>${Number(policy.automatic_cleanup) ? 'Review only' : 'No'}</td><td>${esc(titleCase(policy.status))}</td><td>${esc(dateTime(policy.approved_at))}</td></tr>`).join('')}</tbody></table></div>`
        : '<p class="admin-muted">No retention policies recorded.</p>')
      + `<h3 style="font-size:.95rem;margin-top:1rem;">Legal holds</h3>`
      + (holds.length
        ? `<div class="admin-table-scroll"><table class="admin-table"><thead><tr><th>Protected record</th><th>Reason</th><th>Status</th><th>Placed</th><th></th></tr></thead><tbody>${holds.map((hold) => {
          const match = (data.holdOptions ?? []).find((option) => option.type === hold.subject_type && option.id === hold.subject_id);
          const subject = match?.label ?? `${titleCase(hold.subject_type)} record`;
          return `<tr><td>${esc(subject)}</td><td>${esc(hold.reason)}</td><td>${esc(titleCase(hold.status))}</td><td>${esc(dateTime(hold.created_at))}</td><td>${hold.status === 'active' ? `<button class="btn btn--ghost btn--small" type="button" data-admin-action="release-legal-hold" data-id="${esc(hold.id)}">Release</button>` : ''}</td></tr>`;
        }).join('')}</tbody></table></div>`
        : '<p class="admin-muted">No legal holds recorded.</p>');
  }
  const status = document.querySelector<HTMLElement>('[data-admin-storage-status]');
  if (status) status.textContent = `Updated ${new Date().toLocaleString()}.${data.branch && data.branch !== 'all' ? ` Branch filter: ${data.branch}.` : ''}`;
  void loadBackupControl().catch(() => undefined);
}

interface BackupControlArchive {
  key: string;
  name: string;
  bytes: number;
  uploadedAt: string | null;
}

interface BackupControlJob {
  id: string;
  operation: string;
  status: string;
  source: string;
  scope: string;
  archiveKey: string;
  summary: string;
  error: string;
  requestedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  detail?: Record<string, unknown>;
}

interface BackupControlOverview {
  configured?: boolean;
  activeJob?: BackupControlJob | null;
  jobs?: BackupControlJob[];
  archives?: BackupControlArchive[];
  storage?: { configured?: boolean; archives?: BackupControlArchive[]; bytes?: number };
  schedule?: {
    enabled: boolean;
    cadence: string;
    utcHour: number;
    utcMinute: number;
    dayOfWeek: number;
    dayOfMonth: number;
    scope: string;
    retentionDaily: number;
    retentionWeekly: number;
    retentionMonthly: number;
  } | null;
}

let backupControlPoll: number | null = null;

function backupBytes(value: number | undefined | null): string {
  const bytes = Math.max(0, Number(value) || 0);
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

function backupOperationLabel(value: string): string {
  if (value === 'restore_test') return 'Isolated restore test';
  return titleCase(value.replaceAll('_', ' '));
}

function backupStatusClass(value: string): string {
  if (value === 'success') return 'admin-status admin-status--success';
  if (value === 'failure' || value === 'cancelled') return 'admin-status admin-status--danger';
  return 'admin-status';
}

function backupEvidence(job: BackupControlJob): string {
  const detail = job.detail ?? {};
  const databases = Array.isArray(detail.databases) ? detail.databases as Array<Record<string, unknown>> : [];
  const parts = [
    detail.r2Verified ? 'R2 verified' : '',
    detail.oneDriveVerified ? 'OneDrive verified' : '',
    detail.restorePassed ? 'Isolated restore passed' : '',
    databases.length
      ? `${databases.map((database) => `${Number(database.tables) || 0} tables`).join(', ')} integrity checked`
      : '',
  ].filter(Boolean);
  return parts.join(' · ');
}

function backupScheduleText(schedule: BackupControlOverview['schedule']): string {
  if (!schedule) return 'Not configured';
  if (!schedule.enabled) return 'Automatic backups off';
  const time = `${String(schedule.utcHour).padStart(2, '0')}:${String(schedule.utcMinute).padStart(2, '0')} UTC`;
  const cadence = schedule.cadence === 'weekly'
    ? `${['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][schedule.dayOfWeek] ?? 'Weekly'} weekly`
    : schedule.cadence === 'monthly'
      ? `Monthly on day ${schedule.dayOfMonth}`
      : 'Daily';
  return `${cadence} at ${time} (${schedule.scope === 'database' ? 'database only' : 'complete'})`;
}

function renderBackupControl(data: BackupControlOverview): void {
  const target = document.querySelector<HTMLElement>('[data-admin-backup-control]');
  if (!target) return;
  const config = target.querySelector<HTMLElement>('[data-admin-backup-config]');
  if (config) {
    config.innerHTML = data.configured
      ? '<p class="small text-muted">Control plane connected. Backups run in the background and continue if you close this page.</p>'
      : '<div class="admin-alert admin-alert--danger"><strong>Backup control is not fully configured.</strong><p>The admin screen cannot start a backup until the existing Worker, D1, R2 backup bucket and owner secrets are connected. No backup was started.</p></div>';
  }
  const jobs = Array.isArray(data.jobs) ? data.jobs : [];
  const lastSuccess = jobs.find((job) => job.status === 'success');
  const archives = Array.isArray(data.storage?.archives)
    ? data.storage!.archives!
    : Array.isArray(data.archives)
      ? data.archives
      : [];
  const kpis = target.querySelector<HTMLElement>('[data-admin-backup-kpis]');
  if (kpis) {
    kpis.innerHTML = [
      ['Schedule', backupScheduleText(data.schedule)],
      ['Last successful', lastSuccess ? dateTime(lastSuccess.finishedAt ?? lastSuccess.requestedAt) : 'None recorded'],
      ['Active job', data.activeJob ? `${backupOperationLabel(data.activeJob.operation)} - ${titleCase(data.activeJob.status)}` : 'None'],
      ['Encrypted archives', `${archives.length} - ${backupBytes(data.storage?.bytes)}`],
    ].map(([label, value]) => `<div class="admin-card admin-kpi"><p class="admin-kpi__label">${esc(label)}</p><p class="admin-kpi__value">${esc(value)}</p></div>`).join('');
  }
  const active = target.querySelector<HTMLElement>('[data-admin-backup-active]');
  if (active) {
    const job = data.activeJob;
    active.innerHTML = job
      ? `<div class="admin-record"><p><strong>${esc(backupOperationLabel(job.operation))}</strong> <span class="${backupStatusClass(job.status)}">${esc(titleCase(job.status))}</span></p>
          <p class="small text-muted">${esc(job.source === 'schedule' ? 'Automatic schedule' : 'Requested by owner')} · ${esc(dateTime(job.requestedAt))}</p>
          <p class="small text-muted">Closing this page does not stop the background job. Refreshing updates the recorded status.</p></div>`
      : '<p class="admin-muted">No backup or restore test is running.</p>';
  }
  const scheduleForm = target.querySelector<HTMLFormElement>('[data-backup-schedule-control]');
  if (scheduleForm && data.schedule) {
    (scheduleForm.elements.namedItem('enabled') as HTMLInputElement).checked = Boolean(data.schedule.enabled);
    (scheduleForm.elements.namedItem('cadence') as HTMLSelectElement).value = data.schedule.cadence;
    (scheduleForm.elements.namedItem('utcHour') as HTMLInputElement).value = String(data.schedule.utcHour);
    (scheduleForm.elements.namedItem('utcMinute') as HTMLInputElement).value = String(data.schedule.utcMinute);
    (scheduleForm.elements.namedItem('dayOfWeek') as HTMLSelectElement).value = String(data.schedule.dayOfWeek);
    (scheduleForm.elements.namedItem('dayOfMonth') as HTMLInputElement).value = String(data.schedule.dayOfMonth);
    (scheduleForm.elements.namedItem('scope') as HTMLSelectElement).value = data.schedule.scope;
    (scheduleForm.elements.namedItem('retentionDaily') as HTMLInputElement).value = String(data.schedule.retentionDaily);
    (scheduleForm.elements.namedItem('retentionWeekly') as HTMLInputElement).value = String(data.schedule.retentionWeekly);
    (scheduleForm.elements.namedItem('retentionMonthly') as HTMLInputElement).value = String(data.schedule.retentionMonthly);
  }
  const history = target.querySelector<HTMLElement>('[data-admin-backup-history]');
  if (history) {
    history.innerHTML = jobs.length
      ? `<div class="admin-table-scroll"><table class="admin-table"><thead><tr><th>Requested</th><th>Operation</th><th>Scope</th><th>Status</th><th>Summary</th><th>Finished</th></tr></thead><tbody>${jobs.map((job) => `<tr><td>${esc(dateTime(job.requestedAt))}</td><td>${esc(backupOperationLabel(job.operation))}${job.source === 'schedule' ? ' (auto)' : ''}</td><td>${esc(job.scope === 'database' ? 'Database' : 'Complete')}</td><td><span class="${backupStatusClass(job.status)}">${esc(titleCase(job.status))}</span>${job.error ? `<div class="small text-muted">${esc(job.error)}</div>` : ''}</td><td>${esc(job.summary || '—')}${backupEvidence(job) ? `<div class="small text-muted">${esc(backupEvidence(job))}</div>` : ''}</td><td>${esc(job.finishedAt ? dateTime(job.finishedAt) : '—')}</td></tr>`).join('')}</tbody></table></div>`
      : '<p class="admin-muted">No backup jobs recorded yet.</p>';
  }
  const archiveTarget = target.querySelector<HTMLElement>('[data-admin-backup-archives]');
  if (archiveTarget) {
    archiveTarget.innerHTML = archives.length
      ? `<div class="admin-table-scroll"><table class="admin-table"><thead><tr><th>Archive</th><th>Size</th><th>Uploaded</th><th>Actions</th></tr></thead><tbody>${archives.map((archive) => `<tr><td>${esc(archive.name)}</td><td>${esc(backupBytes(archive.bytes))}</td><td>${esc(archive.uploadedAt ? dateTime(archive.uploadedAt) : '—')}</td><td><div class="admin-actions"><button class="btn btn--ghost btn--small" type="button" data-admin-backup-action="download" data-key="${esc(archive.key)}">Download</button><button class="btn btn--ghost btn--small" type="button" data-admin-backup-action="verify" data-key="${esc(archive.key)}">Verify</button><button class="btn btn--ghost btn--small" type="button" data-admin-backup-action="restore" data-key="${esc(archive.key)}">Restore test</button></div></td></tr>`).join('')}</tbody></table></div>`
      : '<p class="admin-muted">No encrypted archives are listed. Configure the private backup bucket or start a backup.</p>';
  }
  if (backupControlPoll) {
    window.clearTimeout(backupControlPoll);
    backupControlPoll = null;
  }
  if (data.activeJob && (data.activeJob.status === 'queued' || data.activeJob.status === 'running')) {
    backupControlPoll = window.setTimeout(() => {
      const view = document.querySelector<HTMLElement>('[data-admin-view="storage"]');
      if (view && !view.hasAttribute('hidden')) void loadBackupControl().catch(() => undefined);
    }, 5000);
  }
}

async function loadBackupControl(): Promise<void> {
  const target = document.querySelector<HTMLElement>('[data-admin-backup-control]');
  if (!target) return;
  const status = target.querySelector<HTMLElement>('[data-admin-backup-status]');
  if (status) status.textContent = 'Checking backup status…';
  try {
    const data = await api<BackupControlOverview>('/api/admin/backup');
    renderBackupControl(data);
    if (status) status.textContent = `Backup controls checked ${new Date().toLocaleString()}.`;
  } catch (error) {
    if (status) status.textContent = friendly(error);
    const config = target.querySelector<HTMLElement>('[data-admin-backup-config]');
    if (config) config.innerHTML = '<p class="small text-muted">Backup control status could not be read. Existing backups and records are unchanged.</p>';
  }
}

async function startBackup(scope: 'complete' | 'database'): Promise<void> {
  const status = document.querySelector<HTMLElement>('[data-admin-backup-status]');
  const confirmed = await adminConfirm({
    title: scope === 'complete' ? 'Start a complete application backup?' : 'Start a database backup?',
    body: `<p>${scope === 'complete' ? 'The operations database and private application objects will be included.' : 'Only the operations database will be included.'} The encrypted archive is uploaded to the private backup bucket and OneDrive, then independently verified.</p><p>No customer email or payment is affected. The job continues if you close this page.</p>`,
    confirmLabel: 'Start backup',
  });
  if (!confirmed) return;
  if (status) status.textContent = 'Starting backup…';
  try {
    await api('/api/admin/backup', {
      method: 'POST',
      body: JSON.stringify({ action: 'start_backup', scope }),
    });
    if (status) status.textContent = 'Backup started. It will continue in the background.';
    await loadBackupControl();
  } catch (error) {
    if (status) status.textContent = friendly(error);
  }
}

async function archiveBackupAction(action: 'verify' | 'restore' | 'download', key: string): Promise<void> {
  const status = document.querySelector<HTMLElement>('[data-admin-backup-status]');
  if (!key) return;
  if (action === 'download') {
    try {
      const result = await api<{ ok?: boolean; url?: string; error?: string }>('/api/admin/backup', {
        method: 'POST',
        body: JSON.stringify({ action: 'download', archiveKey: key }),
      });
      if (!result.url) throw new Error(result.error || 'download_link_failed');
      const link = document.createElement('a');
      link.href = result.url;
      link.rel = 'noopener';
      link.download = key.split('/').pop() ?? 'backup.ssbk';
      document.body.append(link);
      link.click();
      link.remove();
      if (status) status.textContent = 'Encrypted download link opened. The link is short-lived.';
    } catch (error) {
      if (status) status.textContent = friendly(error);
    }
    return;
  }
  const confirmed = await adminConfirm({
    title: action === 'verify' ? 'Verify this encrypted archive?' : 'Run an isolated restore test?',
    body: action === 'verify'
      ? '<p>The background job downloads the encrypted archive from private R2, checks every file hash and verifies the embedded database. It does not touch production.</p>'
      : '<p>The background job downloads the encrypted archive, verifies it, restores it into an isolated temporary directory and checks the restored database. Production is never overwritten.</p>',
    confirmLabel: action === 'verify' ? 'Verify archive' : 'Start restore test',
    danger: action === 'restore',
  });
  if (!confirmed) return;
  if (status) status.textContent = action === 'verify' ? 'Starting verification…' : 'Starting isolated restore test…';
  try {
    await api('/api/admin/backup', {
      method: 'POST',
      body: JSON.stringify({ action: action === 'verify' ? 'verify_archive' : 'restore_test', archiveKey: key }),
    });
    if (status) status.textContent = 'Background job started.';
    await loadBackupControl();
  } catch (error) {
    if (status) status.textContent = friendly(error);
  }
}

async function storageCleanup(dryRun: boolean): Promise<void> {
  const status = document.querySelector<HTMLElement>('[data-admin-storage-status]');
  if (status) status.textContent = dryRun ? 'Checking photos older than 30 days...' : 'Deleting photos older than 30 days...';
  try {
    const result = await api<{ eligible?: number; protectedEligible?: number; deleted?: number; scanned?: number; dryRun?: boolean }>('/api/admin/storage', {
      method: 'POST',
      body: JSON.stringify({ action: 'photo_cleanup', days: 30, dryRun }),
    });
    if (status) {
      const protectedCount = result.protectedEligible ?? 0;
      status.textContent = dryRun
        ? `${result.eligible ?? 0} photo${result.eligible === 1 ? '' : 's'} older than 30 days; ${protectedCount} protected by a legal hold; nothing deleted.`
        : `${result.deleted ?? 0} photo${result.deleted === 1 ? '' : 's'} deleted; ${protectedCount} protected by a legal hold.`;
    }
    await loadStorage();
  } catch (error) {
    if (status) status.textContent = friendly(error);
  }
}

document.querySelector<HTMLElement>('[data-admin-view="storage"]')?.addEventListener('click', (event) => {
  const target = (event.target as HTMLElement).closest<HTMLElement>('[data-admin-action]');
  const action = target?.dataset.adminAction;
  if (action === 'storage-refresh') void loadStorage().catch((error) => setAppError(friendly(error)));
  if (action === 'storage-apply-branch') void loadStorage().catch((error) => setAppError(friendly(error)));
  if (action === 'photo-delete') {
    const key = target?.dataset.key ?? '';
    const customer = target?.dataset.customer || 'this cleaning';
    void adminConfirm({
      title: 'Delete this photo?',
      body: `<p>The photo for <strong>${esc(customer)}</strong> will be permanently removed. This cannot be undone.</p><p>Financial, legal, booking and agreement records are not affected.</p>`,
      confirmLabel: 'Delete photo permanently',
      danger: true,
    }).then(async (confirmed) => {
      if (!confirmed) return;
      const status = document.querySelector<HTMLElement>('[data-admin-storage-status]');
      if (status) status.textContent = 'Deleting photo...';
      try {
        await api('/api/admin/storage', { method: 'POST', body: JSON.stringify({ action: 'photo_delete', key }) });
        if (status) status.textContent = 'Photo deleted.';
        await loadStorage();
      } catch (error) {
        if (status) status.textContent = friendly(error);
      }
    });
  }
  if (action === 'release-legal-hold') {
    void adminConfirm({
      title: 'Release this legal hold?',
      body: '<p>The record remains preserved. Releasing the hold only allows normal retention and cleanup to apply again.</p>',
      confirmLabel: 'Release hold',
    }).then(async (confirmed) => {
      if (!confirmed) return;
      try {
        await api('/api/admin/storage', {
          method: 'POST',
          body: JSON.stringify({ action: 'release_legal_hold', holdId: target?.dataset.id ?? '' }),
        });
        await loadStorage();
      } catch (error) {
        setAppError(friendly(error));
      }
    });
  }
  if (action === 'storage-cleanup-preview') void storageCleanup(true);
  if (action === 'storage-cleanup-run') {
    void adminConfirm({
      title: 'Delete photos older than 30 days?',
      body: '<p>Only customer photos older than 30 days are removed. Photos protected by a legal hold are kept. Financial, legal, booking and agreement records are never touched.</p>',
      confirmLabel: 'Delete eligible photos',
      danger: true,
    }).then((confirmed) => {
      if (confirmed) void storageCleanup(false);
    });
  }
});

document.querySelector<HTMLElement>('[data-admin-view="storage"]')?.addEventListener('click', (event) => {
  const target = (event.target as HTMLElement).closest<HTMLElement>('[data-admin-backup-action]');
  const action = target?.dataset.adminBackupAction;
  if (!action) return;
  if (action === 'refresh') {
    void loadBackupControl().catch((error) => setAppError(friendly(error)));
    return;
  }
  if (action === 'start-complete') {
    void startBackup('complete');
    return;
  }
  if (action === 'start-database') {
    void startBackup('database');
    return;
  }
  const key = target?.dataset.key ?? '';
  if (action === 'download' || action === 'verify' || action === 'restore') {
    void archiveBackupAction(action, key);
  }
});

document.addEventListener('submit', (event) => {
  const form = event.target as HTMLFormElement;
  if (!form.matches('[data-backup-schedule-control]')) return;
  event.preventDefault();
  const data = new FormData(form);
  const status = document.querySelector<HTMLElement>('[data-admin-backup-schedule-status]');
  if (status) status.textContent = 'Saving backup schedule…';
  void api('/api/admin/backup', {
    method: 'POST',
    body: JSON.stringify({
      action: 'save_schedule',
      enabled: data.get('enabled') === 'on',
      cadence: data.get('cadence'),
      utcHour: data.get('utcHour'),
      utcMinute: data.get('utcMinute'),
      dayOfWeek: data.get('dayOfWeek'),
      dayOfMonth: data.get('dayOfMonth'),
      scope: data.get('scope'),
      retentionDaily: data.get('retentionDaily'),
      retentionWeekly: data.get('retentionWeekly'),
      retentionMonthly: data.get('retentionMonthly'),
    }),
  })
    .then(() => {
      if (status) status.textContent = 'Backup schedule saved.';
      return loadBackupControl();
    })
    .catch((error) => {
      if (status) status.textContent = friendly(error);
    });
});

document.addEventListener('submit', (event) => {
  const form = event.target as HTMLFormElement;
  if (!form.matches('[data-retention-policy], [data-legal-hold]')) return;
  event.preventDefault();
  const data = new FormData(form);
  const status = document.querySelector<HTMLElement>('[data-admin-retention-status]');
  const isPolicy = form.matches('[data-retention-policy]');
  const subjectChoice = String(data.get('subjectChoice') ?? '');
  const separator = subjectChoice.indexOf('|');
  const subjectType = separator > 0 ? subjectChoice.slice(0, separator) : '';
  const subjectId = separator > 0 ? subjectChoice.slice(separator + 1) : '';
  const body = isPolicy
    ? {
        action: 'save_retention_policy',
        recordType: data.get('recordType'),
        retentionMonths: data.get('retentionMonths'),
        status: data.get('status'),
        description: data.get('description'),
        automaticCleanup: data.get('automaticCleanup') === 'on',
      }
    : {
        action: 'create_legal_hold',
        subjectType,
        subjectId,
        reason: data.get('reason'),
      };
  if (status) status.textContent = 'Saving...';
  void api('/api/admin/storage', { method: 'POST', body: JSON.stringify(body) })
    .then(() => {
      if (status) status.textContent = isPolicy ? 'Retention policy saved.' : 'Legal hold recorded.';
      form.reset();
      return loadStorage();
    })
    .catch((error) => {
      if (status) status.textContent = friendly(error);
    });
});
async function loadPromotions(): Promise<void> {
  const target = document.querySelector<HTMLElement>('[data-admin-promotions]');
  if (!target) return;
  const data = await api<{
    promotions?: Array<Record<string, unknown>>;
    legacyPromotions?: Array<Record<string, unknown>>;
  }>('/api/admin/promotions');
  const promotions = [...(data.promotions ?? []), ...(data.legacyPromotions ?? [])];
  renderTable(target, ['Name', 'Code', 'Type', 'Discount', 'Scope', 'Services', 'Branches', 'Window', 'Booking / service deadline', 'Used', 'Status', 'Actions'], promotions.map((promotion) => [
    `<span>${esc(promotion.name)}</span>${promotion.source ? `<br /><span class="admin-muted">${esc(titleCase(promotion.source))}</span>` : ''}`,
    esc(promotion.code),
    esc(titleCase(promotion.kind)),
    promotion.kind === 'percent' ? `${esc(promotion.percent)}%` : money(promotion.valueCents),
    esc(titleCase(promotion.scope ?? 'cleaning')),
    esc((promotion.services as string[] | undefined)?.join(', ') || '-'),
    esc((promotion.branches as string[] | undefined)?.join(', ') || '-'),
    `${esc(dateTime(promotion.startsAt))} - ${esc(dateTime(promotion.expiresAt))}`,
    [
      promotion.bookingDeadlineAt ? `Booking: ${esc(dateTime(promotion.bookingDeadlineAt))}` : '',
      promotion.serviceDeadlineAt ? `Service: ${esc(dateTime(promotion.serviceDeadlineAt))}` : '',
    ].filter(Boolean).join(' · ') || '-',
    `${esc(promotion.redeemedCount ?? 0)} / ${promotion.maxRedemptions ? esc(promotion.maxRedemptions) : 'unlimited'}`,
    `<span class="admin-status">${esc(titleCase(promotion.displayStatus ?? promotion.status))}</span>`,
    promotion.editable === false
      ? `<span class="admin-muted">${esc(promotion.note ?? 'Managed in code')}</span>`
      : `<div class="admin-actions"><button class="btn btn--ghost btn--small" type="button" data-promotion-edit="${esc(promotion.id)}">Edit</button>${promotion.status === 'active' ? `<button class="btn btn--ghost btn--small" type="button" data-promotion-status="${esc(promotion.id)}" data-status="disabled">Deactivate</button>` : `<button class="btn btn--ghost btn--small" type="button" data-promotion-status="${esc(promotion.id)}" data-status="active">Activate</button>`}<button class="btn btn--ghost btn--small" type="button" data-promotion-duplicate="${esc(promotion.id)}">Duplicate</button></div>`,
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
  set('bookingDeadlineAt', promotion.bookingDeadlineAt ? String(promotion.bookingDeadlineAt).slice(0, 16) : '');
  set('serviceDeadlineAt', promotion.serviceDeadlineAt ? String(promotion.serviceDeadlineAt).slice(0, 16) : '');
  set('maxRedemptions', promotion.maxRedemptions ?? 0);
  set('perCustomerLimit', promotion.perCustomerLimit ?? 1);
  set('status', promotion.status ?? 'draft');
  set('scope', promotion.scope ?? 'cleaning');
  for (const box of form.querySelectorAll<HTMLInputElement>('input[name="services"]')) {
    box.checked = Array.isArray(promotion.services) && promotion.services.includes(box.value);
  }
  for (const box of form.querySelectorAll<HTMLInputElement>('input[name="branches"]')) {
    box.checked = Array.isArray(promotion.branches) && promotion.branches.includes(box.value);
  }
  for (const [name, value] of [['newCustomersOnly', promotion.newCustomersOnly], ['recurringOnly', promotion.recurringOnly], ['firstVisitOnly', promotion.firstVisitOnly], ['combinable', promotion.combinable], ['supportiveStackable', promotion.supportiveStackable]] as Array<[string, unknown]>) {
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
    bookingDeadlineAt: iso(data.get('bookingDeadlineAt')),
    serviceDeadlineAt: iso(data.get('serviceDeadlineAt')),
    maxRedemptions: Number(data.get('maxRedemptions') ?? 0),
    perCustomerLimit: Number(data.get('perCustomerLimit') ?? 1),
    status: data.get('status'),
    scope: data.get('scope'),
    newCustomersOnly: data.get('newCustomersOnly') === 'on',
    recurringOnly: data.get('recurringOnly') === 'on',
    firstVisitOnly: data.get('firstVisitOnly') === 'on',
    combinable: data.get('combinable') === 'on',
    supportiveStackable: data.get('supportiveStackable') === 'on',
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
    if (view === 'quick-estimate') await loadQuickEstimate();
    if (view === 'recurring') await loadRecurring();
    if (view === 'jobs') await loadJobs();
    if (view === 'careers') await loadCareers();
    if (view === 'communications') await loadCommunications();
    if (view === 'documents') await loadDocuments();
    if (view === 'timekeeping') await loadTimekeeping();
    if (view === 'finance') await loadFinance();
    if (view === 'gift') await loadGifts();
    if (view === 'reports') await loadReports();
    if (view === 'storage') await loadStorage();
    if (view === 'promotions') await loadPromotions();
    if (view === 'reviews') await loadReviews();
    if (view === 'pricing') await loadPricingView();
    if (view === 'branches') await loadBranchView();
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
    const result = await api<{ actor?: AdminActor; csrf?: string; mfaRequired?: boolean; challengeToken?: string; mfaMethod?: string; resendAfterSeconds?: number }>('/api/admin/auth', {
      method: 'POST',
      body: JSON.stringify({ action: 'login', email: data.get('email'), password: data.get('password') }),
    });
    if (result.mfaRequired && result.challengeToken) {
      mfaChallenge = result.challengeToken;
      mfaMethod = result.mfaMethod === 'email' ? 'email' : 'totp';
      mfaResendAt = Date.now() + (result.resendAfterSeconds ?? 60) * 1000;
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
    mfaChallenge = '';
    mfaMethod = 'totp';
  } catch (error) { setError(friendly(error)); }
});

document.querySelector<HTMLButtonElement>('[data-admin-mfa-resend]')?.addEventListener('click', () => {
  if (!mfaChallenge || mfaMethod !== 'email' || Date.now() < mfaResendAt) return;
  if (mfaGateStatus) mfaGateStatus.textContent = 'Sending a new code…';
  void api<{ expiresAt?: string; resendAfterSeconds?: number }>('/api/admin/auth', {
    method: 'POST',
    body: JSON.stringify({ action: 'mfa_resend', challengeToken: mfaChallenge }),
  })
    .then((result) => {
      mfaResendAt = Date.now() + (result.resendAfterSeconds ?? 60) * 1000;
      if (mfaGateStatus) mfaGateStatus.textContent = 'A new six-digit code was sent to the account email.';
      configureMfaGate();
    })
    .catch((error) => {
      if (mfaGateStatus) mfaGateStatus.textContent = friendly(error);
    });
});

document.querySelector<HTMLButtonElement>('[data-admin-mfa-cancel]')?.addEventListener('click', () => {
  mfaChallenge = '';
  mfaMethod = 'totp';
  mfaResendAt = 0;
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
  const customerId = (event.target as HTMLSelectElement).value;
  void loadManualContext(customerId).catch((error) => setAppError(friendly(error)));
  void loadManualAgreements(customerId);
  syncManualAppointmentMode();
});
document.querySelector<HTMLInputElement>('[data-manual-customer-search]')?.addEventListener('input', (event) => {
  const term = (event.target as HTMLInputElement).value.trim().toLowerCase();
  const select = manualField<HTMLSelectElement>('customerId');
  if (!select) return;
  let visible = 0;
  for (const option of select.options) {
    if (!option.value) continue;
    const match = !term || option.text.toLowerCase().includes(term);
    option.hidden = !match;
    option.disabled = !match;
    if (match) visible += 1;
  }
  if (term && visible === 0) {
    select.insertAdjacentHTML('beforeend', '<option value="" disabled data-manual-no-match>No active customers match this filter — create one below</option>');
  } else {
    select.querySelector('[data-manual-no-match]')?.remove();
  }
});
document.querySelector<HTMLInputElement>('[data-manual-customer-search]')?.addEventListener('search', (event) => {
  if ((event.target as HTMLInputElement).value === '') {
    document.querySelector('[data-manual-no-match]')?.remove();
    for (const option of manualField<HTMLSelectElement>('customerId')?.options ?? []) {
      option.hidden = false;
      option.disabled = false;
    }
  }
});
manualField<HTMLSelectElement>('propertyId')?.addEventListener('change', () => applyManualProperty());
manualField<HTMLSelectElement>('engine')?.addEventListener('change', () => syncManualEngine());
manualField<HTMLSelectElement>('appointmentType')?.addEventListener('change', () => syncManualAppointmentMode());
manualField<HTMLSelectElement>('pricingMethod')?.addEventListener('change', () => syncManualPricingFields());
manualField<HTMLSelectElement>('discountType')?.addEventListener('change', () => syncManualPricingFields());
for (const name of ['customPrice', 'discountValue']) {
  manualField<HTMLInputElement>(name)?.addEventListener('input', () => updateManualPricingSummary());
}
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
  customerPage.q = String(data.get('q') ?? '');
  customerPage.status = String(data.get('status') ?? 'active');
  customerPage.sort = String(data.get('sort') ?? 'created_at');
  customerPage.limit = Number(data.get('pageSize') ?? 25) || 25;
  customerPage.offset = 0;
  void loadCustomers().catch((error) => setAppError(friendly(error)));
});

document.querySelector<HTMLFormElement>('[data-admin-finance-filter]')?.addEventListener('submit', (event) => {
  event.preventDefault();
  const data = new FormData(event.currentTarget as HTMLFormElement);
  financePage.status = String(data.get('status') ?? '');
  financePage.q = String(data.get('q') ?? '');
  financePage.sort = String(data.get('sort') ?? 'created_at');
  financePage.limit = Number(data.get('pageSize') ?? 25) || 25;
  financePage.offset = 0;
  void loadFinance().catch((error) => setAppError(friendly(error)));
});

document.querySelector<HTMLElement>('[data-review-refresh]')?.addEventListener('click', () => {
  void loadReviews().catch((error) => setAppError(friendly(error)));
});
function setReviewStatus(message: string): void {
  const status = document.querySelector<HTMLElement>('[data-review-status-message]');
  if (status) status.textContent = message;
}

async function openReviewPreview(appointmentId: string): Promise<void> {
  const result = await api<{ subject: string; html: string; recipient?: string }>(
    `/api/admin/reviews?view=preview&appointmentId=${encodeURIComponent(appointmentId)}`,
  );
  const preview = window.open('', '_blank');
  if (!preview) {
    setReviewStatus('The preview window was blocked. Allow pop-ups and try again.');
    return;
  }
  const banner = `<div style="font-family:Arial,sans-serif;background:#f4e9de;color:#5f2d35;padding:10px 16px;text-align:center;font-size:13px;">Preview only · recipient ${esc(result.recipient || 'no email on file')} · subject: ${esc(result.subject)}</div>`;
  preview.document.open();
  preview.document.write(`${banner}${result.html}`);
  preview.document.close();
}

async function sendReviewInvitation(appointmentId: string): Promise<void> {
  const row = reviewEligibleRows.find((entry) => String(entry.id) === appointmentId);
  if (!row) return;
  const customer = [row.first_name, row.last_name].filter(Boolean).join(' ') || 'Customer';
  const recipient = String(row.customer_email ?? '');
  const confirmed = await adminConfirm({
    title: 'Send this review invitation?',
    body: `<p><strong>${esc(customer)}</strong> at ${esc(recipient || 'no email on file')}</p><p>${esc(reviewServiceLabel(row))} · completed ${esc(dateTime(row.start_at, row.branch_id))}</p><p>${esc([row.line1, row.city].filter(Boolean).join(', ') || 'Property not linked')} · ${esc(row.branch_name || row.branch_id || '')}</p><p>The customer will receive a separate thank-you email with the official Pensacola Google review link. This is a real customer email. Use Preview first if you want to read the exact wording.</p><p>Automation does not need to be enabled for this owner-authorized send.</p>`,
    confirmLabel: 'Send review invitation',
  });
  if (!confirmed) return;
  setReviewStatus('Creating and sending the review invitation...');
  try {
    const queued = await api<{ id?: string; reason?: string }>('/api/admin/reviews', {
      method: 'POST',
      body: JSON.stringify({ action: 'queue', appointmentId }),
    });
    if (!queued.id) throw new Error(queued.reason || 'review_request_required');
    await api('/api/admin/reviews', {
      method: 'POST',
      body: JSON.stringify({ action: 'send', id: queued.id }),
    });
    setReviewStatus(`The email provider accepted the review invitation for ${recipient}. Confirm it arrived in the customer inbox.`);
    await Promise.all([loadReviews(), loadReviewEligible()]);
  } catch (error) {
    setReviewStatus(friendly(error));
    await Promise.all([loadReviews(), loadReviewEligible()]).catch(() => undefined);
  }
}

document.querySelector<HTMLElement>('[data-review-eligible-list]')?.addEventListener('click', (event) => {
  const preview = (event.target as HTMLElement).closest<HTMLElement>('[data-review-preview-id]');
  if (preview) {
    void openReviewPreview(preview.dataset.reviewPreviewId ?? '').catch((error) => setReviewStatus(friendly(error)));
    return;
  }
  const button = (event.target as HTMLElement).closest<HTMLElement>('[data-review-send-id]');
  if (!button) return;
  void sendReviewInvitation(button.dataset.reviewSendId ?? '');
});

let reviewSearchTimer: number | undefined;
document.querySelector<HTMLInputElement>('[data-review-search]')?.addEventListener('input', () => {
  window.clearTimeout(reviewSearchTimer);
  reviewSearchTimer = window.setTimeout(() => {
    void loadReviewEligible().catch((error) => setReviewStatus(friendly(error)));
  }, 250);
});
document.querySelector<HTMLSelectElement>('[data-review-eligible-filter]')?.addEventListener('change', () => renderReviewEligible());
document.querySelector<HTMLSelectElement>('[data-review-branch]')?.addEventListener('change', () => {
  void loadReviews().catch((error) => setAppError(friendly(error)));
});
document.querySelector<HTMLSelectElement>('[data-review-status]')?.addEventListener('change', () => {
  void loadReviews().catch((error) => setAppError(friendly(error)));
});

document.querySelector<HTMLElement>('[data-admin-review-list]')?.addEventListener('click', (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-review-action]');
  if (!button) return;
  const id = button.dataset.id ?? '';
  const action = button.dataset.reviewAction;
  if (!id) return;
  if (action === 'cancel') {
    void adminConfirm({
      title: 'Cancel this review invitation?',
      body: '<p>The request will be cancelled. No review email will be sent.</p>',
      confirmLabel: 'Cancel invitation',
      danger: true,
    }).then((confirmed) => {
      if (!confirmed) return;
      void api('/api/admin/reviews', { method: 'POST', body: JSON.stringify({ action: 'cancel', id }) })
        .then(() => loadReviews())
        .catch((error) => setAppError(friendly(error)));
    });
  }
  if (action === 'send') {
    void adminConfirm({
      title: 'Send this review invitation now?',
      body: '<p><strong>This sends a real customer email.</strong> Confirm the customer appears in the list and has not already received this invitation.</p>',
      confirmLabel: 'Send review invitation',
    }).then((confirmed) => {
      if (!confirmed) return;
      void api('/api/admin/reviews', { method: 'POST', body: JSON.stringify({ action: 'send', id }) })
        .then(() => loadReviews())
        .catch((error) => setAppError(friendly(error)));
    });
  }
  if (action === 'retry') {
    void api('/api/admin/reviews', { method: 'POST', body: JSON.stringify({ action: 'retry', id }) })
      .then(() => {
        setReviewStatus('Review invitation returned to the queue. Use Send now to retry delivery.');
        return loadReviews();
      })
      .catch((error) => setAppError(friendly(error)));
  }
});

document.querySelector<HTMLElement>('[data-review-eligible-list]')?.addEventListener('click', (event) => {
  const apply = (event.target as HTMLElement).closest<HTMLElement>('[data-review-state-apply]');
  if (!apply) return;
  const customerId = apply.dataset.reviewStateApply ?? '';
  const select = document.querySelector<HTMLSelectElement>(`[data-review-state-select="${CSS.escape(customerId)}"]`);
  const action = select?.value ?? '';
  if (!customerId || !action) {
    setReviewStatus('Choose a review relationship action first.');
    return;
  }
  const labels: Record<string, string> = {
    mark_reviewed: 'Mark this customer as having left a review? No further automatic review requests will be sent.',
    do_not_ask: 'Stop all future review requests for this customer?',
    opt_out: 'Record that this customer opted out of review requests?',
    mark_unknown: 'Record the review status as unknown? Automatic invitations will remain suppressed until you mark them eligible.',
    mark_eligible: 'Make this customer eligible for a future review invitation? Existing delivery history is preserved.',
  };
  void adminConfirm({
    title: 'Update customer review status?',
    body: `<p>${esc(labels[action] ?? 'Apply this review status?')}</p><p class="admin-muted">This changes future review invitations only. It never alters financial, service or signed-document records, and it does not claim Google verified a review unless you specifically mark one as reviewed.</p>`,
    confirmLabel: 'Update review status',
  }).then(async (confirmed) => {
    if (!confirmed) return;
    try {
      await api('/api/admin/reviews', {
        method: 'POST',
        body: JSON.stringify({ action, customerId }),
      });
      setReviewStatus('Customer review status updated. Future review invitations follow this decision.');
      await Promise.all([loadReviews(), loadReviewEligible()]);
    } catch (error) {
      setReviewStatus(friendly(error));
    }
  });
});

for (const prefix of ['manual', 'quick'] as const) {
  document
    .querySelector<HTMLInputElement>(`[data-${prefix}-addon-search]`)
    ?.addEventListener('input', (event) => {
      filterExtras(prefix, (event.target as HTMLInputElement).value);
    });
}

document.addEventListener('click', (event) => {
  const remove = (event.target as HTMLElement).closest<HTMLElement>('[data-admin-action="extra-remove"]');
  if (!remove) return;
  const prefix = remove.dataset.prefix === 'quick' ? 'quick' : 'manual';
  const target = remove.dataset.target ?? '';
  const box = document.querySelector<HTMLInputElement>(`[data-${prefix}-addon][value="${CSS.escape(target)}"]`);
  if (box) {
    box.checked = false;
    updateExtrasSummary(prefix);
  }
});

document.querySelector<HTMLFormElement>('[data-admin-request-filter]')?.addEventListener('submit', (event) => {
  event.preventDefault();
  const data = new FormData(event.currentTarget as HTMLFormElement);
  requestServiceFilter = String(data.get('service') ?? '').trim().toLowerCase();
  requestFromFilter = String(data.get('from') ?? '');
  requestToFilter = String(data.get('to') ?? '');
  selectedRequestIds.clear();
  void loadCalendar(String(data.get('view') ?? 'actionable'), String(data.get('q') ?? ''));
});

document.querySelector<HTMLSelectElement>('[data-admin-recurring-status]')?.addEventListener('change', (event) => {
  recurringStatusFilter = (event.target as HTMLSelectElement).value;
  void loadRecurring().catch((error) => setAppError(friendly(error)));
});

for (const [selector, setter] of [
  ['[data-admin-appointment-status]', (value: string) => { appointmentStatusFilter = value; }],
  ['[data-admin-appointment-range]', (value: string) => { appointmentRangeFilter = value; }],
  ['[data-admin-appointment-employee]', (value: string) => { appointmentEmployeeFilter = value; }],
  ['[data-admin-appointment-service]', (value: string) => { appointmentServiceFilter = value; }],
] as Array<[string, (value: string) => void]>) {
  document.querySelector<HTMLSelectElement>(selector)?.addEventListener('change', (event) => {
    setter((event.target as HTMLSelectElement).value);
    appointmentPage = 0;
    renderUpcomingAppointments();
  });
}

for (const [selector, setter] of [
  ['[data-admin-week-employee]', (value: string) => { weekEmployeeFilter = value; }],
  ['[data-admin-week-service]', (value: string) => { weekServiceFilter = value; }],
  ['[data-admin-week-status]', (value: string) => { weekStatusFilter = value; }],
  ['[data-admin-week-branch]', (value: string) => { weekBranchFilter = value; }],
] as Array<[string, (value: string) => void]>) {
  document.querySelector<HTMLSelectElement>(selector)?.addEventListener('change', (event) => {
    setter((event.target as HTMLSelectElement).value);
    renderWeekBoard(weekAppointments);
  });
}

document.querySelector<HTMLElement>('[data-admin-requests]')?.addEventListener('change', (event) => {
  const input = event.target as HTMLInputElement;
  if (input.matches('[data-admin-request-select]')) {
    if (input.checked) selectedRequestIds.add(input.value);
    else selectedRequestIds.delete(input.value);
    updateRequestBulkToolbar();
    return;
  }
  if (input.matches('[data-admin-request-select-all-visible]')) {
    if (input.checked) visibleRequestIds.forEach((id) => selectedRequestIds.add(id));
    else visibleRequestIds.forEach((id) => selectedRequestIds.delete(id));
    updateRequestBulkToolbar();
  }
});

document.querySelector<HTMLFormElement>('[data-admin-lead-filter]')?.addEventListener('submit', (event) => {
  event.preventDefault();
  const data = new FormData(event.currentTarget as HTMLFormElement);
  leadPage.status = String(data.get('status') ?? '');
  leadPage.q = String(data.get('q') ?? '');
  leadPage.sort = String(data.get('sort') ?? 'created_at');
  leadPage.limit = Number(data.get('pageSize') ?? 25) || 25;
  leadPage.offset = 0;
  void loadLeads().catch((error) => setAppError(friendly(error)));
});

document.addEventListener('change', (event) => {
  const target = event.target as HTMLInputElement | HTMLSelectElement;
  if (target.matches('[data-lead-select]')) {
    const checked = (target as HTMLInputElement).checked;
    if (checked) selectedLeadIds.add(target.value);
    else selectedLeadIds.delete(target.value);
    updateLeadBulkToolbar();
  }
  if (target.matches('[data-lead-select-all]')) {
    const checked = (target as HTMLInputElement).checked;
    for (const lead of loadedLeads) {
      if (checked) selectedLeadIds.add(String(lead.id));
      else selectedLeadIds.delete(String(lead.id));
    }
    renderLeadRows();
  }
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
    state: value('state'), postalCode: value('postalCode'), latitude: value('latitude'),
    longitude: value('longitude'), precision: value('precision'), propertyType: value('propertyType'),
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
    })
      .then(async () => {
        setSuccess(targetStatus === 'active' ? 'Customer restored to active operations.' : 'Customer moved to the archive.');
        await loadCustomers();
        await openCustomer(customerId);
      })
      .catch((error) => setAppError(friendly(error)));
  }
  if (kind === 'customer-delete') {
    const customerId = value('customerId');
    const obligations = customerObligations.get(customerId);
    const warnings = [
      obligations?.appointments ? `${obligations.appointments} upcoming appointment(s)` : '',
      obligations?.plans ? `${obligations.plans} recurring plan(s)` : '',
      obligations?.invoices ? `${obligations.invoices} invoice(s) with a balance` : '',
      obligations?.documents ? `${obligations.documents} unsigned or partially signed agreement(s)` : '',
    ].filter(Boolean);
    void (async () => {
      const confirmed = await adminConfirm({
        title: 'Are you sure you want to delete this customer?',
        body: `<p>This will move them to your archive. Their historical records will be preserved.</p>${
          warnings.length
            ? `<p><strong>Active obligations remain in place:</strong></p><ul class="admin-confirm-list">${warnings
                .map((warning) => `<li>${esc(warning)}</li>`)
                .join('')}</ul><p>Archiving does not cancel appointments, recurring plans, invoices or signed agreements. Resolve them separately if required.</p>`
            : ''
        }`,
        confirmLabel: 'Delete',
        danger: true,
      });
      if (!confirmed) return;
      try {
        await api('/api/admin/customers', {
          method: 'POST',
          body: JSON.stringify({ action: 'archive', customerId }),
        });
        selectedRequestIds.clear();
        setSuccess('Customer moved to the archive. Historical records were preserved and can be restored.');
        const detail = document.querySelector<HTMLElement>('[data-admin-customer-detail]');
        if (detail) { detail.hidden = true; detail.innerHTML = ''; }
        await loadCustomers();
      } catch (error) {
        setAppError(friendly(error));
      }
    })();
  }
  if (kind === 'customer-erase') {
    const customerId = value('customerId');
    const confirmation = window.prompt('Type DELETE to permanently erase this customer. Retained financial and signed history will be anonymized. This cannot be undone.');
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
  if (kind === 'change-order-create') {
    const appointmentId = value('appointmentId');
    const adjustmentCents = Math.round(Number(value('adjustment')) * 100);
    void api('/api/admin/change-orders', {
      method: 'POST',
      body: JSON.stringify({
        action: 'create',
        appointmentId,
        originalScope: value('originalScope'),
        revisedScope: value('revisedScope'),
        reason: value('reason'),
        adjustmentCents,
        effectiveDate: value('effectiveDate'),
      }),
    })
      .then(() => {
        setSuccess('Change order created and waiting for owner approval.');
        return openCalendarJob(appointmentId);
      })
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
  if (kind === 'tip-allocate') {
    const teamMemberIds = [...form.querySelectorAll<HTMLInputElement>('input[name="teamMemberIds"]:checked')].map(
      (input) => input.value,
    );
    void api('/api/admin/finance', {
      method: 'POST',
      body: JSON.stringify({ action: 'allocate_tip', paymentId: value('paymentId'), teamMemberIds }),
    })
      .then(async () => {
        setSuccess('Gratuity allocation recorded from the confirmed participating cleaners.');
        await openInvoice(value('invoiceId'));
      })
      .catch((error) => setAppError(friendly(error)));
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
    email: value('email'), phone: value('phone'), addressLine1: value('addressLine1'),
    addressUnit: value('addressUnit'), city: value('city'), state: value('state'),
    postalCode: value('postalCode'), latitude: value('latitude'), longitude: value('longitude'),
    precision: value('precision'),
  });
  if (kind === 'request-close') {
    void adminConfirm({ title: 'Close this request?', body: '<p>The pending request is closed and its temporary hold is released. Calendar history is preserved.</p>', confirmLabel: 'Close request' })
      .then((confirmed) => { if (confirmed) void submitRequestAction({ action: 'close', requestId: value('requestId'), reason: value('reason') }); });
  }
  if (kind === 'request-duplicate') {
    void adminConfirm({ title: 'Mark this request as a duplicate?', body: '<p>The original request is not changed. This request is closed as a duplicate.</p>', confirmLabel: 'Mark duplicate' })
      .then((confirmed) => { if (confirmed) void submitRequestAction({ action: 'duplicate', requestId: value('requestId'), duplicateOf: value('duplicateOf') }); });
  }
  if (kind === 'request-archive') {
    void adminConfirm({ title: 'Archive this request?', body: '<p>The request leaves the active queue. Calendar and appointment history are not changed.</p>', confirmLabel: 'Archive request' })
      .then((confirmed) => { if (confirmed) void submitRequestAction({ action: 'archive', requestId: value('requestId') }); });
  }
  if (kind === 'request-reopen') {
    void adminConfirm({ title: 'Reopen this request?', body: '<p>The request returns to the queue for review. No email is sent automatically.</p>', confirmLabel: 'Reopen request' })
      .then((confirmed) => { if (confirmed) void submitRequestAction({ action: 'reopen', requestId: value('requestId') }); });
  }
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
    void api('/api/admin/accounts', { method: 'POST', body: JSON.stringify({ action: 'mfa_disable', password: value('password'), code: value('code'), recoveryCode: value('recoveryCode') }) })
      .then(() => { if (actor) actor.mfaEnabled = false; return loadView('settings'); })
      .catch((error) => setAppError(friendly(error)));
  }
  if (kind === 'mfa-email-enable') {
    void api<{ recoveryCodes?: string[] }>('/api/admin/accounts', {
      method: 'POST',
      body: JSON.stringify({ action: 'mfa_email_enable', challengeToken: emailMfaChallenge, code: value('code') }),
    })
      .then((result) => {
        const target = document.querySelector<HTMLElement>('[data-admin-mfa-setup]');
        if (target) target.innerHTML = `<div class="admin-card"><p><strong>Email verification enabled.</strong></p><p>Save these one-time recovery codes now. They will not be shown again.</p><pre>${(result.recoveryCodes ?? []).map(esc).join('\n')}</pre></div>`;
        if (actor) { actor.mfaEnabled = true; actor.mfaMethod = 'email'; }
        emailMfaChallenge = '';
        void loadView('settings');
      })
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
      const serviceSelect = form.querySelector<HTMLSelectElement>('select[name="serviceCode"]');
      const serviceName = serviceSelect?.selectedOptions[0]?.textContent?.trim() ?? '';
      const description = String(data.get('description') ?? '').trim() || serviceName;
      if (!description) {
        setAppError('Choose a service or enter a description.');
        return;
      }
      void action('/api/admin/finance', {
        action: 'create_invoice',
        customerId: data.get('customerId'),
        serviceCode: data.get('serviceCode'),
        serviceLabel: serviceName,
        serviceDate: data.get('serviceDate') || undefined,
        dueDate: data.get('dueDate'),
        lines: [{ kind: 'service', description, quantity: 1, unitAmountCents: Math.round(amount * 100), totalCents: Math.round(amount * 100) }],
      });
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
  const form = event.currentTarget as HTMLFormElement;
  const data = new FormData(form);
  const title = String(data.get('title') ?? '').trim();
  if (!title) return;
  void api<{ id?: string }>('/api/admin/documents', {
    method: 'POST',
    body: JSON.stringify({
      action: 'create_template',
      title,
      category: data.get('category'),
      version: '1.0',
      signerParty: data.get('signerParty'),
      contentText: '<div class="doc-rich"><p></p></div>',
      legalReviewStatus: data.get('legalReviewStatus'),
    }),
  }).then((created) => {
    if (!created?.id) throw new Error('document_create_failed');
    openDocumentEditor({
      id: created.id,
      title,
      category: data.get('category'),
      version: '1.0',
      signer_party: data.get('signerParty'),
      legal_review_status: data.get('legalReviewStatus'),
      content_text: '<div class="doc-rich"><p></p></div>',
      status: 'draft',
    });
    documentResult('New document created. Format it, save the draft, then approve it when ready.');
    form.reset();
    return loadDocuments();
  }).catch((error) => documentResult(friendly(error), 'error'));
});

document.querySelector<HTMLFormElement>('[data-document-template-edit]')?.addEventListener('submit', (event) => {
  event.preventDefault();
  const form = event.currentTarget as HTMLFormElement;
  const data = new FormData(form);
  void api('/api/admin/documents', {
    method: 'POST',
    body: JSON.stringify({
      action: 'update_draft_template',
      templateId: data.get('templateId'),
      title: data.get('title'),
      category: data.get('category'),
      version: data.get('version'),
      signerParty: data.get('signerParty'),
      contentText: data.get('contentText'),
      effectiveDate: data.get('effectiveDate'),
      legalReviewStatus: data.get('legalReviewStatus'),
      packetNotes: data.get('packetNotes'),
      requiresVerification: data.get('requiresVerification') === 'yes',
      requiresCountersignature: data.get('requiresCountersignature') === 'yes',
    }),
  }).then(() => {
    form.hidden = true;
    documentResult('Draft template updated. Approved templates cannot be edited in place; duplicate them as a new version.');
    return loadDocuments();
  }).catch((error) => documentResult(friendly(error), 'error'));
});

document.querySelector<HTMLButtonElement>('[data-document-edit-cancel]')?.addEventListener('click', () => {
  const form = documentEditForm();
  if (form) form.hidden = true;
});

document.querySelector<HTMLFormElement>('[data-document-template-upload]')?.addEventListener('submit', (event) => {
  event.preventDefault();
  const form = event.currentTarget as HTMLFormElement;
  const formData = new FormData(form);
  formData.set('action', 'upload_template');
  formData.set('version', '1.0');
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

document.querySelector<HTMLFormElement>('[data-document-reminders]')?.addEventListener('submit', (event) => {
  event.preventDefault();
  const form = event.currentTarget as HTMLFormElement;
  const data = new FormData(form);
  const status = document.querySelector<HTMLElement>('[data-document-reminders-status]');
  if (status) status.textContent = 'Saving...';
  void api('/api/admin/documents', {
    method: 'POST',
    body: JSON.stringify({
      action: 'save_reminder_settings',
      enabled: data.get('enabled') === 'on',
      firstHours: Number(data.get('firstHours') ?? 24),
      secondHours: Number(data.get('secondHours') ?? 72),
    }),
  }).then(() => {
    if (status) status.textContent = 'Reminder settings saved.';
  }).catch((error) => {
    if (status) status.textContent = friendly(error);
  });
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
      purpose: data.get('purpose'),
      packetType: data.get('packetType'),
      instructions: data.get('instructions'),
    }),
  }).then(() => {
    documentResult('Packet created.');
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

document.querySelector<HTMLButtonElement>('[data-document-preview]')?.addEventListener('click', () => {
  void previewDocumentPacket().catch((error) => setAppError(friendly(error)));
});

document.querySelector<HTMLFormElement>('[data-document-send]')?.addEventListener('submit', (event) => {
  event.preventDefault();
  void sendDocumentPacket(false).catch((error) => {
    const target = document.querySelector<HTMLElement>('[data-document-send-result]');
    if (target) target.innerHTML = `<p class="admin-error">${esc(friendly(error))}</p>`;
  });
});

document.querySelector<HTMLButtonElement>('[data-document-save-draft]')?.addEventListener('click', () => {
  void sendDocumentPacket(true).catch((error) => {
    const target = document.querySelector<HTMLElement>('[data-document-send-result]');
    if (target) target.innerHTML = `<p class="admin-error">${esc(friendly(error))}</p>`;
  });
});

document.querySelector<HTMLSelectElement>('[data-document-preview-section]')?.addEventListener('change', (event) => {
  const index = String((event.target as HTMLSelectElement).value);
  const frame = composerPreviewFrame();
  const section = frame?.contentWindow?.document.getElementById(`doc-${index}`);
  section?.scrollIntoView({ behavior: 'smooth', block: 'start' });
});

document.querySelector<HTMLSelectElement>('[data-document-preview-zoom]')?.addEventListener('change', () => {
  applyComposerZoom();
});

document.querySelector<HTMLButtonElement>('[data-document-preview-print]')?.addEventListener('click', () => {
  const frame = composerPreviewFrame();
  frame?.contentWindow?.print();
});

document.querySelector<HTMLButtonElement>('[data-document-preview-fullscreen]')?.addEventListener('click', () => {
  const pane = document.querySelector<HTMLElement>('[data-document-preview-pane]');
  if (!pane) return;
  if (document.fullscreenElement) void document.exitFullscreen();
  else void pane.requestFullscreen?.();
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
  if (actionName === 'leads-page') {
    leadPage.offset = Number(target.dataset.offset ?? 0) || 0;
    void loadLeads().catch((error) => setAppError(friendly(error)));
    return;
  }
  if (actionName === 'customers-page') {
    customerPage.offset = Number(target.dataset.offset ?? 0) || 0;
    void loadCustomers().catch((error) => setAppError(friendly(error)));
    return;
  }
  if (actionName === 'careers-page') {
    careerPage.offset = Number(target.dataset.offset ?? 0) || 0;
    void loadCareers().catch((error) => setAppError(friendly(error)));
    return;
  }
  if (actionName === 'invoices-page') {
    financePage.offset = Number(target.dataset.offset ?? 0) || 0;
    void loadFinance().catch((error) => setAppError(friendly(error)));
    return;
  }
  if (actionName === 'audit-page') {
    auditPage.offset = Number(target.dataset.offset ?? 0) || 0;
    void loadSettings().catch((error) => setAppError(friendly(error)));
    return;
  }
  if (actionName === 'dispatch-run-analysis') { void dispatchAction({ action: 'run_analysis' }); return; }
  if (actionName === 'dispatch-run-auto') {
    if (window.confirm('Automatically staff eligible unassigned jobs? Existing assignments and customer times will not change.')) {
      void dispatchAction({ action: 'run_automatic' });
    }
    return;
  }
  if (actionName === 'dispatch-add-timeoff') {
    const form = dispatchProfileForm();
    if (!form) return;
    const data = new FormData(form);
    const memberId = String(data.get('memberId') ?? '');
    const from = String(data.get('unavailableFrom') ?? '');
    const to = String(data.get('unavailableTo') ?? '');
    if (!memberId || !from || !to) {
      dispatchResult('Choose a team member and both unavailability times.', 'error');
      return;
    }
    void dispatchAction({
      action: 'add_time_off',
      memberId,
      from,
      to,
      reason: String(data.get('unavailableReason') ?? ''),
    });
    return;
  }
  if (actionName === 'dispatch-assign') {
    const memberIds = [...document.querySelectorAll<HTMLInputElement>(
      `[data-dispatch-crew-member="${CSS.escape(id)}"]:checked`,
    )].map((input) => input.value);
    if (memberIds.length === 0) {
      setAppError('Select at least one dispatch-ready cleaner for this job.');
      return;
    }
    const names = memberIds.map((memberId) => dispatchMemberName(memberId)).join(', ');
    if (!window.confirm(`Assign ${names} as the crew for this unassigned job? The server will validate the exact crew set, travel, branch and calendar. Customer appointment times will not change.`)) return;
    void dispatchAction({ action: 'assign_job', appointmentId: id, teamMemberIds: memberIds });
    return;
  }
  if (actionName === 'dispatch-retry-calendar') { void dispatchAction({ action: 'retry_calendar', decisionId: id }); return; }
  if (actionName === 'dispatch-approve') { void dispatchAction({ action: 'approve_recommendation', decisionId: id }); return; }
  if (actionName === 'dispatch-reject') { void dispatchAction({ action: 'reject_recommendation', decisionId: id }); return; }
  if (actionName === 'dispatch-defer') { void dispatchAction({ action: 'defer_recommendation', decisionId: id }); return; }
  if (actionName === 'careers-refresh') { void loadCareers().catch((error) => setAppError(friendly(error))); return; }
  if (actionName === 'career-open') { void openCareer(id).catch((error) => setAppError(friendly(error))); return; }
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
  if (actionName === 'alert-document-open') {
    void loadView('documents')
      .then(() => openDocumentRequest(id))
      .catch((error) => setAppError(friendly(error)));
    return;
  }
  if (actionName === 'alert-invoice-open') {
    void loadView('finance')
      .then(() => openInvoice(id))
      .catch((error) => setAppError(friendly(error)));
    return;
  }
  if (actionName === 'request-open') void openRequest(id).catch((error) => setAppError(friendly(error)));
  if (actionName === 'customer-edit') { document.querySelector<HTMLDetailsElement>('[data-customer-edit]')?.setAttribute('open', ''); }
  if (actionName === 'request-close') { const detail = document.querySelector<HTMLElement>('[data-admin-request-detail]'); if (detail) { detail.hidden = true; detail.innerHTML = ''; } }
  if (actionName === 'customer-open') void loadView('customers').then(() => openCustomer(id)).catch((error) => setAppError(friendly(error)));
  if (actionName === 'benefit-preview') void previewCustomerBenefit(id, target.dataset.code ?? 'FRIENDS15');
  if (actionName === 'benefit-apply') void applyCustomerBenefit(id, target.dataset.code ?? 'FRIENDS15');
  if (actionName === 'benefit-remove') void removeCustomerBenefit(id, target.dataset.benefitId ?? '');
  if (actionName === 'customer-create') renderCustomerCreate();
  if (actionName === 'lead-save') {
    const select = document.querySelector<HTMLSelectElement>(`[data-lead-status="${CSS.escape(id)}"]`);
    void action('/api/admin/leads', { action: 'update', leadId: id, status: select?.value ?? '' });
  }
  if (actionName === 'lead-retry') void action('/api/admin/leads', { action: 'retry_notification', leadId: id });
  if (actionName === 'lead-open') void openLead(id).catch((error) => setAppError(friendly(error)));
  if (actionName === 'lead-close') {
    const detail = document.querySelector<HTMLElement>('[data-admin-lead-detail]');
    if (detail) { detail.hidden = true; detail.innerHTML = ''; }
  }
  if (actionName === 'lead-archive' || actionName === 'lead-restore' || actionName === 'lead-delete') {
    const operation = actionName === 'lead-archive' ? 'archive' : actionName === 'lead-restore' ? 'restore' : 'delete';
    void (async () => {
      const confirmed = await adminConfirm({
        title: operation === 'delete' ? 'Permanently delete this disposable inquiry?' : operation === 'restore' ? 'Restore this archived inquiry?' : 'Archive this inquiry?',
        body: `<p>${operation === 'delete' ? 'Permanent deletion is limited to unlinked inquiries with no reservation or quote history. This cannot be undone.' : operation === 'restore' ? 'The inquiry returns to the New queue.' : 'The inquiry leaves the active queue. Historical data is preserved.'}</p>`,
        confirmLabel: titleCase(operation),
        danger: operation === 'delete',
      });
      if (!confirmed) return;
      try {
        await api('/api/admin/leads', { method: 'POST', body: JSON.stringify({ action: operation, leadId: id }) });
        setSuccess(`Inquiry ${operation === 'delete' ? 'deleted' : operation === 'restore' ? 'restored' : 'archived'}.`);
        await loadLeads();
      } catch (error) {
        setAppError(friendly(error));
      }
    })();
  }
  if (actionName === 'lead-select-visible') {
    for (const lead of loadedLeads) selectedLeadIds.add(String(lead.id));
    renderLeadRows();
  }
  if (actionName === 'lead-clear-selection') {
    selectedLeadIds.clear();
    renderLeadRows();
  }
  if (actionName === 'lead-bulk') {
    void leadBulkAction((target.dataset.operation ?? 'archive') as 'archive' | 'restore' | 'delete');
  }
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
  if (actionName === 'document-updates-refresh') {
    void loadDocumentUpdates().catch((error) => setAppError(friendly(error)));
  }
  if (actionName === 'document-update-ack') {
    const materialChange = target.dataset.material === 'yes';
    const note =
      document.querySelector<HTMLTextAreaElement>(
        `[data-document-update-note="${CSS.escape(id)}"]`,
      )?.value.trim() ?? '';
    void api('/api/admin/documents', {
      method: 'POST',
      body: JSON.stringify({ action: 'acknowledge_update', templateId: id, materialChange, note }),
    })
      .then(() => {
        documentResult(
          materialChange
            ? 'Revision acknowledged as a material change. Review the queue before sending any re-signing request.'
            : 'Revision acknowledged as a formatting or nonmaterial change.',
        );
        return loadDocuments();
      })
      .catch((error) => setAppError(friendly(error)));
  }
  if (actionName === 'document-update-compose') {
    prefillComposerFromUpdate(target.dataset.customer ?? '', target.dataset.packet ?? '');
  }
  if (actionName === 'document-approve') void action('/api/admin/documents', { action: 'approve_template', templateId: id });
  if (actionName === 'document-retire') void action('/api/admin/documents', { action: 'retire_template', templateId: id });
  if (actionName === 'document-edit') void openDraftInEditor(id).catch((error) => setAppError(friendly(error)));
  if (actionName === 'document-revise') void startDocumentRevision(id).catch((error) => setAppError(friendly(error)));
  if (actionName === 'document-history') void showTemplateHistory(id).catch((error) => setAppError(friendly(error)));
  if (actionName === 'document-duplicate') {
    void api('/api/admin/documents', { method: 'POST', body: JSON.stringify({ action: 'duplicate_template', templateId: id }) })
      .then(() => { documentResult('Template duplicated as a draft.'); return loadDocuments(); })
      .catch((error) => setAppError(friendly(error)));
  }
  if (actionName === 'document-restore') {
    void api('/api/admin/documents', { method: 'POST', body: JSON.stringify({ action: 'restore_template', templateId: id }) })
      .then(() => { documentResult('Template restored to draft review.'); return loadDocuments(); })
      .catch((error) => setAppError(friendly(error)));
  }
  if (actionName === 'document-family-history') {
    void showFamilyHistory(target.dataset.family ?? '').catch((error) => setAppError(friendly(error)));
  }
  if (actionName === 'document-family-history-close') {
    const panel = document.querySelector<HTMLElement>('[data-document-family-history]');
    if (panel) panel.innerHTML = '';
  }
  if (actionName === 'document-family-archive') {
    const familyKey = target.dataset.family ?? '';
    void adminConfirm({
      title: 'Archive this document family?',
      body: '<p>The family will leave the normal document library and packet selectors. Approved versions, signed records and executed copies are preserved unchanged. Restore it from History &amp; archive when needed.</p>',
      confirmLabel: 'Archive document family',
    }).then((confirmed) => {
      if (!confirmed) return;
      return api('/api/admin/documents', {
        method: 'POST',
        body: JSON.stringify({ action: 'archive_family', familyKey }),
      })
        .then(() => { documentResult('Document family archived. History and executed copies are preserved.'); return loadDocuments(); })
        .catch((error) => setAppError(friendly(error)));
    });
  }
  if (actionName === 'document-family-restore') {
    const familyKey = target.dataset.family ?? '';
    void api('/api/admin/documents', {
      method: 'POST',
      body: JSON.stringify({ action: 'restore_family', familyKey }),
    })
      .then(() => { documentResult('Document family restored to the active library.'); return loadDocuments(); })
      .catch((error) => setAppError(friendly(error)));
  }
  if (actionName === 'document-delete-draft') {
    void adminConfirm({
      title: 'Delete this draft?',
      body: '<p>Only an unreferenced draft is deleted. The current approved document, packet links and every executed signature are untouched.</p>',
      confirmLabel: 'Delete draft',
      danger: true,
    }).then((confirmed) => {
      if (!confirmed) return;
      return api('/api/admin/documents', {
        method: 'POST',
        body: JSON.stringify({ action: 'delete_draft', templateId: id }),
      })
        .then(() => { documentResult('Draft deleted. The approved document remains unchanged.'); return loadDocuments(); })
        .catch((error) => setAppError(friendly(error)));
    });
  }
  if (actionName === 'document-bundle-open') void loadDocumentBundleItems(id).catch((error) => setAppError(friendly(error)));
  if (actionName === 'document-packet-preview') void previewDocumentPacket(id).catch((error) => setAppError(friendly(error)));
  if (actionName === 'document-packet-duplicate') {
    void api('/api/admin/documents', { method: 'POST', body: JSON.stringify({ action: 'duplicate_packet', bundleId: id }) })
      .then(() => { documentResult('Packet duplicated.'); return loadDocuments(); })
      .catch((error) => setAppError(friendly(error)));
  }
  if (actionName === 'document-packet-archive' || actionName === 'document-packet-restore') {
    void api('/api/admin/documents', {
      method: 'POST',
      body: JSON.stringify({ action: actionName === 'document-packet-archive' ? 'archive_packet' : 'restore_packet', bundleId: id }),
    }).then(() => { documentResult(actionName === 'document-packet-archive' ? 'Packet archived.' : 'Packet restored.'); return loadDocuments(); })
      .catch((error) => setAppError(friendly(error)));
  }
  if (actionName === 'document-item-move') {
    const bundleId = target.dataset.bundle ?? '';
    const direction = target.dataset.dir === 'up' ? -1 : 1;
    void api<{ items?: Array<Record<string, unknown>> }>(`/api/admin/documents?view=items&bundleId=${encodeURIComponent(bundleId)}`)
      .then(async (data) => {
        const items = data.items ?? [];
        const index = items.findIndex((item) => String(item.template_id) === id);
        const other = items[index + direction];
        if (index < 0 || !other) return;
        const currentOrder = Number(items[index]?.sort_order) || 0;
        const otherOrder = Number(other.sort_order) || 0;
        for (const [templateId, sortOrder, item] of [
          [id, otherOrder, items[index]],
          [String(other.template_id), currentOrder, other],
        ] as Array<[string, number, Record<string, unknown>]>) {
          await api('/api/admin/documents', {
            method: 'POST',
            body: JSON.stringify({
              action: 'add_item',
              bundleId,
              templateId,
              sortOrder,
              enforcementStage: item.enforcement_stage,
              conditionKey: item.condition_key,
              conditionValue: item.condition_value,
              perBooking: Number(item.per_booking) === 1,
              required: Number(item.required) === 1,
            }),
          });
        }
        await loadDocumentBundleItems(bundleId);
      })
      .catch((error) => setAppError(friendly(error)));
  }
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
  if (actionName === 'document-request-revoke') {
    void adminConfirm({
      title: 'Revoke this signing request?',
      body: '<p>The signing link will stop working immediately. Signatures already captured remain preserved as evidence. This does not delete the request or any signed document.</p>',
      confirmLabel: 'Revoke signing link',
      danger: true,
    }).then((confirmed) => {
      if (!confirmed) return;
      return api('/api/admin/documents', {
        method: 'POST',
        body: JSON.stringify({ action: 'revoke_request', requestId: id, reason: 'Revoked by owner' }),
      })
        .then(() => {
          documentResult('Signing request revoked. The signing link is no longer valid.');
          return loadDocuments();
        })
        .catch((error) => setAppError(friendly(error)));
    });
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
  if (actionName === 'job-open') void openCalendarJob(id).catch((error) => setAppError(friendly(error)));
  if (actionName === 'job-invoice-open') void openCalendarJobInvoice(id).catch((error) => setAppError(friendly(error)));
  if (actionName === 'change-order-approve') {
    const appointmentId = target.dataset.appointment ?? '';
    void api('/api/admin/change-orders', {
      method: 'POST',
      body: JSON.stringify({ action: 'approve', id }),
    })
      .then(() => openCalendarJob(appointmentId))
      .catch((error) => setAppError(friendly(error)));
  }
  if (actionName === 'change-order-decline') {
    const appointmentId = target.dataset.appointment ?? '';
    void adminConfirm({
      title: 'Decline this change order?',
      body: '<p>The proposed change will be recorded as declined. The original agreement and invoice are unchanged.</p>',
      confirmLabel: 'Decline change order',
      danger: true,
    }).then((confirmed) => {
      if (!confirmed) return;
      return api('/api/admin/change-orders', {
        method: 'POST',
        body: JSON.stringify({ action: 'decline', id }),
      })
        .then(() => openCalendarJob(appointmentId))
        .catch((error) => setAppError(friendly(error)));
    });
  }
  if (actionName === 'change-order-send') {
    const appointmentId = target.dataset.appointment ?? '';
    void api<{ signingUrl?: string; emailSent?: boolean; recipient?: string }>('/api/admin/change-orders', {
      method: 'POST',
      body: JSON.stringify({ action: 'send', id }),
    })
      .then(async (result) => {
        await openCalendarJob(appointmentId);
        const area = document.querySelector<HTMLElement>('[data-change-order-result]');
        if (area) {
          area.innerHTML = `<p class="admin-status-message">${result.emailSent ? 'Signing email accepted by the provider.' : 'Email was not sent; share this private link.'} <a href="${esc(result.signingUrl ?? '')}">${esc(result.signingUrl ?? '')}</a></p>`;
        }
      })
      .catch((error) => setAppError(friendly(error)));
  }
  if (actionName === 'change-order-invoice') {
    void api<{ invoice?: { id?: string; number?: string } }>('/api/admin/change-orders', {
      method: 'POST',
      body: JSON.stringify({ action: 'create_invoice', id }),
    })
      .then(async (result) => {
        if (!result.invoice?.id) throw new Error('invoice_not_created');
        closeCalendarDialog();
        setSuccess(`Supplemental invoice ${result.invoice.number ?? ''} created. No email or charge was sent.`);
        await loadView('finance');
        await openInvoice(result.invoice.id);
      })
      .catch((error) => setAppError(friendly(error)));
  }
  if (actionName === 'request-create-invoice') {
    void (async () => {
      try {
        const result = await api<{ invoice?: { id: string; number: string } }>('/api/admin/bookings', {
          method: 'POST',
          body: JSON.stringify({ action: 'invoice', requestId: id, paymentLink: false }),
        });
        setSuccess(`Invoice ${result.invoice?.number ?? ''} created from the agreed price. It has not been emailed and no charge was made.`);
        await openRequest(id);
      } catch (error) {
        setAppError(friendly(error));
      }
    })();
    return;
  }
  if (actionName === 'request-open-invoice') {
    const invoiceId = target.dataset.invoiceId ?? '';
    if (invoiceId) {
      void loadView('finance')
        .then(() => openInvoice(invoiceId))
        .catch((error) => setAppError(friendly(error)));
    }
    return;
  }
  if (actionName === 'customer-billing-portal') {
    setAppError();
    void api<{ url?: string }>('/api/admin/finance', {
      method: 'POST',
      body: JSON.stringify({ action: 'billing_portal', customerId: id }),
    }).then((result) => {
      if (result.url) window.open(result.url, '_blank', 'noopener,noreferrer');
      else setAppError('The billing portal did not return a secure URL.');
    }).catch((error) => setAppError(friendly(error)));
    return;
  }
  if (actionName === 'invoice-link') {
    setAppError();
    void api<{ url: string }>('/api/admin/finance', { method: 'POST', body: JSON.stringify({ action: 'payment_page_link', invoiceId: id }) })
      .then(() => openInvoice(id))
      .catch((error) => setAppError(friendly(error)));
  }
  if (actionName === 'invoice-tip-link') {
    setAppError();
    void api<{ url: string; expiresAt: string }>('/api/admin/finance', {
      method: 'POST',
      body: JSON.stringify({ action: 'tip_link', invoiceId: id }),
    })
      .then((result) => {
        const controls = document.querySelector<HTMLElement>('[data-admin-invoice-controls]');
        controls?.insertAdjacentHTML(
          'beforeend',
          `<p class="admin-status-message" role="status">Optional tip-only link (expires ${esc(dateTime(result.expiresAt))}): <a href="${esc(result.url)}" target="_blank" rel="noopener noreferrer">${esc(result.url)}</a></p>`,
        );
      })
      .catch((error) => setAppError(friendly(error)));
  }
  if (actionName === 'invoice-receipt-resend') {
    setAppError();
    setSuccess();
    void api<{ receipt: string }>('/api/admin/finance', {
      method: 'POST',
      body: JSON.stringify({ action: 'resend_invoice_receipt', invoiceId: id }),
    })
      .then((result) => {
        if (result.receipt === 'sent') setSuccess('Payment receipt resent.');
        else setAppError('The payment receipt could not be sent. Check Resend configuration.');
      })
      .catch((error) => setAppError(friendly(error)));
  }
  if (actionName === 'invoice-email-preview') {
    setAppError();
    void api<{ html: string; hasPaymentLink: boolean }>('/api/admin/finance', {
      method: 'POST',
      body: JSON.stringify({ action: 'preview_invoice_email', invoiceId: id }),
    })
      .then((result) => {
        const preview = window.open('', '_blank');
        if (!preview) {
          setAppError('The preview window was blocked. Allow pop-ups and try again.');
          return;
        }
        const banner = result.hasPaymentLink
          ? ''
          : '<div style="font-family:Arial,sans-serif;background:#fff3cd;color:#5c4300;padding:12px 16px;text-align:center;font-size:14px;">No payment link exists yet. The combined send action will create one before sending.</div>';
        preview.document.open();
        preview.document.write(result.html.replace('</body>', `${banner}</body>`));
        preview.document.close();
      })
      .catch((error) => setAppError(friendly(error)));
  }
  if (actionName === 'invoice-email-link') {
    void sendInvoiceWithConfirmation(id, true);
  }
  if (actionName === 'invoice-email') {
    void sendInvoiceWithConfirmation(id, false);
  }
  if (actionName === 'mfa-start') {
    setAppError();
    void api<{ secret: string; uri: string }>('/api/admin/accounts', { method: 'POST', body: JSON.stringify({ action: 'mfa_setup' }) })
      .then((result) => {
        const target = document.querySelector<HTMLElement>('[data-admin-mfa-setup]');
        if (target) target.innerHTML = `<div class="admin-card"><p><strong>Add this account to your authenticator.</strong></p><p class="admin-code">${esc(result.secret)}</p><p><a href="${esc(result.uri)}">Open authenticator link</a></p><form class="admin-form" data-form="mfa-enable"><label>Current code <input name="code" inputmode="numeric" maxlength="6" required /></label><button class="btn btn--primary btn--small" type="submit">Enable two-step verification</button></form></div>`;
      }).catch((error) => setAppError(friendly(error)));
  }
  if (actionName === 'mfa-email-start') {
    setAppError();
    const password = window.prompt('Confirm your account password before enabling email verification.');
    if (!password) return;
    void api<{ challengeToken?: string; expiresAt?: string; resendAfterSeconds?: number }>('/api/admin/accounts', {
      method: 'POST',
      body: JSON.stringify({ action: 'mfa_email_start', password }),
    })
      .then((result) => {
        emailMfaChallenge = result.challengeToken ?? '';
        const target = document.querySelector<HTMLElement>('[data-admin-mfa-setup]');
        if (target) {
          target.innerHTML = `<div class="admin-card"><p><strong>Check the account email.</strong></p><p>A six-digit code was sent to the administrator email. It expires in five minutes.</p><form class="admin-form" data-form="mfa-email-enable"><label>Email verification code <input name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" required /></label><button class="btn btn--primary btn--small" type="submit">Enable email verification</button></form></div>`;
        }
      })
      .catch((error) => setAppError(friendly(error)));
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
  if (actionName === 'overview-open') {
    const view = target.dataset.view ?? 'overview';
    const filter = target.dataset.filter ?? '';
    void loadView(view)
      .then(() => {
        if (view === 'calendar' && filter === 'pending') {
          const select = document.querySelector<HTMLSelectElement>('[data-admin-request-filter] select[name="view"]');
          if (select) select.value = 'pending';
          return loadCalendar('pending');
        }
        if (view === 'calendar' && filter === 'checkout') {
          setAppError('Checkout sessions are classified in the alert. Abandoned checkouts are ordinary; inspect failed setup/provider sessions in Finance or the request detail.');
        }
        return undefined;
      })
      .catch((error) => setAppError(friendly(error)));
  }
  if (actionName === 'appointments-page') {
    appointmentPage = Math.max(0, Number(target.dataset.page ?? 0) || 0);
    renderUpcomingAppointments();
  }
  if (actionName === 'calendar-prev-week') {
    weekOffset -= 1;
    renderWeekBoard(weekAppointments);
  }
  if (actionName === 'calendar-next-week') {
    weekOffset += 1;
    renderWeekBoard(weekAppointments);
  }
  if (actionName === 'calendar-today') {
    weekOffset = 0;
    renderWeekBoard(weekAppointments);
  }
  if (actionName === 'appointment-open') {
    const requestId = target.dataset.request ?? '';
    if (requestId) {
      void openRequest(requestId).catch((error) => setAppError(friendly(error)));
    } else {
      setAppError('This appointment is not linked to a reservation request. Open Jobs & Team to inspect the appointment.');
    }
  }
  if (actionName === 'overview-recheck') {
    void loadOverview().catch((error) => setAppError(friendly(error)));
  }
  if (actionName === 'request-select-visible') {
    visibleRequestIds.forEach((id) => selectedRequestIds.add(id));
    updateRequestBulkToolbar();
  }
  if (actionName === 'request-select-filtered') {
    filteredRequestIds.forEach((id) => selectedRequestIds.add(id));
    updateRequestBulkToolbar();
  }
  if (actionName === 'request-clear-selection') {
    selectedRequestIds.clear();
    updateRequestBulkToolbar();
  }
  if (actionName === 'request-bulk') {
    const operation = target.dataset.operation ?? '';
    const ids = [...selectedRequestIds];
    if (ids.length === 0) return;
    const labels: Record<string, string> = {
      approve: 'Approve',
      archive: 'Archive',
      restore: 'Restore',
      deny: 'Deny',
      mark_test: 'Mark as test',
      delete_test: 'Delete',
    };
    const label = labels[operation] ?? titleCase(operation);
    void (async () => {
      try {
        const preview = await api<{
          total?: number;
          eligible?: number;
          ineligible?: number;
          results?: Array<{ id: string; ok: boolean; error?: string }>;
        }>('/api/admin/requests', {
          method: 'POST',
          body: JSON.stringify({ action: 'bulk_preview', operation, requestIds: ids }),
        });
        const eligible = Number(preview.eligible ?? 0);
        const ineligible = Number(preview.ineligible ?? 0);
        const reasons = new Map<string, number>();
        for (const entry of preview.results ?? []) {
          if (entry.ok) continue;
          const reason = entry.error ?? 'ineligible';
          reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
        }
        const reasonList = [...reasons.entries()]
          .map(([reason, count]) => `<li>${esc(titleCase(reason.replaceAll('_', ' ')))} (${count})</li>`)
          .join('');
        const confirmed = await adminConfirm({
          title: `${label} selected requests?`,
          body: `<p><strong>${ids.length} selected</strong> · ${eligible} eligible · ${ineligible} protected/ineligible</p>${
            reasonList ? `<ul class="admin-confirm-list">${reasonList}</ul>` : ''
          }<p>${
            operation === 'delete_test'
              ? 'Permanent deletion is limited to unmarked nontransactional test records. Financial, operational and signed evidence is always retained.'
              : 'Customer emails are not sent automatically. Historical records and active obligations are preserved.'
          }</p>`,
          confirmLabel: `${label} ${eligible}`,
          danger: operation === 'deny' || operation === 'delete_test',
        });
        if (!confirmed) return;
        if (eligible === 0) {
          setAppError('Nothing in this selection is eligible for that action. Review the protection reasons.');
          return;
        }
        const result = await api<{
          succeeded?: number;
          failed?: number;
          results?: Array<{ id: string; ok: boolean; error?: string }>;
        }>('/api/admin/requests', {
          method: 'POST',
          body: JSON.stringify({ action: 'bulk', operation, requestIds: ids, confirm: true }),
        });
        const failed = (result.results ?? []).filter((entry) => !entry.ok);
        const resultNode = document.querySelector<HTMLElement>('[data-admin-request-bulk-result]');
        if (resultNode) {
          resultNode.innerHTML = `<ul class="admin-result-list"><li><strong>${result.succeeded ?? 0} completed</strong> · ${
            result.failed ?? 0
          } skipped</li>${failed
            .slice(0, 25)
            .map((entry) => {
              const match = loadedRequests.find((row) => String(row.id) === entry.id);
              const reference = String(match?.quote_reference ?? entry.id);
              return `<li class="is-failed">${esc(reference)} — ${esc(titleCase(String(entry.error ?? 'failed').replaceAll('_', ' ')))}</li>`;
            })
            .join('')}</ul>`;
        }
        if (failed.length) {
          setAppError(`${result.succeeded ?? 0} updated, ${failed.length} skipped. The reasons are listed above.`);
        } else {
          setSuccess(`${result.succeeded ?? 0} request(s) updated.`);
        }
        selectedRequestIds.clear();
        await loadCalendar(currentRequestView);
      } catch (error) {
        setAppError(friendly(error));
      }
    })();
  }
  if (actionName === 'alert-action') {
    const key = target.dataset.key ?? '';
    const alertAction = target.dataset.alertAction ?? '';
    const note =
      document.querySelector<HTMLInputElement>(
        `[data-alert-note="${CSS.escape(key)}"]`,
      )?.value.trim() ?? '';
    if (alertAction === 'resolve' && !note) {
      setAppError('Enter a short resolution note before resolving this alert.');
      return;
    }
    void api('/api/admin/overview', {
      method: 'POST',
      body: JSON.stringify({
        action: alertAction,
        alertKey: key,
        note,
        kind: target.dataset.kind ?? '',
        title: target.dataset.title ?? '',
      }),
    })
      .then(() => loadOverview())
      .catch((error) => setAppError(friendly(error)));
  }
  if (actionName === 'manual-manage-customer') {
    const customerId = manualField<HTMLSelectElement>('customerId')?.value ?? '';
    void loadView('customers')
      .then(() => (customerId ? openCustomer(customerId) : undefined))
      .catch((error) => setAppError(friendly(error)));
  }
  if (actionName === 'manual-availability') void checkManualAvailability();
  if (actionName === 'manual-create-customer') void createManualCustomer();
  if (actionName === 'manual-create') void saveManualBooking('save');
  if (actionName === 'manual-create-confirm') void saveManualBooking('confirm');
  if (actionName === 'manual-create-documents') void saveManualBooking('documents');
  if (actionName === 'manual-create-send-invoice') void saveManualBooking('documents-invoice');
  if (actionName === 'manual-completed-save') void saveCompletedService(false);
  if (actionName === 'manual-completed-invoice') void saveCompletedService(true);
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

document.querySelector<HTMLFormElement>('[data-quick-form]')?.addEventListener('change', (event) => {
  const target = event.target as HTMLElement | null;
  if (target?.matches('[data-quick-engine]')) syncQuickEngine();
  if (target?.matches('[data-quick-customer]')) void applyQuickCustomer().catch((error) => setAppError(friendly(error)));
  if (target?.matches('[data-quick-property]')) applyQuickProperty();
  if (target?.matches('[data-quick-bundle]')) {
    const box = target as HTMLInputElement;
    const required = (box.dataset.bundleRequired ?? '').split(',').filter(Boolean);
    for (const addonId of required) {
      const addon = document.querySelector<HTMLInputElement>(`[data-quick-addon][value="${CSS.escape(addonId)}"]`);
      if (addon) addon.checked = box.checked;
    }
  }
});

document.querySelector<HTMLElement>('[data-admin-view="quick-estimate"]')?.addEventListener('click', (event) => {
  const target = event.target as HTMLElement;
  const actionButton = target.closest<HTMLElement>('[data-quick-action]');
  if (actionButton) {
    const action = actionButton.dataset.quickAction;
    if (action === 'calculate') void quickCalculate();
    if (action === 'save') void quickSave('saved');
    if (action === 'save-draft') void quickSave('draft');
    if (action === 'pdf') void quickDownloadPdf().catch((error) => setAppError(friendly(error)));
    if (action === 'email') void quickEmail().catch((error) => setAppError(friendly(error)));
    if (action === 'discard') void quickDiscard().catch((error) => setAppError(friendly(error)));
    if (action === 'reset') {
      quickEstimateId = '';
      quickEstimateNumber = '';
      quickLastQuote = null;
      quickForm()?.reset();
      syncQuickEngine();
      const result = document.querySelector<HTMLElement>('[data-quick-result]');
      if (result) result.innerHTML = '';
      const convertCard = document.querySelector<HTMLElement>('[data-quick-convert-card]');
      if (convertCard) convertCard.hidden = true;
    }
    return;
  }
  const openButton = target.closest<HTMLElement>('[data-quick-open]');
  if (openButton?.dataset.quickOpen) {
    void openQuickEstimate(openButton.dataset.quickOpen).catch((error) => setAppError(friendly(error)));
    return;
  }
  const convertButton = target.closest<HTMLElement>('[data-quick-convert]');
  if (convertButton?.dataset.quickConvert) {
    const card = document.querySelector<HTMLElement>('[data-quick-convert-card]');
    const form = document.querySelector<HTMLFormElement>('[data-quick-convert]');
    if (card) card.hidden = false;
    if (form) {
      const idField = form.elements.namedItem('id') as HTMLInputElement | null;
      if (idField) idField.value = convertButton.dataset.quickConvert;
    }
    void openQuickEstimate(convertButton.dataset.quickConvert).catch((error) => setAppError(friendly(error)));
    card?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    return;
  }
  const discardButton = target.closest<HTMLElement>('[data-quick-discard]');
  if (discardButton?.dataset.quickDiscard) {
    if (!window.confirm('Discard this Quick Estimate? It remains in the audit record and is never hard-deleted.')) return;
    void api('/api/admin/quick-estimates', {
      method: 'POST',
      body: JSON.stringify({ action: 'discard', id: discardButton.dataset.quickDiscard }),
    }).then(() => loadQuickList()).catch((error) => setAppError(friendly(error)));
  }
});

document.querySelector<HTMLFormElement>('[data-quick-filter]')?.addEventListener('submit', (event) => {
  event.preventDefault();
  const data = new FormData(event.currentTarget as HTMLFormElement);
  void loadQuickList(String(data.get('status') ?? ''), String(data.get('q') ?? '')).catch((error) => setAppError(friendly(error)));
});

document.querySelector<HTMLFormElement>('[data-quick-convert]')?.addEventListener('submit', (event) => {
  event.preventDefault();
  const form = event.currentTarget as HTMLFormElement;
  const data = new FormData(form);
  const status = document.querySelector<HTMLElement>('[data-quick-convert-status]');
  if (status) status.textContent = 'Revalidating the estimate and creating a pending booking...';
  void api<{ reference?: string; requestId?: string }>('/api/admin/quick-estimates', {
    method: 'POST',
    body: JSON.stringify({
      action: 'convert',
      id: data.get('id'),
      customerId: quickValue('customerId'),
      propertyId: quickValue('propertyId'),
      date: data.get('date'),
      start: data.get('start'),
      crewSize: Number(data.get('crewSize') ?? 1),
      notes: data.get('notes'),
    }),
  }).then((result) => {
    if (status) status.textContent = `Pending booking ${result.reference ?? ''} created. Confirm it from Calendar & Requests after required documents are signed.`;
    quickEstimateId = '';
    quickEstimateNumber = '';
    return loadQuickList();
  }).catch((error) => {
    if (status) status.textContent = friendly(error);
  });
});

document.querySelector<HTMLButtonElement>('[data-quick-convert-check]')?.addEventListener('click', () => {
  void quickConvertTimes().catch((error) => {
    const status = document.querySelector<HTMLElement>('[data-quick-convert-status]');
    if (status) status.textContent = friendly(error);
  });
});

void loadAuth();
let documentEditorId = '';

function documentEditorInput(selector: string): HTMLInputElement | HTMLSelectElement | null {
  return document.querySelector<HTMLInputElement | HTMLSelectElement>(`[data-document-editor] ${selector}`);
}

function documentEditorCanvas(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-document-editor-canvas]');
}

function documentEditorHeader(): HTMLInputElement | null {
  return document.querySelector<HTMLInputElement>('[data-document-editor-header]');
}

function documentEditorFooter(): HTMLInputElement | null {
  return document.querySelector<HTMLInputElement>('[data-document-editor-footer]');
}

function richDocumentContent(): string {
  const canvas = documentEditorCanvas();
  const header = documentEditorHeader()?.value.trim() ?? '';
  const footer = documentEditorFooter()?.value.trim() ?? '';
  const parts: string[] = [];
  if (header) parts.push(`<header>${esc(header)}</header>`);
  parts.push(`<div class="doc-body">${canvas?.innerHTML ?? ''}</div>`);
  if (footer) parts.push(`<footer>${esc(footer)}</footer>`);
  return normalizeRichDocumentHtml(parts.join(''));
}

function renderDocumentEditorPreview(): void {
  const frame = document.querySelector<HTMLIFrameElement>('[data-document-editor-preview]');
  if (!frame) return;
  const html = renderBrandedDocumentHtml(richDocumentContent(), { variant: 'preview' });
  frame.srcdoc = `<!doctype html><html><head><meta charset="utf-8"><style>
    @page{size:Letter;margin:.7in .75in}
    body{margin:0;background:#f4ece3;padding:14px}
    ${DOCUMENT_BRAND_CSS}
    .branded-document{min-height:38rem;border:1px solid #dccdbc;border-radius:4px}
    @media print{body{background:#fff;padding:0}.branded-document{border:0;box-shadow:none;min-height:0}}
  </style></head><body>${html}</body></html>`;
}

function selectionInsideEditor(): boolean {
  const canvas = documentEditorCanvas();
  const selection = window.getSelection();
  if (!canvas || !selection || selection.rangeCount === 0) return false;
  const range = selection.getRangeAt(0);
  return canvas.contains(range.commonAncestorContainer);
}

function styleSelection(style: string): void {
  const canvas = documentEditorCanvas();
  if (!canvas) return;
  canvas.focus();
  if (!selectionInsideEditor()) return;
  document.execCommand('styleWithCSS', false, 'true');
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return;
  const range = selection.getRangeAt(0);
  const span = document.createElement('span');
  span.setAttribute('style', style);
  try {
    range.surroundContents(span);
  } catch {
    span.appendChild(range.extractContents());
    range.insertNode(span);
    range.selectNodeContents(span);
    selection.removeAllRanges();
    selection.addRange(range);
  }
}

function runEditorCommand(command: string, value?: string): void {
  const canvas = documentEditorCanvas();
  if (!canvas) return;
  canvas.focus();
  if (!selectionInsideEditor()) {
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(canvas);
    range.collapse(false);
    selection?.removeAllRanges();
    selection?.addRange(range);
  }
  document.execCommand('styleWithCSS', false, 'true');
  document.execCommand(command, false, value);
  renderDocumentEditorPreview();
}

function openDocumentEditor(template: Record<string, unknown>, removed: string[] = [], reused = false): void {
  const editor = document.querySelector<HTMLElement>('[data-document-editor]');
  const canvas = documentEditorCanvas();
  if (!editor || !canvas) return;
  documentEditorId = String(template.id ?? '');
  const raw = String(template.content_text ?? '');
  let header = '';
  let footer = '';
  if (raw.includes('doc-rich')) {
    const doc = new DOMParser().parseFromString(raw, 'text/html');
    header = doc.querySelector('header, [data-doc-header]')?.textContent?.trim() ?? '';
    footer = doc.querySelector('footer, [data-doc-footer]')?.textContent?.trim() ?? '';
    doc.querySelectorAll('header, [data-doc-header], footer, [data-doc-footer]').forEach((node) => node.remove());
    const body = doc.querySelector('.doc-rich') ?? doc.body;
    const bodyInner = body.querySelector(':scope > .doc-body') ?? body;
    canvas.innerHTML = bodyInner.innerHTML;
  } else {
    canvas.innerHTML = renderDocumentHtml(raw, 'doc-rendered');
  }
  const setValue = (selector: string, value: unknown): void => {
    const field = documentEditorInput(selector);
    if (field) field.value = value === null || value === undefined ? '' : String(value);
  };
  const headerField = documentEditorHeader();
  if (headerField) headerField.value = header;
  const footerField = documentEditorFooter();
  if (footerField) footerField.value = footer;
  setValue('[data-document-editor-title]', template.title);
  setValue('[data-document-editor-version]', template.version);
  const versionDisplay = document.querySelector<HTMLElement>('[data-document-editor-version-display]');
  if (versionDisplay) {
    versionDisplay.textContent =
      typeof template.version_label === 'string' && template.version_label
        ? template.version_label
        : displayVersion(template.version);
  }
  setValue('[data-document-editor-category]', template.category);
  setValue('[data-document-editor-signer]', template.signer_party ?? 'customer');
  setValue('[data-document-editor-effective]', template.effective_date ? String(template.effective_date).slice(0, 10) : '');
  setValue('[data-document-editor-review]', template.legal_review_status ?? 'owner_approved');
  const verification = documentEditorInput('[data-document-editor-verification]') as HTMLInputElement | null;
  if (verification) verification.checked = Number(template.requires_verification) === 1;
  const countersignature = documentEditorInput('[data-document-editor-countersignature]') as HTMLInputElement | null;
  if (countersignature) countersignature.checked = Number(template.requires_countersignature) === 1;
  editor.hidden = false;
  renderDocumentEditorPreview();
  const status = document.querySelector<HTMLElement>('[data-document-editor-status]');
  if (status) {
    status.textContent = reused
      ? 'An existing draft revision was reopened. The published version is unchanged.'
      : removed.length
        ? `Revision created. Removed internal notice: ${removed.join('; ')}.`
        : 'Revision created. The published version is unchanged until you approve and publish.';
  }
  const compareResult = document.querySelector<HTMLElement>('[data-document-editor-compare-result]');
  if (compareResult) compareResult.innerHTML = '';
  editor.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function openDraftInEditor(templateId: string): Promise<void> {
  const source = await api<{ template?: Record<string, unknown> }>(
    `/api/admin/documents?view=template&id=${encodeURIComponent(templateId)}`,
  );
  if (!source.template) throw new Error('template_not_found');
  openDocumentEditor(source.template);
}

async function startDocumentRevision(templateId: string): Promise<void> {
  const created = await api<{ id: string; version: string; contentText: string; removed?: string[]; reused?: boolean }>(
    '/api/admin/documents',
    { method: 'POST', body: JSON.stringify({ action: 'create_revision', templateId }) },
  );
  const source = await api<{ template?: Record<string, unknown> }>(
    `/api/admin/documents?view=template&id=${encodeURIComponent(templateId)}`,
  );
  if (!source.template) throw new Error('template_not_found');
  openDocumentEditor(
    {
      ...source.template,
      id: created.id,
      version: created.version,
      content_text: created.contentText,
      status: 'draft',
      supersedes_template_id: templateId,
    },
    created.removed ?? [],
    created.reused === true,
  );
}

async function saveDocumentEditor(): Promise<void> {
  if (!documentEditorId) return;
  const status = document.querySelector<HTMLElement>('[data-document-editor-status]');
  if (status) status.textContent = 'Saving draft revision…';
  try {
    await api('/api/admin/documents', {
      method: 'POST',
      body: JSON.stringify({
        action: 'update_draft_template',
        templateId: documentEditorId,
        title: documentEditorInput('[data-document-editor-title]')?.value ?? '',
        version: documentEditorInput('[data-document-editor-version]')?.value ?? '',
        category: documentEditorInput('[data-document-editor-category]')?.value ?? '',
        signerParty: documentEditorInput('[data-document-editor-signer]')?.value ?? 'customer',
        effectiveDate: documentEditorInput('[data-document-editor-effective]')?.value ?? '',
        legalReviewStatus: documentEditorInput('[data-document-editor-review]')?.value ?? 'owner_approved',
        requiresVerification: (documentEditorInput('[data-document-editor-verification]') as HTMLInputElement | null)?.checked ?? false,
        requiresCountersignature: (documentEditorInput('[data-document-editor-countersignature]') as HTMLInputElement | null)?.checked ?? false,
        contentText: richDocumentContent(),
      }),
    });
    if (status) status.textContent = 'Draft revision saved. The published version and executed agreements are unchanged.';
    await loadDocuments();
  } catch (error) {
    if (status) status.textContent = friendly(error);
  }
}

async function compareDocumentEditor(): Promise<void> {
  if (!documentEditorId) return;
  const target = document.querySelector<HTMLElement>('[data-document-editor-compare-result]');
  if (target) target.textContent = 'Building comparison…';
  try {
    const result = await api<{
      previous?: { title?: string; version?: string; content?: string; contentProblems?: string[] } | null;
      next?: { title?: string; version?: string; content?: string; contentProblems?: string[] } | null;
    }>('/api/admin/documents', { method: 'POST', body: JSON.stringify({ action: 'compare_revision', templateId: documentEditorId }) });
    const previous = result.previous;
    const next = result.next;
    if (!target || !next) return;
    const problems = [...(previous?.contentProblems ?? []), ...(next.contentProblems ?? [])];
    target.innerHTML = `${problems.length ? `<p class="admin-error">Internal wording still detected: ${problems.map((entry) => esc(entry)).join(', ')}</p>` : '<p class="admin-status-message">No internal review notices detected in either version.</p>'}
      <div class="document-compare">
        <div><h4 style="font-size:.85rem;">Published ${esc(previous?.version ?? '')}</h4><pre>${esc(previous?.content ?? 'No previous version.')}</pre></div>
        <div><h4 style="font-size:.85rem;">Draft ${esc(next.version ?? '')}</h4><pre>${esc(next.content ?? '')}</pre></div>
      </div>`;
  } catch (error) {
    if (target) target.textContent = friendly(error);
  }
}

async function publishDocumentEditor(): Promise<void> {
  if (!documentEditorId) return;
  if (!window.confirm('Approve and publish this revision? Every packet using the previous version will move to this version. Prior signers will be flagged for review. Executed agreements are not changed.')) return;
  const status = document.querySelector<HTMLElement>('[data-document-editor-status]');
  if (status) status.textContent = 'Publishing revision…';
  try {
    const result = await api<{ updatedPackets?: number; affectedCustomers?: number }>('/api/admin/documents', {
      method: 'POST',
      body: JSON.stringify({ action: 'publish_revision', templateId: documentEditorId }),
    });
    if (status) {
      status.textContent = `Approved and published. Packets updated: ${result.updatedPackets ?? 0}. Prior signers flagged: ${result.affectedCustomers ?? 0}.`;
    }
    await loadDocuments();
    showDocumentTab('updates');
  } catch (error) {
    if (status) status.textContent = friendly(error);
  }
}

function closeDocumentEditor(): void {
  const editor = document.querySelector<HTMLElement>('[data-document-editor]');
  if (editor) editor.hidden = true;
  documentEditorId = '';
}

function bindDocumentEditor(): void {
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-editor-command]')) {
    if (button.dataset.bound === 'yes') continue;
    button.dataset.bound = 'yes';
    button.addEventListener('click', () => runEditorCommand(button.dataset.editorCommand ?? ''));
  }
  document.querySelector<HTMLSelectElement>('[data-editor-block]')?.addEventListener('change', (event) => {
    const value = (event.target as HTMLSelectElement).value;
    if (value) runEditorCommand('formatBlock', value);
  });
  document.querySelector<HTMLSelectElement>('[data-editor-font]')?.addEventListener('change', (event) => {
    const value = (event.target as HTMLSelectElement).value;
    if (value) runEditorCommand('fontName', value);
  });
  document.querySelector<HTMLSelectElement>('[data-editor-size]')?.addEventListener('change', (event) => {
    const value = (event.target as HTMLSelectElement).value;
    if (value) styleSelection(`font-size:${value}`);
    renderDocumentEditorPreview();
  });
  document.querySelector<HTMLInputElement>('[data-editor-color]')?.addEventListener('change', (event) => {
    runEditorCommand('foreColor', (event.target as HTMLInputElement).value);
  });
  document.querySelector<HTMLButtonElement>('[data-editor-insert-table]')?.addEventListener('click', () => {
    const canvas = documentEditorCanvas();
    if (!canvas) return;
    canvas.focus();
    document.execCommand('insertHTML', false, '<table><tbody><tr><td><strong>Column 1</strong></td><td><strong>Column 2</strong></td></tr><tr><td>&nbsp;</td><td>&nbsp;</td></tr></tbody></table><p><br></p>');
    renderDocumentEditorPreview();
  });
  document.querySelector<HTMLButtonElement>('[data-editor-page-break]')?.addEventListener('click', () => {
    const canvas = documentEditorCanvas();
    if (!canvas) return;
    canvas.focus();
    document.execCommand('insertHTML', false, '<div data-doc-page-break="true"></div><p><br></p>');
    renderDocumentEditorPreview();
  });
  document.querySelector<HTMLButtonElement>('[data-editor-insert-signature]')?.addEventListener('click', () => {
    const select = document.querySelector<HTMLSelectElement>('[data-editor-signature]');
    const party = select?.value === 'employee' ? 'employee' : select?.value === 'customer' ? 'customer' : '';
    if (!party) return;
    const canvas = documentEditorCanvas();
    if (!canvas) return;
    canvas.focus();
    const label = party === 'employee' ? 'Employee signature' : 'Customer signature';
    document.execCommand(
      'insertHTML',
      false,
      `<p data-doc-signature="${party}"><strong>X — Sign here</strong><br />${label}: ______________________________</p><p><br></p>`,
    );
    renderDocumentEditorPreview();
  });
  document.querySelector<HTMLButtonElement>('[data-editor-insert-field]')?.addEventListener('click', () => {
    const field = document.querySelector<HTMLSelectElement>('[data-editor-field]');
    const value = field?.value ?? '';
    if (!value) return;
    const canvas = documentEditorCanvas();
    if (!canvas) return;
    canvas.focus();
    document.execCommand('insertHTML', false, `<span>${esc(value)}</span>`);
    renderDocumentEditorPreview();
  });
  const canvas = documentEditorCanvas();
  if (canvas && canvas.dataset.bound !== 'yes') {
    canvas.dataset.bound = 'yes';
    let timer: number | undefined;
    canvas.addEventListener('input', () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(renderDocumentEditorPreview, 180);
    });
    canvas.addEventListener('paste', (event) => {
      event.preventDefault();
      const text = event.clipboardData?.getData('text/plain') ?? '';
      document.execCommand('insertText', false, text);
    });
  }
  for (const field of [documentEditorHeader(), documentEditorFooter()]) {
    if (!field || field.dataset.bound === 'yes') continue;
    field.dataset.bound = 'yes';
    field.addEventListener('input', renderDocumentEditorPreview);
  }
  document.querySelector<HTMLButtonElement>('[data-document-editor-save]')?.addEventListener('click', () => void saveDocumentEditor());
  document.querySelector<HTMLButtonElement>('[data-document-editor-compare]')?.addEventListener('click', () => void compareDocumentEditor());
  document.querySelector<HTMLButtonElement>('[data-document-editor-publish]')?.addEventListener('click', () => void publishDocumentEditor());
  document.querySelector<HTMLButtonElement>('[data-document-editor-close]')?.addEventListener('click', closeDocumentEditor);
  document.querySelector<HTMLButtonElement>('[data-document-editor-cancel]')?.addEventListener('click', closeDocumentEditor);
  document.querySelector<HTMLButtonElement>('[data-document-editor-print]')?.addEventListener('click', () => {
    document.querySelector<HTMLIFrameElement>('[data-document-editor-preview]')?.contentWindow?.print();
  });
}

bindDocumentEditor();

document.addEventListener('keydown', (event) => {
  const card = (event.target as HTMLElement).closest<HTMLElement>('[data-admin-action="appointment-open"]');
  if (!card || (event.key !== 'Enter' && event.key !== ' ')) return;
  event.preventDefault();
  card.click();
});
