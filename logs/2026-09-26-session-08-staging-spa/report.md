# Session 08 — Staging full-stack deploy: Worker + SPA (2026-09-26)

## Goal

Put the whole stack on the project's Cloudflare staging resources using the
wrangler + cloudflare skills: the API Worker together with the Astryx SPA,
touching nothing outside this project's resources.

## Work done

- Followed the skill chain: wrangler skill (v4.x required → upgraded local
  wrangler 3.114 → 4.141.0 in `apps/worker`), cloudflare skill
  (`references/static-assets/configuration.md` + `gotchas.md` for the exact
  `assets` semantics; docs trusted over pre-training).
- `apps/worker/wrangler.jsonc` (`env.staging` only): added `assets`
  (`directory: ../web/dist`, `binding: ASSETS`,
  `not_found_handling: single-page-application`,
  `run_worker_first: ["/api/*"]`). Array syntax needs wrangler 4, which is
  why the upgrade came first. Dev stays API-only; production untouched.
- Rebuilt `apps/web/dist` (Clerk publishable key baked from the existing
  local `.env.local`, unchanged) and deployed
  (`wrangler deploy --env staging`, same `ADMIN_EMAILS` flag pattern as
  before): version `adbfbe0a`, 17 asset files, bindings staging D1 + R2 +
  ASSETS verified in deploy output.
- Live verification on the staging host: `/` 200 HTML (was 404),
  `/login` + `/events/abc` 200 HTML (SPA fallback works),
  `/assets/index-*.js` 200 javascript, `/api/health` 200 staging JSON,
  `/api/events` 200. Only `campus-mystery-staging` Worker/D1/R2 touched.

## Decisions

- Single Worker serving API + SPA (the repo's standing architecture
  decision) instead of a separate Pages project: no new Cloudflare
  resources created, client `/api` calls stay same-origin.
- Staging only. Production deploy still needs ADMIN_EMAILS, Clerk/turnstile
  decisions, and a user go-ahead — explicitly not done here.

## Verification

- `wrangler deploy --env staging --dry-run` clean before the real deploy.
- Live curl set above, all as designed. No `wrangler dev`/remote reads
  beyond the project's own staging resources.

## Known gaps / debt

- Production Worker/D1/R2 provisioned but never deployed or migrated.
- Authenticated live click-through still blocked on the Clerk
  `email`/`email_verified` session-claims template (user-side).
- Staging auto-deploy still red (issue #1, missing `CLOUDFLARE_API_TOKEN`).

## Next session

Trophy gamification islands and/or DecryptedText reveals, then redeploy
staging the same way and click through on a real device.
