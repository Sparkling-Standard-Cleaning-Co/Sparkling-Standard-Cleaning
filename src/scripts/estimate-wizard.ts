// Estimate wizard — client logic. The estimator engine runs in the browser so
// the instant estimate works on a fully static page and keeps working when the
// travel API is unavailable. Nothing is ever auto-booked.
//
// Journey: cleaning type → confirmed street address (map pin) → home facts →
// condition → extras → timing → proposed price + reservation request.
//
// Safety rules:
//  - A confirmed street address and its coordinates are the ONLY destination
//    source; a ZIP centroid never silently replaces a confirmed pin.
//  - Prices shown here are proposals. The server recalculates every reservation
//    (functions/api/lead.ts + src/lib/estimate/verify.ts); the browser price is
//    never trusted for acceptance.
//  - Nothing analytics-related ever receives the address, ZIP, coordinates,
//    price or form contents.

import { pricing } from '../config/pricing';
import { business, contactPhone, isPending } from '../config/business';
import { calculateEstimate, type EstimateContext } from '../lib/estimate/calculate';
import { buildInstantQuote, type InstantQuote } from '../lib/estimate/quote';
import { SERVICE_LABELS, SERVICE_SHORT, FREQUENCY_LABELS } from '../lib/estimate/labels';
import type { EstimateInput, EstimateInputDraft, EstimateResult, RoutedTravelInfo, ServiceType } from '../lib/estimate/types';
import { locationKey, formatLocationLine, type ConfirmedLocation } from '../lib/location/location';
import { initAddressFinder, type AddressFinderHandle } from './address-finder';
import { submitLead, recordConversion } from '../lib/forms/submit';
import { reservationReceipt } from '../lib/forms/verification-copy';
import { failureCopy, type FailureReason } from '../lib/forms/failure-copy';
import { track } from '../lib/analytics/events';
import { attributionFields } from '../lib/attribution';

const DRAFT_KEY = 'pcc-estimate-draft';
const TRAVEL_CACHE_PREFIX = 'pcc-travel-';
const CONTACT_FIELD_NAMES = new Set(['name', 'phone', 'email', 'serviceAddress', 'notes', 'addressUnit']);

const phone = contactPhone();
const contact = {
  phoneDisplay: phone?.display,
  email: isPending(business.email) ? undefined : business.email,
  smsEnabled: business.flags.smsEnabled,
};

const STEP_LABELS = [
  'Your service',
  'Service address',
  'Your home',
  'Condition & rhythm',
  'Extras',
  'Timing',
  'Price & reservation',
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
  const livePrice = form.querySelector<HTMLElement>('[data-estimate-price]');
  const liveRange = form.querySelector<HTMLElement>('[data-estimate-range]');
  const liveNote = form.querySelector<HTMLElement>('[data-estimate-note]');
  const liveTravel = form.querySelector<HTMLElement>('[data-estimate-travel]');
  const liveReference = form.querySelector<HTMLElement>('[data-estimate-reference]');
  const liveFlags = form.querySelector<HTMLElement>('[data-estimate-flags]');
  const status = form.querySelector<HTMLElement>('[data-form-status]');
  const resetButton = document.querySelector<HTMLButtonElement>('[data-estimate-reset]');
  const reservationSummary = form.querySelector<HTMLElement>('[data-reservation-summary]');
  const reservationPrice = form.querySelector<HTMLElement>('[data-reservation-price]');
  const reservationReference = form.querySelector<HTMLElement>('[data-reservation-reference]');
  const reservationValidity = form.querySelector<HTMLElement>('[data-reservation-validity]');
  const reservationScope = form.querySelector<HTMLElement>('[data-reservation-scope]');
  const reservationQualification = form.querySelector<HTMLElement>('[data-reservation-qualification]');
  const reserveCall = document.querySelector<HTMLAnchorElement>('[data-reserve-call]');
  const reserveText = document.querySelector<HTMLAnchorElement>('[data-reserve-text]');
  const preview = import.meta.env.PUBLIC_PREVIEW_MODE === 'true';

  let currentStep = 1;
  let location: ConfirmedLocation | null = null;
  let routed: RoutedTravelInfo | undefined;
  let routedKey: string | null = null;
  let latestResult: EstimateResult | null = null;
  let latestQuote: InstantQuote | null = null;
  let lastTravelKey = '';
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

  function currentTravelKey(): string {
    const zip = textValue('zip') ?? '';
    if (location) return `${zip}|${locationKey(location.lat, location.lng)}`;
    return zip.length >= 5 ? `zip:${zip}` : '';
  }

  function buildContext(): EstimateContext {
    const key = currentTravelKey();
    const routedForDestination = routed && routedKey === key ? routed : undefined;
    return {
      travel: {
        ...(routedForDestination ? { routed: routedForDestination } : {}),
        includedOneWayMiles: pricing.travel.includedOneWayMiles.value,
        mpg: pricing.travel.clientDefaults.mpg.value,
        wearPerMile: pricing.travel.perMileWearCost.value,
        referenceGasPrice: pricing.travel.fallbackGasPrice.value,
        zoneAdjustments: {
          core: pricing.travel.zoneAdjustments.core.value,
          surrounding: pricing.travel.zoneAdjustments.surrounding.value,
        },
        maxInstantDistanceMiles: pricing.travel.clientDefaults.maxInstantDistanceMiles.value,
        maxDrivingMinutes: pricing.drivingPolicy.maxDrivingMinutes.value,
        reviewBandMinutes: pricing.drivingPolicy.reviewBandMinutes.value,
      },
    };
  }

  // ── Live calculation + rendering ──────────────────────────────────────────
  function recalc(): EstimateResult {
    const input = gatherInput();
    const result = calculateEstimate(input, buildContext());
    latestResult = result;
    latestQuote =
      result.status === 'estimated' && pricing.instantQuote.enabled.value
        ? buildInstantQuote(result, {
            serviceType: input.serviceType ?? 'standard',
            zip: input.zip ?? '',
          })
        : null;
    renderResult(result);
    renderReservationSummary(result);
    return result;
  }

  function travelCopy(result: EstimateResult): string {
    const travel = result.travel;
    if (travel.mode === 'routed' && travel.verified) {
      const minutes = travel.durationMinutes !== null ? `${Math.round(travel.durationMinutes)} min` : null;
      const miles = travel.oneWayMiles !== null ? `${Math.round(travel.oneWayMiles * 10) / 10} mi` : null;
      const detail = [miles, minutes].filter(Boolean).join(' / ');
      return `Travel verified: ${detail} of driving from our base, included in this price.`;
    }
    if (travel.mode === 'routed') {
      return `Travel preliminary: about ${travel.oneWayMiles !== null ? `${Math.round(travel.oneWayMiles)} mi` : 'your area'} by road-distance estimate — confirmed before booking.`;
    }
    if (travel.mode === 'zone' && (travel.zone === 'core' || travel.zone === 'surrounding')) {
      return 'Travel preliminary: based on your ZIP area. Confirm your street address above for a precise route before booking.';
    }
    return travel.reason ?? 'Travel will be confirmed personally with you.';
  }

  function renderResult(result: EstimateResult): void {
    if (!livePanel || !livePrice || !liveNote || !liveFlags) return;

    liveFlags.innerHTML = '';

    if (result.status === 'invalid') {
      livePanel.hidden = true;
      return;
    }

    // On the final step the reservation summary takes over for estimable jobs;
    // for custom-confirmation jobs the live panel stays to explain why.
    const summaryTakesOver = currentStep === steps.length && result.status === 'estimated' && latestQuote !== null;
    livePanel.hidden = summaryTakesOver;

    if (result.status === 'estimated') {
      const amount = latestQuote ? `$${latestQuote.amount.toLocaleString()}` : '—';
      livePrice.textContent = amount;
      const confidenceCopy =
        result.confidence === 'high'
          ? 'Based on your confirmed address and complete details.'
          : result.confidence === 'medium'
            ? 'May shift slightly after we confirm a few details.'
            : 'Early — a few more details will sharpen it.';
      liveNote.textContent = `${confidenceCopy} This is a proposed price on a request, not a confirmed booking — the owner verifies scope and price before anything is scheduled.`;

      if (liveRange) {
        liveRange.hidden = false;
        liveRange.textContent =
          result.low !== null && result.high !== null
            ? `Typical range for this scope: $${result.low.toLocaleString()} – $${result.high.toLocaleString()}`
            : '';
      }
      if (liveReference && latestQuote) {
        liveReference.hidden = false;
        liveReference.textContent = `Estimate reference ${latestQuote.reference} — proposed price, subject to owner confirmation.`;
      } else if (liveReference) {
        liveReference.hidden = true;
      }

      if (!estimateCompleted) {
        estimateCompleted = true;
        const serviceType = currentServiceType();
        track('estimate_complete', {
          outcome: 'estimated',
          ...(serviceType ? { service_type: serviceType } : {}),
        });
      }
    } else {
      livePrice.textContent = 'Custom confirmation required';
      if (liveRange) {
        liveRange.hidden = true;
        liveRange.textContent = '';
      }
      if (liveReference) {
        liveReference.hidden = true;
        liveReference.textContent = '';
      }
      liveNote.textContent = result.message ?? 'We will confirm this one personally.';
    }

    if (liveTravel) liveTravel.textContent = travelCopy(result);

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

  // ── Reservation summary (order-style, carries every calculator answer) ────
  function addSummaryRow(label: string, value: string): void {
    if (!reservationScope || !value) return;
    const item = document.createElement('li');
    const term = document.createElement('span');
    term.textContent = label;
    const detail = document.createElement('strong');
    detail.textContent = value;
    item.append(term, detail);
    reservationScope.appendChild(item);
  }

  function renderReservationSummary(result: EstimateResult): void {
    if (!reservationSummary) return;
    const hasQuote = result.status === 'estimated' && latestQuote !== null;
    reservationSummary.hidden = !hasQuote;
    if (submitButton) {
      submitButton.textContent = hasQuote ? 'Reserve This Cleaning' : 'Send My Request';
    }
    if (!hasQuote || !latestQuote) {
      if (reserveCall) reserveCall.hidden = !phone;
      if (reserveText) reserveText.hidden = !phone || !business.flags.smsEnabled;
      return;
    }

    const input = gatherInput();
    if (reservationPrice) reservationPrice.textContent = `$${latestQuote.amount.toLocaleString()}`;
    if (reservationReference) {
      reservationReference.hidden = false;
      reservationReference.textContent = `Estimate reference ${latestQuote.reference}`;
    }
    if (reservationValidity) {
      reservationValidity.hidden = false;
      reservationValidity.textContent =
        'Proposed price — not a held reservation or a binding offer. The owner confirms the final price before booking.';
    }
    if (reservationQualification) {
      reservationQualification.textContent = latestQuote.travelVerified
        ? 'Travel-inclusive price — your route was calculated from our operating base to your confirmed destination.'
        : 'Preliminary price — travel is based on your area and will be verified from your confirmed address before booking.';
    }

    if (reservationScope) {
      reservationScope.innerHTML = '';
      addSummaryRow(
        'Cleaning',
        input.serviceType ? SERVICE_LABELS[input.serviceType as ServiceType] : '',
      );
      addSummaryRow('Frequency', input.frequency ? FREQUENCY_LABELS[input.frequency as keyof typeof FREQUENCY_LABELS] : '');
      const homeParts = [
        input.propertyType ? input.propertyType.charAt(0).toUpperCase() + input.propertyType.slice(1) : '',
        input.squareFeet ? `${input.squareFeet.toLocaleString()} sqft` : '',
        input.bedrooms !== undefined ? `${input.bedrooms} bed` : '',
        input.fullBaths !== undefined
          ? `${input.fullBaths} full bath${input.fullBaths === 1 ? '' : 's'}${input.halfBaths ? ` + ${input.halfBaths} half` : ''}`
          : '',
      ].filter(Boolean);
      addSummaryRow('Home', homeParts.join(' · '));
      addSummaryRow('Condition', input.condition ? input.condition.replaceAll('_', ' ') : '');
      addSummaryRow('Last professional clean', input.lastClean ? input.lastClean.replaceAll('_', ' ') : '');
      addSummaryRow('Pets', input.pets ? input.pets.replaceAll('_', ' ') : '');
      addSummaryRow(
        'Extras',
        result.addons.length > 0 ? result.addons.map((addon) => addon.label).join(', ') : 'None',
      );
      addSummaryRow('Destination', location ? formatLocationLine(location) : `ZIP ${input.zip ?? ''}`);
      addSummaryRow(
        'Travel',
        latestQuote.travelVerified
          ? `Verified route${result.travel.oneWayMiles !== null ? ` — ${Math.round(result.travel.oneWayMiles)} mi one way` : ''}`
          : 'Preliminary — verified before booking',
      );
      addSummaryRow('Preferred date', textValue('preferredDate') ?? '');
      addSummaryRow('Arrival', textValue('arrivalPreference')?.replaceAll('-', ' ') ?? '');
    }

    // Call / text actions carry the quote context the customer is looking at.
    if (reserveCall) {
      reserveCall.hidden = !phone;
      if (phone) reserveCall.href = phone.href;
    }
    if (reserveText) {
      reserveText.hidden = !phone || !business.flags.smsEnabled;
      if (phone) {
        const body = `Hi! I'd like to reserve a cleaning. My estimate reference is ${latestQuote.reference} with a proposed price of $${latestQuote.amount}${location ? ` at ${formatLocationLine(location)}` : ''}. The owner will confirm the final price.`;
        reserveText.href = `${phone.sms}?&body=${encodeURIComponent(body)}`;
      }
    }
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
    if (submitButton) {
      submitButton.hidden = currentStep !== steps.length;
      if (currentStep === steps.length) {
        submitButton.textContent = latestQuote ? 'Reserve This Cleaning' : 'Send My Request';
      }
    }
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

  // ── Travel lookup ─────────────────────────────────────────────────────────
  // A confirmed address sends its coordinates; a ZIP-only entry uses the
  // preliminary ZIP-centroid route. A real routed duration can qualify a
  // location the provisional zone list would have sent to manual review.
  function travelCacheKey(key: string): string {
    return `${TRAVEL_CACHE_PREFIX}${key}`;
  }

  let travelLookupSeq = 0;

  async function lookupTravel(): Promise<void> {
    const key = currentTravelKey();
    if (!key || key === lastTravelKey) return;
    lastTravelKey = key;
    const seq = ++travelLookupSeq;

    const applyIfCurrent = (data: RoutedTravelInfo | undefined): void => {
      // A newer lookup (e.g. the confirmed pin superseding the ZIP lookup)
      // must win even if this response arrives later.
      if (seq !== travelLookupSeq) return;
      routed = data;
      routedKey = data ? key : null;
      recalc();
    };

    try {
      const cached = window.sessionStorage.getItem(travelCacheKey(key));
      if (cached) {
        applyIfCurrent(JSON.parse(cached) as RoutedTravelInfo);
        return;
      }
    } catch {
      // Cache is best-effort.
    }

    const zip = textValue('zip');
    const confirmed = location;
    try {
      const response = await fetch('/api/travel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          ...(zip ? { zip } : {}),
          ...(confirmed ? { lat: confirmed.lat, lng: confirmed.lng } : {}),
        }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = (await response.json()) as RoutedTravelInfo;
      if (typeof data.oneWayMiles === 'number' && data.oneWayMiles > 0) {
        applyIfCurrent(data);
        try {
          window.sessionStorage.setItem(travelCacheKey(key), JSON.stringify(data));
        } catch {
          // ignore
        }
      } else {
        applyIfCurrent(undefined);
      }
    } catch {
      applyIfCurrent(undefined);
    }
  }

  // ── Address finder wiring ─────────────────────────────────────────────────
  const addressFinder: AddressFinderHandle | null = initAddressFinder({
    form,
    onChange: (next) => {
      // Editing the address invalidates any previous route instantly, so a
      // stale ZIP/centroid route can never price a different destination.
      routed = undefined;
      routedKey = null;
      lastTravelKey = '';
      const previousKey = location ? locationKey(location.lat, location.lng) : null;
      location = next;
      const nextKey = next ? locationKey(next.lat, next.lng) : null;
      if (previousKey !== nextKey) {
        saveDraft();
        recalc();
        void lookupTravel();
      } else {
        saveDraft();
        recalc();
      }
    },
  });

  // ── Draft persistence (never stores contact details or the address) ───────
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
    const isReservation = result.status === 'estimated' && latestQuote !== null;
    const fields: Record<string, string> = {
      request_type: isReservation ? 'reservation_request' : 'residential_estimate',
      estimate_status: result.status,
      service_type: input.serviceType ?? '',
      property_type: input.propertyType ?? '',
      zip: input.zip ?? '',
      square_feet: input.squareFeet !== undefined ? String(input.squareFeet) : '',
      bedrooms: input.bedrooms !== undefined ? String(input.bedrooms) : '',
      full_baths: input.fullBaths !== undefined ? String(input.fullBaths) : '',
      half_baths: input.halfBaths !== undefined ? String(input.halfBaths) : '',
      beds: input.beds !== undefined ? String(input.beds) : '',
      frequency: input.frequency ?? '',
      condition: input.condition ?? '',
      last_cleaned: input.lastClean ?? '',
      pets: input.pets ?? '',
      addons: result.addons.map((addon) => addon.label).join(', '),
      addon_ids: (input.addonIds ?? []).join(','),
      estimate_low: result.low !== null ? String(result.low) : 'custom',
      estimate_high: result.high !== null ? String(result.high) : 'custom',
      estimate_confidence: result.confidence,
      travel_mode: result.travel.mode,
      travel_zone: result.travel.zone,
      travel_verified: String(result.travel.verified),
      travel_qualification: result.travel.verified
        ? 'verified_route'
        : result.travel.mode === 'routed'
          ? 'preliminary_route'
          : result.travel.mode === 'zone'
            ? 'preliminary_zone'
            : 'manual_review',
      service_address: location?.street ?? textValue('serviceAddress') ?? '',
      address_unit: location?.unit ?? textValue('addressUnit') ?? '',
      address_confirmed: location ? 'yes' : 'no',
      ...(location
        ? {
            pin_latitude: location.lat.toFixed(6),
            pin_longitude: location.lng.toFixed(6),
            pin_source: location.source,
            pin_adjusted: location.adjusted ? 'yes' : 'no',
          }
        : {}),
      preferred_date: textValue('preferredDate') ?? '',
      arrival_preference: textValue('arrivalPreference') ?? '',
      notes: textValue('notes') ?? '',
      name: textValue('name') ?? '',
      phone: textValue('phone') ?? '',
      email: textValue('email') ?? '',
    };
    if (isReservation && latestQuote) {
      fields.quoted_price = String(latestQuote.amount);
      fields.quote_reference = latestQuote.reference;
      fields.quote_config_version = latestQuote.configVersion;
      fields.quoted_range =
        result.low !== null && result.high !== null ? `$${result.low}–$${result.high}` : '';
    }
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
      status.textContent =
        result.status === 'estimated' && latestQuote
          ? 'Sending your reservation request…'
          : 'Sending your request…';
    }

    const fields = buildSubmissionFields(result);
    const isReservation = fields.request_type === 'reservation_request';
    const priceLabel = fields.quoted_price ? ` — $${fields.quoted_price}` : '';
    const subject = isReservation
      ? `Reservation request — ${SERVICE_SHORT[fields.service_type as ServiceType] ?? 'cleaning'}${priceLabel} — ${fields.zip}`
      : `Cleaning request — ${SERVICE_SHORT[fields.service_type as ServiceType] ?? 'estimate'} — ${fields.zip}`;
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

    // The receipt reflects the server's actual verdict. A mismatch or
    // preliminary travel result is never presented as an accepted price.
    const receipt = isReservation
      ? reservationReceipt(outcome.verification, outcome.via)
      : {
          state: 'success' as const,
          message:
            'Request received — not booked yet. The owner will confirm scope, date and final price with you before anything is scheduled.',
        };
    if (status) {
      status.dataset.state = receipt.state;
      status.textContent = receipt.message;
    }
    // Only a verified/success receipt navigates away; an unverified receipt
    // stays on screen so the customer actually reads the uncertainty.
    if (receipt.state === 'success') {
      window.setTimeout(() => {
        window.location.assign('/thank-you/');
      }, 900);
    }
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
    addressFinder?.reset();
    location = null;
    routed = undefined;
    routedKey = null;
    lastTravelKey = '';
    latestQuote = null;
    showStep(1);
    if (status) status.textContent = '';
    if (livePanel) livePanel.hidden = true;
  });

  restoreDraft();
  syncConditionalFields();
  showStep(currentStep);
  void lookupTravel();

  // Debug handle — preview builds only. Never rendered publicly.
  if (preview) {
    (window as unknown as Record<string, unknown>).pccEstimateDebug = () => ({
      result: latestResult,
      quote: latestQuote,
      location,
    });
  }
}
