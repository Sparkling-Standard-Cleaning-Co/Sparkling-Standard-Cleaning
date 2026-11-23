import { adminDb, type AdminDbEnv } from '../../../src/lib/admin/d1.ts';
import { AdminAuthError, requireActor } from '../../../src/lib/admin/operations.ts';
import { getInvoice } from '../../../src/lib/admin/billing.ts';
import { buildAdminInvoice } from '../../../src/lib/invoicing/admin-invoice.ts';
import { buildInvoicePdf } from '../../../src/lib/invoicing/pdf.ts';
import { invoiceReviewInvitation, reviewContextForInvoice } from '../../../src/lib/reviews/service.ts';

interface Env extends AdminDbEnv {}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

export async function onRequestGet(context: { request: Request; env: Env }): Promise<Response> {
  const db = adminDb(context.env);
  if (!db) return json({ ok: false, error: 'database_not_configured' }, 503);
  try {
    const actor = await requireActor(db, context.request, 'finance.read');
    const id = new URL(context.request.url).searchParams.get('id') ?? '';
    if (!id) return json({ ok: false, error: 'invoice_required' }, 400);
    const result = await getInvoice(db, actor, id);
    if (!result) return json({ ok: false, error: 'invoice_not_found' }, 404);
    const review = invoiceReviewInvitation(await reviewContextForInvoice(db, id).catch(() => null));
    const document = buildAdminInvoice({
      invoice: result.invoice as Record<string, unknown>,
      lines: (result.lines as Array<Record<string, unknown>>) ?? [],
      ...(review ? { review } : {}),
    });
    const pdf = buildInvoicePdf(document.data, document.totals);
    const filename = `${String((result.invoice as Record<string, unknown>).number ?? 'invoice').replace(/[^A-Za-z0-9._-]+/g, '-')}.pdf`;
    return new Response(pdf.buffer as ArrayBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': String(pdf.byteLength),
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'X-Robots-Tag': 'noindex, nofollow',
        'Referrer-Policy': 'no-referrer',
      },
    });
  } catch (error) {
    return json(
      { ok: false, error: error instanceof AdminAuthError ? error.code : 'invoice_document_failed' },
      error instanceof AdminAuthError ? error.status : 500,
    );
  }
}
