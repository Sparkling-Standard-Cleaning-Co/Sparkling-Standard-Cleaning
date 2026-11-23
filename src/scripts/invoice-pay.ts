interface InvoiceLine {
  description?: string;
  quantity?: number;
  total_cents?: number;
}

interface InvoicePayView {
  invoiceId: string;
  invoiceNumber: string;
  customerName: string;
  serviceBalanceCents: number;
  serviceTotalCents: number;
  amountPaidCents: number;
  tipOnly: boolean;
  status: string;
  lines: InvoiceLine[];
  suggestionsCents: number[];
  defaultTipCents: number;
  minimumTipCents: number;
  maximumTipCents: number;
}

interface InvoicePayResponse {
  ok?: boolean;
  error?: string;
  mode?: 'invoice' | 'tip';
  invoice?: InvoicePayView;
}

const loading = document.querySelector<HTMLElement>('[data-pay-loading]');
const errorNode = document.querySelector<HTMLElement>('[data-pay-error]');
const content = document.querySelector<HTMLElement>('[data-pay-content]');
const greeting = document.querySelector<HTMLElement>('[data-pay-greeting]');
const numberNode = document.querySelector<HTMLElement>('[data-pay-number]');
const serviceNode = document.querySelector<HTMLElement>('[data-pay-service]');
const tipLine = document.querySelector<HTMLElement>('[data-pay-tip-line]');
const totalNode = document.querySelector<HTMLElement>('[data-pay-total]');
const linesNode = document.querySelector<HTMLElement>('[data-pay-lines]');
const form = document.querySelector<HTMLFormElement>('[data-pay-form]');
const tipFieldset = document.querySelector<HTMLElement>('[data-pay-tip-fieldset]');
const choices = document.querySelector<HTMLElement>('[data-pay-choices]');
const customWrap = document.querySelector<HTMLElement>('[data-pay-custom]');
const customInput = document.querySelector<HTMLInputElement>('[data-pay-custom-input]');
const formError = document.querySelector<HTMLElement>('[data-pay-form-error]');
const submit = document.querySelector<HTMLButtonElement>('[data-pay-submit]');
const closeLink = document.querySelector<HTMLElement>('[data-pay-close]');
const params = new URLSearchParams(window.location.search);
const token = params.get('token') ?? '';
const resultStatus = params.get('status') ?? '';
let view: InvoicePayView | null = null;
let selectedTipCents = 0;

function money(cents: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(
    Math.max(0, Math.round(cents)) / 100,
  );
}

function setError(message = ''): void {
  if (!errorNode) return;
  errorNode.textContent = message;
  errorNode.hidden = !message;
}

function setFormError(message = ''): void {
  if (!formError) return;
  formError.textContent = message;
  formError.hidden = !message;
}

function selectedRadio(): HTMLInputElement | null {
  return form?.querySelector<HTMLInputElement>('input[name="tip"]:checked') ?? null;
}

function customTipCents(): number {
  const raw = Number(customInput?.value ?? '');
  if (!Number.isFinite(raw)) return 0;
  return Math.max(0, Math.round(raw * 100));
}

function currentTipCents(): number {
  const radio = selectedRadio();
  if (!radio) return 0;
  if (radio.value === 'custom') return customTipCents();
  const parsed = Number(radio.value);
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : 0;
}

function updateTotal(): void {
  if (!view) return;
  selectedTipCents = Math.min(view.maximumTipCents, currentTipCents());
  const service = view.tipOnly ? 0 : Math.max(0, view.serviceBalanceCents);
  const total = service + selectedTipCents;
  if (tipLine) tipLine.textContent = money(selectedTipCents);
  if (totalNode) totalNode.textContent = money(total);
  if (customWrap) customWrap.hidden = selectedRadio()?.value !== 'custom';
  if (formError && !formError.hidden && selectedTipCents <= view.maximumTipCents) setFormError();
  if (submit) {
    submit.hidden = total <= 0;
    submit.textContent = `Continue to secure payment — ${money(total)}`;
  }
  if (closeLink) {
    closeLink.textContent = total <= 0 ? 'Close without paying' : 'Cancel';
  }
}

function renderChoices(suggestions: number[]): void {
  if (!choices) return;
  choices.innerHTML = '';
  const add = (value: string, label: string, checked = false): void => {
    const wrapper = document.createElement('label');
    wrapper.className = 'invoice-pay__choice';
    const input = document.createElement('input');
    input.type = 'radio';
    input.name = 'tip';
    input.value = value;
    input.checked = checked;
    const span = document.createElement('span');
    span.textContent = label;
    wrapper.append(input, span);
    choices.append(wrapper);
  };
  add('0', 'No tip', true);
  for (const cents of suggestions) add(String(cents), money(cents));
  add('custom', 'Custom amount');
}

function render(viewValue: InvoicePayView): void {
  view = viewValue;
  if (loading) loading.hidden = true;
  if (content) content.hidden = false;
  if (greeting) {
    greeting.textContent = view.customerName
      ? `Hello ${view.customerName}, here is your final payment summary.`
      : 'Here is your final payment summary.';
  }
  if (numberNode) numberNode.textContent = view.invoiceNumber;
  if (serviceNode) {
    serviceNode.textContent = view.tipOnly
      ? 'Already paid'
      : money(view.serviceBalanceCents);
  }
  if (linesNode) {
    linesNode.innerHTML = '';
    for (const line of view.lines ?? []) {
      if (!line.description) continue;
      const p = document.createElement('p');
      p.textContent = `${line.description} — ${money(line.total_cents ?? 0)}`;
      linesNode.append(p);
    }
  }
  renderChoices((view.suggestionsCents ?? []).filter((value) => Number.isFinite(value)));
  for (const input of form?.querySelectorAll<HTMLInputElement>('input[name="tip"]') ?? []) {
    if (input.value === '0') input.checked = true;
  }
  if (customInput) {
    customInput.value = '';
    customInput.max = String(view.maximumTipCents / 100);
  }
  if (view.tipOnly) {
    if (tipFieldset) tipFieldset.hidden = false;
    if (loading) loading.hidden = true;
  }
  updateTotal();
}

function showTerminalStatus(): void {
  if (resultStatus === 'success') {
    if (loading) {
      loading.hidden = false;
      loading.textContent =
        'Payment received. We are recording it against your invoice and will email your receipt after verification.';
      loading.className = 'invoice-pay__status';
    }
    if (content) content.hidden = true;
    return;
  }
  if (resultStatus === 'cancelled') {
    if (loading) {
      loading.hidden = false;
      loading.textContent = 'Checkout was cancelled. No payment was taken. You can try again below.';
    }
  }
}

async function load(): Promise<void> {
  if (!token) {
    setError('This secure payment link is invalid or incomplete. Open the latest link from your invoice email.');
    if (loading) loading.hidden = true;
    return;
  }
  try {
    const response = await fetch(`/api/invoice-pay?token=${encodeURIComponent(token)}`, {
      headers: { Accept: 'application/json' },
      credentials: 'same-origin',
    });
    const data = (await response.json().catch(() => ({}))) as InvoicePayResponse;
    if (!response.ok || data.ok === false || !data.invoice) {
      setError(
        data.error === 'invoice_balance_outstanding'
          ? 'This link is for an optional gratuity only, but the invoice still has a service balance. Open the invoice payment link instead.'
          : 'This secure payment link is invalid, expired or no longer available. Open the latest link from your invoice email.',
      );
      if (loading) loading.hidden = true;
      return;
    }
    render(data.invoice);
    showTerminalStatus();
  } catch {
    setError('The secure payment page could not load. Check your connection and try again.');
    if (loading) loading.hidden = true;
  }
}

form?.addEventListener('change', () => updateTotal());
customInput?.addEventListener('input', () => {
  updateTotal();
});
form?.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!view) return;
  setFormError();
  const tipCents = Math.min(view.maximumTipCents, Math.max(0, currentTipCents()));
  if (tipCents < 0 || tipCents > view.maximumTipCents) {
    setFormError(`Enter a gratuity of ${money(view.maximumTipCents)} or less.`);
    return;
  }
  if (tipCents > 0 && tipCents < 1) {
    setFormError('Enter a valid gratuity amount.');
    return;
  }
  const service = view.tipOnly ? 0 : view.serviceBalanceCents;
  if (service + tipCents <= 0) {
    setFormError('No payment is due. You can close this page without tipping.');
    return;
  }
  if (submit) {
    submit.disabled = true;
    submit.textContent = 'Opening secure payment…';
  }
  try {
    const response = await fetch('/api/invoice-pay', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ token, tipCents }),
    });
    const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok || data.ok === false || !data.url) {
      throw new Error(String(data.error ?? 'payment_session_failed'));
    }
    window.location.assign(String(data.url));
  } catch (error) {
    const code = error instanceof Error ? error.message : 'payment_session_failed';
    setFormError(
      code === 'invoice_payment_processing'
        ? 'A payment for this invoice is already processing. Check your receipt or contact us before trying again.'
        : code === 'service_not_completed'
          ? 'The service must be marked completed before a gratuity can be collected from this link.'
          : 'The secure payment session could not be created. Please try again or contact us.',
    );
    if (submit) {
      submit.disabled = false;
      submit.textContent = `Continue to secure payment — ${money((view.tipOnly ? 0 : view.serviceBalanceCents) + tipCents)}`;
    }
  }
});

void load();
