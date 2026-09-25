import { useState } from "react";
import type { FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@clerk/react";
import { Navigate, useParams } from "react-router";
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

function normalizeMembership(value: Membership): Required<Omit<Membership, "participant">> & Pick<Membership, "participant"> {
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

  const team = useQuery({
    queryKey: ["events", eventId, "membership"],
    queryFn: () =>
      apiGet(`/events/${eventId}/membership`, isMembership).then((payload) => normalizeMembership(payload)),
    enabled: eventId.length > 0 && isSignedIn === true
  });

  if (!isLoaded) {
    return (
      <main>
        <p role="status">Loading…</p>
      </main>
    );
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

  return (
    <main aria-busy={team.isPending}>
      <h1>Team</h1>
      {team.isPending ? <p role="status">Loading team…</p> : null}
      {team.isError ? <p role="alert">Could not load your team. Check your connection and retry.</p> : null}

      {(team.data?.participant === null || team.data?.participant?.type === "solo") &&
      team.data !== undefined ? (
        <section aria-label="Create a team">
          <h2>Create a team</h2>
          {team.data.participant?.type === "solo" ? (
            <p className="muted">You are playing solo. Leave your solo entry below first, then create a team.</p>
          ) : null}
          <form onSubmit={(event) => void handleCreate(event)}>
            <label htmlFor="team-name">Team name (3–40 characters)</label>
            <input
              id="team-name"
              name="teamName"
              type="text"
              autoComplete="off"
              maxLength={40}
              minLength={3}
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
      ) : null}

      {team.data?.participant ? (
        <>
          <section aria-label="Members">
            <h2>
              {team.data.participant.name} ({team.data.participant.type})
            </h2>
            <p className="muted">
              {team.data.participant.eventPoints} event points
              {team.data.participant.penaltySeconds > 0
                ? ` · ${team.data.participant.penaltySeconds}s penalties`
                : null}
            </p>
            <ul className="stack">
              {team.data.members.map((member) => (
                <li key={member.userId} className="card card-row">
                  <span>{member.username}</span>
                  <span className="muted">{member.role}</span>
                </li>
              ))}
            </ul>
            {team.data.members.length === 0 ? <p>You are playing solo. Create a team to invite others.</p> : null}
          </section>

          {team.data.canManage ? (
            <>
              <section aria-label="Join requests">
                <h2>Join requests</h2>
                {team.data.pendingRequests.length === 0 ? <p>No pending requests.</p> : null}
                <ul className="stack">
                  {team.data.pendingRequests.map((request) => (
                    <li key={request.id} className="card card-row">
                      <span>{request.username}</span>
                      <span className="actions">
                        <button
                          type="button"
                          disabled={state === "pending"}
                          onClick={() =>
                            void run(`${request.username} approved.`, () =>
                              submitWithIdempotency(`/join-requests/${request.id}/approve`, {}, isOk)
                            )
                          }
                        >
                          Approve
                        </button>
                        <button
                          type="button"
                          disabled={state === "pending"}
                          onClick={() =>
                            void run(`${request.username} rejected.`, () =>
                              apiPost(`/join-requests/${request.id}/reject`, {}, isOk)
                            )
                          }
                        >
                          Reject
                        </button>
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="muted">Approving a request after the first completion adds a late-join penalty.</p>
              </section>

              <section aria-label="Invite link">
                <h2>Invite link</h2>
                <p className="muted">
                  Create a link, share it, then approve requests above. The token is shown once.
                </p>
                <button
                  type="button"
                  disabled={state === "pending"}
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
                >
                  Create invite link
                </button>
                {inviteToken ? (
                  <p>
                    <code>{inviteToken}</code>
                  </p>
                ) : null}
              </section>
            </>
          ) : null}

          <section aria-label="Leave">
            <h2>Leave</h2>
            <p className="muted">Leaving returns you to zero individual progress. The team keeps its progress.</p>
            <button
              type="button"
              disabled={state === "pending"}
              onClick={() =>
                void run("You left the team.", () =>
                  participantId ? apiPost(`/participants/${participantId}/leave`, {}, isOk) : Promise.reject(new Error("missing"))
                )
              }
            >
              Leave team
            </button>
          </section>
        </>
      ) : null}
      <div aria-live="polite">
        {state === "success" ? <p role="status">{message}</p> : null}
        {state === "failure" ? <p role="alert">{message}</p> : null}
      </div>
    </main>
  );
}
