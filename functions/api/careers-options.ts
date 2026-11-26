// GET /api/careers-options - public recruiting status and approved pay rates.
import { adminDb, type AdminDbEnv } from '../../src/lib/admin/d1.ts';
import { CAREER_DEFAULT_PAY } from '../../src/lib/careers.ts';

interface Env extends AdminDbEnv {}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=60' },
  });
}

export async function onRequestGet(context: { request: Request; env: Env }): Promise<Response> {
  const db = adminDb(context.env);
  if (!db) {
    return json({
      ok: true,
      pay: {
        regular: CAREER_DEFAULT_PAY.regular,
        lead: CAREER_DEFAULT_PAY.lead,
        solo: CAREER_DEFAULT_PAY.solo,
      },
      opportunities: [],
    });
  }
  const [settings, opportunities] = await Promise.all([
    db
      .prepare(
        `SELECT branch_id, pay_regular_cents, pay_lead_cents, pay_solo_cents
         FROM recruitment_settings WHERE branch_id = 'branch_pensacola' LIMIT 1`,
      )
      .first<Record<string, unknown>>(),
    db
      .prepare(
        `SELECT branch_id, code, title, category, status, description
         FROM recruitment_opportunities
         WHERE status <> 'closed' ORDER BY branch_id, sort_order, title LIMIT 40`,
      )
      .all<Record<string, unknown>>(),
  ]);
  return json({
    ok: true,
    pay: {
      regular: Number(settings?.pay_regular_cents ?? CAREER_DEFAULT_PAY.regular),
      lead: Number(settings?.pay_lead_cents ?? CAREER_DEFAULT_PAY.lead),
      solo: Number(settings?.pay_solo_cents ?? CAREER_DEFAULT_PAY.solo),
    },
    opportunities: opportunities.results ?? [],
  });
}
