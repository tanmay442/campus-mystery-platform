export interface PreparedStatementBinding {
  bind(...values: Array<unknown>): PreparedStatementBinding;
  first(): Promise<Record<string, unknown> | null>;
  all(): Promise<Array<Record<string, unknown>>>;
  run(): Promise<unknown>;
}

export interface DatabaseBinding {
  prepare(query: string): PreparedStatementBinding;
  batch(
    statements: Array<PreparedStatementBinding>
  ): Promise<Array<unknown>>;
  exec(query: string): Promise<unknown>;
}

export interface StoredObjectBody {
  arrayBuffer(): Promise<ArrayBuffer>;
}

export interface BucketBinding {
  get(key: string): Promise<StoredObjectBody | null>;
  put(
    key: string,
    value: ReadableStream | ArrayBuffer | string
  ): Promise<unknown>;
  delete(key: string): Promise<void>;
}

export interface FetcherBinding {
  fetch(input: string | Request, init?: RequestInit): Promise<Response>;
}

export interface AuthUser {
  id: string;
  email: string;
  emailVerified: boolean;
}

export interface Env {
  DB: DatabaseBinding;
  MEDIA: BucketBinding;
  ASSETS?: FetcherBinding;
  ADMIN_EMAILS: string;
  ENVIRONMENT?: string;
  SESSION_SECRET?: string;
  TURNSTILE_SECRET_KEY?: string;
}

export interface AppVariables {
  user?: AuthUser;
  sessionToken?: string;
  idempotencyKey?: string;
}

export interface AppEnv {
  Bindings: Env;
  Variables: AppVariables;
}
