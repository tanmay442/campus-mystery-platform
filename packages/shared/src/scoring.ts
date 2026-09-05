import { z } from "zod";

export const FIXED_DEFAULTS = {
  maxTeamSize: 5,
  devicesPerAccount: 2,
  lateJoinPenaltySeconds: 300,
  membershipCooldownSeconds: 600,
  teamApprovalWindowSeconds: 600,
  locationReadings: 3,
  locationReadingValiditySeconds: 60,
  locationCollectionDurationSeconds: 8,
  strongSignalBandMinMeters: 20,
  strongSignalBandMaxMeters: 50,
  presenceExpirySeconds: 90,
  publicPingCooldownSeconds: 600,
  teamPingLimitPerMinute: 20,
  leaderboardSize: 10,
  leaderboardPollMinSeconds: 10,
  leaderboardPollMaxSeconds: 20
};

export const adjustmentReasonSchema = z.enum([
  "challenge_completion",
  "optional_objective",
  "difficulty_bonus",
  "hint_penalty",
  "wrong_answer_penalty",
  "team_change_penalty",
  "late_join_penalty",
  "organiser_adjustment",
  "manual_completion",
  "manual_reversal",
  "credit_reward"
]);

export type AdjustmentReason = z.infer<typeof adjustmentReasonSchema>;
