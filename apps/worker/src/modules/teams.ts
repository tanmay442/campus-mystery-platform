import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../env";
import { errorResponse, notImplemented } from "../lib/errors";

const eventIdParams = z.object({ eventId: z.string().min(1) });

const participantIdParams = z.object({
  participantId: z.string().min(1)
});

const inviteTokenParams = z.object({ token: z.string().min(1) });

const requestIdParams = z.object({ requestId: z.string().min(1) });

const createTeamBody = z
  .object({
    name: z.string().min(1).max(64)
  })
  .catchall(z.unknown());

const createInviteBody = z
  .object({
    expiresAt: z.string().datetime().optional()
  })
  .catchall(z.unknown());

export const teamsRouter = new Hono<AppEnv>();

teamsRouter.post("/api/events/:eventId/teams", async (c) => {
  const params = eventIdParams.safeParse({
    eventId: c.req.param("eventId")
  });
  if (params.success === false) {
    return errorResponse(c, "VALIDATION_ERROR", "Invalid event id");
  }
  const raw: unknown = await c.req.json().catch(() => ({}));
  const body = createTeamBody.safeParse(raw);
  if (body.success === false) {
    return errorResponse(c, "VALIDATION_ERROR", "A team name is required");
  }
  return notImplemented(c, "POST /api/events/:eventId/teams");
});

teamsRouter.post("/api/participants/:participantId/invites", async (c) => {
  const params = participantIdParams.safeParse({
    participantId: c.req.param("participantId")
  });
  if (params.success === false) {
    return errorResponse(c, "VALIDATION_ERROR", "Invalid participant id");
  }
  const raw: unknown = await c.req.json().catch(() => ({}));
  const body = createInviteBody.safeParse(raw);
  if (body.success === false) {
    return errorResponse(c, "VALIDATION_ERROR", "Invalid invite options");
  }
  return notImplemented(c, "POST /api/participants/:participantId/invites");
});

teamsRouter.post("/api/invites/:token/request", (c) => {
  const parsed = inviteTokenParams.safeParse({
    token: c.req.param("token")
  });
  if (parsed.success === false) {
    return errorResponse(c, "VALIDATION_ERROR", "Invalid invite token");
  }
  return notImplemented(c, "POST /api/invites/:token/request");
});

teamsRouter.post("/api/join-requests/:requestId/approve", (c) => {
  const parsed = requestIdParams.safeParse({
    requestId: c.req.param("requestId")
  });
  if (parsed.success === false) {
    return errorResponse(c, "VALIDATION_ERROR", "Invalid request id");
  }
  return notImplemented(c, "POST /api/join-requests/:requestId/approve");
});

teamsRouter.post("/api/join-requests/:requestId/reject", (c) => {
  const parsed = requestIdParams.safeParse({
    requestId: c.req.param("requestId")
  });
  if (parsed.success === false) {
    return errorResponse(c, "VALIDATION_ERROR", "Invalid request id");
  }
  return notImplemented(c, "POST /api/join-requests/:requestId/reject");
});
