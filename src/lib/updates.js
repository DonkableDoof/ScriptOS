import { useEffect, useState } from "react";
import { isNative } from "./native";
import { flushAll } from "./storage";

// Watching GitHub for new versions. The app's own updater handles installing: it fetches
// latest.json from the newest release, and only installs what's signed with the release
// key, so nothing else can pretend to be an update. If a release can't be installed that
// way the home page just says so and links to it.
const REPO = "DonkableDoof/ScriptOS";
export const RELEASES_URL = `https://github.com/${REPO}/releases/latest`;
const EVERY = 30 * 60 * 1000;

let state = { status: "idle", version: null, notes: "", progress: 0, error: "", installable: false, failed: false };
const listeners = new Set();
const publish = (next) => {
  state = { ...state, ...next };
  listeners.forEach((fn) => fn(state));
};

const newer = (a, b) => {
  const parse = (v) => String(v).replace(/^v/, "").split(".").map((n) => parseInt(n, 10) || 0);
  const x = parse(a);
  const y = parse(b);
  for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
  return false;
};

let update = null;

// Offline, or a release without an update file, is not an error: there's just nothing
// to install right now.
async function check() {
  if (state.status === "installing") return;
  try {
    const { check: findUpdate } = await import("@tauri-apps/plugin-updater");
    const found = await findUpdate({ timeout: 15000 });
    if (found) {
      update = found;
      // each check that finds it asks again, so a failed install isn't the end of it
      publish({ status: "available", installable: true, version: found.version, notes: found.body || "", error: "", failed: false });
      return;
    }
    update = null;
  } catch {
    update = null;
  }
  // nothing the updater can install: is there a newer release to at least mention?
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { Accept: "application/vnd.github+json" } });
    if (res.ok) {
      const latest = await res.json();
      if (latest?.tag_name && newer(latest.tag_name, __APP_VERSION__)) {
        publish({ status: "available", installable: false, version: String(latest.tag_name).replace(/^v/, ""), notes: "" });
        return;
      }
    }
  } catch {
    /* offline */
  }
  if (state.status === "available") publish({ status: "idle", version: null, installable: false });
}

// Downloads and installs, then restarts into the new version. Everything is saved first:
// on Windows the installer closes the app itself.
export async function installUpdate() {
  if (!update || state.status === "installing") return;
  publish({ status: "installing", progress: 0, error: "", failed: false });
  try {
    await flushAll();
    let total = 0;
    let done = 0;
    await update.downloadAndInstall((event) => {
      if (event.event === "Started") total = event.data.contentLength || 0;
      else if (event.event === "Progress") {
        done += event.data.chunkLength;
        if (total) publish({ progress: Math.min(99, Math.round((done / total) * 100)) });
      }
    });
    if (update.fake) return;
    const { relaunch } = await import("@tauri-apps/plugin-process");
    await relaunch();
  } catch (err) {
    publish({ status: "available", error: String(err?.message || err), failed: true });
  }
}

// Leaving instead of updating. Everything is saved first.
export async function exitApp() {
  await flushAll();
  if (isNative()) {
    const { exit } = await import("@tauri-apps/plugin-process");
    await exit(0);
  } else {
    window.close();
  }
}

let started = false;
function start() {
  if (started) return;
  started = true;
  if (import.meta.env.DEV) {
    // the dev window never updates itself; this lets the screens be tried
    const fake = localStorage.getItem("scriptosFakeUpdate");
    if (fake) {
      update = {
        fake: true,
        version: fake,
        downloadAndInstall: async (cb) => {
          cb({ event: "Started", data: { contentLength: 100 } });
          for (let i = 0; i < 10; i++) {
            await new Promise((r) => setTimeout(r, 120));
            cb({ event: "Progress", data: { chunkLength: 10 } });
          }
          if (localStorage.getItem("scriptosFakeUpdateFails")) throw new Error("The download was interrupted.");
          publish({ status: "idle", version: null, installable: false, failed: false });
          localStorage.removeItem("scriptosFakeUpdate");
        },
      };
      if (localStorage.getItem("scriptosFakeUpdateByHand")) update = null;
      publish({ status: "available", installable: !localStorage.getItem("scriptosFakeUpdateByHand"), version: fake, notes: "A test release." });
    }
    return;
  }
  if (!isNative()) return;
  check();
  setInterval(check, EVERY);
}

export function useUpdate() {
  const [value, setValue] = useState(state);
  useEffect(() => {
    listeners.add(setValue);
    setValue(state);
    start();
    return () => listeners.delete(setValue);
  }, []);
  return value;
}
