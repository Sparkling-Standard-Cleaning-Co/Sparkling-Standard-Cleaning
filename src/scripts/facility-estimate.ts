// Facility estimate engine (commercial + church) — shared location finder,
// travel lookup, and the ONE lead submission pipeline. Numeric pricing is
// controlled by the owner kill switch: enabled = Tier A/B preliminary numbers,
// Tier C scope review; disabled = scope-review only with no numeric fields sent
// to the server or the owner notification.
import { business, contactPhone, isPending } from '../config/business';
import { commercialTierConfig } from '../config/commercial-tiers';
import { pricing } from '../config/pricing';
import { initAddressFinder } from './address-finder';
import { submitLead, recordConversion } from '../lib/forms/submit';
import { saveSubmissionSummary } from '../lib/forms/submission-receipt';
import { failureCopy, type FailureReason } from '../lib/forms/failure-copy';
import { attributionFields } from '../lib/attribution';
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

if (form) {
  initFacilityForm(form, engine);
}

function initFacilityForm(host: HTMLFormElement, facilityEngine: Engine): void {
  const mountedAt = Date.now();
  const numericEstimatesEnabled = commercialTierConfig.numericEstimatesEnabled;
  const status = host.querySelector<HTMLElement>('[data-form-status]');
  const submitButton = host.querySelector<HTMLButtonElement>('button[type="submit"]');
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
  let latestWorkload: FacilityWorkload | null = null;
  let latestPrice: FacilityPrice | null = null;
  let startTracked = false;
  let travel: RoutedTravel | null = null;
  let travelKey = '';

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

  const finder = initAddressFinder({
    form: host,
    onChange: (location) => {
      travel = null;
      travelKey = location ? `${location.lat},${location.lng}` : '';
      if (confirmedTravel) confirmedTravel.textContent = '';
      renderSummary();
      if (location) void lookupTravel(location.lat, location.lng);
    },
  });

  async function lookupTravel(lat: number, lng: number): Promise<void> {
    const key = `${lat},${lng}`;
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
          confirmedTravel.textContent = `${data.oneWayMiles.toFixed(1)} miles one way from our operating area — travel is included in the review of your request.`;
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

  function renderEstimate(priceLines: string[]): void {
    if (!estimatePanel || !estimatePrice || !estimateLabel || !estimateNote || !estimateLines) return;
    const price = latestPrice;
    const workload = latestWorkload;
    if (!workload || !price) {
      estimatePanel.hidden = true;
      return;
    }
    estimatePanel.hidden = false;
    estimateLines.innerHTML = priceLines.join('');
    if (!price.priced) {
      estimateLabel.textContent = 'Custom scope review';
      estimatePrice.textContent = 'Let’s confirm this together';
      if (estimateRange) estimateRange.hidden = true;
      estimateNote.textContent = numericEstimatesEnabled
        ? 'This facility has enough scope or special detail that a responsible price needs a personal review. Send the details and Sparkling Standard will confirm an exact quote.'
        : 'Numeric facility pricing is currently handled as a personal scope review. Send the details and Sparkling Standard will confirm an exact quote.';
      return;
    }
    estimateLabel.textContent = price.tier === 'B' ? 'Preliminary price range' : 'Preliminary per-visit estimate';
    estimatePrice.textContent = `$${price.total.toLocaleString()}`;
    if (estimateRange) {
      if (price.range) {
        estimateRange.hidden = false;
        estimateRange.textContent = `Typical range $${price.range.low.toLocaleString()}–$${price.range.high.toLocaleString()} per visit`;
      } else {
        estimateRange.hidden = true;
      }
    }
    estimateNote.textContent =
      'Nonbinding preliminary estimate based on the scope you entered. Final scope, condition, access and travel are confirmed personally before anything is booked.';
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
        priceLines.push(`<li><span>Cleaning (${latestWorkload.laborHours} labor hrs)</span><strong>$${latestPrice.cleaningSubtotal.toLocaleString()}</strong></li>`);
        if (latestPrice.discount?.applied) {
          priceLines.push(
            `<li><span>Church discount — 10%</span><strong>−$${latestPrice.discount.amount.toLocaleString()}</strong></li>`,
          );
          priceLines.push(`<li><span>Savings</span><strong>$${latestPrice.discount.amount.toLocaleString()} off</strong></li>`);
        }
        if (latestPrice.travelAdjustment > 0) {
          priceLines.push(`<li><span>Travel adjustment</span><strong>$${latestPrice.travelAdjustment.toLocaleString()}</strong></li>`);
        }
        if (latestPrice.monthly) {
          priceLines.push(`<li><span>Estimated monthly</span><strong>$${latestPrice.monthly.toLocaleString()}</strong></li>`);
        }
        lines.push(`<li><span>Preliminary estimate</span><strong>$${latestPrice.total.toLocaleString()} per visit</strong></li>`);
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
  }

  function renderReviewNote(): void {
    if (!reviewNote) return;
    if (!numericEstimatesEnabled) {
      reviewNote.textContent = facilityEngine === 'church'
        ? 'This is a scope-review request, not a confirmed contract. The 10% church discount applies to the confirmed cleaning quote, and Sparkling Standard confirms the scope and price personally before anything is scheduled.'
        : 'This is a scope-review request, not a confirmed contract. Sparkling Standard confirms the scope and price personally before anything is scheduled.';
      return;
    }
    if (latestPrice?.priced) {
      reviewNote.textContent = facilityEngine === 'church'
        ? 'The amount above is a nonbinding preliminary estimate with the 10% church discount applied. Final scope, travel and price are confirmed personally before anything is scheduled.'
        : 'The amount above is a nonbinding preliminary estimate. Final scope, travel and price are confirmed personally before anything is scheduled.';
      return;
    }
    if (latestPrice) {
      reviewNote.textContent = facilityEngine === 'church'
        ? 'This scope needs a personal review before a responsible price can be given. The 10% church discount applies to the confirmed cleaning quote, and Sparkling Standard confirms the scope and price personally.'
        : 'This scope needs a personal review before a responsible price can be given. Sparkling Standard confirms the scope and price personally before anything is scheduled.';
      return;
    }
    reviewNote.textContent = facilityEngine === 'church'
      ? 'Enter the facility details to see a preliminary estimate. The 10% church discount applies to the confirmed cleaning quote, and Sparkling Standard confirms the scope and price personally before anything is scheduled.'
      : 'Enter the facility details to see a preliminary estimate. Final scope, travel and price are confirmed personally before anything is scheduled.';
  }

  function escapeHtml(value: string): string {
    return value
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;');
  }

  function updateSummary(): void {
    const zip = field('zip');
    const currentKey = zip ? `zip:${zip}` : '';
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

  host.addEventListener('submit', (event) => {
    event.preventDefault();
    void handleSubmit();
  });

  async function handleSubmit(): Promise<void> {
    if (!host.reportValidity()) return;

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
    if (!zip) {
      setStatus('error', 'Please confirm the facility address or ZIP code.');
      host.querySelector<HTMLInputElement>('#est-zip')?.focus();
      return;
    }

    if (!travel && submission?.location) {
      await lookupTravel(submission.location.lat, submission.location.lng);
    }

    const organization = field('organization');
    const fields: Record<string, string> = {
      engine_type: facilityEngine,
      request_type: 'facility_estimate',
      estimate_status: 'custom_confirmation_required',
      service_type: facilityEngine === 'church' ? 'church_cleaning' : 'commercial_cleaning',
      organization,
      name: field('name'),
      contact_role: field('contact_role'),
      phone: field('phone'),
      email: field('email'),
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
      ...attributionFields(),
    };

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
    setStatus('info', 'Sending your request…');

    const subject =
      facilityEngine === 'church'
        ? `Church cleaning request — ${organization || 'church'}`
        : `Commercial estimate request — ${organization || 'facility'}`;

    const outcome = await submitLead(fields, subject);

    if (outcome.ok) {
      saveSubmissionSummary(fields);
      const event = facilityEngine === 'church' ? 'church_request_submit' : 'commercial_quote_submit';
      recordConversion(event, { ...(fields.facility_type ? { facility_type: fields.facility_type } : {}) });
      if (result && resultTitle && resultNote) {
        result.hidden = false;
        resultTitle.textContent = facilityEngine === 'church' ? 'Church request received' : 'Facility request received';
        resultNote.textContent =
          facilityEngine === 'church'
            ? latestPrice?.priced
              ? 'Not booked yet. Sparkling Standard will review your preliminary estimate and confirm the scope, travel, final price and your 10% church discount personally.'
              : 'Not booked yet. Sparkling Standard will review the scope and confirm your 10% church discount and price personally.'
            : latestPrice?.priced
              ? 'Not booked yet. Sparkling Standard will review your preliminary estimate and confirm the scope, travel and final price personally.'
              : 'Not booked yet. Sparkling Standard will review the scope and confirm the price personally.';
      }
      setStatus(
        'success',
        'Request received — not booked yet. Sparkling Standard reviews every request personally and will confirm scope, date and price with you before anything is scheduled.',
      );
      host.reset();
      renderSummary();
      window.setTimeout(() => {
        window.location.assign('/thank-you/');
      }, 1200);
      return;
    }

    if (submitButton) submitButton.disabled = false;
    const reason = (outcome.reason ?? 'unknown') as FailureReason;
    setStatus('error', failureCopy(reason, contact));
  }

  renderSummary();
  updateSummary();
}
