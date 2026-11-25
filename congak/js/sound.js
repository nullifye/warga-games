// Congak Matematik's sounds, synthesised (no files to download): chalk writing on the board, a
// tap as you answer, a chime when right (higher with the combo), a low buzz when wrong, a chalk
// stick snapping, the duster wiping, and the end of the round.
let ctx = null;
let muted = false;

export const setMuted = (m) => { muted = m; };

/** Creates or wakes the audio context; call from a tap (browsers require one). */
export function unlockSound() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (AC) ctx = new AC();
  }
  if (ctx?.state === 'suspended') ctx.resume();
}

function tone(type, from, to, gain, length, delay = 0) {
  const now = ctx.currentTime + delay;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(from, now);
  if (to !== from) osc.frequency.exponentialRampToValueAtTime(to, now + length * 0.9);
  g.gain.setValueAtTime(gain, now);
  g.gain.exponentialRampToValueAtTime(0.001, now + length);
  osc.connect(g).connect(ctx.destination);
  osc.start(now);
  osc.stop(now + length + 0.02);
}

/** Filtered noise: chalk on slate, a snap, the duster. `shape` (0–1 → 0–1) is the loudness over time. */
function noise({ freq, q = 1, gain, length, type = 'bandpass', delay = 0, shape = (t) => Math.sin(t * Math.PI) }) {
  const n = Math.max(1, Math.floor(ctx.sampleRate * length));
  const buf = ctx.createBuffer(1, n, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * shape(i / n);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  const g = ctx.createGain();
  g.gain.value = gain;
  src.connect(f).connect(g).connect(ctx.destination);
  src.start(ctx.currentTime + delay);
}

/**
 * write (`n` = characters) · tap · right (`n` = streak) · wrong · snap · wipe · tick (`n` = seconds left) · end
 */
export function play(name, n = 1) {
  if (muted || !ctx || ctx.state !== 'running') return;
  if (name === 'write') {
    // A short grainy scratch for each stroke, a little apart.
    for (let i = 0; i < Math.min(n, 8); i++) noise({ freq: 2300 + Math.random() * 600, q: 3.5, gain: 0.12, length: 0.06, delay: i * 0.06 });
  }
  if (name === 'tap') tone('triangle', 950, 280, 0.16, 0.045);
  if (name === 'right') {
    const f = Math.min(523.25 + n * 25, 880);
    tone('sine', f, f, 0.16, 0.18);
    tone('sine', f * 1.25, f * 1.25, 0.16, 0.18, 0.06);
  }
  if (name === 'wrong') tone('sawtooth', 190, 115, 0.12, 0.25);
  if (name === 'snap') {
    noise({ freq: 3200, q: 0.8, gain: 0.5, length: 0.05, type: 'highpass', shape: (t) => (1 - t) ** 3 });
    tone('triangle', 1400, 600, 0.08, 0.05);
  }
  if (name === 'wipe') noise({ freq: 900, q: 0.6, gain: 0.18, length: 0.32, type: 'lowpass' });
  // The clock's last seconds: a short wooden tick, higher on the very last ones.
  if (name === 'tick') tone('square', n <= 2 ? 1320 : 990, n <= 2 ? 1320 : 990, 0.05, 0.05);
  if (name === 'end') [523.25, 659.25, 783.99].forEach((f, i) => tone('triangle', f, f, 0.22, 0.3, i * 0.12));
}
