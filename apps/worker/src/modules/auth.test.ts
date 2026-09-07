/** Auth login exchange, session cookies, device eviction, logout, and Clerk JWT tests. */
import { Hono } from "hono";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import type {
  AppEnv,
  DatabaseBinding,
  Env,
  PreparedStatementBinding,
} from "../env";
import app from "../index";
import { sha256Hex } from "../lib/crypto";
import { authMiddleware } from "../middleware/auth";
import { ClerkProvider, createAuthRouter } from "./auth";
import type { AuthProvider, VerifiedIdentity } from "./auth";

type Row = Record<string, unknown>;

class FakeStatement implements PreparedStatementBinding {
  constructor(
    private readonly query: string,
    private readonly db: FakeDb,
    private readonly params: Array<unknown> = [],
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
  users: Array<Row> = [];
  sessions: Array<Row> = [];
  private sequence = 0;

  prepare(query: string): PreparedStatementBinding {
    return new FakeStatement(query, this);
  }

  async batch(
    statements: Array<PreparedStatementBinding>,
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

  handleFirst(query: string, params: Array<unknown>): Promise<Row | null> {
    if (query.includes("FROM sessions") && query.includes("JOIN users")) {
      const tokenHash = params[0];
      if (typeof tokenHash !== "string") {
        return Promise.resolve(null);
      }
      const session = this.sessions.find(
        (row) => row["token_hash"] === tokenHash,
      );
      if (session === undefined) {
        return Promise.resolve(null);
      }
      const user = this.users.find((row) => row["id"] === session["user_id"]);
      if (user === undefined) {
        return Promise.resolve(null);
      }
      return Promise.resolve({
        session_id: session["id"],
        revoked_at: session["revoked_at"] ?? null,
        expires_at: session["expires_at"] ?? "",
        user_id: user["id"],
        user_email: user["email"],
        user_email_verified: user["email_verified"],
        user_username: user["username"],
      });
    }
    if (query.includes("FROM users WHERE auth_provider_id")) {
      const providerId = params[0];
      if (typeof providerId !== "string") {
        return Promise.resolve(null);
      }
      const found = this.users.find(
        (row) => row["auth_provider_id"] === providerId,
      );
      return Promise.resolve(found ?? null);
    }
    if (
      query.includes("FROM users WHERE username") &&
      query.includes("id !=")
    ) {
      const username = params[0];
      const otherId = params[1];
      if (typeof username !== "string" || typeof otherId !== "string") {
        return Promise.resolve(null);
      }
      const found = this.users.find(
        (row) => row["username"] === username && row["id"] !== otherId,
      );
      return Promise.resolve(
        found === undefined ? null : { id: found["id"] },
      );
    }
    if (query.includes("FROM users WHERE username")) {
      const username = params[0];
      if (typeof username !== "string") {
        return Promise.resolve(null);
      }
      const found = this.users.find((row) => row["username"] === username);
      return Promise.resolve(
        found === undefined ? null : { id: found["id"] },
      );
    }
    if (query.includes("FROM users WHERE id")) {
      const id = params[0];
      if (typeof id !== "string") {
        return Promise.resolve(null);
      }
      const found = this.users.find((row) => row["id"] === id);
      return Promise.resolve(found ?? null);
    }
    throw new Error(`unsupported first query: ${query}`);
  }

  handleAll(query: string, params: Array<unknown>): Promise<Array<Row>> {
    if (query.includes("FROM sessions WHERE user_id")) {
      const userId = params[0];
      if (typeof userId !== "string") {
        return Promise.resolve([]);
      }
      const rows = this.sessions
        .filter(
          (row) => row["user_id"] === userId && row["revoked_at"] === null,
        )
        .sort((left, right) => {
          const leftCreated = left["created_at"];
          const rightCreated = right["created_at"];
          if (
            typeof leftCreated === "string" &&
            typeof rightCreated === "string" &&
            leftCreated !== rightCreated
          ) {
            return leftCreated < rightCreated ? -1 : 1;
          }
          const leftSeq = left["sequence"];
          const rightSeq = right["sequence"];
          if (typeof leftSeq === "number" && typeof rightSeq === "number") {
            return leftSeq - rightSeq;
          }
          return 0;
        })
        .map((row) => ({
          id: row["id"] ?? "",
          device_label: row["device_label"] ?? null,
          created_at: row["created_at"] ?? "",
          expires_at: row["expires_at"] ?? "",
        }));
      return Promise.resolve(rows);
    }
    throw new Error(`unsupported all query: ${query}`);
  }

  handleRun(query: string, params: Array<unknown>): Promise<unknown> {
    if (query.startsWith("INSERT INTO users")) {
      const id = params[0];
      const providerId = params[1];
      const username = params[4];
      if (
        typeof id !== "string" ||
        typeof providerId !== "string" ||
        typeof username !== "string"
      ) {
        throw new Error("invalid user insert");
      }
      if (
        this.users.some(
          (row) =>
            row["username"] === username ||
            row["auth_provider_id"] === providerId,
        )
      ) {
        throw new Error("UNIQUE constraint failed: users.username");
      }
      this.users.push({
        id: params[0],
        auth_provider_id: params[1],
        email: params[2],
        email_verified: params[3],
        username: params[4],
        display_name: params[5],
        platform_credits: params[6],
        presence_visibility: params[7],
        created_at: params[8],
        updated_at: params[9],
      });
      return Promise.resolve({ success: true });
    }
    if (query.startsWith("INSERT INTO sessions")) {
      const tokenHash = params[2];
      if (typeof tokenHash !== "string") {
        throw new Error("invalid session insert");
      }
      if (this.sessions.some((row) => row["token_hash"] === tokenHash)) {
        throw new Error("UNIQUE constraint failed: sessions.token_hash");
      }
      this.sequence += 1;
      this.sessions.push({
        id: params[0],
        user_id: params[1],
        token_hash: params[2],
        device_label: params[3],
        ip_hash: params[4],
        created_at: params[5],
        last_seen_at: params[6],
        expires_at: params[7],
        revoked_at: null,
        sequence: this.sequence,
      });
      return Promise.resolve({ success: true });
    }
    if (query.startsWith("UPDATE users SET")) {
      const setStart = query.indexOf("SET ");
      const whereStart = query.indexOf(" WHERE ");
      if (setStart < 0 || whereStart < 0) {
        throw new Error("invalid user update");
      }
      const setPart = query.slice(setStart + 4, whereStart);
      const assignments = setPart.split(",");
      const idValue = params[params.length - 1];
      if (typeof idValue !== "string") {
        throw new Error("invalid user update");
      }
      const row = this.users.find((entry) => entry["id"] === idValue);
      if (row === undefined) {
        return Promise.resolve({ success: true });
      }
      for (let index = 0; index < assignments.length; index += 1) {
        const assignment = assignments[index];
        if (assignment === undefined) {
          throw new Error("invalid user update");
        }
        const column = assignment.split("=")[0];
        if (column === undefined) {
          throw new Error("invalid user update");
        }
        const name = column.trim();
        const value = params[index];
        if (name === "username" && typeof value === "string") {
          if (
            this.users.some(
              (entry) =>
                entry["id"] !== idValue && entry["username"] === value,
            )
          ) {
            throw new Error("UNIQUE constraint failed: users.username");
          }
        }
        row[name] = value;
      }
      return Promise.resolve({ success: true });
    }
    if (
      query.includes("UPDATE sessions SET revoked_at") &&
      query.includes("WHERE id = ?")
    ) {
      const revokedAt = params[0];
      const id = params[1];
      if (typeof id !== "string") {
        throw new Error("invalid session revoke");
      }
      const row = this.sessions.find((entry) => entry["id"] === id);
      if (row !== undefined) {
        row["revoked_at"] = revokedAt;
      }
      return Promise.resolve({ success: true });
    }
    if (
      query.includes("UPDATE sessions SET revoked_at") &&
      query.includes("WHERE token_hash")
    ) {
      const revokedAt = params[0];
      const tokenHash = params[1];
      if (typeof tokenHash !== "string") {
        throw new Error("invalid session revoke");
      }
      for (const row of this.sessions) {
        if (
          row["token_hash"] === tokenHash &&
          row["revoked_at"] === null
        ) {
          row["revoked_at"] = revokedAt;
        }
      }
      return Promise.resolve({ success: true });
    }
    if (query.includes("UPDATE sessions SET last_seen_at")) {
      const seenAt = params[0];
      const expiresAt = params[1];
      const id = params[2];
      if (typeof id !== "string") {
        throw new Error("invalid session refresh");
      }
      const row = this.sessions.find((entry) => entry["id"] === id);
      if (row !== undefined) {
        row["last_seen_at"] = seenAt;
        row["expires_at"] = expiresAt;
      }
      return Promise.resolve({ success: true });
    }
    throw new Error(`unsupported run query: ${query}`);
  }
}

function testEnv(db: DatabaseBinding): Env {
  return {
    DB: db,
    MEDIA: {
      get: (_key: string) => Promise.resolve(null),
      put: (_key: string, _value: ReadableStream | ArrayBuffer | string) =>
        Promise.resolve({ success: true }),
      delete: (_key: string) => Promise.resolve(),
    },
    ADMIN_EMAILS: "",
    ENVIRONMENT: "development",
  };
}

const meSchema = z.object({
  id: z.string().min(1),
  email: z.string().email(),
  emailVerified: z.boolean(),
  username: z.string().min(1),
  displayName: z.string().nullable(),
  platformCredits: z.number().int(),
  presenceVisibility: z.enum(["visible", "count_only", "hidden"]),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
});

const loginSchema = z.object({
  user: meSchema,
  droppedDevice: z.string().min(1).nullable(),
});

const envelopeSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
});

function sessionCookieValue(res: Response): string | undefined {
  const header = res.headers.get("set-cookie");
  if (header === null) {
    return undefined;
  }
  const first = header.split(";")[0];
  if (first === undefined) {
    return undefined;
  }
  const separator = first.indexOf("=");
  if (separator < 0) {
    return undefined;
  }
  if (first.slice(0, separator).trim() !== "cmp_session") {
    return undefined;
  }
  return first.slice(separator + 1).trim();
}

async function loginRequest(
  db: DatabaseBinding,
  body: Record<string, unknown>,
): Promise<Response> {
  return app.request(
    "/api/auth/login",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
    testEnv(db),
  );
}

async function meRequest(
  db: DatabaseBinding,
  cookie: string | undefined,
): Promise<Response> {
  const headers: Record<string, string> =
    cookie === undefined ? {} : { Cookie: `cmp_session=${cookie}` };
  return app.request("/api/me", { headers }, testEnv(db));
}

class UnverifiedProvider implements AuthProvider {
  verifyToken(_token: string): Promise<VerifiedIdentity> {
    return Promise.resolve({
      providerId: "test:unverified-user",
      email: "unverified@example.com",
      emailVerified: false,
    });
  }
}

function unverifiedApp(): Hono<AppEnv> {
  const router = new Hono<AppEnv>();
  router.use("/api/*", authMiddleware);
  router.route(
    "/",
    createAuthRouter({
      resolveProvider: () => new UnverifiedProvider(),
    }),
  );
  return router;
}

describe("auth login and profile roundtrip", () => {
  it("signs a new user in and reads the profile back over the session cookie", async () => {
    const db = new FakeDb();
    const login = await loginRequest(db, {
      providerToken: "dev:player@example.com",
      username: "player_one",
      displayName: "Player One",
      deviceLabel: "phone",
    });
    expect(login.status).toBe(200);
    const parsedLogin = loginSchema.safeParse(await login.json());
    expect(parsedLogin.success).toBe(true);
    if (parsedLogin.success === false) {
      return;
    }
    expect(parsedLogin.data.user.username).toBe("player_one");
    expect(parsedLogin.data.droppedDevice).toBeNull();

    const setCookie = login.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("cmp_session=");
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("Secure");
    expect(setCookie).toContain("SameSite=Lax");
    expect(setCookie).toContain("Max-Age=2592000");

    const cookie = sessionCookieValue(login);
    expect(cookie !== undefined).toBe(true);
    const me = await meRequest(db, cookie);
    expect(me.status).toBe(200);
    const parsedMe = meSchema.safeParse(await me.json());
    expect(parsedMe.success).toBe(true);
    if (parsedMe.success) {
      expect(parsedMe.data.id).toBe(parsedLogin.data.user.id);
      expect(parsedMe.data.username).toBe("player_one");
    }

    const anonymous = await meRequest(db, undefined);
    expect(anonymous.status).toBe(401);
    const envelope = envelopeSchema.safeParse(await anonymous.json());
    expect(envelope.success).toBe(true);
    if (envelope.success) {
      expect(envelope.data.code).toBe("UNAUTHENTICATED");
    }
  });

  it("rejects an unverified email without creating an account", async () => {
    const db = new FakeDb();
    const router = unverifiedApp();
    const res = await router.request(
      "/api/auth/login",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ providerToken: "stub-token" }),
      },
      testEnv(db),
    );
    expect(res.status).toBe(403);
    const envelope = envelopeSchema.safeParse(await res.json());
    expect(envelope.success).toBe(true);
    if (envelope.success) {
      expect(envelope.data.code).toBe("FORBIDDEN");
    }
    expect(db.users).toHaveLength(0);
  });

  it("enforces unique usernames on signup and profile update", async () => {
    const db = new FakeDb();
    const first = await loginRequest(db, {
      providerToken: "dev:alpha@example.com",
      username: "taken_name",
    });
    expect(first.status).toBe(200);

    const clash = await loginRequest(db, {
      providerToken: "dev:beta@example.com",
      username: "taken_name",
    });
    expect(clash.status).toBe(409);
    const clashEnvelope = envelopeSchema.safeParse(await clash.json());
    if (clashEnvelope.success) {
      expect(clashEnvelope.data.code).toBe("CONFLICT");
    } else {
      expect.unreachable();
    }

    const second = await loginRequest(db, {
      providerToken: "dev:beta@example.com",
      username: "beta_player",
    });
    expect(second.status).toBe(200);
    const cookie = sessionCookieValue(second);
    expect(cookie !== undefined).toBe(true);

    const patchClash = await app.request(
      "/api/me",
      {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          Cookie: `cmp_session=${cookie ?? ""}`,
        },
        body: JSON.stringify({ username: "taken_name" }),
      },
      testEnv(db),
    );
    expect(patchClash.status).toBe(409);
    const patchEnvelope = envelopeSchema.safeParse(await patchClash.json());
    if (patchEnvelope.success) {
      expect(patchEnvelope.data.code).toBe("CONFLICT");
    } else {
      expect.unreachable();
    }

    const patchOk = await app.request(
      "/api/me",
      {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          Cookie: `cmp_session=${cookie ?? ""}`,
        },
        body: JSON.stringify({ username: "beta_renamed" }),
      },
      testEnv(db),
    );
    expect(patchOk.status).toBe(200);
    const parsed = meSchema.safeParse(await patchOk.json());
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.username).toBe("beta_renamed");
    }
  });

  it("evicts the oldest session when a third device signs in", async () => {
    const db = new FakeDb();
    const first = await loginRequest(db, {
      providerToken: "dev:traveler@example.com",
      username: "traveler",
      deviceLabel: "device-one",
    });
    expect(first.status).toBe(200);
    const cookieOne = sessionCookieValue(first);

    const second = await loginRequest(db, {
      providerToken: "dev:traveler@example.com",
      deviceLabel: "device-two",
    });
    expect(second.status).toBe(200);
    const cookieTwo = sessionCookieValue(second);

    const third = await loginRequest(db, {
      providerToken: "dev:traveler@example.com",
      deviceLabel: "device-three",
    });
    expect(third.status).toBe(200);
    const parsedThird = loginSchema.safeParse(await third.json());
    expect(parsedThird.success).toBe(true);
    if (parsedThird.success) {
      expect(parsedThird.data.droppedDevice).toBe("device-one");
    }
    const cookieThree = sessionCookieValue(third);

    const stale = await meRequest(db, cookieOne);
    expect(stale.status).toBe(401);
    const staleEnvelope = envelopeSchema.safeParse(await stale.json());
    if (staleEnvelope.success) {
      expect(staleEnvelope.data.code).toBe("UNAUTHENTICATED");
    } else {
      expect.unreachable();
    }

    const kept = await meRequest(db, cookieTwo);
    expect(kept.status).toBe(200);
    const newest = await meRequest(db, cookieThree);
    expect(newest.status).toBe(200);
  });

  it("revokes the session on logout and rejects expired sessions", async () => {
    const db = new FakeDb();
    const login = await loginRequest(db, {
      providerToken: "dev:farewell@example.com",
      username: "farewell",
    });
    expect(login.status).toBe(200);
    const cookie = sessionCookieValue(login);
    expect(cookie !== undefined).toBe(true);

    const before = await meRequest(db, cookie);
    expect(before.status).toBe(200);

    const logout = await app.request(
      "/api/auth/logout",
      {
        method: "POST",
        headers: { Cookie: `cmp_session=${cookie ?? ""}` },
      },
      testEnv(db),
    );
    expect(logout.status).toBe(200);
    expect((logout.headers.get("set-cookie") ?? "").includes("cmp_session")).toBe(
      true,
    );

    const after = await meRequest(db, cookie);
    expect(after.status).toBe(401);
    const envelope = envelopeSchema.safeParse(await after.json());
    if (envelope.success) {
      expect(envelope.data.code).toBe("UNAUTHENTICATED");
    } else {
      expect.unreachable();
    }

    const again = await loginRequest(db, {
      providerToken: "dev:farewell@example.com",
    });
    expect(again.status).toBe(200);
    const freshCookie = sessionCookieValue(again);
    expect(freshCookie !== undefined).toBe(true);
    const tokenHash = await sha256Hex(freshCookie ?? "");
    const row = db.sessions.find((entry) => entry["token_hash"] === tokenHash);
    expect(row !== undefined).toBe(true);
    if (row !== undefined) {
      row["expires_at"] = "2000-01-01T00:00:00.000Z";
    }
    const expired = await meRequest(db, freshCookie);
    expect(expired.status).toBe(401);
  });
});

interface ClerkHarness {
  router: Hono<AppEnv>;
  db: FakeDb;
  sign: (input: {
    subject: string;
    email?: string;
    emailVerified?: boolean;
    issuer?: string;
    expired?: boolean;
  }) => Promise<string>;
}

async function createClerkHarness(issuer: string): Promise<ClerkHarness> {
  const pair = await generateKeyPair("RS256");
  const kid = "test-key-1";
  const publicJwk = await exportJWK(pair.publicKey);
  const getKey = createLocalJWKSet({
    keys: [{ ...publicJwk, kid, alg: "RS256", use: "sig" }],
  });
  const db = new FakeDb();
  const router = new Hono<AppEnv>();
  router.use("/api/*", authMiddleware);
  router.route(
    "/",
    createAuthRouter({
      resolveProvider: () =>
        new ClerkProvider({
          jwksUrl: `${issuer}/.well-known/jwks.json`,
          issuer,
          getKey,
        }),
    }),
  );
  const sign = async (input: {
    subject: string;
    email?: string;
    emailVerified?: boolean;
    issuer?: string;
    expired?: boolean;
  }): Promise<string> => {
    const jwt = new SignJWT({
      email: input.email ?? "student@example.com",
      email_verified: input.emailVerified ?? true,
    })
      .setProtectedHeader({ alg: "RS256", kid })
      .setIssuer(input.issuer ?? issuer)
      .setSubject(input.subject);
    if (input.expired === true) {
      jwt.setExpirationTime(Math.floor(Date.now() / 1000) - 60);
    } else {
      jwt.setExpirationTime("1h");
    }
    return jwt.sign(pair.privateKey);
  };
  return { router, db, sign };
}

async function clerkLoginRequest(
  harness: ClerkHarness,
  body: Record<string, unknown>,
): Promise<Response> {
  return harness.router.request(
    "/api/auth/login",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
    testEnv(harness.db),
  );
}

describe("clerk session JWT login", () => {
  it("accepts a valid clerk session and links it to a stable provider id", async () => {
    const harness = await createClerkHarness("https://clerk-test.dev");
    const token = await harness.sign({ subject: "user_abc123" });
    const login = await clerkLoginRequest(harness, {
      provider: "clerk",
      token,
      username: "clerk_student",
    });
    expect(login.status).toBe(200);
    const parsedLogin = loginSchema.safeParse(await login.json());
    expect(parsedLogin.success).toBe(true);
    if (parsedLogin.success === false) {
      return;
    }
    expect(parsedLogin.data.user.email).toBe("student@example.com");
    expect(parsedLogin.data.user.username).toBe("clerk_student");
    expect(harness.db.users).toHaveLength(1);
    const stored = harness.db.users[0];
    expect(stored?.["auth_provider_id"]).toBe("clerk:user_abc123");

    const again = await clerkLoginRequest(harness, {
      provider: "clerk",
      token,
    });
    expect(again.status).toBe(200);
    const parsedAgain = loginSchema.safeParse(await again.json());
    expect(parsedAgain.success).toBe(true);
    if (parsedAgain.success) {
      expect(parsedAgain.data.user.id).toBe(parsedLogin.data.user.id);
    }
    expect(harness.db.users).toHaveLength(1);
  });

  it("rejects an expired clerk session without creating an account", async () => {
    const harness = await createClerkHarness("https://clerk-test.dev");
    const token = await harness.sign({
      subject: "user_expired",
      expired: true,
    });
    const res = await clerkLoginRequest(harness, {
      provider: "clerk",
      token,
      username: "expired_student",
    });
    expect(res.status).toBe(403);
    const envelope = envelopeSchema.safeParse(await res.json());
    expect(envelope.success).toBe(true);
    if (envelope.success) {
      expect(envelope.data.code).toBe("FORBIDDEN");
    }
    expect(harness.db.users).toHaveLength(0);
  });

  it("rejects a clerk session from the wrong issuer", async () => {
    const harness = await createClerkHarness("https://clerk-test.dev");
    const token = await harness.sign({
      subject: "user_other_issuer",
      issuer: "https://attacker.example.com",
    });
    const res = await clerkLoginRequest(harness, {
      provider: "clerk",
      token,
      username: "other_issuer",
    });
    expect(res.status).toBe(403);
    const envelope = envelopeSchema.safeParse(await res.json());
    expect(envelope.success).toBe(true);
    if (envelope.success) {
      expect(envelope.data.code).toBe("FORBIDDEN");
    }
    expect(harness.db.users).toHaveLength(0);
  });

  it("rejects a clerk session with an unverified email", async () => {
    const harness = await createClerkHarness("https://clerk-test.dev");
    const token = await harness.sign({
      subject: "user_unverified",
      emailVerified: false,
    });
    const res = await clerkLoginRequest(harness, {
      provider: "clerk",
      token,
      username: "unverified_student",
    });
    expect(res.status).toBe(403);
    const envelope = envelopeSchema.safeParse(await res.json());
    expect(envelope.success).toBe(true);
    if (envelope.success) {
      expect(envelope.data.code).toBe("FORBIDDEN");
    }
    expect(harness.db.users).toHaveLength(0);
  });

  it("rejects a clerk session with a tampered signature", async () => {
    const harness = await createClerkHarness("https://clerk-test.dev");
    const token = await harness.sign({ subject: "user_tampered" });
    const last = token.slice(-1);
    const tampered = `${token.slice(0, -1)}${last === "a" ? "b" : "a"}`;
    const res = await clerkLoginRequest(harness, {
      provider: "clerk",
      token: tampered,
      username: "tampered_student",
    });
    expect(res.status).toBe(403);
    const envelope = envelopeSchema.safeParse(await res.json());
    expect(envelope.success).toBe(true);
    if (envelope.success) {
      expect(envelope.data.code).toBe("FORBIDDEN");
    }
    expect(harness.db.users).toHaveLength(0);
  });
});
