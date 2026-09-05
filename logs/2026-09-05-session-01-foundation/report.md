# Session 01 — Foundation (2026-09-05)

## Goal

Initialize the repo, push it to GitHub, and build the full Phase 1 production
foundation (monorepo, API, DB, web PWA, shared contracts) per the PRD.

## Work done

- Monorepo skeleton: `package.json` (pnpm workspaces), `tsconfig.base.json`
  (strict: `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, no `any`
  on boundaries), CI workflow, `.nvmrc` (22), `.editorconfig`, `README.md`,
  `docs/phase-1.md` (scope map, fixed defaults, module map).
- `packages/db` (`@campus/db`, Drizzle): 11 tables — the 9 PRD §18 tables with
  exact column names and both `objective_progress` uniqueness constraints,
  plus `sessions` (2-device policy, §17.4) and `announcements` (live ops).
  `migrations/0001_init.sql` (29 statements) applies cleanly to local D1.
- `packages/shared` (`@campus/shared`, zod): 23 error codes + HTTP mapping,
  event lifecycle/participation/winner/progression enums, event settings
  schema, all 10 objective types, location params with PRD defaults,
  `bandForDistance()`, team constants (size 5, cooldown 600s, penalty 300s),
  `FIXED_DEFAULTS` covering every PRD §29 row.
- `apps/worker` (`@campus/worker`, Hono): every PRD §19 route mounted;
  session-cookie auth, admin allowlist (verified email vs `ADMIN_EMAILS`,
  timing-safe), sliding-window rate limit, idempotency-key capture middleware;
  `GET /api/health`; zod-validated stubs returning 501 envelopes (logic lands
  in later sessions); `wrangler.jsonc` with dev/staging/production envs, D1 +
  R2 bindings, observability on.
- `apps/web` (`@campus/web`, React 19 + Vite + PWA): landing, login,
  onboarding, event centre, challenge view, leaderboard, team page, guarded
  `/admin/*`; `TargetSignal` bands verbatim from PRD §11.2/11.3; typed API
  client with `Idempotency-Key: crypto.randomUUID()`; 15s live polling;
  installable manifest + generated compass icons
  (`public/icons/icon.svg`, `icon-192.png`, `icon-512.png`).
- GitHub repo `tanmay442/campus-mystery-platform` (private) created; `main`
  pushed. Git auth here uses `gh` credential helper (machine SSH key denied).
- This log system: `logs/README.md`, `logs/vision/` (PRD copy), this report.

## Decisions

- One Worker serving API + SPA assets; modular monolith, no microservices.
- Source-export workspace packages (`src/index.ts`, like `@campus/db`) instead
  of `dist` builds — removes build-ordering bugs; bundlers handle TS fine.
- Vitest pinned to 2.1.x everywhere (pool-workers 0.5.41 peer range); web Vite
  aligned to v5 (vitest 2's Vite) after a v5/v6 type clash.
- Local-only placeholder D1 `database_id` (`000…000`) so `dev`/`--local` run
  credential-free; real IDs land at Cloudflare provisioning (Phase 0).
- Auth foundation is session-cookie + pluggable provider; email-OTP/OAuth
  choice deferred to the auth session.

## Verification

- `pnpm typecheck` — 4/4 projects pass.
- `pnpm test` — 19/19 pass (shared 9, db 1, web 6, worker 3).
- `pnpm build` — all pass; web PWA precaches 11 entries.
- `pnpm db:apply:local` — `0001_init.sql`, 29 commands, success.

## Known gaps / debt

- Worker route handlers are validated stubs (501); no game logic yet.
- No Cloudflare account wired: no real D1/R2 IDs, no Turnstile keys, empty
  `ADMIN_EMAILS`, no auth provider (see Phase 0 below).
- Web `ApiErrorCode` union duplicates (subset of) shared error enum; dedupe
  when web imports `@campus/shared`.
- `errorResponse()` takes `_c` (reserved for request-id headers later).

## Next session

Phase 0: `wrangler login`, `wrangler d1 create` (dev/staging/prod) + R2
buckets, fill real IDs into `apps/worker/wrangler.jsonc`, set Turnstile +
`ADMIN_EMAILS`, choose auth provider (email-OTP vs OAuth). Touches only
`apps/worker/wrangler.jsonc`, `.dev.vars`, and `docs/phase-1.md` checkboxes.
Then Phase 1 logic starts with auth sessions (`apps/worker/src/modules/auth/`,
`sessions` table, `apps/web/src/routes/Login.tsx`, `src/lib/session.ts`).
