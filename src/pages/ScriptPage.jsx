import { useCallback, useMemo, useRef, useState } from "react";
import ScriptEditor from "../components/ScriptEditor";
import ScriptDetails from "../components/ScriptDetails";
import PrintView from "../components/PrintView";
import Popover from "../components/Popover";
import { useStore } from "../lib/store";
import { TYPE_BY_KEY, scriptStats, formatPages, formatRuntime } from "../lib/script";
import { toFountain, toPlainText, fileNameFor } from "../lib/fountain";
import { saveTextFile } from "../lib/native";
import { dayKey } from "../lib/activity";
import { notify } from "../lib/notice";

// The everyday elements get a button; the rest live in the slash menu and hotkeys.
const BAR = ["scene", "action", "character", "parenthetical", "dialogue", "subtext", "transition", "shot", "note", "act", "sequence", "beat", "centered", "lyrics"];

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

  const stats = useMemo(() => (script ? scriptStats(script) : null), [script]);
  const onChange = useCallback((blocks) => store.updateBlocks(scriptId, blocks), [store.updateBlocks, scriptId]);

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

  const speaking = stats.characters.filter((c) => c.lines > 0);
  const activeBlock = script.blocks.find((b) => b.id === activeId);
  const activeType = activeBlock?.type || null;
  const activeIndex = activeBlock ? script.blocks.indexOf(activeBlock) : -1;
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
                {stats.scenes.map((s, i) => (
                  <button
                    key={s.id}
                    className="scene-item"
                    data-on={currentScene?.id === s.id}
                    onClick={() => setJump({ id: s.id, t: Date.now() })}
                    title={s.text}
                  >
                    <span className="scene-item-n">{i + 1}</span>
                    <span className="scene-item-text">{s.text}</span>
                  </button>
                ))}
              </div>
            </div>
            <div className="sidebar-section">
              <div className="sidebar-title">
                Characters <span>{speaking.length}</span>
              </div>
              {speaking.map((c) => (
                <div key={c.name} className="cast-item">
                  <span className="cast-name">{c.name}</span>
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
