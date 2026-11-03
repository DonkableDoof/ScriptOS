import { useLayoutEffect, useRef, useState } from "react";
import Popover from "./Popover";
import { sfx } from "../lib/sound";

// The app's own dropdown. A native <select> opens the operating system's menu,
// which looks nothing like the rest of ScriptOS.
export default function Select({ value, options, onChange, placeholder = "Not Set", label, prefix, compact = false, id }) {
  const [open, setOpen] = useState(false);
  const [width, setWidth] = useState(null);
  const anchorRef = useRef(null);
  const chosen = options.find((o) => o.value === value);

  useLayoutEffect(() => {
    if (open && anchorRef.current) setWidth(Math.max(compact ? 170 : 190, anchorRef.current.getBoundingClientRect().width));
  }, [open, compact]);

  return (
    <div className="picker" data-compact={compact || undefined} ref={anchorRef}>
      <button
        type="button"
        id={id}
        className="picker-field"
        data-empty={!chosen}
        aria-label={label}
        aria-expanded={open}
        aria-haspopup="listbox"
        onClick={() => {
          setOpen((o) => !o);
          sfx.play(open ? "close" : "open");
        }}
      >
        <span className="picker-value">
          {prefix && <span className="picker-prefix">{prefix}</span>}
          {chosen?.icon && <span className="picker-icon">{chosen.icon}</span>}
          {chosen?.label || placeholder}
        </span>
        <span className="picker-caret" data-open={open}>
          ▾
        </span>
      </button>

      {open && (
        <Popover anchorRef={anchorRef} width={width} onClose={() => setOpen(false)} className="picker-list">
          {options.map((o) => (
            <button
              type="button"
              key={String(o.value)}
              className="menu-item"
              data-on={o.value === value}
              role="option"
              aria-selected={o.value === value}
              onClick={() => {
                onChange(o.value);
                setOpen(false);
                sfx.play("tap");
              }}
            >
              {o.icon && <span className="menu-icon">{o.icon}</span>}
              <span className="picker-label">{o.label}</span>
              {o.hint != null && <span className="menu-hint">{o.hint}</span>}
            </button>
          ))}
        </Popover>
      )}
    </div>
  );
}
