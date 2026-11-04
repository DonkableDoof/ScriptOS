import { useCallback, useRef, useState } from "react";
import ScriptEditor from "./ScriptEditor";
import { useStore } from "../lib/store";
import { DOC_PROFILE, DOC_TYPES } from "../lib/profiles";

// A scramble's format bar and page, the same on its own page and beside a script.
export default function ScrambleDoc({ scramble, jump, onActive }) {
  const store = useStore();
  const editorRef = useRef(null);
  const [activeId, setActiveId] = useState(null);
  const activeType = scramble.blocks.find((b) => b.id === activeId)?.type || null;
  const onChange = useCallback((blocks) => store.updateScrambleBlocks(scramble.id, blocks), [store.updateScrambleBlocks, scramble.id]);
  const activate = useCallback(
    (id) => {
      setActiveId(id);
      onActive?.(id);
    },
    [onActive]
  );

  return (
    <>
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
          onActive={activate}
          settings={store.settings}
          jump={jump}
          profile={DOC_PROFILE}
        />
      </div>
    </>
  );
}
