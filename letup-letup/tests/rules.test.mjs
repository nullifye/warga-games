import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  COLS, ROWS, START_ROWS, PER_PIECE, CHAIN_CAP, SPECIAL_BONUS, MIN_MOVE_S, MAX_POINTS,
  COMBO_WINDOW, comboMult, SPECIAL_COMBOS, comboKind, comboCells, comboAlive, EARLY_BONUS_PER_S,
  newGame, makeWave, findGroups, specialFor, blastCells, gravity, resolve, canSwap, swap, dropWave, room,
  legalSwaps, clone, levelFor, levelName, MAX_LEVEL, typeCount, WAVE_SIZE, waveInterval, lockChance, dailySeed,
} from '../js/rules.js';

// The board's limits (README.md, and arked_games in the hub's supabase/arked.sql).
const MAX_PER_SEC = 300;
/** Seconds as the page records them: whole seconds, rounded up, at least 1. */
const recorded = (t) => Math.max(1, Math.ceil(t));

/** A game whose board is drawn from rows of letters: A–F a type, a–f the same locked, . empty. */
function board(rows, { specials = {} } = {}) {
  const s = newGame({ seed: 1 });
  s.grid = Array.from({ length: ROWS }, () => Array(COLS).fill(null));
  const pad = ROWS - rows.length;
  rows.forEach((line, i) => {
    [...line].forEach((ch, c) => {
      if (ch === '.') return;
      const lower = ch === ch.toLowerCase();
      s.grid[pad + i][c] = { id: s.nextId++, type: ch.toUpperCase().charCodeAt(0) - 65, special: null, locked: lower };
    });
  });
  for (const [cell, kind] of Object.entries(specials)) {
    const [r, c] = cell.split(',').map(Number);
    s.grid[r][c].special = kind;
  }
  return s;
}
const types = (s) => s.grid.map((row) => row.map((p) => (p ? String.fromCharCode(65 + p.type) : '.')).join(''));

/** Picks the swap that scores most right now (null when none scores). */
function greedy(s, time = 0) {
  let best = null, bestPts = 0;
  for (const [a, b] of legalSwaps(s)) {
    const t = clone(s);
    swap(t, a, b, time);
    if (t.score - s.score > bestPts) { bestPts = t.score - s.score; best = [a, b]; }
  }
  return best;
}

// ---------- the opening board and the waves ----------

test('a new board fills the bottom rows with no line made and at least one move that scores', () => {
  for (let seed = 1; seed <= 200; seed++) {
    const s = newGame({ seed });
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) assert.equal(Boolean(s.grid[r][c]), r >= ROWS - START_ROWS);
    }
    assert.equal(findGroups(s.grid).length, 0, `seed ${seed}`);
    assert.ok(s.grid.flat().every((p) => !p || (p.type < typeCount(1) && !p.locked && !p.special)));
    assert.ok(greedy(s), `seed ${seed}: no scoring move`);
  }
});

test('the same seed gives the same game; a day has one seed for everyone', () => {
  assert.deepEqual(types(newGame({ seed: 42 })), types(newGame({ seed: 42 })));
  assert.notDeepEqual(types(newGame({ seed: 42 })), types(newGame({ seed: 43 })));
  assert.equal(dailySeed('2026-11-26'), dailySeed('2026-11-26'));
  assert.notEqual(dailySeed('2026-11-26'), dailySeed('2026-11-27'));
});

test('waves: a full row, one bird a column, the same for everyone at that Semester', () => {
  for (let i = 0; i < 100; i++) {
    for (const level of [1, 4, 8, 12]) {
      const w = makeWave(7, i, level);
      assert.equal(w.length, COLS);
      assert.deepEqual(w.map((x) => x.col), [...Array(COLS).keys()]);
      assert.ok(w.every((x) => x.type >= 0 && x.type < typeCount(level)));
      if (level === 1) assert.ok(w.every((x) => !x.locked));
      assert.deepEqual(makeWave(7, i, level), w);
    }
  }
  assert.equal(WAVE_SIZE, COLS);
});

test('levels: Pra Diploma, Diploma 1–6, Ijazah 1–4, Sarjana 1–3, PhD 1–6, then Pembelajaran Sepanjang Hayat to the end', () => {
  assert.equal(MAX_LEVEL, 21);
  const short = Array.from({ length: 21 }, (_, i) => levelName(i + 1).short);
  assert.deepEqual(short, [
    'Pra Diploma',
    'Diploma S1', 'Diploma S2', 'Diploma S3', 'Diploma S4', 'Diploma S5', 'Diploma S6',
    'Ijazah S1', 'Ijazah S2', 'Ijazah S3', 'Ijazah S4',
    'Sarjana S1', 'Sarjana S2', 'Sarjana S3',
    'PhD S1', 'PhD S2', 'PhD S3', 'PhD S4', 'PhD S5', 'PhD S6',
    'Sepanjang Hayat',
  ]);
  assert.deepEqual(levelName(1), { programme: 'Pra Diploma', semester: null, first: true, endless: false, label: 'Pra Diploma', short: 'Pra Diploma' });
  assert.equal(levelName(2).label, 'Diploma · Semester 1');
  assert.equal(levelName(2).first, true);
  assert.equal(levelName(3).first, false);
  assert.equal(levelName(8).label, 'Ijazah · Semester 1');
  assert.deepEqual(levelName(21), { programme: 'Pembelajaran Sepanjang Hayat', semester: null, first: true, endless: true, label: 'Pembelajaran Sepanjang Hayat', short: 'Sepanjang Hayat' });
  assert.deepEqual([0, 34, 35, 69, 70].map(levelFor), [1, 1, 2, 2, 3]);
  assert.equal(levelFor(35 * 20), 21);
  assert.equal(levelFor(35 * 1000), 21);
});

test('every step up is harder: rows sooner, more caged Leos, the sixth Leo from Ijazah', () => {
  assert.equal(waveInterval(1), 8);
  assert.equal(waveInterval(21), 3.5);
  assert.equal(waveInterval(40), 3.5);
  assert.equal(lockChance(1), 0);
  assert.equal(lockChance(21), 0.18);
  for (let l = 2; l <= 21; l++) {
    assert.ok(waveInterval(l) < waveInterval(l - 1), `interval at ${l}`);
    assert.ok(lockChance(l) > lockChance(l - 1), `cages at ${l}`);
  }
  assert.equal(typeCount(7), 5); // Diploma Semester 6
  assert.equal(typeCount(8), 6); // Ijazah Semester 1
});

// ---------- lines and specials ----------

test('lines of 3 or more across and down are found; locked items never match', () => {
  const s = board([
    'AAAB..',
    'CBBBB.',
    'C.aaa.',
    'C.....',
  ]);
  const g = findGroups(s.grid);
  assert.equal(g.length, 3);
  assert.deepEqual(g.map((x) => x.cells.length).sort(), [3, 3, 4]);
  assert.deepEqual(g.map(specialFor).sort(), ['bom', null, null].sort());
});

test('an L, T or 5 in a line makes a Petir; 4 a Mercun', () => {
  const l = findGroups(board(['A.....', 'A.....', 'AAA...']).grid);
  assert.equal(l.length, 1);
  assert.equal(l[0].cells.length, 5);
  assert.equal(specialFor(l[0]), 'petir');
  assert.equal(specialFor(findGroups(board(['BBBBB.']).grid)[0]), 'petir');
  assert.equal(specialFor(findGroups(board(['BBBB..']).grid)[0]), 'bom');
});

test('blasts: a Mercun clears the 3 × 3 round it, a Petir its row and column', () => {
  assert.equal(blastCells('bom', 4, 3).length, 9);
  assert.equal(blastCells('bom', 0, 0).length, 4);
  assert.equal(blastCells('petir', 4, 3).length, COLS + ROWS - 1);
});

test('gravity lets everything fall to rest and reports each move', () => {
  const s = board(['A..', '...', 'B..', '...']);
  const moves = gravity(s);
  assert.deepEqual(types(s).slice(-2), ['A.....', 'B.....']);
  assert.equal(moves.length, 2);
});

// ---------- popping and chains ----------

test('a line pops for PER_PIECE an item, and the chain multiplies the next link', () => {
  const s = board([
    'B.....',
    'A.....',
    'A.....',
    'ABB...',
  ]);
  // The As pop, and the B on top falls in beside the other two.
  const steps = resolve(s);
  const clears = steps.filter((x) => x.type === 'clear');
  assert.equal(clears.length, 2);
  assert.equal(clears[0].points, 3 * PER_PIECE);
  assert.equal(clears[1].chain, 2);
  assert.equal(clears[1].points, 3 * PER_PIECE * 2);
  assert.equal(s.score, 3 * PER_PIECE * 3);
  assert.equal(s.cleared, 6);
  assert.equal(s.bestChain, 2);
});

test('4 in a line leaves a Mercun where the moved item went', () => {
  const s = board(['..A...', 'AABA..']);
  const steps = swap(s, [7, 2], [8, 2]);
  const clear = steps.find((x) => x.type === 'clear');
  assert.equal(clear.cells.length, 3);
  assert.equal(clear.made.length, 1);
  assert.equal(clear.made[0].kind, 'bom');
  assert.deepEqual([clear.made[0].r, clear.made[0].c], [8, 2]);
  assert.equal(s.grid[8][2].special, 'bom');
  assert.equal(clear.points, 3 * PER_PIECE + SPECIAL_BONUS.bom);
});

test('a popped Mercun blasts its 3 × 3, setting off a Petir it reaches; locked items are cleared', () => {
  const s = board([
    'CDEcD.',
    'DCADC.',
    'AAAEC.',
  ], { specials: { '8,1': 'bom', '7,0': 'petir' } });
  const steps = resolve(s);
  const clear = steps.find((x) => x.type === 'clear');
  assert.deepEqual(clear.blasts.map((b) => b.kind).sort(), ['bom', 'petir']);
  // The Petir on row 7 clears that whole row and column 0; the Mercun the 3 × 3 round (8,1).
  for (let c = 0; c < 5; c++) assert.ok(clear.cells.some((x) => x.r === 7 && x.c === c), `row 7 col ${c}`);
  assert.ok(clear.cells.some((x) => x.r === 6 && x.c === 3) === false); // the locked c at (6,3) is out of reach
  assert.ok(clear.cells.some((x) => x.r === 6 && x.c === 0 && x.type === 2));
});

test('a pop beside a locked item unlocks it', () => {
  const s = board(['.b....', 'AAA...']);
  const steps = resolve(s);
  const clear = steps.find((x) => x.type === 'clear');
  assert.equal(clear.unlocked.length, 1);
  assert.equal(s.grid[ROWS - 1][1].locked, false); // it fell into the gap, unlocked
});

// ---------- the player's moves ----------

test('swaps: neighbours only; never a locked item; an empty cell only sideways', () => {
  const s = board(['A.....', 'Bc....']);
  assert.ok(canSwap(s, [8, 0], [7, 0])); // two items, up and down
  assert.ok(canSwap(s, [7, 0], [7, 1])); // into the empty space beside
  assert.ok(!canSwap(s, [7, 0], [6, 0])); // up into the air
  assert.ok(!canSwap(s, [8, 0], [8, 1])); // locked
  assert.ok(!canSwap(s, [8, 0], [8, 2])); // not neighbours
  assert.ok(!canSwap(s, [6, 3], [6, 4])); // both empty
  assert.equal(swap(s, [8, 0], [8, 1]), null);
});

test('an item slid over a gap falls and can make a line', () => {
  const s = board(['.A....', '...B..', 'AA.B..']);
  const steps = swap(s, [6, 1], [6, 2]);
  assert.equal(steps[0].type, 'swap');
  assert.equal(steps[1].type, 'fall');
  assert.deepEqual(steps[1].moves[0].to, [8, 2]);
  assert.ok(steps.some((x) => x.type === 'clear'));
  assert.equal(s.grid[8][0], null);
});

test('a wave drops into its columns; one into a full column ends the game', () => {
  const s = newGame({ seed: 5 });
  const wave = s.wave.map((w) => ({ ...w }));
  const before = wave.map((w) => room(s, w.col));
  const steps = dropWave(s);
  assert.equal(steps[0].type, 'drop');
  assert.equal(steps[0].spawns.length, wave.length);
  assert.equal(s.waveIndex, 1);
  wave.forEach((w, i) => assert.ok(room(s, w.col) <= before[i]));
  // Fill a column the next wave uses to the top.
  const col = s.wave[0].col;
  for (let r = 0; r < ROWS; r++) if (!s.grid[r][col]) s.grid[r][col] = { id: s.nextId++, type: 5, special: null, locked: true };
  const end = dropWave(s);
  assert.equal(end.at(-1).type, 'over');
  assert.equal(end.at(-1).col, col);
  assert.equal(s.over, true);
  assert.equal(s.endReason, 'penuh');
  assert.equal(swap(s, [8, 0], [8, 1]), null);
});

test('a played-out game: every step leaves no line on the board (until it ends), and pieces keep their ids', () => {
  for (let seed = 1; seed <= 10; seed++) {
    const s = newGame({ seed });
    for (let m = 0; m < 400 && !s.over; m++) {
      const move = greedy(s) ?? legalSwaps(s)[m % Math.max(1, legalSwaps(s).length)];
      if (move && m % 3) swap(s, ...move);
      else dropWave(s);
      // (The row that ends the game is left as it landed: the game is over.)
      if (!s.over) assert.equal(findGroups(s.grid).length, 0);
      const ids = s.grid.flat().filter(Boolean).map((p) => p.id);
      assert.equal(new Set(ids).size, ids.length);
      // Nothing floats.
      for (let c = 0; c < COLS; c++) {
        let seen = false;
        for (let r = 0; r < ROWS; r++) { if (s.grid[r][c]) seen = true; else assert.ok(!seen, `seed ${seed} floating in col ${c}`); }
      }
    }
  }
});

// ---------- the board's limits ----------

test('points a second: the best opening bursts stay under the limit', () => {
  // A player who makes their best scoring swaps back to back (each takes at least MIN_MOVE_S),
  // then leaves: the round is recorded with the seconds rounded up.
  for (let seed = 1; seed <= 300; seed++) {
    const s = newGame({ seed });
    for (let k = 1; k <= 12; k++) {
      // Back to back, so the combo climbs as fast as it can.
      const time = (k - 1) * MIN_MOVE_S;
      const move = greedy(s, time);
      if (!move) break;
      swap(s, ...move, time);
      assert.ok(s.score / recorded(k * MIN_MOVE_S) < MAX_PER_SEC * 0.85, `seed ${seed}: ${s.score} in ${k} moves`);
    }
  }
  // Every first swap, and every pair of swaps, on some opening boards.
  for (let seed = 1; seed <= 25; seed++) {
    const s = newGame({ seed });
    for (const [a, b] of legalSwaps(s)) {
      const t = clone(s);
      swap(t, a, b, 0);
      for (const [x, y] of legalSwaps(t)) {
        const u = clone(t);
        swap(u, x, y, MIN_MOVE_S); // the second within the combo window
        assert.ok(u.score / recorded(2 * MIN_MOVE_S) < MAX_PER_SEC, `seed ${seed}: ${u.score}`);
      }
    }
  }
});

test('points a second: a greedy player over whole games (combos and all) stays far under the limit', () => {
  for (let seed = 1; seed <= 12; seed++) {
    const s = newGame({ seed });
    let t = 0, idle = 0;
    while (!s.over && t < 3600) {
      const move = greedy(s);
      const move2 = move && greedy(s, t);
      if (move2) { swap(s, ...move2, t); t += MIN_MOVE_S; idle += MIN_MOVE_S; } else { t += 1; idle += 1; }
      while (idle >= waveInterval(s.level) && !s.over) { idle -= waveInterval(s.level); dropWave(s); }
      if (t >= 10) assert.ok(s.score / recorded(t) < MAX_PER_SEC / 4, `seed ${seed}: ${s.score} in ${t}s`);
    }
    assert.ok(s.score <= MAX_POINTS);
  }
});

test('the chain multiplier stops at ×5', () => {
  assert.equal(CHAIN_CAP, 5);
});

// ---------- combos ----------

test('combo: popping moves within the window add up and multiply the move', () => {
  assert.deepEqual([1, 2, 3, 4, 5, 7, 8, 20].map(comboMult), [1, 1.5, 2, 2, 2.5, 2.5, 3, 3]);
  // Two lines of three, each made by dropping the top bird into place.
  const s = board(['..A..C', 'AABCCD']);
  swap(s, [7, 2], [8, 2], 0); // A A A
  assert.equal(s.combo, 1);
  const line = 3 * PER_PIECE;
  assert.equal(s.score, line);
  const steps = swap(s, [7, 5], [8, 5], 2); // C C C, 2 s later
  assert.equal(s.combo, 2);
  const streak = steps.find((x) => x.type === 'streak');
  assert.equal(streak.mult, 1.5);
  assert.equal(streak.extra, Math.round(line * 0.5));
  assert.equal(s.score, line + line + Math.round(line * 0.5));
  assert.ok(comboAlive(s, 2 + COMBO_WINDOW));
  assert.ok(!comboAlive(s, 2 + COMBO_WINDOW + 0.1));
  // A third line, too late: the combo starts again.
  const P = (t) => ({ id: s.nextId++, type: t, special: null, locked: false });
  s.grid[8][0] = P(1); s.grid[8][1] = P(4); s.grid[7][1] = P(1); // B E B, with B at (8,2)
  swap(s, [7, 1], [8, 1], 2 + COMBO_WINDOW + 1);
  assert.equal(s.combo, 1);
  assert.equal(s.bestCombo, 2);
});

test('combo: a move that pops nothing neither adds to the combo nor breaks it', () => {
  const s = board(['..A..C', 'AABCCD']);
  swap(s, [7, 2], [8, 2], 0); // pops
  swap(s, [8, 2], [8, 1], 1); // the B slides into the gap: nothing pops
  assert.equal(s.combo, 1);
  assert.equal(s.lastPopT, 0);
  swap(s, [7, 5], [8, 5], 3); // pops, within the window of the first pop
  assert.equal(s.combo, 2);
});

test('special combos: Mercun Besar, Petir Berganda and Ribut Petir', () => {
  assert.equal(comboKind('petir', 'bom'), 'bom+petir');
  const base = board(['ABCDEF', 'BCDEFA', 'CDEFAB', 'DEFABC', 'EFABCD', 'FABCDE', 'ABCDEF', 'BCDEFA', 'CDEFAB']);
  assert.equal(comboCells(base, 'bom+bom', 4, 2).length, 25);
  assert.equal(comboCells(base, 'bom+bom', 0, 0).length, 9);
  assert.equal(comboCells(base, 'bom+petir', 4, 2).length, 3 * COLS + 3 * ROWS - 9);
  const ribut = comboCells(base, 'petir+petir', 4, 2, [0, 1]);
  assert.ok(ribut.every(([r, c]) => [0, 1].includes(base.grid[r][c].type)));
  assert.equal(ribut.length, 18);
  for (const [a, b, kind] of [['bom', 'bom', 'bom+bom'], ['bom', 'petir', 'bom+petir'], ['petir', 'petir', 'petir+petir']]) {
    const s = board(['ABCDEF', 'BCDEFA', 'CDEFAB'], { specials: { '8,2': a, '8,3': b } });
    const steps = swap(s, [8, 2], [8, 3], 0);
    const clear = steps.find((x) => x.type === 'clear');
    assert.equal(clear.combo, kind);
    assert.ok(clear.points >= SPECIAL_COMBOS[kind].bonus);
    // Both specials are used up.
    assert.ok(!s.grid.flat().some((p) => p?.special));
    assert.equal(s.specialCombos, 1);
  }
});

test('special combos set off other specials they reach', () => {
  const s = board(['DEFABC', 'ABCDEF', 'BCDEFA'], { specials: { '8,0': 'bom', '8,1': 'bom', '6,5': 'petir' } });
  const steps = swap(s, [8, 0], [8, 1], 0);
  const clear = steps.find((x) => x.type === 'clear');
  // 5 × 5 round (8,1) doesn't reach (6,5); try a Petir Berganda instead.
  assert.equal(clear.combo, 'bom+bom');
  const t = board(['DEFABC', 'ABCDEF', 'BCDEFA'], { specials: { '8,0': 'bom', '8,1': 'petir', '6,5': 'petir' } });
  const tsteps = swap(t, [8, 0], [8, 1], 0);
  const tclear = tsteps.find((x) => x.type === 'clear');
  assert.equal(tclear.combo, 'bom+petir');
  // Rows 7–8 and columns 0–2 are cleared outright; (6,5) is on row 6, outside, so it stays…
  assert.ok(!tclear.blasts.some((b) => b.kind === 'petir' && b.r === 6));
  // …but a Mercun Besar next to a Mercun sets it off.
  const u = board(['ABCDEF', 'BCDEFA', 'CDEFAB'], { specials: { '8,0': 'bom', '8,1': 'bom', '7,3': 'bom' } });
  const usteps = swap(u, [8, 0], [8, 1], 0);
  assert.ok(usteps.find((x) => x.type === 'clear').blasts.some((b) => b.kind === 'bom' && b.r === 7 && b.c === 3));
});

// ---------- calling a row early ----------

test('a row called down early earns points for the seconds saved, after a pop since the last row', () => {
  // Nothing popped yet: calling the row down early earns nothing.
  const idle = newGame({ seed: 3 });
  assert.equal(dropWave(idle, 4.3)[0].type, 'drop');
  assert.equal(idle.score >= 0 && !dropWave(idle, 4.3).some((x) => x.type === 'early'), true);
  // After a popping swap it does, once: the next row needs another pop.
  const s = board(['..A..C', 'AABCCD']);
  swap(s, [7, 2], [8, 2], 0); // A A A
  const before = s.score;
  const steps = dropWave(s, 4.3);
  assert.deepEqual(steps[0], { type: 'early', bonus: Math.round(4.3 * EARLY_BONUS_PER_S) });
  assert.ok(s.score >= before + Math.round(4.3 * EARLY_BONUS_PER_S));
  assert.ok(!dropWave(s, 4.3).some((x) => x.type === 'early'));
  // Not early: no bonus step at all.
  assert.equal(dropWave(newGame({ seed: 3 }), 0)[0].type, 'drop');
});

test('calling rows down without playing earns no early points', () => {
  for (let seed = 1; seed <= 20; seed++) {
    const s = newGame({ seed });
    while (!s.over) assert.ok(!dropWave(s, waveInterval(s.level)).some((x) => x.type === 'early'));
  }
});

test('points a second: calling rows down as fast as they fall stays under the limit', () => {
  // Each call takes at least the row's fall (well over MIN_MOVE_S); the whole interval is saved.
  for (let seed = 1; seed <= 20; seed++) {
    const s = newGame({ seed });
    let t = 0;
    while (!s.over) {
      dropWave(s, waveInterval(s.level));
      t += MIN_MOVE_S;
      assert.ok(s.score / recorded(t) < MAX_PER_SEC / 2, `seed ${seed}: ${s.score} in ${t}s`);
    }
  }
});
