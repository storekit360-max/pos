# POS360 feature migration inventory

Source reviewed: Electron `main.js`/`preload.js`, `renderer/index.html`, `renderer/js/{app,core,pages,pages2,updater-ui}.js`, and project README. The source tree is untouched; a UI/resource snapshot is included for migration work.

## Existing feature surface (interface present; backend implementation needs individual validation)

- Authentication/setup, local user records, password hashing, owner/manager/cashier permissions, lockout, logout.
- Dashboard; POS checkout, held baskets, discounts, payment methods, receipt flow.
- Products, categories, brands, IMEI/device tracking, stock/inventory movements, barcode generation and labels.
- Sales history, returns/refunds, purchases, suppliers, customers/statements, expenses, cash register/shifts.
- Quotations and invoices, invoice templates, PDF/print flows; payroll, attendance, taxes, reports/exports.
- Settings/branding, customer display, JSON export/import, scheduled/manual verified backup and restore.
- Desktop license trial and signed SP1 entitlement validation; update manifest/download/checksum/install/relaunch; UI updates.

## Migration status

- [x] Read-only inventory and UI/resource snapshot.
- [x] Identify Electron API surface: local JSON load/save/path, backup/config/list/restore/folder picker, license status/start/activate, desktop & UI update, HTML printing, customer display, logo picker, event callbacks.
- [ ] Java WebView bridge implementing each API with equivalent semantics and secure origin restrictions.
- [ ] Local transactional storage and versioned migration/backup/recovery.
- [ ] Login, role, permission, and all module workflows verified end-to-end.
- [ ] Signed license validation and live activation protocol mapped to existing issuer.
- [ ] Java-specific signed update manifest/artifacts and rollback.
- [ ] Native print, PDF, barcode, customer display, file dialogs, and branding integrations.
- [ ] Isolated automated/manual QA suite and Windows/macOS release builds.

## Known source dependencies and uncertainty

Electron's `posApi` exists only in the preload bridge. Static browser UI falls back to localStorage; native backup, printing, customer display, file picking, licensing, and desktop update require the Electron main process. The existing update manifest is designed for Electron artifacts. The desktop license public-key validation is local, but an online activation protocol/API was not identified in the inspected client code; signed keys appear issued elsewhere. No production endpoint changes or credentials were accessed. A full compatible desktop migration cannot be claimed until these contracts are mapped and implemented.
