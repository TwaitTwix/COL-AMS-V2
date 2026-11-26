import { validate } from "../utils/validate.js";
import { getReportJob, enqueueReport } from "../services/report-service.js";
import { reportRequestSchema } from "../validators/report-validator.js";
import { z } from 'zod';

export async function createReport(req, res, next) {
  try {
    const request = validate(reportRequestSchema, req.body);
    const job = await enqueueReport(request, req.authUser.id);
    res.status(202).json({ ...job, status_url: `/api/admin/reports/${job.job_id}` });
  } catch (error) {
    next(error);
  }
}

export async function readReportJob(req, res, next) {
  try {
    const job = await getReportJob(validate(z.string().uuid(),req.params.jobId));
    if (!job) {
      res.status(404).json({ error: { message: "Report job not found", details: [] } });
      return;
    }
    res.status(200).json(job);
  } catch (error) {
    next(error);
  }
}
