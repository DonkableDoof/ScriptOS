import { useRef, useState } from "react";
import Popover from "./Popover";
import { useStore } from "../lib/store";
import { randomColor } from "../lib/colors";
import { uid } from "../lib/storage";
import { sfx } from "../lib/sound";

// Makes a named colour on the spot. It's saved with the rest of your colours in
// settings and turns up in every colour picker and in the slash menu by its name.
export default function NewColor({ anchorRef, onCreate, onClose }) {
  const { settings, updateSettings } = useStore();
  const [name, setName] = useState("");
  const [hex, setHex] = useState(randomColor);
  const nameRef = useRef(null);

  const create = () => {
    const color = { id: uid(), name: name.trim() || "Custom", hex };
    updateSettings({ customColors: [...(settings.customColors || []), color] });
    sfx.play("add");
    onCreate?.(color);
  };

  return (
    <Popover anchorRef={anchorRef} width={236} className="color-pop" onClose={onClose}>
      <span className="menu-label">New colour</span>
      <div
        className="color-form"
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter") {
            e.preventDefault();
            create();
          }
          if (e.key === "Escape") onClose();
        }}
      >
        <input type="color" value={hex} onChange={(e) => setHex(e.target.value)} aria-label="Colour" />
        <input
          ref={(el) => {
            nameRef.current = el;
            if (el && !el.dataset.focused) {
              el.dataset.focused = "1";
              setTimeout(() => el.focus(), 0);
            }
          }}
          value={name}
          placeholder="Name it"
          maxLength={24}
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      <button className="btn btn-primary btn-sm color-add" onClick={create}>
        Add Colour
      </button>
    </Popover>
  );
}
