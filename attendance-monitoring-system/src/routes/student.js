import { Router } from "express";
import { getStudentDashboard } from "../controllers/student-controller.js";
import { requireRoles } from "../middleware/authenticate-user.js";
import { dashboard,eventDetail,eventStatistics,selfCheckIn,studentNotifications,prepareAttendanceProfile } from '../controllers/portal-controller.js';
import { rateLimit } from '../middleware/rate-limit.js';

const router = Router();
router.get("/me", ...requireRoles("student", "student_officer"), getStudentDashboard);
const studentAccess=[...requireRoles('student','student_officer','admin','col_officer','main_admin','officer')];
router.post('/attendance-profile',...studentAccess,prepareAttendanceProfile);
router.get('/dashboard',...studentAccess,dashboard);
router.get('/notifications',...studentAccess,studentNotifications);
router.get('/events/:eventId',...studentAccess,eventDetail);
router.get('/events/:eventId/statistics',...studentAccess,eventStatistics);
router.post('/check-in',...studentAccess,rateLimit({max:20,bucket:'self-checkin',key:req=>req.authUser.id}),selfCheckIn);

export default router;
