/** Admin event lifecycle routes: CRUD, transitions, announcements, audit. */
import { Hono } from "hono";
import { z } from "zod";
import {
  canTransition,
  challengeConfigurationSchema,
  createEventSchema,
  eventSettingsSchema,
  eventStatusSchema,
  updateEventSchema,
  validateRouteGraph
} from "@campus/shared";
import type { EventStatus, RouteGraphNode } from "@campus/shared";
import type { AppEnv, DatabaseBinding, PreparedStatementBinding } from "../env";
import { errorResponse, notImplemented } from "../lib/errors";
import type { AppContext } from "../lib/errors";
import { nowIso } from "../lib/time";

const eventIdParams = z.object({ eventId: z.string().min(1) });

const challengeIdParams = z.object({
  challengeId: z.string().min(1)
});

const objectiveIdParams = z.object({
  objectiveId: z.string().min(1)
});

const participantIdParams = z.object({
  participantId: z.string().min(1)
});

const penaltyIdParams = z.object({
  penaltyId: z.string().min(1)
});

const passthroughBody = z.object({}).catchall(z.unknown());

const publishBody = z.object({
  to: z.enum(["scheduled", "live"]).optional()
});

const announcementBody = z.object({
  title: z.string().min(1).max(200),
  body: z.string().min(1).max(5000)
});

const settingsPatchSchema = z.record(z.string(), z.unknown());

const auditQuery = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).optional(),
    cursor: z.string().min(1).optional()
  })
  .catchall(z.unknown());

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

type ChallengeRow = z.infer<typeof challengeRowSchema>;

const auditRowSchema = z.object({
  id: z.string(),
  admin_user_id: z.string(),
  action: z.string(),
  entity_type: z.string(),
  entity_id: z.string(),
  details_json: z.string().nullable(),
  created_at: z.string()
});

const EVENT_COLUMNS =
  "id, name, slug, description, status, starts_at, ends_at, settings_json, created_by, created_at, updated_at";

export interface PublishChallengeInput {
  id: string;
  configurationJson: string;
}

function routeNodeForPublish(id: string, configurationJson: string): RouteGraphNode {
  const fallback: RouteGraphNode = {
    id,
    requires: [],
    requiresDecision: undefined,
    isTerminal: false,
    decisionOptions: []
  };
  let decoded: unknown;
  try {
    decoded = JSON.parse(configurationJson);
  } catch {
    return fallback;
  }
  const parsed = challengeConfigurationSchema.safeParse(decoded);
  if (parsed.success === false) {
    return fallback;
  }
  const config = parsed.data;
  return {
    id,
    requires: [...config.requires],
    requiresDecision: config.requiresDecision,
    isTerminal: config.isTerminal,
    decisionOptions: config.objectives
      .filter((objective) => objective.type === "decision")
      .map((objective) => ({
        objectiveKey: objective.key,
        values: (objective.choices ?? []).map((choice) => choice.id)
      }))
  };
}

export function validateEventForPublish(input: {
  settingsJson: string;
  startsAt: string | null;
  endsAt: string | null;
  challengeCount: number;
  challenges?: readonly PublishChallengeInput[] | undefined;
}): { ok: boolean; error?: string; reasons?: string[] } {
  let settings: unknown;
  try {
    settings = JSON.parse(input.settingsJson);
  } catch {
    return { ok: false, error: "Event settings are not valid JSON" };
  }
  if (eventSettingsSchema.safeParse(settings).success === false) {
    return { ok: false, error: "Event settings are invalid" };
  }
  if (
    input.startsAt !== null &&
    Number.isNaN(Date.parse(input.startsAt))
  ) {
    return { ok: false, error: "Event start date is invalid" };
  }
  if (input.endsAt !== null && Number.isNaN(Date.parse(input.endsAt))) {
    return { ok: false, error: "Event end date is invalid" };
  }
  if (
    input.startsAt !== null &&
    input.endsAt !== null &&
    Date.parse(input.startsAt) >= Date.parse(input.endsAt)
  ) {
    return { ok: false, error: "Event start must be before end" };
  }
  if (input.challengeCount < 1) {
    return { ok: false, error: "Event needs at least one challenge" };
  }
  if (input.challenges !== undefined) {
    const nodes = input.challenges.map((challenge) =>
      routeNodeForPublish(challenge.id, challenge.configurationJson)
    );
    let reasons = validateRouteGraph(nodes);
    if (input.challenges.length === 1) {
      const only = nodes[0];
      if (
        only !== undefined &&
        only.requires.length === 0 &&
        only.requiresDecision === undefined
      ) {
        reasons = reasons.filter((reason) => reason !== "missing_final_target");
      }
    }
    if (reasons.length > 0) {
      return { ok: false, error: "Event route is invalid", reasons };
    }
  }
  return { ok: true };
}

function adminEvent(row: EventRow): Record<string, unknown> {
  let settings: unknown = null;
  try {
    settings = JSON.parse(row.settings_json);
  } catch {
    settings = null;
  }
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    status: row.status,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    settings,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function auditEntry(
  db: DatabaseBinding,
  now: string,
  adminUserId: string,
  action: string,
  entityType: string,
  entityId: string,
  details: unknown
): PreparedStatementBinding {
  return db
    .prepare(
      "INSERT INTO audit_log (id, admin_user_id, action, entity_type, entity_id, details_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
    )
    .bind(
      crypto.randomUUID(),
      adminUserId,
      action,
      entityType,
      entityId,
      JSON.stringify(details),
      now
    );
}

async function findEvent(
  db: DatabaseBinding,
  eventId: string
): Promise<EventRow | null> {
  const raw: unknown = await db
    .prepare(`SELECT ${EVENT_COLUMNS} FROM events WHERE id = ? LIMIT 1`)
    .bind(eventId)
    .first();
  if (raw === null) {
    return null;
  }
  return eventRowSchema.parse(raw);
}

async function slugTaken(
  db: DatabaseBinding,
  slug: string,
  exceptId?: string
): Promise<boolean> {
  const raw: unknown = await db
    .prepare("SELECT id FROM events WHERE slug = ? LIMIT 1")
    .bind(slug)
    .first();
  if (raw === null) {
    return false;
  }
  const parsed = z.object({ id: z.string() }).parse(raw);
  return exceptId === undefined || parsed.id !== exceptId;
}

async function listChallenges(
  db: DatabaseBinding,
  eventId: string
): Promise<ChallengeRow[]> {
  const raw: unknown = (await db
    .prepare(
      "SELECT id, event_id, title, description, position, configuration_json, created_at, updated_at FROM challenges WHERE event_id = ? ORDER BY position ASC"
    )
    .bind(eventId)
    .all()).results;
  return z.array(challengeRowSchema).parse(raw);
}

function parseStatus(row: EventRow): EventStatus | null {
  const parsed = eventStatusSchema.safeParse(row.status);
  return parsed.success ? parsed.data : null;
}

export const adminRouter = new Hono<AppEnv>();

adminRouter.post("/api/admin/events", async (c) => {
  const admin = c.get("user");
  if (admin === undefined) {
    return errorResponse(c, "UNAUTHENTICATED", "Authentication required");
  }
  const raw: unknown = await c.req.json().catch(() => ({}));
  const body = createEventSchema.safeParse(raw);
  if (body.success === false) {
    return errorResponse(c, "VALIDATION_ERROR", "Invalid event payload");
  }
  if ((await slugTaken(c.env.DB, body.data.slug)) === true) {
    return errorResponse(c, "CONFLICT", "Slug is already in use");
  }
  const settings = eventSettingsSchema.parse(body.data.settings ?? {});
  const now = nowIso();
  const id = crypto.randomUUID();
  const description = body.data.description ?? null;
  const startsAt = body.data.startsAt ?? null;
  const endsAt = body.data.endsAt ?? null;
  await c.env.DB.batch([
    c.env.DB.prepare(
      "INSERT INTO events (id, name, slug, description, status, starts_at, ends_at, settings_json, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).bind(
      id,
      body.data.name,
      body.data.slug,
      description,
      "draft",
      startsAt,
      endsAt,
      JSON.stringify(settings),
      admin.id,
      now,
      now
    ),
    auditEntry(c.env.DB, now, admin.id, "event.create", "event", id, {
      slug: body.data.slug
    })
  ]);
  const created = await findEvent(c.env.DB, id);
  if (created === null) {
    return errorResponse(c, "INTERNAL", "Failed to create event");
  }
  return c.json({ event: adminEvent(created) }, 201);
});

adminRouter.patch("/api/admin/events/:eventId", async (c) => {
  const admin = c.get("user");
  if (admin === undefined) {
    return errorResponse(c, "UNAUTHENTICATED", "Authentication required");
  }
  const params = eventIdParams.safeParse({
    eventId: c.req.param("eventId")
  });
  if (params.success === false) {
    return errorResponse(c, "VALIDATION_ERROR", "Invalid event id");
  }
  const raw: unknown = await c.req.json().catch(() => ({}));
  const body = updateEventSchema.safeParse(raw);
  if (body.success === false) {
    return errorResponse(c, "VALIDATION_ERROR", "Invalid event payload");
  }
  const event = await findEvent(c.env.DB, params.data.eventId);
  if (event === null) {
    return errorResponse(c, "EVENT_NOT_FOUND", "Event not found");
  }
  const status = parseStatus(event);
  if (status === null) {
    return errorResponse(c, "INTERNAL", "Event has an invalid status");
  }
  if (status === "completed" || status === "archived") {
    return errorResponse(c, "CONFLICT", "Completed events are read-only");
  }
  let settingsJson = event.settings_json;
  if (body.data.settings !== undefined) {
    const patch = settingsPatchSchema.safeParse(body.data.settings);
    if (patch.success === false) {
      return errorResponse(c, "VALIDATION_ERROR", "Invalid settings payload");
    }
    let current: unknown;
    try {
      current = JSON.parse(event.settings_json);
    } catch {
      return errorResponse(c, "INTERNAL", "Event configuration is invalid");
    }
    const base = settingsPatchSchema.safeParse(current);
    const merged = { ...(base.success ? base.data : {}), ...patch.data };
    settingsJson = JSON.stringify(eventSettingsSchema.parse(merged));
  }
  const name = body.data.name ?? event.name;
  const slug = body.data.slug ?? event.slug;
  const description =
    body.data.description === undefined ? event.description : body.data.description;
  const startsAt = body.data.startsAt === undefined ? event.starts_at : body.data.startsAt;
  const endsAt = body.data.endsAt === undefined ? event.ends_at : body.data.endsAt;
  const structural =
    settingsJson !== event.settings_json ||
    startsAt !== event.starts_at ||
    endsAt !== event.ends_at ||
    slug !== event.slug;
  if (
    structural &&
    (status === "live" || status === "paused") &&
    body.data.confirmLiveEdit !== true
  ) {
    return errorResponse(
      c,
      "CONFLICT",
      "Structural changes to a live event require confirmLiveEdit"
    );
  }
  if (slug !== event.slug && (await slugTaken(c.env.DB, slug, event.id))) {
    return errorResponse(c, "CONFLICT", "Slug is already in use");
  }
  const now = nowIso();
  await c.env.DB.batch([
    c.env.DB.prepare(
      "UPDATE events SET name = ?, slug = ?, description = ?, starts_at = ?, ends_at = ?, settings_json = ?, updated_at = ? WHERE id = ?"
    ).bind(name, slug, description, startsAt, endsAt, settingsJson, now, event.id),
    auditEntry(c.env.DB, now, admin.id, "event.update", "event", event.id, {
      name,
      slug,
      structural
    })
  ]);
  const updated = await findEvent(c.env.DB, event.id);
  if (updated === null) {
    return errorResponse(c, "INTERNAL", "Failed to update event");
  }
  return c.json({ event: adminEvent(updated) });
});

adminRouter.post("/api/admin/events/:eventId/duplicate", async (c) => {
  const admin = c.get("user");
  if (admin === undefined) {
    return errorResponse(c, "UNAUTHENTICATED", "Authentication required");
  }
  const parsed = eventIdParams.safeParse({
    eventId: c.req.param("eventId")
  });
  if (parsed.success === false) {
    return errorResponse(c, "VALIDATION_ERROR", "Invalid event id");
  }
  const event = await findEvent(c.env.DB, parsed.data.eventId);
  if (event === null) {
    return errorResponse(c, "EVENT_NOT_FOUND", "Event not found");
  }
  const sourceChallenges = await listChallenges(c.env.DB, event.id);
  let slug = `${event.slug}-copy`;
  let counter = 2;
  while ((await slugTaken(c.env.DB, slug)) === true) {
    slug = `${event.slug}-copy-${counter}`;
    counter += 1;
  }
  const now = nowIso();
  const newEventId = crypto.randomUUID();
  const statements: PreparedStatementBinding[] = [
    c.env.DB.prepare(
      "INSERT INTO events (id, name, slug, description, status, starts_at, ends_at, settings_json, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).bind(
      newEventId,
      `Copy of ${event.name}`,
      slug,
      event.description,
      "draft",
      event.starts_at,
      event.ends_at,
      event.settings_json,
      admin.id,
      now,
      now
    )
  ];
  for (const challenge of sourceChallenges) {
    statements.push(
      c.env.DB.prepare(
        "INSERT INTO challenges (id, event_id, title, description, position, configuration_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
      ).bind(
        crypto.randomUUID(),
        newEventId,
        challenge.title,
        challenge.description,
        challenge.position,
        challenge.configuration_json,
        now,
        now
      )
    );
  }
  statements.push(
    auditEntry(c.env.DB, now, admin.id, "event.duplicate", "event", newEventId, {
      sourceEventId: event.id,
      challengeCount: sourceChallenges.length
    })
  );
  await c.env.DB.batch(statements);
  const created = await findEvent(c.env.DB, newEventId);
  if (created === null) {
    return errorResponse(c, "INTERNAL", "Failed to duplicate event");
  }
  return c.json({ event: adminEvent(created) }, 201);
});

adminRouter.post("/api/admin/events/:eventId/publish", async (c) => {
  const admin = c.get("user");
  if (admin === undefined) {
    return errorResponse(c, "UNAUTHENTICATED", "Authentication required");
  }
  const parsed = eventIdParams.safeParse({
    eventId: c.req.param("eventId")
  });
  if (parsed.success === false) {
    return errorResponse(c, "VALIDATION_ERROR", "Invalid event id");
  }
  const raw: unknown = await c.req.json().catch(() => ({}));
  const target = publishBody.safeParse(raw ?? {});
  if (target.success === false) {
    return errorResponse(c, "VALIDATION_ERROR", "Invalid publish payload");
  }
  const event = await findEvent(c.env.DB, parsed.data.eventId);
  if (event === null) {
    return errorResponse(c, "EVENT_NOT_FOUND", "Event not found");
  }
  const status = parseStatus(event);
  if (status === null) {
    return errorResponse(c, "INTERNAL", "Event has an invalid status");
  }
  const next: EventStatus = target.data.to ?? "scheduled";
  if (status === next) {
    return c.json({ event: adminEvent(event) });
  }
  const viaScheduled =
    next === "live" && status !== "scheduled"
      ? canTransition(status, "scheduled")
      : true;
  const reachable =
    next === "scheduled"
      ? canTransition(status, "scheduled")
      : viaScheduled && canTransition("scheduled", "live");
  if (reachable === false) {
    return errorResponse(
      c,
      "CONFLICT",
      `Cannot publish an event with status ${status}`
    );
  }
  const challenges = await listChallenges(c.env.DB, event.id);
  const validation = validateEventForPublish({
    settingsJson: event.settings_json,
    startsAt: event.starts_at,
    endsAt: event.ends_at,
    challengeCount: challenges.length,
    challenges: challenges.map((challenge) => ({
      id: challenge.id,
      configurationJson: challenge.configuration_json
    }))
  });
  if (validation.ok === false) {
    if (validation.reasons !== undefined && validation.reasons.length > 0) {
      return errorResponse(c, "CONFLICT", validation.error ?? "Event route is invalid", {
        details: { reasons: validation.reasons }
      });
    }
    return errorResponse(c, "VALIDATION_ERROR", validation.error ?? "Event is not ready");
  }
  const now = nowIso();
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE events SET status = ?, updated_at = ? WHERE id = ?").bind(next, now, event.id),
    auditEntry(c.env.DB, now, admin.id, "event.publish", "event", event.id, {
      from: status,
      to: next
    })
  ]);
  const updated = await findEvent(c.env.DB, event.id);
  if (updated === null) {
    return errorResponse(c, "INTERNAL", "Failed to publish event");
  }
  return c.json({ event: adminEvent(updated) });
});

async function transitionEvent(
  c: AppContext,
  eventId: string,
  adminId: string,
  action: string,
  next: EventStatus,
  setEndsAtNow: boolean
): Promise<Response> {
  const event = await findEvent(c.env.DB, eventId);
  if (event === null) {
    return errorResponse(c, "EVENT_NOT_FOUND", "Event not found");
  }
  const status = parseStatus(event);
  if (status === null) {
    return errorResponse(c, "INTERNAL", "Event has an invalid status");
  }
  if (status === next) {
    return c.json({ event: adminEvent(event) });
  }
  if (canTransition(status, next) === false) {
    return errorResponse(
      c,
      "CONFLICT",
      `Cannot move an event from ${status} to ${next}`
    );
  }
  const now = nowIso();
  const endsAt = setEndsAtNow && event.ends_at === null ? now : event.ends_at;
  await c.env.DB.batch([
    c.env.DB.prepare(
      "UPDATE events SET status = ?, ends_at = ?, updated_at = ? WHERE id = ?"
    ).bind(next, endsAt, now, event.id),
    auditEntry(c.env.DB, now, adminId, action, "event", event.id, {
      from: status,
      to: next
    })
  ]);
  const updated = await findEvent(c.env.DB, event.id);
  if (updated === null) {
    return errorResponse(c, "INTERNAL", "Failed to update event");
  }
  return c.json({ event: adminEvent(updated) });
}

adminRouter.post("/api/admin/events/:eventId/pause", async (c) => {
  const admin = c.get("user");
  if (admin === undefined) {
    return errorResponse(c, "UNAUTHENTICATED", "Authentication required");
  }
  const parsed = eventIdParams.safeParse({
    eventId: c.req.param("eventId")
  });
  if (parsed.success === false) {
    return errorResponse(c, "VALIDATION_ERROR", "Invalid event id");
  }
  return transitionEvent(c, parsed.data.eventId, admin.id, "event.pause", "paused", false);
});

adminRouter.post("/api/admin/events/:eventId/resume", async (c) => {
  const admin = c.get("user");
  if (admin === undefined) {
    return errorResponse(c, "UNAUTHENTICATED", "Authentication required");
  }
  const parsed = eventIdParams.safeParse({
    eventId: c.req.param("eventId")
  });
  if (parsed.success === false) {
    return errorResponse(c, "VALIDATION_ERROR", "Invalid event id");
  }
  return transitionEvent(c, parsed.data.eventId, admin.id, "event.resume", "live", false);
});

adminRouter.post("/api/admin/events/:eventId/end", async (c) => {
  const admin = c.get("user");
  if (admin === undefined) {
    return errorResponse(c, "UNAUTHENTICATED", "Authentication required");
  }
  const parsed = eventIdParams.safeParse({
    eventId: c.req.param("eventId")
  });
  if (parsed.success === false) {
    return errorResponse(c, "VALIDATION_ERROR", "Invalid event id");
  }
  return transitionEvent(c, parsed.data.eventId, admin.id, "event.end", "completed", true);
});

adminRouter.post("/api/admin/events/:eventId/archive", async (c) => {
  const admin = c.get("user");
  if (admin === undefined) {
    return errorResponse(c, "UNAUTHENTICATED", "Authentication required");
  }
  const parsed = eventIdParams.safeParse({
    eventId: c.req.param("eventId")
  });
  if (parsed.success === false) {
    return errorResponse(c, "VALIDATION_ERROR", "Invalid event id");
  }
  return transitionEvent(c, parsed.data.eventId, admin.id, "event.archive", "archived", false);
});

adminRouter.post(
  "/api/admin/events/:eventId/challenges",
  async (c) => {
    const params = eventIdParams.safeParse({
      eventId: c.req.param("eventId")
    });
    if (params.success === false) {
      return errorResponse(c, "VALIDATION_ERROR", "Invalid event id");
    }
    const raw: unknown = await c.req.json().catch(() => ({}));
    const body = passthroughBody.safeParse(raw);
    if (body.success === false) {
      return errorResponse(c, "VALIDATION_ERROR", "Invalid challenge payload");
    }
    return notImplemented(c, "POST /api/admin/events/:eventId/challenges");
  }
);

adminRouter.patch("/api/admin/challenges/:challengeId", async (c) => {
  const params = challengeIdParams.safeParse({
    challengeId: c.req.param("challengeId")
  });
  if (params.success === false) {
    return errorResponse(c, "VALIDATION_ERROR", "Invalid challenge id");
  }
  const raw: unknown = await c.req.json().catch(() => ({}));
  const body = passthroughBody.safeParse(raw);
  if (body.success === false) {
    return errorResponse(c, "VALIDATION_ERROR", "Invalid challenge payload");
  }
  return notImplemented(c, "PATCH /api/admin/challenges/:challengeId");
});

adminRouter.delete("/api/admin/challenges/:challengeId", (c) => {
  const parsed = challengeIdParams.safeParse({
    challengeId: c.req.param("challengeId")
  });
  if (parsed.success === false) {
    return errorResponse(c, "VALIDATION_ERROR", "Invalid challenge id");
  }
  return notImplemented(c, "DELETE /api/admin/challenges/:challengeId");
});

adminRouter.post(
  "/api/admin/objectives/:objectiveId/manual-completion",
  async (c) => {
    const params = objectiveIdParams.safeParse({
      objectiveId: c.req.param("objectiveId")
    });
    if (params.success === false) {
      return errorResponse(c, "VALIDATION_ERROR", "Invalid objective id");
    }
    const raw: unknown = await c.req.json().catch(() => ({}));
    const body = passthroughBody.safeParse(raw);
    if (body.success === false) {
      return errorResponse(c, "VALIDATION_ERROR", "Invalid completion payload");
    }
    return notImplemented(
      c,
      "POST /api/admin/objectives/:objectiveId/manual-completion"
    );
  }
);

adminRouter.post(
  "/api/admin/participants/:participantId/penalties",
  async (c) => {
    const params = participantIdParams.safeParse({
      participantId: c.req.param("participantId")
    });
    if (params.success === false) {
      return errorResponse(c, "VALIDATION_ERROR", "Invalid participant id");
    }
    const raw: unknown = await c.req.json().catch(() => ({}));
    const body = passthroughBody.safeParse(raw);
    if (body.success === false) {
      return errorResponse(c, "VALIDATION_ERROR", "Invalid penalty payload");
    }
    return notImplemented(
      c,
      "POST /api/admin/participants/:participantId/penalties"
    );
  }
);

adminRouter.post("/api/admin/penalties/:penaltyId/waive", (c) => {
  const parsed = penaltyIdParams.safeParse({
    penaltyId: c.req.param("penaltyId")
  });
  if (parsed.success === false) {
    return errorResponse(c, "VALIDATION_ERROR", "Invalid penalty id");
  }
  return notImplemented(c, "POST /api/admin/penalties/:penaltyId/waive");
});

adminRouter.post(
  "/api/admin/events/:eventId/announcements",
  async (c) => {
    const admin = c.get("user");
    if (admin === undefined) {
      return errorResponse(c, "UNAUTHENTICATED", "Authentication required");
    }
    const params = eventIdParams.safeParse({
      eventId: c.req.param("eventId")
    });
    if (params.success === false) {
      return errorResponse(c, "VALIDATION_ERROR", "Invalid event id");
    }
    const raw: unknown = await c.req.json().catch(() => ({}));
    const body = announcementBody.safeParse(raw);
    if (body.success === false) {
      return errorResponse(
        c,
        "VALIDATION_ERROR",
        "Invalid announcement payload"
      );
    }
    const event = await findEvent(c.env.DB, params.data.eventId);
    if (event === null) {
      return errorResponse(c, "EVENT_NOT_FOUND", "Event not found");
    }
    const now = nowIso();
    const id = crypto.randomUUID();
    await c.env.DB.batch([
      c.env.DB.prepare(
        "INSERT INTO announcements (id, event_id, title, body, created_at, created_by, published_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
      ).bind(id, event.id, body.data.title, body.data.body, now, admin.id, now),
      auditEntry(c.env.DB, now, admin.id, "announcement.create", "announcement", id, {
        eventId: event.id,
        title: body.data.title
      })
    ]);
    return c.json(
      {
        announcement: {
          id,
          eventId: event.id,
          title: body.data.title,
          body: body.data.body,
          publishedAt: now
        }
      },
      201
    );
  }
);

adminRouter.get("/api/admin/audit", async (c) => {
  const admin = c.get("user");
  if (admin === undefined) {
    return errorResponse(c, "UNAUTHENTICATED", "Authentication required");
  }
  const query = auditQuery.safeParse(c.req.query());
  if (query.success === false) {
    return errorResponse(c, "VALIDATION_ERROR", "Invalid query parameters");
  }
  const limit = query.data.limit ?? 50;
  let sql =
    "SELECT id, admin_user_id, action, entity_type, entity_id, details_json, created_at FROM audit_log";
  const values: string[] = [];
  if (query.data.cursor !== undefined) {
    sql += " WHERE created_at < ?";
    values.push(query.data.cursor);
  }
  sql += ` ORDER BY created_at DESC LIMIT ${limit}`;
  const stmt =
    values.length === 0
      ? c.env.DB.prepare(sql)
      : c.env.DB.prepare(sql).bind(...values);
  const raw: unknown = (await stmt.all()).results;
  const rows = z.array(auditRowSchema).parse(raw);
  const last = rows[rows.length - 1];
  return c.json({
    entries: rows.map((row) => ({
      id: row.id,
      adminUserId: row.admin_user_id,
      action: row.action,
      entityType: row.entity_type,
      entityId: row.entity_id,
      details: row.details_json,
      createdAt: row.created_at
    })),
    nextCursor: last === undefined ? null : last.created_at
  });
});
