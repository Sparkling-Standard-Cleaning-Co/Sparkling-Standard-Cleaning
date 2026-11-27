// Admin Branches & Launch tab.
//
// The server is authoritative: lifecycle, service availability and pricing
// publication gates are enforced by the API. This module only renders the
// owner's setup form and reports the actual saved state.
import { adminConfirm } from './admin-dialog';
import { pensacolaServiceAreaGroups, pensacolaServiceAreaSummary } from '../config/service-area-pensacola.ts';

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
  reviewUrl: string;
  reviewRequestsEnabled: boolean;
  reviewRequestDelayHours: number;
  reviewRequestMaxPerCustomer: number;
  calendarId: string;
  calendarName: string;
  launchNote: string;
  originAddress: string;
  originCity: string;
  originState: string;
  originPostalCode: string;
  originLat: number | null;
  originLng: number | null;
  originPlaceId: string;
  travelLimitMiles: number | null;
  calendarBinding?: {
    configured: boolean;
    source: string;
    environmentVariable: string;
    savedName: string;
    effectiveHint: string;
    savedValueMatchesEnvironment: boolean;
  };
  readiness?: {
    ready: boolean;
    blockers: string[];
    warnings: string[];
    checklist?: Array<{
      key: string;
      label: string;
      status: 'complete' | 'warning' | 'blocked';
      detail: string;
    }>;
  };
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

function currentZipValues(): string[] {
  const textarea = field<HTMLTextAreaElement>('serviceAreaZips');
  return (textarea?.value ?? '')
    .split(/[\s,]+/)
    .map((zip) => zip.trim())
    .filter((zip) => /^\d{5}$/.test(zip))
    .filter((zip, index, array) => array.indexOf(zip) === index)
    .sort();
}

function writeZipValues(zips: string[]): void {
  const textarea = field<HTMLTextAreaElement>('serviceAreaZips');
  if (textarea) textarea.value = [...new Set(zips)].sort().join(', ');
  renderZipEditor([...new Set(zips)].sort());
}

function renderZipEditor(zips: string[]): void {
  const chips = document.querySelector<HTMLElement>('[data-branch-zip-chips]');
  if (chips) {
    chips.innerHTML = zips.length
      ? zips.map((zip) => `<span class="admin-zip-chip">${esc(zip)}<button type="button" data-admin-action="branch-zip-remove" data-zip="${esc(zip)}" aria-label="Remove ZIP ${esc(zip)}">×</button></span>`).join('')
      : '<p class="admin-muted">No ZIP codes are saved for this branch.</p>';
  }
  const inventory = document.querySelector<HTMLElement>('[data-branch-area-inventory]');
  const summary = document.querySelector<HTMLElement>('[data-branch-area-summary]');
  if (selectedId !== 'branch_pensacola') {
    if (inventory) inventory.innerHTML = `<p class="admin-muted">${zips.length} saved ZIP code(s). County inventory is defined for the Pensacola branch.</p>`;
    if (summary) summary.innerHTML = `<span class="admin-status">${zips.length} saved ZIP code(s)</span>`;
    return;
  }
  const counts = pensacolaServiceAreaSummary(zips);
  if (summary) {
    summary.innerHTML = `<span class="admin-status">${counts.total} saved ZIPs</span> <span class="admin-status">${counts.direct} direct Florida</span> <span class="admin-status">${counts.arrangement} by arrangement</span> <span class="admin-status">${counts.crossCounty} cross-county</span>`;
  }
  const groups = pensacolaServiceAreaGroups(zips);
  if (inventory) {
    inventory.innerHTML = groups.map((group) => `<div class="admin-area-group">
      <h4>${esc(group.label)} <span class="admin-status">${group.entries.length}</span></h4>
      <p class="admin-muted">${esc(group.detail)}</p>
      ${group.entries.length ? `<ul class="admin-area-zips">${group.entries.map((entry) => `<li><strong>${esc(entry.zip)}</strong> ${esc(entry.city)}${entry.counties.length > 1 ? ` — ${esc(entry.counties.join(' / '))}` : ''} <span class="admin-status">${entry.direct ? 'Direct' : entry.arrangement ? 'By arrangement' : 'Review'}</span></li>`).join('')}</ul>` : '<p class="admin-muted">None saved in this group.</p>'}
    </div>`).join('');
  }
}

function renderCalendarBinding(branch: BranchSettings): void {
  const target = document.querySelector<HTMLElement>('[data-branch-calendar-binding]');
  if (!target) return;
  const binding = branch.calendarBinding;
  if (!binding) {
    target.innerHTML = '<p class="admin-muted">Calendar binding status is unavailable.</p>';
    return;
  }
  const source = binding.source === 'branch_settings'
    ? 'Saved branch calendar'
    : binding.source === 'environment'
      ? 'Server environment variable'
      : 'Not configured';
  target.innerHTML = `<dl class="admin-definition">
    <dt>Effective source</dt><dd>${esc(source)}</dd>
    <dt>Environment variable</dt><dd>${esc(binding.environmentVariable)}</dd>
    <dt>Saved calendar name</dt><dd>${esc(binding.savedName || 'Not saved on this branch')}</dd>
    <dt>Effective calendar</dt><dd>${esc(binding.effectiveHint || 'Not configured')}</dd>
    <dt>Saved value matches environment</dt><dd>${binding.configured && binding.source === 'branch_settings' ? (binding.savedValueMatchesEnvironment ? 'Yes' : 'No — branch setting overrides the environment') : 'Not applicable'}</dd>
  </dl>`;
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
  set('reviewUrl', branch.reviewUrl);
  set('reviewRequestDelayHours', String(branch.reviewRequestDelayHours));
  set('reviewRequestMaxPerCustomer', String(branch.reviewRequestMaxPerCustomer));
  set('calendarId', branch.calendarId);
  set('calendarName', branch.calendarName);
  const reviewEnabled = field<HTMLInputElement>('reviewRequestsEnabled');
  if (reviewEnabled) reviewEnabled.checked = branch.reviewRequestsEnabled === true;
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
  renderCalendarBinding(branch);
  renderZipEditor(branch.serviceAreaZips);
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
  const checklist = branch.readiness?.checklist ?? [];
  const checklistHtml = checklist.length
    ? '<div class="admin-card" style="margin-top:.75rem;"><h3 style="font-size:1rem;">Branch readiness checklist</h3><div class="admin-table-scroll"><table class="admin-table"><thead><tr><th>Requirement</th><th>Status</th><th>Detail</th></tr></thead><tbody>' +
      checklist
        .map(
          (item) =>
            '<tr><td>' +
            esc(item.label) +
            '</td><td>' +
            esc(item.status === 'complete' ? 'Complete' : item.status === 'warning' ? 'Warning' : 'Blocked') +
            '</td><td>' +
            esc(item.detail) +
            '</td></tr>',
        )
        .join('') +
      '</tbody></table></div></div>'
    : '';
  target.innerHTML =
    (branch.readiness?.ready
      ? '<div class="admin-dispatch-good"><strong>Infrastructure checks passed.</strong> All configured branch launch prerequisites are present. Owner activation still controls public availability.</div>' +
        (warnings.length
          ? '<div class="admin-dispatch-warning" style="margin-top:.5rem;"><strong>Warnings:</strong> ' +
            esc(warnings.join(', ')) +
            '</div>'
          : '')
      : '<div class="admin-dispatch-warning"><strong>Not ready for activation.</strong><ul>' +
        blockers.map((reason) => '<li>' + esc(reason) + '</li>').join('') +
        warnings.map((reason) => '<li>Warning: ' + esc(reason) + '</li>').join('') +
        '</ul></div>') +
    checklistHtml;
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

async function checkCalendarConnection(): Promise<void> {
  const target = document.querySelector<HTMLElement>('[data-branch-calendar-status]');
  if (target) target.textContent = 'Checking the saved branch calendar binding…';
  try {
    const response = await fetch(`/api/admin/branches?view=calendar_status&branchId=${encodeURIComponent(selectedId)}`, {
      credentials: 'same-origin',
    });
    const data = (await response.json().catch(() => ({}))) as {
      ok?: boolean;
      configured?: boolean;
      connected?: boolean;
      reason?: string;
      calendarName?: string;
      timeZone?: string;
      binding?: { source?: string; effectiveHint?: string };
      error?: string;
    };
    if (!response.ok || data.ok !== true) throw new Error(data.error ?? 'calendar_check_failed');
    if (target) {
      target.textContent = data.connected
        ? `Connected to ${data.calendarName || 'the configured calendar'}${data.timeZone ? ` (${data.timeZone})` : ''}. Binding: ${data.binding?.source ?? 'unknown'}; ${data.binding?.effectiveHint ?? ''}`
        : `Calendar is not connected${data.reason ? ` (${data.reason.replaceAll('_', ' ')})` : ''}. Binding: ${data.binding?.source ?? 'unknown'}; ${data.binding?.effectiveHint ?? ''}`;
      target.dataset.kind = data.connected ? 'ok' : 'error';
    }
  } catch (error) {
    if (target) {
      target.textContent = error instanceof Error ? error.message.replaceAll('_', ' ') : 'Calendar check failed.';
      target.dataset.kind = 'error';
    }
  }
}

document.addEventListener('click', (event) => {
  const actionTarget = (event.target as HTMLElement).closest<HTMLElement>('[data-admin-action]');
  const action = actionTarget?.dataset.adminAction ?? '';
  if (action === 'branch-zip-add') {
    const input = document.querySelector<HTMLInputElement>('[data-branch-zip-add]');
    const zip = (input?.value ?? '').trim();
    if (!/^\d{5}$/.test(zip)) {
      status('Enter a valid five-digit ZIP code.', 'error');
      return;
    }
    const next = currentZipValues();
    if (!next.includes(zip)) next.push(zip);
    writeZipValues(next);
    if (input) input.value = '';
    status('ZIP added to the saved list. Save the branch setup to apply it.', 'info');
    return;
  }
  if (action === 'branch-zip-remove') {
    const zip = actionTarget?.dataset.zip ?? '';
    writeZipValues(currentZipValues().filter((value) => value !== zip));
    status('ZIP removed from the saved list. Save the branch setup to apply it.', 'info');
    return;
  }
  if (action === 'branch-calendar-check') {
    void checkCalendarConnection();
  }
});

document.querySelector<HTMLTextAreaElement>('[data-branch-form] [name="serviceAreaZips"]')?.addEventListener('change', () => {
  renderZipEditor(currentZipValues());
});

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
    reviewUrl: data.get('reviewUrl'),
    reviewRequestsEnabled: data.get('reviewRequestsEnabled') === 'on',
    reviewRequestDelayHours: data.get('reviewRequestDelayHours'),
    reviewRequestMaxPerCustomer: data.get('reviewRequestMaxPerCustomer'),
    calendarId: data.get('calendarId'),
    calendarName: data.get('calendarName'),
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
    if (!(await adminConfirm({ title: 'Advance this branch to LIVE?', body: '<p>Public pages, pricing and booking gates will follow the saved settings. Verify staffing, licensing, insurance, tax, capacity and local contact first.</p>', confirmLabel: 'Advance to live' }))) {
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
