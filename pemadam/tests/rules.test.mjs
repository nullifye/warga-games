import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PLAYER, AI, TARGET, ERASER, DESK, REST_Y, LEVELS, rotate, faceSupport, footprint, polygonArea, overlapArea,
  restsOnTop, isOut, standingUp, createReferee, HOLD_S, newMatch, applyOutcome, roundPoints, flickVelocity, startPose,
} from '../js/rules.js';
import { loadPhysics, createWorld, simulate, planFlick, STEP } from '../js/physics.js';

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);
const ZERO = { x: 0, y: 0, z: 0 };
const about = (axis, angle) => ({ x: axis.x * Math.sin(angle / 2), y: axis.y * Math.sin(angle / 2), z: axis.z * Math.sin(angle / 2), w: Math.cos(angle / 2) });
const pose = (x, y, z, q = { x: 0, y: 0, z: 0, w: 1 }, v = ZERO, w = ZERO) => ({ p: { x, y, z }, q, v, w });
const ON_TOP_Y = REST_Y + ERASER.h; // flat on another flat eraser
/** A seeded random number generator (0–1), so physics tests repeat exactly. */
const seeded = (seed) => () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

// ---------- geometry ----------

test('rotate turns vectors by a quaternion', () => {
  const v = rotate(about({ x: 0, y: 1, z: 0 }, Math.PI / 2), { x: 1, y: 0, z: 0 });
  close(v.x, 0, 1e-12); close(v.y, 0); close(v.z, -1, 1e-12);
  const same = rotate({ x: 0, y: 0, z: 0, w: 1 }, { x: 1, y: 2, z: 3 });
  assert.deepEqual(same, { x: 1, y: 2, z: 3 });
});

test('an eraser reaches half its height below its centre when flat, half its depth on its side', () => {
  close(faceSupport({ x: 0, y: 0, z: 0, w: 1 }), ERASER.h / 2);
  close(faceSupport(about({ x: 1, y: 0, z: 0 }, Math.PI / 2)), ERASER.d / 2, 1e-12);
  close(faceSupport(about({ x: 0, y: 0, z: 1 }, Math.PI / 2)), ERASER.w / 2, 1e-12);
});

test('footprints: a flat eraser covers w × d; two overlap by the shared part', () => {
  close(Math.abs(polygonArea(footprint(pose(0, 0, 0)))), ERASER.w * ERASER.d, 1e-12);
  close(overlapArea(pose(0, 0, 0), pose(0, 1, 0)), ERASER.w * ERASER.d, 1e-12);
  close(overlapArea(pose(0, 0, 0), pose(ERASER.w / 2, 1, 0)), (ERASER.w / 2) * ERASER.d, 1e-9);
  close(overlapArea(pose(0, 0, 0), pose(3, 1, 0)), 0);
  // Turned a quarter, a square of d × d is shared.
  close(overlapArea(pose(0, 0, 0), pose(0, 1, 0, about({ x: 0, y: 1, z: 0 }, Math.PI / 2))), ERASER.d * ERASER.d, 1e-9);
});

// ---------- what counts ----------

test('flat on top of the other eraser counts; beside it, tilted, moving or barely touching does not', () => {
  const bottom = pose(0, REST_Y, 0);
  assert.equal(restsOnTop(pose(0.2, ON_TOP_Y, 0.1), bottom), true);
  assert.equal(restsOnTop(pose(0.2, ON_TOP_Y, 0.1, about({ x: 0, y: 0, z: 1 }, Math.PI)), bottom), true, 'flag down still counts');
  assert.equal(restsOnTop(bottom, pose(0.2, ON_TOP_Y, 0.1)), false, 'the lower one is not on top');
  assert.equal(restsOnTop(pose(1.4, REST_Y, 0), bottom), false, 'side by side');
  assert.equal(restsOnTop(pose(0.2, ON_TOP_Y + 0.1, 0, about({ x: 1, y: 0, z: 0 }, 0.7)), bottom), false, 'leaning');
  assert.equal(restsOnTop(pose(0.2, ON_TOP_Y, 0, undefined, { x: 2, y: 0, z: 0 }), bottom), false, 'still sliding');
  assert.equal(restsOnTop(pose(1.27, ON_TOP_Y, 0.8), bottom), false, 'a corner barely overlapping');
  assert.equal(restsOnTop(pose(0.2, ON_TOP_Y + 0.5, 0), bottom), false, 'in the air above it');
});

test('off the desk: past an edge or fallen below it', () => {
  assert.equal(isOut(pose(0, REST_Y, 0)), false);
  assert.equal(isOut(pose(DESK.hx + 0.5, REST_Y, 0)), true);
  assert.equal(isOut(pose(0, REST_Y, -(DESK.hz + 0.5))), true);
  assert.equal(isOut(pose(0, -1, 0)), true);
});

test('standing up: on a side or an end, not on the broad face', () => {
  assert.equal(standingUp(pose(0, REST_Y, 0)), false);
  assert.equal(standingUp(pose(0, 0.6, 0, about({ x: 1, y: 0, z: 0 }, Math.PI / 2))), true);
  assert.equal(standingUp(pose(0, 0.9, 0, about({ x: 0, y: 0, z: 1 }, Math.PI / 2))), true);
});

// ---------- the referee ----------

/** Feeds the same poses to a referee for `seconds`; returns its first verdict and when. */
function judge(ref, poses, seconds) {
  for (let t = 0; t < seconds; t += STEP) {
    const out = ref.update(poses, STEP);
    if (out) return { ...out, at: ref.clock };
  }
  return null;
}

test('a point once an eraser has stayed on top for HOLD_S, for whoever is on top', () => {
  const stacked = [pose(0, ON_TOP_Y, 0), pose(0.1, REST_Y, 0)];
  const out = judge(createReferee(PLAYER), stacked, 2);
  assert.equal(out.kind, 'point');
  assert.equal(out.scorer, PLAYER);
  assert.ok(out.at >= HOLD_S && out.at < HOLD_S + 0.05);
  // The AI flicked, but ended up underneath: the player scores.
  assert.equal(judge(createReferee(AI), stacked, 2).scorer, PLAYER);
});

test('an eraser off the desk ends the flick at once', () => {
  const out = judge(createReferee(PLAYER), [pose(0, -2, 0), pose(0, REST_Y, -1.65)], 1);
  assert.deepEqual([out.kind, out.who], ['out', PLAYER]);
  assert.ok(out.at < 0.02);
});

test('both still and flat: the flick ends, not before 0.6 s', () => {
  const out = judge(createReferee(PLAYER), [startPose(0), startPose(1)], 3);
  assert.equal(out.kind, 'rest');
  assert.ok(out.at > 0.6);
});

test('a still eraser on its side is tipped (at most 3 times), then the flick ends', () => {
  const ref = createReferee(PLAYER);
  const side = [pose(0, 0.6, 0, about({ x: 1, y: 0, z: 0 }, Math.PI / 2)), startPose(1)];
  const kinds = [];
  for (let k = 0; k < 4; k++) kinds.push(judge(ref, side, 5));
  assert.deepEqual(kinds.map((o) => o.kind), ['tip', 'tip', 'tip', 'rest']);
  assert.equal(kinds[0].who, PLAYER);
});

// ---------- the match ----------

test('a point: the scorer goes up, flicks again, and both go back to the start', () => {
  const m = newMatch(PLAYER);
  assert.equal(applyOutcome(m, PLAYER, { kind: 'point', scorer: PLAYER }), true);
  assert.deepEqual([m.score, m.turn], [[1, 0], PLAYER]);
  // The AI flicks and lands under the player's eraser: still the player's point and turn.
  m.turn = AI;
  assert.equal(applyOutcome(m, AI, { kind: 'point', scorer: PLAYER }), true);
  assert.deepEqual([m.score, m.turn], [[2, 0], PLAYER]);
});

test('off the desk: no point, back to the start, the other player flicks; at rest the turn just passes', () => {
  const m = newMatch(AI);
  assert.equal(applyOutcome(m, AI, { kind: 'out', who: AI }), true);
  assert.deepEqual([m.score, m.turn], [[0, 0], PLAYER]);
  assert.equal(applyOutcome(m, PLAYER, { kind: 'rest' }), false);
  assert.equal(m.turn, AI);
  assert.deepEqual(m.flicks, [1, 1]);
});

test(`first to ${TARGET} wins`, () => {
  const m = newMatch(PLAYER);
  for (let k = 0; k < TARGET - 1; k++) applyOutcome(m, AI, { kind: 'point', scorer: AI });
  assert.equal(m.over, false);
  for (let k = 0; k < TARGET; k++) applyOutcome(m, PLAYER, { kind: 'point', scorer: PLAYER });
  assert.deepEqual([m.over, m.winner, m.score], [true, PLAYER, [TARGET, TARGET - 1]]);
});

test('points: a win earns the level maximum less a tenth per AI point; a loss earns nothing', () => {
  const won = (ai) => ({ ...newMatch(), over: true, winner: PLAYER, score: [TARGET, ai] });
  assert.equal(roundPoints(won(0), 'pakar'), LEVELS.pakar.max);
  assert.equal(roundPoints(won(3), 'susah'), Math.round(LEVELS.susah.max * 0.7));
  assert.equal(roundPoints(won(4), 'mudah'), Math.round(LEVELS.mudah.max * 0.6));
  assert.equal(roundPoints({ ...newMatch(), over: true, winner: AI, score: [2, TARGET] }, 'pakar'), 0);
  assert.equal(roundPoints(newMatch(), 'pakar'), 0, 'unfinished');
  // The most a round can earn, for arked.sql's limit.
  assert.equal(Math.max(...Object.values(LEVELS).map((l) => l.max)), 1000);
});

test('flicks: along the direction, harder with power; a soft one stays lower', () => {
  const weak = flickVelocity(0, -1, 0.2, 'kuat'), hard = flickVelocity(0, -1, 0.9, 'kuat');
  assert.ok(hard.v.z < weak.v.z && weak.v.z < 0);
  close(hard.v.x, 0);
  assert.ok(hard.v.y > weak.v.y);
  assert.ok(flickVelocity(0, -1, 0.9, 'lembut').v.y < hard.v.y);
  // Tumbles forward: about -x when flicked towards -z.
  assert.ok(hard.w.x < 0);
});

// ---------- in the physics (Rapier, vendor/rapier.es.js) ----------

async function rapier() {
  const warn = console.warn;
  console.warn = () => {}; // Rapier's loader warns about its own (internal) init call
  try { return await loadPhysics(); } finally { console.warn = warn; }
}

test('physics: a hard straight flick from the start can land on top of the other eraser', async () => {
  const R = await rapier();
  const start = [startPose(0), startPose(1)];
  const points = [];
  for (let p = 0.4; p <= 0.85; p += 0.05) {
    const { outcome } = simulate(start, PLAYER, { dx: 0, dz: -1, power: p, style: 'kuat' }, R);
    if (outcome.kind === 'point') points.push(p);
    assert.notEqual(outcome.kind, 'tip');
  }
  assert.ok(points.length > 0, 'some power scores');
  // A soft flick at low power only slides forward and stays on the desk.
  const soft = simulate(start, PLAYER, { dx: 0, dz: -1, power: 0.3, style: 'lembut' }, R);
  assert.equal(soft.outcome.kind, 'rest');
  assert.ok(soft.poses[PLAYER].p.z < start[PLAYER].p.z);
});

test('physics: an eraser standing on its side falls flat by itself', async () => {
  const R = await rapier();
  const world = createWorld(R, [pose(0, DESK.top + ERASER.d / 2 + 0.01, 1.65, about({ x: 1, y: 0, z: 0 }, Math.PI / 2)), startPose(1)]);
  const ref = createReferee(PLAYER);
  let out = null;
  for (let t = 0; t < 8 && !out; t += STEP) {
    world.stepOnce();
    out = ref.update(world.poses(), STEP);
    if (out?.kind === 'tip') { world.tip(out.who); out = null; }
  }
  assert.equal(out?.kind, 'rest');
  assert.equal(standingUp(world.poses()[PLAYER]), false);
  world.free();
});

test('physics: the AI lands on top more often at higher levels', async () => {
  const R = await rapier();
  const rate = async (level) => {
    const rand = seeded(11);
    let points = 0;
    for (let k = 0; k < 12; k++) {
      const poses = [startPose(0), startPose(1)];
      const shot = await planFlick(poses, AI, level, rand, { rapier: R, yieldEvery: 0 });
      const { outcome } = simulate(poses, AI, shot, R);
      if (outcome.kind === 'point' && outcome.scorer === AI) points++;
    }
    return points;
  };
  const mudah = await rate('mudah'), pakar = await rate('pakar');
  assert.ok(pakar > mudah, `pakar ${pakar} > mudah ${mudah}`);
  assert.ok(pakar >= 6, `pakar scores at least half the time (${pakar}/12)`);
});
