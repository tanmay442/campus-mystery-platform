import { Button } from "@astryxdesign/core/Button";
import { Heading } from "@astryxdesign/core/Heading";
import { Section } from "@astryxdesign/core/Section";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";
import RouterLink from "../../components/RouterLink";

export default function AdminDashboard() {
  return (
    <Section aria-label="Admin dashboard">
      <VStack gap={2}>
        <Heading level={2}>Dashboard</Heading>
        <Text color="secondary">
          Live counts, events needing attention, and quick actions land here in Phase 2. Every action is enforced and
          audited on the server.
        </Text>
        <Button label="Manage events" variant="primary" href="/admin/events" as={RouterLink} width="100%" />
      </VStack>
    </Section>
  );
}
