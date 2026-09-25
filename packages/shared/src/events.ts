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

export interface RouteGraphDecisionOption {
  objectiveKey: string;
  values: string[];
}

export interface RouteGraphNode {
  id: string;
  requires: string[];
  requiresDecision?: { challengeId: string; objectiveKey: string; value: string } | undefined;
  isTerminal: boolean;
  decisionOptions: RouteGraphDecisionOption[];
}

export function validateRouteGraph(nodes: readonly RouteGraphNode[]): string[] {
  const reasons: string[] = [];
  const known = new Set(nodes.map((node) => node.id));
  for (const node of nodes) {
    for (const prerequisite of node.requires) {
      if (known.has(prerequisite) === false) {
        reasons.push(`missing_prerequisite:${node.id}:${prerequisite}`);
      }
    }
    if (
      node.requiresDecision !== undefined &&
      known.has(node.requiresDecision.challengeId) === false
    ) {
      reasons.push(`missing_prerequisite:${node.id}:${node.requiresDecision.challengeId}`);
    }
  }
  const edgesOf = (node: RouteGraphNode): string[] => {
    const edges = node.requires.filter((prerequisite) => known.has(prerequisite));
    if (
      node.requiresDecision !== undefined &&
      known.has(node.requiresDecision.challengeId)
    ) {
      edges.push(node.requiresDecision.challengeId);
    }
    return edges;
  };
  const visited = new Set<string>();
  const trail: string[] = [];
  const inTrail = new Set<string>();
  const cycleMembers = new Set<string>();
  const visit = (id: string): void => {
    if (inTrail.has(id)) {
      const start = trail.indexOf(id);
      const cycle = [...trail.slice(start), id];
      reasons.push(`dependency_cycle:${cycle.join("->")}`);
      for (const member of cycle) {
        cycleMembers.add(member);
      }
      return;
    }
    if (visited.has(id)) {
      return;
    }
    visited.add(id);
    trail.push(id);
    inTrail.add(id);
    const node = nodes.find((entry) => entry.id === id);
    if (node !== undefined) {
      for (const edge of edgesOf(node)) {
        visit(edge);
      }
    }
    trail.pop();
    inTrail.delete(id);
  };
  for (const node of nodes) {
    visit(node.id);
  }
  const reachable = new Set<string>();
  for (const node of nodes) {
    if (node.requires.length === 0 && node.requiresDecision === undefined) {
      reachable.add(node.id);
    }
  }
  let grew = true;
  while (grew) {
    grew = false;
    for (const node of nodes) {
      if (reachable.has(node.id)) {
        continue;
      }
      const depsReady = node.requires.every(
        (prerequisite) => reachable.has(prerequisite) || known.has(prerequisite) === false
      );
      const decisionReady =
        node.requiresDecision === undefined ||
        reachable.has(node.requiresDecision.challengeId) ||
        known.has(node.requiresDecision.challengeId) === false;
      if (depsReady && decisionReady) {
        reachable.add(node.id);
        grew = true;
      }
    }
  }
  for (const node of nodes) {
    // Nodes already reported as cycle members get only the cycle reason,
    // not a redundant unreachable one.
    if (reachable.has(node.id) === false && cycleMembers.has(node.id) === false) {
      reasons.push(`unreachable:${node.id}`);
    }
  }
  for (const node of nodes) {
    if (reachable.has(node.id) === false) {
      continue;
    }
    for (const option of node.decisionOptions) {
      for (const value of option.values) {
        const unlocks = nodes.some(
          (entry) =>
            reachable.has(entry.id) &&
            entry.requiresDecision !== undefined &&
            entry.requiresDecision.challengeId === node.id &&
            entry.requiresDecision.objectiveKey === option.objectiveKey &&
            entry.requiresDecision.value === value
        );
        if (unlocks === false) {
          reasons.push(`branch_without_path:${node.id}:${option.objectiveKey}:${value}`);
        }
      }
    }
  }
  const terminalReachable = nodes.some((node) => node.isTerminal && reachable.has(node.id));
  if (terminalReachable === false) {
    reasons.push("missing_final_target");
  }
  return reasons;
}
