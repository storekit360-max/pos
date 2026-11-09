'use strict';
const { db } = require('./_db');
const { json, authorized } = require('./_http');
module.exports = async (req,res) => {
  const s = authorized(req,res); if (!s) return;
  try {
    const database = await db(), users = database.collection('users');
    const user = await users.findOne({id:s.userId,active:true}); if (!user) return json(res,401,{error:'Please sign in again'});
    const state = database.collection('pos_state');
    if (req.method === 'GET') {
      const doc = await state.findOne({_id:'main'});
      if (!doc) return json(res,404,{error:'Shop data is not initialized'});
      if (req.query?.meta === '1') return json(res,200,{revision:doc.revision||0,updatedAt:doc.updatedAt||null});
      const data = doc.data; data.users = (await users.find({}, {projection:{_id:0,hash:0}}).toArray()).map(u=>({...u,hash:''}));
      return json(res,200,{data,revision:doc.revision || 0});
    }
    if (req.method === 'PUT') {
      const {data,baseRevision,clientMutationId} = req.body || {};
      if (!data || typeof data !== 'object' || Buffer.byteLength(JSON.stringify(data)) > 4_000_000 || !Number.isInteger(baseRevision) || typeof clientMutationId !== 'string' || clientMutationId.length > 100) return json(res,400,{error:'Invalid or oversized POS data'});
      const clean = JSON.parse(JSON.stringify(data)); delete clean.users;
      let result = await state.findOneAndUpdate({_id:'main',revision:baseRevision,lastMutationId:{$ne:clientMutationId}},{$set:{data:clean,updatedAt:new Date(),lastMutationId:clientMutationId},$inc:{revision:1}},{returnDocument:'after',includeResultMetadata:false});
      if (!result) {
        const current=await state.findOne({_id:'main'},{projection:{revision:1,lastMutationId:1}});
        if (current?.lastMutationId===clientMutationId) return json(res,200,{revision:current.revision,duplicate:true});
      }
      if (!result) return json(res,409,{error:'Cloud data changed elsewhere; refresh before saving',conflict:true});
      return json(res,200,{revision:result.revision});
    }
    return json(res,405,{error:'Method not allowed'});
  } catch(e) { console.error('POS data failure:',e.message); return json(res,500,{error:'Could not sync POS data'}); }
};
