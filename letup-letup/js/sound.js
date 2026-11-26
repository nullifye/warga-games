// LetupLetup's sounds and music, synthesised (no files to download).
// Sounds: a swish as birds trade places, a chirp when one is picked, a bang, a pop and a startled
// chirp for each line (higher with every link of a chain), the Mercun's boom, the Petir's crackle, a cage
// clicking open, a row falling (a whoosh and a flutter, a thud as each bird lands, a chirp when
// they're all down), a fanfare for a new Semester, a warning when a column is
// full, and the end of the game.
// Music: an original bouncy loop (16 bars: melody, bass, off-beat chords and light drums) at a
// steady tempo whatever the level. Only when the stack nears the top does it turn tense, then
// panicky: faster, a driving bass, a ticking clock and an alarm pulse.
let ctx = null;
let muted = false;
let musicOn = true;
let sfxBus = null;
let musicBus = null;

export const setMuted = (m) => { muted = m; };

/** Creates or wakes the audio context; call from a tap (browsers require one). */
export function unlockSound() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    sfxBus = ctx.createGain();
    sfxBus.connect(ctx.destination);
    musicBus = ctx.createGain();
    musicBus.gain.value = 0;
    musicBus.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume();
}

function tone(type, from, to, gain, length, delay = 0, out = sfxBus, at = null) {
  const now = (at ?? ctx.currentTime) + delay;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(from, now);
  if (to !== from) osc.frequency.exponentialRampToValueAtTime(to, now + length * 0.9);
  g.gain.setValueAtTime(0.0001, now);
  g.gain.linearRampToValueAtTime(gain, now + 0.005);
  g.gain.exponentialRampToValueAtTime(0.001, now + length);
  osc.connect(g).connect(out);
  osc.start(now);
  osc.stop(now + length + 0.02);
}

/** Filtered noise. `shape` (0–1 → 0–1) is the loudness over time. */
function noise({ freq, q = 1, gain, length, type = 'bandpass', delay = 0, shape = (t) => (1 - t) ** 2, out = sfxBus, at = null }) {
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
  src.connect(f).connect(g).connect(out);
  src.start((at ?? ctx.currentTime) + delay);
}

// C major pentatonic, two octaves: each link of a chain pops a step higher.
const PENTA = [523.25, 587.33, 659.25, 783.99, 880, 1046.5, 1174.66, 1318.51, 1567.98, 1760];

/** A bird's chirp: two quick upward whistles. `pitch` shifts it (1 = normal). */
function chirp(pitch = 1, delay = 0, gain = 0.09) {
  tone('sine', 2200 * pitch, 3400 * pitch, gain, 0.07, delay);
  tone('sine', 2500 * pitch, 3900 * pitch, gain * 0.8, 0.06, delay + 0.08);
}

/**
 * swap · pick · nope · pop (`n` = chain link) · bom · petir · unlock · row (`n` = each bird's landing,
 * in seconds from now) · level · graduate · combo (`n` = the combo) · supercombo · warn · tap · end
 */
export function play(name, n = 1) {
  if (muted || !ctx || ctx.state !== 'running') return;
  if (name === 'swap') noise({ freq: 1800, q: 0.9, gain: 0.12, length: 0.12, shape: (t) => Math.sin(t * Math.PI) });
  if (name === 'pick') chirp(0.9 + Math.random() * 0.25, 0, 0.07);
  if (name === 'nope') { tone('square', 220, 180, 0.06, 0.08); tone('square', 180, 150, 0.06, 0.1, 0.09); }
  if (name === 'tap') tone('triangle', 950, 280, 0.14, 0.045);
  if (name === 'pop') {
    // A small bang (a thump and a crack), the pop a step higher each link, and a startled chirp.
    noise({ freq: 220, q: 0.8, gain: 0.45, length: 0.16, type: 'lowpass' });
    noise({ freq: 2600, q: 0.6, gain: 0.18, length: 0.06, type: 'highpass' });
    const i = Math.min(PENTA.length - 2, (n - 1) * 2);
    tone('sine', PENTA[i] * 0.6, PENTA[i] * 1.4, 0.2, 0.09);
    tone('sine', PENTA[i + 1], PENTA[i + 1] * 1.2, 0.14, 0.12, 0.07);
    chirp(1 + (n - 1) * 0.08, 0.05);
  }
  if (name === 'bom') {
    noise({ freq: 160, q: 0.7, gain: 0.9, length: 0.5, type: 'lowpass' });
    tone('sine', 120, 40, 0.4, 0.4);
    noise({ freq: 3000, q: 0.5, gain: 0.25, length: 0.12, type: 'highpass', delay: 0.02 });
  }
  if (name === 'petir') {
    tone('sawtooth', 1800, 120, 0.12, 0.35);
    noise({ freq: 4200, q: 0.4, gain: 0.35, length: 0.3, type: 'highpass', shape: (t) => (Math.random() > 0.5 ? 1 : 0.2) * (1 - t) });
    noise({ freq: 90, q: 0.7, gain: 0.6, length: 0.55, type: 'lowpass', delay: 0.08 });
  }
  if (name === 'unlock') { tone('triangle', 2100, 2100, 0.1, 0.05); tone('triangle', 2800, 2800, 0.1, 0.08, 0.06); chirp(1.1, 0.12); }
  if (name === 'row') {
    const lands = Array.isArray(n) ? n : [0.2];
    const last = Math.max(...lands);
    // The row leaves the top: a falling whoosh and a flutter of wings.
    noise({ freq: 1400, q: 0.7, gain: 0.16, length: Math.max(0.2, last), type: 'bandpass', shape: (t) => Math.sin(t * Math.PI) * (1 - t * 0.5) });
    tone('sine', 900, 380, 0.05, Math.max(0.2, last));
    for (let i = 0; i < 5; i++) noise({ freq: 2600, q: 1.5, gain: 0.07, length: 0.035, delay: i * 0.05, shape: (t) => Math.sin(t * Math.PI) });
    // Each bird lands with a soft thud (a little different each, so a row patters down).
    lands.forEach((t, i) => {
      const f = 150 + ((i * 37) % 5) * 9;
      tone('sine', f, 55, 0.2, 0.13, t);
      noise({ freq: 380, q: 0.8, gain: 0.16, length: 0.05, type: 'lowpass', delay: t });
    });
    // All down: a little chirp from the flock.
    chirp(1.05, last + 0.04, 0.06);
  }
  if (name === 'level') [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone('triangle', f, f, 0.2, 0.22, i * 0.09));
  // A move in a combo: a quick rising run, higher with every step of the combo.
  if (name === 'combo') {
    const base = PENTA[Math.min(PENTA.length - 3, Math.max(0, n - 2))];
    [1, 1.25, 1.5].forEach((m, i) => tone('square', base * m, base * m, 0.07, 0.09, 0.05 + i * 0.06));
  }
  // Two specials together: a deep boom, a crack of thunder and a rising sweep.
  if (name === 'supercombo') {
    noise({ freq: 120, q: 0.6, gain: 1, length: 0.8, type: 'lowpass' });
    tone('sine', 140, 30, 0.5, 0.7);
    tone('sawtooth', 300, 2400, 0.08, 0.5, 0.05);
    noise({ freq: 4500, q: 0.4, gain: 0.4, length: 0.5, type: 'highpass', delay: 0.04, shape: (t) => (Math.random() > 0.45 ? 1 : 0.15) * (1 - t) });
  }
  // A new programme: a longer graduation fanfare, a chord to finish, and a cheer of chirps.
  if (name === 'graduate') {
    [523.25, 659.25, 783.99, 1046.5, 783.99, 1046.5].forEach((f, i) => tone('triangle', f, f, 0.2, i === 5 ? 0.6 : 0.2, i * 0.11));
    [523.25, 659.25, 783.99].forEach((f) => tone('sine', f, f, 0.1, 0.8, 0.66));
    for (let i = 0; i < 4; i++) chirp(0.95 + i * 0.07, 0.7 + i * 0.09, 0.05);
  }
  if (name === 'warn') { tone('square', 880, 880, 0.05, 0.08); tone('square', 660, 660, 0.05, 0.12, 0.12); }
  if (name === 'end') [783.99, 659.25, 523.25, 392].forEach((f, i) => tone('triangle', f, f * 0.98, 0.2, 0.34, i * 0.15));
}

// ---------- music ----------

// Eight eighth-notes a bar: a note ("E5"), "-" holds the one before, "." rests.
const MELODY = [
  'E5 . G5 . C6 - G5 .', 'D5 . G5 . B5 - A5 G5', 'C5 . E5 . A5 - G5 E5', 'F5 - E5 - C5 - - .',
  'E5 . G5 . C6 - D6 C6', 'B5 - G5 - D5 - G5 .', 'A5 G5 F5 E5 F5 - A5 .', 'G5 - - . D5 E5 F5 D5',
  'C6 . G5 E5 G5 . C6 .', 'B5 . G5 D5 G5 . B5 .', 'A5 . E5 C5 E5 . A5 G5', 'F5 - A5 - C6 - A5 .',
  'G5 - E5 - C5 E5 G5 .', 'D6 - B5 - G5 - D5 .', 'F5 E5 F5 A5 G5 - F5 .', 'D5 - G5 - B5 - - .',
].map((bar) => bar.split(' '));
// Each bar's chord: its bass note and the chord's notes.
const CHORDS = { C: ['C3', 'C4 E4 G4'], G: ['G2', 'B3 D4 G4'], Am: ['A2', 'C4 E4 A4'], F: ['F2', 'C4 F4 A4'] };
const PROGRESSION = ['C', 'G', 'Am', 'F', 'C', 'G', 'F', 'G', 'C', 'G', 'Am', 'F', 'C', 'G', 'F', 'G'];

const NOTE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const freq = (name) => {
  const m = /^([A-G])(#?)(\d)$/.exec(name);
  return 440 * 2 ** ((12 * (Number(m[3]) + 1) + NOTE[m[1]] + (m[2] ? 1 : 0) - 69) / 12);
};

// Tempo by mood: 0 calm, 1 tense (a column nearly full), 2 panic (about to be stuck at the top).
const MOOD_BPM = [118, 132, 148];
const music = { playing: false, timer: 0, step: 0, next: 0, bpm: MOOD_BPM[0], mood: 0 };

/** Turns the music on or off (the Muzik switch). */
export function setMusicOn(on) {
  musicOn = on;
  if (!on) stopMusic();
}

/** How close the stack is to the top: 0 calm, 1 tense, 2 panic. The tempo eases towards it. */
export function setMusicMood(mood) {
  music.mood = mood;
}

/** Starts (or carries on) the loop where it stopped. */
export function startMusic() {
  if (!musicOn || !ctx || music.playing) return;
  music.playing = true;
  music.next = ctx.currentTime + 0.08;
  musicBus.gain.cancelScheduledValues(ctx.currentTime);
  musicBus.gain.setValueAtTime(musicBus.gain.value, ctx.currentTime);
  musicBus.gain.linearRampToValueAtTime(0.55, ctx.currentTime + 0.4);
  music.timer = setInterval(schedule, 25);
  schedule();
}

/** Fades the loop out; `reset` starts the next one from the top. */
export function stopMusic({ reset = false } = {}) {
  if (reset) music.step = 0;
  if (!music.playing) return;
  music.playing = false;
  clearInterval(music.timer);
  if (ctx) {
    musicBus.gain.cancelScheduledValues(ctx.currentTime);
    musicBus.gain.setValueAtTime(musicBus.gain.value, ctx.currentTime);
    musicBus.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.25);
  }
}

/** Schedules the eighth-notes due in the next 120 ms (a look-ahead, so the beat stays steady). */
function schedule() {
  if (!ctx || ctx.state !== 'running') { if (ctx) music.next = ctx.currentTime + 0.05; return; }
  while (music.next < ctx.currentTime + 0.12) {
    // Ease the tempo towards the mood's, a little each eighth-note, so it never lurches.
    music.bpm += (MOOD_BPM[music.mood] - music.bpm) * 0.12;
    playStep(music.step, music.next);
    music.next += 60 / music.bpm / 2;
    music.step = (music.step + 1) % (MELODY.length * 8);
  }
}

function playStep(step, at) {
  const bar = Math.floor(step / 8), beat = step % 8;
  const eighth = 60 / music.bpm / 2;
  const out = musicBus;
  // Melody: a soft square lead, held through "-".
  const note = MELODY[bar][beat];
  if (note !== '-' && note !== '.') {
    let len = 1;
    while (beat + len < 8 && MELODY[bar][beat + len] === '-') len++;
    tone('square', freq(note), freq(note), 0.045, eighth * len * 0.92, 0, out, at);
    tone('triangle', freq(note) * 2, freq(note) * 2, 0.02, eighth * 0.6, 0, out, at);
  }
  const [bass, chord] = CHORDS[PROGRESSION[bar]];
  const mood = music.mood;
  // Bass: the root, bouncing an octave on the off-beats; tense or worse, it drives every eighth.
  if (beat % 2 === 0) tone('triangle', freq(bass), freq(bass), 0.16, eighth * 0.9, 0, out, at);
  else if (mood >= 1) tone('triangle', freq(bass) * 2, freq(bass) * 2, 0.11, eighth * 0.6, 0, out, at);
  else if (beat === 3 || beat === 7) tone('triangle', freq(bass) * 2, freq(bass) * 2, 0.09, eighth * 0.7, 0, out, at);
  // Chords on the off-beats: short, plucky.
  if (beat % 2 === 1) for (const n of chord.split(' ')) tone('triangle', freq(n), freq(n), 0.022, eighth * 0.55, 0, out, at);
  // Drums: a kick on 1 and 3, a snare on 2 and 4, a hat on the off-beats.
  if (beat === 0 || beat === 4) tone('sine', 140, 45, 0.3, 0.14, 0, out, at);
  if (beat === 2 || beat === 6) noise({ freq: 1800, q: 0.7, gain: 0.12, length: 0.1, out, at });
  if (beat % 2 === 1 || mood >= 1) noise({ freq: 8000, q: 0.5, gain: 0.05, length: 0.035, type: 'highpass', out, at });
  // Panic: a clock ticking between the eighths, and an alarm pulse a semitone off the bass.
  if (mood >= 2) {
    tone('square', 2093, 2093, 0.022, 0.03, eighth / 2, out, at);
    if (beat === 0 || beat === 4) {
      tone('square', freq(bass) * 4, freq(bass) * 4, 0.035, eighth * 0.8, 0, out, at);
      tone('square', freq(bass) * 4 * 1.0595, freq(bass) * 4 * 1.0595, 0.03, eighth * 0.8, eighth, out, at);
    }
  }
}
