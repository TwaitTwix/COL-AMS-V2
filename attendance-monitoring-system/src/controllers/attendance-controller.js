import { checkIn } from "../services/attendance-service.js";
import { validate } from "../utils/validate.js";
import { checkInSchema } from "../validators/check-in-validator.js";

export async function postCheckIn(req, res, next) {
  try {
    const input = validate(checkInSchema, req.body);
    const result = await checkIn(input, req.authUser.id);
    res.status(201).json({
      message: "Check-in successful",
      attendance: result.attendance,
      student: result.student,
    });
  } catch (error) {
    next(error);
  }
}
