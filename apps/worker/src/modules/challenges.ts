/** Phase 1 challenge fetch, answer submission, hint unlocks, and shared completion logic. */

import { Hono } from "hono";
import {
  challengeConfigurationSchema,
  isChallengeComplete,
  isChallengeUnlocked,
  submitAnswerBodySchema,
  validateAnswer
} from "@campus/shared";
import type {
  ChallengeConfiguration,
  ErrorCode,
  ObjectiveConfig,
  ObjectiveStatus,
  ObjectiveType,
  ValidateAnswerInput
} from "@campus/shared";
import { z } from "zod";
import type { AppEnv, AuthUser, DatabaseBinding } from "../env";
import { newId, sha256Hex } from "../lib/crypto";
import type { AppContext } from "../lib/errors";
import { errorResponse } from "../lib/errors";
import { nowIso } from "../lib/time";
import { turnstileRequired, verifyTurnstile } from "../lib/turnstile";
import { clientIp } from "./auth";

export const PHASE1_COMPLETABLE_OBJECTIVE_TYPES: ObjectiveType[] = [
  "text_answer",
  "numeric_answer",
  "multiple_choice",
  "ordered_sequence",
  "code",
  "location"
];

export const PHASE1_MANUAL_OBJECTIVE_TYPES: ObjectiveType[] = [
  "timer",
  "manual_approval",
  "media"
];

const MAX_IDEMPOTENCY_KEY_LENGTH = 128;
const MAX_COOLDOWN_SECONDS = 3600;
const WRONG_ATTEMPTS_TURNSTILE_THRESHOLD = 3;

const userRowSchema = z
  .object({
    id: z.string(),
    email: z.string(),
    platform_credits: z.number()
  })
  .catchall(z.unknown());

const sessionUserRowSchema = z
  .object({
    id: z.string(),
    email: z.string(),
    email_verified: z.number(),
    expires_at: z.string(),
    revoked_at: z.string().nullable()
  })
  .catchall(z.unknown());

const eventRowSchema = z
  .object({
    id: z.string(),
    status: z.string()
  })
  .catchall(z.unknown());

const challengeRowSchema = z
  .object({
    id: z.string(),
    event_id: z.string(),
    title: z.string(),
    description: z.string().nullable(),
    position: z.number(),
    configuration_json: z.string()
  })
  .catchall(z.unknown());

const participantRowSchema = z
  .object({
    id: z.string(),
    event_id: z.string(),
    type: z.string(),
    name: z.string(),
    event_points: z.number(),
    penalty_seconds: z.number(),
    completed_at: z.string().nullable()
  })
  .catchall(z.unknown());

const memberRowSchema = z
  .object({
    participant_id: z.string(),
    user_id: z.string()
  })
  .catchall(z.unknown());

const progressRowSchema = z
  .object({
    id: z.string(),
    participant_id: z.string(),
    challenge_id: z.string(),
    objective_key: z.string(),
    status: z.string(),
    completed_by: z.string().nullable(),
    completed_at: z.string().nullable(),
    data_json: z.string().nullable(),
    idempotency_key: z.string().nullable()
  })
  .catchall(z.unknown());

const creditTxRowSchema = z
  .object({
    id: z.string(),
    user_id: z.string(),
    event_id: z.string().nullable(),
    amount: z.number(),
    reason: z.string(),
    reference_id: z.string().nullable(),
    created_at: z.string()
  })
  .catchall(z.unknown());

export type UserRow = z.infer<typeof userRowSchema>;
export type EventRow = z.infer<typeof eventRowSchema>;
export type ChallengeRow = z.infer<typeof challengeRowSchema>;
export type ParticipantRow = z.infer<typeof participantRowSchema>;
export type MemberRow = z.infer<typeof memberRowSchema>;
export type ProgressRow = z.infer<typeof progressRowSchema>;
export type CreditTxRow = z.infer<typeof creditTxRowSchema>;

const progressDataSchema = z
  .object({
    attempts: z.number().int().min(0).default(0),
    wrongAttempts: z.number().int().min(0).default(0),
    lastAttemptAt: z.string().optional(),
    hintsUnlocked: z.array(z.string()).default([]),
    distanceMeters: z.number().optional(),
    accuracyMeters: z.number().optional(),
    decisionChoice: z.string().min(1).optional()
  })
  .catchall(z.unknown());

export type ProgressData = z.infer<typeof progressDataSchema>;

export interface ObjectiveViewChoice {
  id: string;
  label: string;
}

export interface ObjectiveViewHint {
  key: string;
  costPoints: number;
  unlocked: boolean;
}

export interface ObjectiveView {
  key: string;
  type: ObjectiveType;
  prompt: string;
  status: ObjectiveStatus;
  required: boolean;
  requiresManual: boolean;
  hints: ObjectiveViewHint[];
  reward: { eventPoints: number; platformCredits: number };
  choices?: ObjectiveViewChoice[] | undefined;
  attemptsLeft?: number | undefined;
  guidance?: { placeName?: string | undefined; text?: string | undefined } | undefined;
  coordinates?: { latitude: number; longitude: number } | undefined;
  completionFact?: string | undefined;
}

export interface CompletionInput {
  db: DatabaseBinding;
  eventId: string;
  participant: ParticipantRow;
  challengeId: string;
  objectiveKey: string;
  userId: string;
  idempotencyKey: string | undefined;
  eventPointsAward: number;
  platformCreditsAward: number;
  progressData: ProgressData;
}

export interface CompletionResult {
  objectiveKey: string;
  completedAt: string;
  completedBy: string;
  eventPointsAward: number;
  platformCreditsAward: number;
  replayed: boolean;
}

export type CompletionOutcome =
  | { kind: "done"; result: CompletionResult }
  | { kind: "duplicate_key" }
  | { kind: "error" };

export type AttemptGate =
  | { kind: "ok" }
  | { kind: "attempts" }
  | { kind: "cooldown"; retryAfterSeconds: number };

function parseRow<T>(schema: z.ZodType<T>, value: unknown): T | undefined {
  const parsed = schema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

export function parseConfiguration(raw: string): ChallengeConfiguration | undefined {
  let decoded: unknown;
  try {
    decoded = JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
  const parsed = challengeConfigurationSchema.safeParse(decoded);
  return parsed.success ? parsed.data : undefined;
}

export function readProgressData(raw: string | null): ProgressData {
  if (raw === null || raw.length === 0) {
    return { attempts: 0, wrongAttempts: 0, hintsUnlocked: [] };
  }
  let decoded: unknown;
  try {
    decoded = JSON.parse(raw) as unknown;
  } catch {
    return { attempts: 0, wrongAttempts: 0, hintsUnlocked: [] };
  }
  const parsed = progressDataSchema.safeParse(decoded);
  return parsed.success ? parsed.data : { attempts: 0, wrongAttempts: 0, hintsUnlocked: [] };
}

export async function resolveRequestUser(c: AppContext): Promise<AuthUser | undefined> {
  const contextUser = c.get("user");
  if (contextUser !== undefined) {
    return contextUser;
  }
  const token = c.get("sessionToken");
  if (token === undefined || token.length === 0) {
    return undefined;
  }
  const db = c.env.DB;
  const now = nowIso();
  const candidates = [await sha256Hex(token), token];
  for (const candidate of candidates) {
    const raw = await db
      .prepare(
        "/*Q:session_user*/ SELECT u.id AS id, u.email AS email, u.email_verified AS email_verified, s.expires_at AS expires_at, s.revoked_at AS revoked_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? LIMIT 1"
      )
      .bind(candidate)
      .first();
    const row = parseRow(sessionUserRowSchema, raw);
    if (row === undefined) {
      continue;
    }
    if (row.revoked_at !== null) {
      continue;
    }
    if (row.expires_at <= now) {
      continue;
    }
    return {
      id: row.id,
      email: row.email,
      emailVerified: row.email_verified === 1
    };
  }
  return undefined;
}

export async function loadEventById(
  db: DatabaseBinding,
  eventId: string
): Promise<EventRow | undefined> {
  const raw = await db
    .prepare("/*Q:event_by_id*/ SELECT id, status FROM events WHERE id = ? LIMIT 1")
    .bind(eventId)
    .first();
  return parseRow(eventRowSchema, raw);
}

export async function loadChallengeById(
  db: DatabaseBinding,
  challengeId: string
): Promise<ChallengeRow | undefined> {
  const raw = await db
    .prepare(
      "/*Q:challenge_by_id*/ SELECT id, event_id, title, description, position, configuration_json FROM challenges WHERE id = ? LIMIT 1"
    )
    .bind(challengeId)
    .first();
  return parseRow(challengeRowSchema, raw);
}

export async function listChallengesByEvent(
  db: DatabaseBinding,
  eventId: string
): Promise<ChallengeRow[]> {
  const raw = (await db
    .prepare(
      "/*Q:challenges_by_event*/ SELECT id, event_id, title, description, position, configuration_json FROM challenges WHERE event_id = ? ORDER BY position ASC"
    )
    .bind(eventId)
    .all()).results;
  const rows: ChallengeRow[] = [];
  for (const entry of raw) {
    const row = parseRow(challengeRowSchema, entry);
    if (row !== undefined) {
      rows.push(row);
    }
  }
  return rows;
}

export async function getActiveParticipant(
  db: DatabaseBinding,
  userId: string,
  eventId: string
): Promise<ParticipantRow | undefined> {
  const raw = await db
    .prepare(
      "/*Q:participant_for_user*/ SELECT p.id AS id, p.event_id AS event_id, p.type AS type, p.name AS name, p.event_points AS event_points, p.penalty_seconds AS penalty_seconds, p.completed_at AS completed_at FROM participants p JOIN participant_members m ON m.participant_id = p.id WHERE m.user_id = ? AND m.left_at IS NULL AND p.event_id = ? LIMIT 1"
    )
    .bind(userId, eventId)
    .first();
  return parseRow(participantRowSchema, raw);
}

export async function listActiveMembers(
  db: DatabaseBinding,
  participantId: string
): Promise<MemberRow[]> {
  const raw = (await db
    .prepare(
      "/*Q:members_active*/ SELECT participant_id, user_id FROM participant_members WHERE participant_id = ? AND left_at IS NULL"
    )
    .bind(participantId)
    .all()).results;
  const rows: MemberRow[] = [];
  for (const entry of raw) {
    const row = parseRow(memberRowSchema, entry);
    if (row !== undefined) {
      rows.push(row);
    }
  }
  return rows;
}

export async function loadUserRow(
  db: DatabaseBinding,
  userId: string
): Promise<UserRow | undefined> {
  const raw = await db
    .prepare("/*Q:user_row*/ SELECT id, email, platform_credits FROM users WHERE id = ? LIMIT 1")
    .bind(userId)
    .first();
  return parseRow(userRowSchema, raw);
}

export async function getProgressRows(
  db: DatabaseBinding,
  participantId: string,
  challengeId: string
): Promise<ProgressRow[]> {
  const raw = (await db
    .prepare(
      "/*Q:progress_rows*/ SELECT id, participant_id, challenge_id, objective_key, status, completed_by, completed_at, data_json, idempotency_key FROM objective_progress WHERE participant_id = ? AND challenge_id = ?"
    )
    .bind(participantId, challengeId)
    .all()).results;
  const rows: ProgressRow[] = [];
  for (const entry of raw) {
    const row = parseRow(progressRowSchema, entry);
    if (row !== undefined) {
      rows.push(row);
    }
  }
  return rows;
}

export async function getProgressOne(
  db: DatabaseBinding,
  participantId: string,
  challengeId: string,
  objectiveKey: string
): Promise<ProgressRow | undefined> {
  const raw = await db
    .prepare(
      "/*Q:progress_one*/ SELECT id, participant_id, challenge_id, objective_key, status, completed_by, completed_at, data_json, idempotency_key FROM objective_progress WHERE participant_id = ? AND challenge_id = ? AND objective_key = ? LIMIT 1"
    )
    .bind(participantId, challengeId, objectiveKey)
    .first();
  return parseRow(progressRowSchema, raw);
}

export async function getProgressByIdempotencyKey(
  db: DatabaseBinding,
  idempotencyKey: string
): Promise<ProgressRow | undefined> {
  const raw = await db
    .prepare(
      "/*Q:progress_by_idempotency*/ SELECT id, participant_id, challenge_id, objective_key, status, completed_by, completed_at, data_json, idempotency_key FROM objective_progress WHERE idempotency_key = ? LIMIT 1"
    )
    .bind(idempotencyKey)
    .first();
  return parseRow(progressRowSchema, raw);
}

export async function listCompletedProgressForParticipant(
  db: DatabaseBinding,
  participantId: string
): Promise<ProgressRow[]> {
  const raw = (await db
    .prepare(
      "/*Q:progress_completed_participant*/ SELECT id, participant_id, challenge_id, objective_key, status, completed_by, completed_at, data_json, idempotency_key FROM objective_progress WHERE participant_id = ? AND status = 'completed'"
    )
    .bind(participantId)
    .all()).results;
  const rows: ProgressRow[] = [];
  for (const entry of raw) {
    const row = parseRow(progressRowSchema, entry);
    if (row !== undefined) {
      rows.push(row);
    }
  }
  return rows;
}

export interface ProgressionSnapshot {
  completedChallengeIds: string[];
  decisionChoices: Record<string, Record<string, string>>;
  now: string;
}

export async function loadProgressionSnapshot(
  db: DatabaseBinding,
  participantId: string,
  challenges: ChallengeRow[]
): Promise<ProgressionSnapshot> {
  const now = nowIso();
  const completed = await listCompletedProgressForParticipant(db, participantId);
  const keysByChallenge = new Map<string, string[]>();
  for (const row of completed) {
    const list = keysByChallenge.get(row.challenge_id) ?? [];
    list.push(row.objective_key);
    keysByChallenge.set(row.challenge_id, list);
  }
  const completedChallengeIds: string[] = [];
  const decisionChoices: Record<string, Record<string, string>> = {};
  for (const challenge of challenges) {
    const config = parseConfiguration(challenge.configuration_json);
    if (config === undefined) {
      continue;
    }
    const keys = keysByChallenge.get(challenge.id) ?? [];
    if (isChallengeComplete(config, keys)) {
      completedChallengeIds.push(challenge.id);
    }
    for (const objective of config.objectives) {
      if (objective.type !== "decision") {
        continue;
      }
      const row = completed.find(
        (entry) =>
          entry.challenge_id === challenge.id && entry.objective_key === objective.key
      );
      if (row === undefined) {
        continue;
      }
      const choice = readProgressData(row.data_json).decisionChoice;
      if (choice === undefined || choice.length === 0) {
        continue;
      }
      const scoped = decisionChoices[challenge.id] ?? {};
      scoped[objective.key] = choice;
      decisionChoices[challenge.id] = scoped;
    }
  }
  return { completedChallengeIds, decisionChoices, now };
}

export function eventGateStatus(status: string): ErrorCode | null {
  if (status === "live") {
    return null;
  }
  if (status === "paused") {
    return "EVENT_PAUSED";
  }
  if (status === "completed" || status === "archived") {
    return "CONFLICT";
  }
  return "EVENT_NOT_LIVE";
}

/**
 * Gate for roster mutations (registration, team create/invite/request/
 * approve/reject/leave/transfer). Pause freezes progress, not the roster:
 * teams may still form while scheduled, live or paused. Draft/testing are
 * invisible and completed/archived are closed.
 */
export function rosterGateStatus(status: string): ErrorCode | null {
  if (status === "scheduled" || status === "live" || status === "paused") {
    return null;
  }
  if (status === "completed" || status === "archived") {
    return "EVENT_NOT_LIVE";
  }
  return "EVENT_NOT_FOUND";
}

/** Email verification is required before event participation (§17.1). */
export function unverifiedResponse(
  c: AppContext,
  user: { emailVerified: boolean }
): Response | null {
  if (user.emailVerified === false) {
    return errorResponse(c, "FORBIDDEN", "Email verification required");
  }
  return null;
}

export function deriveObjectiveStatus(
  objectiveKey: string,
  dependsOn: string[],
  rowsByKey: Map<string, ProgressRow>
): ObjectiveStatus {
  const row = rowsByKey.get(objectiveKey);
  if (row !== undefined && row.status === "completed") {
    return "completed";
  }
  for (const dependency of dependsOn) {
    if (rowsByKey.get(dependency)?.status !== "completed") {
      return "locked";
    }
  }
  if (row === undefined) {
    return "available";
  }
  const data = readProgressData(row.data_json);
  if (row.status === "in_progress" || data.attempts > 0 || data.hintsUnlocked.length > 0) {
    return "in_progress";
  }
  return "available";
}

export function effectiveCooldownSeconds(
  baseSeconds: number,
  progressive: boolean,
  wrongAttempts: number
): number {
  if (baseSeconds <= 0) {
    return 0;
  }
  if (progressive === false || wrongAttempts <= 1) {
    return baseSeconds;
  }
  const scaled = baseSeconds * 2 ** (wrongAttempts - 1);
  return Math.min(scaled, MAX_COOLDOWN_SECONDS);
}

export function checkAttemptGate(
  objective: ObjectiveConfig,
  data: ProgressData,
  nowMs: number
): AttemptGate {
  if (objective.maxAttempts !== undefined && data.attempts >= objective.maxAttempts) {
    return { kind: "attempts" };
  }
  const effective = effectiveCooldownSeconds(
    objective.cooldownSeconds,
    objective.progressiveCooldown,
    data.wrongAttempts
  );
  if (effective > 0 && data.lastAttemptAt !== undefined) {
    const lastMs = Date.parse(data.lastAttemptAt);
    if (Number.isNaN(lastMs) === false) {
      const waitMs = effective * 1000 - (nowMs - lastMs);
      if (waitMs > 0) {
        return { kind: "cooldown", retryAfterSeconds: Math.ceil(waitMs / 1000) };
      }
    }
  }
  return { kind: "ok" };
}

export function sanitizeObjective(
  objective: ObjectiveConfig,
  status: ObjectiveStatus,
  data: ProgressData
): ObjectiveView {
  const hints: ObjectiveViewHint[] = objective.hints.map((hint) => ({
    key: hint.key,
    costPoints: hint.costPoints,
    unlocked: data.hintsUnlocked.includes(hint.key)
  }));
  const view: ObjectiveView = {
    key: objective.key,
    type: objective.type,
    prompt: objective.prompt,
    status,
    required: objective.required,
    requiresManual: PHASE1_MANUAL_OBJECTIVE_TYPES.includes(objective.type),
    hints,
    reward: { eventPoints: objective.eventPoints, platformCredits: objective.platformCredits }
  };
  if (objective.type === "multiple_choice" && objective.choices !== undefined) {
    view.choices = objective.choices.map((choice) => ({ id: choice.id, label: choice.label }));
  }
  if (objective.maxAttempts !== undefined) {
    view.attemptsLeft = Math.max(0, objective.maxAttempts - data.attempts);
  }
  if (objective.placeName !== undefined || objective.guidanceText !== undefined) {
    const guidance: { placeName?: string | undefined; text?: string | undefined } = {};
    if (objective.placeName !== undefined) {
      guidance.placeName = objective.placeName;
    }
    if (objective.guidanceText !== undefined) {
      guidance.text = objective.guidanceText;
    }
    view.guidance = guidance;
  }
  if (
    objective.type === "location" &&
    objective.revealCoordinates &&
    objective.location !== undefined
  ) {
    view.coordinates = {
      latitude: objective.location.latitude,
      longitude: objective.location.longitude
    };
  }
  if (status === "completed" && objective.completionFact !== undefined) {
    view.completionFact = objective.completionFact;
  }
  return view;
}

function toCompletionResult(
  row: ProgressRow,
  input: CompletionInput,
  replayed: boolean
): CompletionResult {
  return {
    objectiveKey: row.objective_key,
    completedAt: row.completed_at ?? nowIso(),
    completedBy: row.completed_by ?? input.userId,
    eventPointsAward: input.eventPointsAward,
    platformCreditsAward: input.platformCreditsAward,
    replayed
  };
}

async function computeFinishTimestamp(
  db: DatabaseBinding,
  eventId: string,
  participant: ParticipantRow
): Promise<string | undefined> {
  if (participant.completed_at !== null) {
    return undefined;
  }
  const challenges = await listChallengesByEvent(db, eventId);
  const required = new Set<string>();
  for (const challenge of challenges) {
    const config = parseConfiguration(challenge.configuration_json);
    if (config === undefined) {
      return undefined;
    }
    // Every required objective blocks the finish, regardless of type:
    // manual_approval/timer/media objectives are completed through the admin
    // manual-completion override, decisions through the player decision path.
    for (const objective of config.objectives) {
      if (objective.required) {
        required.add(`${challenge.id}:${objective.key}`);
      }
    }
  }
  const completed = await listCompletedProgressForParticipant(db, participant.id);
  const done = new Set(completed.map((row) => `${row.challenge_id}:${row.objective_key}`));
  for (const key of required) {
    if (done.has(key) === false) {
      return undefined;
    }
  }
  return nowIso();
}

export async function completeObjective(input: CompletionInput): Promise<CompletionOutcome> {
  const db = input.db;
  if (input.idempotencyKey !== undefined) {
    const keyed = await getProgressByIdempotencyKey(db, input.idempotencyKey);
    if (keyed !== undefined) {
      const matches =
        keyed.participant_id === input.participant.id &&
        keyed.challenge_id === input.challengeId &&
        keyed.objective_key === input.objectiveKey &&
        keyed.status === "completed";
      if (matches) {
        return { kind: "done", result: toCompletionResult(keyed, input, true) };
      }
      return { kind: "duplicate_key" };
    }
  }
  const current = await getProgressOne(
    db,
    input.participant.id,
    input.challengeId,
    input.objectiveKey
  );
  if (current !== undefined && current.status === "completed") {
    return { kind: "done", result: toCompletionResult(current, input, true) };
  }
  const now = nowIso();
  const dataJson = JSON.stringify(input.progressData);
  if (current === undefined) {
    try {
      await db
        .prepare(
          "/*Q:insert_progress*/ INSERT INTO objective_progress (id, participant_id, challenge_id, objective_key, status, completed_by, completed_at, data_json, idempotency_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
        )
        .bind(
          newId(),
          input.participant.id,
          input.challengeId,
          input.objectiveKey,
          "completed",
          input.userId,
          now,
          dataJson,
          input.idempotencyKey ?? null,
          now,
          now
        )
        .run();
    } catch {
      const raced = await getProgressOne(
        db,
        input.participant.id,
        input.challengeId,
        input.objectiveKey
      );
      if (raced !== undefined && raced.status === "completed") {
        return { kind: "done", result: toCompletionResult(raced, input, true) };
      }
      return { kind: "error" };
    }
  } else {
    await db
      .prepare(
        "/*Q:update_progress_completed*/ UPDATE objective_progress SET status = ?, completed_by = ?, completed_at = ?, data_json = ?, idempotency_key = ?, updated_at = ? WHERE id = ?"
      )
      .bind("completed", input.userId, now, dataJson, input.idempotencyKey ?? null, now, current.id)
      .run();
  }
  const writes = [
    db
      .prepare(
        // Relative delta, never a stale absolute: concurrent completions add
        // up instead of overwriting each other.
        "/*Q:add_participant_points*/ UPDATE participants SET event_points = event_points + ?, updated_at = ? WHERE id = ?"
      )
      .bind(input.eventPointsAward, now, input.participant.id)
  ];
  if (input.platformCreditsAward > 0) {
    const members = await listActiveMembers(db, input.participant.id);
    for (const member of members) {
      writes.push(
        db
          .prepare(
            "/*Q:add_user_credits*/ UPDATE users SET platform_credits = platform_credits + ?, updated_at = ? WHERE id = ?"
          )
          .bind(input.platformCreditsAward, now, member.user_id)
      );
      writes.push(
        db
          .prepare(
            "/*Q:insert_credit_tx*/ INSERT INTO credit_transactions (id, user_id, event_id, amount, reason, reference_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
          )
          .bind(
            newId(),
            member.user_id,
            input.eventId,
            input.platformCreditsAward,
            "credit_reward",
            `${input.challengeId}:${input.objectiveKey}`,
            now
          )
      );
    }
  }
  const finishAt = await computeFinishTimestamp(db, input.eventId, input.participant);
  if (finishAt !== undefined) {
    writes.push(
      db
        .prepare(
          "/*Q:set_participant_completed*/ UPDATE participants SET completed_at = ?, updated_at = ? WHERE id = ?"
        )
        .bind(finishAt, now, input.participant.id)
    );
  }
  try {
    await db.batch(writes);
  } catch {
    const raced = await getProgressOne(
      db,
      input.participant.id,
      input.challengeId,
      input.objectiveKey
    );
    if (raced !== undefined && raced.status === "completed") {
      return { kind: "done", result: toCompletionResult(raced, input, true) };
    }
    return { kind: "error" };
  }
  const stored = await getProgressOne(
    db,
    input.participant.id,
    input.challengeId,
    input.objectiveKey
  );
  if (stored === undefined || stored.status !== "completed") {
    return { kind: "error" };
  }
  return { kind: "done", result: toCompletionResult(stored, input, false) };
}

export async function upsertAttemptProgress(
  db: DatabaseBinding,
  participantId: string,
  challengeId: string,
  objectiveKey: string,
  data: ProgressData
): Promise<void> {
  const now = nowIso();
  const dataJson = JSON.stringify(data);
  const current = await getProgressOne(db, participantId, challengeId, objectiveKey);
  if (current === undefined) {
    try {
      await db
        .prepare(
          "/*Q:insert_progress*/ INSERT INTO objective_progress (id, participant_id, challenge_id, objective_key, status, completed_by, completed_at, data_json, idempotency_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
        )
        .bind(
          newId(),
          participantId,
          challengeId,
          objectiveKey,
          "in_progress",
          null,
          null,
          dataJson,
          null,
          now,
          now
        )
        .run();
    } catch {
      await db
        .prepare(
          "/*Q:update_progress_attempt*/ UPDATE objective_progress SET status = ?, data_json = ?, updated_at = ? WHERE participant_id = ? AND challenge_id = ? AND objective_key = ?"
        )
        .bind("in_progress", dataJson, now, participantId, challengeId, objectiveKey)
        .run();
    }
    return;
  }
  if (current.status === "completed") {
    await db
      .prepare(
        "/*Q:update_progress_data*/ UPDATE objective_progress SET data_json = ?, updated_at = ? WHERE id = ?"
      )
      .bind(dataJson, now, current.id)
      .run();
    return;
  }
  await db
    .prepare(
      "/*Q:update_progress_attempt*/ UPDATE objective_progress SET status = ?, data_json = ?, updated_at = ? WHERE participant_id = ? AND challenge_id = ? AND objective_key = ?"
    )
    .bind("in_progress", dataJson, now, participantId, challengeId, objectiveKey)
    .run();
}

function validationReady(objective: ObjectiveConfig): boolean {
  switch (objective.type) {
    case "text_answer":
    case "code":
      return (
        objective.expectedAnswer !== undefined ||
        (objective.acceptedAnswers !== undefined && objective.acceptedAnswers.length > 0)
      );
    case "numeric_answer":
      return (
        objective.expectedNumeric !== undefined && Number.isFinite(objective.expectedNumeric)
      );
    case "multiple_choice":
      return objective.correctChoiceId !== undefined;
    case "ordered_sequence":
      return (
        objective.expectedSequence !== undefined && objective.expectedSequence.length > 0
      );
    case "location":
      return objective.location !== undefined;
    case "decision":
      return false;
    case "timer":
      return false;
    case "manual_approval":
      return false;
    case "media":
      return false;
  }
}

export function buildValidationInput(
  objective: ObjectiveConfig,
  answer: unknown
): ValidateAnswerInput | undefined {
  if (validationReady(objective) === false) {
    return undefined;
  }
  switch (objective.type) {
    case "text_answer": {
      const mode =
        objective.validationMode ??
        (objective.acceptedAnswers !== undefined ? "accepted_list" : "normalized");
      if (mode === "accepted_list") {
        return { mode, submitted: answer, acceptedAnswers: objective.acceptedAnswers };
      }
      return { mode, submitted: answer, expected: objective.expectedAnswer };
    }
    case "code": {
      const mode = objective.validationMode ?? "case_insensitive";
      if (mode === "accepted_list") {
        return { mode, submitted: answer, acceptedAnswers: objective.acceptedAnswers };
      }
      if (mode === "numeric_exact" || mode === "numeric_tolerance" || mode === "ordered_sequence") {
        return undefined;
      }
      return { mode, submitted: answer, expected: objective.expectedAnswer };
    }
    case "numeric_answer": {
      const mode =
        objective.validationMode ??
        (objective.numericTolerance !== undefined && objective.numericTolerance > 0
          ? "numeric_tolerance"
          : "numeric_exact");
      if (mode !== "numeric_exact" && mode !== "numeric_tolerance") {
        return undefined;
      }
      return {
        mode,
        submitted: answer,
        expectedNumeric: objective.expectedNumeric,
        tolerance: objective.numericTolerance ?? 0
      };
    }
    case "multiple_choice": {
      return { mode: "exact", submitted: answer, expected: objective.correctChoiceId };
    }
    case "ordered_sequence": {
      return { mode: "ordered_sequence", submitted: answer, expectedSequence: objective.expectedSequence };
    }
    case "location":
      return undefined;
    case "decision":
      return undefined;
    case "timer":
      return undefined;
    case "manual_approval":
      return undefined;
    case "media":
      return undefined;
  }
}

interface DecisionSubmitInput {
  db: DatabaseBinding;
  eventId: string;
  participant: ParticipantRow;
  challengeId: string;
  userId: string;
  objective: ObjectiveConfig;
  answer: unknown;
  bodyKey: string | undefined;
}

async function submitDecision(c: AppContext, input: DecisionSubmitInput): Promise<Response> {
  const rows = await getProgressRows(input.db, input.participant.id, input.challengeId);
  const rowsByKey = new Map(rows.map((row) => [row.objective_key, row]));
  const status = deriveObjectiveStatus(input.objective.key, input.objective.dependsOn, rowsByKey);
  if (status === "locked") {
    return errorResponse(c, "OBJECTIVE_LOCKED", "This objective is not available yet");
  }
  const existing = rowsByKey.get(input.objective.key);
  if (existing !== undefined && existing.status === "completed") {
    const replayed: CompletionResult = {
      objectiveKey: input.objective.key,
      completedAt: existing.completed_at ?? nowIso(),
      completedBy: existing.completed_by ?? input.userId,
      eventPointsAward: input.objective.eventPoints,
      platformCreditsAward: input.objective.platformCredits,
      replayed: true
    };
    return c.json({ completed: true, ...replayed, idempotentReplay: true });
  }
  if (typeof input.answer !== "string" || input.answer.trim().length === 0) {
    return errorResponse(c, "VALIDATION_ERROR", "A choice is required");
  }
  const choice = input.answer.trim();
  if (
    input.objective.choices !== undefined &&
    input.objective.choices.length > 0 &&
    input.objective.choices.some((entry) => entry.id === choice) === false
  ) {
    return errorResponse(c, "VALIDATION_ERROR", "Unknown choice");
  }
  const headerKey = c.get("idempotencyKey");
  const idempotencyKey =
    headerKey !== undefined && headerKey.length > 0
      ? headerKey.slice(0, MAX_IDEMPOTENCY_KEY_LENGTH)
      : input.bodyKey;
  if (idempotencyKey !== undefined) {
    const keyed = await getProgressByIdempotencyKey(input.db, idempotencyKey);
    if (keyed !== undefined) {
      const matches =
        keyed.participant_id === input.participant.id &&
        keyed.challenge_id === input.challengeId &&
        keyed.objective_key === input.objective.key &&
        keyed.status === "completed";
      if (matches) {
        return c.json({
          completed: true,
          objectiveKey: input.objective.key,
          completedAt: keyed.completed_at ?? nowIso(),
          completedBy: keyed.completed_by ?? input.userId,
          eventPointsAward: input.objective.eventPoints,
          platformCreditsAward: input.objective.platformCredits,
          replayed: true,
          idempotentReplay: true
        });
      }
      return errorResponse(c, "DUPLICATE_SUBMISSION", "Idempotency key already used");
    }
  }
  const data: ProgressData = {
    ...readProgressData(existing?.data_json ?? null),
    decisionChoice: choice
  };
  const outcome = await completeObjective({
    db: input.db,
    eventId: input.eventId,
    participant: input.participant,
    challengeId: input.challengeId,
    objectiveKey: input.objective.key,
    userId: input.userId,
    idempotencyKey,
    eventPointsAward: input.objective.eventPoints,
    platformCreditsAward: input.objective.platformCredits,
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

export const challengesRouter = new Hono<AppEnv>();

challengesRouter.get("/api/challenges/:challengeId", async (c) => {
  const parsed = challengeIdParams.safeParse({
    challengeId: c.req.param("challengeId")
  });
  if (parsed.success === false) {
    return errorResponse(c, "VALIDATION_ERROR", "Invalid challenge id");
  }
  const user = await resolveRequestUser(c);
  if (user === undefined) {
    return errorResponse(c, "UNAUTHENTICATED", "Authentication required");
  }
  const db = c.env.DB;
  const challenge = await loadChallengeById(db, parsed.data.challengeId);
  if (challenge === undefined) {
    return errorResponse(c, "NOT_FOUND", "Challenge not found");
  }
  const event = await loadEventById(db, challenge.event_id);
  if (event === undefined) {
    return errorResponse(c, "EVENT_NOT_FOUND", "Event not found");
  }
  const participant = await getActiveParticipant(db, user.id, event.id);
  if (participant === undefined) {
    return errorResponse(c, "FORBIDDEN", "Join this event before viewing challenges");
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
    return c.json({
      challenge: {
        id: challenge.id,
        eventId: challenge.event_id,
        title: challenge.title,
        description: null,
        position: challenge.position
      },
      participant: { id: participant.id, eventPoints: participant.event_points },
      locked: true,
      objectives: config.objectives.map((objective) => ({
        key: objective.key,
        status: "locked",
        required: objective.required
      })),
      completed: false
    });
  }
  const rows = await getProgressRows(db, participant.id, challenge.id);
  const rowsByKey = new Map(rows.map((row) => [row.objective_key, row]));
  const objectives = config.objectives.map((objective) =>
    sanitizeObjective(
      objective,
      deriveObjectiveStatus(objective.key, objective.dependsOn, rowsByKey),
      readProgressData(rowsByKey.get(objective.key)?.data_json ?? null)
    )
  );
  const completed = config.objectives
    .filter((objective) => objective.required)
    .every((objective) => rowsByKey.get(objective.key)?.status === "completed");
  return c.json({
    challenge: {
      id: challenge.id,
      eventId: challenge.event_id,
      title: challenge.title,
      description: challenge.description,
      position: challenge.position
    },
    participant: { id: participant.id, eventPoints: participant.event_points },
    objectives,
    completed
  });
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
    const body = submitAnswerBodySchema.safeParse(raw);
    if (body.success === false || body.data.answer === undefined) {
      return errorResponse(c, "VALIDATION_ERROR", "An answer is required");
    }
    const user = await resolveRequestUser(c);
    if (user === undefined) {
      return errorResponse(c, "UNAUTHENTICATED", "Authentication required");
    }
    const unverified = unverifiedResponse(c, user);
    if (unverified !== null) {
      return unverified;
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
          ? "The event is paused. Submissions are blocked until it resumes."
          : "The event is no longer accepting submissions.";
      return errorResponse(c, gate, message);
    }
    const participant = await getActiveParticipant(db, user.id, event.id);
    if (participant === undefined) {
      return errorResponse(c, "FORBIDDEN", "Join this event before submitting answers");
    }
    const config = parseConfiguration(challenge.configuration_json);
    if (config === undefined) {
      return errorResponse(c, "INTERNAL", "Challenge configuration is invalid");
    }
    const objective = config.objectives.find((entry) => entry.key === params.data.objectiveKey);
    if (objective === undefined) {
      return errorResponse(c, "NOT_FOUND", "Objective not found");
    }
    const submitChallenges = await listChallengesByEvent(db, event.id);
    const submitSnapshot = await loadProgressionSnapshot(db, participant.id, submitChallenges);
    if (
      isChallengeUnlocked(config, submitSnapshot.completedChallengeIds, submitSnapshot.decisionChoices, submitSnapshot.now) === false
    ) {
      if (config.hiddenUntilUnlocked) {
        return errorResponse(c, "NOT_FOUND", "Challenge not found");
      }
      return errorResponse(c, "OBJECTIVE_LOCKED", "This challenge is not unlocked yet");
    }
    if (objective.type === "location") {
      return errorResponse(
        c,
        "INTERNAL",
        "Location objectives are verified through the verify-location endpoint",
        { status: 501 }
      );
    }
    if (objective.type === "decision") {
      return submitDecision(c, {
        db,
        eventId: event.id,
        participant,
        challengeId: challenge.id,
        userId: user.id,
        objective,
        answer: body.data.answer,
        bodyKey: body.data.idempotencyKey
      });
    }
    if (PHASE1_MANUAL_OBJECTIVE_TYPES.includes(objective.type)) {
      return errorResponse(
        c,
        "INTERNAL",
        "This objective type is not available in Phase 1",
        { status: 501 }
      );
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
    const data = readProgressData(existing?.data_json ?? null);
    const attemptGate = checkAttemptGate(objective, data, Date.now());
    if (attemptGate.kind === "attempts") {
      return errorResponse(c, "TOO_MANY_ATTEMPTS", "No attempts remain for this objective", {
        details: { attemptsLeft: 0 }
      });
    }
    if (attemptGate.kind === "cooldown") {
      return errorResponse(c, "COOLDOWN", "Wait before trying again", {
        details: { retry_after_seconds: attemptGate.retryAfterSeconds }
      });
    }
    // After repeated failures the client must prove humanity (§17.5). Open
    // (unconfigured) deployments skip this; the web client sends
    // turnstileToken only when challenged.
    if (turnstileRequired(c.env) && data.wrongAttempts >= WRONG_ATTEMPTS_TURNSTILE_THRESHOLD) {
      const token = body.data.turnstileToken;
      if (token === undefined) {
        return errorResponse(c, "FORBIDDEN", "Verification required after repeated incorrect answers");
      }
      const human = await verifyTurnstile(c.env.TURNSTILE_SECRET_KEY ?? "", token, clientIp(c));
      if (human === false) {
        return errorResponse(c, "FORBIDDEN", "Verification failed");
      }
    }
    const validationInput = buildValidationInput(objective, body.data.answer);
    if (validationInput === undefined) {
      return errorResponse(c, "INTERNAL", "Challenge configuration is invalid");
    }
    if (validateAnswer(validationInput) === false) {
      const now = nowIso();
      const next: ProgressData = {
        ...data,
        attempts: data.attempts + 1,
        wrongAttempts: data.wrongAttempts + 1,
        lastAttemptAt: now
      };
      await upsertAttemptProgress(db, participant.id, challenge.id, objective.key, next);
      if (objective.wrongAnswerPenaltyPoints > 0) {
        await db
          .prepare(
            "/*Q:subtract_participant_points*/ UPDATE participants SET event_points = MAX(0, event_points - ?), updated_at = ? WHERE id = ?"
          )
          .bind(objective.wrongAnswerPenaltyPoints, now, participant.id)
          .run();
      }
      if (objective.maxAttempts === undefined) {
        return errorResponse(c, "INVALID_ANSWER", "Incorrect answer");
      }
      return errorResponse(c, "INVALID_ANSWER", "Incorrect answer", {
        details: { attemptsLeft: Math.max(0, objective.maxAttempts - next.attempts) }
      });
    }
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

challengesRouter.post("/api/challenges/:challengeId/hints/:hintKey/unlock", async (c) => {
  const hintParamsParsed = hintParams.safeParse({
    challengeId: c.req.param("challengeId"),
    hintKey: c.req.param("hintKey")
  });
  if (hintParamsParsed.success === false) {
    return errorResponse(c, "VALIDATION_ERROR", "Invalid hint ref");
  }
  const user = await resolveRequestUser(c);
  if (user === undefined) {
    return errorResponse(c, "UNAUTHENTICATED", "Authentication required");
  }
  const hintUnverified = unverifiedResponse(c, user);
  if (hintUnverified !== null) {
    return hintUnverified;
  }
  const db = c.env.DB;
  const challenge = await loadChallengeById(db, hintParamsParsed.data.challengeId);
  if (challenge === undefined) {
    return errorResponse(c, "NOT_FOUND", "Challenge not found");
  }
  const event = await loadEventById(db, challenge.event_id);
  if (event === undefined) {
    return errorResponse(c, "EVENT_NOT_FOUND", "Event not found");
  }
  const gate = eventGateStatus(event.status);
  if (gate !== null) {
    return errorResponse(c, gate, "Hints cannot be unlocked while the event is not live");
  }
  const participant = await getActiveParticipant(db, user.id, event.id);
  if (participant === undefined) {
    return errorResponse(c, "FORBIDDEN", "Join this event before unlocking hints");
  }
  const config = parseConfiguration(challenge.configuration_json);
  if (config === undefined) {
    return errorResponse(c, "INTERNAL", "Challenge configuration is invalid");
  }
  const hintChallenges = await listChallengesByEvent(db, event.id);
  const hintSnapshot = await loadProgressionSnapshot(db, participant.id, hintChallenges);
  if (
    isChallengeUnlocked(config, hintSnapshot.completedChallengeIds, hintSnapshot.decisionChoices, hintSnapshot.now) === false
  ) {
    if (config.hiddenUntilUnlocked) {
      return errorResponse(c, "NOT_FOUND", "Challenge not found");
    }
    return errorResponse(c, "OBJECTIVE_LOCKED", "This challenge is not unlocked yet");
  }
  let hint:
    | { key: string; text: string; costPoints: number; objectiveKey: string }
    | undefined;
  for (const objective of config.objectives) {
    const found = objective.hints.find((entry) => entry.key === hintParamsParsed.data.hintKey);
    if (found !== undefined) {
      hint = {
        key: found.key,
        text: found.text,
        costPoints: found.costPoints,
        objectiveKey: objective.key
      };
      break;
    }
  }
  if (hint === undefined) {
    return errorResponse(c, "NOT_FOUND", "Hint not found");
  }
  const hintTarget = config.objectives.find((entry) => entry.key === hint.objectiveKey);
  if (hintTarget !== undefined) {
    const hintRows = await getProgressRows(db, participant.id, challenge.id);
    const hintByKey = new Map(hintRows.map((row) => [row.objective_key, row]));
    if (deriveObjectiveStatus(hintTarget.key, hintTarget.dependsOn, hintByKey) === "locked") {
      return errorResponse(c, "OBJECTIVE_LOCKED", "This objective is not available yet");
    }
  }
  const existing = await getProgressOne(db, participant.id, challenge.id, hint.objectiveKey);
  const data = readProgressData(existing?.data_json ?? null);
  if (data.hintsUnlocked.includes(hint.key)) {
    return c.json({
      hintKey: hint.key,
      text: hint.text,
      costPoints: hint.costPoints,
      eventPoints: participant.event_points,
      alreadyUnlocked: true
    });
  }
  const now = nowIso();
  const next: ProgressData = {
    ...data,
    hintsUnlocked: [...data.hintsUnlocked, hint.key]
  };
  await upsertAttemptProgress(db, participant.id, challenge.id, hint.objectiveKey, next);
  await db
    .prepare(
      "/*Q:subtract_participant_points*/ UPDATE participants SET event_points = MAX(0, event_points - ?), updated_at = ? WHERE id = ?"
    )
    .bind(hint.costPoints, now, participant.id)
    .run();
  const balance = await getActiveParticipant(db, user.id, event.id);
  const eventPoints = balance?.event_points ?? Math.max(0, participant.event_points - hint.costPoints);
  return c.json({
    hintKey: hint.key,
    text: hint.text,
    costPoints: hint.costPoints,
    eventPoints,
    alreadyUnlocked: false
  });
});
