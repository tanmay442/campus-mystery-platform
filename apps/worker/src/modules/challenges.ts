import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../env";
import { errorResponse, notImplemented } from "../lib/errors";

const challengeIdParams = z.object({
  challengeId: z.string().min(1)
});

const objectiveParams = z.object({
  challengeId: z.string().min(1),
  objectiveKey: z.string().min(1)
});

const hintParams = z.object({
  challengeId: z.string().min(1),
  hintKey: z.string().min(1)
});

const submitBody = z
  .object({
    answer: z.unknown().optional(),
    idempotencyKey: z.string().min(1).optional()
  })
  .catchall(z.unknown());

export const challengesRouter = new Hono<AppEnv>();

challengesRouter.get("/api/challenges/:challengeId", (c) => {
  const parsed = challengeIdParams.safeParse({
    challengeId: c.req.param("challengeId")
  });
  if (parsed.success === false) {
    return errorResponse(c, "VALIDATION_ERROR", "Invalid challenge id");
  }
  return notImplemented(c, "GET /api/challenges/:challengeId");
});

challengesRouter.post(
  "/api/challenges/:challengeId/objectives/:objectiveKey/submit",
  async (c) => {
    const params = objectiveParams.safeParse({
      challengeId: c.req.param("challengeId"),
      objectiveKey: c.req.param("objectiveKey")
    });
    if (params.success === false) {
      return errorResponse(c, "VALIDATION_ERROR", "Invalid objective ref");
    }
    const raw: unknown = await c.req.json().catch(() => ({}));
    const body = submitBody.safeParse(raw);
    if (body.success === false) {
      return errorResponse(c, "VALIDATION_ERROR", "Invalid submission");
    }
    return notImplemented(
      c,
      "POST /api/challenges/:challengeId/objectives/:objectiveKey/submit"
    );
  }
);

challengesRouter.post(
  "/api/challenges/:challengeId/hints/:hintKey/unlock",
  (c) => {
    const parsed = hintParams.safeParse({
      challengeId: c.req.param("challengeId"),
      hintKey: c.req.param("hintKey")
    });
    if (parsed.success === false) {
      return errorResponse(c, "VALIDATION_ERROR", "Invalid hint ref");
    }
    return notImplemented(
      c,
      "POST /api/challenges/:challengeId/hints/:hintKey/unlock"
    );
  }
);
