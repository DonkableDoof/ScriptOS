import { useRef } from "react";
import Cover from "./Cover";
import { FORMAT_BY_KEY, episodeLabel, formatPages, timeAgo } from "../lib/script";

export default function ScriptCard({ script, stats, onOpen, onMenu }) {
  const menuRef = useRef(null);
  const format = FORMAT_BY_KEY[script.format]?.short || "Script";
  const ep = episodeLabel(script);

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
        <span className="scard-chip">
          {ep ? `${format} · ${ep}` : format}
          {script.cloud ? " · ☁" : ""}
          {script.share ? " · Shared" : ""}
        </span>
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
        {script.cover && (
          <div className="scard-overlay">
            <span className="scard-overlay-title">{script.title}</span>
          </div>
        )}
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
