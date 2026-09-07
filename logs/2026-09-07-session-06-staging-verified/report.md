# Session 06 — Staging verified (2026-09-07)

## Goal

Cut the `staging` branch, prove the auto-deploy trigger, verify the new
build live.

## Work done

- `staging` branch created from main and pushed. Trigger fired on first
  push: CI steps (install, typecheck, lint, test) passed, deploy job failed
  only on missing `CLOUDFLARE_API_TOKEN` — mechanism proven, secret pending.
- GitHub issue #1 opened for the token (exact dashboard steps inside).
- Manual `wrangler deploy --env staging` (user-approved), version
  `16652d57`, from the `staging` branch. No migration needed (no schema
  changes since session 04).
- Live verification with curl: health 200 staging, events list 200
  `{"events":[]}`, unknown event 404, admin POST 401, `/` 404 (API only,
  no SPA deployed). Tail captured no errors.
- `docs/cloudflare.md` updated (worker version, verification, issue #1).

## Decisions

- Docs-only commits go to `main`; `staging` branch stays pinned at the
  deployed commit until the next approved deploy.
- SPA stays undeployed (frontend wiring is a later phase, UI work
  explicitly deferred).

## Verification

- Local suite before push: 153/153 (session 05).
- Live curl set above, all as designed. The `.results` fix is confirmed
  working against real D1.

## Known gaps / debt

- Auto-deploy red until the token secret lands (issue #1).
- Clerk claims + live login click-through still pending (user-side).
- Production empty and untouched.

## Next session (user order)

Remaining admin backend: challenge CRUD, manual completion, penalty
waivers. No UI. No hosted touches without explicit approval.
