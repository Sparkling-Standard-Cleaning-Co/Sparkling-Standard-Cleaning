// Generic lead-form handler for [data-lead-form] forms (contact, commercial,
// STR). Success is shown only after the provider confirms; every failure path
// has an honest message and a direct-contact alternative.

import { business, contactPhone, isPending } from '../config/business';
import { attributionFields } from '../lib/attribution';
import { submitLead, recordConversion, type SubmitOutcome } from '../lib/forms/submit';
import { failureCopy, type FailureReason } from '../lib/forms/failure-copy';
import { saveSubmissionSummary } from '../lib/forms/submission-receipt';
import { track, type AnalyticsEventName } from '../lib/analytics/events';

type Variant = 'contact' | 'commercial' | 'str' | 'gift';

const phone = contactPhone();
const contact = {
  phoneDisplay: phone?.display,
  email: isPending(business.email) ? undefined : business.email,
  smsEnabled: business.flags.smsEnabled,
};

function statusFor(form: HTMLFormElement): HTMLElement | null {
  return form.querySelector<HTMLElement>('[data-form-status]');
}

function setStatus(form: HTMLFormElement, state: 'success' | 'error' | 'info', message: string): void {
  const status = statusFor(form);
  if (!status) return;
  status.dataset.state = state;
  status.textContent = message;
}

function failureMessage(outcome: SubmitOutcome): string {
  if (outcome.ok) return '';
  return failureCopy(outcome.reason as FailureReason, contact);
}

function collectFields(form: HTMLFormElement): Record<string, string> {
  const fields: Record<string, string> = {};
  const data = new FormData(form);
  for (const [key, value] of data.entries()) {
    if (typeof value !== 'string') continue;
    if (key === 'extra_ref') continue; // honeypot never travels
    const trimmed = value.trim();
    if (trimmed) fields[key] = trimmed;
  }
  return { ...fields, ...attributionFields() };
}

function variantEvent(variant: Variant): AnalyticsEventName | null {
  switch (variant) {
    case 'commercial':
      return 'commercial_quote_submit';
    case 'str':
      return 'str_request_submit';
    case 'gift':
      // Gift requests are not cleaning conversions and no purchase has
      // happened; they must not be counted as successful conversions.
      return null;
    default:
      return 'cleaning_request_submit';
  }
}

function variantEventPayload(variant: Variant, fields: Record<string, string>): Record<string, unknown> {
  switch (variant) {
    case 'commercial':
      return { facility_type: fields.facility_type };
    case 'str':
      return {};
    default:
      return { journey: 'residential' };
  }
}

for (const form of document.querySelectorAll<HTMLFormElement>('[data-lead-form]')) {
  const variant = (form.dataset.variant ?? 'contact') as Variant;
  const mountedAt = Date.now();
  let startTracked = false;

  form.addEventListener(
    'focusin',
    () => {
      if (startTracked) return;
      startTracked = true;
      if (variant === 'commercial') track('commercial_quote_start', {});
      if (variant === 'str') track('str_request_start', {});
    },
    { once: false },
  );

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;

    // Honeypot: humans never fill the hidden "extra_ref" trap field.
    const honeypot = form.querySelector<HTMLInputElement>('input[name="extra_ref"]');
    if (honeypot && honeypot.value.trim() !== '') {
      setStatus(form, 'error', failureCopy('spam_rejected', contact));
      return;
    }
    // Minimum time-on-form guard: instant submits are almost always bots.
    if (Date.now() - mountedAt < 2500) {
      setStatus(form, 'error', failureCopy('spam_rejected', contact));
      return;
    }

    const submitButton = form.querySelector<HTMLButtonElement>('button[type="submit"]');
    if (submitButton) submitButton.disabled = true;
    setStatus(form, 'info', 'Sending your request…');

    const fields = collectFields(form);
    const subject =
      variant === 'commercial'
        ? `Commercial walkthrough request — ${fields.organization ?? 'facility'}`
        : variant === 'str'
          ? 'Short-term rental turnover request'
          : variant === 'gift'
            ? `Gift certificate request — ${fields.recipient_name ?? 'recipient'}`
            : 'Website message';

    const outcome = await submitLead(fields, subject);

    if (outcome.ok) {
      // Keep a single-use, sanitized copy so the thank-you page can show the
      // customer exactly what they submitted.
      saveSubmissionSummary(fields);
      const event = variantEvent(variant);
      if (event) recordConversion(event, variantEventPayload(variant, fields));
      setStatus(
        form,
        'success',
        variant === 'gift'
          ? 'Gift certificate request received. We will confirm the amount and details with you, then send a secure payment link. No payment has been taken and nothing is charged by this form.'
          : 'Request received — not booked yet. Sparkling Standard reviews every request personally and will confirm scope, date and price with you before anything is scheduled.',
      );
      form.reset();
      window.setTimeout(() => {
        window.location.assign('/thank-you/');
      }, 900);
      return;
    }

    if (submitButton) submitButton.disabled = false;
    setStatus(form, 'error', failureMessage(outcome));
  });
}
