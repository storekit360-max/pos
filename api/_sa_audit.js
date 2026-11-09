'use strict';
async function audit(database, actor, req, action, entity, entityId, tenantId, summary, options = {}) {
  await database.collection('audit_logs').insertOne({
    ts: new Date(), actorId: actor?.id || 'system', actorEmail: actor?.email || 'system', role: actor?.role || 'system',
    action: String(action).slice(0,80), entity: String(entity).slice(0,80), entityId: String(entityId || '').slice(0,100),
    tenantId: tenantId || null, ip: String(req.headers['x-real-ip'] || req.headers['x-forwarded-for'] || '').split(',')[0].slice(0,80),
    userAgent: String(req.headers['user-agent'] || '').slice(0,240), summary: String(summary || '').slice(0,500)
  }, options.session ? {session:options.session} : {});
}
module.exports = { audit };
