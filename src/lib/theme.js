export const SCHEMES = {
  marquee: { label: "Marquee", dark: ["#e3b04b", "#d2564f"], light: ["#a87618", "#b5423c"] },
  noir: { label: "Noir", dark: ["#c9c2b4", "#8fa3b0"], light: ["#4d4a44", "#5b7285"] },
  neon: { label: "Neon", dark: ["#e07aa9", "#4fd1c5"], light: ["#c2528a", "#2c9c92"] },
  ocean: { label: "Ocean", dark: ["#4aa8d8", "#a98ae0"], light: ["#2b7fa8", "#7b5bc4"] },
  forest: { label: "Forest", dark: ["#4aba6a", "#e8913a"], light: ["#2d8a4e", "#d4782a"] },
};

const hueOf = (hex) => {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const n = parseInt(full, 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === min) return 35;
  const d = max - min;
  let hue;
  if (max === r) hue = ((g - b) / d) % 6;
  else if (max === g) hue = (b - r) / d + 2;
  else hue = (r - g) / d + 4;
  hue = Math.round(hue * 60);
  return hue < 0 ? hue + 360 : hue;
};

const hsl = (h, s, l) => `hsl(${h}, ${s}%, ${l}%)`;

// neutrals borrow the accent's hue so the whole surface picks up the scheme
const neutralsFor = (mode, hue) =>
  mode === "light"
    ? {
        bg: hsl(hue, 16, 95.5),
        bgCard: hsl(hue, 30, 99.5),
        bgCard2: hsl(hue, 16, 97),
        bgHover: hsl(hue, 15, 93),
        border: hsl(hue, 15, 86),
        borderLight: hsl(hue, 16, 91),
        text: hsl(hue, 26, 13),
        textMuted: hsl(hue, 12, 40),
        textDim: hsl(hue, 10, 58),
        red: "#b5423c",
        shadow: "0 1px 3px rgba(0,0,0,0.07)",
        paper: hsl(hue, 30, 99.5),
        paperInk: hsl(hue, 20, 12),
      }
    : {
        bg: hsl(hue, 10, 6),
        bgCard: hsl(hue, 9, 10.5),
        bgCard2: hsl(hue, 8, 14),
        bgHover: hsl(hue, 10, 17.5),
        border: hsl(hue, 11, 19.5),
        borderLight: hsl(hue, 9, 23.5),
        text: hsl(hue, 13, 92),
        textMuted: hsl(hue, 9, 58),
        textDim: hsl(hue, 9, 39),
        red: "#d2564f",
        shadow: "0 1px 3px rgba(0,0,0,0.3)",
        paper: hsl(hue, 9, 10.5),
        paperInk: hsl(hue, 13, 90),
      };

const rgba = (hex, alpha) => {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const n = parseInt(full, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
};

export const DEFAULT_SETTINGS = {
  mode: "dark",
  scheme: "marquee",
  custom: { accent: "#e3b04b", accent2: "#d2564f" },
  uiScale: 1,
  paper: false,
  editorSize: 16,
  sceneNumbers: true,
  autocomplete: true,
  typewriterScroll: false,
  typewriterSounds: false,
  typewriterBell: false,
  volume: 0.6,
  dailyGoal: 0,
  exportNotes: false,
  exportSubtext: false,
};

export const paletteOf = (settings) => {
  const mode = settings?.mode === "light" ? "light" : "dark";
  if (settings?.scheme === "custom") {
    return [settings.custom?.accent || "#e3b04b", settings.custom?.accent2 || "#d2564f"];
  }
  return (SCHEMES[settings?.scheme] || SCHEMES.marquee)[mode];
};

export function applyTheme(settings) {
  const root = document.documentElement;
  const mode = settings?.mode === "light" ? "light" : "dark";
  const [accent, accent2] = paletteOf(settings);
  const base = neutralsFor(mode, hueOf(accent));

  Object.entries(base).forEach(([k, v]) => root.style.setProperty(`--${k}`, v));
  root.style.setProperty("--accent", accent);
  root.style.setProperty("--accentLine", rgba(accent, mode === "dark" ? 0.42 : 0.34));
  root.style.setProperty("--accentSoft", rgba(accent, mode === "dark" ? 0.13 : 0.1));
  root.style.setProperty("--accent2", accent2);
  root.style.setProperty("--accent2Line", rgba(accent2, mode === "dark" ? 0.42 : 0.34));
  root.style.setProperty("--accent2Soft", rgba(accent2, mode === "dark" ? 0.13 : 0.1));

  // Paper mode puts the script on a white page whatever the app theme is, the way
  // it will look printed.
  if (settings?.paper) {
    root.style.setProperty("--paper", "#fdfbf6");
    root.style.setProperty("--paperInk", "#1b1712");
  }
  root.style.setProperty("--editorSize", `${settings?.editorSize || 16}px`);

  root.dataset.mode = mode;
  root.dataset.paper = settings?.paper ? "on" : "off";
  root.style.zoom = settings?.uiScale && settings.uiScale !== 1 ? settings.uiScale : "";
}
