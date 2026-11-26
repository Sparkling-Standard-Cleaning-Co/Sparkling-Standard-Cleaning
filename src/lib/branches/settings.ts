// Owner-managed branch setup and launch lifecycle.
//
// Branch identities are code-owned. This module edits only the approved setup
// fields for an existing branch and appends an immutable configuration version
// on every save. A branch cannot be made live without a public identity,
// contact channel, service area and at least one enabled service.

import type { D1Database } from '../admin/d1.ts';
import {
  branchConfig,
  type BranchId,
  type BranchLifecycle,
  type ServiceMode,
  type BranchPublicConfig,
} from '../../config/branches.ts';
import { getBranchRow, type BranchRow } from './registry.ts';

const LIFECYCLES: ReadonlyArray<BranchLifecycle> = [
  'draft',
  'setup',
  'internally_testable',
  'approved_to_launch',
  'live',
  'paused',
  'retired',
];
const SERVICE_MODES: ReadonlyArray<ServiceMode> = [
  'disabled',
  'request_only',
  'estimate_enabled',
  'bookable',
];
const GBP_STATES = ['not_created', 'eligibility_review', 'prepared', 'submitted', 'verified', 'paused'] as const;

export class BranchSettingsError extends Error {
  code: string;
  status: number;
  constructor(code: string, status = 400, message?: string) {
    super(message ?? code);
    this.code = code;
    this.status = status;
  }
}

export interface BranchSettings {
  id: BranchId;
  name: string;
  lifecycle: BranchLifecycle;
  publicName: string;
  publicSlug: string;
  regionLabel: string;
  timezone: string;
  publicPhone: string;
  publicEmail: string;
  hoursLabel: string;
  serviceAreaZips: string[];
  serviceStates: Array<'FL' | 'AL'>;
  originAddress: string;
  originCity: string;
  originState: string;
  originPostalCode: string;
  originLat: number | null;
  originLng: number | null;
  originPlaceId: string;
  travelLimitMiles: number | null;
  services: Record<'residential' | 'str' | 'commercial' | 'church', ServiceMode>;
  gbpStatus: BranchPublicConfig['gbpStatus'];
  gbpUrl: string;
  reviewUrl: string;
  reviewRequestsEnabled: boolean;
  reviewRequestDelayHours: number;
  reviewRequestMaxPerCustomer: number;
  calendarId: string;
  calendarName: string;
  launchNote: string;
}

function isBranchId(value: string): value is BranchId {
  return value === 'branch_pensacola' || value === 'branch_tampa';
}

function safeJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function text(value: unknown, max = 500): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function fingerprint(value: unknown): string {
  const input = JSON.stringify(value);
  let hash = 0xcbf29ce484222325n;
  for (const character of input) {
    hash ^= BigInt(character.codePointAt(0) ?? 0);
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(16).padStart(16, '0');
}

export function rowToBranchSettings(row: BranchRow): BranchSettings | null {
  if (!isBranchId(row.id)) return null;
  const base = branchConfig(row.id);
  if (!base) return null;
  const serviceArea = safeJson<{ zips?: unknown; states?: unknown }>(row.service_area_json, {});
  const hours = safeJson<{ label?: unknown }>(row.hours_json, {});
  const services = safeJson<Record<string, unknown>>(row.services_json, {});
  const zips = Array.isArray(serviceArea.zips)
    ? serviceArea.zips.filter((zip): zip is string => typeof zip === 'string' && /^\d{5}$/.test(zip))
    : [...base.serviceAreaZips];
  const states = Array.isArray(serviceArea.states)
    ? serviceArea.states.filter((state): state is 'FL' | 'AL' => state === 'FL' || state === 'AL')
    : [...base.serviceStates];
  const modes = base.services;
  return {
    id: row.id,
    name: row.name || base.name,
    lifecycle: row.lifecycle_status || base.lifecycle,
    publicName: row.public_name || base.publicName,
    publicSlug: row.public_slug || base.publicSlug,
    regionLabel: row.region_label || base.regionLabel,
    timezone: row.timezone || base.timezone,
    publicPhone: row.public_phone || base.publicPhone,
    publicEmail: row.public_email || base.publicEmail,
    hoursLabel: typeof hours.label === 'string' ? hours.label : base.hoursLabel,
    serviceAreaZips: [...new Set(zips)],
    serviceStates: states.length ? [...new Set(states)] : (['FL'] as Array<'FL' | 'AL'>),
    originAddress: row.address_line1 || '',
    originCity: row.city || '',
    originState: row.state || 'FL',
    originPostalCode: row.postal_code || '',
    originLat: row.origin_lat === null || row.origin_lat === undefined ? null : Number(row.origin_lat),
    originLng: row.origin_lng === null || row.origin_lng === undefined ? null : Number(row.origin_lng),
    originPlaceId: row.origin_place_id || '',
    travelLimitMiles: row.travel_limit_miles === null || row.travel_limit_miles === undefined ? base.travelLimitMiles : Number(row.travel_limit_miles),
    services: {
      residential: SERVICE_MODES.includes(services.residential as ServiceMode)
        ? (services.residential as ServiceMode)
        : modes.residential,
      str: SERVICE_MODES.includes(services.str as ServiceMode)
        ? (services.str as ServiceMode)
        : modes.str,
      commercial: SERVICE_MODES.includes(services.commercial as ServiceMode)
        ? (services.commercial as ServiceMode)
        : modes.commercial,
      church: SERVICE_MODES.includes(services.church as ServiceMode)
        ? (services.church as ServiceMode)
        : modes.church,
    },
    gbpStatus: GBP_STATES.includes(row.gbp_status) ? row.gbp_status : base.gbpStatus,
    gbpUrl: row.gbp_url || base.gbpUrl,
    reviewUrl: row.review_url || base.reviewUrl,
    reviewRequestsEnabled: Number(row.review_requests_enabled ?? 0) === 1,
    reviewRequestDelayHours: Number(row.review_request_delay_hours ?? 24),
    reviewRequestMaxPerCustomer: Number(row.review_request_max_per_customer ?? 1),
    calendarId: row.calendar_id || '',
    calendarName: row.calendar_name || '',
    launchNote: row.launch_note || base.launchNote,
  };
}

export async function listBranchSettings(db: D1Database): Promise<BranchSettings[]> {
  let rows: BranchRow[] = [];
  try {
    const result = await db
      .prepare(
        `SELECT id, name, status, lifecycle_status, public_slug, public_name, region_label,
                timezone, city, state, public_phone, public_email, gbp_status, gbp_url,
                review_url, review_requests_enabled, review_request_delay_hours,
                review_request_max_per_customer, calendar_id, calendar_name,
                launch_note, service_area_json, hours_json, services_json,
                address_line1, postal_code, origin_lat, origin_lng,
                origin_place_id, travel_limit_miles
         FROM branches ORDER BY CASE WHEN id = 'branch_pensacola' THEN 0 ELSE 1 END, id`,
      )
      .all<BranchRow>();
    rows = result.results ?? [];
  } catch {
    const result = await db
      .prepare(
        `SELECT id, name, status, lifecycle_status, public_slug, public_name, region_label,
                timezone, city, state, public_phone, public_email, gbp_status, gbp_url,
                launch_note, service_area_json, hours_json, services_json,
                address_line1, postal_code, origin_lat, origin_lng,
                origin_place_id, travel_limit_miles
         FROM branches ORDER BY CASE WHEN id = 'branch_pensacola' THEN 0 ELSE 1 END, id`,
      )
      .all<BranchRow>();
    rows = result.results ?? [];
  }
  return rows.flatMap((row) => {
    const settings = rowToBranchSettings(row);
    return settings ? [settings] : [];
  });
}

export interface BranchReadiness {
  ready: boolean;
  blockers: string[];
  warnings: string[];
}

export function branchReadiness(settings: BranchSettings): BranchReadiness {
  const base = branchConfig(settings.id);
  const blockers: string[] = [];
  const warnings: string[] = [];
  if (!base) return { ready: false, blockers: ['branch_identity_missing'], warnings };
  if (!settings.publicPhone) blockers.push('public_phone_missing');
  if (!settings.publicEmail) blockers.push('public_email_missing');
  if (settings.serviceAreaZips.length === 0) blockers.push('service_area_missing');
  if (!Object.values(settings.services).some((mode) => mode === 'bookable' || mode === 'estimate_enabled')) {
    blockers.push('public_service_missing');
  }
  if (!base.capabilities.pricingConfigured) blockers.push('branch_pricing_not_configured');
  if (!base.capabilities.publicEstimates) blockers.push('public_estimator_not_implemented');
  if (!base.capabilities.scheduling) blockers.push('scheduling_not_implemented');
  if (!base.capabilities.payments) blockers.push('branch_payments_not_enabled');
  if (!base.capabilities.fulfillmentVerified) blockers.push('fulfillment_not_verified');
  if (settings.gbpStatus !== 'verified') warnings.push('google_profile_not_verified');
  if (!settings.originAddress || settings.originLat === null || settings.originLng === null) {
    warnings.push('branch_origin_not_configured');
  }
  if (settings.travelLimitMiles === null) warnings.push('travel_limit_not_configured');
  return { ready: blockers.length === 0, blockers, warnings };
}

function normalizeInput(input: Record<string, unknown>, existing: BranchSettings): BranchSettings {
  const publicSlug = text(input.publicSlug, 80).toLowerCase();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(publicSlug)) {
    throw new BranchSettingsError('public_slug_invalid');
  }
  const publicName = text(input.publicName, 120);
  if (!publicName) throw new BranchSettingsError('public_name_required');
  const publicPhone = text(input.publicPhone, 40);
  const publicEmail = text(input.publicEmail, 200).toLowerCase();
  if (publicEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(publicEmail)) {
    throw new BranchSettingsError('public_email_invalid');
  }
  const lifecycleRaw = text(input.lifecycle, 40) as BranchLifecycle;
  if (!LIFECYCLES.includes(lifecycleRaw)) throw new BranchSettingsError('lifecycle_invalid');
  const servicesInput = (input.services ?? {}) as Record<string, unknown>;
  const services = { ...existing.services };
  for (const key of ['residential', 'str', 'commercial', 'church'] as const) {
    const mode = text(servicesInput[key], 40) as ServiceMode;
    if (!SERVICE_MODES.includes(mode)) throw new BranchSettingsError('service_mode_invalid');
    services[key] = mode;
  }
  const zips = Array.isArray(input.serviceAreaZips)
    ? input.serviceAreaZips
        .filter((zip): zip is string => typeof zip === 'string')
        .map((zip) => zip.trim())
        .filter((zip) => /^\d{5}$/.test(zip))
    : existing.serviceAreaZips;
  const states = Array.isArray(input.serviceStates)
    ? input.serviceStates.filter((state): state is 'FL' | 'AL' => state === 'FL' || state === 'AL')
    : existing.serviceStates;
  const gbpStatus = text(input.gbpStatus, 40) as BranchSettings['gbpStatus'];
  if (!GBP_STATES.includes(gbpStatus)) throw new BranchSettingsError('gbp_status_invalid');
  const gbpUrl = text(input.gbpUrl, 500);
  if (gbpUrl && !/^https:\/\//i.test(gbpUrl)) throw new BranchSettingsError('gbp_url_invalid');
  const reviewUrl = text(input.reviewUrl, 500);
  if (reviewUrl && !/^https:\/\//i.test(reviewUrl)) throw new BranchSettingsError('review_url_invalid');
  const reviewRequestsEnabled =
    input.reviewRequestsEnabled === true || input.reviewRequestsEnabled === 'true' || input.reviewRequestsEnabled === 'on';
  const reviewRequestDelayHours = Math.min(
    720,
    Math.max(1, Math.round(Number(input.reviewRequestDelayHours ?? existing.reviewRequestDelayHours) || existing.reviewRequestDelayHours)),
  );
  const reviewRequestMaxPerCustomer = Math.min(
    12,
    Math.max(1, Math.round(Number(input.reviewRequestMaxPerCustomer ?? existing.reviewRequestMaxPerCustomer) || existing.reviewRequestMaxPerCustomer)),
  );
  const originLatRaw = input.originLat === null || input.originLat === undefined || input.originLat === '' ? null : Number(input.originLat);
  const originLngRaw = input.originLng === null || input.originLng === undefined || input.originLng === '' ? null : Number(input.originLng);
  if (originLatRaw !== null && (!Number.isFinite(originLatRaw) || originLatRaw < -90 || originLatRaw > 90)) {
    throw new BranchSettingsError('origin_latitude_invalid');
  }
  if (originLngRaw !== null && (!Number.isFinite(originLngRaw) || originLngRaw < -180 || originLngRaw > 180)) {
    throw new BranchSettingsError('origin_longitude_invalid');
  }
  const travelLimitRaw = input.travelLimitMiles === null || input.travelLimitMiles === undefined || input.travelLimitMiles === '' ? null : Number(input.travelLimitMiles);
  if (travelLimitRaw !== null && (!Number.isFinite(travelLimitRaw) || travelLimitRaw <= 0 || travelLimitRaw > 500)) {
    throw new BranchSettingsError('travel_limit_invalid');
  }

  const next: BranchSettings = {
    ...existing,
    lifecycle: lifecycleRaw,
    publicName,
    publicSlug,
    regionLabel: text(input.regionLabel, 200) || existing.regionLabel,
    timezone: text(input.timezone, 80) || existing.timezone,
    publicPhone,
    publicEmail,
    hoursLabel: text(input.hoursLabel, 200) || existing.hoursLabel,
    serviceAreaZips: [...new Set(zips)].sort(),
    serviceStates: states.length ? [...new Set(states)] : (['FL'] as Array<'FL' | 'AL'>),
    originAddress: text(input.originAddress, 300) || existing.originAddress,
    originCity: text(input.originCity, 120) || existing.originCity,
    originState: text(input.originState, 2).toUpperCase() || existing.originState,
    originPostalCode: text(input.originPostalCode, 10) || existing.originPostalCode,
    originLat: originLatRaw,
    originLng: originLngRaw,
    originPlaceId: text(input.originPlaceId, 200),
    travelLimitMiles: travelLimitRaw,
    services,
    gbpStatus,
    gbpUrl,
    reviewUrl,
    reviewRequestsEnabled,
    reviewRequestDelayHours,
    reviewRequestMaxPerCustomer,
    calendarId: text(input.calendarId, 300),
    calendarName: text(input.calendarName, 200),
    launchNote: text(input.launchNote, 1000),
  };

  if (next.lifecycle === 'live') {
    if (!next.publicPhone) throw new BranchSettingsError('launch_phone_required');
    if (!next.publicEmail) throw new BranchSettingsError('launch_email_required');
    if (next.serviceAreaZips.length === 0) throw new BranchSettingsError('launch_service_area_required');
    if (!Object.values(next.services).some((mode) => mode === 'bookable' || mode === 'estimate_enabled')) {
      throw new BranchSettingsError('launch_service_required');
    }
    if (!next.originAddress || next.originLat === null || next.originLng === null) {
      throw new BranchSettingsError('launch_origin_required');
    }
    if (next.travelLimitMiles === null) throw new BranchSettingsError('launch_travel_limit_required');
  }
  return next;
}

export async function saveBranchSettings(
  db: D1Database,
  actor: { id: string; email: string },
  branchId: string,
  input: Record<string, unknown>,
): Promise<BranchSettings> {
  if (!isBranchId(branchId)) throw new BranchSettingsError('branch_not_found', 404);
  const row = await getBranchRow(db, branchId);
  const existing = row ? rowToBranchSettings(row) : null;
  if (!existing) throw new BranchSettingsError('branch_not_found', 404);
  const next = normalizeInput(input, existing);
  const duplicate = await db
    .prepare('SELECT id FROM branches WHERE public_slug = ? AND id <> ? LIMIT 1')
    .bind(next.publicSlug, next.id)
    .first<{ id: string }>();
  if (duplicate) throw new BranchSettingsError('public_slug_in_use', 409);
  if (next.lifecycle === 'live') {
    const readiness = await branchOperationalReadiness(db, next);
    if (readiness.blockers.length > 0) {
      throw new BranchSettingsError(
        'launch_readiness_incomplete',
        409,
        `Missing: ${readiness.blockers.join(', ')}`,
      );
    }
  }

  const config = {
    id: next.id,
    lifecycle: next.lifecycle,
    publicName: next.publicName,
    publicSlug: next.publicSlug,
    regionLabel: next.regionLabel,
    timezone: next.timezone,
    publicPhone: next.publicPhone,
    publicEmail: next.publicEmail,
    hoursLabel: next.hoursLabel,
    serviceArea: { zips: next.serviceAreaZips, states: next.serviceStates },
    origin: {
      address: next.originAddress,
      city: next.originCity,
      state: next.originState,
      postalCode: next.originPostalCode,
      latitude: next.originLat,
      longitude: next.originLng,
      placeId: next.originPlaceId,
      travelLimitMiles: next.travelLimitMiles,
    },
    services: next.services,
    gbpStatus: next.gbpStatus,
    gbpUrl: next.gbpUrl,
    reviewUrl: next.reviewUrl,
    reviewRequestsEnabled: next.reviewRequestsEnabled,
    reviewRequestDelayHours: next.reviewRequestDelayHours,
    reviewRequestMaxPerCustomer: next.reviewRequestMaxPerCustomer,
    calendarId: next.calendarId,
    calendarName: next.calendarName,
    launchNote: next.launchNote,
  };
  const versionRow = await db
    .prepare('SELECT COALESCE(MAX(version), 0) AS version FROM branch_config_versions WHERE branch_id = ?')
    .bind(next.id)
    .first<{ version: number }>();
  const version = Number(versionRow?.version ?? 0) + 1;
  const timestamp = new Date().toISOString();
  const id = `branchcfg_${crypto.randomUUID()}`;
  const statements = [
    db
      .prepare(
        `UPDATE branches SET
           lifecycle_status = ?, public_slug = ?, public_name = ?, region_label = ?,
           timezone = ?, public_phone = ?, public_email = ?, gbp_status = ?, gbp_url = ?,
           review_url = ?, review_requests_enabled = ?, review_request_delay_hours = ?,
           review_request_max_per_customer = ?, calendar_id = ?, calendar_name = ?,
           address_line1 = ?, city = ?, state = ?, postal_code = ?, origin_lat = ?, origin_lng = ?,
           origin_place_id = ?, travel_limit_miles = ?,
           launch_note = ?, service_area_json = ?, hours_json = ?, services_json = ?,
           status = ?, updated_at = ?
         WHERE id = ?`,
      )
      .bind(
        next.lifecycle,
        next.publicSlug,
        next.publicName,
        next.regionLabel,
        next.timezone,
        next.publicPhone,
        next.publicEmail,
        next.gbpStatus,
        next.gbpUrl,
        next.reviewUrl,
        next.reviewRequestsEnabled ? 1 : 0,
        next.reviewRequestDelayHours,
        next.reviewRequestMaxPerCustomer,
        next.calendarId,
        next.calendarName,
        next.originAddress,
        next.originCity,
        next.originState,
        next.originPostalCode,
        next.originLat,
        next.originLng,
        next.originPlaceId,
        next.travelLimitMiles,
        next.launchNote,
        JSON.stringify({ zips: next.serviceAreaZips, states: next.serviceStates }),
        JSON.stringify({ label: next.hoursLabel }),
        JSON.stringify(next.services),
        next.lifecycle === 'live' ? 'active' : row?.status ?? 'inactive',
        timestamp,
        next.id,
      ),
    db
      .prepare(
        `UPDATE branch_config_versions SET status = 'archived'
         WHERE branch_id = ? AND status = 'published'`,
      )
      .bind(next.id),
    db
      .prepare(
        `INSERT INTO branch_config_versions
         (id, branch_id, version, status, config_json, fingerprint, note, created_by,
          created_by_email, created_at, updated_at, published_by, published_by_email, published_at)
         VALUES (?, ?, ?, 'published', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        id,
        next.id,
        version,
        JSON.stringify(config),
        fingerprint(config),
        text(input.note, 500),
        actor.id,
        actor.email,
        timestamp,
        timestamp,
        actor.id,
        actor.email,
        timestamp,
      ),
  ];
  if (db.batch) {
    await db.batch(statements);
  } else {
    for (const statement of statements) await statement.run();
  }
  return next;
}

export interface BranchChecklistItem {
  key: string;
  label: string;
  status: 'complete' | 'warning' | 'blocked';
  detail: string;
}

export async function branchOperationalReadiness(
  db: D1Database,
  settings: BranchSettings,
): Promise<BranchReadiness & { checklist: BranchChecklistItem[] }> {
  const base = branchReadiness(settings);
  const blockers = [...base.blockers];
  const warnings = [...base.warnings];
  const checklist: BranchChecklistItem[] = [];
  const add = (key: string, label: string, ok: boolean, detail: string, blocking = true): void => {
    checklist.push({ key, label, status: ok ? 'complete' : blocking ? 'blocked' : 'warning', detail });
    if (!ok) {
      if (blocking) blockers.push(key);
      else warnings.push(key);
    }
  };
  const staff = await db
    .prepare("SELECT COUNT(*) AS count FROM team_members WHERE branch_id = ? AND status = 'active' AND is_bookable = 1")
    .bind(settings.id)
    .first<{ count: number }>();
  add(
    'branch_staffing_missing',
    'At least one active bookable employee',
    Number(staff?.count ?? 0) > 0,
    Number(staff?.count ?? 0) + ' active bookable employee(s) assigned to this branch.',
  );
  const managers = await db
    .prepare("SELECT COUNT(*) AS count FROM admin_users WHERE status = 'active' AND (role_id = 'owner' OR branch_id = ?)")
    .bind(settings.id)
    .first<{ count: number }>();
  add(
    'branch_manager_missing',
    'Operations manager or owner access',
    Number(managers?.count ?? 0) > 0,
    Number(managers?.count ?? 0) + ' active owner/manager account(s) can operate this branch.',
    false,
  );
  add(
    'branch_calendar_missing',
    'Dedicated booking calendar',
    Boolean(settings.calendarId.trim()),
    settings.calendarId
      ? 'Calendar ' + (settings.calendarName || settings.calendarId)
      : 'No branch calendar id is configured.',
  );
  const expectedZone = settings.id === 'branch_tampa' ? 'America/New_York' : 'America/Chicago';
  add(
    'branch_timezone_mismatch',
    'Correct branch timezone',
    settings.timezone === expectedZone,
    'Configured ' + settings.timezone + '; expected ' + expectedZone + '.',
  );
  const enabledServices = Object.entries(settings.services).filter(([, mode]) => mode !== 'disabled');
  add(
    'branch_services_missing',
    'At least one enabled service line',
    enabledServices.length > 0,
    enabledServices.map(([key, mode]) => key + ': ' + mode).join(', ') || 'All service lines are disabled.',
  );
  add(
    'branch_commercial_disabled',
    'Commercial capability (for commercial accounts)',
    settings.services.commercial !== 'disabled',
    'Commercial mode: ' + settings.services.commercial + '.',
    false,
  );
  add(
    'branch_church_disabled',
    'Church capability',
    settings.services.church !== 'disabled',
    'Church mode: ' + settings.services.church + '.',
    false,
  );
  add(
    'branch_review_url_missing',
    'Approved Google review destination',
    !settings.reviewRequestsEnabled || Boolean(settings.reviewUrl.trim()),
    settings.reviewUrl || 'Review requests are disabled or no review URL is configured.',
    false,
  );
  add(
    'branch_origin_missing',
    'Operating origin for travel',
    Boolean(settings.originAddress && settings.originLat !== null && settings.originLng !== null),
    settings.originAddress || 'No operating origin configured.',
    false,
  );
  add(
    'branch_travel_limit_missing',
    'Travel limit',
    settings.travelLimitMiles !== null,
    settings.travelLimitMiles !== null ? settings.travelLimitMiles + ' mile one-way limit' : 'No travel limit configured.',
    false,
  );
  add(
    'branch_gbp_unverified',
    'Google Business Profile verified',
    settings.gbpStatus === 'verified',
    'GBP status: ' + settings.gbpStatus + '.',
    false,
  );
  return {
    ready: blockers.length === 0,
    blockers: [...new Set(blockers)],
    warnings: [...new Set(warnings)],
    checklist,
  };
}
