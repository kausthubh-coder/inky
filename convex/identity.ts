import type { GenericMutationCtx, GenericQueryCtx } from "convex/server";
import type { DataModel } from "./_generated/dataModel.js";

export async function requireIdentity(
  ctx: GenericMutationCtx<DataModel> | GenericQueryCtx<DataModel>,
) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new Error("Unauthenticated");
  return identity;
}

export function nullableText(value: string | undefined): string | null {
  const text = value?.trim();
  return text ? text.slice(0, 320) : null;
}
