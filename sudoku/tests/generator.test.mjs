import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  GENERATOR_VERSION, LEVEL_RULES, MAX_ATTEMPTS, UNITS, PEERS, countSolutions, fillSolution, rate, makePuzzle, toText, fromText,
} from '../js/generator.js';
import { dailyPuzzle } from '../js/rules.js';
import { mulberry32 } from '../../shared/rng.js';

const validFull = (g) => g.length === 81 && UNITS.every((u) => new Set(u.map((i) => g[i])).size === 9 && u.every((i) => g[i] >= 1 && g[i] <= 9));

test('units and peers: 27 units of 9, 20 peers a cell', () => {
  assert.equal(UNITS.length, 27);
  assert.ok(UNITS.every((u) => u.length === 9 && new Set(u).size === 9));
  assert.ok(PEERS.every((p, i) => p.length === 20 && !p.includes(i)));
});

test('a filled solution is a valid grid, and the same seed fills the same grid', () => {
  for (let s = 1; s <= 50; s++) assert.ok(validFull(fillSolution(mulberry32(s))));
  assert.deepEqual(fillSolution(mulberry32(7)), fillSolution(mulberry32(7)));
});

test('countSolutions: one for a proper puzzle, more for an emptied one, none for a clash', () => {
  const { puzzle, solution } = makePuzzle('t', 'sederhana');
  const out = [];
  assert.equal(countSolutions(puzzle, 2, out), 1);
  assert.deepEqual(out, solution);
  assert.equal(countSolutions(new Array(81).fill(0), 2), 2);
  const clash = puzzle.slice();
  const filled = clash.findIndex(Boolean);
  const peer = PEERS[filled].find((j) => !clash[j]);
  clash[peer] = clash[filled];
  assert.equal(countSolutions(clash, 2), 0);
});

test('every level: a unique answer, givens in range, the right techniques, solvable by logic alone', () => {
  for (const [level, rule] of Object.entries(LEVEL_RULES)) {
    for (let seed = 1; seed <= 150; seed++) {
      const p = makePuzzle(seed, level);
      assert.ok(p, `${level} ${seed}: no puzzle`);
      assert.ok(validFull(p.solution));
      assert.ok(p.puzzle.every((v, i) => v === 0 || v === p.solution[i]), 'givens agree with the answer');
      assert.equal(countSolutions(p.puzzle, 2), 1, `${level} ${seed}: not unique`);
      const givens = p.puzzle.filter(Boolean).length;
      assert.equal(givens, p.givens);
      assert.ok(givens >= rule.givens[0] && givens <= rule.givens[1], `${level} ${seed}: ${givens} givens`);
      const r = rate(p.puzzle);
      assert.ok(r.solved, `${level} ${seed}: logic can't solve it`);
      assert.deepEqual(r.grid, p.solution);
      assert.ok(r.tier >= rule.needs && r.tier <= rule.tier, `${level} ${seed}: tier ${r.tier}`);
      assert.ok(p.attempt < MAX_ATTEMPTS);
      // Symmetric: a cell and its mirror are both given or both empty.
      for (let i = 0; i < 81; i++) assert.equal(Boolean(p.puzzle[i]), Boolean(p.puzzle[80 - i]));
    }
  }
});

test('Mudah and Sederhana need singles only; Pakar always needs more', () => {
  for (let seed = 1; seed <= 40; seed++) {
    assert.equal(rate(makePuzzle(seed, 'mudah').puzzle, 1).solved, true);
    assert.equal(rate(makePuzzle(seed, 'sederhana').puzzle, 1).solved, true);
    assert.equal(rate(makePuzzle(seed, 'pakar').puzzle, 1).solved, false);
  }
});

test('the same seed makes the same puzzle; the dailies are pinned (changing the generator changes them)', () => {
  assert.deepEqual(makePuzzle('x', 'susah'), makePuzzle('x', 'susah'));
  assert.notDeepEqual(makePuzzle('x', 'susah').puzzle, makePuzzle('y', 'susah').puzzle);
  assert.equal(GENERATOR_VERSION, 1);
  // If these fail, the generator changed: every day's Cabaran Harian moves (players mid-puzzle
  // lose their progress). Bump GENERATOR_VERSION on purpose and update the strings.
  const pinned = {
    '2026-12-01': ['sederhana', '140670008709008000030512000392700010000000000080001943000185020000900307900027081'],
    '2026-12-05': ['susah', '040020000600037009900000407001003094006000100430500600508000001200610008000090070'],
    '2026-12-06': ['pakar', '000000000031704000009030601000005010800249005040800000502080700000406530000000000'],
  };
  for (const [date, [level, text]] of Object.entries(pinned)) {
    const p = dailyPuzzle(date);
    assert.equal(p.level, level);
    assert.equal(toText(p.puzzle), text);
  }
  assert.deepEqual(fromText(toText([1, 0, 9])), [1, 0, 9]);
});
