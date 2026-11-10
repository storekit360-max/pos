'use strict';
const { db } = require('./_db');
const { json, authorized } = require('./_http');
const { ensureMain, tenantId, license, tenantForRequest } = require('./_tenant');
module.exports = async (req,res) => {
  const s = authorized(req,res); if (!s) return;
  try {
    const database = await db(); await ensureMain(database);
    const tid = tenantId(s), users = database.collection('users'), state = database.collection('pos_state');
    const isGet = req.method === 'GET', metaOnly = isGet && req.query?.meta === '1';
    // Independent reads run together instead of one after another. The 2-second
    // sync poll uses ?meta=1, which now reads only the revision, not the whole shop.
    const [hostTenant, user, entitlement, doc, userList] = await Promise.all([
      tenantForRequest(database,req),
      users.findOne({id:s.userId,tenantId:tid,active:true}),
      license(database,tid),
      isGet ? state.findOne({_id:tid}, metaOnly ? {projection:{revision:1,updatedAt:1}} : {}) : null,
      isGet && !metaOnly ? users.find({tenantId:tid}, {projection:{_id:0,hash:0,tenantId:0}}).toArray() : null
    ]);
    if (!hostTenant || hostTenant._id !== tid) return json(res,403,{error:'Session does not belong to this shop',code:'TENANT_HOST_MISMATCH'});
    if (['suspended','cancelled','deleted'].includes(entitlement.state)) return json(res,403,{error:'This shop account is suspended. Contact support.',code:'TENANT_SUSPENDED'});
    if (!user || (s.sessionVersion||0)!==(user.sessionVersion||0)) return json(res,401,{error:'Please sign in again'});
    // Unpaid subscription: the POS is disabled for reads and writes until the super admin activates the next cycle.
    if (entitlement.state === 'expired') return json(res,402,{error:'Subscription payment is due. Pay the outstanding amount to unlock this POS.',code:'PAYMENT_REQUIRED'});
    // lastActiveAt is informational; writing it on every poll was a database write every 2 seconds.
    const lastActive = hostTenant.lastActiveAt ? new Date(hostTenant.lastActiveAt).getTime() : 0;
    if (Date.now() - lastActive > 300000) await database.collection('tenants').updateOne({_id:tid},{$set:{lastActiveAt:new Date()}});
    if (isGet) {
      if (!doc) return json(res,404,{error:'Shop data is not initialized'});
      if (metaOnly) return json(res,200,{revision:doc.revision||0,updatedAt:doc.updatedAt||null});
      const data = doc.data; data.users = userList;
      return json(res,200,{data,revision:doc.revision || 0});
    }
    if (req.method === 'PUT') {
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