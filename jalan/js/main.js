// Jalan: screens, the game loop, controls, levels in a row, results and the board.
// Nothing about a run is kept: each Main starts fresh, and only the final score is sent to the
// leaderboard. Each try at a level picks its traps afresh, and after a death never the same trick
// that just got the player, so the road can't simply be learnt.
import { parseLevel, createAttempt, step, levelPoints, DT, PLAYER } from './road.js';
import { buildGround, rollTraps, LEVEL_COUNT } from './gen.js';
import { createFx, burst, say, drawScene } from './scene.js';
import { setMuted, unlockSound, play as playSound } from './sound.js';
import { initAppsWarga, appsWargaHaptic, appsWargaShare, closeMiniApp, notifyAppReady } from '../../shared/appswarga.js';
import { initFromArked, backToArked, shareUrl } from '../../shared/arked-link.js';
import { initProfile, loadProfile, withProfile } from '../../shared/profile.js';
import { gameKey, readShared, writeShared } from '../../shared/shared-store.js';
import * as lb from '../../shared/leaderboard.js';
import { createBoard } from '../../shared/board.js';
import { hardReload } from '../../shared/reload.js';

const GAME_ID = 'jalan';
const TITLE = 'Jalan';
const board = createBoard({ game: GAME_ID }); // Papan Markah (shared/board.js)
const SCREENS = ['home', 'game', 'result', 'board'];
const $ = (sel) => document.querySelector(sel);
// For testing on this computer only: ?tahap=5 starts at level 5, and such runs aren't recorded.
const TEST_LEVEL = ['localhost', '127.0.0.1'].includes(location.hostname)
  ? Math.min(LEVEL_COUNT, Math.max(0, Math.floor(Number(new URLSearchParams(location.search).get('tahap')) || 0)))
  : 0;

// Funny, and only ever about the runner's own bad luck.
const QUIPS = {
  lubang: ['Alamak, terjatuh!', 'Eh, mana pergi jalan tadi?!', 'Tersilap langkah!', 'Lantai hilang!', 'Kaki: tak boleh harap!'],
  paku: ['Aduh, kaki!', 'Pedihnya!', 'Kena cucuk!'],
  lori: ['Pon pon!', 'Laju betul!', 'Nasib baik dalam game!'],
  motor: ['Vroom! Tak sempat!', 'Laju betul!', 'Hon pun tak sempat!'],
  kucing: ['Meow! Terkejut!', 'Kucing menang hari ni.', 'Kucing pun nak cepat!', 'Kalah lumba dengan kucing…'],
  bola: ['Gol! Eh, kena muka.', 'Bola siapa ni?!', 'Boing!'],
  burung: ['Burung pun nak lalu!', 'Kena patuk!', 'Ciap ciap!', 'Sepatutnya tunduk tadi…'],
  durian: ['Kena durian! Busuk!', 'Raja buah menang.', 'Aduh, kepala!'],
  kelapa: ['Bonk! Kelapa!', 'Kelapa jatuh, kepala sakit.', 'Air kelapa percuma!'],
  papan: ['Papan tanda pun jatuh!', 'Bonk!', 'Baca papan tu dulu…'],
  pokok: ['Timber!', 'Tak sempat lari!', 'Pokok pun penat berdiri.'],
  tiang: ['Tiang pun nak rehat!', 'Tak sempat lari!', 'Bonk!'],
  longkang: ['Plup! Basah!', 'Mandi percuma!', 'Basah lencun!'],
  jentolak: ['Jentolak menang!', 'Patut undur tadi…', 'Jentolak tak nampak saya!'],
  pancut: ['Basah kuyup!', 'Air pancut kuat betul!', 'Sabar, tunggu sekejap!'],
  wayar: ['Zap! Jangan lompat!', 'Rambut berdiri!', 'Bzzzt!'],
  buaya: ['Buaya lapar!', 'Sabar, tunggu buaya turun!', 'Snap!'],
  batu: ['Batu golek!', 'Bergolek-golek!', 'Undur, undur!'],
};
export const LIVES = 3;
const pick = (list) => list[Math.floor(Math.random() * list.length)];

let soundOn = true; // for this visit only: nothing is saved
let game = null;
// { levels, index, s (the attempt), phase: 'ready'|'running'|'paused'|'dying'|'between'|'over',
//   score, deaths, levelDeaths, levelTime, totalTime, cleared: [], fx, acc, lastTs, prevJump }
let lastResult = null;
let rafId = 0;
let toastTimer = 0;
let view = { w: 300, h: 300, dpr: 1 };
const input = { left: false, right: false, jump: false };

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

const fmt = (n) => n.toLocaleString('ms-MY');
const formatTime = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

// ---------- routing ----------

function show(name) {
  for (const s of SCREENS) $(`#screen-${s}`).hidden = s !== name;
  document.body.dataset.screen = name;
}

// History follows the screens, as in the other games: a screen above home is pushed (marked
// `up`), so the phone's Back returns home, and going home steps back over it.
function go(path, replace = false) {
  const target = `#/${path}`;
  if (!path) {
    if (history.state?.up) return history.back();
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

function renderSound() {
  $('#set-sound').setAttribute('aria-checked', String(soundOn));
  $('#set-sound-hint').textContent = soundOn ? 'Kesan bunyi' : 'Senyap';
  setMuted(!soundOn);
}

function renderHome() {
  show('home');
  renderSound();
}

// ---------- the run ----------

function startGame() {
  stopGame();
  game = {
    ground: null, // the level's road (gen.js); its tricks are rolled again on every try
    level: null,
    index: Math.max(0, TEST_LEVEL - 1),
    s: null, phase: 'ready', score: 0, deaths: 0, lives: LIVES, levelDeaths: 0, levelTime: 0, totalTime: 0,
    cleared: [], fx: createFx(), acc: 0, lastTs: 0, prevJump: false,
  };
  show('game');
  // Tell Arked Warga this game was played (its continue card).
  writeShared(gameKey(GAME_ID), { ...readShared(gameKey(GAME_ID)), lastPlayedAt: Date.now(), daily: null });
  fitCanvas();
  openLevel();
}

function openLevel() {
  game.ground = buildGround(game.index + 1);
  game.def = rollTraps(game.ground);
  game.level = parseLevel(game.def);
  const level = game.level;
  game.s = createAttempt(level);
  game.levelDeaths = 0;
  game.levelTime = 0;
  game.phase = 'ready';
  renderHud();
  draw(performance.now(), 0);
  const card = h('div');
  card.append(
    h('p', 'jl-level', `Tahap ${game.index + 1}/${LEVEL_COUNT} · ${game.def.kinds.length} helah`),
    h('h2', null, level.name),
    h('p', null, level.hint),
  );
  const btn = h('button', 'btn btn-gold', game.index === 0 ? 'Mula' : 'Teruskan');
  btn.type = 'button';
  btn.addEventListener('click', start);
  card.append(btn);
  overlay(card);
  btn.focus();
}

function start() {
  if (!game || !['ready', 'paused'].includes(game.phase)) return;
  unlockSound();
  playSound('go');
  game.phase = 'running';
  game.lastTs = 0;
  game.acc = 0;
  overlay(null);
  cancelAnimationFrame(rafId);
  rafId = requestAnimationFrame(loop);
}

function pause() {
  if (game?.phase !== 'running') return;
  game.phase = 'paused';
  releaseAll();
  playSound('rest');
  const card = h('div');
  card.append(h('h2', null, 'Rehat'), h('p', null, `Tahap ${game.index + 1} · ${game.lives} nyawa · ${fmt(game.score)} mata`));
  const btn = h('button', 'btn btn-gold', 'Sambung');
  btn.type = 'button';
  btn.addEventListener('click', start);
  const end = h('button', 'btn btn-ghost', 'Tamatkan & rekod markah');
  end.type = 'button';
  end.addEventListener('click', () => finish(false));
  const row = h('div', 'jl-card-actions');
  row.append(btn, end);
  card.append(row);
  overlay(card);
}

function stopGame() {
  cancelAnimationFrame(rafId);
  releaseAll();
  game = null;
}

function overlay(card) {
  $('#overlay').hidden = !card;
  $('#overlay-card').replaceChildren(...(card ? [card] : []));
}

/** Fixed-step loop: the rules always move in steps of DT, whatever the frame rate. */
function loop(ts) {
  if (!game) return;
  const dt = game.lastTs ? Math.min(ts - game.lastTs, 100) / 1000 : 0;
  game.lastTs = ts;
  if (game.phase === 'running') {
    game.acc += dt;
    while (game.acc >= DT && game.phase === 'running') {
      game.acc -= DT;
      game.levelTime += DT;
      game.totalTime += DT;
      const jumpPressed = input.jump && !game.prevJump;
      game.prevJump = input.jump;
      for (const e of step(game.s, { ...input, jumpPressed })) onEvent(e);
    }
  }
  renderHud();
  draw(ts, dt);
  if (game && ['running', 'dying', 'between'].includes(game.phase)) rafId = requestAnimationFrame(loop);
}

function onEvent(e) {
  const { s, fx } = game;
  const cx = s.x + PLAYER.w / 2;
  switch (e.type) {
    case 'jump':
      playSound('jump');
      break;
    case 'land':
      playSound('land');
      break;
    case 'kunciDapat':
      playSound('kunciDapat');
      appsWargaHaptic('notification', 'success');
      say(fx, cx, s.y, 'Dapat kunci! Balik ke rumah!', '#9dffb0');
      break;
    case 'trap':
      playSound(e.trap);
      if (e.trap === 'pening') say(fx, cx, s.y, 'Pening! Kiri jadi kanan!', '#ffe14a');
      if (e.trap === 'rumahPalsu') say(fx, cx, s.y, 'Rumah palsu!', '#ffd54a');
      if (e.trap === 'suis') say(fx, cx, s.y, 'Klik! Pagar terbuka!', '#9dffb0');
      if (e.trap === 'kunci') say(fx, cx, s.y, 'Berkunci! Kunci di belakang!', '#ffd54a');
      if (e.trap === 'runtuh' || e.trap === 'tembok') fx.shake = 0.6;
      if (e.trap === 'pintu') say(fx, s.exit.x + 0.5, s.exit.y, 'Hehe!', '#ffd54a');
      break;
    case 'die':
      game.phase = 'dying';
      game.deaths += 1;
      game.levelDeaths += 1;
      // Keep a held direction through the death (a thumb still on ▶ carries on); only the jump lets go.
      input.jump = false;
      document.querySelector('.jl-pad[data-key="jump"]')?.classList.remove('on');
      playSound('die');
      appsWargaHaptic('notification', 'error');
      fx.shake = 1;
      burst(fx, cx, Math.min(11.5, s.y + PLAYER.h / 2), '#2f9e6a', 22);
      say(fx, cx, Math.min(11, s.y), pick(QUIPS[e.cause] ?? QUIPS.lubang), '#fff');
      game.lives -= 1;
      $('#lives').classList.remove('shake');
      void $('#lives').offsetWidth;
      $('#lives').classList.add('shake');
      if (game.lives <= 0) {
        // No lives left: the run is over, and the next one starts from level 1.
        later(() => finish(false), 1300);
        break;
      }
      say(fx, cx, Math.min(11, s.y) + 1.2, game.lives === 1 ? 'Nyawa terakhir!' : `Tinggal ${game.lives} nyawa`, '#ffb3b3');
      later(() => {
        retry();
        game.phase = 'running';
        game.acc = 0;
      }, 1000);
      break;
    case 'win': {
      game.phase = 'between';
      releaseAll();
      const points = levelPoints(game.levelTime, game.levelDeaths, game.level.w);
      game.score += points;
      game.cleared.push({ name: game.level.name, deaths: game.levelDeaths, seconds: game.levelTime, points });
      const last = game.index === LEVEL_COUNT - 1;
      playSound(last ? 'done' : 'win');
      appsWargaHaptic('notification', 'success');
      say(fx, cx, s.y, `Sampai! +${points}`, '#ffd54a');
      later(() => {
        if (last) return finish(true);
        game.index += 1;
        game.fx = createFx();
        openLevel();
      }, 1100);
      break;
    }
  }
}

/** A new try at the current level: same road, all its tricks rolled again. */
function retry() {
  const before = game.def.kinds.join();
  let def = rollTraps(game.ground);
  for (let i = 0; i < 12 && def.kinds.join() === before; i++) def = rollTraps(game.ground);
  game.def = def;
  game.level = parseLevel(def);
  game.s = createAttempt(game.level);
}

/** Runs `fn` after `ms`, unless the game was left meanwhile. */
function later(fn, ms) {
  const g = game;
  setTimeout(() => game === g && game && fn(), ms);
}

function finish(allDone) {
  const g = game;
  g.phase = 'over';
  releaseAll();
  lastResult = {
    allDone,
    outOfLives: g.lives <= 0,
    score: g.score,
    cleared: g.cleared,
    deaths: g.deaths,
    reached: g.index + 1,
    total: LEVEL_COUNT,
    seconds: Math.max(1, Math.round(g.totalTime)),
    submit: { status: TEST_LEVEL ? 'test' : g.score > 0 ? 'pending' : 'skipped' },
  };
  if (lastResult.submit.status === 'pending') submitResult(lastResult);
  go('tamat', true);
}

// ---------- drawing ----------

function fitCanvas() {
  const stage = $('#stage');
  const w = stage.clientWidth;
  const hgt = stage.clientHeight;
  if (!w || !hgt) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const canvas = $('#road');
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(hgt * dpr);
  view = { w, h: hgt, dpr };
}

function draw(t, dt) {
  if (!game?.s) return;
  drawScene($('#road').getContext('2d'), view, game.s, game.fx, t, dt);
}

function renderHud() {
  if (!game) return;
  $('#game-title').textContent = `Tahap ${game.index + 1}/${LEVEL_COUNT}`;
  $('#game-sub').textContent = `${fmt(game.score)} mata`;
  $('#deaths').textContent = String(game.deaths);
  const lives = $('#lives');
  if (lives.dataset.n !== String(game.lives)) {
    lives.dataset.n = String(game.lives);
    lives.replaceChildren(...Array.from({ length: LIVES }, (_, i) => h('span', i < game.lives ? null : 'lost', '❤️')));
  }
  $('#clock').textContent = formatTime(game.totalTime);
}

// ---------- controls ----------

function releaseAll() {
  input.left = input.right = input.jump = false;
  for (const b of document.querySelectorAll('.jl-pad.on')) b.classList.remove('on');
}

function initPads() {
  for (const b of document.querySelectorAll('.jl-pad')) {
    const key = b.dataset.key;
    const set = (on) => {
      input[key] = on;
      b.classList.toggle('on', on);
    };
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      unlockSound();
      if (game?.phase === 'ready') start();
      b.setPointerCapture?.(e.pointerId);
      set(true);
    });
    for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) b.addEventListener(ev, () => set(false));
    b.addEventListener('contextmenu', (e) => e.preventDefault());
  }
}

const KEYS = {
  ArrowLeft: 'left', a: 'left', A: 'left',
  ArrowRight: 'right', d: 'right', D: 'right',
  ArrowUp: 'jump', w: 'jump', W: 'jump', ' ': 'jump',
};

function onKey(e, down) {
  if (document.body.dataset.screen !== 'game' || !game || document.querySelector('dialog[open]')) return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const k = KEYS[e.key];
  if (k && !(e.key === ' ' && e.target.closest?.('button'))) {
    e.preventDefault();
    if (down && game.phase === 'ready') start();
    input[k] = down;
    document.querySelector(`.jl-pad[data-key="${k}"]`)?.classList.toggle('on', down);
  } else if (down && (e.key === 'p' || e.key === 'P' || e.key === 'Escape')) {
    e.preventDefault();
    if (game.phase === 'running') pause();
    else if (game.phase === 'paused') start();
  }
}

// ---------- result ----------

function renderResult() {
  const r = lastResult;
  show('result');
  $('#res-badge').textContent = r.allDone ? (r.deaths <= 10 ? '🏆' : '🏠') : '🕳️';
  $('#res-title').textContent = r.allDone ? 'Sampai Rumah!' : r.outOfLives ? 'Nyawa Habis!' : 'Berhenti Rehat';
  $('#res-mode').textContent = r.allDone
    ? `Semua ${r.total} tahap · ${formatTime(r.seconds)}`
    : `Tersangkut di Tahap ${r.reached} daripada ${r.total} · ${formatTime(r.seconds)}. Main Lagi bermula dari Tahap 1.`;
  $('#res-levels').textContent = `${r.cleared.length}/${r.total}`;
  $('#res-deaths').textContent = String(r.deaths);
  $('#res-score').textContent = fmt(r.score);
  const worst = [...r.cleared].sort((a, b) => b.deaths - a.deaths)[0];
  $('#res-extra').textContent = worst && worst.deaths > 0 ? `Paling banyak mati: ${worst.name} (${worst.deaths} kali)` : r.cleared.length ? 'Tak mati langsung? Hebat!' : '';
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
    case 'test':
      return msg('Ujian (?tahap): markah tidak direkodkan.');
    case 'skipped':
      return msg('Habiskan sekurang-kurangnya satu tahap untuk direkodkan.');
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
  const text = `${TITLE} · ${r.cleared.length}/${r.total} tahap\n🕳️ Mati ${r.deaths} kali · ${fmt(r.score)} mata`;
  const url = shareUrl();
  const viaApp = await appsWargaShare({ text, url, title: TITLE });
  if (viaApp) return;
  try {
    if (navigator.share) return await navigator.share({ text, url, title: TITLE });
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
  $('#set-sound').addEventListener('click', () => {
    soundOn = !soundOn;
    renderSound();
    appsWargaHaptic('selection');
    unlockSound();
    playSound('jump');
  });
  $('#btn-play').addEventListener('click', () => go('main'));
  $('#btn-board').addEventListener('click', () => go('papan'));

  $('#btn-quit').addEventListener('click', () => go(''));
  $('#btn-pause').addEventListener('click', () => (game?.phase === 'running' ? pause() : start()));
  initPads();
  document.addEventListener('keydown', (e) => onKey(e, true));
  document.addEventListener('keyup', (e) => onKey(e, false));

  $('#res-again').addEventListener('click', () => go('main', true));
  $('#res-share').addEventListener('click', shareResult);
  $('#res-board').addEventListener('click', () => go('papan'));
  $('#res-home').addEventListener('click', () => go(''));
  $('#btn-board-back').addEventListener('click', () => go(''));

  // Pause when the player looks away: the page is hidden, or AppsWarga goes to the background.
  document.addEventListener('visibilitychange', () => document.hidden && pause());
  window.addEventListener('appswargaDeactivated', pause);
  window.addEventListener('blur', pause);
  new ResizeObserver(() => {
    if (document.body.dataset.screen === 'game' && game) {
      fitCanvas();
      draw(performance.now(), 0);
    }
  }).observe($('#stage'));

  window.addEventListener('hashchange', route);
  route();
  requestAnimationFrame(() => notifyAppReady());
}

init();
