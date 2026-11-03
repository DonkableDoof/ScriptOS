import { useMemo } from "react";
import { windowTotals, allTimeTotals, series, streaks, bestDay, dayKey } from "../lib/activity";
import { formatPages } from "../lib/script";

const n = (v) => Math.round(v).toLocaleString();

const WINDOWS = [
  { key: "today", label: "Today", days: 1 },
  { key: "week", label: "Past 7 Days", days: 7 },
  { key: "month", label: "Past 30 Days", days: 30 },
];

export function StatTiles({ activity }) {
  const tiles = useMemo(
    () => [
      ...WINDOWS.map((w) => ({ ...w, ...windowTotals(activity, w.days) })),
      { key: "all", label: "All Time", ...allTimeTotals(activity) },
    ],
    [activity]
  );

  return (
    <div className="stat-tiles">
      {tiles.map((t) => (
        <div key={t.key} className="stat-tile" data-key={t.key}>
          <span className="stat-label">{t.label}</span>
          <span className="stat-big">{n(t.words)}</span>
          <span className="stat-unit">words</span>
          <span className="stat-sub">
            <b>{n(t.lines)}</b> {t.lines === 1 ? "line" : "lines"}
          </span>
        </div>
      ))}
    </div>
  );
}

export function GoalPanel({ activity, goal }) {
  const today = Math.max(0, activity[dayKey()]?.words || 0);
  const pct = goal > 0 ? Math.min(100, (today / goal) * 100) : 0;
  const { current, best } = useMemo(() => streaks(activity), [activity]);
  const days = useMemo(() => series(activity, 30), [activity]);
  const max = Math.max(goal || 0, ...days.map((d) => d.words), 1);
  const top = useMemo(() => bestDay(activity), [activity]);

  return (
    <div className="panel">
      <div className="panel-head">
        <span className="panel-title">Daily Goal</span>
        <span className="panel-hint">{goal ? `${n(goal)} words` : "off"}</span>
      </div>
      <div className="goal">
        <div className="goal-ring" style={{ "--pct": pct }} data-full={pct >= 100}>
          <span>{goal ? `${Math.round(pct)}%` : "—"}</span>
        </div>
        <div className="goal-text">
          <span className="goal-big">{n(today)}</span>
          <span className="goal-sub">{pct >= 100 ? "Goal reached" : goal ? `${n(Math.max(0, goal - today))} to go today` : "written today"}</span>
        </div>
      </div>
      <div className="streak-row">
        <div className="streak">
          <span className="streak-flame" data-on={current > 0}>🔥</span>
          <span>
            <b>{current}</b> day streak
          </span>
        </div>
        <div className="streak streak-best">
          Best <b>{best}</b>
        </div>
      </div>
      <div className="chart" title="Words per day, last 30 days">
        {days.map((d) => (
          <div
            key={d.key}
            className="chart-bar"
            data-today={d.key === dayKey()}
            data-hit={goal > 0 && d.words >= goal}
            style={{ height: `${Math.max(d.words ? 6 : 2, (d.words / max) * 100)}%` }}
            title={`${d.date.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })}: ${n(d.words)} words`}
          />
        ))}
        {goal > 0 && <div className="chart-goal" style={{ bottom: `${(goal / max) * 100}%` }} />}
      </div>
      <div className="chart-foot">
        <span>30 days ago</span>
        <span>{top ? `Best day: ${n(top.words)} words` : "Today"}</span>
      </div>
    </div>
  );
}

// A handful of numbers that are more fun than useful.
export function FunFacts({ scripts, statsById, activity }) {
  const facts = useMemo(() => {
    let pages = 0;
    let scenes = 0;
    let dialogue = 0;
    let words = 0;
    const cast = {};
    let longest = null;
    for (const s of scripts) {
      const st = statsById[s.id];
      if (!st) continue;
      pages += st.pages;
      scenes += st.scenes.length;
      dialogue += st.dialogueLines;
      words += st.words;
      for (const c of st.characters) cast[c.name] = (cast[c.name] || 0) + c.lines;
      if (!longest || st.pages > longest.pages) longest = { title: s.title, pages: st.pages };
    }
    const chatty = Object.entries(cast).sort((a, b) => b[1] - a[1])[0];
    const out = [
      { icon: "🎬", value: n(scenes), label: scenes === 1 ? "scene written" : "scenes written" },
      { icon: "💬", value: n(dialogue), label: "lines of dialogue" },
      { icon: "⏱️", value: pages >= 60 ? `${(pages / 60).toFixed(1)}h` : pages > 0 && pages < 1 ? "<1m" : `${Math.round(pages)}m`, label: "of screen time, roughly" },
      { icon: "📚", value: n(Object.keys(cast).length), label: "characters created" },
    ];
    if (chatty) out.push({ icon: "🗣️", value: chatty[0], label: `talks the most · ${n(chatty[1])} lines` });
    if (longest && longest.pages > 0) out.push({ icon: "📜", value: longest.title, label: `is your longest · ${formatPages(longest.pages)}` });
    if (words) out.push({ icon: "⌨️", value: n(words * 5.5), label: "keystrokes" });
    return out;
  }, [scripts, statsById, activity]);

  return (
    <div className="panel">
      <div className="panel-head">
        <span className="panel-title">Fun Stats</span>
      </div>
      <div className="facts">
        {facts.map((f) => (
          <div key={f.label} className="fact">
            <span className="fact-icon">{f.icon}</span>
            <span className="fact-text">
              <b>{f.value}</b> {f.label}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
