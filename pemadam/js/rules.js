// Pemadam rules: the desk, the erasers, what counts as a point, whose turn is next and the
// points a match earns. Pure functions on plain poses ({ p, q, v, w }: position, rotation
// quaternion, linear and angular velocity, as Rapier gives them), so they are unit-tested
// (tests/rules.test.mjs) and shared by the live game and the AI's trial flicks (js/physics.js).
//
// The game: each player flicks their own eraser in turn. Landing flat on top of the other
// eraser, and staying there, is a point, and the scorer flicks again from the start. An eraser
// off the desk ends the flick with no point: both go back to the start and the other player
// flicks. Otherwise the erasers stay where they stopped and the turn passes. First to 5 wins.

export const PLAYER = 0;
export const AI = 1;
export const TARGET = 5;

/** A school eraser in desk units: 1.3 × 0.28 × 0.85, with rounded edges (radius r). */
export const ERASER = { w: 1.3, h: 0.28, d: 0.85, r: 0.05 };
/** The desk top: centred on 0, half-sizes hx × hz, its surface at y = top. */
export const DESK = { hx: 4.7, hz: 3.25, top: 0.21 };
/** Where the erasers start: the player's near the camera (+z), the AI's across the desk. */
export const START = [{ x: 0, z: 1.65 }, { x: 0, z: -1.65 }];
export const REST_Y = DESK.top + ERASER.h / 2 + 0.005;

/**
 * The props on the desk, solid in the physics: a pencil case along the left edge and a pencil
 * lying near the right. x, z: centre; yaw: turn about the vertical (radians).
 */
export const PROPS = {
  pencilCase: { x: -3.8, z: -1.2, yaw: 0.12, w: 0.9, h: 0.46, d: 2.6 },
  pencil: { x: 3.55, z: 1.45, yaw: -0.55, length: 2.5, r: 0.085 },
};

/**
 * Flick styles. Kuat: a hard flick that hops high and tumbles, to land on top. Lembut: a soft
 * one that skims low and slides, to creep up close. Speeds in desk units a second at power 0
 * and the extra at full power; spin in radians a second.
 */
export const STYLES = {
  kuat: { name: 'Kuat', speed: [2.6, 7.2], lift: [2.0, 3.6], spin: [5, 11] },
  lembut: { name: 'Lembut', speed: [1.6, 7], lift: [0.6, 1.0], spin: [1, 2.5] },
};

/** The flick a style and power (0–1) give, along the unit direction (dx, dz) on the desk. */
export function flickVelocity(dx, dz, power, style = 'kuat') {
  const s = STYLES[style] ?? STYLES.kuat;
  const p = Math.max(0, Math.min(1, power));
  const speed = s.speed[0] + p * s.speed[1];
  const spin = s.spin[0] + p * s.spin[1];
  // Tumbling forwards: about the horizontal axis square to the flick, top edge leading.
  return {
    v: { x: dx * speed, y: s.lift[0] + p * s.lift[1], z: dz * speed },
    w: { x: dz * spin, y: 0, z: -dx * spin },
  };
}

/**
 * AI levels: how many flicks it tries out in the physics before choosing (Mudah tries none and
 * aims roughly), and how far its actual flick strays from the one it chose (aim in radians,
 * power as a fraction). max: the points a win at that level earns at most.
 */
export const LEVELS = {
  mudah: { name: 'Mudah', tries: 0, aim: 0.3, power: 0.22, max: 100 },
  sederhana: { name: 'Sederhana', tries: 10, aim: 0.12, power: 0.1, max: 400 },
  susah: { name: 'Susah', tries: 24, aim: 0.05, power: 0.05, max: 700 },
  pakar: { name: 'Pakar', tries: 80, aim: 0.015, power: 0.02, max: 1000 },
};

// ---------- geometry ----------

/** Rotates vector v by unit quaternion q. */
export function rotate(q, v) {
  const { x, y, z, w } = q;
  // t = 2 (q.xyz × v); v' = v + w t + q.xyz × t
  const tx = 2 * (y * v.z - z * v.y);
  const ty = 2 * (z * v.x - x * v.z);
  const tz = 2 * (x * v.y - y * v.x);
  return {
    x: v.x + w * tx + (y * tz - z * ty),
    y: v.y + w * ty + (z * tx - x * tz),
    z: v.z + w * tz + (x * ty - y * tx),
  };
}

const HALF = [ERASER.w / 2, ERASER.h / 2, ERASER.d / 2];
const UNIT = [{ x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: 1 }];
/** The eraser's three local axes in the world. */
export const axes = (q) => UNIT.map((u) => rotate(q, u));

/** How far the eraser reaches below its centre (half its height in the world's vertical). */
export function faceSupport(q) {
  return axes(q).reduce((sum, a, i) => sum + Math.abs(a.y) * HALF[i], 0);
}

/** How flat the eraser lies on some face: 1 when a face is level, less when tilted. */
export const flatness = (q) => Math.max(...axes(q).map((a) => Math.abs(a.y)));
/** Lying on its broad face (flag up or down), not on a side or an end. */
export const onBroadFace = (q) => Math.abs(axes(q)[1].y) > 0.84;

/** The eraser's outline seen from above: the face nearest level, as 4 corners on the desk (x, z). */
export function footprint(pose) {
  const ax = axes(pose.q);
  const up = ax.reduce((best, a, i) => (Math.abs(a.y) > Math.abs(ax[best].y) ? i : best), 0);
  const [i, j] = [0, 1, 2].filter((k) => k !== up);
  const a = { x: ax[i].x * HALF[i], z: ax[i].z * HALF[i] };
  const b = { x: ax[j].x * HALF[j], z: ax[j].z * HALF[j] };
  const c = pose.p;
  return [[1, 1], [-1, 1], [-1, -1], [1, -1]].map(([s, t]) => ({ x: c.x + s * a.x + t * b.x, z: c.z + s * a.z + t * b.z }));
}

/** Signed area of a polygon of { x, z } points (positive when anticlockwise in x→z). */
export function polygonArea(poly) {
  let s = 0;
  for (let k = 0; k < poly.length; k++) {
    const p = poly[k], n = poly[(k + 1) % poly.length];
    s += p.x * n.z - n.x * p.z;
  }
  return s / 2;
}

/** The overlap of two convex polygons (Sutherland–Hodgman clipping). */
export function clipPolygon(subject, clip) {
  const dir = Math.sign(polygonArea(clip)) || 1;
  let out = subject;
  for (let k = 0; k < clip.length && out.length; k++) {
    const a = clip[k], b = clip[(k + 1) % clip.length];
    const inside = (p) => dir * ((b.x - a.x) * (p.z - a.z) - (b.z - a.z) * (p.x - a.x)) >= 0;
    const cross = (p, q) => {
      const d1 = (b.x - a.x) * (p.z - a.z) - (b.z - a.z) * (p.x - a.x);
      const d2 = (b.x - a.x) * (q.z - a.z) - (b.z - a.z) * (q.x - a.x);
      const t = d1 / (d1 - d2);
      return { x: p.x + (q.x - p.x) * t, z: p.z + (q.z - p.z) * t };
    };
    const input = out;
    out = [];
    for (let m = 0; m < input.length; m++) {
      const p = input[m], q = input[(m + 1) % input.length];
      if (inside(q)) {
        if (!inside(p)) out.push(cross(p, q));
        out.push(q);
      } else if (inside(p)) out.push(cross(p, q));
    }
  }
  return out;
}

export const overlapArea = (a, b) => {
  const poly = clipPolygon(footprint(a), footprint(b));
  return poly.length < 3 ? 0 : Math.abs(polygonArea(poly));
};

const speed = (v) => Math.hypot(v.x, v.y, v.z);

/** Off the desk: past its edge, or fallen below it. */
export const isOut = (pose) => Math.abs(pose.p.x) > DESK.hx + 0.2 || Math.abs(pose.p.z) > DESK.hz + 0.23 || pose.p.y < -0.8;

/** Nearly still. */
export const isResting = (pose) => speed(pose.v) < 0.12 && speed(pose.w) < 0.25;

/**
 * `top` lies flat on `bottom`: above it, its underside on the other's upper face (not leaning
 * on its edge), their outlines overlapping, both lying on a face and both slow.
 */
export function restsOnTop(top, bottom) {
  const a = top.p, b = bottom.p;
  if (a.y < b.y + 0.15) return false;
  const gap = (a.y - faceSupport(top.q)) - (b.y + faceSupport(bottom.q));
  if (gap < -0.11 || gap > 0.17) return false;
  if (flatness(top.q) < 0.84 || flatness(bottom.q) < 0.84) return false;
  if (speed(top.v) > 0.9 || speed(top.w) > 1.25 || speed(bottom.v) > 0.9 || speed(bottom.w) > 1.25) return false;
  return overlapArea(top, bottom) > 0.1;
}

/** Standing on a side or an end (or propped up) on the desk, rather than lying on its broad face. */
export const standingUp = (pose) => !onBroadFace(pose.q);

// ---------- one flick, judged step by step ----------

export const HOLD_S = 0.25; // on top this long to count
const REST_S = 0.35; // both still this long to end the flick
const MIN_S = 0.6; // no flick ends sooner
const MAX_S = 9; // nor later
const MAX_TIPS = 3;

/**
 * Judges one flick by `shooter` from the poses after each physics step. update() returns null
 * while it plays, then one of:
 *   { kind: 'point', scorer }  an eraser stayed on top of the other for HOLD_S
 *   { kind: 'out', who }       an eraser left the desk
 *   { kind: 'tip', who }       both are still but `who` stands on a side: give it a nudge so it
 *                              falls over (the physics decides which face it lands on)
 *   { kind: 'rest' }           both still: the turn passes
 */
export function createReferee(shooter) {
  let clock = 0, held = 0, still = 0, tips = 0, scorer = -1;
  return {
    get clock() { return clock; },
    update(poses, dt) {
      clock += dt;
      for (let i = 0; i < 2; i++) if (isOut(poses[i])) return { kind: 'out', who: i };
      const other = 1 - shooter;
      const now = restsOnTop(poses[shooter], poses[other]) ? shooter : restsOnTop(poses[other], poses[shooter]) ? other : -1;
      if (now >= 0 && now === scorer) held += dt;
      else held = now >= 0 ? dt : 0;
      scorer = now;
      if (scorer >= 0 && held >= HOLD_S) return { kind: 'point', scorer };
      if (scorer < 0 && isResting(poses[0]) && isResting(poses[1])) still += dt;
      else still = 0;
      if ((clock > MIN_S && still >= REST_S) || clock > MAX_S) {
        const who = [shooter, other].find((i) => standingUp(poses[i]));
        if (who !== undefined && tips < MAX_TIPS && clock <= MAX_S) {
          tips++;
          still = 0;
          return { kind: 'tip', who };
        }
        return { kind: 'rest' };
      }
      return null;
    },
  };
}

// ---------- the match ----------

export function newMatch(turn = PLAYER) {
  return { score: [0, 0], turn, over: false, winner: -1, flicks: [0, 0] };
}

/**
 * Applies a flick's outcome to the match. Returns whether both erasers go back to the start.
 * A point: the scorer's score goes up and the scorer flicks next. Out: the other player
 * flicks. Rest: the turn passes.
 */
export function applyOutcome(m, shooter, outcome) {
  m.flicks[shooter]++;
  if (outcome.kind === 'point') {
    m.score[outcome.scorer]++;
    m.turn = outcome.scorer;
    if (m.score[outcome.scorer] >= TARGET) { m.over = true; m.winner = outcome.scorer; }
    return true;
  }
  m.turn = 1 - shooter;
  return outcome.kind === 'out';
}

/** A win earns the level's maximum, less a tenth for each point the AI got; a loss earns 0. */
export function roundPoints(m, level) {
  const { max } = LEVELS[level] ?? LEVELS.mudah;
  if (!m.over || m.winner !== PLAYER) return 0;
  return Math.round(max * (1 - 0.1 * m.score[AI]));
}

/** The direction (unit, on the desk) and distance from one pose to another. */
export function aimAt(from, to) {
  const dx = to.p.x - from.p.x, dz = to.p.z - from.p.z;
  const dist = Math.hypot(dx, dz) || 1;
  return { dx: dx / dist, dz: dz / dist, dist };
}

/** Starting pose of player i's eraser: flat, flag up, long side across the desk. */
export const startPose = (i) => ({
  p: { x: START[i].x, y: REST_Y, z: START[i].z },
  q: { x: 0, y: 0, z: 0, w: 1 },
  v: { x: 0, y: 0, z: 0 },
  w: { x: 0, y: 0, z: 0 },
});
