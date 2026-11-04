import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ScriptEditor from "../components/ScriptEditor";
import ScriptDetails from "../components/ScriptDetails";
import PrintView from "../components/PrintView";
import Popover from "../components/Popover";
import { useStore } from "../lib/store";
import { TYPE_BY_KEY, scriptStats, formatPages, formatRuntime, isTv, characterName, blockMetrics } from "../lib/script";
import { nextCastColor } from "../lib/colors";
import Swatches from "../components/Swatches";
import ScramblePane from "../components/ScramblePane";
import ShareDialog from "../components/ShareDialog";
import CommentsPanel from "../components/CommentsPanel";
import ChangeRow from "../components/ChangeRow";
import CloudButton from "../components/CloudButton";
import { htmlText, placeChanges } from "../lib/suggest";
import { useOwnerShare } from "../lib/useOwnerShare";
import { loadImageFile, renderIcon } from "../lib/image";
import { toFountain, toPlainText, fileNameFor } from "../lib/fountain";
import { saveTextFile } from "../lib/native";
import { dayKey } from "../lib/activity";
import { notify } from "../lib/notice";
import { useDocZoom } from "../lib/useDocZoom";

// The everyday elements get a button; the rest live in the slash menu and hotkeys.
const BAR = ["act", "scene", "action", "character", "parenthetical", "dialogue", "subtext", "transition", "shot", "note", "heading", "sequence", "beat", "centered", "lyrics"];

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
  const [castMenu, setCastMenu] = useState(null);
  const castRefs = useRef({});
  const iconInput = useRef(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [sideTab, setSideTab] = useState("outline");
  const [focusBlock, setFocusBlock] = useState(null);
  const owner = useOwnerShare(script, store);

  const stats = useMemo(() => (script ? scriptStats(script) : null), [script]);
  const onChange = useCallback((blocks) => store.updateBlocks(scriptId, blocks), [store.updateBlocks, scriptId]);

  // The script's characters are whoever has a cue line in it. The name in the line
  // being typed doesn't count until it's finished, so "M", "MA", "MAR" never show
  // up on their way to "MARA".
  const cast = script?.cast || {};
  const blocks = script?.blocks || [];
  const typing = blocks.find((b) => b.id === activeId && b.type === "character");
  const characters = useMemo(() => {
    const cues = {};
    for (const b of blocks) {
      if (b.type !== "character") continue;
      const name = characterName(blockMetrics(b).text);
      if (name) cues[name] = (cues[name] || 0) + (b === typing ? 0 : 1);
    }
    const lines = Object.fromEntries((stats?.characters || []).map((c) => [c.name, c.lines]));
    return Object.keys(cues)
      .filter((name) => cues[name] > 0 || lines[name] > 0)
      .map((name) => ({ name, lines: lines[name] || 0 }))
      .sort((a, b) => b.lines - a.lines || a.name.localeCompare(b.name));
  }, [blocks, typing, stats]);

  // Colours and icons belong to characters still in the script: one who's been cut
  // loses theirs, and with the setting on a new one gets the next free colour. Nothing
  // is removed while a cue is being typed, as it passes through other names on the way.
  const namesKey = characters.map((c) => c.name).join("|");
  useEffect(() => {
    if (!script) return;
    const present = new Set(blocks.filter((b) => b.type === "character").map((b) => characterName(blockMetrics(b).text)));
    const next = {};
    let changed = false;
    for (const [name, entry] of Object.entries(cast)) {
      if ((entry?.color || entry?.icon) && (present.has(name) || typing)) next[name] = entry;
      else changed = true;
    }
    if (settings.autoCastColors) {
      for (const { name } of characters) {
        if (next[name]?.color) continue;
        next[name] = { ...next[name], color: nextCastColor(Object.values(next).map((c) => c.color).filter(Boolean)) };
        changed = true;
      }
    }
    if (changed) store.updateScript(scriptId, { cast: next });
  }, [namesKey, settings.autoCastColors, typing?.id]);

  const { zoom, resetZoom } = useDocZoom();

  const setCast = (name, changes) => {
    const entry = { ...cast[name], ...changes };
    if (!entry.color) delete entry.color;
    if (!entry.icon) delete entry.icon;
    const next = { ...cast, [name]: entry };
    if (!Object.keys(entry).length) delete next[name];
    store.updateScript(scriptId, { cast: next });
  };

  const pickIcon = async (file) => {
    const name = castMenu;
    try {
      setCast(name, { icon: renderIcon(await loadImageFile(file)) });
      setCastMenu(null);
    } catch (err) {
      notify("That icon didn't work", { detail: err.message, tone: "bad" });
    }
  };

  // Dual view: a scramble open beside this script, remembered per script.
  const paneScramble = store.scrambles.find((s) => s.id === settings.dualOpen?.[scriptId]);
  const [paneWidth, setPaneWidth] = useState(settings.dualWidth || 400);
  const side = settings.dualSide === "left" ? "left" : "right";
  const showPane = (id) => store.updateSettings({ dualOpen: { ...settings.dualOpen, [scriptId]: id } });
  const closePane = () => {
    const open = { ...settings.dualOpen };
    delete open[scriptId];
    store.updateSettings({ dualOpen: open });
  };
  const togglePane = () => {
    if (paneScramble) return closePane();
    const recent = [...store.scrambles].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))[0];
    showPane((recent || store.addScramble()).id);
  };
  const dragDivider = (e) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = paneWidth;
    let width = startW;
    const onMove = (ev) => {
      const delta = (ev.clientX - startX) / (settings.uiScale || 1);
      width = Math.max(280, Math.min(window.innerWidth - 420, startW + (side === "right" ? -delta : delta)));
      setPaneWidth(width);
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      document.body.classList.remove("is-resizing");
      store.updateSettings({ dualWidth: width });
    };
    document.body.classList.add("is-resizing");
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  // Names to suggest beyond this script's own lines: everyone from the other
  // episodes of the same show.
  const show = script && isTv(script.format) ? script.show?.trim().toLowerCase() : "";
  const known = useMemo(() => {
    const names = new Set();
    if (show) {
      for (const s of store.scripts) {
        if (s.id === scriptId || !isTv(s.format) || s.show?.trim().toLowerCase() !== show) continue;
        for (const b of s.blocks) if (b.type === "character") names.add(characterName(blockMetrics(b).text));
      }
    }
    names.delete("");
    return [...names];
  }, [show, store.scripts, scriptId]);

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

  // Comments left by readers. They live on the script, shared or not.
  const comments = script.comments || [];
  const suggestions = script.suggestions || [];
  const hasComments = comments.length > 0 || suggestions.length > 0 || Boolean(owner.share);
  const acceptSuggestions = (list) => owner.acceptChanges(list, (next) => editorRef.current?.applyBlocks(next));
  const acceptSuggestion = (c) => acceptSuggestions([c]);
  const rejectSuggestion = (c) => owner.rejectChanges([c]);
  const staleLines = new Set(
    suggestions.filter((c) => c.op !== "insert" && htmlText(script.blocks.find((b) => b.id === c.line)?.html) !== htmlText(c.baseHtml)).map((c) => c.id)
  );
  const changesByLine = placeChanges(script.blocks, script.blocks, suggestions);
  const changeUi = { people: script.reviewers || {}, canDecide: true, staleLines, onAccept: acceptSuggestion, onReject: rejectSuggestion };
  const jumpToChange = (c) => {
    const id = Object.keys(changesByLine).find((line) => changesByLine[line].includes(c));
    if (id) setJump({ id, showChange: true, t: Date.now() });
  };
  const openComments = comments.filter((c) => !c.resolved).length;
  const blockOrder = Object.fromEntries(script.blocks.map((b, i) => [b.id, i]));
  const commentCounts = {};
  for (const c of comments) if (c.blockId && !c.resolved) commentCounts[c.blockId] = (commentCounts[c.blockId] || 0) + 1;

  const activeBlock = script.blocks.find((b) => b.id === activeId);
  const activeType = activeBlock?.type || null;
  const activeIndex = activeBlock ? script.blocks.indexOf(activeBlock) : -1;
  // scenes numbered in order, with the acts they fall under set between them
  const outline = [...stats.scenes.map((s, i) => ({ ...s, n: i + 1 })), ...stats.acts.map((a) => ({ ...a, act: true }))].sort(
    (a, b) => a.index - b.index
  );
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
          <button className="btn btn-ghost" data-on={Boolean(paneScramble)} onClick={togglePane} title="Open a scramble beside this script">
            {paneScramble ? "Close Scramble" : "Open Scramble"}
          </button>
          <button className="btn btn-ghost" onClick={() => setDetails(true)}>
            Details
          </button>
          <button ref={exportRef} className="btn" onClick={() => setExportOpen((v) => !v)}>
            Export ▾
          </button>
          <CloudButton kind="script" item={script} />
          <button className="btn share-btn" data-on={Boolean(owner.share)} onClick={() => setShareOpen(true)} title={owner.share ? `Shared · code ${owner.share.code}` : "Let other people read this script and leave comments"}>
            {owner.share ? "Shared" : "Share"}
            {owner.requests.length > 0 && <span className="share-count">{owner.requests.length}</span>}
          </button>
          <button className="btn btn-settings" onClick={() => navigate({ page: "settings" })} aria-label="Settings" title="Settings">
            ⚙
          </button>
        </div>
      </header>

      <div
        className="script-layout"
        data-sidebar={sidebar}
        data-dual={Boolean(paneScramble) || undefined}
        data-side={side}
        style={
          paneScramble
            ? {
                gridTemplateColumns: [
                  sidebar ? "250px" : "",
                  side === "left" ? `${paneWidth}px 7px minmax(0, 1fr)` : `minmax(0, 1fr) 7px ${paneWidth}px`,
                ].join(" "),
              }
            : undefined
        }
      >
        {sidebar && (
          <aside className="sidebar">
            {hasComments && (
              <div className="segmented sidebar-tabs">
                <button type="button" data-on={sideTab === "outline"} onClick={() => setSideTab("outline")}>
                  Outline
                </button>
                <button type="button" data-on={sideTab === "comments"} onClick={() => setSideTab("comments")}>
                  Comments {openComments > 0 ? openComments : ""}
                </button>
                <button type="button" data-on={sideTab === "changes"} onClick={() => setSideTab("changes")}>
                  Changes {suggestions.length > 0 ? suggestions.length : ""}
                </button>
              </div>
            )}
            {hasComments && sideTab === "changes" ? (
              <div className="comments">
                {suggestions.length > 1 && (
                  <div className="changes-all">
                    <button className="btn btn-sm" onClick={() => acceptSuggestions(suggestions)}>
                      Accept All
                    </button>
                    <button className="btn btn-ghost btn-sm" onClick={() => owner.rejectChanges(suggestions)}>
                      Reject All
                    </button>
                  </div>
                )}
                {suggestions.map((c) => (
                  <ChangeRow
                    key={c.id}
                    change={c}
                    person={script.reviewers?.[c.authorId]}
                    canDecide
                    stale={staleLines.has(c.id)}
                    onAccept={acceptSuggestion}
                    onReject={rejectSuggestion}
                    onJump={jumpToChange}
                  />
                ))}
              </div>
            ) : hasComments && sideTab === "comments" ? (
              <CommentsPanel
                comments={comments}
                people={script.reviewers || {}}
                order={blockOrder}
                canManage
                focusId={focusBlock}
                onJump={(id) => {
                  setFocusBlock(id);
                  setJump({ id, t: Date.now() });
                }}
                onResolve={owner.resolveComment}
                onDelete={owner.deleteComment}
              />
            ) : (
              <>
            <div className="sidebar-section">
              <div className="sidebar-title">
                Scenes <span>{stats.scenes.length}</span>
              </div>
              <div className="scene-list">
                {outline.map((s) =>
                  s.act ? (
                    <button key={s.id} className="act-item" onClick={() => setJump({ id: s.id, t: Date.now() })} title={s.text}>
                      {s.text}
                    </button>
                  ) : (
                    <button
                      key={s.id}
                      className="scene-item"
                      data-on={currentScene?.id === s.id}
                      onClick={() => setJump({ id: s.id, t: Date.now() })}
                      title={s.text}
                    >
                      <span className="scene-item-n">{s.n}</span>
                      <span className="scene-item-text">{s.text}</span>
                    </button>
                  )
                )}
              </div>
            </div>
            <div className="sidebar-section">
              <div className="sidebar-title">
                Characters <span>{characters.length}</span>
              </div>
              {characters.map((c) => (
                <div key={c.name} className="cast-item">
                  <button
                    ref={(node) => (castRefs.current[c.name] = node)}
                    className="cast-dot"
                    data-none={(!cast[c.name]?.color && !cast[c.name]?.icon) || undefined}
                    data-icon={cast[c.name]?.icon ? true : undefined}
                    style={cast[c.name]?.color ? { background: cast[c.name].color } : undefined}
                    title="Colour and icon for this character"
                    aria-label={`Colour and icon for ${c.name}`}
                    onClick={() => setCastMenu(c.name)}
                  >
                    {cast[c.name]?.icon && <img src={cast[c.name].icon} alt="" draggable={false} />}
                  </button>
                  <span className="cast-name" style={cast[c.name]?.color ? { color: cast[c.name].color } : undefined}>
                    {c.name}
                  </span>
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
              </>
            )}
          </aside>
        )}

        <main className="script-main" data-scroller={paneScramble ? true : undefined}>
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
              cast={cast}
              known={known}
              commentCounts={commentCounts}
              changesByLine={changesByLine}
              changeUi={changeUi}
              onCommentBadge={(id) => {
                setSidebar(true);
                setSideTab("comments");
                setFocusBlock(id);
              }}
            />
          </div>
        </main>

        {paneScramble && (
          <>
            <div className="pane-divider" role="separator" aria-orientation="vertical" title="Drag to resize" onPointerDown={dragDivider} />
            <ScramblePane
              scramble={paneScramble}
              side={side}
              onPick={showPane}
              onSwap={() => store.updateSettings({ dualSide: side === "right" ? "left" : "right" })}
              onOpenFull={() => navigate({ page: "scramble", id: paneScramble.id })}
              onClose={closePane}
            />
          </>
        )}
      </div>

      <footer className="statusbar">
        <span className="status-type">{activeType ? TYPE_BY_KEY[activeType].label : "—"}</span>
        {currentScene && <span className="status-scene">{currentScene.text}</span>}
        <span className="status-spacer" />
        <span>{stats.words.toLocaleString()} words</span>
        <span>{formatPages(stats.pages)}</span>
        <span>≈ {formatRuntime(stats.pages)}</span>
        <span>{stats.scenes.length} scenes</span>
        <button className="status-zoom" title="Zoom · Ctrl+scroll · click for 100%" onClick={resetZoom}>
          {Math.round(zoom * 100)}%
        </button>
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

      {castMenu && (
        <Popover anchorRef={{ current: castRefs.current[castMenu] }} width={214} className="card-menu" onClose={() => setCastMenu(null)}>
          <span className="menu-label">{castMenu}</span>
          <Swatches
            value={cast[castMenu]?.color}
            noneLabel="No colour"
            onPick={(hex) => {
              setCast(castMenu, { color: hex });
              setCastMenu(null);
            }}
          />
          <div className="menu-sep" />
          <button className="menu-item" onClick={() => iconInput.current?.click()}>
            <span className="menu-icon">↑</span>
            {cast[castMenu]?.icon ? "Replace Icon" : "Upload Icon"}
          </button>
          {cast[castMenu]?.icon && (
            <button
              className="menu-item"
              onClick={() => {
                setCast(castMenu, { icon: null });
                setCastMenu(null);
              }}
            >
              <span className="menu-icon">×</span>Remove Icon
            </button>
          )}
        </Popover>
      )}
      <input
        ref={iconInput}
        type="file"
        accept="image/png,image/*"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) pickIcon(file);
        }}
      />

      {shareOpen && <ShareDialog script={script} owner={owner} onClose={() => setShareOpen(false)} />}

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
