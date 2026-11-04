import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { StoreProvider, useStore } from "./lib/store";
import { applyTheme } from "./lib/theme";
import { sfx } from "./lib/sound";
import { runStagger } from "./lib/stagger";
import { flushAll } from "./lib/storage";
import { requestPersistence } from "./lib/backup";
import { holdCloseUntilSaved, openExternal, revealWindow, toggleFullscreen } from "./lib/native";
import { NOTICE_EVENT } from "./lib/notice";
import Home from "./pages/Home";
import ScriptPage from "./pages/ScriptPage";
import ScramblePage from "./pages/ScramblePage";
import SharedPage from "./pages/SharedPage";
import SettingsPage from "./pages/SettingsPage";
import SaveGuard from "./components/SaveGuard";
import SyncAgent from "./components/SyncAgent";
import { UpdateGate } from "./components/UpdateGate";

const keyOf = (r) => `${r.page}:${r.id || ""}`;

// The latest notice from anywhere in the app, for a moment. A new one replaces the
// old rather than stacking: they are status, not a log.
function Notices() {
  const [notice, setNotice] = useState(null);
  useEffect(() => {
    const show = (e) => setNotice(e.detail);
    window.addEventListener(NOTICE_EVENT, show);
    return () => window.removeEventListener(NOTICE_EVENT, show);
  }, []);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), notice.tone === "bad" ? 5200 : 2800);
    return () => clearTimeout(t);
  }, [notice]);
  if (!notice) return null;
  return (
    <div className="notice" data-tone={notice.tone || undefined} role="status" key={notice.key}>
      {notice.text}
      {notice.detail && <span>{notice.detail}</span>}
    </div>
  );
}

function Router() {
  const { settings } = useStore();
  const [route, setRoute] = useState({ page: "home" });
  const history = useRef([]);
  const scrolls = useRef({});
  const current = useRef(route);

  useLayoutEffect(() => {
    applyTheme(settings);
    sfx.setVolume(settings.volume);
    sfx.setTypewriter(settings.typewriterSounds);
    sfx.setBell(settings.typewriterBell);
  }, [settings]);

  const navigate = useCallback((next) => {
    scrolls.current[keyOf(current.current)] = window.scrollY;
    let target = next;
    if (next.page === "back") target = history.current.pop() || { page: "home" };
    else history.current.push(current.current);
    if (history.current.length > 20) history.current.shift();
    current.current = target;
    setRoute(target);
    sfx.play(target.page === "home" || next.page === "back" ? "back" : "nav");
  }, []);

  useLayoutEffect(() => {
    const y = scrolls.current[keyOf(route)] ?? 0;
    window.scrollTo(0, y);
    runStagger();
  }, [route]);

  return (
    <div
      onClickCapture={(e) => {
        const el = e.target.closest?.("button");
        if (el && !el.disabled && !el.closest(".format-bar")) sfx.play("click");
      }}
    >
      {route.page === "home" && <Home navigate={navigate} />}
      {route.page === "script" && <ScriptPage key={route.id} scriptId={route.id} navigate={navigate} />}
      {route.page === "scramble" && <ScramblePage key={route.id} scrambleId={route.id} navigate={navigate} />}
      {route.page === "shared" && <SharedPage key={route.id} shareId={route.id} navigate={navigate} />}
      {route.page === "settings" && <SettingsPage navigate={navigate} />}
      <Notices />
      <SaveGuard />
      <SyncAgent />
      <UpdateGate page={route.page} />
    </div>
  );
}

export default function App() {
  useEffect(() => {
    requestPersistence();
  }, []);

  // The window waits hidden until there is something in it.
  useEffect(() => {
    const frame = requestAnimationFrame(() => revealWindow());
    return () => cancelAnimationFrame(frame);
  }, []);

  // Links belong in the real browser, never inside the app's webview.
  useEffect(() => {
    const onClick = (e) => {
      const anchor = e.target.closest?.("a[href]");
      if (!anchor) return;
      if (!window.getSelection()?.isCollapsed) return;
      e.preventDefault();
      openExternal(anchor.getAttribute("href"));
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);

  // The webview's own right-click menu (Back, Reload, Inspect…) has no place in the
  // app. It stays only where you type, for spelling suggestions and copy/paste;
  // the app's own right-click menus (script cards) cancel it themselves.
  useEffect(() => {
    const onMenu = (e) => {
      if (e.defaultPrevented) return;
      if (e.target.closest?.("input, textarea, [contenteditable='true']")) return;
      e.preventDefault();
    };
    document.addEventListener("contextmenu", onMenu);
    return () => document.removeEventListener("contextmenu", onMenu);
  }, []);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== "F11") return;
      e.preventDefault();
      toggleFullscreen().catch(() => {});
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Closing the window must not outrun the last save.
  useEffect(() => {
    let release;
    holdCloseUntilSaved(flushAll).then((fn) => {
      release = fn;
    });
    return () => release?.();
  }, []);

  return (
    <StoreProvider>
      <Router />
    </StoreProvider>
  );
}
