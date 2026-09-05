import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../env";
import { errorResponse, notImplemented } from "../lib/errors";

const eventIdParams = z.object({ eventId: z.string().min(1) });

const challengeIdParams = z.object({
  challengeId: z.string().min(1)
});

const objectiveIdParams = z.object({
  objectiveId: z.string().min(1)
});

const participantIdParams = z.object({
  participantId: z.string().min(1)
});

const penaltyIdParams = z.object({
  penaltyId: z.string().min(1)
});

const passthroughBody = z.object({}).catchall(z.unknown());

const auditQuery = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).optional(),
    cursor: z.string().min(1).optional()
  })
  .catchall(z.unknown());

export const adminRouter = new Hono<AppEnv>();

adminRouter.post("/api/admin/events", async (c) => {
  const raw: unknown = await c.req.json().catch(() => ({}));
  const body = passthroughBody.safeParse(raw);
  if (body.success === false) {
    return errorResponse(c, "VALIDATION_ERROR", "Invalid event payload");
  }
  return notImplemented(c, "POST /api/admin/events");
});

adminRouter.patch("/api/admin/events/:eventId", async (c) => {
  const params = eventIdParams.safeParse({
    eventId: c.req.param("eventId")
  });
  if (params.success === false) {
    return errorResponse(c, "VALIDATION_ERROR", "Invalid event id");
  }
  const raw: unknown = await c.req.json().catch(() => ({}));
  const body = passthroughBody.safeParse(raw);
  if (body.success === false) {
    return errorResponse(c, "VALIDATION_ERROR", "Invalid event payload");
  }
  return notImplemented(c, "PATCH /api/admin/events/:eventId");
});

adminRouter.post("/api/admin/events/:eventId/duplicate", (c) => {
  const parsed = eventIdParams.safeParse({
    eventId: c.req.param("eventId")
  });
  if (parsed.success === false) {
    return errorResponse(c, "VALIDATION_ERROR", "Invalid event id");
  }
  return notImplemented(c, "POST /api/admin/events/:eventId/duplicate");
});

adminRouter.post("/api/admin/events/:eventId/publish", (c) => {
  const parsed = eventIdParams.safeParse({
    eventId: c.req.param("eventId")
  });
  if (parsed.success === false) {
    return errorResponse(c, "VALIDATION_ERROR", "Invalid event id");
  }
  return notImplemented(c, "POST /api/admin/events/:eventId/publish");
});

adminRouter.post("/api/admin/events/:eventId/pause", (c) => {
  const parsed = eventIdParams.safeParse({
    eventId: c.req.param("eventId")
  });
  if (parsed.success === false) {
    return errorResponse(c, "VALIDATION_ERROR", "Invalid event id");
  }
  return notImplemented(c, "POST /api/admin/events/:eventId/pause");
});

adminRouter.post("/api/admin/events/:eventId/resume", (c) => {
  const parsed = eventIdParams.safeParse({
    eventId: c.req.param("eventId")
  });
  if (parsed.success === false) {
    return errorResponse(c, "VALIDATION_ERROR", "Invalid event id");
  }
  return notImplemented(c, "POST /api/admin/events/:eventId/resume");
});

adminRouter.post("/api/admin/events/:eventId/end", (c) => {
  const parsed = eventIdParams.safeParse({
    eventId: c.req.param("eventId")
  });
  if (parsed.success === false) {
    return errorResponse(c, "VALIDATION_ERROR", "Invalid event id");
  }
  return notImplemented(c, "POST /api/admin/events/:eventId/end");
});

adminRouter.post(
  "/api/admin/events/:eventId/challenges",
  async (c) => {
    const params = eventIdParams.safeParse({
      eventId: c.req.param("eventId")
    });
    if (params.success === false) {
      return errorResponse(c, "VALIDATION_ERROR", "Invalid event id");
    }
    const raw: unknown = await c.req.json().catch(() => ({}));
    const body = passthroughBody.safeParse(raw);
    if (body.success === false) {
      return errorResponse(c, "VALIDATION_ERROR", "Invalid challenge payload");
    }
    return notImplemented(c, "POST /api/admin/events/:eventId/challenges");
  }
);

adminRouter.patch("/api/admin/challenges/:challengeId", async (c) => {
  const params = challengeIdParams.safeParse({
    challengeId: c.req.param("challengeId")
  });
  if (params.success === false) {
    return errorResponse(c, "VALIDATION_ERROR", "Invalid challenge id");
  }
  const raw: unknown = await c.req.json().catch(() => ({}));
  const body = passthroughBody.safeParse(raw);
  if (body.success === false) {
    return errorResponse(c, "VALIDATION_ERROR", "Invalid challenge payload");
  }
  return notImplemented(c, "PATCH /api/admin/challenges/:challengeId");
});

adminRouter.delete("/api/admin/challenges/:challengeId", (c) => {
  const parsed = challengeIdParams.safeParse({
    challengeId: c.req.param("challengeId")
  });
  if (parsed.success === false) {
    return errorResponse(c, "VALIDATION_ERROR", "Invalid challenge id");
  }
  return notImplemented(c, "DELETE /api/admin/challenges/:challengeId");
});

adminRouter.post(
  "/api/admin/objectives/:objectiveId/manual-completion",
  async (c) => {
    const params = objectiveIdParams.safeParse({
      objectiveId: c.req.param("objectiveId")
    });
    if (params.success === false) {
      return errorResponse(c, "VALIDATION_ERROR", "Invalid objective id");
    }
    const raw: unknown = await c.req.json().catch(() => ({}));
    const body = passthroughBody.safeParse(raw);
    if (body.success === false) {
      return errorResponse(c, "VALIDATION_ERROR", "Invalid completion payload");
    }
    return notImplemented(
      c,
      "POST /api/admin/objectives/:objectiveId/manual-completion"
    );
  }
);

adminRouter.post(
  "/api/admin/participants/:participantId/penalties",
  async (c) => {
    const params = participantIdParams.safeParse({
      participantId: c.req.param("participantId")
    });
    if (params.success === false) {
      return errorResponse(c, "VALIDATION_ERROR", "Invalid participant id");
    }
    const raw: unknown = await c.req.json().catch(() => ({}));
    const body = passthroughBody.safeParse(raw);
    if (body.success === false) {
      return errorResponse(c, "VALIDATION_ERROR", "Invalid penalty payload");
    }
    return notImplemented(
      c,
      "POST /api/admin/participants/:participantId/penalties"
    );
  }
);

adminRouter.post("/api/admin/penalties/:penaltyId/waive", (c) => {
  const parsed = penaltyIdParams.safeParse({
    penaltyId: c.req.param("penaltyId")
  });
  if (parsed.success === false) {
    return errorResponse(c, "VALIDATION_ERROR", "Invalid penalty id");
  }
  return notImplemented(c, "POST /api/admin/penalties/:penaltyId/waive");
});

adminRouter.post(
  "/api/admin/events/:eventId/announcements",
  async (c) => {
    const params = eventIdParams.safeParse({
      eventId: c.req.param("eventId")
    });
    if (params.success === false) {
      return errorResponse(c, "VALIDATION_ERROR", "Invalid event id");
    }
    const raw: unknown = await c.req.json().catch(() => ({}));
    const body = passthroughBody.safeParse(raw);
    if (body.success === false) {
      return errorResponse(
        c,
        "VALIDATION_ERROR",
        "Invalid announcement payload"
      );
    }
    return notImplemented(
      c,
      "POST /api/admin/events/:eventId/announcements"
    );
  }
);

adminRouter.get("/api/admin/audit", (c) => {
  const query = auditQuery.safeParse(c.req.query());
  if (query.success === false) {
    return errorResponse(c, "VALIDATION_ERROR", "Invalid query parameters");
  }
  return notImplemented(c, "GET /api/admin/audit");
});
