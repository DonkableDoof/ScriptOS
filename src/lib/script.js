import { uid } from "./storage";

// Every element a screenplay is made of. `hotkey` is Ctrl+<key> (or Ctrl+Shift+<key>);
// `prefix` is what you can type at the start of an Action line to turn it into one.
export const TYPES = [
  { key: "scene", label: "Scene Heading", icon: "S", hotkey: "1", prefix: "INT. / EXT.", words: "scene heading slugline slug int ext location" },
  { key: "action", label: "Action", icon: "A", hotkey: "2", prefix: "", words: "action description text" },
  { key: "character", label: "Character", icon: "C", hotkey: "3", prefix: "@", placeholder: "CHARACTER", words: "character name speaker cue" },
  { key: "parenthetical", label: "Parenthetical", icon: "()", hotkey: "4", prefix: "(", words: "parenthetical wryly beat direction" },
  { key: "dialogue", label: "Dialogue", icon: "D", hotkey: "5", prefix: "", words: "dialogue speech line talk" },
  { key: "subtext", label: "Subtext", icon: "≈", hotkey: "6", prefix: "-#", words: "subtext meaning hidden intent" },
  { key: "transition", label: "Transition", icon: "→", hotkey: "7", prefix: ">", words: "transition cut fade dissolve" },
  { key: "shot", label: "Shot", icon: "◎", hotkey: "8", prefix: "!!", words: "shot camera angle close insert pov" },
  { key: "note", label: "Note", icon: "✎", hotkey: "9", prefix: "[[", words: "note comment reminder todo" },
  { key: "act", label: "Act Heading", icon: "Ac", hotkey: "Shift+1", prefix: "", words: "act heading break teaser cold open tag" },
  { key: "heading", label: "Heading 1", icon: "H1", hotkey: "Shift+2", prefix: "#", words: "heading 1 h1 title part" },
  { key: "sequence", label: "Heading 2", icon: "H2", hotkey: "Shift+3", prefix: "##", words: "heading 2 h2 sequence section" },
  { key: "beat", label: "Heading 3", icon: "H3", hotkey: "Shift+4", prefix: "###", words: "heading 3 h3 beat moment" },
  { key: "centered", label: "Centered", icon: "≡", hotkey: "Shift+5", prefix: "><", words: "centered center title card end" },
  { key: "lyrics", label: "Lyrics", icon: "♪", hotkey: "Shift+6", prefix: "~", words: "lyrics song sing music" },
  { key: "pagebreak", label: "Page Break", icon: "—", hotkey: "Shift+7", prefix: "---", words: "page break divider new page" },
].map((t) => ({ placeholder: t.key === "pagebreak" ? "" : "Enter text", ...t }));

export const TYPE_BY_KEY = Object.fromEntries(TYPES.map((t) => [t.key, t]));

// Ctrl+1..9 and Ctrl+Shift+1..7, read from e.code so Shift doesn't turn 1 into !
export const typeForHotkey = (e) => {
  const m = /^Digit(\d)$/.exec(e.code || "");
  if (!m) return null;
  const want = e.shiftKey ? `Shift+${m[1]}` : m[1];
  return TYPES.find((t) => t.hotkey === want)?.key || null;
};

// What Enter makes next, the way screenwriting apps flow.
export const NEXT = {
  scene: "action",
  action: "action",
  character: "dialogue",
  parenthetical: "dialogue",
  dialogue: "character",
  subtext: "character",
  transition: "scene",
  shot: "action",
  note: "action",
  act: "scene",
  heading: "action",
  sequence: "scene",
  beat: "action",
  centered: "action",
  lyrics: "lyrics",
  pagebreak: "scene",
};

// Tab walks through the everyday elements; Shift+Tab walks back.
export const TAB_ORDER = ["action", "character", "dialogue", "parenthetical", "subtext", "transition", "scene"];

// Elements that are for the writer and never printed (unless the settings say so).
export const PRIVATE_TYPES = new Set(["note", "subtext"]);

export const emptyBlock = (type = "action", html = "") => ({ id: uid(), type, html });

// A new script opens on its first act.
export const starterBlocks = () => [emptyBlock("act")];

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------
const ENTITIES = { "&nbsp;": " ", "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'" };

// Regex, not the DOM: stats run over every block of every script on the home page.
export const plainText = (html) =>
  String(html || "")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&(nbsp|amp|lt|gt|quot|#39);/g, (m) => ENTITIES[m] || m);

export const escapeHtml = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export const countWords = (text) => {
  const m = String(text).match(/[\p{L}\p{N}'’-]+/gu);
  return m ? m.length : 0;
};

// "BOB (V.O.)" and "BOB (CONT'D)" are both Bob.
export const characterName = (text) =>
  String(text)
    .replace(/\(.*?\)/g, "")
    .replace(/\^$/, "")
    .trim()
    .toUpperCase();

// Per-block numbers, cached on the block object itself. Blocks are replaced, never
// mutated, so an unchanged block keeps its entry and stats stay cheap while typing.
const cache = new WeakMap();
export const blockMetrics = (block) => {
  let m = cache.get(block);
  if (m) return m;
  const text = plainText(block.html).trim();
  m = {
    text,
    words: block.type === "pagebreak" ? 0 : countWords(text),
    line: text.length > 0 && block.type !== "pagebreak" ? 1 : 0,
  };
  cache.set(block, m);
  return m;
};

export const totalsOf = (blocks = []) => {
  let words = 0;
  let lines = 0;
  for (const b of blocks) {
    const m = blockMetrics(b);
    words += m.words;
    lines += m.line;
  }
  return { words, lines };
};

// ---------------------------------------------------------------------------
// Page estimate. A screenplay page is ~55 lines of 12pt Courier, and each element
// has its own width. One page is roughly one minute of screen time.
// ---------------------------------------------------------------------------
const LAYOUT = {
  scene: { width: 61, before: 2 },
  action: { width: 61, before: 1 },
  character: { width: 38, before: 1 },
  parenthetical: { width: 25, before: 0 },
  dialogue: { width: 35, before: 0 },
  transition: { width: 61, before: 1 },
  shot: { width: 61, before: 1 },
  act: { width: 61, before: 2 },
  heading: { width: 61, before: 2 },
  sequence: { width: 61, before: 1 },
  beat: { width: 61, before: 1 },
  centered: { width: 61, before: 1 },
  lyrics: { width: 35, before: 0 },
  note: { width: 61, before: 1 },
  subtext: { width: 35, before: 0 },
};
const LINES_PER_PAGE = 55;

const wrappedLines = (text, width) => {
  if (!text) return 1;
  let lines = 0;
  for (const para of text.split("\n")) lines += Math.max(1, Math.ceil(para.length / width));
  return lines;
};

export const estimatePages = (blocks = [], { includePrivate = false } = {}) => {
  let pages = 0;
  let used = 0;
  let any = false;
  for (const b of blocks) {
    if (b.type === "pagebreak") {
      if (used > 0) {
        pages += 1;
        used = 0;
      }
      continue;
    }
    if (PRIVATE_TYPES.has(b.type) && !includePrivate) continue;
    const { text } = blockMetrics(b);
    if (!text) continue;
    any = true;
    const layout = LAYOUT[b.type] || LAYOUT.action;
    const height = (used > 0 ? layout.before : 0) + wrappedLines(text, layout.width);
    if (used + height > LINES_PER_PAGE) {
      pages += 1;
      used = height - layout.before;
    } else used += height;
  }
  if (!any) return 0;
  return pages + used / LINES_PER_PAGE;
};

// Characters, scenes and dialogue counts for one script.
export const scriptStats = (script) => {
  const blocks = script?.blocks || [];
  const { words, lines } = totalsOf(blocks);
  const characters = {};
  const scenes = [];
  const acts = [];
  let dialogueLines = 0;
  let speaker = null;

  blocks.forEach((b, index) => {
    const { text } = blockMetrics(b);
    if (b.type === "scene") {
      scenes.push({ id: b.id, index, text: text.toUpperCase() || "UNTITLED SCENE" });
      speaker = null;
    } else if (b.type === "act") {
      acts.push({ id: b.id, index, text: text.toUpperCase() || "UNTITLED ACT" });
      speaker = null;
    } else if (b.type === "character") {
      speaker = characterName(text) || null;
      if (speaker && !characters[speaker]) characters[speaker] = { name: speaker, lines: 0, words: 0 };
    } else if (b.type === "dialogue" && text) {
      dialogueLines += 1;
      if (speaker && characters[speaker]) {
        characters[speaker].lines += 1;
        characters[speaker].words += blockMetrics(b).words;
      }
    } else if (b.type !== "parenthetical" && b.type !== "subtext" && b.type !== "note") {
      // a note to yourself mid-speech doesn't end it
      speaker = null;
    }
  });

  const pages = estimatePages(blocks);
  return {
    words,
    lines,
    dialogueLines,
    scenes,
    acts,
    characters: Object.values(characters).sort((a, b) => b.lines - a.lines || a.name.localeCompare(b.name)),
    pages,
  };
};

export const formatPages = (pages) => {
  if (!pages) return "0 pages";
  if (pages < 1) return "< 1 page";
  const n = Math.round(pages * 10) / 10;
  const shown = n % 1 === 0 ? n.toFixed(0) : n.toFixed(1);
  return `${shown} ${n === 1 ? "page" : "pages"}`;
};

export const formatRuntime = (pages) => {
  const minutes = Math.round(pages);
  if (!pages) return "0 min";
  if (minutes < 1) return "< 1 min";
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
};

// ---------------------------------------------------------------------------
// Scripts
// ---------------------------------------------------------------------------
export const FORMATS = [
  { key: "movie", label: "Movie", short: "Movie", plural: "Movies" },
  { key: "short", label: "Short Film", short: "Short", plural: "Short Films" },
  { key: "episode", label: "Episode", short: "Episode", plural: "Episodes" },
  { key: "skit", label: "Skit", short: "Skit", plural: "Skits" },
];
export const FORMAT_BY_KEY = Object.fromEntries(FORMATS.map((f) => [f.key, f]));
export const isTv = (format) => format === "episode";

// Formats from 1.0, and where each one lives now.
const OLD_FORMATS = { feature: "movie", pilot: "episode", other: "movie" };
export const needsMigration = (script) => Boolean(OLD_FORMATS[script.format]) || !script.cast;
export const migrateScript = (script) =>
  needsMigration(script) ? { ...script, format: OLD_FORMATS[script.format] || script.format, cast: script.cast || {} } : script;

export const episodeLabel = (script) => {
  if (!isTv(script?.format)) return "";
  const s = String(script.season || "").trim();
  const e = String(script.episode || "").trim();
  if (s && e) return `S${s.padStart(2, "0")}E${e.padStart(2, "0")}`;
  if (e) return `Episode ${e}`;
  return "";
};

export const newScript = (fields = {}) => {
  const now = Date.now();
  return {
    id: uid(),
    title: "Untitled Script",
    format: "movie",
    show: "",
    season: "",
    episode: "",
    logline: "",
    author: "",
    draft: "",
    cover: "",
    coverHue: Math.floor(Math.random() * 360),
    archived: false,
    // character name → { color }, remembered even after their lines are cut
    cast: {},
    blocks: starterBlocks(),
    createdAt: now,
    updatedAt: now,
    ...fields,
  };
};

// A scramble: an idea got down fast, or a rough outline of something to write
// properly later. A plain document, not a screenplay.
export const newScramble = (fields = {}) => {
  const now = Date.now();
  return { id: uid(), title: "", blocks: [emptyBlock("text")], createdAt: now, updatedAt: now, ...fields };
};

// A scramble's name: its title, or failing that its first line.
export const scrambleTitle = (scramble) => {
  const t = String(scramble?.title || "").trim();
  if (t) return t;
  const first = (scramble?.blocks || []).map((b) => blockMetrics(b).text).find(Boolean);
  return first ? (first.length > 48 ? `${first.slice(0, 46)}…` : first) : "Untitled Scramble";
};

export const timeAgo = (ts) => {
  if (!ts) return "";
  const s = Math.max(0, (Date.now() - ts) / 1000);
  if (s < 60) return "just now";
  const m = s / 60;
  if (m < 60) return `${Math.floor(m)}m ago`;
  const h = m / 60;
  if (h < 24) return `${Math.floor(h)}h ago`;
  const d = h / 24;
  if (d < 7) return `${Math.floor(d)}d ago`;
  return new Date(ts).toLocaleDateString(undefined, { day: "numeric", month: "short", year: d > 330 ? "numeric" : undefined });
};

// ---------------------------------------------------------------------------
// Suggestions while typing a character, a scene heading or a transition.
// ---------------------------------------------------------------------------
export const TIMES_OF_DAY = ["DAY", "NIGHT", "MORNING", "AFTERNOON", "EVENING", "DUSK", "DAWN", "CONTINUOUS", "LATER", "MOMENTS LATER"];
export const SCENE_PREFIXES = ["INT. ", "EXT. ", "INT./EXT. ", "EST. "];
export const ACT_NUMBERS = ["ONE", "TWO", "THREE", "FOUR", "FIVE", "SIX", "SEVEN", "EIGHT"];
export const ACT_NAMES = ["COLD OPEN", "TEASER", "PROLOGUE", "TAG", "EPILOGUE"];
export const TRANSITIONS = ["CUT TO:", "SMASH CUT TO:", "MATCH CUT TO:", "JUMP CUT TO:", "DISSOLVE TO:", "FADE TO BLACK.", "FADE OUT.", "FADE IN:", "INTERCUT WITH:", "BACK TO:"];

// `known` adds names remembered outside these blocks: the script's cast list, and
// the other episodes of the same show.
export const suggestionsFor = (type, text, blocks, selfId, known = []) => {
  // untrimmed on purpose: "EXT. " has moved on from "EXT."
  const typed = String(text || "").replace(/ /g, " ").replace(/^\s+/, "").toUpperCase();
  const pick = (pool) =>
    [...new Set(pool)].filter((v) => v.startsWith(typed) && v !== typed).slice(0, 6).map((v) => ({ label: v, value: v }));

  if (type === "character") {
    if (!typed.trim()) return [];
    const names = blocks.filter((b) => b.type === "character" && b.id !== selfId).map((b) => characterName(blockMetrics(b).text)).filter(Boolean);
    return pick([...names, ...known.map(characterName)]);
  }
  if (type === "scene") {
    const dash = / - $/.exec(typed) || / -$/.exec(typed);
    if (dash) {
      const base = typed.replace(/ -\s?$/, "") + " - ";
      return TIMES_OF_DAY.map((t) => ({ label: t, value: base + t }));
    }
    if (!typed.trim()) return SCENE_PREFIXES.map((p) => ({ label: p.trim(), value: p }));
    const headings = blocks.filter((b) => b.type === "scene" && b.id !== selfId).map((b) => blockMetrics(b).text.toUpperCase()).filter(Boolean);
    const locations = headings.map((h) => h.replace(/\s+-\s+[^-]*$/, ""));
    return pick([...SCENE_PREFIXES, ...locations, ...headings]);
  }
  if (type === "act") {
    // the next act first, then the end of the one you're in, then the named parts
    const used = blocks
      .filter((b) => b.type === "act" && b.id !== selfId)
      .map((b) => blockMetrics(b).text.toUpperCase())
      .map((t) => ACT_NUMBERS.indexOf((/^ACT (\w+)$/.exec(t) || [])[1]))
      .filter((n) => n >= 0);
    const last = used.length ? Math.max(...used) : -1;
    const pool = [
      ...(last + 1 < ACT_NUMBERS.length ? [`ACT ${ACT_NUMBERS[last + 1]}`] : []),
      ...(last >= 0 ? [`END OF ACT ${ACT_NUMBERS[last]}`] : []),
      ...ACT_NUMBERS.map((n) => `ACT ${n}`),
      ...ACT_NAMES,
    ];
    return typed.trim() ? pick(pool) : pick(pool).slice(0, 5);
  }
  if (type === "transition") return pick(TRANSITIONS);
  return [];
};
