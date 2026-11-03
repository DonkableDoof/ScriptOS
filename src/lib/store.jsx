import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { usePersistentState, boot, uid } from "./storage";
import { DEFAULT_SETTINGS } from "./theme";
import { newScript, newScramble, totalsOf, needsMigration, migrateScript } from "./script";
import { addActivity } from "./activity";

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

    return {
      scripts,
      scrambles,
      activity,
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
      deleteScramble: (id) => setScrambles((list) => list.filter((s) => s.id !== id)),

      duplicateScript: (id) => {
        const source = scriptsRef.current.find((s) => s.id === id);
        if (!source) return null;
        const now = Date.now();
        const copy = {
          ...source,
          id: uid(),
          title: `${source.title} (Copy)`,
          blocks: source.blocks.map((b) => ({ ...b, id: uid() })),
          createdAt: now,
          updatedAt: now,
        };
        setScripts((list) => [copy, ...list]);
        return copy;
      },
      deleteScript: (id) => setScripts((list) => list.filter((s) => s.id !== id)),
    };
  }, [scripts, scrambles, activity, settings, setScripts, setScrambles, setActivity, setSettings]);

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export const useStore = () => useContext(StoreContext);
