import { useState } from "react";
import ScrambleDoc from "../components/ScrambleDoc";
import CloudButton from "../components/CloudButton";
import Confirm from "../components/Confirm";
import { useStore } from "../lib/store";
import { blockMetrics, totalsOf } from "../lib/script";
import { DOC_PROFILE } from "../lib/profiles";
import { useDocZoom } from "../lib/useDocZoom";
import { sfx } from "../lib/sound";

const LEVELS = { heading: 1, sequence: 2, beat: 3 };

// A scramble: the same block editor as a script, set up as a plain document for
// getting an idea down fast, with its headings listed in the outline.
export default function ScramblePage({ scrambleId, navigate }) {
  const store = useStore();
  const scramble = store.scrambles.find((s) => s.id === scrambleId);
  const [activeId, setActiveId] = useState(null);
  const [jump, setJump] = useState(null);
  const [sidebar, setSidebar] = useState(true);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const { zoom, resetZoom } = useDocZoom();

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

  const activeIndex = scramble.blocks.findIndex((b) => b.id === activeId);
  const activeType = scramble.blocks[activeIndex]?.type || null;
  const { words } = totalsOf(scramble.blocks);
  const outline = scramble.blocks
    .map((b, index) => ({ id: b.id, index, level: LEVELS[b.type], text: blockMetrics(b).text }))
    .filter((h) => h.level && h.text);
  const current = activeIndex >= 0 ? [...outline].reverse().find((h) => h.index <= activeIndex) : null;

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
          <CloudButton kind="scramble" item={scramble} />
          <button className="btn btn-ghost" onClick={() => setSidebar((v) => !v)} title="Show or hide the list of headings">
            {sidebar ? "Hide Outline" : "Show Outline"}
          </button>
          <button className="btn btn-ghost" onClick={() => setConfirmDelete(true)}>
            Delete
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
                Outline <span>{outline.length}</span>
              </div>
              <div className="scene-list">
                {outline.map((h) => (
                  <button
                    key={h.id}
                    className="scene-item outline-item"
                    data-level={h.level}
                    data-on={current?.id === h.id}
                    onClick={() => setJump({ id: h.id, t: Date.now() })}
                    title={h.text}
                  >
                    <span className="scene-item-text">{h.text}</span>
                  </button>
                ))}
              </div>
            </div>
          </aside>
        )}
        <main className="script-main">
          <ScrambleDoc scramble={scramble} jump={jump} onActive={setActiveId} />
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
          body={`This scramble will be deleted${scramble.cloud ? " from all your devices" : ""}. This can't be undone.`}
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
