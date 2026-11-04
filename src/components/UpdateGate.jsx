import { useEffect, useRef } from "react";
import { installUpdate, RELEASES_URL, useUpdate } from "../lib/updates";
import { openExternal } from "../lib/native";

// Updates are mandatory whenever one can actually be installed: the app waits behind this
// screen and installs straight away. It never interrupts writing: an update found while
// a script is open waits until you're back on the home page or next open the app. If the
// install fails or you're offline, the app carries on and tries again later.
export function UpdateGate({ page }) {
  const update = useUpdate();
  const begun = useRef(null);
  const due = update.installable && !update.failed && (page === "home" || update.status === "installing");

  useEffect(() => {
    const go = `${update.version}:${update.attempt}`;
    if (due && update.status === "available" && begun.current !== go) {
      begun.current = go;
      installUpdate();
    }
  }, [due, update.status, update.version, update.attempt]);

  if (!due) return null;
  return (
    <div className="update-gate" role="alertdialog" aria-label="Updating ScriptOS">
      <div className="update-card">
        <img src="/icon.png" alt="" width="56" height="56" />
        <h2>Updating to ScriptOS {update.version}</h2>
        <p>Your work is saved. ScriptOS will restart by itself when this finishes.</p>
        <div className="update-bar">
          <span style={{ width: `${update.progress || 0}%` }} />
        </div>
      </div>
    </div>
  );
}

// The notice on the home page, for an update that hasn't installed yet.
export function UpdateNotice() {
  const update = useUpdate();
  if (update.status !== "available" || !update.version) return null;
  if (update.installable) {
    return (
      <div className="update-notice" data-bad={update.failed || undefined}>
        <span>
          <b>ScriptOS {update.version} is available.</b> {update.failed ? `The update didn't finish: ${update.error}` : "It installs automatically."}
        </span>
        <button className="btn btn-primary btn-sm" onClick={installUpdate}>
          {update.failed ? "Try Again" : "Install Now"}
        </button>
      </div>
    );
  }
  return (
    <div className="update-notice">
      <span>
        <b>ScriptOS {update.version} is out.</b> This one has to be installed by hand.
      </span>
      <button className="btn btn-sm" onClick={() => openExternal(RELEASES_URL)}>
        Open Download Page
      </button>
    </div>
  );
}
