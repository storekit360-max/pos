# Permanently delete one tenant

This script permanently deletes one shop (tenant) and its tenant-owned POS records from MongoDB. It does not delete superadmin accounts or sessions, superadmin settings, plans, announcements, or audit logs. A JSON safety export is written locally before any database deletion.

## Steps

1. Stop any deployment or process that could continue writing data for this tenant, and make sure you have the correct MongoDB connection string.
2. In the superadmin Tenants page, copy the tenant ID and exact tenant name. Do not use a name from memory.
3. Set `MONGODB_URI` (or `MONGO_URI` / `MONGODB_URL`) and optionally `MONGODB_DB` in your shell. For example, in macOS/Linux:

   ```sh
   export MONGODB_URI='mongodb+srv://USER:PASSWORD@YOUR-CLUSTER/'
   export MONGODB_DB='the_smart_pos'
   ```

   The database defaults to `the_smart_pos`. URL-encode special characters in the MongoDB password.
4. Preview the target and record counts. This command does not change the database:

   ```sh
   npm run tenant:delete -- --tenant-id TENANT_ID
   ```

5. Review the printed tenant ID and record counts. Apply only if they match the shop you intend to remove:

   ```sh
   npm run tenant:delete -- --tenant-id TENANT_ID --apply --confirm-name "Exact Tenant Name"
   ```

6. Keep the printed JSON backup path in a secure location. It contains shop data and staff password hashes. The script creates it with owner-only file permissions where supported.

The reserved `main` tenant is blocked unless you deliberately append `--allow-main` to both commands. Removing `main` can cause the application to recreate it on a later request. The script retains audit logs as an administrative record.

For a local desktop installation, this MongoDB script does not clear the desktop profile at `app.getPath('userData')/data.json`; that file is local POS data, separate from superadmin data and should be backed up and reset through the app's export/restore controls.
