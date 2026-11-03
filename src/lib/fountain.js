import { emptyBlock, escapeHtml, plainText, isTv, episodeLabel } from "./script";

// Fountain (fountain.io) is the plain-text screenplay format every other app reads,
// so it is both the export and the import, and what multi-line pastes are read as.

const SCENE_START = /^(INT|EXT|EST|INT\.?\/EXT|EXT\.?\/INT|I\/E)[.\s]/i;
const hasLetters = (s) => /\p{L}/u.test(s);
const isAllCaps = (s) => hasLetters(s) && s === s.toUpperCase();

// ---------------------------------------------------------------------------
// inline marks
// ---------------------------------------------------------------------------
export const marksToHtml = (line) =>
  escapeHtml(line)
    .replace(/\*\*\*(.+?)\*\*\*/g, "<b><i>$1</i></b>")
    .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
    .replace(/\*(.+?)\*/g, "<i>$1</i>")
    .replace(/_(.+?)_/g, "<u>$1</u>");

// Formatting written as styled spans (pasted, or from a colour change) reads as the
// tag it stands for.
const spansToTags = (html) => {
  if (!/<span[^>]*style=/i.test(html) || typeof document === "undefined") return html;
  const box = document.createElement("div");
  box.innerHTML = html;
  // innermost first, so an outer span carries its converted contents with it
  [...box.querySelectorAll("span[style]")].reverse().forEach((span) => {
    const s = span.style;
    let inner = span.innerHTML;
    if (/bold|[6-9]00/.test(s.fontWeight)) inner = `<b>${inner}</b>`;
    if (s.fontStyle === "italic") inner = `<i>${inner}</i>`;
    if (/underline/.test(s.textDecorationLine || s.textDecoration)) inner = `<u>${inner}</u>`;
    span.outerHTML = inner;
  });
  return box.innerHTML;
};

export const htmlToMarks = (html) =>
  plainText(
    spansToTags(String(html || ""))
      .replace(/<\/?(b|strong)>/gi, "**")
      .replace(/<\/?(i|em)>/gi, "*")
      .replace(/<\/?u>/gi, "_")
  ).trim();

// Section headings that are acts rather than general headings.
export const ACT_TEXT = /^(ACT\s+\S+|END OF ACT\b.*|COLD OPEN|TEASER|PROLOGUE|EPILOGUE|TAG)$/i;

// ---------------------------------------------------------------------------
// parse
// ---------------------------------------------------------------------------
const TITLE_KEY = /^([A-Za-z][A-Za-z ]*):\s*(.*)$/;

const readTitlePage = (lines) => {
  if (!lines.length || !TITLE_KEY.test(lines[0])) return { meta: {}, rest: lines };
  const meta = {};
  let i = 0;
  let key = null;
  for (; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) break;
    const m = TITLE_KEY.exec(line);
    if (m) {
      key = m[1].trim().toLowerCase();
      meta[key] = m[2].trim();
    } else if (key) {
      meta[key] = [meta[key], line.trim()].filter(Boolean).join("\n");
    }
  }
  return { meta, rest: lines.slice(i + 1) };
};

export function parseFountain(text, { titlePage = false } = {}) {
  let lines = String(text || "").replace(/\r\n?/g, "\n").split("\n");
  let meta = {};
  if (titlePage) ({ meta, rest: lines } = readTitlePage(lines));

  const blocks = [];
  const push = (type, raw) => blocks.push(emptyBlock(type, marksToHtml(raw)));
  let inDialogue = false;

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.trim();
    const prevBlank = i === 0 || !lines[i - 1].trim();
    const nextLine = (lines[i + 1] || "").trim();

    if (!line) {
      inDialogue = false;
      continue;
    }

    if (inDialogue) {
      if (/^\(.*\)$/.test(line)) push("parenthetical", line.slice(1, -1));
      else if (/^~/.test(line)) push("lyrics", line.replace(/^~\s*/, ""));
      else if (/^\[\[subtext:\s*(.*)\]\]$/i.test(line)) push("subtext", line.replace(/^\[\[subtext:\s*/i, "").replace(/\]\]$/, ""));
      else push("dialogue", line);
      continue;
    }

    if (/^={3,}$/.test(line)) {
      blocks.push(emptyBlock("pagebreak"));
      continue;
    }
    if (/^###+\s*/.test(line)) {
      push("beat", line.replace(/^###+\s*/, ""));
      continue;
    }
    if (/^##\s*/.test(line)) {
      push("sequence", line.replace(/^##\s*/, ""));
      continue;
    }
    if (/^#\s*/.test(line)) {
      // Fountain writes acts and other top-level sections the same way; the words
      // tell them apart
      const text = line.replace(/^#\s*/, "");
      push(ACT_TEXT.test(text.trim()) ? "act" : "heading", text);
      continue;
    }
    if (/^\[\[.*\]\]$/.test(line)) {
      const inner = line.slice(2, -2).trim();
      if (/^subtext:/i.test(inner)) push("subtext", inner.replace(/^subtext:\s*/i, ""));
      else push("note", inner);
      continue;
    }
    if (/^=(?!=)/.test(line)) {
      // Fountain synopses read naturally as subtext
      push("subtext", line.replace(/^=\s*/, ""));
      continue;
    }
    if (/^>.*<$/.test(line)) {
      push("centered", line.slice(1, -1).trim());
      continue;
    }
    if (/^>/.test(line)) {
      push("transition", line.replace(/^>\s*/, ""));
      continue;
    }
    if (/^~/.test(line)) {
      push("lyrics", line.replace(/^~\s*/, ""));
      continue;
    }
    if (/^\.[^.]/.test(line)) {
      push("scene", line.slice(1).replace(/\s+#[^#]+#$/, ""));
      continue;
    }
    if (SCENE_START.test(line) && prevBlank) {
      push("scene", line.replace(/\s+#[^#]+#$/, ""));
      continue;
    }
    if (/^!/.test(line)) {
      push("action", line.slice(1));
      continue;
    }
    if (/^@/.test(line) && nextLine) {
      push("character", line.slice(1).trim());
      inDialogue = true;
      continue;
    }
    if (isAllCaps(line) && /TO:$/.test(line) && prevBlank && !nextLine) {
      push("transition", line);
      continue;
    }
    if (isAllCaps(line) && prevBlank && nextLine && line.length <= 40 && !/[.!?:]$/.test(line.replace(/\(.*\)$/, "").trim())) {
      push("character", line);
      inDialogue = true;
      continue;
    }
    push("action", line);
  }

  return { blocks, meta };
}

// ---------------------------------------------------------------------------
// serialise
// ---------------------------------------------------------------------------
export function toFountain(script, { includeNotes = false, includeSubtext = false, titlePage = true } = {}) {
  const out = [];
  if (titlePage) writeTitlePage(script, out);
  writeBody(script.blocks || [], out, { includeNotes, includeSubtext });
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}

function writeTitlePage(script, out) {
  const title = script.title || "Untitled Script";
  out.push(`Title: ${title}`);
  if (isTv(script.format) && script.show) out.push(`Series: ${script.show}`);
  const ep = episodeLabel(script);
  if (ep) out.push(`Episode: ${ep}`);
  out.push("Credit: Written by");
  out.push(`Author: ${script.author || ""}`);
  if (script.draft) out.push(`Draft date: ${script.draft}`);
  if (script.contact) out.push(`Contact:\n    ${script.contact.split("\n").join("\n    ")}`);
  out.push("");
}

function writeBody(blocks, out, { includeNotes, includeSubtext }) {
  let prev = null;
  for (const b of blocks) {
    if (b.type === "note" && !includeNotes) continue;
    if (b.type === "subtext" && !includeSubtext) continue;
    const text = htmlToMarks(b.html);
    if (!text && b.type !== "pagebreak") continue;

    const tight =
      (b.type === "dialogue" || b.type === "parenthetical" || b.type === "subtext" || b.type === "lyrics") &&
      prev && ["character", "parenthetical", "dialogue", "subtext", "lyrics"].includes(prev);
    if (!tight) out.push("");

    switch (b.type) {
      case "scene": {
        const up = text.toUpperCase();
        out.push(SCENE_START.test(up) ? up : `.${up}`);
        break;
      }
      case "character": {
        const up = text.toUpperCase();
        out.push(isAllCaps(up) ? up : `@${up}`);
        break;
      }
      case "parenthetical":
        out.push(`(${text.replace(/^\(|\)$/g, "")})`);
        break;
      case "transition": {
        const up = text.toUpperCase();
        out.push(/TO:$/.test(up) ? up : `> ${up}`);
        break;
      }
      case "shot":
        out.push(text.toUpperCase());
        break;
      case "note":
        out.push(`[[${text}]]`);
        break;
      case "subtext":
        out.push(`[[Subtext: ${text}]]`);
        break;
      case "act":
      case "heading":
        out.push(`# ${text}`);
        break;
      case "sequence":
        out.push(`## ${text}`);
        break;
      case "beat":
        out.push(`### ${text}`);
        break;
      case "centered":
        out.push(`> ${text} <`);
        break;
      case "lyrics":
        out.push(`~${text}`);
        break;
      case "pagebreak":
        out.push("===");
        break;
      default: {
        // an all-caps action line would be read back as a character
        out.push(isAllCaps(text) && text.length <= 40 ? `!${text}` : text);
      }
    }
    prev = b.type;
  }
}

// ---------------------------------------------------------------------------
// Plain text laid out in Courier columns, for pasting somewhere that has no idea
// what a screenplay is.
// ---------------------------------------------------------------------------
const wrap = (text, width) => {
  const words = text.split(/\s+/).filter(Boolean);
  const lines = [];
  let line = "";
  for (const w of words) {
    if (!line) line = w;
    else if ((line + " " + w).length <= width) line += " " + w;
    else {
      lines.push(line);
      line = w;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [""];
};

const COLUMNS = {
  scene: { indent: 0, width: 60, upper: true },
  action: { indent: 0, width: 60 },
  shot: { indent: 0, width: 60, upper: true },
  character: { indent: 22, width: 38, upper: true },
  parenthetical: { indent: 16, width: 25 },
  dialogue: { indent: 10, width: 35 },
  lyrics: { indent: 10, width: 35 },
  subtext: { indent: 10, width: 35 },
  note: { indent: 0, width: 60 },
  act: { center: true, upper: true },
  heading: { indent: 0, width: 60, upper: true },
  sequence: { indent: 0, width: 60, upper: true },
  beat: { indent: 0, width: 60 },
  centered: { center: true },
  transition: { right: true, upper: true },
};

export function toPlainText(script, { includeNotes = false, includeSubtext = false } = {}) {
  const out = [];
  let prev = null;
  for (const b of script.blocks || []) {
    if (b.type === "note" && !includeNotes) continue;
    if (b.type === "subtext" && !includeSubtext) continue;
    if (b.type === "pagebreak") {
      out.push("", "", "");
      prev = null;
      continue;
    }
    let text = plainText(b.html).trim();
    if (!text) continue;
    const col = COLUMNS[b.type] || COLUMNS.action;
    if (col.upper) text = text.toUpperCase();
    if (b.type === "parenthetical") text = `(${text.replace(/^\(|\)$/g, "")})`;
    if (b.type === "note") text = `[NOTE: ${text}]`;
    if (b.type === "subtext") text = `[${text}]`;

    const tight = ["dialogue", "parenthetical", "subtext", "lyrics"].includes(b.type) && ["character", "parenthetical", "dialogue", "subtext", "lyrics"].includes(prev);
    if (out.length && !tight) out.push("");
    if (b.type === "scene" && out.length) out.push("");

    if (col.center) for (const l of wrap(text, 60)) out.push(" ".repeat(Math.max(0, Math.floor((60 - l.length) / 2))) + l);
    else if (col.right) out.push(" ".repeat(Math.max(0, 60 - text.length)) + text);
    else for (const l of wrap(text, col.width)) out.push(" ".repeat(col.indent) + l);
    prev = b.type;
  }
  const head = [script.title?.toUpperCase() || "UNTITLED SCRIPT"];
  if (script.author) head.push(`Written by ${script.author}`);
  return head.join("\n") + "\n\n" + out.join("\n") + "\n";
}

export const fileNameFor = (script, ext) =>
  `${(script.title || "Untitled Script").replace(/[\\/:*?"<>|]+/g, "").trim() || "Script"}.${ext}`;
