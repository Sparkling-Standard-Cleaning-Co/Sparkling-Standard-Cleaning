// Developer-controlled calculation schema marker.
//
// This is NOT an owner pricing value and must not be edited for a routine
// price change. Bump it only when the calculation algorithm, pricing order or
// effective pricing policy changes in a way that should invalidate existing
// quotes. The effective configuration fingerprint is appended automatically.

export const PRICING_CALCULATION_SCHEMA_VERSION =
  '2026-10-25.engine-calibration-supportive-tax.v1';
