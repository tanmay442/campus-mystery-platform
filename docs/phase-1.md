# Phase 1 — Core MVP foundation (in progress)

Source: PRD sections 8–21, 25–26. This is the production base, not a demo.
Every item below ships with real server validation, migrations, tests, and types.

## Scope

- [x] Auth + profiles: verified accounts, unique usernames, session + 2-device policy
- [x] Event model + lifecycle: draft → testing → scheduled → live → paused → completed → archived
- [x] Unified solo/team participant model (one progression path, max 5 members)
- [x] Team invitations, join requests, approvals, leave, captain transfer
- [x] Challenge rendering: text, choice, code, location objectives (Phase 1 subset)
- [x] Objective-level autosaving (upsert on participant+challenge+objective_key)
- [x] Event points + platform credits (atomic balance + transaction ledger)
- [x] Basic leaderboard: top 10 + current rank, server official finish time
- [ ] Protected admin event/challenge forms + admin API auth (allowlist email) — event admin APIs + audit done; challenge CRUD, manual completion, waivers pending; frontend forms deferred with UI

## Deferred to Phase 2+

Branching routes polish, compass/proximity polish, completion animations + facts,
late-join penalties, admin preview + validation, manual overrides + audit log UI,
multi-device/load testing (Phase 2). Presence, minimap, pings (Phase 3).
Audit-log writes ship in Phase 1 foundation; full admin UI lands Phase 2.

## Fixed defaults (PRD §29)

Max team 5 · 2 devices/account · late-join penalty 5 min · membership cooldown
10 min · 3 location readings, valid 60 s, collected over ~8 s · presence expiry
90 s · public ping cooldown 10 min · team ping cap 20/min · leaderboard top 10 ·
poll 10–20 s.

## Module map

```text
apps/worker/src/
  index.ts            Worker entry: Hono app, static-asset fallback, error codes
  env.ts              Env binding types (generated via `wrangler types`, never hand-kept)
  middleware/         auth, admin-allowlist, rate-limit, turnstile, idempotency
  modules/            auth events participants teams challenges location
                      rewards leaderboard presence admin
  lib/                errors, timestamps, pagination, crypto helpers
apps/web/src/
  routes/             public, auth, onboarding, event-centre, challenge,
                      leaderboard, team, admin (guarded)
  components/         challenge cards, target-signal, proximity, leaderboard
  lib/                api client (typed), session, idempotency keys
packages/shared/src/
  errors.ts           stable machine-readable error codes
  events.ts           lifecycle, settings schema, winner/progression modes
  challenges.ts       objective types, validation modes, location params
  teams.ts            capacity, roles, membership rules
  scoring.ts          points, credits, penalties, fixed defaults
packages/db/
  schema.ts           Drizzle schema — 9 PRD tables + sessions + announcements
  migrations/         versioned SQL, applied via wrangler d1 migrations
```
