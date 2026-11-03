# The Smart POS: how updates work

There are **two update channels**. Both read the same file: `https://pos360live.vercel.app/updates/latest.json`

| | Live UI update (daily) | Installer update (rare) |
|---|---|---|
| What changes | Everything in `renderer/` (screens, reports, invoice, styles) | `main.js`, `preload.js`, `updater.js`, Electron version |
| Download size | A few KB to a few hundred KB (only changed files) | About 80–120 MB |
| Needs installer / admin / SmartScreen? | No | Yes (silent, automatic) |
| How you publish | `git push` (Vercel deploys) | Build installers, upload, `npm run release:stage`, `git push` |
| How the client gets it | Automatic check on start + every 3 h. Applied automatically at the login screen, or owner/manager clicks **Restart now** | **Settings → System update → Check for updates → Install and restart** |

Shop data is never touched by either channel.

---

## Daily update (the normal case)

1. Edit files in `renderer/` (or any screen code).
2. `git add . && git commit -m "Fix VAT rounding" && git push`
3. Vercel builds. `scripts/build-ui-manifest.js` runs automatically, fingerprints every file in `renderer/`, and adds a `ui` section to `latest.json`. The commit message becomes the update note.
4. Client PCs that are online pick it up automatically.

You do **not** edit `latest.json` for daily updates.

### The one rule
If your new screens call something new from `main.js` / `preload.js` (a new `window.posApi.something`), then old installed apps cannot run them. In that case:

1. Bump `version` in `package.json` (and the two `version` lines at the top of `package-lock.json`).
2. Set `"uiMinShell"` in `package.json` to the same new version.
3. Do an **installer release** (below) **before** pushing the screens.

Old apps will not apply screens that need a newer app. They show "install the app update first" instead of breaking.

---

## Installer release (only when main.js / preload.js / Electron changes)

1. Raise `version` in `package.json` and `package-lock.json` (for example `1.4.0` → `1.5.0`).
2. Build on each OS:
   - Windows PC: `npm run dist:win`
   - Mac: `npm run dist:mac` (builds Apple Silicon and Intel, `.dmg` and `.zip`)
3. Copy all installers into one `dist/` folder (the Windows `.exe` and the Mac `.dmg` + `.zip` files).
4. Upload them to **public HTTPS storage**. Recommended: a **public** GitHub repo used only for installers (for example `pos360-releases`). Create a release `v1.5.0` and attach all files. Vercel limits large files, so do not host installers on Vercel.
5. Write the manifest:
   ```
   UPDATE_BASE_URL=https://github.com/YOUR-USER/pos360-releases/releases/download/v1.5.0 \
   RELEASE_NOTES="What is new" \
   REQUIRED_UPDATE_PLATFORMS=win32-x64,darwin-arm64,darwin-x64 \
   npm run release:stage
   ```
   (On Windows PowerShell set the variables first: `$env:UPDATE_BASE_URL="..."`, then `npm run release:stage`.)
6. `git add . && git commit -m "Release 1.5.0" && git push`

Never push a higher `version` in `latest.json` before the installers are uploaded.

---

## One-time step for the PCs that already have the app installed

The installed apps cannot gain the new live-update ability by themselves, because that code lives in `main.js`. Every PC needs **one** installer update to version 1.4.0 (or newer):

- If the installed app already has **Settings → System update**: publish the 1.4.0 installer release (steps above), then on each PC click **Check for updates → Install and restart**. Mac installers are published as `.zip` on purpose: older installed apps can only install a `.zip` automatically.
- If the installed app has no System update screen: install the 1.4.0 installer manually once. Shop data stays in the app-data folder.

From then on, daily changes arrive as live UI updates.

---

## Safety built in

- Every downloaded file is verified with SHA-256 before use. A bad file is rejected and nothing changes.
- New screens are fully downloaded and checked **before** they replace the current ones.
- If new screens fail to load, or the app fails to start three times in a row, the app falls back to the screens inside the installer automatically.
- Installing a new full installer drops old live screens, so versions never mix.
- The installer script always reopens the POS, even if the update failed. Logs: Windows `%TEMP%\TheSmartPOS-update.log`, Mac `~/Library/Logs/TheSmartPOS-update.log`.
- Turn on 2-step login for GitHub and Vercel. Whoever can deploy to the update server can update every shop.

## Checking that it works

1. Install the 1.4.0 build on a test PC (`Settings → System update` shows `Installed app v1.4.0 · screens abc123`).
2. Change any text in `renderer/`, push, wait for the Vercel deploy.
3. On the test PC click **Check for updates**. It should download in a second and offer **Restart to apply update**. The screens id changes.
