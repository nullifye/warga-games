// Letup-Letup: screens, Cabaran Harian and Main Bebas, the board (birds that bob, blink and look
// about; slide, fall and explode; the next row above it; the wave timer), music, input (swipe,
// tap-tap, keyboard), results and the leaderboard. The rules are in rules.js, the birds in birds.js.
import {
  COLS, ROWS, SPECIAL_NAMES, PER_SEMESTER, MAX_LEVEL, levelName, MIN_MOVE_S, newGame, canSwap, swap, dropWave, room, waveInterval,
  lockChance, typeCount, summary, end, dailySeed, COMBO_WINDOW, comboAlive, SPECIAL_COMBOS, legalSwaps, clone,
} from './rules.js';
import {
  setMuted, unlockSound, play as playSound, setMusicOn, setMusicMood, startMusic, stopMusic,
} from './sound.js';
import { birdSrc, preloadBirds, FEATHERS } from './birds.js';
import { initAppsWarga, appsWargaHaptic, closeMiniApp, notifyAppReady } from '../../shared/appswarga.js';
import { initFromArked, backToArked } from '../../shared/arked-link.js';
import { initProfile, loadProfile, withProfile } from '../../shared/profile.js';
import { gameKey, readShared, writeShared } from '../../shared/shared-store.js';
import { todayKL, randomSeed } from '../../shared/rng.js';
import * as lb from '../../shared/leaderboard.js';
import { hardReload } from '../../shared/reload.js';

const GAME_ID = 'letup-letup';
const PROGRESS_KEY = gameKey(GAME_ID);
const SCREENS = ['home', 'game', 'result', 'board'];
const K = { stats: 'letup.stats', settings: 'letup.settings', daily: 'letup.daily', seenHelp: 'letup.seenHelp', tips: 'letup.tips' };
const BADGE = {
  bom: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="9" width="12" height="11" rx="2" fill="#fff" transform="rotate(-20 12 14)"/><path d="M14 7c1-3 4-3 5-1" fill="none" stroke="#fff3bf" stroke-width="2" stroke-linecap="round"/><circle cx="19.5" cy="5" r="2" fill="#ffd43b"/></svg>',
  petir: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13.5 2 5 13.5h6L9.5 22 19 9.5h-6.2z" fill="#ffd43b" stroke="#fff3bf" stroke-width="1" stroke-linejoin="round"/></svg>',
};
const LOCK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 11V8a4 4 0 0 1 8 0v3" fill="none" stroke="#f1f3f5" stroke-width="2.6"/><rect x="5" y="11" width="14" height="10" rx="2.5" fill="#fab005" stroke="#7c4a03" stroke-width="1.2"/><circle cx="12" cy="15.6" r="1.6" fill="#7c4a03"/></svg>';
const PRAISE = { 2: 'Berantai ×2!', 3: 'Hebat! ×3', 4: 'Luar biasa! ×4', 5: 'Letup-Letup! ×5' };
const $ = (sel) => document.querySelector(sel);
const number = (n) => Number(n).toLocaleString('ms-MY');
const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function storeGet(key, fallback) { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } }
function storeSet(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* unavailable */ } }
function h(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text != null) e.textContent = text;
  return e;
}

let toastTimer = 0;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 1800);
}

const settings = () => ({ sound: true, music: true, lite: false, liteChecked: false, ...storeGet(K.settings, {}) });
const stats = () => ({ played: 0, best: 0, bestLevel: 0, ...storeGet(K.stats, {}) });
const todaysDaily = () => { const d = storeGet(K.daily, null); return d?.date === todayKL() ? d : null; };

/**
 * session: { g (rules state), startedAt, busy (steps playing), paused, idle (board-idle seconds
 * towards the next wave), raf, lastTs, sel, cursor, held, els (piece id → element), leaving }.
 * null when no game is open.
 */
let session = null;
let lastResult = null;
let boardTab = 'daily';
let boardRequest = 0;
let cell = 44; // px, one square
let pointer = null;

// ---------- routing (as in the other games: no game entry is left under home) ----------

function show(name) {
  for (const s of SCREENS) $(`#screen-${s}`).hidden = s !== name;
  document.body.dataset.screen = name;
}

function go(name, { replace = false } = {}) {
  const hash = `#/${name}`;
  if (!name) {
    if (history.state?.up) return history.back();
    if (location.hash !== hash) history.replaceState({ ...(history.state ?? {}), up: false }, '', hash);
    return route();
  }
  if (location.hash === hash) return route();
  if (replace) history.replaceState({ ...(history.state ?? {}), up: true }, '', hash);
  else history.pushState({ up: true }, '', hash);
  route();
}

function route() {
  const name = location.hash.replace(/^#\/?/, '');
  if (name === 'harian' || name === 'bebas') {
    if (session) return show('game');
    return withProfile(name === 'harian' ? startDaily : startFree);
  }
  // The phone's Back during a game that would be recorded: stay and ask first.
  if (mustAsk()) {
    history.pushState({ up: true }, '', session.g.daily ? '#/harian' : '#/bebas');
    return askLeave();
  }
  leaveRound();
  if (name === 'tamat' && lastResult) return renderResult();
  if (name === 'papan') return openBoard();
  renderHome();
}

// ---------- home ----------

function renderSettings() {
  const s = settings();
  setMuted(!s.sound);
  $('#set-sound').setAttribute('aria-checked', String(s.sound));
  $('#set-sound-hint').textContent = s.sound ? 'Kesan bunyi' : 'Senyap';
  setMusicOn(s.music);
  $('#set-music').setAttribute('aria-checked', String(s.music));
  $('#set-music-hint').textContent = s.music ? 'Muzik latar semasa bermain' : 'Senyap';
  $('#set-lite').setAttribute('aria-checked', String(s.lite));
  $('#set-lite-hint').textContent = s.lite ? 'Burung tidak beranimasi, letupan lebih ringkas' : 'Untuk telefon yang perlahan';
  document.body.classList.toggle('lt-lite', s.lite);
}

function renderHome() {
  show('home');
  renderSettings();
  $('#daily-date').textContent = new Intl.DateTimeFormat('ms-MY', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Asia/Kuala_Lumpur' }).format(new Date());
  const d = todaysDaily();
  if (d?.status === 'done') {
    $('#daily-status').textContent = `Selesai: ${number(d.result.points)} mata, ${levelName(d.result.level).short}. Cabaran baharu esok!`;
    $('#btn-daily').textContent = 'Keputusan';
  } else {
    $('#daily-status').textContent = 'Papan dan burung jatuh yang sama untuk semua pemain hari ini. Satu cubaan.';
    $('#btn-daily').textContent = 'Main';
  }
  const t = stats();
  $('#st-best').textContent = number(t.best);
  $('#st-level').textContent = t.bestLevel ? levelName(t.bestLevel).short : '–';
  $('#st-played').textContent = number(t.played);
}

/** Tells Arked Warga what was played (arked.game.letup-letup): when, and today's Cabaran Harian. */
function recordProgress(daily) {
  const prev = readShared(PROGRESS_KEY);
  const keep = prev?.daily?.date === todayKL() ? prev.daily : null;
  writeShared(PROGRESS_KEY, { lastPlayedAt: Date.now(), daily: daily === undefined ? keep : daily });
}

// ---------- starting and leaving ----------

function startDaily() {
  const d = todaysDaily();
  if (d?.status === 'done') {
    lastResult = { ...d.result, submit: { status: 'saved' } };
    return go('tamat', { replace: true });
  }
  const date = todayKL();
  recordProgress({ date, status: 'playing' });
  startGame(newGame({ seed: dailySeed(date), daily: true }));
  saveDailyProgress();
}

/**
 * Cabaran Harian is one try. While it plays, the result so far is kept on the phone (after every
 * move and row), so a game cut off by closing the app or reloading still counts: see
 * settleClosedDaily.
 */
function saveDailyProgress() {
  const s = session;
  if (!s?.g.daily || s.g.over) return;
  storeSet(K.daily, { date: todayKL(), status: 'playing', result: resultOf(s.g, secondsSince(s.startedAt), 'closed') });
}

/**
 * Opening the game with today's Cabaran Harian still marked as playing means it was cut off: it
 * counts as today's try, with the score it had, and is recorded; no second try.
 */
function settleClosedDaily() {
  const d = todaysDaily();
  if (d?.status !== 'playing' || session) return;
  record(d.result ?? resultOf(newGame({ seed: dailySeed(d.date), daily: true }), 1, 'closed'));
  toast('Cabaran Harian yang terhenti tadi telah direkodkan.');
}

function startFree() {
  recordProgress();
  startGame(newGame({ seed: randomSeed() }));
}

function startGame(g) {
  unlockSound();
  session = {
    g, startedAt: Date.now(), busy: false, paused: false, idle: 0, raf: 0, lastTs: 0,
    sel: null, cursor: [ROWS - 1, 3], held: false, els: new Map(), leaving: false, warned: false,
    clock: 0, popup: false, hint: null, lastAct: 0, alive: 0, selFlap: 0, fpsSamples: [],
  };
  show('game');
  $('#game-mode').textContent = g.daily ? 'Cabaran Harian' : 'Main Bebas';
  $('#lt-board').classList.remove('over');
  $('#lt-fx').replaceChildren();
  $('#lt-pause').hidden = true;
  $('#lt-cursor').hidden = true;
  $('#lt-tip').hidden = true;
  fit();
  buildBoard();
  particlesCanvas();
  renderAll();
  session.raf = requestAnimationFrame(frame);
  session.alive = setInterval(alive, 380);
  setMusicMood(0);
  stopMusic({ reset: true });
  startMusic();
}

/** Whether leaving now ends a game that is recorded (any points, or today's one try). */
const mustAsk = () => Boolean(session && !session.g.over && !session.leaving && (session.g.daily || session.g.score > 0));

/** Ends the game on the way out: with points (or Cabaran Harian) it is recorded; otherwise dropped. */
function leaveRound() {
  const s = session;
  if (!s) return;
  if (!s.g.over && (s.g.daily || s.g.score > 0)) finish('quit', { navigate: false });
  stopRound();
}

function quitRound() {
  if (mustAsk()) return askLeave();
  go('');
}

function askLeave() {
  const daily = session?.g.daily;
  $('#leave-title').textContent = daily ? 'Tamatkan Cabaran Harian?' : 'Tamatkan permainan?';
  $('#leave-text').textContent = daily
    ? 'Anda hanya ada satu cubaan hari ini. Jika keluar sekarang, cubaan ini tamat dengan markah setakat ini.'
    : 'Permainan ini akan tamat dan markah setakat ini direkodkan.';
  const dlg = $('#dlg-leave');
  if (!dlg.open) dlg.showModal();
}

function confirmLeave() {
  $('#dlg-leave').close();
  if (!session) return;
  session.leaving = true;
  go('');
}

function stopRound() {
  if (session) {
    cancelAnimationFrame(session.raf);
    clearInterval(session.alive);
    clearInterval(session.selFlap);
  }
  stopMusic();
  session = null;
  pointer = null;
}

// ---------- pause ----------

function pause() {
  const s = session;
  if (!s || s.g.over || s.paused) return;
  s.paused = true;
  clearSel();
  $('#lt-pause').hidden = false;
  $('#btn-pause').setAttribute('aria-label', 'Sambung');
  stopMusic();
}

function resume() {
  const s = session;
  if (!s) return;
  unlockSound();
  s.paused = false;
  s.lastTs = 0;
  $('#lt-pause').hidden = true;
  $('#btn-pause').setAttribute('aria-label', 'Jeda');
  startMusic();
  $('#lt-board').focus({ preventScroll: true });
}

const dialogOpen = () => Boolean(document.querySelector('dialog[open]'));

// ---------- the wave timer: counts only while the board is idle and the game is on screen ----------

function frame(ts) {
  const s = session;
  if (!s) return;
  s.raf = requestAnimationFrame(frame);
  const dt = s.lastTs ? Math.min(0.1, (ts - s.lastTs) / 1000) : 0;
  s.lastTs = ts;
  if (s.paused || s.g.over || dialogOpen() || document.hidden) return;
  // The game clock (for the combo window): runs while playing, also while birds move, but not in
  // a pause or a Tahniah popup.
  if (!s.popup) s.clock += dt;
  checkFrameRate(s, ts);
  renderCombo();
  if (s.busy) return;
  maybeHint(s);
  s.idle += dt;
  const iv = waveInterval(s.g.level);
  renderTimer(s.idle / iv);
  if (s.idle >= iv) {
    s.idle = 0;
    doDrop();
  }
}

/**
 * The first time the game is played on a phone, its frame rate is measured over a few seconds of
 * play; if it is low, Animasi ringan is switched on (once; the switch in the settings can undo it).
 */
function checkFrameRate(s, ts) {
  const st = settings();
  if (st.liteChecked || st.lite || s.clock < 1.5) return;
  const f = s.fpsSamples;
  if (f.last) f.push(ts - f.last);
  f.last = ts;
  if (f.length < 150) return;
  const sorted = [...f].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const slow = median > 28 || sorted[Math.floor(sorted.length * 0.9)] > 50; // under ~36 fps, or very uneven
  storeSet(K.settings, { ...st, liteChecked: true, lite: slow });
  if (slow) {
    renderSettings();
    toast('Animasi ringan dihidupkan supaya lebih lancar. Boleh ditukar di tetapan.');
  }
}

// ---------- a hint for beginners, and tips the first time something turns up ----------

/** In Pra Diploma, a swap that makes a line pulses after HINT_S seconds without a move. */
const HINT_S = 5;
function maybeHint(s) {
  if (s.hint || s.g.level !== 1 || s.sel || s.clock - s.lastAct < HINT_S) return;
  const move = hintMove(s.g);
  s.lastAct = s.clock; // (if there is none, look again in a while)
  if (!move) return;
  s.hint = move;
  for (const at of move) { const p = pieceAt(at); if (p) s.els.get(p.id)?.classList.add('hint'); }
}

/** The first legal swap that pops something (tried out on a copy of the game). */
function hintMove(g) {
  for (const [a, b] of legalSwaps(g)) {
    if (swap(clone(g), a, b)?.some((x) => x.type === 'clear')) return [a, b];
  }
  return null;
}

/** Any move (or tap, or row) takes the hint away and starts the wait again. */
function clearHint() {
  const s = session;
  if (!s) return;
  s.lastAct = s.clock;
  if (!s.hint) return;
  for (const at of s.hint) { const p = pieceAt(at); if (p) s.els.get(p.id)?.classList.remove('hint'); }
  s.hint = null;
}

/** What each tip says, shown once ever (remembered on the phone). */
const TIPS = {
  bom: 'Mercun! 4 sebaris meninggalkan Mercun. Letupkannya untuk meletupkan 3 × 3 di sekelilingnya.',
  petir: 'Petir! 5 sebaris atau bentuk L / T meninggalkan Petir. Ia meletupkan sebaris dan selajur.',
  pair: 'Dua burung khas di papan: tukar sesama sendiri untuk kombo khas yang lebih besar!',
  cage: 'Burung dalam sangkar tidak boleh digerakkan. Letupkan burung di sebelahnya untuk membebaskannya.',
};
let tipTimer = 0;
function tipOnce(kind) {
  const seen = storeGet(K.tips, {});
  if (seen[kind]) return;
  storeSet(K.tips, { ...seen, [kind]: true });
  const el = $('#lt-tip');
  el.textContent = TIPS[kind];
  el.hidden = false;
  el.classList.remove('show');
  void el.offsetWidth;
  el.classList.add('show');
  announce(TIPS[kind]);
  clearTimeout(tipTimer);
  tipTimer = setTimeout(() => { el.hidden = true; }, 5500);
}

/** The combo badge on the board: "Kombo 3 ×2", its bar draining over the combo window. */
function renderCombo() {
  const s = session;
  const box = $('#lt-combo');
  const alive = s.g.combo >= 2 && comboAlive(s.g, s.clock);
  box.hidden = !alive;
  if (!alive) return;
  const text = `Kombo ${s.g.combo}`;
  if ($('#lt-combo-n').textContent !== text) {
    $('#lt-combo-n').textContent = text;
    $('#lt-combo-x').textContent = `×${comboMultText(s.g.combo)}`;
    box.classList.remove('pop');
    void box.offsetWidth;
    box.classList.add('pop');
  }
  const left = Math.max(0, 1 - (s.clock - s.g.lastPopT) / COMBO_WINDOW);
  $('#lt-combo-bar').style.transform = `scaleX(${left.toFixed(4)})`;
  box.classList.toggle('ending', left < 0.3);
}
const comboMultText = (c) => String(c >= 8 ? 3 : c >= 5 ? 2.5 : c >= 3 ? 2 : 1.5); // a point for decimals, as in Malaysia

function renderTimer(p) {
  const fill = $('#lt-timer-fill');
  fill.style.transform = `scaleX(${Math.min(1, p).toFixed(4)})`; // scaled, not resized: no layout each frame
  const soon = p > 0.78;
  fill.classList.toggle('soon', soon);
  $('#lt-rail').classList.toggle('soon', soon);
}

/** Drops the waiting row; `early`: seconds left on the timer when the player called it down. */
async function doDrop(early = 0) {
  const s = session;
  setBusy(s, true);
  clearHint();
  clearSel();
  const steps = dropWave(s.g, early);
  await playSteps(steps);
  if (session !== s) return;
  if (s.g.over) return finish('penuh');
  saveDailyProgress();
  setBusy(s, false);
  renderAll();
}

/**
 * While birds move or explode, the board is "moving": the idle bobbing pauses and no poses swap,
 * so the phone's effort goes to the action.
 */
function setBusy(s, busy) {
  s.busy = busy;
  $('#lt-board').classList.toggle('moving', busy);
}

/** Tapping the waiting row (or J): it drops now, with points for the seconds saved. */
function callRowEarly() {
  const s = session;
  if (!s || s.busy || s.paused || s.g.over || dialogOpen()) return;
  unlockSound();
  const left = Math.max(0, waveInterval(s.g.level) - s.idle);
  s.idle = 0;
  renderTimer(0);
  doDrop(left);
}

// ---------- the board ----------

/** Sizes one square so the rail (a full row), timer and 6 × 9 board fit the space under the HUD. */
function fit() {
  const stage = $('#lt-stage');
  const pad = parseFloat(getComputedStyle(stage).paddingBottom) || 0;
  const w = stage.clientWidth - 14;
  const hgt = stage.clientHeight - pad - 14 - 12 - 8 - 12; // (12: room above the rail's birds and below the tray)
  cell = Math.max(26, Math.min(72, Math.floor(Math.min(w / COLS, hgt / (ROWS + 1))))); // the board and the rail's row
  $('#lt-frame').style.setProperty('--cell', `${cell}px`);
  $('#lt-frame').style.setProperty('--cols', String(COLS));
}

function setPos(el, r, c) {
  el.style.setProperty('--r', String(r));
  el.style.setProperty('--c', String(c));
}

/** A bird on its tile, with its own idle rhythm (random delays) so the flock never moves in step. */
function discFor(p) {
  const disc = h('span', 'lt-disc');
  // A still image of the bird (drawn once for its colour); it bobs as a whole, and alive() swaps
  // its pose now and then (a blink, a flap).
  const img = document.createElement('img');
  img.className = 'lt-bird';
  img.alt = '';
  img.draggable = false;
  img.decoding = 'async';
  img.src = birdSrc(p.type);
  disc.append(img);
  disc.style.setProperty('--bob', `${(1.4 + Math.random() * 0.6).toFixed(2)}s`);
  disc.style.setProperty('--d1', `${(-Math.random() * 2).toFixed(2)}s`);
  return disc;
}

/** A piece's resting pose: worried in a nearly full column, else normal. */
const restPose = (el) => (el.classList.contains('worried') ? 'worried' : 'normal');
function setPose(el, pose) {
  const img = el?.querySelector('.lt-bird');
  if (img) img.src = birdSrc(Number(el.dataset.type), pose);
}
/** A pose for `ms`, then back to rest (if the bird is still there). */
function flashPose(el, pose, ms) {
  setPose(el, pose);
  setTimeout(() => { if (el.isConnected && !el.classList.contains('sel')) setPose(el, restPose(el)); }, ms);
}

/**
 * Keeps the flock alive cheaply: every so often one bird blinks, and now and then another flaps,
 * instead of every bird animating all the time. Not while birds move, in a pause, or with
 * Animasi ringan.
 */
function alive() {
  const s = session;
  if (!s || s.busy || s.paused || s.g.over || document.hidden || settings().lite) return;
  const els = [...s.els.values()].filter((el) => el.isConnected && !el.classList.contains('sel'));
  if (!els.length) return;
  const pick = () => els[Math.floor(Math.random() * els.length)];
  flashPose(pick(), 'blink', 150);
  if (Math.random() < 0.35) flashPose(pick(), 'flap', 320);
}

function pieceEl(p, r, c) {
  const el = h('div', 'lt-piece');
  el.dataset.type = String(p.type);
  el.append(discFor(p));
  setPos(el, r, c);
  dress(el, p);
  return el;
}

/** Shows a piece's special badge and padlock as they are now. */
function dress(el, p) {
  el.dataset.special = p.special ?? '';
  let badge = el.querySelector('.lt-badge');
  if (p.special && !badge) {
    badge = h('span', 'lt-badge');
    el.querySelector('.lt-disc').append(badge);
  }
  if (badge) {
    if (p.special) badge.innerHTML = BADGE[p.special];
    else badge.remove();
  }
  el.classList.toggle('locked', p.locked);
  const lock = el.querySelector('.lt-lock');
  if (p.locked && !lock) {
    const l = h('span', 'lt-lock');
    l.innerHTML = LOCK;
    el.append(l);
  } else if (!p.locked && lock) lock.remove();
}

function buildBoard() {
  const s = session;
  const layer = $('#lt-pieces');
  layer.replaceChildren();
  s.els.clear();
  s.g.grid.forEach((row, r) => row.forEach((p, c) => {
    if (!p) return;
    const el = pieceEl(p, r, c);
    s.els.set(p.id, el);
    layer.append(el);
  }));
  $('#lt-cols').replaceChildren(...Array.from({ length: COLS }, () => h('span', 'lt-col')));
}

function renderAll() {
  renderHud();
  renderRail();
  renderCols();
  snapCursor();
}

function renderHud() {
  const g = session.g;
  $('#lt-score').textContent = number(g.score);
  $('#lt-cleared').textContent = number(g.cleared);
  $('#lt-level').textContent = levelName(g.level).label;
  // Progress through this Semester (full at PhD Semester 6, the last).
  const p = g.level >= MAX_LEVEL ? 1 : (g.cleared % PER_SEMESTER) / PER_SEMESTER;
  $('#lt-level-fill').style.width = `${p * 100}%`;
}

function bump(sel) {
  const el = $(sel);
  el.classList.remove('bump');
  void el.offsetWidth;
  el.classList.add('bump');
}

/** The waiting wave above its columns; red where the column is already full. */
function renderRail() {
  const g = session.g;
  $('#lt-rail').replaceChildren(...g.wave.map((w) => {
    const el = h('div', `lt-piece lt-next${room(g, w.col) ? '' : ' danger'}`);
    el.dataset.type = String(w.type);
    el.style.setProperty('--c', String(w.col));
    el.append(discFor(w));
    if (w.locked) {
      const l = h('span', 'lt-lock');
      l.innerHTML = LOCK;
      el.querySelector('.lt-disc').append(l);
    }
    return el;
  }));
  renderTimer(session.idle / waveInterval(g.level));
}

/**
 * Columns with one space left glow amber, full ones red; a warning sounds once as one fills. The
 * music follows how close the stack is to the top (not the level): calm, tense with two spaces
 * left in a column, panicky with one or none.
 */
function renderCols() {
  const s = session;
  let full = false;
  let least = ROWS;
  [...$('#lt-cols').children].forEach((col, c) => {
    const n = room(s.g, c);
    least = Math.min(least, n);
    col.classList.toggle('warn', n === 1);
    col.classList.toggle('full', n === 0);
    if (n === 0 && s.g.wave.some((w) => w.col === c)) full = true;
    // Birds in a column that is nearly full look worried.
    for (let r = 0; r < ROWS; r++) {
      const p = s.g.grid[r][c];
      const el = p && s.els.get(p.id);
      if (el && el.classList.contains('worried') !== (n <= 1)) {
        el.classList.toggle('worried', n <= 1);
        if (!el.classList.contains('sel')) setPose(el, restPose(el));
      }
    }
  });
  setMusicMood(full || least <= 1 ? 2 : least <= 2 ? 1 : 0);
  if (full && !s.warned) {
    playSound('warn');
    appsWargaHaptic('notification', 'warning');
    announce('Awas: baris seterusnya jatuh ke lajur yang penuh!');
  }
  s.warned = full;
}

/** Says `text` to a screen reader (a hidden live region), without showing it. */
function announce(text) {
  const el = $('#lt-sr');
  el.textContent = '';
  requestAnimationFrame(() => { el.textContent = text; });
}

// ---------- effects ----------

const centre = (r, c) => ({ x: (c + 0.5) * cell, y: (r + 0.5) * cell });

function fx(el, x, y, ms) {
  if (x != null) { el.style.left = `${x}px`; el.style.top = `${y}px`; }
  $('#lt-fx').append(el);
  setTimeout(() => el.remove(), ms);
}

/**
 * A bird exploding: a white flash, a fireball, a shock ring, hot sparks and its feathers flying
 * out and drifting down. `big` (blasts, long chains) makes it larger.
 */
/**
 * A bird exploding: a fireball and (`ring`) a shock ring as page elements, and `sparks` hot
 * sparks and `feathers` of its colours on the board's particle canvas. playClear shares a fixed
 * budget of particles among all the birds that pop at once.
 */
function explode(r, c, type, { big = false, boom = true, ring = true, sparks = 5, feathers = 5 } = {}) {
  if (reduceMotion()) return;
  const { x, y } = centre(r, c);
  if (boom) fx(h('span', `lt-boom${big ? ' big' : ''}`), x, y, 520);
  if (ring) fx(h('span', 'lt-ring'), x, y, 520);
  const colours = FEATHERS[type] ?? ['#fff'];
  const now = performance.now();
  for (let i = 0; i < sparks; i++) {
    const a = (i / sparks) * Math.PI * 2 + Math.random() * 0.7;
    const d = cell * (0.6 + Math.random() * 0.6) * (big ? 1.4 : 1);
    particles.push({ kind: 's', x, y, dx: Math.cos(a) * d, dy: Math.sin(a) * d, t0: now, dur: 500, k: i % 2 ? '#fff3bf' : '#ffa94d' });
  }
  for (let i = 0; i < feathers; i++) {
    const a = Math.random() * Math.PI * 2;
    const d = cell * (0.5 + Math.random() * 0.7);
    particles.push({
      kind: 'f', x, y, dx: Math.cos(a) * d, dy: Math.sin(a) * d - cell * 0.3, t0: now, dur: 1050,
      k: colours[i % colours.length], rot: Math.random() * Math.PI * 2, spin: (Math.random() * 300 - 150) * (Math.PI / 180),
    });
  }
  if (!particleRaf) particleRaf = requestAnimationFrame(drawParticles);
}

// ---------- particles: one canvas over the board for every spark and feather ----------

let particles = [];
let particleRaf = 0;
/** The board's particle canvas, sized to the board (made when a game starts). */
function particlesCanvas() {
  let cv = $('#lt-particles');
  if (!cv) {
    cv = document.createElement('canvas');
    cv.id = 'lt-particles';
    cv.className = 'lt-particles';
    cv.setAttribute('aria-hidden', 'true');
    $('#lt-board').append(cv);
  }
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  cv.width = Math.round(cell * COLS * dpr);
  cv.height = Math.round(cell * ROWS * dpr);
  particles = [];
  return cv;
}
const easeOut = (t) => 1 - (1 - t) ** 3;
function drawParticles(now) {
  const cv = $('#lt-particles');
  if (!cv) { particleRaf = 0; return; }
  const g = cv.getContext('2d');
  const dpr = cv.width / (cell * COLS);
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, cell * COLS, cell * ROWS);
  particles = particles.filter((p) => now - p.t0 < p.dur);
  for (const p of particles) {
    const t = Math.max(0, (now - p.t0) / p.dur);
    if (p.kind === 's') {
      // A spark: flies out, shrinks and fades, with a soft halo.
      const e = easeOut(t), r = cell * 0.07 * (1 - 0.8 * t);
      const x = p.x + p.dx * e, y = p.y + p.dy * e;
      g.globalAlpha = (1 - t) * 0.35;
      g.fillStyle = p.k;
      g.beginPath(); g.arc(x, y, r * 2.4, 0, Math.PI * 2); g.fill();
      g.globalAlpha = 1 - t;
      g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
    } else {
      // A feather: bursts out in the first 30%, then drifts down, turning, and fades.
      const a = Math.min(1, t / 0.3), b = Math.max(0, (t - 0.3) / 0.7);
      const ea = easeOut(a);
      const x = p.x + p.dx * ea + p.dx * 0.15 * b;
      const y = p.y + p.dy * ea + cell * 0.7 * b;
      const scale = (0.4 + 0.6 * ea) * (1 - 0.1 * b);
      g.save();
      g.translate(x, y);
      g.rotate(p.rot + p.spin * (0.5 * ea + 0.5 * b));
      g.globalAlpha = 1 - b;
      g.fillStyle = p.k;
      g.beginPath();
      g.ellipse(0, 0, cell * 0.065 * scale, cell * 0.16 * scale, 0, 0, Math.PI * 2);
      g.fill();
      g.restore();
    }
  }
  g.globalAlpha = 1;
  particleRaf = particles.length ? requestAnimationFrame(drawParticles) : 0;
}

/**
 * Two specials swapped into each other: a flash over the whole board, the combo's own blast
 * (a huge fireball, three rows and three columns of lightning, or lightning over every bird it
 * takes), and its name.
 */
function specialComboFx(step, quick) {
  const kind = step.combo;
  const { r, c } = step.blasts[0];
  banner(`${SPECIAL_COMBOS[kind].name}!`, 'super', 1300);
  announce(`${SPECIAL_COMBOS[kind].name}! ${step.cells.length} burung diletupkan.`);
  appsWargaHaptic('notification', 'success');
  if (quick) return;
  fx(h('span', 'lt-flash'), null, null, 600);
  const { x, y } = centre(r, c);
  if (kind === 'bom+bom') {
    const b = h('span', 'lt-blast huge');
    fx(b, x, y, 650);
  } else if (kind === 'bom+petir') {
    for (const d of [-1, 0, 1]) {
      const row = h('span', 'lt-beam row');
      row.style.top = `${(r + d + 0.5) * cell}px`;
      fx(row, null, null, 600);
      const col = h('span', 'lt-beam col');
      col.style.left = `${(c + d + 0.5) * cell}px`;
      fx(col, null, null, 600);
    }
  } else {
    // One bolt per column (down to its lowest bird hit), not one per bird: at most 6, each with
    // a large glow.
    const deepest = new Map();
    for (const cc of step.cells) deepest.set(cc.c, Math.max(deepest.get(cc.c) ?? 0, cc.r));
    for (const [col, row] of deepest) {
      const bolt = h('span', 'lt-bolt');
      bolt.style.left = `${(col + 0.5) * cell}px`;
      bolt.style.height = `${(row + 0.6) * cell}px`;
      bolt.style.animationDelay = `${(Math.random() * 0.12).toFixed(2)}s`;
      fx(bolt, null, null, 650);
    }
  }
}

/** The board jolts on a big explosion. */
function shake(strong) {
  if (reduceMotion()) return;
  const b = $('#lt-board');
  b.classList.remove('jolt', 'jolt-big');
  void b.offsetWidth;
  b.classList.add(strong ? 'jolt-big' : 'jolt');
}

function banner(text, cls = '', ms = 1300) {
  fx(h('div', `lt-banner ${cls}`, text), null, null, ms);
}

// ---------- playing the rules' steps ----------

const fallMs = (rows) => Math.round(90 + 55 * Math.sqrt(Math.max(1, rows)));

async function playSteps(steps) {
  const s = session;
  const quick = reduceMotion();
  for (const step of steps) {
    if (session !== s) return;
    if (step.type === 'swap') {
      // The moved bird (ia) passes in front of the other (ib), which passes behind, a little
      // slower than other moves so the trade is easy to follow.
      const [ia, ib] = step.ids;
      const ea = ia && s.els.get(ia), eb = ib && s.els.get(ib);
      const ms = quick ? 0 : 220;
      for (const [el, to, cls] of [[ea, step.b, 'swap-front'], [eb, step.a, 'swap-back']]) {
        if (!el) continue;
        el.style.setProperty('--t', `${ms}ms`);
        el.style.setProperty('--ease', 'ease-in-out');
        if (!quick) el.classList.add(cls);
        setPos(el, ...to);
      }
      await wait(ms + 10);
      for (const el of [ea, eb]) {
        if (!el) continue;
        el.classList.remove('swap-front', 'swap-back');
        el.style.removeProperty('--ease');
      }
    } else if (step.type === 'fall') {
      let longest = 0;
      for (const m of step.moves) {
        const el = s.els.get(m.id);
        const t = fallMs(m.to[0] - m.from[0]);
        longest = Math.max(longest, t);
        el.classList.add('falling');
        el.style.setProperty('--t', `${t}ms`);
        setPos(el, ...m.to);
      }
      await wait(quick ? 0 : longest);
      for (const m of step.moves) land(s.els.get(m.id));
    } else if (step.type === 'drop') {
      const layer = $('#lt-pieces');
      let longest = 0;
      for (const sp of step.spawns) {
        const el = pieceEl(sp.piece, -1, sp.to[1]);
        s.els.set(sp.id, el);
        layer.append(el);
      }
      void layer.offsetWidth; // start from above the board
      const lands = [];
      for (const sp of step.spawns) {
        const el = s.els.get(sp.id);
        const t = fallMs(sp.to[0] + 1);
        longest = Math.max(longest, t);
        lands.push(quick ? 0 : t / 1000);
        el.classList.add('falling');
        el.style.setProperty('--t', `${t}ms`);
        setPos(el, ...sp.to);
      }
      // The row's sound: a whoosh as it falls, a thud as each bird lands, a chirp when all are down.
      playSound('row', lands);
      appsWargaHaptic('impact', 'medium');
      await wait(quick ? 0 : longest);
      for (const sp of step.spawns) land(s.els.get(sp.id));
      if (step.spawns.some((sp) => sp.piece.locked)) tipOnce('cage');
    } else if (step.type === 'clear') {
      await playClear(s, step, quick);
      for (const m of step.made) tipOnce(m.kind);
      if (s.g.grid.flat().filter((p) => p?.special).length >= 2) tipOnce('pair');
    } else if (step.type === 'early') {
      // Called down early: points for the time saved, shown by the row.
      playSound('tap');
      if (!quick) fx(h('span', 'lt-float early', `+${number(step.bonus)} Pantas!`), (COLS / 2) * cell, cell * 1.9, 900);
      renderHud();
      bump('#lt-score');
    } else if (step.type === 'streak') {
      // A move in a combo: its bonus.
      playSound('combo', step.combo);
      banner(`Kombo ${step.combo}! ×${comboMultText(step.combo)} +${number(step.extra)}`, 'combo', 900);
      announce(`Kombo ${step.combo}. Bonus ${step.extra} mata.`);
      renderHud();
      bump('#lt-score');
      renderCombo();
    } else if (step.type === 'level') {
      s.popup = true;
      await levelPopup(s, step.level, quick);
      s.popup = false;
    } else if (step.type === 'over') {
      const col = $('#lt-cols').children[step.col];
      col?.classList.add('full');
    }
  }
}

/**
 * The "Tahniah!" popup on every level up: the new level, what is harder now (the row speed, caged
 * birds, a new bird), and confetti; a new programme gets the graduation version (mortarboards
 * tossed, a longer fanfare). It closes by itself after a moment, or on a tap; the row timer
 * waits meanwhile (the board is busy).
 */
async function levelPopup(s, level, quick) {
  const n = levelName(level);
  const grad = n.first;
  playSound(grad ? 'graduate' : 'level');
  appsWargaHaptic('notification', 'success');
  const lines = [`Burung jatuh setiap ${waveInterval(level).toLocaleString('ms-MY', { maximumFractionDigits: 1 })} saat`];
  const cage = Math.round(lockChance(level) * 100);
  if (cage > 0) lines.push(`${cage}% burung dalam sangkar`);
  const newBird = typeCount(level) > typeCount(level - 1);
  if (n.endless) lines.unshift('Tahap terakhir: main sampai tersangkut!');
  const pop = h('div', `lt-levelup${grad ? ' grad' : ''}`);
  pop.setAttribute('role', 'status');
  const card = h('div', 'lt-levelup-card');
  const cap = h('span', 'lt-levelup-cap');
  cap.innerHTML = '<svg viewBox="0 0 48 40" aria-hidden="true"><path d="M13 18v8c0 4 5 6 11 6s11-2 11-6v-8" fill="#2b1a3d"/><path d="M24 4 46 14 24 24 2 14z" fill="#3a2452" stroke="#120a1c" stroke-width="1.4" stroke-linejoin="round"/><path d="M24 14l14 5v10" fill="none" stroke="#fcc419" stroke-width="2" stroke-linecap="round"/><circle cx="24" cy="14" r="2" fill="#fcc419"/><path d="M36 28h4l1 6h-6z" fill="#fcc419"/></svg>';
  card.append(cap, h('p', 'lt-levelup-hi', 'Tahniah!'));
  card.append(h('p', 'lt-levelup-title', n.endless ? n.programme : grad ? `Masuk ${n.programme}!` : n.label));
  if (grad && !n.endless && n.semester) card.append(h('p', 'lt-levelup-sub', `Semester ${n.semester}`));
  const ul = h('ul', 'lt-levelup-list');
  for (const line of lines) ul.append(h('li', null, line));
  card.append(ul);
  if (newBird) {
    const nb = h('div', 'lt-levelup-new');
    const pic = h('span', 'lt-levelup-bird');
    const img = document.createElement('img');
    img.alt = '';
    img.src = birdSrc(typeCount(level) - 1);
    pic.append(img);
    nb.append(pic, h('span', null, 'Burung baharu muncul!'));
    card.append(nb);
  }
  card.append(h('small', 'lt-levelup-tap', 'Ketik untuk teruskan'));
  pop.append(card);
  // Confetti, and for a new programme mortarboards tossed up.
  if (!quick) {
    const colours = ['#f03e3e', '#228be6', '#40c057', '#fcc419', '#ae3ec9', '#fff'];
    for (let i = 0; i < (grad ? 36 : 22); i++) {
      const c = h('i', 'lt-levelup-bit');
      c.style.left = `${Math.random() * 100}%`;
      c.style.setProperty('--k', colours[i % colours.length]);
      c.style.setProperty('--dl', `${(Math.random() * 0.6).toFixed(2)}s`);
      c.style.setProperty('--dur', `${(1.4 + Math.random() * 1.1).toFixed(2)}s`);
      c.style.setProperty('--sx', `${Math.round(Math.random() * 60 - 30)}px`);
      pop.append(c);
    }
    if (grad) {
      for (let i = 0; i < 5; i++) {
        const t = h('span', 'lt-levelup-toss');
        t.innerHTML = cap.innerHTML;
        t.style.left = `${10 + i * 19}%`;
        t.style.setProperty('--dl', `${(i * 0.09).toFixed(2)}s`);
        t.style.setProperty('--spin', `${i % 2 ? 380 : -380}deg`);
        pop.append(t);
      }
    }
  }
  $('#lt-frame').append(pop);
  announce(`Tahniah! ${grad ? `Masuk ${n.programme}. ` : ''}Naik ke ${n.label}. ${lines.join('. ')}.${newBird ? ' Burung baharu muncul.' : ''}`);
  // Up to ~2 s (a little longer for a graduation), or until a tap.
  await new Promise((resolve) => {
    const key = (e) => { if (['Enter', ' ', 'Escape'].includes(e.key)) { e.preventDefault(); e.stopPropagation(); done(); } };
    const done = () => {
      clearTimeout(timer);
      pop.removeEventListener('pointerdown', done);
      document.removeEventListener('keydown', key, true);
      resolve();
    };
    const timer = setTimeout(done, grad ? 2600 : 2000);
    pop.addEventListener('pointerdown', done);
    document.addEventListener('keydown', key, true);
  });
  pop.classList.add('closing');
  await wait(quick ? 0 : 220);
  pop.remove();
  if (session === s) renderHud();
}

function land(el) {
  if (!el) return;
  el.classList.remove('falling');
  if (reduceMotion()) return;
  el.classList.remove('landed');
  void el.offsetWidth;
  el.classList.add('landed');
}

async function playClear(s, step, quick) {
  if (step.combo) specialComboFx(step, quick);
  for (const b of step.blasts) {
    const { x, y } = centre(b.r, b.c);
    if (SPECIAL_COMBOS[b.kind]) continue; // drawn by specialComboFx
    if (b.kind === 'bom') {
      if (!quick) fx(h('span', 'lt-blast'), x, y, 480);
    } else if (!quick) {
      const row = h('span', 'lt-beam row');
      row.style.top = `${y}px`;
      fx(row, null, null, 480);
      const col = h('span', 'lt-beam col');
      col.style.left = `${x}px`;
      fx(col, null, null, 480);
    }
  }
  if (step.combo) playSound('supercombo');
  else if (step.blasts.some((b) => b.kind === 'petir')) playSound('petir');
  else if (step.blasts.length) playSound('bom');
  playSound('pop', step.chain);
  appsWargaHaptic('impact', step.blasts.length ? 'heavy' : step.chain > 1 ? 'medium' : 'light');
  const big = step.blasts.length > 0 || step.chain >= 3;
  // However many birds pop at once, at most 60 sparks and feathers in all (16 with
  // Animasi ringan), a fireball on at most 12 birds (spread out) and a shock ring on at most 8.
  const lite = settings().lite;
  const budget = lite ? 16 : 60;
  const per = Math.max(1, Math.floor(budget / Math.max(1, step.cells.length)));
  const sparks = Math.min(big ? 8 : 5, Math.ceil(per / 2));
  const feathers = Math.min(big ? 8 : 5, per - sparks);
  const boomEvery = Math.ceil(step.cells.length / 12);
  step.cells.forEach((c, i) => {
    const el = s.els.get(c.id);
    if (el) { el.classList.remove('sel', 'worried'); el.classList.add('pop'); }
    explode(c.r, c.c, c.type, { big, boom: i % boomEvery === 0, ring: !lite && i < 8, sparks, feathers });
  });
  if (big || step.cells.length >= 5) shake(step.blasts.length > 0 || Boolean(step.combo));
  for (const m of step.made) {
    const el = s.els.get(m.id);
    dress(el, { special: m.kind, locked: false });
    if (!quick) { el.classList.remove('made'); void el.offsetWidth; el.classList.add('made'); }
  }
  if (step.unlocked.length) {
    playSound('unlock');
    for (const id of step.unlocked) s.els.get(id)?.classList.add('unlocking');
  }
  // Points float up from the middle of what popped.
  if (step.cells.length) {
    const r = step.cells.reduce((a, c) => a + c.r, 0) / step.cells.length;
    const c = step.cells.reduce((a, x) => a + x.c, 0) / step.cells.length;
    const { x, y } = centre(r, c);
    if (!quick) fx(h('span', 'lt-float', `+${number(step.points)}`), x, y, 900);
  }
  if (step.chain >= 2) banner(PRAISE[Math.min(5, step.chain)], 'chain', 800);
  if (step.made.length) announce(step.made.map((m) => `${SPECIAL_NAMES[m.kind]}!`).join(' '));
  renderHud();
  bump('#lt-score');
  await wait(quick ? 120 : 270);
  for (const c of step.cells) {
    s.els.get(c.id)?.remove();
    s.els.delete(c.id);
  }
  for (const id of step.unlocked) {
    const el = s.els.get(id);
    if (!el) continue;
    el.classList.remove('unlocking', 'locked');
    el.querySelector('.lt-lock')?.remove();
  }
}

// ---------- the player's moves ----------

const same = (a, b) => a && b && a[0] === b[0] && a[1] === b[1];
const neighbours = (a, b) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) === 1;
const pieceAt = ([r, c]) => session?.g.grid[r]?.[c] ?? null;

function select(at) {
  clearSel();
  session.sel = at;
  const p = pieceAt(at);
  const el = p && session.els.get(p.id);
  if (!el) return;
  el.classList.add('sel');
  // Picked: it flaps, excited (two poses in turn).
  let up = false;
  session.selFlap = setInterval(() => { up = !up; setPose(el, up ? 'flap' : 'normal'); }, 120);
}

function clearSel() {
  if (!session) return;
  clearInterval(session.selFlap);
  const p = session.sel && pieceAt(session.sel);
  const el = p && session.els.get(p.id);
  if (el) { el.classList.remove('sel'); setPose(el, restPose(el)); }
  session.sel = null;
}

/** A refused move: the item gives a little shake (and a locked one says so). */
function nope(at) {
  const p = pieceAt(at);
  playSound('nope');
  appsWargaHaptic('notification', 'error');
  if (!p) return;
  const el = session.els.get(p.id);
  el.classList.remove('nope');
  void el.offsetWidth;
  el.classList.add('nope');
  if (p.locked) toast('Dalam sangkar! Letupkan burung di sebelahnya.');
}

async function trySwap(a, b) {
  const s = session;
  if (!s || s.busy || s.paused || s.g.over) return;
  clearHint();
  if (!canSwap(s.g, a, b)) {
    nope(pieceAt(b)?.locked ? b : a);
    return;
  }
  clearSel();
  setBusy(s, true);
  const t0 = performance.now();
  playSound('swap');
  const steps = swap(s.g, a, b, s.clock);
  await playSteps(steps);
  // A move that pops something takes at least MIN_MOVE_S (also with reduced motion).
  if (steps.some((x) => x.type === 'clear')) {
    const rest = MIN_MOVE_S * 1000 - (performance.now() - t0);
    if (rest > 0) await wait(rest);
  }
  if (session !== s) return;
  saveDailyProgress();
  setBusy(s, false);
  renderAll();
}

/** A tap: picks an item, or trades the picked one with the tapped neighbour (or space beside it). */
function tap(at) {
  const s = session;
  if (s.busy) return;
  clearHint();
  if (s.sel && same(s.sel, at)) return clearSel();
  if (s.sel && neighbours(s.sel, at)) return trySwap(s.sel, at);
  const p = pieceAt(at);
  if (!p) return clearSel();
  if (p.locked) { clearSel(); return nope(at); }
  playSound('pick');
  select(at);
}

function cellAt(e) {
  const rect = $('#lt-board').getBoundingClientRect();
  const c = Math.floor((e.clientX - rect.left) / cell);
  const r = Math.floor((e.clientY - rect.top) / cell);
  return r >= 0 && r < ROWS && c >= 0 && c < COLS ? [r, c] : null;
}

function onPointerDown(e) {
  const s = session;
  if (!s || s.paused || s.g.over || e.button > 0) return;
  unlockSound();
  hideCursor(); // a finger or the mouse: the keyboard's cursor goes away until a key is used
  const at = cellAt(e);
  if (!at) return;
  $('#lt-board').setPointerCapture?.(e.pointerId);
  // A swipe moves the item under the finger; from an empty cell it does nothing (a tap there
  // still moves the picked item into it).
  pointer = { id: e.pointerId, x: e.clientX, y: e.clientY, at, moved: false, onPiece: Boolean(pieceAt(at)) };
}

function onPointerMove(e) {
  if (!pointer || pointer.id !== e.pointerId || pointer.moved) return;
  const dx = e.clientX - pointer.x, dy = e.clientY - pointer.y;
  if (Math.max(Math.abs(dx), Math.abs(dy)) < cell * 0.4) return;
  pointer.moved = true;
  const [r, c] = pointer.at;
  const to = Math.abs(dx) > Math.abs(dy) ? [r, c + Math.sign(dx)] : [r + Math.sign(dy), c];
  if (!session.busy && pointer.onPiece) trySwap(pointer.at, to);
}

function onPointerUp(e) {
  if (!pointer || pointer.id !== e.pointerId) return;
  const p = pointer;
  pointer = null;
  if (!p.moved && session && !session.paused) tap(p.at);
}

/** The keyboard cursor is only for keyboard play: touch or the mouse hides it. */
function hideCursor() {
  const s = session;
  if (!s) return;
  s.held = false;
  const cursor = $('#lt-cursor');
  cursor.hidden = true;
  cursor.classList.remove('held');
}

/**
 * After birds pop and fall, the cursor stays on a bird rather than a space: if its square is now
 * empty, it moves down its column to the bird that fell there (or the column's bottom).
 */
function snapCursor() {
  const s = session;
  const cursor = $('#lt-cursor');
  if (!s || cursor.hidden || pieceAt(s.cursor)) return;
  let [r, c] = s.cursor;
  while (r < ROWS - 1 && !pieceAt([r, c])) r++;
  s.cursor = [r, c];
  s.held = false;
  cursor.classList.remove('held');
  setPos(cursor, r, c);
}

/**
 * Where an arrow takes the cursor: from bird to bird, as a finger can only pick birds. Up and
 * down stay in the column while there are birds; left and right go to the next column that has
 * any, on the same row if a bird is there, else onto that column's top bird. null: nowhere to go.
 */
function cursorStep(s, [dr, dc]) {
  const [r, c] = s.cursor;
  if (dr) {
    const to = [r + dr, c];
    return to[0] >= 0 && to[0] < ROWS && pieceAt(to) ? to : null;
  }
  for (let cc = c + dc; cc >= 0 && cc < COLS; cc += dc) {
    if (pieceAt([r, cc])) return [r, cc];
    let top = 0;
    while (top < ROWS && !pieceAt([top, cc])) top++;
    if (top < ROWS) return [top, cc];
  }
  return null;
}

// Keyboard: the arrows move a cursor; Space or Enter picks the item up, then an arrow trades it.
const ARROWS = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
function onKey(e) {
  const s = session;
  if (document.body.dataset.screen !== 'game' || !s || dialogOpen() || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === 'Escape' || e.key === 'p' || e.key === 'P') { e.preventDefault(); return s.paused ? resume() : pause(); }
  if (e.key === 'j' || e.key === 'J') { e.preventDefault(); return callRowEarly(); }
  if (s.paused || s.g.over) return;
  const cursor = $('#lt-cursor');
  const d = ARROWS[e.key];
  if (d) {
    e.preventDefault();
    cursor.hidden = false;
    if (s.held) {
      // Holding a bird: the arrow trades it with its neighbour (or slides it sideways into a
      // space); the cursor goes with it, and follows it down if it falls (snapCursor).
      const from = s.cursor, to = [from[0] + d[0], from[1] + d[1]];
      s.held = false;
      cursor.classList.remove('held');
      if (canSwap(s.g, from, to)) { s.cursor = to; setPos(cursor, ...to); }
      trySwap(from, to);
      return;
    }
    const next = cursorStep(s, d);
    if (!next) return;
    s.cursor = next;
    setPos(cursor, ...next);
  } else if (e.key === ' ' || e.key === 'Enter') {
    e.preventDefault();
    cursor.hidden = false;
    setPos(cursor, ...s.cursor);
    s.held = !s.held && Boolean(pieceAt(s.cursor)) && !pieceAt(s.cursor).locked;
    cursor.classList.toggle('held', s.held);
    if (pieceAt(s.cursor)?.locked) nope(s.cursor);
  }
}

// ---------- the end of a game ----------

const REASON = {
  penuh: 'Kelas penuh! Tiada lagi tempat duduk untuk burung baharu.',
  quit: 'Anda keluar sebelum tamat.',
  closed: 'Permainan ditutup sebelum tamat. Cubaan hari ini dikira dengan markah setakat itu.',
};

/** Whole seconds since `t`, rounded up (the board's points-a-second limit is set from this). */
const secondsSince = (t) => Math.min(86400, Math.max(1, Math.ceil((Date.now() - t) / 1000)));

/** What the result screen and the board need from a game. */
function resultOf(g, seconds, reason) {
  return { ...summary(g), seconds, daily: g.daily, reason };
}

/** Keeps a finished game: stats, today's Cabaran Harian, Arked Warga's progress, the board. */
function record(result) {
  lastResult = { ...result, submit: { status: 'pending' } };
  const t = stats();
  t.played++;
  t.best = Math.max(t.best, result.points);
  t.bestLevel = Math.max(t.bestLevel, result.level);
  storeSet(K.stats, t);
  if (result.daily) {
    const date = todayKL();
    storeSet(K.daily, { date, status: 'done', result });
    recordProgress({ date, status: 'done', won: true, score: result.points });
  }
  submitResult(lastResult);
}

function finish(reason, { navigate = true } = {}) {
  const s = session;
  if (!s) return;
  const g = s.g;
  end(g, reason);
  cancelAnimationFrame(s.raf);
  stopMusic();
  if ($('#dlg-leave').open) $('#dlg-leave').close();
  record(resultOf(g, secondsSince(s.startedAt), reason));
  if (!navigate) return stopRound();
  // Game over on the board for a moment, then the result.
  s.busy = true;
  clearSel();
  playSound('end');
  appsWargaHaptic('notification', 'error');
  $('#lt-board').classList.add('over');
  banner('Kelas Penuh!', 'over', 1600);
  announce(`Permainan tamat. ${number(g.score)} mata.`);
  stopRound();
  setTimeout(() => {
    if (document.body.dataset.screen === 'game' && !session) go('tamat', { replace: true });
  }, reduceMotion() ? 600 : 1500);
}

function renderResult() {
  const r = lastResult;
  show('result');
  $('#res-title').textContent = r.daily ? 'Cabaran Harian' : 'Tamat!';
  $('#res-detail').textContent = REASON[r.reason] ?? '';
  $('#res-score').textContent = number(r.points);
  $('#res-level').textContent = levelName(r.level).short;
  $('#res-cleared').textContent = number(r.cleared);
  $('#res-chain').textContent = r.bestChain ? `×${r.bestChain}` : '–';
  $('#res-combo').textContent = r.bestCombo >= 2 ? String(r.bestCombo) : '–';
  const made = [];
  if (r.made?.bom) made.push(`${r.made.bom} Mercun`);
  if (r.made?.petir) made.push(`${r.made.petir} Petir`);
  if (r.specialCombos) made.push(`${r.specialCombos} kombo khas`);
  $('#res-made').textContent = made.length ? `Dibuat: ${made.join(' · ')}` : '';
  $('#res-made').hidden = !made.length;
  $('#res-time').textContent = `${number(r.swaps)} gerakan · ${lb.formatDuration(r.seconds)}`;
  $('#res-again').textContent = r.daily ? 'Main Bebas' : 'Main Lagi';
  renderSubmit();
}

function renderSubmit() {
  if (!lastResult || document.body.dataset.screen !== 'result') return;
  const r = lastResult, box = $('#res-submit');
  box.replaceChildren();
  box.className = 'res-submit';
  const st = r.submit?.status ?? 'done';
  box.textContent = st === 'offline' ? 'Papan markah belum dikonfigurasi. Markah disimpan dalam peranti ini sahaja.'
    : st === 'sending' || st === 'pending' ? 'Menghantar markah…'
      : st === 'done' ? 'Markah direkodkan.'
        : st === 'saved' ? 'Keputusan Cabaran Harian anda hari ini.'
          : `Gagal menghantar: ${r.submit.message}`;
  if (st === 'done') box.classList.add('ok');
  if (st === 'error') {
    box.classList.add('err');
    const retry = h('button', 'btn btn-link', 'Cuba semula');
    retry.type = 'button';
    retry.addEventListener('click', () => submitResult(r));
    box.append(retry);
  }
}

/** Sends the game to the boards (arked_record), as every Warga game does. */
async function submitResult(r) {
  if (r.sending) return;
  const profile = loadProfile();
  if (!profile || !lb.boardsConfigured()) { r.submit = { status: 'offline' }; renderSubmit(); return; }
  r.sending = true;
  r.submit = { status: 'sending' };
  renderSubmit();
  try {
    await lb.recordRound({ game: GAME_ID, profile, points: r.points, seconds: r.seconds, date: todayKL() });
    r.submit = { status: 'done' };
  } catch (err) {
    r.submit = { status: 'error', message: err.code === '54000' ? 'Terlalu cepat. Tunggu sebentar.' : err.message };
  } finally {
    r.sending = false;
    if (lastResult === r) renderSubmit();
  }
}

// ---------- leaderboard ----------

function openBoard() { show('board'); setTab(boardTab); }
function setTab(tab) {
  boardTab = tab;
  const buttons = [...document.querySelectorAll('.tabs [data-tab]')];
  buttons.forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
  $('.tabs').style.setProperty('--tab-index', String(buttons.findIndex((b) => b.dataset.tab === tab)));
  loadTab(tab);
}
function boardMessage(text, retry) {
  const box = h('div', 'lb-empty');
  box.append(h('p', null, text));
  if (retry) {
    const b = h('button', 'btn btn-ghost', 'Cuba semula');
    b.type = 'button';
    b.addEventListener('click', retry);
    box.append(b);
  }
  $('#lb-body').replaceChildren(box);
}
async function loadTab(tab) {
  const request = ++boardRequest;
  $('#board-sub').textContent = tab === 'daily' ? 'Jumlah markah hari ini' : tab === 'alltime' ? 'Jumlah markah & masa bermain' : 'Jumlah markah semua pemain kampus';
  if (!lb.boardsConfigured()) return boardMessage('Papan markah belum dikonfigurasi.');
  $('#lb-body').replaceChildren(h('div', 'lb-loading', 'Memuatkan…'));
  const profile = loadProfile();
  try {
    const rows = tab === 'campus' ? await lb.topCampuses(GAME_ID) : await lb.topPlayers(GAME_ID, profile?.playerId, tab === 'daily' ? todayKL() : null);
    if (request !== boardRequest) return;
    if (!rows?.length) return boardMessage(tab === 'daily' ? 'Belum ada markah hari ini. Jadilah yang pertama!' : 'Belum ada markah.');
    $('#lb-body').replaceChildren(tab === 'campus' ? lb.campusList(rows, profile?.campus) : lb.playersList(rows, { showPlays: tab === 'daily' }));
  } catch (err) {
    if (request === boardRequest) boardMessage(`Gagal memuatkan: ${err.message}`, () => loadTab(tab));
  }
}

// ---------- wiring ----------

function init() {
  initFromArked();
  initAppsWarga();
  initProfile();
  const help = () => $('#dlg-help').showModal();
  $('#btn-help').addEventListener('click', help);
  $('#btn-pause-help').addEventListener('click', help);
  $('#help-close').addEventListener('click', () => $('#dlg-help').close());
  $('#btn-hub').addEventListener('click', backToArked);
  $('#btn-close-app').addEventListener('click', closeMiniApp);
  $('#btn-version').addEventListener('click', () => { $('#btn-version').disabled = true; toast('Memuat semula…'); hardReload(); });
  $('#set-sound').addEventListener('click', () => {
    storeSet(K.settings, { ...settings(), sound: !settings().sound });
    renderSettings();
    appsWargaHaptic('selection');
    unlockSound();
    playSound('tap');
  });
  $('#set-lite').addEventListener('click', () => {
    storeSet(K.settings, { ...settings(), lite: !settings().lite, liteChecked: true });
    renderSettings();
    appsWargaHaptic('selection');
  });
  $('#set-music').addEventListener('click', () => {
    storeSet(K.settings, { ...settings(), music: !settings().music });
    renderSettings();
    appsWargaHaptic('selection');
    unlockSound();
    playSound('tap');
    if (settings().music && session && !session.paused && !session.g.over) startMusic();
  });

  $('#btn-daily').addEventListener('click', () => go('harian'));
  $('#btn-free').addEventListener('click', () => go('bebas'));
  $('#btn-board').addEventListener('click', () => go('papan'));
  $('#btn-quit').addEventListener('click', quitRound);
  $('#btn-pause').addEventListener('click', () => (session?.paused ? resume() : pause()));
  $('#btn-resume').addEventListener('click', resume);
  $('#leave-stay').addEventListener('click', () => $('#dlg-leave').close());
  $('#leave-go').addEventListener('click', confirmLeave);
  $('#res-home').addEventListener('click', () => go(''));
  $('#res-again').addEventListener('click', () => go('bebas', { replace: true }));
  $('#res-board').addEventListener('click', () => { boardTab = 'daily'; go('papan'); });
  $('#btn-board-back').addEventListener('click', () => go(''));
  $('#btn-board-refresh').addEventListener('click', () => loadTab(boardTab));
  for (const b of document.querySelectorAll('.tabs [data-tab]')) b.addEventListener('click', () => setTab(b.dataset.tab));

  const board = $('#lt-board');
  $('#lt-rail').addEventListener('click', callRowEarly);
  board.addEventListener('pointerdown', onPointerDown);
  // Reached with Tab: show the cursor at once (it is the board's focus indicator).
  board.addEventListener('focus', () => {
    if (!session || !board.matches(':focus-visible')) return;
    const cursor = $('#lt-cursor');
    cursor.hidden = false;
    setPos(cursor, ...session.cursor);
    snapCursor();
  });
  board.addEventListener('pointermove', onPointerMove);
  board.addEventListener('pointerup', onPointerUp);
  board.addEventListener('pointercancel', () => { pointer = null; });
  document.addEventListener('keydown', onKey);
  // Away from the game (another app, another tab, AppsWarga in the background): pause.
  document.addEventListener('visibilitychange', () => document.hidden && pause());
  window.addEventListener('appswargaDeactivated', pause);
  window.addEventListener('blur', pause);
  window.addEventListener('resize', () => { if (session) fit(); });
  window.addEventListener('hashchange', route);
  settleClosedDaily();
  preloadBirds(); // every bird's poses, decoded before the first game
  if (!storeGet(K.seenHelp, false)) {
    storeSet(K.seenHelp, true);
    help();
  }
  route();
  requestAnimationFrame(() => notifyAppReady());
  // ?debug: the game for browser tests (as Kejar Lapan's window.__kl).
  if (new URLSearchParams(location.search).has('debug')) {
    window.__lt = { get session() { return session; }, rebuild: () => { buildBoard(); renderAll(); }, trySwap };
  }
}

init();
