export {};
// Payment-success status display. Stripe's success URL is not proof of
// payment by itself; this asks the server to verify the Checkout Session.

const stateEl = document.querySelector<HTMLElement>('[data-payment-state]');
const referenceEl = document.querySelector<HTMLElement>('[data-payment-reference]');

function setState(message: string): void {
  if (stateEl) stateEl.textContent = message;
}

function setReference(reference: string | undefined): void {
  if (!referenceEl || !reference) return;
  referenceEl.hidden = false;
  referenceEl.textContent = `Estimate reference: ${reference}`;
}

async function load(): Promise<void> {
  const params = new URLSearchParams(window.location.search);
  const sessionId = params.get('session_id')?.trim() ?? '';
  const giftOrder = params.get('gift_order')?.trim() ?? '';
  if (!sessionId && !giftOrder) {
    setState(
      'We could not see a payment reference. If you completed payment, please contact us so we can verify it before scheduling.',
    );
    return;
  }
  const query = sessionId
    ? `session_id=${encodeURIComponent(sessionId)}`
    : `gift_order=${encodeURIComponent(giftOrder)}`;
  try {
    const response = await fetch(`/api/estimate-checkout?${query}`, {
      headers: { Accept: 'application/json' },
    });
    const data = (await response.json().catch(() => ({}))) as {
      ok?: boolean;
      paid?: boolean;
      status?: string;
      paymentStatus?: string;
      photosOutstanding?: boolean;
      giftOrder?: boolean;
      giftApplied?: number;
      bookingStatus?: string;
      reference?: string;
      error?: string;
    };
    if (!response.ok || !data.ok) {
      setState(
        data.error === 'stripe_unavailable'
          ? 'We could not reach Stripe to verify the payment. Please contact us before assuming the payment completed.'
          : 'We could not verify the payment status automatically. Please contact us before assuming the payment completed.',
      );
      return;
    }
    setReference(data.reference);
    if (data.paid) {
      if (data.bookingStatus === 'confirmed') {
        setState(
          'Your payment was received and your appointment is confirmed. Sparkling Standard will send the final details before the cleaning.',
        );
        return;
      }
      if (data.giftOrder) {
        setState(
          `Your gift certificate covered $${(data.giftApplied ?? 0).toFixed(2)} of this payment. ${
            data.photosOutstanding
              ? 'Booking confirmation is pending the required photos and owner review. Sparkling Standard will follow up for the photos and confirm the requested date, scope and final details personally.'
              : 'Sparkling Standard will confirm the requested date, scope and final details with you personally before the cleaning is scheduled.'
          }`,
        );
        return;
      }
      setState(
        data.photosOutstanding
          ? 'Your payment was received. Booking confirmation is pending the required photos and owner review. Sparkling Standard will follow up for the photos and confirm the requested date, scope and final details personally.'
          : 'Your payment was received. Sparkling Standard will confirm the requested date, scope and final details with you personally before the cleaning is scheduled.',
      );
      return;
    }
    if (data.status === 'open') {
      setState(
        'No completed payment is showing yet. Your cleaning request is still saved; you can contact us to finish payment.',
      );
      return;
    }
    if (data.status === 'expired') {
      setState(
        'This secure checkout expired without a completed payment. Your cleaning request may still be saved; please contact us to confirm the next step.',
      );
      return;
    }
    setState(
      'No completed payment is showing for this checkout. Your cleaning request may still be saved; please contact us to confirm the next step.',
    );
  } catch {
    setState(
      'We could not check the payment status right now. Please contact us before assuming the payment completed.',
    );
  }
}

void load();
