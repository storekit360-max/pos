'use strict';
// One-time provisioning: ADMIN_EMAIL=... ADMIN_PASSWORD=... node admin/create-admin.js
const crypto = require('node:crypto');
const { Pool } = require('pg');
const email = String(process.env.ADMIN_EMAIL || '').trim().toLowerCase();
const password = String(process.env.ADMIN_PASSWORD || '');
if (!email || password.length < 14) { console.error('Set ADMIN_EMAIL and a unique ADMIN_PASSWORD of at least 14 characters.'); process.exit(2); }
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.PGSSL === 'disable' ? false : { rejectUnauthorized: true } });
const salt = crypto.randomBytes(16).toString('hex');
crypto.scrypt(password, salt, 64, async (err, key) => {
  if (err) { console.error('Password hashing failed'); process.exitCode = 1; await pool.end(); return; }
  try { await pool.query('INSERT INTO super_admins(email,password_hash) VALUES($1,$2)', [email, `${salt}$${key.toString('hex')}`]); console.log(`Created Super Admin ${email}`); }
  catch (e) { console.error(`Could not create Super Admin: ${e.message}`); process.exitCode=1; }
  await pool.end();
});
