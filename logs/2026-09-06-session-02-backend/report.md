# Session 02 — Backend logic (2026-09-05/06)

## Goal

Implement real Phase 1 backend logic in all four tracks (auth, events+admin,
teams, challenges+scoring) with no UI changes, using parallel subagents.

## Work done

- Auth (`modules/auth.ts`, `middleware/auth.ts`, new `shared/auth.ts`, new
  `lib/turnstile.ts`): opaque session tokens (SHA-256 stored, `cmp_session`
  httpOnly/Secure/SameSite=Lax cookie, 30-day sliding expiry), provider seam
  (`DevProvider` dev-only + fail-closed OIDC skeleton), unique usernames,
  2-device eviction of oldest session, Turnstile helper (open without secret).
- Events+admin (`modules/events.ts`, `modules/admin.ts`, extended
  `shared/events.ts`): lifecycle state machine + `ALLOWED_TRANSITIONS`,
  admin CRUD/duplicate/publish/pause/resume/end/archive (archive route added
  though PRD §19.5 omits it), 5 registration policies as zod union,
  code/domain gates, idempotent start, audit_log write on every admin
  mutation, announcements with published_at.
- Teams (`modules/teams.ts`, `modules/participants.ts`, extended
  `shared/teams.ts`): creation with per-event name uniqueness, one-active-
  participant rule, token invites + request/approve/reject, atomic approve
  with in-transaction capacity re-check, +300s late-join penalty only after
  first team completion, leave with captain succession, 600s cooldowns.
- Challenges+scoring (`modules/challenges.ts`, `location.ts`, `rewards.ts`,
  `leaderboard.ts`, extended `shared/challenges.ts`): pure `validateAnswer()`
  (7 modes), attempts + progressive cooldown, idempotent completion
  (points once, credits to active members only), server haversine verify
  (all-readings-inside, no coordinate leaks, no trail storage), hint costs
  floored at 0, top-10 + caller-context leaderboard, balance/history reads.
- Integration (main agent): wired `shared/auth.ts` into index (collision
  checked), replaced stale stub-501 test with real 404 assertion.
- New tests: auth 5, events 9, admin 10, teams+participants 16, challenges
  17, location 21, leaderboard 7.

## Decisions

- Atomicity via single `db.batch()` for approve/complete/register paths.
- `ensureSoloParticipant` reuses existing solo entry (idempotent register).
- Late-join "required completion" = any completed team objective (required
  vs optional lives in challenge config, another module's domain).
- Hint unlock on completed objectives is free (fixed double-charge bug).
- Cookie fallback accepts `cmp_session` (canonical) and legacy `session`.
- Challenge-CRUD, manual-completion, penalty admin routes stay 501 stubs.

## Verification

- `pnpm typecheck` 4/4, `pnpm lint` pass, `pnpm build` pass.
- `pnpm test`: 104/104 (shared 9, db 1, web 6, worker 88 across 9 files).
- First attempt: all 4 subagents died on provider 429s; partial work
  survived, resumes were cleaned up, 4 fresh agents completed on disk state.

## Known gaps / debt

- No Cloudflare provisioning yet (login, real D1/R2 IDs, Turnstile keys,
  ADMIN_EMAILS) — still Phase 0, unchanged from session 01.
- Web `ApiErrorCode` union still a subset duplicate of shared enum.
- OIDC provider selection + wiring still open (seam ready).
- Presence module untouched (Phase 3).

## Next session

Phase 0 provisioning if credentials available; otherwise remaining admin
ops (challenge CRUD, manual completion, penalties/waivers), then frontend
wiring of auth + event centre against the real API. Touches
`modules/admin.ts`, `modules/challenges.ts`, then `apps/web/src/lib/*`.
