import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import apiRouter from "./routes/index.js";
import { errorHandler } from "./middleware/error-handler.js";
import { notFoundHandler } from "./middleware/not-found.js";
import {env} from './config/env.js';

const app = express();
const currentDir = path.dirname(fileURLToPath(import.meta.url));

app.disable("x-powered-by");
if(process.env.VERCEL==='1')app.set('trust proxy',1);
app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.resolve(currentDir, "../public")));
// Expose only the two pinned browser-renderer assets, never node_modules itself.
app.get('/vendor/pdfjs/:asset',(req,res,next)=>{
  if(!['pdf.mjs','pdf.worker.mjs'].includes(req.params.asset))return next();
  res.type('application/javascript').sendFile(path.resolve(currentDir,'../node_modules/pdfjs-dist/legacy/build',req.params.asset),{dotfiles:'allow'});
});
app.use("/api", apiRouter);
app.get('/attend/:token',(req,res)=>{res.set({'Cache-Control':'no-store','Referrer-Policy':'no-referrer','Permissions-Policy':'geolocation=(self), camera=(), microphone=()'});if(env.ACCESS_MODE!=='revision')return res.status(404).send('Attendance link unavailable');res.sendFile(path.resolve(currentDir,'../public/attendance.html'),{dotfiles:'allow'});});
app.get('/events/:eventId', (_req,res)=>res.sendFile(path.resolve(currentDir,'../public/index.html'),{dotfiles:'allow'}));
app.get('/account',(_req,res)=>res.sendFile(path.resolve(currentDir,'../public/index.html'),{dotfiles:'allow'}));
app.use(notFoundHandler);
app.use(errorHandler);

export default app;
