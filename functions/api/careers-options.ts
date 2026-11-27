// GET /api/careers-options - public recruiting status and approved pay rates.
// Tampa Bay data is exposed only while the branch is publicly live, matching
// the server-rendered Careers presentation and application gate.
import { adminDb, type AdminDbEnv } from '../../src/lib/admin/d1.ts';
import { tampaPubliclyEnabled } from '../../src/lib/branches/public-visibility.ts';
import { CAREER_DEFAULT_PAY } from '../../src/lib/careers.ts';

interface Env extends AdminDbEnv {}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=60' },
  });
}

function pay(settings: Record<string, unknown> | null | undefined): Record<string, number> {
  return {
    regular: Number(settings?.pay_regular_cents ?? CAREER_DEFAULT_PAY.regular),
    lead: Number(settings?.pay_lead_cents ?? CAREER_DEFAULT_PAY.lead),
    solo: Number(settings?.pay_solo_cents ?? CAREER_DEFAULT_PAY.solo),
  };
}

export async function onRequestGet(context: { request: Request; env: Env }): Promise<Response> {
  const db = adminDb(context.env);
  if (!db) {
    return json({
      ok: true,
      branches: { pensacola: true, tampa: false },
      pay: {
        regular: CAREER_DEFAULT_PAY.regular,
        lead: CAREER_DEFAULT_PAY.lead,
        solo: CAREER_DEFAULT_PAY.solo,
      },
      payByBranch: { branch_pensacola: pay(null) },
      opportunities: [],
    });
  }
  const tampaEnabled = await tampaPubliclyEnabled(db);
  const tampaBranchId = tampaEnabled ? 'branch_tampa' : 'branch_pensacola';
  const [settings, opportunities] = await Promise.all([
    db
      .prepare(
        `SELECT branch_id, pay_regular_cents, pay_lead_cents, pay_solo_cents
         FROM recruitment_settings WHERE branch_id IN (?, ?)`,
      )
      .bind('branch_pensacola', tampaBranchId)
      .all<Record<string, unknown>>(),
    db
      .prepare(
        `SELECT branch_id, code, title, category, status, description
         FROM recruitment_opportunities
         WHERE branch_id IN (?, ?) ORDER BY branch_id, sort_order, title LIMIT 40`,
      )
      .bind('branch_pensacola', tampaBranchId)
      .all<Record<string, unknown>>(),
  ]);
  const payByBranch: Record<string, Record<string, number>> = {
    branch_pensacola: pay(null),
  };
  for (const row of settings.results ?? []) {
    const branchId = String(row.branch_id ?? '');
    if (branchId === 'branch_pensacola' || (tampaEnabled && branchId === 'branch_tampa')) {
      payByBranch[branchId] = pay(row);
    }
  }
  return json({
    ok: true,
    branches: { pensacola: true, tampa: tampaEnabled },
    pay: payByBranch.branch_pensacola,
    payByBranch,
    opportunities: opportunities.results ?? [],
  });
}
