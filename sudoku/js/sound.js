// Sudoku's sounds and music, synthesised (no files to download), with a soft room reverb.
// Sounds (the Bunyi switch): a wood-block tap to pick a cell; a marimba note for a number, its
// own pitch for each digit (1 low … 9 high); a kalimba tick for a note; a soft "bonk" for a
// mistake; a brush for erasing; a bell sparkle for a hint; a marimba run when a row, column or
// box is done; a small fanfare with a gong for a solved puzzle, a falling phrase for a lost one.
// Music (the Muzik switch, three original loops to choose from, `TRACKS`): Lo-fi (electric piano,
// a soft swung beat), Gamelan (a five-note scale: saron, bonang, kenong and gong) and Ceria
// (bright marimba, a light groove). Played only while a puzzle is on, or briefly as a preview.
let ctx = null;
let muted = false;
let musicOn = true;
let master = null, sfxBus = null, musicBus = null, reverbIn = null;

export const setMuted = (m) => { muted = m; };

/** A soft room: noise fading over ~2 s, in stereo. */
function makeReverb() {
  const len = Math.floor(ctx.sampleRate * 2.2);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 3;
  }
  const conv = ctx.createConvolver();
  conv.buffer = buf;
  return conv;
}

/** Creates or wakes the audio context; call from a tap (browsers require one). */
export function unlockSound() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.9;
    master.connect(ctx.destination);
    const reverb = makeReverb();
    const wet = ctx.createGain();
    wet.gain.value = 0.32;
    reverb.connect(wet).connect(master);
    reverbIn = reverb;
    sfxBus = ctx.createGain();
    sfxBus.connect(master);
    musicBus = ctx.createGain();
    musicBus.gain.value = 0;
    musicBus.connect(master);
  }
  if (ctx.state === 'suspended') ctx.resume();
}

// ---------- instruments ----------

/** Sends `node` to `out` and, a little, to the reverb. */
function route(node, out, send = 0.4) {
  node.connect(out);
  if (send > 0) {
    const s = ctx.createGain();
    s.gain.value = send;
    node.connect(s).connect(reverbIn);
  }
}

function osc(type, f, t, len) {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f, t);
  o.start(t);
  o.stop(t + len + 0.05);
  return o;
}

/** A gain that rises in `attack`, then falls away over `len` (exponentially). */
function env(t, peak, len, attack = 0.004) {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(peak, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + len);
  return g;
}

/** Marimba: a warm fundamental and a quick woody overtone. */
function marimba(f, t, vel, out, send = 0.35) {
  const g = env(t, 0.32 * vel, 0.6);
  osc('sine', f, t, 0.6).connect(g);
  const g2 = env(t, 0.12 * vel, 0.08);
  osc('sine', f * 3.93, t, 0.08).connect(g2);
  route(g, out, send);
  route(g2, out, send);
}

/** Bell: a fundamental with inharmonic partials that fade faster. */
function bell(f, t, vel, out, len = 1.4, send = 0.6) {
  for (const [ratio, gain, l] of [[1, 0.16, len], [2.76, 0.06, len * 0.5], [5.4, 0.03, len * 0.25]]) {
    const g = env(t, gain * vel, l, 0.003);
    osc('sine', f * ratio, t, l).connect(g);
    route(g, out, send);
  }
}

/** Electric piano: a sine whose brightness (FM) fades as the note rings. */
function epiano(f, t, vel, out, len = 1.2) {
  const car = osc('sine', f, t, len);
  const mod = osc('sine', f, t, len);
  const idx = ctx.createGain();
  idx.gain.setValueAtTime(f * 1.6, t);
  idx.gain.exponentialRampToValueAtTime(f * 0.15, t + len * 0.6);
  mod.connect(idx).connect(car.frequency);
  const g = env(t, 0.1 * vel, len, 0.006);
  car.connect(g);
  route(g, out, 0.45);
}

/** A soft pad: two slightly detuned saws through a low filter, slow in and out. */
function pad(f, t, len, vel, out) {
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 900;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(0.025 * vel, t + len * 0.35);
  g.gain.linearRampToValueAtTime(0.0001, t + len);
  for (const det of [-6, 6]) {
    const o = osc('sawtooth', f, t, len);
    o.detune.value = det;
    o.connect(lp);
  }
  lp.connect(g);
  route(g, out, 0.6);
}

/** A round bass note. */
function bass(f, t, len, vel, out) {
  const g = env(t, 0.2 * vel, len, 0.01);
  osc('sine', f, t, len).connect(g);
  const g2 = env(t, 0.05 * vel, len * 0.5, 0.01);
  osc('triangle', f * 2, t, len).connect(g2);
  route(g, out, 0.1);
  route(g2, out, 0.1);
}

/** Gong: low, long, a slight bend down, with a shimmer. */
function gong(f, t, vel, out, len = 3.2) {
  const o = osc('sine', f, t, len);
  o.frequency.exponentialRampToValueAtTime(f * 0.985, t + len);
  const g = env(t, 0.28 * vel, len, 0.02);
  o.connect(g);
  route(g, out, 0.5);
  const g2 = env(t, 0.05 * vel, len * 0.6, 0.02);
  osc('sine', f * 2.02, t, len).connect(g2);
  route(g2, out, 0.6);
}

/** Filtered noise: shakers, brushes, a wood-block click. */
function noise(t, { freq, q = 1, gain, len, type = 'bandpass' }, out, send = 0.15) {
  const n = Math.max(1, Math.floor(ctx.sampleRate * len));
  const buf = ctx.createBuffer(1, n, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n) ** 2;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  const g = ctx.createGain();
  g.gain.value = gain;
  src.connect(f).connect(g);
  route(g, out, send);
  src.start(t);
}

/** A soft kick: a quick falling sine. */
function kick(t, vel, out) {
  const o = osc('sine', 120, t, 0.25);
  o.frequency.exponentialRampToValueAtTime(42, t + 0.2);
  const g = env(t, 0.35 * vel, 0.25, 0.003);
  o.connect(g);
  route(g, out, 0);
}

// ---------- notes ----------

const NOTE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const freq = (name) => {
  const m = /^([A-G])(b|#)?(\d)$/.exec(name);
  const shift = m[2] === 'b' ? -1 : m[2] === '#' ? 1 : 0;
  return 440 * 2 ** ((12 * (Number(m[3]) + 1) + NOTE[m[1]] + shift - 69) / 12);
};
/** Each digit's marimba note: C major pentatonic, 1 low to 9 high. */
const DIGIT_NOTES = ['C5', 'D5', 'E5', 'G5', 'A5', 'C6', 'D6', 'E6', 'G6'].map(freq);

// ---------- sound effects ----------

/**
 * tap · place (`n` = the digit) · note · wrong · erase · hint · done (`n` = units done at once) ·
 * win · lose
 */
export function play(name, n = 1) {
  if (muted || !ctx || ctx.state !== 'running') return;
  const t = ctx.currentTime + 0.005;
  const out = sfxBus;
  if (name === 'tap') {
    noise(t, { freq: 2600, q: 6, gain: 0.35, len: 0.03 }, out, 0.05);
    const g = env(t, 0.05, 0.04);
    osc('sine', 1500, t, 0.05).connect(g);
    route(g, out, 0);
  }
  if (name === 'place') marimba(DIGIT_NOTES[Math.max(0, Math.min(8, n - 1))], t, 1, out);
  if (name === 'note') {
    const f = DIGIT_NOTES[Math.max(0, Math.min(8, n - 1))] * 2;
    const g = env(t, 0.05, 0.12);
    osc('sine', f, t, 0.12).connect(g);
    route(g, out, 0.3);
  }
  if (name === 'wrong') {
    // A soft bonk: two low notes, down a fourth, with a muffled thump.
    for (const [f, d] of [[233.08, 0], [174.61, 0.11]]) {
      const g = env(t + d, 0.18, 0.28, 0.005);
      const o = osc('triangle', f, t + d, 0.3);
      o.frequency.exponentialRampToValueAtTime(f * 0.94, t + d + 0.25);
      o.connect(g);
      route(g, out, 0.15);
    }
    noise(t, { freq: 300, q: 0.7, gain: 0.25, len: 0.08, type: 'lowpass' }, out, 0);
  }
  if (name === 'erase') noise(t, { freq: 1600, q: 0.6, gain: 0.18, len: 0.18 }, out, 0.2);
  if (name === 'hint') ['G6', 'C7', 'E7', 'G7'].forEach((k, i) => bell(freq(k), t + i * 0.06, 0.8, out, 0.9));
  if (name === 'done') {
    // A marimba run up the scale; longer when more is done at once.
    const steps = n >= 2 ? [0, 1, 2, 3, 4, 5, 7] : [0, 2, 4, 5];
    steps.forEach((k, i) => marimba(DIGIT_NOTES[Math.min(8, k)], t + i * 0.055, 0.8, out, 0.5));
  }
  if (name === 'win') {
    ['C5', 'E5', 'G5', 'C6', 'G5', 'C6', 'E6'].forEach((k, i) => marimba(freq(k), t + i * 0.1, 1, out, 0.5));
    ['C6', 'E6', 'G6'].forEach((k) => bell(freq(k), t + 0.72, 0.9, out, 2));
    gong(freq('C3'), t + 0.72, 0.8, out);
  }
  if (name === 'lose') ['G4', 'E4', 'D4', 'C4'].forEach((k, i) => epiano(freq(k), t + i * 0.18, 1, out, 0.8));
}

// ---------- music ----------

/** The three loops, and what the home screen calls them. */
export const TRACKS = {
  lofi: { name: 'Lo-fi', bpm: 76 },
  gamelan: { name: 'Gamelan', bpm: 84 },
  ceria: { name: 'Ceria', bpm: 100 },
};

// Lo-fi: electric piano chords, a soft bass, a bell now and then, a lazy swung beat.
const LOFI_CHORDS = [
  ['D3', 'F3 A3 C4 E4'], ['G2', 'F3 A3 B3 E4'], ['C3', 'E3 G3 B3 D4'], ['A2', 'G3 C4 E4 G4'],
  ['D3', 'F3 A3 C4 E4'], ['G2', 'F3 B3 D4 E4'], ['E3', 'G3 B3 D4 F#4'], ['A2', 'G3 C4 E4 A4'],
];
const LOFI_BELL = ['A5', '.', 'E5', '.', 'G5', '.', 'C6', '.', 'A5', '.', 'D6', '.', 'B5', '.', 'E5', '.'];

function lofiStep(step, t, eighth, out) {
  const bar = Math.floor(step / 8) % LOFI_CHORDS.length, beat = step % 8;
  const [root, chord] = LOFI_CHORDS[bar];
  const notes = chord.split(' ').map(freq);
  // Swing: the off-beats come a little late.
  const at = t + (beat % 2 ? eighth * 0.16 : 0);
  if (beat === 0) notes.forEach((f) => epiano(f, at, 0.9, out, 2.2));
  if (beat === 5) notes.slice(1).forEach((f) => epiano(f, at, 0.55, out, 1.1));
  if (beat === 0) bass(freq(root), at, eighth * 3, 1, out);
  if (beat === 3) bass(freq(root), at, eighth * 2, 0.7, out);
  if (beat === 6) bass(freq(root) * 1.5, at, eighth * 1.5, 0.6, out);
  if (beat === 0 || beat === 3) kick(at, 0.6, out);
  if (beat === 4) noise(at, { freq: 1800, q: 1.2, gain: 0.14, len: 0.12 }, out, 0.25);
  if (beat % 2 === 1) noise(at, { freq: 7500, q: 0.8, gain: 0.05, len: 0.04, type: 'highpass' }, out, 0);
  // The bell, on bar starts and halfway through, every other bar.
  if (beat === 2 && bar % 2 === 0) {
    const k = LOFI_BELL[(bar * 2) % LOFI_BELL.length];
    if (k !== '.') bell(freq(k), at, 0.7, out, 1.8);
  }
  // A little vinyl crackle.
  if (Math.random() < 0.12) noise(at, { freq: 3000, q: 0.5, gain: 0.02, len: 0.01, type: 'highpass' }, out, 0);
}

// Gamelan: an approximate slendro scale (five near-equal steps), a core melody on the saron,
// the bonang playing around it, the kenong marking the phrases and the gong closing the cycle.
const SLENDRO = [0, 1, 2, 3, 4].map((k) => 2 ** ((k * 240) / 1200));
const gfreq = (deg, oct = 0) => 293.66 * 2 ** oct * SLENDRO[((deg % 5) + 5) % 5] * 2 ** Math.floor(deg / 5);
// Core melody: 32 beats, scale degrees 0–4 (one beat = two eighths).
const BALUNGAN = [2, 1, 2, 3, 2, 1, 0, 4, 0, 1, 2, 1, 3, 2, 1, 0, 3, 4, 3, 2, 1, 2, 3, 4, 3, 2, 1, 0, 1, 2, 1, 0];

function gamelanStep(step, t, eighth, out) {
  const beat = Math.floor(step / 2) % BALUNGAN.length, half = step % 2;
  const deg = BALUNGAN[beat];
  // Saron: the core melody, on the beat.
  if (!half) {
    bell(gfreq(deg, 0), t, 0.8, out, 1.0, 0.45);
    // A lower, softer octave doubling (slenthem).
    const g = env(t, 0.08, eighth * 3);
    osc('sine', gfreq(deg, -1), t, eighth * 3).connect(g);
    route(g, out, 0.3);
  }
  // Bonang: on every eighth, the next note up and back (imbal-like), high and light.
  const next = BALUNGAN[(beat + 1) % BALUNGAN.length];
  const pattern = half ? next : deg + 1;
  bell(gfreq(pattern, 1), t, 0.35, out, 0.35, 0.3);
  // Kenong every four beats, gong at the end of the cycle.
  if (!half && beat % 4 === 3) bell(gfreq(deg, -1), t, 0.8, out, 1.8, 0.5);
  if (!half && beat === BALUNGAN.length - 1) gong(gfreq(0, -2), t, 1, out, 4);
  // A soft kendhang (drum) on the off-beats now and then.
  if (half && beat % 2 === 1) noise(t, { freq: 220, q: 1.5, gain: 0.25, len: 0.12, type: 'lowpass' }, out, 0.1);
}

// Ceria: a bright marimba tune over I–V–vi–IV, a bouncy bass, a light kick and snap.
const CERIA_CHORDS = [['C3', 'C'], ['G2', 'G'], ['A2', 'Am'], ['F2', 'F']];
const CERIA_TUNE = [
  'E5 . G5 . C6 . G5 E5', 'D5 . G5 . B5 . A5 G5', 'C5 . E5 . A5 . G5 E5', 'F5 . A5 . C6 . A5 F5',
  'E5 G5 C6 . E6 . D6 C6', 'D5 G5 B5 . D6 . C6 B5', 'A5 . C6 . E6 . D6 C6', 'A5 . G5 . F5 . D5 .',
].map((bar) => bar.split(' '));

function ceriaStep(step, t, eighth, out) {
  const bar = Math.floor(step / 8) % CERIA_TUNE.length, beat = step % 8;
  const [root] = CERIA_CHORDS[bar % 4];
  const note = CERIA_TUNE[bar][beat];
  if (note !== '.') marimba(freq(note), t, 0.75, out, 0.3);
  if (beat % 2 === 0) bass(freq(root) * (beat === 4 ? 1.5 : 1), t, eighth * 1.6, 0.9, out);
  if (beat === 0 || beat === 4) kick(t, 0.7, out);
  if (beat === 2 || beat === 6) noise(t, { freq: 2200, q: 1.5, gain: 0.2, len: 0.06 }, out, 0.2);
  if (beat % 2 === 1) noise(t, { freq: 8000, q: 0.8, gain: 0.05, len: 0.03, type: 'highpass' }, out, 0);
  // A pad under each bar.
  if (beat === 0) {
    const chord = { C: ['C4', 'E4', 'G4'], G: ['B3', 'D4', 'G4'], Am: ['A3', 'C4', 'E4'], F: ['A3', 'C4', 'F4'] }[CERIA_CHORDS[bar % 4][1]];
    chord.forEach((k) => pad(freq(k), t, eighth * 8, 1, out));
  }
}

const STEPS = { lofi: lofiStep, gamelan: gamelanStep, ceria: ceriaStep };
const LOOP_STEPS = { lofi: 8 * 8, gamelan: BALUNGAN.length * 2, ceria: 8 * 8 };

const music = { playing: false, timer: 0, step: 0, next: 0, track: 'lofi', previewTimer: 0 };

/** The Muzik switch. */
export function setMusicOn(on) {
  musicOn = on;
  if (!on) stopMusic();
}

/** Which loop plays (TRACKS); a change takes effect from its first bar. */
export function setTrack(id) {
  if (!STEPS[id] || id === music.track) return;
  music.track = id;
  music.step = 0;
}

/** Starts the loop (or carries on where it stopped); nothing if Muzik is off or there's no audio. */
export function startMusic() {
  clearTimeout(music.previewTimer);
  if (!musicOn || !ctx || music.playing) return;
  music.playing = true;
  music.next = ctx.currentTime + 0.1;
  musicBus.gain.cancelScheduledValues(ctx.currentTime);
  musicBus.gain.setValueAtTime(musicBus.gain.value, ctx.currentTime);
  musicBus.gain.linearRampToValueAtTime(0.75, ctx.currentTime + 1);
  music.timer = setInterval(schedule, 40);
  schedule();
}

/** Fades the loop out; `reset` starts the next one from the top. */
export function stopMusic({ reset = false } = {}) {
  clearTimeout(music.previewTimer);
  if (reset) music.step = 0;
  if (!music.playing) return;
  music.playing = false;
  clearInterval(music.timer);
  if (ctx) {
    musicBus.gain.cancelScheduledValues(ctx.currentTime);
    musicBus.gain.setValueAtTime(musicBus.gain.value, ctx.currentTime);
    musicBus.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.5);
  }
}

/** A few seconds of a loop from its top (the home screen, when a Lagu is picked). */
export function previewMusic(id, seconds = 7) {
  stopMusic();
  setTrack(id);
  music.step = 0;
  // Let the fade-out finish before the preview starts.
  setTimeout(() => {
    startMusic();
    music.previewTimer = setTimeout(() => stopMusic({ reset: true }), seconds * 1000);
  }, 120);
}

/** Schedules the eighth-notes due in the next 150 ms (a look-ahead, so the beat stays steady). */
function schedule() {
  if (!ctx || ctx.state !== 'running') { if (ctx) music.next = ctx.currentTime + 0.05; return; }
  const eighth = 60 / TRACKS[music.track].bpm / 2;
  while (music.next < ctx.currentTime + 0.15) {
    STEPS[music.track](music.step, music.next, eighth, musicBus);
    music.next += eighth;
    music.step = (music.step + 1) % LOOP_STEPS[music.track];
  }
}
