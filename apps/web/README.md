# @campus/web

Mobile-first Progressive Web App for the Campus Mystery platform. Player routes plus a guarded admin shell. The server
stays authoritative for auth, progress, scores, ranks, and official times.

## Development

```sh
pnpm --filter @campus/web dev
```

The dev server runs on port 5173. Calls to `/api` are proxied to `http://localhost:8787`, where the Worker API runs in
local development. Start the Worker alongside the web app so proxied requests resolve.

```sh
pnpm --filter @campus/web typecheck
pnpm --filter @campus/web test
pnpm --filter @campus/web build
```

## PWA notes

The app uses `vite-plugin-pwa` with `registerType: autoUpdate`, so a new service worker takes over without a manual
refresh prompt. The manifest is standalone with name Campus Mystery and short name Mystery. Theme color `#422006` is an
earthquake-earth brown chosen for the mystery theme; background is `#111827`.

Icons are referenced at `icons/icon-192.png` and `icons/icon-512.png` (maskable). Those PNG files are not committed
yet, so add real icon art at `public/icons/` before the installability audit.

Workbox applies NetworkFirst with a 20-second network timeout to GET requests under `/api`, cached for up to five
minutes. Game state and leaderboards still poll every 15 seconds while visible, inside the required 10–20 second
window. POST submissions are never served from cache. The install prompt is intentionally minimal: `main.tsx` stores the
deferred `beforeinstallprompt` event and the UI adds no custom install banner yet.

## Route map

| Route                                      | Purpose                                                        |
| ------------------------------------------ | -------------------------------------------------------------- |
| `/`                                        | Landing with platform identity, promoted event, and sign-in CTA |
| `/login`                                   | Auth entry with a Turnstile mount-point stub                   |
| `/onboarding`                              | Skippable six-card intro plus the location-permission note     |
| `/events/:eventId`                         | Event centre: chapter, countdown, identity, objectives, score, announcements |
| `/events/:eventId/challenges/:challengeId` | Challenge view with objective list and autosave state          |
| `/events/:eventId/leaderboard`             | Top 10 plus self rank, with solo/team filters                  |
| `/events/:eventId/team`                    | Members, invites, and join requests                            |
| `/admin`                                   | Guarded dashboard placeholder                                  |
| `/admin/events`                            | Guarded events-list placeholder                                |

Admin and challenge routes load through `React.lazy`. `RequireAdmin` only hides UI; every `/api/admin/*` call is
authorized again on the server against the allowlisted verified email.

## Just-in-time location permission rule

Location permission is requested only when the player opens their first location objective. The landing page,
onboarding, and event centre never trigger the browser geolocation prompt. Onboarding carries the explanation, the
challenge view collects the readings, and the server validates distance against the configured geofence. Denying
permission never blocks the rest of the interface; the player keeps their saved progress and sees organizer support
instead.

## API client and errors

`src/lib/api.ts` sends every request to `/api` with `credentials: include` and expects the JSON envelope
`{ data } | { error: { code, message } }`. Responses are narrowed from `unknown` with type guards, so no `any` or
`as` casts cross the fetch boundary. Mutating submissions use `submitWithIdempotency()`, which attaches an
`Idempotency-Key: crypto.randomUUID()` header so a retry returns the existing completion instead of double rewards.

Stable error codes: `UNAUTHENTICATED`, `FORBIDDEN`, `VALIDATION_ERROR`, `RATE_LIMITED`, `EVENT_PAUSED`, `COOLDOWN`,
`LOCATION_REJECTED`, `CONFLICT`, `NOT_FOUND`, `INTERNAL`.

## Accessibility and submission states

Every submit button renders pending, success, and failure states through disabled labels plus `aria-busy` and an
`aria-live` region. Landmarks, labels, and a `role="timer"` countdown are used throughout. Touch targets are at least
44px, the palette pairs dark text with light surfaces for contrast, `prefers-reduced-motion` disables animation, and
layouts respect safe-area insets for notched phones.
