// Estimate wizard — client logic. The estimator engine runs in the browser so
// the instant estimate works on a fully static page and keeps working when the
// travel API is unavailable. Nothing is ever auto-booked.
//
// Journey: service & address → home → condition & frequency → extras →
// scheduling → proposed price + reservation request.
//
// Behavior rules:
//  - Every page visit starts a FRESH blank estimate at step 1. Nothing is
//    restored from localStorage; there is no automatic draft recovery.
//  - A confirmed street address and its coordinates are the ONLY destination
//    source; a ZIP centroid never silently replaces a confirmed pin.
//  - Prices shown here are proposals built by the ONE authoritative model
//    (labor-hours × approved rate, with the add-on display and discount coming
//    from the same breakdown). The server recalculates every reservation; the
//    browser price is never trusted for acceptance.
//  - Nothing analytics-related ever receives the address, ZIP, coordinates,
//    price or form contents.

import { pricing } from '../config/pricing';
import { business, contactPhone, isPending } from '../config/business';
import { calculateEstimate, type EstimateContext } from '../lib/estimate/calculate';
import { buildInstantQuote, type InstantQuote } from '../lib/estimate/quote';
import { ESTIMATE_STEPS } from '../lib/estimate/steps';
import { SERVICE_LABELS, SERVICE_SHORT, FREQUENCY_LABELS } from '../lib/estimate/labels';
import type { EstimateInput, EstimateInputDraft, EstimateResult, RoutedTravelInfo, ServiceType } from '../lib/estimate/types';
import { locationKey, formatLocationLine, type ConfirmedLocation } from '../lib/location/location';
import { initAddressFinder, type AddressFinderHandle } from './address-finder';
import { submitLead, recordConversion } from '../lib/forms/submit';
import { reservationReceipt } from '../lib/forms/verification-copy';
import { failureCopy, type FailureReason } from '../lib/forms/failure-copy';
import { track } from '../lib/analytics/events';
import { attributionFields } from '../lib/attribution';

const TRAVEL_CACHE_PREFIX = 'pcc-travel-';

const phone = contactPhone();
const contact = {
  phoneDisplay: phone?.display,
  email: isPending(business.email) ? undefined : business.email,
  smsEnabled: business.flags.smsEnabled,
};

const STEP_LABELS = ESTIMATE_STEPS.map((step) => step.title);

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
  const mobileStepTitle = form.querySelector<HTMLElement>('[data-mobile-step-title]');
  const stepItems = [...form.querySelectorAll<HTMLElement>('[data-step-item]')];
  const stepJumps = [...form.querySelectorAll<HTMLButtonElement>('[data-step-jump]')];
  const livePanel = form.querySelector<HTMLElement>('[data-estimate-live]');
  const liveLabel = form.querySelector<HTMLElement>('[data-estimate-label]');
  const livePrice = form.querySelector<HTMLElement>('[data-estimate-price]');
  const liveRange = form.querySelector<HTMLElement>('[data-estimate-range]');
  const liveNote = form.querySelector<HTMLElement>('[data-estimate-note]');
  const liveTravel = form.querySelector<HTMLElement>('[data-estimate-travel]');
  const liveReference = form.querySelector<HTMLElement>('[data-estimate-reference]');
  const liveFlags = form.querySelector<HTMLElement>('[data-estimate-flags]');
  const status = form.querySelector<HTMLElement>('[data-form-status]');
  const resetButton = document.querySelector<HTMLButtonElement>('[data-estimate-reset]');
  const reservationSummary = form.querySelector<HTMLElement>('[data-reservation-summary]');
  const reservationEyebrow = form.querySelector<HTMLElement>('[data-reservation-eyebrow]');
  const reservationPrice = form.querySelector<HTMLElement>('[data-reservation-price]');
  const reservationReference = form.querySelector<HTMLElement>('[data-reservation-reference]');
  const reservationValidity = form.querySelector<HTMLElement>('[data-reservation-validity]');
  const reservationScope = form.querySelector<HTMLElement>('[data-reservation-scope]');
  const reservationQualification = form.querySelector<HTMLElement>('[data-reservation-qualification]');
  const priceBreakdown = form.querySelector<HTMLElement>('[data-price-breakdown]');
  const pricePreview = form.querySelector<HTMLElement>('[data-price-preview]');
  const pricePreviewLines = form.querySelector<HTMLElement>('[data-price-preview-lines]');
  const pricePreviewNote = form.querySelector<HTMLElement>('[data-price-preview-note]');
  const addonIncentiveEl = form.querySelector<HTMLElement>('[data-addon-incentive]');
  const addonIncentiveText = form.querySelector<HTMLElement>('[data-addon-incentive-text]');
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

  function submissionAddress(): { zip: string; method: 'manual' | 'gps'; street: string; unit: string; city: string; state: string; location: ConfirmedLocation | null } {
    const fromFinder = addressFinder?.getSubmission();
    return {
      method: fromFinder?.method ?? 'manual',
      location: fromFinder?.location ?? null,
      street: fromFinder?.street ?? textValue('serviceAddress') ?? '',
      unit: fromFinder?.unit ?? textValue('addressUnit') ?? '',
      city: fromFinder?.city ?? textValue('addressCity') ?? '',
      state: fromFinder?.state ?? textValue('addressState') ?? 'FL',
      zip: fromFinder?.zip ?? textValue('zip') ?? '',
    };
  }

  function gatherInput(): EstimateInputDraft {
    const addonIds = [...form.querySelectorAll<HTMLInputElement>('input[name="addons"]:checked')].map(
      (input) => input.value,
    );
    const submission = submissionAddress();
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
      zip: submission.zip,
      ...(submission.location ? { destinationConfirmed: true } : {}),
      pets: textValue('pets') as EstimateInput['pets'],
    };
  }

  function currentTravelKey(): string {
    const { zip, location: confirmed } = submissionAddress();
    if (confirmed) return `${zip}|${locationKey(confirmed.lat, confirmed.lng)}`;
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
  const RECURRING_FREQUENCIES = new Set(['weekly', 'biweekly', 'monthly']);

  /**
   * Recurring customers are quoted per visit; labeling every price "cleaning
   * price" hides the value story that drives the recurring business.
   */
  function syncPriceLabels(): void {
    const recurring = RECURRING_FREQUENCIES.has(textValue('frequency') ?? '');
    const label = recurring ? 'Your proposed price per visit' : 'Your proposed cleaning price';
    if (liveLabel) liveLabel.textContent = label;
    if (reservationEyebrow) reservationEyebrow.textContent = label;
  }

  function recalc(): EstimateResult {
    const input = gatherInput();
    syncPriceLabels();
    const result = calculateEstimate(input, buildContext());
    latestResult = result;
    latestQuote =
      result.status === 'estimated' && pricing.instantQuote.enabled.value
        ? buildInstantQuote(result, {
            serviceType: input.serviceType ?? 'standard',
            zip: input.zip ?? '',
            // Travel is only ever presented as verified for a customer-
            // confirmed destination, never a ZIP centroid.
            destinationConfirmed: location !== null,
          })
        : null;
    renderResult(result);
    renderAddonPrices(result);
    renderIncentive(result);
    renderPricePreview(result);
    renderReservationSummary(result);
    return result;
  }

  function travelCopy(result: EstimateResult): string {
    const travel = result.travel;
    const submission = submissionAddress();
    // Routing is only presented as distance-based certainty when the customer
    // confirmed a street address. A GPS pin, a street-level pin or a ZIP keeps
    // the preliminary wording: they are locations, not verified postal
    // addresses.
    const streetConfirmed =
      submission.location !== null &&
      submission.street.trim().length >= 5 &&
      submission.location.precision !== 'street';
    if (travel.mode === 'routed' && travel.verified && streetConfirmed) {
      const miles =
        travel.oneWayMiles !== null ? ` (about ${Math.round(travel.oneWayMiles)} miles one way)` : '';
      return `Your proposed price includes travel based on the driving distance to your selected location${miles}.`;
    }
    if (travel.mode === 'routed' || travel.mode === 'zone') {
      return 'Your proposed price includes estimated travel. Sparkling Standard will confirm your location and final price before booking.';
    }
    return 'Travel will be confirmed by Sparkling Standard before your appointment is booked.';
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
    const summaryTakesOver =
      currentStep === steps.length && result.status === 'estimated' && latestQuote !== null;
    livePanel.hidden = summaryTakesOver;

    if (result.status === 'estimated') {
      const amount = latestQuote ? `$${latestQuote.amount.toLocaleString()}` : '—';
      livePrice.textContent = amount;
      const confidenceCopy =
        submissionAddress().location?.precision === 'street'
          ? 'Based on the street-level pin you placed — we will verify the exact property with you.'
          : result.confidence === 'high'
            ? 'Based on your confirmed address and complete details.'
            : result.confidence === 'medium'
              ? 'May shift slightly after we confirm a few details.'
              : 'Early — a few more details will sharpen it.';
      liveNote.textContent = `${confidenceCopy} This is a proposed price on a request, not a confirmed booking — Sparkling Standard confirms the final scope and price with you first.`;

      if (liveRange) {
        liveRange.hidden = false;
        liveRange.textContent =
          result.low !== null && result.high !== null
            ? `Typical range for this scope: $${result.low.toLocaleString()} – $${result.high.toLocaleString()}`
            : '';
      }
      if (liveReference && latestQuote) {
        liveReference.hidden = false;
        liveReference.textContent = `Estimate reference ${latestQuote.reference} — proposed price, subject to confirmation.`;
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

  // ── Transparent add-on prices (from the SAME breakdown as the total) ──────
  function renderAddonPrices(result: EstimateResult): void {
    const usable = result.status !== 'invalid' && result.pricing.ratePerLaborHour > 0;
    for (const node of form.querySelectorAll<HTMLElement>('[data-addon-price]')) {
      const id = node.dataset.addonPrice ?? '';
      const line = result.pricing.addonPrices.find((addon) => addon.id === id);
      if (!usable || !line || line.charge === null) {
        node.textContent = usable ? 'Custom quote' : '—';
        continue;
      }
      node.textContent = `+$${line.charge.toFixed(2)}`;
      if (result.pricing.minimumApplied) {
        node.title = 'Included in the minimum visit price';
      } else {
        node.removeAttribute('title');
      }
    }
  }

  function renderIncentive(result: EstimateResult): void {
    if (!addonIncentiveEl || !addonIncentiveText) return;
    const discount = result.status === 'estimated' ? result.pricing.discount : null;
    if (!discount) {
      addonIncentiveEl.hidden = true;
      addonIncentiveText.textContent = '';
      return;
    }
    addonIncentiveEl.hidden = false;
    addonIncentiveText.textContent = `You're saving $${discount.amount.toFixed(2)} — ${discount.label.toLowerCase()}.`;
  }

  /** Builds the reconciled price lines used by both the preview and summary. */
  function priceLines(result: EstimateResult): Array<{ label: string; value: string; strong?: boolean }> {
    const p = result.pricing;
    if (result.status !== 'estimated' || p.subtotal <= 0) return [];
    const roundStep = pricing.rounding.toNearest.value;
    const lines: Array<{ label: string; value: string; strong?: boolean }> = [];
    if (p.minimumApplied) {
      lines.push({ label: 'Minimum visit price', value: `$${p.subtotal.toFixed(2)}` });
      if (p.selectedExtras.length > 0) lines.push({ label: 'Selected extras', value: 'Included' });
      if (p.discount) lines.push({ label: p.discount.label, value: `−$${p.discount.amount.toFixed(2)}` });
    } else {
      lines.push({ label: 'Base cleaning (includes travel)', value: `$${p.basePrice.toFixed(2)}` });
      for (const extra of p.selectedExtras) {
        lines.push({ label: extra.label, value: `+$${extra.charge.toFixed(2)}` });
      }
      if (p.discount) lines.push({ label: p.discount.label, value: `−$${p.discount.amount.toFixed(2)}` });
    }
    if (p.roundingAdjustment > 0) {
      lines.push({ label: `Rounded up to the nearest $${roundStep}`, value: `+$${p.roundingAdjustment.toFixed(2)}` });
    }
    lines.push({ label: 'Proposed total', value: `$${(p.subtotal + p.roundingAdjustment).toFixed(2)}`, strong: true });
    return lines;
  }

  function fillLines(container: HTMLElement, lines: Array<{ label: string; value: string; strong?: boolean }>): void {
    container.innerHTML = '';
    for (const line of lines) {
      const item = document.createElement('li');
      const term = document.createElement('span');
      term.textContent = line.label;
      const detail = document.createElement(line.strong ? 'strong' : 'span');
      detail.textContent = line.value;
      item.append(term, detail);
      container.appendChild(item);
    }
  }

  function renderPricePreview(result: EstimateResult): void {
    if (!pricePreview || !pricePreviewLines || !pricePreviewNote) return;
    if (result.status === 'invalid' || result.status === 'custom_confirmation_required') {
      pricePreview.hidden = result.status === 'invalid';
      pricePreviewLines.innerHTML = '';
      pricePreviewNote.textContent =
        result.status === 'custom_confirmation_required'
          ? result.message ?? 'This one is confirmed personally with you.'
          : '';
      return;
    }
    const lines = priceLines(result);
    pricePreview.hidden = lines.length === 0;
    fillLines(pricePreviewLines, lines);
    pricePreviewNote.textContent = result.pricing.minimumApplied
      ? 'The minimum visit price applies, so selected extras are included at no additional charge.'
      : 'Every figure above comes from the same calculation as your proposed total.';
  }

  // ── Reservation summary (order-style, carries every calculator answer) ────
  function addSummaryRow(container: HTMLElement | null, label: string, value: string): void {
    if (!container || !value) return;
    const item = document.createElement('li');
    const term = document.createElement('span');
    term.textContent = label;
    const detail = document.createElement('strong');
    detail.textContent = value;
    item.append(term, detail);
    container.appendChild(item);
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
    // Verified travel wording requires BOTH a live route and a confirmed
    // street address; a bare GPS pin or ZIP keeps the preliminary copy.
    const summarySubmission = submissionAddress();
    const travelFullyVerified =
      latestQuote.travelVerified &&
      summarySubmission.location !== null &&
      summarySubmission.street.trim().length >= 5;
    if (reservationPrice) reservationPrice.textContent = `$${latestQuote.amount.toLocaleString()}`;
    if (reservationReference) {
      reservationReference.hidden = false;
      reservationReference.textContent = `Estimate reference ${latestQuote.reference}`;
    }
    if (reservationValidity) {
      reservationValidity.hidden = false;
      reservationValidity.textContent =
        'Proposed price — not a held reservation or a binding offer. Sparkling Standard confirms the final price before booking.';
    }
    if (reservationQualification) {
      reservationQualification.textContent = travelFullyVerified
        ? 'Travel-inclusive proposed price — based on the driving distance to your confirmed location.'
        : 'Preliminary proposed price — travel is estimated and Sparkling Standard confirms your location and final price before booking.';
    }

    if (priceBreakdown) fillLines(priceBreakdown, priceLines(result));

    if (reservationScope) {
      reservationScope.innerHTML = '';
      addSummaryRow(
        reservationScope,
        'Cleaning',
        input.serviceType ? SERVICE_LABELS[input.serviceType as ServiceType] : '',
      );
      addSummaryRow(reservationScope, 'Frequency', input.frequency ? FREQUENCY_LABELS[input.frequency as keyof typeof FREQUENCY_LABELS] : '');
      const homeParts = [
        input.propertyType ? input.propertyType.charAt(0).toUpperCase() + input.propertyType.slice(1) : '',
        input.squareFeet ? `${input.squareFeet.toLocaleString()} sqft` : '',
        input.bedrooms !== undefined ? `${input.bedrooms} bed` : '',
        input.fullBaths !== undefined
          ? `${input.fullBaths} full bath${input.fullBaths === 1 ? '' : 's'}${input.halfBaths ? ` + ${input.halfBaths} half` : ''}`
          : '',
      ].filter(Boolean);
      addSummaryRow(reservationScope, 'Home', homeParts.join(' · '));
      addSummaryRow(reservationScope, 'Condition', input.condition ? input.condition.replaceAll('_', ' ') : '');
      addSummaryRow(reservationScope, 'Last professional clean', input.lastClean ? input.lastClean.replaceAll('_', ' ') : '');
      addSummaryRow(reservationScope, 'Pets', input.pets ? input.pets.replaceAll('_', ' ') : '');
      addSummaryRow(
        reservationScope,
        'Extras',
        result.addons.length > 0 ? result.addons.map((addon) => addon.label).join(', ') : 'None',
      );
      addSummaryRow(reservationScope, 'Destination', location ? formatLocationLine(location) : `ZIP ${input.zip ?? ''}`);
      addSummaryRow(
        reservationScope,
        'Travel',
        travelFullyVerified
          ? `Confirmed route${result.travel.oneWayMiles !== null ? ` — ${Math.round(result.travel.oneWayMiles)} mi one way` : ''}`
          : 'Estimated — confirmed before booking',
      );
      addSummaryRow(reservationScope, 'Preferred date', textValue('preferredDate') ?? '');
      addSummaryRow(reservationScope, 'Arrival', textValue('arrivalPreference')?.replaceAll('-', ' ') ?? '');
    }

    // Call / text actions carry the estimate context the customer is looking at.
    if (reserveCall) {
      reserveCall.hidden = !phone;
      if (phone) reserveCall.href = phone.href;
    }
    if (reserveText) {
      reserveText.hidden = !phone || !business.flags.smsEnabled;
      if (phone) {
        const body = `Hi! I'd like to reserve a cleaning. My estimate reference is ${latestQuote.reference} with a proposed price of $${latestQuote.amount}${location ? ` at ${formatLocationLine(location)}` : ''}. Sparkling Standard will confirm the final price.`;
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
    const title = STEP_LABELS[currentStep - 1] ?? '';
    if (stepLabel) stepLabel.textContent = `Step ${currentStep} of ${steps.length} — ${title}`;
    if (mobileStepTitle) mobileStepTitle.textContent = `Step ${currentStep} of ${steps.length} — ${title}`;

    // Navigator: completed steps are revisitable; future steps are locked.
    for (const item of stepItems) {
      const stepNumber = Number(item.dataset.stepItem ?? 0);
      item.dataset.state = stepNumber < currentStep ? 'complete' : stepNumber === currentStep ? 'current' : 'upcoming';
    }
    for (const jump of stepJumps) {
      const stepNumber = Number(jump.dataset.stepJump ?? 0);
      jump.disabled = stepNumber > currentStep;
      if (stepNumber === currentStep) jump.setAttribute('aria-current', 'step');
      else jump.removeAttribute('aria-current');
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
    const next = Math.min(Math.max(step, 1), steps.length);
    const changed = next !== currentStep;
    currentStep = next;
    for (const [index, element] of steps.entries()) {
      element.dataset.active = String(index + 1 === currentStep);
    }
    updateChrome();
    recalc();
    if (!changed) return;

    // Accessible focus management without scrolling the document.
    const heading = steps[currentStep - 1]?.querySelector<HTMLElement>('.wizard__step-heading');
    if (heading) {
      heading.tabIndex = -1;
      heading.focus({ preventScroll: true });
    }

    // Stable viewport: the new step must never leave the customer at the
    // bottom of the page or scrolled past the questionnaire. When the form top
    // is already in a comfortable band we do not move the page at all; when a
    // shorter/taller step would move it out of view, we place the form top
    // just below the sticky header. This is deterministic at every width and
    // cannot be clamped the way relative scroll compensation can.
    const header = document.querySelector<HTMLElement>('.site-header');
    const headerOffset =
      header && window.getComputedStyle(header).display !== 'none' ? header.getBoundingClientRect().height : 0;
    const comfortableTop = headerOffset + 12;
    const rect = form.getBoundingClientRect();
    if (rect.top < headerOffset + 4 || rect.top > window.innerHeight * 0.35) {
      window.scrollTo({ top: Math.max(0, rect.top + window.scrollY - comfortableTop), behavior: 'instant' });
    }

    // Scroll the horizontal step navigator internally (never the page) so the
    // active step stays visible on narrow screens.
    const nav = form.querySelector<HTMLElement>('[data-wizard-steps]');
    const activeItem = stepItems.find((item) => Number(item.dataset.stepItem ?? 0) === currentStep);
    if (nav && activeItem && nav.scrollWidth > nav.clientWidth) {
      const target = activeItem.offsetLeft - nav.clientWidth / 2 + activeItem.offsetWidth / 2;
      nav.scrollTo({ left: Math.max(0, target), behavior: 'smooth' });
    }
  }

  function stepFields(step: number): Array<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement> {
    const section = steps[step - 1];
    if (!section) return [];
    return [
      ...section.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
        'input, select, textarea',
      ),
    ].filter((field) => !field.closest('[hidden]') && !field.closest('[data-address-permission]'));
  }

  // ── Inline validation ─────────────────────────────────────────────────────
  const attemptedSteps = new Set<number>();
  const errorSummary = form.querySelector<HTMLElement>('[data-error-summary]');
  const errorSummaryList = form.querySelector<HTMLElement>('[data-error-summary-list]');

  function keyOf(field: HTMLElement): string {
    return field.id || field.getAttribute('name') || 'field';
  }

  function errorElFor(field: HTMLElement): HTMLElement {
    const key = keyOf(field);
    let el = form.querySelector<HTMLElement>(`[data-error-for="${key}"]`);
    if (!el) {
      el = document.createElement('p');
      el.className = 'field-error';
      el.id = `${key}-error`;
      el.dataset.errorFor = key;
      el.hidden = true;
      const anchor = field.closest('.field') ?? field.closest('.address-gps') ?? field.parentElement;
      anchor?.appendChild(el);
    }
    return el;
  }

  function controlFor(field: HTMLElement): HTMLElement {
    if (field instanceof HTMLInputElement && field.type === 'radio') {
      return (field.closest('fieldset') as HTMLElement | null) ?? field;
    }
    return field;
  }

  function setFieldError(field: HTMLElement, message: string): void {
    const control = controlFor(field);
    const el = errorElFor(control);
    el.textContent = message;
    el.hidden = false;
    if (control instanceof HTMLInputElement || control instanceof HTMLSelectElement || control instanceof HTMLTextAreaElement) {
      control.classList.add('input--invalid');
      control.setAttribute('aria-invalid', 'true');
      const describedBy = new Set((control.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean));
      describedBy.add(el.id);
      control.setAttribute('aria-describedby', [...describedBy].join(' '));
    }
  }

  function clearFieldError(field: HTMLElement): void {
    const control = controlFor(field);
    const el = form.querySelector<HTMLElement>(`[data-error-for="${keyOf(control)}"]`);
    if (el) {
      el.hidden = true;
      el.textContent = '';
    }
    if (control instanceof HTMLInputElement || control instanceof HTMLSelectElement || control instanceof HTMLTextAreaElement) {
      control.classList.remove('input--invalid');
      control.removeAttribute('aria-invalid');
      const describedBy = (control.getAttribute('aria-describedby') ?? '')
        .split(/\s+/)
        .filter((id) => id && id !== el?.id);
      if (describedBy.length > 0) control.setAttribute('aria-describedby', describedBy.join(' '));
      else control.removeAttribute('aria-describedby');
    }
  }

  function clearAllErrors(): void {
    for (const el of form.querySelectorAll<HTMLElement>('[data-error-for]')) {
      el.hidden = true;
      el.textContent = '';
    }
    for (const field of form.querySelectorAll<HTMLElement>('.input--invalid, .select--invalid, .textarea--invalid, [aria-invalid]')) {
      field.classList.remove('input--invalid', 'select--invalid', 'textarea--invalid');
      field.removeAttribute('aria-invalid');
    }
    if (errorSummary) errorSummary.hidden = true;
    if (errorSummaryList) errorSummaryList.innerHTML = '';
  }

  /** Method-aware message for one control, or null when it is valid. */
  function messageFor(field: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement): string | null {
    const submission = submissionAddress();
    // Hidden manual fields never block a GPS-based request.
    if (submission.method === 'gps' && (field.id === 'est-address' || field.id === 'est-zip')) return null;
    const value = field.value.trim();
    if (field.id === 'est-zip') {
      return /^\d{5}(-\d{4})?$/.test(value) ? null : 'Please enter a valid ZIP code.';
    }
    if (field.id === 'est-address') {
      return value === '' ? field.dataset.errorRequired ?? 'Please enter your street address.' : null;
    }
    const required = field.hasAttribute('required') || field.dataset.errorRequired !== undefined;
    if (value === '') {
      return required ? field.dataset.errorRequired ?? 'This field is required.' : null;
    }
    if (field instanceof HTMLInputElement && field.type === 'email' && !field.validity.valid) {
      return 'Please enter a valid email address.';
    }
    if (field instanceof HTMLInputElement && field.type === 'tel' && value.replace(/\D/g, '').length < 10) {
      return 'Please enter a valid phone number.';
    }
    if (field instanceof HTMLInputElement && field.type === 'number' && !field.validity.valid) {
      return field.dataset.errorRange ?? 'Please enter a valid number.';
    }
    if (field instanceof HTMLInputElement && field.type === 'date' && !field.validity.valid) {
      return 'Please choose a preferred date.';
    }
    if (!field.validity.valid) return field.dataset.errorInvalid ?? 'Please check this field.';
    return null;
  }

  function radioGroupMessage(section: HTMLElement, name: string): string | null {
    const group = section.querySelector<HTMLElement>(`fieldset[data-group-error="${name}"]`);
    if (!group) return null;
    const anyChecked = form.querySelector(`input[name="${name}"]:checked`);
    if (anyChecked) return null;
    return group.dataset.groupMessage ?? 'Please make a selection.';
  }

  function showErrorSummary(errors: Array<{ field: HTMLElement; message: string }>): void {
    if (!errorSummary || !errorSummaryList) return;
    errorSummaryList.innerHTML = '';
    if (errors.length === 0) {
      errorSummary.hidden = true;
      return;
    }
    for (const error of errors) {
      const item = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = error.message;
      button.addEventListener('click', () => focusInvalid(error.field));
      item.appendChild(button);
      errorSummaryList.appendChild(item);
    }
    errorSummary.hidden = false;
  }

  function focusInvalid(field: HTMLElement): void {
    // A collapsed manual section must open before its field can be focused.
    const details = field.closest('details');
    if (details instanceof HTMLDetailsElement) details.open = true;
    const target = controlFor(field);
    if (target instanceof HTMLElement) {
      target.scrollIntoView({ block: 'center' });
      target.focus?.();
    }
  }

  function validateStep(step: number): boolean {
    attemptedSteps.add(step);
    const section = steps[step - 1];
    if (!section) return true;
    const errors: Array<{ field: HTMLElement; message: string }> = [];

    // Radio groups (service type, condition).
    for (const group of section.querySelectorAll<HTMLElement>('fieldset[data-group-error]')) {
      const name = group.dataset.groupError ?? '';
      const message = radioGroupMessage(section, name);
      if (message) {
        const first = section.querySelector<HTMLInputElement>(`input[name="${name}"]`);
        if (first) {
          setFieldError(first, message);
          errors.push({ field: first, message });
        }
      } else {
        const first = section.querySelector<HTMLInputElement>(`input[name="${name}"]`);
        if (first) clearFieldError(first);
      }
    }

    for (const field of stepFields(step)) {
      if (field instanceof HTMLInputElement && field.type === 'radio') continue;
      const message = messageFor(field);
      if (message) {
        setFieldError(field, message);
        errors.push({ field, message });
      } else {
        clearFieldError(field);
      }
    }

    // Address method rules. A confirmed GPS destination is enough on its own:
    // coverage and travel use the confirmed map location when no reliable ZIP
    // was returned, so no ZIP entry is ever demanded for GPS.
    if (step === 1) {
      const submission = submissionAddress();
      if (submission.method === 'gps' && !submission.location) {
        const gpsButton = form.querySelector<HTMLElement>('[data-address-gps]');
        const message = 'Please confirm your current location, or enter the address manually.';
        if (gpsButton) {
          setFieldError(gpsButton, message);
          errors.push({ field: gpsButton, message });
        }
      }
    }

    showErrorSummary(errors);
    if (errors.length > 0) {
      const first = errors[0];
      if (first) focusInvalid(first.field);
      return false;
    }
    return true;
  }

  /** Quiet validation used by the step navigator (no messages). */
  function canJumpTo(step: number): boolean {
    for (let index = 1; index < step; index += 1) {
      const section = steps[index - 1];
      if (!section) continue;
      for (const group of section.querySelectorAll<HTMLElement>('fieldset[data-group-error]')) {
        const name = group.dataset.groupError ?? '';
        if (!form.querySelector(`input[name="${name}"]:checked`)) return false;
      }
      for (const field of stepFields(index)) {
        if (field instanceof HTMLInputElement && field.type === 'radio') continue;
        if (messageFor(field)) return false;
      }
      if (index === 1) {
        const submission = submissionAddress();
        if (submission.method === 'gps') {
          if (!submission.location) return false;
        } else {
          const street = form.querySelector<HTMLInputElement>('#est-address');
          if (!street || street.value.trim() === '') return false;
        }
      }
    }
    return true;
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

  function clearTravelCache(): void {
    try {
      const stale: string[] = [];
      for (let index = 0; index < window.sessionStorage.length; index += 1) {
        const key = window.sessionStorage.key(index);
        if (key && key.startsWith(TRAVEL_CACHE_PREFIX)) stale.push(key);
      }
      for (const key of stale) window.sessionStorage.removeItem(key);
    } catch {
      // Best effort only.
    }
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

    const { zip, location: confirmed } = submissionAddress();
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
        recalc();
        void lookupTravel();
      } else {
        recalc();
      }
    },
  });

  // ── Fresh start (no drafts are ever stored) ───────────────────────────────
  function resetWizard(): void {
    form.reset();
    addressFinder?.reset();
    clearAllErrors();
    attemptedSteps.clear();
    location = null;
    routed = undefined;
    routedKey = null;
    lastTravelKey = '';
    travelLookupSeq += 1;
    latestResult = null;
    latestQuote = null;
    estimateStarted = false;
    estimateCompleted = false;
    clearTravelCache();
    if (status) {
      status.textContent = '';
      status.dataset.state = '';
    }
    if (livePanel) livePanel.hidden = true;
    if (liveFlags) liveFlags.innerHTML = '';
    showStep(1);
  }

  // A bfcache restore (browser Back/Forward) must never resurrect an old
  // questionnaire: treat it exactly like a fresh visit.
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) resetWizard();
  });

  // ── Submission ────────────────────────────────────────────────────────────
  function buildSubmissionFields(result: EstimateResult): Record<string, string> {
    const input = gatherInput();
    // The selected address method is the ONLY source of the submitted
    // destination: GPS never merges stale manual fields and vice versa.
    const submission = submissionAddress();
    const confirmedLocation = submission.location;
    const isReservation = result.status === 'estimated' && latestQuote !== null;
    const fields: Record<string, string> = {
      request_type: isReservation ? 'reservation_request' : 'residential_estimate',
      estimate_status: result.status,
      service_type: input.serviceType ?? '',
      property_type: input.propertyType ?? '',
      zip: submission.zip,
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
      address_method: submission.method,
      service_address: submission.street,
      address_unit: submission.unit,
      address_city: submission.city,
      address_state: submission.state,
      address_confirmed: confirmedLocation ? 'yes' : 'no',
      ...(confirmedLocation
        ? {
            pin_latitude: confirmedLocation.lat.toFixed(6),
            pin_longitude: confirmedLocation.lng.toFixed(6),
            pin_source: confirmedLocation.source,
            pin_precision: confirmedLocation.precision ?? 'exact',
            pin_adjusted: confirmedLocation.adjusted ? 'yes' : 'no',
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

    const honeypot = form.querySelector<HTMLInputElement>('input[name="extra_ref"]');
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
    const destinationLabel =
      fields.zip || fields.address_city || (fields.address_method === 'gps' ? 'confirmed map pin' : 'location pending');
    const subject = isReservation
      ? `Reservation request — ${SERVICE_SHORT[fields.service_type as ServiceType] ?? 'cleaning'}${priceLabel} — ${destinationLabel}`
      : `Cleaning request — ${SERVICE_SHORT[fields.service_type as ServiceType] ?? 'estimate'} — ${destinationLabel}`;
    const outcome = await submitLead(fields, subject);

    if (!outcome.ok) {
      if (submitButton) submitButton.disabled = false;
      if (status) {
        status.dataset.state = 'error';
        status.textContent = `${failureCopy(outcome.reason as FailureReason, contact)} Your answers are still on this page.`;
      }
      return;
    }

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
            'Request received — not booked yet. Sparkling Standard will confirm scope, date and final price with you before anything is scheduled.',
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

  for (const jump of stepJumps) {
    jump.addEventListener('click', () => {
      const target = Number(jump.dataset.stepJump ?? 0);
      if (target < 1 || target > currentStep) return;
      if (target === currentStep) return;
      if (!canJumpTo(target)) return;
      showStep(target);
    });
  }

  form.addEventListener('input', (event) => {
    if (!estimateStarted) {
      estimateStarted = true;
      const serviceType = currentServiceType();
      track('estimate_start', serviceType ? { service_type: serviceType } : {});
    }
    const target = event.target;
    if (
      target instanceof HTMLInputElement ||
      target instanceof HTMLSelectElement ||
      target instanceof HTMLTextAreaElement
    ) {
      const errorShown = form.querySelector<HTMLElement>(`[data-error-for="${keyOf(controlFor(target))}"]:not([hidden])`);
      if (errorShown) {
        const message = messageFor(target);
        if (message) setFieldError(target, message);
        else {
          clearFieldError(target);
          if (errorSummary && !form.querySelector('[data-error-for]:not([hidden])')) errorSummary.hidden = true;
        }
      }
    }
    syncConditionalFields();
    recalc();
  });

  form.addEventListener('change', (event) => {
    const target = event.target as HTMLElement | null;
    if (
      target instanceof HTMLInputElement ||
      target instanceof HTMLSelectElement ||
      target instanceof HTMLTextAreaElement
    ) {
      if (target instanceof HTMLInputElement && target.type === 'radio') {
        clearFieldError(target);
        const group = target.closest('.field.wizard__step, .wizard__step')?.querySelector<HTMLElement>(
          `fieldset[data-group-error="${target.name}"]`,
        );
        if (group) clearFieldError(group.querySelector<HTMLInputElement>(`input[name="${target.name}"]`) ?? target);
      } else {
        const errorShown = form.querySelector<HTMLElement>(`[data-error-for="${keyOf(controlFor(target))}"]:not([hidden])`);
        const message = messageFor(target);
        if (message) setFieldError(target, message);
        else clearFieldError(target);
        if (errorShown && !message && errorSummary && !form.querySelector('[data-error-for]:not([hidden])')) {
          errorSummary.hidden = true;
        }
      }
    }
    syncConditionalFields();
    recalc();
    if (target instanceof HTMLInputElement && target.name === 'zip') {
      void lookupTravel();
    }
  });

  // Validate the active step's fields when they lose focus (format + required).
  form.addEventListener(
    'focusout',
    (event) => {
      const target = event.target;
      if (
        !(target instanceof HTMLInputElement) &&
        !(target instanceof HTMLSelectElement) &&
        !(target instanceof HTMLTextAreaElement)
      ) {
        return;
      }
      if (target instanceof HTMLInputElement && target.type === 'radio') return;
      if (!target.closest('.wizard__step[data-active="true"]')) return;
      const message = messageFor(target);
      if (message && (target.value.trim() !== '' || attemptedSteps.has(currentStep))) {
        setFieldError(target, message);
      } else if (!message) {
        clearFieldError(target);
      }
    },
    true,
  );

  form.addEventListener('submit', (event) => {
    void handleSubmit(event);
  });

  resetButton?.addEventListener('click', () => {
    resetWizard();
  });

  resetWizard();

  // Deep links from marketing pages: /estimate/?frequency=biweekly preselects
  // the recurring rhythm (and ?service=deep preselects the service), so a
  // campaign CTA lands one step closer to conversion. Values are validated
  // against the known vocabulary and never trusted for anything else.
  function applyDeepLinkSelections(): void {
    let params: URLSearchParams;
    try {
      params = new URLSearchParams(window.location.search);
    } catch {
      return;
    }
    const service = params.get('service');
    if (service && ['standard', 'deep', 'move_in_out', 'str_turnover'].includes(service)) {
      const radio = form.querySelector<HTMLInputElement>(`input[name="serviceType"][value="${service}"]`);
      if (radio) {
        radio.checked = true;
        radio.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }
    const frequency = params.get('frequency');
    if (frequency && ['weekly', 'biweekly', 'monthly', 'one_time'].includes(frequency)) {
      const select = form.querySelector<HTMLSelectElement>('#est-frequency');
      if (select) {
        select.value = frequency;
        select.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }
  }
  applyDeepLinkSelections();
  recalc();
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
