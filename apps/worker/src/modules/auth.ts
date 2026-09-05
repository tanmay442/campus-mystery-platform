import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../env";
import { errorResponse, notImplemented } from "../lib/errors";

const updateProfileBody = z
  .object({
    username: z.string().min(1).max(32).optional(),
    displayName: z.string().max(64).optional(),
    presenceVisibility: z.enum(["visible", "count_only", "hidden"]).optional()
  })
  .catchall(z.unknown());

export const authRouter = new Hono<AppEnv>();

authRouter.get("/api/me", (c) => {
  return notImplemented(c, "GET /api/me");
});

authRouter.patch("/api/me", async (c) => {
  const raw: unknown = await c.req.json().catch(() => ({}));
  const parsed = updateProfileBody.safeParse(raw);
  if (parsed.success === false) {
    return errorResponse(c, "VALIDATION_ERROR", "Invalid profile update");
  }
  return notImplemented(c, "PATCH /api/me");
});
