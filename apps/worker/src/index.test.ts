import { describe, expect, it } from "vitest";
import { z } from "zod";
import type {
  BucketBinding,
  DatabaseBinding,
  Env,
  PreparedStatementBinding
} from "./env";
import app from "./index";

const healthBodySchema = z.object({
  ok: z.literal(true),
  env: z.string(),
  time: z.string()
});

const envelopeSchema = z.object({
  code: z.string(),
  message: z.string()
});

function testEnv(): Env {
  const statement: PreparedStatementBinding = {
    bind: (..._values: Array<unknown>) => statement,
    first: () => Promise.resolve(null),
    all: () => Promise.resolve([]),
    run: () => Promise.resolve({ success: true })
  };
  const db: DatabaseBinding = {
    prepare: (_query: string) => statement,
    batch: (_statements: Array<PreparedStatementBinding>) =>
      Promise.resolve([]),
    exec: (_query: string) => Promise.resolve({ success: true })
  };
  const media: BucketBinding = {
    get: (_key: string) => Promise.resolve(null),
    put: (_key: string, _value: ReadableStream | ArrayBuffer | string) =>
      Promise.resolve({ success: true }),
    delete: (_key: string) => Promise.resolve()
  };
  return { DB: db, MEDIA: media, ADMIN_EMAILS: "" };
}

describe("GET /api/health", () => {
  it("returns ok with the environment name and a server timestamp", async () => {
    const res = await app.request("/api/health", {}, testEnv());
    expect(res.status).toBe(200);
    const parsed = healthBodySchema.safeParse(await res.json());
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.env).toBe("development");
      expect(Number.isNaN(Date.parse(parsed.data.time))).toBe(false);
    }
  });

  it("returns the shared NOT_FOUND envelope for unknown API routes", async () => {
    const res = await app.request("/api/does-not-exist", {}, testEnv());
    expect(res.status).toBe(404);
    const parsed = envelopeSchema.safeParse(await res.json());
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.code).toBe("NOT_FOUND");
    }
  });

  it("returns EVENT_NOT_FOUND for an unknown event id", async () => {
    const res = await app.request(
      "/api/events/demo-event",
      {},
      testEnv()
    );
    expect(res.status).toBe(404);
    const parsed = envelopeSchema.safeParse(await res.json());
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.code).toBe("EVENT_NOT_FOUND");
    }
  });
});
