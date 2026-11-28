import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLevel, createAttempt, step, solidAt, levelPoints, H } from '../js/road.js';
import { buildGround, rollTraps, tricksFor, LEVEL_COUNT } from '../js/gen.js';
import { mulberry32 } from '../../shared/rng.js';

const AIR = '....................';
const FLAT = {
  name: 'Ujian',
  map: [AIR, AIR, AIR, AIR, AIR, AIR, AIR, AIR, AIR, '.S................E.', '####################', '####################'],
};

const clone = (s) => ({
  ...s,
  grid: s.grid.map((r) => [...r]),
  exit: { ...s.exit },
  traps: s.traps.map((t) => ({ ...t })),
  hazards: s.hazards.map((h) => ({ ...h })),
  debris: [],
  fallen: [],
});

/**
 * Searches for inputs that finish the level: every 0.1 s pick run left/right/stand and jump or
 * not, best-first toward the house. Returns the seconds it took, or null if it found no way.
 */
function solve(level, maxNodes = 250000) {
  const ACTIONS = [];
  for (const dir of [1, 0, -1]) for (const jump of [false, true]) ACTIONS.push({ dir, jump });
  const heap = [];
  // Head for the house, unless a key must be fetched or a closed gate's switch pressed first.
  const goal = (st) => {
    if (st.key) return st.key;
    const sw = st.traps.find((t) => t.def.type === 'suis' && !t.done && st.traps.some((o) => o.def.id === t.def.needs && o.done));
    if (sw) return { x: sw.def.x - 0.5, y: 9 };
    return st.exit;
  };
  const cost = (n) => {
    const g = goal(n.s);
    return Math.abs(n.s.x - g.x) + Math.abs(n.s.y - g.y) * 1.5 + n.s.t * 1.2 + (n.s.key ? 40 : 0);
  };
  const push = (n) => {
    n.c = cost(n);
    heap.push(n);
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heap[p].c <= heap[i].c) break;
      [heap[p], heap[i]] = [heap[i], heap[p]];
      i = p;
    }
  };
  const pop = () => {
    const top = heap[0];
    const last = heap.pop();
    if (heap.length) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < heap.length && heap[l].c < heap[m].c) m = l;
        if (r < heap.length && heap[r].c < heap[m].c) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i], heap[m]];
        i = m;
      }
    }
    return top;
  };
  push({ s: createAttempt(level), prevJump: false });
  const seen = new Set();
  let nodes = 0;
  while (heap.length && nodes < maxNodes) {
    const node = pop();
    nodes++;
    for (const a of ACTIONS) {
      const s = clone(node.s);
      let prev = node.prevJump;
      for (let k = 0; k < 6; k++) {
        step(s, { left: a.dir < 0, right: a.dir > 0, jump: a.jump, jumpPressed: a.jump && !prev });
        prev = a.jump;
        if (s.dead || s.won) break;
      }
      if (s.won) return s.t;
      if (s.dead || s.t > 150) continue;
      const flags = s.traps.map((t) => (t.done ? 2 : t.setAt != null ? 1 : 0)).join('');
      // Only things that move or blink make the time matter (a sagging wire just stays put).
      const moving = s.hazards.some((h) => h.kind !== 'wayar') ? `|${Math.round(s.t * 5)}` : '';
      const key = `${Math.round(s.x * 6)},${Math.round(s.y * 6)},${Math.round(s.vy / 3)},${s.ground},${prev},${flags},${s.exit.x},${Math.ceil(s.dizzy * 5)},${s.locked}${moving}`;
      if (seen.has(key)) continue;
      seen.add(key);
      push({ s, prevJump: prev });
    }
  }
  return null;
}

test('running: the player stands on the road, runs, and stops at the ends', () => {
  const s = createAttempt(parseLevel(FLAT));
  for (let i = 0; i < 30; i++) step(s, {});
  assert.ok(s.ground);
  const y0 = s.y;
  for (let i = 0; i < 30; i++) step(s, { left: true });
  assert.ok(s.x >= 0 && s.x < 0.01, 'stopped at the left end');
  assert.equal(s.y, y0);
  for (let i = 0; i < 30; i++) step(s, { right: true });
  assert.ok(s.x > 2);
});

test('jumping: about three tiles high when held, lower when tapped, and only from the ground', () => {
  const peak = (hold) => {
    const s = createAttempt(parseLevel(FLAT));
    step(s, {});
    const y0 = s.y;
    let top = y0;
    for (let i = 0; i < 60; i++) {
      step(s, { jump: hold || i === 0, jumpPressed: i === 0 });
      top = Math.min(top, s.y);
    }
    return y0 - top;
  };
  const held = peak(true);
  const tapped = peak(false);
  assert.ok(held > 2.7 && held < 3.3, `held ${held}`);
  assert.ok(tapped > 1.4 && tapped < held - 0.5, `tapped ${tapped}`);
});

test('traps: a hole opens, nails pop, a lorry comes, a tree falls into a log; the house wins', () => {
  const level = parseLevel({ ...FLAT, traps: [{ type: 'runtuh', at: [3, 4], tiles: [[6, 10], [6, 11]] }] });
  const s = createAttempt(level);
  let died = null;
  for (let i = 0; i < 300 && !died; i++) for (const e of step(s, { right: true })) if (e.type === 'die') died = e.cause;
  assert.equal(died, 'lubang');
  assert.equal(createAttempt(level).grid[10][6], '#', 'a new attempt has the road back');

  const tree = createAttempt(parseLevel({ ...FLAT, traps: [{ type: 'pokok', at: [0, 30], x: 10, row: 9 }] }));
  for (let i = 0; i < 40; i++) step(tree, {});
  assert.deepEqual([tree.grid[9][10], tree.grid[9][11], tree.grid[9][12]], ['L', 'L', 'L']);
  assert.ok(solidAt(tree, 11, 9));

  const lorry = createAttempt(parseLevel({ ...FLAT, traps: [{ type: 'lori', at: [0, 30], row: 9, from: 'right', speed: 14 }] }));
  let hitBy = null;
  for (let i = 0; i < 120 && !hitBy; i++) for (const e of step(lorry, {})) if (e.type === 'die') hitBy = e.cause;
  assert.equal(hitBy, 'lori', 'standing still, the lorry gets you');

  const w = createAttempt(parseLevel(FLAT));
  w.x = 17.6;
  assert.ok(step(w, {}).some((e) => e.type === 'win'));
});

test('level n has 2n tricks, gets longer, and every trap points inside the map', () => {
  let lastW = 0;
  for (let n = 1; n <= LEVEL_COUNT; n++) {
    const ground = buildGround(n, mulberry32(n));
    assert.equal(ground.sections.length, tricksFor(n));
    assert.ok(ground.w > lastW);
    lastW = ground.w;
    const level = parseLevel(rollTraps(ground, mulberry32(n * 31)));
    assert.equal(level.grid.length, H);
    const main = level.traps.filter((t) => t.type !== 'pintu').length;
    assert.ok(main >= tricksFor(n), `level ${n}: ${main} tricks`);
    for (const t of level.traps) for (const [x, y] of t.tiles ?? []) assert.ok(x >= 0 && x < level.w && y >= 0 && y < H);
  }
  assert.deepEqual([1, 2, 3, 10].map(tricksFor), [2, 4, 6, 20]);
});

test('after a death the tricks are rolled again: different ones, on the same ground', () => {
  const ground = buildGround(3, mulberry32(7));
  const rng = mulberry32(8);
  const first = rollTraps(ground, rng);
  const second = rollTraps(ground, rng);
  assert.deepEqual(first.map, second.map);
  assert.notDeepEqual(first.kinds, second.kinds);
  // Over many rolls, every kind of trick turns up.
  const kinds = new Set();
  for (let i = 0; i < 200; i++) for (const k of rollTraps(buildGround(5, mulberry32(i)), mulberry32(i + 99)).kinds) kinds.add(k);
  assert.ok(kinds.size >= 23, `${kinds.size} kinds`);
});

// A quick check that the early levels can be finished (the later ones are left to the players).
// The trip back for a locked house's key is left out of the search; its spot is checked instead.
for (let n = 1; n <= 2; n++) {
  test(`level ${n}: a random road and tricks can be finished, and a key lies where it can be reached`, () => {
    const def = rollTraps(buildGround(n, mulberry32(1000 * n)), mulberry32(77 * n));
    const level = parseLevel({ ...def, traps: def.traps.filter((t) => t.type !== 'kunci') });
    assert.ok(solve(level) != null, `no way through (${def.kinds.join(', ')})`);
  });
}

test('a locked house: its key sits on open road, bridge or hilltop, 14 to 35 tiles back', () => {
  let keys = 0;
  for (let i = 0; i < 200; i++) {
    const def = rollTraps(buildGround(3, mulberry32(i)), mulberry32(i + 500));
    const lock = def.traps.find((t) => t.type === 'kunci');
    if (!lock) continue;
    keys++;
    const [x, y] = lock.key;
    const level = parseLevel(def);
    assert.equal(level.grid[y][x], '.');
    assert.ok('#HB'.includes(level.grid[y + 1][x]), `the key at ${x},${y} rests on road`);
    assert.ok(level.w - 35 <= x && x <= level.w - 14);
  }
  assert.ok(keys > 60, `${keys} locked houses in 200 levels`);
  // Taking the key unlocks the house.
  const s = createAttempt(parseLevel({ ...FLAT, traps: [{ type: 'kunci', at: [16, 17.5], key: [3, 9] }] }));
  s.x = 16.5;
  step(s, {});
  assert.ok(s.locked);
  s.x = 17.6;
  assert.ok(!step(s, {}).some((e) => e.type === 'win'), 'locked: no way in');
  s.x = 3.2;
  assert.ok(step(s, {}).some((e) => e.type === 'kunciDapat'));
  s.x = 17.6;
  assert.ok(step(s, {}).some((e) => e.type === 'win'));
});

test('points: longer levels are worth more; quicker and fewer deaths score more', () => {
  assert.ok(levelPoints(10, 0, 100) > levelPoints(10, 0, 40));
  assert.ok(levelPoints(10, 0) > levelPoints(20, 0));
  assert.ok(levelPoints(10, 0) > levelPoints(10, 3));
  assert.equal(levelPoints(999, 99), 100);
});
