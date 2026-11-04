// Everything that comes back from the share server was written by somebody else, and
// this app can write files. Nothing from there reaches the page without passing
// through here: formatting tags only, no attributes but a checked colour, and images
// only as inline PNG, JPEG or WebP.

const KEEP = new Set(["B", "STRONG", "I", "EM", "U", "S", "STRIKE", "BR", "SPAN"]);
// these lose their contents as well, not just the tag
const DROP = new Set(["SCRIPT", "STYLE", "IFRAME", "OBJECT", "EMBED", "SVG", "MATH", "TEMPLATE", "NOSCRIPT", "LINK", "META", "TITLE", "TEXTAREA", "SELECT", "XMP", "NOEMBED", "NOFRAMES"]);

export const safeColor = (value) => {
  const v = String(value ?? "").trim();
  return /^#[0-9a-f]{3,8}$/i.test(v) || /^rgba?\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+\s*(,\s*[\d.]+\s*)?\)$/i.test(v) ? v : null;
};

export const safeImage = (value) => {
  const v = typeof value === "string" ? value : "";
  return /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(v) ? v : null;
};

const cleanStyle = (el) => {
  const s = el.style;
  const out = [];
  const color = safeColor(s.color);
  if (color) out.push(`color: ${color}`);
  if (/^(bold|[6-9]00)$/.test(s.fontWeight)) out.push("font-weight: bold");
  if (s.fontStyle === "italic") out.push("font-style: italic");
  const line = s.textDecorationLine || s.textDecoration || "";
  const marks = ["underline", "line-through"].filter((m) => line.includes(m));
  if (marks.length) out.push(`text-decoration-line: ${marks.join(" ")}`);
  return out.join("; ");
};

const clean = (parent) => {
  for (const node of [...parent.childNodes]) {
    if (node.nodeType === 3) continue;
    if (node.nodeType !== 1 || DROP.has(node.tagName)) {
      node.remove();
      continue;
    }
    clean(node);
    if (!KEEP.has(node.tagName)) {
      node.replaceWith(...node.childNodes);
      continue;
    }
    const style = node.tagName === "SPAN" ? cleanStyle(node) : "";
    for (const attr of [...node.attributes]) node.removeAttribute(attr.name);
    if (style) node.setAttribute("style", style);
  }
};

// DOMParser's document is inert: nothing in it runs or loads while it's being cleaned.
export function sanitizeHtml(html) {
  const doc = new DOMParser().parseFromString(`<!doctype html><body>${String(html ?? "")}`, "text/html");
  clean(doc.body);
  return doc.body.innerHTML;
}
