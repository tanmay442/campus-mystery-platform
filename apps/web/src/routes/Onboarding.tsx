/** How-it-works guide; requires Clerk sign-in. */
import { useAuth } from "@clerk/react";
import { Navigate } from "react-router";
import { Button } from "@astryxdesign/core/Button";
import { Heading } from "@astryxdesign/core/Heading";
import { Layout, LayoutContent } from "@astryxdesign/core/Layout";
import { List, ListItem } from "@astryxdesign/core/List";
import { Section } from "@astryxdesign/core/Section";
import { Spinner } from "@astryxdesign/core/Spinner";
import { Text } from "@astryxdesign/core/Text";
import { HStack } from "@astryxdesign/core/HStack";
import { VStack } from "@astryxdesign/core/VStack";
import RouterLink from "../components/RouterLink";

const CARDS = [
  {
    title: "What this is",
    body: "Campus Mystery turns campus culture and hidden corners into playable stories you solve with your feet and your head."
  },
  {
    title: "Solo or team",
    body: "Play alone or build a team of up to five. Any active member can complete objectives for the whole team."
  },
  {
    title: "The current story",
    body: "Each event opens with a premise. Follow chapters from the event centre and unlock what comes next."
  },
  {
    title: "Prizes and recognition",
    body: "Earn event points for your participant and platform credits for yourself. The live leaderboard shows the top 10."
  },
  {
    title: "Stay safe",
    body: "Never enter roads, rooftops, construction zones, or restricted rooms. Walk, do not run, and follow the emergency contact in the event centre."
  },
  {
    title: "Points, credits, hints",
    body: "Hints can cost points. Wrong answers can trigger cooldowns. Every completed objective is saved immediately."
  },
  {
    title: "Nearby presence",
    body: "During events, your presence may be counted in nearby-player totals and your username shown to others nearby. You are visible by default, but you can opt out at any time: open your profile and set presence to count-only or hidden. Gameplay is never affected."
  }
];

export default function Onboarding() {
  const { isLoaded, isSignedIn } = useAuth();

  if (!isLoaded) {
    return <Spinner label="Loading…" />;
  }

  if (!isSignedIn) {
    return <Navigate to="/login" replace />;
  }

  return (
    <Layout
      contentWidth={640}
      content={
        <LayoutContent>
          <VStack gap={4}>
            <Section aria-label="How it works">
              <VStack gap={2}>
                <Heading level={1}>How it works</Heading>
                <Text>
                  Skipped it before? <RouterLink href="/">Back to the start</RouterLink> whenever you like.
                </Text>
                <List
                  header={<Heading level={2}>The rules of play</Heading>}
                  hasDividers
                >
                  {CARDS.map((card) => (
                    <ListItem key={card.title} label={card.title} description={card.body} />
                  ))}
                </List>
              </VStack>
            </Section>
            <Section aria-label="Location permission">
              <VStack gap={2}>
                <Heading level={2}>About location access</Heading>
                <Text>
                  Location permission is requested just in time, when you open your first location objective. It is
                  never asked for on the landing page.
                </Text>
                <HStack gap={2}>
                  <Button label="Continue to sign in" variant="primary" href="/login" as={RouterLink} />
                  <Button label="Skip for now" variant="secondary" href="/" as={RouterLink} />
                </HStack>
              </VStack>
            </Section>
          </VStack>
        </LayoutContent>
      }
    />
  );
}
