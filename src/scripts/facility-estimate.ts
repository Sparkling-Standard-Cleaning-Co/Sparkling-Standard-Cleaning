// Facility estimate engine (commercial + church) — shared location finder,
// travel lookup, and the ONE lead submission pipeline. Numeric pricing is
// controlled by the owner kill switch: enabled = Tier A/B preliminary numbers,
// Tier C scope review; disabled = scope-review only with no numeric fields sent
// to the server or the owner notification.
import { business, contactPhone, isPending } from '../config/business';
import { commercialTierConfig } from '../config/estimators/commercial';
import { pricing } from '../config/pricing';
import { schedulingConfig } from '../config/scheduling';
import { taxPresentationForService } from '../lib/estimate/tax';
import { formatUsd } from '../lib/format';
import { initAddressFinder } from './address-finder';
import { initPhotoUploads } from './photo-uploads';
import { cancelEstimateReveal, playEstimateReveal } from './estimate-reveal';
import { submitLead, recordConversion } from '../lib/forms/submit';
import { saveSubmissionSummary } from '../lib/forms/submission-receipt';
import { failureCopy, type FailureReason } from '../lib/forms/failure-copy';
import { attributionFields } from '../lib/attribution';
import { legalTerms } from '../config/legal';
import { bookingConfig } from '../config/booking';
import { initBookingPicker, type BookingPickerHandle } from './booking-picker';
import { track } from '../lib/analytics/events';
import {
  calculateFacilityPrice,
  calculateFacilityWorkload,
  type FacilityPrice,
  type FacilityType,
  type FacilityWorkload,
  type FacilityWorkloadInput,
} from '../lib/estimate/commercial';

type Engine = 'commercial' | 'church';

interface RoutedTravel {
  oneWayMiles: number;
  durationMinutes?: number | null;
  verified?: boolean;
  method?: string;
}

const form = document.querySelector<HTMLFormElement>('[data-facility-form]');
const engine = (form?.dataset.engine === 'church' ? 'church' : 'commercial') as Engine;
const churchDiscountLabel = pricing.churchDiscount.enabled.value
  ? `${pricing.churchDiscount.percent.value}% church discount`
  : 'church discount';

if (form) {
  initFacilityForm(form, engine);
}

function initFacilityForm(host: HTMLFormElement, facilityEngine: Engine): void {
  const mountedAt = Date.now();
  const numericEstimatesEnabled = commercialTierConfig.numericEstimatesEnabled;
  const status = host.querySelector<HTMLElement>('[data-form-status]');
  const submitButton = host.querySelector<HTMLButtonElement>('button[type="submit"]');
  const payNowButton = host.querySelector<HTMLButtonElement>('[data-facility-pay-now]');
  const verifyAddressButton = host.querySelector<HTMLButtonElement>('[data-facility-verify-address]');
  const paymentGuidance = host.querySelector<HTMLElement>('[data-facility-payment-guidance]');
  const payNowNote = host.querySelector<HTMLElement>('[data-facility-pay-note]');
  const reviewLines = host.querySelector<HTMLElement>('[data-facility-review-lines]');
  const reviewNote = host.querySelector<HTMLElement>('[data-facility-review-note]');
  const result = host.querySelector<HTMLElement>('[data-facility-result]');
  const resultTitle = host.querySelector<HTMLElement>('[data-facility-result-title]');
  const resultNote = host.querySelector<HTMLElement>('[data-facility-result-note]');
  const confirmedTravel = host.querySelector<HTMLElement>('[data-address-confirmed-travel]');
  const estimatePanel = host.querySelector<HTMLElement>('[data-facility-estimate]');
  const estimateLabel = host.querySelector<HTMLElement>('[data-facility-estimate-label]');
  const estimatePrice = host.querySelector<HTMLElement>('[data-facility-estimate-price]');
  const estimateRange = host.querySelector<HTMLElement>('[data-facility-estimate-range]');
  const estimateLines = host.querySelector<HTMLElement>('[data-facility-estimate-lines]');
  const estimateNote = host.querySelector<HTMLElement>('[data-facility-estimate-note]');
  const estimateTax = host.querySelector<HTMLElement>('[data-facility-estimate-tax]');
  const estimateReveal = host.querySelector<HTMLElement>('[data-estimate-reveal]');
  const finalPanel = host.querySelector<HTMLElement>('[data-facility-step-panel="4"]');
  const stepPanels = [...host.querySelectorAll<HTMLElement>('[data-facility-step-panel]')];
  const stepButtons = [...host.querySelectorAll<HTMLButtonElement>('[data-facility-step-jump]')];
  const nextButton = host.querySelector<HTMLButtonElement>('[data-facility-next]');
  const backButton = host.querySelector<HTMLButtonElement>('[data-facility-back]');
  const progressBar = host.querySelector<HTMLElement>('[data-facility-progress]');
  const progressFill = host.querySelector<HTMLElement>('[data-facility-progress-fill]');
  const stepLabel = host.querySelector<HTMLElement>('[data-facility-step-label]');
  const progressPercent = host.querySelector<HTMLElement>('[data-facility-progress-percent]');
  const stepDescription = host.querySelector<HTMLElement>('[data-facility-step-description]');
  const errorSummary = host.querySelector<HTMLElement>('[data-error-summary]');
  const errorSummaryTitle = host.querySelector<HTMLElement>('[data-error-summary-title]');
  const errorSummaryList = host.querySelector<HTMLElement>('[data-error-summary-list]');
  let currentStep = 1;
  let maxVisitedStep = 1;
  const photoController = initPhotoUploads(host, { engine: facilityEngine });
  let latestWorkload: FacilityWorkload | null = null;
  let latestPrice: FacilityPrice | null = null;
  let paymentEnabled = false;
  let paymentBusy = false;
  let paymentBlocked = false;
  let pendingPaymentFields: Record<string, string> | null = null;
  let acceptedPaymentAmount: number | null = null;
  let paymentRetryAvailable = false;
  let startTracked = false;
  let travel: RoutedTravel | null = null;
  let travelKey = '';
  let revealKey = '';
  let addressVerificationPending = false;
  let addressReviewRequired = false;
  let bookingPicker: BookingPickerHandle | null = null;
  let finder: ReturnType<typeof initAddressFinder> = null;

  const phone = contactPhone();
  const contact = {
    phoneDisplay: phone?.display,
    email: isPending(business.email) ? undefined : business.email,
    smsEnabled: business.flags.smsEnabled,
  };

  function setStatus(kind: 'info' | 'success' | 'error', message: string): void {
    if (!status) return;
    status.dataset.state = kind;
    status.textContent = message;
  }

  function payNowLabel(): string {
    if (acceptedPaymentAmount !== null) return `Pay ${formatUsd(acceptedPaymentAmount)} Securely`;
    return paymentRetryAvailable ? 'Try Secure Payment Again' : 'Pay Now Securely';
  }

  function setPayNowBusy(busy: boolean): void {
    paymentBusy = busy;
    if (!payNowButton) return;
    payNowButton.disabled = busy;
    payNowButton.setAttribute('aria-busy', busy ? 'true' : 'false');
    payNowButton.textContent = busy ? 'Preparing Secure Checkout...' : payNowLabel();
  }

  function facilityAddressConfirmed(): boolean {
    const submitted = finder?.getSubmission();
    return (
      Boolean(submitted?.location) &&
      (submitted?.street.trim().length ?? 0) >= 5 &&
      submitted?.location?.precision !== 'street' &&
      submitted?.location?.precision !== 'approximate'
    );
  }

  function facilityAddressReady(): boolean {
    return travel?.verified === true && facilityAddressConfirmed();
  }

  function syncFacilityPayment(): void {
    const addressReady = facilityAddressReady();
    const priceReady =
      numericEstimatesEnabled &&
      latestPrice?.priced === true &&
      latestPrice.tier === 'A';
    const eligibleBase = priceReady && currentStep === stepPanels.length;
    const payable = eligibleBase && paymentEnabled && !paymentBlocked && addressReady;
    const canVerify =
      eligibleBase &&
      paymentEnabled &&
      !paymentBlocked &&
      !facilityAddressConfirmed() &&
      !addressReviewRequired;
    if (payNowButton) {
      payNowButton.hidden = !payable;
      if (!payable) {
        payNowButton.setAttribute('aria-busy', 'false');
        payNowButton.textContent = payNowLabel();
      } else if (!paymentBusy) {
        payNowButton.textContent = payNowLabel();
      }
    }
    if (verifyAddressButton) verifyAddressButton.hidden = !canVerify;
    if (paymentGuidance) {
      paymentGuidance.hidden = !eligibleBase || payable;
      paymentGuidance.textContent = canVerify
        ? 'Verify your service address to finalize travel and unlock secure online payment. You can still request the visit without paying.'
        : addressReviewRequired
          ? "We couldn't verify the exact facility address online. Request the visit without paying — we'll confirm the address and arrange payment personally."
          : 'Your cleaning request is ready. We will confirm the final scope and price before arranging payment.';
    }
    if (payNowNote) payNowNote.hidden = !payable;
    if (bookingPicker) {
      const submitted = finder?.getSubmission();
      const key =
        latestWorkload && submitted?.location
          ? `${field('organization')}:${field('preferred_date')}:${submitted.street}:${submitted.location.lat.toFixed(
              5,
            )},${submitted.location.lng.toFixed(5)}`
          : '';
      bookingPicker.contextChanged(key);
      if (currentStep === stepPanels.length && key) void bookingPicker.activate();
    }
  }

  function field(name: string): string {
    const element = host.elements.namedItem(name);
    if (
      element instanceof HTMLInputElement ||
      element instanceof HTMLSelectElement ||
      element instanceof HTMLTextAreaElement
    ) {
      return element.value.trim();
    }
    return '';
  }

  type FieldElement = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
  interface FieldRule {
    name: string;
    message: string;
    /** Optional empty value is allowed; validate() still applies when present. */
    optional?: boolean;
    /** Optional extra check; return an error message or null. */
    validate?: (value: string) => string | null;
  }

  function namedElement(name: string): FieldElement | null {
    const element = host.elements.namedItem(name);
    return element instanceof HTMLInputElement ||
      element instanceof HTMLSelectElement ||
      element instanceof HTMLTextAreaElement
      ? element
      : null;
  }

  function clearFieldError(name: string): void {
    const element = namedElement(name);
    if (!element) return;
    element.removeAttribute('aria-invalid');
    const error = host.querySelector<HTMLElement>(`[data-field-error="${name}"]`);
    error?.remove();
    const described = (element.getAttribute('aria-describedby') ?? '')
      .split(/\s+/)
      .filter((id) => id && id !== `facility-error-${name}`);
    if (described.length > 0) element.setAttribute('aria-describedby', described.join(' '));
    else element.removeAttribute('aria-describedby');
  }

  function setFieldError(name: string, message: string): void {
    const element = namedElement(name);
    if (!element) return;
    element.setAttribute('aria-invalid', 'true');
    const container = element.closest('.field') ?? element.parentElement;
    if (!container) return;
    let error = container.querySelector<HTMLElement>(`[data-field-error="${name}"]`);
    if (!error) {
      error = document.createElement('p');
      error.className = 'field-error';
      error.dataset.fieldError = name;
      error.id = `facility-error-${name}`;
      error.setAttribute('role', 'alert');
      container.appendChild(error);
    }
    error.textContent = message;
    const described = new Set(
      (element.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean),
    );
    described.add(error.id);
    element.setAttribute('aria-describedby', [...described].join(' '));
  }

  function showErrorSummary(
    errors: Array<{ name: string; message: string }>,
    stage: 'continue' | 'send' = 'continue',
  ): void {
    if (!errorSummary || !errorSummaryList) return;
    errorSummaryList.innerHTML = '';
    if (errors.length === 0) {
      errorSummary.hidden = true;
      return;
    }
    if (errorSummaryTitle) {
      errorSummaryTitle.textContent =
        stage === 'send'
          ? 'Please review these details before sending your request:'
          : 'Please review these details before continuing:';
    }
    for (const error of errors) {
      const item = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = error.message;
      button.addEventListener('click', () => {
        const target = namedElement(error.name);
        target?.focus();
        target?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      });
      item.appendChild(button);
      errorSummaryList.appendChild(item);
    }
    errorSummary.hidden = false;
  }

  function rulesForStep(step: number): FieldRule[] {
    const zipRule: FieldRule = {
      name: 'zip',
      optional: true,
      message: 'Enter the facility ZIP code so we can confirm travel and coverage.',
      validate: (value) =>
        /^\d{5}(-\d{4})?$/.test(value)
          ? null
          : 'Enter a 5-digit ZIP code, for example 32503.',
    };
    switch (step) {
      case 1:
        return [
          {
            name: 'organization',
            message: facilityEngine === 'church' ? 'Enter your church or ministry name.' : 'Enter the business or organization name.',
          },
          { name: 'name', message: 'Enter the contact name for this request.' },
          zipRule,
        ];
      case 2:
        return [
          ...(facilityEngine === 'commercial'
            ? [{ name: 'facility_type', message: 'Choose the type of facility.' }]
            : []),
          {
            name: 'cleanable_sqft',
            message: 'Enter the approximate cleanable square footage.',
            validate: (value) => {
              const numeric = Number(value.replaceAll(',', '').replaceAll(' ', ''));
              return Number.isFinite(numeric) && numeric > 0
                ? null
                : 'Enter the cleanable area as a number, for example 2,000.';
            },
          },
          {
            name: 'restroom_fixtures',
            message: 'Enter the total number of restroom fixtures (toilets, urinals and sinks).',
            validate: (value) => {
              const numeric = Number(value.replaceAll(',', '').replaceAll(' ', ''));
              return Number.isFinite(numeric) && numeric >= 0
                ? null
                : 'Enter the fixture count as a number (0 if there are none).';
            },
          },
          { name: 'frequency', message: 'Select how often you would like the facility cleaned.' },
        ];
      case 3:
        return [
          { name: 'time_preference', message: 'Choose the service window that works best.' },
          {
            name: 'preferred_date',
            optional: true,
            message: 'Choose a preferred date within the next 60 days.',
            validate: (value) => {
              if (!value) return null;
              const today = new Date();
              const min = today.toISOString().slice(0, 10);
              const maxDate = new Date(today.getTime() + schedulingConfig.advanceReservationDays * 86_400_000);
              const max = maxDate.toISOString().slice(0, 10);
              return value >= min && value <= max
                ? null
                : `Choose a date between ${min} and ${max}, or leave it blank.`;
            },
          },
        ];
      default:
        return [
          {
            name: 'termsAccepted',
            message: 'Please agree to the Terms and Conditions and applicable Policies to continue.',
          },
          {
            name: 'phone',
            message: 'Enter a phone number so we can confirm the scope.',
            validate: (value) => {
              const digits = value.replace(/\D/g, '');
              return digits.length >= 10 && digits.length <= 15
                ? null
                : 'Enter a phone number with at least 10 digits.';
            },
          },
          {
            name: 'email',
            message: 'Enter an email address so we can send your estimate.',
            validate: (value) =>
              /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value)
                ? null
                : 'Enter a complete email address with an @ and a domain.',
          },
        ];
    }
  }

  function validateStep(
    step: number,
    announce = true,
    stage: 'continue' | 'send' = 'continue',
  ): Array<{ name: string; message: string }> {
    const errors: Array<{ name: string; message: string }> = [];
    for (const rule of rulesForStep(step)) {
      const element = namedElement(rule.name);
      if (!element) continue;
      clearFieldError(rule.name);
      const value = element.value.trim();
      let message: string | null = null;
      if (value === '') {
        message = rule.optional ? null : rule.message;
      } else if (rule.validate) {
        message = rule.validate(value);
      }
      if (message) {
        setFieldError(rule.name, message);
        errors.push({ name: rule.name, message });
      }
    }
    if (announce) {
      showErrorSummary(errors, stage);
      if (errors.length > 0) namedElement(errors[0]!.name)?.focus();
    }
    return errors;
  }

  function showStep(step: number, focus = true): void {
    currentStep = Math.min(stepPanels.length, Math.max(1, step));
    for (const panel of stepPanels) {
      const panelStep = Number(panel.dataset.facilityStepPanel ?? '0');
      panel.hidden = panelStep !== currentStep;
      panel.dataset.active = panelStep === currentStep ? 'true' : 'false';
    }
    for (const [index, button] of stepButtons.entries()) {
      const buttonStep = index + 1;
      if (buttonStep === currentStep) button.setAttribute('aria-current', 'step');
      else button.removeAttribute('aria-current');
      button.disabled = buttonStep > maxVisitedStep;
    }
    if (backButton) backButton.hidden = currentStep === 1;
    if (nextButton) nextButton.hidden = currentStep === stepPanels.length;
    if (submitButton) submitButton.hidden = currentStep !== stepPanels.length;
    const total = stepPanels.length;
    const percent = Math.round((currentStep / total) * 100);
    if (progressBar) progressBar.setAttribute('aria-valuenow', String(percent));
    if (progressFill) progressFill.style.width = `${percent}%`;
    if (progressPercent) progressPercent.textContent = `${percent}%`;
    if (stepLabel) {
      const title = stepButtons[currentStep - 1]?.querySelector<HTMLElement>('.facility-steps__title')?.textContent?.trim() ?? '';
      stepLabel.textContent = `Step ${currentStep} of ${total} — ${title}`;
    }
    if (stepDescription) {
      const panel = stepPanels[currentStep - 1];
      stepDescription.textContent = panel?.querySelector<HTMLElement>('.facility-step-description')?.textContent?.trim() ?? '';
    }
    syncFacilityPayment();
    maybeRevealFacilityEstimate();
    if (focus) stepPanels[currentStep - 1]?.querySelector<HTMLElement>('[data-facility-step-title]')?.focus();
  }

  function advance(): void {
    const errors = validateStep(currentStep);
    if (errors.length > 0) return;
    maxVisitedStep = Math.max(maxVisitedStep, Math.min(stepPanels.length, currentStep + 1));
    showStep(currentStep + 1);
  }

  function goBack(): void {
    if (currentStep <= 1) return;
    showStep(currentStep - 1);
  }

  function validateAllSteps(): { step: number; errors: Array<{ name: string; message: string }> } | null {
    for (let step = 1; step <= stepPanels.length; step += 1) {
      const errors = validateStep(step, false, 'send');
      if (errors.length > 0) return { step, errors };
    }
    showErrorSummary([], 'send');
    return null;
  }

  for (const [index, button] of stepButtons.entries()) {
    button.addEventListener('click', () => {
      if (button.disabled) return;
      if (index + 1 > maxVisitedStep) return;
      showStep(index + 1);
    });
  }
  nextButton?.addEventListener('click', advance);
  backButton?.addEventListener('click', goBack);
  host.addEventListener('input', (event) => {
    const name = (event.target as HTMLElement | null)?.getAttribute('name');
    if (name) clearFieldError(name);
  });
  host.addEventListener('change', (event) => {
    const name = (event.target as HTMLElement | null)?.getAttribute('name');
    if (name) clearFieldError(name);
  });
  showStep(1, false);
  finder = initAddressFinder({
    form: host,
    onChange: (location) => {
      travel = null;
      travelKey = location ? `pin:${location.lat},${location.lng}` : '';
      if (confirmedTravel) confirmedTravel.textContent = '';
      renderSummary();
      if (location) void lookupTravel(location.lat, location.lng);
      if (!addressVerificationPending) addressReviewRequired = false;
    },
    onConfirm: () => {
      if (!addressVerificationPending) return;
      const exact = facilityAddressConfirmed();
      addressVerificationPending = false;
      addressReviewRequired = !exact;
      setStatus(
        'info',
        exact
          ? 'Address confirmed. Returning to your final facility estimate…'
          : 'We confirmed the general area, but not the exact facility. Returning to your estimate so you can request the visit without online payment.',
      );
      window.setTimeout(() => showStep(stepPanels.length), 250);
    },
  });

  const bookingRoot = host.querySelector<HTMLElement>('[data-booking-picker]');
  if (bookingRoot) {
    bookingPicker = initBookingPicker(bookingRoot, () => {
      if (!latestWorkload) return null;
      const submitted = finder?.getSubmission();
      if (
        !submitted?.location ||
        submitted.street.trim().length < 5 ||
        submitted.location.precision === 'street' ||
        submitted.location.precision === 'approximate'
      ) {
        return null;
      }
      const durationMinutes = Math.max(
        bookingConfig.minimumJobMinutes,
        Math.ceil((latestWorkload.laborHours * 60) / bookingConfig.crewCount),
      );
      const preferredDate = field('preferred_date');
      return {
        durationMinutes,
        destination: { lat: submitted.location.lat, lng: submitted.location.lng },
        reference: `FAC-${field('organization') || 'facility'}-${preferredDate}`.slice(0, 120),
        location: [submitted.street, submitted.city, submitted.state, submitted.zip]
          .filter(Boolean)
          .join(', '),
        preferredDate,
      };
    });
  }
  verifyAddressButton?.addEventListener('click', async () => {
    addressVerificationPending = true;
    verifyAddressButton.disabled = true;
    verifyAddressButton.setAttribute('aria-busy', 'true');
    verifyAddressButton.textContent = 'Opening Address Verification…';
    showStep(1);
    setStatus(
      'info',
      'Verify the full facility address and confirm the map pin. We will return you to the final estimate automatically.',
    );
    if (!finder) {
      addressVerificationPending = false;
      verifyAddressButton.disabled = false;
      verifyAddressButton.setAttribute('aria-busy', 'false');
      verifyAddressButton.textContent = 'Verify Address & Finalize Price';
      setStatus(
        'error',
        'Address verification could not start. Please enter the full facility address on step 1, then return to the final step.',
      );
      return;
    }
    try {
      const outcome = await finder.verifyAddress();
      if (outcome === 'resolved') return;
      addressVerificationPending = false;
      if (outcome === 'unresolved') {
        addressReviewRequired = true;
        setStatus(
          'info',
          'We could not verify that exact facility address online. Returning to your estimate so you can request the visit and have us confirm it personally.',
        );
        window.setTimeout(() => showStep(stepPanels.length), 250);
      }
    } finally {
      verifyAddressButton.disabled = false;
      verifyAddressButton.setAttribute('aria-busy', 'false');
      verifyAddressButton.textContent = 'Verify Address & Finalize Price';
      syncFacilityPayment();
    }
  });

  async function lookupTravel(lat: number, lng: number): Promise<void> {
    const key = `pin:${lat},${lng}`;
    try {
      const response = await fetch('/api/travel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ lat, lng }),
      });
      if (!response.ok) return;
      const data = (await response.json()) as RoutedTravel;
      if (key !== travelKey) return;
      if (typeof data.oneWayMiles === 'number' && data.oneWayMiles > 0) {
        travel = data;
        if (confirmedTravel) {
          confirmedTravel.textContent = `${data.oneWayMiles.toFixed(1)} miles one way from our operating area.`;
        }
        renderSummary();
      }
    } catch {
      // Travel stays preliminary; the owner confirms eligibility personally.
    }
  }

  function facilityTypeFor(engine: Engine, raw: string): FacilityType {
    if (engine === 'church') return 'church';
    switch (raw) {
      case 'retail':
        return 'retail';
      case 'salon':
        return 'salon';
      case 'gym':
        return 'gym';
      case 'apartment':
      case 'property-management':
        return 'community';
      default:
        return 'office';
    }
  }

  function numberFromField(name: string): number | null {
    const raw = field(name).replaceAll(',', '').replaceAll(' ', '');
    if (raw === '') return null;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function readWorkloadInput(): FacilityWorkloadInput {
    return {
      cleanableSqft: numberFromField('cleanable_sqft'),
      restroomFixtures: numberFromField('restroom_fixtures'),
      breakroom: field('breakroom') === 'breakroom' || field('breakroom') === 'kitchen',
      facilityType: facilityTypeFor(facilityEngine, field('facility_type')),
      condition: (field('condition') || 'average') as NonNullable<FacilityWorkloadInput['condition']>,
      traffic: (field('traffic') || 'average') as NonNullable<FacilityWorkloadInput['traffic']>,
      flooring: (field('flooring') || 'mixed') as NonNullable<FacilityWorkloadInput['flooring']>,
      firstClean: field('first_clean') === 'yes',
      specialty: field('specialty_services') !== '',
    };
  }

  function maybeRevealFacilityEstimate(): void {
    if (!finalPanel) return;
    const key =
      currentStep === stepPanels.length && latestPrice?.priced
        ? `${latestPrice.total}:${latestPrice.tier}:${travel?.oneWayMiles ?? 'none'}`
        : '';
    if (!key) {
      revealKey = '';
      cancelEstimateReveal(estimateReveal, finalPanel);
      return;
    }
    if (revealKey === key) return;
    revealKey = key;
    void playEstimateReveal({ reveal: estimateReveal, target: finalPanel });
  }

  function renderEstimate(priceLines: string[]): void {
    if (!estimatePanel || !estimatePrice || !estimateLabel || !estimateNote || !estimateLines) return;
    const price = latestPrice;
    const workload = latestWorkload;
    if (!workload || !price) {
      estimatePanel.hidden = true;
      return;
    }
    estimatePanel.hidden = false;
    maybeRevealFacilityEstimate();
    estimateLines.innerHTML = priceLines.join('');
    const tax = taxPresentationForService(facilityEngine === 'church' ? 'church_cleaning' : 'commercial_cleaning');
    if (estimateTax) estimateTax.textContent = `${tax.label}. ${tax.note}`;
    if (!price.priced) {
      estimateLabel.textContent = 'Confirmation Required';
      estimatePrice.textContent = "We'll confirm this with you";
      if (estimateRange) estimateRange.hidden = true;
      estimateNote.textContent = numericEstimatesEnabled
        ? 'This facility has enough scope or special detail that a responsible price needs a personal review. Send the details and Sparkling Standard will confirm an exact quote.'
        : 'Numeric facility pricing is currently handled as a personal scope review. Send the details and Sparkling Standard will confirm an exact quote.';
      return;
    }
    estimateLabel.textContent = price.tier === 'B' ? 'Preliminary price range' : 'Preliminary per-visit estimate';
    estimatePrice.textContent = formatUsd(price.total, { forceCents: true });
    if (estimateRange) {
      if (price.range) {
        estimateRange.hidden = false;
        estimateRange.textContent = `Typical range ${formatUsd(price.range.low, { forceCents: true })}–${formatUsd(price.range.high, { forceCents: true })} per visit`;
      } else {
        estimateRange.hidden = true;
      }
    }
    estimateNote.textContent =
      'Nonbinding preliminary estimate based on the scope you entered. Final details are confirmed personally before anything is booked.';
  }

  function renderSummary(): void {
    const lines: string[] = [];
    const organization = field('organization');
    const sqft = field('cleanable_sqft');
    const fixtures = field('restroom_fixtures');
    const frequency = field('frequency');
    const zip = field('zip');
    if (organization) lines.push(`<li><span>${facilityEngine === 'church' ? 'Ministry' : 'Facility'}</span><strong>${escapeHtml(organization)}</strong></li>`);
    if (sqft) lines.push(`<li><span>Cleanable area</span><strong>${escapeHtml(sqft)} sq ft</strong></li>`);
    if (fixtures) lines.push(`<li><span>Restroom fixtures</span><strong>${escapeHtml(fixtures)}</strong></li>`);
    if (frequency) lines.push(`<li><span>Frequency</span><strong>${escapeHtml(frequency.replaceAll('_', ' '))}</strong></li>`);
    if (zip) lines.push(`<li><span>Service ZIP</span><strong>${escapeHtml(zip)}</strong></li>`);

    const input = readWorkloadInput();
    if (input.cleanableSqft && input.cleanableSqft >= 200) {
      latestWorkload = calculateFacilityWorkload(input);
      latestPrice = calculateFacilityPrice(latestWorkload, field('frequency') || 'weekly', {
        oneWayMiles: travel?.oneWayMiles ?? null,
        church: facilityEngine === 'church',
      });
      const priceLines: string[] = [];
      if (latestPrice.priced) {
        priceLines.push(`<li><span>Cleaning (${latestWorkload.laborHours} labor hrs)</span><strong>${formatUsd(latestPrice.cleaningSubtotal, { forceCents: true })}</strong></li>`);
        if (latestPrice.discount?.applied) {
          priceLines.push(
            `<li><span>Church discount (${pricing.churchDiscount.percent.value}%)</span><strong>−${formatUsd(latestPrice.discount.amount, { forceCents: true })}</strong></li>`,
          );
          priceLines.push(`<li><span>Subtotal after discount</span><strong>${formatUsd(latestPrice.discount.discountedSubtotal, { forceCents: true })}</strong></li>`);
        }
        if (latestPrice.globalFactor !== 1) {
          priceLines.push(
            `<li><span>${facilityEngine === 'church' ? 'Church' : 'Commercial'} calibration adjustment (×${latestPrice.globalFactor.toFixed(2)})</span><strong>${latestPrice.globalAdjustment < 0 ? '−' : '+'}${formatUsd(Math.abs(latestPrice.globalAdjustment), { forceCents: true })}</strong></li>`,
          );
        }
        if (latestPrice.travelAdjustment > 0) {
          priceLines.push(`<li><span>Travel adjustment</span><strong>${formatUsd(latestPrice.travelAdjustment, { forceCents: true })}</strong></li>`);
        }
        if (latestPrice.monthly) {
          priceLines.push(`<li><span>Estimated monthly</span><strong>${formatUsd(latestPrice.monthly, { forceCents: true })}</strong></li>`);
        }
        lines.push(`<li><span>Preliminary estimate</span><strong>${formatUsd(latestPrice.total, { forceCents: true })} per visit</strong></li>`);
      } else {
        lines.push('<li><span>Estimate type</span><strong>Custom scope review</strong></li>');
      }
      renderEstimate(priceLines);
    } else {
      latestWorkload = null;
      latestPrice = null;
      renderEstimate([]);
    }


    if (facilityEngine === 'church') {
      const percent = pricing.churchDiscount.percent.value;
      lines.push(`<li><span>Church discount</span><strong>${percent}% off eligible cleaning, applied to the cleaning subtotal</strong></li>`);
    }
    lines.push('<li><span>Final price</span><strong>Confirmed personally before booking</strong></li>');
    if (reviewLines) reviewLines.innerHTML = lines.join('');
    renderReviewNote();
    syncFacilityPayment();
  }

  function renderReviewNote(): void {
    if (!reviewNote) return;
    if (!numericEstimatesEnabled) {
      reviewNote.textContent = facilityEngine === 'church'
        ? `This is a scope-review request, not a confirmed contract. The ${churchDiscountLabel} applies to the confirmed cleaning quote, and Sparkling Standard confirms the scope and price personally before anything is scheduled.`
        : 'This is a scope-review request, not a confirmed contract. Sparkling Standard confirms the scope and price personally before anything is scheduled.';
      return;
    }
    if (latestPrice?.priced) {
      reviewNote.textContent = facilityEngine === 'church'
        ? `The amount above is a nonbinding preliminary estimate with the ${churchDiscountLabel} applied. Final scope and price are confirmed personally before anything is scheduled.`
        : 'The amount above is a nonbinding preliminary estimate. Final scope and price are confirmed personally before anything is scheduled.';
      return;
    }
    if (latestPrice) {
      reviewNote.textContent = facilityEngine === 'church'
        ? `This scope needs a personal review before a responsible price can be given. The ${churchDiscountLabel} applies to the confirmed cleaning quote, and Sparkling Standard confirms the scope and price personally.`
        : 'This scope needs a personal review before a responsible price can be given. Sparkling Standard confirms the scope and price personally before anything is scheduled.';
      return;
    }
    reviewNote.textContent = facilityEngine === 'church'
      ? `Enter the facility details to see a preliminary estimate. The ${churchDiscountLabel} applies to the confirmed cleaning quote, and Sparkling Standard confirms the scope and price personally before anything is scheduled.`
      : 'Enter the facility details to see a preliminary estimate. Final scope and price are confirmed personally before anything is scheduled.';
  }

  function escapeHtml(value: string): string {
    return value
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;');
  }

  function updateSummary(): void {
    const submission = finder?.getSubmission();
    const location = submission?.location ?? null;
    const zip = submission?.zip ?? field('zip');
    const currentKey = location
      ? `pin:${location.lat},${location.lng}`
      : zip
        ? `zip:${zip}`
        : '';
    if (travelKey !== currentKey) {
      travel = null;
      travelKey = currentKey;
    }
    renderSummary();
  }

  host.addEventListener('input', () => {
    if (!startTracked) {
      startTracked = true;
      if (facilityEngine === 'church') track('church_request_start', {});
      else track('commercial_quote_start', {});
    }
    updateSummary();
  });
  host.addEventListener('change', () => {
    updateSummary();
    if (facilityEngine === 'church') syncPartnershipAgreement();
  });

  function syncPartnershipAgreement(): void {
    const none = host.querySelector<HTMLInputElement>('input[name="partnership_none"]');
    const others = [...host.querySelectorAll<HTMLInputElement>('input[name^="partnership_"]')].filter(
      (input) => input.name !== 'partnership_none',
    );
    if (!none || none.type !== 'checkbox') return;
    if (none.checked) {
      for (const input of others) input.checked = false;
    }
  }

  payNowButton?.addEventListener('click', () => {
    void handleSubmit('pay_now');
  });
  host.addEventListener('submit', (event) => {
    event.preventDefault();
    if (currentStep < stepPanels.length) {
      advance();
      return;
    }
    void handleSubmit();
  });

  interface StartPaymentResult {
    ok: boolean;
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
          returnPath:
            facilityEngine === 'church' ? '/estimate/church/' : '/estimate/commercial/',
          ...(acceptedAmount !== null ? { acceptRecalculated: true, acceptedAmount } : {}),
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
        return { ok: true };
      }
      if (data.error) console.warn('[secure-checkout]', data.error, data.reason ?? '');
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
      syncFacilityPayment();
      setStatus(
        'info',
        'The secure total is now ' +
          formatUsd(failure.amount) +
          '. Click Pay ' +
          formatUsd(failure.amount) +
          ' Securely to approve the recalculated total. No charge has been made.',
      );
      return;
    }
    if (
      failure.error === 'quote_not_payable' ||
      failure.error === 'payment_not_ready' ||
      failure.error === 'email_required'
    ) {
      paymentBlocked = true;
      acceptedPaymentAmount = null;
      paymentRetryAvailable = false;
      markRequestReceived();
      setPayNowBusy(false);
      syncFacilityPayment();
      setStatus(
        'error',
        'Your request was received, but secure payment is not available for this estimate. Sparkling Standard will confirm the price and payment options with you. No payment has been taken by this website.',
      );
      return;
    }
    paymentRetryAvailable = true;
    markRequestReceived();
    setPayNowBusy(false);
    syncFacilityPayment();
    setStatus(
      'error',
      'Your request was received, but secure checkout could not start right now. You can try payment again, or arrange payment when we confirm your appointment. No payment has been taken by this website.',
    );
  }

  async function retryPendingPayment(): Promise<void> {
    if (!pendingPaymentFields || paymentBusy) return;
    setPayNowBusy(true);
    setStatus('info', 'Opening secure checkout...');
    const started = await startSecurePayment(pendingPaymentFields, acceptedPaymentAmount);
    if (!started.ok) handlePaymentFailure(started);
  }

  async function handleSubmit(paymentChoice: 'reserve' | 'pay_now' = 'reserve'): Promise<void> {
    if (paymentChoice === 'pay_now' && pendingPaymentFields) {
      await retryPendingPayment();
      return;
    }
    const invalid = validateAllSteps();
    if (invalid) {
      maxVisitedStep = Math.max(maxVisitedStep, invalid.step);
      showStep(invalid.step, false);
      showErrorSummary(invalid.errors, 'send');
      namedElement(invalid.errors[0]!.name)?.focus();
      return;
    }
    if (photoController.isUploading()) {
      setStatus('info', 'Please wait for the photos to finish uploading before sending your request.');
      return;
    }

    const honeypot = host.querySelector<HTMLInputElement>('input[name="extra_ref"]');
    if (honeypot && honeypot.value.trim() !== '') {
      setStatus('error', failureCopy('spam_rejected', contact));
      return;
    }
    if (Date.now() - mountedAt < 2500) {
      setStatus('error', failureCopy('spam_rejected', contact));
      return;
    }

    const submission = finder?.getSubmission();
    const zip = submission?.zip ?? field('zip');
    if (!zip && !submission?.location) {
      setStatus('error', 'Please confirm the facility location or enter a ZIP code.');
      if (submission?.method === 'gps' || submission?.location) {
        host.querySelector<HTMLButtonElement>('[data-address-gps]')?.focus();
      } else {
        host.querySelector<HTMLInputElement>('#est-zip')?.focus();
      }
      return;
    }

    if (!travel && submission?.location) {
      await lookupTravel(submission.location.lat, submission.location.lng);
    }

    const organization = field('organization');
    const fields: Record<string, string> = {
      engine_type: facilityEngine,
      payment_choice: paymentChoice === 'pay_now' ? 'pay_now' : 'reserve',
      request_type: 'facility_estimate',
      estimate_status: 'custom_confirmation_required',
      service_type: facilityEngine === 'church' ? 'church_cleaning' : 'commercial_cleaning',
      organization,
      name: field('name'),
      contact_role: field('contact_role'),
      phone: field('phone'),
      email: field('email'),
      terms_accepted: host.querySelector<HTMLInputElement>('input[name="termsAccepted"]')?.checked
        ? 'yes'
        : 'no',
      terms_version: legalTerms.termsVersion,
      facility_type: field('facility_type') || (facilityEngine === 'church' ? 'church' : ''),
      cleanable_sqft: field('cleanable_sqft'),
      restroom_fixtures: field('restroom_fixtures'),
      flooring: field('flooring'),
      first_clean: field('first_clean'),
      workstations: field('workstations'),
      breakroom: field('breakroom'),
      traffic: field('traffic'),
      specialty_services: field('specialty_services'),
      sanctuary_seats: field('sanctuary_seats'),
      classroom_count: field('classroom_count'),
      nursery: field('nursery'),
      weekly_events: field('weekly_events'),
      condition: field('condition'),
      frequency: field('frequency'),
      preferred_date: field('preferred_date'),
      time_preference: field('time_preference'),
      preferred_days: field('preferred_days'),
      access_notes: field('access_notes'),
      notes: field('notes'),
      address_method: submission?.method ?? 'manual',
      service_address: submission?.street ?? field('serviceAddress'),
      address_unit: submission?.unit ?? field('addressUnit'),
      address_city: submission?.city ?? field('addressCity'),
      address_state: submission?.state ?? field('addressState'),
      zip,
      travel_mode: travel ? (travel.verified ? 'routed' : 'straight_line_estimate') : 'unavailable',
      travel_verified: travel?.verified ? 'true' : 'false',
      travel_one_way_miles: travel ? String(travel.oneWayMiles) : '',
      travel_qualification: travel?.verified ? 'verified_route' : 'manual_review',
      ...(submission?.location
        ? {
            destination_lat: String(submission.location.lat),
            destination_lng: String(submission.location.lng),
          }
        : {}),
      partnership_volunteering: field('partnership_volunteering'),
      partnership_initiatives: field('partnership_initiatives'),
      partnership_congregation: field('partnership_congregation'),
      partnership_contact: field('partnership_contact'),
      partnership_none: field('partnership_none'),
      ...(photoController.keys()
        ? {
            photo_keys: photoController.keys(),
            photo_request_ref: photoController.requestRef,
            photo_count: String(photoController.photoCount()),
          }
        : {}),
      ...attributionFields(),
    };

    const selectedHold = bookingPicker?.holdFields() ?? null;
    if (selectedHold) Object.assign(fields, selectedHold);

    if (facilityEngine === 'church') {
      if (pricing.churchDiscount.enabled.value) {
        fields.church_discount_percent = String(pricing.churchDiscount.percent.value);
        fields.church_discount_terms_version = pricing.churchDiscount.termsVersion.value;
      }
    }

    if (numericEstimatesEnabled && latestPrice && latestWorkload) {
      fields.facility_tier = latestPrice.tier;
      fields.cleaning_subtotal = String(latestPrice.cleaningSubtotal);
      fields.labor_hours = String(latestWorkload.laborHours);
      fields.commercial_rate = String(pricing.commercialPricing.grossRatePerHour.value);
      fields.travel_adjustment = String(latestPrice.travelAdjustment);
      fields.quote_config_version = pricing.commercialPricing.configVersion.value;
      if (latestPrice.priced) {
        fields.quoted_price = String(latestPrice.total);
        fields.quoted_range = latestPrice.range
          ? `$${latestPrice.range.low}-$${latestPrice.range.high}`
          : '';
        if (latestPrice.monthly) fields.monthly_price = String(latestPrice.monthly);
        if (latestPrice.discount?.applied) {
          fields.church_discount_amount = String(latestPrice.discount.amount);
          fields.church_savings = String(latestPrice.discount.amount);
        }
        fields.estimate_status = 'estimated';
      } else {
        fields.estimate_status = 'custom_confirmation_required';
      }
    }

    if (submitButton) submitButton.disabled = true;
    if (paymentChoice === 'pay_now') setPayNowBusy(true);
    setStatus('info', paymentChoice === 'pay_now' ? 'Saving your request and preparing secure checkout…' : 'Sending your request…');

    const subject =
      facilityEngine === 'church'
        ? `Church cleaning request — ${organization || 'church'}`
        : `Commercial estimate request — ${organization || 'facility'}`;

    const outcome = await submitLead(fields, subject);

    if (outcome.ok) {
      if (paymentChoice === 'pay_now') {
        pendingPaymentFields = { ...fields };
        markRequestReceived();
      }
      fields.photo_count = String(outcome.photoCount ?? 0);
      if ((outcome.photoCount ?? 0) === 0) {
        delete fields.photo_keys;
        delete fields.photo_request_ref;
      }
      saveSubmissionSummary(fields);
      if (paymentChoice === 'pay_now') {
        setStatus('info', 'Request received. Opening secure checkout...');
        const started = await startSecurePayment(pendingPaymentFields!, acceptedPaymentAmount);
        if (!started.ok) handlePaymentFailure(started);
        return;
      }
      const event = facilityEngine === 'church' ? 'church_request_submit' : 'commercial_quote_submit';
      recordConversion(event, { ...(fields.facility_type ? { facility_type: fields.facility_type } : {}) });
      if (result && resultTitle && resultNote) {
        result.hidden = false;
        resultTitle.textContent = facilityEngine === 'church' ? 'Church request received' : 'Facility request received';
        resultNote.textContent =
          facilityEngine === 'church'
            ? latestPrice?.priced
              ? `Not booked yet. Sparkling Standard will review your preliminary estimate and confirm the final scope, price and your ${churchDiscountLabel} personally.`
              : `Not booked yet. Sparkling Standard will review the scope and confirm your ${churchDiscountLabel} and price personally.`
            : latestPrice?.priced
              ? 'Not booked yet. Sparkling Standard will review your preliminary estimate and confirm the final scope and price personally.'
              : 'Not booked yet. Sparkling Standard will review the scope and confirm the price personally.';
      }
      setStatus(
        'success',
        'Request received — not booked yet. Sparkling Standard reviews every request personally and will confirm scope, date and price with you before anything is scheduled.',
      );
      addressVerificationPending = false;
      addressReviewRequired = false;
      host.reset();
      renderSummary();
      window.setTimeout(() => {
        window.location.assign('/thank-you/');
      }, 1200);
      return;
    }

    if (submitButton) submitButton.disabled = false;
    if (paymentChoice === 'pay_now') setPayNowBusy(false);
    else if (payNowButton) payNowButton.disabled = false;
    const reason = (outcome.reason ?? 'unknown') as FailureReason;
    setStatus('error', failureCopy(reason, contact));
  }

  renderSummary();
  updateSummary();
  void (async () => {
    try {
      const response = await fetch('/api/estimate-checkout', { headers: { Accept: 'application/json' } });
      const data = (await response.json().catch(() => ({}))) as { ok?: boolean; enabled?: boolean };
      paymentEnabled = response.ok && data.ok === true && data.enabled === true;
    } catch {
      paymentEnabled = false;
    }
    syncFacilityPayment();
  })();
}
