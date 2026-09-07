import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@clerk/react";
import { Link, Navigate, useParams } from "react-router";
import ChallengeCard from "../components/ChallengeCard";
import type { ChallengeStatus } from "../components/ChallengeCard";
import Countdown from "../components/Countdown";
import { apiGet } from "../lib/api";

interface ChallengeSummary {
  id: string;
  title: string;
  narrative: string;
  status: ChallengeStatus;
  points: number;
  lockedReason: string | null;
}

interface Announcement {
  id: string;
  body: string;
}

interface EventState {
  eventId: string;
  eventName: string;
  chapter: string | null;
  startsAt: string | null;
  endsAt: string | null;
  participantName: string | null;
  teamMemberCount: number | null;
  currentObjective: string | null;
  completedChallenges: number;
  eventPoints: number;
  creditBalance: number;
  announcements: Announcement[];
  challenges: ChallengeSummary[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isStatus(value: unknown): value is ChallengeStatus {
  return value === "locked" || value === "available" || value === "in_progress" || value === "completed";
}

function isChallengeSummary(value: unknown): value is ChallengeSummary {
  if (!isRecord(value)) return false;
  return (
    typeof value["id"] === "string" &&
    typeof value["title"] === "string" &&
    typeof value["narrative"] === "string" &&
    isStatus(value["status"]) &&
    typeof value["points"] === "number" &&
    (typeof value["lockedReason"] === "string" || value["lockedReason"] === null)
  );
}

function isAnnouncement(value: unknown): value is Announcement {
  if (!isRecord(value)) return false;
  return typeof value["id"] === "string" && typeof value["body"] === "string";
}

function isEventState(value: unknown): value is EventState {
  if (!isRecord(value)) return false;
  const challenges = value["challenges"];
  const announcements = value["announcements"];
  return (
    typeof value["eventId"] === "string" &&
    typeof value["eventName"] === "string" &&
    (typeof value["chapter"] === "string" || value["chapter"] === null) &&
    (typeof value["startsAt"] === "string" || value["startsAt"] === null) &&
    (typeof value["endsAt"] === "string" || value["endsAt"] === null) &&
    (typeof value["participantName"] === "string" || value["participantName"] === null) &&
    (typeof value["teamMemberCount"] === "number" || value["teamMemberCount"] === null) &&
    (typeof value["currentObjective"] === "string" || value["currentObjective"] === null) &&
    typeof value["completedChallenges"] === "number" &&
    typeof value["eventPoints"] === "number" &&
    typeof value["creditBalance"] === "number" &&
    Array.isArray(announcements) &&
    announcements.every(isAnnouncement) &&
    Array.isArray(challenges) &&
    challenges.every(isChallengeSummary)
  );
}

export default function EventCentre() {
  const { isLoaded, isSignedIn } = useAuth();
  const params = useParams();
  const eventId = params["eventId"] ?? "";

  const state = useQuery({
    queryKey: ["events", eventId, "state"],
    queryFn: () => apiGet(`/events/${eventId}/state`, isEventState),
    enabled: eventId.length > 0 && isSignedIn === true,
    refetchInterval: 15_000
  });

  if (!isLoaded) {
    return (
      <main>
        <p role="status">Loading…</p>
      </main>
    );
  }

  if (!isSignedIn) {
    return <Navigate to="/login" replace />;
  }

  return (
    <main aria-busy={state.isPending}>
      {state.isPending ? <p role="status">Loading event centre…</p> : null}
      {state.isError ? (
        <p role="alert">Could not load this event. Check your connection and retry.</p>
      ) : null}
      {state.data ? (
        <>
          <header>
            <p className="eyebrow">{state.data.chapter ?? "Event centre"}</p>
            <h1>{state.data.eventName}</h1>
            {state.data.endsAt ? <Countdown targetIso={state.data.endsAt} label="Ends in" /> : null}
            {state.data.startsAt && !state.data.endsAt ? (
              <Countdown targetIso={state.data.startsAt} label="Starts in" />
            ) : null}
          </header>

          <section aria-label="Participant">
            <h2>Playing as</h2>
            <p>{state.data.participantName ?? "Not registered yet"}</p>
            {state.data.teamMemberCount !== null ? <p>Team members: {state.data.teamMemberCount}</p> : null}
            {state.data.currentObjective ? <p>Current objective: {state.data.currentObjective}</p> : null}
          </section>

          <section aria-label="Score">
            <h2>Score</h2>
            <p>
              {state.data.eventPoints} event points · {state.data.creditBalance} credits ·{" "}
              {state.data.completedChallenges} challenges completed
            </p>
            <Link className="button" to={`/events/${eventId}/leaderboard`}>
              View leaderboard
            </Link>
          </section>

          <section aria-label="Challenges">
            <h2>Challenges</h2>
            {state.data.challenges.length === 0 ? <p>No challenges are available yet.</p> : null}
            <ul className="stack">
              {state.data.challenges.map((challenge) => (
                <li key={challenge.id}>
                  <Link to={`/events/${eventId}/challenges/${challenge.id}`} aria-label={`Open ${challenge.title}`}>
                    <ChallengeCard
                      title={challenge.title}
                      narrative={challenge.narrative}
                      status={challenge.status}
                      points={challenge.points}
                      lockedReason={challenge.lockedReason ?? undefined}
                    />
                  </Link>
                </li>
              ))}
            </ul>
          </section>

          <section aria-label="Announcements">
            <h2>Announcements</h2>
            {state.data.announcements.length === 0 ? <p>No announcements yet.</p> : null}
            <ul className="stack">
              {state.data.announcements.map((item) => (
                <li key={item.id} className="card">
                  {item.body}
                </li>
              ))}
            </ul>
          </section>

          <nav aria-label="Event">
            <Link className="button" to={`/events/${eventId}/team`}>
              Team
            </Link>
          </nav>
        </>
      ) : null}
    </main>
  );
}
