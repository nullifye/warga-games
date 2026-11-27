// Draws the table, the balls, and the aim guide with the cue, on a 2D canvas in table units.
import {
  TABLE_W, TABLE_H, RAIL, PLAY_LEFT, PLAY_RIGHT, PLAY_TOP, PLAY_BOTTOM, PLAY_W, PLAY_H, BALL_R, POCKETS,
  TOP_SPOT, HEAD_STRING_Y, TABLE_WIDTH_IN, lowestBall, cueBall, aimRay, validPlacement, tracePath,
} from './rules.js';

// The official colours of balls 1–9; the 9 is yellow-striped.
export const BALL_COLORS = ['#f8fafc', '#facc15', '#2563eb', '#dc2626', '#7c3aed', '#f97316', '#16a34a', '#881337', '#18181b', '#facc15'];
const FONT = `800 ${(BALL_R * 0.74).toFixed(1)}px Lexend, system-ui, sans-serif`; // sized to the ball

/** The head string (behind it the cue ball goes for the break) and the spots, on the cloth. */
function drawMarkings(ctx) {
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.16)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(PLAY_LEFT + 6, HEAD_STRING_Y);
  ctx.lineTo(PLAY_RIGHT - 6, HEAD_STRING_Y);
  ctx.stroke();
  ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
  ctx.beginPath();
  ctx.arc(TOP_SPOT.x, TOP_SPOT.y, 3.5, 0, Math.PI * 2);
  ctx.arc(TOP_SPOT.x, HEAD_STRING_Y, 3.5, 0, Math.PI * 2);
  ctx.fill();
}

/**
 * The table itself, painted. Used until (or unless) the 3D table's picture from above is set
 * (setTableImage): that needs WebGL.
 */
function drawTable(ctx) {
  // Mahogany frame with brass corners.
  const wood = ctx.createLinearGradient(0, 0, TABLE_W, TABLE_H);
  wood.addColorStop(0, '#4a2511');
  wood.addColorStop(0.5, '#361a0b');
  wood.addColorStop(1, '#261106');
  ctx.fillStyle = wood;
  ctx.fillRect(0, 0, TABLE_W, TABLE_H);
  ctx.fillStyle = '#c98a2b';
  for (const [x, y] of [[0, 0], [TABLE_W - 32, 0], [0, TABLE_H - 32], [TABLE_W - 32, TABLE_H - 32]]) ctx.fillRect(x, y, 32, 32);
  // The cloth, its cushions and their shadow.
  const felt = ctx.createRadialGradient(TABLE_W / 2, TABLE_H / 2, 50, TABLE_W / 2, TABLE_H / 2, 520);
  felt.addColorStop(0, '#15803d');
  felt.addColorStop(1, '#0d5c2b');
  ctx.fillStyle = felt;
  ctx.fillRect(PLAY_LEFT - 5, PLAY_TOP - 5, PLAY_W + 10, PLAY_H + 10);
  ctx.strokeStyle = '#064e3b';
  ctx.lineWidth = 5;
  ctx.strokeRect(PLAY_LEFT - 2.5, PLAY_TOP - 2.5, PLAY_W + 5, PLAY_H + 5);
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.35)';
  ctx.lineWidth = 7;
  ctx.strokeRect(PLAY_LEFT + 2, PLAY_TOP + 2, PLAY_W - 4, PLAY_H - 4);
  drawMarkings(ctx);
  // Diamond sights on the rails.
  ctx.fillStyle = '#fde68a';
  const diamond = (x, y) => {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(Math.PI / 4);
    ctx.fillRect(-2.8, -2.8, 5.6, 5.6);
    ctx.restore();
  };
  for (let i = 1; i <= 7; i++) {
    if (i === 4) continue;
    const y = PLAY_TOP + (PLAY_H * i) / 8;
    diamond(RAIL * 0.45, y);
    diamond(TABLE_W - RAIL * 0.45, y);
  }
  for (let j = 1; j <= 3; j++) {
    const x = PLAY_LEFT + (PLAY_W * j) / 4;
    diamond(x, RAIL * 0.45);
    diamond(x, TABLE_H - RAIL * 0.45);
  }
  // Pockets.
  for (const p of POCKETS) {
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r + 3, 0, Math.PI * 2);
    ctx.fillStyle = '#1c1917';
    ctx.fill();
    const g = ctx.createRadialGradient(p.x - 2, p.y - 2, 2, p.x, p.y, p.r);
    g.addColorStop(0, '#09090b');
    g.addColorStop(1, '#000000');
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
    ctx.fillStyle = g;
    ctx.fill();
  }
}

// ---------- rolling balls ----------
// Each ball has a 3D orientation (a rotation matrix) that turns as it travels, as a ball rolling
// on cloth does: moving a distance d turns it by d / R about the axis lying on the table at right
// angles to the motion. The ball is drawn pixel by pixel from that orientation into its own small
// canvas: the colour, the 9's stripe and the two white number circles (on opposite sides, as on
// real balls) are fixed to the ball and roll with it; the light and its highlight stay put.
// Coordinates: x right, y down the table, z into the table (so the viewer looks along +z).
const spins = new Map(); // ball id → { m, x, y, canvas, ctx, img, dirty }
const DISC = Math.cos(Math.asin(0.46)); // the number circle's edge, as a dot product
const STRIPE = 0.56; // the 9's stripe: half its width, as a dot product
const LIGHT = (() => { const v = [-0.45, -0.55, -0.7]; const l = Math.hypot(...v); return v.map((c) => c / l); })();
const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

/** Forgets every ball's turn, e.g. for a new rack (numbers face up again). */
export function resetSpin() {
  spins.clear();
  seen.clear();
  drops.length = 0;
}

function spinOf(b, scale) {
  let s = spins.get(b.id);
  const size = Math.ceil(BALL_R * 2 * scale) + 2;
  if (!s || s.size !== size) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const c = canvas.getContext('2d');
    s = { m: s?.m ?? [1, 0, 0, 0, 1, 0, 0, 0, 1], rx: b.rollX ?? 0, ry: b.rollY ?? 0, tw: b.twist ?? 0, canvas, ctx: c, img: c.createImageData(size, size), size, dirty: true };
    spins.set(b.id, s);
  }
  // Turn by how far its surface has rolled since the last frame (the physics keeps count): a
  // sliding ball barely turns, a rolling one turns with its travel, a spinning one turns in place.
  const dx = (b.rollX ?? 0) - s.rx, dy = (b.rollY ?? 0) - s.ry, d = Math.hypot(dx, dy);
  if (d > 0.01 && d < BALL_R * 20) {
    const ax = dy / d, ay = -dx / d, t = d / BALL_R; // ω = n × v with n = (0, 0, -1)
    const c = Math.cos(t), sn = Math.sin(t), k = 1 - c;
    // Rotation about (ax, ay, 0) by t (Rodrigues), applied after the current orientation.
    const r = [c + ax * ax * k, ax * ay * k, ay * sn, ax * ay * k, c + ay * ay * k, -ax * sn, -ay * sn, ax * sn, c];
    const m = s.m, out = new Array(9);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) out[i * 3 + j] = r[i * 3] * m[j] + r[i * 3 + 1] * m[3 + j] + r[i * 3 + 2] * m[6 + j];
    s.m = out;
    s.dirty = true;
  }
  s.rx = b.rollX ?? 0;
  s.ry = b.rollY ?? 0;
  // Side spin turns it about the upright axis (the viewer's line of sight).
  const tw = (b.twist ?? 0) - s.tw;
  if (Math.abs(tw) > 1e-4 && Math.abs(tw) < 6) {
    const c = Math.cos(tw), sn = Math.sin(tw), m = s.m;
    s.m = [c * m[0] - sn * m[3], c * m[1] - sn * m[4], c * m[2] - sn * m[5], sn * m[0] + c * m[3], sn * m[1] + c * m[4], sn * m[2] + c * m[5], m[6], m[7], m[8]];
    s.dirty = true;
  }
  s.tw = b.twist ?? 0;
  return s;
}

/** Paints the ball's pixels from its orientation (only when it has turned). */
function paintBall(s, id) {
  if (!s.dirty) return;
  s.dirty = false;
  const { size, img, m } = s;
  const data = img.data;
  const base = rgb(id === 9 ? '#f8fafc' : BALL_COLORS[id]);
  const band = rgb(BALL_COLORS[9]);
  const white = [248, 250, 252];
  const r = (size - 2) / 2, cx = size / 2, cy = size / 2;
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const i = (py * size + px) * 4;
      const nx = (px + 0.5 - cx) / r, ny = (py + 0.5 - cy) / r, q = nx * nx + ny * ny;
      if (q > 1) { data[i + 3] = 0; continue; }
      const nz = -Math.sqrt(1 - q); // the surface faces the viewer
      // That surface point in the ball's own frame (the transpose undoes the rotation).
      const bx = m[0] * nx + m[3] * ny + m[6] * nz;
      const by = m[1] * nx + m[4] * ny + m[7] * nz;
      const bz = m[2] * nx + m[5] * ny + m[8] * nz;
      let col = base;
      if (id === 9 && Math.abs(by) < STRIPE) col = band;
      if (id > 0 && Math.abs(bz) > DISC) col = white;
      // Light: soft ambient, diffuse from the upper left, a sharp highlight, a darker rim.
      const lambert = Math.max(0, nx * LIGHT[0] + ny * LIGHT[1] + nz * LIGHT[2]);
      const spec = Math.max(0, lambert) ** 28 * 210;
      const shade = 0.5 + 0.62 * lambert;
      const edge = Math.min(1, (1 - q) * 6); // smooth the outline
      data[i] = Math.min(255, col[0] * shade + spec);
      data[i + 1] = Math.min(255, col[1] * shade + spec);
      data[i + 2] = Math.min(255, col[2] * shade + spec);
      data[i + 3] = 255 * Math.min(1, edge + 0.15);
    }
  }
  s.ctx.putImageData(img, 0, 0);
}

function drawBall(ctx, b, { alpha = 1, ring = false, now = 0, scale = 2, shadow = true } = {}) {
  const R = BALL_R;
  const s = spinOf(b, scale);
  paintBall(s, b.id);
  ctx.save();
  ctx.globalAlpha = alpha;
  // Shadow on the cloth.
  if (shadow) {
    ctx.beginPath();
    ctx.ellipse(b.x + 3, b.y + 3.5, R, R * 0.92, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.36)';
    ctx.fill();
  }
  if (ring) {
    ctx.beginPath();
    ctx.arc(b.x, b.y, R + 3 + Math.sin(now / 180) * 1.8, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(250, 204, 21, 0.75)';
    ctx.lineWidth = 2;
    ctx.stroke();
  }
  ctx.drawImage(s.canvas, b.x - R - 1 / scale, b.y - R - 1 / scale, (s.size) / scale, (s.size) / scale);
  // The number on whichever circle faces the viewer, drawn on the circle's own plane, so it
  // turns and narrows as the ball rolls.
  if (b.id > 0) {
    const m = s.m;
    for (const side of [-1, 1]) {
      const cz = m[8] * side; // the circle's centre, world z (negative faces the viewer)
      if (cz > -0.3) continue;
      const cx = m[2] * side, cy = m[5] * side;
      // The circle's own axes in the world: the ball's x and y (mirrored on the far side).
      const ex = [m[0] * -side, m[3] * -side], ey = [m[1], m[4]];
      ctx.save();
      ctx.globalAlpha = alpha * Math.min(1, (-cz - 0.3) * 3);
      ctx.transform(ex[0], ex[1], ey[0], ey[1], b.x + cx * R, b.y + cy * R);
      ctx.fillStyle = '#0f172a';
      ctx.font = FONT;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(b.id), 0, 0.5);
      ctx.restore();
    }
  }
  ctx.restore();
}

/** The dotted aim line, the ghost ball where the cue ball meets the first ball, and that ball's path. */
function drawGuide(ctx, balls, angle) {
  const cue = cueBall(balls);
  const ray = aimRay(balls, angle);
  const target = lowestBall(balls);
  const legal = ray.hit && target && ray.hit.id === target.id;
  const color = ray.hit ? (legal ? '255, 255, 255' : '244, 63, 94') : '255, 255, 255';
  ctx.save();
  ctx.setLineDash([6, 6]);
  ctx.lineWidth = 2;
  ctx.strokeStyle = `rgba(${color}, ${ray.hit ? 0.8 : 0.45})`;
  ctx.beginPath();
  ctx.moveTo(cue.x, cue.y);
  ctx.lineTo(ray.x, ray.y);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.arc(ray.x, ray.y, BALL_R, 0, Math.PI * 2);
  ctx.strokeStyle = ray.hit ? (legal ? 'rgba(52, 211, 153, 0.95)' : 'rgba(244, 63, 94, 0.95)') : 'rgba(255, 255, 255, 0.55)';
  ctx.lineWidth = 1.8;
  ctx.stroke();
  if (ray.hit) {
    const dir = Math.atan2(ray.hit.y - ray.y, ray.hit.x - ray.x);
    ctx.beginPath();
    ctx.moveTo(ray.hit.x, ray.hit.y);
    ctx.lineTo(ray.hit.x + Math.cos(dir) * 90, ray.hit.y + Math.sin(dir) * 90);
    ctx.strokeStyle = legal ? 'rgba(250, 204, 21, 0.9)' : 'rgba(244, 63, 94, 0.8)';
    ctx.lineWidth = 2.5;
    ctx.stroke();
  }
  ctx.restore();
}

/** A polyline through `points`. */
function polyline(ctx, points) {
  ctx.beginPath();
  points.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
  ctx.stroke();
}

/**
 * The extended guide: the cue ball's path up to its first cushion bounce (and on from there)
 * until it meets a ball (ghost ball there) or a pocket; then the struck ball's path, likewise to
 * its first bounce, ringed in green when it ends in a pocket; and, faintly, where the cue ball
 * heads after the hit.
 */
function drawExtendedGuide(ctx, balls, angle) {
  const cue = cueBall(balls);
  const target = lowestBall(balls);
  const path = tracePath(balls, cue, angle, { ignore: [0], bounces: 1, maxLen: 2600 });
  const ghost = path.points.at(-1);
  const legal = path.hit && target && path.hit.id === target.id;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  // The cue ball's path.
  ctx.setLineDash([6, 6]);
  ctx.lineWidth = 2;
  ctx.strokeStyle = path.hit ? (legal ? 'rgba(255, 255, 255, 0.85)' : 'rgba(244, 63, 94, 0.85)') : 'rgba(255, 255, 255, 0.6)';
  polyline(ctx, path.points);
  ctx.setLineDash([]);
  for (const p of path.points.slice(1, -1)) { // where it bounces (once at most)
    ctx.beginPath();
    ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';
    ctx.fill();
  }
  if (path.pocket) markPocket(ctx, path.pocket, 'rgba(244, 63, 94, 0.95)'); // a scratch
  if (path.hit) {
    ctx.beginPath();
    ctx.arc(ghost.x, ghost.y, BALL_R, 0, Math.PI * 2);
    ctx.strokeStyle = legal ? 'rgba(52, 211, 153, 0.95)' : 'rgba(244, 63, 94, 0.95)';
    ctx.lineWidth = 1.8;
    ctx.stroke();
    // The struck ball goes along the line of centres…
    const hitDir = Math.atan2(path.hit.y - ghost.y, path.hit.x - ghost.x);
    const run = tracePath(balls, path.hit, hitDir, { ignore: [0, path.hit.id], bounces: 1, maxLen: 1600 });
    ctx.strokeStyle = legal ? 'rgba(250, 204, 21, 0.9)' : 'rgba(244, 63, 94, 0.75)';
    ctx.lineWidth = 2.5;
    polyline(ctx, run.points);
    if (run.pocket && legal) markPocket(ctx, run.pocket, 'rgba(52, 211, 153, 0.95)');
    // …and the cue ball glances off at right angles to it (a stun shot), unless it was dead on.
    const inX = Math.cos(angle), inY = Math.sin(angle), nX = Math.cos(hitDir), nY = Math.sin(hitDir);
    const along = inX * nX + inY * nY;
    const tx = inX - along * nX, ty = inY - along * nY, tl = Math.hypot(tx, ty);
    if (tl > 0.08) {
      const glance = tracePath(balls, ghost, Math.atan2(ty, tx), { ignore: [0, path.hit.id], bounces: 1, maxLen: 70 + 230 * tl });
      ctx.setLineDash([3, 5]);
      ctx.lineWidth = 1.6;
      ctx.strokeStyle = 'rgba(191, 219, 254, 0.6)';
      polyline(ctx, glance.points);
    }
  }
  ctx.restore();
}

/** A ring round a pocket the guide's path ends in. */
function markPocket(ctx, p, color) {
  ctx.save();
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.arc(p.x, p.y, p.r + 4, 0, Math.PI * 2);
  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.restore();
}

/**
 * The cue behind the cue ball, its tip `back` table units from the ball's centre. Real
 * proportions (thin at the tip, thick at the butt) and parts, from the tip: blue chalked tip,
 * white ferrule, maple shaft, metal joint, dark forearm with four light inlaid points, black
 * wrap, butt sleeve and rubber bumper; shaded across so it looks round, with a soft shadow.
 * Drawn in table units, on its own layer over the whole game screen (js/main.js), so it can
 * reach past the table's edge. `side`: the tip's offset to the player's right (side spin).
 */
export function drawCue(ctx, balls, angle, back, side = 0) {
  const cue = cueBall(balls);
  // Real proportions against the table and the ball: a 58 in cue, a 13 mm tip and a 30 mm butt
  // beside a 57 mm ball.
  const LEN = (TABLE_W - 2 * RAIL) * (58 / TABLE_WIDTH_IN), TIP_W = BALL_R * 2 * (13 / 57), BUTT_W = BALL_R * 2 * (30 / 57);
  const half = (t) => (TIP_W + (BUTT_W - TIP_W) * t) / 2; // half-width at fraction t from the tip
  const at = (t) => back + t * LEN;
  // A tapered slice of the cue from fraction t0 to t1.
  const slice = (t0, t1) => {
    ctx.beginPath();
    ctx.moveTo(at(t0), -half(t0));
    ctx.lineTo(at(t1), -half(t1));
    ctx.lineTo(at(t1), half(t1));
    ctx.lineTo(at(t0), half(t0));
    ctx.closePath();
  };
  ctx.save();
  ctx.translate(cue.x, cue.y);
  ctx.rotate(angle + Math.PI);
  // Striking off-centre for side spin: the cue lines up `side` to the player's right of centre.
  ctx.translate(0, -side);

  // Soft shadow on the cloth, offset as the light comes from the upper left.
  ctx.save();
  ctx.shadowColor = 'rgba(0, 0, 0, 0.45)';
  ctx.shadowBlur = 8;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;
  ctx.translate(4, 6);
  slice(0, 1);
  ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
  ctx.fill();
  ctx.restore();

  // Shaft: maple, with fine grain along it.
  slice(0, 0.56);
  const maple = ctx.createLinearGradient(at(0), 0, at(0.56), 0);
  maple.addColorStop(0, '#f1dcae');
  maple.addColorStop(1, '#dcb77a');
  ctx.fillStyle = maple;
  ctx.fill();
  ctx.save();
  ctx.clip();
  ctx.strokeStyle = 'rgba(150, 100, 40, 0.18)';
  ctx.lineWidth = 0.4;
  for (const y of [-1.8, -0.6, 0.7, 1.9]) {
    ctx.beginPath();
    ctx.moveTo(at(0.02), y * 0.9);
    ctx.lineTo(at(0.56), y * 1.6);
    ctx.stroke();
  }
  ctx.restore();
  // Forearm: dark wood, with four pale maple points reaching towards the tip.
  slice(0.56, 0.74);
  ctx.fillStyle = '#3b1d10';
  ctx.fill();
  ctx.fillStyle = '#e9cf9b';
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(at(0.6), 0);
    ctx.lineTo(at(0.735), side * half(0.735) * 0.95);
    ctx.lineTo(at(0.735), side * half(0.735) * 0.2);
    ctx.closePath();
    ctx.fill();
  }
  ctx.fillStyle = '#b8862f';
  ctx.beginPath();
  ctx.moveTo(at(0.63), 0);
  ctx.lineTo(at(0.735), half(0.735) * 0.22);
  ctx.lineTo(at(0.735), -half(0.735) * 0.22);
  ctx.closePath();
  ctx.fill();
  // Wrap: black linen, with a fine diagonal weave.
  slice(0.74, 0.91);
  ctx.fillStyle = '#1b1b1f';
  ctx.fill();
  ctx.save();
  ctx.clip();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.07)';
  ctx.lineWidth = 0.6;
  for (let x = at(0.74) - 10; x < at(0.91); x += 2.4) {
    ctx.beginPath();
    ctx.moveTo(x, -8);
    ctx.lineTo(x + 10, 8);
    ctx.stroke();
  }
  ctx.restore();
  // Butt sleeve: dark wood with a pale ring, then the rubber bumper.
  slice(0.91, 0.985);
  ctx.fillStyle = '#4a2412';
  ctx.fill();
  slice(0.94, 0.947);
  ctx.fillStyle = '#e9cf9b';
  ctx.fill();
  slice(0.985, 1);
  ctx.fillStyle = '#111';
  ctx.fill();
  // Metal rings: the joint, and either end of the wrap.
  for (const [t0, t1] of [[0.555, 0.567], [0.737, 0.743], [0.907, 0.913]]) {
    slice(t0, t1);
    ctx.fillStyle = '#cfd6dd';
    ctx.fill();
  }
  // Ferrule and chalked tip.
  slice(0, 0.022);
  ctx.fillStyle = '#f7f4ec';
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(at(0), -half(0));
  ctx.lineTo(at(0), half(0));
  ctx.lineTo(at(0) - 2.4, half(0) * 0.85);
  ctx.quadraticCurveTo(at(0) - 3.4, 0, at(0) - 2.4, -half(0) * 0.85);
  ctx.closePath();
  ctx.fillStyle = '#2f73b8';
  ctx.fill();

  // Roundness: dark at both edges, a highlight along the upper side.
  slice(0, 1);
  ctx.save();
  ctx.clip();
  const round = ctx.createLinearGradient(0, -BUTT_W / 2, 0, BUTT_W / 2);
  round.addColorStop(0, 'rgba(0, 0, 0, 0.35)');
  round.addColorStop(0.28, 'rgba(255, 255, 255, 0.32)');
  round.addColorStop(0.45, 'rgba(255, 255, 255, 0)');
  round.addColorStop(1, 'rgba(0, 0, 0, 0.45)');
  ctx.fillStyle = round;
  ctx.fillRect(at(0) - 4, -BUTT_W, LEN + 8, BUTT_W * 2);
  ctx.restore();
  ctx.restore();
}

/**
 * One frame of the table. `view`: { balls, aim, showGuide, extended, placing, isBreak, now,
 * scale }. `extended`: the guide shows bounces and the struck ball's path. The cue is drawn
 * separately (drawCue), on a layer that isn't clipped to the table.
 * `placing`: the cue ball is being placed (ball in hand): drawn faint where it may not go.
 */
// ---------- the table, drawn once ----------
// Its wood, brass, cloth, cushions, markings and pockets don't change: they're drawn once into
// an offscreen canvas at the screen's resolution and copied each frame, instead of rebuilding
// their gradients and shapes 60 times a second.
let tableCache = null;
const TABLE_CORNER = 30; // table units: about the 22px rounding of its box on a phone
let tableImage = null;
/**
 * Draws the flat table from a picture (the 3D table seen from above, scene3d.js
 * renderTableImage) instead of painting it, so the flat and 3D views show the same table.
 */
export function setTableImage(img) {
  tableImage = img;
  tableCache = null;
}
function cachedTable(scale) {
  if (tableCache?.scale !== scale) {
    const c = document.createElement('canvas');
    c.width = Math.round(TABLE_W * scale);
    c.height = Math.round(TABLE_H * scale);
    const tctx = c.getContext('2d');
    tctx.setTransform(scale, 0, 0, scale, 0, 0);
    // The table's own rounded corners (not just its box's on screen), so they stay round while
    // the view turns it.
    tctx.beginPath();
    tctx.roundRect(0, 0, TABLE_W, TABLE_H, TABLE_CORNER);
    tctx.clip();
    if (tableImage) {
      tctx.drawImage(tableImage, 0, 0, TABLE_W, TABLE_H);
      drawMarkings(tctx);
    } else drawTable(tctx);
    tableCache = { scale, canvas: c };
  }
  return tableCache.canvas;
}

// ---------- balls dropping into pockets ----------
// A ball that has just gone in doesn't vanish: over DROP_MS it slides to the pocket's centre,
// shrinking and darkening as it sinks, drawn only within the pocket's opening.
const DROP_MS = 340;
const seen = new Map(); // ball id → { x, y, pocketed } as last drawn
const drops = []; // { b: a copy of the ball, pocket, start }

function noteDrops(balls, now) {
  for (const b of balls) {
    const last = seen.get(b.id);
    if (b.pocketed && last && !last.pocketed) {
      const pocket = POCKETS.reduce((a, p) => (Math.hypot(p.x - last.x, p.y - last.y) < Math.hypot(a.x - last.x, a.y - last.y) ? p : a));
      drops.push({ b: { ...b, x: last.x, y: last.y, pocketed: false }, pocket, start: now });
    }
    seen.set(b.id, { x: b.x, y: b.y, pocketed: b.pocketed });
  }
}

function drawDrops(ctx, now, scale) {
  for (let i = drops.length - 1; i >= 0; i--) {
    const d = drops[i], t = (now - d.start) / DROP_MS;
    if (t >= 1 || t < 0) { drops.splice(i, 1); continue; }
    const e = t * t; // speeding up as it falls
    const x = d.b.x + (d.pocket.x - d.b.x) * e, y = d.b.y + (d.pocket.y - d.b.y) * e;
    const size = 1 - 0.5 * e;
    ctx.save();
    ctx.beginPath();
    ctx.arc(d.pocket.x, d.pocket.y, d.pocket.r, 0, Math.PI * 2);
    ctx.clip(); // only what's over the hole shows
    ctx.translate(x, y);
    ctx.scale(size, size);
    ctx.translate(-x, -y);
    drawBall(ctx, { ...d.b, x, y }, { scale, alpha: 1 - 0.3 * e, shadow: false });
    // Darker as it sinks into the pocket.
    ctx.beginPath();
    ctx.arc(x, y, BALL_R, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(0, 0, 0, ${(0.75 * e).toFixed(3)})`;
    ctx.fill();
    ctx.restore();
  }
}

export function draw(ctx, view) {
  const { balls, now } = view;
  const scale = view.scale ?? 2;
  ctx.drawImage(cachedTable(scale), 0, 0, TABLE_W, TABLE_H);
  noteDrops(balls, now);
  drawDrops(ctx, now, scale);
  const target = lowestBall(balls);
  for (const b of balls) {
    if (b.pocketed) continue;
    const placingCue = view.placing && b.id === 0;
    drawBall(ctx, b, {
      alpha: placingCue && !validPlacement(balls, b.x, b.y, view.isBreak) ? 0.42 : placingCue ? 0.9 : 1,
      ring: target && b.id === target.id && (view.showGuide || view.placing),
      now,
      scale,
    });
  }
  if (view.showGuide) (view.extended ? drawExtendedGuide : drawGuide)(ctx, balls, view.aim);
}
