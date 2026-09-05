import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../env";
import { errorResponse, notImplemented } from "../lib/errors";

const participantIdParams = z.object({
  participantId: z.string().min(1)
});

const transferCaptainBody = z
  .object({
    newCaptainUserId: z.string().min(1)
  })
  .catchall(z.unknown());

export const participantsRouter = new Hono<AppEnv>();

participantsRouter.post("/api/participants/:participantId/leave", (c) => {
  const parsed = participantIdParams.safeParse({
    participantId: c.req.param("participantId")
  });
  if (parsed.success === false) {
    return errorResponse(c, "VALIDATION_ERROR", "Invalid participant id");
  }
  return notImplemented(c, "POST /api/participants/:participantId/leave");
});

participantsRouter.post(
  "/api/participants/:participantId/transfer-captain",
  async (c) => {
    const params = participantIdParams.safeParse({
      participantId: c.req.param("participantId")
    });
    if (params.success === false) {
      return errorResponse(c, "VALIDATION_ERROR", "Invalid participant id");
    }
    const raw: unknown = await c.req.json().catch(() => ({}));
    const body = transferCaptainBody.safeParse(raw);
    if (body.success === false) {
      return errorResponse(
        c,
        "VALIDATION_ERROR",
        "A new captain user id is required"
      );
    }
    return notImplemented(
      c,
      "POST /api/participants/:participantId/transfer-captain"
    );
  }
);
