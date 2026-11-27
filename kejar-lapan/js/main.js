// Kejar Lapan: screens, the frame loop, the HUD, results and the leaderboard.
import { STEP, ROLES, BOOST, LANDMARKS } from './config.js';
import { createRun, step, nextCheckpoint, runSeconds } from './sim.js';
import { landmarkFor } from './course.js';
import { campusAt } from './campus.js';
import { formatDistance, formatTime, formatClock, formatPoints, formatDate } from './score.js';
import { initTouchButtons } from './touch-buttons.js';
import { initInput } from './input.js';
import { play, unlockAudio, setMuted, updateMusic, stopMusic } from './audio.js';
import { randomSeed } from '../../shared/rng.js';
import { initAppsWarga, appsWargaHaptic, closeMiniApp, notifyAppReady } from '../../shared/appswarga.js';
import { initFromArked, backToArked } from '../../shared/arked-link.js';
import { initProfile, loadProfile, withProfile } from '../../shared/profile.js';
import { gameKey, readShared, writeShared } from '../../shared/shared-store.js';
import * as lb from '../../shared/leaderboard.js';
import { hardReload } from '../../shared/reload.js';
import { runPlan, MODE_LABELS } from './modes.js';
import { createRecording, recordTick, validReplay, createGhost, stepGhost, betterRun, MAX_REPLAY_TICKS } from './replay.js';

import { SLOTS, COSMETICS, isUnlocked, equippedCosmetics, newlyUnlocked, milestoneValue, milestoneLabel, milestoneProgress, progressionAfterRun } from './cosmetics.js';

import { createRotationCode } from './rotation-code.js';

const GAME_ID = 'kejar-lapan';
const K = { settings: 'kl.settings', stats: 'kl.stats', seenHelp: 'kl.seenHelp', cosmetics: 'kl.cosmetics' };
const SCREENS = ['home', 'game', 'result', 'board'];
const OBSTACLE_NAME = { cone: 'kon', pothole: 'lubang jalan', monkey: 'monyet', barrier: 'palang', car: 'kereta', bus: 'bas kampus' };
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
      return true;
    } catch {
      /* storage unavailable */
      return false;
    }
  },
};

// Cheat access lasts only until this page is reloaded or closed. Legacy saved flags are ignored.
let cosmeticsCheat = false;
const rotationCode = createRotationCode();

const settings = () => {
  const saved = store.get(K.settings, {});
  return { sound: true, pad: true, ghost: true, role: null, ...saved, mode: saved?.mode === 'endless' ? 'endless' : 'daily' };
};
const saveSettings = (patch) => store.set(K.settings, { ...settings(), ...patch });
const stats = () => ({ played: 0, best: 0, bestDistance: 0, ...store.get(K.stats, {}) });

// Keep the latest daily replay independently for each role.
const replaySlot = (role) => `kl.replay.daily.${role}`;
function loadReplay(plan, role) {
  if (!plan.key) return null;
  const replay = store.get(replaySlot(role));
  return validReplay(replay, plan) ? replay : null;
}

/** The character: the one picked on the home screen, else the profile's user type. */
function currentRole() {
  const picked = settings().role;
  if (ROLES[picked]) return picked;
  const type = loadProfile()?.userType;
  return ROLES[type] ? type : 'pelajar';
}

/** game: { run, phase: 'ready' | 'running' | 'paused' | 'over', acc, last, queue } */
let game = null;
let view = null;
let viewFailed = false;
let preview = null;
let previewLoading = null;
let previewFailed = false;
let itemPreview = null;
let avatarShare = null;
let avatarShareKey = '';
let avatarShareTimer = 0;
let avatarShareSerial = 0;
const thumbnailCache = new Map();
let rafId = 0;
let lastResult = null;
let toastTimer = 0;
let hudToastTimer = 0;
let boardTab = 'daily';
const hudCache = {};
/** `?debug` only: a test player that drives the sim (see tests/bot.mjs), and window.__kl. */
const debug = new URLSearchParams(location.search).has('debug');
let debugBot = null;

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

/** Sets an element's text only when it changed (the HUD updates every frame). */
function setText(id, text) {
  if (hudCache[id] === text) return;
  hudCache[id] = text;
  document.getElementById(id).textContent = text;
}

function todayKL(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kuala_Lumpur', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

// ---------- routing ----------

function show(name) {
  for (const s of SCREENS) $(`#screen-${s}`).hidden = s !== name;
  document.body.dataset.screen = name;
  if (name !== 'home') rotationCode.reset();
  preview?.setActive(name === 'home' && !document.hidden);
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
  if (path !== 'lari') stopGame();
  switch (path) {
    case 'lari':
      if (!loadProfile()) renderHome(); // behind the profile dialog
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

function renderRole() {
  const role = currentRole();
  for (const b of document.querySelectorAll('.role-chip')) b.setAttribute('aria-checked', String(b.dataset.role === role));
  const r = ROLES[role];
  $('#role-mission').textContent = r.mission;
  $('#role-items').textContent = `${r.items.points} +25 · ${r.items.boost} untuk pecut · ${r.items.shield} untuk kebal`;
  renderMode();
  updatePreview();
}

function renderMode() {
  const role = currentRole();
  const plan = runPlan(settings().mode, role);
  for (const b of document.querySelectorAll('.mode-chip')) b.setAttribute('aria-pressed', String(b.dataset.mode === plan.mode));
  $('#mode-date').hidden = !plan.day;
  $('#mode-date').textContent = plan.day ? formatDate(plan.day) : '';
  const facts = h('div', 'mode-facts');
  facts.append(
    h('span', null, plan.key ? formatDistance(plan.finishAt) : 'Laluan rawak'),
    h('span', null, 'Sebelum 8:00'),
  );
  $('#mode-description').replaceChildren(
    h('small', 'mode-caption', plan.key ? 'Destinasi anda' : 'Cabaran anda'),
    h('strong', 'mode-destination', plan.destination?.short ?? 'Lari sejauh mungkin'),
    facts,
    h('p', 'mode-note', plan.mode === 'daily'
      ? 'Destinasi berbeza mengikut watak, bertukar setiap hari.'
      : plan.key ? 'Sampai tepat masa untuk menang.' : 'Elak halangan dan kumpul markah tertinggi.'),
  );
  const replay = loadReplay(plan, role);
  $('#mode-best').textContent = replay
    ? `Rekod laluan: ${replay.result.status === 'arrived' ? `Berjaya · ${formatTime(replay.result.t)}` : formatDistance(replay.result.distance)}`
    : plan.key ? 'Belum ada rekod laluan pada peranti ini.' : '';
  $('#set-ghost').disabled = !plan.key;
  $('#set-ghost').setAttribute('aria-checked', String(settings().ghost && !!plan.key));
  $('#set-ghost-hint').textContent = !plan.key ? 'Tersedia dalam Harian'
    : replay ? 'Ulang larian terbaik pada peranti ini' : 'Larian pertama akan disimpan sebagai bayang';
}

function renderSettings() {
  const s = settings();
  $('#set-sound').setAttribute('aria-checked', String(s.sound));
  $('#set-sound-hint').textContent = s.sound ? 'Muzik retro & kesan bunyi' : 'Senyap';
  $('#set-pad').setAttribute('aria-checked', String(s.pad));
  $('#set-pad-hint').textContent = s.pad ? 'Butang arah di skrin' : 'Leret sahaja';
  setMuted(!s.sound);
}

function renderHome() {
  show('home');
  renderRole();
  renderSettings();
  renderWardrobe();
  const st = stats();
  $('#st-distance').textContent = formatDistance(st.bestDistance);
  $('#st-best').textContent = formatPoints(st.best);
  $('#st-played').textContent = st.played;
}

// The wardrobe uses the same milestones for display and equipment validation.
function renderWardrobe() {
  const st = stats();
  const selected = equippedCosmetics(st, store.get(K.cosmetics), cosmeticsCheat);
  const totals = [
    ['Permainan', st.played ?? 0], ['Jarak', formatDistance(st.totalDistance ?? 0)],
    ['Minit bermain', Math.floor((st.totalSeconds ?? 0) / 60)], ['Mercu tanda', st.totalCheckpoints ?? 0],
    ['Tepat masa', st.arrivals ?? 0], ['Item dikutip', st.totalItems ?? 0],
  ];
  $('#wardrobe-progress').replaceChildren(...totals.map(([label, value]) => {
    const cell = h('div');
    cell.append(h('dt', null, label), h('dd', null, value));
    return cell;
  }));
  $('#wardrobe-count').textContent = `${COSMETICS.filter((item) => isUnlocked(st, item, cosmeticsCheat)).length}/${COSMETICS.length} dibuka`;
  const groups = Object.entries(SLOTS).map(([slot, title]) => {
    const group = h('fieldset', 'cosmetic-group');
    group.append(h('legend', null, title));
    const options = h('div', 'cosmetic-options');
    const addOption = (item) => {
      const unlocked = !item || isUnlocked(st, item, cosmeticsCheat);
      const chosen = (selected[slot]?.id ?? null) === (item?.id ?? null);
      const button = h('button', 'cosmetic-option');
      button.type = 'button';
      button.dataset.cosmeticSlot = slot;
      button.dataset.cosmeticId = item?.id ?? 'original';
      button.disabled = !unlocked;
      button.classList.toggle('is-locked', !unlocked);
      button.setAttribute('aria-pressed', String(chosen));
      if (item && unlocked) button.style.setProperty('--cosmetic-colour', `#${item.colour.toString(16).padStart(6, '0')}`);
      const thumbnail = h('img', 'cosmetic-thumbnail');
      thumbnail.alt = '';
      thumbnail.width = 192;
      thumbnail.height = 160;
      if (!item) thumbnail.src = 'original-cosmetic.svg';
      if (!unlocked) {
        thumbnail.src = 'locked-cosmetic.svg';
        button.setAttribute('aria-label', `Kosmetik terkunci. ${milestoneLabel(item)}`);
      }
      button.append(thumbnail);
      if (unlocked) button.append(h('strong', null, item?.name ?? 'Asal'));
      if (chosen) {
        const indicator = h('span', 'equipped-corner', '✓');
        indicator.setAttribute('aria-hidden', 'true');
        button.append(indicator);
        button.setAttribute('aria-label', `${item?.name ?? 'Asal'} · Dipakai`);
      }
      if (!unlocked) button.append(h('small', 'cosmetic-goal', milestoneLabel(item)));
      if (!unlocked) {
        const value = Math.min(item.target, milestoneValue(st, item));
        const progress = h('progress');
        progress.max = item.target;
        progress.value = value;
        progress.setAttribute('aria-label', `Kemajuan: ${value} / ${item.target}`);
        button.append(progress, h('small', null, milestoneProgress(st, item)));
      }
      button.addEventListener('click', () => {
        const saved = store.set(K.cosmetics, { ...Object.fromEntries(Object.entries(selected).map(([key, value]) => [key, value?.id ?? null])), [slot]: item?.id ?? null });
        renderWardrobe();
        $(`[data-cosmetic-slot="${slot}"][data-cosmetic-id="${item?.id ?? 'original'}"]`).focus({ preventScroll: true });
        toast(saved ? `${title}: ${item?.name ?? 'Asal'}` : 'Pilihan tidak dapat disimpan pada peranti ini.');
      });
      options.append(button);
    };
    addOption(null);
    COSMETICS.filter((item) => item.slot === slot).forEach(addOption);
    group.append(options);
    return group;
  });
  $('#wardrobe-items').replaceChildren(...groups);
  updatePreview();
}

async function updatePreview() {
  const active = document.body.dataset.screen === 'home' && !document.hidden;
  preview?.setActive(active);
  if (!active || previewFailed) return;
  if (!preview) {
    $('#preview-status').textContent = 'Memuatkan pratonton…';
    try {
      previewLoading ??= import('./preview.js').then(({ createPreview }) => {
        preview = createPreview($('#character-preview'));
        itemPreview = createPreview(document.createElement('canvas'), { thumbnail: true });
        new ResizeObserver(() => preview.resize()).observe($('#character-preview'));
      });
      await previewLoading;
    } catch (err) {
      console.error(err);
      previewFailed = true;
      $('#preview-status').textContent = 'Pratonton 3D tidak tersedia pada peranti ini.';
      return;
    }
  }
  const selected = equippedCosmetics(stats(), store.get(K.cosmetics), cosmeticsCheat);
  const label = `${ROLES[currentRole()].label} · ${Object.entries(SLOTS).map(([slot, title]) => selected[slot]?.name ?? `${title} asal`).join(' · ')}`;
  $('#preview-status').textContent = '';
  $('#character-preview').setAttribute('aria-label', label);
  const role = currentRole();
  for (const button of document.querySelectorAll('.cosmetic-option')) {
    if (button.disabled) continue;
    const item = COSMETICS.find((candidate) => candidate.id === button.dataset.cosmeticId);
    if (!item) continue; // Original equipment uses the shared pixel reset icon.
    const slot = button.dataset.cosmeticSlot;
    const key = `${role}:${slot}:${item?.id ?? 'original'}`;
    if (!thumbnailCache.has(key)) {
      // Only unlocked cards reveal isolated item geometry.
      thumbnailCache.set(key, itemPreview.snapshot(role, item ? { [slot]: item } : {}, slot));
    }
    button.querySelector('img').src = thumbnailCache.get(key);
  }
  preview.update(role, selected);
  preview.setActive(document.body.dataset.screen === 'home' && !document.hidden);
  prepareAvatarImage(role, selected);
}

function setShareBusy(button, busy) {
  button.disabled = busy;
  button.classList.toggle('share-loading', busy);
  button.setAttribute('aria-busy', String(busy));
}

function prepareAvatarImage(role, cosmetics) {
  const snapshot = { role, cosmetics, profile: { ...loadProfile() }, stats: stats() };
  const key = JSON.stringify(snapshot);
  if (key === avatarShareKey) return;
  avatarShareKey = key;
  const serial = ++avatarShareSerial;
  clearTimeout(avatarShareTimer);
  avatarShare = null;
  const button = $('#preview-share');
  setShareBusy(button, true);
  button.title = 'Menyediakan imej watak…';
  // Coalesce quick equipment changes and prepare the final image before the share gesture.
  avatarShareTimer = setTimeout(async () => {
    try {
      const { createAvatarImage, shareResultImage } = await import('./share-card.js');
      if (serial !== avatarShareSerial) return;
      const file = await createAvatarImage(snapshot);
      if (serial !== avatarShareSerial) return;
      avatarShare = { file, share: shareResultImage };
    } catch (err) {
      if (serial !== avatarShareSerial) return;
      console.error('Avatar image:', err);
      avatarShareKey = ''; // The button can retry without changing equipment.
    } finally {
      if (serial === avatarShareSerial) {
        setShareBusy(button, false);
        button.title = avatarShare ? 'Kongsi imej watak' : 'Cuba imej watak semula';
      }
    }
  }, 200);
}

async function shareAvatar() {
  let asset = avatarShare;
  const serial = avatarShareSerial;
  const button = $('#preview-share');
  setShareBusy(button, true);
  try {
    if (!asset) {
      button.title = 'Menyediakan imej watak…';
      const snapshot = { role: currentRole(), cosmetics: equippedCosmetics(stats(), store.get(K.cosmetics), cosmeticsCheat), profile: { ...loadProfile() }, stats: stats() };
      const { createAvatarImage, shareResultImage } = await import('./share-card.js');
      const file = await createAvatarImage(snapshot);
      if (serial !== avatarShareSerial) return;
      asset = { file, share: shareResultImage };
      avatarShare = asset;
      avatarShareKey = JSON.stringify(snapshot);
    }
    button.title = 'Membuka perkongsian…';
    const outcome = await asset.share(asset.file);
    if (outcome === 'downloaded') toast('Imej watak dimuat turun.');
  } catch { toast('Imej watak tidak dapat dikongsi. Cuba semula.'); }
  finally {
    if (serial === avatarShareSerial) {
      setShareBusy(button, false);
      button.title = 'Kongsi imej watak';
    }
  }
}

// ---------- the run ----------

async function ensureView() {
  if (view || viewFailed) return view;
  try {
    // Banner text uses Lexend: wait for it (briefly) so signs aren't drawn in a fallback font.
    await Promise.race([document.fonts?.load("800 40px 'Lexend'"), new Promise((r) => setTimeout(r, 1500))]);
    const { createView } = await import('./render.js');
    view = createView($('#view'), { reducedMotion: () => reducedMotion.matches });
    const resizeView = () => {
      view.resize();
      // Resizing clears the WebGL canvas; paused/ready runs have no frame loop to repaint it.
      if (game && game.phase !== 'running') view.draw(game.run, performance.now(), 0, false, game.ghost?.run);
    };
    new ResizeObserver(resizeView).observe($('#stage'));
    resizeView();
  } catch (err) {
    console.error(err);
    viewFailed = true;
  }
  return view;
}

async function startGame() {
  stopGame();
  show('game');
  const s = settings();
  $('#screen-game').classList.toggle('no-pad', !s.pad);
  $('#screen-game').classList.remove('over');
  setMuted(!s.sound);
  if (!(await ensureView())) {
    toast('Peranti ini tidak menyokong grafik 3D (WebGL).');
    return go('', true);
  }
  if (document.body.dataset.screen !== 'game') return; // left while loading
  const role = currentRole();
  const plan = runPlan(s.mode, role);
  const run = createRun({ seed: plan.seed ?? randomSeed(), role, finishAt: plan.finishAt });
  const previous = loadReplay(plan, role);
  game = { run, plan, previous, cosmetics: equippedCosmetics(stats(), store.get(K.cosmetics), cosmeticsCheat), profile: { ...loadProfile() }, recording: plan.key ? createRecording(run, plan) : null,
    ghost: s.ghost && previous ? createGhost(previous, plan) : null,
    phase: 'ready', acc: 0, last: 0, queue: [], stepT: 0 };
  view.reset(game.cosmetics);
  for (const k of Object.keys(hudCache)) delete hudCache[k];
  $('#hud-mission').textContent = `${MODE_LABELS[plan.mode]} · Kejar 8:00`;
  $('#hud-goal').hidden = !plan.key;
  hideHudToast();
  renderHud();
  overlay('Sedia?', (plan.key ? `Sampai ke ${plan.destination.short} sebelum 8:00.` : ROLES[role].mission + '.') +
    (game.ghost ? ' Lawan bayang rekod anda!' : '') + ' Leret atau tekan butang untuk mula.', 'Mula', begin);
  view.draw(game.run, performance.now(), 0, false, game.ghost?.run);
  // Tell Arked Warga this game was played (its continue card).
  writeShared(gameKey(GAME_ID), { ...readShared(gameKey(GAME_ID)), lastPlayedAt: Date.now(), daily: null });
}

function begin() {
  if (!game || game.phase === 'running' || game.phase === 'over') return;
  unlockAudio();
  game.phase = 'running';
  updateMusic(campusAt(game.run.distance).id, game.run.t, { boosted: game.run.boostT > 0, shielded: game.run.shield });
  game.last = 0;
  overlay(null);
  cancelAnimationFrame(rafId);
  rafId = requestAnimationFrame(frame);
}

function pause() {
  if (game?.phase !== 'running') return;
  game.phase = 'paused';
  stopMusic();
  game.queue.length = 0;
  cancelAnimationFrame(rafId);
  overlay('Rehat', 'Jam kampus berhenti seketika.', 'Sambung', begin);
}

function stopGame() {
  stopMusic();
  cancelAnimationFrame(rafId);
  game = null;
  overlay(null);
}

function overlay(title, text, button, onClick) {
  const box = $('#overlay');
  box.hidden = !title;
  if (!title) return;
  $('#overlay-title').textContent = title;
  $('#overlay-text').textContent = text;
  const btn = $('#overlay-btn');
  btn.textContent = button;
  btn.onclick = onClick;
}

/** Fixed-step loop: the sim moves in 1/60 s steps whatever the frame rate; drawing follows. */
function frame(now) {
  if (!game || game.phase !== 'running') return;
  const g = game;
  const dt = g.last ? Math.min((now - g.last) / 1000, 0.25) : STEP;
  g.last = now;
  g.acc += dt;
  const events = [];
  while (g.acc >= STEP && g.run.status === 'running') {
    let actions = g.queue.splice(0);
    if (debugBot) actions.push(...debugBot(g.run));
    actions = actions.slice(0, 32);
    if (g.recording) recordTick(g.recording, actions);
    events.push(...step(g.run, actions));
    stepGhost(g.ghost);
    g.acc -= STEP;
  }
  handleEvents(events, dt);
  view.onEvents(g.run, events);
  view.draw(g.run, now, dt, true, g.ghost?.run);
  updateMusic(campusAt(g.run.distance).id, g.run.t, { boosted: g.run.boostT > 0, shielded: g.run.shield });
  renderHud();
  if (g.run.status !== 'running') return finish();
  rafId = requestAnimationFrame(frame);
}

function handleEvents(events, dt) {
  const run = game.run;
  for (const e of events) {
    switch (e.type) {
      case 'jump':
      case 'slide':
      case 'lane':
        play(e.type);
        break;
      case 'pickup': {
        const kind = e.item.kind;
        play(kind === 'points' ? 'points' : 'powerup');
        appsWargaHaptic('impact', 'light');
        const name = ROLES[run.role].items[kind];
        if (kind === 'boost') hudToast(name, 'PECUT!');
        else if (kind === 'shield') hudToast(name, 'KEBAL');
        else if (kind === 'time') hudToast('+5 saat', name);
        break;
      }
      case 'smash':
        play('smash');
        appsWargaHaptic('impact', 'medium');
        break;
      case 'shieldBreak':
        play('shieldBreak');
        appsWargaHaptic('impact', 'heavy');
        break;
      case 'checkpoint':
        play('checkpoint');
        appsWargaHaptic('notification', 'success');
        hudToast(`+${e.add} saat`, e.landmark.name);
        break;
      case 'crash':
        game.crashType = e.obstacle.type;
        play('crash');
        appsWargaHaptic('notification', 'error');
        break;
      case 'late':
        play('late');
        appsWargaHaptic('notification', 'warning');
        break;
      case 'arrived':
        play('checkpoint');
        appsWargaHaptic('notification', 'success');
        hudToast('Sampai tepat masa!', game.plan.destination.short);
        break;
    }
  }
  // Footsteps while running on the ground.
  if (!run.airborne && run.status === 'running') {
    game.stepT += dt * (run.speed / 12);
    if (game.stepT >= 0.55) {
      game.stepT = 0;
      play('step');
    }
  }
}

function hudToast(big, small) {
  const t = $('#hud-toast');
  t.replaceChildren(big, ...(small ? [h('small', null, small)] : []));
  t.classList.add('show');
  clearTimeout(hudToastTimer);
  hudToastTimer = setTimeout(hideHudToast, 1500);
}

function hideHudToast() {
  $('#hud-toast').classList.remove('show');
}

function renderHud() {
  const run = game.run;
  setText('hud-score', formatPoints(run.score));
  setText('hud-dist', formatDistance(run.distance));
  setText('hud-clock', formatClock(run.timeLeft));
  const level = run.timeLeft > 15 ? '' : run.timeLeft > 7 ? 'warn' : 'danger';
  if (hudCache.level !== level) {
    hudCache.level = level;
    $('#hud-clock-box').className = `hud-panel hud-clock ${level}`;
  }
  setText('hud-status', level === '' ? 'Masih sempat!' : level === 'warn' ? 'Pecut!' : 'Saat akhir!');
  const next = nextCheckpoint(run);
  setText('hud-next', `${next.landmark.short} · ${formatDistance(next.metres)} lagi`);
  if (game.plan.key) {
    setText('hud-goal-label', `${game.plan.destination.short} · ${formatDistance(Math.max(0, run.finishAt - run.distance))} lagi`);
    $('#goal-progress').value = Math.min(1, run.distance / run.finishAt);
  }
  const ghost = game.ghost?.run;
  const gap = ghost ? Math.round(run.distance - ghost.distance) : 0;
  setText('hud-ghost', ghost
    ? ghost.status !== 'running' ? `Bayang ${ghost.status === 'arrived' ? 'sudah sampai' : 'tamat'} · ${formatDistance(ghost.distance)}`
      : Math.abs(gap) < 1 ? 'Bayang rekod · Seiring' : `Bayang rekod · Anda ${gap > 0 ? 'di hadapan' : 'di belakang'} ${Math.abs(gap)} m`
    : '');
  if (hudCache.shield !== run.shield) {
    hudCache.shield = run.shield;
    $('#hud-shield').hidden = !run.shield;
  }
  const boosting = run.boostT > 0;
  if (hudCache.boost !== boosting) {
    hudCache.boost = boosting;
    $('#hud-boost').hidden = !boosting;
  }
  if (boosting) $('#hud-boost-fill').style.transform = `scaleX(${run.boostT / BOOST.time})`;
}

function finish() {
  stopMusic();
  const g = game;
  g.phase = 'over';
  const run = g.run;
  $('#screen-game').classList.add('over');
  const crash = run.status === 'crashed';
  const before = stats();
  const newBestDistance = run.distance > before.bestDistance && run.distance >= 50;
  const st = progressionAfterRun(before, run);
  const progressSaved = store.set(K.stats, st);
  const rewards = newlyUnlocked(before, st, cosmeticsCheat);
  let replayMessage = '';
  if (g.recording && run.t <= MAX_REPLAY_TICKS / 60 && !debugBot) {
    if (betterRun(run, g.previous?.result)) {
      g.recording.result = { status: run.status, distance: run.distance, score: run.score, t: run.t };
      const saved = store.set(replaySlot(run.role), g.recording);
      replayMessage = saved ? 'Rekod laluan baharu! Bayang disimpan untuk cubaan seterusnya.' : 'Bayang tidak dapat disimpan pada peranti ini.';
    } else replayMessage = 'Bayang rekod terbaik anda dikekalkan. Cuba lagi!';
  }
  lastResult = {
    reason: run.status === 'arrived' ? 'arrived' : crash ? 'crash' : 'late',
    plan: g.plan,
    timeLeft: run.timeLeft,
    replayMessage,
    cosmeticMessage: rewards.length ? `Kosmetik dibuka: ${rewards.map((item) => item.name).join(', ')}. Pakai di Almari Gaya.` + (progressSaved ? '' : ' Kemajuan tidak dapat disimpan.') : '',
    obstacle: crash ? g.crashType : null,
    role: run.role,
    cosmetics: g.cosmetics,
    profile: g.profile,
    distance: Math.floor(run.distance),
    score: run.score,
    seconds: runSeconds(run),
    checkpoints: run.checkpoints,
    landmarks: Array.from({ length: run.checkpoints }, (_, k) => landmarkFor(k).short),
    newBestDistance,
    submit: { status: run.score > 0 ? 'pending' : 'skipped' },
  };
  if (lastResult.submit.status === 'pending') submitResult(lastResult);
  // Give successful arrivals a visible pause at the finish before showing results.
  // Count from the first final-scene frame; loading stalls and background time don't skip it.
  const holdMs = 1100;
  let shownMs = 0;
  g.last = 0;
  const tick = (now) => {
    if (game !== g) return;
    if (document.hidden) {
      g.last = 0;
      rafId = requestAnimationFrame(tick);
      return;
    }
    const elapsed = g.last ? Math.min(Math.max(0, now - g.last), 100) : 0;
    g.last = now;
    view.draw(run, now, elapsed / 1000, false, g.ghost?.run);
    shownMs += elapsed;
    if (shownMs < holdMs) rafId = requestAnimationFrame(tick);
    else go('tamat', true);
  };
  rafId = requestAnimationFrame(tick);
}

// ---------- result ----------

function renderResult() {
  const r = lastResult;
  show('result');
  const role = ROLES[r.role];
  $('#res-mode').textContent = `${MODE_LABELS[r.plan.mode]}${r.plan.day ? ` · ${formatDate(r.plan.day)}` : ''}`;
  $('#res-replay').textContent = r.replayMessage;
  $('#res-cosmetics').textContent = r.cosmeticMessage;
  if (r.reason === 'arrived') {
    $('#res-badge').textContent = '🏁';
    $('#res-title').textContent = 'Sampai Tepat Masa!';
    $('#res-sub').textContent = `Berjaya ke ${r.plan.destination.short} pada ${formatClock(r.timeLeft)}.`;
  } else if (r.reason === 'crash') {
    $('#res-badge').textContent = '💥';
    $('#res-title').textContent = 'Terlanggar!';
    $('#res-sub').textContent = `Terlanggar ${OBSTACLE_NAME[r.obstacle] ?? 'halangan'}. ${role.late}`;
  } else {
    $('#res-badge').textContent = '⏰';
    $('#res-title').textContent = 'Dah Pukul 8:00!';
    $('#res-sub').textContent = role.late;
  }
  $('#res-distance').textContent = formatDistance(r.distance);
  $('#res-record').hidden = !r.newBestDistance;
  $('#res-cps').textContent = String(r.checkpoints);
  $('#res-time').textContent = formatTime(r.seconds);
  $('#res-score').textContent = formatPoints(r.score);
  const names = [LANDMARKS[0].short, ...r.landmarks];
  $('#res-landmarks').replaceChildren(...[...new Set(names)].map((n) => h('span', null, n)));
  prepareResultImage(r);
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
      return msg('Lari lebih jauh untuk direkodkan.');
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
    r.submit = { status: 'error', msg: err.code === '54000' ? 'Terlalu cepat. Tunggu sebentar.' : err.message };
  }
  renderSubmit();
}

async function prepareResultImage(r) {
  const button = $('#res-share');
  if (r.shareFile) {
    setShareBusy(button, false);
    button.textContent = 'Kongsi';
    return true;
  }
  if (r.sharePreparing) return r.sharePreparing;
  setShareBusy(button, true);
  button.textContent = 'Menyediakan…';
  r.sharePreparing = (async () => {
    try {
      const { createResultImage, shareResultImage } = await import('./share-card.js');
      r.shareFile = await createResultImage(r);
      r.shareImage = shareResultImage;
      return true;
    } catch (err) {
      console.error('Result image:', err);
      return false;
    } finally {
      r.sharePreparing = null;
      if (lastResult === r && document.body.dataset.screen === 'result') {
        setShareBusy(button, false);
        button.textContent = r.shareFile ? 'Kongsi' : 'Cuba imej semula';
      }
    }
  })();
  return r.sharePreparing;
}

async function shareResult() {
  const r = lastResult;
  if (!r) return;
  if (!r.shareFile) {
    const ready = await prepareResultImage(r);
    if (!ready) { toast('Imej tidak dapat disediakan. Cuba semula.'); return; }
  }
  const button = $('#res-share');
  setShareBusy(button, true);
  button.textContent = 'Membuka…';
  try {
    // File is already prepared: call the native share API within this button gesture.
    const outcome = await r.shareImage(r.shareFile);
    if (outcome === 'downloaded') toast('Imej keputusan dimuat turun.');
  } catch {
    toast('Imej tidak dapat dikongsi. Cuba semula.');
  } finally {
    if (lastResult === r) {
      setShareBusy(button, false);
      button.textContent = 'Kongsi';
    }
  }
}

// ---------- leaderboard ----------

function openBoard() {
  show('board');
  setTab('daily'); // always opens on Hari Ini (no tab is remembered)
}

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
  $('#board-sub').textContent =
    tab === 'daily' ? 'Jumlah markah hari ini' : tab === 'alltime' ? 'Jumlah markah & masa bermain' : 'Jumlah markah semua pemain kampus';
  if (!lb.boardsConfigured()) return boardMessage('Papan markah belum dikonfigurasi.');
  $('#lb-body').replaceChildren(h('div', 'lb-loading', 'Memuatkan…'));
  const profile = loadProfile();
  try {
    const rows =
      tab === 'campus'
        ? await lb.topCampuses(GAME_ID)
        : await lb.topPlayers(GAME_ID, profile?.playerId, tab === 'daily' ? todayKL() : null);
    if (boardTab !== tab) return;
    if (!rows?.length) {
      return boardMessage(tab === 'daily' ? 'Belum ada markah hari ini. Jadilah yang pertama!' : 'Belum ada markah.');
    }
    $('#lb-body').replaceChildren(
      tab === 'campus' ? lb.campusList(rows, profile?.campus) : lb.playersList(rows, { showPlays: tab === 'daily' }),
    );
  } catch (err) {
    if (boardTab === tab) boardMessage(`Gagal memuatkan: ${err.message}`, () => loadTab(tab));
  }
}

// ---------- wiring ----------

// Ghost slots from the retired single-daily and Tepat Masa layouts can never load again.
function dropLegacyReplays() {
  try {
    for (const key of ['kl.replay.daily', ...Object.keys(ROLES).map(role => `kl.replay.destination.${role}`)]) {
      localStorage.removeItem(key);
    }
  } catch { /* storage unavailable */ }
}

function init() {
  dropLegacyReplays();
  initTouchButtons();
  initFromArked();
  initAppsWarga();
  initProfile({ changed: () => document.body.dataset.screen === 'home' && renderRole() });

  const homeTabs = [...document.querySelectorAll('[data-home-tab]')];
  function selectHomeTab(tab, focus = false) {
    for (const button of homeTabs) {
      const selected = button.dataset.homeTab === tab;
      button.setAttribute('aria-selected', String(selected));
      button.tabIndex = selected ? 0 : -1;
      document.getElementById(button.getAttribute('aria-controls')).hidden = !selected;
      if (selected && focus) button.focus();
    }
    if (tab === 'wardrobe') renderWardrobe();
  }
  homeTabs.forEach((button, index) => {
    button.addEventListener('click', () => selectHomeTab(button.dataset.homeTab));
    button.addEventListener('keydown', (event) => {
      const next = event.key === 'ArrowRight' ? (index + 1) % homeTabs.length
        : event.key === 'ArrowLeft' ? (index + homeTabs.length - 1) % homeTabs.length
        : event.key === 'Home' ? 0 : event.key === 'End' ? homeTabs.length - 1 : null;
      if (next === null) return;
      event.preventDefault();
      selectHomeTab(homeTabs[next].dataset.homeTab, true);
    });
  });
  $('#preview-share').addEventListener('click', shareAvatar);
  const rotateAvatar = (direction) => {
    if (!preview || document.body.dataset.screen !== 'home') return;
    preview.rotate(direction);
    if (!cosmeticsCheat && rotationCode.press(direction, performance.now())) {
      cosmeticsCheat = true;
      renderWardrobe();
      toast('Kod rahsia! Semua kosmetik dibuka untuk sesi ini sahaja.');
      appsWargaHaptic('notification', 'success');
    }
  };
  $('#preview-left').addEventListener('click', () => rotateAvatar(-1));
  $('#preview-right').addEventListener('click', () => rotateAvatar(1));

  $('#btn-help').addEventListener('click', () => $('#dlg-help').showModal());
  $('#help-close').addEventListener('click', () => $('#dlg-help').close());
  $('#btn-close-app').addEventListener('click', closeMiniApp);
  $('#btn-hub').addEventListener('click', backToArked);
  $('#btn-version').addEventListener('click', () => {
    $('#btn-version').disabled = true;
    toast('Memuat semula…');
    hardReload();
  });
  for (const b of document.querySelectorAll('.role-chip')) {
    b.addEventListener('click', () => {
      saveSettings({ role: b.dataset.role });
      renderRole();
      appsWargaHaptic('selection');
    });
  }
  for (const b of document.querySelectorAll('.mode-chip')) {
    b.addEventListener('click', () => {
      saveSettings({ mode: b.dataset.mode });
      renderMode();
      appsWargaHaptic('selection');
    });
  }
  $('#set-ghost').addEventListener('click', () => {
    saveSettings({ ghost: !settings().ghost });
    renderMode();
    appsWargaHaptic('selection');
  });
  // Refresh the daily label/record after midnight or returning from the background.
  setInterval(() => document.body.dataset.screen === 'home' && renderMode(), 30000);
  $('#set-sound').addEventListener('click', () => {
    saveSettings({ sound: !settings().sound });
    renderSettings();
    appsWargaHaptic('selection');
  });
  $('#set-pad').addEventListener('click', () => {
    saveSettings({ pad: !settings().pad });
    renderSettings();
    appsWargaHaptic('selection');
  });
  $('#btn-play').addEventListener('click', () => {
    unlockAudio();
    go('lari');
  });
  $('#btn-board').addEventListener('click', () => go('papan'));

  $('#btn-pause').addEventListener('click', () => (game?.phase === 'running' ? pause() : begin()));
  $('#overlay-quit').addEventListener('click', () => go(''));
  initInput({
    area: $('#screen-game'),
    buttons: document.querySelectorAll('.pad-btn'),
    active: () => game && (game.phase === 'running' || game.phase === 'ready'),
    onAction: (action) => {
      if (game.phase === 'ready') begin();
      game.queue.push(action);
    },
    onPauseKey: () => (game?.phase === 'running' ? pause() : game?.phase === 'paused' ? begin() : null),
  });

  $('#res-again').addEventListener('click', () => go('lari', true));
  $('#res-share').addEventListener('click', shareResult);
  $('#res-board').addEventListener('click', () => go('papan'));
  $('#res-home').addEventListener('click', () => go(''));

  $('#btn-board-back').addEventListener('click', () => go(''));
  $('#btn-board-refresh').addEventListener('click', () => loadTab(boardTab));
  for (const b of document.querySelectorAll('.tabs [data-tab]')) b.addEventListener('click', () => setTab(b.dataset.tab));

  // Pause when the player looks away: the page is hidden, or AppsWarga goes to the background.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      pause();
      if (game?.phase === 'over') game.last = 0;
      rotationCode.reset();
    }
    updatePreview();
  });
  window.addEventListener('appswargaDeactivated', pause);
  window.addEventListener('blur', pause);

  window.addEventListener('hashchange', route);
  if (!store.get(K.seenHelp)) {
    store.set(K.seenHelp, true);
    $('#dlg-help').showModal();
  }
  route();
  requestAnimationFrame(() => notifyAppReady());
}

init();

if (debug) {
  window.__kl = {
    game: () => game,
    view: () => view,
    setBot: (fn) => (debugBot = fn),
  };
}
