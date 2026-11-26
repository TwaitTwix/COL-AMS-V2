import "dotenv/config";
import { randomBytes } from "node:crypto";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const projectUrl = process.env.SUPABASE_URL;
const serverKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!projectUrl || !serverKey) {
  throw new Error("Set SUPABASE_URL and a valid server-only SUPABASE_SECRET_KEY in .env before seeding.");
}

const supabase = createClient(projectUrl, serverKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const localDirectory = path.dirname(fileURLToPath(import.meta.url));
const credentialsPath = path.resolve(localDirectory, "../.demo-credentials.json");

const demos = [
  { email: "student.demo@example.com", full_name: "Demo Student", role: "student", student_number: "DEMO-STUDENT-001" },
  { email: "student.officer@example.com", full_name: "Demo Student Officer", role: "student_officer", student_number: "DEMO-OFFICER-001" },
  { email: "col.officer@example.com", full_name: "Demo COL Officer", role: "col_officer", student_number: null },
];

async function findUserByEmail(email) {
  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    const match = data.users.find((user) => user.email?.toLowerCase() === email.toLowerCase());
    if (match) return match;
    if (data.users.length < 1000) return null;
  }
  throw new Error("Too many Auth users to find the demo accounts safely.");
}

async function ensureAuthUser(demo, password) {
  const existing = await findUserByEmail(demo.email);
  if (existing) {
    const { data, error } = await supabase.auth.admin.updateUserById(existing.id, {
      password,
      email_confirm: true,
      user_metadata: { full_name: demo.full_name },
    });
    if (error) throw error;
    return data.user;
  }
  const { data, error } = await supabase.auth.admin.createUser({
    email: demo.email,
    password,
    email_confirm: true,
    user_metadata: { full_name: demo.full_name },
  });
  if (error) throw error;
  return data.user;
}

async function ensureStudent(demo) {
  if (!demo.student_number) return null;
  const { data: existing, error: lookupError } = await supabase
    .from("students")
    .select("id, student_token")
    .eq("student_number", demo.student_number)
    .maybeSingle();
  if (lookupError) throw lookupError;
  if (existing) {
    const { error: updateError } = await supabase
      .from("students")
      .update({ name: demo.full_name, institution: 'ISAP', college: 'College of Information Technology and Engineering', course: 'Bachelor of Science in Information Technology', archived_at: null })
      .eq("id", existing.id);
    if (updateError) throw updateError;
    return existing;
  }

  const { data, error } = await supabase
    .from("students")
    .insert({
      name: demo.full_name,
      student_number: demo.student_number,
      student_token: randomBytes(32).toString("base64url"),
      institution: 'ISAP',
      college: 'College of Information Technology and Engineering',
      course: 'Bachelor of Science in Information Technology',
    })
    .select("id, student_token")
    .single();
  if (error) throw error;
  return data;
}

async function main() {
  const credentials = { generated_at: new Date().toISOString(), warning: "Local demo accounts only. Change passwords before any production use.", accounts: [] };

  for (const demo of demos) {
    const password = `A1!${randomBytes(24).toString("base64url")}`;
    const authUser = await ensureAuthUser(demo, password);
    const student = await ensureStudent(demo);
    const { error: profileError } = await supabase
      .from("user_profiles")
      .upsert({
        user_id: authUser.id,
        email: demo.email,
        full_name: demo.full_name,
        role: demo.role,
        student_id: student?.id || null,
        approval_status: 'approved',
        personal_id: demo.student_number,
        institution: demo.student_number ? 'ISAP' : null,
        college: demo.student_number ? 'College of Information Technology and Engineering' : null,
        course: demo.student_number ? 'Bachelor of Science in Information Technology' : null,
      }, { onConflict: "user_id" });
    if (profileError) throw profileError;

    credentials.accounts.push({
      email: demo.email,
      password,
      role: demo.role,
      student_number: demo.student_number,
      student_token: student?.student_token || null,
    });
    console.log(`Seeded ${demo.role}: ${demo.email}`);
  }

  await writeFile(credentialsPath, `${JSON.stringify(credentials, null, 2)}\n`, { mode: 0o600 });
  console.log("Demo credentials saved to .demo-credentials.json (this file is git-ignored).");
}

main().catch((error) => {
  console.error("Demo account seeding failed:", error.message);
  process.exitCode = 1;
});
