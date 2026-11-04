import { useState } from "react";
import Confirm from "./Confirm";
import { scrambleTitle, timeAgo, totalsOf } from "../lib/script";

// Quick ideas and rough outlines, newest first, above the stats on the home page.
export default function ScramblesPanel({ scrambles, onOpen, onNew, onDelete }) {
  const [confirm, setConfirm] = useState(null);
  const list = [...scrambles].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

  return (
    <div className="panel">
      <div className="panel-head">
        <span className="panel-title">Scrambles</span>
        <button className="panel-add" onClick={onNew} title="New Scramble" aria-label="New Scramble">
          +
        </button>
      </div>
      <div className="scrambles">
        {list.map((s) => (
          <div key={s.id} className="scramble" role="button" tabIndex={0} onClick={() => onOpen(s)} onKeyDown={(e) => e.key === "Enter" && onOpen(s)}>
            <span className="scramble-title">
              {s.cloud && <span className="scramble-cloud" title="Uploaded to your account">☁ </span>}
              {scrambleTitle(s)}
            </span>
            <span className="scramble-meta">
              {totalsOf(s.blocks).words.toLocaleString()} words · {timeAgo(s.updatedAt)}
            </span>
            <button
              className="scramble-delete"
              title="Delete"
              aria-label={`Delete ${scrambleTitle(s)}`}
              onClick={(e) => {
                e.stopPropagation();
                setConfirm(s);
              }}
            >
              ×
            </button>
          </div>
        ))}
      </div>
      {confirm && (
        <Confirm
          title="Delete Scramble"
          body={`“${scrambleTitle(confirm)}” will be deleted${confirm.cloud ? " from all your devices" : ""}. This can't be undone.`}
          confirmLabel="Delete"
          danger
          onClose={() => setConfirm(null)}
          onConfirm={() => {
            onDelete(confirm);
            setConfirm(null);
          }}
        />
      )}
    </div>
  );
}
