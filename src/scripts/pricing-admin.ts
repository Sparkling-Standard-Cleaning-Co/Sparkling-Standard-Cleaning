// Admin Pricing & Estimator Control tab.
//
// Renders the pricing catalog, edits a draft snapshot, runs the shared pricing
// simulator, and manages publish/rollback. The server is authoritative; this
// module never calculates a customer price on its own.

import {
  getPathValue,
  pricingCatalog,
  setPathValue,
  type PricingCatalogEntry,
  type PricingEngine,
} from '../lib/pricing/catalog';
import { ownerPricing } from '../config/estimators/pricing-values';
import type { PricingSnapshot } from '../lib/pricing/snapshot';

interface VersionPayload {
  id: string;
  version: number;
  status: 'draft' | 'published' | 'archived';
  fingerprint: string;
  note: string;
  basedOnVersion: number | null;
  createdAt: string;
  createdBy: string;
  createdByEmail: string | null;
  updatedAt: string;
  publishedAt: string | null;
  publishedBy: string | null;
  publishedByEmail: string | null;
  snapshot: PricingSnapshot;
}

interface VersionSummary {
  id: string;
  version: number;
  status: 'draft' | 'published' | 'archived';
  fingerprint: string;
  note: string;
  basedOnVersion: number | null;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
  createdByEmail: string | null;
  publishedByEmail: string | null;
}

interface LoadResponse {
  ok: boolean;
  published: VersionPayload | null;
  draft: VersionPayload | null;
  versions: VersionSummary[];
  baseline: { fingerprint: string; summary: { changedValues: number; totalValues: number }; snapshot: PricingSnapshot };
  catalog: PricingCatalogEntry[];
}

interface SimulatorPrice {
  status: 'priced' | 'custom_confirmation_required' | 'invalid' | 'pricing_disabled';
  total: number | null;
  range: { low: number; high: number } | null;
  laborHours: number | null;
  breakdown: {
    basePrice: number;
    extrasSubtotal: number;
    discount: { label: string; amount: number } | null;
    travelAdjustment: number;
    globalFactor: number;
    globalAdjustment: number;
    roundingAdjustment: number;
    subtotal: number;
    totalLaborHours: number;
    minimumApplied: boolean;
  } | null;
  cleaningSubtotal: number | null;
  travelAdjustment: number | null;
  extrasSubtotal: number | null;
  discountAmount: number | null;
  ongoingPerVisit: number | null;
  tier: 'A' | 'B' | 'C' | null;
  discountLabel: string | null;
  message: string | null;
}

interface SimulatorComparison {
  engine: string;
  published: SimulatorPrice;
  draft: SimulatorPrice;
  differenceUsd: number | null;
  differencePercent: number | null;
  laborHoursDifference: number | null;
}

interface PricingState {
  loaded: boolean;
  loading: boolean;
  dirty: boolean;
  published: VersionPayload | null;
  draft: VersionPayload | null;
  versions: VersionSummary[];
  baseline: LoadResponse['baseline'] | null;
  catalog: PricingCatalogEntry[];
  editor: PricingSnapshot | null;
  notice: string;
  noticeKind: 'ok' | 'error' | 'info';
}

const state: PricingState = {
  loaded: false,
  loading: false,
  dirty: false,
  published: null,
  draft: null,
  versions: [],
  baseline: null,
  catalog: [],
  editor: null,
  notice: '',
  noticeKind: 'info',
};

let eventsBound = false;
let simulateTimer: number | null = null;
let csrfCache = '';

function esc(value: unknown): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function usd(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value);
}

function number(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  return typeof value === 'number' ? String(value) : String(value);
}

function shortFingerprint(value: string | null | undefined): string {
  return value ? value.slice(-12) : '—';
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

async function api(path: string, init: RequestInit = {}): Promise<Record<string, unknown>> {
  const response = await fetch(path, {
    credentials: 'same-origin',
    ...init,
    headers: {
      Accept: 'application/json',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init.headers ?? {}),
    },
  });
  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok || data.ok !== true) {
    const code = typeof data.error === 'string' ? data.error : `request_failed_${response.status}`;
    const message = typeof data.message === 'string' ? data.message : '';
    throw new Error(message ? `${code}: ${message}` : code);
  }
  return data;
}

async function csrfToken(): Promise<string> {
  if (csrfCache) return csrfCache;
  const data = await api('/api/admin/auth');
  if (typeof data.csrf !== 'string' || !data.csrf) throw new Error('Your secure session has expired. Sign in again.');
  csrfCache = data.csrf;
  return csrfCache;
}

async function postPricing(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const csrf = await csrfToken();
  return api('/api/admin/pricing', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'X-CSRF-Token': csrf },
  });
}

function editorSnapshot(): PricingSnapshot {
  if (!state.editor) throw new Error('The pricing editor is not ready yet.');
  return state.editor;
}

function publishedSnapshot(): PricingSnapshot {
  return state.published?.snapshot ?? state.baseline?.snapshot ?? editorSnapshot();
}

function setNotice(message: string, kind: 'ok' | 'error' | 'info' = 'info'): void {
  state.notice = message;
  state.noticeKind = kind;
  const notice = document.querySelector<HTMLElement>('[data-pricing-notice]');
  if (notice) {
    notice.textContent = message;
    notice.dataset.kind = kind;
  }
}

function categoryOrder(): string[] {
  return [...new Set(state.catalog.map((entry) => entry.category))];
}

function categoryLabel(category: string): string {
  return category;
}

function entryValue(snapshot: PricingSnapshot | null, path: string): unknown {
  return snapshot ? getPathValue(snapshot, path) : undefined;
}

function changed(entry: PricingCatalogEntry): boolean {
  if (!state.editor) return false;
  return JSON.stringify(entryValue(state.editor, entry.path)) !== JSON.stringify(entryValue(publishedSnapshot(), entry.path));
}

function renderStatus(): void {
  const target = document.querySelector<HTMLElement>('[data-pricing-status]');
  if (!target) return;
  const published = state.published;
  const draft = state.draft;
  target.innerHTML = `
    <div class="pricing-status-grid">
      <div class="pricing-status-card">
        <span class="pricing-status-card__label">Published${published ? ` · v${published.version}` : ''}</span>
        <strong>${published ? esc(published.fingerprint.slice(-16)) : 'Source baseline'}</strong>
        <span class="admin-muted">${published?.publishedAt ? `Published ${esc(new Date(published.publishedAt).toLocaleString())}` : 'No owner-published version yet. Current source prices remain live.'}</span>
      </div>
      <div class="pricing-status-card">
        <span class="pricing-status-card__label">${draft ? `Draft · v${draft.version}` : 'No draft'}</span>
        <strong>${draft ? esc(draft.fingerprint.slice(-16)) : '—'}</strong>
        <span class="admin-muted">${draft ? `Saved ${esc(new Date(draft.updatedAt).toLocaleString())}` : 'Save a draft to prepare changes without changing customer prices.'}</span>
      </div>
      <div class="pricing-status-card">
        <span class="pricing-status-card__label">Editor</span>
        <strong>${state.dirty ? 'Unsaved changes' : 'In sync'}</strong>
        <span class="admin-muted">${published ? `Published v${published.version}` : 'Source baseline'}${draft ? ` · draft v${draft.version}` : ''}</span>
      </div>
    </div>`;
  const publish = document.querySelector<HTMLButtonElement>('[data-pricing-action="publish"]');
  if (publish) publish.disabled = !draft && !state.dirty;
  const discard = document.querySelector<HTMLButtonElement>('[data-pricing-action="discard"]');
  if (discard) discard.disabled = !draft;
}

function renderEditor(): void {
  const target = document.querySelector<HTMLElement>('[data-pricing-editor]');
  if (!target || !state.editor) return;
  const published = publishedSnapshot();
  const categories = categoryOrder();
  target.innerHTML = categories
    .map((category) => {
      const entries = state.catalog.filter((entry) => entry.category === category);
      return `<details class="pricing-category" open>
        <summary>${esc(categoryLabel(category))} <span class="admin-muted">(${entries.length})</span></summary>
        <div class="pricing-field-grid">
          ${entries.map((entry) => renderField(entry, published)).join('')}
        </div>
      </details>`;
    })
    .join('');
  bindEditorInputs(target);
}

function renderField(entry: PricingCatalogEntry, published: PricingSnapshot): string {
  const current = entryValue(state.editor, entry.path);
  const source = entryValue(published, entry.path);
  const dirty = changed(entry);
  const input =
    entry.kind === 'boolean'
      ? `<input type="checkbox" aria-label="${esc(entry.label)}" data-pricing-path="${esc(entry.path)}" ${current === true ? 'checked' : ''} />`
      : `<input type="number" aria-label="${esc(entry.label)}" inputmode="decimal" data-pricing-path="${esc(entry.path)}"
           ${entry.min !== undefined ? `min="${entry.min}"` : ''}
           ${entry.max !== undefined ? `max="${entry.max}"` : ''}
           ${entry.step !== undefined ? `step="${entry.step}"` : 'step="any"'}
           value="${current === null || current === undefined ? '' : esc(current)}" />`;
  return `<div class="pricing-field${dirty ? ' pricing-field--changed' : ''}" data-pricing-field="${esc(entry.path)}">
    <div class="pricing-field__head">
      <span class="pricing-field__label">${esc(entry.label)}</span>
      <span class="pricing-field__published">Published: <strong>${esc(number(source))}</strong></span>
    </div>
    <div class="pricing-field__control">
      ${input}
      <span class="pricing-field__unit">${esc(entry.unit)}</span>
      <span class="pricing-field__engines">${entry.engines.map(engineLabel).join(' · ')}</span>
    </div>
    <p class="pricing-field__description">${esc(entry.description)}</p>
    <p class="pricing-field__impact"><strong>Effect:</strong> ${esc(entry.impact)}</p>
    <p class="pricing-field__example"><strong>Example:</strong> ${esc(entry.example)}</p>
  </div>`;
}

function engineLabel(engine: PricingEngine): string {
  return engine === 'str' ? 'STR' : engine.charAt(0).toUpperCase() + engine.slice(1);
}

function bindEditorInputs(target: HTMLElement): void {
  for (const input of target.querySelectorAll<HTMLInputElement>('[data-pricing-path]')) {
    input.addEventListener('input', () => {
      const path = input.dataset.pricingPath ?? '';
      const entry = state.catalog.find((candidate) => candidate.path === path);
      if (!entry || !state.editor) return;
      let value: unknown;
      if (entry.kind === 'boolean') {
        value = input.checked;
      } else if (input.value.trim() === '') {
        if (!entry.allowNull) return;
        value = null;
      } else {
        value = Number(input.value);
        if (!Number.isFinite(value)) return;
      }
      setPathValue(state.editor, path, value);
      state.dirty = true;
      const field = input.closest<HTMLElement>('[data-pricing-field]');
      field?.classList.toggle('pricing-field--changed', changed(entry));
      renderStatus();
      scheduleSimulation();
    });
    input.addEventListener('change', () => scheduleSimulation());
  }
}

function addonOptions(): Array<{ id: string; label: string }> {
  return ownerPricing.addons.filter((addon) => !addon.customQuote).map((addon) => ({ id: addon.id, label: addon.label }));
}

function renderSimulator(): void {
  const target = document.querySelector<HTMLElement>('[data-pricing-simulator]');
  if (!target) return;
  target.innerHTML = `
    <form class="pricing-simulator" data-pricing-sim-form>
      <div class="pricing-simulator__row">
        <label>Estimator
          <select data-sim="engine">
            <option value="residential">Residential</option>
            <option value="str">STR / Airbnb turnover</option>
            <option value="commercial">Commercial</option>
            <option value="church">Church</option>
          </select>
        </label>
        <label>Travel (one-way miles)<input type="number" min="0" step="0.1" data-sim="oneWayMiles" value="17.5" /></label>
        <label>Routed driving minutes<input type="number" min="0" step="1" data-sim="durationMinutes" value="25" /></label>
        <button class="btn btn--secondary btn--small" type="button" data-pricing-action="simulate">Run simulation</button>
      </div>
      <fieldset data-sim-residential>
        <legend>Residential / STR scenario</legend>
        <div class="pricing-simulator__row">
          <label>Service
            <select data-sim="serviceType">
              <option value="standard">Standard residential</option>
              <option value="deep">Deep cleaning</option>
              <option value="move_in_out">Move-in / move-out</option>
              <option value="str_turnover">STR turnover</option>
            </select>
          </label>
          <label>Frequency
            <select data-sim="frequency">
              <option value="one_time">One time</option>
              <option value="weekly">Weekly</option>
              <option value="biweekly">Biweekly</option>
              <option value="monthly">Monthly</option>
            </select>
          </label>
          <label>ZIP<input type="text" inputmode="numeric" maxlength="5" data-sim="zip" value="32533" /></label>
          <label>Square feet<input type="number" min="200" step="50" data-sim="squareFeet" value="1600" /></label>
          <label>Bedrooms<input type="number" min="0" step="1" data-sim="bedrooms" value="3" /></label>
          <label>Full baths<input type="number" min="0" step="1" data-sim="fullBaths" value="2" /></label>
          <label>Half baths<input type="number" min="0" step="1" data-sim="halfBaths" value="1" /></label>
          <label>Beds (STR)<input type="number" min="0" step="1" data-sim="beds" value="2" /></label>
          <label>Condition
            <select data-sim="condition">
              <option value="maintained">Maintained</option>
              <option value="average">Average</option>
              <option value="needs_attention">Needs attention</option>
              <option value="heavy">Heavy buildup</option>
              <option value="severe">Severe</option>
            </select>
          </label>
          <label>Last clean
            <select data-sim="lastClean">
              <option value="within_month">Within a month</option>
              <option value="one_to_three_months">1–3 months</option>
              <option value="three_to_twelve_months">3–12 months</option>
              <option value="over_a_year">Over a year</option>
              <option value="never_professional">Never professional</option>
              <option value="not_sure">Not sure</option>
            </select>
          </label>
          <label>Promotion code<input type="text" data-sim="promotionCode" placeholder="Optional" /></label>
          <label class="pricing-simulator__check"><input type="checkbox" data-sim="supportiveEligible" /> Community Support eligible</label>
        </div>
        <details><summary>Optional extras</summary>
          <div class="pricing-simulator__addons">
            ${addonOptions().map((addon) => `<label><input type="checkbox" data-sim-addon="${esc(addon.id)}" /> ${esc(addon.label)}</label>`).join('')}
          </div>
        </details>
      </fieldset>
      <fieldset data-sim-facility hidden>
        <legend>Commercial / church scenario</legend>
        <div class="pricing-simulator__row">
          <label>Cleanable sq ft<input type="number" min="100" step="100" data-sim="cleanableSqft" value="2500" /></label>
          <label>Restroom fixtures<input type="number" min="0" step="1" data-sim="restroomFixtures" value="6" /></label>
          <label>Facility type
            <select data-sim="facilityType">
              <option value="office">Office</option>
              <option value="retail">Retail</option>
              <option value="salon">Salon</option>
              <option value="gym">Gym</option>
              <option value="community">Community space</option>
              <option value="church">Church</option>
            </select>
          </label>
          <label>Frequency
            <select data-sim="facilityFrequency">
              <option value="weekly">Weekly</option>
              <option value="biweekly">Biweekly</option>
              <option value="monthly">Monthly</option>
              <option value="daily">Daily</option>
            </select>
          </label>
          <label>Condition
            <select data-sim="facilityCondition">
              <option value="maintained">Maintained</option>
              <option value="average">Average</option>
              <option value="needs_attention">Needs attention</option>
              <option value="heavy">Heavy buildup</option>
            </select>
          </label>
          <label>Traffic
            <select data-sim="traffic">
              <option value="low">Low</option>
              <option value="average">Average</option>
              <option value="high">High</option>
            </select>
          </label>
          <label>Flooring
            <select data-sim="flooring">
              <option value="carpet">Carpet</option>
              <option value="hard">Hard floor</option>
              <option value="mixed">Mixed</option>
            </select>
          </label>
          <label class="pricing-simulator__check"><input type="checkbox" data-sim="breakroom" /> Breakroom / kitchen</label>
          <label class="pricing-simulator__check"><input type="checkbox" data-sim="firstClean" /> First clean</label>
          <label class="pricing-simulator__check"><input type="checkbox" data-sim="specialty" /> Specialty / scope review</label>
        </div>
      </fieldset>
    </form>`;
  const form = target.querySelector<HTMLFormElement>('[data-pricing-sim-form]');
  form?.addEventListener('submit', (event) => event.preventDefault());
  form?.addEventListener('input', () => {
    syncSimulatorVisibility();
    scheduleSimulation();
  });
  form?.addEventListener('change', () => {
    syncSimulatorVisibility();
    scheduleSimulation();
  });
  syncSimulatorVisibility();
}

function syncSimulatorVisibility(): void {
  const engine = document.querySelector<HTMLSelectElement>('[data-sim="engine"]')?.value ?? 'residential';
  const residential = document.querySelector<HTMLElement>('[data-sim-residential]');
  const facility = document.querySelector<HTMLElement>('[data-sim-facility]');
  const isFacility = engine === 'commercial' || engine === 'church';
  if (residential) residential.hidden = isFacility;
  if (facility) facility.hidden = !isFacility;
}

function inputValue(name: string): string {
  const element = document.querySelector<HTMLInputElement | HTMLSelectElement>(`[data-sim="${name}"]`);
  return element?.value ?? '';
}

function checked(name: string): boolean {
  const element = document.querySelector<HTMLInputElement>(`[data-sim="${name}"]`);
  return element?.checked ?? false;
}

function numericInput(name: string): number | null {
  const raw = Number(inputValue(name));
  return Number.isFinite(raw) ? raw : null;
}

function simulatorInput(): Record<string, unknown> {
  const engine = inputValue('engine') || 'residential';
  if (engine === 'commercial' || engine === 'church') {
    return {
      engine,
      facility: {
        cleanableSqft: numericInput('cleanableSqft'),
        restroomFixtures: numericInput('restroomFixtures'),
        breakroom: checked('breakroom'),
        facilityType: inputValue('facilityType') || 'office',
        condition: inputValue('facilityCondition') || 'average',
        traffic: inputValue('traffic') || 'average',
        flooring: inputValue('flooring') || 'mixed',
        firstClean: checked('firstClean'),
        specialty: checked('specialty'),
        frequency: inputValue('facilityFrequency') || 'weekly',
        oneWayMiles: numericInput('oneWayMiles'),
      },
    };
  }
  const addonIds = [...document.querySelectorAll<HTMLInputElement>('[data-sim-addon]:checked')].map(
    (input) => input.dataset.simAddon ?? '',
  );
  return {
    engine,
    residential: {
      serviceType: engine === 'str' ? 'str_turnover' : inputValue('serviceType') || 'standard',
      frequency: inputValue('frequency') || 'one_time',
      zip: inputValue('zip') || '32533',
      squareFeet: numericInput('squareFeet'),
      bedrooms: numericInput('bedrooms'),
      fullBaths: numericInput('fullBaths'),
      halfBaths: numericInput('halfBaths'),
      beds: numericInput('beds'),
      condition: inputValue('condition') || 'maintained',
      lastClean: inputValue('lastClean') || 'within_month',
      addonIds,
      promotionCode: inputValue('promotionCode') || null,
      supportiveEligible: checked('supportiveEligible'),
      oneWayMiles: numericInput('oneWayMiles'),
      durationMinutes: numericInput('durationMinutes'),
    },
  };
}

function scheduleSimulation(): void {
  if (simulateTimer !== null) window.clearTimeout(simulateTimer);
  simulateTimer = window.setTimeout(() => {
    simulateTimer = null;
    void runSimulation();
  }, 450);
}

function resultCard(label: string, price: SimulatorPrice, version: string): string {
  if (price.status === 'invalid') {
    return `<div class="pricing-sim-card"><h4>${esc(label)}</h4><p class="admin-error">${esc(price.message ?? 'Invalid scenario.')}</p></div>`;
  }
  if (price.status === 'custom_confirmation_required') {
    return `<div class="pricing-sim-card"><h4>${esc(label)}</h4><p class="admin-muted">${esc(price.message ?? 'Personal confirmation required.')}</p><p>Labor hours: <strong>${esc(number(price.laborHours))}</strong></p></div>`;
  }
  if (price.status === 'pricing_disabled') {
    return `<div class="pricing-sim-card"><h4>${esc(label)}</h4><p class="admin-muted">${esc(price.message ?? 'Facility pricing disabled.')}</p></div>`;
  }
  const rows: string[] = [];
  if (price.breakdown) {
    rows.push(`<tr><td>Base service</td><td>${esc(usd(price.breakdown.basePrice))}</td></tr>`);
    rows.push(`<tr><td>Extras</td><td>${esc(usd(price.breakdown.extrasSubtotal))}</td></tr>`);
    if (price.breakdown.discount) {
      rows.push(`<tr><td>${esc(price.breakdown.discount.label)}</td><td>−${esc(usd(price.breakdown.discount.amount))}</td></tr>`);
    }
    if (price.breakdown.globalAdjustment !== 0) {
      rows.push(`<tr><td>Calibration (×${esc(price.breakdown.globalFactor.toFixed(2))})</td><td>${esc(usd(price.breakdown.globalAdjustment))}</td></tr>`);
    }
    rows.push(`<tr><td>Travel</td><td>${esc(usd(price.breakdown.travelAdjustment))}</td></tr>`);
    if (price.breakdown.roundingAdjustment !== 0) {
      rows.push(`<tr><td>Rounding</td><td>${esc(usd(price.breakdown.roundingAdjustment))}</td></tr>`);
    }
  } else {
    rows.push(`<tr><td>Cleaning subtotal</td><td>${esc(usd(price.cleaningSubtotal))}</td></tr>`);
    if (price.discountAmount !== null) {
      rows.push(`<tr><td>${esc(price.discountLabel ?? 'Discount')}</td><td>−${esc(usd(price.discountAmount))}</td></tr>`);
    }
    rows.push(`<tr><td>Travel</td><td>${esc(usd(price.travelAdjustment))}</td></tr>`);
  }
  return `<div class="pricing-sim-card">
    <h4>${esc(label)} <span class="admin-muted">${esc(version)}</span></h4>
    <p class="pricing-sim-price">${esc(usd(price.total))}</p>
    ${price.range ? `<p class="admin-muted">Range ${esc(usd(price.range.low))} – ${esc(usd(price.range.high))}</p>` : ''}
    ${price.tier ? `<p class="admin-muted">Tier ${esc(price.tier)}</p>` : ''}
    <p class="admin-muted">Labor: ${esc(number(price.laborHours))} hours${price.ongoingPerVisit !== null ? ` · Ongoing: ${esc(usd(price.ongoingPerVisit))} / visit` : ''}</p>
    <table class="admin-table pricing-sim-table"><tbody>${rows.join('')}</tbody></table>
  </div>`;
}

function renderSimulation(comparison: SimulatorComparison): void {
  const target = document.querySelector<HTMLElement>('[data-pricing-simulation-result]');
  if (!target) return;
  const diffClass =
    comparison.differenceUsd === null || Math.abs(comparison.differenceUsd) < 0.005
      ? 'pricing-diff--none'
      : comparison.differenceUsd > 0
        ? 'pricing-diff--up'
        : 'pricing-diff--down';
  const diffLabel =
    comparison.differenceUsd === null
      ? 'Not comparable'
      : `${comparison.differenceUsd >= 0 ? '+' : ''}${usd(comparison.differenceUsd)}${
          comparison.differencePercent !== null ? ` (${comparison.differencePercent >= 0 ? '+' : ''}${comparison.differencePercent.toFixed(2)}%)` : ''
        }`;
  target.innerHTML = `
    <div class="pricing-diff ${diffClass}">
      <strong>Draft vs published: ${esc(diffLabel)}</strong>
      <span class="admin-muted">Labor change: ${comparison.laborHoursDifference === null ? '—' : `${comparison.laborHoursDifference >= 0 ? '+' : ''}${comparison.laborHoursDifference.toFixed(2)} hours`}</span>
    </div>
    <div class="pricing-sim-result-grid">
      ${resultCard('Published', comparison.published, state.published ? `v${state.published.version}` : 'source baseline')}
      ${resultCard('Draft', comparison.draft, state.draft ? `v${state.draft.version}` : 'unsaved draft')}
    </div>
    <p class="admin-muted">Tax is calculated at checkout from the verified service address. The simulator intentionally excludes tax and creates no side effects.</p>`;
}

async function runSimulation(): Promise<void> {
  if (!state.editor) return;
  const target = document.querySelector<HTMLElement>('[data-pricing-simulation-result]');
  try {
    const data = await postPricing({ action: 'simulate', draftSnapshot: state.editor, input: simulatorInput() });
    if (data.comparison && typeof data.comparison === 'object') {
      renderSimulation(data.comparison as SimulatorComparison);
    }
  } catch (error) {
    if (target) {
      target.innerHTML = `<p class="admin-error">${esc(error instanceof Error ? error.message : 'The simulation could not run.')}</p>`;
    }
  }
}

function renderHistory(): void {
  const target = document.querySelector<HTMLElement>('[data-pricing-history]');
  if (!target) return;
  if (state.versions.length === 0) {
    target.innerHTML = '<p class="admin-muted">No pricing versions yet. The source baseline is live until the first publish.</p>';
    return;
  }
  target.innerHTML = `<div class="admin-table-scroll"><table class="admin-table">
    <thead><tr><th>Version</th><th>Status</th><th>Fingerprint</th><th>Created</th><th>Published / note</th><th>Actions</th></tr></thead>
    <tbody>${state.versions
      .map((version) => {
        const isCurrent = version.status === 'published';
        return `<tr>
          <td>v${version.version}</td>
          <td><span class="admin-status">${esc(version.status)}</span></td>
          <td><code>${esc(shortFingerprint(version.fingerprint))}</code></td>
          <td>${esc(new Date(version.createdAt).toLocaleString())}${version.createdByEmail ? `<br /><span class="admin-muted">${esc(version.createdByEmail)}</span>` : ''}</td>
          <td>${version.publishedAt ? esc(new Date(version.publishedAt).toLocaleString()) : '<span class="admin-muted">Not published</span>'}${version.note ? `<br /><span class="admin-muted">${esc(version.note)}</span>` : ''}</td>
          <td><div class="admin-actions">
            ${version.status === 'draft' ? `<button class="btn btn--ghost btn--small" type="button" data-pricing-delete="${esc(version.id)}">Delete draft</button>` : ''}
            ${!isCurrent ? `<button class="btn btn--ghost btn--small" type="button" data-pricing-restore="${esc(version.id)}">Restore</button>` : ''}
          </div></td>
        </tr>`;
      })
      .join('')}</tbody>
  </table></div>`;
}

function renderAll(): void {
  renderStatus();
  renderEditor();
  renderHistory();
  if (!document.querySelector('[data-pricing-sim-form]')) renderSimulator();
}

async function refresh(force = false): Promise<void> {
  if (state.loading) return;
  if (state.loaded && state.dirty && !force) {
    renderAll();
    return;
  }
  state.loading = true;
  try {
    const data = (await api('/api/admin/pricing')) as unknown as LoadResponse;
    state.published = data.published;
    state.draft = data.draft;
    state.versions = data.versions ?? [];
    state.baseline = data.baseline;
    state.catalog = data.catalog ?? pricingCatalog;
    state.editor = clone(data.draft?.snapshot ?? data.published?.snapshot ?? data.baseline.snapshot);
    state.dirty = false;
    state.loaded = true;
    setNotice('', 'info');
    renderAll();
    scheduleSimulation();
  } finally {
    state.loading = false;
  }
}

async function saveDraft(options: { silent?: boolean } = {}): Promise<boolean> {
  if (!state.editor) return false;
  try {
    if (state.draft) {
      const data = await postPricing({
        action: 'save_draft',
        id: state.draft.id,
        expectedUpdatedAt: state.draft.updatedAt,
        snapshot: state.editor,
      });
      state.draft = (data.draft as unknown as VersionPayload) ?? state.draft;
    } else {
      const data = await postPricing({ action: 'create_draft', snapshot: state.editor });
      state.draft = (data.draft as unknown as VersionPayload) ?? null;
    }
    state.dirty = false;
    state.editor = clone(state.draft?.snapshot ?? state.editor);
    if (!options.silent) setNotice('Draft saved. Customer prices are unchanged until you publish.', 'ok');
    await refresh(true);
    setNotice('Draft saved. Customer prices are unchanged until you publish.', 'ok');
    return true;
  } catch (error) {
    setNotice(error instanceof Error ? error.message : 'The draft could not be saved.', 'error');
    return false;
  }
}

async function publishDraft(): Promise<void> {
  if (!state.draft && !state.dirty) {
    setNotice('There is no draft to publish.', 'info');
    return;
  }
  if (!window.confirm('Publish this draft? New customer estimates will immediately use these prices. Existing quotes, bookings, payments and invoices keep their original amounts.')) {
    return;
  }
  if (state.dirty) {
    const saved = await saveDraft({ silent: true });
    if (!saved) return;
  }
  if (!state.draft) return;
  try {
    await postPricing({
      action: 'publish',
      id: state.draft.id,
      expectedUpdatedAt: state.draft.updatedAt,
    });
    setNotice('Pricing published. New estimates now use this version.', 'ok');
    await refresh(true);
  } catch (error) {
    setNotice(error instanceof Error ? error.message : 'The draft could not be published.', 'error');
  }
}

async function discardDraft(): Promise<void> {
  if (!state.draft) return;
  if (!window.confirm('Discard this draft? Unsaved edits and the saved draft will be deleted. Published prices are unchanged.')) return;
  try {
    await postPricing({ action: 'discard_draft', id: state.draft.id });
    setNotice('Draft discarded. Published prices are unchanged.', 'ok');
    await refresh(true);
  } catch (error) {
    setNotice(error instanceof Error ? error.message : 'The draft could not be discarded.', 'error');
  }
}

async function restoreVersion(id: string): Promise<void> {
  if (!window.confirm('Restore this version as a new published version? Existing historical quotes keep their original prices.')) return;
  try {
    await postPricing({ action: 'rollback', id });
    setNotice('Version restored as a new published version.', 'ok');
    await refresh(true);
  } catch (error) {
    setNotice(error instanceof Error ? error.message : 'The version could not be restored.', 'error');
  }
}

function bindActions(): void {
  if (eventsBound) return;
  eventsBound = true;
  document.addEventListener('click', (event) => {
    const target = event.target as HTMLElement | null;
    if (!target) return;
    const actionButton = target.closest<HTMLElement>('[data-pricing-action]');
    if (actionButton) {
      const action = actionButton.dataset.pricingAction;
      if (action === 'save-draft') void saveDraft();
      if (action === 'publish') void publishDraft();
      if (action === 'discard') void discardDraft();
      if (action === 'refresh') void refresh(true);
      if (action === 'simulate') void runSimulation();
      return;
    }
    const restore = target.closest<HTMLElement>('[data-pricing-restore]');
    if (restore?.dataset.pricingRestore) {
      void restoreVersion(restore.dataset.pricingRestore);
      return;
    }
    const remove = target.closest<HTMLElement>('[data-pricing-delete]');
    if (remove?.dataset.pricingDelete) {
      if (!window.confirm('Delete this draft?')) return;
      void postPricing({ action: 'discard_draft', id: remove.dataset.pricingDelete })
        .then(() => refresh(true))
        .catch((error: unknown) => setNotice(error instanceof Error ? error.message : 'The draft could not be deleted.', 'error'));
    }
  });
}

/** Called by the admin shell when the Pricing & Estimator Control tab opens. */
export async function loadPricingView(): Promise<void> {
  bindActions();
  if (!state.loaded) {
    const target = document.querySelector<HTMLElement>('[data-pricing-editor]');
    if (target) target.innerHTML = '<p class="admin-muted">Loading the pricing catalog…</p>';
  }
  try {
    await refresh();
  } catch (error) {
    setNotice(error instanceof Error ? error.message : 'Pricing could not be loaded.', 'error');
  }
}
