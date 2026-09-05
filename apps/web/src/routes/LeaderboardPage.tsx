import { useQuery } from "@tanstack/react-query";
import { useParams, useSearchParams } from "react-router";
import Leaderboard from "../components/Leaderboard";
import type { LeaderboardEntry } from "../components/Leaderboard";
import { apiGet } from "../lib/api";

interface BoardPayload {
  entries: LeaderboardEntry[];
  selfRank: number | null;
  provisional: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isEntry(value: unknown): value is LeaderboardEntry {
  if (!isRecord(value)) return false;
  return (
    typeof value["rank"] === "number" &&
    typeof value["name"] === "string" &&
    typeof value["score"] === "string" &&
    typeof value["isSelf"] === "boolean"
  );
}

function isBoard(value: unknown): value is BoardPayload {
  if (!isRecord(value)) return false;
  const entries = value["entries"];
  return (
    Array.isArray(entries) &&
    entries.every(isEntry) &&
    (typeof value["selfRank"] === "number" || value["selfRank"] === null) &&
    typeof value["provisional"] === "boolean"
  );
}

export default function LeaderboardPage() {
  const params = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const eventId = params["eventId"] ?? "";
  const mode = searchParams.get("mode") ?? "all";

  const board = useQuery({
    queryKey: ["events", eventId, "leaderboard", mode],
    queryFn: () => apiGet(`/events/${eventId}/leaderboard?mode=${mode}`, isBoard),
    enabled: eventId.length > 0,
    refetchInterval: 15_000
  });

  return (
    <main aria-busy={board.isPending}>
      <h1>Leaderboard</h1>
      <div className="actions" role="group" aria-label="Leaderboard filter">
        <button
          type="button"
          aria-pressed={mode === "all"}
          onClick={() => setSearchParams(mode === "all" ? {} : { mode: "all" })}
        >
          All
        </button>
        <button type="button" aria-pressed={mode === "solo"} onClick={() => setSearchParams({ mode: "solo" })}>
          Solo
        </button>
        <button type="button" aria-pressed={mode === "team"} onClick={() => setSearchParams({ mode: "team" })}>
          Teams
        </button>
      </div>
      {board.isPending ? <p role="status">Loading leaderboard…</p> : null}
      {board.isError ? <p role="alert">Could not load the leaderboard. Wait a few seconds and retry.</p> : null}
      {board.data ? (
        <Leaderboard entries={board.data.entries} selfRank={board.data.selfRank} provisional={board.data.provisional} />
      ) : null}
    </main>
  );
}
