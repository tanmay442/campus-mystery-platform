import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../env";
import { errorResponse, notImplemented } from "../lib/errors";

const objectiveParams = z.object({
  challengeId: z.string().min(1),
  objectiveKey: z.string().min(1)
});

const readingSchema = z
  .object({
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    accuracyMeters: z.number().min(0),
    capturedAt: z.string().datetime()
  })
  .catchall(z.unknown());

const locationSessionBody = z
  .object({
    readings: z.array(readingSchema).min(1).optional()
  })
  .catchall(z.unknown());

const verifyLocationBody = z
  .object({
    readings: z.array(readingSchema).min(1),
    idempotencyKey: z.string().min(1).optional()
  })
  .catchall(z.unknown());

export const locationRouter = new Hono<AppEnv>();

locationRouter.post(
  "/api/challenges/:challengeId/objectives/:objectiveKey/location-session",
  async (c) => {
    const params = objectiveParams.safeParse({
      challengeId: c.req.param("challengeId"),
      objectiveKey: c.req.param("objectiveKey")
    });
    if (params.success === false) {
      return errorResponse(c, "VALIDATION_ERROR", "Invalid objective ref");
    }
    const raw: unknown = await c.req.json().catch(() => ({}));
    const body = locationSessionBody.safeParse(raw);
    if (body.success === false) {
      return errorResponse(c, "VALIDATION_ERROR", "Invalid location session");
    }
    return notImplemented(
      c,
      "POST /api/challenges/:challengeId/objectives/:objectiveKey/location-session"
    );
  }
);

locationRouter.post(
  "/api/challenges/:challengeId/objectives/:objectiveKey/verify-location",
  async (c) => {
    const params = objectiveParams.safeParse({
      challengeId: c.req.param("challengeId"),
      objectiveKey: c.req.param("objectiveKey")
    });
    if (params.success === false) {
      return errorResponse(c, "VALIDATION_ERROR", "Invalid objective ref");
    }
    const raw: unknown = await c.req.json().catch(() => ({}));
    const body = verifyLocationBody.safeParse(raw);
    if (body.success === false) {
      return errorResponse(
        c,
        "VALIDATION_ERROR",
        "Location readings are required"
      );
    }
    return notImplemented(
      c,
      "POST /api/challenges/:challengeId/objectives/:objectiveKey/verify-location"
    );
  }
);
