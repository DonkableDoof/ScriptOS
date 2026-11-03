# ScriptOS

Tauri 2 + React 18 + Vite desktop app, built the same way as ContentOS (`E:\Apps\ContentOS\contentos`).
Data lives in IndexedDB (`src/lib/storage.js`), keyed `scripts`, `activity`, `settings`.

## Versioning — every change bumps the version

- Tweaks and fixes: bump the patch (1.0.0 → 1.0.1).
- New features / big updates: bump the minor (1.0.x → 1.1.0); huge overhauls bump the major.
- `package.json` is the source of truth (Tauri reads it via `"version": "../package.json"`).
  Also keep `src-tauri/Cargo.toml` `version` in step. `npm version patch --no-git-tag-version`
  updates package.json and package-lock.json together.

## Commands

- Dev window: `npm run app` (VS Code F5 runs the same thing)
- Browser-only dev server: `npm run dev` (port 1440)
- Installer build: `npm run app:build` — don't run unless asked.
