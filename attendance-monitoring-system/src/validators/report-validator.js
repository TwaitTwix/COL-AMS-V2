import { z } from "zod";

export const reportRequestSchema = z.object({
  event_id: z.string().uuid(),
  format: z.enum(["csv", "xlsx", "pdf", "docx"]),
});
