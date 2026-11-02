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

interface SigningPayload {
  ok: boolean;
  request?: {
    id: string;
    bundleCode: string;
    bundleVersion: number;
    subjectType: string;
    status: string;
    expiresAt: string;
  };
  documents?: SigningDocument[];
  signedTemplateIds?: string[];
  consentVersion?: string;
  error?: string;
}

const root = document.querySelector<HTMLElement>('[data-document-sign]');
const statusNode = document.querySelector<HTMLElement>('[data-document-status]');
const content = document.querySelector<HTMLElement>('[data-document-content]');
const params = new URLSearchParams(window.location.search);
const token = params.get('token') ?? '';
const returnParam = params.get('return') ?? '';
const returnPath = returnParam.startsWith('/') && !returnParam.startsWith('//') ? returnParam : '';

function esc(value: unknown): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function message(value: string, kind: 'error' | 'ok' = 'ok'): void {
  if (!statusNode) return;
  statusNode.textContent = value;
  statusNode.dataset.kind = kind;
}

function render(payload: SigningPayload): void {
  if (!root || !content) return;
  const documents = payload.documents ?? [];
  const unsigned = documents.filter((document) => document.required && !document.signed);
  if (unsigned.length === 0) {
    message('All required documents are signed. You may close this page.');
    content.hidden = false;
    content.innerHTML = returnPath
      ? `<p><a class="btn btn--primary" href="${esc(returnPath)}">Return to your cleaning request</a></p>`
      : '';
    return;
  }
  message('Review each document and sign below.');
  content.hidden = false;
  content.innerHTML = `
    <form class="employee-form" data-sign-form>
      <div class="employee-card" style="box-shadow:none;padding:0;background:transparent">
        <h1 style="font-family:var(--font-display);font-size:1.25rem;margin:0 0 .4rem;color:#6d343c;">Documents to sign</h1>
        <p class="employee-muted">Bundle ${esc(payload.request?.bundleCode)} · version ${esc(payload.request?.bundleVersion)}</p>
      </div>
      ${documents
        .map(
          (document, index) => `
        <article class="employee-card" style="margin:.8rem 0;padding:1rem;box-shadow:none;border:1px solid rgba(138,74,82,.2)">
          <h2 style="font-size:1rem;margin:0 0 .3rem;color:#6d343c;">${index + 1}. ${esc(document.title)}</h2>
          <p class="employee-muted" style="margin:.2rem 0 .6rem;">Version ${esc(document.version)} · ${document.required ? 'Required' : 'Optional'} · ${esc(document.stage.replaceAll('_', ' '))}</p>
          ${
            document.signed
              ? '<p class="employee-status" data-kind="ok">Already signed.</p>'
              : `${document.canResign ? '<p class="employee-status" data-kind="error">This signature was rejected. Please review the document and sign again.</p>' : ''}${
                  document.sourceKind === 'text'
                    ? `<details><summary>Read the document</summary><div style="white-space:pre-wrap;max-height:22rem;overflow:auto;border:1px solid rgba(138,74,82,.18);border-radius:.6rem;padding:.8rem;background:#fffdfa;font-size:.9rem;line-height:1.55">${esc(document.contentText)}</div></details>`
                    : `<p class="employee-muted">A PDF document is attached to this request. <a href="${esc(document.downloadUrl)}" target="_blank" rel="noopener">Open the PDF</a> to review it before signing.</p>`
                }
                <label style="display:block;margin-top:.7rem;">Type your full legal name to sign
                  <input name="signature-${esc(document.templateId)}" type="text" autocomplete="name" required />
                </label>
                <label style="display:flex;gap:.5rem;align-items:flex-start;margin-top:.5rem;">
                  <input type="checkbox" name="ack-${esc(document.templateId)}" required />
                  <span>I have reviewed this document and agree to sign it electronically.</span>
                </label>`
          }
        </article>`,
        )
        .join('')}
      <div class="employee-card" style="margin:.8rem 0;padding:1rem;box-shadow:none;border:1px solid rgba(138,74,82,.2)">
        <label>Your full name <input name="signerName" type="text" autocomplete="name" required /></label>
        <label>Your email <input name="signerEmail" type="email" autocomplete="email" required /></label>
        <label style="display:flex;gap:.5rem;align-items:flex-start;margin-top:.6rem;">
          <input type="checkbox" name="consent" required />
          <span>I consent to use electronic signatures and electronic records for these documents. I understand my typed name is my legal signature.</span>
        </label>
        <p class="employee-muted" style="font-size:.78rem;margin-top:.5rem;">Consent version ${esc(payload.consentVersion)}. A signed copy and audit record are retained privately.</p>
      </div>
      <button class="btn btn--primary btn--full" type="submit">Sign Documents</button>
      <p class="employee-status" data-sign-status role="status" aria-live="polite"></p>
    </form>`;

  content.querySelector<HTMLFormElement>('[data-sign-form]')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    const data = new FormData(form);
    const signatures: Record<string, { value: string }> = {};
    for (const document of documents) {
      if (document.signed || !document.required) continue;
      const value = String(data.get(`signature-${document.templateId}`) ?? '').trim();
      if (!value || data.get(`ack-${document.templateId}`) !== 'on') {
        message(`Complete and acknowledge ${document.title}.`, 'error');
        return;
      }
      signatures[document.templateId] = { value };
    }
    const status = form.querySelector<HTMLElement>('[data-sign-status]');
    if (status) status.textContent = 'Saving your signatures…';
    try {
      const response = await fetch('/api/document-sign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          token,
          signerName: String(data.get('signerName') ?? ''),
          signerEmail: String(data.get('signerEmail') ?? ''),
          consent: data.get('consent') === 'on',
          signatures,
        }),
      });
      const result = (await response.json().catch(() => ({}))) as { ok?: boolean; status?: string; error?: string };
      if (!response.ok || !result.ok) throw new Error(result.error ?? 'signing_failed');
      if (status) status.textContent = 'Your documents are signed. A private copy is retained.';
      await load();
    } catch (error) {
      if (status) status.textContent = `We could not record your signature: ${String((error as Error).message).replaceAll('_', ' ')}.`;
    }
  });
}

async function load(): Promise<void> {
  if (!token) {
    message('This signing link is missing or invalid.', 'error');
    return;
  }
  try {
    const response = await fetch(`/api/document-sign?token=${encodeURIComponent(token)}`, {
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
