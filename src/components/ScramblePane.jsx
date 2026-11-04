import ScrambleDoc from "./ScrambleDoc";
import Select from "./Select";
import { useStore } from "../lib/store";
import { scrambleTitle } from "../lib/script";

const NEW = "__new";

// A scramble open beside a script, scrolling on its own.
export default function ScramblePane({ scramble, side, onPick, onSwap, onOpenFull, onClose }) {
  const store = useStore();
  const options = [
    ...[...store.scrambles].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)).map((s) => ({ value: s.id, label: scrambleTitle(s) })),
    { value: NEW, label: "+ New Scramble" },
  ];

  return (
    <aside className="scramble-pane" data-side={side}>
      <div className="pane-head">
        <Select
          compact
          label="Scramble"
          value={scramble.id}
          options={options}
          onChange={(id) => onPick(id === NEW ? store.addScramble().id : id)}
        />
        <div className="pane-actions">
          <button className="pane-btn" onClick={onSwap} title={side === "right" ? "Move to the left of the script" : "Move to the right of the script"} aria-label="Swap sides">
            ⇄
          </button>
          <button className="pane-btn" onClick={onOpenFull} title="Open on its own page" aria-label="Open on its own page">
            ⤢
          </button>
          <button className="pane-btn" onClick={onClose} title="Close" aria-label="Close">
            ×
          </button>
        </div>
      </div>
      <input
        className="pane-title"
        value={scramble.title}
        placeholder="Untitled Scramble"
        spellCheck={false}
        aria-label="Scramble title"
        onChange={(e) => store.updateScramble(scramble.id, { title: e.target.value })}
      />
      <div className="pane-scroll" data-scroller>
        <ScrambleDoc key={scramble.id} scramble={scramble} />
      </div>
    </aside>
  );
}
