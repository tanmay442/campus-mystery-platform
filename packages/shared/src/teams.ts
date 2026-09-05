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
