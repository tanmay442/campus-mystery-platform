export type ApiErrorCode =
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "VALIDATION_ERROR"
  | "RATE_LIMITED"
  | "EVENT_PAUSED"
  | "COOLDOWN"
  | "LOCATION_REJECTED"
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

export function isApiErrorCode(value: unknown): value is ApiErrorCode {
  return (
    value === "UNAUTHENTICATED" ||
    value === "FORBIDDEN" ||
    value === "VALIDATION_ERROR" ||
    value === "RATE_LIMITED" ||
    value === "EVENT_PAUSED" ||
    value === "COOLDOWN" ||
    value === "LOCATION_REJECTED" ||
    value === "CONFLICT" ||
    value === "NOT_FOUND" ||
    value === "INTERNAL"
  );
}

function isApiErrorDetail(value: unknown): value is ApiErrorDetail {
  if (!isRecord(value)) return false;
  return isApiErrorCode(value["code"]) && typeof value["message"] === "string";
}

async function parseEnvelope<T>(
  response: Response,
  guard: (value: unknown) => value is T
): Promise<T> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new ApiError({ code: "INTERNAL", message: "The server returned an unreadable response." });
  }
  if (!isRecord(body)) {
    throw new ApiError({ code: "INTERNAL", message: "The server returned an unreadable response." });
  }
  if ("error" in body) {
    const detail = body["error"];
    if (isApiErrorDetail(detail)) throw new ApiError(detail);
    throw new ApiError({ code: "INTERNAL", message: "The server returned an unknown error." });
  }
  if (!("data" in body) || !guard(body["data"])) {
    throw new ApiError({ code: "INTERNAL", message: "The server returned an unexpected shape." });
  }
  return body["data"];
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
  if (response.status === 401) {
    throw new ApiError({ code: "UNAUTHENTICATED", message: "Sign in to continue." });
  }
  if (response.status === 403) {
    throw new ApiError({ code: "FORBIDDEN", message: "You do not have permission for this action." });
  }
  if (response.status === 404) {
    throw new ApiError({ code: "NOT_FOUND", message: "The requested item was not found." });
  }
  if (response.status === 429) {
    throw new ApiError({ code: "RATE_LIMITED", message: "Too many attempts. Wait a moment and retry." });
  }
  if (response.status === 409) {
    throw new ApiError({ code: "CONFLICT", message: "This conflicts with the current state. Refresh and retry." });
  }
  return parseEnvelope(response, guard);
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
