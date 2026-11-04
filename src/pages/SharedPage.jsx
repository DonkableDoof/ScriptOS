import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Cover from "../components/Cover";
import CommentsPanel from "../components/CommentsPanel";
import ChangeRow from "../components/ChangeRow";
import ScriptEditor from "../components/ScriptEditor";
import { useStore } from "../lib/store";
import { backend, COMMENT_KINDS, leaveShared, loadShareFull, loadShareUpdates, postComment, saveMyChanges, useAccount } from "../lib/share";
import { characterName, plainText } from "../lib/script";
import { computeChanges, overlayChanges, placeChanges } from "../lib/suggest";
import { useDocZoom } from "../lib/useDocZoom";
import { notify } from "../lib/notice";
import { sfx } from "../lib/sound";

const EVERY = 5000;
const SAVE_AFTER = 800;

// Someone else's script. You edit it like any document: your changes are worked out by
// comparing with the writer's version, sent up as suggestions, and shown on the line they
// belong to, alongside everyone else's. Nothing here is saved on this device.
export default function SharedPage({ shareId, navigate }) {
  const { settings } = useStore();
  const { user } = useAccount();
  const [share, setShare] = useState(null);
  const [blocks, setBlocks] = useState([]);
  const [others, setOthers] = useState([]);
  const [comments, setComments] = useState([]);
  const [people, setPeople] = useState({});
  const [state, setState] = useState("loading");
  const [activeId, setActiveId] = useState(null);
  const [quote, setQuote] = useState("");
  const [kind, setKind] = useState("comment");
  const [body, setBody] = useState("");
  const [posting, setPosting] = useState(false);
  const [focusId, setFocusId] = useState(null);
  const [jump, setJump] = useState(null);
  const [tab, setTab] = useState("changes");
  const { zoom, resetZoom } = useDocZoom();

  const me = user?.id;
  const baseRef = useRef([]);
  const blocksRef = useRef([]);
  blocksRef.current = blocks;
  const syncedRef = useRef(new Map()); // line → what the server has from me
  const savingRef = useRef(false);
  const dirtyRef = useRef(false);
  const updatedRef = useRef(null);
  const tickRef = useRef(0);

  const myChanges = useMemo(
    () =>
      share
        ? computeChanges(share.blocks, blocks).map((c) => ({ ...c, id: `mine:${c.line}`, authorId: me, baseHtml: c.base_html, mine: true }))
        : [],
    [share, blocks, me]
  );

  const absorb = useCallback(
    (update) => {
      if (update.share) {
        // the writer changed something: keep my edits on top of their new version
        const mine = computeChanges(baseRef.current, blocksRef.current);
        baseRef.current = update.share.blocks;
        updatedRef.current = update.share.updatedAt;
        const known = new Map(update.share.blocks.map((b) => [b.id, b]));
        // anything of mine they've now taken is simply done
        const still = mine.filter((c) => !(c.op === "insert" && known.has(c.line)) && !(c.op === "edit" && known.get(c.line)?.html === c.html));
        setShare(update.share);
        setBlocks(overlayChanges(update.share.blocks, still));
      }
      if (update.changes) {
        const mineOnServer = update.changes.filter((c) => c.authorId === me);
        setOthers(update.changes.filter((c) => c.authorId !== me));
        // something of mine disappeared without me doing it: the writer decided on it
        if (!savingRef.current && !dirtyRef.current) {
          const onServer = new Set(mineOnServer.map((c) => c.line));
          const decided = [...syncedRef.current.keys()].filter((line) => !onServer.has(line));
          if (decided.length) {
            for (const line of decided) syncedRef.current.delete(line);
            const rest = computeChanges(baseRef.current, blocksRef.current).filter((c) => !decided.includes(c.line));
            setBlocks(overlayChanges(baseRef.current, rest));
          }
        }
      }
      if (update.comments) setComments(update.comments);
      if (update.people) setPeople(update.people);
    },
    [me]
  );

  // Opening: the writer's version with whatever I'd already suggested laid back over it.
  useEffect(() => {
    if (!me) return;
    let alive = true;
    loadShareFull(shareId).then(
      (full) => {
        if (!alive) return;
        if (!full) return setState("gone");
        baseRef.current = full.share.blocks;
        updatedRef.current = full.share.updatedAt;
        const mine = full.changes.filter((c) => c.authorId === me);
        syncedRef.current = new Map(mine.map((c) => [c.line, c]));
        setShare(full.share);
        setBlocks(overlayChanges(full.share.blocks, mine));
        setOthers(full.changes.filter((c) => c.authorId !== me));
        setComments(full.comments);
        setPeople(full.people);
        setState("ready");
      },
      () => alive && setState("offline")
    );
    return () => {
      alive = false;
    };
  }, [shareId, me]);

  useEffect(() => {
    if (state !== "ready") return;
    const poll = async () => {
      if (document.hidden) return;
      tickRef.current += 1;
      try {
        const update = await loadShareUpdates(shareId, updatedRef.current, tickRef.current % 6 === 0);
        if (update.gone) setState("gone");
        else absorb(update);
      } catch {
        /* offline: try again next time, nothing here is lost */
      }
    };
    const timer = setInterval(poll, EVERY);
    window.addEventListener("focus", poll);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", poll);
    };
  }, [state, shareId, absorb]);

  const saveTimer = useRef(null);
  const save = useCallback(async () => {
    if (savingRef.current) {
      saveTimer.current = setTimeout(save, SAVE_AFTER);
      return;
    }
    savingRef.current = true;
    dirtyRef.current = false;
    try {
      syncedRef.current = await saveMyChanges(shareId, me, computeChanges(baseRef.current, blocksRef.current), syncedRef.current);
    } catch (err) {
      dirtyRef.current = true;
      notify("Couldn't send your changes", { detail: "They're still here. Trying again shortly.", tone: "bad" });
      saveTimer.current = setTimeout(save, EVERY);
    } finally {
      savingRef.current = false;
    }
  }, [shareId, me]);

  const onEdit = useCallback(
    (next) => {
      blocksRef.current = next;
      setBlocks(next);
      dirtyRef.current = true;
      clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(save, SAVE_AFTER);
    },
    [save]
  );
  useEffect(() => () => clearTimeout(saveTimer.current), []);

  const discard = useCallback(
    (change) => {
      const rest = computeChanges(baseRef.current, blocksRef.current).filter((c) => c.line !== change.line);
      onEdit(overlayChanges(baseRef.current, rest));
    },
    [onEdit]
  );

  // Every change, placed on the line it belongs to in what's on screen.
  const allChanges = useMemo(() => [...myChanges, ...others], [myChanges, others]);
  const changesByLine = useMemo(
    () => (share ? placeChanges(blocks, share.blocks, allChanges) : {}),
    [blocks, share, allChanges]
  );
  const changeUi = useMemo(
    () => ({ people, me, canDecide: false, onDiscard: discard }),
    [people, me, discard]
  );
  const jumpToChange = (c) => {
    const id = Object.keys(changesByLine).find((line) => changesByLine[line].includes(c));
    if (id) setJump({ id, showChange: true, t: Date.now() });
  };

  const order = useMemo(() => Object.fromEntries(blocks.map((b, i) => [b.id, i])), [blocks]);
  const commentCounts = useMemo(() => {
    const map = {};
    for (const c of comments) if (c.blockId && !c.resolved) map[c.blockId] = (map[c.blockId] || 0) + 1;
    return map;
  }, [comments]);
  const castNames = useMemo(() => [...new Set(blocks.filter((b) => b.type === "character").map((b) => characterName(plainText(b.html))).filter(Boolean))], [blocks]);

  // highlighting words points a comment at just those
  useEffect(() => {
    const onChange = () => {
      const sel = window.getSelection();
      const inside = sel && !sel.isCollapsed && sel.anchorNode?.parentElement?.closest?.(".script-main [data-block-id]");
      setQuote(inside ? sel.toString().trim().slice(0, 2000) : "");
    };
    document.addEventListener("selectionchange", onChange);
    return () => document.removeEventListener("selectionchange", onChange);
  }, []);

  const activeLine = blocks.find((b) => b.id === activeId);
  const target = activeLine ? quote || plainText(activeLine.html).trim().slice(0, 2000) : "";

  const submit = async () => {
    const text = body.trim();
    if (!text || posting) return;
    setPosting(true);
    try {
      const comment = await postComment(shareId, { blockId: activeLine?.id, quote: target, kind, body: text });
      setComments((list) => [...list, comment]);
      setBody("");
      setKind("comment");
      sfx.play("add");
    } catch (err) {
      notify("Couldn't post that", { detail: String(err?.message || err), tone: "bad" });
      sfx.play("error");
    } finally {
      setPosting(false);
    }
  };

  const removeComment = async (c) => {
    try {
      await (await backend()).deleteComment(c.id);
      setComments((list) => list.filter((x) => x.id !== c.id));
    } catch (err) {
      notify("Couldn't delete that", { detail: String(err?.message || err), tone: "bad" });
    }
  };

  const leave = async () => {
    try {
      await leaveShared(shareId);
      navigate({ page: "home" });
    } catch (err) {
      notify("Couldn't remove it", { detail: String(err?.message || err), tone: "bad" });
    }
  };

  if (state !== "ready") {
    return (
      <div className="app">
        <div className="empty" style={{ margin: 80 }}>
          <span className="empty-title">
            {state === "loading" ? "Opening…" : state === "gone" ? "This script is no longer shared" : "Can't reach the server"}
          </span>
          {state !== "loading" && (
            <button className="btn" onClick={() => navigate({ page: "home" })}>
              Back to Scripts
            </button>
          )}
        </div>
      </div>
    );
  }

  const owner = people[share.ownerId];
  const outline = blocks.filter((b) => b.type === "scene" || b.type === "act");

  return (
    <div className="app script-app">
      <header className="topbar topbar-script">
        <div className="script-head">
          <button className="btn btn-ghost btn-back" onClick={() => navigate({ page: "home" })}>
            ← Scripts
          </button>
          <div className="brand-text">
            <div className="brand-name">{share.title}</div>
            <div className="brand-sub">Shared by {owner?.name || share.author || "the writer"}</div>
          </div>
        </div>
        <div className="topbar-actions">
          <button className="btn btn-ghost" onClick={leave} title="Remove this from your Shared With Me list">
            Leave
          </button>
        </div>
      </header>

      <div className="script-layout reader-layout" data-sidebar>
        <aside className="sidebar">
          <div className="reader-cover">
            <Cover script={{ cover: share.cover, title: share.title, format: share.format, author: share.author, coverHue: 30 }} small />
          </div>
          {share.logline && (
            <div className="sidebar-section">
              <div className="sidebar-title">Description</div>
              <p className="logline">{share.logline}</p>
            </div>
          )}
          <div className="sidebar-section">
            <div className="sidebar-title">Outline</div>
            <div className="scene-list">
              {outline.map((s) =>
                s.type === "act" ? (
                  <button key={s.id} className="act-item" onClick={() => setJump({ id: s.id, t: Date.now() })}>
                    {plainText(s.html).toUpperCase()}
                  </button>
                ) : (
                  <button key={s.id} className="scene-item" onClick={() => setJump({ id: s.id, t: Date.now() })}>
                    <span className="scene-item-text">{plainText(s.html).toUpperCase()}</span>
                  </button>
                )
              )}
            </div>
          </div>
          {castNames.length > 0 && (
            <div className="sidebar-section">
              <div className="sidebar-title">Characters</div>
              {castNames.map((name) => {
                const c = share.characters[name];
                return (
                  <div key={name} className="cast-item">
                    <span className="cast-dot" data-none={(!c?.color && !c?.icon) || undefined} data-icon={c?.icon ? true : undefined} style={c?.color ? { background: c.color } : undefined}>
                      {c?.icon && <img src={c.icon} alt="" draggable={false} />}
                    </span>
                    <span className="cast-name" style={c?.color ? { color: c.color } : undefined}>
                      {name}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </aside>

        <main className="script-main">
          <div className="reader-banner">You're suggesting. Type anywhere; {owner?.name || "the writer"} sees your changes and accepts or rejects them.</div>
          <div className="page">
            <ScriptEditor
              key={share.id}
              blocks={blocks}
              onChange={onEdit}
              onActive={setActiveId}
              settings={settings}
              jump={jump}
              cast={share.characters}
              commentCounts={commentCounts}
              onCommentBadge={(id) => {
                setTab("comments");
                setFocusId(id);
              }}
              changesByLine={changesByLine}
              changeUi={changeUi}
            />
          </div>
        </main>

        <aside className="reader-comments">
          <div className="segmented sidebar-tabs">
            <button type="button" data-on={tab === "changes"} onClick={() => setTab("changes")}>
              Changes {allChanges.length || ""}
            </button>
            <button type="button" data-on={tab === "comments"} onClick={() => setTab("comments")}>
              Comments {comments.filter((c) => !c.resolved).length || ""}
            </button>
          </div>

          {tab === "changes" ? (
            <div className="comments">
              {allChanges.map((c) => (
                <ChangeRow key={c.id} change={c} person={people[c.authorId]} mine={c.authorId === me} onDiscard={discard} onJump={jumpToChange} />
              ))}
            </div>
          ) : (
            <>
              <div className="composer">
                <div className="composer-kinds">
                  {COMMENT_KINDS.map((k) => (
                    <button key={k.key} type="button" className="composer-kind" data-kind={k.key} data-on={kind === k.key} onClick={() => setKind(k.key)}>
                      {k.label}
                    </button>
                  ))}
                </div>
                {target && <blockquote className="comment-quote">{target}</blockquote>}
                <textarea
                  rows={3}
                  maxLength={4000}
                  value={body}
                  placeholder="Write a comment…"
                  onChange={(e) => setBody(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) submit();
                  }}
                />
                <button className="btn btn-primary btn-sm composer-post" disabled={!body.trim() || posting} onClick={submit} title="Ctrl+Enter">
                  {posting ? "Posting…" : "Post"}
                </button>
              </div>
              <CommentsPanel
                comments={comments}
                people={people}
                order={order}
                meId={me}
                onJump={(id) => {
                  setFocusId(id);
                  setJump({ id, t: Date.now() });
                }}
                onDelete={removeComment}
                focusId={focusId}
              />
            </>
          )}
        </aside>
      </div>

      <footer className="statusbar">
        <span className="status-type">Suggesting</span>
        <span className="status-spacer" />
        <span>
          {myChanges.length} {myChanges.length === 1 ? "change" : "changes"} from you
        </span>
        <button className="status-zoom" title="Zoom · Ctrl+scroll · click for 100%" onClick={resetZoom}>
          {Math.round(zoom * 100)}%
        </button>
      </footer>
    </div>
  );
}
