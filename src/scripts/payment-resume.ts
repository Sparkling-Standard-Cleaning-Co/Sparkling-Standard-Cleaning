export {};
// Resume a pre-payment checkout after the customer signs the required
// agreement. The server recalculates the quote, re-checks the document gate and
// returns a Stripe Checkout URL. No price or scope is trusted from this page.

interface ResumeResponse {
  ok?: boolean;
  url?: string;
  error?: string;
  reason?: string;
  amount?: number;
  quotedAmount?: number;
  reference?: string;
  signingUrl?: string;
}

const stateEl = document.querySelector<HTMLElement>('[data-resume-state]');
const referenceEl = document.querySelector<HTMLElement>('[data-resume-reference]');
const actionsEl = document.querySelector<HTMLElement>('[data-resume-actions]');
const messageEl = document.querySelector<HTMLElement>('[data-resume-message]');
const acceptButton = document.querySelector<HTMLButtonElement>('[data-resume-accept]');

const params = new URLSearchParams(window.location.search);
const token = params.get('token')?.trim() ?? '';
let pendingAmount = 0;

function setState(message: string): void {
  if (stateEl) stateEl.textContent = message;
}

function setReference(reference?: string): void {
  if (!referenceEl || !reference) return;
  referenceEl.hidden = false;
  referenceEl.textContent = `Estimate reference: ${reference}`;
}

async function start(acceptAmount?: number): Promise<void> {
  if (!token) {
    setState('This payment link is missing or invalid. Please contact Sparkling Standard.');
    return;
  }
  if (actionsEl) actionsEl.hidden = true;
  setState('Reopening secure payment…');
  try {
    const response = await fetch('/api/estimate-checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        resume_token: token,
        ...(acceptAmount !== undefined
          ? { acceptRecalculated: true, acceptedAmount: acceptAmount }
          : {}),
      }),
    });
    const data = (await response.json().catch(() => ({}))) as ResumeResponse;
    setReference(data.reference);
    if (response.ok && data.ok && data.url) {
      window.location.assign(data.url);
      return;
    }
    if (data.error === 'quote_changed') {
      pendingAmount = Number(data.amount ?? 0);
      setState('The verified amount has changed since the agreement was prepared.');
      if (messageEl) {
        messageEl.textContent = `The current verified amount is $${pendingAmount.toFixed(
          2,
        )}. Accept the verified amount to continue to Stripe. No charge occurs until you complete checkout.`;
      }
      if (actionsEl) actionsEl.hidden = false;
      return;
    }
    if (data.error === 'documents_required') {
      setState('A required document still needs your signature. Reopening the signing page…');
      if (data.signingUrl) {
        window.location.assign(data.signingUrl);
        return;
      }
      return;
    }
    if (data.error === 'resume_expired') {
      setState(
        'This resume link has expired. Your request and signature are saved. Contact Sparkling Standard to reopen secure payment for the current quote.',
      );
      return;
    }
    if (data.error === 'booking_hold_expired' || data.error === 'booking_hold_required') {
      setState(
        'The held arrival time has expired. Your signed agreement is saved, but the time must be selected again. Contact Sparkling Standard to confirm the current time and payment.',
      );
      return;
    }
    if (data.error === 'payment_not_ready') {
      setState(
        'Secure payment is temporarily unavailable. Your signed agreement is saved. Please contact Sparkling Standard.',
      );
      return;
    }
    setState(
      data.reason ||
        'We could not reopen secure payment automatically. Your signed agreement is saved. Please contact Sparkling Standard.',
    );
  } catch {
    setState(
      'We could not reach the payment service. Your signed agreement is saved. Please try again or contact Sparkling Standard.',
    );
  }
}

acceptButton?.addEventListener('click', () => {
  if (pendingAmount > 0) void start(pendingAmount);
});

void start();
