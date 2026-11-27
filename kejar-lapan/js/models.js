// Kejar Lapan: voxel models. Each model is many boxes merged into one geometry with vertex
// colours, drawn with one shared material: one draw call per model, built once and reused.
import * as THREE from '../../shared/vendor/three.module.min.js';
import { LANDMARKS } from './config.js';

/** The one material for every vertex-coloured voxel model. */
export const voxelMat = new THREE.MeshLambertMaterial({ vertexColors: true });

/** Boxes [w, h, d, x, y, z, colour] merged into one BufferGeometry. */
export function voxels(boxes) {
  const pos = [];
  const nor = [];
  const col = [];
  const c = new THREE.Color();
  for (const [w, h, d, x, y, z, hex] of boxes) {
    const g = new THREE.BoxGeometry(w, h, d).toNonIndexed();
    g.translate(x, y, z);
    c.setHex(hex);
    const p = g.attributes.position.array;
    const n = g.attributes.normal.array;
    for (let i = 0; i < p.length; i += 3) {
      pos.push(p[i], p[i + 1], p[i + 2]);
      nor.push(n[i], n[i + 1], n[i + 2]);
      col.push(c.r, c.g, c.b);
    }
    g.dispose();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.computeBoundingSphere();
  return geo;
}

const mesh = (geo, mat = voxelMat, shadow = true) => {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = shadow;
  return m;
};

// ---------- textures (each made once) ----------

const FONT = "'Lexend', system-ui, sans-serif";
const texCache = new Map();

function canvasTex(key, w, h, draw, nearest = true) {
  if (texCache.has(key)) return texCache.get(key);
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  draw(cv.getContext('2d'), w, h);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  if (nearest) tex.magFilter = tex.minFilter = THREE.NearestFilter;
  tex.anisotropy = 1;
  texCache.set(key, tex);
  return tex;
}

const matCache = new Map();
/** A Lambert material with a cached texture, itself cached by key. */
function texMat(key, texture) {
  if (!matCache.has(key)) matCache.set(key, new THREE.MeshLambertMaterial({ map: texture }));
  return matCache.get(key);
}

/** A banner: text centred on a coloured board with a border. */
export function bannerMat(text, bg = '#4c1d95', fg = '#facc15', w = 1024, h = 192) {
  const key = `banner:${text}:${bg}:${fg}:${w}x${h}`;
  return texMat(
    key,
    canvasTex(key, w, h, (ctx) => {
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = fg;
      ctx.lineWidth = Math.round(h * 0.07);
      ctx.strokeRect(ctx.lineWidth / 2 + 4, ctx.lineWidth / 2 + 4, w - ctx.lineWidth - 8, h - ctx.lineWidth - 8);
      ctx.fillStyle = fg;
      let size = Math.round(h * 0.42);
      ctx.font = `800 ${size}px ${FONT}`;
      while (ctx.measureText(text).width > w * 0.9 && size > 10) {
        size -= 2;
        ctx.font = `800 ${size}px ${FONT}`;
      }
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, w / 2, h / 2 + size * 0.04);
    }, false),
  );
}

export function roadTextures() {
  const road = canvasTex('road', 64, 64, (ctx) => {
    for (let y = 0; y < 64; y++) {
      for (let x = 0; x < 64; x++) {
        const n = ((x * 37 + y * 17) % 5) * 4;
        ctx.fillStyle = `rgb(${44 + n},${48 + n},${56 + n})`;
        ctx.fillRect(x, y, 1, 1);
      }
    }
    ctx.fillStyle = '#eab308';
    ctx.fillRect(2, 0, 2, 64);
    ctx.fillRect(60, 0, 2, 64);
    ctx.fillStyle = '#f8fafc';
    for (let y = 2; y < 64; y += 16) {
      ctx.fillRect(21, y, 2, 9);
      ctx.fillRect(41, y, 2, 9);
    }
  });
  road.wrapS = road.wrapT = THREE.RepeatWrapping;
  road.repeat.set(1, 3);
  const grass = canvasTex('grass', 16, 16, (ctx) => {
    const pal = ['#3b8526', '#44962c', '#337520', '#4ea633'];
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      ctx.fillStyle = pal[(x * 7 + y * 13) % pal.length];
      ctx.fillRect(x, y, 1, 1);
    }
  });
  grass.wrapS = grass.wrapT = THREE.RepeatWrapping;
  grass.repeat.set(45, 10);
  const walk = canvasTex('walk', 16, 16, (ctx) => {
    ctx.fillStyle = '#9ca3af';
    ctx.fillRect(0, 0, 16, 16);
    ctx.fillStyle = '#6b7280';
    ctx.fillRect(0, 7, 16, 1);
    ctx.fillRect(0, 15, 16, 1);
    ctx.fillRect(7, 0, 1, 8);
    ctx.fillRect(15, 8, 1, 8);
  });
  walk.wrapS = walk.wrapT = THREE.RepeatWrapping;
  walk.repeat.set(2, 16);
  return {
    road: texMat('road', road),
    grass: texMat('grass', grass),
    walk: texMat('walk', walk),
  };
}

export function skyTexture() {
  return canvasTex('sky', 16, 64, (ctx) => {
    const g = ctx.createLinearGradient(0, 0, 0, 64);
    g.addColorStop(0, '#2563eb');
    g.addColorStop(0.6, '#60a5fa');
    g.addColorStop(0.9, '#bae6fd');
    g.addColorStop(1, '#fef08a');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 16, 64);
  });
}

const ROLE_CARD = {
  pelajar: { head: '#4c1d95', title: 'KAD MATRIK', id: '2026884910', body: '#1d4ed8' },
  staf: { head: '#1e1b4b', title: 'KAD STAF', id: 'STF-4092', body: '#581c87' },
  alumni: { head: '#111827', title: 'KAD ALUMNI', id: 'ALM-1956', body: '#111827' },
  awam: { head: '#166534', title: 'PAS PELAWAT', id: 'PLW-0808', body: '#16a34a' },
};

function idCardMat(role) {
  const r = ROLE_CARD[role];
  return texMat(
    `card:${role}`,
    canvasTex(`card:${role}`, 128, 192, (ctx) => {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, 128, 192);
      ctx.fillStyle = r.head;
      ctx.fillRect(0, 0, 128, 44);
      ctx.fillStyle = '#facc15';
      ctx.fillRect(0, 44, 128, 8);
      ctx.font = `800 16px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.fillText('UiTM', 64, 22);
      ctx.fillStyle = '#ffffff';
      ctx.font = `700 9px ${FONT}`;
      ctx.fillText(r.title, 64, 37);
      ctx.fillStyle = r.body;
      ctx.beginPath();
      ctx.arc(64, 84, 14, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillRect(40, 102, 48, 26);
      ctx.fillStyle = '#0f172a';
      ctx.font = `600 10px monospace`;
      ctx.fillText(r.id, 64, 146);
      for (let x = 22; x < 106; x += 4) ctx.fillRect(x, 156, x % 8 === 0 ? 2 : 1, 18);
    }),
  );
}

// ---------- the player ----------

const SKIN = 0xd99b66;
const HAIR = 0x18181b;

const OUTFITS = {
  pelajar: { shirt: 0x1d4ed8, sleeve: 0x1d4ed8, pants: 0x1e293b, shoes: 0xf8fafc },
  staf: { shirt: 0x581c87, sleeve: 0x581c87, pants: 0x0b0d16, shoes: 0x111827 },
  alumni: { shirt: 0x111827, sleeve: 0x111827, pants: 0x111827, shoes: 0x111827 },
  awam: { shirt: 0x16a34a, sleeve: 0x16a34a, pants: 0x1e40af, shoes: 0xf1f5f9 },
};

// Shared clothing geometry: both worn models and isolated wardrobe cards use these shapes.
function outfitTorsoBoxes(design) {
  if (design === 'robe') return [
    [0.82, 0.92, 0.5, 0, 0, 0, 0x18181b],
    [0.46, 0.8, 0.56, -0.25, -0.78, 0, 0x18181b],
    [0.46, 0.8, 0.56, 0.25, -0.78, 0, 0x18181b],
    [0.88, 0.17, 0.56, 0, -0.24, 0, 0xf1f5f9],
    [0.16, 0.13, 0.58, 0.1, -0.25, 0, 0xe2e8f0],
    ...[-1, 1].flatMap((side) => [
      [0.13, 0.18, 0.04, side * 0.2, 0.39, -0.27, 0xf8fafc],
      [0.13, 0.18, 0.04, side * 0.14, 0.24, -0.27, 0xf8fafc],
      [0.13, 0.18, 0.04, side * 0.08, 0.09, -0.27, 0xf8fafc],
    ]),
    [0.28, 0.28, 0.03, 0, 0.18, 0.27, 0xf1f5f9],
    [0.15, 0.15, 0.04, 0, 0.18, 0.29, 0x18181b],
  ];
  if (design === 'vest') return [
    [0.76, 0.92, 0.44, 0, 0, 0, 0xe2e8f0],
    [0.34, 0.82, 0.12, -0.22, -0.02, -0.27, 0x4d7c0f],
    [0.34, 0.82, 0.12, 0.22, -0.02, -0.27, 0x4d7c0f],
    [0.84, 0.84, 0.1, 0, 0, 0.27, 0x4d7c0f],
    ...[-1, 1].flatMap((side) => [
      [0.26, 0.24, 0.13, side * 0.22, -0.23, -0.38, 0x365314],
      [0.28, 0.06, 0.15, side * 0.22, -0.09, -0.39, 0x84cc16],
      [0.24, 0.16, 0.1, side * 0.22, 0.22, -0.36, 0x365314],
    ]),
    [0.08, 0.68, 0.05, 0, 0, -0.28, 0xfacc15],
    [0.84, 0.1, 0.54, 0, -0.44, 0, 0x451a03],
  ];
  return null;
}
function outfitSleeveBoxes(design) {
  if (design === 'robe') return [
    [0.44, 0.68, 0.46, 0, -0.28, 0, 0x18181b],
    [0.46, 0.08, 0.48, 0, -0.6, 0, 0xf1f5f9],
  ];
  if (design === 'vest') return [
    [0.26, 0.24, 0.28, 0, -0.08, 0, 0xe2e8f0],
    [0.22, 0.5, 0.22, 0, -0.45, 0, SKIN],
  ];
  return null;
}

/**
 * The player for a role, split at the joints so it can run: returns the group and its pivots.
 * Faces −z (the way it runs).
 */
export function buildPlayer(role, cosmetics = {}) {
  const o = { ...(OUTFITS[role] ?? OUTFITS.pelajar) };
  const outfit = cosmetics.outfit?.design;
  if (outfit === 'robe') o.pants = 0x18181b;
  const group = new THREE.Group();
  const body = new THREE.Group(); // tilts and squashes for slides
  group.add(body);

  const torsoBoxes = [
    [0.76, 0.92, 0.44, 0, 0, 0, o.shirt],
    [0.42, 0.14, 0.46, 0, 0.44, 0, 0xf1f5f9], // collar
  ];
  if (outfitTorsoBoxes(outfit)) {
    torsoBoxes.splice(0, torsoBoxes.length, ...outfitTorsoBoxes(outfit));
  } else if (role === 'pelajar') {
    torsoBoxes.push(
      [0.14, 0.48, 0.46, 0, 0.15, 0, 0xfacc15], // lanyard
      [0.24, 0.3, 0.48, 0, -0.08, 0, 0xf1f5f9], // matric card

    );
  } else if (role === 'staf') {
    torsoBoxes.push(
      [0.16, 0.65, 0.46, -0.22, 0.1, 0, 0x3b0764], // lapels
      [0.16, 0.65, 0.46, 0.22, 0.1, 0, 0x3b0764],
      [0.14, 0.48, 0.47, 0, 0.15, 0, 0xfacc15], // lanyard
      [0.24, 0.3, 0.48, 0, -0.08, 0, 0xf1f5f9], // staff card
    );
  } else if (role === 'alumni') {
    torsoBoxes.push(
      [0.2, 0.9, 0.46, -0.24, 0.02, 0, 0x7e22ce], // hood trim, UiTM purple
      [0.2, 0.9, 0.46, 0.24, 0.02, 0, 0x7e22ce],
      [0.82, 0.62, 0.5, 0, -0.66, 0, 0x111827], // the robe falls over the thighs
      [0.84, 0.08, 0.52, 0, -0.94, 0, 0xfacc15],
    );
  } else {
    torsoBoxes.push(
      [0.5, 0.2, 0.46, 0, 0.12, 0, 0xf1f5f9], // stripe on the T-shirt
      [0.2, 0.26, 0.48, 0.18, -0.12, 0, 0xfacc15], // visitor pass
    );
  }
  if (!cosmetics.back && role === 'pelajar') {
    torsoBoxes.push(
      [0.68, 0.78, 0.34, 0, 0.04, 0.38, 0xfacc15],
      [0.48, 0.35, 0.1, 0, -0.1, 0.56, 0x3b0764],
    );
  }
  const torso = new THREE.Group();
  torso.position.y = 1.38;
  torso.add(mesh(voxels(torsoBoxes)));
  body.add(torso);
  const bag = cosmetics.back?.design ? cosmetics.back : null;
  if (bag) {
    const bagGroup = new THREE.Group();
    bagGroup.name = `cosmetic-bag-${bag.design}`;
    torso.add(bagGroup);
    if (bag.design === 'round') {
      const disc = new THREE.CylinderGeometry(0.42, 0.42, 0.3, 12);
      disc.rotateX(Math.PI / 2);
      disc.translate(0, 0, 0.43);
      bagGroup.add(mesh(disc, new THREE.MeshLambertMaterial({ color: bag.colour })));
      bagGroup.add(mesh(voxels([
        [0.16, 0.15, 0.04, 0, 0, 0.6, 0xfef3c7],
        [0.12, 0.38, 0.12, -0.22, 0.32, 0.25, bag.colour],
        [0.12, 0.38, 0.12, 0.22, 0.32, 0.25, bag.colour],
        [0.25, 0.08, 0.12, 0, 0.48, 0.4, 0xdb2777],
      ])));
    } else if (bag.design === 'cat') {
      bagGroup.add(mesh(voxels([
        [0.76, 0.65, 0.32, 0, 0, 0.43, bag.colour],
        [0.16, 0.24, 0.3, -0.27, 0.4, 0.43, bag.colour],
        [0.16, 0.24, 0.3, 0.27, 0.4, 0.43, bag.colour],
        [0.08, 0.12, 0.02, -0.27, 0.4, 0.59, 0xfda4af],
        [0.08, 0.12, 0.02, 0.27, 0.4, 0.59, 0xfda4af],
        [0.08, 0.1, 0.03, -0.17, 0.06, 0.61, 0x18181b],
        [0.08, 0.1, 0.03, 0.17, 0.06, 0.61, 0x18181b],
        [0.1, 0.07, 0.04, 0, -0.06, 0.62, 0xfb7185],
        [0.17, 0.025, 0.03, -0.25, -0.08, 0.61, 0x78350f],
        [0.17, 0.025, 0.03, 0.25, -0.08, 0.61, 0x78350f],
        [0.17, 0.025, 0.03, -0.25, -0.16, 0.61, 0x78350f],
        [0.17, 0.025, 0.03, 0.25, -0.16, 0.61, 0x78350f],
      ])));

    }
  }
  if (cosmetics.back?.id === 'jetpack') {
    const jetpack = new THREE.Group();
    jetpack.name = 'cosmetic-jetpack';
    jetpack.add(mesh(voxels([
      [0.56, 0.7, 0.3, 0, 0, 0.38, 0x475569],
      [0.18, 0.3, 0.06, 0, 0.08, 0.56, 0x38bdf8],
      [0.12, 0.6, 0.5, -0.25, 0.24, 0, 0x334155],
      [0.12, 0.6, 0.5, 0.25, 0.24, 0, 0x334155],
      ...[-1, 1].flatMap((side) => [
        [0.28, 0.82, 0.4, side * 0.37, 0, 0.45, 0xcbd5e1],
        [0.3, 0.13, 0.42, side * 0.37, 0.3, 0.45, 0xf97316],
        [0.24, 0.16, 0.32, side * 0.37, -0.48, 0.45, 0x334155],
        [0.14, 0.07, 0.2, side * 0.37, -0.58, 0.45, 0x38bdf8],
      ]),
    ])));
    torso.add(jetpack);
  }
  if (cosmetics.back?.id === 'katanas') {
    // Crossed sheathed blades occupy the back slot, above both shoulders.
    const swords = new THREE.Group();
    swords.name = 'cosmetic-katanas';
    // The harness touches the torso's back face (z = 0.22); sheaths sit on the mount.
    const mount = mesh(voxels([
      [0.46, 0.55, 0.12, 0, 0, 0.28, 0x1e293b],
      [0.1, 0.62, 0.5, -0.26, 0.2, 0, 0x334155],
      [0.1, 0.62, 0.5, 0.26, 0.2, 0, 0x334155],
      [0.18, 0.12, 0.14, 0, 0.12, 0.33, 0xfacc15],
    ]));
    mount.name = 'katana-harness';
    swords.add(mount);
    for (const side of [-1, 1]) {
      const sword = mesh(voxels([
        [0.12, 1.3, 0.12, 0, -0.1, 0, 0x334155],
        [0.04, 1.25, 0.13, 0.05, -0.1, 0, 0xcbd5e1],
        [0.33, 0.08, 0.22, 0, 0.6, 0, 0xfacc15],
        [0.13, 0.46, 0.13, 0, 0.86, 0, 0x7e22ce],
        ...[0.7, 0.82, 0.94, 1.06].map((y) => [0.15, 0.04, 0.15, 0, y, 0, 0xf1f5f9]),
      ]));
      sword.rotation.z = side * 0.65;
      sword.position.set(0, 0.02, 0.35);
      swords.add(sword);
    }
    torso.add(swords);
  }


  const headBoxes = [
    [0.58, 0.58, 0.58, 0, 0, 0, SKIN],
    [0.62, 0.2, 0.62, 0, 0.24, 0, HAIR],
    [0.62, 0.42, 0.22, 0, 0.08, 0.22, HAIR],
    [0.08, 0.08, 0.04, -0.12, 0.02, -0.3, 0x0f172a], // eyes
    [0.08, 0.08, 0.04, 0.12, 0.02, -0.3, 0x0f172a],
  ];
  if (role === 'alumni' && !['cap', 'hat'].includes(cosmetics.head?.id)) {
    headBoxes.push(
      [0.9, 0.06, 0.9, 0, 0.4, 0, 0x111827], // mortarboard
      [0.42, 0.16, 0.42, 0, 0.32, 0, 0x111827],
      [0.06, 0.34, 0.06, 0.4, 0.24, -0.1, 0xfacc15], // tassel
    );
  } else if (role === 'awam' && !['cap', 'hat'].includes(cosmetics.head?.id)) {
    headBoxes.push(
      [0.66, 0.16, 0.66, 0, 0.34, 0, 0xdc2626], // cap
      [0.5, 0.06, 0.3, 0, 0.27, -0.44, 0xdc2626],
    );
  }
  if (cosmetics.face?.id === 'glasses') {
    headBoxes.push(
      [0.25, 0.16, 0.06, -0.16, 0.02, -0.34, 0x0f172a],
      [0.25, 0.16, 0.06, 0.16, 0.02, -0.34, 0x0f172a],
      [0.14, 0.04, 0.06, 0, 0.04, -0.34, 0xfacc15],
      [0.04, 0.08, 0.5, -0.3, 0.04, -0.1, 0x0f172a],
      [0.04, 0.08, 0.5, 0.3, 0.04, -0.1, 0x0f172a],
    );
  }
  if (cosmetics.face?.id === 'mask') {
    headBoxes.push(
      [0.64, 0.64, 0.1, 0, 0, -0.35, 0xf1f5f9],
      [0.12, 0.5, 0.22, -0.29, 0, -0.27, 0xe2e8f0],
      [0.12, 0.5, 0.22, 0.29, 0, -0.27, 0xe2e8f0],
      [0.18, 0.1, 0.025, -0.15, 0.07, -0.415, 0x0f172a],
      [0.18, 0.1, 0.025, 0.15, 0.07, -0.415, 0x0f172a],
      [0.07, 0.22, 0.03, -0.2, -0.13, -0.415, 0xdc2626],
      [0.07, 0.22, 0.03, 0.2, -0.13, -0.415, 0xdc2626],
      [0.2, 0.04, 0.03, 0, -0.19, -0.415, 0x334155],
    );
  }
  if (cosmetics.head?.id === 'cap') {
    headBoxes.push(
      [0.72, 0.24, 0.72, 0, 0.38, 0, 0xfacc15],
      [0.56, 0.1, 0.56, 0, 0.55, 0, 0xfde047],
      [0.82, 0.08, 0.84, 0, 0.24, -0.03, 0xeab308],
      [0.1, 0.34, 0.5, -0.32, 0.12, 0.05, 0xfacc15],
      [0.1, 0.34, 0.5, 0.32, 0.12, 0.05, 0xfacc15],
      [0.12, 0.06, 0.62, 0, 0.62, 0, 0xfef08a],
      [0.04, 0.3, 0.04, -0.32, -0.08, -0.14, 0x334155],
      [0.04, 0.3, 0.04, 0.32, -0.08, -0.14, 0x334155],
      [0.66, 0.04, 0.04, 0, -0.23, -0.14, 0x334155],
    );
  } else if (cosmetics.head?.id === 'hat') {
    headBoxes.push(
      [1.05, 0.08, 1.02, 0, 0.34, 0, 0xd6a65b],
      [0.66, 0.35, 0.64, 0, 0.54, 0, 0xd6a65b],
      [0.68, 0.1, 0.66, 0, 0.42, 0, 0x92400e],
    );
  }
  const head = new THREE.Group();
  head.position.y = 0.78;
  head.add(mesh(voxels(headBoxes)));
  torso.add(head);
  if (cosmetics.head?.id === 'headband') {
    const halo = new THREE.Mesh(
      new THREE.TorusGeometry(0.43, 0.045, 8, 32),
      new THREE.MeshBasicMaterial({ color: 0xfacc15 }),
    );
    halo.name = 'cosmetic-halo';
    halo.rotation.x = Math.PI / 2;
    // Above even the alumni mortarboard, with a visible air gap and no support stem.
    halo.position.y = role === 'alumni' ? 0.7 : 0.62;
    head.add(halo);
  }

  const arm = (side) => {
    const pivot = new THREE.Group();
    pivot.position.set(side * 0.52, 0.38, 0);
    const boxes = [
      ...(outfitSleeveBoxes(outfit) ?? [[0.24, 0.72, 0.24, 0, -0.32, 0, o.sleeve]]),
      [0.22, 0.2, 0.22, 0, -0.74, 0, SKIN],
    ];
    if (role === 'staf' && side === 1 && !cosmetics.hand) boxes.push([0.18, 0.38, 0.54, 0.06, -0.94, 0, 0x451a03]); // briefcase
    if (role === 'alumni' && side === 1 && !cosmetics.hand) boxes.push([0.14, 0.14, 0.56, 0.04, -0.8, -0.1, 0xfef3c7]); // scroll
    if (cosmetics.hand?.id === 'briefcase' && side === 1) {
      boxes.push(
        [0.1, 0.15, 0.07, 0, -0.88, -0.14, 0x451a03],
        [0.1, 0.15, 0.07, 0, -0.88, 0.14, 0x451a03],
        [0.1, 0.06, 0.35, 0, -0.82, 0, 0x451a03],
        [0.22, 0.44, 0.66, 0, -1.13, 0, 0x78350f],
        [0.24, 0.07, 0.68, 0, -1.0, 0, 0x451a03],
        [0.03, 0.09, 0.1, 0.13, -1.05, 0, 0xfacc15],
      );
    }
    if (cosmetics.hand?.id === 'trident' && side === 1) {
      boxes.push(
        [0.08, 1.55, 0.08, 0, -0.5, -0.04, 0xb45309],
        [0.56, 0.1, 0.13, 0, 0.28, -0.04, 0xfacc15],
        [0.1, 0.68, 0.13, 0, 0.62, -0.04, 0xfacc15],
        [0.1, 0.48, 0.13, -0.25, 0.51, -0.04, 0xfacc15],
        [0.1, 0.48, 0.13, 0.25, 0.51, -0.04, 0xfacc15],
        [0.06, 0.16, 0.09, 0, 1.01, -0.04, 0xfef08a],
        [0.06, 0.16, 0.09, -0.25, 0.83, -0.04, 0xfef08a],
        [0.06, 0.16, 0.09, 0.25, 0.83, -0.04, 0xfef08a],
        [0.13, 0.07, 0.13, 0, -0.65, -0.04, 0x38bdf8],
      );
    }
    if (cosmetics.hand?.id === 'handheld' && side === 1) {
      boxes.push(
        [0.08, 0.08, 0.8, 0, -0.75, -0.25, 0x7e22ce],
        [0.32, 0.1, 0.12, 0, -0.75, -0.72, 0xfacc15],
        [0.1, 0.32, 0.12, 0, -0.75, -0.72, 0xfacc15],
        [0.22, 0.22, 0.14, 0, -0.75, -0.72, 0xfef08a],
      );
    }
    pivot.add(mesh(voxels(boxes)));
    torso.add(pivot);
    return pivot;
  };
  const leg = (side) => {
    const hip = new THREE.Group();
    hip.position.set(side * 0.2, 0.92, 0);
    hip.add(mesh(voxels([[0.32, 0.46, 0.32, 0, -0.22, 0, o.pants]])));
    const knee = new THREE.Group();
    knee.position.y = -0.44;
    knee.add(mesh(voxels([
      [0.3, 0.42, 0.3, 0, -0.2, 0, o.pants],
      [0.32, 0.2, 0.44, 0, -0.42, -0.06, o.shoes],
    ])));
    hip.add(knee);
    body.add(hip);
    return { hip, knee };
  };
  const lArm = arm(-1);
  const rArm = arm(1);
  const lLeg = leg(-1);
  const rLeg = leg(1);

  // Shield: a voxel frame that spins round the player while it lasts.
  const shield = new THREE.Group();
  shield.position.y = 1.25;
  const shieldWire = new THREE.Mesh(
    new THREE.BoxGeometry(1.7, 2.4, 1.7),
    new THREE.MeshBasicMaterial({ color: 0x67e8f9, wireframe: true, transparent: true, opacity: 0.45, depthWrite: false }),
  );
  const shieldGlow = new THREE.Mesh(
    new THREE.BoxGeometry(1.65, 2.35, 1.65),
    new THREE.MeshBasicMaterial({ color: 0x06b6d4, transparent: true, opacity: 0.1, depthWrite: false }),
  );
  shield.add(shieldGlow, shieldWire);
  shield.visible = false;
  group.add(shield);

  return { group, body, torso, head, lArm, rArm, lLeg, rLeg, shield };
}

/** The actual cosmetic geometry, isolated from the avatar for selection cards. */
export function buildCosmeticItem(role, item, slot = item?.slot) {
  const result = new THREE.Group();
  if (slot === 'outfit') {
    const o = OUTFITS[role] ?? OUTFITS.pelajar;
    const design = item?.design;
    const torso = outfitTorsoBoxes(design);
    if (torso) {
      result.add(mesh(voxels(torso)));
      for (const side of [-1, 1]) {
        const sleeves = outfitSleeveBoxes(design).filter((box) => box[6] !== SKIN);
        const sleeve = mesh(voxels(sleeves));
        sleeve.position.set(side * 0.52, 0.38, 0);
        result.add(sleeve);
      }
    } else result.add(mesh(voxels([
      [0.76, 0.92, 0.44, 0, 0, 0, o.shirt],
      [0.42, 0.14, 0.46, 0, 0.44, 0, 0xf1f5f9],
      [0.24, 0.72, 0.24, -0.52, 0.06, 0, o.sleeve],
      [0.24, 0.72, 0.24, 0.52, 0.06, 0, o.sleeve],
    ])));
    return result;
  }
  if (!item) {
    // Empty equipment option, with no character or mannequin.
    result.add(new THREE.Mesh(new THREE.TorusGeometry(0.4, 0.045, 8, 32), new THREE.MeshLambertMaterial({ color: 0x94a3b8 })));
    const slash = mesh(voxels([[0.08, 0.86, 0.06, 0, 0, 0, 0x94a3b8]]));
    slash.rotation.z = -Math.PI / 4;
    result.add(slash);
    return result;
  }
  const player = buildPlayer(role, { [item.slot]: item });
  if (item.slot === 'back' || item.design === 'halo') {
    const object = player.group.getObjectByName(item.design === 'halo' ? 'cosmetic-halo' : item.design ? `cosmetic-bag-${item.design}` : `cosmetic-${item.id}`);
    object.removeFromParent();
    result.add(object);
  } else {
    // Accessories share merged geometry with the head or hand. Copy only their boxes.
    const source = item.slot === 'hand' ? player.rArm.children[0].geometry : player.head.children[0].geometry;
    const defaultHatBoxes = ['cap', 'hat'].includes(item.id) ? 0 : role === 'alumni' ? 3 : role === 'awam' ? 2 : 0;
    const start = (item.slot === 'hand' ? 2 : 5 + defaultHatBoxes) * 36;
    const geometry = new THREE.BufferGeometry();
    for (const name of ['position', 'normal', 'color']) {
      const attribute = source.attributes[name];
      geometry.setAttribute(name, new THREE.Float32BufferAttribute(attribute.array.slice(start * attribute.itemSize), attribute.itemSize));
    }
    geometry.computeBoundingSphere();
    result.add(mesh(geometry));
  }
  player.group.traverse((obj) => {
    if (!obj.isMesh) return;
    obj.geometry.dispose();
    if (obj.material !== voxelMat) obj.material.dispose();
  });
  return result;
}

// ---------- obstacles ----------

const geoCache = new Map();
const cached = (key, make) => {
  if (!geoCache.has(key)) geoCache.set(key, make());
  return geoCache.get(key);
};

const OBSTACLE_GEO = {
  cone: () =>
    voxels([
      [1.15, 0.16, 1.15, 0, 0.08, 0, 0x1e293b],
      [0.84, 0.45, 0.84, 0, 0.38, 0, 0xf97316],
      [0.62, 0.38, 0.62, 0, 0.8, 0, 0xf1f5f9],
      [0.38, 0.42, 0.38, 0, 1.2, 0, 0xf97316],
    ]),
  pothole: () =>
    voxels([
      [2.3, 0.04, 2.1, 0, 0.02, 0, 0x18181b],
      [1.8, 0.05, 1.6, 0, 0.03, 0, 0x0284c7],
      [0.32, 0.18, 0.32, -1.05, 0.09, -0.85, 0x27272a],
      [0.32, 0.18, 0.32, 1.05, 0.09, -0.75, 0x27272a],
      [0.32, 0.18, 0.32, -0.95, 0.09, 0.85, 0x27272a],
      [0.36, 0.65, 0.36, 1.0, 0.32, 0.7, 0xf97316],
      [0.38, 0.16, 0.38, 1.0, 0.42, 0.7, 0xf1f5f9],
    ]),
  monkey: () =>
    voxels([
      [0.68, 0.82, 0.52, 0, 0.66, 0, 0x6b4423],
      [0.46, 0.58, 0.08, 0, 0.64, 0.27, 0xe6b89c],
      [0.56, 0.54, 0.54, 0, 1.25, 0.06, 0x6b4423],
      [0.2, 0.18, 0.26, 0, 1.58, 0.04, 0x3e2723],
      [0.42, 0.36, 0.08, 0, 1.22, 0.34, 0xe6b89c],
      [0.28, 0.18, 0.14, 0, 1.12, 0.39, 0xe6b89c],
      [0.08, 0.08, 0.04, -0.12, 1.28, 0.4, 0x090d16],
      [0.08, 0.08, 0.04, 0.12, 1.28, 0.4, 0x090d16],
      [0.16, 0.2, 0.1, -0.36, 1.26, 0.06, 0xe6b89c],
      [0.16, 0.2, 0.1, 0.36, 1.26, 0.06, 0xe6b89c],
      [0.18, 0.56, 0.18, -0.46, 0.72, 0.12, 0x6b4423],
      [0.18, 0.56, 0.18, 0.46, 0.72, 0.12, 0x6b4423],
      [0.2, 0.38, 0.2, -0.2, 0.24, 0, 0x6b4423],
      [0.2, 0.38, 0.2, 0.2, 0.24, 0, 0x6b4423],
      [0.2, 0.12, 0.3, -0.2, 0.06, 0.08, 0xe6b89c],
      [0.2, 0.12, 0.3, 0.2, 0.06, 0.08, 0xe6b89c],
      [0.12, 0.48, 0.12, 0, 0.6, -0.4, 0x3e2723],
      [0.12, 0.48, 0.12, 0, 1.0, -0.52, 0x3e2723],
      [0.12, 0.14, 0.28, 0, 1.26, -0.44, 0x3e2723],
    ]),
  barrier: () =>
    voxels([
      [0.22, 3.2, 0.22, -1.35, 1.6, 0, 0xcbd5e1],
      [0.22, 3.2, 0.22, 1.35, 1.6, 0, 0xcbd5e1],
      [0.5, 0.12, 0.5, -1.35, 0.06, 0, 0x475569],
      [0.5, 0.12, 0.5, 1.35, 0.06, 0, 0x475569],
    ]),
  car: (paint) =>
    voxels([
      [2.05, 0.72, 4.35, 0, 0.68, 0, paint],
      [1.78, 0.62, 2.25, 0, 1.32, -0.15, paint],
      [1.66, 0.52, 0.1, 0, 1.3, 0.98, 0x0f172a],
      [1.82, 0.46, 1.9, 0, 1.32, -0.15, 0x0f172a],
      [0.95, 0.28, 0.08, 0, 0.62, 2.18, 0xcbd5e1],
      [0.36, 0.18, 0.08, -0.72, 0.72, 2.18, 0xfef9c3],
      [0.36, 0.18, 0.08, 0.72, 0.72, 2.18, 0xfef9c3],
      [0.65, 0.18, 0.04, 0, 0.42, 2.2, 0xf8fafc],
      [0.22, 0.14, 0.16, -1.02, 1.08, 0.75, paint],
      [0.22, 0.14, 0.16, 1.02, 1.08, 0.75, paint],
      ...[[-0.98, 1.35], [0.98, 1.35], [-0.98, -1.35], [0.98, -1.35]].map(([x, z]) => [0.28, 0.72, 0.72, x, 0.36, z, 0x111827]),
      ...[[-1.0, 1.35], [1.0, 1.35], [-1.0, -1.35], [1.0, -1.35]].map(([x, z]) => [0.3, 0.36, 0.36, x, 0.36, z, 0xcbd5e1]),
    ]),
  bus: () =>
    voxels([
      [2.55, 2.95, 7.2, 0, 1.85, 0, 0x581c87],
      [2.6, 0.45, 7.24, 0, 1.45, 0, 0xfacc15],
      [2.3, 1.15, 0.12, 0, 2.35, 3.61, 0x0f172a],
      [2.6, 0.9, 5.4, 0, 2.5, -0.6, 0x1e1b4b], // side windows
      [0.42, 0.24, 0.1, -0.85, 0.85, 3.62, 0xfef08a],
      [0.42, 0.24, 0.1, 0.85, 0.85, 3.62, 0xfef08a],
      ...[[-1.25, 2.3], [1.25, 2.3], [-1.25, -2.3], [1.25, -2.3]].map(([x, z]) => [0.38, 0.96, 0.96, x, 0.48, z, 0x090d16]),
    ]),
};

const CAR_PAINTS = [0xdc2626, 0x2563eb, 0xe2e8f0, 0x0f172a, 0xd97706];

/** A new obstacle object (for the pool). `variant` picks a car's paint. */
export function buildObstacle(type, variant = 0) {
  const group = new THREE.Group();
  if (type === 'car') {
    const paint = CAR_PAINTS[variant % CAR_PAINTS.length];
    group.add(mesh(cached(`car:${paint}`, () => OBSTACLE_GEO.car(paint))));
  } else if (type === 'monkey') {
    const pivot = mesh(cached('monkey', OBSTACLE_GEO.monkey));
    group.add(pivot);
    group.userData.bob = pivot;
  } else {
    group.add(mesh(cached(type, OBSTACLE_GEO[type])));
  }
  if (type === 'barrier') {
    const bar = new THREE.Mesh(
      cached('barrierBar', () => new THREE.BoxGeometry(2.9, 0.72, 0.24)),
      bannerMat('ZON LALUAN BAS', '#facc15', '#3b0764', 512, 128),
    );
    bar.position.set(0, 2.35, 0);
    bar.castShadow = true;
    group.add(bar);
  } else if (type === 'bus') {
    const sign = new THREE.Mesh(
      cached('busSign', () => new THREE.PlaneGeometry(1.9, 0.42)),
      bannerMat('BAS KAMPUS', '#090d16', '#facc15', 512, 112),
    );
    sign.position.set(0, 3.08, 3.63);
    group.add(sign);
  }
  return group;
}

// ---------- items ----------

const ITEM_GEO = {
  'pelajar:points': [[0.74, 0.94, 0.22, 0, 0, 0, 0x2563eb], [0.68, 0.88, 0.26, 0.04, 0, 0, 0xf8fafc], [0.42, 0.2, 0.28, 0, 0.16, 0, 0xfacc15]],
  'staf:points': [[0.8, 0.96, 0.18, 0, 0, 0, 0xd97706], [0.74, 0.9, 0.22, 0.03, 0.02, 0, 0xfef3c7], [0.3, 0.12, 0.24, -0.15, 0.5, 0, 0xd97706]],
  'alumni:points': [[0.3, 1.0, 0.3, 0, 0, 0, 0xfef3c7], [0.34, 0.16, 0.34, 0, 0, 0, 0xdc2626], [0.36, 0.08, 0.36, 0, 0.46, 0, 0xe7d8b0], [0.36, 0.08, 0.36, 0, -0.46, 0, 0xe7d8b0]],
  'awam:points': [[0.7, 0.92, 0.08, 0, 0, 0, 0xf8fafc], [0.7, 0.22, 0.1, 0, 0.32, 0, 0x16a34a], [0.5, 0.06, 0.1, 0, 0.05, 0, 0x94a3b8], [0.5, 0.06, 0.1, 0, -0.1, 0, 0x94a3b8]],
  'pelajar:boost': [[0.56, 0.85, 0.56, 0, 0, 0, 0xf8fafc], [0.6, 0.36, 0.6, 0, 0, 0, 0x581c87], [0.64, 0.14, 0.64, 0, 0.48, 0, 0x0f172a]],
  'staf:boost': [[0.56, 0.85, 0.56, 0, 0, 0, 0xb45309], [0.58, 0.2, 0.58, 0, 0.5, 0, 0xfef3c7], [0.6, 0.1, 0.6, 0, -0.44, 0, 0xe2e8f0]],
  'alumni:boost': [[0.56, 0.85, 0.56, 0, 0, 0, 0xf8fafc], [0.6, 0.36, 0.6, 0, 0, 0, 0x111827], [0.64, 0.14, 0.64, 0, 0.48, 0, 0x7e22ce]],
  'awam:boost': [[0.8, 0.8, 0.8, 0, 0, 0, 0x65a30d], [0.6, 0.12, 0.6, 0, 0.44, 0, 0xfef9c3], [0.08, 0.5, 0.08, 0.12, 0.66, 0, 0xec4899]],
  time: [[0.86, 0.86, 0.2, 0, 0, 0, 0xfacc15], [0.68, 0.68, 0.24, 0, 0, 0, 0xf8fafc], [0.06, 0.28, 0.28, 0, 0.12, 0, 0x0f172a], [0.22, 0.06, 0.28, 0.1, 0, 0, 0x0f172a], [0.2, 0.14, 0.2, 0, 0.5, 0, 0xfacc15]],
};

/** A new item object for a role and kind (points, boost, shield, time). */
export function buildItem(role, kind) {
  const group = new THREE.Group();
  if (kind === 'shield') {
    const card = new THREE.Mesh(cached('cardGeo', () => new THREE.BoxGeometry(0.76, 1.12, 0.08)), [
      ...Array(4).fill(voxelMatGold()),
      idCardMat(role),
      idCardMat(role),
    ]);
    card.castShadow = true;
    group.add(card);
    group.add(mesh(cached('clip', () => voxels([[0.24, 0.14, 0.12, 0, 0.62, 0, 0xcbd5e1], [0.36, 0.24, 0.08, 0, 0.76, 0, 0x581c87]]))));
  } else {
    const key = kind === 'time' ? 'time' : `${role}:${kind}`;
    group.add(mesh(cached(`item:${key}`, () => voxels(ITEM_GEO[key]))));
  }
  if (kind !== 'points') {
    // Power-ups glow: a spinning frame.
    const halo = new THREE.Mesh(
      cached('halo', () => new THREE.BoxGeometry(1.35, 1.35, 1.35)),
      haloMat(kind),
    );
    halo.userData.spin = true;
    group.add(halo);
  }
  return group;
}

let goldMat = null;
function voxelMatGold() {
  goldMat ??= new THREE.MeshLambertMaterial({ color: 0xfacc15 });
  return goldMat;
}

const HALO = { boost: 0xf97316, shield: 0x22d3ee, time: 0xfacc15 };
const haloMats = {};
function haloMat(kind) {
  haloMats[kind] ??= new THREE.MeshBasicMaterial({ color: HALO[kind], wireframe: true, transparent: true, opacity: 0.8 });
  return haloMats[kind];
}

// ---------- scenery ----------

const TREE = (x, z, s = 1) => [
  [0.65 * s, 3.0 * s, 0.65 * s, x, 1.5 * s, z, 0x5c3a21],
  [3.2 * s, 1.4 * s, 3.2 * s, x, 3.4 * s, z, 0x2d7a2e],
  [2.0 * s, 1.2 * s, 2.0 * s, x, 4.6 * s, z, 0x3b9438],
];
const LAMP = (x, z, dir) => [
  [0.22, 5.4, 0.22, x, 2.88, z, 0xcbd5e1],
  [1.4, 0.18, 0.18, x + dir * 0.65, 5.53, z, 0xcbd5e1],
  [0.5, 0.22, 0.35, x + dir * 1.2, 5.38, z, 0xfef9c3],
];

const BENCH = (x, z, colour = 0x92400e) => [
  [1.3, 0.25, 3.8, x, 0.85, z, colour],
  [0.25, 1.3, 3.8, x + Math.sign(x) * 0.55, 1.4, z, colour],
  ...[-1.3, 1.3].map((dz) => [1, 0.8, 0.2, x, 0.4, z + dz, 0x475569]),
];
const PLANTER = (x, z, flower = 0xf472b6) => [
  [2, 0.7, 3, x, 0.35, z, 0xe2d5bc],
  [1.7, 0.6, 2.7, x, 0.95, z, 0x3f7d38],
  ...[-0.8, 0.8].map((dz) => [0.5, 0.4, 0.5, x, 1.4, z + dz, flower]),
];

/** Roadside props stay outside the playable lanes and merge into one draw call per stretch. */
export function sceneryGeometry(rand, area = 'civic') {
  const boxes = [];
  for (const z of [-10, 10]) {
    boxes.push(...TREE(-10.5 - rand() * 2.5, z + rand() * 4 - 2, 0.85 + rand() * 0.3));
    boxes.push(...TREE(10.5 + rand() * 2.5, z + rand() * 4 - 2, 0.85 + rand() * 0.3));
    boxes.push(...TREE(-17 - rand() * 6, z + rand() * 8, 1 + rand() * 0.4));
    boxes.push(...TREE(17 + rand() * 6, z + rand() * 8, 1 + rand() * 0.4));
  }
  boxes.push(...LAMP(-6.3, 0, 1), ...LAMP(6.3, 0, -1));
  for (const side of [-1, 1]) {
    const x = side * 10.4;
    if (area === 'library') {
      boxes.push(...BENCH(x, -3), ...PLANTER(x, 14, 0xfde68a));
      // Covered reading walk and a book-return cabinet.
      boxes.push([3.2, 0.35, 14, x, 4, -8, 0x334155]);
      for (const z of [-14, -2]) boxes.push([0.25, 4, 0.25, x + side, 2, z, 0xe2e8f0]);
      boxes.push([1.2, 2.1, 1.8, x, 1.05, 5, 0x1e3a8a], [0.1, 0.2, 1.2, x - side * 0.65, 1.4, 5, 0xfacc15]);
    } else if (area === 'mosque') {
      // Cream colonnades, trimmed hedges and a shallow reflecting pool.
      boxes.push([3, 0.35, 27, x, 4.8, 0, 0xfef3c7]);
      for (const z of [-12, -4, 4, 12]) boxes.push([0.45, 4.6, 0.45, x + side, 2.3, z, 0xf8fafc]);
      boxes.push([1.2, 1, 25, side * 14, 0.5, 0, 0x347853], [3, 0.15, 9, side * 18, 0.1, 0, 0x67c8cd]);
    } else if (area === 'college') {
      boxes.push(...BENCH(x, -12), ...PLANTER(x, 12));
      // Bicycle racks and a residential courtyard pergola.
      for (const z of [-4, -1, 2, 5]) {
        boxes.push([1.3, 0.15, 0.15, x, 1.3, z, 0x475569], [0.15, 1.3, 0.15, x - 0.6, 0.65, z, 0x475569], [0.15, 1.3, 0.15, x + 0.6, 0.65, z, 0x475569]);
      }
      for (const z of [-14, 14]) boxes.push([0.25, 3.4, 0.25, side * 16, 1.7, z, 0x92400e]);
      for (let z = -14; z <= 14; z += 4) boxes.push([4, 0.2, 0.5, side * 16, 3.5, z, 0xb97d50]);
    } else if (area === 'engineering') {
      // Yellow safety rails, steel frames and stacked materials.
      for (const z of [-12, 0, 12]) {
        boxes.push([0.35, 5, 0.35, x, 2.5, z, 0x64748b], [4.5, 0.35, 0.35, x + side * 2, 5, z, 0x64748b]);
        boxes.push([0.25, 1.5, 0.25, x - side, 0.75, z, 0xfacc15]);
      }
      boxes.push([0.2, 0.2, 26, x - side, 1.4, 0, 0xfacc15]);
      for (const y of [0.4, 1, 1.6]) boxes.push([3, 0.4, 7, side * 16, y, 7, 0x94a3b8]);
      boxes.push([3.5, 2, 4, side * 16, 1, -9, 0xd97706]);
    } else if (area === 'sports') {
      // Track, courts, courtside fencing and basketball backboards.
      boxes.push([8, 0.08, 34, side * 17, 0.02, 0, 0xb65f43], [5, 0.1, 26, side * 17, 0.08, 0, 0x3b82a0]);
      for (const z of [-16, 0, 16]) boxes.push([0.15, 2.8, 0.15, x, 1.4, z, 0x64748b]);
      for (const y of [0.7, 1.4, 2.1]) boxes.push([0.1, 0.07, 34, x, y, 0, 0x94a3b8]);
      boxes.push([0.25, 4, 0.25, side * 15, 2, 12, 0x475569], [0.2, 1.4, 2.2, side * 15, 4.1, 12, 0xf8fafc], [1, 0.12, 0.8, side * 14.5, 3.6, 12, 0xf97316]);
      boxes.push(...BENCH(x + side * 2, -10, 0x7c3aed));
    } else if (area === 'health') {
      boxes.push(...PLANTER(x, -12, 0xffffff), ...PLANTER(x, 12, 0xffffff), ...BENCH(x, 4, 0x0d9488));
      boxes.push([3, 0.3, 8, x, 3.2, 2, 0x5eb4af]);
      for (const z of [-1, 5]) boxes.push([0.2, 3.2, 0.2, x + side, 1.6, z, 0xf8fafc]);
    } else if (area === 'faculty') {
      boxes.push(...BENCH(x, 10), ...PLANTER(x, -12, 0xa78bfa));
      // Faculty noticeboards and outdoor study tables.
      boxes.push([0.3, 2, 4, x, 2.5, 0, 0x581c87], [0.32, 1.5, 3.4, x, 2.5, 0, 0xfef3c7], [0.2, 2, 0.2, x, 1, 0, 0x475569]);
      boxes.push([3, 0.25, 4, side * 16, 1.5, 5, 0xe2e8f0], [0.6, 1.5, 0.6, side * 16, 0.75, 5, 0x64748b]);
    } else if (area === 'plaza') {
      boxes.push([10, 0.1, 32, side * 15, 0, 0, 0xe7daca], ...BENCH(x, -12), ...PLANTER(x, 12, 0xfacc15));
      // Low fountain basins: blue water, pale stone rims and a central jet.
      boxes.push([4, 0.6, 6, side * 15, 0.3, 0, 0xcbd5e1], [3.4, 0.08, 5.4, side * 15, 0.65, 0, 0x38bdf8], [0.35, 2.6, 0.35, side * 15, 1.8, 0, 0xbae6fd]);
    } else {
      boxes.push(...PLANTER(x, -10, 0xfacc15), ...BENCH(x, 10));
      boxes.push([0.2, 6, 0.2, side * 14, 3, 0, 0xcbd5e1], [0.12, 2, 3, side * 14, 4.7, 1.5, 0x581c87], [0.14, 0.4, 3, side * 14, 5.5, 1.5, 0xfacc15]);
    }
  }
  return voxels(boxes);
}

/** The far skyline: hills and Menara SAAS in the distance. Never moves. */
export function skylineGeometry() {
  const boxes = [
    [20, 62, 16, -48, 31, -155, 0x1e3a8a],
    [16, 4, 14, -48, 64, -155, 0xfacc15],
    [10, 4, 9, -48, 68, -155, 0xfacc15],
  ];
  for (let i = -3; i <= 3; i++) boxes.push([58, 28 + Math.abs(i) * 6, 36, i * 52, 12, -190 - Math.abs(i) * 8, 0x255e26]);
  return voxels(boxes);
}

// ---------- landmarks ----------

const W = 0xf1f5f9;
const CREAM = 0xfef3c7;
const PURPLE = 0x581c87;
const GOLD = 0xfacc15;
const GLASS = 0x1e3a8a;

/** Each landmark beside the road: its boxes, its sign and which side (−1 left, 1 right). */
const LANDMARK_BUILD = {
  canselori: () => ({
    side: 1,
    boxes: [
      [19, 10, 22, 23, 5, 0, W],
      [20, 1.4, 23, 23, 10.7, 0, PURPLE],
      [8, 4, 12, 23, 13.4, 0, GLASS],
      ...[-8, -4, 0, 4, 8].map((z) => [0.8, 8, 0.8, 13, 4, z, CREAM]),
      [3, 0.8, 24, 12, 0.4, 0, 0x94a3b8],
    ],
    sign: { text: 'BANGUNAN CANSELORI', w: 14, h: 1.8, pos: [12.5, 9, 0], rotY: -Math.PI / 2 },
  }),
  seroja: () => ({
    side: 1,
    boxes: [
      ...[-7, 7].flatMap((z) => [
        [14, 16, 10, 21, 8, z, 0xfce7f3],
        [15, 1.4, 11, 21, 16.7, z, 0x9d174d],
        ...[3, 7, 11].map((y) => [0.3, 1.8, 8, 13.9, y, z, GLASS]),
      ]),
      [8, 5, 5, 21, 2.5, 0, CREAM],
    ],
    sign: { text: 'KOLEJ SEROJA', w: 13, h: 1.7, pos: [13.7, 14, 0], rotY: -Math.PI / 2 },
  }),
  sukan: () => ({
    side: -1,
    boxes: [
      [20, 8, 25, -24, 4, 0, CREAM],
      [22, 1.5, 27, -24, 8.75, 0, 0x2563eb],
      [16, 1.5, 23, -24, 10.25, 0, 0x2563eb],
      ...[-8, -4, 0, 4, 8].map((z) => [0.3, 4.5, 2.8, -13.9, 4, z, GLASS]),
      [9, 0.2, 22, -18, 0.1, 27, 0x3b82f6],
      [0.15, 0.05, 20, -18, 0.23, 27, W],
    ],
    sign: { text: 'PUSAT SUKAN UiTM', w: 14, h: 1.8, pos: [-13.7, 7, 0], rotY: Math.PI / 2 },
  }),
  kesihatan: () => ({
    side: 1,
    boxes: [
      [18, 8, 22, 23, 4, 0, W],
      [19, 1.2, 23, 23, 8.6, 0, 0x0d9488],
      [5, 3, 8, 16, 9, 0, W],
      [0.3, 2.2, 0.7, 13.3, 9, 0, 0xdc2626],
      [0.3, 0.7, 2.2, 13.3, 9, 0, 0xdc2626],
      ...[-7, -3.5, 3.5, 7].map((z) => [0.3, 3, 2.2, 13.9, 4, z, GLASS]),
      [2.5, 3.5, 3, 13, 1.75, 0, GLASS],
    ],
    sign: { text: 'PUSAT KESIHATAN UiTM', w: 14, h: 1.7, pos: [13.6, 6.7, 0], rotY: -Math.PI / 2 },
  }),
  cendekia: () => ({
    side: -1,
    boxes: [
      [22, 0.4, 28, -25, 0.2, 0, 0xd6d3d1],
      [10, 0.6, 10, -25, 0.7, 0, PURPLE],
      [6, 0.8, 6, -25, 1.4, 0, W],
      [2, 7, 2, -25, 5.3, 0, GOLD],
      [7, 1, 7, -25, 9.3, 0, GOLD],
      ...[-10, 10].flatMap((z) => [
        [0.3, 11, 0.3, -16, 5.5, z, 0x94a3b8],
        [0.15, 2.5, 4, -16, 9, z + 2, PURPLE],
        [2, 0.6, 5, -32, 0.7, z, CREAM],
      ]),
    ],
    sign: { text: 'DATARAN CENDEKIA', w: 14, h: 1.8, pos: [-13.8, 3, 0], rotY: Math.PI / 2 },
  }),
  stadium: () => ({
    side: 1,
    boxes: [
      [25, 0.3, 42, 28, 0.15, 0, 0xb45309],
      [17, 0.1, 32, 28, 0.35, 0, 0x16a34a],
      ...[0, 1, 2, 3].map((tier) => [3, 2, 38, 15 + tier * 2, 1 + tier * 2, 0, tier % 2 ? GOLD : PURPLE]),
      [12, 1, 42, 18, 10, 0, 0x94a3b8],
      ...[-18, 18].flatMap((z) => [
        [0.5, 20, 0.5, 37, 10, z, 0x94a3b8],
        [2, 3, 4, 37, 20, z, W],
      ]),
    ],
    sign: { text: 'STADIUM UiTM', w: 15, h: 1.8, pos: [13.3, 8.5, 0], rotY: -Math.PI / 2 },
  }),
  mawar: () => ({
    side: -1,
    boxes: [
      ...[-9, 9].flatMap((z) => [
        [15, 19, 12, -22, 9.5, z, 0xffedd5],
        [16, 1.4, 13, -22, 19.7, z, 0xbe123c],
        ...[3, 7, 11, 15].map((y) => [0.3, 1.8, 10, -14.4, y, z, GLASS]),
      ]),
      [12, 3, 6, -22, 8, 0, CREAM],
    ],
    sign: { text: 'KOLEJ MAWAR', w: 13, h: 1.7, pos: [-14.2, 17.5, 0], rotY: Math.PI / 2 },
  }),
  gate: () => ({
    side: 0,
    boxes: [
      [1.7, 8.8, 1.9, -7.2, 4.4, 0, W],
      [1.7, 8.8, 1.9, 7.2, 4.4, 0, W],
      [2.1, 1.1, 2.3, -7.2, 9.2, 0, GOLD],
      [2.1, 1.1, 2.3, 7.2, 9.2, 0, GOLD],
      [16.2, 2.0, 1.8, 0, 8.3, 0, PURPLE],
    ],
    sign: { text: 'PINTU UTAMA UiTM', w: 13.8, h: 1.65, pos: [0, 8.3, 0.92], rotY: 0 },
  }),
  kolej: () => ({
    side: -1,
    boxes: [
      [15, 13, 20, -20, 6.5, 0, CREAM],
      [16, 1.6, 21, -20, 13.6, 0, PURPLE],
      ...[2, 5.5, 9].flatMap((y) => [[0.3, 1.6, 16, -12.4, y + 1.5, 0, GLASS]]),
    ],
    sign: { text: 'KOLEJ PERINDU', w: 13, h: 1.7, pos: [-12.3, 11.2, 0], rotY: Math.PI / 2 },
  }),
  saas: () => ({
    side: -1,
    boxes: [
      [18, 7, 18, -22, 3.5, 0, W],
      [11, 34, 11, -22, 24, 0, GLASS],
      ...[4, 8, 12, 16, 20, 24, 28, 32, 36, 40].map((y) => [11.2, 0.4, 11.2, -22, y, 0, 0x93c5fd]),
      [12, 2.5, 12, -22, 42.2, 0, GOLD],
      [8, 2.5, 8, -22, 44.7, 0, GOLD],
      [4, 2.5, 4, -22, 47.2, 0, GOLD],
    ],
    sign: { text: 'MENARA SAAS', w: 11, h: 1.8, pos: [-12.9, 5.5, 0], rotY: Math.PI / 2 },
  }),
  masjid: () => ({
    side: 1,
    boxes: [
      [18, 8.5, 18, 22, 4.25, 0, W],
      [12, 2.5, 12, 22, 9.75, 0, GOLD],
      [8, 2.5, 8, 22, 12.25, 0, GOLD],
      [4, 2.2, 4, 22, 14.5, 0, GOLD],
      [2.0, 24, 2.0, 14, 12, 7, W],
      [2.4, 2.5, 2.4, 14, 25.2, 7, GOLD],
      ...[-5, 0, 5].map((z) => [0.3, 4, 2.4, 12.9, 3.5, z, 0x7c3aed]),
    ],
    sign: { text: 'MASJID TUANKU MIZAN', w: 11, h: 1.7, pos: [12.8, 6.6, -1.5], rotY: -Math.PI / 2 },
  }),
  ptar: () => ({
    side: -1,
    boxes: [
      [17, 13, 22, -22, 6.5, 0, W],
      [17.3, 7.5, 18, -22, 6.8, 0, GLASS],
      ...[-6, -2, 2, 6].map((z) => [17.4, 7.5, 0.4, -22, 6.8, z, W]),
    ],
    sign: { text: 'PERPUSTAKAAN TUN ABDUL RAZAK', w: 14, h: 1.9, pos: [-13.3, 11.4, 0], rotY: Math.PI / 2, bg: '#facc15', fg: '#3b0764' },
  }),
  datc: () => ({
    side: 1,
    boxes: [
      [18, 9.5, 22, 22, 4.75, 0, CREAM],
      [19, 2.2, 20, 22, 10.6, 0, PURPLE],
      [19, 2.2, 13, 22, 12.8, 0, PURPLE],
      [19, 1.4, 6, 22, 14.6, 0, GOLD],
      ...[-8, -4, 0, 4, 8].map((z) => [0.6, 8, 0.6, 12.6, 4, z, W]),
    ],
    sign: { text: 'DEWAN AGUNG TUANKU CANSELOR', w: 14, h: 1.8, pos: [12.6, 8.7, 0], rotY: -Math.PI / 2 },
  }),
  fakulti: () => ({
    side: 1,
    boxes: [
      [15, 13, 20, 20, 6.5, 0, CREAM],
      [16, 1.6, 21, 20, 13.6, 0, PURPLE],
      ...[2.5, 6, 9.5].map((y) => [0.3, 1.8, 17, 12.4, y + 1.5, 0, GLASS]),
    ],
    sign: { text: 'FAKULTI SAINS KOMPUTER & MATEMATIK', w: 13, h: 1.7, pos: [12.3, 11.4, 0], rotY: -Math.PI / 2 },
  }),
  engineering: () => ({
    side: -1,
    boxes: [
      [16, 15, 22, -21, 7.5, 0, 0xe2e8f0],
      [17, 1.6, 23, -21, 15.6, 0, PURPLE],
      [4, 6, 4, -17, 19, 6, 0x94a3b8],
      ...[3, 7, 11].map((y) => [0.3, 2, 18, -12.9, y, 0, GLASS]),
    ],
    sign: { text: 'KOMPLEKS KEJURUTERAAN', w: 13, h: 1.7, pos: [-12.8, 13.4, 0], rotY: Math.PI / 2 },
  }),
};

/** A new landmark object of a type (see config LANDMARKS). */
export function buildLandmark(type) {
  const spec = LANDMARK_BUILD[type]();
  const group = new THREE.Group();
  group.add(mesh(cached(`landmark:${type}`, () => voxels(spec.boxes)), voxelMat, false));
  const s = spec.sign;
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(s.w, s.h), bannerMat(s.text, s.bg, s.fg));
  sign.position.set(...s.pos);
  sign.rotation.y = s.rotY;
  group.add(sign);
  return group;
}

/** The checkpoint arch across the road; its banner is set per landmark with setArchLabel. */
export function buildArch() {
  const group = new THREE.Group();
  group.add(
    mesh(
      cached('arch', () =>
        voxels([
          [0.9, 7.2, 0.9, -6.6, 3.6, 0, PURPLE],
          [0.9, 7.2, 0.9, 6.6, 3.6, 0, PURPLE],
          [1.2, 0.6, 1.2, -6.6, 7.5, 0, GOLD],
          [1.2, 0.6, 1.2, 6.6, 7.5, 0, GOLD],
          [14.4, 1.0, 0.7, 0, 7.0, 0, GOLD],
        ]),
      ),
      voxelMat,
      false,
    ),
  );
  const banner = new THREE.Mesh(new THREE.PlaneGeometry(12, 1.6), bannerMat(LANDMARKS[1].short.toUpperCase()));
  banner.position.set(0, 7.0, 0.36);
  group.add(banner);
  group.userData.banner = banner;
  return group;
}

export function setArchLabel(arch, text) {
  arch.userData.banner.material = bannerMat(text);
}

/** Every banner and card texture, so they can be drawn once fonts have loaded. */
export function warmTextures(roles) {
  for (const l of LANDMARKS) {
    bannerMat(l.short.toUpperCase());
  }
  for (const r of roles) idCardMat(r);
}
