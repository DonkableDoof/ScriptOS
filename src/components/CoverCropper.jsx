import { useEffect, useRef, useState } from "react";
import { coverGeometry, loadImage, loadImageFile } from "../lib/image";
import Cover from "./Cover";

// the A4 sheet, 210 × 297 mm, at a pixel a millimetre
const FRAME_W = 210;
const FRAME_H = 297;

// Pick an image, then drag it around and zoom until the A4 frame shows what you
// want. The crop is only rendered to pixels when the dialog is saved.
export default function CoverCropper({ script, value, onChange }) {
  const fileRef = useRef(null);
  const drag = useRef(null);
  const [error, setError] = useState("");

  // `value` is { img, zoom, x, y } while a picture is being placed, or null.
  useEffect(() => {
    if (value || !script.cover) return;
    let alive = true;
    loadImage(script.cover).then((img) => alive && onChange({ img, zoom: 1, x: 0, y: 0, existing: true }));
    return () => {
      alive = false;
    };
    // only on open
  }, []);

  const pick = async (file) => {
    setError("");
    try {
      const img = await loadImageFile(file);
      onChange({ img, zoom: 1, x: 0, y: 0 });
    } catch (err) {
      setError(err.message);
    }
  };

  const geom = value ? coverGeometry(value.img, FRAME_W, FRAME_H, value.zoom) : null;
  const clamp = (n) => Math.max(-0.5, Math.min(0.5, n));

  const onPointerDown = (e) => {
    if (!value) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, startX: value.x, startY: value.y };
  };
  const onPointerMove = (e) => {
    const d = drag.current;
    if (!d || !geom) return;
    const nx = geom.slackX > 0 ? clamp(d.startX - (e.clientX - d.x) / geom.slackX) : 0;
    const ny = geom.slackY > 0 ? clamp(d.startY - (e.clientY - d.y) / geom.slackY) : 0;
    onChange({ ...value, x: nx, y: ny, existing: false });
  };
  const onPointerUp = () => {
    drag.current = null;
  };

  return (
    <div className="cropper">
      <div
        className="cropper-frame"
        style={{ width: FRAME_W, height: FRAME_H }}
        data-has={Boolean(value)}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          const file = e.dataTransfer.files?.[0];
          if (file) pick(file);
        }}
        onWheel={(e) => {
          if (!value) return;
          const zoom = Math.max(1, Math.min(4, value.zoom * (e.deltaY < 0 ? 1.08 : 1 / 1.08)));
          onChange({ ...value, zoom, existing: false });
        }}
      >
        {value ? (
          <img
            src={value.img.src}
            alt=""
            draggable={false}
            style={{
              width: geom.w,
              height: geom.h,
              left: -geom.slackX / 2 - value.x * geom.slackX,
              top: -geom.slackY / 2 - value.y * geom.slackY,
            }}
          />
        ) : (
          <Cover script={script} small />
        )}
        <span className="cropper-ratio">A4</span>
      </div>

      {value && (
        <label className="cropper-zoom">
          <span>Zoom</span>
          <input
            type="range"
            min="1"
            max="4"
            step="0.01"
            value={value.zoom}
            onChange={(e) => onChange({ ...value, zoom: Number(e.target.value), existing: false })}
          />
        </label>
      )}

      <div className="cropper-actions">
        <button type="button" className="btn btn-sm" onClick={() => fileRef.current?.click()}>
          {value ? "Replace Image" : "Upload Cover"}
        </button>
        {value && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => onChange(null)}>
            Remove
          </button>
        )}
      </div>
      {error && <p className="cropper-hint">{error}</p>}
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
  );
}
