'use strict';
const crypto = require('node:crypto');
const { db } = require('./_db');
const { json, session, setSession, clearSession, authorized } = require('./_http');
const { hash, verify } = require('./_password');
module.exports = async (req,res) => {
  res.setHeader('Cache-Control','no-store');
  if (['POST','PUT','DELETE'].includes(req.method) && req.headers.origin) { try { if (new URL(req.headers.origin).host !== req.headers.host) return json(res,403,{error:'Cross-origin request rejected'}); } catch { return json(res,403,{error:'Invalid request origin'}); } }
  try {
    const database = await db(), users = database.collection('users');
    if (req.method === 'POST' && !['setup','login'].includes(new URL(req.url,'https://pos.invalid').searchParams.get('mode')) && !authorized(req,res)) return;
    if (req.method === 'GET' && req.url.split('?')[0] === '/api/auth') {
      if (new URL(req.url,'https://pos.invalid').searchParams.get('mode') === 'status') {
        const initialized = await database.collection('pos_state').findOne({_id:'main'},{projection:{_id:1}});
        return json(res,200,{setupRequired:(await users.countDocuments())===0 && !initialized});
      }
      const s = session(req); if (!s) return json(res,200,{ authenticated:false });
      const user = await users.findOne({ id:s.userId, active:true },{projection:{_id:0,hash:0}});
      return json(res,200,{ authenticated:!!user, user:user || null });
    }
    if (req.method !== 'POST') return json(res,405,{error:'Method not allowed'});
    const mode = new URL(req.url,'https://pos.invalid').searchParams.get('mode');
    if (mode === 'setup') {
      if (!process.env.POS_SETUP_SECRET || req.headers['x-setup-secret'] !== process.env.POS_SETUP_SECRET) return json(res,403,{error:'Setup is not authorized'});
      if (await users.countDocuments() || await database.collection('pos_state').findOne({_id:'main'},{projection:{_id:1}})) return json(res,409,{error:'Live POS setup is already complete'});
      const { name, username, password, business, setupSecret } = req.body || {};
      if (setupSecret !== process.env.POS_SETUP_SECRET) return json(res,403,{error:'Setup is not authorized'});
      const un = String(username || '').trim().toLowerCase();
      if (!name || !/^[a-z0-9._-]{3,40}$/.test(un) || String(password || '').length < 10 || !business) return json(res,400,{error:'Enter a business name, valid username, and password of at least 10 characters'});
      const owner = {id:crypto.randomUUID(),name:String(name).trim(),username:un,role:'owner',active:true};
      const hashValue = await hash(String(password));
      try { await users.insertOne({ ...owner, hash:hashValue, createdAt:new Date() }); } catch (error) { if (error.code === 11000) return json(res,409,{error:'Live POS setup is already complete'}); throw error; }
      const d = { v:1, settings:{ business:String(business).trim() }, categories:['Smartphones','Feature Phones','Tablets','Chargers','Charging Cables','Power Banks','Earphones','Headphones','Bluetooth Speakers','Phone Cases','Screen Protectors','Memory Cards','USB Drives','Smartwatches','Phone Parts','Repair Accessories','Other Accessories'], brands:['Apple','Samsung','Xiaomi','Huawei','Oppo','Vivo','Realme','Anker','JBL','Generic'], expCats:['Rent','Electricity','Internet','Salaries','Transport','Repairs','Packaging','Bank Charges','Marketing','Miscellaneous'], products:[], suppliers:[], customers:[], sales:[], returns:[], purchases:[], expenses:[], payments:[], moves:[], held:[], shifts:[], attendance:[], audit:[], quotations:[], users:[{...owner,hash:''}], counters:{sale:0,pur:0,ret:0,bar:0,sku:0,quote:0} };
      const init = await database.collection('pos_state').updateOne({ _id:'main' },{$setOnInsert:{ data:d, revision:0, updatedAt:new Date() }},{upsert:true});
      if (!init.upsertedCount) { await users.deleteOne({id:owner.id}); return json(res,409,{error:'Live POS setup is already complete'}); }
      return json(res,201,{ok:true});
    }
    if (mode === 'login') {
      const { username, password } = req.body || {}, un = String(username || '').trim().toLowerCase();
      const user = await users.findOne({username:un,active:true});
      if (!user || !await verify(String(password || ''),user.hash)) return json(res,401,{error:'Invalid username or password'});
      setSession(res,user.id); return json(res,200,{ok:true,user:{id:user.id,name:user.name,username:user.username,role:user.role,active:true}});
    }
    if (mode === 'staff') {
      const s = session(req);
      if (!s) return json(res,401,{error:'Please sign in again'});
      const actor = await users.findOne({id:s.userId,active:true});
      if (!actor || actor.role !== 'owner') return json(res,403,{error:'Only an active owner can manage staff accounts'});
      const { action, id, name, username, password, role, active } = req.body || {};
      if (action === 'create') {
        const un = String(username || '').trim().toLowerCase();
        if (!String(name || '').trim() || !/^[a-z0-9._-]{3,40}$/.test(un) || String(password || '').length < 10 || !['owner','manager','cashier'].includes(role)) return json(res,400,{error:'Enter a name, valid username, role, and password of at least 10 characters'});
        if (await users.findOne({username:un})) return json(res,409,{error:'Username already exists'});
        const staff = {id:crypto.randomUUID(),name:String(name).trim(),username:un,role,active:true,hash:await hash(String(password)),createdAt:new Date()};
        try { await users.insertOne(staff); } catch (error) { if (error.code === 11000) return json(res,409,{error:'Username already exists'}); throw error; }
        return json(res,201,{user:{id:staff.id,name:staff.name,username:staff.username,role:staff.role,active:true}});
      }
      const target = await users.findOne({id});
      if (!target) return json(res,404,{error:'Staff account not found'});
      if (action === 'reset-password') {
        if (String(password || '').length < 10) return json(res,400,{error:'Password must be at least 10 characters'});
        await users.updateOne({id},{$set:{hash:await hash(String(password)),updatedAt:new Date()}});
        return json(res,200,{ok:true});
      }
      if (action === 'set-active') {
        if (typeof active !== 'boolean') return json(res,400,{error:'Invalid account status'});
        if (target.id === actor.id && !active) return json(res,409,{error:'You cannot disable your own account'});
        if (target.role === 'owner' && target.active && !active) {
          const owners=await users.find({role:'owner',active:true},{projection:{_id:0,id:1}}).toArray();
          if (owners.length < 2) return json(res,409,{error:'Keep at least one active owner'});
          const result=await users.updateOne({id,role:'owner',active:true},{$set:{active:false,updatedAt:new Date()}});
          if (!result.modifiedCount) return json(res,409,{error:'Keep at least one active owner'});
          return json(res,200,{ok:true});
        }
        await users.updateOne({id},{$set:{active,updatedAt:new Date()}});
        return json(res,200,{ok:true});
      }
      if (action === 'list') return json(res,200,{users:(await users.find({}, {projection:{_id:0,hash:0}}).toArray()).map(u=>({...u,hash:''}))});
      return json(res,400,{error:'Invalid staff action'});
    }
    if (mode === 'logout') { clearSession(res); return json(res,200,{ok:true}); }
    return json(res,400,{error:'Invalid authentication action'});
  } catch (e) { console.error('POS auth failure:',e.message); return json(res,500,{error:e.publicMessage || (e.message.includes('not configured') ? e.message : 'Authentication service is temporarily unavailable')}); }
};