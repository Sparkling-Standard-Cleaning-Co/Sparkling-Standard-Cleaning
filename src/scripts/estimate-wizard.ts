// Estimate wizard — client logic. The estimator engine runs in the browser so
// the instant estimate works on a fully static page and keeps working when the
// travel API is unavailable. Nothing is ever auto-booked.

import { pricing } from '../config/pricing';
import { business, contactPhone, isPending } from '../config/business';
import { calculateEstimate, type EstimateContext } from '../lib/estimate/calculate';
import { SERVICE_SHORT } from '../lib/estimate/labels';
import type { EstimateInput, EstimateInputDraft, EstimateResult, RoutedTravelInfo, ServiceType } from '../lib/estimate/types';
import { submitLead, recordConversion } from '../lib/forms/submit';
import { failureCopy, type FailureReason } from '../lib/forms/failure-copy';
import { track } from '../lib/analytics/events';
import { attributionFields } from '../lib/attribution';

const DRAFT_KEY = 'pcc-estimate-draft';
const TRAVEL_CACHE_PREFIX = 'pcc-travel-';
const CONTACT_FIELD_NAMES = new Set(['name', 'phone', 'email', 'serviceAddress', 'notes']);

const phone = contactPhone();
const contact = {
  phoneDisplay: phone?.display,
  email: isPending(business.email) ? undefined : business.email,
  smsEnabled: business.flags.smsEnabled,
};

const STEP_LABELS = [
  'Your service',
  'Your home',
  'Condition & rhythm',
  'Extras',
  'Timing',
  'Your details',
];

const formHost = document.querySelector<HTMLFormElement>('[data-estimate-form]');
if (formHost) {
  initEstimateWizard(formHost);
}

function initEstimateWizard(form: HTMLFormElement): void {
  const steps = [...form.querySelectorAll<HTMLElement>('.wizard__step')];
  const backButton = form.querySelector<HTMLButtonElement>('[data-back]');
  const nextButton = form.querySelector<HTMLButtonElement>('[data-next]');
  const submitButton = form.querySelector<HTMLButtonElement>('[data-submit]');
  const progressFill = form.querySelector<HTMLElement>('[data-progress-fill]');
  const progressBar = form.querySelector<HTMLElement>('[data-progress-bar]');
  const progressPercent = form.querySelector<HTMLElement>('[data-progress-percent]');
  const stepLabel = form.querySelector<HTMLElement>('[data-step-label]');
  const livePanel = form.querySelector<HTMLElement>('[data-estimate-live]');
  const liveRange = form.querySelector<HTMLElement>('[data-estimate-range]');
  const liveNote = form.querySelector<HTMLElement>('[data-estimate-note]');
  const liveFlags = form.querySelector<HTMLElement>('[data-estimate-flags]');
  const status = form.querySelector<HTMLElement>('[data-form-status]');
  const resetButton = document.querySelector<HTMLButtonElement>('[data-estimate-reset]');
  const preview = import.meta.env.PUBLIC_PREVIEW_MODE === 'true';

  let currentStep = 1;
  let routed: RoutedTravelInfo | undefined;
  let routedZip: string | null = null;
  let latestResult: EstimateResult | null = null;
  let lastTravelLookup = '';
  let estimateStarted = false;
  let estimateCompleted = false;

  // ── State helpers ─────────────────────────────────────────────────────────
  function radioValue(name: string): string | undefined {
    const checked = form.querySelector<HTMLInputElement>(`input[name="${name}"]:checked`);
    return checked?.value;
  }

  function numberValue(name: string): number | undefined {
    const input = form.elements.namedItem(name);
    if (!(input instanceof HTMLInputElement)) return undefined;
    if (input.value.trim() === '') return undefined;
    const value = Number(input.value);
    return Number.isFinite(value) ? value : undefined;
  }

  function textValue(name: string): string | undefined {
    const field = form.elements.namedItem(name);
    if (field instanceof HTMLInputElement || field instanceof HTMLSelectElement || field instanceof HTMLTextAreaElement) {
      return field.value.trim() || undefined;
    }
    return undefined;
  }

  function gatherInput(): EstimateInputDraft {
    const addonIds = [...form.querySelectorAll<HTMLInputElement>('input[name="addons"]:checked')].map(
      (input) => input.value,
    );
    return {
      serviceType: radioValue('serviceType') as ServiceType | undefined,
      propertyType: textValue('propertyType') as EstimateInput['propertyType'],
      squareFeet: numberValue('squareFeet'),
      bedrooms: numberValue('bedrooms'),
      fullBaths: numberValue('fullBaths'),
      halfBaths: numberValue('halfBaths') ?? 0,
      beds: numberValue('beds'),
      frequency: textValue('frequency') as EstimateInput['frequency'],
      condition: radioValue('condition') as EstimateInput['condition'],
      lastClean: textValue('lastClean') as EstimateInput['lastClean'],
      addonIds,
      zip: textValue('zip') ?? '',
      pets: textValue('pets') as EstimateInput['pets'],
    };
  }

  function buildContext(): EstimateContext {
    const routedForZip = routed && routedZip === textValue('zip') ? routed : undefined;
    return {
      travel: {
        ...(routedForZip ? { routed: routedForZip } : {}),
        includedOneWayMiles: pricing.travel.includedOneWayMiles.value,
        mpg: pricing.travel.clientDefaults.mpg.value,
        wearPerMile: pricing.travel.perMileWearCost.value,
        referenceGasPrice: pricing.travel.fallbackGasPrice.value,
        zoneAdjustments: {
          core: pricing.travel.zoneAdjustments.core.value,
          surrounding: pricing.travel.zoneAdjustments.surrounding.value,
        },
        maxInstantDistanceMiles: pricing.travel.clientDefaults.maxInstantDistanceMiles.value,
      },
    };
  }

  // ── Live calculation + rendering ──────────────────────────────────────────
  function recalc(): EstimateResult {
    const result = calculateEstimate(gatherInput(), buildContext());
    latestResult = result;
    renderResult(result);
    return result;
  }

  function renderResult(result: EstimateResult): void {
    if (!livePanel || !liveRange || !liveNote || !liveFlags) return;

    liveFlags.innerHTML = '';

    if (result.status === 'invalid') {
      livePanel.hidden = true;
      return;
    }

    livePanel.hidden = false;

    if (result.status === 'estimated') {
      liveRange.textContent = `$${result.low?.toLocaleString()} – $${result.high?.toLocaleString()}`;
      const confidenceCopy =
        result.confidence === 'high'
          ? 'This range is based on complete details.'
          : result.confidence === 'medium'
            ? 'This range may shift a little after we confirm a few details.'
            : 'This range is early — a few more details will sharpen it.';
      liveNote.textContent = `${confidenceCopy} Final scope and price are confirmed personally before booking.`;

      if (!estimateCompleted) {
        estimateCompleted = true;
        const serviceType = currentServiceType();
        track('estimate_complete', {
          outcome: 'estimated',
          ...(serviceType ? { service_type: serviceType } : {}),
        });
      }
    } else {
      liveRange.textContent = 'Custom confirmation required';
      liveNote.textContent = result.message ?? 'We will confirm this one personally.';
    }

    for (const flag of result.flags) {
      const item = document.createElement('li');
      item.textContent = flag.message;
      liveFlags.appendChild(item);
    }

    if (result.addons.length > 0) {
      const item = document.createElement('li');
      item.textContent = `Extras included in this estimate: ${result.addons.map((addon) => addon.label).join(', ')}`;
      liveFlags.appendChild(item);
    }
  }

  function currentServiceType(): string | undefined {
    return radioValue('serviceType');
  }

  // ── Progress + navigation ─────────────────────────────────────────────────
  function updateChrome(): void {
    const percent = Math.round((currentStep / steps.length) * 100);
    if (progressFill) progressFill.style.width = `${percent}%`;
    if (progressBar) progressBar.setAttribute('aria-valuenow', String(percent));
    if (progressPercent) progressPercent.textContent = `${percent}%`;
    if (stepLabel) {
      stepLabel.textContent = `Step ${currentStep} of ${steps.length} — ${STEP_LABELS[currentStep - 1]}`;
    }
    if (backButton) backButton.hidden = currentStep === 1;
    if (nextButton) nextButton.hidden = currentStep === steps.length;
    if (submitButton) submitButton.hidden = currentStep !== steps.length;
  }

  function showStep(step: number): void {
    currentStep = Math.min(Math.max(step, 1), steps.length);
    for (const [index, element] of steps.entries()) {
      element.dataset.active = String(index + 1 === currentStep);
    }
    updateChrome();
    saveDraft();
    recalc();
  }

  function stepFields(step: number): Array<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement> {
    const section = steps[step - 1];
    if (!section) return [];
    return [
      ...section.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
        'input, select, textarea',
      ),
    ].filter((field) => !field.closest('[hidden]'));
  }

  function validateStep(step: number): boolean {
    let valid = true;
    for (const field of stepFields(step)) {
      if (field instanceof HTMLInputElement && field.type === 'radio') {
        continue; // radio groups validated by the first required member below
      }
      if (!field.checkValidity()) {
        field.reportValidity();
        valid = false;
        break;
      }
    }
    if (valid) {
      const group = steps[step - 1]?.querySelector<HTMLInputElement>('input[type="radio"][required]');
      if (group) {
        const name = group.name;
        const anyChecked = form.querySelector(`input[name="${name}"]:checked`);
        if (!anyChecked) {
          group.reportValidity();
          valid = false;
        }
      }
    }
    return valid;
  }

  // ── STR-specific fields ───────────────────────────────────────────────────
  function syncConditionalFields(): void {
    const isStr = radioValue('serviceType') === 'str_turnover';
    for (const wrapper of form.querySelectorAll<HTMLElement>('[data-str-only]')) {
      wrapper.hidden = !isStr;
    }
    const bedsInput = form.querySelector<HTMLInputElement>('input[name="beds"]');
    if (bedsInput) bedsInput.required = isStr;
  }

  // ── Travel lookup (optional enhancement; zone fallback always works) ──────
  // Every valid ZIP asks the routing function; a real driving duration can
  // qualify a location that the provisional zone list would have sent to
  // manual review. The function answers 503 until configured, and the client
  // silently keeps the zone fallback.
  async function lookupTravel(): Promise<void> {
    const zip = textValue('zip');
    if (!zip || zip.length < 5 || zip === lastTravelLookup) return;
    lastTravelLookup = zip;

    const cacheKey = `${TRAVEL_CACHE_PREFIX}${zip}`;
    try {
      const cached = window.sessionStorage.getItem(cacheKey);
      if (cached) {
        routed = JSON.parse(cached) as RoutedTravelInfo;
        routedZip = zip;
        recalc();
        return;
      }
    } catch {
      // Cache is best-effort.
    }

    try {
      const response = await fetch('/api/travel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ zip }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = (await response.json()) as RoutedTravelInfo;
      if (typeof data.oneWayMiles === 'number' && data.oneWayMiles > 0) {
        routed = data;
        routedZip = zip;
        try {
          window.sessionStorage.setItem(cacheKey, JSON.stringify(data));
        } catch {
          // ignore
        }
      }
    } catch {
      routed = undefined;
      routedZip = null;
    }
    recalc();
  }

  // ── Draft persistence (never stores contact details) ──────────────────────
  function saveDraft(): void {
    try {
      const draft: Record<string, unknown> = { step: currentStep, fields: {}, checked: {} };
      const fields = draft.fields as Record<string, string>;
      const checked = draft.checked as Record<string, string[]>;
      for (const field of form.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
        'input[name], select[name], textarea[name]',
      )) {
        if (field instanceof HTMLInputElement && field.type === 'file') continue;
        if (CONTACT_FIELD_NAMES.has(field.name)) continue;
        if (field instanceof HTMLInputElement && field.type === 'checkbox') {
          if (field.checked) (checked[field.name] ??= []).push(field.value);
          continue;
        }
        if (field instanceof HTMLInputElement && field.type === 'radio') {
          if (field.checked) fields[field.name] = field.value;
          continue;
        }
        fields[field.name] = field.value;
      }
      window.localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    } catch {
      // Storage failure never blocks the estimate.
    }
  }

  function restoreDraft(): void {
    try {
      const raw = window.localStorage.getItem(DRAFT_KEY);
      if (!raw) return;
      const draft = JSON.parse(raw) as { step?: number; fields?: Record<string, string>; checked?: Record<string, string[]> };
      for (const [name, value] of Object.entries(draft.fields ?? {})) {
        const field = form.elements.namedItem(name);
        if (field instanceof RadioNodeList) {
          const target = [...field].find((element) => element instanceof HTMLInputElement && element.value === value);
          if (target instanceof HTMLInputElement) target.checked = true;
        } else if (field instanceof HTMLInputElement || field instanceof HTMLSelectElement || field instanceof HTMLTextAreaElement) {
          field.value = value;
        }
      }
      for (const [name, values] of Object.entries(draft.checked ?? {})) {
        for (const value of values) {
          const target = [...form.querySelectorAll<HTMLInputElement>(`input[name="${name}"]`)].find(
            (input) => input.value === value,
          );
          if (target) target.checked = true;
        }
      }
      if (draft.step && draft.step > 1) currentStep = Math.min(draft.step, steps.length);
    } catch {
      // Corrupted draft: start fresh.
    }
  }

  function clearDraft(): void {
    try {
      window.localStorage.removeItem(DRAFT_KEY);
    } catch {
      // ignore
    }
  }

  // ── Submission ────────────────────────────────────────────────────────────
  function buildSubmissionFields(result: EstimateResult): Record<string, string> {
    const input = gatherInput();
    const fields: Record<string, string> = {
      request_type: 'residential_estimate',
      estimate_status: result.status,
      service_type: input.serviceType ?? '',
      property_type: input.propertyType ?? '',
      zip: input.zip ?? '',
      square_feet: input.squareFeet !== undefined ? String(input.squareFeet) : '',
      bedrooms: input.bedrooms !== undefined ? String(input.bedrooms) : '',
      full_baths: input.fullBaths !== undefined ? String(input.fullBaths) : '',
      half_baths: input.halfBaths !== undefined ? String(input.halfBaths) : '',
      frequency: input.frequency ?? '',
      condition: input.condition ?? '',
      last_cleaned: input.lastClean ?? '',
      pets: input.pets ?? '',
      addons: result.addons.map((addon) => addon.label).join(', '),
      estimate_low: result.low !== null ? String(result.low) : 'custom',
      estimate_high: result.high !== null ? String(result.high) : 'custom',
      estimate_confidence: result.confidence,
      travel_mode: result.travel.mode,
      travel_zone: result.travel.zone,
      preferred_date: textValue('preferredDate') ?? '',
      arrival_preference: textValue('arrivalPreference') ?? '',
      service_address: textValue('serviceAddress') ?? '',
      notes: textValue('notes') ?? '',
      name: textValue('name') ?? '',
      phone: textValue('phone') ?? '',
      email: textValue('email') ?? '',
    };
    return { ...fields, ...attributionFields() };
  }

  async function handleSubmit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (!validateStep(currentStep)) return;

    const honeypot = form.querySelector<HTMLInputElement>('input[name="company_website"]');
    if (honeypot && honeypot.value.trim() !== '') {
      if (status) {
        status.dataset.state = 'error';
        status.textContent = failureCopy('spam_rejected', contact);
      }
      return;
    }

    const result = recalc();
    if (result.status === 'invalid') {
      if (status) {
        status.dataset.state = 'error';
        status.textContent = result.issues?.[0] ?? 'Please complete the estimate before sending.';
      }
      return;
    }

    if (submitButton) submitButton.disabled = true;
    if (status) {
      status.dataset.state = 'info';
      status.textContent = 'Sending your request…';
    }

    const fields = buildSubmissionFields(result);
    const subject = `Cleaning request — ${SERVICE_SHORT[fields.service_type as ServiceType] ?? 'estimate'} — ${fields.zip}`;
    const outcome = await submitLead(fields, subject);

    if (!outcome.ok) {
      if (submitButton) submitButton.disabled = false;
      if (status) {
        status.dataset.state = 'error';
        status.textContent = `${failureCopy(outcome.reason as FailureReason, contact)} Your answers are still saved in this browser.`;
      }
      return;
    }

    clearDraft();
    const payload = { service_type: fields.service_type, journey: 'residential' as const };
    recordConversion('cleaning_request_submit', payload);
    if (fields.preferred_date) {
      recordConversion('booking_request', { service_type: fields.service_type });
    }
    if (status) {
      status.dataset.state = 'success';
      status.textContent =
        'Request received — not booked yet. The owner will confirm scope, date and final price with you.';
    }
    window.setTimeout(() => {
      window.location.assign('/thank-you/');
    }, 900);
  }

  // ── Wiring ────────────────────────────────────────────────────────────────
  nextButton?.addEventListener('click', () => {
    if (!validateStep(currentStep)) return;
    const serviceType = currentServiceType();
    track('estimate_step', {
      step: currentStep,
      ...(serviceType ? { service_type: serviceType } : {}),
    });
    showStep(currentStep + 1);
  });

  backButton?.addEventListener('click', () => {
    showStep(currentStep - 1);
  });

  form.addEventListener('input', () => {
    if (!estimateStarted) {
      estimateStarted = true;
      const serviceType = currentServiceType();
      track('estimate_start', serviceType ? { service_type: serviceType } : {});
    }
    syncConditionalFields();
    saveDraft();
    recalc();
  });

  form.addEventListener('change', (event) => {
    syncConditionalFields();
    saveDraft();
    recalc();
    const target = event.target as HTMLElement | null;
    if (target instanceof HTMLInputElement && target.name === 'zip') {
      void lookupTravel();
    }
  });

  form.addEventListener('submit', (event) => {
    void handleSubmit(event);
  });

  resetButton?.addEventListener('click', () => {
    clearDraft();
    form.reset();
    showStep(1);
    if (status) status.textContent = '';
    if (livePanel) livePanel.hidden = true;
  });

  restoreDraft();
  syncConditionalFields();
  showStep(currentStep);

  // Debug handle — preview builds only. Never rendered publicly.
  if (preview) {
    (window as unknown as Record<string, unknown>).pccEstimateDebug = () => latestResult;
  }
}
