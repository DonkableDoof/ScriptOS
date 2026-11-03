import { useEffect, useRef, useState } from "react";

// Everything lives in IndexedDB rather than localStorage: covers are images, and
// localStorage caps an origin at ~10 MB and throws once you cross it.
const DB_NAME = "scriptos";
const STORE = "state";

let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    const fail = (err) => {
      // Let a later attempt try again rather than cache the failure for good.
      dbPromise = null;
      reject(err);
    };
    req.onerror = () => fail(req.error || new Error("Could not open the ScriptOS database."));
    req.onblocked = () => fail(new Error("Another ScriptOS window is holding the database open."));
  });
  return dbPromise;
}

export async function readAll() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const out = {};
    const req = tx.objectStore(STORE).openCursor();
    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor) return resolve(out);
      out[cursor.key] = cursor.value;
      cursor.continue();
    };
    req.onerror = () => reject(req.error);
  });
}

// A transaction that neither completes nor errors would stall the queue forever and
// quietly stop saving. The timeout turns that into an ordinary, retried failure.
const WRITE_TIMEOUT = 10000;

export async function writeMany(entries) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    const guard = setTimeout(
      () => reject(new Error("The save did not finish in time.")),
      WRITE_TIMEOUT
    );
    const finish = (fn) => (arg) => {
      clearTimeout(guard);
      fn(arg);
    };
    for (const [key, value] of entries) store.put(value, key);
    tx.oncomplete = finish(resolve);
    tx.onerror = finish(() => reject(tx.error));
    tx.onabort = finish(() => reject(tx.error || new Error("The save was aborted.")));
  });
}

export async function replaceAll(map) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    store.clear();
    for (const [key, value] of Object.entries(map)) store.put(value, key);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error("The import was aborted."));
  });
}

export const boot = () => readAll();

// ---------------------------------------------------------------------------
// Write queue. Writes are coalesced per key and retried, and a failure is reported
// instead of being swallowed — a save that silently does nothing is how work vanishes.
// ---------------------------------------------------------------------------
const pending = new Map();
const listeners = new Set();
let timer = null;
let inFlight = null;
let status = { saving: false, error: null, savedAt: null };

function emit(next) {
  status = { ...status, ...next };
  for (const fn of listeners) fn(status);
}

export function onSaveStatus(fn) {
  listeners.add(fn);
  fn(status);
  return () => listeners.delete(fn);
}

export function queueWrite(key, value) {
  pending.set(key, value);
  if (!status.saving) emit({ saving: true });
  clearTimeout(timer);
  timer = setTimeout(flush, 300);
}

export function flush() {
  clearTimeout(timer);
  timer = null;
  if (!pending.size || inFlight) return inFlight || Promise.resolve();
  const batch = [...pending.entries()];
  pending.clear();
  inFlight = writeMany(batch)
    .then(() => {
      emit({ saving: pending.size > 0, error: null, savedAt: Date.now() });
    })
    .catch((err) => {
      // put the work back so the next flush retries it rather than dropping it
      for (const [key, value] of batch) if (!pending.has(key)) pending.set(key, value);
      emit({ saving: true, error: err?.message || String(err) });
      clearTimeout(timer);
      timer = setTimeout(flush, 4000);
    })
    .finally(() => {
      inFlight = null;
      if (pending.size && !timer) timer = setTimeout(flush, 300);
    });
  return inFlight;
}

// Draining means going round until the queue is genuinely empty, which is what
// closing the app has to wait for.
export async function flushAll() {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    if (inFlight) {
      await inFlight.catch(() => {});
      continue;
    }
    if (!pending.size) return true;
    await flush().catch(() => {});
  }
  return pending.size === 0;
}

// The safety net under the debounce: a steady sweep that picks up anything still
// waiting. It does nothing at all when the queue is empty.
const HEARTBEAT = 3000;
const STALE_AFTER = 15000;
let pendingSince = 0;

if (typeof window !== "undefined") {
  setInterval(() => {
    if (!pending.size) {
      pendingSince = 0;
      return;
    }
    if (!pendingSince) pendingSince = Date.now();
    if (!inFlight) flush();
    if (!status.error && Date.now() - pendingSince > STALE_AFTER) {
      emit({ error: "Changes have been waiting to save for a while." });
    }
  }, HEARTBEAT);

  const urgent = () => {
    if (pending.size) flush();
  };
  window.addEventListener("pagehide", urgent);
  window.addEventListener("beforeunload", urgent);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") urgent();
  });
}

export function usePersistentState(key, initial, snapshot) {
  const [value, setValue] = useState(() =>
    snapshot && snapshot[key] !== undefined ? snapshot[key] : initial
  );
  const loaded = useRef(false);

  useEffect(() => {
    // the first run is just the value we read back out of the database
    if (!loaded.current) {
      loaded.current = true;
      return;
    }
    queueWrite(key, value);
  }, [key, value]);

  return [value, setValue];
}

export const uid = () => Math.random().toString(36).slice(2, 10);
