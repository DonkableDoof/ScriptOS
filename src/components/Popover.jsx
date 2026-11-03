import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { uiZoom } from "../lib/zoom";

export default function Popover({ anchorRef, onClose, width, align = "left", className = "", children }) {
  const ref = useRef(null);
  const [pos, setPos] = useState(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useLayoutEffect(() => {
    const place = () => {
      const anchor = anchorRef.current?.getBoundingClientRect();
      const el = ref.current;
      if (!anchor || !el) return;
      const rect = el.getBoundingClientRect();
      const pad = 10;

      let left = align === "right" ? anchor.right - rect.width : anchor.left;
      left = Math.max(pad, Math.min(left, window.innerWidth - rect.width - pad));

      let top = anchor.bottom + 5;
      if (top + rect.height > window.innerHeight - pad) {
        const above = anchor.top - rect.height - 5;
        top = above >= pad ? above : Math.max(pad, window.innerHeight - rect.height - pad);
      }
      const z = uiZoom();
      setPos({ left: left / z, top: top / z });
    };

    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [anchorRef, align]);

  useEffect(() => {
    const onDown = (e) => {
      if (ref.current?.contains(e.target) || anchorRef.current?.contains(e.target)) return;
      closeRef.current();
    };
    const onKey = (e) => e.key === "Escape" && closeRef.current();
    document.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [anchorRef]);

  return createPortal(
    <div
      ref={ref}
      className={`popover ${className}`}
      style={{
        left: pos?.left ?? 0,
        top: pos?.top ?? 0,
        width,
        visibility: pos ? "visible" : "hidden",
      }}
    >
      {children}
    </div>,
    document.body
  );
}
