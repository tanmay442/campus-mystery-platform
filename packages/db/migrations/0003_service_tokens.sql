-- Migration 0003_service_tokens: scoped bearer tokens for programmatic admin
-- access (PRD §17.3). Browser admins keep cookie sessions; automation uses
-- these tokens. Only the SHA-256 hash is stored; plaintext is shown once at
-- issuance. Applies to Cloudflare D1 (SQLite).

CREATE TABLE "service_tokens" (
  "id" TEXT PRIMARY KEY,
  "name" TEXT NOT NULL,
  "token_hash" TEXT NOT NULL UNIQUE,
  "scopes_json" TEXT NOT NULL,
  "created_by" TEXT NOT NULL REFERENCES "users"("id"),
  "revoked_at" TEXT,
  "created_at" TEXT NOT NULL
);
CREATE INDEX "idx_service_tokens_created_by" ON "service_tokens" ("created_by");
