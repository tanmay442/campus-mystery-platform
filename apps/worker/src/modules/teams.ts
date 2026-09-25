/** Team creation, shareable invites, join requests, and atomic approvals. */

import {
  DEFAULT_INVITE_EXPIRY_SECONDS,
  JOIN_LEAVE_COOLDOWN_SECONDS,
  LATE_JOIN_PENALTY_SECONDS,
  MAX_MEMBERSHIP_CHANGES_PER_WINDOW,
  MAX_TEAM_SIZE,
  TEAM_APPROVAL_WINDOW_SECONDS,
  canManageMembers,
  createInviteSchema,
  createTeamSchema,
  eventSettingsSchema
} from "@campus/shared";
import { Hono } from "hono";
import { getCookie } from "hono/cookie";
import { z } from "zod";
import type {
  AppEnv,
  DatabaseBinding,
  PreparedStatementBinding
} from "../env";
import type { AppContext } from "../lib/errors";
import { newId, sha256Hex } from "../lib/crypto";
import { errorResponse } from "../lib/errors";
import { nowIso } from "../lib/time";
import {
  listChallengesByEvent,
  parseConfiguration,
  rosterGateStatus
} from "./challenges";

const eventIdParams = z.object({ eventId: z.string().min(1) });

const participantIdParams = z.object({
  participantId: z.string().min(1)
});

const inviteTokenParams = z.object({ token: z.string().min(1) });

const requestIdParams = z.object({ requestId: z.string().min(1) });

const sessionRowSchema = z.object({
  id: z.string(),
  user_id: z.string(),
  expires_at: z.string(),
  revoked_at: z.string().nullable()
});

const userRowSchema = z.object({
  id: z.string(),
  username: z.string(),
  email_verified: z.number()
});

const eventRowSchema = z.object({
  id: z.string(),
  status: z.string()
});

const participantRowSchema = z.object({
  id: z.string(),
  event_id: z.string(),
  type: z.string(),
  name: z.string(),
  event_points: z.number(),
  penalty_seconds: z.number()
});

const memberRowSchema = z.object({
  id: z.string(),
  participant_id: z.string(),
  user_id: z.string(),
  role: z.string(),
  joined_at: z.string(),
  left_at: z.string().nullable()
});

const memberWithUsernameSchema = memberRowSchema.extend({
  username: z.string()
});

const inviteRowSchema = z.object({
  id: z.string(),
  participant_id: z.string(),
  invited_by: z.string(),
  token_hash: z.string().nullable(),
  requested_user_id: z.string().nullable(),
  status: z.string(),
  expires_at: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string()
});

const historyRowSchema = z.object({
  joined_at: z.string(),
  left_at: z.string().nullable()
});

const countRowSchema = z.object({
  count: z.number()
});

const runResultSchema = z
  .object({
    success: z.boolean().optional(),
    meta: z.object({ changes: z.number().optional() }).optional()
  })
  .catchall(z.unknown());

export interface VerifiedUser {
  id: string;
  username: string;
}

export type AuthResult =
  | { ok: true; user: VerifiedUser }
  | { ok: false; response: Response };

export interface StoredUser {
  id: string;
  username: string;
  emailVerified: number;
}

export interface StoredEvent {
  id: string;
  status: string;
}

export interface StoredParticipant {
  id: string;
  eventId: string;
  kind: string;
  name: string;
  eventPoints: number;
  penaltySeconds: number;
}

export interface StoredMember {
  id: string;
  participantId: string;
  userId: string;
  role: string;
  joinedAt: string;
  leftAt: string | null;
}

export interface StoredMemberWithUsername extends StoredMember {
  username: string;
}

export interface StoredInvite {
  id: string;
  participantId: string;
  invitedBy: string;
  tokenHash: string | null;
  requestedUserId: string | null;
  status: string;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MembershipChange {
  joinedAt: string;
  leftAt: string | null;
}

export function affectedRows(result: unknown): number {
  const parsed = runResultSchema.safeParse(result);
  if (parsed.success === false) {
    return 0;
  }
  return parsed.data.meta?.changes ?? 0;
}

export async function readUserById(
  db: DatabaseBinding,
  userId: string
): Promise<StoredUser | null> {
  const raw = await db
    .prepare("SELECT id, username, email_verified FROM users WHERE id = ?")
    .bind(userId)
    .first();
  const parsed = userRowSchema.safeParse(raw);
  if (parsed.success === false) {
    return null;
  }
  return {
    id: parsed.data.id,
    username: parsed.data.username,
    emailVerified: parsed.data.email_verified
  };
}

export async function readEvent(
  db: DatabaseBinding,
  eventId: string
): Promise<StoredEvent | null> {
  const raw = await db
    .prepare("SELECT id, status FROM events WHERE id = ?")
    .bind(eventId)
    .first();
  const parsed = eventRowSchema.safeParse(raw);
  if (parsed.success === false) {
    return null;
  }
  return { id: parsed.data.id, status: parsed.data.status };
}

export async function readParticipant(
  db: DatabaseBinding,
  participantId: string
): Promise<StoredParticipant | null> {
  const raw = await db
    .prepare(
      "SELECT id, event_id, type, name, event_points, penalty_seconds FROM participants WHERE id = ?"
    )
    .bind(participantId)
    .first();
  const parsed = participantRowSchema.safeParse(raw);
  if (parsed.success === false) {
    return null;
  }
  return {
    id: parsed.data.id,
    eventId: parsed.data.event_id,
    kind: parsed.data.type,
    name: parsed.data.name,
    eventPoints: parsed.data.event_points,
    penaltySeconds: parsed.data.penalty_seconds
  };
}

export async function readInviteById(
  db: DatabaseBinding,
  inviteId: string
): Promise<StoredInvite | null> {
  const raw = await db
    .prepare(
      "SELECT id, participant_id, invited_by, token_hash, requested_user_id, status, expires_at, created_at, updated_at FROM team_invites WHERE id = ?"
    )
    .bind(inviteId)
    .first();
  const parsed = inviteRowSchema.safeParse(raw);
  if (parsed.success === false) {
    return null;
  }
  return {
    id: parsed.data.id,
    participantId: parsed.data.participant_id,
    invitedBy: parsed.data.invited_by,
    tokenHash: parsed.data.token_hash,
    requestedUserId: parsed.data.requested_user_id,
    status: parsed.data.status,
    expiresAt: parsed.data.expires_at,
    createdAt: parsed.data.created_at,
    updatedAt: parsed.data.updated_at
  };
}

export async function readInviteByTokenHash(
  db: DatabaseBinding,
  tokenHash: string
): Promise<StoredInvite | null> {
  const raw = await db
    .prepare(
      "SELECT id, participant_id, invited_by, token_hash, requested_user_id, status, expires_at, created_at, updated_at FROM team_invites WHERE token_hash = ?"
    )
    .bind(tokenHash)
    .first();
  const parsed = inviteRowSchema.safeParse(raw);
  if (parsed.success === false) {
    return null;
  }
  return {
    id: parsed.data.id,
    participantId: parsed.data.participant_id,
    invitedBy: parsed.data.invited_by,
    tokenHash: parsed.data.token_hash,
    requestedUserId: parsed.data.requested_user_id,
    status: parsed.data.status,
    expiresAt: parsed.data.expires_at,
    createdAt: parsed.data.created_at,
    updatedAt: parsed.data.updated_at
  };
}

export async function readActiveMembershipForUserEvent(
  db: DatabaseBinding,
  userId: string,
  eventId: string
): Promise<StoredMember | null> {
  const raw = await db
    .prepare(
      "SELECT m.id, m.participant_id, m.user_id, m.role, m.joined_at, m.left_at FROM participant_members AS m INNER JOIN participants AS p ON p.id = m.participant_id WHERE m.user_id = ? AND p.event_id = ? AND m.left_at IS NULL"
    )
    .bind(userId, eventId)
    .first();
  const parsed = memberRowSchema.safeParse(raw);
  if (parsed.success === false) {
    return null;
  }
  return {
    id: parsed.data.id,
    participantId: parsed.data.participant_id,
    userId: parsed.data.user_id,
    role: parsed.data.role,
    joinedAt: parsed.data.joined_at,
    leftAt: parsed.data.left_at
  };
}

export async function readActiveMemberRow(
  db: DatabaseBinding,
  participantId: string,
  userId: string
): Promise<StoredMember | null> {
  const raw = await db
    .prepare(
      "SELECT id, participant_id, user_id, role, joined_at, left_at FROM participant_members WHERE participant_id = ? AND user_id = ? AND left_at IS NULL"
    )
    .bind(participantId, userId)
    .first();
  const parsed = memberRowSchema.safeParse(raw);
  if (parsed.success === false) {
    return null;
  }
  return {
    id: parsed.data.id,
    participantId: parsed.data.participant_id,
    userId: parsed.data.user_id,
    role: parsed.data.role,
    joinedAt: parsed.data.joined_at,
    leftAt: parsed.data.left_at
  };
}

export async function readActiveMembers(
  db: DatabaseBinding,
  participantId: string
): Promise<Array<StoredMemberWithUsername>> {
  const rows = (await db
    .prepare(
      "SELECT m.id, m.participant_id, m.user_id, m.role, m.joined_at, m.left_at, u.username AS username FROM participant_members AS m INNER JOIN users AS u ON u.id = m.user_id WHERE m.participant_id = ? AND m.left_at IS NULL ORDER BY m.joined_at ASC"
    )
    .bind(participantId)
    .all()).results;
  const members: Array<StoredMemberWithUsername> = [];
  for (const row of rows) {
    const parsed = memberWithUsernameSchema.safeParse(row);
    if (parsed.success) {
      members.push({
        id: parsed.data.id,
        participantId: parsed.data.participant_id,
        userId: parsed.data.user_id,
        role: parsed.data.role,
        joinedAt: parsed.data.joined_at,
        leftAt: parsed.data.left_at,
        username: parsed.data.username
      });
    }
  }
  return members;
}

export async function readUserEventHistory(
  db: DatabaseBinding,
  userId: string,
  eventId: string
): Promise<Array<MembershipChange>> {
  const rows = (await db
    .prepare(
      "SELECT m.joined_at, m.left_at FROM participant_members AS m INNER JOIN participants AS p ON p.id = m.participant_id WHERE m.user_id = ? AND p.event_id = ?"
    )
    .bind(userId, eventId)
    .all()).results;
  const changes: Array<MembershipChange> = [];
  for (const row of rows) {
    const parsed = historyRowSchema.safeParse(row);
    if (parsed.success) {
      changes.push({
        joinedAt: parsed.data.joined_at,
        leftAt: parsed.data.left_at
      });
    }
  }
  return changes;
}

export async function readTeamHistory(
  db: DatabaseBinding,
  participantId: string
): Promise<Array<MembershipChange>> {
  const rows = (await db
    .prepare(
      "SELECT joined_at, left_at FROM participant_members WHERE participant_id = ?"
    )
    .bind(participantId)
    .all()).results;
  const changes: Array<MembershipChange> = [];
  for (const row of rows) {
    const parsed = historyRowSchema.safeParse(row);
    if (parsed.success) {
      changes.push({
        joinedAt: parsed.data.joined_at,
        leftAt: parsed.data.left_at
      });
    }
  }
  return changes;
}

export async function countActiveMembers(
  db: DatabaseBinding,
  participantId: string
): Promise<number> {
  const raw = await db
    .prepare(
      "SELECT COUNT(*) AS count FROM participant_members WHERE participant_id = ? AND left_at IS NULL"
    )
    .bind(participantId)
    .first();
  const parsed = countRowSchema.safeParse(raw);
  if (parsed.success === false) {
    return 0;
  }
  return parsed.data.count;
}

/**
 * Earliest completion of a REQUIRED objective (§12.7: the late-join penalty
 * fires only after the team's first required completion, never for optional
 * objectives). Challenge configs are the source of required keys.
 */
export async function readEarliestRequiredCompletion(
  db: DatabaseBinding,
  participantId: string,
  eventId: string
): Promise<string | null> {
  const challenges = await listChallengesByEvent(db, eventId);
  const required = new Set<string>();
  for (const challenge of challenges) {
    const config = parseConfiguration(challenge.configuration_json);
    if (config === undefined) {
      continue;
    }
    for (const objective of config.objectives) {
      if (objective.required) {
        required.add(`${challenge.id}:${objective.key}`);
      }
    }
  }
  if (required.size === 0) {
    return null;
  }
  const raw = (await db
    .prepare(
      "SELECT challenge_id, objective_key, completed_at FROM objective_progress WHERE participant_id = ? AND status = 'completed' AND completed_at IS NOT NULL"
    )
    .bind(participantId)
    .all()).results;
  const rows = z
    .array(
      z.object({
        challenge_id: z.string(),
        objective_key: z.string(),
        completed_at: z.string()
      })
    )
    .safeParse(raw);
  if (rows.success === false) {
    return null;
  }
  let earliest: string | null = null;
  for (const row of rows.data) {
    if (required.has(`${row.challenge_id}:${row.objective_key}`) === false) {
      continue;
    }
    if (earliest === null || row.completed_at < earliest) {
      earliest = row.completed_at;
    }
  }
  return earliest;
}

export async function readEventPenaltySeconds(
  db: DatabaseBinding,
  eventId: string
): Promise<number> {
  const raw = await db
    .prepare("SELECT settings_json FROM events WHERE id = ?")
    .bind(eventId)
    .first();
  const parsed = z.object({ settings_json: z.string() }).safeParse(raw);
  if (parsed.success === false) {
    return LATE_JOIN_PENALTY_SECONDS;
  }
  let decoded: unknown;
  try {
    decoded = JSON.parse(parsed.data.settings_json);
  } catch {
    return LATE_JOIN_PENALTY_SECONDS;
  }
  const settings = eventSettingsSchema.safeParse(decoded);
  if (settings.success === false) {
    return LATE_JOIN_PENALTY_SECONDS;
  }
  return settings.data.lateJoinPenaltySeconds;
}

export async function requireVerifiedUser(
  c: AppContext
): Promise<AuthResult> {
  const attached = c.get("user");
  if (attached !== undefined) {
    const stored = await readUserById(c.env.DB, attached.id);
    if (stored === null) {
      return {
        ok: false,
        response: errorResponse(c, "UNAUTHENTICATED", "Invalid session")
      };
    }
    if (stored.emailVerified !== 1) {
      return {
        ok: false,
        response: errorResponse(c, "FORBIDDEN", "Email verification required")
      };
    }
    return { ok: true, user: { id: stored.id, username: stored.username } };
  }
  const token =
    c.get("sessionToken") ??
    getCookie(c, "cmp_session") ??
    getCookie(c, "session");
  if (token === undefined || token.length === 0) {
    return {
      ok: false,
      response: errorResponse(c, "UNAUTHENTICATED", "Authentication required")
    };
  }
  const now = nowIso();
  const tokenHash = await sha256Hex(token);
  const sessionRaw = await c.env.DB.prepare(
    "SELECT id, user_id, expires_at, revoked_at FROM sessions WHERE token_hash = ?"
  )
    .bind(tokenHash)
    .first();
  const session = sessionRowSchema.safeParse(sessionRaw);
  if (session.success === false) {
    return {
      ok: false,
      response: errorResponse(c, "UNAUTHENTICATED", "Invalid session")
    };
  }
  if (session.data.revoked_at !== null || session.data.expires_at <= now) {
    return {
      ok: false,
      response: errorResponse(c, "UNAUTHENTICATED", "Session expired")
    };
  }
  const user = await readUserById(c.env.DB, session.data.user_id);
  if (user === null) {
    return {
      ok: false,
      response: errorResponse(c, "UNAUTHENTICATED", "Invalid session")
    };
  }
  if (user.emailVerified !== 1) {
    return {
      ok: false,
      response: errorResponse(c, "FORBIDDEN", "Email verification required")
    };
  }
  return { ok: true, user: { id: user.id, username: user.username } };
}

export function userCooldownRemainingSeconds(
  changes: Array<MembershipChange>,
  nowMs: number
): number {
  const windowMs = JOIN_LEAVE_COOLDOWN_SECONDS * 1000;
  let latest = 0;
  for (const change of changes) {
    const joinedMs = Date.parse(change.joinedAt);
    if (Number.isNaN(joinedMs) === false && joinedMs > latest) {
      latest = joinedMs;
    }
    if (change.leftAt !== null) {
      const leftMs = Date.parse(change.leftAt);
      if (Number.isNaN(leftMs) === false && leftMs > latest) {
        latest = leftMs;
      }
    }
  }
  if (latest === 0) {
    return 0;
  }
  const elapsedMs = nowMs - latest;
  if (elapsedMs >= windowMs) {
    return 0;
  }
  return Math.ceil((windowMs - elapsedMs) / 1000);
}

export function countRecentTeamChanges(
  changes: Array<MembershipChange>,
  nowMs: number
): number {
  const windowMs = TEAM_APPROVAL_WINDOW_SECONDS * 1000;
  let total = 0;
  for (const change of changes) {
    const joinedMs = Date.parse(change.joinedAt);
    if (Number.isNaN(joinedMs) === false && nowMs - joinedMs < windowMs) {
      total += 1;
    }
    if (change.leftAt !== null) {
      const leftMs = Date.parse(change.leftAt);
      if (Number.isNaN(leftMs) === false && nowMs - leftMs < windowMs) {
        total += 1;
      }
    }
  }
  return total;
}

export const teamsRouter = new Hono<AppEnv>();

/** Lifecycle gate for every roster mutation (§9.1, §19.6). */
function rosterGate(c: AppContext, event: StoredEvent): Response | null {
  const gate = rosterGateStatus(event.status);
  if (gate === null) {
    return null;
  }
  if (gate === "EVENT_NOT_FOUND") {
    return errorResponse(c, "EVENT_NOT_FOUND", "Event not found");
  }
  return errorResponse(c, "EVENT_NOT_LIVE", "Team changes are closed for this event");
}

teamsRouter.post("/api/events/:eventId/teams", async (c) => {
  const params = eventIdParams.safeParse({
    eventId: c.req.param("eventId")
  });
  if (params.success === false) {
    return errorResponse(c, "VALIDATION_ERROR", "Invalid event id");
  }
  const raw: unknown = await c.req.json().catch(() => ({}));
  const body = createTeamSchema.safeParse(raw);
  if (body.success === false) {
    const message =
      body.error.issues[0]?.message ?? "Invalid team name";
    return errorResponse(c, "VALIDATION_ERROR", message);
  }
  const auth = await requireVerifiedUser(c);
  if (auth.ok === false) {
    return auth.response;
  }
  const db = c.env.DB;
  const now = nowIso();
  const eventId = params.data.eventId;
  const event = await readEvent(db, eventId);
  if (event === null) {
    return errorResponse(c, "EVENT_NOT_FOUND", "Event not found");
  }
  const gated = rosterGate(c, event);
  if (gated !== null) {
    return gated;
  }
  const clash = await db
    .prepare(
      "SELECT id FROM participants WHERE event_id = ? AND type = 'team' AND name = ? COLLATE NOCASE"
    )
    .bind(eventId, body.data.name)
    .first();
  if (clash !== null) {
    return errorResponse(
      c,
      "CONFLICT",
      "Team name already taken for this event"
    );
  }
  const existing = await readActiveMembershipForUserEvent(
    db,
    auth.user.id,
    eventId
  );
  if (existing !== null) {
    return errorResponse(
      c,
      "CONFLICT",
      "Already participating in this event"
    );
  }
  const history = await readUserEventHistory(db, auth.user.id, eventId);
  const cooldown = userCooldownRemainingSeconds(history, Date.parse(now));
  if (cooldown > 0) {
    return errorResponse(
      c,
      "MEMBERSHIP_COOLDOWN",
      "Membership changed too recently",
      { details: { retryAfterSeconds: cooldown } }
    );
  }
  const participantId = newId();
  // Conditional inserts: a concurrent duplicate creation collapses onto the
  // surviving row; the re-read below decides the outcome (§21.5).
  await db.batch([
    db
      .prepare(
        "INSERT INTO participants (id, event_id, type, name, event_points, penalty_seconds, started_at, completed_at, created_at, updated_at) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM participant_members m JOIN participants p ON p.id = m.participant_id WHERE m.user_id = ? AND m.left_at IS NULL AND p.event_id = ?) AND NOT EXISTS (SELECT 1 FROM participants WHERE event_id = ? AND type = 'team' AND name = ? COLLATE NOCASE)"
      )
      .bind(
        participantId,
        eventId,
        "team",
        body.data.name,
        0,
        0,
        null,
        null,
        now,
        now,
        auth.user.id,
        eventId,
        eventId,
        body.data.name
      ),
    db
      .prepare(
        "INSERT INTO participant_members (id, participant_id, user_id, role, joined_at, left_at) SELECT ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM participants WHERE id = ?)"
      )
      .bind(newId(), participantId, auth.user.id, "captain", now, null, participantId)
  ]);
  const createdParticipant = await readParticipant(db, participantId);
  if (createdParticipant === null) {
    const raced = await readActiveMembershipForUserEvent(db, auth.user.id, eventId);
    if (raced !== null) {
      return errorResponse(c, "CONFLICT", "Already participating in this event");
    }
    return errorResponse(c, "CONFLICT", "Team name already taken for this event");
  }
  return c.json(
    {
      participant: {
        id: participantId,
        eventId,
        type: "team",
        name: body.data.name,
        penaltySeconds: 0
      },
      captain: {
        userId: auth.user.id,
        username: auth.user.username,
        role: "captain",
        joinedAt: now
      }
    },
    201
  );
});

teamsRouter.post("/api/participants/:participantId/invites", async (c) => {
  const params = participantIdParams.safeParse({
    participantId: c.req.param("participantId")
  });
  if (params.success === false) {
    return errorResponse(c, "VALIDATION_ERROR", "Invalid participant id");
  }
  const raw: unknown = await c.req.json().catch(() => ({}));
  const body = createInviteSchema.safeParse(raw);
  if (body.success === false) {
    return errorResponse(c, "VALIDATION_ERROR", "Invalid invite options");
  }
  const auth = await requireVerifiedUser(c);
  if (auth.ok === false) {
    return auth.response;
  }
  const db = c.env.DB;
  const now = nowIso();
  const participant = await readParticipant(db, params.data.participantId);
  if (participant === null) {
    return errorResponse(c, "NOT_FOUND", "Participant not found");
  }
  if (participant.kind !== "team") {
    return errorResponse(c, "CONFLICT", "Only teams can create invites");
  }
  const inviteEvent = await readEvent(db, participant.eventId);
  if (inviteEvent === null) {
    return errorResponse(c, "EVENT_NOT_FOUND", "Event not found");
  }
  const inviteGated = rosterGate(c, inviteEvent);
  if (inviteGated !== null) {
    return inviteGated;
  }
  const caller = await readActiveMemberRow(
    db,
    participant.id,
    auth.user.id
  );
  if (caller === null || canManageMembers(caller.role) === false) {
    return errorResponse(
      c,
      "FORBIDDEN",
      "Only the captain or a member manager can invite"
    );
  }
  const expiresAt =
    body.data.expiresAt ??
    new Date(Date.parse(now) + DEFAULT_INVITE_EXPIRY_SECONDS * 1000).toISOString();
  if (expiresAt <= now) {
    return errorResponse(
      c,
      "VALIDATION_ERROR",
      "Invite expiry must be in the future"
    );
  }
  const token = `${newId()}${newId()}`;
  const tokenHash = await sha256Hex(token);
  const inviteId = newId();
  await db
    .prepare(
      "INSERT INTO team_invites (id, participant_id, invited_by, token_hash, requested_user_id, status, expires_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?)"
    )
    .bind(
      inviteId,
      participant.id,
      auth.user.id,
      tokenHash,
      null,
      expiresAt,
      now,
      now
    )
    .run();
  return c.json(
    {
      invite: {
        id: inviteId,
        participantId: participant.id,
        status: "pending",
        expiresAt
      },
      token
    },
    201
  );
});

teamsRouter.post("/api/invites/:token/request", async (c) => {
  const params = inviteTokenParams.safeParse({
    token: c.req.param("token")
  });
  if (params.success === false) {
    return errorResponse(c, "VALIDATION_ERROR", "Invalid invite token");
  }
  const db = c.env.DB;
  const now = nowIso();
  const tokenHash = await sha256Hex(params.data.token);
  const invite = await readInviteByTokenHash(db, tokenHash);
  if (
    invite === null ||
    invite.status !== "pending" ||
    invite.tokenHash === null
  ) {
    return errorResponse(c, "NOT_FOUND", "Invite not found or expired");
  }
  if (invite.expiresAt !== null && invite.expiresAt <= now) {
    await db
      .prepare(
        "UPDATE team_invites SET status = ?, updated_at = ? WHERE id = ? AND status = 'pending'"
      )
      .bind("expired", now, invite.id)
      .run();
    return errorResponse(c, "NOT_FOUND", "Invite expired");
  }
  const auth = await requireVerifiedUser(c);
  if (auth.ok === false) {
    return auth.response;
  }
  const participant = await readParticipant(db, invite.participantId);
  if (participant === null || participant.kind !== "team") {
    return errorResponse(c, "NOT_FOUND", "Team not found");
  }
  const requestEvent = await readEvent(db, participant.eventId);
  if (requestEvent === null) {
    return errorResponse(c, "EVENT_NOT_FOUND", "Event not found");
  }
  const requestGated = rosterGate(c, requestEvent);
  if (requestGated !== null) {
    return requestGated;
  }
  const existing = await readActiveMembershipForUserEvent(
    db,
    auth.user.id,
    participant.eventId
  );
  if (existing !== null) {
    return errorResponse(
      c,
      "CONFLICT",
      "Already participating in this event"
    );
  }
  const duplicate = await db
    .prepare(
      "SELECT id FROM team_invites WHERE participant_id = ? AND requested_user_id = ? AND status = 'pending'"
    )
    .bind(participant.id, auth.user.id)
    .first();
  if (duplicate !== null) {
    return errorResponse(c, "CONFLICT", "Join request already pending");
  }
  const history = await readUserEventHistory(
    db,
    auth.user.id,
    participant.eventId
  );
  const cooldown = userCooldownRemainingSeconds(history, Date.parse(now));
  if (cooldown > 0) {
    return errorResponse(
      c,
      "MEMBERSHIP_COOLDOWN",
      "Membership changed too recently",
      { details: { retryAfterSeconds: cooldown } }
    );
  }
  const requestId = newId();
  // The pending-request partial unique index is the backstop: a concurrent
  // duplicate insert fails here and surfaces as CONFLICT instead of a second
  // approvable row.
  try {
    await db
      .prepare(
        "INSERT INTO team_invites (id, participant_id, invited_by, token_hash, requested_user_id, status, expires_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?)"
      )
      .bind(
        requestId,
        participant.id,
        auth.user.id,
        null,
        auth.user.id,
        invite.expiresAt,
        now,
        now
      )
      .run();
  } catch {
    return errorResponse(c, "CONFLICT", "Join request already pending");
  }
  const earliestCompletion = await readEarliestRequiredCompletion(
    db,
    participant.id,
    participant.eventId
  );
  return c.json(
    {
      request: {
        id: requestId,
        participantId: participant.id,
        status: "pending",
        createdAt: now
      },
      wouldIncurLateJoinPenalty: earliestCompletion !== null
    },
    201
  );
});

teamsRouter.post("/api/join-requests/:requestId/approve", async (c) => {
  const params = requestIdParams.safeParse({
    requestId: c.req.param("requestId")
  });
  if (params.success === false) {
    return errorResponse(c, "VALIDATION_ERROR", "Invalid request id");
  }
  const auth = await requireVerifiedUser(c);
  if (auth.ok === false) {
    return auth.response;
  }
  const db = c.env.DB;
  const now = nowIso();
  const nowMs = Date.parse(now);
  const request = await readInviteById(db, params.data.requestId);
  if (request === null) {
    return errorResponse(c, "NOT_FOUND", "Join request not found");
  }
  if (request.requestedUserId === null) {
    return errorResponse(
      c,
      "CONFLICT",
      "Invite links cannot be approved directly"
    );
  }
  if (request.status !== "pending") {
    return errorResponse(c, "CONFLICT", "Join request already decided");
  }
  const participant = await readParticipant(db, request.participantId);
  if (participant === null || participant.kind !== "team") {
    return errorResponse(c, "NOT_FOUND", "Team not found");
  }
  const approveEvent = await readEvent(db, participant.eventId);
  if (approveEvent === null) {
    return errorResponse(c, "EVENT_NOT_FOUND", "Event not found");
  }
  const approveGated = rosterGate(c, approveEvent);
  if (approveGated !== null) {
    return approveGated;
  }
  const approver = await readActiveMemberRow(
    db,
    participant.id,
    auth.user.id
  );
  if (approver === null || canManageMembers(approver.role) === false) {
    return errorResponse(
      c,
      "FORBIDDEN",
      "Only the captain or a member manager can approve requests"
    );
  }
  const target = await readUserById(db, request.requestedUserId);
  if (target === null) {
    return errorResponse(c, "NOT_FOUND", "Requesting user not found");
  }
  const targetActive = await readActiveMembershipForUserEvent(
    db,
    target.id,
    participant.eventId
  );
  if (targetActive !== null) {
    return errorResponse(
      c,
      "CONFLICT",
      "User already participates in this event"
    );
  }
  const targetHistory = await readUserEventHistory(
    db,
    target.id,
    participant.eventId
  );
  const targetCooldown = userCooldownRemainingSeconds(targetHistory, nowMs);
  if (targetCooldown > 0) {
    return errorResponse(
      c,
      "MEMBERSHIP_COOLDOWN",
      "User changed membership too recently",
      { details: { retryAfterSeconds: targetCooldown } }
    );
  }
  const teamHistory = await readTeamHistory(db, participant.id);
  if (
    countRecentTeamChanges(teamHistory, nowMs) >=
    MAX_MEMBERSHIP_CHANGES_PER_WINDOW
  ) {
    return errorResponse(
      c,
      "MEMBERSHIP_COOLDOWN",
      "Team changed membership too often"
    );
  }
  const activeCount = await countActiveMembers(db, participant.id);
  if (activeCount >= MAX_TEAM_SIZE) {
    return errorResponse(c, "TEAM_FULL", "Team is full");
  }
  const earliestCompletion = await readEarliestRequiredCompletion(
    db,
    participant.id,
    participant.eventId
  );
  const configuredPenalty = await readEventPenaltySeconds(db, participant.eventId);
  const penalty = earliestCompletion === null ? 0 : configuredPenalty;
  const memberId = newId();
  const penaltyId = penalty > 0 ? newId() : null;
  const statements: Array<PreparedStatementBinding> = [
    db
      .prepare(
        "INSERT INTO participant_members (id, participant_id, user_id, role, joined_at, left_at) SELECT ?, ?, ?, ?, ?, ? WHERE (SELECT COUNT(*) FROM participant_members WHERE participant_id = ? AND left_at IS NULL) < ? AND NOT EXISTS (SELECT 1 FROM participant_members WHERE participant_id = ? AND user_id = ? AND left_at IS NULL) AND EXISTS (SELECT 1 FROM team_invites WHERE id = ? AND status = 'pending')"
      )
      .bind(
        memberId,
        participant.id,
        target.id,
        "member",
        now,
        null,
        participant.id,
        MAX_TEAM_SIZE,
        participant.id,
        target.id,
        request.id
      ),
    db
      .prepare(
        "UPDATE team_invites SET status = ?, updated_at = ? WHERE id = ? AND status = 'pending' AND EXISTS (SELECT 1 FROM participant_members WHERE id = ?)"
      )
      .bind("approved", now, request.id, memberId)
  ];
  if (penalty > 0 && penaltyId !== null) {
    // The late-join penalty is a first-class penalty row (reason late_join)
    // so organisers can waive it with an audit trail (§12.7).
    statements.push(
      db
        .prepare(
          "INSERT INTO penalties (id, participant_id, admin_user_id, seconds, reason, waived, created_at, updated_at, waived_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
        )
        .bind(
          penaltyId,
          participant.id,
          auth.user.id,
          penalty,
          "late_join",
          0,
          now,
          now,
          null
        )
    );
    statements.push(
      db
        .prepare(
          "UPDATE participants SET penalty_seconds = penalty_seconds + ?, updated_at = ? WHERE id = ? AND EXISTS (SELECT 1 FROM participant_members WHERE id = ?)"
        )
        .bind(penalty, now, participant.id, memberId)
    );
  }
  const results = await db.batch(statements);
  if (affectedRows(results[0]) !== 1) {
    const freshCount = await countActiveMembers(db, participant.id);
    if (freshCount >= MAX_TEAM_SIZE) {
      return errorResponse(c, "TEAM_FULL", "Team is full");
    }
    return errorResponse(c, "CONFLICT", "Unable to approve join request");
  }
  if (affectedRows(results[1]) !== 1) {
    return errorResponse(c, "CONFLICT", "Join request already decided");
  }
  if (penalty > 0 && (affectedRows(results[2]) !== 1 || affectedRows(results[3]) !== 1)) {
    return errorResponse(
      c,
      "INTERNAL",
      "Membership approved but the late-join penalty was not recorded"
    );
  }
  return c.json({
    member: {
      userId: target.id,
      username: target.username,
      role: "member",
      joinedAt: now
    },
    request: { id: request.id, status: "approved" },
    lateJoinPenaltyApplied: penalty > 0,
    penaltySeconds: participant.penaltySeconds + penalty,
    penaltyId
  });
});

teamsRouter.post("/api/join-requests/:requestId/reject", async (c) => {
  const params = requestIdParams.safeParse({
    requestId: c.req.param("requestId")
  });
  if (params.success === false) {
    return errorResponse(c, "VALIDATION_ERROR", "Invalid request id");
  }
  const auth = await requireVerifiedUser(c);
  if (auth.ok === false) {
    return auth.response;
  }
  const db = c.env.DB;
  const now = nowIso();
  const request = await readInviteById(db, params.data.requestId);
  if (request === null) {
    return errorResponse(c, "NOT_FOUND", "Join request not found");
  }
  if (request.requestedUserId === null) {
    return errorResponse(
      c,
      "CONFLICT",
      "Invite links cannot be rejected directly"
    );
  }
  if (request.status !== "pending") {
    return errorResponse(c, "CONFLICT", "Join request already decided");
  }
  const participant = await readParticipant(db, request.participantId);
  if (participant === null || participant.kind !== "team") {
    return errorResponse(c, "NOT_FOUND", "Team not found");
  }
  const rejectEvent = await readEvent(db, participant.eventId);
  if (rejectEvent === null) {
    return errorResponse(c, "EVENT_NOT_FOUND", "Event not found");
  }
  const rejectGated = rosterGate(c, rejectEvent);
  if (rejectGated !== null) {
    return rejectGated;
  }
  const approver = await readActiveMemberRow(
    db,
    participant.id,
    auth.user.id
  );
  if (approver === null || canManageMembers(approver.role) === false) {
    return errorResponse(
      c,
      "FORBIDDEN",
      "Only the captain or a member manager can reject requests"
    );
  }
  const updated = await db
    .prepare(
      "UPDATE team_invites SET status = ?, updated_at = ? WHERE id = ? AND status = 'pending'"
    )
    .bind("rejected", now, request.id)
    .run();
  if (affectedRows(updated) !== 1) {
    return errorResponse(c, "CONFLICT", "Join request already decided");
  }
  return c.json({ request: { id: request.id, status: "rejected" } });
});

const pendingRequestRowSchema = z.object({
  id: z.string(),
  requested_user_id: z.string(),
  username: z.string(),
  created_at: z.string()
});

teamsRouter.get("/api/events/:eventId/membership", async (c) => {
  const params = eventIdParams.safeParse({
    eventId: c.req.param("eventId")
  });
  if (params.success === false) {
    return errorResponse(c, "VALIDATION_ERROR", "Invalid event id");
  }
  const auth = await requireVerifiedUser(c);
  if (auth.ok === false) {
    return auth.response;
  }
  const db = c.env.DB;
  const event = await readEvent(db, params.data.eventId);
  if (
    event === null ||
    event.status === "draft" ||
    event.status === "testing" ||
    event.status === "archived"
  ) {
    return errorResponse(c, "EVENT_NOT_FOUND", "Event not found");
  }
  const membership = await readActiveMembershipForUserEvent(
    db,
    auth.user.id,
    event.id
  );
  if (membership === null) {
    return c.json({ participant: null });
  }
  const participant = await readParticipant(db, membership.participantId);
  if (participant === null) {
    return errorResponse(c, "NOT_FOUND", "Participant not found");
  }
  const members = await readActiveMembers(db, participant.id);
  const caller = members.find((member) => member.userId === auth.user.id);
  const canManage = caller !== undefined && canManageMembers(caller.role);
  let pendingRequests: Array<{
    id: string;
    userId: string;
    username: string;
    createdAt: string;
  }> = [];
  if (canManage) {
    const raw = (await db
      .prepare(
        "SELECT t.id, t.requested_user_id, u.username AS username, t.created_at FROM team_invites AS t INNER JOIN users AS u ON u.id = t.requested_user_id WHERE t.participant_id = ? AND t.status = 'pending' AND t.requested_user_id IS NOT NULL ORDER BY t.created_at ASC"
      )
      .bind(participant.id)
      .all()).results;
    const parsed = z.array(pendingRequestRowSchema).safeParse(raw);
    if (parsed.success) {
      pendingRequests = parsed.data.map((row) => ({
        id: row.id,
        userId: row.requested_user_id,
        username: row.username,
        createdAt: row.created_at
      }));
    }
  }
  return c.json({
    participant: {
      id: participant.id,
      eventId: participant.eventId,
      type: participant.kind,
      name: participant.name,
      eventPoints: participant.eventPoints,
      penaltySeconds: participant.penaltySeconds
    },
    members: members.map((member) => ({
      userId: member.userId,
      username: member.username,
      role: member.role
    })),
    pendingRequests,
    canManage
  });
});
