// Pemadam: screens, the osom that decides who starts, flicks against the AI, results and the board.
import { PLAYER, AI, LEVELS, STYLES, TARGET, newMatch, applyOutcome, roundPoints, createReferee } from './rules.js';
import { setMuted, unlockSound, play as playSound } from './sound.js';
import { initAppsWarga, appsWargaHaptic, closeMiniApp, notifyAppReady } from '../../shared/appswarga.js';
import { initFromArked, backToArked } from '../../shared/arked-link.js';
import { initProfile, loadProfile, withProfile } from '../../shared/profile.js';
import { gameKey, readShared, writeShared } from '../../shared/shared-store.js';
import { todayKL } from '../../shared/rng.js';
import * as lb from '../../shared/leaderboard.js';
import { hardReload } from '../../shared/reload.js';

const GAME_ID = 'pemadam';
const SCREENS = ['home', 'game', 'result', 'board'];
const K = { stats: 'pemadam.stats', settings: 'pemadam.settings', seenHelp: 'pemadam.seenHelp', view: 'pemadam.view', flag: 'pemadam.lastFlag' };
const OSOM = { batu: '✊', gunting: '✌️', kain: '✋' };
const OSOM_NAME = { batu: 'Batu', gunting: 'Gunting', kain: 'Kain' };
const BEATS = { batu: 'gunting', gunting: 'kain', kain: 'batu' };
const REPLAY_S = 3; // a point's replay shows at most this much of the flick
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
const randomInt = (n) => crypto.getRandomValues(new Uint32Array(1))[0] % n;

let toastTimer = 0;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 1800);
}

function settings() {
  const s = { level: 'mudah', sound: true, replay: true, style: 'kuat', ...storeGet(K.settings, {}) };
  if (!LEVELS[s.level]) s.level = 'mudah';
  if (!STYLES[s.style]) s.style = 'kuat';
  return s;
}
const stats = () => ({ played: 0, won: 0, best: 0, ...storeGet(K.stats, {}) });

/**
 * session: { match, level, flag, startedAt, phase, flight, falling } — null when no round is open.
 * phase: 'osom' · 'aim' (the player may flick) · 'ai' (the AI thinks and aims) · 'flight' (the
 * erasers move) · 'after' (a point, a fall or a pause before the next turn).
 */
let session = null;
let lastResult = null;
let boardTab = 'daily';
let boardRequest = 0;
let scene = null;
let physics = null; // the module, once loaded
let world = null;
let timers = [];

const later = (ms) => new Promise((resolve) => { timers.push(setTimeout(resolve, ms)); });

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
  for (const b of document.querySelectorAll('.pm-levels [data-level]')) b.setAttribute('aria-pressed', String(b.dataset.level === s.level));
  $('#level-hint').textContent = `Menang hingga ${number(LEVELS[s.level].max)} mata`;
  for (const [id, key, on, off] of [
    ['#set-sound', 'sound', 'Kesan bunyi pemadam', 'Senyap'],
    ['#set-replay', 'replay', 'Ulang tayang setiap mata', 'Tiada ulang tayang'],
  ]) {
    $(id).setAttribute('aria-checked', String(s[key]));
    $(`${id}-hint`).textContent = s[key] ? on : off;
  }
  for (const b of document.querySelectorAll('#pm-style [data-style]')) b.setAttribute('aria-pressed', String(b.dataset.style === s.style));
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

// ---------- loading ----------

/** Rapier (2.4 MB) and the 3D code: fetched while the home screen shows, so Main starts at once. */
let modules = null;
function loadModules() {
  modules ??= Promise.all([import('./physics.js').then(async (mod) => { await mod.loadPhysics(); return mod; }), import('./scene.js')])
    .catch((err) => { modules = null; throw err; });
  return modules;
}

/** The physics and the 3D scene (made once, on the first game). */
async function loadEngine() {
  const [phys, sceneModule] = await loadModules();
  physics = phys;
  if (!scene) {
    scene = sceneModule.createScene($('#pm-stage'), {
      topInset: () => $('#game-status').getBoundingClientRect().bottom - $('#pm-stage').getBoundingClientRect().top,
      bottomInset: () => $('#pm-stage').getBoundingClientRect().bottom - $('#pm-style').getBoundingClientRect().top + 8,
      view: storeGet(K.view, null),
      onViewChange: (view) => storeSet(K.view, view),
      onFrame,
      canAim: () => session?.phase === 'aim' && !document.querySelector('dialog[open]'),
      onAim: ({ power, x, y }) => setPower(power, { at: { x, y } }),
      onAimEnd: playerFlick,
      onSkip: () => scene.skipReplay(),
    });
  }
  return sceneModule;
}

// ---------- the round ----------

async function startGame() {
  unlockSound();
  const { level } = settings();
  show('game');
  setStatus('Memuatkan meja…', null);
  $('#game-score').textContent = `Anda 0 – 0 AI`;
  $('#game-mode').textContent = LEVELS[level].name;
  let AI_FLAGS;
  try {
    ({ AI_FLAGS } = await loadEngine());
  } catch (err) {
    console.error(err);
    toast('Peranti ini tidak dapat memaparkan permainan 3D.');
    return go('', { replace: true });
  }
  if (session || document.body.dataset.screen !== 'game' || location.hash !== '#/main') return;
  world?.free();
  world = physics.createWorld();
  // A different country's eraser for the AI each match.
  const lastFlag = storeGet(K.flag, '');
  const choices = Object.keys(AI_FLAGS).filter((f) => f !== lastFlag);
  const flag = choices[randomInt(choices.length)];
  storeSet(K.flag, flag);
  session = { match: newMatch(), level, flag, startedAt: Date.now(), phase: 'osom', flight: null, falling: false };
  writeShared(gameKey(GAME_ID), { ...readShared(gameKey(GAME_ID)), lastPlayedAt: Date.now() });
  scene.setAiFlag(flag);
  scene.setPoses(world.poses());
  scene.setTurn(false);
  scene.start();
  renderScore();
  $('#game-mode').textContent = `${LEVELS[level].name} · lawan ${AI_FLAGS[flag]}`;
  setStatus('Osom dahulu: siapa mula?', null);
  openOsom();
}

function endSession() {
  for (const t of timers) clearTimeout(t);
  timers = [];
  if ($('#dlg-osom').open) $('#dlg-osom').close();
  setPower(0, { hide: true });
  if (scene) { scene.cancelAim(); scene.hideAim(); scene.skipReplay(); scene.setTurn(false); }
  session = null;
}

function renderScore() {
  const m = session.match;
  $('#game-score').textContent = `Anda ${m.score[PLAYER]} – ${m.score[AI]} AI`;
}

function setStatus(text, who) {
  const el = $('#game-status');
  el.textContent = text;
  el.dataset.who = who === PLAYER ? 'player' : who === AI ? 'ai' : '';
}

/**
 * Sets the power gauge (0–1) beside the finger, or the AI's eraser. `at` (a point in the stage's
 * box, CSS pixels) moves the gauge there; with `hide` it goes away.
 */
function setPower(p, { at = null, hide = false } = {}) {
  const v = Math.max(0, Math.min(1, p));
  const gauge = $('#pm-gauge');
  if (hide) { gauge.hidden = true; return; }
  if (at) {
    const box = $('#pm-stage').getBoundingClientRect();
    const left = at.x + 40 + 48 + 4 < box.width ? at.x + 40 : at.x - 40 - 48;
    gauge.style.left = `${Math.max(4, left)}px`;
    gauge.style.top = `${Math.max(4, Math.min(box.height - 176, at.y - 90))}px`;
    gauge.hidden = false;
  }
  const pct = Math.round(v * 100);
  $('#pm-gauge-fill').style.clipPath = `inset(${(100 - v * 100).toFixed(2)}% 0 0 0 round 6px)`;
  gauge.style.setProperty('--p', v.toFixed(3));
  $('#pm-gauge-pct').textContent = `${pct}%`;
  gauge.setAttribute('aria-valuenow', String(pct));
}

/** Osom (batu, gunting, kain) decides who flicks first. */
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
  if (s?.phase !== 'osom' || $('#osom-arena').classList.contains('shaking')) return;
  unlockSound();
  appsWargaHaptic('selection');
  const options = Object.keys(OSOM);
  const theirs = options[randomInt(3)];
  for (const b of document.querySelectorAll('#osom-choices button')) {
    b.disabled = true;
    b.setAttribute('aria-pressed', String(b.dataset.osom === mine));
  }
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
  timers.push(setTimeout(() => {
    if (session !== s) return;
    arena.classList.remove('shaking');
    $('#osom-you').textContent = OSOM[mine];
    $('#osom-ai').textContent = OSOM[theirs];
    const result = $('#osom-result');
    if (mine === theirs) {
      $('#osom-sub').textContent = `Sama-sama ${OSOM_NAME[mine]}.`;
      result.replaceChildren(h('span', 'draw', 'Seri! Pilih sekali lagi.'));
      playSound('draw');
      timers.push(setTimeout(() => { if (session === s && s.phase === 'osom') resetOsom('Seri tadi. Pilih tangan anda.'); }, 1100));
      return;
    }
    const playerFirst = BEATS[mine] === theirs;
    $(playerFirst ? '#osom-side-you' : '#osom-side-ai').classList.add('won');
    $('#osom-sub').textContent = playerFirst ? `${OSOM_NAME[mine]} menang ${OSOM_NAME[theirs]}.` : `${OSOM_NAME[theirs]} menang ${OSOM_NAME[mine]}.`;
    result.replaceChildren(h('span', playerFirst ? 'win' : 'lose', playerFirst ? 'Anda mula dahulu!' : 'AI mula dahulu.'));
    playSound(playerFirst ? 'point' : 'turn');
    timers.push(setTimeout(() => {
      if (session !== s) return;
      $('#dlg-osom').close();
      s.match.turn = playerFirst ? PLAYER : AI;
      nextTurn();
    }, 1500));
  }, reduceMotion() ? 150 : OSOM_SHAKE_MS));
}

function nextTurn() {
  const s = session;
  if (!s) return;
  const m = s.match;
  if (m.over) return finish();
  if (m.turn === PLAYER) {
    s.phase = 'aim';
    scene.setTurn(true);
    setStatus('Giliran anda: tekan pemadam anda, tarik ke belakang, lepas.', PLAYER);
    playSound('turn');
    return;
  }
  s.phase = 'ai';
  scene.setTurn(false);
  setStatus('AI sedang berfikir…', AI);
  aiTurn(s);
}

/** The AI tries its flicks out (js/physics.js planFlick), then aims with its arrow and gauge. */
async function aiTurn(s) {
  const t0 = performance.now();
  const poses = copyPoses(world.poses());
  const shot = await physics.planFlick(poses, AI, s.level);
  await later(Math.max(0, 700 - (performance.now() - t0)));
  if (session !== s) return;
  setStatus('AI membidik…', AI);
  const ms = reduceMotion() ? 200 : 800;
  const at = scene.screenOf(AI);
  await new Promise((resolve) => {
    const start = performance.now();
    const tick = (now) => {
      if (session !== s) return resolve();
      const t = Math.min(1, (now - start) / ms);
      const p = shot.power * (1 - (1 - t) ** 3);
      scene.showAim(AI, shot.dx, shot.dz, p);
      setPower(p, { at });
      if (t < 1) requestAnimationFrame(tick);
      else timers.push(setTimeout(resolve, 250));
    };
    requestAnimationFrame(tick);
  });
  if (session !== s) return;
  scene.hideAim();
  setPower(0, { hide: true });
  launch(AI, shot);
}

/** The slingshot let go: a flick, or (shot null) a cancelled pull. */
function playerFlick(shot) {
  setPower(0, { hide: true });
  const s = session;
  if (!shot || s?.phase !== 'aim') return;
  unlockSound();
  appsWargaHaptic('impact', shot.power > 0.6 ? 'medium' : 'light');
  launch(PLAYER, { ...shot, style: settings().style });
}

const copyPoses = (poses) => poses.map((ps) => ({
  p: { x: ps.p.x, y: ps.p.y, z: ps.p.z },
  q: { x: ps.q.x, y: ps.q.y, z: ps.q.z, w: ps.q.w },
  v: { x: ps.v.x, y: ps.v.y, z: ps.v.z },
  w: { x: ps.w.x, y: ps.w.y, z: ps.w.z },
}));

function launch(who, shot) {
  const s = session;
  world.flick(who, shot.dx, shot.dz, shot.power, shot.style);
  playSound('flick', shot.power);
  scene.setTurn(false);
  s.phase = 'flight';
  s.flight = { shooter: who, ref: createReferee(who), t: 0, frames: [{ t: 0, poses: copyPoses(world.poses()) }] };
  const style = STYLES[shot.style].name.toLowerCase();
  setStatus(who === PLAYER ? `Anda menjentik ${style}!` : `AI menjentik ${style}!`, who);
}

/** Each frame: the physics catches up (in fixed steps), the referee judges each step. */
function onFrame(dt) {
  const s = session;
  if (!s || !world) return;
  if (!s.flight && !s.falling) return;
  const n = world.stepsFor(dt);
  const hits = [];
  let out = null;
  for (let k = 0; k < n && !out; k++) {
    world.stepOnce(hits);
    if (!s.flight) continue;
    out = s.flight.ref.update(world.poses(), physics.STEP);
    if (out?.kind === 'tip') { world.tip(out.who); out = null; } // stood on a side: it falls over
  }
  const poses = world.poses();
  scene.setPoses(poses);
  for (const hit of hits) {
    playSound('thud', hit.n);
    if (hit.slide > 1.6) playSound('squeak', hit.slide);
  }
  if (!s.flight) return;
  const f = s.flight;
  f.t += dt;
  f.frames.push({ t: f.t, poses: copyPoses(poses) });
  if (f.frames.length > 900) f.frames.splice(0, f.frames.length - 900);
  if (out) endFlight(s, out);
}

async function endFlight(s, out) {
  const f = s.flight;
  s.flight = null;
  s.phase = 'after';
  const m = s.match;
  const reset = applyOutcome(m, f.shooter, out);
  renderScore();
  if (out.kind === 'point') {
    const mine = out.scorer === PLAYER;
    playSound('point');
    appsWargaHaptic('notification', mine ? 'success' : 'warning');
    setStatus(mine ? `Mata untuk anda! (${m.score[PLAYER]}/${TARGET})` : `Mata untuk AI. (${m.score[AI]}/${TARGET})`, out.scorer);
    if (settings().replay && !reduceMotion()) {
      await later(500);
      if (session !== s) return;
      const end = f.frames[f.frames.length - 1];
      const from = f.frames.findIndex((fr) => fr.t >= end.t - REPLAY_S);
      const [a, b] = end.poses;
      await scene.replay(f.frames.slice(Math.max(0, from)), { x: (a.p.x + b.p.x) / 2, y: (a.p.y + b.p.y) / 2, z: (a.p.z + b.p.z) / 2 });
    } else await later(1100);
  } else if (out.kind === 'out') {
    playSound('out');
    setStatus(out.who === PLAYER ? 'Pemadam anda jatuh dari meja!' : 'Pemadam AI jatuh dari meja!', 1 - f.shooter);
    s.falling = true; // keep it falling a moment
    await later(1100);
    s.falling = false;
  } else {
    await later(250);
  }
  if (session !== s) return;
  if (reset) {
    world.reset();
    scene.setPoses(world.poses());
  }
  nextTurn();
}

// ---------- result ----------

function finish() {
  const s = session;
  const m = s.match;
  const win = m.winner === PLAYER;
  const points = roundPoints(m, s.level);
  const seconds = Math.min(86400, Math.max(1, Math.round((Date.now() - s.startedAt) / 1000)));
  lastResult = { score: m.score.slice(), win, points, seconds, level: s.level, submit: { status: 'pending' } };
  const t = stats();
  t.played++;
  if (win) t.won++;
  t.best = Math.max(t.best, points);
  storeSet(K.stats, t);
  playSound(win ? 'win' : 'lose');
  appsWargaHaptic('notification', win ? 'success' : 'warning');
  setStatus(win ? 'Anda menang!' : 'AI menang.', m.winner);
  submitResult(lastResult);
  session = null;
  timers.push(setTimeout(() => {
    if (document.body.dataset.screen === 'game' && !session) go('tamat', { replace: true });
  }, 1400));
}

function renderResult() {
  const r = lastResult;
  show('result');
  $('#res-title').textContent = r.win ? 'Anda Menang!' : 'AI Menang';
  $('#res-detail').textContent = `Anda ${r.score[PLAYER]} – ${r.score[AI]} AI`;
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
  $('#btn-game-help').addEventListener('click', help);
  $('#help-close').addEventListener('click', () => $('#dlg-help').close());
  $('#btn-hub').addEventListener('click', backToArked);
  $('#btn-close-app').addEventListener('click', closeMiniApp);
  $('#btn-version').addEventListener('click', () => { $('#btn-version').disabled = true; toast('Memuat semula…'); hardReload(); });

  for (const b of document.querySelectorAll('.pm-levels [data-level]')) b.addEventListener('click', () => saveSetting('level', b.dataset.level));
  $('#set-sound').addEventListener('click', () => { saveSetting('sound', !settings().sound); unlockSound(); playSound('thud', 4); });
  $('#set-replay').addEventListener('click', () => saveSetting('replay', !settings().replay));
  for (const b of document.querySelectorAll('#pm-style [data-style]')) b.addEventListener('click', () => saveSetting('style', b.dataset.style));

  $('#btn-play').addEventListener('click', () => go('main'));
  $('#btn-board').addEventListener('click', () => go('papan'));
  $('#btn-quit').addEventListener('click', () => go(''));
  for (const b of document.querySelectorAll('#osom-choices button')) b.addEventListener('click', () => chooseOsom(b.dataset.osom));
  // The osom can't be dismissed: it decides who starts. ‹ (or Back) leaves the round instead.
  $('#dlg-osom').addEventListener('cancel', (e) => { e.preventDefault(); go(''); });

  $('#res-home').addEventListener('click', () => go(''));
  $('#res-again').addEventListener('click', () => go('main', { replace: true }));
  $('#res-board').addEventListener('click', () => { boardTab = 'alltime'; go('papan'); });
  $('#btn-board-back').addEventListener('click', () => go(''));
  $('#btn-board-refresh').addEventListener('click', () => loadTab(boardTab));
  for (const b of document.querySelectorAll('.tabs [data-tab]')) b.addEventListener('click', () => setTab(b.dataset.tab));

  // Arrow keys turn the camera round the desk (← →) or tilt it (↑ ↓); 0 puts it back. K and L
  // pick a hard (Kuat) or soft (Lembut) flick.
  document.addEventListener('keydown', (e) => {
    if (document.body.dataset.screen !== 'game' || !scene || document.querySelector('dialog[open]')) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const turn = { ArrowLeft: [-0.15, 0], ArrowRight: [0.15, 0], ArrowUp: [0, 0.08], ArrowDown: [0, -0.08] }[e.key];
    if (turn) { e.preventDefault(); scene.turnView(...turn); }
    else if (e.key === '0' || e.key === 'Home') { e.preventDefault(); scene.resetView(); }
    else if (e.key === 'k' || e.key === 'K') saveSetting('style', 'kuat');
    else if (e.key === 'l' || e.key === 'L') saveSetting('style', 'lembut');
  });
  window.addEventListener('hashchange', route);
  if (!storeGet(K.seenHelp, false)) {
    storeSet(K.seenHelp, true);
    help();
  }
  route();
  requestAnimationFrame(() => notifyAppReady());
  setTimeout(() => loadModules().catch(() => {}), 800);
}

init();
