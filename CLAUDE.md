# ScriptOS

Tauri 2 + React 18 + Vite desktop app, built the same way as ContentOS (`E:\Apps\ContentOS\contentos`).
Data lives in IndexedDB (`src/lib/storage.js`), keyed `scripts`, `activity`, `settings`.

## Versioning — every change bumps the version

- Tweaks and fixes: bump the patch (1.0.0 → 1.0.1).
- New features / big updates: bump the minor (1.0.x → 1.1.0); huge overhauls bump the major.
- `package.json` is the source of truth (Tauri reads it via `"version": "../package.json"`).
  Also keep `src-tauri/Cargo.toml` `version` in step. `npm version patch --no-git-tag-version`
  updates package.json and package-lock.json together.

## Sync

Scripts and scrambles a user uploads live in `cloud_items`, per account; nothing else leaves
the device. `src/lib/cloud.js` holds the round (revision numbers tell a device who moved; both
moved means a conflict copy, never lost work) and `components/SyncAgent.jsx` runs it while
signed in. `sync_devices` holds one Host and any Links. The `device` and `cloudState` keys are
per-machine and are never synced or backed up.

## Releases and updates

The app updates itself from GitHub releases and installs automatically when it can
(`src/lib/updates.js`, `components/UpdateGate.jsx`). To release: bump the version, run
`npm run app:release` in a terminal (it asks for the signing key's password, signs the build
and writes `latest.json`), then attach the installer, its `.sig` file and `latest.json` from
`src-tauri/target/release/bundle/nsis/` to a `v<version>` release. The private key must never be committed.

## Share

`src/lib/share.js` (logic), `shareBackend.js` (the sole Supabase code, lazily loaded, also
used by sync), `sanitize.js`, `suggest.js` (working out and applying edits). A share is one row
in `shares` holding the script, cover and icons; members, comments and suggestions cascade from
it, so deleting the row removes everything. Comments and suggestions are saved onto the script
as they arrive (`script.comments`, `script.suggestions`, `script.reviewers`). Everything from the server is someone else's content: it goes through
`sanitize.js` before reaching the page, and comments and names render as plain text only.
`supabase/schema.sql` holds the database; re-run it in Supabase after changing it, and run
`npm run test:db` first, which checks every access rule against a real Postgres. On the dev
server, `localStorage.scriptosFakeShare = "1"` swaps in `src/dev/fakeShare.js`, an in-browser
stand-in for trying the screens as several people. The publishable key in `shareConfig.js` is
public by design; the secret key never goes in the app.

## Dev template

`src/dev/templateScript.js` builds a script showing every element and kind of formatting,
each introduced by a note. While running from the dev server, Home → Import → Formatting
Template adds it (it isn't in release builds). Update it when adding element types or
formatting; it adds a warning note listing any element type it doesn't show.

## Commands

- Dev window: `npm run app` (VS Code F5 runs the same thing)
- Browser-only dev server: `npm run dev` (port 1440)
- Installer build: `npm run app:release` (signed; asks for the password) — don't run unless asked.
  Plain `npm run app:build` stops with an error at the signing step without the key set.
