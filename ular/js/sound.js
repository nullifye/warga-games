// Ular's sounds, synthesised like the other games' (no files to download): a chirp to go, a soft
// tick on each turn, a chomp that climbs in pitch as the snake grows, a crash, a fanfare for a
// full board, two soft notes for Rehat, and a sparkle for a new best score.
let ctx = null;
let muted = false;

export const setMuted = (m) => { muted = m; };

/** Creates or wakes the audio context; call from a tap or key press (browsers require one). */
export function unlockSound() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (AC) ctx = new AC();
  }
  if (ctx?.state === 'suspended') ctx.resume();
}

/** One note: `notes` is [[time, frequency, 'ramp'?], …] from its start; it fades out over `length`. */
function tone(wave, notes, gain, length, delay = 0) {
  const now = ctx.currentTime + delay;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = wave;
  for (const [t, f, how] of notes) {
    if (how === 'ramp') osc.frequency.exponentialRampToValueAtTime(f, now + t);
    else osc.frequency.setValueAtTime(f, now + t);
  }
  g.gain.setValueAtTime(gain, now);
  g.gain.exponentialRampToValueAtTime(0.001, now + length);
  osc.connect(g).connect(ctx.destination);
  osc.start(now);
  osc.stop(now + length + 0.02);
}

/**
 * go: the snake sets off (or Sambung) · turn: a turn is taken · eat (`n` = foods eaten so far):
 * a food is eaten · crash: it hits a wall or itself · won: it fills the board · rest: Rehat ·
 * best: a new best score, on the result.
 */
export function play(name, n = 0) {
  if (muted || !ctx || ctx.state !== 'running') return;
  if (name === 'go') {
    tone('triangle', [[0, 440]], 0.1, 0.08);
    tone('triangle', [[0, 660]], 0.1, 0.12, 0.07);
  }
  // Barely there: a turn can come several times a second.
  if (name === 'turn') tone('triangle', [[0, 620], [0.025, 520, 'ramp']], 0.035, 0.03);
  if (name === 'eat') {
    // About an octave higher over the first 40 foods, as the snake speeds up.
    const f = 520 * 2 ** (Math.min(n, 40) / 40);
    tone('square', [[0, f], [0.05, f * 1.6, 'ramp']], 0.07, 0.07);
    tone('sine', [[0, f * 2]], 0.06, 0.09, 0.04);
  }
  if (name === 'crash') {
    tone('square', [[0, 240], [0.28, 70, 'ramp']], 0.09, 0.32);
    tone('sine', [[0, 120], [0.2, 45, 'ramp']], 0.3, 0.24);
  }
  if (name === 'won') [523, 659, 784, 1047, 1319].forEach((f, i) => tone('square', [[0, f]], 0.07, i === 4 ? 0.5 : 0.14, i * 0.1));
  if (name === 'rest') {
    tone('triangle', [[0, 520]], 0.08, 0.1);
    tone('triangle', [[0, 390]], 0.08, 0.14, 0.09);
  }
  if (name === 'best') [784, 988, 1175, 1568].forEach((f, i) => tone('sine', [[0, f]], 0.09, i === 3 ? 0.4 : 0.12, i * 0.08));
}
