'use strict';
const crypto = require('node:crypto');
const Billing = require('./_billing');

// The legacy-user/main-tenant repair below is idempotent, so it only needs to
// run once per server instance (re-checked every 5 minutes), not on every request.
let mainReady = null, mainReadyAt = 0, mainReadyDb = '';
function ensureMain(database) {
  const fresh = mainReady && mainReadyDb === database.databaseName && Date.now() - mainReadyAt < 300000;
  if (fresh) return mainReady;
  const attempt = ensureMainNow(database);
  mainReady = attempt; mainReadyAt = Date.now(); mainReadyDb = database.databaseName;
  attempt.catch(() => { if (mainReady === attempt) mainReady = null; });
  return attempt;
}

async function ensureMainNow(database) {
  const now = new Date();
  await database.collection('users').updateMany({ tenantId: { $exists: false } }, { $set: { tenantId: 'main' } });
  const staffCount = await database.collection('users').countDocuments({ tenantId: 'main', active: true });
  await database.collection('tenants').updateOne({ _id: 'main' }, { $setOnInsert: {
    name: 'The Smart POS', slug: 'main', status: 'active', planSnapshot: { name: 'Grandfathered', userLimit: 100000, features: [] },
    graceDays: 7, staffCount, flags: {}, createdAt: now, updatedAt: now
  } }, { upsert: true });
  await database.collection('tenants').updateOne({_id:'main',staffCount:{$exists:false}},{$set:{staffCount,updatedAt:now}});
}

function tenantId(session) { return typeof session?.tenantId === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(session.tenantId) ? session.tenantId : 'main'; }

function rootDomain(req) {
  const configured = String(process.env.POS_ROOT_DOMAIN || '').trim().toLowerCase().replace(/^https?:\/\//, '').split('/')[0].replace(/:\d+$/, '');
  if (configured) return configured;
  const host = String(req?.headers?.host || '').trim().toLowerCase().replace(/:\d+$/, '');
  // Production custom domains work without a separate env var. Never infer a
  // wildcard parent from Vercel's shared deployment domain or local hosts.
  if (!host || host === 'localhost' || host === '127.0.0.1' || host.endsWith('.vercel.app')) return '';
  return host;
}

function hostSlug(req) {
  const host = String(req.headers.host || '').trim().toLowerCase().replace(/:\d+$/, '');
  const root = rootDomain(req);
  if (!root || !host.endsWith(`.${root}`)) return null;
  const slug = host.slice(0, -(root.length + 1));
  return /^[a-z0-9][a-z0-9-]{1,48}$/.test(slug) && !slug.includes('.') ? slug : null;
}

async function tenantForRequest(database, req) {
  const slug = hostSlug(req);
  if (!slug) return database.collection('tenants').findOne({ _id: 'main' });
  return database.collection('tenants').findOne({ slug, status: { $nin: ['deleted'] } });
}

async function license(database, id) {
  await ensureMain(database);
  let tenant = await database.collection('tenants').findOne({ _id: id }, { projection: { name: 1, status: 1, expiresAt: 1, trialEndsAt: 1, graceDays: 1, planSnapshot: 1, billing: 1, createdAt: 1 } });
  if (!tenant) return { state: 'suspended', tenant: null, daysLeft: 0 };
  tenant = await Billing.ensure(database, tenant);
  const now = Date.now(), due = Billing.dueAt(tenant), until = due ? due.getTime() : null;
  let state = tenant.status || 'active', daysLeft = null;
  if (['cancelled', 'deleted', 'suspended'].includes(state)) return { state, tenant, daysLeft: 0 };
  if (until && until <= now) {
    const graceEnd = until + Number(tenant.graceDays || 0) * 86400000;
    state = graceEnd > now ? 'grace' : 'expired';
    daysLeft = state === 'grace' ? Math.max(0, Math.ceil((graceEnd - now) / 86400000)) : 0;
  } else if (until) {
    // Paid up again (for example the super admin extended the date): leave grace/expired automatically.
    if (state === 'grace' || state === 'expired') state = 'active';
    daysLeft = Math.max(0, Math.ceil((until - now) / 86400000));
  }
  if (state !== tenant.status) await database.collection('tenants').updateOne({ _id: id }, { $set: { status: state, updatedAt: new Date() } });
  return { state, tenant, daysLeft };
}

async function announcements(database, id) {
  const now = new Date();
  return database.collection('announcements').find({ active: true, startsAt: { $lte: now }, endsAt: { $gt: now }, $or: [{ tenantIds: 'all' }, { tenantIds: id }] }, { projection: { _id: 0, title: 1, body: 1, severity: 1, startsAt: 1, endsAt: 1 } }).limit(10).toArray();
}

module.exports = { ensureMain, tenantId, license, announcements, rootDomain, hostSlug, tenantForRequest };