// Direct-provider fallback field preparation (Sparkling Standard 4.0 §3A).
//
// When the authoritative server relay is unavailable, a priced submission may
// still be delivered to the owner as a NONBINDING inquiry — but it must never
// arrive under a quote-claim field name. This module strips every authoritative
// price field and re-labels the client's figures as explicitly unverified.
// Pure and dependency-free so it is unit-testable in Node.

/**
 * Fields that only an AUTHORITATIVE server verification may produce. On the
 * direct-provider fallback there is no server, so these are stripped and the
 * client's figures are re-labeled as unverified — a browser price must never
 * travel under a quote field name.
 */
export const PRICED_FIELD_KEYS = [
  'quoted_price',
  'quoted_range',
  'first_visit_total',
  'ongoing_price_per_visit',
  'ongoing_frequency',
  'quote_reference',
  'quote_config_version',
  'quote_verified',
  'verified_price',
  'verified_range',
  'client_price',
] as const;

/**
 * Prepares the direct-provider fallback payload for a PRICED submission.
 * Returns the fields with every quote claim removed, the client's figures
 * re-labeled as unverified, and a request_type that can never read as a
 * reservation. Non-priced submissions are returned untouched (same object).
 */
export function directFallbackFields(fields: Record<string, string>): Record<string, string> {
  const priced =
    fields.request_type === 'reservation_request' ||
    (fields.quoted_price ?? '').trim() !== '' ||
    (fields.client_price ?? '').trim() !== '';
  if (!priced) return fields;

  const next: Record<string, string> = { ...fields };
  const carried: Record<string, string> = {
    unverified_client_price: fields.quoted_price ?? fields.client_price ?? '',
    unverified_client_range: fields.quoted_range ?? '',
    unverified_client_first_visit: fields.first_visit_total ?? '',
    unverified_client_ongoing_price: fields.ongoing_price_per_visit ?? '',
    unverified_client_ongoing_frequency: fields.ongoing_frequency ?? '',
  };
  for (const key of PRICED_FIELD_KEYS) delete next[key];
  next.request_type = 'residential_estimate';
  next.unverified_priced_request = 'yes';
  for (const [key, value] of Object.entries(carried)) {
    if (value.trim() !== '') next[key] = value;
  }
  return next;
}
