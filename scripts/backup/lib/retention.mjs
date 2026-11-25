// Pure retention planning for encrypted backup bundles. The planner never
// deletes anything; callers must apply an explicit plan and preserve the newest
// known-good archive, pre-migration archives and legal-hold archives.

export const DEFAULT_RETENTION = Object.freeze({
  daily: 30,
  weekly: 12,
  monthly: 12,
});

const ARCHIVE_PATTERN = /^sparkling-standard-backup-(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})/i;

export function parseBackupDate(name) {
  const match = String(name).match(ARCHIVE_PATTERN);
  if (!match) return null;
  const iso = `${match[1]}T${match[2]}:${match[3]}:${match[4]}Z`;
  const date = new Date(iso);
  return Number.isFinite(date.getTime()) ? date : null;
}

export function backupBaseName(name) {
  const base = String(name).split('/').pop() ?? String(name);
  return base
    .replace(/\.part\d+$/i, '')
    .replace(/\.manifest\.json\.enc$/i, '')
    .replace(/\.sha256$/i, '')
    .replace(/\.ssbk$/i, '');
}

export function groupBundles(items) {
  const bundles = new Map();
  for (const item of items) {
    const name = String(item.name ?? '');
    if (!name) continue;
    const base = backupBaseName(name);
    if (!base) continue;
    const current = bundles.get(base) ?? {
      id: base,
      name: base,
      date: parseBackupDate(base),
      scope: /-(complete|database)$/i.exec(base)?.[1]?.toLowerCase() ?? 'legacy',
      files: [],
      bytes: 0,
      protected: false,
    };
    current.files.push(item);
    current.bytes += Number(item.bytes ?? item.size ?? 0);
    if (/pre[-_]?migration/i.test(name)) current.protected = true;
    bundles.set(base, current);
  }
  return [...bundles.values()];
}

function startOfIsoWeek(date) {
  const copy = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = copy.getUTCDay() || 7;
  copy.setUTCDate(copy.getUTCDate() - day + 1);
  return copy.toISOString().slice(0, 10);
}

function monthKey(date) {
  return date.toISOString().slice(0, 7);
}

export function planRetention(items, options = {}) {
  const retention = {
    daily: Math.max(0, Number(options.daily ?? DEFAULT_RETENTION.daily)),
    weekly: Math.max(0, Number(options.weekly ?? DEFAULT_RETENTION.weekly)),
    monthly: Math.max(0, Number(options.monthly ?? DEFAULT_RETENTION.monthly)),
  };
  const legalHold = new Set((options.legalHold ?? []).map(String));
  const capacityBytes = options.capacityBytes ? Number(options.capacityBytes) : null;
  const usedBytes = items.reduce((sum, item) => sum + Number(item.bytes ?? item.size ?? 0), 0);
  const bundles = groupBundles(items).sort((a, b) => {
    const at = a.date?.getTime() ?? 0;
    const bt = b.date?.getTime() ?? 0;
    return bt - at;
  });
  const kept = new Set();
  const scopeSets = new Map();
  const newestByScope = new Map();
  for (const bundle of bundles) {
    if (!bundle.date) continue;
    if (!newestByScope.has(bundle.scope)) newestByScope.set(bundle.scope, bundle.id);
    const scopeState = scopeSets.get(bundle.scope) ?? {
      daily: new Set(),
      weekly: new Set(),
      monthly: new Set(),
    };
    const day = bundle.date.toISOString().slice(0, 10);
    const week = startOfIsoWeek(bundle.date);
    const month = monthKey(bundle.date);
    if (scopeState.daily.size < retention.daily && !scopeState.daily.has(day)) {
      scopeState.daily.add(day);
      kept.add(bundle.id);
    }
    if (scopeState.weekly.size < retention.weekly && !scopeState.weekly.has(week)) {
      scopeState.weekly.add(week);
      kept.add(bundle.id);
    }
    if (scopeState.monthly.size < retention.monthly && !scopeState.monthly.has(month)) {
      scopeState.monthly.add(month);
      kept.add(bundle.id);
    }
    scopeSets.set(bundle.scope, scopeState);
  }
  for (const id of newestByScope.values()) kept.add(id);
  for (const bundle of bundles) {
    if (bundle.protected || legalHold.has(bundle.id) || legalHold.has(bundle.name)) kept.add(bundle.id);
  }
  const deletions = bundles.filter((bundle) => !kept.has(bundle.id));
  const bytesKept = bundles.filter((bundle) => kept.has(bundle.id)).reduce((sum, bundle) => sum + bundle.bytes, 0);
  const bytesDeleted = deletions.reduce((sum, bundle) => sum + bundle.bytes, 0);
  const projectedBytes = capacityBytes === null ? bytesKept : usedBytes - bytesDeleted;
  return {
    policy: retention,
    bundles: bundles.length,
    kept: bundles.filter((bundle) => kept.has(bundle.id)).map((bundle) => ({
      id: bundle.id,
      date: bundle.date?.toISOString() ?? null,
      bytes: bundle.bytes,
      protected: bundle.protected,
      files: bundle.files.length,
    })),
    delete: deletions.map((bundle) => ({
      id: bundle.id,
      date: bundle.date?.toISOString() ?? null,
      bytes: bundle.bytes,
      protected: bundle.protected,
      files: bundle.files.length,
    })),
    bytesKept,
    bytesDeleted,
    projectedBytes,
    capacityBytes,
    capacityExceeded: capacityBytes !== null && projectedBytes > capacityBytes,
    warning: capacityBytes !== null && projectedBytes > capacityBytes
      ? 'Retention plan still exceeds the approved destination capacity. No additional older archive was deleted automatically.'
      : null,
  };
}
