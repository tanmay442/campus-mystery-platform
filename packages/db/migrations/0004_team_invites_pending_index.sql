-- Migration 0004_team_invites_pending_index: one pending join request per user
-- per team. Concurrent double-clicks collapse into a single row instead of
-- two approvable pendings. Applies to Cloudflare D1 (SQLite).

CREATE UNIQUE INDEX "idx_team_invites_pending_request"
  ON "team_invites" ("participant_id", "requested_user_id")
  WHERE "status" = 'pending' AND "requested_user_id" IS NOT NULL;
