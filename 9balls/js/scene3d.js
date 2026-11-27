// 9-Ball in 3D (Three.js from shared/vendor, as Kejar Lapan, Congkak and Pemadam use): the same balls, rules and physics
// as the flat table (js/rules.js), seen from behind the cue ball as a player stands at the table.
// The camera turns with the aim; while a shot runs it rises to watch it; with ball in hand it
// looks straight down so the cue ball can be dragged into place. Loaded only when the 3D view is
// chosen (js/main.js), so the flat view never downloads Three.js.
//
// World units are table units (js/rules.js): x across the table, z along it (the table's y), with
// the cloth at y = 0 and the table's centre at the origin.
import * as THREE from '../../shared/vendor/three.module.min.js';
import {
  TABLE_W, TABLE_H, PLAY_LEFT, PLAY_RIGHT, PLAY_TOP, PLAY_BOTTOM, PLAY_W, PLAY_H, BALL_R, POCKETS,
  TABLE_WIDTH_IN, cueBall, lowestBall, aimRay, tracePath, validPlacement,
} from './rules.js';
import { BALL_COLORS } from './render.js';

const R = BALL_R;
const wx = (x) => x - TABLE_W / 2;
const wz = (y) => y - TABLE_H / 2;
const CUSHION_W = 13; // the rubber cushions' depth, from their nose (the play edge) back to the rail
const CUSHION_H = R * 1.3; // their nose at about 65% of a ball's height, as on a real table
const RAIL_TOP = CUSHION_H + 2;
// The wooden rail ends exactly at the table's box (TABLE_W × TABLE_H), as on the flat table, so
// the flat table's picture of it from above (renderTableImage) shows all of it.
const FRAME_OUT = 0;
const RAIL_MID = (PLAY_LEFT - CUSHION_W + FRAME_OUT) / 2; // the middle of the rail's top: where the sights go
const CUE_LEN = PLAY_W * (58 / TABLE_WIDTH_IN); // a 58 in cue
const CUE_TIP = R * (13 / 57); // a 13 mm tip and a 30 mm butt beside a 57 mm ball (radii)
const CUE_BUTT = R * (30 / 57);
const CUE_RAISE = 0.11; // the cue's butt is raised a little (radians) to clear the rail
const DROP_MS = 420;
// Behind the cue ball while aiming: how far back and up the eye is, and how far ahead it looks.
const AIM_BACK = 290, AIM_UP = 170, AIM_AHEAD = 130;

const lerp = (a, b, t) => a + (b - a) * t;
const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')];
}
function texture(c, { repeat = false, srgb = true } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

// ---------- textures ----------

/** Baize: a fine speckle over the green, so the cloth isn't a flat plastic sheet. */
function clothTexture() {
  const [c, g] = canvas(256, 256);
  g.fillStyle = '#1c8139';
  g.fillRect(0, 0, 256, 256);
  const img = g.getImageData(0, 0, 256, 256), d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (Math.random() - 0.5) * 18;
    d[i] += n * 0.6; d[i + 1] += n; d[i + 2] += n * 0.5;
  }
  g.putImageData(img, 0, 0);
  const t = texture(c, { repeat: true });
  t.repeat.set(5, 10);
  return t;
}

/** Dark polished wood with grain along the rails. */
function woodTexture(base = '#4a2312', w = 512, h = 128) {
  const [c, g] = canvas(w, h);
  g.fillStyle = base;
  g.fillRect(0, 0, w, h);
  for (let i = 0; i < 90; i++) {
    const y = Math.random() * h, amp = 1 + Math.random() * 4, ph = Math.random() * 6.3;
    g.strokeStyle = Math.random() < 0.6 ? 'rgba(20, 6, 0, 0.35)' : 'rgba(150, 80, 40, 0.18)';
    g.lineWidth = 0.6 + Math.random() * 2;
    g.beginPath();
    for (let x = 0; x <= w; x += 8) g.lineTo(x, y + Math.sin(x / 70 + ph) * amp);
    g.stroke();
  }
  return texture(c, { repeat: true });
}

/**
 * A ball's surface, wrapped round a sphere (Three's SphereGeometry: +y up, u round the equator).
 * As on the flat table: the 9 is white with a yellow stripe round its middle, and each numbered
 * ball has a white circle with its number on two opposite sides, on that same middle line.
 */
const DISC = Math.cos(Math.asin(0.46)); // the number circle's edge, as a dot product
const STRIPE = 0.56;
function ballTexture(id) {
  const W = 512, H = 256;
  const [c, g] = canvas(W, H);
  const hex = (s) => [1, 3, 5].map((i) => parseInt(s.slice(i, i + 2), 16));
  const base = hex(id === 9 ? '#f8fafc' : BALL_COLORS[id]), band = hex(BALL_COLORS[9]), white = [248, 250, 252];
  const img = g.createImageData(W, H), d = img.data;
  for (let py = 0; py < H; py++) {
    const theta = ((py + 0.5) / H) * Math.PI, y = Math.cos(theta), s = Math.sin(theta);
    for (let px = 0; px < W; px++) {
      const phi = ((px + 0.5) / W) * Math.PI * 2, z = Math.sin(phi) * s;
      let col = base;
      if (id === 9 && Math.abs(y) < STRIPE) col = band;
      if (id > 0 && Math.abs(z) > DISC) col = white;
      const i = (py * W + px) * 4;
      d[i] = col[0]; d[i + 1] = col[1]; d[i + 2] = col[2]; d[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  if (id > 0) {
    g.fillStyle = '#111';
    g.font = `800 ${id === 9 ? 46 : 50}px Lexend, system-ui, sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    for (const x of [W / 4, (3 * W) / 4]) {
      g.fillText(String(id), x, H / 2 + 3);
      if (id === 6 || id === 9) g.fillRect(x - 13, H / 2 + 24, 26, 4); // 6 and 9 underlined
    }
  }
  const t = texture(c);
  t.anisotropy = 4;
  return t;
}

/** A soft round shadow, dark in the middle, for under the balls. */
function blobTexture() {
  const [c, g] = canvas(64, 64);
  const r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  r.addColorStop(0, 'rgba(0, 0, 0, 0.62)');
  r.addColorStop(0.5, 'rgba(0, 0, 0, 0.34)');
  r.addColorStop(1, 'rgba(0, 0, 0, 0)');
  g.fillStyle = r;
  g.fillRect(0, 0, 64, 64);
  return texture(c, { srgb: false });
}

/**
 * The cue's surface, from the tip (bottom of the canvas) to the butt (top), round the cue
 * across: ferrule, maple shaft, joint, dark forearm with four pale points, black wrap, butt
 * sleeve with a pale ring, rubber bumper. Matches the flat view's cue.
 */
function cueTexture() {
  const W = 128, H = 1024;
  const [c, g] = canvas(W, H);
  const y = (t) => (1 - t) * H; // fraction along the cue → canvas row
  const band = (t0, t1, color) => { g.fillStyle = color; g.fillRect(0, y(t1), W, y(t0) - y(t1)); };
  const maple = g.createLinearGradient(0, y(0), 0, y(0.56));
  maple.addColorStop(0, '#f1dcae');
  maple.addColorStop(1, '#d8b173');
  g.fillStyle = maple;
  g.fillRect(0, y(0.56), W, y(0) - y(0.56));
  band(0.56, 0.74, '#3b1d10');
  // Four points reaching towards the tip, round the forearm.
  for (let k = 0; k < 4; k++) {
    const cx = (k + 0.5) * (W / 4);
    g.fillStyle = '#e9cf9b';
    g.beginPath();
    g.moveTo(cx, y(0.6));
    g.lineTo(cx - W / 10, y(0.735));
    g.lineTo(cx + W / 10, y(0.735));
    g.closePath();
    g.fill();
    g.fillStyle = '#b8862f';
    g.beginPath();
    g.moveTo(cx, y(0.64));
    g.lineTo(cx - W / 28, y(0.735));
    g.lineTo(cx + W / 28, y(0.735));
    g.closePath();
    g.fill();
  }
  band(0.74, 0.91, '#1b1b1f');
  g.strokeStyle = 'rgba(255, 255, 255, 0.07)';
  g.lineWidth = 1;
  for (let x = -60; x < W + 60; x += 5) { g.beginPath(); g.moveTo(x, y(0.74)); g.lineTo(x + 40, y(0.91)); g.stroke(); }
  band(0.91, 0.985, '#4a2412');
  band(0.94, 0.947, '#e9cf9b');
  band(0.985, 1, '#111');
  for (const [t0, t1] of [[0.555, 0.567], [0.737, 0.743], [0.907, 0.913]]) band(t0, t1, '#cfd6dd');
  band(0, 0.022, '#f7f4ec');
  return texture(c);
}

// ---------- the table ----------

/**
 * The outline of a region round the table's centre, sampled by angle: for each direction, the
 * distance to the edge of the box (inset by `inset` from the play area), then cut short by
 * a pocket (`cut`: the cloth stops at the pocket's near edge) or pushed out round it (the
 * rail's inner edge goes round the far side of the pocket). In the shape space (x, -z).
 */
function outline(inset, mode) {
  const L = PLAY_LEFT - inset, Rt = PLAY_RIGHT + inset, T = PLAY_TOP - inset, B = PLAY_BOTTOM + inset;
  const cx = TABLE_W / 2, cy = TABLE_H / 2;
  const pts = [];
  const N = 1440;
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2, dx = Math.cos(a), dy = Math.sin(a);
    let t = Infinity;
    if (dx > 0) t = Math.min(t, (Rt - cx) / dx); else if (dx < 0) t = Math.min(t, (L - cx) / dx);
    if (dy > 0) t = Math.min(t, (B - cy) / dy); else if (dy < 0) t = Math.min(t, (T - cy) / dy);
    for (const p of POCKETS) {
      const r = mode === 'cut' ? p.r : p.r + 3;
      const ox = cx - p.x, oy = cy - p.y;
      const bc = ox * dx + oy * dy, cc = ox * ox + oy * oy - r * r, disc = bc * bc - cc;
      if (disc < 0) continue;
      const near = -bc - Math.sqrt(disc), far = -bc + Math.sqrt(disc);
      if (mode === 'cut' && near > 0 && near < t) t = near;
      if (mode === 'round' && far > t && near < t + 1) t = far;
    }
    pts.push(new THREE.Vector2(wx(cx + dx * t), -wz(cy + dy * t)));
  }
  return pts;
}

/** The half-length of the chord a pocket's circle cuts on the line `coord` = c (axis 'x' or 'y'). */
function chord(p, axis, c, extra = 0) {
  const d = Math.abs((axis === 'x' ? p.x : p.y) - c), r = p.r + extra;
  return d < r ? Math.sqrt(r * r - d * d) : 0;
}

function makeTable(group, env, { fromAbove = false } = {}) {
  const clothMat = new THREE.MeshStandardMaterial({ map: clothTexture(), roughness: 0.95, metalness: 0 });
  const cushionMat = new THREE.MeshStandardMaterial({ color: 0x1b7f36, map: clothMat.map, roughness: 0.9 });
  const wood = woodTexture();
  wood.repeat.set(3, 1);
  // Varnished wood. Seen straight from above (the flat table's picture) the varnish would only
  // mirror the lamp overhead and wash the rails out, so it is kept faint there.
  const woodMat = new THREE.MeshPhysicalMaterial(fromAbove
    ? { map: wood, roughness: 0.6, clearcoat: 0.15, clearcoatRoughness: 0.5, envMap: env, envMapIntensity: 0.15 }
    : { map: wood, roughness: 0.35, clearcoat: 0.8, clearcoatRoughness: 0.25, envMap: env, envMapIntensity: 0.6 });
  const black = new THREE.MeshStandardMaterial({ color: 0x050505, roughness: 0.8, side: THREE.DoubleSide });

  // The cloth, with the pockets cut out of it.
  const cloth = new THREE.Mesh(new THREE.ShapeGeometry(new THREE.Shape(outline(CUSHION_W + 1, 'cut'))), clothMat);
  cloth.geometry.rotateX(-Math.PI / 2);
  cloth.receiveShadow = true;
  group.add(cloth);

  // The wooden rails: a frame round the cushions, its inner edge going round the pockets.
  const x0 = wx(-FRAME_OUT), x1 = wx(TABLE_W + FRAME_OUT), z0 = wz(-FRAME_OUT), z1 = wz(TABLE_H + FRAME_OUT), rr = 26;
  const frame = new THREE.Shape();
  frame.moveTo(x0 + rr, -z0);
  frame.lineTo(x1 - rr, -z0); frame.quadraticCurveTo(x1, -z0, x1, -z0 - rr);
  frame.lineTo(x1, -z1 + rr); frame.quadraticCurveTo(x1, -z1, x1 - rr, -z1);
  frame.lineTo(x0 + rr, -z1); frame.quadraticCurveTo(x0, -z1, x0, -z1 + rr);
  frame.lineTo(x0, -z0 - rr); frame.quadraticCurveTo(x0, -z0, x0 + rr, -z0);
  frame.holes.push(new THREE.Path(outline(CUSHION_W, 'round').reverse()));
  const frameGeo = new THREE.ExtrudeGeometry(frame, { depth: RAIL_TOP + 46, bevelEnabled: true, bevelThickness: 2, bevelSize: 2, bevelSegments: 2, curveSegments: 8 });
  frameGeo.rotateX(-Math.PI / 2);
  frameGeo.translate(0, -46, 0);
  group.add(new THREE.Mesh(frameGeo, woodMat));

  // Brass caps on the rail's four corners, as on the flat table: each follows the rail's rounded
  // outer corner and is cut round the corner pocket's hole. Drawn for the top-left corner, then
  // mirrored to the others.
  const brass = new THREE.MeshPhysicalMaterial({ color: 0xd99a32, metalness: 0.5, roughness: 0.3, clearcoat: 0.5, envMap: env, envMapIntensity: 1.3 }); // polished, but not so metallic it only mirrors the dark room
  const [cornerPocket] = POCKETS;
  const CAP = 50; // the cap's reach from the rail's outer corner
  const capOutline = () => {
    const pr = cornerPocket.r + 3, cx = cornerPocket.x, cy = cornerPocket.y;
    const e = -FRAME_OUT, far = e + CAP;
    const cut = Math.sqrt(pr * pr - (far - cx) ** 2); // where the cap's inner edges meet the hole
    const pts = [[far, e]];
    // The rail's rounded outer corner (radius rr, as the frame).
    for (let i = 0; i <= 8; i++) {
      const a = -Math.PI / 2 - (i / 8) * (Math.PI / 2);
      pts.push([e + rr + Math.cos(a) * rr, e + rr + Math.sin(a) * rr]);
    }
    pts.push([e, far], [cx - cut, far]);
    // Round the near side of the pocket's hole, back to the cap's other inner edge.
    const a0 = Math.atan2(far - cy, -cut), a1 = Math.atan2(-cut, far - cx);
    for (let i = 0; i <= 16; i++) {
      const a = a0 + ((a1 - a0 + (a1 < a0 ? Math.PI * 2 : 0)) * i) / 16;
      pts.push([cx + Math.cos(a) * pr, cy + Math.sin(a) * pr]);
    }
    pts.push([far, cy - cut]);
    return pts;
  };
  for (const [mx, my] of [[false, false], [true, false], [false, true], [true, true]]) {
    const pts = capOutline().map(([x, y]) => new THREE.Vector2(wx(mx ? TABLE_W - x : x), -wz(my ? TABLE_H - y : y)));
    const geo = new THREE.ExtrudeGeometry(new THREE.Shape(pts), { depth: 1.2, bevelEnabled: true, bevelThickness: 0.6, bevelSize: 0.6, bevelSegments: 2 });
    geo.rotateX(-Math.PI / 2);
    geo.translate(0, RAIL_TOP + 2, 0);
    group.add(new THREE.Mesh(geo, brass));
  }

  // The table's body under the rails, and its legs down to the floor.
  const bodyMat = new THREE.MeshStandardMaterial({ map: woodTexture('#2c1309'), roughness: 0.6 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(TABLE_W + 2 * FRAME_OUT - 16, 70, TABLE_H + 2 * FRAME_OUT - 16), bodyMat);
  body.position.y = -46 - 35;
  group.add(body);
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(46, 260, 46), bodyMat);
    leg.position.set(sx * (TABLE_W / 2 - 30), -116 - 130, sz * (TABLE_H / 2 - 40));
    group.add(leg);
  }

  // The cushions: six, each between two pockets, ending where it meets the pocket's mouth.
  const [TL, TR, ML, MR, BL, BR] = POCKETS;
  const runs = [
    { axis: 'y', c: PLAY_TOP, dir: -1, from: TL, to: TR },
    { axis: 'y', c: PLAY_BOTTOM, dir: 1, from: BL, to: BR },
    { axis: 'x', c: PLAY_LEFT, dir: -1, from: TL, to: ML },
    { axis: 'x', c: PLAY_LEFT, dir: -1, from: ML, to: BL },
    { axis: 'x', c: PLAY_RIGHT, dir: 1, from: TR, to: MR },
    { axis: 'x', c: PLAY_RIGHT, dir: 1, from: MR, to: BR },
  ];
  for (const r of runs) {
    const back = r.c + r.dir * CUSHION_W;
    const along = (p) => (r.axis === 'y' ? p.x : p.y);
    const a0 = along(r.from) + chord(r.from, r.axis, r.c, 1.5), a1 = along(r.to) - chord(r.to, r.axis, r.c, 1.5);
    const b0 = along(r.from) + chord(r.from, r.axis, back, 1.5), b1 = along(r.to) - chord(r.to, r.axis, back, 1.5);
    const pt = (a, c) => (r.axis === 'y' ? new THREE.Vector2(wx(a), -wz(c)) : new THREE.Vector2(wx(c), -wz(a)));
    const shape = new THREE.Shape([pt(a0, r.c), pt(a1, r.c), pt(b1, back), pt(b0, back)]);
    const geo = new THREE.ExtrudeGeometry(shape, { depth: CUSHION_H - 1.5, bevelEnabled: true, bevelThickness: 1.5, bevelSize: 1.2, bevelSegments: 2 });
    geo.rotateX(-Math.PI / 2);
    group.add(new THREE.Mesh(geo, cushionMat));
  }

  // The pockets: a hole in the cloth with a black well under it (starting at the cloth, so
  // nothing stands up from the table on the side the balls come from), and round the rail's
  // side only, black leather facing from the cloth up to a rolled liner on the rail.
  const WELL = 39.5; // down to just above the table's body
  const leather = new THREE.MeshStandardMaterial({ color: 0x0c0c0c, roughness: 0.6, envMapIntensity: 0.15 }); // a soft sheen, not a mirror
  for (const p of POCKETS) {
    const well = new THREE.Mesh(new THREE.CylinderGeometry(p.r + 0.5, p.r * 0.85, WELL, 32, 1, true), black);
    well.position.set(wx(p.x), -WELL / 2, wz(p.y));
    group.add(well);
    const floor = new THREE.Mesh(new THREE.CircleGeometry(p.r, 24).rotateX(-Math.PI / 2), black);
    floor.position.set(wx(p.x), -WELL, wz(p.y));
    group.add(floor);
    // The facing and liner run only where the rail is behind the hole: the part of the
    // circle past the cushions' back line. The rest (the mouth, between the cushion ends) is
    // open; `gap` is its angle and `mid` its direction (on the corner's diagonal, or straight
    // across for a side pocket).
    const rr = p.r + 3;
    let gapSteps = 0, mx = 0, my = 0;
    for (let i = 0; i < 360; i++) {
      const a = (i * Math.PI) / 180, x = p.x + rr * Math.cos(a), y = p.y + rr * Math.sin(a);
      const open = x > PLAY_LEFT - CUSHION_W && x < PLAY_RIGHT + CUSHION_W && y > PLAY_TOP - CUSHION_W && y < PLAY_BOTTOM + CUSHION_W;
      if (open) { gapSteps++; mx += Math.cos(a); my += Math.sin(a); }
    }
    const gap = (gapSteps * Math.PI) / 180, inward = Math.atan2(my, mx);
    // A cylinder's point at angle θ sits at table angle π/2 - θ, so starting the arc at
    // π/2 + gap/2 - inward leaves the opening centred on `inward`.
    const facing = new THREE.Mesh(new THREE.CylinderGeometry(p.r + 0.6, p.r + 0.5, RAIL_TOP + 2, 32, 1, true, // inside the rail's bevelled lip (it narrows the hole by 2)
       Math.PI / 2 + gap / 2 - inward, Math.PI * 2 - gap), black); // matt, so it doesn't catch the lamp
    facing.position.set(wx(p.x), (RAIL_TOP + 2) / 2, wz(p.y)); // up to the rail's top (its bevel adds 2)
    group.add(facing);
    const liner = new THREE.Mesh(new THREE.TorusGeometry(p.r + 3, 3.2, 10, 40, Math.PI * 2 - gap), leather);
    liner.rotation.x = -Math.PI / 2;
    // Laid flat, the torus's arc at angle θ sits at table angle -(θ + rotation.z), so it leaves
    // the gap between table angles -rotation.z and -rotation.z + gap: centre that on `inward`.
    liner.rotation.z = gap / 2 - inward;
    liner.position.set(wx(p.x), RAIL_TOP + 1.5, wz(p.y));
    group.add(liner);
  }

  // Sights (diamonds) on the rails: three between pockets, as on a real table.
  const pearl = new THREE.MeshStandardMaterial({ color: 0xf3ead8, roughness: 0.3 });
  const sight = new THREE.CircleGeometry(2.6, 4).rotateX(-Math.PI / 2);
  const railX = (side) => (side < 0 ? wx(PLAY_LEFT - CUSHION_W - RAIL_MID) : wx(PLAY_RIGHT + CUSHION_W + RAIL_MID));
  const railZ = (side) => (side < 0 ? wz(PLAY_TOP - CUSHION_W - RAIL_MID) : wz(PLAY_BOTTOM + CUSHION_W + RAIL_MID));
  for (let k = 1; k < 8; k++) {
    if (k === 4) continue;
    for (const side of [-1, 1]) {
      const m = new THREE.Mesh(sight, pearl);
      m.position.set(railX(side), RAIL_TOP + 2.2, wz(PLAY_TOP + (PLAY_H * k) / 8));
      group.add(m);
    }
  }
  for (let k = 1; k < 4; k++) {
    for (const side of [-1, 1]) {
      const m = new THREE.Mesh(sight, pearl);
      m.position.set(wx(PLAY_LEFT + (PLAY_W * k) / 4), RAIL_TOP + 2.2, railZ(side));
      group.add(m);
    }
  }
  // Head string and foot spot, faintly, as on the flat table.
  const spot = new THREE.Mesh(new THREE.CircleGeometry(2.2, 16).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55 }));
  spot.position.set(0, 0.2, wz(PLAY_TOP + PLAY_H * 0.26));
  group.add(spot);
}

/** Wood panelling: tall planks with dark gaps, and a rail along the top of the dado. */
function panelTexture() {
  const [c, g] = canvas(512, 256);
  g.fillStyle = '#3b2213';
  g.fillRect(0, 0, 512, 256);
  for (let x = 0; x < 512; x += 64) {
    const shade = 0.85 + Math.random() * 0.3;
    g.fillStyle = `rgba(${Math.round(70 * shade)}, ${Math.round(40 * shade)}, ${Math.round(22 * shade)}, 1)`;
    g.fillRect(x + 2, 0, 60, 256);
    g.strokeStyle = 'rgba(15, 6, 0, 0.35)';
    for (let i = 0; i < 6; i++) {
      const gx = x + 6 + Math.random() * 52;
      g.lineWidth = 0.5 + Math.random();
      g.beginPath(); g.moveTo(gx, 0); g.bezierCurveTo(gx + 6, 80, gx - 6, 170, gx + 2, 256); g.stroke();
    }
    g.fillStyle = 'rgba(0, 0, 0, 0.55)';
    g.fillRect(x, 0, 2, 256);
  }
  const t = texture(c, { repeat: true });
  t.repeat.set(14, 1);
  return t;
}

/** The hall round the table: a dark wooden floor and panelled walls, fading into the dark. */
function makeRoom(scene) {
  const FLOOR = -376, HALF = 1500, HEIGHT = 1500;
  const floorTex = woodTexture('#2a1a10', 256, 256);
  floorTex.repeat.set(10, 10);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(HALF * 2, HALF * 2).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.85 }));
  floor.position.y = FLOOR;
  scene.add(floor);
  const wallMat = new THREE.MeshStandardMaterial({ map: panelTexture(), roughness: 0.7 });
  for (let k = 0; k < 4; k++) {
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(HALF * 2, HEIGHT), wallMat);
    const a = (k * Math.PI) / 2;
    wall.position.set(Math.sin(a) * HALF, FLOOR + HEIGHT / 2, Math.cos(a) * HALF);
    wall.rotation.y = a + Math.PI; // facing the table
    scene.add(wall);
  }
  // Wall lamps: warm glows here and there along the walls.
  const [gc, gg] = canvas(64, 64);
  const glow = gg.createRadialGradient(32, 32, 0, 32, 32, 32);
  glow.addColorStop(0, 'rgba(255, 214, 150, 0.9)');
  glow.addColorStop(0.3, 'rgba(255, 170, 90, 0.35)');
  glow.addColorStop(1, 'rgba(255, 150, 60, 0)');
  gg.fillStyle = glow;
  gg.fillRect(0, 0, 64, 64);
  const glowMat = new THREE.SpriteMaterial({ map: texture(gc), transparent: true, depthWrite: false, fog: false });
  for (let k = 0; k < 4; k++) {
    const a = (k * Math.PI) / 2;
    for (const off of [-700, 0, 700]) {
      const sprite = new THREE.Sprite(glowMat);
      const along = new THREE.Vector3(Math.cos(a), 0, -Math.sin(a));
      sprite.position.set(Math.sin(a) * (HALF - 20), FLOOR + 820, Math.cos(a) * (HALF - 20)).addScaledVector(along, off);
      sprite.scale.set(260, 260, 1);
      scene.add(sprite);
    }
  }
}

/** Reflections for the glossy balls and wood: a dim hall with a bright lamp above. */
function environment(renderer) {
  const room = new THREE.Scene();
  const [c, g] = canvas(16, 256);
  const sky = g.createLinearGradient(0, 0, 0, 256);
  sky.addColorStop(0, '#3a3026');
  sky.addColorStop(0.5, '#1a140f');
  sky.addColorStop(1, '#0a0705');
  g.fillStyle = sky;
  g.fillRect(0, 0, 16, 256);
  room.add(new THREE.Mesh(new THREE.SphereGeometry(20, 32, 16), new THREE.MeshBasicMaterial({ map: texture(c), side: THREE.BackSide })));
  const [gc, gg] = canvas(128, 128);
  const glow = gg.createRadialGradient(64, 64, 0, 64, 64, 64);
  glow.addColorStop(0, 'rgba(255, 255, 255, 1)');
  glow.addColorStop(0.5, 'rgba(255, 255, 255, 0.4)');
  glow.addColorStop(1, 'rgba(255, 255, 255, 0)');
  gg.fillStyle = glow;
  gg.fillRect(0, 0, 128, 128);
  const glowTex = texture(gc);
  // Two long lamp shades over the table, as in a pool hall.
  for (const z of [-4, 4]) {
    const lamp = new THREE.Mesh(new THREE.PlaneGeometry(7, 3), new THREE.MeshBasicMaterial({ map: glowTex, color: new THREE.Color(4, 3.7, 3.2), transparent: true, depthWrite: false, side: THREE.DoubleSide }));
    lamp.position.set(0, 9, z);
    lamp.lookAt(0, 0, z);
    room.add(lamp);
  }
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromScene(room, 0.04).texture;
  pmrem.dispose();
  return env;
}

// ---------- the cue ----------

function makeCue() {
  const pts = [];
  const N = 48;
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    pts.push(new THREE.Vector2(CUE_TIP + (CUE_BUTT - CUE_TIP) * t ** 1.15, t * CUE_LEN));
  }
  const body = new THREE.Mesh(new THREE.LatheGeometry(pts, 20), new THREE.MeshStandardMaterial({ map: cueTexture(), roughness: 0.35 }));
  // The chalked blue tip, a short dome in front of the ferrule.
  const tip = new THREE.Mesh(new THREE.CylinderGeometry(CUE_TIP * 0.92, CUE_TIP, 2.2, 16), new THREE.MeshStandardMaterial({ color: 0x2f73b8, roughness: 0.9 }));
  tip.position.y = -1.1;
  const cue = new THREE.Group();
  cue.add(body, tip);
  cue.visible = false;
  return cue;
}

// ---------- flat marks on the cloth (the aiming guide) ----------

/** A pool of flat shapes on the cloth, reused every frame: strips, rings and dots. */
function marks(scene) {
  const strip = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  const ring = new THREE.RingGeometry(0.84, 1, 48).rotateX(-Math.PI / 2);
  const dot = new THREE.CircleGeometry(1, 20).rotateX(-Math.PI / 2);
  const pools = { strip: [], ring: [], dot: [] };
  const geos = { strip, ring, dot };
  const used = { strip: 0, ring: 0, dot: 0 };
  const get = (kind) => {
    let m = pools[kind][used[kind]];
    if (!m) {
      m = new THREE.Mesh(geos[kind], new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false }));
      m.renderOrder = 2;
      pools[kind].push(m);
      scene.add(m);
    }
    used[kind]++;
    m.visible = true;
    return m;
  };
  const paint = (m, color, opacity) => { m.material.color.set(color); m.material.opacity = opacity; };
  return {
    begin() { for (const k of Object.keys(used)) used[k] = 0; },
    end() { for (const k of Object.keys(pools)) for (let i = used[k]; i < pools[k].length; i++) pools[k][i].visible = false; },
    /** A straight strip from (x1, y1) to (x2, y2) in table units, `w` wide. */
    seg(x1, y1, x2, y2, w, color, opacity, lift = 0.4) {
      const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy);
      if (len < 0.5) return;
      const m = get('strip');
      m.position.set(wx((x1 + x2) / 2), lift, wz((y1 + y2) / 2));
      m.rotation.set(0, -Math.atan2(dy, dx), 0);
      m.scale.set(len, 1, w);
      paint(m, color, opacity);
    },
    /** Dashes along a polyline. */
    dashed(points, w, color, opacity, dash = 9, gap = 7) {
      for (let i = 1; i < points.length; i++) {
        const a = points[i - 1], b = points[i], len = Math.hypot(b.x - a.x, b.y - a.y);
        for (let s = 0; s < len; s += dash + gap) {
          const e = Math.min(len, s + dash);
          this.seg(a.x + ((b.x - a.x) * s) / len, a.y + ((b.y - a.y) * s) / len, a.x + ((b.x - a.x) * e) / len, a.y + ((b.y - a.y) * e) / len, w, color, opacity);
        }
      }
    },
    line(points, w, color, opacity) {
      for (let i = 1; i < points.length; i++) this.seg(points[i - 1].x, points[i - 1].y, points[i].x, points[i].y, w, color, opacity);
    },
    ring(x, y, r, color, opacity, lift = 0.5) {
      const m = get('ring');
      m.position.set(wx(x), lift, wz(y));
      m.scale.set(r, 1, r);
      paint(m, color, opacity);
    },
    dot(x, y, r, color, opacity) {
      const m = get('dot');
      m.position.set(wx(x), 0.45, wz(y));
      m.scale.set(r, 1, r);
      paint(m, color, opacity);
    },
  };
}

const WHITE = 0xffffff, RED = 0xf43f5e, GREEN = 0x34d399, GOLD = 0xfacc15, SKY = 0xbfdbfe;

/**
 * A ball's lane along a path: a see-through strip a ball wide, with brighter edges. Every path
 * in the guide is drawn this way (the cue ball's, the struck ball's, the glance), plain or
 * extended. `strength` scales how solid it looks.
 */
function lane(m, points, tone, strength = 1) {
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i], len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const nx = -(b.y - a.y) / len, ny = (b.x - a.x) / len;
    m.seg(a.x, a.y, b.x, b.y, R * 2, tone, 0.13 * strength);
    for (const s of [-1, 1]) m.seg(a.x + nx * R * s, a.y + ny * R * s, b.x + nx * R * s, b.y + ny * R * s, 1.3, tone, Math.min(0.9, 0.55 * strength));
  }
}

/** The aiming guide, as on the flat table: the cue ball's lane to the ghost ball, then the struck ball's line. */
function drawGuide(m, ghostBall, balls, angle) {
  const cue = cueBall(balls);
  const ray = aimRay(balls, angle);
  const target = lowestBall(balls);
  const legal = ray.hit && target && ray.hit.id === target.id;
  const tone = ray.hit && !legal ? RED : WHITE;
  lane(m, [cue, ray], tone);
  ghost(ghostBall, ray, ray.hit ? (legal ? GREEN : RED) : WHITE);
  m.ring(ray.x, ray.y, R + 1, ray.hit ? (legal ? GREEN : RED) : WHITE, 0.9);
  if (ray.hit) {
    const dir = Math.atan2(ray.hit.y - ray.y, ray.hit.x - ray.x);
    lane(m, [ray.hit, { x: ray.hit.x + Math.cos(dir) * 110, y: ray.hit.y + Math.sin(dir) * 110 }], legal ? GOLD : RED, 1.5);
  }
}

/** The extended guide: the cue ball's path to its first bounce, the struck ball's, and the glance. */
function drawExtendedGuide(m, ghostBall, balls, angle) {
  const cue = cueBall(balls);
  const target = lowestBall(balls);
  const path = tracePath(balls, cue, angle, { ignore: [0], bounces: 1, maxLen: 2600 });
  const end = path.points.at(-1);
  const legal = path.hit && target && path.hit.id === target.id;
  lane(m, path.points, path.hit && !legal ? RED : WHITE);
  for (const p of path.points.slice(1, -1)) m.dot(p.x, p.y, 3.4, WHITE, 0.85); // where it bounces
  if (path.pocket) m.ring(path.pocket.x, path.pocket.y, path.pocket.r + 4, RED, 0.95, RAIL_TOP + 0.6);
  if (!path.hit) { ghost(ghostBall, null); return; }
  ghost(ghostBall, end, legal ? GREEN : RED);
  m.ring(end.x, end.y, R + 1, legal ? GREEN : RED, 0.95);
  const hitDir = Math.atan2(path.hit.y - end.y, path.hit.x - end.x);
  const run = tracePath(balls, path.hit, hitDir, { ignore: [0, path.hit.id], bounces: 1, maxLen: 1600 });
  lane(m, run.points, legal ? GOLD : RED, 1.5);
  for (const p of run.points.slice(1, -1)) m.dot(p.x, p.y, 3.4, legal ? GOLD : RED, 0.9); // where it bounces
  if (run.pocket && legal) m.ring(run.pocket.x, run.pocket.y, run.pocket.r + 4, GREEN, 0.95, RAIL_TOP + 0.6);
  const inX = Math.cos(angle), inY = Math.sin(angle), nX = Math.cos(hitDir), nY = Math.sin(hitDir);
  const along = inX * nX + inY * nY;
  const tx = inX - along * nX, ty = inY - along * nY, tl = Math.hypot(tx, ty);
  if (tl > 0.08) {
    const glance = tracePath(balls, end, Math.atan2(ty, tx), { ignore: [0, path.hit.id], bounces: 1, maxLen: 70 + 230 * tl });
    lane(m, glance.points, SKY, 0.7);
  }
}

/** The see-through ball where the cue ball will meet the first ball. */
function ghost(mesh, at, color = WHITE) {
  mesh.visible = !!at;
  if (!at) return;
  mesh.position.set(wx(at.x), R, wz(at.y));
  mesh.material.color.set(color);
}

/**
 * How steeply the cue rises behind the ball (radians): a little, or more near a cushion so it
 * clears the rail (as a player lifts it), its underside above the rail's top at the rail's
 * inner edge.
 */
function cueRaise(c, aim, cueView) {
  const ax = Math.cos(aim), az = Math.sin(aim);
  let toRail = Infinity; // from the ball back to the cushion's nose
  if (ax < 0) toRail = Math.min(toRail, (PLAY_RIGHT - c.x) / -ax); else if (ax > 0) toRail = Math.min(toRail, (c.x - PLAY_LEFT) / ax);
  if (az < 0) toRail = Math.min(toRail, (PLAY_BOTTOM - c.y) / -az); else if (az > 0) toRail = Math.min(toRail, (c.y - PLAY_TOP) / az);
  const over = Math.max(4, toRail + CUSHION_W - cueView.back); // from the tip to the rail's inner edge
  return Math.min(0.45, Math.max(CUE_RAISE, Math.atan((RAIL_TOP + 2 + CUE_BUTT - (R + cueView.lift)) / over)));
}

// ---------- the scene ----------

/**
 * Creates the 3D view on `canvasEl`. Returns { render(view, dt), resize(w, h), pick(x, y),
 * project(x, y), reset(), dispose() }; pick and project use client (screen) coordinates.
 * `view`: { balls, aim, state, showGuide, extended, placing, isBreak, now,
 *           cue: null | { back, side, lift } } (the cue tip's distance behind the ball, its
 *           offset to the right and up, in table units).
 */
/** The renderer's colour handling, the same for the 3D view and the flat table's picture. */
function setUpRenderer(renderer) {
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
}

/** The table under its lamp, with the hall's reflections (and the room round it, if `room`). */
function makeWorld(renderer, { room = true, fromAbove = false } = {}) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0d0a08);
  if (room) scene.fog = new THREE.Fog(0x120c08, 1400, 3400);
  const env = environment(renderer);
  scene.environment = env;
  // A lamp over the table: bright on the cloth, falling off past the rails; a dim fill round it.
  scene.add(new THREE.HemisphereLight(0xfff4e0, 0x2a1d14, 1.1));
  const lamp = new THREE.SpotLight(0xfff1dc, 3.4, 0, 0.56, 0.75, 0);
  lamp.position.set(0, 1100, 0);
  lamp.target.position.set(0, 0, 0);
  scene.add(lamp, lamp.target);
  const table = new THREE.Group();
  makeTable(table, env, { fromAbove });
  scene.add(table);
  if (room) makeRoom(scene);
  return { scene, env };
}

/**
 * The 3D table seen straight from above, exactly over the flat table's box (TABLE_W × TABLE_H
 * table units), as a `w` × `h` canvas: the flat view draws it as its table (render.js
 * setTableImage), so both views show the same table. Renders once and lets the WebGL context go.
 */
export function renderTableImage(w, h) {
  const glCanvas = document.createElement('canvas');
  const renderer = new THREE.WebGLRenderer({ canvas: glCanvas, antialias: true });
  try {
    renderer.setPixelRatio(1);
    renderer.setSize(w, h, false);
    setUpRenderer(renderer);
    const { scene } = makeWorld(renderer, { room: false, fromAbove: true });
    // Straight down, the table's head (y = 0) at the top.
    const camera = new THREE.OrthographicCamera(-TABLE_W / 2, TABLE_W / 2, TABLE_H / 2, -TABLE_H / 2, 1, 3000);
    camera.position.set(0, 1500, 0);
    camera.up.set(0, 0, -1);
    camera.lookAt(0, 0, 0);
    renderer.render(scene, camera);
    const out = document.createElement('canvas');
    out.width = w;
    out.height = h;
    out.getContext('2d').drawImage(glCanvas, 0, 0, w, h);
    return out;
  } finally {
    renderer.dispose();
    renderer.forceContextLoss();
  }
}

export function createScene3d(canvasEl) {
  const renderer = new THREE.WebGLRenderer({ canvas: canvasEl, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  setUpRenderer(renderer);
  const { scene, env } = makeWorld(renderer);
  const camera = new THREE.PerspectiveCamera(52, 1, 2, 6000);

  // The balls, each with its texture and a soft shadow under it.
  const sphere = new THREE.SphereGeometry(R, 40, 28);
  const shadowGeo = new THREE.PlaneGeometry(R * 2.9, R * 2.9).rotateX(-Math.PI / 2);
  const shadowMat = new THREE.MeshBasicMaterial({ map: blobTexture(), transparent: true, depthWrite: false });
  const meshes = new Map(); // id → { ball, shadow, rx, ry, tw }
  for (let id = 0; id <= 9; id++) {
    const ball = new THREE.Mesh(sphere, new THREE.MeshPhysicalMaterial({
      map: ballTexture(id), roughness: 0.22, clearcoat: 1, clearcoatRoughness: 0.05, envMapIntensity: 0.7, transparent: true,
    }));
    const shadow = new THREE.Mesh(shadowGeo, shadowMat);
    shadow.renderOrder = 1;
    scene.add(ball, shadow);
    meshes.set(id, { ball, shadow, rx: 0, ry: 0, tw: 0 });
  }
  const ghostBall = new THREE.Mesh(sphere, new THREE.MeshBasicMaterial({ color: WHITE, transparent: true, opacity: 0.22, depthWrite: false }));
  scene.add(ghostBall);
  const cue = makeCue();
  scene.add(cue);
  const m = marks(scene);

  const seen = new Map(); // id → { x, y, pocketed } as last drawn
  const drops = []; // { id, from, pocket, start }
  const cam = { pos: new THREE.Vector3(0, 900, 700), look: new THREE.Vector3(), up: new THREE.Vector3(0, 1, 0), yaw: -Math.PI / 2, ready: false };
  let watch = null; // where the camera watches a shot from: { x, y, angle }
  let size = { w: 1, h: 1, top: 0, bottom: 0 };
  let lastKey = '';

  /** Numbers up, turned a little towards the player's end, as after racking. */
  function reset() {
    for (const [, s] of meshes) {
      s.ball.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 1, 0.7).normalize());
      s.rx = s.ry = s.tw = null;
    }
    seen.clear();
    drops.length = 0;
    watch = null;
  }
  reset();

  const axis = new THREE.Vector3(), turn = new THREE.Quaternion(), UP = new THREE.Vector3(0, 1, 0);
  /** Turns a ball by how far its surface has rolled since the last frame (rollX, rollY) and its side spin. */
  function spinBall(s, b) {
    if (s.rx == null) { s.rx = b.rollX ?? 0; s.ry = b.rollY ?? 0; s.tw = b.twist ?? 0; return; }
    const dx = (b.rollX ?? 0) - s.rx, dz = (b.rollY ?? 0) - s.ry, d = Math.hypot(dx, dz);
    if (d > 1e-4 && d < R * 20) {
      axis.set(dz / d, 0, -dx / d);
      turn.setFromAxisAngle(axis, d / R);
      s.ball.quaternion.premultiply(turn);
    }
    const tw = (b.twist ?? 0) - s.tw;
    if (Math.abs(tw) > 1e-4 && Math.abs(tw) < 6) s.ball.quaternion.premultiply(turn.setFromAxisAngle(UP, -tw));
    s.rx = b.rollX ?? 0;
    s.ry = b.rollY ?? 0;
    s.tw = b.twist ?? 0;
  }

  function noteDrops(balls, now) {
    for (const b of balls) {
      const last = seen.get(b.id);
      if (b.pocketed && last && !last.pocketed) {
        const pocket = POCKETS.reduce((a, p) => (Math.hypot(p.x - last.x, p.y - last.y) < Math.hypot(a.x - last.x, a.y - last.y) ? p : a));
        drops.push({ id: b.id, from: { x: last.x, y: last.y }, pocket, start: now });
      }
      seen.set(b.id, { x: b.x, y: b.y, pocketed: b.pocketed });
    }
  }

  /** Where the camera wants to be for this moment of the game. */
  function cameraGoal(view) {
    const { balls, state } = view;
    const c = cueBall(balls);
    if (state === 'placing') {
      // Straight down over the whole table, its head at the top of the screen.
      const half = THREE.MathUtils.degToRad(camera.fov / 2);
      // Fitted into the part of the screen the page's controls leave clear (resize): of the
      // camera's picture (the canvas plus `top`, centred below the top controls), the table
      // may use the half-height down to the bottom controls.
      const full = size.h + size.top;
      const usable = Math.max(0.3, ((size.h - size.top) / 2 - size.bottom) / (full / 2));
      // (Measured at the rail's top, which is nearer the eye than the cloth, plus a margin.)
      const h = RAIL_TOP + Math.max((TABLE_H / 2 + FRAME_OUT + 10) / (Math.tan(half) * usable), (TABLE_W / 2 + FRAME_OUT + 12) / (Math.tan(half) * camera.aspect));
      return { pos: new THREE.Vector3(0, h, 0.01), look: new THREE.Vector3(0, 0, 0), up: new THREE.Vector3(0, 0, -1), rate: 5 };
    }
    if (state === 'shooting' && watch) {
      // Up and back from where the shot was played, looking down the table the way it went.
      const dx = Math.cos(watch.angle), dz = Math.sin(watch.angle);
      const x = wx(watch.x), z = wz(watch.y);
      return { pos: new THREE.Vector3(x - dx * 250, 330, z - dz * 250), look: new THREE.Vector3(x + dx * 230, 0, z + dz * 230), up: UP, rate: 2.2 };
    }
    if (!c || c.pocketed || state === 'over' || state === 'toss' || state === 'push-choice') {
      // The whole table from the player's end.
      return { pos: new THREE.Vector3(0, 760, wz(TABLE_H) + 520), look: new THREE.Vector3(0, 0, 40), up: UP, rate: 2.5 };
    }
    // Aiming (the player or the AI): behind the cue ball, turned with the aim; above the cue
    // when it is lifted over a rail, as a player leans over it.
    const yaw = cam.yaw;
    const dx = Math.cos(yaw), dz = Math.sin(yaw);
    const x = wx(c.x), z = wz(c.y);
    let up = AIM_UP;
    if (view.cue) {
      const raise = cueRaise(c, view.aim, view.cue);
      up = Math.max(AIM_UP, R + view.cue.lift + (AIM_BACK - view.cue.back) * Math.tan(raise) + 45);
    }
    return {
      pos: new THREE.Vector3(x - dx * AIM_BACK, up, z - dz * AIM_BACK),
      look: new THREE.Vector3(x + dx * AIM_AHEAD, 0, z + dz * AIM_AHEAD),
      up: UP,
      rate: 9,
    };
  }

  function render(view, dt) {
    const { balls, now } = view;
    // A shot starting: remember where it was played from, for the camera to watch it.
    if (view.state === 'shooting') {
      if (!watch) { const c = cueBall(balls); watch = { x: c.x, y: c.y, angle: view.aim }; }
    } else watch = null;

    // The aim's direction, smoothed so the camera swings round the ball instead of jumping.
    const k = (rate) => 1 - Math.exp(-(dt / 1000) * rate);
    const aiming = !['placing', 'shooting', 'over', 'toss', 'push-choice'].includes(view.state);
    if (!cam.ready) cam.yaw = view.aim;
    else cam.yaw = wrapAngle(cam.yaw + wrapAngle(view.aim - cam.yaw) * (aiming ? k(view.dragging ? 40 : 10) : 1));
    const goal = cameraGoal(view);
    if (!cam.ready) {
      cam.pos.copy(goal.pos); cam.look.copy(goal.look); cam.up.copy(goal.up); cam.ready = true;
    } else {
      const t = k(view.dragging && aiming ? 40 : goal.rate);
      cam.pos.lerp(goal.pos, t);
      cam.look.lerp(goal.look, t);
      cam.up.lerp(goal.up, t).normalize();
    }
    const settling = cam.pos.distanceToSquared(goal.pos) > 0.04 || cam.look.distanceToSquared(goal.look) > 0.04;

    noteDrops(balls, now);
    const key = `${view.state}|${view.aim.toFixed(5)}|${view.showGuide}|${view.extended}|${view.placing}|${view.cue ? `${view.cue.back.toFixed(2)},${view.cue.side.toFixed(2)},${view.cue.lift.toFixed(2)}` : ''}|${balls.map((b) => `${b.x.toFixed(2)},${b.y.toFixed(2)},${b.pocketed}`).join(';')}|${size.w}x${size.h}`;
    // Nothing moved: keep the last picture (saves the battery while a player thinks).
    if (key === lastKey && !settling && !drops.length) return;
    lastKey = key;

    camera.position.copy(cam.pos);
    camera.up.copy(cam.up);
    camera.lookAt(cam.look);

    const target = lowestBall(balls);
    for (const b of balls) {
      const s = meshes.get(b.id);
      const drop = drops.find((d) => d.id === b.id);
      if (b.pocketed && !drop) { s.ball.visible = s.shadow.visible = false; s.rx = null; continue; }
      s.ball.visible = true;
      if (drop) {
        // Into the pocket: across to its middle and down the well, faster as it falls.
        const t = Math.min(1, (now - drop.start) / DROP_MS), e = t * t;
        s.ball.position.set(wx(lerp(drop.from.x, drop.pocket.x, Math.min(1, t * 1.6))), R - e * 44, wz(lerp(drop.from.y, drop.pocket.y, Math.min(1, t * 1.6))));
        s.shadow.visible = false;
        continue;
      }
      spinBall(s, b);
      s.ball.position.set(wx(b.x), R, wz(b.y));
      s.shadow.visible = true;
      s.shadow.position.set(wx(b.x) + 1.5, 0.15, wz(b.y) + 2.5);
      const faint = view.placing && b.id === 0 && !validPlacement(balls, b.x, b.y, view.isBreak);
      // A ball right in front of the eye (behind the cue ball) is see-through, so it doesn't hide the shot.
      const near = b.id !== 0 && s.ball.position.distanceTo(cam.pos) < 120;
      s.ball.material.opacity = faint ? 0.45 : near ? 0.35 : 1;
      s.ball.material.depthWrite = !near;
    }
    for (let i = drops.length - 1; i >= 0; i--) if (now - drops[i].start > DROP_MS) drops.splice(i, 1);

    // The guide, and a gold ring round the ball to hit next.
    m.begin();
    if (target && (view.showGuide || view.placing)) m.ring(target.x, target.y, R + 4, GOLD, 0.85);
    if (view.showGuide) (view.extended ? drawExtendedGuide : drawGuide)(m, ghostBall, balls, view.aim);
    else ghost(ghostBall, null);
    m.end();

    // The cue, lined up behind the cue ball, its butt raised a little.
    const c = cueBall(balls);
    cue.visible = !!(view.cue && c && !c.pocketed);
    if (cue.visible) {
      const ax = Math.cos(view.aim), az = Math.sin(view.aim);
      const raise = cueRaise(c, view.aim, view.cue);
      const back = new THREE.Vector3(-ax * Math.cos(raise), Math.sin(raise), -az * Math.cos(raise));
      const right = new THREE.Vector3(-az, 0, ax);
      const tip = new THREE.Vector3(wx(c.x), R + view.cue.lift, wz(c.y))
        .addScaledVector(new THREE.Vector3(-ax, 0, -az), view.cue.back)
        .addScaledVector(right, view.cue.side);
      cue.position.copy(tip);
      cue.quaternion.setFromUnitVectors(UP, back);
    }
    renderer.render(scene, camera);
  }

  /**
   * The canvas's size, and how much of its top and bottom the page's own controls cover
   * (`top`: the bar, players and ball strip; `bottom`: prompts and the spin button). The picture
   * is centred in the part below the top ones: the camera sees a taller picture whose middle is
   * there, of which the canvas shows the top part.
   */
  function resize(w, h, { top = 0, bottom = 0 } = {}) {
    size = { w: Math.max(1, Math.round(w)), h: Math.max(1, Math.round(h)), top: Math.round(top), bottom: Math.round(bottom) };
    renderer.setSize(size.w, size.h, false);
    const full = size.h + size.top;
    camera.aspect = size.w / full;
    // A narrow phone screen sees more of the table with a wider view.
    camera.fov = size.w / (size.h - size.top) < 0.62 ? 60 : 52;
    camera.setViewOffset(size.w, full, 0, 0, size.w, size.h);
    camera.updateProjectionMatrix();
    lastKey = '';
  }

  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), plane = new THREE.Plane(UP, -R), hit = new THREE.Vector3();
  /** The table point (table units) under a screen point, or null off the table's plane. */
  function pick(clientX, clientY) {
    const r = canvasEl.getBoundingClientRect();
    ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    if (!ray.ray.intersectPlane(plane, hit)) return null;
    return { x: hit.x + TABLE_W / 2, y: hit.z + TABLE_H / 2 };
  }
  /** Where a table point is on screen, in CSS pixels from the canvas's top left. */
  function project(x, y) {
    const v = new THREE.Vector3(wx(x), R, wz(y)).project(camera);
    return { x: ((v.x + 1) / 2) * size.w, y: ((1 - v.y) / 2) * size.h }; // (the view offset is in the projection)
  }
  /** Points the camera at the game at once (a new rack, or coming back to the 3D view). */
  function snap() { cam.ready = false; lastKey = ''; }

  return { render, resize, pick, project, reset, snap, dispose: () => renderer.dispose() };
}

/** Whether this phone can draw WebGL at all. */
export function webglAvailable() {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}

