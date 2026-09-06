import { z } from "zod";

export const teamRoleSchema = z.enum(["captain", "member"]);

export type TeamRole = z.infer<typeof teamRoleSchema>;

export const teamPermissionSchema = z.enum(["manage_members"]);

export type TeamPermission = z.infer<typeof teamPermissionSchema>;

export const inviteStatusSchema = z.enum([
  "pending",
  "approved",
  "rejected",
  "expired",
  "revoked"
]);

export type InviteStatus = z.infer<typeof inviteStatusSchema>;

export const MAX_TEAM_SIZE = 5;

export const JOIN_LEAVE_COOLDOWN_SECONDS = 600;

export const TEAM_APPROVAL_WINDOW_SECONDS = 600;

export const LATE_JOIN_PENALTY_SECONDS = 300;

export const MAX_MEMBERSHIP_CHANGES_PER_WINDOW = 5;

export const DEFAULT_INVITE_EXPIRY_SECONDS = 604800;

export const MANAGER_ROLE = "manager";

export const createTeamSchema = z.object({
  name: z
    .string()
    .min(3)
    .max(40)
    .refine((value) => value === value.trim(), {
      message: "Team name must not start or end with a space"
    })
});

export type CreateTeamInput = z.infer<typeof createTeamSchema>;

export const createInviteSchema = z.object({
  expiresAt: z.string().datetime().optional()
});

export type CreateInviteInput = z.infer<typeof createInviteSchema>;

export const transferCaptainSchema = z.object({
  newCaptainUserId: z.string().min(1),
  setManageMembers: z
    .object({
      userId: z.string().min(1),
      grant: z.boolean()
    })
    .optional()
});

export type TransferCaptainInput = z.infer<typeof transferCaptainSchema>;

export function isCaptainRole(role: string): boolean {
  return role === "captain";
}

export function canManageMembers(role: string): boolean {
  return role === "captain" || role === MANAGER_ROLE;
}
