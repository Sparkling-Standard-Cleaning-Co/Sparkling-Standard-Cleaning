export {};

const gate = document.querySelector<HTMLElement>('[data-admin-gate]');
const app = document.querySelector<HTMLElement>('[data-admin-app]');
const setupForm = document.querySelector<HTMLFormElement>('[data-admin-setup]');
const loginForm = document.querySelector<HTMLFormElement>('[data-admin-login]');
const gateStatus = document.querySelector<HTMLElement>('[data-admin-gate-status]');
const errorEl = document.querySelector<HTMLElement>('[data-admin-error]');
const userEl = document.querySelector<HTMLElement>('[data-admin-user]');
const roleEl = document.querySelector<HTMLElement>('[data-admin-role]');
const titleEl = document.querySelector<HTMLElement>('[data-admin-view-title]');
const subEl = document.querySelector<HTMLElement>('[data-admin-view-sub]');
const navButtons = [...document.querySelectorAll<HTMLButtonElement>('[data-admin-nav]')];
const views = [...document.querySelectorAll<HTMLElement>('[data-admin-view]')];
let csrf = '';

const viewMeta: Record<string, [string, string]> = {
  overview: ['Overview', 'Live cleaning-company operations.'],
  calendar: ['Calendar & Requests', 'Pending reservations and upcoming appointments.'],
  customers: ['Customers', 'Search and review customer records.'],
  recurring: ['Recurring Plans', 'Recurring cleaning administration.'],
  jobs: ['Jobs & Team', 'Cleaning jobs, assignments and checklists.'],
  finance: ['Invoices & Payments', 'Invoicing and payment administration.'],
  gift: ['Gift Certificates', 'Existing production gift register.'],
  reports: ['Reports', 'Operational and financial reporting.'],
  settings: ['Settings & Audit', 'Access, configuration and audit history.'],
};

function esc(value: unknown): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function setError(message = ''): void {
  if (errorEl) errorEl.textContent = message;
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

function showGate(setup: boolean): void {
  if (gate) gate.hidden = false;
  if (app) app.hidden = true;
  if (setupForm) setupForm.hidden = !setup;
  if (loginForm) loginForm.hidden = setup;
  if (gateStatus) gateStatus.textContent = setup ? 'First-run owner enrollment.' : 'Sign in to continue.';
}

function showApp(nextActor: { name: string; role: string }): void {
  if (gate) gate.hidden = true;
  if (app) app.hidden = false;
  if (userEl) userEl.textContent = `${nextActor.name} · ${nextActor.role}`;
  if (roleEl) roleEl.textContent = nextActor.role;
  void loadView('overview');
}

async function loadAuth(): Promise<void> {
  try {
    const data = await api<{ setupRequired?: boolean; authenticated?: boolean; actor?: { name: string; role: string }; csrf?: string }>('/api/admin/auth');
    csrf = data.csrf ?? '';
    if (data.setupRequired) return showGate(true);
    if (data.authenticated && data.actor) return showApp(data.actor);
    showGate(false);
  } catch (error) {
    if (gateStatus) {
      gateStatus.textContent =
        (error as Error).message === 'database_not_configured'
          ? 'The operations database is not provisioned yet. Local development can continue without production activation.'
          : 'Secure admin status is unavailable.';
    }
  }
}

function renderEmpty(container: HTMLElement, text: string): void {
  container.innerHTML = `<div class="admin-empty">${esc(text)}</div>`;
}

function renderTable(container: HTMLElement, columns: string[], rows: unknown[][], empty: string): void {
  if (rows.length === 0) return renderEmpty(container, empty);
  const head = columns.map((column) => `<th>${esc(column)}</th>`).join('');
  const body = rows
    .map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join('')}</tr>`)
    .join('');
  container.innerHTML = `<div class="admin-table-scroll"><table class="admin-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}

async function loadOverview(): Promise<void> {
  const data = await api<{
    counts?: Record<string, number>;
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
    ]
      .map(([label, value]) => `<div class="admin-card admin-kpi"><p class="admin-kpi__label">${esc(label)}</p><p class="admin-kpi__value">${esc(value)}</p></div>`)
      .join('');
  }
  const recent = document.querySelector<HTMLElement>('[data-admin-recent]');
  if (recent) {
    renderTable(
      recent,
      ['Date', 'Type', 'Customer', 'Email', 'Status', 'Reference'],
      (data.recentLeads ?? []).map((lead) => [
        esc(String(lead.created_at ?? '').slice(0, 16).replace('T', ' ')),
        esc(lead.request_type),
        esc([lead.first_name, lead.last_name].filter(Boolean).join(' ') || 'Unlinked lead'),
        esc(lead.email),
        `<span class="admin-status">${esc(lead.status)}</span>`,
        esc(lead.quote_reference),
      ]),
      'No inquiries have been persisted yet. New website submissions will appear here.',
    );
  }
}

async function loadCalendar(): Promise<void> {
  const data = await api<{
    requests?: Array<Record<string, unknown>>;
    appointments?: Array<Record<string, unknown>>;
    reservationLeads?: Array<Record<string, unknown>>;
  }>('/api/admin/requests');
  const requests = document.querySelector<HTMLElement>('[data-admin-requests]');
  if (requests) {
    const rows = (data.requests ?? []).map((request) => [
      esc(String(request.start_at ?? '').slice(0, 16).replace('T', ' ')),
      esc(request.quote_reference),
      esc([request.first_name, request.last_name].filter(Boolean).join(' ')),
      esc([request.line1, request.city].filter(Boolean).join(', ')),
      `<span class="admin-status">${esc(request.status)}</span>`,
    ]);
    const leadRows = (data.reservationLeads ?? []).map((lead) => [
      esc(String(lead.created_at ?? '').slice(0, 16).replace('T', ' ')),
      esc(lead.quote_reference),
      esc([lead.first_name, lead.last_name].filter(Boolean).join(' ')),
      'Website inquiry',
      `<span class="admin-status">${esc(lead.status)}</span>`,
    ]);
    renderTable(requests, ['Requested time', 'Reference', 'Customer', 'Property', 'Status'], [...rows, ...leadRows], 'No pending reservation requests.');
  }
  const appointments = document.querySelector<HTMLElement>('[data-admin-appointments]');
  if (appointments) {
    renderTable(
      appointments,
      ['Start', 'Reference', 'Customer', 'Property', 'Crew', 'Status'],
      (data.appointments ?? []).map((appointment) => [
        esc(String(appointment.start_at ?? '').slice(0, 16).replace('T', ' ')),
        esc(appointment.reference),
        esc([appointment.first_name, appointment.last_name].filter(Boolean).join(' ')),
        esc([appointment.line1, appointment.city].filter(Boolean).join(', ')),
        esc(appointment.crew_size),
        `<span class="admin-status">${esc(appointment.status)}</span>`,
      ]),
      'No appointments are recorded in D1 yet.',
    );
  }
}

async function loadCustomers(query = ''): Promise<void> {
  const data = await api<{ customers?: Array<Record<string, unknown>> }>(
    `/api/admin/customers?q=${encodeURIComponent(query)}`,
  );
  const list = document.querySelector<HTMLElement>('[data-admin-customers]');
  if (!list) return;
  if ((data.customers ?? []).length === 0) {
    return renderEmpty(list, query ? 'No matching customers.' : 'No customers have been persisted yet.');
  }
  list.innerHTML = `<div class="admin-table-scroll"><table class="admin-table"><thead><tr><th>Name</th><th>Email</th><th>Phone</th><th>Properties</th><th></th></tr></thead><tbody>${(data.customers ?? [])
    .map((customer) => `<tr><td>${esc([customer.first_name, customer.last_name].filter(Boolean).join(' ') || customer.company_name)}</td><td>${esc(customer.email)}</td><td>${esc(customer.phone)}</td><td>${esc(customer.property_count)}</td><td><button class="btn btn--ghost btn--small" type="button" data-admin-customer="${esc(customer.id)}">Open</button></td></tr>`)
    .join('')}</tbody></table></div>`;
  for (const button of list.querySelectorAll<HTMLButtonElement>('[data-admin-customer]')) {
    button.addEventListener('click', () => void loadCustomer(button.dataset.adminCustomer ?? ''));
  }
}

async function loadCustomer(id: string): Promise<void> {
  if (!id) return;
  const data = await api<Record<string, any>>(`/api/admin/customers?id=${encodeURIComponent(id)}`);
  const panel = document.querySelector<HTMLElement>('[data-admin-customer-detail]');
  if (!panel) return;
  const c = data.customer ?? {};
  const contacts = (data.contacts ?? []).map((x: Record<string, unknown>) => `${esc(x.kind)}: ${esc(x.value)}`).join('<br />');
  const properties = (data.properties ?? []).map((x: Record<string, unknown>) => `${esc([x.line1, x.city, x.state, x.postal_code].filter(Boolean).join(', '))}${x.access_notes ? ` — ${esc(x.access_notes)}` : ''}`).join('<br />');
  panel.hidden = false;
  panel.innerHTML = `<div class="admin-card"><h2 style="font-size:1.1rem;margin:.1rem 0 .7rem;">${esc([c.first_name, c.last_name].filter(Boolean).join(' ') || c.company_name || 'Customer')}</h2><dl><dt>Status</dt><dd>${esc(c.status)}</dd><dt>Branch</dt><dd>${esc(c.branch_name)}</dd><dt>Source</dt><dd>${esc(c.source)}</dd><dt>Contacts</dt><dd>${contacts || '—'}</dd><dt>Properties</dt><dd>${properties || '—'}</dd></dl><h3>Requests</h3><div>${(data.leads ?? []).map((lead: Record<string, unknown>) => `<p>${esc(lead.created_at)} · ${esc(lead.request_type)} · ${esc(lead.status)} · ${esc(lead.quote_reference)}</p>`).join('') || '<p class="admin-muted">No requests.</p>'}</div><h3>Appointments</h3><div>${(data.appointments ?? []).map((appointment: Record<string, unknown>) => `<p>${esc(appointment.start_at)} · ${esc(appointment.reference)} · ${esc(appointment.status)}</p>`).join('') || '<p class="admin-muted">No appointments.</p>'}</div></div>`;
}

async function loadView(view: string): Promise<void> {
  for (const button of navButtons) {
    if (button.dataset.adminNav === view) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  }
  for (const section of views) section.hidden = section.dataset.adminView !== view;
  if (titleEl) titleEl.textContent = viewMeta[view]?.[0] ?? 'Operations';
  if (subEl) subEl.textContent = viewMeta[view]?.[1] ?? '';
  try {
    if (view === 'overview') await loadOverview();
    if (view === 'calendar') await loadCalendar();
    if (view === 'customers') await loadCustomers();
  } catch (error) {
    setError((error as Error).message);
  }
}

setupForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  setError();
  const data = new FormData(setupForm);
  try {
    const result = await api<{ actor?: { name: string; role: string }; csrf?: string }>('/api/admin/auth', {
      method: 'POST',
      body: JSON.stringify({
        action: 'setup',
        setupCode: data.get('setupCode'),
        name: data.get('name'),
        email: data.get('email'),
        password: data.get('password'),
      }),
    });
    csrf = result.csrf ?? '';
    if (result.actor) showApp(result.actor);
  } catch (error) {
    setError((error as Error).message);
  }
});

loginForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  setError();
  const data = new FormData(loginForm);
  try {
    const result = await api<{ actor?: { name: string; role: string }; csrf?: string }>('/api/admin/auth', {
      method: 'POST',
      body: JSON.stringify({ action: 'login', email: data.get('email'), password: data.get('password') }),
    });
    csrf = result.csrf ?? '';
    if (result.actor) showApp(result.actor);
  } catch (error) {
    setError((error as Error).message);
  }
});

document.querySelector<HTMLButtonElement>('[data-admin-logout]')?.addEventListener('click', async () => {
  try {
    await api('/api/admin/auth', { method: 'POST', body: JSON.stringify({ action: 'logout' }) });
  } finally {
    csrf = '';
    showGate(false);
  }
});

for (const button of navButtons) {
  button.addEventListener('click', () => void loadView(button.dataset.adminNav ?? 'overview'));
}

document.querySelector<HTMLFormElement>('[data-admin-customer-search]')?.addEventListener('submit', (event) => {
  event.preventDefault();
  const data = new FormData(event.currentTarget as HTMLFormElement);
  void loadCustomers(String(data.get('q') ?? ''));
});

void loadAuth();
