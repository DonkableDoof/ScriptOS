import { createPortal } from "react-dom";
import { episodeLabel, isTv, plainText } from "../lib/script";

// Industry layout in real inches, only ever visible on paper (or in a PDF). The
// screen editor approximates this; print gets it exact.
const html = (h) => ({ __html: h || "" });
const isBlank = (b) => !plainText(b.html).trim();

export default function PrintView({ script, settings }) {
  const blocks = (script.blocks || []).filter((b) => {
    if (b.type === "note" && !settings.exportNotes) return false;
    if (b.type === "subtext" && !settings.exportSubtext) return false;
    return b.type === "pagebreak" || !isBlank(b);
  });
  let scene = 0;

  return createPortal(
    <div className="print-root" aria-hidden="true">
      <section className="print-title">
        <div className="print-title-main">
          <h1>{script.title || "Untitled Script"}</h1>
          {isTv(script.format) && script.show && <p>{script.show}</p>}
          {episodeLabel(script) && <p>{episodeLabel(script)}</p>}
          <p className="print-credit">Written by</p>
          <p>{script.author || ""}</p>
        </div>
        <div className="print-title-foot">
          <span>{script.contact}</span>
          <span>{script.draft}</span>
        </div>
      </section>
      <section className="print-body" data-scene-numbers={settings.sceneNumbers}>
        {blocks.map((b) => {
          if (b.type === "pagebreak") return <div key={b.id} className="p-break" />;
          const n = b.type === "scene" ? ++scene : null;
          return (
            <div key={b.id} className={`p-el p-${b.type}`} data-n={n ?? undefined}>
              <span dangerouslySetInnerHTML={html(b.html)} />
            </div>
          );
        })}
      </section>
    </div>,
    document.body
  );
}
