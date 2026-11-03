import { useCallback, useRef, useState } from "react";
import ScriptEditor from "../components/ScriptEditor";
import Confirm from "../components/Confirm";
import { useStore } from "../lib/store";
import { totalsOf } from "../lib/script";
import { DOC_PROFILE, DOC_TYPES } from "../lib/profiles";
import { useDocZoom } from "../lib/useDocZoom";
import { sfx } from "../lib/sound";

// A scramble: the same block editor as a script, set up as a plain document for
// getting an idea down fast.
export default function ScramblePage({ scrambleId, navigate }) {
  const store = useStore();
  const { settings } = store;
  const scramble = store.scrambles.find((s) => s.id === scrambleId);
  const editorRef = useRef(null);
  const [activeId, setActiveId] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const { zoom, resetZoom } = useDocZoom();
  const onChange = useCallback((blocks) => store.updateScrambleBlocks(scrambleId, blocks), [store.updateScrambleBlocks, scrambleId]);

  if (!scramble) {
    return (
      <div className="app">
        <div className="empty" style={{ margin: 80 }}>
          <span className="empty-title">This scramble is gone</span>
          <button className="btn" onClick={() => navigate({ page: "home" })}>
            Back to Scripts
          </button>
        </div>
      </div>
    );
  }

  const activeType = scramble.blocks.find((b) => b.id === activeId)?.type || null;
  const { words } = totalsOf(scramble.blocks);

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
              value={scramble.title}
              placeholder="Untitled Scramble"
              onChange={(e) => store.updateScramble(scramble.id, { title: e.target.value })}
              spellCheck={false}
              aria-label="Scramble title"
            />
          </div>
        </div>
        <div className="topbar-actions">
          <button className="btn btn-ghost" onClick={() => setConfirmDelete(true)}>
            Delete
          </button>
          <button className="btn btn-settings" onClick={() => navigate({ page: "settings" })} aria-label="Settings" title="Settings">
            ⚙
          </button>
        </div>
      </header>

      <div className="script-layout" data-sidebar="false">
        <main className="script-main">
          <div className="format-bar" onMouseDown={(e) => e.target.closest("button") && e.preventDefault()}>
            {DOC_TYPES.map((t) => (
              <button
                key={t.key}
                className="fmt"
                data-on={activeType === t.key}
                onClick={() => editorRef.current?.setType(t.key)}
                title={`${t.label} — Ctrl+${t.hotkey}${t.prefix ? ` · or type ${t.prefix}` : ""}`}
              >
                <span className="fmt-icon">{t.icon}</span>
                <span className="fmt-label">{t.label}</span>
              </button>
            ))}
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

          <div className="page page-doc">
            <ScriptEditor
              key={scramble.id}
              ref={editorRef}
              blocks={scramble.blocks}
              onChange={onChange}
              onActive={setActiveId}
              settings={settings}
              profile={DOC_PROFILE}
            />
          </div>
        </main>
      </div>

      <footer className="statusbar">
        <span className="status-type">{activeType ? DOC_PROFILE.byKey[activeType]?.label : "—"}</span>
        <span className="status-spacer" />
        <span>{words.toLocaleString()} words</span>
        <button className="status-zoom" title="Zoom · Ctrl+scroll · click for 100%" onClick={resetZoom}>
          {Math.round(zoom * 100)}%
        </button>
      </footer>

      {confirmDelete && (
        <Confirm
          title="Delete Scramble"
          body="This scramble will be deleted. This can't be undone."
          confirmLabel="Delete"
          danger
          onClose={() => setConfirmDelete(false)}
          onConfirm={() => {
            store.deleteScramble(scramble.id);
            sfx.play("remove");
            navigate({ page: "home" });
          }}
        />
      )}
    </div>
  );
}
