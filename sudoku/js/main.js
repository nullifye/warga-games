// Sudoku: screens, Cabaran Harian (resumes after a reload, its clock keeps running) and Main Bebas
// (its clock pauses), the board (select a cell, then a number; notes, erase, undo, hints),
// results and the leaderboard. Puzzles come from generator.js, the rules from rules.js.
import {
  LEVELS, MAX_MISTAKES, MAX_HINTS, dailyPuzzle, dailyLevel, puzzleNumber, newGame, place, toggleNote, erase,
  undo, hint, remaining, isGiven, isRight, isWrong, saveGame, restoreGame, summary, scoreFor,
} from './rules.js';
import { makePuzzle, PEERS, UNITS, LEVEL_RULES, rowOf, colOf } from './generator.js';
import {
  setMuted, unlockSound, play as playSound, setMusicOn, startMusic, stopMusic, setTrack, previewMusic, TRACKS,
} from './sound.js';
import { initAppsWarga, appsWargaHaptic, appsWargaShare, closeMiniApp, notifyAppReady } from '../../shared/appswarga.js';
import { initFromArked, backToArked, shareUrl } from '../../shared/arked-link.js';
import { initProfile, loadProfile, withProfile } from '../../shared/profile.js';
import { gameKey, readShared, writeShared } from '../../shared/shared-store.js';
import { todayKL, randomSeed, dayNumber } from '../../shared/rng.js';
import * as lb from '../../shared/leaderboard.js';
import { createBoard } from '../../shared/board.js';
import { hardReload } from '../../shared/reload.js';

const GAME_ID = 'sudoku';
const board = createBoard({ game: GAME_ID }); // Papan Markah (shared/board.js)
const PROGRESS_KEY = gameKey(GAME_ID);
const SCREENS = ['home', 'game', 'result', 'board'];
const K = { stats: 'sudoku.stats', settings: 'sudoku.settings', daily: 'sudoku.daily', seenHelp: 'sudoku.seenHelp' };
const DAYS = ['Ahad', 'Isnin', 'Selasa', 'Rabu', 'Khamis', 'Jumaat', 'Sabtu'];
const $ = (sel) => document.querySelector(sel);
const number = (n) => Number(n).toLocaleString('ms-MY');
const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

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

/** "7:42", or "1:02:05" past an hour. */
function formatTime(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds));
  const hrs = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return hrs ? `${hrs}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
}
/** "Rabu, 2 Disember" for a YYYY-MM-DD key. */
const formatDate = (date) => new Intl.DateTimeFormat('ms-MY', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(`${date}T00:00:00Z`));

function settings() {
  const s = { level: 'sederhana', sound: true, music: true, track: 'lofi', ...storeGet(K.settings, {}) };
  if (!LEVELS[s.level]) s.level = 'sederhana';
  if (!TRACKS[s.track]) s.track = 'lofi';
  return s;
}
const emptyStats = () => ({ played: 0, won: 0, best: 0, streak: 0, maxStreak: 0, lastWinDate: null });
const stats = () => ({ ...emptyStats(), ...storeGet(K.stats, {}) });
const loadDaily = (date) => { const d = storeGet(K.daily, null); return d?.date === date ? d : null; };
/** The daily streak as it stands on `today`: it lapses once a day goes by without a win. */
const currentStreak = (st, today = todayKL()) => (st.lastWinDate && dayNumber(today) - dayNumber(st.lastWinDate) <= 1 ? st.streak : 0);

/**
 * session: { g (rules game), mode 'daily' | 'free', date, startedAt (daily: ms), active (free:
 * seconds played), lastTs, paused, sel (cell or -1), pencil, cells (the 81 elements), clock,
 * ending, leaving }. null when no game is open.
 */
let session = null;
let lastResult = null;

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
    const mode = name === 'harian' ? 'daily' : 'free';
    if (session?.mode === mode && !session.ending) return show('game');
    if (!loadProfile()) renderHome(); // behind the profile dialog
    return withProfile(mode === 'daily' ? startDaily : startFree);
  }
  // The phone's Back in a Main Bebas puzzle with work in it: stay and ask first.
  if (mustAsk()) {
    history.pushState({ up: true }, '', '#/bebas');
    return askLeave();
  }
  leaveGame();
  if (name === 'tamat' && lastResult) return renderResult();
  if (name === 'papan') return openBoard();
  renderHome();
}

// ---------- home ----------

function renderSettings() {
  const s = settings();
  setMuted(!s.sound);
  for (const b of document.querySelectorAll('[data-level]')) b.setAttribute('aria-pressed', String(b.dataset.level === s.level));
  const [lo, hi] = LEVEL_RULES[s.level].givens;
  $('#level-hint').textContent = `${lo}–${hi} petak diberi`;
  $('#free-text').textContent = `Teka-teki baharu pada tahap ${LEVELS[s.level].name}.`;
  $('#set-sound').setAttribute('aria-checked', String(s.sound));
  $('#set-sound-hint').textContent = s.sound ? 'Kesan bunyi' : 'Senyap';
  setMusicOn(s.music);
  $('#set-music').setAttribute('aria-checked', String(s.music));
  $('#set-music-hint').textContent = s.music ? 'Muzik latar semasa bermain' : 'Senyap';
  setTrack(s.track);
  for (const b of document.querySelectorAll('[data-track]')) b.setAttribute('aria-pressed', String(b.dataset.track === s.track));
  $('#track-row').classList.toggle('off', !s.music);
  $('#track-hint').textContent = s.music ? 'Ketik untuk dengar sekejap' : 'Hidupkan Muzik untuk mendengar';
}

function saveSetting(key, value) {
  storeSet(K.settings, { ...settings(), [key]: value });
  renderSettings();
  appsWargaHaptic('selection');
}

function renderHome() {
  show('home');
  renderSettings();
  const date = todayKL();
  const level = LEVELS[dailyLevel(date)].name;
  $('#daily-date').textContent = `${formatDate(date)} · ${level}`;
  const d = loadDaily(date);
  if (d?.status === 'done') {
    const r = d.result;
    $('#daily-status').textContent = r.won
      ? `Selesai dalam ${formatTime(r.seconds)} · ${number(r.points)} mata. Teka-teki baharu esok!`
      : 'Tidak berjaya hari ini. Cuba lagi esok!';
    $('#btn-daily').textContent = 'Keputusan';
  } else if (d?.status === 'playing') {
    $('#daily-status').textContent = `Belum selesai · ${formatTime((Date.now() - d.startedAt) / 1000)}. Masa masih dikira!`;
    $('#btn-daily').textContent = 'Sambung';
  } else {
    $('#daily-status').textContent = 'Teka-teki yang sama untuk semua pemain hari ini.';
    $('#btn-daily').textContent = 'Main';
  }
  const t = stats();
  $('#st-won').textContent = number(t.won);
  $('#st-best').textContent = number(t.best);
  $('#st-streak').textContent = number(currentStreak(t, date));
}

/** Tells Arked Warga what was played (arked.game.sudoku): when, and today's Cabaran Harian. */
function recordProgress(daily) {
  const prev = readShared(PROGRESS_KEY);
  const keep = prev?.daily?.date === todayKL() ? prev.daily : null;
  writeShared(PROGRESS_KEY, { lastPlayedAt: Date.now(), daily: daily === undefined ? keep : daily });
}

// ---------- starting and leaving ----------

/** Shows the game screen at once, then makes the puzzle (it can take a moment on a slow phone). */
function openGame(mode, label, make) {
  unlockSound();
  stopGame();
  show('game');
  $('#game-mode').textContent = label;
  const b = $('#sd-board');
  b.className = 'sd-board';
  b.replaceChildren(h('p', 'sd-loading', 'Menyediakan teka-teki…'));
  $('#sd-pause').hidden = true;
  const token = {};
  openGame.token = token;
  requestAnimationFrame(() => setTimeout(() => {
    if (openGame.token !== token) return;
    const s = make();
    if (!s) return;
    session = { mode, sel: -1, pencil: false, paused: false, active: 0, lastTs: performance.now(), clock: 0, ending: false, leaving: false, ...s };
    buildBoard();
    renderAll();
    session.clock = setInterval(tick, 250);
    tick();
    if (session.g.over) return endGame();
    stopMusic({ reset: true });
    startMusic();
  }, 0));
}

function startDaily() {
  const date = todayKL();
  const d = loadDaily(date);
  if (d?.status === 'done') {
    lastResult = d.result;
    return go('tamat', { replace: true });
  }
  const level = dailyLevel(date);
  openGame('daily', `Cabaran Harian #${puzzleNumber(date)} · ${LEVELS[level].name}`, () => {
    const made = dailyPuzzle(date);
    // Resume today's puzzle if the save belongs to it; otherwise start it afresh.
    const restored = d?.status === 'playing' ? restoreGame(made, d.game, { daily: true, date }) : null;
    const g = restored ?? newGame({ ...made, daily: true, date });
    const startedAt = restored && Number.isFinite(d.startedAt) ? d.startedAt : Date.now();
    storeSet(K.daily, { date, status: 'playing', startedAt, game: saveGame(g) });
    recordProgress({ date, status: 'playing' });
    return { g, date, startedAt };
  });
}

function startFree() {
  const { level } = settings();
  recordProgress();
  openGame('free', `Main Bebas · ${LEVELS[level].name}`, () => {
    const made = makePuzzle(randomSeed(), level);
    return { g: newGame({ level, ...made }), date: todayKL(), startedAt: Date.now() };
  });
}

/** A Main Bebas puzzle with something entered (it is lost on leaving): ask first. */
const mustAsk = () => Boolean(session && session.mode === 'free' && !session.g.over && !session.leaving && !session.ending
  && session.g.values.some((v, i) => v && !isGiven(session.g, i) || session.g.notes[i]));

function askLeave() {
  const dlg = $('#dlg-leave');
  if (!dlg.open) dlg.showModal();
}

function confirmLeave() {
  $('#dlg-leave').close();
  if (!session) return;
  session.leaving = true;
  go('');
}

/** Leaving the game screen: Cabaran Harian stays saved (resume later today); Main Bebas is dropped. */
function leaveGame() {
  if (session?.mode === 'daily' && !session.g.over) toast('Disimpan. Sambung bila-bila hari ini.');
  stopGame();
}

function stopGame() {
  openGame.token = null;
  if (session) clearInterval(session.clock);
  session = null;
  stopMusic();
}

// ---------- the clock ----------

const dialogOpen = () => Boolean(document.querySelector('dialog[open]'));

/** Seconds so far: Cabaran Harian by the wall clock (it keeps running), Main Bebas as played. */
function elapsed(s = session) {
  return s.mode === 'daily' ? (Date.now() - s.startedAt) / 1000 : s.active;
}

function tick() {
  const s = session;
  if (!s) return;
  const now = performance.now();
  const dt = (now - s.lastTs) / 1000;
  s.lastTs = now;
  if (s.mode === 'free' && !s.paused && !s.g.over && !document.hidden && !dialogOpen()) s.active += Math.min(dt, 1);
  $('#sd-clock').textContent = formatTime(elapsed(s));
  renderPoints();
}

/** The points if the puzzle were finished now (they go down with time, mistakes and hints). */
function renderPoints() {
  const s = session;
  if (!s || s.ending) return;
  const g = s.g;
  const points = g.over ? 0 : scoreFor({ level: g.level, seconds: Math.ceil(elapsed(s)), mistakes: g.mistakes, hints: g.hints, won: true });
  const el = $('#sd-points');
  const text = number(points);
  if (el.textContent === text) return;
  // A drop from a mistake or a hint (not the clock's steady fall) flashes.
  const before = Number(el.dataset.points ?? points);
  if (before - points > 15) flash(el, 'drop');
  el.textContent = text;
  el.dataset.points = String(points);
}

function pause() {
  const s = session;
  if (!s || s.paused || s.g.over || document.body.dataset.screen !== 'game') return;
  s.paused = true;
  $('#sd-board').classList.add('paused');
  $('#sd-pause').hidden = false;
  $('#sd-pause-note').textContent = s.mode === 'daily' ? 'Masa Cabaran Harian terus berjalan.' : '';
  $('#btn-pause').setAttribute('aria-label', 'Sambung');
  stopMusic();
}

function resume() {
  const s = session;
  if (!s) return;
  unlockSound();
  s.paused = false;
  s.lastTs = performance.now();
  $('#sd-board').classList.remove('paused');
  $('#sd-pause').hidden = true;
  $('#btn-pause').setAttribute('aria-label', 'Jeda');
  if (!s.g.over && !s.ending) startMusic();
}

// ---------- the board ----------

/** Sizes the board to the room the bar, status, tools and pad leave (as big as fits, at most 460 px). */
function fit() {
  const scr = $('#screen-game');
  const cs = getComputedStyle(scr);
  const gap = parseFloat(cs.rowGap) || 10;
  const others = ['.screen-game > .bar', '.sd-status', '.sd-tools', '#sd-pad'].reduce((n, sel) => n + $(sel).offsetHeight, 0);
  const free = scr.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom) - others - gap * 4;
  const width = scr.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  const size = Math.max(180, Math.floor(Math.min(width, free, 460)));
  $('#sd-stage').style.height = `${size}px`;
  const b = $('#sd-board');
  b.style.width = `${size}px`;
  b.style.setProperty('--cell', `${(size - 12) / 9}px`);
}

function buildBoard() {
  const s = session;
  const b = $('#sd-board');
  const boxes = Array.from({ length: 9 }, () => h('div', 'sd-box'));
  s.cells = [];
  for (let i = 0; i < 81; i++) {
    const cell = h('button', 'sd-cell');
    cell.type = 'button';
    cell.dataset.i = String(i);
    cell.tabIndex = -1;
    s.cells[i] = cell;
  }
  // Boxes in reading order, each with its cells in reading order.
  for (let bi = 0; bi < 9; bi++) for (const i of UNITS[18 + bi]) boxes[bi].append(s.cells[i]);
  b.replaceChildren(...boxes);
  fit();
}

function renderCell(i) {
  const s = session, g = s.g, cell = s.cells[i];
  const v = g.values[i];
  cell.classList.toggle('given', isGiven(g, i));
  cell.classList.toggle('mine', !isGiven(g, i) && isRight(g, i) && !g.hinted.includes(i));
  cell.classList.toggle('hinted', g.hinted.includes(i));
  cell.classList.toggle('wrong', isWrong(g, i));
  if (v) {
    cell.textContent = String(v);
  } else if (g.notes[i]) {
    const notes = h('span', 'sd-notes');
    const selDigit = s.sel >= 0 ? g.values[s.sel] : 0;
    for (let d = 1; d <= 9; d++) {
      const n = h('span', d === selDigit ? 'same' : null, g.notes[i] & (1 << d) ? String(d) : '');
      notes.append(n);
    }
    cell.replaceChildren(notes);
  } else {
    cell.textContent = '';
  }
  const where = `Baris ${rowOf(i) + 1}, lajur ${colOf(i) + 1}`;
  const what = v ? `${v}${isWrong(g, i) ? ', salah' : ''}` : g.notes[i] ? `catatan ${[...Array(9).keys()].map((k) => k + 1).filter((d) => g.notes[i] & (1 << d)).join(' ')}` : 'kosong';
  cell.setAttribute('aria-label', `${where}: ${what}`);
}

/** The selected cell, its row, column and box, and every cell holding the same number. */
function renderHighlights() {
  const s = session, g = s.g;
  const peers = new Set(s.sel >= 0 ? PEERS[s.sel] : []);
  const digit = s.sel >= 0 ? g.values[s.sel] : 0;
  for (let i = 0; i < 81; i++) {
    const c = s.cells[i];
    c.classList.toggle('sel', i === s.sel);
    c.classList.toggle('peer', peers.has(i));
    c.classList.toggle('same', digit > 0 && i !== s.sel && g.values[i] === digit && !isWrong(g, i));
  }
}

function renderPad() {
  const s = session, g = s.g;
  const pad = $('#sd-pad');
  if (!pad.children.length) {
    for (let d = 1; d <= 9; d++) {
      const b = h('button', 'sd-num');
      b.type = 'button';
      b.dataset.d = String(d);
      b.append(document.createTextNode(String(d)), h('small'));
      pad.append(b);
    }
  }
  pad.classList.toggle('pencil', s.pencil);
  for (const b of pad.children) {
    const d = Number(b.dataset.d);
    const left = remaining(g, d);
    b.querySelector('small').textContent = left ? String(left) : '';
    b.disabled = left === 0 || g.over;
    b.setAttribute('aria-label', `${s.pencil ? 'Catatan ' : ''}${d}, ${left} lagi`);
  }
}

function renderStatus() {
  const s = session, g = s.g;
  [...document.querySelectorAll('.sd-dots i')].forEach((dot, k) => dot.classList.toggle('on', k < g.mistakes));
  $('#sd-mistakes').setAttribute('aria-label', `Kesilapan ${g.mistakes} daripada ${MAX_MISTAKES}`);
  $('#hints-left').textContent = String(MAX_HINTS - g.hints);
  $('#tool-hint').disabled = g.over || g.hints >= MAX_HINTS;
  $('#tool-undo').disabled = g.over || !g.history.length;
  $('#tool-erase').disabled = g.over;
  $('#tool-pencil').disabled = g.over;
  $('#tool-pencil').setAttribute('aria-pressed', String(s.pencil));
  $('#pencil-state').textContent = s.pencil ? 'Hidup' : 'Mati';
}

function renderAll() {
  for (let i = 0; i < 81; i++) renderCell(i);
  renderHighlights();
  renderPad();
  renderStatus();
  renderPoints();
}

function announce(text) {
  const el = $('#sd-sr');
  el.textContent = '';
  requestAnimationFrame(() => { el.textContent = text; });
}

/** Restarts a CSS animation class on an element. */
function flash(el, cls) {
  if (reduceMotion()) return;
  el.classList.remove(cls);
  void el.offsetWidth;
  el.classList.add(cls);
}

/** A row, column or box done: a gold wave along it. */
function celebrateUnits(units) {
  if (!units.length) return;
  playSound('done', units.length);
  appsWargaHaptic('impact', 'medium');
  const s = session;
  if (reduceMotion()) return;
  for (const u of units) {
    UNITS[u].forEach((i, k) => {
      const c = s.cells[i];
      c.style.setProperty('--d', `${k * 35}ms`);
      flash(c, 'done');
      setTimeout(() => c.classList.remove('done'), 900);
    });
  }
}

/** Saves Cabaran Harian after every change, so a reload (or the app closing) resumes it. */
function saveDaily() {
  const s = session;
  if (s?.mode !== 'daily' || s.g.over) return;
  storeSet(K.daily, { date: s.date, status: 'playing', startedAt: s.startedAt, game: saveGame(s.g) });
}

// ---------- input ----------

const canPlay = () => Boolean(session && !session.paused && !session.g.over && !session.ending && session.cells);

function select(i) {
  const s = session;
  if (!canPlay() || i < 0 || i > 80) return;
  s.sel = i;
  renderHighlights();
  // Notes show the selected number in bold.
  for (let k = 0; k < 81; k++) if (s.g.notes[k]) renderCell(k);
  playSound('tap');
  appsWargaHaptic('selection');
}

/** A number from the pad or the keyboard: a note in pencil mode, else the cell's number. */
function enter(d) {
  const s = session;
  if (!canPlay()) return;
  unlockSound();
  if (s.sel < 0) return toast('Pilih petak dahulu.');
  const g = s.g, i = s.sel;
  if (s.pencil) {
    if (!toggleNote(g, i, d)) return nudge(i);
    playSound('note', d);
    renderCell(i);
    renderStatus();
    return saveDaily();
  }
  const res = place(g, i, d);
  if (!res) return nudge(i);
  const cell = s.cells[i];
  if (res.right) {
    playSound('place', d);
    flash(cell, 'pop');
  } else {
    playSound('wrong');
    appsWargaHaptic('notification', 'warning');
    flash(cell, 'bad');
    flash($('#sd-mistakes'), 'hit');
    announce(`${d} salah. Kesilapan ${g.mistakes} daripada ${MAX_MISTAKES}.`);
  }
  renderAll();
  celebrateUnits(res.units);
  saveDaily();
  if (res.won) return win();
  if (res.lost) return lose();
}

/** A cell that can't change (given, or already right): a small shake. */
function nudge(i) {
  const s = session;
  if (isGiven(s.g, i) || isRight(s.g, i)) {
    flash(s.cells[i], 'bad');
    playSound('tap');
  }
}

function doErase() {
  const s = session;
  if (!canPlay() || s.sel < 0) return;
  if (!erase(s.g, s.sel)) return nudge(s.sel);
  playSound('erase');
  renderAll();
  saveDaily();
}

function doUndo() {
  const s = session;
  if (!canPlay()) return;
  const i = undo(s.g);
  if (i < 0) return;
  s.sel = i;
  playSound('erase');
  renderAll();
  saveDaily();
}

function doHint() {
  const s = session;
  if (!canPlay()) return;
  unlockSound();
  const r = hint(s.g, s.sel);
  if (!r) return toast('Tiada petunjuk lagi.');
  s.sel = r.i;
  playSound('hint');
  playSound('place', r.d);
  appsWargaHaptic('impact', 'light');
  renderAll();
  flash(s.cells[r.i], 'pop');
  celebrateUnits(r.units);
  announce(`Petunjuk: baris ${rowOf(r.i) + 1}, lajur ${colOf(r.i) + 1} ialah ${r.d}.`);
  saveDaily();
  if (r.won) win();
}

function togglePencil() {
  const s = session;
  if (!canPlay()) return;
  s.pencil = !s.pencil;
  playSound('tap');
  appsWargaHaptic('selection');
  renderPad();
  renderStatus();
}

// The keyboard: arrows move, 1–9 a number (or a note), 0 / Backspace / Delete erase, N pencil,
// U or Ctrl+Z undo, H hint, P or Esc pause.
const ARROWS = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
function onKey(e) {
  const s = session;
  if (document.body.dataset.screen !== 'game' || !s || !s.cells || dialogOpen() || e.altKey || e.metaKey) return;
  if (e.ctrlKey) {
    if (e.key === 'z' || e.key === 'Z') { e.preventDefault(); doUndo(); }
    return;
  }
  const k = e.key;
  if (k === 'p' || k === 'P' || k === 'Escape') { e.preventDefault(); return s.paused ? resume() : pause(); }
  if (s.paused) return;
  if (ARROWS[k]) {
    e.preventDefault();
    const [dr, dc] = ARROWS[k];
    const at = s.sel < 0 ? 40 : s.sel;
    const r = (rowOf(at) + dr + 9) % 9, c = (colOf(at) + dc + 9) % 9;
    select(r * 9 + c);
    s.cells[s.sel]?.focus({ preventScroll: true });
  } else if (/^[1-9]$/.test(k)) {
    e.preventDefault();
    enter(Number(k));
  } else if (k === '0' || k === 'Backspace' || k === 'Delete') {
    e.preventDefault();
    doErase();
  } else if (k === 'n' || k === 'N') {
    e.preventDefault();
    togglePencil();
  } else if (k === 'u' || k === 'U') {
    e.preventDefault();
    doUndo();
  } else if (k === 'h' || k === 'H') {
    e.preventDefault();
    doHint();
  }
}

// ---------- the end of a game ----------

/** Solved: recorded at once, then the board lights up in a wave, then the result. */
function win() {
  const s = session;
  const result = finish();
  playSound('win');
  appsWargaHaptic('notification', 'success');
  announce('Tahniah! Teka-teki selesai.');
  const b = $('#sd-board');
  for (let i = 0; i < 81; i++) s.cells[i].style.setProperty('--d', `${(rowOf(i) + colOf(i)) * 40}ms`);
  if (!reduceMotion()) b.classList.add('won');
  showResultSoon(result, reduceMotion() ? 500 : 1600);
}

/** Three mistakes: recorded at once, then the answers show faintly, then the result. */
function lose() {
  const s = session;
  const result = finish();
  playSound('lose');
  appsWargaHaptic('notification', 'error');
  announce('Tiga kesilapan. Permainan tamat.');
  for (let i = 0; i < 81; i++) {
    if (isRight(s.g, i)) continue;
    const c = s.cells[i];
    c.classList.remove('wrong');
    c.classList.add('answer');
    c.textContent = String(s.g.solution[i]);
  }
  $('#sd-board').classList.add('lost');
  showResultSoon(result, 1800);
}

/** The result screen after the board's moment (unless the player has gone elsewhere meanwhile). */
function showResultSoon(result, ms) {
  renderStatus();
  renderPad();
  setTimeout(() => {
    if (lastResult === result && document.body.dataset.screen === 'game') go('tamat', { replace: true });
  }, ms);
}

/** A game opened already over (a saved Cabaran Harian that ended): straight to its result. */
function endGame() {
  finish();
  go('tamat', { replace: true });
}

/**
 * Records a game the moment it ends (solved or three mistakes), before any animation: its time,
 * the stats, the day's result and Arked Warga's progress, then the send. So closing the app
 * during the ending can't hand back the move (or the day's try). Returns the result.
 */
function finish() {
  const s = session;
  if (!s || s.ending) return lastResult;
  s.ending = true;
  clearInterval(s.clock);
  stopMusic();
  const g = s.g;
  // Whole seconds, rounded up (the board's points-a-second limit is set from this).
  const seconds = Math.min(86400, Math.max(1, Math.ceil(elapsed(s))));
  const sum = summary(g, seconds);
  const result = {
    ...sum, mode: s.mode, daily: s.mode === 'daily', date: s.date, number: s.mode === 'daily' ? puzzleNumber(s.date) : null,
    submit: { status: 'pending' },
  };
  const t = stats();
  t.played++;
  if (g.won) t.won++;
  t.best = Math.max(t.best, sum.points);
  if (result.daily) {
    if (g.won) {
      t.streak = currentStreak(t, s.date) + 1;
      t.lastWinDate = s.date;
      t.maxStreak = Math.max(t.maxStreak, t.streak);
    } else {
      t.streak = 0;
    }
  }
  storeSet(K.stats, t);
  lastResult = result;
  if (result.daily) recordProgress({ date: s.date, status: 'done', won: g.won, score: sum.points });
  saveResult(result);
  submitResult(result);
  return result;
}

// ---------- result ----------

/** Keeps the day's result (with its submit status), so the card and the result survive a reload. */
function saveResult(r) {
  if (r.daily) storeSet(K.daily, { date: r.date, status: 'done', result: r });
}

function renderResult() {
  const r = lastResult;
  show('result');
  const perfect = r.won && !r.mistakes && !r.hints;
  $('#res-title').textContent = perfect ? 'Anugerah Dekan!' : r.won ? 'Syabas!' : 'Tidak Berjaya';
  const level = LEVELS[r.level].name;
  $('#res-detail').textContent = r.daily
    ? `Cabaran Harian #${r.number} · ${DAYS[new Date(`${r.date}T00:00:00Z`).getUTCDay()]} · ${level}`
    : `Main Bebas · ${level}`;
  $('#res-score').textContent = number(r.points);
  $('#res-time').textContent = formatTime(r.seconds);
  $('#res-mistakes').textContent = `${r.mistakes}/${MAX_MISTAKES}`;
  $('#res-hints').textContent = String(r.hints);
  $('#res-again').textContent = r.daily ? 'Main Bebas' : 'Main Lagi';
  // A daily result reopened after a reload whose send never finished: send it again (the server
  // keeps one daily round a day, so a repeat is reported as already recorded).
  if (['pending', 'sending', 'error'].includes(r.submit?.status) && !r.submitting) submitResult(r);
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
      : st === 'done' ? (r.daily ? 'Markah direkodkan. Teka-teki baharu esok!' : 'Markah direkodkan.')
        : st === 'dup' ? 'Markah Cabaran Harian anda sudah direkodkan hari ini.'
          : `Gagal menghantar: ${r.submit.message}`;
  if (st === 'done' || st === 'dup') box.classList.add('ok');
  if (st === 'error') {
    box.classList.add('err');
    const retry = h('button', 'btn btn-link', 'Cuba semula');
    retry.type = 'button';
    retry.addEventListener('click', () => submitResult(r));
    box.append(retry);
  }
}

/** Sends the game to the boards (arked_record); Cabaran Harian with the daily mark and its day. */
async function submitResult(r) {
  if (r.submitting) return;
  const profile = loadProfile();
  if (!profile || !lb.boardsConfigured()) { r.submit = { status: 'offline' }; saveResult(r); renderSubmit(); return; }
  r.submitting = true;
  r.submit = { status: 'sending' };
  renderSubmit();
  try {
    await lb.recordRound({ game: GAME_ID, profile, points: r.points, seconds: r.seconds, daily: r.daily, date: r.daily ? r.date : todayKL() });
    r.submit = { status: 'done' };
  } catch (err) {
    if (err.code === '23505') r.submit = { status: 'dup' };
    else r.submit = { status: 'error', message: err.code === '54000' ? 'Terlalu cepat. Tunggu sebentar.' : err.message };
  } finally {
    r.submitting = false;
  }
  saveResult(r);
  if (lastResult === r) renderSubmit();
}

async function shareResult() {
  const r = lastResult;
  const level = LEVELS[r.level].name;
  const head = r.daily ? `Sudoku Harian #${r.number} · ${level}` : `Sudoku · Main Bebas · ${level}`;
  const line = r.won
    ? `${r.mistakes || r.hints ? '✅' : '🎓'} ${formatTime(r.seconds)} · ${r.mistakes} kesilapan · ${r.hints} petunjuk · ${number(r.points)} mata`
    : '❌ Tidak berjaya kali ini';
  const text = `${head}\n${line}`;
  const url = shareUrl();
  if (await appsWargaShare({ text, url, title: 'Sudoku' })) return;
  try {
    if (navigator.share) return await navigator.share({ text, url, title: 'Sudoku' });
  } catch (e) {
    if (e?.name === 'AbortError') return;
  }
  try {
    await navigator.clipboard.writeText(`${text}\n${url}`);
    toast('Disalin ke papan klip');
  } catch {
    toast('Tidak dapat berkongsi');
  }
}

// ---------- leaderboard ----------

function openBoard() { show('board'); board.open(); } // shared/board.js: always opens on Hari Ini

// ---------- wiring ----------

function init() {
  initFromArked();
  initAppsWarga();
  initProfile();
  const help = () => $('#dlg-help').showModal();
  $('#btn-help').addEventListener('click', help);
  $('#help-close').addEventListener('click', () => $('#dlg-help').close());
  $('#btn-hub').addEventListener('click', backToArked);
  $('#btn-close-app').addEventListener('click', closeMiniApp);
  $('#btn-version').addEventListener('click', () => { $('#btn-version').disabled = true; toast('Memuat semula…'); hardReload(); });
  for (const b of document.querySelectorAll('[data-level]')) b.addEventListener('click', () => saveSetting('level', b.dataset.level));
  $('#set-sound').addEventListener('click', () => { saveSetting('sound', !settings().sound); unlockSound(); playSound('tap'); });
  $('#set-music').addEventListener('click', () => {
    saveSetting('music', !settings().music);
    unlockSound();
    playSound('tap');
    if (settings().music) previewMusic(settings().track);
  });
  // Picking a Lagu plays a few seconds of it.
  for (const b of document.querySelectorAll('[data-track]')) {
    b.addEventListener('click', () => {
      saveSetting('track', b.dataset.track);
      unlockSound();
      if (settings().music) previewMusic(b.dataset.track);
    });
  }

  $('#btn-daily').addEventListener('click', () => go('harian'));
  $('#btn-free').addEventListener('click', () => go('bebas'));
  $('#btn-board').addEventListener('click', () => go('papan'));
  $('#btn-quit').addEventListener('click', () => (mustAsk() ? askLeave() : go('')));
  $('#leave-stay').addEventListener('click', () => $('#dlg-leave').close());
  $('#leave-go').addEventListener('click', confirmLeave);
  $('#btn-pause').addEventListener('click', () => (session?.paused ? resume() : pause()));
  $('#btn-resume').addEventListener('click', resume);
  $('#res-home').addEventListener('click', () => go(''));
  $('#res-again').addEventListener('click', () => go('bebas', { replace: true }));
  $('#res-share').addEventListener('click', shareResult);
  $('#res-board').addEventListener('click', () => go('papan'));
  $('#btn-board-back').addEventListener('click', () => go(''));

  $('#sd-board').addEventListener('click', (e) => {
    const cell = e.target.closest('.sd-cell');
    if (cell) { unlockSound(); select(Number(cell.dataset.i)); }
  });
  $('#sd-pad').addEventListener('click', (e) => {
    const b = e.target.closest('.sd-num');
    if (b) enter(Number(b.dataset.d));
  });
  $('#tool-undo').addEventListener('click', doUndo);
  $('#tool-erase').addEventListener('click', doErase);
  $('#tool-pencil').addEventListener('click', togglePencil);
  $('#tool-hint').addEventListener('click', doHint);
  document.addEventListener('keydown', onKey);
  // Away from the game (another app, another tab, AppsWarga in the background): pause.
  document.addEventListener('visibilitychange', () => document.hidden && pause());
  window.addEventListener('appswargaDeactivated', pause);
  window.addEventListener('blur', pause);
  window.addEventListener('resize', () => { if (session?.cells) fit(); });
  window.addEventListener('hashchange', route);
  if (!storeGet(K.seenHelp, false)) {
    storeSet(K.seenHelp, true);
    help();
  }
  route();
  requestAnimationFrame(() => notifyAppReady());
  // ?debug: the game for browser tests, played through the same input as a tap.
  if (new URLSearchParams(location.search).has('debug')) {
    window.__sd = {
      get session() { return session; },
      select,
      enter,
      /** Fills `n` open cells (all by default) with their answers, cell by cell. */
      solve(n = 81) {
        const s = session;
        for (let i = 0, k = 0; i < 81 && k < n; i++) {
          if (s.g.values[i] && !isWrong(s.g, i)) continue;
          select(i);
          enter(s.g.solution[i]);
          k++;
        }
      },
      /** Puts a wrong number in the first open cell. */
      mistake() {
        const s = session;
        const i = s.g.values.findIndex((v) => v === 0);
        select(i);
        enter((s.g.solution[i] % 9) + 1);
      },
    };
  }
}

init();
