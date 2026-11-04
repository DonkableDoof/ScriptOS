import { useCallback, useEffect, useState } from "react";
import Modal from "./Modal";
import AccountDialog from "./AccountDialog";
import { joinWithCode, leaveShared, shareAvailable, sharedWithMe, useAccount } from "../lib/share";
import { notify } from "../lib/notice";
import { sfx } from "../lib/sound";

// Typing in a code someone sent you. Needs an account, like sharing does.
export function JoinDialog({ onOpen, onJoined, onClose }) {
  const account = useAccount();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [waiting, setWaiting] = useState(null);

  if (!shareAvailable()) {
    return (
      <Modal title="Open a Shared Script" submitLabel="Close" onSubmit={onClose} onClose={onClose}>
        <p className="modal-note">Sharing isn't connected to a server yet.</p>
      </Modal>
    );
  }
  if (!account.ready) return null;
  if (!account.user) return <AccountDialog onClose={onClose} />;

  if (waiting) {
    return (
      <Modal title="Request Sent" submitLabel="Done" onSubmit={onClose} onClose={onClose}>
        <p className="modal-note">
          <b>{waiting.owner_name || "The writer"}</b> needs to let you in to “{waiting.title}”. It'll be under Shared With Me on your home page, and opens once they do.
        </p>
      </Modal>
    );
  }

  const submit = async () => {
    if (busy || !code.trim()) return;
    setBusy(true);
    setError("");
    try {
      const result = await joinWithCode(code);
      setBusy(false);
      onJoined?.();
      if (result.status === "approved") onOpen(result.share_id);
      else if (result.status === "pending") setWaiting(result);
      else if (result.status === "owner") setError("That's your own script. Open it from your scripts.");
      else if (result.status === "denied") setError("The writer has declined access to this script.");
      else setError("No script has that code. Check it and try again.");
      if (result.status !== "approved" && result.status !== "pending") sfx.play("error");
    } catch (err) {
      setError(String(err?.message || err));
      setBusy(false);
    }
  };

  return (
    <Modal title="Open a Shared Script" submitLabel={busy ? "Checking…" : "Open"} submitDisabled={busy || !code.trim()} onSubmit={submit} onClose={onClose}>
      <div className="field">
        <span className="label">Share code</span>
        <input data-autofocus className="code-input" value={code} maxLength={20} spellCheck={false} placeholder="XXXXX-XXXXX" onChange={(e) => setCode(e.target.value.toUpperCase())} />
      </div>
      {error && <p className="modal-error">{error}</p>}
    </Modal>
  );
}

// Scripts other people have shared with you. Asks the server only if you're signed in.
export function SharedPanel({ refreshKey, onOpen }) {
  const { user } = useAccount();
  const [list, setList] = useState([]);

  const load = useCallback(() => {
    if (!user) {
      setList([]);
      return;
    }
    sharedWithMe().then(setList, () => {});
  }, [user]);

  useEffect(() => {
    load();
    window.addEventListener("focus", load);
    return () => window.removeEventListener("focus", load);
  }, [load, refreshKey]);

  if (!list.length) return null;
  return (
    <div className="panel">
      <div className="panel-head">
        <span className="panel-title">Shared With Me</span>
      </div>
      <div className="scrambles">
        {list.map((s) => {
          const open = s.status === "approved";
          return (
            <div key={s.id} className="scramble" data-disabled={!open || undefined} role={open ? "button" : undefined} tabIndex={open ? 0 : undefined} onClick={() => open && onOpen(s.id)}>
              <span className="scramble-title">{s.title}</span>
              <span className="scramble-meta">
                {s.ownerName}
                {open ? "" : " · waiting to be let in"}
              </span>
              <button
                className="scramble-delete"
                title="Remove from this list"
                aria-label={`Remove ${s.title}`}
                onClick={(e) => {
                  e.stopPropagation();
                  leaveShared(s.id).then(load, (err) => notify("Couldn't remove it", { detail: err.message, tone: "bad" }));
                }}
              >
                ×
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
