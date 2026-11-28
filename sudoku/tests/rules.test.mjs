import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  LEVELS, LEVEL_IDS, MAX_MISTAKES, MAX_HINTS, MAX_POINTS, scoreFor, DAILY_LEVELS, dailyLevel, weekday, puzzleNumber,
  dailyPuzzle, newGame, place, toggleNote, erase, undo, hint, hintCell, remaining, editable, isRight, isWrong,
  saveGame, restoreGame, summary,
} from '../js/rules.js';
import { makePuzzle, PEERS, LEVEL_RULES } from '../js/generator.js';

// The board's limits (README.md, and arked_games in the hub's supabase/arked.sql).
const MAX_PER_SEC = 100;
/** The fastest a solve can be: two taps an empty cell (the cell, then the digit), 0.25 s a tap. */
const TAP_S = 0.25;

const game = (level = 'sederhana', seed = 1) => {
  const p = makePuzzle(seed, level);
  return newGame({ level, puzzle: p.puzzle, solution: p.solution });
};
const firstEmpty = (g) => g.values.findIndex((v) => v === 0);
const wrongDigit = (g, i) => (g.solution[i] % 9) + 1;

// ---------- points ----------

test('points: the base plus a time bonus that runs out at par, times mistakes and hints', () => {
  const { base, par } = LEVELS.sederhana;
  assert.equal(scoreFor({ level: 'sederhana', seconds: 0, mistakes: 0, hints: 0, won: true }), 2 * base);
  assert.equal(scoreFor({ level: 'sederhana', seconds: par / 2, mistakes: 0, hints: 0, won: true }), 1.5 * base);
  assert.equal(scoreFor({ level: 'sederhana', seconds: par * 3, mistakes: 0, hints: 0, won: true }), base);
  assert.equal(scoreFor({ level: 'sederhana', seconds: par * 3, mistakes: 1, hints: 0, won: true }), 0.8 * base);
  assert.equal(scoreFor({ level: 'sederhana', seconds: par * 3, mistakes: 2, hints: 2, won: true }), Math.round(base * 0.6 * 0.7));
  assert.equal(scoreFor({ level: 'pakar', seconds: 10, mistakes: 0, hints: 0, won: false }), 0);
  assert.equal(MAX_POINTS, 2000);
  for (const level of LEVEL_IDS) assert.ok(scoreFor({ level, seconds: 0, mistakes: 0, hints: 0, won: true }) <= MAX_POINTS);
});

test('points a second: even the fastest possible solve (two taps a cell) stays under the limit', () => {
  for (const level of LEVEL_IDS) {
    // The fewest blanks the level can have is where points a blank are highest.
    const fewestBlanks = 81 - LEVEL_RULES[level].givens[1];
    for (let hints = 0; hints <= MAX_HINTS; hints++) {
      // A hint fills a cell with one tap instead of two.
      const seconds = Math.max(1, Math.ceil(TAP_S * (2 * (fewestBlanks - hints) + hints)));
      const points = scoreFor({ level, seconds, mistakes: 0, hints, won: true });
      assert.ok(points / seconds < MAX_PER_SEC, `${level}, ${hints} hints: ${points} in ${seconds}s`);
    }
  }
  // And with the generator's real puzzles.
  for (const level of LEVEL_IDS) {
    for (let seed = 1; seed <= 30; seed++) {
      const blanks = makePuzzle(seed, level).puzzle.filter((v) => v === 0).length;
      const seconds = Math.ceil(TAP_S * 2 * blanks);
      assert.ok(scoreFor({ level, seconds, mistakes: 0, hints: 0, won: true }) / seconds < MAX_PER_SEC);
    }
  }
});

// ---------- the day's puzzle ----------

test('Cabaran Harian: the level follows the weekday; one puzzle a day, numbered from the launch', () => {
  assert.equal(DAILY_LEVELS.length, 7);
  assert.deepEqual(['2026-11-29', '2026-11-30', '2026-12-01', '2026-12-02', '2026-12-03', '2026-12-04', '2026-12-05'].map(weekday), [0, 1, 2, 3, 4, 5, 6]);
  assert.equal(dailyLevel('2026-11-29'), 'pakar'); // Ahad
  assert.equal(dailyLevel('2026-11-30'), 'mudah'); // Isnin
  assert.equal(puzzleNumber('2026-11-28'), 1);
  assert.equal(puzzleNumber('2026-12-10'), 13);
  assert.deepEqual(dailyPuzzle('2026-12-03').puzzle, dailyPuzzle('2026-12-03').puzzle);
  assert.notDeepEqual(dailyPuzzle('2026-12-03').puzzle, dailyPuzzle('2026-12-04').puzzle);
});

// ---------- playing ----------

test('a right number is locked and clears that digit from its peers\' notes', () => {
  const g = game();
  const i = firstEmpty(g);
  const d = g.solution[i];
  const peer = PEERS[i].find((j) => g.values[j] === 0);
  assert.ok(toggleNote(g, peer, d));
  assert.ok(g.notes[peer] & (1 << d));
  const res = place(g, i, d);
  assert.equal(res.right, true);
  assert.ok(isRight(g, i));
  assert.equal(g.notes[peer] & (1 << d), 0);
  assert.equal(editable(g, i), false);
  assert.equal(place(g, i, wrongDigit(g, i)), null); // locked
  assert.equal(erase(g, i), false);
  assert.equal(remaining(g, d), 9 - g.values.filter((v, k) => v === d && isRight(g, k)).length);
});

test('a wrong number shows as wrong and is a mistake; the third ends the game', () => {
  const g = game();
  const cells = g.values.map((v, i) => i).filter((i) => g.values[i] === 0);
  for (let k = 0; k < MAX_MISTAKES; k++) {
    const res = place(g, cells[k], wrongDigit(g, cells[k]));
    assert.equal(res.right, false);
    assert.ok(isWrong(g, cells[k]));
    assert.equal(g.mistakes, k + 1);
    assert.equal(res.lost, k + 1 === MAX_MISTAKES);
  }
  assert.equal(g.over, true);
  assert.equal(g.won, false);
  assert.equal(place(g, cells[5], g.solution[cells[5]]), null);
});

test('a wrong number can be erased or replaced; undo takes back entries but never a mistake', () => {
  const g = game();
  const i = firstEmpty(g);
  place(g, i, wrongDigit(g, i));
  assert.ok(erase(g, i));
  assert.equal(g.values[i], 0);
  assert.equal(undo(g), i);
  assert.ok(isWrong(g, i));
  assert.equal(undo(g), i);
  assert.equal(g.values[i], 0);
  assert.equal(g.mistakes, 1);
  // Undo also brings back the notes a right number cleared.
  const peer = PEERS[i].find((j) => g.values[j] === 0);
  toggleNote(g, peer, g.solution[i]);
  place(g, i, g.solution[i]);
  undo(g);
  assert.ok(g.notes[peer] & (1 << g.solution[i]));
  assert.equal(g.values[i], 0);
});

test('notes only in empty cells; a number clears the cell\'s own notes', () => {
  const g = game();
  const i = firstEmpty(g);
  assert.ok(toggleNote(g, i, 3));
  assert.ok(toggleNote(g, i, 5));
  assert.equal(g.notes[i], (1 << 3) | (1 << 5));
  assert.ok(toggleNote(g, i, 3));
  assert.equal(g.notes[i], 1 << 5);
  const given = g.puzzle.findIndex(Boolean);
  assert.equal(toggleNote(g, given, 1), false);
  place(g, i, g.solution[i]);
  assert.equal(g.notes[i], 0);
});

test('hints: three a game, on the chosen cell or the most useful one; not undone', () => {
  const g = game('susah');
  const i = firstEmpty(g);
  undo(g);
  const h1 = hint(g, i);
  assert.equal(h1.i, i);
  assert.ok(isRight(g, i));
  const auto = hintCell(g);
  assert.ok(editable(g, auto));
  assert.equal(hintCell(g), auto); // the same choice each time
  hint(g);
  hint(g);
  assert.equal(g.hints, MAX_HINTS);
  assert.equal(hint(g), null);
  assert.equal(undo(g), -1);
});

test('filling every cell right wins, and completed rows, columns and boxes are reported', () => {
  const g = game('mudah', 4);
  let last = null;
  const seen = new Set();
  for (let i = 0; i < 81; i++) {
    if (g.values[i]) continue;
    last = place(g, i, g.solution[i]);
    for (const u of last.units) seen.add(u);
  }
  assert.equal(last.won, true);
  assert.equal(g.won, true);
  assert.equal(g.over, true);
  assert.ok(seen.size > 0 && seen.size <= 27);
  const s = summary(g, 200);
  assert.equal(s.points, scoreFor({ level: 'mudah', seconds: 200, mistakes: 0, hints: 0, won: true }));
  assert.equal(s.blanks, g.puzzle.filter((v) => v === 0).length);
});

// ---------- saving ----------

test('a saved game comes back with its numbers, notes, mistakes and hints', () => {
  const made = makePuzzle(9, 'sederhana');
  const g = newGame({ level: 'sederhana', ...made });
  const cells = g.values.map((v, i) => i).filter((i) => g.values[i] === 0);
  place(g, cells[0], g.solution[cells[0]]);
  place(g, cells[1], wrongDigit(g, cells[1]));
  toggleNote(g, cells[2], 4);
  hint(g, cells[3]);
  const saved = JSON.parse(JSON.stringify(saveGame(g)));
  const back = restoreGame({ level: 'sederhana', ...made }, saved, { daily: true, date: '2026-12-01' });
  assert.deepEqual(back.values, g.values);
  assert.deepEqual(back.notes, g.notes);
  assert.equal(back.mistakes, 1);
  assert.equal(back.hints, 1);
  assert.equal(back.daily, true);
});

test('a save from another puzzle (or a damaged one) is not laid over this one', () => {
  const a = makePuzzle(1, 'mudah'), b = makePuzzle(2, 'mudah');
  const g = newGame({ level: 'mudah', ...a });
  const saved = saveGame(g);
  assert.equal(restoreGame({ level: 'mudah', ...b }, saved), null);
  assert.equal(restoreGame({ level: 'mudah', ...a }, { ...saved, values: 'x' }), null);
  assert.equal(restoreGame({ level: 'mudah', ...a }, null), null);
  // A given changed in the save: refused.
  const given = a.puzzle.findIndex(Boolean);
  const vals = [...saved.values];
  vals[given] = String((a.puzzle[given] % 9) + 1);
  assert.equal(restoreGame({ level: 'mudah', ...a }, { ...saved, values: vals.join('') }), null);
});
