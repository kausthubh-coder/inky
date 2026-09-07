import { z } from "zod";

export const UpdateStateSchema = z.strictObject({
  capability: z.enum(["native", "manual", "unavailable"]),
  installedVersion: z.string(),
  targetVersion: z.string().nullable(),
  phase: z.enum([
    "idle",
    "checking",
    "downloading",
    "ready",
    "preparing_restart",
    "error",
  ]),
  notes: z.string(),
  error: z.string().nullable(),
  restartBlock: z.string().nullable(),
});
export type UpdateState = z.infer<typeof UpdateStateSchema>;

/** Only ordinary releases enter the public desktop update stream. */
export function newerVersion(candidate: string, installed: string): boolean {
  const parse = (value: string) =>
    /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/
      .exec(value)
      ?.slice(1)
      .map(Number);
  const a = parse(candidate);
  const b = parse(installed);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i]! > b[i]!;
  }
  return false;
}
