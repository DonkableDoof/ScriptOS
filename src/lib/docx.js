import { emptyBlock, escapeHtml } from "./script";
import { ACT_TEXT } from "./fountain";

// ---------------------------------------------------------------------------
// Word and Google Docs import. A .docx is a zip of XML files; the browser can
// inflate zip entries itself (DecompressionStream), so no library is needed.
// ---------------------------------------------------------------------------

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

async function inflate(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// Reads the zip's central directory and returns a function that extracts one file by name.
function openZip(buffer) {
  const view = new DataView(buffer);
  let end = -1;
  for (let i = buffer.byteLength - 22; i >= Math.max(0, buffer.byteLength - 66000); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new Error("That file isn't a Word document (.docx).");
  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  const entries = {};
  const decoder = new TextDecoder();
  for (let n = 0; n < count; n++) {
    if (view.getUint32(at, true) !== 0x02014b50) break;
    const method = view.getUint16(at + 10, true);
    const size = view.getUint32(at + 20, true);
    const nameLen = view.getUint16(at + 28, true);
    const extraLen = view.getUint16(at + 30, true);
    const commentLen = view.getUint16(at + 32, true);
    const local = view.getUint32(at + 42, true);
    const name = decoder.decode(new Uint8Array(buffer, at + 46, nameLen));
    entries[name] = { method, size, local };
    at += 46 + nameLen + extraLen + commentLen;
  }
  return async (name) => {
    const e = entries[name];
    if (!e) return null;
    const start = e.local + 30 + view.getUint16(e.local + 26, true) + view.getUint16(e.local + 28, true);
    const raw = new Uint8Array(buffer, start, e.size);
    const data = e.method === 8 ? await inflate(raw) : raw;
    return decoder.decode(data);
  };
}

const child = (el, name) => {
  if (!el) return null;
  for (const c of el.children) if (c.localName === name && c.namespaceURI === W) return c;
  return null;
};
const attr = (el, name) => el?.getAttributeNS(W, name) ?? el?.getAttribute(`w:${name}`) ?? null;
const on = (el) => Boolean(el) && !["0", "false", "none"].includes(attr(el, "val"));

// Style id → what matters for telling screenplay elements apart, with basedOn resolved.
function readStyles(xml) {
  const styles = {};
  if (!xml) return styles;
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const raw = {};
  for (const s of doc.getElementsByTagNameNS(W, "style")) {
    const id = attr(s, "styleId");
    const pPr = child(s, "pPr");
    const rPr = child(s, "rPr");
    const ind = child(pPr, "ind");
    raw[id] = {
      name: attr(child(s, "name"), "val") || id,
      basedOn: attr(child(s, "basedOn"), "val"),
      indent: ind ? Number(attr(ind, "left") ?? attr(ind, "start") ?? NaN) : NaN,
      jc: attr(child(pPr, "jc"), "val"),
      caps: child(rPr, "caps") ? on(child(rPr, "caps")) : null,
    };
  }
  const resolve = (id, depth = 0) => {
    const s = raw[id];
    if (!s || depth > 10) return { name: "", indent: NaN, jc: null, caps: null };
    if (!s.basedOn) return s;
    const base = resolve(s.basedOn, depth + 1);
    return {
      name: s.name,
      indent: Number.isNaN(s.indent) ? base.indent : s.indent,
      jc: s.jc ?? base.jc,
      caps: s.caps ?? base.caps,
    };
  };
  for (const id of Object.keys(raw)) styles[id] = resolve(id);
  return styles;
}

// Every paragraph of the body as { text, html, indent (inches), jc, style, pageBreak }.
function readParagraphs(xml, styles) {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const body = doc.getElementsByTagNameNS(W, "body")[0];
  if (!body) throw new Error("There was no text in that document.");
  const out = [];
  for (const p of body.getElementsByTagNameNS(W, "p")) {
    const pPr = child(p, "pPr");
    const style = styles[attr(child(pPr, "pStyle"), "val")] || { name: "", indent: NaN, jc: null, caps: null };
    const ind = child(pPr, "ind");
    const own = ind ? Number(attr(ind, "left") ?? attr(ind, "start") ?? NaN) : NaN;
    const twips = Number.isNaN(own) ? style.indent : own;
    let pageBreak = on(child(pPr, "pageBreakBefore"));
    let text = "";
    let html = "";
    for (const r of p.getElementsByTagNameNS(W, "r")) {
      const rPr = child(r, "rPr");
      const caps = child(rPr, "caps") ? on(child(rPr, "caps")) : style.caps;
      let piece = "";
      for (const c of r.children) {
        if (c.localName === "t") piece += c.textContent;
        else if (c.localName === "tab") piece += " ";
        else if (c.localName === "br") {
          if (attr(c, "type") === "page") pageBreak = true;
          else piece += "\n";
        }
      }
      if (!piece) continue;
      if (caps) piece = piece.toUpperCase();
      text += piece;
      let h = escapeHtml(piece).replace(/\n/g, "<br>");
      if (on(child(rPr, "u"))) h = `<u>${h}</u>`;
      if (on(child(rPr, "i"))) h = `<i>${h}</i>`;
      if (on(child(rPr, "b"))) h = `<b>${h}</b>`;
      html += h;
    }
    out.push({
      text: text.replace(/\s+$/, ""),
      html: html.replace(/(<br>|\s)+$/, ""),
      indent: Number.isNaN(twips) ? null : twips / 1440,
      jc: attr(child(pPr, "jc"), "val") || style.jc,
      style: style.name || "",
      pageBreak,
    });
  }
  return out;
}

const BY_STYLE = [
  [/scene|slug/i, "scene"],
  [/parenth/i, "parenthetical"],
  [/character/i, "character"],
  [/dialog/i, "dialogue"],
  [/transition/i, "transition"],
  [/shot/i, "shot"],
  [/lyric/i, "lyrics"],
  [/action|description/i, "action"],
  [/\bact\b/i, "act"],
  [/^heading ?1$/i, "heading"],
  [/^heading ?2$/i, "sequence"],
  [/^heading ?3$/i, "beat"],
];

const SCENE = /^(INT|EXT|EST|INT\.?\/EXT|I\/E)[.\s]/i;
const TRANSITION = /^([A-Z][A-Z .'-]* TO:|FADE (IN|OUT)[.:]?|FADE TO BLACK\.?|CUT TO BLACK\.?)$/;
const caps = (s) => /\p{L}/u.test(s) && s === s.toUpperCase();

// Paragraphs → screenplay blocks. Named styles (Final Draft, Celtx and most
// templates export them) win; otherwise the shape of the text and its indent decide.
export function classifyParagraphs(paras) {
  // the indent action lines sit at: the most common one among long paragraphs
  const tally = {};
  for (const p of paras) if (p.indent != null && p.text.length > 60) tally[p.indent.toFixed(2)] = (tally[p.indent.toFixed(2)] || 0) + 1;
  const common = Object.entries(tally).sort((a, b) => b[1] - a[1])[0];
  const base = common ? Number(common[0]) : 0;
  const hasIndents = paras.some((p) => p.indent != null && p.indent - base > 0.5);

  const blocks = [];
  let speaking = false;
  const push = (type, p) => blocks.push(emptyBlock(type, type === "parenthetical" ? p.html.replace(/^\s*\(/, "").replace(/\)\s*$/, "") : p.html));

  paras.forEach((p, i) => {
    if (p.pageBreak && blocks.length) blocks.push(emptyBlock("pagebreak"));
    const t = p.text.trim();
    if (!t) {
      if (!hasIndents) speaking = false;
      return;
    }
    const rel = p.indent == null ? 0 : p.indent - base;
    const byStyle = BY_STYLE.find(([re]) => re.test(p.style));
    if (byStyle) {
      push(byStyle[1], p);
      speaking = ["character", "parenthetical", "dialogue"].includes(byStyle[1]);
      return;
    }
    let next = null;
    for (let j = i + 1; j < paras.length; j++) {
      if (paras[j].text.trim()) {
        next = paras[j];
        break;
      }
    }

    let type = "action";
    if (SCENE.test(t)) type = "scene";
    else if (caps(t) && ACT_TEXT.test(t)) type = "act";
    else if (TRANSITION.test(t) || (p.jc === "right" && caps(t))) type = "transition";
    else if (/^\(.*\)$/.test(t) && speaking) type = "parenthetical";
    else if (
      caps(t) &&
      t.length <= 40 &&
      !/[.!?,:;]$/.test(t.replace(/\s*\(.*\)$/, "")) &&
      next &&
      !caps(next.text.trim()) &&
      (!hasIndents || rel >= 1.2)
    )
      type = "character";
    else if (p.jc === "center") type = "centered";
    else if (speaking && (!hasIndents || (rel > 0.4 && rel < 2.5))) type = "dialogue";

    push(type, p);
    speaking = ["character", "parenthetical", "dialogue"].includes(type);
  });
  return blocks;
}

// A cover page, when the document opens with one: everything before the first
// page break, as long as no scene has started yet.
function splitTitlePage(paras) {
  const brk = paras.findIndex((p, i) => i > 0 && p.pageBreak);
  if (brk < 0 || brk > 25) return { meta: {}, body: paras };
  const front = paras.slice(0, brk).filter((p) => p.text.trim());
  if (!front.length || front.some((p) => SCENE.test(p.text.trim()))) return { meta: {}, body: paras };
  const meta = { title: front[0].text.trim() };
  const by = front.findIndex((p) => /^(written )?by\b/i.test(p.text.trim()));
  if (by >= 0) {
    const inline = front[by].text.trim().replace(/^(written )?by\s*/i, "");
    meta.author = inline || front[by + 1]?.text.trim() || "";
  }
  return { meta, body: paras.slice(brk).map((p, i) => (i === 0 ? { ...p, pageBreak: false } : p)) };
}

export async function parseDocx(buffer) {
  let read;
  try {
    read = openZip(buffer);
  } catch {
    throw new Error("That file isn't a Word document (.docx). Old .doc files need saving as .docx first.");
  }
  const xml = await read("word/document.xml");
  if (!xml) throw new Error("That file isn't a Word document (.docx).");
  const styles = readStyles(await read("word/styles.xml"));
  const { meta, body } = splitTitlePage(readParagraphs(xml, styles));

  const core = await read("docProps/core.xml");
  if (core && !meta.title) {
    const m = /<dc:title>([^<]*)<\/dc:title>/.exec(core);
    if (m && m[1].trim()) meta.title = m[1].trim();
  }
  const blocks = classifyParagraphs(body);
  if (!blocks.some((b) => b.type !== "pagebreak")) throw new Error("There was no script in that document.");
  return { blocks, meta };
}

// The document id out of any Google Docs link (edit, view, share or a bare id).
export const googleDocId = (link) => {
  const s = String(link || "").trim();
  const m = /\/document\/(?:u\/\d+\/)?d\/([A-Za-z0-9_-]{20,})/.exec(s);
  if (m) return m[1];
  return /^[A-Za-z0-9_-]{25,}$/.test(s) ? s : null;
};
