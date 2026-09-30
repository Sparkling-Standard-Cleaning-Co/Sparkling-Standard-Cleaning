// Generic lead-form handler for [data-lead-form] forms (contact, commercial,
// STR). Success is shown only after the provider confirms; every failure path
// has an honest message and a direct-contact alternative.

import { attributionFields } from '../lib/attribution';
import { submitLead, recordConversion, type SubmitOutcome } from '../lib/forms/submit';
import { track, type AnalyticsEventName } from '../lib/analytics/events';

type Variant = 'contact' | 'commercial' | 'str';

type FailureReason = Extract<SubmitOutcome, { ok: false }>['reason'];

const FAILURE_MESSAGES: Record<FailureReason, string> = {
  not_configured:
    'The message service is not connected yet. Please call or text us directly — we do not want to lose your request.',
  provider_error: 'Something went wrong sending your message. Please try again, or call or text us directly.',
  network_error: 'We could not reach the message service. Check your connection and try again, or call or text us directly.',
  server_error: 'Something went wrong on our side. Please try again, or call or text us directly.',
  spam_rejected: 'Your message could not be verified. Please try again, or call or text us directly.',
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
  return FAILURE_MESSAGES[outcome.reason];
}

function collectFields(form: HTMLFormElement): Record<string, string> {
  const fields: Record<string, string> = {};
  const data = new FormData(form);
  for (const [key, value] of data.entries()) {
    if (typeof value !== 'string') continue;
    if (key === 'company_website') continue; // honeypot never travels
    const trimmed = value.trim();
    if (trimmed) fields[key] = trimmed;
  }
  return { ...fields, ...attributionFields() };
}

function variantEvent(variant: Variant): AnalyticsEventName {
  switch (variant) {
    case 'commercial':
      return 'commercial_quote_submit';
    case 'str':
      return 'str_request_submit';
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

    // Honeypot: humans never fill a hidden "company_website" field.
    const honeypot = form.querySelector<HTMLInputElement>('input[name="company_website"]');
    if (honeypot && honeypot.value.trim() !== '') {
      setStatus(form, 'error', FAILURE_MESSAGES.spam_rejected);
      return;
    }
    // Minimum time-on-form guard: instant submits are almost always bots.
    if (Date.now() - mountedAt < 2500) {
      setStatus(form, 'error', FAILURE_MESSAGES.spam_rejected);
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
          : 'Website message';

    const outcome = await submitLead(fields, subject);

    if (outcome.ok) {
      recordConversion(variantEvent(variant), variantEventPayload(variant, fields));
      setStatus(
        form,
        'success',
        'Request received — not booked yet. The owner reviews every request personally and will confirm scope, date and price with you before anything is scheduled.',
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
