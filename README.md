# Locale Sync Tool

Standalone utility to synchronize locale JSON files from a reference locale and sort all keys alphabetically.

## What It Does

- Prompts for reference locale in interactive terminals using arrow keys + Enter.
- Main selector always shows `it`, `en`, and `other languages`.
- `other languages` opens a dynamic submenu based on locale folder names and includes `go back`.
- Uses `en` as fallback reference locale when interactive selection is not available.
- Adds missing keys to all other locales with placeholder value `TO BE TRANSLATED`.
- Sorts keys alphabetically in every processed JSON file.
- Supports dry run mode.
- Can run as Node script or as standalone Windows executable (`.exe`).

## Folder Contents

- `sync-locales.cjs`: core CLI tool
- `package.json`: scripts for run and build
- `run-sync-locales.bat`: Windows launcher (prefers `.exe`, falls back to Node)
- `tools/SyncLocales.exe`: generated binary after build (not committed by default)

## Requirements

For script mode:

- Node.js 18+
- pnpm (only for the included scripts)

For exe mode:

- Windows x64
- No Node.js required

## Quick Start (Script Mode)

```powershell
pnpm run sync:dry
pnpm run sync
```

## Build and Run EXE

```powershell
pnpm run build:exe
pnpm run exe:sync:dry
pnpm run exe:sync
```

Or use the batch launcher:

```powershell
.\run-sync-locales.bat --dry-run
.\run-sync-locales.bat
```

## Usage Options

```text
--dry-run            Show what would change without writing files
--base=<path>        Explicit locales folder path
--refs=en,fr         Override reference locales (skips interactive picker)
--placeholder=<txt>  Placeholder for missing translations
--sort-refs          Also process reference locales (default: true)
--no-sort-refs       Skip processing reference locales
--pause              Wait for Enter before closing
--no-pause           Do not wait before exit
```

## Default Locales Path

The tool auto-detects `public/i18n/locales` by walking up from:

1. Current working directory
2. Executable directory
3. Script directory

If auto-detection fails, pass `--base`.

## Using This In Another Project

1. Copy this entire `locale-sync-tool` folder into your target project.
2. Open a terminal in that folder.
3. Run script mode or build exe mode.
4. If needed, provide `--base` to your project's locales path.

Example:

```powershell
.\tools\SyncLocales.exe --base="D:\my-app\public\i18n\locales"
```
