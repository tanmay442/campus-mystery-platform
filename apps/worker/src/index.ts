import { Hono } from "hono";
import type { AppEnv } from "./env";
import { errorResponse } from "./lib/errors";
import { nowIso } from "./lib/time";
import { authMiddleware } from "./middleware/auth";
import { idempotencyMiddleware } from "./middleware/idempotency";
import { rateLimitMiddleware } from "./middleware/rateLimit";
import { requireAdmin } from "./middleware/requireAdmin";
import { adminRouter } from "./modules/admin";
import { authRouter } from "./modules/auth";
import { challengesRouter } from "./modules/challenges";
import { eventsRouter } from "./modules/events";
import { leaderboardRouter } from "./modules/leaderboard";
import { locationRouter } from "./modules/location";
import { participantsRouter } from "./modules/participants";
import { presenceRouter } from "./modules/presence";
import { rewardsRouter } from "./modules/rewards";
import { teamsRouter } from "./modules/teams";

const app = new Hono<AppEnv>();

app.use("/api/*", authMiddleware);
app.use("/api/*", idempotencyMiddleware);
app.use(
  "/api/challenges/*/objectives/*/submit",
  rateLimitMiddleware
);
app.use(
  "/api/challenges/*/objectives/*/location-session",
  rateLimitMiddleware
);
app.use(
  "/api/challenges/*/objectives/*/verify-location",
  rateLimitMiddleware
);
app.use("/api/events/*/presence", rateLimitMiddleware);
app.use("/api/events/*/pings", rateLimitMiddleware);
app.use("/api/events/*/teams", rateLimitMiddleware);
app.use("/api/participants/*/invites", rateLimitMiddleware);
app.use("/api/invites/*/request", rateLimitMiddleware);
app.use("/api/join-requests/*/approve", rateLimitMiddleware);
app.use("/api/join-requests/*/reject", rateLimitMiddleware);
app.use("/api/admin/*", requireAdmin);
app.use("/api/admin/*", rateLimitMiddleware);

app.get("/api/health", (c) => {
  return c.json({
    ok: true,
    env: c.env.ENVIRONMENT ?? "development",
    time: nowIso()
  });
});

app.route("/", authRouter);
app.route("/", eventsRouter);
app.route("/", participantsRouter);
app.route("/", teamsRouter);
app.route("/", challengesRouter);
app.route("/", locationRouter);
app.route("/", rewardsRouter);
app.route("/", leaderboardRouter);
app.route("/", presenceRouter);
app.route("/", adminRouter);

app.notFound(async (c) => {
  const isApiRoute = c.req.path.startsWith("/api/");
  if (isApiRoute === false && c.env.ASSETS !== undefined) {
    try {
      return await c.env.ASSETS.fetch(c.req.raw);
    } catch {
      return errorResponse(c, "NOT_FOUND", "Not found");
    }
  }
  return errorResponse(c, "NOT_FOUND", "Not found");
});

app.onError((_err, c) => {
  return errorResponse(c, "INTERNAL", "Unexpected error");
});

export default app;
