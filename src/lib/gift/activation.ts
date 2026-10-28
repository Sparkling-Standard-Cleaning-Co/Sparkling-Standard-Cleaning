// Gift-certificate redemption activation. Future-dated certificates are
// delivered immediately but cannot be redeemed until 12:00 AM America/Chicago
// on the selected valid-from date.

import { zonedTimeToUtc } from '../booking/time.ts';

export const GIFT_ACTIVATION_TIME_ZONE = 'America/Chicago';
export const GIFT_ACTIVATION_TIME = '00:00';

export function centralToday(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: GIFT_ACTIVATION_TIME_ZONE }).format(now);
}

export function isValidCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T12:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function activationInstant(validFromDate: string): string {
  return zonedTimeToUtc(validFromDate, GIFT_ACTIVATION_TIME, GIFT_ACTIVATION_TIME_ZONE).toISOString();
}

export function activationDateFor(record: {
  validFromDate?: string;
  issuedAt: string;
}): string {
  if (record.validFromDate && isValidCalendarDate(record.validFromDate)) return record.validFromDate;
  return new Intl.DateTimeFormat('en-CA', { timeZone: GIFT_ACTIVATION_TIME_ZONE }).format(
    new Date(record.issuedAt),
  );
}

export function activationInstantFor(record: {
  validFromDate?: string;
  activatesAt?: string;
  issuedAt: string;
}): string {
  if (record.activatesAt && Number.isFinite(Date.parse(record.activatesAt))) return record.activatesAt;
  return activationInstant(activationDateFor(record));
}

export function isGiftActive(
  record: {
    validFromDate?: string;
    activatesAt?: string;
    issuedAt: string;
  },
  now = new Date(),
): boolean {
  return now.getTime() >= Date.parse(activationInstantFor(record));
}

export function activationLabel(validFromDate: string): string {
  return `Valid beginning ${validFromDate} at 12:00 AM Central Time.`;
}
