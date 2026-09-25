export type ApiErrorCode =
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_ADMIN"
  | "EVENT_NOT_FOUND"
  | "EVENT_NOT_LIVE"
  | "EVENT_PAUSED"
  | "CHALLENGE_LOCKED"
  | "OBJECTIVE_LOCKED"
  | "INVALID_ANSWER"
  | "TOO_MANY_ATTEMPTS"
  | "COOLDOWN"
  | "LOCATION_REJECTED"
  | "POOR_ACCURACY"
  | "TEAM_FULL"
  | "MEMBERSHIP_COOLDOWN"
  | "LATE_JOIN_PENALTY"
  | "DUPLICATE_SUBMISSION"
  | "IDEMPOTENCY_REPLAY"
  | "RATE_LIMITED"
  | "VALIDATION_ERROR"
  | "CONFLICT"
  | "NOT_FOUND"
  | "INTERNAL";

export interface ApiErrorDetail {
  code: ApiErrorCode;
  message: string;
}

export class ApiError extends Error {
  code: ApiErrorCode;

  constructor(detail: ApiErrorDetail) {
    super(detail.message);
    this.name = "ApiError";
    this.code = detail.code;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

const KNOWN_CODES: ReadonlySet<string> = new Set([
  "UNAUTHENTICATED",
  "FORBIDDEN",
  "NOT_ADMIN",
  "EVENT_NOT_FOUND",
  "EVENT_NOT_LIVE",
  "EVENT_PAUSED",
  "CHALLENGE_LOCKED",
  "OBJECTIVE_LOCKED",
  "INVALID_ANSWER",
  "TOO_MANY_ATTEMPTS",
  "COOLDOWN",
  "LOCATION_REJECTED",
  "POOR_ACCURACY",
  "TEAM_FULL",
  "MEMBERSHIP_COOLDOWN",
  "LATE_JOIN_PENALTY",
  "DUPLICATE_SUBMISSION",
  "IDEMPOTENCY_REPLAY",
  "RATE_LIMITED",
  "VALIDATION_ERROR",
  "CONFLICT",
  "NOT_FOUND",
  "INTERNAL"
]);

export function isApiErrorCode(value: unknown): value is ApiErrorCode {
  return typeof value === "string" && KNOWN_CODES.has(value);
}

function isApiErrorDetail(value: unknown): value is ApiErrorDetail {
  if (!isRecord(value)) return false;
  return isApiErrorCode(value["code"]) && typeof value["message"] === "string";
}

function fallbackForStatus(status: number): ApiErrorDetail {
  if (status === 401) return { code: "UNAUTHENTICATED", message: "Sign in to continue." };
  if (status === 403) return { code: "FORBIDDEN", message: "You do not have permission for this action." };
  if (status === 404) return { code: "NOT_FOUND", message: "The requested item was not found." };
  if (status === 429) return { code: "RATE_LIMITED", message: "Too many attempts. Wait a moment and retry." };
  if (status === 409) return { code: "CONFLICT", message: "This conflicts with the current state. Refresh and retry." };
  if (status === 422) return { code: "VALIDATION_ERROR", message: "The server could not accept that submission." };
  return { code: "INTERNAL", message: "Something went wrong. Retry in a moment." };
}

async function send<T>(
  path: string,
  init: RequestInit,
  guard: (value: unknown) => value is T
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      credentials: "include",
      headers: { Accept: "application/json" },
      ...init
    });
  } catch {
    throw new ApiError({ code: "INTERNAL", message: "Could not reach the server. Check your connection and retry." });
  }
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    throw new ApiError(fallbackForStatus(response.status));
  }
  if (!response.ok) {
    // The worker returns { code, message, details? } error envelopes.
    if (isApiErrorDetail(body)) throw new ApiError(body);
    if (isRecord(body) && isApiErrorDetail(body["error"])) throw new ApiError(body["error"]);
    throw new ApiError(fallbackForStatus(response.status));
  }
  if (!guard(body)) {
    throw new ApiError({ code: "INTERNAL", message: "The server returned an unexpected shape." });
  }
  return body;
}

export function apiGet<T>(path: string, guard: (value: unknown) => value is T): Promise<T> {
  return send(path, { method: "GET" }, guard);
}

export function apiPost<T>(
  path: string,
  body: unknown,
  guard: (value: unknown) => value is T
): Promise<T> {
  return send(
    path,
    {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify(body)
    },
    guard
  );
}

export function apiPatch<T>(
  path: string,
  body: unknown,
  guard: (value: unknown) => value is T
): Promise<T> {
  return send(
    path,
    {
      method: "PATCH",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify(body)
    },
    guard
  );
}

export function submitWithIdempotency<T>(
  path: string,
  body: unknown,
  guard: (value: unknown) => value is T
): Promise<T> {
  return send(
    path,
    {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "Idempotency-Key": crypto.randomUUID()
      },
      body: JSON.stringify(body)
    },
    guard
  );
}
