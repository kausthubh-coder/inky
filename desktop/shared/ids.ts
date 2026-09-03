import { z } from "zod";

export const OpaqueIdSchema = z
  .string()
  .min(1)
  .max(256)
  .refine((value) => value.trim().length > 0, { message: "Expected a non-empty opaque ID" });

export const AssignmentIdSchema = OpaqueIdSchema;
export const CourseIdSchema = OpaqueIdSchema;
export const EventIdSchema = OpaqueIdSchema;
export const EvidenceIdSchema = OpaqueIdSchema;
export const IdempotencyKeySchema = OpaqueIdSchema;
export const PatternIdSchema = OpaqueIdSchema;
export const RuleIdSchema = OpaqueIdSchema;
export const RunIdSchema = OpaqueIdSchema;
export const TabIdSchema = OpaqueIdSchema;
export const TaskIdSchema = OpaqueIdSchema;
export const ToolCallIdSchema = OpaqueIdSchema;

const sensitiveUrlParameterKeys = new Set([
  "accesstoken",
  "apikey",
  "auth",
  "authorization",
  "clientsecret",
  "cookie",
  "password",
  "secret",
  "session",
  "sessionid",
  "token",
]);

function normalizeUrlParameterKey(key: string): string {
  return key.normalize("NFKC").toLocaleLowerCase("en-US").replace(/[^a-z0-9]+/g, "");
}

function isSensitiveUrlParameterKey(key: string): boolean {
  return sensitiveUrlParameterKeys.has(normalizeUrlParameterKey(key));
}

function fragmentParameterKeys(url: URL): string[] {
  const fragment = url.hash.slice(1);
  if (!fragment.includes("=")) {
    return [];
  }

  return fragment.split("?").flatMap((queryLikeSegment) => {
    if (!queryLikeSegment.includes("=")) {
      return [];
    }

    return [...new URLSearchParams(queryLikeSegment.replaceAll(";", "&")).keys()];
  });
}

export const SafeSourceTargetSchema = z
  .url()
  .refine((value) => {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  }, { message: "Expected an HTTP or HTTPS source target" })
  .refine((value) => {
    const url = new URL(value);
    return url.username.length === 0 && url.password.length === 0;
  }, { message: "Source targets cannot contain URL credentials" })
  .refine((value) => {
    const url = new URL(value);
    return [...url.searchParams.keys()].every((key) => !isSensitiveUrlParameterKey(key));
  }, { message: "Source targets cannot contain secret-shaped query parameters" })
  .refine(
    (value) => fragmentParameterKeys(new URL(value)).every((key) => !isSensitiveUrlParameterKey(key)),
    { message: "Source targets cannot contain secret-shaped URL fragments" },
  );

export type OpaqueId = z.infer<typeof OpaqueIdSchema>;
export type SafeSourceTarget = z.infer<typeof SafeSourceTargetSchema>;
