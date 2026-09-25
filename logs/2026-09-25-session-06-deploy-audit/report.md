# Session 06 — Manual staging deploy + full PRD audit (2026-09-25)

## Goal

Manually deploy `main` to staging with the wrangler skill, verify live, then
audit the entire codebase against the vision PRD and plan next tasks.

## Work done

- Loaded the `wrangler` skill; followed it (JSON config untouched, no
  secrets in commands — `ADMIN_EMAILS` passed as `--var` from the existing
  `STAGING_ADMIN_EMAILS` repo variable, mirroring the CI workflow).
- Merged `main` (1af3845) into `staging` (fast-forward) and pushed.
- `wrangler d1 migrations apply DB --remote --env staging`: no pending
  (0002 already applied in session 05).
- `wrangler deploy --env staging`: live at
  `https://campus-mystery-platform-staging.goeltanmay442.workers.dev`,
  version `24aa55f0` (confirmed latest in `versions list`).
- Live curl: `/api/health` 200, `/api/events` 200, `POST /api/admin/events`
  401 UNAUTHENTICATED, new `POST /api/admin/participants/:id/penalties` 401
  (route mounted, gate correct). Authenticated paths not exercised live —
  no admin session available without the Clerk token-template claims.
- Only project-scoped resources touched (staging Worker + staging D1).
  Production untouched. Back on `main`; tree clean.
- Launched a read-only subagent audit of the full tree vs
  `logs/vision/campus-mystery-platform-prd.md`. Findings below (verbatim
  triage; line numbers refer to the reviewed tree).

## Decisions

- No fixes applied in this session — audit first, then the user picks the
  fix batch. No UI work (still parked at `/tmp/opencode/campus-mystery-ui-plan.md`).
- `staging` now equals `main` at 1af3845; next deploy follows the same
  manual flow until issue #1 (missing `CLOUDFLARE_API_TOKEN`) is resolved.

## Verification

- Deploy output: 453.84 KiB upload, startup 27 ms, bindings staging D1+R2.
- Live curl set above, all as designed. Authenticated live exercise still
  blocked on the Clerk `email`/`email_verified` session-claims template.

## Audit findings (subagent, read-only)

### Critical

- C1 — `GET /api/events/:eventId/state` returns ALL challenge
  titles+descriptions with no unlock/hidden filtering (`events.ts:396-449`),
  unlike `GET /api/challenges/:id` which shells correctly. Violates §5.1,
  §10.4, §8.6, §25. Fix: filter with `isChallengeUnlocked`, omit hidden-locked.
- C2 — Web/ API contract mismatch: web expects `{data}` envelopes and
  shapes the worker never returns (`api.ts`, `ChallengeView`, `EventCentre`,
  `LeaderboardPage`, `TeamPage` calls a nonexistent `GET team` route,
  `session.ts` hits `/me` not `/api/me`). PWA currently non-functional.
  Fix in UI track: align web to worker shapes + `/api` prefix, return
  `isAdmin` from `/api/me`.
- C3 — `event_points` lost-update: read-modify-write on a stale snapshot
  (`challenges.ts:731-737`, wrong-answer penalty, hint charge). Concurrent
  completions lose points. Fix: atomic `event_points = event_points + ?`
  deltas. Violates §21(5)(6), §23.3.
- C4 — Team mutations (create/invite/request/approve/reject/leave/
  transfer) have no event-lifecycle gate; possible in
  draft/completed/paused. Fix: `eventGateStatus` on all team routes. §9.1, §19.6.
- C5 — Email-verification enforced only on team creation and admin; event
  register, answer submit, location verify accept unverified sessions.
  Fix: centralize the check (auth middleware or each participation path). §17.1.
- C6 — Finish math (`computeFinishTimestamp`, challenge `completed` flag,
  leaderboard required-keys) counts only Phase-1 completable types; required
  decision/timer/manual/media objectives never block finish. Fix: include
  all required objectives (and decide how manual types complete). §10.1, §14.
- C7 — Event duplicate copies `configuration_json` verbatim, so `requires`
  / `requiresDecision` IDs dangle. Fix: old→new id remap before insert. §7.1, §23.4.
- C8 — Registration ignores `settings.participation` mode, team size,
  cooldowns, name uniqueness. Fix: enforce in `events.ts` register. §9.3,
  §9.6, §12.

### Major (abridged)

- M1 late-join penalty hardcoded 300, triggered by ANY (incl. optional)
  completion, and bypasses the `penalties` table so it is unwaivable. §9.6, §12.7.
- M2 leaderboard ignores `winnerMode`/`leaderboardSize`/`publicLeaderboard`.
  §9.4, §14.
- M3 ties broken by creation order, not final-transaction order. §14.5.
- M4 rate limit is per-isolate in-memory, missing login/register/hints routes. §17.6.
- M5 Turnstile on login only, fails open without secret. §17.5.
- M6 no scoped service tokens for programmatic admin. §17.3 (gap, not bypass).
- M7 no admin reversal / challenge-disable / radius shortcut / mark-final. §16.7.
- M8 capacity + single-active-participant enforced by app checks only, no DB
  constraint — concurrent approves can exceed 5. §12.3, §21(5).
- M9 duplicate join-request race, no partial unique index. §12.2.
- M10 hint/wrong-answer point updates non-atomic (C3 variant). §23.3.
- M11 `isAdmin` never reaches the client; `/admin/*` UI always locked. §16.1.
- M12 `location-session` serves guidance without a lifecycle gate. §9.1.
- M13 publish allows draft→live in one step; single-challenge terminal
  exemption. §9.1, §16.5.
- Minors m1–m12: draft leaderboard visible, penalties pre-start allowed,
  audit cursor on non-unique `created_at`, per-request session writes, Secure
  cookie on http, team-name length mismatch, email split on first `@`, OIDC
  500 vs 400, replay audit noise, route-graph double-report, presence opt-out
  missing from onboarding, obscure `LIMIT 0` history call.
- Test fakes run `batch()` non-transactionally and single-threaded, so
  C3/M8/M9/M10 races are untestable; cross-module invariants never
  exercised together. Recommends a real-SQLite integration test for
  capacity races, concurrent points, duplicate remap, hidden filtering.
- `penalties` table (0002) judged SOUND and not a §18 violation
  ("approximately nine"); gap is M1 bypassing it.
- Clean areas: answer/coordinate sanitization on challenge fetch, location
  retention + geofence/accuracy separation + server timestamps, invite token
  hygiene, admin allowlist + audit coverage, proximity bands, cooldown math,
  countdown display-only, branch isolation.

## Known gaps / debt (carried)

- Issue #1 (`CLOUDFLARE_API_TOKEN`) still open — auto-deploy red, manual
  flow used. Clerk claims template, Turnstile keys, production empty.

## Next session

User picks the fix batch. Proposal: P0 backend correctness
(C1, C3, C4, C5, C6, C7, C8, M1) → P1 hardening (M2–M4, M7–M10, minors) →
UI track (C2/M11 + Astryx/Trophy/DecryptedText per parked plan) → pilot
readiness (E2E login, load test, physical location test per §25).
