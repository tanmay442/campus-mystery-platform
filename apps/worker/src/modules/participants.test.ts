/** Tests for leaving, captain transfer, permissions, cooldowns, solo entries. */

import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { DatabaseBinding, Env, PreparedStatementBinding } from "../env";
import app from "../index";
import { sha256Hex } from "../lib/crypto";
import { nowIso } from "../lib/time";
import { ensureSoloParticipant } from "./participants";

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
          all: () =>
            Promise.resolve({
              results: handleAll(tables, sql, values)
            }),
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

function makeUser(id: string, username: string): FakeRow {
  const now = "2026-01-01T00:00:00.000Z";
  return {
    id,
    auth_provider_id: `auth-${id}`,
    email: `${username}@example.com`,
    email_verified: 1,
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

function makeMember(
  id: string,
  participantId: string,
  userId: string,
  role: string,
  joinedAt: string,
  leftAt: string | null = null
): FakeRow {
  return {
    id,
    participant_id: participantId,
    user_id: userId,
    role,
    joined_at: joinedAt,
    left_at: leftAt
  };
}

function makeTeam(id: string, name: string): FakeRow {
  const now = "2026-01-01T00:00:00.000Z";
  return {
    id,
    event_id: "event-1",
    type: "team",
    name,
    event_points: 42,
    penalty_seconds: 0,
    started_at: now,
    completed_at: null,
    created_at: now,
    updated_at: now
  };
}

async function setupTeamDb(
  userIds: Array<{ id: string; username: string }>,
  members: Array<{
    userId: string;
    role: string;
    joinedAt: string;
    leftAt?: string | null;
  }>,
  teamId = "team-1"
): Promise<{ env: Env; tables: FakeTables; tokens: Map<string, string> }> {
  const userRows = userIds.map((user) => makeUser(user.id, user.username));
  const sessionRows: Array<FakeRow> = [];
  const tokens = new Map<string, string>();
  for (const user of userIds) {
    const token = `session-token-${user.id}`;
    tokens.set(user.id, token);
    sessionRows.push(await makeSession(token, user.id));
  }
  const memberRows = members.map((member, index) =>
    makeMember(
      `membership-${index}`,
      teamId,
      member.userId,
      member.role,
      member.joinedAt,
      member.leftAt ?? null
    )
  );
  const { db, tables } = createFakeDb({
    users: userRows,
    sessions: sessionRows,
    events: [makeEvent("event-1")],
    participants: [makeTeam(teamId, "Alpha Squad")],
    members: memberRows
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

const leaveResponseSchema = z.object({
  left: z.boolean(),
  participantId: z.string(),
  captainTransferredTo: z.string().nullable()
});

const transferResponseSchema = z.object({
  captain: z.object({ userId: z.string(), username: z.string() }),
  previousCaptain: z.object({ userId: z.string(), username: z.string() }),
  permissions: z
    .object({
      userId: z.string(),
      username: z.string(),
      manageMembers: z.boolean()
    })
    .nullable()
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

describe("leaving a team", () => {
  it("transfers captaincy to the longest-serving member and keeps progress", async () => {
    const users = [
      { id: "alice", username: "alice" },
      { id: "bob", username: "bob" },
      { id: "carol", username: "carol" }
    ];
    const { env, tables, tokens } = await setupTeamDb(users, [
      { userId: "alice", role: "captain", joinedAt: "2026-01-01T00:00:00.000Z" },
      { userId: "bob", role: "member", joinedAt: "2026-02-01T00:00:00.000Z" },
      { userId: "carol", role: "member", joinedAt: "2026-03-01T00:00:00.000Z" }
    ]);
    const res = await postJson(
      env,
      "/api/participants/team-1/leave",
      tokenFor(tokens, "alice"),
      {}
    );
    expect(res.status).toBe(200);
    const parsed = leaveResponseSchema.safeParse(res.json);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.left).toBe(true);
      expect(parsed.data.captainTransferredTo).toBe("bob");
    }
    const team = tables.participants.find((row) => row["id"] === "team-1");
    expect(team?.["event_points"]).toBe(42);
    const aliceRows = tables.participantMembers.filter(
      (row) => row["user_id"] === "alice"
    );
    expect(aliceRows.length).toBe(1);
    expect(aliceRows[0]?.["left_at"]).not.toBeNull();
    const bobRow = tables.participantMembers.find(
      (row) => row["user_id"] === "bob"
    );
    expect(bobRow?.["role"]).toBe("captain");
    const transfer = await postJson(
      env,
      "/api/participants/team-1/transfer-captain",
      tokenFor(tokens, "bob"),
      { newCaptainUserId: "carol" }
    );
    expect(transfer.status).toBe(200);
    const transferParsed = transferResponseSchema.parse(transfer.json);
    expect(transferParsed.captain.username).toBe("carol");
  });

  it("blocks an immediate rejoin with a membership cooldown", async () => {
    const users = [
      { id: "alice", username: "alice" },
      { id: "bob", username: "bob" }
    ];
    const { env, tables, tokens } = await setupTeamDb(users, [
      { userId: "alice", role: "captain", joinedAt: "2026-01-01T00:00:00.000Z" },
      { userId: "bob", role: "member", joinedAt: "2026-01-01T00:00:00.000Z" }
    ]);
    const rawToken = "rejoin-invite-token";
    tables.teamInvites.push({
      id: "invite-1",
      participant_id: "team-1",
      invited_by: "bob",
      token_hash: await sha256Hex(rawToken),
      requested_user_id: null,
      status: "pending",
      expires_at: "2027-01-01T00:00:00.000Z",
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z"
    });
    const left = await postJson(
      env,
      "/api/participants/team-1/leave",
      tokenFor(tokens, "alice"),
      {}
    );
    expect(left.status).toBe(200);
    const rejoin = await postJson(
      env,
      `/api/invites/${rawToken}/request`,
      tokenFor(tokens, "alice"),
      {}
    );
    expect(rejoin.status).toBe(429);
    expect(parseEnvelope(rejoin.json).code).toBe("MEMBERSHIP_COOLDOWN");
  });

  it("rejects leave from users without an active membership", async () => {
    const users = [
      { id: "alice", username: "alice" },
      { id: "stranger", username: "stranger" }
    ];
    const { env, tokens } = await setupTeamDb(users, [
      { userId: "alice", role: "captain", joinedAt: "2026-01-01T00:00:00.000Z" }
    ]);
    const res = await postJson(
      env,
      "/api/participants/team-1/leave",
      tokenFor(tokens, "stranger"),
      {}
    );
    expect(res.status).toBe(403);
    expect(parseEnvelope(res.json).code).toBe("FORBIDDEN");
  });
});

describe("captain transfer and permissions", () => {
  it("lets the new captain act and supports grant plus revoke of manage_members", async () => {
    const users = [
      { id: "alice", username: "alice" },
      { id: "bob", username: "bob" },
      { id: "carol", username: "carol" },
      { id: "dave", username: "dave" }
    ];
    const { env, tokens } = await setupTeamDb(users, [
      { userId: "alice", role: "captain", joinedAt: "2026-01-01T00:00:00.000Z" },
      { userId: "bob", role: "member", joinedAt: "2026-02-01T00:00:00.000Z" },
      { userId: "carol", role: "member", joinedAt: "2026-03-01T00:00:00.000Z" }
    ]);
    const denied = await postJson(
      env,
      "/api/participants/team-1/transfer-captain",
      tokenFor(tokens, "bob"),
      { newCaptainUserId: "carol" }
    );
    expect(denied.status).toBe(403);
    const ghost = await postJson(
      env,
      "/api/participants/team-1/transfer-captain",
      tokenFor(tokens, "alice"),
      { newCaptainUserId: "ghost" }
    );
    expect(ghost.status).toBe(404);
    const granted = await postJson(
      env,
      "/api/participants/team-1/transfer-captain",
      tokenFor(tokens, "alice"),
      {
        newCaptainUserId: "bob",
        setManageMembers: { userId: "carol", grant: true }
      }
    );
    expect(granted.status).toBe(200);
    const grantParsed = transferResponseSchema.parse(granted.json);
    expect(grantParsed.captain.username).toBe("bob");
    expect(grantParsed.permissions?.manageMembers).toBe(true);
    const carolInvite = await postJson(
      env,
      "/api/participants/team-1/invites",
      tokenFor(tokens, "carol"),
      {}
    );
    expect(carolInvite.status).toBe(201);
    const invite = inviteResponseSchema.parse(carolInvite.json);
    const daveRequested = await postJson(
      env,
      `/api/invites/${invite.token}/request`,
      tokenFor(tokens, "dave"),
      {}
    );
    expect(daveRequested.status).toBe(201);
    const daveRequestId = z
      .object({ request: z.object({ id: z.string() }) })
      .parse(daveRequested.json).request.id;
    const daveApproved = await postJson(
      env,
      `/api/join-requests/${daveRequestId}/approve`,
      tokenFor(tokens, "carol"),
      {}
    );
    expect(daveApproved.status).toBe(200);
    expect(approveResponseSchema.parse(daveApproved.json).member.username).toBe(
      "dave"
    );
    const revoked = await postJson(
      env,
      "/api/participants/team-1/transfer-captain",
      tokenFor(tokens, "bob"),
      {
        newCaptainUserId: "dave",
        setManageMembers: { userId: "carol", grant: false }
      }
    );
    expect(revoked.status).toBe(200);
    const afterRevoke = await postJson(
      env,
      "/api/participants/team-1/invites",
      tokenFor(tokens, "carol"),
      {}
    );
    expect(afterRevoke.status).toBe(403);
  });
});

describe("membership rate limits", () => {
  it("blocks approval after five membership changes in ten minutes", async () => {
    const users = [
      { id: "alice", username: "alice" },
      { id: "bob", username: "bob" },
      { id: "carol", username: "carol" },
      { id: "gone", username: "gone" }
    ];
    const recent = nowIso();
    const { env, tables, tokens } = await setupTeamDb(users, [
      { userId: "alice", role: "captain", joinedAt: "2026-01-01T00:00:00.000Z" },
      { userId: "bob", role: "member", joinedAt: recent },
      { userId: "gone", role: "member", joinedAt: recent, leftAt: recent }
    ]);
    tables.participantMembers.push(
      makeMember("membership-extra", "team-1", "gone", "member", recent, recent)
    );
    const rawToken = "capped-invite-token";
    tables.teamInvites.push({
      id: "invite-capped",
      participant_id: "team-1",
      invited_by: "alice",
      token_hash: await sha256Hex(rawToken),
      requested_user_id: null,
      status: "pending",
      expires_at: "2027-01-01T00:00:00.000Z",
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z"
    });
    const requested = await postJson(
      env,
      `/api/invites/${rawToken}/request`,
      tokenFor(tokens, "carol"),
      {}
    );
    expect(requested.status).toBe(201);
    const requestId = z
      .object({ request: z.object({ id: z.string() }) })
      .parse(requested.json).request.id;
    const approved = await postJson(
      env,
      `/api/join-requests/${requestId}/approve`,
      tokenFor(tokens, "alice"),
      {}
    );
    expect(approved.status).toBe(429);
    expect(parseEnvelope(approved.json).code).toBe("MEMBERSHIP_COOLDOWN");
  });
});

describe("solo entries", () => {
  it("creates a zero-progress solo entry lazily and reuses it", async () => {
    const { db, tables } = createFakeDb({
      users: [makeUser("solo", "solo-user")],
      sessions: [await makeSession("session-token-solo", "solo")],
      events: [makeEvent("event-1")]
    });
    const now = nowIso();
    const first = await ensureSoloParticipant(
      db,
      "event-1",
      "solo",
      "solo-user",
      now
    );
    if (first.ok === false) {
      throw new Error("Expected solo creation to succeed");
    }
    expect(first.created).toBe(true);
    const row = tables.participants.find(
      (entry) => entry["id"] === first.participantId
    );
    expect(row?.["type"]).toBe("solo");
    expect(row?.["event_points"]).toBe(0);
    expect(row?.["penalty_seconds"]).toBe(0);
    const second = await ensureSoloParticipant(
      db,
      "event-1",
      "solo",
      "solo-user",
      now
    );
    expect(second).toEqual({
      ok: true,
      participantId: first.participantId,
      created: false
    });
    const missing = await ensureSoloParticipant(
      db,
      "no-such-event",
      "solo",
      "solo-user",
      now
    );
    expect(missing.ok).toBe(false);
  });
});

describe("departure lifecycle gates", () => {
  it("blocks leaving once the event is completed", async () => {
    const { env, tables, tokens } = await setupTeamDb(
      [
        { id: "alice", username: "alice" },
        { id: "bob", username: "bob" }
      ],
      [
        { userId: "alice", role: "captain", joinedAt: "2026-01-01T00:00:00.000Z" },
        { userId: "bob", role: "member", joinedAt: "2026-02-01T00:00:00.000Z" }
      ]
    );
    const event = tables.events.find((row) => row["id"] === "event-1");
    if (event === undefined) {
      expect.unreachable();
      return;
    }
    event["status"] = "completed";
    const res = await postJson(env, "/api/participants/team-1/leave", tokenFor(tokens, "bob"), {});
    expect(res.status).toBe(409);
    const parsed = envelopeSchema.safeParse(res.json);
    if (parsed.success) {
      expect(parsed.data.code).toBe("EVENT_NOT_LIVE");
    } else {
      expect.unreachable();
    }
  });
});

describe("service token scope map", () => {
  it("maps admin routes to the documented scopes", async () => {
    const { scopeForAdminRequest } = await import("../middleware/requireAdmin");
    expect(scopeForAdminRequest("GET", "/api/admin/audit")).toBe("events:read");
    expect(scopeForAdminRequest("POST", "/api/admin/events")).toBe("events:write");
    expect(scopeForAdminRequest("POST", "/api/admin/events/e/publish")).toBe("events:write");
    expect(scopeForAdminRequest("POST", "/api/admin/events/e/challenges")).toBe("challenges:write");
    expect(scopeForAdminRequest("PATCH", "/api/admin/challenges/c")).toBe("challenges:write");
    expect(scopeForAdminRequest("POST", "/api/admin/objectives/k/reversal")).toBe(
      "participants:moderate"
    );
    expect(scopeForAdminRequest("POST", "/api/admin/participants/p/penalties")).toBe(
      "participants:moderate"
    );
    expect(scopeForAdminRequest("POST", "/api/admin/penalties/x/waive")).toBe(
      "participants:moderate"
    );
    expect(scopeForAdminRequest("POST", "/api/admin/service-tokens")).toBeNull();
  });
});
