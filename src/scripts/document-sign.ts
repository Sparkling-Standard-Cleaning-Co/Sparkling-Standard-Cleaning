import { renderDocumentHtml } from '../lib/documents/rich-text.ts';

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
    serviceDate?: string;
    arrivalWindow?: string;
    priceSummary?: string;
    paymentTerms?: string;
  };
  customerFields?: {
    definitions?: SigningFieldDefinition[];
    values?: Record<string, string>;
  };
  documents?: SigningDocument[];
  signedTemplateIds?: string[];
  consentVersion?: string;
  resumeCheckoutUrl?: string;
  executedDownloadUrl?: string;
  error?: string;
}

const statusNode = document.querySelector<HTMLElement>('[data-document-status]');
const content = document.querySelector<HTMLElement>('[data-document-content]');
const dialog = document.querySelector<HTMLDialogElement>('[data-document-dialog]');
const dialogTitle = document.querySelector<HTMLElement>('[data-document-dialog-title]');
const dialogBody = document.querySelector<HTMLElement>('[data-document-dialog-body]');
const dialogClose = document.querySelector<HTMLButtonElement>('[data-document-dialog-close]');
const params = new URLSearchParams(window.location.search);
const token = params.get('token') ?? '';
const returnParam = params.get('return') ?? '';
const returnPath = returnParam.startsWith('/') && !returnParam.startsWith('//') ? returnParam : '';
const resumeToken = params.get('resume') ?? '';

let step = 1;
let documents: SigningDocument[] = [];
let fields: SigningFieldDefinition[] = [];
let fieldValues: Record<string, string> = {};
let signatureMethod: 'typed' | 'drawn' = 'typed';
let drawnSignature = '';
let canvasInitialized = false;
let submitting = false;

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

function isCompleted(): boolean {
  return documents.length === 0 || unsignedRequired().length === 0;
}

function summaryValue(value: string | undefined): string {
  return value && value.trim() ? value.trim() : 'To be confirmed';
}

function renderSummary(payload: SigningPayload): string {
  const context = payload.context ?? {};
  const rows: Array<[string, string]> = [
    ['Customer', summaryValue(context.customerName)],
    ['Property', summaryValue(context.propertyAddress)],
    ['Service', summaryValue(context.serviceCode)],
    ['Booking reference', summaryValue(context.bookingReference)],
    ['Service date', summaryValue(context.serviceDate)],
    ['Arrival window', summaryValue(context.arrivalWindow)],
    ['Price', summaryValue(context.priceSummary)],
    ['Payment terms', summaryValue(context.paymentTerms)],
  ];
  const core = new Set(['Customer', 'Property', 'Service']);
  return `<dl class="signing-summary">${rows
    .filter(([label, value]) => value !== 'To be confirmed' || core.has(label))
    .map(
      ([label, value]) =>
        `<div><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`,
    )
    .join('')}</dl>`;
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
  ].join(' ');
  return `<div class="signing-document__head"><div><h3>${esc(document.title)}</h3></div><div>${badges}</div></div>`;
}

function documentActions(document: SigningDocument): string {
  const read =
    document.sourceKind === 'text'
      ? `<button class="signing-btn signing-btn--secondary" type="button" data-document-read="${esc(document.templateId)}">Read document</button>`
      : `<a class="signing-btn signing-btn--secondary" href="${esc(document.downloadUrl)}" target="_blank" rel="noopener">Open PDF</a>`;
  if (document.signed) {
    return `<div class="signing-document__actions">${read}<span class="signing-muted">Already signed. This document does not need another signature.</span></div>`;
  }
  if (document.canResign) {
    return `<div class="signing-document__actions">${read}</div><p class="signing-status" data-kind="error">This signature was rejected. Review the document and sign again below.</p>`;
  }
  return `<div class="signing-document__actions">${read}</div>`;
}

function documentAcknowledgment(document: SigningDocument): string {
  if (document.signed) return '';
  if (document.required) {
    return `<label class="signing-ack"><input type="checkbox" name="ack-${esc(document.templateId)}" /><span>I have read and reviewed <strong>${esc(document.title)}</strong> and I agree to sign it electronically.</span></label>`;
  }
  return `<label class="signing-ack"><input type="checkbox" name="opt-${esc(document.templateId)}" /><span>I also choose to review and sign the optional document <strong>${esc(document.title)}</strong>.</span></label>`;
}

function renderDocuments(): string {
  return documents
    .map(
      (document) =>
        `<article class="signing-document" data-document-card="${esc(document.templateId)}">${documentMeta(document)}${documentActions(document)}${documentAcknowledgment(document)}</article>`,
    )
    .join('');
}

function renderSigner(payload: SigningPayload): string {
  const context = payload.context ?? {};
  return `<div class="signing-card signing-signer-card">
    <h2>Your signature</h2>
    <p class="signing-muted">Enter your name once. Your signature applies to every required document you reviewed above, and to any optional document you selected.</p>
    <div class="signing-field">
      <label for="signing-name">Your full legal name</label>
      <input id="signing-name" name="signerName" type="text" autocomplete="name" value="${esc(context.customerName ?? '')}" required />
    </div>
    <div class="signing-field">
      <label for="signing-email">Your email</label>
      <input id="signing-email" name="signerEmail" type="email" autocomplete="email" value="${esc(context.customerEmail ?? '')}" required />
    </div>
    <fieldset class="signing-field signing-field--wide" style="margin-top:.8rem;">
      <legend>Signature method</legend>
      <div class="signing-signature-method">
        <label><input type="radio" name="signatureMethod" value="typed" checked /> Type my name</label>
        <label><input type="radio" name="signatureMethod" value="drawn" /> Draw my signature</label>
      </div>
      <div class="signing-signature-preview" data-signature-typed>
        <span data-signature-preview>Your signature preview</span>
      </div>
      <div class="signing-canvas-wrap" data-signature-drawn hidden>
        <canvas class="signing-canvas" data-signature-canvas aria-label="Draw your signature"></canvas>
        <div class="signing-canvas-actions">
          <button class="signing-btn signing-btn--ghost" type="button" data-signature-clear>Clear drawing</button>
          <span class="signing-muted">Draw with your finger, stylus, or mouse.</span>
        </div>
      </div>
    </fieldset>
    <div class="signing-card" style="box-shadow:none;padding:.75rem;margin:.8rem 0;background:#fdf8f2;">
      <h3>Electronic records and signatures</h3>
      <p class="signing-disclosure">You need a current web browser, internet access, and the ability to view, print or save a PDF or text record. You may request a paper copy at any time by emailing <a href="mailto:admin@sparkling-standard.com?subject=Paper%20copy%20request">admin@sparkling-standard.com</a>. You may withdraw consent to future electronic records by written notice to the same address. Withdrawal does not affect a record you already signed. Keep your email address and phone number current.</p>
    </div>
    <label class="signing-ack"><input type="checkbox" name="consent" /><span>I can access and retain these documents electronically, and I consent to use electronic signatures and electronic records. I understand my typed name is my legal signature.</span></label>
    <p class="signing-muted">A signed copy and audit record are retained privately.</p>
  </div>`;
}

function renderWizard(payload: SigningPayload): void {
  if (!content) return;
  documents = payload.documents ?? [];
  fields = payload.customerFields?.definitions ?? [];
  fieldValues = { ...(payload.customerFields?.values ?? {}) };
  const required = unsignedRequired();
  const totalRequired = documents.filter((document) => document.required).length;
  content.hidden = false;
  content.innerHTML = `
    <h1 class="signing-title">${esc(payload.request?.bundleName || payload.request?.bundleCode || 'Your documents')}</h1>
    <p class="signing-lead">Review the details, complete the access choices, and sign once. Required documents: ${totalRequired}. Already signed: ${totalRequired - required.length}.</p>
    ${payload.request?.instructions ? `<div class="signing-card" style="margin-bottom:1rem;"><h2>Instructions from Sparkling Standard</h2><p style="white-space:pre-wrap;margin:0;line-height:1.55;">${esc(payload.request.instructions)}</p></div>` : ''}
    <nav class="signing-progress" aria-label="Signing steps">
      <button type="button" data-signing-step="1" aria-current="step">1. Confirm details</button>
      <button type="button" data-signing-step="2">2. Access &amp; instructions</button>
      <button type="button" data-signing-step="3">3. Review &amp; sign</button>
    </nav>
    <section class="signing-panel" data-signing-panel="1">
      <div class="signing-card">
        <h2>Confirm your details</h2>
        <p class="signing-muted">These details come from your verified request. If anything is wrong, contact Sparkling Standard before signing.</p>
        ${renderSummary(payload)}
        <label class="signing-ack"><input type="checkbox" name="detailsConfirmed" /><span>The customer, property, service, and price details above are correct.</span></label>
      </div>
    </section>
    <section class="signing-panel" data-signing-panel="2" hidden>
      ${renderFields()}
    </section>
    <section class="signing-panel" data-signing-panel="3" hidden>
      <div class="signing-review-grid">
        <div class="signing-card">
          <h2>Review and acknowledge each document</h2>
          <p class="signing-muted">Open each document and read it at your own pace. Required documents must be acknowledged. Optional documents are never preselected.</p>
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
  signatureMethod = 'typed';
  drawnSignature = '';
  canvasInitialized = false;
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
  content.querySelector('[data-signing-panel="3"]')?.addEventListener('change', (event) => {
    const target = event.target as HTMLInputElement;
    if (target.name === 'signatureMethod') {
      signatureMethod = target.value === 'drawn' ? 'drawn' : 'typed';
      updateSignatureMethod();
    }
    if (target.name === 'signerName') updateTypedPreview();
    updateActionStatus();
  });
  content.querySelector('[data-signing-panel="3"]')?.addEventListener('input', (event) => {
    const target = event.target as HTMLInputElement;
    if (target.name === 'signerName') updateTypedPreview();
    updateActionStatus();
  });
  content.querySelector<HTMLButtonElement>('[data-signature-clear]')?.addEventListener('click', () => {
    const canvas = content?.querySelector<HTMLCanvasElement>('[data-signature-canvas]');
    if (!canvas) return;
    const context = canvas.getContext('2d');
    if (!context) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
    drawnSignature = '';
    updateActionStatus();
  });
  updateTypedPreview();
  updateSignatureMethod();
  updateActionStatus();
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
      step === 1 ? 'Continue to access choices' : step === 2 ? 'Continue to review' : 'Sign documents securely';
  }
  updateActionStatus();
}

function updateActionStatus(): void {
  if (!content) return;
  const status = content.querySelector<HTMLElement>('[data-signing-action-status]');
  if (!status) return;
  if (step === 1) {
    status.textContent = 'Step 1 of 3: confirm the customer, property, service, and price.';
    return;
  }
  if (step === 2) {
    status.textContent = 'Step 2 of 3: complete the access and service instructions.';
    return;
  }
  const required = unsignedRequired();
  const acknowledged = required.filter((document) => {
    const checkbox = content?.querySelector<HTMLInputElement>(`input[name="ack-${CSS.escape(document.templateId)}"]`);
    return checkbox?.checked === true;
  }).length;
  const consent = content.querySelector<HTMLInputElement>('input[name="consent"]')?.checked === true;
  const signerName = content.querySelector<HTMLInputElement>('input[name="signerName"]')?.value.trim() ?? '';
  const ready = required.length > 0 && acknowledged === required.length && consent && Boolean(signerName) && (signatureMethod === 'typed' || Boolean(drawnSignature));
  status.textContent = ready
    ? `Ready to sign ${acknowledged} required document${acknowledged === 1 ? '' : 's'}.`
    : `${acknowledged} of ${required.length} required documents acknowledged${consent ? '' : ' · electronic-record consent required'}.`;
  const primary = content.querySelector<HTMLButtonElement>('[data-signing-primary]');
  if (primary) primary.disabled = step === 3 && !ready;
}

function validateStep(target: number): boolean {
  if (!content) return false;
  if (target === 1) {
    const confirmed = content.querySelector<HTMLInputElement>('input[name="detailsConfirmed"]');
    if (!confirmed?.checked) {
      message('Confirm that the customer, property, service, and price details are correct before continuing.', 'error');
      confirmed?.focus();
      return false;
    }
    message('Details confirmed.', 'ok');
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

function updateTypedPreview(): void {
  if (!content) return;
  const name = content.querySelector<HTMLInputElement>('input[name="signerName"]')?.value.trim() ?? '';
  const preview = content.querySelector<HTMLElement>('[data-signature-preview]');
  if (preview) preview.textContent = name || 'Your signature preview';
}

function updateSignatureMethod(): void {
  if (!content) return;
  const typed = content.querySelector<HTMLElement>('[data-signature-typed]');
  const drawn = content.querySelector<HTMLElement>('[data-signature-drawn]');
  if (typed) typed.hidden = signatureMethod !== 'typed';
  if (drawn) drawn.hidden = signatureMethod !== 'drawn';
  if (signatureMethod === 'drawn' && !canvasInitialized) {
    window.requestAnimationFrame(() => setupCanvas());
  }
}

function setupCanvas(): void {
  if (canvasInitialized) return;
  const canvas = content?.querySelector<HTMLCanvasElement>('[data-signature-canvas]');
  if (!canvas) return;
  const ratio = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(300, Math.round(rect.width || 560));
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round((rect.height || 144) * ratio);
  const context = canvas.getContext('2d');
  if (!context) return;
  context.scale(ratio, ratio);
  context.lineWidth = 2.2;
  context.lineCap = 'round';
  context.lineJoin = 'round';
  context.strokeStyle = '#3f2b30';
  let drawing = false;
  const point = (event: PointerEvent): { x: number; y: number } => {
    const bounds = canvas.getBoundingClientRect();
    return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
  };
  canvas.addEventListener('pointerdown', (event) => {
    drawing = true;
    canvas.setPointerCapture(event.pointerId);
    const p = point(event);
    context.beginPath();
    context.moveTo(p.x, p.y);
    event.preventDefault();
  });
  canvas.addEventListener('pointermove', (event) => {
    if (!drawing) return;
    const p = point(event);
    context.lineTo(p.x, p.y);
    context.stroke();
    event.preventDefault();
  });
  const finish = (event: PointerEvent): void => {
    if (!drawing) return;
    drawing = false;
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    drawnSignature = canvas.toDataURL('image/png');
    updateActionStatus();
  };
  canvas.addEventListener('pointerup', finish);
  canvas.addEventListener('pointercancel', finish);
  canvas.addEventListener('pointerleave', (event) => {
    if (drawing && event.buttons === 0) finish(event);
  });
  drawnSignature = '';
  canvasInitialized = true;
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
  const signerName = content.querySelector<HTMLInputElement>('input[name="signerName"]')?.value.trim() ?? '';
  const signerEmail = content.querySelector<HTMLInputElement>('input[name="signerEmail"]')?.value.trim() ?? '';
  const consent = content.querySelector<HTMLInputElement>('input[name="consent"]')?.checked === true;
  if (!signerName) {
    message('Enter your full legal name once before signing.', 'error');
    content.querySelector<HTMLInputElement>('input[name="signerName"]')?.focus();
    return;
  }
  if (!signerEmail) {
    message('Enter your email before signing.', 'error');
    content.querySelector<HTMLInputElement>('input[name="signerEmail"]')?.focus();
    return;
  }
  if (!consent) {
    message('You must consent to electronic records and signatures before signing.', 'error');
    content.querySelector<HTMLInputElement>('input[name="consent"]')?.focus();
    return;
  }
  if (signatureMethod === 'drawn' && !drawnSignature) {
    message('Draw your signature in the box before signing, or choose Type my name.', 'error');
    content.querySelector<HTMLCanvasElement>('[data-signature-canvas]')?.focus();
    return;
  }
  const signatures: Record<string, { value: string; type: string; imageData?: string }> = {};
  for (const document of documents) {
    if (document.signed) continue;
    if (document.required) {
      const acknowledged = content.querySelector<HTMLInputElement>(`input[name="ack-${CSS.escape(document.templateId)}"]`);
      if (!acknowledged?.checked) {
        message(`Acknowledge ${document.title} before signing.`, 'error');
        acknowledged?.focus();
        return;
      }
      signatures[document.templateId] = {
        value: signerName,
        type: signatureMethod,
        ...(signatureMethod === 'drawn' && drawnSignature ? { imageData: drawnSignature } : {}),
      };
      continue;
    }
    const optional = content.querySelector<HTMLInputElement>(`input[name="opt-${CSS.escape(document.templateId)}"]`);
    if (optional?.checked) {
      signatures[document.templateId] = {
        value: signerName,
        type: signatureMethod,
        ...(signatureMethod === 'drawn' && drawnSignature ? { imageData: drawnSignature } : {}),
      };
    }
  }
  if (Object.keys(signatures).length === 0) {
    message('Select at least one document to sign.', 'error');
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
        signerName,
        signerEmail,
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
    message('Your documents are signed. Your private copy is retained.', 'ok');
    await load();
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

function renderSuccess(payload: SigningPayload): void {
  if (!content) return;
  const resume = payload.resumeCheckoutUrl
    ? `<a class="signing-btn signing-btn--primary" href="${esc(payload.resumeCheckoutUrl)}">Continue to secure payment</a>`
    : '';
  const executed = payload.executedDownloadUrl
    ? `<a class="signing-btn signing-btn--secondary" href="${esc(payload.executedDownloadUrl)}" target="_blank" rel="noopener">Download your executed agreement (PDF)</a>`
    : '';
  const back = returnPath
    ? `<a class="signing-btn signing-btn--ghost" href="${esc(returnPath)}">Return to your cleaning request</a>`
    : '';
  content.hidden = false;
  content.innerHTML = `<div class="signing-success">
    <div class="signing-success__mark" aria-hidden="true">✓</div>
    <h1 class="signing-title">All required documents are signed</h1>
    <p class="signing-lead" style="margin-left:auto;margin-right:auto;">Your signed copy is retained privately by Sparkling Standard. You may close this page after saving your copy.</p>
    <div class="signing-actions">${resume}${executed}${back}</div>
    <p class="signing-muted">Need a paper copy or want to withdraw consent to future electronic records? Email <a href="mailto:admin@sparkling-standard.com?subject=Signed%20document%20request">admin@sparkling-standard.com</a>. A signed record already completed is not affected by a later withdrawal.</p>
  </div>`;
}

function render(payload: SigningPayload): void {
  documents = payload.documents ?? [];
  if (isCompleted()) {
    message('All required documents are signed. You may close this page.');
    renderSuccess(payload);
    return;
  }
  message('Review your details, complete the access choices, and sign once.');
  renderWizard(payload);
}

async function load(): Promise<void> {
  if (!token) {
    message('This signing link is missing or invalid.', 'error');
    return;
  }
  submitting = false;
  try {
    const query = new URLSearchParams({ token });
    if (returnPath) query.set('return', returnPath);
    if (resumeToken) query.set('resume', resumeToken);
    const response = await fetch(`/api/document-sign?${query.toString()}`, {
      headers: { Accept: 'application/json' },
    });
    const payload = (await response.json().catch(() => ({}))) as SigningPayload;
    if (!response.ok || !payload.ok) throw new Error(payload.error ?? 'signing_link_invalid');
    render(payload);
  } catch (error) {
    message(
      String((error as Error).message).includes('signing_link_invalid')
        ? 'This signing link is invalid or has expired. Ask Sparkling Standard to resend it.'
        : 'We could not load your documents. Please try again or contact Sparkling Standard.',
      'error',
    );
  }
}

void load();
