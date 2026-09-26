import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@clerk/react";
import { Navigate, useParams } from "react-router";
import { Badge } from "@astryxdesign/core/Badge";
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { Heading } from "@astryxdesign/core/Heading";
import { Layout, LayoutContent } from "@astryxdesign/core/Layout";
import { List, ListItem } from "@astryxdesign/core/List";
import { Section } from "@astryxdesign/core/Section";
import { Skeleton } from "@astryxdesign/core/Skeleton";
import { Spinner } from "@astryxdesign/core/Spinner";
import { StatusDot } from "@astryxdesign/core/StatusDot";
import { Text } from "@astryxdesign/core/Text";
import { HStack } from "@astryxdesign/core/HStack";
import { VStack } from "@astryxdesign/core/VStack";
import RouterLink from "../components/RouterLink";
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
    return <Spinner label="Loading…" />;
  }

  if (!isSignedIn) {
    return <Navigate to="/login" replace />;
  }

  if (state.isPending) {
    return (
      <Layout
        contentWidth={640}
        content={
          <LayoutContent>
            <VStack gap={2}>
              <Skeleton aria-label="Loading event centre…" />
              <Skeleton />
              <Skeleton />
            </VStack>
          </LayoutContent>
        }
      />
    );
  }

  if (state.isError || !state.data) {
    return (
      <Layout
        contentWidth={640}
        content={
          <LayoutContent>
            <Banner
              status="error"
              title="Could not load this event"
              description="Check your connection and retry."
              collapsible={false}
            />
          </LayoutContent>
        }
      />
    );
  }

  const data = state.data;
  const isLive = data.event.status === "live";

  return (
    <Layout
      contentWidth={640}
      content={
        <LayoutContent>
          <VStack gap={4}>
            <Section aria-label="Event overview">
              <VStack gap={2}>
                <HStack gap={2}>
                  <StatusDot
                    variant={isLive ? "success" : "neutral"}
                    label={isLive ? "Live now" : data.event.status}
                    isPulsing={isLive}
                  />
                  <Text type="supporting">{data.event.status}</Text>
                </HStack>
                <Heading level={1}>{data.event.name}</Heading>
                {data.event.description ? <Text>{data.event.description}</Text> : null}
                {data.event.endsAt ? <Countdown targetIso={data.event.endsAt} label="Ends in" /> : null}
                {data.event.startsAt && !data.event.endsAt ? (
                  <Countdown targetIso={data.event.startsAt} label="Starts in" />
                ) : null}
              </VStack>
            </Section>

            <Section aria-label="Participant">
              <VStack gap={2}>
                <Heading level={2}>Playing as</Heading>
                <Text weight="medium">{data.participant?.name ?? "Not registered yet"}</Text>
                {data.participant?.completedAt ? (
                  <Banner
                    status="success"
                    title="Event complete"
                    description="Official time was set by the server."
                    collapsible={false}
                  />
                ) : null}
              </VStack>
            </Section>

            <Section aria-label="Score">
              <Card>
                <VStack gap={2}>
                  <Heading level={2}>Score</Heading>
                  <HStack gap={2}>
                    <Text weight="semibold">{data.participant?.eventPoints ?? 0} event points</Text>
                    <Text color="secondary">{credits.data?.balance ?? 0} credits</Text>
                    <Badge label={`${data.counts.participants} players`} />
                  </HStack>
                  <Button
                    label="View leaderboard"
                    variant="secondary"
                    href={`/events/${eventId}/leaderboard`}
                    as={RouterLink}
                    width="100%"
                  />
                </VStack>
              </Card>
            </Section>

            <Section aria-label="Challenges">
              <VStack gap={2}>
                <Heading level={2}>Challenges</Heading>
                {data.challenges.length === 0 ? (
                  <EmptyState
                    title="No challenges yet"
                    description="No challenges are available yet. Check back after the event starts."
                  />
                ) : (
                  <List header={<Text type="label">Tap an unlocked challenge to open it</Text>} hasDividers>
                    {data.challenges.map((challenge) => (
                      <ListItem
                        key={challenge.id}
                        label={challenge.title}
                        description={
                          challenge.locked
                            ? "Locked — complete the previous steps first."
                            : (challenge.description ?? "Open to see the objectives.")
                        }
                        startContent={
                          <StatusDot
                            variant={challenge.locked ? "neutral" : "accent"}
                            label={challenge.locked ? "Locked" : "Available"}
                          />
                        }
                        {...(challenge.locked
                          ? {}
                          : { href: `/events/${eventId}/challenges/${challenge.id}` })}
                      />
                    ))}
                  </List>
                )}
              </VStack>
            </Section>

            <Section aria-label="Announcements">
              <VStack gap={2}>
                <Heading level={2}>Announcements</Heading>
                {data.announcements.length === 0 ? (
                  <EmptyState
                    title="No announcements"
                    description="Organizers have not posted anything yet."
                    isCompact
                  />
                ) : (
                  <List hasDividers>
                    {data.announcements.map((item) => (
                      <ListItem key={item.id} label={item.title} description={item.body} />
                    ))}
                  </List>
                )}
              </VStack>
            </Section>

            <Section aria-label="Event">
              <Button label="Team" variant="secondary" href={`/events/${eventId}/team`} as={RouterLink} width="100%" />
            </Section>
          </VStack>
        </LayoutContent>
      }
    />
  );
}
