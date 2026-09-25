import { useState } from "react";
import type { FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { useParams } from "react-router";
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

export default function ChallengeView() {
  const params = useParams();
  const challengeId = params["challengeId"] ?? "";

  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [submitState, setSubmitState] = useState<SubmitState>("idle");
  const [submitMessage, setSubmitMessage] = useState("");
  const [unlockedHints, setUnlockedHints] = useState<Record<string, string>>({});

  const challenge = useQuery({
    queryKey: ["challenges", challengeId],
    queryFn: () => apiGet(`/challenges/${challengeId}`, isChallengePayload),
    enabled: challengeId.length > 0
  });

  async function refresh() {
    await challenge.refetch();
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
      setSubmitState("success");
      setSubmitMessage(
        `Accepted and saved (+${result.eventPointsAward} points, +${result.platformCreditsAward} credits).`
      );
      await refresh();
    } catch (error) {
      setSubmitState("failure");
      setSubmitMessage(error instanceof ApiError ? error.message : "Submission failed. Retry safely.");
    }
  }

  async function handleHint(objective: Objective, hintKey: string, costPoints: number) {
    if (submitState === "pending") return;
    if (!window.confirm(`Unlock this hint for ${costPoints} points?`)) return;
    setSubmitState("pending");
    setSubmitMessage("");
    try {
      const result = await submitWithIdempotency(
        `/challenges/${challengeId}/hints/${hintKey}/unlock`,
        {},
        isHintUnlock
      );
      setUnlockedHints((current) => ({ ...current, [`${objective.key}:${hintKey}`]: result.text }));
      setSubmitState("success");
      setSubmitMessage(`Hint unlocked. Balance: ${result.eventPoints} points.`);
      await refresh();
    } catch (error) {
      setSubmitState("failure");
      setSubmitMessage(error instanceof ApiError ? error.message : "Could not unlock the hint.");
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
      setSubmitState("success");
      setSubmitMessage(
        `Target reached and saved (+${result.eventPointsAward} points).`
      );
      await refresh();
    } catch (error) {
      setSubmitState("failure");
      const message = error instanceof ApiError ? error.message : "Location verification failed.";
      setSubmitMessage(
        `${message} If your device keeps failing, contact an organizer — they can verify you manually.`
      );
    }
  }

  return (
    <main aria-busy={challenge.isPending}>
      {challenge.isPending ? <p role="status">Loading challenge…</p> : null}
      {challenge.isError ? <p role="alert">Could not load this challenge. Retry from the event centre.</p> : null}
      {challenge.data ? (
        <>
          <header>
            <h1>{challenge.data.challenge.title}</h1>
            {challenge.data.challenge.description ? <p>{challenge.data.challenge.description}</p> : null}
            {challenge.data.completed ? <p role="status">Challenge complete. Nothing left to do here.</p> : null}
          </header>
          <section aria-label="Objectives">
            <h2>Objectives</h2>
            <ol className="stack">
              {challenge.data.objectives.map((objective) => (
                <li key={objective.key} className="card">
                  <h3>{objective.prompt}</h3>
                  <p className="muted">
                    Status: {objective.status.replace("_", " ")} · Reward: {objective.reward.eventPoints} points,{" "}
                    {objective.reward.platformCredits} credits
                    {objective.required ? "" : " · Optional"}
                  </p>
                  {objective.status === "completed" ? (
                    <>
                      <p role="status">Completed and saved. Refreshing never loses this.</p>
                      {objective.completionFact ? <p>{objective.completionFact}</p> : null}
                    </>
                  ) : null}
                  {objective.status === "locked" ? <p>Unlock earlier objectives to reveal this one.</p> : null}
                  {objective.requiresManual && objective.status !== "completed" && objective.status !== "locked" ? (
                    <p className="muted">This objective needs an organizer to verify it. Find event staff for help.</p>
                  ) : null}
                  {(objective.status === "available" || objective.status === "in_progress") &&
                  !objective.requiresManual ? (
                    objective.type === "location" ? (
                      <div>
                        {objective.guidance?.text ? <p>{objective.guidance.text}</p> : null}
                        {objective.guidance?.placeName ? (
                          <p className="muted">Area: {objective.guidance.placeName}</p>
                        ) : null}
                        <button
                          type="button"
                          disabled={submitState === "pending"}
                          aria-busy={submitState === "pending"}
                          onClick={() => void handleLocation(objective)}
                        >
                          {submitState === "pending" ? "Verifying…" : "Verify location"}
                        </button>
                      </div>
                    ) : (
                      <form onSubmit={(event) => void handleSubmit(event, objective)}>
                        {objective.choices && objective.choices.length > 0 ? (
                          <fieldset>
                            <legend>{objective.type === "decision" ? "Choose your route" : "Choose an answer"}</legend>
                            {objective.choices.map((choice) => (
                              <label key={choice.id} className="card-row">
                                <input
                                  type="radio"
                                  name={`answer-${objective.key}`}
                                  value={choice.id}
                                  checked={answers[objective.key] === choice.id}
                                  onChange={() =>
                                    setAnswers((current) => ({ ...current, [objective.key]: choice.id }))
                                  }
                                />
                                {choice.label}
                              </label>
                            ))}
                          </fieldset>
                        ) : (
                          <>
                            <label htmlFor={`answer-${objective.key}`}>Your answer</label>
                            <input
                              id={`answer-${objective.key}`}
                              name={`answer-${objective.key}`}
                              type="text"
                              autoComplete="off"
                              value={answers[objective.key] ?? ""}
                              onChange={(event) =>
                                setAnswers((current) => ({ ...current, [objective.key]: event.target.value }))
                              }
                            />
                          </>
                        )}
                        {objective.attemptsLeft !== undefined ? (
                          <p className="muted" role="status">
                            {objective.attemptsLeft} attempts left.
                          </p>
                        ) : null}
                        <button type="submit" disabled={submitState === "pending"} aria-busy={submitState === "pending"}>
                          {submitState === "pending" ? "Submitting…" : submitLabel(objective.type)}
                        </button>
                      </form>
                    )
                  ) : null}
                  {objective.hints.length > 0 && objective.status !== "completed" ? (
                    <div>
                      <h4>Hints</h4>
                      <ul className="stack">
                        {objective.hints.map((hint) => (
                          <li key={hint.key}>
                            {hint.unlocked || unlockedHints[`${objective.key}:${hint.key}`] ? (
                              <p>{unlockedHints[`${objective.key}:${hint.key}`] ?? "Unlocked."}</p>
                            ) : (
                              <button
                                type="button"
                                disabled={submitState === "pending"}
                                onClick={() => void handleHint(objective, hint.key, hint.costPoints)}
                              >
                                Unlock hint ({hint.costPoints} points)
                              </button>
                            )}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </li>
              ))}
            </ol>
            <div aria-live="polite">
              {submitState === "success" ? <p role="status">{submitMessage}</p> : null}
              {submitState === "failure" ? <p role="alert">{submitMessage}</p> : null}
            </div>
          </section>
        </>
      ) : null}
    </main>
  );
}
