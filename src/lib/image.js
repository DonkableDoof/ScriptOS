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
