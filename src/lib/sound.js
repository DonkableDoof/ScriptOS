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
  // typewriter: a key strike, a carriage return, and its little bell
  key: () => {
    snap({ freq: 1800 + Math.random() * 900, gain: 0.32, dur: 0.018, q: 6 });
    thock({ freq: 120 + Math.random() * 40, to: 50, dur: 0.04, gain: 0.32 });
  },
  ret: () => {
    sweep({ from: 1400, to: 500, dur: 0.18, gain: 0.22 });
    thock({ freq: 140, to: 50, dur: 0.07, gain: 0.4, delay: 0.16 });
  },
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
