// Test-only in-memory implementation of the payment ledger interface.
// It mimics the R2 conditional-create behavior used by the Functions.

import type { LedgerBucket, LedgerObject } from '../../src/lib/payments/ledger.ts';

export class FakeLedger implements LedgerBucket {
  readonly values = new Map<string, string>();
  readonly puts: string[] = [];
  private version = 0;

  async get(key: string): Promise<LedgerObject | null> {
    const value = this.values.get(key);
    if (value === undefined) return null;
    return {
      text: async () => value,
      etag: `"${key}:${this.version}"`,
    };
  }

  async put(
    key: string,
    value: string,
    options?: { onlyIf?: { etagDoesNotMatch?: string } | Headers },
  ): Promise<unknown> {
    const onlyIf = options?.onlyIf;
    const createOnce =
      onlyIf instanceof Headers
        ? onlyIf.get('If-None-Match') === '*'
        : onlyIf?.etagDoesNotMatch === '*';
    if (createOnce && this.values.has(key)) return null;
    this.values.set(key, value);
    this.puts.push(key);
    this.version += 1;
    return { key };
  }

  async delete(key: string): Promise<void> {
    this.values.delete(key);
    this.version += 1;
  }

  json<T>(key: string): T | null {
    const value = this.values.get(key);
    return value === undefined ? null : (JSON.parse(value) as T);
  }
}
