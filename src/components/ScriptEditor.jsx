import { forwardRef, memo, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from "react";
import Popover from "./Popover";
import {
  TYPES,
  TYPE_BY_KEY,
  NEXT,
  TAB_ORDER,
  emptyBlock,
  typeForHotkey,
  suggestionsFor,
  plainText,
  escapeHtml,
} from "../lib/script";
import { parseFountain, toFountain } from "../lib/fountain";
import { sfx } from "../lib/sound";
import { uid } from "../lib/storage";

// ---------------------------------------------------------------------------
// Caret helpers. Each block body is its own contenteditable, so positions are
// plain-text offsets inside one element.
// ---------------------------------------------------------------------------
const placeCaret = (el, offset = null) => {
  el.focus({ preventScroll: true });
  const sel = window.getSelection();
  const range = document.createRange();
  if (offset === null) {
    range.selectNodeContents(el);
    range.collapse(false);
  } else {
    let left = offset;
    let node = null;
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      node = walker.currentNode;
      if (node.length >= left) break;
      left -= node.length;
    }
    if (node) range.setStart(node, Math.min(left, node.length));
    else range.selectNodeContents(el);
    range.collapse(true);
  }
  sel.removeAllRanges();
  sel.addRange(range);
};

const caretOffset = (el) => {
  const sel = window.getSelection();
  if (!sel.rangeCount) return null;
  const range = sel.getRangeAt(0);
  if (!el.contains(range.startContainer)) return null;
  const probe = range.cloneRange();
  probe.selectNodeContents(el);
  probe.setEnd(range.startContainer, range.startOffset);
  return probe.toString().length;
};

const deleteFromOffset = (el, offset) => {
  const range = document.createRange();
  let left = offset;
  let node = null;
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    node = walker.currentNode;
    if (node.length >= left) break;
    left -= node.length;
  }
  if (node) range.setStart(node, Math.min(left, node.length));
  else range.setStart(el, 0);
  range.setEnd(el, el.childNodes.length);
  range.deleteContents();
  el.normalize();
  placeCaret(el);
};

const caretRect = () => {
  const sel = window.getSelection();
  if (!sel.rangeCount) return null;
  const range = sel.getRangeAt(0).cloneRange();
  range.collapse(true);
  return range.getClientRects()[0] || null;
};

const lineHeightOf = (el) => parseFloat(getComputedStyle(el).lineHeight) || 24;

// Arrow keys leave a block from its first or last visual line, not only from its
// very first or last character.
const atLineEdge = (el, dir) => {
  const sel = window.getSelection();
  if (!sel.rangeCount || !sel.getRangeAt(0).collapsed) return false;
  const rect = caretRect();
  const off = caretOffset(el);
  if (!rect) return dir < 0 ? off === 0 : off >= el.textContent.length;
  const box = el.getBoundingClientRect();
  const lh = lineHeightOf(el);
  return dir < 0 ? rect.top - box.top < lh * 0.8 : box.bottom - rect.bottom < lh * 0.8;
};

const pointRange = (x, y) => {
  if (document.caretRangeFromPoint) return document.caretRangeFromPoint(x, y);
  const pos = document.caretPositionFromPoint?.(x, y);
  if (!pos) return null;
  const range = document.createRange();
  range.setStart(pos.offsetNode, pos.offset);
  return range;
};

// Lands the caret in a block at the same horizontal position it left the last one.
const placeAtX = (el, x, edge) => {
  const box = el.getBoundingClientRect();
  const lh = lineHeightOf(el);
  const y = edge === "top" ? box.top + lh / 2 : box.bottom - lh / 2;
  const range = pointRange(Math.max(box.left + 1, Math.min(x, box.right - 1)), y);
  if (range && el.contains(range.startContainer)) {
    el.focus({ preventScroll: true });
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  } else placeCaret(el, edge === "top" ? 0 : null);
};

const exec = (cmd) => document.execCommand(cmd, false, null);

const textOf = (html) => plainText(html).trim();
const isAllCaps = (s) => /\p{L}/u.test(s) && s === s.toUpperCase();
const stripParens = (html) => {
  let out = String(html || "").trim();
  if (out.startsWith("(")) out = out.slice(1);
  if (out.endsWith(")")) out = out.slice(0, -1);
  return out;
};

// Typing one of these as the whole content of an Action line turns it into
// another element. `keep` leaves what you typed in place (INT. stays INT.).
const PREFIXES = [
  { test: /^(int|ext|est|int\.?\/ext|i\/e)\.?\s$/i, type: "scene", keep: true },
  { test: /^##\s$/, type: "sequence" },
  { test: /^#\s$/, type: "act" },
  { test: /^@$/, type: "character" },
  { test: /^\($/, type: "parenthetical" },
  { test: /^><\s?$/, type: "centered" },
  { test: /^>\s$/, type: "transition" },
  { test: /^~$/, type: "lyrics" },
  { test: /^=\s$/, type: "subtext" },
  { test: /^\[\[$/, type: "note" },
  { test: /^!!\s$/, type: "shot" },
  { test: /^===$/, type: "pagebreak" },
];

const slashMatches = (query) => {
  if (!query) return TYPES;
  const q = query.toLowerCase();
  const scored = [];
  for (const t of TYPES) {
    const label = t.label.toLowerCase();
    const words = t.words.split(/\s+/);
    let score = -1;
    if (label.startsWith(q)) score = 0;
    else if (words.some((w) => w === q)) score = 1;
    else if (words.some((w) => w.startsWith(q))) score = 2;
    if (score >= 0) scored.push({ t, score });
  }
  return scored.sort((a, b) => a.score - b.score).map((s) => s.t);
};

const hotkeyLabel = (t) => `Ctrl+${t.hotkey}`;

// ---------------------------------------------------------------------------
// One line of the script
// ---------------------------------------------------------------------------
const Block = memo(function Block({ block, number, selected, active, focusAt, lonely, dropMark, autocomplete, api }) {
  const ref = useRef(null);
  const handleRef = useRef(null);
  const [slash, setSlash] = useState(null);
  const [sugOpen, setSugOpen] = useState(false);
  const [sugIndex, setSugIndex] = useState(0);
  const type = TYPE_BY_KEY[block.type] || TYPE_BY_KEY.action;

  // The DOM is the source of truth while you type; state only pushes into it when
  // something else changed the block (undo, a split, a merge, a paste).
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || el.innerHTML === block.html) return;
    const focused = document.activeElement === el;
    const offset = focused ? caretOffset(el) : null;
    el.innerHTML = block.html;
    if (focused) placeCaret(el, offset);
  }, [block.html, block.type]);

  useLayoutEffect(() => {
    if (!focusAt) return;
    const el = ref.current;
    if (el) {
      if (el.innerHTML !== block.html) el.innerHTML = block.html;
      const at = focusAt.at;
      if (at && typeof at === "object") placeAtX(el, at.x, at.edge);
      else placeCaret(el, at === "end" ? null : at === "start" ? 0 : at ?? null);
      if (focusAt.scroll) el.scrollIntoView({ block: "center", behavior: "smooth" });
      else api.keepInView(el);
    }
    api.focused();
  }, [focusAt]);

  const suggestions = useMemo(() => {
    if (!active || !sugOpen || !autocomplete || slash) return [];
    return suggestionsFor(block.type, plainText(block.html), api.blocks(), block.id);
  }, [active, sugOpen, autocomplete, slash, block.html, block.type, block.id, api]);

  const save = () => ref.current && api.patch(block.id, { html: ref.current.innerHTML }, { typing: true });

  const accept = (item) => {
    const el = ref.current;
    let value = item.value;
    // a location without a time gets its dash, so the times come up next
    const keepOpen = block.type === "scene" && (/^(INT|EXT|EST|INT\.\/EXT)\.\s$/.test(value) || !/ - /.test(value));
    if (block.type === "scene" && keepOpen && !/\.\s$/.test(value)) value += " - ";
    el.innerHTML = escapeHtml(value);
    api.patch(block.id, { html: el.innerHTML }, { typing: true });
    placeCaret(el);
    setSugIndex(0);
    setSugOpen(keepOpen);
  };

  const pickSlash = (t) => {
    const el = ref.current;
    if (slash) deleteFromOffset(el, slash.start);
    setSlash(null);
    if (t.key === "pagebreak") {
      api.insertPageBreak(block.id, el.innerHTML);
      return;
    }
    api.patch(block.id, { type: t.key, html: el.innerHTML });
    setSugOpen(true);
  };

  const onInput = () => {
    const el = ref.current;
    // an emptied contenteditable keeps a stray <br>, which hides the placeholder
    if (!el.textContent && el.innerHTML !== "") el.innerHTML = "";
    const text = el.textContent;
    const caret = caretOffset(el);

    if (block.type === "action" && !slash) {
      const rule = PREFIXES.find((r) => r.test.test(text));
      if (rule) {
        if (rule.type === "pagebreak") {
          el.innerHTML = "";
          api.insertPageBreak(block.id, "");
          return;
        }
        if (!rule.keep) el.innerHTML = "";
        api.patch(block.id, { type: rule.type, html: rule.keep ? escapeHtml(text.toUpperCase()) : "" }, { focus: "end" });
        setSugOpen(true);
        return;
      }
    }

    let slashOpen = Boolean(slash);
    if (caret !== null) {
      if (slash) {
        const raw = text.slice(slash.start + 1, caret);
        if (caret <= slash.start || raw.includes(" ") || raw.length > 16) {
          setSlash(null);
          slashOpen = false;
        } else setSlash({ ...slash, query: raw, index: 0 });
      } else if (text[caret - 1] === "/" && (caret === 1 || /\s/.test(text[caret - 2]))) {
        setSlash({ start: caret - 1, query: "", index: 0 });
        slashOpen = true;
      }
    }

    if (!slashOpen) {
      setSugOpen(true);
      setSugIndex(0);
    }
    api.patch(block.id, { html: el.innerHTML }, { typing: true });
    api.typed();
  };

  const onKeyDown = (e) => {
    const el = ref.current;
    const mod = e.ctrlKey || e.metaKey;
    const key = e.key;

    if (slash) {
      const matches = slashMatches(slash.query);
      if (matches.length && (key === "ArrowDown" || key === "ArrowUp")) {
        e.preventDefault();
        setSlash((s) => ({ ...s, index: (s.index + (key === "ArrowDown" ? 1 : -1) + matches.length) % matches.length }));
        return;
      }
      if (matches.length && (key === "Enter" || key === "Tab")) {
        e.preventDefault();
        pickSlash(matches[slash.index % matches.length]);
        return;
      }
      if (key === "Escape") {
        setSlash(null);
        return;
      }
    }

    if (suggestions.length && !mod) {
      if (key === "ArrowDown" || key === "ArrowUp") {
        e.preventDefault();
        setSugIndex((i) => (i + (key === "ArrowDown" ? 1 : -1) + suggestions.length) % suggestions.length);
        return;
      }
      if (key === "Tab" && !e.shiftKey) {
        e.preventDefault();
        accept(suggestions[sugIndex % suggestions.length]);
        return;
      }
      if (key === "Enter" && !e.shiftKey && block.type === "character") {
        // Enter takes the name and carries on into the dialogue, like Final Draft
        accept(suggestions[sugIndex % suggestions.length]);
      } else if (key === "Escape") {
        setSugOpen(false);
        return;
      }
    }

    if (mod && !e.altKey) {
      const k = key.toLowerCase();
      if (k === "z" && !e.shiftKey) {
        e.preventDefault();
        api.undo();
        return;
      }
      if (k === "y" || (k === "z" && e.shiftKey)) {
        e.preventDefault();
        api.redo();
        return;
      }
      const hot = typeForHotkey(e);
      if (hot) {
        e.preventDefault();
        if (hot === "pagebreak") api.insertPageBreak(block.id, el.innerHTML);
        else api.setType(block.id, hot);
        setSugOpen(true);
        return;
      }
      if (!e.shiftKey && (k === "b" || k === "i" || k === "u")) {
        e.preventDefault();
        exec({ b: "bold", i: "italic", u: "underline" }[k]);
        save();
        return;
      }
      if (k === "a") {
        const sel = window.getSelection();
        const all = !el.textContent || sel.toString().length >= el.textContent.length;
        if (all) {
          e.preventDefault();
          api.selectAll();
        }
        return;
      }
      return;
    }

    if (key === "Enter") {
      e.preventDefault();
      if (e.shiftKey) {
        exec("insertLineBreak");
        save();
        return;
      }
      sfx.type("ret");
      sfx.type("bell");
      const sel = window.getSelection();
      if (!sel.rangeCount) return;
      const range = sel.getRangeAt(0);
      if (!range.collapsed) range.deleteContents();
      const tail = document.createRange();
      tail.setStart(range.endContainer, range.endOffset);
      tail.setEnd(el, el.childNodes.length);
      const carried = document.createElement("div");
      carried.appendChild(tail.extractContents());
      const before = el.innerHTML;
      setSugOpen(false);
      api.enter(block.id, textOf(before) ? before : "", textOf(carried.innerHTML) ? carried.innerHTML : "");
      return;
    }

    if (key === "Tab") {
      e.preventDefault();
      api.cycle(block.id, e.shiftKey ? -1 : 1);
      setSugOpen(true);
      return;
    }

    if ((key === "ArrowUp" || key === "ArrowDown") && !e.shiftKey && !e.altKey) {
      const dir = key === "ArrowUp" ? -1 : 1;
      if (atLineEdge(el, dir)) {
        const rect = caretRect();
        const x = rect ? rect.left : el.getBoundingClientRect().left;
        if (api.move(block.id, dir, x)) e.preventDefault();
      }
      return;
    }

    if (key === "Backspace") {
      const sel = window.getSelection();
      if (sel.rangeCount && sel.getRangeAt(0).collapsed && caretOffset(el) === 0) {
        e.preventDefault();
        setSugOpen(false);
        api.backspace(block.id, el.innerHTML);
      }
      return;
    }

    if (key === "Delete") {
      const sel = window.getSelection();
      if (sel.rangeCount && sel.getRangeAt(0).collapsed && caretOffset(el) >= el.textContent.length) {
        e.preventDefault();
        api.deleteForward(block.id, el.innerHTML);
      }
      return;
    }

    if (key.length === 1) sfx.type("key");
  };

  const onPaste = (e) => {
    const text = e.clipboardData?.getData("text/plain") || "";
    e.preventDefault();
    if (!text) return;
    if (!/\n/.test(text.trim())) {
      document.execCommand("insertText", false, text.replace(/\s+/g, " "));
      return;
    }
    const { blocks } = parseFountain(text);
    if (!blocks.length) return;
    const el = ref.current;
    const sel = window.getSelection();
    if (!sel.rangeCount) return;
    const range = sel.getRangeAt(0);
    range.deleteContents();
    const tail = document.createRange();
    tail.setStart(range.endContainer, range.endOffset);
    tail.setEnd(el, el.childNodes.length);
    const carried = document.createElement("div");
    carried.appendChild(tail.extractContents());
    api.paste(block.id, el.innerHTML, carried.innerHTML, blocks);
  };

  const onBlur = () => {
    setSugOpen(false);
    setSlash(null);
    if (block.type === "parenthetical") {
      const el = ref.current;
      const clean = stripParens(el.innerHTML);
      if (clean !== el.innerHTML.trim()) api.patch(block.id, { html: clean }, { typing: true });
    }
  };

  const slashList = slash ? slashMatches(slash.query) : [];

  return (
    <div
      className="block"
      data-row-id={block.id}
      data-type={block.type}
      data-selected={selected}
      data-active={active}
      data-drop={dropMark || undefined}
    >
      <div className="block-gutter">
        <div
          ref={handleRef}
          className="block-handle"
          role="button"
          tabIndex={-1}
          title={`${type.label} · click for options, drag to move`}
          onPointerDown={(e) => api.handleDown(e, block.id, handleRef)}
        >
          {type.icon}
        </div>
        {number != null && <span className="scene-num">{number}</span>}
      </div>

      {block.type === "pagebreak" ? (
        <div
          className="pagebreak"
          onMouseDown={(e) => {
            e.preventDefault();
            api.selectOnly(block.id);
          }}
        >
          <span>Page Break</span>
        </div>
      ) : (
        <div
          ref={ref}
          className="block-body"
          contentEditable
          suppressContentEditableWarning
          spellCheck
          data-block-id={block.id}
          data-placeholder={type.placeholder}
          data-lonely={lonely || undefined}
          onInput={onInput}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          onFocus={() => {
            api.activate(block.id);
            if (!textOf(block.html)) setSugOpen(true);
          }}
          onBlur={onBlur}
        />
      )}
      {number != null && <span className="scene-num scene-num-right">{number}</span>}

      {slash && slashList.length > 0 && (
        <Popover anchorRef={ref} width={250} className="slash-menu" onClose={() => setSlash(null)}>
          <span className="menu-label">Elements</span>
          {slashList.map((t, i) => (
            <button
              key={t.key}
              className="menu-item"
              data-on={i === slash.index % slashList.length}
              onMouseDown={(e) => {
                e.preventDefault();
                pickSlash(t);
              }}
            >
              <span className="menu-icon">{t.icon}</span>
              {t.label}
              <span className="menu-hint">{hotkeyLabel(t)}</span>
            </button>
          ))}
        </Popover>
      )}

      {suggestions.length > 0 && (
        <Popover anchorRef={ref} width={260} className="suggest-menu" onClose={() => setSugOpen(false)}>
          {suggestions.map((s, i) => (
            <button
              key={s.value}
              className="menu-item"
              data-on={i === sugIndex % suggestions.length}
              onMouseDown={(e) => {
                e.preventDefault();
                accept(s);
              }}
            >
              {s.label}
              {i === sugIndex % suggestions.length && <span className="menu-hint">Tab</span>}
            </button>
          ))}
        </Popover>
      )}
    </div>
  );
});

// ---------------------------------------------------------------------------
// Handle menu
// ---------------------------------------------------------------------------
function BlockMenu({ anchorRef, block, onPick, onInsert, onDuplicate, onDelete, onClose }) {
  return (
    <Popover anchorRef={anchorRef} width={240} className="block-menu" onClose={onClose}>
      <span className="menu-label">Turn into</span>
      {TYPES.filter((t) => t.key !== "pagebreak").map((t) => (
        <button key={t.key} className="menu-item" data-on={block.type === t.key} onClick={() => onPick(t.key)}>
          <span className="menu-icon">{t.icon}</span>
          {t.label}
          <span className="menu-hint">{hotkeyLabel(t)}</span>
        </button>
      ))}
      <div className="menu-sep" />
      <button className="menu-item" onClick={() => onInsert(0)}>
        <span className="menu-icon">↑</span>Insert Above
      </button>
      <button className="menu-item" onClick={() => onInsert(1)}>
        <span className="menu-icon">↓</span>Insert Below
      </button>
      <button className="menu-item" onClick={onDuplicate}>
        <span className="menu-icon">⧉</span>Duplicate
      </button>
      <button className="menu-item menu-danger" onClick={onDelete}>
        <span className="menu-icon">×</span>Delete
        <span className="menu-hint">Del</span>
      </button>
    </Popover>
  );
}

// ---------------------------------------------------------------------------
// The editor
// ---------------------------------------------------------------------------
const HISTORY_LIMIT = 300;

const ScriptEditor = forwardRef(function ScriptEditor({ blocks, onChange, onActive, settings, jump }, outerRef) {
  const rootRef = useRef(null);
  const blocksRef = useRef(blocks);
  blocksRef.current = blocks;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onActiveRef = useRef(onActive);
  onActiveRef.current = onActive;
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const [focusReq, setFocusReq] = useState(null);
  const [activeId, setActiveId] = useState(null);
  const [selected, setSelected] = useState(() => new Set());
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const anchorRef = useRef(null);
  const [menu, setMenu] = useState(null);
  const [drop, setDrop] = useState(null);
  const hist = useRef({ past: [], future: [], lastKind: null, lastAt: 0, lastId: null });

  const focusSnapshot = () => {
    const el = document.activeElement;
    const id = el?.dataset?.blockId;
    if (!id) return null;
    return { id, at: caretOffset(el) };
  };

  const indexOf = (id) => blocksRef.current.findIndex((b) => b.id === id);

  // Every change goes through here, so every change can be undone.
  const commit = useCallback((next, { focus, typing = false, id = null } = {}) => {
    const h = hist.current;
    const now = Date.now();
    const coalesce = typing && h.lastKind === "typing" && h.lastId === id && now - h.lastAt < 1200;
    if (!coalesce) {
      h.past.push({ blocks: blocksRef.current, focus: focusSnapshot() });
      if (h.past.length > HISTORY_LIMIT) h.past.shift();
    }
    h.future = [];
    h.lastKind = typing ? "typing" : "edit";
    h.lastAt = now;
    h.lastId = id;
    blocksRef.current = next;
    onChangeRef.current(next);
    if (focus) setFocusReq({ ...focus, t: now + Math.random() });
  }, []);

  const replaceAt = (list, i, block) => [...list.slice(0, i), block, ...list.slice(i + 1)];

  const clearSelection = useCallback(() => {
    if (selectedRef.current.size) setSelected(new Set());
  }, []);

  const applyHistory = (from, to) => {
    const h = hist.current;
    if (!h[from].length) {
      sfx.play("error");
      return;
    }
    // Snapshot the caret, then let go of the block before touching the stacks: a
    // blur can tidy a parenthetical, and that commit must land before we pop.
    const focus = focusSnapshot();
    document.activeElement?.blur?.();
    if (!h[from].length) return;
    const entry = h[from].pop();
    h[to].push({ blocks: blocksRef.current, focus });
    h.lastKind = null;
    blocksRef.current = entry.blocks;
    onChangeRef.current(entry.blocks);
    clearSelection();
    const target = entry.focus && entry.blocks.some((b) => b.id === entry.focus.id) ? entry.focus : null;
    setFocusReq(target ? { ...target, t: Date.now() } : null);
    if (!target) rootRef.current?.focus({ preventScroll: true });
  };

  const removeIds = (ids) => {
    const list = blocksRef.current;
    const first = list.findIndex((b) => ids.has(b.id));
    let next = list.filter((b) => !ids.has(b.id));
    if (!next.length) next = [emptyBlock("scene")];
    const neighbour = next[Math.min(Math.max(0, first - 1), next.length - 1)];
    commit(next, { focus: neighbour.type === "pagebreak" ? null : { id: neighbour.id, at: "end" } });
    setSelected(new Set());
    sfx.play("remove");
  };

  const api = useMemo(
    () => ({
      blocks: () => blocksRef.current,
      focused: () => setFocusReq(null),
      activate: (id) => {
        setActiveId(id);
        onActiveRef.current?.(id);
        if (selectedRef.current.size) setSelected(new Set());
      },
      typed: () => {
        if (settingsRef.current.typewriterScroll) {
          const rect = caretRect();
          if (rect) {
            const delta = rect.top - window.innerHeight * 0.42;
            if (Math.abs(delta) > 24) window.scrollBy({ top: delta, behavior: "smooth" });
          }
        }
      },
      keepInView: (el) => {
        const r = el.getBoundingClientRect();
        if (r.bottom > window.innerHeight - 90 || r.top < 150) {
          el.scrollIntoView({ block: settingsRef.current.typewriterScroll ? "center" : "nearest", behavior: "smooth" });
        }
      },
      patch: (id, changes, { typing = false, focus } = {}) => {
        const list = blocksRef.current;
        const i = list.findIndex((b) => b.id === id);
        if (i < 0) return;
        commit(replaceAt(list, i, { ...list[i], ...changes }), {
          typing,
          id,
          focus: focus ? { id, at: focus } : undefined,
        });
      },
      setType: (id, type) => {
        const ids = selectedRef.current.size ? selectedRef.current : new Set([id]);
        commit(blocksRef.current.map((b) => (ids.has(b.id) && b.type !== "pagebreak" ? { ...b, type } : b)));
      },
      cycle: (id, dir) => {
        const list = blocksRef.current;
        const i = list.findIndex((b) => b.id === id);
        if (i < 0) return;
        const pos = TAB_ORDER.indexOf(list[i].type);
        const type = TAB_ORDER[(Math.max(0, pos) + dir + TAB_ORDER.length) % TAB_ORDER.length];
        commit(replaceAt(list, i, { ...list[i], type }));
      },
      enter: (id, beforeHtml, afterHtml) => {
        const list = blocksRef.current;
        const i = list.findIndex((b) => b.id === id);
        if (i < 0) return;
        const b = list[i];
        const beforeText = textOf(beforeHtml);
        const afterText = textOf(afterHtml);

        // Enter on an empty line changes what it is rather than piling up blanks:
        // an empty Character becomes Action, an empty Action becomes Character.
        if (!beforeText && !afterText) {
          const type = b.type === "action" ? "character" : "action";
          commit(replaceAt(list, i, { ...b, type, html: "" }), { focus: { id: b.id, at: "start" } });
          return;
        }
        // Enter at the very start pushes the line down and leaves a fresh one above.
        if (!beforeText) {
          const above = emptyBlock(b.type === "scene" ? "scene" : "action");
          commit([...list.slice(0, i), above, { ...b, html: afterHtml }, ...list.slice(i + 1)], {
            focus: { id: b.id, at: "start" },
          });
          return;
        }

        let type = b.type;
        let html = beforeHtml;
        // "cut to:" / "SMASH CUT TO:" on its own line is a transition, however it was typed
        if (type === "action" && !afterText && beforeText.length <= 30 && /^[\p{L} .'-]+ to:$/iu.test(beforeText)) {
          type = "transition";
          html = escapeHtml(beforeText.toUpperCase());
        }
        if (type === "parenthetical") html = stripParens(html);
        const nb = emptyBlock(afterText ? type : NEXT[type] || "action", afterHtml);
        commit([...list.slice(0, i), { ...b, type, html }, nb, ...list.slice(i + 1)], {
          focus: { id: nb.id, at: "start" },
        });
      },
      backspace: (id, html) => {
        const list = blocksRef.current;
        const i = list.findIndex((b) => b.id === id);
        if (i < 0) return;
        const b = list[i];
        if (!textOf(html)) {
          if (list.length === 1) {
            if (b.type !== "action") commit(replaceAt(list, i, { ...b, type: "action", html: "" }), { focus: { id, at: "start" } });
            return;
          }
          const next = list.filter((x) => x.id !== id);
          let j = i - 1;
          while (j >= 0 && next[j]?.type === "pagebreak") j -= 1;
          const target = j >= 0 ? next[j] : next.find((x) => x.type !== "pagebreak");
          commit(next, { focus: target ? { id: target.id, at: j >= 0 ? "end" : "start" } : null });
          return;
        }
        if (b.type !== "action") {
          commit(replaceAt(list, i, { ...b, type: "action", html }), { focus: { id, at: "start" } });
          return;
        }
        if (i === 0) return;
        const prev = list[i - 1];
        if (prev.type === "pagebreak") {
          commit(list.filter((x) => x.id !== prev.id), { focus: { id, at: "start" } });
          return;
        }
        const join = plainText(prev.html).length;
        commit([...list.slice(0, i - 1), { ...prev, html: prev.html + html }, ...list.slice(i + 1)], {
          focus: { id: prev.id, at: join },
        });
      },
      deleteForward: (id, html) => {
        const list = blocksRef.current;
        const i = list.findIndex((b) => b.id === id);
        const next = list[i + 1];
        if (i < 0 || !next) return;
        const join = plainText(html).length;
        if (next.type === "pagebreak") {
          commit(list.filter((x) => x.id !== next.id), { focus: { id, at: join } });
          return;
        }
        commit([...list.slice(0, i), { ...list[i], html: html + next.html }, ...list.slice(i + 2)], {
          focus: { id, at: join },
        });
      },
      move: (id, dir, x) => {
        const list = blocksRef.current;
        let j = list.findIndex((b) => b.id === id) + dir;
        while (list[j] && list[j].type === "pagebreak") j += dir;
        if (!list[j]) return false;
        setFocusReq({ id: list[j].id, at: { x, edge: dir < 0 ? "bottom" : "top" }, t: Date.now() });
        return true;
      },
      insertPageBreak: (id, html) => {
        const list = blocksRef.current;
        const i = list.findIndex((b) => b.id === id);
        if (i < 0) return;
        const brk = emptyBlock("pagebreak");
        const after = emptyBlock("scene");
        const keep = textOf(html) ? [{ ...list[i], html }] : [];
        commit([...list.slice(0, i), ...keep, brk, after, ...list.slice(i + 1)], { focus: { id: after.id, at: "start" } });
      },
      paste: (id, beforeHtml, afterHtml, parsed) => {
        const list = blocksRef.current;
        const i = list.findIndex((b) => b.id === id);
        if (i < 0) return;
        const b = list[i];
        const head = textOf(beforeHtml) ? [{ ...b, html: beforeHtml }] : [];
        const tail = textOf(afterHtml) ? [emptyBlock(b.type, afterHtml)] : [];
        const last = parsed[parsed.length - 1];
        commit([...list.slice(0, i), ...head, ...parsed, ...tail, ...list.slice(i + 1)], {
          focus: last.type === "pagebreak" ? null : { id: last.id, at: "end" },
        });
      },
      undo: () => applyHistory("past", "future"),
      redo: () => applyHistory("future", "past"),
      selectAll: () => {
        document.activeElement?.blur?.();
        setSelected(new Set(blocksRef.current.map((b) => b.id)));
        rootRef.current?.focus({ preventScroll: true });
      },
      selectOnly: (id) => {
        document.activeElement?.blur?.();
        anchorRef.current = id;
        setSelected(new Set([id]));
        rootRef.current?.focus({ preventScroll: true });
      },
      handleDown: (e, id, handleRef) => {
        if (e.button !== 0) return;
        e.preventDefault();
        const startY = e.clientY;
        const shift = e.shiftKey;
        let dragging = false;
        let target = null;

        const rows = () => [...rootRef.current.querySelectorAll(":scope > .block")];
        const onMove = (ev) => {
          if (!dragging && Math.abs(ev.clientY - startY) > 4) {
            dragging = true;
            document.body.classList.add("is-dragging");
          }
          if (!dragging) return;
          const list = rows();
          let idx = list.length;
          for (let k = 0; k < list.length; k++) {
            const r = list[k].getBoundingClientRect();
            if (ev.clientY < r.top + r.height / 2) {
              idx = k;
              break;
            }
          }
          target = idx;
          setDrop(idx < list.length ? { id: list[idx].dataset.rowId, side: "top" } : { id: list[list.length - 1].dataset.rowId, side: "bottom" });
        };
        const onUp = () => {
          window.removeEventListener("pointermove", onMove);
          window.removeEventListener("pointerup", onUp);
          document.body.classList.remove("is-dragging");
          setDrop(null);
          if (!dragging) {
            if (shift) {
              const list = blocksRef.current;
              const a = list.findIndex((b) => b.id === (anchorRef.current || id));
              const z = list.findIndex((b) => b.id === id);
              const [lo, hi] = a < z ? [a, z] : [z, a];
              document.activeElement?.blur?.();
              setSelected(new Set(list.slice(lo, hi + 1).map((b) => b.id)));
              rootRef.current?.focus({ preventScroll: true });
              return;
            }
            anchorRef.current = id;
            setMenu({ id, anchor: handleRef });
            return;
          }
          if (target === null) return;
          const list = blocksRef.current;
          const moving = selectedRef.current.has(id) ? selectedRef.current : new Set([id]);
          const before = list.slice(0, target).filter((b) => !moving.has(b.id));
          const after = list.slice(target).filter((b) => !moving.has(b.id));
          const moved = list.filter((b) => moving.has(b.id));
          const next = [...before, ...moved, ...after];
          if (next.every((b, k) => b === list[k])) return;
          commit(next);
          sfx.play("tap");
        };
        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
      },
    }),
    [commit]
  );

  // The page's toolbar drives the editor through this.
  useImperativeHandle(
    outerRef,
    () => ({
      setType: (type) => {
        const id = activeId;
        if (!id && !selectedRef.current.size) return;
        const el = id ? rootRef.current?.querySelector(`[data-block-id="${id}"]`) : null;
        if (type === "pagebreak") {
          if (id) api.insertPageBreak(id, el?.innerHTML || "");
          return;
        }
        api.setType(id, type);
        if (el && !selectedRef.current.size) {
          const at = caretOffset(el);
          setFocusReq({ id, at: at ?? "end", t: Date.now() });
        }
      },
      format: (cmd) => {
        exec(cmd);
        const el = document.activeElement;
        if (el?.dataset?.blockId) api.patch(el.dataset.blockId, { html: el.innerHTML }, { typing: true });
      },
      undo: api.undo,
      redo: api.redo,
    }),
    [activeId, api]
  );

  // A fresh script is ready to type into the moment it opens.
  useEffect(() => {
    const list = blocksRef.current;
    if (list.length === 1 && !textOf(list[0].html)) setFocusReq({ id: list[0].id, at: "start", t: Date.now() });
  }, []);

  // Clicking a scene in the sidebar.
  useEffect(() => {
    if (!jump) return;
    if (blocksRef.current.some((b) => b.id === jump.id)) setFocusReq({ id: jump.id, at: "end", scroll: true, t: Date.now() });
  }, [jump]);

  // Keys while whole blocks are selected (Ctrl+A twice, Shift+click on handles).
  const onRootKeyDown = (e) => {
    if (!selectedRef.current.size || e.target !== rootRef.current) return;
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    if (e.key === "Backspace" || e.key === "Delete") {
      e.preventDefault();
      removeIds(selectedRef.current);
      return;
    }
    if (e.key === "Escape") {
      setSelected(new Set());
      return;
    }
    if (mod && (k === "c" || k === "x")) {
      e.preventDefault();
      const picked = blocksRef.current.filter((b) => selectedRef.current.has(b.id));
      const text = toFountain({ blocks: picked }, { titlePage: false, includeNotes: true, includeSubtext: true });
      navigator.clipboard?.writeText(text).catch(() => {});
      if (k === "x") removeIds(selectedRef.current);
      return;
    }
    if (mod && k === "a") {
      e.preventDefault();
      api.selectAll();
      return;
    }
    if (mod && (k === "z" || k === "y")) {
      e.preventDefault();
      if (k === "y" || e.shiftKey) api.redo();
      else api.undo();
      return;
    }
    const hot = mod ? typeForHotkey(e) : null;
    if (hot && hot !== "pagebreak") {
      e.preventDefault();
      api.setType(null, hot);
    }
  };

  // Undo still works with nothing focused, e.g. right after a block delete.
  const onRootKeyDownPlain = (e) => {
    if (selectedRef.current.size) return onRootKeyDown(e);
    if (e.target !== rootRef.current) return;
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    if (mod && (k === "z" || k === "y")) {
      e.preventDefault();
      if (k === "y" || e.shiftKey) api.redo();
      else api.undo();
    }
  };

  useEffect(() => {
    if (!selected.size) return;
    const onDown = (e) => {
      if (e.target.closest?.(".block-handle, .popover")) return;
      setSelected(new Set());
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [selected]);

  const sceneNumbers = useMemo(() => {
    const map = {};
    let n = 0;
    for (const b of blocks) if (b.type === "scene") map[b.id] = ++n;
    return map;
  }, [blocks]);

  const menuBlock = menu ? blocks.find((b) => b.id === menu.id) : null;
  const lonely = blocks.length === 1;

  return (
    <div
      ref={rootRef}
      className="editor"
      tabIndex={-1}
      data-scene-numbers={settings.sceneNumbers}
      data-selecting={selected.size > 0}
      onKeyDown={onRootKeyDownPlain}
    >
      {blocks.map((b) => (
        <Block
          key={b.id}
          block={b}
          number={settings.sceneNumbers && b.type === "scene" ? sceneNumbers[b.id] : null}
          selected={selected.has(b.id)}
          active={activeId === b.id}
          focusAt={focusReq && focusReq.id === b.id ? focusReq : null}
          lonely={lonely}
          dropMark={drop && drop.id === b.id ? drop.side : null}
          autocomplete={settings.autocomplete}
          api={api}
        />
      ))}
      <div
        className="editor-tail"
        onMouseDown={(e) => {
          e.preventDefault();
          const list = blocksRef.current;
          const last = list[list.length - 1];
          if (last && last.type !== "pagebreak" && !textOf(last.html)) {
            setFocusReq({ id: last.id, at: "end", t: Date.now() });
            return;
          }
          const nb = emptyBlock(last ? NEXT[last.type] || "action" : "scene");
          commit([...list, nb], { focus: { id: nb.id, at: "start" } });
        }}
      />

      {menuBlock && (
        <BlockMenu
          anchorRef={menu.anchor}
          block={menuBlock}
          onClose={() => setMenu(null)}
          onPick={(type) => {
            setMenu(null);
            api.setType(menuBlock.id, type);
            if (menuBlock.type === "pagebreak") return;
            setFocusReq({ id: menuBlock.id, at: "end", t: Date.now() });
          }}
          onInsert={(side) => {
            setMenu(null);
            const list = blocksRef.current;
            const i = list.findIndex((b) => b.id === menuBlock.id);
            const nb = emptyBlock("action");
            commit([...list.slice(0, i + side), nb, ...list.slice(i + side)], { focus: { id: nb.id, at: "start" } });
          }}
          onDuplicate={() => {
            setMenu(null);
            const list = blocksRef.current;
            const i = list.findIndex((b) => b.id === menuBlock.id);
            const copy = { ...menuBlock, id: uid() };
            commit([...list.slice(0, i + 1), copy, ...list.slice(i + 1)], {
              focus: copy.type === "pagebreak" ? null : { id: copy.id, at: "end" },
            });
          }}
          onDelete={() => {
            setMenu(null);
            removeIds(new Set([menuBlock.id]));
          }}
        />
      )}
    </div>
  );
});

export default ScriptEditor;
