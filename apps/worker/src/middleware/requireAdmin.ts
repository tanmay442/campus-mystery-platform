import { createMiddleware } from "hono/factory";
import type { AppEnv } from "../env";
import { timingSafeEqual } from "../lib/crypto";
import { errorResponse } from "../lib/errors";

function allowlistMatches(email: string, allowlist: string): boolean {
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

export const requireAdmin = createMiddleware<AppEnv>(async (c, next) => {
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
