# @campus/worker

Hono API running on Cloudflare Workers. One Worker serves the JSON API and,
when a static-asset binding is present, falls back to the SPA for non-API
routes. Every error uses the shared `{ code, message, details? }` envelope
from `@campus/shared`, so clients can rely on stable machine-readable codes.

## Local dev

```sh
pnpm --filter @campus/worker dev
```

Copy `.dev.vars.example` to `.dev.vars` and fill in local-only values before
starting. `.dev.vars` is gitignored and never committed. The API listens on
the port printed by `wrangler dev` (usually 8787).

Health check:

```sh
curl localhost:8787/api/health
```

## Database migrations

Migrations live in `packages/db/migrations` and are owned by `@campus/db`.
The worker only points at them through `migrations_dir` in `wrangler.jsonc`.

Apply pending migrations to the local D1 database:

```sh
pnpm --filter @campus/worker db:apply:local
```

Create a new migration from the repo root with the db package tooling, then
verify it applies locally before pushing.

## Secrets and admin access

Admin access needs a signed session whose verified email appears in the
`ADMIN_EMAILS` allowlist. The comparison is timing-safe and the email always
comes from the verified session, never from request input.

Local secrets go in `.dev.vars` (`SESSION_SECRET`, `TURNSTILE_SECRET_KEY`,
`ADMIN_EMAILS`). Staging and production secrets are set outside the repo:

```sh
wrangler secret put SESSION_SECRET --env staging
wrangler secret put TURNSTILE_SECRET_KEY --env staging
wrangler secret put ADMIN_EMAILS --env staging
```

`wrangler.jsonc` keeps `ADMIN_EMAILS` empty on purpose. The comment next to
it explains that the real value is set through the Cloudflare
dashboard, `wrangler secret put`, or an approved deploy flag, so no
allowlist ever lands in git. Staging currently receives it as a deploy
`--var` flag (see `docs/cloudflare.md`); the secrets path remains the
preferred long-term setup.

## Deploy

```sh
pnpm --filter @campus/worker deploy
wrangler deploy --env staging
wrangler deploy --env production
```

The bare `deploy` targets the top-level (development) environment.

## Environments

| Environment | D1 database | R2 bucket | `ENVIRONMENT` var |
|---|---|---|---|
| development (default) | campus-mystery-dev | campus-mystery-media-dev | development |
| staging | campus-mystery-staging | campus-mystery-media-staging | staging |
| production | campus-mystery-production | campus-mystery-media-production | production |

Bindings resolve to the real IDs in `wrangler.jsonc`, which match the
`docs/cloudflare.md` inventory. Never change them without an approved
session decision.

## Types

`src/env.ts` holds the Worker's `Env` type with minimal `D1Database`-like
and `R2Bucket`-like interfaces, so the worker compiles without generated
Cloudflare types checked into the repo. Running `pnpm types` regenerates the
Worker configuration types from `wrangler.jsonc`; mirror any binding changes
back into `src/env.ts` so the two stay in sync.

## Request pipeline

`src/index.ts` wires middleware in this order: session-cookie auth, then
`Idempotency-Key` capture, then sliding-window rate limits on answer,
location, team, ping and admin routes, then the admin allowlist check for
`/api/admin/*`. Error handling is a JSON envelope in `notFound` and `onError`
handlers. The app never calls `passThroughOnException`, so every failure
surfaces as a JSON envelope instead of an unhandled exception page.

Non-API requests try the `ASSETS` fetcher first and fall back to the
`NOT_FOUND` envelope when no asset binding exists or the fetch fails, which
keeps the API fully usable without a frontend deploy.

## Route stubs

Each module under `src/modules/` validates path params, query strings and
JSON bodies with zod, then returns `501` in the shared envelope until Phase 1
implements the real logic. Route paths match PRD sections 19.1-19.5 exactly.
The rewards module has no PRD routes yet and stays an empty placeholder for
the Phase 1 credit and points logic.
