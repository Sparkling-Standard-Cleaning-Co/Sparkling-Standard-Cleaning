/**
 * Conservative test-record detection for the owner's cleanup preview.
 *
 * These heuristics never mutate data and never treat a familiar name (for
 * example the owner's name) as proof that a record is a test. They look only
 * for unmistakable placeholder/diagnostic markers.
 */

export interface LeadTestSignals {
  name?: unknown;
  email?: unknown;
  phone?: unknown;
  source?: unknown;
  payload?: Record<string, unknown>;
}

const PLACEHOLDER_NAMES = [
  /\byour name here\b/i,
  /\bcheckout diagnostic\b/i,
  /\btest (customer|lead|inquiry|booking)\b/i,
  /\bdo not (use|book)\b/i,
  /\bignore (this|me)\b/i,
];

const PLACEHOLDER_PHONES = new Set([
  '0000000000',
  '8500000000',
  '7777777777',
  '5555555555',
  '1234567890',
  '9999999999',
]);

function text(value: unknown): string {
  return String(value ?? '').trim();
}

function allSameDigits(value: string): boolean {
  return value.length >= 7 && /^(\d)\1+$/.test(value);
}

export function suspectTestReasons(signals: LeadTestSignals): string[] {
  const reasons = new Set<string>();
  const payload = signals.payload ?? {};
  const name = text(signals.name || payload.name || payload.full_name);
  const email = text(signals.email || payload.email).toLowerCase();
  const phone = text(signals.phone || payload.phone);
  const source = text(signals.source || payload.source).toLowerCase();
  const phoneDigits = phone.replace(/\D/g, '');
  const phone10 = phoneDigits.slice(-10);

  if (name && PLACEHOLDER_NAMES.some((pattern) => pattern.test(name))) {
    reasons.add('Placeholder customer name');
  }
  if (email.includes('+checkout-diagnostic') || /^checkout[-+]?diagnostic@/i.test(email)) {
    reasons.add('Checkout diagnostic email address');
  }
  if (/(?:^|\.)example\.(?:com|org|net)$/i.test(email.split('@')[1] ?? '')) {
    reasons.add('Reserved example email domain');
  }
  if (/(^|\.)email\.?address@usa\.com$/.test(email) || /^emailaddress@/i.test(email)) {
    reasons.add('Placeholder email address');
  }
  if (
    phone10 &&
    (PLACEHOLDER_PHONES.has(phone10) || allSameDigits(phone10) || phone10.startsWith('000000'))
  ) {
    reasons.add('Placeholder phone number');
  }
  if (['internal_test', 'test', 'diagnostic'].includes(source)) {
    reasons.add('Request source is marked test');
  }
  for (const key of ['is_test', 'test_mode', 'test_request', 'diagnostic']) {
    const value = payload[key];
    if (value === true || value === 1 || value === '1' || value === 'yes' || value === 'true') {
      reasons.add('Request data is marked test');
      break;
    }
  }

  return [...reasons];
}

export function looksLikeTestLead(signals: LeadTestSignals): boolean {
  return suspectTestReasons(signals).length > 0;
}

/** Counts bulk-operation outcomes by code for a concise owner summary. */
export function summarizeLeadResults(
  results: Array<{ ok: boolean; error?: string }>,
): { completed: number; skipped: number; reasons: Array<{ reason: string; count: number }> } {
  const completed = results.filter((entry) => entry.ok).length;
  const counts = new Map<string, number>();
  for (const entry of results) {
    if (entry.ok) continue;
    const reason = entry.error || 'not_permitted';
    counts.set(reason, (counts.get(reason) ?? 0) + 1);
  }
  return {
    completed,
    skipped: results.length - completed,
    reasons: [...counts.entries()].map(([reason, count]) => ({ reason, count })),
  };
}
