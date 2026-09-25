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

export const choiceOptionSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1)
});

export type ChoiceOption = z.infer<typeof choiceOptionSchema>;

export const hintConfigSchema = z.object({
  key: z.string().min(1),
  text: z.string().min(1),
  costPoints: z.number().int().min(0).default(0)
});

export type HintConfig = z.infer<typeof hintConfigSchema>;

export const objectiveConfigSchema = z.object({
  key: z.string().min(1),
  type: objectiveTypeSchema,
  prompt: z.string().min(1),
  required: z.boolean().default(true),
  dependsOn: z.array(z.string().min(1)).default([]),
  validationMode: validationModeSchema.optional(),
  expectedAnswer: z.string().optional(),
  acceptedAnswers: z.array(z.string()).optional(),
  expectedNumeric: z.number().optional(),
  numericTolerance: z.number().min(0).optional(),
  choices: z.array(choiceOptionSchema).optional(),
  correctChoiceId: z.string().min(1).optional(),
  expectedSequence: z.array(z.string()).optional(),
  location: locationParamsSchema.optional(),
  revealCoordinates: z.boolean().default(false),
  placeName: z.string().optional(),
  guidanceText: z.string().optional(),
  maxAttempts: z.number().int().min(1).optional(),
  cooldownSeconds: z.number().int().min(0).default(0),
  progressiveCooldown: z.boolean().default(false),
  wrongAnswerPenaltyPoints: z.number().int().min(0).default(0),
  eventPoints: z.number().int().min(0).default(0),
  platformCredits: z.number().int().min(0).default(0),
  hints: z.array(hintConfigSchema).default([]),
  completionFact: z.string().optional()
}).catchall(z.unknown());

export type ObjectiveConfig = z.infer<typeof objectiveConfigSchema>;

export const requiresDecisionSchema = z.object({
  challengeId: z.string().min(1),
  objectiveKey: z.string().min(1),
  value: z.string().min(1)
});

export type RequiresDecision = z.infer<typeof requiresDecisionSchema>;

export const challengeDateSchema = z
  .string()
  .min(1)
  .max(64)
  .refine((value) => Number.isNaN(Date.parse(value)) === false, "Invalid date");

export const challengeConfigurationSchema = z.object({
  objectives: z.array(objectiveConfigSchema).min(1),
  requires: z.array(z.string().min(1)).default([]),
  availableFrom: challengeDateSchema.optional(),
  availableUntil: challengeDateSchema.optional(),
  hiddenUntilUnlocked: z.boolean().default(false),
  isTerminal: z.boolean().default(false),
  disabled: z.boolean().default(false),
  requiresDecision: requiresDecisionSchema.optional()
}).catchall(z.unknown());

export type ChallengeConfiguration = z.infer<typeof challengeConfigurationSchema>;

export const submitAnswerBodySchema = z.object({
  answer: z.unknown(),
  idempotencyKey: z.string().min(1).max(128).optional(),
  turnstileToken: z.string().min(1).max(2048).optional()
}).catchall(z.unknown());

export type SubmitAnswerBody = z.infer<typeof submitAnswerBodySchema>;

const canonicalReadingSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  accuracyMeters: z.number().min(0),
  capturedAt: z.string().min(1)
}).catchall(z.unknown());

function normalizeReadingKeys(value: unknown): unknown {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return value;
  }
  const record: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    record[key] = entry;
  }
  if ("latitude" in record === false) {
    if ("lat" in record) {
      record["latitude"] = record["lat"];
    }
    if ("lon" in record) {
      record["longitude"] = record["lon"];
    }
    if ("accuracy" in record) {
      record["accuracyMeters"] = record["accuracy"];
    }
    if ("clientTime" in record) {
      record["capturedAt"] = record["clientTime"];
    }
  }
  return record;
}

export const locationReadingSchema = z.preprocess(normalizeReadingKeys, canonicalReadingSchema);

export type LocationReading = z.infer<typeof locationReadingSchema>;

export const verifyLocationBodySchema = z.object({
  readings: z.array(locationReadingSchema).min(1),
  idempotencyKey: z.string().min(1).max(128).optional()
}).catchall(z.unknown());

export type VerifyLocationBody = z.infer<typeof verifyLocationBodySchema>;

export const locationSessionBodySchema = z.object({
  readings: z.array(locationReadingSchema).min(1).optional()
}).catchall(z.unknown());

export type LocationSessionBody = z.infer<typeof locationSessionBodySchema>;

export interface ValidateAnswerInput {
  mode: ValidationMode;
  submitted: unknown;
  expected?: string | undefined;
  acceptedAnswers?: string[] | undefined;
  expectedNumeric?: number | undefined;
  tolerance?: number | undefined;
  expectedSequence?: string[] | undefined;
}

export function normalizeAnswerText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function toFiniteNumber(value: unknown): number | undefined {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      return undefined;
    }
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

export function validateAnswer(input: ValidateAnswerInput): boolean {
  switch (input.mode) {
    case "exact": {
      return typeof input.submitted === "string"
        && input.expected !== undefined
        && input.submitted === input.expected;
    }
    case "case_insensitive": {
      if (typeof input.submitted !== "string" || input.expected === undefined) {
        return false;
      }
      return input.submitted.trim().toLowerCase() === input.expected.trim().toLowerCase();
    }
    case "normalized": {
      if (typeof input.submitted !== "string" || input.expected === undefined) {
        return false;
      }
      return normalizeAnswerText(input.submitted) === normalizeAnswerText(input.expected);
    }
    case "accepted_list": {
      if (typeof input.submitted !== "string" || input.acceptedAnswers === undefined) {
        return false;
      }
      const normalized = normalizeAnswerText(input.submitted);
      return input.acceptedAnswers.some((candidate) => normalizeAnswerText(candidate) === normalized);
    }
    case "numeric_exact": {
      const submitted = toFiniteNumber(input.submitted);
      return submitted !== undefined
        && input.expectedNumeric !== undefined
        && Number.isFinite(input.expectedNumeric)
        && submitted === input.expectedNumeric;
    }
    case "numeric_tolerance": {
      const submitted = toFiniteNumber(input.submitted);
      if (submitted === undefined || input.expectedNumeric === undefined) {
        return false;
      }
      if (Number.isFinite(input.expectedNumeric) === false) {
        return false;
      }
      const tolerance = input.tolerance ?? 0;
      if (Number.isFinite(tolerance) === false || tolerance < 0) {
        return false;
      }
      return Math.abs(submitted - input.expectedNumeric) <= tolerance;
    }
    case "ordered_sequence": {
      const submitted: unknown = input.submitted;
      const expected = input.expectedSequence;
      if (Array.isArray(submitted) === false || expected === undefined) {
        return false;
      }
      if (submitted.length !== expected.length) {
        return false;
      }
      return expected.every((item, index) => {
        const actual: unknown = submitted[index];
        return typeof actual === "string" && normalizeAnswerText(actual) === normalizeAnswerText(item);
      });
    }
  }
}

export function haversineMeters(
  fromLatitude: number,
  fromLongitude: number,
  toLatitude: number,
  toLongitude: number
): number {
  const earthRadiusMeters = 6371000;
  const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;
  const deltaLat = toRadians(toLatitude - fromLatitude);
  const deltaLon = toRadians(toLongitude - fromLongitude);
  const halfChord = Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2)
    + Math.cos(toRadians(fromLatitude)) * Math.cos(toRadians(toLatitude))
    * Math.sin(deltaLon / 2) * Math.sin(deltaLon / 2);
  return 2 * earthRadiusMeters * Math.asin(Math.min(1, Math.sqrt(halfChord)));
}

export type DecisionChoiceMap = Record<string, Record<string, string>>;

export function isChallengeComplete(
  config: ChallengeConfiguration,
  completedObjectiveKeys: readonly string[]
): boolean {
  const required = config.objectives.filter((objective) => objective.required);
  if (required.length > 0) {
    return required.every((objective) => completedObjectiveKeys.includes(objective.key));
  }
  if (config.objectives.length === 0) {
    return false;
  }
  return config.objectives.some((objective) => completedObjectiveKeys.includes(objective.key));
}

export function isChallengeUnlocked(
  config: ChallengeConfiguration,
  completedChallengeIds: readonly string[],
  decisionChoices: Readonly<Record<string, Readonly<Record<string, string>>>>,
  nowIsoValue: string
): boolean {
  // Disabled challenges are organiser-paused content: never unlocked through
  // the player path, regardless of other rules (live-room "disable" control).
  if (config.disabled) {
    return false;
  }
  for (const prerequisite of config.requires) {
    if (completedChallengeIds.includes(prerequisite) === false) {
      return false;
    }
  }
  if (config.requiresDecision !== undefined) {
    const recorded =
      decisionChoices[config.requiresDecision.challengeId]?.[config.requiresDecision.objectiveKey];
    if (recorded !== config.requiresDecision.value) {
      return false;
    }
  }
  const nowMs = Date.parse(nowIsoValue);
  if (Number.isNaN(nowMs)) {
    return false;
  }
  if (config.availableFrom !== undefined) {
    const fromMs = Date.parse(config.availableFrom);
    if (Number.isNaN(fromMs) || nowMs < fromMs) {
      return false;
    }
  }
  if (config.availableUntil !== undefined) {
    const untilMs = Date.parse(config.availableUntil);
    if (Number.isNaN(untilMs) || nowMs > untilMs) {
      return false;
    }
  }
  return true;
}

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
