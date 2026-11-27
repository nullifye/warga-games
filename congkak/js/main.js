// Congkak: screens, the osom that decides who starts, turns against the AI, results and the board.
import { AI, PLAYER, LEVELS, newGame, play, legalMoves, chooseMove, roundPoints, winner } from './rules.js';
import { setMuted, unlockSound, play as playSound } from './sound.js';
import { initAppsWarga, appsWargaHaptic, closeMiniApp, notifyAppReady } from '../../shared/appswarga.js';
import { initFromArked, backToArked } from '../../shared/arked-link.js';
import { initProfile, loadProfile, withProfile } from '../../shared/profile.js';
import { gameKey, readShared, writeShared } from '../../shared/shared-store.js';
import { todayKL } from '../../shared/rng.js';
import * as lb from '../../shared/leaderboard.js';
import { createBoard } from '../../shared/board.js';
import { hardReload } from '../../shared/reload.js';

const GAME_ID = 'congkak';
const board = createBoard({ game: GAME_ID }); // Papan Markah (shared/board.js)
const SCREENS = ['home', 'game', 'result', 'board'];
const K = { stats: 'congkak.stats', settings: 'congkak.settings', seenHelp: 'congkak.seenHelp', view: 'congkak.view' };
const OSOM = { batu: '✊', gunting: '✌️', kain: '✋' };
const OSOM_NAME = { batu: 'Batu', gunting: 'Gunting', kain: 'Kain' };
const BEATS = { batu: 'gunting', gunting: 'kain', kain: 'batu' };
const $ = (sel) => document.querySelector(sel);
const number = (n) => Number(n).toLocaleString('ms-MY');

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

function settings() {
  const s = { level: 'mudah', sound: true, follow: true, fast: false, ...storeGet(K.settings, {}) };
  if (!LEVELS[s.level]) s.level = 'mudah';
  return s;
}
const stats = () => ({ played: 0, won: 0, best: 0, ...storeGet(K.stats, {}) });

/** session: { state, level, startedAt, busy, deciding } — null when no round is open. */
let session = null;
let lastResult = null;
let scene = null;
let aiTimer = 0;

// ---------- routing (as in the other games: no game entry is left under home) ----------

function show(name) {
  for (const s of SCREENS) $(`#screen-${s}`).hidden = s !== name;
  document.body.dataset.screen = name;
  if (name === 'game') scene?.start();
  else scene?.stop();
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
  if (name === 'main') {
    if (session) return show('game');
    return withProfile(startGame);
  }
  endSession(); // leaving a round (‹ or the phone's Back) gives it up
  if (name === 'tamat' && lastResult) return renderResult();
  if (name === 'papan') return openBoard();
  renderHome();
}

// ---------- home ----------

function renderSettings() {
  const s = settings();
  setMuted(!s.sound);
  for (const b of document.querySelectorAll('.cg-levels [data-level]')) b.setAttribute('aria-pressed', String(b.dataset.level === s.level));
  $('#level-hint').textContent = `Menang hingga ${number(LEVELS[s.level].max)} mata`;
  for (const [id, key, on, off] of [
    ['#set-sound', 'sound', 'Kesan bunyi guli', 'Senyap'],
    ['#set-follow', 'follow', 'Kamera ikut tangan', 'Pandangan seluruh papan'],
    ['#set-fast', 'fast', 'Guli diagih dua kali lebih laju', 'Kelajuan biasa'],
  ]) {
    $(id).setAttribute('aria-checked', String(s[key]));
    $(`${id}-hint`).textContent = s[key] ? on : off;
  }
}

function saveSetting(key, value) {
  storeSet(K.settings, { ...settings(), [key]: value });
  renderSettings();
  appsWargaHaptic('selection');
}

function renderHome() {
  show('home');
  renderSettings();
  const s = stats();
  $('#st-best').textContent = number(s.best);
  $('#st-played').textContent = number(s.played);
  $('#st-won').textContent = number(s.won);
}

// ---------- the round ----------

async function ensureScene() {
  if (scene) return scene;
  const { createScene } = await import('./scene.js');
  scene = createScene($('#cg-stage'), {
    onPitTap: playerMove,
    sound: playSound,
    // How far down the scene the bar and status line reach (they float over it).
    topInset: () => $('#game-status').getBoundingClientRect().bottom - $('#cg-stage').getBoundingClientRect().top,
    // The camera angle the player turned to is kept for later games.
    view: storeGet(K.view, null),
    onViewChange: (view) => storeSet(K.view, view),
  });
  return scene;
}

async function startGame() {
  unlockSound();
  const { level, fast } = settings();
  try {
    await ensureScene();
  } catch (err) {
    console.error(err);
    toast('Peranti ini tidak dapat memaparkan 3D.');
    return go('', { replace: true });
  }
  scene.setSpeed(fast ? 2 : 1);
  session = { state: newGame(), level, startedAt: Date.now(), busy: false, deciding: true };
  writeShared(gameKey(GAME_ID), { ...readShared(gameKey(GAME_ID)), lastPlayedAt: Date.now() });
  show('game');
  scene.reset(session.state);
  scene.setTurn(session.state, false);
  renderScores(session.state);
  $('#game-mode').textContent = LEVELS[level].name;
  setStatus('Osom dahulu: siapa mula?', null);
  openOsom();
}

function endSession() {
  clearTimeout(aiTimer);
  if ($('#dlg-osom').open) $('#dlg-osom').close();
  if (session) scene?.abort();
  session = null;
}

function renderScores(st) {
  $('#game-score').textContent = `Anda ${st.stores[PLAYER]} – ${st.stores[AI]} AI`;
}

function setStatus(text, who) {
  const el = $('#game-status');
  el.textContent = text;
  el.dataset.who = who === PLAYER ? 'player' : who === AI ? 'ai' : '';
}

/** Osom (batu, gunting, kain) decides who sows first. */
const OSOM_SHAKE_MS = 900; // three bobs of the fists before the hands show
function resetOsom(sub) {
  $('#osom-sub').textContent = sub;
  $('#osom-you').textContent = OSOM.batu;
  $('#osom-ai').textContent = OSOM.batu;
  $('#osom-arena').classList.remove('shaking');
  $('#osom-side-you').classList.remove('won');
  $('#osom-side-ai').classList.remove('won');
  $('#osom-result').replaceChildren();
  for (const b of document.querySelectorAll('#osom-choices button')) {
    b.disabled = false;
    b.setAttribute('aria-pressed', 'false');
  }
}

function openOsom() {
  resetOsom('Siapa mula dahulu? Pilih tangan anda.');
  $('#dlg-osom').showModal();
}

function chooseOsom(mine) {
  const s = session;
  if (!s?.deciding || $('#osom-arena').classList.contains('shaking')) return;
  unlockSound();
  appsWargaHaptic('selection');
  const options = Object.keys(OSOM);
  const theirs = options[crypto.getRandomValues(new Uint32Array(1))[0] % 3];
  for (const b of document.querySelectorAll('#osom-choices button')) {
    b.disabled = true;
    b.setAttribute('aria-pressed', String(b.dataset.osom === mine));
  }
  // Osom… osom… som! Both fists shake, then the hands show.
  $('#osom-you').textContent = OSOM.batu;
  $('#osom-ai').textContent = OSOM.batu;
  $('#osom-side-you').classList.remove('won');
  $('#osom-side-ai').classList.remove('won');
  $('#osom-result').replaceChildren();
  $('#osom-sub').textContent = 'Osom… osom… som!';
  const arena = $('#osom-arena');
  arena.classList.remove('shaking');
  void arena.offsetWidth; // restart the animation
  arena.classList.add('shaking');
  setTimeout(() => {
    if (session !== s) return;
    arena.classList.remove('shaking');
    $('#osom-you').textContent = OSOM[mine];
    $('#osom-ai').textContent = OSOM[theirs];
    const result = $('#osom-result');
    if (mine === theirs) {
      $('#osom-sub').textContent = `Sama-sama ${OSOM_NAME[mine]}.`;
      result.replaceChildren(h('span', 'draw', 'Seri! Pilih sekali lagi.'));
      playSound('draw');
      setTimeout(() => { if (session === s && s.deciding) resetOsom('Seri tadi. Pilih tangan anda.'); }, 1100);
      return;
    }
    const playerFirst = BEATS[mine] === theirs;
    $(playerFirst ? '#osom-side-you' : '#osom-side-ai').classList.add('won');
    $('#osom-sub').textContent = playerFirst ? `${OSOM_NAME[mine]} menang ${OSOM_NAME[theirs]}.` : `${OSOM_NAME[theirs]} menang ${OSOM_NAME[mine]}.`;
    result.replaceChildren(h('span', playerFirst ? 'win' : 'lose', playerFirst ? 'Anda mula dahulu!' : 'AI mula dahulu.'));
    playSound(playerFirst ? 'capture' : 'turn');
    setTimeout(() => {
      if (session !== s) return;
      $('#dlg-osom').close();
      s.deciding = false;
      s.state.turn = playerFirst ? PLAYER : AI;
      nextTurn();
    }, 1500);
  }, matchMedia('(prefers-reduced-motion: reduce)').matches ? 150 : OSOM_SHAKE_MS);
}

function nextTurn() {
  const s = session;
  if (!s) return;
  const st = s.state;
  if (st.over) return finish();
  if (st.turn === PLAYER) {
    scene.setTurn(st, true);
    setStatus('Giliran anda: pilih satu lubang di baris anda.', PLAYER);
    playSound('turn');
    return;
  }
  scene.setTurn(st, false);
  setStatus('AI sedang berfikir…', AI);
  aiTimer = setTimeout(() => {
    if (session !== s) return;
    const move = chooseMove(st, s.level);
    if (move >= 0) sow(move);
  }, s.level === 'pakar' ? 500 : 800);
}

function playerMove(i) {
  const s = session;
  if (!s || s.busy || s.deciding || s.state.turn !== PLAYER || !legalMoves(s.state).includes(i)) return;
  unlockSound();
  appsWargaHaptic('selection');
  sow(i);
}

async function sow(i) {
  const s = session;
  const st = s.state;
  const player = st.turn;
  s.busy = true;
  scene.setTurn(st, false);
  setStatus(player === PLAYER ? `Anda mengagih guli dari lubang ${i + 1}…` : `AI mengagih guli dari lubang ${14 - i}…`, player);
  const events = play(st, i, true);
  const done = await scene.playEvents(events, player, { follow: settings().follow, onStep: renderScores });
  if (!done || session !== s) return;
  s.busy = false;
  scene.sync(st);
  renderScores(st);
  if (!st.over && st.turn === player) {
    toast(player === PLAYER ? 'Masuk rumah! Giliran tambahan.' : 'AI dapat giliran tambahan.');
  }
  nextTurn();
}

// ---------- result ----------

function finish() {
  const s = session;
  const st = s.state;
  const win = winner(st);
  const points = roundPoints(st, s.level);
  const seconds = Math.min(86400, Math.max(1, Math.round((Date.now() - s.startedAt) / 1000)));
  lastResult = { stores: st.stores.slice(), win, points, seconds, level: s.level, submit: { status: 'pending' } };
  const t = stats();
  t.played++;
  if (win === PLAYER) t.won++;
  t.best = Math.max(t.best, points);
  storeSet(K.stats, t);
  playSound(win === PLAYER ? 'win' : win === AI ? 'lose' : 'draw');
  appsWargaHaptic('notification', win === PLAYER ? 'success' : 'warning');
  setStatus(win === PLAYER ? 'Anda menang!' : win === AI ? 'AI menang.' : 'Seri!', win === -1 ? null : win);
  submitResult(lastResult);
  session = null;
  setTimeout(() => {
    if (document.body.dataset.screen === 'game' && !session) go('tamat', { replace: true });
  }, 1400);
}

function renderResult() {
  const r = lastResult;
  show('result');
  $('#res-title').textContent = r.win === PLAYER ? 'Anda Menang!' : r.win === AI ? 'AI Menang' : 'Seri';
  $('#res-detail').textContent = `Anda ${r.stores[PLAYER]} – ${r.stores[AI]} AI`;
  $('#res-level').textContent = `Tahap ${LEVELS[r.level].name}`;
  $('#res-score').textContent = number(r.points);
  $('#res-time').textContent = `Masa ${lb.formatDuration(r.seconds)}`;
  renderSubmit();
}

function renderSubmit() {
  if (!lastResult || document.body.dataset.screen !== 'result') return;
  const r = lastResult, box = $('#res-submit');
  box.replaceChildren();
  box.className = 'res-submit';
  const st = r.submit.status;
  box.textContent = st === 'offline' ? 'Papan markah belum dikonfigurasi. Markah disimpan dalam peranti ini sahaja.'
    : st === 'sending' || st === 'pending' ? 'Menghantar markah…'
      : st === 'done' ? (r.points ? 'Markah direkodkan.' : 'Pusingan direkodkan. Menang untuk dapat markah!')
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

function openBoard() { show('board'); board.open(); } // shared/board.js: always opens on Hari Ini
// ---------- wiring ----------

function init() {
  initFromArked();
  initAppsWarga();
  initProfile();
  const help = () => $('#dlg-help').showModal();
  $('#btn-help').addEventListener('click', help);
  $('#btn-game-help').addEventListener('click', help);
  $('#help-close').addEventListener('click', () => $('#dlg-help').close());
  $('#btn-hub').addEventListener('click', backToArked);
  $('#btn-close-app').addEventListener('click', closeMiniApp);
  $('#btn-version').addEventListener('click', () => { $('#btn-version').disabled = true; toast('Memuat semula…'); hardReload(); });

  for (const b of document.querySelectorAll('.cg-levels [data-level]')) b.addEventListener('click', () => saveSetting('level', b.dataset.level));
  $('#set-sound').addEventListener('click', () => { saveSetting('sound', !settings().sound); unlockSound(); playSound('drop'); });
  $('#set-follow').addEventListener('click', () => saveSetting('follow', !settings().follow));
  $('#set-fast').addEventListener('click', () => { saveSetting('fast', !settings().fast); scene?.setSpeed(settings().fast ? 2 : 1); });

  $('#btn-play').addEventListener('click', () => go('main'));
  $('#btn-board').addEventListener('click', () => go('papan'));
  $('#btn-quit').addEventListener('click', () => go(''));
  for (const b of document.querySelectorAll('#osom-choices button')) b.addEventListener('click', () => chooseOsom(b.dataset.osom));
  // The osom can't be dismissed: it decides who starts. ‹ (or Back) leaves the round instead.
  $('#dlg-osom').addEventListener('cancel', (e) => { e.preventDefault(); go(''); });

  $('#res-home').addEventListener('click', () => go(''));
  $('#res-again').addEventListener('click', () => go('main', { replace: true }));
  $('#res-board').addEventListener('click', () => go('papan'));
  $('#btn-board-back').addEventListener('click', () => go(''));


  // Arrow keys turn the camera round the board (← →) or tilt it (↑ ↓); 0 puts it back.
  document.addEventListener('keydown', (e) => {
    if (document.body.dataset.screen !== 'game' || !scene || document.querySelector('dialog[open]')) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const turn = { ArrowLeft: [-0.15, 0], ArrowRight: [0.15, 0], ArrowUp: [0, 0.08], ArrowDown: [0, -0.08] }[e.key];
    if (turn) { e.preventDefault(); scene.turnView(...turn); }
    else if (e.key === '0' || e.key === 'Home') { e.preventDefault(); scene.resetView(); }
  });
  window.addEventListener('hashchange', route);
  if (!storeGet(K.seenHelp, false)) {
    storeSet(K.seenHelp, true);
    help();
  }
  route();
  requestAnimationFrame(() => notifyAppReady());
  // Fetch the 3D code (Three.js is large) while the home screen shows, so Main starts at once.
  setTimeout(() => import('./scene.js').catch(() => {}), 800);
}

init();
