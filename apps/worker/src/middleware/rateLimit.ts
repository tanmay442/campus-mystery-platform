import { createMiddleware } from "hono/factory";
import type { AppEnv } from "../env";
import { errorResponse } from "../lib/errors";

const WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_WINDOW = 60;
const MAX_KEYS = 10_000;

const hits = new Map<string, Array<number>>();

function routePattern(path: string, routePath: string | undefined): string {
  // The middleware pattern (e.g. /api/challenges/*/objectives/*/submit) is
  // already a stable bucket; fall back to normalizing id-like segments.
  if (routePath !== undefined && routePath.length > 0) {
    return routePath;
  }
  return path
    .replace(/\/[0-9a-fA-F-]{8,}\b/g, "/:id")
    .replace(/\/\d+(?=\/|$)/g, "/:id");
}

function prune(now: number): void {
  if (hits.size <= MAX_KEYS) {
    return;
  }
  for (const [key, times] of hits) {
    const recent = times.filter((time) => now - time < WINDOW_MS);
    if (recent.length === 0) {
      hits.delete(key);
    } else {
      hits.set(key, recent);
    }
    if (hits.size <= MAX_KEYS / 2) {
      return;
    }
  }
  if (hits.size > MAX_KEYS) {
    hits.clear();
  }
}

export const rateLimitMiddleware = createMiddleware<AppEnv>(
  async (c, next) => {
    const user = c.get("user");
    const key = `${user?.id ?? "anonymous"}:${c.req.method}:${routePattern(c.req.path, c.req.routePath)}`;
    const now = Date.now();
    const previous = hits.get(key) ?? [];
    const recent = previous.filter((time) => now - time < WINDOW_MS);
    if (recent.length >= MAX_REQUESTS_PER_WINDOW) {
      return errorResponse(c, "RATE_LIMITED", "Rate limit exceeded");
    }
    recent.push(now);
    hits.set(key, recent);
    prune(now);
    await next();
  }
);
