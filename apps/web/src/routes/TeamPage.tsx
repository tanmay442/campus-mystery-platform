import { useState } from "react";
import type { FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { useParams } from "react-router";
import { ApiError, apiGet, submitWithIdempotency } from "../lib/api";

interface Member {
  id: string;
  username: string;
  role: string;
}

interface TeamSummary {
  teamName: string | null;
  members: Member[];
  pendingRequests: Member[];
  inviteToken: string | null;
}

type SubmitState = "idle" | "pending" | "success" | "failure";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isMember(value: unknown): value is Member {
  if (!isRecord(value)) return false;
  return typeof value["id"] === "string" && typeof value["username"] === "string" && typeof value["role"] === "string";
}

function isTeamSummary(value: unknown): value is TeamSummary {
  if (!isRecord(value)) return false;
  const members = value["members"];
  const pending = value["pendingRequests"];
  return (
    (typeof value["teamName"] === "string" || value["teamName"] === null) &&
    Array.isArray(members) &&
    members.every(isMember) &&
    Array.isArray(pending) &&
    pending.every(isMember) &&
    (typeof value["inviteToken"] === "string" || value["inviteToken"] === null)
  );
}

function isOk(value: unknown): value is { ok: boolean } {
  return isRecord(value) && typeof value["ok"] === "boolean";
}

export default function TeamPage() {
  const params = useParams();
  const eventId = params["eventId"] ?? "";
  const [teamName, setTeamName] = useState("");
  const [state, setState] = useState<SubmitState>("idle");
  const [message, setMessage] = useState("");

  const team = useQuery({
    queryKey: ["events", eventId, "team"],
    queryFn: () => apiGet(`/events/${eventId}/team`, isTeamSummary),
    enabled: eventId.length > 0
  });

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (state === "pending" || teamName.trim().length === 0) {
      if (teamName.trim().length === 0) {
        setState("failure");
        setMessage("Choose a team name first.");
      }
      return;
    }
    setState("pending");
    setMessage("");
    try {
      await submitWithIdempotency(`/events/${eventId}/teams`, { name: teamName.trim() }, isOk);
      setState("success");
      setMessage("Team created. Share the invite link below.");
      await team.refetch();
    } catch (error) {
      setState("failure");
      setMessage(error instanceof ApiError ? error.message : "Could not create the team. Retry safely.");
    }
  }

  return (
    <main aria-busy={team.isPending}>
      <h1>Team</h1>
      {team.isPending ? <p role="status">Loading team…</p> : null}
      {team.isError ? <p role="alert">Could not load your team. Check your connection and retry.</p> : null}

      <section aria-label="Create a team">
        <h2>Create a team</h2>
        <form onSubmit={(event) => void handleCreate(event)}>
          <label htmlFor="team-name">Team name</label>
          <input
            id="team-name"
            name="teamName"
            type="text"
            autoComplete="off"
            maxLength={60}
            value={teamName}
            onChange={(event) => setTeamName(event.target.value)}
          />
          <button type="submit" disabled={state === "pending"} aria-busy={state === "pending"}>
            {state === "pending" ? "Creating…" : "Create team"}
          </button>
        </form>
        <div aria-live="polite">
          {state === "success" ? <p role="status">{message}</p> : null}
          {state === "failure" ? <p role="alert">{message}</p> : null}
        </div>
      </section>

      {team.data ? (
        <>
          <section aria-label="Members">
            <h2>{team.data.teamName ?? "Your team"}</h2>
            <ul className="stack">
              {team.data.members.map((member) => (
                <li key={member.id} className="card card-row">
                  <span>{member.username}</span>
                  <span className="muted">{member.role}</span>
                </li>
              ))}
            </ul>
            {team.data.members.length === 0 ? <p>You are playing solo. Create a team to invite others.</p> : null}
          </section>

          <section aria-label="Join requests">
            <h2>Join requests</h2>
            {team.data.pendingRequests.length === 0 ? <p>No pending requests.</p> : null}
            <ul className="stack">
              {team.data.pendingRequests.map((request) => (
                <li key={request.id} className="card card-row">
                  <span>{request.username}</span>
                  <span className="muted">Approval may add a late-join penalty after the first completion.</span>
                </li>
              ))}
            </ul>
          </section>

          {team.data.inviteToken ? (
            <section aria-label="Invite link">
              <h2>Invite link</h2>
              <p className="muted">Share this link. New members request to join, and the captain approves.</p>
              <p>
                <code>{team.data.inviteToken}</code>
              </p>
            </section>
          ) : null}
        </>
      ) : null}
    </main>
  );
}
