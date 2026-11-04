import { forwardRef, memo, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Popover from "./Popover";
import Swatches from "./Swatches";
import ChangeRow from "./ChangeRow";
import NewColor from "./NewColor";
import {
  emptyBlock,
  suggestionsFor,
  plainText,
  escapeHtml,
  characterName,
} from "../lib/script";
import { colorForKey, paletteOf } from "../lib/colors";
import { SCRIPT_PROFILE, LIST_TYPES, MAX_INDENT } from "../lib/profiles";
import { useStore } from "../lib/store";
import { SPELL_SUPPORTED, useSpellcheck } from "../lib/spell";
import { sfx } from "../lib/sound";
import { uid } from "../lib/storage";
import { uiZoom } from "../lib/zoom";

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

// Text offset of where a selection's moving end is, inside one element.
const focusOffset = (el) => {
  const sel = window.getSelection();
  if (!sel.focusNode || !el.contains(sel.focusNode)) return null;
  const probe = document.createRange();
  probe.selectNodeContents(el);
  probe.setEnd(sel.focusNode, sel.focusOffset);
  return probe.toString().length;
};

// The DOM position of a text offset inside one element, as [node, offset].
const textPoint = (el, offset) => {
  let left = offset;
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let node = null;
  while (walker.nextNode()) {
    node = walker.currentNode;
    if (node.length >= left) return [node, left];
    left -= node.length;
  }
  return node ? [node, node.length] : [el, 0];
};

// Removes the characters between two text offsets and leaves the caret there.
const deleteBetween = (el, start, end) => {
  const range = document.createRange();
  range.setStart(...textPoint(el, start));
  range.setEnd(...textPoint(el, Math.max(start, end)));
  range.deleteContents();
  el.normalize();
  placeCaret(el, start);
};

const caretRect = () => {
  const sel = window.getSelection();
  if (!sel.rangeCount) return null;
  const range = sel.getRangeAt(0).cloneRange();
  range.collapse(true);
  return range.getClientRects()[0] || null;
};

const focusRect = () => {
  const sel = window.getSelection();
  if (!sel.focusNode) return null;
  const range = document.createRange();
  range.setStart(sel.focusNode, sel.focusOffset);
  return range.getClientRects()[0] || null;
};

const lineHeightOf = (el) => parseFloat(getComputedStyle(el).lineHeight) || 24;

// Arrow keys leave a block from its first or last visual line, not only from its
// very first or last character.
const atLineEdge = (el, dir, rect = caretRect()) => {
  if (!rect) return true;
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

// Bold, italic and underline go in as plain tags, which Fountain export and print
// understand; only colour needs a styled span.
// A formatting command fires an input event of its own. Lines ignore those (see
// onInput): whoever ran the command saves the result as one undo step, rather than
// it being half-saved as typing first.
let commandRunning = false;
const exec = (cmd, value = null) => {
  commandRunning = true;
  try {
    document.execCommand("styleWithCSS", false, cmd === "foreColor");
    document.execCommand(cmd, false, value);
  } finally {
    commandRunning = false;
  }
};

// Pasted or older text often carries its own colour; clearing it first means a
// new colour actually takes instead of losing to a nested span.
const stripColor = (el) => {
  el.style.color = "";
  el.removeAttribute("color");
  if (!el.getAttribute("style")) el.removeAttribute("style");
};

const clearColorsIn = (range) => {
  const scope =
    range.commonAncestorContainer.nodeType === 1 ? range.commonAncestorContainer : range.commonAncestorContainer.parentElement;
  scope?.querySelectorAll("[style*='color'], font[color]").forEach((el) => {
    if (!range.intersectsNode(el) || el.dataset?.blockId) return;
    stripColor(el);
  });
};

// Taking the colour off exactly what's highlighted. The browser only knows how to set a
// colour, splitting any span the highlight sits inside, so this sets a marker colour and
// then takes the marker off. On a line with a colour of its own there'd be nothing to fall
// back to but that colour, so those words get the page's ordinary ink instead.
const MARK = "#010203";
const MARK_RGB = "rgb(1, 2, 3)";
const clearSelectionColor = (sel) => {
  const start = sel.getRangeAt(0).commonAncestorContainer;
  const scope = (start.nodeType === 1 ? start : start.parentElement)?.closest(".editor");
  if (!scope) return;
  exec("foreColor", MARK);
  const range = sel.rangeCount ? sel.getRangeAt(0) : null;
  const ends = range && [range.startContainer, range.startOffset, range.endContainer, range.endOffset];
  const marked = [...scope.querySelectorAll("span, font")].filter((el) => el.style.color === MARK_RGB || el.getAttribute("color") === MARK);
  for (const el of marked) {
    el.querySelectorAll("[style*='color'], font[color]").forEach(stripColor);
    const body = el.closest("[data-block-id]");
    const outer = el.parentElement?.closest("span[style*='color'], font[color]");
    if (body?.style.color || (outer && body?.contains(outer))) {
      el.removeAttribute("color");
      el.style.color = "var(--paperInk)";
      continue;
    }
    stripColor(el);
    if (!el.attributes.length) el.replaceWith(...el.childNodes);
  }
  if (ends && ends[0].isConnected && ends[2].isConnected) {
    try {
      sel.setBaseAndExtent(...ends);
    } catch {
      /* the words are right either way; only the highlight would be lost */
    }
  }
};

const paintSelection = (hex) => {
  const sel = window.getSelection();
  if (!sel?.rangeCount || sel.isCollapsed) return;
  if (!hex) return clearSelectionColor(sel);
  clearColorsIn(sel.getRangeAt(0));
  exec("foreColor", hex);
};

const textOf = (html) => plainText(html).trim();
const htmlLength = (html) => {
  const d = document.createElement("div");
  d.innerHTML = html;
  return d.textContent.length;
};
const rangeHtml = (range) => {
  const d = document.createElement("div");
  d.appendChild(range.cloneContents());
  return d.innerHTML;
};

// ---------------------------------------------------------------------------
// Copy and paste. The system clipboard only reliably carries text from one line to
// another, so what was copied is also remembered here with its formatting, colours
// and element types. A paste uses the memory only while the clipboard still holds the
// same text; copying anything elsewhere replaces it, and that copy wins. It's shared
// by every editor, so it also works between a script and the scramble beside it.
// ---------------------------------------------------------------------------
let clip = null;
const clipKey = (text) => String(text).replace(/\r\n?/g, "\n").trimEnd();
const rememberClip = (next) => {
  clip = { ...next, key: clipKey(next.text) };
};
const clipFor = (text) => (clip && text && clip.key === clipKey(text) ? clip : null);

// The clipboard as text, and through the older copy command if that's refused.
const writeClipboard = (text) => {
  const fallback = () => {
    const onCopy = (e) => {
      e.preventDefault();
      e.clipboardData.setData("text/plain", text);
    };
    document.addEventListener("copy", onCopy);
    document.execCommand("copy");
    document.removeEventListener("copy", onCopy);
  };
  if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).catch(fallback);
  else fallback();
};

// Copies of blocks for the editor they're landing in. An element it doesn't have
// (a scene heading pasted into a scramble) becomes its plain text element.
const adoptBlocks = (blocks, profile) =>
  blocks
    .filter((b) => b.type !== "pagebreak" || profile.byKey.pagebreak)
    .map(({ indent, ...b }) => {
      const type = profile.byKey[b.type] ? b.type : profile.base;
      return { ...b, id: uid(), type, ...(indent && LIST_TYPES.has(type) ? { indent } : {}) };
    });

// A selection's html inside one line, with the formatting around it. Selecting the
// middle of a bold run clones only the text, so the <b> has to be put back on.
const selectedHtml = (range, body) => {
  let html = rangeHtml(range);
  const common = range.commonAncestorContainer;
  for (let node = common.nodeType === 1 ? common : common.parentElement; node && node !== body; node = node.parentElement) {
    const wrap = node.cloneNode(false);
    wrap.innerHTML = html;
    html = wrap.outerHTML;
  }
  return html;
};

// ---------------------------------------------------------------------------
// Highlighting across blocks. Chromium keeps a mouse drag inside the
// contenteditable it began in, so while a highlight spans blocks the editor
// itself becomes the one editing host and the blocks hand it their editing.
// ---------------------------------------------------------------------------
const bodyOf = (node) => (node?.nodeType === 1 ? node : node?.parentElement)?.closest?.(".block-body") || null;

const enterDocMode = (root) => {
  if (!root || root.dataset.docMode === "on") return;
  root.dataset.docMode = "on";
  root.setAttribute("contenteditable", "true");
  root.querySelectorAll("[data-block-id]").forEach((el) => el.removeAttribute("contenteditable"));
};

const exitDocMode = (root) => {
  if (!root || root.dataset.docMode !== "on") return;
  delete root.dataset.docMode;
  root.removeAttribute("contenteditable");
  root.querySelectorAll("[data-block-id]").forEach((el) => el.setAttribute("contenteditable", "true"));
};

// Moves the far end of a highlight one character or one visual line, crossing
// into the next block when it runs out. Chromium's own Shift+arrow handling gets
// lost among the gutters once the editor is the editing host, so this measures
// the lines itself. `goal` keeps the column steady over a run of line moves.
const stepHighlight = (root, dir, granularity, goal) => {
  const sel = window.getSelection();
  if (!sel?.focusNode) return false;
  const bodies = [...root.querySelectorAll("[data-block-id]")];
  const body = bodyOf(sel.focusNode);
  const extendTo = ([node, offset]) => {
    sel.setBaseAndExtent(sel.anchorNode, sel.anchorOffset, node, offset);
    (node.nodeType === 1 ? node : node.parentElement)?.scrollIntoView({ block: "nearest" });
    return true;
  };

  if (granularity === "character") {
    goal.current = null;
    if (!body) return false;
    const offset = focusOffset(body);
    const len = body.textContent.length;
    if ((dir > 0 && offset < len) || (dir < 0 && offset > 0)) return extendTo(textPoint(body, offset + dir));
    const next = bodies[bodies.indexOf(body) + dir];
    return next ? extendTo(textPoint(next, dir > 0 ? 0 : next.textContent.length)) : false;
  }

  const rect = focusRect() || body?.getBoundingClientRect();
  if (!rect) return false;
  if (goal.current == null) goal.current = rect.left;
  const lh = lineHeightOf(root);
  let y = dir > 0 ? rect.bottom + lh * 0.5 : rect.top - lh * 0.5;
  for (let i = 0; i < 12; i++, y += (dir * lh) / 2) {
    const target = bodies.find((b) => {
      const box = b.getBoundingClientRect();
      return y >= box.top && y <= box.bottom;
    });
    if (!target) continue;
    const box = target.getBoundingClientRect();
    const hit = pointRange(Math.max(box.left + 1, Math.min(goal.current, box.right - 1)), y);
    if (hit && target.contains(hit.startContainer)) return extendTo([hit.startContainer, hit.startOffset]);
    return extendTo(textPoint(target, dir > 0 ? 0 : target.textContent.length));
  }
  // no line further that way: run to the start or end of this one
  return body ? extendTo(textPoint(body, dir > 0 ? body.textContent.length : 0)) : false;
};

// The live highlight in block terms: every body it touches, first to last.
const selectionInfo = (root) => {
  const sel = window.getSelection();
  if (!root || !sel?.rangeCount || sel.isCollapsed) return null;
  const range = sel.getRangeAt(0);
  if (!root.contains(range.commonAncestorContainer)) return null;
  const bodies = [...root.querySelectorAll("[data-block-id]")].filter((b) => range.intersectsNode(b));
  if (!bodies.length) return null;
  return { sel, range, bodies, startBody: bodies[0], endBody: bodies[bodies.length - 1] };
};

// ---------------------------------------------------------------------------
// Typing shortcuts
// ---------------------------------------------------------------------------

// Typed as the whole content of a line, these turn it into another element, the
// way Notion's markdown works. `keep` leaves what you typed in place (INT. stays
// INT.); `from` limits the rule to lines that are already one of those elements.
const PREFIXES = [
  { test: /^(int|ext|est|int\.?\/ext|i\/e)\.?\s$/i, type: "scene", keep: true, from: ["action"] },
  { test: /^\[[ xX]?\]\s$/, type: "todo" },
  { test: /^[-*]\s$/, type: "bullet" },
  { test: /^\d+[.)]\s$/, type: "number" },
  { test: /^###\s$/, type: "beat" },
  { test: /^##\s$/, type: "sequence" },
  { test: /^#\s$/, type: "heading" },
  { test: /^-#\s$/, type: "subtext" },
  { test: /^=\s$/, type: "subtext" },
  { test: /^@$/, type: "character" },
  { test: /^><\s?$/, type: "centered" },
  { test: /^>\s$/, type: "transition" },
  { test: /^~$/, type: "lyrics" },
  { test: /^\[\[$/, type: "note" },
  { test: /^!!\s$/, type: "shot" },
  { test: /^(===|---)$/, type: "pagebreak" },
];

// **bold**, *italic*, _underline_ and ~~strike~~, applied as the closing mark is typed.
const INLINE = [
  { re: /\*\*([^*\n]+)\*\*$/, cmd: "bold", mark: 2 },
  { re: /~~([^~\n]+)~~$/, cmd: "strikeThrough", mark: 2 },
  { re: /(?:^|[^*\w])\*([^*\s][^*\n]*)\*$/, cmd: "italic", mark: 1 },
  { re: /(?:^|[^_\w])_([^_\s][^_\n]*)_$/, cmd: "underline", mark: 1 },
];

const inlineMarkdown = (el) => {
  const sel = window.getSelection();
  if (!sel.rangeCount || !sel.isCollapsed) return false;
  const node = sel.anchorNode;
  if (node?.nodeType !== 3 || !el.contains(node)) return false;
  const offset = sel.anchorOffset;
  const before = node.textContent.slice(0, offset);
  for (const rule of INLINE) {
    const m = rule.re.exec(before);
    if (!m) continue;
    const inner = m[1];
    const start = offset - inner.length - rule.mark * 2;
    const range = document.createRange();
    // closing mark first, so the opening one's offsets still hold
    range.setStart(node, offset - rule.mark);
    range.setEnd(node, offset);
    range.deleteContents();
    range.setStart(node, start);
    range.setEnd(node, start + rule.mark);
    range.deleteContents();
    range.setStart(node, start);
    range.setEnd(node, start + inner.length);
    sel.removeAllRanges();
    sel.addRange(range);
    exec(rule.cmd);
    sel.collapseToEnd();
    // carry on typing in plain text, not inside the formatting
    exec(rule.cmd);
    return true;
  }
  return false;
};

// ---------------------------------------------------------------------------
// The slash menu: every element, then every colour, yours included.
// ---------------------------------------------------------------------------
const hotkeyLabel = (t) => `Ctrl+${t.hotkey}`;

const slashItems = (customs, types) => [
  ...types.map((t) => ({ ...t, kind: "type", hint: hotkeyLabel(t) })),
  ...paletteOf(customs)
    .filter((c) => c.hex)
    .map((c) => ({
      key: `color-${c.key}`,
      kind: "color",
      hex: c.hex,
      label: c.name,
      icon: "◆",
      hint: c.custom ? "" : `Alt+${c.key}`,
      words: `${c.name.toLowerCase()} colour color text${c.custom ? " custom" : ""}`,
    })),
  { key: "color-1", kind: "color", hex: null, label: "Default Colour", icon: "◇", hint: "Alt+1", words: "default colour color plain reset" },
  { key: "color-new", kind: "newcolor", label: "New Colour…", icon: "+", hint: "", words: "new colour color custom add create make" },
];

// Matches the start of a word, ranked so a label match beats a keyword match.
const slashMatches = (query, customs, types) => {
  const items = slashItems(customs, types);
  if (!query) return items;
  const q = query.toLowerCase();
  const scored = [];
  for (const item of items) {
    const label = item.label.toLowerCase();
    const words = item.words.split(/\s+/);
    let score = -1;
    if (label === q) score = 0;
    else if (label.startsWith(q)) score = 1;
    else if (words.some((w) => w === q)) score = 2;
    else if (words.some((w) => w.startsWith(q))) score = 3;
    if (score >= 0) scored.push({ item, score });
  }
  return scored.sort((a, b) => a.score - b.score).map((s) => s.item);
};

// ---------------------------------------------------------------------------
// One line of the script
// ---------------------------------------------------------------------------
const Block = memo(function Block({ block, number, selected, active, focusAt, lonely, dropMark, autocomplete, color, marker, icon, commentCount, changeOwn, changeAfter, api }) {
  const ref = useRef(null);
  const handleRef = useRef(null);
  const [slash, setSlash] = useState(null);
  const [sugOpen, setSugOpen] = useState(false);
  const [sugIndex, setSugIndex] = useState(0);
  const [making, setMaking] = useState(false);
  // the script as it was before the / that opened the slash menu
  const slashFrom = useRef(null);
  const profile = api.profile();
  const type = profile.byKey[block.type] || profile.byKey[profile.base];

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
    return suggestionsFor(block.type, plainText(block.html), api.blocks(), block.id, api.known());
  }, [active, sugOpen, autocomplete, slash, block.html, block.type, block.id, api]);

  // The rest of the top suggestion, shown faintly after what you've typed so far.
  const ghost = useMemo(() => {
    if ((block.type !== "character" && block.type !== "act") || !suggestions.length) return null;
    const typed = plainText(block.html).replace(/ /g, " ").replace(/^\s+/, "").toUpperCase();
    const top = suggestions[sugIndex % suggestions.length].value;
    return typed && top.startsWith(typed) ? top.slice(typed.length) : null;
  }, [block.type, block.html, suggestions, sugIndex]);

  // Typing is saved in bursts that undo together; a formatting change is a step of
  // its own, so undo takes it off without taking the words with it.
  const save = () => ref.current && api.patch(block.id, { html: ref.current.innerHTML }, { typing: true });
  const saveStep = () => ref.current && api.patch(block.id, { html: ref.current.innerHTML });

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

  const pickSlash = (item) => {
    const el = ref.current;
    if (slash) deleteBetween(el, slash.start, caretOffset(el) ?? slash.start + 1 + slash.query.length);
    setSlash(null);
    if (item.kind === "newcolor") {
      setMaking(true);
      return;
    }
    const from = slashFrom.current;
    if (item.kind === "color") {
      api.patch(block.id, { color: item.hex, html: el.innerHTML }, { focus: caretOffset(el) ?? "end", from });
      sfx.play("tap");
      return;
    }
    if (item.key === "pagebreak") {
      api.insertPageBreak(block.id, el.innerHTML, from);
      return;
    }
    api.patch(block.id, { type: item.key, html: el.innerHTML }, { focus: caretOffset(el) ?? "end", from });
    setSugOpen(true);
  };

  const onInput = () => {
    if (commandRunning) return;
    const el = ref.current;
    // an emptied contenteditable keeps a stray <br>, which hides the placeholder
    if (!el.textContent && el.innerHTML !== "") el.innerHTML = "";
    const text = el.textContent;
    const caret = caretOffset(el);
    let formatted = false;

    if (!slash) {
      const rule = PREFIXES.find((r) => r.test.test(text) && profile.byKey[r.type] && (!r.from || r.from.includes(block.type)));
      if (rule) {
        el.innerHTML = "";
        if (rule.type === "pagebreak") {
          api.insertPageBreak(block.id, "");
          return;
        }
        const ticked = rule.type === "todo" ? { checked: /x/i.test(text) } : {};
        api.patch(block.id, { type: rule.type, html: rule.keep ? escapeHtml(text.toUpperCase()) : "", ...ticked }, { focus: "end" });
        setSugOpen(true);
        return;
      }
      formatted = inlineMarkdown(el);
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
        slashFrom.current = api.blocks();
        slashOpen = true;
      }
    }

    if (!slashOpen) {
      setSugOpen(true);
      setSugIndex(0);
    }
    // **bold** turning bold is its own step: undo puts the marks back
    api.patch(block.id, { html: el.innerHTML }, { typing: !formatted });
    api.typed();
  };

  const onKeyDown = (e) => {
    const el = ref.current;
    const mod = e.ctrlKey || e.metaKey;
    const key = e.key;

    if (slash) {
      const matches = slashMatches(slash.query, api.customs(), profile.types);
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

    if (suggestions.length && !mod && !e.altKey) {
      if (key === "ArrowDown" || key === "ArrowUp") {
        e.preventDefault();
        setSugIndex((i) => (i + (key === "ArrowDown" ? 1 : -1) + suggestions.length) % suggestions.length);
        return;
      }
      if ((key === "Tab" && !e.shiftKey) || (key === "ArrowRight" && ghost && caretOffset(el) >= el.textContent.length)) {
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

    if (e.altKey && !mod) {
      const c = colorForKey(e);
      if (c) {
        e.preventDefault();
        const sel = window.getSelection();
        if (sel.rangeCount && !sel.isCollapsed && el.contains(sel.anchorNode)) {
          paintSelection(c.hex);
          saveStep();
        } else api.colorBlocks([block.id], c.hex);
        sfx.play("tap");
        return;
      }
      if (key === "ArrowUp" || key === "ArrowDown") {
        e.preventDefault();
        sfx.play(api.nudge([block.id], key === "ArrowUp" ? -1 : 1) ? "tap" : "error");
        return;
      }
    }

    if (mod && !e.altKey) {
      const k = key.toLowerCase();
      if (key === "Enter" && block.type === "todo") {
        e.preventDefault();
        api.patch(block.id, { checked: !block.checked, html: el.innerHTML });
        return;
      }
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
      const hot = profile.hotkey(e);
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
        saveStep();
        return;
      }
      if (e.shiftKey && (k === "x" || k === "s")) {
        e.preventDefault();
        exec("strikeThrough");
        saveStep();
        return;
      }
      if (k === "d" && !e.shiftKey) {
        e.preventDefault();
        api.duplicate([block.id]);
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

    // Shift+arrows carry a highlight out of this line and into the next ones.
    if (e.shiftKey && !e.altKey) {
      const dir = key === "ArrowUp" || key === "ArrowLeft" ? -1 : 1;
      const edge =
        key === "ArrowUp" || key === "ArrowDown"
          ? atLineEdge(el, dir, focusRect())
          : key === "ArrowLeft"
          ? focusOffset(el) === 0
          : key === "ArrowRight"
          ? focusOffset(el) >= el.textContent.length
          : false;
      if (edge && api.extend(dir, key === "ArrowUp" || key === "ArrowDown" ? "line" : "character")) {
        e.preventDefault();
        return;
      }
    }

    if (key === "Enter") {
      e.preventDefault();
      if (e.shiftKey) {
        exec("insertLineBreak");
        save();
        return;
      }
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
      if (LIST_TYPES.has(block.type)) {
        api.indent([block.id], e.shiftKey ? -1 : 1);
        return;
      }
      api.cycle(block.id, e.shiftKey ? -1 : 1);
      setSugOpen(true);
      return;
    }

    if ((key === "ArrowUp" || key === "ArrowDown") && !e.shiftKey && !e.altKey) {
      const dir = key === "ArrowUp" ? -1 : 1;
      const sel = window.getSelection();
      if (sel.rangeCount && sel.getRangeAt(0).collapsed && atLineEdge(el, dir)) {
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
  };

  const onPaste = (e) => {
    if (api.docMode()) return;
    const text = e.clipboardData?.getData("text/plain") || "";
    e.preventDefault();
    if (!text) return;
    const el = ref.current;
    const sel = window.getSelection();
    const copied = clipFor(text);
    // whole lines keep their element and colour: always when several were copied, and
    // for a single line when there's nothing on this one for it to join
    const lineFree = !el.textContent.trim() || sel.toString().length >= el.textContent.length;
    const wholeLines = copied?.blocks && (copied.kind === "blocks" || lineFree);
    if (copied && !wholeLines) {
      exec("insertHTML", copied.html);
      saveStep();
      return;
    }
    if (!wholeLines && !/\n/.test(text.trim())) {
      document.execCommand("insertText", false, text.replace(/\s+/g, " "));
      return;
    }
    const blocks = wholeLines ? adoptBlocks(copied.blocks, profile) : profile.parse(text);
    if (!blocks.length) return;
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
  };

  const slashList = slash ? slashMatches(slash.query, api.customs(), profile.types) : [];
  const firstColor = slashList.findIndex((t) => t.kind !== "type");

  return (
    <div
      className="block"
      data-row-id={block.id}
      data-type={block.type}
      data-selected={selected}
      data-active={active}
      data-drop={dropMark || undefined}
      data-checked={(block.type === "todo" && block.checked) || undefined}
      data-change={changeOwn || undefined}
      data-change-after={changeAfter || undefined}
      style={block.indent ? { "--indent": block.indent } : undefined}
    >
      <div className="block-gutter" contentEditable={false}>
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

      {commentCount > 0 && (
        <button className="block-badge" contentEditable={false} tabIndex={-1} title="Comments on this line" onMouseDown={(e) => e.preventDefault()} onClick={() => api.openComments(block.id)}>
          {commentCount}
        </button>
      )}
      {marker && (
        <span className="list-marker" contentEditable={false}>
          {marker}
        </span>
      )}
      {block.type === "todo" && (
        <button
          className="todo-box"
          contentEditable={false}
          role="checkbox"
          aria-checked={Boolean(block.checked)}
          aria-label={block.checked ? "Untick" : "Tick"}
          title="Ctrl+Enter"
          tabIndex={-1}
          // the caret stays where it was while the box is clicked
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => api.patch(block.id, { checked: !block.checked })}
        >
          {block.checked && "✓"}
        </button>
      )}
      {icon && <img className="block-icon" src={icon} alt="" draggable={false} />}

      {block.type === "pagebreak" ? (
        <div
          className="pagebreak"
          contentEditable={false}
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
          spellCheck={!SPELL_SUPPORTED}
          // a note's colour tints its background and bar; its words stay readable
          style={color ? (block.type === "note" ? { "--note": color } : { color }) : undefined}
          data-block-id={block.id}
          data-placeholder={type.placeholder}
          data-lonely={lonely || undefined}
          data-ghost={ghost || undefined}
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
      {number != null && (
        <span className="scene-num scene-num-right" contentEditable={false}>
          {number}
        </span>
      )}

      {slash && slashList.length > 0 && (
        <Popover anchorRef={ref} width={250} className="slash-menu" onClose={() => setSlash(null)}>
          {firstColor !== 0 && <span className="menu-label">Elements</span>}
          {slashList.map((t, i) => (
            <div key={t.key} style={{ display: "contents" }}>
              {i === firstColor && <span className="menu-label">Colours</span>}
              <button
                className="menu-item"
                data-on={i === slash.index % slashList.length}
                ref={(node) => i === slash.index % slashList.length && node?.scrollIntoView({ block: "nearest" })}
                onMouseDown={(e) => {
                  e.preventDefault();
                  pickSlash(t);
                }}
              >
                <span className="menu-icon" style={t.kind === "color" && t.hex ? { color: t.hex } : undefined}>
                  {t.icon}
                </span>
                {t.label}
                {t.hint && <span className="menu-hint">{t.hint}</span>}
              </button>
            </div>
          ))}
        </Popover>
      )}

      {making && (
        <NewColor
          anchorRef={ref}
          onClose={() => {
            setMaking(false);
            // the /new that opened this is gone from the line either way
            api.patch(block.id, { html: ref.current.innerHTML }, { focus: "end", from: slashFrom.current });
          }}
          onCreate={(color) => {
            setMaking(false);
            api.patch(block.id, { color: color.hex, html: ref.current.innerHTML }, { focus: "end", from: slashFrom.current });
          }}
        />
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
// "Turn Into", with its options popping out to the side while the pointer is on it. A
// short delay on closing lets the pointer cross the gap between the two.
function TurnInto({ types, current, onPick }) {
  const [open, setOpen] = useState(false);
  const itemRef = useRef(null);
  const timer = useRef(null);
  const show = () => {
    clearTimeout(timer.current);
    setOpen(true);
  };
  const hide = () => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setOpen(false), 180);
  };
  useEffect(() => () => clearTimeout(timer.current), []);

  return (
    <>
      <button ref={itemRef} className="menu-item" data-open={open} aria-haspopup="menu" aria-expanded={open} onMouseEnter={show} onMouseLeave={hide} onClick={show}>
        <span className="menu-icon">⇄</span>
        Turn Into
        <span className="menu-hint">▸</span>
      </button>
      {open && (
        <Popover anchorRef={itemRef} side="right" width={230} className="block-menu" onClose={() => setOpen(false)}>
          <div className="submenu-area" onMouseEnter={show} onMouseLeave={hide}>
            {types
              .filter((t) => t.key !== "pagebreak")
              .map((t) => (
                <button key={t.key} className="menu-item" data-on={current === t.key} onClick={() => onPick(t.key)}>
                  <span className="menu-icon">{t.icon}</span>
                  {t.label}
                  <span className="menu-hint">{hotkeyLabel(t)}</span>
                </button>
              ))}
          </div>
        </Popover>
      )}
    </>
  );
}

function BlockMenu({ anchorRef, block, types, count, onPick, onColor, onInsert, onCopy, onDuplicate, onDelete, onClose }) {
  return (
    <Popover anchorRef={anchorRef} width={240} className="block-menu" onClose={onClose}>
      {block.type !== "pagebreak" && (
        <>
          <span className="menu-label">Colour</span>
          <Swatches value={block.color} onPick={onColor} />
        </>
      )}
      <TurnInto types={types} current={block.type} onPick={onPick} />
      <div className="menu-sep" />
      {count === 1 && (
        <>
          <button className="menu-item" onClick={() => onInsert(0)}>
            <span className="menu-icon">↑</span>Insert Above
          </button>
          <button className="menu-item" onClick={() => onInsert(1)}>
            <span className="menu-icon">↓</span>Insert Below
          </button>
        </>
      )}
      <button className="menu-item" onClick={onCopy}>
        <span className="menu-icon">⎘</span>
        {count > 1 ? `Copy ${count}` : "Copy"}
        <span className="menu-hint">Ctrl+C</span>
      </button>
      <button className="menu-item" onClick={onDuplicate}>
        <span className="menu-icon">⧉</span>
        {count > 1 ? `Duplicate ${count}` : "Duplicate"}
        <span className="menu-hint">Ctrl+D</span>
      </button>
      <button className="menu-item menu-danger" onClick={onDelete}>
        <span className="menu-icon">×</span>
        {count > 1 ? `Delete ${count}` : "Delete"}
        <span className="menu-hint">Del</span>
      </button>
    </Popover>
  );
}

// ---------------------------------------------------------------------------
// The floating bar over highlighted text: inline marks and colours.
// ---------------------------------------------------------------------------
function SelectionBar({ rootRef, customs, onApplied }) {
  const [rect, setRect] = useState(null);
  const [pos, setPos] = useState(null);
  const [making, setMaking] = useState(false);
  const barRef = useRef(null);
  const addRef = useRef(null);
  // While a new colour is being named the highlight is parked here, because typing
  // the name moves the selection into the name field.
  const parked = useRef(null);

  useEffect(() => {
    const update = () => {
      if (parked.current) return;
      const info = selectionInfo(rootRef.current);
      setRect(info && info.sel.toString().trim() ? info.range.getBoundingClientRect() : null);
    };
    const later = () => setTimeout(update, 0);
    const onChange = () => {
      if (parked.current) return;
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed) setRect(null);
    };
    document.addEventListener("mouseup", later);
    document.addEventListener("keyup", later);
    document.addEventListener("selectionchange", onChange);
    window.addEventListener("scroll", onChange, true);
    return () => {
      document.removeEventListener("mouseup", later);
      document.removeEventListener("keyup", later);
      document.removeEventListener("selectionchange", onChange);
      window.removeEventListener("scroll", onChange, true);
    };
  }, [rootRef]);

  useLayoutEffect(() => {
    if (!rect || !barRef.current) {
      setPos(null);
      return;
    }
    const bar = barRef.current.getBoundingClientRect();
    const pad = 10;
    const left = Math.max(pad, Math.min(rect.left + rect.width / 2 - bar.width / 2, window.innerWidth - bar.width - pad));
    const above = rect.top - bar.height - 9;
    const z = uiZoom();
    setPos({ left: left / z, top: (above >= 70 ? above : rect.bottom + 9) / z });
  }, [rect]);

  if (!rect) return null;
  const run = (fn) => (e) => {
    e.preventDefault();
    fn();
    onApplied();
    sfx.play("tap");
  };

  return createPortal(
    <div
      ref={barRef}
      className="selbar"
      style={{ left: pos?.left ?? 0, top: pos?.top ?? 0, visibility: pos ? "visible" : "hidden" }}
      // keeps the highlight when a button is pressed; the new-colour form (which
      // bubbles here through its portal) needs its fields to take focus
      onMouseDown={(e) => barRef.current?.contains(e.target) && e.preventDefault()}
    >
      <button className="selbar-btn" onMouseDown={run(() => exec("bold"))} title="Bold · Ctrl+B">
        <b>B</b>
      </button>
      <button className="selbar-btn" onMouseDown={run(() => exec("italic"))} title="Italic · Ctrl+I">
        <i>I</i>
      </button>
      <button className="selbar-btn" onMouseDown={run(() => exec("underline"))} title="Underline · Ctrl+U">
        <u>U</u>
      </button>
      <button className="selbar-btn" onMouseDown={run(() => exec("strikeThrough"))} title="Strikethrough · Ctrl+Shift+X">
        <s>S</s>
      </button>
      <span className="selbar-sep" />
      {paletteOf(customs)
        .filter((c) => c.hex)
        .map((c) => (
          <button
            key={c.key}
            className="selbar-dot"
            style={{ background: c.hex }}
            title={c.custom ? c.name : `${c.name} · Alt+${c.key}`}
            onMouseDown={run(() => paintSelection(c.hex))}
          />
        ))}
      <button className="selbar-dot selbar-dot-clear" title="Default colour · Alt+1" onMouseDown={run(() => paintSelection(null))}>
        ×
      </button>
      <button
        ref={addRef}
        className="selbar-dot selbar-dot-clear"
        title="New colour"
        onMouseDown={(e) => {
          e.preventDefault();
          const sel = window.getSelection();
          if (!sel?.rangeCount) return;
          parked.current = { range: sel.getRangeAt(0).cloneRange(), spans: rootRef.current?.dataset.docMode === "on" };
          setMaking(true);
        }}
      >
        +
      </button>
      {making && (
        <NewColor
          anchorRef={addRef}
          onClose={() => {
            parked.current = null;
            setMaking(false);
            setRect(null);
          }}
          onCreate={(color) => {
            const { range, spans } = parked.current || {};
            parked.current = null;
            setMaking(false);
            if (!range) return;
            // put the highlight back exactly as it was, then colour it
            if (spans) {
              enterDocMode(rootRef.current);
              rootRef.current.focus({ preventScroll: true });
            } else bodyOf(range.startContainer)?.focus({ preventScroll: true });
            const sel = window.getSelection();
            sel.removeAllRanges();
            sel.addRange(range);
            paintSelection(color.hex);
            onApplied();
          }}
        />
      )}
    </div>,
    document.body
  );
}

// ---------------------------------------------------------------------------
// The editor
// ---------------------------------------------------------------------------
const HISTORY_LIMIT = 300;
let lastEditor = null;
const BULLETS = ["•", "◦", "▪"];
const SPEAKING = new Set(["dialogue", "subtext", "lyrics"]);

const ScriptEditor = forwardRef(function ScriptEditor({ blocks, onChange, onActive, settings, jump, cast, known, commentCounts, onCommentBadge, changesByLine, changeUi, profile = SCRIPT_PROFILE }, outerRef) {
  const rootRef = useRef(null);
  const profileRef = useRef(profile);
  profileRef.current = profile;
  const blocksRef = useRef(blocks);
  blocksRef.current = blocks;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onActiveRef = useRef(onActive);
  onActiveRef.current = onActive;
  const onBadgeRef = useRef(onCommentBadge);
  onBadgeRef.current = onCommentBadge;

  // Suggested changes show in a card while the pointer is over their line. It stays open
  // long enough to move onto it and press Accept, and gets out of the way when you type.
  const [changeCard, setChangeCard] = useState(null);
  const changesRef = useRef(changesByLine);
  changesRef.current = changesByLine;
  const cardTimer = useRef(null);
  const overLine = useRef(null);
  const pointer = useRef(null);
  const typedAt = useRef(null);
  const closeCardSoon = () => {
    overLine.current = null;
    clearTimeout(cardTimer.current);
    cardTimer.current = setTimeout(() => setChangeCard(null), 250);
  };
  const openCard = (id, row) => setChangeCard((c) => (c?.id === id ? c : { id, anchor: { current: row.querySelector(".block-body") || row } }));
  const onRootMouseMove = (e) => {
    if (!changesRef.current || e.buttons || !rootRef.current?.contains(e.target)) return;
    // Typing shifts the page, and the browser reports that as the pointer moving even
    // though it hasn't. The card only comes back once it really has.
    if (typedAt.current) {
      if (Math.abs(e.clientX - typedAt.current.x) < 4 && Math.abs(e.clientY - typedAt.current.y) < 4) return;
      typedAt.current = null;
    }
    const row = e.target.closest?.("[data-row-id]");
    const id = row?.dataset.rowId || "";
    if (id === overLine.current) return;
    if (id && changesRef.current[id]?.length) {
      overLine.current = id;
      clearTimeout(cardTimer.current);
      cardTimer.current = setTimeout(() => openCard(id, row), 150);
    } else {
      closeCardSoon();
      overLine.current = id;
    }
  };
  useEffect(() => {
    const onMove = (e) => (pointer.current = { x: e.clientX, y: e.clientY });
    const onKey = () => {
      typedAt.current = pointer.current || { x: -1000, y: -1000 };
      overLine.current = null;
      clearTimeout(cardTimer.current);
      setChangeCard(null);
    };
    window.addEventListener("mousemove", onMove, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousemove", onMove, true);
      window.removeEventListener("keydown", onKey);
      clearTimeout(cardTimer.current);
    };
  }, []);
  const changeMarks = useMemo(() => {
    const marks = {};
    for (const [id, list] of Object.entries(changesByLine || {})) {
      marks[id] = { own: list.find((c) => c.line === id)?.op, after: list.find((c) => c.line !== id)?.op };
    }
    return marks;
  }, [changesByLine]);
  const cardChanges = changeCard ? changesByLine?.[changeCard.id] : null;
  // the last suggestion on the line was just decided
  useEffect(() => {
    if (changeCard && !cardChanges?.length) setChangeCard(null);
  }, [changeCard, cardChanges]);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const knownRef = useRef(known || []);
  knownRef.current = known || [];

  const [focusReq, setFocusReq] = useState(null);
  const [activeId, setActiveId] = useState(null);
  const [selected, setSelected] = useState(() => new Set());
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const anchorRef = useRef(null);
  const [menu, setMenu] = useState(null);
  const [drop, setDrop] = useState(null);
  const [marquee, setMarquee] = useState(null);
  const goalX = useRef(null);
  const { updateSettings } = useStore();
  const spell = useSpellcheck(rootRef, blocks, settings);
  const [spellMenu, setSpellMenu] = useState(null);
  const mouseDown = useRef(false);
  const boxDragged = useRef(false);
  const hist = useRef({ past: [], future: [], lastKind: null, lastAt: 0, lastId: null });

  const focusSnapshot = () => {
    const el = document.activeElement;
    const id = el?.dataset?.blockId;
    if (!id) return null;
    return { id, at: caretOffset(el) };
  };

  // Every change goes through here, so every change can be undone. `from` names an
  // earlier state as the one undo returns to: a slash command undoes back to the
  // line as it was before the / was typed, not to the half-typed command.
  const commit = useCallback((next, { focus, typing = false, id = null, from = null } = {}) => {
    const h = hist.current;
    const now = Date.now();
    // nothing actually changed: no empty step for undo to waste a press on
    const cur = blocksRef.current;
    const same =
      !from &&
      next.length === cur.length &&
      next.every((b, i) => b === cur[i] || (b.id === cur[i].id && b.type === cur[i].type && b.html === cur[i].html && (b.color || null) === (cur[i].color || null) && (b.indent || 0) === (cur[i].indent || 0) && Boolean(b.checked) === Boolean(cur[i].checked)));
    if (same) {
      if (focus) setFocusReq({ ...focus, t: now + Math.random() });
      return;
    }
    const coalesce = typing && h.lastKind === "typing" && h.lastId === id && now - h.lastAt < 1200;
    if (from) {
      if (h.past[h.past.length - 1]?.blocks !== from) h.past.push({ blocks: from, focus: focusSnapshot() });
    } else if (!coalesce) {
      h.past.push({ blocks: blocksRef.current, focus: focusSnapshot() });
    }
    if (h.past.length > HISTORY_LIMIT) h.past.shift();
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

  // Let go of a cross-block highlight completely: the range and the editing host.
  const dropHighlight = () => {
    const root = rootRef.current;
    const sel = window.getSelection();
    if (sel?.anchorNode && root?.contains(sel.anchorNode)) sel.removeAllRanges();
    exitDocMode(root);
  };

  const applyHistory = (from, to) => {
    const h = hist.current;
    if (!h[from].length) {
      sfx.play("error");
      return;
    }
    // Snapshot the caret, then let go of the block before touching the stacks, so anything
    // a blur commits lands before we pop.
    const focus = focusSnapshot();
    dropHighlight();
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
    if (!next.length) next = profileRef.current.starter();
    const neighbour = next[Math.min(Math.max(0, first - 1), next.length - 1)];
    commit(next, { focus: neighbour.type === "pagebreak" ? null : { id: neighbour.id, at: "end" } });
    setSelected(new Set());
    sfx.play("remove");
  };

  // The ids a highlight touches, in script order.
  const touchedIds = () => selectionInfo(rootRef.current)?.bodies.map((b) => b.dataset.blockId) || [];

  // After a formatting command ran over highlighted text, read the blocks back.
  const syncFromDom = () => {
    const root = rootRef.current;
    if (!root) return;
    const els = {};
    root.querySelectorAll("[data-block-id]").forEach((el) => {
      els[el.dataset.blockId] = el;
    });
    let changed = false;
    const next = blocksRef.current.map((b) => {
      const el = els[b.id];
      if (!el || el.innerHTML === b.html) return b;
      changed = true;
      return { ...b, html: el.innerHTML };
    });
    if (changed) commit(next);
  };

  // Types over (or deletes, or pastes over) a highlight that may span blocks: the
  // first block keeps what came before it, the last gives up what came after it,
  // and everything in between goes.
  const replaceHighlight = (text = "", copied = null) => {
    const root = rootRef.current;
    const info = selectionInfo(root);
    if (!info) return false;
    const { range, startBody, endBody } = info;
    const list = blocksRef.current;
    const from = list.findIndex((b) => b.id === startBody.dataset.blockId);
    const to = list.findIndex((b) => b.id === endBody.dataset.blockId);
    if (from < 0 || to < 0) return false;

    const head = document.createRange();
    head.setStart(startBody, 0);
    if (startBody.contains(range.startContainer)) head.setEnd(range.startContainer, range.startOffset);
    else head.setEnd(startBody, 0);
    const tail = document.createRange();
    tail.setEnd(endBody, endBody.childNodes.length);
    if (endBody.contains(range.endContainer)) tail.setStart(range.endContainer, range.endOffset);
    else tail.setStart(endBody, endBody.childNodes.length);
    const headHtml = rangeHtml(head);
    const tailHtml = rangeHtml(tail);
    const start = list[from];
    const clean = String(text).replace(/\r\n?/g, "\n");

    let next;
    let focus;
    const lineFree = !textOf(headHtml) && !textOf(tailHtml);
    const wholeLines = copied?.blocks && (copied.kind === "blocks" || lineFree);
    if (copied && !wholeLines) {
      next = [...list.slice(0, from), { ...start, html: headHtml + copied.html + tailHtml }, ...list.slice(to + 1)];
      focus = { id: start.id, at: htmlLength(headHtml) + htmlLength(copied.html) };
    } else if (wholeLines || /\n/.test(clean.trim())) {
      const parsed = wholeLines ? adoptBlocks(copied.blocks, profileRef.current) : profileRef.current.parse(clean);
      const keepHead = textOf(headHtml) ? [{ ...start, html: headHtml }] : [];
      const keepTail = textOf(tailHtml) ? [{ ...list[to], id: uid(), html: tailHtml }] : [];
      next = [...list.slice(0, from), ...keepHead, ...parsed, ...keepTail, ...list.slice(to + 1)];
      const last = parsed[parsed.length - 1];
      focus = last && last.type !== "pagebreak" ? { id: last.id, at: "end" } : null;
    } else {
      const flat = clean.replace(/\s+/g, " ");
      next = [...list.slice(0, from), { ...start, html: headHtml + escapeHtml(flat) + tailHtml }, ...list.slice(to + 1)];
      focus = { id: start.id, at: htmlLength(headHtml) + flat.length };
    }
    if (!next.length) next = profileRef.current.starter();
    dropHighlight();
    commit(next, { focus });
    return true;
  };

  // What a highlight copies. Words inside one line keep their marks and colour; across
  // lines, or the whole of one line, the lines keep their element and colour too. The
  // clipboard's text for several lines is Fountain or markdown, so it reads properly
  // when pasted anywhere else.
  const clipFromHighlight = () => {
    const info = selectionInfo(rootRef.current);
    if (!info) return null;
    const { range, bodies, startBody, endBody } = info;
    const picked = bodies
      .map((body) => {
        const block = blocksRef.current.find((b) => b.id === body.dataset.blockId);
        if (!block) return null;
        const r = document.createRange();
        r.selectNodeContents(body);
        if (body === startBody && body.contains(range.startContainer)) r.setStart(range.startContainer, range.startOffset);
        if (body === endBody && body.contains(range.endContainer)) r.setEnd(range.endContainer, range.endOffset);
        return { block, r, body, text: r.toString() };
      })
      .filter((p) => p && p.text.trim());
    if (!picked.length) return null;
    if (picked.length === 1) {
      const { block, r, body, text } = picked[0];
      let html = selectedHtml(r, body);
      // a colour set on the line itself isn't in the words' own html (a note's is its background)
      if (block.color && block.type !== "note") html = `<span style="color: ${block.color};">${html}</span>`;
      return { kind: "inline", text, html, blocks: text.length >= body.textContent.length ? [block] : null };
    }
    const blocks = picked.map(({ block, r, body }) => ({ ...block, html: selectedHtml(r, body) }));
    return { kind: "blocks", blocks, text: profileRef.current.toText(blocks), html: blocks.map((b) => `<p>${b.html}</p>`).join("") };
  };

  // Whole lines, from the selection box or a line's menu.
  const copyBlocks = (blocks) => {
    const text = profileRef.current.toText(blocks);
    rememberClip({ kind: "blocks", blocks, text, html: blocks.map((b) => `<p>${b.html}</p>`).join("") });
    writeClipboard(text);
  };

  const api = useMemo(
    () => ({
      blocks: () => blocksRef.current,
      known: () => knownRef.current,
      openComments: (id) => onBadgeRef.current?.(id),
      profile: () => profileRef.current,
      customs: () => settingsRef.current.customColors || [],
      docMode: () => rootRef.current?.dataset.docMode === "on",
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
            // in dual view each document scrolls on its own
            const scroller = rootRef.current?.closest("[data-scroller]") || window;
            if (Math.abs(delta) > 24) scroller.scrollBy({ top: delta, behavior: "smooth" });
          }
        }
      },
      keepInView: (el) => {
        const r = el.getBoundingClientRect();
        if (r.bottom > window.innerHeight - 90 || r.top < 150) {
          el.scrollIntoView({ block: settingsRef.current.typewriterScroll ? "center" : "nearest", behavior: "smooth" });
        }
      },
      patch: (id, changes, { typing = false, focus, from } = {}) => {
        const list = blocksRef.current;
        const i = list.findIndex((b) => b.id === id);
        if (i < 0) return;
        commit(replaceAt(list, i, { ...list[i], ...changes }), {
          typing,
          id,
          focus: focus != null ? { id, at: focus } : undefined,
          from,
        });
      },
      setType: (id, type) => {
        const ids = selectedRef.current.size ? selectedRef.current : new Set([id]);
        commit(blocksRef.current.map((b) => (ids.has(b.id) && b.type !== "pagebreak" ? { ...b, type } : b)));
      },
      // Tab and Shift+Tab on list lines
      indent: (ids, dir) => {
        const set = new Set(ids);
        commit(
          blocksRef.current.map((b) =>
            set.has(b.id) && LIST_TYPES.has(b.type) ? { ...b, indent: Math.max(0, Math.min(MAX_INDENT, (b.indent || 0) + dir)) } : b
          )
        );
      },
      setTypeMany: (ids, type) => {
        const set = new Set(ids);
        commit(blocksRef.current.map((b) => (set.has(b.id) && b.type !== "pagebreak" ? { ...b, type } : b)));
      },
      colorBlocks: (ids, hex) => {
        const set = new Set(ids);
        const el = document.activeElement;
        const focus = el?.dataset?.blockId && set.has(el.dataset.blockId) ? { id: el.dataset.blockId, at: caretOffset(el) ?? "end" } : undefined;
        commit(
          blocksRef.current.map((b) => (set.has(b.id) && b.type !== "pagebreak" ? { ...b, color: hex || null } : b)),
          { focus }
        );
      },
      // Alt+Up/Down: everything chosen moves one place, past whatever sits next to it.
      nudge: (ids, dir) => {
        const list = blocksRef.current.slice();
        const moving = new Set(ids);
        let moved = false;
        if (dir < 0) {
          for (let i = 1; i < list.length; i++) {
            if (moving.has(list[i].id) && !moving.has(list[i - 1].id)) {
              [list[i - 1], list[i]] = [list[i], list[i - 1]];
              moved = true;
            }
          }
        } else {
          for (let i = list.length - 2; i >= 0; i--) {
            if (moving.has(list[i].id) && !moving.has(list[i + 1].id)) {
              [list[i + 1], list[i]] = [list[i], list[i + 1]];
              moved = true;
            }
          }
        }
        if (!moved) return false;
        // moving a focused node through the DOM drops its focus, so put it back
        const el = document.activeElement;
        const focus = el?.dataset?.blockId && moving.has(el.dataset.blockId) ? { id: el.dataset.blockId, at: caretOffset(el) ?? "end" } : undefined;
        commit(list, { focus });
        return true;
      },
      duplicate: (ids) => {
        const set = new Set(ids);
        const list = blocksRef.current;
        const last = list.reduce((at, b, i) => (set.has(b.id) ? i : at), -1);
        if (last < 0) return;
        const copies = list.filter((b) => set.has(b.id)).map((b) => ({ ...b, id: uid() }));
        const next = [...list.slice(0, last + 1), ...copies, ...list.slice(last + 1)];
        const single = copies.length === 1 && copies[0].type !== "pagebreak";
        commit(next, { focus: single ? { id: copies[0].id, at: "end" } : undefined });
        if (!single) {
          setSelected(new Set(copies.map((b) => b.id)));
          rootRef.current?.focus({ preventScroll: true });
        }
        sfx.play("add");
      },
      cycle: (id, dir) => {
        const list = blocksRef.current;
        const i = list.findIndex((b) => b.id === id);
        if (i < 0) return;
        const order = profileRef.current.tabOrder;
        const pos = order.indexOf(list[i].type);
        const type = order[(Math.max(0, pos) + dir + order.length) % order.length];
        commit(replaceAt(list, i, { ...list[i], type }));
      },
      // Shift+arrow at the edge of a line: hand the highlight to the editor so it
      // can keep growing into the lines around it.
      extend: (dir, granularity) => {
        const root = rootRef.current;
        const sel = window.getSelection();
        if (!root || !sel.anchorNode) return false;
        const a = [sel.anchorNode, sel.anchorOffset];
        const f = [sel.focusNode, sel.focusOffset];
        enterDocMode(root);
        root.focus({ preventScroll: true });
        sel.setBaseAndExtent(...a, ...f);
        goalX.current = null;
        stepHighlight(root, dir, granularity, goalX);
        return true;
      },
      enter: (id, beforeHtml, afterHtml) => {
        const list = blocksRef.current;
        const i = list.findIndex((b) => b.id === id);
        if (i < 0) return;
        const b = list[i];
        const beforeText = textOf(beforeHtml);
        const afterText = textOf(afterHtml);
        const { screenplay, base, next: following } = profileRef.current;
        const listed = LIST_TYPES.has(b.type);

        // Enter on an empty list line steps out of the list: up a level, then to text.
        if (listed && !beforeText && !afterText) {
          const out = b.indent ? { ...b, indent: b.indent - 1 } : { ...b, type: base, html: "", indent: 0, checked: false };
          commit(replaceAt(list, i, out), { focus: { id: b.id, at: "start" } });
          return;
        }

        // Enter on an empty line changes what it is rather than piling up blanks:
        // an empty Character becomes Action, an empty Action becomes Character.
        if (screenplay && !beforeText && !afterText) {
          const type = b.type === "action" ? "character" : "action";
          commit(replaceAt(list, i, { ...b, type, html: "" }), { focus: { id: b.id, at: "start" } });
          return;
        }
        // Enter at the very start pushes the line down and leaves a fresh one above.
        if (!beforeText) {
          const above = emptyBlock(listed ? b.type : screenplay && b.type === "scene" ? "scene" : base);
          if (listed) above.indent = b.indent || 0;
          commit([...list.slice(0, i), above, { ...b, html: afterHtml }, ...list.slice(i + 1)], {
            focus: { id: b.id, at: "start" },
          });
          return;
        }

        let type = b.type;
        let html = beforeHtml;
        // "cut to:" / "SMASH CUT TO:" on its own line is a transition, however it was typed
        if (screenplay && type === "action" && !afterText && beforeText.length <= 30 && /^[\p{L} .'-]+ to:$/iu.test(beforeText)) {
          type = "transition";
          html = escapeHtml(beforeText.toUpperCase());
        }
        const nb = emptyBlock(afterText ? type : following[type] || base, afterHtml);
        if (listed) nb.indent = b.indent || 0;
        commit([...list.slice(0, i), { ...b, type, html }, nb, ...list.slice(i + 1)], {
          focus: { id: nb.id, at: "start" },
        });
      },
      backspace: (id, html) => {
        const list = blocksRef.current;
        const i = list.findIndex((b) => b.id === id);
        if (i < 0) return;
        const b = list[i];
        const base = profileRef.current.base;
        // at the start of a list line: up a level, then back to plain text
        if (LIST_TYPES.has(b.type)) {
          const out = b.indent ? { ...b, html, indent: b.indent - 1 } : { ...b, type: base, html, indent: 0, checked: false };
          commit(replaceAt(list, i, out), { focus: { id, at: "start" } });
          return;
        }
        if (!textOf(html)) {
          if (list.length === 1) {
            if (b.type !== base) commit(replaceAt(list, i, { ...b, type: base, html: "" }), { focus: { id, at: "start" } });
            return;
          }
          const next = list.filter((x) => x.id !== id);
          let j = i - 1;
          while (j >= 0 && next[j]?.type === "pagebreak") j -= 1;
          const target = j >= 0 ? next[j] : next.find((x) => x.type !== "pagebreak");
          commit(next, { focus: target ? { id: target.id, at: j >= 0 ? "end" : "start" } : null });
          return;
        }
        if (b.type !== base) {
          commit(replaceAt(list, i, { ...b, type: base, html }), { focus: { id, at: "start" } });
          return;
        }
        if (i === 0) return;
        const prev = list[i - 1];
        if (prev.type === "pagebreak") {
          commit(list.filter((x) => x.id !== prev.id), { focus: { id, at: "start" } });
          return;
        }
        const join = htmlLength(prev.html);
        commit([...list.slice(0, i - 1), { ...prev, html: prev.html + html }, ...list.slice(i + 1)], {
          focus: { id: prev.id, at: join },
        });
      },
      deleteForward: (id, html) => {
        const list = blocksRef.current;
        const i = list.findIndex((b) => b.id === id);
        const next = list[i + 1];
        if (i < 0 || !next) return;
        const join = htmlLength(html);
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
      insertPageBreak: (id, html, from) => {
        const list = blocksRef.current;
        const i = list.findIndex((b) => b.id === id);
        if (i < 0) return;
        const brk = emptyBlock("pagebreak");
        const after = emptyBlock("scene");
        const keep = textOf(html) ? [{ ...list[i], html }] : [];
        commit([...list.slice(0, i), ...keep, brk, after, ...list.slice(i + 1)], { focus: { id: after.id, at: "start" }, from });
      },
      paste: (id, beforeHtml, afterHtml, parsed) => {
        const list = blocksRef.current;
        const i = list.findIndex((b) => b.id === id);
        if (i < 0) return;
        const b = list[i];
        const head = textOf(beforeHtml) ? [{ ...b, html: beforeHtml }] : [];
        const tail = textOf(afterHtml) ? [{ ...b, id: uid(), html: afterHtml }] : [];
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
        if (api.docMode()) {
          if (type !== "pagebreak") api.setTypeMany(touchedIds(), type);
          return;
        }
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
        if (api.docMode()) {
          syncFromDom();
          return;
        }
        const el = document.activeElement;
        if (el?.dataset?.blockId) api.patch(el.dataset.blockId, { html: el.innerHTML });
      },
      undo: api.undo,
      redo: api.redo,
      // a change from outside (accepting a suggestion), as one undoable step
      applyBlocks: (next) => commit(next),
    }),
    [activeId, api]
  );

  useEffect(() => {
    lastEditor = rootRef.current;
  }, []);

  // A fresh script is ready to type into the moment it opens.
  useEffect(() => {
    const list = blocksRef.current;
    if (list.length === 1 && !textOf(list[0].html)) setFocusReq({ id: list[0].id, at: "start", t: Date.now() });
  }, []);

  // Undo and redo reach the editor wherever focus is: after a handle drag, a menu
  // action or a click in the margin nothing is focused at all, and Ctrl+Z still has
  // to take that last change back. Text fields elsewhere (the title, a dialog) keep
  // their own undo.
  useEffect(() => {
    const onKey = (e) => {
      if (e.defaultPrevented || !(e.ctrlKey || e.metaKey) || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k !== "z" && k !== "y") return;
      const root = rootRef.current;
      if (!root || root.contains(e.target)) return;
      // with two documents on screen, the one last worked in
      if (lastEditor !== root && document.contains(lastEditor)) return;
      if (e.target.closest?.("input, textarea, select, [contenteditable='true']") || document.querySelector(".overlay")) return;
      e.preventDefault();
      if (k === "y" || e.shiftKey) api.redo();
      else api.undo();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [api]);

  // Clicking a scene in the sidebar.
  useEffect(() => {
    if (!jump) return;
    if (blocksRef.current.some((b) => b.id === jump.id)) {
      setFocusReq({ id: jump.id, at: "end", scroll: true, t: Date.now() });
      if (jump.showChange) {
        const row = [...(rootRef.current?.querySelectorAll("[data-row-id]") || [])].find((el) => el.dataset.rowId === jump.id);
        if (row) {
          clearTimeout(cardTimer.current);
          setChangeCard({ id: jump.id, anchor: { current: row.querySelector(".block-body") || row } });
        }
      }
    }
  }, [jump]);

  // When a cross-block highlight collapses (a click, an arrow key), the editor
  // hands editing back to the block the caret landed in.
  useEffect(() => {
    const onSelectionChange = () => {
      const root = rootRef.current;
      // mid-drag the browser briefly collapses the range; the drag itself decides
      if (!root || root.dataset.docMode !== "on" || mouseDown.current) return;
      const sel = window.getSelection();
      if (sel && !sel.isCollapsed && root.contains(sel.anchorNode)) return;
      const node = sel?.anchorNode;
      const offset = sel?.anchorOffset ?? 0;
      const body = bodyOf(node);
      exitDocMode(root);
      if (body && root.contains(body)) {
        body.focus({ preventScroll: true });
        const range = document.createRange();
        range.setStart(node, Math.min(offset, node.nodeType === 3 ? node.length : node.childNodes.length));
        sel.removeAllRanges();
        sel.addRange(range);
      }
    };
    document.addEventListener("selectionchange", onSelectionChange);
    return () => document.removeEventListener("selectionchange", onSelectionChange);
  }, []);

  // While the editor is the editing host, every edit goes through replaceHighlight
  // so the blocks stay blocks.
  useEffect(() => {
    const root = rootRef.current;
    const onBeforeInput = (e) => {
      if (root.dataset.docMode !== "on") return;
      e.preventDefault();
      const t = e.inputType || "";
      if (t === "insertText" || t === "insertReplacementText") replaceHighlight(e.data || e.dataTransfer?.getData("text/plain") || "");
      else if (t.startsWith("delete") && t !== "deleteByDrag") replaceHighlight("");
      else if (t === "insertParagraph" || t === "insertLineBreak") replaceHighlight("");
    };
    root.addEventListener("beforeinput", onBeforeInput);
    return () => root.removeEventListener("beforeinput", onBeforeInput);
  }, []);

  // Mouse: a drag that leaves the block it started in keeps highlighting text
  // across the lines it passes; a drag that starts anywhere around the text draws a
  // box that selects whole elements.
  useEffect(() => {
    const onDown = (e) => {
      const root = rootRef.current;
      if (e.button !== 0 || !root) return;
      if (e.target.closest?.(".popover, .selbar, .overlay, .block-handle, .format-bar")) return;

      const body = e.target.closest?.(".block-body");
      if (body && root.contains(body)) {
        if (selectedRef.current.size) setSelected(new Set());
        const anchor = pointRange(e.clientX, e.clientY);
        if (!anchor) return;
        const startBody = root.dataset.docMode === "on" ? null : body;
        mouseDown.current = true;
        const onMove = (ev) => {
          const focus = pointRange(ev.clientX, ev.clientY);
          const focusBody = focus && bodyOf(focus.startContainer);
          if (!focusBody || !root.contains(focusBody)) return;
          if (focusBody === startBody && root.dataset.docMode !== "on") return;
          ev.preventDefault();
          enterDocMode(root);
          window.getSelection()?.setBaseAndExtent(anchor.startContainer, anchor.startOffset, focus.startContainer, focus.startOffset);
        };
        // once the editor is drawing the highlight, the browser's own drag
        // selection (still tied to the block it started in) must stay out of it
        const onMouseMove = (ev) => {
          if (root.dataset.docMode === "on") ev.preventDefault();
        };
        const onUp = () => {
          mouseDown.current = false;
          window.removeEventListener("pointermove", onMove);
          window.removeEventListener("mousemove", onMouseMove, true);
          window.removeEventListener("pointerup", onUp);
          window.removeEventListener("mouseup", onUp);
          window.removeEventListener("pointercancel", onUp);
          // a drag that came back to where it started leaves nothing highlighted
          const sel = window.getSelection();
          if (root.dataset.docMode === "on" && (!sel || sel.isCollapsed)) document.dispatchEvent(new Event("selectionchange"));
        };
        window.addEventListener("pointermove", onMove);
        window.addEventListener("mousemove", onMouseMove, true);
        window.addEventListener("pointerup", onUp);
        window.addEventListener("mouseup", onUp);
        window.addEventListener("pointercancel", onUp);
        return;
      }

      // anywhere around the text in this document's own area: the page's margins and
      // the space beside the page
      const region = root.closest(".script-main, .scramble-pane");
      const page = region?.contains(e.target) ? region : null;
      if (!page || e.target.closest(".pagebreak, .change-row, button, input, textarea")) {
        if (selectedRef.current.size && !e.shiftKey) setSelected(new Set());
        return;
      }

      // the selection box
      e.preventDefault();
      dropHighlight();
      document.activeElement?.blur?.();
      const start = { x: e.clientX + window.scrollX, y: e.clientY + window.scrollY };
      const base = e.shiftKey ? [...selectedRef.current] : [];
      let last = { x: e.clientX, y: e.clientY };
      let moved = false;
      if (!e.shiftKey) setSelected(new Set());
      document.body.classList.add("is-marquee");

      const recompute = () => {
        const z = uiZoom();
        const nowX = last.x + window.scrollX;
        const nowY = last.y + window.scrollY;
        const top = Math.min(start.y, nowY);
        const bottom = Math.max(start.y, nowY);
        const left = Math.min(start.x, nowX);
        const right = Math.max(start.x, nowX);
        if (!moved && bottom - top < 4 && right - left < 4) return;
        moved = true;
        const rect = root.getBoundingClientRect();
        setMarquee({
          left: (left - rect.left - window.scrollX) / z,
          top: (top - rect.top - window.scrollY) / z,
          width: (right - left) / z,
          height: (bottom - top) / z,
        });
        const hits = [];
        root.querySelectorAll(":scope > .block").forEach((el) => {
          const r = el.getBoundingClientRect();
          const t = r.top + window.scrollY;
          const b = r.bottom + window.scrollY;
          if (b > top && t < bottom) hits.push(el.dataset.rowId);
        });
        setSelected(new Set([...base.filter((id) => !hits.includes(id)), ...hits.filter((id) => !base.includes(id))]));
      };
      const onMove = (ev) => {
        last = { x: ev.clientX, y: ev.clientY };
        recompute();
      };
      const onScroll = () => recompute();
      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("scroll", onScroll, true);
        document.body.classList.remove("is-marquee");
        setMarquee(null);
        if (moved) {
          // the drag may end on the space below the script, which would otherwise
          // read it as a click and add a line
          boxDragged.current = true;
          setTimeout(() => (boxDragged.current = false), 0);
          rootRef.current?.focus({ preventScroll: true });
        }
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("scroll", onScroll, true);
    };
    window.addEventListener("pointerdown", onDown);
    return () => window.removeEventListener("pointerdown", onDown);
  }, []);

  // Keys while a highlight spans blocks (the editor itself has focus then).
  const onHighlightKeyDown = (e) => {
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    if (e.key === "Escape") {
      window.getSelection()?.collapseToStart();
      return;
    }
    if (e.key === "Tab") {
      e.preventDefault();
      api.indent(touchedIds(), e.shiftKey ? -1 : 1);
      return;
    }
    if (e.shiftKey && !mod && !e.altKey && e.key.startsWith("Arrow")) {
      e.preventDefault();
      const dir = e.key === "ArrowUp" || e.key === "ArrowLeft" ? -1 : 1;
      stepHighlight(rootRef.current, dir, e.key === "ArrowUp" || e.key === "ArrowDown" ? "line" : "character", goalX);
      return;
    }
    if (e.altKey && !mod) {
      const c = colorForKey(e);
      if (c) {
        e.preventDefault();
        paintSelection(c.hex);
        syncFromDom();
        sfx.play("tap");
        return;
      }
      if (e.key === "ArrowUp" || e.key === "ArrowDown") {
        e.preventDefault();
        const ids = touchedIds();
        dropHighlight();
        if (api.nudge(ids, e.key === "ArrowUp" ? -1 : 1)) {
          setSelected(new Set(ids));
          rootRef.current?.focus({ preventScroll: true });
          sfx.play("tap");
        } else sfx.play("error");
      }
      return;
    }
    if (!mod) return;
    if (k === "z" || k === "y") {
      e.preventDefault();
      if (k === "y" || e.shiftKey) api.redo();
      else api.undo();
      return;
    }
    const mark = e.shiftKey ? (k === "x" || k === "s" ? "strikeThrough" : null) : { b: "bold", i: "italic", u: "underline" }[k];
    if (mark) {
      e.preventDefault();
      exec(mark);
      syncFromDom();
      return;
    }
    const hot = profileRef.current.hotkey(e);
    if (hot) {
      e.preventDefault();
      if (hot !== "pagebreak") api.setTypeMany(touchedIds(), hot);
      return;
    }
    if (k === "d") {
      e.preventDefault();
      const ids = touchedIds();
      dropHighlight();
      api.duplicate(ids);
    }
  };

  // Keys while whole blocks are selected (Ctrl+A twice, the selection box,
  // Shift+click on handles).
  const onSelectionKeyDown = (e) => {
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    const ids = selectedRef.current;
    if (e.key === "Backspace" || e.key === "Delete") {
      e.preventDefault();
      removeIds(ids);
      return;
    }
    if (e.key === "Escape") {
      setSelected(new Set());
      return;
    }
    if (e.key === "Tab") {
      e.preventDefault();
      api.indent([...ids], e.shiftKey ? -1 : 1);
      return;
    }
    if (e.altKey && !mod) {
      const c = colorForKey(e);
      if (c) {
        e.preventDefault();
        api.colorBlocks([...ids], c.hex);
        sfx.play("tap");
        return;
      }
      if (e.key === "ArrowUp" || e.key === "ArrowDown") {
        e.preventDefault();
        sfx.play(api.nudge([...ids], e.key === "ArrowUp" ? -1 : 1) ? "tap" : "error");
      }
      return;
    }
    if (mod && (k === "c" || k === "x")) {
      e.preventDefault();
      copyBlocks(blocksRef.current.filter((b) => ids.has(b.id)));
      if (k === "x") removeIds(ids);
      else sfx.play("tap");
      return;
    }
    if (mod && k === "d") {
      e.preventDefault();
      api.duplicate([...ids]);
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
    if (mod && !e.shiftKey && (k === "b" || k === "i" || k === "u")) {
      e.preventDefault();
      const wrap = (html) => {
        const s = String(html || "").trim();
        if (!s) return html;
        return s.startsWith(`<${k}>`) && s.endsWith(`</${k}>`) ? s.slice(k.length + 2, -(k.length + 3)) : `<${k}>${s}</${k}>`;
      };
      commit(blocksRef.current.map((b) => (ids.has(b.id) && b.type !== "pagebreak" ? { ...b, html: wrap(b.html) } : b)));
      return;
    }
    const hot = mod ? profileRef.current.hotkey(e) : null;
    if (hot && hot !== "pagebreak") {
      e.preventDefault();
      api.setType(null, hot);
    }
  };

  const onRootKeyDown = (e) => {
    if (rootRef.current?.dataset.docMode === "on") return onHighlightKeyDown(e);
    if (e.target !== rootRef.current) return;
    if (selectedRef.current.size) return onSelectionKeyDown(e);
    // undo still works with nothing focused, e.g. right after a block delete
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    if (mod && (k === "z" || k === "y")) {
      e.preventDefault();
      if (k === "y" || e.shiftKey) api.redo();
      else api.undo();
    }
  };

  const onRootCopy = (e) => {
    const copied = clipFromHighlight();
    if (!copied) return;
    e.preventDefault();
    rememberClip(copied);
    e.clipboardData.setData("text/plain", copied.text);
    e.clipboardData.setData("text/html", copied.html);
    if (e.type === "cut") replaceHighlight("");
  };

  const onRootPaste = (e) => {
    const root = rootRef.current;
    const spanning = root?.dataset.docMode === "on";
    if (!spanning && !(e.target === root && selectedRef.current.size)) return;
    e.preventDefault();
    const text = e.clipboardData?.getData("text/plain") || "";
    const copied = clipFor(text);
    if (spanning) {
      replaceHighlight(text, copied);
      return;
    }
    // Whole lines selected: the paste lands after them and nothing is replaced, so
    // Ctrl+C then Ctrl+V makes a copy.
    const profile = profileRef.current;
    const fresh = copied?.blocks ? adoptBlocks(copied.blocks, profile) : copied ? [emptyBlock(profile.base, copied.html)] : profile.parse(text);
    if (!fresh.length) return;
    const list = blocksRef.current;
    const at = list.reduce((last, b, i) => (selectedRef.current.has(b.id) ? i : last), -1) + 1;
    commit([...list.slice(0, at), ...fresh, ...list.slice(at)]);
    setSelected(new Set(fresh.map((b) => b.id)));
    root.focus({ preventScroll: true });
  };

  const sceneNumbers = useMemo(() => {
    const map = {};
    let n = 0;
    for (const b of blocks) if (b.type === "scene") map[b.id] = ++n;
    return map;
  }, [blocks]);

  // A character's colour runs through their cue and everything they say under it.
  const tints = useMemo(() => {
    const map = {};
    let speaker = null;
    for (const b of blocks) {
      if (b.type === "note") continue; // a note mid-speech doesn't end it
      if (b.type === "character") speaker = characterName(plainText(b.html)) || null;
      else if (!SPEAKING.has(b.type)) speaker = null;
      const c = speaker && cast?.[speaker]?.color;
      if (c) map[b.id] = c;
    }
    return map;
  }, [blocks, cast]);

  // List markers: numbers count up within a run of lines at their own level.
  const markers = useMemo(() => {
    const map = {};
    const counts = [];
    for (const b of blocks) {
      if (!LIST_TYPES.has(b.type)) {
        counts.length = 0;
        continue;
      }
      const level = b.indent || 0;
      counts.length = level + 1;
      if (b.type === "number") {
        counts[level] = (counts[level] || 0) + 1;
        map[b.id] = `${counts[level]}.`;
      } else {
        counts[level] = 0;
        if (b.type === "bullet") map[b.id] = BULLETS[level % BULLETS.length];
      }
    }
    return map;
  }, [blocks]);

  const icons = useMemo(() => {
    const map = {};
    if (cast) {
      for (const b of blocks) {
        if (b.type !== "character") continue;
        const icon = cast[characterName(plainText(b.html))]?.icon;
        if (icon) map[b.id] = icon;
      }
    }
    return map;
  }, [blocks, cast]);

  // Right-clicking a word with a red underline. Any other right-click keeps the
  // usual menu for cut, copy and paste.
  const onRootContextMenu = (e) => {
    if (rootRef.current?.dataset.docMode === "on") return;
    const hit = spell.wordAt(e.clientX, e.clientY);
    if (!hit) return;
    e.preventDefault();
    const rect = hit.range.getBoundingClientRect();
    setSpellMenu({
      ...hit,
      suggestions: spell.suggest(hit.word),
      anchor: { current: { getBoundingClientRect: () => rect, contains: () => false } },
    });
  };

  const fixWord = (replacement) => {
    const { body, range } = spellMenu;
    setSpellMenu(null);
    body.focus({ preventScroll: true });
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    document.execCommand("insertText", false, replacement);
  };

  const menuBlock = menu ? blocks.find((b) => b.id === menu.id) : null;
  const menuTargets = menuBlock && selected.has(menuBlock.id) ? [...selected] : menuBlock ? [menuBlock.id] : [];
  const lonely = blocks.length === 1;

  return (
    <div
      ref={rootRef}
      className="editor"
      tabIndex={-1}
      data-scene-numbers={settings.sceneNumbers}
      data-profile={profile.kind}
      spellCheck={!SPELL_SUPPORTED}
      onContextMenu={onRootContextMenu}
      onMouseMove={onRootMouseMove}
      onMouseLeave={closeCardSoon}
      onFocusCapture={() => (lastEditor = rootRef.current)}
      onPointerDownCapture={() => (lastEditor = rootRef.current)}
      data-selecting={selected.size > 0}
      onKeyDown={onRootKeyDown}
      onCopy={onRootCopy}
      onCut={onRootCopy}
      onPaste={onRootPaste}
      // Dragging highlighted text around would tear blocks apart, and a highlight
      // drawn under the pointer mid-drag would otherwise start one. Lines move by
      // their handles instead.
      onDragStart={(e) => e.preventDefault()}
      onDrop={(e) => e.preventDefault()}
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
          color={b.color || tints[b.id] || null}
          marker={markers[b.id]}
          commentCount={commentCounts?.[b.id] || 0}
          changeOwn={changeMarks[b.id]?.own}
          changeAfter={changeMarks[b.id]?.after}
          icon={icons[b.id]}
          api={api}
        />
      ))}
      <div
        className="editor-tail"
        contentEditable={false}
        onClick={() => {
          if (boxDragged.current) return;
          dropHighlight();
          const list = blocksRef.current;
          const last = list[list.length - 1];
          if (last && last.type !== "pagebreak" && !textOf(last.html)) {
            setFocusReq({ id: last.id, at: "end", t: Date.now() });
            return;
          }
          const nb = last ? emptyBlock(profile.next[last.type] || profile.base) : profile.starter()[0];
          commit([...list, nb], { focus: { id: nb.id, at: "start" } });
        }}
      />
      {marquee && <div className="marquee" style={marquee} contentEditable={false} />}

      {cardChanges?.length > 0 && (
        <Popover key={changeCard.id} anchorRef={changeCard.anchor} width={400} className="change-card" onClose={() => setChangeCard(null)}>
          <div onMouseEnter={() => clearTimeout(cardTimer.current)} onMouseLeave={closeCardSoon}>
            {cardChanges.map((c) => (
              <ChangeRow
                key={c.id}
                change={c}
                person={changeUi?.people?.[c.authorId]}
                mine={c.authorId === changeUi?.me}
                canDecide={changeUi?.canDecide}
                stale={changeUi?.staleLines?.has(c.id)}
                onAccept={changeUi?.onAccept}
                onReject={changeUi?.onReject}
                onDiscard={changeUi?.onDiscard}
              />
            ))}
          </div>
        </Popover>
      )}

      <SelectionBar rootRef={rootRef} customs={settings.customColors} onApplied={syncFromDom} />

      {spellMenu && (
        <Popover anchorRef={spellMenu.anchor} width={220} className="card-menu spell-menu" onClose={() => setSpellMenu(null)}>
          {spellMenu.suggestions.map((s) => (
            <button key={s} className="menu-item" onMouseDown={(e) => e.preventDefault()} onClick={() => fixWord(s)}>
              {s}
            </button>
          ))}
          {!spellMenu.suggestions.length && <span className="menu-label">No suggestions</span>}
          <div className="menu-sep" />
          <button
            className="menu-item"
            onClick={() => {
              updateSettings({ dictionary: [...new Set([...(settings.dictionary || []), spellMenu.word.toLowerCase()])] });
              setSpellMenu(null);
              sfx.play("add");
            }}
          >
            <span className="menu-icon">+</span>Add to Dictionary
          </button>
        </Popover>
      )}

      {menuBlock && (
        <BlockMenu
          anchorRef={menu.anchor}
          block={menuBlock}
          types={profile.types}
          count={menuTargets.length}
          onClose={() => setMenu(null)}
          onColor={(hex) => {
            setMenu(null);
            api.colorBlocks(menuTargets, hex);
            sfx.play("tap");
          }}
          onPick={(type) => {
            setMenu(null);
            api.setTypeMany(menuTargets, type);
            if (menuBlock.type === "pagebreak" || menuTargets.length > 1) return;
            setFocusReq({ id: menuBlock.id, at: "end", t: Date.now() });
          }}
          onInsert={(side) => {
            setMenu(null);
            const list = blocksRef.current;
            const i = list.findIndex((b) => b.id === menuBlock.id);
            const nb = emptyBlock(profile.base);
            commit([...list.slice(0, i + side), nb, ...list.slice(i + side)], { focus: { id: nb.id, at: "start" } });
          }}
          onCopy={() => {
            setMenu(null);
            copyBlocks(blocksRef.current.filter((b) => menuTargets.includes(b.id)));
            sfx.play("tap");
          }}
          onDuplicate={() => {
            setMenu(null);
            api.duplicate(menuTargets);
          }}
          onDelete={() => {
            setMenu(null);
            removeIds(new Set(menuTargets));
          }}
        />
      )}
    </div>
  );
});

export default ScriptEditor;
