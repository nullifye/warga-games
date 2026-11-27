// Duga Kata: screens, input, the tile reveal, results and the leaderboard.
import {
  WORD_LENGTH,
  MAX_GUESSES,
  isAllowed,
  createRound,
  applyGuess,
  keyStates,
  dailyAnswer,
  puzzleNumber,
  randomAnswer,
  emojiGrid,
} from './logic.js';
import { computeScore, formatTime } from './score.js';
import { mulberry32, randomSeed, todayKL, dayNumber } from '../../shared/rng.js';
import { initAppsWarga, appsWargaHaptic, appsWargaShare, closeMiniApp, notifyAppReady } from '../../shared/appswarga.js';
import { initFromArked, backToArked, shareUrl } from '../../shared/arked-link.js';
import { initProfile, loadProfile, withProfile } from '../../shared/profile.js';
import { gameKey, readShared, writeShared } from '../../shared/shared-store.js';
import * as lb from '../../shared/leaderboard.js';
import { createBoard } from '../../shared/board.js';
import { hardReload } from '../../shared/reload.js';

const GAME_ID = 'duga-kata';
const board = createBoard({ game: GAME_ID }); // Papan Markah (shared/board.js)
const PROGRESS_KEY = gameKey(GAME_ID);
const K = { daily: 'dk.daily', stats: 'dk.stats', seenHelp: 'dk.seenHelp' };
const SCREENS = ['home', 'game', 'result', 'board'];
// '+' is TEKA (Enter: submits the guess), '-' is backspace.
const KB_ROWS = ['QWERTYUIOP', 'ASDFGHJKL', '+ZXCVBNM-'];
const REVEAL_STEP_MS = 260;
const FLIP_MS = 360;
const MARK_WORD = { correct: 'betul', present: 'ada, tempat lain', absent: 'tiada' };
const $ = (sel) => document.querySelector(sel);
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

const store = {
  get(key, fallback = null) {
    try {
      const raw = localStorage.getItem(key);
      return raw == null ? fallback : JSON.parse(raw);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* storage unavailable */
    }
  },
};

const emptyStats = () => ({ played: 0, won: 0, best: 0, streak: 0, maxStreak: 0, lastWinDate: null });
const loadStats = () => ({ ...emptyStats(), ...store.get(K.stats, {}) });

/** session: { mode: 'daily'|'free', date, round, typed, startedAt, busy, over } */
let session = null;
let lastResult = null;
let lastFreeAnswer = null;
let toastTimer = 0;

// ---------- helpers ----------

function h(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text != null) e.textContent = text;
  return e;
}

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2000);
}

/** "Rabu, 18 November" for a YYYY-MM-DD key. */
function formatDate(dateKey) {
  return new Intl.DateTimeFormat('ms-MY', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(
    new Date(`${dateKey}T00:00:00Z`),
  );
}

const modeLabel = (r) => (r.mode === 'daily' ? `Cabaran Harian #${puzzleNumber(r.date)}` : 'Main Bebas');

/** The daily streak as it stands today: it lapses once a day goes by without a win. */
function currentStreak(st, today = todayKL()) {
  if (!st.lastWinDate) return 0;
  return dayNumber(today) - dayNumber(st.lastWinDate) <= 1 ? st.streak : 0;
}

// ---------- routing ----------

function show(name) {
  for (const s of SCREENS) $(`#screen-${s}`).hidden = s !== name;
  document.body.dataset.screen = name;
}

// History follows the screens: a screen above home is pushed (marked `up`), so the phone's Back
// returns home; going home steps back over it instead of pushing, so no game entry is left under
// home and going back to Arked never passes through (or flashes) the game screen.
function go(path, replace = false) {
  const target = `#/${path}`;
  if (!path) {
    if (history.state?.up) return history.back(); // the hashchange then routes home
    if (location.hash !== target) history.replaceState({ ...(history.state ?? {}), up: false }, '', target);
    return route();
  }
  if (location.hash === target) return route();
  if (replace) history.replaceState({ ...(history.state ?? {}), up: true }, '', target);
  else history.pushState({ up: true }, '', target);
  route();
}

function route() {
  const path = location.hash.replace(/^#\/?/, '');
  if (path !== 'harian' && path !== 'bebas') session = null;
  switch (path) {
    case 'harian':
    case 'bebas':
      if (!loadProfile()) renderHome(); // behind the profile dialog
      return withProfile(path === 'harian' ? startDaily : startFree);
    case 'tamat':
      return lastResult ? renderResult() : go('', true);
    case 'papan':
      return openBoard();
    default:
      return renderHome();
  }
}

// ---------- home ----------

function loadDaily(date) {
  const d = store.get(K.daily);
  return d && d.date === date ? d : null;
}

function renderHome() {
  show('home');
  const date = todayKL();
  $('#daily-date').textContent = formatDate(date);
  const d = loadDaily(date);
  const status = $('#daily-status');
  const btn = $('#btn-daily');
  if (d?.status === 'done') {
    const r = d.result;
    status.textContent = r.won
      ? `Berjaya dalam ${r.tries}/${MAX_GUESSES} · ${r.score} mata`
      : 'Tidak berjaya hari ini. Cuba lagi esok!';
    btn.textContent = 'Keputusan';
  } else if (d?.guesses?.length) {
    status.textContent = `${d.guesses.length}/${MAX_GUESSES} cubaan digunakan. Masa masih dikira!`;
    btn.textContent = 'Sambung';
  } else {
    status.textContent = 'Satu kata yang sama untuk semua pemain hari ini.';
    btn.textContent = 'Main';
  }
  const st = loadStats();
  $('#st-played').textContent = st.played;
  $('#st-winpct').textContent = st.played ? Math.round((st.won / st.played) * 100) : 0;
  $('#st-streak').textContent = currentStreak(st, date);
  $('#st-best').textContent = st.best.toLocaleString('ms-MY');
}

// ---------- game ----------

/**
 * Tells Arked Warga what was played (arked.game.duga-kata): when, and today's Cabaran Harian
 * status. `daily` undefined keeps today's status as it is.
 */
function recordProgress(daily) {
  const prev = readShared(PROGRESS_KEY);
  const keep = prev?.daily?.date === todayKL() ? prev.daily : null;
  writeShared(PROGRESS_KEY, { lastPlayedAt: Date.now(), daily: daily === undefined ? keep : daily });
}

function startDaily() {
  const date = todayKL();
  const saved = loadDaily(date);
  if (saved?.status === 'done') {
    lastResult = saved.result;
    return go('tamat', true);
  }
  let round = createRound(dailyAnswer(date));
  for (const g of saved?.guesses ?? []) {
    if (round.status === 'playing') round = applyGuess(round, g);
  }
  session = { mode: 'daily', date, round, typed: '', startedAt: saved?.startedAt ?? Date.now(), busy: false, over: false };
  saveDailyProgress();
  recordProgress({ date, status: 'playing' });
  renderGame();
  if (round.status !== 'playing') finish(); // saved as playing but already over (e.g. closed mid-reveal)
}

function startFree() {
  const answer = randomAnswer(mulberry32(randomSeed()), lastFreeAnswer);
  lastFreeAnswer = answer;
  session = { mode: 'free', date: todayKL(), round: createRound(answer), typed: '', startedAt: Date.now(), busy: false, over: false };
  recordProgress(undefined);
  renderGame();
}

function saveDailyProgress() {
  if (session?.mode !== 'daily') return;
  store.set(K.daily, { date: session.date, status: 'playing', guesses: session.round.guesses, startedAt: session.startedAt });
}

function renderGame() {
  show('game');
  $('#game-mode').textContent = session.mode === 'daily' ? `Cabaran Harian #${puzzleNumber(session.date)}` : 'Main Bebas';
  const grid = $('#grid');
  grid.replaceChildren();
  const { round } = session;
  for (let r = 0; r < MAX_GUESSES; r++) {
    const row = h('div', 'dk-row');
    row.setAttribute('role', 'row');
    for (let i = 0; i < WORD_LENGTH; i++) {
      const tile = h('div', 'dk-tile');
      tile.setAttribute('role', 'gridcell');
      const letter = round.guesses[r]?.[i];
      if (letter) {
        tile.textContent = letter;
        tile.classList.add(`t-${round.marks[r][i]}`);
      }
      row.append(tile);
    }
    grid.append(row);
  }
  paintKeys();
  renderTyped();
  $('#keyboard').classList.remove('locked');
}

const rowEl = (r) => $('#grid').children[r];

/** Shows the letters typed so far in the current row. */
function renderTyped() {
  const r = session.round.guesses.length;
  if (r >= MAX_GUESSES) return;
  [...rowEl(r).children].forEach((tile, i) => {
    const ch = session.typed[i] ?? '';
    if (tile.textContent === ch) return;
    tile.textContent = ch;
    tile.classList.toggle('filled', Boolean(ch));
  });
}

function buildKeyboard() {
  const kb = $('#keyboard');
  for (const rowKeys of KB_ROWS) {
    const row = h('div', 'kb-row');
    for (const k of rowKeys) {
      const b = h('button', 'key');
      b.type = 'button';
      if (k === '+') {
        b.classList.add('key-wide', 'key-enter');
        b.textContent = 'TEKA';
        b.dataset.key = 'ENTER';
      } else if (k === '-') {
        b.classList.add('key-wide');
        b.dataset.key = 'BACK';
        b.setAttribute('aria-label', 'Padam');
        b.innerHTML =
          '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5h11v14H9l-6-7 6-7ZM12.5 9.5l5 5M17.5 9.5l-5 5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
      } else {
        b.textContent = k;
        b.dataset.key = k;
      }
      row.append(b);
    }
    kb.append(row);
  }
  kb.addEventListener('click', (e) => {
    const b = e.target.closest('.key');
    if (b) press(b.dataset.key);
  });
}

function paintKeys() {
  const states = session ? keyStates(session.round) : {};
  for (const b of document.querySelectorAll('.key')) {
    const k = b.dataset.key;
    if (k.length !== 1) continue;
    b.classList.remove('t-correct', 't-present', 't-absent');
    if (states[k]) b.classList.add(`t-${states[k]}`);
    b.setAttribute('aria-label', states[k] ? `${k}, ${MARK_WORD[states[k]]}` : k);
  }
}

function shakeRow(r) {
  const row = rowEl(r);
  row.classList.remove('shake');
  void row.offsetWidth;
  row.classList.add('shake');
  appsWargaHaptic('notification', 'warning');
}

function press(key) {
  const s = session;
  if (!s || s.busy || s.over || s.round.status !== 'playing') return;
  if (key === 'BACK') {
    s.typed = s.typed.slice(0, -1);
  } else if (key === 'ENTER') {
    return submitGuess();
  } else if (/^[A-Z]$/.test(key) && s.typed.length < WORD_LENGTH) {
    s.typed += key;
    appsWargaHaptic('selection');
  }
  renderTyped();
}

function submitGuess() {
  const s = session;
  const r = s.round.guesses.length;
  if (s.typed.length < WORD_LENGTH) {
    toast('Huruf tidak cukup');
    return shakeRow(r);
  }
  if (!isAllowed(s.typed)) {
    toast('Tiada dalam senarai kata');
    return shakeRow(r);
  }
  const guess = s.typed;
  s.round = applyGuess(s.round, guess);
  s.typed = '';
  saveDailyProgress();
  const marks = s.round.marks[r];
  $('#announce').textContent = [...guess].map((ch, i) => `${ch} ${MARK_WORD[marks[i]]}`).join(', ');
  reveal(r, marks, () => {
    if (session !== s) return;
    paintKeys();
    if (s.round.status !== 'playing') finish();
  });
}

/** Flips the row's tiles one by one, colouring each halfway through its flip. */
function reveal(r, marks, done) {
  const s = session;
  const tiles = [...rowEl(r).children];
  if (reducedMotion.matches) {
    tiles.forEach((t, i) => {
      t.classList.remove('filled');
      t.classList.add(`t-${marks[i]}`);
    });
    return done();
  }
  s.busy = true;
  $('#keyboard').classList.add('locked');
  tiles.forEach((t, i) => {
    setTimeout(() => {
      t.classList.add('flip');
      setTimeout(() => {
        t.classList.remove('filled');
        t.classList.add(`t-${marks[i]}`);
      }, FLIP_MS / 2);
    }, i * REVEAL_STEP_MS);
  });
  setTimeout(() => {
    tiles.forEach((t) => t.classList.remove('flip'));
    s.busy = false;
    $('#keyboard').classList.remove('locked');
    done();
  }, (tiles.length - 1) * REVEAL_STEP_MS + FLIP_MS);
}

function finish() {
  const s = session;
  if (s.over) return;
  s.over = true;
  const { round } = s;
  const won = round.status === 'won';
  const tries = round.guesses.length;
  const seconds = Math.min(86400, Math.max(1, Math.round((Date.now() - s.startedAt) / 1000)));
  const score = computeScore(won, tries, seconds);

  appsWargaHaptic('notification', won ? 'success' : 'error');
  if (won && !reducedMotion.matches) {
    [...rowEl(tries - 1).children].forEach((t, i) => {
      t.style.animationDelay = `${i * 90}ms`;
      t.classList.add('win');
    });
  }
  if (!won) toast(`Jawapan: ${round.answer}`);

  const st = loadStats();
  st.played += 1;
  if (won) st.won += 1;
  st.best = Math.max(st.best, score);
  if (s.mode === 'daily') {
    if (won) {
      st.streak = currentStreak(st, s.date) + 1;
      st.lastWinDate = s.date;
      st.maxStreak = Math.max(st.maxStreak, st.streak);
    } else {
      st.streak = 0;
    }
  }
  store.set(K.stats, st);

  const result = {
    mode: s.mode,
    date: s.date,
    answer: round.answer,
    guesses: round.guesses,
    marks: round.marks,
    won,
    tries,
    seconds,
    score,
    submit: { status: 'pending' },
  };
  lastResult = result;
  if (s.mode === 'daily') recordProgress({ date: s.date, status: 'done', won, score });
  saveResult(result);
  submitResult(result);
  setTimeout(() => {
    if (session === s && document.body.dataset.screen === 'game') go('tamat', true);
  }, won ? 1500 : 1800);
}

function onKeydown(e) {
  if (document.body.dataset.screen !== 'game' || !session || document.querySelector('dialog[open]')) return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === 'Enter') {
    e.preventDefault(); // also stops a focused on-screen key from being clicked
    press('ENTER');
  } else if (e.key === 'Backspace') {
    e.preventDefault();
    press('BACK');
  } else if (/^[a-z]$/i.test(e.key)) {
    e.preventDefault();
    press(e.key.toUpperCase());
  }
}

// ---------- result ----------

/** Keeps the day's result (with its submit status) so the daily card and result survive a reload. */
function saveResult(r) {
  if (r.mode !== 'daily') return;
  store.set(K.daily, { date: r.date, status: 'done', result: r });
}

function renderResult() {
  const r = lastResult;
  show('result');
  $('#res-badge').textContent = r.won ? (r.tries <= 2 ? '🌟' : '🎉') : '😔';
  $('#res-title').textContent = r.won
    ? ['Luar Biasa!', 'Hebat!', 'Cemerlang!', 'Bagus!', 'Syabas!', 'Nyaris!'][r.tries - 1]
    : 'Tidak Berjaya';
  $('#res-mode').textContent = r.mode === 'daily' ? `${modeLabel(r)} · ${formatDate(r.date)}` : modeLabel(r);

  const word = $('#res-word');
  word.replaceChildren(...[...r.answer].map((ch) => h('span', `dk-tile${r.won ? ' t-correct' : ' filled'}`, ch)));
  word.setAttribute('aria-label', `Jawapan: ${r.answer}`);

  $('#res-grid').replaceChildren(
    ...r.marks.map((row) => {
      const line = h('div');
      line.append(...row.map((m) => h('span', `t-${m}`)));
      return line;
    }),
  );

  $('#res-tries').textContent = `${r.won ? r.tries : 'X'}/${MAX_GUESSES}`;
  $('#res-time').textContent = formatTime(r.seconds);
  $('#res-score').textContent = r.score.toLocaleString('ms-MY');
  $('#res-again').textContent = r.mode === 'daily' ? 'Main Bebas' : 'Kata Seterusnya';
  // A daily result reopened after a reload whose send never finished: send it again (the server
  // keeps one daily round per day, so a repeat is reported as already recorded).
  if (['pending', 'sending', 'error'].includes(r.submit?.status) && !r.submitting) submitResult(r);
  renderSubmit();
}

function renderSubmit() {
  if (document.body.dataset.screen !== 'result' || !lastResult) return;
  const r = lastResult;
  const box = $('#res-submit');
  box.replaceChildren();
  box.className = 'res-submit';
  const msg = (text, cls) => {
    box.append(h('span', null, text));
    if (cls) box.classList.add(cls);
  };
  switch (r.submit.status) {
    case 'offline':
      return msg('Papan markah belum dikonfigurasi. Markah disimpan dalam peranti ini sahaja.');
    case 'pending':
    case 'sending':
      return msg('Menghantar markah…', 'busy');
    case 'done':
      return msg(r.mode === 'daily' ? 'Markah direkodkan. Kata baharu esok!' : 'Markah direkodkan.', 'ok');
    case 'dup':
      return msg('Markah Cabaran Harian anda sudah direkodkan hari ini.', 'ok');
    case 'error': {
      msg(`Gagal menghantar: ${r.submit.msg}`, 'err');
      const retry = h('button', 'btn btn-link', 'Cuba semula');
      retry.type = 'button';
      retry.addEventListener('click', () => submitResult(r));
      box.append(retry);
    }
  }
}

async function submitResult(r) {
  if (r.submitting) return;
  const profile = loadProfile();
  if (!lb.boardsConfigured() || !profile) {
    r.submit = { status: 'offline' };
    saveResult(r);
    return renderSubmit();
  }
  r.submitting = true;
  r.submit = { status: 'sending' };
  renderSubmit();
  try {
    await lb.recordRound({
      game: GAME_ID,
      profile,
      points: r.score,
      seconds: r.seconds,
      daily: r.mode === 'daily',
      date: r.date,
    });
    r.submit = { status: 'done' };
  } catch (err) {
    if (err.code === '23505') r.submit = { status: 'dup' };
    else if (err.code === '54000') r.submit = { status: 'error', msg: 'Terlalu cepat. Tunggu sebentar.' };
    else r.submit = { status: 'error', msg: err.message };
  } finally {
    r.submitting = false;
  }
  saveResult(r);
  if (lastResult === r) renderSubmit();
}

async function shareResult() {
  const r = lastResult;
  const head =
    r.mode === 'daily'
      ? `Duga Kata #${puzzleNumber(r.date)} ${r.won ? r.tries : 'X'}/${MAX_GUESSES}`
      : `Duga Kata · Main Bebas ${r.won ? r.tries : 'X'}/${MAX_GUESSES}`;
  const text = `${head}\n\n${emojiGrid(r)}`;
  const url = shareUrl();
  const viaApp = await appsWargaShare({ text, url, title: 'Duga Kata' });
  if (viaApp) return;
  try {
    if (navigator.share) return await navigator.share({ text, url, title: 'Duga Kata' });
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

function openBoard() {
  show('board');
  board.open(); // shared/board.js: always opens on Hari Ini
}

// ---------- wiring ----------

function init() {
  initFromArked();
  initAppsWarga();
  initProfile();
  buildKeyboard();

  const openHelp = () => $('#dlg-help').showModal();
  $('#btn-help').addEventListener('click', openHelp);
  $('#btn-game-help').addEventListener('click', openHelp);
  $('#help-close').addEventListener('click', () => $('#dlg-help').close());
  $('#btn-close-app').addEventListener('click', closeMiniApp);
  $('#btn-hub').addEventListener('click', backToArked);
  $('#btn-version').addEventListener('click', () => {
    $('#btn-version').disabled = true;
    toast('Memuat semula…');
    hardReload();
  });
  $('#btn-daily').addEventListener('click', () => go('harian'));
  $('#btn-free').addEventListener('click', () => go('bebas'));
  $('#btn-board').addEventListener('click', () => go('papan'));

  $('#btn-quit').addEventListener('click', () => go(''));
  document.addEventListener('keydown', onKeydown);

  $('#res-again').addEventListener('click', () => go('bebas', true));
  $('#res-share').addEventListener('click', shareResult);
  $('#res-board').addEventListener('click', () => go('papan'));
  $('#res-home').addEventListener('click', () => go(''));

  $('#btn-board-back').addEventListener('click', () => go(''));


  window.addEventListener('hashchange', route);
  if (!store.get(K.seenHelp)) {
    store.set(K.seenHelp, true);
    openHelp();
  }
  route();
  requestAnimationFrame(() => notifyAppReady());
}

init();
