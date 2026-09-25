import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@clerk/react";
import { Link, Navigate, useParams } from "react-router";
import ChallengeCard from "../components/ChallengeCard";
import type { ChallengeStatus } from "../components/ChallengeCard";
import Countdown from "../components/Countdown";
import { apiGet } from "../lib/api";

interface StateChallenge {
  id: string;
  title: string;
  description: string | null;
  position: number;
  locked: boolean;
}

interface Announcement {
  id: string;
  title: string;
  body: string;
  publishedAt: string | null;
}

interface EventState {
  event: {
    id: string;
    name: string;
    description: string | null;
    status: string;
    startsAt: string | null;
    endsAt: string | null;
  };
  participant: {
    id: string;
    type: string;
    name: string;
    eventPoints: number;
    penaltySeconds: number;
    startedAt: string | null;
    completedAt: string | null;
  } | null;
  counts: { challenges: number; participants: number };
  challenges: StateChallenge[];
  announcements: Announcement[];
}

interface Credits {
  balance: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isStateChallenge(value: unknown): value is StateChallenge {
  return (
    isRecord(value) &&
    typeof value["id"] === "string" &&
    typeof value["title"] === "string" &&
    (typeof value["description"] === "string" || value["description"] === null) &&
    typeof value["position"] === "number" &&
    typeof value["locked"] === "boolean"
  );
}

function isAnnouncement(value: unknown): value is Announcement {
  return (
    isRecord(value) &&
    typeof value["id"] === "string" &&
    typeof value["title"] === "string" &&
    typeof value["body"] === "string"
  );
}

function isEventState(value: unknown): value is EventState {
  if (!isRecord(value)) return false;
  const event = value["event"];
  const participant = value["participant"];
  const counts = value["counts"];
  const challenges = value["challenges"];
  const announcements = value["announcements"];
  return (
    isRecord(event) &&
    typeof event["id"] === "string" &&
    typeof event["name"] === "string" &&
    (participant === null ||
      (isRecord(participant) &&
        typeof participant["id"] === "string" &&
        typeof participant["name"] === "string" &&
        typeof participant["eventPoints"] === "number")) &&
    isRecord(counts) &&
    typeof counts["challenges"] === "number" &&
    typeof counts["participants"] === "number" &&
    Array.isArray(challenges) &&
    challenges.every(isStateChallenge) &&
    Array.isArray(announcements) &&
    announcements.every(isAnnouncement)
  );
}

function isCredits(value: unknown): value is Credits {
  return isRecord(value) && typeof value["balance"] === "number";
}

function challengeStatus(challenge: StateChallenge, completed: boolean): ChallengeStatus {
  if (completed) return "completed";
  if (challenge.locked) return "locked";
  return "available";
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

  const credits = useQuery({
    queryKey: ["me", "credits"],
    queryFn: () => apiGet("/me/credits", isCredits),
    enabled: isSignedIn === true,
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
            <p className="eyebrow">{state.data.event.status === "live" ? "Live now" : state.data.event.status}</p>
            <h1>{state.data.event.name}</h1>
            {state.data.event.description ? <p>{state.data.event.description}</p> : null}
            {state.data.event.endsAt ? <Countdown targetIso={state.data.event.endsAt} label="Ends in" /> : null}
            {state.data.event.startsAt && !state.data.event.endsAt ? (
              <Countdown targetIso={state.data.event.startsAt} label="Starts in" />
            ) : null}
          </header>

          <section aria-label="Participant">
            <h2>Playing as</h2>
            <p>{state.data.participant?.name ?? "Not registered yet"}</p>
            {state.data.participant?.completedAt ? (
              <p role="status">Event complete. Official time was set by the server.</p>
            ) : null}
          </section>

          <section aria-label="Score">
            <h2>Score</h2>
            <p>
              {state.data.participant?.eventPoints ?? 0} event points ·{" "}
              {credits.data?.balance ?? 0} credits · {state.data.counts.participants} participants
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
                  {challenge.locked ? (
                    <ChallengeCard
                      title={challenge.title}
                      narrative="Unlock earlier challenges to reveal this one."
                      status={challengeStatus(challenge, false)}
                      points={0}
                      lockedReason="Complete the previous steps first."
                    />
                  ) : (
                    <Link to={`/events/${eventId}/challenges/${challenge.id}`} aria-label={`Open ${challenge.title}`}>
                      <ChallengeCard
                        title={challenge.title}
                        narrative={challenge.description ?? "Open to see the objectives."}
                        status={challengeStatus(challenge, false)}
                        points={state.data.participant?.eventPoints ?? 0}
                      />
                    </Link>
                  )}
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
                  <h3>{item.title}</h3>
                  <p>{item.body}</p>
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
