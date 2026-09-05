import type { Context } from "hono";
import type { ErrorCode, ErrorEnvelope } from "@campus/shared";
import { HttpStatusForCode } from "@campus/shared";
import type { AppEnv } from "../env";

export type AppContext = Context<AppEnv>;

interface ErrorOptions {
  status?: number;
  details?: Record<string, unknown>;
}

export function errorResponse(
  _c: AppContext,
  code: ErrorCode,
  message: string,
  options?: ErrorOptions
): Response {
  const status = options?.status ?? HttpStatusForCode[code];
  const body: ErrorEnvelope =
    options?.details === undefined
      ? { code, message }
      : { code, message, details: options.details };
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" }
  });
}

export function notImplemented(c: AppContext, route: string): Response {
  return errorResponse(c, "INTERNAL", `Not implemented: ${route}`, {
    status: 501
  });
}
