// Durable, minimal payment ledger for checkout idempotency and webhook event
// reconciliation. It is deliberately storage-agnostic so the Cloudflare
// Functions can use the existing private R2 binding and tests can use a small
// in-memory fake.
//
// The ledger is NOT a card store and must never contain card data, CVCs,
// secrets, or full Stripe payloads. It contains only the minimum references
// needed to reconcile a payment and prevent duplicate fulfillment.

export interface LedgerObject {
  text(): Promise<string>;
  etag?: string;
}

export interface LedgerBucket {
  get(key: string): Promise<LedgerObject | null>;
  put(
    key: string,
    value: string,
    options?: { onlyIf?: { etagDoesNotMatch?: string } | Headers },
  ): Promise<unknown>;
  delete?(key: string): Promise<void>;
}

export interface PaymentStorageEnv {
  /** Preferred dedicated binding if the owner creates one. */
  PAYMENT_LEDGER?: LedgerBucket;
  /** Existing private R2 binding; used with a payments/ prefix if no dedicated binding. */
  PHOTOS_BUCKET?: LedgerBucket;
}

export function paymentLedger(env: PaymentStorageEnv): LedgerBucket | null {
  return env.PAYMENT_LEDGER ?? env.PHOTOS_BUCKET ?? null;
}

export function ledgerKey(...parts: string[]): string {
  return ['payments', ...parts].join('/');
}

export async function readLedgerJson<T>(
  bucket: LedgerBucket,
  key: string,
): Promise<{ value: T; etag?: string } | null> {
  const object = await bucket.get(key);
  if (!object) return null;
  try {
    const value = JSON.parse(await object.text()) as T;
    return object.etag ? { value, etag: object.etag } : { value };
  } catch {
    return null;
  }
}

export async function writeLedgerJson<T>(
  bucket: LedgerBucket,
  key: string,
  value: T,
): Promise<void> {
  await bucket.put(key, JSON.stringify(value));
}

/**
 * Atomically creates a ledger key only when it does not already exist.
 * Returns false when another isolate already owns it. If the storage provider
 * rejects the conditional write, the caller can distinguish an existing record
 * from a genuine storage failure by reading the key.
 */
export async function createLedgerJson<T>(
  bucket: LedgerBucket,
  key: string,
  value: T,
): Promise<boolean> {
  try {
    const result = await bucket.put(key, JSON.stringify(value), {
      onlyIf: new Headers({ 'If-None-Match': '*' }),
    });
    return result !== null && result !== undefined;
  } catch (error) {
    const existing = await readLedgerJson<T>(bucket, key).catch(() => null);
    if (existing) return false;
    throw error;
  }
}

export async function deleteLedgerKey(bucket: LedgerBucket, key: string): Promise<void> {
  await bucket.delete?.(key);
}

/** Strong, deterministic 64-character SHA-256 identifier for financial idempotency. */
export async function paymentHash(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function newPaymentAttemptId(): string {
  const random = crypto.getRandomValues(new Uint8Array(12));
  return [...random].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
