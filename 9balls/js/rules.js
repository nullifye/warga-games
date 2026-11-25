// 9-Ball: the table, the rack, the physics, the rules and the AI. Pure functions on plain ball
// objects ({ id, x, y, vx, vy, pocketed }), so they are unit-tested (tests/rules.test.mjs); the
// page (js/main.js) runs them and js/render.js draws them.
//
// Units: table pixels, and velocities in pixels per tick. The page runs `tick` at a fixed 60 a
// second whatever the screen's refresh rate, so a shot plays out the same on a 60 Hz or 120 Hz
// phone (the original ran it once per animation frame).
//
// Physics, as on a real table: each ball has a velocity (vx, vy) and a spin, kept as the speed
// its bottom would roll at (sx, sy; equal to the velocity when it rolls naturally). Struck in
// the middle, a ball first slides; cloth friction slows it and spins it up until it rolls, at
// 5/7 of the speed. Rolling, it slows steadily (plus a little drag) and stops. Balls trade speed
// along the line of centres but keep their spin, so a sliding cue ball stops dead on a full hit
// (a stun) while a rolling one follows through. Cushions return most of the speed across them,
// grip a little along them, and the spin that carried a ball in briefly checks its rebound.
// (rollX, rollY) adds up how far the ball's surface has turned, for drawing it rolling.

// ---------- the table: upright, in the proportions of a real 7 ft (bar) table ----------
// The playing area is exactly twice as long as it is wide (as on every real table: 39 × 78 in on
// a 7 ft one), and a ball's diameter (2¼ in, 57.15 mm) is 5.8% of that width. The pockets are a
// touch generous for a phone screen: corner mouths about 2.1 balls across, side ones 1.95.
export const TABLE_WIDTH_IN = 39; // the playing area's width, in inches (7 ft table)
export const TABLE_W = 500;
export const RAIL = 38;
export const TABLE_H = 2 * (TABLE_W - 2 * RAIL) + 2 * RAIL; // 924: a 424 × 848 playing area
export const PLAY_LEFT = RAIL;
export const PLAY_RIGHT = TABLE_W - RAIL;
export const PLAY_TOP = RAIL;
export const PLAY_BOTTOM = TABLE_H - RAIL;
export const PLAY_W = PLAY_RIGHT - PLAY_LEFT;
export const PLAY_H = PLAY_BOTTOM - PLAY_TOP;
export const BALL_R = ((TABLE_W - 2 * RAIL) * (57.15 / (TABLE_WIDTH_IN * 25.4))) / 2; // ≈ 12.2
export const CORNER_POCKET_R = BALL_R * 2.1;
export const SIDE_POCKET_R = BALL_R * 1.95;
/** How far from a pocket the cushions open up (its jaws). */
const CORNER_JAW = CORNER_POCKET_R - 4;
const SIDE_JAW = SIDE_POCKET_R - 4;
export const TICKS_PER_SECOND = 60;
/** Fastest shot, at full power (pixels a tick). */
export const MAX_SPEED = 26;
/** Speed = MAX_SPEED × power^POWER_CURVE: each step of the gauge adds about as much distance. */
export const POWER_CURVE = 0.7;
/** The rack's spot (a quarter of the way down) and the head string, behind which the break is played. */
export const TOP_SPOT = { x: TABLE_W / 2, y: PLAY_TOP + PLAY_H * 0.26 };
export const HEAD_STRING_Y = PLAY_TOP + PLAY_H * 0.75;
export const CUE_START = { x: TABLE_W / 2, y: HEAD_STRING_Y + 12 };

/** 4 corner pockets and 2 at the middle of the long sides. */
export const POCKETS = [
  { x: PLAY_LEFT + 3, y: PLAY_TOP + 3, r: CORNER_POCKET_R },
  { x: PLAY_RIGHT - 3, y: PLAY_TOP + 3, r: CORNER_POCKET_R },
  { x: PLAY_LEFT - 3, y: TABLE_H / 2, r: SIDE_POCKET_R },
  { x: PLAY_RIGHT + 3, y: TABLE_H / 2, r: SIDE_POCKET_R },
  { x: PLAY_LEFT + 3, y: PLAY_BOTTOM - 3, r: CORNER_POCKET_R },
  { x: PLAY_RIGHT - 3, y: PLAY_BOTTOM - 3, r: CORNER_POCKET_R },
];

const SUBSTEPS = 8;
const SLIDE = 0.15; // sliding friction: speed lost per tick while sliding (μ·g)
const ROLL = 0.025; // rolling resistance: speed lost per tick while rolling
const DRAG = 0.01; // and a little more, in proportion to the speed
const CUSHION = 0.8; // speed kept across a cushion
const CUSHION_GRIP = 0.95; // and along it
const CUSHION_SPIN = 0.4; // spin kept into the cushion: it briefly checks the rebound
const BALL_BOUNCE = 0.95;
// Spin from striking off-centre (english). `spin` {x, y} is the cue tip's place on the ball, as a
// fraction of the furthest a cue can strike without miscuing: MAX_TIP of the ball's radius.
export const MAX_TIP = 0.6;
const SQUIRT = 0.035; // side spin pushes the cue ball this much (radians per unit) off the aim
const SIDE_SPIN = 0.8; // side spin's strength, against the shot's speed
const SIDE_BITE = 0.35; // how much of it a cushion turns into sideways speed
const SIDE_DECAY = 0.992 ** (1 / 8); // per substep: the cloth slowly takes side spin off
const STOP_SPEED = 0.04;

export const AI_LEVELS = {
  // jitter: aim error (radians, either way); bonus: points for beating it; simulate: test the
  // best few shots with the physics before choosing.
  // safety: how many shots it tries when playing safe (0: never plays safe, always goes for it).
  mudah: { name: 'Mudah', jitter: 0.07, bonus: 200, simulate: false, placeCue: false, safety: 0 },
  sederhana: { name: 'Sederhana', jitter: 0.03, bonus: 500, simulate: false, placeCue: true, safety: 12 },
  susah: { name: 'Susah', jitter: 0.008, bonus: 900, simulate: true, placeCue: true, safety: 30 },
};
export const POINTS_PER_BALL = 100;

const ball = (id, x, y) => ({ id, x, y, vx: 0, vy: 0, sx: 0, sy: 0, ez: 0, rollX: 0, rollY: 0, twist: 0, pocketed: false });
export const cloneBalls = (balls) => balls.map((b) => ({ ...b }));
export const cueBall = (balls) => balls.find((b) => b.id === 0);
/** The lowest-numbered ball still on the table: the one to hit first. */
export function lowestBall(balls) {
  let low = null;
  for (const b of balls) if (b.id > 0 && !b.pocketed && (!low || b.id < low.id)) low = b;
  return low;
}
export const moving = (balls) => balls.some((b) => !b.pocketed && (b.vx !== 0 || b.vy !== 0 || b.sx || b.sy));

/** A new rack: the cue ball behind the head string, the 1 at the front of the diamond, the 9 in its middle. */
export function rack(random = Math.random) {
  const balls = [ball(0, CUE_START.x, CUE_START.y)];
  const r = BALL_R + 0.4, dy = r * Math.sqrt(3);
  const others = [2, 3, 4, 5, 6, 7, 8];
  for (let i = others.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [others[i], others[j]] = [others[j], others[i]];
  }
  // Rows from the front (towards the cue ball) back: 1, 2, 3, 2, 1.
  const spots = [[0, 0, 1], [-1, -1], [-1, 1], [-2, -2], [-2, 0, 9], [-2, 2], [-3, -1], [-3, 1], [-4, 0]];
  let k = 0;
  for (const [row, col, id] of spots) balls.push(ball(id ?? others[k++], TOP_SPOT.x + col * r, TOP_SPOT.y + row * dy));
  return balls;
}

/** A new shot's record, filled in by `tick`: what the cue ball hit first, what went in, any rail after contact. */
export const newShot = (balls) => ({ firstHit: null, pocketed: [], railAfterContact: false, lowestBefore: lowestBall(balls)?.id ?? null });

/**
 * Strikes the cue ball at `angle` with `power` (0–1), the tip at `spin` {x, y} on the ball
 * (each −1…1 of the reach, MAX_TIP of the radius; x right, y up as the player sees it).
 *   Centre: no spin, it slides at first.
 *   High (y > 0): topspin, it follows through after a hit (y ≈ 0.67 is a natural roll).
 *   Low (y < 0): backspin, it draws back after a full hit.
 *   Side (x): english, which turns its rebound off a cushion, and squirts it slightly off line.
 */
export function strike(balls, angle, power, spin = { x: 0, y: 0 }) {
  const cue = cueBall(balls);
  const speed = Math.max(0, Math.min(1, power)) ** POWER_CURVE * MAX_SPEED;
  const side = (spin.x || 0) * MAX_TIP, height = (spin.y || 0) * MAX_TIP;
  const a = angle - side * SQUIRT;
  cue.vx = Math.cos(a) * speed;
  cue.vy = Math.sin(a) * speed;
  // A hit at height h above the centre gives a spin of (5/2)·h/R of the speed (as surface speed).
  cue.sx = height ? cue.vx * 2.5 * height : 0;
  cue.sy = height ? cue.vy * 2.5 * height : 0;
  cue.ez = side * speed * SIDE_SPIN;
}

function nearestPocket(x, y) {
  let best = POCKETS[0], dist = Infinity;
  for (const p of POCKETS) {
    const d = Math.hypot(x - p.x, y - p.y);
    if (d < dist) { dist = d; best = p; }
  }
  return { pocket: best, dist };
}

function sink(b, shot, events) {
  b.pocketed = true;
  b.vx = 0;
  b.vy = 0;
  b.sx = 0;
  b.sy = 0;
  b.ez = 0;
  shot.pocketed.push(b.id);
  events.push({ type: 'pocket', id: b.id });
}

/**
 * Moves every ball one tick (1/60 s) in 8 substeps: cushions, ball-to-ball hits, pockets and
 * cloth friction (sliding, then rolling). Updates `shot`; returns sound events: { type: 'ball' | 'rail', speed } and
 * { type: 'pocket', id }.
 */
export function tick(balls, shot) {
  const events = [];
  const R = BALL_R;
  const h = 1 / SUBSTEPS;
  for (const b of balls) { b.sx ??= 0; b.sy ??= 0; b.ez ??= 0; b.rollX ??= 0; b.rollY ??= 0; b.twist ??= 0; }
  for (let step = 0; step < SUBSTEPS; step++) {
    // 1. Move, and bounce off the cushions (they open up at the pockets).
    for (const b of balls) {
      if (b.pocketed) continue;
      b.x += b.vx * h;
      b.y += b.vy * h;
      b.rollX += b.sx * h;
      b.rollY += b.sy * h;
      b.twist += (b.ez * h) / R; // side spin turns it about the upright axis
      b.ez *= SIDE_DECAY;
      const nearCornerY = b.y < PLAY_TOP + CORNER_JAW || b.y > PLAY_BOTTOM - CORNER_JAW;
      const nearSideY = Math.abs(b.y - TABLE_H / 2) < SIDE_JAW;
      if (!nearCornerY && !nearSideY) {
        // (Only a ball moving into a cushion bounces off it; one touching it on the way out doesn't.)
        if (b.x - R < PLAY_LEFT) { b.x = PLAY_LEFT + R; if (b.vx < 0) cushionX(b); }
        else if (b.x + R > PLAY_RIGHT) { b.x = PLAY_RIGHT - R; if (b.vx > 0) cushionX(b); }
      }
      const nearCornerX = b.x < PLAY_LEFT + CORNER_JAW || b.x > PLAY_RIGHT - CORNER_JAW;
      if (!nearCornerX) {
        if (b.y - R < PLAY_TOP) { b.y = PLAY_TOP + R; if (b.vy < 0) cushionY(b); }
        else if (b.y + R > PLAY_BOTTOM) { b.y = PLAY_BOTTOM - R; if (b.vy > 0) cushionY(b); }
      }
    }
    // 2. Ball-to-ball: push apart, then exchange speed along the line between them.
    for (let i = 0; i < balls.length; i++) {
      const a = balls[i];
      if (a.pocketed) continue;
      for (let j = i + 1; j < balls.length; j++) {
        const b = balls[j];
        if (b.pocketed) continue;
        const dx = b.x - a.x, dy = b.y - a.y, dist = Math.hypot(dx, dy);
        if (dist <= 0 || dist >= R * 2) continue;
        if (shot.firstHit === null) {
          if (a.id === 0) shot.firstHit = b.id;
          else if (b.id === 0) shot.firstHit = a.id;
        }
        const nx = dx / dist, ny = dy / dist, overlap = (R * 2 - dist) / 2;
        a.x -= nx * overlap; a.y -= ny * overlap;
        b.x += nx * overlap; b.y += ny * overlap;
        const along = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
        if (along < 0) {
          const impulse = (-(1 + BALL_BOUNCE) * along) / 2;
          a.vx -= impulse * nx; a.vy -= impulse * ny;
          b.vx += impulse * nx; b.vy += impulse * ny;
          events.push({ type: 'ball', speed: Math.abs(along) });
        }
      }
    }
    // 3. Pockets. A ball that has slipped past the cushions where they open (in a pocket's jaw)
    // drops into the nearest pocket, or goes back onto the table: no ball can leave the table.
    for (const b of balls) {
      if (b.pocketed) continue;
      let sunk = false;
      for (const p of POCKETS) {
        if (Math.hypot(b.x - p.x, b.y - p.y) < p.r - 2) { sink(b, shot, events); sunk = true; break; }
      }
      if (sunk) continue;
      const slack = R * 0.9;
      if (b.x < PLAY_LEFT + R - slack || b.x > PLAY_RIGHT - R + slack || b.y < PLAY_TOP + R - slack || b.y > PLAY_BOTTOM - R + slack) {
        const { pocket, dist } = nearestPocket(b.x, b.y);
        if (dist < pocket.r + R) { sink(b, shot, events); continue; }
        if (b.x < PLAY_LEFT + R) { b.x = PLAY_LEFT + R; b.vx = Math.abs(b.vx) * CUSHION; b.sx *= CUSHION_SPIN; }
        if (b.x > PLAY_RIGHT - R) { b.x = PLAY_RIGHT - R; b.vx = -Math.abs(b.vx) * CUSHION; b.sx *= CUSHION_SPIN; }
        if (b.y < PLAY_TOP + R) { b.y = PLAY_TOP + R; b.vy = Math.abs(b.vy) * CUSHION; b.sy *= CUSHION_SPIN; }
        if (b.y > PLAY_BOTTOM - R) { b.y = PLAY_BOTTOM - R; b.vy = -Math.abs(b.vy) * CUSHION; b.sy *= CUSHION_SPIN; }
      }
    }
    // 4. Cloth friction. While the ball slides (its spin doesn't match its speed), friction
    // against the slip slows it and spins it up, until it rolls: the slip closes 7/2 times as
    // fast as the speed changes, and the ball then moves at speed − 2/7 of the slip. Rolling, it
    // slows steadily.
    for (const b of balls) {
      if (b.pocketed) continue;
      const ux = b.vx - b.sx, uy = b.vy - b.sy, slip = Math.hypot(ux, uy);
      if (slip > 1e-3) {
        if (3.5 * SLIDE * h >= slip) {
          b.vx -= (ux * 2) / 7;
          b.vy -= (uy * 2) / 7;
          b.sx = b.vx;
          b.sy = b.vy;
        } else {
          const k = (SLIDE * h) / slip;
          b.vx -= ux * k;
          b.vy -= uy * k;
          b.sx += 2.5 * ux * k;
          b.sy += 2.5 * uy * k;
        }
      } else {
        const v = Math.hypot(b.vx, b.vy);
        const nv = Math.max(0, v - ROLL * h - DRAG * h * v);
        if (v > 0) { b.vx *= nv / v; b.vy *= nv / v; }
        b.sx = b.vx;
        b.sy = b.vy;
      }
      if (Math.hypot(b.vx, b.vy) < STOP_SPEED && Math.hypot(b.sx, b.sy) < STOP_SPEED) {
        b.vx = 0; b.vy = 0; b.sx = 0; b.sy = 0; b.ez = 0;
      }
    }
  }
  return events;

  function rail(v) {
    if (shot.firstHit !== null) shot.railAfterContact = true;
    events.push({ type: 'rail', speed: Math.abs(v) });
  }
  // Off a side cushion (x) or an end one (y): speed across it reversed and reduced, a little
  // grip along it, and the spin into it partly kept (so the ball checks as it comes off). Side
  // spin grips the cushion and throws the ball along it: right english (struck right of centre)
  // sends it off to the right of the way it came in; each cushion takes half the spin.
  function english(b) {
    const v = Math.hypot(b.vx, b.vy);
    if (!b.ez || !v) return [0, 0];
    const k = b.ez * SIDE_BITE;
    b.ez *= 0.5;
    return [(-b.vy / v) * k, (b.vx / v) * k]; // the incoming direction, turned to its right
  }
  function cushionX(b) {
    b.vy += english(b)[1];
    b.vx = -b.vx * CUSHION;
    b.vy *= CUSHION_GRIP;
    b.sx *= CUSHION_SPIN;
    b.sy *= CUSHION_GRIP;
    rail(b.vx);
  }
  function cushionY(b) {
    b.vx += english(b)[0];
    b.vy = -b.vy * CUSHION;
    b.vx *= CUSHION_GRIP;
    b.sy *= CUSHION_SPIN;
    b.sx *= CUSHION_GRIP;
    rail(b.vy);
  }
}

export const FOUL_TEXT = {
  scratch: 'Bola putih masuk lubang.',
  miss: 'Bola putih tidak kena mana-mana bola.',
  wrong: (n, hit) => `Mesti kena bola ${n} dahulu (terkena bola ${hit}).`,
  rail: 'Tiada bola masuk dan tiada bola kena kusyen.',
};

/** After this many fouls in a row by one player, they lose the rack (a warning comes one before). */
export const FOULS_TO_LOSE = 3;

/**
 * The official 9-ball verdict on a finished shot:
 *   foul    'scratch' | 'miss' | 'wrong' | 'rail' | null
 *   potted  object balls that count (none on a foul)
 *   win     the 9 went in on a legal shot (a "golden break" when it was the break)
 *   respotNine  the 9 went in on a foul: it goes back on the spot
 *   keepTurn    a legal shot that potted something
 *   push        a push-out (`shot.pushOut`): allowed on the shot after the break. The cue ball
 *               needn't hit the lowest ball or a cushion; only a scratch is a foul; nothing
 *               potted counts (a 9 is re-spotted); the opponent then plays or hands it back.
 */
export function judge(shot, isBreak = false) {
  const cue = shot.pocketed.includes(0);
  const nine = shot.pocketed.includes(9);
  const objects = shot.pocketed.filter((id) => id !== 0);
  if (shot.pushOut) {
    return { foul: cue ? 'scratch' : null, potted: [], win: false, golden: false, respotNine: nine, keepTurn: false, push: true };
  }
  let foul = null;
  if (cue) foul = 'scratch';
  else if (shot.firstHit === null) foul = 'miss';
  else if (shot.lowestBefore !== null && shot.firstHit !== shot.lowestBefore) foul = 'wrong';
  else if (!objects.length && !shot.railAfterContact) foul = 'rail';
  return {
    foul,
    potted: foul ? [] : objects,
    win: nine && !foul,
    golden: nine && !foul && isBreak,
    respotNine: nine && Boolean(foul),
    keepTurn: !foul && objects.length > 0,
    push: false,
  };
}

export function foulText(shot, foul) {
  return foul === 'wrong' ? FOUL_TEXT.wrong(shot.lowestBefore, shot.firstHit) : FOUL_TEXT[foul];
}

/** Puts `b` back on the rack's spot, or the nearest free place above it. */
export function spotBall(balls, b) {
  b.pocketed = false;
  b.vx = 0;
  b.vy = 0;
  b.sx = 0;
  b.sy = 0;
  b.ez = 0;
  let y = TOP_SPOT.y;
  const clash = (yy) => balls.some((o) => o !== b && !o.pocketed && Math.hypot(o.x - TOP_SPOT.x, o.y - yy) < BALL_R * 2 + 1);
  while (clash(y) && y > PLAY_TOP + BALL_R * 3) y -= BALL_R * 2 + 2;
  if (clash(y)) { y = TOP_SPOT.y; while (clash(y) && y < PLAY_BOTTOM - BALL_R * 3) y += BALL_R * 2 + 2; }
  b.x = TOP_SPOT.x;
  b.y = y;
}

/** Can the cue ball go at (x, y)? On the break only behind the head string. */
export function validPlacement(balls, x, y, isBreak = false) {
  const minY = isBreak ? HEAD_STRING_Y : PLAY_TOP + BALL_R;
  if (x < PLAY_LEFT + BALL_R || x > PLAY_RIGHT - BALL_R || y < minY || y > PLAY_BOTTOM - BALL_R) return false;
  return !balls.some((b) => b.id !== 0 && !b.pocketed && Math.hypot(x - b.x, y - b.y) < BALL_R * 2 + 1);
}

/** The cue ball back on the table after a foul (ball in hand): its starting place, or the first free one. */
export function returnCueBall(balls) {
  const cue = cueBall(balls);
  cue.pocketed = false;
  cue.vx = 0;
  cue.vy = 0;
  cue.sx = 0;
  cue.sy = 0;
  cue.ez = 0;
  let at = CUE_START;
  if (!validPlacement(balls, at.x, at.y)) {
    search: for (let y = PLAY_BOTTOM - 40; y > PLAY_TOP + 40; y -= 25) {
      for (let x = PLAY_LEFT + 35; x < PLAY_RIGHT - 35; x += 25) {
        if (validPlacement(balls, x, y)) { at = { x, y }; break search; }
      }
    }
  }
  cue.x = at.x;
  cue.y = at.y;
}

/** Does any ball (other than `ignore`) stand in the way from (x1,y1) to (x2,y2)? */
export function pathBlocked(balls, x1, y1, x2, y2, ignore = []) {
  const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy);
  if (!len) return false;
  const ux = dx / len, uy = dy / len;
  return balls.some((b) => {
    if (b.pocketed || ignore.includes(b.id)) return false;
    const px = b.x - x1, py = b.y - y1, along = px * ux + py * uy;
    return along > 0 && along < len && Math.abs(px * uy - py * ux) < BALL_R * 2.05;
  });
}

/** Where a shot at `angle` first meets a ball (the "ghost ball" spot) or a cushion. */
export function aimRay(balls, angle) {
  const cue = cueBall(balls);
  const dx = Math.cos(angle), dy = Math.sin(angle);
  let t = 1200, hit = null;
  if (dx > 0) t = Math.min(t, (PLAY_RIGHT - BALL_R - cue.x) / dx);
  else if (dx < 0) t = Math.min(t, (PLAY_LEFT + BALL_R - cue.x) / dx);
  if (dy > 0) t = Math.min(t, (PLAY_BOTTOM - BALL_R - cue.y) / dy);
  else if (dy < 0) t = Math.min(t, (PLAY_TOP + BALL_R - cue.y) / dy);
  for (const b of balls) {
    if (b.id === 0 || b.pocketed) continue;
    const ox = cue.x - b.x, oy = cue.y - b.y;
    const bc = ox * dx + oy * dy, cc = ox * ox + oy * oy - (BALL_R * 2) ** 2, disc = bc * bc - cc;
    if (disc >= 0) {
      const tt = -bc - Math.sqrt(disc);
      if (tt > 0 && tt < t) { t = tt; hit = b; }
    }
  }
  return { x: cue.x + dx * t, y: cue.y + dy * t, hit };
}

/**
 * The straight-line path of a ball from `from` at `angle`, bouncing off the cushions (up to
 * `bounces` times) until it meets another ball, drops into a pocket, or runs `maxLen`. Balls in
 * `ignore` don't block it. Returns { points: [{x, y}, …], hit (the ball met, its centre at the
 * last point's distance 2R) | null, pocket | null }. For the aiming guide: geometry only (no
 * friction or spin), so it shows where the ball heads, not how far it gets.
 */
export function tracePath(balls, from, angle, { ignore = [0], bounces = 3, maxLen = 3000 } = {}) {
  const R = BALL_R;
  const minX = PLAY_LEFT + R, maxX = PLAY_RIGHT - R, minY = PLAY_TOP + R, maxY = PLAY_BOTTOM - R;
  let x = from.x, y = from.y, dx = Math.cos(angle), dy = Math.sin(angle), left = maxLen;
  const points = [{ x, y }];
  for (let n = 0; n <= bounces && left > 0; n++) {
    // The nearest cushion along the way…
    let tWall = Infinity, wall = null;
    if (dx > 1e-9) { const t = (maxX - x) / dx; if (t < tWall) { tWall = t; wall = 'x'; } }
    if (dx < -1e-9) { const t = (minX - x) / dx; if (t < tWall) { tWall = t; wall = 'x'; } }
    if (dy > 1e-9) { const t = (maxY - y) / dy; if (t < tWall) { tWall = t; wall = 'y'; } }
    if (dy < -1e-9) { const t = (minY - y) / dy; if (t < tWall) { tWall = t; wall = 'y'; } }
    tWall = Math.max(0, tWall);
    // …or the nearest ball, if that comes first.
    let tBall = Infinity, hit = null;
    for (const b of balls) {
      if (b.pocketed || ignore.includes(b.id)) continue;
      const ox = x - b.x, oy = y - b.y;
      const bc = ox * dx + oy * dy, cc = ox * ox + oy * oy - (R * 2) ** 2, disc = bc * bc - cc;
      if (disc < 0) continue;
      const t = -bc - Math.sqrt(disc);
      if (t > 1e-6 && t < tBall) { tBall = t; hit = b; }
    }
    if (hit && tBall <= tWall && tBall <= left) {
      points.push({ x: x + dx * tBall, y: y + dy * tBall });
      return { points, hit, pocket: null };
    }
    const t = Math.min(tWall, left);
    x += dx * t;
    y += dy * t;
    left -= t;
    points.push({ x, y });
    if (t < tWall) break; // ran out of length
    // Reaching the cushion beside a pocket's mouth: it goes in.
    const { pocket, dist } = nearestPocket(x, y);
    if (dist < pocket.r + R * 0.7) {
      points[points.length - 1] = { x: pocket.x, y: pocket.y };
      return { points, hit: null, pocket };
    }
    if (wall === 'x') dx = -dx; else dy = -dy;
  }
  return { points, hit: null, pocket: null };
}

/** Plays a shot out in full (up to `maxTicks`) on a copy of the balls; returns the shot record and the balls after. */
export function simulate(balls, angle, power, maxTicks = 2400, spin) {
  const copy = cloneBalls(balls);
  const shot = newShot(copy);
  strike(copy, angle, power, spin);
  for (let i = 0; i < maxTicks && moving(copy); i++) tick(copy, shot);
  return { shot, balls: copy };
}

/**
 * Shots at the target ball into each pocket, best first: straighter, shorter and unblocked
 * shots score higher. Each: { angle, power, score }.
 */
function candidates(balls) {
  const cue = cueBall(balls), target = lowestBall(balls);
  if (!cue || !target) return [];
  const out = [];
  for (const p of POCKETS) {
    const toPocket = Math.atan2(p.y - target.y, p.x - target.x);
    const gx = target.x - Math.cos(toPocket) * BALL_R * 2, gy = target.y - Math.sin(toPocket) * BALL_R * 2;
    const angle = Math.atan2(gy - cue.y, gx - cue.x);
    const cut = Math.abs(Math.atan2(Math.sin(angle - toPocket), Math.cos(angle - toPocket)));
    if (cut >= 1.15) continue;
    const d1 = Math.hypot(gx - cue.x, gy - cue.y), d2 = Math.hypot(p.x - target.x, p.y - target.y);
    const blocked = pathBlocked(balls, cue.x, cue.y, gx, gy, [0, target.id]) || pathBlocked(balls, target.x, target.y, p.x, p.y, [0, target.id]);
    const power = Math.max(0.35, Math.min(0.85, 0.3 + (d1 + d2 / Math.max(0.3, Math.cos(cut))) / 1300));
    out.push({ angle, power, score: (blocked ? -500 : 100) - cut * 80 - (d1 + d2) * 0.08 });
  }
  if (!out.length) out.push({ angle: Math.atan2(target.y - cue.y, target.x - cue.x), power: 0.55, score: -1000 });
  return out.sort((a, b) => b.score - a.score);
}

/** How good the best shot on the table is for whoever plays next (higher is easier). */
export const bestShotScore = (balls) => candidates(balls)[0]?.score ?? -1000;

/**
 * A safety: a legal shot (the lowest ball first, then a cushion or a pot) that leaves the
 * opponent the worst shot. It tries `cfg.safety` shots at different thicknesses on the target
 * and soft speeds, plays each out, and keeps the one whose layout gives the best shot the lowest
 * score; a legal pot (keeping the turn) or a win beats any safety. Null if none is legal.
 */
export function planSafety(balls, level = 'susah', random = Math.random) {
  const cfg = AI_LEVELS[level] ?? AI_LEVELS.susah;
  const cue = cueBall(balls), target = lowestBall(balls);
  if (!cue || !target || !cfg.safety) return null;
  const centre = Math.atan2(target.y - cue.y, target.x - cue.x);
  const dist = Math.hypot(target.x - cue.x, target.y - cue.y);
  const reach = Math.asin(Math.min(1, (BALL_R * 2 * 0.95) / dist)); // thinnest to fullest hit
  const powers = cfg.safety >= 24 ? [0.22, 0.32, 0.45] : [0.25, 0.4];
  const angles = Math.max(2, Math.round(cfg.safety / powers.length));
  let best = null;
  for (let i = 0; i < angles; i++) {
    const angle = centre + reach * (angles === 1 ? 0 : (2 * i) / (angles - 1) - 1);
    for (const power of powers) {
      const after = simulate(balls, angle, power, 2400);
      const v = judge(after.shot);
      if (v.foul) continue;
      if (v.win) return { angle, power, spin: { x: 0, y: 0 }, kind: 'pot' };
      const left = v.keepTurn ? -1e4 : bestShotScore(after.balls);
      if (!best || left < best.left) best = { angle, power, left };
    }
  }
  if (!best) return null;
  return { angle: best.angle + (random() * 2 - 1) * cfg.jitter * 0.5, power: best.power, spin: { x: 0, y: 0 }, kind: 'safety' };
}

/**
 * A push-out: a soft roll of the cue ball (it needn't hit anything) to where the opponent's best
 * shot is worst, as they may then choose to play it. Avoids scratching.
 */
export function planPushOut(balls, random = Math.random) {
  let best = null;
  for (let i = 0; i < 16; i++) {
    const angle = (i / 16) * Math.PI * 2 + random() * 0.1;
    for (const power of [0.15, 0.25]) {
      const after = simulate(balls, angle, power, 2400);
      if (after.shot.pocketed.includes(0)) continue;
      const left = bestShotScore(after.balls);
      if (!best || left < best.left) best = { angle, power, left };
    }
  }
  return { angle: best?.angle ?? 0, power: best?.power ?? 0.15, spin: { x: 0, y: 0 }, kind: 'push' };
}

/** After the opponent's push-out: does the AI play from there (true) or hand the shot back? */
export function acceptPush(balls, level = 'sederhana') {
  if (!(AI_LEVELS[level] ?? AI_LEVELS.sederhana).safety) return true; // Mudah always plays
  return bestShotScore(balls) > 20;
}

/**
 * The AI's shot: { angle, power, spin, kind: 'pot' | 'safety' | 'push' }. The break is a firm
 * centre hit at the 1. Otherwise the best candidate, struck by level:
 *   Mudah: in the centre, always going for the pot.
 *   Sederhana: now and then a little follow or draw; plays safe when its best pot is blocked.
 *   Susah: plays position. Its best few shots are played out with a centre, follow and draw
 *     strike (and a firmer stroke); of those that legally pot the target, it keeps the one that
 *     leaves the cue ball best placed for the next ball (a win on the 9 above all). If none
 *     pots, it plays safe.
 * With `pushAvailable` (the shot after the break), Sederhana and Susah push out instead of
 * playing a blocked shot. Every level adds its own aim error. `random` is injectable for tests.
 */
export function planShot(balls, level = 'sederhana', isBreak = false, random = Math.random, { pushAvailable = false } = {}) {
  const cfg = AI_LEVELS[level] ?? AI_LEVELS.sederhana;
  const cue = cueBall(balls), target = lowestBall(balls);
  const centre = { x: 0, y: 0 };
  if (isBreak) return { angle: Math.atan2(target.y - cue.y, target.x - cue.x) + (random() - 0.5) * 0.02, power: 0.94, spin: centre, kind: 'pot' };
  const list = candidates(balls);
  if (pushAvailable && cfg.safety && list[0].score < 0) return planPushOut(balls, random);
  let pick = { ...list[0], spin: centre };
  let likely = list[0].score > -50; // Sederhana plays safe only when its pot is blocked
  if (cfg.simulate) {
    let best = -Infinity;
    likely = false;
    for (const c of list.slice(0, 3)) {
      for (const power of [c.power, Math.min(0.95, c.power + 0.15)]) {
        for (const spin of [centre, { x: 0, y: 0.7 }, { x: 0, y: -0.7 }]) {
          const after = simulate(balls, c.angle, power, 2400, spin);
          const v = judge(after.shot);
          if (v.foul || !v.potted.includes(target.id)) continue;
          // Where it leaves the cue ball: the quality of the best shot at the next ball.
          const score = v.win ? 1e6 : 1000 + bestShotScore(after.balls);
          if (score > best) { best = score; pick = { angle: c.angle, power, spin }; likely = true; }
        }
      }
    }
  } else if (level === 'sederhana' && random() < 0.35) {
    pick.spin = { x: 0, y: random() < 0.5 ? 0.45 : -0.45 };
  }
  if (!likely && cfg.safety) {
    const safe = planSafety(balls, level, random);
    if (safe) return safe;
  }
  return {
    angle: pick.angle + (random() * 2 - 1) * cfg.jitter,
    power: Math.max(0.2, Math.min(1, pick.power * (1 + (random() - 0.5) * 0.1))),
    spin: pick.spin,
    kind: 'pot',
  };
}

/** With ball in hand, where the AI puts the cue ball: the place giving its best shot (Mudah doesn't bother). */
export function placeCueForAI(balls, level = 'sederhana') {
  const cfg = AI_LEVELS[level] ?? AI_LEVELS.sederhana;
  returnCueBall(balls);
  if (!cfg.placeCue) return;
  const cue = cueBall(balls);
  let best = { score: candidates(balls)[0]?.score ?? -Infinity, x: cue.x, y: cue.y };
  for (let y = PLAY_TOP + 40; y < PLAY_BOTTOM - 40; y += 36) {
    for (let x = PLAY_LEFT + 30; x < PLAY_RIGHT - 30; x += 36) {
      if (!validPlacement(balls, x, y)) continue;
      cue.x = x;
      cue.y = y;
      const score = candidates(balls)[0]?.score ?? -Infinity;
      if (score > best.score) best = { score, x, y };
    }
  }
  cue.x = best.x;
  cue.y = best.y;
}

/** Points for a round against the AI: 100 a ball the player potted legally, plus a win bonus by level. */
export function roundPoints(potted, won, level) {
  return potted * POINTS_PER_BALL + (won ? (AI_LEVELS[level] ?? AI_LEVELS.mudah).bonus : 0);
}
