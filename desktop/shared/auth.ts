import { z } from "zod";

export const AuthUserSchema = z.strictObject({
  subject: z.string().min(1).max(256),
  email: z.string().email().max(320).nullable(),
  name: z.string().min(1).max(200).nullable(),
});

export const EntitlementSchema = z.strictObject({
  plan: z.enum(["beta", "supporter"]),
  credits: z.number().int().nonnegative(),
});

export const AuthStateSchema = z.discriminatedUnion("status", [
  z.strictObject({ status: z.literal("checking") }),
  z.strictObject({
    status: z.literal("signed_out"),
    message: z.string().min(1).max(500).optional(),
  }),
  z.strictObject({ status: z.literal("signing_in") }),
  z.strictObject({
    status: z.literal("approved"),
    user: AuthUserSchema,
    entitlement: EntitlementSchema,
    deviceId: z.string().uuid(),
    secureStorage: z.boolean(),
  }),
  z.strictObject({
    status: z.literal("offline"),
    user: AuthUserSchema,
    entitlement: EntitlementSchema,
    deviceId: z.string().uuid(),
    checkedAt: z.string().datetime(),
    expiresAt: z.string().datetime(),
  }),
  z.strictObject({
    status: z.literal("denied"),
    user: AuthUserSchema,
    reason: z.enum(["waitlist", "device_conflict"]),
    message: z.string().min(1).max(500),
  }),
  z.strictObject({
    status: z.literal("error"),
    message: z.string().min(1).max(500),
    recoverable: z.boolean(),
  }),
]);

export const FeedbackReceiptSchema = z.strictObject({
  accepted: z.literal(true),
  feedbackId: z.string().uuid(),
});

export type AuthState = z.infer<typeof AuthStateSchema>;
export type AuthUser = z.infer<typeof AuthUserSchema>;
export type Entitlement = z.infer<typeof EntitlementSchema>;
export type FeedbackReceipt = z.infer<typeof FeedbackReceiptSchema>;

export function projectProtectedAuthState(state: AuthState, protectedRuntimeReady: boolean): AuthState {
  if ((state.status === "approved" || state.status === "offline") && !protectedRuntimeReady) {
    return { status: "checking" };
  }
  return state;
}
