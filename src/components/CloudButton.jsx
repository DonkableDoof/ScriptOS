import { useEffect, useRef, useState } from "react";
import AccountDialog from "./AccountDialog";
import Confirm from "./Confirm";
import { useStore } from "../lib/store";
import { backend, useAccount } from "../lib/share";
import { syncNow } from "../lib/cloud";
import { notify } from "../lib/notice";
import { sfx } from "../lib/sound";

// The choice of whether a script or scramble follows you to your other devices.
export function useCloudToggle(kind, item) {
  const store = useStore();
  const { user } = useAccount();
  const [signIn, setSignIn] = useState(false);
  const [confirm, setConfirm] = useState(null);
  const waiting = useRef(null);
  const isUploaded = (x) => Boolean(x?.cloud && x.cloudOwner === user?.id);

  const upload = (x, id) => {
    store.markUploaded(kind, x.id, id);
    syncNow();
    notify("Uploaded to your account", { detail: "It'll appear on your other devices." });
    sfx.play("add");
  };

  // signing in to upload something carries on and uploads it
  useEffect(() => {
    if (!user || !waiting.current) return;
    const x = waiting.current;
    waiting.current = null;
    upload(x, user.id);
  }, [user]);

  const toggle = (x = item) => {
    if (!user) {
      waiting.current = x;
      setSignIn(true);
    } else if (isUploaded(x)) setConfirm(x);
    else upload(x, user.id);
  };

  const dialogs = (
    <>
      {signIn && (
        <AccountDialog
          onDone={() => setSignIn(false)}
          onClose={() => {
            waiting.current = null;
            setSignIn(false);
          }}
        />
      )}
      {confirm && (
        <Confirm
          title="Keep on This Device Only"
          body={`“${confirm.title || "Untitled"}” will be deleted from your account. This device and your other devices each keep the copy they have, but they'll stop syncing it.`}
          confirmLabel="Remove from Account"
          danger
          onClose={() => setConfirm(null)}
          onConfirm={async () => {
            const x = confirm;
            setConfirm(null);
            try {
              await (await backend()).cloudSetState(x.id, "local");
              store.markLocal(kind, x.id);
              notify("Only on this device now");
            } catch (err) {
              notify("Couldn't remove it from your account", { detail: String(err?.message || err), tone: "bad" });
            }
          }}
        />
      )}
    </>
  );

  return { uploaded: isUploaded(item), isUploaded, toggle, dialogs };
}

export default function CloudButton({ kind, item }) {
  const { uploaded, toggle, dialogs } = useCloudToggle(kind, item);
  return (
    <>
      <button className="btn btn-ghost cloud-btn" data-on={uploaded} onClick={() => toggle()} title={uploaded ? "Uploaded: on all your signed-in devices. Click to keep it on this device only." : "Only on this device. Click to upload it to your account."}>
        {uploaded ? "☁ Uploaded" : "☁ Upload"}
      </button>
      {dialogs}
    </>
  );
}
