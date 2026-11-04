import { TYPES, TYPE_BY_KEY, NEXT, TAB_ORDER, typeForHotkey, starterBlocks, emptyBlock, plainText } from "./script";
import { parseFountain, toFountain, marksToHtml, htmlToMarks } from "./fountain";

// The editor writes two kinds of thing. A profile says which elements it offers
// and how Enter, Tab, paste and copy behave with them.

// Screenplays: every element, Fountain on the clipboard, and the screenwriting
// habits (Enter on an empty line swaps Action and Character, "cut to:" becomes a
// transition, and so on).
export const SCRIPT_PROFILE = {
  kind: "script",
  types: TYPES,
  byKey: TYPE_BY_KEY,
  hotkey: typeForHotkey,
  next: NEXT,
  tabOrder: TAB_ORDER,
  base: "action",
  starter: starterBlocks,
  screenplay: true,
  parse: (text) => parseFountain(text).blocks,
  toText: (blocks) => toFountain({ blocks }, { titlePage: false, includeNotes: true, includeSubtext: true }),
};

// Scrambles: a plain document of text, three sizes of heading, notes, lists and checkboxes.
// Colours and bold, italic and underline work the same as in a script.
export const DOC_TYPES = [
  { key: "text", label: "Text", icon: "T", hotkey: "1", prefix: "", words: "text paragraph body plain" },
  { key: "heading", label: "Heading 1", icon: "H1", hotkey: "2", prefix: "#", words: "heading 1 h1 title" },
  { key: "sequence", label: "Heading 2", icon: "H2", hotkey: "3", prefix: "##", words: "heading 2 h2 section" },
  { key: "beat", label: "Heading 3", icon: "H3", hotkey: "4", prefix: "###", words: "heading 3 h3 subsection" },
  { key: "note", label: "Note", icon: "✎", hotkey: "5", prefix: "[[", words: "note comment reminder todo" },
  { key: "bullet", label: "Bullet", icon: "•", hotkey: "6", prefix: "-", words: "bullet list point item unordered" },
  { key: "number", label: "Number", icon: "1.", hotkey: "7", prefix: "1.", words: "number numbered list point item ordered" },
  { key: "todo", label: "Checkbox", icon: "☑", hotkey: "8", prefix: "[]", words: "checkbox todo task tick check list" },
].map((t) => ({ placeholder: "Enter text", ...t }));

// List lines nest with Tab, as far as this.
export const LIST_TYPES = new Set(["bullet", "number", "todo"]);
export const MAX_INDENT = 4;

const DOC_BY_KEY = Object.fromEntries(DOC_TYPES.map((t) => [t.key, t]));

const DOC_MARKS = [
  [/^###\s+/, "beat"],
  [/^##\s+/, "sequence"],
  [/^#\s+/, "heading"],
];

export const DOC_PROFILE = {
  kind: "doc",
  types: DOC_TYPES,
  byKey: DOC_BY_KEY,
  hotkey: (e) => {
    const m = /^Digit(\d)$/.exec(e.code || "");
    return m && !e.shiftKey ? DOC_TYPES.find((t) => t.hotkey === m[1])?.key || null : null;
  },
  next: { text: "text", heading: "text", sequence: "text", beat: "text", note: "text", bullet: "bullet", number: "number", todo: "todo" },
  tabOrder: ["text", "heading", "sequence", "beat"],
  base: "text",
  starter: () => [emptyBlock("text")],
  screenplay: false,
  // pasted lines become paragraphs, with markdown headings, lists and [[notes]] kept as such
  parse: (text) =>
    String(text)
      .replace(/\r\n?/g, "\n")
      .split("\n")
      .filter((line) => line.trim())
      .map((raw) => {
        const line = raw.trim();
        const indent = Math.min(MAX_INDENT, Math.floor(raw.replace(/\t/g, "  ").search(/\S/) / 2));
        const box = /^(?:[-*]\s+)?\[([ xX]?)\]\s+(.*)$/.exec(line);
        if (box) return { ...emptyBlock("todo", marksToHtml(box[2])), indent, checked: /x/i.test(box[1]) };
        const item = /^([-*•]|\d+[.)])\s+(.*)$/.exec(line);
        if (item) return { ...emptyBlock(/\d/.test(item[1]) ? "number" : "bullet", marksToHtml(item[2])), indent };
        const note = /^\[\[(.*)\]\]$/.exec(line);
        if (note) return emptyBlock("note", marksToHtml(note[1].trim()));
        const mark = DOC_MARKS.find(([re]) => re.test(line));
        return mark ? emptyBlock(mark[1], marksToHtml(line.replace(mark[0], ""))) : emptyBlock("text", marksToHtml(line));
      }),
  toText: (blocks) =>
    blocks
      .map((b) => {
        const text = htmlToMarks(b.html) || plainText(b.html).trim();
        const pad = "  ".repeat(b.indent || 0);
        if (b.type === "bullet") return `${pad}- ${text}`;
        if (b.type === "number") return `${pad}1. ${text}`;
        if (b.type === "todo") return `${pad}- [${b.checked ? "x" : " "}] ${text}`;
        if (b.type === "heading") return `# ${text}`;
        if (b.type === "sequence") return `## ${text}`;
        if (b.type === "beat") return `### ${text}`;
        if (b.type === "note") return `[[${text}]]`;
        return text;
      })
      .join("\n"),
};
