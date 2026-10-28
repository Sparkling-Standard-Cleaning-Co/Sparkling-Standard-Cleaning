// Private gift administration client. Authentication is a server session in an
// HttpOnly cookie; this script never stores a password or bearer token.

export {};

const $ = <T extends Element>(selector: string): T | null => document.querySelector<T>(selector);
const panels = {
  loading: $<HTMLElement>('[data-gift-auth-loading]'),
  login: $<HTMLElement>('[data-gift-auth-login]'),
  setup: $<HTMLElement>('[data-gift-auth-setup]'),
  recovery: $<HTMLElement>('[data-gift-auth-recovery]'),
  reset: $<HTMLElement>('[data-gift-auth-reset]'),
  verify: $<HTMLElement>('[data-gift-auth-verify]'),
  dashboard: $<HTMLElement>('[data-gift-dashboard]'),
};

const loginForm = $<HTMLFormElement>('[data-gift-login-form]');
const loginPassword = $<HTMLInputElement>('[data-gift-login-password]');
const loginStatus = $<HTMLElement>('[data-gift-login-status]');
const setupForm = $<HTMLFormElement>('[data-gift-setup-form]');
const setupCode = $<HTMLInputElement>('[data-gift-setup-code]');
const setupPassword = $<HTMLInputElement>('[data-gift-setup-password]');
const setupConfirm = $<HTMLInputElement>('[data-gift-setup-confirm]');
const setupEmail = $<HTMLInputElement>('[data-gift-setup-email]');
const setupStatus = $<HTMLElement>('[data-gift-setup-status]');
const recoveryForm = $<HTMLFormElement>('[data-gift-recovery-form]');
const recoveryChannel = $<HTMLSelectElement>('[data-gift-recovery-channel]');
const recoveryStatus = $<HTMLElement>('[data-gift-recovery-status]');
const resetForm = $<HTMLFormElement>('[data-gift-reset-form]');
const resetPassword = $<HTMLInputElement>('[data-gift-reset-password]');
const resetConfirm = $<HTMLInputElement>('[data-gift-reset-confirm]');
const resetStatus = $<HTMLElement>('[data-gift-reset-status]');
const verifyStatus = $<HTMLElement>('[data-gift-verify-status]');
const summary = $<HTMLElement>('[data-gift-summary]');
const rows = $<HTMLElement>('[data-gift-rows]');
const listStatus = $<HTMLElement>('[data-gift-list-status]');
const pageLabel = $<HTMLElement>('[data-gift-page-label]');
const prevPage = $<HTMLButtonElement>('[data-gift-prev]');
const nextPage = $<HTMLButtonElement>('[data-gift-next]');
const search = $<HTMLInputElement>('[data-gift-search]');
const statusFilter = $<HTMLSelectElement>('[data-gift-status]');
const filterForm = $<HTMLFormElement>('[data-gift-filter-form]');
const detail = $<HTMLElement>('[data-gift-detail]');
const detailMetrics = $<HTMLElement>('[data-gift-detail-metrics]');
const detailIdentity = $<HTMLElement>('[data-gift-detail-identity]');
const detailPayment = $<HTMLElement>('[data-gift-detail-payment]');
const detailHistory = $<HTMLElement>('[data-gift-detail-history]');
const detailAdjustments = $<HTMLElement>('[data-gift-detail-adjustments]');
const actions = $<HTMLElement>('[data-gift-actions]');
const actionPassword = $<HTMLInputElement>('[data-gift-action-password]');
const actionAmount = $<HTMLInputElement>('[data-gift-action-amount]');
const actionNote = $<HTMLInputElement>('[data-gift-action-note]');
const actionReference = $<HTMLInputElement>('[data-gift-action-reference]');
const actionStatus = $<HTMLElement>('[data-gift-action-status]');
const recoveryState = $<HTMLElement>('[data-gift-recovery-state]');
const recoveryEmailInput = $<HTMLInputElement>('[data-gift-new-recovery-email]');
const recoveryPassword = $<HTMLInputElement>('[data-gift-recovery-password]');
const recoverySettingsStatus = $<HTMLElement>('[data-gift-recovery-settings-status]');

let csrf = '';
let currentCode = '';
let currentPage = 1;
let totalPages = 1;
let authState: {
  recoveryEmail?: string;
  recoveryEmailVerified?: boolean;
} = {};

const money = (cents: number): string =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);

function setStatus(node: HTMLElement | null, message: string, state: 'info' | 'error' | 'success' = 'info'): void {
  if (!node) return;
  node.textContent = message;
  node.dataset.state = state;
}

function show(panel: keyof typeof panels): void {
  for (const [name, node] of Object.entries(panels)) {
    if (node) node.hidden = name !== panel;
  }
}

function textRow(list: HTMLElement, label: string, value: string): void {
  const item = document.createElement('li');
  const term = document.createElement('span');
  term.textContent = label;
  const detailValue = document.createElement('strong');
  detailValue.textContent = value || '—';
  item.append(term, detailValue);
  list.appendChild(item);
}

function metric(label: string, value: string): void {
  if (!summary) return;
  const group = document.createElement('div');
  group.className = 'summary-group';
  const heading = document.createElement('p');
  heading.className = 'summary-group__title';
  heading.textContent = label;
  const amount = document.createElement('p');
  amount.className = 'reservation-summary__price';
  amount.textContent = value;
  group.append(heading, amount);
  summary.appendChild(group);
}

async function api(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set('Accept', 'application/json');
  if (init.body) headers.set('Content-Type', 'application/json');
  if (init.method && init.method !== 'GET' && csrf) headers.set('X-CSRF-Token', csrf);
  return fetch(path, { ...init, headers, credentials: 'same-origin' });
}

async function json(response: Response): Promise<Record<string, unknown>> {
  return (await response.json().catch(() => ({}))) as Record<string, unknown>;
}

function showLogin(): void {
  show('login');
  setStatus(loginStatus, '', 'info');
}

function showSetup(): void {
  show('setup');
  setStatus(setupStatus, '', 'info');
}

function showRecovery(): void {
  show('recovery');
  setStatus(recoveryStatus, 'If a verified email is enrolled, a single-use link will be sent. The response is intentionally the same either way.', 'info');
}

function showReset(token: string): void {
  show('reset');
  resetForm?.setAttribute('data-token', token);
}

function showVerify(token: string): void {
  show('verify');
  panels.verify?.setAttribute('data-token', token);
}

function showDashboard(): void {
  show('dashboard');
  if (recoveryState) {
    recoveryState.textContent = authState.recoveryEmail
      ? `${authState.recoveryEmail} ${authState.recoveryEmailVerified ? 'is verified.' : 'is not verified yet.'}`
      : 'No backup email is enrolled.';
  }
  if (recoveryEmailInput && authState.recoveryEmail) recoveryEmailInput.value = authState.recoveryEmail;
  void loadDashboard(1);
}

async function loadDashboard(page = currentPage): Promise<void> {
  currentPage = page;
  if (rows) rows.innerHTML = '';
  setStatus(listStatus, 'Loading certificates…', 'info');
  try {
    const params = new URLSearchParams({
      list: '1',
      page: String(page),
      pageSize: '20',
      ...(search?.value.trim() ? { q: search.value.trim() } : {}),
      ...(statusFilter?.value ? { status: statusFilter.value } : {}),
    });
    const [listResponse, summaryResponse] = await Promise.all([
      api(`/api/gift-admin?${params.toString()}`),
      api('/api/gift-admin?summary=1'),
    ]);
    if (listResponse.status === 401 || summaryResponse.status === 401) {
      csrf = '';
      showLogin();
      setStatus(loginStatus, 'Your session expired. Sign in again.', 'error');
      return;
    }
    const listData = await json(listResponse);
    const summaryData = await json(summaryResponse);
    if (!listResponse.ok || !summaryResponse.ok) {
      setStatus(listStatus, 'The register could not load.', 'error');
      return;
    }
    renderSummary((summaryData.summary ?? {}) as Record<string, number>);
    renderRows((listData.items ?? []) as Array<Record<string, unknown>>);
    currentPage = Number(listData.page ?? 1);
    totalPages = Number(listData.totalPages ?? 1);
    if (pageLabel) pageLabel.textContent = `Page ${currentPage} of ${totalPages} · ${Number(listData.total ?? 0)} certificates`;
    if (prevPage) prevPage.disabled = currentPage <= 1;
    if (nextPage) nextPage.disabled = currentPage >= totalPages;
    setStatus(listStatus, '', 'success');
  } catch {
    setStatus(listStatus, 'The register could not be reached.', 'error');
  }
}

function renderSummary(data: Record<string, number>): void {
  if (!summary) return;
  summary.innerHTML = '';
  metric('Certificates issued', String(data.issuedCount ?? 0));
  metric('Active', String(data.activeCount ?? 0));
  metric('Outstanding liability', money(data.totalOutstandingCents ?? 0));
  metric('Redeemed value', money(data.totalRedeemedCents ?? 0));
  metric('Refunded value', money(data.totalRefundedCents ?? 0));
  metric('Voided value', money(data.totalVoidedCents ?? 0));
  metric('Pending deliveries', String(data.pendingDeliveries ?? 0));
  metric('Failed deliveries', String(data.failedDeliveries ?? 0));
}

function renderRows(items: Array<Record<string, unknown>>): void {
  if (!rows) return;
  if (items.length === 0) {
    const row = document.createElement('tr');
    const cell = document.createElement('td');
    cell.colSpan = 8;
    cell.textContent = 'No certificates match this view.';
    row.appendChild(cell);
    rows.appendChild(row);
    return;
  }
  for (const item of items) {
    const row = document.createElement('tr');
    const values = [
      String(item.code ?? ''),
      String(item.status ?? '').replaceAll('_', ' '),
      money(Number(item.valueCents ?? 0)),
      money(Number(item.remainingCents ?? 0)),
      String(item.purchaserName ?? ''),
      String(item.recipientName ?? ''),
      String(item.deliveryStatus ?? '').replaceAll('_', ' '),
    ];
    for (const value of values) {
      const cell = document.createElement('td');
      cell.textContent = value;
      row.appendChild(cell);
    }
    const actionCell = document.createElement('td');
    const button = document.createElement('button');
    button.className = 'btn btn--ghost btn--small';
    button.type = 'button';
    button.textContent = 'Review';
    button.addEventListener('click', () => void loadDetail(String(item.code ?? '')));
    actionCell.appendChild(button);
    row.appendChild(actionCell);
    rows.appendChild(row);
  }
}

async function loadDetail(code: string): Promise<void> {
  currentCode = code;
  setStatus(actionStatus, 'Loading certificate…', 'info');
  try {
    const response = await api(`/api/gift-admin?code=${encodeURIComponent(code)}`);
    if (response.status === 401) {
      csrf = '';
      showLogin();
      return;
    }
    const data = await json(response);
    if (!response.ok || !data.certificate) {
      setStatus(actionStatus, 'That certificate could not be loaded.', 'error');
      return;
    }
    const certificate = data.certificate as Record<string, unknown>;
    renderDetail(certificate);
    if (detail) {
      detail.hidden = false;
      detail.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    setStatus(actionStatus, '', 'info');
  } catch {
    setStatus(actionStatus, 'The certificate could not be reached.', 'error');
  }
}

function renderDetail(certificate: Record<string, unknown>): void {
  if (detailMetrics) detailMetrics.innerHTML = '';
  if (detailIdentity) detailIdentity.innerHTML = '';
  if (detailPayment) detailPayment.innerHTML = '';
  if (detailHistory) detailHistory.innerHTML = '';
  if (detailAdjustments) detailAdjustments.innerHTML = '';

  const addMetric = (label: string, value: string): void => {
    if (!detailMetrics) return;
    const group = document.createElement('div');
    group.className = 'summary-group';
    const title = document.createElement('p');
    title.className = 'summary-group__title';
    title.textContent = label;
    const amount = document.createElement('p');
    amount.className = 'reservation-summary__price';
    amount.textContent = value;
    group.append(title, amount);
    detailMetrics.appendChild(group);
  };
  addMetric('Status', String(certificate.status ?? '').replaceAll('_', ' '));
  addMetric('Original value', money(Number(certificate.valueCents ?? 0)));
  addMetric('Redeemed', money(Number(certificate.redeemedCents ?? 0)));
  addMetric('Remaining', money(Number(certificate.remainingCents ?? 0)));

  if (detailIdentity) {
    textRow(detailIdentity, 'Certificate', String(certificate.code ?? ''));
    textRow(detailIdentity, 'Purchaser', String(certificate.purchaserName ?? ''));
    textRow(detailIdentity, 'Purchaser email', String(certificate.purchaserEmail ?? ''));
    textRow(detailIdentity, 'Recipient', String(certificate.recipientName ?? ''));
    textRow(detailIdentity, 'Recipient email', String(certificate.recipientEmail ?? ''));
    textRow(detailIdentity, 'Gift message', String(certificate.message ?? ''));
    textRow(detailIdentity, 'Issued', String(certificate.issuedAt ?? ''));
    textRow(detailIdentity, 'Requested delivery', String(certificate.deliveryDate ?? ''));
  }
  if (detailPayment) {
    textRow(detailPayment, 'Stripe event', String(certificate.stripeEventId ?? ''));
    textRow(detailPayment, 'Stripe session', String(certificate.stripeSessionId ?? ''));
  }
  if (detailHistory) {
    const history = (certificate.history ?? []) as Array<Record<string, unknown>>;
    if (history.length === 0) textRow(detailHistory, 'No redemptions', '');
    for (const entry of history) {
      textRow(
        detailHistory,
        `${String(entry.at ?? '')} · ${String(entry.note ?? 'Redemption')} · ${String(entry.reference ?? '')}`,
        money(Number(entry.amountCents ?? 0)),
      );
    }
  }
  if (detailAdjustments) {
    const adjustments = (certificate.adjustments ?? []) as Array<Record<string, unknown>>;
    if (adjustments.length === 0) textRow(detailAdjustments, 'No refunds or voids', '');
    for (const entry of adjustments) {
      textRow(
        detailAdjustments,
        `${String(entry.at ?? '')} · ${String(entry.kind ?? '')} · ${String(entry.note ?? '')} ${String(entry.stripeRefundId ?? '')}`,
        money(Number(entry.amountCents ?? 0)),
      );
    }
  }

  if (actions) actions.hidden = certificate.status !== 'active';
  if (actionAmount) actionAmount.value = certificate.remainingCents ? String(Number(certificate.remainingCents) / 100) : '';
}

function setAction(message: string, state: 'info' | 'error' | 'success'): void {
  setStatus(actionStatus, message, state);
}

async function financialAction(action: 'redeem' | 'refund' | 'void' | 'resend'): Promise<void> {
  if (!currentCode) return;
  const password = actionPassword?.value ?? '';
  if (action !== 'resend' && !password) {
    setAction('Enter the administrator password to authorize this action.', 'error');
    return;
  }
  const amount = Number(actionAmount?.value ?? '');
  if (action === 'redeem' && (!Number.isFinite(amount) || amount <= 0)) {
    setAction('Enter a valid redemption amount.', 'error');
    return;
  }
  if (action === 'refund' || action === 'void') {
    if (!window.confirm(action === 'refund' ? 'Refund this unused certificate through Stripe?' : 'Void this unused certificate without moving money?')) {
      return;
    }
  }
  if (action === 'resend' && !window.confirm('Send this certificate again?')) return;
  setAction(action === 'refund' ? 'Sending the refund to Stripe…' : 'Recording the action…', 'info');
  try {
    const response = await api('/api/gift-admin', {
      method: 'POST',
      body: JSON.stringify({
        action,
        code: currentCode,
        ...(action !== 'resend' ? { password } : {}),
        ...(action === 'redeem' ? { amountCents: Math.round(amount * 100) } : {}),
        note: actionNote?.value ?? '',
        reference: actionReference?.value ?? '',
      }),
    });
    if (response.status === 401) {
      csrf = '';
      showLogin();
      setStatus(loginStatus, 'Sign in again to continue.', 'error');
      return;
    }
    const data = await json(response);
    if (!response.ok) {
      const messages: Record<string, string> = {
        reauth_failed: 'The administrator password was not accepted.',
        csrf_failed: 'The security token expired. Reload and sign in again.',
        provider_failed: 'Stripe did not complete the refund. Nothing was recorded.',
        payment_not_found: 'Stripe could not find the original payment. Nothing was recorded.',
        ledger_update_failed: 'Stripe may have refunded the payment, but the ledger update failed. Retry before doing anything else.',
        inactive: 'This certificate is not active.',
        redeemed: 'A certificate with a redemption cannot be refunded or voided here.',
        recipient_email_required: 'No recipient or purchaser email is available.',
        stripe_not_configured: 'Stripe is not configured for this environment.',
      };
      setAction(messages[String(data.error ?? '')] ?? 'The action did not complete.', 'error');
      return;
    }
    if (action === 'resend' && data.sent !== true) {
      setAction('The email provider did not accept the resend.', 'error');
      return;
    }
    if (actionPassword) actionPassword.value = '';
    if (actionNote) actionNote.value = '';
    if (actionReference) actionReference.value = '';
    await loadDetail(currentCode);
    await loadDashboard(currentPage);
    setAction(action === 'refund' ? 'Refund completed in Stripe and recorded.' : action === 'void' ? 'Certificate voided and recorded.' : action === 'resend' ? 'Certificate resent.' : 'Redemption recorded.', 'success');
  } catch {
    setAction('The action could not be reached. Check the register before retrying.', 'error');
  }
}

async function updateRecovery(): Promise<void> {
  const email = recoveryEmailInput?.value.trim() ?? '';
  const password = recoveryPassword?.value ?? '';
  if (!email || !password) {
    setStatus(recoverySettingsStatus, 'Enter the backup email and administrator password.', 'error');
    return;
  }
  try {
    const response = await api('/api/gift-auth', {
      method: 'POST',
      body: JSON.stringify({ action: 'update-recovery', recoveryEmail: email, password }),
    });
    const data = await json(response);
    if (response.status === 401) {
      csrf = '';
      showLogin();
      return;
    }
    if (!response.ok) {
      setStatus(recoverySettingsStatus, String(data.error ?? '') === 'reauth_failed' ? 'The administrator password was not accepted.' : 'The backup email could not be updated.', 'error');
      return;
    }
    if (recoveryPassword) recoveryPassword.value = '';
    if (recoveryState) recoveryState.textContent = `${email} is not verified yet. Check the verification email.`;
    setStatus(recoverySettingsStatus, data.verificationSent === true ? 'Verification email sent.' : 'Saved, but the verification email could not be sent.', data.verificationSent === true ? 'success' : 'error');
  } catch {
    setStatus(recoverySettingsStatus, 'The recovery settings could not be reached.', 'error');
  }
}

async function boot(): Promise<void> {
  const params = new URLSearchParams(location.search);
  const verifyToken = params.get('verify') ?? '';
  const resetToken = params.get('reset') ?? '';
  try {
    const response = await api('/api/gift-auth');
    const data = await json(response);
    if (!response.ok) {
      show('login');
      setStatus(loginStatus, 'The administrator service is not available.', 'error');
      return;
    }
    if (data.authenticated === true && data.session) {
      const session = data.session as { csrf?: string; admin?: typeof authState };
      csrf = String(session.csrf ?? '');
      authState = session.admin ?? {};
      if (verifyToken) showVerify(verifyToken);
      else if (resetToken) showReset(resetToken);
      else showDashboard();
      return;
    }
    if (data.configured === false) showSetup();
    else if (verifyToken) showVerify(verifyToken);
    else if (resetToken) showReset(resetToken);
    else showLogin();
  } catch {
    show('login');
    setStatus(loginStatus, 'The administrator service could not be reached.', 'error');
  }
}

loginForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const password = loginPassword?.value ?? '';
  if (!password) return;
  setStatus(loginStatus, 'Signing in…', 'info');
  try {
    const response = await api('/api/gift-auth', {
      method: 'POST',
      body: JSON.stringify({ action: 'login', password }),
    });
    const data = await json(response);
    if (!response.ok) {
      setStatus(loginStatus, String(data.error ?? '') === 'rate_limited' ? 'Too many attempts. Wait 15 minutes and try again.' : 'The password was not accepted.', 'error');
      return;
    }
    const session = data.session as { csrf?: string; admin?: typeof authState };
    csrf = String(session?.csrf ?? '');
    authState = session?.admin ?? {};
    if (loginPassword) loginPassword.value = '';
    showDashboard();
  } catch {
    setStatus(loginStatus, 'Sign in could not be reached.', 'error');
  }
});

setupForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (setupPassword?.value !== setupConfirm?.value) {
    setStatus(setupStatus, 'The passwords do not match.', 'error');
    return;
  }
  setStatus(setupStatus, 'Creating the administrator…', 'info');
  try {
    const response = await api('/api/gift-auth', {
      method: 'POST',
      body: JSON.stringify({
        action: 'setup',
        setupCode: setupCode?.value ?? '',
        password: setupPassword?.value ?? '',
        recoveryEmail: setupEmail?.value ?? '',
      }),
    });
    const data = await json(response);
    if (!response.ok) {
      setStatus(setupStatus, String(data.message ?? data.error ?? 'Setup did not complete.'), 'error');
      return;
    }
    const session = data.session as { csrf?: string; admin?: typeof authState };
    csrf = String(session?.csrf ?? '');
    authState = session?.admin ?? {};
    showDashboard();
    setStatus(listStatus, data.verificationSent === true ? 'Administrator created. Check the backup email for the verification link.' : 'Administrator created. Email verification was not sent.', data.verificationSent === true ? 'success' : 'info');
  } catch {
    setStatus(setupStatus, 'Setup could not be reached.', 'error');
  }
});

recoveryForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  setStatus(recoveryStatus, 'Requesting recovery…', 'info');
  try {
    await api('/api/gift-auth', {
      method: 'POST',
      body: JSON.stringify({ action: 'recover', channel: recoveryChannel?.value || 'email' }),
    });
    setStatus(recoveryStatus, 'If a verified recovery channel is enrolled, a single-use link has been sent. Check your email.', 'success');
  } catch {
    setStatus(recoveryStatus, 'The recovery request could not be reached.', 'error');
  }
});

resetForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (resetPassword?.value !== resetConfirm?.value) {
    setStatus(resetStatus, 'The passwords do not match.', 'error');
    return;
  }
  const token = resetForm.dataset.token ?? '';
  setStatus(resetStatus, 'Resetting the password…', 'info');
  try {
    const response = await api('/api/gift-auth', {
      method: 'POST',
      body: JSON.stringify({ action: 'reset', token, password: resetPassword?.value ?? '' }),
    });
    const data = await json(response);
    if (!response.ok) {
      setStatus(resetStatus, String(data.message ?? 'The reset link is invalid or expired.'), 'error');
      return;
    }
    history.replaceState({}, '', '/gift-admin/');
    showLogin();
    setStatus(loginStatus, 'Password reset. Sign in with the new password.', 'success');
  } catch {
    setStatus(resetStatus, 'The reset could not be reached.', 'error');
  }
});

$('[data-gift-verify-email]')?.addEventListener('click', async () => {
  const token = panels.verify?.dataset.token ?? '';
  setStatus(verifyStatus, 'Verifying…', 'info');
  try {
    const response = await api('/api/gift-auth', {
      method: 'POST',
      body: JSON.stringify({ action: 'verify-email', token }),
    });
    if (!response.ok) {
      setStatus(verifyStatus, 'This verification link is invalid or expired.', 'error');
      return;
    }
    history.replaceState({}, '', '/gift-admin/');
    setStatus(verifyStatus, 'Recovery email verified.', 'success');
    showLogin();
  } catch {
    setStatus(verifyStatus, 'Verification could not be reached.', 'error');
  }
});

$('[data-gift-show-recovery]')?.addEventListener('click', showRecovery);
$('[data-gift-show-login]')?.addEventListener('click', showLogin);
filterForm?.addEventListener('submit', (event) => {
  event.preventDefault();
  void loadDashboard(1);
});
prevPage?.addEventListener('click', () => void loadDashboard(Math.max(1, currentPage - 1)));
nextPage?.addEventListener('click', () => void loadDashboard(Math.min(totalPages, currentPage + 1)));
$('[data-gift-close-detail]')?.addEventListener('click', () => {
  if (detail) detail.hidden = true;
  currentCode = '';
});
$('[data-gift-redeem]')?.addEventListener('click', () => void financialAction('redeem'));
$('[data-gift-refund]')?.addEventListener('click', () => void financialAction('refund'));
$('[data-gift-void]')?.addEventListener('click', () => void financialAction('void'));
$('[data-gift-resend]')?.addEventListener('click', () => void financialAction('resend'));
$('[data-gift-update-recovery]')?.addEventListener('click', () => void updateRecovery());
$('[data-gift-logout]')?.addEventListener('click', async () => {
  try {
    await api('/api/gift-auth', { method: 'POST', body: JSON.stringify({ action: 'logout' }) });
  } catch {
    // The cookie is still cleared by the server when reachable.
  }
  csrf = '';
  authState = {};
  showLogin();
  setStatus(loginStatus, 'Signed out.', 'info');
});

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => void boot());
} else {
  void boot();
}
