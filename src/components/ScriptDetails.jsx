import { useState } from "react";
import Modal from "./Modal";
import CoverCropper from "./CoverCropper";
import { FORMATS, isTv } from "../lib/script";
import { renderCover } from "../lib/image";

// New-script and edit-details share one dialog: the cover on the left, the title
// page on the right.
export default function ScriptDetails({ script, creating, onSave, onClose }) {
  const [draft, setDraft] = useState(() => ({
    title: creating ? "" : script.title,
    format: script.format,
    show: script.show,
    season: script.season,
    episode: script.episode,
    logline: script.logline,
    author: script.author,
    draft: script.draft,
  }));
  const [crop, setCrop] = useState(null);
  const set = (patch) => setDraft((d) => ({ ...d, ...patch }));

  const submit = () => {
    const title = draft.title.trim() || "Untitled Script";
    let cover = "";
    // an untouched existing cover is kept byte for byte rather than re-encoded
    if (crop) cover = crop.existing ? script.cover : renderCover(crop.img, crop);
    onSave({ ...draft, title, cover });
  };

  const preview = { ...script, ...draft, title: draft.title || "Untitled Script", cover: "" };

  return (
    <Modal
      title={creating ? "New Script" : "Script Details"}
      submitLabel={creating ? "Create Script" : "Save"}
      onSubmit={submit}
      onClose={onClose}
      wide
    >
      <div className="details">
        <CoverCropper script={preview} value={crop} onChange={setCrop} />
        <div className="details-fields">
          <div className="field">
            <span className="label">Title</span>
            <input
              data-autofocus
              value={draft.title}
              placeholder="Untitled Script"
              onChange={(e) => set({ title: e.target.value })}
            />
          </div>

          <div className="field">
            <span className="label">Format</span>
            <div className="segmented">
              {FORMATS.map((f) => (
                <button
                  type="button"
                  key={f.key}
                  data-on={draft.format === f.key}
                  onClick={() => set({ format: f.key })}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          {isTv(draft.format) && (
            <div className="field-row">
              <div className="field" style={{ flex: 2 }}>
                <span className="label">Show</span>
                <input value={draft.show} placeholder="Series name" onChange={(e) => set({ show: e.target.value })} />
              </div>
              <div className="field" style={{ flex: 1 }}>
                <span className="label">Season</span>
                <input value={draft.season} inputMode="numeric" placeholder="1" onChange={(e) => set({ season: e.target.value })} />
              </div>
              <div className="field" style={{ flex: 1 }}>
                <span className="label">Episode</span>
                <input value={draft.episode} inputMode="numeric" placeholder="1" onChange={(e) => set({ episode: e.target.value })} />
              </div>
            </div>
          )}

          <div className="field">
            <span className="label">Description</span>
            <textarea
              rows={4}
              value={draft.logline}
              placeholder="What it's about"
              onChange={(e) => set({ logline: e.target.value })}
            />
          </div>

          <div className="field-row">
            <div className="field" style={{ flex: 1 }}>
              <span className="label">Written by</span>
              <input value={draft.author} placeholder="Your name" onChange={(e) => set({ author: e.target.value })} />
            </div>
            <div className="field" style={{ flex: 1 }}>
              <span className="label">Draft</span>
              <input value={draft.draft} placeholder="First Draft" onChange={(e) => set({ draft: e.target.value })} />
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
}
