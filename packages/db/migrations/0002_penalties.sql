-- Migration 0002_penalties: organiser-applied time penalties with waivers.
-- Applies to Cloudflare D1 (SQLite). Applied via wrangler d1 migrations apply.
-- participants.penalty_seconds remains the ranking source of truth; this table
-- gives each adjustment an identity so individual penalties can be waived
-- (POST /api/admin/penalties/:penaltyId/waive) with a full audit trail.

CREATE TABLE "penalties" (
  "id" TEXT PRIMARY KEY,
  "participant_id" TEXT NOT NULL REFERENCES "participants"("id"),
  "admin_user_id" TEXT NOT NULL REFERENCES "users"("id"),
  "seconds" INTEGER NOT NULL CHECK ("seconds" > 0),
  "reason" TEXT NOT NULL,
  "waived" INTEGER NOT NULL DEFAULT 0 CHECK ("waived" IN (0, 1)),
  "created_at" TEXT NOT NULL,
  "updated_at" TEXT NOT NULL,
  "waived_at" TEXT
);
CREATE INDEX "idx_penalties_participant_id" ON "penalties" ("participant_id");
CREATE INDEX "idx_penalties_admin_user_id" ON "penalties" ("admin_user_id");
