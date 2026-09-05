import { createMiddleware } from "hono/factory";
import type { AppEnv } from "../env";

export const idempotencyMiddleware = createMiddleware<AppEnv>(
  async (c, next) => {
    const key = c.req.header("Idempotency-Key");
    if (key !== undefined && key.length > 0) {
      c.set("idempotencyKey", key);
    }
    await next();
  }
);
