// Pemadam in 3D (Three.js, shared with Kejar Lapan): a wooden school desk with a pencil case and
// a pencil on it, and two rubber flag erasers with rounded edges, in soft light and shadow. The
// physics (js/physics.js) moves the erasers; this file draws them, takes the slingshot aim (press
// on your eraser, pull back, let go), shows the aim arrow, and replays a point up close.
import * as THREE from '../../kejar-lapan/vendor/three.module.min.js';
import { ERASER, DESK, PROPS, PLAYER, AI } from './rules.js';
import { paintFlag, AI_FLAGS } from './flags.js';

export { AI_FLAGS };


const PULL_PX = 160; // a pull this long (or less, near the screen's edge) is full power
const PULL_MIN = 70;
const EDGE = 28; // keep clear of the bottom edge, where the phone's own gestures start
const MOVE_PX = 8;

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')];
}
function texture(c, repeat = false) {
  const t = new THREE.CanvasTexture(c);
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

// ---------- shapes ----------

/**
 * A box w × h × d with every edge and corner rounded to radius r: a segmented box whose edge
 * rows are squeezed into the rounded band and pushed out onto the curve.
 */
function roundedBox(w, h, d, r, seg = 3) {
  const n = seg * 2 + 1;
  const geo = new THREE.BoxGeometry(1, 1, 1, n, n, n);
  const pos = geo.attributes.position, nor = geo.attributes.normal;
  const half = [w / 2, h / 2, d / 2];
  const p = new THREE.Vector3(), inner = new THREE.Vector3(), off = new THREE.Vector3();
  // u in -0.5…0.5 on a grid of n segments: the outer `seg` segments each side cover the rounded
  // band, and the one in the middle spans the flat part.
  const remap = (u, hh) => {
    const k = Math.round((u + 0.5) * n);
    return k <= seg ? -hh + (r * k) / seg : hh - (r * (n - k)) / seg;
  };
  for (let i = 0; i < pos.count; i++) {
    p.set(remap(pos.getX(i), half[0]), remap(pos.getY(i), half[1]), remap(pos.getZ(i), half[2]));
    inner.set(
      THREE.MathUtils.clamp(p.x, -half[0] + r, half[0] - r),
      THREE.MathUtils.clamp(p.y, -half[1] + r, half[1] - r),
      THREE.MathUtils.clamp(p.z, -half[2] + r, half[2] - r),
    );
    off.subVectors(p, inner);
    if (off.lengthSq() > 1e-12) {
      off.normalize();
      p.copy(inner).addScaledVector(off, r);
      nor.setXYZ(i, off.x, off.y, off.z);
    }
    pos.setXYZ(i, p.x, p.y, p.z);
  }
  geo.computeBoundingSphere();
  return geo;
}

/** Light wood with long grain, a few pencil marks and scratches: the desk's top. */
function deskTexture() {
  const W = 1024, H = 720;
  const [c, g] = canvas(W, H);
  const base = g.createLinearGradient(0, 0, 0, H);
  base.addColorStop(0, '#d6ad78');
  base.addColorStop(0.5, '#dcb684');
  base.addColorStop(1, '#cfa26c');
  g.fillStyle = base;
  g.fillRect(0, 0, W, H);
  // Grain along the desk: wavy lines, a few darker, with knots the lines bend round.
  const knots = [[W * 0.22, H * 0.7], [W * 0.78, H * 0.28]];
  for (let i = 0; i < 230; i++) {
    const y0 = Math.random() * H, amp = 1.5 + Math.random() * 6, k = 1 + Math.floor(Math.random() * 3), ph = Math.random() * 6.3;
    g.strokeStyle = Math.random() < 0.7 ? '#8a5a2b' : '#f2d3a3';
    g.globalAlpha = 0.05 + Math.random() * 0.12;
    g.lineWidth = 0.6 + Math.random() * 2.4;
    g.beginPath();
    for (let x = 0; x <= W; x += 8) {
      let y = y0 + Math.sin((x / W) * Math.PI * 2 * k + ph) * amp;
      for (const [kx, ky] of knots) {
        const dx = x - kx, dy = y - ky, d2 = dx * dx + dy * dy;
        y += (dy >= 0 ? 1 : -1) * 26 * Math.exp(-d2 / 1800);
      }
      if (x) g.lineTo(x, y); else g.moveTo(x, y);
    }
    g.stroke();
  }
  for (const [kx, ky] of knots) {
    const r = g.createRadialGradient(kx, ky, 0, kx, ky, 16);
    r.addColorStop(0, 'rgba(110, 66, 28, 0.55)');
    r.addColorStop(1, 'rgba(110, 66, 28, 0)');
    g.globalAlpha = 1;
    g.fillStyle = r;
    g.beginPath();
    g.ellipse(kx, ky, 22, 10, 0, 0, Math.PI * 2);
    g.fill();
  }
  // Years of use: faint scratches and a pencilled heart in a corner.
  g.strokeStyle = '#6b4a2a';
  for (let i = 0; i < 40; i++) {
    g.globalAlpha = 0.05 + Math.random() * 0.08;
    g.lineWidth = 0.6;
    const x = Math.random() * W, y = Math.random() * H, a = Math.random() * Math.PI, l = 10 + Math.random() * 50;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
    g.stroke();
  }
  g.globalAlpha = 0.22;
  g.strokeStyle = '#4b4b52';
  g.lineWidth = 2;
  g.beginPath();
  const hx = W * 0.9, hy = H * 0.86;
  g.moveTo(hx, hy + 14);
  g.bezierCurveTo(hx - 26, hy - 6, hx - 10, hy - 22, hx, hy - 8);
  g.bezierCurveTo(hx + 10, hy - 22, hx + 26, hy - 6, hx, hy + 14);
  g.stroke();
  g.globalAlpha = 1;
  return texture(c);
}

/** Grey terrazzo tiles: the classroom floor, far below the desk. */
function floorTexture() {
  const [c, g] = canvas(256, 256);
  g.fillStyle = '#9a9890';
  g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 900; i++) {
    g.fillStyle = ['#7d7b74', '#b5b2a8', '#6e6a62', '#c9c5ba'][i % 4];
    g.globalAlpha = 0.5;
    g.fillRect(Math.random() * 256, Math.random() * 256, 1 + Math.random() * 3, 1 + Math.random() * 3);
  }
  g.globalAlpha = 0.5;
  g.strokeStyle = '#5f5d57';
  g.lineWidth = 2;
  g.strokeRect(1, 1, 254, 254);
  g.globalAlpha = 1;
  const t = texture(c, true);
  t.repeat.set(8, 8);
  return t;
}

/** A soft, warm room for reflections, blurred so the rubber and wood keep gentle highlights. */
function environment(renderer) {
  const room = new THREE.Scene();
  const [c, g] = canvas(16, 256);
  const sky = g.createLinearGradient(0, 0, 0, 256);
  sky.addColorStop(0, '#fffaf0');
  sky.addColorStop(0.5, '#c9b9a4');
  sky.addColorStop(1, '#4a4038');
  g.fillStyle = sky;
  g.fillRect(0, 0, 16, 256);
  room.add(new THREE.Mesh(new THREE.SphereGeometry(20, 32, 16), new THREE.MeshBasicMaterial({ map: texture(c), side: THREE.BackSide })));
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromScene(room, 0.08).texture;
  pmrem.dispose();
  return env;
}

function makeDesk() {
  const group = new THREE.Group();
  const thick = 0.32;
  const top = new THREE.MeshStandardMaterial({ map: deskTexture(), roughness: 0.62, metalness: 0 });
  const edge = new THREE.MeshStandardMaterial({ color: 0x6b4426, roughness: 0.55 });
  const slab = new THREE.Mesh(new THREE.BoxGeometry(DESK.hx * 2, thick, DESK.hz * 2), [edge, edge, top, edge, edge, edge]);
  slab.position.y = DESK.top - thick / 2;
  slab.receiveShadow = true;
  slab.castShadow = true;
  group.add(slab);
  // A steel frame under it: four legs down to the floor at the very corners (so each leg's shadow
  // meets the desk's shadow at its corner) and a rail round the edge between them.
  const LEG_IN = 0.14; // the leg's centre from the desk's edges: just inside its 0.11 radius
  const steel = new THREE.MeshStandardMaterial({ color: 0x5d6670, roughness: 0.4, metalness: 0.7 });
  const legGeo = new THREE.CylinderGeometry(0.11, 0.11, 6.2, 12);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const leg = new THREE.Mesh(legGeo, steel);
    leg.position.set(sx * (DESK.hx - LEG_IN), DESK.top - thick - 3.1, sz * (DESK.hz - LEG_IN));
    leg.castShadow = true;
    group.add(leg);
  }
  const ix = DESK.hx - LEG_IN, iz = DESK.hz - LEG_IN;
  for (const [w, d, x, z] of [[ix * 2, 0.14, 0, iz], [ix * 2, 0.14, 0, -iz], [0.14, iz * 2, ix, 0], [0.14, iz * 2, -ix, 0]]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(w, 0.16, d), steel);
    rail.position.set(x, DESK.top - thick - 0.1, z);
    group.add(rail);
  }
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), new THREE.MeshStandardMaterial({ map: floorTexture(), roughness: 0.85 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = DESK.top - thick - 6.2;
  floor.receiveShadow = true;
  group.add(floor);
  return group;
}

/** A zipped fabric pencil case (navy, a zip along the top and a pull) where PROPS says. */
function makePencilCase() {
  const pc = PROPS.pencilCase;
  const group = new THREE.Group();
  const fabric = new THREE.MeshStandardMaterial({ color: 0x2d4f86, roughness: 0.95 });
  const body = new THREE.Mesh(roundedBox(pc.w, pc.h, pc.d, 0.14, 3), fabric);
  body.castShadow = true;
  body.receiveShadow = true;
  group.add(body);
  const zip = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.02, pc.d - 0.3), new THREE.MeshStandardMaterial({ color: 0x1b1f27, roughness: 0.6 }));
  zip.position.y = pc.h / 2 + 0.005;
  group.add(zip);
  const pull = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.03, 0.22), new THREE.MeshStandardMaterial({ color: 0xc8ccd2, metalness: 0.9, roughness: 0.3 }));
  pull.position.set(0.04, pc.h / 2 + 0.02, pc.d / 2 - 0.32);
  pull.rotation.y = 0.3;
  pull.castShadow = true;
  group.add(pull);
  // A woven label near one end.
  const tag = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.5), new THREE.MeshStandardMaterial({ color: 0xf2c230, roughness: 0.8 }));
  tag.rotation.x = -Math.PI / 2;
  tag.position.set(-0.16, pc.h / 2 + 0.003, -pc.d / 2 + 0.5);
  group.add(tag);
  group.position.set(pc.x, DESK.top + pc.h / 2, pc.z);
  group.rotation.y = pc.yaw;
  return group;
}

/** A yellow hexagonal pencil, sharpened, with a pink eraser in a metal band. */
function makePencil() {
  const pn = PROPS.pencil;
  const group = new THREE.Group();
  const tipLen = 0.32, endLen = 0.2, bandLen = 0.12;
  const bodyLen = pn.length - tipLen - endLen - bandLen;
  const along = (mesh, at) => { mesh.rotation.z = -Math.PI / 2; mesh.position.x = at; mesh.castShadow = true; group.add(mesh); };
  along(new THREE.Mesh(new THREE.CylinderGeometry(pn.r, pn.r, bodyLen, 6), new THREE.MeshStandardMaterial({ color: 0xf2c230, roughness: 0.45 })),
    -pn.length / 2 + endLen + bandLen + bodyLen / 2);
  along(new THREE.Mesh(new THREE.CylinderGeometry(0.02, pn.r, tipLen * 0.8, 12), new THREE.MeshStandardMaterial({ color: 0xe1bf8c, roughness: 0.8 })),
    pn.length / 2 - tipLen / 2 - 0.03);
  along(new THREE.Mesh(new THREE.ConeGeometry(0.022, tipLen * 0.2, 10), new THREE.MeshStandardMaterial({ color: 0x2c2c30, roughness: 0.4, metalness: 0.3 })),
    pn.length / 2 - tipLen * 0.1);
  along(new THREE.Mesh(new THREE.CylinderGeometry(pn.r * 1.04, pn.r * 1.04, bandLen, 16), new THREE.MeshStandardMaterial({ color: 0xb8bcc2, metalness: 0.9, roughness: 0.3 })),
    -pn.length / 2 + endLen + bandLen / 2);
  along(new THREE.Mesh(new THREE.CylinderGeometry(pn.r, pn.r, endLen, 16), new THREE.MeshStandardMaterial({ color: 0xec8fa4, roughness: 0.9 })),
    -pn.length / 2 + endLen / 2);
  group.position.set(pn.x, DESK.top + pn.r, pn.z);
  group.rotation.y = pn.yaw;
  return group;
}

const RUBBER = '#f6f2e6';
const rnd = (a, b) => a + Math.random() * (b - a);

/**
 * Marks of use over an area of a canvas, different each time: grey graphite smudges where it
 * rubbed out pencil, a few streaks in the rubbing direction, specks, and (with `edges`) grime
 * gathering towards the edges. `amount` (0–1) sets how used it looks.
 */
function smudge(g, x, y, w, h, amount, { edges = true } = {}) {
  g.save();
  g.beginPath();
  g.rect(x, y, w, h);
  g.clip();
  const s = Math.max(w, h);
  if (edges) {
    const grime = g.createRadialGradient(x + w / 2, y + h / 2, s * 0.22, x + w / 2, y + h / 2, s * 0.72);
    grime.addColorStop(0, 'rgba(118, 108, 92, 0)');
    grime.addColorStop(1, `rgba(118, 108, 92, ${0.22 * amount})`);
    g.fillStyle = grime;
    g.fillRect(x, y, w, h);
  }
  // Graphite: soft grey blots, stretched and turned every which way.
  const blots = Math.round(rnd(1, 4) + 5 * amount);
  for (let k = 0; k < blots; k++) {
    const r = s * rnd(0.06, 0.22);
    g.save();
    g.translate(x + rnd(0, w), y + rnd(0, h));
    g.rotate(rnd(0, Math.PI));
    g.scale(1, rnd(0.25, 0.7));
    const blot = g.createRadialGradient(0, 0, 0, 0, 0, r);
    blot.addColorStop(0, `rgba(72, 74, 82, ${rnd(0.12, 0.3) * amount + 0.04})`);
    blot.addColorStop(1, 'rgba(72, 74, 82, 0)');
    g.fillStyle = blot;
    g.beginPath();
    g.arc(0, 0, r, 0, Math.PI * 2);
    g.fill();
    g.restore();
  }
  // Rubbing streaks: short, faint, mostly one way.
  const way = rnd(0, Math.PI);
  g.strokeStyle = '#4a4c55';
  g.lineCap = 'round';
  for (let k = 0; k < Math.round(12 * amount); k++) {
    const cx = x + rnd(0, w), cy = y + rnd(0, h), l = s * rnd(0.04, 0.16), a = way + rnd(-0.3, 0.3);
    g.globalAlpha = rnd(0.04, 0.12);
    g.lineWidth = s * rnd(0.004, 0.012);
    g.beginPath();
    g.moveTo(cx - Math.cos(a) * l, cy - Math.sin(a) * l);
    g.lineTo(cx + Math.cos(a) * l, cy + Math.sin(a) * l);
    g.stroke();
  }
  // Specks of dirt, and now and then a dot of blue ink.
  for (let k = 0; k < Math.round(30 * amount); k++) {
    g.globalAlpha = rnd(0.15, 0.45);
    g.fillStyle = Math.random() < 0.06 ? '#2b4aa8' : '#3b3a3f';
    g.beginPath();
    g.arc(x + rnd(0, w), y + rnd(0, h), s * rnd(0.002, 0.007), 0, Math.PI * 2);
    g.fill();
  }
  g.restore();
}

/** Scuffs on a print: small patches where it has worn through to the rubber, mostly at the edges. */
function scuff(g, w, h, amount) {
  g.save();
  for (let k = 0; k < Math.round(4 + 10 * amount); k++) {
    const edge = Math.random() < 0.7;
    const px = edge ? (Math.random() < 0.5 ? rnd(0, w * 0.08) : rnd(w * 0.92, w)) : rnd(0, w);
    const py = edge && Math.random() < 0.5 ? (Math.random() < 0.5 ? rnd(0, h * 0.1) : rnd(h * 0.9, h)) : rnd(0, h);
    g.globalAlpha = rnd(0.35, 0.8);
    g.fillStyle = RUBBER;
    g.beginPath();
    g.ellipse(px, py, h * rnd(0.01, 0.04), h * rnd(0.005, 0.02), rnd(0, Math.PI), 0, Math.PI * 2);
    g.fill();
  }
  g.restore();
}

function makeEraser() {
  const group = new THREE.Group();
  // Each of the box's six faces (+x, −x, +y, −y, +z, −z) has its own worn rubber texture.
  const faces = Array.from({ length: 6 }, () => {
    const [fc, fg] = canvas(256, 256);
    return { fc, fg, map: texture(fc) };
  });
  const body = new THREE.Mesh(roundedBox(ERASER.w, ERASER.h, ERASER.d, ERASER.r, 3),
    faces.map((f) => new THREE.MeshStandardMaterial({ map: f.map, roughness: 0.86, metalness: 0 })));
  body.castShadow = true;
  body.receiveShadow = true;
  group.add(body);
  // The canvas has the sticker's proportions, so each flag keeps its own (js/flags.js).
  const SW = ERASER.w - 2 * ERASER.r - 0.03, SD = ERASER.d - 2 * ERASER.r - 0.03;
  const [c, g] = canvas(1024, Math.round((1024 * SD) / SW));
  const map = texture(c);
  const sticker = new THREE.Mesh(
    new THREE.PlaneGeometry(SW, SD),
    new THREE.MeshStandardMaterial({ map, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -2 }),
  );
  sticker.rotation.x = -Math.PI / 2;
  sticker.position.y = ERASER.h / 2 + 0.002;
  sticker.receiveShadow = true;
  group.add(sticker);
  group.userData = {
    /** Prints `country`'s flag and gives the eraser fresh, random signs of use. */
    setFlag(country) {
      const used = rnd(0.35, 1);
      for (const f of faces) {
        f.fg.fillStyle = RUBBER;
        f.fg.fillRect(0, 0, 256, 256);
        smudge(f.fg, 0, 0, 256, 256, used * rnd(0.6, 1.2));
        f.map.needsUpdate = true;
      }
      paintFlag(g, c.width, c.height, country, RUBBER);
      scuff(g, c.width, c.height, used);
      smudge(g, 0, 0, c.width, c.height, used * 0.6, { edges: false });
      map.needsUpdate = true;
    },
  };
  return group;
}

/** A flat arrow on the desk along +x from the origin: shaft and head, scaled to length later. */
function makeArrow() {
  const group = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color: 0x34d399, transparent: true, opacity: 0.92, depthWrite: false });
  const shaft = new THREE.Mesh(new THREE.PlaneGeometry(1, 0.14).translate(0.5, 0, 0), mat);
  shaft.rotation.x = -Math.PI / 2;
  const shape = new THREE.Shape();
  shape.moveTo(0, -0.24);
  shape.lineTo(0.38, 0);
  shape.lineTo(0, 0.24);
  shape.closePath();
  const head = new THREE.Mesh(new THREE.ShapeGeometry(shape), mat);
  head.rotation.x = -Math.PI / 2;
  // The pull: a dark rubber band from the eraser back to the finger.
  const band = new THREE.Mesh(new THREE.PlaneGeometry(1, 0.05).translate(0.5, 0, 0),
    new THREE.MeshBasicMaterial({ color: 0x3b2a20, transparent: true, opacity: 0.55, depthWrite: false }));
  band.rotation.x = -Math.PI / 2;
  group.add(shaft, head, band);
  group.renderOrder = 2;
  group.visible = false;
  return { group, shaft, head, band, mat };
}

// ---------- the scene ----------

/**
 * opts: sound(name, n) · topInset() / bottomInset(): px of the stage covered at the top (bar and
 * status) and bottom (the flick buttons) · view / onViewChange: the camera angle, kept between
 * games · onFrame(dt): called before each frame is drawn (the game steps its physics there) ·
 * canAim(): whether the player may aim now · onAim({ power, x, y }), onAimEnd(shot | null): the
 * slingshot; shot = { dx, dz, power } · onSkip(): a tap during a replay.
 */
export function createScene(stage, opts) {
  const {
    topInset = () => 0, bottomInset = () => 0, view: savedView = null, onViewChange = () => {},
    onFrame = () => {}, canAim = () => false, onAim = () => {}, onAimEnd = () => {}, onSkip = () => {},
  } = opts;
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.domElement.className = 'pm-canvas';
  stage.prepend(renderer.domElement);

  const scene = new THREE.Scene();
  scene.environment = environment(renderer);
  scene.environmentIntensity = 0.7;
  scene.fog = new THREE.Fog(0x24201c, 18, 40); // the floor fades into the page's dark round the desk (distances set by fitOverview)
  const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 120);
  scene.add(new THREE.HemisphereLight(0xfff4e2, 0x4a3a2c, 0.8));
  // A window's light from the upper left: soft shadows (a wide blur on a fine map).
  const sun = new THREE.DirectionalLight(0xfff0da, 2.4);
  sun.position.set(-5, 11, 4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  // The shadow map covers the desk and the floor round the legs' feet: seen from the light, the
  // front-left foot is about 7.9 below the centre, so a box that stopped at 6 left that leg's
  // shadow unconnected to its foot.
  Object.assign(sun.shadow.camera, { left: -7, right: 7, top: 6.5, bottom: -9, near: 2, far: 30 });
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.02;
  scene.add(sun);
  const fill = new THREE.DirectionalLight(0xd5e4ff, 0.45);
  fill.position.set(6, 5, -5);
  scene.add(fill);
  scene.add(makeDesk(), makePencilCase(), makePencil());

  const erasers = [makeEraser(), makeEraser()];
  erasers[PLAYER].userData.setFlag('Malaysia');
  scene.add(...erasers);

  // A soft gold ring on the desk round your eraser when it's your turn.
  const ringMat = new THREE.MeshBasicMaterial({ color: 0xffd166, transparent: true, opacity: 0.8, depthWrite: false });
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.86, 0.98, 64), ringMat);
  ring.rotation.x = -Math.PI / 2;
  ring.visible = false;
  scene.add(ring);

  const arrow = makeArrow();
  scene.add(arrow.group);

  // "Anda" and "AI" tags over the erasers.
  const tags = [['Anda', 'you'], ['AI', 'ai']].map(([text, cls]) => {
    const el = document.createElement('span');
    el.className = `pm-tag ${cls}`;
    el.textContent = text;
    stage.append(el);
    return el;
  });
  const replayBadge = document.createElement('div');
  replayBadge.className = 'pm-replay';
  replayBadge.hidden = true;
  replayBadge.innerHTML = '<span class="pm-replay-dot" aria-hidden="true"></span>Ulang tayang · ketik untuk langkau';
  stage.append(replayBadge);

  // ---------- camera ----------
  let width = 1, height = 1, portrait = true;
  let yaw = Number(savedView?.yaw) || 0, pitch = Number(savedView?.pitch) || 0, refit = true;
  const EL0 = 0.92, EL_MIN = 0.42, EL_MAX = 1.45;
  const dirV = new THREE.Vector3();
  function dir() {
    const el = THREE.MathUtils.clamp(EL0 + pitch, EL_MIN, EL_MAX);
    return dirV.set(Math.sin(yaw) * Math.cos(el), Math.sin(el), Math.cos(yaw) * Math.cos(el));
  }
  function turnView(dYaw, dPitch) {
    yaw = (yaw + dYaw) % (Math.PI * 2);
    pitch = THREE.MathUtils.clamp(pitch + dPitch, EL_MIN - EL0, EL_MAX - EL0);
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
  const v = new THREE.Vector3();
  const probe = new THREE.PerspectiveCamera();
  const fit = { pos: new THREE.Vector3(), look: new THREE.Vector3(), dist: 14 };
  /** The desk (in a tall window, its middle part: the play area) must fit in the free space. */
  function outline() {
    const hx = portrait ? 3.5 : DESK.hx, pts = [];
    for (const x of [-hx, hx]) for (const z of [-DESK.hz, DESK.hz]) pts.push(new THREE.Vector3(x, DESK.top, z), new THREE.Vector3(x, DESK.top + 0.6, z));
    return pts;
  }
  function extent(look, dist, pts) {
    probe.copy(camera);
    probe.position.copy(look).addScaledVector(dir(), dist);
    probe.lookAt(look);
    probe.updateMatrixWorld();
    let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
    for (const p of pts) {
      v.copy(p).project(probe);
      x0 = Math.min(x0, v.x); x1 = Math.max(x1, v.x); y0 = Math.min(y0, v.y); y1 = Math.max(y1, v.y);
    }
    return { x0, x1, y0, y1 };
  }
  function fitOverview() {
    const pts = outline();
    const yTop = 1 - (2 * Math.max(0, topInset())) / height;
    const yBot = -1 + (2 * Math.max(0, bottomInset())) / height;
    const ty = (yTop + yBot) / 2, halfY = ((yTop - yBot) / 2) * 0.96;
    const look = new THREE.Vector3(0, DESK.top, 0);
    let dist = 14;
    for (let pass = 0; pass < 3; pass++) {
      let lo = 3, hi = 80;
      for (let k = 0; k < 24; k++) {
        const mid = (lo + hi) / 2, e = extent(look, mid, pts);
        if ((e.x1 - e.x0) / 2 < 0.96 && (e.y1 - e.y0) / 2 < halfY) hi = mid; else lo = mid;
      }
      dist = hi;
      const e = extent(look, dist, pts);
      const cx = (e.x0 + e.x1) / 2, cy = (e.y0 + e.y1) / 2;
      const vt = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
      const right = new THREE.Vector3().setFromMatrixColumn(probe.matrixWorld, 0);
      const up = new THREE.Vector3().setFromMatrixColumn(probe.matrixWorld, 1);
      look.addScaledVector(right, cx * vt * camera.aspect * dist).addScaledVector(up, (cy - ty) * vt * dist);
    }
    fit.look.copy(look);
    fit.dist = dist;
    fit.pos.copy(look).addScaledVector(dir(), dist);
    // The fog only fades the floor round the desk, never the desk: it starts past the desk's far
    // edge. (Fixed at 18 it dimmed the whole desk on a phone, where the camera sits ~23 back to
    // fit the desk across a narrow screen, most of all seen from the top.)
    scene.fog.near = dist + 5;
    scene.fog.far = dist + 27;
  }
  const camPos = new THREE.Vector3(), camLook = new THREE.Vector3();
  const wantPos = new THREE.Vector3(), wantLook = new THREE.Vector3();
  function aim(dt) {
    if (replay) {
      // Up close on the point, circling slowly round it.
      const t = replay.t / replay.total;
      const a = yaw + 0.55 - t * 0.7, el = 0.5;
      wantLook.copy(replay.focus);
      wantPos.set(Math.sin(a) * Math.cos(el), Math.sin(el), Math.cos(a) * Math.cos(el)).multiplyScalar(5.2).add(replay.focus);
    } else {
      wantPos.copy(fit.pos);
      wantLook.copy(fit.look);
    }
    const k = dt >= 1 ? 1 : 1 - Math.exp(-dt * (replay ? 4 : 3.2));
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
    camera.updateProjectionMatrix();
    fitOverview();
    if (!running) { aim(1); draw(); }
  }
  const ro = new ResizeObserver(resize);
  ro.observe(stage);

  // ---------- drawing ----------
  const tagPos = new THREE.Vector3();
  function placeTags() {
    erasers.forEach((e, i) => {
      tagPos.copy(e.position);
      tagPos.y += 0.62;
      tagPos.project(camera);
      const el = tags[i];
      const show = !replay && tagPos.z < 1 && e.position.y > -0.5;
      el.hidden = !show;
      if (show) el.style.transform = `translate(${((tagPos.x + 1) / 2) * width}px, ${((1 - tagPos.y) / 2) * height}px) translate(-50%, -100%)`;
    });
  }
  function draw() {
    renderer.render(scene, camera);
    placeTags();
  }

  let running = false, raf = 0, last = 0, pulse = 0, replay = null;
  function frame(now) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - (last || now)) / 1000);
    last = now;
    if (refit) { refit = false; fitOverview(); }
    if (replay) stepReplay(dt);
    else onFrame(dt);
    pulse += dt;
    ringMat.opacity = 0.45 + 0.35 * Math.sin(pulse * 4);
    if (ring.visible) ring.position.set(erasers[PLAYER].position.x, DESK.top + 0.004, erasers[PLAYER].position.z);
    aim(dt);
    draw();
  }

  function setPoses(poses) {
    poses.forEach((ps, i) => {
      erasers[i].position.set(ps.p.x, ps.p.y, ps.p.z);
      erasers[i].quaternion.set(ps.q.x, ps.q.y, ps.q.z, ps.q.w);
    });
  }

  // ---------- the aim arrow ----------
  const powerColor = new THREE.Color();
  /** Shows eraser i's aim: along (dx, dz), its length and colour by power; `pull` the band's end. */
  function showAim(i, dx, dz, power, pull = null) {
    const e = erasers[i].position;
    const len = 0.5 + power * 2.4;
    arrow.group.visible = true;
    arrow.group.position.set(e.x, DESK.top + 0.02, e.z);
    arrow.group.rotation.y = Math.atan2(-dz, dx);
    arrow.shaft.position.x = 0.72;
    arrow.shaft.scale.x = len;
    arrow.head.position.x = 0.72 + len;
    // Green when gentle, yellow, then red at full power (as the gauge).
    powerColor.setHSL(0.38 - 0.38 * power, 0.85, 0.52);
    arrow.mat.color.copy(powerColor);
    const back = pull ? Math.hypot(pull.x - e.x, pull.z - e.z) : 0.5 + power * 1.2;
    arrow.band.scale.x = back;
    arrow.band.rotation.z = Math.PI; // the band points back, away from the flick
  }
  const hideAim = () => { arrow.group.visible = false; };

  // ---------- the replay ----------
  let replayResolve = null;
  function stepReplay(dt) {
    const r = replay;
    r.t += dt * 0.55; // slow motion
    while (r.k < r.frames.length - 1 && r.frames[r.k + 1].t <= r.t) r.k++;
    setPoses(r.frames[r.k].poses);
    if (r.t >= r.total + 0.4) endReplay();
  }
  function endReplay() {
    if (!replay) return;
    replay = null;
    replayBadge.hidden = true;
    replayResolve?.();
    replayResolve = null;
  }

  // ---------- input: aim at your eraser, or turn the view ----------
  const canvasEl = renderer.domElement;
  const ray = new THREE.Raycaster(), pointer = new THREE.Vector2();
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -(DESK.top + ERASER.h / 2));
  const hitPoint = new THREE.Vector3();
  function deskPoint(e) {
    const r = canvasEl.getBoundingClientRect();
    pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(pointer, camera);
    return ray.ray.intersectPlane(plane, hitPoint) ? hitPoint.clone() : null;
  }
  function onOwnEraser(e) {
    const r = canvasEl.getBoundingClientRect();
    pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(pointer, camera);
    if (ray.intersectObject(erasers[PLAYER], true).length) return true;
    // A little generous round it, for fingers.
    const p = deskPoint(e), at = erasers[PLAYER].position;
    return !!p && Math.hypot(p.x - at.x, p.z - at.z) < 0.95;
  }
  let drag = null; // { kind: 'aim' | 'view', id, x, y, ... }
  canvasEl.addEventListener('pointerdown', (e) => {
    if (drag) return;
    if (replay) { onSkip(); return; }
    try { canvasEl.setPointerCapture(e.pointerId); } catch { /* gone */ }
    if (canAim() && onOwnEraser(e)) {
      const r = canvasEl.getBoundingClientRect();
      drag = {
        kind: 'aim', id: e.pointerId, x: e.clientX, y: e.clientY, from: deskPoint(e), shot: null,
        // Full power is a pull of PULL_PX, or less near the bottom edge (pulling is usually down).
        pull: Math.max(PULL_MIN, Math.min(PULL_PX, window.innerHeight - EDGE - e.clientY)), rect: r,
      };
      e.preventDefault();
      return;
    }
    drag = { kind: 'view', id: e.pointerId, x: e.clientX, y: e.clientY, moved: false };
  });
  canvasEl.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    if (drag.kind === 'view') {
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (!drag.moved && Math.hypot(dx, dy) < MOVE_PX) return;
      drag.moved = true;
      turnView(-dx * 0.007, dy * 0.005);
      drag.x = e.clientX;
      drag.y = e.clientY;
      return;
    }
    const px = Math.hypot(e.clientX - drag.x, e.clientY - drag.y);
    const p = deskPoint(e);
    if (!p || !drag.from || px < MOVE_PX) {
      drag.shot = null;
      hideAim();
      onAim({ power: 0, x: e.clientX - drag.rect.left, y: e.clientY - drag.rect.top });
      return;
    }
    // Slingshot: the flick goes opposite the pull, harder the further you pull.
    const bx = p.x - drag.from.x, bz = p.z - drag.from.z, d = Math.hypot(bx, bz);
    if (d < 0.02) return;
    const power = Math.min(1, px / drag.pull);
    drag.shot = { dx: -bx / d, dz: -bz / d, power };
    const at = erasers[PLAYER].position;
    showAim(PLAYER, drag.shot.dx, drag.shot.dz, power, { x: at.x + bx, z: at.z + bz });
    onAim({ power, x: e.clientX - drag.rect.left, y: e.clientY - drag.rect.top });
  });
  const release = (e, cancel) => {
    if (!drag || e.pointerId !== drag.id) return;
    const d = drag;
    drag = null;
    if (d.kind !== 'aim') return;
    hideAim();
    onAimEnd(!cancel && d.shot && d.shot.power >= 0.05 ? d.shot : null);
  };
  canvasEl.addEventListener('pointerup', (e) => release(e, false));
  canvasEl.addEventListener('pointercancel', (e) => release(e, true));

  // Back to the starting angle; shown only once the view has been turned.
  const resetBtn = document.createElement('button');
  resetBtn.type = 'button';
  resetBtn.className = 'icon-btn pm-reset-view';
  resetBtn.setAttribute('aria-label', 'Pandangan asal');
  resetBtn.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12a8 8 0 1 0 2.4-5.7M4 4v5h5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  resetBtn.hidden = Math.abs(yaw) < 0.01 && Math.abs(pitch) < 0.01;
  resetBtn.addEventListener('click', resetView);
  stage.append(resetBtn);

  const proj = new THREE.Vector3();
  return {
    start() {
      if (running) return;
      running = true;
      last = 0;
      resize();
      aim(1);
      raf = requestAnimationFrame(frame);
    },
    stop() {
      running = false;
      cancelAnimationFrame(raf);
      endReplay();
    },
    setPoses,
    /** A new match: the AI's flag, and both erasers freshly (and randomly) smudged. */
    setAiFlag(country) {
      erasers[PLAYER].userData.setFlag('Malaysia');
      erasers[AI].userData.setFlag(country);
    },
    /** The ring round your eraser while you may flick. */
    setTurn(playerAims) { ring.visible = playerAims; },
    showAim,
    hideAim,
    /** Cancels an aim in progress (the turn ended under the finger). */
    cancelAim() { if (drag?.kind === 'aim') { drag = null; hideAim(); } },
    /** Eraser i's place on the stage, in CSS pixels. */
    screenOf(i) {
      proj.copy(erasers[i].position).project(camera);
      return { x: ((proj.x + 1) / 2) * width, y: ((1 - proj.y) / 2) * height };
    },
    /**
     * Replays recorded frames ({ t, poses }) in slow motion, the camera close on `focus` (a
     * point { x, y, z }). Resolves when done or skipped.
     */
    replay(frames, focus) {
      endReplay();
      if (!frames.length) return Promise.resolve();
      const t0 = frames[0].t;
      const list = frames.map((f) => ({ t: f.t - t0, poses: f.poses }));
      replay = { frames: list, t: 0, k: 0, total: list[list.length - 1].t, focus: new THREE.Vector3(focus.x, focus.y, focus.z) };
      replayBadge.hidden = false;
      return new Promise((resolve) => { replayResolve = resolve; });
    },
    skipReplay: endReplay,
    get replaying() { return !!replay; },
    turnView,
    resetView,
  };
}
