/** Participant-facing event routes: discovery, registration, start, state. */
import { Hono } from "hono";
import { z } from "zod";
import {
  eventSettingsSchema,
  isPublishedStatus,
  PUBLISHED_STATUSES
} from "@campus/shared";
import type { AppEnv, DatabaseBinding } from "../env";
import { timingSafeEqual } from "../lib/crypto";
import { errorResponse } from "../lib/errors";
import { nowIso } from "../lib/time";

const eventIdParams = z.object({ eventId: z.string().min(1) });

const eventListQuery = z
  .object({
    status: z
      .enum(["draft", "testing", "scheduled", "live", "paused", "completed", "archived"])
      .optional()
  })
  .catchall(z.unknown());

const registerBody = z.object({
  participation: z.enum(["solo", "team"]).optional(),
  name: z.string().min(1).max(200).optional(),
  accessCode: z.string().min(1).max(128).optional()
});

const eventRowSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  description: z.string().nullable(),
  status: z.string(),
  starts_at: z.string().nullable(),
  ends_at: z.string().nullable(),
  settings_json: z.string(),
  created_by: z.string(),
  created_at: z.string(),
  updated_at: z.string()
});

type EventRow = z.infer<typeof eventRowSchema>;

const participantRowSchema = z.object({
  id: z.string(),
  event_id: z.string(),
  type: z.string(),
  name: z.string(),
  event_points: z.number(),
  penalty_seconds: z.number(),
  started_at: z.string().nullable(),
  completed_at: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string()
});

type ParticipantRow = z.infer<typeof participantRowSchema>;

const memberRowSchema = z.object({
  id: z.string(),
  participant_id: z.string(),
  user_id: z.string(),
  role: z.string(),
  joined_at: z.string(),
  left_at: z.string().nullable()
});

const challengeRowSchema = z.object({
  id: z.string(),
  event_id: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  position: z.number(),
  configuration_json: z.string(),
  created_at: z.string(),
  updated_at: z.string()
});

const announcementRowSchema = z.object({
  id: z.string(),
  event_id: z.string(),
  title: z.string(),
  body: z.string(),
  created_at: z.string(),
  created_by: z.string(),
  published_at: z.string().nullable()
});

const approvedInviteRowSchema = z.object({
  participant_id: z.string()
});

const EVENT_COLUMNS =
  "id, name, slug, description, status, starts_at, ends_at, settings_json, created_by, created_at, updated_at";

function publicEvent(row: EventRow): Record<string, unknown> {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    status: row.status,
    startsAt: row.starts_at,
    endsAt: row.ends_at
  };
}

function participantShape(row: ParticipantRow): Record<string, unknown> {
  return {
    id: row.id,
    eventId: row.event_id,
    type: row.type,
    name: row.name,
    eventPoints: row.event_points,
    penaltySeconds: row.penalty_seconds,
    startedAt: row.started_at,
    completedAt: row.completed_at
  };
}

async function findEvent(
  db: DatabaseBinding,
  key: string
): Promise<EventRow | null> {
  const raw: unknown = await db
    .prepare(`SELECT ${EVENT_COLUMNS} FROM events WHERE id = ? OR slug = ? LIMIT 1`)
    .bind(key, key)
    .first();
  if (raw === null) {
    return null;
  }
  return eventRowSchema.parse(raw);
}

async function getParticipant(
  db: DatabaseBinding,
  participantId: string
): Promise<ParticipantRow | null> {
  const raw: unknown = await db
    .prepare(
      "SELECT id, event_id, type, name, event_points, penalty_seconds, started_at, completed_at, created_at, updated_at FROM participants WHERE id = ? LIMIT 1"
    )
    .bind(participantId)
    .first();
  if (raw === null) {
    return null;
  }
  return participantRowSchema.parse(raw);
}

async function findActiveParticipant(
  db: DatabaseBinding,
  eventId: string,
  userId: string
): Promise<ParticipantRow | null> {
  const raw: unknown = await db
    .prepare(
      "SELECT id, participant_id, user_id, role, joined_at, left_at FROM participant_members WHERE user_id = ?"
    )
    .bind(userId)
    .all();
  const members = z.array(memberRowSchema).parse(raw);
  for (const member of members) {
    if (member.left_at !== null) {
      continue;
    }
    const participant = await getParticipant(db, member.participant_id);
    if (participant !== null && participant.event_id === eventId) {
      return participant;
    }
  }
  return null;
}

async function hasApprovedInvite(
  db: DatabaseBinding,
  eventId: string,
  userId: string
): Promise<boolean> {
  const raw: unknown = await db
    .prepare(
      "SELECT participant_id FROM team_invites WHERE requested_user_id = ? AND status = ?"
    )
    .bind(userId, "approved")
    .all();
  const invites = z.array(approvedInviteRowSchema).parse(raw);
  for (const invite of invites) {
    const participant = await getParticipant(db, invite.participant_id);
    if (participant !== null && participant.event_id === eventId) {
      return true;
    }
  }
  return false;
}

function emailDomain(email: string): string | null {
  const parts = email.split("@");
  const domain = parts[1];
  if (domain === undefined || domain.length === 0) {
    return null;
  }
  return domain.toLowerCase();
}

export const eventsRouter = new Hono<AppEnv>();

eventsRouter.get("/api/events", async (c) => {
  const query = eventListQuery.safeParse(c.req.query());
  if (query.success === false) {
    return errorResponse(c, "VALIDATION_ERROR", "Invalid query parameters");
  }
  const requested = query.data.status;
  if (
    requested !== undefined &&
    PUBLISHED_STATUSES.includes(requested) === false
  ) {
    return c.json({ events: [] });
  }
  const statuses: readonly string[] =
    requested === undefined ? PUBLISHED_STATUSES : [requested];
  const placeholders = statuses.map(() => "?").join(", ");
  const raw: unknown = await c.env.DB.prepare(
    `SELECT ${EVENT_COLUMNS} FROM events WHERE status IN (${placeholders}) ORDER BY starts_at ASC`
  )
    .bind(...statuses)
    .all();
  const rows = z.array(eventRowSchema).parse(raw);
  return c.json({ events: rows.map(publicEvent) });
});

eventsRouter.get("/api/events/:eventId", async (c) => {
  const params = eventIdParams.safeParse({
    eventId: c.req.param("eventId")
  });
  if (params.success === false) {
    return errorResponse(c, "VALIDATION_ERROR", "Invalid event id");
  }
  const event = await findEvent(c.env.DB, params.data.eventId);
  if (event === null || isPublishedStatus(event.status) === false) {
    return errorResponse(c, "EVENT_NOT_FOUND", "Event not found");
  }
  const challengesRaw: unknown = await c.env.DB.prepare(
    "SELECT id FROM challenges WHERE event_id = ?"
  )
    .bind(event.id)
    .all();
  const challengeIds = z.array(z.object({ id: z.string() })).parse(challengesRaw);
  return c.json({
    event: { ...publicEvent(event), challengeCount: challengeIds.length }
  });
});

eventsRouter.post("/api/events/:eventId/register", async (c) => {
  const params = eventIdParams.safeParse({
    eventId: c.req.param("eventId")
  });
  if (params.success === false) {
    return errorResponse(c, "VALIDATION_ERROR", "Invalid event id");
  }
  const rawBody: unknown = await c.req.json().catch(() => ({}));
  const body = registerBody.safeParse(rawBody);
  if (body.success === false) {
    return errorResponse(c, "VALIDATION_ERROR", "Invalid registration");
  }
  const user = c.get("user");
  if (user === undefined) {
    return errorResponse(c, "UNAUTHENTICATED", "Authentication required");
  }
  const event = await findEvent(c.env.DB, params.data.eventId);
  if (
    event === null ||
    ["draft", "testing", "archived"].includes(event.status)
  ) {
    return errorResponse(c, "EVENT_NOT_FOUND", "Event not found");
  }
  if (event.status === "completed") {
    return errorResponse(c, "EVENT_NOT_LIVE", "Registration is closed");
  }
  const existing = await findActiveParticipant(c.env.DB, event.id, user.id);
  if (existing !== null) {
    return c.json({ participant: participantShape(existing) });
  }
  let settingsJson: unknown;
  try {
    settingsJson = JSON.parse(event.settings_json);
  } catch {
    return errorResponse(c, "INTERNAL", "Event configuration is invalid");
  }
  const settings = eventSettingsSchema.parse(settingsJson);
  const policy = settings.registration;
  if (policy.type === "access_code") {
    const provided = body.data.accessCode;
    if (
      provided === undefined ||
      timingSafeEqual(provided, policy.code) === false
    ) {
      return errorResponse(c, "FORBIDDEN", "Invalid access code");
    }
  } else if (policy.type === "email_domain") {
    const domain = emailDomain(user.email);
    const allowed = policy.domains.map((entry) => entry.toLowerCase());
    if (domain === null || allowed.includes(domain) === false) {
      return errorResponse(c, "FORBIDDEN", "Email domain is not allowed");
    }
  } else if (
    policy.type === "invite_only" ||
    policy.type === "approval_required"
  ) {
    const approved = await hasApprovedInvite(c.env.DB, event.id, user.id);
    if (approved === false) {
      return errorResponse(c, "FORBIDDEN", "REGISTRATION_REQUIRED", {
        details: { policy: policy.type }
      });
    }
  }
  const now = nowIso();
  const type = body.data.participation ?? "solo";
  const localPart = user.email.split("@")[0] ?? "player";
  const name =
    body.data.name ?? (type === "team" ? `${localPart}'s team` : localPart);
  const participantId = crypto.randomUUID();
  const memberId = crypto.randomUUID();
  const role = type === "team" ? "captain" : "member";
  await c.env.DB.batch([
    c.env.DB.prepare(
      "INSERT INTO participants (id, event_id, type, name, event_points, penalty_seconds, started_at, completed_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).bind(
      participantId,
      event.id,
      type,
      name,
      0,
      0,
      null,
      null,
      now,
      now
    ),
    c.env.DB.prepare(
      "INSERT INTO participant_members (id, participant_id, user_id, role, joined_at, left_at) VALUES (?, ?, ?, ?, ?, ?)"
    ).bind(memberId, participantId, user.id, role, now, null)
  ]);
  const created = await getParticipant(c.env.DB, participantId);
  if (created === null) {
    return errorResponse(c, "INTERNAL", "Registration failed");
  }
  return c.json({ participant: participantShape(created) }, 201);
});

eventsRouter.post("/api/events/:eventId/start", async (c) => {
  const params = eventIdParams.safeParse({
    eventId: c.req.param("eventId")
  });
  if (params.success === false) {
    return errorResponse(c, "VALIDATION_ERROR", "Invalid event id");
  }
  const user = c.get("user");
  if (user === undefined) {
    return errorResponse(c, "UNAUTHENTICATED", "Authentication required");
  }
  const event = await findEvent(c.env.DB, params.data.eventId);
  if (
    event === null ||
    ["draft", "testing", "archived"].includes(event.status)
  ) {
    return errorResponse(c, "EVENT_NOT_FOUND", "Event not found");
  }
  if (event.status === "paused") {
    return errorResponse(c, "EVENT_PAUSED", "Event is paused");
  }
  if (event.status !== "live") {
    return errorResponse(c, "EVENT_NOT_LIVE", "Event is not live");
  }
  const participant = await findActiveParticipant(c.env.DB, event.id, user.id);
  if (participant === null) {
    return errorResponse(c, "NOT_FOUND", "No participant entry for this event");
  }
  if (participant.started_at !== null) {
    return c.json({ participant: participantShape(participant) });
  }
  const now = nowIso();
  await c.env.DB.batch([
    c.env.DB.prepare(
      "UPDATE participants SET started_at = ?, updated_at = ? WHERE id = ?"
    ).bind(now, now, participant.id)
  ]);
  const updated = await getParticipant(c.env.DB, participant.id);
  if (updated === null) {
    return errorResponse(c, "INTERNAL", "Failed to start event");
  }
  return c.json({ participant: participantShape(updated) });
});

eventsRouter.get("/api/events/:eventId/state", async (c) => {
  const params = eventIdParams.safeParse({
    eventId: c.req.param("eventId")
  });
  if (params.success === false) {
    return errorResponse(c, "VALIDATION_ERROR", "Invalid event id");
  }
  const user = c.get("user");
  if (user === undefined) {
    return errorResponse(c, "UNAUTHENTICATED", "Authentication required");
  }
  const event = await findEvent(c.env.DB, params.data.eventId);
  if (event === null || isPublishedStatus(event.status) === false) {
    return errorResponse(c, "EVENT_NOT_FOUND", "Event not found");
  }
  const participant = await findActiveParticipant(c.env.DB, event.id, user.id);
  const challengesRaw: unknown = await c.env.DB.prepare(
    "SELECT id, event_id, title, description, position, configuration_json, created_at, updated_at FROM challenges WHERE event_id = ? ORDER BY position ASC"
  )
    .bind(event.id)
    .all();
  const challengeRows = z.array(challengeRowSchema).parse(challengesRaw);
  const participantsRaw: unknown = await c.env.DB.prepare(
    "SELECT id FROM participants WHERE event_id = ?"
  )
    .bind(event.id)
    .all();
  const participantIds = z.array(z.object({ id: z.string() })).parse(participantsRaw);
  const announcementsRaw: unknown = await c.env.DB.prepare(
    "SELECT id, event_id, title, body, created_at, created_by, published_at FROM announcements WHERE event_id = ? AND published_at IS NOT NULL ORDER BY published_at DESC"
  )
    .bind(event.id)
    .all();
  const announcementRows = z.array(announcementRowSchema).parse(announcementsRaw);
  return c.json({
    event: publicEvent(event),
    participant: participant === null ? null : participantShape(participant),
    counts: {
      challenges: challengeRows.length,
      participants: participantIds.length
    },
    challenges: challengeRows.map((row) => ({
      id: row.id,
      title: row.title,
      description: row.description,
      position: row.position
    })),
    announcements: announcementRows.map((row) => ({
      id: row.id,
      title: row.title,
      body: row.body,
      publishedAt: row.published_at
    }))
  });
});
