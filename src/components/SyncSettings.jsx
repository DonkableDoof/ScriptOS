import { useEffect, useState } from "react";
import Confirm from "./Confirm";
import { useStore } from "../lib/store";
import { backend, shareAvailable, useAccount } from "../lib/share";
import { onSyncStatus, syncNow } from "../lib/cloud";
import { SYNC_RELINK } from "./SyncAgent";
import { timeAgo } from "../lib/script";
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

export function useSyncStatus() {
  const [status, setStatus] = useState({ state: "off" });
  useEffect(() => onSyncStatus(setStatus), []);
  return status;
}

export const syncLabel = (status) =>
  status.removed
    ? "Removed by Host"
    : status.state === "syncing"
    ? "Syncing…"
    : status.state === "error"
    ? "Sync problem"
    : status.lastSync
    ? `Synced ${timeAgo(status.lastSync)}`
    : "Syncing…";

// This device and the others on your account. What syncs is whatever you've uploaded;
// the Host manages which devices are linked.
export default function SyncSettings() {
  const store = useStore();
  const { user } = useAccount();
  const status = useSyncStatus();
  const [name, setName] = useState("");
  const [confirm, setConfirm] = useState(null);
  const { device } = store;

  useEffect(() => setName(device?.name || ""), [device?.name]);

  if (!user || !device?.id) {
    return (
      <Row
        title="Sync between devices"
        hint={shareAvailable() ? "Sign in to your account above. Scripts and scrambles you upload then appear on every device you sign in on; anything you haven't uploaded stays on this device." : "Sync isn't connected to a server yet."}
      />
    );
  }

  const act = async (fn, done) => {
    try {
      await fn(await backend());
      if (done) notify(done);
      syncNow();
    } catch (err) {
      notify("Sync", { detail: String(err?.message || err), tone: "bad" });
    }
  };

  if (status.removed) {
    return (
      <Row title="This device was removed" hint="The Host removed this device, so it's stopped syncing. Everything it already has stays here.">
        <button className="btn" onClick={() => window.dispatchEvent(new Event(SYNC_RELINK))}>
          Link Again
        </button>
      </Row>
    );
  }

  const host = status.role === "host";
  const uploaded = [...store.scripts, ...store.scrambles].filter((i) => i.cloud && i.cloudOwner === user.id).length;
  const commitName = () => {
    const clean = name.trim();
    if (!clean) setName(device.name);
    else if (clean !== device.name) store.setDevice({ ...device, name: clean });
  };

  return (
    <>
      <Row title="This device" hint="Your first device is the Host. Any other device you sign in on becomes a Link.">
        <input className="input-name" value={name} maxLength={60} aria-label="Device name" onChange={(e) => setName(e.target.value)} onBlur={commitName} />
        {status.role && (
          <span className="sync-role" data-role={status.role}>
            {host ? "Host" : "Link"}
          </span>
        )}
      </Row>
      <Row title="Status" hint={status.state === "error" ? status.error : `${uploaded} uploaded ${uploaded === 1 ? "item" : "items"} on this device`}>
        <span className="sync-state" data-state={status.state}>
          {syncLabel(status)}
        </span>
        <button className="btn btn-sm" onClick={syncNow}>
          Sync Now
        </button>
      </Row>
      <Row title="Devices" hint="Everything signed in to your account.">
        <div className="sync-devices">
          {(status.devices || []).map((d) => (
            <div key={d.id} className="sync-device">
              <span className="sync-role" data-role={d.role}>
                {d.role === "host" ? "Host" : "Link"}
              </span>
              <span className="sync-device-name">
                {d.name}
                {d.self ? " (this device)" : ""}
              </span>
              <span className="sync-device-seen">{d.self || !d.seen ? "" : timeAgo(d.seen)}</span>
              {host && !d.self && (
                <>
                  <button className="btn btn-ghost btn-sm" onClick={() => act((api) => api.deviceTakeHost(d.id), `${d.name} is now the Host`)}>
                    Make Host
                  </button>
                  <button className="btn btn-ghost btn-sm" onClick={() => setConfirm(d)}>
                    Remove
                  </button>
                </>
              )}
            </div>
          ))}
        </div>
      </Row>
      {!host && status.role && (
        <Row title="Host" hint="Make this device the Host, for when the old one is gone or you've changed computers.">
          <button className="btn btn-ghost" onClick={() => act((api) => api.deviceTakeHost(device.id), "This device is now the Host")}>
            Become Host
          </button>
        </Row>
      )}

      {confirm && (
        <Confirm
          title="Remove Device"
          body={`${confirm.name} will stop syncing. Everything it already has stays on it.`}
          confirmLabel="Remove"
          danger
          onClose={() => setConfirm(null)}
          onConfirm={() => {
            const target = confirm;
            setConfirm(null);
            act((api) => api.deviceRemove(device.id, target.id), `${target.name} removed`);
          }}
        />
      )}
    </>
  );
}
