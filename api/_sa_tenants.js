'use strict';
// Super admin: dashboard, tenant (shop) management and tenant staff management.
// Every list/summary here uses grouped queries so the number of database round trips does not grow with the
// number of shops (the previous version loaded each shop's full POS data one shop at a time, which was very slow).
const crypto=require('node:crypto');
const {hash}=require('./_password');
const {audit}=require('./_sa_audit');
const {registerTenantDomain}=require('./_vercel-domain');

const safeId=x=>typeof x==='string'&&/^[a-zA-Z0-9_-]{1,64}$/.test(x);
const tempPassword=()=>crypto.randomBytes(18).toString('base64url');
const STATUSES=['trial','active','grace','expired','suspended','cancelled','deleted'];
const SETTABLE=['trial','active','grace','expired','suspended','cancelled'];
const STAFF_ROLES=['owner','manager','cashier'];
const fail=(message,status=400,code='VALIDATION')=>Object.assign(new Error(message),{status,code});
const esc=s=>String(s).replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const asDate=(v,label)=>{const d=new Date(v);if(Number.isNaN(d.getTime()))throw fail(`Invalid ${label}`);return d;};

/* ---------- shared helpers ---------- */
// Size (bytes) and revision of each tenant's POS data, computed inside MongoDB (no documents are transferred).
async function dataStats(database,ids){
  const out=new Map();
  if(!ids.length)return out;
  try{
    const rows=await database.collection('pos_state').aggregate([{$match:{_id:{$in:ids}}},{$project:{bytes:{$bsonSize:'$data'},revision:1,updatedAt:1}}]).toArray();
    for(const r of rows)out.set(r._id,{bytes:r.bytes||0,revision:r.revision||0,updatedAt:r.updatedAt||null});
  }catch(e){console.error('dataStats failed:',e.message);}
  return out;
}
async function staffCounts(database,ids){
  const out=new Map();
  if(!ids.length)return out;
  const rows=await database.collection('users').aggregate([{$match:{tenantId:{$in:ids}}},{$group:{_id:'$tenantId',total:{$sum:1},active:{$sum:{$cond:['$active',1,0]}}}}]).toArray();
  for(const r of rows)out.set(r._id,{total:r.total,active:r.active});
  return out;
}
const decorate=(t,counts,stats)=>({...t,userCount:counts.get(t._id)?.total||0,activeStaff:counts.get(t._id)?.active||0,dataBytes:stats.get(t._id)?.bytes||0,revision:stats.get(t._id)?.revision||0,lastActiveAt:t.lastActiveAt||stats.get(t._id)?.updatedAt||null});

// Moves tenants to grace/expired. Runs at most once a minute per server instance instead of on every dashboard load.
let lastRefresh=0;
async function refreshStates(database,force=false){
  const nowMs=Date.now();
  if(!force&&nowMs-lastRefresh<60000)return;
  lastRefresh=nowMs;
  const now=new Date(nowMs),tenants=database.collection('tenants');
  await tenants.updateMany({status:{$in:['active','trial']},$or:[{expiresAt:{$lte:now}},{trialEndsAt:{$lte:now}}]},{$set:{status:'grace',updatedAt:now}});
  await tenants.updateMany({status:'grace',expiresAt:{$exists:true},$expr:{$lte:[{$add:[{$toLong:'$expiresAt'},{$multiply:[{$ifNull:['$graceDays',0]},86400000]}]},nowMs]}},{$set:{status:'expired',updatedAt:now}});
}

/* ---------- dashboard (one request, all queries in parallel) ---------- */
async function dashboard(database){
  await refreshStates(database);
  const now=new Date(),month=new Date(now.getFullYear(),now.getMonth(),1),in7=new Date(now.getTime()+7*86400000),in30=new Date(now.getTime()+30*86400000),in14=new Date(now.getTime()+14*86400000);
  const live={status:{$nin:['deleted','cancelled']}};
  const expiring=until=>({status:{$in:['active','trial','grace']},$or:[{expiresAt:{$gte:now,$lte:until}},{trialEndsAt:{$gte:now,$lte:until}}]});
  const tenants=database.collection('tenants');
  const [statusRows,newThisMonth,exp7,exp30,attention,recent,userRows,storage,audits]=await Promise.all([
    tenants.aggregate([{$group:{_id:'$status',n:{$sum:1}}}]).toArray(),
    tenants.countDocuments({...live,createdAt:{$gte:month}}),
    tenants.countDocuments(expiring(in7)),
    tenants.countDocuments(expiring(in30)),
    tenants.find({$or:[{status:{$in:['grace','expired','suspended']}},{status:{$in:['active','trial']},$or:[{expiresAt:{$lte:in14}},{trialEndsAt:{$lte:in14}}]}]},{projection:{name:1,slug:1,status:1,expiresAt:1,trialEndsAt:1,planSnapshot:1,staffCount:1,createdAt:1}}).limit(30).toArray(),
    tenants.find(live,{projection:{name:1,slug:1,status:1,expiresAt:1,trialEndsAt:1,planSnapshot:1,staffCount:1,createdAt:1}}).sort({createdAt:-1}).limit(5).toArray(),
    database.collection('users').aggregate([{$group:{_id:'$active',n:{$sum:1}}}]).toArray(),
    database.collection('pos_state').aggregate([{$group:{_id:null,bytes:{$sum:{$bsonSize:'$data'}}}}]).toArray().catch(()=>[]),
    database.collection('audit_logs').find({},{projection:{_id:0,ts:1,actorEmail:1,action:1,summary:1}}).sort({ts:-1}).limit(8).toArray()
  ]);
  const counts={};for(const s of STATUSES)counts[s]=0;for(const r of statusRows)counts[r._id]=r.n;
  const tenantCount=Object.entries(counts).filter(([k])=>!['deleted','cancelled'].includes(k)).reduce((n,[,v])=>n+v,0);
  const activeUsers=userRows.find(r=>r._id===true)?.n||0,totalUsers=userRows.reduce((n,r)=>n+r.n,0);
  return {counts,tenantCount,newTenantsThisMonth:newThisMonth,expiringIn7Days:exp7,expiringIn30Days:exp30,totalUsers,activeUsers,storageBytes:storage[0]?.bytes||0,attention,recent,recentAudit:audits};
}

/* ---------- tenants ---------- */
async function list(database,q={}){
  const page=Math.max(1,Number(q.page)||1),limit=Math.min(100,Math.max(1,Number(q.limit)||25)),filter={};
  if(q.state==='all'||!q.state)filter.status={$ne:'deleted'};
  else if(STATUSES.includes(q.state))filter.status=q.state;
  const term=String(q.search||'').trim().slice(0,80);
  if(term){const r={$regex:esc(term),$options:'i'};filter.$or=[{name:r},{slug:r},{'contact.email':r},{'contact.name':r}];}
  const sort=['name','createdAt','expiresAt','status'].includes(q.sort)?q.sort:'createdAt';
  const tenants=database.collection('tenants');
  const [docs,total]=await Promise.all([tenants.find(filter).sort({[sort]:q.order==='asc'?1:-1,_id:1}).skip((page-1)*limit).limit(limit).toArray(),tenants.countDocuments(filter)]);
  const ids=docs.map(t=>t._id),[counts,stats]=await Promise.all([staffCounts(database,ids),dataStats(database,ids)]);
  return {items:docs.map(t=>decorate(t,counts,stats)),page,limit,total};
}
async function get(database,id){
  if(!safeId(id))throw fail('Invalid tenant id');
  const tenant=await database.collection('tenants').findOne({_id:id});
  if(!tenant)throw fail('Tenant not found',404,'NOT_FOUND');
  const [counts,stats]=await Promise.all([staffCounts(database,[id]),dataStats(database,[id])]);
  const d=decorate(tenant,counts,stats);
  return {tenant,usage:{users:d.userCount,activeStaff:d.activeStaff,dataBytes:d.dataBytes,revision:d.revision,lastActiveAt:d.lastActiveAt}};
}
async function create(database,actor,req,body){
  const name=String(body.name||'').trim(),slug=String(body.slug||'').trim().toLowerCase(),business=name,username=String(body.username||'').trim().toLowerCase(),ownerName=String(body.ownerName||'').trim(),email=String(body.email||'').trim().toLowerCase();
  if(name.length<2||name.length>120||!/^[a-z0-9][a-z0-9-]{1,48}$/.test(slug)||!/^[a-z0-9._-]{3,40}$/.test(username)||ownerName.length<2||ownerName.length>80||!email.includes('@'))throw fail('Invalid tenant or owner details. Check the shop name, slug (letters, digits, dashes), owner name, username (3+ characters) and email.');
  const id=crypto.randomUUID(),password=tempPassword(),now=new Date(),limit=Math.max(1,Math.min(10000,Number(body.userLimit)||5)),duration=Math.max(1,Math.min(3650,Number(body.trialDays)||14));
  const owner={id:crypto.randomUUID(),tenantId:id,name:ownerName,username,role:'owner',active:true,hash:await hash(password),createdAt:now};
  const tenant={_id:id,name,slug,status:'trial',planId:String(body.planId||'standard'),planSnapshot:{name:String(body.planName||'Standard').slice(0,80),userLimit:limit,features:Array.isArray(body.features)?body.features.slice(0,50):[]},trialEndsAt:new Date(Date.now()+duration*86400000),graceDays:Math.max(0,Math.min(90,Number(body.graceDays)||7)),contact:{name:ownerName,email,phone:String(body.phone||'').slice(0,40),country:String(body.country||'LK').slice(0,80)},notes:'',flags:{},staffCount:1,createdAt:now,updatedAt:now,createdBy:actor.id};
  try{
    await database.collection('tenants').insertOne(tenant);
    await database.collection('users').insertOne(owner);
    await database.collection('pos_state').insertOne({_id:id,data:{v:1,settings:{business,phone:tenant.contact.phone,address:'',currency:'LKR'},categories:[],brands:[],expCats:[],products:[],suppliers:[],customers:[],sales:[],returns:[],purchases:[],expenses:[],payments:[],moves:[],held:[],shifts:[],attendance:[],audit:[],quotations:[],users:[],counters:{sale:0,pur:0,ret:0,bar:0,sku:0,quote:0}},revision:0,updatedAt:now});
  }catch(e){
    await Promise.allSettled([database.collection('tenants').deleteOne({_id:id}),database.collection('users').deleteOne({tenantId:id}),database.collection('pos_state').deleteOne({_id:id})]);
    if(e.code===11000)throw fail('Username or tenant slug already exists',409,'DUPLICATE');
    throw e;
  }
  let domainRegistration;
  try{domainRegistration=await registerTenantDomain(slug);}catch(e){
    console.error('Vercel domain registration failed:',e.message);
    domainRegistration={error:e.code==='VERCEL_DOMAIN_CONFIG'?e.message:'Tenant created, but Vercel did not confirm the hostname. Check Vercel project domain settings.'};
  }
  await audit(database,actor,req,'tenant.create','tenant',id,id,`${name} and owner account created`);
  return {tenant:{...tenant,userCount:1},owner:{id:owner.id,name:owner.name,username:owner.username,role:owner.role},temporaryPassword:password,domainRegistration};
}
async function update(database,actor,req,id,body){
  if(!safeId(id))throw fail('Invalid tenant id');
  const set={updatedAt:new Date()},allow=['name','notes','contact','flags','graceDays','expiresAt','trialEndsAt','planId','planSnapshot','status'];
  for(const k of allow)if(body[k]!==undefined)set[k]=body[k];
  if(set.status==='deleted')throw fail('Use the export-verified soft delete action',409,'DELETE_WORKFLOW_REQUIRED');
  if(set.status&&!SETTABLE.includes(set.status))throw fail('Invalid tenant status');
  if(set.name!==undefined&&(typeof set.name!=='string'||set.name.trim().length<2||set.name.length>120))throw fail('Invalid tenant name');
  if(set.name!==undefined)set.name=set.name.trim();
  if(set.notes!==undefined&&(typeof set.notes!=='string'||set.notes.length>4000))throw fail('Tenant notes are too long');
  for(const field of ['expiresAt','trialEndsAt'])if(set[field]!==undefined&&set[field]!==null&&set[field]!=='')set[field]=asDate(set[field],field);else if(set[field]==='')set[field]=null;
  if(set.contact!==undefined&&(!set.contact||typeof set.contact!=='object'||Array.isArray(set.contact)||Object.keys(set.contact).length>10||Object.values(set.contact).some(v=>typeof v!=='string'||v.length>200)))throw fail('Invalid contact details');
  if(set.flags!==undefined&&(!set.flags||typeof set.flags!=='object'||Array.isArray(set.flags)||Object.keys(set.flags).length>100||Object.values(set.flags).some(v=>typeof v!=='boolean')))throw fail('Invalid feature flags');
  if(set.planSnapshot!==undefined&&(!set.planSnapshot||typeof set.planSnapshot!=='object'||typeof set.planSnapshot.name!=='string'||set.planSnapshot.name.length>80||!Number.isInteger(Number(set.planSnapshot.userLimit))||Number(set.planSnapshot.userLimit)<1||Number(set.planSnapshot.userLimit)>10000||!Array.isArray(set.planSnapshot.features)||set.planSnapshot.features.length>100))throw fail('Invalid plan snapshot');
  // Simple plan edits from the panel: staff limit and plan name.
  if(body.userLimit!==undefined){const n=Number(body.userLimit);if(!Number.isInteger(n)||n<1||n>10000)throw fail('Staff limit must be a whole number from 1 to 10000');set['planSnapshot.userLimit']=n;}
  if(body.planName!==undefined){const n=String(body.planName).trim();if(!n||n.length>80)throw fail('Plan name is required (max 80 characters)');set['planSnapshot.name']=n;}
  if(set.planSnapshot!==undefined&&(set['planSnapshot.userLimit']!==undefined||set['planSnapshot.name']!==undefined))throw fail('Send either planSnapshot or userLimit/planName, not both');
  if(set.graceDays!==undefined)set.graceDays=Math.max(0,Math.min(90,Number(set.graceDays)||0));
  const result=await database.collection('tenants').updateOne({_id:id,status:{$ne:'deleted'}},{$set:set});
  if(!result.matchedCount)throw fail('Tenant not found',404,'NOT_FOUND');
  await audit(database,actor,req,'tenant.update','tenant',id,id,`Tenant updated${body.reason?`: ${String(body.reason).slice(0,250)}`:''}`);
  return {ok:true};
}

/* ---------- staff (the shop's own POS users) ---------- */
const publicUser={_id:0,hash:0,sessionVersion:0};
async function staffList(database,q={}){
  const page=Math.max(1,Number(q.page)||1),limit=Math.min(100,Math.max(1,Number(q.limit)||25)),filter={};
  const tenantId=String(q.tenantId||'');
  if(tenantId){if(!safeId(tenantId))throw fail('Invalid tenant id');filter.tenantId=tenantId;}
  if(STAFF_ROLES.includes(q.role))filter.role=q.role;
  if(q.status==='active')filter.active=true;else if(q.status==='disabled')filter.active=false;
  const term=String(q.search||'').trim().slice(0,80);
  if(term){const r={$regex:esc(term),$options:'i'};filter.$or=[{name:r},{username:r}];}
  const users=database.collection('users');
  const [rows,total]=await Promise.all([users.find(filter,{projection:publicUser}).sort({createdAt:-1,id:1}).skip((page-1)*limit).limit(limit).toArray(),users.countDocuments(filter)]);
  const ids=[...new Set(rows.map(u=>u.tenantId))],names=new Map();
  if(ids.length)for(const t of await database.collection('tenants').find({_id:{$in:ids}},{projection:{name:1}}).toArray())names.set(t._id,t.name);
  return {users:rows.map(u=>({...u,tenantName:names.get(u.tenantId)||u.tenantId})),page,limit,total};
}
async function loadTenant(database,tenantId){
  if(!safeId(tenantId))throw fail('Invalid tenant id');
  const tenant=await database.collection('tenants').findOne({_id:tenantId},{projection:{name:1,status:1,planSnapshot:1}});
  if(!tenant||tenant.status==='deleted')throw fail('Tenant not found',404,'NOT_FOUND');
  return tenant;
}
// Atomically reserve one active-staff slot; recounts once if the stored counter is missing or has drifted.
async function reserveSlot(database,tenant){
  const limit=Number(tenant.planSnapshot?.userLimit||5),tenants=database.collection('tenants');
  let r=await tenants.findOneAndUpdate({_id:tenant._id,staffCount:{$lt:limit}},{$inc:{staffCount:1}},{returnDocument:'after'});
  if(!r){
    const count=await database.collection('users').countDocuments({tenantId:tenant._id,active:true});
    await tenants.updateOne({_id:tenant._id},{$set:{staffCount:count}});
    r=await tenants.findOneAndUpdate({_id:tenant._id,staffCount:{$lt:limit}},{$inc:{staffCount:1}},{returnDocument:'after'});
  }
  if(!r)throw fail(`This shop has reached its staff limit (${limit}). Raise the limit on the tenant page first.`,409,'USER_LIMIT');
}
const releaseSlot=(database,tenantId)=>database.collection('tenants').updateOne({_id:tenantId},{$inc:{staffCount:-1}});
async function otherActiveOwners(database,tenantId,userId){return database.collection('users').countDocuments({tenantId,role:'owner',active:true,id:{$ne:userId}});}
const validUsername=u=>/^[a-z0-9._-]{3,40}$/.test(u);

async function staffCreate(database,actor,req,body){
  const tenant=await loadTenant(database,String(body.tenantId||'')),name=String(body.name||'').trim(),username=String(body.username||'').trim().toLowerCase(),role=String(body.role||''),password=String(body.password||tempPassword());
  if(name.length<2||name.length>80||!validUsername(username)||!STAFF_ROLES.includes(role)||password.length<10)throw fail('Enter a name, a username (3-40 letters, digits, . _ -), a role, and a password of at least 10 characters');
  if(await database.collection('users').findOne({tenantId:tenant._id,username},{projection:{_id:1}}))throw fail('Username already exists for this shop',409,'DUPLICATE');
  await reserveSlot(database,tenant);
  const user={id:crypto.randomUUID(),tenantId:tenant._id,name,username,role,active:true,hash:await hash(password),createdAt:new Date()};
  try{await database.collection('users').insertOne(user);}
  catch(e){await releaseSlot(database,tenant._id);if(e.code===11000)throw fail('Username already exists',409,'DUPLICATE');throw e;}
  await audit(database,actor,req,'staff.create','user',user.id,tenant._id,`Staff ${username} (${role}) created for ${tenant.name}`);
  return {user:{id:user.id,tenantId:tenant._id,name,username,role,active:true,createdAt:user.createdAt},temporaryPassword:password};
}
async function staffUpdate(database,actor,req,body){
  const tenantId=String(body.tenantId||''),userId=String(body.userId||''),users=database.collection('users');
  const tenant=await loadTenant(database,tenantId),old=await users.findOne({id:userId,tenantId});
  if(!old)throw fail('Staff account not found',404,'NOT_FOUND');
  const set={updatedAt:new Date()};let invalidate=body.signOut===true,slotChange=0;
  if(body.name!==undefined){const n=String(body.name).trim();if(n.length<2||n.length>80)throw fail('Name must be 2-80 characters');set.name=n;}
  if(body.username!==undefined){
    const u=String(body.username).trim().toLowerCase();if(!validUsername(u))throw fail('Username must be 3-40 letters, digits, . _ -');
    if(u!==old.username){if(await users.findOne({tenantId,username:u},{projection:{_id:1}}))throw fail('Username already exists for this shop',409,'DUPLICATE');set.username=u;invalidate=true;}
  }
  const newRole=body.role!==undefined?String(body.role):old.role,newActive=typeof body.active==='boolean'?body.active:old.active;
  if(!STAFF_ROLES.includes(newRole))throw fail('Invalid role');
  if(newRole!==old.role){set.role=newRole;invalidate=true;}
  if(newActive!==old.active){set.active=newActive;invalidate=true;slotChange=newActive?1:-1;}
  // Never leave a shop without an active owner.
  if(old.role==='owner'&&old.active&&(newRole!=='owner'||!newActive)&&await otherActiveOwners(database,tenantId,userId)<1)throw fail('Keep at least one active owner for this shop',409,'LAST_OWNER');
  if(slotChange===1)await reserveSlot(database,tenant);
  const update={$set:set};if(invalidate)update.$inc={sessionVersion:1};
  let r;try{r=await users.updateOne({id:userId,tenantId},update);}catch(e){if(slotChange===1)await releaseSlot(database,tenantId);if(e.code===11000)throw fail('Username already exists',409,'DUPLICATE');throw e;}
  if(!r.matchedCount){if(slotChange===1)await releaseSlot(database,tenantId);throw fail('Staff account not found',404,'NOT_FOUND');}
  if(slotChange===-1)await releaseSlot(database,tenantId);
  await audit(database,actor,req,'staff.update','user',userId,tenantId,`Staff ${set.username||old.username} updated${invalidate?'; sessions invalidated':''}`);
  return {ok:true};
}
async function staffDelete(database,actor,req,body){
  const tenantId=String(body.tenantId||''),userId=String(body.userId||''),users=database.collection('users');
  if(!safeId(tenantId))throw fail('Invalid tenant id');
  const old=await users.findOne({id:userId,tenantId});
  if(!old)throw fail('Staff account not found',404,'NOT_FOUND');
  if(old.role==='owner'&&old.active&&await otherActiveOwners(database,tenantId,userId)<1)throw fail('Keep at least one active owner for this shop',409,'LAST_OWNER');
  const r=await users.deleteOne({id:userId,tenantId});
  if(!r.deletedCount)throw fail('Staff account not found',404,'NOT_FOUND');
  if(old.active)await releaseSlot(database,tenantId);
  await audit(database,actor,req,'staff.delete','user',userId,tenantId,`Staff ${old.username} (${old.role}) deleted`);
  return {ok:true};
}
async function staffReset(database,actor,req,body){
  const tenantId=String(body.tenantId||''),userId=String(body.userId||''),password=String(body.password||tempPassword());
  if(!safeId(tenantId))throw fail('Invalid tenant id');
  if(password.length<10)throw fail('Password must be at least 10 characters');
  const r=await database.collection('users').updateOne({id:userId,tenantId},{$set:{hash:await hash(password),updatedAt:new Date()},$inc:{sessionVersion:1}});
  if(!r.matchedCount)throw fail('Staff account not found',404,'NOT_FOUND');
  await audit(database,actor,req,'staff.password.reset','user',userId,tenantId,'Staff password reset and sessions invalidated');
  return {temporaryPassword:password};
}
// Used by the backup/export route.
async function staff(database,id){
  if(!safeId(id))throw fail('Invalid tenant id');
  return database.collection('users').find({tenantId:id},{projection:{_id:0,hash:0,tenantId:0}}).sort({createdAt:1}).limit(500).toArray();
}
module.exports={dashboard,list,get,create,update,staff,staffList,staffCreate,staffUpdate,staffDelete,staffReset,refreshStates,safeId,tempPassword};
