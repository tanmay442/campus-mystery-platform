import { createMiddleware } from "hono/factory";
import type { AppEnv } from "../env";

function parseSessionCookie(header: string | undefined): string | undefined {
  if (header === undefined || header.length === 0) {
    return undefined;
  }
  const parts = header.split(";");
  for (const part of parts) {
    const trimmed = part.trim();
    if (trimmed.startsWith("session=")) {
      const value = trimmed.slice("session=".length).trim();
      if (value.length > 0) {
        return value;
      }
    }
  }
  return undefined;
}

export const authMiddleware = createMiddleware<AppEnv>(async (c, next) => {
  const token = parseSessionCookie(c.req.header("Cookie"));
  if (token !== undefined) {
    c.set("sessionToken", token);
  }
  await next();
});
