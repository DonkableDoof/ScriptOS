import { useRef } from "react";
import Cover from "./Cover";
import { episodeLabel, formatPages, timeAgo } from "../lib/script";

export default function ScriptCard({ script, stats, onOpen, onMenu }) {
  const menuRef = useRef(null);
  const chip = [episodeLabel(script), script.cloud && "☁", script.share && "Shared"].filter(Boolean).join(" · ");

  return (
    <div
      className="scard"
      role="button"
      tabIndex={0}
      data-archived={script.archived || undefined}
      onClick={onOpen}
      onKeyDown={(e) => e.key === "Enter" && onOpen()}
      onContextMenu={(e) => {
        e.preventDefault();
        onMenu(menuRef);
      }}
    >
      <div className="scard-cover">
        <Cover script={script} />
        {chip && <span className="scard-chip">{chip}</span>}
        <button
          ref={menuRef}
          className="scard-more"
          aria-label="Script options"
          onClick={(e) => {
            e.stopPropagation();
            onMenu(menuRef);
          }}
        >
          ⋯
        </button>
      </div>
      <div className="scard-body">
        <span className="scard-title">{script.title || "Untitled Script"}</span>
        <span className="scard-meta">
          {formatPages(stats.pages)} · {timeAgo(script.updatedAt)}
        </span>
      </div>
    </div>
  );
}
