# The Smart POS — Mobile & Accessories Shop
**Developed by ZenStack360**

Offline POS, inventory, IMEI tracking, suppliers, purchases, customers, expenses, cash register, reports,
barcode labels, daily auto-backup. Works on **Windows and macOS**. No internet needed.

Shop: **The Smart**, Thissa Road, Ranna · 0761048027

## Install for a shop (client handoff)
Build with `npm run dist:win` and `npm run dist:mac`. On macOS, the Windows x64 installer can be cross-built with Wine. The Mac command builds Apple Silicon and Intel DMG files. `client-ready/` contains the Windows portable app folder, the Windows setup EXE, and Mac DMG files. For the portable Windows version, send the complete `Windows-Portable/` folder and keep its files together.

## Run from source (development only)
Install **Node.js LTS** from https://nodejs.org, then run `npm install` and `npm start`.

Quick alternative: open `renderer/index.html` in Chrome. Works, but data lives in browser storage
and there is no automatic folder backup. Use the desktop app for the real shop.

## Edit it in VS Code
Open this folder in VS Code, then in the terminal: `npm install` (once) and `npm start`. Edit, then press Ctrl+R in the app window to reload.

| File | What it is |
|---|---|
| `renderer/style.css` | colours, layout, fonts (top of file: theme variables) |
| `renderer/js/core.js` | default settings, categories, helpers, barcode, receipt layout, profit calculation |
| `renderer/js/pages.js` | Dashboard, POS, Sales/Returns, Products, IMEI, Barcode labels, Inventory |
| `renderer/js/pages2.js` | Suppliers, Purchases, Customers, Expenses, Cash register, Reports, Users, Settings |
| `renderer/js/app.js` | login, setup, menu list (`NAV`), keyboard shortcuts |
| `main.js` | desktop window, data file, automatic backup |

Shop name, address, phone, currency, tax, receipt text, colours, prefixes: **Settings** page (no code needed).
Default values for a fresh database are in `defaults()` in `core.js`.

## Where is my data?
Desktop app: `data.json` in the app data folder (Settings page shows the exact path):
Windows `%APPDATA%\the-smart-pos\` · Mac `~/Library/Application Support/the-smart-pos/`
Uninstalling or updating the app never touches it.

## Backups (important)
Settings → Backup & Restore: choose the folder (e.g. `D:\SmartBackups` or a USB drive), time and retention.
- A verified backup runs every day at the set time while the app is open; if the PC was off, it runs at next start.
- Failures show a red message. Old backups are cleaned by retention, newest 3 are always kept.
- **Restore:** Settings → Restore from backup… (a safety copy of current data is made first).
- Copy the backup folder to a USB drive regularly. Local backups do not survive a dead PC.

## Shortcuts
F2 POS · F4 focus scanner box · F9 complete sale · Ctrl+K global search · Esc close dialog.
USB barcode scanners work as a keyboard: click the scan box, scan, product is added.

## Build installers
Run `npm run dist:win` or `npm run dist:mac` to build Windows and macOS installers. On macOS, the Windows x64 build uses Electron Builder's Wine support; macOS builds require a Mac. Use `npm run dist:mac:x64` on Apple Silicon to create an Intel Mac DMG separately. Output goes to `dist/`, then `client-ready/` receives the versioned Windows setup EXE and macOS DMG files. The portable Windows app is delivered as the complete `client-ready/Windows-Portable/` folder. Unsigned builds may show a security prompt on first launch. The NSIS uninstaller is configured to preserve app data. No default POS logo is bundled; add a shop logo in Settings if desired.

## Deploy the browser POS (Vercel)

This repository also deploys the browser interface at the Vercel site root. Vercel copies `renderer/` into `public/` during its build, so `/` serves `renderer/index.html`; the update manifest under `public/updates/` remains available. Each shop uses `https://<slug>.<POS_ROOT_DOMAIN>` and resolves to its own tenant record, users, POS state, and host-only session cookie. The installed Electron app remains local and offline-first. Set the Vercel project framework preset to **Other** and the project root to this repository. Configure the required environment variables below before redeploying.

### Live browser POS database setup

Configure these values in Vercel **Project → Settings → Environment Variables** for Production (do not add them to source files):

- `MONGODB_URI`: MongoDB Atlas connection string. Restrict the database user to the POS database and allow network access only as required by Vercel.
- `MONGODB_DB`: database name, for example `the_smart_pos`.
- `POS_SESSION_SECRET`: random secret of at least 32 characters, used to sign secure login sessions.
- `POS_ROOT_DOMAIN`: the custom root domain for shop URLs, without a scheme, for example `pos.example.com`.
- `VERCEL_API_TOKEN`: a Vercel token with access to this project, used to register each shop hostname during tenant creation. Store it only in Vercel environment variables.
- `VERCEL_PROJECT_ID`: the ID of this Vercel project (from Project Settings → General). Set `VERCEL_TEAM_ID` too when the project belongs to a team.
- `POS_SETUP_SECRET`: one-time setup secret, at least 24 random characters. Keep it private and remove/rotate it after the first owner account is created.

For `pos.zenstack360.com`, add `pos.zenstack360.com` and `*.pos.zenstack360.com` to this Vercel project and configure matching DNS records at the DNS provider, following the exact targets Vercel shows. Keep wildcard DNS and the wildcard project domain: registering each new hostname with the Vercel API does not create DNS records or wildcard TLS coverage. Set `POS_ROOT_DOMAIN=pos.zenstack360.com`, `VERCEL_API_TOKEN`, and `VERCEL_PROJECT_ID` in Production (plus `VERCEL_TEAM_ID` for a team project), then redeploy. The API adds each new `<slug>.pos.zenstack360.com` hostname to the project automatically. Do not set `POS_ROOT_DOMAIN` to `pos360live.vercel.app`: Vercel does not support tenant wildcard subdomains under the shared `*.vercel.app` domain. Signup checks each requested slug against existing tenants; after signup it opens the tenant POS at that subdomain. Login at a shop subdomain is scoped to that tenant, so a username and password from another shop cannot authenticate there. Set `POS_REGISTRATION_OPEN=false` when public shop creation should stop. Existing `main` data remains on the root host; move it only through an explicit migration if it should receive a dedicated subdomain.

After deployment, open the HTTPS live site and create the first owner once using the setup secret. Thereafter every browser signs in through **Sign in to existing account** with that owner account or another live staff account; all those browsers share the MongoDB users and shop data. A localhost browser is intentionally local-only, so creating an account at `http://localhost:3000` does not create a live account and another browser has separate local data. Local browser data and desktop data are also not automatically imported into the live shop. Export a backup before starting live setup if you need to carry over local data.

Public shop signup is closed by default. With wildcard DNS and `POS_ROOT_DOMAIN` configured, set the Vercel Production environment variable `POS_REGISTRATION_OPEN=true` and redeploy to allow new businesses to create isolated tenant accounts. Staff accounts inside each shop are created by that shop's owner from Users & Permissions. Set the variable to `false` (or remove it) to close public signup.

The live browser reads the cloud snapshot after sign-in, saves each change to localStorage immediately, and sends background full-snapshot updates using MongoDB revision checks. MongoDB is required for live sign-in; an already signed-in browser can continue local work offline, then sync when reconnected if the cloud revision has not changed. If two devices edited offline or concurrently, sync stops and preserves the local copy rather than overwriting cloud data; export the local copy before resolving that conflict. An interrupted write is safe to retry. Live staff create, reset-password, enable, and disable actions are owner-only and hashed on the server. Live passwords must be at least 10 characters. Electron remains local-only and retains its current account flow.

Use Vercel environment variables for Production (and Preview too only if you intend to test live accounts there). Set `MONGODB_URI`, `MONGODB_DB`, and `POS_SESSION_SECRET` (at least 32 random characters). Set `POS_SETUP_SECRET` to a separate random value of at least 24 characters for first-owner setup; remove it or rotate it immediately after setup. MongoDB user credentials belong only inside the URI stored in Vercel. Use a database-scoped MongoDB user and allow Vercel network access in Atlas. After saving variables, redeploy the Production deployment. The app creates its required indexes on first API use. Never paste the URI into chat, source files, local `.env` files committed to Git, or browser settings.

The localhost browser version stores its database in that browser's local storage. It is separate from the desktop app's database and does not sync between browsers. Use the deployed HTTPS browser POS with MongoDB for shared live accounts/data, or the installed desktop app for backed-up local data.

## Publish client updates (Vercel)
The installed desktop app checks `https://pos360live.vercel.app/updates/latest.json` over HTTPS every time it starts. If a newer compatible release is available, it notifies the user; an owner can open **Settings & Backup → System update** and click **Install and restart**. The app downloads the matching platform installer, verifies its SHA-256 checksum, installs it, and reopens the POS. Shop data remains in the OS app-data folder. This build migrates the former placeholder URL in existing client profiles to the live URL. Clients built before this update need the live URL entered once in System update settings.

To release an update (publishing the Vercel site alone updates the browser POS, not installed desktop clients):

1. Increase `version` in `package.json` (use `major.minor.patch`) and build installers on each target OS with the commands above. The package and lockfile versions must match.
2. Build the release artifacts on a Mac and Windows PC. macOS installers must be built on macOS, for both Apple Silicon (`arm64`) and Intel (`x64`) when supporting both; Windows requires the electron-builder Setup `.exe`. From a Mac, run `npm run dist:mac` and `npm run dist:mac:x64`; from Windows, run `npm run dist:win`. Each command also collects client-ready installers in `client-ready/`.
3. On the release machine, copy the versioned installers from each build's `dist/` into the same project's `dist/` folder, then run `npm run release:stage`. This stages installers in `public/updates/` and writes SHA-256 checksums to `public/updates/latest.json`. By default, it requires all three client platforms. For a partial release, set `REQUIRED_UPDATE_PLATFORMS` to the platforms available, for example `REQUIRED_UPDATE_PLATFORMS=win32-x64 npm run release:stage`. Installer binaries are excluded from Git; Vercel can publish them only if each artifact fits your deployment limits. For larger artifacts, upload them to public HTTPS storage and set `UPDATE_URL_WIN32_X64`, `UPDATE_URL_DARWIN_ARM64`, and/or `UPDATE_URL_DARWIN_X64` to their exact URLs before staging. Set `RELEASE_NOTES` to customize notes. Review the manifest and deploy it with the referenced installers (or deploy after external uploads complete). Do not publish a higher version until its installers are available.
4. Deploy the staged release to Vercel. Installed clients check the manifest on next launch and notify users; an owner clicks **Install and restart** in **Settings & Backup → System update**. The POS downloads and verifies the installer, installs it, and relaunches. macOS can prompt for administrator approval to replace the app; unsigned apps may show the operating system's normal security prompt.

Manifest example (provide entries for the operating systems/architectures you build):

```json
{
  "version": "1.1.0",
  "notes": "Release notes shown in the POS",
  "platforms": {
    "win32-x64": { "url": "The-Smart-POS-Setup-1.1.0.exe", "sha256": "64-character-sha256-hex-digest" },
    "darwin-arm64": { "url": "The-Smart-POS-1.1.0-arm64.dmg", "sha256": "64-character-sha256-hex-digest" },
    "darwin-x64": { "url": "The-Smart-POS-1.1.0.dmg", "sha256": "64-character-sha256-hex-digest" }
  }
}
```

The manifest must be served from HTTPS. The update check reports network or publishing errors in Settings; it does not change the POS database. If no newer version exists, no platform installer is required. If a newer version exists but that platform has no valid installer, the app explains that publishing is incomplete and keeps the installed version usable.

## Roles
Owner = all · Manager = all except Users/Settings · Cashier = POS, own sales, customers, cash register.
Cashiers cannot exceed the max discount % (Settings).

## Notes / limits
- Money uses 2-decimal rounding. Costs use weighted-average (landed cost included). Profit uses the cost recorded at sale time.
- Barcodes are internal shop codes (Code 128), not GS1-registered numbers. You can type real manufacturer barcodes instead.
- Card/bank payments are recorded manually; no payment gateway is connected.
- Data is stored as one JSON file, fine for a single shop (thousands of products/sales). Single PC use.
- Printing uses the normal Windows/Mac print dialog (choose your thermal or label printer there).
