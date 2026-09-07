# Session 04 — Staging proof, D1 fix, progression, auto-deploy (2026-09-06/07)

One continuous arc, logged once: take the backend live on Cloudflare
staging, fix what staging exposes, harden progression, automate staging
deploys.

## Staging proof

- Wrangler already logged in (`goeltanmay442@gmail.com`). Provisioned D1
  `campus-mystery-{dev,staging,production}` (APAC) + R2
  `campus-mystery-media-{dev,staging,production}`. Real IDs in
  `wrangler.jsonc`; `--local` still uses local state.
- Remote staging migration: `0001_init.sql`, 29 commands, success.
- First deploy (v`5abd8004`) with `--var ADMIN_EMAILS:<account email>`
  (flag only, not committed). Live proof: health 200 staging, unknown
  event 404, admin POST 401 — but `GET /api/events` returned INTERNAL.

## D1 `.all()` fix (found by staging, fixed locally)

- Root cause: real D1 `.all()` resolves `{results:[...]}`; code and fakes
  assumed a bare array. Fixed with honest `all()` type in `env.ts`, 20
  production sites unwrapping `.results`, all test fakes resolving
  `{results}`. `.first()`/`.run()`/`.batch()` verified compatible.
- Fixed flaky Clerk tamper test (last-char base64url flip can be a no-op;
  now corrupts first signature char). Worker suite 93/93 three straight runs.

## Progression hardening

- Unlock model: `requires`, `availableFrom`/`availableUntil`,
  `hiddenUntilUnlocked`, `requiresDecision {challengeId, objectiveKey,
  value}`, `isTerminal`; pure `isChallengeUnlocked()` for open/sequential/
  dependency/branch/scheduled/hidden + combinations.
- Enforcement: hidden-locked omitted, visible-locked shelled, locked
  submit/verify/hint/session -> OBJECTIVE_LOCKED; decision submit records
  choice; location routes enforce challenge locks without leaking guidance.
- Publish validation: missing prerequisites, unreachable, direct cycles,
  branch-without-path, missing final target (single root exempt) with
  machine-readable `details.reasons`.
- First attempt died on provider 429; partial work survived, completion run
  finished it.

## Staging trigger + verification

- `staging` branch created; `.github/workflows/deploy-staging.yml` runs
  install/typecheck/lint/test, remote staging migration, and deploy on
  push-to-`staging` (plus manual dispatch). First run proved the mechanism,
  failing only on missing `CLOUDFLARE_API_TOKEN` — GitHub issue #1 tracks it
  (OAuth cannot mint tokens, 403).
- Manual deploy v`16652d57` (user-approved) from `staging`. Live curl:
  health 200, events list 200 `{"events":[]}` (fix confirmed on real D1),
  unknown event 404, admin POST 401, `/` 404 (API only, no SPA).
- `STAGING_ADMIN_EMAILS` repo variable set by main agent.

## Decisions

- Staging admin = Cloudflare account email until told otherwise.
- Turnstile unconfigured (open mode) until keys exist.
- Docs-only commits go to `main`; `staging` stays pinned at the deployed
  commit until the next approved deploy.
- SPA stays undeployed; frontend wiring deferred with UI work.

## Verification

- Local: typecheck 4/4, lint, build pass; tests 153/153 (worker 137).
- Live curl set above, all as designed.

## Known gaps / debt

- Auto-deploy red until the token secret lands (issue #1).
- Clerk `email`/`email_verified` token-template claims still user-side
  pending; live login click-through unproven.
- Production empty and untouched. Legacy `{providerToken}` still accepted.
