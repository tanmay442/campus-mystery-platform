import { Outlet } from "react-router";
import { Button } from "@astryxdesign/core/Button";
import { Heading } from "@astryxdesign/core/Heading";
import { Layout, LayoutContent } from "@astryxdesign/core/Layout";
import { Section } from "@astryxdesign/core/Section";
import { Text } from "@astryxdesign/core/Text";
import { HStack } from "@astryxdesign/core/HStack";
import { VStack } from "@astryxdesign/core/VStack";
import RouterLink from "../../components/RouterLink";

export default function AdminLayout() {
  return (
    <Layout
      contentWidth={640}
      content={
        <LayoutContent>
          <VStack gap={4}>
            <Section aria-label="Admin">
              <VStack gap={2}>
                <Text type="label" color="secondary">
                  Organizers only
                </Text>
                <Heading level={1}>Admin</Heading>
                <HStack gap={2}>
                  <Button label="Dashboard" variant="secondary" href="/admin" as={RouterLink} />
                  <Button label="Events" variant="secondary" href="/admin/events" as={RouterLink} />
                </HStack>
              </VStack>
            </Section>
            <Outlet />
          </VStack>
        </LayoutContent>
      }
    />
  );
}
