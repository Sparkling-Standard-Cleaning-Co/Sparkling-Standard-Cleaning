// One recurring feature gate shared by customer creation, admin management and
// the Worker endpoint. The owner can explicitly disable recurring with
// RECURRING_SCHEDULING_ENABLED=false; absence keeps the existing feature active.
export function recurringSchedulingEnabled(env: {
  RECURRING_SCHEDULING_ENABLED?: string;
}): boolean {
  return env.RECURRING_SCHEDULING_ENABLED?.trim().toLowerCase() !== 'false';
}
