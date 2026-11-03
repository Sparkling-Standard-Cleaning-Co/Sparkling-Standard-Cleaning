// Canonical active-branch resolution for owner-created records.
//
// A customer, team member or invoice without a branch disappears from every
// manager-scoped view. Owner-created records therefore receive the operating
// branch instead of NULL when the owner did not explicitly choose one.

import type { D1Database } from './d1.ts';

export async function defaultActiveBranch(db: D1Database): Promise<string | null> {
  const row = await db
    .prepare(
      `SELECT id FROM branches
       WHERE status = 'active'
       ORDER BY CASE WHEN id = 'branch_pensacola' THEN 0 ELSE 1 END, id
       LIMIT 1`,
    )
    .first<{ id: string }>();
  return row?.id ?? null;
}
