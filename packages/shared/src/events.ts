/** Shared event contracts: lifecycle, registration policies, settings, payloads. */
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

export const ALLOWED_TRANSITIONS: Record<EventStatus, readonly EventStatus[]> =
  {
    draft: ["testing", "scheduled"],
    testing: ["scheduled", "draft"],
    scheduled: ["live", "completed"],
    live: ["paused", "completed"],
    paused: ["live", "completed"],
    completed: ["archived"],
    archived: []
  };

export function canTransition(from: EventStatus, to: EventStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export const PUBLISHED_STATUSES: readonly EventStatus[] = [
  "scheduled",
  "live",
  "paused",
  "completed"
];

export function isPublishedStatus(status: string): boolean {
  const parsed = eventStatusSchema.safeParse(status);
  if (parsed.success === false) {
    return false;
  }
  return (PUBLISHED_STATUSES as readonly string[]).includes(parsed.data);
}

export const READ_ONLY_STATUSES: readonly EventStatus[] = [
  "completed",
  "archived"
];

export function isReadOnlyStatus(status: string): boolean {
  const parsed = eventStatusSchema.safeParse(status);
  if (parsed.success === false) {
    return false;
  }
  return (READ_ONLY_STATUSES as readonly string[]).includes(parsed.data);
}

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

export const openRegistrationSchema = z.object({
  type: z.literal("open")
});

export const inviteOnlyRegistrationSchema = z.object({
  type: z.literal("invite_only")
});

export const approvalRequiredRegistrationSchema = z.object({
  type: z.literal("approval_required")
});

export const emailDomainRegistrationSchema = z.object({
  type: z.literal("email_domain"),
  domains: z.array(z.string().min(1).max(253)).min(1).max(50)
});

export const accessCodeRegistrationSchema = z.object({
  type: z.literal("access_code"),
  code: z.string().min(1).max(128)
});

export const registrationPolicySchema = z.discriminatedUnion("type", [
  openRegistrationSchema,
  inviteOnlyRegistrationSchema,
  approvalRequiredRegistrationSchema,
  emailDomainRegistrationSchema,
  accessCodeRegistrationSchema
]);

export type RegistrationPolicy = z.infer<typeof registrationPolicySchema>;

const defaultOpenPolicy: RegistrationPolicy = { type: "open" };

export const eventSettingsSchema = z.object({
  participation: participationModeSchema.default("solo_or_team"),
  maximumTeamSize: z.number().int().min(1).max(5).default(5),
  winnerMode: winnerModeSchema.default("first_to_complete"),
  lateJoinPenaltySeconds: z.number().int().min(0).default(300),
  leaderboardSize: z.number().int().min(1).default(10),
  publicLeaderboard: z.boolean().default(true),
  nearbyPresence: z.boolean().default(true),
  platformCreditsEnabled: z.boolean().default(true),
  registration: registrationPolicySchema.default(defaultOpenPolicy)
});

export type EventSettings = z.infer<typeof eventSettingsSchema>;

export const eventSlugSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    "Slug must be lowercase alphanumeric segments separated by dashes"
  );

export const eventDateSchema = z
  .string()
  .min(1)
  .max(64)
  .refine(
    (value) => Number.isNaN(Date.parse(value)) === false,
    "Invalid date"
  );

export const createEventSchema = z.object({
  name: z.string().min(1).max(200),
  slug: eventSlugSchema,
  description: z.string().max(2000).optional(),
  startsAt: eventDateSchema.optional(),
  endsAt: eventDateSchema.optional(),
  settings: z.unknown().optional()
});

export type CreateEventInput = z.infer<typeof createEventSchema>;

export const updateEventSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  slug: eventSlugSchema.optional(),
  description: z.string().max(2000).nullable().optional(),
  startsAt: eventDateSchema.nullable().optional(),
  endsAt: eventDateSchema.nullable().optional(),
  settings: z.unknown().optional(),
  confirmLiveEdit: z.boolean().optional(),
  status: z.never().optional()
});

export type UpdateEventInput = z.infer<typeof updateEventSchema>;
