import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { characterName, plainText } from "./script";

// The app's own spell check. The webview's built-in one can't be told about new
// words, so it's switched off on script lines and this takes over: a Hunspell
// dictionary checked here, with the red underlines drawn by the CSS Custom Highlight
// API, which marks text without touching the document. Dictionaries load on demand.

// Where the highlight API is missing (old webviews) the built-in checker stays on.
export const SPELL_SUPPORTED = typeof CSS !== "undefined" && "highlights" in CSS && typeof Highlight !== "undefined";

const LOADERS = {
  "en-GB": () =>
    Promise.all([import("../../node_modules/dictionary-en-gb/index.aff?raw"), import("../../node_modules/dictionary-en-gb/index.dic?raw")]),
  "en-US": () =>
    Promise.all([import("../../node_modules/dictionary-en/index.aff?raw"), import("../../node_modules/dictionary-en/index.dic?raw")]),
};

const checkers = {};
const loadChecker = (lang) => {
  if (!checkers[lang]) {
    checkers[lang] = Promise.all([import("nspell"), (LOADERS[lang] || LOADERS["en-GB"])()]).then(([{ default: nspell }, [aff, dic]]) => {
      const spell = nspell(aff.default, dic.default);
      const seen = new Map();
      return {
        correct: (word) => {
          if (!seen.has(word)) seen.set(word, spell.correct(word));
          return seen.get(word);
        },
        suggest: (word) => spell.suggest(word),
      };
    });
  }
  return checkers[lang];
};

const WORD = /[\p{L}\p{M}\p{N}]+(?:['’][\p{L}\p{M}]+)*/gu;
// screenplay shorthand no dictionary knows
const SHORTHAND = ["int", "ext", "est", "ie", "vo", "os", "ots", "pov", "contd", "cont'd", "mos"];

const normal = (word) => word.replace(/’/g, "'");

const isFine = (checker, raw, allowed) => {
  const word = normal(raw);
  if (word.length < 2 || /\p{N}/u.test(word)) return true;
  const lower = word.toLowerCase();
  if (allowed.has(lower) || allowed.has(lower.replace(/'s$/, ""))) return true;
  // all capitals: an acronym, or a heading typed in capitals
  if (word === word.toUpperCase()) return true;
  return checker.correct(word) || (lower.endsWith("'s") && checker.correct(word.slice(0, -2)));
};

// Every editor on screen (a script and a scramble beside it) shares one highlight.
const marked = new Map();
const paint = () => {
  if (!SPELL_SUPPORTED) return;
  const ranges = [...marked.values()].flat();
  if (ranges.length) CSS.highlights.set("spell", new Highlight(...ranges));
  else CSS.highlights.delete("spell");
};

// A character cue is a name, so it isn't checked, and the same name in the action
// around it counts as a word.
const castWords = (blocks) => {
  const words = new Set();
  for (const b of blocks) {
    if (b.type !== "character") continue;
    for (const part of characterName(plainText(b.html)).toLowerCase().split(/\s+/)) if (part) words.add(normal(part));
  }
  return words;
};

export function useSpellcheck(rootRef, blocks, settings) {
  const enabled = SPELL_SUPPORTED && settings.spellcheck !== false;
  const [checker, setChecker] = useState(null);
  const dictionary = settings.dictionary;

  const allowed = useMemo(() => new Set([...SHORTHAND, ...(dictionary || []), ...castWords(blocks)]), [dictionary, blocks]);
  const allowedRef = useRef(allowed);
  allowedRef.current = allowed;

  useEffect(() => {
    if (!enabled) {
      setChecker(null);
      return;
    }
    let alive = true;
    loadChecker(settings.spellLang).then(
      (c) => alive && setChecker(c),
      () => {} // no dictionary is no underlines, never a broken editor
    );
    return () => {
      alive = false;
    };
  }, [enabled, settings.spellLang]);

  const scan = useCallback(() => {
    const root = rootRef.current;
    if (!root) return;
    if (!checker) {
      marked.delete(root);
      paint();
      return;
    }
    const sel = window.getSelection();
    const caretNode = sel?.isCollapsed ? sel.anchorNode : null;
    const caretAt = sel?.anchorOffset;
    const ranges = [];
    for (const body of root.querySelectorAll("[data-block-id]")) {
      if (body.parentElement?.dataset.type === "character") continue;
      const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const node = walker.currentNode;
        for (const m of node.data.matchAll(WORD)) {
          const end = m.index + m[0].length;
          // the word still being typed isn't wrong yet
          if (node === caretNode && caretAt === end) continue;
          if (isFine(checker, m[0], allowedRef.current)) continue;
          const range = document.createRange();
          range.setStart(node, m.index);
          range.setEnd(node, end);
          ranges.push(range);
        }
      }
    }
    marked.set(root, ranges);
    paint();
  }, [checker, rootRef]);

  // after a pause in the typing, and again when the caret moves off a finished word
  useEffect(() => {
    const t = setTimeout(scan, 300);
    return () => clearTimeout(t);
  }, [scan, blocks, allowed]);

  useEffect(() => {
    let t;
    const onChange = () => {
      clearTimeout(t);
      t = setTimeout(scan, 400);
    };
    document.addEventListener("selectionchange", onChange);
    return () => {
      clearTimeout(t);
      document.removeEventListener("selectionchange", onChange);
    };
  }, [scan]);

  useEffect(() => {
    const root = rootRef.current;
    return () => {
      marked.delete(root);
      paint();
    };
  }, [rootRef]);

  // The misspelled word under the pointer, if there is one.
  const wordAt = useCallback(
    (x, y) => {
      if (!checker) return null;
      const point = document.caretRangeFromPoint?.(x, y);
      const node = point?.startContainer;
      if (node?.nodeType !== 3) return null;
      const body = node.parentElement?.closest("[data-block-id]");
      if (!body || body.parentElement?.dataset.type === "character") return null;
      for (const m of node.data.matchAll(WORD)) {
        const end = m.index + m[0].length;
        if (point.startOffset < m.index || point.startOffset > end) continue;
        if (isFine(checker, m[0], allowedRef.current)) return null;
        const range = document.createRange();
        range.setStart(node, m.index);
        range.setEnd(node, end);
        // the point can land at the end of a line when the click was out past it
        const over = [...range.getClientRects()].some((r) => x >= r.left - 2 && x <= r.right + 2 && y >= r.top - 2 && y <= r.bottom + 2);
        return over ? { word: normal(m[0]), range, body } : null;
      }
      return null;
    },
    [checker]
  );

  const suggest = useCallback((word) => (checker ? checker.suggest(word).slice(0, 6) : []), [checker]);

  return { wordAt, suggest };
}
