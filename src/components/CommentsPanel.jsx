import { useState } from "react";
import { KIND_LABEL } from "../lib/share";
import { timeAgo } from "../lib/script";

export function Avatar({ name, src, size = 26 }) {
  const initial = String(name || "?").trim().charAt(0).toUpperCase() || "?";
  return (
    <span className="avatar" style={{ width: size, height: size, fontSize: size * 0.42 }}>
      {src ? <img src={src} alt="" draggable={false} /> : initial}
    </span>
  );
}

// Notes left on a script: the same list for the writer (who can tick them off) and for
// the people reading. All of it renders as plain text.
export default function CommentsPanel({ comments, people = {}, order = {}, meId, canManage, onJump, onResolve, onDelete, focusId }) {
  const [tab, setTab] = useState("open");
  const open = comments.filter((c) => !c.resolved);
  const done = comments.filter((c) => c.resolved);
  const place = (c) => (c.blockId && order[c.blockId] !== undefined ? order[c.blockId] : -1);
  const shown = [...(tab === "open" ? open : done)].sort((a, b) => place(a) - place(b) || a.createdAt - b.createdAt);

  return (
    <div className="comments">
      <div className="segmented comments-tabs">
        <button type="button" data-on={tab === "open"} onClick={() => setTab("open")}>
          Open {open.length}
        </button>
        <button type="button" data-on={tab === "done"} onClick={() => setTab("done")}>
          Done {done.length}
        </button>
      </div>
      {shown.map((c) => {
        const who = people[c.authorId];
        const name = who?.name || "Someone";
        const mine = meId && c.authorId === meId;
        const gone = c.blockId && order[c.blockId] === undefined;
        return (
          <article
            key={c.id}
            className="comment"
            data-kind={c.kind}
            data-focus={focusId === c.blockId || undefined}
            role={c.blockId && !gone ? "button" : undefined}
            onClick={() => c.blockId && !gone && onJump?.(c.blockId)}
          >
            <header className="comment-head">
              <Avatar name={name} src={who?.avatar} />
              <span className="comment-name">{name}</span>
              <span className="comment-kind">{KIND_LABEL[c.kind]}</span>
            </header>
            {c.quote && <blockquote className="comment-quote">{c.quote}</blockquote>}
            <p className="comment-body">{c.body}</p>
            <footer className="comment-foot">
              <span>
                {timeAgo(c.createdAt)}
                {gone ? " · line no longer here" : ""}
              </span>
              {canManage && (
                <button
                  className="link-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    onResolve?.(c);
                  }}
                >
                  {c.resolved ? "Reopen" : "Done"}
                </button>
              )}
              {(canManage || mine) && (
                <button
                  className="link-btn comment-delete"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete?.(c);
                  }}
                >
                  Delete
                </button>
              )}
            </footer>
          </article>
        );
      })}
    </div>
  );
}
