// Payment-success status display. Stripe's success URL is not proof of
// payment by itself; this asks the server to verify the Checkout Session.

const stateEl = document.querySelector<HTMLElement>('[data-payment-state]');

function setState(message: string): void {
  if (stateEl) stateEl.textContent = message;
}

async function load(): Promise<void> {
  const params = new URLSearchParams(window.location.search);
  const sessionId = params.get('session_id')?.trim() ?? '';
  if (!sessionId) {
    setState(
      'We could not see a Stripe checkout reference. If you completed payment, please contact us so we can verify it before scheduling.',
    );
    return;
  }
  try {
    const response = await fetch(`/api/estimate-checkout?session_id=${encodeURIComponent(sessionId)}`, {
      headers: { Accept: 'application/json' },
    });
    const data = (await response.json().catch(() => ({}))) as {
      ok?: boolean;
      paid?: boolean;
      status?: string;
      amount?: number | null;
    };
    if (!response.ok || !data.ok) {
      setState(
        'We could not verify the payment status automatically. Please contact us before assuming the payment completed.',
      );
      return;
    }
    if (data.paid) {
      setState(
        'Your payment was received. Sparkling Standard will confirm the requested date, scope and final details with you personally before the cleaning is scheduled.',
      );
      return;
    }
    setState(
      data.status === 'open'
        ? 'Your secure checkout was opened but no completed payment is showing yet. Your cleaning request is still saved, and you can contact us to finish payment.'
        : 'No completed payment is showing for this checkout. Your cleaning request may still be saved; please contact us to confirm the next step.',
    );
  } catch {
    setState(
      'We could not check the payment status right now. Please contact us before assuming the payment completed.',
    );
  }
}

void load();
