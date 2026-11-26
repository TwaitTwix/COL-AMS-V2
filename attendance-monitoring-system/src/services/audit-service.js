import { supabase } from "../config/supabase.js";

export async function writeAuditLog(actorUserId, action, entityType, entityId, details = {}) {
  if (!supabase) return;
  try {
    const { error } = await supabase.from("audit_logs").insert({
      actor_user_id: actorUserId || null,
      action,
      entity_type: entityType,
      entity_id: entityId == null ? null : String(entityId),
      details,
    });
    if (error) console.error("Could not write audit log:", error.message);
  } catch (error) {
    console.error("Could not write audit log:", error.message);
  }
}
