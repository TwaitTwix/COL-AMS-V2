import { supabase } from "../config/supabase.js";

export async function getStudentDashboard(req, res, next) {
  try {
    const studentId = req.userProfile.student_id;
    if (!studentId) {
      res.status(409).json({ error: { message: "Your student record is not linked yet. Contact a COL officer.", details: [] } });
      return;
    }

    const { data: student, error: studentError } = await supabase
      .from("students")
      .select("id, name, student_number, student_token, archived_at")
      .eq("id", studentId)
      .maybeSingle();
    if (studentError) throw studentError;
    if (!student) {
      res.status(404).json({ error: { message: "Student record not found", details: [] } });
      return;
    }

    const { data: attendance, error: attendanceError } = await supabase
      .from("attendance_logs")
      .select("id, checked_in_at, distance_from_venue_meters, events(name, starts_at, ends_at)")
      .eq("student_id", studentId)
      .order("checked_in_at", { ascending: false })
      .limit(50);
    if (attendanceError) throw attendanceError;

    res.status(200).json({
      student: student.archived_at ? { ...student, student_token: null } : student,
      attendance: attendance || [],
    });
  } catch (error) {
    next(error);
  }
}
