// 9-Ball: screens, touch and keyboard controls, turns (against the AI or a second player),
// results and the leaderboard. The rules and physics are in js/rules.js, the drawing in js/render.js.
import {
  TABLE_W, TABLE_H, PLAY_LEFT, PLAY_RIGHT, PLAY_TOP, PLAY_BOTTOM, BALL_R, TICKS_PER_SECOND, AI_LEVELS, MAX_TIP,
  rack, cueBall, lowestBall, newShot, strike, tick, moving, judge, foulText, spotBall, validPlacement,
  returnCueBall, planShot, placeCueForAI, roundPoints, acceptPush, FOULS_TO_LOSE,
} from './rules.js';
import { draw, drawCue, BALL_COLORS, resetSpin } from './render.js';
import { setMuted, unlockSound, play as playSound } from './sound.js';
import { initAppsWarga, appsWargaHaptic, closeMiniApp, notifyAppReady } from '../../shared/appswarga.js';
import { initFromArked, backToArked } from '../../shared/arked-link.js';
import { initProfile, loadProfile, withProfile } from '../../shared/profile.js';
import { gameKey, readShared, writeShared } from '../../shared/shared-store.js';
import { todayKL } from '../../shared/rng.js';
import * as lb from '../../shared/leaderboard.js';
import { hardReload } from '../../shared/reload.js';

const GAME_ID = '9balls';
const SCREENS = ['home', 'game', 'result', 'board'];
const K = { stats: '9balls.stats', settings: '9balls.settings', seenHelp: '9balls.seenHelp' };
const TICK_MS = 1000 / TICKS_PER_SECOND;
const MIN_POWER = 0.08; // a lighter pull is a cancelled shot
const AIM_SPEED = 0.00035; // radians a millisecond while a fine-aim button is held
const $ = (sel) => document.querySelector(sel);
const number = (n) => Number(n).toLocaleString('ms-MY');
const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

function storeGet(key, fallback) { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } }
function storeSet(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* unavailable */ } }
function h(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text != null) e.textContent = text;
  return e;
}

function settings() {
  // `extendedGuide` (off by default) replaces an older key, `guide`, which is ignored.
  const s = { mode: 'ai', level: 'sederhana', sound: true, extendedGuide: false, ...storeGet(K.settings, {}) };
  if (!AI_LEVELS[s.level]) s.level = 'sederhana';
  if (s.mode !== 'duo') s.mode = 'ai';
  return s;
}
const stats = () => ({ played: 0, won: 0, best: 0, ...storeGet(K.stats, {}) });

/**
 * The round: { balls, mode: 'ai'|'duo', level, current: 1|2, state, isBreak, aim, power, shot,
 * pots: {1, 2}, startedAt, aiShot }. state: 'toss' (the coin toss for the break) · 'aim' (a person aims) · 'placing' (ball in hand) ·
 * 'ai' (the AI thinks) · 'ai-cue' (the AI draws the cue back) · 'stroke' (the cue goes forward) ·
 * 'shooting' · 'push-choice' (after a push-out, the opponent chooses) · 'over'.
 */
let g = null;
let lastResult = null;
let boardTab = 'daily';
let boardRequest = 0;
let aiTimer = 0;
let toastTimer = 0;

const canvas = () => $('#pl-canvas');
const names = (round = g) => (round.mode === 'ai' ? ['Anda', 'AI'] : ['Pemain 1', 'Pemain 2']);
const other = (p) => (p === 1 ? 2 : 1);
const aiToPlay = () => g && g.mode === 'ai' && g.current === 2;
const personToPlay = () => g && !aiToPlay();

// ---------- routing (as in the other games: no game entry is left under home) ----------

function show(name) {
  for (const s of SCREENS) $(`#screen-${s}`).hidden = s !== name;
  document.body.dataset.screen = name;
  if (name === 'game') startLoop();
  else stopLoop();
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
    if (g && g.state !== 'over') return show('game');
    return withProfile(startGame);
  }
  endRound(); // leaving a round (‹ or the phone's Back) gives it up
  if (name === 'tamat' && lastResult) return renderResult();
  if (name === 'papan') return openBoard();
  renderHome();
}

// ---------- home ----------

function renderSettings() {
  const s = settings();
  setMuted(!s.sound);
  for (const b of document.querySelectorAll('[data-mode]')) b.setAttribute('aria-pressed', String(b.dataset.mode === s.mode));
  for (const b of document.querySelectorAll('[data-level]')) b.setAttribute('aria-pressed', String(b.dataset.level === s.level));
  $('#mode-hint').textContent = s.mode === 'ai' ? 'Markah direkodkan di papan markah' : 'Bergilir pada satu telefon · tidak direkodkan';
  $('#level-row').hidden = s.mode !== 'ai';
  $('#level-hint').textContent = `Bonus menang ${number(AI_LEVELS[s.level].bonus)} mata`;
  $('#set-guide').setAttribute('aria-checked', String(s.extendedGuide));
  $('#set-guide-hint').textContent = s.extendedGuide ? 'Tunjuk lantunan dan laluan bola sasaran' : 'Garisan terus ke bola pertama';
  $('#set-sound').setAttribute('aria-checked', String(s.sound));
  $('#set-sound-hint').textContent = s.sound ? 'Kesan bunyi' : 'Senyap';
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
  $('#st-won').textContent = number(s.won);
  $('#st-played').textContent = number(s.played);
}

// ---------- the round ----------

function startGame() {
  unlockSound();
  const { mode, level } = settings();
  resetSpin(); // a new rack: every number faces up again
  g = {
    balls: rack(), mode, level, current: 1, state: 'toss', isBreak: true, aim: -Math.PI / 2, power: 0,
    shot: null, pots: { 1: 0, 2: 0 }, startedAt: Date.now(), aiShot: null, spin: { x: 0, y: 0 },
    fouls: { 1: 0, 2: 0 }, // fouls in a row, per player
    pushAvailable: false, // the shot after the break may be a push-out
    pushOut: false, // and this one is (the player's toggle, or the AI's plan)
  };
  renderSpin();
  writeShared(gameKey(GAME_ID), { ...readShared(gameKey(GAME_ID)), lastPlayedAt: Date.now() });
  show('game');
  fitTable();
  setPower(0, { hide: true });
  showPlacing(false);
  aimAtTarget();
  hud();
  openCoin();
}

// ---------- coin toss: who breaks ----------
// Player 1 (you, against the AI) calls heads (Kepala) or tails (Ekor). A thumb flick sends the
// coin up on a real arc (fast, slowing at the top, falling back), flipping straight end over end
// at a steady rate timed to land on the result; it hits the table, bounces twice, then rattles
// flat, rocking faster as it settles. The light dims as a face turns away, a sheen sweeps across it, and
// its shadow shrinks as it rises. Call it right and player 1 breaks; otherwise the AI (or player 2).
const REST_TILT = 62; // the coin lying flat on the table, seen at an angle (degrees)

function coinPose(y, rot, wobble = 0, twist = 0) {
  const coin = $('#coin'), shadow = $('#coin-shadow');
  coin.style.transform = `translateY(${-y}px) rotateX(${REST_TILT + rot}deg) rotateY(${wobble}deg) rotateZ(${twist}deg)`;
  // Bright facing the light (from above), dark edge-on; the sheen slides smoothly up and down
  // with the angle (never jumping back, never sideways).
  const angle = ((REST_TILT - 30 + rot) * Math.PI) / 180;
  coin.style.setProperty('--lit', (0.55 + 0.5 * Math.abs(Math.cos(angle))).toFixed(3));
  coin.style.setProperty('--sheen', `${(50 + 45 * Math.sin(angle)).toFixed(1)}%`);
  const s = Math.max(0.35, 1 - y / 220);
  shadow.style.transform = `scale(${s.toFixed(3)})`;
  shadow.style.opacity = (0.25 + 0.75 * s).toFixed(3);
}

function openCoin() {
  const [n1] = names();
  $('#coin-sub').textContent = g.mode === 'ai' ? 'Pilih Kepala atau Ekor. Teka betul, anda pecah rak.' : `${n1}, pilih Kepala atau Ekor.`;
  $('#coin-result').replaceChildren();
  cancelAnimationFrame(coinRaf);
  coinPose(0, 0);
  for (const b of document.querySelectorAll('#coin-choices button')) b.disabled = false;
  $('#dlg-coin').showModal();
}

let coinRaf = 0;
/** Plays the toss, landing on `side`; calls `done` once it has settled. */
function tossCoin(side, done) {
  const FLIGHT = 1.25, PEAK = 112; // seconds in the air, pixels up (the stage leaves room for it)
  const turns = 6 * 360 + (side === 'ekor' ? 180 : 0); // whole flips, then the face up
  const bounces = [{ at: FLIGHT, len: 0.2, h: 15 }, { at: FLIGHT + 0.2, len: 0.13, h: 5 }];
  const settleStart = FLIGHT + 0.33, settle = 0.7;
  let clinked = 0, lastRattle = 0;
  const start = performance.now();
  playSound('flick');
  const step = (now) => {
    const t = (now - start) / 1000;
    if (t < FLIGHT) {
      // Up and down on a parabola, flipping straight end over end at a steady rate (no
      // sideways turn, so the face's emblem and label stay centred).
      const u = t / FLIGHT;
      coinPose(4 * PEAK * u * (1 - u), turns * u);
    } else if (t < settleStart) {
      // Two small bounces off the table, rocking a little.
      const b = t < bounces[1].at ? bounces[0] : bounces[1];
      const i = b === bounces[0] ? 0 : 1;
      if (clinked <= i) { clinked = i + 1; playSound('clink', i ? 0.45 : 1); appsWargaHaptic('impact', i ? 'light' : 'medium'); }
      const u = (t - b.at) / b.len;
      coinPose(4 * b.h * u * (1 - u), turns + Math.sin(u * Math.PI) * (i ? 6 : 14), 0, 0);
    } else if (t < settleStart + settle) {
      // Rattling flat: it rocks front to back, faster and faster as it dies away.
      const u = (t - settleStart) / settle;
      const amp = 9 * (1 - u) ** 1.6, phase = 2 * Math.PI * (3 * u + 6 * u * u);
      coinPose(0, turns + amp * Math.sin(phase));
      if (now - lastRattle > 90 * (1 - u) + 25) { lastRattle = now; playSound('rattle', 1 - u); }
    } else {
      coinPose(0, turns);
      return done();
    }
    coinRaf = requestAnimationFrame(step);
  };
  coinRaf = requestAnimationFrame(step);
}

function callCoin(call) {
  if (!g || g.state !== 'toss') return;
  unlockSound();
  appsWargaHaptic('selection');
  for (const b of document.querySelectorAll('#coin-choices button')) b.disabled = true;
  const side = crypto.getRandomValues(new Uint8Array(1))[0] & 1 ? 'kepala' : 'ekor';
  $('#coin-sub').textContent = `${call === 'kepala' ? 'Kepala' : 'Ekor'}… lambung!`;
  const round = g;
  const landed = () => {
    if (g !== round) return;
    const [n1, n2] = names();
    const first = call === side ? 1 : 2;
    const youBreak = g.mode === 'duo' || first === 1;
    $('#coin-sub').textContent = `${side === 'kepala' ? 'Kepala' : 'Ekor'}!`;
    $('#coin-result').replaceChildren(h('span', youBreak ? 'win' : 'lose', `${first === 1 ? n1 : n2} pecah rak dahulu!`));
    setTimeout(() => {
      if (g !== round) return;
      $('#dlg-coin').close();
      g.current = first;
      if (aiToPlay()) return aiTurn();
      g.state = 'aim';
      aimAtTarget();
      hud();
      toast(`${first === 1 ? n1 : n2}: pecahkan rak! Tekan dan tahan di meja, tarik ke bawah, lepas.`);
    }, 1400);
  };
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
    coinPose(0, side === 'ekor' ? 180 : 0);
    setTimeout(landed, 200);
  } else tossCoin(side, landed);
}

function endRound() {
  clearTimeout(aiTimer);
  cancelAnimationFrame(coinRaf);
  if ($('#dlg-coin').open) $('#dlg-coin').close();
  $('#pl-push-choice').hidden = true;
  $('#pl-push-box').hidden = true;
  closeSpin();
  aimHold = 0;
  g = null;
}

function aimAtTarget() {
  const cue = cueBall(g.balls), target = lowestBall(g.balls);
  if (cue && target) g.aim = Math.atan2(target.y - cue.y, target.x - cue.x);
}

/** The header, the players and the balls left (the next to hit enlarged). */
function hud() {
  if (!g) return;
  const [n1, n2] = names();
  if (g.mode === 'ai') {
    $('#game-score').textContent = `${number(g.pots[1] * 100)} mata`;
    $('#game-mode').textContent = AI_LEVELS[g.level].name;
  } else {
    $('#game-score').textContent = '2 Pemain';
    $('#game-mode').textContent = '9-Ball';
  }
  $('#pl-p1-name').textContent = n1;
  $('#pl-p2-name').textContent = n2;
  $('#pl-p1-pots').textContent = g.pots[1];
  $('#pl-p2-pots').textContent = g.pots[2];
  $('#pl-p1').classList.toggle('active', g.current === 1);
  $('#pl-p2').classList.toggle('active', g.current === 2);
  const target = lowestBall(g.balls);
  for (const b of g.balls) {
    if (!b.id) continue;
    const dot = $(`#pl-strip [data-ball="${b.id}"]`);
    dot.classList.toggle('gone', b.pocketed);
    dot.classList.toggle('next', target?.id === b.id);
  }
  const canAim = g.state === 'aim' && personToPlay();
  showPushToggle();
  for (const id of ['#pl-aim-left', '#pl-aim-right', '#pl-spin-btn']) $(id).disabled = !canAim;
  if (!canAim) closeSpin();
  // While the AI strikes, its spin button shows where its cue meets the ball.
  $('#pl-spin-btn').classList.toggle('showing', aiToPlay() && (g.state === 'ai-cue' || g.state === 'stroke'));
}

function toast(msg, kind = 'info') {
  const t = $('#pl-toast');
  t.textContent = msg;
  t.className = `pl-toast show ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}

/**
 * Sets the shot's power (0–1) and shows it on the floating gauge. `at` (a point in the table's
 * box, CSS pixels) moves the gauge there; with `hide` it goes away.
 */
function setPower(p, { at = null, hide = false } = {}) {
  const v = Math.max(0, Math.min(1, p));
  if (g) g.power = v;
  const gauge = $('#pl-gauge');
  if (hide) { gauge.hidden = true; return; }
  if (at) {
    // Beside the finger (or cursor), on whichever side has room, a little above it.
    const box = $('#pl-table').getBoundingClientRect();
    const left = at.x + 40 + 48 + 4 < box.width ? at.x + 40 : at.x - 40 - 48;
    gauge.style.left = `${Math.max(4, left)}px`;
    gauge.style.top = `${Math.max(4, Math.min(box.height - 176, at.y - 24))}px`;
    gauge.hidden = false;
  }
  const pct = Math.round(v * 100);
  const fill = $('#pl-gauge-fill');
  fill.style.clipPath = `inset(0 0 ${(100 - v * 100).toFixed(2)}% 0 round 6px)`;
  gauge.style.setProperty('--p', v.toFixed(3));
  $('#pl-gauge-pct').textContent = `${pct}%`;
  gauge.setAttribute('aria-valuenow', String(pct));
}

const CUE_REST = 18; // the cue tip's distance behind the cue ball's centre when not drawn back
const CUE_DRAW = 75; // how much further back at full power
const cueBack = (power) => CUE_REST + power * CUE_DRAW;

/** Lets the cue go: it thrusts forward (faster for a harder shot) and strikes the cue ball. */
function stroke(angle, power) {
  if (!g || power < MIN_POWER) return setPower(0, { hide: true });
  g.stroke = { angle, power, start: performance.now(), from: cueBack(power), ms: 120 - power * 60 };
  g.state = 'stroke';
  hud();
}

function shoot(angle, power) {
  if (!g || power < MIN_POWER) return setPower(0, { hide: true });
  g.shot = newShot(g.balls);
  g.shot.pushOut = g.pushAvailable && g.pushOut;
  g.pushAvailable = false;
  g.pushOut = false;
  showPushToggle();
  // The spin chosen (by the player, or the AI's plan); back to the centre after each shot.
  strike(g.balls, angle, power, g.spin);
  g.spin = { x: 0, y: 0 };
  renderSpin();
  closeSpin();
  g.state = 'shooting';
  accumulated = 0;
  playSound('cue', power);
  setPower(0, { hide: true });
  hud();
}

/** The balls have stopped: apply the rules, then hand over (or not). */
function afterShot() {
  const shot = g.shot, by = g.current;
  const v = judge(shot, g.isBreak);
  if (v.respotNine) spotBall(g.balls, g.balls.find((b) => b.id === 9));
  g.pots[by] += v.potted.length;
  const wasBreak = g.isBreak;
  g.isBreak = false;
  if (v.win) return finish(by, { golden: v.golden });
  const [n1, n2] = names();
  const name = (p) => (p === 1 ? n1 : n2);
  // Fouls in a row: a warning after two, the rack lost on the third. Any other shot resets it.
  g.fouls[by] = v.foul ? g.fouls[by] + 1 : 0;
  if (v.foul && g.fouls[by] >= FOULS_TO_LOSE) {
    playSound('foul');
    return finish(other(by), { reason: 'fouls', loser: by });
  }
  // The shot after the break may be a push-out.
  if (wasBreak) g.pushAvailable = true;
  if (v.push && !v.foul) return afterPush(by);
  if (v.foul) {
    playSound('foul');
    appsWargaHaptic('notification', 'warning');
    g.current = other(by);
    returnCueBall(g.balls);
    const warn = g.fouls[by] === FOULS_TO_LOSE - 1 ? ` Amaran: ${name(by)} sudah ${FOULS_TO_LOSE - 1} kali salah berturut-turut; sekali lagi kalah!` : '';
    toast(`Salah! ${foulText(shot, v.foul)} ${name(g.current)} dapat bola putih di tangan.${warn}`, 'foul');
    if (aiToPlay()) {
      placeCueForAI(g.balls, g.level);
      return aiTurn();
    }
    g.state = 'placing';
    showPlacing(true);
    return hud();
  }
  if (v.keepTurn) {
    appsWargaHaptic('impact', 'light');
    toast(`Bola ${v.potted.join(', ')} masuk. Teruskan!`, 'good');
  } else {
    g.current = other(by);
    toast(g.lastPlan === 'safety' && by === 2 && g.mode === 'ai' ? 'AI bermain selamat. Giliran anda.' : `Giliran ${name(g.current)}.`);
  }
  nextTurn();
}

/** After a push-out: the opponent plays from there, or hands the shot back. */
function afterPush(by) {
  const [n1, n2] = names();
  const chooser = other(by);
  if (g.mode === 'ai' && chooser === 2) {
    // The AI decides.
    const play = acceptPush(g.balls, g.level);
    g.current = play ? 2 : 1;
    toast(play ? 'Anda tolak keluar. AI main dari situ.' : 'Anda tolak keluar. AI pulangkan giliran: anda main lagi.');
    return nextTurn();
  }
  // A person decides (vs the AI, or the other player in 2-player mode).
  g.current = chooser;
  g.state = 'push-choice';
  $('#pl-push-who').textContent = `${by === 1 ? n1 : n2} tolak keluar. ${chooser === 1 ? n1 : n2}: main dari sini, atau pulangkan giliran?`;
  $('#pl-push-choice').hidden = false;
  hud();
}

function choosePush(play) {
  if (!g || g.state !== 'push-choice') return;
  $('#pl-push-choice').hidden = true;
  if (!play) g.current = other(g.current); // handed back: the pusher plays
  nextTurn();
}

/** The push-out toggle: only for a person, on the shot after the break, while aiming. */
function showPushToggle() {
  const show = Boolean(g && g.pushAvailable && g.state === 'aim' && personToPlay());
  $('#pl-push-box').hidden = !show;
  $('#pl-push').setAttribute('aria-pressed', String(Boolean(g?.pushOut)));
  $('#pl-push').textContent = g?.pushOut ? '✓ Tolak keluar' : 'Tolak keluar';
}

function nextTurn() {
  if (aiToPlay()) return aiTurn();
  g.state = 'aim';
  aimAtTarget();
  hud();
}

/** The AI thinks, draws the cue back while showing where it aims, then shoots. */
function aiTurn() {
  g.state = 'ai';
  hud();
  const round = g;
  aiTimer = setTimeout(() => {
    if (g !== round) return;
    const plan = planShot(g.balls, g.level, g.isBreak, Math.random, { pushAvailable: g.pushAvailable });
    g.lastPlan = plan.kind;
    g.pushOut = plan.kind === 'push';
    if (plan.kind === 'push') toast('AI tolak keluar.');
    g.aim = plan.angle;
    g.aiShot = { ...plan, start: performance.now() };
    g.spin = plan.spin ?? { x: 0, y: 0 }; // shown on the spin button while the AI strikes
    g.state = 'ai-cue';
    renderSpin();
    hud();
  }, 650);
}

function showPlacing(on) {
  $('#pl-bih').hidden = !on;
}

function confirmPlacing() {
  if (!g || g.state !== 'placing') return;
  const cue = cueBall(g.balls);
  if (!validPlacement(g.balls, cue.x, cue.y, g.isBreak)) return toast('Tempat itu tidak boleh: jangan bertindih dengan bola lain.', 'foul');
  showPlacing(false);
  g.state = 'aim';
  aimAtTarget();
  hud();
}

function finish(winner, { golden = false, reason = 'nine', loser = 0 } = {}) {
  g.state = 'over';
  const round = g;
  const [n1, n2] = names();
  const vsAI = g.mode === 'ai';
  const points = vsAI ? roundPoints(g.pots[1], winner === 1, g.level) : 0;
  const seconds = Math.min(86400, Math.max(1, Math.round((Date.now() - g.startedAt) / 1000)));
  lastResult = {
    mode: g.mode, level: g.level, winner, golden, reason, loser, points, pots: g.pots[1], seconds, names: [n1, n2],
    submit: { status: vsAI ? 'pending' : 'duo' },
  };
  if (vsAI) {
    const t = stats();
    t.played++;
    if (winner === 1) t.won++;
    t.best = Math.max(t.best, points);
    storeSet(K.stats, t);
    submitResult(lastResult);
  }
  const personWon = !vsAI || winner === 1;
  playSound(personWon ? 'win' : 'lose');
  appsWargaHaptic('notification', personWon ? 'success' : 'warning');
  toast(reason === 'fouls' ? `${loser === 1 ? n1 : n2} salah ${FOULS_TO_LOSE} kali berturut-turut. ${winner === 1 ? n1 : n2} menang.`
    : golden ? 'Golden break! Bola 9 masuk semasa pecah rak!' : `Bola 9 masuk! ${winner === 1 ? n1 : n2} menang.`, reason === 'fouls' ? 'foul' : 'good');
  hud();
  setTimeout(() => {
    if (g === round && document.body.dataset.screen === 'game') go('tamat', { replace: true });
  }, 1800);
}

// ---------- spin: where the cue strikes the cue ball ----------
// The small cue ball in the bottom row shows the strike point; it opens a panel with a big cue
// ball to drag it about, within the reach of a real cue (MAX_TIP of the radius). It goes back to
// the centre after each shot.
const SPIN_TEXT = (s) => {
  const parts = [];
  if (s.y > 0.15) parts.push(s.y > 0.6 ? 'Atas: bola putih ikut jauh ke depan' : 'Atas: bola putih ikut ke depan');
  else if (s.y < -0.15) parts.push(s.y < -0.6 ? 'Bawah: bola putih tarik balik jauh' : 'Bawah: bola putih tarik balik');
  if (s.x > 0.15) parts.push('Kanan: lantun ke kanan dari kusyen');
  else if (s.x < -0.15) parts.push('Kiri: lantun ke kiri dari kusyen');
  return parts.length ? parts.join(' · ') : 'Tengah: tiada putaran';
};

function renderSpin() {
  const s = g?.spin ?? { x: 0, y: 0 };
  for (const dot of [$('#pl-spin-mini-dot'), $('#pl-spin-dot')]) {
    dot.style.left = `${50 + s.x * 30}%`;
    dot.style.top = `${50 - s.y * 30}%`;
  }
  const text = SPIN_TEXT(s);
  $('#pl-spin-text').textContent = text;
  $('#pl-spin-btn').setAttribute('aria-label', `${aiToPlay() ? 'Kesan pukulan AI' : 'Kesan pukulan'}: ${text}`);
  $('#pl-spin-btn').classList.toggle('set', Math.hypot(s.x, s.y) > 0.15);
}

function openSpin() {
  if (!g || g.state !== 'aim' || !personToPlay()) return;
  $('#pl-spin-panel').hidden = false;
  $('#pl-spin-btn').setAttribute('aria-expanded', 'true');
}
function closeSpin() {
  $('#pl-spin-panel').hidden = true;
  $('#pl-spin-btn').setAttribute('aria-expanded', 'false');
}

function setupSpin() {
  $('#pl-spin-btn').addEventListener('click', () => ($('#pl-spin-panel').hidden ? openSpin() : closeSpin()));
  $('#pl-spin-done').addEventListener('click', closeSpin);
  $('#pl-spin-reset').addEventListener('click', () => { if (g) { g.spin = { x: 0, y: 0 }; renderSpin(); } });
  // Drag (or tap) on the big ball: the dot follows, kept within the reach circle.
  const ball = $('#pl-spin-ball');
  let dragging = null;
  const place = (e) => {
    const r = ball.getBoundingClientRect();
    let x = ((e.clientX - r.left) / r.width - 0.5) / 0.3, y = -((e.clientY - r.top) / r.height - 0.5) / 0.3;
    const d = Math.hypot(x, y);
    if (d > 1) { x /= d; y /= d; }
    g.spin = { x, y };
    renderSpin();
  };
  ball.addEventListener('pointerdown', (e) => {
    if (!g) return;
    dragging = e.pointerId;
    try { ball.setPointerCapture(e.pointerId); } catch { /* already gone */ }
    place(e);
    appsWargaHaptic('selection');
  });
  ball.addEventListener('pointermove', (e) => { if (dragging === e.pointerId && g) place(e); });
  for (const ev of ['pointerup', 'pointercancel']) ball.addEventListener(ev, () => { dragging = null; });
  // Keyboard on the ball: arrows move the dot.
  ball.addEventListener('keydown', (e) => {
    const step = { ArrowUp: [0, 0.2], ArrowDown: [0, -0.2], ArrowLeft: [-0.2, 0], ArrowRight: [0.2, 0] }[e.key];
    if (!step || !g) return;
    e.preventDefault();
    e.stopPropagation();
    let x = g.spin.x + step[0], y = g.spin.y + step[1];
    const d = Math.hypot(x, y);
    if (d > 1) { x /= d; y /= d; }
    g.spin = { x, y };
    renderSpin();
  });
}

// ---------- the loop: physics at a fixed 60 ticks a second, drawing every frame ----------

let raf = 0, last = 0, accumulated = 0, aimHold = 0;
let dpr = 1; // canvas pixels per table unit
let guideExtended = false; // the aiming guide shows bounces (setting)
function startLoop() {
  if (raf) return;
  last = 0;
  raf = requestAnimationFrame(frame);
}
function stopLoop() {
  cancelAnimationFrame(raf);
  raf = 0;
}
function frame(now) {
  raf = requestAnimationFrame(frame);
  if (!g) return;
  const dt = Math.min(250, last ? now - last : 0);
  last = now;
  if (g.state === 'shooting') {
    accumulated += dt;
    for (let n = 0; accumulated >= TICK_MS && n < 10; n++) {
      accumulated -= TICK_MS;
      for (const e of tick(g.balls, g.shot)) {
        if (e.type === 'pocket') playSound('pocket');
        else playSound(e.type, e.speed);
      }
      if (!moving(g.balls)) {
        accumulated = 0;
        afterShot();
        break;
      }
    }
  } else if (g.state === 'aim' && aimHold && personToPlay()) {
    g.aim += aimHold * AIM_SPEED * dt;
  } else if (g.state === 'stroke' && g.stroke) {
    // The cue thrusts forward to the ball, then the ball goes.
    const t = Math.min(1, (now - g.stroke.start) / g.stroke.ms);
    g.stroke.back = g.stroke.from + (BALL_R - 1 - g.stroke.from) * t * t;
    if (t >= 1) {
      const { angle, power } = g.stroke;
      g.stroke = null;
      shoot(angle, power);
    }
  } else if (g.state === 'ai-cue' && g.aiShot) {
    // The AI's cue draws back over 0.6 s, its power filling the gauge beside the cue ball as a
    // player's does, then strikes.
    const t = Math.min(1, (now - g.aiShot.start) / 600);
    setPower(g.aiShot.power * ease(t), { at: g.aiShot.gauge ? null : cueOnScreen() });
    g.aiShot.gauge = true;
    if (t >= 1) {
      const { angle, power } = g.aiShot;
      g.aiShot = null;
      stroke(angle, power);
    }
  }
  if (!g) return;
  const ctx = canvas().getContext('2d');
  draw(ctx, {
    balls: g.balls,
    aim: g.aim,
    // The aiming guide while a player aims, and while the AI draws back and strikes (it shows
    // where the AI's shot is going, the same way, extended or not).
    showGuide: (g.state === 'aim' && personToPlay()) || (aiToPlay() && (g.state === 'ai-cue' || g.state === 'stroke')),
    extended: guideExtended,
    scale: dpr,
    placing: g.state === 'placing',
    isBreak: g.isBreak,
    now,
  });
  drawCueLayer((g.state === 'aim' && personToPlay()) || g.state === 'ai-cue' || g.state === 'stroke');
}

/**
 * The cue, on its own canvas over the whole game screen (not clipped to the table), lined up
 * with the table: table units map to the table canvas's place on screen.
 */
let cueShown = false;
function drawCueLayer(show) {
  const layer = $('#pl-cue');
  if (!show && !cueShown) return;
  const ctx = layer.getContext('2d');
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, layer.width, layer.height);
  cueShown = show;
  if (!show) return;
  const t = canvas().getBoundingClientRect(), l = layer.getBoundingClientRect();
  const px = layer.width / Math.max(1, l.width); // layer pixels per CSS pixel
  const k = (t.width / TABLE_W) * px; // layer pixels per table unit
  ctx.setTransform(k, 0, 0, k, (t.left - l.left) * px, (t.top - l.top) * px);
  const side = g.spin.x * MAX_TIP * BALL_R; // striking right or left of centre
  drawCue(ctx, g.balls, g.aim, g.state === 'stroke' && g.stroke ? g.stroke.back ?? g.stroke.from : cueBack(g.power), side);
}

/** The cue layer's pixels match its size on screen. */
function sizeCueLayer() {
  const layer = $('#pl-cue'), r = layer.getBoundingClientRect();
  layer.width = Math.max(1, Math.round(r.width * dpr));
  layer.height = Math.max(1, Math.round(r.height * dpr));
  cueShown = true; // cleared and redrawn on the next frame
}

/** The table as big as fits, keeping its shape. */
function fitTable() {
  const stage = $('#pl-stage'), wrap = $('#pl-table');
  const r = stage.getBoundingClientRect();
  const maxW = Math.max(120, r.width), maxH = Math.max(200, r.height);
  const height = Math.min(maxH, maxW * (TABLE_H / TABLE_W));
  wrap.style.height = `${Math.floor(height)}px`;
  wrap.style.width = `${Math.floor(height * (TABLE_W / TABLE_H))}px`;
}

// ---------- controls ----------

/** The cue ball's place in the table's box (CSS pixels), for the keyboard's power gauge. */
function cueOnScreen() {
  const r = $('#pl-table').getBoundingClientRect(), cue = cueBall(g.balls);
  return { x: (cue.x / TABLE_W) * r.width, y: (cue.y / TABLE_H) * r.height };
}

function tablePoint(e) {
  const r = canvas().getBoundingClientRect();
  return { x: ((e.clientX - r.left) / r.width) * TABLE_W, y: ((e.clientY - r.top) / r.height) * TABLE_H };
}

function placeCueAt(e) {
  const p = tablePoint(e);
  const cue = cueBall(g.balls);
  // On a touch screen the ball sits a little above the finger, so the finger doesn't hide it.
  const lift = e.pointerType === 'touch' ? 38 : 0;
  cue.x = Math.max(PLAY_LEFT + BALL_R, Math.min(PLAY_RIGHT - BALL_R, p.x));
  cue.y = Math.max(PLAY_TOP + BALL_R, Math.min(PLAY_BOTTOM - BALL_R, p.y - lift));
}

function setupControls() {
  // On the table: a quick drag turns the aim, a quick tap aims at that spot, and pressing and
  // holding still brings up the power gauge beside the finger: pull down for power (the cue
  // draws back with it), let go to shoot, slide back up to 0% to cancel. With ball in hand,
  // dragging places the cue ball.
  const c = canvas();
  // A hold may wobble up to MOVE_PX and still count. Full power is a pull of PULL_PX, or less
  // when the press is low on the screen: there must be room to pull all the way before the
  // screen's bottom edge (where a phone's own swipe gestures start), or the gauge would stop
  // short and look stuck.
  const HOLD_MS = 300, MOVE_PX = 10, PULL_PX = 150, PULL_MIN = 60, EDGE = 28;
  let drag = null;
  const local = (e) => {
    const r = $('#pl-table').getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const angleTo = (e) => {
    const cue = cueBall(g.balls), p = tablePoint(e);
    return Math.atan2(p.y - cue.y, p.x - cue.x);
  };
  c.addEventListener('pointerdown', (e) => {
    if (!g || !personToPlay()) return;
    unlockSound();
    if (g.state === 'placing') {
      drag = { id: e.pointerId, kind: 'place' };
      placeCueAt(e);
    } else if (g.state === 'aim') {
      drag = { id: e.pointerId, kind: 'pending', x: e.clientX, y: e.clientY, angle: angleTo(e), at: local(e) };
      drag.timer = setTimeout(() => {
        if (drag?.kind !== 'pending' || g?.state !== 'aim') return;
        drag.kind = 'power';
        drag.y0 = drag.y;
        drag.pull = Math.max(PULL_MIN, Math.min(PULL_PX, window.innerHeight - EDGE - drag.y));
        appsWargaHaptic('impact', 'light');
        setPower(0, { at: drag.at });
        hud();
      }, HOLD_MS);
    } else return;
    try { c.setPointerCapture(e.pointerId); } catch { /* already gone */ }
  });
  c.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id || !g) return;
    if (drag.kind === 'place') return g.state === 'placing' && placeCueAt(e);
    if (g.state !== 'aim') return;
    if (drag.kind === 'pending') {
      if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < MOVE_PX) return;
      clearTimeout(drag.timer);
      drag.kind = 'aim'; // a drag: turn the aim from here on, relative to the finger's turn
    }
    if (drag.kind === 'aim') {
      const angle = angleTo(e);
      let d = angle - drag.angle;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      g.aim += d * 0.85; // a little slower than the finger, for precision
      drag.angle = angle;
    } else if (drag.kind === 'power') {
      setPower((e.clientY - drag.y0) / drag.pull);
    }
  });
  const endDrag = (e, cancelled = false) => {
    if (!drag || (e && e.pointerId !== drag.id)) return;
    const d = drag;
    drag = null;
    clearTimeout(d.timer);
    if (!g || g.state !== 'aim') return;
    if (d.kind === 'pending' && !cancelled) g.aim = d.angle; // a tap: aim at that spot
    if (d.kind === 'power') {
      if (!cancelled && g.power >= MIN_POWER) stroke(g.aim, g.power);
      else setPower(0, { hide: true });
      hud();
    }
  };
  c.addEventListener('pointerup', (e) => endDrag(e));
  c.addEventListener('pointercancel', (e) => endDrag(e, true));

  // Fine aim: hold to turn slowly.
  for (const [id, dir] of [['#pl-aim-left', -1], ['#pl-aim-right', 1]]) {
    const b = $(id);
    b.addEventListener('pointerdown', (e) => {
      if (!g || g.state !== 'aim' || !personToPlay()) return;
      g.aim += dir * 0.008;
      aimHold = dir;
      try { b.setPointerCapture(e.pointerId); } catch { /* already gone */ }
    });
    for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) b.addEventListener(ev, () => { aimHold = 0; });
  }

  // Keyboard: ← → aim (Shift for fine), ↓ ↑ power, Space or Enter to shoot.
  document.addEventListener('keydown', (e) => {
    if (document.body.dataset.screen !== 'game' || !g || document.querySelector('dialog[open]')) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (g.state === 'placing' && e.key === 'Enter') { e.preventDefault(); return confirmPlacing(); }
    if (g.state !== 'aim' || !personToPlay()) return;
    const step = e.shiftKey ? 0.003 : 0.02;
    if (e.key === 'ArrowLeft') g.aim -= step;
    else if (e.key === 'ArrowRight') g.aim += step;
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') setPower(g.power + (e.key === 'ArrowDown' ? 0.05 : -0.05), { at: cueOnScreen() });
    else if (e.key === ' ' || e.key === 'Enter') { unlockSound(); stroke(g.aim, g.power); }
    else return;
    e.preventDefault();
  });

  $('#pl-bih-ok').addEventListener('click', confirmPlacing);
  $('#pl-push').addEventListener('click', () => {
    if (!g?.pushAvailable) return;
    g.pushOut = !g.pushOut;
    showPushToggle();
    appsWargaHaptic('selection');
    if (g.pushOut) toast('Tolak keluar: bola putih boleh ke mana-mana; hanya bola putih masuk lubang dikira salah.');
  });
  $('#pl-push-play').addEventListener('click', () => choosePush(true));
  $('#pl-push-back').addEventListener('click', () => choosePush(false));
  setupSpin();
  new ResizeObserver(fitTable).observe($('#pl-stage'));
  new ResizeObserver(sizeCueLayer).observe($('#screen-game'));
}

// ---------- result ----------

function renderResult() {
  const r = lastResult;
  show('result');
  const vsAI = r.mode === 'ai';
  $('#res-title').textContent = vsAI ? (r.winner === 1 ? 'Anda Menang!' : 'AI Menang') : `${r.names[r.winner - 1]} Menang!`;
  $('#res-detail').textContent = r.reason === 'fouls' ? `${r.names[r.loser - 1]} salah ${FOULS_TO_LOSE} kali berturut-turut.`
    : r.golden ? 'Golden break: bola 9 masuk semasa pecah rak!' : 'Bola 9 dimasukkan dengan sah.';
  $('#res-level').textContent = vsAI ? `Tahap ${AI_LEVELS[r.level].name} · ${r.pots} bola masuk` : '2 Pemain';
  $('#res-score').hidden = !vsAI;
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
  box.textContent = st === 'duo' ? 'Mod 2 pemain tidak direkodkan di papan markah.'
    : st === 'offline' ? 'Papan markah belum dikonfigurasi. Markah disimpan dalam peranti ini sahaja.'
      : st === 'sending' || st === 'pending' ? 'Menghantar markah…'
        : st === 'done' ? 'Markah direkodkan.'
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
  if (r.sending || r.mode !== 'ai') return;
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
  // The canvas draws the table at a fixed size; CSS scales it to fit.
  dpr = Math.min(devicePixelRatio || 1, 2);
  const c = canvas();
  c.width = TABLE_W * dpr;
  c.height = TABLE_H * dpr;
  c.getContext('2d').setTransform(dpr, 0, 0, dpr, 0, 0);
  // The ball strip: one dot per ball, 1 to 9.
  $('#pl-strip').replaceChildren(...[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => {
    const d = h('span', `pl-dot-ball${n === 9 ? ' striped' : ''}`, String(n));
    d.dataset.ball = n;
    d.style.setProperty('--ball', BALL_COLORS[n]);
    return d;
  }));

  const help = () => $('#dlg-help').showModal();
  $('#btn-help').addEventListener('click', help);
  $('#btn-game-help').addEventListener('click', help);
  $('#help-close').addEventListener('click', () => $('#dlg-help').close());
  $('#btn-hub').addEventListener('click', backToArked);
  $('#btn-close-app').addEventListener('click', closeMiniApp);
  $('#btn-version').addEventListener('click', () => { $('#btn-version').disabled = true; hardReload(); });
  for (const b of document.querySelectorAll('[data-mode]')) b.addEventListener('click', () => saveSetting('mode', b.dataset.mode));
  for (const b of document.querySelectorAll('#coin-choices button')) b.addEventListener('click', () => callCoin(b.dataset.coin));
  // The toss can't be dismissed: it decides who breaks. ‹ (or Back) leaves the round instead.
  $('#dlg-coin').addEventListener('cancel', (e) => { e.preventDefault(); go(''); });
  for (const b of document.querySelectorAll('[data-level]')) b.addEventListener('click', () => saveSetting('level', b.dataset.level));
  $('#set-sound').addEventListener('click', () => { saveSetting('sound', !settings().sound); unlockSound(); playSound('ball', 10); });
  $('#set-guide').addEventListener('click', () => { saveSetting('extendedGuide', !settings().extendedGuide); guideExtended = settings().extendedGuide; });
  guideExtended = settings().extendedGuide;

  $('#btn-play').addEventListener('click', () => go('main'));
  $('#btn-board').addEventListener('click', () => go('papan'));
  $('#btn-quit').addEventListener('click', () => go(''));
  $('#res-home').addEventListener('click', () => go(''));
  $('#res-again').addEventListener('click', () => go('main', { replace: true }));
  $('#res-board').addEventListener('click', () => { boardTab = 'alltime'; go('papan'); });
  $('#btn-board-back').addEventListener('click', () => go(''));
  $('#btn-board-refresh').addEventListener('click', () => loadTab(boardTab));
  for (const b of document.querySelectorAll('.tabs [data-tab]')) b.addEventListener('click', () => setTab(b.dataset.tab));
  setupControls();

  window.addEventListener('hashchange', route);
  if (!storeGet(K.seenHelp, false)) {
    storeSet(K.seenHelp, true);
    help();
  }
  route();
  requestAnimationFrame(() => notifyAppReady());
}

init();
