import { adminDb, type AdminDbEnv } from '../../src/lib/admin/d1.ts';
import { checkPublicRateLimit, clientIp, consumePublicRateLimit, PUBLIC_RATE_LIMITS } from '../../src/lib/public-rate-limit.ts';
import { CAREER_PIPELINE_STATUSES } from '../../src/lib/careers.ts';

interface Env extends AdminDbEnv {}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
}

function text(value: unknown, max = 200): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

export async function onRequestGet(context: { request: Request; env: Env }): Promise<Response> {
  const db = adminDb(context.env);
  if (!db) return json({ ok: false, error: 'database_not_configured' }, 503);
  const ip = clientIp(context.request);
  const limited = await checkPublicRateLimit(db, 'careers-status', ip, PUBLIC_RATE_LIMITS.careerStatusIp);
  if (limited.limited) return json({ ok: false, error: 'rate_limited' }, 429);
  await consumePublicRateLimit(db, 'careers-status', ip, PUBLIC_RATE_LIMITS.careerStatusIp);
  const url = new URL(context.request.url);
  const reference = text(url.searchParams.get('reference'), 40).toUpperCase();
  const email = text(url.searchParams.get('email'), 200).toLowerCase();
  if (!/^APP-\d{8}-[A-Z0-9]{6}$/.test(reference) || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    return json({ ok: false, error: 'invalid_reference' }, 400);
  }
  const row = await db.prepare(
    'SELECT reference, pipeline_status, created_at, updated_at FROM career_applications WHERE reference = ? AND lower(email) = ? LIMIT 1',
  ).bind(reference, email).first<{ reference: string; pipeline_status: string; created_at: string; updated_at: string }>();
  const valid = CAREER_PIPELINE_STATUSES.some((entry) => entry.value === row?.pipeline_status);
  if (!row || !valid) {
    return json({ ok: false, error: 'not_found' }, 404);
  }
  return json({ ok: true, reference: row.reference, status: row.pipeline_status, submittedAt: row.created_at, updatedAt: row.updated_at });
}

