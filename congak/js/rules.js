// Congak Matematik rules: the questions, their wrong choices, the score and a round. Pure
// functions on plain state with an injected random-number generator, so they are unit-tested
// (tests/rules.test.mjs) and Cabaran Harian gives everyone the same questions.
//
// A round: a question at a time, four choices. Masa: as many as you can in 60 s. Nyawa: three
// sticks of chalk, one snaps at each wrong answer; the round ends with the last one, or after
// MAX_QUESTIONS. The numbers grow with your streak (four tiers per level) and the operations come
// round in turn, shuffled, so the mix stays even.
import { mulberry32, hashString } from '../../shared/rng.js';

export const OPS = ['+', '−', '×', '÷'];

/**
 * Levels. ops: the operations asked. base: points for a right answer before the bonus and the
 * combo. Each level's numbers by tier (0–3, up with the streak) are in makeOperands.
 */
export const LEVELS = {
  mudah: { name: 'Mudah', ops: ['+', '−'], base: 10, hint: 'Tambah dan tolak' },
  sederhana: { name: 'Sederhana', ops: ['+', '−', '×', '÷'], base: 15, hint: 'Dua digit, sifir hingga 12' },
  susah: { name: 'Susah', ops: ['+', '−', '×', '÷'], base: 20, hint: 'Nombor besar, empat operasi' },
};

export const MODES = {
  masa: { name: 'Masa', seconds: 60 },
  nyawa: { name: 'Nyawa', lives: 3 },
};

/** Cabaran Harian: one 60 s round at Sederhana, the same questions for everyone that day. */
export const DAILY = { level: 'sederhana', mode: 'masa' };

export const MAX_QUESTIONS = 60; // a Nyawa round ends here at the latest
export const FAST_S = 2.5; // answered sooner: +50% of the base
/** Each question shows for at least this long: written out (answers locked), then the feedback. */
export const MIN_QUESTION_S = 0.9;

/** The combo: ×2 from 2 right in a row, ×3 from 5, ×4 from 8. */
export function multiplier(streak) {
  return streak >= 8 ? 4 : streak >= 5 ? 3 : streak >= 2 ? 2 : 1;
}

/** Bigger numbers as the streak grows: tier 0 to 3, up one every 4 right in a row. */
export const tierFor = (streak) => Math.min(3, Math.floor(streak / 4));

/** Points for a right answer: the level's base (+50% if fast), times the combo. */
export function pointsFor(level, streak, seconds) {
  const base = (LEVELS[level] ?? LEVELS.mudah).base;
  return Math.round((base + (seconds < FAST_S ? base / 2 : 0)) * multiplier(streak));
}

/** The most a round can score: every question right and fast at ×4, as fast as allowed. */
export const MAX_ROUND_QUESTIONS = Math.max(MAX_QUESTIONS, Math.floor(MODES.masa.seconds / MIN_QUESTION_S));
export const MAX_POINTS = MAX_ROUND_QUESTIONS * Math.max(...Object.values(LEVELS).map((l) => l.base * 1.5 * 4));

// ---------- questions ----------

const int = (rng, lo, hi) => lo + Math.floor(rng() * (hi - lo + 1));

/** The numbers for `op` at a level and tier: { a, b, answer }, always whole and not negative. */
export function makeOperands(rng, level, op, tier) {
  const t = Math.max(0, Math.min(3, tier));
  if (level === 'mudah') {
    const top = [10, 20, 30, 50][t];
    if (op === '+') { const a = int(rng, 1, top - 1); const b = int(rng, 1, top - a); return { a, b, answer: a + b }; }
    const a = int(rng, 3, top); const b = int(rng, 1, a - 1); return { a, b, answer: a - b };
  }
  if (level === 'sederhana') {
    if (op === '+') { const hi = [40, 60, 80, 99][t]; const a = int(rng, 11, hi); const b = int(rng, 11, hi); return { a, b, answer: a + b }; }
    if (op === '−') { const hi = [50, 70, 90, 99][t]; const a = int(rng, 20, hi); const b = int(rng, 11, a - 2); return { a, b, answer: a - b }; }
    const table = [6, 9, 12, 12][t];
    const x = int(rng, 2, table), y = int(rng, t >= 3 ? 6 : 2, table);
    if (op === '×') return { a: x, b: y, answer: x * y };
    return { a: x * y, b: y, answer: x }; // ÷: an exact table fact backwards
  }
  // susah
  if (op === '+') { const lo = [40, 100, 150, 250][t], hi = [150, 300, 500, 900][t]; const a = int(rng, lo, hi); const b = int(rng, lo / 2, hi); return { a, b, answer: a + b }; }
  if (op === '−') { const hi = [200, 400, 700, 999][t]; const a = int(rng, 60, hi); const b = int(rng, 20, a - 10); return { a, b, answer: a - b }; }
  if (op === '×') {
    const [aLo, aHi, bHi] = [[11, 19, 9], [12, 25, 12], [13, 30, 15], [15, 40, 19]][t];
    const a = int(rng, aLo, aHi), b = int(rng, 3, bHi);
    return { a, b, answer: a * b };
  }
  const d = int(rng, [3, 4, 6, 7][t], [9, 12, 15, 19][t]), q = int(rng, [6, 8, 11, 12][t], [15, 20, 25, 30][t]);
  return { a: d * q, b: d, answer: q };
}

const digits = (n) => String(n).split('').map(Number);
/** a + b added column by column without carrying: 47 + 38 → 75. */
export function noCarrySum(a, b) {
  const da = digits(a).reverse(), db = digits(b).reverse();
  let out = 0;
  for (let i = 0, p = 1; i < Math.max(da.length, db.length); i++, p *= 10) {
    const s = (da[i] ?? 0) + (db[i] ?? 0);
    out += (i < Math.max(da.length, db.length) - 1 ? s % 10 : s) * p;
  }
  return out;
}
/** a − b taken column by column, the smaller digit from the larger (no borrowing): 52 − 38 → 26. */
export function noBorrowDiff(a, b) {
  const da = digits(a).reverse(), db = digits(b).reverse();
  let out = 0;
  for (let i = 0, p = 1; i < da.length; i++, p *= 10) out += Math.abs(da[i] - (db[i] ?? 0)) * p;
  return out;
}
/** The answer's last two digits swapped, the usual slip: 45 → 54, 108 → 180. */
export function swapDigits(n) {
  const d = String(n);
  return d.length < 2 ? n : Number(d.slice(0, -2) + d[d.length - 1] + d[d.length - 2]);
}

/**
 * The common mistakes for a question, most telling first: a missed carry or borrow, the
 * answer's digits swapped, off by 10, the wrong operation, one row out in the times table, one
 * out. Duplicates and impossible values are dropped later.
 */
export function mistakes({ a, op, b, answer }) {
  const list = [];
  if (op === '+') list.push(noCarrySum(a, b), answer >= 10 ? swapDigits(answer) : null, answer + 10, answer - 10, a - b, answer + 1, answer - 1);
  if (op === '−') list.push(noBorrowDiff(a, b), answer >= 10 ? swapDigits(answer) : null, answer + 10, answer - 10, a + b, answer + 1, answer - 1);
  if (op === '×') list.push(a * (b + 1), a * (b - 1), (a + 1) * b, answer >= 10 ? swapDigits(answer) : null, a + b, answer + 10, answer - 10);
  if (op === '÷') list.push(answer + 1, answer - 1, answer >= 10 ? swapDigits(answer) : null, a - b, answer + 2, answer + 10, b);
  return list.filter((n) => n !== null);
}

/**
 * Three wrong choices from the common mistakes (the first two always, the third at random from
 * the rest), topped up with numbers close by if too few are usable. All different, positive and
 * not the answer.
 */
export function wrongChoices(q, rng) {
  const ok = (n, taken) => Number.isInteger(n) && n > 0 && n !== q.answer && !taken.includes(n);
  const pool = [];
  for (const n of mistakes(q)) if (ok(n, pool)) pool.push(n);
  const picked = pool.slice(0, 2);
  const rest = pool.slice(2);
  while (picked.length < 3 && rest.length) picked.push(rest.splice(Math.floor(rng() * rest.length), 1)[0]);
  for (const d of [2, -2, 3, -3, 5, -5, 11, -11, 20]) if (picked.length < 3 && ok(q.answer + d, picked)) picked.push(q.answer + d);
  return picked;
}

const shuffled = (arr, rng) => {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
};

/** Question number `index` of a round with `seed`: the same seed, index, op and tier give the same question. */
export function makeQuestion(seed, index, level, op, tier, attempt = 0) {
  const rng = mulberry32(hashString(`${seed}:${index}:${attempt}`));
  const { a, b, answer } = makeOperands(rng, level, op, tier);
  const q = { a, op, b, answer, tier };
  q.choices = shuffled([answer, ...wrongChoices(q, rng)], rng);
  return q;
}

// ---------- a round ----------

/** A new round. seed: a number or string (Cabaran Harian: the date). */
export function newRound({ level = 'mudah', mode = 'masa', seed = 1, daily = false } = {}) {
  return {
    level, mode, seed: String(seed), daily,
    index: 0, score: 0, streak: 0, bestStreak: 0, lives: MODES.nyawa.lives,
    answered: [], // { a, op, b, answer, given, right, seconds, points }
    bag: [], // operations still to come before the mix repeats
    over: false, endReason: null, question: null,
  };
}

/**
 * The next question: the next operation from a shuffled bag of the level's operations, at the
 * tier the streak earns, never the same sum (or answer) as one of the last few.
 */
export function nextQuestion(r) {
  const rng = mulberry32(hashString(`${r.seed}:bag:${r.index}`));
  if (!r.bag.length) r.bag = shuffled(LEVELS[r.level].ops, rng);
  const op = r.bag.shift();
  const recent = r.answered.slice(-5);
  let q;
  for (let attempt = 0; attempt < 12; attempt++) {
    q = makeQuestion(r.seed, r.index, r.level, op, tierFor(r.streak), attempt);
    const last = r.answered[r.answered.length - 1];
    const repeat = recent.some((p) => p.op === q.op && ((p.a === q.a && p.b === q.b) || (q.op !== '−' && q.op !== '÷' && p.a === q.b && p.b === q.a)));
    if (!repeat && q.answer !== last?.answer) break;
  }
  r.question = q;
  return q;
}

/**
 * Answers the current question with `given` after `seconds`. Returns { right, points }. A wrong
 * answer resets the streak and, in Nyawa, snaps a chalk (the round ends with the last one).
 */
export function answer(r, given, seconds) {
  const q = r.question;
  if (!q || r.over) return { right: false, points: 0 };
  const right = given === q.answer;
  let points = 0;
  if (right) {
    r.streak++;
    r.bestStreak = Math.max(r.bestStreak, r.streak);
    points = pointsFor(r.level, r.streak, seconds);
    r.score += points;
  } else {
    r.streak = 0;
    if (r.mode === 'nyawa') r.lives--;
  }
  r.answered.push({ a: q.a, op: q.op, b: q.b, answer: q.answer, given, right, seconds, points });
  r.index++;
  r.question = null;
  if (r.mode === 'nyawa' && r.lives <= 0) end(r, 'lives');
  else if (r.mode === 'nyawa' && r.index >= MAX_QUESTIONS) end(r, 'all');
  return { right, points };
}

/** Ends the round: 'time' (Masa), 'lives', 'all' (MAX_QUESTIONS) or 'quit'. */
export function end(r, reason) {
  if (r.over) return;
  r.over = true;
  r.endReason = reason;
  r.question = null;
}

const SIGN_NAME = { '+': 'tambah', '−': 'tolak', '×': 'darab', '÷': 'bahagi' };

/**
 * What the round shows afterwards: accuracy, best combo, the average time per answer, accuracy
 * by operation, the wrong answers, and a practice tip for the weakest operation.
 */
export function summary(r) {
  const n = r.answered.length;
  const right = r.answered.filter((x) => x.right).length;
  const byOp = OPS.filter((op) => r.answered.some((x) => x.op === op)).map((op) => {
    const all = r.answered.filter((x) => x.op === op);
    const ok = all.filter((x) => x.right).length;
    return { op, total: all.length, right: ok, pct: Math.round((ok / all.length) * 100) };
  });
  const weakest = byOp.filter((o) => o.right < o.total).sort((x, y) => x.pct - y.pct || y.total - x.total)[0] ?? null;
  return {
    score: r.score,
    total: n,
    right,
    accuracy: n ? Math.round((right / n) * 100) : 0,
    bestStreak: r.bestStreak,
    avgSeconds: n ? r.answered.reduce((s, x) => s + x.seconds, 0) / n : 0,
    byOp,
    missed: r.answered.filter((x) => !x.right),
    tip: weakest ? tipFor(weakest.op, r.answered.filter((x) => x.op === weakest.op && !x.right), weakest.pct) : null,
  };
}

/**
 * Which common mistake a wrong answer looks like: 'carry' (+ without carrying), 'borrow'
 * (− without borrowing), 'tens' (out by 10 or 100), 'swap' (the last two digits swapped),
 * 'op' (the wrong operation), or null.
 */
export function mistakeKind({ a, op, b, answer: ans, given }) {
  if (op === '+' && given === noCarrySum(a, b) && given !== ans) return 'carry';
  if (op === '−' && given === noBorrowDiff(a, b) && given !== ans) return 'borrow';
  if (Math.abs(given - ans) === 10 || Math.abs(given - ans) === 100) return 'tens';
  if (ans >= 10 && given === swapDigits(ans) && given !== ans) return 'swap';
  const other = { '+': a - b, '−': a + b, '×': a + b, '÷': a - b }[op];
  if (given === other) return 'op';
  return null;
}

const TIP = {
  carry: 'ingat bawa (simpan) ke lajur seterusnya.',
  borrow: 'ingat pinjam dari lajur sebelah.',
  tens: 'semak lajur puluh: jawapan anda lebih atau kurang 10.',
  swap: 'jaga susunan digit (cth. 45, bukan 54).',
  op: 'baca tanda operasi dengan teliti.',
};

/**
 * "× 60%: latih sifir 7 dan 8": the operation, its accuracy and what to practise. For × and ÷
 * the tables behind the misses; otherwise the mistake made most often (a missed carry, out by
 * 10, …), or plain practice if the misses don't share one.
 */
export function tipFor(op, missed, pct) {
  const head = `${op} ${pct}%`;
  if (op === '×' || op === '÷') {
    // The tables behind the misses (for ÷, the divisor's), most missed first.
    const count = new Map();
    for (const m of missed) for (const t of op === '×' ? [m.a, m.b] : [m.b]) if (t <= 12) count.set(t, (count.get(t) ?? 0) + 1);
    const tables = [...count].sort((x, y) => y[1] - x[1] || x[0] - y[0]).slice(0, 2).map(([t]) => t).sort((x, y) => x - y);
    if (tables.length) return `${head}: latih sifir ${tables.join(' dan ')}.`;
  }
  const kinds = new Map();
  for (const m of missed) { const k = m.given == null ? null : mistakeKind(m); if (k) kinds.set(k, (kinds.get(k) ?? 0) + 1); }
  const top = [...kinds].sort((x, y) => y[1] - x[1])[0]?.[0];
  if (top) return `${head}: ${TIP[top]}`;
  return `${head}: latih ${SIGN_NAME[op]} dengan mengira lajur demi lajur.`;
}

/** The questions' seed for Cabaran Harian on a date (YYYY-MM-DD). */
export const dailySeed = (date) => `congak:${date}`;
