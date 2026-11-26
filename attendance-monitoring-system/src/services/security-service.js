import { createHmac, randomUUID, timingSafeEqual, createHash } from 'node:crypto';
import { env } from '../config/env.js';
import { supabase } from '../config/supabase.js';

function secret() {
  const value = env.DEVICE_SIGNING_SECRET || env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
  if (!value) throw Object.assign(new Error('Device verification is not configured'), { status: 503 });
  return value;
}
function sign(value) { return createHmac('sha256', secret()).update(value).digest('base64url'); }
function equal(a, b) {
  const left = Buffer.from(a || ''); const right = Buffer.from(b || '');
  return left.length === right.length && timingSafeEqual(left, right);
}
export function resolveDevice(req, res) {
  const raw = (req.headers.cookie || '').split(';').map(v => v.trim()).find(v => v.startsWith('col_device='))?.slice(11) || '';
  const [id, signature] = raw.split('.');
  const valid = /^[a-f0-9-]{36}$/i.test(id || '') && equal(signature, sign(id));
  const deviceId = valid ? id : randomUUID();
  if (!valid) res.append('Set-Cookie', `col_device=${deviceId}.${sign(deviceId)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=31536000${req.secure || process.env.VERCEL==='1' ? '; Secure' : ''}`);
  return createHash('sha256').update(deviceId).digest('hex');
}
export async function recordSession(req, res, accessToken) {
  const deviceHash = resolveDevice(req, res);
  let claims;
  try { claims = JSON.parse(Buffer.from(accessToken.split('.')[1], 'base64url').toString()); } catch { claims = {}; }
  if (!claims.session_id) throw Object.assign(new Error('Sign in again to verify this browser session'), { status: 401 });
  const { data, error } = await supabase.rpc('record_device_session', {
    p_user_id: req.authUser.id, p_session_id: claims.session_id, p_device_hash: deviceHash,
    p_user_agent: (req.get('user-agent') || 'Unknown browser').slice(0, 500),
    p_ip_address: req.ip || req.socket.remoteAddress || null,
  });
  if (error) { console.error('Device session verification failed:', error.message); throw Object.assign(new Error('Unable to verify device session'), { status: 503 }); }
  req.deviceHash = deviceHash;
  return data;
}
export function createEventQr(event, now = Date.now()) {
  const payload = Buffer.from(JSON.stringify({ event_id: event.id, version: event.qr_version, expires: now + 5 * 60_000 })).toString('base64url');
  return { token: `COL1.${payload}.${sign(`event:${payload}`)}`, expires_at: new Date(now + 5 * 60_000).toISOString() };
}
export async function recordOperationalSession(req,res,accessToken){
  const deviceHash=resolveDevice(req,res);
  // Token subject/session have already been verified by operational authentication.
  const claims=JSON.parse(Buffer.from(accessToken.split('.')[1],'base64url').toString());
  const {data,error}=await supabase.rpc('record_operational_login',{p_actor:req.authUser.id,p_session:claims.session_id,p_device:deviceHash,p_agent:(req.get('user-agent')||'Unknown browser').slice(0,500),p_ip:(req.ip||req.socket.remoteAddress||'').slice(0,100)});
  if(error)throw Object.assign(new Error('Unable to record your operational login. Please retry.'),{status:503});
  return data;
}
export function verifyEventQr(token, eventId, now = Date.now()) {
  const [prefix, payload, signature, extra] = token.split('.');
  if (prefix !== 'COL1' || extra || !payload || !equal(signature, sign(`event:${payload}`))) throw Object.assign(new Error('Invalid event QR code'), { status: 400 });
  let data;
  try { data = JSON.parse(Buffer.from(payload, 'base64url').toString()); } catch { throw Object.assign(new Error('Invalid event QR code'), { status: 400 }); }
  if (data.event_id !== eventId) throw Object.assign(new Error('This QR code belongs to a different event'), { status: 400 });
  if (!Number.isFinite(data.expires) || data.expires < now) throw Object.assign(new Error('Event QR code expired. Scan the current code displayed by the administrator.'), { status: 400 });
  return data;
}
