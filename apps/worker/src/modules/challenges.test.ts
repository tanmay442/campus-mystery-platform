/** Phase 1 challenge fetch, submission, attempts, idempotency, and hint tests. */

import { describe, expect, it } from "vitest";
import { z } from "zod";
import { validateAnswer } from "@campus/shared";
import type { ObjectiveConfig, ValidationMode } from "@campus/shared";
import app from "../index";
import type { DatabaseBinding, Env, PreparedStatementBinding } from "../env";
import { sha256Hex } from "../lib/crypto";
import { checkAttemptGate, readProgressData } from "./challenges";
import type { ProgressData } from "./challenges";

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

  all(): Promise<Row[]> {
    return this.db.handleAll(this.query, this.params);
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

export class FakeDb {
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
    if (marker === "session_user") {
      const session = this.table("sessions").find((row) => row["token_hash"] === params[0]);
      if (session === undefined) {
        return null;
      }
      const user = this.table("users").find((row) => row["id"] === session["user_id"]);
      if (user === undefined) {
        return null;
      }
      return {
        id: user["id"],
        email: user["email"],
        email_verified: user["email_verified"],
        expires_at: session["expires_at"],
        revoked_at: session["revoked_at"]
      };
    }
    if (marker === "event_by_id" || marker === "challenge_by_id" || marker === "user_row") {
      const tableName =
        marker === "event_by_id" ? "events" : marker === "challenge_by_id" ? "challenges" : "users";
      return this.table(tableName).find((row) => row["id"] === params[0]) ?? null;
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
        this.table("objective_progress").find((row) => row["idempotency_key"] === params[0]) ??
        null
      );
    }
    throw new Error(`unsupported first marker ${marker}`);
  }

  async handleAll(query: string, params: Array<unknown>): Promise<Row[]> {
    const marker = markerOf(query);
    if (marker === "challenges_by_event") {
      return this.table("challenges")
        .filter((row) => row["event_id"] === params[0])
        .sort((left, right) => Number(left["position"]) - Number(right["position"]));
    }
    if (marker === "participants_by_event") {
      return this.table("participants").filter((row) => row["event_id"] === params[0]);
    }
    if (marker === "members_active") {
      return this.table("participant_members")
        .filter((row) => row["participant_id"] === params[0] && row["left_at"] === null)
        .map((row) => ({ participant_id: row["participant_id"], user_id: row["user_id"] }));
    }
    if (marker === "progress_rows") {
      return this.table("objective_progress").filter(
        (row) => row["participant_id"] === params[0] && row["challenge_id"] === params[1]
      );
    }
    if (marker === "progress_completed_participant") {
      return this.table("objective_progress").filter(
        (row) => row["participant_id"] === params[0] && row["status"] === "completed"
      );
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
    if (marker === "credit_txs_by_user") {
      const limit = typeof params[1] === "number" ? params[1] : 50;
      return this.table("credit_transactions")
        .filter((row) => row["user_id"] === params[0])
        .sort((left, right) => String(right["created_at"]).localeCompare(String(left["created_at"])))
        .slice(0, limit);
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
      if (
        params[4] !== null &&
        rows.some((entry) => entry["id"] !== params[6] && entry["idempotency_key"] === params[4])
      ) {
        throw new Error("UNIQUE constraint failed: idempotency_key");
      }
      row["status"] = params[0];
      row["completed_by"] = params[1];
      row["completed_at"] = params[2];
      row["data_json"] = params[3];
      row["idempotency_key"] = params[4];
      row["updated_at"] = params[5];
      return { success: true };
    }
    if (marker === "update_progress_data") {
      const row = this.table("objective_progress").find((entry) => entry["id"] === params[2]);
      if (row === undefined) {
        throw new Error("progress row not found");
      }
      row["data_json"] = params[0];
      row["updated_at"] = params[1];
      return { success: true };
    }
    if (marker === "update_progress_attempt") {
      const row = this.table("objective_progress").find(
        (entry) =>
          entry["participant_id"] === params[3] &&
          entry["challenge_id"] === params[4] &&
          entry["objective_key"] === params[5]
      );
      if (row === undefined) {
        throw new Error("progress row not found");
      }
      row["status"] = params[0];
      row["data_json"] = params[1];
      row["updated_at"] = params[2];
      return { success: true };
    }
    if (marker === "add_participant_points" || marker === "subtract_participant_points") {
      const row = this.table("participants").find((entry) => entry["id"] === params[2]);
      if (row === undefined) {
        throw new Error("participant not found");
      }
      row["event_points"] = params[0];
      row["updated_at"] = params[1];
      return { success: true };
    }
    if (marker === "set_participant_completed") {
      const row = this.table("participants").find((entry) => entry["id"] === params[2]);
      if (row === undefined) {
        throw new Error("participant not found");
      }
      row["completed_at"] = params[0];
      row["updated_at"] = params[1];
      return { success: true };
    }
    if (marker === "add_user_credits") {
      const row = this.table("users").find((entry) => entry["id"] === params[2]);
      if (row === undefined) {
        throw new Error("user not found");
      }
      const current = row["platform_credits"];
      const amount = params[0];
      row["platform_credits"] =
        typeof current === "number" && typeof amount === "number" ? current + amount : amount;
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

const TEXT_SECRET = "St. John's Library";

function challengeConfig(): string {
  return JSON.stringify({
    objectives: [
      {
        key: "t1",
        type: "text_answer",
        prompt: "Where do quiet books live?",
        required: true,
        dependsOn: [],
        expectedAnswer: TEXT_SECRET,
        maxAttempts: 3,
        cooldownSeconds: 0,
        progressiveCooldown: false,
        wrongAnswerPenaltyPoints: 5,
        eventPoints: 10,
        platformCredits: 2,
        hints: [{ key: "h1", text: "Think quiet books", costPoints: 3 }],
        completionFact: "The library opened in 1962."
      },
      {
        key: "n1",
        type: "numeric_answer",
        prompt: "How many steps?",
        required: true,
        dependsOn: [],
        expectedNumeric: 42,
        numericTolerance: 0.5,
        eventPoints: 5,
        platformCredits: 0,
        hints: []
      },
      {
        key: "m1",
        type: "multiple_choice",
        prompt: "Pick the right banner",
        required: true,
        dependsOn: [],
        choices: [
          { id: "a", label: "Alpha" },
          { id: "b", label: "Beta" }
        ],
        correctChoiceId: "b",
        eventPoints: 4,
        platformCredits: 0,
        hints: []
      },
      {
        key: "s1",
        type: "ordered_sequence",
        prompt: "Order the colors",
        required: true,
        dependsOn: [],
        expectedSequence: ["red", "green", "blue"],
        eventPoints: 6,
        platformCredits: 0,
        hints: []
      },
      {
        key: "c1",
        type: "code",
        prompt: "Enter the volunteer code",
        required: false,
        dependsOn: [],
        expectedAnswer: "OWL-42",
        cooldownSeconds: 60,
        progressiveCooldown: true,
        eventPoints: 3,
        platformCredits: 0,
        hints: []
      },
      {
        key: "d1",
        type: "decision",
        prompt: "Choose a route",
        required: false,
        dependsOn: [],
        eventPoints: 0,
        platformCredits: 0,
        hints: []
      },
      {
        key: "loc1",
        type: "location",
        prompt: "Find the old gate",
        required: false,
        dependsOn: [],
        location: {
          latitude: 28.6139,
          longitude: 77.209,
          radiusMeters: 10,
          maximumAccuracyMeters: 20,
          requiredReadings: 3,
          collectionDurationSeconds: 8,
          readingsExpireAfterSeconds: 60
        },
        revealCoordinates: false,
        eventPoints: 8,
        platformCredits: 1,
        hints: []
      }
    ]
  });
}

interface Seed {
  db: FakeDb;
  tokenU1: string;
  tokenU2: string;
  tokenOutsider: string;
}

async function seedWorld(status: string): Promise<Seed> {
  const db = new FakeDb();
  const now = new Date().toISOString();
  db.table("users").push(
    {
      id: "u1",
      auth_provider_id: "auth-u1",
      email: "u1@example.com",
      email_verified: 1,
      username: "player-one",
      display_name: "Player One",
      platform_credits: 0,
      presence_visibility: "visible",
      created_at: now,
      updated_at: now
    },
    {
      id: "u2",
      auth_provider_id: "auth-u2",
      email: "u2@example.com",
      email_verified: 1,
      username: "player-two",
      display_name: "Player Two",
      platform_credits: 0,
      presence_visibility: "visible",
      created_at: now,
      updated_at: now
    },
    {
      id: "u3",
      auth_provider_id: "auth-u3",
      email: "u3@example.com",
      email_verified: 1,
      username: "outsider",
      display_name: "Outsider",
      platform_credits: 0,
      presence_visibility: "visible",
      created_at: now,
      updated_at: now
    }
  );
  db.table("events").push({
    id: "ev1",
    name: "Pilot",
    slug: "pilot",
    description: null,
    status,
    starts_at: now,
    ends_at: null,
    settings_json: "{}",
    created_by: "u1",
    created_at: now,
    updated_at: now
  });
  db.table("participants").push({
    id: "p1",
    event_id: "ev1",
    type: "team",
    name: "Owls",
    event_points: 0,
    penalty_seconds: 0,
    started_at: now,
    completed_at: null,
    created_at: now,
    updated_at: now
  });
  db.table("participant_members").push(
    { id: "m1", participant_id: "p1", user_id: "u1", role: "captain", joined_at: now, left_at: null },
    { id: "m2", participant_id: "p1", user_id: "u2", role: "member", joined_at: now, left_at: null }
  );
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
  const tokenU1 = "token-u1";
  const tokenU2 = "token-u2";
  const tokenOutsider = "token-u3";
  const expires = new Date(Date.now() + 3600_000).toISOString();
  const sessions: Array<[string, string]> = [
    ["s1", tokenU1],
    ["s2", tokenU2],
    ["s3", tokenOutsider]
  ];
  for (const [id, token] of sessions) {
    db.table("sessions").push({
      id,
      user_id: id === "s1" ? "u1" : id === "s2" ? "u2" : "u3",
      token_hash: await sha256Hex(token),
      device_label: null,
      ip_hash: null,
      created_at: now,
      last_seen_at: now,
      expires_at: expires,
      revoked_at: null
    });
  }
  return { db, tokenU1, tokenU2, tokenOutsider };
}

function cookieFor(token: string): string {
  return `cmp_session=${token}`;
}

async function postJson(
  db: DatabaseBinding,
  path: string,
  token: string,
  payload: unknown,
  idempotencyKey?: string
): Promise<Response> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Cookie: cookieFor(token)
  };
  if (idempotencyKey !== undefined) {
    headers["Idempotency-Key"] = idempotencyKey;
  }
  return app.request(
    path,
    { method: "POST", headers, body: JSON.stringify(payload) },
    testEnv(db)
  );
}

const errorSchema = z.object({ code: z.string(), message: z.string() }).catchall(z.unknown());

const submitSuccessSchema = z
  .object({
    completed: z.literal(true),
    objectiveKey: z.string(),
    eventPointsAward: z.number(),
    platformCreditsAward: z.number(),
    completedAt: z.string(),
    completedBy: z.string(),
    replayed: z.boolean(),
    idempotentReplay: z.boolean()
  })
  .catchall(z.unknown());

const fetchSchema = z
  .object({
    challenge: z.object({ id: z.string() }).catchall(z.unknown()),
    participant: z.object({ id: z.string(), eventPoints: z.number() }).catchall(z.unknown()),
    objectives: z.array(
      z
        .object({
          key: z.string(),
          type: z.string(),
          prompt: z.string(),
          status: z.string(),
          attemptsLeft: z.number().optional(),
          choices: z.array(z.object({ id: z.string(), label: z.string() })).optional(),
          hints: z.array(
            z.object({ key: z.string(), costPoints: z.number(), unlocked: z.boolean() })
          ),
          coordinates: z.object({ latitude: z.number(), longitude: z.number() }).optional()
        })
        .catchall(z.unknown())
    ),
    completed: z.boolean()
  })
  .catchall(z.unknown());

describe("validateAnswer", () => {
  it("matches normalized text with punctuation and spacing differences", () => {
    expect(
      validateAnswer({ mode: "normalized", submitted: "  st johns library ", expected: TEXT_SECRET })
    ).toBe(true);
    expect(validateAnswer({ mode: "normalized", submitted: "cafeteria", expected: TEXT_SECRET })).toBe(
      false
    );
  });

  it("matches case-insensitive codes and rejects wrong ones", () => {
    expect(validateAnswer({ mode: "case_insensitive", submitted: "owl-42", expected: "OWL-42" })).toBe(
      true
    );
    expect(validateAnswer({ mode: "exact", submitted: "owl-42", expected: "OWL-42" })).toBe(false);
  });

  it("matches accepted lists without revealing which entry matched", () => {
    const input = (submitted: unknown): { mode: ValidationMode; submitted: unknown; acceptedAnswers: string[] } => ({
      mode: "accepted_list",
      submitted,
      acceptedAnswers: ["lending desk", "second answer"]
    });
    expect(validateAnswer(input("Second Answer!"))).toBe(true);
    expect(validateAnswer(input("nope"))).toBe(false);
  });

  it("validates numeric exact and tolerance boundaries", () => {
    expect(validateAnswer({ mode: "numeric_exact", submitted: "42", expectedNumeric: 42 })).toBe(true);
    expect(validateAnswer({ mode: "numeric_exact", submitted: 42.1, expectedNumeric: 42 })).toBe(false);
    expect(
      validateAnswer({ mode: "numeric_tolerance", submitted: 42.4, expectedNumeric: 42, tolerance: 0.5 })
    ).toBe(true);
    expect(
      validateAnswer({ mode: "numeric_tolerance", submitted: 42.6, expectedNumeric: 42, tolerance: 0.5 })
    ).toBe(false);
    expect(
      validateAnswer({ mode: "numeric_tolerance", submitted: "not-a-number", expectedNumeric: 42 })
    ).toBe(false);
  });

  it("validates ordered sequences strictly", () => {
    expect(
      validateAnswer({
        mode: "ordered_sequence",
        submitted: ["Red", "green", "BLUE"],
        expectedSequence: ["red", "green", "blue"]
      })
    ).toBe(true);
    expect(
      validateAnswer({
        mode: "ordered_sequence",
        submitted: ["green", "red", "blue"],
        expectedSequence: ["red", "green", "blue"]
      })
    ).toBe(false);
    expect(
      validateAnswer({
        mode: "ordered_sequence",
        submitted: ["red", "green"],
        expectedSequence: ["red", "green", "blue"]
      })
    ).toBe(false);
  });
});

describe("challenge fetch", () => {
  it("requires authentication", async () => {
    const seed = await seedWorld("live");
    const res = await app.request("/api/challenges/ch1", {}, testEnv(seed.db));
    expect(res.status).toBe(401);
  });

  it("strips answers, tolerances, and coordinates from the response", async () => {
    const seed = await seedWorld("live");
    const res = await app.request(
      "/api/challenges/ch1",
      { headers: { Cookie: cookieFor(seed.tokenU1) } },
      testEnv(seed.db)
    );
    expect(res.status).toBe(200);
    const body: unknown = await res.json();
    const parsed = fetchSchema.safeParse(body);
    expect(parsed.success).toBe(true);
    const rawText = JSON.stringify(body);
    expect(rawText).not.toContain(TEXT_SECRET);
    expect(rawText).not.toContain("28.6139");
    expect(rawText).not.toContain("correctChoiceId");
    expect(rawText).not.toContain("expectedSequence");
    if (parsed.success) {
      const text = parsed.data.objectives.find((entry) => entry.key === "t1");
      expect(text?.attemptsLeft).toBe(3);
      const choice = parsed.data.objectives.find((entry) => entry.key === "m1");
      expect(choice?.choices).toEqual([
        { id: "a", label: "Alpha" },
        { id: "b", label: "Beta" }
      ]);
      const location = parsed.data.objectives.find((entry) => entry.key === "loc1");
      expect(location?.coordinates).toBeUndefined();
    }
  });

  it("rejects viewers who are not participants", async () => {
    const seed = await seedWorld("live");
    const res = await app.request(
      "/api/challenges/ch1",
      { headers: { Cookie: cookieFor(seed.tokenOutsider) } },
      testEnv(seed.db)
    );
    expect(res.status).toBe(403);
  });
});

describe("answer submission", () => {
  it("accepts a normalized answer and awards points once", async () => {
    const seed = await seedWorld("live");
    const res = await postJson(seed.db, "/api/challenges/ch1/objectives/t1/submit", seed.tokenU1, {
      answer: "  st johns library "
    });
    expect(res.status).toBe(200);
    const parsed = submitSuccessSchema.safeParse(await res.json());
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.eventPointsAward).toBe(10);
      expect(parsed.data.platformCreditsAward).toBe(2);
    }
    const fetch = await app.request(
      "/api/challenges/ch1",
      { headers: { Cookie: cookieFor(seed.tokenU1) } },
      testEnv(seed.db)
    );
    const fetched = fetchSchema.safeParse(await fetch.json());
    expect(fetched.success).toBe(true);
    if (fetched.success) {
      expect(fetched.data.participant.eventPoints).toBe(10);
      expect(fetched.data.objectives.find((entry) => entry.key === "t1")?.status).toBe("completed");
    }
    const user = seed.db.table("users").find((row) => row["id"] === "u1");
    expect(user?.["platform_credits"]).toBe(2);
    const teammate = seed.db.table("users").find((row) => row["id"] === "u2");
    expect(teammate?.["platform_credits"]).toBe(2);
    expect(seed.db.table("credit_transactions")).toHaveLength(2);
  });

  it("replays the same idempotency key without double rewards", async () => {
    const seed = await seedWorld("live");
    const first = await postJson(
      seed.db,
      "/api/challenges/ch1/objectives/n1/submit",
      seed.tokenU1,
      { answer: 42 },
      "key-abc"
    );
    expect(first.status).toBe(200);
    const second = await postJson(
      seed.db,
      "/api/challenges/ch1/objectives/n1/submit",
      seed.tokenU1,
      { answer: 42 },
      "key-abc"
    );
    expect(second.status).toBe(200);
    const parsed = submitSuccessSchema.safeParse(await second.json());
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.idempotentReplay).toBe(true);
    }
    const fetch = await app.request(
      "/api/challenges/ch1",
      { headers: { Cookie: cookieFor(seed.tokenU1) } },
      testEnv(seed.db)
    );
    const fetched = fetchSchema.safeParse(await fetch.json());
    if (fetched.success) {
      expect(fetched.data.participant.eventPoints).toBe(5);
    } else {
      expect.unreachable();
    }
  });

  it("lets a teammate reuse the completed result without extra points", async () => {
    const seed = await seedWorld("live");
    const first = await postJson(seed.db, "/api/challenges/ch1/objectives/m1/submit", seed.tokenU1, {
      answer: "b"
    });
    expect(first.status).toBe(200);
    const second = await postJson(
      seed.db,
      "/api/challenges/ch1/objectives/m1/submit",
      seed.tokenU2,
      { answer: "b" }
    );
    expect(second.status).toBe(200);
    const parsed = submitSuccessSchema.safeParse(await second.json());
    if (parsed.success) {
      expect(parsed.data.replayed).toBe(true);
    } else {
      expect.unreachable();
    }
    const fetch = await app.request(
      "/api/challenges/ch1",
      { headers: { Cookie: cookieFor(seed.tokenU1) } },
      testEnv(seed.db)
    );
    const fetched = fetchSchema.safeParse(await fetch.json());
    if (fetched.success) {
      expect(fetched.data.participant.eventPoints).toBe(4);
    } else {
      expect.unreachable();
    }
  });

  it("rejects wrong answers without hints and enforces max attempts", async () => {
    const seed = await seedWorld("live");
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const res = await postJson(
        seed.db,
        "/api/challenges/ch1/objectives/t1/submit",
        seed.tokenU1,
        { answer: "wrong" }
      );
      expect(res.status).toBe(422);
      const payload: unknown = await res.json();
      const parsed = errorSchema.safeParse(payload);
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.code).toBe("INVALID_ANSWER");
      }
      expect(JSON.stringify(payload)).not.toContain(TEXT_SECRET);
    }
    const blocked = await postJson(
      seed.db,
      "/api/challenges/ch1/objectives/t1/submit",
      seed.tokenU1,
      { answer: "wrong" }
    );
    expect(blocked.status).toBe(429);
    const parsed = errorSchema.safeParse(await blocked.json());
    if (parsed.success) {
      expect(parsed.data.code).toBe("TOO_MANY_ATTEMPTS");
    } else {
      expect.unreachable();
    }
  });

  it("applies a progressive cooldown after a wrong code", async () => {
    const seed = await seedWorld("live");
    const wrong = await postJson(seed.db, "/api/challenges/ch1/objectives/c1/submit", seed.tokenU1, {
      answer: "nope"
    });
    expect(wrong.status).toBe(422);
    const retry = await postJson(
      seed.db,
      "/api/challenges/ch1/objectives/c1/submit",
      seed.tokenU1,
      { answer: "OWL-42" }
    );
    expect(retry.status).toBe(429);
    const parsed = z
      .object({ code: z.string(), details: z.object({ retry_after_seconds: z.number() }) })
      .safeParse(await retry.json());
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.code).toBe("COOLDOWN");
      expect(parsed.data.details.retry_after_seconds).toBeGreaterThan(0);
    }
  });

  it("scales progressive cooldowns exponentially", () => {
    const base: ProgressData = {
      attempts: 2,
      wrongAttempts: 2,
      lastAttemptAt: new Date().toISOString(),
      hintsUnlocked: []
    };
    const objective: ObjectiveConfig = {
      key: "c1",
      type: "code",
      prompt: "code",
      required: false,
      dependsOn: [],
      cooldownSeconds: 60,
      progressiveCooldown: true,
      wrongAnswerPenaltyPoints: 0,
      eventPoints: 0,
      platformCredits: 0,
      revealCoordinates: false,
      hints: []
    };
    const gate = checkAttemptGate(objective, base, Date.now());
    expect(gate.kind).toBe("cooldown");
    if (gate.kind === "cooldown") {
      expect(gate.retryAfterSeconds).toBeLessThanOrEqual(120);
    }
    expect(readProgressData("not-json").attempts).toBe(0);
  });

  it("blocks submissions while paused and after the event ends", async () => {
    const paused = await seedWorld("paused");
    const pausedRes = await postJson(
      paused.db,
      "/api/challenges/ch1/objectives/t1/submit",
      paused.tokenU1,
      { answer: "x" }
    );
    expect(pausedRes.status).toBe(409);
    const pausedBody = errorSchema.safeParse(await pausedRes.json());
    if (pausedBody.success) {
      expect(pausedBody.data.code).toBe("EVENT_PAUSED");
    } else {
      expect.unreachable();
    }
    const ended = await seedWorld("completed");
    const endedRes = await postJson(
      ended.db,
      "/api/challenges/ch1/objectives/t1/submit",
      ended.tokenU1,
      { answer: "x" }
    );
    expect(endedRes.status).toBe(409);
    const endedBody = errorSchema.safeParse(await endedRes.json());
    if (endedBody.success) {
      expect(endedBody.data.code).toBe("CONFLICT");
    } else {
      expect.unreachable();
    }
  });

  it("returns 501 for Phase 1 unsupported objective types", async () => {
    const seed = await seedWorld("live");
    const res = await postJson(seed.db, "/api/challenges/ch1/objectives/d1/submit", seed.tokenU1, {
      answer: "left"
    });
    expect(res.status).toBe(501);
  });
});

describe("hint unlocks", () => {
  it("charges once and replays the second unlock", async () => {
    const seed = await seedWorld("live");
    await postJson(seed.db, "/api/challenges/ch1/objectives/t1/submit", seed.tokenU1, {
      answer: "st johns library"
    });
    const first = await postJson(seed.db, "/api/challenges/ch1/hints/h1/unlock", seed.tokenU1, {});
    expect(first.status).toBe(200);
    const firstBody = z
      .object({ hintKey: z.string(), text: z.string(), eventPoints: z.number() })
      .safeParse(await first.json());
    expect(firstBody.success).toBe(true);
    if (firstBody.success) {
      expect(firstBody.data.text).toContain("quiet books");
      expect(firstBody.data.eventPoints).toBe(7);
    }
    const second = await postJson(seed.db, "/api/challenges/ch1/hints/h1/unlock", seed.tokenU1, {});
    expect(second.status).toBe(200);
    const secondBody = z
      .object({ alreadyUnlocked: z.boolean(), eventPoints: z.number() })
      .catchall(z.unknown())
      .safeParse(await second.json());
    if (secondBody.success) {
      expect(secondBody.data.alreadyUnlocked).toBe(true);
      expect(secondBody.data.eventPoints).toBe(7);
    } else {
      expect.unreachable();
    }
  });
});
