// LetupLetup's rules: a falling-stack match-3 on a 6 × 9 board. Pure, no DOM (unit-tested in
// tests/rules.test.mjs).
//
// Birds stack up from the bottom. Every few seconds a full row of them drops from the top, one
// into each column (the next row is always shown). Swap two neighbouring birds (or slide one
// sideways into an empty space) to line up 3 or more of a kind across or down: they pop (letup).
// Birds above fall, and new lines pop in a chain, each link worth more. 4 in a line leaves a
// Mercun (blasts the 3 × 3 round it when it pops); 5 in a line, or an L / T, leaves a Petir
// (clears its whole row and column). Caged birds can't be moved or matched; a pop beside one
// frees it, a blast clears it. A row that drops onto a full column ends the game.
//
// Combos: every move that pops within COMBO_WINDOW seconds of the last pop adds to the combo,
// which multiplies the move's points (×1.5 up to ×3). Swapping two specials into each other sets
// them off together: Mercun Besar (two Mercun: 5 × 5), Petir Berganda (Mercun + Petir: three
// rows and three columns), Ribut Petir (two Petir: every bird of both colours).
//
// The game works in "steps" the page animates in turn:
//   { type: 'swap', a, b }                                 two cells traded (a piece or null each)
//   { type: 'fall', moves: [{ id, from, to }] }            pieces falling to rest
//   { type: 'drop', spawns: [{ id, piece, to }] }          a wave entering from the top
//   { type: 'clear', chain, cells, blasts, made, unlocked, points, combo? }  combo: a special combo's kind
//   { type: 'streak', combo, mult, extra }                a move's combo bonus (combo 2 and up)
//   { type: 'level', level }                               a new Semester
//   { type: 'early', bonus }                               the row called down early, and its points
//   { type: 'over', col }                                  the column that overflowed
// Cells are [row, col], row 0 at the top. A piece: { id, type, special: null | 'bom' | 'petir', locked }.
import { mulberry32, hashString } from '../../shared/rng.js';

/** 6 columns: a row of 6 birds, big enough to see and swipe on a phone, few enough to keep the pressure on. */
export const COLS = 6;
export const ROWS = 9;
export const START_ROWS = 4;
/** Six birds (js/birds.js draws them); Diploma uses the first five. */
export const TYPES = ['Burung Merah', 'Burung Biru', 'Burung Hijau', 'Burung Kuning', 'Burung Ungu', 'Burung Putih'];
export const SPECIAL_NAMES = { bom: 'Mercun', petir: 'Petir' };

// ---------- scoring ----------
// Points are kept modest (5 a bird), so a game weighs about as much as the other games' rounds
// on the hub's combined board.
export const PER_PIECE = 5;
/** A chain's n-th link is worth ×n, up to ×5. */
export const CHAIN_CAP = 5;
export const SPECIAL_BONUS = { bom: 15, petir: 30 };
export const UNLOCK_POINTS = 3;
/**
 * Calling the next row down early (tapping it): points for each second saved, but only when the
 * player has popped something since the last row (calling rows down alone, without playing,
 * earns nothing).
 */
export const EARLY_BONUS_PER_S = 3;
/** Seconds after a pop in which the next popping move keeps the combo going (game time: not paused). */
export const COMBO_WINDOW = 4;
/** A move's points × this, by the combo it makes: 2 → ×1.5, 3–4 → ×2, 5–7 → ×2.5, 8+ → ×3. */
export const comboMult = (combo) => (combo >= 8 ? 3 : combo >= 5 ? 2.5 : combo >= 3 ? 2 : combo === 2 ? 1.5 : 1);
/** Two specials swapped into each other: what they make, and its bonus. */
export const SPECIAL_COMBOS = {
  'bom+bom': { name: 'Mercun Besar', bonus: 50 },
  'bom+petir': { name: 'Petir Berganda', bonus: 75 },
  'petir+petir': { name: 'Ribut Petir', bonus: 100 },
};
export const comboKind = (x, y) => [x, y].sort().join('+');
export const MAX_POINTS = 50_000;
/**
 * The page keeps input locked for at least this long after a swap that pops anything (the pop
 * and the fall take that long to play anyway, also with reduced motion). With the board's limits
 * in README.md this bounds the points a second (tested with a greedy player).
 */
export const MIN_MOVE_S = 0.45;

// ---------- levels: a study path, a Semester for every 35 birds popped (five rows' worth) ----------
export const PER_SEMESTER = 35;
/**
 * The path: Pra Diploma (one level, the first), Diploma (6 Semesters), Ijazah (degree, 4), Sarjana
 * (masters, 3), PhD (6), then Pembelajaran Sepanjang Hayat (lifelong learning): the last level,
 * the hardest, with no end. It is played until a column is stuck at the top. A programme with
 * `single` is one level with no Semesters.
 */
export const PROGRAMMES = [
  { name: 'Pra Diploma', semesters: 1, single: true },
  { name: 'Diploma', semesters: 6 },
  { name: 'Ijazah', semesters: 4 },
  { name: 'Sarjana', semesters: 3 },
  { name: 'PhD', semesters: 6 },
  { name: 'Pembelajaran Sepanjang Hayat', semesters: 1, single: true, endless: true, short: 'Sepanjang Hayat' },
];
/** Levels in all: 21 (Pra Diploma first, Pembelajaran Sepanjang Hayat last). */
export const MAX_LEVEL = PROGRAMMES.reduce((n, p) => n + p.semesters, 0);
export const levelFor = (cleared) => Math.min(MAX_LEVEL, 1 + Math.floor(cleared / PER_SEMESTER));

/** Level 1–21 as { programme, semester, first (the programme's first level), endless, label, short }. */
export function levelName(level) {
  let n = Math.max(1, Math.min(MAX_LEVEL, level));
  for (const p of PROGRAMMES) {
    if (n <= p.semesters) {
      if (p.single) return { programme: p.name, semester: null, first: true, endless: Boolean(p.endless), label: p.name, short: p.short ?? p.name };
      return { programme: p.name, semester: n, first: n === 1, endless: false, label: `${p.name} · Semester ${n}`, short: `${p.name} S${n}` };
    }
    n -= p.semesters;
  }
  return null;
}

/** The first level of a programme (1 for Pra Diploma, 2 for Diploma Semester 1, …). */
export const firstLevelOf = (name) => {
  let level = 1;
  for (const p of PROGRAMMES) {
    if (p.name === name) return level;
    level += p.semesters;
  }
  return null;
};

/** Each step up the path is harder: `t` runs from 0 (Pra Diploma) to 1 (Pembelajaran Sepanjang Hayat). */
const progress = (level) => (Math.min(MAX_LEVEL, level) - 1) / (MAX_LEVEL - 1);
/** The sixth bird joins from Ijazah onwards. */
export const typeCount = (level) => (level >= firstLevelOf('Ijazah') ? 6 : 5);
/** Every wave is a full row: one bird for each column. */
export const WAVE_SIZE = COLS;
/** Seconds of idle board between rows: 8 s in Pra Diploma, sooner every level, 3.5 s in Pembelajaran Sepanjang Hayat. */
export const waveInterval = (level) => Math.round((8 - 4.5 * progress(level)) * 100) / 100;
/** The chance each dropped bird comes caged: none in Pra Diploma, rising every level to 18% in Pembelajaran Sepanjang Hayat. */
export const lockChance = (level) => Math.round(0.18 * progress(level) * 1000) / 1000;

const inside = (r, c) => r >= 0 && r < ROWS && c >= 0 && c < COLS;
const at = (s, [r, c]) => (inside(r, c) ? s.grid[r][c] : undefined);
const key = (r, c) => r * COLS + c;
const cellOf = (k) => [Math.floor(k / COLS), k % COLS];

function piece(s, type, locked = false) {
  return { id: s.nextId++, type, special: null, locked };
}

/** The daily seed: the same board and waves for everyone that day. */
export const dailySeed = (date) => hashString(`letup-letup:${date}`);

/**
 * Wave `index`: the full row of birds waiting to drop, one per column. Each wave has its own
 * seeded draw, and the draw itself never depends on the level (only how it is read does), so two
 * players at the same Semester on the same day see the same rows.
 */
export function makeWave(seed, index, level) {
  const rng = mulberry32(hashString(`${seed}:w${index}`));
  return Array.from({ length: WAVE_SIZE }, (_, col) => {
    const t = rng(), l = rng();
    return { col, type: Math.floor(t * typeCount(level)), locked: l < lockChance(level) };
  });
}

/**
 * A new game: the bottom four rows filled, with no line already made but at least one swap that
 * makes one (drawn again in the rare case there is none).
 */
export function newGame({ seed, daily = false }) {
  for (let attempt = 0; ; attempt++) {
    const s = {
      seed, daily, grid: Array.from({ length: ROWS }, () => Array(COLS).fill(null)), nextId: 1,
      level: 1, cleared: 0, score: 0, bestChain: 0, made: { bom: 0, petir: 0 }, swaps: 0, waveIndex: 0,
      wave: makeWave(seed, 0, 1), over: false, endReason: null,
      combo: 0, lastPopT: -Infinity, bestCombo: 0, specialCombos: 0,
      poppedSinceRow: false, // a swap of the player's popped something since the last row dropped
    };
    const rng = mulberry32(hashString(`${seed}:start:${attempt}`));
    const n = typeCount(1);
    for (let r = ROWS - 1; r >= ROWS - START_ROWS; r--) {
      for (let c = 0; c < COLS; c++) {
        let type;
        do type = Math.floor(rng() * n);
        while (
          (c >= 2 && s.grid[r][c - 1]?.type === type && s.grid[r][c - 2]?.type === type)
          || (r <= ROWS - 3 && s.grid[r + 1][c]?.type === type && s.grid[r + 2][c]?.type === type)
        );
        s.grid[r][c] = piece(s, type);
      }
    }
    if (attempt >= 20 || legalSwaps(s).some(([a, b]) => { const t = clone(s); swap(t, a, b); return t.score > 0; })) return s;
  }
}

// ---------- finding lines ----------

const matchable = (p) => p && !p.locked;

/**
 * Lines of 3 or more of a kind, joined into groups where they share a cell (an L, T or +).
 * Each group: { type, cells: [[r, c]…], longest, crossed }.
 */
export function findGroups(grid) {
  const runs = [];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS;) {
      const p = grid[r][c];
      let e = c + 1;
      if (matchable(p)) while (e < COLS && matchable(grid[r][e]) && grid[r][e].type === p.type) e++;
      if (matchable(p) && e - c >= 3) runs.push({ dir: 'h', cells: Array.from({ length: e - c }, (_, i) => key(r, c + i)), type: p.type });
      c = e;
    }
  }
  for (let c = 0; c < COLS; c++) {
    for (let r = 0; r < ROWS;) {
      const p = grid[r][c];
      let e = r + 1;
      if (matchable(p)) while (e < ROWS && matchable(grid[e][c]) && grid[e][c].type === p.type) e++;
      if (matchable(p) && e - r >= 3) runs.push({ dir: 'v', cells: Array.from({ length: e - r }, (_, i) => key(r + i, c)), type: p.type });
      r = e;
    }
  }
  // Join runs that share a cell.
  const parent = runs.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const owner = new Map();
  runs.forEach((run, i) => {
    for (const k of run.cells) {
      if (owner.has(k)) parent[find(i)] = find(owner.get(k));
      else owner.set(k, i);
    }
  });
  const groups = new Map();
  runs.forEach((run, i) => {
    const root = find(i);
    const g = groups.get(root) ?? { type: run.type, cells: new Set(), longest: 0, dirs: new Set() };
    for (const k of run.cells) g.cells.add(k);
    g.longest = Math.max(g.longest, run.cells.length);
    g.dirs.add(run.dir);
    groups.set(root, g);
  });
  return [...groups.values()].map((g) => ({
    type: g.type, cells: [...g.cells].sort((a, b) => a - b).map(cellOf), longest: g.longest, crossed: g.dirs.size > 1,
  }));
}

/** What a group leaves behind: a Petir for 5 in a line or an L / T, a Mercun for 4 in a line. */
export function specialFor(group) {
  if (group.longest >= 5 || group.crossed) return 'petir';
  if (group.longest === 4) return 'bom';
  return null;
}

/** The cells a special clears when it pops. */
export function blastCells(kind, r, c) {
  const out = [];
  if (kind === 'bom') {
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) if (inside(r + dr, c + dc)) out.push([r + dr, c + dc]);
  } else if (kind === 'petir') {
    for (let i = 0; i < COLS; i++) out.push([r, i]);
    for (let i = 0; i < ROWS; i++) if (i !== r) out.push([i, c]);
  }
  return out;
}

// ---------- gravity, popping, chains ----------

/** Lets every piece fall to rest. Returns the moves (none when nothing fell). */
export function gravity(s) {
  const moves = [];
  for (let c = 0; c < COLS; c++) {
    let to = ROWS - 1;
    for (let r = ROWS - 1; r >= 0; r--) {
      const p = s.grid[r][c];
      if (!p) continue;
      if (r !== to) {
        s.grid[to][c] = p;
        s.grid[r][c] = null;
        moves.push({ id: p.id, from: [r, c], to: [to, c] });
      }
      to--;
    }
  }
  return moves;
}

/**
 * Sets off the specials among `cleared` (key → piece; those in `fired` have gone off already),
 * and any specials their blasts reach, adding what they clear to `cleared`. Cells in `madeAt`
 * (specials being made) are spared; blasted cages are cleared, not freed. Returns the blasts.
 */
function cascade(s, cleared, fired, madeAt, unlock) {
  const blasts = [];
  const queue = [...cleared.entries()].filter(([k, p]) => p.special && !madeAt.has(k) && !fired.has(k));
  for (const [k] of queue) fired.add(k);
  while (queue.length) {
    const [k, p] = queue.shift();
    const [r, c] = cellOf(k);
    blasts.push({ r, c, kind: p.special });
    for (const [br, bc] of blastCells(p.special, r, c)) {
      const bk = key(br, bc);
      const q = s.grid[br][bc];
      if (!q || madeAt.has(bk)) continue;
      if (!cleared.has(bk)) cleared.set(bk, q);
      unlock.delete(bk);
      if (q.special && !fired.has(bk)) { fired.add(bk); queue.push([bk, q]); }
    }
  }
  return blasts;
}

/** The cells a special combo clears, centred on [r, c] (Ribut Petir: every bird of the two colours). */
export function comboCells(s, kind, r, c, types = []) {
  const out = [];
  if (kind === 'bom+bom') {
    for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) if (inside(r + dr, c + dc)) out.push([r + dr, c + dc]);
  } else if (kind === 'bom+petir') {
    for (let rr = 0; rr < ROWS; rr++) for (let cc = 0; cc < COLS; cc++) if (Math.abs(rr - r) <= 1 || Math.abs(cc - c) <= 1) out.push([rr, cc]);
  } else if (kind === 'petir+petir') {
    for (let rr = 0; rr < ROWS; rr++) for (let cc = 0; cc < COLS; cc++) {
      const p = s.grid[rr][cc];
      if (p && types.includes(p.type)) out.push([rr, cc]);
    }
  }
  return out;
}

/**
 * Pops every line on the board, then lets the rest fall, again and again while new lines form.
 * `focus`: ids of the pieces the player just moved (or that just dropped); a special made from
 * their line appears where they are.
 */
export function resolve(s, focus = new Set(), chainFrom = 0) {
  const steps = [];
  let chain = chainFrom;
  const startLevel = s.level;
  for (;;) {
    const groups = findGroups(s.grid);
    if (!groups.length) break;
    chain++;
    const cleared = new Map(); // key -> piece
    const madeAt = new Map(); // key -> kind
    for (const g of groups) {
      for (const [r, c] of g.cells) cleared.set(key(r, c), s.grid[r][c]);
      const kind = specialFor(g);
      if (!kind) continue;
      // Where the special appears: a moved piece of the line, else the lowest, most central cell;
      // never on a special already there (that one goes off instead).
      const free = g.cells.filter(([r, c]) => !s.grid[r][c].special);
      const spot = free.find(([r, c]) => focus.has(s.grid[r][c].id))
        ?? [...free].sort((a, b) => b[0] - a[0] || Math.abs(a[1] - (COLS - 1) / 2) - Math.abs(b[1] - (COLS - 1) / 2))[0];
      if (!spot) continue;
      const k = key(...spot);
      if (madeAt.has(k)) continue;
      madeAt.set(k, kind);
    }
    // Pieces beside a popped line unlock (before blasts are added: a blast clears them instead).
    const unlock = new Set();
    for (const k of cleared.keys()) {
      const [r, c] = cellOf(k);
      for (const [nr, nc] of [[r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]]) {
        const p = at(s, [nr, nc]);
        if (p?.locked) unlock.add(key(nr, nc));
      }
    }
    // Specials in the popped lines go off, and set off any specials their blasts reach.
    const blasts = cascade(s, cleared, new Set(), madeAt, unlock);
    for (const k of madeAt.keys()) cleared.delete(k);
    const mult = Math.min(chain, CHAIN_CAP);
    let points = cleared.size * PER_PIECE * mult + unlock.size * UNLOCK_POINTS;
    const made = [];
    for (const [k, kind] of madeAt) {
      const [r, c] = cellOf(k);
      const p = s.grid[r][c];
      p.special = kind;
      s.made[kind]++;
      points += SPECIAL_BONUS[kind];
      made.push({ id: p.id, r, c, kind });
    }
    const unlocked = [];
    for (const k of unlock) {
      const p = s.grid[cellOf(k)[0]][cellOf(k)[1]];
      p.locked = false;
      unlocked.push(p.id);
    }
    const cells = [];
    for (const [k, p] of cleared) {
      const [r, c] = cellOf(k);
      cells.push({ id: p.id, r, c, type: p.type });
      s.grid[r][c] = null;
    }
    s.cleared += cleared.size;
    s.score = Math.min(MAX_POINTS, s.score + points);
    s.level = levelFor(s.cleared);
    s.bestChain = Math.max(s.bestChain, chain);
    steps.push({ type: 'clear', chain, cells, blasts, made, unlocked, points });
    const moves = gravity(s);
    if (moves.length) steps.push({ type: 'fall', moves });
    focus = new Set(moves.map((m) => m.id));
  }
  if (s.level !== startLevel) steps.push({ type: 'level', level: s.level });
  return steps;
}

// ---------- the player's moves ----------

/**
 * Whether cells a and b may be traded: neighbours, not both empty, neither locked, and an empty
 * cell only sideways (an item lifted into the space above would only fall back).
 */
export function canSwap(s, a, b) {
  if (s.over || !inside(...a) || !inside(...b)) return false;
  const dr = b[0] - a[0], dc = b[1] - a[1];
  if (Math.abs(dr) + Math.abs(dc) !== 1) return false;
  const pa = at(s, a), pb = at(s, b);
  if (!pa && !pb) return false;
  if (pa?.locked || pb?.locked) return false;
  if ((!pa || !pb) && dr !== 0) return false;
  return true;
}

/**
 * Trades two cells, lets pieces fall and pops what lines up; two specials traded into each other
 * go off together. `t`: the game clock in seconds (not counting pauses), for the combo. null when
 * the swap isn't allowed.
 */
export function swap(s, a, b, t = 0) {
  if (!canSwap(s, a, b)) return null;
  const pa = at(s, a), pb = at(s, b);
  s.grid[a[0]][a[1]] = pb;
  s.grid[b[0]][b[1]] = pa;
  s.swaps++;
  const before = s.score;
  const steps = [{ type: 'swap', a, b, ids: [pa?.id ?? null, pb?.id ?? null] }];
  if (pa?.special && pb?.special) {
    steps.push(...specialCombo(s, pa, pb, b, a));
  } else {
    const moves = gravity(s);
    if (moves.length) steps.push({ type: 'fall', moves });
    steps.push(...resolve(s, new Set([pa?.id, pb?.id].filter(Boolean))));
  }
  // The combo: a move that pops within COMBO_WINDOW of the last pop adds to it; its points are
  // multiplied. Moves that pop nothing neither add to it nor break it; time does.
  if (steps.some((x) => x.type === 'clear')) {
    s.poppedSinceRow = true;
    s.combo = s.combo > 0 && t - s.lastPopT <= COMBO_WINDOW ? s.combo + 1 : 1;
    s.lastPopT = t;
    s.bestCombo = Math.max(s.bestCombo, s.combo);
    const mult = comboMult(s.combo);
    if (mult > 1) {
      const extra = Math.round((s.score - before) * (mult - 1));
      s.score = Math.min(MAX_POINTS, s.score + extra);
      // Before a level step, so the bonus shows with the pops.
      const at2 = steps.findIndex((x) => x.type === 'level');
      steps.splice(at2 < 0 ? steps.length : at2, 0, { type: 'streak', combo: s.combo, mult, extra });
    }
  }
  return steps;
}

/** Whether the combo is still alive at game time `t` (for the page's combo badge). */
export const comboAlive = (s, t) => s.combo > 0 && t - s.lastPopT <= COMBO_WINDOW;

/** Two specials traded into each other (now at `centre` and `other`): they go off together. */
function specialCombo(s, pa, pb, centre, other) {
  const kind = comboKind(pa.special, pb.special);
  const [r, c] = centre;
  const startLevel = s.level;
  const cleared = new Map();
  for (const [rr, cc] of comboCells(s, kind, r, c, [pa.type, pb.type])) if (s.grid[rr][cc]) cleared.set(key(rr, cc), s.grid[rr][cc]);
  // The pair themselves are used up (they don't go off again on their own).
  const ka = [key(...centre), key(...other)];
  for (const k of ka) cleared.set(k, s.grid[cellOf(k)[0]][cellOf(k)[1]]);
  const unlock = new Set();
  const blasts = [{ r, c, kind }, ...cascade(s, cleared, new Set(ka), new Map(), unlock)];
  const points = cleared.size * PER_PIECE + SPECIAL_COMBOS[kind].bonus;
  const cells = [];
  for (const [k, p] of cleared) {
    const [rr, cc] = cellOf(k);
    cells.push({ id: p.id, r: rr, c: cc, type: p.type });
    s.grid[rr][cc] = null;
  }
  s.cleared += cleared.size;
  s.score = Math.min(MAX_POINTS, s.score + points);
  s.level = levelFor(s.cleared);
  s.specialCombos++;
  const steps = [{ type: 'clear', chain: 1, cells, blasts, made: [], unlocked: [], points, combo: kind }];
  const moves = gravity(s);
  if (moves.length) steps.push({ type: 'fall', moves });
  // What falls in may line up: those pops continue the chain (×2 onwards).
  const more = resolve(s, new Set(moves.map((m) => m.id)), 1);
  steps.push(...more.filter((x) => x.type !== 'level'));
  s.bestChain = Math.max(s.bestChain, 1);
  if (s.level !== startLevel) steps.push({ type: 'level', level: s.level });
  return steps;
}

/** The free cells left in column c (0 when it's full). */
export const room = (s, c) => s.grid.reduce((n, row) => n + (row[c] ? 0 : 1), 0);

/**
 * Drops the waiting wave into its columns, pops what lines up, and draws the next wave. A wave
 * that meets a full column ends the game. `early`: seconds left on the row timer when the player
 * called it down: EARLY_BONUS_PER_S points each, if they popped something since the last row.
 */
export function dropWave(s, early = 0) {
  if (s.over) return [];
  const steps = [];
  const earned = s.poppedSinceRow;
  s.poppedSinceRow = false;
  if (early > 0 && earned) {
    const bonus = Math.round(early * EARLY_BONUS_PER_S);
    s.score = Math.min(MAX_POINTS, s.score + bonus);
    steps.push({ type: 'early', bonus });
  }
  const spawns = [];
  for (const w of s.wave) {
    if (!room(s, w.col)) {
      if (spawns.length) steps.push({ type: 'drop', spawns });
      steps.push({ type: 'over', col: w.col });
      end(s, 'penuh');
      return steps;
    }
    let r = ROWS - 1;
    while (s.grid[r][w.col]) r--;
    const p = piece(s, w.type, w.locked);
    s.grid[r][w.col] = p;
    spawns.push({ id: p.id, piece: { ...p }, to: [r, w.col] });
  }
  steps.push({ type: 'drop', spawns });
  steps.push(...resolve(s, new Set(spawns.map((x) => x.id))));
  s.waveIndex++;
  s.wave = makeWave(s.seed, s.waveIndex, s.level);
  return steps;
}

export function end(s, reason) {
  if (!s.over) { s.over = true; s.endReason = reason; }
}

/** Every legal swap (each pair once), for hints and tests. */
export function legalSwaps(s) {
  const out = [];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (canSwap(s, [r, c], [r, c + 1])) out.push([[r, c], [r, c + 1]]);
      if (canSwap(s, [r, c], [r + 1, c])) out.push([[r, c], [r + 1, c]]);
    }
  }
  return out;
}

/** A deep copy (for trying a move out without changing the game). */
export function clone(s) {
  return { ...s, grid: s.grid.map((row) => row.map((p) => (p ? { ...p } : null))), made: { ...s.made }, wave: s.wave.map((w) => ({ ...w })) };
}

export function summary(s) {
  return {
    points: s.score, level: s.level, cleared: s.cleared, bestChain: s.bestChain, made: { ...s.made }, swaps: s.swaps, waves: s.waveIndex,
    bestCombo: s.bestCombo, specialCombos: s.specialCombos,
  };
}
