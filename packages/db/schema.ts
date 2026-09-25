import { sql } from "drizzle-orm";
import {
  check,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const users = sqliteTable(
  "users",
  {
    id: text("id").primaryKey(),
    authProviderId: text("auth_provider_id").notNull().unique(),
    email: text("email").notNull(),
    emailVerified: integer("email_verified").notNull(),
    username: text("username").notNull().unique(),
    displayName: text("display_name"),
    platformCredits: integer("platform_credits").notNull().default(0),
    presenceVisibility: text("presence_visibility").notNull().default("visible"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    check(
      "users_presence_visibility_check",
      sql`${table.presenceVisibility} IN ('visible', 'count_only', 'hidden')`,
    ),
    check(
      "users_email_verified_check",
      sql`${table.emailVerified} IN (0, 1)`,
    ),
  ],
);

export const events = sqliteTable("events", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  description: text("description"),
  status: text("status").notNull(),
  startsAt: text("starts_at"),
  endsAt: text("ends_at"),
  settingsJson: text("settings_json").notNull(),
  createdBy: text("created_by")
    .notNull()
    .references(() => users.id),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const participants = sqliteTable(
  "participants",
  {
    id: text("id").primaryKey(),
    eventId: text("event_id")
      .notNull()
      .references(() => events.id),
    type: text("type").notNull(),
    name: text("name").notNull(),
    eventPoints: integer("event_points").notNull().default(0),
    penaltySeconds: integer("penalty_seconds").notNull().default(0),
    startedAt: text("started_at"),
    completedAt: text("completed_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    check(
      "participants_type_check",
      sql`${table.type} IN ('solo', 'team')`,
    ),
  ],
);

export const participantMembers = sqliteTable("participant_members", {
  id: text("id").primaryKey(),
  participantId: text("participant_id")
    .notNull()
    .references(() => participants.id),
  userId: text("user_id")
    .notNull()
    .references(() => users.id),
  role: text("role").notNull().default("member"),
  joinedAt: text("joined_at").notNull(),
  leftAt: text("left_at"),
});

export const teamInvites = sqliteTable("team_invites", {
  id: text("id").primaryKey(),
  participantId: text("participant_id")
    .notNull()
    .references(() => participants.id),
  invitedBy: text("invited_by")
    .notNull()
    .references(() => users.id),
  tokenHash: text("token_hash"),
  requestedUserId: text("requested_user_id").references(() => users.id),
  status: text("status").notNull(),
  expiresAt: text("expires_at"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const challenges = sqliteTable("challenges", {
  id: text("id").primaryKey(),
  eventId: text("event_id")
    .notNull()
    .references(() => events.id),
  title: text("title").notNull(),
  description: text("description"),
  position: integer("position").notNull(),
  configurationJson: text("configuration_json").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const objectiveProgress = sqliteTable(
  "objective_progress",
  {
    id: text("id").primaryKey(),
    participantId: text("participant_id")
      .notNull()
      .references(() => participants.id),
    challengeId: text("challenge_id")
      .notNull()
      .references(() => challenges.id),
    objectiveKey: text("objective_key").notNull(),
    status: text("status").notNull(),
    completedBy: text("completed_by").references(() => users.id),
    completedAt: text("completed_at"),
    dataJson: text("data_json"),
    idempotencyKey: text("idempotency_key"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    check(
      "objective_progress_status_check",
      sql`${table.status} IN ('locked', 'available', 'in_progress', 'completed')`,
    ),
    uniqueIndex("objective_progress_participant_challenge_key").on(
      table.participantId,
      table.challengeId,
      table.objectiveKey,
    ),
    uniqueIndex("objective_progress_idempotency_key").on(
      table.idempotencyKey,
    ),
  ],
);

export const creditTransactions = sqliteTable("credit_transactions", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id),
  eventId: text("event_id").references(() => events.id),
  amount: integer("amount").notNull(),
  reason: text("reason").notNull(),
  referenceId: text("reference_id"),
  createdAt: text("created_at").notNull(),
});

export const penalties = sqliteTable(
  "penalties",
  {
    id: text("id").primaryKey(),
    participantId: text("participant_id")
      .notNull()
      .references(() => participants.id),
    adminUserId: text("admin_user_id")
      .notNull()
      .references(() => users.id),
    seconds: integer("seconds").notNull(),
    reason: text("reason").notNull(),
    waived: integer("waived").notNull().default(0),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    waivedAt: text("waived_at"),
  },
  (table) => [
    check(
      "penalties_seconds_check",
      sql`${table.seconds} > 0`,
    ),
    check(
      "penalties_waived_check",
      sql`${table.waived} IN (0, 1)`,
    ),
  ],
);

export const serviceTokens = sqliteTable(
  "service_tokens",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    scopesJson: text("scopes_json").notNull(),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id),
    revokedAt: text("revoked_at"),
    createdAt: text("created_at").notNull(),
  },
);

export const auditLog = sqliteTable("audit_log", {
  id: text("id").primaryKey(),
  adminUserId: text("admin_user_id")
    .notNull()
    .references(() => users.id),
  action: text("action").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id").notNull(),
  detailsJson: text("details_json"),
  createdAt: text("created_at").notNull(),
});

export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id),
  tokenHash: text("token_hash").notNull().unique(),
  deviceLabel: text("device_label"),
  ipHash: text("ip_hash"),
  createdAt: text("created_at").notNull(),
  lastSeenAt: text("last_seen_at").notNull(),
  expiresAt: text("expires_at").notNull(),
  revokedAt: text("revoked_at"),
});

export const announcements = sqliteTable("announcements", {
  id: text("id").primaryKey(),
  eventId: text("event_id")
    .notNull()
    .references(() => events.id),
  title: text("title").notNull(),
  body: text("body").notNull(),
  createdAt: text("created_at").notNull(),
  createdBy: text("created_by")
    .notNull()
    .references(() => users.id),
  publishedAt: text("published_at"),
});
