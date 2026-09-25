/** Auth endpoints: provider login exchange, session logout, profile read and update. */
import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { createRemoteJWKSet, jwtVerify } from "jose";
import type { JWTVerifyGetKey } from "jose";
import { z } from "zod";
import type { AppEnv, Env } from "../env";
import { newId, sha256Hex } from "../lib/crypto";
import { errorResponse } from "../lib/errors";
import type { AppContext } from "../lib/errors";
import { nowIso } from "../lib/time";
import { turnstileRequired, verifyTurnstile } from "../lib/turnstile";
import { allowlistMatches } from "../middleware/requireAdmin";

const SESSION_COOKIE = "cmp_session";

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;

const MAX_ACTIVE_SESSIONS = 2;

const usernameSchema = z
  .string()
  .min(3)
  .max(32)
  .regex(/^[A-Za-z0-9_]+$/);

const displayNameSchema = z.string().trim().min(1).max(64);

const deviceLabelSchema = z.string().trim().min(1).max(64);

const presenceVisibilitySchema = z.enum([
  "visible",
  "count_only",
  "hidden",
]);

const loginOptionalFields = {
  username: usernameSchema.optional(),
  displayName: displayNameSchema.optional(),
  deviceLabel: deviceLabelSchema.optional(),
  turnstileToken: z.string().min(1).max(2048).optional(),
};

const loginBodySchema = z.union([
  z.object({
    providerToken: z.string().min(1).max(2048),
    ...loginOptionalFields,
  }),
  z.object({
    provider: z.enum(["dev", "clerk"]),
    token: z.string().min(1).max(2048),
    ...loginOptionalFields,
  }),
]);

const updateProfileBodySchema = z.object({
  username: usernameSchema.optional(),
  displayName: displayNameSchema.optional(),
  presenceVisibility: presenceVisibilitySchema.optional(),
});

const usernameAvailabilityQuerySchema = z.object({
  username: usernameSchema,
});

const USER_COLUMNS = [
  "id",
  "auth_provider_id",
  "email",
  "email_verified",
  "username",
  "display_name",
  "platform_credits",
  "presence_visibility",
  "created_at",
  "updated_at",
].join(", ");

const userRowSchema = z.object({
  id: z.string().min(1),
  auth_provider_id: z.string().min(1),
  email: z.string().email(),
  email_verified: z.number().int(),
  username: z.string().min(1),
  display_name: z.string().nullable(),
  platform_credits: z.number().int(),
  presence_visibility: z.string().min(1),
  created_at: z.string().min(1),
  updated_at: z.string().min(1),
});

type UserRow = z.infer<typeof userRowSchema>;

const sessionBriefSchema = z.object({
  id: z.string().min(1),
  device_label: z.string().nullable(),
  created_at: z.string().min(1),
  expires_at: z.string().min(1),
});

interface Profile {
  id: string;
  email: string;
  emailVerified: boolean;
  username: string;
  displayName: string | null;
  platformCredits: number;
  presenceVisibility: "visible" | "count_only" | "hidden";
  // Server-computed from the ADMIN_EMAILS allowlist: the client may gate UI
  // on it but must never trust it — every /api/admin/* call re-checks.
  isAdmin: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface VerifiedIdentity {
  providerId: string;
  email: string;
  emailVerified: boolean;
}

export interface AuthProvider {
  verifyToken(token: string): Promise<VerifiedIdentity>;
}

export class AuthProviderError extends Error {}

export class ProviderNotConfiguredError extends AuthProviderError {}

export class DevProviderDisabledError extends AuthProviderError {}

export class InvalidProviderTokenError extends AuthProviderError {}

export class DevProvider implements AuthProvider {
  constructor(private readonly environment: string | undefined) {}

  async verifyToken(token: string): Promise<VerifiedIdentity> {
    if ((this.environment ?? "development") === "production") {
      throw new DevProviderDisabledError(
        "Development sign-in is disabled in production",
      );
    }
    const candidate = token.slice("dev:".length).trim().toLowerCase();
    const email = z.string().email().safeParse(candidate);
    if (email.success === false) {
      throw new InvalidProviderTokenError("Invalid development credential");
    }
    return {
      providerId: `dev:${email.data}`,
      email: email.data,
      emailVerified: true,
    };
  }
}

export class ClerkVerificationError extends AuthProviderError {}

export interface ClerkProviderConfig {
  jwksUrl: string;
  issuer: string;
  getKey?: JWTVerifyGetKey;
}

const clerkClaimsSchema = z
  .object({
    sub: z.string().min(1),
    email: z.string().email(),
    email_verified: z.boolean(),
  })
  .catchall(z.unknown());

const clerkEnvSchema = z
  .object({ CLERK_JWKS_URL: z.string().min(1).max(2048) })
  .catchall(z.unknown());

const CLERK_JWKS_SUFFIX = "/.well-known/jwks.json";

const clerkJwksCache = new Map<string, JWTVerifyGetKey>();

function clerkJwksFor(url: string): JWTVerifyGetKey {
  const cached = clerkJwksCache.get(url);
  if (cached !== undefined) {
    return cached;
  }
  const created = createRemoteJWKSet(new URL(url));
  clerkJwksCache.set(url, created);
  return created;
}

function clerkJwksUrlFromEnv(env: Env): string | undefined {
  const parsed = clerkEnvSchema.safeParse(env);
  if (parsed.success === false) {
    return undefined;
  }
  return parsed.data.CLERK_JWKS_URL;
}

function clerkIssuerFromJwksUrl(jwksUrl: string): string {
  if (jwksUrl.endsWith(CLERK_JWKS_SUFFIX)) {
    return jwksUrl.slice(0, jwksUrl.length - CLERK_JWKS_SUFFIX.length);
  }
  return jwksUrl;
}

export class ClerkProvider implements AuthProvider {
  constructor(private readonly config: ClerkProviderConfig) {}

  async verifyToken(token: string): Promise<VerifiedIdentity> {
    try {
      const verified = await jwtVerify(
        token,
        this.config.getKey ?? clerkJwksFor(this.config.jwksUrl),
        { issuer: this.config.issuer },
      );
      const claims = clerkClaimsSchema.safeParse(verified.payload);
      if (claims.success === false || claims.data.email_verified !== true) {
        throw new ClerkVerificationError("Invalid Clerk session");
      }
      return {
        providerId: `clerk:${claims.data.sub}`,
        email: claims.data.email,
        emailVerified: true,
      };
    } catch (err: unknown) {
      if (err instanceof ClerkVerificationError) {
        throw err;
      }
      throw new ClerkVerificationError("Invalid Clerk session");
    }
  }
}

export function clerkProviderFromEnv(
  env: Env,
  overrides?: { issuer?: string; getKey?: JWTVerifyGetKey },
): ClerkProvider {
  const jwksUrl = clerkJwksUrlFromEnv(env);
  if (jwksUrl === undefined) {
    throw new ClerkVerificationError("Clerk authentication is not configured");
  }
  const config: ClerkProviderConfig = {
    jwksUrl,
    issuer: overrides?.issuer ?? clerkIssuerFromJwksUrl(jwksUrl),
  };
  if (overrides?.getKey !== undefined) {
    config.getKey = overrides.getKey;
  }
  return new ClerkProvider(config);
}

export interface OidcConfig {
  issuer: string;
  audience: string;
}

export class OidcProvider implements AuthProvider {
  constructor(private readonly config: OidcConfig | undefined = undefined) {}

  async verifyToken(_token: string): Promise<VerifiedIdentity> {
    const issuer = this.config?.issuer ?? "unset";
    throw new ProviderNotConfiguredError(
      `OidcProvider is not configured (issuer: ${issuer})`,
    );
  }
}

function selectProvider(token: string, env: Env): AuthProvider {
  if (token.startsWith("dev:")) {
    return new DevProvider(env.ENVIRONMENT);
  }
  return new OidcProvider();
}

export interface AuthRouterDeps {
  resolveProvider?: (token: string, env: Env) => AuthProvider;
}

function providerErrorResponse(c: AppContext, err: unknown): Response {
  if (err instanceof ProviderNotConfiguredError) {
    // A token no configured provider can verify is a bad request shape, not
    // a server failure (stable machine-readable codes, §19.6).
    return errorResponse(
      c,
      "VALIDATION_ERROR",
      "Authentication provider is not configured",
    );
  }
  if (err instanceof DevProviderDisabledError) {
    return errorResponse(
      c,
      "FORBIDDEN",
      "Development sign-in is disabled in production",
    );
  }
  if (err instanceof ClerkVerificationError) {
    return errorResponse(c, "FORBIDDEN", "Invalid authentication token");
  }
  if (err instanceof InvalidProviderTokenError) {
    return errorResponse(c, "VALIDATION_ERROR", "Invalid authentication token");
  }
  return errorResponse(c, "INTERNAL", "Authentication failed");
}

function toProfile(row: UserRow, adminEmails: string): Profile | undefined {
  const visibility = presenceVisibilitySchema.safeParse(
    row.presence_visibility,
  );
  if (visibility.success === false) {
    return undefined;
  }
  return {
    id: row.id,
    email: row.email,
    emailVerified: row.email_verified === 1,
    username: row.username,
    displayName: row.display_name,
    platformCredits: row.platform_credits,
    presenceVisibility: visibility.data,
    isAdmin: allowlistMatches(row.email.toLowerCase(), adminEmails),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function clientIp(c: AppContext): string | undefined {
  const direct = c.req.header("cf-connecting-ip")?.trim();
  if (direct !== undefined && direct.length > 0) {
    return direct;
  }
  const forwarded = c.req.header("x-forwarded-for")?.split(",")[0]?.trim();
  if (forwarded !== undefined && forwarded.length > 0) {
    return forwarded;
  }
  return undefined;
}

function newSessionToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

async function loadUserById(
  c: AppContext,
  userId: string,
): Promise<{ profile: Profile } | { error: Response }> {
  const raw: unknown = await c.env.DB.prepare(
    `SELECT ${USER_COLUMNS} FROM users WHERE id = ?`,
  )
    .bind(userId)
    .first();
  if (raw === null) {
    return {
      error: errorResponse(c, "UNAUTHENTICATED", "Authentication required"),
    };
  }
  const parsed = userRowSchema.safeParse(raw);
  if (parsed.success === false) {
    return { error: errorResponse(c, "INTERNAL", "Unable to load account") };
  }
    const profile = toProfile(parsed.data, c.env.ADMIN_EMAILS ?? "");
  if (profile === undefined) {
    return { error: errorResponse(c, "INTERNAL", "Unable to load account") };
  }
  return { profile };
}

export function createAuthRouter(deps?: AuthRouterDeps): Hono<AppEnv> {
  const router = new Hono<AppEnv>();

  router.post("/api/auth/login", async (c) => {
    const raw: unknown = await c.req.json().catch(() => undefined);
    const parsed = loginBodySchema.safeParse(raw);
    if (parsed.success === false) {
      return errorResponse(c, "VALIDATION_ERROR", "Invalid login request");
    }
    const body = parsed.data;
    const explicitProvider = "provider" in body ? body.provider : undefined;
    const rawToken = "providerToken" in body ? body.providerToken : body.token;

    if (turnstileRequired(c.env)) {
      if (body.turnstileToken === undefined) {
        return errorResponse(c, "FORBIDDEN", "Turnstile verification required");
      }
      const secret = c.env.TURNSTILE_SECRET_KEY ?? "";
      if (secret.trim().length === 0) {
        return errorResponse(c, "INTERNAL", "Turnstile is misconfigured");
      }
      const human = await verifyTurnstile(
        secret,
        body.turnstileToken,
        clientIp(c),
      );
      if (human === false) {
        return errorResponse(c, "FORBIDDEN", "Turnstile verification failed");
      }
    }

    let identity: VerifiedIdentity;
    try {
      let provider: AuthProvider;
      if (deps?.resolveProvider !== undefined) {
        provider = deps.resolveProvider(rawToken, c.env);
      } else if (explicitProvider === "clerk") {
        provider = clerkProviderFromEnv(c.env);
      } else if (explicitProvider === "dev") {
        provider = new DevProvider(c.env.ENVIRONMENT);
      } else {
        provider = selectProvider(rawToken, c.env);
      }
      identity = await provider.verifyToken(rawToken);
    } catch (err: unknown) {
      return providerErrorResponse(c, err);
    }
    if (identity.emailVerified === false) {
      return errorResponse(
        c,
        "FORBIDDEN",
        "EMAIL_UNVERIFIED: email verification is required before signing in",
      );
    }

    const db = c.env.DB;
    const now = nowIso();

    const existingRaw: unknown = await db
      .prepare(`SELECT ${USER_COLUMNS} FROM users WHERE auth_provider_id = ?`)
      .bind(identity.providerId)
      .first();
    if (existingRaw !== null) {
      const checked = userRowSchema.safeParse(existingRaw);
      if (checked.success === false) {
        return errorResponse(c, "INTERNAL", "Unable to load account");
      }
    }
    const existing = userRowSchema.safeParse(existingRaw).data;

    let userId: string;
    let profile: Profile | undefined;
    let userWrite: ReturnType<typeof db.prepare>;
    if (existing === undefined) {
      if (body.username === undefined) {
        return errorResponse(
          c,
          "VALIDATION_ERROR",
          "Username is required for new accounts",
        );
      }
      const clash: unknown = await db
        .prepare("SELECT id FROM users WHERE username = ?")
        .bind(body.username)
        .first();
      if (clash !== null) {
        return errorResponse(c, "CONFLICT", "Username is already taken");
      }
      userId = newId();
      profile = {
        id: userId,
        email: identity.email,
        emailVerified: identity.emailVerified,
        username: body.username,
        displayName: body.displayName ?? null,
        platformCredits: 0,
        presenceVisibility: "visible",
        isAdmin: allowlistMatches(identity.email.toLowerCase(), c.env.ADMIN_EMAILS ?? ""),
        createdAt: now,
        updatedAt: now,
      };
      userWrite = db
        .prepare(
          "INSERT INTO users (id, auth_provider_id, email, email_verified, username, display_name, platform_credits, presence_visibility, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(
          userId,
          identity.providerId,
          identity.email,
          identity.emailVerified ? 1 : 0,
          body.username,
          body.displayName ?? null,
          0,
          "visible",
          now,
          now,
        );
    } else {
      userId = existing.id;
      profile = toProfile({
        ...existing,
        email: identity.email,
        email_verified: identity.emailVerified ? 1 : 0,
        updated_at: now,
      }, c.env.ADMIN_EMAILS ?? "");
      if (profile === undefined) {
        return errorResponse(c, "INTERNAL", "Unable to load account");
      }
      userWrite = db
        .prepare(
          "UPDATE users SET email = ?, email_verified = ?, updated_at = ? WHERE id = ?",
        )
        .bind(identity.email, identity.emailVerified ? 1 : 0, now, userId);
    }

    const sessionsRaw: unknown = (await db
      .prepare(
        "SELECT id, device_label, created_at, expires_at FROM sessions WHERE user_id = ? AND revoked_at IS NULL ORDER BY created_at ASC, rowid ASC",
      )
      .bind(userId)
      .all()).results;
    const sessionsParsed = z.array(sessionBriefSchema).safeParse(sessionsRaw);
    if (sessionsParsed.success === false) {
      return errorResponse(c, "INTERNAL", "Unable to load sessions");
    }
    const live = sessionsParsed.data.filter(
      (session) => session.expires_at > now,
    );
    const oldest = live.length >= MAX_ACTIVE_SESSIONS ? live[0] : undefined;
    if (live.length >= MAX_ACTIVE_SESSIONS && oldest === undefined) {
      return errorResponse(c, "INTERNAL", "Unable to load sessions");
    }

    const token = newSessionToken();
    const tokenHash = await sha256Hex(token);
    const sessionId = newId();
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
    const ip = clientIp(c);
    const ipHash = ip === undefined ? null : await sha256Hex(`ip:${ip}`);
    const sessionWrite = db
      .prepare(
        "INSERT INTO sessions (id, user_id, token_hash, device_label, ip_hash, created_at, last_seen_at, expires_at, revoked_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)",
      )
      .bind(
        sessionId,
        userId,
        tokenHash,
        body.deviceLabel ?? null,
        ipHash,
        now,
        now,
        expiresAt,
      );
    const droppedDevice =
      oldest === undefined ? null : (oldest.device_label ?? oldest.id);
    try {
      if (oldest === undefined) {
        await db.batch([userWrite, sessionWrite]);
      } else {
        const revokeWrite = db
          .prepare("UPDATE sessions SET revoked_at = ? WHERE id = ?")
          .bind(now, oldest.id);
        await db.batch([userWrite, revokeWrite, sessionWrite]);
      }
    } catch (err: unknown) {
      if (
        err instanceof Error &&
        err.message.includes("UNIQUE constraint failed")
      ) {
        return errorResponse(c, "CONFLICT", "Username is already taken");
      }
      throw err;
    }

    setCookie(c, SESSION_COOKIE, token, {
      httpOnly: true,
      // Secure everywhere except local development, where plain-http
      // preview must still receive the cookie.
      secure: c.env.ENVIRONMENT !== "development",
      sameSite: "Lax",
      path: "/",
      maxAge: SESSION_TTL_SECONDS,
    });
    return c.json({ user: profile, droppedDevice }, 200);
  });

  router.post("/api/auth/logout", async (c) => {
    const token = getCookie(c, SESSION_COOKIE);
    if (token !== undefined && token.length > 0) {
      const tokenHash = await sha256Hex(token);
      await c.env.DB.prepare(
        "UPDATE sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL",
      )
        .bind(nowIso(), tokenHash)
        .run();
    }
    deleteCookie(c, SESSION_COOKIE, { path: "/" });
    return c.json({ ok: true }, 200);
  });

  router.get("/api/me", async (c) => {
    const authUser = c.get("user");
    if (authUser === undefined) {
      return errorResponse(c, "UNAUTHENTICATED", "Authentication required");
    }
    const loaded = await loadUserById(c, authUser.id);
    if ("error" in loaded) {
      return loaded.error;
    }
    return c.json(loaded.profile, 200);
  });

  router.patch("/api/me", async (c) => {
    const authUser = c.get("user");
    if (authUser === undefined) {
      return errorResponse(c, "UNAUTHENTICATED", "Authentication required");
    }
    const raw: unknown = await c.req.json().catch(() => undefined);
    const parsed = updateProfileBodySchema.safeParse(raw);
    if (parsed.success === false) {
      return errorResponse(c, "VALIDATION_ERROR", "Invalid profile update");
    }
    const body = parsed.data;
    const db = c.env.DB;

    if (
      body.username === undefined &&
      body.displayName === undefined &&
      body.presenceVisibility === undefined
    ) {
      const loaded = await loadUserById(c, authUser.id);
      if ("error" in loaded) {
        return loaded.error;
      }
      return c.json(loaded.profile, 200);
    }

    if (body.username !== undefined) {
      const clash: unknown = await db
        .prepare("SELECT id FROM users WHERE username = ? AND id != ?")
        .bind(body.username, authUser.id)
        .first();
      if (clash !== null) {
        return errorResponse(c, "CONFLICT", "Username is already taken");
      }
    }

    const sets: Array<string> = [];
    const values: Array<unknown> = [];
    if (body.username !== undefined) {
      sets.push("username = ?");
      values.push(body.username);
    }
    if (body.displayName !== undefined) {
      sets.push("display_name = ?");
      values.push(body.displayName);
    }
    if (body.presenceVisibility !== undefined) {
      sets.push("presence_visibility = ?");
      values.push(body.presenceVisibility);
    }
    const now = nowIso();
    sets.push("updated_at = ?");
    values.push(now);
    values.push(authUser.id);
    await db
      .prepare(`UPDATE users SET ${sets.join(", ")} WHERE id = ?`)
      .bind(...values)
      .run();

    const loaded = await loadUserById(c, authUser.id);
    if ("error" in loaded) {
      return loaded.error;
    }
    return c.json(loaded.profile, 200);
  });

  router.get("/api/auth/username-availability", async (c) => {
    const parsed = usernameAvailabilityQuerySchema.safeParse(c.req.query());
    if (parsed.success === false) {
      return errorResponse(c, "VALIDATION_ERROR", "Invalid username");
    }
    const clash: unknown = await c.env.DB.prepare(
      "SELECT id FROM users WHERE username = ?",
    )
      .bind(parsed.data.username)
      .first();
    return c.json(
      { username: parsed.data.username, available: clash === null },
      200,
    );
  });

  return router;
}

export const authRouter = createAuthRouter();
