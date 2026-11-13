# POS360 Java Client — migration workspace

This folder is an isolated JavaFX/Maven migration workspace. It contains a snapshot of the POS360 renderer and a minimal JavaFX WebView launcher for integration evaluation. It is **not a complete or production-ready POS client**: no Electron `posApi` replacement, local database, authentication bridge, license activation service, update installer, native print/backup implementation, or feature parity has been completed.

## Requirements

Java 21, Maven, and platform packaging tools (`jpackage`; WiX on Windows for EXE, macOS `hdiutil` for DMG). Runtime installers should bundle Java via `jpackage --runtime-image` or its supported runtime-image generation flow.

## Build

From this directory: `mvn javafx:run` or `mvn package`. Use `scripts/build-windows.ps1` on Windows and `scripts/build-macos.sh` on macOS. The scripts have not been run here. Outputs are directed to the platform installer folders. They are starting points and require platform validation and a corrected JavaFX runtime/module packaging setup before customer distribution.

The renderer snapshot references its original browser behavior. In WebView it will fall back to browser localStorage and will not gain Electron backup, license, printer, customer display, or update capabilities. Do not use real customer data for evaluation.

See [feature migration checklist](FEATURE-MIGRATION-CHECKLIST.md) for the inspected functionality and outstanding work. No installer was generated and no Windows/macOS packaging claim is made.
