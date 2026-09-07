# Cloudflare inventory and freeze policy

Canonical record of every Cloudflare resource this project uses, every change
made to hosted state, and the rules for touching any of it. The session logs
(`logs/`) record decisions; this file records facts about hosted resources.

## Account

| Field | Value                            |
| ----- | -------------------------------- |
| Login | OAuth token, `goeltanmay442@gmail.com` |
| Account | Goeltanmay442's Account (`e338c1acca08049c405117d7cf92b4d1`) |

## Resource inventory (project-owned)

| Type | Name | ID | Environment | State |
| ---- | ---- | -- | ----------- | ----- |
| D1 | `campus-mystery-dev` | `81b957f5-5c0e-49c3-9932-43d8e0f1325d` | development | Created, APAC. Local work uses `--local`; remote untouched. |
| D1 | `campus-mystery-staging` | `a72a95ca-a5c0-49f7-b257-af17e05c5df6` | staging | Created, APAC. `0001_init.sql` applied remotely (29 commands). |
| D1 | `campus-mystery-production` | `438ad759-3620-403b-9c91-788e966b377a` | production | Created, APAC. Empty, never migrated, never deployed to. |
| R2 | `campus-mystery-media-dev` | n/a (name-addressed) | development | Created. Empty. |
| R2 | `campus-mystery-media-staging` | n/a (name-addressed) | staging | Created. Empty. |
| R2 | `campus-mystery-media-production` | n/a (name-addressed) | production | Created. Empty. |
| Worker | `campus-mystery-platform-staging` | version `16652d57-...` (session 06) | staging | Deployed from `staging` branch. `https://campus-mystery-platform-staging.goeltanmay442.workers.dev` with `ENVIRONMENT=staging`, `ADMIN_EMAILS` passed as a deploy flag (not committed). Serves hardening + `.results`-fix build. |
| Turnstile | — | — | — | Not configured anywhere. Backend runs open mode until keys exist. |

## Changes made to hosted state

5. Manual `wrangler deploy --env staging` from the `staging` branch, version
   `16652d57` (session 06, user-approved). Live verification: `/api/health`
   200 staging, `/api/events` 200 `{"events":[]}` (the `.results` fix
   confirmed live), unknown event 404 EVENT_NOT_FOUND, unauthenticated
   admin POST 401, `/` 404 (no SPA deployed — API only).
6. GitHub issue #1 opened: add `CLOUDFLARE_API_TOKEN` secret so the
   push-to-staging workflow can deploy by itself (attempted minting via
   OAuth, refused 403).

Earlier (all session 04):

1. `wrangler d1 create` for the three databases above.
2. `wrangler r2 bucket create` for the three buckets above.
3. `wrangler d1 migrations apply DB --remote --env staging` (0001_init.sql).
4. `wrangler deploy --env staging --var ADMIN_EMAILS:goeltanmay442@gmail.com`.

Nothing else. No secrets set, no production writes, no deletions.

## Explicitly NOT ours — never touch

- R2 bucket `rag` (pre-existing in the account, belongs to another project).
- Any worker, database, bucket, zone, secret, or account setting not named
  in the inventory table above.

## Skill compliance (reviewed 2026-09-07)

Checked against the Cloudflare skill references (`d1`, `workers`, `r2`
gotchas + configuration) and `workers-best-practices` / `wrangler` skills:

- Compliant: prepared statements + `bind()` everywhere (IN-lists use bound
  placeholders); INTEGER 0/1 booleans; ISO-8601 TEXT timestamps; indexes on
  FK columns; `nodejs_compat` on; recent `compatibility_date`; no
  module-level request state (the JWKS key cache is URL-keyed config, not
  request data); observability enabled; Hono as the Workers-native router.
- Known limitation, no change: D1 read-after-write is eventually
  consistent and the Sessions API is paid-only, so mutating routes rely on
  single-statement conditional writes (`affectedRows` guards) instead of
  read-your-write. Any flow that re-reads after writing must tolerate
  staleness or restructure into conditional writes.
- Known limitation, no change: `PRAGMA foreign_keys` is per-connection and
  has no effect from migrations on serverless D1; integrity is enforced at
  the application layer (capacity, membership, idempotency constraints).
- R2 media uploads are not implemented yet. When they are: validate keys
  (reject `..`/leading `/`), buffer streams or pass Content-Length, follow
  `references/r2/gotchas.md`, and use `turnstile-spin` + `references/
  turnstile/` for the Turnstile step once keys exist.

## Freeze policy (mandatory for every session)

1. The inventory table above is the complete set of Cloudflare resources
   this project may ever use. Do not create new ones.
2. No `wrangler` write operation — create, apply, deploy, secret, delete,
   rollback — on ANY resource without explicit per-action user approval.
   Staging redeploys included.
3. Read-only inspection (`whoami`, `list`, `info`) is allowed when
   diagnosing, and must be reported, not acted on.
4. Every approved hosted change must be appended to the "Changes" section
   above and to the current session report in `logs/` before the session ends.
5. `wrangler.jsonc` IDs are the source of truth for bindings. If dashboard
   state ever disagrees with this file, stop and ask — do not reconcile
   unilaterally.
