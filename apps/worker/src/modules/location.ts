/** Phase 1 location sessions and server-side geofence verification. */

import { Hono } from "hono";
import { haversineMeters, isChallengeUnlocked, verifyLocationBodySchema } from "@campus/shared";
import type { LocationReading } from "@campus/shared";
import { z } from "zod";
import type { AppEnv } from "../env";
import {
  completeObjective,
  deriveObjectiveStatus,
  eventGateStatus,
  getActiveParticipant,
  getProgressByIdempotencyKey,
  getProgressRows,
  listChallengesByEvent,
  loadChallengeById,
  loadEventById,
  loadProgressionSnapshot,
  parseConfiguration,
  readProgressData,
  resolveRequestUser
} from "./challenges";
import type { CompletionResult, ProgressData } from "./challenges";
import { errorResponse } from "../lib/errors";
import { nowIso } from "../lib/time";

const MAX_IDEMPOTENCY_KEY_LENGTH = 128;
const FUTURE_CLOCK_SKEW_MS = 5000;

const objectiveParams = z.object({
  challengeId: z.string().min(1),
  objectiveKey: z.string().min(1)
});

const locationSessionBody = z
  .object({
    readings: z.array(z.unknown()).min(1).optional()
  })
  .catchall(z.unknown());

interface VerifiedReadings {
  selected: LocationReading[];
  maxDistanceMeters: number;
  worstAccuracyMeters: number;
}

export function selectVerifyReadings(
  readings: LocationReading[],
  requiredCount: number
): LocationReading[] {
  return [...readings]
    .sort((left, right) => Date.parse(left.capturedAt) - Date.parse(right.capturedAt))
    .slice(Math.max(0, readings.length - requiredCount));
}

export function evaluateLocationReadings(
  readings: LocationReading[],
  targetLatitude: number,
  targetLongitude: number,
  radiusMeters: number,
  maximumAccuracyMeters: number,
  readingsExpireAfterSeconds: number,
  collectionDurationSeconds: number,
  nowMs: number
): { ok: true; verified: VerifiedReadings } | { ok: false; code: "stale" | "span" | "accuracy" | "distance" } {
  const timestamps: number[] = [];
  for (const reading of readings) {
    const capturedMs = Date.parse(reading.capturedAt);
    if (Number.isNaN(capturedMs)) {
      return { ok: false, code: "stale" };
    }
    const ageMs = nowMs - capturedMs;
    if (ageMs < -FUTURE_CLOCK_SKEW_MS || ageMs > readingsExpireAfterSeconds * 1000) {
      return { ok: false, code: "stale" };
    }
    timestamps.push(capturedMs);
    if (reading.accuracyMeters > maximumAccuracyMeters) {
      return { ok: false, code: "accuracy" };
    }
  }
  const newest = Math.max(...timestamps);
  const oldest = Math.min(...timestamps);
  if (newest - oldest < collectionDurationSeconds * 1000) {
    return { ok: false, code: "span" };
  }
  let maxDistance = 0;
  let worstAccuracy = 0;
  for (const reading of readings) {
    const distance = haversineMeters(
      reading.latitude,
      reading.longitude,
      targetLatitude,
      targetLongitude
    );
    if (distance > maxDistance) {
      maxDistance = distance;
    }
    if (reading.accuracyMeters > worstAccuracy) {
      worstAccuracy = reading.accuracyMeters;
    }
    if (distance > radiusMeters) {
      return { ok: false, code: "distance" };
    }
  }
  return {
    ok: true,
    verified: {
      selected: readings,
      maxDistanceMeters: Math.round(maxDistance * 100) / 100,
      worstAccuracyMeters: Math.round(worstAccuracy * 100) / 100
    }
  };
}

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
    const user = await resolveRequestUser(c);
    if (user === undefined) {
      return errorResponse(c, "UNAUTHENTICATED", "Authentication required");
    }
    if (user.emailVerified === false) {
      return errorResponse(c, "FORBIDDEN", "Email verification required");
    }
    const db = c.env.DB;
    const challenge = await loadChallengeById(db, params.data.challengeId);
    if (challenge === undefined) {
      return errorResponse(c, "NOT_FOUND", "Challenge not found");
    }
    const event = await loadEventById(db, challenge.event_id);
    if (event === undefined) {
      return errorResponse(c, "EVENT_NOT_FOUND", "Event not found");
    }
    // Guidance (including coordinates when configured) is game content: same
    // lifecycle gate as verification.
    const sessionGate = eventGateStatus(event.status);
    if (sessionGate !== null) {
      const message =
        sessionGate === "EVENT_PAUSED"
          ? "The event is paused. Location guidance is unavailable until it resumes."
          : "Location guidance is only available while the event is live.";
      return errorResponse(c, sessionGate, message);
    }
    const participant = await getActiveParticipant(db, user.id, event.id);
    if (participant === undefined) {
      return errorResponse(c, "FORBIDDEN", "Join this event before starting a location objective");
    }
    const config = parseConfiguration(challenge.configuration_json);
    if (config === undefined) {
      return errorResponse(c, "INTERNAL", "Challenge configuration is invalid");
    }
    const eventChallenges = await listChallengesByEvent(db, event.id);
    const snapshot = await loadProgressionSnapshot(db, participant.id, eventChallenges);
    if (
      isChallengeUnlocked(config, snapshot.completedChallengeIds, snapshot.decisionChoices, snapshot.now) === false
    ) {
      if (config.hiddenUntilUnlocked) {
        return errorResponse(c, "NOT_FOUND", "Challenge not found");
      }
      return errorResponse(c, "OBJECTIVE_LOCKED", "This challenge is not unlocked yet");
    }
    const objective = config.objectives.find((entry) => entry.key === params.data.objectiveKey);
    if (objective === undefined) {
      return errorResponse(c, "NOT_FOUND", "Objective not found");
    }
    if (objective.type !== "location" || objective.location === undefined) {
      return errorResponse(c, "VALIDATION_ERROR", "This objective is not a location objective");
    }
    const rows = await getProgressRows(db, participant.id, challenge.id);
    const rowsByKey = new Map(rows.map((row) => [row.objective_key, row]));
    const status = deriveObjectiveStatus(objective.key, objective.dependsOn, rowsByKey);
    const response: {
      objectiveKey: string;
      status: string;
      requiredReadings: number;
      readingsExpireAfterSeconds: number;
      collectionDurationSeconds: number;
      maximumAccuracyMeters: number;
      guidance?: { placeName?: string | undefined; text?: string | undefined } | undefined;
      coordinatesRevealed: boolean;
      coordinates?: { latitude: number; longitude: number } | undefined;
    } = {
      objectiveKey: objective.key,
      status,
      requiredReadings: objective.location.requiredReadings,
      readingsExpireAfterSeconds: objective.location.readingsExpireAfterSeconds,
      collectionDurationSeconds: objective.location.collectionDurationSeconds,
      maximumAccuracyMeters: objective.location.maximumAccuracyMeters,
      coordinatesRevealed: objective.revealCoordinates
    };
    if (objective.placeName !== undefined || objective.guidanceText !== undefined) {
      const guidance: { placeName?: string | undefined; text?: string | undefined } = {};
      if (objective.placeName !== undefined) {
        guidance.placeName = objective.placeName;
      }
      if (objective.guidanceText !== undefined) {
        guidance.text = objective.guidanceText;
      }
      response.guidance = guidance;
    }
    if (objective.revealCoordinates) {
      response.coordinates = {
        latitude: objective.location.latitude,
        longitude: objective.location.longitude
      };
    }
    return c.json(response);
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
    const body = verifyLocationBodySchema.safeParse(raw);
    if (body.success === false) {
      return errorResponse(c, "VALIDATION_ERROR", "Location readings are required");
    }
    const user = await resolveRequestUser(c);
    if (user === undefined) {
      return errorResponse(c, "UNAUTHENTICATED", "Authentication required");
    }
    if (user.emailVerified === false) {
      return errorResponse(c, "FORBIDDEN", "Email verification required");
    }
    const db = c.env.DB;
    const challenge = await loadChallengeById(db, params.data.challengeId);
    if (challenge === undefined) {
      return errorResponse(c, "NOT_FOUND", "Challenge not found");
    }
    const event = await loadEventById(db, challenge.event_id);
    if (event === undefined) {
      return errorResponse(c, "EVENT_NOT_FOUND", "Event not found");
    }
    const gate = eventGateStatus(event.status);
    if (gate !== null) {
      const message =
        gate === "EVENT_PAUSED"
          ? "The event is paused. Location verification is blocked until it resumes."
          : "The event is no longer accepting submissions.";
      return errorResponse(c, gate, message);
    }
    const participant = await getActiveParticipant(db, user.id, event.id);
    if (participant === undefined) {
      return errorResponse(c, "FORBIDDEN", "Join this event before verifying a location");
    }
    const config = parseConfiguration(challenge.configuration_json);
    if (config === undefined) {
      return errorResponse(c, "INTERNAL", "Challenge configuration is invalid");
    }
    const eventChallenges = await listChallengesByEvent(db, event.id);
    const snapshot = await loadProgressionSnapshot(db, participant.id, eventChallenges);
    if (
      isChallengeUnlocked(config, snapshot.completedChallengeIds, snapshot.decisionChoices, snapshot.now) === false
    ) {
      if (config.hiddenUntilUnlocked) {
        return errorResponse(c, "NOT_FOUND", "Challenge not found");
      }
      return errorResponse(c, "OBJECTIVE_LOCKED", "This challenge is not unlocked yet");
    }
    const objective = config.objectives.find((entry) => entry.key === params.data.objectiveKey);
    if (objective === undefined) {
      return errorResponse(c, "NOT_FOUND", "Objective not found");
    }
    if (objective.type !== "location" || objective.location === undefined) {
      return errorResponse(c, "VALIDATION_ERROR", "This objective is not a location objective");
    }
    const rows = await getProgressRows(db, participant.id, challenge.id);
    const rowsByKey = new Map(rows.map((row) => [row.objective_key, row]));
    const status = deriveObjectiveStatus(objective.key, objective.dependsOn, rowsByKey);
    if (status === "locked") {
      return errorResponse(c, "OBJECTIVE_LOCKED", "This objective is not available yet");
    }
    const existing = rowsByKey.get(objective.key);
    if (existing !== undefined && existing.status === "completed") {
      const replayed: CompletionResult = {
        objectiveKey: objective.key,
        completedAt: existing.completed_at ?? nowIso(),
        completedBy: existing.completed_by ?? user.id,
        eventPointsAward: objective.eventPoints,
        platformCreditsAward: objective.platformCredits,
        replayed: true
      };
      return c.json({ completed: true, ...replayed, idempotentReplay: true });
    }
    const headerKey = c.get("idempotencyKey");
    const idempotencyKey =
      headerKey !== undefined && headerKey.length > 0
        ? headerKey.slice(0, MAX_IDEMPOTENCY_KEY_LENGTH)
        : body.data.idempotencyKey;
    if (idempotencyKey !== undefined) {
      const keyed = await getProgressByIdempotencyKey(db, idempotencyKey);
      if (keyed !== undefined) {
        const matches =
          keyed.participant_id === participant.id &&
          keyed.challenge_id === challenge.id &&
          keyed.objective_key === objective.key &&
          keyed.status === "completed";
        if (matches) {
          return c.json({
            completed: true,
            objectiveKey: objective.key,
            completedAt: keyed.completed_at ?? nowIso(),
            completedBy: keyed.completed_by ?? user.id,
            eventPointsAward: objective.eventPoints,
            platformCreditsAward: objective.platformCredits,
            replayed: true,
            idempotentReplay: true
          });
        }
        return errorResponse(c, "DUPLICATE_SUBMISSION", "Idempotency key already used");
      }
    }
    const requiredCount = objective.location.requiredReadings;
    if (body.data.readings.length < requiredCount) {
      return errorResponse(
        c,
        "VALIDATION_ERROR",
        `At least ${requiredCount} location readings are required`
      );
    }
    const selected = selectVerifyReadings(body.data.readings, requiredCount);
    const evaluated = evaluateLocationReadings(
      selected,
      objective.location.latitude,
      objective.location.longitude,
      objective.location.radiusMeters,
      objective.location.maximumAccuracyMeters,
      objective.location.readingsExpireAfterSeconds,
      objective.location.collectionDurationSeconds,
      Date.now()
    );
    if (evaluated.ok === false) {
      if (evaluated.code === "stale") {
        return errorResponse(
          c,
          "LOCATION_REJECTED",
          "Those readings are too old. Collect fresh readings and try again"
        );
      }
      if (evaluated.code === "span") {
        return errorResponse(
          c,
          "LOCATION_REJECTED",
          "Collect readings over a few seconds before verifying"
        );
      }
      if (evaluated.code === "accuracy") {
        return errorResponse(
          c,
          "LOCATION_REJECTED",
          "GPS accuracy is too poor. Move to an open area, wait a few seconds, and try again"
        );
      }
      return errorResponse(
        c,
        "LOCATION_REJECTED",
        "You are not at the target location yet"
      );
    }
    const data: ProgressData = {
      ...readProgressData(existing?.data_json ?? null),
      distanceMeters: evaluated.verified.maxDistanceMeters,
      accuracyMeters: evaluated.verified.worstAccuracyMeters
    };
    const outcome = await completeObjective({
      db,
      eventId: event.id,
      participant,
      challengeId: challenge.id,
      objectiveKey: objective.key,
      userId: user.id,
      idempotencyKey,
      eventPointsAward: objective.eventPoints,
      platformCreditsAward: objective.platformCredits,
      progressData: data
    });
    if (outcome.kind === "duplicate_key") {
      return errorResponse(c, "DUPLICATE_SUBMISSION", "Idempotency key already used");
    }
    if (outcome.kind === "error") {
      return errorResponse(c, "INTERNAL", "Could not record the completion");
    }
    return c.json({ completed: true, ...outcome.result, idempotentReplay: outcome.result.replayed });
  }
);
