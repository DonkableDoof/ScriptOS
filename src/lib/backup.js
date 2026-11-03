import { readAll, replaceAll, flushAll } from "./storage";
import { saveTextFile } from "./native";

const KEYS = ["scripts", "activity", "settings"];

export async function storageUsage() {
  const data = await readAll();
  const used = KEYS.reduce((sum, key) => {
    const value = data[key];
    return sum + (value === undefined ? 0 : JSON.stringify(value).length);
  }, 0);
  let quota = 0;
  try {
    quota = (await navigator.storage?.estimate?.())?.quota || 0;
  } catch {}
  return { used, quota };
}

// Ask the browser not to evict us under disk pressure.
export async function requestPersistence() {
  try {
    if (await navigator.storage?.persisted?.()) return true;
    return Boolean(await navigator.storage?.persist?.());
  } catch {
    return false;
  }
}

export async function exportBackup() {
  await flushAll();
  const stored = await readAll();
  const data = {};
  for (const key of KEYS) if (stored[key] !== undefined) data[key] = stored[key];
  const payload = JSON.stringify(
    { app: "ScriptOS", version: 1, appVersion: __APP_VERSION__, exportedAt: new Date().toISOString(), data },
    null,
    2
  );
  return saveTextFile(`scriptos-backup-${new Date().toISOString().slice(0, 10)}.json`, payload, {
    label: "ScriptOS backup",
    extensions: ["json"],
  });
}

export function readBackup(text) {
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error("That file is not valid JSON.");
  }
  if (!payload || payload.app !== "ScriptOS" || typeof payload.data !== "object") {
    throw new Error("That file is not a ScriptOS backup.");
  }
  return payload;
}

export async function restoreBackup(payload) {
  const next = {};
  for (const key of KEYS) if (payload.data[key] !== undefined) next[key] = payload.data[key];
  await replaceAll(next);
}

export const formatBytes = (bytes) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
};
