import { z } from "zod";

// Shared example for validating incoming request payloads with Zod.
export const healthQuerySchema = z.object({
  verbose: z.coerce.boolean().optional().default(false),
});
