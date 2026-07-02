// Tiny Web Audio synth — no sample files, no licensing. Each SFX is a short
// oscillator+gain envelope, so the whole "sound pack" is a few numbers.
//
// Browsers block audio until a user gesture, so the context is created lazily on
// the first play() and resumed on the first click/keydown (see main.ts).

type SfxKind = 'place' | 'sell' | 'upgrade' | 'shoot' | 'explosion' | 'nuke' | 'win' | 'lose';

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let muted = false;

function ensureCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!ctx) {
    const AC = window.AudioContext ?? (window as any).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.35;
    master.connect(ctx.destination);
  }
  return ctx;
}

// One oscillator sweep with an attack/decay envelope.
function tone(
  freq: number, endFreq: number, dur: number,
  type: OscillatorType, vol: number, delay = 0,
): void {
  if (!ctx || !master) return;
  const t0 = ctx.currentTime + delay;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (endFreq !== freq) osc.frequency.exponentialRampToValueAtTime(Math.max(1, endFreq), t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(vol, t0 + Math.min(0.01, dur * 0.3));
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(master);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

// Short burst of filtered noise for explosions.
function noise(dur: number, vol: number, freq: number): void {
  if (!ctx || !master) return;
  const t0 = ctx.currentTime;
  const frames = Math.ceil(ctx.sampleRate * dur);
  const buf = ctx.createBuffer(1, frames, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < frames; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / frames);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.setValueAtTime(freq, t0);
  lp.frequency.exponentialRampToValueAtTime(freq * 0.3, t0 + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(vol, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(lp).connect(g).connect(master);
  src.start(t0);
  src.stop(t0 + dur + 0.02);
}

export function play(kind: SfxKind): void {
  if (muted || !ensureCtx()) return;
  switch (kind) {
    case 'shoot':     tone(520, 380, 0.05, 'square', 0.12); break;
    case 'place':     tone(300, 620, 0.10, 'triangle', 0.5); break;
    case 'sell':      tone(500, 200, 0.12, 'sawtooth', 0.4); break;
    case 'upgrade':   tone(500, 900, 0.10, 'triangle', 0.5); tone(760, 1200, 0.10, 'triangle', 0.35, 0.09); break;
    case 'explosion': noise(0.28, 0.7, 900); tone(160, 50, 0.22, 'sawtooth', 0.4); break;
    case 'nuke':      noise(0.6, 0.9, 700); tone(120, 30, 0.55, 'sawtooth', 0.6); break;
    case 'win':       [523, 659, 784, 1046].forEach((f, i) => tone(f, f, 0.16, 'triangle', 0.5, i * 0.13)); break;
    case 'lose':      [440, 349, 262].forEach((f, i) => tone(f, f, 0.24, 'triangle', 0.45, i * 0.16)); break;
  }
}

export function setMuted(m: boolean): void { muted = m; }
export function isMuted(): boolean { return muted; }

// Some browsers create the context in a suspended state; resume it on the first
// user gesture so the first real SFX isn't swallowed.
export function resumeAudio(): void {
  const c = ensureCtx();
  if (c && c.state === 'suspended') c.resume();
}
