/** Phase 1 location sessions, server-side geofence verification, and persistence tests. */

import { describe, expect, it } from "vitest";
import { z } from "zod";
import { haversineMeters } from "@campus/shared";
import app from "../index";
import type { DatabaseBinding, Env, PreparedStatementBinding } from "../env";
import { sha256Hex } from "../lib/crypto";
import { evaluateLocationReadings, selectVerifyReadings } from "./location";

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

const TARGET_LATITUDE = 28.6139;
const TARGET_LONGITUDE = 77.209;

function challengeConfig(): string {
  const locationFields = {
    latitude: TARGET_LATITUDE,
    longitude: TARGET_LONGITUDE,
    radiusMeters: 10,
    maximumAccuracyMeters: 20,
    requiredReadings: 3,
    collectionDurationSeconds: 8,
    readingsExpireAfterSeconds: 60
  };
  return JSON.stringify({
    objectives: [
      {
        key: "loc1",
        type: "location",
        prompt: "Find the old gate",
        required: true,
        dependsOn: [],
        location: locationFields,
        revealCoordinates: false,
        placeName: "Old Gate",
        guidanceText: "Where silence is expected, knowledge is borrowed.",
        eventPoints: 8,
        platformCredits: 1,
        hints: []
      },
      {
        key: "t1",
        type: "text_answer",
        prompt: "Name the hall",
        required: true,
        dependsOn: [],
        expectedAnswer: "Founders Hall",
        eventPoints: 5,
        platformCredits: 0,
        hints: []
      },
      {
        key: "loc3",
        type: "location",
        prompt: "Find the inner court",
        required: false,
        dependsOn: ["loc1"],
        location: locationFields,
        revealCoordinates: false,
        eventPoints: 4,
        platformCredits: 0,
        hints: []
      }
    ]
  });
}

function revealedChallengeConfig(): string {
  return JSON.stringify({
    objectives: [
      {
        key: "loc2",
        type: "location",
        prompt: "Find the marked pillar",
        required: false,
        dependsOn: [],
        location: {
          latitude: TARGET_LATITUDE,
          longitude: TARGET_LONGITUDE,
          radiusMeters: 10,
          maximumAccuracyMeters: 20,
          requiredReadings: 3,
          collectionDurationSeconds: 8,
          readingsExpireAfterSeconds: 60
        },
        revealCoordinates: true,
        eventPoints: 2,
        platformCredits: 0,
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
  db.table("challenges").push(
    {
      id: "ch1",
      event_id: "ev1",
      title: "Gates",
      description: "Walk",
      position: 1,
      configuration_json: challengeConfig(),
      created_at: now,
      updated_at: now
    },
    {
      id: "ch2",
      event_id: "ev1",
      title: "Pillar",
      description: "Look",
      position: 2,
      configuration_json: revealedChallengeConfig(),
      created_at: now,
      updated_at: now
    },
    {
      id: "ch3",
      event_id: "ev1",
      title: "Vault",
      description: "Sealed",
      position: 3,
      configuration_json: JSON.stringify({
        objectives: [
          {
            key: "loc9",
            type: "location",
            prompt: "Find the sealed vault",
            required: true,
            dependsOn: [],
            location: {
              latitude: TARGET_LATITUDE,
              longitude: TARGET_LONGITUDE,
              radiusMeters: 10,
              maximumAccuracyMeters: 20,
              requiredReadings: 3,
              collectionDurationSeconds: 8,
              readingsExpireAfterSeconds: 60
            },
            revealCoordinates: false,
            eventPoints: 4,
            platformCredits: 0,
            hints: []
          }
        ],
        requires: ["ch1"],
        isTerminal: true
      }),
      created_at: now,
      updated_at: now
    },
    {
      id: "ch4",
      event_id: "ev1",
      title: "Buried",
      description: "Hidden",
      position: 4,
      configuration_json: JSON.stringify({
        objectives: [
          {
            key: "locH",
            type: "location",
            prompt: "Find the buried cache",
            required: true,
            dependsOn: [],
            location: {
              latitude: TARGET_LATITUDE,
              longitude: TARGET_LONGITUDE,
              radiusMeters: 10,
              maximumAccuracyMeters: 20,
              requiredReadings: 3,
              collectionDurationSeconds: 8,
              readingsExpireAfterSeconds: 60
            },
            revealCoordinates: false,
            eventPoints: 4,
            platformCredits: 0,
            hints: []
          }
        ],
        requires: ["ch1"],
        hiddenUntilUnlocked: true,
        isTerminal: true
      }),
      created_at: now,
      updated_at: now
    }
  );
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

interface TestReading {
  latitude: number;
  longitude: number;
  accuracyMeters: number;
  capturedAt: string;
  [key: string]: unknown;
}

function nearReadings(): TestReading[] {
  const now = Date.now();
  return [
    {
      latitude: TARGET_LATITUDE + 0.00001,
      longitude: TARGET_LONGITUDE + 0.00001,
      accuracyMeters: 5,
      capturedAt: new Date(now - 9500).toISOString()
    },
    {
      latitude: TARGET_LATITUDE - 0.00001,
      longitude: TARGET_LONGITUDE + 0.00002,
      accuracyMeters: 8,
      capturedAt: new Date(now - 5000).toISOString()
    },
    {
      latitude: TARGET_LATITUDE + 0.00002,
      longitude: TARGET_LONGITUDE - 0.00001,
      accuracyMeters: 6,
      capturedAt: new Date(now - 500).toISOString()
    }
  ];
}

function farReadings(): TestReading[] {
  const now = Date.now();
  return [
    { latitude: 28.62, longitude: 77.22, accuracyMeters: 5, capturedAt: new Date(now - 9500).toISOString() },
    { latitude: 28.62001, longitude: 77.22001, accuracyMeters: 5, capturedAt: new Date(now - 5000).toISOString() },
    { latitude: 28.61999, longitude: 77.21999, accuracyMeters: 5, capturedAt: new Date(now - 500).toISOString() }
  ];
}

async function postJson(
  db: DatabaseBinding,
  path: string,
  token: string | undefined,
  payload: unknown,
  idempotencyKey?: string
): Promise<Response> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token !== undefined) {
    headers["Cookie"] = cookieFor(token);
  }
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

const sessionSchema = z
  .object({
    objectiveKey: z.string(),
    status: z.string(),
    requiredReadings: z.number(),
    readingsExpireAfterSeconds: z.number(),
    collectionDurationSeconds: z.number(),
    maximumAccuracyMeters: z.number(),
    coordinatesRevealed: z.boolean(),
    coordinates: z.object({ latitude: z.number(), longitude: z.number() }).optional()
  })
  .catchall(z.unknown());

const verifySuccessSchema = z
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

describe("haversineMeters", () => {
  it("returns zero for identical points and ~111km per degree of latitude", () => {
    expect(haversineMeters(28.6, 77.2, 28.6, 77.2)).toBe(0);
    const oneDegree = haversineMeters(28.0, 77.2, 29.0, 77.2);
    expect(oneDegree).toBeGreaterThan(110_000);
    expect(oneDegree).toBeLessThan(112_000);
  });
});

describe("selectVerifyReadings", () => {
  it("selects the most recent readings when extras are supplied", () => {
    const readings = [
      { latitude: 1, longitude: 1, accuracyMeters: 5, capturedAt: "2026-09-06T10:00:03.000Z" },
      { latitude: 1, longitude: 1, accuracyMeters: 5, capturedAt: "2026-09-06T10:00:01.000Z" },
      { latitude: 1, longitude: 1, accuracyMeters: 5, capturedAt: "2026-09-06T10:00:02.000Z" },
      { latitude: 1, longitude: 1, accuracyMeters: 5, capturedAt: "2026-09-06T10:00:00.000Z" }
    ];
    const selected = selectVerifyReadings(readings, 3);
    expect(selected.map((entry) => entry.capturedAt)).toEqual([
      "2026-09-06T10:00:01.000Z",
      "2026-09-06T10:00:02.000Z",
      "2026-09-06T10:00:03.000Z"
    ]);
  });
});

describe("evaluateLocationReadings", () => {
  const base = {
    targetLatitude: TARGET_LATITUDE,
    targetLongitude: TARGET_LONGITUDE,
    radiusMeters: 10,
    maximumAccuracyMeters: 20,
    readingsExpireAfterSeconds: 60,
    collectionDurationSeconds: 8
  };

  it("accepts fresh accurate readings inside the radius", () => {
    const now = Date.now();
    const evaluated = evaluateLocationReadings(
      nearReadings(),
      base.targetLatitude,
      base.targetLongitude,
      base.radiusMeters,
      base.maximumAccuracyMeters,
      base.readingsExpireAfterSeconds,
      base.collectionDurationSeconds,
      now
    );
    expect(evaluated.ok).toBe(true);
    if (evaluated.ok) {
      expect(evaluated.verified.maxDistanceMeters).toBeLessThanOrEqual(10);
      expect(evaluated.verified.worstAccuracyMeters).toBeLessThanOrEqual(20);
    }
  });

  it("rejects readings older than the expiry window", () => {
    const now = Date.now();
    const stale = nearReadings().map((entry, index) =>
      index === 0
        ? { ...entry, capturedAt: new Date(now - 120_000).toISOString() }
        : entry
    );
    const evaluated = evaluateLocationReadings(
      stale,
      base.targetLatitude,
      base.targetLongitude,
      base.radiusMeters,
      base.maximumAccuracyMeters,
      base.readingsExpireAfterSeconds,
      base.collectionDurationSeconds,
      now
    );
    expect(evaluated).toEqual({ ok: false, code: "stale" });
  });

  it("rejects readings collected too quickly", () => {
    const now = Date.now();
    const burst = nearReadings().map((entry) => ({
      ...entry,
      capturedAt: new Date(now - 1000).toISOString()
    }));
    const evaluated = evaluateLocationReadings(
      burst,
      base.targetLatitude,
      base.targetLongitude,
      base.radiusMeters,
      base.maximumAccuracyMeters,
      base.readingsExpireAfterSeconds,
      base.collectionDurationSeconds,
      now
    );
    expect(evaluated).toEqual({ ok: false, code: "span" });
  });

  it("rejects readings with poor reported accuracy", () => {
    const now = Date.now();
    const poor = nearReadings().map((entry) => ({ ...entry, accuracyMeters: 65 }));
    const evaluated = evaluateLocationReadings(
      poor,
      base.targetLatitude,
      base.targetLongitude,
      base.radiusMeters,
      base.maximumAccuracyMeters,
      base.readingsExpireAfterSeconds,
      base.collectionDurationSeconds,
      now
    );
    expect(evaluated).toEqual({ ok: false, code: "accuracy" });
  });

  it("rejects readings outside the geofence radius", () => {
    const evaluated = evaluateLocationReadings(
      farReadings(),
      base.targetLatitude,
      base.targetLongitude,
      base.radiusMeters,
      base.maximumAccuracyMeters,
      base.readingsExpireAfterSeconds,
      base.collectionDurationSeconds,
      Date.now()
    );
    expect(evaluated).toEqual({ ok: false, code: "distance" });
  });
});

describe("location session", () => {
  it("requires authentication", async () => {
    const seed = await seedWorld("live");
    const res = await postJson(seed.db, "/api/challenges/ch1/objectives/loc1/location-session", undefined, {});
    expect(res.status).toBe(401);
  });

  it("returns guidance without coordinates unless revealed", async () => {
    const seed = await seedWorld("live");
    const res = await postJson(seed.db, "/api/challenges/ch1/objectives/loc1/location-session", seed.tokenU1, {});
    expect(res.status).toBe(200);
    const body: unknown = await res.json();
    const parsed = sessionSchema.safeParse(body);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.objectiveKey).toBe("loc1");
      expect(parsed.data.status).toBe("available");
      expect(parsed.data.requiredReadings).toBe(3);
      expect(parsed.data.coordinatesRevealed).toBe(false);
      expect(parsed.data.coordinates).toBeUndefined();
    }
    expect(JSON.stringify(body)).not.toContain("28.6139");
  });

  it("reveals coordinates when the challenge opts in", async () => {
    const seed = await seedWorld("live");
    const res = await postJson(seed.db, "/api/challenges/ch2/objectives/loc2/location-session", seed.tokenU1, {});
    expect(res.status).toBe(200);
    const parsed = sessionSchema.safeParse(await res.json());
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.coordinatesRevealed).toBe(true);
      expect(parsed.data.coordinates).toEqual({ latitude: TARGET_LATITUDE, longitude: TARGET_LONGITUDE });
    }
  });

  it("reports locked status for dependent objectives", async () => {
    const seed = await seedWorld("live");
    const res = await postJson(seed.db, "/api/challenges/ch1/objectives/loc3/location-session", seed.tokenU1, {});
    expect(res.status).toBe(200);
    const parsed = sessionSchema.safeParse(await res.json());
    if (parsed.success) {
      expect(parsed.data.status).toBe("locked");
    } else {
      expect.unreachable();
    }
  });

  it("rejects non-location objectives", async () => {
    const seed = await seedWorld("live");
    const res = await postJson(seed.db, "/api/challenges/ch1/objectives/t1/location-session", seed.tokenU1, {});
    expect(res.status).toBe(400);
  });
});

describe("verify location", () => {
  it("accepts valid readings and records distance plus accuracy only", async () => {
    const seed = await seedWorld("live");
    const res = await postJson(
      seed.db,
      "/api/challenges/ch1/objectives/loc1/verify-location",
      seed.tokenU1,
      { readings: nearReadings() }
    );
    expect(res.status).toBe(200);
    const parsed = verifySuccessSchema.safeParse(await res.json());
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.eventPointsAward).toBe(8);
      expect(parsed.data.platformCreditsAward).toBe(1);
      expect(parsed.data.completedBy).toBe("u1");
      expect(parsed.data.replayed).toBe(false);
    }
    const row = seed.db
      .table("objective_progress")
      .find((entry) => entry["objective_key"] === "loc1");
    expect(row?.["status"]).toBe("completed");
    expect(row?.["completed_by"]).toBe("u1");
    const stored = String(row?.["data_json"] ?? "");
    expect(stored).toContain("distanceMeters");
    expect(stored).toContain("accuracyMeters");
    expect(stored).not.toContain("latitude");
    expect(stored).not.toContain("longitude");
    const participant = seed.db.table("participants").find((entry) => entry["id"] === "p1");
    expect(participant?.["event_points"]).toBe(8);
  });

  it("replays a teammate double-submit as one completion", async () => {
    const seed = await seedWorld("live");
    const first = await postJson(
      seed.db,
      "/api/challenges/ch1/objectives/loc1/verify-location",
      seed.tokenU1,
      { readings: nearReadings() }
    );
    expect(first.status).toBe(200);
    const second = await postJson(
      seed.db,
      "/api/challenges/ch1/objectives/loc1/verify-location",
      seed.tokenU2,
      { readings: nearReadings() }
    );
    expect(second.status).toBe(200);
    const parsed = verifySuccessSchema.safeParse(await second.json());
    if (parsed.success) {
      expect(parsed.data.replayed).toBe(true);
    } else {
      expect.unreachable();
    }
    const participant = seed.db.table("participants").find((entry) => entry["id"] === "p1");
    expect(participant?.["event_points"]).toBe(8);
  });

  it("replays the same idempotency key without double rewards", async () => {
    const seed = await seedWorld("live");
    const first = await postJson(
      seed.db,
      "/api/challenges/ch1/objectives/loc1/verify-location",
      seed.tokenU1,
      { readings: nearReadings() },
      "loc-key-1"
    );
    expect(first.status).toBe(200);
    const second = await postJson(
      seed.db,
      "/api/challenges/ch1/objectives/loc1/verify-location",
      seed.tokenU1,
      { readings: nearReadings() },
      "loc-key-1"
    );
    expect(second.status).toBe(200);
    const parsed = verifySuccessSchema.safeParse(await second.json());
    if (parsed.success) {
      expect(parsed.data.idempotentReplay).toBe(true);
    } else {
      expect.unreachable();
    }
    const participant = seed.db.table("participants").find((entry) => entry["id"] === "p1");
    expect(participant?.["event_points"]).toBe(8);
  });

  it("rejects stale readings without revealing the target", async () => {
    const seed = await seedWorld("live");
    const now = Date.now();
    const stale = nearReadings().map((entry) => ({
      ...entry,
      capturedAt: new Date(now - 300_000).toISOString()
    }));
    const res = await postJson(
      seed.db,
      "/api/challenges/ch1/objectives/loc1/verify-location",
      seed.tokenU1,
      { readings: stale }
    );
    expect(res.status).toBe(422);
    const payload: unknown = await res.json();
    const parsed = errorSchema.safeParse(payload);
    if (parsed.success) {
      expect(parsed.data.code).toBe("LOCATION_REJECTED");
    } else {
      expect.unreachable();
    }
    expect(JSON.stringify(payload)).not.toContain("28.6139");
  });

  it("rejects poor accuracy with a move-and-wait message", async () => {
    const seed = await seedWorld("live");
    const poor = nearReadings().map((entry) => ({ ...entry, accuracyMeters: 80 }));
    const res = await postJson(
      seed.db,
      "/api/challenges/ch1/objectives/loc1/verify-location",
      seed.tokenU1,
      { readings: poor }
    );
    expect(res.status).toBe(422);
    const payload: unknown = await res.json();
    const parsed = errorSchema.safeParse(payload);
    if (parsed.success) {
      expect(parsed.data.code).toBe("LOCATION_REJECTED");
      expect(parsed.data.message).toMatch(/open area|wait/i);
    } else {
      expect.unreachable();
    }
  });

  it("rejects distant readings without revealing the target", async () => {
    const seed = await seedWorld("live");
    const res = await postJson(
      seed.db,
      "/api/challenges/ch1/objectives/loc1/verify-location",
      seed.tokenU1,
      { readings: farReadings() }
    );
    expect(res.status).toBe(422);
    const payload: unknown = await res.json();
    const parsed = errorSchema.safeParse(payload);
    if (parsed.success) {
      expect(parsed.data.code).toBe("LOCATION_REJECTED");
    } else {
      expect.unreachable();
    }
    expect(JSON.stringify(payload)).not.toContain("28.6139");
    expect(JSON.stringify(payload)).not.toContain("77.209");
  });

  it("requires the configured number of readings", async () => {
    const seed = await seedWorld("live");
    const res = await postJson(
      seed.db,
      "/api/challenges/ch1/objectives/loc1/verify-location",
      seed.tokenU1,
      { readings: nearReadings().slice(0, 2) }
    );
    expect(res.status).toBe(400);
  });

  it("blocks locked objectives", async () => {
    const seed = await seedWorld("live");
    const res = await postJson(
      seed.db,
      "/api/challenges/ch1/objectives/loc3/verify-location",
      seed.tokenU1,
      { readings: nearReadings() }
    );
    expect(res.status).toBe(403);
    const parsed = errorSchema.safeParse(await res.json());
    if (parsed.success) {
      expect(parsed.data.code).toBe("OBJECTIVE_LOCKED");
    } else {
      expect.unreachable();
    }
  });

  it("blocks verification while the event is paused", async () => {
    const seed = await seedWorld("paused");
    const res = await postJson(
      seed.db,
      "/api/challenges/ch1/objectives/loc1/verify-location",
      seed.tokenU1,
      { readings: nearReadings() }
    );
    expect(res.status).toBe(409);
    const parsed = errorSchema.safeParse(await res.json());
    if (parsed.success) {
      expect(parsed.data.code).toBe("EVENT_PAUSED");
    } else {
      expect.unreachable();
    }
  });

  it("blocks verification on challenge-locked challenges", async () => {
    const seed = await seedWorld("live");
    const res = await postJson(
      seed.db,
      "/api/challenges/ch3/objectives/loc9/verify-location",
      seed.tokenU1,
      { readings: nearReadings() }
    );
    expect(res.status).toBe(403);
    const parsed = errorSchema.safeParse(await res.json());
    if (parsed.success) {
      expect(parsed.data.code).toBe("OBJECTIVE_LOCKED");
    } else {
      expect.unreachable();
    }
  });

  it("blocks location sessions on challenge-locked challenges", async () => {
    const seed = await seedWorld("live");
    const res = await postJson(seed.db, "/api/challenges/ch3/objectives/loc9/location-session", seed.tokenU1, {});
    expect(res.status).toBe(403);
    const parsed = errorSchema.safeParse(await res.json());
    if (parsed.success) {
      expect(parsed.data.code).toBe("OBJECTIVE_LOCKED");
    } else {
      expect.unreachable();
    }
  });

  it("omits hidden-locked challenges from location endpoints", async () => {
    const seed = await seedWorld("live");
    const verified = await postJson(
      seed.db,
      "/api/challenges/ch4/objectives/locH/verify-location",
      seed.tokenU1,
      { readings: nearReadings() }
    );
    expect(verified.status).toBe(404);
    const session = await postJson(seed.db, "/api/challenges/ch4/objectives/locH/location-session", seed.tokenU1, {});
    expect(session.status).toBe(404);
  });
});
