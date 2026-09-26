import { EmptyState } from "@astryxdesign/core/EmptyState";
import { Heading } from "@astryxdesign/core/Heading";
import { Section } from "@astryxdesign/core/Section";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";

export default function AdminEvents() {
  return (
    <Section aria-label="Admin events">
      <VStack gap={2}>
        <Heading level={2}>Events</Heading>
        <Text color="secondary">
          Event creation, duplication, publishing, pausing, and archiving land here in Phase 2. The full route map
          covers event detail, challenges, routes, locations, participants, teams, live control, rewards, and results.
        </Text>
        <EmptyState
          title="No events loaded"
          description="Event management arrives in Phase 2. Use the API meanwhile."
          isCompact
        />
      </VStack>
    </Section>
  );
}
