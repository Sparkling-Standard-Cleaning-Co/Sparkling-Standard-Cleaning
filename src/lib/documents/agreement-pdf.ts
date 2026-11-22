/**
 * Production-compatible executed agreement PDF.
 *
 * Uses the dependency-free PDF primitives already used by invoices so the
 * Cloudflare Function runtime does not need Chromium, LibreOffice or an external
 * rendering service. The PDF is an evidence artifact built from the immutable
 * signing-request snapshot; it is not a replacement for the exact approved
 * template hash stored with each signature.
 */
import {
  CONTENT_BOTTOM,
  INK,
  LEFT,
  MUTED,
  PAGE_HEIGHT,
  RIGHT,
  ROSE,
  assemblePdf,
  rule,
  text,
  wrap,
} from '../pdf/pdf-core.ts';

export interface AgreementPdfSignature {
  title: string;
  version: string;
  templateId: string;
  contentText: string;
  contentSha256: string;
  signerName: string;
  signerEmail: string;
  signedAt: string;
  typedSignature: string;
  status: string;
  consentVersion: string;
  sourceKind?: 'text' | 'pdf';
}

export interface AgreementPdfInput {
  requestId: string;
  bundleName: string;
  bundleCode: string;
  bundleVersion: number;
  bookingReference: string;
  serviceCode: string;
  customerName: string;
  propertyAddress: string;
  executedAt: string;
  countersignatureName?: string;
  signatures: AgreementPdfSignature[];
}

const BODY_SIZE = 9.2;
const LEADING = 12.4;
const HEAD_SIZE = 11.2;

function line(value: string, x: number, y: number, size: number, bold = false, color = INK): string {
  return text(value, x, y, size, bold, color);
}

function paragraphLines(value: string, maxWidth: number, size: number): string[] {
  const result: string[] = [];
  for (const raw of value.replace(/\r/g, '').split(/\n+/)) {
    const trimmed = raw.trim();
    if (!trimmed) {
      result.push('');
      continue;
    }
    result.push(...wrap(trimmed, maxWidth, size));
  }
  return result;
}

export function buildExecutedAgreementPdf(input: AgreementPdfInput): Uint8Array {
  const pages: string[] = [];
  let commands = '';
  let y = PAGE_HEIGHT - 58;

  const newPage = () => {
    pages.push(commands + `0.55 0.48 0.44 rg BT /F1 8 Tf ${LEFT} 38 Td (Sparkling Standard LLC - confidential) Tj ET\n` +
      `0.55 0.48 0.44 rg BT /F1 8 Tf ${RIGHT - 70} 38 Td (Page __PAGENO__) Tj ET\n`);
    commands = '';
    y = PAGE_HEIGHT - 58;
  };

  const ensure = (height: number) => {
    if (y - height < CONTENT_BOTTOM) newPage();
  };

  const write = (value: string, x = LEFT, size = BODY_SIZE, bold = false, color = INK, gap = LEADING, width = RIGHT - LEFT) => {
    for (const part of paragraphLines(value, width, size)) {
      ensure(gap);
      commands += line(part, x, y, size, bold, color);
      y -= gap;
    }
  };

  commands += line('SPARKLING STANDARD', LEFT, y, 15, true, ROSE);
  y -= 20;
  commands += line('Executed Agreement and Signature Record', LEFT, y, 19, true, INK);
  y -= 18;
  commands += line(`Request ${input.requestId}  |  ${input.executedAt}`, LEFT, y, 8.4, false, MUTED);
  y -= 16;
  commands += rule(y);
  y -= 18;

  const meta: Array<[string, string]> = [
    ['Agreement', `${input.bundleName || input.bundleCode} (version ${input.bundleVersion})`],
    ['Booking reference', input.bookingReference || 'Not applicable'],
    ['Service', input.serviceCode || 'Cleaning service'],
    ['Customer', input.customerName || 'Customer identified in the signed schedule'],
    ['Property', input.propertyAddress || 'Property identified in the signed schedule'],
  ];
  for (const [label, value] of meta) {
    ensure(LEADING);
    commands += line(`${label}:`, LEFT, y, BODY_SIZE, true, INK);
    commands += line(value, LEFT + 95, y, BODY_SIZE, false, INK);
    y -= LEADING;
  }
  y -= 6;

  for (const signature of input.signatures) {
    ensure(24);
    commands += line(signature.title, LEFT, y, HEAD_SIZE, true, ROSE);
    y -= 15;
    commands += line(
      `Template ${signature.templateId}  |  Version ${signature.version}  |  SHA-256 ${signature.contentSha256}`,
      LEFT,
      y,
      7.6,
      false,
      MUTED,
    );
    y -= 14;
    if (signature.sourceKind === 'pdf' && !signature.contentText.trim()) {
      write(
        'This document was signed as a separate PDF template. The exact template SHA-256 above is the signed content. The original PDF is retained privately and forms part of this record.',
      );
    } else {
      write(signature.contentText || 'Document content is retained in the signing record.');
    }
    ensure(70);
    y -= 6;
    commands += rule(y);
    y -= 14;
    commands += line('Electronic signature', LEFT, y, BODY_SIZE, true, INK);
    y -= LEADING;
    commands += line(`Typed signature: ${signature.typedSignature || signature.signerName}`, LEFT + 8, y, BODY_SIZE, false, INK);
    y -= LEADING;
    commands += line(`Signer: ${signature.signerName} <${signature.signerEmail}>`, LEFT + 8, y, BODY_SIZE, false, INK);
    y -= LEADING;
    commands += line(`Signed at: ${signature.signedAt}  |  Status: ${signature.status}`, LEFT + 8, y, BODY_SIZE, false, MUTED);
    y -= LEADING;
    commands += line(`Consent version: ${signature.consentVersion}`, LEFT + 8, y, BODY_SIZE, false, MUTED);
    y -= 18;
    commands += rule(y);
    y -= 16;
  }

  ensure(90);
  commands += line('Execution and audit record', LEFT, y, HEAD_SIZE, true, ROSE);
  y -= 15;
  const audit = [
    `Signing request: ${input.requestId}`,
    `Bundle: ${input.bundleCode} version ${input.bundleVersion}`,
    `Executed at: ${input.executedAt}`,
    `Customer: ${input.customerName || 'as recorded'}`,
    `Property: ${input.propertyAddress || 'as recorded'}`,
    `Booking reference: ${input.bookingReference || 'not applicable'}`,
    `Countersigned by: ${input.countersignatureName || 'not required'}`,
    'Each signature is bound to the exact document version and SHA-256 shown above. The signing token, signer identity, consent version, timestamp and audit evidence are retained privately.',
    'This executed copy is evidence of the signed record. It does not approve an incomplete, unapproved or placeholder-containing document.',
  ];
  for (const entry of audit) {
    ensure(LEADING);
    write(entry, LEFT + 6, BODY_SIZE, false, MUTED, LEADING, RIGHT - LEFT - 6);
  }

  pages.push(commands + `0.55 0.48 0.44 rg BT /F1 8 Tf ${LEFT} 38 Td (Sparkling Standard LLC - confidential) Tj ET\n` +
    `0.55 0.48 0.44 rg BT /F1 8 Tf ${RIGHT - 70} 38 Td (Page __PAGENO__) Tj ET\n`);

  const numbered = pages.map((page, index) => page.replaceAll('__PAGENO__', `${index + 1} of ${pages.length}`));
  return assemblePdf(numbered);
}
