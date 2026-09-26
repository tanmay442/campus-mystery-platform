import { useQuery } from "@tanstack/react-query";
import { Button } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { Heading } from "@astryxdesign/core/Heading";
import { Layout, LayoutContent } from "@astryxdesign/core/Layout";
import { Section } from "@astryxdesign/core/Section";
import { Skeleton } from "@astryxdesign/core/Skeleton";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";
import { Banner } from "@astryxdesign/core/Banner";
import RouterLink from "../components/RouterLink";
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
    <Layout
      contentWidth={640}
      content={
        <LayoutContent>
          <VStack gap={4}>
            <Section aria-label="Campus Mystery intro">
              <VStack gap={2}>
                <Text type="label" color="secondary">
                  Campus Mystery
                </Text>
                <Heading level={1} type="display-2">
                  Turn the campus into a game board
                </Heading>
                <Text>
                  Solve puzzles, follow signals to real locations, and race other players and teams to finish
                  first. Solo or in teams of up to five.
                </Text>
                <VStack gap={2}>
                  <Button label="Sign in to play" variant="primary" href="/login" as={RouterLink} width="100%" />
                  <Button label="How it works" variant="secondary" href="/onboarding" as={RouterLink} width="100%" />
                </VStack>
              </VStack>
            </Section>

            <Section aria-label="Promoted event">
              <VStack gap={2}>
                <Heading level={2}>Featured event</Heading>
                {promoted.isPending ? <Skeleton aria-label="Loading the featured event…" /> : null}
                {promoted.isError ? (
                  <Banner
                    status="error"
                    title="Could not load the featured event"
                    description="Check your connection and retry."
                    collapsible={false}
                  />
                ) : null}
                {promoted.isSuccess && event === null ? (
                  <EmptyState
                    title="No event right now"
                    description="No event is promoted right now. Check back soon."
                  />
                ) : null}
                {event ? (
                  <Card>
                    <VStack gap={2}>
                      <Heading level={3}>{event.name}</Heading>
                      {event.description ? <Text>{event.description}</Text> : null}
                      {event.startsAt ? <Countdown targetIso={event.startsAt} label="Starts in" /> : null}
                      <Button
                        label="Open event centre"
                        variant="primary"
                        href={`/events/${event.id}`}
                        as={RouterLink}
                        width="100%"
                      />
                    </VStack>
                  </Card>
                ) : null}
              </VStack>
            </Section>
          </VStack>
        </LayoutContent>
      }
    />
  );
}
