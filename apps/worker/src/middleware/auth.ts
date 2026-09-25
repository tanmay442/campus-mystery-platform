/** Session-cookie authentication: validates cmp_session and attaches the user. */
import { getCookie } from "hono/cookie";
import { createMiddleware } from "hono/factory";
import { z } from "zod";
import type { AppEnv } from "../env";
import { sha256Hex } from "../lib/crypto";
import { errorResponse } from "../lib/errors";
import { nowIso } from "../lib/time";

const SESSION_COOKIE = "cmp_session";

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

// Sliding refreshes write to D1; throttle them so 15s polling from hundreds
// of players does not become continuous writes. Sessions still expire exactly.
const SESSION_REFRESH_MIN_MS = 5 * 60 * 1000;

const PUBLIC_ROUTES = new Set([
  "GET /api/health",
  "POST /api/auth/login",
  "POST /api/auth/logout",
  "GET /api/auth/username-availability",
]);

const SESSION_LOOKUP_SQL = [
  "SELECT s.id AS session_id, s.revoked_at AS revoked_at,",
  "s.expires_at AS expires_at, s.last_seen_at AS last_seen_at,",
  "u.id AS user_id, u.email AS user_email,",
  "u.email_verified AS user_email_verified, u.username AS user_username",
  "FROM sessions s INNER JOIN users u ON s.user_id = u.id",
  "WHERE s.token_hash = ?",
].join(" ");

const SLIDING_REFRESH_SQL =
  "UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE id = ?";

const sessionRowSchema = z.object({
  session_id: z.string().min(1),
  revoked_at: z.string().nullable(),
  expires_at: z.string().min(1),
  last_seen_at: z.string().optional(),
  user_id: z.string().min(1),
  user_email: z.string().email(),
  user_email_verified: z.number().int(),
  user_username: z.string().min(1),
});

export const authMiddleware = createMiddleware<AppEnv>(async (c, next) => {
  const token = getCookie(c, SESSION_COOKIE);
  if (token === undefined || token.length === 0) {
    await next();
    return;
  }
  const tokenHash = await sha256Hex(token);
  const raw: unknown = await c.env.DB.prepare(SESSION_LOOKUP_SQL)
    .bind(tokenHash)
    .first();
  const parsed = sessionRowSchema.safeParse(raw);
  const now = nowIso();
  if (
    parsed.success === false ||
    parsed.data.revoked_at !== null ||
    parsed.data.expires_at <= now
  ) {
    if (PUBLIC_ROUTES.has(`${c.req.method} ${c.req.path}`)) {
      await next();
      return;
    }
    return errorResponse(c, "UNAUTHENTICATED", "Authentication required");
  }
  const row = parsed.data;
  const lastSeenMs = row.last_seen_at === undefined ? NaN : Date.parse(row.last_seen_at);
  if (Number.isNaN(lastSeenMs) || Date.now() - lastSeenMs >= SESSION_REFRESH_MIN_MS) {
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
    await c.env.DB.prepare(SLIDING_REFRESH_SQL)
      .bind(now, expiresAt, row.session_id)
      .run();
  }
  c.set("user", {
    id: row.user_id,
    email: row.user_email,
    emailVerified: row.user_email_verified === 1,
  });
  c.set("sessionToken", token);
  await next();
});
