import { useRef, useState } from "react";
import Modal from "./Modal";
import { Avatar } from "./CommentsPanel";
import { signIn, signUp } from "../lib/share";
import { loadImageFile, ONLINE_ICON_SIZE, renderIcon } from "../lib/image";
import { sfx } from "../lib/sound";

// An account: an email and password, a name other people see, and optionally a picture.
// Only needed for sharing, reading what others share, and syncing between devices.
export default function AccountDialog({ onDone, onClose }) {
  const [mode, setMode] = useState("create");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [avatar, setAvatar] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirm, setConfirm] = useState(false);
  const fileRef = useRef(null);
  const creating = mode === "create";

  const pick = async (file) => {
    try {
      setAvatar(renderIcon(await loadImageFile(file), ONLINE_ICON_SIZE));
    } catch (err) {
      setError(err.message);
    }
  };

  const submit = async () => {
    if (busy) return;
    if (creating && !name.trim()) return setError("Choose a display name.");
    if (!email.trim() || !password) return setError("Enter your email and a password.");
    setBusy(true);
    setError("");
    try {
      if (creating) {
        const result = await signUp({ email: email.trim(), password, displayName: name.trim(), avatar });
        if (!result.signedIn) {
          setConfirm(true);
          setMode("signin");
          setPassword("");
          setBusy(false);
          return;
        }
      } else await signIn({ email: email.trim(), password });
      sfx.play("complete");
      onDone?.();
    } catch (err) {
      setError(String(err?.message || err));
      setBusy(false);
      sfx.play("error");
    }
  };

  return (
    <Modal
      title={creating ? "Create Your Account" : "Sign In"}
      submitLabel={busy ? "One moment…" : creating ? "Create Account" : "Sign In"}
      submitDisabled={busy}
      onSubmit={submit}
      onClose={onClose}
    >
      <div className="segmented account-mode">
        <button type="button" data-on={creating} onClick={() => setMode("create")}>
          New Account
        </button>
        <button type="button" data-on={!creating} onClick={() => setMode("signin")}>
          I Have an Account
        </button>
      </div>

      {confirm && <p className="modal-note">Check your email and confirm your address, then sign in here.</p>}

      {creating && (
        <div className="account-identity">
          <button type="button" className="avatar-pick" onClick={() => fileRef.current?.click()} title="Choose a profile picture">
            <Avatar name={name} src={avatar} size={64} />
            <span>{avatar ? "Change" : "Add Picture"}</span>
          </button>
          <div className="field account-name">
            <span className="label">Display name</span>
            <input data-autofocus value={name} maxLength={40} placeholder="How others see you" onChange={(e) => setName(e.target.value)} />
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) pick(file);
            }}
          />
        </div>
      )}

      <div className="field">
        <span className="label">Email</span>
        <input type="email" autoComplete="email" spellCheck={false} value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>
      <div className="field">
        <span className="label">Password</span>
        <input type="password" autoComplete={creating ? "new-password" : "current-password"} value={password} onChange={(e) => setPassword(e.target.value)} />
      </div>

      {error && <p className="modal-error">{error}</p>}
    </Modal>
  );
}
