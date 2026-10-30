export {};

interface AdminActor {
  id: string;
  email: string;
  name: string;
  role: string;
  branchId: string | null;
  permissions: string[];
  mfaEnabled: boolean;
}

type GateMode = 'setup' | 'login' | 'mfa' | 'invite' | 'reset';

const gate = document.querySelector<HTMLElement>('[data-admin-gate]');
const app = document.querySelector<HTMLElement>('[data-admin-app]');
const setupForm = document.querySelector<HTMLFormElement>('[data-admin-setup]');
const loginForm = document.querySelector<HTMLFormElement>('[data-admin-login]');
const mfaForm = document.querySelector<HTMLFormElement>('[data-admin-mfa]');
const inviteForm = document.querySelector<HTMLFormElement>('[data-admin-invite]');
const resetForm = document.querySelector<HTMLFormElement>('[data-admin-reset]');
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

const viewMeta: Record<string, [string, string]> = {
  overview: ['Overview', 'Live cleaning-company operations.'],
  calendar: ['Calendar & Requests', 'Pending reservations and upcoming appointments.'],
  leads: ['Leads & Inquiries', 'Website inquiries, delivery status and follow-up.'],
  customers: ['Customers', 'Customer profiles, properties and history.'],
  recurring: ['Recurring Plans', 'Recurring cleaning administration.'],
  jobs: ['Jobs & Team', 'Cleaning jobs, assignments and checklists.'],
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
  finance: 'finance.read',
  gift: 'finance.read',
  reports: 'finance.read',
  settings: 'admin.manage',
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
    rate_limited: 'Too many attempts. Wait a few minutes.',
    credentials_invalid: 'Email or password is incorrect.',
    mfa_invalid: 'That authenticator or recovery code is invalid.',
    email_not_configured: 'Email delivery is not configured.',
    schedule_conflict: 'That time overlaps an existing booking.',
    team_conflict: 'That team member already has an overlapping job.',
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
  for (const element of document.querySelectorAll<HTMLElement>('[data-admin-invite-create]')) {
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
  const inviteToken = params.get('invite') ?? '';
  const resetToken = params.get('reset') ?? '';
  if (inviteToken) return showGate('invite');
  if (resetToken) return showGate('reset');
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

async function loadCalendar(): Promise<void> {
  const data = await api<{ requests?: Array<Record<string, unknown>>; appointments?: Array<Record<string, unknown>> }>('/api/admin/requests');
  const requests = document.querySelector<HTMLElement>('[data-admin-requests]');
  if (requests) {
    renderTable(requests, ['Start', 'Reference', 'Customer', 'Property', 'Status', 'Action'], (data.requests ?? []).map((request) => [
      esc(dateTime(request.start_at)),
      esc(request.quote_reference),
      esc([request.first_name, request.last_name].filter(Boolean).join(' ')),
      esc([request.line1, request.city].filter(Boolean).join(', ')),
      `<span class="admin-status">${esc(request.status)}</span>`,
      request.status === 'pending' && can('booking.write')
        ? `<div class="admin-actions"><button class="btn btn--ghost btn--small" type="button" data-admin-action="request-confirm" data-id="${esc(request.id)}">Confirm</button><button class="btn btn--ghost btn--small" type="button" data-admin-action="request-decline" data-id="${esc(request.id)}">Decline</button></div>`
        : '',
    ]), 'No reservation requests are waiting.');
  }
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
}

async function loadGifts(): Promise<void> {
  const data = await api<{ configured?: boolean; summary?: Record<string, number>; records?: Array<Record<string, unknown>> }>('/api/admin/gifts');
  const target = document.querySelector<HTMLElement>('[data-admin-gifts]');
  if (!target) return;
  if (!data.configured) return renderEmpty(target, 'Gift storage is not configured on this deployment.');
  const summary = data.summary ?? {};
  target.innerHTML = `<div class="admin-grid">${[['Issued', summary.issuedCount ?? 0], ['Active', summary.activeCount ?? 0], ['Outstanding', money(summary.outstandingCents)], ['Redeemed', money(summary.redeemedCents)]].map(([label, value]) => `<div class="admin-card admin-kpi"><p class="admin-kpi__label">${esc(label)}</p><p class="admin-kpi__value">${esc(value)}</p></div>`).join('')}</div><div style="margin-top:1rem;" data-admin-gift-table></div>`;
  const table = target.querySelector<HTMLElement>('[data-admin-gift-table]');
  if (table) {
    renderTable(table, ['Code', 'Recipient', 'Value', 'Remaining', 'Valid from', 'Status'], (data.records ?? []).map((record) => [esc(record.code), esc(record.recipientName), esc(money(record.valueCents)), esc(money(record.remainingCents)), esc(record.validFromDate), `<span class="admin-status">${esc(record.active ? 'active' : record.status)}</span>`]), 'No gift certificates are recorded.');
  }
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
    api<{ admins?: Array<Record<string, unknown>> }>('/api/admin/accounts?view=admins'),
    api<{ sessions?: Array<Record<string, unknown>> }>('/api/admin/accounts?view=sessions'),
    api<{ audit?: Array<Record<string, unknown>> }>('/api/admin/accounts?view=audit&limit=100'),
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

inviteForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  setError();
  const data = new FormData(inviteForm);
  const token = new URLSearchParams(window.location.search).get('invite') ?? '';
  try {
    const result = await api<{ actor?: AdminActor; csrf?: string }>('/api/admin/auth', {
      method: 'POST',
      body: JSON.stringify({ action: 'accept_invite', token, name: data.get('name'), password: data.get('password') }),
    });
    window.history.replaceState({}, '', '/admin/');
    applySession(result);
  } catch (error) { setError(friendly(error)); }
});

resetForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  setError();
  const data = new FormData(resetForm);
  const token = new URLSearchParams(window.location.search).get('reset') ?? '';
  try {
    await api('/api/admin/auth', { method: 'POST', body: JSON.stringify({ action: 'reset_password', token, password: data.get('password') }) });
    window.history.replaceState({}, '', '/admin/');
    showGate('login');
    setError('Password updated. Sign in with the new password.');
  } catch (error) { setError(friendly(error)); }
});

document.querySelector<HTMLButtonElement>('[data-admin-logout]')?.addEventListener('click', async () => {
  try { await api('/api/admin/auth', { method: 'POST', body: JSON.stringify({ action: 'logout' }) }); }
  finally { csrf = ''; actor = null; showGate('login'); }
});

for (const button of navButtons) button.addEventListener('click', () => void loadView(button.dataset.adminNav ?? 'overview'));

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
      void api<{ token: string; expiresAt: string }>('/api/admin/accounts', {
        method: 'POST',
        body: JSON.stringify({ action: 'invite', email: data.get('email'), role: data.get('role'), branchId: data.get('branchId') }),
      }).then((result) => {
        const link = `${window.location.origin}/admin/?invite=${encodeURIComponent(result.token)}`;
        const target = document.querySelector<HTMLElement>('[data-admin-invite-result]');
        if (target) target.innerHTML = `<div class="admin-card"><p><strong>One-time invitation</strong> (expires ${esc(dateTime(result.expiresAt))})</p><p><a href="${esc(link)}">${esc(link)}</a></p><p class="admin-muted">Send this private link to the administrator. It works once.</p></div>`;
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
  if (!target) return;
  const actionName = target.dataset.adminAction ?? '';
  const id = target.dataset.id ?? '';
  if (actionName === 'request-confirm') void action('/api/admin/requests', { action: 'confirm', requestId: id });
  if (actionName === 'request-decline') void action('/api/admin/requests', { action: 'status', requestId: id, status: 'declined' });
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
    void api<{ token: string; expiresAt: string; email: string }>('/api/admin/accounts', { method: 'POST', body: JSON.stringify({ action: 'issue_reset', userId: id }) })
      .then((result) => {
        const link = `${window.location.origin}/admin/?reset=${encodeURIComponent(result.token)}`;
        const target = document.querySelector<HTMLElement>('[data-admin-invite-result]');
        if (target) target.innerHTML = `<div class="admin-card"><p><strong>One-time reset for ${esc(result.email)}</strong> (expires ${esc(dateTime(result.expiresAt))})</p><p><a href="${esc(link)}">${esc(link)}</a></p></div>`;
      }).catch((error) => setAppError(friendly(error)));
  }
  if (actionName === 'admin-toggle') void action('/api/admin/accounts', { action: 'status', userId: id, status: target.dataset.status });
  if (actionName === 'admin-revoke') void action('/api/admin/accounts', { action: 'revoke_user', userId: id });
  if (actionName === 'revoke-others') void action('/api/admin/accounts', { action: 'revoke_others' });
});

void loadAuth();
