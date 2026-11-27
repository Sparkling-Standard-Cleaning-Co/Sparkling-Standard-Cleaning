// Owner-controlled property duplicate review and safe consolidation.
//
// Nothing here runs automatically. The review groups existing records; archive
// and merge are explicit owner actions with dependency checks. Financial,
// agreement and completed-service history is always preserved by moving the
// relationship to the canonical property rather than deleting it.

import type { D1Database, D1PreparedStatement } from './d1.ts';
import { AdminAuthError, audit, type AdminActor } from './operations.ts';
import { normalizeAddressLine, sameStreetForConsolidation } from '../address/address-key.ts';

export interface PropertyQualityRow {
  id: string;
  customer_id: string;
  customer_name: string;
  company_name: string;
  customer_status: string;
  label: string;
  line1: string;
  line2: string;
  city: string;
  state: string;
  postal_code: string;
  status: string;
  usage_type: string;
  created_at: string;
  appointments: number;
  active_appointments: number;
  recurring_plans: number;
  active_recurring_plans: number;
  invoices: number;
  leads: number;
  estimates: number;
  proposals: number;
  contracts: number;
  contacts: number;
  walkthroughs: number;
  contract_schedules: number;
}

export interface PropertyQualityGroup {
  key: string;
  street: string;
  unit: string;
  locality: string;
  rows: PropertyQualityRow[];
  sameCustomer: boolean;
  sameUnit: boolean;
  hasActiveObligation: boolean;
}

function text(value: unknown, max = 500): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function scope(actor: AdminActor, column: string): { sql: string; bind: unknown[] } {
  if (actor.role === 'owner') return { sql: '', bind: [] };
  if (actor.branchId) return { sql: ` AND ${column} = ?`, bind: [actor.branchId] };
  return { sql: ' AND 1 = 0', bind: [] };
}

function displayAddress(row: PropertyQualityRow): string {
  return [row.line1, row.line2, row.city, row.state, row.postal_code].filter(Boolean).join(', ');
}

const PROPERTY_SELECT = `
  p.id, p.customer_id, p.label, p.line1, p.line2, p.city, p.state, p.postal_code,
  p.status, p.usage_type, p.created_at,
  TRIM(COALESCE(c.first_name,'') || ' ' || COALESCE(c.last_name,'')) AS customer_name,
  COALESCE(c.company_name,'') AS company_name, COALESCE(c.status,'') AS customer_status,
  (SELECT COUNT(*) FROM appointments a WHERE a.property_id = p.id) AS appointments,
  (SELECT COUNT(*) FROM appointments a WHERE a.property_id = p.id
     AND a.status IN ('pending','confirmed','in_progress')
     AND a.start_at >= strftime('%Y-%m-%dT%H:%M:%fZ','now')) AS active_appointments,
  (SELECT COUNT(*) FROM recurring_plans r WHERE r.property_id = p.id) AS recurring_plans,
  (SELECT COUNT(*) FROM recurring_plans r WHERE r.property_id = p.id AND r.status = 'active') AS active_recurring_plans,
  (SELECT COUNT(*) FROM invoices i WHERE i.property_id = p.id) AS invoices,
  (SELECT COUNT(*) FROM leads l WHERE l.property_id = p.id) AS leads,
  (SELECT COUNT(*) FROM estimates e WHERE e.property_id = p.id) AS estimates,
  (SELECT COUNT(*) FROM commercial_proposals cp WHERE cp.property_id = p.id) AS proposals,
  (SELECT COUNT(*) FROM commercial_contracts cc WHERE cc.property_id = p.id) AS contracts,
  (SELECT COUNT(*) FROM property_contacts pc WHERE pc.property_id = p.id) AS contacts,
  (SELECT COUNT(*) FROM commercial_walkthroughs cw WHERE cw.property_id = p.id) AS walkthroughs,
  (SELECT COUNT(*) FROM commercial_contract_schedules cs WHERE cs.property_id = p.id
     AND cs.status IN ('draft','previewed','approved','active')) AS contract_schedules
`;

function groupParts(row: PropertyQualityRow): { street: string; unit: string } {
  return normalizeAddressLine(row.line1, row.line2);
}

function localityOf(row: PropertyQualityRow): string {
  return (row.postal_code || row.city || '').trim().toLowerCase();
}

export async function listPropertyQualityGroups(
  db: D1Database,
  actor: AdminActor,
): Promise<{ groups: PropertyQualityGroup[]; scanned: number }> {
  const branch = scope(actor, 'p.branch_id');
  const result = await db
    .prepare(
      `SELECT ${PROPERTY_SELECT}
       FROM properties p LEFT JOIN customers c ON c.id = p.customer_id
       WHERE 1 = 1${branch.sql}
       ORDER BY p.created_at DESC LIMIT 2000`,
    )
    .bind(...branch.bind)
    .all<PropertyQualityRow>();
  const rows = result.results ?? [];
  const byStreet = new Map<string, PropertyQualityRow[]>();
  for (const row of rows) {
    const parts = groupParts(row);
    if (!parts.street) continue;
    const key = `${parts.street}|${parts.unit}`;
    const list = byStreet.get(key) ?? [];
    list.push(row);
    byStreet.set(key, list);
  }
  const candidates: PropertyQualityGroup[] = [];
  for (const [key, list] of byStreet) {
    const postals = new Set(list.map((row) => row.postal_code.trim()).filter(Boolean));
    if (postals.size <= 1) {
      const parts = groupParts(list[0]!);
      candidates.push(group(key, parts.street, parts.unit, localityOf(list[0]!), list));
      continue;
    }
    const byPostal = new Map<string, PropertyQualityRow[]>();
    for (const row of list) {
      const postal = row.postal_code.trim();
      const matchingCity = postal
        ? postal
        : list.find(
            (candidate) =>
              candidate.postal_code.trim() &&
              candidate.city.trim().toLowerCase() === row.city.trim().toLowerCase(),
          )?.postal_code.trim() || 'unknown';
      const bucket = byPostal.get(matchingCity) ?? [];
      bucket.push(row);
      byPostal.set(matchingCity, bucket);
    }
    for (const [postal, bucket] of byPostal) {
      const parts = groupParts(bucket[0]!);
      candidates.push(group(`${key}|${postal}`, parts.street, parts.unit, postal.toLowerCase(), bucket));
    }
  }
  // Present a truncated-suffix typo with its likely base address for review.
  const merged: PropertyQualityGroup[] = [];
  for (const candidate of candidates) {
    const match = merged.find((existing) => {
      if (existing.unit !== candidate.unit) return false;
      if (!sameStreetForConsolidation(existing.street, candidate.street)) return false;
      const aPostal = existing.locality;
      const bPostal = candidate.locality;
      return !aPostal || !bPostal || aPostal === 'unknown' || bPostal === 'unknown' || aPostal === bPostal;
    });
    if (!match) {
      merged.push(candidate);
      continue;
    }
    match.rows = [...match.rows, ...candidate.rows].sort((a, b) => a.created_at.localeCompare(b.created_at));
    match.sameCustomer = new Set(match.rows.map((row) => row.customer_id)).size === 1;
    match.hasActiveObligation = match.rows.some((row) => activeObligation(row));
  }
  const groups = merged
    .filter((entry) => entry.rows.length > 1)
    .sort((a, b) => {
      const aTest = a.rows.some((row) => /checkout diagnostic|your name here|placeholder customer|test record/i.test(`${row.customer_name} ${row.label}`));
      const bTest = b.rows.some((row) => /checkout diagnostic|your name here|placeholder customer|test record/i.test(`${row.customer_name} ${row.label}`));
      if (aTest !== bTest) return aTest ? -1 : 1;
      return b.rows.length - a.rows.length;
    });
  return { groups, scanned: rows.length };
}

function group(
  key: string,
  street: string,
  unit: string,
  locality: string,
  rows: PropertyQualityRow[],
): PropertyQualityGroup {
  const sorted = [...rows].sort((a, b) => a.created_at.localeCompare(b.created_at));
  return {
    key,
    street,
    unit,
    locality,
    rows: sorted,
    sameCustomer: new Set(sorted.map((row) => row.customer_id)).size === 1,
    sameUnit: true,
    hasActiveObligation: sorted.some((row) => activeObligation(row)),
  };
}

export function activeObligation(row: PropertyQualityRow): boolean {
  return (
    Number(row.active_appointments) > 0 ||
    Number(row.active_recurring_plans) > 0 ||
    Number(row.contract_schedules) > 0
  );
}

function qualityRow(db: D1Database, actor: AdminActor, propertyId: string): Promise<PropertyQualityRow | null> {
  const branch = scope(actor, 'p.branch_id');
  return db
    .prepare(
      `SELECT ${PROPERTY_SELECT}
       FROM properties p LEFT JOIN customers c ON c.id = p.customer_id
       WHERE p.id = ?${branch.sql} LIMIT 1`,
    )
    .bind(propertyId, ...branch.bind)
    .first<PropertyQualityRow>();
}

export async function archiveDuplicateProperty(
  db: D1Database,
  actor: AdminActor,
  propertyId: string,
  note: string,
): Promise<void> {
  const row = await qualityRow(db, actor, propertyId);
  if (!row) throw new AdminAuthError(404, 'property_not_found');
  if (row.status !== 'active') throw new AdminAuthError(409, 'property_already_archived');
  if (activeObligation(row)) throw new AdminAuthError(409, 'property_has_active_obligations');
  const timestamp = new Date().toISOString();
  await db
    .prepare(
      "UPDATE properties SET status = 'archived', internal_notes = TRIM(COALESCE(internal_notes,'') || ' ' || ?), updated_at = ? WHERE id = ?",
    )
    .bind(
      [row.label, note ? `Archived duplicate: ${text(note, 500)}` : 'Archived duplicate property record.']
        .filter(Boolean)
        .join(' — ')
        .slice(0, 2000),
      timestamp,
      propertyId,
    )
    .run();
  await audit(db, {
    actorUserId: actor.id,
    action: 'property.duplicate_archived',
    entityType: 'property',
    entityId: propertyId,
    detail: displayAddress(row),
  });
}

const REFERENCE_UPDATES: ReadonlyArray<{ table: string; column: string }> = [
  { table: 'leads', column: 'property_id' },
  { table: 'estimates', column: 'property_id' },
  { table: 'booking_requests', column: 'property_id' },
  { table: 'appointments', column: 'property_id' },
  { table: 'recurring_plans', column: 'property_id' },
  { table: 'invoices', column: 'property_id' },
  { table: 'agreements', column: 'property_id' },
  { table: 'payment_authorizations', column: 'property_id' },
  { table: 'signing_requests', column: 'property_id' },
  { table: 'quick_estimates', column: 'property_id' },
  { table: 'service_change_orders', column: 'property_id' },
  { table: 'property_contacts', column: 'property_id' },
  { table: 'commercial_walkthroughs', column: 'property_id' },
  { table: 'commercial_proposals', column: 'property_id' },
  { table: 'commercial_contracts', column: 'property_id' },
  { table: 'quality_inspections', column: 'property_id' },
  { table: 'commercial_contract_schedules', column: 'property_id' },
];

export async function mergeDuplicateProperty(
  db: D1Database,
  actor: AdminActor,
  sourcePropertyId: string,
  targetPropertyId: string,
  note: string,
): Promise<void> {
  if (!sourcePropertyId || !targetPropertyId || sourcePropertyId === targetPropertyId) {
    throw new AdminAuthError(400, 'property_merge_selection_invalid');
  }
  const [source, target] = await Promise.all([
    qualityRow(db, actor, sourcePropertyId),
    qualityRow(db, actor, targetPropertyId),
  ]);
  if (!source || !target) throw new AdminAuthError(404, 'property_not_found');
  if (source.status !== 'active' || target.status !== 'active') {
    throw new AdminAuthError(409, 'property_must_be_active');
  }
  if (source.customer_id !== target.customer_id) {
    throw new AdminAuthError(409, 'property_customer_mismatch');
  }
  const sourceParts = normalizeAddressLine(source.line1, source.line2);
  const targetParts = normalizeAddressLine(target.line1, target.line2);
  if (!sameStreetForConsolidation(sourceParts.street, targetParts.street) || sourceParts.unit !== targetParts.unit) {
    throw new AdminAuthError(409, 'property_unit_mismatch');
  }
  const timestamp = new Date().toISOString();
  const statements: D1PreparedStatement[] = REFERENCE_UPDATES.map(({ table, column }) =>
    db.prepare(`UPDATE ${table} SET ${column} = ? WHERE ${column} = ?`).bind(targetPropertyId, sourcePropertyId),
  );
  statements.push(
    db
      .prepare(
        `UPDATE properties SET status = 'archived', is_primary = 0,
                internal_notes = TRIM(COALESCE(internal_notes,'') || ' ' || ?), updated_at = ? WHERE id = ?`,
      )
      .bind(
        [source.label, note ? `Merged into ${targetPropertyId}: ${text(note, 400)}` : `Merged into ${targetPropertyId}.`]
          .filter(Boolean)
          .join(' — ')
          .slice(0, 2000),
        timestamp,
        sourcePropertyId,
      ),
  );
  statements.push(
    db
      .prepare('UPDATE properties SET is_primary = 1, updated_at = ? WHERE id = ?')
      .bind(timestamp, targetPropertyId),
  );
  if (db.batch) {
    await db.batch(statements);
  } else {
    for (const statement of statements) await statement.run();
  }
  await audit(db, {
    actorUserId: actor.id,
    action: 'property.duplicate_merged',
    entityType: 'property',
    entityId: sourcePropertyId,
    detail: `Merged into ${targetPropertyId}; customer ${source.customer_id}; unit ${sourceParts.unit || 'none'}`,
  });
}
