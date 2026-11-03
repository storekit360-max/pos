# The Smart POS — Client installation

This folder contains direct-send installers for The Smart POS. Send the single installer that matches the client's computer. The POS works offline after first setup.

## Windows 10/11 (64-bit)

1. Run the current **The Smart POS Setup** installer and follow the installer. Choose an install location if needed.
2. Start **The Smart POS** from the Start menu or desktop shortcut.
3. If Windows SmartScreen appears for this unsigned app, choose **More info → Run anyway**.
4. On first launch, enter the shop details and create the owner account.

## macOS

1. Use the current **arm64** DMG for an Apple Silicon (M-series) Mac, or the standard DMG for an Intel Mac.
2. Open the DMG and drag **The Smart POS** into **Applications**.
3. These builds are unsigned. If macOS blocks the app, Control-click it in Applications, choose **Open**, then confirm.
4. On first launch, enter the shop details and create the owner account.

## Data, backups, and updates

The installed POS stores shop data on that computer and does not sync with the browser version or another computer. Back up from **Settings → Backup & Restore** before moving to a new computer. Updates and normal uninstall do not remove the data folder.

Shop data is stored in the operating system's application data folder:

- Windows: `%APPDATA%\the-smart-pos-client-v1\data.json`
- macOS: `~/Library/Application Support/the-smart-pos-client-v1/data.json`

Installations that used the older `the-smart-pos-new` data folder continue using that existing data. To move to another computer, install the app there and use **Restore from backup**.

The app checks `https://pos360live.vercel.app/updates/latest.json` from **Settings → System update** when online. If an older installation has the placeholder update URL, enter the address above once in that screen. Internet is optional for normal offline use; the separate browser version and update downloads need internet access.

To publish a new release, build the installers for the supported platforms, stage them into `public/updates/`, regenerate `latest.json`, and deploy the Vercel project. Installed clients can download the update while online; the new features then work offline.
