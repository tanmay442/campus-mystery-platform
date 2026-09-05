import { z } from "zod";

export const objectiveTypeSchema = z.enum([
  "text_answer",
  "numeric_answer",
  "multiple_choice",
  "ordered_sequence",
  "code",
  "location",
  "decision",
  "timer",
  "manual_approval",
  "media"
]);

export type ObjectiveType = z.infer<typeof objectiveTypeSchema>;

export const objectiveStatusSchema = z.enum([
  "locked",
  "available",
  "in_progress",
  "completed"
]);

export type ObjectiveStatus = z.infer<typeof objectiveStatusSchema>;

export const validationModeSchema = z.enum([
  "exact",
  "case_insensitive",
  "normalized",
  "accepted_list",
  "numeric_exact",
  "numeric_tolerance",
  "ordered_sequence"
]);

export type ValidationMode = z.infer<typeof validationModeSchema>;

export const locationParamsSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  radiusMeters: z.number().positive().default(10),
  maximumAccuracyMeters: z.number().positive().default(20),
  requiredReadings: z.number().int().min(1).default(3),
  collectionDurationSeconds: z.number().int().min(1).default(8),
  readingsExpireAfterSeconds: z.number().int().min(1).default(60)
});

export type LocationParams = z.infer<typeof locationParamsSchema>;

export const proximityBandSchema = z.enum([
  "extremely_weak",
  "weak",
  "detected",
  "improving",
  "strong",
  "reached"
]);

export type ProximityBand = z.infer<typeof proximityBandSchema>;

export function bandForDistance(
  meters: number,
  radiusMeters = 10
): ProximityBand {
  if (meters <= radiusMeters) {
    return "reached";
  }
  if (meters <= 50) {
    return "strong";
  }
  if (meters <= 80) {
    return "improving";
  }
  if (meters <= 150) {
    return "detected";
  }
  if (meters <= 250) {
    return "weak";
  }
  return "extremely_weak";
}
