// Sonidos de interfaz: presets sintetizados con WebAudio (0 bytes de assets)
// o ficheros del tema. Latencia mínima: el contexto se crea una vez y los
// buffers de fichero se decodifican una sola vez.

export type SoundName = "move" | "select" | "back" | "launch" | "error" | "open";

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let volume = 0.6;
let preset = "soft";
let files: Partial<Record<SoundName, string>> = {};
const buffers = new Map<string, Promise<AudioBuffer | null>>();
let lastMove = 0;

function audio(): AudioContext {
  if (!ctx) {
    ctx = new AudioContext({ latencyHint: "interactive" });
    master = ctx.createGain();
    master.connect(ctx.destination);
  }
  if (ctx.state === "suspended") void ctx.resume();
  master!.gain.value = volume;
  return ctx;
}

export function configureSounds(opts: { volume?: number; preset?: string; files?: Partial<Record<SoundName, string>> }) {
  if (opts.volume !== undefined) volume = opts.volume;
  if (opts.preset !== undefined) preset = opts.preset;
  if (opts.files !== undefined) files = opts.files;
}

interface ToneOpts {
  type?: OscillatorType;
  freq: number;
  to?: number;
  dur: number;
  gain?: number;
  at?: number;
  attack?: number;
}

function tone(c: AudioContext, o: ToneOpts) {
  const t = c.currentTime + (o.at ?? 0);
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = o.type ?? "sine";
  osc.frequency.setValueAtTime(o.freq, t);
  if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to, t + o.dur);
  const peak = o.gain ?? 0.15;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + (o.attack ?? 0.005));
  g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
  osc.connect(g).connect(master!);
  osc.start(t);
  osc.stop(t + o.dur + 0.02);
}

let noiseBuf: AudioBuffer | null = null;
function noise(c: AudioContext, o: { dur: number; freq: number; to?: number; q?: number; gain?: number; at?: number }) {
  if (!noiseBuf) {
    noiseBuf = c.createBuffer(1, c.sampleRate * 0.5, c.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const t = c.currentTime + (o.at ?? 0);
  const src = c.createBufferSource();
  src.buffer = noiseBuf;
  const f = c.createBiquadFilter();
  f.type = "bandpass";
  f.Q.value = o.q ?? 2;
  f.frequency.setValueAtTime(o.freq, t);
  if (o.to) f.frequency.exponentialRampToValueAtTime(o.to, t + o.dur);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(o.gain ?? 0.2, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
  src.connect(f).connect(g).connect(master!);
  src.start(t);
  src.stop(t + o.dur + 0.02);
}

type Synth = (c: AudioContext) => void;

const PRESETS: Record<string, Partial<Record<SoundName, Synth>>> = {
  soft: {
    move: (c) => tone(c, { freq: 1200, to: 1100, dur: 0.045, gain: 0.05 }),
    select: (c) => tone(c, { type: "triangle", freq: 660, to: 990, dur: 0.09, gain: 0.12 }),
    back: (c) => tone(c, { type: "triangle", freq: 700, to: 440, dur: 0.09, gain: 0.1 }),
    open: (c) => tone(c, { freq: 440, to: 660, dur: 0.12, gain: 0.08 }),
    launch: (c) => [523, 659, 784, 1047].forEach((f, i) => tone(c, { freq: f, dur: 0.18, gain: 0.1, at: i * 0.07 })),
    error: (c) => tone(c, { type: "square", freq: 196, dur: 0.18, gain: 0.05 }),
  },
  ps: {
    move: (c) => {
      tone(c, { freq: 1318, dur: 0.07, gain: 0.05 });
      tone(c, { freq: 2637, dur: 0.05, gain: 0.015 });
    },
    select: (c) => {
      tone(c, { freq: 988, dur: 0.22, gain: 0.1 });
      tone(c, { freq: 1480, dur: 0.26, gain: 0.07, at: 0.03 });
    },
    back: (c) => tone(c, { freq: 740, to: 554, dur: 0.14, gain: 0.08 }),
    open: (c) => tone(c, { freq: 880, to: 1318, dur: 0.16, gain: 0.06 }),
    launch: (c) => [659, 988, 1319, 1976].forEach((f, i) => tone(c, { freq: f, dur: 0.5, gain: 0.06, at: i * 0.06, attack: 0.02 })),
    error: (c) => tone(c, { freq: 330, to: 250, dur: 0.2, gain: 0.07 }),
  },
  xbox: {
    move: (c) => {
      noise(c, { freq: 3500, dur: 0.025, gain: 0.08, q: 4 });
      tone(c, { freq: 1500, dur: 0.02, gain: 0.03 });
    },
    select: (c) => {
      noise(c, { freq: 2500, dur: 0.03, gain: 0.08 });
      tone(c, { freq: 523, to: 1046, dur: 0.12, gain: 0.08 });
    },
    back: (c) => tone(c, { freq: 1046, to: 523, dur: 0.12, gain: 0.08 }),
    open: (c) => noise(c, { freq: 600, to: 3000, dur: 0.18, gain: 0.08, q: 1 }),
    launch: (c) => {
      noise(c, { freq: 400, to: 5000, dur: 0.45, gain: 0.12, q: 0.8 });
      tone(c, { freq: 392, to: 784, dur: 0.4, gain: 0.06, at: 0.05 });
    },
    error: (c) => tone(c, { type: "sawtooth", freq: 160, dur: 0.15, gain: 0.04 }),
  },
  switch: {
    move: (c) => tone(c, { type: "square", freq: 1800, dur: 0.012, gain: 0.04 }),
    select: (c) => {
      tone(c, { type: "square", freq: 2200, dur: 0.012, gain: 0.05 });
      tone(c, { type: "square", freq: 1600, dur: 0.012, gain: 0.05, at: 0.05 });
      tone(c, { freq: 880, dur: 0.1, gain: 0.05, at: 0.05 });
    },
    back: (c) => tone(c, { type: "square", freq: 1100, dur: 0.015, gain: 0.04 }),
    open: (c) => tone(c, { freq: 1200, to: 1600, dur: 0.08, gain: 0.05 }),
    launch: (c) => [784, 988, 1175, 1568].forEach((f, i) => tone(c, { freq: f, dur: 0.12, gain: 0.07, at: i * 0.08 })),
    error: (c) => tone(c, { type: "square", freq: 300, dur: 0.1, gain: 0.04 }),
  },
  retro: {
    move: (c) => tone(c, { type: "square", freq: 1320, dur: 0.035, gain: 0.04 }),
    select: (c) => {
      tone(c, { type: "square", freq: 660, dur: 0.05, gain: 0.05 });
      tone(c, { type: "square", freq: 1320, dur: 0.07, gain: 0.05, at: 0.05 });
    },
    back: (c) => {
      tone(c, { type: "square", freq: 880, dur: 0.05, gain: 0.05 });
      tone(c, { type: "square", freq: 440, dur: 0.07, gain: 0.05, at: 0.05 });
    },
    open: (c) => tone(c, { type: "square", freq: 523, to: 1046, dur: 0.1, gain: 0.04 }),
    launch: (c) => [523, 659, 784, 1047, 1319].forEach((f, i) => tone(c, { type: "square", freq: f, dur: 0.06, gain: 0.05, at: i * 0.05 })),
    error: (c) => noise(c, { freq: 800, dur: 0.2, gain: 0.1, q: 0.5 }),
  },
};

export const SOUND_PRESETS = [
  { value: "soft", label: "Suave" },
  { value: "ps", label: "Campanilla" },
  { value: "xbox", label: "Clic y barrido" },
  { value: "switch", label: "Clic" },
  { value: "retro", label: "8 bits" },
  { value: "none", label: "Sin sonidos" },
];

async function loadFile(url: string): Promise<AudioBuffer | null> {
  try {
    const res = await fetch(url);
    return await audio().decodeAudioData(await res.arrayBuffer());
  } catch {
    return null;
  }
}

export function playSound(name: SoundName) {
  if (volume <= 0 || preset === "none") return;
  // Evita ametralladora al mantener pulsada una dirección.
  if (name === "move") {
    const now = performance.now();
    if (now - lastMove < 45) return;
    lastMove = now;
  }
  const c = audio();
  const file = files[name];
  if (file) {
    if (!buffers.has(file)) buffers.set(file, loadFile(file));
    void buffers.get(file)!.then((buf) => {
      if (!buf) return PRESETS[preset]?.[name]?.(c);
      const src = c.createBufferSource();
      src.buffer = buf;
      src.connect(master!);
      src.start();
    });
    return;
  }
  (PRESETS[preset] ?? PRESETS.soft)[name]?.(c);
}
