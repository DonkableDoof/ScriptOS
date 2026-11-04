// Covers are stored at the shape of an A4 sheet (1 : √2), 720×1018, whatever shape
// the picture came in.
export const COVER_W = 720;
export const COVER_H = 1018;
const SOURCE_MAX = 2400;

// Reads a picked file into an Image, scaled down first if it is huge so cropping
// stays smooth.
export function loadImageFile(file) {
  return new Promise((resolve, reject) => {
    if (!file || !file.type.startsWith("image/")) {
      reject(new Error("That file is not an image."));
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read that image."));
    reader.onload = () => loadImage(reader.result).then(resolve, reject);
    reader.readAsDataURL(file);
  });
}

export function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onerror = () => reject(new Error("Could not decode that image."));
    img.onload = () => {
      const scale = Math.min(1, SOURCE_MAX / Math.max(img.width, img.height));
      if (scale === 1) return resolve(img);
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
      const small = new Image();
      small.onload = () => resolve(small);
      small.onerror = () => reject(new Error("Could not decode that image."));
      small.src = canvas.toDataURL("image/jpeg", 0.92);
    };
    img.src = src;
  });
}

// The crop is described in frame terms: at zoom 1 the image just covers the A4
// frame, and x/y are the pan offsets as fractions of the slack on each axis
// (-0.5 … 0.5, 0 = centred).
export const coverGeometry = (img, frameW, frameH, zoom) => {
  const base = Math.max(frameW / img.width, frameH / img.height);
  const scale = base * zoom;
  const w = img.width * scale;
  const h = img.height * scale;
  return { w, h, slackX: w - frameW, slackY: h - frameH };
};

// A character's icon: a small square from the middle of the picture, kept as PNG so
// transparency survives. The size kept on this device is sharper than what goes online.
const ICON_SIZE = 96;
export const ONLINE_ICON_SIZE = 32;
export function renderIcon(img, size = ICON_SIZE) {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  const { w, h, slackX, slackY } = coverGeometry(img, size, size, 1);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, -slackX / 2, -slackY / 2, w, h);
  return canvas.toDataURL("image/png");
}

// Everything going to the server stays at icon size. An icon is only decoded once, however
// many times the script it belongs to is sent. One that can't be read is left as it is.
const shrunk = new Map();
export async function shrinkIcon(src) {
  if (typeof src !== "string" || !src.startsWith("data:image/")) return src;
  if (shrunk.has(src)) return shrunk.get(src);
  let out = src;
  try {
    const img = await loadImage(src);
    if (img.width > ONLINE_ICON_SIZE || img.height > ONLINE_ICON_SIZE) out = renderIcon(img, ONLINE_ICON_SIZE);
  } catch {
    /* keep it */
  }
  shrunk.set(src, out);
  return out;
}

export async function shrinkCast(cast) {
  const out = {};
  for (const [name, c] of Object.entries(cast || {})) out[name] = c?.icon ? { ...c, icon: await shrinkIcon(c.icon) } : c;
  return out;
}

// A whole script on its way to your account: its characters' icons, and the pictures of the
// people who commented on it, which are kept beside the comments.
export async function shrinkItemIcons(item) {
  if (!item.cast && !item.reviewers) return item;
  const out = { ...item };
  if (item.cast) out.cast = await shrinkCast(item.cast);
  if (item.reviewers) {
    out.reviewers = {};
    for (const [id, p] of Object.entries(item.reviewers)) out.reviewers[id] = p?.avatar ? { ...p, avatar: await shrinkIcon(p.avatar) } : p;
  }
  return out;
}

export function renderCover(img, { zoom = 1, x = 0, y = 0 }) {
  const canvas = document.createElement("canvas");
  canvas.width = COVER_W;
  canvas.height = COVER_H;
  const ctx = canvas.getContext("2d");
  const { w, h, slackX, slackY } = coverGeometry(img, COVER_W, COVER_H, zoom);
  const left = -slackX / 2 - x * slackX;
  const top = -slackY / 2 - y * slackY;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, left, top, w, h);
  return canvas.toDataURL("image/jpeg", 0.86);
}
