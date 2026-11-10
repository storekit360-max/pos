'use strict';
const crypto=require('node:crypto');
const {audit}=require('./_sa_audit');
const Billing=require('./_billing');
async function recordPayment(database,actor,req,b){const id=String(b.tenantId||''),amount=Number(b.amount);if(!/^[a-zA-Z0-9_-]{1,64}$/.test(id)||!Number.isFinite(amount)||amount<=0||amount>1000000000)throw Object.assign(new Error('Invalid payment details'),{status:400,code:'VALIDATION'});const payment={_id:crypto.randomUUID(),tenantId:id,amount,currency:String(b.currency||'LKR').slice(0,8),method:['cash','bank transfer','card','other'].includes(String(b.method).toLowerCase())?String(b.method).toLowerCase():'other',reference:String(b.reference||'').slice(0,120),periodStart:b.periodStart?new Date(b.periodStart):null,periodEnd:b.periodEnd?new Date(b.periodEnd):null,recordedBy:actor.id,createdAt:new Date(),voidedAt:null};const session=database.client.startSession();try{await session.withTransaction(async()=>{const tenant=await database.collection('tenants').findOne({_id:id},{session});if(!tenant)throw Object.assign(new Error('Tenant not found'),{status:404,code:'NOT_FOUND'});await database.collection('payments').insertOne(payment,{session});if(b.extend===true){const current=tenant.expiresAt&&new Date(tenant.expiresAt)>new Date()?new Date(tenant.expiresAt):new Date(),days=Math.max(1,Math.min(3650,Number(b.extendDays)||30)),result=await database.collection('tenants').updateOne({_id:id},{$set:{expiresAt:new Date(current.getTime()+days*86400000),status:'active',updatedAt:new Date()}},{session});if(!result.matchedCount)throw new Error('Tenant extension failed');}await audit(database,actor,req,'payment.record','payment',payment._id,id,`Manual payment ${payment.currency} ${payment.amount}${b.extend===true?' and license extended':''}`,{session});});return payment;}finally{await session.endSession();}}
async function savePlan(database,actor,req,b){const name=String(b.name||'').trim(),id=String(b.id||crypto.randomUUID());if(name.length<2||name.length>80)throw Object.assign(new Error('Invalid plan name'),{status:400,code:'VALIDATION'});const plan={_id:id,name,durationDays:Math.max(1,Math.min(3650,Number(b.durationDays)||30)),price:Math.max(0,Number(b.price)||0),currency:String(b.currency||'LKR').slice(0,8),userLimit:Math.max(1,Math.min(10000,Number(b.userLimit)||5)),features:Array.isArray(b.features)?b.features.filter(x=>typeof x==='string').slice(0,50):[],graceDays:Math.max(0,Math.min(90,Number(b.graceDays)||7)),active:b.active!==false,updatedAt:new Date()};await database.collection('plans').updateOne({_id:id},{$set:plan,$setOnInsert:{createdAt:new Date()}},{upsert:true});await audit(database,actor,req,'plan.save','plan',id,null,`${name} plan saved`);return plan;}
const bad=(message,status=400,code='VALIDATION')=>Object.assign(new Error(message),{status,code});
const idOk=id=>typeof id==='string'&&/^[a-zA-Z0-9_-]{1,64}$/.test(id);
const TENANT_FIELDS={name:1,slug:1,status:1,createdAt:1,expiresAt:1,trialEndsAt:1,graceDays:1,billing:1,planSnapshot:1};
async function getSettings(database){const {_id,...rest}=await Billing.getSettings(database);return rest;}
async function saveSettings(database,actor,req,b){const settings=Billing.cleanSettings(b||{});await database.collection('superadmin_settings').updateOne({_id:Billing.SETTINGS_ID},{$set:settings},{upsert:true});await audit(database,actor,req,'billing.settings','settings',Billing.SETTINGS_ID,null,`Billing settings saved: ${settings.currency} ${settings.monthlyFee} per ${Billing.CYCLE_DAYS} days, bank ${settings.bankName||'not set'}`);return settings;}
async function list(database,q){
 const page=Math.max(1,Number(q.page)||1),limit=Math.min(100,Math.max(1,Number(q.limit)||25)),now=new Date(),soon=new Date(now.getTime()+7*Billing.DAY),and=[{status:{$ne:'deleted'}}];
 const search=String(q.search||'').trim().slice(0,80);
 if(search){const rx=new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'i');and.push({$or:[{name:rx},{slug:rx}]});}
 const due={$ifNull:['$expiresAt','$trialEndsAt']},filter=String(q.filter||'');
 if(filter==='overdue')and.push({'billing.exempt':{$ne:true}},{$or:[{status:{$in:['grace','expired']}},{$expr:{$lte:[due,now]}}]});
 else if(filter==='soon')and.push({'billing.exempt':{$ne:true}},{status:{$in:['active','trial']}},{$expr:{$and:[{$gt:[due,now]},{$lte:[due,soon]}]}});
 const query={$and:and},tenants=database.collection('tenants');
 const [rows,total,settings]=await Promise.all([tenants.find(query,{projection:TENANT_FIELDS}).sort({expiresAt:1,trialEndsAt:1,createdAt:1}).skip((page-1)*limit).limit(limit).toArray(),tenants.countDocuments(query),Billing.getSettings(database)]);
 const items=await Promise.all(rows.map(async t=>{const full=await Billing.ensure(database,t);return {_id:full._id,name:full.name,slug:full.slug,status:full.status,graceDays:full.graceDays??0,...Billing.summary(full,settings,now.getTime())};}));
 return {items,page,limit,total};
}
async function payments(database,q){
 const page=Math.max(1,Number(q.page)||1),limit=Math.min(100,Math.max(1,Number(q.limit)||15)),filter=q.tenantId&&idOk(q.tenantId)?{tenantId:q.tenantId}:{};
 const [items,total]=await Promise.all([database.collection('payments').find(filter).sort({createdAt:-1}).skip((page-1)*limit).limit(limit).toArray(),database.collection('payments').countDocuments(filter)]);
 const ids=[...new Set(items.map(p=>p.tenantId))],names=new Map((await database.collection('tenants').find({_id:{$in:ids}},{projection:{name:1}}).toArray()).map(t=>[t._id,t.name]));
 return {items:items.map(p=>({...p,tenantName:names.get(p.tenantId)||p.tenantId})),page,limit,total};
}
// Super admin confirms a bank payment: records it and activates the next 30-day cycle(s).
async function activate(database,actor,req,b){
 const id=String(b.tenantId||'');if(!idOk(id))throw bad('Invalid shop');
 const method=['cash','bank transfer','card','other'].includes(String(b.method||'').toLowerCase())?String(b.method).toLowerCase():'bank transfer',reference=String(b.reference||'').trim().slice(0,120),fromToday=b.from==='today';
 const first=await database.collection('tenants').findOne({_id:id},{projection:TENANT_FIELDS});if(!first)throw bad('Tenant not found',404,'NOT_FOUND');
 await Billing.ensure(database,first);
 const settings=await Billing.getSettings(database),session=database.client.startSession();
 try{let outcome;await session.withTransaction(async()=>{
  const tenant=await database.collection('tenants').findOne({_id:id},{projection:TENANT_FIELDS,session});
  if(!tenant)throw bad('Tenant not found',404,'NOT_FOUND');
  if(['deleted','cancelled'].includes(tenant.status))throw bad(`A ${tenant.status} shop cannot be activated. Restore it first.`,409,'CONFLICT');
  if(tenant.billing?.exempt)throw bad('This shop is exempt from billing. Turn the exemption off first.',409,'CONFLICT');
  const now=Date.now(),due=Billing.dueAt(tenant),overdue=Billing.overdueCycles(due,now),fee=Billing.feeFor(tenant,settings);
  const cycles=Math.floor(Number(b.cycles)||Math.max(1,overdue));
  if(cycles<1||cycles>24)throw bad('Cycles must be between 1 and 24');
  if(cycles<overdue)throw bad(`This shop is ${overdue} cycles overdue. Activate at least ${overdue} cycles so the POS unlocks.`,409,'CONFLICT');
  const amount=b.amount===undefined||b.amount===''||b.amount===null?fee*cycles:Number(b.amount);
  if(!Number.isFinite(amount)||amount<=0||amount>1000000000)throw bad('Enter the amount received');
  // Default keeps the billing day (creation date + N x 30 days). "today" counts 30 days from now instead.
  const base=fromToday?new Date(Math.max(now,due?due.getTime():0)):(due||new Date(now)),expiresAt=new Date(base.getTime()+cycles*Billing.CYCLE_DAYS*Billing.DAY);
  const payment={_id:crypto.randomUUID(),tenantId:id,kind:'subscription',amount,currency:settings.currency||'LKR',method,reference,cycles,periodStart:base,periodEnd:expiresAt,recordedBy:actor.id,createdAt:new Date(),voidedAt:null};
  await database.collection('payments').insertOne(payment,{session});
  const changed=await database.collection('tenants').updateOne({_id:id},{$set:{expiresAt,status:'active',updatedAt:new Date(),'billing.lastPaidAt':payment.createdAt,'billing.lastPaymentId':payment._id,'billing.lastPaymentAmount':amount}},{session});
  if(!changed.matchedCount)throw bad('Activation failed. Try again.',409,'CONFLICT');
  await audit(database,actor,req,'billing.activate','tenant',id,id,`Payment ${payment.currency} ${amount} received; POS activated for ${cycles*Billing.CYCLE_DAYS} days until ${expiresAt.toISOString().slice(0,10)}`,{session});
  outcome={ok:true,payment,expiresAt,status:'active'};
 });return outcome;}finally{await session.endSession();}
}
async function updateTenant(database,actor,req,b){
 const id=String(b.tenantId||'');if(!idOk(id))throw bad('Invalid shop');
 const tenant=await database.collection('tenants').findOne({_id:id},{projection:TENANT_FIELDS});if(!tenant)throw bad('Tenant not found',404,'NOT_FOUND');
 await Billing.ensure(database,tenant);
 const set={updatedAt:new Date()},unset={};
 if(b.monthlyFee===''||b.monthlyFee===null)unset['billing.monthlyFee']='';
 else if(b.monthlyFee!==undefined){const fee=Number(b.monthlyFee);if(!Number.isFinite(fee)||fee<=0||fee>100000000)throw bad('Monthly fee must be a positive number');set['billing.monthlyFee']=Math.round(fee*100)/100;}
 if(typeof b.exempt==='boolean')set['billing.exempt']=b.exempt;
 if(b.graceDays!==undefined)set.graceDays=Math.max(0,Math.min(90,Math.floor(Number(b.graceDays)||0)));
 const update={$set:set};if(Object.keys(unset).length)update.$unset=unset;
 await database.collection('tenants').updateOne({_id:id},update);
 await audit(database,actor,req,'billing.tenant','tenant',id,id,`Billing terms changed${typeof b.exempt==='boolean'?`; exempt=${b.exempt}`:''}`);
 return {ok:true};
}
module.exports={recordPayment,savePlan,getSettings,saveSettings,list,payments,activate,updateTenant};