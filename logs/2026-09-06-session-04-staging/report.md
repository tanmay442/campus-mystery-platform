# Session 04 — Staging proof + D1 shape fix (2026-09-06)

## Goal

Prove the backend live on Cloudflare staging. No Cloudflare state was to be
touched after the deploy (user constraint); all later work is local-only.

## Work done

- Wrangler already logged in (`goeltanmay442@gmail.com`). Provisioned:
  D1 `campus-mystery-{dev,staging,production}` (APAC) + R2
  `campus-mystery-media-{dev,staging,production}`. Real IDs wired into
  `apps/worker/wrangler.jsonc` (all envs; `--local` still uses local state).
- Remote staging migration applied: `0001_init.sql`, 29 commands, success.
- Deployed `campus-mystery-platform-staging` with
  `--var ADMIN_EMAILS:goeltanmay442@gmail.com` (flag only, not committed).
  Live at `https://campus-mystery-platform-staging.goeltanmay442.workers.dev`.
- Live proof: `/api/health` 200 staging+server time; unknown event 404
  EVENT_NOT_FOUND; unauthenticated admin POST 401. `GET /api/events`
  returned INTERNAL — real bug found by staging on first request.
- Root cause: real D1 `.all()` resolves `{results:[...]}`, code and fakes
  assumed a bare array. Fixed: honest `all()` type in `env.ts`, 20
  production sites unwrap `.results`, all test fakes resolve
  `{results}`. `.first()`/`.run()`/`.batch()` verified compatible, untouched.
- Fixed flaky Clerk tamper test (last-char base64url flip sometimes a
  no-op; now corrupts first signature char). Worker suite 93/93 three
  consecutive runs.

## Decisions

- Staging admin = Cloudflare account email until user says otherwise.
- Turnstile not configured on staging (open mode); keys still pending.
- Staging runs the pre-fix build; redeploy is the user's call (infra
  freeze in effect).

## Verification

- `pnpm typecheck` 4/4, `pnpm lint`, `pnpm build` pass (local).
- `pnpm test`: 109/109 (shared 9, db 1, web 6, worker 93).

## Known gaps / debt

- Staging serves pre-`.results`-fix build: list endpoints 500 there until
  a redeploy the user approves.
- Clerk token template (`email`, `email_verified`) still user-side pending;
  live click-through login unproven.
- Production DB/R2 exist but are empty and untouched; no prod deploy.
- Legacy `{providerToken}` login shape still accepted.

## Next session (user order)

Harden progression (prerequisite/branch unlock enforcement + publish
route-graph validation), then remaining admin backend (challenge CRUD,
manual completion, waivers). No UI. No hosted-infra touches without
explicit approval.
