import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  LEVELS, OPS, MAX_QUESTIONS, MAX_POINTS, MIN_QUESTION_S, multiplier, tierFor, pointsFor, makeOperands, makeQuestion,
  noCarrySum, noBorrowDiff, swapDigits, mistakes, wrongChoices, newRound, nextQuestion, answer, end, summary, tipFor, dailySeed,
} from '../js/rules.js';
import { mulberry32 } from '../../shared/rng.js';

const eval2 = (a, op, b) => ({ '+': a + b, '−': a - b, '×': a * b, '÷': a / b }[op]);

test('every question is whole, not negative, right, with four different positive choices', () => {
  for (const level of Object.keys(LEVELS)) {
    for (const op of LEVELS[level].ops) {
      for (let tier = 0; tier < 4; tier++) {
        for (let i = 0; i < 150; i++) {
          const q = makeQuestion(`t:${level}`, i, level, op, tier);
          assert.equal(q.answer, eval2(q.a, op, q.b), `${q.a} ${op} ${q.b}`);
          assert.ok(Number.isInteger(q.answer) && q.answer >= 0, `${level} ${q.a} ${op} ${q.b} = ${q.answer}`);
          assert.ok(q.a > 0 && q.b > 0);
          assert.equal(q.choices.length, 4);
          assert.equal(new Set(q.choices).size, 4, `${q.a} ${op} ${q.b}: ${q.choices}`);
          assert.ok(q.choices.includes(q.answer));
          assert.ok(q.choices.every((c) => Number.isInteger(c) && c > 0 || c === q.answer));
        }
      }
    }
  }
});

test('Mudah only adds and subtracts; division is always exact', () => {
  assert.deepEqual(LEVELS.mudah.ops, ['+', '−']);
  for (const level of ['sederhana', 'susah']) {
    for (let i = 0; i < 300; i++) {
      const { a, b, answer: q } = makeOperands(mulberry32(i), level, '÷', i % 4);
      assert.equal(q * b, a);
    }
  }
});

test('numbers grow with the tier', () => {
  const avg = (level, op, tier) => {
    let s = 0;
    for (let i = 0; i < 200; i++) s += makeOperands(mulberry32(i + 1), level, op, tier).answer;
    return s / 200;
  };
  for (const [level, op] of [['mudah', '+'], ['sederhana', '×'], ['susah', '+'], ['susah', '×']]) {
    assert.ok(avg(level, op, 3) > avg(level, op, 0) * 1.5, `${level} ${op}`);
  }
  assert.deepEqual([0, 3, 4, 7, 8, 11, 12, 40].map(tierFor), [0, 0, 1, 1, 2, 2, 3, 3]);
});

// ---------- the wrong choices ----------

test('common mistakes: a missed carry or borrow, swapped digits, off by 10, the wrong operation', () => {
  assert.equal(noCarrySum(47, 38), 75); // 7+8=15, the 1 forgotten
  assert.equal(noCarrySum(147, 285), 322); // 7+5→2, 4+8→2, 1+2=3
  assert.equal(noCarrySum(58, 67), 115); // the last column keeps its 11
  assert.equal(noBorrowDiff(52, 38), 26); // 8−2 instead of borrowing
  assert.equal(noBorrowDiff(304, 127), 223);
  assert.equal(swapDigits(45), 54);
  assert.equal(swapDigits(108), 180); // the last two digits, not 801
  assert.equal(swapDigits(7), 7);
  const add = mistakes({ a: 47, op: '+', b: 38, answer: 85 });
  for (const n of [75, 58, 95, 9]) assert.ok(add.includes(n), `+ includes ${n}`);
  const sub = mistakes({ a: 52, op: '−', b: 38, answer: 14 });
  for (const n of [26, 41, 24, 90]) assert.ok(sub.includes(n), `− includes ${n}`);
  const mul = mistakes({ a: 7, op: '×', b: 8, answer: 56 });
  for (const n of [63, 49, 64, 65, 15]) assert.ok(mul.includes(n), `× includes ${n}`);
  const div = mistakes({ a: 56, op: '÷', b: 8, answer: 7 });
  for (const n of [8, 6, 48]) assert.ok(div.includes(n), `÷ includes ${n}`);
});

test('wrong choices lead with the most telling mistakes', () => {
  const rng = mulberry32(5);
  assert.deepEqual(wrongChoices({ a: 47, op: '+', b: 38, answer: 85 }, rng).slice(0, 2), [75, 58]);
  assert.deepEqual(wrongChoices({ a: 52, op: '−', b: 38, answer: 14 }, rng).slice(0, 2), [26, 41]);
  assert.deepEqual(wrongChoices({ a: 7, op: '×', b: 8, answer: 56 }, rng).slice(0, 2), [63, 49]);
  // No carry needed: that "mistake" is the answer itself, so it's skipped.
  const easy = wrongChoices({ a: 3, op: '+', b: 4, answer: 7 }, rng);
  assert.equal(easy.length, 3);
  assert.ok(!easy.includes(7) && easy.every((n) => n > 0));
});

// ---------- scoring ----------

test('points: the level base, +50% when fast, times the combo', () => {
  assert.deepEqual([0, 1, 2, 4, 5, 7, 8, 30].map(multiplier), [1, 1, 2, 2, 3, 3, 4, 4]);
  assert.equal(pointsFor('mudah', 1, 4), 10);
  assert.equal(pointsFor('mudah', 1, 1), 15);
  assert.equal(pointsFor('sederhana', 2, 4), 30);
  assert.equal(pointsFor('susah', 8, 1), 120);
});

test('a round can never score more than MAX_POINTS (8,000 in arked.sql)', () => {
  // A perfect, instant player in Masa: one question every MIN_QUESTION_S for 60 s, at Susah.
  const r = newRound({ level: 'susah', mode: 'masa', seed: 'max' });
  for (let t = 0; t + MIN_QUESTION_S <= 60; t += MIN_QUESTION_S) answer(r, nextQuestion(r).answer, 0.1);
  assert.ok(r.score <= MAX_POINTS, `${r.score} ≤ ${MAX_POINTS}`);
  assert.ok(MAX_POINTS <= 8000);
  // Points a second stay under arked.sql's 150.
  assert.ok(r.score / 60 <= 150 && MAX_POINTS / (MAX_QUESTIONS * MIN_QUESTION_S) <= 150);
});

// ---------- a round ----------

test('the operations come round evenly, and no sum repeats among the last few', () => {
  const r = newRound({ level: 'susah', seed: 'mix' });
  const ops = [];
  for (let i = 0; i < 40; i++) {
    const q = nextQuestion(r);
    ops.push(q.op);
    answer(r, i % 3 ? q.answer : -1, 3);
  }
  for (let k = 0; k < 40; k += 4) assert.deepEqual(ops.slice(k, k + 4).sort(), [...OPS].sort(), `block ${k}`);
  for (let i = 1; i < r.answered.length; i++) {
    const q = r.answered[i];
    const recent = r.answered.slice(Math.max(0, i - 5), i);
    assert.ok(!recent.some((p) => p.op === q.op && p.a === q.a && p.b === q.b), `repeat at ${i}`);
  }
});

test('a streak raises the tier; a wrong answer drops it back', () => {
  const r = newRound({ level: 'sederhana', seed: 's' });
  for (let i = 0; i < 12; i++) answer(r, nextQuestion(r).answer, 3);
  assert.equal(nextQuestion(r).tier, 3);
  answer(r, -1, 3);
  assert.equal(nextQuestion(r).tier, 0);
});

test('Cabaran Harian: the same date gives the same questions', () => {
  const play = (date) => {
    const r = newRound({ ...{ level: 'sederhana', mode: 'masa' }, seed: dailySeed(date), daily: true });
    const qs = [];
    for (let i = 0; i < 10; i++) { const q = nextQuestion(r); qs.push(`${q.a}${q.op}${q.b}:${q.choices}`); answer(r, q.answer, 2); }
    return qs;
  };
  assert.deepEqual(play('2026-11-25'), play('2026-11-25'));
  assert.notDeepEqual(play('2026-11-25'), play('2026-11-26'));
});

test('Nyawa: each wrong answer snaps a chalk; the third ends the round', () => {
  const r = newRound({ mode: 'nyawa', seed: 'n' });
  answer(r, nextQuestion(r).answer, 2);
  const wrong = () => { nextQuestion(r); return answer(r, -1, 2); };
  wrong();
  wrong();
  assert.deepEqual([r.lives, r.over], [1, false]);
  wrong();
  assert.deepEqual([r.lives, r.over, r.endReason], [0, true, 'lives']);
  const all = newRound({ mode: 'nyawa', seed: 'all' });
  for (let i = 0; i < MAX_QUESTIONS; i++) answer(all, nextQuestion(all).answer, 2);
  assert.deepEqual([all.over, all.endReason], [true, 'all']);
});

test('Masa: wrong answers cost no lives; the round ends when the game says time is up', () => {
  const r = newRound({ mode: 'masa', seed: 'm' });
  for (let i = 0; i < 5; i++) { nextQuestion(r); answer(r, -1, 1); }
  assert.deepEqual([r.over, r.lives, r.answered.length], [false, 3, 5]);
  end(r, 'time');
  assert.deepEqual([r.over, r.endReason], [true, 'time']);
  assert.deepEqual(answer(r, 1, 1), { right: false, points: 0 });
});

test('the summary: accuracy, best combo, average time, accuracy by operation, a tip', () => {
  const r = newRound({ level: 'sederhana', seed: 'sum' });
  r.answered = [
    { a: 7, op: '×', b: 8, answer: 56, given: 63, right: false, seconds: 3, points: 0 },
    { a: 6, op: '×', b: 8, answer: 48, given: 48, right: true, seconds: 2, points: 15 },
    { a: 8, op: '×', b: 7, answer: 56, given: 54, right: false, seconds: 4, points: 0 },
    { a: 20, op: '+', b: 5, answer: 25, given: 25, right: true, seconds: 1, points: 15 },
  ];
  r.bestStreak = 1;
  const s = summary(r);
  assert.deepEqual([s.total, s.right, s.accuracy, s.bestStreak], [4, 2, 50, 1]);
  assert.equal(s.avgSeconds, 2.5);
  assert.deepEqual(s.byOp.map((o) => [o.op, o.pct]), [['+', 100], ['×', 33]]);
  assert.equal(s.missed.length, 2);
  assert.equal(s.tip, '× 33%: latih sifir 7 dan 8.');
  assert.equal(tipFor('÷', [{ a: 56, b: 8 }], 50), '÷ 50%: latih sifir 8.');
  // The tip follows the mistake actually made.
  assert.match(tipFor('+', [{ a: 47, op: '+', b: 38, answer: 85, given: 75 }], 50), /bawa/);
  assert.match(tipFor('+', [{ a: 106, op: '+', b: 113, answer: 219, given: 229 }], 0), /puluh/);
  assert.match(tipFor('−', [{ a: 52, op: '−', b: 38, answer: 14, given: 26 }], 0), /pinjam/);
  assert.match(tipFor('+', [{ a: 20, op: '+', b: 25, answer: 45, given: 54 }], 0), /susunan digit/);
  assert.match(tipFor('−', [{ a: 30, op: '−', b: 12, answer: 18, given: 42 }], 0), /tanda operasi/);
  assert.match(tipFor('+', [{ a: 20, op: '+', b: 5, answer: 25, given: 27 }], 0), /lajur demi lajur/);
  assert.equal(summary(newRound()).tip, null);
});
