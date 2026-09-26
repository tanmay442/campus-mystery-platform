# Session 07 — Astryx basic frontend (2026-09-26)

## Goal

Rebuild the basic player frontend on Meta Astryx components, mobile-first,
using library components only — no scratch-designed components. Trophy
gamification and DecryptedText reveals stay parked for the next slice.

## Work done

- Installed `@astryxdesign/core`, `@astryxdesign/theme-neutral`,
  `@stylexjs/stylex` (deps) and `@astryxdesign/cli` (dev) in `apps/web`;
  ran `astryx init --all` (AGENTS.md, theme.template.ts) and
  `astryx theme add neutral` (`src/themes/neutral/` + `lucide-react` dep).
  No dedicated Astryx skill exists in this environment (checked `skill`
  registry); followed the CLI workflow instead (`build`, `search`,
  `component`, `docs layout`), which is the documented equivalent.
- `main.tsx`: `<Theme theme={neutralTheme} mode="system">` + Astryx
  reset/css imports; dropped `styles.css`.
- New `AppFrame` (AppShell + TopNav + SideNav, `height="auto"`): one nav
  definition serves desktop sidebar and the auto-generated mobile drawer.
  Clerk `useAuth` drives sign-in link vs `UserButton` (installed
  @clerk/react 6.15.1 exports no SignedIn/SignedOut). `RouterLink` adapts
  react-router to Astryx `as` props. Router restructured to a layout route;
  routes no longer render their own `<main>` (AppShell owns the landmark).
- Routes rewritten on Astryx with logic/guards preserved: Landing (Section,
  Card, EmptyState, Skeleton, Banner), Login (Spinner, Banner +
  `useAnnounce` assertive errors), Onboarding (List/ListItem, HStack
  actions), EventCentre (StatusDot states, Badge counts, List with href
  items, ProgressBar-free score Card, EmptyStates), ChallengeView
  (RadioList/TextInput/FormLayout-less form, two-step hint confirm,
  ProgressBar of objectives, Banner outcomes + `useAnnounce`), TeamPage
  (AvatarGroup, TextInput, approve/reject Buttons, destructive Leave),
  LeaderboardPage (SegmentedControl filter, decimal List, self-rank
  section), RequireAdmin (Banner), admin placeholders restyled.
- Rebuilt `TargetSignal` (Card/StatusDot, same band text — existing 6 tests
  pass) and `Countdown` (Text/VStack, same timer contract). Deleted
  `ChallengeCard.tsx`, `Leaderboard.tsx`, `styles.css`.
- New `smoke.test.tsx`: AppFrame brand/nav links + Landing hero/empty
  state render in jsdom (with a matchMedia stub Astryx needs).

## Decisions

- Astryx-only for the basic pass. Trophy needs Tailwind v4 + shadcn
  scaffolding, whose preflight/utilities would fight the Astryx reset and
  token system; per the parked UI plan it arrives scoped to gamification
  islands in the next slice (Points Badge, Leaderboard Podium/Rankings,
  Achievement set). Same for DecryptedText (`motion` dep): completion
  facts render as plain text until the reveal slice.
- `TargetSignal` is rebuilt but not yet mounted: live bearing/band needs
  the server to answer location-session readings (planned slice), and no
  fake data is rendered meanwhile.
- Hint unlock uses a two-step arm/confirm button instead of
  `window.confirm`; destructive Leave keeps a plain button (AlertDialog
  upgrade noted, not done).
- `SideNavHeading` brand removed after the smoke test caught duplicate
  "Campus Mystery" text (TopNav already brands).
- Mobile-first: AppShell auto drawer, `contentWidth={640}` caps, `width="100%"`
  primary actions, safe-area already `viewport-fit=cover`; 44px targets
  inherit from Astryx md sizing.

## Verification

- `pnpm typecheck` (web), `pnpm test` (8/8: 6 TargetSignal + 2 smoke),
  `pnpm build` (PWA precache 12 entries) — all pass.
- AGENTS.md self-check: no raw `<div>`/`<span>` layout, no `.css` imports
  beyond the two sanctioned Astryx ones, no hex/px values in app code.
- NOT verified: real-device render (no browser here), Clerk signed-in
  flows, backend-connected click-through.

## Known gaps / debt

- Trophy + DecryptedText slices still parked (`/tmp/opencode/campus-mystery-ui-plan.md`
  was wiped with /tmp and recreated from the original instructions).
- Admin UI remains styled placeholders (builders + live room = later slice).
- `theme.template.ts` CLI artifact kept at web root.
- Staging Worker still serves the pre-Astryx build; production untouched.

## Next session

Trophy gamification islands and/or DecryptedText completion reveals, then
a staging deploy + device click-through of the Astryx screens.
