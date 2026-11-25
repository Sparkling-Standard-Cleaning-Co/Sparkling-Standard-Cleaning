/**
 * Staffing-pending lifecycle. A paid or accepted reservation whose required
 * crew is not fully assigned remains visible to management until the missing
 * seats are filled. Assignment operations call this helper so the warning
 * clears only when the real crew count satisfies the required crew size.
 */
import type { D1Database } from '../admin/d1.ts';

export interface StaffingState {
  pending: boolean;
  requiredCrew: number;
  assignedCrew: number;
}

export async function refreshStaffingPendingState(
  db: D1Database,
  appointmentId: string,
): Promise<StaffingState> {
  const row = await db
    .prepare(
      `SELECT a.crew_size, a.staffing_pending,
              (SELECT COUNT(*) FROM appointment_resources ar WHERE ar.appointment_id = a.id) AS assigned
       FROM appointments a WHERE a.id = ? LIMIT 1`,
    )
    .bind(appointmentId)
    .first<{ crew_size: number; staffing_pending: number; assigned: number }>();
  if (!row) return { pending: false, requiredCrew: 0, assignedCrew: 0 };
  const requiredCrew = Math.max(1, Number(row.crew_size) || 1);
  const assignedCrew = Math.max(0, Number(row.assigned) || 0);
  if (Number(row.staffing_pending) !== 1) {
    return { pending: false, requiredCrew, assignedCrew };
  }
  if (assignedCrew >= requiredCrew) {
    await db
      .prepare(
        `UPDATE appointments
         SET staffing_pending = 0, staffing_reason = '', updated_at = ?
         WHERE id = ?`,
      )
      .bind(new Date().toISOString(), appointmentId)
      .run();
    return { pending: false, requiredCrew, assignedCrew };
  }
  return { pending: true, requiredCrew, assignedCrew };
}
