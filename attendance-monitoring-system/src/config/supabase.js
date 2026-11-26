import { createClient } from "@supabase/supabase-js";
import { env } from "./env.js";

const supabaseKey = env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY;

export const supabase = env.SUPABASE_URL && supabaseKey
  ? createClient(env.SUPABASE_URL, supabaseKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
  : null;

// Verify user access tokens through Auth using the project's public API key.
// Keep this separate from the privileged client used for profile lookups/writes.
export const authVerifier = env.SUPABASE_URL && env.SUPABASE_PUBLISHABLE_KEY
  ? createClient(env.SUPABASE_URL, env.SUPABASE_PUBLISHABLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
  : null;

// Report exports require privileged access to the private Storage bucket.
const serverSecretKey = env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY;

export const reportSupabase = env.SUPABASE_URL && serverSecretKey
  ? createClient(env.SUPABASE_URL, serverSecretKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
  : null;
