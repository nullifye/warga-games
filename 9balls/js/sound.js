// 9-Ball's sounds, synthesised (no files to download): the cue's strike, balls clicking, the
// cushion's thud, a ball dropping into a pocket, and short cues for a foul and the result.
let ctx = null;
let muted = false;
let lastClick = 0;

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

/**
 * cue (`n` = power 0–1) · ball (`n` = impact speed) · rail (`n` = speed) · pocket · foul · win · lose ·
 * flick, clink (`n` = how hard), rattle: the coin toss
 */
export function play(name, n = 1) {
  if (muted || !ctx || ctx.state !== 'running') return;
  if (name === 'cue') tone('triangle', 210 + n * 150, 52, Math.min(1, Math.max(0.18, n)) * 0.6, 0.095);
  if (name === 'ball' && n >= 0.25) {
    const now = performance.now();
    if (now - lastClick < 25) return; // a cluster of hits sounds as one click
    lastClick = now;
    tone('sine', 1480 + Math.random() * 240, 410, Math.min(1, n / 18) * 0.65, 0.04);
  }
  if (name === 'rail' && n >= 0.4) tone('sine', 135, 46, Math.min(1, n / 18) * 0.4, 0.075);
  if (name === 'pocket') tone('sine', 185, 60, 0.55, 0.24);
  if (name === 'foul') tone('square', 200, 140, 0.06, 0.18);
  // The coin: a bright metallic ring when flicked (inharmonic partials, like struck metal), a
  // clink on each landing (`n` = how hard, 0–1), and small clicks as it rattles flat.
  if (name === 'flick') [2630, 3980, 5420].forEach((f, i) => tone('sine', f, f * 0.995, 0.09 / (i + 1), 0.5 - i * 0.1));
  if (name === 'clink') [1850, 2960, 4400].forEach((f, i) => tone('sine', f, f * 0.98, (0.12 * n) / (i + 1), 0.16 + 0.1 * n));
  if (name === 'rattle') tone('triangle', 2200 + Math.random() * 700, 1800, 0.03 * n, 0.03);
  if (name === 'win') [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone('triangle', f, f, 0.3, 0.35, i * 0.11));
  if (name === 'lose') [392, 330, 262, 196].forEach((f, i) => tone('triangle', f, f, 0.14, 0.2, i * 0.13));
}
