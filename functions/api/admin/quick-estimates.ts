// Owner/manager Quick Estimate API. Uses the shared pricing engine and never
// creates a customer, booking, payment or calendar event without an explicit
// conversion action.
import { adminDb, type AdminDbEnv } from '../../../src/lib/admin/d1.ts';
import { AdminAuthError, audit, requireActor, requireCsrf } from '../../../src/lib/admin/operations.ts';
import {
  assignQuickEstimate,
  calculateQuickEstimate,
  convertQuickEstimate,
  discardQuickEstimate,
  getQuickEstimate,
  listQuickEstimates,
  saveQuickEstimate,
  type QuickEstimateEnv,
  type QuickEstimateInput,
  type QuickEstimateQuote,
} from '../../../src/lib/admin/quick-estimate.ts';
import {
  buildQuickEstimatePdf,
  buildQuickEstimateText,
  sendQuickEstimateEmail,
} from '../../../src/lib/admin/quick-estimate-document.ts';

interface Env extends AdminDbEnv, QuickEstimateEnv {}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

function text(value: unknown, max = 300): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function parsedRecord(row: Record<string, unknown>): {
  input: QuickEstimateInput;
  quote: QuickEstimateQuote;
  addressText: string;
} {
  return {
    input: JSON.parse(String(row.input_json ?? '{}')) as QuickEstimateInput,
    quote: JSON.parse(String(row.quote_json ?? '{}')) as QuickEstimateQuote,
    addressText: String(row.address_text ?? ''),
  };
}

function pdfResponse(pdf: Uint8Array, filename: string): Response {
  return new Response(pdf as unknown as BodyInit, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename.replace(/[^a-zA-Z0-9._-]/g, '_')}.pdf"`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

export async function onRequestGet(context: { request: Request; env: Env }): Promise<Response> {
  const db = adminDb(context.env);
  if (!db) return json({ ok: false, error: 'database_not_configured' }, 503);
  try {
    const actor = await requireActor(db, context.request, 'booking.read');
    const url = new URL(context.request.url);
    const view = text(url.searchParams.get('view'), 30) || 'list';
    if (view === 'list') {
      return json({
        ok: true,
        estimates: await listQuickEstimates(db, actor, {
          status: url.searchParams.get('status') ?? '',
          q: url.searchParams.get('q') ?? '',
        }),
      });
    }
    if (view === 'open' || view === 'pdf') {
      const id = text(url.searchParams.get('id'), 120);
      const record = await getQuickEstimate(db, actor, id);
      if (!record) return json({ ok: false, error: 'quick_estimate_not_found' }, 404);
      if (view === 'open') {
        const parsed = parsedRecord(record as unknown as Record<string, unknown>);
        return json({ ok: true, estimate: record, ...parsed });
      }
      const parsed = parsedRecord(record as unknown as Record<string, unknown>);
      return pdfResponse(
        buildQuickEstimatePdf(parsed.input, parsed.quote, parsed.addressText),
        `quick-estimate-${id}`,
      );
    }
    return json({ ok: false, error: 'invalid_view' }, 400);
  } catch (error) {
    return json(
      { ok: false, error: error instanceof AdminAuthError ? error.code : 'quick_estimate_failed' },
      error instanceof AdminAuthError ? error.status : 500,
    );
  }
}

export async function onRequestPost(context: { request: Request; env: Env }): Promise<Response> {
  const db = adminDb(context.env);
  if (!db) return json({ ok: false, error: 'database_not_configured' }, 503);
  try {
    const body = (await context.request.json().catch(() => ({}))) as Record<string, unknown>;
    const action = text(body.action, 40);
    const permission = action === 'calculate' || action === 'pdf' ? 'booking.write' : 'booking.write';
    const actor = await requireActor(db, context.request, permission);
    requireCsrf(context.request, actor);

    if (action === 'calculate') {
      const calculated = await calculateQuickEstimate(context.env, db, actor, body);
      return json({ ok: true, ...calculated });
    }
    if (action === 'save') {
      const saved = await saveQuickEstimate(context.env, db, actor, body);
      return json({ ok: true, ...saved });
    }
    if (action === 'assign') {
      const id = text(body.id, 120);
      await assignQuickEstimate(db, actor, id, body);
      const record = await getQuickEstimate(db, actor, id);
      return json({ ok: true, estimate: record });
    }
    if (action === 'discard') {
      await discardQuickEstimate(db, actor, text(body.id, 120));
      return json({ ok: true });
    }
    if (action === 'convert') {
      const id = text(body.id, 120);
      const converted = await convertQuickEstimate(context.env, db, actor, id, body);
      return json({ ok: true, ...converted });
    }
    if (action === 'pdf') {
      const id = text(body.id, 120);
      if (id) {
        const record = await getQuickEstimate(db, actor, id);
        if (!record) return json({ ok: false, error: 'quick_estimate_not_found' }, 404);
        const parsed = parsedRecord(record as unknown as Record<string, unknown>);
        return pdfResponse(
          buildQuickEstimatePdf(parsed.input, parsed.quote, parsed.addressText),
          `quick-estimate-${id}`,
        );
      }
      const calculated = await calculateQuickEstimate(context.env, db, actor, body);
      return pdfResponse(
        buildQuickEstimatePdf(calculated.input, calculated.quote, calculated.addressText),
        'quick-estimate-draft',
      );
    }
    if (action === 'email') {
      const id = text(body.id, 120);
      const record = await getQuickEstimate(db, actor, id);
      if (!record) return json({ ok: false, error: 'quick_estimate_not_found' }, 404);
      if (!['saved', 'draft', 'converted'].includes(record.status)) {
        return json({ ok: false, error: 'quick_estimate_closed' }, 409);
      }
      const to = text(body.email, 200) || record.customer_email;
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
        return json({ ok: false, error: 'customer_email_invalid' }, 400);
      }
      const parsed = parsedRecord(record as unknown as Record<string, unknown>);
      const message = buildQuickEstimateText(parsed.input, parsed.quote, parsed.addressText);
      const outcome = await sendQuickEstimateEmail(
        context.env,
        to,
        message,
        `quick-estimate-${id}-${Date.now()}`,
      );
      await audit(db, {
        actorUserId: actor.id,
        action: outcome.status === 'sent' ? 'quick_estimate.emailed' : 'quick_estimate.email_failed',
        entityType: 'quick_estimate',
        entityId: id,
        detail: outcome.status,
      }).catch(() => undefined);
      if (outcome.status === 'sent') return json({ ok: true, status: 'sent' });
      return json(
        { ok: false, error: outcome.status === 'skipped' ? 'email_not_configured' : 'email_failed' },
        outcome.status === 'skipped' ? 503 : 502,
      );
    }
    return json({ ok: false, error: 'invalid_action' }, 400);
  } catch (error) {
    return json(
      { ok: false, error: error instanceof AdminAuthError ? error.code : 'quick_estimate_failed' },
      error instanceof AdminAuthError ? error.status : 500,
    );
  }
}
