// Customer email validation shared by the browser adapters, the lead relay,
// checkout and gift purchase. A syntactically valid address is required for
// every customer submission; it is never proof that the customer owns it.

export const MAX_CUSTOMER_EMAIL_LENGTH = 254;

export type CustomerEmailProblem = 'email_required' | 'email_invalid';

/** Trims, bounds and lowercases the address for safe storage/lookup. */
export function normalizeCustomerEmail(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, MAX_CUSTOMER_EMAIL_LENGTH).toLowerCase();
}

/** Syntax check only; ownership is not verified. */
export function isValidCustomerEmail(value: string): boolean {
  if (!value || value.length > MAX_CUSTOMER_EMAIL_LENGTH) return false;
  if (/[<>]/.test(value)) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value);
}

/** Returns null when valid, otherwise the exact server/client problem code. */
export function customerEmailProblem(value: unknown): CustomerEmailProblem | null {
  const email = normalizeCustomerEmail(value);
  if (!email) return 'email_required';
  if (!isValidCustomerEmail(email)) return 'email_invalid';
  return null;
}
