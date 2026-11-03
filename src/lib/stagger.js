const SELECTOR = [
  ".topbar .brand",
  ".topbar-actions .btn",
  ".stat-tile",
  ".section-head > *",
  ".scard",
  ".panel",
  ".setting",
  ".settings-group-title",
  ".scheme",
  ".sidebar-section",
  ".format-bar",
  ".page",
].join(", ");

const STEP = 55;
const CAP = 1400;

// Things arrive one after another rather than all at once.
export function runStagger(root = document) {
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
  const nodes = root.querySelectorAll(SELECTOR);
  nodes.forEach((el, i) => {
    const delay = Math.min(i * STEP, CAP);
    el.style.animation = "none";
    el.style.animationDelay = `${delay}ms`;
    void el.offsetWidth;
    el.style.animation = "";
    el.classList.add("pop-in");

    // Strip the entrance once it has played, so later transforms (hover lifts) are
    // not fighting a keyframe that also drives transform.
    const cleanup = () => {
      el.classList.remove("pop-in");
      el.style.animationDelay = "";
      el.removeEventListener("animationend", cleanup);
    };
    el.addEventListener("animationend", cleanup);
    setTimeout(cleanup, delay + 900);
  });
}
