'use strict';

const URI_ENV_NAMES = ['MONGODB_URI', 'MONGO_URI', 'MONGODB_URL'];
const DEFAULT_DB_NAME = 'the_smart_pos';

let clientPromise = null;
let indexesPromise = null;
let indexesDatabaseName = '';

function publicError(message, publicMessage, cause) {
  const error = new Error(message);
  error.publicMessage = publicMessage;
  if (cause) error.cause = cause;
  return error;
}

function readUri() {
  for (const name of URI_ENV_NAMES) {
    const raw = process.env[name];
    if (!raw) continue;
    const uri = raw.trim().replace(/^(['"])(.*)\1$/, '$2').trim();
    if (uri) return uri;
  }
  return '';
}

function loadDriver() {
  try {
    return require('mongodb');
  } catch (cause) {
    throw publicError(
      `MongoDB driver failed to load: ${cause.message}`,
      'MongoDB driver is not installed on the server. Remove "installCommand" from vercel.json (or set it to "npm install --omit=dev") and redeploy.',
      cause
    );
  }
}

function classifyConnectError(cause) {
  const text = `${cause?.name || ''} ${cause?.code || ''} ${cause?.message || ''}`;
  if (/MongoParseError|Invalid scheme|Invalid connection string|must be of the form|URI malformed/i.test(text)) {
    return 'MONGODB_URI is invalid. Copy the full mongodb+srv:// string from Atlas and URL-encode special characters in the password.';
  }
  if (/Authentication failed|AuthenticationFailed|bad auth|MongoServerError.*\b(18|8000)\b/i.test(text)) {
    return 'MongoDB rejected the username or password in MONGODB_URI.';
  }
  if (/ENOTFOUND|querySrv|EAI_AGAIN/i.test(text)) {
    return 'MongoDB cluster host in MONGODB_URI could not be resolved. Check the cluster address.';
  }
  if (/MongoServerSelectionError|ECONNREFUSED|ETIMEDOUT|timed out|SSL|TLS|ReplicaSetNoPrimary/i.test(text)) {
    return 'Cannot reach MongoDB. In Atlas open Network Access and allow 0.0.0.0/0 (Vercel uses dynamic IPs), and confirm the cluster is running.';
  }
  return 'MongoDB connection failed. Check the Vercel function logs for the exact error.';
}

function connect(uri) {
  const { MongoClient } = loadDriver();
  let client;
  try {
    client = new MongoClient(uri, {
      serverSelectionTimeoutMS: 8000,
      connectTimeoutMS: 8000,
      // Vercel may run many short lived instances at once. Keep each instance's
      // pool bounded so an instance burst cannot exhaust Atlas connections.
      maxPoolSize: Math.max(2, Math.min(20, Number(process.env.MONGODB_MAX_POOL_SIZE) || 5)),
      minPoolSize: 0,
      maxConnecting: 2,
      waitQueueTimeoutMS: 10000,
      socketTimeoutMS: 30000,
      retryWrites: true
    });
  } catch (cause) {
    return Promise.reject(publicError(`MongoDB client rejected URI: ${cause.message}`, classifyConnectError(cause), cause));
  }
  return client.connect().catch(async (cause) => {
    try { await client.close(); } catch (_) { /* connection never opened */ }
    throw publicError(`MongoDB connect failed: ${cause.message}`, classifyConnectError(cause), cause);
  });
}

async function ensureIndexes(database) {
  const databaseName = database.databaseName;
  if (indexesDatabaseName !== databaseName) {
    indexesPromise = null;
    indexesDatabaseName = databaseName;
  }
  if (!indexesPromise) {
    indexesPromise = (async () => {
      const users = database.collection('users'), tenants = database.collection('tenants');
      // One cheap listing per collection instead of a drop + create on every
      // cold start. The one-off migrations below only run when still needed.
      const listOf = async (collection) => { try { return await collection.indexes(); } catch (cause) { if (cause.codeName === 'NamespaceNotFound' || cause.code === 26) return []; throw cause; } };
      const [userIndexes, tenantIndexes] = await Promise.all([listOf(users), listOf(tenants)]);
      // Usernames are unique within a shop. Remove the former global constraint
      // so separate tenant subdomains can independently choose the same username.
      if (userIndexes.some((i) => i.name === 'username_1')) {
        try { await users.dropIndex('username_1'); } catch (cause) { if (cause.codeName !== 'IndexNotFound' && cause.code !== 27) throw cause; }
      }
      if (!userIndexes.some((i) => i.name === 'tenantId_1_username_1' && i.unique)) {
        await users.createIndex({ tenantId: 1, username: 1 }, { unique: true });
      }
      // The slug index must be unique AND sparse. Rebuild only if an older,
      // non-sparse version is still present.
      const slugIndex = tenantIndexes.find((i) => i.name === 'slug_1');
      if (slugIndex && !(slugIndex.unique && slugIndex.sparse)) {
        try { await tenants.dropIndex('slug_1'); } catch (cause) { if (cause.codeName !== 'IndexNotFound' && cause.code !== 27) throw cause; }
      }
      if (!slugIndex || !(slugIndex.unique && slugIndex.sparse)) {
        await tenants.createIndex({ slug: 1 }, { unique: true, sparse: true });
      }
    })().catch((cause) => {
      indexesPromise = null;
      console.error('POS index setup failed:', cause.message);
      throw cause;
    });
    // Performance-only indexes never block a request. They are created in the
    // background once per server instance; createIndex is a no-op if present.
    indexesPromise.then(() => ensureOptionalIndexes(database)).catch(() => {});
  }
  await indexesPromise;
}

let optionalIndexesStarted = '';
function ensureOptionalIndexes(database) {
  if (optionalIndexesStarted === database.databaseName) return;
  optionalIndexesStarted = database.databaseName;
  const optional = [
      ['pos_state', { updatedAt: -1 }],
      ['announcements', { tenantIds: 1, active: 1, startsAt: 1, endsAt: 1 }],
      ['users', { tenantId: 1, active: 1 }], ['users', { id: 1, tenantId: 1 }],
      ['superadmins', { email: 1 }, { unique: true }],
      ['superadmin_sessions', { tokenHash: 1 }, { unique: true }], ['superadmin_sessions', { expiresAt: 1 }, { expireAfterSeconds: 0 }],
      ['audit_logs', { ts: -1 }], ['rate_limits', { expiresAt: 1 }, { expireAfterSeconds: 0 }], ['users', { tenantId: 1, createdAt: -1 }], ['tenants', { status: 1, createdAt: -1 }], ['users', { id: 1 }], ['payments', { tenantId: 1, createdAt: -1 }], ['announcements', { active: 1, startsAt: 1, endsAt: 1 }],
      ['licenseKeys', { keyHash: 1 }, { unique: true }], ['tenant_backups', { tenantId: 1, createdAt: -1 }]
  ];
  return Promise.all(optional.map(async ([name, keys, options]) => {
    try { await database.collection(name).createIndex(keys, options || {}); }
    catch (cause) { console.error(`Optional ${name} index setup failed:`, cause.message); }
  }));
}

async function db() {
  const uri = readUri();
  if (!uri) {
    throw publicError(
      'MongoDB is not configured',
      'MongoDB is not configured: MONGODB_URI is missing for this Vercel environment. Add it under Settings > Environment Variables (Production) and redeploy.'
    );
  }
  if (!clientPromise) {
    const attempt = connect(uri);
    clientPromise = attempt;
    attempt.catch(() => { if (clientPromise === attempt) clientPromise = null; });
  }
  const client = await clientPromise;
  const database = client.db(process.env.MONGODB_DB || DEFAULT_DB_NAME);
  await ensureIndexes(database);
  return database;
}

module.exports = { db };