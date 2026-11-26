import { Router } from "express";
import { postCheckIn } from "../controllers/attendance-controller.js";
import { requireRoles } from "../middleware/authenticate-user.js";
import { rateLimit } from "../middleware/rate-limit.js";

const router = Router();
router.use(
  rateLimit({ max: 160, bucket: "checkin-ip" }),
  // Legacy officer-assisted check-in is restricted to administrators. Students
  // must use the event-QR route, which records their own device and GPS.
  ...requireRoles('main_admin','admin','col_officer'),
  rateLimit({ max: 40, bucket: "checkin-user", key: (req) => req.authUser.id }),
);
router.post("/check-in", postCheckIn);

export default router;
