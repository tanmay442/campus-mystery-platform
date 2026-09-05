import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../env";
import { errorResponse, notImplemented } from "../lib/errors";

const eventIdParams = z.object({ eventId: z.string().min(1) });

const eventListQuery = z
  .object({
    status: z
      .enum([
        "draft",
        "testing",
        "scheduled",
        "live",
        "paused",
        "completed",
        "archived"
      ])
      .optional()
  })
  .catchall(z.unknown());

const registerBody = z
  .object({
    participation: z.enum(["solo", "team"]).optional()
  })
  .catchall(z.unknown());

export const eventsRouter = new Hono<AppEnv>();

eventsRouter.get("/api/events", (c) => {
  const parsed = eventListQuery.safeParse(c.req.query());
  if (parsed.success === false) {
    return errorResponse(c, "VALIDATION_ERROR", "Invalid query parameters");
  }
  return notImplemented(c, "GET /api/events");
});

eventsRouter.get("/api/events/:eventId", (c) => {
  const parsed = eventIdParams.safeParse({
    eventId: c.req.param("eventId")
  });
  if (parsed.success === false) {
    return errorResponse(c, "VALIDATION_ERROR", "Invalid event id");
  }
  return notImplemented(c, "GET /api/events/:eventId");
});

eventsRouter.post("/api/events/:eventId/register", async (c) => {
  const params = eventIdParams.safeParse({
    eventId: c.req.param("eventId")
  });
  if (params.success === false) {
    return errorResponse(c, "VALIDATION_ERROR", "Invalid event id");
  }
  const raw: unknown = await c.req.json().catch(() => ({}));
  const body = registerBody.safeParse(raw);
  if (body.success === false) {
    return errorResponse(c, "VALIDATION_ERROR", "Invalid registration");
  }
  return notImplemented(c, "POST /api/events/:eventId/register");
});

eventsRouter.post("/api/events/:eventId/start", (c) => {
  const parsed = eventIdParams.safeParse({
    eventId: c.req.param("eventId")
  });
  if (parsed.success === false) {
    return errorResponse(c, "VALIDATION_ERROR", "Invalid event id");
  }
  return notImplemented(c, "POST /api/events/:eventId/start");
});

eventsRouter.get("/api/events/:eventId/state", (c) => {
  const parsed = eventIdParams.safeParse({
    eventId: c.req.param("eventId")
  });
  if (parsed.success === false) {
    return errorResponse(c, "VALIDATION_ERROR", "Invalid event id");
  }
  return notImplemented(c, "GET /api/events/:eventId/state");
});
