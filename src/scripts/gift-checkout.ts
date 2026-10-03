// Gift-certificate purchase client (active only when the owner enables sales).
// Sends the request to /api/gift-checkout, which resolves the amount
// server-side and returns a Stripe-hosted Checkout URL. No card data ever
// touches this page; no certificate is issued from the browser.

export {};

const form = document.querySelector<HTMLFormElement>('[data-gift-purchase]');
if (form) {
  const status = form.querySelector<HTMLElement>('[data-form-status]');
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
      deliveryDate: String(data.get('delivery_date') ?? ''),
      denominationUsd: data.get('denominationUsd') ? Number(data.get('denominationUsd')) : undefined,
      amountUsd: data.get('gift_value') ? Number(data.get('gift_value')) : undefined,
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
