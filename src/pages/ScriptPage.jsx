import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ScriptEditor from "../components/ScriptEditor";
import ScriptDetails from "../components/ScriptDetails";
import PrintView from "../components/PrintView";
import Popover from "../components/Popover";
import { useStore } from "../lib/store";
import { TYPE_BY_KEY, scriptStats, formatPages, formatRuntime, isTv, characterName, blockMetrics } from "../lib/script";
import { nextCastColor } from "../lib/colors";
import Swatches from "../components/Swatches";
import { toFountain, toPlainText, fileNameFor } from "../lib/fountain";
import { saveTextFile } from "../lib/native";
import { dayKey } from "../lib/activity";
import { notify } from "../lib/notice";
import { useDocZoom } from "../lib/useDocZoom";

// The everyday elements get a button; the rest live in the slash menu and hotkeys.
const BAR = ["act", "scene", "action", "character", "parenthetical", "dialogue", "subtext", "transition", "shot", "note", "heading", "sequence", "beat", "centered", "lyrics"];

export default function ScriptPage({ scriptId, navigate }) {
  const store = useStore();
  const { settings, activity } = store;
  const script = store.scripts.find((s) => s.id === scriptId);
  const editorRef = useRef(null);
  const exportRef = useRef(null);
  const [activeId, setActiveId] = useState(null);
  const [jump, setJump] = useState(null);
  const [details, setDetails] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [sidebar, setSidebar] = useState(true);
  const [castMenu, setCastMenu] = useState(null);
  const castRefs = useRef({});

  const stats = useMemo(() => (script ? scriptStats(script) : null), [script]);
  const onChange = useCallback((blocks) => store.updateBlocks(scriptId, blocks), [store.updateBlocks, scriptId]);

  // The script's characters are whoever has a cue line in it. The name in the line
  // being typed doesn't count until it's finished, so "M", "MA", "MAR" never show
  // up on their way to "MARA".
  const cast = script?.cast || {};
  const blocks = script?.blocks || [];
  const typing = blocks.find((b) => b.id === activeId && b.type === "character");
  const characters = useMemo(() => {
    const cues = {};
    for (const b of blocks) {
      if (b.type !== "character") continue;
      const name = characterName(blockMetrics(b).text);
      if (name) cues[name] = (cues[name] || 0) + (b === typing ? 0 : 1);
    }
    const lines = Object.fromEntries((stats?.characters || []).map((c) => [c.name, c.lines]));
    return Object.keys(cues)
      .filter((name) => cues[name] > 0 || lines[name] > 0)
      .map((name) => ({ name, lines: lines[name] || 0 }))
      .sort((a, b) => b.lines - a.lines || a.name.localeCompare(b.name));
  }, [blocks, typing, stats]);

  // Colours belong to characters still in the script: a character who's been cut
  // loses theirs, and with the setting on a new one gets the next free colour.
  const namesKey = characters.map((c) => c.name).join("|");
  useEffect(() => {
    if (!script) return;
    const present = new Set(blocks.filter((b) => b.type === "character").map((b) => characterName(blockMetrics(b).text)));
    const next = {};
    let changed = false;
    for (const [name, entry] of Object.entries(cast)) {
      if (entry?.color && present.has(name)) next[name] = entry;
      else changed = true;
    }
    if (settings.autoCastColors) {
      for (const { name } of characters) {
        if (next[name]) continue;
        next[name] = { color: nextCastColor(Object.values(next).map((c) => c.color)) };
        changed = true;
      }
    }
    if (changed) store.updateScript(scriptId, { cast: next });
  }, [namesKey, settings.autoCastColors]);

  const { zoom, resetZoom } = useDocZoom();

  const setCastColor = (name, color) => {
    const next = { ...cast };
    if (color) next[name] = { color };
    else delete next[name];
    store.updateScript(scriptId, { cast: next });
  };

  // Names to suggest beyond this script's own lines: everyone from the other
  // episodes of the same show.
  const show = script && isTv(script.format) ? script.show?.trim().toLowerCase() : "";
  const known = useMemo(() => {
    const names = new Set();
    if (show) {
      for (const s of store.scripts) {
        if (s.id === scriptId || !isTv(s.format) || s.show?.trim().toLowerCase() !== show) continue;
        for (const b of s.blocks) if (b.type === "character") names.add(characterName(blockMetrics(b).text));
      }
    }
    names.delete("");
    return [...names];
  }, [show, store.scripts, scriptId]);

  if (!script) {
    return (
      <div className="app">
        <div className="empty" style={{ margin: 80 }}>
          <span className="empty-title">This script is gone</span>
          <button className="btn" onClick={() => navigate({ page: "home" })}>
            Back to Scripts
          </button>
        </div>
      </div>
    );
  }

  const activeBlock = script.blocks.find((b) => b.id === activeId);
  const activeType = activeBlock?.type || null;
  const activeIndex = activeBlock ? script.blocks.indexOf(activeBlock) : -1;
  // scenes numbered in order, with the acts they fall under set between them
  const outline = [...stats.scenes.map((s, i) => ({ ...s, n: i + 1 })), ...stats.acts.map((a) => ({ ...a, act: true }))].sort(
    (a, b) => a.index - b.index
  );
  const currentScene = activeIndex >= 0 ? [...stats.scenes].reverse().find((s) => s.index <= activeIndex) : null;
  const today = Math.max(0, activity[dayKey()]?.words || 0);
  const goal = Number(settings.dailyGoal) || 0;
  const exportOptions = { includeNotes: settings.exportNotes, includeSubtext: settings.exportSubtext };

  const doExport = async (kind) => {
    setExportOpen(false);
    try {
      if (kind === "print") {
        // let the menu close before the print dialog takes over the window
        setTimeout(() => window.print(), 50);
        return;
      }
      const saved =
        kind === "fountain"
          ? await saveTextFile(fileNameFor(script, "fountain"), toFountain(script, exportOptions), { label: "Fountain screenplay", extensions: ["fountain"] })
          : await saveTextFile(fileNameFor(script, "txt"), toPlainText(script, exportOptions), { label: "Plain text", extensions: ["txt"] });
      if (saved) notify("Exported", { detail: kind === "fountain" ? "Fountain screenplay" : "Plain text" });
    } catch (err) {
      notify("Export failed", { detail: String(err?.message || err), tone: "bad" });
    }
  };

  return (
    <div className="app script-app">
      <header className="topbar topbar-script">
        <div className="script-head">
          <button className="btn btn-ghost btn-back" onClick={() => navigate({ page: "home" })} title="Back to all scripts">
            ← Scripts
          </button>
          <div className="script-titles">
            <input
              className="title-input"
              value={script.title}
              onChange={(e) => store.updateScript(script.id, { title: e.target.value })}
              onBlur={(e) => !e.target.value.trim() && store.updateScript(script.id, { title: "Untitled Script" })}
              spellCheck={false}
              aria-label="Script title"
            />
          </div>
        </div>
        <div className="topbar-actions">
          <button className="btn btn-ghost" onClick={() => setSidebar((v) => !v)} title="Show or hide the scene list">
            {sidebar ? "Hide Outline" : "Show Outline"}
          </button>
          <button className="btn btn-ghost" onClick={() => setDetails(true)}>
            Details
          </button>
          <button ref={exportRef} className="btn" onClick={() => setExportOpen((v) => !v)}>
            Export ▾
          </button>
          <button className="btn btn-settings" onClick={() => navigate({ page: "settings" })} aria-label="Settings" title="Settings">
            ⚙
          </button>
        </div>
      </header>

      <div className="script-layout" data-sidebar={sidebar}>
        {sidebar && (
          <aside className="sidebar">
            <div className="sidebar-section">
              <div className="sidebar-title">
                Scenes <span>{stats.scenes.length}</span>
              </div>
              <div className="scene-list">
                {outline.map((s) =>
                  s.act ? (
                    <button key={s.id} className="act-item" onClick={() => setJump({ id: s.id, t: Date.now() })} title={s.text}>
                      {s.text}
                    </button>
                  ) : (
                    <button
                      key={s.id}
                      className="scene-item"
                      data-on={currentScene?.id === s.id}
                      onClick={() => setJump({ id: s.id, t: Date.now() })}
                      title={s.text}
                    >
                      <span className="scene-item-n">{s.n}</span>
                      <span className="scene-item-text">{s.text}</span>
                    </button>
                  )
                )}
              </div>
            </div>
            <div className="sidebar-section">
              <div className="sidebar-title">
                Characters <span>{characters.length}</span>
              </div>
              {characters.map((c) => (
                <div key={c.name} className="cast-item">
                  <button
                    ref={(node) => (castRefs.current[c.name] = node)}
                    className="cast-dot"
                    data-none={!cast[c.name]?.color || undefined}
                    style={cast[c.name]?.color ? { background: cast[c.name].color } : undefined}
                    title="Colour this character's lines"
                    aria-label={`Colour for ${c.name}`}
                    onClick={() => setCastMenu(c.name)}
                  />
                  <span className="cast-name" style={cast[c.name]?.color ? { color: cast[c.name].color } : undefined}>
                    {c.name}
                  </span>
                  <span className="cast-lines">{c.lines}</span>
                </div>
              ))}
            </div>
            {script.logline && (
              <div className="sidebar-section">
                <div className="sidebar-title">Description</div>
                <p className="logline">{script.logline}</p>
              </div>
            )}
          </aside>
        )}

        <main className="script-main">
          <div className="format-bar" onMouseDown={(e) => e.target.closest("button") && e.preventDefault()}>
            {BAR.map((key) => {
              const t = TYPE_BY_KEY[key];
              return (
                <button
                  key={key}
                  className="fmt"
                  data-on={activeType === key}
                  onClick={() => editorRef.current?.setType(key)}
                  title={`${t.label} — Ctrl+${t.hotkey}${t.prefix ? ` · or type ${t.prefix}` : ""}`}
                >
                  <span className="fmt-icon">{t.icon}</span>
                  <span className="fmt-label">{t.label}</span>
                </button>
              );
            })}
            <span className="fmt-sep" />
            <button className="fmt fmt-mark" onClick={() => editorRef.current?.format("bold")} title="Bold — Ctrl+B">
              <b>B</b>
            </button>
            <button className="fmt fmt-mark" onClick={() => editorRef.current?.format("italic")} title="Italic — Ctrl+I">
              <i>I</i>
            </button>
            <button className="fmt fmt-mark" onClick={() => editorRef.current?.format("underline")} title="Underline — Ctrl+U">
              <u>U</u>
            </button>
          </div>

          <div className="page">
            <ScriptEditor
              key={script.id}
              ref={editorRef}
              blocks={script.blocks}
              onChange={onChange}
              onActive={setActiveId}
              settings={settings}
              jump={jump}
              cast={cast}
              known={known}
            />
          </div>
        </main>
      </div>

      <footer className="statusbar">
        <span className="status-type">{activeType ? TYPE_BY_KEY[activeType].label : "—"}</span>
        {currentScene && <span className="status-scene">{currentScene.text}</span>}
        <span className="status-spacer" />
        <span>{stats.words.toLocaleString()} words</span>
        <span>{formatPages(stats.pages)}</span>
        <span>≈ {formatRuntime(stats.pages)}</span>
        <span>{stats.scenes.length} scenes</span>
        <button className="status-zoom" title="Zoom · Ctrl+scroll · click for 100%" onClick={resetZoom}>
          {Math.round(zoom * 100)}%
        </button>
        {goal > 0 && (
          <span className="status-goal" data-hit={today >= goal}>
            Today {today.toLocaleString()} / {goal.toLocaleString()}
          </span>
        )}
      </footer>

      {exportOpen && (
        <Popover anchorRef={exportRef} width={230} align="right" className="card-menu" onClose={() => setExportOpen(false)}>
          <button className="menu-item" onClick={() => doExport("print")}>
            <span className="menu-icon">⎙</span>Print / Save as PDF
          </button>
          <button className="menu-item" onClick={() => doExport("fountain")}>
            <span className="menu-icon">F</span>Fountain (.fountain)
          </button>
          <button className="menu-item" onClick={() => doExport("text")}>
            <span className="menu-icon">T</span>Plain Text (.txt)
          </button>
        </Popover>
      )}

      {castMenu && (
        <Popover anchorRef={{ current: castRefs.current[castMenu] }} width={214} className="card-menu" onClose={() => setCastMenu(null)}>
          <span className="menu-label">{castMenu}</span>
          <Swatches
            value={cast[castMenu]?.color}
            noneLabel="No colour"
            onPick={(hex) => {
              setCastColor(castMenu, hex);
              setCastMenu(null);
            }}
          />
        </Popover>
      )}

      {details && (
        <ScriptDetails
          script={script}
          onClose={() => setDetails(false)}
          onSave={(fields) => {
            store.updateScript(script.id, fields);
            setDetails(false);
          }}
        />
      )}

      <PrintView script={script} settings={settings} />
    </div>
  );
}
