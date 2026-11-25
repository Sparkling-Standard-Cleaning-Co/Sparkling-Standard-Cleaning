/**
 * Owner-approved crew planning for residential and STR cleanings.
 *
 * A quote owns PERSON-hours of labor, not a fixed on-site duration. A long
 * afternoon job must not be rejected only because a single cleaner would finish
 * after the published operating window. The planner finds the smallest
 * additional crew that completes the same person-hours before closing.
 *
 * Multi-cleaner work is not perfectly linear: each additional cleaner adds
 * `efficiency` of a solo cleaner's rate (owner setting in bookingConfig).
 * Durations are rounded up to the scheduling grid so the calendar never
 * understates an arrival-to-departure block.
 */

export interface CrewPlanInput {
  laborHours: number;
  /** Local minutes after midnight for the requested start. */
  startMinutes: number;
  /** Local minutes after midnight for the operating day end. */
  workdayEndMinutes: number;
  minimumJobMinutes: number;
  maximumJobMinutes: number;
  maxCrewSize: number;
  /** Additional-cleaner efficiency in (0, 1]. */
  efficiency: number;
  /** Scheduling grid in minutes (defaults to 15). */
  slotMinutes?: number;
}

export interface CrewPlan {
  laborMinutes: number;
  availableMinutes: number;
  crewSize: number;
  durationMinutes: number;
  feasible: boolean;
  reason?: 'invalid_labor' | 'beyond_operating_hours' | 'duration_invalid';
}

function finitePositive(value: number): number | null {
  return Number.isFinite(value) && value > 0 ? value : null;
}

export function effectiveCapacityPerMinute(crewSize: number, efficiency: number): number {
  const safeEfficiency = Number.isFinite(efficiency) ? Math.min(1, Math.max(0.1, efficiency)) : 1;
  return 1 + Math.max(0, crewSize - 1) * safeEfficiency;
}

export function planCrew(input: CrewPlanInput): CrewPlan {
  const slotMinutes =
    Number.isFinite(input.slotMinutes) && (input.slotMinutes ?? 0) > 0
      ? Math.round(input.slotMinutes as number)
      : 15;
  const laborHours = finitePositive(input.laborHours);
  const availableMinutes = Math.max(0, input.workdayEndMinutes - input.startMinutes);
  if (laborHours === null || availableMinutes <= 0) {
    return {
      laborMinutes: 0,
      availableMinutes,
      crewSize: 1,
      durationMinutes: input.minimumJobMinutes,
      feasible: false,
      reason: laborHours === null ? 'invalid_labor' : 'beyond_operating_hours',
    };
  }
  const laborMinutes = Math.ceil(laborHours * 60);
  const maxCrew = Math.max(1, Math.round(input.maxCrewSize));
  const minimum = Math.max(1, Math.round(input.minimumJobMinutes));
  const maximum = Math.max(minimum, Math.round(input.maximumJobMinutes));

  let fallback: CrewPlan | null = null;
  for (let crewSize = 1; crewSize <= maxCrew; crewSize += 1) {
    const raw = laborMinutes / effectiveCapacityPerMinute(crewSize, input.efficiency);
    const rounded = Math.max(minimum, Math.ceil(raw / slotMinutes) * slotMinutes);
    const plan: CrewPlan = {
      laborMinutes,
      availableMinutes,
      crewSize,
      durationMinutes: rounded,
      feasible: rounded <= maximum && rounded <= availableMinutes,
    };
    if (plan.feasible) return plan;
    if (rounded > maximum) {
      fallback = plan;
      continue;
    }
    // The crew can complete the work inside the maximum job length but not
    // before closing. A larger crew may still fit, so keep searching.
    fallback = plan;
    if (rounded <= availableMinutes) return plan;
  }
  return {
    ...(fallback ?? {
      laborMinutes,
      availableMinutes,
      crewSize: maxCrew,
      durationMinutes: minimum,
    }),
    feasible: false,
    reason: 'beyond_operating_hours',
  };
}
