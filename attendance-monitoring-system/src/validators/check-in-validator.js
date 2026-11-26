import { z } from "zod";

export const checkInSchema = z.object({
  student_token: z.string().trim().min(1).max(512),
  event_id: z.string().uuid(),
  latitude: z.number().finite().min(-90).max(90),
  longitude: z.number().finite().min(-180).max(180),
});
