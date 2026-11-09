'use strict';
const { db } = require('./_db');
const { json, authorized } = require('./_http');
const { ensureMain, tenantId, license } = require('./_tenant');
module.exports = async (req,res) => {
  const s = authorized(req,res); if (!s) return;
  try {
    const database = await db(); await ensureMain(database);
    const tid = tenantId(s), users = database.collection('users');
    const entitlement = await license(database,tid);
    if (['suspended','cancelled','deleted'].includes(entitlement.state)) return json(res,403,{error:'This shop account is suspended. Contact support.',code:'TENANT_SUSPENDED'});
    const user = await users.findOne({id:s.userId,tenantId:tid,active:true}); if (!user || (s.sessionVersion||0)!==(user.sessionVersion||0)) return json(res,401,{error:'Please sign in again'});
    await database.collection('tenants').updateOne({_id:tid},{$set:{lastActiveAt:new Date()}});
    const state = database.collection('pos_state');
    if (req.method === 'GET') {
      const doc = await state.findOne({_id:tid});
      if (!doc) return json(res,404,{error:'Shop data is not initialized'});
      if (req.query?.meta === '1') return json(res,200,{revision:doc.revision||0,updatedAt:doc.updatedAt||null});
      const data = doc.data; data.users = await users.find({tenantId:tid}, {projection:{_id:0,hash:0,tenantId:0}}).toArray();
      return json(res,200,{data,revision:doc.revision || 0});
    }
    if (req.method === 'PUT') {
      if (entitlement.state === 'expired') return json(res,402,{error:'Subscription expired. Data is available read-only until renewed.',code:'LICENSE_EXPIRED'});
      const {data,baseRevision,clientMutationId} = req.body || {};
      if (!data || typeof data !== 'object' || Buffer.byteLength(JSON.stringify(data)) > 4_000_000 || !Number.isInteger(baseRevision) || typeof clientMutationId !== 'string' || clientMutationId.length > 100) return json(res,400,{error:'Invalid or oversized POS data'});
      const clean = JSON.parse(JSON.stringify(data)); delete clean.users;
      let result = await state.findOneAndUpdate({_id:tid,revision:baseRevision,lastMutationId:{$ne:clientMutationId}},{$set:{data:clean,updatedAt:new Date(),lastMutationId:clientMutationId},$inc:{revision:1}},{returnDocument:'after',includeResultMetadata:false});
      if (!result) {
        const current=await state.findOne({_id:tid},{projection:{revision:1,lastMutationId:1}});
        if (current?.lastMutationId===clientMutationId) return json(res,200,{revision:current.revision,duplicate:true});
      }
      if (!result) return json(res,409,{error:'Cloud data changed elsewhere; refresh before saving',conflict:true});
      return json(res,200,{revision:result.revision});
    }
    return json(res,405,{error:'Method not allowed'});
  } catch(e) { console.error('POS data failure:',e.message); return json(res,500,{error:'Could not sync POS data'}); }
};
