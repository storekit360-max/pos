# The Smart POS: live updates and offline desktop licenses

This guide covers two separate tasks:

1. Publish renderer changes to the deployed HTTPS POS site and to installed desktop apps.
2. Create signed desktop license keys on the live server and activate them in offline desktop apps.

The browser POS and Electron desktop app keep separate accounts and data. A desktop license unlocks the desktop app; it does not copy local accounts/data to the live site or sign a user into the browser POS.

## Remove the local sign-in reminder

The local-only reminder was removed from the renderer login screen. To put this change into the live browser POS and the installed desktop apps:

1. Commit and push the change. Vercel deploys the browser POS and regenerates the renderer UI manifest.
2. Installed clients with the live UI updater can open **Settings & Backup → System update → Check for updates**, then choose **Restart to apply update**. The UI update is downloaded and verified before it is applied.
3. Older installed clients without live UI updates need a full installer update as described below. Publishing the website alone does not update an installed Electron app.

## Desktop license keys: simple setup

The super admin creates a key; the offline app verifies it locally. Do this setup once:

1. On the trusted release computer, run `npm run license:setup`. This creates the signing key pair. Back up `desktop-license-private.pem` securely and never send it to customers or commit it.
2. Add only `DESKTOP_LICENSE_PRIVATE_KEY` to Vercel Production, using the complete contents of `desktop-license-private.pem`, then redeploy. The API derives the public key automatically; no public key environment variable is needed.
3. Build installers as usual with `npm run dist:win` or `npm run dist:mac`. The build automatically synchronizes the desktop app's public key from the private key before packaging. Distribute the new installer to customers.
4. For routine use, open **Super admin → Desktop licenses**, choose **7-day**, **30-day**, or **permanent**, and generate. Paste the resulting complete `SP1.` key in the desktop app under **Settings & Backup → License**.

Keep the same private key for future builds. If it is lost or intentionally replaced, new installers must be built and distributed before issuing keys from the replacement. Previously installed builds trust the old public key and cannot verify keys from a new signing key.

The server stores only a hash and displays each generated key once. Offline permanent activations cannot receive remote revocations; timed keys expire on the device.

## Activate a key in the offline desktop app

1. Install and open the Electron desktop POS. The device may be offline for activation.
2. Sign in to the local desktop account. Open **Settings & Backup → License**.
3. Paste the complete key (it begins with `SP1.`) into **License key**, then click **Activate license**.
4. Check the displayed license status and expiry. Each computer stores its activation in that computer's app data; a license activation does not transfer the local account or shop data to another computer.

The app verifies the signature locally. Temporary keys are time-limited from issuance and expire on that device. The server can revoke a key to prevent future use, but a desktop already activated and kept offline cannot receive revocation. A permanent offline activation therefore cannot be remotely disabled. Keep a secure record of which key was issued to each customer/device.

## Publish renderer changes (live UI update)

Use this for changes confined to `renderer/` that do not need new Electron or preload APIs.

1. Edit the renderer files and commit/push them to the Vercel-connected branch.
2. Vercel builds the site. `scripts/build-ui-manifest.js` fingerprints the renderer files and adds a `ui` section to `updates/latest.json`.
3. In each installed app, open **Settings & Backup → System update → Check for updates**. The app downloads and verifies the UI update; choose **Restart to apply update** when ready.

Do not change the desktop `version` for a renderer-only update. If the new renderer needs a new `window.posApi` or Electron behavior, make and publish an installer release first, and set `uiMinShell` in `package.json` to the minimum compatible desktop version.

## Publish an installer update

Use this when changing `main.js`, `preload.js`, `customer-preload.js`, `updater.js`, Electron, or the embedded desktop public key.

1. Increase `version` in `package.json` and the root package version in `package-lock.json` to the same new version.
2. Build for every platform/architecture you support. Build Windows on Windows with `npm run dist:win`. Build Apple Silicon macOS with `npm run dist:mac`; for Intel macOS also run `npm run dist:mac:x64`. Each command creates platform installers and collects handoff files in `client-ready/`.
3. Put the versioned installers for all platforms in the release machine's `dist/` folder. Upload the installers to public HTTPS storage. A public GitHub Release is one option; Vercel deployment limits may be too small for installers.
4. Stage the checksums and manifest. Example for a GitHub Release:

   ```sh
   UPDATE_BASE_URL=https://github.com/YOUR-USER/pos360-releases/releases/download/v1.5.0 \
   RELEASE_NOTES="What is new" \
   REQUIRED_UPDATE_PLATFORMS=win32-x64,darwin-arm64,darwin-x64 \
   npm run release:stage
   ```

   On Windows PowerShell, set `$env:UPDATE_BASE_URL`, `$env:RELEASE_NOTES`, and `$env:REQUIRED_UPDATE_PLATFORMS` first, then run `npm run release:stage`. For a partial release, list only available platforms in `REQUIRED_UPDATE_PLATFORMS`.
5. Review `public/updates/latest.json`; ensure each URL is public HTTPS and every referenced installer is already uploaded. Commit and push the manifest. Vercel deploys the release metadata.
6. On each desktop, choose **Settings & Backup → System update → Check for updates → Install and restart**. The client selects its platform installer, verifies the SHA-256 digest, then starts the installer and relaunches the POS. macOS may prompt for permission to replace the app.

Never publish a higher manifest version before all installers referenced by it are available. Updates preserve shop data in the OS app-data directory. Keep the manifest HTTPS and do not commit signing private keys or other secrets.

## Updating older installed apps

The local reminder removal is a renderer change, but older desktop versions can only receive it if they have the live UI updater. Check **Settings & Backup → System update** first. If the screen is absent, or the app cannot update itself, build and distribute a full installer using the steps above and update each computer manually. The installer preserves app data; back up the shop before a major rollout as good operating practice.

## Troubleshooting

- **No update appears:** check the deployed manifest at `https://pos360live.vercel.app/updates/latest.json`, app internet access, and that the manifest's version is newer than the installed app.
- **Installer unavailable for this platform:** that platform's installer URL is missing, inaccessible, or invalid in the manifest. Upload the correct installer and restage the manifest.
- **Checksum error:** replace the corrupted upload and regenerate the manifest with `npm run release:stage`.
- **License key rejected:** paste the entire key, confirm it has not expired, and verify that the desktop build's embedded public key matches Vercel's private key.
- **Revocation expectation:** revoking a key blocks future activations. An already activated offline app cannot learn about a revocation until it connects to a revocation service; this release does not poll such a service.
