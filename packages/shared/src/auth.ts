/** Canonical auth and profile contracts: login exchange, session user, username rules. */
import { z } from "zod";

export const SESSION_COOKIE_NAME = "cmp_session";

export const MAX_ACTIVE_SESSIONS = 2;

export const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;

export const usernameSchema = z
  .string()
  .min(3)
  .max(32)
  .regex(/^[A-Za-z0-9_]+$/);

export const displayNameSchema = z.string().trim().min(1).max(64);

export const deviceLabelSchema = z.string().trim().min(1).max(64);

export const presenceVisibilitySchema = z.enum([
  "visible",
  "count_only",
  "hidden",
]);

export type PresenceVisibility = z.infer<typeof presenceVisibilitySchema>;

const loginOptionalFields = {
  username: usernameSchema.optional(),
  displayName: displayNameSchema.optional(),
  deviceLabel: deviceLabelSchema.optional(),
  turnstileToken: z.string().min(1).max(2048).optional(),
};

export const loginBodySchema = z.union([
  z.object({
    providerToken: z.string().min(1).max(2048),
    ...loginOptionalFields,
  }),
  z.object({
    provider: z.enum(["dev", "clerk"]),
    token: z.string().min(1).max(2048),
    ...loginOptionalFields,
  }),
]);

export type LoginBody = z.infer<typeof loginBodySchema>;

export const updateProfileBodySchema = z.object({
  username: usernameSchema.optional(),
  displayName: displayNameSchema.optional(),
  presenceVisibility: presenceVisibilitySchema.optional(),
});

export type UpdateProfileBody = z.infer<typeof updateProfileBodySchema>;

export const meResponseSchema = z.object({
  id: z.string().min(1),
  email: z.string().email(),
  emailVerified: z.boolean(),
  username: z.string().min(1),
  displayName: z.string().nullable(),
  platformCredits: z.number().int(),
  presenceVisibility: presenceVisibilitySchema,
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
});

export type MeResponse = z.infer<typeof meResponseSchema>;

export const loginResponseSchema = z.object({
  user: meResponseSchema,
  droppedDevice: z.string().min(1).nullable(),
});

export type LoginResponse = z.infer<typeof loginResponseSchema>;

export const usernameAvailabilityQuerySchema = z.object({
  username: usernameSchema,
});

export const usernameAvailabilityResponseSchema = z.object({
  username: z.string().min(1),
  available: z.boolean(),
});

export type UsernameAvailabilityResponse = z.infer<
  typeof usernameAvailabilityResponseSchema
>;
