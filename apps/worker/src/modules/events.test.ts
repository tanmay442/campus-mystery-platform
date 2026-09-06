/** Participant event flows: discovery, policy-gated registration, start, state. */
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

  all(): Promise<Array<Row>> {
    return this.db.handleAll(this.query, this.params);
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
    if (query.includes("OR slug = ?")) {
      return (
        this.table("events").find(
          (row) => row["id"] === params[0] || row["slug"] === params[1]
        ) ?? null
      );
    }
    if (query.includes("FROM participants WHERE id = ?")) {
      return (
        this.table("participants").find((row) => row["id"] === params[0]) ??
        null
      );
    }
    throw new Error(`unsupported first query: ${query}`);
  }

  async handleAll(
    query: string,
    params: Array<unknown>
  ): Promise<Array<Row>> {
    if (query.includes("FROM participant_members WHERE user_id = ?")) {
      return this.table("participant_members").filter(
        (row) => row["user_id"] === params[0]
      );
    }
    if (query.includes("FROM team_invites WHERE requested_user_id = ?")) {
      return this.table("team_invites").filter(
        (row) =>
          row["requested_user_id"] === params[0] && row["status"] === params[1]
      );
    }
    if (query.includes("FROM events WHERE status IN")) {
      const wanted = new Set(params.map((entry) => String(entry)));
      return this.table("events")
        .filter((row) => wanted.has(String(row["status"])))
        .sort((left, right) =>
          String(left["starts_at"]).localeCompare(String(right["starts_at"]))
        );
    }
    if (query.includes("FROM challenges WHERE event_id = ?")) {
      return this.table("challenges")
        .filter((row) => row["event_id"] === params[0])
        .sort((left, right) =>
          Number(left["position"]) - Number(right["position"])
        );
    }
    if (query.includes("FROM participants WHERE event_id = ?")) {
      return this.table("participants")
        .filter((row) => row["event_id"] === params[0])
        .map((row) => ({ id: row["id"] }));
    }
    if (query.includes("FROM announcements WHERE event_id = ?")) {
      return this.table("announcements")
        .filter(
          (row) =>
            row["event_id"] === params[0] && row["published_at"] !== null
        )
        .sort((left, right) =>
          String(right["published_at"]).localeCompare(
            String(left["published_at"])
          )
        );
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
    if (query.startsWith("INSERT INTO participants")) {
      this.table("participants").push({
        id: params[0],
        event_id: params[1],
        type: params[2],
        name: params[3],
        event_points: params[4],
        penalty_seconds: params[5],
        started_at: params[6],
        completed_at: params[7],
        created_at: params[8],
        updated_at: params[9]
      });
      return { success: true };
    }
    if (query.startsWith("INSERT INTO participant_members")) {
      this.table("participant_members").push({
        id: params[0],
        participant_id: params[1],
        user_id: params[2],
        role: params[3],
        joined_at: params[4],
        left_at: params[5]
      });
      return { success: true };
    }
    if (query.startsWith("UPDATE participants SET started_at")) {
      const row = this.table("participants").find(
        (entry) => entry["id"] === params[2]
      );
      if (row !== undefined) {
        row["started_at"] = params[0];
        row["updated_at"] = params[1];
      }
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
  return { DB: db, MEDIA: mediaBinding, ADMIN_EMAILS: "" };
}

const NOW = "2026-09-05T12:00:00.000Z";
const LATER = "2027-09-05T12:00:00.000Z";

interface Seed {
  db: FakeDb;
  tokenAlice: string;
  tokenBob: string;
  tokenCarol: string;
}

async function seedWorld(extraEvents: Array<Row> = []): Promise<Seed> {
  const db = new FakeDb();
  db.table("users").push(
    {
      id: "alice",
      auth_provider_id: "auth-alice",
      email: "alice@example.com",
      email_verified: 1,
      username: "alice",
      display_name: null,
      platform_credits: 0,
      presence_visibility: "visible",
      created_at: NOW,
      updated_at: NOW
    },
    {
      id: "bob",
      auth_provider_id: "auth-bob",
      email: "bob@example.com",
      email_verified: 1,
      username: "bob",
      display_name: null,
      platform_credits: 0,
      presence_visibility: "visible",
      created_at: NOW,
      updated_at: NOW
    },
    {
      id: "carol",
      auth_provider_id: "auth-carol",
      email: "carol@campus.edu",
      email_verified: 1,
      username: "carol",
      display_name: null,
      platform_credits: 0,
      presence_visibility: "visible",
      created_at: NOW,
      updated_at: NOW
    }
  );
  const tokenAlice = "token-alice";
  const tokenBob = "token-bob";
  const tokenCarol = "token-carol";
  const pairs: Array<[string, string]> = [
    ["sess-alice", "alice"],
    ["sess-bob", "bob"],
    ["sess-carol", "carol"]
  ];
  const tokens: Record<string, string> = {
    alice: tokenAlice,
    bob: tokenBob,
    carol: tokenCarol
  };
  for (const [sessionId, userId] of pairs) {
    const token = tokens[userId];
    if (token === undefined) {
      throw new Error(`missing token for ${userId}`);
    }
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
  db.table("events").push(
    {
      id: "ev-open",
      name: "Open Night",
      slug: "open-night",
      description: "Everyone is welcome",
      status: "live",
      starts_at: NOW,
      ends_at: null,
      settings_json: JSON.stringify({}),
      created_by: "alice",
      created_at: NOW,
      updated_at: NOW
    },
    {
      id: "ev-draft",
      name: "Secret Draft",
      slug: "secret-draft",
      description: null,
      status: "draft",
      starts_at: null,
      ends_at: null,
      settings_json: JSON.stringify({}),
      created_by: "alice",
      created_at: NOW,
      updated_at: NOW
    },
    {
      id: "ev-code",
      name: "Coded Door",
      slug: "coded-door",
      description: null,
      status: "scheduled",
      starts_at: NOW,
      ends_at: null,
      settings_json: JSON.stringify({
        registration: { type: "access_code", code: "OWL-42" }
      }),
      created_by: "alice",
      created_at: NOW,
      updated_at: NOW
    },
    {
      id: "ev-domain",
      name: "Campus Only",
      slug: "campus-only",
      description: null,
      status: "scheduled",
      starts_at: NOW,
      ends_at: null,
      settings_json: JSON.stringify({
        registration: { type: "email_domain", domains: ["campus.edu"] }
      }),
      created_by: "alice",
      created_at: NOW,
      updated_at: NOW
    },
    ...extraEvents
  );
  db.table("challenges").push({
    id: "ch-open-1",
    event_id: "ev-open",
    title: "First steps",
    description: "Begin here",
    position: 1,
    configuration_json: JSON.stringify({
      objectives: [
        {
          key: "q1",
          expectedAnswer: "TOP-SECRET-ANSWER",
          location: { latitude: 28.6139, longitude: 77.209 }
        }
      ]
    }),
    created_at: NOW,
    updated_at: NOW
  });
  db.table("announcements").push(
    {
      id: "ann-live",
      event_id: "ev-open",
      title: "Welcome",
      body: "The hunt is on",
      created_at: NOW,
      created_by: "alice",
      published_at: NOW
    },
    {
      id: "ann-draft",
      event_id: "ev-open",
      title: "Not yet",
      body: "Still a draft",
      created_at: NOW,
      created_by: "alice",
      published_at: null
    }
  );
  return { db, tokenAlice, tokenBob, tokenCarol };
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
  const init: { method: string; headers: Record<string, string>; body?: string } = {
    method,
    headers
  };
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

const eventSchema = z
  .object({ id: z.string(), slug: z.string(), status: z.string() })
  .catchall(z.unknown());

const participantSchema = z
  .object({ id: z.string(), eventId: z.string(), startedAt: z.string().nullable() })
  .catchall(z.unknown());

describe("public event discovery", () => {
  it("lists only published events with server-picked fields", async () => {
    const seed = await seedWorld();
    const res = await api(seed.db, "GET", "/api/events", null);
    expect(res.status).toBe(200);
    const parsed = z.object({ events: z.array(eventSchema) }).safeParse(res.json);
    expect(parsed.success).toBe(true);
    if (parsed.success === false) {
      return;
    }
    const slugs = parsed.data.events.map((entry) => entry.slug);
    expect(slugs).toContain("open-night");
    expect(slugs).not.toContain("secret-draft");
    const raw = JSON.stringify(res.json);
    expect(raw).not.toContain("settings_json");
    expect(raw).not.toContain("created_by");
  });

  it("hides drafts from detail view and reports a challenge count", async () => {
    const seed = await seedWorld();
    const hidden = await api(seed.db, "GET", "/api/events/secret-draft", null);
    expect(hidden.status).toBe(404);
    const visible = await api(seed.db, "GET", "/api/events/open-night", null);
    expect(visible.status).toBe(200);
    const parsed = z
      .object({ event: eventSchema.extend({ challengeCount: z.number() }) })
      .safeParse(visible.json);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.event.challengeCount).toBe(1);
    }
  });
});

describe("registration policies", () => {
  it("creates a participant once, then returns the same entry", async () => {
    const seed = await seedWorld();
    const first = await api(seed.db, "POST", "/api/events/open-night/register", seed.tokenAlice, {});
    expect(first.status).toBe(201);
    const created = participantSchema.safeParse(
      z.object({ participant: z.unknown() }).parse(first.json)["participant"]
    );
    expect(created.success).toBe(true);
    const second = await api(seed.db, "POST", "/api/events/open-night/register", seed.tokenAlice, {});
    expect(second.status).toBe(200);
    const existing = participantSchema.safeParse(
      z.object({ participant: z.unknown() }).parse(second.json)["participant"]
    );
    expect(existing.success).toBe(true);
    if (created.success && existing.success) {
      expect(existing.data.id).toBe(created.data.id);
    }
  });

  it("accepts the correct access code and rejects a wrong one", async () => {
    const seed = await seedWorld();
    const good = await api(seed.db, "POST", "/api/events/coded-door/register", seed.tokenAlice, {
      accessCode: "OWL-42"
    });
    expect(good.status).toBe(201);
    const bad = await api(seed.db, "POST", "/api/events/coded-door/register", seed.tokenBob, {
      accessCode: "WRONG"
    });
    expect(bad.status).toBe(403);
    const parsed = envelopeSchema.safeParse(bad.json);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.code).toBe("FORBIDDEN");
    }
  });

  it("enforces the email-domain allowlist", async () => {
    const seed = await seedWorld();
    const denied = await api(
      seed.db,
      "POST",
      "/api/events/campus-only/register",
      seed.tokenAlice,
      {}
    );
    expect(denied.status).toBe(403);
    const allowed = await api(
      seed.db,
      "POST",
      "/api/events/campus-only/register",
      seed.tokenCarol,
      {}
    );
    expect(allowed.status).toBe(201);
  });

  it("blocks registration for draft events", async () => {
    const seed = await seedWorld();
    const res = await api(seed.db, "POST", "/api/events/secret-draft/register", seed.tokenAlice, {});
    expect(res.status).toBe(404);
  });
});

describe("event start", () => {
  it("sets started_at once and replays the second call", async () => {
    const seed = await seedWorld();
    await api(seed.db, "POST", "/api/events/open-night/register", seed.tokenAlice, {});
    const first = await api(seed.db, "POST", "/api/events/open-night/start", seed.tokenAlice, {});
    expect(first.status).toBe(200);
    const started = participantSchema.safeParse(
      z.object({ participant: z.unknown() }).parse(first.json)["participant"]
    );
    expect(started.success).toBe(true);
    if (started.success === false) {
      return;
    }
    expect(started.data.startedAt).not.toBeNull();
    const second = await api(seed.db, "POST", "/api/events/open-night/start", seed.tokenAlice, {});
    expect(second.status).toBe(200);
    const replayed = participantSchema.safeParse(
      z.object({ participant: z.unknown() }).parse(second.json)["participant"]
    );
    if (replayed.success) {
      expect(replayed.data.startedAt).toBe(started.data.startedAt);
    } else {
      expect.unreachable();
    }
  });

  it("reports EVENT_PAUSED while the event is paused", async () => {
    const seed = await seedWorld([
      {
        id: "ev-paused",
        name: "Paused Night",
        slug: "paused-night",
        description: null,
        status: "paused",
        starts_at: NOW,
        ends_at: null,
        settings_json: JSON.stringify({}),
        created_by: "alice",
        created_at: NOW,
        updated_at: NOW
      }
    ]);
    await api(seed.db, "POST", "/api/events/paused-night/register", seed.tokenAlice, {});
    const res = await api(seed.db, "POST", "/api/events/paused-night/start", seed.tokenAlice, {});
    expect(res.status).toBe(409);
    const parsed = envelopeSchema.safeParse(res.json);
    if (parsed.success) {
      expect(parsed.data.code).toBe("EVENT_PAUSED");
    } else {
      expect.unreachable();
    }
  });
});

describe("event state", () => {
  it("returns participant, counts and published announcements without hidden answers", async () => {
    const seed = await seedWorld();
    await api(seed.db, "POST", "/api/events/open-night/register", seed.tokenAlice, {});
    const res = await api(seed.db, "GET", "/api/events/open-night/state", seed.tokenAlice);
    expect(res.status).toBe(200);
    const parsed = z
      .object({
        event: eventSchema,
        participant: participantSchema.nullable(),
        counts: z.object({ challenges: z.number(), participants: z.number() }),
        challenges: z.array(
          z.object({ id: z.string(), title: z.string(), position: z.number() })
        ),
        announcements: z.array(
          z.object({ id: z.string(), title: z.string(), publishedAt: z.string() })
        )
      })
      .safeParse(res.json);
    expect(parsed.success).toBe(true);
    if (parsed.success === false) {
      return;
    }
    expect(parsed.data.participant?.eventId).toBe("ev-open");
    expect(parsed.data.counts).toEqual({ challenges: 1, participants: 1 });
    expect(parsed.data.announcements.map((entry) => entry.id)).toEqual(["ann-live"]);
    const raw = JSON.stringify(res.json);
    expect(raw).not.toContain("TOP-SECRET-ANSWER");
    expect(raw).not.toContain("28.6139");
    expect(raw).not.toContain("configuration_json");
  });
});
