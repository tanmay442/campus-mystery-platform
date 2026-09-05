import { createMiddleware } from "hono/factory";
import type { AppEnv } from "../env";
import { errorResponse } from "../lib/errors";

const WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_WINDOW = 60;

const hits = new Map<string, Array<number>>();

export const rateLimitMiddleware = createMiddleware<AppEnv>(
  async (c, next) => {
    const user = c.get("user");
    const key = `${user?.id ?? "anonymous"}:${c.req.method}:${c.req.path}`;
    const now = Date.now();
    const previous = hits.get(key) ?? [];
    const recent = previous.filter((time) => now - time < WINDOW_MS);
    if (recent.length >= MAX_REQUESTS_PER_WINDOW) {
      return errorResponse(c, "RATE_LIMITED", "Rate limit exceeded");
    }
    recent.push(now);
    hits.set(key, recent);
    await next();
  }
);
