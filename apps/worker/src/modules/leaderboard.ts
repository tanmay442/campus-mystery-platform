/** Phase 1 leaderboard: official finish ranking with caller context. */

import { Hono } from "hono";
import { eventSettingsSchema } from "@campus/shared";
import type { WinnerMode } from "@campus/shared";
import { z } from "zod";
import type { AppEnv } from "../env";
import {
  getActiveParticipant,
  listChallengesByEvent,
  loadEventById,
  parseConfiguration,
  resolveRequestUser
} from "./challenges";
import type { ParticipantRow, ProgressRow } from "./challenges";
import { errorResponse } from "../lib/errors";

const NEIGHBOR_RADIUS = 2;

const eventIdParams = z.object({ eventId: z.string().min(1) });

const leaderboardQuery = z
  .object({
    scope: z.enum(["solo", "team"]).optional()
  })
  .catchall(z.unknown());

const participantListSchema = z.array(
  z
    .object({
      id: z.string(),
      event_id: z.string(),
      type: z.string(),
      name: z.string(),
      event_points: z.number(),
      penalty_seconds: z.number(),
      completed_at: z.string().nullable()
    })
    .catchall(z.unknown())
);

const completedProgressListSchema = z.array(
  z
    .object({
      participant_id: z.string(),
      challenge_id: z.string(),
      objective_key: z.string(),
      completed_at: z.string().nullable()
    })
    .catchall(z.unknown())
);

interface RankedEntry {
  participantId: string;
  name: string;
  type: string;
  eventPoints: number;
  finished: boolean;
  officialFinishAt: string | undefined;
  finalCompletionAt: string | undefined;
  requiredCompleted: number;
  lastCompletionAt: string | undefined;
}

function compareFinishOrder(left: RankedEntry, right: RankedEntry): number {
  if (left.finished !== right.finished) {
    return left.finished ? -1 : 1;
  }
  if (left.finished && right.finished) {
    // Equal official timestamps break by earliest accepted final-completion
    // transaction (§14.5), then participant id for determinism.
    const byOfficial = (left.officialFinishAt ?? "").localeCompare(
      right.officialFinishAt ?? ""
    );
    if (byOfficial !== 0) {
      return byOfficial;
    }
    if (left.finalCompletionAt !== right.finalCompletionAt) {
      if (left.finalCompletionAt === undefined) {
        return 1;
      }
      if (right.finalCompletionAt === undefined) {
        return -1;
      }
      const byFinal = left.finalCompletionAt.localeCompare(right.finalCompletionAt);
      if (byFinal !== 0) {
        return byFinal;
      }
    }
    return left.participantId.localeCompare(right.participantId);
  }
  if (left.requiredCompleted !== right.requiredCompleted) {
    return right.requiredCompleted - left.requiredCompleted;
  }
  if (left.lastCompletionAt === undefined || right.lastCompletionAt === undefined) {
    if (left.lastCompletionAt === right.lastCompletionAt) {
      return left.participantId.localeCompare(right.participantId);
    }
    return left.lastCompletionAt === undefined ? 1 : -1;
  }
  const byTime = left.lastCompletionAt.localeCompare(right.lastCompletionAt);
  return byTime !== 0 ? byTime : left.participantId.localeCompare(right.participantId);
}

export function rankParticipants(
  participants: ParticipantRow[],
  completedByParticipant: Map<string, ProgressRow[]>,
  requiredKeys: Set<string>,
  winnerMode: WinnerMode = "first_to_complete"
): RankedEntry[] {
  const entries: RankedEntry[] = participants.map((participant) => {
    const completed = completedByParticipant.get(participant.id) ?? [];
    let requiredCompleted = 0;
    let lastRequiredAt: string | undefined;
    let lastAnyAt: string | undefined;
    let finalCompletionAt: string | undefined;
    for (const row of completed) {
      if (row.completed_at !== null) {
        if (lastAnyAt === undefined || row.completed_at > lastAnyAt) {
          lastAnyAt = row.completed_at;
        }
        if (finalCompletionAt === undefined || row.completed_at > finalCompletionAt) {
          finalCompletionAt = row.completed_at;
        }
      }
      if (requiredKeys.has(`${row.challenge_id}:${row.objective_key}`)) {
        requiredCompleted += 1;
        if (row.completed_at !== null && (lastRequiredAt === undefined || row.completed_at > lastRequiredAt)) {
          lastRequiredAt = row.completed_at;
        }
      }
    }
    const finished = participant.completed_at !== null;
    let officialFinishAt: string | undefined;
    if (finished && participant.completed_at !== null) {
      const officialMs =
        Date.parse(participant.completed_at) + participant.penalty_seconds * 1000;
      officialFinishAt = new Date(officialMs).toISOString();
    }
    return {
      participantId: participant.id,
      name: participant.name,
      type: participant.type,
      eventPoints: participant.event_points,
      finished,
      officialFinishAt,
      finalCompletionAt,
      requiredCompleted,
      lastCompletionAt: lastRequiredAt ?? lastAnyAt
    };
  });
  // first_to_complete ranks by finish order; highest_points and hybrid rank
  // by event points first, with official finish time as tiebreaker (§9.4).
  if (winnerMode === "first_to_complete") {
    return entries.sort(compareFinishOrder);
  }
  return entries.sort((left, right) => {
    if (left.eventPoints !== right.eventPoints) {
      return right.eventPoints - left.eventPoints;
    }
    return compareFinishOrder(left, right);
  });
}

export const leaderboardRouter = new Hono<AppEnv>();

leaderboardRouter.get("/api/events/:eventId/leaderboard", async (c) => {
  const params = eventIdParams.safeParse({
    eventId: c.req.param("eventId")
  });
  if (params.success === false) {
    return errorResponse(c, "VALIDATION_ERROR", "Invalid event id");
  }
  const query = leaderboardQuery.safeParse(c.req.query());
  if (query.success === false) {
    return errorResponse(c, "VALIDATION_ERROR", "Invalid query parameters");
  }
  const db = c.env.DB;
  const event = await loadEventById(db, params.data.eventId);
  if (event === undefined) {
    return errorResponse(c, "EVENT_NOT_FOUND", "Event not found");
  }
  // Leaderboards exist for running and historical events, never for
  // unpublished ones (participant names would leak from drafts).
  if (event.status === "draft" || event.status === "testing") {
    return errorResponse(c, "EVENT_NOT_FOUND", "Event not found");
  }
  const settingsRaw: unknown = await db
    .prepare("/*Q:event_settings*/ SELECT settings_json FROM events WHERE id = ? LIMIT 1")
    .bind(event.id)
    .first();
  let settings = eventSettingsSchema.parse({});
  const settingsParsed = z.object({ settings_json: z.string() }).safeParse(settingsRaw);
  if (settingsParsed.success) {
    try {
      const decoded: unknown = JSON.parse(settingsParsed.data.settings_json);
      const validated = eventSettingsSchema.safeParse(decoded);
      if (validated.success) {
        settings = validated.data;
      }
    } catch {
      // Fall through to defaults.
    }
  }
  const callerUser = await resolveRequestUser(c);
  if (settings.publicLeaderboard === false && callerUser === undefined) {
    return errorResponse(c, "FORBIDDEN", "This leaderboard is private");
  }
  const participantRaw = (await db
    .prepare(
      "/*Q:participants_by_event*/ SELECT id, event_id, type, name, event_points, penalty_seconds, completed_at FROM participants WHERE event_id = ? ORDER BY created_at ASC"
    )
    .bind(event.id)
    .all()).results;
  const participantParsed = participantListSchema.safeParse(participantRaw);
  if (participantParsed.success === false) {
    return errorResponse(c, "INTERNAL", "Could not load the leaderboard");
  }
  const scope = query.data.scope;
  const participants: ParticipantRow[] = participantParsed.data
    .filter((row) => scope === undefined || row.type === scope)
    .map((row) => ({
      id: row.id,
      event_id: row.event_id,
      type: row.type,
      name: row.name,
      event_points: row.event_points,
      penalty_seconds: row.penalty_seconds,
      completed_at: row.completed_at
    }));
  const challenges = await listChallengesByEvent(db, event.id);
  const requiredKeys = new Set<string>();
  for (const challenge of challenges) {
    const config = parseConfiguration(challenge.configuration_json);
    if (config === undefined) {
      continue;
    }
    // Every required objective counts toward unfinished ranking (§14.4),
    // including decision and admin-completed manual objectives.
    for (const objective of config.objectives) {
      if (objective.required) {
        requiredKeys.add(`${challenge.id}:${objective.key}`);
      }
    }
  }
  const progressRaw = (await db
    .prepare(
      "/*Q:progress_completed_event*/ SELECT op.participant_id AS participant_id, op.challenge_id AS challenge_id, op.objective_key AS objective_key, op.completed_at AS completed_at FROM objective_progress op JOIN challenges ch ON ch.id = op.challenge_id WHERE ch.event_id = ? AND op.status = 'completed'"
    )
    .bind(event.id)
    .all()).results;
  const progressParsed = completedProgressListSchema.safeParse(progressRaw);
  const completedByParticipant = new Map<string, ProgressRow[]>();
  if (progressParsed.success) {
    for (const row of progressParsed.data) {
      const entry: ProgressRow = {
        id: "",
        participant_id: row.participant_id,
        challenge_id: row.challenge_id,
        objective_key: row.objective_key,
        status: "completed",
        completed_by: null,
        completed_at: row.completed_at,
        data_json: null,
        idempotency_key: null
      };
      const list = completedByParticipant.get(row.participant_id) ?? [];
      list.push(entry);
      completedByParticipant.set(row.participant_id, list);
    }
  }
  const ranked = rankParticipants(participants, completedByParticipant, requiredKeys, settings.winnerMode);
  const rankedWithPosition = ranked.map((entry, index) => ({
    rank: index + 1,
    participantId: entry.participantId,
    name: entry.name,
    type: entry.type,
    eventPoints: entry.eventPoints,
    finished: entry.finished,
    officialFinishAt: entry.officialFinishAt,
    requiredCompleted: entry.requiredCompleted,
    lastCompletionAt: entry.lastCompletionAt,
    isCaller: false
  }));
  const limit = settings.leaderboardSize;
  const top = rankedWithPosition.slice(0, limit);
  const included = new Set(top.map((entry) => entry.participantId));
  const user = callerUser;
  let caller: (typeof rankedWithPosition)[number] | null = null;
  if (user !== undefined) {
    const participant = await getActiveParticipant(db, user.id, event.id);
    if (participant !== undefined) {
      const position = rankedWithPosition.findIndex(
        (entry) => entry.participantId === participant.id
      );
      if (position >= 0) {
        const start = Math.max(0, position - NEIGHBOR_RADIUS);
        const end = Math.min(rankedWithPosition.length, position + NEIGHBOR_RADIUS + 1);
        for (let index = start; index < end; index += 1) {
          const neighbor = rankedWithPosition[index];
          if (neighbor !== undefined && included.has(neighbor.participantId) === false) {
            included.add(neighbor.participantId);
            top.push(neighbor);
          }
        }
        const callerEntry = rankedWithPosition[position];
        if (callerEntry !== undefined) {
          callerEntry.isCaller = true;
          caller = callerEntry;
        }
      }
    }
  }
  top.sort((left, right) => left.rank - right.rank);
  const provisional = event.status !== "completed" && event.status !== "archived";
  return c.json({
    eventId: event.id,
    provisional,
    leaderboardSize: limit,
    entries: top,
    caller
  });
});
