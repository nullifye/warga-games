// Pemadam's sounds, synthesised (no files to download): the snap of a flick, the soft thud of
// rubber landing on wood, the squeak of a skid, and short cues for a point, a fall and the result.
let ctx = null;
let muted = false;
let noise = null;
const lastAt = {};

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

/** A short burst of filtered noise: the body of a thud or a snap. */
function burst(freq, q, gain, length) {
  if (!noise) {
    noise = ctx.createBuffer(1, ctx.sampleRate * 0.3, ctx.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const now = ctx.currentTime;
  const src = ctx.createBufferSource();
  src.buffer = noise;
  const f = ctx.createBiquadFilter();
  f.type = 'bandpass';
  f.frequency.value = freq;
  f.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, now);
  g.gain.exponentialRampToValueAtTime(0.001, now + length);
  src.connect(f).connect(g).connect(ctx.destination);
  src.start(now);
  src.stop(now + length + 0.02);
}

/** Not more often than every `ms` for one sound, so a cluster of contacts sounds as one. */
function throttle(name, ms) {
  const now = performance.now();
  if (now - (lastAt[name] ?? 0) < ms) return true;
  lastAt[name] = now;
  return false;
}

/**
 * flick (`n` = power 0–1) · thud (`n` = how hard it landed) · squeak (`n` = skid speed) ·
 * point · out · turn · draw · win · lose
 */
export function play(name, n = 1) {
  if (muted || !ctx || ctx.state !== 'running') return;
  if (name === 'flick') {
    burst(2400, 1.4, 0.25 + n * 0.25, 0.05); // the fingernail's snap
    tone('triangle', 420 + n * 160, 140, 0.18, 0.06);
  }
  if (name === 'thud' && !throttle('thud', 60)) {
    const k = Math.min(1, n / 8);
    tone('sine', 120 + k * 50, 58, 0.25 + k * 0.45, 0.13); // rubber on wood: low and short
    burst(380, 1.1, 0.12 + k * 0.3, 0.07);
  }
  if (name === 'squeak' && !throttle('squeak', 220)) {
    const k = Math.min(1, n / 6);
    // A rubbery chirp: a quick bend up and back with a little wobble.
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    const lfo = ctx.createOscillator();
    const depth = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(820 + k * 300, now);
    osc.frequency.linearRampToValueAtTime(1250 + k * 400, now + 0.05);
    osc.frequency.linearRampToValueAtTime(980, now + 0.12);
    lfo.frequency.value = 38;
    depth.gain.value = 60;
    lfo.connect(depth).connect(osc.frequency);
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 1300;
    f.Q.value = 3;
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(0.05 + k * 0.07, now + 0.02);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.14);
    osc.connect(f).connect(g).connect(ctx.destination);
    osc.start(now);
    lfo.start(now);
    osc.stop(now + 0.16);
    lfo.stop(now + 0.16);
  }
  if (name === 'point') [659.25, 880, 1174.66].forEach((f, i) => tone('triangle', f, f, 0.26, 0.22, i * 0.09));
  if (name === 'out') tone('sine', 360, 90, 0.3, 0.4);
  if (name === 'turn') tone('sine', 660, 660, 0.08, 0.09);
  if (name === 'draw') tone('triangle', 440, 440, 0.14, 0.2);
  if (name === 'win') [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone('triangle', f, f, 0.3, 0.35, i * 0.11));
  if (name === 'lose') [392, 330, 262, 196].forEach((f, i) => tone('triangle', f, f, 0.14, 0.2, i * 0.13));
}
