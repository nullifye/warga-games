// Sudoku puzzles, made in code from a seed: the same seed makes the same puzzle on every phone
// (Cabaran Harian is the same for everyone that day). Pure, no DOM (tests/generator.test.mjs).
//
// A grid is 81 numbers, row by row; 0 is an empty cell.
//  * countSolutions: a backtracking solver (bitmasks, fewest candidates first) that stops at a limit.
//  * rate: solves as a person does, and says which techniques it needed: tier 1 is singles (naked
//    and hidden); tier 2 adds pointing / claiming (locked candidates) and naked / hidden pairs.
//    A puzzle it can't finish isn't offered: every puzzle here can be solved by logic, no guessing.
//  * makePuzzle(seed, level): fills a solution, then takes away cells in symmetric pairs while the
//    answer stays unique and the rating fits the level. Attempts are counted, never timed, so the
//    result doesn't depend on the phone's speed.
//
// Changing anything here (or GENERATOR_VERSION) changes which puzzle falls on which day.
import { mulberry32, hashString, shuffle } from '../../shared/rng.js';

export const GENERATOR_VERSION = 1;
const ALL = 0x3fe; // bits 1–9

export const rowOf = (i) => Math.floor(i / 9);
export const colOf = (i) => i % 9;
export const boxOf = (i) => Math.floor(rowOf(i) / 3) * 3 + Math.floor(colOf(i) / 3);

/** The 27 units: rows 0–8, columns 9–17, boxes 18–26; each a list of 9 cells. */
export const UNITS = [
  ...Array.from({ length: 9 }, (_, r) => Array.from({ length: 9 }, (_, c) => r * 9 + c)),
  ...Array.from({ length: 9 }, (_, c) => Array.from({ length: 9 }, (_, r) => r * 9 + c)),
  ...Array.from({ length: 9 }, (_, b) => Array.from({ length: 9 }, (_, k) => (Math.floor(b / 3) * 3 + Math.floor(k / 3)) * 9 + (b % 3) * 3 + (k % 3))),
];
/** Each cell's 20 peers (same row, column or box). */
export const PEERS = Array.from({ length: 81 }, (_, i) => {
  const set = new Set();
  for (const u of [UNITS[rowOf(i)], UNITS[9 + colOf(i)], UNITS[18 + boxOf(i)]]) for (const j of u) if (j !== i) set.add(j);
  return [...set];
});

const bitCount = (m) => { let n = 0; while (m) { m &= m - 1; n++; } return n; };
const lowestDigit = (m) => 31 - Math.clz32(m & -m);
const digitsOf = (m) => { const out = []; for (let d = 1; d <= 9; d++) if (m & (1 << d)) out.push(d); return out; };

/** Counts the grid's solutions, stopping at `limit`. `out` (optional) gets the first one. */
export function countSolutions(grid, limit = 2, out = null) {
  const g = grid.slice();
  const rows = new Array(9).fill(0), cols = new Array(9).fill(0), boxes = new Array(9).fill(0);
  for (let i = 0; i < 81; i++) {
    const d = g[i];
    if (!d) continue;
    const bit = 1 << d;
    if ((rows[rowOf(i)] | cols[colOf(i)] | boxes[boxOf(i)]) & bit) return 0; // a clash: no solution
    rows[rowOf(i)] |= bit; cols[colOf(i)] |= bit; boxes[boxOf(i)] |= bit;
  }
  let count = 0;
  const search = () => {
    // The empty cell with the fewest candidates.
    let best = -1, bestMask = 0, bestN = 10;
    for (let i = 0; i < 81; i++) {
      if (g[i]) continue;
      const mask = ALL & ~(rows[rowOf(i)] | cols[colOf(i)] | boxes[boxOf(i)]);
      const n = bitCount(mask);
      if (n < bestN) { best = i; bestMask = mask; bestN = n; if (n <= 1) break; }
    }
    if (best < 0) {
      count++;
      if (out && count === 1) out.splice(0, 81, ...g);
      return count >= limit;
    }
    const r = rowOf(best), c = colOf(best), b = boxOf(best);
    for (let m = bestMask; m; m &= m - 1) {
      const bit = m & -m;
      g[best] = lowestDigit(bit);
      rows[r] |= bit; cols[c] |= bit; boxes[b] |= bit;
      const stop = search();
      rows[r] &= ~bit; cols[c] &= ~bit; boxes[b] &= ~bit;
      g[best] = 0;
      if (stop) return true;
    }
    return false;
  };
  search();
  return count;
}

/** A full, valid grid, filled cell by cell with the digits tried in a seeded order. */
export function fillSolution(rng) {
  const g = new Array(81).fill(0);
  const rows = new Array(9).fill(0), cols = new Array(9).fill(0), boxes = new Array(9).fill(0);
  const fill = (i) => {
    if (i === 81) return true;
    const r = rowOf(i), c = colOf(i), b = boxOf(i);
    const used = rows[r] | cols[c] | boxes[b];
    for (const d of shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9], rng)) {
      const bit = 1 << d;
      if (used & bit) continue;
      g[i] = d; rows[r] |= bit; cols[c] |= bit; boxes[b] |= bit;
      if (fill(i + 1)) return true;
      g[i] = 0; rows[r] &= ~bit; cols[c] &= ~bit; boxes[b] &= ~bit;
    }
    return false;
  };
  fill(0);
  return g;
}

/**
 * Solves like a person: { solved, tier, steps: { singles, advanced } }. Tier 1 needs only singles;
 * tier 2 also pointing / claiming and naked / hidden pairs. `maxTier` stops it from using more.
 */
export function rate(puzzle, maxTier = 2) {
  const g = puzzle.slice();
  const cand = new Array(81).fill(0);
  for (let i = 0; i < 81; i++) {
    if (g[i]) continue;
    let used = 0;
    for (const j of PEERS[i]) if (g[j]) used |= 1 << g[j];
    cand[i] = ALL & ~used;
  }
  const place = (i, d) => {
    g[i] = d;
    cand[i] = 0;
    for (const j of PEERS[i]) cand[j] &= ~(1 << d);
  };
  let tier = 1, singles = 0, advanced = 0;
  for (;;) {
    let placed = false;
    // Naked singles: a cell with one candidate.
    for (let i = 0; i < 81; i++) {
      if (!g[i] && bitCount(cand[i]) === 1) { place(i, lowestDigit(cand[i])); singles++; placed = true; }
    }
    // Hidden singles: a digit with one place left in a unit.
    for (const unit of UNITS) {
      for (let d = 1; d <= 9; d++) {
        const bit = 1 << d;
        let spot = -1, n = 0;
        for (const i of unit) if (cand[i] & bit) { spot = i; n++; }
        if (n === 1 && !g[spot]) { place(spot, d); singles++; placed = true; }
      }
    }
    if (placed) continue;
    if (g.every(Boolean)) break;
    if (maxTier < 2 || !eliminate(cand)) break;
    tier = 2;
    advanced++;
  }
  const solved = g.every(Boolean);
  // A stuck cell with no candidate means the puzzle (or a step) went wrong: never "solved".
  return { solved, tier: solved ? tier : Infinity, steps: { singles, advanced }, grid: g };
}

/** One round of tier-2 eliminations on the candidates; true if anything changed. */
function eliminate(cand) {
  let changed = false;
  const remove = (i, mask) => {
    if (cand[i] & mask) { cand[i] &= ~mask; changed = true; }
  };
  // Pointing (box → line) and claiming (line → box).
  for (let d = 1; d <= 9; d++) {
    const bit = 1 << d;
    for (let b = 0; b < 9; b++) {
      const cells = UNITS[18 + b].filter((i) => cand[i] & bit);
      if (cells.length < 2) continue;
      const rows = new Set(cells.map(rowOf)), cols = new Set(cells.map(colOf));
      if (rows.size === 1) for (const i of UNITS[rowOf(cells[0])]) if (boxOf(i) !== b) remove(i, bit);
      if (cols.size === 1) for (const i of UNITS[9 + colOf(cells[0])]) if (boxOf(i) !== b) remove(i, bit);
    }
    for (let u = 0; u < 18; u++) {
      const cells = UNITS[u].filter((i) => cand[i] & bit);
      if (cells.length < 2) continue;
      const boxes = new Set(cells.map(boxOf));
      if (boxes.size === 1) for (const i of UNITS[18 + boxOf(cells[0])]) if (!UNITS[u].includes(i)) remove(i, bit);
    }
  }
  if (changed) return true;
  // Naked pairs: two cells in a unit with the same two candidates.
  for (const unit of UNITS) {
    const pairs = unit.filter((i) => bitCount(cand[i]) === 2);
    for (let a = 0; a < pairs.length; a++) {
      for (let b = a + 1; b < pairs.length; b++) {
        if (cand[pairs[a]] !== cand[pairs[b]]) continue;
        const mask = cand[pairs[a]];
        for (const i of unit) if (i !== pairs[a] && i !== pairs[b]) remove(i, mask);
      }
    }
  }
  if (changed) return true;
  // Hidden pairs: two digits that fit only the same two cells of a unit.
  for (const unit of UNITS) {
    const where = Array.from({ length: 10 }, () => []);
    for (const i of unit) for (const d of digitsOf(cand[i])) where[d].push(i);
    for (let d1 = 1; d1 <= 9; d1++) {
      if (where[d1].length !== 2) continue;
      for (let d2 = d1 + 1; d2 <= 9; d2++) {
        if (where[d2].length !== 2 || where[d2][0] !== where[d1][0] || where[d2][1] !== where[d1][1]) continue;
        const keep = (1 << d1) | (1 << d2);
        for (const i of where[d1]) if (cand[i] & ~keep) { cand[i] &= keep; changed = true; }
      }
    }
  }
  return changed;
}

/**
 * The four levels: how many cells are given, and the techniques needed (`tier`: the most a puzzle
 * may need; `needs`: what it must need). Mudah and Sederhana are solved with singles alone; Susah
 * gives fewer cells (singles or tier 2); Pakar always needs a tier-2 step.
 */
export const LEVEL_RULES = {
  mudah: { givens: [36, 40], tier: 1, needs: 1 },
  sederhana: { givens: [30, 34], tier: 1, needs: 1 },
  susah: { givens: [26, 29], tier: 2, needs: 1 },
  pakar: { givens: [24, 27], tier: 2, needs: 2 },
};
export const MAX_ATTEMPTS = 200;

const fits = (rule, givens, r) => r.solved && givens >= rule.givens[0] && givens <= rule.givens[1] && r.tier >= rule.needs && r.tier <= rule.tier;

/**
 * A puzzle for `seed` and `level`: { puzzle, solution, givens, tier, attempt }. Each attempt is
 * its own seeded draw; the first that fits the level is used. If none does (not seen in the tests),
 * the closest fair one (unique, solvable by logic, givens in range) is used.
 */
export function makePuzzle(seed, level) {
  const rule = LEVEL_RULES[level];
  let fallback = null;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const rng = mulberry32(hashString(`sudoku:v${GENERATOR_VERSION}:${seed}:${level}:${attempt}`));
    const solution = fillSolution(rng);
    const puzzle = solution.slice();
    let givens = 81;
    // The level's target count, drawn in its range; cells go in symmetric pairs (i and 80 − i).
    const target = rule.givens[0] + Math.floor(rng() * (rule.givens[1] - rule.givens[0] + 1));
    const order = shuffle([...Array(41).keys()], rng);
    // Stop at the target, except that a tier-2 level keeps going (down to its minimum) until the
    // puzzle really needs a tier-2 step.
    const done = () => givens <= target && (rule.needs === 1 || rate(puzzle, 1).tier !== 1);
    for (const i of order) {
      if (done()) break;
      const pair = i === 40 ? [40] : [i, 80 - i];
      if (givens - pair.length < rule.givens[0]) continue;
      const saved = pair.map((j) => puzzle[j]);
      for (const j of pair) puzzle[j] = 0;
      const ok = countSolutions(puzzle, 2) === 1 && rate(puzzle, rule.tier).solved;
      if (ok) givens -= pair.length;
      else pair.forEach((j, k) => { puzzle[j] = saved[k]; });
    }
    const r = rate(puzzle);
    if (fits(rule, givens, r)) return { puzzle, solution, givens, tier: r.tier, attempt };
    if (!fallback && r.solved && givens >= rule.givens[0] && givens <= rule.givens[1]) {
      fallback = { puzzle, solution, givens, tier: r.tier, attempt };
    }
  }
  return fallback;
}

/** An 81-character string ("0" for empty), for saving and tests. */
export const toText = (grid) => grid.join('');
export const fromText = (text) => [...text].map(Number);
