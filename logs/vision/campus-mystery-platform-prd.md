# Campus Mystery Event Platform

## Product Requirements Document

| Field | Value |
|---|---|
| Document status | Draft v1.0 |
| Product type | Mobile-first, reusable gamified event platform |
| Initial use case | Campus mystery and location-based challenge race |
| Target capacity | Up to 400 simultaneous participants |
| Primary infrastructure | Cloudflare Workers, D1, R2 and Turnstile |
| Participation modes | Individual and teams of up to five members |
| Primary competition mode | First participant or team to complete the target |
| Last updated | 30 August 2026 |

---

## 1. Executive Summary

The Campus Mystery Event Platform is a reusable web application for running interactive games, mysteries, races and challenge-based events. Its first major use case is a college campus mystery hunt in which individuals or teams solve puzzles, follow clues, navigate toward real locations, make route decisions and complete challenges before competing participants.

The product must feel like a game rather than a collection of web forms. Its central experience consists of a narrative introduction, an event centre, active challenge cards, a compass and proximity interface for location objectives, multi-step puzzles, autosaved progress, animated completion screens, platform credits, event-specific points, leaderboards and optional nearby-player interaction.

The platform is not limited to location-based hunts. Administrators must be able to create one-day or multi-day events containing location objectives, answer-based puzzles, volunteer codes, decisions, timed tasks and non-location activities. Events may be sequential, branching or open-ended.

The system will be server-authoritative. Authentication, challenge availability, answer validation, location acceptance, rewards, penalties, team membership, completion status and official finish time will be determined by the server. The first version will use a deliberately compact Cloudflare-first architecture: one web application and API on Cloudflare Workers, one D1 database, one R2 bucket, Turnstile and an optional Durable Object for temporary presence and pings.

---

## 2. Product Vision

### 2.1 Vision statement

Transform a college campus—and eventually any physical or digital environment—into an interactive game board where people explore, collaborate, compete and discover stories through configurable challenges.

### 2.2 Product promise

For players, the platform provides an immersive, understandable and mobile-friendly event experience that always communicates:

- What is currently available
- What must be done next
- What has already been completed
- Where progress was saved
- How the player or team is performing
- How to recover when stuck

For organisers, the platform provides a protected administration interface through which events, challenges, routes, locations, hints, rewards, participants and live operations can be managed without editing application code.

### 2.3 Long-term direction

The platform should eventually support:

- Campus mystery hunts
- Treasure hunts and orientation activities
- Department and club competitions
- Technical and logic puzzle events
- Multi-day alternate reality games
- Online-only challenge events
- Hybrid physical and online narratives
- Museum-style or cultural exploration
- Repeatable event templates

---

## 3. Problem Statement

Most college scavenger-hunt systems rely on paper clues, manually maintained spreadsheets, chat groups or basic forms. These approaches create several problems:

- Progress is difficult to validate consistently.
- Location-based tasks lack an integrated navigation experience.
- Team and individual participation require separate manual processes.
- Organisers cannot easily create branching routes or multi-step challenges.
- Participants lose progress when pages refresh or devices change.
- Leaderboards and completion times are difficult to maintain fairly.
- Event content is often hard-coded and cannot be reused.
- Live crowding, announcements and participant support are difficult to manage.

The platform solves these problems by providing a reusable event engine with server-validated progress, configurable challenge objectives, unified solo/team participation, mobile navigation, durable autosaving and a protected organiser dashboard.

---

## 4. Goals and Non-Goals

### 4.1 Product goals

1. Support both solo participants and teams through one common progression model.
2. Allow teams of up to five approved members.
3. Support up to 400 simultaneous participants.
4. Support location and non-location challenges in the same event.
5. Support sequential, branching and configurable challenge routes.
6. Save each validated objective independently so completed work never needs to be repeated.
7. Provide compass, proximity and hint-based navigation without requiring exact turn-by-turn directions.
8. Make event creation and live management accessible through protected admin routes.
9. Keep authoritative logic and timestamps on the server.
10. Maintain a small, understandable database and Cloudflare-first architecture.
11. Provide reusable event templates and duplication for future events.
12. Provide a sufficiently gamified interface, including progress, rewards, story fragments and completion moments.

### 4.2 Non-goals for the initial release

The initial release will not attempt to:

- Reliably detect advanced GPS spoofing
- Prevent participants from verbally sharing answers
- Prevent consensual account sharing beyond a two-device policy
- Provide turn-by-turn road navigation
- Replace emergency or official campus safety systems
- Provide real-time exact player tracking to the public
- Support financial payments or cash-equivalent credits
- Build a native Android or iOS application
- Build a microservice architecture
- Use QR codes or NFC tags as checkpoint requirements
- Implement a full graphical no-code workflow engine in the first MVP

---

## 5. Product Principles

### 5.1 Server-authoritative state

The client may collect and present evidence, but it must not decide challenge completion, scores, rewards, penalties, ranking or time.

### 5.2 One participant abstraction

A participant is either an individual entry or a team entry. Challenges, progress, points, finish records and leaderboard positions belong to the participant rather than being separately implemented for solo and team modes.

### 5.3 Configuration before custom code

Event differences should be represented through event and challenge configuration. New events should not require new routes or database tables.

### 5.4 Autosave verified milestones

Every completed objective is saved immediately. A player who solves a puzzle and later needs to reach a location must not solve the puzzle again.

### 5.5 Progressive guidance

The product should preserve mystery while offering recovery mechanisms. Events can begin with clues, later reveal compass direction and eventually reveal approximate proximity or location names.

### 5.6 Privacy through approximation

Public nearby-player features may show counts and opted-in usernames, but must not expose exact coordinates.

### 5.7 Simplicity as the default

Minor design decisions should favour the option with fewer tables, services and special cases, provided it remains maintainable and safe.

---

## 6. Users and Roles

### 6.1 Visitor

An unauthenticated person who may view the public landing page and public event information but cannot enter an event or submit progress.

### 6.2 Authenticated user

Any user with a verified authenticated account. Account creation is open to any authenticated user rather than restricted to a college email domain.

An authenticated user may:

- Manage their profile and username
- Register for eligible events
- Participate individually
- Create or join teams
- Receive platform credits
- Control nearby-presence visibility
- View past event history

### 6.3 Solo participant

An authenticated user participating as a one-member participant entry.

### 6.4 Team member

An authenticated user belonging to a team participant. Any active team member may complete objectives for the entire team.

### 6.5 Team captain

The member who creates or manages the team. The captain can approve membership requests, revoke invitations and transfer captaincy. The system may allow designated members to receive the `manage_members` permission.

### 6.6 Event organiser or administrator

A verified authenticated user whose verified email is included in the server-side administrator allowlist. Administrators can access protected admin pages and APIs according to their role.

---

## 7. Scope of the Initial Product

### 7.1 Included

- Authentication and user profiles
- Interactive onboarding
- Event discovery and registration
- Solo and team participation
- Team creation, invitations, requests and approvals
- Multi-step challenges
- Text, choice, code, location, decision and manual objectives
- Sequential and branching progression
- Compass and proximity guidance
- Configurable hints
- Objective-level autosaving
- Event points and platform credits
- First-to-finish leaderboards
- Nearby counts, usernames and pings with opt-out
- Protected admin interface
- Event creation, duplication, testing, publishing and archiving
- Challenge and location configuration
- Live event controls and announcements
- Audit history for sensitive admin operations
- Result and participant export

### 7.2 Deferred

- Native mobile applications
- Advanced device attestation
- Sophisticated anti-collusion systems
- A drag-and-drop graph editor with arbitrary workflow execution
- Complex user-generated events
- Paid credits or marketplace features
- Cross-college public event discovery
- Direct messaging between arbitrary nearby users

---

## 8. Primary Player Journey

### 8.1 Entry and authentication

1. The visitor opens the platform.
2. The visitor sees the platform identity and currently promoted event.
3. The visitor signs in through the configured authentication provider.
4. The server verifies the authentication token and email verification status.
5. A first-time user chooses a unique username and optional display name.
6. The user enters onboarding or skips it where permitted.

### 8.2 Interactive onboarding

Onboarding should be short, visually interactive and skippable for returning users. It should communicate:

- What the platform is
- How it relates to college culture and community
- The current event story or premise
- How solo and team participation work
- Prize or recognition information
- Basic safety rules
- How location access is used
- How credits, points and hints work

Location permission must be requested just in time, when the player opens their first location objective. It should not be requested automatically on the landing page.

### 8.3 Event registration

Events may use one of these registration policies:

- Open
- Invite only
- Approval required
- Email-domain restricted
- Access-code restricted

Account eligibility and event eligibility remain separate. Any authenticated user can hold an account, while individual organisers control entry into specific events.

### 8.4 Participation selection

When allowed by the event, a user chooses:

- Continue individually
- Create a team
- Join a team

The user may later change participation according to the membership rules defined in this PRD.

### 8.5 Event centre

The event centre is the primary game hub and must display:

- Current event and chapter
- Event start/end time or countdown
- Participant or team identity
- Team member count
- Current objective
- Available challenge cards
- Completed challenge count
- Event points
- Platform-credit balance
- Collected evidence or inventory
- Nearby activity indicator
- Team activity
- Leaderboard access
- Announcements

### 8.6 Challenge selection

Depending on event structure, the event centre must:

- Open the first required challenge in a sequential event
- Point to the latest available checkpoint
- Present multiple choices at a branch
- Display all available challenges in an open event
- Hide unrevealed secret challenges

### 8.7 Challenge completion

A challenge may contain multiple objectives. The player completes available objectives in the configured order. Each accepted objective is saved immediately by the server.

When all required objectives are complete, the challenge completion screen displays:

- Completion confirmation
- Event points awarded
- Platform credits awarded
- Item or evidence unlocked
- A story fragment or location fact
- The next challenge or decision
- A route back to the event centre

---

## 9. Event Model

### 9.1 Event lifecycle

Each event moves through these states:

1. `draft` — editable and invisible to ordinary users
2. `testing` — accessible to authorised testers without affecting production results
3. `scheduled` — published but not started
4. `live` — submissions and competition active
5. `paused` — temporarily blocks normal progression
6. `completed` — results finalising or final
7. `archived` — read-only historical event

### 9.2 Event duration

An event may:

- Run for several hours on one day
- Run across multiple days
- Have a fixed start and end time
- Permit rolling participant start times
- Contain challenges with separate availability windows
- Include location and non-location objectives

### 9.3 Participation modes

An event supports one of:

- Solo only
- Team only
- Solo or team

The default team capacity is five active members.

### 9.4 Winner modes

The first release supports:

- First to complete
- Highest event points
- Hybrid: points first, official finish time as tiebreaker

The initial campus mystery uses first to complete.

### 9.5 Progression modes

- Sequential: one challenge unlocks the next.
- Branching: decisions or completions unlock one of several routes.
- Dependency-based: a challenge unlocks after specified prerequisites.
- Open: several challenges are available concurrently.
- Scheduled: challenges unlock at configured times.
- Hidden: challenges remain invisible until discovered or unlocked.

### 9.6 Event configuration

Minor event-specific rules should be stored in a structured JSON configuration attached to the event. Examples include:

```json
{
  "participation": "solo_or_team",
  "maximumTeamSize": 5,
  "winnerMode": "first_to_complete",
  "lateJoinPenaltySeconds": 300,
  "leaderboardSize": 10,
  "publicLeaderboard": true,
  "nearbyPresence": true,
  "platformCreditsEnabled": true
}
```

JSON configuration reduces schema complexity, but critical searchable and relational facts—such as event identity, lifecycle status and dates—remain normal columns.

---

## 10. Challenge Model

### 10.1 Challenge composition

A challenge contains:

- Title
- Narrative description
- Visual or audio clue media
- Availability and unlock rules
- One or more objectives
- Optional hints
- Event-point reward
- Platform-credit reward
- Completion story or fact
- Next challenge or branch outcome

### 10.2 Objective types

The initial system supports:

| Objective | Description |
|---|---|
| `text_answer` | Normalised or exact text response |
| `numeric_answer` | Numeric response with optional tolerance |
| `multiple_choice` | Selection from configured choices |
| `ordered_sequence` | Ordered list or code sequence |
| `code` | Code obtained from a clue, person or activity |
| `location` | Server-validated geographical proximity |
| `decision` | Branch-selection choice |
| `timer` | Wait, duration or scheduled condition |
| `manual_approval` | Organiser confirms a physical activity |
| `media` | View or acknowledge released image/audio/video evidence |

### 10.3 Objective state

Each objective has one of these states for a participant:

- `locked`
- `available`
- `in_progress`
- `completed`

The server derives availability from challenge configuration and saved progress.

### 10.4 Answer validation

Correct answers and answer-normalisation rules must remain server-side. Locked or incomplete challenge responses must never include correct answers.

Validation modes include:

- Exact case-sensitive match
- Case-insensitive match
- Normalised spaces and punctuation
- Configured list of accepted answers
- Exact numeric match
- Numeric tolerance
- Ordered sequence match

Fuzzy matching is disabled by default because it creates unpredictable acceptance behaviour.

### 10.5 Attempts and cooldowns

Each objective may configure:

- Maximum attempts
- Delay after a wrong answer
- Progressive cooldown
- Event-point penalty
- Hint availability after failures

Server-side rate limits prevent scripted guessing. Error messages must not reveal partial correctness unless intentionally configured.

### 10.6 Objective-level autosaving

Every completed objective is upserted into durable progress using a uniqueness constraint on participant, challenge and objective key.

If a challenge contains a solved puzzle and an incomplete location objective, returning to the challenge shows the puzzle as complete. Refreshing the page, signing in on the second permitted device or temporarily losing connectivity must not erase progress.

### 10.7 Idempotency

Completion submissions include an idempotency key. Repeating a previously accepted request returns the existing completion rather than awarding rewards twice.

---

## 11. Location Experience and Validation

### 11.1 Navigation experience

A location challenge can provide any combination of:

- Narrative hint
- Location image
- General location or building name
- Compass direction
- Proximity band
- Approximate distance
- Exact distance
- Additional timed hints

The default campus configuration uses a hint, compass and proximity band.

### 11.2 Target-signal interface

The location interface should display:

```text
TARGET SIGNAL

Direction: Northeast
Proximity: Signal strong
Location accuracy: +/- 12 m

Hint:
Where silence is expected, knowledge is borrowed.
```

### 11.3 Default proximity bands

| Distance from target | Display |
|---:|---|
| More than 250 m | Signal extremely weak |
| 150–250 m | Signal weak |
| 80–150 m | Signal detected |
| 50–80 m | Signal improving |
| 20–50 m | Signal strong |
| Inside configured radius | Target reached |

The configured geofence radius, rather than the proximity band, determines whether the target is reached.

### 11.4 Location evidence

The default validation policy requires:

- Three recent browser geolocation readings
- Readings collected over a short duration, defaulting to approximately eight seconds
- All readings no older than one minute
- A valid authenticated event session
- An active location objective
- Server-side distance calculation
- Compliance with the configured geofence radius
- Compliance with the configured maximum reported accuracy

### 11.5 Configurable location parameters

Each location objective may configure:

```json
{
  "latitude": 28.612345,
  "longitude": 77.208765,
  "radiusMeters": 10,
  "maximumAccuracyMeters": 20,
  "requiredReadings": 3,
  "collectionDurationSeconds": 8,
  "readingsExpireAfterSeconds": 60
}
```

Geofence radius and reported accuracy are separate settings. The admin interface may allow a five-metre geofence but must warn that small radii can fail on some devices or near buildings. It should not block strict configurations.

### 11.6 Compass behaviour

The client should:

- Calculate target bearing from the latest location
- Use device orientation when available
- Use movement bearing as a fallback
- Provide a north-relative direction if orientation is unavailable
- Never require a valid compass heading for objective completion

Compass information is navigation assistance only. Server validation uses coordinates and configured location rules.

### 11.7 Overlapping locations

Checkpoints may be 30–50 metres apart. Overlap is handled primarily through challenge availability and branch selection. The server accepts location evidence only for an objective currently available to that participant.

If two nearby locations are alternative routes, the player selects the route before verification. Entering an overlapping physical area does not unlock every challenge in that area.

### 11.8 GPS spoofing policy

Advanced GPS spoofing is an accepted limitation. The platform performs standard browser-geolocation validation but does not attempt device attestation, invasive tracking or specialised spoof detection.

### 11.9 Location retention

Permanent storage should retain only the information necessary to explain an accepted verification, such as:

- Participant
- Challenge and objective
- Verification time
- Calculated distance
- Reported accuracy
- Completing user

Raw continuous movement history should not be stored permanently by default.

---

## 12. Team System

### 12.1 Team creation

An eligible user can create a team by choosing a team name. The creator becomes captain. Team names are subject to basic moderation and event-level uniqueness where configured.

### 12.2 Invitations and requests

Teams support:

- Shareable invitation links
- Revocable invite tokens
- Join requests
- Captain or authorised-member approval
- Request rejection
- Expiration of old invitations

An invite link does not add a user automatically. The user authenticates and submits a request, which the team approves.

### 12.3 Team capacity

A team contains no more than five active members. Capacity verification and approval occur atomically on the server so simultaneous approvals cannot exceed the limit.

### 12.4 Shared progression

Any active member may complete an objective for the team. Once accepted:

- The objective is complete for the entire team.
- The reward is applied once to the team.
- Eligible active members receive individual platform credits.
- The completing member is recorded.
- Every member sees the updated state.

### 12.5 Leaving a team

When a member leaves:

- The former team retains all progress and event points.
- Historical completions retain the identity of the completing user.
- The departing member no longer has access to team progress.
- The departing member returns to a new or existing zero-progress solo participant entry.
- The member carries no team objectives or event points into another participant.
- Previously and legitimately earned platform credits remain with the user.

### 12.6 Joining an advanced team

A joining member:

- Gains access to content already unlocked for the receiving team.
- Does not receive historical event points, credits, rewards or personal achievements.
- Receives platform credits only for eligible objectives completed after joining.
- May contribute to all future available objectives.

Credit eligibility is frozen using the active membership list at objective completion time.

### 12.7 Late membership penalty

The default first-to-finish penalty is five minutes added to the receiving team’s official finish time for every member accepted after the team completes its first required objective.

- Changes before the first completion have no penalty.
- Leaving creates no additional penalty.
- Rejoining counts as a new late join.
- The approval interface clearly states the penalty before confirmation.
- An organiser may waive a penalty, but the waiver must be audited.

### 12.8 Rejoining and rate limits

Leaving and rejoining are allowed without a hard limit. The default cooldown permits one join or leave per user every ten minutes. A receiving team can approve at most five membership changes in ten minutes. Administrative overrides are permitted.

### 12.9 Ownership and permissions

The captain can:

- Approve and reject requests
- Revoke invitations
- Remove members where event rules permit
- Transfer captaincy
- Grant or revoke `manage_members`

If the captain leaves, captaincy transfers to the longest-serving active member unless transferred manually first.

---

## 13. Scores, Credits, Rewards and Inventory

### 13.1 Event points

Event points belong to the participant and exist only within one event. They may be earned or reduced through:

- Challenge completion
- Optional objectives
- Difficulty bonuses
- Hint usage
- Wrong-answer penalties
- Team-change penalties in point-based events
- Organiser adjustments

### 13.2 Platform credits

Platform credits belong permanently to individual users and carry across events. They may be used for:

- Profile themes
- Titles and badges
- Cosmetic map markers
- Event memorabilia
- Optional lore
- Limited hint vouchers
- Team-banner customisation

Platform credits must not buy major competitive advantages.

### 13.3 Credit distribution

When a team completes a credit-bearing objective, only members active at the moment of completion receive the configured credit reward. A later member receives no retroactive credits.

### 13.4 Collectibles and inventory

Events may award:

- Story fragments
- Evidence cards
- Digital keys
- Decoder items
- Badges
- Optional route items

The initial implementation may store lightweight inventory inside participant progress data rather than introducing a separate inventory subsystem. A dedicated inventory table should be added only if items become transferable or highly interactive.

### 13.5 Completion facts

Challenges may display a short fact about the physical location, college culture, historical subject or story context. Facts are configured by organisers and shown after completion.

---

## 14. Leaderboards and Winner Determination

### 14.1 Live leaderboard presentation

The live leaderboard displays:

- Top 10 ranked participants by default
- Exact rank and official time for top participants
- The current participant’s rank even when outside the top 10
- Nearby ranks around the current participant
- Separate solo and team filters where both are allowed
- Provisional status while the event is live

Exact active challenge names of competing participants are not displayed.

### 14.2 Official completion time

Official time is determined by the server when the final required completion is committed. Client clocks and submitted timestamps are ignored.

For a race:

```text
Official finish = server completion time + accumulated time penalties
```

### 14.3 Ranking completed participants

Completed participants are ranked by earliest official finish.

### 14.4 Ranking unfinished participants

Unfinished participants are ranked by:

1. Number of required objectives completed
2. Current stage or route progress
3. Time of most recent required completion

### 14.5 Tie handling

If official completion timestamps are equal at database precision, the earliest accepted final-completion transaction wins. Organisers can investigate flagged results before marking the leaderboard final.

---

## 15. Nearby Presence, Minimap and Pings

### 15.1 Visibility model

The platform supports:

- Nearby participant counts
- Opted-in usernames
- Team-member presence
- Approximate activity zones
- Nearby pings

It does not expose exact public coordinates.

### 15.2 Presence preferences

Each user may choose:

- `visible`: included in counts and username lists
- `count_only`: included anonymously in counts
- `hidden`: excluded from public presence

The default is visible, but onboarding must explain the feature and provide an immediate opt-out.

### 15.3 Presence lifetime

Presence is temporary and expires approximately 90 seconds after the last qualifying update. It is active only while the participant is inside an active event experience.

### 15.4 Nearby minimap

The minimap should prioritise approximate activity rather than literal person markers. It may display:

- Named campus zones
- Number of active players per zone
- Opted-in usernames within the current challenge zone
- Team members separately
- The user’s active target direction

### 15.5 Public pings

- A user may ping nearby visible users once every ten minutes.
- Public pings use predefined signals rather than arbitrary free text in the initial release.
- Recipients may acknowledge, mute or disable pings.
- Pings reach only users currently eligible and nearby.

### 15.6 Team pings

Team members have no gameplay cooldown for normal pings, but the server applies a high technical ceiling, defaulting to 20 per minute, to prevent accidental loops and abuse.

Suggested team signals include:

- Come here
- Challenge found
- Need help
- Ready to move
- Wait for me

### 15.7 Presence implementation

Presence and pings are temporary and should not create continuous D1 writes. An optional Durable Object per live event manages active presence, zone counts and ping delivery. If the social-presence feature is deferred from the MVP, Durable Objects can also be deferred.

---

## 16. Admin Experience

### 16.1 Admin areas

Protected admin routes include:

```text
/admin
/admin/events
/admin/events/:eventId
/admin/events/:eventId/challenges
/admin/events/:eventId/routes
/admin/events/:eventId/locations
/admin/events/:eventId/participants
/admin/events/:eventId/teams
/admin/events/:eventId/live
/admin/events/:eventId/rewards
/admin/events/:eventId/results
/admin/audit
```

### 16.2 Dashboard overview

The admin home page displays:

- Draft, scheduled and live events
- Current participant counts
- Recent administrative actions
- Events requiring attention
- Quick actions for creating or duplicating an event

### 16.3 Event builder

Administrators can:

- Create an event
- Duplicate an existing event
- Edit event identity and introduction
- Configure dates and registration rules
- Choose solo/team participation
- Configure team size and late-change penalties
- Configure winner and leaderboard rules
- Upload onboarding and story media
- Preview the event as a player
- Validate and publish the event

### 16.4 Challenge builder

Administrators can:

- Create and reorder challenges
- Add objectives
- Configure server-side answers
- Add clue text, images and audio
- Configure hints and unlock timing
- Select locations on a map
- Configure radius, accuracy, readings and expiry
- Configure points and credit rewards
- Configure completion facts and story fragments
- Connect prerequisites and branch outcomes
- Duplicate challenges
- Test validation without creating production progress

### 16.5 Route configuration

The initial release can use a structured list and dependency selector rather than a complex graphical editor. It must still detect:

- Missing prerequisites
- Unreachable challenges
- Direct dependency cycles
- Branches without a completion path
- Missing final targets

A visual route graph may be added later as an editing enhancement.

### 16.6 Location configuration

The admin location editor provides:

- Map point selection
- Manual latitude and longitude entry
- Radius control
- Maximum accuracy control
- Required reading count
- Reading-expiry control
- Guidance preview
- Warning for strict radii
- Player-view simulation

### 16.7 Live control room

During an event, administrators can:

- Start, pause, resume or end the event
- View approximate participant distribution
- View completion and failure rates
- Send announcements
- Temporarily disable a challenge
- Open an alternate route
- Adjust a location radius
- Manually complete an objective
- Reverse an incorrect completion
- Apply or waive penalties
- Support participants with location or accessibility problems
- Mark results final

### 16.8 Publishing and version safety

Editing a live event must not silently invalidate progress. Significant structural changes should create a new configuration version or require explicit confirmation.

Completed and archived events are read-only by default. Event deletion should initially mean archival rather than permanent deletion.

### 16.9 Auditability

Sensitive actions are recorded with:

- Administrator identity
- Action type
- Entity type and identity
- Timestamp
- Before/after or explanatory details where appropriate

---

## 17. Authentication and Authorisation

### 17.1 User authentication

The platform accepts any supported authenticated user. Email verification is required before event participation, team creation or administrative access.

### 17.2 Administrative browser access

Admin access requires:

1. A valid signed authentication token
2. A verified email claim from that token
3. A match against `ADMIN_EMAILS` stored in server environment configuration
4. Server-side authorisation on every `/api/admin/*` endpoint

The system must never trust an email supplied through a request body, query string or arbitrary header.

Cloudflare Access may be placed in front of `/admin/*` as an additional gate, but application-level authorisation remains mandatory.

### 17.3 Programmatic admin access

If curl or automation access is needed, it uses a separate bearer service token rather than an administrator email. Service tokens should be scoped, for example:

- `events:read`
- `events:write`
- `challenges:write`
- `participants:moderate`

### 17.4 Device policy

An account may use up to two active devices. This is an operational policy rather than an aggressive account-sharing defence. The initial implementation may track active authenticated sessions rather than attempt hardware fingerprinting.

### 17.5 Turnstile

Turnstile should protect high-risk actions such as:

- Account creation or initial sign-in where appropriate
- Starting suspicious sessions
- Repeated failed answer submissions
- High-frequency team operations
- Final claims flagged by basic abuse rules

Turnstile is not treated as location verification.

### 17.6 Rate limiting

Rate limits apply to:

- Authentication attempts
- Answer submissions
- Location verification attempts
- Team invitations and membership changes
- Public pings
- Administrative service-token requests

Rate limits must use authenticated user, participant and route identity where possible rather than IP address alone.

---

## 18. Data Model

The initial durable data model uses approximately nine primary D1 tables. JSON is used for configuration that varies substantially by event, while identity, ownership, progress and timing remain relational.

### 18.1 `users`

```text
id                  TEXT PRIMARY KEY
auth_provider_id    TEXT UNIQUE NOT NULL
email               TEXT NOT NULL
email_verified      INTEGER NOT NULL
username            TEXT UNIQUE NOT NULL
display_name        TEXT
platform_credits    INTEGER NOT NULL DEFAULT 0
presence_visibility TEXT NOT NULL DEFAULT 'visible'
created_at          TEXT NOT NULL
updated_at          TEXT NOT NULL
```

### 18.2 `events`

```text
id             TEXT PRIMARY KEY
name           TEXT NOT NULL
slug           TEXT UNIQUE NOT NULL
description    TEXT
status         TEXT NOT NULL
starts_at      TEXT
ends_at        TEXT
settings_json  TEXT NOT NULL
created_by     TEXT NOT NULL REFERENCES users(id)
created_at     TEXT NOT NULL
updated_at     TEXT NOT NULL
```

### 18.3 `participants`

Represents one solo or team entry in one event.

```text
id               TEXT PRIMARY KEY
event_id         TEXT NOT NULL REFERENCES events(id)
type             TEXT NOT NULL CHECK(type IN ('solo','team'))
name             TEXT NOT NULL
event_points     INTEGER NOT NULL DEFAULT 0
penalty_seconds  INTEGER NOT NULL DEFAULT 0
started_at       TEXT
completed_at     TEXT
created_at       TEXT NOT NULL
updated_at       TEXT NOT NULL
```

### 18.4 `participant_members`

```text
id              TEXT PRIMARY KEY
participant_id  TEXT NOT NULL REFERENCES participants(id)
user_id         TEXT NOT NULL REFERENCES users(id)
role            TEXT NOT NULL DEFAULT 'member'
joined_at       TEXT NOT NULL
left_at         TEXT
```

An active membership has `left_at IS NULL`. Application transactions enforce one active participant per user per event and a maximum of five active members for team participants.

### 18.5 `team_invites`

```text
id                 TEXT PRIMARY KEY
participant_id     TEXT NOT NULL REFERENCES participants(id)
invited_by         TEXT NOT NULL REFERENCES users(id)
token_hash         TEXT
requested_user_id  TEXT REFERENCES users(id)
status             TEXT NOT NULL
expires_at         TEXT
created_at         TEXT NOT NULL
updated_at         TEXT NOT NULL
```

### 18.6 `challenges`

```text
id                  TEXT PRIMARY KEY
event_id            TEXT NOT NULL REFERENCES events(id)
title               TEXT NOT NULL
description         TEXT
position            INTEGER NOT NULL
configuration_json  TEXT NOT NULL
created_at           TEXT NOT NULL
updated_at           TEXT NOT NULL
```

Challenge configuration contains objectives, dependencies, navigation settings, rewards, hints and completion content. Correct answers remain available only to server-side code and protected admin responses.

### 18.7 `objective_progress`

```text
id               TEXT PRIMARY KEY
participant_id   TEXT NOT NULL REFERENCES participants(id)
challenge_id     TEXT NOT NULL REFERENCES challenges(id)
objective_key    TEXT NOT NULL
status           TEXT NOT NULL
completed_by     TEXT REFERENCES users(id)
completed_at     TEXT
data_json        TEXT
idempotency_key  TEXT
created_at       TEXT NOT NULL
updated_at       TEXT NOT NULL

UNIQUE(participant_id, challenge_id, objective_key)
UNIQUE(idempotency_key)
```

### 18.8 `credit_transactions`

```text
id            TEXT PRIMARY KEY
user_id       TEXT NOT NULL REFERENCES users(id)
event_id      TEXT REFERENCES events(id)
amount        INTEGER NOT NULL
reason        TEXT NOT NULL
reference_id  TEXT
created_at    TEXT NOT NULL
```

`users.platform_credits` provides the current balance while transactions explain changes. Balance updates and transaction insertion occur atomically.

### 18.9 `audit_log`

```text
id             TEXT PRIMARY KEY
admin_user_id  TEXT NOT NULL REFERENCES users(id)
action         TEXT NOT NULL
entity_type    TEXT NOT NULL
entity_id      TEXT NOT NULL
details_json   TEXT
created_at     TEXT NOT NULL
```

### 18.10 Intentional omissions

The initial model does not create separate tables for:

- Locations
- Hints
- Challenge dependencies
- Objective definitions
- Inventory
- Score events
- Finish records

These remain within event/challenge configuration or participant progress until product requirements justify independent relational behaviour. This choice keeps the first schema compact.

---

## 19. API Requirements

### 19.1 User and event APIs

```text
GET  /api/me
PATCH /api/me

GET  /api/events
GET  /api/events/:eventId
POST /api/events/:eventId/register
POST /api/events/:eventId/start
GET  /api/events/:eventId/state
GET  /api/events/:eventId/leaderboard
```

### 19.2 Team APIs

```text
POST /api/events/:eventId/teams
POST /api/participants/:participantId/invites
POST /api/invites/:token/request
POST /api/join-requests/:requestId/approve
POST /api/join-requests/:requestId/reject
POST /api/participants/:participantId/leave
POST /api/participants/:participantId/transfer-captain
```

### 19.3 Challenge APIs

```text
GET  /api/challenges/:challengeId
POST /api/challenges/:challengeId/objectives/:objectiveKey/submit
POST /api/challenges/:challengeId/objectives/:objectiveKey/location-session
POST /api/challenges/:challengeId/objectives/:objectiveKey/verify-location
POST /api/challenges/:challengeId/hints/:hintKey/unlock
```

### 19.4 Presence APIs

```text
POST /api/events/:eventId/presence
GET  /api/events/:eventId/nearby
POST /api/events/:eventId/pings
GET  /api/events/:eventId/pings
```

### 19.5 Admin APIs

```text
POST   /api/admin/events
PATCH  /api/admin/events/:eventId
POST   /api/admin/events/:eventId/duplicate
POST   /api/admin/events/:eventId/publish
POST   /api/admin/events/:eventId/pause
POST   /api/admin/events/:eventId/resume
POST   /api/admin/events/:eventId/end

POST   /api/admin/events/:eventId/challenges
PATCH  /api/admin/challenges/:challengeId
DELETE /api/admin/challenges/:challengeId

POST   /api/admin/objectives/:objectiveId/manual-completion
POST   /api/admin/participants/:participantId/penalties
POST   /api/admin/penalties/:penaltyId/waive
POST   /api/admin/events/:eventId/announcements
GET    /api/admin/audit
```

### 19.6 Common API behaviour

All protected APIs must:

- Verify authentication
- Resolve event eligibility
- Resolve the user’s active participant
- Validate event lifecycle state
- Validate challenge and objective availability
- Apply rate limits
- Use server-generated timestamps
- Return stable machine-readable error codes
- Avoid returning hidden answers or unrevealed content

---

## 20. Technical Architecture

### 20.1 Components

| Component | Responsibility |
|---|---|
| Mobile web/PWA | Player and admin user interfaces |
| Cloudflare Workers | Hosting, routing, APIs and authoritative logic |
| D1 | Users, events, participants, challenges and permanent progress |
| R2 | Clue images, audio, video and event media |
| Turnstile | Bot and automated-abuse resistance |
| Durable Object, optional | Temporary event presence, zone counts and pings |

### 20.2 Frontend approach

The frontend should be mobile-first and installable as a Progressive Web App where practical. Astro with interactive islands or a lightweight React-based client is acceptable. Framework choice should prioritise:

- Reliable mobile navigation
- Small client bundle
- Accessible components
- Easy Worker deployment
- Clear separation between public, player and admin experiences

### 20.3 Backend approach

One Worker application may serve both frontend assets and API routes. A modular monolith is preferred over microservices.

Suggested internal modules:

```text
auth
events
participants
teams
challenges
location
rewards
leaderboard
presence
admin
```

### 20.4 Real-time behaviour

Normal API polling every 10–20 seconds is sufficient for leaderboards and most game state. WebSockets should be introduced only for features that materially benefit, such as immediate team updates or organiser broadcasts.

### 20.5 Deployment environments

Maintain separate:

- Local development
- Preview/staging
- Production

Each environment must use separate secrets, Turnstile configuration and preferably separate D1 databases or isolated data.

---

## 21. Security Requirements

1. All state-changing operations require authentication.
2. Every completion is validated against the active participant and event.
3. Correct answers remain server-side.
4. Official timestamps are generated by the server/database.
5. Team capacity and membership penalties are applied atomically.
6. Reward issuance and progress completion are idempotent.
7. Admin APIs verify signed identity and allowlisted verified email.
8. Service tokens are separate from browser administrator identity.
9. Secrets are stored in server environment configuration and never exposed to the client.
10. Location distance is recalculated on the server.
11. Rate limits protect answer, location, team and ping endpoints.
12. Public responses exclude exact player coordinates and private emails.
13. Uploaded media is validated for type and size.
14. Content Security Policy and secure headers are configured.
15. Audit logs record sensitive organiser actions.

### 21.1 Accepted security limitations

- A determined user may spoof browser coordinates.
- Competitors may communicate answers outside the platform.
- Direct API calls are possible but provide no advantage when validation is correct.
- Two-device usage and consensual account sharing are accepted within the stated policy.

---

## 22. Privacy, Safety and Accessibility

### 22.1 Privacy

- Explain location usage before requesting permission.
- Use location only during active event interaction.
- Do not expose exact public coordinates.
- Allow public-presence opt-out.
- Avoid permanent continuous route storage.
- Use usernames rather than emails in social features.
- Define retention periods for event progress and audit data.

### 22.2 Physical safety

Organisers must not place required objectives near:

- Active roads
- Rooftops
- Construction areas
- Restricted rooms
- Laboratories without permission
- Unsafe stairs or isolated areas

The interface must discourage running and display an organiser or emergency-contact route.

### 22.3 Accessibility

- Admins can manually verify inaccessible location objectives.
- Events may offer alternative non-location routes.
- Text contrast and touch targets meet mobile accessibility standards.
- Navigation does not depend exclusively on colour.
- Images support alternative text.
- Audio clues provide transcripts where the puzzle permits.
- Animations respect reduced-motion preferences.

Manual overrides create audit records.

---

## 23. Non-Functional Requirements

### 23.1 Capacity

- Support up to 400 simultaneous participants.
- Support at least 100 active solo/team participant entries.
- Avoid continuous D1 location writes.
- Paginate admin participant and audit views.

### 23.2 Performance

- Event centre should become interactive within three seconds on ordinary campus Wi-Fi and modern mid-range phones.
- Standard API reads should normally respond within one second, excluding external authentication or Turnstile delays.
- Objective submissions must provide visible pending, success and failure states.
- Media must use responsive sizes and lazy loading.

### 23.3 Reliability

- Duplicate submissions must not duplicate rewards.
- Refreshing or changing devices must restore server-saved progress.
- A failed request must be safely retryable where an idempotency key is present.
- Event pause and emergency announcements must take effect without redeployment.

### 23.4 Maintainability

- Use one shared participant progression path for solo and team modes.
- Store event variations through validated configuration.
- Keep business rules in server modules rather than UI components.
- Validate configuration before event publishing.
- Make event duplication a first-class feature.
- Use database migrations and version-controlled configuration schemas.

### 23.5 Observability

The system should record operational metrics such as:

- Active users per event
- Objective completion rate
- Wrong-answer rate
- Location verification failure rate
- Median time per challenge
- Hint usage
- Team membership changes
- API errors and rate-limit events

Operational logging must avoid unnecessarily recording raw coordinates or correct answers.

---

## 24. Error and Edge-Case Behaviour

### 24.1 Location unavailable

The player sees an explanation and retry path. If the device repeatedly fails, the UI provides organiser support rather than silently blocking progress.

### 24.2 Poor GPS accuracy

Display the reported uncertainty and request that the player wait or move into an open area. Do not mark the answer wrong.

### 24.3 Objective completed concurrently

If two team members submit the same objective, one transaction creates the completion. The other receives the existing successful result.

### 24.4 Team becomes full during approval

The server rejects the later approval cleanly. No penalty or membership row is created for the rejected request.

### 24.5 Member leaves during submission

Membership is checked inside the completion transaction. The result belongs to whichever participant the user was actively and validly representing at commit time.

### 24.6 Event paused during a challenge

New completion attempts receive an event-paused response. Locally entered unsent text may be retained as a draft, but no completion is awarded.

### 24.7 Event ends during submission

The server’s receipt/transaction time determines eligibility. Client time is irrelevant.

### 24.8 Admin changes a live challenge

The admin receives a warning. Structural changes require explicit confirmation and must not automatically delete existing participant progress.

### 24.9 User denies nearby presence

The user continues normal gameplay without appearing in counts or username lists according to the selected visibility state.

---

## 25. MVP Acceptance Criteria

The MVP is ready for a controlled pilot when all of the following are true:

### Authentication and profiles

- A user can sign in with a verified account.
- A first-time user can create a unique username.
- Unauthenticated users cannot submit event state.
- Non-admin users cannot access admin APIs.

### Events

- An admin can create, edit, test, publish, pause, complete and archive an event.
- An event can allow solo, team or mixed participation.
- An admin can duplicate an event.

### Teams

- A user can create a team and share an invitation.
- A captain can approve or reject a request.
- A team cannot exceed five active members.
- Any active member can complete an objective for the team.
- A leaving member returns to zero individual progress.
- The former team retains its progress.
- A late join adds a visible five-minute penalty.
- A new member receives no historical credits.

### Challenges

- An admin can create a challenge with multiple objectives.
- Text answers are validated server-side.
- A location objective uses three recent readings and server-side distance.
- Completed objectives remain complete after refresh and sign-in on another permitted device.
- Rewards cannot be duplicated by retrying a request.
- A branch can unlock one route without exposing the alternative as active.

### Navigation

- A player can view clue text, compass direction and proximity state.
- The interface falls back gracefully when device orientation is unavailable.
- The configured geofence and accuracy limits are applied independently.

### Competition

- The leaderboard shows the top 10 and the current participant’s rank.
- Official finish time is assigned by the server.
- Team time penalties affect official ranking.

### Admin operations

- The admin can preview the player experience.
- The admin can manually complete an objective.
- The admin can adjust or waive a penalty with an audit entry.
- The admin can send an event announcement.

### Pilot scale

- A test with 5–10 users on multiple phone models completes successfully.
- A load test models the expected request pattern for up to 400 participants.
- Location points are physically tested on campus before publication.

---

## 26. Delivery Plan

### Phase 0: Product and content preparation

- Finalise product name and visual direction
- Map the first event narrative and route graph
- Measure and test physical locations
- Define the authentication provider
- Establish staging and production environments

### Phase 1: Core MVP

- Authentication and profile creation
- Event model and lifecycle
- Unified solo/team participant model
- Team invitations and membership
- Challenge rendering
- Text, choice, code and location objectives
- Objective-level autosaving
- Event points and platform credits
- Basic leaderboard
- Protected admin event/challenge forms

### Phase 2: Pilot readiness

- Branching routes
- Compass and proximity polish
- Completion animations and facts
- Late-team-change penalties
- Admin preview and validation
- Manual overrides and audit log
- Error handling and accessibility fallbacks
- Multi-device and load testing

### Phase 3: Social and live operations

- Nearby presence
- Approximate minimap counts
- Public and team pings
- Live organiser announcements
- Crowd distribution view
- Expanded live control room

### Phase 4: Platform expansion

- Event templates
- Visual route editor
- Inventory and richer collectibles
- Multiple endings
- Global unlock events
- Advanced analytics
- Reusable content packs

---

## 27. Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| GPS performs poorly near buildings | Players cannot progress | Configurable radius/accuracy, physical testing and admin override |
| Nearby checkpoints overlap | Incorrect location appears reachable | Only active branch is eligible; use objective-specific validation |
| Large crowds form at one location | Poor experience and safety concerns | Multiple routes, live density monitoring and alternate challenge activation |
| Team hopping creates advantage | Competitive unfairness | Five-minute late-join penalty, no historical credits and membership cooldown |
| Progress is awarded twice | Ranking and credit corruption | Unique constraints, transactions and idempotency keys |
| Admin configuration creates impossible route | Event becomes blocked | Pre-publish dependency validation and player preview |
| Hidden answers leak through APIs | Competition compromised | Server-only validation and response filtering |
| Continuous presence overloads D1 | Performance degradation | Temporary Durable Object presence and throttled updates |
| Players deny location permission | Location challenge blocked | Clear instructions, retry flow and organiser accessibility override |
| Event edits damage live progress | Inconsistent state | Draft/testing lifecycle, explicit warnings and version-safe changes |

---

## 28. Future Opportunities

The platform can later become a broader college engagement system rather than a single-event application. Possible extensions include:

- Department-created events with approval workflows
- Annual inter-college mystery competitions
- Persistent campus lore and collectible archives
- Location-independent logic tournaments
- Orientation routes for new students
- Club discovery trails
- Seasonal event campaigns
- Player-created teams persisting across events
- Achievement history and long-term profiles
- Spectator mode for completed routes
- Sponsor-supported cosmetic rewards without affecting competition

These features should be evaluated only after the core event engine proves reliable in a real campus pilot.

---

## 29. Fixed Defaults

Unless an event explicitly overrides them, the platform uses:

| Setting | Default |
|---|---|
| Maximum team size | Five |
| Devices per account | Two |
| Late team-join penalty | Five minutes |
| Membership change cooldown | Ten minutes |
| Required location readings | Three |
| Location-reading validity | One minute |
| Location collection duration | Eight seconds |
| Strong-signal band | 20–50 metres |
| Presence expiry | 90 seconds |
| Public ping cooldown | Ten minutes |
| Team ping technical limit | 20 per minute |
| Leaderboard display | Top 10 plus current position |
| Progress ownership | Participant, solo or team |
| Objective completion | Any active team member completes for team |
| Historical credits for new members | None |
| Event editing | Draft/testing before publication |
| Event removal | Archive by default |
| Live leaderboard updates | Poll every 10–20 seconds |

---

## 30. Final Product Summary

The Campus Mystery Event Platform is a mobile-first, Cloudflare-hosted event engine for individual and team competitions. Its defining architectural choice is a unified participant model: a solo player and a team use the same challenge, progression, scoring and leaderboard system. Challenges consist of independently saved objectives, allowing puzzles, codes, locations and decisions to coexist without forcing players to repeat completed work.

The first event will support approximately 400 participants, teams of up to five, branching campus routes, configurable geofences, compass and proximity navigation, first-to-finish ranking, persistent platform credits, event-specific points and protected organiser controls. The architecture remains intentionally compact: one Worker application, one D1 database, one R2 bucket, Turnstile and an optional Durable Object for ephemeral social presence.

The platform accepts ordinary limitations such as GPS spoofing and off-platform answer sharing. Its security effort is concentrated where it matters: server-side validation, hidden answers, authoritative timestamps, transactional team operations, idempotent rewards, rate limits and protected administrative routes.

The immediate success criterion is not feature quantity. It is the ability to configure, test and run one polished campus mystery from start to finish without manual spreadsheets, lost progress, ambiguous results or code changes for individual challenges.
