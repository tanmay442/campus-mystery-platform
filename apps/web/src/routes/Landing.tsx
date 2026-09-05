import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import Countdown from "../components/Countdown";
import { apiGet } from "../lib/api";

interface PromotedEvent {
  id: string;
  name: string;
  description: string | null;
  startsAt: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isPromotedEvent(value: unknown): value is PromotedEvent {
  if (!isRecord(value)) return false;
  return (
    typeof value["id"] === "string" &&
    typeof value["name"] === "string" &&
    (typeof value["description"] === "string" || value["description"] === null) &&
    (typeof value["startsAt"] === "string" || value["startsAt"] === null)
  );
}

function isPromotedList(value: unknown): value is { events: PromotedEvent[] } {
  if (!isRecord(value)) return false;
  const events = value["events"];
  return Array.isArray(events) && events.every(isPromotedEvent);
}

export default function Landing() {
  const promoted = useQuery({
    queryKey: ["events", "promoted"],
    queryFn: () => apiGet("/events", isPromotedList)
  });
  const event = promoted.data?.events[0] ?? null;

  return (
    <main>
      <header className="hero">
        <p className="eyebrow">Campus Mystery</p>
        <h1>Turn the campus into a game board</h1>
        <p>
          Solve puzzles, follow signals to real locations, and race other players and teams to finish first. Solo or in
          teams of up to five.
        </p>
        <div className="actions">
          <Link className="button button-primary" to="/login">
            Sign in to play
          </Link>
          <Link className="button" to="/onboarding">
            How it works
          </Link>
        </div>
      </header>

      <section aria-label="Promoted event" aria-busy={promoted.isPending}>
        <h2>Featured event</h2>
        {promoted.isPending ? <p role="status">Loading the featured event…</p> : null}
        {promoted.isError ? <p role="alert">Could not load the featured event. Pull to refresh and retry.</p> : null}
        {promoted.isSuccess && event === null ? <p>No event is promoted right now. Check back soon.</p> : null}
        {event ? (
          <article className="card">
            <h3>{event.name}</h3>
            {event.description ? <p>{event.description}</p> : null}
            {event.startsAt ? <Countdown targetIso={event.startsAt} label="Starts in" /> : null}
            <Link className="button button-primary" to={`/events/${event.id}`}>
              Open event centre
            </Link>
          </article>
        ) : null}
      </section>
    </main>
  );
}
