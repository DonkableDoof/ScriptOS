import { useEffect, useRef } from "react";
import { useStore } from "./store";

const ZOOM_MIN = 0.5;
const ZOOM_MAX = 2.5;

// Ctrl+scroll zooms the page being written on (and Ctrl+= / Ctrl+- / Ctrl+0, like a
// browser). A mouse notch is one 10% step; a trackpad pinch sends small deltas, so
// they're added up until they make one. Script and scramble pages share the level.
export function useDocZoom() {
  const { settings, updateSettings } = useStore();
  const zoom = settings.docZoom || 1;
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const updateRef = useRef(updateSettings);
  updateRef.current = updateSettings;

  useEffect(() => {
    const setZoom = (z) => {
      const next = Math.round(Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z)) * 10) / 10;
      if (next !== zoomRef.current) updateRef.current({ docZoom: next });
    };
    let pending = 0;
    const onWheel = (e) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      pending += e.deltaY;
      if (Math.abs(pending) < 60) return;
      setZoom(zoomRef.current + (pending < 0 ? 0.1 : -0.1));
      pending = 0;
    };
    const onKey = (e) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      if (e.key === "=" || e.key === "+") setZoom(zoomRef.current + 0.1);
      else if (e.key === "-") setZoom(zoomRef.current - 0.1);
      else if (e.key === "0") setZoom(1);
      else return;
      e.preventDefault();
    };
    window.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("wheel", onWheel);
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  return { zoom, resetZoom: () => updateSettings({ docZoom: 1 }) };
}
