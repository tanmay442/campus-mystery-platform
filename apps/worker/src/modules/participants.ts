/** Team departures, captain transfer, member permissions, solo entries. */

import {
  MANAGER_ROLE,
  MAX_MEMBERSHIP_CHANGES_PER_WINDOW,
  transferCaptainSchema
} from "@campus/shared";
import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv, DatabaseBinding } from "../env";
import { newId } from "../lib/crypto";
import { errorResponse } from "../lib/errors";
import { nowIso } from "../lib/time";
import type { StoredMemberWithUsername } from "./teams";
import {
  affectedRows,
  countRecentTeamChanges,
  readActiveMembershipForUserEvent,
  readActiveMemberRow,
  readActiveMembers,
  readEvent,
  readParticipant,
  readUserById,
  readUserEventHistory,
  readTeamHistory,
  requireVerifiedUser,
  userCooldownRemainingSeconds
} from "./teams";

const participantIdParams = z.object({
  participantId: z.string().min(1)
});

export type SoloResult =
  | { ok: true; participantId: string; created: boolean }
  | { ok: false; code: "CONFLICT" | "NOT_FOUND"; message: string };

export async function ensureSoloParticipant(
  db: DatabaseBinding,
  eventId: string,
  userId: string,
  username: string,
  now: string
): Promise<SoloResult> {
  const event = await readEvent(db, eventId);
  if (event === null) {
    return { ok: false, code: "NOT_FOUND", message: "Event not found" };
  }
  const existing = await readActiveMembershipForUserEvent(
    db,
    userId,
    eventId
  );
  if (existing !== null) {
    return { ok: true, participantId: existing.participantId, created: false };
  }
  const participantId = newId();
  await db.batch([
    db
      .prepare(
        "INSERT INTO participants (id, event_id, type, name, event_points, penalty_seconds, started_at, completed_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
      )
      .bind(
        participantId,
        eventId,
        "solo",
        username,
        0,
        0,
        null,
        null,
        now,
        now
      ),
    db
      .prepare(
        "INSERT INTO participant_members (id, participant_id, user_id, role, joined_at, left_at) VALUES (?, ?, ?, ?, ?, ?)"
      )
      .bind(newId(), participantId, userId, "member", now, null)
  ]);
  return { ok: true, participantId, created: true };
}

export const participantsRouter = new Hono<AppEnv>();

participantsRouter.post("/api/participants/:participantId/leave", async (c) => {
  const params = participantIdParams.safeParse({
    participantId: c.req.param("participantId")
  });
  if (params.success === false) {
    return errorResponse(c, "VALIDATION_ERROR", "Invalid participant id");
  }
  const auth = await requireVerifiedUser(c);
  if (auth.ok === false) {
    return auth.response;
  }
  const db = c.env.DB;
  const now = nowIso();
  const nowMs = Date.parse(now);
  const participant = await readParticipant(db, params.data.participantId);
  if (participant === null) {
    return errorResponse(c, "NOT_FOUND", "Participant not found");
  }
  const membership = await readActiveMemberRow(
    db,
    participant.id,
    auth.user.id
  );
  if (membership === null) {
    return errorResponse(c, "FORBIDDEN", "Only active members can leave");
  }
  const history = await readUserEventHistory(
    db,
    auth.user.id,
    participant.eventId
  );
  const cooldown = userCooldownRemainingSeconds(history, nowMs);
  if (cooldown > 0) {
    return errorResponse(
      c,
      "MEMBERSHIP_COOLDOWN",
      "Membership changed too recently",
      { details: { retryAfterSeconds: cooldown } }
    );
  }
  const teamHistory = await readTeamHistory(db, participant.id);
  if (
    countRecentTeamChanges(teamHistory, nowMs) >=
    MAX_MEMBERSHIP_CHANGES_PER_WINDOW
  ) {
    return errorResponse(
      c,
      "MEMBERSHIP_COOLDOWN",
      "Team changed membership too often"
    );
  }
  const members = await readActiveMembers(db, participant.id);
  let successor: StoredMemberWithUsername | null = null;
  if (membership.role === "captain") {
    for (const member of members) {
      if (member.userId !== auth.user.id) {
        successor = member;
        break;
      }
    }
  }
  const statements = [
    db
      .prepare(
        "UPDATE participant_members SET left_at = ? WHERE id = ? AND left_at IS NULL"
      )
      .bind(now, membership.id)
  ];
  if (successor !== null) {
    statements.push(
      db
        .prepare("UPDATE participant_members SET role = ? WHERE id = ?")
        .bind("captain", successor.id)
    );
  }
  const results = await db.batch(statements);
  if (affectedRows(results[0]) !== 1) {
    return errorResponse(c, "CONFLICT", "Membership already ended");
  }
  if (successor !== null && affectedRows(results[1]) !== 1) {
    return errorResponse(
      c,
      "INTERNAL",
      "Left the team but captaincy transfer failed"
    );
  }
  return c.json({
    left: true,
    participantId: participant.id,
    captainTransferredTo: successor === null ? null : successor.username
  });
});

participantsRouter.post(
  "/api/participants/:participantId/transfer-captain",
  async (c) => {
    const params = participantIdParams.safeParse({
      participantId: c.req.param("participantId")
    });
    if (params.success === false) {
      return errorResponse(c, "VALIDATION_ERROR", "Invalid participant id");
    }
    const raw: unknown = await c.req.json().catch(() => ({}));
    const body = transferCaptainSchema.safeParse(raw);
    if (body.success === false) {
      const message =
        body.error.issues[0]?.message ?? "A new captain user id is required";
      return errorResponse(c, "VALIDATION_ERROR", message);
    }
    const auth = await requireVerifiedUser(c);
    if (auth.ok === false) {
      return auth.response;
    }
    const db = c.env.DB;
    const participant = await readParticipant(db, params.data.participantId);
    if (participant === null) {
      return errorResponse(c, "NOT_FOUND", "Participant not found");
    }
    if (participant.kind !== "team") {
      return errorResponse(c, "CONFLICT", "Only teams have captains");
    }
    const caller = await readActiveMemberRow(
      db,
      participant.id,
      auth.user.id
    );
    if (caller === null) {
      return errorResponse(
        c,
        "FORBIDDEN",
        "Only active members can transfer captaincy"
      );
    }
    if (caller.role !== "captain") {
      return errorResponse(
        c,
        "FORBIDDEN",
        "Only the captain can transfer captaincy"
      );
    }
    if (body.data.newCaptainUserId === auth.user.id) {
      return errorResponse(
        c,
        "VALIDATION_ERROR",
        "New captain must be a different member"
      );
    }
    const target = await readActiveMemberRow(
      db,
      participant.id,
      body.data.newCaptainUserId
    );
    if (target === null) {
      return errorResponse(
        c,
        "NOT_FOUND",
        "New captain must be an active member"
      );
    }
    const flag = body.data.setManageMembers;
    let permissionRowId: string | null = null;
    let permissionPushed = false;
    if (flag !== undefined) {
      if (
        flag.userId === auth.user.id ||
        flag.userId === body.data.newCaptainUserId
      ) {
        return errorResponse(
          c,
          "VALIDATION_ERROR",
          "Captain permissions cannot be changed with this flag"
        );
      }
      const permissionRow = await readActiveMemberRow(
        db,
        participant.id,
        flag.userId
      );
      if (permissionRow === null) {
        return errorResponse(c, "NOT_FOUND", "Member not found");
      }
      permissionRowId = permissionRow.id;
      const desired = flag.grant ? MANAGER_ROLE : "member";
      if (permissionRow.role !== desired) {
        permissionPushed = true;
      }
    }
    const statements = [
      db
        .prepare("UPDATE participant_members SET role = ? WHERE id = ?")
        .bind("member", caller.id),
      db
        .prepare("UPDATE participant_members SET role = ? WHERE id = ?")
        .bind("captain", target.id)
    ];
    if (permissionPushed && permissionRowId !== null && flag !== undefined) {
      statements.push(
        db
          .prepare("UPDATE participant_members SET role = ? WHERE id = ?")
          .bind(flag.grant ? MANAGER_ROLE : "member", permissionRowId)
      );
    }
    const results = await db.batch(statements);
    if (
      affectedRows(results[0]) !== 1 ||
      affectedRows(results[1]) !== 1
    ) {
      return errorResponse(c, "CONFLICT", "Captain transfer failed");
    }
    if (permissionPushed && affectedRows(results[2]) !== 1) {
      return errorResponse(
        c,
        "INTERNAL",
        "Captain transferred but permissions were not updated"
      );
    }
    const targetUser = await readUserById(db, target.userId);
    if (targetUser === null) {
      return errorResponse(c, "NOT_FOUND", "New captain not found");
    }
    let permissionUsername = "";
    if (flag !== undefined) {
      const permissionUser = await readUserById(db, flag.userId);
      if (permissionUser === null) {
        return errorResponse(c, "NOT_FOUND", "Member not found");
      }
      permissionUsername = permissionUser.username;
    }
    return c.json({
      captain: { userId: target.userId, username: targetUser.username },
      previousCaptain: { userId: auth.user.id, username: auth.user.username },
      permissions:
        flag === undefined
          ? null
          : {
              userId: flag.userId,
              username: permissionUsername,
              manageMembers: flag.grant
            }
    });
  }
);
