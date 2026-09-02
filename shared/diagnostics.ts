import { z } from "zod";

export const DiagnosticsExportReceiptSchema = z.discriminatedUnion("status", [
  z.strictObject({ status: z.literal("cancelled") }),
  z.strictObject({
    status: z.literal("saved"),
    fileName: z.string().min(1).max(260),
    exportedAt: z.iso.datetime({ offset: false, local: false }),
  }),
]);

export type DiagnosticsExportReceipt = z.infer<typeof DiagnosticsExportReceiptSchema>;
