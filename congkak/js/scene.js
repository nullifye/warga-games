// Congkak in 3D (Three.js from shared/vendor), modelled on a traditional board: dark
// maroon lacquered wood with chamfered ends, deep round holes, carved stars and ferns, and glass
// marbles, seen at an angle from one end. A hand sows the marbles one by one and
// the camera follows it. HTML labels over the canvas show each hole's and store's count; a counter
// at the top of the board area shows how many marbles the hand holds.
import * as THREE from '../../shared/vendor/three.module.min.js';
import { PLAYER, AI, STORE } from './rules.js';

const HOLE_R = 0.45; // bigger holes, but always smaller than the stores
const HOLE_DEPTH = 0.42;
const STORE_R = 0.7;
const STORE_DEPTH = 0.46;
const TOP = 0.5; // the board's top surface
const HALF_L = 5.55; // half the board's length (to the end of each round end)
const HALF_W = 1.42; // half its width: each end is a half circle this wide
const MARBLE_R = 0.105;
const HAND_Y = 1.05; // the hand's height while travelling
// Glass marbles as in a real set: mostly greens, blues and teals, a few amber.
const MARBLE_COLORS = [0x1b7a4a, 0x2f8fd8, 0x16989a, 0x2a4fb5, 0x35b071, 0x1f3f8f, 0x5fb3c9, 0xc8902a];
const SLEEVE = [0x2f5d9e, 0xa83a2c]; // the player's sleeve, the AI's

/**
 * Where hole or store `i` is on the board (x along the board, z across). The player sits on the
 * -z side, the AI on the +z side. As traditionally played, sowing runs clockwise: seen from the
 * player's seat, along their row from right to left into their store at their left end (+x),
 * then along the AI's row into the AI's store (-x). Hole i and its opposite (13 - i) share x.
 */
export const SIDE = [-1, 1]; // z side of the player's row, the AI's
export function spot(i) {
  if (i === STORE[PLAYER]) return { x: 4.42, z: 0 };
  if (i === STORE[AI]) return { x: -4.42, z: 0 };
  return { x: (i < 7 ? i : 13 - i) * 1.02 - 3.06, z: (i < 7 ? SIDE[PLAYER] : SIDE[AI]) * 0.7 };
}

const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const easeOut = (t) => 1 - (1 - t) ** 3;
const lerp = (a, b, t) => a + (b - a) * t;

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')];
}
function texture(c, repeat = true) {
  const t = new THREE.CanvasTexture(c);
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** Wavy grain lines across a canvas area, seamless left to right. */
function grain(g, w, h, dark, light, lines = 170) {
  for (let i = 0; i < lines; i++) {
    const y0 = Math.random() * h, amp = 2 + Math.random() * 8, k = 1 + Math.floor(Math.random() * 3), ph = Math.random() * 6.3;
    g.strokeStyle = Math.random() < 0.65 ? dark : light;
    g.globalAlpha = 0.04 + Math.random() * 0.1;
    g.lineWidth = 0.6 + Math.random() * 2.6;
    for (const dy of [-h, 0, h]) {
      g.beginPath();
      for (let x = 0; x <= w; x += 8) {
        const y = y0 + dy + Math.sin((x / w) * Math.PI * 2 * k + ph) * amp;
        if (x) g.lineTo(x, y); else g.moveTo(x, y);
      }
      g.stroke();
    }
  }
  g.globalAlpha = 1;
}

/** Plain lacquered grain, repeating: the board's sides and the inside of the holes. */
function lacquerTexture(base) {
  const [c, g] = canvas(512, 512);
  g.fillStyle = base;
  g.fillRect(0, 0, 512, 512);
  grain(g, 512, 512, '#1e0505', '#b0503a');
  return texture(c);
}

/** The board's top in one picture: grain, red rims round the holes, carved stars and ferns. */
function topTexture() {
  const W = 2048, H = Math.round((W * HALF_W) / HALF_L);
  const [c, g] = canvas(W, H);
  const X = (x) => ((x + HALF_L) / (2 * HALF_L)) * W;
  const Z = (z) => ((z + HALF_W) / (2 * HALF_W)) * H;
  const U = W / (2 * HALF_L); // pixels per unit
  const bg = g.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, '#521312');
  bg.addColorStop(0.5, '#64191a');
  bg.addColorStop(1, '#4a1110');
  g.fillStyle = bg;
  g.fillRect(0, 0, W, H);
  grain(g, W, H, '#1a0404', '#c0563f', 420);
  // Worn, lighter wood along the middle where hands rest.
  const wear = g.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, W * 0.45);
  wear.addColorStop(0, 'rgba(150, 60, 45, 0.18)');
  wear.addColorStop(1, 'rgba(150, 60, 45, 0)');
  g.fillStyle = wear;
  g.fillRect(0, 0, W, H);

  // A carved line: a dark cut with a cream face, as on the real boards.
  const carve = (draw, width = 0.022) => {
    g.lineCap = 'round';
    g.lineJoin = 'round';
    g.save();
    g.translate(1.2, 1.6);
    g.strokeStyle = 'rgba(20, 3, 3, 0.75)';
    g.lineWidth = width * U * 1.25;
    draw();
    g.restore();
    g.strokeStyle = '#e8cf9e';
    g.lineWidth = width * U;
    draw();
  };
  const star = (x, z, r) => carve(() => {
    g.beginPath();
    for (let k = 0; k < 8; k++) {
      const a = (k * Math.PI) / 4 + Math.PI / 8, len = k % 2 ? r * 0.62 : r;
      g.moveTo(X(x), Z(z));
      g.lineTo(X(x + Math.cos(a) * len), Z(z + Math.sin(a) * len));
    }
    g.stroke();
  }, 0.02);
  /** A fern: a curved stem from (x0,z0) to (x1,z1) bowing by `bow`, with paired leaflets. */
  const fern = (x0, z0, x1, z1, bow) => carve(() => {
    const pts = [];
    for (let i = 0; i <= 24; i++) {
      const t = i / 24, nx = -(z1 - z0), nz = x1 - x0, len = Math.hypot(nx, nz);
      const b = Math.sin(Math.PI * t) * bow;
      pts.push([x0 + (x1 - x0) * t + (nx / len) * b, z0 + (z1 - z0) * t + (nz / len) * b]);
    }
    g.beginPath();
    pts.forEach(([x, z], i) => (i ? g.lineTo(X(x), Z(z)) : g.moveTo(X(x), Z(z))));
    for (let i = 3; i < 23; i += 2) {
      const [x, z] = pts[i], [xn, zn] = pts[i + 1];
      const dx = xn - x, dz = zn - z, d = Math.hypot(dx, dz);
      const leaf = 0.2 * (1 - i / 30);
      for (const side of [-1, 1]) {
        const a = Math.atan2(dz, dx) + side * 0.6;
        g.moveTo(X(x), Z(z));
        g.lineTo(X(x + Math.cos(a) * leaf), Z(z + Math.sin(a) * leaf));
      }
      if (d === 0) break;
    }
    g.stroke();
  }, 0.016);

  // Red, slightly lighter rims round every hole and store.
  for (let i = 0; i < 16; i++) {
    const p = spot(i), r = i >= 14 ? STORE_R : HOLE_R;
    g.beginPath();
    g.arc(X(p.x), Z(p.z), (r + 0.018) * U, 0, Math.PI * 2);
    g.strokeStyle = 'rgba(190, 52, 44, 0.85)';
    g.lineWidth = 0.034 * U;
    g.stroke();
  }
  // Stars between the rows and at each tip; ferns along the ends.
  for (let k = 0; k < 6; k++) star(-2.55 + k * 1.02, 0, 0.17);
  for (const sx of [-1, 1]) {
    fern(sx * 3.55, 1.24, sx * 4.95, 0.98, -sx * 0.1);
    fern(sx * 3.55, -1.24, sx * 4.95, -0.98, sx * 0.1);
  }
  const t = texture(c, false);
  // Extrude caps use the shape's own x/y as UVs: map the board's extent onto the picture.
  t.repeat.set(1 / (2 * HALF_L), 1 / (2 * HALF_W));
  t.offset.set(0.5, 0.5);
  return t;
}

/** The hole's inside: straight walls, then a rounded bottom. Rim at y = 0. */
function hollow(radius, depth, material) {
  const pts = [new THREE.Vector2(radius, 0.02), new THREE.Vector2(radius, -depth * 0.68)];
  for (let k = 1; k <= 10; k++) {
    const a = (k / 10) * (Math.PI / 2);
    pts.push(new THREE.Vector2(Math.max(0.001, radius * Math.cos(a)), -depth * 0.68 - depth * 0.32 * Math.sin(a)));
  }
  const m = new THREE.Mesh(new THREE.LatheGeometry(pts, 48), material);
  m.receiveShadow = true;
  return m;
}

/** The congkak board: long, with chamfered ends, 14 holes and a round store at each end. */
function makeBoard() {
  const group = new THREE.Group();
  const shape = new THREE.Shape();
  const L = HALF_L - HALF_W; // the centre of each round end
  shape.moveTo(-L, -HALF_W);
  shape.lineTo(L, -HALF_W);
  shape.absarc(L, 0, HALF_W, -Math.PI / 2, Math.PI / 2, false);
  shape.lineTo(-L, HALF_W);
  shape.absarc(-L, 0, HALF_W, Math.PI / 2, (3 * Math.PI) / 2, false);
  // Shape y becomes world -z once the board is laid flat.
  for (let i = 0; i < 16; i++) {
    const p = spot(i), hole = new THREE.Path();
    hole.absarc(p.x, -p.z, i >= 14 ? STORE_R : HOLE_R, 0, Math.PI * 2, true);
    shape.holes.push(hole);
  }
  const geo = new THREE.ExtrudeGeometry(shape, { depth: TOP - 0.06, bevelEnabled: true, bevelThickness: 0.06, bevelSize: 0.06, bevelSegments: 4, curveSegments: 48 });
  geo.rotateX(-Math.PI / 2); // extruded 0 → TOP-0.06, with the bevel: top surface at TOP
  const lacquer = { roughness: 0.42, metalness: 0, clearcoat: 0.55, clearcoatRoughness: 0.38 };
  const top = new THREE.MeshPhysicalMaterial({ map: topTexture(), ...lacquer });
  const sideTex = lacquerTexture('#6a1d18');
  sideTex.repeat.set(0.35, 0.35);
  const side = new THREE.MeshPhysicalMaterial({ map: sideTex, ...lacquer });
  const body = new THREE.Mesh(geo, [top, side]);
  body.castShadow = body.receiveShadow = true;
  group.add(body);

  // Inside the holes: the same wood, a little lighter and worn matt.
  const insideTex = lacquerTexture('#7d3326');
  insideTex.repeat.set(0.6, 0.6);
  const inside = new THREE.MeshStandardMaterial({ map: insideTex, roughness: 0.62, side: THREE.DoubleSide });
  for (let i = 0; i < 16; i++) {
    const p = spot(i), store = i >= 14;
    const h = hollow(store ? STORE_R : HOLE_R, store ? STORE_DEPTH : HOLE_DEPTH, inside);
    h.position.set(p.x, TOP - 0.06, p.z);
    group.add(h);
  }
  return group;
}

/** A soft studio for reflections: a warm room with two bright windows, for the lacquer and glass. */
function environment(renderer) {
  const room = new THREE.Scene();
  const [c, g] = canvas(16, 256);
  const sky = g.createLinearGradient(0, 0, 0, 256);
  sky.addColorStop(0, '#fff7ea');
  sky.addColorStop(0.5, '#b49a86');
  sky.addColorStop(1, '#3b2a22');
  g.fillStyle = sky;
  g.fillRect(0, 0, 16, 256);
  const tex = texture(c, false);
  room.add(new THREE.Mesh(new THREE.SphereGeometry(20, 32, 16), new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide })));
  // Soft round glows, bright in the middle and fading to nothing: a hard-edged window would show
  // as a sharp-sided patch of light on the glossy wood when the camera comes close.
  const [gc, gg] = canvas(128, 128);
  const glow = gg.createRadialGradient(64, 64, 0, 64, 64, 64);
  glow.addColorStop(0, 'rgba(255, 255, 255, 1)');
  glow.addColorStop(0.45, 'rgba(255, 255, 255, 0.45)');
  glow.addColorStop(1, 'rgba(255, 255, 255, 0)');
  gg.fillStyle = glow;
  gg.fillRect(0, 0, 128, 128);
  const glowTex = texture(gc, false);
  for (const [x, y, z, size, power] of [[-6, 9, 4, 12, 3.2], [7, 6, -5, 9, 2]]) {
    const light = new THREE.Mesh(new THREE.PlaneGeometry(size, size), new THREE.MeshBasicMaterial({
      map: glowTex, color: new THREE.Color(power, power * 0.94, power * 0.86), transparent: true, depthWrite: false, side: THREE.DoubleSide,
    }));
    light.position.set(x, y, z);
    light.lookAt(0, 0, 0);
    room.add(light);
  }
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromScene(room, 0.06).texture; // blurred, so highlights stay soft
  pmrem.dispose();
  return env;
}

/**
 * A right hand, palm down, fingers towards -z, on a sleeved forearm: a shaped palm with padded
 * mounds, tapered three-joint fingers with knuckles and nails, and a two-joint thumb that closes
 * under the fingers. `setCurl(0…1)` opens or closes it; held marbles sit in `hold`.
 */
function makeHand() {
  const hand = new THREE.Group();
  const skin = new THREE.MeshPhysicalMaterial({ color: 0xcf9474, roughness: 0.52, sheen: 0.7, sheenRoughness: 0.55, sheenColor: new THREE.Color(0xff9b7a), clearcoat: 0.06 });
  const nailMat = new THREE.MeshPhysicalMaterial({ color: 0xe9c0ae, roughness: 0.28, clearcoat: 0.6 });
  const sleeveMat = new THREE.MeshStandardMaterial({ color: SLEEVE[0], roughness: 0.85 });
  const part = (geo, mat = skin) => { const m = new THREE.Mesh(geo, mat); m.castShadow = true; return m; };
  const ball = (r, mat = skin) => part(new THREE.SphereGeometry(r, 18, 12), mat);

  // The palm: wider at the knuckles than at the wrist, rounded all round.
  const outline = new THREE.Shape();
  outline.moveTo(-0.24, 0.3);
  outline.quadraticCurveTo(-0.02, 0.36, 0.25, 0.28);
  outline.quadraticCurveTo(0.31, 0.06, 0.24, -0.24);
  outline.quadraticCurveTo(0, -0.33, -0.2, -0.25);
  outline.quadraticCurveTo(-0.32, 0.02, -0.24, 0.3);
  const palmGeo = new THREE.ExtrudeGeometry(outline, { depth: 0.1, bevelEnabled: true, bevelThickness: 0.06, bevelSize: 0.05, bevelSegments: 6, curveSegments: 20 });
  palmGeo.rotateX(-Math.PI / 2); // shape y → -z (towards the fingers), extrusion → up
  palmGeo.translate(0, -0.08, 0);
  hand.add(part(palmGeo));
  // Mounds on the underside: the ball of the thumb and the heel of the hand; knuckle ridge on top.
  const thenar = ball(0.15);
  thenar.scale.set(1, 0.62, 1.35);
  thenar.position.set(-0.13, -0.1, 0.08);
  hand.add(thenar);
  const heel = ball(0.13);
  heel.scale.set(1.2, 0.55, 1.1);
  heel.position.set(0.12, -0.1, 0.14);
  hand.add(heel);

  // Fingers: [x, z of the knuckle, lengths of the three bones, base radius, splay].
  const spec = [
    [-0.175, -0.33, [0.19, 0.12, 0.1], 0.058, -0.07],
    [-0.058, -0.355, [0.21, 0.135, 0.11], 0.06, -0.02],
    [0.06, -0.345, [0.195, 0.125, 0.105], 0.056, 0.03],
    [0.17, -0.3, [0.15, 0.095, 0.085], 0.048, 0.09],
  ];
  const fingers = [];
  for (const [x, z, lens, r0, splay] of spec) {
    let parent = hand, r = r0;
    const joints = [];
    lens.forEach((len, j) => {
      const joint = new THREE.Group();
      if (j === 0) { joint.position.set(x, 0.0, z); joint.rotation.y = splay; }
      else joint.position.z = -lens[j - 1];
      // The bone tapers a little; a ball rounds the knuckle at its start.
      const r1 = r * 0.9;
      const bone = part(new THREE.CylinderGeometry(r1, r, len, 14, 1, true));
      bone.rotation.x = Math.PI / 2;
      bone.position.z = -len / 2;
      joint.add(bone);
      const knuckle = ball(r * (j === 0 ? 1.08 : 1.02));
      joint.add(knuckle);
      if (j === 2) {
        const tip = ball(r1);
        tip.position.z = -len;
        joint.add(tip);
        const nail = part(new THREE.SphereGeometry(r1 * 0.92, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), nailMat);
        nail.scale.set(0.85, 0.32, 1.25);
        nail.position.set(0, r1 * 0.62, -len * 0.62);
        joint.add(nail);
      }
      parent.add(joint);
      joints.push(joint);
      parent = joint;
      r = r1;
    });
    fingers.push(joints);
  }

  // The thumb leaves the palm's inner edge, angled forward and down, and closes under the fingers.
  const thumb = new THREE.Group();
  thumb.position.set(-0.24, -0.07, 0.02);
  thumb.rotation.set(-0.35, 0.6, 0.5);
  const thumbBones = [];
  let tParent = thumb, tr = 0.068;
  [0.17, 0.13].forEach((len, j) => {
    const joint = new THREE.Group();
    if (j) joint.position.z = -0.17;
    const r1 = tr * 0.88;
    const bone = part(new THREE.CylinderGeometry(r1, tr, len, 14, 1, true));
    bone.rotation.x = Math.PI / 2;
    bone.position.z = -len / 2;
    joint.add(bone, ball(tr * 1.04));
    if (j === 1) {
      const tip = ball(r1);
      tip.position.z = -len;
      const nail = part(new THREE.SphereGeometry(r1 * 0.95, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), nailMat);
      nail.scale.set(0.9, 0.32, 1.2);
      nail.position.set(0, r1 * 0.6, -len * 0.62);
      joint.add(tip, nail);
    }
    tParent.add(joint);
    thumbBones.push(joint);
    tParent = joint;
    tr = r1;
  });
  hand.add(thumb);

  // Wrist and forearm, tapering into the sleeve; it goes back towards the owner and up.
  const arm = new THREE.Group();
  arm.position.set(0.01, -0.03, 0.28);
  arm.rotation.x = -0.3;
  const wrist = part(new THREE.CylinderGeometry(0.15, 0.2, 0.95, 20, 1, true));
  wrist.rotation.x = Math.PI / 2;
  wrist.scale.x = 1.35; // flatter than round, like a real wrist
  wrist.position.z = 0.45;
  arm.add(wrist);
  const sleeve = part(new THREE.CylinderGeometry(0.29, 0.33, 1.7, 24, 1, true), sleeveMat);
  sleeve.material.side = THREE.DoubleSide;
  sleeve.rotation.x = Math.PI / 2;
  sleeve.position.z = 1.6;
  arm.add(sleeve);
  const cuff = part(new THREE.TorusGeometry(0.29, 0.04, 10, 28), sleeveMat);
  cuff.position.z = 0.76;
  arm.add(cuff);
  hand.add(arm);

  // Held marbles: cupped under the palm, inside the curled fingers.
  const hold = new THREE.Group();
  hold.position.set(0, -0.2, -0.2);
  hand.add(hold);

  /** 0 = open and relaxed, 1 = a loose fist round the marbles. */
  hand.userData.setCurl = (c) => {
    fingers.forEach((joints, f) => {
      const lag = f * 0.04; // the little finger curls a touch more
      joints[0].rotation.x = -(0.18 + (0.95 + lag) * c);
      joints[1].rotation.x = -(0.22 + 1.0 * c);
      joints[2].rotation.x = -(0.12 + 0.7 * c);
    });
    thumbBones[0].rotation.y = -0.15 - 0.45 * c;
    thumbBones[1].rotation.x = -(0.15 + 0.6 * c);
  };
  hand.userData.setSleeve = (color) => sleeveMat.color.setHex(color);
  hand.userData.hold = hold;
  // Tipped forward a little, so the fingers point down towards the holes.
  hand.rotation.order = 'YXZ';
  hand.userData.pitch = -0.22; // negative x-rotation tips -z (the fingers) downwards
  hand.userData.setCurl(0.85);
  return hand;
}

/**
 * The 3D board in `stage` (a positioned element). `onPitTap(i)` fires when one of the player's
 * holes is tapped while `setTurn(.., true)` allows it.
 */
export function createScene(stage, { onPitTap, sound = () => {}, topInset = () => 0, view: savedView = null, onViewChange = () => {} }) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.domElement.className = 'cg-canvas';
  stage.prepend(renderer.domElement);

  const scene = new THREE.Scene();
  scene.environment = environment(renderer);
  scene.environmentIntensity = 0.85;
  const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 120);
  scene.add(new THREE.HemisphereLight(0xfff4e2, 0x5b4030, 0.75));
  const sun = new THREE.DirectionalLight(0xffe7c4, 2.6);
  sun.position.set(-4, 10, 5);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  // Wide enough for the hand and its sleeve anywhere over the board, so no shadow is cut short.
  Object.assign(sun.shadow.camera, { left: -11, right: 11, top: 9, bottom: -9, near: 1, far: 34 });
  sun.shadow.bias = -0.0008;
  scene.add(sun);
  const fill = new THREE.DirectionalLight(0xcfe0ff, 0.5);
  fill.position.set(5, 4, -6);
  scene.add(fill);
  // No table: the board stands on the page's own background, with its shadow.
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(70, 70), new THREE.ShadowMaterial({ opacity: 0.28 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.065;
  floor.receiveShadow = true;
  scene.add(floor);
  scene.add(makeBoard());

  // Glowing rings on the holes the player may choose.
  const glowMat = new THREE.MeshBasicMaterial({ color: 0xffd166, transparent: true, opacity: 0.9, depthWrite: false });
  const glows = [];
  const hits = [];
  for (let i = 0; i < 7; i++) {
    const p = spot(i);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(HOLE_R + 0.022, 0.026, 8, 48), glowMat);
    ring.rotation.x = Math.PI / 2;
    ring.position.set(p.x, TOP + 0.03, p.z);
    ring.visible = false;
    scene.add(ring);
    glows.push(ring);
    const hit = new THREE.Mesh(new THREE.CylinderGeometry(HOLE_R + 0.06, HOLE_R + 0.06, 0.4, 16), new THREE.MeshBasicMaterial({ visible: false }));
    hit.position.set(p.x, TOP, p.z);
    hit.userData.pit = i;
    scene.add(hit);
    hits.push(hit);
  }

  // Marbles: one mesh each, kept in containers[0..15] (holes, then the two stores).
  const marbleGeo = new THREE.SphereGeometry(MARBLE_R, 20, 16);
  // Glass: very smooth, a clear coat for the sharp highlight, a faint glow of its own colour.
  const marbleMats = MARBLE_COLORS.map((color) => new THREE.MeshPhysicalMaterial({
    color, roughness: 0.05, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.02, ior: 1.5, specularIntensity: 1,
    emissive: color, emissiveIntensity: 0.16,
  }));
  const marbles = [];
  let containers = Array.from({ length: 16 }, () => []);

  // Marbles settle in a hex pattern on the hole's floor (one in the middle, then rings of 6 and
  // 12), layer on layer, each layer turned a little so they nest.
  const RING = [[0, 0]];
  for (let k = 0; k < 6; k++) RING.push([0.212, (k * Math.PI) / 3]);
  for (let k = 0; k < 12; k++) RING.push([0.42, (k * Math.PI) / 6 + Math.PI / 12]);
  /** Resting place of the j-th marble in container `i`. */
  function slot(i, j, target = new THREE.Vector3()) {
    const p = spot(i), store = i >= 14;
    const per = store ? 19 : 7;
    const layer = Math.floor(j / per), [r, a0] = RING[j % per];
    const a = a0 + layer * 0.52;
    const floor = TOP - 0.06 - (store ? STORE_DEPTH : HOLE_DEPTH) + MARBLE_R;
    const lift = r > 0.3 ? 0.035 : r > 0 ? 0.015 : 0; // the floor rounds up towards the wall
    target.set(p.x + Math.cos(a) * r, floor + lift + layer * MARBLE_R * 1.5, p.z + Math.sin(a) * r);
    return target;
  }

  function ensureMarbles(n) {
    while (marbles.length < n) {
      const m = new THREE.Mesh(marbleGeo, marbleMats[marbles.length % marbleMats.length]);
      m.castShadow = true;
      m.rotation.set(Math.random() * 6, Math.random() * 6, 0);
      scene.add(m);
      marbles.push(m);
    }
  }

  /** Puts every marble straight into place for `state` (no animation). */
  function layout(state) {
    const counts = [...state.holes, ...state.stores];
    ensureMarbles(counts.reduce((a, b) => a + b, 0));
    containers = counts.map(() => []);
    let k = 0;
    counts.forEach((n, i) => {
      for (let j = 0; j < n; j++) {
        const m = marbles[k++];
        if (m.parent !== scene) scene.add(m);
        m.visible = true;
        slot(i, j, m.position);
        containers[i].push(m);
      }
    });
    for (; k < marbles.length; k++) marbles[k].visible = false;
    updateCounts(counts);
  }

  // ---------- the hand ----------
  const hand = makeHand();
  hand.visible = false;
  scene.add(hand);
  const held = [];
  function arrangeHeld() {
    held.forEach((m, j) => {
      const a = j * 2.4, rr = j ? 0.06 + 0.02 * Math.min(j, 4) : 0;
      m.position.set(Math.cos(a) * rr, -Math.min(j, 6) * 0.004, Math.sin(a) * rr * 0.8);
      m.visible = j < 7; // the rest are inside the fist
    });
  }

  // ---------- labels over the canvas ----------
  const layer = document.createElement('div');
  layer.className = 'cg-labels';
  stage.append(layer);
  const counts = [];
  for (let i = 0; i < 16; i++) {
    const own = i < 7;
    const el = document.createElement(own ? 'button' : 'span');
    el.className = `cg-count${i >= 14 ? ' cg-store' : ''}${own ? ' cg-own' : ''}`;
    if (own) {
      el.type = 'button';
      el.addEventListener('click', () => tapPit(i));
    }
    layer.append(el);
    counts.push(el);
  }
  const storeName = [document.createElement('span'), document.createElement('span')];
  storeName[0].textContent = 'Rumah anda';
  storeName[1].textContent = 'Rumah AI';
  storeName.forEach((el) => { el.className = 'cg-store-name'; layer.append(el); });
  const inHand = document.createElement('div');
  inHand.className = 'cg-in-hand';
  inHand.setAttribute('role', 'status');
  inHand.hidden = true;
  stage.append(inHand); // fixed at the top of the board area, under the status line

  function updateCounts(values) {
    values.forEach((n, i) => {
      counts[i].textContent = n;
      if (i < 7) counts[i].setAttribute('aria-label', `Lubang ${i + 1}: ${n} guli`);
    });
  }
  function setInHand(n) {
    inHand.hidden = n <= 0;
    if (n > 0) inHand.innerHTML = `<span class="cg-in-hand-num">${n}</span><span>guli di tangan</span>`;
  }

  const v = new THREE.Vector3();
  let width = 1, height = 1;
  // Labels are pinned to fixed points in the scene beside the board, so they move with the board
  // as one piece while the camera follows the hand (no sliding about). The points are worked out
  // from the overview: each label just off the board's edge on screen, then fixed in the scene.
  const anchors = new Map(); // label element → its point in the scene
  const anchorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -TOP / 2);
  const anchorRay = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const sc = (cam, x, y, z) => {
    v.set(x, y, z).project(cam);
    return { x: ((v.x + 1) / 2) * width, y: ((1 - v.y) / 2) * height };
  };
  /**
   * Seen through `cam`, pins `el` off the board: from the board point (cx, cz) towards its edge
   * (ex, ez), past whichever of the board's top or bottom edge shows further out, by `gap` px plus
   * half its own size that way. Returns its size along that direction.
   */
  function pinOutside(cam, el, cx, cz, ex, ez, gap = 18) {
    const c = sc(cam, cx, TOP, cz), top = sc(cam, ex, TOP, ez), bottom = sc(cam, ex, -0.06, ez);
    let dx = top.x - c.x, dy = top.y - c.y;
    const len = Math.hypot(dx, dy) || 1;
    dx /= len;
    dy /= len;
    const reach = Math.max((top.x - c.x) * dx + (top.y - c.y) * dy, (bottom.x - c.x) * dx + (bottom.y - c.y) * dy);
    const size = Math.abs(dx) * el.offsetWidth + Math.abs(dy) * el.offsetHeight;
    const d = reach + gap + size / 2;
    // That screen point, back into the scene at half the board's height.
    ndc.set(((c.x + dx * d) / width) * 2 - 1, 1 - ((c.y + dy * d) / height) * 2);
    anchorRay.setFromCamera(ndc, cam);
    const point = anchors.get(el) ?? new THREE.Vector3();
    if (anchorRay.ray.intersectPlane(anchorPlane, point)) anchors.set(el, point);
    return size;
  }
  /** Works out every label's point, as seen from `cam` (the overview). */
  function pinLabels(cam) {
    for (let i = 0; i < 14; i++) {
      const p = spot(i), side = Math.sign(p.z);
      pinOutside(cam, counts[i], p.x, 0, p.x, side * HALF_W);
    }
    STORE.forEach((s, k) => {
      const sx = Math.sign(spot(s).x), from = sx * (HALF_L - HALF_W);
      const size = pinOutside(cam, counts[s], from, 0, sx * HALF_L, 0);
      pinOutside(cam, storeName[k], from, 0, sx * HALF_L, 0, 18 + size + 6);
    });
  }
  // Each frame: every label at its point, rounded to whole pixels so it doesn't shimmer. Where
  // badges overlap, the one further from the camera is drawn on top of the nearer one.
  function placeLabels() {
    for (const [el, point] of anchors) {
      el.style.zIndex = String(Math.round(point.distanceTo(camera.position) * 20));
      v.copy(point).project(camera);
      el.style.transform = `translate(${Math.round(((v.x + 1) / 2) * width)}px, ${Math.round(((1 - v.y) / 2) * height)}px) translate(-50%, -50%)`;
    }
  }

  // ---------- camera ----------
  const camPos = new THREE.Vector3(), camLook = new THREE.Vector3();
  const wantPos = new THREE.Vector3(), wantLook = new THREE.Vector3();
  let following = false;
  // Seen at an angle from beyond the player's store end, like a photo of a board on a table: the
  // board runs diagonally, its near end (the player's store) larger. On a tall phone screen the
  // view looks more along the board, so it runs up the screen; on a wide one, more across.
  let portrait = true;
  // From beyond the player's store end (+x): on a tall screen the player's row (-z) runs up the
  // right side and the AI's up the left, the player's store nearest.
  const DIR_TALL = new THREE.Vector3(0.62, 0.76, 0.2).normalize();
  const DIR_WIDE = new THREE.Vector3(0.42, 0.74, 0.53).normalize();
  // The player can turn the view (swipe or arrow keys): yaw circles round the board, pitch looks
  // from higher or lower, kept between about 23° and 83° above the board.
  let yaw = Number(savedView?.yaw) || 0, pitch = Number(savedView?.pitch) || 0, refit = false;
  const view = new THREE.Vector3();
  const EL_MIN = 0.4, EL_MAX = 1.45;
  const baseAngles = () => {
    const b = portrait ? DIR_TALL : DIR_WIDE;
    return [Math.atan2(b.x, b.z), Math.asin(b.y)];
  };
  function dir() {
    const [az0, el0] = baseAngles();
    const az = az0 + yaw, el = THREE.MathUtils.clamp(el0 + pitch, EL_MIN, EL_MAX);
    return view.set(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));
  }
  function turnView(dYaw, dPitch) {
    const [, el0] = baseAngles();
    yaw = (yaw + dYaw) % (Math.PI * 2);
    pitch = THREE.MathUtils.clamp(pitch + dPitch, EL_MIN - el0, EL_MAX - el0);
    refit = true;
    resetBtn.hidden = Math.abs(yaw) < 0.01 && Math.abs(pitch) < 0.01;
    onViewChange({ yaw, pitch });
  }
  function resetView() {
    yaw = 0;
    pitch = 0;
    refit = true;
    resetBtn.hidden = true;
    onViewChange({ yaw, pitch });
  }
  // The board's outline (top and bottom), which the overview keeps in frame.
  const outline = [];
  for (let k = 0; k < 24; k++) {
    const a = (k / 24) * Math.PI * 2, x = Math.cos(a) * HALF_W, z = Math.sin(a) * HALF_W;
    const ox = Math.sign(x || 1) * (HALF_L - HALF_W);
    outline.push(new THREE.Vector3(ox + x, -0.06, z), new THREE.Vector3(ox + x, TOP + 0.3, z));
  }
  // Room round the board for the counts and the stores' names.
  for (const x of [-3.2, 0, 3.2]) for (const z of [-1, 1]) outline.push(new THREE.Vector3(x, 0, z * (HALF_W + 0.65)));
  for (const x of [-1, 1]) outline.push(new THREE.Vector3(x * (HALF_L + 1.5), 0, 0));
  const probe = new THREE.PerspectiveCamera();
  let top = 0; // px of the scene's top covered by the bar and status line
  let inset = 0; // that plus room for the in-hand counter
  let shift = 0; // px the view's centre sits below the screen's: a little below the free space's middle
  const fit = { pos: new THREE.Vector3(), look: new THREE.Vector3(), dist: 15 };
  /** Projected extent of the outline seen from `look` + dir × `dist`. */
  function extent(look, dist) {
    probe.copy(camera);
    probe.position.copy(look).addScaledVector(dir(), dist);
    probe.lookAt(look);
    probe.updateMatrixWorld();
    let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
    for (const p of outline) {
      v.copy(p).project(probe);
      x0 = Math.min(x0, v.x); x1 = Math.max(x1, v.x); y0 = Math.min(y0, v.y); y1 = Math.max(y1, v.y);
    }
    return { x0, x1, y0, y1 };
  }
  /** The overview: the whole board centred, filling the screen with room for the labels. */
  function fitOverview() {
    // Where the board goes, in view units (y up, -1…1 over the canvas): centred, as low as the
    // follow view's centre (see resize: a little below the middle of the space under the bar,
    // status line and counter), as big as fits in that space. The view offset doesn't move this
    // frame of reference, so the centre is aimed for explicitly.
    const freeTop = 1 - (2 * inset) / height;
    const ty = -(2 * shift) / height;
    const halfY = Math.min(freeTop - ty, ty + 1) * 0.94;
    const look = new THREE.Vector3(0, 0.25, 0);
    let dist = 15;
    for (let pass = 0; pass < 3; pass++) {
      let lo = 3, hi = 80;
      for (let k = 0; k < 24; k++) {
        const mid = (lo + hi) / 2, e = extent(look, mid);
        if ((e.x1 - e.x0) / 2 < 0.9 && (e.y1 - e.y0) / 2 < halfY) hi = mid; else lo = mid;
      }
      dist = hi;
      // Re-centre: move the target so the board's middle lands on (0, ty).
      const e = extent(look, dist);
      const cx = (e.x0 + e.x1) / 2, cy = (e.y0 + e.y1) / 2;
      const vt = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
      const right = new THREE.Vector3().setFromMatrixColumn(probe.matrixWorld, 0);
      const up = new THREE.Vector3().setFromMatrixColumn(probe.matrixWorld, 1);
      look.addScaledVector(right, cx * vt * camera.aspect * dist).addScaledVector(up, (cy - ty) * vt * dist);
    }
    fit.look.copy(look);
    fit.dist = dist;
    fit.pos.copy(look).addScaledVector(dir(), dist);
    // Pin the labels from this overview.
    probe.copy(camera);
    probe.position.copy(fit.pos);
    probe.lookAt(fit.look);
    probe.updateMatrixWorld();
    pinLabels(probe);
  }
  function overview(pos, look) {
    pos.copy(fit.pos);
    look.copy(fit.look);
  }
  /** Closer, from the same angle, centred on the hand. */
  function followView(pos, look) {
    look.set(hand.position.x * 0.95, 0.35, hand.position.z * 0.45);
    pos.copy(look).addScaledVector(dir(), Math.max(5.5, fit.dist * (portrait ? 0.6 : 0.55)));
  }
  function aim(dt) {
    if (following && hand.visible) followView(wantPos, wantLook);
    else overview(wantPos, wantLook);
    const k = dt >= 1 ? 1 : 1 - Math.exp(-dt * 3.2);
    camPos.lerp(wantPos, k);
    camLook.lerp(wantLook, k);
    camera.position.copy(camPos);
    camera.lookAt(camLook);
  }

  function resize() {
    const r = stage.getBoundingClientRect();
    width = Math.max(1, r.width);
    height = Math.max(1, r.height);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    portrait = width / height < 0.9;
    // The bar and status line float over the top of the scene, with the in-hand counter (about
    // 52px) just under them. Shifting the view down by half that, and a little more, centres
    // everything (the board, and the hand while following it) low in the space below.
    top = Math.max(0, topInset());
    inset = top + 60;
    stage.style.setProperty('--cg-top', `${top}px`);
    shift = inset / 2 + height * 0.03;
    camera.setViewOffset(width, height, 0, -shift, width, height);
    camera.updateProjectionMatrix();
    fitOverview();
    if (!running) { aim(1); renderer.render(scene, camera); placeLabels(); }
  }
  const ro = new ResizeObserver(resize);
  ro.observe(stage);

  // ---------- tweens and the render loop ----------
  const tweens = new Set();
  let speed = 1, generation = 0, running = false, raf = 0, last = 0, pulse = 0;
  /** Calls `fn(t)` for t 0→1 over `seconds` (scaled by the speed); resolves when done or aborted. */
  function tween(seconds, fn) {
    const gen = generation;
    return new Promise((resolve) => {
      tweens.add({ t: 0, d: Math.max(0.001, seconds / speed), fn, resolve, gen });
    });
  }
  const wait = (seconds) => tween(seconds, () => {});
  function frame(now) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - (last || now)) / 1000);
    last = now;
    for (const tw of [...tweens]) {
      if (tw.gen !== generation) { tweens.delete(tw); tw.resolve(false); continue; }
      tw.t = Math.min(1, tw.t + dt / tw.d);
      tw.fn(tw.t);
      if (tw.t >= 1) { tweens.delete(tw); tw.resolve(true); }
    }
    if (refit) { refit = false; fitOverview(); }
    pulse += dt;
    glowMat.opacity = 0.55 + 0.4 * Math.sin(pulse * 4);
    aim(dt);
    renderer.render(scene, camera);
    placeLabels();
  }

  // ---------- moves ----------
  const tmp = new THREE.Vector3();
  let handSide = 1; // z side the hand comes from (its owner's)
  /** The hand glides to above `i`, in an arc when going far. */
  function moveHand(i, seconds = 0.3) {
    const from = hand.position.clone();
    const p = spot(i);
    const to = new THREE.Vector3(p.x, HAND_Y, p.z + handSide * 0.12);
    const far = from.distanceTo(to);
    return tween(seconds * Math.min(2.2, Math.max(0.7, far / 1.1)), (t) => {
      const e = ease(t);
      hand.position.lerpVectors(from, to, e);
      hand.position.y = lerp(from.y, to.y, e) + Math.sin(Math.PI * e) * Math.min(0.5, far * 0.12);
    });
  }

  /** A marble flies from where it is to the next free slot of container `i`. */
  function fly(m, i, seconds, { arc = 0.35, bounce = true } = {}) {
    m.getWorldPosition(tmp);
    scene.attach(m);
    m.visible = true;
    const start = tmp.clone();
    const end = slot(i, containers[i].length);
    containers[i].push(m);
    const spin = (Math.random() - 0.5) * 14;
    return tween(seconds, (t) => {
      const e = bounce ? easeOut(t) : ease(t);
      m.position.lerpVectors(start, end, e);
      m.position.y += Math.sin(Math.PI * Math.min(1, t * 1.15)) * arc - (bounce && t > 0.82 ? Math.sin(((t - 0.82) / 0.18) * Math.PI) * -0.03 : 0);
      m.rotation.x += spin * 0.016;
      m.rotation.z += spin * 0.011;
    }).then((done) => {
      if (done) sound('drop', i >= 14 ? 1 : 0);
      return done;
    });
  }

  /** Picks up every marble in container `i` into the hand. */
  async function pickUp(i) {
    const y0 = hand.position.y;
    await tween(0.2, (t) => { hand.position.y = y0 - 0.42 * easeOut(t); });
    const taken = containers[i].splice(0);
    sound('pickup', taken.length);
    hand.userData.setCurl(1);
    const flights = taken.map((m, j) => {
      m.getWorldPosition(tmp);
      const start = tmp.clone();
      return wait(j * 0.012).then(() => tween(0.18, (t) => {
        hand.userData.hold.getWorldPosition(m.position);
        m.position.lerp(start, 1 - easeOut(t));
      })).then(() => { hand.userData.hold.attach(m); held.push(m); arrangeHeld(); });
    });
    await Promise.all(flights);
    const y1 = hand.position.y;
    await tween(0.16, (t) => { hand.position.y = lerp(y1, HAND_Y, ease(t)); });
  }

  /** Lets go of one marble into container `i`. */
  async function release(i, seconds = 0.24) {
    const m = held.pop();
    if (!m) return;
    arrangeHeld();
    hand.userData.setCurl(0.55);
    const flight = fly(m, i, seconds, { arc: 0.06 });
    await wait(0.08);
    hand.userData.setCurl(0.95);
    return flight;
  }

  /**
   * Replays a move's events (rules.play with record) for `player`. Resolves false if aborted.
   * `follow`: the camera follows the hand. `onStep(state)` after each step, for the header scores.
   */
  async function playEvents(events, player, { follow = true, onStep = () => {} } = {}) {
    const gen = generation;
    const alive = () => gen === generation;
    following = follow;
    hand.userData.setSleeve(SLEEVE[player]);
    handSide = SIDE[player];
    // The hand points to -z with its arm to +z: turn it round for an owner on the -z side.
    hand.rotation.set(hand.userData.pitch, handSide > 0 ? 0 : Math.PI, 0);
    // The hand comes in from its owner's side.
    const first = spot(events[0]?.at ?? 0);
    hand.position.set(first.x, HAND_Y + 1.2, first.z + handSide * 2.4);
    hand.userData.setCurl(0.6);
    hand.visible = true;
    held.length = 0;
    for (let k = 0; k < events.length && alive(); k++) {
      const e = events[k];
      if (e.type === 'pickup') {
        await moveHand(e.at, 0.32);
        if (!alive()) break;
        await pickUp(e.at);
        setInHand(held.length);
        updateCounts([...e.state.holes, ...e.state.stores]);
      } else if (e.type === 'drop') {
        await moveHand(e.at, 0.2);
        if (!alive()) break;
        const landed = release(e.at);
        setInHand(e.inHand);
        await wait(0.07);
        landed.then(() => alive() && updateCounts([...e.state.holes, ...e.state.stores]));
        if (!e.inHand) await landed;
      } else if (e.type === 'capture') {
        // Tembak: scoop each hole's marbles, then pour them into the store.
        const from = e.from;
        let n = 0;
        while (k + n < events.length && events[k + n].type === 'capture' && events[k + n].from === from) n++;
        const lastState = events[k + n - 1].state;
        await moveHand(from, 0.3);
        if (!alive()) break;
        await pickUp(from);
        setInHand(held.length);
        await moveHand(e.to, 0.45);
        if (!alive()) break;
        sound('capture', n);
        const pours = [];
        while (held.length) { pours.push(release(e.to, 0.2)); await wait(0.035); }
        await Promise.all(pours);
        setInHand(0);
        updateCounts([...lastState.holes, ...lastState.stores]);
        onStep(lastState);
        k += n - 1;
        continue;
      } else if (e.type === 'sweep') {
        // The round is over: the marbles left roll into their owners' stores without the hand.
        hand.visible = false;
        setInHand(0);
        following = false;
        const m = containers[e.from].pop();
        if (m) { fly(m, e.to, 0.5, { arc: 0.6 }); await wait(0.05); }
        updateCounts([...e.state.holes, ...e.state.stores]);
      }
      onStep(e.state);
    }
    if (!alive()) return false;
    await wait(0.3);
    // The hand leaves towards its owner's side.
    const from = hand.position.clone();
    await tween(0.35, (t) => { hand.position.set(from.x, lerp(from.y, from.y + 1.4, t), lerp(from.z, from.z + handSide * 2.6, t)); });
    hand.visible = false;
    setInHand(0);
    following = false;
    return alive();
  }

  // ---------- input ----------
  let canTap = false;
  const ray = new THREE.Raycaster(), pointer = new THREE.Vector2();
  function tapPit(i) {
    if (canTap && containers[i]?.length) onPitTap(i);
  }
  function tapAt(e) {
    if (!canTap) return;
    const r = renderer.domElement.getBoundingClientRect();
    pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(pointer, camera);
    const hit = ray.intersectObjects(hits)[0];
    if (hit) tapPit(hit.object.userData.pit);
  }
  // A drag (swipe) turns the view: sideways circles round the board, up and down tilts it. A tap
  // that doesn't move picks a hole.
  const canvasEl = renderer.domElement;
  let drag = null;
  canvasEl.addEventListener('pointerdown', (e) => {
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: false };
    try { canvasEl.setPointerCapture(e.pointerId); } catch { /* already gone */ }
  });
  canvasEl.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) < 8) return;
    drag.moved = true;
    turnView(-dx * 0.007, dy * 0.005);
    drag.x = e.clientX;
    drag.y = e.clientY;
  });
  canvasEl.addEventListener('pointerup', (e) => {
    const d = drag;
    drag = null;
    if (d && d.id === e.pointerId && !d.moved) tapAt(e);
  });
  canvasEl.addEventListener('pointercancel', () => { drag = null; });

  // Back to the starting angle; shown only once the view has been turned.
  const resetBtn = document.createElement('button');
  resetBtn.type = 'button';
  resetBtn.className = 'icon-btn cg-reset-view';
  resetBtn.setAttribute('aria-label', 'Pandangan asal');
  resetBtn.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12a8 8 0 1 0 2.4-5.7M4 4v5h5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  resetBtn.hidden = Math.abs(yaw) < 0.01 && Math.abs(pitch) < 0.01;
  resetBtn.addEventListener('click', resetView);
  stage.append(resetBtn);

  return {
    /** Starts or stops drawing (only while the game screen shows). */
    start() {
      if (running) return;
      running = true;
      last = 0;
      resize();
      raf = requestAnimationFrame(frame);
    },
    stop() {
      running = false;
      cancelAnimationFrame(raf);
    },
    /** A new board for `state`, with the camera on the whole board. */
    reset(state) {
      generation++;
      for (const tw of tweens) tw.resolve(false);
      tweens.clear();
      held.length = 0;
      hand.visible = false;
      following = false;
      setInHand(0);
      layout(state);
      overview(camPos, camLook);
      aim(1);
    },
    /** Lets the player choose (and lights up) their holes with marbles, or not. */
    setTurn(state, playerChooses) {
      canTap = playerChooses;
      glows.forEach((g, i) => { g.visible = playerChooses && state.holes[i] > 0; });
      counts.slice(0, 7).forEach((el, i) => {
        el.disabled = !(playerChooses && state.holes[i] > 0);
        el.classList.toggle('cg-choose', playerChooses && state.holes[i] > 0);
      });
    },
    playEvents,
    /** Brings the marbles in line with `state` after a move (a safety net; normally a no-op). */
    sync(state) {
      const want = [...state.holes, ...state.stores];
      if (want.some((n, i) => containers[i].length !== n)) layout(state);
      else updateCounts(want);
    },
    setSpeed(s) { speed = s; },
    abort() { generation++; },
    /** Turns the view by `dYaw` (round the board) and `dPitch` (higher or lower), in radians. */
    turnView,
    resetView,
  };
}
