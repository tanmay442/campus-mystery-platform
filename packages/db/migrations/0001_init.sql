-- Migration 0001_init: baseline schema for the campus mystery platform.
-- Applies to Cloudflare D1 (SQLite). Applied via wrangler d1 migrations apply.

CREATE TABLE "users" (
  "id" TEXT PRIMARY KEY,
  "auth_provider_id" TEXT NOT NULL UNIQUE,
  "email" TEXT NOT NULL,
  "email_verified" INTEGER NOT NULL CHECK ("email_verified" IN (0, 1)),
  "username" TEXT NOT NULL UNIQUE,
  "display_name" TEXT,
  "platform_credits" INTEGER NOT NULL DEFAULT 0,
  "presence_visibility" TEXT NOT NULL DEFAULT 'visible'
    CHECK ("presence_visibility" IN ('visible', 'count_only', 'hidden')),
  "created_at" TEXT NOT NULL,
  "updated_at" TEXT NOT NULL
);

CREATE TABLE "events" (
  "id" TEXT PRIMARY KEY,
  "name" TEXT NOT NULL,
  "slug" TEXT NOT NULL UNIQUE,
  "description" TEXT,
  "status" TEXT NOT NULL,
  "starts_at" TEXT,
  "ends_at" TEXT,
  "settings_json" TEXT NOT NULL,
  "created_by" TEXT NOT NULL REFERENCES "users"("id"),
  "created_at" TEXT NOT NULL,
  "updated_at" TEXT NOT NULL
);
CREATE INDEX "idx_events_created_by" ON "events" ("created_by");

CREATE TABLE "participants" (
  "id" TEXT PRIMARY KEY,
  "event_id" TEXT NOT NULL REFERENCES "events"("id"),
  "type" TEXT NOT NULL CHECK ("type" IN ('solo', 'team')),
  "name" TEXT NOT NULL,
  "event_points" INTEGER NOT NULL DEFAULT 0,
  "penalty_seconds" INTEGER NOT NULL DEFAULT 0,
  "started_at" TEXT,
  "completed_at" TEXT,
  "created_at" TEXT NOT NULL,
  "updated_at" TEXT NOT NULL
);
CREATE INDEX "idx_participants_event_id" ON "participants" ("event_id");

CREATE TABLE "participant_members" (
  "id" TEXT PRIMARY KEY,
  "participant_id" TEXT NOT NULL REFERENCES "participants"("id"),
  "user_id" TEXT NOT NULL REFERENCES "users"("id"),
  "role" TEXT NOT NULL DEFAULT 'member',
  "joined_at" TEXT NOT NULL,
  "left_at" TEXT
);
CREATE INDEX "idx_participant_members_participant_id" ON "participant_members" ("participant_id");
CREATE INDEX "idx_participant_members_user_id" ON "participant_members" ("user_id");

CREATE TABLE "team_invites" (
  "id" TEXT PRIMARY KEY,
  "participant_id" TEXT NOT NULL REFERENCES "participants"("id"),
  "invited_by" TEXT NOT NULL REFERENCES "users"("id"),
  "token_hash" TEXT,
  "requested_user_id" TEXT REFERENCES "users"("id"),
  "status" TEXT NOT NULL,
  "expires_at" TEXT,
  "created_at" TEXT NOT NULL,
  "updated_at" TEXT NOT NULL
);
CREATE INDEX "idx_team_invites_participant_id" ON "team_invites" ("participant_id");
CREATE INDEX "idx_team_invites_invited_by" ON "team_invites" ("invited_by");
CREATE INDEX "idx_team_invites_requested_user_id" ON "team_invites" ("requested_user_id");

CREATE TABLE "challenges" (
  "id" TEXT PRIMARY KEY,
  "event_id" TEXT NOT NULL REFERENCES "events"("id"),
  "title" TEXT NOT NULL,
  "description" TEXT,
  "position" INTEGER NOT NULL,
  "configuration_json" TEXT NOT NULL,
  "created_at" TEXT NOT NULL,
  "updated_at" TEXT NOT NULL
);
CREATE INDEX "idx_challenges_event_id" ON "challenges" ("event_id");

CREATE TABLE "objective_progress" (
  "id" TEXT PRIMARY KEY,
  "participant_id" TEXT NOT NULL REFERENCES "participants"("id"),
  "challenge_id" TEXT NOT NULL REFERENCES "challenges"("id"),
  "objective_key" TEXT NOT NULL,
  "status" TEXT NOT NULL
    CHECK ("status" IN ('locked', 'available', 'in_progress', 'completed')),
  "completed_by" TEXT REFERENCES "users"("id"),
  "completed_at" TEXT,
  "data_json" TEXT,
  "idempotency_key" TEXT,
  "created_at" TEXT NOT NULL,
  "updated_at" TEXT NOT NULL,
  UNIQUE ("participant_id", "challenge_id", "objective_key"),
  UNIQUE ("idempotency_key")
);
CREATE INDEX "idx_objective_progress_participant_id" ON "objective_progress" ("participant_id");
CREATE INDEX "idx_objective_progress_challenge_id" ON "objective_progress" ("challenge_id");
CREATE INDEX "idx_objective_progress_participant_challenge" ON "objective_progress" ("participant_id", "challenge_id");

CREATE TABLE "credit_transactions" (
  "id" TEXT PRIMARY KEY,
  "user_id" TEXT NOT NULL REFERENCES "users"("id"),
  "event_id" TEXT REFERENCES "events"("id"),
  "amount" INTEGER NOT NULL,
  "reason" TEXT NOT NULL,
  "reference_id" TEXT,
  "created_at" TEXT NOT NULL
);
CREATE INDEX "idx_credit_transactions_user_id" ON "credit_transactions" ("user_id");
CREATE INDEX "idx_credit_transactions_event_id" ON "credit_transactions" ("event_id");

CREATE TABLE "audit_log" (
  "id" TEXT PRIMARY KEY,
  "admin_user_id" TEXT NOT NULL REFERENCES "users"("id"),
  "action" TEXT NOT NULL,
  "entity_type" TEXT NOT NULL,
  "entity_id" TEXT NOT NULL,
  "details_json" TEXT,
  "created_at" TEXT NOT NULL
);
CREATE INDEX "idx_audit_log_admin_user_id" ON "audit_log" ("admin_user_id");

CREATE TABLE "sessions" (
  "id" TEXT PRIMARY KEY,
  "user_id" TEXT NOT NULL REFERENCES "users"("id"),
  "token_hash" TEXT NOT NULL UNIQUE,
  "device_label" TEXT,
  "ip_hash" TEXT,
  "created_at" TEXT NOT NULL,
  "last_seen_at" TEXT NOT NULL,
  "expires_at" TEXT NOT NULL,
  "revoked_at" TEXT
);
CREATE INDEX "idx_sessions_user_id" ON "sessions" ("user_id");

CREATE TABLE "announcements" (
  "id" TEXT PRIMARY KEY,
  "event_id" TEXT NOT NULL REFERENCES "events"("id"),
  "title" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "created_at" TEXT NOT NULL,
  "created_by" TEXT NOT NULL REFERENCES "users"("id"),
  "published_at" TEXT
);
CREATE INDEX "idx_announcements_event_id" ON "announcements" ("event_id");
CREATE INDEX "idx_announcements_created_by" ON "announcements" ("created_by");
