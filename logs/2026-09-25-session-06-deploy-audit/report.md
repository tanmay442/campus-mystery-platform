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

## Issues fixed (same session, no new log)

All audit findings below were fixed on `main` after the audit above; only
this section was appended per the user's instruction.

- C1 — `state` now filters with `isChallengeUnlocked`: hidden-locked
  challenges omitted, locked ones shelled with `description: null`,
  unparsable configs fail closed (`events.ts`).
- C2 — web rewritten to real worker contracts: `{code,message}` envelope
  parsing with the full error-code union (`api.ts`); profile guard with
  `isAdmin` (`session.ts`); ChallengeView/EventCentre/LeaderboardPage/
  TeamPage remapped to worker shapes incl. hints unlock, location
  verification flow, `?scope=`, and the new membership endpoint.
- C3/M10 — all point mutations are relative deltas
  (`event_points = event_points + ?`, `MAX(0, event_points - ?)`); hint
  route re-reads the balance after charging.
- C4 — every roster mutation (create/invite/request/approve/reject/leave/
  transfer) passes `rosterGateStatus`: allowed in scheduled/live/paused,
  blocked in draft/testing/completed/archived.
- C5 — email-verification enforced on register, start, submit, hints,
  location-session and verify (teams/admin paths already had it).
- C6 — finish math, challenge `completed` flag and leaderboard
  required-keys now count every required objective; manual_approval/timer/
  media complete through the admin override, decisions through the player path.
- C7 — duplicate remaps `requires`/`requiresDecision` to the copied ids.
- C8 — registration enforces `settings.participation`, per-event team-name
  uniqueness, and the 10-minute cooldown; inserts are conditional so races
  collapse onto one row (same for team creation).
- M1 — late penalty uses `settings.lateJoinPenaltySeconds`, fires only on
  the first *required* completion, and writes a waivable `penalties` row
  (`reason: late_join`).
- M2 — leaderboard honors `winnerMode` (first/points/hybrid),
  `leaderboardSize`, and `publicLeaderboard` (anonymous 403 when private);
  draft/testing boards 404 (m1).
- M3 — finished ties break by final-completion transaction time, then id.
- M4 — rate limit keys on route pattern (no per-id bucket explosion), prunes
  the map, and covers login/register/start/hints/leaderboard/membership/
  leave.
- M5 — Turnstile required on answer submits after 3 wrong attempts when a
  secret is configured; still open when unconfigured (documented).
- M6 — scoped service tokens (`service_tokens` table, migration 0003):
  Bearer auth with per-route scopes, session-only issuance/revocation,
  all audited.
- M7 — `POST objectives/:key/reversal` (voids progress, returns points and
  credits with `manual_reversal` ledger rows, reopens the finish, audited);
  `POST events/:id/finalize` (completed-only, audited top-3 snapshot);
  `disabled` challenge flag enforced as locked everywhere (radius changes
  were already possible via PATCH).
- M8 — capacity/single-membership enforced with conditional inserts verified
  by re-read (approve path already had it); residual cross-isolate risk
  documented, no schema change needed under D1 serialized batches.
- M9 — partial unique index on pending join requests (migration 0004) with
  a CONFLICT backstop in code.
- M11 — `GET /api/me` returns server-computed `isAdmin`; admin UI gate works.
- M12 — `location-session` has the same lifecycle gate as verification.
- M13 — publish is stepwise (draft→scheduled→live); direct draft→live 409s.
  Single-challenge terminal exemption kept intentionally (lone challenge is
  trivially final; `isTerminal` is not consulted at runtime).
- m2 — penalties/waivers blocked in draft/testing/scheduled/archived.
- m3 — audit cursor is opaque `created_at|id` with exact pagination.
- m4 — session sliding refresh only after 5 minutes stale.
- m5 — cookie `Secure` everywhere except local development.
- m6 — team-name input capped at 40 to match the contract.
- m7 — email domain parsed after the last `@`.
- m8 — unresolvable provider tokens return VALIDATION_ERROR, not INTERNAL.
- m9 — manual-completion replays skip audit writes.
- m10 — cycle members no longer double-reported as unreachable.
- m11 — onboarding documents presence default + opt-out (profile PATCH
  already supported visibility changes).
- m12 — `/api/me/credits` limit-0 documented as balance-only.
- Removed dead `isCompletableType`/`readEarliestCompletion` exports.

Verification after fixes: typecheck 4/4, lint, build pass; tests 188/188
(shared 9, db 1, web 6, worker 172 incl. ~40 new); migrations 0003+0004
applied locally and to the staging D1. `staging` branch and the staging
Worker still carry the pre-fix build — redeploy approval needed before the
fixes go live. Production untouched.

## Redeploy of the fixes (same session, appended)

- Merged `main` (4870741) into `staging` (fast-forward) and pushed.
- Migrations: no-op (0003+0004 already on the staging D1).
- `wrangler deploy --env staging`: version `1b5103e2`, live at the staging URL.
- Live curl: `/api/health` 200, `/api/events` 200, penalties/reversal/
  finalize/service-tokens/membership/state all correctly gated (401
  unauthenticated; 404 on membership in the first seconds was edge
  propagation, re-probe returned 401). Authenticated exercise still blocked
  on the Clerk claims template (user-side).
