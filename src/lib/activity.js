// Writing history: one entry per local calendar day holding the net words and lines
// written in the editor that day. Imports and deleted scripts never touch it, so
// "written" means typed (or pasted) by you.

export const dayKey = (date = new Date()) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
};

const daysAgo = (n) => {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() - n);
  return d;
};

export const addActivity = (activity, words, lines) => {
  if (!words && !lines) return activity;
  const key = dayKey();
  const day = activity[key] || { words: 0, lines: 0 };
  return { ...activity, [key]: { words: day.words + words, lines: day.lines + lines } };
};

// A day where you cut more than you wrote counts as zero, not as negative progress.
const positive = (day) => ({ words: Math.max(0, day?.words || 0), lines: Math.max(0, day?.lines || 0) });

export const windowTotals = (activity, days) => {
  let words = 0;
  let lines = 0;
  for (let i = 0; i < days; i++) {
    const day = positive(activity[dayKey(daysAgo(i))]);
    words += day.words;
    lines += day.lines;
  }
  return { words, lines };
};

export const allTimeTotals = (activity) =>
  Object.values(activity).reduce(
    (acc, day) => {
      const p = positive(day);
      return { words: acc.words + p.words, lines: acc.lines + p.lines };
    },
    { words: 0, lines: 0 }
  );

export const series = (activity, days) =>
  Array.from({ length: days }, (_, i) => {
    const date = daysAgo(days - 1 - i);
    return { date, key: dayKey(date), ...positive(activity[dayKey(date)]) };
  });

// Consecutive days with any writing, ending today — or yesterday, so a streak is not
// "broken" at breakfast before you've had the chance to write.
export const streaks = (activity) => {
  const wrote = (n) => positive(activity[dayKey(daysAgo(n))]).words > 0;
  let current = 0;
  let start = wrote(0) ? 0 : 1;
  while (wrote(start + current)) current += 1;

  const keys = Object.keys(activity)
    .filter((k) => positive(activity[k]).words > 0)
    .sort();
  let best = 0;
  let run = 0;
  let last = null;
  for (const k of keys) {
    const t = new Date(`${k}T12:00:00`).getTime();
    run = last !== null && Math.round((t - last) / 86400000) === 1 ? run + 1 : 1;
    best = Math.max(best, run);
    last = t;
  }
  return { current, best: Math.max(best, current) };
};

export const bestDay = (activity) => {
  let best = null;
  for (const [key, day] of Object.entries(activity)) {
    if (!best || (day.words || 0) > best.words) best = { key, words: day.words || 0 };
  }
  return best && best.words > 0 ? best : null;
};
