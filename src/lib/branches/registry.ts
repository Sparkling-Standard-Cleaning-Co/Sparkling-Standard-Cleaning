// Server-authoritative branch registry.
//
// The static configuration defines the lawful branch identities and public
// safety defaults. D1 may advance lifecycle/setup details, but it can never
// turn a branch into a bookable, indexable or payable branch contrary to the
// code-level launch gates.

import type { D1Database } from '../admin/d1.ts';
import {
  BRANCH_PENSACOLA,
  BRANCH_TAMPA,
  branchConfig,
  branchConfigs,
  type BranchId,
  type BranchLifecycle,
  type BranchPublicConfig,
} from '../../config/branches.ts';
import { normalizeZip, zipReferenceFor } from '../../config/geography.ts';

export interface BranchRow {
  id: string;
  name: string;
  status: 'active' | 'inactive';
  lifecycle_status: BranchLifecycle;
  public_slug: string | null;
  public_name: string;
  region_label: string;
  timezone: string;
  address_line1: string;
  city: string;
  state: string;
  postal_code: string;
  origin_lat: number | null;
  origin_lng: number | null;
  origin_place_id: string;
  travel_limit_miles: number | null;
  public_phone: string;
  public_email: string;
  gbp_status: BranchPublicConfig['gbpStatus'];
  gbp_url: string;
  launch_note: string;
  service_area_json: string;
  hours_json: string;
  services_json: string;
}

const BRANCH_COLUMNS = `id, name, status, lifecycle_status, public_slug, public_name,
  region_label, timezone, address_line1, city, state, postal_code, origin_lat, origin_lng,
  origin_place_id, travel_limit_miles, public_phone, public_email, gbp_status,
  gbp_url, launch_note, service_area_json, hours_json, services_json`;

function isBranchId(value: string): value is BranchId {
  return value === BRANCH_PENSACOLA || value === BRANCH_TAMPA;
}

function safeJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function branchRowToConfig(row: BranchRow): BranchPublicConfig | null {
  if (!isBranchId(row.id)) return null;
  const base = branchConfigs[row.id];
  const serviceArea = safeJson<{ zips?: unknown; states?: unknown }>(row.service_area_json, {});
  const zips = Array.isArray(serviceArea.zips)
    ? serviceArea.zips.filter((zip): zip is string => typeof zip === 'string' && /^\d{5}$/.test(zip))
    : base.serviceAreaZips;
  const services = safeJson<BranchPublicConfig['services']>(row.services_json, base.services);
  const lifecycle = row.lifecycle_status ?? base.lifecycle;
  const live = lifecycle === 'live' && row.status === 'active';
  return {
    ...base,
    name: row.name || base.name,
    publicName: row.public_name || base.publicName,
    publicSlug: row.public_slug || base.publicSlug,
    regionLabel: row.region_label || base.regionLabel,
    timezone: row.timezone || base.timezone,
    lifecycle,
    publicPage: base.publicPage,
    indexable: base.indexable && live,
    bookable: base.bookable && live,
    paymentsEnabled: base.paymentsEnabled && live,
    publishedPricingAllowed: base.publishedPricingAllowed,
    services,
    capabilities: base.capabilities,
    serviceAreaZips: zips,
    publicPhone: row.public_phone || base.publicPhone,
    publicEmail: row.public_email || base.publicEmail,
    gbpStatus: row.gbp_status || base.gbpStatus,
    gbpUrl: row.gbp_url || base.gbpUrl,
    launchNote: row.launch_note || base.launchNote,
  };
}

export async function listBranchRows(db: D1Database | null | undefined): Promise<BranchRow[]> {
  if (!db) return [];
  try {
    const result = await db.prepare(`SELECT ${BRANCH_COLUMNS} FROM branches ORDER BY id`).all<BranchRow>();
    return result.results ?? [];
  } catch {
    return [];
  }
}

export async function getBranchRow(db: D1Database | null | undefined, id: string): Promise<BranchRow | null> {
  if (!db || !isBranchId(id)) return null;
  try {
    return await db
      .prepare(`SELECT ${BRANCH_COLUMNS} FROM branches WHERE id = ? LIMIT 1`)
      .bind(id)
      .first<BranchRow>();
  } catch {
    return null;
  }
}

export async function effectiveBranches(db: D1Database | null | undefined): Promise<BranchPublicConfig[]> {
  const rows = await listBranchRows(db);
  const byId = new Map(rows.map((row) => [row.id, row]));
  return Object.values(branchConfigs).map((base) => {
    const row = byId.get(base.id);
    return row ? branchRowToConfig(row) ?? base : base;
  });
}

export async function effectiveBranch(
  db: D1Database | null | undefined,
  id: string | null | undefined,
): Promise<BranchPublicConfig | null> {
  if (!id || !isBranchId(id)) return null;
  const row = await getBranchRow(db, id);
  return row ? branchRowToConfig(row) ?? branchConfig(id) : branchConfig(id);
}

export async function assertBookableBranch(
  db: D1Database | null | undefined,
  id: string | null | undefined,
): Promise<BranchPublicConfig> {
  const branch = await effectiveBranch(db, id);
  if (!branch || !branch.bookable || !branch.paymentsEnabled) {
    throw new Error('branch_not_bookable');
  }
  return branch;
}

/** Resolve a public lead's service location to a branch, never trusting a raw browser value. */
export async function resolveServiceBranch(
  db: D1Database | null | undefined,
  input: { requestedBranchId?: string | null; zip?: string | null; state?: string | null },
): Promise<BranchPublicConfig> {
  const requested = input.requestedBranchId?.trim() ?? '';
  if (isBranchId(requested)) {
    const branch = await effectiveBranch(db, requested);
    if (branch) return branch;
  }
  const zip = normalizeZip(input.zip ?? null);
  const pensacola = await effectiveBranch(db, BRANCH_PENSACOLA);
  const tampa = await effectiveBranch(db, BRANCH_TAMPA);
  if (zip && zipReferenceFor(zip) && pensacola) return pensacola;
  if (zip && tampa?.serviceAreaZips.includes(zip)) return tampa;
  const state = (input.state ?? '').trim().toUpperCase();
  if ((state === 'FL' || state === 'AL') && pensacola) return pensacola;
  return pensacola ?? branchConfigs[BRANCH_PENSACOLA];
}

export function branchPublicPayload(branch: BranchPublicConfig): Record<string, unknown> {
  return {
    id: branch.id,
    name: branch.publicName,
    slug: branch.publicSlug,
    region: branch.regionLabel,
    timezone: branch.timezone,
    lifecycle: branch.lifecycle,
    bookable: branch.bookable,
    paymentsEnabled: branch.paymentsEnabled,
    services: branch.services,
    serviceCounties: branch.serviceCounties,
    travelLimitMiles: branch.travelLimitMiles,
    capabilities: branch.capabilities,
    hours: branch.hoursLabel,
    phone: branch.publicPhone,
    email: branch.publicEmail,
    gbp: { status: branch.gbpStatus, url: branch.gbpUrl },
    launchNote: branch.launchNote,
  };
}
