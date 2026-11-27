// Ular: screens, the game loop, drawing, input, results and the leaderboard.
import { createGame, step, stepMs, turn, POINTS } from './snake.js';
import { setMuted, unlockSound, play as playSound } from './sound.js';
import { initAppsWarga, appsWargaHaptic, appsWargaShare, closeMiniApp, notifyAppReady } from '../../shared/appswarga.js';
import { initFromArked, backToArked, shareUrl } from '../../shared/arked-link.js';
import { initProfile, loadProfile, withProfile } from '../../shared/profile.js';
import { gameKey, readShared, writeShared } from '../../shared/shared-store.js';
import * as lb from '../../shared/leaderboard.js';
import { createBoard } from '../../shared/board.js';
import { hardReload } from '../../shared/reload.js';

const GAME_ID = 'ular';
const board = createBoard({ game: GAME_ID }); // Papan Markah (shared/board.js)
const K = { settings: 'ul.settings', stats: 'ul.stats', seenHelp: 'ul.seenHelp' };
const SCREENS = ['home', 'game', 'result', 'board'];
const $ = (sel) => document.querySelector(sel);

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

const settings = () => ({ walls: true, dpad: true, sound: true, ...store.get(K.settings, {}) });

let game = null; // { state, phase: 'ready'|'running'|'paused'|'over', playedMs, lastTs, acc }
let lastResult = null;
let rafId = 0;
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
  toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
}

const formatTime = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
const modeLabel = (walls) => (walls ? 'Dinding' : 'Tanpa dinding');

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
  if (path !== 'main') stopGame();
  switch (path) {
    case 'main':
      return withProfile(startGame);
    case 'tamat':
      return lastResult ? renderResult() : go('', true);
    case 'papan':
      return openBoard();
    default:
      return renderHome();
  }
}

// ---------- home ----------

function renderSettings() {
  const s = settings();
  $('#set-walls').setAttribute('aria-checked', String(s.walls));
  $('#set-walls-hint').textContent = s.walls
    ? `Langgar tepi, tamat · ${POINTS.walls} mata`
    : `Tembus ke sisi lain · ${POINTS.open} mata`;
  $('#set-dpad').setAttribute('aria-checked', String(s.dpad));
  $('#set-dpad-hint').textContent = s.dpad ? 'Butang arah di skrin' : 'Leret sahaja';
  $('#set-sound').setAttribute('aria-checked', String(s.sound));
  $('#set-sound-hint').textContent = s.sound ? 'Kesan bunyi' : 'Senyap';
  setMuted(!s.sound);
}

function toggleSetting(key) {
  store.set(K.settings, { ...settings(), [key]: !settings()[key] });
  renderSettings();
  appsWargaHaptic('selection');
}

function renderHome() {
  show('home');
  renderSettings();
  const st = store.get(K.stats, { played: 0, best: 0 });
  $('#st-best').textContent = st.best.toLocaleString('ms-MY');
  $('#st-played').textContent = st.played;
}

// ---------- game ----------

function startGame() {
  const s = settings();
  stopGame();
  game = { state: createGame({ walls: s.walls }), phase: 'ready', playedMs: 0, lastTs: 0, acc: 0 };
  show('game');
  $('#screen-game').classList.toggle('no-dpad', !s.dpad);
  $('#board-box').classList.toggle('walls', s.walls);
  $('#game-mode').textContent = modeLabel(s.walls);
  renderScore();
  fitBoard();
  overlay('Tekan arah atau Mula', 'Mula', start);
  draw();
  // Tell Arked Warga this game was played (its continue card).
  writeShared(gameKey(GAME_ID), { ...readShared(gameKey(GAME_ID)), lastPlayedAt: Date.now(), daily: null });
}

function start() {
  if (!game || game.phase === 'running' || game.phase === 'over') return;
  unlockSound();
  playSound('go');
  game.phase = 'running';
  game.lastTs = 0;
  overlay(null);
  cancelAnimationFrame(rafId);
  rafId = requestAnimationFrame(tick);
}

function pause() {
  if (game?.phase !== 'running') return;
  game.phase = 'paused';
  cancelAnimationFrame(rafId);
  playSound('rest');
  overlay('Rehat', 'Sambung', start); // ‹ at the top leaves the game
}

function stopGame() {
  cancelAnimationFrame(rafId);
  if (game && game.phase !== 'over') game.phase = 'over';
  game = null;
}

function overlay(text, button, onClick) {
  const box = $('#overlay');
  box.hidden = !text;
  if (!text) return;
  $('#overlay-text').textContent = text;
  const btn = $('#overlay-btn');
  btn.textContent = button;
  btn.onclick = onClick;
}

/** Fixed-step loop: the snake moves every stepMs(foods) ms, whatever the frame rate. */
function tick(ts) {
  if (!game || game.phase !== 'running') return;
  if (game.lastTs) {
    const dt = Math.min(ts - game.lastTs, 250); // a long frame (e.g. after a hitch) doesn't jump far
    game.acc += dt;
    game.playedMs += dt;
  }
  game.lastTs = ts;
  const { state } = game;
  while (game.acc >= stepMs(state.foods)) {
    game.acc -= stepMs(state.foods);
    const ev = step(state);
    if (ev === 'eat') {
      appsWargaHaptic('impact', 'light');
      playSound('eat', state.foods);
      renderScore();
    } else if (ev === 'dead' || ev === 'won') {
      playSound(ev === 'won' ? 'won' : 'crash');
      draw();
      return finish(ev === 'won');
    }
  }
  draw();
  rafId = requestAnimationFrame(tick);
}

function steer(dir) {
  if (!game || game.phase === 'over') return;
  if (game.phase === 'paused') return;
  unlockSound();
  const turned = turn(game.state, dir);
  if (game.phase === 'ready') start();
  else if (turned) playSound('turn');
}

function renderScore() {
  $('#game-score').textContent = `${game.state.score.toLocaleString('ms-MY')} mata`;
}

async function finish(won) {
  const g = game;
  g.phase = 'over';
  const { state } = g;
  const seconds = Math.max(1, Math.round(g.playedMs / 1000));
  appsWargaHaptic('notification', won ? 'success' : 'error');
  if (!won) {
    $('#board-box').classList.remove('hit');
    void $('#board-box').offsetWidth;
    $('#board-box').classList.add('hit');
  }
  const st = store.get(K.stats, { played: 0, best: 0 });
  const prevBest = st.best;
  st.played += 1;
  st.best = Math.max(st.best, state.score);
  store.set(K.stats, st);
  lastResult = {
    won,
    walls: state.walls,
    score: state.score,
    foods: state.foods,
    seconds,
    newBest: state.score > prevBest && state.score > 0,
    best: st.best,
    submit: { status: state.score > 0 ? 'pending' : 'skipped' },
  };
  if (lastResult.submit.status === 'pending') submitResult(lastResult);
  await new Promise((r) => setTimeout(r, 700)); // let the crash register
  if (game !== g) return;
  go('tamat', true);
  if (lastResult.newBest) playSound('best');
}

// ---------- drawing ----------

let cellPx = 16;

/** Sizes the canvas to the biggest square that fits the stage, sharp on high-DPI screens. */
function fitBoard() {
  const stage = $('#stage');
  const box = $('#board-box');
  const canvas = $('#board');
  const size = game?.state.size ?? 20;
  const border = 6; // 3px each side
  const avail = Math.min(stage.clientWidth, stage.clientHeight) - border;
  if (avail <= 0) return;
  cellPx = Math.max(8, Math.floor(avail / size));
  const css = cellPx * size;
  const dpr = window.devicePixelRatio || 1;
  canvas.style.width = canvas.style.height = `${css}px`;
  canvas.width = canvas.height = Math.round(css * dpr);
  canvas.getContext('2d').setTransform(dpr, 0, 0, dpr, 0, 0);
  box.style.width = box.style.height = `${css + border}px`;
}

function roundRect(ctx, x, y, w, hgt, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + hgt, r);
  ctx.arcTo(x + w, y + hgt, x, y + hgt, r);
  ctx.arcTo(x, y + hgt, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Mixes hex colour `a` toward `b` by `t` (0 = a, 1 = b); `a` falls back to purple if it isn't #rrggbb. */
function mix(a, b, t) {
  const rgb = (hex) => {
    const n = parseInt(/^#[0-9a-f]{6}$/i.test(hex) ? hex.slice(1) : '7b1fa2', 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };
  const A = rgb(a);
  const B = rgb(b);
  return `#${A.map((v, i) => Math.round(v + (B[i] - v) * t).toString(16).padStart(2, '0')).join('')}`;
}

function draw() {
  if (!game) return;
  const ctx = $('#board').getContext('2d');
  const css = getComputedStyle(document.documentElement);
  const color = (name) => css.getPropertyValue(name).trim();
  const { state } = game;
  const c = cellPx;
  const n = state.size;
  const primary = color('--primary');
  // A dark board (the theme colour, almost black) with fine near-white lines between cells.
  const board = mix(primary, '#0b0b0f', 0.86);
  $('#board-box').style.background = board;
  ctx.fillStyle = board;
  ctx.fillRect(0, 0, c * n, c * n);
  ctx.strokeStyle = 'rgba(245, 245, 250, 0.16)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 1; i < n; i++) {
    // +0.5 puts a 1px line exactly on a pixel row, so it stays sharp.
    const p = Math.round(i * c) + 0.5;
    ctx.moveTo(p, 0);
    ctx.lineTo(p, c * n);
    ctx.moveTo(0, p);
    ctx.lineTo(c * n, p);
  }
  ctx.stroke();
  // Food: a gold dot.
  if (state.food) {
    ctx.fillStyle = color('--gold');
    ctx.beginPath();
    ctx.arc(state.food.x * c + c / 2, state.food.y * c + c / 2, c * 0.38, 0, Math.PI * 2);
    ctx.fill();
  }
  // Snake: light tints of the theme colour so it stands out on the dark board; the head is the
  // lightest (red once it crashes).
  const dead = state.status === 'dead';
  const pad = Math.max(1, c * 0.08);
  const head = mix(primary, '#ffffff', 0.62);
  const body = mix(primary, '#ffffff', 0.3);
  state.snake.forEach((cell, i) => {
    ctx.fillStyle = i === 0 ? (dead ? color('--bad') : head) : body;
    roundRect(ctx, cell.x * c + pad, cell.y * c + pad, c - pad * 2, c - pad * 2, c * 0.28);
    ctx.fill();
  });
}

// ---------- input ----------

const KEYS = {
  ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
  w: 'up', s: 'down', a: 'left', d: 'right', W: 'up', S: 'down', A: 'left', D: 'right',
};

function onKey(e) {
  if (document.body.dataset.screen !== 'game' || !game || document.querySelector('dialog[open]')) return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (KEYS[e.key]) {
    e.preventDefault();
    steer(KEYS[e.key]);
  } else if (e.key === ' ' || e.key === 'p' || e.key === 'P' || e.key === 'Escape') {
    e.preventDefault();
    if (game.phase === 'running') pause();
    else if (game.phase !== 'over') start();
  }
}

/** Swipes on the board: every 24 px of movement in one gesture is one turn. */
function initSwipe() {
  const stage = $('#stage');
  let from = null;
  stage.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.ul-overlay')) return;
    from = { x: e.clientX, y: e.clientY };
  });
  stage.addEventListener('pointermove', (e) => {
    if (!from) return;
    const dx = e.clientX - from.x;
    const dy = e.clientY - from.y;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 24) return;
    steer(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up');
    from = { x: e.clientX, y: e.clientY };
  });
  for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) stage.addEventListener(ev, () => (from = null));
}

function initDpad() {
  for (const b of document.querySelectorAll('.dpad-btn')) {
    // pointerdown, not click: a turn should happen the moment the finger lands.
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      steer(b.dataset.dir);
      appsWargaHaptic('selection');
    });
    b.addEventListener('click', (e) => {
      if (e.detail === 0) steer(b.dataset.dir); // keyboard activation (Enter/Space on the button)
    });
  }
}

// ---------- result ----------

function renderResult() {
  const r = lastResult;
  show('result');
  $('#res-badge').textContent = r.won ? '🏆' : r.newBest ? '🎉' : '🐍';
  $('#res-title').textContent = r.won ? 'Papan Penuh!' : r.newBest ? 'Rekod Baharu!' : 'Tamat';
  $('#res-mode').textContent = modeLabel(r.walls);
  $('#res-foods').textContent = String(r.foods);
  $('#res-time').textContent = formatTime(r.seconds);
  $('#res-score').textContent = r.score.toLocaleString('ms-MY');
  const best = $('#res-best');
  best.textContent = r.newBest ? 'Markah terbaik anda!' : `Terbaik: ${r.best.toLocaleString('ms-MY')}`;
  best.classList.toggle('new', r.newBest);
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
    case 'skipped':
      return msg('Makan sekurang-kurangnya satu untuk direkodkan.');
    case 'offline':
      return msg('Papan markah belum dikonfigurasi.');
    case 'pending':
    case 'sending':
      return msg('Menghantar markah…', 'busy');
    case 'done':
      return msg('Markah direkodkan.', 'ok');
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
  const profile = loadProfile();
  if (!lb.boardsConfigured() || !profile) {
    r.submit = { status: 'offline' };
    return renderSubmit();
  }
  r.submit = { status: 'sending' };
  renderSubmit();
  try {
    await lb.recordRound({ game: GAME_ID, profile, points: r.score, seconds: r.seconds });
    r.submit = { status: 'done' };
  } catch (err) {
    r.submit = { status: 'error', msg: err.message };
  }
  renderSubmit();
}

async function shareResult() {
  const r = lastResult;
  const text = `Ular · ${modeLabel(r.walls)}\n🐍 ${r.score} mata · ${r.foods} makanan · ${formatTime(r.seconds)}`;
  const url = shareUrl();
  const viaApp = await appsWargaShare({ text, url, title: 'Ular' });
  if (viaApp) return;
  try {
    if (navigator.share) return await navigator.share({ text, url, title: 'Ular' });
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

  $('#btn-help').addEventListener('click', () => $('#dlg-help').showModal());
  $('#help-close').addEventListener('click', () => $('#dlg-help').close());
  $('#btn-close-app').addEventListener('click', closeMiniApp);
  $('#btn-hub').addEventListener('click', backToArked);
  $('#btn-version').addEventListener('click', () => {
    $('#btn-version').disabled = true;
    toast('Memuat semula…');
    hardReload();
  });
  $('#set-walls').addEventListener('click', () => toggleSetting('walls'));
  $('#set-dpad').addEventListener('click', () => toggleSetting('dpad'));
  $('#set-sound').addEventListener('click', () => { toggleSetting('sound'); unlockSound(); playSound('eat', 8); });
  $('#btn-play').addEventListener('click', () => go('main'));
  $('#btn-board').addEventListener('click', () => go('papan'));

  $('#btn-quit').addEventListener('click', () => go(''));
  $('#btn-pause').addEventListener('click', () => (game?.phase === 'running' ? pause() : start()));
  initDpad();
  initSwipe();
  document.addEventListener('keydown', onKey);

  $('#res-again').addEventListener('click', () => go('main', true));
  $('#res-share').addEventListener('click', shareResult);
  $('#res-board').addEventListener('click', () => go('papan'));
  $('#res-home').addEventListener('click', () => go(''));

  $('#btn-board-back').addEventListener('click', () => go(''));


  // Pause when the player looks away: the page is hidden, or AppsWarga goes to the background.
  document.addEventListener('visibilitychange', () => document.hidden && pause());
  window.addEventListener('appswargaDeactivated', pause);
  window.addEventListener('blur', pause);
  window.addEventListener('appswargaThemeChange', () => requestAnimationFrame(draw));
  new ResizeObserver(() => {
    if (document.body.dataset.screen === 'game') {
      fitBoard();
      draw();
    }
  }).observe($('#stage'));

  window.addEventListener('hashchange', route);
  if (!store.get(K.seenHelp)) {
    store.set(K.seenHelp, true);
    $('#dlg-help').showModal();
  }
  route();
  requestAnimationFrame(() => notifyAppReady());
}

init();
