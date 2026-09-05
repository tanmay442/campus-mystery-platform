import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../env";
import { errorResponse, notImplemented } from "../lib/errors";

const eventIdParams = z.object({ eventId: z.string().min(1) });

const leaderboardQuery = z
  .object({
    scope: z.enum(["solo", "team"]).optional()
  })
  .catchall(z.unknown());

export const leaderboardRouter = new Hono<AppEnv>();

leaderboardRouter.get("/api/events/:eventId/leaderboard", (c) => {
  const params = eventIdParams.safeParse({
    eventId: c.req.param("eventId")
  });
  if (params.success === false) {
    return errorResponse(c, "VALIDATION_ERROR", "Invalid event id");
  }
  const query = leaderboardQuery.safeParse(c.req.query());
  if (query.success === false) {
    return errorResponse(c, "VALIDATION_ERROR", "Invalid query parameters");
  }
  return notImplemented(c, "GET /api/events/:eventId/leaderboard");
});
