// Jalan's sounds, synthesised like the other games' (no files to download): a boing to
// jump, a thump to land, a rumble when the road caves in, a horn for the lorry, a sad trombone
// for a death and a little fanfare at the house.
let ctx = null;
let muted = false;
let noise = null;

export const setMuted = (m) => { muted = m; };

/** Creates or wakes the audio context; call from a tap or key press (browsers require one). */
export function unlockSound() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (AC) ctx = new AC();
  }
  if (ctx?.state === 'suspended') ctx.resume();
}

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

function rumble(gain, length, freq) {
  if (!noise) {
    noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const now = ctx.currentTime;
  const src = ctx.createBufferSource();
  src.buffer = noise;
  const f = ctx.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.value = freq;
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, now);
  g.gain.exponentialRampToValueAtTime(0.001, now + length);
  src.connect(f).connect(g).connect(ctx.destination);
  src.start(now, Math.random() * 0.5);
  src.stop(now + length + 0.02);
}

const tune = (freqs, step, wave = 'triangle', gain = 0.08) =>
  freqs.forEach((f, i) => tone(wave, [[0, f]], gain, i === freqs.length - 1 ? 0.4 : step * 1.4, i * step));

/** jump · land · die · win · done · go · rest, and one for each trick (the trap's type). */
export function play(name) {
  if (muted || !ctx || ctx.state !== 'running') return;
  if (name === 'jump') tone('square', [[0, 300], [0.12, 620, 'ramp']], 0.05, 0.14);
  if (name === 'land') tone('sine', [[0, 140], [0.06, 70, 'ramp']], 0.12, 0.08);
  if (name === 'runtuh') {
    rumble(0.5, 0.6, 300);
    tone('sine', [[0, 90], [0.4, 40, 'ramp']], 0.25, 0.45);
  }
  if (name === 'paku') tone('square', [[0, 1400], [0.05, 900, 'ramp']], 0.05, 0.08);
  if (name === 'tembok') {
    rumble(0.35, 0.3, 500);
    tone('square', [[0, 160]], 0.06, 0.15);
  }
  if (name === 'lori') {
    // Pon-pon! A two-note horn.
    tone('sawtooth', [[0, 330]], 0.06, 0.22);
    tone('sawtooth', [[0, 415]], 0.05, 0.22);
    tone('sawtooth', [[0, 330]], 0.06, 0.3, 0.28);
    tone('sawtooth', [[0, 415]], 0.05, 0.3, 0.28);
  }
  if (name === 'durian' || name === 'kelapa' || name === 'papan') tone('sine', [[0, 900], [0.5, 200, 'ramp']], 0.06, 0.5);
  if (name === 'motor') tone('sawtooth', [[0, 110], [0.5, 240, 'ramp']], 0.05, 0.55);
  if (name === 'kucing') tone('sawtooth', [[0, 520], [0.12, 820, 'ramp'], [0.32, 480, 'ramp']], 0.04, 0.36);
  if (name === 'bola') tone('sine', [[0, 300], [0.15, 700, 'ramp']], 0.08, 0.18);
  if (name === 'burung') [0, 0.1, 0.2].forEach((d) => tone('sine', [[0, 2400], [0.06, 3200, 'ramp']], 0.03, 0.07, d));
  if (name === 'pokok' || name === 'tiang') {
    tone('square', [[0, 200], [0.3, 120, 'ramp']], 0.04, 0.3);
    rumble(0.4, 0.5, 250);
  }
  if (name === 'jentolak') {
    // Engine, then the reversing beeps.
    tone('sawtooth', [[0, 70], [0.6, 90, 'ramp']], 0.06, 0.7);
    [1.3, 1.6, 1.9].forEach((d) => tone('square', [[0, 1000]], 0.04, 0.12, d));
  }
  if (name === 'pancut') rumble(0.3, 0.5, 1800);
  if (name === 'wayar') tone('sawtooth', [[0, 120]], 0.04, 0.4);
  if (name === 'rumahPalsu') rumble(0.5, 0.6, 300);
  if (name === 'pening') tone('sine', [[0, 600], [0.3, 300, 'ramp'], [0.6, 600, 'ramp']], 0.06, 0.65);
  if (name === 'suis') tone('square', [[0, 900], [0.05, 1400, 'ramp']], 0.05, 0.08);
  if (name === 'buaya') tone('square', [[0, 220], [0.08, 90, 'ramp']], 0.07, 0.12);
  if (name === 'batu') rumble(0.45, 0.8, 200);
  if (name === 'kunci') {
    tone('square', [[0, 180]], 0.06, 0.08);
    tone('square', [[0, 140]], 0.06, 0.1, 0.08);
  }
  if (name === 'kunciDapat') [1047, 1319, 1568].forEach((f, i) => tone('sine', [[0, f]], 0.07, 0.15, i * 0.06));
  if (name === 'pintu') tone('triangle', [[0, 500], [0.25, 1200, 'ramp']], 0.07, 0.3);
  if (name === 'die') {
    // A sad trombone: wah wah wah waaah.
    [392, 370, 349].forEach((f, i) => tone('sawtooth', [[0, f], [0.25, f * 0.97, 'ramp']], 0.05, 0.26, i * 0.28));
    tone('sawtooth', [[0, 330], [0.7, 300, 'ramp']], 0.05, 0.75, 0.84);
  }
  if (name === 'win') tune([523, 659, 784, 1047], 0.08, 'square', 0.05);
  if (name === 'done') tune([523, 659, 784, 1047, 1319, 1568], 0.1, 'square', 0.05);
  if (name === 'go') tune([440, 660], 0.07);
  if (name === 'rest') {
    tone('triangle', [[0, 520]], 0.08, 0.1);
    tone('triangle', [[0, 390]], 0.08, 0.14, 0.09);
  }
}
