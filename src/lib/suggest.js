// Suggested edits on a shared script. The person reading edits an ordinary copy of the
// script; what they changed is worked out by comparing it with the writer's version, line
// by line, so every keystroke doesn't need its own record.

const ENTITIES = { "&nbsp;": " ", "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'" };
export const htmlText = (html) =>
  String(html || "")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&(nbsp|amp|lt|gt|quot|#39);/g, (m) => ENTITIES[m] || m);

// What differs between the writer's lines and someone's copy of them. New lines with
// nothing typed yet aren't worth telling anyone about.
export function computeChanges(base, blocks) {
  const baseById = new Map(base.map((b) => [b.id, b]));
  const seen = new Set();
  const out = [];
  let prev = "";
  for (const b of blocks) {
    const was = baseById.get(b.id);
    if (was) {
      seen.add(b.id);
      if (was.html !== b.html || was.type !== b.type) {
        out.push({ line: b.id, op: "edit", after_line: "", line_type: b.type, html: b.html, base_html: was.html });
      }
    } else if (htmlText(b.html).trim()) {
      out.push({ line: b.id, op: "insert", after_line: prev, line_type: b.type, html: b.html, base_html: "" });
    } else {
      continue; // nobody else knows about this line, so nothing can be placed after it
    }
    prev = b.id;
  }
  for (const b of base) {
    if (!seen.has(b.id)) out.push({ line: b.id, op: "delete", after_line: "", line_type: b.type, html: "", base_html: b.html });
  }
  return out;
}

// Where a new line goes, when the line it follows may itself be a new one not in `ids`.
const anchorOf = (afterLine, ids, inserts) => {
  let at = afterLine || "";
  for (let i = 0; at && !ids.has(at) && i < 200; i++) at = inserts.find((c) => c.line === at)?.after_line || "";
  return at;
};

// The writer's lines with one person's changes laid over them: what that person sees.
export function overlayChanges(base, changes, blockFor = (c) => ({ id: c.line, type: c.line_type || "action", html: c.html })) {
  const edits = new Map(changes.filter((c) => c.op === "edit").map((c) => [c.line, c]));
  const gone = new Set(changes.filter((c) => c.op === "delete").map((c) => c.line));
  const inserts = changes.filter((c) => c.op === "insert");
  const list = [];
  for (const b of base) {
    if (gone.has(b.id)) continue;
    const e = edits.get(b.id);
    list.push(e ? { ...b, html: e.html, type: e.line_type || b.type } : b);
  }
  // in the order they were written, each going straight after the line it follows
  for (const c of inserts) {
    const after = c.after_line;
    const at = after ? list.findIndex((b) => b.id === after) : -1;
    const fallback = at >= 0 ? at : list.findIndex((b) => b.id === anchorOf(after, new Set(list.map((x) => x.id)), inserts));
    list.splice(fallback + 1, 0, blockFor(c));
  }
  return list;
}

// Which line on screen each change belongs to, keyed by line id. A line that isn't on the
// screen (a removed line, or someone's new one) goes with the nearest line before it, or
// the first line if there's nothing before it.
export function placeChanges(visible, base, changes) {
  const ids = new Set(visible.map((b) => b.id));
  const order = base.map((b) => b.id);
  const inserts = changes.filter((c) => c.op === "insert");
  const nearest = (line) => {
    for (let i = order.indexOf(line) - 1; i >= 0; i--) if (ids.has(order[i])) return order[i];
    return "";
  };
  const placed = {};
  for (const c of changes) {
    let at;
    if (ids.has(c.line)) at = c.line;
    else if (c.op === "insert") at = anchorOf(c.after_line, ids, inserts);
    else at = nearest(c.line);
    if (!at) at = visible[0]?.id;
    if (at) (placed[at] ||= []).push(c);
  }
  return placed;
}

// Whether a change has nothing left to do: the writer's lines already say this.
export function changeIsDone(c, blocks) {
  const line = blocks.find((b) => b.id === c.line);
  if (c.op === "insert") return Boolean(line);
  if (c.op === "delete") return !line;
  return Boolean(line) && line.html === c.html && (!c.line_type || line.type === c.line_type);
}

// Accepting one change into the writer's own lines. `clean` makes the other person's
// html safe, and an element type this script doesn't have is left as it was.
export function applyChange(blocks, c, { clean = (h) => h, validType = () => true, inserts = [] } = {}) {
  const at = blocks.findIndex((b) => b.id === c.line);
  if (c.op === "delete") return at >= 0 ? blocks.filter((b) => b.id !== c.line) : blocks;
  if (c.op === "edit") {
    if (at < 0) return blocks;
    return blocks.map((b) => (b.id === c.line ? { ...b, html: clean(c.html), type: validType(c.line_type) ? c.line_type : b.type } : b));
  }
  if (at >= 0) return blocks;
  const anchor = anchorOf(c.after_line, new Set(blocks.map((b) => b.id)), inserts);
  const after = anchor ? blocks.findIndex((b) => b.id === anchor) : -1;
  const line = { id: c.line, type: validType(c.line_type) ? c.line_type : "action", html: clean(c.html) };
  return [...blocks.slice(0, after + 1), line, ...blocks.slice(after + 1)];
}

// Word-by-word differences, for showing exactly what changed in a line:
// [{ t: "same" | "del" | "add", text }]. Longest-common-subsequence, trimmed at both ends
// so ordinary lines stay fast; a huge rewrite just shows as replaced.
const tokens = (s) => String(s).match(/\s+|[^\s]+/g) || [];
export function wordDiff(before, after) {
  const a = tokens(before);
  const b = tokens(after);
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const parts = [];
  const push = (t, text) => {
    if (!text) return;
    const last = parts[parts.length - 1];
    if (last?.t === t) last.text += text;
    else parts.push({ t, text });
  };
  push("same", a.slice(0, start).join(""));
  const midA = a.slice(start, endA);
  const midB = b.slice(start, endB);
  if (midA.length * midB.length > 250000) {
    push("del", midA.join(""));
    push("add", midB.join(""));
  } else {
    const dp = Array.from({ length: midA.length + 1 }, () => new Uint32Array(midB.length + 1));
    for (let i = midA.length - 1; i >= 0; i--) {
      for (let j = midB.length - 1; j >= 0; j--) {
        dp[i][j] = midA[i] === midB[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
    let i = 0;
    let j = 0;
    while (i < midA.length || j < midB.length) {
      if (i < midA.length && j < midB.length && midA[i] === midB[j]) {
        push("same", midA[i]);
        i++;
        j++;
      } else if (i < midA.length && (j === midB.length || dp[i + 1][j] >= dp[i][j + 1])) {
        push("del", midA[i]);
        i++;
      } else {
        push("add", midB[j]);
        j++;
      }
    }
  }
  push("same", a.slice(endA).join(""));
  return parts;
}
