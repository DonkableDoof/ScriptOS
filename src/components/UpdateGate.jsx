import { exitApp, installUpdate, RELEASES_URL, useUpdate } from "../lib/updates";
import { openExternal } from "../lib/native";

// Updates are mandatory whenever one can actually be installed: on the home page, which is
// where the app opens, you either update or exit. It never interrupts writing: an update
// found while a script is open waits until you're back on the home page. If an install
// fails the app carries on rather than locking you out of your scripts, and asks again later.
export function UpdateGate({ page }) {
  const update = useUpdate();
  const installing = update.status === "installing";
  if (!update.installable || update.failed || !(installing || page === "home")) return null;
  if (!installing && update.status !== "available") return null;

  return (
    <div className="update-gate" role="alertdialog" aria-modal="true" aria-label={installing ? "Updating ScriptOS" : "Update required"}>
      <div className="update-card">
        <img src="/icon.png" alt="" width="56" height="56" />
        {installing ? (
          <>
            <h2>Updating to ScriptOS {update.version}</h2>
            <p>Your work is saved. ScriptOS will restart by itself when this finishes.</p>
            <div className="update-bar">
              <span style={{ width: `${update.progress || 0}%` }} />
            </div>
          </>
        ) : (
          <>
            <h2>Update Required</h2>
            <p>ScriptOS {update.version} is available. You need to install it to keep using ScriptOS. Your work is saved either way.</p>
            <div className="update-actions">
              <button className="btn" onClick={exitApp}>
                Exit
              </button>
              <button className="btn btn-primary" autoFocus onClick={installUpdate}>
                Update
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// The notice on the home page, for an update that can't go through the screen above: the
// install failed, or this release has to be downloaded.
export function UpdateNotice() {
  const update = useUpdate();
  if (update.status !== "available" || !update.version) return null;
  if (update.installable) {
    if (!update.failed) return null;
    return (
      <div className="update-notice" data-bad>
        <span>
          <b>ScriptOS {update.version} didn't install.</b> {update.error}
        </span>
        <button className="btn btn-primary btn-sm" onClick={installUpdate}>
          Try Again
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
