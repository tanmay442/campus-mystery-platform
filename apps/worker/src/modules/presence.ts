import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../env";
import { errorResponse, notImplemented } from "../lib/errors";

const eventIdParams = z.object({ eventId: z.string().min(1) });

const presenceBody = z
  .object({
    visibility: z.enum(["visible", "count_only", "hidden"]).optional(),
    zone: z.string().max(64).optional()
  })
  .catchall(z.unknown());

const pingBody = z
  .object({
    signal: z.string().min(1).max(32),
    target: z.string().max(64).optional()
  })
  .catchall(z.unknown());

const pingQuery = z
  .object({
    since: z.string().datetime().optional()
  })
  .catchall(z.unknown());

const nearbyQuery = z
  .object({
    challengeId: z.string().min(1).optional()
  })
  .catchall(z.unknown());

export const presenceRouter = new Hono<AppEnv>();

presenceRouter.post("/api/events/:eventId/presence", async (c) => {
  const params = eventIdParams.safeParse({
    eventId: c.req.param("eventId")
  });
  if (params.success === false) {
    return errorResponse(c, "VALIDATION_ERROR", "Invalid event id");
  }
  const raw: unknown = await c.req.json().catch(() => ({}));
  const body = presenceBody.safeParse(raw);
  if (body.success === false) {
    return errorResponse(c, "VALIDATION_ERROR", "Invalid presence update");
  }
  return notImplemented(c, "POST /api/events/:eventId/presence");
});

presenceRouter.get("/api/events/:eventId/nearby", (c) => {
  const params = eventIdParams.safeParse({
    eventId: c.req.param("eventId")
  });
  if (params.success === false) {
    return errorResponse(c, "VALIDATION_ERROR", "Invalid event id");
  }
  const query = nearbyQuery.safeParse(c.req.query());
  if (query.success === false) {
    return errorResponse(c, "VALIDATION_ERROR", "Invalid query parameters");
  }
  return notImplemented(c, "GET /api/events/:eventId/nearby");
});

presenceRouter.post("/api/events/:eventId/pings", async (c) => {
  const params = eventIdParams.safeParse({
    eventId: c.req.param("eventId")
  });
  if (params.success === false) {
    return errorResponse(c, "VALIDATION_ERROR", "Invalid event id");
  }
  const raw: unknown = await c.req.json().catch(() => ({}));
  const body = pingBody.safeParse(raw);
  if (body.success === false) {
    return errorResponse(c, "VALIDATION_ERROR", "A ping signal is required");
  }
  return notImplemented(c, "POST /api/events/:eventId/pings");
});

presenceRouter.get("/api/events/:eventId/pings", (c) => {
  const params = eventIdParams.safeParse({
    eventId: c.req.param("eventId")
  });
  if (params.success === false) {
    return errorResponse(c, "VALIDATION_ERROR", "Invalid event id");
  }
  const query = pingQuery.safeParse(c.req.query());
  if (query.success === false) {
    return errorResponse(c, "VALIDATION_ERROR", "Invalid query parameters");
  }
  return notImplemented(c, "GET /api/events/:eventId/pings");
});
