// ---------------------------------------------------------------------------
// Sync through your account. A script or scramble you upload lives in `cloud_items`,
// and any device signed in to the account keeps a copy. What you haven't uploaded never
// leaves the device.
//
// Every uploaded item has a revision number on the server. A device remembers the
// revision and contents it last synced, so it can tell the three cases apart: only the
// server moved (take it), only this device moved (send it), or both did. In that last
// case nothing is lost: the server's version comes in and this device's edits are kept
// beside it as a local copy.
//
// Server access comes in as `io` so all of this can be exercised without a server:
//   list() → [{ id, kind, rev, state }]    fetch(ids) → [{ id, kind, rev, data }]
//   push(id, kind, data, baseRev) → { rev } | { conflict }    setState(id, state)
//   checkin(deviceId, name, activity, relink) → { role } | { removed }    devices() → rows
// ---------------------------------------------------------------------------

const uid = () => Math.random().toString(36).slice(2, 10);

// A fingerprint that ignores key order: the server's JSON comes back sorted differently
// from how it went up. Objects never change once made, so each is only hashed once.
const canonical = (value) => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .filter((k) => value[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
};

const keys = new WeakMap();
export const itemKey = (item) => {
  let key = keys.get(item);
  if (!key) {
    const text = canonical(item);
    let h = 5381;
    for (let i = 0; i < text.length; i++) h = ((h * 33) ^ text.charCodeAt(i)) >>> 0;
    key = `${text.length}:${h}`;
    keys.set(item, key);
  }
  return key;
};

// Marks an item as belonging to an account, or takes that off.
export const asUploaded = (item, userId) => ({ ...item, cloud: true, cloudOwner: userId });
export const asLocal = ({ cloud, cloudOwner, ...item }) => item;

// `local` is { scripts, scrambles, tombstones, state, ownActivity }; `state` is this
// device's memory of { itemId: { rev, key } }. Nothing here touches the store: it returns
// what should change, and the caller applies it.
export async function syncRound({ io, userId, device, local, relink = false }) {
  const check = await io.checkin(device.id, device.name, local.ownActivity, relink);
  if (check.removed) return { removed: true, role: check.role };

  const mine = new Map();
  const add = (kind) => (item) => {
    if (item.cloud && item.cloudOwner === userId) mine.set(item.id, { kind, item });
  };
  local.scripts.forEach(add("script"));
  local.scrambles.forEach(add("scramble"));
  const anywhere = new Map([...local.scripts.map((i) => [i.id, i]), ...local.scrambles.map((i) => [i.id, i])]);

  const state = { ...local.state };
  const upserts = [];
  const removes = [];
  const localize = [];
  const conflicts = [];
  const buried = [];
  const skip = new Set();

  const remote = await io.list();
  const byId = new Map(remote.map((r) => [r.id, r]));

  // deleted here, maybe while offline: tell the server now
  for (const id of Object.keys(local.tombstones || {})) {
    const r = byId.get(id);
    if (r?.state === "live") {
      await io.setState(id, "deleted");
      r.state = "deleted";
      r.rev += 1;
    }
    buried.push(id);
    skip.add(id);
    delete state[id];
  }

  const want = [];
  for (const r of remote) {
    if (skip.has(r.id)) continue;
    const entry = mine.get(r.id);
    if (r.state !== "live") {
      // gone from the account. Deleted elsewhere removes it here too, unless it has edits
      // nobody else has seen, which are kept as a local copy rather than thrown away.
      if (entry) {
        const st = state[r.id];
        const edited = !st || st.key !== itemKey(entry.item);
        if (r.state === "local" || edited) localize.push({ kind: entry.kind, id: r.id });
        else removes.push({ kind: entry.kind, id: r.id });
        skip.add(r.id);
      }
      delete state[r.id];
      continue;
    }
    if (state[r.id]?.rev === r.rev) continue;
    want.push(r);
  }

  if (want.length) {
    for (const f of await io.fetch(want.map((r) => r.id))) {
      const incoming = asUploaded(f.data, userId);
      const key = itemKey(incoming);
      const st = state[f.id];
      const here = mine.get(f.id);
      if (!here) {
        // new to this device, or on it only as a local copy that isn't ours to overwrite
        if (!anywhere.has(f.id) || !anywhere.get(f.id).cloud) upserts.push({ kind: f.kind, item: incoming });
        state[f.id] = { rev: f.rev, key };
        continue;
      }
      const hereKey = itemKey(here.item);
      if (hereKey === key) {
        state[f.id] = { rev: f.rev, key };
        continue;
      }
      if (!st) {
        // both sides have it and this device has no memory of it: newest edit wins
        if ((here.item.updatedAt || 0) > (incoming.updatedAt || 0)) {
          state[f.id] = { rev: f.rev, key: "" }; // sent below
        } else {
          upserts.push({ kind: f.kind, item: incoming });
          state[f.id] = { rev: f.rev, key };
          skip.add(f.id);
        }
        continue;
      }
      // edited on both sides since this device last synced: keep both
      if (hereKey !== st.key) {
        conflicts.push({
          kind: here.kind,
          item: { ...asLocal(here.item), id: uid(), title: `${here.item.title || "Untitled"} (conflict copy from ${device.name})`, share: null },
        });
      }
      upserts.push({ kind: f.kind, item: incoming });
      state[f.id] = { rev: f.rev, key };
      skip.add(f.id);
    }
  }

  for (const [id, { kind, item }] of mine) {
    if (skip.has(id)) continue;
    const key = itemKey(item);
    const st = state[id];
    if (st?.key === key) continue;
    const res = await io.push(id, kind, item, st?.rev || 0);
    // someone else got in first: the next round brings theirs in and sorts it out
    if (!res.conflict) state[id] = { rev: res.rev, key };
  }

  const rows = await io.devices();
  const devices = rows
    .filter((d) => !d.removed)
    .map((d) => ({ id: d.id, name: d.name, role: d.role, seen: Date.parse(d.last_seen) || null, self: d.id === device.id }));
  const remoteActivity = Object.fromEntries(rows.filter((d) => d.id !== device.id).map((d) => [d.id, d.activity || {}]));

  return { role: check.role, state, upserts, removes, localize, conflicts, buried, devices, remoteActivity };
}

// ---------------------------------------------------------------------------
// Status, for the settings page and the home page chip
// ---------------------------------------------------------------------------
export const SYNC_NOW = "scriptos:sync-now";
let status = { state: "off" };
const listeners = new Set();
export const setSyncStatus = (next) => {
  status = { ...status, ...next };
  listeners.forEach((fn) => fn(status));
};
export const onSyncStatus = (fn) => {
  listeners.add(fn);
  fn(status);
  return () => listeners.delete(fn);
};
export const syncNow = () => window.dispatchEvent(new Event(SYNC_NOW));
