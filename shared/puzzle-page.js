import { Game2048, BlockGame, MemoryGame, moveBoard } from './puzzle-engines.js';
import { initAppsWarga, appsWargaHaptic, closeMiniApp, notifyAppReady } from './appswarga.js';
import { initFromArked, backToArked } from './arked-link.js';
import { initProfile, loadProfile, withProfile } from './profile.js';
import { gameKey, readShared, writeShared } from './shared-store.js';
import { todayKL } from './rng.js';
import * as lb from './leaderboard.js';
import { createBoard } from './board.js';
import { hardReload } from './reload.js';
import { MEMORY_ICONS } from './memory-icons.js';
import { playPuzzle, setPuzzleMuted, unlockPuzzleSound } from './puzzle-sound.js';

const $ = (selector) => document.querySelector(selector);
// Each page declares its game, so /2048/ and /2048/index.html both work.
const gameId = document.documentElement.dataset.game;
const games = {
  '2048': { name: '2048', help: [
    'Leret papan, tekan butang arah atau kekunci anak panah untuk menggerakkan semua nombor.',
    'Dua nombor yang sama bertembung bergabung menjadi satu (2 + 2 = 4). Nilai gabungan ditambah ke markah.',
    'Setiap gerakan menambah satu nombor baharu (2 atau 4) di petak kosong.',
    'Capai 2048 untuk menang, kemudian terus bermain atau tekan ‹ untuk simpan markah.',
    'Permainan tamat apabila papan penuh dan tiada gerakan lagi. Butang arah boleh disembunyikan di laman utama.',
  ], create: seed => new Game2048(seed) },
  'blok': { name: 'Susun Blok', help: [
    'Seret kepingan dari bawah ke papan 8×8. Atau pilih kepingan, kemudian ketik petak: petak itu menjadi sudut kiri atas kepingan.',
    'Bayang hijau menunjukkan tempat kepingan akan diletakkan, merah jika tidak muat. Garisan yang akan dikosongkan bergaris emas.',
    'Kepingan tidak boleh diputar. Setiap petak yang diletakkan memberi 1 mata.',
    'Penuhkan baris atau lajur untuk mengosongkannya: 10 mata setiap garisan, +10 bagi setiap garisan tambahan yang dikosongkan serentak.',
    'Kombo: kosongkan garisan pada peletakan berturut-turut untuk bonus +5 setiap kali, hingga +50.',
    'Tiga kepingan baharu diberi selepas ketiga-tiganya digunakan. Kepingan pudar tidak muat di mana-mana.',
    'Permainan tamat apabila tiada kepingan yang muat. Tekan ‹ untuk tamat awal dan simpan markah.',
  ], create: seed => new BlockGame(seed) },
  'memori': { name: 'Memori', help: [
    'Buka dua kad untuk mencari pasangan. Selesaikan semua pasangan untuk naik tahap.',
    'Tiada tahap akhir: permainan berterusan sehingga masa tamat.',
    'Setiap tahap menambah satu pasangan, hingga tahap 9 (12 pasangan, 24 kad).',
    'Selepas tahap 9, bilangan kad kekal tetapi masa berkurang 2 saat setiap 4 tahap, hingga sekurang-kurangnya 25 saat.',
  ], create: seed => new MemoryGame(seed) },
};
const config = games[gameId];
if (!config) throw new Error(`Unknown game: ${gameId}`);
const board = createBoard({ game: gameId }); // Papan Markah (shared/board.js)

let game = null, playedMs = 0, lastTick = 0, lastResult = null;
let selectedPiece = 0, settleTimer = 0, timer = 0;
// 2048 tiles by cell, and the slide in progress (its finishing step runs early if another move comes).
let tileEls = new Map(), slide = null;
// A Susun Blok line clear in progress, like `slide`.
let clearing = null, overTimer = 0;
const CLEAR_STEP_MS = 28, CLEAR_MS = 7 * CLEAR_STEP_MS + 320;
const SLIDE_MS = 110;
const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const statsKey = `${gameId}.stats`;
const settingsKey = `${gameId}.settings`;
const progressKey = gameKey(gameId);
const screens = ['home', 'game', 'result', 'board'];
let memoryDeck = null, memoryCards = [], holdUntil = 0;
const number = value => Number(value).toLocaleString('ms-MY');

function storeGet(key, fallback) { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } }
function storeSet(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* unavailable */ } }
function h(tag, className, content) { const node = document.createElement(tag); if (className) node.className = className; if (content !== undefined) node.textContent = content; return node; }
function show(name) { for (const screen of screens) $(`#screen-${screen}`).hidden = screen !== name; document.body.dataset.screen = name; }
// History follows the screens: a screen above home (game, result, board) is pushed, so the phone's
// Back returns home; going home steps back instead of pushing, so no gameplay entry is left under
// home. Going back to Arked then never passes through the game screen (no glimpse of it).
function go(name, { replace = false } = {}) {
  const hash = `#/${name}`;
  if (!name) {
    if (history.state?.up) return history.back(); // the hashchange then routes home
    if (location.hash !== hash) history.replaceState({ ...(history.state ?? {}), up: false }, '', hash);
    return route();
  }
  if (location.hash === hash) return route();
  if (replace) history.replaceState({ ...(history.state ?? {}), up: true }, '', hash);
  else history.pushState({ up: true }, '', hash);
  route();
}
function stats() { return storeGet(statsKey, { played: 0, best: 0 }); }
function renderHome() { show('home'); renderSettings(); const s = stats(); $('#st-best').textContent = number(s.best); $('#st-played').textContent = s.played; }
function route() {
  const name = location.hash.replace(/^#\/?/, '');
  if (name === 'main') {
    if (game && !game.over) return show('game');
    // Back from the result lands on #/main with a finished round: go home, not to a dead board.
    if (game?.over) { game = null; history.replaceState({ ...(history.state ?? {}), up: false }, '', '#/'); return renderHome(); }
    return withProfile(startGame);
  }
  if (overTimer) { clearTimeout(overTimer); overTimer = 0; return finish('full'); }
  if (document.body.dataset.screen === 'game' && game && !game.over) {
    stopClock();
    // Leaving a live round (quit button or browser Back) ends it, so earned points are recorded.
    if (game.score > 0) return finish('manual');
  }
  if (name === 'tamat' && lastResult) return renderResult();
  if (name === 'papan') return openBoard();
  game = null; renderHome();
}
function activeClock() { return document.body.dataset.screen === 'game' && !document.hidden && game && !game.over && performance.now() >= holdUntil && !(gameId === '2048' && game.won && !game.continued); }
function stopClock() { if (lastTick) { playedMs += Math.max(0, performance.now() - lastTick); lastTick = 0; } }
function updateClock() {
  if (!activeClock()) { stopClock(); return; }
  const now = performance.now();
  if (lastTick) { const delta = Math.max(0, now - lastTick); playedMs += delta; if (gameId === 'memori') { const before = Math.ceil(game.timeLeft / 1000); game.timeLeft = Math.max(0, game.timeLeft - delta); if (game.timeLeft === 0) { playPuzzle('over'); finish('timeout'); return; } const left = Math.ceil(game.timeLeft / 1000); if (left < before && left <= 5) playPuzzle('tick'); } }
  lastTick = now;
  renderTimer();
}
const clock = seconds => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
// Memori counts down its level limit; the other games show time played this round.
function renderTimer() {
  if (!game) return;
  const running = lastTick ? Math.max(0, performance.now() - lastTick) : 0;
  $('#timer').textContent = gameId === 'memori' ? clock(Math.ceil(game.timeLeft / 1000)) : clock(Math.floor((playedMs + running) / 1000));
}
function settings() { return { pad: true, sound: true, ...storeGet(settingsKey, {}) }; }
function renderSettings() {
  const { pad, sound } = settings();
  setPuzzleMuted(!sound);
  if ($('#set-pad')) {
    $('#set-pad').setAttribute('aria-checked', String(pad));
    $('#set-pad-hint').textContent = pad ? 'Butang arah di skrin' : 'Leret sahaja';
  }
  if ($('#set-sound')) {
    $('#set-sound').setAttribute('aria-checked', String(sound));
    $('#set-sound-hint').textContent = sound ? 'Kesan bunyi' : 'Senyap';
  }
}
function toggleSetting(key) { storeSet(settingsKey, { ...settings(), [key]: !settings()[key] }); renderSettings(); appsWargaHaptic('selection'); if (key === 'sound') { unlockPuzzleSound(); playPuzzle('pick'); } }
function startGame() {
  holdUntil = 0; clearTimeout(overTimer); overTimer = 0;
  slide && (clearTimeout(slide.timer), slide = null);
  clearing && (clearTimeout(clearing.timer), clearing = null);
  clearTimeout(settleTimer); stopClock();
  const seed = crypto.getRandomValues(new Uint32Array(1))[0];
  game = config.create(seed); playedMs = 0; lastTick = performance.now(); selectedPiece = 0;
  const previous = readShared(progressKey);
  writeShared(progressKey, { ...previous, lastPlayedAt: Date.now() });
  show('game'); renderGame();
}
function renderGame(fx = {}) {
  if (!game) return;
  // As in Ular: the score is the title, the game (and its progress) the subtitle.
  $('#game-score').textContent = `${number(game.score)} mata`;
  // Memori shows its level and Susun Blok its lines cleared; 2048 names the game.
  $('#game-mode').textContent = gameId === 'memori' ? `Tahap ${game.level}` : gameId === 'blok' ? `${number(game.lines)} garisan` : config.name;
  renderTimer();
  const controls = $('#game-controls'), grid = $('#game-grid');
  // Memori keeps its cards between renders so they can flip; it deals a new set per level itself.
  controls.replaceChildren(); if (gameId !== 'memori') grid.replaceChildren();
  grid.className = 'puzzle-grid';
  // With the D-pad, lay out like Ular: the board centred in the free space, the D-pad at the bottom.
  $('#screen-game').classList.toggle('with-dpad', gameId === '2048' && settings().pad);
  if (gameId === '2048') render2048(grid, controls, fx);
  if (gameId === 'blok') renderBlock(grid, controls, fx);
  if (gameId === 'memori') renderMemory(grid);
}
// Empty slots form the board; numbered tiles sit on a layer above them so they can slide.
// `fx.merged` cells pop and `fx.spawned` grows in, after the slide that led here.
function render2048(grid, controls, fx = {}) {
  grid.classList.add('four'); grid.setAttribute('aria-label', 'Papan 2048');
  game.board.forEach((value, i) => { const slot = h('div', 'puzzle-cell slot'); slot.setAttribute('role', 'img'); slot.setAttribute('aria-label', `Baris ${Math.floor(i / 4) + 1}, lajur ${i % 4 + 1}: ${value || 'kosong'}`); grid.append(slot); });
  const layer = h('div', 'tile-layer'); layer.setAttribute('aria-hidden', 'true');
  tileEls = new Map();
  game.board.forEach((value, i) => {
    if (!value) return;
    const tile = h('div', 'puzzle-cell tile', String(value));
    tile.dataset.value = value; tile.dataset.digits = String(value).length;
    placeTile(tile, i);
    if (fx.merged?.includes(i)) tile.classList.add('merged');
    if (fx.spawned === i) tile.classList.add('spawned');
    layer.append(tile); tileEls.set(i, tile);
  });
  grid.append(layer);
  // The same D-pad as Ular: flat-3D keys laid out like a keyboard's arrow keys.
  if (settings().pad) {
    const pad = h('div', 'dpad'); pad.setAttribute('aria-label', 'Arah');
    for (const [dir, label, path] of [['up', 'Atas', 'M5 15l7-7 7 7'], ['left', 'Kiri', 'M15 5l-7 7 7 7'], ['down', 'Bawah', 'M5 9l7 7 7-7'], ['right', 'Kanan', 'M9 5l7 7-7 7']]) {
      const b = h('button', `dpad-btn ${dir}`); b.type = 'button'; b.setAttribute('aria-label', label);
      b.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${path}" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
      b.addEventListener('click', () => move2048(dir)); pad.append(b);
    }
    controls.append(pad);
  }
  $('#game-status').textContent = game.won && !game.continued ? '2048! Terus bermain, atau tekan ‹ untuk simpan markah.' : `Gerakan: ${number(game.moves)}`;
  if (game.won && !game.continued) { const keep = h('button', 'btn btn-gold', 'Terus bermain'); keep.addEventListener('click', () => { game.continued = true; lastTick = performance.now(); renderGame(); }); controls.append(keep); stopClock(); }
}
function placeTile(tile, index) { tile.style.setProperty('--r', Math.floor(index / 4)); tile.style.setProperty('--c', index % 4); }
function endSlide() { if (!slide) return; const done = slide; slide = null; clearTimeout(done.timer); done.finish(); }
function move2048(direction) {
  if (gameId !== '2048' || document.body.dataset.screen !== 'game' || !game) return;
  endSlide(); // a quick second move first lands the previous one
  unlockPuzzleSound();
  const plan = moveBoard(game.board, direction), wasWon = game.won;
  if (!game.move(direction)) return;
  appsWargaHaptic('selection');
  if (game.over) playPuzzle('over');
  else if (game.won && !wasWon) playPuzzle('win');
  else if (plan.merged.length) playPuzzle('merge', { value: Math.max(...plan.merged.map(i => plan.board[i])) });
  else playPuzzle('slide');
  const fx = { merged: plan.merged, spawned: game.board.findIndex((value, i) => value && !plan.board[i]) };
  const current = game;
  const finishMove = () => { if (game !== current) return; renderGame(fx); if (game.over) finish('full'); };
  if (reducedMotion()) return finishMove();
  // Slide every tile to its new cell; merging pairs meet there. Then draw the new board.
  for (const { from, to } of plan.moves) { const tile = tileEls.get(from); if (tile) placeTile(tile, to); }
  slide = { finish: finishMove, timer: setTimeout(endSlide, SLIDE_MS) };
}
// `fx.board` draws a moment before the final board (full lines still in place); `fx.clearing` maps
// cells in cleared lines to their sweep delay; `fx.placed` cells pop in; `fx.stuck` marks game over.
function renderBlock(grid, controls, fx = {}) {
  grid.classList.add('eight'); grid.classList.toggle('stuck', Boolean(fx.stuck)); grid.setAttribute('aria-label', 'Papan susun blok');
  (fx.board ?? game.board).forEach((value, i) => {
    const cell = h('button', `puzzle-cell${value ? ' filled' : ''}`); cell.type = 'button'; cell.dataset.i = i;
    if (fx.clearing?.has(i)) { cell.classList.add('clearing'); cell.style.setProperty('--d', `${fx.clearing.get(i)}ms`); }
    else if (fx.placed?.includes(i)) cell.classList.add('placed');
    cell.setAttribute('aria-label', `Baris ${Math.floor(i / 8) + 1}, lajur ${i % 8 + 1}${value ? ', berisi' : ', kosong'}`);
    cell.addEventListener('click', () => placeBlock(Math.floor(i / 8), i % 8));
    grid.append(cell);
  });
  // Keep a piece selected that can still go somewhere; pieces with no room anywhere are greyed out.
  if (!game.fitsAnywhere(game.tray[selectedPiece])) { const k = game.tray.findIndex(shape => game.fitsAnywhere(shape)); if (k >= 0) selectedPiece = k; }
  const tray = h('div', 'puzzle-tray'); tray.setAttribute('aria-label', 'Kepingan');
  game.tray.forEach((shape, i) => {
    const fits = game.fitsAnywhere(shape);
    const b = h('button', `btn btn-ghost puzzle-piece${shape && !fits ? ' no-fit' : ''}`); b.type = 'button'; b.dataset.piece = i;
    b.disabled = !shape || !fits || Boolean(fx.stuck);
    b.setAttribute('aria-label', `Kepingan ${i + 1}${!shape ? ', digunakan' : fits ? '' : ', tiada ruang'}`);
    b.setAttribute('aria-pressed', String(selectedPiece === i && Boolean(shape)));
    if (shape) b.append(pieceMini(shape, 15, 13)); else b.textContent = '✓';
    b.addEventListener('click', () => { if (dragUsed) { dragUsed = false; return; } unlockPuzzleSound(); selectedPiece = i; playPuzzle('pick'); renderGame(); });
    b.addEventListener('pointerdown', event => startDrag(event, i));
    tray.append(b);
  });
  controls.append(tray); $('#game-status').textContent = fx.message ?? 'Seret kepingan ke papan, atau pilih dan ketik petak.';
}
// A piece drawn as small squares: `step` apart, each `size` wide.
function pieceMini(shape, step, size) {
  const mini = h('span', 'piece-mini');
  mini.style.width = `${Math.max(...shape.map(([x]) => x)) * step + size}px`;
  mini.style.height = `${Math.max(...shape.map(([, y]) => y)) * step + size}px`;
  for (const [x, y] of shape) { const pixel = h('i'); Object.assign(pixel.style, { left: `${x * step}px`, top: `${y * step}px`, width: `${size}px`, height: `${size}px` }); mini.append(pixel); }
  return mini;
}

// ---- placement preview: the footprint where a piece would go (green fits, red doesn't), and gold
// outlines on the lines that placement would clear.
function clearPreview() { for (const el of document.querySelectorAll('#game-grid .preview-ok, #game-grid .preview-bad, #game-grid .preview-line')) el.classList.remove('preview-ok', 'preview-bad', 'preview-line'); }
function showPreview(piece, index) {
  clearPreview();
  const shape = game?.tray[piece];
  if (gameId !== 'blok' || !shape || index < 0 || clearing || game.over) return false;
  const row = Math.floor(index / 8), column = index % 8, ok = game.fits(shape, row, column);
  const cells = $('#game-grid').children;
  for (const [x, y] of shape) if (row + y < 8 && column + x < 8) cells[(row + y) * 8 + column + x]?.classList.add(ok ? 'preview-ok' : 'preview-bad');
  if (ok) {
    const board = game.board.slice(); for (const [x, y] of shape) board[(row + y) * 8 + column + x] = 1;
    for (let k = 0; k < 8; k++) {
      if (board.slice(k * 8, k * 8 + 8).every(Boolean)) for (let c = 0; c < 8; c++) cells[k * 8 + c].classList.add('preview-line');
      if ([0, 1, 2, 3, 4, 5, 6, 7].every(r => board[r * 8 + k])) for (let r = 0; r < 8; r++) cells[r * 8 + k].classList.add('preview-line');
    }
  }
  return ok;
}
// The board cell nearest a point (snapping across the gaps between cells), or -1 off the board.
function cellAt(x, y) {
  const cells = $('#game-grid').children;
  if (gameId !== 'blok' || cells.length < 64) return -1;
  const a = cells[0].getBoundingClientRect(), b = cells[63].getBoundingClientRect();
  const pitchX = (b.left - a.left) / 7, pitchY = (b.top - a.top) / 7;
  const column = Math.round((x - a.left - a.width / 2) / pitchX), row = Math.round((y - a.top - a.height / 2) / pitchY);
  return row >= 0 && row < 8 && column >= 0 && column < 8 ? row * 8 + column : -1;
}

// ---- drag and drop: drag a piece from the tray; it floats above the finger, and its top-left
// square lands on the cell beneath. A tap without moving still just selects the piece.
let drag = null, dragUsed = false;
function startDrag(event, piece) {
  if (gameId !== 'blok' || !game?.tray[piece] || event.button > 0) return;
  unlockPuzzleSound();
  drag = { piece, pointerId: event.pointerId, x: event.clientX, y: event.clientY, ghost: null, target: -1, button: event.currentTarget };
  try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* pointer already gone */ }
}
function moveDrag(event) {
  if (!drag || event.pointerId !== drag.pointerId) return;
  if (!drag.ghost) {
    if (Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 8) return;
    // Start dragging: select this piece and float a board-sized copy of it.
    selectedPiece = drag.piece;
    for (const b of document.querySelectorAll('.puzzle-piece')) b.setAttribute('aria-pressed', String(Number(b.dataset.piece) === drag.piece));
    const cell = $('#game-grid').children[0].getBoundingClientRect().width;
    drag.ghost = pieceMini(game.tray[drag.piece], cell + 3, cell);
    drag.ghost.classList.add('drag-ghost'); drag.cell = cell;
    document.body.append(drag.ghost); playPuzzle('pick');
  }
  const g = drag.ghost.getBoundingClientRect();
  const left = event.clientX - g.width / 2, top = event.clientY - g.height - 28;
  drag.ghost.style.transform = `translate(${left}px, ${top}px)`;
  drag.target = cellAt(left + drag.cell / 2, top + drag.cell / 2);
  const ok = showPreview(drag.piece, drag.target);
  // Over the board but no room there: the floating piece turns red too, since it covers the preview.
  drag.ghost.classList.toggle('bad', drag.target >= 0 && !ok);
}
function endDrag(event, cancelled = false) {
  if (!drag || event.pointerId !== drag.pointerId) return;
  const { ghost, target, piece } = drag;
  drag = null; clearPreview();
  if (!ghost) return; // a tap: the click handler selects the piece
  ghost.remove(); dragUsed = true;
  setTimeout(() => { dragUsed = false; }, 0);
  if (cancelled || target < 0) return;
  selectedPiece = piece;
  if (!placeBlock(Math.floor(target / 8), target % 8)) { playPuzzle('miss'); appsWargaHaptic('notification', 'warning'); renderGame(); }
}

function endClear() { if (!clearing) return; const done = clearing; clearing = null; clearTimeout(done.timer); done.finish(); }
function placeBlock(row, column) {
  if (!game || document.body.dataset.screen !== 'game' || game.over) return false;
  unlockPuzzleSound();
  endClear(); // a quick next placement first lands the previous clear
  const before = game.board.slice();
  if (!game.place(selectedPiece, row, column)) { playPuzzle('miss'); return false; }
  clearPreview();
  selectedPiece = Math.max(0, game.tray.findIndex(Boolean));
  const { placed, rows, columns, cleared, points, streak } = game.lastMove;
  const lines = rows.length + columns.length;
  appsWargaHaptic(lines ? 'notification' : 'selection', lines ? 'success' : undefined);
  playPuzzle(lines ? 'clear' : 'place', { lines, streak });
  const message = !lines ? undefined : streak > 1 ? `${lines} garisan! Kombo ×${streak} · +${points} mata` : `${lines} garisan! +${points} mata`;
  const current = game;
  const finishPlace = () => {
    if (game !== current) return;
    if (!game.over) return renderGame({ placed: placed.filter(i => !cleared.includes(i)), message });
    // No room left: shake and dim the board for a moment before the result.
    renderGame({ stuck: true, message: 'Tiada ruang lagi!' });
    playPuzzle('over'); appsWargaHaptic('notification', 'warning');
    overTimer = setTimeout(() => { overTimer = 0; finish('full'); }, reducedMotion() ? 600 : 1300);
  };
  if (!lines || reducedMotion()) { finishPlace(); return true; }
  // Show the full lines, then sweep them away along each line before drawing the cleared board.
  const shown = before.slice(); for (const i of placed) shown[i] = 1;
  const delays = new Map(cleared.map(i => {
    const r = Math.floor(i / 8), c = i % 8;
    return [i, Math.min(rows.includes(r) ? c : 8, columns.includes(c) ? r : 8) * CLEAR_STEP_MS];
  }));
  renderGame({ board: shown, clearing: delays, placed, message });
  clearing = { finish: finishPlace, timer: setTimeout(endClear, CLEAR_MS) };
  return true;
}
function renderMemory(grid) {
  grid.classList.add('memory'); if (game.deck.length > 16) grid.classList.add('wide'); grid.setAttribute('aria-label', 'Kad memori');
  if (memoryDeck !== game.deck) {
    // A new level: deal fresh face-down cards. Later renders only turn them over, so the flip animates.
    memoryDeck = game.deck;
    memoryCards = game.deck.map((value, i) => {
      const card = h('button', 'puzzle-cell card'); card.type = 'button';
      const inner = h('span', 'card-inner');
      const front = h('span', 'card-face card-front'); front.innerHTML = MEMORY_ICONS[value].svg;
      inner.append(h('span', 'card-face card-back', '?'), front);
      card.append(inner);
      card.addEventListener('click', () => flipCard(i));
      return card;
    });
    grid.replaceChildren(...memoryCards);
  }
  game.deck.forEach((value, i) => {
    const shown = game.matched[i] || game.revealed.includes(i), card = memoryCards[i];
    card.classList.toggle('flipped', shown); card.classList.toggle('matched', game.matched[i]);
    // Face-down cards stay tappable even while a wrong pair is showing (a third tap closes it).
    card.disabled = shown;
    card.setAttribute('aria-label', `Kad ${i + 1}: ${shown ? MEMORY_ICONS[value].name : 'tertutup'}`);
  });
  $('#game-status').textContent = `Pasangan ${game.pairs}/${game.deck.length / 2}`;
}
function flipCard(i) {
  if (!game || document.body.dataset.screen !== 'game' || performance.now() < holdUntil) return;
  const level = game.level, card = memoryCards[i];
  // A wrong pair is still face up: a third tap turns it back over at once and opens the new card.
  if (game.revealed.length === 2 && !game.revealed.includes(i)) { clearTimeout(settleTimer); game.settle(); }
  unlockPuzzleSound();
  const pairs = game.pairs;
  if (!game.flip(i)) return;
  appsWargaHaptic('selection'); clearTimeout(settleTimer);
  playPuzzle(game.level !== level ? 'level' : game.pairs > pairs ? 'match' : game.revealed.length === 2 ? 'mismatch' : 'flip');
  if (game.level !== level) {
    // The last pair finished the level: show it face up for a moment (clock paused), then deal the next.
    card.classList.add('flipped');
    for (const c of memoryCards) { if (c.classList.contains('flipped')) c.classList.add('matched'); c.disabled = true; }
    $('#game-status').textContent = `Tahap ${level} selesai!`;
    $('#game-score').textContent = `${number(game.score)} mata`;
    stopClock(); holdUntil = performance.now() + 900;
    settleTimer = setTimeout(() => { if (game && document.body.dataset.screen === 'game') renderGame(); }, 900);
    return;
  }
  // A miss stays face up long enough to remember, then both cards turn back.
  if (game.revealed.length === 2) settleTimer = setTimeout(() => { if (game && document.body.dataset.screen === 'game') { game.settle(); renderGame(); } }, 850);
  renderGame();
}
function finish(reason = 'manual') {
  if (!game || lastResult?.game === game) return;
  stopClock(); clearTimeout(settleTimer);
  slide && (clearTimeout(slide.timer), slide = null);
  clearing && (clearTimeout(clearing.timer), clearing = null);
  clearTimeout(overTimer); overTimer = 0;
  game.over = true;
  const seconds = Math.min(86400, Math.max(1, Math.round(playedMs / 1000)));
  const result = { game, score: game.score, seconds, reason, detail: gameId === 'memori' ? `Tahap ${game.highestCompleted} selesai` : gameId === 'blok' ? `${game.lines} garisan` : gameId === '2048' ? `${game.moves} gerakan` : 'Pusingan ditamatkan', submit: { status: 'pending' } };
  lastResult = result;
  const s = stats(); s.played++; s.best = Math.max(s.best, result.score); storeSet(statsKey, s);
  appsWargaHaptic('notification', result.score > 0 ? 'success' : 'warning');
  // The result takes the game screen's place, so Back from it goes home, not to the old round.
  submitResult(result); go('tamat', { replace: location.hash === '#/main' });
}
function renderResult() {
  const r = lastResult; show('result'); $('#res-title').textContent = r.reason === 'timeout' ? 'Masa Tamat' : 'Pusingan Tamat'; $('#res-detail').textContent = r.detail; $('#res-score').textContent = number(r.score); $('#res-time').textContent = `Masa ${lb.formatDuration(r.seconds)}`; renderSubmit();
}
function renderSubmit() {
  if (!lastResult) return;
  const r = lastResult, box = $('#res-submit'); box.replaceChildren(); box.className = 'res-submit';
  const state = r.submit.status;
  box.textContent = state === 'offline' ? 'Papan markah belum dikonfigurasi. Markah disimpan dalam peranti ini sahaja.' : state === 'sending' || state === 'pending' ? 'Menghantar markah…' : state === 'done' ? 'Markah direkodkan.' : `Gagal menghantar: ${r.submit.message}`;
  if (state === 'done') box.classList.add('ok'); if (state === 'error') { box.classList.add('err'); const retry = h('button', 'btn btn-link', 'Cuba semula'); retry.addEventListener('click', () => submitResult(r)); box.append(retry); }
}
async function submitResult(r) {
  if (r.sending) return;
  const profile = loadProfile();
  if (!profile || !lb.boardsConfigured()) { r.submit = { status: 'offline' }; renderSubmit(); return; }
  r.sending = true; r.submit = { status: 'sending' }; renderSubmit();
  try { await lb.recordRound({ game: gameId, profile, points: r.score, seconds: r.seconds, date: todayKL() }); r.submit = { status: 'done' }; }
  catch (error) { r.submit = { status: 'error', message: error.message }; }
  finally { r.sending = false; if (lastResult === r) renderSubmit(); }
}
function openBoard() { show('board'); board.open(); } // shared/board.js: always opens on Hari Ini
function init() {
  // A list of rules shows as a numbered list, like the other games' help.
  if (Array.isArray(config.help)) {
    const list = h('ol', 'help-list');
    for (const rule of config.help) list.append(h('li', null, rule));
    $('#help-text').replaceWith(list);
  } else $('#help-text').textContent = config.help;
  initFromArked(); initAppsWarga(); initProfile();
  const help = () => $('#dlg-help').showModal(); $('#btn-help').addEventListener('click', help); $('#help-close').addEventListener('click', () => $('#dlg-help').close());
  // Susun Blok: hovering the board with a mouse previews the selected piece; drags follow the pointer.
  $('#game-grid').addEventListener('pointermove', event => { if (gameId === 'blok' && !drag && event.pointerType === 'mouse') showPreview(selectedPiece, cellAt(event.clientX, event.clientY)); });
  $('#game-grid').addEventListener('pointerleave', () => { if (!drag) clearPreview(); });
  document.addEventListener('pointermove', moveDrag);
  document.addEventListener('pointerup', event => endDrag(event));
  document.addEventListener('pointercancel', event => endDrag(event, true));
  $('#set-pad')?.addEventListener('click', () => toggleSetting('pad'));
  $('#set-sound')?.addEventListener('click', () => toggleSetting('sound'));
  $('#btn-hub').addEventListener('click', backToArked); $('#btn-close-app').addEventListener('click', closeMiniApp); $('#btn-version').addEventListener('click', hardReload);
  $('#btn-play').addEventListener('click', () => go('main')); $('#btn-board').addEventListener('click', () => go('papan')); $('#btn-quit').addEventListener('click', () => go(''));
  $('#res-home').addEventListener('click', () => go('')); $('#res-again').addEventListener('click', () => { game = null; go('main', { replace: true }); }); $('#res-board').addEventListener('click', () => go('papan'));
  $('#btn-board-back').addEventListener('click', () => go(''));  document.addEventListener('keydown', event => { if (gameId !== '2048' || document.body.dataset.screen !== 'game' || document.querySelector('dialog[open]')) return; const dir = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' }[event.key]; if (dir) { event.preventDefault(); move2048(dir); } });
  let touch = null; $('#game-grid').addEventListener('pointerdown', event => { if (gameId !== '2048') return; touch = { x: event.clientX, y: event.clientY }; try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* pointer already gone */ } }); $('#game-grid').addEventListener('pointercancel', () => { touch = null; }); $('#game-grid').addEventListener('pointerup', event => { if (!touch || gameId !== '2048') return; const dx = event.clientX - touch.x, dy = event.clientY - touch.y; touch = null; if (Math.max(Math.abs(dx), Math.abs(dy)) >= 24) move2048(Math.abs(dx) > Math.abs(dy) ? dx > 0 ? 'right' : 'left' : dy > 0 ? 'down' : 'up'); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) stopClock(); else if (activeClock()) lastTick = performance.now(); });
  window.addEventListener('hashchange', route); timer = setInterval(updateClock, 100); route(); requestAnimationFrame(notifyAppReady);
}
init();
