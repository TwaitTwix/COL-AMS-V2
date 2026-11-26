import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_MAINTENANCE: z.enum(['true','false']).default('false').transform(value=>value==='true'),
  ACCESS_MODE: z.enum(['legacy','revision']).default('legacy'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  HOST: z.string().min(1).default("127.0.0.1"),
  DEVICE_SIGNING_SECRET: z.string().min(32).optional(),
  CRON_SECRET: z.string().min(32).optional(),
  PUBLIC_APP_URL: z.string().url().default(process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : 'http://127.0.0.1:3001'),
  SUPABASE_URL: z.string().url().optional().or(z.literal("")),
  SUPABASE_PUBLISHABLE_KEY: z.string().optional(),
  SUPABASE_SECRET_KEY: z.string().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
  ATTENDANCE_REPORTS_BUCKET: z.string().min(1).default("attendance-reports"),
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  console.error("Invalid environment configuration:", parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
