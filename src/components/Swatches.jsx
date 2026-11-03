import { useRef, useState } from "react";
import NewColor from "./NewColor";
import { useStore } from "../lib/store";
import { paletteOf } from "../lib/colors";

// A row of colour swatches: the built-in colours, your own, and a + that makes a
// new one and applies it straight away.
export default function Swatches({ value, onPick, noneLabel = "Default" }) {
  const { settings } = useStore();
  const [adding, setAdding] = useState(false);
  const addRef = useRef(null);
  const palette = paletteOf(settings.customColors);

  return (
    <div className="menu-colors">
      {palette.map((c) => (
        <button
          key={c.key}
          className="menu-color"
          data-none={!c.hex || undefined}
          data-on={(value || null) === c.hex}
          style={c.hex ? { "--swatch": c.hex } : undefined}
          title={c.hex ? (c.custom ? c.name : `${c.name} · Alt+${c.key}`) : noneLabel}
          aria-label={c.hex ? c.name : noneLabel}
          onClick={() => onPick(c.hex)}
        />
      ))}
      <button ref={addRef} className="menu-color menu-color-add" title="New colour" aria-label="New colour" onClick={() => setAdding(true)}>
        +
      </button>
      {adding && (
        <NewColor
          anchorRef={addRef}
          onClose={() => setAdding(false)}
          onCreate={(color) => {
            setAdding(false);
            onPick(color.hex);
          }}
        />
      )}
    </div>
  );
}
