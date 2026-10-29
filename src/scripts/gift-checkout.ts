// Gift-certificate purchase client (active only when the owner enables sales).
// Sends the request to /api/gift-checkout, which resolves the amount
// server-side and returns a Stripe-hosted Checkout URL. No card data ever
// touches this page; no certificate is issued from the browser.

import { legalTerms } from '../config/legal';

export {};

const form = document.querySelector<HTMLFormElement>('[data-gift-purchase]');
if (form) {
  const status = form.querySelector<HTMLElement>('[data-form-status]');
  const denomination = form.querySelector<HTMLSelectElement>('[data-gift-denomination]');
  const customField = form.querySelector<HTMLElement>('[data-gift-custom-field]');
  const customValue = form.querySelector<HTMLInputElement>('[data-gift-custom-value]');
  const validFrom = form.querySelector<HTMLInputElement>('[data-gift-valid-from]');

  const syncCustomValue = (): void => {
    const custom = denomination?.value === 'custom';
    if (customField) customField.hidden = !custom;
    if (customValue) {
      customValue.required = custom;
      if (!custom) customValue.value = '';
    }
  };
  denomination?.addEventListener('change', syncCustomValue);
  if (validFrom) {
    validFrom.min = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(
      new Date(),
    );
  }
  syncCustomValue();
  const setStatus = (state: 'info' | 'error' | 'success', message: string): void => {
    if (!status) return;
    status.dataset.state = state;
    status.textContent = message;
  };

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;

    const button = form.querySelector<HTMLButtonElement>('button[type="submit"]');
    if (button) button.disabled = true;
    setStatus('info', 'Opening secure checkout…');

    const data = new FormData(form);
    const payload = {
      purchaserName: String(data.get('name') ?? ''),
      purchaserEmail: String(data.get('email') ?? ''),
      recipientName: String(data.get('recipient_name') ?? ''),
      recipientEmail: String(data.get('recipient_email') ?? ''),
      message: String(data.get('gift_message') ?? ''),
      validFromDate: String(data.get('valid_from_date') ?? ''),
      deliveryMethod: String(data.get('delivery_method') ?? 'print'),
      denominationUsd:
        data.get('denominationUsd') && data.get('denominationUsd') !== 'custom'
          ? Number(data.get('denominationUsd'))
          : undefined,
      amountUsd: data.get('gift_custom_value')
        ? Number(data.get('gift_custom_value'))
        : undefined,
      termsAccepted: data.get('termsAccepted') === 'yes',
      termsVersion: legalTerms.termsVersion,
    };

    try {
      const response = await fetch('/api/gift-checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(payload),
      });
      const result = (await response.json().catch(() => ({}))) as { ok?: boolean; url?: string; error?: string };
      if (response.ok && result.ok && result.url) {
        window.location.assign(result.url);
        return;
      }
      const messages: Record<string, string> = {
        not_enabled: 'Gift certificate purchases are not open yet — please use the request form or call us.',
        not_configured: 'Secure checkout is not connected right now. Please call or email us and we will help.',
        invalid_amount: 'Please choose a valid gift value and try again.',
        email_required: 'Please enter your email address so we can send your receipt and certificate.',
        email_invalid: 'Please enter a valid email address, such as name@yourdomain.com.',
        recipient_email_required: 'Please enter the recipient’s email address for email delivery.',
        recipient_email_invalid: 'Please enter a valid recipient email address, such as name@yourdomain.com.',
        valid_from_date_invalid: 'Please choose today or a future valid-from date.',
        rate_limited: 'Too many attempts — please wait a moment and try again.',
      };
      setStatus(
        'error',
        messages[result.error ?? ''] ?? 'We could not open checkout just now. Please try again or contact us directly.',
      );
    } catch {
      setStatus('error', 'We could not reach secure checkout. Check your connection and try again, or contact us directly.');
    } finally {
      if (button) button.disabled = false;
    }
  });
}
