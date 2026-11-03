import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

export default function Modal({ title, onClose, onSubmit, submitLabel = "Create", submitDisabled = false, submitHint, wide, children }) {
  const ref = useRef(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    (
      ref.current?.querySelector("[data-autofocus]") ||
      ref.current?.querySelector("input:not([type=file]):not([type=range]), textarea, select")
    )?.focus();
    const onKey = (e) => {
      if (e.key === "Escape") closeRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return createPortal(
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className={wide ? "modal modal-wide" : "modal"}
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="modal-head">
          <span className="modal-title">{title}</span>
          <button className="btn-icon" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div
          className="modal-body"
          onKeyDown={(e) => {
            if (e.key === "Enter" && e.target.tagName !== "TEXTAREA" && !submitDisabled) onSubmit();
          }}
        >
          {children}
        </div>
        <div className="modal-foot">
          <button className="btn btn-ghost btn-cancel" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            onClick={onSubmit}
            disabled={submitDisabled}
            title={submitDisabled ? submitHint || "" : ""}
          >
            {submitLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
