import test from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateDispatchJob,
  requiredEquipmentForService,
  requiresLeadForService,
  type DispatchEmployee,
  type DispatchJob,
  type DispatchLatLng,
  type DispatchSettings,
  type RouteResolver,
} from '../src/lib/dispatch/engine.ts';

const origin: DispatchLatLng = { lat: 30.42, lng: -87.22 };
const destination: DispatchLatLng = { lat: 30.45, lng: -87.25 };
const settings: DispatchSettings = {
  weights: { travel: 1, miles: 0.2, labor: 0.1, workload: 0.5, continuity: 12, shared: 0 },
  vehicleCostCentsPerMile: 0,
  travelPayPercent: 0,
  maxCandidates: 8,
  bufferMinutes: 15,
};
const route: RouteResolver = async () => ({ minutes: 10, miles: 5, verified: true });
const unavailableRoute: RouteResolver = async () => ({ minutes: null, miles: null, verified: false });

function employee(overrides: Partial<DispatchEmployee> = {}): DispatchEmployee {
  return {
    id: 'team_a',
    name: 'Avery',
    branchId: 'branch_pensacola',
    status: 'active',
    bookable: true,
    isSolo: true,
    isLead: true,
    services: ['standard', 'deep', 'commercial-cleaning', 'church-cleaning'],
    equipment: ['standard-kit', 'deep-kit', 'commercial-kit'],
    transportMode: 'independent',
    canDrive: true,
    seats: 3,
    canTransportEquipment: true,
    origin,
    shiftOverrides: [],
    timeOff: [],
    workdays: [0,1,2,3,4,5,6],
    workdayStart: '07:00',
    workdayEnd: '18:00',
    weeklyMinutes: 0,
    maxWeeklyMinutes: 2400,
    overtimeApproved: false,
    rateCents: 2200,
    customerHistory: [],
    ...overrides,
  };
}

function job(overrides: Partial<DispatchJob> = {}): DispatchJob {
  return {
    id: 'appt_1',
    branchId: 'branch_pensacola',
    start: '2026-12-01T14:00:00.000Z',
    end: '2026-12-01T16:00:00.000Z',
    timeZone: 'America/Chicago',
    crewSize: 1,
    serviceCode: 'standard',
    requiredEquipment: requiredEquipmentForService('standard'),
    requiredLead: requiresLeadForService('standard'),
    location: destination,
    customerId: 'cust_1',
    assignedIds: [],
    status: 'confirmed',
    updatedAt: '2026-11-20T12:00:00.000Z',
    existingTimeline: {},
    ...overrides,
  };
}

test('a qualified solo cleaner is selected for an unassigned residential job', async () => {
  const result = await evaluateDispatchJob(job(), [employee()], settings, route);
  assert.equal(result.feasible.length, 1);
  assert.deepEqual(result.feasible[0]?.employeeIds, ['team_a']);
  assert.equal(result.feasible[0]?.transport, 'independent');
  assert.equal(result.feasible[0]?.travelMinutes, 10);
});

test('a helper cannot independently anchor a job', async () => {
  const result = await evaluateDispatchJob(job(), [employee({ isSolo: false, isLead: false })], settings, route);
  assert.equal(result.feasible.length, 0);
  assert.ok(result.blocked.some((entry) => entry.reasons.includes('crew_roles_invalid')));
});

test('a commercial job requires an approved lead', async () => {
  const commercial = job({
    crewSize: 2,
    serviceCode: 'commercial-cleaning',
    requiredEquipment: requiredEquipmentForService('commercial-cleaning'),
    requiredLead: true,
  });
  const helper = employee({ id: 'team_b', name: 'Blake', isSolo: false, isLead: false, services: ['commercial-cleaning'] });
  const result = await evaluateDispatchJob(commercial, [helper], settings, route);
  assert.equal(result.feasible.length, 0);
});

test('lead plus helper forms a feasible crew', async () => {
  const helper = employee({ id: 'team_b', name: 'Blake', isSolo: false, isLead: false });
  const twoPerson = job({ crewSize: 2 });
  const result = await evaluateDispatchJob(twoPerson, [employee(), helper], settings, route);
  assert.ok(result.feasible.length > 0);
  assert.equal(result.feasible[0]?.employeeIds.length, 2);
});

test('a passenger requires shared crew transport and a capable driver', async () => {
  const passenger = employee({
    id: 'team_b',
    name: 'Blake',
    isSolo: false,
    isLead: false,
    transportMode: 'shared',
    canDrive: false,
    seats: 0,
  });
  const result = await evaluateDispatchJob(job({ crewSize: 2 }), [employee(), passenger], settings, route);
  assert.ok(result.feasible.length > 0);
  assert.equal(result.feasible[0]?.transport, 'shared');
});

test('shared transport is rejected when the vehicle has insufficient seats', async () => {
  const passenger = employee({ id: 'team_b', name: 'Blake', isSolo: false, isLead: false, transportMode: 'shared', canDrive: false, seats: 0 });
  const result = await evaluateDispatchJob(job({ crewSize: 2 }), [employee({ seats: 1 }), passenger], settings, route);
  assert.equal(result.feasible.length, 0);
});

test('an employee without configured transport is not assigned', async () => {
  const result = await evaluateDispatchJob(job(), [employee({ transportMode: 'unknown' })], settings, route);
  assert.equal(result.feasible.length, 0);
});

test('a service qualification gap blocks assignment', async () => {
  const result = await evaluateDispatchJob(job(), [employee({ services: ['deep'] })], settings, route);
  assert.equal(result.feasible.length, 0);
  assert.ok(result.blocked.some((entry) => entry.reasons.includes('service_not_qualified')));
});

test('a missing equipment capability blocks assignment', async () => {
  const result = await evaluateDispatchJob(job(), [employee({ equipment: [] })], settings, route);
  assert.equal(result.feasible.length, 0);
  assert.ok(result.blocked.some((entry) => entry.reasons.includes('equipment_unavailable')));
});

test('a different branch cannot be used for automatic dispatch', async () => {
  const result = await evaluateDispatchJob(job(), [employee({ branchId: 'branch_tampa' })], settings, route);
  assert.equal(result.feasible.length, 0);
  assert.ok(result.blocked.some((entry) => entry.reasons.includes('cross_branch_not_authorized')));
});

test('time off blocks assignment', async () => {
  const off = employee({ timeOff: [{ start: '2026-12-01T00:00:00.000Z', end: '2026-12-02T00:00:00.000Z' }] });
  const result = await evaluateDispatchJob(job(), [off], settings, route);
  assert.equal(result.feasible.length, 0);
  assert.ok(result.blocked.some((entry) => entry.reasons.includes('time_off')));
});

test('an existing overlapping job blocks assignment', async () => {
  const busy = employee({
    existingTimeline: {
      team_a: [{ id: 'appt_existing', start: '2026-12-01T14:00:00.000Z', end: '2026-12-01T15:00:00.000Z', location: destination, assignedIds: ['team_a'] }],
    },
  });
  const result = await evaluateDispatchJob(job({ existingTimeline: busy.existingTimeline }), [busy], settings, route);
  assert.equal(result.feasible.length, 0);
  assert.ok(result.blocked.some((entry) => entry.reasons.includes('schedule_conflict')));
});

test('unverified travel blocks assignment instead of inventing availability', async () => {
  const result = await evaluateDispatchJob(job(), [employee()], settings, unavailableRoute);
  assert.equal(result.feasible.length, 0);
  assert.ok(result.blocked.some((entry) => entry.reasons.includes('travel_unavailable')));
});

test('weekly hours block automatic assignment without overtime approval', async () => {
  const over = employee({ weeklyMinutes: 2350 });
  const result = await evaluateDispatchJob(job(), [over], settings, route);
  assert.equal(result.feasible.length, 0);
  assert.ok(result.blocked.some((entry) => entry.reasons.includes('weekly_hours_exceeded')));
});

test('approved overtime allows a feasible assignment', async () => {
  const over = employee({ weeklyMinutes: 2350, overtimeApproved: true });
  const result = await evaluateDispatchJob(job(), [over], settings, route);
  assert.equal(result.feasible.length, 1);
});

test('customer continuity improves the ranking without overriding hard constraints', async () => {
  const familiar = employee({ id: 'team_a', name: 'Avery', customerHistory: ['cust_1'], rateCents: 2600 });
  const cheaper = employee({ id: 'team_b', name: 'Blake', customerHistory: [], rateCents: 2000 });
  const result = await evaluateDispatchJob(job(), [familiar, cheaper], settings, route);
  assert.ok(result.feasible.length >= 2);
  assert.equal(result.feasible[0]?.employeeIds.includes('team_a'), true);
});

test('an employee with a prior non-overlapping job is evaluated against the whole day', async () => {
  const morning = employee({
    existingTimeline: {
      team_a: [{ id: 'appt_morning', start: '2026-12-01T13:00:00.000Z', end: '2026-12-01T13:30:00.000Z', location: origin, assignedIds: ['team_a'] }],
    },
  });
  const result = await evaluateDispatchJob(job({ existingTimeline: morning.existingTimeline, start: '2026-12-01T15:00:00.000Z', end: '2026-12-01T17:00:00.000Z' }), [morning], settings, route);
  assert.equal(result.feasible.length, 1);
});
