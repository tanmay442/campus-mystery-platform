/** Challenge progression: unlock modes, route-graph validation, publish gating. */

import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  challengeConfigurationSchema,
  isChallengeComplete,
  isChallengeUnlocked,
  validateRouteGraph
} from "@campus/shared";
import type { ChallengeConfiguration, RouteGraphNode } from "@campus/shared";
import app from "../index";
import type { DatabaseBinding, Env, PreparedStatementBinding } from "../env";
import { sha256Hex } from "../lib/crypto";
import { validateEventForPublish } from "./admin";

const NOW = "2026-09-06T12:00:00.000Z";

function textObjective(key: string, answer: string): Record<string, unknown> {
  return {
    key,
    type: "text_answer",
    prompt: `Prompt for ${key}`,
    required: true,
    dependsOn: [],
    expectedAnswer: answer,
    eventPoints: 5,
    platformCredits: 0,
    hints: []
  };
}

function configFor(input: Record<string, unknown>): ChallengeConfiguration {
  return challengeConfigurationSchema.parse(input);
}

function openConfig(): ChallengeConfiguration {
  return configFor({ objectives: [textObjective("t1", "alpha")] });
}

function nodeFor(input: {
  id: string;
  requires?: string[];
  requiresDecision?: { challengeId: string; objectiveKey: string; value: string };
  isTerminal?: boolean;
  decisionOptions?: Array<{ objectiveKey: string; values: string[] }>;
}): RouteGraphNode {
  return {
    id: input.id,
    requires: input.requires ?? [],
    requiresDecision: input.requiresDecision,
    isTerminal: input.isTerminal ?? false,
    decisionOptions: input.decisionOptions ?? []
  };
}

describe("isChallengeUnlocked", () => {
  it("treats challenges without constraints as open", () => {
    expect(isChallengeUnlocked(openConfig(), [], {}, NOW)).toBe(true);
    expect(isChallengeUnlocked(openConfig(), ["other"], { ch: { route: "left" } }, NOW)).toBe(true);
  });

  it("chains sequential challenges through requires", () => {
    const config = configFor({ objectives: [textObjective("t1", "a")], requires: ["ch-a"] });
    expect(isChallengeUnlocked(config, [], {}, NOW)).toBe(false);
    expect(isChallengeUnlocked(config, ["ch-a"], {}, NOW)).toBe(true);
    expect(isChallengeUnlocked(config, ["ch-a", "ch-b"], {}, NOW)).toBe(true);
  });

  it("requires every listed prerequisite across routes", () => {
    const config = configFor({
      objectives: [textObjective("t1", "a")],
      requires: ["ch-a", "ch-b"]
    });
    expect(isChallengeUnlocked(config, ["ch-a"], {}, NOW)).toBe(false);
    expect(isChallengeUnlocked(config, ["ch-a", "ch-b"], {}, NOW)).toBe(true);
  });

  it("gates branches on the recorded decision choice", () => {
    const config = configFor({
      objectives: [textObjective("t1", "a")],
      requiresDecision: { challengeId: "ch-d", objectiveKey: "route", value: "left" }
    });
    expect(isChallengeUnlocked(config, [], {}, NOW)).toBe(false);
    expect(isChallengeUnlocked(config, [], { "ch-d": { route: "right" } }, NOW)).toBe(false);
    expect(isChallengeUnlocked(config, [], { "ch-d": { route: "left" } }, NOW)).toBe(true);
    expect(isChallengeUnlocked(config, ["ch-d"], { "ch-d": { route: "left" } }, NOW)).toBe(true);
  });

  it("enforces scheduled availability windows", () => {
    const future = configFor({
      objectives: [textObjective("t1", "a")],
      availableFrom: "2026-09-07T00:00:00.000Z"
    });
    expect(isChallengeUnlocked(future, [], {}, NOW)).toBe(false);
    expect(isChallengeUnlocked(future, [], {}, "2026-09-07T00:00:01.000Z")).toBe(true);
    const past = configFor({
      objectives: [textObjective("t1", "a")],
      availableUntil: "2026-09-05T00:00:00.000Z"
    });
    expect(isChallengeUnlocked(past, [], {}, NOW)).toBe(false);
    const window = configFor({
      objectives: [textObjective("t1", "a")],
      availableFrom: "2026-09-01T00:00:00.000Z",
      availableUntil: "2026-09-10T00:00:00.000Z"
    });
    expect(isChallengeUnlocked(window, [], {}, NOW)).toBe(true);
  });

  it("ignores visibility flags when computing availability", () => {
    const config = configFor({
      objectives: [textObjective("t1", "a")],
      hiddenUntilUnlocked: true
    });
    expect(isChallengeUnlocked(config, [], {}, NOW)).toBe(true);
  });

  it("combines dependency, decision, and schedule constraints", () => {
    const config = configFor({
      objectives: [textObjective("t1", "a")],
      requires: ["ch-a"],
      requiresDecision: { challengeId: "ch-d", objectiveKey: "route", value: "left" },
      availableFrom: "2026-09-01T00:00:00.000Z",
      availableUntil: "2026-09-10T00:00:00.000Z"
    });
    const choices = { "ch-d": { route: "left" } };
    expect(isChallengeUnlocked(config, ["ch-a"], choices, NOW)).toBe(true);
    expect(isChallengeUnlocked(config, [], choices, NOW)).toBe(false);
    expect(isChallengeUnlocked(config, ["ch-a"], { "ch-d": { route: "right" } }, NOW)).toBe(false);
    expect(isChallengeUnlocked(config, ["ch-a"], choices, "2026-09-11T00:00:00.000Z")).toBe(false);
  });

  it("locks when the reference time is unusable", () => {
    expect(isChallengeUnlocked(openConfig(), [], {}, "not-a-date")).toBe(false);
  });
});

describe("isChallengeComplete", () => {
  it("requires every required objective", () => {
    const config = configFor({
      objectives: [textObjective("t1", "a"), textObjective("t2", "b")]
    });
    expect(isChallengeComplete(config, ["t1", "t2"])).toBe(true);
    expect(isChallengeComplete(config, ["t1"])).toBe(false);
    expect(isChallengeComplete(config, [])).toBe(false);
  });

  it("ignores incomplete optional objectives", () => {
    const optional: Record<string, unknown> = {
      ...textObjective("opt", "o"),
      required: false
    };
    const config = configFor({ objectives: [textObjective("t1", "a"), optional] });
    expect(isChallengeComplete(config, ["t1"])).toBe(true);
  });

  it("counts optional-only challenges after first engagement", () => {
    const optional: Record<string, unknown> = {
      ...textObjective("opt", "o"),
      required: false
    };
    const config = configFor({ objectives: [optional] });
    expect(isChallengeComplete(config, [])).toBe(false);
    expect(isChallengeComplete(config, ["opt"])).toBe(true);
  });
});

describe("validateRouteGraph", () => {
  it("accepts a linear chain ending at a terminal", () => {
    expect(
      validateRouteGraph([
        nodeFor({ id: "a" }),
        nodeFor({ id: "b", requires: ["a"] }),
        nodeFor({ id: "c", requires: ["b"], isTerminal: true })
      ])
    ).toEqual([]);
  });

  it("accepts open events where every challenge is an entry plus a terminal", () => {
    expect(
      validateRouteGraph([nodeFor({ id: "a" }), nodeFor({ id: "b", isTerminal: true })])
    ).toEqual([]);
  });

  it("reports missing prerequisites", () => {
    expect(
      validateRouteGraph([
        nodeFor({ id: "a" }),
        nodeFor({ id: "b", requires: ["ghost"], isTerminal: true })
      ])
    ).toEqual(["missing_prerequisite:b:ghost"]);
  });

  it("reports dangling decision sources as missing prerequisites", () => {
    expect(
      validateRouteGraph([
        nodeFor({
          id: "x",
          requiresDecision: { challengeId: "gone", objectiveKey: "route", value: "left" },
          isTerminal: true
        })
      ])
    ).toEqual(["missing_prerequisite:x:gone"]);
  });

  it("reports direct dependency cycles", () => {
    expect(
      validateRouteGraph([
        nodeFor({ id: "e", isTerminal: true }),
        nodeFor({ id: "a", requires: ["b"] }),
        nodeFor({ id: "b", requires: ["a"] })
      ])
    ).toEqual(["dependency_cycle:a->b->a", "unreachable:a", "unreachable:b"]);
  });

  it("reports self dependencies as cycles", () => {
    expect(validateRouteGraph([nodeFor({ id: "a", requires: ["a"], isTerminal: true })])).toEqual([
      "dependency_cycle:a->a",
      "unreachable:a",
      "missing_final_target"
    ]);
  });

  it("reports branches whose values unlock nothing", () => {
    expect(
      validateRouteGraph([
        nodeFor({
          id: "d",
          decisionOptions: [{ objectiveKey: "route", values: ["left", "right"] }]
        }),
        nodeFor({
          id: "l",
          requiresDecision: { challengeId: "d", objectiveKey: "route", value: "left" }
        }),
        nodeFor({ id: "t", requires: ["l"], isTerminal: true })
      ])
    ).toEqual(["branch_without_path:d:route:right"]);
  });

  it("accepts branches where every value unlocks a path", () => {
    expect(
      validateRouteGraph([
        nodeFor({
          id: "d",
          decisionOptions: [{ objectiveKey: "route", values: ["left", "right"] }]
        }),
        nodeFor({
          id: "l",
          requiresDecision: { challengeId: "d", objectiveKey: "route", value: "left" },
          isTerminal: true
        }),
        nodeFor({
          id: "r",
          requiresDecision: { challengeId: "d", objectiveKey: "route", value: "right" },
          isTerminal: true
        })
      ])
    ).toEqual([]);
  });

  it("requires a reachable terminal", () => {
    expect(validateRouteGraph([nodeFor({ id: "a" })])).toEqual(["missing_final_target"]);
  });
});

describe("validateEventForPublish with route checks", () => {
  const settings = "{}";

  function challengeJson(input: Record<string, unknown>): string {
    return JSON.stringify(input);
  }

  it("keeps legacy calls without challenge graphs passing", () => {
    expect(
      validateEventForPublish({
        settingsJson: settings,
        startsAt: null,
        endsAt: null,
        challengeCount: 1
      })
    ).toEqual({ ok: true });
  });

  it("publishes a single legacy challenge without flagging the final target", () => {
    expect(
      validateEventForPublish({
        settingsJson: settings,
        startsAt: null,
        endsAt: null,
        challengeCount: 1,
        challenges: [{ id: "ch-1", configurationJson: JSON.stringify({ objectives: [] }) }]
      })
    ).toEqual({ ok: true });
  });

  it("rejects routes with missing prerequisites and reports machine-readable reasons", () => {
    const result = validateEventForPublish({
      settingsJson: settings,
      startsAt: null,
      endsAt: null,
      challengeCount: 2,
      challenges: [
        { id: "ch-a", configurationJson: challengeJson({ objectives: [textObjective("t1", "a")] }) },
        {
          id: "ch-b",
          configurationJson: challengeJson({
            objectives: [textObjective("t1", "b")],
            requires: ["ghost"],
            isTerminal: true
          })
        }
      ]
    });
    expect(result.ok).toBe(false);
    expect(result.error).toBe("Event route is invalid");
    expect(result.reasons).toContain("missing_prerequisite:ch-b:ghost");
  });

  it("rejects routes with no terminal", () => {
    const result = validateEventForPublish({
      settingsJson: settings,
      startsAt: null,
      endsAt: null,
      challengeCount: 2,
      challenges: [
        { id: "ch-a", configurationJson: challengeJson({ objectives: [textObjective("t1", "a")] }) },
        {
          id: "ch-b",
          configurationJson: challengeJson({
            objectives: [textObjective("t1", "b")],
            requires: ["ch-a"]
          })
        }
      ]
    });
    expect(result.ok).toBe(false);
    expect(result.reasons).toContain("missing_final_target");
  });

  it("rejects routes with unreachable challenges", () => {
    const result = validateEventForPublish({
      settingsJson: settings,
      startsAt: null,
      endsAt: null,
      challengeCount: 3,
      challenges: [
        { id: "ch-a", configurationJson: challengeJson({ objectives: [textObjective("t1", "a")], isTerminal: true }) },
        {
          id: "ch-b",
          configurationJson: challengeJson({
            objectives: [textObjective("t1", "b")],
            requires: ["ch-c"]
          })
        },
        {
          id: "ch-c",
          configurationJson: challengeJson({
            objectives: [textObjective("t1", "c")],
            requires: ["ch-b"]
          })
        }
      ]
    });
    expect(result.ok).toBe(false);
    expect(result.reasons).toContain("unreachable:ch-b");
    expect(result.reasons).toContain("unreachable:ch-c");
  });

  it("rejects routes with direct dependency cycles", () => {
    const result = validateEventForPublish({
      settingsJson: settings,
      startsAt: null,
      endsAt: null,
      challengeCount: 2,
      challenges: [
        {
          id: "ch-a",
          configurationJson: challengeJson({
            objectives: [textObjective("t1", "a")],
            requires: ["ch-b"]
          })
        },
        {
          id: "ch-b",
          configurationJson: challengeJson({
            objectives: [textObjective("t1", "b")],
            requires: ["ch-a"],
            isTerminal: true
          })
        }
      ]
    });
    expect(result.ok).toBe(false);
    expect(result.reasons).toContain("dependency_cycle:ch-a->ch-b->ch-a");
  });

  it("rejects branches with no completion path for a value", () => {
    const decisionObjective: Record<string, unknown> = {
      key: "route",
      type: "decision",
      prompt: "Choose a route",
      required: false,
      dependsOn: [],
      choices: [
        { id: "left", label: "Left path" },
        { id: "right", label: "Right path" }
      ],
      eventPoints: 0,
      platformCredits: 0,
      hints: []
    };
    const result = validateEventForPublish({
      settingsJson: settings,
      startsAt: null,
      endsAt: null,
      challengeCount: 2,
      challenges: [
        { id: "ch-d", configurationJson: challengeJson({ objectives: [decisionObjective] }) },
        {
          id: "ch-l",
          configurationJson: challengeJson({
            objectives: [textObjective("t1", "l")],
            requiresDecision: { challengeId: "ch-d", objectiveKey: "route", value: "left" },
            isTerminal: true
          })
        }
      ]
    });
    expect(result.ok).toBe(false);
    expect(result.reasons).toContain("branch_without_path:ch-d:route:right");
  });

  it("accepts a valid chain ending at a terminal", () => {
    expect(
      validateEventForPublish({
        settingsJson: settings,
        startsAt: null,
        endsAt: null,
        challengeCount: 2,
        challenges: [
          {
            id: "ch-a",
            configurationJson: challengeJson({ objectives: [textObjective("t1", "a")] })
          },
          {
            id: "ch-b",
            configurationJson: challengeJson({
              objectives: [textObjective("t1", "b")],
              requires: ["ch-a"],
              isTerminal: true
            })
          }
        ]
      })
    ).toEqual({ ok: true });
  });
});

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
    return this.db.handleAll(this.query, this.params).then((results) => ({ results }));
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
    challenges: [],
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
    if (query.includes("FROM sessions s")) {
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
    if (query.includes("FROM events WHERE id = ?")) {
      return this.table("events").find((row) => row["id"] === params[0]) ?? null;
    }
    throw new Error(`unsupported first query: ${query}`);
  }

  async handleAll(query: string, params: Array<unknown>): Promise<Array<Row>> {
    if (query.includes("FROM challenges WHERE event_id = ?")) {
      return this.table("challenges")
        .filter((row) => row["event_id"] === params[0])
        .sort((left, right) => Number(left["position"]) - Number(right["position"]));
    }
    throw new Error(`unsupported all query: ${query}`);
  }

  async handleRun(query: string, params: Array<unknown>): Promise<unknown> {
    if (query.startsWith("UPDATE sessions SET last_seen_at")) {
      const row = this.table("sessions").find((entry) => entry["id"] === params[2]);
      if (row !== undefined) {
        row["last_seen_at"] = params[0];
        row["expires_at"] = params[1];
      }
      return { success: true };
    }
    if (query.startsWith("UPDATE events SET status")) {
      const row = this.table("events").find((entry) => entry["id"] === params[params.length - 1]);
      if (row !== undefined) {
        row["status"] = params[0];
        row["updated_at"] = params[1];
      }
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
  return { DB: db, MEDIA: mediaBinding, ADMIN_EMAILS: "admin@example.com" };
}

function routeConfig(objectives: Array<Record<string, unknown>>, extra?: Record<string, unknown>): string {
  return JSON.stringify({ objectives, ...(extra ?? {}) });
}

async function seedPublishWorld(broken: boolean): Promise<{ db: FakeDb; token: string }> {
  const db = new FakeDb();
  const now = new Date().toISOString();
  db.table("users").push({
    id: "admin",
    auth_provider_id: "auth-admin",
    email: "admin@example.com",
    email_verified: 1,
    username: "organiser",
    display_name: null,
    platform_credits: 0,
    presence_visibility: "visible",
    created_at: now,
    updated_at: now
  });
  db.table("events").push({
    id: "ev1",
    name: "Route Night",
    slug: "route-night",
    description: null,
    status: "draft",
    starts_at: null,
    ends_at: null,
    settings_json: "{}",
    created_by: "admin",
    created_at: now,
    updated_at: now
  });
  db.table("challenges").push(
    {
      id: "ch-a",
      event_id: "ev1",
      title: "Alpha",
      description: null,
      position: 1,
      configuration_json: routeConfig([textObjective("t1", "alpha")]),
      created_at: now,
      updated_at: now
    },
    {
      id: "ch-b",
      event_id: "ev1",
      title: "Beta",
      description: null,
      position: 2,
      configuration_json: routeConfig([textObjective("t1", "beta")], {
        requires: broken ? ["ghost"] : ["ch-a"],
        isTerminal: true
      }),
      created_at: now,
      updated_at: now
    }
  );
  const token = "token-admin";
  db.table("sessions").push({
    id: "sess-admin",
    user_id: "admin",
    token_hash: await sha256Hex(token),
    device_label: null,
    ip_hash: null,
    created_at: now,
    last_seen_at: now,
    expires_at: new Date(Date.now() + 3600_000).toISOString(),
    revoked_at: null
  });
  return { db, token };
}

const publishErrorSchema = z
  .object({
    code: z.string(),
    message: z.string(),
    details: z.object({ reasons: z.array(z.string()) }).catchall(z.unknown())
  })
  .catchall(z.unknown());

describe("publish route-graph rejection", () => {
  it("rejects a broken route with CONFLICT and machine-readable reasons", async () => {
    const seed = await seedPublishWorld(true);
    const res = await app.request(
      "/api/admin/events/ev1/publish",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: `cmp_session=${seed.token}` },
        body: JSON.stringify({})
      },
      testEnv(seed.db)
    );
    expect(res.status).toBe(409);
    const parsed = publishErrorSchema.safeParse(await res.json());
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.code).toBe("CONFLICT");
      expect(parsed.data.details.reasons).toContain("missing_prerequisite:ch-b:ghost");
    }
    expect(seed.db.table("audit_log")).toHaveLength(0);
  });

  it("publishes a valid route", async () => {
    const seed = await seedPublishWorld(false);
    const res = await app.request(
      "/api/admin/events/ev1/publish",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: `cmp_session=${seed.token}` },
        body: JSON.stringify({})
      },
      testEnv(seed.db)
    );
    expect(res.status).toBe(200);
    const parsed = z
      .object({ event: z.object({ status: z.string() }).catchall(z.unknown()) })
      .safeParse(await res.json());
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.event.status).toBe("scheduled");
    }
  });
});
