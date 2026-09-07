/** Admin lifecycle: CRUD, publish validation, transitions, duplicate, audit. */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import app from "../index";
import type { DatabaseBinding, Env, PreparedStatementBinding } from "../env";
import { sha256Hex } from "../lib/crypto";

type Row = Record<string, unknown>;

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

  async handleFirst(
    query: string,
    params: Array<unknown>
  ): Promise<Row | null> {
    if (query.includes("FROM sessions s")) {
      const session = this.table("sessions").find(
        (row) => row["token_hash"] === params[0]
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
    if (query.includes("FROM events WHERE slug = ?")) {
      return (
        this.table("events").find((row) => row["slug"] === params[0]) ?? null
      );
    }
    if (query.includes("FROM events WHERE id = ?")) {
      return (
        this.table("events").find((row) => row["id"] === params[0]) ?? null
      );
    }
    throw new Error(`unsupported first query: ${query}`);
  }

  async handleAll(
    query: string,
    params: Array<unknown>
  ): Promise<Array<Row>> {
    if (query.includes("FROM challenges WHERE event_id = ?")) {
      return this.table("challenges")
        .filter((row) => row["event_id"] === params[0])
        .sort((left, right) =>
          Number(left["position"]) - Number(right["position"])
        );
    }
    if (query.includes("FROM audit_log")) {
      const cursor = params.length > 0 ? String(params[0]) : null;
      const limitMatch = /LIMIT (\d+)/.exec(query);
      const limit =
        limitMatch?.[1] === undefined ? 50 : Number(limitMatch[1]);
      return this.table("audit_log")
        .filter(
          (row) => cursor === null || String(row["created_at"]) < cursor
        )
        .sort((left, right) =>
          String(right["created_at"]).localeCompare(String(left["created_at"]))
        )
        .slice(0, limit);
    }
    throw new Error(`unsupported all query: ${query}`);
  }

  async handleRun(
    query: string,
    params: Array<unknown>
  ): Promise<unknown> {
    if (query.startsWith("UPDATE sessions SET last_seen_at")) {
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
    if (query.startsWith("UPDATE events SET name")) {
      const row = this.table("events").find(
        (entry) => entry["id"] === params[7]
      );
      if (row !== undefined) {
        row["name"] = params[0];
        row["slug"] = params[1];
        row["description"] = params[2];
        row["starts_at"] = params[3];
        row["ends_at"] = params[4];
        row["settings_json"] = params[5];
        row["updated_at"] = params[6];
      }
      return { success: true };
    }
    if (query.startsWith("UPDATE events SET status")) {
      const row = this.table("events").find(
        (entry) => entry["id"] === params[params.length - 1]
      );
      if (row !== undefined) {
        row["status"] = params[0];
        if (params.length === 4) {
          row["ends_at"] = params[1];
          row["updated_at"] = params[2];
        } else {
          row["updated_at"] = params[1];
        }
      }
      return { success: true };
    }
    if (query.startsWith("INSERT INTO challenges")) {
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
    if (query.startsWith("INSERT INTO announcements")) {
      this.table("announcements").push({
        id: params[0],
        event_id: params[1],
        title: params[2],
        body: params[3],
        created_at: params[4],
        created_by: params[5],
        published_at: params[6]
      });
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
    throw new Error(`unsupported run query: ${query}`);
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

function addChallenge(db: FakeDb, eventId: string, position: number): void {
  db.table("challenges").push({
    id: `ch-${eventId}-${position}`,
    event_id: eventId,
    title: `Challenge ${position}`,
    description: null,
    position,
    configuration_json: JSON.stringify({ objectives: [] }),
    created_at: NOW,
    updated_at: NOW
  });
}

async function api(
  db: DatabaseBinding,
  method: string,
  path: string,
  token: string | null,
  body?: unknown
): Promise<{ status: number; json: unknown }> {
  const headers: Record<string, string> = {};
  if (token !== null) {
    headers["Cookie"] = `cmp_session=${token}`;
  }
  const init: {
    method: string;
    headers: Record<string, string>;
    body?: string;
  } = { method, headers };
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  const res = await app.request(path, init, testEnv(db));
  const json: unknown = await res.json().catch(() => null);
  return { status: res.status, json };
}

const envelopeSchema = z
  .object({ code: z.string(), message: z.string() })
  .catchall(z.unknown());

const adminEventSchema = z
  .object({ id: z.string(), slug: z.string(), status: z.string() })
  .catchall(z.unknown());

const eventBodySchema = z.object({ event: adminEventSchema }).catchall(z.unknown());

function eventIdOf(json: unknown): string {
  return eventBodySchema.parse(json).event.id;
}

describe("admin event creation", () => {
  it("creates a draft event and writes an audit row", async () => {
    const seed = await seedWorld();
    const res = await api(seed.db, "POST", "/api/admin/events", seed.tokenAdmin, {
      name: "Mystery Night",
      slug: "mystery-night"
    });
    expect(res.status).toBe(201);
    const parsed = eventBodySchema.safeParse(res.json);
    expect(parsed.success).toBe(true);
    if (parsed.success === false) {
      return;
    }
    expect(parsed.data.event.status).toBe("draft");
    const audits = seed.db.table("audit_log");
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ action: "event.create", entity_type: "event" });
  });

  it("rejects non-admin users and anonymous callers", async () => {
    const seed = await seedWorld();
    const forbidden = await api(seed.db, "POST", "/api/admin/events", seed.tokenPlayer, {
      name: "Sneaky",
      slug: "sneaky"
    });
    expect(forbidden.status).toBe(403);
    const forbiddenBody = envelopeSchema.safeParse(forbidden.json);
    if (forbiddenBody.success) {
      expect(forbiddenBody.data.code).toBe("NOT_ADMIN");
    } else {
      expect.unreachable();
    }
    const anonymous = await api(seed.db, "POST", "/api/admin/events", null, {
      name: "Ghost",
      slug: "ghost"
    });
    expect(anonymous.status).toBe(401);
  });
});

describe("publish validation and lifecycle", () => {
  it("refuses to publish an event without challenges", async () => {
    const seed = await seedWorld();
    const created = await api(seed.db, "POST", "/api/admin/events", seed.tokenAdmin, {
      name: "Empty",
      slug: "empty"
    });
    const id = eventIdOf(created.json);
    const res = await api(seed.db, "POST", `/api/admin/events/${id}/publish`, seed.tokenAdmin, {});
    expect(res.status).toBe(400);
    const parsed = envelopeSchema.safeParse(res.json);
    if (parsed.success) {
      expect(parsed.data.code).toBe("VALIDATION_ERROR");
    } else {
      expect.unreachable();
    }
  });

  it("walks scheduled to live to paused to live to completed to archived", async () => {
    const seed = await seedWorld();
    const created = await api(seed.db, "POST", "/api/admin/events", seed.tokenAdmin, {
      name: "Full Run",
      slug: "full-run"
    });
    const id = eventIdOf(created.json);
    addChallenge(seed.db, id, 1);
    const steps: Array<{ path: string; body: unknown; status: string }> = [
      { path: `/api/admin/events/${id}/publish`, body: {}, status: "scheduled" },
      { path: `/api/admin/events/${id}/publish`, body: { to: "live" }, status: "live" },
      { path: `/api/admin/events/${id}/pause`, body: {}, status: "paused" },
      { path: `/api/admin/events/${id}/resume`, body: {}, status: "live" },
      { path: `/api/admin/events/${id}/end`, body: {}, status: "completed" },
      { path: `/api/admin/events/${id}/archive`, body: {}, status: "archived" }
    ];
    for (const step of steps) {
      const res = await api(seed.db, "POST", step.path, seed.tokenAdmin, step.body);
      expect(res.status).toBe(200);
      const parsed = eventBodySchema.safeParse(res.json);
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.event.status).toBe(step.status);
      }
    }
    const actions = seed.db.table("audit_log").map((row) => row["action"]);
    expect(actions).toEqual([
      "event.create",
      "event.publish",
      "event.publish",
      "event.pause",
      "event.resume",
      "event.end",
      "event.archive"
    ]);
  });

  it("reports CONFLICT for an illegal transition", async () => {
    const seed = await seedWorld();
    const created = await api(seed.db, "POST", "/api/admin/events", seed.tokenAdmin, {
      name: "Drafty",
      slug: "drafty"
    });
    const id = eventIdOf(created.json);
    const res = await api(seed.db, "POST", `/api/admin/events/${id}/pause`, seed.tokenAdmin, {});
    expect(res.status).toBe(409);
    const parsed = envelopeSchema.safeParse(res.json);
    if (parsed.success) {
      expect(parsed.data.code).toBe("CONFLICT");
    } else {
      expect.unreachable();
    }
  });

  it("keeps completed events read-only", async () => {
    const seed = await seedWorld();
    const created = await api(seed.db, "POST", "/api/admin/events", seed.tokenAdmin, {
      name: "Finishing",
      slug: "finishing"
    });
    const id = eventIdOf(created.json);
    addChallenge(seed.db, id, 1);
    await api(seed.db, "POST", `/api/admin/events/${id}/publish`, seed.tokenAdmin, {});
    await api(seed.db, "POST", `/api/admin/events/${id}/publish`, seed.tokenAdmin, { to: "live" });
    await api(seed.db, "POST", `/api/admin/events/${id}/end`, seed.tokenAdmin, {});
    const res = await api(seed.db, "PATCH", `/api/admin/events/${id}`, seed.tokenAdmin, {
      name: "Too late"
    });
    expect(res.status).toBe(409);
  });

  it("requires confirmLiveEdit for structural edits to live events", async () => {
    const seed = await seedWorld();
    const created = await api(seed.db, "POST", "/api/admin/events", seed.tokenAdmin, {
      name: "Live Edit",
      slug: "live-edit"
    });
    const id = eventIdOf(created.json);
    addChallenge(seed.db, id, 1);
    await api(seed.db, "POST", `/api/admin/events/${id}/publish`, seed.tokenAdmin, {});
    await api(seed.db, "POST", `/api/admin/events/${id}/publish`, seed.tokenAdmin, { to: "live" });
    const blocked = await api(seed.db, "PATCH", `/api/admin/events/${id}`, seed.tokenAdmin, {
      settings: { leaderboardSize: 5 }
    });
    expect(blocked.status).toBe(409);
    const confirmed = await api(seed.db, "PATCH", `/api/admin/events/${id}`, seed.tokenAdmin, {
      settings: { leaderboardSize: 5 },
      confirmLiveEdit: true
    });
    expect(confirmed.status).toBe(200);
  });
});

describe("duplicate and announcements", () => {
  it("deep-copies challenges into a new draft with an audit row", async () => {
    const seed = await seedWorld();
    const created = await api(seed.db, "POST", "/api/admin/events", seed.tokenAdmin, {
      name: "Original",
      slug: "original"
    });
    const id = eventIdOf(created.json);
    addChallenge(seed.db, id, 1);
    addChallenge(seed.db, id, 2);
    const res = await api(seed.db, "POST", `/api/admin/events/${id}/duplicate`, seed.tokenAdmin, {});
    expect(res.status).toBe(201);
    const parsed = eventBodySchema.safeParse(res.json);
    expect(parsed.success).toBe(true);
    if (parsed.success === false) {
      return;
    }
    expect(parsed.data.event.status).toBe("draft");
    expect(parsed.data.event.slug).toContain("original");
    const copied = seed.db
      .table("challenges")
      .filter((row) => row["event_id"] === parsed.data.event.id);
    expect(copied).toHaveLength(2);
    const actions = seed.db.table("audit_log").map((row) => row["action"]);
    expect(actions).toContain("event.duplicate");
  });

  it("persists announcements with published_at and an audit row", async () => {
    const seed = await seedWorld();
    const created = await api(seed.db, "POST", "/api/admin/events", seed.tokenAdmin, {
      name: "Loud",
      slug: "loud"
    });
    const id = eventIdOf(created.json);
    const res = await api(
      seed.db,
      "POST",
      `/api/admin/events/${id}/announcements`,
      seed.tokenAdmin,
      { title: "Go", body: "The hunt is on" }
    );
    expect(res.status).toBe(201);
    const parsed = z
      .object({
        announcement: z.object({
          id: z.string(),
          publishedAt: z.string().min(1)
        })
      })
      .safeParse(res.json);
    expect(parsed.success).toBe(true);
    const stored = seed.db.table("announcements");
    expect(stored).toHaveLength(1);
    expect(stored[0]?.["published_at"]).not.toBeNull();
    const actions = seed.db.table("audit_log").map((row) => row["action"]);
    expect(actions).toContain("announcement.create");
  });

  it("lists audit entries newest first", async () => {
    const seed = await seedWorld();
    await api(seed.db, "POST", "/api/admin/events", seed.tokenAdmin, {
      name: "Audited",
      slug: "audited"
    });
    const res = await api(seed.db, "GET", "/api/admin/audit?limit=10", seed.tokenAdmin);
    expect(res.status).toBe(200);
    const parsed = z
      .object({
        entries: z.array(
          z.object({ action: z.string(), entityType: z.string() }).catchall(z.unknown())
        ),
        nextCursor: z.string().nullable()
      })
      .safeParse(res.json);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.entries.map((entry) => entry.action)).toContain("event.create");
    }
  });
});
