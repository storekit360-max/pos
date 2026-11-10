'use strict';

// Permanently remove one tenant and its tenant-owned records. Superadmin
// accounts, sessions, settings, plans, and audit logs are intentionally kept.
// The script always exports a safety backup before applying any deletion.
const fs = require('node:fs');
const path = require('node:path');
const { MongoClient } = require('mongodb');

const args = process.argv.slice(2);
function arg(name) {
  const at = args.indexOf(name);
  return at < 0 ? '' : String(args[at + 1] || '');
}

async function main() {
  const uri = String(process.env.MONGODB_URI || process.env.MONGO_URI || process.env.MONGODB_URL || '').trim();
  const tenantId = arg('--tenant-id');
  const confirmName = arg('--confirm-name');
  const apply = args.includes('--apply');
  if (!uri) throw new Error('Set MONGODB_URI (or MONGO_URI / MONGODB_URL) in your environment.');
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(tenantId)) throw new Error('Pass a valid --tenant-id from the superadmin Tenants page.');
  if (tenantId === 'main' && !args.includes('--allow-main')) {
    throw new Error('The reserved main tenant is protected. Add --allow-main only if you intentionally want to remove it.');
  }

  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 8000 });
  try {
    await client.connect();
    const database = client.db(process.env.MONGODB_DB || 'the_smart_pos');
    const tenants = database.collection('tenants');
    const tenant = await tenants.findOne({ _id: tenantId });
    if (!tenant) throw new Error(`Tenant not found: ${tenantId}`);
    if (apply && confirmName !== tenant.name) {
      throw new Error('Confirmation does not match. Pass --confirm-name followed by the exact tenant name.');
    }

    const [users, state, backups, payments, licenseKeys] = await Promise.all([
      database.collection('users').find({ tenantId }).toArray(),
      database.collection('pos_state').findOne({ _id: tenantId }),
      database.collection('tenant_backups').find({ tenantId }).toArray(),
      database.collection('payments').find({ tenantId }).toArray(),
      database.collection('licenseKeys').find({ tenantId }).toArray()
    ]);
    const exportData = { exportedAt: new Date().toISOString(), tenant, users, data: state?.data || null, revision: state?.revision || 0, tenantBackups: backups, payments, licenseKeys };
    const backupDir = path.resolve(arg('--backup-dir') || path.join(process.cwd(), 'tenant-backups'));
    const safeId = tenantId.replace(/[^a-zA-Z0-9_-]/g, '_');
    const backupPath = path.join(backupDir, `tenant-${safeId}-${Date.now()}.json`);
    const counts = {
      users: users.length,
      posState: state ? 1 : 0,
      tenantBackups: backups.length,
      payments: payments.length,
      licenseKeys: licenseKeys.length,
      tenant: 1
    };
    console.log(`Tenant: ${tenant.name} (${tenantId})`);
    console.log(`Tenant-owned records: ${JSON.stringify(counts)}`);
    console.log(`Superadmin records are outside the deletion scope.`);
    if (!apply) {
      console.log('DRY RUN: no database records were changed.');
      console.log(`To apply, add --apply --confirm-name ${JSON.stringify(tenant.name)}${tenantId === 'main' ? ' --allow-main' : ''}`);
      console.log(`Backup will be written to: ${backupPath}`);
      return;
    }

    fs.mkdirSync(backupDir, { recursive: true });
    fs.writeFileSync(backupPath, `${JSON.stringify(exportData, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    // Recheck identity immediately before mutation to avoid deleting a changed
    // or replaced tenant after the operator reviewed the dry-run output.
    const stillThere = await tenants.findOne({ _id: tenantId, name: tenant.name });
    if (!stillThere) throw new Error('Tenant changed during confirmation. No database records were deleted.');

    await database.collection('users').deleteMany({ tenantId });
    await database.collection('pos_state').deleteOne({ _id: tenantId });
    await database.collection('tenant_backups').deleteMany({ tenantId });
    await database.collection('payments').deleteMany({ tenantId });
    await database.collection('licenseKeys').deleteMany({ tenantId });
    await tenants.deleteOne({ _id: tenantId, name: tenant.name });
    console.log(`Deleted tenant data. Safety backup: ${backupPath}`);
    console.log('Kept superadmins, superadmin sessions/settings, plans, announcements, and audit logs.');
  } finally {
    await client.close();
  }
}

main().catch(error => {
  console.error(`Tenant deletion stopped: ${error.message}`);
  process.exitCode = 1;
});
