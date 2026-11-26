// Gift-certificate purchase client (active only when the owner enables sales).
// Sends the request to /api/gift-checkout, which resolves the amount
// server-side and returns a Stripe-hosted Checkout URL. No card data ever
// touches this page; no certificate is issued from the browser.

import { legalTerms } from '../config/legal';

export {};

const form = document.querySelector<HTMLFormElement>('[data-gift-purchase]');
if (form) {
  const status = form.querySelector<HTMLElement>('[data-form-status]');
  const amountRadios = [...form.querySelectorAll<HTMLInputElement>('[data-gift-amount]')];
  const customField = form.querySelector<HTMLElement>('[data-gift-custom-field]');
  const customValue = form.querySelector<HTMLInputElement>('[data-gift-custom-value]');
  const validFrom = form.querySelector<HTMLInputElement>('[data-gift-valid-from]');
  const promoInput = form.querySelector<HTMLInputElement>('[data-gift-promo-code]');
  const promoStatus = form.querySelector<HTMLElement>('[data-gift-promo-status]');
  const promoSummary = form.querySelector<HTMLElement>('[data-gift-promo-summary]');
  const previewValue = document.querySelector<HTMLElement>('[data-gift-preview-value]');
  const previewRecipient = document.querySelector<HTMLElement>('[data-gift-preview-recipient]');
  const previewMessage = document.querySelector<HTMLElement>('[data-gift-preview-message]');
  const recipientName = form.querySelector<HTMLInputElement>('[data-gift-recipient-name]');
  const messageInput = form.querySelector<HTMLTextAreaElement>('[data-gift-message]');
  const deliveryMethod = form.querySelector<HTMLSelectElement>('[data-gift-delivery-method]');
  const summaryValue = document.querySelector<HTMLElement>('[data-gift-summary-value]');
  const summaryDelivery = document.querySelector<HTMLElement>('[data-gift-summary-delivery]');
  const summaryDiscountRow = document.querySelector<HTMLElement>('[data-gift-summary-discount-row]');
  const summaryDiscount = document.querySelector<HTMLElement>('[data-gift-summary-discount]');
  const summaryTotal = document.querySelector<HTMLElement>('[data-gift-summary-total]');
  let checkoutAttempt = crypto.randomUUID();
  let appliedPromo: { code: string; name: string; discountCents: number } | null = null;

  const money = (cents: number): string =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);

  form.addEventListener('input', () => {
    checkoutAttempt = crypto.randomUUID();
  });

  const selectedAmountUsd = (): number => {
    const radio = amountRadios.find((entry) => entry.checked);
    if (!radio) return 0;
    if (radio.value === 'custom') {
      const custom = Number(customValue?.value ?? 0);
      return Number.isFinite(custom) && custom > 0 ? custom : 0;
    }
    const value = Number(radio.value);
    return Number.isFinite(value) && value > 0 ? value : 0;
  };

  const giftFaceValueCents = (): number => Math.round(selectedAmountUsd() * 100);

  const resetPromo = (message = ''): void => {
    appliedPromo = null;
    if (promoStatus) promoStatus.textContent = message;
    if (promoSummary) {
      promoSummary.hidden = true;
      promoSummary.textContent = '';
    }
  };

  const syncPreview = (): void => {
    const cents = giftFaceValueCents();
    const recipient = recipientName?.value.trim() || 'Someone Special';
    const message = messageInput?.value.trim() ?? '';
    const delivery = deliveryMethod?.value === 'recipient_email' ? 'Email to recipient' : 'Printable';
    if (previewValue) previewValue.textContent = cents > 0 ? money(cents).replace('.00', '') : '$0';
    if (previewRecipient) previewRecipient.textContent = recipient;
    if (previewMessage) {
      previewMessage.hidden = !message;
      previewMessage.textContent = message;
    }
    if (summaryValue) summaryValue.textContent = money(cents);
    if (summaryDelivery) summaryDelivery.textContent = delivery;
    const discount = appliedPromo?.discountCents ?? 0;
    if (summaryDiscountRow) summaryDiscountRow.hidden = discount <= 0;
    if (summaryDiscount) summaryDiscount.textContent = discount > 0 ? `-${money(discount)}` : '-$0.00';
    if (summaryTotal) summaryTotal.textContent = money(Math.max(0, cents - discount));
  };

  const syncAmountMode = (): void => {
    const custom = amountRadios.find((entry) => entry.checked)?.value === 'custom';
    if (customField) customField.hidden = !custom;
    if (customValue) customValue.required = custom;
    if (!custom) {
      // Keep a previously typed custom value available if the customer
      // switches back, but it is not part of the current selection.
    }
    if (appliedPromo) resetPromo('Gift amount changed. Apply the code again.');
    syncPreview();
  };

  for (const radio of amountRadios) radio.addEventListener('change', syncAmountMode);
  customValue?.addEventListener('input', () => {
    if (appliedPromo) resetPromo('Gift amount changed. Apply the code again.');
    syncPreview();
  });
  recipientName?.addEventListener('input', syncPreview);
  messageInput?.addEventListener('input', syncPreview);
  deliveryMethod?.addEventListener('change', syncPreview);

  if (validFrom) {
    validFrom.min = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(
      new Date(),
    );
  }
  syncAmountMode();

  form.querySelector<HTMLButtonElement>('[data-gift-promo-apply]')?.addEventListener('click', async () => {
    const code = promoInput?.value.trim().toUpperCase() ?? '';
    if (!code) {
      resetPromo('Enter a promo code.');
      return;
    }
    const face = giftFaceValueCents();
    if (face <= 0) {
      resetPromo('Choose a gift value first.');
      return;
    }
    if (promoStatus) promoStatus.textContent = 'Checking your code...';
    try {
      const response = await fetch('/api/promotion', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          code,
          cleaningAmountCents: face,
          serviceType: 'gift_certificate',
          branchId: 'branch_pensacola',
          frequency: 'one_time',
          serviceDate: new Intl.DateTimeFormat('en-CA', {
            timeZone: 'America/Chicago',
          }).format(new Date()),
          scope: 'gift',
        }),
      });
      const result = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        name?: string;
        discountCents?: number;
      };
      if (!response.ok || !result.ok || !result.discountCents) {
        resetPromo(
          result.error === 'promotion_scope_ineligible'
            ? 'That code is not valid for gift certificates.'
            : 'That code is not available for this gift purchase.',
        );
        return;
      }
      appliedPromo = {
        code,
        name: result.name ?? code,
        discountCents: result.discountCents,
      };
      if (promoStatus) promoStatus.textContent = `${appliedPromo.name} applied.`;
      if (promoSummary) {
        promoSummary.hidden = false;
        promoSummary.textContent = `Gift value remains ${money(face)}. Total due ${money(
          Math.max(0, face - result.discountCents),
        )}.`;
      }
      syncPreview();
    } catch {
      resetPromo('We could not check that code. Please try again.');
    }
  });

  const setStatus = (state: 'info' | 'error' | 'success', message: string): void => {
    if (!status) return;
    status.dataset.state = state;
    status.textContent = message;
  };

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    if (giftFaceValueCents() <= 0) {
      setStatus('error', 'Please choose a valid gift value.');
      return;
    }
    const button = form.querySelector<HTMLButtonElement>('button[type="submit"]');
    if (button) button.disabled = true;
    setStatus('info', 'Opening secure checkout...');

    const data = new FormData(form);
    const selected = String(data.get('denominationUsd') ?? '');
    const payload = {
      purchaserName: String(data.get('name') ?? ''),
      purchaserEmail: String(data.get('email') ?? ''),
      recipientName: String(data.get('recipient_name') ?? ''),
      recipientEmail: String(data.get('recipient_email') ?? ''),
      message: String(data.get('gift_message') ?? ''),
      validFromDate: String(data.get('valid_from_date') ?? ''),
      deliveryMethod: String(data.get('delivery_method') ?? 'print'),
      denominationUsd: selected && selected !== 'custom' ? Number(selected) : undefined,
      amountUsd: data.get('gift_custom_value')
        ? Number(data.get('gift_custom_value'))
        : undefined,
      promoCode: appliedPromo?.code ?? String(data.get('promo_code') ?? '').trim().toUpperCase(),
      termsAccepted: data.get('termsAccepted') === 'yes',
      termsVersion: legalTerms.termsVersion,
      checkoutAttempt,
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
        not_enabled: 'Gift certificate purchases are not open yet - please use the request form or call us.',
        not_configured: 'Secure checkout is not connected right now. Please call or email us and we will help.',
        invalid_amount: 'Please choose a valid gift value and try again.',
        email_required: 'Please enter your email address so we can send your receipt and certificate.',
        email_invalid: 'Please enter a valid email address, such as name@yourdomain.com.',
        recipient_email_required: 'Please enter the recipient email address for email delivery.',
        recipient_email_invalid: 'Please enter a valid recipient email address, such as name@yourdomain.com.',
        valid_from_date_invalid: 'Please choose today or a future valid-from date.',
        rate_limited: 'Too many attempts - please wait a moment and try again.',
        checkout_in_progress: 'This checkout is already opening. Please wait a moment or refresh the page.',
        already_purchased: 'This gift purchase was already completed. Check your email for the certificate.',
        checkout_state_uncertain: 'We could not safely register the checkout. No charge has been made; please try again.',
        ledger_not_configured: 'Secure gift checkout is not fully configured yet. Please contact us.',
        provider_failed: 'Secure checkout could not open. No charge has been made; please try again.',
        promotion_invalid: 'That promo code is not valid for this gift purchase.',
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
