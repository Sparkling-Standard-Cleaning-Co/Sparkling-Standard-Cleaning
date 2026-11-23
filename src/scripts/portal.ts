(() => {
interface PortalCustomer {
  id: string;
  first_name: string;
  last_name: string;
  company_name: string;
  branch_name?: string;
}

interface PortalInvoice {
  id: string;
  number: string;
  status: string;
  total_cents: number;
  balance_cents: number;
  due_date: string;
  payment_url?: string | null;
}

interface PortalAppointment {
  id: string;
  reference: string;
  status: string;
  start_at: string;
  end_at: string;
  duration_minutes: number;
}

interface PortalRecurring {
  id: string;
  frequency: string;
  status: string;
  next_visit_date: string;
  ongoing_price_cents: number;
}

interface PortalSignature {
  id: string;
  title: string;
  status: string;
  signed_at: string;
  downloadable: boolean;
}

interface PortalExecuted {
  id: string;
  bundle_code: string;
  packet_name: string;
  executed_at: string;
  executed_sha256: string;
}

interface PortalRequest {
  id: string;
  kind: string;
  status: string;
  created_at: string;
}

interface PortalSnapshot {
  customer?: PortalCustomer;
  contacts?: Array<{ kind: string; value: string; is_primary: number }>;
  properties?: Array<{ id: string; label: string; line1: string; line2: string; city: string; state: string; postal_code: string }>;
  appointments?: PortalAppointment[];
  recurring?: PortalRecurring[];
  invoices?: PortalInvoice[];
  documents?: { executed?: PortalExecuted[]; signatures?: PortalSignature[] };
  requests?: PortalRequest[];
  billingPortalEnabled?: boolean;
  csrf?: string;
}

const loading = document.querySelector<HTMLElement>('[data-portal-loading]');
const login = document.querySelector<HTMLElement>('[data-portal-login]');
const dashboard = document.querySelector<HTMLElement>('[data-portal-dashboard]');
const errorEl = document.querySelector<HTMLElement>('[data-portal-error]');
let csrf = '';

function esc(value: unknown): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function money(cents: unknown): string {
  const amount = Number(cents);
  if (!Number.isFinite(amount)) return '-';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount / 100);
}

function date(value: unknown): string {
  const parsed = new Date(String(value ?? ''));
  return Number.isFinite(parsed.getTime())
    ? parsed.toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
    : '-';
}

function title(value: unknown): string {
  return String(value ?? '').replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function setError(message = ''): void {
  if (errorEl) errorEl.textContent = message;
}

function showLogin(): void {
  if (loading) loading.hidden = true;
  if (login) login.hidden = false;
  if (dashboard) dashboard.hidden = true;
}

function showDashboard(): void {
  if (loading) loading.hidden = true;
  if (login) login.hidden = true;
  if (dashboard) dashboard.hidden = false;
}

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('Accept', 'application/json');
  if (init.body) headers.set('Content-Type', 'application/json');
  if (csrf && init.method === 'POST') headers.set('X-Portal-CSRF', csrf);
  const response = await fetch(path, { ...init, headers, credentials: 'same-origin' });
  const data = (await response.json().catch(() => ({}))) as T & { ok?: boolean; error?: string; message?: string };
  if (!response.ok || data.ok === false) throw new Error(data.message || data.error || `HTTP ${response.status}`);
  return data;
}

function empty(target: string, message: string): void {
  const element = document.querySelector<HTMLElement>(target);
  if (element) element.innerHTML = `<p class="admin-muted">${esc(message)}</p>`;
}

function render(snapshot: PortalSnapshot): void {
  const customer = snapshot.customer;
  const name = customer ? [customer.first_name, customer.last_name].filter(Boolean).join(' ') || customer.company_name : 'Customer';
  const welcome = document.querySelector<HTMLElement>('[data-portal-welcome]');
  if (welcome) welcome.textContent = `Welcome, ${name}`;
  const branch = document.querySelector<HTMLElement>('[data-portal-branch]');
  if (branch) branch.textContent = customer?.branch_name ? `Service branch: ${customer.branch_name}` : '';

  const appointments = snapshot.appointments ?? [];
  const recurring = snapshot.recurring ?? [];
  const invoices = snapshot.invoices ?? [];
  const executed = snapshot.documents?.executed ?? [];
  const signatures = snapshot.documents?.signatures ?? [];
  const requests = snapshot.requests ?? [];
  const balance = invoices.reduce((total, invoice) => total + (Number(invoice.balance_cents) || 0), 0);
  const next = appointments.find((appointment) => ['pending', 'confirmed'].includes(appointment.status));
  const kpis = document.querySelector<HTMLElement>('[data-portal-kpis]');
  if (kpis) {
    kpis.innerHTML = [
      ['Next appointment', next ? date(next.start_at) : 'None scheduled'],
      ['Recurring plan', recurring[0] ? `${title(recurring[0].frequency)} - ${title(recurring[0].status)}` : 'Not active'],
      ['Open balance', money(balance)],
      ['Signed documents', String(executed.length + signatures.length)],
    ].map(([label, value]) => `<div class="admin-card admin-kpi"><p class="admin-kpi__label">${esc(label)}</p><p class="admin-kpi__value">${esc(value)}</p></div>`).join('');
  }

  if (appointments.length) {
    const target = document.querySelector<HTMLElement>('[data-portal-appointments]');
    if (target) target.innerHTML = `<div class="admin-table-scroll"><table class="admin-table"><thead><tr><th>When</th><th>Reference</th><th>Status</th><th>Duration</th></tr></thead><tbody>${appointments.map((appointment) => `<tr><td>${esc(date(appointment.start_at))}</td><td>${esc(appointment.reference)}</td><td><span class="admin-status">${esc(title(appointment.status))}</span></td><td>${esc(appointment.duration_minutes ? `${appointment.duration_minutes} min` : '-')}</td></tr>`).join('')}</tbody></table></div>`;
  } else {
    empty('[data-portal-appointments]', 'No appointments are recorded yet.');
  }

  if (recurring.length) {
    const target = document.querySelector<HTMLElement>('[data-portal-recurring]');
    if (target) target.innerHTML = recurring.map((plan) => `<div class="admin-record"><p><strong>${esc(title(plan.frequency))}</strong> - ${esc(title(plan.status))}</p><p class="admin-muted">Next visit: ${esc(plan.next_visit_date || 'not scheduled')} - Ongoing ${esc(money(plan.ongoing_price_cents))}</p></div>`).join('');
  } else {
    empty('[data-portal-recurring]', 'No recurring plan is active.');
  }

  if (invoices.length) {
    const target = document.querySelector<HTMLElement>('[data-portal-invoices]');
    if (target) target.innerHTML = `<div class="admin-table-scroll"><table class="admin-table"><thead><tr><th>Invoice</th><th>Status</th><th>Total</th><th>Balance</th><th>Due</th><th></th></tr></thead><tbody>${invoices.map((invoice) => `<tr><td>${esc(invoice.number)}</td><td>${esc(title(invoice.status))}</td><td>${esc(money(invoice.total_cents))}</td><td>${esc(money(invoice.balance_cents))}</td><td>${esc(invoice.due_date)}</td><td>${invoice.payment_url && Number(invoice.balance_cents) > 0 ? `<a class="btn btn--ghost btn--small" href="${esc(invoice.payment_url)}">Pay securely</a>` : ''}</td></tr>`).join('')}</tbody></table></div>`;
  } else {
    empty('[data-portal-invoices]', 'No invoices are recorded yet.');
  }

  const billing = document.querySelector<HTMLButtonElement>('[data-portal-action="billing"]');
  if (billing) {
    billing.disabled = !snapshot.billingPortalEnabled;
    billing.title = snapshot.billingPortalEnabled ? '' : 'Secure self-service billing is not enabled yet. Contact billing@ for help.';
  }

  const documentsTarget = document.querySelector<HTMLElement>('[data-portal-documents]');
  if (documentsTarget) {
    const executedRows = executed.map((document) => `<div class="admin-record"><p><strong>${esc(document.packet_name || document.bundle_code)}</strong> - executed ${esc(date(document.executed_at))}</p><a class="btn btn--ghost btn--small" href="/api/portal/document?kind=executed&id=${encodeURIComponent(document.id)}">Download executed copy</a></div>`).join('');
    const signatureRows = signatures.map((signature) => `<div class="admin-record"><p><strong>${esc(signature.title)}</strong> - ${esc(title(signature.status))} ${esc(date(signature.signed_at))}</p>${signature.downloadable ? `<a class="btn btn--ghost btn--small" href="/api/portal/document?kind=signature&id=${encodeURIComponent(signature.id)}">Download signed PDF</a>` : '<p class="admin-muted">The executed copy is available above.</p>'}</div>`).join('');
    documentsTarget.innerHTML = executedRows || signatureRows
      ? `${executedRows}${signatureRows}`
      : '<p class="admin-muted">No executed documents are available yet. Required documents appear here after completion.</p>';
  }

  const requestsTarget = document.querySelector<HTMLElement>('[data-portal-requests]');
  if (requestsTarget) {
    requestsTarget.innerHTML = requests.length
      ? `<div class="admin-table-scroll"><table class="admin-table"><thead><tr><th>Submitted</th><th>Topic</th><th>Status</th></tr></thead><tbody>${requests.map((request) => `<tr><td>${esc(date(request.created_at))}</td><td>${esc(title(request.kind))}</td><td>${esc(title(request.status))}</td></tr>`).join('')}</tbody></table></div>`
      : '<p class="admin-muted">No requests submitted.</p>';
  }

  const profile = document.querySelector<HTMLElement>('[data-portal-profile]');
  if (profile) {
    const contacts = (snapshot.contacts ?? []).map((contact) => `<p>${esc(title(contact.kind))}: ${esc(contact.value)}</p>`).join('');
    const properties = (snapshot.properties ?? []).map((property) => `<p><strong>${esc(property.label || 'Service property')}</strong><br />${esc([property.line1, property.line2, property.city, property.state, property.postal_code].filter(Boolean).join(', '))}</p>`).join('');
    profile.innerHTML = `<h3 style="font-size:.95rem;">Contact</h3>${contacts || '<p class="admin-muted">No contact details recorded.</p>'}<h3 style="font-size:.95rem;margin-top:1rem;">Properties</h3>${properties || '<p class="admin-muted">No properties recorded.</p>'}`;
  }
}

async function loadDashboard(): Promise<void> {
  try {
    const data = await api<PortalSnapshot>('/api/portal/data');
    csrf = data.csrf ?? csrf;
    render(data);
    showDashboard();
  } catch (error) {
    if (error instanceof Error && error.message.includes('authentication_required')) {
      showLogin();
      return;
    }
    setError(error instanceof Error ? error.message : 'Unable to load your portal.');
    showLogin();
  }
}

async function boot(): Promise<void> {
  setError();
  const token = new URLSearchParams(window.location.search).get('token');
  try {
    if (token) {
      const result = await api<{ csrf?: string; name?: string }>('/api/portal/auth', {
        method: 'POST',
        body: JSON.stringify({ action: 'verify', token }),
      });
      csrf = result.csrf ?? '';
      window.history.replaceState({}, '', '/portal/');
      await loadDashboard();
      return;
    }
    const auth = await api<{ authenticated?: boolean; csrf?: string }>('/api/portal/auth');
    if (auth.authenticated) {
      csrf = auth.csrf ?? '';
      await loadDashboard();
      return;
    }
    showLogin();
  } catch {
    if (loading) loading.hidden = true;
    if (token) setError('That sign-in link is invalid or has expired. Request a new link below.');
    showLogin();
  }
}

document.querySelector<HTMLFormElement>('[data-portal-login-form]')?.addEventListener('submit', (event) => {
  event.preventDefault();
  const status = document.querySelector<HTMLElement>('[data-portal-login-status]');
  const form = event.currentTarget as HTMLFormElement;
  const data = new FormData(form);
  if (status) status.textContent = 'Sending…';
  setError();
  void api<{ message?: string }>('/api/portal/auth', {
    method: 'POST',
    body: JSON.stringify({ action: 'request_access', email: data.get('email') }),
  }).then((result) => {
    if (status) status.textContent = result.message ?? 'If that email belongs to an active customer, a secure sign-in link is on its way.';
    form.reset();
  }).catch((error) => {
    if (status) status.textContent = '';
    setError(error instanceof Error ? error.message : 'Unable to request a sign-in link.');
  });
});

document.querySelector<HTMLFormElement>('[data-portal-request-form]')?.addEventListener('submit', (event) => {
  event.preventDefault();
  const form = event.currentTarget as HTMLFormElement;
  const data = new FormData(form);
  const status = document.querySelector<HTMLElement>('[data-portal-request-status]');
  if (status) status.textContent = 'Sending…';
  setError();
  void api<{ message?: string }>('/api/portal/data', {
    method: 'POST',
    body: JSON.stringify({ action: 'service_request', kind: data.get('kind'), message: data.get('message') }),
  }).then((result) => {
    if (status) status.textContent = result.message ?? 'Your request was received.';
    form.reset();
    return loadDashboard();
  }).catch((error) => {
    if (status) status.textContent = '';
    setError(error instanceof Error ? error.message : 'Unable to send your request.');
  });
});

document.querySelector<HTMLElement>('[data-portal-dashboard]')?.addEventListener('click', (event) => {
  const target = (event.target as HTMLElement).closest<HTMLElement>('[data-portal-action]');
  if (!target) return;
  const action = target.dataset.portalAction;
  if (action === 'logout') {
    void api('/api/portal/auth', { method: 'POST', body: JSON.stringify({ action: 'logout' }) })
      .then(() => window.location.assign('/portal/'))
      .catch(() => window.location.assign('/portal/'));
    return;
  }
  if (action === 'billing') {
    setError();
    void api<{ url?: string }>('/api/portal/data', {
      method: 'POST',
      body: JSON.stringify({ action: 'billing_portal' }),
    }).then((result) => {
      if (result.url) window.location.assign(result.url);
      else setError('The secure billing portal is not available yet.');
    }).catch((error) => setError(error instanceof Error ? error.message : 'Unable to open the billing portal.'));
  }
});

void boot();
})();
