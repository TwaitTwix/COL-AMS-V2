import { Router } from "express";
import { getCurrentUser, getPublicAuthConfig, register, acceptPrivacy, updatePassword,changePassword } from "../controllers/auth-controller.js";
import { listColleges,completeRegistration } from '../controllers/portal-controller.js';
import { authenticateUser,activateUserSession } from '../middleware/authenticate-user.js';
import { rateLimit } from "../middleware/rate-limit.js";
import {env} from '../config/env.js';
import {registrationGate} from '../middleware/revision-mode.js';

const router = Router();
router.get("/config", getPublicAuthConfig);
router.post('/activate-session',rateLimit({max:60,bucket:'login-activation'}),activateUserSession,(_req,res)=>res.set('Cache-Control','no-store').json({active:true}));
router.get('/session',authenticateUser,rateLimit({max:10,bucket:'session-heartbeat',key:req=>req.authUser.id}),(req,res)=>res.set('Cache-Control','no-store').json({active:true,...(req.operationalAccess?{accessVersion:req.operationalAccess.version}:{})}));
router.get('/colleges', rateLimit({max:60,bucket:'public-colleges'}), listColleges);
router.post('/register',registrationGate(env.ACCESS_MODE), rateLimit({max:8,windowMs:15*60_000,bucket:'register'}), register);
router.patch('/registration',registrationGate(env.ACCESS_MODE),authenticateUser,rateLimit({max:10,bucket:'registration-update',key:req=>req.authUser.id}),completeRegistration);
router.post("/privacy-consent",authenticateUser,rateLimit({max:10,bucket:"privacy-consent",key:req=>req.authUser.id}),acceptPrivacy);
router.post("/password",authenticateUser,rateLimit({max:5,bucket:"password-update",key:req=>req.authUser.id}),updatePassword);
router.post('/change-password',authenticateUser,rateLimit({max:5,windowMs:15*60_000,bucket:'change-password',key:req=>req.authUser.id}),changePassword);
router.get("/me", rateLimit({ max: 120 }), getCurrentUser);

export default router;
