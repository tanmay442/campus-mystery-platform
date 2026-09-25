/** Phase 1 leaderboard ranking, caller context, and privacy tests. */

import { describe, expect, it } from "vitest";
import { z } from "zod";
import app from "../index";
import type { DatabaseBinding, Env, PreparedStatementBinding } from "../env";
import { sha256Hex } from "../lib/crypto";
import { rankParticipants } from "./leaderboard";
import type { ParticipantRow, ProgressRow } from "./challenges";

type Row = Record<string, unknown>;

function markerOf(query: string): string {
  const match = /\/\*Q:([a-z_]+)\*\//.exec(query);
  return match?.[1] ?? "";
}

class FakeStatement implements PreparedStatementBinding {
  constructor(
    private query: string,
    private db: FakeDb,
    private params: unknown[] = []
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

const TABLE_NAMES = [
  "users",
  "events",
  "sessions",
  "participants",
  "participant_members",
  "challenges",
  "objective_progress",
  "credit_transactions"
];

class FakeDb {
  tables: Record<string, Row[]> = {};

  constructor() {
    for (const name of TABLE_NAMES) {
      this.tables[name] = [];
    }
  }

  table(name: string): Row[] {
    const rows = this.tables[name];
    if (rows === undefined) {
      throw new Error(`unknown table ${name}`);
    }
    return rows;
  }

  prepare(query: string): PreparedStatementBinding {
    return new FakeStatement(query, this);
  }

  async batch(statements: Array<PreparedStatementBinding>): Promise<Array<unknown>> {
    const results: Array<unknown> = [];
    for (const statement of statements) {
      results.push(await statement.run());
    }
    return results;
  }

  async exec(_query: string): Promise<unknown> {
    return { success: true };
  }

  async handleFirst(query: string, params: Array<unknown>): Promise<Row | null> {
    const marker = markerOf(query);
    if (marker === "" && query.includes("FROM sessions")) {
      const session = this.table("sessions").find((row) => row["token_hash"] === params[0]);
      if (session === undefined) {
        return null;
      }
      const user = this.table("users").find((row) => row["id"] === session["user_id"]);
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
    if (marker === "event_by_id" || marker === "event_settings") {
      return this.table("events").find((row) => row["id"] === params[0]) ?? null;
    }
    if (marker === "participant_for_user") {
      const userId = params[0];
      const eventId = params[1];
      for (const member of this.table("participant_members")) {
        if (member["user_id"] !== userId || member["left_at"] !== null) {
          continue;
        }
        const participant = this.table("participants").find(
          (row) => row["id"] === member["participant_id"] && row["event_id"] === eventId
        );
        if (participant !== undefined) {
          return participant;
        }
      }
      return null;
    }
    throw new Error(`unsupported first marker ${marker}`);
  }

  async handleAll(query: string, params: Array<unknown>): Promise<Row[]> {
    const marker = markerOf(query);
    if (marker === "participants_by_event") {
      return this.table("participants").filter((row) => row["event_id"] === params[0]);
    }
    if (marker === "challenges_by_event") {
      return this.table("challenges")
        .filter((row) => row["event_id"] === params[0])
        .sort((left, right) => Number(left["position"]) - Number(right["position"]));
    }
    if (marker === "progress_completed_event") {
      const challengeIds = new Set(
        this.table("challenges")
          .filter((row) => row["event_id"] === params[0])
          .map((row) => row["id"])
      );
      return this.table("objective_progress")
        .filter((row) => row["status"] === "completed" && challengeIds.has(row["challenge_id"]))
        .map((row) => ({
          participant_id: row["participant_id"],
          challenge_id: row["challenge_id"],
          objective_key: row["objective_key"],
          completed_at: row["completed_at"]
        }));
    }
    throw new Error(`unsupported all marker ${marker}`);
  }

  async handleRun(query: string, params: Array<unknown>): Promise<unknown> {
    const marker = markerOf(query);
    if (marker === "" && query.includes("UPDATE sessions")) {
      const row = this.table("sessions").find((entry) => entry["id"] === params[2]);
      if (row !== undefined) {
        row["last_seen_at"] = params[0];
        row["expires_at"] = params[1];
      }
      return { success: true };
    }
    throw new Error(`unsupported run marker ${marker}`);
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

const BASE_MS = Date.parse("2026-09-06T10:00:00.000Z");

function at(offsetMs: number): string {
  return new Date(BASE_MS + offsetMs).toISOString();
}

function challengeConfig(): string {
  return JSON.stringify({
    objectives: [
      {
        key: "t1",
        type: "text_answer",
        prompt: "First",
        required: true,
        dependsOn: [],
        expectedAnswer: "alpha",
        eventPoints: 10,
        platformCredits: 0,
        hints: []
      },
      {
        key: "t2",
        type: "text_answer",
        prompt: "Second",
        required: true,
        dependsOn: [],
        expectedAnswer: "beta",
        eventPoints: 10,
        platformCredits: 0,
        hints: []
      },
      {
        key: "t3",
        type: "text_answer",
        prompt: "Third",
        required: true,
        dependsOn: [],
        expectedAnswer: "gamma",
        eventPoints: 10,
        platformCredits: 0,
        hints: []
      }
    ]
  });
}

interface Seed {
  db: FakeDb;
  tokenCaller: string;
}

async function seedWorld(status: string): Promise<Seed> {
  const db = new FakeDb();
  const now = new Date().toISOString();
  db.table("users").push({
    id: "caller",
    auth_provider_id: "auth-caller",
    email: "caller@example.com",
    email_verified: 1,
    username: "caller",
    display_name: "Caller",
    platform_credits: 0,
    presence_visibility: "visible",
    created_at: now,
    updated_at: now
  });
  db.table("events").push({
    id: "ev1",
    name: "Pilot",
    slug: "pilot",
    description: null,
    status,
    starts_at: now,
    ends_at: null,
    settings_json: "{}",
    created_by: "caller",
    created_at: now,
    updated_at: now
  });
  db.table("challenges").push({
    id: "ch1",
    event_id: "ev1",
    title: "First steps",
    description: "Begin",
    position: 1,
    configuration_json: challengeConfig(),
    created_at: now,
    updated_at: now
  });
  const participants = db.table("participants");
  const members = db.table("participant_members");
  const progress = db.table("objective_progress");
  for (let index = 1; index <= 11; index += 1) {
    const finishedAt = at(index * 60_000);
    participants.push({
      id: `f${index}`,
      event_id: "ev1",
      type: "team",
      name: `Team ${index}`,
      event_points: 30,
      penalty_seconds: index === 1 ? 3600 : 0,
      started_at: now,
      completed_at: finishedAt,
      created_at: now,
      updated_at: now
    });
    for (const key of ["t1", "t2", "t3"]) {
      progress.push({
        id: `pg-f${index}-${key}`,
        participant_id: `f${index}`,
        challenge_id: "ch1",
        objective_key: key,
        status: "completed",
        completed_by: `user-f${index}`,
        completed_at: finishedAt,
        data_json: null,
        idempotency_key: null,
        created_at: finishedAt,
        updated_at: finishedAt
      });
    }
  }
  participants.push(
    {
      id: "c1",
      event_id: "ev1",
      type: "team",
      name: "Callers",
      event_points: 20,
      penalty_seconds: 0,
      started_at: now,
      completed_at: null,
      created_at: now,
      updated_at: now
    },
    {
      id: "s1",
      event_id: "ev1",
      type: "solo",
      name: "Solo One",
      event_points: 10,
      penalty_seconds: 0,
      started_at: now,
      completed_at: null,
      created_at: now,
      updated_at: now
    },
    {
      id: "s2",
      event_id: "ev1",
      type: "solo",
      name: "Solo Two",
      event_points: 0,
      penalty_seconds: 0,
      started_at: now,
      completed_at: null,
      created_at: now,
      updated_at: now
    }
  );
  members.push({
    id: "m-caller",
    participant_id: "c1",
    user_id: "caller",
    role: "captain",
    joined_at: now,
    left_at: null
  });
  progress.push(
    {
      id: "pg-c1-t1",
      participant_id: "c1",
      challenge_id: "ch1",
      objective_key: "t1",
      status: "completed",
      completed_by: "caller",
      completed_at: at(30_000),
      data_json: null,
      idempotency_key: null,
      created_at: at(30_000),
      updated_at: at(30_000)
    },
    {
      id: "pg-c1-t2",
      participant_id: "c1",
      challenge_id: "ch1",
      objective_key: "t2",
      status: "completed",
      completed_by: "caller",
      completed_at: at(90_000),
      data_json: null,
      idempotency_key: null,
      created_at: at(90_000),
      updated_at: at(90_000)
    },
    {
      id: "pg-s1-t1",
      participant_id: "s1",
      challenge_id: "ch1",
      objective_key: "t1",
      status: "completed",
      completed_by: "user-s1",
      completed_at: at(120_000),
      data_json: null,
      idempotency_key: null,
      created_at: at(120_000),
      updated_at: at(120_000)
    }
  );
  const tokenCaller = "token-caller";
  db.table("sessions").push({
    id: "s-caller",
    user_id: "caller",
    token_hash: await sha256Hex(tokenCaller),
    device_label: null,
    ip_hash: null,
    created_at: now,
    last_seen_at: now,
    expires_at: new Date(Date.now() + 3600_000).toISOString(),
    revoked_at: null
  });
  return { db, tokenCaller };
}

const entrySchema = z
  .object({
    rank: z.number(),
    participantId: z.string(),
    name: z.string(),
    type: z.string(),
    eventPoints: z.number(),
    finished: z.boolean(),
    officialFinishAt: z.string().optional(),
    requiredCompleted: z.number(),
    lastCompletionAt: z.string().optional(),
    isCaller: z.boolean()
  })
  .catchall(z.unknown());

const boardSchema = z
  .object({
    eventId: z.string(),
    provisional: z.boolean(),
    leaderboardSize: z.number(),
    entries: z.array(entrySchema),
    caller: entrySchema.nullable()
  })
  .catchall(z.unknown());

const errorSchema = z.object({ code: z.string(), message: z.string() }).catchall(z.unknown());

function participantRow(
  id: string,
  type: string,
  completedAt: string | null,
  penaltySeconds: number
): ParticipantRow {
  return {
    id,
    event_id: "ev1",
    type,
    name: id,
    event_points: 0,
    penalty_seconds: penaltySeconds,
    completed_at: completedAt
  };
}

function completedRow(participantId: string, key: string, completedAt: string): ProgressRow {
  return {
    id: `${participantId}-${key}`,
    participant_id: participantId,
    challenge_id: "ch1",
    objective_key: key,
    status: "completed",
    completed_by: participantId,
    completed_at: completedAt,
    data_json: null,
    idempotency_key: null
  };
}

describe("rankParticipants", () => {
  it("orders finished teams by official finish including penalties", () => {
    const ranked = rankParticipants(
      [
        participantRow("early", "team", at(0), 3600),
        participantRow("late", "team", at(1800_000), 0)
      ],
      new Map([
        ["early", [completedRow("early", "t1", at(0))]],
        ["late", [completedRow("late", "t1", at(1800_000))]]
      ]),
      new Set(["ch1:t1"])
    );
    expect(ranked.map((entry) => entry.participantId)).toEqual(["late", "early"]);
    expect(ranked[0]?.officialFinishAt).toBe(at(1800_000));
    expect(ranked[1]?.officialFinishAt).toBe(at(3600_000));
  });

  it("ranks unfinished teams by completions then recency", () => {
    const ranked = rankParticipants(
      [
        participantRow("none", "solo", null, 0),
        participantRow("one-recent", "solo", null, 0),
        participantRow("one-early", "solo", null, 0),
        participantRow("two", "solo", null, 0),
        participantRow("done", "solo", at(60_000), 0)
      ],
      new Map([
        ["one-recent", [completedRow("one-recent", "t1", at(500_000))]],
        ["one-early", [completedRow("one-early", "t1", at(100_000))]],
        [
          "two",
          [completedRow("two", "t1", at(100_000)), completedRow("two", "t2", at(900_000))]
        ],
        ["done", [completedRow("done", "t1", at(60_000))]]
      ]),
      new Set(["ch1:t1", "ch1:t2"])
    );
    expect(ranked.map((entry) => entry.participantId)).toEqual([
      "done",
      "two",
      "one-early",
      "one-recent",
      "none"
    ]);
  });
});

describe("leaderboard route", () => {
  it("returns the top 10 plus caller neighbors with provisional status", async () => {
    const seed = await seedWorld("live");
    const res = await app.request(
      "/api/events/ev1/leaderboard",
      { headers: { Cookie: `cmp_session=${seed.tokenCaller}` } },
      testEnv(seed.db)
    );
    expect(res.status).toBe(200);
    const body: unknown = await res.json();
    const parsed = boardSchema.safeParse(body);
    expect(parsed.success).toBe(true);
    if (parsed.success === false) {
      expect.unreachable();
    }
    expect(parsed.data.eventId).toBe("ev1");
    expect(parsed.data.provisional).toBe(true);
    expect(parsed.data.leaderboardSize).toBe(10);
    expect(parsed.data.entries.map((entry) => entry.rank)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
    expect(parsed.data.entries[0]?.participantId).toBe("f2");
    expect(parsed.data.entries[9]?.participantId).toBe("f11");
    expect(parsed.data.entries[10]?.participantId).toBe("f1");
    expect(parsed.data.entries[10]?.officialFinishAt).toBe(at(60_000 + 3600_000));
    expect(parsed.data.entries[11]?.participantId).toBe("c1");
    expect(parsed.data.entries[11]?.isCaller).toBe(true);
    expect(parsed.data.caller?.participantId).toBe("c1");
    expect(parsed.data.caller?.rank).toBe(12);
    const raw = JSON.stringify(body);
    expect(raw).not.toContain("caller@example.com");
    expect(raw).not.toContain("First steps");
  });

  it("returns only the top 10 for anonymous viewers", async () => {
    const seed = await seedWorld("live");
    const res = await app.request("/api/events/ev1/leaderboard", {}, testEnv(seed.db));
    expect(res.status).toBe(200);
    const parsed = boardSchema.safeParse(await res.json());
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.entries).toHaveLength(10);
      expect(parsed.data.caller).toBeNull();
    }
  });

  it("marks the board final once the event completes", async () => {
    const seed = await seedWorld("completed");
    const res = await app.request(
      "/api/events/ev1/leaderboard",
      { headers: { Cookie: `cmp_session=${seed.tokenCaller}` } },
      testEnv(seed.db)
    );
    expect(res.status).toBe(200);
    const parsed = boardSchema.safeParse(await res.json());
    if (parsed.success) {
      expect(parsed.data.provisional).toBe(false);
    } else {
      expect.unreachable();
    }
  });

  it("filters by solo scope and drops the team caller", async () => {
    const seed = await seedWorld("live");
    const res = await app.request(
      "/api/events/ev1/leaderboard?scope=solo",
      { headers: { Cookie: `cmp_session=${seed.tokenCaller}` } },
      testEnv(seed.db)
    );
    expect(res.status).toBe(200);
    const parsed = boardSchema.safeParse(await res.json());
    if (parsed.success) {
      expect(parsed.data.entries.map((entry) => entry.participantId)).toEqual(["s1", "s2"]);
      expect(parsed.data.caller).toBeNull();
    } else {
      expect.unreachable();
    }
  });

  it("returns EVENT_NOT_FOUND for unknown events", async () => {
    const seed = await seedWorld("live");
    const res = await app.request("/api/events/missing/leaderboard", {}, testEnv(seed.db));
    expect(res.status).toBe(404);
    const parsed = errorSchema.safeParse(await res.json());
    if (parsed.success) {
      expect(parsed.data.code).toBe("EVENT_NOT_FOUND");
    } else {
      expect.unreachable();
    }
  });

  it("ignores progression unlock metadata when ranking", async () => {
    const seed = await seedWorld("live");
    const now = new Date().toISOString();
    seed.db.table("challenges").push({
      id: "ch2",
      event_id: "ev1",
      title: "Sealed",
      description: "Later",
      position: 2,
      configuration_json: JSON.stringify({
        objectives: [
          {
            key: "o1",
            type: "text_answer",
            prompt: "Sealed prompt",
            required: false,
            dependsOn: [],
            expectedAnswer: "sealed",
            eventPoints: 0,
            platformCredits: 0,
            hints: []
          }
        ],
        requires: ["ch1"],
        availableFrom: "2026-09-01T00:00:00.000Z",
        hiddenUntilUnlocked: true,
        requiresDecision: { challengeId: "ch1", objectiveKey: "route", value: "left" },
        isTerminal: true
      }),
      created_at: now,
      updated_at: now
    });
    const res = await app.request(
      "/api/events/ev1/leaderboard",
      { headers: { Cookie: `cmp_session=${seed.tokenCaller}` } },
      testEnv(seed.db)
    );
    expect(res.status).toBe(200);
    const parsed = boardSchema.safeParse(await res.json());
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.entries[0]?.participantId).toBe("f2");
      expect(parsed.data.caller?.participantId).toBe("c1");
    }
  });
});

describe("leaderboard settings and gates", () => {
  it("ranks by event points when the winner mode is highest_points", async () => {
    const seed = await seedWorld("live");
    const event = seed.db.table("events").find((row) => row["id"] === "ev1");
    if (event === undefined) {
      expect.unreachable();
      return;
    }
    event["settings_json"] = JSON.stringify({ winnerMode: "highest_points", leaderboardSize: 5 });
    const res = await app.request(
      "/api/events/ev1/leaderboard",
      { headers: { Cookie: `cmp_session=${seed.tokenCaller}` } },
      testEnv(seed.db)
    );
    expect(res.status).toBe(200);
    const parsed = boardSchema.safeParse(await res.json());
    expect(parsed.success).toBe(true);
    if (parsed.success === false) {
      return;
    }
    expect(parsed.data.leaderboardSize).toBe(5);
    const points = parsed.data.entries.map((entry) => entry.eventPoints);
    const sorted = [...points].sort((left, right) => right - left);
    expect(points).toEqual(sorted);
    expect(parsed.data.entries[0]?.eventPoints).toBe(30);
  });

  it("hides private leaderboards from anonymous viewers", async () => {
    const seed = await seedWorld("live");
    const event = seed.db.table("events").find((row) => row["id"] === "ev1");
    if (event === undefined) {
      expect.unreachable();
      return;
    }
    event["settings_json"] = JSON.stringify({ publicLeaderboard: false });
    const anonymous = await app.request("/api/events/ev1/leaderboard", {}, testEnv(seed.db));
    expect(anonymous.status).toBe(403);
    const authed = await app.request(
      "/api/events/ev1/leaderboard",
      { headers: { Cookie: `cmp_session=${seed.tokenCaller}` } },
      testEnv(seed.db)
    );
    expect(authed.status).toBe(200);
  });

  it("returns EVENT_NOT_FOUND for draft events", async () => {
    const seed = await seedWorld("draft");
    const res = await app.request(
      "/api/events/ev1/leaderboard",
      { headers: { Cookie: `cmp_session=${seed.tokenCaller}` } },
      testEnv(seed.db)
    );
    expect(res.status).toBe(404);
  });
});
