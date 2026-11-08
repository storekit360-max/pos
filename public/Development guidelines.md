# The Smart POS: Development & Release Guidelines

How to build features and fix bugs on the live server so that every installed offline app (Windows and Mac) updates safely.

Read together with `UPDATE-GUIDE.md` (commands) — this file is the **rules and checklists**.

---

## 0. The 12 golden rules

1. **`main` branch = production for every client PC.** Anything merged to `main` reaches every online client within hours. Work on branches, merge only when tested.
2. **Decide first: is this a SCREEN change or a SHELL change?** (Section 2.) Screens update live in seconds. Shell needs an installer.
3. **Prefer screen-only solutions.** Every shell change forces every client through an installer.
4. **Never break old data.** Client data lives in one `data.json` on each PC. Make every database change **additive** and add a migration (Section 4).
5. **Never call a new `window.posApi.xxx` from screens without checking it exists**, or raise `uiMinShell` (Section 3.2).
6. **Everything must work offline.** No CDN, no remote fonts/images, no required server calls.
7. **File names in `renderer/` use only letters, digits, `.`, `_`, `-`** and no spaces. A bad name makes the whole live update fail.
8. **Your commit message is the release note** shown to shop owners. Write it for them.
9. **Never publish a manifest version before its installers are uploaded.**
10. **Never lower a version number.** To undo a shell release, publish a *higher* fixed version.
11. **Test on a copy of real older data**, not only on a fresh database.
12. **After every release, run `npm run verify:live`** and check one real installed app.

---

## 1. How the system works (30-second version)

```
GitHub main ──push──► Vercel build ──► https://pos360live.vercel.app
                         │                 ├─ /updates/latest.json   (manifest)
                         │                 └─ /index.html, /js/*.js … (screens, also the browser POS)
                         └─ scripts/build-ui-manifest.js fingerprints every file in renderer/

Installed app (Windows/Mac)
  ├─ SHELL  : main.js, preload.js, customer-preload.js, updater.js, Electron   → changes only via INSTALLER
  ├─ SCREENS: everything in renderer/                                          → changes via LIVE UI UPDATE
  └─ DATA   : data.json in the OS app-data folder                              → never touched by updates
```

| | Live UI update | Installer update |
|---|---|---|
| Triggered by | Any change in `renderer/` + `git push` | New `version` + installers + `release:stage` + `git push` |
| Size | KB | ~80–120 MB |
| Client action | **Settings → System update → Check for updates → Restart to apply update** | **Settings → System update → Check for updates → Install and restart** |
| Check timing | Manual button only | Manual button only |
| Safety | SHA-256 per file, fallback to bundled screens, 3-boot crash guard | SHA-256 of installer, script always reopens POS |

Important behaviours to remember:
- A live screen bundle is valid **only for the app version it was downloaded for**. After an installer update the app goes back to the screens bundled in that installer, then downloads the newest live screens again. **Build installers from the latest `main`** so this reset is small.
- Live screens are blocked on apps older than `uiMinShell` (in `package.json`). Those apps are told to install the app update first.
- The update URL is a setting in the app (default `https://pos360live.vercel.app/updates/latest.json`).

---

## 2. Classify every change first

| Change | Channel | Notes |
|---|---|---|
| Bug fix in calculations, reports, invoices, POS logic | **Screens** | `core.js`, `pages.js`, `pages2.js`, `app.js` |
| New page, new report, new button, new field on a form | **Screens** | + migration if the database shape changes |
| New setting | **Screens** | Add default in `defaults().settings` (Section 4) |
| Styling, theme, layout, translations/labels | **Screens** | `style.css` |
| Customer display look (`customer-display.html`) | **Screens** | Same data messages only |
| Invoice/receipt layout using the existing `printHTML` job fields | **Screens** | |
| New data sent between POS window and customer display | **Shell** | New IPC in `main.js` / `customer-preload.js` |
| Anything that needs a **new `window.posApi` function** (file access, serial port, tray, auto-start, new print option handled in main process) | **Shell** | Edit `main.js` + `preload.js` |
| Backup, license, data-file, or auto-update behaviour | **Shell** | |
| Electron upgrade, new npm dependency, `package.json` `build` config, app icon, installer options | **Shell** | |
| Feature that calls an **external internet API** | **Shell or CSP change** | Renderer CSP blocks external calls (Section 3.4) |
| New screens that *require* a new shell function | **Both** | Section 8, procedure C |

When unsure: if the change touches **any file outside `renderer/`**, it is a shell change.

---

## 3. Rules for screen changes (`renderer/`)

### 3.1 Files and fingerprinting
- Every file inside `renderer/` is fingerprinted automatically. Adding a new `.js`/`.css`/image file just works — but a new script must also be added to `index.html` (or `customer-display.html`) in the right order.
- Allowed path characters: `A–Z a–z 0–9 . _ -` and `/` for folders. **No spaces, no accents, no `#`, no `(`.** One bad name = entire update rejected ("invalid file").
- Limits: max **300 files**, max **8 MB per file**. Embed small images as data URIs or keep them small.
- Files starting with `.` are ignored.
- Keep line endings LF (the repo has `.gitattributes`). Do not "fix" it.
- Never put secrets in `renderer/`. It is publicly served on Vercel.

### 3.2 Compatibility with older installed apps
Not every PC updates the same day. Screens must run on **the oldest shell you still support** (`uiMinShell`).

```js
// ✅ Safe: feature-detect a new shell function
if (window.posApi?.newThing) { await window.posApi.newThing(x); }
else { toast('Please update the desktop app to use this feature', 'err'); }

// ❌ Unsafe: crashes on older shells
await window.posApi.newThing(x);
```

- If the screens **cannot** work without the new shell function, raise `"uiMinShell"` in `package.json` to the shell version that adds it. Consequence: **every PC on an older shell stops receiving live screen fixes until it installs the new installer.** Raise it only when truly required, and release the installer first or in the same push (procedure C).
- **Never remove or rename** an existing `window.posApi` function or IPC channel that old screens still use. Add new ones; keep old ones until no supported shell needs them.
- The browser version (Vercel root) runs the same files **without** `window.posApi`. Every screen must also work (or hide the feature) when `window.posApi` is undefined.

### 3.3 Offline-first
- No `<script src="https://…">`, no Google Fonts, no remote images. They fail offline and are blocked by the CSP.
- Features must degrade gracefully when there is no internet. The only code that should depend on the internet is the update check.
- Do not store business data in `localStorage` on desktop. Use `db` + `save()`, which goes through `posApi.save`.

### 3.4 Content-Security-Policy (in `index.html`)
Current policy: `default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; script-src 'self'`.
- No inline `<script>` blocks and no `eval` / `new Function`. Put code in `.js` files.
- `fetch()` to another website is blocked. If a feature really needs an online API (SMS, cloud sync, payment), either call it from the main process (shell change) or add the specific host to `connect-src` in `index.html` (a screens change) — and handle failure when offline.

### 3.5 Don't lose a cashier's work
- Applying a screen update restarts the app so the verified bundle is promoted on startup. An unsaved cart in memory is lost, so screen updates are downloaded only after a manual check and require an explicit restart action. Applied update history is recorded after the new screens successfully boot.
- Never add `location.reload()` loops in boot code. The updater already has a per-session guard against apply loops.

### 3.6 Boot must never throw
`app.js` `boot()` shows "Could not start POS" on failure and the update guard counts boots. A syntax error in any script breaks the whole app for every client who updates. Before pushing: `node --check renderer/js/*.js` and open the app.

---

## 4. Database and migrations (the #1 source of client-side bugs)

Facts about your app today:
- Each PC has its own `data.json`; there is no shared server database.
- `loadDB()` in `core.js` merges **new top-level keys** and **new `settings` keys** from `defaults()` automatically, and merges `counters`.
- It does **not** fix up fields inside existing records (products, sales, customers…) and the `v` field is not used yet.
- Clients can be offline for weeks and **skip versions**. A PC may jump straight from data created by an old release to your newest code. Restoring an old backup also feeds old data into new code.

### 4.1 Rules
1. **Additive only.** Add fields; don't rename, retype or delete existing ones in one step.
2. **New setting** → add the key with a default in `defaults().settings`. It reaches existing clients automatically.
3. **New collection / top-level key** → add it to `defaults()`. It is created empty for existing clients.
4. **New field on existing records** → either read it defensively (`p.warrantyDays ?? 0`) or add a migration (below).
5. **Renaming or reshaping data** → write a versioned migration; keep reading the old field until the migration has run everywhere.
6. Migrations must be **idempotent** (safe to run twice) and must **run from any older version**, not only from the previous one.
7. Always keep data valid for the **previous** screens as well: if you must roll the screens back, old code will see your new fields — it should ignore them harmlessly.

### 4.2 Recommended migration pattern (put in `core.js`)
```js
const SCHEMA = 2;               // bump when you add a migration; also set v: SCHEMA in defaults()

function migrate(d) {
  d.v = d.v || 1;
  if (d.v < 2) {                // example: add warranty days to every product
    for (const p of d.products || []) if (p.warrantyDays === undefined) p.warrantyDays = 0;
    d.v = 2;
  }
  // if (d.v < 3) { … d.v = 3; }
  return d;
}
```
In `loadDB()`, right after the defaults merge:
```js
if (d) {
  const needs = (d.v || 1) < SCHEMA;
  if (needs && window.posApi?.backupNow) { try { await window.posApi.backupNow(); } catch {} } // safety copy first
  d = migrate(d);
  if (needs && window.posApi) await window.posApi.save(d);
}
```
- If `d.v > SCHEMA` (data written by newer screens, e.g. after a rollback), don't downgrade or modify it; just continue and avoid touching unknown fields.
- Restore (`A.restoreBk`) calls `loadDB()`, so restored old backups are migrated too.

### 4.3 Money, stock and reports
- Changes to profit/tax/stock formulas affect **history**. Decide explicitly: new rule for new sales only (store the rule/value on the sale at sale time, as profit already does) or recalculate old data. Never silently change old totals.
- Keep 2-decimal rounding consistent with existing helpers.

---

## 5. Rules for shell changes (`main.js`, `preload.js`, `updater.js`, `package.json`)

- Keep it **backward compatible with the screens bundled in older installers** where possible; the live bundle is always dropped on a shell change, so shell + screens never mix across versions.
- **Do not change**: `appId` (`lk.thesmart.pos`), `productName`, the data folder names (`the-smart-pos-client-v1` / `the-smart-pos-new`), the data file name `data.json`. Changing them can create a second install or make data "disappear".
- **Do not change installer file naming** unless you also update `scripts/prepare-update-manifest.js`. The manifest picks files by pattern: Windows name contains `Setup` and ends `.exe`; Mac names contain `arm64` for Apple Silicon; version must be in the name.
- Keep `contextIsolation: true`, `nodeIntegration: false`. Add only the IPC functions you need.
- Any new file at the project root used by `main.js` must be added to `build.files` in `package.json`, or it will be missing in the installed app (works with `npm start`, crashes when installed). **Always test the packaged app**, not only `npm start`.
- Validate every value that arrives from the renderer in IPC handlers.
- Update flow code (`updater.js`, update handlers in `main.js`) is critical: after changing it, test an update **from the previous installed version to the new one** on real Windows and Mac.

### 5.1 Versioning
- Shell `version` = `major.minor.patch` (e.g. `1.4.0` → `1.5.0`). Must be 3 numbers; the updater ignores anything else.
- Change **both** `package.json` `version` and the two `version` lines at the top of `package-lock.json`.
- `uiMinShell` is separate and manual. Bumping `version` does **not** change it. Raise it only when the screens need the new shell (Section 3.2).
- Patch (`1.4.1`): shell bug fix. Minor (`1.5.0`): new shell capability. Major: breaking/big redesign.

---

## 6. Branching and commit discipline

- Work on a branch (`feature/…`, `fix/…`). Open a Pull Request. Merge to `main` = release to all clients.
- Protect `main` on GitHub (require PR, optionally 1 review). Turn on 2-step login for GitHub and Vercel.
- **Squash-merge with a clear first line.** The first line of the latest commit on `main` becomes the update note shown in **Settings → System update**.
  - ✅ `Fix VAT rounding on returns`
  - ✅ `Add warranty days to products`
  - ❌ `wip`, `fix`, `asdf`, `merge branch main`
- One feature or fix per merge. Small, frequent releases are easier to test and to roll back.
- Don't release at peak shop hours if you can avoid it. The update applies only when a user clicks Restart, but a bad release hurts most at busy times.
- Don't commit generated files: `dist/`, `client-ready/`, `node_modules/`, and **never commit the copy of `renderer/` inside `public/`** or a locally generated `public/updates/latest.json` containing a `ui` section. If you ran the build command locally: `git checkout public/updates/latest.json` and delete the copied files in `public/`. (Optional: add `/public/*` and `!/public/updates/` to `.gitignore`.)

---

## 7. Test checklist before merging to `main`

**A. Always**
- [ ] `node --check` passes for every changed `.js`.
- [ ] `npm start` runs; the feature works; no red console errors (View → DevTools via Ctrl+Shift+I).
- [ ] Tested with **internet off**.
- [ ] Tested on a **copy of real data from an older release** (not only a fresh database). Copy a client's backup, restore it, and confirm everything still opens and totals are unchanged.
- [ ] Tested as **Owner, Manager and Cashier** (permissions).
- [ ] Browser version still works (open `renderer/index.html` or the Vercel preview).
- [ ] Printing tested if invoices/receipts/labels changed (thermal + A4 + preview).

**B. If the database changed**
- [ ] Migration runs on old data, runs twice safely, and produces a backup first.
- [ ] Old backup restore works after the change.
- [ ] New feature works when the new field is missing (defensive reads).

**C. If the shell changed**
- [ ] Built the installer and tested the **packaged** app on Windows **and** Mac.
- [ ] Update test from the **previous installed version** to the new one worked (data intact, app reopened).
- [ ] `build.files` contains every file `main.js` needs.

**D. After merge**
- [ ] Vercel deployment is "Ready".
- [ ] `npm run verify:live` → all files PASS.
- [ ] `latest.json` `ui.revision` changed, `ui.notes` is your message, `ui.minShell` is what you intended.
- [ ] One real installed app: Check for updates → downloads → Restart to apply → new feature visible, new revision shown.

**Optional pilot PC:** the update URL is a setting. A test PC can point to a Vercel *preview* deployment's `…/updates/latest.json` to receive a branch's screens before production. (Preview deployments must not require a Vercel login for this to work. Switch the test PC back to the production URL afterwards and it will return to the production screens.)

---

## 8. Release procedures

### A. Screens only (daily feature / bug fix)
1. Branch → change → test (Section 7) → PR → squash-merge with a good message.
2. Wait for Vercel "Ready". Run `npm run verify:live`.
3. Check one installed app. Done. No version change, no installer.

### B. Shell only (new installer, screens unchanged)
1. Bump `version` (package.json + lock). Keep `uiMinShell` as is.
2. `npm run dist:win` (Windows PC), `npm run dist:mac` (Mac). Copy all installers into one `dist/`.
3. Upload installers to a **public** GitHub release `vX.Y.Z` in the installers repo.
4. Confirm each download URL opens.
5. ```
   UPDATE_BASE_URL=https://github.com/<user>/<installers-repo>/releases/download/vX.Y.Z \
   RELEASE_NOTES="What is new" \
   REQUIRED_UPDATE_PLATFORMS=win32-x64,darwin-arm64,darwin-x64 \
   npm run release:stage
   ```
6. Commit `package.json`, `package-lock.json`, `public/updates/latest.json`. Push.
7. Verify with one Windows PC and one Mac: Check for updates → Install and restart → data intact → app reopens.
8. Send the new `client-ready` installers to **new** clients from now on.

### C. New shell feature + screens that need it
1. Do B, with `uiMinShell` raised to the new version in the same commit (or earlier).
2. Screens that use the new function ship in the same push or later. Apps still on the old shell won't get these screens (they're told to install the app update) — **and also stop getting any other live screen fixes** until they update.
3. Chase the remaining PCs to update. (The app shows its version in Settings → System update; there is no remote tracking, so ask clients or check in person.)

### D. Urgent hotfix
- Screens bug: fix on a branch, minimal change, merge, run `verify:live`. Clients get it within hours (or immediately via Check for updates; tell the shop to click it).
- Shell bug: publish a new **patch** version (B). Tell clients to run Check for updates.
- If a client is on an old shell blocked by `uiMinShell`, they can't receive screen hotfixes — another reason to raise `uiMinShell` rarely.

### E. Rollback
- **Screens:** revert the commit on `main` and push. The reverted files produce the *old* revision again; clients on the bad revision download the good one at their next check. For speed you can also use Vercel's **Instant Rollback** to the previous deployment (it restores that deployment's `latest.json` too) — then still revert in Git so the next deploy doesn't bring the bug back.
- **Clients that already applied a bad screen update and can't wait:** close the app, delete the folder `…\the-smart-pos-client-v1\ui-updates` (Windows `%APPDATA%`, Mac `~/Library/Application Support`), reopen. The app returns to the screens inside the installer. Data is not touched.
- **Shell:** you cannot downgrade. Publish a higher fixed version (e.g. 1.5.1). Never lower `version` in `latest.json`.
- **Bad data migration:** restore the safety backup taken before the migration (Settings → Restore from backup), and ship a fixed migration.

---

## 9. Never do this

- ❌ Edit `latest.json`'s `ui` section by hand (it is generated on every deploy).
- ❌ Push a higher `version` + installer URLs before the files are uploaded and reachable.
- ❌ Rename/remove `window.posApi` functions that old screens use.
- ❌ Change `appId`, `productName`, data folder names or `data.json` name.
- ❌ Use spaces/special characters in `renderer/` file names.
- ❌ Add CDN scripts, web fonts, or remote images.
- ❌ Rename/delete fields in existing data without a migration.
- ❌ Change a financial formula and silently recalculate history.
- ❌ Test only with `npm start` when you changed shell files or `package.json`.
- ❌ Merge to `main` "just to see if it works". Use a branch/preview.
- ❌ Share the license-key inventory file or put it in the public repo or `renderer/`.

---

## 10. Support and troubleshooting

**Where to look on a client PC**

| What | Windows | Mac |
|---|---|---|
| App data | `%APPDATA%\the-smart-pos-client-v1\data.json` | `~/Library/Application Support/the-smart-pos-client-v1/data.json` |
| Live screens | `…\ui-updates\` (`active.json`, `rev-…`) | same folder name |
| Installer update log | `%TEMP%\TheSmartPOS-update.log` | `~/Library/Logs/TheSmartPOS-update.log` |
| Version / screens id | Settings → System update | Settings → System update |

**Symptoms**

| Symptom | Likely cause / fix |
|---|---|
| "Update check failed" | No internet, wrong URL in settings, or Vercel down. URL must be `https://pos360live.vercel.app/updates/latest.json`. |
| Says up to date but you pushed a change | Vercel not finished, or `ui.revision` unchanged (build step missing). Check the Vercel build log for `UI revision … files`. |
| "Needs desktop app vX or newer" | `uiMinShell` is higher than the client's app. Install the installer update. |
| Update download "failed verification" | CDN not yet updated or file changed during download. Retry in a minute. |
| "invalid file" in update | A file name in `renderer/` contains a forbidden character, or a file is over 8 MB. |
| One PC never updates | Its app is older than 1.4.0 (no live-update code). Install 1.4.0+ once manually. |
| New feature visible in browser but not in desktop app | Desktop app hasn't applied the update yet, or it runs with `npm start`/dev (live updates are for installed apps only). |
| App fell back to old screens by itself | A live bundle failed to load or failed to boot 3 times. Fix the bug, push, and it will retry on the next revision. |
| Mac update didn't install | Check `~/Library/Logs/TheSmartPOS-update.log`; app folder may need admin approval (the update asks). |
| Windows SmartScreen / Mac Gatekeeper warnings | Builds are unsigned (first manual install only). Code signing certificates remove this. |

---

## 11. Copy-paste checklist for every Pull Request

```
## Change type
- [ ] Screens only (renderer/)      - [ ] Shell (main/preload/updater/package.json)      - [ ] Both

## Release note (becomes the first line of the commit message)
...

## Compatibility
- [ ] No new window.posApi call without a feature check (or uiMinShell raised and installer released)
- [ ] Works with window.posApi missing (browser version)
- [ ] Works offline; no CDN / remote fonts / remote images
- [ ] renderer/ file names use only A-Z a-z 0-9 . _ -

## Data
- [ ] No database change   OR   additive change + default/migration + tested on old data + old backup restore
- [ ] No change to financial formulas   OR   history handling decided and documented

## Tests
- [ ] node --check on all changed JS      - [ ] npm start, console clean
- [ ] Tested as Owner / Manager / Cashier  - [ ] Printing tested (if relevant)
- [ ] Shell changes: packaged app tested on Windows and Mac, update from previous version tested

## After merge
- [ ] Vercel Ready   - [ ] npm run verify:live PASS   - [ ] One installed app updated and checked
```

---

## 12. Known limits (so nothing surprises you)

- Updates need the app to be **open and online**. There is no forced or silent update for screens while someone is signed in, and no remote monitoring of which version each PC runs.
- There is no server-side database or sync. Each PC's data is separate; features can't assume shared data.
- Update integrity relies on HTTPS plus SHA-256 from your own server. Whoever can deploy to Vercel or the installers repo can update every shop — protect those accounts with 2-step login. Code signing (Windows certificate, Apple Developer ID) is the next security step if you want removal of the OS warnings.
- Screens and shell versions are tied: a PC always runs either the screens from its installer or a live bundle made for its exact shell version.
