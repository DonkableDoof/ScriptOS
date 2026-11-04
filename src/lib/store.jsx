import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { usePersistentState, boot, uid } from "./storage";
import { DEFAULT_SETTINGS } from "./theme";
import { newScript, newScramble, totalsOf, needsMigration, migrateScript } from "./script";
import { addActivity, mergeActivity } from "./activity";
import { asLocal, asUploaded } from "./cloud";

const StoreContext = createContext(null);

// Nothing renders until the database has been read. Mounting with empty lists and
// hydrating afterwards would let the first save overwrite real work with nothing.
export function StoreProvider({ children }) {
  const [loaded, setLoaded] = useState(null);

  useEffect(() => {
    let alive = true;
    boot().then(
      (data) => alive && setLoaded({ data }),
      (err) => alive && setLoaded({ data: {}, error: err?.message || String(err) })
    );
    return () => {
      alive = false;
    };
  }, []);

  if (!loaded) return <div className="boot" />;
  if (loaded.error) {
    return (
      <div className="boot boot-failed">
        <h1>ScriptOS could not open its database</h1>
        <p>{loaded.error}</p>
        <p>Nothing has been changed on disk. Close the app and reopen it.</p>
      </div>
    );
  }
  return <Store snapshot={loaded.data}>{children}</Store>;
}

function Store({ snapshot, children }) {
  const [scripts, setScripts] = usePersistentState("scripts", [], snapshot);
  const [scrambles, setScrambles] = usePersistentState("scrambles", [], snapshot);
  const [activity, setActivity] = usePersistentState("activity", {}, snapshot);
  const [settings, setSettings] = usePersistentState("settings", DEFAULT_SETTINGS, snapshot);
  // Sync (lib/cloud.js): this device's own id and name, never synced or backed up; what
  // it last synced; what was deleted, so that reaches the other devices; and their writing
  // stats, kept apart so nothing is counted twice.
  const [device, setDevice] = usePersistentState("device", null, snapshot);
  const [tombstones, setTombstones] = usePersistentState("tombstones", {}, snapshot);
  const [remoteActivity, setRemoteActivity] = usePersistentState("remoteActivity", {}, snapshot);
  const [cloudState, setCloudState] = usePersistentState("cloudState", { userId: null, items: {} }, snapshot);

  // Edits arrive once per keystroke; the word delta is worked out against the
  // latest list here rather than inside a state updater, which StrictMode runs twice.
  const scriptsRef = useRef(scripts);
  scriptsRef.current = scripts;
  const scramblesRef = useRef(scrambles);
  scramblesRef.current = scrambles;

  // One-off upgrades for data saved by older versions.
  useEffect(() => {
    if ((settings.v || 1) < 2) {
      // 1.0 shipped with a 500-word goal switched on; the goal is opt-in now
      setSettings((prev) => ({ ...prev, v: 2, dailyGoal: prev.dailyGoal === 500 ? 0 : prev.dailyGoal ?? 0 }));
    }
    if (scripts.some(needsMigration)) setScripts((list) => list.map(migrateScript));
  }, []);

  const mergedActivity = useMemo(() => mergeActivity(activity, remoteActivity), [activity, remoteActivity]);

  const value = useMemo(() => {
    const patchScript = (id, changes) =>
      setScripts((list) => list.map((s) => (s.id === id ? { ...s, ...changes, updatedAt: Date.now() } : s)));

    const patchScramble = (id, changes) =>
      setScrambles((list) => list.map((s) => (s.id === id ? { ...s, ...changes, updatedAt: Date.now() } : s)));

    // Words written anywhere count towards the stats, scrambles included.
    const record = (beforeBlocks, afterBlocks) => {
      const before = totalsOf(beforeBlocks);
      const after = totalsOf(afterBlocks);
      const dw = after.words - before.words;
      const dl = after.lines - before.lines;
      if (dw || dl) setActivity((a) => addActivity(a, dw, dl));
    };

    const bury = (id) => setTombstones((t) => ({ ...t, [id]: Date.now() }));

    return {
      scripts,
      scrambles,
      // what the stats show: this device's writing plus every linked device's
      activity: mergedActivity,
      ownActivity: activity,
      device,
      tombstones,
      remoteActivity,
      setDevice,
      cloudState,
      // What a sync round worked out. It keeps its own timestamps and isn't counted as
      // writing done here. `seen` is what the round started from: anything edited while it
      // was running is left alone, and the next round sorts it out.
      applyCloud: (userId, r, seen) => {
        const items = { ...r.state };
        const merge = (kind, list) => {
          let next = list;
          for (const x of r.removes) if (x.kind === kind) next = next.filter((i) => i.id !== x.id);
          for (const x of r.localize) if (x.kind === kind) next = next.map((i) => (i.id === x.id ? asLocal(i) : i));
          for (const x of r.upserts) {
            if (x.kind !== kind) continue;
            // from a device that hasn't updated yet, this may still be in an old shape
            if (kind === "script") x.item = migrateScript(x.item);
            const cur = next.find((i) => i.id === x.item.id);
            if (cur && seen && cur !== seen.get(cur.id)) {
              delete items[cur.id];
              continue;
            }
            next = cur ? next.map((i) => (i.id === x.item.id ? x.item : i)) : [x.item, ...next];
          }
          for (const x of r.conflicts) if (x.kind === kind) next = [x.item, ...next];
          return next;
        };
        const nextScripts = merge("script", scriptsRef.current);
        const nextScrambles = merge("scramble", scramblesRef.current);
        if (nextScripts !== scriptsRef.current) {
          scriptsRef.current = nextScripts;
          setScripts(nextScripts);
        }
        if (nextScrambles !== scramblesRef.current) {
          scramblesRef.current = nextScrambles;
          setScrambles(nextScrambles);
        }
        if (r.buried.length) {
          setTombstones((t) => {
            const rest = { ...t };
            for (const id of r.buried) delete rest[id];
            return rest;
          });
        }
        setCloudState({ userId, items });
        setRemoteActivity(r.remoteActivity);
      },
      // Uploading doesn't count as editing, so these leave updatedAt alone.
      markUploaded: (kind, id, userId) => {
        const mark = (list) => list.map((i) => (i.id === id ? asUploaded(i, userId) : i));
        if (kind === "script") setScripts(mark);
        else setScrambles(mark);
      },
      markLocal: (kind, id) => {
        const mark = (list) => list.map((i) => (i.id === id ? asLocal(i) : i));
        if (kind === "script") setScripts(mark);
        else setScrambles(mark);
        setCloudState((c) => {
          const items = { ...c.items };
          delete items[id];
          return { ...c, items };
        });
      },
      settings: { ...DEFAULT_SETTINGS, ...settings },
      updateSettings: (changes) => setSettings((prev) => ({ ...DEFAULT_SETTINGS, ...prev, ...changes })),

      addScript: (fields) => {
        const script = newScript(fields);
        setScripts((list) => [script, ...list]);
        return script;
      },
      updateScript: patchScript,

      // The editor's way in: the only path that counts towards writing stats.
      updateBlocks: (id, blocks) => {
        const current = scriptsRef.current.find((s) => s.id === id);
        if (!current) return;
        scriptsRef.current = scriptsRef.current.map((s) => (s.id === id ? { ...s, blocks } : s));
        patchScript(id, { blocks });
        record(current.blocks, blocks);
      },

      // Scrambles: quick notes and rough outlines, kept apart from scripts.
      addScramble: (fields) => {
        const scramble = newScramble(fields);
        setScrambles((list) => [scramble, ...list]);
        return scramble;
      },
      updateScramble: patchScramble,
      updateScrambleBlocks: (id, blocks) => {
        const current = scramblesRef.current.find((s) => s.id === id);
        if (!current) return;
        scramblesRef.current = scramblesRef.current.map((s) => (s.id === id ? { ...s, blocks } : s));
        patchScramble(id, { blocks });
        record(current.blocks, blocks);
      },
      deleteScramble: (id) => {
        setScrambles((list) => list.filter((s) => s.id !== id));
        bury(id);
      },

      duplicateScript: (id) => {
        const source = scriptsRef.current.find((s) => s.id === id);
        if (!source) return null;
        const now = Date.now();
        const copy = {
          ...source,
          // a copy isn't shared, and the comments belong to the original
          share: null,
          comments: [],
          suggestions: [],
          reviewers: {},
          cloud: undefined,
          cloudOwner: undefined,
          id: uid(),
          title: `${source.title} (Copy)`,
          blocks: source.blocks.map((b) => ({ ...b, id: uid() })),
          createdAt: now,
          updatedAt: now,
        };
        setScripts((list) => [copy, ...list]);
        return copy;
      },
      deleteScript: (id) => {
        setScripts((list) => list.filter((s) => s.id !== id));
        bury(id);
      },
    };
  }, [scripts, scrambles, activity, mergedActivity, settings, device, tombstones, remoteActivity, cloudState]);

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export const useStore = () => useContext(StoreContext);
