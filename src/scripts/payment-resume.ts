export {};
// Resume a pre-payment checkout after the customer signs the required
// agreement. The server recalculates the quote, re-checks the document gate and
// returns a Stripe Checkout URL. No price or scope is trusted from this page.

import {
  formatPricingMoney,
  type PricingSnapshot,
} from '../lib/documents/pricing-snapshot.ts';

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

interface SigningSummary {
  ok?: boolean;
  context?: {
    customerName?: string;
    propertyAddress?: string;
    serviceLabel?: string;
    serviceCode?: string;
    serviceDate?: string;
    arrivalWindow?: string;
    bookingReference?: string;
  };
  pricing?: PricingSnapshot;
  executedDownloadUrl?: string;
  customerEmailStatus?: {
    status: 'sent' | 'failed' | 'suppressed' | 'already_sent' | 'not_configured' | 'unavailable';
  };
}

const stateEl = document.querySelector<HTMLElement>('[data-resume-state]');
const referenceEl = document.querySelector<HTMLElement>('[data-resume-reference]');
const summaryEl = document.querySelector<HTMLElement>('[data-resume-summary]');
const detailsEl = document.querySelector<HTMLElement>('[data-resume-details]');
const emailEl = document.querySelector<HTMLElement>('[data-resume-email]');
const pdfEl = document.querySelector<HTMLAnchorElement>('[data-resume-pdf]');
const continueButton = document.querySelector<HTMLButtonElement>('[data-resume-continue]');
const actionsEl = document.querySelector<HTMLElement>('[data-resume-actions]');
const messageEl = document.querySelector<HTMLElement>('[data-resume-message]');
const acceptButton = document.querySelector<HTMLButtonElement>('[data-resume-accept]');

const params = new URLSearchParams(window.location.search);
const token = params.get('token')?.trim() ?? '';
const signingToken = params.get('signing_token')?.trim() ?? '';
let pendingAmount = 0;

function setState(message: string): void {
  if (stateEl) stateEl.textContent = message;
}

function setReference(reference?: string): void {
  if (!referenceEl || !reference) return;
  referenceEl.hidden = false;
  referenceEl.textContent = `Estimate reference: ${reference}`;
}

function esc(value: unknown): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function emailStatusCopy(status: SigningSummary['customerEmailStatus']): string {
  if (!status) return 'Your signed PDF is available to download here.';
  if (status.status === 'sent' || status.status === 'already_sent') {
    return 'Your signed PDF was emailed to the address on the signing request and accepted by our email provider. Keep the downloaded copy for your records.';
  }
  if (status.status === 'not_configured') {
    return 'Email delivery is not configured. Download and keep your signed PDF below.';
  }
  if (status.status === 'failed') {
    return 'Email delivery could not be confirmed. Download and keep your signed PDF below.';
  }
  return 'Your signed PDF is available to download here.';
}

function renderSigningSummary(summary: SigningSummary): void {
  if (!summary.ok || !detailsEl) return;
  const pricing = summary.pricing;
  const context = summary.context ?? {};
  const rows: Array<[string, string]> = [];
  const customer = context.customerName;
  const property = pricing?.propertyAddress || context.propertyAddress;
  const service = pricing?.serviceLabel || context.serviceLabel || context.serviceCode;
  if (customer) rows.push(['Customer', customer]);
  if (property) rows.push(['Property', property]);
  if (service) rows.push(['Service', service]);
  if (pricing?.serviceDate || context.serviceDate) rows.push(['Service date', pricing?.serviceDate || context.serviceDate || '']);
  if (pricing?.arrivalWindow || context.arrivalWindow) rows.push(['Arrival window', pricing?.arrivalWindow || context.arrivalWindow || '']);
  for (const line of pricing?.lines ?? []) {
    rows.push([line.label, formatPricingMoney(line.amountCents)]);
  }
  const total = formatPricingMoney(pricing?.totalCents ?? null);
  if (total) rows.push(['Final total', total]);
  const due = formatPricingMoney(pricing?.amountDueNowCents ?? null);
  if (due && due !== total) rows.push(['Amount due now', due]);
  detailsEl.innerHTML = rows
    .map(([label, value]) => `<div><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`)
    .join('');
  if (summaryEl) summaryEl.hidden = false;
  if (emailEl) emailEl.textContent = emailStatusCopy(summary.customerEmailStatus);
  if (pdfEl && summary.executedDownloadUrl) {
    pdfEl.href = summary.executedDownloadUrl;
    pdfEl.hidden = false;
  }
  if (continueButton) {
    continueButton.textContent = total
      ? `Pay ${total} securely`
      : 'Continue to secure payment';
  }
}

async function loadSigningSummary(): Promise<void> {
  if (!signingToken) return;
  try {
    const response = await fetch(
      `/api/document-sign?token=${encodeURIComponent(signingToken)}`,
      { headers: { Accept: 'application/json' } },
    );
    const summary = (await response.json().catch(() => ({}))) as SigningSummary;
    if (response.ok && summary.ok) renderSigningSummary(summary);
  } catch {
    // The payment action still re-verifies everything server-side.
  }
}

async function start(acceptAmount?: number): Promise<void> {
  if (!token) {
    setState('This payment link is missing or invalid. Please contact Sparkling Standard.');
    return;
  }
  if (actionsEl) actionsEl.hidden = true;
  if (continueButton) continueButton.disabled = true;
  setState('Opening secure payment…');
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
    if (continueButton) continueButton.disabled = false;
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
    if (continueButton) continueButton.disabled = false;
    setState(
      'We could not reach the payment service. Your signed agreement is saved. Please try again or contact Sparkling Standard.',
    );
  }
}

continueButton?.addEventListener('click', () => {
  void start();
});

acceptButton?.addEventListener('click', () => {
  if (pendingAmount > 0) void start(pendingAmount);
});

void loadSigningSummary().then(() => {
  if (!signingToken) void start();
});
