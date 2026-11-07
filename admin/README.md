# Private Smart POS administration service

This service is a separate control plane. It is not part of the customer POS UI and is not copied into the current Vercel build (`vercel.json` publishes only `renderer/` into `public/`). Run it on a private backend host with a managed PostgreSQL database and HTTPS reverse proxy. Keep it off the customer POS hostname.

## First deployment

1. Provision PostgreSQL (PostgreSQL 13 or newer) and set `DATABASE_URL` to a private TLS connection string.
2. Apply the idempotent schema: `psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f admin/schema.sql`.
3. From `admin/`, run `npm ci` to install the service's isolated dependencies.
4. Provision the first owner account through a secure shell: set `ADMIN_EMAIL` and a unique `ADMIN_PASSWORD` of at least 14 characters, then run `npm run create-admin` from `admin/`. The process hashes the password with scrypt and does not persist the supplied environment values.
5. Run `npm start` from `admin/` behind a TLS reverse proxy. Set `PORT` as needed. The browser session cookie is Secure, HttpOnly, SameSite=Strict, and expires after eight hours.
6. Back up the database and restrict database/network access to the service. Do not enable public registration.

The browser and API are same-origin by design. No CORS allowlist is enabled. The service assumes TLS termination in front of it; do not expose it directly over plain HTTP because secure cookies will not work and credentials must not travel without TLS.

## Implemented foundation

- Owner-only sign-in, database-backed sessions, logout, scrypt password hashes, login throttling, CSRF token checks on mutations, security headers, and authentication audit events.
- PostgreSQL tables for customers, plans, subscriptions, hashed license secrets, device activations, payments, sessions, admins, and append-only-by-application audit records.
- Database-backed dashboard counts and activity, list views for the core records, and create/update operations for customers and plans.
- Bulk license secret generation stores SHA-256 digests and returns plaintext keys once in the privileged response.

This is an initial private service, not a complete production commercial system. In particular, subscription/payment workflows, role provisioning beyond the initial owner, data export/invoices/notifications, MFA, automated expiry jobs, and signed POS entitlement issuance/validation still require implementation and operational review. Dashboard charts and revenue analytics are not included. The current Electron license verifier remains local and existing installations are grandfathered; this foundation does not yet centrally enforce subscriptions or revoke devices.

## POS compatibility and migration

The existing POS continues to use its local `data.json` and license profile. The private admin database is separate and never imports or alters customer shop data. Do not turn on a server-required license gate until the POS has a signed entitlement protocol, device enrollment, an explicit offline grace policy, packaged-app testing, and a migration plan for existing installs. Existing local activations must remain valid during that rollout. The customer browser POS remains outside the admin API.

## Required environment

- `DATABASE_URL`: PostgreSQL connection string; use TLS.
- `PORT`: optional, defaults to `8787`.
- `PGSSL=disable`: local development only; omit in deployment.

No admin credential, database password, or license signing private key belongs in `admin/`, `renderer/`, or any customer-visible deployment artifact.
