import { useEffect, useRef, useState } from "react";
import AccountDialog from "./AccountDialog";
import { Avatar } from "./CommentsPanel";
import { saveProfile, shareAvailable, signOut, useAccount } from "../lib/share";
import { loadImageFile, renderIcon } from "../lib/image";
import { notify } from "../lib/notice";

function Row({ title, hint, children }) {
  return (
    <div className="setting">
      <div className="setting-text">
        <span className="setting-title">{title}</span>
        {hint && <span className="setting-hint">{hint}</span>}
      </div>
      <div className="setting-control">{children}</div>
    </div>
  );
}

// The account behind Share: your name and picture, as other people see them.
export default function AccountSettings() {
  const { ready, user, profile } = useAccount();
  const [dialog, setDialog] = useState(false);
  const [name, setName] = useState("");
  const fileRef = useRef(null);

  useEffect(() => setName(profile?.name || ""), [profile?.name]);

  const act = (promise, done) =>
    promise.then(
      () => done && notify(done),
      (err) => notify("Couldn't save that", { detail: String(err?.message || err), tone: "bad" })
    );

  if (!user) {
    return (
      <>
        <Row
          title="Your account"
          hint={shareAvailable() ? "For sharing scripts and for syncing the ones you upload between devices. Anything you don't upload or share stays on this device." : "Accounts aren't connected to a server yet."}
        >
          <button className="btn" disabled={!ready || !shareAvailable()} onClick={() => setDialog(true)}>
            Sign In or Create Account
          </button>
        </Row>
        {dialog && <AccountDialog onDone={() => setDialog(false)} onClose={() => setDialog(false)} />}
      </>
    );
  }

  const commitName = () => {
    const clean = name.trim();
    if (!clean) setName(profile?.name || "");
    else if (clean !== profile?.name) act(saveProfile({ display_name: clean }), "Name updated");
  };

  return (
    <>
      <Row title="Profile picture" hint="Shown beside your comments.">
        <Avatar name={profile?.name} src={profile?.avatar} size={40} />
        <button className="btn btn-sm" onClick={() => fileRef.current?.click()}>
          {profile?.avatar ? "Change" : "Upload"}
        </button>
        {profile?.avatar && (
          <button className="btn btn-ghost btn-sm" onClick={() => act(saveProfile({ avatar: null }))}>
            Remove
          </button>
        )}
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          hidden
          onChange={async (e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (!file) return;
            try {
              await act(saveProfile({ avatar: renderIcon(await loadImageFile(file)) }));
            } catch (err) {
              notify("That picture didn't work", { detail: err.message, tone: "bad" });
            }
          }}
        />
      </Row>
      <Row title="Display name" hint="What other people see. Your email is never shown to them.">
        <input className="input-name" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} onBlur={commitName} />
      </Row>
      <Row title="Signed in" hint={user.email}>
        <button className="btn btn-ghost" onClick={() => act(signOut())}>
          Sign Out
        </button>
      </Row>
    </>
  );
}
