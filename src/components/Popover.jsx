import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { uiZoom } from "../lib/zoom";

export default function Popover({ anchorRef, onClose, width, align = "left", side = null, className = "", children }) {
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
      const z = uiZoom();

      // a submenu sits beside the item that opened it, or on the left if there's no room
      if (side === "right") {
        const beside = anchor.right + 4;
        const fits = beside + rect.width <= window.innerWidth - pad;
        const x = fits ? beside : Math.max(pad, anchor.left - rect.width - 4);
        const y = Math.max(pad, Math.min(anchor.top - 7, window.innerHeight - rect.height - pad));
        setPos({ left: x / z, top: y / z });
        return;
      }

      let left = align === "right" ? anchor.right - rect.width : anchor.left;
      left = Math.max(pad, Math.min(left, window.innerWidth - rect.width - pad));

      let top = anchor.bottom + 5;
      if (top + rect.height > window.innerHeight - pad) {
        const above = anchor.top - rect.height - 5;
        top = above >= pad ? above : Math.max(pad, window.innerHeight - rect.height - pad);
      }
      setPos({ left: left / z, top: top / z });
    };

    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    // A menu that filters as you type (the slash menu) changes size, and so does the
    // line it hangs off as it wraps: either way it is placed again, so a menu that
    // had to open above a line closes the gap as it shrinks.
    const watch = typeof ResizeObserver === "function" ? new ResizeObserver(place) : null;
    if (watch) {
      if (ref.current) watch.observe(ref.current);
      if (anchorRef.current instanceof Element) watch.observe(anchorRef.current);
    }
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
      watch?.disconnect();
    };
  }, [anchorRef, align, side]);

  // A popover opened from inside this one (a colour picker from a menu) lives in its
  // own portal, but React still bubbles its clicks up through this one, marking
  // them as ours on the way, so using it doesn't close the menu underneath.
  const mark = useRef({});
  useEffect(() => {
    const onDown = (e) => {
      if (e.__popovers?.has(mark.current)) return;
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
      onMouseDown={(e) => (e.nativeEvent.__popovers ||= new Set()).add(mark.current)}
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
