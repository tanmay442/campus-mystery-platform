# Session 03 — Clerk auth (2026-09-06)

## Goal

Replace the dev-only login with real Clerk authentication, backend +
frontend, following the official Clerk skills. No visual design changes.

## Work done

- Skills pulled from `clerk/skills` (GitHub) to `/tmp/clerk-skills/`
  (`clerk` router, `clerk-setup`, `clerk-react-patterns`); both agents
  briefed on them. Repo does not vendor them (harness has no skill
  installer); re-pull if a future session needs them.
- Deps: `jose` (worker), `@clerk/react` (web).
- Backend (`modules/auth.ts`, `shared/auth.ts`): `ClerkProvider` verifies
  Clerk session JWTs via JWKS (`jose`, URL-keyed key cache, fail-closed to
  FORBIDDEN), requires signature + expiry + issuer + `email` +
  `email_verified`, maps to `auth_provider_id = clerk:<sub>`. Login accepts
  `{provider: "clerk"|"dev", token}` plus legacy `{providerToken}` union.
  `DevProvider` and OIDC skeleton untouched.
- Frontend (`main.tsx`, `Login.tsx`, `lib/session.ts`, gates on
  Onboarding/EventCentre/TeamPage): ClerkProvider with missing-key error
  state, prebuilt `<SignIn forceRedirectUrl="/login">`, token exchange into
  our httpOnly session cookie (no Authorization headers afterwards),
  `isLoaded`-guarded gates, `enabled`-on-signed-in queries.
- Env: `VITE_CLERK_PUBLISHABLE_KEY` moved to `apps/web/.env.local`;
  `CLERK_JWKS_URL` (derived from key: `cosmic-kitten-79`) in worker
  `.dev.vars` + `.dev.vars.example`; `CLERK_JWKS_URL?: string` added to
  worker `Env` type by main agent.
- Keys present in repo-root `.env.local` (gitignored): Clerk publishable,
  WORKOS_* (unused, product decision is Clerk).

## Decisions

- Clerk is identity-proof only; our session table, 2-device policy,
  credits, and audit stay authoritative (no Clerk-session adoption).
- No Clerk Backend SDK on the worker: pure `jose` + JWKS keeps the edge
  bundle dependency-free and testable offline (`createLocalJWKSet`).
- No `CLERK_SECRET_KEY` needed for this design; fetch later only if
  Backend-API admin ops are wanted.

## Verification

- `pnpm typecheck` 4/4, `pnpm lint`, `pnpm build` pass.
- `pnpm test`: 109/109 (worker 93 incl. 5 new Clerk crypto tests).

## Known gaps / debt — USER ACTION REQUIRED

- Clerk Dashboard → Sessions → session token template MUST emit `email`
  and `email_verified` custom claims, or every real login gets FORBIDDEN.
  Template keys must be exactly `email`, `email_verified`.
- Real end-to-end login untested (needs the template above + dev server).
- WORKOS_* keys linger in root `.env.local`; delete if WorkOS is dead.
- Legacy `{providerToken}` login shape still accepted; remove once the
  frontend no longer sends it (it already sends the new shape).

## Next session

Manual E2E login check (`pnpm dev`, sign in, confirm cookie + /api/me),
then remaining admin ops (challenge CRUD, manual completion, waivers) or
Phase 0 Cloudflare provisioning — whichever the user picks.
