// Estimate wizard — client logic. The estimator engine runs in the browser so
// the instant estimate works on a fully static page and keeps working when the
// travel API is unavailable. Nothing is ever auto-booked.
//
// Journey (owner-approved, 2026-10-28): When & Where → Service & Home →
// Condition & Frequency → Optional Extras → Your Estimate. Step 1 chooses a
// provisional preferred date/time and the service address.
//
// Behavior rules:
//  - Every page visit starts a FRESH blank estimate at step 1. Nothing is
//    restored from localStorage; there is no automatic draft recovery.
//  - A resolved street address and its coordinates are the destination source
//    when available. The typed address is preserved; a failed exact lookup
//    falls back to the customer's ZIP without inventing a house location.
//  - Prices shown here are proposals built by the ONE authoritative model
//    (labor-hours × approved rate, with the add-on display and discount coming
//    from the same breakdown). The server recalculates every reservation; the
//    browser price is never trusted for acceptance.
//  - Nothing analytics-related ever receives the address, ZIP, coordinates,
//    price or form contents.

import { pricing } from '../config/pricing';
import { zipReferenceFor } from '../config/geography';
import { business, contactPhone, isPending } from '../config/business';
import { schedulingConfig } from '../config/scheduling';
import { calculateEstimate, type EstimateContext } from '../lib/estimate/calculate';
import { buildInstantQuote, type InstantQuote } from '../lib/estimate/quote';
import { taxPresentationForService } from '../lib/estimate/tax';
import { formatUsd } from '../lib/format';
import { ESTIMATE_STEPS } from '../lib/estimate/steps';
import {
  CONDITION_LABELS,
  SERVICE_LABELS,
  SERVICE_SHORT,
  FREQUENCY_LABELS,
  FREQUENCY_RHYTHMS,
} from '../lib/estimate/labels';
import { serviceAsksFrequency, serviceSupportsFrequency } from '../lib/estimate/service-matrix';
import { ENGINE_STEPS, parseResidentialServiceParam } from '../lib/estimate/engines';
import type { EstimateInput, EstimateInputDraft, EstimateResult, RoutedTravelInfo, ServiceType } from '../lib/estimate/types';
import { locationKey, formatLocationLine, type ConfirmedLocation } from '../lib/location/location';
import { initAddressFinder, type AddressFinderHandle } from './address-finder';
import { initPhotoUploads } from './photo-uploads';
import { cancelEstimateReveal, playEstimateReveal } from './estimate-reveal';
import { submitLead, recordConversion } from '../lib/forms/submit';
import { reservationReceipt } from '../lib/forms/verification-copy';
import { saveSubmissionSummary } from '../lib/forms/submission-receipt';
import { failureCopy, type FailureReason } from '../lib/forms/failure-copy';
import { track } from '../lib/analytics/events';
import { attributionFields } from '../lib/attribution';
import { legalTerms } from '../config/legal';
import { bookingConfig } from '../config/booking';
import { initBookingCalendar, type BookingCalendarHandle } from './booking-calendar';
const TRAVEL_CACHE_PREFIX = 'pcc-travel-';

// ── SPARKLE100 claim state (first-party, no PII) ─────────────────────────────
// The popup writes the claim; the wizard reads it here. The URL parameter is
// validated against the configured code so ?promo=<garbage> claims nothing.
const PROMO_STATE_KEY = 'pcc-promo-state';
const CLAIMED_STATES = new Set(['claimed', 'redeemed']);

function configuredCampaignCode(): string | null {
  const campaign = pricing.promotions.campaign.value;
  return campaign.enabled ? campaign.code : null;
}

function storedPromoClaim(): string | null {
  const code = configuredCampaignCode();
  if (!code) return null;
  try {
    const raw = window.localStorage.getItem(PROMO_STATE_KEY);
    const parsed = raw ? (JSON.parse(raw) as { state?: string }) : null;
    if (parsed && typeof parsed.state === 'string' && CLAIMED_STATES.has(parsed.state)) {
      return code;
    }
  } catch {
    // Storage is best-effort; a claim is never required for an estimate.
  }
  return null;
}

function claimedPromoCode(): string | null {
  const code = configuredCampaignCode();
  if (!code) return null;
  try {
    const param = new URLSearchParams(window.location.search).get('promo');
    if (param && param.trim().toUpperCase() === code.toUpperCase()) return code;
  } catch {
    // URL parsing is best-effort.
  }
  return storedPromoClaim();
}

const phone = contactPhone();
const contact = {
  phoneDisplay: phone?.display,
  email: isPending(business.email) ? undefined : business.email,
  smsEnabled: business.flags.smsEnabled,
};

let STEP_LABELS: readonly string[] = ESTIMATE_STEPS.map((step) => step.title);

const formHost = document.querySelector<HTMLFormElement>('[data-estimate-form]');
if (formHost) {
  initEstimateWizard(formHost);
}

function initEstimateWizard(form: HTMLFormElement): void {
  const steps = [...form.querySelectorAll<HTMLElement>('.wizard__step')];
  const backButton = form.querySelector<HTMLButtonElement>('[data-back]');
  const nextButton = form.querySelector<HTMLButtonElement>('[data-next]');
  const submitButton = form.querySelector<HTMLButtonElement>('[data-submit]');
  const finalActions = form.querySelector<HTMLElement>('[data-final-actions]');
  const payNowButton = form.querySelector<HTMLButtonElement>('[data-pay-now]');
  const photoGate = form.querySelector<HTMLElement>('[data-photo-gate]');
  const photoGateUpload = form.querySelector<HTMLButtonElement>('[data-photo-upload-now]');
  const photoGatePayLater = form.querySelector<HTMLButtonElement>('[data-photo-pay-later]');
  const photoSummary = form.querySelector<HTMLElement>('[data-photo-summary]');
  const photoUnavailableNotice = form.querySelector<HTMLElement>('[data-photo-unavailable]');
  const verifyAddressButton = form.querySelector<HTMLButtonElement>('[data-verify-address]');
  const paymentNote = form.querySelector<HTMLElement>('[data-payment-note]');
  const giftField = form.querySelector<HTMLElement>('[data-gift-field]');
  const paymentUnavailable = form.querySelector<HTMLElement>('[data-payment-unavailable]');
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
  const liveOngoing = form.querySelector<HTMLElement>('[data-estimate-ongoing]');
  const liveNote = form.querySelector<HTMLElement>('[data-estimate-note]');
  const liveTax = form.querySelector<HTMLElement>('[data-estimate-tax]');
  const liveTravel = form.querySelector<HTMLElement>('[data-estimate-travel]');
  const liveReference = form.querySelector<HTMLElement>('[data-estimate-reference]');
  const liveFlags = form.querySelector<HTMLElement>('[data-estimate-flags]');
  const status = form.querySelector<HTMLElement>('[data-form-status]');
  const addressCardEl = form.querySelector<HTMLElement>('[data-address-card]');
  const addressDetailsEl = form.querySelector<HTMLElement>('[data-address-details]');
  const streetInputEl = form.querySelector<HTMLInputElement>('#est-address');
  let addressCardRevealed = false;
  let addressDetailsRevealed = false;

  function smoothReveal(element: HTMLElement): void {
    requestAnimationFrame(() => {
      element.scrollIntoView({
        behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
        block: 'center',
      });
    });
  }

  function revealAddressCard(): void {
    if (!addressCardEl || addressCardRevealed) return;
    addressCardEl.hidden = false;
    addressCardRevealed = true;
    smoothReveal(addressCardEl);
  }

  function revealAddressDetails(scroll: boolean): void {
    if (!addressDetailsEl || addressDetailsRevealed) return;
    if ((streetInputEl?.value.trim().length ?? 0) < 5) return;
    addressDetailsEl.hidden = false;
    addressDetailsRevealed = true;
    if (scroll) smoothReveal(addressDetailsEl);
  }


  const revealGroups = [...form.querySelectorAll<HTMLElement>('[data-reveal-group]')];

  function revealTriggerSatisfied(name: string): boolean {
    const radios = form.querySelectorAll<HTMLInputElement>(`input[name="${name}"]`);
    if (radios.length > 0) return [...radios].some((input) => input.checked);
    const field = form.elements.namedItem(name);
    if (field instanceof HTMLSelectElement || field instanceof HTMLInputElement) {
      return field.value.trim() !== '';
    }
    return false;
  }

  function syncRevealGroups(scroll: boolean): number {
    let revealed = 0;
    for (const group of revealGroups) {
      const name = group.dataset.revealTrigger ?? '';
      const visible = revealTriggerSatisfied(name);
      const wasHidden = group.hidden;
      group.hidden = !visible;
      if (visible && wasHidden) {
        revealed += 1;
        if (scroll) smoothReveal(group);
      }
    }
    return revealed;
  }

  const resetButton = document.querySelector<HTMLButtonElement>('[data-estimate-reset]');
  const reservationSummary = form.querySelector<HTMLElement>('[data-reservation-summary]');
  const estimateReveal = form.querySelector<HTMLElement>('[data-estimate-reveal]');
  const reservationEyebrow = form.querySelector<HTMLElement>('[data-reservation-eyebrow]');
  const reservationPrice = form.querySelector<HTMLElement>('[data-reservation-price]');
  const reservationOngoing = form.querySelector<HTMLElement>('[data-reservation-ongoing]');
  const reservationPriceSuffix = form.querySelector<HTMLElement>('[data-reservation-price-suffix]');
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
  const customBundleEl = form.querySelector<HTMLElement>('[data-custom-bundle]');
  const customBundleText = form.querySelector<HTMLElement>('[data-custom-bundle-text]');
  const bundleOffers = [...form.querySelectorAll<HTMLElement>('[data-bundle-id]')];
  const extrasSummary = form.querySelector<HTMLElement>('[data-extras-summary]');
  const reserveCall = document.querySelector<HTMLAnchorElement>('[data-reserve-call]');
  const reserveText = document.querySelector<HTMLAnchorElement>('[data-reserve-text]');
  const preview = import.meta.env.PUBLIC_PREVIEW_MODE === 'true';
  const engineNote = form.querySelector<HTMLElement>('[data-engine-note]');
  let engine: 'residential' | 'str' = 'residential';
  let paymentEnabled = false;
  let paymentBusy = false;
  let paymentBlocked = false;
  let pendingPaymentFields: Record<string, string> | null = null;
  let acceptedPaymentAmount: number | null = null;
  let paymentRetryAvailable = false;
  let requestAlreadySent = false;
  let addressVerificationPending = false;
  let addressReviewRequired = false;
  const photoController = initPhotoUploads(form, {
    engine: () => (radioValue('serviceType') === 'str_turnover' ? 'str' : 'residential'),
  });
  let deepNoticeShown = false;
  let photosDeferred = false;
  let pendingPhotoAction: 'reserve' | 'pay_now' = 'pay_now';
  let pendingPhotoStage: 'step3' | 'final' = 'final';

  function photoStorageAvailable(): boolean {
    const section = form.querySelector<HTMLElement>('[data-photo-section]');
    return Boolean(section && !section.hasAttribute('hidden'));
  }

  const photoSectionEl = form.querySelector<HTMLElement>('[data-photo-section]');
  if (photoSectionEl && typeof MutationObserver !== 'undefined') {
    new MutationObserver(() => updatePhotoSummary()).observe(photoSectionEl, {
      attributes: true,
      attributeFilter: ['hidden'],
    });
  }

  function photosOutstanding(): boolean {
    return photoStorageAvailable() && photoController.photoCount() === 0;
  }

  function updatePhotoSummary(): void {
    if (photoUnavailableNotice) photoUnavailableNotice.hidden = photoStorageAvailable();
    if (!photoSummary) return;
    if (!photoStorageAvailable()) {
      photoSummary.hidden = true;
      hidePhotoGate();
      return;
    }
    const count = photoController.photoCount();
    photoSummary.hidden = count === 0;
    photoSummary.textContent = count > 0 ? `${count} photo${count === 1 ? '' : 's'} attached.` : '';
    if (count > 0) hidePhotoGate();
  }

  function hidePhotoGate(): void {
    if (photoGate) photoGate.hidden = true;
  }

  function showPhotoGate(stage: 'step3' | 'final' = 'final', action: 'reserve' | 'pay_now' = 'reserve'): void {
    if (!photoGate) return;
    pendingPhotoStage = stage;
    pendingPhotoAction = action;
    photoGate.hidden = false;
    updatePhotoSummary();
    photoGate.scrollIntoView({ behavior: 'smooth', block: 'center' });
    photoGateUpload?.focus();
  }

  let bookingCalendar: BookingCalendarHandle | null = null;
  let bookingFinalizedKey = '';
  let bookingFinalizeNote = '';

  let currentStep = 1;
  let location: ConfirmedLocation | null = null;
  let routed: RoutedTravelInfo | undefined;
  let routedKey: string | null = null;
  let latestResult: EstimateResult | null = null;
  let latestQuote: InstantQuote | null = null;
  let finalRevealPlayed = false;
  let lastTravelKey = '';
  let estimateStarted = false;
  let estimateCompleted = false;
  let campaignAppliedTracked = false;

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
      ...(form.querySelector<HTMLInputElement>('input[name="supportiveEligible"]')?.checked
        ? { supportiveEligible: true }
        : {}),
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
    const claimedCode = claimedPromoCode();
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
      promotions: {
        // The claim is the customer's opt-in; the engine re-checks every
        // eligibility rule itself and the server recomputes it identically.
        claimedCampaignCode: claimedCode,
      },
    };
  }

  // ── Live calculation + rendering ──────────────────────────────────────────
  const RECURRING_FREQUENCIES = new Set(['weekly', 'biweekly', 'monthly']);

  /**
   * The primary price heading is derived from the RESULT, never from stale
   * form state: a new recurring arrangement shows its FIRST VISIT (the
   * required Deep Cleaning) with the ongoing rhythm alongside; everything
   * else shows a single Estimated Price.
   */
  function primaryPriceHeading(result: EstimateResult): string {
    return result.ongoing ? 'First Visit — Deep Cleaning' : 'Estimated Price';
  }

  function recalc(): EstimateResult {
    const input = gatherInput();
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
    renderExtrasSummary(result);
    renderIncentive(result);
    renderCustomBundle(result);
    renderBundles(result);
    renderPricePreview(result);
    renderReservationSummary(result);
    maybeRevealEstimate();
    // One aggregated event when the claimed campaign discount lands in the
    // estimate — the code only, never any customer data.
    if (!campaignAppliedTracked && result.pricing.discount?.source === 'campaign') {
      campaignAppliedTracked = true;
      const code = configuredCampaignCode();
      track('promotion_estimate_applied', {
        ...(code ? { code } : {}),
        ...(input.serviceType ? { service_type: input.serviceType } : {}),
      });
    }
    return result;
  }

  function travelCopy(result: EstimateResult): string {
    if (result.status !== 'estimated') return '';
    const travel = result.travel;
    const submission = submissionAddress();
    // Routing is only presented as distance-based certainty when the customer
    // confirmed a street address. A GPS pin, a street-level pin, an
    // approximate ZIP-area pin or a bare ZIP keeps the preliminary wording:
    // they are locations, not verified postal addresses.
    const streetConfirmed =
      submission.location !== null &&
      submission.street.trim().length >= 5 &&
      submission.location.precision !== 'street' &&
      submission.location.precision !== 'approximate';
    if (submission.location?.precision === 'pin') {
      return 'Travel is calculated to the property pin you confirmed. We will verify the exact street address before booking.';
    }
    if (travel.mode === 'routed' && travel.verified && streetConfirmed) {
      const miles =
        travel.oneWayMiles !== null ? ` (about ${Math.round(travel.oneWayMiles)} miles one way)` : '';
      return `Your proposed price includes travel based on the driving distance to your selected location${miles}.`;
    }
    if (submission.location?.precision === 'approximate') {
      return 'Travel is estimated from the approximate area you confirmed — not your exact house. Drag the pin to your property for a sharper price; we will confirm the exact address before booking.';
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

    // Before the final step the calculator runs silently: no changing dollar
    // totals, no sidebar price and no accessible price announcement. On the
    // final step the reservation summary takes over for estimable jobs; for
    // custom-confirmation jobs the status panel explains the pending scope and
    // shows a calculated base total only when a specialty extra is the cause.
    const summaryTakesOver =
      currentStep === steps.length && result.status === 'estimated' && latestQuote !== null;
    livePanel.hidden = currentStep !== steps.length || summaryTakesOver;

    if (result.status === 'estimated') {
      const amount = latestQuote ? formatUsd(latestQuote.amount) : '—';
      if (liveLabel) liveLabel.textContent = primaryPriceHeading(result);
      livePrice.textContent = amount;
      const tax = taxPresentationForService(currentServiceType());
      if (liveTax) {
        liveTax.hidden = false;
        liveTax.textContent = `${tax.label}. ${tax.note}`;
      }
      const confidenceCopy =
        submissionAddress().location?.precision === 'street'
          ? 'Based on the street-level pin you placed — we will verify the exact property with you.'
          : submissionAddress().location?.precision === 'approximate'
            ? 'Based on the approximate area you confirmed — drag the pin to your property for a sharper price.'
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
            ? `Typical range for this scope: ${formatUsd(result.low)} — ${formatUsd(result.high)}`
            : '';
      }
      if (liveOngoing) {
        const ongoing = result.ongoing;
        if (ongoing) {
          liveOngoing.hidden = false;
          liveOngoing.textContent = `After the required first-visit Deep Cleaning above, ongoing ${FREQUENCY_RHYTHMS[ongoing.frequency]} visits are ${formatUsd(ongoing.perVisitPrice)} each.`;
        } else {
          liveOngoing.hidden = true;
          liveOngoing.textContent = '';
        }
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
      const partialPrice =
        result.pricing.subtotal > 0 && result.addons.some((addon) => addon.customQuote)
          ? result.pricing.subtotal
          : null;
      if (liveLabel) {
        liveLabel.textContent = partialPrice !== null
          ? 'Base estimate — custom extras pending'
          : 'Estimate status';
      }
      livePrice.textContent = partialPrice !== null
        ? `${formatUsd(partialPrice, { forceCents: true })}+`
        : 'Confirmation Required';
      if (liveRange) {
        liveRange.hidden = true;
        liveRange.textContent = '';
      }
      if (liveOngoing) {
        liveOngoing.hidden = true;
        liveOngoing.textContent = '';
      }
      if (liveReference) {
        liveReference.hidden = true;
        liveReference.textContent = '';
      }
      liveNote.textContent = partialPrice !== null
        ? `${result.message ?? 'We will confirm this one personally.'} The calculated base and priced extras are ${formatUsd(partialPrice, { forceCents: true })}; custom-quoted extras are not included. This is not a payable total.`
        : result.message ?? 'We will confirm this one personally.';
    }

    if (liveTravel) liveTravel.textContent = travelCopy(result);

    for (const flag of result.flags) {
      if (result.status !== 'estimated' && flag.code === 'CUSTOM_CONFIRMATION_REQUIRED') continue;
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
      node.textContent = `+${formatUsd(line.charge, { forceCents: true })}`;
      if (result.pricing.minimumApplied) {
        node.title = 'Included in the minimum visit price';
      } else {
        node.removeAttribute('title');
      }
    }
  }

  function renderExtrasSummary(result: EstimateResult): void {
    if (!extrasSummary) return;
    const count = result.status === 'estimated' ? result.addons.length : 0;
    if (count === 0) {
      extrasSummary.textContent = 'No extras selected';
      return;
    }
    extrasSummary.textContent = `${count} selected — ${formatUsd(result.pricing.extrasSubtotal, { forceCents: true })}`;
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

  function renderCustomBundle(result: EstimateResult): void {
    if (!customBundleEl || !customBundleText) return;
    const selectedExtras = result.status === 'estimated' ? result.pricing.selectedExtras : [];
    if (selectedExtras.length !== 3) {
      customBundleEl.hidden = true;
      customBundleText.textContent = '';
      return;
    }
    const subtotal = result.pricing.extrasSubtotal;
    const nominal = Math.round(subtotal * 0.2 * 100) / 100;
    const applied = result.pricing.discount?.source === 'custom_three'
      ? result.pricing.discount.amount
      : 0;
    customBundleEl.hidden = false;
    customBundleText.textContent =
      `Selected extras: ${formatUsd(subtotal, { forceCents: true })}. ` +
      `Three-extra bundle: ${formatUsd(nominal, { forceCents: true })} off, ` +
      `leaving ${formatUsd(Math.max(0, subtotal - nominal), { forceCents: true })} for those extras.` +
      (applied > 0
        ? ' The 20% bundle is included in your total below.'
        : result.pricing.discount
          ? ' A larger single discount is applied instead under the no-stacking policy.'
          : '');
  }
  function renderBundles(result: EstimateResult): void {
    if (bundleOffers.length === 0) return;
    const selected = new Set(
      [...form.querySelectorAll<HTMLInputElement>('input[name="addons"]:checked')].map(
        (input) => input.value,
      ),
    );
    const frequency = textValue('frequency') ?? 'one_time';
    for (const offer of bundleOffers) {
      const required = (offer.dataset.bundleRequired ?? '').split(',').filter(Boolean);
      const priceNode = offer.querySelector<HTMLElement>('[data-bundle-price]');
      const addButton = offer.querySelector<HTMLButtonElement>('[data-bundle-add]');
      const recurring = offer.dataset.bundleRecurring === 'true';
      const allowedFrequencies = (offer.dataset.bundleFrequencies ?? '')
        .split(',')
        .filter(Boolean);
      const frequencyAllowed =
        (!recurring || frequency !== 'one_time') &&
        (allowedFrequencies.length === 0 || allowedFrequencies.includes(frequency));
      const allSelected = required.every((id) => selected.has(id));
      const charges = required
        .map((id) => result.pricing.addonPrices.find((line) => line.id === id)?.charge ?? null)
        .filter((charge): charge is number => charge !== null && charge > 0);
      const normal = charges.reduce((sum, charge) => sum + charge, 0);
      const kind = offer.dataset.bundleKind === 'fixed' ? 'fixed' : 'percent';
      const value = Number(offer.dataset.bundleValue);
      const cap = Number(offer.dataset.bundleCap);
      const nominalSavings =
        normal > 0 && Number.isFinite(value)
          ? Math.min(
              normal,
              kind === 'percent' ? normal * value : value,
              Number.isFinite(cap) && cap > 0 ? cap : Number.POSITIVE_INFINITY,
            )
          : 0;

      if (addButton) {
        addButton.disabled = allSelected || !frequencyAllowed;
        addButton.textContent = allSelected
          ? 'Selected'
          : frequencyAllowed
            ? 'Add these extras'
            : 'Available with recurring service';
      }
      if (!priceNode) continue;
      if (!frequencyAllowed) {
        priceNode.textContent = 'Available with recurring service.';
        continue;
      }
      const applied = result.pricing.discount;
      if (allSelected && applied && applied.id === offer.dataset.bundleId) {
        const selectedNormal = result.pricing.addonPrices
          .filter((line) => selected.has(line.id) && line.charge !== null)
          .reduce((sum, line) => sum + (line.charge ?? 0), 0);
        const bundlePrice = Math.max(0, selectedNormal - applied.amount);
        priceNode.textContent = `Bundle price ${formatUsd(bundlePrice, { forceCents: true })} for your selected extras (${formatUsd(selectedNormal, { forceCents: true })} individually — save ${formatUsd(applied.amount, { forceCents: true })}).`;
      } else if (allSelected && result.pricing.discount) {
        priceNode.textContent =
          `A larger discount is applied instead: ${result.pricing.discount.label} ` +
          `(${formatUsd(result.pricing.discount.amount, { forceCents: true })}). ` +
          'This named bundle is not added separately.';
      } else if (allSelected) {
        priceNode.textContent =
          result.pricing.minimumApplied
            ? 'Included in the minimum visit price.'
            : recurring && result.ongoing
              ? 'Available on ongoing visits. The first visit is priced as a Deep Cleaning, so this bundle is not applied to it.'
              : 'Selected. No additional bundle discount is applied to this quote.';
      } else if (normal > 0 && nominalSavings > 0) {
        priceNode.textContent = `${formatUsd(normal, { forceCents: true })} individually — ${formatUsd(Math.max(0, normal - nominalSavings), { forceCents: true })} as a bundle. Save ${formatUsd(nominalSavings, { forceCents: true })}.`;
      } else if (kind === 'percent' && Number.isFinite(value) && value > 0) {
        priceNode.textContent = `Save ${Math.round(value * 100)}% when selected together.`;
      } else {
        priceNode.textContent = 'Select every extra below to see your bundle price.';
      }
    }
  }

  /** Builds the reconciled price lines used by both the preview and summary. */
  function priceLines(result: EstimateResult): Array<{ label: string; value: string; strong?: boolean }> {
    const p = result.pricing;
    if (result.status === 'invalid' || p.subtotal <= 0) return [];
    const partial =
      result.status === 'custom_confirmation_required' &&
      result.addons.some((addon) => addon.customQuote);
    if (result.status !== 'estimated' && !partial) return [];
    const tax = taxPresentationForService(radioValue('serviceType'));
    const lines: Array<{ label: string; value: string; strong?: boolean }> = [];
    const firstVisit = Boolean(result.ongoing);
    if (p.minimumApplied) {
      lines.push({ label: 'Minimum visit price', value: formatUsd(p.basePrice) });
      if (p.selectedExtras.length > 0) lines.push({ label: 'Selected extras', value: 'Included' });
    } else {
      lines.push({
        label: firstVisit ? 'True Deep Cleaning Price' : 'Base cleaning',
        value: formatUsd(p.basePrice, { forceCents: true }),
      });
      for (const extra of p.selectedExtras) {
        lines.push({ label: extra.label, value: `+${formatUsd(extra.charge, { forceCents: true })}` });
      }
      if (p.roundingAdjustment !== 0) {
        lines.push({
          label: 'Rounded Down to Nearest $5',
          value: `${p.roundingAdjustment < 0 ? '\u2212' : '+'}${formatUsd(Math.abs(p.roundingAdjustment), { forceCents: true })}`,
        });
      }
    }
    if (p.discount) {
      lines.push({
        label: p.discount.source === 'campaign' ? 'SPARKLE15 Discount' : p.discount.label,
        value: `\u2212${formatUsd(Math.abs(p.discount.amount), { forceCents: true })}`,
      });
    }
    if (p.globalFactor !== 1) {
      lines.push({
        label: `Estimate calibration adjustment (\u00d7${p.globalFactor.toFixed(2)})`,
        value: `${p.globalAdjustment < 0 ? '\u2212' : '+'}${formatUsd(Math.abs(p.globalAdjustment), { forceCents: true })}`,
      });
    }
    if (p.travelAdjustment > 0) {
      lines.push({ label: 'Travel', value: formatUsd(p.travelAdjustment, { forceCents: true }) });
    }
    lines.push({
      label: 'Sales tax',
      value:
        tax.treatment === 'not_taxable'
          ? formatUsd(0, { forceCents: true })
          : tax.mayApply
            ? 'Calculated after address verification'
            : '—',
    });
    lines.push({
      label: partial
        ? 'BASE TOTAL — CUSTOM EXTRAS PENDING'
        : firstVisit
          ? 'FIRST VISIT TOTAL'
          : 'ESTIMATED TOTAL',
      value: formatUsd(p.subtotal, { forceCents: true }),
      strong: true,
    });
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
    if (result.status === 'invalid') {
      pricePreview.hidden = true;
      pricePreviewLines.innerHTML = '';
      pricePreviewNote.textContent = '';
      return;
    }
    if (result.status === 'custom_confirmation_required') {
      const lines = priceLines(result);
      pricePreview.hidden = lines.length === 0;
      fillLines(pricePreviewLines, lines);
      pricePreviewNote.textContent = lines.length > 0
        ? `${result.message ?? 'This one is confirmed personally with you.'} The figures above are the calculated base and priced extras only; custom-quoted extras are not included. This is not a payable total.`
        : result.message ?? 'This one is confirmed personally with you.';
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
  function addSummaryRow(
    container: HTMLElement | null,
    label: string,
    value: string,
    className = '',
  ): void {
    if (!container || !value) return;
    const item = document.createElement('li');
    if (className) item.className = className;
    const term = document.createElement('span');
    term.textContent = label;
    const detail = document.createElement('strong');
    detail.textContent = value;
    item.append(term, detail);
    container.appendChild(item);
  }

  /** One titled group inside the request summary (Cleaning / Schedule / Location). */
  function summaryGroup(title: string, target: HTMLElement): HTMLElement {
    const group = document.createElement('div');
    group.className = 'summary-group';
    const heading = document.createElement('p');
    heading.className = 'summary-group__title';
    heading.textContent = title;
    const list = document.createElement('ul');
    list.className = 'summary-group__rows';
    group.append(heading, list);
    target.appendChild(group);
    return list;
  }

  function addressConfirmed(): boolean {
    const submission = submissionAddress();
    if (submission.street.trim().length < 5) return false;
    const precision = submission.location?.precision;
    return (
      submission.location !== null &&
      precision !== 'street' &&
      precision !== 'approximate' &&
      /\d/.test(submission.street)
    );
  }

  function clientPaymentEligible(): boolean {
    return latestQuote?.travelVerified === true && addressConfirmed();
  }

  function payNowLabel(): string {
    if (acceptedPaymentAmount !== null) return `Pay ${formatUsd(acceptedPaymentAmount)} Securely`;
    return paymentRetryAvailable
      ? 'Try Secure Payment Again'
      : 'Pay Now and Reserve This Cleaning';
  }

  function setPayNowBusy(busy: boolean): void {
    paymentBusy = busy;
    if (!payNowButton) return;
    payNowButton.disabled = busy;
    payNowButton.setAttribute('aria-busy', busy ? 'true' : 'false');
    payNowButton.textContent = busy ? 'Preparing Secure Checkout...' : payNowLabel();
  }

  function syncPaymentAvailability(hasQuote: boolean): void {
    const eligible = paymentEnabled && !paymentBlocked && hasQuote && clientPaymentEligible();
    const canOfferVerification =
      hasQuote && paymentEnabled && !paymentBlocked && !addressConfirmed();
    if (giftField) giftField.hidden = !eligible;
    if (payNowButton) {
      payNowButton.hidden = !eligible;
      if (!eligible) {
        payNowButton.setAttribute('aria-busy', 'false');
        payNowButton.textContent = payNowLabel();
      } else if (!paymentBusy) {
        payNowButton.textContent = payNowLabel();
      }
    }
    if (submitButton) {
      submitButton.classList.toggle('btn--primary', !eligible);
      submitButton.classList.toggle('btn--secondary', eligible);
      submitButton.classList.add('btn--large');
      submitButton.classList.remove('btn--small');
    }
    if (verifyAddressButton) verifyAddressButton.hidden = !canOfferVerification;
    if (paymentUnavailable) {
      paymentUnavailable.hidden = !hasQuote || eligible || canOfferVerification || (paymentEnabled && !paymentBlocked);
    }
    if (!paymentNote) return;
    if (!hasQuote) {
      paymentNote.textContent = '';
      return;
    }
    if (eligible) {
      paymentNote.textContent =
        'Pay now to reserve this cleaning. If required photos are still outstanding, we will mark the booking pending photos.';
      return;
    }
    if (canOfferVerification) {
      paymentNote.textContent =
        'Verify the service address to unlock secure payment. You can also request to reserve and pay later.';
      return;
    }
    if (addressReviewRequired) {
      paymentNote.textContent =
        "We'll confirm the exact property and payment options with you before charging anything.";
      return;
    }
    paymentNote.textContent =
      "Request to reserve and we'll confirm any outstanding detail with you.";
  }
  function maybeRevealEstimate(): void {
    if (!reservationSummary) return;
    if (currentStep !== steps.length || !latestQuote) {
      finalRevealPlayed = false;
      cancelEstimateReveal(estimateReveal, reservationSummary);
      return;
    }
    reservationSummary.hidden = false;
    // The reveal plays once per visit to the final step. A consent checkbox or
    // eligibility change must update the visible price in place — it must never
    // restart the calculating animation or hide the finished quote again.
    if (finalRevealPlayed) {
      cancelEstimateReveal(estimateReveal, reservationSummary);
      return;
    }
    finalRevealPlayed = true;
    void playEstimateReveal({ reveal: estimateReveal, target: reservationSummary });
  }

  function appointmentDateLabel(date: string): string {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return '';
    const parsed = new Date(`${date}T12:00:00Z`);
    if (!Number.isFinite(parsed.getTime())) return '';
    return new Intl.DateTimeFormat('en-US', {
      timeZone: 'UTC',
      weekday: 'long',
      month: 'long',
      day: 'numeric',
    }).format(parsed);
  }

  function updateAppointmentSummary(): void {
    const dateEl = form.querySelector<HTMLElement>('[data-appointment-date]');
    const timeEl = form.querySelector<HTMLElement>('[data-appointment-time]');
    const date = textValue('preferredDate') ?? '';
    const time = textValue('preferredTime') ?? '';
    if (dateEl) {
      dateEl.textContent = date
        ? appointmentDateLabel(date)
        : 'Choose a date in step 1';
    }
    if (timeEl) {
      timeEl.textContent = time
        ? `Preferred start: ${time} — confirmed after our team reviews your request.`
        : 'No specific start time selected — we will confirm one with you.';
    }
  }

  function renderReservationSummary(result: EstimateResult): void {
    if (!reservationSummary) return;
    const hasQuote = result.status === 'estimated' && latestQuote !== null;
    syncPaymentAvailability(hasQuote);
    if (bookingCalendar) {
      const bookingContext = submissionAddress();
      bookingCalendar.setContext({
        ...(bookingContext.location
          ? { lat: bookingContext.location.lat, lng: bookingContext.location.lng }
          : {}),
        ...(bookingContext.zip ? { zip: bookingContext.zip } : {}),
      });
    }
    updateAppointmentSummary();
    updatePhotoSummary();
    reservationSummary.hidden = !hasQuote;
    if (submitButton) {
      submitButton.textContent = requestAlreadySent
        ? 'Request Received'
        : 'Request to Reserve This Cleaning (Pay Later)';
      if (requestAlreadySent) submitButton.disabled = true;
    }
    if (!hasQuote || !latestQuote) {
      if (reserveCall) reserveCall.hidden = !phone;
      if (reserveText) reserveText.hidden = !phone || !business.flags.smsEnabled;
      return;
    }

    const input = gatherInput();
    // Verified travel wording requires BOTH a live route and a confirmed
    // street address; a bare GPS pin, an approximate ZIP-area pin or a bare
    // ZIP keeps the preliminary copy.
    const summarySubmission = submissionAddress();
    const travelFullyVerified =
      latestQuote.travelVerified &&
      summarySubmission.location !== null &&
      summarySubmission.street.trim().length >= 5 &&
      summarySubmission.location.precision !== 'approximate' &&
      summarySubmission.location.precision !== 'street';
    if (reservationPrice) reservationPrice.textContent = formatUsd(latestQuote.amount);
    if (reservationPriceSuffix) {
      reservationPriceSuffix.textContent = result.ongoing ? 'First Visit' : '';
    }
    if (reservationOngoing) {
      if (result.ongoing) {
        const rhythm =
          FREQUENCY_RHYTHMS[result.ongoing.frequency] ?? result.ongoing.frequency;
        reservationOngoing.hidden = false;
        reservationOngoing.textContent = `${formatUsd(result.ongoing.perVisitPrice)} — ${rhythm.charAt(0).toUpperCase()}${rhythm.slice(1)} Thereafter`;
      } else {
        reservationOngoing.hidden = true;
        reservationOngoing.textContent = '';
      }
    }
    if (reservationEyebrow) reservationEyebrow.textContent = 'Your Cleaning Estimate';
    if (reservationReference) {
      reservationReference.hidden = false;
      reservationReference.textContent = `Estimate reference ${latestQuote.reference}`;
    }
    if (reservationValidity) {
      reservationValidity.hidden = true;
      reservationValidity.textContent = '';
    }
    if (reservationQualification) {
      reservationQualification.textContent = travelFullyVerified
        ? 'Travel-inclusive proposed price — based on the driving distance to your confirmed location.'
        : 'Preliminary proposed price — travel is estimated and Sparkling Standard confirms your location and final price before booking.';
    }

    if (priceBreakdown) fillLines(priceBreakdown, priceLines(result));

    if (reservationScope) {
      reservationScope.innerHTML = '';

      // Grouped, readable request details (owner-directed summary
      // redesign): related rows sit together, and long values like the
      // service address get the full row width instead of wrapping in a
      // cramped column.
      const cleaningRows = summaryGroup('Cleaning details', reservationScope);
        addSummaryRow(
          cleaningRows,
          'Cleaning type',
          input.serviceType ? SERVICE_LABELS[input.serviceType as ServiceType] : '',
        );
        addSummaryRow(
          cleaningRows,
          'Frequency',
          input.frequency ? FREQUENCY_LABELS[input.frequency as keyof typeof FREQUENCY_LABELS] : '',
        );
        if (requiresInitialDeepClean()) {
          addSummaryRow(cleaningRows, 'First visit', 'Deep Cleaning (required)');
        }
        if (result.ongoing) {
          addSummaryRow(
            cleaningRows,
            'Ongoing visits',
            `${formatUsd(result.ongoing.perVisitPrice)} per ${FREQUENCY_RHYTHMS[result.ongoing.frequency]} visit`,
          );
        }
        const homeParts = [
          input.propertyType ? input.propertyType.charAt(0).toUpperCase() + input.propertyType.slice(1) : '',
          input.squareFeet ? `${input.squareFeet.toLocaleString()} sqft` : '',
          input.bedrooms !== undefined ? `${input.bedrooms} bed` : '',
          input.fullBaths !== undefined
            ? `${input.fullBaths} full bath${input.fullBaths === 1 ? '' : 's'}${input.halfBaths ? ` + ${input.halfBaths} half` : ''}`
            : '',
        ].filter(Boolean);
        addSummaryRow(cleaningRows, 'Home', homeParts.join(' · '));
        addSummaryRow(
          cleaningRows,
          'Condition',
          input.condition ? CONDITION_LABELS[input.condition] : '',
        );
        addSummaryRow(cleaningRows, 'Last professional clean', input.lastClean ? input.lastClean.replaceAll('_', ' ') : '');
        addSummaryRow(cleaningRows, 'Pets', input.pets ? input.pets.replaceAll('_', ' ') : '');
        addSummaryRow(
          cleaningRows,
          'Extras',
          result.addons.length > 0 ? result.addons.map((addon) => addon.label).join(', ') : 'None',
        );

        const scheduleRows = summaryGroup('Schedule', reservationScope);
        const preferredDate = textValue('preferredDate') ?? '';
        addSummaryRow(
          scheduleRows,
          'Preferred date',
          preferredDate ? appointmentDateLabel(preferredDate) : 'To be confirmed',
        );
        addSummaryRow(
          scheduleRows,
          'Preferred start',
          textValue('preferredTime') ?? 'We will confirm a time with you',
        );
        const holdId = textValue('booking_hold_id');
        const holdExpiry = textValue('booking_hold_expires_at');
        addSummaryRow(
          scheduleRows,
          'Status',
          holdId && holdExpiry
            ? `Temporary hold until ${holdExpiry.slice(11, 16)} Central — not confirmed`
            : 'Pending owner confirmation',
        );
        const editButton = document.createElement('button');
        editButton.type = 'button';
        editButton.className = 'btn btn--ghost btn--small';
        editButton.textContent = 'Edit date or time';
        editButton.addEventListener('click', () => showStep(1));
        scheduleRows.appendChild(editButton);

        const locationRows = summaryGroup('Location', reservationScope);
        addSummaryRow(
          locationRows,
          'Service address',
          location ? formatLocationLine(location) : `ZIP ${input.zip ?? ''}`,
          'summary-row--wide',
        );
        addSummaryRow(
          locationRows,
          'Travel',
          travelFullyVerified
            ? `Confirmed route${result.travel.oneWayMiles !== null ? ` — ${Math.round(result.travel.oneWayMiles)} mi one way` : ''}`
            : 'Estimated — confirmed before booking',
        );
      }

    // Call / text actions carry the estimate context the customer is looking at.
    if (reserveCall) {
      reserveCall.hidden = !phone;
      if (phone) reserveCall.href = phone.href;
    }
    if (reserveText) {
      reserveText.hidden = !phone || !business.flags.smsEnabled;
      if (phone) {
        const ongoing = result.ongoing;
        const pricePhrase = ongoing
          ? `a proposed first-visit price of ${formatUsd(latestQuote.amount)}, then ${formatUsd(ongoing.perVisitPrice)} per ${FREQUENCY_RHYTHMS[ongoing.frequency]} visit`
          : `a proposed price of $${latestQuote.amount}`;
        const body = `Hi! I'd like to reserve a cleaning. My estimate reference is ${latestQuote.reference} with ${pricePhrase}${location ? ` at ${formatLocationLine(location)}` : ''}. Sparkling Standard will confirm the final price.`;
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

    // The final reservation step deliberately has no Back control: the two
    // reservation choices are the only actions in that area.
    if (backButton) backButton.hidden = currentStep === 1 || currentStep === steps.length;
    if (nextButton) nextButton.hidden = currentStep === steps.length;
    if (finalActions) finalActions.hidden = currentStep !== steps.length;
    if (submitButton) {
      submitButton.hidden = currentStep !== steps.length;
      if (currentStep === steps.length) {
        submitButton.textContent = 'Request to Reserve This Cleaning (Pay Later)';
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
  const REQUIRED_FIELD_MESSAGES: Record<string, string> = {
    propertyType: 'Choose the type of property you need cleaned.',
    squareFeet: 'Enter the approximate square footage.',
    bedrooms: 'Tell us how many bedrooms the home has.',
    fullBaths: 'Tell us how many full bathrooms the home has.',
    halfBaths: 'Tell us how many half bathrooms the home has.',
    frequency: 'Select how often you would like cleaning.',
    lastClean: 'Choose when the home was last professionally cleaned.',
    pets: 'Tell us whether there are pets in the home.',
    beds: 'Tell us how many beds the rental has.',
    preferredDate: 'Choose a preferred date for the cleaning.',
    arrivalPreference: 'Choose the arrival window that works best.',
    name: 'Enter your name.',
    phone: 'Enter a phone number so we can confirm your estimate.',
    email: 'Enter an email address so we can send your confirmation.',
  };
  const NUMBER_FIELD_MESSAGES: Record<string, string> = {
    squareFeet: 'Enter a square footage between 200 and 20,000.',
    bedrooms: 'Enter a bedroom count between 0 and 12.',
    fullBaths: 'Enter a full-bathroom count between 0 and 12.',
    halfBaths: 'Enter a half-bathroom count between 0 and 12.',
    beds: 'Enter a bed count between 1 and 30.',
  };
  const errorSummary = form.querySelector<HTMLElement>('[data-error-summary]');
  const errorSummaryList = form.querySelector<HTMLElement>('[data-error-summary-list]');

  function keyOf(field: HTMLElement): string {
    const group = field.getAttribute('data-group-error');
    if (group && field instanceof HTMLFieldSetElement) return `group-${group}`;
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
    } else if (control instanceof HTMLFieldSetElement) {
      control.setAttribute('aria-invalid', 'true');
      control.setAttribute('aria-describedby', el.id);
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
    } else if (control instanceof HTMLFieldSetElement) {
      control.removeAttribute('aria-invalid');
      control.removeAttribute('aria-describedby');
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
    // Manual fields never block a GPS-based request; the confirmed device pin
    // is the destination source.
    if (
      submission.method === 'gps' &&
      (field.id === 'est-address' ||
        field.id === 'est-zip' ||
        field.id === 'est-address-city' ||
        field.id === 'est-address-state')
    ) {
      return null;
    }
    const value = field.value.trim();
    if (field instanceof HTMLInputElement && field.type === 'checkbox') {
      return field.required && !field.checked
        ? field.dataset.errorRequired ?? 'Please confirm this requirement to continue.'
        : null;
    }
    if (field.id === 'est-zip') {
      return /^\d{5}(-\d{4})?$/.test(value) ? null : 'Please enter a valid ZIP code.';
    }
    if (field.id === 'est-address') {
      return value === '' ? field.dataset.errorRequired ?? 'Please enter your street address.' : null;
    }
    const required = field.hasAttribute('required') || field.dataset.errorRequired !== undefined;
    if (value === '') {
      return required
        ? REQUIRED_FIELD_MESSAGES[field.name] ??
            field.dataset.errorRequired ??
            'Please complete this field.'
        : null;
    }
    if (field instanceof HTMLInputElement && field.type === 'email' && !field.validity.valid) {
      return 'Enter a complete email address with an @ and a domain.';
    }
    if (field instanceof HTMLInputElement && field.type === 'tel' && value.replace(/\D/g, '').length < 10) {
      return 'Enter a phone number with at least 10 digits.';
    }
    if (field instanceof HTMLInputElement && field.type === 'number' && !field.validity.valid) {
      return NUMBER_FIELD_MESSAGES[field.name] ?? field.dataset.errorRange ?? 'Please enter a valid number.';
    }
    if (field instanceof HTMLInputElement && field.type === 'date') {
      // The configurable advance-reservation window (no priority pricing —
      // every customer sees the same window).
      const min = field.min;
      const max = field.max;
      if (value && ((min && value < min) || (max && value > max))) {
        return `Please choose a date from today up to ${schedulingConfig.advanceReservationDays} days ahead.`;
      }
      if (!field.validity.valid) return 'Please choose a preferred date.';
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
    const scrollTarget = controlFor(field);
    const focusTarget =
      field instanceof HTMLInputElement && field.type === 'radio' ? field : scrollTarget;
    focusTarget.focus?.({ preventScroll: true });
    scrollTarget.scrollIntoView({
      block: 'center',
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
    });
  }

  function validateStep(step: number): boolean {
    attemptedSteps.add(step);
    const section = steps[step - 1];
    if (!section) return true;
    const errors: Array<{ field: HTMLElement; message: string }> = [];

    // Radio groups (service type, condition).
    for (const group of section.querySelectorAll<HTMLElement>('fieldset[data-group-error]')) {
      if (group.closest('[hidden]')) continue;
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

    if (step === 1) {
      const calendar = form.querySelector<HTMLElement>('[data-booking-calendar]');
      const dateField = form.querySelector<HTMLInputElement>('#est-date');
      const preferredDate = textValue('preferredDate') ?? '';
      const outOfRange =
        dateField !== null &&
        preferredDate !== '' &&
        ((dateField.min && preferredDate < dateField.min) ||
          (dateField.max && preferredDate > dateField.max));
      const errorTarget = dateField ?? calendar;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(preferredDate) || outOfRange) {
        if (errorTarget) {
          const message = outOfRange
            ? `Please choose a date from today up to ${schedulingConfig.advanceReservationDays} days ahead.`
            : 'Choose a preferred date to continue.';
          setFieldError(errorTarget, message);
          errors.push({ field: errorTarget, message });
        }
      } else if (errorTarget) {
        clearFieldError(errorTarget);
      }
    }

    if (step === 1) {
      const booking = form.querySelector<HTMLElement>('[data-booking-calendar]');
      const selection = bookingCalendar?.selection();
      if (!selection?.timeLabel) {
        const message = 'Choose a preferred appointment time to continue.';
        if (booking) {
          setFieldError(booking, message);
          errors.push({ field: booking, message });
        }
      } else if (booking) {
        clearFieldError(booking);
      }
    }
    for (const field of stepFields(step)) {
      if (field.closest('[hidden]')) continue;
      if (field instanceof HTMLInputElement && field.type === 'radio') continue;
      // The calendar's hidden date is validated above (format + window); the
      // generic hidden-input pass would otherwise clear that error.
      if (field.id === 'est-date') continue;
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
      if (!submission.location) {
        const mapCard = form.querySelector<HTMLElement>('[data-address-map]');
        const confirm = form.querySelector<HTMLElement>('[data-address-confirm]');
        const message =
          submission.method === 'gps'
            ? 'Please confirm your current location on the map, or enter the address manually.'
            : 'Please confirm the map location, or adjust the pin if it is not exact.';
        if (mapCard && !mapCard.hidden && confirm) {
          setFieldError(confirm, message);
          errors.push({ field: confirm, message });
        } else if (submission.method === 'gps') {
          const gpsButton = form.querySelector<HTMLElement>('[data-address-gps]');
          if (gpsButton) {
            setFieldError(gpsButton, message);
            errors.push({ field: gpsButton, message });
          }
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
        if (group.closest('[hidden]')) continue;
        const name = group.dataset.groupError ?? '';
        if (!form.querySelector(`input[name="${name}"]:checked`)) return false;
      }
      for (const field of stepFields(index)) {
        if (field.closest('[hidden]')) continue;
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

  // ── Conditional fields and owner policies ────────────────────────────────
  function requiresInitialDeepClean(): boolean {
    return radioValue('serviceType') === 'standard' && RECURRING_FREQUENCIES.has(textValue('frequency') ?? '');
  }

  /**
   * Service-driven questionnaire (owner-directed estimator audit,
   * 2026-10-23): the selected service decides which questions exist. The
   * frequency rhythm is a Residential-house-cleaning question only — deep,
   * move-in/move-out and STR turnovers are one-time services, so the control
   * is hidden and the value is normalized to one_time (never left stale from
   * a previously selected service). STR-only fields (beds) are likewise
   * cleared when the customer switches away.
   */
  function syncConditionalFields(): void {
    const service = radioValue('serviceType') as EstimateInput['serviceType'] | undefined;
    const isStr = service === 'str_turnover';
    for (const wrapper of form.querySelectorAll<HTMLElement>('[data-str-only]')) {
      wrapper.hidden = !isStr;
    }
    const bedsInput = form.querySelector<HTMLInputElement>('input[name="beds"]');
    if (bedsInput) {
      bedsInput.required = isStr;
      if (!isStr && bedsInput.value !== '') bedsInput.value = '';
    }

    const frequencyField = form.querySelector<HTMLElement>('[data-frequency-field]');
    const frequencySelect = form.querySelector<HTMLSelectElement>('#est-frequency');
    const asksFrequency = !service || serviceAsksFrequency(service);
    if (frequencyField) {
      frequencyField.hidden = !asksFrequency;
    }
    if (frequencySelect) {
      frequencySelect.required = asksFrequency;
      if (!asksFrequency && frequencySelect.value !== 'one_time') {
        frequencySelect.value = 'one_time';
        clearFieldError(frequencySelect);
      }
    }

    const deepRequired = requiresInitialDeepClean();
    for (const wrapper of form.querySelectorAll<HTMLElement>('[data-recurring-deep]')) {
      wrapper.hidden = !deepRequired;
    }
    if (deepRequired && !deepNoticeShown) {
      deepNoticeShown = true;
      requestAnimationFrame(() => {
        const notice = form.querySelector<HTMLElement>('[data-recurring-deep]');
        if (notice) {
          window.scrollTo({
            top: notice.getBoundingClientRect().top + window.scrollY - 96,
            behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
          });
        }
      });
    } else if (!deepRequired) {
      deepNoticeShown = false;
    }
    const acknowledged = form.querySelector<HTMLInputElement>('input[name="initialDeepCleanAcknowledged"]');
    if (acknowledged) {
      acknowledged.required = deepRequired;
      if (!deepRequired) acknowledged.checked = false;
    }

    // Community Support Cleaning is a RESIDENTIAL pathway, never offered inside
    // the turnover engine and never priced differently by category.
    const supportiveSection = form.querySelector<HTMLElement>('[data-supportive-section]');
    if (supportiveSection) supportiveSection.hidden = engine === 'str' || isStr;
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
    autoConfirm: false,
    onChange: (next) => {
      // Editing the address invalidates any previous route instantly, so a
      // stale ZIP/centroid route can never price a different destination.
      routed = undefined;
      routedKey = null;
      lastTravelKey = '';
      const previousKey = location ? locationKey(location.lat, location.lng) : null;
      location = next;
      const nextKey = next ? locationKey(next.lat, next.lng) : null;
      recalc();
      // Any address edit invalidates the previous route. Re-run the lookup
      // even when the coordinates are unchanged: a corrected ZIP or a
      // background resolution can change the travel key without moving the
      // pin. lookupTravel dedupes by key.
      if (previousKey !== nextKey || routed === undefined) {
        void lookupTravel();
      }
      if (!addressVerificationPending) {
        addressReviewRequired = Boolean(
          next && (next.precision === 'approximate' || next.precision === 'street'),
        );
      }
      const current = submissionAddress();
      bookingCalendar?.setContext({
        ...(next ? { lat: next.lat, lng: next.lng } : {}),
        ...(current.zip ? { zip: current.zip } : {}),
      });
    },
    onConfirm: () => {
      if (!addressVerificationPending) return;
      const exact = addressConfirmed();
      addressVerificationPending = false;
      addressReviewRequired = !exact;
      if (status) {
        status.dataset.state = 'info';
        status.textContent = exact
          ? 'Address confirmed. Returning to your estimate so we can finalize your price…'
          : 'We confirmed the general area, but not the exact property. Returning to your estimate so you can reserve without online payment.';
      }
      window.setTimeout(() => showStep(steps.length), 250);
    },
  });

  streetInputEl?.addEventListener('input', () => revealAddressDetails(false));
  streetInputEl?.addEventListener('change', () => revealAddressDetails(true));

  // ── Fresh start (no drafts are ever stored) ───────────────────────────────
  const calendarRoot = form.querySelector<HTMLElement>('[data-booking-calendar]');
  if (calendarRoot) {
    const calendar = initBookingCalendar(calendarRoot, () => {
      if (bookingCalendar?.selection()?.timeLabel) revealAddressCard();
      bookingFinalizedKey = '';
      bookingFinalizeNote = '';
      updateAppointmentSummary();
      const alternatives = form.querySelector<HTMLElement>('[data-booking-alternatives]');
      if (alternatives) {
        alternatives.hidden = true;
        alternatives.innerHTML = '';
      }
    });
    bookingCalendar = calendar;
    if (calendar) {
      const bookingContext = submissionAddress();
      calendar.setContext({
        ...(bookingContext.location
          ? { lat: bookingContext.location.lat, lng: bookingContext.location.lng }
          : {}),
        ...(bookingContext.zip ? { zip: bookingContext.zip } : {}),
      });
    }
  }
  verifyAddressButton?.addEventListener('click', async () => {
    addressVerificationPending = true;
    verifyAddressButton.disabled = true;
    verifyAddressButton.setAttribute('aria-busy', 'true');
    verifyAddressButton.textContent = 'Opening Address Verification…';
    showStep(1);
    if (status) {
      status.dataset.state = 'info';
      status.textContent =
        'Verify your full service address and confirm the map pin. We will return you to your final estimate automatically.';
    }
    if (!addressFinder) {
      addressVerificationPending = false;
      verifyAddressButton.disabled = false;
      verifyAddressButton.setAttribute('aria-busy', 'false');
      verifyAddressButton.textContent = 'Verify Address & Finalize Price';
      if (status) {
        status.dataset.state = 'error';
        status.textContent =
          'Address verification could not start. Please enter your full address on step 1, then return to the final step.';
      }
      return;
    }
    try {
      const outcome = await addressFinder.verifyAddress();
      if (outcome === 'resolved') return;
      addressVerificationPending = false;
      if (outcome === 'unresolved') {
        addressReviewRequired = true;
        if (status) {
          status.dataset.state = 'info';
          status.textContent =
            'We could not verify that exact address online. Returning to your estimate so you can reserve and have us confirm the property personally.';
        }
        window.setTimeout(() => showStep(steps.length), 250);
      }
    } finally {
      verifyAddressButton.disabled = false;
      verifyAddressButton.setAttribute('aria-busy', 'false');
      verifyAddressButton.textContent = 'Verify Address & Finalize Price';
      syncPaymentAvailability(latestQuote !== null);
    }
  });

  function resetWizard(): void {
    form.reset();
    addressFinder?.reset();
    bookingCalendar?.reset();
    if (addressCardEl) addressCardEl.hidden = true;
    if (addressDetailsEl) addressDetailsEl.hidden = true;
    syncRevealGroups(false);
    addressCardRevealed = false;
    addressDetailsRevealed = false;
    bookingFinalizedKey = '';
    bookingFinalizeNote = '';
    photosDeferred = false;
    hidePhotoGate();
    clearAllErrors();
    attemptedSteps.clear();
    location = null;
    routed = undefined;
    routedKey = null;
    lastTravelKey = '';
    travelLookupSeq += 1;
    latestResult = null;
    latestQuote = null;
    finalRevealPlayed = false;
    cancelEstimateReveal(estimateReveal, reservationSummary);
    pendingPaymentFields = null;
    acceptedPaymentAmount = null;
    paymentRetryAvailable = false;
    paymentBlocked = false;
    requestAlreadySent = false;
    addressVerificationPending = false;
    addressReviewRequired = false;
    setPayNowBusy(false);
    if (submitButton) submitButton.disabled = false;
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
    const tax = taxPresentationForService(input.serviceType);
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
      // STR turnover context (informational — never priced without the
      // owner's confirmation; the per-turnover estimate is the price).
      checkout_time: input.serviceType === 'str_turnover' ? textValue('checkoutTime') ?? '' : '',
      checkin_time: input.serviceType === 'str_turnover' ? textValue('checkinTime') ?? '' : '',
      linen_preference: input.serviceType === 'str_turnover' ? textValue('linenPreference') ?? '' : '',
      engine_type: engine,
      rental_properties: input.serviceType === 'str_turnover' ? textValue('rentalProperties') ?? '' : '',
      turnover_frequency: input.serviceType === 'str_turnover' ? textValue('turnoverFrequency') ?? '' : '',
      supportive_home: input.serviceType === 'str_turnover' ? '' : input.supportiveEligible ? 'yes' : '',
      supportive_eligible: input.serviceType === 'str_turnover' ? 'no' : input.supportiveEligible ? 'yes' : 'no',
      supportive_notes: input.serviceType === 'str_turnover' ? '' : textValue('supportiveNotes') ?? '',
      frequency: input.frequency ?? '',
      condition: input.condition ?? '',
      dirt_level: '',
      last_cleaned: input.lastClean ?? '',
      pets: input.pets ?? '',
      addons: result.addons.map((addon) => addon.label).join(', '),
      addon_ids: (input.addonIds ?? []).join(','),
      estimate_low: result.low !== null ? String(result.low) : 'custom',
      estimate_high: result.high !== null ? String(result.high) : 'custom',
      estimate_confidence: result.confidence,
      tax_status: tax.treatment,
      tax_note: tax.note,
      ...(result.status === 'estimated'
        ? {
            ...(result.pricing.discount
              ? {
                  discount_label: result.pricing.discount.label,
                  discount_amount: result.pricing.discount.amount.toFixed(2),
                }
              : {}),
            ...(result.pricing.globalFactor !== 1
              ? {
                  global_factor: result.pricing.globalFactor.toFixed(2),
                  global_adjustment: result.pricing.globalAdjustment.toFixed(2),
                }
              : {}),
          }
        : {}),
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
      preferred_time: textValue('preferredTime') ?? '',
      preferred_slot_start: textValue('preferredSlotStart') ?? '',
      preferred_slot_end: textValue('preferredSlotEnd') ?? '',
      notes: textValue('notes') ?? '',
      name: textValue('name') ?? '',
      phone: textValue('phone') ?? '',
      email: textValue('email') ?? '',
      terms_accepted: form.querySelector<HTMLInputElement>('input[name="termsAccepted"]')?.checked
        ? 'yes'
        : 'no',
      terms_version: legalTerms.termsVersion,
    };
    if (requiresInitialDeepClean()) {
      const acknowledged = form.querySelector<HTMLInputElement>('input[name="initialDeepCleanAcknowledged"]');
      fields.initial_deep_clean_acknowledged = acknowledged?.checked ? 'yes' : 'no';
    }
    // The claimed campaign code rides along as a CLAIM — the server recomputes
    // the discount itself and redemption eligibility is confirmed by the owner.
    const claimedCode = claimedPromoCode();
    if (claimedCode) fields.promotion_code = claimedCode;
    const holdId = textValue('booking_hold_id');
    const holdExpiry = textValue('booking_hold_expires_at');
    if (holdId && holdExpiry) {
      fields.booking_hold_id = holdId;
      fields.booking_hold_expires_at = holdExpiry;
    }
    if (isReservation && latestQuote) {
      fields.quoted_price = String(latestQuote.amount);
      fields.quote_reference = latestQuote.reference;
      fields.quote_config_version = latestQuote.configVersion;
      fields.quoted_range =
        result.low !== null && result.high !== null ? `$${result.low}–$${result.high}` : '';
      // P12: for a new recurring arrangement the quoted price IS the
      // first-visit total; the ongoing rhythm travels as its own labeled
      // fields so the owner email can show both without any ambiguity.
      if (result.ongoing) {
        fields.first_visit_total = String(latestQuote.amount);
        fields.ongoing_price_per_visit = String(result.ongoing.perVisitPrice);
        fields.ongoing_frequency = result.ongoing.frequency;
      }
    }
    // Customer photos (optional): private storage references only — the
    // owner views them through the signed photo endpoint, never a public URL.
    const photoKeys = photoController.keys();
    if (photoKeys) {
      fields.photo_keys = photoKeys;
      fields.photo_request_ref = photoController.requestRef;
      fields.photo_count = String(photoController.photoCount());
    }
    fields.photos_outstanding = photosOutstanding() ? 'yes' : 'no';
    const giftCode =
      form.querySelector<HTMLInputElement>('input[data-gift-code]')?.value.trim().toUpperCase() ?? '';
    if (giftCode) fields.gift_code = giftCode;
    return { ...fields, ...attributionFields() };
  }

  interface StartPaymentResult {
    ok: boolean;
    url?: string;
    error?: string;
    reason?: string;
    amount?: number;
    quotedAmount?: number;
    reference?: string;
  }

  async function startSecurePayment(
    fields: Record<string, string>,
    acceptedAmount: number | null = null,
  ): Promise<StartPaymentResult> {
    try {
      const response = await fetch('/api/estimate-checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          fields,
          returnPath: engine === 'str' ? '/estimate/str/' : '/estimate/residential/',
          ...(acceptedAmount !== null
            ? { acceptRecalculated: true, acceptedAmount }
            : {}),
        }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        url?: string;
        error?: string;
        reason?: string;
        amount?: number;
        quotedAmount?: number;
        reference?: string;
      };
      if (response.ok && data.ok && data.url) {
        window.location.assign(data.url);
        return { ok: true, url: data.url };
      }
      if (data.error) {
        console.warn('[secure-checkout]', data.error, data.reason ?? '');
      }
      return {
        ok: false,
        ...(data.error ? { error: data.error } : {}),
        ...(data.reason ? { reason: data.reason } : {}),
        ...(typeof data.amount === 'number' ? { amount: data.amount } : {}),
        ...(typeof data.quotedAmount === 'number' ? { quotedAmount: data.quotedAmount } : {}),
        ...(data.reference ? { reference: data.reference } : {}),
      };
    } catch {
      console.warn('[secure-checkout] network_unavailable');
      return { ok: false, error: 'network_unavailable' };
    }
  }

  function markRequestReceived(): void {
    requestAlreadySent = true;
    if (submitButton) {
      submitButton.disabled = true;
      submitButton.textContent = 'Request Received';
    }
  }

  function handlePaymentFailure(failure: StartPaymentResult): void {
    if (
      failure.error === 'quote_changed' &&
      typeof failure.amount === 'number' &&
      Number.isFinite(failure.amount) &&
      failure.amount > 0
    ) {
      acceptedPaymentAmount = failure.amount;
      paymentRetryAvailable = false;
      markRequestReceived();
      setPayNowBusy(false);
      syncPaymentAvailability(true);
      if (status) {
        status.dataset.state = 'info';
        const prior =
          typeof failure.quotedAmount === 'number'
            ? `The estimate showed ${formatUsd(failure.quotedAmount)}. `
            : '';
        status.textContent =
          `${prior}The secure total is now ${formatUsd(failure.amount)}. ` +
          `Click “Pay ${formatUsd(failure.amount)} Securely” to approve the recalculated total. No charge has been made.`;
      }
      return;
    }

    if (failure.error?.startsWith('gift_')) {
      paymentRetryAvailable = true;
      markRequestReceived();
      setPayNowBusy(false);
      syncPaymentAvailability(true);
      const giftMessages: Record<string, string> = {
        gift_invalid_code: 'That gift certificate code does not look right. Use the format SSGC-XXXX-XXXX.',
        gift_not_found: 'We could not find that gift certificate. Check the code and try again.',
        gift_inactive: 'That gift certificate is not active yet. It can be used once its start date arrives.',
        gift_not_active_yet: 'That gift certificate is not active yet. It can be used once its start date arrives.',
        gift_no_balance: 'That gift certificate has no remaining balance.',
        gift_insufficient_balance: 'That gift certificate does not have enough remaining balance.',
        gift_conflict: 'That gift certificate is already being used by another checkout. Try again shortly.',
        gift_ledger_not_configured: 'Gift certificate redemption is not available right now.',
        gift_commit_failed: 'The gift certificate could not be applied. No charge has been made; please try again.',
      };
      if (status) {
        status.dataset.state = 'error';
        status.textContent =
          (giftMessages[failure.error] ?? 'That gift certificate could not be applied.') +
          ' No charge has been made.';
      }
      form.querySelector<HTMLInputElement>('input[data-gift-code]')?.focus();
      return;
    }

    if (
      failure.error === 'quote_not_payable' ||
      failure.error === 'payment_not_ready' ||
      failure.error === 'email_required' ||
      failure.error === 'email_invalid'
    ) {
      paymentBlocked = true;
      acceptedPaymentAmount = null;
      paymentRetryAvailable = false;
      markRequestReceived();
      setPayNowBusy(false);
      syncPaymentAvailability(true);
      if (status) {
        status.dataset.state = 'error';
        status.textContent =
          'Your request was received, but secure payment is not available for this estimate. ' +
          'Sparkling Standard will confirm the price and payment options with you. No payment has been taken by this website.';
      }
      return;
    }

    paymentRetryAvailable = true;
    markRequestReceived();
    setPayNowBusy(false);
    syncPaymentAvailability(true);
    if (status) {
      status.dataset.state = 'error';
      status.textContent =
        'Your request was received, but secure checkout could not start right now. ' +
        'You can try payment again, or arrange payment when we confirm your appointment. No payment has been taken by this website.';
    }
  }

  async function retryPendingPayment(): Promise<void> {
    if (!pendingPaymentFields || paymentBusy) return;
    setPayNowBusy(true);
    if (status) {
      status.dataset.state = 'info';
      status.textContent = 'Opening secure checkout…';
    }
    const started = await startSecurePayment(pendingPaymentFields, acceptedPaymentAmount);
    if (!started.ok) handlePaymentFailure(started);
  }

  function renderBookingAlternatives(
    alternatives: Array<{ start: string; end: string; startLabel: string; endLabel: string }>,
    message: string,
  ): void {
    const container = form.querySelector<HTMLElement>('[data-booking-alternatives]');
    if (!container) return;
    container.innerHTML = '';
    if (alternatives.length === 0) {
      if (message && status) {
        status.dataset.state = 'info';
        status.textContent = message;
      }
      container.hidden = true;
      return;
    }
    container.hidden = false;
    const intro = document.createElement('p');
    intro.className = 'booking-alternatives__title';
    intro.textContent = 'Choose an available time';
    const copy = document.createElement('p');
    copy.className = 'booking-alternatives__copy';
    copy.textContent = message;
    const list = document.createElement('div');
    list.className = 'booking-alternatives__list';
    for (const slot of alternatives) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'booking-calendar__time';
      button.textContent = slot.startLabel;
      button.addEventListener('click', () => {
        bookingCalendar?.selectSlot(slot.start, slot.end, slot.startLabel);
        bookingFinalizedKey = '';
        container.hidden = true;
        container.innerHTML = '';
        updateAppointmentSummary();
        if (status) {
          status.dataset.state = 'success';
          status.textContent =
            'Preferred time updated. Send your request to continue — the appointment still requires owner approval.';
        }
      });
      list.appendChild(button);
    }
    container.append(intro, copy, list);
  }

  async function finalizeBookingForSubmit(result: EstimateResult): Promise<{
    blockedPayment: boolean;
    note: string;
  }> {
    if (!bookingCalendar || result.status !== 'estimated' || !latestQuote) {
      return { blockedPayment: false, note: '' };
    }
    const submission = submissionAddress();
    const fallback = submission.location ? null : zipReferenceFor(submission.zip);
    const destination = submission.location
      ? { lat: submission.location.lat, lng: submission.location.lng }
      : fallback
        ? { lat: fallback.lat, lng: fallback.lng }
        : null;
    if (!destination) {
      return { blockedPayment: false, note: 'Your preferred date is saved; we will confirm the time with you.' };
    }
    const durationMinutes = Math.max(
      bookingConfig.minimumJobMinutes,
      Math.ceil((result.pricing.totalLaborHours * 60) / bookingConfig.defaultCrewSize),
    );
    const key = [
      textValue('preferredDate') ?? '',
      textValue('preferredTime') ?? '',
      String(durationMinutes),
      destination.lat.toFixed(5),
      destination.lng.toFixed(5),
    ].join('|');
    if (key === bookingFinalizedKey) {
      return { blockedPayment: false, note: bookingFinalizeNote };
    }
    bookingFinalizedKey = key;
    const outcome = await bookingCalendar.finalize({
      durationMinutes,
      destination,
      reference: latestQuote.reference,
      location: submission.location
        ? formatLocationLine(submission.location)
        : `ZIP ${submission.zip}`,
    });
    bookingFinalizeNote = outcome.message;
    renderBookingAlternatives(outcome.alternatives, outcome.message);
    updateAppointmentSummary();
    return {
      blockedPayment: outcome.status === 'alternatives',
      note: outcome.message,
    };
  }

  async function handleSubmit(event?: Event, paymentChoice: 'reserve' | 'pay_now' = 'reserve'): Promise<void> {
    event?.preventDefault();
    if (paymentChoice === 'pay_now' && pendingPaymentFields) {
      await retryPendingPayment();
      return;
    }
    if (!validateStep(currentStep)) return;
    if (photosOutstanding() && !photosDeferred) {
      showPhotoGate('final', paymentChoice);
      return;
    }
    if (photoController.isUploading()) {
      if (status) {
        status.dataset.state = 'info';
        status.textContent = 'Please wait for the photos to finish uploading before sending your request.';
      }
      return;
    }

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

    if (currentStep === steps.length) {
      if (status) {
        status.dataset.state = 'info';
        status.textContent = 'Checking your preferred time against the live schedule…';
      }
      const finalized = await finalizeBookingForSubmit(result);
      if (paymentChoice === 'pay_now' && finalized.blockedPayment) {
        setPayNowBusy(false);
        if (status) {
          status.dataset.state = 'info';
          status.textContent =
            'That start time is no longer available with your final details. Choose an available time above, or reserve without paying and we will help.';
        }
        return;
      }
    }

    if (submitButton) submitButton.disabled = true;
    if (paymentChoice === 'pay_now') setPayNowBusy(true);
    if (status) {
      status.dataset.state = 'info';
      status.textContent =
        paymentChoice === 'pay_now'
          ? 'Saving your request and preparing secure checkout…'
          : result.status === 'estimated' && latestQuote
            ? 'Sending your reservation request…'
            : 'Sending your request…';
    }

    const fields = buildSubmissionFields(result);
    fields.payment_choice = paymentChoice === 'pay_now' ? 'pay_now' : 'reserve';
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
      if (paymentChoice === 'pay_now') setPayNowBusy(false);
      else if (payNowButton) payNowButton.disabled = false;
      if (status) {
        status.dataset.state = 'error';
        status.textContent = `${failureCopy(outcome.reason as FailureReason, contact)} Your answers are still on this page.`;
      }
      return;
    }

    const payload = { service_type: fields.service_type, journey: 'residential' as const };
    recordConversion('cleaning_request_submit', payload);
    if (fields.promotion_code) {
      const code = configuredCampaignCode();
      track('promotion_request_submit', {
        ...(code ? { code } : {}),
        ...(fields.service_type ? { service_type: fields.service_type } : {}),
      });
    }
    if (fields.preferred_date) {
      recordConversion('booking_request', { service_type: fields.service_type });
    }
    // The server's verified attachment count is authoritative; never tell the
    // customer a photo was attached when the server could not confirm it.
    fields.photo_count = String(outcome.photoCount ?? 0);
    if ((outcome.photoCount ?? 0) === 0) {
      delete fields.photo_keys;
      delete fields.photo_request_ref;
    }
    // Keep a single-use, sanitized copy so the thank-you page can show the
    // customer exactly what they submitted.
    saveSubmissionSummary(fields);

    if (paymentChoice === 'pay_now') {
      pendingPaymentFields = { ...fields };
      markRequestReceived();
      if (status) {
        status.dataset.state = 'info';
        status.textContent = 'Request received. Opening secure checkout…';
      }
      const started = await startSecurePayment(pendingPaymentFields, acceptedPaymentAmount);
      if (!started.ok) handlePaymentFailure(started);
      return;
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
  async function advanceStep(): Promise<void> {
    if (currentStep === 1 && addressFinder) {
      await addressFinder.verifyAddress();
      const submission = submissionAddress();
      bookingCalendar?.setContext({
        ...(submission.location
          ? { lat: submission.location.lat, lng: submission.location.lng }
          : {}),
        ...(submission.zip ? { zip: submission.zip } : {}),
      });
    }
    if (syncRevealGroups(true) > 0) return;
    if (!validateStep(currentStep)) return;
    if (currentStep === 3 && photosOutstanding() && !photosDeferred) {
      if (photoController.isUploading()) {
        const photoStatus = form.querySelector<HTMLElement>('[data-photo-status]');
        if (photoStatus) {
          photoStatus.textContent = 'Please wait for the photo upload to finish before continuing.';
          photoStatus.dataset.state = 'info';
        }
        return;
      }
      showPhotoGate('step3');
      return;
    }
    const serviceType = currentServiceType();
    track('estimate_step', {
      step: currentStep,
      ...(serviceType ? { service_type: serviceType } : {}),
    });
    showStep(currentStep + 1);
  }

  nextButton?.addEventListener('click', () => {
    void advanceStep();
  });

  backButton?.addEventListener('click', () => {
    showStep(currentStep - 1);
  });

  form.querySelectorAll<HTMLButtonElement>('[data-appointment-edit]').forEach((button) => {
    button.addEventListener('click', () => showStep(1));
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

  for (const offer of bundleOffers) {
    offer.querySelector<HTMLButtonElement>('[data-bundle-add]')?.addEventListener('click', () => {
      const required = (offer.dataset.bundleRequired ?? '').split(',').filter(Boolean);
      for (const id of required) {
        const input = form.querySelector<HTMLInputElement>(`input[name="addons"][value="${id}"]`);
        if (input && !input.checked) {
          input.checked = true;
          input.dispatchEvent(new Event('change', { bubbles: true }));
          input.dispatchEvent(new Event('input', { bubbles: true }));
        }
      }
      recalc();
    });
  }

  verifyAddressButton?.addEventListener('click', () => {
    showStep(1);
    requestAnimationFrame(() => {
      const finder = form.querySelector<HTMLElement>('[data-address-finder]');
      if (finder) {
        window.scrollTo({
          top: finder.getBoundingClientRect().top + window.scrollY - 96,
          behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
        });
      }
      form.querySelector<HTMLButtonElement>('[data-address-resolve]')?.focus();
    });
  });

  payNowButton?.addEventListener('click', () => {
    if (photosOutstanding() && !photosDeferred) {
      showPhotoGate('final', 'pay_now');
      return;
    }
    hidePhotoGate();
    void handleSubmit(undefined, 'pay_now');
  });

  photoGatePayLater?.addEventListener('click', () => {
    photosDeferred = true;
    hidePhotoGate();
    updatePhotoSummary();
    if (pendingPhotoStage === 'step3') void advanceStep();
    else void handleSubmit(undefined, pendingPhotoAction);
  });

  photoGateUpload?.addEventListener('click', () => {
    hidePhotoGate();
    showStep(3);
    const section = form.querySelector<HTMLElement>('[data-photo-section]');
    section?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    form.querySelector<HTMLInputElement>('[data-photo-input]')?.focus();
  });

  function consentOnlyChange(target: EventTarget | null): boolean {
    // Terms acceptance is a legal acknowledgment, not a pricing input. Do not
    // recalculate the quote or replay the reveal when it is checked.
    return target instanceof HTMLInputElement && target.name === 'termsAccepted';
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
    if (consentOnlyChange(target)) return;
    syncConditionalFields();
    syncRevealGroups(true);
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
    if (consentOnlyChange(target)) return;
    syncConditionalFields();
    syncRevealGroups(true);
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

  /**
   * The advance-reservation window: requests may be made from today up to the
   * configured number of days ahead. Attributes are set at runtime so a long-
   * lived build can never carry a stale maximum, and the server enforces the
   * same window independently.
   */
  function applyDateWindow(): void {
    const dateInput = form.querySelector<HTMLInputElement>('#est-date');
    if (!dateInput) return;
    const localIsoDate = (date: Date): string => {
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    };
    const today = new Date();
    const latest = new Date(
      today.getFullYear(),
      today.getMonth(),
      today.getDate() + schedulingConfig.advanceReservationDays,
    );
    dateInput.min = localIsoDate(today);
    dateInput.max = localIsoDate(latest);
  }

  resetWizard();
  applyDateWindow();
  // Photo uploads are initialized above via photoController.

  // Deep links from marketing pages and the estimate hub. Only allowlisted
  // values apply, and they only pre-select — the customer can always change
  // the service. `engine=str` turns the wizard into the turnover engine.
  function applyDeepLinkSelections(): void {
    let params: URLSearchParams;
    try {
      params = new URLSearchParams(window.location.search);
    } catch {
      return;
    }

    const isStrPage = window.location.pathname.replace(/\/+$/, '').endsWith('/estimate/str');
    const legacyStr = params.get('service') === 'str_turnover' || params.get('engine') === 'str';
    const nextEngine: 'residential' | 'str' =
      isStrPage || legacyStr ? 'str' : 'residential';
    engine = nextEngine;
    STEP_LABELS = [...ENGINE_STEPS[nextEngine].titles];
    const serviceFieldset = form.querySelector<HTMLElement>('[data-service-fieldset]');
    if (serviceFieldset) serviceFieldset.hidden = nextEngine === 'str';
    // One authoritative turnover pathway: the general residential wizard must
    // not offer STR as a service choice.
    const strOption = form.querySelector<HTMLElement>('input[name="serviceType"][value="str_turnover"]')?.closest('label');
    if (strOption) strOption.hidden = nextEngine === 'residential';
    if (engineNote) {
      engineNote.hidden = nextEngine !== 'str';
      engineNote.textContent =
        nextEngine === 'str'
          ? 'Short-term rental turnover estimate — one turnover, priced for this property.'
          : '';
    }
    for (const heading of form.querySelectorAll<HTMLElement>('[data-step-title]')) {
      const index = Number(heading.dataset.stepTitle ?? '0');
      heading.textContent = STEP_LABELS[index] ?? '';
    }
    for (const [index, item] of stepItems.entries()) {
      const title = item.querySelector<HTMLElement>('.wizard-steps__title');
      if (title) title.textContent = STEP_LABELS[index] ?? '';
      const jump = item.querySelector<HTMLButtonElement>('[data-step-jump]');
      if (jump) jump.setAttribute('aria-label', `Step ${index + 1}: ${STEP_LABELS[index] ?? ''}`);
    }

    if (nextEngine === 'str') {
      const radio = form.querySelector<HTMLInputElement>('input[name="serviceType"][value="str_turnover"]');
      if (radio) {
        radio.checked = true;
        radio.dispatchEvent(new Event('change', { bubbles: true }));
      }
    } else {
      const service = params.get('service');
      const preset = parseResidentialServiceParam(service);
      // Legacy allowlisted values keep working for old campaigns.
      const legacy = service && ['standard', 'deep', 'move_in_out', 'str_turnover'].includes(service) ? service : null;
      const serviceValue = preset?.serviceType ?? legacy;
      if (serviceValue) {
        const radio = form.querySelector<HTMLInputElement>(`input[name="serviceType"][value="${serviceValue}"]`);
        if (radio) {
          radio.checked = true;
          radio.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }
      if (preset?.frequency) {
        const select = form.querySelector<HTMLSelectElement>('#est-frequency');
        if (select) {
          select.value = preset.frequency;
          select.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }
      // The Community Support eligibility checkbox is NEVER preselected. A
      // `?service=supportive&supportive=yes` deep link only selects ordinary
      // residential cleaning; the customer makes the self-attestation.
    }

    const frequency = params.get('frequency');
    if (frequency && ['weekly', 'biweekly', 'monthly', 'one_time'].includes(frequency)) {
      // A deep-linked rhythm only applies when the selected service genuinely
      // supports it (e.g. ?service=deep ignores ?frequency=weekly).
      const currentService = radioValue('serviceType') as EstimateInput['serviceType'] | undefined;
      const compatible = !currentService || serviceSupportsFrequency(currentService, frequency as EstimateInput['frequency']);
      if (compatible) {
        const select = form.querySelector<HTMLSelectElement>('#est-frequency');
        if (select) {
          select.value = frequency;
          select.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }
    }

    syncConditionalFields();
    showStep(currentStep);
  }
  applyDeepLinkSelections();
  recalc();
  void lookupTravel();
  void (async () => {
    try {
      const response = await fetch('/api/estimate-checkout', { headers: { Accept: 'application/json' } });
      const data = (await response.json().catch(() => ({}))) as { ok?: boolean; enabled?: boolean };
      paymentEnabled = response.ok && data.ok === true && data.enabled === true;
    } catch {
      paymentEnabled = false;
    }
    syncPaymentAvailability(latestQuote !== null);
  })();

  // Debug handle — preview builds only. Never rendered publicly.
  if (preview) {
    (window as unknown as Record<string, unknown>).pccEstimateDebug = () => ({
      result: latestResult,
      quote: latestQuote,
      location,
    });
  }
}
