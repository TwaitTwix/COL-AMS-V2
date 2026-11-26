import { z } from "zod";
import { validCheckpointSchedule } from '../../public/js/checkpoints.js';

export const managedRoleSchema = z.object({
  role: z.enum(["pending", "student", "student_officer", "col_officer", "officer", "admin"]),
  student_id: z.string().uuid().nullable().optional(),
});

export const createStudentSchema = z.object({
  name: z.string().trim().min(1).max(120),
  student_number: z.string().trim().min(1).max(40),
  institution: z.enum(['MCNP','ISAP']).nullable().optional(),
  college: z.string().trim().min(1).max(100).nullable().optional(),
  course: z.string().trim().min(1).max(160).nullable().optional(),
});

export const studentArchiveSchema = z.object({ archived: z.boolean() });

export const createEventSchema = z.object({
  name: z.string().trim().min(1).max(160),
  latitude: z.number().finite().min(-90).max(90),
  longitude: z.number().finite().min(-180).max(180),
  radius_meters: z.number().finite().positive().max(100_000),
  max_check_in_attempts: z.number().int().min(1).max(20).default(3),
  checkpoints:z.array(z.object({key:z.string().regex(/^[a-zA-Z0-9_-]{1,50}$/),label:z.string().trim().min(1).max(80),opens_at:z.string().datetime({offset:true}).optional(),closes_at:z.string().datetime({offset:true}).optional()})).min(1).max(8).default([{key:'default',label:'Attendance'}]),
  starts_at: z.string().datetime({ offset: true }),
  ends_at: z.string().datetime({ offset: true }),
  institution: z.enum(['MCNP','ISAP']).nullable().default(null),
  college: z.string().trim().min(1).max(100).nullable().default(null),
}).refine(validCheckpointSchedule,{path:['checkpoints'],message:'Checkpoint windows must be ordered, non-overlapping and inside the event attendance window'}).refine((event) => Date.parse(event.starts_at) <= Date.parse(event.ends_at), {
  path: ["ends_at"],
  message: "Event end must be after its start",
}).refine(event=>!event.college||!!event.institution,{path:['college'],message:'Choose an institution for this college'});

export const eventArchiveSchema = z.object({ archived: z.boolean() });
