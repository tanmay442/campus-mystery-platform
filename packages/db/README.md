# @campus/db

D1 database foundation for the campus mystery platform: Drizzle `sqlite-core`
schema (`schema.ts`) plus hand-written versioned SQL migrations (`migrations/`).

## Scripts

- `pnpm generate` — snapshot `schema.ts` into a new `migrations/` file via
  `drizzle-kit generate`. Used only for new schema changes after `0001_init.sql`.
- `pnpm typecheck` / `pnpm lint` — strict `tsc --noEmit` (no `any`, no `as` casts).
- `pnpm test` — vitest smoke test guarding every exported table.
- `pnpm build` — emits `dist/` declarations for workspace consumers.

## Applying migrations

Migrations run from `apps/worker` (the wrangler project that owns the D1 binding):

```bash
pnpm --filter @campus/worker db:apply:local     # local D1
wrangler d1 migrations apply <DB_NAME> --remote # staging / production
```

## Versioning rule

Never edit a migration that has been applied anywhere. Every schema change ships
as a new numbered file (`0002_<name>.sql`, …). `0001_init.sql` is frozen baseline.

## JSON columns

`settings_json`, `configuration_json`, `data_json` and `details_json` stay TEXT
holding JSON. Their shapes are owned and validated by zod schemas in
`@campus/shared`; this package stores them opaquely and never parses them.

## Tables beyond PRD §18

- `sessions` enforces the 2-device policy (PRD §17.4): at most two non-expired,
  non-revoked rows per user; `token_hash` is unique for constant-time lookup.
- `announcements` backs live-ops event announcements from the admin live room.

## FK / index rationale

Every `REFERENCES` column has an index so joins and membership lookups avoid full
table scans at 400-participant scale. `UNIQUE` constraints already index
`auth_provider_id`, `username`, `slug`, `token_hash` and `idempotency_key`, so no
duplicate indexes are created for those. The composite
`(participant_id, challenge_id)` index covers per-challenge progress reads; the
`(participant_id, challenge_id, objective_key)` unique constraint plus the
`idempotency_key` unique constraint make concurrent team submissions converge on
one stored completion instead of double rewards.
