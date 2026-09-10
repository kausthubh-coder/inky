import { z } from "zod";

export const clerkUserSchema = z.object({
  id: z.string(),
  banned: z.boolean(),
  locked: z.boolean(),
  primary_email_address_id: z.string().nullable(),
  email_addresses: z.array(z.object({
    id: z.string(),
    email_address: z.string(),
    verification: z.object({ status: z.string() }).nullable(),
  })),
});

export const waitlistPageSchema = z.object({
  data: z.array(z.object({
    email_address: z.string(),
    status: z.enum(["pending", "invited", "completed", "rejected"]),
    invitation: z.object({
      status: z.enum(["pending", "accepted", "revoked", "expired"]),
      revoked: z.boolean().optional(),
    }).nullable(),
  })),
  total_count: z.number(),
});

export function verifiedPrimaryEmail(user: z.infer<typeof clerkUserSchema>): string | null {
  const email = user.email_addresses.find((value) => value.id === user.primary_email_address_id);
  return email?.verification?.status === "verified" ? email.email_address.trim().toLowerCase() : null;
}

export function admissionDecision(
  user: z.infer<typeof clerkUserSchema>,
  entries: z.infer<typeof waitlistPageSchema>["data"],
): "approved" | "waitlist" | "revoked" {
  if (user.banned || user.locked) return "revoked";
  const email = verifiedPrimaryEmail(user);
  if (!email) return "waitlist";
  const matches = entries.filter((entry) => entry.email_address.trim().toLowerCase() === email);
  if (matches.some((entry) => entry.status === "rejected" || entry.invitation?.revoked || entry.invitation?.status === "revoked")) return "revoked";
  return matches.some((entry) =>
    (entry.status === "invited" || entry.status === "completed")
    && (entry.invitation?.status === "pending" || entry.invitation?.status === "accepted"),
  ) ? "approved" : "waitlist";
}
