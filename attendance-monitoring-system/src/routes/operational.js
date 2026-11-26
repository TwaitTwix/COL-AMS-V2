import {Router} from 'express';
import {z} from 'zod';
import {env} from '../config/env.js';
import {supabase} from '../config/supabase.js';
import {authenticateUser} from '../middleware/authenticate-user.js';
import {rateLimit} from '../middleware/rate-limit.js';
import {PRIVACY_VERSION} from '../config/privacy.js';
import {validate} from '../utils/validate.js';
import {accessError,requireOperationalFeature,OPERATIONAL_ROLES} from '../services/operational-access-service.js';
import {saveOperationalAccount,provisionOperationalAccount,generateOperationalInvitation} from '../services/operational-account-service.js';
import {operationalAccountSchema,operationalInviteSchema,operationalSearchSchema} from '../validators/operational-access-validator.js';
import {createClassRosterRouter} from './class-rosters.js';
import {createOperationalEventRouter} from './operational-events.js';
import {createParticipantDeviceRouter} from './participant-devices.js';
import {createAttendanceReviewRouter} from './attendance-reviews.js';
import {createOperationalReportRouter} from './operational-reports.js';
import {createAccountAuditRouter} from './account-audit.js';

export function createOperationalRouter({client=supabase,authenticate=authenticateUser,mode=env.ACCESS_MODE,publicAppUrl=env.PUBLIC_APP_URL,privacyVersion=PRIVACY_VERSION,parseWorkbook}={}){
  const router=Router();
  router.use((req,res,next)=>{res.set('Cache-Control','no-store');return mode==='revision'?next():res.status(404).json({error:{message:'Not found',details:[]}});});
  router.use(rateLimit({max:180,bucket:'operational-ip'}),authenticate,rateLimit({max:120,bucket:'operational-user',key:req=>req.authUser.id}));
  router.use((req,_res,next)=>req.userProfile.privacy_version===privacyVersion?next():next(Object.assign(new Error('Accept the privacy notice before continuing'),{status:403})));
  const call=async(name,args)=>{const {data,error}=await client.rpc(name,args);if(error)throw accessError(error);return data;};
  const handle=action=>async(req,res,next)=>{try{await action(req,res);}catch(error){next(error);}};
  router.param('userId',(req,_res,next,id)=>{try{validate(z.uuid(),id);next();}catch(e){next(e);}});
  router.get('/me',handle(async(req,res)=>res.json({access:req.operationalAccess,roles:OPERATIONAL_ROLES})));
  router.get('/events',requireOperationalFeature('events.view'),handle(async(req,res)=>res.json({events:await call('list_operational_events',{p_actor:req.authUser.id})})));
  router.get('/accounts',requireOperationalFeature('accounts.manage'),handle(async(req,res)=>{
    const query=validate(operationalSearchSchema,req.query);
    res.json(await call('list_operational_accounts',{p_actor:req.authUser.id,p_search:query.search,p_page:query.page}));
  }));
  router.get('/account-candidates',requireOperationalFeature('accounts.manage'),handle(async(req,res)=>{
    const {search}=validate(z.object({search:z.string().trim().min(2).max(100)}).strict(),req.query);
    res.json({items:await call('operational_account_candidates',{p_actor:req.authUser.id,p_search:search})});
  }));
  router.put('/accounts/:userId',requireOperationalFeature('accounts.manage'),handle(async(req,res)=>{
    const input=validate(operationalAccountSchema,req.body);
    res.json({account:await saveOperationalAccount(client,req.authUser.id,req.params.userId,input)});
  }));
  router.post('/accounts/provision',requireOperationalFeature('accounts.manage'),rateLimit({max:10,windowMs:15*60_000,bucket:'account-provision',key:req=>req.authUser.id}),handle(async(req,res)=>{
    const input=validate(operationalInviteSchema,req.body);
    res.status(201).json(await provisionOperationalAccount(client,req.authUser.id,input));
  }));
  router.post('/accounts/:userId/invitation',requireOperationalFeature('accounts.manage'),rateLimit({max:10,windowMs:15*60_000,bucket:'invitation-link',key:req=>req.authUser.id}),handle(async(req,res)=>{
    validate(z.object({confirm:z.literal(true)}).strict(),req.body);
    await call('authorize_operational_invitation',{p_actor:req.authUser.id,p_user:req.params.userId});
    res.json(await generateOperationalInvitation(client,req.params.userId,publicAppUrl));
  }));
  router.use(createClassRosterRouter({client,parseWorkbook}));
  router.use(createOperationalEventRouter({client,appUrl:publicAppUrl}));
  router.use(createParticipantDeviceRouter({client}));
  router.use(createAttendanceReviewRouter({client}));
  router.use(createAccountAuditRouter({client}));
  router.use(createOperationalReportRouter({client,bucket:env.ATTENDANCE_REPORTS_BUCKET}));
  return router;
}
export default createOperationalRouter();
