/**
 * Durable pre-payment checkout intent.
 *
 * A customer who must sign a document before paying is sent away from the
 * checkout flow. This record preserves the exact server-sanitized request so
 * the customer can resume without re-entering the estimate, while the resume
 * endpoint still recalculates the quote and re-checks the document gate.
 *
 * The resume token is a capability: only its SHA-256 hash is stored. The record
 * contains no card data and expires.
 */
import { hashToken, randomToken } from '../admin/auth.ts';
import {
  deleteLedgerKey,
  readLedgerJson,
  writeLedgerJson,
  type LedgerBucket,
} from '../payments/ledger.ts';

export const CHECKOUT_INTENT_TTL_MS = 60 * 60 * 1000;

export interface CheckoutIntentRecord {
  version: 1;
  signingRequestId: string;
  resumeHash: string;
  fields: Record<string, string>;
  returnPath: string;
  createdAt: string;
  expiresAt: string;
}

function intentKey(hash: string): string {
  return `documents/checkout-intents/${hash}.json`;
}

export interface CreatedCheckoutIntent {
  token: string;
  expiresAt: string;
}

export async function createCheckoutIntent(
  store: LedgerBucket,
  input: {
    signingRequestId: string;
    fields: Record<string, string>;
    returnPath?: string;
  },
): Promise<CreatedCheckoutIntent> {
  const token = randomToken(32);
  const resumeHash = await hashToken(token);
  const now = Date.now();
  const expiresAt = new Date(now + CHECKOUT_INTENT_TTL_MS).toISOString();
  const record: CheckoutIntentRecord = {
    version: 1,
    signingRequestId: input.signingRequestId,
    resumeHash,
    fields: input.fields,
    returnPath: input.returnPath ?? '',
    createdAt: new Date(now).toISOString(),
    expiresAt,
  };
  await writeLedgerJson(store, intentKey(resumeHash), record);
  return { token, expiresAt };
}

export async function readCheckoutIntent(
  store: LedgerBucket,
  token: string,
): Promise<{ record: CheckoutIntentRecord; key: string } | null> {
  const trimmed = token.trim();
  if (!trimmed) return null;
  const resumeHash = await hashToken(trimmed);
  const key = intentKey(resumeHash);
  const stored = await readLedgerJson<CheckoutIntentRecord>(store, key).catch(() => null);
  if (!stored) return null;
  const record = stored.value;
  if (
    record.version !== 1 ||
    record.resumeHash !== resumeHash ||
    !record.signingRequestId ||
    !record.fields ||
    Date.parse(record.expiresAt) <= Date.now()
  ) {
    return null;
  }
  return { record, key };
}

export async function deleteCheckoutIntent(store: LedgerBucket, key: string): Promise<void> {
  await deleteLedgerKey(store, key);
}
