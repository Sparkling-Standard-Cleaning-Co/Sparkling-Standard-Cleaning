// One recurring feature gate shared by customer creation, admin management and
// the Worker endpoint. Recurring scheduling requires an explicit owner opt-in
// so a missing or malformed flag can never activate an unverified schedule.
export function recurringSchedulingEnabled(env: {
  RECURRING_SCHEDULING_ENABLED?: string;
}): boolean {
  return env.RECURRING_SCHEDULING_ENABLED?.trim().toLowerCase() === 'true';
}
