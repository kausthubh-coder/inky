import { z } from "zod";

export const STUDI_SCHEMA_VERSION = 1 as const;
export const SchemaVersionSchema = z.literal(STUDI_SCHEMA_VERSION);

export const IsoTimestampSchema = z
  .string()
  .refine(
    (value) => {
      const timestamp = Date.parse(value);
      return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
    },
    { message: "Expected a normalized ISO-8601 UTC timestamp with millisecond precision" },
  );

export type IsoTimestamp = z.infer<typeof IsoTimestampSchema>;
