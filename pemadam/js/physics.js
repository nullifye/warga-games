// Pemadam physics: the desk, its props and the two erasers in Rapier (vendor/rapier.es.js, the
// build with the WebAssembly inside), stepped at a fixed 120 Hz so a flick plays out the same on
// any screen. The AI tries its flicks out in a copy of the world (planFlick), judged by the same
// referee as the real game (rules.js).
import {
  ERASER, DESK, PROPS, LEVELS, STYLES, startPose, flickVelocity, createReferee, aimAt, isResting, axes,
} from './rules.js';

export const STEP = 1 / 120;
const GRAVITY = -17;

let R = null;
/** Loads Rapier once (about 2.4 MB of script, then its WebAssembly is compiled). */
export async function loadPhysics() {
  if (R) return R;
  const mod = await import('../vendor/rapier.es.js');
  await mod.init();
  R = mod;
  return R;
}

const yawQuat = (yaw) => ({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) });
const mul = (a, b) => ({
  w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
  y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
  z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
});

/**
 * A world with the desk, the props and both erasers at `poses` (default: the start). It moves
 * in fixed steps (stepOnce); stepsFor(dt) says how many a frame of dt makes. Impacts, for the
 * sound, are sudden changes of an eraser's speed: { who, n, slide } in desk units a second.
 */
export function createWorld(rapier = R, poses = [startPose(0), startPose(1)]) {
  const world = new rapier.World({ x: 0, y: GRAVITY, z: 0 });
  world.timestep = STEP;
  const fixed = (desc, collider) => world.createCollider(collider, world.createRigidBody(desc));
  // The desk: a slab whose top is at DESK.top.
  fixed(rapier.RigidBodyDesc.fixed().setTranslation(0, DESK.top - 0.04, 0),
    rapier.ColliderDesc.cuboid(DESK.hx, 0.04, DESK.hz).setFriction(0.84).setRestitution(0.07));
  const pc = PROPS.pencilCase;
  fixed(rapier.RigidBodyDesc.fixed().setTranslation(pc.x, DESK.top + pc.h / 2, pc.z).setRotation(yawQuat(pc.yaw)),
    rapier.ColliderDesc.roundCuboid(pc.w / 2 - 0.08, pc.h / 2 - 0.08, pc.d / 2 - 0.08, 0.08).setFriction(0.6).setRestitution(0.2));
  const pn = PROPS.pencil;
  // A cylinder stands on its local y; turn it to lie along x, then by the pencil's yaw.
  const lie = { x: 0, y: 0, z: Math.sin(Math.PI / 4), w: Math.cos(Math.PI / 4) };
  fixed(rapier.RigidBodyDesc.fixed().setTranslation(pn.x, DESK.top + pn.r, pn.z).setRotation(mul(yawQuat(pn.yaw), lie)),
    rapier.ColliderDesc.cylinder(pn.length / 2, pn.r).setFriction(0.5).setRestitution(0.25));

  const r = ERASER.r;
  const bodies = poses.map((pose) => {
    const body = world.createRigidBody(rapier.RigidBodyDesc.dynamic()
      .setTranslation(pose.p.x, pose.p.y, pose.p.z)
      .setRotation(pose.q)
      .setLinvel(pose.v.x, pose.v.y, pose.v.z)
      .setAngvel(pose.w)
      .setLinearDamping(0.65)
      .setAngularDamping(0.95)
      .setCcdEnabled(true));
    // Soft rubber: rounded edges, grippy, hardly bouncy.
    world.createCollider(rapier.ColliderDesc.roundCuboid(ERASER.w / 2 - r, ERASER.h / 2 - r, ERASER.d / 2 - r, r)
      .setDensity(1.2).setFriction(0.78).setRestitution(0.16), body);
    return body;
  });

  let carry = 0;
  const last = bodies.map((b) => b.linvel());
  const pose = (b) => ({ p: b.translation(), q: b.rotation(), v: b.linvel(), w: b.angvel() });
  const api = {
    world,
    bodies,
    poses: () => bodies.map(pose),
    setPoses(list) {
      list.forEach((ps, i) => {
        const b = bodies[i];
        b.setTranslation(ps.p, true);
        b.setRotation(ps.q, true);
        b.setLinvel(ps.v, true);
        b.setAngvel(ps.w, true);
        last[i] = ps.v;
      });
    },
    reset() { api.setPoses([startPose(0), startPose(1)]); carry = 0; },
    /** Flicks eraser i along the unit direction (dx, dz). */
    flick(i, dx, dz, power, style) {
      const { v, w } = flickVelocity(dx, dz, power, style);
      bodies[i].setLinvel(v, true);
      bodies[i].setAngvel(w, true);
      last[i] = v;
    },
    /**
     * Tips an eraser that stands on a side: a push that turns it about the edge it leans
     * towards, so it falls flat (flag up or down, as it falls).
     */
    tip(i) {
      const b = bodies[i];
      const y = axes(b.rotation())[1]; // the broad face's normal, nearly level when standing up
      const h = Math.hypot(y.x, y.z) || 1;
      // Turn about the level axis square to the face normal; the side the face already looks
      // up or down decides the way (a tiny lean is enough).
      const sign = y.y >= 0 ? 1 : -1;
      const k = { x: (-y.z / h) * sign, z: (y.x / h) * sign };
      b.setLinvel({ x: 0, y: 0.9, z: 0 }, true);
      b.setAngvel({ x: k.x * 3.4, y: 0, z: k.z * 3.4 }, true);
    },
    /** One fixed step; impacts (sudden changes of speed) go into `hits` as { who, n, slide }. */
    stepOnce(hits = null) {
      world.step();
      bodies.forEach((b, i) => {
        const v = b.linvel();
        const jolt = Math.hypot(v.x - last[i].x, v.y - last[i].y, v.z - last[i].z);
        if (hits && jolt > 1.2) hits.push({ who: i, n: jolt, slide: Math.hypot(v.x, v.z) });
        last[i] = v;
      });
    },
    /** How many fixed steps dt makes, with the remainder carried to the next call (at most 12). */
    stepsFor(dt) {
      carry = Math.min(carry + dt, 12 * STEP);
      const n = Math.floor(carry / STEP + 1e-9);
      carry = Math.max(0, carry - n * STEP);
      return n;
    },
    free() { world.free(); },
  };
  return api;
}

/**
 * Plays one flick out in a fresh world from `poses` and judges it. Returns the outcome
 * ({ kind, scorer?, who? }) and the poses it ends with.
 */
export function simulate(poses, shooter, shot, rapier = R) {
  const sim = createWorld(rapier, poses);
  try {
    sim.flick(shooter, shot.dx, shot.dz, shot.power, shot.style);
    const ref = createReferee(shooter);
    for (;;) {
      sim.stepOnce();
      const now = sim.poses();
      const out = ref.update(now, STEP);
      if (!out) continue;
      if (out.kind === 'tip') { sim.tip(out.who); continue; }
      return { outcome: out, poses: now };
    }
  } finally {
    sim.free();
  }
}

/** How good an outcome is for `shooter` (higher is better). */
export function scoreOutcome(res, shooter) {
  const { outcome, poses } = res;
  if (outcome.kind === 'point') return outcome.scorer === shooter ? 100 : -100;
  if (outcome.kind === 'out') return -40;
  // The turn passes: better to end close behind the other eraser (for the next hop on top),
  // but not so close it can hop on you, and away from the desk's edges.
  const me = poses[shooter].p, them = poses[1 - shooter].p;
  const d = Math.hypot(me.x - them.x, me.z - them.z);
  const edge = Math.min(DESK.hx - Math.abs(me.x), DESK.hz - Math.abs(me.z));
  return -Math.abs(d - 2.4) * 6 - (edge < 0.8 ? (0.8 - edge) * 20 : 0);
}

/**
 * The AI's flick from `poses`. Mudah aims straight at the player's eraser with a guessed power.
 * The others try LEVELS[level].tries flicks (directions about the straight line, powers, both
 * styles) in the physics and keep the best; then `rand` (0–1) adds the level's error. Runs in
 * slices (await between them) so the page stays smooth while it thinks.
 */
export async function planFlick(poses, shooter, level, rand = Math.random, { rapier = R, yieldEvery = 4 } = {}) {
  const L = LEVELS[level] ?? LEVELS.mudah;
  const target = aimAt(poses[shooter], poses[1 - shooter]);
  const base = Math.atan2(target.dz, target.dx);
  // A rough guess at the power that carries the distance, for Mudah and as the search's centre.
  const guess = Math.max(0.15, Math.min(1, (target.dist - 1.2) / 3.6));
  let best = { angle: base, power: guess, style: 'kuat' };
  if (L.tries > 0) {
    let bestScore = -Infinity;
    const tries = [];
    for (let k = 0; k < L.tries; k++) {
      // A spread of angles (wider for later tries) and powers round the guess; every fourth soft.
      const spread = ((k % 7) - 3) / 3;
      const angle = base + spread * 0.18 * (0.4 + rand());
      const power = Math.max(0.05, Math.min(1, guess + (rand() - 0.5) * 0.6));
      tries.push({ angle, power, style: k % 4 === 3 ? 'lembut' : 'kuat' });
    }
    tries.unshift(best);
    for (let k = 0; k < tries.length; k++) {
      const t = tries[k];
      const res = simulate(poses, shooter, { dx: Math.cos(t.angle), dz: Math.sin(t.angle), power: t.power, style: t.style }, rapier);
      const s = scoreOutcome(res, shooter);
      if (s > bestScore) { bestScore = s; best = t; }
      if (bestScore >= 100) break;
      if (yieldEvery && k % yieldEvery === yieldEvery - 1) await new Promise((r) => setTimeout(r, 0));
    }
  }
  // The level's error: a slightly different direction and power from the one chosen.
  const angle = best.angle + (rand() * 2 - 1) * L.aim;
  const power = Math.max(0.05, Math.min(1, best.power * (1 + (rand() * 2 - 1) * L.power)));
  return { dx: Math.cos(angle), dz: Math.sin(angle), power, style: best.style };
}

export { isResting, STYLES };
