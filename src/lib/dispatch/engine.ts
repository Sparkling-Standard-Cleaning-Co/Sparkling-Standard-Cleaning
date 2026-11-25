export type DispatchTransportMode = 'independent' | 'shared' | 'none' | 'unknown';

export interface DispatchLatLng {
  lat: number;
  lng: number;
}

export interface DispatchShiftOverride {
  date: string;
  startTime: string;
  endTime: string;
  available: boolean;
}

export interface DispatchTimeOff {
  start: string;
  end: string;
}

export interface DispatchEmployee {
  id: string;
  name: string;
  branchId: string | null;
  status: 'active' | 'inactive';
  bookable: boolean;
  isSolo: boolean;
  isLead: boolean;
  services: string[];
  equipment: string[];
  transportMode: DispatchTransportMode;
  canDrive: boolean;
  seats: number;
  canTransportEquipment: boolean;
  origin: DispatchLatLng | null;
  shiftOverrides: DispatchShiftOverride[];
  timeOff: DispatchTimeOff[];
  workdays: number[];
  workdayStart: string;
  workdayEnd: string;
  weeklyMinutes: number;
  maxWeeklyMinutes: number;
  overtimeApproved: boolean;
  rateCents: number;
  customerHistory: string[];
}

export interface DispatchTimelineJob {
  id: string;
  start: string;
  end: string;
  location: DispatchLatLng | null;
  assignedIds: string[];
}

export interface DispatchJob {
  id: string;
  branchId: string;
  start: string;
  end: string;
  timeZone: string;
  crewSize: number;
  serviceCode: string;
  requiredEquipment: string[];
  requiredLead: boolean;
  location: DispatchLatLng | null;
  customerId: string;
  assignedIds: string[];
  status: string;
  updatedAt: string;
  existingTimeline: Record<string, DispatchTimelineJob[]>;
}

export interface DispatchRoute {
  minutes: number | null;
  miles: number | null;
  verified: boolean;
}

export type RouteResolver = (from: DispatchLatLng, to: DispatchLatLng) => Promise<DispatchRoute>;

export interface DispatchWeights {
  travel: number;
  miles: number;
  labor: number;
  workload: number;
  continuity: number;
  shared: number;
}

export interface DispatchScore {
  travelMinutes: number;
  travelMiles: number;
  laborCents: number;
  workMinutes: number;
  continuity: number;
  shared: boolean;
  total: number;
}

export interface DispatchCandidate {
  employeeIds: string[];
  employeeNames: string[];
  roles: string[];
  transport: 'independent' | 'shared';
  travelMinutes: number;
  travelMiles: number;
  laborCents: number;
  score: DispatchScore;
  feasible: true;
  explanation: string[];
}

export interface DispatchBlocked {
  employeeIds: string[];
  reasons: string[];
}

export interface DispatchEvaluation {
  jobId: string;
  feasible: DispatchCandidate[];
  blocked: DispatchBlocked[];
  evaluated: number;
}

export interface DispatchSettings {
  weights: DispatchWeights;
  vehicleCostCentsPerMile: number;
  travelPayPercent: number;
  maxCandidates: number;
  bufferMinutes: number;
}

export const DEFAULT_DISPATCH_SETTINGS: DispatchSettings = {
  weights: { travel: 1, miles: 0.2, labor: 0.1, workload: 0.5, continuity: 12, shared: 0 },
  vehicleCostCentsPerMile: 0,
  travelPayPercent: 0,
  maxCandidates: 8,
  bufferMinutes: 15,
};

function minutes(start: string, end: string): number {
  return Math.max(0, Math.round((Date.parse(end) - Date.parse(start)) / 60_000));
}

function addMinutes(value: string, amount: number): string {
  return new Date(Date.parse(value) + amount * 60_000).toISOString();
}

function localDate(value: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(value));
}

function localWeekday(value: string, timeZone: string): number {
  const label = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short' }).format(new Date(value));
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(label);
}

function wallTime(date: string, time: string, timeZone: string): string {
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  const wall = Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1, hour ?? 0, minute ?? 0);
  let guess = wall;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(new Date(guess));
    const value = (type: Intl.DateTimeFormatPartTypes): number =>
      Number(parts.find((part) => part.type === type)?.value ?? '0');
    const rendered = Date.UTC(value('year'), value('month') - 1, value('day'), value('hour'), value('minute'), value('second'));
    const offset = rendered - new Date(guess).getTime();
    const next = wall - offset;
    if (Math.abs(next - guess) < 1000) return new Date(next).toISOString();
    guess = next;
  }
  return new Date(guess).toISOString();
}

function shiftFor(employee: DispatchEmployee, date: string, job: DispatchJob): { start: string; end: string } | null {
  const override = employee.shiftOverrides.find((entry) => entry.date === date);
  if (override) {
    if (!override.available) return null;
    return {
      start: wallTime(date, override.startTime, job.timeZone),
      end: wallTime(date, override.endTime, job.timeZone),
    };
  }
  if (!employee.workdays.includes(localWeekday(job.start, job.timeZone))) return null;
  return {
    start: wallTime(date, employee.workdayStart, job.timeZone),
    end: wallTime(date, employee.workdayEnd, job.timeZone),
  };
}

function overlaps(startA: string, endA: string, startB: string, endB: string): boolean {
  return Date.parse(startA) < Date.parse(endB) && Date.parse(startB) < Date.parse(endA);
}

function employeeTimeOff(employee: DispatchEmployee, start: string, end: string): boolean {
  return employee.timeOff.some((entry) => overlaps(start, end, entry.start, entry.end));
}

interface Legs {
  minutes: number;
  miles: number;
}

async function routeLegs(
  points: DispatchLatLng[],
  route: RouteResolver,
): Promise<Legs | null> {
  let totalMinutes = 0;
  let totalMiles = 0;
  for (let index = 0; index < points.length - 1; index += 1) {
    const from = points[index];
    const to = points[index + 1];
    if (!from || !to) return null;
    if (Math.abs(from.lat - to.lat) < 0.00002 && Math.abs(from.lng - to.lng) < 0.00002) continue;
    const resolved = await route(from, to);
    if (!resolved.verified || resolved.minutes === null || resolved.miles === null) return null;
    totalMinutes += resolved.minutes;
    totalMiles += resolved.miles;
  }
  return { minutes: totalMinutes, miles: totalMiles };
}

async function independentFeasibility(
  employee: DispatchEmployee,
  job: DispatchJob,
  shift: { start: string; end: string },
  settings: DispatchSettings,
  route: RouteResolver,
): Promise<{ ok: true; minutes: number; miles: number } | { ok: false; reason: string }> {
  if (!employee.origin) return { ok: false, reason: 'dispatch_origin_missing' };
  if (!job.location) return { ok: false, reason: 'job_location_missing' };
  if (employee.transportMode === 'none' || employee.transportMode === 'shared') {
    return { ok: false, reason: 'independent_transport_unavailable' };
  }
  if (employee.transportMode === 'unknown') return { ok: false, reason: 'transport_unknown' };
  if (employeeTimeOff(employee, job.start, job.end)) return { ok: false, reason: 'time_off' };
  const timeline = [...(job.existingTimeline[employee.id] ?? [])].sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
  if (timeline.some((entry) => overlaps(entry.start, entry.end, job.start, job.end))) {
    return { ok: false, reason: 'schedule_conflict' };
  }
  if (timeline.some((entry) => !entry.location)) return { ok: false, reason: 'existing_job_location_missing' };
  const sequence = [...timeline, {
    id: job.id,
    start: job.start,
    end: job.end,
    location: job.location,
    assignedIds: [employee.id],
  }].sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
  const candidateIndex = sequence.findIndex((entry) => entry.id === job.id);
  const points: DispatchLatLng[] = [employee.origin];
  for (const entry of sequence) {
    if (!entry.location) return { ok: false, reason: 'existing_job_location_missing' };
    points.push(entry.location);
  }
  const legs = await routeLegs(points, route);
  if (!legs) return { ok: false, reason: 'travel_unavailable' };
  const previous = candidateIndex > 0 ? sequence[candidateIndex - 1] : null;
  const next = candidateIndex >= 0 ? sequence[candidateIndex + 1] : null;
  const previousLoc = previous?.location ?? employee.origin;
  if (!previousLoc) return { ok: false, reason: 'dispatch_origin_missing' };
  const toCandidate = await routeLegs([previousLoc, job.location], route);
  if (!toCandidate) return { ok: false, reason: 'travel_unavailable' };
  const earliest = previous
    ? addMinutes(previous.end, settings.bufferMinutes + toCandidate.minutes)
    : addMinutes(shift.start, toCandidate.minutes);
  if (Date.parse(job.start) < Date.parse(earliest)) return { ok: false, reason: 'travel_infeasible_before_job' };
  if (Date.parse(job.end) > Date.parse(shift.end)) return { ok: false, reason: 'outside_shift' };
  if (next) {
    if (!next.location) return { ok: false, reason: 'existing_job_location_missing' };
    const after = await routeLegs([job.location, next.location], route);
    if (!after) return { ok: false, reason: 'travel_unavailable' };
    if (Date.parse(addMinutes(job.end, settings.bufferMinutes + after.minutes)) > Date.parse(next.start)) {
      return { ok: false, reason: 'travel_infeasible_after_job' };
    }
  }
  return { ok: true, minutes: toCandidate.minutes, miles: toCandidate.miles };
}

function permutations<T>(items: T[]): T[][] {
  if (items.length <= 1) return [items];
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += 1) {
    const rest = [...items.slice(0, index), ...items.slice(index + 1)];
    for (const tail of permutations(rest)) result.push([items[index] as T, ...tail]);
  }
  return result;
}

async function sharedFeasibility(
  crew: DispatchEmployee[],
  driver: DispatchEmployee,
  job: DispatchJob,
  shifts: Map<string, { start: string; end: string }>,
  route: RouteResolver,
): Promise<{ ok: true; minutes: number; miles: number } | { ok: false; reason: string }> {
  if (!driver.origin || !job.location) return { ok: false, reason: 'dispatch_origin_missing' };
  if (!driver.canDrive || driver.seats < crew.length) return { ok: false, reason: 'vehicle_capacity_unavailable' };
  const driverShift = shifts.get(driver.id);
  if (!driverShift) return { ok: false, reason: 'outside_shift' };
  if (driver.transportMode === 'independent') {
    const driverTimeline = await independentFeasibility(driver, job, driverShift, { weights: { travel: 1, miles: 0.2, labor: 0.1, workload: 0.5, continuity: 12, shared: 0 }, vehicleCostCentsPerMile: 0, travelPayPercent: 0, maxCandidates: 8, bufferMinutes: 15 }, route);
    if (!driverTimeline.ok) return { ok: false, reason: driverTimeline.reason };
  }
  const passengers = crew.filter((entry) => entry.id !== driver.id);
  if (passengers.some((entry) => !entry.origin)) return { ok: false, reason: 'passenger_origin_missing' };
  if (passengers.some((entry) => (job.existingTimeline[entry.id] ?? []).length > 0)) {
    return { ok: false, reason: 'shared_passenger_has_other_jobs' };
  }
  const passengerOrigins = passengers.map((entry) => entry.origin as DispatchLatLng);
  let best: { minutes: number; miles: number; departure: string } | null = null;
  for (const order of permutations(passengerOrigins)) {
    const legs = await routeLegs([driver.origin, ...order, job.location], route);
    if (!legs) continue;
    const departure = addMinutes(job.start, -legs.minutes);
    if (!best || legs.minutes < best.minutes) best = { ...legs, departure };
  }
  if (!best) return { ok: false, reason: 'shared_route_unavailable' };
  if (Date.parse(best.departure) < Date.parse(driverShift.start)) return { ok: false, reason: 'shared_departure_before_shift' };
  if (Date.parse(job.end) > Date.parse(driverShift.end)) return { ok: false, reason: 'outside_shift' };
  for (const passenger of passengers) {
    const shift = shifts.get(passenger.id);
    if (!shift) return { ok: false, reason: 'outside_shift' };
    if (Date.parse(best.departure) < Date.parse(shift.start)) return { ok: false, reason: 'shared_pickup_before_shift' };
    if (Date.parse(job.end) > Date.parse(shift.end)) return { ok: false, reason: 'outside_shift' };
  }
  return { ok: true, minutes: best.minutes, miles: best.miles };
}

function requiredEquipment(job: DispatchJob): string[] {
  return [...new Set(job.requiredEquipment.filter(Boolean))];
}

function crewHasEquipment(crew: DispatchEmployee[], job: DispatchJob): boolean {
  return requiredEquipment(job).every((item) =>
    crew.some((employee) => employee.equipment.includes(item) && employee.canTransportEquipment),
  );
}

function roleFor(employee: DispatchEmployee): string {
  if (employee.isSolo) return 'solo';
  if (employee.isLead) return 'lead';
  return 'helper';
}

function rolesValid(crew: DispatchEmployee[], job: DispatchJob): boolean {
  if (crew.length < job.crewSize) return false;
  if (job.crewSize === 1) return crew[0]?.isSolo === true || crew[0]?.isLead === true;
  if (job.requiredLead && !crew.some((employee) => employee.isSolo || employee.isLead)) return false;
  return crew.some((employee) => employee.isSolo || employee.isLead);
}

function combinationKey(crew: DispatchEmployee[]): string {
  return crew.map((employee) => employee.id).sort().join('|');
}

function crewCombinations(candidates: DispatchEmployee[], size: number): DispatchEmployee[][] {
  const result: DispatchEmployee[][] = [];
  const seen = new Set<string>();
  const walk = (start: number, current: DispatchEmployee[]): void => {
    if (current.length === size) {
      const anchors = current.filter((entry) => entry.isSolo || entry.isLead).length;
      if (anchors < 1) return;
      const key = combinationKey(current);
      if (seen.has(key)) return;
      seen.add(key);
      result.push([...current]);
      return;
    }
    for (let index = start; index < candidates.length; index += 1) {
      const entry = candidates[index];
      if (entry) walk(index + 1, [...current, entry]);
    }
  };
  walk(0, []);
  return result;
}

function scoreCrew(
  crew: DispatchEmployee[],
  job: DispatchJob,
  travelMinutes: number,
  travelMiles: number,
  transport: 'independent' | 'shared',
  settings: DispatchSettings,
): DispatchScore {
  const durationHours = minutes(job.start, job.end) / 60;
  const laborCents = Math.round(crew.reduce((total, employee) => total + employee.rateCents * durationHours, 0));
  const travelPay = settings.travelPayPercent > 0
    ? Math.round((travelMinutes / 60) * ((crew.reduce((total, employee) => total + employee.rateCents, 0) / crew.length) * (settings.travelPayPercent / 100)))
    : 0;
  const vehicleCents = Math.round(travelMiles * settings.vehicleCostCentsPerMile);
  const workMinutes = crew.reduce((total, employee) => total + employee.weeklyMinutes, 0) + minutes(job.start, job.end) * crew.length;
  const continuity = job.customerId && crew.some((employee) => employee.customerHistory.includes(job.customerId)) ? 1 : 0;
  const weights = settings.weights;
  const total =
    travelMinutes * weights.travel +
    travelMiles * weights.miles +
    ((laborCents + travelPay + vehicleCents) / 100) * weights.labor +
    (workMinutes / 60) * weights.workload -
    continuity * weights.continuity +
    (transport === 'shared' ? weights.shared : 0);
  return {
    travelMinutes,
    travelMiles,
    laborCents: laborCents + travelPay + vehicleCents,
    workMinutes,
    continuity,
    shared: transport === 'shared',
    total: Math.round(total * 100) / 100,
  };
}

async function evaluateCrew(
  crew: DispatchEmployee[],
  job: DispatchJob,
  shifts: Map<string, { start: string; end: string }>,
  settings: DispatchSettings,
  route: RouteResolver,
): Promise<DispatchCandidate | { reason: string; employeeIds: string[] }> {
  const ids = crew.map((employee) => employee.id);
  if (!rolesValid(crew, job)) return { reason: 'crew_roles_invalid', employeeIds: ids };
  if (!crewHasEquipment(crew, job)) return { reason: 'equipment_unavailable', employeeIds: ids };
  if (crew.some((employee) => !employee.services.includes(job.serviceCode))) {
    return { reason: 'service_not_qualified', employeeIds: ids };
  }
  if (crew.some((employee) => employee.status !== 'active' || !employee.bookable)) {
    return { reason: 'employee_inactive', employeeIds: ids };
  }
  if (crew.some((employee) => employee.branchId !== job.branchId)) {
    return { reason: 'cross_branch_not_authorized', employeeIds: ids };
  }
  if (crew.some((employee) => employeeTimeOff(employee, job.start, job.end))) {
    return { reason: 'time_off', employeeIds: ids };
  }
  const candidateMinutes = minutes(job.start, job.end);
  for (const employee of crew) {
    if (employee.weeklyMinutes + candidateMinutes > employee.maxWeeklyMinutes && !employee.overtimeApproved) {
      return { reason: 'weekly_hours_exceeded', employeeIds: ids };
    }
  }
  if (crew.some((employee) => !shifts.has(employee.id))) return { reason: 'outside_shift', employeeIds: ids };
  if (crew.length === 1) {
    const employee = crew[0];
    if (!employee) return { reason: 'outside_shift', employeeIds: ids };
    const shift = shifts.get(employee.id);
    if (!shift) return { reason: 'outside_shift', employeeIds: ids };
    const independent = await independentFeasibility(employee, job, shift, settings, route);
    if (!independent.ok) return { reason: independent.reason, employeeIds: ids };
    return {
      employeeIds: ids,
      employeeNames: [employee.name],
      roles: [roleFor(employee)],
      transport: 'independent',
      travelMinutes: independent.minutes,
      travelMiles: independent.miles,
      laborCents: scoreCrew(crew, job, independent.minutes, independent.miles, 'independent', settings).laborCents,
      score: scoreCrew(crew, job, independent.minutes, independent.miles, 'independent', settings),
      feasible: true,
      explanation: [
        `${employee.name} is qualified and available for ${job.serviceCode}.`,
        `Estimated one-way dispatch travel is ${independent.minutes} minutes and ${independent.miles.toFixed(1)} miles.`,
      ],
    };
  }
  const independent = await Promise.all(
    crew.map(async (employee) => {
      const shift = shifts.get(employee.id);
      if (!shift) return { ok: false as const, reason: 'outside_shift', minutes: 0, miles: 0 };
      const result = await independentFeasibility(employee, job, shift, settings, route);
      return result.ok ? { ...result } : { ok: false as const, reason: result.reason, minutes: 0, miles: 0 };
    }),
  );
  let best: { transport: 'independent' | 'shared'; minutes: number; miles: number } | null = null;
  if (independent.every((entry) => entry.ok)) {
    best = {
      transport: 'independent',
      minutes: independent.reduce((total, entry) => total + entry.minutes, 0),
      miles: independent.reduce((total, entry) => total + entry.miles, 0),
    };
  }
  if (crew.some((employee) => employee.transportMode === 'unknown')) {
    return { reason: 'transport_unknown', employeeIds: ids };
  }
  const drivers = crew.filter((employee) => employee.canDrive && employee.transportMode !== 'none');
  for (const driver of drivers) {
    const shared = await sharedFeasibility(crew, driver, job, shifts, route);
    if (shared.ok && (!best || shared.minutes < best.minutes)) {
      best = { transport: 'shared', minutes: shared.minutes, miles: shared.miles };
    }
  }
  if (!best) {
    const reason = independent.find((entry) => !entry.ok)?.reason ?? 'transport_unavailable';
    return { reason, employeeIds: ids };
  }
  const score = scoreCrew(crew, job, best.minutes, best.miles, best.transport, settings);
  return {
    employeeIds: ids,
    employeeNames: crew.map((employee) => employee.name),
    roles: crew.map(roleFor),
    transport: best.transport,
    travelMinutes: best.minutes,
    travelMiles: best.miles,
    laborCents: score.laborCents,
    score,
    feasible: true,
    explanation: [
      `Crew covers ${crew.map(roleFor).join(' + ')} with ${job.serviceCode} qualification.`,
      `${best.transport === 'shared' ? 'Shared crew transport' : 'Independent transport'} totals ${best.minutes} minutes and ${best.miles.toFixed(1)} miles.`,
      ...(score.continuity ? ['Existing customer continuity is preserved.'] : []),
    ],
  };
}

export async function evaluateDispatchJob(
  job: DispatchJob,
  employees: DispatchEmployee[],
  settings: DispatchSettings,
  route: RouteResolver,
): Promise<DispatchEvaluation> {
  const blocked: DispatchBlocked[] = [];
  if (!job.location) {
    return { jobId: job.id, feasible: [], blocked: [{ employeeIds: [], reasons: ['job_location_missing'] }], evaluated: 0 };
  }
  const eligible = employees.filter((employee) => employee.status === 'active' && employee.bookable);
  const date = localDate(job.start, job.timeZone);
  const shifts = new Map<string, { start: string; end: string }>();
  for (const employee of eligible) {
    const shift = shiftFor(employee, date, job);
    if (shift) shifts.set(employee.id, shift);
    else blocked.push({ employeeIds: [employee.id], reasons: ['outside_shift'] });
  }
  const available = eligible.filter((employee) => shifts.has(employee.id));
  const size = Math.max(1, Math.min(4, Math.round(job.crewSize)));
  const combos = crewCombinations(available, size);
  if (combos.length === 0) {
    blocked.push({ employeeIds: available.map((employee) => employee.id), reasons: ['crew_roles_invalid'] });
  }
  const feasible: DispatchCandidate[] = [];
  for (const crew of combos) {
    const result = await evaluateCrew(crew, job, shifts, settings, route);
    if ('feasible' in result) feasible.push(result);
    else blocked.push({ employeeIds: result.employeeIds, reasons: [result.reason] });
  }
  feasible.sort((left, right) => left.score.total - right.score.total || left.employeeIds.join('|').localeCompare(right.employeeIds.join('|')));
  return {
    jobId: job.id,
    feasible: feasible.slice(0, Math.max(1, settings.maxCandidates)),
    blocked,
    evaluated: combos.length,
  };
}

export function requiredEquipmentForService(serviceCode: string): string[] {
  if (serviceCode === 'commercial-cleaning') return ['commercial-kit'];
  if (serviceCode === 'church-cleaning') return ['standard-kit'];
  if (serviceCode === 'deep' || serviceCode === 'move_in_out') return ['deep-kit'];
  return ['standard-kit'];
}

export function requiresLeadForService(serviceCode: string): boolean {
  return serviceCode === 'commercial-cleaning' || serviceCode === 'church-cleaning';
}
