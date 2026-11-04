import { useState } from "react";
import Modal from "./Modal";
import Confirm from "./Confirm";
import AccountDialog from "./AccountDialog";
import { Avatar } from "./CommentsPanel";
import { ACCESS, shareAvailable, useAccount } from "../lib/share";
import { timeAgo } from "../lib/script";
import { notify } from "../lib/notice";
import { sfx } from "../lib/sound";

function Segmented({ value, options, onChange, disabled }) {
  return (
    <div className="segmented">
      {options.map((o) => (
        <button key={o.value} type="button" disabled={disabled} data-on={value === o.value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export default function ShareDialog({ script, owner, onClose }) {
  const account = useAccount();
  const [access, setAccess] = useState("anyone");
  const [includeNotes, setIncludeNotes] = useState(false);
  const [includeSubtext, setIncludeSubtext] = useState(false);
  const [error, setError] = useState("");
  const [confirmStop, setConfirmStop] = useState(false);
  const { share, busy } = owner;

  const attempt = async (fn, done) => {
    setError("");
    try {
      await fn();
      if (done) notify(done);
      return true;
    } catch (err) {
      setError(String(err?.message || err));
      sfx.play("error");
      return false;
    }
  };

  if (!shareAvailable()) {
    return (
      <Modal title="Share" submitLabel="Close" onSubmit={onClose} onClose={onClose}>
        <p className="modal-note">Sharing isn't connected to a server yet.</p>
      </Modal>
    );
  }
  if (!account.ready) return null;
  if (!account.user) return <AccountDialog onClose={onClose} />;

  // ── not shared yet ──
  if (!share) {
    const notes = script.blocks.filter((b) => b.type === "note").length;
    const subtext = script.blocks.filter((b) => b.type === "subtext").length;
    return (
      <Modal
        title={`Share “${script.title}”`}
        submitLabel={busy ? "Uploading…" : "Start Sharing"}
        submitDisabled={busy}
        onClose={onClose}
        onSubmit={() =>
          attempt(() => owner.start({ access, includeNotes, includeSubtext })).then((ok) => ok && sfx.play("complete"))
        }
      >
        <p className="modal-note">
          Uploads a copy of this script, with its cover and character icons, so people with the code can read it, comment and suggest edits, which you accept or reject. Your own edits go up as you type. When you stop sharing, the comments and any open suggestions stay here and the copy is deleted from the server.
        </p>
        <div className="field">
          <span className="label">Who can open it</span>
          <Segmented value={access} options={ACCESS} onChange={setAccess} />
        </div>
        {(notes > 0 || subtext > 0) && (
          <div className="field">
            <span className="label">Your private lines stay out unless you include them</span>
            {notes > 0 && (
              <label className="check-row">
                <input type="checkbox" checked={includeNotes} onChange={(e) => setIncludeNotes(e.target.checked)} />
                Include {notes} {notes === 1 ? "note" : "notes"}
              </label>
            )}
            {subtext > 0 && (
              <label className="check-row">
                <input type="checkbox" checked={includeSubtext} onChange={(e) => setIncludeSubtext(e.target.checked)} />
                Include {subtext} subtext {subtext === 1 ? "line" : "lines"}
              </label>
            )}
          </div>
        )}
        {error && <p className="modal-error">{error}</p>}
      </Modal>
    );
  }

  // ── shared ──
  return (
    <>
      <Modal title={`Sharing “${script.title}”`} submitLabel="Done" onSubmit={onClose} onClose={onClose}>
        {!owner.mine && <p className="modal-error">You're signed in with a different account from the one that shared this script.</p>}
        {!owner.online && <p className="modal-error">Can't reach the server right now. Comments you already have are safe here.</p>}

        <div className="share-code">
          <span className="label">Share code</span>
          <div className="share-code-row">
            <code>{share.code}</code>
            <button
              className="btn"
              onClick={() => {
                navigator.clipboard?.writeText(share.code).then(() => notify("Code copied"));
              }}
            >
              Copy
            </button>
          </div>
        </div>

        <div className="field">
          <span className="label">Who can open it</span>
          <Segmented value={share.access} options={ACCESS} disabled={busy || !owner.mine} onChange={(a) => attempt(() => owner.setAccess(a))} />
        </div>

        {owner.requests.length > 0 && (
          <div className="field">
            <span className="label">Asking to read</span>
            {owner.requests.map((p) => (
              <div key={p.id} className="share-person">
                <Avatar name={p.name} src={p.avatar} />
                <span className="share-person-name">{p.name}</span>
                <button className="btn btn-sm btn-primary" disabled={busy} onClick={() => attempt(() => owner.decide(p.id, "approved"))}>
                  Let In
                </button>
                <button className="btn btn-sm btn-ghost" disabled={busy} onClick={() => attempt(() => owner.decide(p.id, "denied"))}>
                  Decline
                </button>
              </div>
            ))}
          </div>
        )}

        {owner.readers.length > 0 && (
          <div className="field">
            <span className="label">Can read it</span>
            {owner.readers.map((p) => (
              <div key={p.id} className="share-person">
                <Avatar name={p.name} src={p.avatar} />
                <span className="share-person-name">{p.name}</span>
                <button className="btn btn-sm btn-ghost" disabled={busy} onClick={() => attempt(() => owner.decide(p.id, "denied"))}>
                  Remove
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="share-version">
          <span>{owner.outOfDate ? "Sending your latest edits…" : `Up to date · sent ${timeAgo(share.uploadedAt)}`}</span>
        </div>

        <button className="btn btn-ghost share-stop" disabled={busy} onClick={() => setConfirmStop(true)}>
          Stop Sharing
        </button>
        {error && <p className="modal-error">{error}</p>}
      </Modal>

      {confirmStop && (
        <Confirm
          title="Stop Sharing"
          body="Every comment and open suggestion is saved on this script, then the shared copy and everything attached to it are deleted from the server. People with the code won't be able to open it any more. Your account stays."
          confirmLabel="Stop Sharing"
          danger
          onClose={() => setConfirmStop(false)}
          onConfirm={async () => {
            setConfirmStop(false);
            const ok = await attempt(() => owner.stop());
            if (ok) {
              notify("No longer shared", { detail: "The comments stay on this script." });
              sfx.play("complete");
              onClose();
            }
          }}
        />
      )}
    </>
  );
}
