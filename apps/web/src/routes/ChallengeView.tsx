import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { useParams } from "react-router";
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
import { Heading } from "@astryxdesign/core/Heading";
import { Layout, LayoutContent } from "@astryxdesign/core/Layout";
import { ProgressBar } from "@astryxdesign/core/ProgressBar";
import { RadioList, RadioListItem } from "@astryxdesign/core/RadioList";
import { Section } from "@astryxdesign/core/Section";
import { Skeleton } from "@astryxdesign/core/Skeleton";
import { StatusDot } from "@astryxdesign/core/StatusDot";
import { Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { VStack } from "@astryxdesign/core/VStack";
import { useAnnounce } from "@astryxdesign/core/hooks";
import { ApiError, apiGet, submitWithIdempotency } from "../lib/api";

type ObjectiveStatus = "locked" | "available" | "in_progress" | "completed";

interface ObjectiveHint {
  key: string;
  costPoints: number;
  unlocked: boolean;
}

interface ObjectiveChoice {
  id: string;
  label: string;
}

interface Objective {
  key: string;
  type: string;
  prompt: string;
  status: ObjectiveStatus;
  required: boolean;
  requiresManual: boolean;
  hints: ObjectiveHint[];
  reward: { eventPoints: number; platformCredits: number };
  choices?: ObjectiveChoice[];
  attemptsLeft?: number;
  guidance?: { placeName?: string; text?: string };
  completionFact?: string;
}

interface ChallengePayload {
  challenge: { id: string; eventId: string; title: string; description: string | null; position: number };
  participant: { id: string; eventPoints: number };
  objectives: Objective[];
  completed: boolean;
}

interface Completion {
  completed: boolean;
  objectiveKey: string;
  completedAt: string;
  eventPointsAward: number;
  platformCreditsAward: number;
  replayed: boolean;
}

interface HintUnlock {
  hintKey: string;
  text: string;
  costPoints: number;
  eventPoints: number;
  alreadyUnlocked: boolean;
}

type SubmitState = "idle" | "pending" | "success" | "failure";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isStatus(value: unknown): value is ObjectiveStatus {
  return value === "locked" || value === "available" || value === "in_progress" || value === "completed";
}

function isHint(value: unknown): value is ObjectiveHint {
  return (
    isRecord(value) &&
    typeof value["key"] === "string" &&
    typeof value["costPoints"] === "number" &&
    typeof value["unlocked"] === "boolean"
  );
}

function isChoice(value: unknown): value is ObjectiveChoice {
  return isRecord(value) && typeof value["id"] === "string" && typeof value["label"] === "string";
}

function isObjective(value: unknown): value is Objective {
  if (!isRecord(value)) return false;
  const hints = value["hints"];
  const reward = value["reward"];
  const choices = value["choices"];
  const guidance = value["guidance"];
  return (
    typeof value["key"] === "string" &&
    typeof value["type"] === "string" &&
    typeof value["prompt"] === "string" &&
    isStatus(value["status"]) &&
    typeof value["required"] === "boolean" &&
    typeof value["requiresManual"] === "boolean" &&
    Array.isArray(hints) &&
    hints.every(isHint) &&
    isRecord(reward) &&
    typeof reward["eventPoints"] === "number" &&
    typeof reward["platformCredits"] === "number" &&
    (choices === undefined || (Array.isArray(choices) && choices.every(isChoice))) &&
    (guidance === undefined ||
      (isRecord(guidance) &&
        (typeof guidance["placeName"] === "string" || guidance["placeName"] === undefined) &&
        (typeof guidance["text"] === "string" || guidance["text"] === undefined)))
  );
}

function isChallengePayload(value: unknown): value is ChallengePayload {
  if (!isRecord(value)) return false;
  const challenge = value["challenge"];
  const participant = value["participant"];
  const objectives = value["objectives"];
  return (
    isRecord(challenge) &&
    typeof challenge["id"] === "string" &&
    typeof challenge["title"] === "string" &&
    (typeof challenge["description"] === "string" || challenge["description"] === null) &&
    isRecord(participant) &&
    typeof participant["id"] === "string" &&
    Array.isArray(objectives) &&
    objectives.every(isObjective) &&
    typeof value["completed"] === "boolean"
  );
}

function isCompletion(value: unknown): value is Completion {
  return (
    isRecord(value) &&
    value["completed"] === true &&
    typeof value["objectiveKey"] === "string" &&
    typeof value["completedAt"] === "string" &&
    typeof value["eventPointsAward"] === "number" &&
    typeof value["platformCreditsAward"] === "number"
  );
}

function isHintUnlock(value: unknown): value is HintUnlock {
  return (
    isRecord(value) &&
    typeof value["hintKey"] === "string" &&
    typeof value["text"] === "string" &&
    typeof value["costPoints"] === "number" &&
    typeof value["eventPoints"] === "number"
  );
}

interface Reading {
  latitude: number;
  longitude: number;
  accuracyMeters: number;
  capturedAt: string;
}

function currentReading(): Promise<Reading> {
  return new Promise((resolve, reject) => {
    if (!("geolocation" in navigator)) {
      reject(new Error("Geolocation is not available on this device."));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) =>
        resolve({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracyMeters: position.coords.accuracy,
          capturedAt: new Date().toISOString()
        }),
      (error) => reject(new Error(error.message || "Could not read your location.")),
      { enableHighAccuracy: true, timeout: 20_000, maximumAge: 0 }
    );
  });
}

function submitLabel(type: string): string {
  if (type === "decision") return "Choose route";
  if (type === "location") return "Verify location";
  return "Submit answer";
}

function statusVariant(status: ObjectiveStatus): "success" | "accent" | "neutral" {
  if (status === "completed") return "success";
  if (status === "locked") return "neutral";
  return "accent";
}

export default function ChallengeView() {
  const params = useParams();
  const challengeId = params["challengeId"] ?? "";

  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [submitState, setSubmitState] = useState<SubmitState>("idle");
  const [submitMessage, setSubmitMessage] = useState("");
  const [unlockedHints, setUnlockedHints] = useState<Record<string, string>>({});
  const [armingHint, setArmingHint] = useState<string | null>(null);
  const announce = useAnnounce();

  const challenge = useQuery({
    queryKey: ["challenges", challengeId],
    queryFn: () => apiGet(`/challenges/${challengeId}`, isChallengePayload),
    enabled: challengeId.length > 0
  });

  useEffect(() => {
    if (submitState === "success" && submitMessage.length > 0) {
      announce(submitMessage, "polite");
    } else if (submitState === "failure" && submitMessage.length > 0) {
      announce(submitMessage, "assertive");
    }
  }, [submitState, submitMessage, announce]);

  async function refresh() {
    await challenge.refetch();
  }

  function reportSuccess(message: string) {
    setSubmitState("success");
    setSubmitMessage(message);
  }

  function reportFailure(error: unknown, fallback: string) {
    setSubmitState("failure");
    setSubmitMessage(error instanceof ApiError ? error.message : fallback);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>, objective: Objective) {
    event.preventDefault();
    if (submitState === "pending") return;
    setSubmitState("pending");
    setSubmitMessage("");
    try {
      const result = await submitWithIdempotency(
        `/challenges/${challengeId}/objectives/${objective.key}/submit`,
        { answer: answers[objective.key] ?? "" },
        isCompletion
      );
      reportSuccess(
        `Accepted and saved (+${result.eventPointsAward} points, +${result.platformCreditsAward} credits).`
      );
      await refresh();
    } catch (error) {
      reportFailure(error, "Submission failed. Retry safely.");
    }
  }

  async function handleHint(objective: Objective, hintKey: string) {
    if (submitState === "pending") return;
    const armedKey = `${objective.key}:${hintKey}`;
    if (armingHint !== armedKey) {
      setArmingHint(armedKey);
      return;
    }
    setArmingHint(null);
    setSubmitState("pending");
    setSubmitMessage("");
    try {
      const result = await submitWithIdempotency(
        `/challenges/${challengeId}/hints/${hintKey}/unlock`,
        {},
        isHintUnlock
      );
      setUnlockedHints((current) => ({ ...current, [armedKey]: result.text }));
      reportSuccess(`Hint unlocked. Balance: ${result.eventPoints} points.`);
      await refresh();
    } catch (error) {
      reportFailure(error, "Could not unlock the hint.");
    }
  }

  async function handleLocation(objective: Objective) {
    if (submitState === "pending") return;
    setSubmitState("pending");
    setSubmitMessage("Collecting location readings… stay where you are.");
    try {
      const session = await apiGet(
        `/challenges/${challengeId}/objectives/${objective.key}/location-session`,
        isRecord
      );
      const required = typeof session["requiredReadings"] === "number" ? session["requiredReadings"] : 3;
      const readings: Reading[] = [];
      for (let index = 0; index < required; index += 1) {
        readings.push(await currentReading());
      }
      const result = await submitWithIdempotency(
        `/challenges/${challengeId}/objectives/${objective.key}/verify-location`,
        { readings },
        isCompletion
      );
      reportSuccess(`Target reached and saved (+${result.eventPointsAward} points).`);
      await refresh();
    } catch (error) {
      const message = error instanceof ApiError ? error.message : "Location verification failed.";
      setSubmitState("failure");
      setSubmitMessage(
        `${message} If your device keeps failing, contact an organizer — they can verify you manually.`
      );
    }
  }

  if (challenge.isPending) {
    return (
      <Layout
        contentWidth={640}
        content={
          <LayoutContent>
            <VStack gap={2}>
              <Skeleton aria-label="Loading challenge…" />
              <Skeleton />
            </VStack>
          </LayoutContent>
        }
      />
    );
  }

  if (challenge.isError || !challenge.data) {
    return (
      <Layout
        contentWidth={640}
        content={
          <LayoutContent>
            <Banner
              status="error"
              title="Could not load this challenge"
              description="Retry from the event centre."
              collapsible={false}
            />
          </LayoutContent>
        }
      />
    );
  }

  const data = challenge.data;
  const doneCount = data.objectives.filter((objective) => objective.status === "completed").length;

  return (
    <Layout
      contentWidth={640}
      content={
        <LayoutContent>
          <VStack gap={4}>
            <Section aria-label="Challenge overview">
              <VStack gap={2}>
                <Heading level={1}>{data.challenge.title}</Heading>
                {data.challenge.description ? <Text>{data.challenge.description}</Text> : null}
                <ProgressBar
                  value={doneCount}
                  max={Math.max(data.objectives.length, 1)}
                  label={`${doneCount} of ${data.objectives.length} objectives complete`}
                />
                {data.completed ? (
                  <Banner
                    status="success"
                    title="Challenge complete"
                    description="Nothing left to do here."
                    collapsible={false}
                  />
                ) : null}
              </VStack>
            </Section>

            <Section aria-label="Objectives">
              <VStack gap={3}>
                <Heading level={2}>Objectives</Heading>
                {data.objectives.map((objective) => (
                  <Card key={objective.key}>
                    <VStack gap={2}>
                      <Heading level={3}>{objective.prompt}</Heading>
                      <Text type="supporting">
                        <StatusDot variant={statusVariant(objective.status)} label={objective.status.replace("_", " ")} />{" "}
                        {objective.status.replace("_", " ")} · {objective.reward.eventPoints} points,{" "}
                        {objective.reward.platformCredits} credits
                        {objective.required ? "" : " · Optional"}
                      </Text>
                      {objective.status === "completed" ? (
                        <Banner
                          status="success"
                          title="Completed and saved"
                          description={objective.completionFact ?? "Refreshing never loses this."}
                          collapsible={false}
                        />
                      ) : null}
                      {objective.status === "locked" ? (
                        <Text>Unlock earlier objectives to reveal this one.</Text>
                      ) : null}
                      {objective.requiresManual &&
                      objective.status !== "completed" &&
                      objective.status !== "locked" ? (
                        <Text color="secondary">
                          This objective needs an organizer to verify it. Find event staff for help.
                        </Text>
                      ) : null}
                      {(objective.status === "available" || objective.status === "in_progress") &&
                      !objective.requiresManual ? (
                        objective.type === "location" ? (
                          <VStack gap={2}>
                            {objective.guidance?.text ? <Text>{objective.guidance.text}</Text> : null}
                            {objective.guidance?.placeName ? (
                              <Text color="secondary">Area: {objective.guidance.placeName}</Text>
                            ) : null}
                            <Button
                              label={submitState === "pending" ? "Verifying…" : "Verify location"}
                              variant="primary"
                              isLoading={submitState === "pending"}
                              onClick={() => void handleLocation(objective)}
                              width="100%"
                            />
                          </VStack>
                        ) : (
                          <form onSubmit={(event) => void handleSubmit(event, objective)}>
                            {objective.choices && objective.choices.length > 0 ? (
                              <RadioList
                                label={objective.type === "decision" ? "Choose your route" : "Choose an answer"}
                                value={answers[objective.key] ?? ""}
                                onChange={(value) =>
                                  setAnswers((current) => ({ ...current, [objective.key]: value }))
                                }
                              >
                                {objective.choices.map((choice) => (
                                  <RadioListItem key={choice.id} value={choice.id} label={choice.label} />
                                ))}
                              </RadioList>
                            ) : (
                              <TextInput
                                label="Your answer"
                                value={answers[objective.key] ?? ""}
                                onChange={(value) =>
                                  setAnswers((current) => ({ ...current, [objective.key]: value }))
                                }
                                autoComplete="off"
                                {...(objective.attemptsLeft !== undefined
                                  ? { description: `${objective.attemptsLeft} attempts left.` }
                                  : {})}
                              />
                            )}
                            <Button
                              label={submitState === "pending" ? "Submitting…" : submitLabel(objective.type)}
                              variant="primary"
                              type="submit"
                              isLoading={submitState === "pending"}
                              width="100%"
                            />
                          </form>
                        )
                      ) : null}
                      {objective.hints.length > 0 && objective.status !== "completed" ? (
                        <VStack gap={2}>
                          <Heading level={4}>Hints</Heading>
                          {objective.hints.map((hint) => (
                            <VStack key={hint.key} gap={2}>
                              {hint.unlocked || unlockedHints[`${objective.key}:${hint.key}`] ? (
                                <Text>{unlockedHints[`${objective.key}:${hint.key}`] ?? "Unlocked."}</Text>
                              ) : (
                                <Button
                                  label={
                                    armingHint === `${objective.key}:${hint.key}`
                                      ? `Confirm: spend ${hint.costPoints} points?`
                                      : `Unlock hint (${hint.costPoints} points)`
                                  }
                                  variant="secondary"
                                  isLoading={submitState === "pending"}
                                  onClick={() => void handleHint(objective, hint.key)}
                                  width="100%"
                                />
                              )}
                            </VStack>
                          ))}
                        </VStack>
                      ) : null}
                    </VStack>
                  </Card>
                ))}
                {submitState === "success" ? (
                  <Banner status="success" title="Saved" description={submitMessage} collapsible={false} />
                ) : null}
                {submitState === "failure" ? (
                  <Banner status="error" title="Something went wrong" description={submitMessage} collapsible={false} />
                ) : null}
              </VStack>
            </Section>
          </VStack>
        </LayoutContent>
      }
    />
  );
}
