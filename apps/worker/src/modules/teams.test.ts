/** Tests for team creation, invites, requests, approval, and penalties. */

import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { DatabaseBinding, Env, PreparedStatementBinding } from "../env";
import app from "../index";
import { sha256Hex } from "../lib/crypto";

interface FakeRow {
  [key: string]: unknown;
}

interface FakeTables {
  users: Array<FakeRow>;
  sessions: Array<FakeRow>;
  events: Array<FakeRow>;
  participants: Array<FakeRow>;
  participantMembers: Array<FakeRow>;
  teamInvites: Array<FakeRow>;
  objectiveProgress: Array<FakeRow>;
}

interface SeedInput {
  users?: Array<FakeRow>;
  sessions?: Array<FakeRow>;
  events?: Array<FakeRow>;
  participants?: Array<FakeRow>;
  members?: Array<FakeRow>;
  invites?: Array<FakeRow>;
  progress?: Array<FakeRow>;
}

function okResult(changes: number): unknown {
  return { success: true, meta: { changes } };
}

function isActiveMember(row: FakeRow): boolean {
  return row["left_at"] === null || row["left_at"] === undefined;
}

function handleAll(
  tables: FakeTables,
  sql: string,
  values: Array<unknown>
): Array<FakeRow> {
  if (sql.includes("FROM sessions")) {
    return tables.sessions.filter((row) => row["token_hash"] === values[0]);
  }
  if (sql.includes("INNER JOIN users")) {
    const participantId = values[0];
    return tables.participantMembers
      .filter(
        (row) =>
          row["participant_id"] === participantId && isActiveMember(row)
      )
      .sort((left, right) =>
        String(left["joined_at"]) < String(right["joined_at"]) ? -1 : 1
      )
      .map((row) => {
        const user = tables.users.find(
          (entry) => entry["id"] === row["user_id"]
        );
        return {
          ...row,
          username: user === undefined ? "unknown" : user["username"]
        };
      });
  }
  if (sql.includes("COUNT(*)")) {
    const participantId = values[0];
    const count = tables.participantMembers.filter(
      (row) => row["participant_id"] === participantId && isActiveMember(row)
    ).length;
    return [{ count }];
  }
  if (sql.includes("participant_members AS m")) {
    const userId = values[0];
    const eventId = values[1];
    const eventParticipantIds = new Set<unknown>(
      tables.participants
        .filter((row) => row["event_id"] === eventId)
        .map((row) => row["id"])
    );
    const rows = tables.participantMembers.filter(
      (row) =>
        row["user_id"] === userId &&
        eventParticipantIds.has(row["participant_id"])
    );
    if (sql.includes("AND m.left_at IS NULL")) {
      return rows.filter(isActiveMember);
    }
    return rows;
  }
  if (
    sql.includes("FROM participant_members WHERE participant_id = ? AND user_id = ?")
  ) {
    return tables.participantMembers.filter(
      (row) =>
        row["participant_id"] === values[0] &&
        row["user_id"] === values[1] &&
        isActiveMember(row)
    );
  }
  if (sql.includes("FROM participant_members WHERE participant_id = ?")) {
    return tables.participantMembers.filter(
      (row) => row["participant_id"] === values[0]
    );
  }
  if (sql.includes("FROM users WHERE id = ?")) {
    return tables.users.filter((row) => row["id"] === values[0]);
  }
  if (sql.includes("FROM events WHERE id = ?")) {
    return tables.events.filter((row) => row["id"] === values[0]);
  }
  if (sql.includes("FROM participants WHERE id = ?")) {
    return tables.participants.filter((row) => row["id"] === values[0]);
  }
  if (sql.includes("COLLATE NOCASE")) {
    const eventId = values[0];
    const name = values[1];
    return tables.participants.filter((row) => {
      if (row["event_id"] !== eventId || row["type"] !== "team") {
        return false;
      }
      const existing = row["name"];
      if (typeof existing !== "string" || typeof name !== "string") {
        return false;
      }
      return existing.toLowerCase() === name.toLowerCase();
    });
  }
  if (sql.includes("FROM team_invites WHERE token_hash = ?")) {
    return tables.teamInvites.filter((row) => row["token_hash"] === values[0]);
  }
  if (sql.includes("FROM team_invites WHERE id = ?")) {
    return tables.teamInvites.filter((row) => row["id"] === values[0]);
  }
  if (sql.includes("requested_user_id = ?")) {
    return tables.teamInvites.filter(
      (row) =>
        row["participant_id"] === values[0] &&
        row["requested_user_id"] === values[1] &&
        row["status"] === "pending"
    );
  }
  if (sql.includes("FROM objective_progress")) {
    const participantId = values[0];
    return tables.objectiveProgress
      .filter(
        (row) =>
          row["participant_id"] === participantId &&
          row["status"] === "completed" &&
          typeof row["completed_at"] === "string"
      )
      .sort((left, right) =>
        String(left["completed_at"]) < String(right["completed_at"]) ? -1 : 1
      );
  }
  return [];
}

function handleRun(
  tables: FakeTables,
  sql: string,
  values: Array<unknown>
): unknown {
  if (sql.startsWith("INSERT INTO participants")) {
    tables.participants.push({
      id: values[0],
      event_id: values[1],
      type: values[2],
      name: values[3],
      event_points: values[4],
      penalty_seconds: values[5],
      started_at: values[6],
      completed_at: values[7],
      created_at: values[8],
      updated_at: values[9]
    });
    return okResult(1);
  }
  if (sql.startsWith("INSERT INTO participant_members")) {
    if (sql.includes("SELECT")) {
      const participantId = values[1];
      const maxSize = values[7];
      const active = tables.participantMembers.filter(
        (row) => row["participant_id"] === participantId && isActiveMember(row)
      );
      const alreadyMember = active.some(
        (row) => row["user_id"] === values[8]
      );
      const invite = tables.teamInvites.find(
        (row) => row["id"] === values[10] && row["status"] === "pending"
      );
      const capacity = typeof maxSize === "number" ? maxSize : 5;
      if (
        active.length < capacity &&
        alreadyMember === false &&
        invite !== undefined
      ) {
        tables.participantMembers.push({
          id: values[0],
          participant_id: values[1],
          user_id: values[2],
          role: values[3],
          joined_at: values[4],
          left_at: values[5] ?? null
        });
        return okResult(1);
      }
      return okResult(0);
    }
    tables.participantMembers.push({
      id: values[0],
      participant_id: values[1],
      user_id: values[2],
      role: values[3],
      joined_at: values[4],
      left_at: values[5] ?? null
    });
    return okResult(1);
  }
  if (sql.startsWith("INSERT INTO team_invites")) {
    tables.teamInvites.push({
      id: values[0],
      participant_id: values[1],
      invited_by: values[2],
      token_hash: values[3],
      requested_user_id: values[4],
      status: "pending",
      expires_at: values[5],
      created_at: values[6],
      updated_at: values[7]
    });
    return okResult(1);
  }
  if (sql.startsWith("UPDATE team_invites SET status")) {
    const row = tables.teamInvites.find((entry) => entry["id"] === values[2]);
    if (row === undefined || row["status"] !== "pending") {
      return okResult(0);
    }
    if (sql.includes("EXISTS (SELECT 1 FROM participant_members WHERE id = ?)")) {
      const member = tables.participantMembers.find(
        (entry) => entry["id"] === values[3]
      );
      if (member === undefined) {
        return okResult(0);
      }
    }
    row["status"] = values[0];
    row["updated_at"] = values[1];
    return okResult(1);
  }
  if (sql.startsWith("UPDATE participants SET penalty_seconds")) {
    const row = tables.participants.find(
      (entry) => entry["id"] === values[2]
    );
    if (row === undefined) {
      return okResult(0);
    }
    if (sql.includes("EXISTS (SELECT 1 FROM participant_members WHERE id = ?)")) {
      const member = tables.participantMembers.find(
        (entry) => entry["id"] === values[3]
      );
      if (member === undefined) {
        return okResult(0);
      }
    }
    const current = row["penalty_seconds"];
    const add = values[0];
    row["penalty_seconds"] =
      (typeof current === "number" ? current : 0) +
      (typeof add === "number" ? add : 0);
    row["updated_at"] = values[1];
    return okResult(1);
  }
  if (sql.startsWith("UPDATE participant_members SET left_at")) {
    const row = tables.participantMembers.find(
      (entry) => entry["id"] === values[1]
    );
    if (row === undefined || isActiveMember(row) === false) {
      return okResult(0);
    }
    row["left_at"] = values[0];
    return okResult(1);
  }
  if (sql.startsWith("UPDATE participant_members SET role")) {
    const row = tables.participantMembers.find(
      (entry) => entry["id"] === values[1]
    );
    if (row === undefined) {
      return okResult(0);
    }
    row["role"] = values[0];
    return okResult(1);
  }
  return okResult(0);
}

function createFakeDb(seed: SeedInput = {}): {
  db: DatabaseBinding;
  tables: FakeTables;
} {
  const tables: FakeTables = {
    users: [...(seed.users ?? [])],
    sessions: [...(seed.sessions ?? [])],
    events: [...(seed.events ?? [])],
    participants: [...(seed.participants ?? [])],
    participantMembers: [...(seed.members ?? [])],
    teamInvites: [...(seed.invites ?? [])],
    objectiveProgress: [...(seed.progress ?? [])]
  };
  const seen = new WeakMap<object, { sql: string; values: Array<unknown> }>();
  const db: DatabaseBinding = {
    prepare: (sql: string): PreparedStatementBinding => {
      const make = (values: Array<unknown>): PreparedStatementBinding => {
        const statement: PreparedStatementBinding = {
          bind: (...next: Array<unknown>) => make(next),
          first: () => {
            const rows = handleAll(tables, sql, values);
            const firstRow = rows[0];
            return Promise.resolve(firstRow === undefined ? null : firstRow);
          },
          all: () => Promise.resolve(handleAll(tables, sql, values)),
          run: () => Promise.resolve(handleRun(tables, sql, values))
        };
        seen.set(statement, { sql, values });
        return statement;
      };
      return make([]);
    },
    batch: (statements: Array<PreparedStatementBinding>) => {
      const results: Array<unknown> = [];
      for (const statement of statements) {
        const meta = seen.get(statement);
        if (meta === undefined) {
          results.push(okResult(0));
        } else {
          results.push(handleRun(tables, meta.sql, meta.values));
        }
      }
      return Promise.resolve(results);
    },
    exec: (_query: string) => Promise.resolve({ success: true })
  };
  return { db, tables };
}

function testEnv(db: DatabaseBinding): Env {
  return {
    DB: db,
    MEDIA: {
      get: (_key: string) => Promise.resolve(null),
      put: (_key: string, _value: ReadableStream | ArrayBuffer | string) =>
        Promise.resolve({ success: true }),
      delete: (_key: string) => Promise.resolve()
    },
    ADMIN_EMAILS: ""
  };
}

function makeUser(id: string, username: string, verified = 1): FakeRow {
  const now = "2026-01-01T00:00:00.000Z";
  return {
    id,
    auth_provider_id: `auth-${id}`,
    email: `${username}@example.com`,
    email_verified: verified,
    username,
    display_name: null,
    platform_credits: 0,
    presence_visibility: "visible",
    created_at: now,
    updated_at: now
  };
}

async function makeSession(token: string, userId: string): Promise<FakeRow> {
  return {
    id: `sess-${userId}`,
    user_id: userId,
    token_hash: await sha256Hex(token),
    device_label: null,
    ip_hash: null,
    created_at: "2026-01-01T00:00:00.000Z",
    last_seen_at: "2026-09-04T00:00:00.000Z",
    expires_at: "2027-01-01T00:00:00.000Z",
    revoked_at: null
  };
}

function makeEvent(id: string): FakeRow {
  const now = "2026-01-01T00:00:00.000Z";
  return {
    id,
    name: "Mystery Night",
    slug: id,
    description: null,
    status: "live",
    starts_at: null,
    ends_at: null,
    settings_json: "{}",
    created_by: "admin",
    created_at: now,
    updated_at: now
  };
}

async function setupDb(
  users: Array<{ id: string; username: string; verified?: number }>
): Promise<{ env: Env; tables: FakeTables; tokens: Map<string, string> }> {
  const userRows = users.map((user) =>
    makeUser(user.id, user.username, user.verified ?? 1)
  );
  const sessionRows: Array<FakeRow> = [];
  const tokens = new Map<string, string>();
  for (const user of users) {
    const token = `session-token-${user.id}`;
    tokens.set(user.id, token);
    sessionRows.push(await makeSession(token, user.id));
  }
  const { db, tables } = createFakeDb({
    users: userRows,
    sessions: sessionRows,
    events: [makeEvent("event-1")]
  });
  return { env: testEnv(db), tables, tokens };
}

function tokenFor(tokens: Map<string, string>, userId: string): string {
  const token = tokens.get(userId);
  if (token === undefined) {
    throw new Error(`Missing session token for ${userId}`);
  }
  return token;
}

async function postJson(
  env: Env,
  path: string,
  token: string | null,
  body: unknown
): Promise<{ status: number; json: unknown }> {
  const headers: Record<string, string> = {
    "content-type": "application/json"
  };
  if (token !== null) {
    headers["Cookie"] = `session=${token}`;
  }
  const res = await app.request(
    path,
    { method: "POST", headers, body: JSON.stringify(body) },
    env
  );
  const json: unknown = await res.json().catch(() => null);
  return { status: res.status, json };
}

const envelopeSchema = z.object({
  code: z.string(),
  message: z.string()
});

const teamResponseSchema = z.object({
  participant: z.object({
    id: z.string(),
    eventId: z.string(),
    type: z.string(),
    name: z.string(),
    penaltySeconds: z.number()
  }),
  captain: z.object({
    userId: z.string(),
    username: z.string(),
    role: z.string(),
    joinedAt: z.string()
  })
});

const inviteResponseSchema = z.object({
  invite: z.object({
    id: z.string(),
    participantId: z.string(),
    status: z.string(),
    expiresAt: z.string()
  }),
  token: z.string()
});

const requestResponseSchema = z.object({
  request: z.object({
    id: z.string(),
    participantId: z.string(),
    status: z.string(),
    createdAt: z.string()
  }),
  wouldIncurLateJoinPenalty: z.boolean()
});

const approveResponseSchema = z.object({
  member: z.object({
    userId: z.string(),
    username: z.string(),
    role: z.string(),
    joinedAt: z.string()
  }),
  request: z.object({ id: z.string(), status: z.string() }),
  lateJoinPenaltyApplied: z.boolean(),
  penaltySeconds: z.number()
});

function parseEnvelope(json: unknown): { code: string; message: string } {
  const parsed = envelopeSchema.safeParse(json);
  if (parsed.success === false) {
    throw new Error("Expected an error envelope");
  }
  return parsed.data;
}

describe("team creation", () => {
  it("creates a team with the creator as captain", async () => {
    const { env, tokens } = await setupDb([
      { id: "alice", username: "alice" },
      { id: "bob", username: "bob" }
    ]);
    const res = await postJson(env, "/api/events/event-1/teams", tokenFor(tokens, "alice"), {
      name: "Alpha Squad"
    });
    expect(res.status).toBe(201);
    const parsed = teamResponseSchema.safeParse(res.json);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.participant.type).toBe("team");
      expect(parsed.data.participant.name).toBe("Alpha Squad");
      expect(parsed.data.captain.username).toBe("alice");
      expect(parsed.data.captain.role).toBe("captain");
      expect(JSON.stringify(res.json)).not.toContain("example.com");
    }
  });

  it("rejects duplicate team names per event", async () => {
    const { env, tokens } = await setupDb([
      { id: "alice", username: "alice" },
      { id: "bob", username: "bob" }
    ]);
    const first = await postJson(env, "/api/events/event-1/teams", tokenFor(tokens, "alice"), {
      name: "Alpha Squad"
    });
    expect(first.status).toBe(201);
    const second = await postJson(env, "/api/events/event-1/teams", tokenFor(tokens, "bob"), {
      name: "alpha squad"
    });
    expect(second.status).toBe(409);
    expect(parseEnvelope(second.json).code).toBe("CONFLICT");
  });

  it("validates team names", async () => {
    const { env, tokens } = await setupDb([
      { id: "alice", username: "alice" }
    ]);
    const token = tokenFor(tokens, "alice");
    for (const name of ["ab", " Bad Name", "Bad Name ", "x".repeat(41)]) {
      const res = await postJson(env, "/api/events/event-1/teams", token, {
        name
      });
      expect(res.status).toBe(400);
      expect(parseEnvelope(res.json).code).toBe("VALIDATION_ERROR");
    }
  });

  it("blocks a second active participation in the same event", async () => {
    const { env, tokens } = await setupDb([
      { id: "alice", username: "alice" }
    ]);
    const token = tokenFor(tokens, "alice");
    const first = await postJson(env, "/api/events/event-1/teams", token, {
      name: "Alpha Squad"
    });
    expect(first.status).toBe(201);
    const second = await postJson(env, "/api/events/event-1/teams", token, {
      name: "Beta Crew"
    });
    expect(second.status).toBe(409);
    expect(parseEnvelope(second.json).code).toBe("CONFLICT");
  });

  it("requires a verified email", async () => {
    const { env, tokens } = await setupDb([
      { id: "carol", username: "carol", verified: 0 }
    ]);
    const res = await postJson(env, "/api/events/event-1/teams", tokenFor(tokens, "carol"), {
      name: "Alpha Squad"
    });
    expect(res.status).toBe(403);
    expect(parseEnvelope(res.json).code).toBe("FORBIDDEN");
  });

  it("requires authentication", async () => {
    const { env } = await setupDb([{ id: "alice", username: "alice" }]);
    const res = await postJson(env, "/api/events/event-1/teams", null, {
      name: "Alpha Squad"
    });
    expect(res.status).toBe(401);
    expect(parseEnvelope(res.json).code).toBe("UNAUTHENTICATED");
  });
});

describe("invites, requests, and approvals", () => {
  it("approves a join request without a penalty before the first completion", async () => {
    const { env, tokens } = await setupDb([
      { id: "alice", username: "alice" },
      { id: "bob", username: "bob" }
    ]);
    const created = await postJson(env, "/api/events/event-1/teams", tokenFor(tokens, "alice"), {
      name: "Alpha Squad"
    });
    const team = teamResponseSchema.parse(created.json);
    const invited = await postJson(
      env,
      `/api/participants/${team.participant.id}/invites`,
      tokenFor(tokens, "alice"),
      {}
    );
    expect(invited.status).toBe(201);
    const invite = inviteResponseSchema.parse(invited.json);
    const requested = await postJson(
      env,
      `/api/invites/${invite.token}/request`,
      tokenFor(tokens, "bob"),
      {}
    );
    expect(requested.status).toBe(201);
    const request = requestResponseSchema.parse(requested.json);
    expect(request.wouldIncurLateJoinPenalty).toBe(false);
    const approved = await postJson(
      env,
      `/api/join-requests/${request.request.id}/approve`,
      tokenFor(tokens, "alice"),
      {}
    );
    expect(approved.status).toBe(200);
    const approval = approveResponseSchema.parse(approved.json);
    expect(approval.member.username).toBe("bob");
    expect(approval.lateJoinPenaltyApplied).toBe(false);
    expect(approval.penaltySeconds).toBe(0);
    const repeat = await postJson(
      env,
      `/api/join-requests/${request.request.id}/approve`,
      tokenFor(tokens, "alice"),
      {}
    );
    expect(repeat.status).toBe(409);
    expect(parseEnvelope(repeat.json).code).toBe("CONFLICT");
  });

  it("rejects approval with TEAM_FULL when the team already has five members", async () => {
    const users = [
      { id: "captain", username: "captain" },
      { id: "m2", username: "m2" },
      { id: "m3", username: "m3" },
      { id: "m4", username: "m4" },
      { id: "m5", username: "m5" },
      { id: "late", username: "late" }
    ];
    const { env, tables, tokens } = await setupDb(users);
    tables.participants.push({
      id: "team-full",
      event_id: "event-1",
      type: "team",
      name: "Full House",
      event_points: 0,
      penalty_seconds: 0,
      started_at: null,
      completed_at: null,
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z"
    });
    const memberIds = ["captain", "m2", "m3", "m4", "m5"];
    memberIds.forEach((userId, index) => {
      tables.participantMembers.push({
        id: `member-${userId}`,
        participant_id: "team-full",
        user_id: userId,
        role: index === 0 ? "captain" : "member",
        joined_at: "2026-01-01T00:00:00.000Z",
        left_at: null
      });
    });
    const invited = await postJson(
      env,
      "/api/participants/team-full/invites",
      tokenFor(tokens, "captain"),
      {}
    );
    expect(invited.status).toBe(201);
    const invite = inviteResponseSchema.parse(invited.json);
    const requested = await postJson(
      env,
      `/api/invites/${invite.token}/request`,
      tokenFor(tokens, "late"),
      {}
    );
    expect(requested.status).toBe(201);
    const request = requestResponseSchema.parse(requested.json);
    const approved = await postJson(
      env,
      `/api/join-requests/${request.request.id}/approve`,
      tokenFor(tokens, "captain"),
      {}
    );
    expect(approved.status).toBe(409);
    expect(parseEnvelope(approved.json).code).toBe("TEAM_FULL");
    const retry = await postJson(
      env,
      `/api/join-requests/${request.request.id}/approve`,
      tokenFor(tokens, "captain"),
      {}
    );
    expect(retry.status).toBe(409);
    expect(parseEnvelope(retry.json).code).toBe("TEAM_FULL");
    const lateRows = tables.participantMembers.filter(
      (row) => row["user_id"] === "late"
    );
    expect(lateRows.length).toBe(0);
    const team = tables.participants.find((row) => row["id"] === "team-full");
    expect(team?.["penalty_seconds"]).toBe(0);
  });

  it("applies the late-join penalty only after the first completion", async () => {
    const { env, tables, tokens } = await setupDb([
      { id: "alice", username: "alice" },
      { id: "bob", username: "bob" },
      { id: "carol", username: "carol" }
    ]);
    const created = await postJson(env, "/api/events/event-1/teams", tokenFor(tokens, "alice"), {
      name: "Alpha Squad"
    });
    const team = teamResponseSchema.parse(created.json);
    const invited = await postJson(
      env,
      `/api/participants/${team.participant.id}/invites`,
      tokenFor(tokens, "alice"),
      {}
    );
    const invite = inviteResponseSchema.parse(invited.json);
    const bobRequested = await postJson(
      env,
      `/api/invites/${invite.token}/request`,
      tokenFor(tokens, "bob"),
      {}
    );
    const bobRequest = requestResponseSchema.parse(bobRequested.json);
    const bobApproved = await postJson(
      env,
      `/api/join-requests/${bobRequest.request.id}/approve`,
      tokenFor(tokens, "alice"),
      {}
    );
    const bobApproval = approveResponseSchema.parse(bobApproved.json);
    expect(bobApproval.lateJoinPenaltyApplied).toBe(false);
    expect(bobApproval.penaltySeconds).toBe(0);
    tables.objectiveProgress.push({
      id: "progress-1",
      participant_id: team.participant.id,
      challenge_id: "challenge-1",
      objective_key: "puzzle-1",
      status: "completed",
      completed_by: "alice",
      completed_at: "2026-09-04T12:00:00.000Z",
      data_json: null,
      idempotency_key: null,
      created_at: "2026-09-04T12:00:00.000Z",
      updated_at: "2026-09-04T12:00:00.000Z"
    });
    const carolRequested = await postJson(
      env,
      `/api/invites/${invite.token}/request`,
      tokenFor(tokens, "carol"),
      {}
    );
    const carolRequest = requestResponseSchema.parse(carolRequested.json);
    expect(carolRequest.wouldIncurLateJoinPenalty).toBe(true);
    const carolApproved = await postJson(
      env,
      `/api/join-requests/${carolRequest.request.id}/approve`,
      tokenFor(tokens, "alice"),
      {}
    );
    expect(carolApproved.status).toBe(200);
    const carolApproval = approveResponseSchema.parse(carolApproved.json);
    expect(carolApproval.lateJoinPenaltyApplied).toBe(true);
    expect(carolApproval.penaltySeconds).toBe(300);
  });

  it("rejects a request without creating membership or penalty rows", async () => {
    const { env, tables, tokens } = await setupDb([
      { id: "alice", username: "alice" },
      { id: "bob", username: "bob" }
    ]);
    const created = await postJson(env, "/api/events/event-1/teams", tokenFor(tokens, "alice"), {
      name: "Alpha Squad"
    });
    const team = teamResponseSchema.parse(created.json);
    const invited = await postJson(
      env,
      `/api/participants/${team.participant.id}/invites`,
      tokenFor(tokens, "alice"),
      {}
    );
    const invite = inviteResponseSchema.parse(invited.json);
    const requested = await postJson(
      env,
      `/api/invites/${invite.token}/request`,
      tokenFor(tokens, "bob"),
      {}
    );
    const request = requestResponseSchema.parse(requested.json);
    const rejected = await postJson(
      env,
      `/api/join-requests/${request.request.id}/reject`,
      tokenFor(tokens, "alice"),
      {}
    );
    expect(rejected.status).toBe(200);
    const members = tables.participantMembers.filter(
      (row) =>
        row["participant_id"] === team.participant.id &&
        row["user_id"] === "bob"
    );
    expect(members.length).toBe(0);
    const teamRow = tables.participants.find(
      (row) => row["id"] === team.participant.id
    );
    expect(teamRow?.["penalty_seconds"]).toBe(0);
  });
});
