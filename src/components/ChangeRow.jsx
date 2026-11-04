import { memo, useMemo } from "react";
import { Avatar } from "./CommentsPanel";
import { htmlText, wordDiff } from "../lib/suggest";

// One suggested change, shown right where it applies: removed words struck through,
// added words highlighted, and whose it is. Text only: none of it is treated as html.
export default memo(function ChangeRow({ change, person, mine, canDecide, stale, onAccept, onReject, onDiscard, onJump }) {
  const parts = useMemo(() => {
    const before = htmlText(change.baseHtml);
    const after = htmlText(change.html);
    if (change.op === "delete") return [{ t: "del", text: before }];
    if (change.op === "insert") return [{ t: "add", text: after }];
    if (before === after) return [{ t: "same", text: `${after} ` }, { t: "note", text: "(formatting changed)" }];
    return wordDiff(before, after);
  }, [change.op, change.baseHtml, change.html]);

  const label = change.op === "delete" ? "Remove line" : change.op === "insert" ? "New line" : "Edit";
  const name = mine ? "You" : person?.name || "Someone";

  return (
    <div
      className="change-row"
      data-op={change.op}
      data-jumps={onJump ? true : undefined}
      contentEditable={false}
      role={onJump ? "button" : undefined}
      tabIndex={onJump ? 0 : undefined}
      title={onJump ? "Go to this change" : undefined}
      onClick={onJump ? () => onJump(change) : undefined}
      onKeyDown={onJump ? (e) => e.key === "Enter" && e.target === e.currentTarget && onJump(change) : undefined}
    >
      <header className="change-head">
        <Avatar name={person?.name} src={person?.avatar} size={18} />
        <span className="change-who">{name}</span>
        <span className="change-label">{label}</span>
        {stale && <span className="change-stale" title="You've changed this line since they suggested this. Accepting replaces the whole line.">line has changed</span>}
        <span className="change-actions">
          {canDecide && (
            <>
              <button className="change-btn" data-kind="accept" title="Accept" aria-label="Accept" onMouseDown={(e) => e.preventDefault()} onClick={(e) => (e.stopPropagation(), onAccept(change))}>
                ✓
              </button>
              <button className="change-btn" data-kind="reject" title="Reject" aria-label="Reject" onMouseDown={(e) => e.preventDefault()} onClick={(e) => (e.stopPropagation(), onReject(change))}>
                ✕
              </button>
            </>
          )}
          {mine && !canDecide && (
            <button className="link-btn" onMouseDown={(e) => e.preventDefault()} onClick={(e) => (e.stopPropagation(), onDiscard?.(change))}>
              Discard
            </button>
          )}
        </span>
      </header>
      <p className="change-diff">
        {parts.map((p, i) =>
          p.t === "del" ? <del key={i}>{p.text}</del> : p.t === "add" ? <ins key={i}>{p.text}</ins> : p.t === "note" ? <em key={i}>{p.text}</em> : <span key={i}>{p.text}</span>
        )}
      </p>
    </div>
  );
});
