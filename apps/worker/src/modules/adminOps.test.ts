/** Admin ops: challenge CRUD, manual completion, penalties/waivers. */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import app from "../index";
import type { DatabaseBinding, Env, PreparedStatementBinding } from "../env";
import { sha256Hex } from "../lib/crypto";

type Row = Record<string, unknown>;

function markerOf(query: string): string {
  const match = /\/\*Q:([a-z_]+)\*\//.exec(query);
  return match?.[1] ?? "";
}

class FakeStatement implements PreparedStatementBinding {
  constructor(
    private readonly query: string,
    private readonly db: FakeDb,
    private readonly params: Array<unknown> = []
  ) {}

  bind(...values: Array<unknown>): PreparedStatementBinding {
    return new FakeStatement(this.query, this.db, values);
  }

  first(): Promise<Row | null> {
    return this.db.handleFirst(this.query, this.params);
  }

  all(): Promise<{ results: Array<Row> }> {
    return this.db.handleAll(this.query, this.params).then((results) => ({
      results
    }));
  }

  run(): Promise<unknown> {
    return this.db.handleRun(this.query, this.params);
  }
}

class FakeDb {
  tables: Record<string, Array<Row>> = {
    users: [],
    sessions: [],
    events: [],
    participants: [],
    participant_members: [],
    team_invites: [],
    challenges: [],
    objective_progress: [],
    credit_transactions: [],
    penalties: [],
    announcements: [],
    audit_log: []
  };

  table(name: string): Array<Row> {
    const rows = this.tables[name];
    if (rows === undefined) {
      throw new Error(`unknown table ${name}`);
    }
    return rows;
  }

  prepare(query: string): PreparedStatementBinding {
    return new FakeStatement(query, this);
  }

  async batch(
    statements: Array<PreparedStatementBinding>
  ): Promise<Array<unknown>> {
    const results: Array<unknown> = [];
    for (const statement of statements) {
      results.push(await statement.run());
    }
    return results;
  }

  async exec(_query: string): Promise<unknown> {
    return { success: true };
  }

  private sessionUser(tokenHash: unknown): Row | null {
    const session = this.table("sessions").find(
      (row) => row["token_hash"] === tokenHash
    );
    if (session === undefined) {
      return null;
    }
    const user = this.table("users").find(
      (row) => row["id"] === session["user_id"]
    );
    if (user === undefined) {
      return null;
    }
    return { session, user };
  }

  async handleFirst(
    query: string,
    params: Array<unknown>
  ): Promise<Row | null> {
    const marker = markerOf(query);
    if (marker === "session_user") {
      const found = this.sessionUser(params[0]);
      if (found === null) {
        return null;
      }
      const user = found["user"] as Row;
      const session = found["session"] as Row;
      return {
        id: user["id"],
        email: user["email"],
        email_verified: user["email_verified"],
        expires_at: session["expires_at"],
        revoked_at: session["revoked_at"]
      };
    }
    if (query.includes("FROM sessions s")) {
      const found = this.sessionUser(params[0]);
      if (found === null) {
        return null;
      }
      const user = found["user"] as Row;
      const session = found["session"] as Row;
      return {
        session_id: session["id"],
        revoked_at: session["revoked_at"],
        expires_at: session["expires_at"],
        user_id: user["id"],
        user_email: user["email"],
        user_email_verified: user["email_verified"],
        user_username: user["username"]
      };
    }
    if (query.includes("FROM events WHERE id = ?")) {
      return (
        this.table("events").find((row) => row["id"] === params[0]) ?? null
      );
    }
    if (marker === "admin_challenge_by_id") {
      return (
        this.table("challenges").find((row) => row["id"] === params[0]) ?? null
      );
    }
    if (marker === "admin_participant_by_id") {
      return (
        this.table("participants").find((row) => row["id"] === params[0]) ??
        null
      );
    }
    if (marker === "admin_penalty_by_id") {
      return (
        this.table("penalties").find((row) => row["id"] === params[0]) ?? null
      );
    }
    if (marker === "progress_one") {
      return (
        this.table("objective_progress").find(
          (row) =>
            row["participant_id"] === params[0] &&
            row["challenge_id"] === params[1] &&
            row["objective_key"] === params[2]
        ) ?? null
      );
    }
    if (marker === "progress_by_idempotency") {
      return (
        this.table("objective_progress").find(
          (row) => row["idempotency_key"] === params[0]
        ) ?? null
      );
    }
    throw new Error(`unsupported first query: ${marker || query}`);
  }

  async handleAll(
    query: string,
    params: Array<unknown>
  ): Promise<Array<Row>> {
    const marker = markerOf(query);
    if (query.includes("FROM challenges WHERE event_id = ?")) {
      return this.table("challenges")
        .filter((row) => row["event_id"] === params[0])
        .sort(
          (left, right) =>
            Number(left["position"]) - Number(right["position"])
        );
    }
    if (marker === "members_active") {
      return this.table("participant_members")
        .filter(
          (row) =>
            row["participant_id"] === params[0] && row["left_at"] === null
        )
        .map((row) => ({
          participant_id: row["participant_id"],
          user_id: row["user_id"]
        }));
    }
    if (marker === "progress_completed_participant") {
      return this.table("objective_progress").filter(
        (row) => row["participant_id"] === params[0] && row["status"] === "completed"
      );
    }
    throw new Error(`unsupported all query: ${marker || query}`);
  }

  async handleRun(
    query: string,
    params: Array<unknown>
  ): Promise<unknown> {
    const marker = markerOf(query);
    if (marker === "" && query.includes("UPDATE sessions")) {
      const row = this.table("sessions").find(
        (entry) => entry["id"] === params[2]
      );
      if (row !== undefined) {
        row["last_seen_at"] = params[0];
        row["expires_at"] = params[1];
      }
      return { success: true };
    }
    if (marker === "admin_insert_challenge") {
      this.table("challenges").push({
        id: params[0],
        event_id: params[1],
        title: params[2],
        description: params[3],
        position: params[4],
        configuration_json: params[5],
        created_at: params[6],
        updated_at: params[7]
      });
      return { success: true };
    }
    if (marker === "admin_update_challenge") {
      const row = this.table("challenges").find(
        (entry) => entry["id"] === params[5]
      );
      if (row === undefined) {
        throw new Error("challenge not found");
      }
      row["title"] = params[0];
      row["description"] = params[1];
      row["position"] = params[2];
      row["configuration_json"] = params[3];
      row["updated_at"] = params[4];
      return { success: true };
    }
    if (marker === "admin_delete_challenge") {
      const rows = this.table("challenges");
      const index = rows.findIndex((entry) => entry["id"] === params[0]);
      if (index === -1) {
        throw new Error("challenge not found");
      }
      rows.splice(index, 1);
      return { success: true };
    }
    if (marker === "insert_progress") {
      const rows = this.table("objective_progress");
      const duplicate = rows.some(
        (row) =>
          row["participant_id"] === params[1] &&
          row["challenge_id"] === params[2] &&
          row["objective_key"] === params[3]
      );
      const keyed =
        params[8] !== null &&
        rows.some((row) => row["idempotency_key"] === params[8]);
      if (duplicate || keyed) {
        throw new Error("UNIQUE constraint failed: objective_progress");
      }
      rows.push({
        id: params[0],
        participant_id: params[1],
        challenge_id: params[2],
        objective_key: params[3],
        status: params[4],
        completed_by: params[5],
        completed_at: params[6],
        data_json: params[7],
        idempotency_key: params[8],
        created_at: params[9],
        updated_at: params[10]
      });
      return { success: true };
    }
    if (marker === "update_progress_completed") {
      const rows = this.table("objective_progress");
      const row = rows.find((entry) => entry["id"] === params[6]);
      if (row === undefined) {
        throw new Error("progress row not found");
      }
      row["status"] = params[0];
      row["completed_by"] = params[1];
      row["completed_at"] = params[2];
      row["data_json"] = params[3];
      row["idempotency_key"] = params[4];
      row["updated_at"] = params[5];
      return { success: true };
    }
    if (marker === "add_participant_points") {
      const row = this.table("participants").find(
        (entry) => entry["id"] === params[2]
      );
      if (row === undefined) {
        throw new Error("participant not found");
      }
      row["event_points"] = params[0];
      row["updated_at"] = params[1];
      return { success: true };
    }
    if (marker === "set_participant_completed") {
      const row = this.table("participants").find(
        (entry) => entry["id"] === params[2]
      );
      if (row === undefined) {
        throw new Error("participant not found");
      }
      row["completed_at"] = params[0];
      row["updated_at"] = params[1];
      return { success: true };
    }
    if (marker === "add_user_credits") {
      const row = this.table("users").find(
        (entry) => entry["id"] === params[2]
      );
      if (row === undefined) {
        throw new Error("user not found");
      }
      const current = row["platform_credits"];
      const amount = params[0];
      row["platform_credits"] =
        typeof current === "number" && typeof amount === "number"
          ? current + amount
          : amount;
      row["updated_at"] = params[1];
      return { success: true };
    }
    if (marker === "insert_credit_tx") {
      this.table("credit_transactions").push({
        id: params[0],
        user_id: params[1],
        event_id: params[2],
        amount: params[3],
        reason: params[4],
        reference_id: params[5],
        created_at: params[6]
      });
      return { success: true };
    }
    if (marker === "admin_insert_penalty") {
      this.table("penalties").push({
        id: params[0],
        participant_id: params[1],
        admin_user_id: params[2],
        seconds: params[3],
        reason: params[4],
        waived: params[5],
        created_at: params[6],
        updated_at: params[7],
        waived_at: params[8]
      });
      return { success: true };
    }
    if (marker === "add_participant_penalty") {
      const row = this.table("participants").find(
        (entry) => entry["id"] === params[2]
      );
      if (row === undefined) {
        throw new Error("participant not found");
      }
      row["penalty_seconds"] =
        Number(row["penalty_seconds"]) + Number(params[0]);
      row["updated_at"] = params[1];
      return { success: true };
    }
    if (marker === "admin_update_penalty_waived") {
      const row = this.table("penalties").find(
        (entry) => entry["id"] === params[3]
      );
      if (row === undefined) {
        throw new Error("penalty not found");
      }
      row["waived"] = params[0];
      row["waived_at"] = params[1];
      row["updated_at"] = params[2];
      return { success: true };
    }
    if (marker === "subtract_participant_penalty") {
      const row = this.table("participants").find(
        (entry) => entry["id"] === params[2]
      );
      if (row === undefined) {
        throw new Error("participant not found");
      }
      row["penalty_seconds"] = Math.max(
        0,
        Number(row["penalty_seconds"]) - Number(params[0])
      );
      row["updated_at"] = params[1];
      return { success: true };
    }
    if (query.startsWith("INSERT INTO audit_log")) {
      this.table("audit_log").push({
        id: params[0],
        admin_user_id: params[1],
        action: params[2],
        entity_type: params[3],
        entity_id: params[4],
        details_json: params[5],
        created_at: params[6]
      });
      return { success: true };
    }
    throw new Error(`unsupported run query: ${marker || query}`);
  }
}

const mediaBinding = {
  get: (_key: string) => Promise.resolve(null),
  put: (_key: string, _value: ReadableStream | ArrayBuffer | string) =>
    Promise.resolve({ success: true }),
  delete: (_key: string) => Promise.resolve()
};

function testEnv(db: DatabaseBinding): Env {
  return {
    DB: db,
    MEDIA: mediaBinding,
    ADMIN_EMAILS: "admin@example.com"
  };
}

const NOW = "2026-09-05T12:00:00.000Z";
const LATER = "2027-09-05T12:00:00.000Z";

interface Seed {
  db: FakeDb;
  tokenAdmin: string;
  tokenPlayer: string;
}

async function seedWorld(): Promise<Seed> {
  const db = new FakeDb();
  db.table("users").push(
    {
      id: "admin",
      auth_provider_id: "auth-admin",
      email: "admin@example.com",
      email_verified: 1,
      username: "organiser",
      display_name: null,
      platform_credits: 0,
      presence_visibility: "visible",
      created_at: NOW,
      updated_at: NOW
    },
    {
      id: "player",
      auth_provider_id: "auth-player",
      email: "player@example.com",
      email_verified: 1,
      username: "player",
      display_name: null,
      platform_credits: 0,
      presence_visibility: "visible",
      created_at: NOW,
      updated_at: NOW
    }
  );
  const tokenAdmin = "token-admin";
  const tokenPlayer = "token-player";
  const pairs: Array<[string, string, string]> = [
    ["sess-admin", "admin", tokenAdmin],
    ["sess-player", "player", tokenPlayer]
  ];
  for (const [sessionId, userId, token] of pairs) {
    db.table("sessions").push({
      id: sessionId,
      user_id: userId,
      token_hash: await sha256Hex(token),
      device_label: null,
      ip_hash: null,
      created_at: NOW,
      last_seen_at: NOW,
      expires_at: LATER,
      revoked_at: null
    });
  }
  return { db, tokenAdmin, tokenPlayer };
}

function addEvent(db: FakeDb, status: string): string {
  const id = `ev-${status}-${db.table("events").length}`;
  db.table("events").push({
    id,
    name: `Event ${status}`,
    slug: `event-${status}-${db.table("events").length}`,
    description: null,
    status,
    starts_at: null,
    ends_at: null,
    settings_json: "{}",
    created_by: "admin",
    created_at: NOW,
    updated_at: NOW
  });
  return id;
}

function addParticipant(db: FakeDb, eventId: string): string {
  const id = `part-${db.table("participants").length}`;
  db.table("participants").push({
    id,
    event_id: eventId,
    type: "solo",
    name: "Solo entry",
    event_points: 0,
    penalty_seconds: 0,
    started_at: NOW,
    completed_at: null,
    created_at: NOW,
    updated_at: NOW
  });
  db.table("participant_members").push({
    id: `mem-${id}`,
    participant_id: id,
    user_id: "player",
    role: "member",
    joined_at: NOW,
    left_at: null
  });
  return id;
}

const TEXT_OBJECTIVE = {
  key: "puzzle1",
  type: "text_answer",
  prompt: "What opens the gate?",
  eventPoints: 10,
  platformCredits: 5
};

function addChallenge(
  db: FakeDb,
  eventId: string,
  position: number,
  configuration: unknown = { objectives: [TEXT_OBJECTIVE] }
): string {
  const id = `ch-${db.table("challenges").length}`;
  db.table("challenges").push({
    id,
    event_id: eventId,
    title: `Challenge ${position}`,
    description: null,
    position,
    configuration_json: JSON.stringify(configuration),
    created_at: NOW,
    updated_at: NOW
  });
  return id;
}

async function api(
  db: DatabaseBinding,
  method: string,
  path: string,
  token: string | null,
  body?: unknown,
  headers?: Record<string, string>
): Promise<{ status: number; json: unknown }> {
  const requestHeaders: Record<string, string> = { ...(headers ?? {}) };
  if (token !== null) {
    requestHeaders["Cookie"] = `cmp_session=${token}`;
  }
  const init: {
    method: string;
    headers: Record<string, string>;
    body?: string;
  } = { method, headers: requestHeaders };
  if (body !== undefined) {
    requestHeaders["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  const res = await app.request(path, init, testEnv(db));
  const json: unknown = await res.json().catch(() => null);
  return { status: res.status, json };
}

const envelopeSchema = z
  .object({ code: z.string(), message: z.string() })
  .catchall(z.unknown());

function codeOf(json: unknown): string | null {
  const parsed = envelopeSchema.safeParse(json);
  return parsed.success ? parsed.data.code : null;
}

const adminChallengeSchema = z
  .object({
    id: z.string(),
    eventId: z.string(),
    title: z.string(),
    position: z.number(),
    configuration: z.object({ objectives: z.array(z.unknown()) }).catchall(z.unknown())
  })
  .catchall(z.unknown());

describe("admin challenge CRUD", () => {
  it("creates a challenge with appended position and an audit row", async () => {
    const seed = await seedWorld();
    const eventId = addEvent(seed.db, "draft");
    addChallenge(seed.db, eventId, 0);
    const res = await api(
      seed.db,
      "POST",
      `/api/admin/events/${eventId}/challenges`,
      seed.tokenAdmin,
      {
        title: "Second",
        configuration: { objectives: [TEXT_OBJECTIVE] }
      }
    );
    expect(res.status).toBe(201);
    const parsed = z.object({ challenge: adminChallengeSchema }).safeParse(res.json);
    expect(parsed.success).toBe(true);
    if (parsed.success === false) {
      return;
    }
    expect(parsed.data.challenge.eventId).toBe(eventId);
    expect(parsed.data.challenge.position).toBe(1);
    expect(parsed.data.challenge.configuration.objectives).toHaveLength(1);
    const actions = seed.db.table("audit_log").map((row) => row["action"]);
    expect(actions).toContain("challenge.create");
  });

  it("rejects empty objectives and duplicate objective keys", async () => {
    const seed = await seedWorld();
    const eventId = addEvent(seed.db, "draft");
    const empty = await api(
      seed.db,
      "POST",
      `/api/admin/events/${eventId}/challenges`,
      seed.tokenAdmin,
      { title: "Empty", configuration: { objectives: [] } }
    );
    expect(empty.status).toBe(400);
    expect(codeOf(empty.json)).toBe("VALIDATION_ERROR");
    const dupes = await api(
      seed.db,
      "POST",
      `/api/admin/events/${eventId}/challenges`,
      seed.tokenAdmin,
      {
        title: "Dupes",
        configuration: { objectives: [TEXT_OBJECTIVE, TEXT_OBJECTIVE] }
      }
    );
    expect(dupes.status).toBe(400);
    expect(codeOf(dupes.json)).toBe("VALIDATION_ERROR");
  });

  it("patches titles and requires confirmLiveEdit for structural live edits", async () => {
    const seed = await seedWorld();
    const eventId = addEvent(seed.db, "live");
    const challengeId = addChallenge(seed.db, eventId, 0);
    const renamed = await api(
      seed.db,
      "PATCH",
      `/api/admin/challenges/${challengeId}`,
      seed.tokenAdmin,
      { title: "Renamed" }
    );
    expect(renamed.status).toBe(200);
    const blocked = await api(
      seed.db,
      "PATCH",
      `/api/admin/challenges/${challengeId}`,
      seed.tokenAdmin,
      { position: 3 }
    );
    expect(blocked.status).toBe(409);
    expect(codeOf(blocked.json)).toBe("CONFLICT");
    const confirmed = await api(
      seed.db,
      "PATCH",
      `/api/admin/challenges/${challengeId}`,
      seed.tokenAdmin,
      { position: 3, confirmLiveEdit: true }
    );
    expect(confirmed.status).toBe(200);
    const parsed = z.object({ challenge: adminChallengeSchema }).safeParse(confirmed.json);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.challenge.position).toBe(3);
    }
    const actions = seed.db.table("audit_log").map((row) => row["action"]);
    expect(actions).toContain("challenge.update");
  });

  it("deletes challenges but preserves earned progress", async () => {
    const seed = await seedWorld();
    const eventId = addEvent(seed.db, "draft");
    const challengeId = addChallenge(seed.db, eventId, 0);
    const participantId = addParticipant(seed.db, eventId);
    seed.db.table("objective_progress").push({
      id: "prog-1",
      participant_id: participantId,
      challenge_id: challengeId,
      objective_key: "puzzle1",
      status: "completed",
      completed_by: "player",
      completed_at: NOW,
      data_json: null,
      idempotency_key: null,
      created_at: NOW,
      updated_at: NOW
    });
    const res = await api(
      seed.db,
      "DELETE",
      `/api/admin/challenges/${challengeId}`,
      seed.tokenAdmin
    );
    expect(res.status).toBe(200);
    expect(
      seed.db.table("challenges").find((row) => row["id"] === challengeId)
    ).toBeUndefined();
    expect(seed.db.table("objective_progress")).toHaveLength(1);
    const actions = seed.db.table("audit_log").map((row) => row["action"]);
    expect(actions).toContain("challenge.delete");
  });

  it("keeps completed events read-only and non-admins out", async () => {
    const seed = await seedWorld();
    const eventId = addEvent(seed.db, "completed");
    const challengeId = addChallenge(seed.db, eventId, 0);
    const refused = await api(
      seed.db,
      "POST",
      `/api/admin/events/${eventId}/challenges`,
      seed.tokenAdmin,
      { title: "Late", configuration: { objectives: [TEXT_OBJECTIVE] } }
    );
    expect(refused.status).toBe(409);
    const patchRefused = await api(
      seed.db,
      "PATCH",
      `/api/admin/challenges/${challengeId}`,
      seed.tokenAdmin,
      { title: "Late rename" }
    );
    expect(patchRefused.status).toBe(409);
    const missing = await api(
      seed.db,
      "PATCH",
      "/api/admin/challenges/nope",
      seed.tokenAdmin,
      { title: "Ghost" }
    );
    expect(missing.status).toBe(404);
    const forbidden = await api(
      seed.db,
      "POST",
      `/api/admin/events/${eventId}/challenges`,
      seed.tokenPlayer,
      { title: "Sneaky", configuration: { objectives: [TEXT_OBJECTIVE] } }
    );
    expect(forbidden.status).toBe(403);
  });
});

describe("admin manual completion", () => {
  it("completes an objective with rewards, credits, and an audit row", async () => {
    const seed = await seedWorld();
    const eventId = addEvent(seed.db, "live");
    const challengeId = addChallenge(seed.db, eventId, 0);
    const participantId = addParticipant(seed.db, eventId);
    const res = await api(
      seed.db,
      "POST",
      "/api/admin/objectives/puzzle1/manual-completion",
      seed.tokenAdmin,
      { participantId, challengeId, note: "Location inaccessible, verified by volunteer" }
    );
    expect(res.status).toBe(200);
    const parsed = z
      .object({
        completed: z.boolean(),
        manualCompletion: z.boolean(),
        eventPointsAward: z.number(),
        platformCreditsAward: z.number(),
        replayed: z.boolean()
      })
      .catchall(z.unknown())
      .safeParse(res.json);
    expect(parsed.success).toBe(true);
    if (parsed.success === false) {
      return;
    }
    expect(parsed.data.completed).toBe(true);
    expect(parsed.data.eventPointsAward).toBe(10);
    expect(parsed.data.platformCreditsAward).toBe(5);
    expect(parsed.data.replayed).toBe(false);
    const participant = seed.db
      .table("participants")
      .find((row) => row["id"] === participantId);
    expect(participant?.["event_points"]).toBe(10);
    expect(participant?.["completed_at"]).not.toBeNull();
    const player = seed.db.table("users").find((row) => row["id"] === "player");
    expect(player?.["platform_credits"]).toBe(5);
    expect(seed.db.table("credit_transactions")).toHaveLength(1);
    const progress = seed.db.table("objective_progress");
    expect(progress).toHaveLength(1);
    expect(progress[0]).toMatchObject({
      status: "completed",
      completed_by: "admin",
      objective_key: "puzzle1"
    });
    const actions = seed.db.table("audit_log").map((row) => row["action"]);
    expect(actions).toContain("objective.manual_completion");
  });

  it("replays without duplicating rewards", async () => {
    const seed = await seedWorld();
    const eventId = addEvent(seed.db, "live");
    const challengeId = addChallenge(seed.db, eventId, 0);
    const participantId = addParticipant(seed.db, eventId);
    const body = { participantId, challengeId };
    const first = await api(
      seed.db,
      "POST",
      "/api/admin/objectives/puzzle1/manual-completion",
      seed.tokenAdmin,
      body
    );
    expect(first.status).toBe(200);
    const second = await api(
      seed.db,
      "POST",
      "/api/admin/objectives/puzzle1/manual-completion",
      seed.tokenAdmin,
      body
    );
    expect(second.status).toBe(200);
    const parsed = z
      .object({ replayed: z.boolean(), idempotentReplay: z.boolean() })
      .catchall(z.unknown())
      .safeParse(second.json);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.replayed).toBe(true);
    }
    const participant = seed.db
      .table("participants")
      .find((row) => row["id"] === participantId);
    expect(participant?.["event_points"]).toBe(10);
    const player = seed.db.table("users").find((row) => row["id"] === "player");
    expect(player?.["platform_credits"]).toBe(5);
  });

  it("rejects decisions, mismatches, unknown refs, and non-live events", async () => {
    const seed = await seedWorld();
    const liveId = addEvent(seed.db, "live");
    const decisionChallenge = addChallenge(seed.db, liveId, 0, {
      objectives: [
        {
          key: "fork",
          type: "decision",
          prompt: "Pick a route",
          choices: [
            { id: "left", label: "Left" },
            { id: "right", label: "Right" }
          ]
        }
      ]
    });
    const participantId = addParticipant(seed.db, liveId);
    const decision = await api(
      seed.db,
      "POST",
      "/api/admin/objectives/fork/manual-completion",
      seed.tokenAdmin,
      { participantId, challengeId: decisionChallenge }
    );
    expect(decision.status).toBe(400);
    expect(codeOf(decision.json)).toBe("VALIDATION_ERROR");

    const challengeId = addChallenge(seed.db, liveId, 1);
    const unknownObjective = await api(
      seed.db,
      "POST",
      "/api/admin/objectives/nope/manual-completion",
      seed.tokenAdmin,
      { participantId, challengeId }
    );
    expect(unknownObjective.status).toBe(404);

    const otherEvent = addEvent(seed.db, "live");
    const otherParticipant = addParticipant(seed.db, otherEvent);
    const mismatch = await api(
      seed.db,
      "POST",
      "/api/admin/objectives/puzzle1/manual-completion",
      seed.tokenAdmin,
      { participantId: otherParticipant, challengeId }
    );
    expect(mismatch.status).toBe(400);

    const scheduledId = addEvent(seed.db, "scheduled");
    const scheduledChallenge = addChallenge(seed.db, scheduledId, 0);
    const scheduledParticipant = addParticipant(seed.db, scheduledId);
    const scheduled = await api(
      seed.db,
      "POST",
      "/api/admin/objectives/puzzle1/manual-completion",
      seed.tokenAdmin,
      { participantId: scheduledParticipant, challengeId: scheduledChallenge }
    );
    expect(scheduled.status).toBe(409);
    expect(codeOf(scheduled.json)).toBe("EVENT_NOT_LIVE");

    const pausedId = addEvent(seed.db, "paused");
    const pausedChallenge = addChallenge(seed.db, pausedId, 0);
    const pausedParticipant = addParticipant(seed.db, pausedId);
    const paused = await api(
      seed.db,
      "POST",
      "/api/admin/objectives/puzzle1/manual-completion",
      seed.tokenAdmin,
      { participantId: pausedParticipant, challengeId: pausedChallenge }
    );
    expect(paused.status).toBe(409);
    expect(codeOf(paused.json)).toBe("EVENT_PAUSED");
  });
});

describe("admin penalties and waivers", () => {
  it("applies a penalty and waives it back to zero", async () => {
    const seed = await seedWorld();
    const eventId = addEvent(seed.db, "live");
    const participantId = addParticipant(seed.db, eventId);
    const applied = await api(
      seed.db,
      "POST",
      `/api/admin/participants/${participantId}/penalties`,
      seed.tokenAdmin,
      { seconds: 300, reason: "Late join correction" }
    );
    expect(applied.status).toBe(201);
    const penaltySchema = z.object({
      penalty: z.object({
        id: z.string(),
        seconds: z.number(),
        reason: z.string(),
        waived: z.boolean()
      }),
      participant: z.object({ id: z.string(), penaltySeconds: z.number() })
    });
    const parsed = penaltySchema.safeParse(applied.json);
    expect(parsed.success).toBe(true);
    if (parsed.success === false) {
      return;
    }
    expect(parsed.data.penalty.seconds).toBe(300);
    expect(parsed.data.penalty.waived).toBe(false);
    expect(parsed.data.participant.penaltySeconds).toBe(300);
    const actions = seed.db.table("audit_log").map((row) => row["action"]);
    expect(actions).toContain("penalty.apply");

    const waived = await api(
      seed.db,
      "POST",
      `/api/admin/penalties/${parsed.data.penalty.id}/waive`,
      seed.tokenAdmin,
      { note: "Volunteer confirmed on time" }
    );
    expect(waived.status).toBe(200);
    const waivedParsed = penaltySchema.safeParse(waived.json);
    expect(waivedParsed.success).toBe(true);
    if (waivedParsed.success === false) {
      return;
    }
    expect(waivedParsed.data.penalty.waived).toBe(true);
    expect(waivedParsed.data.participant.penaltySeconds).toBe(0);
    const waiveActions = seed.db.table("audit_log").map((row) => row["action"]);
    expect(waiveActions).toContain("penalty.waive");

    const again = await api(
      seed.db,
      "POST",
      `/api/admin/penalties/${parsed.data.penalty.id}/waive`,
      seed.tokenAdmin,
      {}
    );
    expect(again.status).toBe(409);
    expect(codeOf(again.json)).toBe("CONFLICT");
  });

  it("floors penalty seconds at zero and validates input", async () => {
    const seed = await seedWorld();
    const eventId = addEvent(seed.db, "live");
    const participantId = addParticipant(seed.db, eventId);
    const participant = seed.db
      .table("participants")
      .find((row) => row["id"] === participantId);
    if (participant !== undefined) {
      participant["penalty_seconds"] = 100;
    }
    const applied = await api(
      seed.db,
      "POST",
      `/api/admin/participants/${participantId}/penalties`,
      seed.tokenAdmin,
      { seconds: 300, reason: "Correction" }
    );
    expect(applied.status).toBe(201);
    const penaltyId = z
      .object({ penalty: z.object({ id: z.string() }) })
      .parse(applied.json).penalty.id;
    const waived = await api(
      seed.db,
      "POST",
      `/api/admin/penalties/${penaltyId}/waive`,
      seed.tokenAdmin,
      {}
    );
    expect(waived.status).toBe(200);
    const after = seed.db
      .table("participants")
      .find((row) => row["id"] === participantId);
    expect(after?.["penalty_seconds"]).toBe(100);

    // Waiving can never drive the balance negative.
    const second = await api(
      seed.db,
      "POST",
      `/api/admin/participants/${participantId}/penalties`,
      seed.tokenAdmin,
      { seconds: 300, reason: "Second correction" }
    );
    expect(second.status).toBe(201);
    const secondId = z
      .object({ penalty: z.object({ id: z.string() }) })
      .parse(second.json).penalty.id;
    const current = seed.db
      .table("participants")
      .find((row) => row["id"] === participantId);
    if (current !== undefined) {
      current["penalty_seconds"] = 50;
    }
    const secondWaive = await api(
      seed.db,
      "POST",
      `/api/admin/penalties/${secondId}/waive`,
      seed.tokenAdmin,
      {}
    );
    expect(secondWaive.status).toBe(200);
    const floored = seed.db
      .table("participants")
      .find((row) => row["id"] === participantId);
    expect(floored?.["penalty_seconds"]).toBe(0);

    const zero = await api(
      seed.db,
      "POST",
      `/api/admin/participants/${participantId}/penalties`,
      seed.tokenAdmin,
      { seconds: 0, reason: "Nothing" }
    );
    expect(zero.status).toBe(400);
    const missing = await api(
      seed.db,
      "POST",
      "/api/admin/participants/nope/penalties",
      seed.tokenAdmin,
      { seconds: 60, reason: "Ghost" }
    );
    expect(missing.status).toBe(404);
    const unknownWaive = await api(
      seed.db,
      "POST",
      "/api/admin/penalties/nope/waive",
      seed.tokenAdmin,
      {}
    );
    expect(unknownWaive.status).toBe(404);
  });

  it("keeps archived events read-only", async () => {
    const seed = await seedWorld();
    const eventId = addEvent(seed.db, "archived");
    const participantId = addParticipant(seed.db, eventId);
    const res = await api(
      seed.db,
      "POST",
      `/api/admin/participants/${participantId}/penalties`,
      seed.tokenAdmin,
      { seconds: 60, reason: "Too late" }
    );
    expect(res.status).toBe(409);
    expect(codeOf(res.json)).toBe("CONFLICT");
  });
});
