import { randomUUID } from "node:crypto";
import { Worker } from "node:worker_threads";
import { waitUntil } from '@vercel/functions';
import { env } from "../config/env.js";
import { reportSupabase } from "../config/supabase.js";
import { writeAuditLog } from "./audit-service.js";

const pendingJobs = [];
const queuedIds = new Set();
let workerBusy = false;
let queueInitialized = false;
const SIGNED_URL_TTL_SECONDS = 10 * 60;
const cloudJobs=new Map();
const isVercel=()=>process.env.VERCEL==='1';

const formats = {
  csv: { extension: "csv", contentType: "text/csv" },
  xlsx: { extension: "xlsx", contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
  pdf: { extension: "pdf", contentType: "application/pdf" },
  docx: { extension: "docx", contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
};

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function ensureReportConfiguration() {
  if (!reportSupabase) throw httpError(503, "Report storage is not configured. Set the Supabase server secret key.");
}

function runWorker(format, eventId) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("../workers/report.worker.js", import.meta.url), {
      workerData: {
        format,
        eventId: String(eventId),
        supabaseUrl: env.SUPABASE_URL,
        serviceRoleKey: env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY,
      },
    });
    let settled = false;
    const timeout=setTimeout(()=>{
      if(settled)return;
      settled=true;
      void worker.terminate();
      reject(new Error('Report generation exceeded the four-minute processing limit'));
    },240_000);
    timeout.unref?.();
    worker.once("message", (message) => {
      clearTimeout(timeout);
      settled = true;
      if (message.ok) resolve({ buffer: Buffer.from(message.bytes), previewBuffer:Buffer.from(message.previewBytes||message.bytes), recordCount: message.recordCount });
      else reject(new Error(message.error || "Report generation failed"));
    });
    worker.once("error", (error) => {
      clearTimeout(timeout);
      if (!settled) { settled = true; reject(error); }
    });
    worker.once("exit", (code) => {
      clearTimeout(timeout);
      if (!settled) { settled = true; reject(new Error(`Report worker exited unexpectedly (${code})`)); }
    });
  });
}

function publicJob(job) {
  return {
    job_id: job.id,
    status: job.status,
    format: job.format,
    event_id: job.event_id,
    record_count: job.record_count,
    error: job.error,
    created_at: job.created_at,
    updated_at: job.updated_at,
  };
}

function scheduleJob(jobId) {
  if(isVercel()){
    if(cloudJobs.has(jobId))return;
    // Register with the current invocation before returning the HTTP response.
    // Database claims prevent two scaled instances from exporting the same job.
    const task=processJob(jobId).catch(error=>console.error(`Report job ${jobId} could not start:`,error.message)).finally(()=>cloudJobs.delete(jobId));
    cloudJobs.set(jobId,task);
    waitUntil(task);
    return;
  }
  if (queuedIds.has(jobId)) return;
  queuedIds.add(jobId);
  pendingJobs.push(jobId);
  setImmediate(processQueue);
}

async function loadQueuedBatch() {
  const { data, error } = await reportSupabase.from("report_jobs")
    .select("id")
    .eq("status", "queued")
    .order("created_at", { ascending: true })
    .limit(500);
  if (error) throw error;
  for (const job of data || []) scheduleJob(job.id);
}

async function processJob(id) {
  const now = new Date().toISOString();
  const { data: job, error: claimError } = await reportSupabase
    .from("report_jobs")
    .update({ status: "processing", started_at: now, updated_at: now, error: null })
    .eq("id", id)
    .eq("status", "queued")
    .select("id, requested_by, event_id, format")
    .maybeSingle();
  if (claimError) throw claimError;
  if (!job) return;

  try {
    const { buffer: output, previewBuffer, recordCount } = await runWorker(job.format, job.event_id);
    const { extension, contentType } = formats[job.format];
    const objectPath = `${job.id}.${extension}`;
    const { error: uploadError } = await reportSupabase.storage
      .from(env.ATTENDANCE_REPORTS_BUCKET)
      .upload(objectPath, output, { contentType, upsert: true });
    if (uploadError) throw uploadError;

    const previewPath=job.format==='pdf'?objectPath:`${job.id}.preview.pdf`;
    if(job.format!=='pdf'){
      const {error:previewError}=await reportSupabase.storage.from(env.ATTENDANCE_REPORTS_BUCKET).upload(previewPath,previewBuffer,{contentType:'application/pdf',upsert:true});
      if(previewError)throw previewError;
    }
    const finishedAt = new Date().toISOString();
    const { error: saveError } = await reportSupabase.from("report_jobs").update({
      status: "completed", file_path: objectPath, preview_path:previewPath, record_count: recordCount,
      error: null, updated_at: finishedAt, completed_at: finishedAt,
    }).eq("id", job.id);
    if (saveError) throw saveError;
    await writeAuditLog(job.requested_by, "report.generated", "report_job", job.id, { format: job.format, event_id: job.event_id, record_count: recordCount });
  } catch (error) {
    console.error(`Report job ${job.id} failed:`, error);
    const failedAt = new Date().toISOString();
    const { error: failureSaveError } = await reportSupabase.from("report_jobs").update({
      status: "failed",
      error: "Report generation failed. Check the Supabase schema, Storage bucket, and server logs.",
      updated_at: failedAt,
      completed_at: failedAt,
    }).eq("id", job.id);
    if (failureSaveError) console.error(`Could not mark report job ${job.id} as failed:`, failureSaveError.message);
  }
}

async function processQueue() {
  if (workerBusy) return;
  workerBusy = true;
  let jobId;
  try {
    if(!pendingJobs.length)await loadQueuedBatch();
    jobId=pendingJobs.shift();
    if(!jobId)return;
    await processJob(jobId);
  } catch (error) {
    console.error(`Unable to process report queue${jobId?' job '+jobId:''}:`, error.message);
    const retry = setTimeout(() => jobId?scheduleJob(jobId):processQueue(), 5_000);
    retry.unref?.();
  } finally {
    if(jobId)queuedIds.delete(jobId);
    workerBusy = false;
    // Drain additional database batches after the local batch finishes.
    if (jobId || pendingJobs.length) setImmediate(processQueue);
  }
}

export async function initializeReportQueue() {
  if(isVercel())return;
  if (queueInitialized || !reportSupabase) return;
  queueInitialized = true;
  const staleBefore = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { error: recoverError } = await reportSupabase.from("report_jobs")
    .update({ status: "queued", started_at: null, updated_at: new Date().toISOString() })
    .eq("status", "processing")
    .or(`started_at.lt.${staleBefore},started_at.is.null`);
  if (recoverError) {
    queueInitialized = false;
    throw recoverError;
  }
  try {
    await loadQueuedBatch();
  } catch (error) {
    queueInitialized = false;
    throw error;
  }
}

export async function enqueueReport({ event_id, format }, requestedBy) {
  ensureReportConfiguration();
  const id = randomUUID();
  const { data, error } = await reportSupabase.from("report_jobs").insert({
    id,
    requested_by: requestedBy,
    event_id,
    format,
    status: "queued",
  }).select("id, event_id, format, status, record_count, error, created_at, updated_at").single();
  if (error) {
    console.error("Could not queue report:", error.message);
    throw httpError(error.code === "23503" ? 404 : 503, error.code === "23503" ? "Event not found" : "Unable to queue the report");
  }
  scheduleJob(id);
  void writeAuditLog(requestedBy, "report.requested", "report_job", id, { format, event_id });
  return publicJob(data);
}

export async function getReportJob(id) {
  ensureReportConfiguration();
  const { data: job, error } = await reportSupabase.from("report_jobs")
    .select("id, event_id, format, status, record_count, error, created_at, updated_at, file_path, preview_path, started_at")
    .eq("id", id)
    .maybeSingle();
  if (error) throw httpError(503, "Unable to read report job status");
  if (!job) return null;

  if(isVercel()){
    // A terminated invocation can leave a claim behind. Retry only after its
    // entire five-minute platform lifetime has elapsed, never during a run.
    if(job.status==='processing'&&(!job.started_at||Date.parse(job.started_at)<Date.now()-6*60_000)){
      const {data:recovered,error:recoverError}=await reportSupabase.from('report_jobs')
        .update({status:'queued',started_at:null,updated_at:new Date().toISOString()})
        .eq('id',job.id).eq('status','processing').eq('updated_at',job.updated_at)
        .select('id').maybeSingle();
      if(recoverError)throw httpError(503,'Unable to recover the report job');
      if(recovered)job.status='queued';
    }
    if(job.status==='queued')scheduleJob(job.id);
  }

  let signedUrl,previewUrl;
  if (job.status === "completed" && job.file_path) {
    const { data, error: signError } = await reportSupabase.storage
      .from(env.ATTENDANCE_REPORTS_BUCKET)
      .createSignedUrl(job.file_path, SIGNED_URL_TTL_SECONDS);
    if (signError) {
      console.error(`Could not sign report ${job.id}:`, signError.message);
      throw httpError(500, "Report is ready, but a download link could not be created");
    }
    signedUrl = data.signedUrl;
    const previewPath=job.preview_path||(job.format==='pdf'?job.file_path:null);
    if(previewPath){
      const {data:preview,error:previewError}=await reportSupabase.storage.from(env.ATTENDANCE_REPORTS_BUCKET).createSignedUrl(previewPath,SIGNED_URL_TTL_SECONDS);
      if(previewError)throw httpError(503,'Unable to create the report preview link');
      previewUrl=preview.signedUrl;
    }
  }
  return { ...publicJob(job), ...(signedUrl ? { download_url: signedUrl, preview_url:previewUrl, expires_in_seconds: SIGNED_URL_TTL_SECONDS } : {}) };
}
