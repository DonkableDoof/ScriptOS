import { useEffect, useState } from "react";
import { onSaveStatus, flush } from "../lib/storage";

// A save that fails quietly is what let a whole video page disappear. If a write cannot
// land, the app says so and keeps saying so until it does.
export default function SaveGuard() {
  const [status, setStatus] = useState({ saving: false, error: null });
  const [retrying, setRetrying] = useState(false);

  useEffect(() => onSaveStatus(setStatus), []);

  if (!status.error) return null;

  return (
    <div className="save-guard" role="alert">
      <span className="save-guard-mark">⚠</span>
      <div className="save-guard-text">
        <strong>Your changes are not being saved.</strong>
        <span>{status.error}</span>
        <span>Keep this window open and export a backup from Settings before closing it.</span>
      </div>
      <button
        className="btn btn-ghost btn-sm"
        disabled={retrying}
        onClick={async () => {
          setRetrying(true);
          await flush();
          setRetrying(false);
        }}
      >
        {retrying ? "Retrying…" : "Retry"}
      </button>
    </div>
  );
}
