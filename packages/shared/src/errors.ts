import { z } from "zod";

export const errorCodeSchema = z.enum([
  "UNAUTHENTICATED",
  "FORBIDDEN",
  "NOT_ADMIN",
  "EVENT_NOT_FOUND",
  "EVENT_NOT_LIVE",
  "EVENT_PAUSED",
  "CHALLENGE_LOCKED",
  "OBJECTIVE_LOCKED",
  "INVALID_ANSWER",
  "TOO_MANY_ATTEMPTS",
  "COOLDOWN",
  "LOCATION_REJECTED",
  "POOR_ACCURACY",
  "TEAM_FULL",
  "MEMBERSHIP_COOLDOWN",
  "LATE_JOIN_PENALTY",
  "DUPLICATE_SUBMISSION",
  "IDEMPOTENCY_REPLAY",
  "RATE_LIMITED",
  "VALIDATION_ERROR",
  "CONFLICT",
  "NOT_FOUND",
  "INTERNAL"
]);

export type ErrorCode = z.infer<typeof errorCodeSchema>;

export const errorEnvelopeSchema = z.object({
  code: errorCodeSchema,
  message: z.string().min(1),
  details: z.record(z.string(), z.unknown()).optional()
});

export type ErrorEnvelope = z.infer<typeof errorEnvelopeSchema>;

export const HttpStatusForCode: Record<ErrorCode, number> = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_ADMIN: 403,
  EVENT_NOT_FOUND: 404,
  EVENT_NOT_LIVE: 409,
  EVENT_PAUSED: 409,
  CHALLENGE_LOCKED: 403,
  OBJECTIVE_LOCKED: 403,
  INVALID_ANSWER: 422,
  TOO_MANY_ATTEMPTS: 429,
  COOLDOWN: 429,
  LOCATION_REJECTED: 422,
  POOR_ACCURACY: 422,
  TEAM_FULL: 409,
  MEMBERSHIP_COOLDOWN: 429,
  LATE_JOIN_PENALTY: 409,
  DUPLICATE_SUBMISSION: 409,
  IDEMPOTENCY_REPLAY: 409,
  RATE_LIMITED: 429,
  VALIDATION_ERROR: 400,
  CONFLICT: 409,
  NOT_FOUND: 404,
  INTERNAL: 500
};
