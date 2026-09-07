# Session 05 — Progression hardening + staging trigger (2026-09-07)

## Goal

Enforce the PRD unlock graph server-side and make every `staging`-branch
commit auto-deploy to Cloudflare staging.

## Work done

- Unlock model (`shared/challenges.ts`, `modules/challenges.ts`,
  `modules/location.ts`): `requires`, `availableFrom`/`availableUntil`,
  `hiddenUntilUnlocked`, `requiresDecision {challengeId, objectiveKey,
  value}`, `isTerminal`; pure `isChallengeUnlocked()`; hidden-locked
  omitted, visible-locked shelled, locked submit/verify/hint/session ->
  OBJECTIVE_LOCKED (decision submit records choice instead of 501).
- Publish validation (`modules/admin.ts`): missing prerequisites,
  unreachable, direct cycles, branch-without-path, missing final target
  (single root exempt); machine-readable `details.reasons`.
- `.github/workflows/deploy-staging.yml` (NEW): push-to-`staging` or manual
  dispatch -> install, typecheck, lint, test, remote staging migration,
  `wrangler deploy --env staging` with `ADMIN_EMAILS` from repo variable
  `STAGING_ADMIN_EMAILS`. Needs repo secret `CLOUDFLARE_API_TOKEN`
  (Workers Scripts Edit + D1 Edit) — user-side pending.
- First hardening attempt died on provider 429; partial work survived and a
  completion run finished it.

## Decisions

- `location-session` on locked challenges returns 403/404, never guidance
  text (leak prevention over status uniformity).
- Invalid `nowIso` locks rather than opens (fail closed).
- `isTerminal` only (no `finalChallengeIds` alternative).
- `gh variable set STAGING_ADMIN_EMAILS` done by main agent; Cloudflare
  API-token minting attempted via OAuth and refused (403) — user creates it.

## Verification

- Local: typecheck 4/4, lint, build pass; tests 153/153 (worker 137).
- Staging branch push fires the trigger; live curl + log tail follow in
  session 06 (or appended here once the run completes).

## Known gaps / debt

- `CLOUDFLARE_API_TOKEN` secret missing -> first trigger run will fail at
  deploy step until user adds it.
- Clerk token-template claims still user-side pending; live login
  click-through unproven.
- Staging serves pre-fix build until the trigger's first green deploy.
- Legacy `{providerToken}` login shape still accepted.

## Next session

Watch/fix trigger run, curl-verify staging (health, events list now 200,
404, 401), tail invocation logs; then remaining admin backend
(challenge CRUD, manual completion, waivers).
