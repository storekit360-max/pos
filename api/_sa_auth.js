'use strict';
const crypto = require('node:crypto');
const { verify } = require('./_password');
const COOKIE = 'smartpos_super';
const ROLES = { 'session.me':['root','billing','support','readonly'], 'session.enroll':['root','billing','support','readonly'], 'session.logout':['root','billing','support','readonly'], 'session.sessions':['root','billing','support','readonly'], 'session.password':['root','billing','support','readonly'], 'dashboard':['root','billing','support','readonly'], 'tenants.list':['root','billing','support','readonly'], 'tenants.get':['root','billing','support','readonly'], 'tenants.create':['root'], 'tenants.update':['root','billing'], 'tenants.delete':['root'], 'tenants.restore':['root'], 'staff.list':['root','support'], 'staff.reset':['root','support'], 'staff.update':['root','support'], 'staff.create':['root','support'], 'staff.delete':['root','support'], 'plans.list':['root','billing','readonly'], 'plans.save':['root','billing'], 'licenses.list':['root','billing','readonly'], 'licenses.generate':['root','billing'], 'licenses.redeem':['root','billing'], 'licenses.revoke':['root','billing'], 'licenses.revokeDesktop':['root','billing'], 'payments.list':['root','billing','readonly'], 'payments.csv':['root','billing','readonly'], 'payments.record':['root','billing'], 'payments.void':['root','billing'], 'announcements.list':['root','support','readonly'], 'announcements.save':['root'], 'audit.list':['root','readonly'], 'audit.csv':['root','readonly'], 'backups.export':['root','support'], 'backups.restore':['root'], 'releases':['root','billing','support','readonly'], 'health':['root','readonly'], 'settings.get':['root','billing','support','readonly'], 'settings.save':['root'], 'admins.list':['root'], 'admins.save':['root'], 'housekeeping':['root'] };
const secret = () => { const s=process.env.SUPERADMIN_SESSION_SECRET||''; if(Buffer.byteLength(s)<48) throw new Error('SUPERADMIN_SESSION_SECRET must contain at least 48 characters'); return s; };
const sha = x => crypto.createHash('sha256').update(x).digest('hex');
const safeEqual = (a,b) => { const x=Buffer.from(String(a||'')),y=Buffer.from(String(b||'')); return x.length===y.length && crypto.timingSafeEqual(x,y); };
function decode32(s) { const chars='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';let bits=0,v=0,out=[];for(const c of String(s||'')){const n=chars.indexOf(c.toUpperCase());if(n<0)continue;v=(v<<5)|n;bits+=5;if(bits>=8)out.push((v>>>(bits-=8))&255);}return Buffer.from(out); }
function totp(secretText, time=Date.now()) { const key=decode32(secretText), counter=Buffer.alloc(8); counter.writeBigUInt64BE(BigInt(Math.floor(time/30000))); const h=crypto.createHmac('sha1',key).update(counter).digest(), o=h[h.length-1]&15; return String((h.readUInt32BE(o)&0x7fffffff)%1000000).padStart(6,'0'); }
function b32(buf) { let bits=0,v=0,out=''; for(const byte of buf){v=(v<<8)|byte;bits+=8;while(bits>=5){out+='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'[(v>>>(bits-=5))&31];}} if(bits) out+='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'[(v<<(5-bits))&31]; return out; }
function encryptTotp(value) { const key=crypto.createHash('sha256').update(secret()).digest(), iv=crypto.randomBytes(12), c=crypto.createCipheriv('aes-256-gcm',key,iv); const data=Buffer.concat([c.update(value,'utf8'),c.final()]); return [iv.toString('base64url'),c.getAuthTag().toString('base64url'),data.toString('base64url')].join('.'); }
function decryptTotp(value) { const [i,t,d]=String(value).split('.'), c=crypto.createDecipheriv('aes-256-gcm',crypto.createHash('sha256').update(secret()).digest(),Buffer.from(i,'base64url')); c.setAuthTag(Buffer.from(t,'base64url')); return Buffer.concat([c.update(Buffer.from(d,'base64url')),c.final()]).toString(); }
function originOK(req) { try { const origin=new URL(req.headers.origin); return origin.protocol==='https:'&&origin.host===req.headers.host; } catch { return false; } }
function clientIp(req) { return String(req.headers['x-vercel-forwarded-for']||req.headers['x-real-ip']||req.headers['x-forwarded-for']||'').split(',')[0].trim().toLowerCase().replace(/^::ffff:/,'').slice(0,100); }
function ipv4ToInt(text) { const p=String(text).split('.'); if(p.length!==4)return null; let n=0; for(const x of p){ if(!/^\d{1,3}$/.test(x)||Number(x)>255)return null; n=n*256+Number(x); } return n; }
// Optional network allowlist. With SUPERADMIN_ALLOWED_IPS unset/empty (or "*") the panel is reachable from any
// device/network; access is still protected by password + MFA + CSRF + same-origin + rate limiting.
// When set, only the listed IPv4/IPv6 addresses or IPv4 CIDR ranges may connect.
function ipAllowed(req) {
  const entries=String(process.env.SUPERADMIN_ALLOWED_IPS||'').split(',').map(x=>x.trim().toLowerCase()).filter(Boolean);
  if(!entries.length||entries.includes('*'))return true;
  const ip=clientIp(req); if(!ip)return false;
  const n=ipv4ToInt(ip);
  return entries.some(entry=>{
    if(entry===ip)return true;
    const m=/^(\d{1,3}(?:\.\d{1,3}){3})\/([1-9]|[12]\d|3[0-2])$/.exec(entry); if(!m||n===null)return false;
    const base=ipv4ToInt(m[1]); if(base===null)return false;
    const mask=Number(m[2])===32?0xFFFFFFFF:((0xFFFFFFFF<<(32-Number(m[2])))>>>0);
    return ((n&mask)>>>0)===((base&mask)>>>0);
  });
}
const RATE_WINDOW_MS=10*60000;
const rateId=key=>sha('v2:'+key);
async function rateBlocked(database, key, max) { const doc=await database.collection('rate_limits').findOne({_id:rateId(key),expiresAt:{$gt:new Date()}}); return (doc?.count||0)>=max; }
async function rateFail(database, key) {
  const c=database.collection('rate_limits'), id=rateId(key);
  try { await c.deleteOne({_id:id,expiresAt:{$lte:new Date()}}); await c.updateOne({_id:id},{$inc:{count:1},$setOnInsert:{expiresAt:new Date(Date.now()+RATE_WINDOW_MS)}},{upsert:true}); }
  catch (error) { if(error?.code!==11000)throw error; }
}
async function rateClear(database, key) { await database.collection('rate_limits').deleteOne({_id:rateId(key)}); }
const DUMMY_HASH='0'.repeat(32)+'$'+'0'.repeat(128);
function setCookie(res, raw) { res.setHeader('Set-Cookie',`${COOKIE}=${raw}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=28800`); }
function clearCookie(res) { res.setHeader('Set-Cookie',`${COOKIE}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`); }
async function createSession(database, admin, req, res) { const raw=crypto.randomBytes(32).toString('base64url'), csrf=crypto.randomBytes(24).toString('base64url'), now=new Date(); await database.collection('superadmin_sessions').insertOne({tokenHash:sha(raw),adminId:admin.id,csrfHash:sha(csrf),csrfToken:csrf,createdAt:now,lastSeenAt:now,expiresAt:new Date(Date.now()+8*3600000),ip:clientIp(req)}); setCookie(res,raw); return csrf; }
async function authenticate(database, req, res, route) {
 const raw=(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith(COOKIE+'='))?.slice(COOKIE.length+1); if(!raw)return null;
 const now=new Date(), s=await database.collection('superadmin_sessions').findOne({tokenHash:sha(decodeURIComponent(raw)),expiresAt:{$gt:now},lastSeenAt:{$gt:new Date(Date.now()-2*3600000)}}); if(!s)return null;
 const full=await database.collection('superadmins').findOne({id:s.adminId,active:true}); if(!full)return null; const admin={id:full.id,email:full.email,role:full.role,active:full.active,mfaEnabled:!!full.mfaEnabled};
 const allowed=ROLES[route]||[]; if(!allowed.includes(admin.role)) return {error:'Insufficient permissions',code:'FORBIDDEN',status:403};
 if(!admin.mfaEnabled&&!['session.enroll','session.me','session.logout'].includes(route))return {error:'Complete MFA enrollment first',code:'MFA_REQUIRED',status:403};
 if(!['GET','HEAD'].includes(req.method)){ if(!originOK(req))return {error:'Same-origin request required',code:'CSRF',status:403}; const supplied=req.headers['x-csrf-token']; if(!safeEqual(sha(supplied),s.csrfHash))return {error:'CSRF token is missing or invalid',code:'CSRF',status:403}; }
 if(now-new Date(s.lastSeenAt)>60000)database.collection('superadmin_sessions').updateOne({_id:s._id},{$set:{lastSeenAt:now}}).catch(()=>{}); return {admin,session:s,csrf: null};
}
module.exports={ROLES,sha,safeEqual,totp,b32,encryptTotp,decryptTotp,rateBlocked,rateFail,rateClear,DUMMY_HASH,clientIp,createSession,authenticate,clearCookie,originOK,ipAllowed};
