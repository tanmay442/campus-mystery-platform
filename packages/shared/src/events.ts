import { z } from "zod";

export const eventStatusSchema = z.enum([
  "draft",
  "testing",
  "scheduled",
  "live",
  "paused",
  "completed",
  "archived"
]);

export type EventStatus = z.infer<typeof eventStatusSchema>;

export const participationModeSchema = z.enum([
  "solo_only",
  "team_only",
  "solo_or_team"
]);

export type ParticipationMode = z.infer<typeof participationModeSchema>;

export const winnerModeSchema = z.enum([
  "first_to_complete",
  "highest_points",
  "hybrid"
]);

export type WinnerMode = z.infer<typeof winnerModeSchema>;

export const progressionModeSchema = z.enum([
  "sequential",
  "branching",
  "dependency",
  "open",
  "scheduled",
  "hidden"
]);

export type ProgressionMode = z.infer<typeof progressionModeSchema>;

export const eventSettingsSchema = z.object({
  participation: participationModeSchema.default("solo_or_team"),
  maximumTeamSize: z.number().int().min(1).max(5).default(5),
  winnerMode: winnerModeSchema.default("first_to_complete"),
  lateJoinPenaltySeconds: z.number().int().min(0).default(300),
  leaderboardSize: z.number().int().min(1).default(10),
  publicLeaderboard: z.boolean().default(true),
  nearbyPresence: z.boolean().default(true),
  platformCreditsEnabled: z.boolean().default(true)
});

export type EventSettings = z.infer<typeof eventSettingsSchema>;
