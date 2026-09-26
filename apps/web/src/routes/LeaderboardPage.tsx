import { useQuery } from "@tanstack/react-query";
import { useParams, useSearchParams } from "react-router";
import { Badge } from "@astryxdesign/core/Badge";
import { Banner } from "@astryxdesign/core/Banner";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { Heading } from "@astryxdesign/core/Heading";
import { Layout, LayoutContent } from "@astryxdesign/core/Layout";
import { List, ListItem } from "@astryxdesign/core/List";
import { Section } from "@astryxdesign/core/Section";
import { SegmentedControl, SegmentedControlItem } from "@astryxdesign/core/SegmentedControl";
import { Skeleton } from "@astryxdesign/core/Skeleton";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";
import { apiGet } from "../lib/api";

interface WorkerEntry {
  rank: number;
  name: string;
  eventPoints: number;
  finished: boolean;
  officialFinishAt?: string | undefined;
  isCaller: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isWorkerEntry(value: unknown): value is WorkerEntry {
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
  entries: WorkerEntry[];
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

function scoreLabel(entry: WorkerEntry): string {
  if (entry.finished) {
    return entry.officialFinishAt
      ? `Finished · ${new Date(entry.officialFinishAt).toLocaleString()}`
      : "Finished";
  }
  return `${entry.eventPoints} pts`;
}

export default function LeaderboardPage() {
  const params = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const eventId = params["eventId"] ?? "";
  const scope = searchParams.get("scope") ?? "all";
  const query = scope === "solo" || scope === "team" ? `?scope=${scope}` : "";

  const board = useQuery({
    queryKey: ["events", eventId, "leaderboard", scope],
    queryFn: () => apiGet(`/events/${eventId}/leaderboard${query}`, isBoardPayload),
    enabled: eventId.length > 0,
    refetchInterval: 15_000
  });

  const entries = board.data?.entries ?? [];
  const callerRank = board.data?.caller?.rank ?? null;
  const selfEntry = entries.find((entry) => entry.isCaller);
  const selfOutsideTop = selfEntry !== undefined && selfEntry.rank > 10;

  return (
    <Layout
      contentWidth={640}
      content={
        <LayoutContent>
          <VStack gap={4}>
            <Section aria-label="Leaderboard">
              <VStack gap={2}>
                <Heading level={1}>Leaderboard</Heading>
                {board.data?.provisional ? (
                  <Banner
                    status="info"
                    title="Provisional ranks"
                    description="Ranks are provisional while the event is live. Official times are set by the server."
                    collapsible={false}
                  />
                ) : null}
                <SegmentedControl
                  label="Leaderboard filter"
                  value={scope}
                  onChange={(value) => setSearchParams(value === "all" ? {} : { scope: value })}
                  layout="fill"
                >
                  <SegmentedControlItem value="all" label="All" />
                  <SegmentedControlItem value="solo" label="Solo" />
                  <SegmentedControlItem value="team" label="Teams" />
                </SegmentedControl>
                {board.isPending ? <Skeleton aria-label="Loading leaderboard…" /> : null}
                {board.isError ? (
                  <Banner
                    status="error"
                    title="Could not load the leaderboard"
                    description="Wait a few seconds and retry."
                    collapsible={false}
                  />
                ) : null}
                {board.data && entries.length === 0 ? (
                  <EmptyState
                    title="No ranks yet"
                    description="Nobody has scored yet. Complete an objective to join the board."
                  />
                ) : null}
                {entries.length > 0 ? (
                  <List
                    header={<Text type="label">Top {Math.min(entries.length, 10)}</Text>}
                    listStyle="decimal"
                    hasDividers
                  >
                    {entries.slice(0, 10).map((entry) => (
                      <ListItem
                        key={entry.rank}
                        label={entry.name}
                        description={scoreLabel(entry)}
                        endContent={entry.isCaller ? <Badge label="You" /> : undefined}
                        isSelected={entry.isCaller}
                      />
                    ))}
                  </List>
                ) : null}
                {selfOutsideTop && selfEntry ? (
                  <List header={<Text type="label">Your rank</Text>} hasDividers>
                    <ListItem
                      label={selfEntry.name}
                      description={`Rank ${selfEntry.rank} · ${scoreLabel(selfEntry)}`}
                      endContent={<Badge label="You" />}
                      isSelected
                    />
                  </List>
                ) : null}
                {board.data && callerRank === null ? (
                  <Text color="secondary">You are not ranked yet. Complete an objective to join the board.</Text>
                ) : null}
              </VStack>
            </Section>
          </VStack>
        </LayoutContent>
      }
    />
  );
}
