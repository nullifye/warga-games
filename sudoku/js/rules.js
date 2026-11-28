// Sudoku's rules: the levels and their points, the day's puzzle, and a game in play (numbers,
// notes, erasing, undo, hints, mistakes, finishing). Pure, no DOM (tests/rules.test.mjs).
//
// Every number is checked as it goes in: a right one is locked (and clears that digit from the
// notes in its row, column and box); a wrong one shows red and is a mistake. Three mistakes end
// the game. A hint fills a cell (three a game). Undo takes back numbers and notes, never a
// mistake or a hint.
import { makePuzzle, PEERS, UNITS, rowOf, colOf, boxOf, toText, fromText } from './generator.js';
import { dayNumber } from '../../shared/rng.js';

export const LEVELS = {
  mudah: { name: 'Mudah', base: 200, par: 300 },
  sederhana: { name: 'Sederhana', base: 400, par: 600 },
  susah: { name: 'Susah', base: 700, par: 900 },
  pakar: { name: 'Pakar', base: 1000, par: 1200 },
};
export const LEVEL_IDS = Object.keys(LEVELS);
export const MAX_MISTAKES = 3;
export const MAX_HINTS = 3;
/** Points kept after 0, 1 or 2 mistakes. */
export const MISTAKE_FACTOR = [1, 0.8, 0.6];
/** Each hint takes this share of the points. */
export const HINT_COST = 0.15;
/** The most a game can score: Pakar solved at once, no mistake, no hint. */
export const MAX_POINTS = 2 * LEVELS.pakar.base;

/**
 * Points for a solved puzzle: the level's base, plus a time bonus (the base again, shrinking to
 * nothing at the level's par time), times the mistakes' and hints' factors. A lost game is 0.
 */
export function scoreFor({ level, seconds, mistakes, hints, won }) {
  if (!won) return 0;
  const { base, par } = LEVELS[level];
  const bonus = base * Math.max(0, 1 - Math.max(0, seconds) / par);
  const factor = (MISTAKE_FACTOR[mistakes] ?? 0) * Math.max(0, 1 - HINT_COST * hints);
  return Math.min(MAX_POINTS, Math.round((base + bonus) * factor));
}

// ---------- the day's puzzle ----------

/** Cabaran Harian's level by weekday (0 Ahad … 6 Sabtu): easy early in the week, Pakar on Ahad. */
export const DAILY_LEVELS = ['pakar', 'mudah', 'sederhana', 'susah', 'sederhana', 'mudah', 'susah'];
const LAUNCH = '2026-11-28';
export const weekday = (date) => new Date(`${date}T00:00:00Z`).getUTCDay();
export const dailyLevel = (date) => DAILY_LEVELS[weekday(date)];
/** Cabaran Harian #1 is the launch day. */
export const puzzleNumber = (date) => Math.max(1, dayNumber(date) - dayNumber(LAUNCH) + 1);
export const dailySeed = (date) => `harian:${date}`;
/** The day's puzzle: { level, puzzle, solution, givens }. The same everywhere. */
export function dailyPuzzle(date) {
  const level = dailyLevel(date);
  return { level, ...makePuzzle(dailySeed(date), level) };
}

// ---------- a game ----------

/** A new game from a made puzzle. */
export function newGame({ level, puzzle, solution, daily = false, date = null }) {
  return {
    level, daily, date,
    puzzle: puzzle.slice(), solution: solution.slice(),
    values: puzzle.slice(), notes: new Array(81).fill(0),
    mistakes: 0, hints: 0, hinted: [], history: [], over: false, won: false,
  };
}

export const isGiven = (g, i) => g.puzzle[i] !== 0;
export const isRight = (g, i) => g.values[i] !== 0 && g.values[i] === g.solution[i];
export const isWrong = (g, i) => g.values[i] !== 0 && g.values[i] !== g.solution[i];
/** Whether the player may change cell i: not given, not already right. */
export const editable = (g, i) => !g.over && !isGiven(g, i) && !isRight(g, i);

/** How many of digit d are still to be placed (right ones count as placed). */
export function remaining(g, d) {
  let n = 9;
  for (let i = 0; i < 81; i++) if (g.values[i] === d && g.values[i] === g.solution[i]) n--;
  return n;
}

/** The units (0–8 rows, 9–17 columns, 18–26 boxes) through cell i that are now all right. */
function completedUnits(g, i) {
  return [rowOf(i), 9 + colOf(i), 18 + boxOf(i)].filter((u) => UNITS[u].every((j) => isRight(g, j)));
}

/** Clears digit d from the notes of i's peers; returns what it changed, for undo. */
function clearPeerNotes(g, i, d) {
  const changed = [];
  const bit = 1 << d;
  for (const j of PEERS[i]) {
    if (g.notes[j] & bit) { changed.push([j, g.notes[j]]); g.notes[j] &= ~bit; }
  }
  return changed;
}

function finishIfDone(g) {
  if (g.values.every((v, i) => v === g.solution[i])) { g.won = true; g.over = true; }
}

/**
 * Puts digit d in cell i. Returns null if nothing happens, else { right, units (completed),
 * won, lost }. A wrong digit is a mistake; the third ends the game.
 */
export function place(g, i, d) {
  if (!editable(g, i) || g.values[i] === d || d < 1 || d > 9) return null;
  const entry = { i, value: g.values[i], notes: g.notes[i], peers: [] };
  g.values[i] = d;
  g.notes[i] = 0;
  const right = d === g.solution[i];
  let units = [];
  if (right) {
    entry.peers = clearPeerNotes(g, i, d);
    units = completedUnits(g, i);
    finishIfDone(g);
  } else {
    g.mistakes++;
    if (g.mistakes >= MAX_MISTAKES) g.over = true;
  }
  g.history.push(entry);
  return { right, units, won: g.won, lost: g.over && !g.won };
}

/** Turns note d in cell i on or off (empty cells only). Returns whether it changed. */
export function toggleNote(g, i, d) {
  if (!editable(g, i) || g.values[i] !== 0 || d < 1 || d > 9) return false;
  g.history.push({ i, value: 0, notes: g.notes[i], peers: [] });
  g.notes[i] ^= 1 << d;
  return true;
}

/** Clears a wrong number or the notes in cell i. Returns whether it changed. */
export function erase(g, i) {
  if (!editable(g, i) || (g.values[i] === 0 && g.notes[i] === 0)) return false;
  g.history.push({ i, value: g.values[i], notes: g.notes[i], peers: [] });
  g.values[i] = 0;
  g.notes[i] = 0;
  return true;
}

/** Takes back the last number, note or erase; returns its cell, or -1. Mistakes stay counted. */
export function undo(g) {
  if (g.over || !g.history.length) return -1;
  const e = g.history.pop();
  g.values[e.i] = e.value;
  g.notes[e.i] = e.notes;
  for (const [j, n] of e.peers) g.notes[j] = n;
  return e.i;
}

/** Candidates for an empty cell from the numbers placed right so far (for a hint's choice). */
function candidateCount(g, i) {
  let used = 0;
  for (const j of PEERS[i]) if (isRight(g, j)) used |= 1 << g.values[j];
  let n = 0;
  for (let d = 1; d <= 9; d++) if (!(used & (1 << d))) n++;
  return n;
}

/**
 * The cell a hint fills: `at` if the player may change it, else the open cell with the fewest
 * candidates (lowest index first), the one most likely to help.
 */
export function hintCell(g, at = -1) {
  if (at >= 0 && editable(g, at)) return at;
  let best = -1, bestN = 10;
  for (let i = 0; i < 81; i++) {
    if (!editable(g, i)) continue;
    const n = candidateCount(g, i);
    if (n < bestN) { best = i; bestN = n; }
  }
  return best;
}

/**
 * Fills a cell with its answer (`at`, or one chosen by hintCell). Returns { i, d, units, won } or
 * null when no hint is left. A hint can't be undone (the undo history starts again).
 */
export function hint(g, at = -1) {
  if (g.over || g.hints >= MAX_HINTS) return null;
  const i = hintCell(g, at);
  if (i < 0) return null;
  const d = g.solution[i];
  g.values[i] = d;
  g.notes[i] = 0;
  clearPeerNotes(g, i, d);
  g.hints++;
  g.hinted.push(i);
  g.history = [];
  const units = completedUnits(g, i);
  finishIfDone(g);
  return { i, d, units, won: g.won };
}

// ---------- saving a game in progress (Cabaran Harian resumes after a reload) ----------

export function saveGame(g) {
  return {
    level: g.level, date: g.date, puzzle: toText(g.puzzle), values: toText(g.values), notes: g.notes.slice(),
    mistakes: g.mistakes, hints: g.hints, hinted: g.hinted.slice(),
  };
}

/**
 * A saved game laid back over its puzzle; null if it doesn't belong to this puzzle (the generator
 * changed, or the save is damaged), so stale numbers never land on a different grid.
 */
export function restoreGame(made, saved, { daily = false, date = null } = {}) {
  if (!saved || saved.puzzle !== toText(made.puzzle) || typeof saved.values !== 'string' || saved.values.length !== 81) return null;
  const g = newGame({ level: made.level, puzzle: made.puzzle, solution: made.solution, daily, date });
  const values = fromText(saved.values);
  for (let i = 0; i < 81; i++) {
    if (isGiven(g, i)) { if (values[i] !== g.puzzle[i]) return null; continue; }
    g.values[i] = values[i];
  }
  if (Array.isArray(saved.notes) && saved.notes.length === 81) g.notes = saved.notes.map((n) => (Number(n) & 0x3fe));
  g.mistakes = Math.min(MAX_MISTAKES, Number(saved.mistakes) || 0);
  g.hints = Math.min(MAX_HINTS, Number(saved.hints) || 0);
  g.hinted = Array.isArray(saved.hinted) ? saved.hinted.filter((i) => Number.isInteger(i) && i >= 0 && i < 81) : [];
  if (g.mistakes >= MAX_MISTAKES) g.over = true;
  finishIfDone(g);
  return g;
}

/** What the result screen and the board need from a game. */
export function summary(g, seconds) {
  const blanks = g.puzzle.filter((v) => v === 0).length;
  return {
    level: g.level, won: g.won, mistakes: g.mistakes, hints: g.hints, seconds, blanks,
    points: scoreFor({ level: g.level, seconds, mistakes: g.mistakes, hints: g.hints, won: g.won }),
  };
}
