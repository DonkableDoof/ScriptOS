// Every sound is synthesised on the fly, so there are no audio files to ship.
let ctx = null;
let volume = 0.6;
let typewriter = false;
let bell = false;

const ensure = () => {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  if (ctx.state === "suspended") ctx.resume();
  return ctx;
};

const noiseBuffer = (ac, dur, curve = 2) => {
  const frames = Math.max(1, Math.floor(ac.sampleRate * dur));
  const buffer = ac.createBuffer(1, frames, ac.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < frames; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / frames) ** curve;
  return buffer;
};

const tone = ({ freq, to, type = "sine", dur = 0.09, gain = 0.18, delay = 0 }) => {
  const ac = ensure();
  if (!ac || volume <= 0) return;
  const t0 = ac.currentTime + delay;
  const osc = ac.createOscillator();
  const amp = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (to) osc.frequency.exponentialRampToValueAtTime(to, t0 + dur);
  amp.gain.setValueAtTime(0.0001, t0);
  amp.gain.exponentialRampToValueAtTime(gain * volume, t0 + 0.012);
  amp.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(amp).connect(ac.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
};

const snap = ({ freq = 2600, q = 7, dur = 0.028, gain = 0.5, delay = 0 } = {}) => {
  const ac = ensure();
  if (!ac || volume <= 0) return;
  const t0 = ac.currentTime + delay;
  const src = ac.createBufferSource();
  const band = ac.createBiquadFilter();
  const amp = ac.createGain();
  src.buffer = noiseBuffer(ac, dur, 3);
  band.type = "bandpass";
  band.frequency.value = freq;
  band.Q.value = q;
  amp.gain.value = gain * volume * 0.5;
  src.connect(band).connect(amp).connect(ac.destination);
  src.start(t0);
};

const thock = ({ freq = 190, to = 58, dur = 0.075, gain = 0.5, delay = 0, type = "sine" } = {}) => {
  const ac = ensure();
  if (!ac || volume <= 0) return;
  const t0 = ac.currentTime + delay;
  const osc = ac.createOscillator();
  const amp = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  osc.frequency.exponentialRampToValueAtTime(to, t0 + dur);
  amp.gain.setValueAtTime(gain * volume * 0.45, t0);
  amp.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(amp).connect(ac.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
};

const sweep = ({ from = 700, to = 2400, dur = 0.24, gain = 0.34, delay = 0, q = 1.4 } = {}) => {
  const ac = ensure();
  if (!ac || volume <= 0) return;
  const t0 = ac.currentTime + delay;
  const src = ac.createBufferSource();
  const band = ac.createBiquadFilter();
  const amp = ac.createGain();
  src.buffer = noiseBuffer(ac, dur, 1.1);
  band.type = "bandpass";
  band.Q.value = q;
  band.frequency.setValueAtTime(from, t0);
  band.frequency.exponentialRampToValueAtTime(to, t0 + dur);
  amp.gain.setValueAtTime(0.0001, t0);
  amp.gain.exponentialRampToValueAtTime(gain * volume * 0.3, t0 + dur * 0.35);
  amp.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(band).connect(amp).connect(ac.destination);
  src.start(t0);
};

// A filtered burst of noise: the raw material of a key switch.
const burst = ({ dur, curve = 3, type = "bandpass", freq, q = 1, gain, delay = 0 }) => {
  const ac = ensure();
  if (!ac || volume <= 0) return;
  const t0 = ac.currentTime + delay;
  const src = ac.createBufferSource();
  const filter = ac.createBiquadFilter();
  const amp = ac.createGain();
  src.buffer = noiseBuffer(ac, dur, curve);
  filter.type = type;
  filter.frequency.value = freq;
  filter.Q.value = q;
  amp.gain.value = gain * volume;
  src.connect(filter).connect(amp).connect(ac.destination);
  src.start(t0);
};

// One press of a mechanical keyboard switch: the sharp click of the stem, the
// plastic clack of the keycap bottoming out, and the low knock of the case under
// it. Every press is pitched a little differently, the way real keys never quite
// sound the same twice. `size` > 1 is a bigger key (space, enter) with a longer,
// deeper sound and a stabiliser rattle.
const keyPress = ({ size = 1, gain = 1, up = false } = {}) => {
  const vary = 1 + (Math.random() - 0.5) * 0.14;
  // pitched up an octave: smaller, crisper switches
  const pitch = (2 * vary) / Math.sqrt(size);
  if (up) {
    // the key springing back: a quieter, higher tick
    burst({ dur: 0.012, curve: 5, freq: 5200 * pitch, q: 2.2, gain: 0.22 * gain });
    burst({ dur: 0.02, curve: 4, freq: 1700 * pitch, q: 1.4, gain: 0.12 * gain });
    return;
  }
  burst({ dur: 0.01, curve: 5, freq: 4300 * pitch, q: 1.8, gain: 0.55 * gain });
  burst({ dur: 0.03 * size, curve: 3, freq: 1250 * pitch, q: 1.3, gain: 0.5 * gain });
  burst({ dur: 0.045 * size, curve: 2.5, type: "lowpass", freq: 420 * pitch, q: 0.8, gain: 0.7 * gain });
  thock({ freq: 230 * pitch, to: 120 * pitch, dur: 0.035 * size, gain: 0.35 * gain, type: "triangle" });
  if (size > 1) burst({ dur: 0.018, curve: 4, freq: 2600 * pitch, q: 2.5, gain: 0.18 * gain, delay: 0.011 });
};

const SOUNDS = {
  click: () => {
    snap({ freq: 2700, gain: 0.55 });
    thock({ freq: 200, to: 62, gain: 0.5 });
  },
  tap: () => {
    snap({ freq: 3100, gain: 0.3, dur: 0.02 });
    thock({ freq: 165, to: 70, dur: 0.05, gain: 0.3 });
  },
  tick: () => snap({ freq: 3600, gain: 0.24, dur: 0.014, q: 10 }),
  nav: () => sweep({ from: 620, to: 2600, dur: 0.26, gain: 0.32 }),
  back: () => sweep({ from: 2400, to: 640, dur: 0.24, gain: 0.28 }),
  open: () => sweep({ from: 900, to: 2200, dur: 0.16, gain: 0.26 }),
  close: () => sweep({ from: 2000, to: 800, dur: 0.14, gain: 0.24 }),
  add: () => {
    snap({ freq: 2900, gain: 0.4, dur: 0.022 });
    thock({ freq: 240, to: 90, dur: 0.06, gain: 0.36 });
  },
  remove: () => {
    sweep({ from: 2200, to: 500, dur: 0.2, gain: 0.3 });
    thock({ freq: 150, to: 52, dur: 0.1, gain: 0.45, delay: 0.16, type: "triangle" });
  },
  error: () => tone({ freq: 220, to: 160, type: "square", dur: 0.16, gain: 0.08 }),
  complete: () => {
    [523, 659, 784].forEach((f, i) =>
      tone({ freq: f, type: "triangle", dur: 0.16, gain: 0.14, delay: i * 0.07 })
    );
  },
  // typing: mechanical keyboard switches, down and up
  key: () => keyPress(),
  keyUp: () => keyPress({ up: true }),
  space: () => keyPress({ size: 1.9, gain: 0.95 }),
  ret: () => keyPress({ size: 1.6 }),
  backspace: () => keyPress({ size: 1.3, gain: 0.9 }),
  bigUp: () => keyPress({ up: true, size: 1.6 }),
  // and the one typewriter left: the bell at the end of a line
  bell: () => tone({ freq: 2093, type: "sine", dur: 0.4, gain: 0.05, delay: 0.02 }),
};

export const sfx = {
  play(name) {
    try {
      SOUNDS[name]?.();
    } catch {
      /* sound is decoration; never let it break anything */
    }
  },
  // typing sounds and the bell are switched separately
  type(name) {
    if (name === "bell" ? bell : typewriter) sfx.play(name);
  },
  setVolume(v) {
    volume = Math.max(0, Math.min(1, Number(v) || 0));
  },
  setTypewriter(on) {
    typewriter = Boolean(on);
  },
  setBell(on) {
    bell = Boolean(on);
  },
};
