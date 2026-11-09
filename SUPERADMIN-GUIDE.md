# Super admin operations

The private control panel is served from `/superadmin/` on the POS domain. It uses an identity store separate from shop accounts and does not provide tenant impersonation. The old live shop is bootstrapped lazily as tenant `main`; its existing data and desktop licenses stay in place.

## Before deployment

Take a MongoDB Atlas snapshot before deploying the first multi-tenant release. Deploy the code and static panel together. The Vercel build copies `superadmin/` to `public/superadmin/`; `scripts/build-ui-manifest.js` only hashes `renderer/`, so the panel does not alter the desktop UI bundle. Keep `npm install --omit=dev` and the existing package version.

Set these Vercel environment variables in Production and redeploy:

| Variable | Purpose | Generate / value |
|---|---|---|
| `MONGODB_URI` | Atlas connection | Copy the complete `mongodb+srv://` URI from Atlas; URL encode special characters in credentials |
| `MONGODB_DB` | Database name (optional) | `the_smart_pos` |
| `POS_SESSION_SECRET` | Shop cookie signing | `openssl rand -base64 48` (at least 32 characters) |
| `SUPERADMIN_SESSION_SECRET` | Independent super admin encryption/session key | `openssl rand -base64 64` (at least 48 characters) |
| `SUPERADMIN_ALLOWED_IPS` | Optional network allowlist | Comma-separated exact client IP addresses |
| `CRON_SECRET` | Optional paid-plan housekeeping endpoint | `openssl rand -base64 48` |
| `DESKTOP_LICENSE_PRIVATE_KEY` | Ed25519 private key used to sign offline desktop licenses | Generate with the commands below; store the full PEM value only in Vercel. |

Never use the same value for both session secrets. `SUPERADMIN_ALLOWED_IPS` is not enforced by this release's function handler; protect access with Vercel deployment/network controls until an edge allowlist is configured. Do not commit any `.env` file.

## Create the first root account

Run locally from a trusted machine with network access to Atlas:

```sh
MONGODB_URI='mongodb+srv://…' SA_EMAIL='owner@example.com' SA_PASSWORD='at-least-14-characters' node scripts/create-superadmin.js
```

The CLI stores a scrypt password hash and prints only a success message. Open `/superadmin/`, sign in, add the displayed TOTP secret to an authenticator, and confirm the current code. Save the one-time recovery codes securely. MFA is required before normal panel routes are available.

## Daily operations

- Review the dashboard for tenant state, revenue, staff count, storage use and recent audit activity.
- Create a tenant from Tenants. The panel displays a generated owner password once; deliver it using a trusted channel.
- Tenant detail shows staff and data usage. Use license controls to adjust expiry, and suspend or reactivate with a recorded reason.
- Record manual payments under Payments. A requested extension advances the tenant expiry and reactivates it.
- Announcements can target all shops or selected tenant IDs and include start/end times.
- Export tenant data before a soft delete. Deleted tenants have a 30-day restore window. Restore requires a typed tenant name and creates a pre-restore snapshot.
- Before any restore, confirm an Atlas snapshot exists. Application snapshots are stored in `tenant_backups`; they are not a substitute for Atlas backups.

## Secret rotation and recovery

Changing `POS_SESSION_SECRET` invalidates shop sessions. Changing `SUPERADMIN_SESSION_SECRET` invalidates super admin cookie sessions and makes encrypted TOTP values unreadable, so schedule it with MFA re-enrollment. The recovery script clears MFA for one active account, invalidates its active sessions, and forces enrollment at the next login:

```sh
MONGODB_URI='mongodb+srv://…' SA_EMAIL='owner@example.com' node scripts/reset-superadmin-mfa.js
```

The script requires typing `RESET-MFA` interactively. Run it only on a trusted machine with database access.

## Future desktop entitlement protocol

The superadmin **Desktop licenses** page issues signed 7-day, 30-day, and permanent licenses. Before enabling it in production, generate one Ed25519 pair on a trusted machine:

```sh
openssl genpkey -algorithm Ed25519 -out desktop-license-private.pem
openssl pkey -in desktop-license-private.pem -pubout -out desktop-license-public.pem
```

Set the complete private PEM as Vercel's `DESKTOP_LICENSE_PRIVATE_KEY`. Put the public PEM body (the single base64 line between its PEM headers) in `main.js` inside `desktopLicensePublicKey`, replacing the existing base64 body, then build and distribute a new desktop installer. The PEM files in the repository root are ignored by Git. Keep the private file out of the repository and rotate the pair only with a coordinated client release. The server stores only a key hash and displays each generated key once. Desktop activation verifies the signature locally, so an offline app can activate without contacting the server. Revocation prevents future activations; an already activated offline copy cannot receive revocation until it reconnects, and signed temporary licenses expire on that device. Legacy hard-coded licenses remain supported.

## Limitations to account for

This is not yet the complete feature set from the master prompt. The current panel/API still lacks device activation and device revocation flows, full tenant profile editing and feature-flag controls in the UI, plan edit/deactivation controls in the UI, payment void controls in the UI, audit search filters in the UI, and admin role/disable/MFA-reset controls in the UI. There is no payment gateway or email delivery. Atlas snapshots remain an operator responsibility. Complete these gaps and run tenant-isolation and staging end-to-end tests before enabling panel access for additional staff.

Desktop key generation returns `SIGNING_UNAVAILABLE` until `DESKTOP_LICENSE_PRIVATE_KEY` is configured in Vercel and the matching public key has been embedded in a new desktop build. A license revocation only reaches an already activated app if the client is online and polls a revocation service; this release intentionally supports offline activation and therefore cannot remotely disable an offline permanent license.
