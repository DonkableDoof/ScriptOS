// DEV ONLY. A reference script that uses every element and every kind of
// formatting ScriptOS has, each one introduced by a note saying what it is and how
// to make it. Home's Import menu offers it while running from the dev server; it
// is left out of release builds.
//
// When an element type is added to TYPES in lib/script.js, add it here too. The
// template ends with a warning note naming any type it doesn't show yet.

import { TYPES, emptyBlock } from "../lib/script";
import { COLORS } from "../lib/colors";

const hex = (name) => COLORS.find((c) => c.name === name)?.hex;

export function templateScript() {
  const blocks = [];
  const add = (type, html = "", extra = {}) => blocks.push({ ...emptyBlock(type, html), ...extra });
  const note = (html) => add("note", html);

  note("<b>ScriptOS template.</b> Every element and every kind of formatting, each introduced by a note like this one. Notes are for you: they never print or export unless Settings says so. Make one with <b>Ctrl+9</b>, or type <b>[[</b> at the start of a line.");

  // ── headings ──
  note("<b>Act Heading</b>: an act break, centred and underlined, and listed in the outline above the scenes it holds. Ctrl+Shift+1, or <b>/act</b>. It suggests the next act (and END OF ACT, TEASER, COLD OPEN…); Tab takes the suggestion. Enter goes on to a Scene Heading.");
  add("act", "ACT ONE");
  note("<b>Heading 1</b>: a general heading for your own structure. Ctrl+Shift+2, or type <b>#</b> and a space.");
  add("heading", "Part One: Homecoming");
  note("<b>Heading 2</b> marks a sequence. Ctrl+Shift+3, or type <b>##</b> and a space.");
  add("sequence", "The Diner");
  note("<b>Heading 3</b> marks a beat inside a sequence. Ctrl+Shift+4, or type <b>###</b> and a space.");
  add("beat", "Rosa sees him first");

  // ── a scene ──
  note("<b>Scene Heading</b> (slugline). Ctrl+1, or start an Action line with <b>INT.</b> or <b>EXT.</b>, which turns it into one. Suggestions offer locations you've used and, after “ - ”, the time of day. Enter goes on to Action.");
  add("scene", "INT. ALL-NIGHT DINER - NIGHT");
  note("<b>Action</b>: what we see. Ctrl+2. Enter on an empty Action line turns it into a Character line.");
  add("action", "Rain hammers the windows. A neon sign buzzes <i>OPEN</i> in red. ROSA (40s) wipes the same patch of counter for the third time.");
  note("<b>Shot</b>: a camera direction. Ctrl+8, or type <b>!!</b> and a space.");
  add("shot", "Close on the door");
  add("action", "The bell above it rings. DEV (40s), soaked, steps inside.");

  note("<b>Character</b>: who speaks. Ctrl+3, or type <b>@</b>. Names you've used come up as you type: press Tab to take the faint suggestion. Enter goes on to Dialogue. Give a character a colour from the dot beside their name in the outline, and it runs through everything they say.");
  add("character", "ROSA");
  note("<b>Parenthetical</b>: how a line is said. Ctrl+4, or type <b>(</b> on a dialogue line. The brackets are added for you.");
  add("parenthetical", "not looking up");
  note("<b>Dialogue</b>: what they say. Ctrl+5. Enter goes on to the next Character.");
  add("dialogue", "We're closed.");
  note("<b>Subtext</b>: what they really mean. Ctrl+6, or type <b>-#</b> and a space. Private, like notes.");
  add("subtext", "Please don't leave again.");
  add("character", "DEV");
  add("dialogue", "Sign says open.");
  add("character", "ROSA");
  add("dialogue", "Sign's been lying since <b>1998</b>.");

  // ── inline formatting ──
  note("<b>Inline formatting</b> works in any element. Ctrl+B, Ctrl+I, Ctrl+U and Ctrl+Shift+X, the bar that appears over highlighted text, or as you type: <b>**bold**</b>, <b>*italic*</b>, <b>_underline_</b>, <b>~~strike~~</b>.");
  add("action", "He sets down a <b>bold</b> envelope, an <i>italic</i> sigh, an <u>underlined</u> warning and a <s>struck-out</s> excuse.");

  // ── colours ──
  note("<b>Colours</b>. Colour a whole line with <b>Alt+1…9</b> (1 = default), the handle menu, or <b>/</b> and the colour's name. Highlight some text first to colour just those words. <b>/New Colour…</b> or the <b>+</b> in any colour picker makes a named colour of your own; Settings lists them.");
  add("action", "This whole line is blue.", { color: hex("Blue") });
  add("action", `Only <span style="color: ${hex("Orange")};">these words</span> are orange, and <span style="color: ${hex("Purple")};">these</span> purple.`);
  add("action", "A custom colour looks like this one.", { color: "#3fb8a8" });

  // ── the rest ──
  note("<b>Lyrics</b>: sung lines, shown and printed between ♪ notes (they aren't part of the text). Ctrl+Shift+6, or type <b>~</b>.");
  add("character", "DEV");
  add("lyrics", "Neon light, neon light, leave it on for me tonight");
  note("<b>Transition</b>. Ctrl+7, or type <b>&gt;</b> and a space. Typing something like “cut to:” on its own Action line turns it into one when you press Enter.");
  add("transition", "Smash cut to:");
  add("scene", "EXT. DINER PARKING LOT - CONTINUOUS");
  add("action", "The sign flickers out.");
  note("<b>Centered</b> text, for title cards and THE END. Ctrl+Shift+5, or type <b>&gt;&lt;</b>.");
  add("centered", "Twenty years earlier");
  add("act", "END OF ACT ONE");
  note("<b>Page Break</b>: starts a new printed page. Ctrl+Shift+7, or type <b>---</b> on an empty line.");
  add("pagebreak");
  add("act", "ACT TWO");
  add("scene", "INT. DINER - DAY (1998)");
  add("action", "The same counter, brand new. A younger Rosa laughs at something we don't hear.");
  add("centered", "THE END");

  // ── using it ──
  note("<b>Working with lines.</b> Drag across lines (or Shift+arrows) to highlight text over several of them. Drag in the space around the page to box-select whole lines. <b>Alt+↑/↓</b> moves lines, <b>Ctrl+D</b> duplicates, Tab cycles a line's element type, and Ctrl+A twice selects everything. <b>Ctrl+scroll</b> (or Ctrl+= / Ctrl+-) zooms the page; Ctrl+0 or the % in the status bar puts it back to 100%.");

  const shown = new Set(blocks.map((b) => b.type));
  const missing = TYPES.filter((t) => !shown.has(t.key)).map((t) => t.label);
  if (missing.length) note(`<b>Template out of date:</b> it doesn't show ${missing.join(", ")} yet. Add them in src/dev/templateScript.js.`);

  return {
    title: "Formatting Template",
    format: "movie",
    author: "ScriptOS",
    logline: "Every element and every kind of formatting in one place, for checking how they look and behave.",
    cast: { ROSA: { color: hex("Pink") }, DEV: { color: hex("Green") } },
    blocks,
  };
}
