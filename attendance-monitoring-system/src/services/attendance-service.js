import { supabase } from "../config/supabase.js";
import { writeAuditLog } from "./audit-service.js";

const EARTH_RADIUS_METERS = 6_371_000;

export function haversineDistanceMeters(latitude1, longitude1, latitude2, longitude2) {
  const toRadians = (degrees) => (degrees * Math.PI) / 180;
  const latitudeDelta = toRadians(latitude2 - latitude1);
  const longitudeDelta = toRadians(longitude2 - longitude1);
  const a = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(toRadians(latitude1)) * Math.cos(toRadians(latitude2))
    * Math.sin(longitudeDelta / 2) ** 2;
  // Floating-point rounding can put `a` a fraction outside [0, 1] for
  // nearly antipodal points. Clamp it so a malformed distance is never stored.
  const clampedA = Math.min(1, Math.max(0, a));
  return 2 * EARTH_RADIUS_METERS * Math.atan2(Math.sqrt(clampedA), Math.sqrt(1 - clampedA));
}

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function ensureConfigured() {
  if (!supabase) {
    throw httpError(503, "Attendance service is not configured");
  }
}

function throwIfSupabaseError(error) {
  if (error) {
    if (error.code === "23505") {
      throw httpError(409, "Already checked in");
    }
    console.error("Supabase attendance request failed:", error.message);
    throw httpError(500, "Unable to process check-in");
  }
}

export async function checkIn({ student_token, event_id, latitude, longitude }, actorUserId) {
  ensureConfigured();

  const { data: event, error: eventError } = await supabase
    .from("events")
    .select("id, latitude, longitude, radius_meters, starts_at, ends_at, archived_at, checkpoints")
    .eq("id", event_id)
    .maybeSingle();
  throwIfSupabaseError(eventError);
  if (!event) throw httpError(404, "Event not found");
  if(event.checkpoints?.length>1)throw httpError(400,'Use Manual attendance and choose an event checkpoint');
  if (event.archived_at) throw httpError(400, "Event is archived and is not accepting check-ins");

  const centerLatitude = Number(event.latitude);
  const centerLongitude = Number(event.longitude);
  const radiusMeters = Number(event.radius_meters);
  if (![centerLatitude, centerLongitude, radiusMeters].every(Number.isFinite) || radiusMeters < 0) {
    console.error("Event has invalid geofence coordinates or radius:", event.id);
    throw httpError(500, "Event geofence is not configured correctly");
  }

  const now = Date.now();
  const startsAt = Date.parse(event.starts_at);
  const endsAt = Date.parse(event.ends_at);
  if (!Number.isFinite(startsAt) || !Number.isFinite(endsAt) || startsAt > endsAt) {
    console.error("Event has invalid active window:", event.id);
    throw httpError(500, "Event active window is not configured correctly");
  }
  if (now < startsAt || now > endsAt) {
    throw httpError(400, "Event is not currently accepting check-ins");
  }

  const distance = haversineDistanceMeters(latitude, longitude, centerLatitude, centerLongitude);
  if (!Number.isFinite(distance)) {
    console.error("Could not calculate attendance distance for event:", event.id);
    throw httpError(500, "Unable to verify the venue distance");
  }
  if (distance > radiusMeters) {
    throw httpError(400, "Outside geofence perimeter");
  }

  const { data: student, error: studentError } = await supabase
    .from("students")
    .select("id, name, student_number")
    .eq("student_token", student_token)
    .is("archived_at", null)
    .maybeSingle();
  throwIfSupabaseError(studentError);
  if (!student) throw httpError(404, "Student token not found");

  const { data: existing, error: duplicateError } = await supabase
    .from("attendance_logs")
    .select("id")
    .eq("student_id", student.id)
    .eq("event_id", event.id)
    .maybeSingle();
  throwIfSupabaseError(duplicateError);
  if (existing) throw httpError(409, "Already checked in");

  const checkedInAt = new Date(now).toISOString();
  const distanceMeters = Number(distance.toFixed(2));
  const { data: attendance, error: insertError } = await supabase
    .from("attendance_logs")
    .insert({
      student_id: student.id,
      event_id: event.id,
      distance_from_venue_meters: distanceMeters,
      checked_in_at: checkedInAt,
    })
    .select("id, checked_in_at, distance_from_venue_meters")
    .single();
  throwIfSupabaseError(insertError);

  await writeAuditLog(actorUserId, "attendance.checked_in", "attendance_log", attendance.id, {
    student_id: student.id,
    event_id: event.id,
    distance_from_venue_meters: distanceMeters,
  });
  return { attendance, student };
}
