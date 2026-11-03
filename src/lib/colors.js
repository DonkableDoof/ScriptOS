// The text colours, same set as ContentOS. Alt+1…9 picks one; 1 puts the default back.
export const COLORS = [
  { key: "1", name: "Default", hex: null },
  { key: "2", name: "Gray", hex: "#8a9b8e" },
  { key: "3", name: "Green", hex: "#4aba6a" },
  { key: "4", name: "Orange", hex: "#e8913a" },
  { key: "5", name: "Red", hex: "#d2564f" },
  { key: "6", name: "Yellow", hex: "#e3c65a" },
  { key: "7", name: "Blue", hex: "#5aa9e6" },
  { key: "8", name: "Purple", hex: "#a98ae0" },
  { key: "9", name: "Pink", hex: "#e07aa9" },
];

// Alt+digit, read from e.code so it works on every keyboard layout.
export const colorForKey = (e) => {
  const m = /^Digit([1-9])$/.exec(e.code || "");
  return m ? COLORS.find((c) => c.key === m[1]) : null;
};

// The palette a new character gets, so a cast reads apart at a glance.
export const nextCastColor = (used = []) => {
  const pool = COLORS.filter((c) => c.hex && c.name !== "Gray").map((c) => c.hex);
  return pool.find((c) => !used.includes(c)) || pool[used.length % pool.length];
};

// The built-in colours followed by the ones you've made, in one list.
export const paletteOf = (customs = []) => [
  ...COLORS,
  ...customs.filter((c) => c?.hex).map((c) => ({ key: c.id, name: c.name || "Custom", hex: c.hex, custom: true })),
];

// A fresh suggestion for the next colour you make: a random hue at the same
// strength as the built-in ones.
export const randomColor = () => {
  const h = Math.floor(Math.random() * 360) / 360;
  const s = 0.62;
  const l = 0.6;
  const f = (n) => {
    const k = (n + h * 12) % 12;
    const a = s * Math.min(l, 1 - l);
    const v = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(v * 255).toString(16).padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
};
