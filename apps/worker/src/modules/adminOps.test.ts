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
    service_tokens: [],
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
    if (query.includes("FROM events WHERE slug = ?")) {
      return (
        this.table("events").find((row) => row["slug"] === params[0]) ?? null
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
    if (query.includes("SELECT id, platform_credits FROM users")) {
      const row = this.table("users").find((entry) => entry["id"] === params[0]);
      return row === undefined
        ? null
        : { id: row["id"], platform_credits: row["platform_credits"] };
    }
    if (query.includes("FROM service_tokens WHERE token_hash")) {
      return (
        this.table("service_tokens").find((row) => row["token_hash"] === params[0]) ?? null
      );
    }
    if (query.includes("FROM service_tokens WHERE id = ?")) {
      return this.table("service_tokens").find((row) => row["id"] === params[0]) ?? null;
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
    if (query.includes("SELECT challenge_id, objective_key FROM objective_progress")) {
      return this.table("objective_progress")
        .filter(
          (row) => row["participant_id"] === params[0] && row["status"] === "completed"
        )
        .map((row) => ({
          challenge_id: row["challenge_id"],
          objective_key: row["objective_key"]
        }));
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
    if (query.includes("FROM participants WHERE event_id = ?")) {
      return this.table("participants").filter((row) => row["event_id"] === params[0]);
    }
    if (query.includes("FROM audit_log")) {
      let rows = [...this.table("audit_log")];
      if (params.length >= 3) {
        const cursorAt = String(params[0]);
        const cursorId = String(params[2]);
        rows = rows.filter(
          (row) =>
            String(row["created_at"]) < cursorAt ||
            (row["created_at"] === cursorAt && String(row["id"]) < cursorId)
        );
      }
      const limitMatch = /LIMIT (\d+)/.exec(query);
      const limit = limitMatch?.[1] === undefined ? 50 : Number(limitMatch[1]);
      return rows
        .sort(
          (left, right) =>
            String(right["created_at"]).localeCompare(String(left["created_at"])) ||
            String(right["id"]).localeCompare(String(left["id"]))
        )
        .slice(0, limit);
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
    if (query.startsWith("INSERT INTO events")) {
      this.table("events").push({
        id: params[0],
        name: params[1],
        slug: params[2],
        description: params[3],
        status: params[4],
        starts_at: params[5],
        ends_at: params[6],
        settings_json: params[7],
        created_by: params[8],
        created_at: params[9],
        updated_at: params[10]
      });
      return { success: true };
    }
    if (marker === "admin_insert_challenge" || query.startsWith("INSERT INTO challenges")) {
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
      const current = row["event_points"];
      const award = params[0];
      row["event_points"] =
        typeof current === "number" && typeof award === "number" ? current + award : award;
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
    if (marker === "insert_credit_tx" || query.startsWith("INSERT INTO credit_transactions")) {
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
    if (query.startsWith("DELETE FROM objective_progress")) {
      const rows = this.table("objective_progress");
      const index = rows.findIndex((entry) => entry["id"] === params[0]);
      if (index === -1) {
        throw new Error("progress row not found");
      }
      rows.splice(index, 1);
      return { success: true };
    }
    if (query.includes("SELECT challenge_id, objective_key FROM objective_progress")) {
      return this.table("objective_progress")
        .filter(
          (row) => row["participant_id"] === params[0] && row["status"] === "completed"
        )
        .map((row) => ({
          challenge_id: row["challenge_id"],
          objective_key: row["objective_key"]
        }));
    }
    if (query.startsWith("UPDATE users SET platform_credits")) {
      const row = this.table("users").find((entry) => entry["id"] === params[2]);
      if (row === undefined) {
        throw new Error("user not found");
      }
      const current = row["platform_credits"];
      const amount = params[0];
      row["platform_credits"] =
        typeof current === "number" && typeof amount === "number"
          ? Math.max(0, current - amount)
          : 0;
      row["updated_at"] = params[1];
      return { success: true };
    }
    if (query.startsWith("UPDATE participants SET event_points = MAX")) {
      const row = this.table("participants").find(
        (entry) => entry["id"] === params[2]
      );
      if (row === undefined) {
        throw new Error("participant not found");
      }
      const current = row["event_points"];
      const amount = params[0];
      row["event_points"] =
        typeof current === "number" && typeof amount === "number"
          ? Math.max(0, current - amount)
          : 0;
      row["updated_at"] = params[1];
      return { success: true };
    }
    if (query.includes("UPDATE participants SET completed_at")) {
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
    if (query.startsWith("INSERT INTO service_tokens")) {
      this.table("service_tokens").push({
        id: params[0],
        name: params[1],
        token_hash: params[2],
        scopes_json: params[3],
        created_by: params[4],
        revoked_at: params[5],
        created_at: params[6]
      });
      return { success: true };
    }
    if (query.startsWith("UPDATE service_tokens SET revoked_at")) {
      const row = this.table("service_tokens").find((entry) => entry["id"] === params[1]);
      if (row === undefined) {
        throw new Error("service token not found");
      }
      row["revoked_at"] = params[0];
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

describe("admin duplicate remap and stepwise publish", () => {
  it("rewrites prerequisite ids when duplicating an event", async () => {
    const seed = await seedWorld();
    const eventId = addEvent(seed.db, "draft");
    const firstId = addChallenge(seed.db, eventId, 0);
    const secondId = addChallenge(seed.db, eventId, 1, {
      objectives: [TEXT_OBJECTIVE],
      requires: [firstId]
    });
    const res = await api(
      seed.db,
      "POST",
      `/api/admin/events/${eventId}/duplicate`,
      seed.tokenAdmin,
      {}
    );
    expect(res.status).toBe(201);
    const newId = z.object({ event: z.object({ id: z.string() }) }).parse(res.json).event.id;
    const copied = seed.db.table("challenges").filter((row) => row["event_id"] === newId);
    expect(copied).toHaveLength(2);
    const copiedFirst = copied.find((row) => row["position"] === 0);
    const copiedSecond = copied.find((row) => row["position"] === 1);
    expect(copiedFirst?.["id"]).not.toBe(firstId);
    expect(copiedSecond?.["id"]).not.toBe(secondId);
    const config = JSON.parse(String(copiedSecond?.["configuration_json"]));
    expect(config.requires).toEqual([copiedFirst?.["id"]]);
  });

  it("refuses to jump from draft straight to live", async () => {
    const seed = await seedWorld();
    const eventId = addEvent(seed.db, "draft");
    addChallenge(seed.db, eventId, 0);
    const direct = await api(
      seed.db,
      "POST",
      `/api/admin/events/${eventId}/publish`,
      seed.tokenAdmin,
      { to: "live" }
    );
    expect(direct.status).toBe(409);
    expect(codeOf(direct.json)).toBe("CONFLICT");
  });

  it("blocks challenge creation on live events without confirmation", async () => {
    const seed = await seedWorld();
    const eventId = addEvent(seed.db, "live");
    const blocked = await api(
      seed.db,
      "POST",
      `/api/admin/events/${eventId}/challenges`,
      seed.tokenAdmin,
      { title: "Sneaky", configuration: { objectives: [TEXT_OBJECTIVE] } }
    );
    expect(blocked.status).toBe(409);
    const confirmed = await api(
      seed.db,
      "POST",
      `/api/admin/events/${eventId}/challenges`,
      seed.tokenAdmin,
      {
        title: "Planned",
        configuration: { objectives: [TEXT_OBJECTIVE] },
        confirmLiveEdit: true
      }
    );
    expect(confirmed.status).toBe(201);
  });

  it("rejects penalties before the event starts", async () => {
    const seed = await seedWorld();
    for (const status of ["draft", "testing", "scheduled"]) {
      const eventId = addEvent(seed.db, status);
      const participantId = addParticipant(seed.db, eventId);
      const res = await api(
        seed.db,
        "POST",
        `/api/admin/participants/${participantId}/penalties`,
        seed.tokenAdmin,
        { seconds: 60, reason: "Too early" }
      );
      expect(res.status).toBe(409);
    }
  });
});

describe("admin reversal and finalize", () => {
  it("reverses a manual completion, returning points and credits", async () => {
    const seed = await seedWorld();
    const eventId = addEvent(seed.db, "live");
    const challengeId = addChallenge(seed.db, eventId, 0);
    const participantId = addParticipant(seed.db, eventId);
    const completed = await api(
      seed.db,
      "POST",
      "/api/admin/objectives/puzzle1/manual-completion",
      seed.tokenAdmin,
      { participantId, challengeId }
    );
    expect(completed.status).toBe(200);
    const reversed = await api(
      seed.db,
      "POST",
      "/api/admin/objectives/puzzle1/reversal",
      seed.tokenAdmin,
      { participantId, challengeId, note: "Volunteer error" }
    );
    expect(reversed.status).toBe(200);
    expect(seed.db.table("objective_progress")).toHaveLength(0);
    const participant = seed.db.table("participants").find((row) => row["id"] === participantId);
    expect(participant?.["event_points"]).toBe(0);
    expect(participant?.["completed_at"]).toBeNull();
    const player = seed.db.table("users").find((row) => row["id"] === "player");
    expect(player?.["platform_credits"]).toBe(0);
    const txs = seed.db.table("credit_transactions");
    expect(txs).toHaveLength(2);
    expect(txs[1]).toMatchObject({ amount: -5, reason: "manual_reversal" });
    const actions = seed.db.table("audit_log").map((row) => row["action"]);
    expect(actions).toContain("objective.manual_reversal");
    const again = await api(
      seed.db,
      "POST",
      "/api/admin/objectives/puzzle1/reversal",
      seed.tokenAdmin,
      { participantId, challengeId }
    );
    expect(again.status).toBe(404);
  });

  it("completes manual-approval objectives through the admin override", async () => {
    const seed = await seedWorld();
    const eventId = addEvent(seed.db, "live");
    const challengeId = addChallenge(seed.db, eventId, 0, {
      objectives: [
        {
          key: "service",
          type: "manual_approval",
          prompt: "Help the volunteer desk",
          eventPoints: 5,
          platformCredits: 2
        }
      ]
    });
    const participantId = addParticipant(seed.db, eventId);
    const res = await api(
      seed.db,
      "POST",
      "/api/admin/objectives/service/manual-completion",
      seed.tokenAdmin,
      { participantId, challengeId }
    );
    expect(res.status).toBe(200);
    const participant = seed.db.table("participants").find((row) => row["id"] === participantId);
    expect(participant?.["event_points"]).toBe(5);
    expect(participant?.["completed_at"]).not.toBeNull();
  });

  it("finalizes completed events with an audited snapshot", async () => {
    const seed = await seedWorld();
    const eventId = addEvent(seed.db, "completed");
    const liveId = addEvent(seed.db, "live");
    const liveRes = await api(
      seed.db,
      "POST",
      `/api/admin/events/${liveId}/finalize`,
      seed.tokenAdmin,
      {}
    );
    expect(liveRes.status).toBe(409);
    const res = await api(
      seed.db,
      "POST",
      `/api/admin/events/${eventId}/finalize`,
      seed.tokenAdmin,
      {}
    );
    expect(res.status).toBe(200);
    const parsed = z
      .object({ finalized: z.boolean(), finishedCount: z.number(), participantCount: z.number() })
      .safeParse(res.json);
    expect(parsed.success).toBe(true);
    const actions = seed.db.table("audit_log").map((row) => row["action"]);
    expect(actions).toContain("results.final");
  });
});

describe("admin service tokens", () => {
  async function issueToken(
    seed: Seed,
    scopes: string[]
  ): Promise<{ id: string; token: string }> {
    const res = await api(seed.db, "POST", "/api/admin/service-tokens", seed.tokenAdmin, {
      name: "automation",
      scopes
    });
    expect(res.status).toBe(201);
    return z.object({ token: z.object({ id: z.string(), token: z.string() }) }).parse(res.json).token;
  }

  it("issues, scopes, and revokes bearer tokens", async () => {
    const seed = await seedWorld();
    const full = await issueToken(seed, ["events:write", "events:read", "challenges:write", "participants:moderate"]);
    const created = await api(seed.db, "POST", "/api/admin/events", null, {
      name: "Via Token",
      slug: "via-token"
    }, { Authorization: `Bearer ${full.token}` });
    expect(created.status).toBe(201);

    const narrow = await issueToken(seed, ["events:read"]);
    const denied = await api(seed.db, "POST", "/api/admin/events", null, {
      name: "Denied",
      slug: "denied"
    }, { Authorization: `Bearer ${narrow.token}` });
    expect(denied.status).toBe(403);
    expect(codeOf(denied.json)).toBe("FORBIDDEN");

    const audit = await api(seed.db, "GET", "/api/admin/audit?limit=5", null, undefined, {
      Authorization: `Bearer ${narrow.token}`
    });
    expect(audit.status).toBe(200);

    const manageDenied = await api(
      seed.db,
      "POST",
      "/api/admin/service-tokens",
      null,
      { name: "sneaky", scopes: ["events:read"] },
      { Authorization: `Bearer ${full.token}` }
    );
    expect(manageDenied.status).toBe(403);

    const revoked = await api(
      seed.db,
      "POST",
      `/api/admin/service-tokens/${full.id}/revoke`,
      seed.tokenAdmin,
      {}
    );
    expect(revoked.status).toBe(200);
    const after = await api(seed.db, "POST", "/api/admin/events", null, {
      name: "After Revoke",
      slug: "after-revoke"
    }, { Authorization: `Bearer ${full.token}` });
    expect(after.status).toBe(401);
  });
});

describe("admin audit pagination", () => {
  it("pages without skipping or repeating entries", async () => {
    const seed = await seedWorld();
    for (const slug of ["one", "two", "three"]) {
      const res = await api(seed.db, "POST", "/api/admin/events", seed.tokenAdmin, {
        name: `Event ${slug}`,
        slug: `event-${slug}`
      });
      expect(res.status).toBe(201);
    }
    const pageSchema = z.object({
      entries: z.array(z.object({ id: z.string() }).catchall(z.unknown())),
      nextCursor: z.string().nullable()
    });
    const first = await api(seed.db, "GET", "/api/admin/audit?limit=2", seed.tokenAdmin);
    expect(first.status).toBe(200);
    const firstParsed = pageSchema.parse(first.json);
    expect(firstParsed.entries).toHaveLength(2);
    expect(firstParsed.nextCursor).not.toBeNull();
    const second = await api(
      seed.db,
      "GET",
      `/api/admin/audit?limit=2&cursor=${encodeURIComponent(firstParsed.nextCursor as string)}`,
      seed.tokenAdmin
    );
    expect(second.status).toBe(200);
    const secondParsed = pageSchema.parse(second.json);
    const ids = [...firstParsed.entries, ...secondParsed.entries].map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toHaveLength(3);
  });
});
