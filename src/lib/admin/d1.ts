/** Minimal D1 surface used by the Sparkling Standard admin application. */
export interface D1Result<T = Record<string, unknown>> {
  results?: T[];
  success: boolean;
  meta?: Record<string, unknown>;
}

export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  run(): Promise<D1Result>;
}

export interface D1Database {
  prepare(query: string): D1PreparedStatement;
  /** Optional D1 batch surface; when present a publish is one transaction. */
  batch?<T = Record<string, unknown>>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]>;
}

export interface AdminDbEnv {
  DB?: D1Database;
}

export function adminDb(env: AdminDbEnv): D1Database | null {
  return env.DB ?? null;
}
