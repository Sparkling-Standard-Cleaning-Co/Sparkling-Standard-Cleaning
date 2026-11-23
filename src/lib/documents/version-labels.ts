/**
 * Conventional owner-facing version labels.
 *
 * Internal versions remain unchanged for audit, hashes and signatures. Admin
 * presentation uses a friendly sequence per document family: Version 1.0,
 * Version 1.1, Version 1.2 ... Version 2.0.
 */

export function conventionalVersionLabel(ordinal: number): string {
  const safe = Math.max(1, Math.trunc(ordinal || 1));
  const major = Math.floor((safe - 1) / 10) + 1;
  const minor = (safe - 1) % 10;
  return `${major}.${minor}`;
}

export function displayVersion(value: unknown, ordinal?: number): string {
  const raw = String(value ?? '').trim();
  if (/^\d+\.\d+(\.\d+)?$/.test(raw)) return `Version ${raw}`;
  if (ordinal && ordinal > 0) return `Version ${conventionalVersionLabel(ordinal)}`;
  return 'Version 1.0';
}

/** Builds a per-family ordinal map (oldest version first). */
export function familyVersionOrdinals(
  rows: Array<Record<string, unknown>>,
): Map<string, number> {
  const families = new Map<string, Array<{ id: string; createdAt: string; order: number }>>();
  rows.forEach((row, index) => {
    const id = String(row.id ?? '');
    if (!id) return;
    const family = String(row.family_key ?? '').trim() || id;
    const createdAt = String(row.created_at ?? '');
    const list = families.get(family) ?? [];
    list.push({ id, createdAt, order: index });
    families.set(family, list);
  });
  const ordinals = new Map<string, number>();
  for (const list of families.values()) {
    list
      .sort((left, right) =>
        left.createdAt === right.createdAt
          ? left.order - right.order
          : left.createdAt.localeCompare(right.createdAt),
      )
      .forEach((entry, index) => ordinals.set(entry.id, index + 1));
  }
  return ordinals;
}
