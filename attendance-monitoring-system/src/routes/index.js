import { Router } from "express";
import healthRouter from "./health.js";
import attendanceRouter from "./attendance.js";
import adminReportsRouter from "./admin-reports.js";
import authRouter from "./auth.js";
import studentRouter from "./student.js";
import adminManagementRouter from "./admin-management.js";
import operationalRouter from './operational.js';
import {env} from '../config/env.js';
import {legacyApiGate} from '../middleware/revision-mode.js';
import publicAttendanceRouter from './public-attendance.js';
import reviewWorkerRouter from './review-worker.js';

const router = Router();
router.use("/health", healthRouter);
router.use((_req,res,next)=>env.APP_MAINTENANCE?res.status(503).set({'Cache-Control':'no-store','Retry-After':'60'}).json({error:{message:'The system is temporarily paused for maintenance. Please retry later.',details:[]}}):next());
router.use("/auth", authRouter);
router.use('/operational',operationalRouter);
router.use('/public-attendance',publicAttendanceRouter);
router.use('/internal',reviewWorkerRouter);
router.use("/attendance",legacyApiGate(env.ACCESS_MODE), attendanceRouter);
router.use("/student",legacyApiGate(env.ACCESS_MODE), studentRouter);
router.use("/admin",legacyApiGate(env.ACCESS_MODE), adminManagementRouter);
router.use("/admin",legacyApiGate(env.ACCESS_MODE), adminReportsRouter);

export default router;
