// Shared branded document presentation.
//
// Branding is applied at render time so the approved legal wording stored in
// document_templates remains unchanged. The same identity is used by the admin
// preview, customer signing screen, printed preview and executed PDF.

import { renderDocumentHtml } from './rich-text.ts';

export const DOCUMENT_BRAND = {
  name: 'Sparkling Standard Cleaning Co.',
  legalName: 'Sparkling Standard LLC',
  slogan: 'Standards That Sparkle.',
  phone: '(850) 426-8479',
  email: 'customer-service@sparkling-standard.com',
  website: 'https://sparkling-standard.com',
  logoUrl: '/brand/sparkling-standard-circular-logo-1024.png',
  colors: {
    ink: '#2c2421',
    inkSoft: '#4a3b40',
    rose: '#6d343c',
    roseLight: '#8a4a52',
    gold: '#9d7736',
    goldRule: '#c6a369',
    border: '#e4d5c7',
    cream: '#fbf7f2',
  },
} as const;

export const DOCUMENT_BRAND_CSS = `
  .branded-document {
    --doc-ink: ${DOCUMENT_BRAND.colors.ink};
    --doc-ink-soft: ${DOCUMENT_BRAND.colors.inkSoft};
    --doc-rose: ${DOCUMENT_BRAND.colors.rose};
    --doc-rose-light: ${DOCUMENT_BRAND.colors.roseLight};
    --doc-gold: ${DOCUMENT_BRAND.colors.gold};
    --doc-gold-rule: ${DOCUMENT_BRAND.colors.goldRule};
    --doc-border: ${DOCUMENT_BRAND.colors.border};
    --doc-cream: ${DOCUMENT_BRAND.colors.cream};
    box-sizing: border-box;
    width: 100%;
    max-width: 50rem;
    margin: 0 auto;
    padding: 2rem 2.2rem 1.6rem;
    background: #fff;
    color: var(--doc-ink);
    font-family: Georgia, 'Times New Roman', serif;
    font-size: 10.8pt;
    line-height: 1.58;
    white-space: normal;
    box-shadow: 0 10px 34px rgba(72, 42, 38, 0.08);
  }
  .branded-document * { box-sizing: border-box; }
  .branded-document__letterhead {
    display: flex;
    align-items: center;
    gap: 0.9rem;
    padding-bottom: 0.75rem;
    margin-bottom: 1.15rem;
    border-bottom: 2px solid var(--doc-gold-rule);
  }
  .branded-document__logo {
    width: 3.4rem;
    height: 3.4rem;
    border-radius: 50%;
    flex: 0 0 auto;
    display: block;
  }
  .branded-document__identity { min-width: 0; flex: 1 1 auto; }
  .branded-document__name {
    margin: 0;
    font-family: Georgia, 'Times New Roman', serif;
    font-size: 1.18rem;
    font-weight: 700;
    line-height: 1.15;
    color: var(--doc-rose);
  }
  .branded-document__slogan {
    margin: 0.15rem 0 0;
    font-family: 'Source Sans 3', Arial, sans-serif;
    font-size: 0.66rem;
    font-weight: 700;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--doc-gold);
  }
  .branded-document__custom-header {
    margin: 0.35rem 0 0;
    font-family: 'Source Sans 3', Arial, sans-serif;
    font-size: 0.7rem;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: #8c7a70;
  }
  .branded-document__contact {
    flex: 0 0 auto;
    text-align: right;
    font-family: 'Source Sans 3', Arial, sans-serif;
    font-size: 0.66rem;
    line-height: 1.5;
    color: #8c7a70;
  }
  .branded-document__contact span { display: block; }
  .branded-document__body { overflow-wrap: anywhere; }
  .branded-document__body h1 {
    margin: 0 0 0.55rem;
    font-size: 1.55rem;
    line-height: 1.15;
    color: var(--doc-rose);
  }
  .branded-document__body h2 {
    margin: 1.35rem 0 0.4rem;
    padding-bottom: 0.18rem;
    border-bottom: 1px solid var(--doc-border);
    font-size: 1.02rem;
    line-height: 1.3;
    color: var(--doc-rose);
    break-after: avoid;
  }
  .branded-document__body h3,
  .branded-document__body h4 {
    margin: 1rem 0 0.3rem;
    font-size: 0.94rem;
    color: var(--doc-ink);
    break-after: avoid;
  }
  .branded-document__body p { margin: 0 0 0.62rem; orphans: 3; widows: 3; }
  .branded-document__body ul,
  .branded-document__body ol { margin: 0 0 0.8rem; padding-left: 1.3rem; }
  .branded-document__body li { margin: 0.2rem 0; }
  .branded-document__body strong { color: var(--doc-ink-soft); }
  .branded-document__body blockquote {
    margin: 0.8rem 0;
    padding: 0.6rem 0.9rem;
    border-left: 3px solid var(--doc-rose-light);
    background: #f7efec;
    font-size: 0.94rem;
  }
  .branded-document__body table {
    width: 100%;
    margin: 0.7rem 0 1rem;
    border-collapse: collapse;
    font-size: 0.9rem;
  }
  .branded-document__body th,
  .branded-document__body td {
    padding: 0.38rem 0.5rem;
    border: 1px solid var(--doc-border);
    text-align: left;
    vertical-align: top;
  }
  .branded-document__body th {
    background: #f3e8d8;
    color: #4a2e33;
    font-family: 'Source Sans 3', Arial, sans-serif;
    font-size: 0.76rem;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }
  .branded-document__body header {
    margin: 0 0 0.9rem;
    padding-bottom: 0.35rem;
    border-bottom: 1px solid var(--doc-border);
    font-family: 'Source Sans 3', Arial, sans-serif;
    font-size: 0.72rem;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: #8c7a70;
  }
  .branded-document__body footer {
    margin-top: 1.2rem;
    padding-top: 0.45rem;
    border-top: 1px solid var(--doc-border);
    font-family: 'Source Sans 3', Arial, sans-serif;
    font-size: 0.72rem;
    color: #8c7a70;
  }
  .branded-document__body .doc-meta {
    margin: 0 0 1rem;
    color: #756963;
    font-family: 'Source Sans 3', Arial, sans-serif;
    font-size: 0.78rem;
  }
  .branded-document__body [data-doc-page-break] {
    height: 0;
    margin: 1.2rem 0;
    border-top: 1px dashed #d8c6b4;
  }
  .branded-document__body [data-doc-signature] {
    margin-top: 1.4rem;
    padding-top: 0.35rem;
    border-top: 1px solid var(--doc-ink);
    font-family: 'Source Sans 3', Arial, sans-serif;
    font-size: 0.72rem;
    color: #756963;
  }
  .branded-document__body [data-doc-signature]::after {
    content: 'Signature';
    display: block;
    margin-top: 0.15rem;
    font-size: 0.62rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--doc-gold);
  }
  .branded-document__footer {
    display: flex;
    justify-content: space-between;
    gap: 1rem;
    margin-top: 1.6rem;
    padding-top: 0.55rem;
    border-top: 1px solid var(--doc-gold-rule);
    font-family: 'Source Sans 3', Arial, sans-serif;
    font-size: 0.62rem;
    letter-spacing: 0.04em;
    color: #8c7a70;
  }
  .branded-document__footer span:last-child { text-align: right; }
  @media (max-width: 560px) {
    .branded-document { padding: 1.2rem 1rem 1rem; font-size: 10.2pt; }
    .branded-document__letterhead { align-items: flex-start; flex-wrap: wrap; }
    .branded-document__logo { width: 2.8rem; height: 2.8rem; }
    .branded-document__contact { width: 100%; text-align: left; }
    .branded-document__footer { flex-direction: column; gap: 0.2rem; }
    .branded-document__footer span:last-child { text-align: left; }
  }
  @media print {
    .branded-document {
      max-width: none;
      margin: 0;
      padding: 0;
      box-shadow: none;
    }
    .branded-document__body a { color: inherit; text-decoration: none; }
  }
`;

function escapeHtml(value: string): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export interface BrandedDocumentOptions {
  className?: string;
  headerText?: string;
  footerText?: string;
  variant?: 'preview' | 'signing' | 'print';
}

/** Wraps approved document content in the shared brand letterhead and footer. */
export function renderBrandedDocumentHtml(
  content: string,
  options: BrandedDocumentOptions = {},
): string {
  const className = String(options.className ?? '').trim();
  const variant = options.variant ?? 'preview';
  const headerText = String(options.headerText ?? '').trim();
  const footerText = String(options.footerText ?? '').trim() || 'Confidential customer copy';
  return `<article class="branded-document branded-document--${escapeHtml(variant)}${className ? ` ${escapeHtml(className)}` : ''}">
    <header class="branded-document__letterhead">
      <img class="branded-document__logo" src="${DOCUMENT_BRAND.logoUrl}" alt="${escapeHtml(DOCUMENT_BRAND.name)}" width="54" height="54" />
      <div class="branded-document__identity">
        <p class="branded-document__name">${escapeHtml(DOCUMENT_BRAND.name)}</p>
        <p class="branded-document__slogan">${escapeHtml(DOCUMENT_BRAND.slogan)}</p>
        ${headerText ? `<p class="branded-document__custom-header">${escapeHtml(headerText)}</p>` : ''}
      </div>
      <div class="branded-document__contact">
        <span>${escapeHtml(DOCUMENT_BRAND.phone)}</span>
        <span>${escapeHtml(DOCUMENT_BRAND.email)}</span>
        <span>sparkling-standard.com</span>
      </div>
    </header>
    <div class="branded-document__body">${renderDocumentHtml(content, 'branded-document__content')}</div>
    <footer class="branded-document__footer">
      <span>${escapeHtml(DOCUMENT_BRAND.legalName)} · ${escapeHtml(DOCUMENT_BRAND.slogan)}</span>
      <span>${escapeHtml(footerText)}</span>
    </footer>
  </article>`;
}
