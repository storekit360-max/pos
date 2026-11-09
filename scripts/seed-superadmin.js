'use strict';

const crypto = require('node:crypto');
const { MongoClient } = require('mongodb');
const { hash } = require('../api/_password');

async function main() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI || process.env.MONGODB_URL;
  const email = String(process.env.SUPERADMIN_EMAIL || '').trim().toLowerCase();
  const password = String(process.env.SUPERADMIN_PASSWORD || '');
  const role = String(process.env.SUPERADMIN_ROLE || 'root');
  if (!uri) throw new Error('Set MONGODB_URI (or MONGO_URI / MONGODB_URL).');
  if (!email.includes('@') || email.length > 254) throw new Error('Set a valid SUPERADMIN_EMAIL.');
  if (password.length < 14) throw new Error('SUPERADMIN_PASSWORD must be at least 14 characters.');
  if (!['root', 'billing', 'support', 'readonly'].includes(role)) throw new Error('SUPERADMIN_ROLE must be root, billing, support, or readonly.');

  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 8000 });
  try {
    await client.connect();
    const database = client.db(process.env.MONGODB_DB || 'the_smart_pos');
    const admins = database.collection('superadmins');
    await admins.createIndex({ email: 1 }, { unique: true });
    const duplicate = await admins.findOne({ email }, { projection: { _id: 1 } });
    if (duplicate) throw new Error('This email already has a superadmin account.');
    const existing = await admins.findOne({}, { projection: { _id: 1 } });
    if (existing) throw new Error('A superadmin already exists. Seed only an empty superadmin collection.');
    const now = new Date();
    const admin = { id: crypto.randomUUID(), email, role, active: true, passwordHash: await hash(password), totp: null, pendingTotp: null, mfaEnabled: false, createdAt: now };
    await admins.insertOne(admin);
    console.log(`Created initial ${role} superadmin: ${email}. MFA enrollment is required at first sign-in.`);
  } finally {
    await client.close();
  }
}

main().catch(error => {
  console.error(`Superadmin seed failed: ${error.message}`);
  process.exitCode = 1;
});
