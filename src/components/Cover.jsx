import { FORMAT_BY_KEY, episodeLabel, isTv } from "../lib/script";

// A script's cover: the A4 image if it has one, otherwise a poster generated from
// its title and a hue picked when it was created.
export default function Cover({ script, small = false }) {
  if (script.cover) {
    return (
      <div className="cover">
        <img src={script.cover} alt="" draggable={false} />
      </div>
    );
  }
  const hue = script.coverHue ?? 30;
  const kicker = isTv(script.format) ? script.show || FORMAT_BY_KEY[script.format]?.label : FORMAT_BY_KEY[script.format]?.label;
  return (
    <div
      className="cover cover-generated"
      data-small={small}
      style={{
        "--h1": `hsl(${hue}, 46%, 24%)`,
        "--h2": `hsl(${(hue + 38) % 360}, 52%, 9%)`,
        "--glow": `hsla(${(hue + 340) % 360}, 80%, 62%, 0.35)`,
      }}
    >
      <div className="cover-frame">
        <span className="cover-kicker">{kicker}</span>
        <span className="cover-title">{script.title || "Untitled Script"}</span>
        {episodeLabel(script) && <span className="cover-ep">{episodeLabel(script)}</span>}
        {script.author && <span className="cover-author">by {script.author}</span>}
      </div>
    </div>
  );
}
