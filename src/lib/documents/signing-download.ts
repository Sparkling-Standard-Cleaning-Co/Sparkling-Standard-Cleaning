/**
 * Pure download-target resolution for the public signing endpoint.
 *
 * The executed copy is one combined PDF stored after every required document is
 * signed. Individual template PDFs remain downloadable while a packet is still
 * in progress. Keeping this selection pure makes the authorization-sensitive
 * branch testable without a browser, D1 or R2.
 */
export interface SigningDownloadRequirement {
  templateId: string;
  title: string;
  r2Key: string;
}

export interface SigningDownloadTarget {
  kind: 'executed' | 'template';
  key: string;
  filename: string;
}

export interface SigningDownloadError {
  error: 'document_not_found' | 'signing_incomplete' | 'invalid_download';
}

export function executedCopyKey(requestId: string): string {
  return `documents/executed/${requestId}.pdf`;
}

export function safePdfFilename(title: string, fallback = 'document'): string {
  const base = title.replaceAll('\\', '/').split('/').filter(Boolean).pop() ?? '';
  const cleaned = base
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^[._-]+|[._-]+$/g, '');
  return `${cleaned || fallback}.pdf`;
}

export function resolveSigningDownload(
  downloadId: string,
  requestId: string,
  requirements: SigningDownloadRequirement[],
  allRequiredSigned: boolean,
  executedKey = executedCopyKey(requestId),
): SigningDownloadTarget | SigningDownloadError {
  if (!downloadId) return { error: 'invalid_download' };
  if (downloadId === 'executed') {
    if (!allRequiredSigned) return { error: 'signing_incomplete' };
    return {
      kind: 'executed',
      key: executedKey,
      filename: safePdfFilename(`Executed Agreement ${requestId}`, 'executed-agreement'),
    };
  }
  const requirement = requirements.find((item) => item.templateId === downloadId);
  if (!requirement || !requirement.r2Key) return { error: 'document_not_found' };
  return {
    kind: 'template',
    key: requirement.r2Key,
    filename: safePdfFilename(requirement.title),
  };
}
