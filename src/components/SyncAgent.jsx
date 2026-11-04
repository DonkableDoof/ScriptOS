import { useEffect, useRef } from "react";
import { useStore } from "../lib/store";
import { SYNC_NOW, setSyncStatus, syncRound } from "../lib/cloud";
import { backend, useAccount } from "../lib/share";
import { deviceName } from "../lib/native";
import { shrinkItemIcons } from "../lib/image";
import { notify } from "../lib/notice";

const EVERY = 60000;
export const SYNC_RELINK = "scriptos:sync-relink";

const newId = () => Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 8);

// Keeps this device in step with your account while you're signed in: on start, whenever
// the window comes back to the front, every minute while it's there, and a few seconds
// after a change to something uploaded. Signed out, it does nothing at all, and writing in
// a script you haven't uploaded never contacts the server.
export default function SyncAgent() {
  const store = useStore();
  const storeRef = useRef(store);
  storeRef.current = store;
  const { user } = useAccount();
  const userId = user?.id;
  const { device } = store;

  // every device needs a lasting id and a name, chosen the first time it signs in
  useEffect(() => {
    if (!userId || device?.id) return;
    deviceName().then((name) => storeRef.current.setDevice({ id: newId(), name: name || "This device" }));
  }, [userId, device?.id]);

  useEffect(() => {
    if (!userId || !device?.id) {
      setSyncStatus({ state: "off", error: null, devices: [], role: null, removed: false });
      return;
    }
    let alive = true;
    let busy = false;
    let again = false;
    let relink = false;

    const round = async () => {
      if (busy) {
        again = true;
        return;
      }
      busy = true;
      setSyncStatus({ state: "syncing" });
      try {
        const api = await backend();
        const s = storeRef.current;
        const remembered = s.cloudState?.userId === userId ? s.cloudState.items : {};
        const seen = new Map([...s.scripts, ...s.scrambles].map((i) => [i.id, i]));
        const result = await syncRound({
          io: {
            list: api.cloudList,
            fetch: api.cloudFetch,
            push: async (id, kind, data, baseRev) => api.cloudPush(id, kind, await shrinkItemIcons(data), baseRev),
            setState: api.cloudSetState,
            checkin: api.deviceCheckin,
            devices: api.devicesList,
          },
          userId,
          device,
          relink,
          local: { scripts: s.scripts, scrambles: s.scrambles, tombstones: s.tombstones, state: remembered, ownActivity: s.ownActivity },
        });
        relink = false;
        if (!alive) return;
        if (result.removed) {
          setSyncStatus({ state: "idle", removed: true, role: result.role, error: null });
          return;
        }
        storeRef.current.applyCloud(userId, result, seen);
        if (result.conflicts.length) {
          notify("Edited on two devices at once", { detail: "Both versions are kept. This device's is saved as a conflict copy on Home." });
        }
        setSyncStatus({ state: "idle", removed: false, error: null, lastSync: Date.now(), role: result.role, devices: result.devices });
      } catch (err) {
        if (alive) setSyncStatus({ state: "error", error: String(err?.message || err) });
      } finally {
        busy = false;
        if (again && alive) {
          again = false;
          round();
        }
      }
    };

    const onRelink = () => {
      relink = true;
      round();
    };

    round();
    const timer = setInterval(() => {
      if (!document.hidden && document.hasFocus()) round();
    }, EVERY);
    window.addEventListener("focus", round);
    window.addEventListener(SYNC_NOW, round);
    window.addEventListener(SYNC_RELINK, onRelink);
    return () => {
      alive = false;
      clearInterval(timer);
      window.removeEventListener("focus", round);
      window.removeEventListener(SYNC_NOW, round);
      window.removeEventListener(SYNC_RELINK, onRelink);
    };
  }, [userId, device?.id, device?.name]);

  // a change to something uploaded goes up a moment after you stop typing
  const uploaded = useRef(null);
  const buried = useRef(store.tombstones);
  const soon = useRef(null);
  useEffect(() => {
    if (!userId) return;
    const now = [...store.scripts, ...store.scrambles].filter((i) => i.cloud && i.cloudOwner === userId);
    const was = uploaded.current;
    const same = !was || (was.length === now.length && now.every((item, i) => item === was[i]));
    const sameBuried = buried.current === store.tombstones;
    uploaded.current = now;
    buried.current = store.tombstones;
    if (same && sameBuried) return;
    clearTimeout(soon.current);
    soon.current = setTimeout(() => window.dispatchEvent(new Event(SYNC_NOW)), 3000);
  }, [userId, store.scripts, store.scrambles, store.tombstones]);
  useEffect(() => () => clearTimeout(soon.current), []);

  return null;
}
