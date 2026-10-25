// Facility estimate engine (commercial + church) — shared location finder,
// travel lookup, and the ONE lead submission pipeline. Numeric pricing stays
// gated: the request is submitted as a scope review, and the owner notification
// carries every fact needed to quote it responsibly.
import { business, contactPhone, isPending } from '../config/business';
import { pricing } from '../config/pricing';
import { initAddressFinder } from './address-finder';
import { submitLead, recordConversion } from '../lib/forms/submit';
import { saveSubmissionSummary } from '../lib/forms/submission-receipt';
import { failureCopy, type FailureReason } from '../lib/forms/failure-copy';
import { attributionFields } from '../lib/attribution';
import { track } from '../lib/analytics/events';

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
  const status = host.querySelector<HTMLElement>('[data-form-status]');
  const submitButton = host.querySelector<HTMLButtonElement>('button[type="submit"]');
  const reviewLines = host.querySelector<HTMLElement>('[data-facility-review-lines]');
  const result = host.querySelector<HTMLElement>('[data-facility-result]');
  const resultTitle = host.querySelector<HTMLElement>('[data-facility-result-title]');
  const resultNote = host.querySelector<HTMLElement>('[data-facility-result-note]');
  const confirmedTravel = host.querySelector<HTMLElement>('[data-address-confirmed-travel]');
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
      }
    } catch {
      // Travel stays preliminary; the owner confirms eligibility personally.
    }
  }

  function renderSummary(): void {
    if (!reviewLines) return;
    const lines: string[] = [];
    const organization = field('organization');
    const sqft = field('cleanable_sqft');
    const restrooms = field('restroom_count');
    const frequency = field('frequency');
    const zip = field('zip');
    if (organization) lines.push(`<li><span>${facilityEngine === 'church' ? 'Ministry' : 'Facility'}</span><strong>${escapeHtml(organization)}</strong></li>`);
    if (sqft) lines.push(`<li><span>Cleanable area</span><strong>${escapeHtml(sqft)} sq ft</strong></li>`);
    if (restrooms) lines.push(`<li><span>Restrooms</span><strong>${escapeHtml(restrooms)}</strong></li>`);
    if (frequency) lines.push(`<li><span>Frequency</span><strong>${escapeHtml(frequency.replaceAll('_', ' '))}</strong></li>`);
    if (zip) lines.push(`<li><span>Service ZIP</span><strong>${escapeHtml(zip)}</strong></li>`);
    if (facilityEngine === 'church') {
      const percent = pricing.churchDiscount.percent.value;
      lines.push(`<li><span>Church discount</span><strong>${percent}% off eligible cleaning (applied to your confirmed quote)</strong></li>`);
    }
    lines.push('<li><span>Estimate type</span><strong>Scope review — price confirmed personally</strong></li>');
    reviewLines.innerHTML = lines.join('');
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
      restroom_count: field('restroom_count'),
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
            ? 'Not booked yet. Sparkling Standard will review the scope and confirm your 10% church discount and price personally.'
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
