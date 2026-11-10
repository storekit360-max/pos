'use strict';

// Permanently remove all tenant shops, staff accounts, POS data, and tenant
// billing/license records. Superadmin accounts, sessions, plans, settings,
// and audit logs are intentionally preserved. Always export before deletion.
const fs = require('node:fs');
const path = require('node:path');
const { MongoClient } = require('mongodb');

const args = process.argv.slice(2);
const has = (name) => args.includes(name);
function arg(name) {
  const at = args.indexOf(name);
  return at < 0 ? '' : String(args[at + 1] || '');
}

async function main() {
  const uri = String(process.env.MONGODB_URI || process.env.MONGO_URI || process.env.MONGODB_URL || '').trim();
  if (!uri) throw new Error('Set MONGODB_URI (or MONGO_URI / MONGODB_URL) in your environment.');
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 8000 });
  try {
    await client.connect();
    const database = client.db(process.env.MONGODB_DB || 'the_smart_pos');
    const tenants = await database.collection('tenants').find({}).toArray();
    const ids = tenants.map((tenant) => tenant._id);
    const idSet = new Set(ids);
    const [users, states, backups, payments, licenseKeys] = await Promise.all([
      database.collection('users').find({ tenantId: { $in: ids } }).toArray(),
      database.collection('pos_state').find({ _id: { $in: ids } }).toArray(),
      database.collection('tenant_backups').find({ tenantId: { $in: ids } }).toArray(),
      database.collection('payments').find({ tenantId: { $in: ids } }).toArray(),
      database.collection('licenseKeys').find({ tenantId: { $in: ids } }).toArray()
    ]);
    // Also catch tenant users and orphan records when their tenant document is
    // missing, without ever selecting records lacking a tenantId.
    const [orphanUsers, orphanBackups, orphanPayments, orphanLicenses] = await Promise.all([
      database.collection('users').find({ tenantId: { $exists: true, $nin: [...idSet] } }).toArray(),
      database.collection('tenant_backups').find({ tenantId: { $exists: true, $nin: [...idSet] } }).toArray(),
      database.collection('payments').find({ tenantId: { $exists: true, $nin: [...idSet] } }).toArray(),
      database.collection('licenseKeys').find({ tenantId: { $exists: true, $nin: [...idSet] } }).toArray()
    ]);
    const allUsers = [...users, ...orphanUsers];
    const allBackups = [...backups, ...orphanBackups];
    const allPayments = [...payments, ...orphanPayments];
    const allLicenseKeys = [...licenseKeys, ...orphanLicenses];
    const exportData = {
      exportedAt: new Date().toISOString(), tenants, users: allUsers, posState: states,
      tenantBackups: allBackups, payments: allPayments, licenseKeys: allLicenseKeys
    };
    const backupDir = path.resolve(arg('--backup-dir') || path.join(process.cwd(), 'tenant-backups'));
    const backupPath = path.join(backupDir, `all-tenants-${Date.now()}.json`);
    const counts = {
      tenants: tenants.length, tenantUsers: allUsers.length, posState: states.length,
      tenantBackups: allBackups.length, payments: allPayments.length, licenseKeys: allLicenseKeys.length
    };
    console.log(`Tenant-owned records: ${JSON.stringify(counts)}`);
    console.log('Superadmin accounts and records are outside the deletion scope.');
    if (!has('--apply')) {
      console.log('DRY RUN: no database records were changed.');
      console.log('To apply, rerun with --apply --confirm-delete-all-tenants');
      console.log(`Backup will be written to: ${backupPath}`);
      return;
    }
    if (!has('--confirm-delete-all-tenants')) {
      throw new Error('Apply requires the exact flag --confirm-delete-all-tenants.');
    }
    if (!tenants.length && !allUsers.length && !states.length && !allBackups.length && !allPayments.length && !allLicenseKeys.length) {
      console.log('No tenant-owned records found; nothing to delete.');
      return;
    }
    fs.mkdirSync(backupDir, { recursive: true });
    fs.writeFileSync(backupPath, `${JSON.stringify(exportData, null, 2)}\n`, { flag: 'wx', mode: 0o600 });

    // Delete records linked to tenant IDs, plus tenantId-bearing orphan records.
    const linkedOrOrphan = (collection) => collection.deleteMany({ tenantId: { $exists: true } });
    await Promise.all([
      linkedOrOrphan(database.collection('users')),
      database.collection('pos_state').deleteMany({ _id: { $in: ids } }),
      linkedOrOrphan(database.collection('tenant_backups')),
      linkedOrOrphan(database.collection('payments')),
      linkedOrOrphan(database.collection('licenseKeys')),
      database.collection('tenants').deleteMany({})
    ]);
    console.log(`Deleted all tenant-owned records. Safety backup: ${backupPath}`);
    console.log('Kept superadmins, superadmin sessions/settings, plans, announcements, and audit logs.');
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error(`Tenant cleanup stopped: ${error.message}`);
  process.exitCode = 1;
});
