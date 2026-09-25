import { createMiddleware } from "hono/factory";
import { z } from "zod";
import type { AppEnv } from "../env";
import { sha256Hex, timingSafeEqual } from "../lib/crypto";
import type { AppContext } from "../lib/errors";
import { errorResponse } from "../lib/errors";

/** Scoped programmatic access (§17.3). Session admins are never scope-checked. */
export const SERVICE_SCOPES = [
  "events:read",
  "events:write",
  "challenges:write",
  "participants:moderate"
] as const;

export type ServiceScope = (typeof SERVICE_SCOPES)[number];

export const serviceScopeSchema = z.enum(SERVICE_SCOPES);

const serviceTokenRowSchema = z.object({
  id: z.string(),
  name: z.string(),
  token_hash: z.string(),
  scopes_json: z.string(),
  created_by: z.string(),
  revoked_at: z.string().nullable(),
  created_at: z.string()
});

export interface ServiceIdentity {
  id: string;
  name: string;
  scopes: ServiceScope[];
  ownerId: string;
}

/**
 * Required scope per admin route. Service-token management itself is
 * session-only (returns null) so automation can never mint its own access.
 */
export function scopeForAdminRequest(method: string, path: string): ServiceScope | null {
  if (path === "/api/admin/audit" && method === "GET") {
    return "events:read";
  }
  if (path.startsWith("/api/admin/service-tokens")) {
    return null;
  }
  if (
    path.startsWith("/api/admin/challenges/") ||
    (path.includes("/challenges") && path.startsWith("/api/admin/events/"))
  ) {
    return "challenges:write";
  }
  if (
    path.startsWith("/api/admin/objectives/") ||
    path.startsWith("/api/admin/participants/") ||
    path.startsWith("/api/admin/penalties/")
  ) {
    return "participants:moderate";
  }
  if (path.startsWith("/api/admin/")) {
    return "events:write";
  }
  return null;
}

export function allowlistMatches(email: string, allowlist: string): boolean {
  const candidates = allowlist
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0);
  let matched = false;
  for (const candidate of candidates) {
    if (timingSafeEqual(email, candidate)) {
      matched = true;
    }
  }
  return matched;
}

async function serviceIdentity(
  c: AppContext,
  token: string
): Promise<ServiceIdentity | null> {
  const hash = await sha256Hex(token);
  const raw: unknown = await c.env.DB.prepare(
    "SELECT id, name, token_hash, scopes_json, created_by, revoked_at, created_at FROM service_tokens WHERE token_hash = ? LIMIT 1"
  )
    .bind(hash)
    .first();
  const parsed = serviceTokenRowSchema.safeParse(raw);
  if (parsed.success === false || parsed.data.revoked_at !== null) {
    return null;
  }
  let decoded: unknown;
  try {
    decoded = JSON.parse(parsed.data.scopes_json);
  } catch {
    return null;
  }
  const scopes = z.array(serviceScopeSchema).safeParse(decoded);
  if (scopes.success === false) {
    return null;
  }
  return {
    id: parsed.data.id,
    name: parsed.data.name,
    scopes: scopes.data,
    ownerId: parsed.data.created_by
  };
}

export const requireAdmin = createMiddleware<AppEnv>(async (c, next) => {
  const header = c.req.header("Authorization") ?? "";
  if (header.toLowerCase().startsWith("bearer ")) {
    const token = header.slice("bearer ".length).trim();
    if (token.length === 0) {
      return errorResponse(c, "UNAUTHENTICATED", "Authentication required");
    }
    const identity = await serviceIdentity(c, token);
    if (identity === null) {
      return errorResponse(c, "UNAUTHENTICATED", "Invalid service token");
    }
    const required = scopeForAdminRequest(c.req.method, c.req.path);
    if (required === null) {
      return errorResponse(c, "FORBIDDEN", "Service tokens cannot manage tokens");
    }
    if (identity.scopes.includes(required) === false) {
      return errorResponse(c, "FORBIDDEN", `Service token lacks scope ${required}`);
    }
    // Downstream handlers keep using c.get("user").id for audit ownership;
    // the owner is the admin who issued the token.
    c.set("user", { id: identity.ownerId, email: "", emailVerified: true });
    c.set("serviceToken", {
      id: identity.id,
      name: identity.name,
      scopes: identity.scopes,
      ownerId: identity.ownerId
    });
    await next();
    return;
  }
  const user = c.get("user");
  if (user === undefined) {
    return errorResponse(c, "UNAUTHENTICATED", "Authentication required");
  }
  if (user.emailVerified === false) {
    return errorResponse(c, "FORBIDDEN", "A verified email is required");
  }
  const isAdmin = allowlistMatches(
    user.email.toLowerCase(),
    c.env.ADMIN_EMAILS ?? ""
  );
  if (isAdmin === false) {
    return errorResponse(c, "NOT_ADMIN", "Administrator access required");
  }
  await next();
});
