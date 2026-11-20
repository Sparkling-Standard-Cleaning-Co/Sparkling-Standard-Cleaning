// Admin Branches & Launch tab.
//
// The server is authoritative: lifecycle, service availability and pricing
// publication gates are enforced by the API. This module only renders the
// owner's setup form and reports the actual saved state.

interface BranchSettings {
  id: string;
  name: string;
  lifecycle: string;
  publicName: string;
  publicSlug: string;
  regionLabel: string;
  timezone: string;
  publicPhone: string;
  publicEmail: string;
  hoursLabel: string;
  serviceAreaZips: string[];
  serviceStates: string[];
  services: Record<'residential' | 'str' | 'commercial' | 'church', string>;
  gbpStatus: string;
  gbpUrl: string;
  launchNote: string;
  originAddress: string;
  originCity: string;
  originState: string;
  originPostalCode: string;
  originLat: number | null;
  originLng: number | null;
  originPlaceId: string;
  travelLimitMiles: number | null;
  readiness?: { ready: boolean; blockers: string[]; warnings: string[] };
}

interface BranchResponse {
  ok: boolean;
  branches: BranchSettings[];
}

let branches: BranchSettings[] = [];
let selectedId = 'branch_pensacola';
let bound = false;

function esc(value: unknown): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function status(message: string, kind: 'ok' | 'error' | 'info' = 'info'): void {
  const target = document.querySelector<HTMLElement>('[data-branch-form-status]');
  if (!target) return;
  target.textContent = message;
  target.dataset.kind = kind;
}

function selected(): BranchSettings | null {
  return branches.find((branch) => branch.id === selectedId) ?? null;
}

function field<T extends HTMLElement>(name: string): T | null {
  return document.querySelector<T>(`[data-branch-form] [name="${name}"]`);
}

function fillForm(): void {
  const branch = selected();
  if (!branch) return;
  const set = (name: string, value: string): void => {
    const element = field<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(name);
    if (element) element.value = value;
  };
  set('lifecycle', branch.lifecycle);
  set('publicName', branch.publicName);
  set('publicSlug', branch.publicSlug);
  set('regionLabel', branch.regionLabel);
  set('timezone', branch.timezone);
  set('publicPhone', branch.publicPhone);
  set('publicEmail', branch.publicEmail);
  set('hoursLabel', branch.hoursLabel);
  set('gbpStatus', branch.gbpStatus);
  set('gbpUrl', branch.gbpUrl);
  set('serviceAreaZips', branch.serviceAreaZips.join(', '));
  set('serviceResidential', branch.services.residential);
  set('serviceStr', branch.services.str);
  set('serviceCommercial', branch.services.commercial);
  set('serviceChurch', branch.services.church);
  set('launchNote', branch.launchNote);
  set('travelLimitMiles', branch.travelLimitMiles === null ? '' : String(branch.travelLimitMiles));
  const branchField = field<HTMLInputElement>('branchId');
  if (branchField) branchField.value = branch.id;
  const addressBlock = document.querySelector<HTMLElement>('[data-branch-form] [data-admin-address-block]');
  addressBlock?.dispatchEvent(new Event('admin-address-reset'));
  set('addressLine1', branch.originAddress);
  set('city', branch.originCity);
  set('state', branch.originState);
  set('postalCode', branch.originPostalCode);
  set('latitude', branch.originLat === null ? '' : String(branch.originLat));
  set('longitude', branch.originLng === null ? '' : String(branch.originLng));
  set('placeId', branch.originPlaceId);
  const addressStatus = document.querySelector<HTMLElement>('[data-branch-form] [data-admin-address-status]');
  if (addressStatus) {
    addressStatus.textContent = branch.originLat !== null && branch.originLng !== null
      ? 'Operating origin saved.'
      : 'No verified operating origin is saved.';
    addressStatus.className = 'admin-address-status admin-address-status--muted';
  }
  renderReadiness(branch);
  const fl = field<HTMLInputElement>('serviceStateFL');
  const al = field<HTMLInputElement>('serviceStateAL');
  if (fl) fl.checked = branch.serviceStates.includes('FL');
  if (al) al.checked = branch.serviceStates.includes('AL');
  const title = document.querySelector<HTMLElement>('[data-branch-status]');
  if (title) {
    title.textContent = `${branch.name}: ${branch.lifecycle}. ${branch.lifecycle === 'live' ? 'Public operations may be active.' : 'Not publicly bookable.'}`;
  }
}

function renderReadiness(branch: BranchSettings): void {
  const target = document.querySelector<HTMLElement>('[data-branch-readiness]');
  if (!target) return;
  const blockers = branch.readiness?.blockers ?? [];
  const warnings = branch.readiness?.warnings ?? [];
  target.innerHTML = branch.readiness?.ready
    ? '<div class="admin-dispatch-good"><strong>Infrastructure checks passed.</strong> All configured branch launch prerequisites are present. Owner activation still controls public availability.</div>' +
      (warnings.length ? '<div class="admin-dispatch-warning" style="margin-top:.5rem;"><strong>Warnings:</strong> ' + esc(warnings.join(', ')) + '</div>' : '')
    : '<div class="admin-dispatch-warning"><strong>Not ready for activation.</strong><ul>' +
      blockers.map((reason) => '<li>' + esc(reason) + '</li>').join('') +
      warnings.map((reason) => '<li>Warning: ' + esc(reason) + '</li>').join('') +
      '</ul></div>';
}

function renderSelect(): void {
  const select = document.querySelector<HTMLSelectElement>('[data-branch-select]');
  if (!select) return;
  select.innerHTML = branches
    .map((branch) => `<option value="${esc(branch.id)}">${esc(branch.name)} - ${esc(branch.lifecycle)}</option>`)
    .join('');
  select.value = selectedId;
}

async function csrfToken(): Promise<string> {
  const response = await fetch('/api/admin/auth', { credentials: 'same-origin' });
  const data = (await response.json().catch(() => ({}))) as { csrf?: string };
  if (!data.csrf) throw new Error('Your secure session has expired. Sign in again.');
  return data.csrf;
}

async function load(): Promise<void> {
  const response = await fetch('/api/admin/branches', { credentials: 'same-origin' });
  const data = (await response.json().catch(() => ({}))) as BranchResponse & { error?: string };
  if (!response.ok || data.ok !== true) throw new Error(data.error ?? 'Branch settings could not be loaded.');
  branches = data.branches ?? [];
  if (!branches.some((branch) => branch.id === selectedId)) {
    selectedId = branches[0]?.id ?? 'branch_pensacola';
  }
  renderSelect();
  fillForm();
}

function bind(): void {
  if (bound) return;
  bound = true;
  document.querySelector<HTMLSelectElement>('[data-branch-select]')?.addEventListener('change', (event) => {
    selectedId = (event.currentTarget as HTMLSelectElement).value;
    fillForm();
  });
  document.querySelector<HTMLElement>('[data-branch-refresh]')?.addEventListener('click', () => {
    void load().catch((error: unknown) => status(error instanceof Error ? error.message : 'Refresh failed.', 'error'));
  });
  document.querySelector<HTMLFormElement>('[data-branch-form]')?.addEventListener('submit', (event) => {
    event.preventDefault();
    void save();
  });
}

async function save(): Promise<void> {
  const form = document.querySelector<HTMLFormElement>('[data-branch-form]');
  if (!form) return;
  const data = new FormData(form);
  const zips = String(data.get('serviceAreaZips') ?? '')
    .split(/[\s,]+/)
    .map((zip) => zip.trim())
    .filter(Boolean);
  const body = {
    branchId: selectedId,
    lifecycle: data.get('lifecycle'),
    publicName: data.get('publicName'),
    publicSlug: data.get('publicSlug'),
    regionLabel: data.get('regionLabel'),
    timezone: data.get('timezone'),
    publicPhone: data.get('publicPhone'),
    publicEmail: data.get('publicEmail'),
    hoursLabel: data.get('hoursLabel'),
    gbpStatus: data.get('gbpStatus'),
    gbpUrl: data.get('gbpUrl'),
    originAddress: data.get('addressLine1'),
    originCity: data.get('city'),
    originState: data.get('state'),
    originPostalCode: data.get('postalCode'),
    originLat: data.get('latitude') || null,
    originLng: data.get('longitude') || null,
    originPlaceId: data.get('placeId'),
    travelLimitMiles: data.get('travelLimitMiles') || null,
    serviceAreaZips: zips,
    serviceStates: [
      ...(data.get('serviceStateFL') ? ['FL'] : []),
      ...(data.get('serviceStateAL') ? ['AL'] : []),
    ],
    services: {
      residential: data.get('serviceResidential'),
      str: data.get('serviceStr'),
      commercial: data.get('serviceCommercial'),
      church: data.get('serviceChurch'),
    },
    launchNote: data.get('launchNote'),
    note: data.get('note'),
  };
  const previous = selected()?.lifecycle;
  if (body.lifecycle === 'live' && previous !== 'live') {
    if (!window.confirm('Advance this branch to LIVE? Public pages, pricing and booking gates will follow the saved settings. Verify staffing, licensing, insurance, tax, capacity and local contact first.')) {
      return;
    }
  }
  status('Saving branch setup...', 'info');
  try {
    const csrf = await csrfToken();
    const response = await fetch('/api/admin/branches', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
      body: JSON.stringify(body),
    });
    const result = (await response.json().catch(() => ({}))) as BranchResponse & { error?: string; message?: string };
    if (!response.ok || result.ok !== true) {
      throw new Error(result.message || result.error || 'Branch setup could not be saved.');
    }
    branches = result.branches ?? branches;
    renderSelect();
    fillForm();
    status('Branch setup saved. Pricing publication and public booking remain gated by the lifecycle.', 'ok');
  } catch (error) {
    status(error instanceof Error ? error.message : 'Branch setup could not be saved.', 'error');
  }
}

/** Called by the admin shell when Branches & Launch opens. */
export async function loadBranchView(): Promise<void> {
  bind();
  try {
    await load();
  } catch (error) {
    status(error instanceof Error ? error.message : 'Branch settings could not be loaded.', 'error');
  }
}
