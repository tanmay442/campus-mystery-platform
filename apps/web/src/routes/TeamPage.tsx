import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@clerk/react";
import { Navigate, useParams } from "react-router";
import { Avatar } from "@astryxdesign/core/Avatar";
import { AvatarGroup } from "@astryxdesign/core/AvatarGroup";
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { FormLayout } from "@astryxdesign/core/FormLayout";
import { Heading } from "@astryxdesign/core/Heading";
import { Layout, LayoutContent } from "@astryxdesign/core/Layout";
import { List, ListItem } from "@astryxdesign/core/List";
import { Section } from "@astryxdesign/core/Section";
import { Skeleton } from "@astryxdesign/core/Skeleton";
import { Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { VStack } from "@astryxdesign/core/VStack";
import { useAnnounce } from "@astryxdesign/core/hooks";
import { ApiError, apiGet, apiPost, submitWithIdempotency } from "../lib/api";

interface Member {
  userId: string;
  username: string;
  role: string;
}

interface PendingRequest {
  id: string;
  userId: string;
  username: string;
  createdAt: string;
}

interface Membership {
  participant: {
    id: string;
    eventId: string;
    type: string;
    name: string;
    eventPoints: number;
    penaltySeconds: number;
  } | null;
  members: Member[];
  pendingRequests: PendingRequest[];
  canManage: boolean;
}

type SubmitState = "idle" | "pending" | "success" | "failure";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isMember(value: unknown): value is Member {
  return (
    isRecord(value) &&
    typeof value["userId"] === "string" &&
    typeof value["username"] === "string" &&
    typeof value["role"] === "string"
  );
}

function isPendingRequest(value: unknown): value is PendingRequest {
  return (
    isRecord(value) &&
    typeof value["id"] === "string" &&
    typeof value["userId"] === "string" &&
    typeof value["username"] === "string"
  );
}

function isMembership(value: unknown): value is Membership {
  if (!isRecord(value)) return false;
  const participant = value["participant"];
  const members = value["members"];
  const pendingRequests = value["pendingRequests"];
  return (
    (participant === null ||
      (isRecord(participant) &&
        typeof participant["id"] === "string" &&
        typeof participant["name"] === "string" &&
        typeof participant["type"] === "string")) &&
    (members === undefined || (Array.isArray(members) && members.every(isMember))) &&
    (pendingRequests === undefined || (Array.isArray(pendingRequests) && pendingRequests.every(isPendingRequest))) &&
    (typeof value["canManage"] === "boolean" || value["canManage"] === undefined)
  );
}

function normalizeMembership(
  value: Membership
): Required<Omit<Membership, "participant">> & Pick<Membership, "participant"> {
  return {
    participant: value.participant,
    members: value.members ?? [],
    pendingRequests: value.pendingRequests ?? [],
    canManage: value.canManage ?? false
  };
}

function isInvite(value: unknown): value is { invite: { id: string }; token: string } {
  return (
    isRecord(value) &&
    isRecord(value["invite"]) &&
    typeof value["invite"]["id"] === "string" &&
    typeof value["token"] === "string"
  );
}

function isOk(value: unknown): value is { ok: boolean } {
  return isRecord(value) && typeof value["ok"] === "boolean";
}

export default function TeamPage() {
  const { isLoaded, isSignedIn } = useAuth();
  const params = useParams();
  const eventId = params["eventId"] ?? "";
  const [teamName, setTeamName] = useState("");
  const [state, setState] = useState<SubmitState>("idle");
  const [message, setMessage] = useState("");
  const [inviteToken, setInviteToken] = useState<string | null>(null);
  const announce = useAnnounce();

  const team = useQuery({
    queryKey: ["events", eventId, "membership"],
    queryFn: () =>
      apiGet(`/events/${eventId}/membership`, isMembership).then((payload) => normalizeMembership(payload)),
    enabled: eventId.length > 0 && isSignedIn === true
  });

  useEffect(() => {
    if ((state === "success" || state === "failure") && message.length > 0) {
      announce(message, state === "failure" ? "assertive" : "polite");
    }
  }, [state, message, announce]);

  if (!isLoaded) {
    return <Skeleton aria-label="Loading…" />;
  }

  if (!isSignedIn) {
    return <Navigate to="/login" replace />;
  }

  async function run(label: string, task: () => Promise<unknown>) {
    if (state === "pending") return;
    setState("pending");
    setMessage("");
    try {
      await task();
      setState("success");
      setMessage(label);
      await team.refetch();
    } catch (error) {
      setState("failure");
      setMessage(error instanceof ApiError ? error.message : "That did not work. Retry safely.");
    }
  }

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = teamName.trim();
    if (name.length === 0) {
      setState("failure");
      setMessage("Choose a team name first.");
      return;
    }
    await run("Team created. Create an invite link below so others can request to join.", () =>
      submitWithIdempotency(`/events/${eventId}/teams`, { name }, isOk)
    );
  }

  const participantId = team.data?.participant?.id;
  const showCreateForm =
    team.data !== undefined &&
    (team.data.participant === null || team.data.participant.type === "solo");

  return (
    <Layout
      contentWidth={640}
      content={
        <LayoutContent>
          <VStack gap={4}>
            <Heading level={1}>Team</Heading>
            {team.isPending ? <Skeleton aria-label="Loading team…" /> : null}
            {team.isError ? (
              <Banner
                status="error"
                title="Could not load your team"
                description="Check your connection and retry."
                collapsible={false}
              />
            ) : null}

            {showCreateForm ? (
              <Section aria-label="Create a team">
                <Card>
                  <form onSubmit={(event) => void handleCreate(event)}>
                    <FormLayout>
                      <Heading level={2}>Create a team</Heading>
                      {team.data?.participant?.type === "solo" ? (
                        <Text color="secondary">
                          You are playing solo. Leave your solo entry below first, then create a team.
                        </Text>
                      ) : null}
                      <TextInput
                        label="Team name (3–40 characters)"
                        value={teamName}
                        onChange={setTeamName}
                        autoComplete="off"
                        isRequired
                      />
                      <Button
                        label={state === "pending" ? "Creating…" : "Create team"}
                        variant="primary"
                        type="submit"
                        isLoading={state === "pending"}
                        width="100%"
                      />
                    </FormLayout>
                  </form>
                </Card>
              </Section>
            ) : null}

            {team.data?.participant ? (
              <Section aria-label="Members">
                <VStack gap={2}>
                  <Heading level={2}>
                    {team.data.participant.name} ({team.data.participant.type})
                  </Heading>
                  <Text color="secondary">
                    {team.data.participant.eventPoints} event points
                    {team.data.participant.penaltySeconds > 0
                      ? ` · ${team.data.participant.penaltySeconds}s penalties`
                      : null}
                  </Text>
                  {team.data.members.length > 0 ? (
                    <AvatarGroup size="sm">
                      {team.data.members.map((member) => (
                        <Avatar key={member.userId} name={member.username} />
                      ))}
                    </AvatarGroup>
                  ) : null}
                  {team.data.members.length === 0 ? (
                    <EmptyState
                      title="Playing solo"
                      description="You are playing solo. Create a team to invite others."
                      isCompact
                    />
                  ) : (
                    <List header={<Text type="label">Members</Text>} hasDividers>
                      {team.data.members.map((member) => (
                        <ListItem
                          key={member.userId}
                          label={member.username}
                          description={member.role}
                          startContent={<Avatar name={member.username} />}
                        />
                      ))}
                    </List>
                  )}
                </VStack>
              </Section>
            ) : null}

            {team.data?.participant && team.data.canManage ? (
              <Section aria-label="Join requests">
                <VStack gap={2}>
                  <Heading level={2}>Join requests</Heading>
                  {team.data.pendingRequests.length === 0 ? (
                    <EmptyState title="No pending requests" description="New requests will appear here." isCompact />
                  ) : (
                    <List hasDividers>
                      {team.data.pendingRequests.map((request) => (
                        <ListItem
                          key={request.id}
                          label={request.username}
                          description="Wants to join this team"
                          endContent={
                            <>
                              <Button
                                label="Approve"
                                variant="primary"
                                size="sm"
                                isDisabled={state === "pending"}
                                onClick={() =>
                                  void run(`${request.username} approved.`, () =>
                                    submitWithIdempotency(`/join-requests/${request.id}/approve`, {}, isOk)
                                  )
                                }
                              />
                              <Button
                                label="Reject"
                                variant="secondary"
                                size="sm"
                                isDisabled={state === "pending"}
                                onClick={() =>
                                  void run(`${request.username} rejected.`, () =>
                                    apiPost(`/join-requests/${request.id}/reject`, {}, isOk)
                                  )
                                }
                              />
                            </>
                          }
                        />
                      ))}
                    </List>
                  )}
                  <Text color="secondary">
                    Approving a request after the first completion adds a late-join penalty.
                  </Text>
                </VStack>
              </Section>
            ) : null}

            {team.data?.participant && team.data.canManage ? (
              <Section aria-label="Invite link">
                <Card>
                  <VStack gap={2}>
                    <Heading level={2}>Invite link</Heading>
                    <Text color="secondary">
                      Create a link, share it, then approve requests above. The token is shown once.
                    </Text>
                    <Button
                      label="Create invite link"
                      variant="secondary"
                      isDisabled={state === "pending" || !participantId}
                      onClick={() =>
                        void (async () => {
                          if (state === "pending" || !participantId) return;
                          setState("pending");
                          setMessage("");
                          try {
                            const result = await submitWithIdempotency(
                              `/participants/${participantId}/invites`,
                              {},
                              isInvite
                            );
                            setInviteToken(result.token);
                            setState("success");
                            setMessage("Invite created. Share the token below.");
                          } catch (error) {
                            setState("failure");
                            setMessage(
                              error instanceof ApiError ? error.message : "Could not create the invite."
                            );
                          }
                        })()
                      }
                      width="100%"
                    />
                    {inviteToken ? <Text type="code">{inviteToken}</Text> : null}
                  </VStack>
                </Card>
              </Section>
            ) : null}

            {team.data?.participant ? (
              <Section aria-label="Leave">
                <Card>
                  <VStack gap={2}>
                    <Heading level={2}>Leave</Heading>
                    <Text color="secondary">
                      Leaving returns you to zero individual progress. The team keeps its progress.
                    </Text>
                    <Button
                      label="Leave team"
                      variant="destructive"
                      isDisabled={state === "pending"}
                      onClick={() =>
                        void run("You left the team.", () =>
                          participantId
                            ? apiPost(`/participants/${participantId}/leave`, {}, isOk)
                            : Promise.reject(new Error("missing"))
                        )
                      }
                      width="100%"
                    />
                  </VStack>
                </Card>
              </Section>
            ) : null}

            {state === "success" ? (
              <Banner status="success" title="Done" description={message} collapsible={false} />
            ) : null}
            {state === "failure" ? (
              <Banner status="error" title="Something went wrong" description={message} collapsible={false} />
            ) : null}
          </VStack>
        </LayoutContent>
      }
    />
  );
}
