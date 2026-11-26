import { randomBytes } from "node:crypto";
import { supabase } from "../config/supabase.js";
import { validate } from "../utils/validate.js";
import {
  createEventSchema,
  createStudentSchema,
  eventArchiveSchema,
  managedRoleSchema,
  studentArchiveSchema,
} from "../validators/admin-validator.js";
import { writeAuditLog } from "../services/audit-service.js";
import { uuid } from './portal-controller.js';
import { validateAcademicSelection } from '../services/academic-service.js';

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}
async function validateAffiliation(input){
  await validateAcademicSelection(input);
}
async function validateEventAffiliation(input){
  if(input.college)await validateAffiliation(input);
}

export async function listManagedUsers(_req, res, next) {
  try {
    const { data, error } = await supabase
      .from("user_profiles")
      .select("user_id, email, full_name, role, student_id, created_at,personal_id,institution,college,course,approval_status,penalty_points,review_note")
      .is("retired_at", null)
      .order("created_at", { ascending: false });
    if (error) throw error;
    res.status(200).json({ users: data || [] });
  } catch (error) {
    next(error);
  }
}

export async function updateManagedUser(req, res, next) {
  try {
    const input = validate(managedRoleSchema, req.body);
    if(req.userProfile.role!=='main_admin')throw httpError(403,'Only the main administrator can promote or demote users');
    validate(uuid,req.params.userId);
    const { userId } = req.params;
    if (input.role === "student" || input.role === "student_officer") {
      if (!input.student_id) throw httpError(400, "Choose a student record for student accounts");
      const { data: student, error: studentError } = await supabase
        .from("students").select("id").eq("id", input.student_id).is("archived_at", null).maybeSingle();
      if (studentError) throw studentError;
      if (!student) throw httpError(404, "Student record not found");
    }

    if (userId === req.authUser.id && !["admin", "col_officer"].includes(input.role)) {
      throw httpError(400, "You cannot remove your own COL officer access");
    }

    let studentId=input.student_id;
    const { data: previous, error: previousError } = await supabase
      .from("user_profiles")
      .select("user_id, role, student_id, retired_at")
      .eq("user_id", userId)
      .maybeSingle();
    if (previousError) throw previousError;
    if (!previous) throw httpError(404, "Account not found");
    if(previous.retired_at)throw httpError(409,"Retired accounts cannot be changed. Use the new registration instead");
    studentId=studentId===undefined?(previous.student_id||null):studentId;
    if(previous.role==='main_admin')throw httpError(403,'The main administrator role cannot be changed here');
    const {data:target,error:targetError}=await supabase.from('user_profiles').select('approval_status').eq('user_id',userId).single();
    if(targetError)throw targetError;
    if(target.approval_status!=='approved')throw httpError(400,'Approve the registration before assigning roles');

    const { data, error } = await supabase
      .from("user_profiles")
      .update({ role: input.role, student_id: studentId })
      .eq("user_id", userId)
      .select("user_id, email, full_name, role, student_id, created_at")
      .maybeSingle();
    if (error?.code === "23505") throw httpError(409, "That student record is already linked to another account");
    if (error) throw error;
    if (!data) throw httpError(404, "Account not found");
    await writeAuditLog(req.authUser.id, "account.role_changed", "user_profile", data.user_id, {
      previous_role: previous.role,
      role: data.role,
      previous_student_id: previous.student_id,
      student_id: data.student_id,
    });
    res.status(200).json({ user: data });
  } catch (error) {
    next(error);
  }
}

export async function listStudents(_req, res, next) {
  try {
    const { data, error } = await supabase
      .from("students")
      .select("id, name, student_number, created_at, archived_at,institution,college,course")
      .order("name", { ascending: true });
    if (error) throw error;
    res.status(200).json({ students: data || [] });
  } catch (error) {
    next(error);
  }
}

export async function updateStudent(req, res, next) {
  try {
    const input = validate(createStudentSchema, req.body);
    await validateAffiliation(input);
    const { data, error } = await supabase.from("students")
      .update(input)
      .eq("id", req.params.studentId)
      .select("id, name, student_number, created_at, archived_at")
      .maybeSingle();
    if (error?.code === "23505") throw httpError(409, "That student number is already registered");
    if (error) throw error;
    if (!data) throw httpError(404, "Student record not found");
    await writeAuditLog(req.authUser.id, "student.updated", "student", data.id, { student_number: data.student_number });
    res.status(200).json({ student: data });
  } catch (error) {
    next(error);
  }
}

export async function archiveStudent(req, res, next) {
  try {
    const { archived } = validate(studentArchiveSchema, req.body);
    const { data, error } = await supabase.from("students")
      .update({ archived_at: archived ? new Date().toISOString() : null })
      .eq("id", req.params.studentId)
      .select("id, name, student_number, archived_at")
      .maybeSingle();
    if (error) throw error;
    if (!data) throw httpError(404, "Student record not found");
    await writeAuditLog(req.authUser.id, archived ? "student.archived" : "student.restored", "student", data.id, { student_number: data.student_number });
    res.status(200).json({ student: data });
  } catch (error) {
    next(error);
  }
}

export async function createStudent(req, res, next) {
  try {
    const input = validate(createStudentSchema, req.body);
    await validateAffiliation(input);
    const { data, error } = await supabase
      .from("students")
      .insert({ ...input, student_token: randomBytes(32).toString("base64url") })
      .select("id, name, student_number, student_token, created_at")
      .single();
    if (error?.code === "23505") throw httpError(409, "That student number is already registered");
    if (error) throw error;
    await writeAuditLog(req.authUser.id, "student.created", "student", data.id, { student_number: data.student_number });
    res.status(201).json({ student: data });
  } catch (error) {
    next(error);
  }
}

export async function listEvents(_req, res, next) {
  try {
    const { data, error } = await supabase
      .from("events")
      .select("id, name, latitude, longitude, radius_meters, starts_at, ends_at, archived_at,institution,college,max_check_in_attempts,checkpoints")
      .order("starts_at", { ascending: false })
      .limit(100);
    if (error) throw error;
    res.status(200).json({ events: data || [] });
  } catch (error) {
    next(error);
  }
}

export async function updateEvent(req, res, next) {
  try {
    const input = validate(createEventSchema, req.body);
    await validateEventAffiliation(input);
    const { data, error } = await supabase.from("events")
      .update(input)
      .eq("id", req.params.eventId)
      .select("id, name, latitude, longitude, radius_meters, starts_at, ends_at, archived_at")
      .maybeSingle();
    if(error?.code==='P0001')throw httpError(400,error.message);
    if (error) throw error;
    if (!data) throw httpError(404, "Event not found");
    await writeAuditLog(req.authUser.id, "event.updated", "event", data.id, { name: data.name });
    res.status(200).json({ event: data });
  } catch (error) {
    next(error);
  }
}

export async function archiveEvent(req, res, next) {
  try {
    const { archived } = validate(eventArchiveSchema, req.body);
    const { data, error } = await supabase.from("events")
      .update({ archived_at: archived ? new Date().toISOString() : null })
      .eq("id", req.params.eventId)
      .select("id, name, archived_at")
      .maybeSingle();
    if(error?.code==='P0001')throw httpError(400,error.message);
    if (error) throw error;
    if (!data) throw httpError(404, "Event not found");
    await writeAuditLog(req.authUser.id, archived ? "event.archived" : "event.restored", "event", data.id, { name: data.name });
    res.status(200).json({ event: data });
  } catch (error) {
    next(error);
  }
}

export async function createEvent(req, res, next) {
  try {
    const input = validate(createEventSchema, req.body);
    await validateEventAffiliation(input);
    const { data, error } = await supabase
      .from("events")
      .insert(input)
      .select("id, name, latitude, longitude, radius_meters, starts_at, ends_at")
      .single();
    if (error) throw error;
    await writeAuditLog(req.authUser.id, "event.created", "event", data.id, { name: data.name });
    res.status(201).json({ event: data });
  } catch (error) {
    next(error);
  }
}

export async function listAuditLogs(req, res, next) {
  try {
    const requested = Number.parseInt(req.query.limit, 10);
    const limit = Number.isInteger(requested) ? Math.max(1, Math.min(100, requested)) : 50;
    const { data: logs, error } = await supabase
      .from("audit_logs")
      .select("id, actor_user_id, action, entity_type, entity_id, details, created_at")
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) throw error;

    const actorIds = [...new Set((logs || []).map((entry) => entry.actor_user_id).filter(Boolean))];
    const actorsById = new Map();
    if (actorIds.length) {
      const { data: actors, error: actorError } = await supabase
        .from("user_profiles")
        .select("user_id, email, full_name")
        .in("user_id", actorIds);
      if (actorError) throw actorError;
      for (const actor of actors || []) actorsById.set(actor.user_id, actor);
    }

    res.status(200).json({ logs: (logs || []).map((entry) => ({
      ...entry,
      actor: actorsById.get(entry.actor_user_id) || null,
    })) });
  } catch (error) {
    next(error);
  }
}
