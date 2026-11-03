import { useEffect, useState } from "react";
import Confirm from "../components/Confirm";
import { useStore } from "../lib/store";
import { SCHEMES, paletteOf } from "../lib/theme";
import { exportBackup, readBackup, restoreBackup, storageUsage, formatBytes } from "../lib/backup";
import { pickTextFile } from "../lib/native";
import { notify } from "../lib/notice";
import { TYPES } from "../lib/script";
import { sfx } from "../lib/sound";

function Toggle({ on, onChange }) {
  return <button className="switch" data-on={Boolean(on)} role="switch" aria-checked={Boolean(on)} onClick={() => onChange(!on)} />;
}

function Setting({ title, hint, children }) {
  return (
    <div className="setting">
      <div className="setting-text">
        <span className="setting-title">{title}</span>
        {hint && <span className="setting-hint">{hint}</span>}
      </div>
      <div className="setting-control">{children}</div>
    </div>
  );
}

function Segmented({ value, options, onChange }) {
  return (
    <div className="segmented">
      {options.map((o) => (
        <button key={String(o.value)} type="button" data-on={value === o.value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

const SHORTCUTS = [
  ["Enter", "Next element (Scene → Action, Character → Dialogue, Dialogue → Character…)"],
  ["Enter on an empty line", "Swap Action ⇄ Character"],
  ["Tab / Shift+Tab", "Cycle the element type"],
  ["/", "Element menu"],
  ["Shift+Enter", "Line break inside an element"],
  ["Ctrl+B / I / U", "Bold, italic, underline"],
  ["Ctrl+Z / Ctrl+Y", "Undo / redo"],
  ["Ctrl+A twice", "Select every element (then Delete, Ctrl+C, Ctrl+X)"],
  ["Shift+click handles", "Select a range of elements"],
];

export default function SettingsPage({ navigate }) {
  const { settings, updateSettings, scripts } = useStore();
  const [usage, setUsage] = useState(null);
  const [restore, setRestore] = useState(null);
  const set = (changes) => updateSettings(changes);

  useEffect(() => {
    storageUsage().then(setUsage, () => setUsage(null));
  }, [scripts]);

  const pickBackup = async () => {
    try {
      const file = await pickTextFile(".json,application/json");
      if (!file) return;
      setRestore(readBackup(file.text));
    } catch (err) {
      notify("Could not read backup", { detail: err.message, tone: "bad" });
    }
  };

  return (
    <div className="app">
      <header className="topbar">
        <div className="script-head">
          <button className="btn btn-ghost btn-back" onClick={() => navigate({ page: "back" })}>
            ← Back
          </button>
          <div className="brand-text">
            <div className="brand-name">Settings</div>
            <div className="brand-sub">ScriptOS v{__APP_VERSION__}</div>
          </div>
        </div>
      </header>

      <div className="settings">
        <section className="settings-group">
          <h2 className="settings-group-title">Appearance</h2>
          <Setting title="Mode">
            <Segmented
              value={settings.mode}
              options={[
                { value: "dark", label: "Dark" },
                { value: "light", label: "Light" },
              ]}
              onChange={(mode) => set({ mode })}
            />
          </Setting>
          <Setting title="Colour scheme" hint="Picks up across the whole app.">
            <div className="schemes">
              {Object.entries(SCHEMES).map(([key, s]) => {
                const [a, b] = s[settings.mode === "light" ? "light" : "dark"];
                return (
                  <button key={key} className="scheme" data-on={settings.scheme === key} onClick={() => set({ scheme: key })}>
                    <span className="scheme-dots">
                      <i style={{ background: a }} />
                      <i style={{ background: b }} />
                    </span>
                    {s.label}
                  </button>
                );
              })}
              <button className="scheme" data-on={settings.scheme === "custom"} onClick={() => set({ scheme: "custom" })}>
                <span className="scheme-dots">
                  <i style={{ background: settings.custom.accent }} />
                  <i style={{ background: settings.custom.accent2 }} />
                </span>
                Custom
              </button>
            </div>
          </Setting>
          {settings.scheme === "custom" && (
            <Setting title="Custom colours">
              <div className="color-pair">
                <input type="color" value={paletteOf(settings)[0]} onChange={(e) => set({ custom: { ...settings.custom, accent: e.target.value } })} />
                <input type="color" value={paletteOf(settings)[1]} onChange={(e) => set({ custom: { ...settings.custom, accent2: e.target.value } })} />
              </div>
            </Setting>
          )}
          <Setting title="Paper pages" hint="Write on a white page, the way it will print, whatever the app theme.">
            <Toggle on={settings.paper} onChange={(paper) => set({ paper })} />
          </Setting>
          <Setting title="Interface size">
            <Segmented
              value={settings.uiScale}
              options={[
                { value: 0.9, label: "90%" },
                { value: 1, label: "100%" },
                { value: 1.1, label: "110%" },
                { value: 1.25, label: "125%" },
              ]}
              onChange={(uiScale) => set({ uiScale })}
            />
          </Setting>
        </section>

        <section className="settings-group">
          <h2 className="settings-group-title">Writing</h2>
          <Setting title="Script text size" hint={`${settings.editorSize}px Courier`}>
            <input
              type="range"
              min="13"
              max="22"
              step="1"
              value={settings.editorSize}
              onChange={(e) => set({ editorSize: Number(e.target.value) })}
            />
          </Setting>
          <Setting title="Scene numbers" hint="Numbers each scene heading in the margins, on screen and in print.">
            <Toggle on={settings.sceneNumbers} onChange={(sceneNumbers) => set({ sceneNumbers })} />
          </Setting>
          <Setting title="Smart suggestions" hint="Offers character names, locations, times of day and transitions as you type.">
            <Toggle on={settings.autocomplete} onChange={(autocomplete) => set({ autocomplete })} />
          </Setting>
          <Setting title="Typewriter scrolling" hint="Keeps the line you are writing in the middle of the screen.">
            <Toggle on={settings.typewriterScroll} onChange={(typewriterScroll) => set({ typewriterScroll })} />
          </Setting>
          <Setting title="Typing sounds" hint="A typewriter key strike for every letter and a carriage return on Enter.">
            <Toggle
              on={settings.typewriterSounds}
              onChange={(typewriterSounds) => {
                set({ typewriterSounds });
                if (typewriterSounds) sfx.play("key");
              }}
            />
          </Setting>
          <Setting title="Typewriter bell" hint="Rings when you press Enter to start a new line.">
            <Toggle
              on={settings.typewriterBell}
              onChange={(typewriterBell) => {
                set({ typewriterBell });
                if (typewriterBell) sfx.play("bell");
              }}
            />
          </Setting>
          <Setting title="Daily word goal" hint="Set to 0 to turn the goal off and hide it from the home page.">
            <input
              className="input-sm"
              type="number"
              min="0"
              step="50"
              value={settings.dailyGoal}
              onChange={(e) => set({ dailyGoal: Math.max(0, Number(e.target.value) || 0) })}
            />
          </Setting>
        </section>

        <section className="settings-group">
          <h2 className="settings-group-title">Sound</h2>
          <Setting title="Volume" hint={settings.volume > 0 ? `${Math.round(settings.volume * 100)}%` : "Muted"}>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={settings.volume}
              onChange={(e) => set({ volume: Number(e.target.value) })}
              onPointerUp={() => sfx.play("click")}
            />
          </Setting>
        </section>

        <section className="settings-group">
          <h2 className="settings-group-title">Export & Print</h2>
          <Setting title="Include notes" hint="Notes are just for you, so they are left out by default.">
            <Toggle on={settings.exportNotes} onChange={(exportNotes) => set({ exportNotes })} />
          </Setting>
          <Setting title="Include subtext" hint="Subtext lines are private by default too.">
            <Toggle on={settings.exportSubtext} onChange={(exportSubtext) => set({ exportSubtext })} />
          </Setting>
        </section>

        <section className="settings-group">
          <h2 className="settings-group-title">Your Data</h2>
          <Setting
            title="Backup"
            hint={usage ? `Scripts, stats and settings · ${formatBytes(usage.used)} in use` : "Scripts, stats and settings"}
          >
            <div className="btn-row">
              <button
                className="btn"
                onClick={async () => {
                  try {
                    if (await exportBackup()) notify("Backup saved");
                  } catch (err) {
                    notify("Backup failed", { detail: String(err?.message || err), tone: "bad" });
                  }
                }}
              >
                Export Backup
              </button>
              <button className="btn btn-ghost" onClick={pickBackup}>
                Restore…
              </button>
            </div>
          </Setting>
        </section>

        <section className="settings-group">
          <h2 className="settings-group-title">Elements & Shortcuts</h2>
          <div className="ref-grid">
            {TYPES.map((t) => (
              <div key={t.key} className="ref-row">
                <span className="menu-icon">{t.icon}</span>
                <span className="ref-name">{t.label}</span>
                <span className="ref-keys">
                  <kbd>Ctrl+{t.hotkey}</kbd>
                  {t.prefix && <kbd>{t.prefix}</kbd>}
                </span>
              </div>
            ))}
          </div>
          <div className="ref-grid ref-grid-keys">
            {SHORTCUTS.map(([k, v]) => (
              <div key={k} className="ref-row">
                <kbd>{k}</kbd>
                <span className="ref-name">{v}</span>
              </div>
            ))}
          </div>
        </section>

        <p className="settings-foot">ScriptOS v{__APP_VERSION__} · sister app to ContentOS</p>
      </div>

      {restore && (
        <Confirm
          title="Restore Backup"
          body={`This replaces everything in ScriptOS with the backup from ${new Date(restore.exportedAt).toLocaleString()} (${(restore.data.scripts || []).length} scripts). Anything not in the backup is lost.`}
          confirmLabel="Replace Everything"
          danger
          onClose={() => setRestore(null)}
          onConfirm={async () => {
            try {
              await restoreBackup(restore);
              window.location.reload();
            } catch (err) {
              setRestore(null);
              notify("Restore failed", { detail: String(err?.message || err), tone: "bad" });
            }
          }}
        />
      )}
    </div>
  );
}
