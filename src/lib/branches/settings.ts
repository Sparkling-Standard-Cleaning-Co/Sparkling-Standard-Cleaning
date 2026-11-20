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
  services: Record<'residential' | 'str' | 'commercial' | 'church', ServiceMode>;
  gbpStatus: BranchPublicConfig['gbpStatus'];
  gbpUrl: string;
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
    launchNote: row.launch_note || base.launchNote,
  };
}

export async function listBranchSettings(db: D1Database): Promise<BranchSettings[]> {
  const rows = await db
    .prepare(
      `SELECT id, name, status, lifecycle_status, public_slug, public_name, region_label,
              timezone, city, state, public_phone, public_email, gbp_status, gbp_url,
              launch_note, service_area_json, hours_json, services_json
       FROM branches ORDER BY CASE WHEN id = 'branch_pensacola' THEN 0 ELSE 1 END, id`,
    )
    .all<BranchRow>();
  return (rows.results ?? []).flatMap((row) => {
    const settings = rowToBranchSettings(row);
    return settings ? [settings] : [];
  });
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
    services,
    gbpStatus,
    gbpUrl,
    launchNote: text(input.launchNote, 1000),
  };

  if (next.lifecycle === 'live') {
    if (!next.publicPhone) throw new BranchSettingsError('launch_phone_required');
    if (!next.publicEmail) throw new BranchSettingsError('launch_email_required');
    if (next.serviceAreaZips.length === 0) throw new BranchSettingsError('launch_service_area_required');
    if (!Object.values(next.services).some((mode) => mode === 'bookable' || mode === 'estimate_enabled')) {
      throw new BranchSettingsError('launch_service_required');
    }
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
    services: next.services,
    gbpStatus: next.gbpStatus,
    gbpUrl: next.gbpUrl,
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
