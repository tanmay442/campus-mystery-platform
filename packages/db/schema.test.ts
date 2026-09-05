import { getTableName } from "drizzle-orm";
import type { SQLiteTable } from "drizzle-orm/sqlite-core";
import { describe, expect, it } from "vitest";
import * as schema from "./schema";

const expectedTables: Array<[SQLiteTable, string]> = [
  [schema.users, "users"],
  [schema.events, "events"],
  [schema.participants, "participants"],
  [schema.participantMembers, "participant_members"],
  [schema.teamInvites, "team_invites"],
  [schema.challenges, "challenges"],
  [schema.objectiveProgress, "objective_progress"],
  [schema.creditTransactions, "credit_transactions"],
  [schema.auditLog, "audit_log"],
  [schema.sessions, "sessions"],
  [schema.announcements, "announcements"],
];

describe("schema", () => {
  it("exports every expected table", () => {
    expect(expectedTables).toHaveLength(11);
    for (const [table, name] of expectedTables) {
      expect(table).toBeDefined();
      expect(getTableName(table)).toBe(name);
    }
  });
});
