# Campus Mystery Event Platform

Mobile-first, reusable gamified event platform. First use case: campus mystery
and location-based challenge race for up to 400 simultaneous participants.

Production architecture, Cloudflare-first:

| Component      | Responsibility                                            |
| -------------- | --------------------------------------------------------- |
| `apps/web`     | Player + admin UI. React 19, Vite, mobile-first PWA       |
| `apps/worker`  | Hosting, routing, API, authoritative game logic (Hono)    |
| `packages/db`  | D1 schema (Drizzle) + versioned SQL migrations            |
| `packages/shared` | Shared contracts: zod schemas, error codes, game constants |
| D1             | Users, events, participants, challenges, durable progress |
| R2             | Clue images, audio, video, event media                    |
| Turnstile      | Bot resistance on high-risk actions                       |

Full product spec: `docs/` (PRD summary + phase plan).

## Product principles

1. Server-authoritative state. The client never decides completion, score, rank, or time.
2. One participant abstraction. Solo entries and teams share one progression model.
3. Configuration before custom code. New events are config, not new routes or tables.
4. Autosave verified milestones. Each accepted objective persists independently.
5. Privacy through approximation. No exact public coordinates.

## Quick start

```bash
pnpm install
pnpm --filter @campus/worker db:apply:local   # apply D1 migrations locally
pnpm dev                                       # web (Vite) + worker (wrangler dev)
```

Copy `apps/worker/.dev.vars.example` to `apps/worker/.dev.vars` for local secrets.
Never commit real secret values.

## Environments

Separate local / preview-staging / production. Each gets its own D1 database,
R2 bucket, Turnstile keys, and secrets. See `apps/worker/wrangler.jsonc`.

## Repo standards

- TypeScript strict (`tsconfig.base.json`: `noUncheckedIndexedAccess`,
  `exactOptionalPropertyTypes`, no `any` on boundaries — `unknown` + zod parse).
- Branded IDs, discriminated unions for domain variants, exhaustive switches.
- Boundary validation: every request body / external payload is parsed with the
  zod schema in `packages/shared` before use.
- Server timestamps only. No client clocks in completion logic.
- Idempotency keys on completion submissions. Unique constraints in D1.
- Structured JSON logs. No raw coordinates or correct answers in logs.
- `pnpm typecheck`, `pnpm lint`, `pnpm test` pass before every push. CI enforces it.
