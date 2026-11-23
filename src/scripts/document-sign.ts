import { renderDocumentHtml } from '../lib/documents/rich-text.ts';
import {
  formatPricingMoney,
  type PricingSnapshot,
} from '../lib/documents/pricing-snapshot.ts';

interface SigningDocument {
  templateId: string;
  title: string;
  version: string;
  contentSha256: string;
  contentText: string;
  sourceKind: 'text' | 'pdf';
  signerParty: string;
  required: boolean;
  stage: string;
  signed: boolean;
  canResign?: boolean;
  signatureStatus?: string;
  downloadUrl: string;
}

interface SigningFieldOption {
  value: string;
  label: string;
  description?: string;
}

interface SigningFieldDefinition {
  key: string;
  label: string;
  type: 'radio' | 'checkbox' | 'textarea' | 'text' | 'tel' | 'date' | 'time' | 'select';
  required: boolean;
  options?: SigningFieldOption[];
  placeholder?: string;
  help?: string;
  maxLength?: number;
  summaryLabel: string;
}

interface CustomerEmailStatus {
  status: 'sent' | 'failed' | 'suppressed' | 'already_sent' | 'not_configured' | 'unavailable';
  providerId?: string;
  reason?: string;
}

interface SigningPayload {
  ok: boolean;
  request?: {
    id: string;
    bundleCode: string;
    bundleName?: string;
    bundleVersion: number;
    subjectType: string;
    status: string;
    expiresAt: string;
    instructions?: string;
  };
  context?: {
    customerName?: string;
    customerEmail?: string;
    propertyAddress?: string;
    bookingReference?: string;
    serviceCode?: string;
    serviceLabel?: string;
    serviceDate?: string;
    arrivalWindow?: string;
    priceSummary?: string;
    paymentTerms?: string;
  };
  pricing?: PricingSnapshot;
  customerFields?: {
    definitions?: SigningFieldDefinition[];
    values?: Record<string, string>;
  };
  documents?: SigningDocument[];
  signedTemplateIds?: string[];
  consentVersion?: string;
  resumeCheckoutUrl?: string;
  executedDownloadUrl?: string;
  customerEmailStatus?: CustomerEmailStatus;
  error?: string;
}

interface AdoptedSignature {
  value: string;
  type: 'typed' | 'drawn';
  imageData?: string;
}

interface AppliedSignature extends AdoptedSignature {
  appliedAt: string;
}

const statusNode = document.querySelector<HTMLElement>('[data-document-status]');
const content = document.querySelector<HTMLElement>('[data-document-content]');
const dialog = document.querySelector<HTMLDialogElement>('[data-document-dialog]');
const dialogTitle = document.querySelector<HTMLElement>('[data-document-dialog-title]');
const dialogBody = document.querySelector<HTMLElement>('[data-document-dialog-body]');
const dialogClose = document.querySelector<HTMLButtonElement>('[data-document-dialog-close]');
const signatureDialog = document.querySelector<HTMLDialogElement>('[data-signature-dialog]');
const signatureDialogBody = document.querySelector<HTMLElement>('[data-signature-dialog-body]');
const params = new URLSearchParams(window.location.search);
const token = params.get('token') ?? '';
const returnParam = params.get('return') ?? '';
const returnPath = returnParam.startsWith('/') && !returnParam.startsWith('//') ? returnParam : '';
const resumeToken = params.get('resume') ?? '';

let step = 1;
let documents: SigningDocument[] = [];
let fields: SigningFieldDefinition[] = [];
let fieldValues: Record<string, string> = {};
let adoptedSignature: AdoptedSignature | null = null;
let appliedSignatures: Record<string, AppliedSignature> = {};
let submitting = false;
let canvasDrawing = false;
let drawnTouched = false;
let modalMethod: 'typed' | 'drawn' = 'typed';

function esc(value: unknown): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function message(value: string, kind: 'error' | 'ok' = 'ok'): void {
  if (!statusNode) return;
  statusNode.textContent = value;
  statusNode.dataset.kind = kind;
}

function unsignedRequired(): SigningDocument[] {
  return documents.filter((document) => document.required && !document.signed);
}

function needsSignature(document: SigningDocument): boolean {
  return !document.signed;
}

function signatureProgress(): { applied: number; total: number } {
  const signable = documents.filter((document) => needsSignature(document));
  const applied = signable.filter((document) => Boolean(appliedSignatures[document.templateId])).length;
  return { applied, total: signable.length };
}

function signerName(): string {
  return content?.querySelector<HTMLInputElement>('input[name="signerName"]')?.value.trim() ?? '';
}

function isCompleted(): boolean {
  return documents.length === 0 || unsignedRequired().length === 0;
}

function summaryValue(value: string | undefined): string {
  return value && value.trim() ? value.trim() : 'To be confirmed';
}

function pricingRows(pricing: PricingSnapshot): Array<[string, string]> {
  const rows: Array<[string, string]> = [];
  if (pricing.serviceLabel) rows.push(['Service', pricing.serviceLabel]);
  if (pricing.propertyAddress) rows.push(['Property', pricing.propertyAddress]);
  if (pricing.frequency) rows.push(['Frequency', pricing.frequency.replaceAll('_', ' ')]);
  if (pricing.serviceDate) rows.push(['Service date', pricing.serviceDate]);
  if (pricing.arrivalWindow) rows.push(['Arrival window', pricing.arrivalWindow]);
  return rows;
}

function renderPricing(payload: SigningPayload): string {
  const pricing = payload.pricing;
  if (!pricing) {
    return `<dl class="signing-summary">${[
      ['Customer', summaryValue(payload.context?.customerName)],
      ['Property', summaryValue(payload.context?.propertyAddress)],
      ['Service', summaryValue(payload.context?.serviceLabel || payload.context?.serviceCode)],
      ['Booking reference', summaryValue(payload.context?.bookingReference)],
      ['Service date', summaryValue(payload.context?.serviceDate)],
      ['Arrival window', summaryValue(payload.context?.arrivalWindow)],
      ['Price', summaryValue(payload.context?.priceSummary)],
      ['Payment terms', summaryValue(payload.context?.paymentTerms)],
    ]
      .map(([label, value]) => `<div><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`)
      .join('')}</dl>`;
  }
  const rows = pricingRows(pricing);
  const lines = pricing.lines.length
    ? `<div class="signing-price-lines">${pricing.lines
        .map(
          (line) =>
            `<div class="signing-price-line${line.kind === 'discount' ? ' signing-price-line--credit' : ''}"><span>${esc(line.label)}</span><strong>${esc(formatPricingMoney(line.amountCents))}</strong></div>`,
        )
        .join('')}</div>`
    : '';
  const total = formatPricingMoney(pricing.totalCents);
  const due = formatPricingMoney(pricing.amountDueNowCents);
  const remaining = formatPricingMoney(pricing.remainingBalanceCents);
  return `<div class="signing-price-panel">
    ${rows.length ? `<dl class="signing-summary">${rows.map(([label, value]) => `<div><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`).join('')}</dl>` : ''}
    ${pricing.scope ? `<div class="signing-price-block"><h3>Included scope</h3><p>${esc(pricing.scope)}</p></div>` : ''}
    ${pricing.addOns && !/^none$/i.test(pricing.addOns) ? `<div class="signing-price-block"><h3>Add-ons</h3><p>${esc(pricing.addOns)}</p></div>` : ''}
    ${lines}
    <div class="signing-price-total">
      ${total ? `<div><span>Final total</span><strong>${esc(total)}</strong></div>` : ''}
      ${due && due !== total ? `<div><span>Amount due now</span><strong>${esc(due)}</strong></div>` : ''}
      ${remaining && pricing.remainingBalanceCents ? `<div><span>Remaining balance</span><strong>${esc(remaining)}</strong></div>` : ''}
    </div>
    ${pricing.paymentTerms ? `<p class="signing-muted">${esc(pricing.paymentTerms)}</p>` : ''}
    ${pricing.note ? `<p class="signing-muted">${esc(pricing.note)}</p>` : ''}
  </div>`;
}

function fieldControl(field: SigningFieldDefinition, value: string): string {
  const id = `field-${field.key}`;
  const help = field.help ? `<p class="signing-muted">${esc(field.help)}</p>` : '';
  if (field.type === 'radio' || field.type === 'select') {
    if (field.type === 'select') {
      return `<div class="signing-field${field.maxLength && field.maxLength > 200 ? ' signing-field--wide' : ''}">
        <label for="${esc(id)}">${esc(field.label)}${field.required ? ' (required)' : ''}</label>
        <select id="${esc(id)}" name="${esc(field.key)}"${field.required ? ' required' : ''}>
          <option value="">Choose one</option>
          ${(field.options ?? [])
            .map(
              (option) =>
                `<option value="${esc(option.value)}"${value === option.value ? ' selected' : ''}>${esc(option.label)}</option>`,
            )
            .join('')}
        </select>${help}</div>`;
    }
    return `<fieldset class="signing-field signing-field--wide">
      <legend>${esc(field.label)}${field.required ? ' (required)' : ''}</legend>
      <div class="signing-options">
        ${(field.options ?? [])
          .map(
            (option) =>
              `<label class="signing-option"><input type="radio" name="${esc(field.key)}" value="${esc(option.value)}"${value === option.value ? ' checked' : ''}${field.required ? ' required' : ''} /><span>${esc(option.label)}${option.description ? `<small>${esc(option.description)}</small>` : ''}</span></label>`,
          )
          .join('')}
      </div>${help}</fieldset>`;
  }
  if (field.type === 'checkbox') {
    return `<label class="signing-ack signing-field--wide"><input type="checkbox" name="${esc(field.key)}" value="yes"${value === 'yes' ? ' checked' : ''} /><span>${esc(field.label)}${help ? `<span class="signing-muted">${esc(field.help)}</span>` : ''}</span></label>`;
  }
  if (field.type === 'textarea') {
    return `<div class="signing-field signing-field--wide">
      <label for="${esc(id)}">${esc(field.label)}${field.required ? ' (required)' : ''}</label>
      <textarea id="${esc(id)}" name="${esc(field.key)}" maxlength="${field.maxLength ?? 1500}" placeholder="${esc(field.placeholder ?? '')}"${field.required ? ' required' : ''}>${esc(value)}</textarea>${help}</div>`;
  }
  const type = field.type === 'tel' ? 'tel' : field.type === 'date' ? 'date' : field.type === 'time' ? 'time' : 'text';
  return `<div class="signing-field">
    <label for="${esc(id)}">${esc(field.label)}${field.required ? ' (required)' : ''}</label>
    <input id="${esc(id)}" type="${type}" name="${esc(field.key)}" value="${esc(value)}" maxlength="${field.maxLength ?? 200}" placeholder="${esc(field.placeholder ?? '')}"${field.required ? ' required' : ''} />${help}</div>`;
}

function renderFields(): string {
  if (fields.length === 0) {
    return '<div class="signing-card"><h2>Access and instructions</h2><p class="signing-muted">No additional access choices are required for this document set. If you need to provide instructions, reply to your Sparkling Standard message before the appointment.</p></div>';
  }
  return `<div class="signing-card">
    <h2>Access and service instructions</h2>
    <p class="signing-muted">These choices become part of your signed service schedule. The approved agreement wording is unchanged. Do not enter a permanent master code or password.</p>
    <div class="signing-fields">${fields.map((field) => fieldControl(field, fieldValues[field.key] ?? '')).join('')}</div>
  </div>`;
}

function documentMeta(document: SigningDocument): string {
  const badges = [
    `<span class="signing-badge ${document.required ? 'signing-badge--required' : ''}">${document.required ? 'Required' : 'Optional'}</span>`,
    document.signed ? '<span class="signing-badge signing-badge--signed">Signed</span>' : '',
    appliedSignatures[document.templateId]
      ? '<span class="signing-badge signing-badge--signed">Signature applied</span>'
      : '',
  ].join(' ');
  return `<div class="signing-document__head"><div><h3>${esc(document.title)}</h3></div><div>${badges}</div></div>`;
}

function documentActions(document: SigningDocument): string {
  if (document.sourceKind === 'text') {
    return `<div class="signing-document__actions"><button class="signing-btn signing-btn--secondary" type="button" data-document-read="${esc(document.templateId)}">Read document</button></div>`;
  }
  return `<div class="signing-document__actions"><a class="signing-btn signing-btn--secondary" href="${esc(document.downloadUrl)}" target="_blank" rel="noopener">Open PDF</a></div>`;
}

function signatureSlot(document: SigningDocument): string {
  if (document.signed) {
    return `<p class="signing-muted">Already signed. This document does not need another signature.</p>`;
  }
  const applied = appliedSignatures[document.templateId];
  const label = document.required ? 'X — Sign here' : 'X — Sign this optional document';
  return `<div class="signing-signature-slot${applied ? ' is-signed' : ''}${selectedNext(document) ? ' is-next' : ''}" role="button" tabindex="0" aria-label="${esc(label)}: ${esc(document.title)}" data-signature-slot="${esc(document.templateId)}">
    <span class="signing-signature-slot__x" aria-hidden="true">X</span>
    <span class="signing-signature-slot__copy">
      <strong>${applied ? 'Signature applied' : label}</strong>
      <small>${applied ? `Applied ${new Date(applied.appliedAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}` : 'Click this box to sign explicitly. Nothing is signed automatically.'}</small>
    </span>
    ${applied
      ? applied.type === 'drawn' && applied.imageData
        ? `<img class="signing-signature-slot__image" src="${esc(applied.imageData)}" alt="Your applied signature" />`
        : `<span class="signing-signature-slot__value">${esc(applied.value)}</span>`
      : ''}
  </div>`;
}

function selectedNext(document: SigningDocument): boolean {
  if (appliedSignatures[document.templateId] || document.signed) return false;
  const firstUnsigned = documents.find((entry) => needsSignature(entry) && !appliedSignatures[entry.templateId]);
  return firstUnsigned?.templateId === document.templateId;
}

function renderDocuments(): string {
  return documents
    .map(
      (document) =>
        `<article class="signing-document" data-document-card="${esc(document.templateId)}">${documentMeta(document)}${documentActions(document)}${signatureSlot(document)}</article>`,
    )
    .join('');
}

function renderSigner(payload: SigningPayload): string {
  const context = payload.context ?? {};
  return `<div class="signing-card signing-signer-card">
    <h2>Your signature</h2>
    <p class="signing-muted">Enter your legal name once. Each required box below must be clicked. The first signature opens the signature pad; later boxes apply the same adopted signature only when you click them.</p>
    <p class="signing-muted" data-signature-change-row hidden><button class="signing-btn signing-btn--ghost signing-btn--inline" type="button" data-signature-change>Change adopted signature</button></p>
    <div class="signing-field">
      <label for="signing-name">Your full legal name</label>
      <input id="signing-name" name="signerName" type="text" autocomplete="name" value="${esc(context.customerName ?? '')}" required />
    </div>
    <div class="signing-field">
      <label for="signing-email">Your email</label>
      <input id="signing-email" name="signerEmail" type="email" autocomplete="email" value="${esc(context.customerEmail ?? '')}" required />
    </div>
    <div class="signing-card" style="box-shadow:none;padding:.75rem;margin:.8rem 0;background:#fdf8f2;">
      <h3>Electronic records and signatures</h3>
      <p class="signing-disclosure">You need a current web browser, internet access, and the ability to view, print or save a PDF or text record. You may request a paper copy at any time by emailing <a href="mailto:admin@sparkling-standard.com?subject=Paper%20copy%20request">admin@sparkling-standard.com</a>. You may withdraw consent to future electronic records by written notice to the same address. Withdrawal does not affect a record you already signed. Keep your email address and phone number current.</p>
    </div>
    <label class="signing-ack"><input type="checkbox" name="consent" /><span>I can access and retain these documents electronically, and I consent to use electronic signatures and electronic records. I understand my adopted signature is my legal signature.</span></label>
    <p class="signing-muted">A signed copy and audit record are retained privately.</p>
  </div>`;
}

function renderWizard(payload: SigningPayload): void {
  if (!content) return;
  documents = payload.documents ?? [];
  fields = payload.customerFields?.definitions ?? [];
  fieldValues = { ...(payload.customerFields?.values ?? {}) };
  appliedSignatures = {};
  adoptedSignature = null;
  const required = unsignedRequired();
  const totalRequired = documents.filter((document) => document.required).length;
  content.hidden = false;
  content.innerHTML = `
    <h1 class="signing-title">${esc(payload.request?.bundleName || payload.request?.bundleCode || 'Your documents')}</h1>
    <p class="signing-lead">Review the details and price, complete the access choices, then click each signature box. Required documents: ${totalRequired}. Already signed: ${totalRequired - required.length}.</p>
    ${payload.request?.instructions ? `<div class="signing-card" style="margin-bottom:1rem;"><h2>Instructions from Sparkling Standard</h2><p style="white-space:pre-wrap;margin:0;line-height:1.55;">${esc(payload.request.instructions)}</p></div>` : ''}
    <nav class="signing-progress" aria-label="Signing steps">
      <button type="button" data-signing-step="1" aria-current="step">1. Details &amp; price</button>
      <button type="button" data-signing-step="2">2. Access &amp; instructions</button>
      <button type="button" data-signing-step="3">3. Sign documents</button>
    </nav>
    <section class="signing-panel" data-signing-panel="1">
      <div class="signing-card">
        <h2>Details and price</h2>
        <p class="signing-muted">These details come from your verified request. If anything is wrong, contact Sparkling Standard before signing.</p>
        ${renderPricing(payload)}
        <label class="signing-ack"><input type="checkbox" name="detailsAcknowledged" /><span>I reviewed the service, property, schedule and the complete price above.</span></label>
      </div>
    </section>
    <section class="signing-panel" data-signing-panel="2" hidden>
      ${renderFields()}
    </section>
    <section class="signing-panel" data-signing-panel="3" hidden>
      <div class="signing-review-grid">
        <div class="signing-card">
          <h2>Review and sign each document</h2>
          <p class="signing-muted">Open each document and read it at your own pace. Each required signature box must be clicked explicitly. Optional documents are never preselected.</p>
          <div class="signing-signature-progress" data-signature-progress role="status" aria-live="polite"></div>
          <div class="signing-documents">${renderDocuments()}</div>
        </div>
        ${renderSigner(payload)}
      </div>
    </section>
    <div class="signing-actionbar" data-signing-actionbar>
      <div class="signing-actionbar__inner">
        <p class="signing-actionbar__status" data-signing-action-status role="status" aria-live="polite"></p>
        <button class="signing-btn signing-btn--primary" type="button" data-signing-primary>Continue</button>
      </div>
    </div>`;

  step = 1;
  wireWizard();
  updateStep();
}

function wireWizard(): void {
  if (!content) return;
  for (const button of content.querySelectorAll<HTMLButtonElement>('[data-signing-step]')) {
    button.addEventListener('click', () => {
      const target = Number(button.dataset.signingStep);
      if (!Number.isFinite(target)) return;
      if (target > step && !validateStep(step)) return;
      step = Math.max(1, Math.min(3, target));
      updateStep();
    });
  }
  content.querySelector<HTMLButtonElement>('[data-signing-primary]')?.addEventListener('click', () => {
    if (submitting) return;
    if (step < 3) {
      if (!validateStep(step)) return;
      step += 1;
      updateStep();
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    void submit();
  });
  for (const button of content.querySelectorAll<HTMLButtonElement>('[data-document-read]')) {
    button.addEventListener('click', () => openDocument(button.dataset.documentRead ?? ''));
  }
  content.querySelector('[data-signing-panel="3"]')?.addEventListener('change', () => {
    updateActionStatus();
  });
  content.querySelector('[data-signing-panel="3"]')?.addEventListener('input', () => {
    updateActionStatus();
  });
  content.addEventListener('click', (event) => {
    const slot = (event.target as HTMLElement).closest<HTMLElement>('[data-signature-slot]');
    if (slot) {
      void handleSlot(slot.dataset.signatureSlot ?? '');
      return;
    }
    if ((event.target as HTMLElement).closest('[data-signature-change]')) {
      void changeAdoptedSignature();
    }
  });
  content.addEventListener('keydown', (event) => {
    const slot = (event.target as HTMLElement).closest<HTMLElement>('[data-signature-slot]');
    if (slot && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      void handleSlot(slot.dataset.signatureSlot ?? '');
    }
  });
  updateSignatureProgress();
  updateActionStatus();
}

async function handleSlot(templateId: string): Promise<void> {
  if (!templateId) return;
  const document = documents.find((entry) => entry.templateId === templateId);
  if (!document || document.signed) return;
  if (!signerName()) {
    message('Enter your full legal name before you sign any document.', 'error');
    content?.querySelector<HTMLInputElement>('input[name="signerName"]')?.focus();
    return;
  }
  if (!adoptedSignature) {
    const adopted = await openSignatureDialog();
    if (!adopted) return;
    adoptedSignature = adopted;
  }
  applySignature(templateId, adoptedSignature);
}

async function changeAdoptedSignature(): Promise<void> {
  const adopted = await openSignatureDialog();
  if (!adopted) return;
  adoptedSignature = adopted;
  appliedSignatures = {};
  redrawSignatureSlots();
  updateSignatureChangeRow();
  updateSignatureProgress();
  updateActionStatus();
  message('Your adopted signature changed. Click each X — Sign here box again.', 'ok');
}

function updateSignatureChangeRow(): void {
  const row = content?.querySelector<HTMLElement>('[data-signature-change-row]');
  if (row) row.hidden = !adoptedSignature;
}

function applySignature(templateId: string, signature: AdoptedSignature): void {
  appliedSignatures[templateId] = {
    ...signature,
    appliedAt: new Date().toISOString(),
  };
  redrawSignatureSlots();
  updateSignatureChangeRow();
  updateSignatureProgress();
  updateActionStatus();
  const next = documents.find((entry) => needsSignature(entry) && !appliedSignatures[entry.templateId]);
  if (next) {
    const node = content?.querySelector<HTMLElement>(`[data-signature-slot="${CSS.escape(next.templateId)}"]`);
    node?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    node?.classList.add('is-next');
    window.setTimeout(() => node?.classList.remove('is-highlighted'), 1800);
  }
}

function redrawSignatureSlots(): void {
  for (const document of documents) {
    const card = content?.querySelector<HTMLElement>(`[data-document-card="${CSS.escape(document.templateId)}"]`);
    if (!card) continue;
    const existing = card.querySelector<HTMLElement>('[data-signature-slot]');
    const markup = signatureSlot(document);
    if (existing) {
      existing.outerHTML = markup;
    } else {
      card.insertAdjacentHTML('beforeend', markup);
    }
  }
}

function renderSignatureDialog(): void {
  if (!signatureDialogBody) return;
  signatureDialogBody.innerHTML = `
    <p class="signing-muted" style="margin-top:0">Sign once below. Your adopted signature will be applied only to the box you clicked. You can draw with a mouse, touchscreen or stylus, or type your legal name.</p>
    <fieldset class="signing-field signing-field--wide">
      <legend>Signature method</legend>
      <div class="signing-signature-method">
        <label><input type="radio" name="modalSignatureMethod" value="typed"${modalMethod === 'typed' ? ' checked' : ''} /> Type my name</label>
        <label><input type="radio" name="modalSignatureMethod" value="drawn"${modalMethod === 'drawn' ? ' checked' : ''} /> Draw my signature</label>
      </div>
    </fieldset>
    <div class="signing-signature-preview" data-modal-typed ${modalMethod === 'drawn' ? 'hidden' : ''}>
      <span data-modal-preview></span>
    </div>
    <div class="signing-canvas-wrap" data-modal-drawn ${modalMethod === 'typed' ? 'hidden' : ''}>
      <canvas class="signing-canvas signing-canvas--large" data-modal-canvas aria-label="Draw your signature"></canvas>
      <div class="signing-canvas-actions">
        <button class="signing-btn signing-btn--ghost" type="button" data-modal-clear>Clear</button>
        <span class="signing-muted">Draw with your finger, stylus, or mouse.</span>
      </div>
    </div>
    <div class="signing-signature-dialog__actions">
      <button class="signing-btn signing-btn--ghost" type="button" data-modal-cancel>Cancel</button>
      <button class="signing-btn signing-btn--primary" type="button" data-modal-adopt>Adopt Signature</button>
    </div>`;
  const input = signatureDialogBody.querySelector<HTMLInputElement>('input[name="modalSignatureMethod"][value="typed"]');
  if (input) input.checked = modalMethod === 'typed';
  updateModalPreview();
  signatureDialogBody.querySelectorAll<HTMLInputElement>('input[name="modalSignatureMethod"]').forEach((radio) => {
    radio.addEventListener('change', () => {
      modalMethod = radio.value === 'drawn' ? 'drawn' : 'typed';
      const typed = signatureDialogBody?.querySelector<HTMLElement>('[data-modal-typed]');
      const drawn = signatureDialogBody?.querySelector<HTMLElement>('[data-modal-drawn]');
      if (typed) typed.hidden = modalMethod !== 'typed';
      if (drawn) drawn.hidden = modalMethod !== 'drawn';
      if (modalMethod === 'drawn') window.requestAnimationFrame(() => setupModalCanvas());
    });
  });
  signatureDialogBody.querySelector<HTMLButtonElement>('[data-modal-clear]')?.addEventListener('click', () => {
    const canvas = signatureDialogBody?.querySelector<HTMLCanvasElement>('[data-modal-canvas]');
    const context = canvas?.getContext('2d');
    if (canvas && context) context.clearRect(0, 0, canvas.width, canvas.height);
    drawnTouched = false;
    updateModalPreview();
  });
  signatureDialogBody.querySelector<HTMLButtonElement>('[data-modal-adopt]')?.addEventListener('click', () => {
    const name = signerName();
    if (!name) {
      message('Enter your full legal name before adopting a signature.', 'error');
      closeSignatureDialog(null);
      content?.querySelector<HTMLInputElement>('input[name="signerName"]')?.focus();
      return;
    }
    if (modalMethod === 'drawn') {
      const canvas = signatureDialogBody?.querySelector<HTMLCanvasElement>('[data-modal-canvas]');
      if (!canvas || !drawnTouched) {
        message('Draw your signature before adopting it, or choose Type my name.', 'error');
        return;
      }
      const imageData = canvas.toDataURL('image/png');
      closeSignatureDialog({ value: name, type: 'drawn', imageData });
      return;
    }
    closeSignatureDialog({ value: name, type: 'typed' });
  });
  if (modalMethod === 'drawn') window.requestAnimationFrame(() => setupModalCanvas());
}

function updateModalPreview(): void {
  const preview = signatureDialogBody?.querySelector<HTMLElement>('[data-modal-preview]');
  if (preview) preview.textContent = signerName() || 'Your signature preview';
}

function openSignatureDialog(): Promise<AdoptedSignature | null> {
  if (!signatureDialog || signatureDialog.open) return Promise.resolve(null);
  modalMethod = adoptedSignature?.type ?? 'typed';
  drawnTouched = false;
  renderSignatureDialog();
  signatureDialog.showModal();
  return new Promise((resolve) => {
    signatureDialog.addEventListener(
      'close',
      () => {
        const result = (signatureDialog as HTMLDialogElement & { __adopted?: AdoptedSignature | null }).__adopted ?? null;
        (signatureDialog as HTMLDialogElement & { __adopted?: AdoptedSignature | null }).__adopted = null;
        resolve(result);
      },
      { once: true },
    );
  });
}

function closeSignatureDialog(result: AdoptedSignature | null): void {
  if (!signatureDialog) return;
  (signatureDialog as HTMLDialogElement & { __adopted?: AdoptedSignature | null }).__adopted = result;
  signatureDialog.close();
}

function setupModalCanvas(): void {
  const canvas = signatureDialogBody?.querySelector<HTMLCanvasElement>('[data-modal-canvas]');
  if (!canvas) return;
  const ratio = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(320, Math.round(rect.width || 640));
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round((rect.height || 220) * ratio);
  const context = canvas.getContext('2d');
  if (!context) return;
  context.scale(ratio, ratio);
  context.lineWidth = 2.4;
  context.lineCap = 'round';
  context.lineJoin = 'round';
  context.strokeStyle = '#3f2b30';
  const point = (event: PointerEvent): { x: number; y: number } => {
    const bounds = canvas.getBoundingClientRect();
    return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
  };
  canvas.addEventListener('pointerdown', (event) => {
    canvasDrawing = true;
    drawnTouched = true;
    canvas.setPointerCapture(event.pointerId);
    const p = point(event);
    context.beginPath();
    context.moveTo(p.x, p.y);
    event.preventDefault();
  });
  canvas.addEventListener('pointermove', (event) => {
    if (!canvasDrawing) return;
    const p = point(event);
    context.lineTo(p.x, p.y);
    context.stroke();
    event.preventDefault();
  });
  const finish = (event: PointerEvent): void => {
    if (!canvasDrawing) return;
    canvasDrawing = false;
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  };
  canvas.addEventListener('pointerup', finish);
  canvas.addEventListener('pointercancel', finish);
  canvas.addEventListener('pointerleave', (event) => {
    if (canvasDrawing && event.buttons === 0) finish(event);
  });
}

function updateSignatureProgress(): void {
  const node = content?.querySelector<HTMLElement>('[data-signature-progress]');
  const progress = signatureProgress();
  if (node) {
    node.innerHTML = `<div class="signing-signature-progress__bar" aria-hidden="true"><span style="width:${progress.total ? Math.round((progress.applied / progress.total) * 100) : 100}%"></span></div><strong>${progress.applied} of ${progress.total} signatures applied</strong><span>${progress.applied === progress.total ? 'All signatures are applied.' : 'Click the next X — Sign here box.'}</span>`;
  }
}

function updateStep(): void {
  if (!content) return;
  for (const panel of content.querySelectorAll<HTMLElement>('[data-signing-panel]')) {
    panel.hidden = Number(panel.dataset.signingPanel) !== step;
  }
  for (const button of content.querySelectorAll<HTMLButtonElement>('[data-signing-step]')) {
    if (Number(button.dataset.signingStep) === step) button.setAttribute('aria-current', 'step');
    else button.removeAttribute('aria-current');
  }
  const primary = content.querySelector<HTMLButtonElement>('[data-signing-primary]');
  if (primary) {
    primary.textContent =
      step === 1 ? 'Continue to access choices' : step === 2 ? 'Continue to sign documents' : 'Sign documents securely';
  }
  updateActionStatus();
}

function updateActionStatus(): void {
  if (!content) return;
  const status = content.querySelector<HTMLElement>('[data-signing-action-status]');
  if (!status) return;
  if (step === 1) {
    status.textContent = 'Step 1 of 3: confirm the customer, property, service and price.';
    return;
  }
  if (step === 2) {
    status.textContent = 'Step 2 of 3: complete the access and service instructions.';
    return;
  }
  const progress = signatureProgress();
  const consent = content.querySelector<HTMLInputElement>('input[name="consent"]')?.checked === true;
  const confirmed = content.querySelector<HTMLInputElement>('input[name="detailsAcknowledged"]')?.checked === true;
  const name = Boolean(signerName());
  const email = Boolean(content.querySelector<HTMLInputElement>('input[name="signerEmail"]')?.value.trim());
  const ready = progress.total > 0 && progress.applied === progress.total && consent && confirmed && name && email;
  status.textContent = ready
    ? `Ready to sign ${progress.applied} document${progress.applied === 1 ? '' : 's'}.`
    : `${progress.applied} of ${progress.total} signatures applied${name ? '' : ' · legal name required'}${email ? '' : ' · email required'}${consent ? '' : ' · consent required'}${confirmed ? '' : ' · details confirmation required'}.`;
  const primary = content.querySelector<HTMLButtonElement>('[data-signing-primary]');
  if (primary) primary.disabled = step === 3 && !ready;
}

function validateStep(target: number): boolean {
  if (!content) return false;
  if (target === 1) {
    const acknowledged = content.querySelector<HTMLInputElement>('input[name="detailsAcknowledged"]');
    if (!acknowledged?.checked) {
      message('Review and acknowledge the details and price before continuing.', 'error');
      acknowledged?.focus();
      return false;
    }
    message('Details and price acknowledged.', 'ok');
    return true;
  }
  if (target === 2) {
    for (const field of fields) {
      if (!field.required) continue;
      const checked = content.querySelector<HTMLInputElement>(`input[name="${CSS.escape(field.key)}"]:checked`);
      const control = content.querySelector<HTMLInputElement | HTMLSelectElement>(`[name="${CSS.escape(field.key)}"]`);
      const value = field.type === 'radio' ? checked?.value ?? '' : control?.value.trim() ?? '';
      if (!value) {
        message(`${field.label} is required before you continue.`, 'error');
        (checked ?? control)?.focus();
        return false;
      }
    }
    message('Access choices saved for this signing step.', 'ok');
    return true;
  }
  return true;
}

function collectFieldValues(): Record<string, string> {
  const values: Record<string, string> = {};
  if (!content) return values;
  for (const field of fields) {
    if (field.type === 'radio') {
      const checked = content.querySelector<HTMLInputElement>(`input[name="${CSS.escape(field.key)}"]:checked`);
      values[field.key] = checked?.value ?? '';
      continue;
    }
    if (field.type === 'checkbox') {
      const checkbox = content.querySelector<HTMLInputElement>(`input[name="${CSS.escape(field.key)}"]`);
      values[field.key] = checkbox?.checked ? 'yes' : '';
      continue;
    }
    const control = content.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(
      `[name="${CSS.escape(field.key)}"]`,
    );
    values[field.key] = control?.value.trim() ?? '';
  }
  fieldValues = values;
  return values;
}

function openDocument(templateId: string): void {
  const document = documents.find((entry) => entry.templateId === templateId);
  if (!document || !dialog || !dialogTitle || !dialogBody) return;
  dialogTitle.textContent = document.title;
  dialogBody.innerHTML = document.contentText
    ? renderDocumentHtml(document.contentText, 'signing-doc-text')
    : '<p class="signing-muted">This PDF document opens in a separate tab. Review it before acknowledging it.</p>';
  dialog.showModal();
}

dialogClose?.addEventListener('click', () => dialog?.close());
dialog?.addEventListener('click', (event) => {
  if (event.target === dialog) dialog.close();
});
signatureDialog?.addEventListener('cancel', (event) => {
  event.preventDefault();
  closeSignatureDialog(null);
});
signatureDialog?.addEventListener('click', (event) => {
  if ((event.target as HTMLElement).closest('[data-modal-cancel]')) {
    closeSignatureDialog(null);
    return;
  }
  if (event.target === signatureDialog) closeSignatureDialog(null);
});

async function submit(): Promise<void> {
  if (!content || submitting) return;
  if (!validateStep(1)) {
    step = 1;
    updateStep();
    return;
  }
  if (!validateStep(2)) {
    step = 2;
    updateStep();
    return;
  }
  const name = signerName();
  const email = content.querySelector<HTMLInputElement>('input[name="signerEmail"]')?.value.trim() ?? '';
  const consent = content.querySelector<HTMLInputElement>('input[name="consent"]')?.checked === true;
  const confirmed = content.querySelector<HTMLInputElement>('input[name="detailsAcknowledged"]')?.checked === true;
  if (!name) {
    message('Enter your full legal name before signing.', 'error');
    content.querySelector<HTMLInputElement>('input[name="signerName"]')?.focus();
    return;
  }
  if (!email) {
    message('Enter your email before signing.', 'error');
    content.querySelector<HTMLInputElement>('input[name="signerEmail"]')?.focus();
    return;
  }
  if (!consent) {
    message('You must consent to electronic records and signatures before signing.', 'error');
    content.querySelector<HTMLInputElement>('input[name="consent"]')?.focus();
    return;
  }
  if (!confirmed) {
    message('Confirm the details and price before signing.', 'error');
    content.querySelector<HTMLInputElement>('input[name="detailsConfirmed"]')?.focus();
    return;
  }
  const signatures: Record<string, { value: string; type: string; imageData?: string; appliedAt?: string }> = {};
  for (const document of documents) {
    if (document.signed) continue;
    const applied = appliedSignatures[document.templateId];
    if (document.required && !applied) {
      message(`Click the X — Sign here box for ${document.title}.`, 'error');
      content.querySelector<HTMLElement>(`[data-signature-slot="${CSS.escape(document.templateId)}"]`)?.focus();
      return;
    }
    if (!applied) continue;
    signatures[document.templateId] = {
      value: name,
      type: applied.type,
      appliedAt: applied.appliedAt,
      ...(applied.type === 'drawn' && applied.imageData ? { imageData: applied.imageData } : {}),
    };
  }
  if (Object.keys(signatures).length === 0) {
    message('Click at least one signature box before signing.', 'error');
    return;
  }
  submitting = true;
  const primary = content.querySelector<HTMLButtonElement>('[data-signing-primary]');
  if (primary) {
    primary.disabled = true;
    primary.textContent = 'Recording your signature…';
  }
  message('Saving your signature securely…');
  try {
    const response = await fetch('/api/document-sign', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        token,
        signerName: name,
        signerEmail: email,
        consent,
        signatures,
        customerFields: collectFieldValues(),
      }),
    });
    const result = (await response.json().catch(() => ({}))) as {
      ok?: boolean;
      error?: string;
      fields?: string[];
    };
    if (!response.ok || !result.ok) {
      if (result.error === 'signing_fields_invalid') {
        throw new Error('Some required access choices are missing. Review the highlighted step.');
      }
      throw new Error(result.error ?? 'signing_failed');
    }
    message('Your documents are signed. Preparing the next step…', 'ok');
    const fresh = await fetchPayload();
    if (fresh?.resumeCheckoutUrl) {
      const next = new URL(fresh.resumeCheckoutUrl, window.location.origin);
      next.searchParams.set('signing_token', token);
      window.location.replace(next.toString());
      return;
    }
    renderSuccess(fresh ?? { ok: true });
  } catch (error) {
    submitting = false;
    message(
      `We could not record your signature: ${String((error as Error).message).replaceAll('_', ' ')}.`,
      'error',
    );
    if (primary) {
      primary.disabled = false;
      primary.textContent = 'Sign documents securely';
    }
  }
}

function emailStatusCopy(status: CustomerEmailStatus | undefined): string {
  if (!status) return 'Your signed copy is available to download below.';
  if (status.status === 'sent' || status.status === 'already_sent') {
    return 'A signed PDF was emailed to the address on this signing request and accepted by our email provider.';
  }
  if (status.status === 'not_configured') {
    return 'Email delivery is not configured. Download your signed PDF below and keep it for your records.';
  }
  if (status.status === 'failed') {
    return 'Email delivery could not be confirmed. Download your signed PDF below and keep it for your records.';
  }
  return 'Your signed copy is available to download below.';
}

function renderSuccess(payload: SigningPayload): void {
  if (!content) return;
  const pricing = payload.pricing;
  const total = formatPricingMoney(pricing?.totalCents ?? null);
  const executed = payload.executedDownloadUrl
    ? `<a class="signing-btn signing-btn--primary" href="${esc(payload.executedDownloadUrl)}" target="_blank" rel="noopener">Download signed PDF</a>`
    : '';
  const portal = '<a class="signing-btn signing-btn--secondary" href="/portal/">Open customer portal</a>';
  const returnLink = returnPath
    ? `<a class="signing-btn signing-btn--ghost" href="${esc(returnPath)}">Return to your cleaning request</a>`
    : '';
  content.hidden = false;
  content.innerHTML = `<div class="signing-success">
    <div class="signing-success__mark" aria-hidden="true">✓</div>
    <h1 class="signing-title">All required documents are signed</h1>
    <p class="signing-lead" style="margin-left:auto;margin-right:auto;">Your signed copy is retained privately by Sparkling Standard.</p>
    ${total ? `<div class="signing-success__amount"><span>Final total</span><strong>${esc(total)}</strong></div>` : ''}
    <p class="signing-muted">${esc(emailStatusCopy(payload.customerEmailStatus))}</p>
    <div class="signing-actions">${executed}${portal}</div>
    ${returnLink ? `<p class="signing-muted">${returnLink}</p>` : ''}
    <p class="signing-muted">Need a paper copy or want to withdraw consent to future electronic records? Email <a href="mailto:admin@sparkling-standard.com?subject=Signed%20document%20request">admin@sparkling-standard.com</a>. A signed record already completed is not affected by a later withdrawal.</p>
  </div>`;
}

function render(payload: SigningPayload): void {
  documents = payload.documents ?? [];
  if (isCompleted()) {
    if (payload.resumeCheckoutUrl) {
      const next = new URL(payload.resumeCheckoutUrl, window.location.origin);
      next.searchParams.set('signing_token', token);
      window.location.replace(next.toString());
      return;
    }
    message('All required documents are signed.');
    renderSuccess(payload);
    return;
  }
  message('Review your details and price, complete the access choices, and sign each document.');
  renderWizard(payload);
}

async function fetchPayload(): Promise<SigningPayload | null> {
  try {
    const query = new URLSearchParams({ token });
    if (returnPath) query.set('return', returnPath);
    if (resumeToken) query.set('resume', resumeToken);
    const response = await fetch(`/api/document-sign?${query.toString()}`, {
      headers: { Accept: 'application/json' },
    });
    const payload = (await response.json().catch(() => ({}))) as SigningPayload;
    if (!response.ok || !payload.ok) throw new Error(payload.error ?? 'signing_link_invalid');
    return payload;
  } catch (error) {
    message(
      String((error as Error).message).includes('signing_link_invalid')
        ? 'This signing link is invalid or has expired. Ask Sparkling Standard to resend it.'
        : 'We could not load your documents. Please try again or contact Sparkling Standard.',
      'error',
    );
    return null;
  }
}

async function load(): Promise<void> {
  if (!token) {
    message('This signing link is missing or invalid.', 'error');
    return;
  }
  submitting = false;
  const payload = await fetchPayload();
  if (payload) render(payload);
}

void load();
