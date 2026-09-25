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

function isWorkerEntry(value: unknown): value is {
  rank: number;
  name: string;
  eventPoints: number;
  finished: boolean;
  officialFinishAt?: string;
  isCaller: boolean;
} {
  if (!isRecord(value)) return false;
  return (
    typeof value["rank"] === "number" &&
    typeof value["name"] === "string" &&
    typeof value["eventPoints"] === "number" &&
    typeof value["finished"] === "boolean" &&
    typeof value["isCaller"] === "boolean" &&
    (typeof value["officialFinishAt"] === "string" || value["officialFinishAt"] === undefined)
  );
}

function isBoardPayload(value: unknown): value is {
  entries: Array<{
    rank: number;
    name: string;
    eventPoints: number;
    finished: boolean;
    officialFinishAt?: string;
    isCaller: boolean;
  }>;
  caller: { rank: number } | null;
  provisional: boolean;
} {
  if (!isRecord(value)) return false;
  const entries = value["entries"];
  const caller = value["caller"];
  return (
    Array.isArray(entries) &&
    entries.every(isWorkerEntry) &&
    (caller === null || (isRecord(caller) && typeof caller["rank"] === "number")) &&
    typeof value["provisional"] === "boolean"
  );
}

function toDisplay(
  entry: { rank: number; name: string; eventPoints: number; finished: boolean; officialFinishAt?: string; isCaller: boolean }
): LeaderboardEntry {
  const score = entry.finished
    ? `Finished${entry.officialFinishAt ? ` · ${new Date(entry.officialFinishAt).toLocaleString()}` : ""}`
    : `${entry.eventPoints} pts`;
  return { rank: entry.rank, name: entry.name, score, isSelf: entry.isCaller };
}

export default function LeaderboardPage() {
  const params = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const eventId = params["eventId"] ?? "";
  const scope = searchParams.get("scope") ?? "all";
  const query = scope === "solo" || scope === "team" ? `?scope=${scope}` : "";

  const board = useQuery({
    queryKey: ["events", eventId, "leaderboard", scope],
    queryFn: () =>
      apiGet(`/events/${eventId}/leaderboard${query}`, isBoardPayload).then((payload) => {
        const entries = payload.entries.map(toDisplay);
        const selfRank = payload.caller?.rank ?? null;
        return { entries, selfRank, provisional: payload.provisional } satisfies BoardPayload;
      }),
    enabled: eventId.length > 0,
    refetchInterval: 15_000
  });

  return (
    <main aria-busy={board.isPending}>
      <h1>Leaderboard</h1>
      <div className="actions" role="group" aria-label="Leaderboard filter">
        <button
          type="button"
          aria-pressed={scope === "all"}
          onClick={() => setSearchParams(scope === "all" ? {} : { scope: "all" })}
        >
          All
        </button>
        <button type="button" aria-pressed={scope === "solo"} onClick={() => setSearchParams({ scope: "solo" })}>
          Solo
        </button>
        <button type="button" aria-pressed={scope === "team"} onClick={() => setSearchParams({ scope: "team" })}>
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
