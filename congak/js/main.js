// Congak Matematik: screens, Cabaran Harian and Main Bebas, the blackboard round (the sum written
// in chalk, the duster between questions, chalk snapping in Nyawa), results and the board.
import {
  LEVELS, MODES, DAILY, MAX_QUESTIONS, newRound, nextQuestion, answer, end, summary, dailySeed, multiplier,
} from './rules.js';
import { setMuted, unlockSound, play as playSound } from './sound.js';
import { initAppsWarga, appsWargaHaptic, closeMiniApp, notifyAppReady } from '../../shared/appswarga.js';
import { initFromArked, backToArked } from '../../shared/arked-link.js';
import { initProfile, loadProfile, withProfile } from '../../shared/profile.js';
import { gameKey, readShared, writeShared } from '../../shared/shared-store.js';
import { todayKL, randomSeed } from '../../shared/rng.js';
import * as lb from '../../shared/leaderboard.js';
import { hardReload } from '../../shared/reload.js';

const GAME_ID = 'congak';
const PROGRESS_KEY = gameKey(GAME_ID);
const SCREENS = ['home', 'game', 'result', 'board'];
const K = { stats: 'congak.stats', settings: 'congak.settings', daily: 'congak.daily', seenHelp: 'congak.seenHelp' };
// Timing (with rules.MIN_QUESTION_S = 0.9 s: the answers wait while the sum is written, then the
// feedback shows; that bounds the points a second for the board's limits).
const LOCK_MS = 400;
const RIGHT_MS = 500;
const WRONG_MS = 950;
const WIPE_MS = 380;
const PRAISE = ['Betul!', 'Tepat!', 'Hebat!', 'Bagus!', 'Cemerlang!'];
const KEYS = ['A', 'B', 'C', 'D'];
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

function settings() {
  const s = { level: 'mudah', mode: 'masa', sound: true, ...storeGet(K.settings, {}) };
  if (!LEVELS[s.level]) s.level = 'mudah';
  if (!MODES[s.mode]) s.mode = 'masa';
  return s;
}
const stats = () => ({ played: 0, best: 0, bestStreak: 0, ...storeGet(K.stats, {}) });
const todaysDaily = () => { const d = storeGet(K.daily, null); return d?.date === todayKL() ? d : null; };

/** session: { r, startedAt, endsAt, clock, locked, unlockedAt } — null when no round is open. */
let session = null;
let lastResult = null;
let boardTab = 'daily';
let boardRequest = 0;

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
  // The phone's Back during Cabaran Harian: stay on the board and ask first (one try a day).
  if (session?.r.daily && !session.r.over && !session.leaving) {
    history.pushState({ up: true }, '', '#/harian');
    return askLeaveDaily();
  }
  leaveRound(); // ‹ or the phone's Back during a round
  if (name === 'tamat' && lastResult) return renderResult();
  if (name === 'papan') return openBoard();
  renderHome();
}

// ---------- home ----------

function renderSettings() {
  const s = settings();
  setMuted(!s.sound);
  for (const b of document.querySelectorAll('[data-level]')) b.setAttribute('aria-pressed', String(b.dataset.level === s.level));
  for (const b of document.querySelectorAll('[data-mode]')) b.setAttribute('aria-pressed', String(b.dataset.mode === s.mode));
  $('#level-hint').textContent = LEVELS[s.level].hint;
  $('#mode-hint').textContent = s.mode === 'masa' ? 'Seberapa banyak dalam 60 saat' : `Tiga kali salah, tamat (hingga ${MAX_QUESTIONS} soalan)`;
  $('#set-sound').setAttribute('aria-checked', String(s.sound));
  $('#set-sound-hint').textContent = s.sound ? 'Kapur, jawapan dan pemadam' : 'Senyap';
}

function saveSetting(key, value) {
  storeSet(K.settings, { ...settings(), [key]: value });
  renderSettings();
  appsWargaHaptic('selection');
}

function renderHome() {
  show('home');
  renderSettings();
  $('#daily-date').textContent = new Intl.DateTimeFormat('ms-MY', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Asia/Kuala_Lumpur' }).format(new Date());
  const d = todaysDaily();
  if (d?.status === 'done') {
    $('#daily-status').textContent = `Selesai: ${number(d.result.points)} mata, ${d.result.accuracy}% tepat. Cabaran baharu esok!`;
    $('#btn-daily').textContent = 'Keputusan';
  } else {
    $('#daily-status').textContent = 'Soalan yang sama untuk semua pemain hari ini. 60 saat, satu cubaan.';
    $('#btn-daily').textContent = 'Main';
  }
  const t = stats();
  $('#st-best').textContent = number(t.best);
  $('#st-combo').textContent = number(t.bestStreak);
  $('#st-played').textContent = number(t.played);
}

/** Tells Arked Warga what was played (arked.game.congak): when, and today's Cabaran Harian. */
function recordProgress(daily) {
  const prev = readShared(PROGRESS_KEY);
  const keep = prev?.daily?.date === todayKL() ? prev.daily : null;
  writeShared(PROGRESS_KEY, { lastPlayedAt: Date.now(), daily: daily === undefined ? keep : daily });
}

// ---------- the round ----------

function startDaily() {
  const d = todaysDaily();
  if (d?.status === 'done') {
    lastResult = { ...d.result, submit: { status: 'saved' } };
    return go('tamat', { replace: true });
  }
  const date = todayKL();
  recordProgress({ date, status: 'playing' });
  startRound(newRound({ ...DAILY, seed: dailySeed(date), daily: true }));
  saveDailyProgress();
}

/**
 * Cabaran Harian is one try. While it plays, the result so far is kept on the phone, so a game
 * cut off by closing the app (or the page reloading) still counts: see settleClosedDaily.
 */
function saveDailyProgress() {
  const s = session;
  if (!s?.r.daily || s.r.over) return;
  storeSet(K.daily, { date: todayKL(), status: 'playing', result: resultOf(s.r, secondsSince(s.startedAt), 'closed') });
}

/**
 * Opening the game with today's Cabaran Harian still marked as playing means it was cut off
 * (the app closed, the page reloaded): it counts as today's try, with the score it had, and is
 * recorded; no second try.
 */
function settleClosedDaily() {
  const d = todaysDaily();
  if (d?.status !== 'playing' || session) return;
  const result = d.result ?? resultOf(newRound({ ...DAILY, seed: dailySeed(d.date), daily: true }), 1, 'closed');
  record(result, { bestStreak: result.bestStreak ?? 0 });
  toast('Cabaran Harian yang terhenti tadi telah direkodkan.');
}

function startFree() {
  const { level, mode } = settings();
  recordProgress();
  startRound(newRound({ level, mode, seed: randomSeed() }));
}

function startRound(r) {
  unlockSound();
  session = { r, startedAt: Date.now(), endsAt: 0, clock: 0, locked: true, unlockedAt: 0 };
  show('game');
  $('#game-mode').textContent = r.daily ? 'Cabaran Harian' : `${LEVELS[r.level].name} · ${MODES[r.mode].name}`;
  $('#ck-ghosts').replaceChildren();
  $('#ck-question').replaceChildren();
  $('#ck-answers').replaceChildren();
  hideFeedback();
  for (const stick of document.querySelectorAll('.ck-stick')) stick.classList.remove('snapped', 'snapping');
  if (r.mode === 'masa') {
    session.endsAt = performance.now() + MODES.masa.seconds * 1000;
    session.clock = setInterval(tickClock, 200);
  }
  renderHud();
  showQuestion(false);
}

/** Ends the round on the way out: Cabaran Harian counts as played (score so far); Main Bebas is given up. */
function leaveRound() {
  const s = session;
  if (!s) return;
  if (s.r.daily && !s.r.over) finish('quit', { navigate: false });
  stopRound();
}

/** ‹ during a round: Main Bebas just leaves; Cabaran Harian asks first. */
function quitRound() {
  if (session?.r.daily && !session.r.over) return askLeaveDaily();
  go('');
}

function askLeaveDaily() {
  const dlg = $('#dlg-leave');
  if (!dlg.open) dlg.showModal();
}

/** Leaving Cabaran Harian was confirmed: the try ends with the score so far. */
function confirmLeaveDaily() {
  $('#dlg-leave').close();
  if (!session) return;
  session.leaving = true;
  go('');
}

function stopRound() {
  if (session) clearInterval(session.clock);
  session = null;
}

function secondsLeft() {
  return session?.endsAt ? Math.max(0, (session.endsAt - performance.now()) / 1000) : 0;
}

function tickClock() {
  const s = session;
  if (!s) return;
  renderHud();
  const left = Math.ceil(secondsLeft());
  if (left !== s.lastSecond) {
    s.lastSecond = left;
    // The last five seconds tick (a little higher at the end), and 10 s left is announced.
    if (left > 0 && left <= 5) playSound('tick', left);
    if (left === 10) announce('10 saat lagi.');
  }
  if (secondsLeft() <= 0) finish('time');
}

function renderHud() {
  const r = session.r;
  $('#ck-score').textContent = number(r.score);
  $('#ck-streak').textContent = `Betul berturut: ${r.streak}`;
  const m = multiplier(r.streak);
  const combo = $('#ck-combo');
  const text = `Kombo ×${m}`;
  combo.hidden = m < 2;
  if (m >= 2 && combo.textContent !== text) {
    combo.textContent = text;
    combo.classList.remove('pop');
    void combo.offsetWidth;
    combo.classList.add('pop');
  }
  const status = $('#ck-status');
  if (r.mode === 'masa') {
    const left = Math.ceil(secondsLeft());
    $('#ck-status-label').textContent = 'Masa';
    status.textContent = `${left}s`;
    status.classList.toggle('low', left <= 10);
    status.classList.toggle('last', left > 0 && left <= 5);
  } else {
    $('#ck-status-label').textContent = 'Soalan';
    status.textContent = `${Math.min(r.index + 1, MAX_QUESTIONS)}/${MAX_QUESTIONS}`;
    status.classList.remove('low');
  }
}

/**
 * Adds text to the board one character after another, as a hand writes it. parts: [text, class]
 * pairs; `from`: the first character's place in the writing order (its delay).
 */
function writeText(el, parts, from = 0) {
  el.classList.toggle('writing', !reduceMotion());
  let k = from;
  for (const [text, cls] of parts) {
    for (const ch of text) {
      const span = h('span', `ck-ch${cls ? ` ${cls}` : ''}`, ch);
      span.style.setProperty('--d', `${(k++ * 0.045).toFixed(3)}s`);
      el.append(span);
    }
  }
}

const sumText = (q) => `${q.a} ${q.op} ${q.b} =`;
const SAY_OP = { '+': 'tambah', '−': 'tolak', '×': 'darab', '÷': 'bahagi' };

/** Says `text` to a screen reader (a hidden live region), without showing it. */
function announce(text) {
  const el = $('#ck-sr');
  el.textContent = '';
  requestAnimationFrame(() => { el.textContent = text; });
}

/**
 * Sizes the sum so its longest form (the answer filled in, e.g. "457 + 389 = 846") fits the
 * board's width: as big as the screen allows (5.2rem at most), smaller for long sums, so nothing
 * is cut off and the size doesn't change when the answer is chalked in.
 */
function fitQuestion(qEl, longest) {
  qEl.style.removeProperty('--qs');
  const room = qEl.parentElement.clientWidth * 0.94;
  // Measured in an invisible copy with no width limit (the sum itself may not be wider than the
  // board, so its own box can't tell how much it overflows), in the same characters as written.
  const probe = h('span', 'ck-question ck-measure');
  for (const ch of longest) probe.append(h('span', 'ck-ch', ch));
  qEl.parentElement.append(probe);
  let size = parseFloat(getComputedStyle(probe).fontSize);
  for (let k = 0; k < 4 && probe.getBoundingClientRect().width > room; k++) {
    size = Math.floor(size * (room / probe.getBoundingClientRect().width));
    probe.style.fontSize = `${size}px`;
  }
  probe.remove();
  if (probe.style.fontSize) qEl.style.setProperty('--qs', probe.style.fontSize);
}

/** The next sum: the old one wiped off (leaving a ghost), the new one written, then the choices. */
async function showQuestion(wipe) {
  const s = session;
  const r = s.r;
  s.locked = true;
  $('#ck-answers').classList.add('locked');
  const qEl = $('#ck-question');
  if (wipe) {
    const prev = r.answered[r.answered.length - 1];
    if (prev) addGhost(`${sumText(prev)} ${prev.answer}`);
    if (!reduceMotion()) {
      const wiper = $('#ck-wiper');
      wiper.style.setProperty('--w', `${$('#ck-board').clientWidth}px`);
      wiper.classList.remove('wiping');
      void wiper.offsetWidth;
      wiper.classList.add('wiping');
      qEl.classList.add('wiped');
      playSound('wipe');
      await wait(WIPE_MS);
      if (session !== s) return;
    }
  }
  hideFeedback();
  const q = nextQuestion(r);
  qEl.classList.remove('wiped');
  qEl.replaceChildren();
  const said = `${q.a} ${SAY_OP[q.op]} ${q.b} sama dengan berapa?`;
  qEl.setAttribute('aria-label', said);
  s.longest = `${sumText(q)} ${q.answer}`;
  fitQuestion(qEl, s.longest);
  writeText(qEl, [[`${sumText(q)} ?`]]);
  playSound('write', 6);
  renderHud();
  const box = $('#ck-answers');
  box.replaceChildren(...q.choices.map((value, i) => {
    const b = h('button', 'ck-answer');
    b.type = 'button';
    b.disabled = true;
    b.dataset.value = String(value);
    b.setAttribute('aria-label', `${KEYS[i]}: ${value}`);
    b.append(h('span', 'ck-key', KEYS[i]), h('span', 'ck-value', String(value)));
    b.addEventListener('click', () => choose(i));
    return b;
  }));
  await wait(reduceMotion() ? LOCK_MS : Math.max(LOCK_MS, qEl.children.length * 45 + 110));
  if (session !== s || r.over) return;
  for (const b of box.children) b.disabled = false;
  box.classList.remove('locked');
  // Once the choices can be picked: "Soalan 4: 7 darab 8 sama dengan berapa? A 56, B 63, …"
  announce(`Soalan ${r.index + 1}: ${said} ${q.choices.map((v, i) => `${KEYS[i]} ${v}`).join(', ')}.`);
  s.locked = false;
  s.unlockedAt = performance.now();
}

async function choose(i) {
  const s = session;
  if (!s || s.locked || s.r.over) return;
  const r = s.r;
  const q = r.question;
  const btn = $('#ck-answers').children[i];
  if (!q || !btn) return;
  s.locked = true;
  unlockSound();
  const seconds = (performance.now() - s.unlockedAt) / 1000;
  const res = answer(r, q.choices[i], seconds);
  saveDailyProgress();
  const box = $('#ck-answers');
  box.classList.add('locked');
  for (const b of box.children) b.disabled = true;
  // The answer chalked in where the ? was, in green.
  const qEl = $('#ck-question');
  qEl.lastChild?.remove();
  writeText(qEl, [[String(q.answer), 'ans']], 0);
  const at = burstPoint(btn);
  if (res.right) {
    btn.classList.add('right');
    playSound('right', r.streak);
    appsWargaHaptic('impact', 'light');
    dust(at.x, at.y, '#9ae6b4', 30);
    showFeedback(`${PRAISE[Math.floor(Math.random() * PRAISE.length)]} +${res.points}`, true);
  } else {
    btn.classList.add('wrong');
    btn.insertAdjacentHTML('beforeend', '<svg class="ck-strike" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><line x1="8" y1="12" x2="92" y2="88" stroke="currentColor" stroke-width="4" stroke-linecap="round"/><line x1="92" y1="12" x2="8" y2="88" stroke="currentColor" stroke-width="4" stroke-linecap="round"/></svg>');
    [...box.children].find((b) => Number(b.dataset.value) === q.answer)?.classList.add('right');
    playSound('wrong');
    appsWargaHaptic('notification', 'warning');
    dust(at.x, at.y, '#fc8181', 18);
    showFeedback(`Salah! Jawapannya ${q.answer}`, false);
    if (r.mode === 'nyawa') snapChalk(r.lives);
  }
  renderHud();
  await wait(res.right ? RIGHT_MS : WRONG_MS);
  if (session !== s) return;
  if (r.over) return finish(r.endReason);
  if (r.mode === 'masa' && secondsLeft() <= 0) return finish('time');
  showQuestion(true);
}

/** Snaps chalk stick `i` (0–2) on the ledge: it jumps, breaks in two and lies there. */
function snapChalk(i) {
  const stick = document.querySelectorAll('.ck-stick')[i];
  if (!stick) return;
  stick.classList.add('snapping', 'snapped');
  playSound('snap');
  setTimeout(() => stick.classList.remove('snapping'), 520);
}

function showFeedback(text, right) {
  const f = $('#ck-feedback');
  f.textContent = text;
  f.className = `ck-feedback show ${right ? 'right' : 'wrong'}`;
}
function hideFeedback() {
  $('#ck-feedback').className = 'ck-feedback';
}

/** A faint ghost of a wiped sum somewhere on the board (the last four stay). */
function addGhost(text) {
  const box = $('#ck-ghosts');
  const g = h('span', null, text);
  g.style.left = `${4 + Math.random() * 46}%`;
  g.style.top = `${14 + Math.random() * 50}%`;
  g.style.transform = `rotate(${(Math.random() * 10 - 5).toFixed(1)}deg)`;
  box.append(g);
  while (box.children.length > 4) box.firstChild.remove();
}

// ---------- chalk dust ----------

const particles = [];
let dustRaf = 0;
function burstPoint(el) {
  const board = $('#ck-board').getBoundingClientRect(), r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2 - board.left, y: r.top + r.height / 2 - board.top };
}
function dust(x, y, color, count) {
  if (reduceMotion()) return;
  const canvas = $('#ck-dust');
  const board = $('#ck-board');
  const dpr = Math.min(2, devicePixelRatio || 1);
  if (canvas.width !== Math.round(board.clientWidth * dpr)) {
    canvas.width = Math.round(board.clientWidth * dpr);
    canvas.height = Math.round(board.clientHeight * dpr);
  }
  for (let i = 0; i < count; i++) {
    const a = Math.random() * Math.PI * 2, v = 1.2 + Math.random() * 4.5;
    particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 1, size: 1.5 + Math.random() * 3.5, alpha: 0.9, decay: 0.02 + Math.random() * 0.025, color });
  }
  if (!dustRaf) dustRaf = requestAnimationFrame(drawDust);
}
function drawDust() {
  const canvas = $('#ck-dust');
  const c = canvas.getContext('2d');
  const dpr = canvas.width / Math.max(1, $('#ck-board').clientWidth);
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.clearRect(0, 0, canvas.width, canvas.height);
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.x += p.vx; p.y += p.vy; p.vy += 0.08; p.vx *= 0.96; p.alpha -= p.decay;
    if (p.alpha <= 0) { particles.splice(i, 1); continue; }
    c.globalAlpha = p.alpha;
    c.fillStyle = p.color;
    c.beginPath();
    c.arc(p.x, p.y, p.size, 0, Math.PI * 2);
    c.fill();
  }
  c.globalAlpha = 1;
  dustRaf = particles.length ? requestAnimationFrame(drawDust) : 0;
}

// ---------- the end of a round ----------

const REASON = {
  time: 'Masa tamat!',
  lives: 'Ketiga-tiga batang kapur sudah patah.',
  all: `Habis ${MAX_QUESTIONS} soalan. Hebat!`,
  quit: 'Anda keluar sebelum tamat.',
  closed: 'Permainan ditutup sebelum tamat. Cubaan hari ini dikira dengan markah setakat itu.',
};

const secondsSince = (t) => Math.min(86400, Math.max(1, Math.round((Date.now() - t) / 1000)));

/** What the result screen and the board need from a round. */
function resultOf(r, seconds, reason) {
  return { ...summary(r), points: r.score, seconds, level: r.level, mode: r.mode, daily: r.daily, reason };
}

/** Keeps a finished round: stats, today's Cabaran Harian, Arked Warga's progress, the board. */
function record(result, { bestStreak }) {
  lastResult = { ...result, submit: { status: 'pending' } };
  const t = stats();
  t.played++;
  t.best = Math.max(t.best, result.points);
  t.bestStreak = Math.max(t.bestStreak, bestStreak);
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
  const r = s.r;
  end(r, reason);
  clearInterval(s.clock);
  if ($('#dlg-leave').open) $('#dlg-leave').close();
  record(resultOf(r, secondsSince(s.startedAt), reason), { bestStreak: r.bestStreak });
  if (navigate) {
    playSound('end');
    appsWargaHaptic('notification', 'success');
  }
  stopRound();
  if (navigate) go('tamat', { replace: true });
}

function renderResult() {
  const r = lastResult;
  show('result');
  $('#res-title').textContent = r.daily ? 'Cabaran Harian' : r.reason === 'all' ? 'Hebat!' : 'Tamat!';
  $('#res-detail').textContent = REASON[r.reason] ?? '';
  $('#res-level').textContent = r.daily ? `${LEVELS[r.level].name} · 60 saat` : `${LEVELS[r.level].name} · ${MODES[r.mode].name}`;
  $('#res-score').textContent = number(r.points);
  $('#res-accuracy').textContent = `${r.accuracy}%`;
  $('#res-combo').textContent = number(r.bestStreak);
  $('#res-avg').textContent = r.total ? `${r.avgSeconds.toFixed(1)} s` : '–';
  // Accuracy by operation, as bars.
  $('#res-ops').replaceChildren(...r.byOp.map((o) => {
    const row = h('div', 'ck-op');
    row.setAttribute('aria-label', `${o.op}: ${o.right} betul daripada ${o.total}`);
    const bar = h('span', 'ck-op-bar');
    const fill = h('i', o.pct >= 80 ? '' : o.pct >= 50 ? 'mid' : 'low');
    fill.style.width = `${o.pct}%`;
    bar.append(fill);
    row.append(h('b', null, o.op), bar, h('span', null, `${o.right}/${o.total}`));
    return row;
  }));
  $('#res-tip').hidden = !r.tip;
  $('#res-tip').textContent = r.tip ?? '';
  // The wrong answers, to look over.
  const review = $('#res-review');
  review.hidden = !r.total;
  $('#res-review-title').textContent = r.missed.length ? `Semakan jawapan (${r.missed.length} salah)` : 'Semakan jawapan: tiada yang salah!';
  $('#res-review-list').replaceChildren(...r.missed.map((m) => {
    const li = h('li', null, `${m.a} ${m.op} ${m.b} = `);
    li.append(h('span', 'was', String(m.given)), h('span', 'is', String(m.answer)));
    return li;
  }));
  review.open = r.missed.length > 0 && r.missed.length <= 5;
  $('#res-time').textContent = `${r.right} betul daripada ${r.total} soalan · ${lb.formatDuration(r.seconds)}`;
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

  for (const b of document.querySelectorAll('[data-level]')) b.addEventListener('click', () => saveSetting('level', b.dataset.level));
  for (const b of document.querySelectorAll('[data-mode]')) b.addEventListener('click', () => saveSetting('mode', b.dataset.mode));
  $('#set-sound').addEventListener('click', () => { saveSetting('sound', !settings().sound); unlockSound(); playSound('tap'); });

  $('#btn-daily').addEventListener('click', () => go('harian'));
  $('#btn-free').addEventListener('click', () => go('bebas'));
  $('#btn-board').addEventListener('click', () => go('papan'));
  $('#btn-quit').addEventListener('click', quitRound);
  $('#leave-stay').addEventListener('click', () => $('#dlg-leave').close());
  $('#leave-go').addEventListener('click', confirmLeaveDaily);
  $('#res-home').addEventListener('click', () => go(''));
  $('#res-again').addEventListener('click', () => go('bebas', { replace: true }));
  $('#res-board').addEventListener('click', () => { boardTab = lastResult?.daily ? 'daily' : 'alltime'; go('papan'); });
  $('#btn-board-back').addEventListener('click', () => go(''));
  $('#btn-board-refresh').addEventListener('click', () => loadTab(boardTab));
  for (const b of document.querySelectorAll('.tabs [data-tab]')) b.addEventListener('click', () => setTab(b.dataset.tab));

  // 1–4 or A–D pick a choice.
  document.addEventListener('keydown', (e) => {
    if (document.body.dataset.screen !== 'game' || !session || document.querySelector('dialog[open]')) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const i = ['1', '2', '3', '4'].indexOf(e.key) >= 0 ? ['1', '2', '3', '4'].indexOf(e.key) : KEYS.indexOf(e.key.toUpperCase());
    if (i >= 0) { e.preventDefault(); choose(i); }
  });
  // Measure the sum again once the chalk font has loaded, and when the screen turns.
  const refit = () => { if (session?.longest && document.body.dataset.screen === 'game') fitQuestion($('#ck-question'), session.longest); };
  document.fonts?.ready.then(refit);
  window.addEventListener('resize', refit);
  window.addEventListener('hashchange', route);
  settleClosedDaily();
  if (!storeGet(K.seenHelp, false)) {
    storeSet(K.seenHelp, true);
    help();
  }
  route();
  requestAnimationFrame(() => notifyAppReady());
}

init();
