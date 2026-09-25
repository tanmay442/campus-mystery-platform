# Session 05 — Admin ops: challenge CRUD, manual completion, penalties (2026-09-25)

## Goal

Finish the remaining Phase 1 admin backend operations (the six 501 stubs in
`apps/worker/src/modules/admin.ts`) with tests, keeping everything
server-authoritative per PRD §5.1/§10.4/§21.

## Work done

- UI plan parked (not executed): the user's Astryx/Trophy/DecryptedText
  instructions were written to `/tmp/opencode/campus-mystery-ui-plan.md`
  (outside the repo). No UI dependencies installed, no UI files touched.
- `packages/db/schema.ts` + `schema.test.ts`: new `penalties` table
  (id, participant_id, admin_user_id, seconds > 0, reason, waived 0/1,
  created/updated_at, waived_at). Table count 11 → 12.
- `packages/db/migrations/0002_penalties.sql`: creates `penalties` plus
  indexes, in the 0001 style. Applied locally (`pnpm db:apply:local`) and to
  the staging D1 only (`campus-mystery-staging`, verified via table list).
  No other Cloudflare resources touched; production untouched.
- `apps/worker/src/modules/admin.ts`: implemented all six stubs —
  - `POST /api/admin/events/:eventId/challenges` (201; config validated
    server-side, duplicate objective keys rejected, position defaults to
    max+1, `confirmLiveEdit` honored on live/paused events).
  - `PATCH /api/admin/challenges/:challengeId` (title/description free;
    configuration/position changes on live/paused require confirmLiveEdit).
  - `DELETE /api/admin/challenges/:challengeId` (challenge row removed,
    earned `objective_progress` rows preserved per PRD §24.8).
  - `POST /api/admin/objectives/:objectiveId/manual-completion`
    (`:objectiveId` is the objective key scoped by `challengeId` in the
    body; live events only; reuses `completeObjective` so points, credits,
    finish timestamp and idempotency behave exactly like player submits;
    `decision` objectives rejected; `completed_by` records the admin).
  - `POST /api/admin/participants/:participantId/penalties`
    (seconds 1–86400, atomic penalty-row insert + `penalty_seconds`
    increment + audit; archived events read-only).
  - `POST /api/admin/penalties/:penaltyId/waive` (marks waived, decrements
    with `MAX(0, …)` floor, double-waive → CONFLICT; all audited).
  - Helpers: `structuralEditGuard` (completed/archived read-only,
    live/paused need confirmation), `adminChallenge` (full config — admin
    eyes only, player endpoints still sanitize), `penaltyView`,
    `findChallengeById`/`findParticipantById`/`findPenaltyById`.
- `apps/worker/src/modules/adminOps.test.ts` (new, 11 tests): CRUD incl.
  position append, invalid/duplicate config, live-edit confirmation split,
  delete preserving progress, read-only completed events, non-admin 403;
  manual completion incl. rewards/credits/audit, replay without double
  rewards, decision rejection, event/objective mismatch, paused/scheduled
  gates; penalties incl. apply/waive round-trip, zero floor, input
  validation, archived read-only.

## Decisions

- New `penalties` table instead of deriving penalty identity from
  `audit_log`: the PRD routes (`.../penalties`, `.../penalties/:penaltyId/waive`)
  demand addressable penalty entities; `participants.penalty_seconds` stays
  the ranking source of truth (leaderboard untouched).
- Manual completion reuses `completeObjective` rather than a parallel writer,
  so reward/credit/finish/idempotency semantics cannot drift from the player
  path. Credit ledger rows keep reason `credit_reward`; the manual
  provenance lives in `data_json` (`manualCompletion`, `manualBy`,
  `manualNote`) and the `objective.manual_completion` audit entry.
- Penalties/waivers allowed in `completed` events (pre-final corrections per
  PRD §14) but blocked in `archived`; manual completion is live-only, same
  gate as player submissions. Challenge structural edits on live/paused
  require `confirmLiveEdit`.
- No reversal endpoint: PRD §19.5 lists manual-completion but no reverse
  route, so it stays a documented gap rather than an invented API.

## Verification

- `pnpm typecheck` 4/4, `pnpm lint`, `pnpm build` pass.
- `pnpm test`: 164/164 (shared 9, db 1, web 6, worker 148 incl. 11 new).
- `pnpm db:apply:local`: 0001 + 0002 success.
- Wrangler (staging D1 only): `d1 migrations apply DB --remote --env staging`
  → `0002_penalties.sql` ✅; table list confirms `penalties` present.
- NOT verified: live HTTP exercise of the new routes on staging (staging
  branch still pinned at the previous deploy; no redeploy done — needs user
  approval per freeze policy).

## Known gaps / debt

- `staging` branch not updated and staging Worker not redeployed: new routes
  return 501 there until the next approved deploy (auto-deploy still red,
  issue #1 — missing `CLOUDFLARE_API_TOKEN`).
- Production D1 has no migration and was intentionally not touched.
- No completion-reversal route (see Decisions); admin UI forms still
  placeholders (UI track parked); presence endpoints still 501 (Phase 3).
- Clerk `email`/`email_verified` token-template claims still user-side
  pending; Turnstile still open mode.

## Next session

User-approved staging deploy (merge `main` → `staging`, or manual
`wrangler deploy --env staging`), then live curl of the six routes; or start
the parked UI track (`/tmp/opencode/campus-mystery-ui-plan.md`) beginning
with Astryx install + `cli init`. Touches `.github/workflows/` (deploy only
with approval) or `apps/web/*` respectively.
