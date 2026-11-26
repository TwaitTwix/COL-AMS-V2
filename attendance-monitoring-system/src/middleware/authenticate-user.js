import { PRIVACY_VERSION } from "../config/privacy.js";
import { authVerifier, supabase } from "../config/supabase.js";
import { enforceLoginSession } from '../services/login-session-service.js';
import { env } from '../config/env.js';
import { createOperationalAuthenticator } from '../services/operational-access-service.js';
const operationalAuthenticator=createOperationalAuthenticator({client:supabase,verifier:authVerifier,privacyVersion:PRIVACY_VERSION});

function sendError(res, status, message,code) {
  return res.set('Cache-Control','no-store').status(status).json({ error: { message, details: [],...(code?{code}:{}) } });
}

async function loadOrCreateProfile(user) {
  const { data: existing, error: selectError } = await supabase
    .from("user_profiles")
    .select("user_id, email, full_name, role, student_id, personal_id, institution, college, approval_status, review_note, penalty_points, course, privacy_version, privacy_accepted_at, retired_at")
    .eq("user_id", user.id)
    .maybeSingle();
  if (selectError) throw selectError;
  if (existing) {
    if(existing.retired_at)return existing;
    const email = user.email || null;
    if (existing.email !== email) {
      const { data: updated, error: updateError } = await supabase
        .from("user_profiles")
        .update({ email })
        .eq("user_id", user.id)
        .select("user_id, email, full_name, role, student_id, personal_id, institution, college, approval_status, review_note, penalty_points, course, privacy_version, privacy_accepted_at, retired_at")
        .single();
      if (updateError) throw updateError;
      return updated;
    }
    return existing;
  }

  const fullName = typeof user.user_metadata?.full_name === "string"
    ? user.user_metadata.full_name.trim().slice(0, 120)
    : "";
  const { error: insertError } = await supabase
    .from("user_profiles")
    .insert({ user_id: user.id, email: user.email || null, full_name: fullName, role: "pending" });
  if (insertError && insertError.code !== "23505") throw insertError;

  const { data: created, error: reloadError } = await supabase
    .from("user_profiles")
    .select("user_id, email, full_name, role, student_id, personal_id, institution, college, approval_status, review_note, penalty_points, course, privacy_version, privacy_accepted_at, retired_at")
    .eq("user_id", user.id)
    .single();
  if (reloadError) throw reloadError;
  return created;
}

export async function authenticateUser(req, res, next,{activate=false}={}) {
  if(env.ACCESS_MODE==='revision')return operationalAuthenticator(req,res,next,{activate});
  if (!supabase || !authVerifier) {
    return sendError(res, 503, "Authentication is not configured on the server. Check the Supabase URL, publishable key, and server secret key.");
  }

  const match = /^Bearer\s+(.+)$/i.exec(req.get("authorization") || "");
  const accessToken = match?.[1];
  if (!accessToken) return sendError(res, 401, "Sign in to continue");

  try {
    const { data, error } = await authVerifier.auth.getUser(accessToken);
    const user = data?.user;
    if (error || !user) {
      if (error) {
      console.warn("Supabase rejected an attendance access token:", {
          status: error.status,
          code: error.code,
          message: error.message,
        });
      }
      const status = error?.status >= 500 || !error?.status ? 503 : 401;
      const message = status === 503
        ? "Unable to verify your session with Supabase. Check the server configuration and try again."
        : "Your session is invalid or has expired. Sign in again.";
      return sendError(res, status, message);
    }
    if (!user.email_confirmed_at && !user.confirmed_at) {
      return sendError(res, 403, "Verify your email before using the attendance console");
    }

    const profile = await loadOrCreateProfile(user);
    if(profile.retired_at)return sendError(res,401,'This account has been retired. Register again or contact an administrator.');
    try{await enforceLoginSession({userId:user.id,accessToken,activate},(name,args)=>supabase.rpc(name,args));}catch(e){return sendError(res,e.status||503,e.message,e.code);}
    req.authUser = user;
    req.userProfile = profile;
    next();
  } catch (error) {
    console.error("Could not authenticate attendance user:", error.message);
    next(Object.assign(new Error("Unable to verify your account"), { status: 503 }));
  }
}
export const activateUserSession=(req,res,next)=>authenticateUser(req,res,next,{activate:true});

export function requireRoles(...roles) {
  return [authenticateUser, (req, res, next) => {
    if (req.userProfile.approval_status !== 'approved' || !roles.includes(req.userProfile.role)) {
      const message = req.userProfile.role === "pending"
        ? "Your account is awaiting officer access approval"
        : "You do not have permission to use this feature";
      return sendError(res, 403, message);
    }
    if(req.userProfile.privacy_version!==PRIVACY_VERSION)return sendError(res,403,'Accept the privacy notice before continuing');
    return next();
  }];
}

export const SCANNING_ROLES = ["student_officer", "col_officer", "officer", "admin"];
export const ADMIN_ROLES = ["col_officer", "admin", "main_admin"];
