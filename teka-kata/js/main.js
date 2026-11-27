// App shell: hash router, screens, game session, profile and leaderboard wiring.
import { PHRASES, CATEGORIES } from './phrases.js';
import {
  createPuzzle,
  guess,
  moveCursor,
  selectCell,
  applyProgress,
  filledIndices,
  dailyIndex,
  MAX_MISTAKES,
} from './game.js';
import { mulberry32, hashString, randomSeed, todayKL } from '../../shared/rng.js';
import { computeScore, formatTime } from './score.js';
import { BoardView } from './board.js';
import * as lb from '../../shared/leaderboard.js';
import { createBoard } from '../../shared/board.js';
import { USER_TYPES, CAMPUSES, NON_UITM_CAMPUS, userTypeLabel } from '../../shared/profile-options.js';
import { enhanceSelect, refreshSelect, closeSelectSheet } from '../../shared/select.js';
import { store, uuid } from './storage.js';
import { PROFILE_KEY, gameKey, migrateLocal, readShared, syncShared, writeShared } from '../../shared/shared-store.js';
import { initFromArked, backToArked, shareUrl } from '../../shared/arked-link.js';
import {
  initAppsWarga,
  appsWargaAllowedUserTypes,
  appsWargaHaptic,
  appsWargaSessionError,
  appsWargaShare,
  closeMiniApp,
  notifyAppReady,
} from '../../shared/appswarga.js';

const $ = (sel) => document.querySelector(sel);
// The profile is shared with Arked Warga and its other games (js/shared-store.js); the rest is
// Teka Kata's own. 'tk.profile' is where the profile was kept before Arked Warga.
const K = { daily: 'tk.daily', stats: 'tk.stats', seen: 'tk.freeSeen' };
const GAME_ID = 'teka-kata';
const board = createBoard({ game: GAME_ID, subtitles: { daily: (date) => `Jumlah hari ini · ${formatDateMs(date)}` } }); // Papan Markah (shared/board.js)
const PROGRESS_KEY = gameKey(GAME_ID);
const SCREENS = ['home', 'game', 'result', 'board'];

let session = null; // { mode, date, phrase, state, startedAt }
let lastResult = null;
let timerId = 0;
let afterProfile = null;
let appAllowedTypes = null; // user types the AppsWarga account may use (null = any)
let submitting = false;
let toastTimer = 0;

const view = new BoardView($('#board'), $('#keyboard'), {
  onLetter,
  onMove(dir) {
    if (!session) return;
    moveCursor(session.state, dir);
    view.update();
  },
  onSelect(idx) {
    if (session && selectCell(session.state, idx)) view.update();
  },
});

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
  toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
}

/**
 * Reloads the game with fresh files. A plain reload can still use cached JS/CSS (GitHub Pages
 * lets them be cached ~10 min, and so does AppsWarga's web view), so first re-download every
 * same-site file this page loaded with `cache: 'reload'`, which bypasses the cache and stores
 * the fresh copy, then reload. localStorage (profile, progress) is left alone.
 */
async function hardReload() {
  const btn = $('#btn-version');
  btn.disabled = true;
  toast('Memuat semula…');
  const urls = new Set([location.href.split('#')[0]]);
  for (const entry of performance.getEntriesByType('resource')) {
    try {
      const url = new URL(entry.name);
      if (url.origin === location.origin) urls.add(url.href.split('#')[0]);
    } catch {
      /* not a URL */
    }
  }
  try {
    if (window.caches) await Promise.all((await caches.keys()).map((k) => caches.delete(k)));
  } catch {
    /* Cache Storage unavailable */
  }
  await Promise.allSettled([...urls].map((u) => fetch(u, { cache: 'reload' })));
  location.reload();
}

const loadProfile = () => readShared(PROFILE_KEY);
const elapsedSeconds = () => Math.max(1, Math.round((Date.now() - session.startedAt) / 1000));
const modeLabel = (mode) => (mode === 'daily' ? 'Cabaran Harian' : 'Main Bebas');

function formatDateMs(dateKey) {
  return new Intl.DateTimeFormat('ms-MY', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  }).format(new Date(`${dateKey}T00:00:00Z`));
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
  if (path !== 'harian' && path !== 'bebas') leaveGame();
  switch (path) {
    case 'harian':
      return withProfile(startDaily);
    case 'bebas':
      return withProfile(startFree);
    case 'keputusan':
      return lastResult ? renderResult() : go('', true);
    case 'papan':
      return openBoard();
    default:
      return renderHome();
  }
}

function leaveGame() {
  stopTimer();
  session = null;
}

// ---------- profile ----------

function withProfile(fn) {
  if (loadProfile()) return fn();
  renderHome();
  afterProfile = fn;
  openProfile();
}

function openProfile() {
  const p = loadProfile();
  $('#dlg-profile').returnValue = '';
  $('#pf-name').value = p?.nickname ?? '';
  $('#pf-type').value = p?.userType ?? '';
  $('#pf-campus').value = p?.campus ?? '';
  $('#pf-error').textContent = '';
  applyUserTypeRules();
  $('#dlg-profile').showModal();
  if (!appAllowedTypes) syncUserTypeFromApp(); // retry, e.g. the first try was offline
}

/** The type to use when a saved one isn't allowed: the only choice, or Orang Awam for public accounts. */
const fallbackType = (allowed) => (allowed.includes('awam') ? 'awam' : allowed[0]);

/**
 * Inside AppsWarga, the signed-in account limits the user type: staff and testers are locked
 * to Staf, students to Pelajar, public accounts choose Alumni or Orang Awam. A saved profile
 * outside those choices is corrected. When AppsWarga can't say (outside the app, or no token
 * yet), the player picks any type as usual.
 */
async function syncUserTypeFromApp() {
  const allowed = await appsWargaAllowedUserTypes();
  if (!allowed) return applyUserTypeRules(); // shows why, if AppsWarga refused
  appAllowedTypes = allowed;
  const p = loadProfile();
  if (p && !allowed.includes(p.userType)) {
    writeShared(PROFILE_KEY, { ...p, userType: fallbackType(allowed) });
    renderProfileChip();
  }
  applyUserTypeRules();
}

function applyUserTypeRules() {
  const select = $('#pf-type');
  const allowed = appAllowedTypes;
  // Types the account can't use stay listed but disabled (e.g. Pelajar/Staf for a public account).
  for (const opt of select.options) {
    if (!opt.value) continue; // the "Pilih kategori…" placeholder stays as it is
    opt.disabled = Boolean(allowed) && !allowed.includes(opt.value);
  }
  const locked = allowed?.length === 1;
  // Pre-select: the only choice, or Orang Awam for a public account (they may switch to Alumni).
  if (allowed && !allowed.includes(select.value)) select.value = fallbackType(allowed);
  // Orang Awam with no campus chosen yet: default to "Bukan warga UiTM".
  if (select.value === 'awam' && !$('#pf-campus').value) $('#pf-campus').value = NON_UITM_CAMPUS;
  select.disabled = locked;
  select.parentElement.classList.toggle('locked', locked); // lock icon instead of the arrow
  // No text under the field, except the bridge's error code when the lookup failed in AppsWarga.
  const hint = $('#pf-type-hint');
  const error = allowed ? null : appsWargaSessionError();
  hint.hidden = !error;
  hint.classList.toggle('warn', Boolean(error));
  hint.textContent = error ? `Kategori tidak dapat disemak dengan AppsWarga (${error}).` : '';
  // Values were set from code; show them on the custom dropdowns.
  refreshSelect(select);
  refreshSelect($('#pf-campus'));
}

function fillProfileOptions() {
  const type = $('#pf-type');
  type.append(new Option('Pilih kategori…', '', true, false));
  type.options[0].disabled = true;
  for (const t of USER_TYPES) type.append(new Option(t.label, t.value));

  const campus = $('#pf-campus');
  campus.append(new Option('Pilih kampus…', '', true, false));
  campus.options[0].disabled = true;
  for (const group of CAMPUSES) {
    const og = document.createElement('optgroup');
    og.label = group.state;
    for (const c of group.items) og.append(new Option(c, c));
    campus.append(og);
  }
}

function saveProfileFromForm(e) {
  e.preventDefault();
  const nickname = $('#pf-name').value.trim().replace(/\s+/g, ' ');
  const userType = $('#pf-type').value;
  const campus = $('#pf-campus').value;
  if (!nickname) return void ($('#pf-error').textContent = 'Sila masukkan nama panggilan.');
  if (!userType || (appAllowedTypes && !appAllowedTypes.includes(userType))) {
    return void ($('#pf-error').textContent = 'Sila pilih kategori.');
  }
  if (!campus) return void ($('#pf-error').textContent = 'Sila pilih kampus.');
  const prev = loadProfile();
  writeShared(PROFILE_KEY, { playerId: prev?.playerId ?? uuid(), nickname: nickname.slice(0, 20), userType, campus });
  $('#dlg-profile').close('saved');
  renderProfileChip();
  const next = afterProfile;
  afterProfile = null;
  if (next) next();
}

function onProfileClosed() {
  if ($('#dlg-profile').returnValue === 'saved') return;
  if (afterProfile) {
    afterProfile = null;
    go('', true);
  }
}

function renderProfileChip() {
  const p = loadProfile();
  $('#chip-avatar').textContent = p ? p.nickname.charAt(0).toUpperCase() : '?';
  $('#chip-name').textContent = p ? p.nickname : 'Tetapkan profil';
  // Orang Awam isn't tied to a campus, so their chip shows the category only.
  $('#chip-meta').textContent = !p
    ? 'Nama, kategori & kampus'
    : p.userType === 'awam'
      ? userTypeLabel(p.userType)
      : `${userTypeLabel(p.userType)} · ${p.campus}`;
}

// ---------- home ----------

function loadDaily(date) {
  const d = store.get(K.daily);
  return d && d.date === date ? d : null;
}

function renderHome() {
  show('home');
  renderProfileChip();
  const date = todayKL();
  $('#daily-date').textContent = formatDateMs(date);
  const d = loadDaily(date);
  const status = $('#daily-status');
  const btn = $('#btn-daily');
  if (d?.status === 'done') {
    const r = d.result;
    status.textContent = r.won
      ? `Selesai dalam ${formatTime(r.seconds)} · ${r.score} mata`
      : 'Tidak berjaya hari ini. Cuba lagi esok!';
    btn.textContent = 'Keputusan';
  } else if (d?.status === 'playing') {
    status.textContent = 'Permainan sedang berjalan. Masa masih dikira!';
    btn.textContent = 'Sambung';
  } else {
    status.textContent = 'Satu frasa yang sama untuk semua pemain hari ini.';
    btn.textContent = 'Main';
  }
  const st = store.get(K.stats, { played: 0, won: 0, best: 0 });
  $('#st-played').textContent = st.played;
  $('#st-won').textContent = st.won;
  $('#st-best').textContent = st.best;
}

// ---------- game ----------

/**
 * Tells Arked Warga what was played (arked.game.teka-kata): when, and today's Cabaran Harian
 * status. `daily` undefined keeps today's status as it is.
 */
function recordProgress(daily) {
  const prev = readShared(PROGRESS_KEY);
  const today = todayKL();
  const keep = prev?.daily?.date === today ? prev.daily : null;
  writeShared(PROGRESS_KEY, { lastPlayedAt: Date.now(), daily: daily === undefined ? keep : daily });
}

function startDaily() {
  const date = todayKL();
  const phrase = PHRASES[dailyIndex(date, PHRASES.length)];
  const saved = loadDaily(date);
  if (saved?.status === 'done') {
    lastResult = saved.result;
    return go('keputusan', true);
  }
  const state = createPuzzle(phrase.text, mulberry32(hashString(`cipher:${date}`)));
  let startedAt = Date.now();
  if (saved?.status === 'playing' && saved.phraseId === phrase.id) {
    applyProgress(state, saved.filled, saved.mistakes);
    startedAt = saved.startedAt;
  }
  session = { mode: 'daily', date, phrase, state, startedAt };
  beginSession();
  if (state.status !== 'playing') return finish();
  persistDaily();
  recordProgress({ date, status: 'playing' });
}

function pickFreePhrase() {
  let seen = store.get(K.seen, []);
  let pool = PHRASES.filter((p) => !seen.includes(p.id));
  if (!pool.length) {
    seen = [];
    pool = PHRASES;
  }
  const phrase = pool[Math.floor(Math.random() * pool.length)];
  store.set(K.seen, [...seen, phrase.id]);
  return phrase;
}

function startFree() {
  const phrase = pickFreePhrase();
  const state = createPuzzle(phrase.text, mulberry32(randomSeed()));
  session = { mode: 'free', date: todayKL(), phrase, state, startedAt: Date.now() };
  beginSession();
  recordProgress();
}

function beginSession() {
  show('game');
  $('#game-mode').textContent = modeLabel(session.mode);
  $('#game-cat').textContent = `Kategori: ${CATEGORIES[session.phrase.cat] ?? ''}`;
  view.mount(session.state);
  renderDots();
  startTimer();
}

function persistDaily() {
  if (session?.mode !== 'daily') return;
  store.set(K.daily, {
    date: session.date,
    phraseId: session.phrase.id,
    status: 'playing',
    startedAt: session.startedAt,
    filled: filledIndices(session.state),
    mistakes: session.state.mistakes,
  });
}

function startTimer() {
  stopTimer();
  const tick = () => {
    if (session) $('#timer').textContent = formatTime(elapsedSeconds());
  };
  tick();
  timerId = setInterval(tick, 500);
}

function stopTimer() {
  clearInterval(timerId);
  timerId = 0;
}

function renderDots() {
  // Chances left = MAX_MISTAKES - mistakes; mistakes are marked ✕ from the left.
  const { mistakes } = session.state;
  const lives = MAX_MISTAKES - mistakes;
  [...$('#dots').children].forEach((dot, i) => dot.classList.toggle('lost', i < mistakes));
  $('#mistakes').setAttribute('aria-label', `Peluang ${lives} daripada ${MAX_MISTAKES}`);
}

function onLetter(letter) {
  if (!session || session.state.status !== 'playing' || session.finishing) return;
  const { state } = session;
  const idx = state.cursor;
  if (idx < 0) return;
  const r = guess(state, idx, letter);
  if (r.result === 'ignored') return;

  if (r.result === 'wrong') {
    view.flashWrong(idx, letter);
    renderDots();
    $('#mistakes').classList.remove('bump');
    void $('#mistakes').offsetWidth;
    $('#mistakes').classList.add('bump');
    appsWargaHaptic('notification', 'error'); // AppsWarga's native "error" buzz
  } else {
    view.update();
    view.pop(idx);
    if (r.completed) view.glowLetter(letter);
  }
  persistDaily();
  if (state.status !== 'playing') finish();
}

async function finish() {
  stopTimer();
  const s = session;
  s.finishing = true;
  const { state, phrase, mode, date } = s;
  const won = state.status === 'won';
  const seconds = elapsedSeconds();
  const result = {
    mode,
    date,
    phraseId: phrase.id,
    text: state.text,
    fact: phrase.fact,
    cat: phrase.cat,
    won,
    seconds,
    mistakes: state.mistakes,
    hidden: state.hiddenCount,
    score: won ? computeScore(state.hiddenCount, seconds, state.mistakes) : 0,
    submit: { status: won ? 'pending' : 'skipped' },
  };
  lastResult = result;
  saveResult(result);
  recordStats(result);
  recordProgress(mode === 'daily' ? { date, status: 'done', won, score: result.score } : undefined);
  // The answer stays secret on a loss, so let that phrase come up again in free play.
  if (!won && mode === 'free') store.set(K.seen, store.get(K.seen, []).filter((id) => id !== phrase.id));
  $('#timer').textContent = formatTime(seconds);
  if (won) submitResult(result); // runs during the animation; renders when the result screen is up

  if (won) await view.celebrate();
  else await view.fail();
  // Player may have navigated away during the animation.
  if (session === s) go('keputusan', true);
}

function saveResult(result) {
  if (result.mode !== 'daily') return;
  store.set(K.daily, { date: result.date, phraseId: result.phraseId, status: 'done', result });
}

function recordStats(r) {
  const st = store.get(K.stats, { played: 0, won: 0, best: 0 });
  st.played += 1;
  if (r.won) st.won += 1;
  st.best = Math.max(st.best, r.score);
  store.set(K.stats, st);
}

// ---------- result ----------

function renderResult() {
  const r = lastResult;
  show('result');
  $('#screen-result').classList.toggle('lost', !r.won);
  $('#res-badge').textContent = r.won ? '🎉' : '💔';
  $('#res-title').textContent = r.won ? 'Tahniah!' : 'Cuba Lagi';
  $('#res-mode').textContent =
    r.mode === 'daily' ? `Cabaran Harian · ${formatDateMs(r.date)}` : 'Main Bebas';
  // A lost round keeps the answer secret; the fact is hidden too since it can give the phrase away.
  $('#res-phrase').textContent = r.won ? r.text : 'Jawapan dirahsiakan';
  $('#res-fact').textContent = r.won ? r.fact : 'Cuba frasa lain dan pecahkan kodnya!';
  $('#res-time').textContent = formatTime(r.seconds);
  $('#res-mistakes').textContent = `${r.mistakes} / ${MAX_MISTAKES}`;
  $('#res-score').textContent = String(r.score);
  $('#res-again').textContent = r.mode === 'daily' ? 'Main Bebas' : 'Frasa Seterusnya';
  renderSubmit();
  if (r.won && (r.submit.status === 'pending' || r.submit.status === 'sending') && !submitting) {
    submitResult(r);
  }
}

function renderSubmit() {
  const r = lastResult;
  const box = $('#res-submit');
  box.replaceChildren();
  box.className = 'res-submit';
  const s = r.submit;
  const msg = (text, cls) => {
    box.append(h('span', null, text));
    if (cls) box.classList.add(cls);
  };
  switch (s.status) {
    case 'skipped':
      return msg(r.mode === 'daily' ? 'Cabaran baharu esok. Jumpa lagi!' : 'Markah tidak direkodkan.');
    case 'offline':
      return msg('Papan markah belum dikonfigurasi. Markah disimpan dalam peranti ini sahaja.');
    case 'pending':
    case 'sending':
      return msg('Menghantar markah…', 'busy');
    case 'done':
      // No rank here: it changes as others play, so it's only on the leaderboard.
      return msg('Markah direkodkan.', 'ok');
    case 'dup':
      return msg('Markah Cabaran Harian anda sudah direkodkan hari ini.', 'ok');
    case 'error': {
      msg(`Gagal menghantar: ${s.msg}`, 'err');
      const retry = h('button', 'btn btn-link', 'Cuba semula');
      retry.type = 'button';
      retry.addEventListener('click', () => {
        r.submit = { status: 'pending' };
        submitResult(r);
      });
      box.append(retry);
    }
  }
}

async function submitResult(r) {
  if (!r.won || submitting) return;
  if (!lb.boardsConfigured()) {
    r.submit = { status: 'offline' };
    saveResult(r);
    if (lastResult === r) renderSubmit();
    return;
  }
  const p = loadProfile();
  if (!p) return;
  submitting = true;
  r.submit = { status: 'sending' };
  if (lastResult === r) renderSubmit();
  try {
    await lb.recordRound({
      game: GAME_ID,
      profile: p,
      points: r.score,
      seconds: r.seconds,
      daily: r.mode === 'daily',
      date: r.date,
    });
    r.submit = { status: 'done' };
    const st = store.get(K.stats, { played: 0, won: 0, best: 0 });
    st.best = Math.max(st.best, r.score);
    store.set(K.stats, st);
  } catch (err) {
    r.submit = err.code === '23505' ? { status: 'dup' } : { status: 'error', msg: err.message };
  } finally {
    submitting = false;
  }
  saveResult(r);
  if (lastResult === r && document.body.dataset.screen === 'result') {
    $('#res-score').textContent = String(r.score);
    renderSubmit();
  }
}

async function shareResult() {
  const r = lastResult;
  const dots = '🟥'.repeat(r.mistakes) + '🟩'.repeat(MAX_MISTAKES - r.mistakes);
  const head = r.mode === 'daily' ? `Teka Kata · Cabaran Harian ${r.date}` : 'Teka Kata · Main Bebas';
  const body = r.won
    ? `✅ ${formatTime(r.seconds)} · ${r.mistakes} kesilapan · ${r.score} mata`
    : '❌ Tidak berjaya kali ini';
  const url = shareUrl();
  // Inside AppsWarga: its native share sheet (the web view's own sharing is missing on Android).
  const viaApp = await appsWargaShare({ text: `${head}\n${body}\n${dots}`, url, title: 'Teka Kata' });
  if (viaApp) return;
  const text = `${head}\n${body}\n${dots}\n${url}`;
  try {
    if (navigator.share) {
      await navigator.share({ text });
      return;
    }
    await navigator.clipboard.writeText(text);
    toast('Keputusan disalin!');
  } catch (err) {
    if (err?.name !== 'AbortError') toast('Tidak dapat berkongsi.');
  }
}

// ---------- leaderboard ----------

function openBoard() {
  show('board');
  board.open(); // shared/board.js: always opens on Hari Ini
}

// ---------- wiring ----------

function init() {
  // Players from before Arked Warga keep their profile and player id (and so their scores).
  migrateLocal('tk.profile', PROFILE_KEY);
  initFromArked();
  initAppsWarga();
  // In AppsWarga, the profile set in Arked Warga (perhaps on another site) wins.
  syncShared([PROFILE_KEY, PROGRESS_KEY], (key) => {
    if (key === PROFILE_KEY && document.body.dataset.screen === 'home') renderProfileChip();
  });
  syncUserTypeFromApp();
  fillProfileOptions();
  enhanceSelect($('#pf-type'));
  enhanceSelect($('#pf-campus'));
  // Choosing Orang Awam sets the campus to "Bukan warga UiTM"; the player can still change it.
  $('#pf-type').addEventListener('change', () => {
    if ($('#pf-type').value !== 'awam') return;
    $('#pf-campus').value = NON_UITM_CAMPUS;
    refreshSelect($('#pf-campus'));
  });

  $('#profile-chip').addEventListener('click', () => {
    afterProfile = null;
    openProfile();
  });
  $('#profile-form').addEventListener('submit', saveProfileFromForm);
  $('#pf-cancel').addEventListener('click', () => $('#dlg-profile').close('cancel'));
  $('#dlg-profile').addEventListener('close', () => {
    closeSelectSheet();
    onProfileClosed();
  });

  $('#btn-help').addEventListener('click', () => $('#dlg-help').showModal());
  $('#btn-close-app').addEventListener('click', closeMiniApp);
  $('#btn-hub').addEventListener('click', backToArked);
  $('#help-close').addEventListener('click', () => $('#dlg-help').close());

  $('#btn-daily').addEventListener('click', () => go('harian'));
  $('#btn-free').addEventListener('click', () => go('bebas'));
  $('#btn-board').addEventListener('click', () => go('papan'));
  $('#btn-version').addEventListener('click', hardReload);
  $('#btn-quit').addEventListener('click', () => go(''));

  $('#res-again').addEventListener('click', () => go('bebas', true));
  $('#res-share').addEventListener('click', shareResult);
  $('#res-board').addEventListener('click', () => go('papan'));
  $('#res-home').addEventListener('click', () => go(''));

  $('#btn-board-back').addEventListener('click', () => go(''));

  document.addEventListener('keydown', (e) => {
    if (document.body.dataset.screen !== 'game' || !session) return;
    if (e.ctrlKey || e.metaKey || e.altKey || document.querySelector('dialog[open]')) return;
    if (/^[a-z]$/i.test(e.key)) {
      e.preventDefault();
      onLetter(e.key.toUpperCase());
    } else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault();
      moveCursor(session.state, 1);
      view.update();
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault();
      moveCursor(session.state, -1);
      view.update();
    }
  });

  window.addEventListener('hashchange', route);

  // First visit: show how to play once.
  if (!store.get('tk.seenHelp')) {
    store.set('tk.seenHelp', true);
    $('#dlg-help').showModal();
  }
  route();
  // The first screen is on the page: let AppsWarga drop its loading screen once it's painted.
  requestAnimationFrame(() => notifyAppReady());
}

init();
