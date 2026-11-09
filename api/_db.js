'use strict';

const URI_ENV_NAMES = ['MONGODB_URI', 'MONGO_URI', 'MONGODB_URL'];
const DEFAULT_DB_NAME = 'the_smart_pos';

let clientPromise = null;
let indexesPromise = null;

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
      maxPoolSize: 10
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
  if (!indexesPromise) {
    indexesPromise = (async () => {
      // Usernames are unique within a shop. Remove the former global constraint
      // so separate tenant subdomains can independently choose the same username.
      try { await database.collection('users').dropIndex('username_1'); } catch (cause) { if (cause.codeName !== 'IndexNotFound' && cause.code !== 27) throw cause; }
      await database.collection('users').createIndex({ tenantId: 1, username: 1 }, { unique: true });
      try { await database.collection('tenants').dropIndex('slug_1'); } catch (cause) { if (cause.codeName !== 'IndexNotFound' && cause.code !== 27) throw cause; }
      await database.collection('tenants').createIndex({ slug: 1 }, { unique: true, sparse: true });
      const optional = [
        ['users', { tenantId: 1, active: 1 }], ['users', { id: 1, tenantId: 1 }],
        ['superadmins', { email: 1 }, { unique: true }],
        ['superadmin_sessions', { tokenHash: 1 }, { unique: true }], ['superadmin_sessions', { expiresAt: 1 }, { expireAfterSeconds: 0 }],
        ['audit_logs', { ts: -1 }], ['rate_limits', { expiresAt: 1 }, { expireAfterSeconds: 0 }], ['users', { tenantId: 1, createdAt: -1 }], ['tenants', { status: 1, createdAt: -1 }], ['users', { id: 1 }], ['payments', { tenantId: 1, createdAt: -1 }], ['announcements', { active: 1, startsAt: 1, endsAt: 1 }],
        ['licenseKeys', { keyHash: 1 }, { unique: true }], ['tenant_backups', { tenantId: 1, createdAt: -1 }]
      ];
      await Promise.all(optional.map(async ([name, keys, options]) => {
        try { await database.collection(name).createIndex(keys, options || {}); }
        catch (cause) { console.error(`Optional ${name} index setup failed:`, cause.message); }
      }));
    })().catch((cause) => {
      indexesPromise = null;
      console.error('POS index setup failed:', cause.message);
      throw cause;
    });
  }
  await indexesPromise;
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
