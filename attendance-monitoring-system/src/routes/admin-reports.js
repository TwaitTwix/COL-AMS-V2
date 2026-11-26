import { Router } from "express";
import { createReport, readReportJob } from "../controllers/report-controller.js";
import { requireRoles, ADMIN_ROLES } from "../middleware/authenticate-user.js";
import { rateLimit } from "../middleware/rate-limit.js";

const router = Router();
const reportAccess = [
  rateLimit({ max: 180, bucket: "admin-reports-ip" }),
  ...requireRoles(...ADMIN_ROLES),
  rateLimit({ max: 180, bucket: "admin-reports-user", key: (req) => req.authUser.id }),
];
router.post("/reports", ...reportAccess, createReport);
router.get("/reports/:jobId", ...reportAccess, readReportJob);

export default router;
