import { useState } from "react";
import type { FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { useParams } from "react-router";
import TargetSignal from "../components/TargetSignal";
import type { ProximityBand } from "../components/TargetSignal";
import { ApiError, apiGet, submitWithIdempotency } from "../lib/api";

type ObjectiveKind = "text_answer" | "multiple_choice" | "code" | "location" | "decision";

type ObjectiveState = "locked" | "available" | "in_progress" | "completed";

interface Objective {
  key: string;
  kind: ObjectiveKind;
  prompt: string;
  state: ObjectiveState;
  choices: string[] | null;
}

interface ChallengeDetail {
  id: string;
  title: string;
  narrative: string;
  objectives: Objective[];
  signal: {
    bearingLabel: string;
    band: ProximityBand;
    accuracyMeters: number;
    hint: string;
  } | null;
}

type SubmitState = "idle" | "pending" | "success" | "failure";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isBand(value: unknown): value is ProximityBand {
  return (
    value === "Signal extremely weak" ||
    value === "Signal weak" ||
    value === "Signal detected" ||
    value === "Signal improving" ||
    value === "Signal strong" ||
    value === "Target reached"
  );
}

function isObjectiveState(value: unknown): value is ObjectiveState {
  return value === "locked" || value === "available" || value === "in_progress" || value === "completed";
}

function isObjectiveKind(value: unknown): value is ObjectiveKind {
  return (
    value === "text_answer" ||
    value === "multiple_choice" ||
    value === "code" ||
    value === "location" ||
    value === "decision"
  );
}

function isObjective(value: unknown): value is Objective {
  if (!isRecord(value)) return false;
  const choices = value["choices"];
  return (
    typeof value["key"] === "string" &&
    isObjectiveKind(value["kind"]) &&
    typeof value["prompt"] === "string" &&
    isObjectiveState(value["state"]) &&
    (choices === null || (Array.isArray(choices) && choices.every((entry) => typeof entry === "string")))
  );
}

function isChallengeDetail(value: unknown): value is ChallengeDetail {
  if (!isRecord(value)) return false;
  const objectives = value["objectives"];
  const signal = value["signal"];
  const signalOk =
    signal === null ||
    (isRecord(signal) &&
      typeof signal["bearingLabel"] === "string" &&
      isBand(signal["band"]) &&
      typeof signal["accuracyMeters"] === "number" &&
      typeof signal["hint"] === "string");
  return (
    typeof value["id"] === "string" &&
    typeof value["title"] === "string" &&
    typeof value["narrative"] === "string" &&
    Array.isArray(objectives) &&
    objectives.every(isObjective) &&
    signalOk
  );
}

function isCompletion(value: unknown): value is { accepted: boolean } {
  return isRecord(value) && typeof value["accepted"] === "boolean";
}

export default function ChallengeView() {
  const params = useParams();
  const eventId = params["eventId"] ?? "";
  const challengeId = params["challengeId"] ?? "";

  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [submitState, setSubmitState] = useState<SubmitState>("idle");
  const [submitMessage, setSubmitMessage] = useState("");

  const challenge = useQuery({
    queryKey: ["challenges", challengeId],
    queryFn: () => apiGet(`/challenges/${challengeId}`, isChallengeDetail),
    enabled: challengeId.length > 0
  });

  async function handleSubmit(event: FormEvent<HTMLFormElement>, objectiveKey: string) {
    event.preventDefault();
    if (submitState === "pending") return;
    setSubmitState("pending");
    setSubmitMessage("");
    try {
      const result = await submitWithIdempotency(
        `/challenges/${challengeId}/objectives/${objectiveKey}/submit`,
        { answer: answers[objectiveKey] ?? "", eventId },
        isCompletion
      );
      setSubmitState("success");
      setSubmitMessage(result.accepted ? "Accepted and saved." : "Received.");
      await challenge.refetch();
    } catch (error) {
      setSubmitState("failure");
      setSubmitMessage(error instanceof ApiError ? error.message : "Submission failed. Retry safely.");
    }
  }

  return (
    <main aria-busy={challenge.isPending}>
      {challenge.isPending ? <p role="status">Loading challenge…</p> : null}
      {challenge.isError ? <p role="alert">Could not load this challenge. Retry from the event centre.</p> : null}
      {challenge.data ? (
        <>
          <header>
            <h1>{challenge.data.title}</h1>
            <p>{challenge.data.narrative}</p>
          </header>
          {challenge.data.signal ? (
            <TargetSignal
              bearingLabel={challenge.data.signal.bearingLabel}
              band={challenge.data.signal.band}
              accuracyMeters={challenge.data.signal.accuracyMeters}
              hint={challenge.data.signal.hint}
            />
          ) : null}
          <section aria-label="Objectives">
            <h2>Objectives</h2>
            <ol className="stack">
              {challenge.data.objectives.map((objective) => (
                <li key={objective.key} className="card">
                  <h3>{objective.prompt}</h3>
                  <p className="muted">Status: {objective.state.replace("_", " ")}</p>
                  {objective.state === "completed" ? (
                    <p role="status">Completed and saved. Refreshing never loses this.</p>
                  ) : null}
                  {objective.state === "locked" ? <p>Unlock earlier objectives to reveal this one.</p> : null}
                  {objective.state === "available" || objective.state === "in_progress" ? (
                    <form onSubmit={(event) => void handleSubmit(event, objective.key)}>
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
                      <p className="muted" role="status">
                        Draft kept in this field until you submit.
                      </p>
                      <button type="submit" disabled={submitState === "pending"} aria-busy={submitState === "pending"}>
                        {submitState === "pending" ? "Submitting…" : "Submit answer"}
                      </button>
                    </form>
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
