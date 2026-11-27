// Shared decorative trail geometry for the runner and wardrobe. Four cached shapes,
// fixed-size mesh pools, no simulation inputs or per-frame geometry allocation.
import * as THREE from '../../shared/vendor/three.module.min.js';
import { voxels } from './models.js';

const material = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide });
const geometries = new Map();
const RAINBOW = [0xef4444, 0xfb923c, 0xfacc15, 0x4ade80, 0x38bdf8, 0xa78bfa];
export function trailGeometry(design) {
  if (geometries.has(design)) return geometries.get(design);
  let geometry;
  if (design === 'stars') {
    const shape = new THREE.Shape();
    for (let i = 0; i < 10; i++) {
      const angle = Math.PI / 2 + i * Math.PI / 5;
      const radius = i % 2 ? 0.13 : 0.3;
      const x = Math.cos(angle) * radius;
      const y = Math.sin(angle) * radius;
      if (i) shape.lineTo(x, y); else shape.moveTo(x, y);
    }
    shape.closePath();
    geometry = new THREE.ExtrudeGeometry(shape, { depth: 0.06, bevelEnabled: false, steps: 1 });
    const colour = new THREE.Color(0xfacc15);
    const colours = [];
    for (let i = 0; i < geometry.attributes.position.count; i++) colours.push(colour.r, colour.g, colour.b);
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colours, 3));
  } else if (design === 'fire') {
    geometry = voxels([
      [0.42, 0.22, 0.24, 0, 0.11, 0, 0xef4444],
      [0.32, 0.3, 0.2, 0, 0.3, 0, 0xf97316],
      [0.13, 0.24, 0.16, -0.13, 0.37, 0, 0xfb923c],
      [0.12, 0.25, 0.16, 0.1, 0.52, 0, 0xf97316],
      [0.1, 0.18, 0.12, 0.06, 0.71, 0, 0xfbbf24],
      [0.18, 0.28, 0.26, 0, 0.18, 0, 0xfef08a],
    ]);
  } else if (design === 'rainbow') {
    geometry = voxels(RAINBOW.map((colour, i) => [0.095, 0.035, 0.95, (i - 2.5) * 0.095, 0, 0, colour]));
  } else {
    geometry = voxels([
      [0.08, 0.62, 0.08, 0, 0, 0, 0xe0f2fe],
      [0.62, 0.08, 0.08, 0, 0, 0, 0x67e8f9],
      [0.09, 0.09, 0.28, 0, 0, 0, 0xffffff],
      ...[-1, 1].flatMap((side) => [
        [0.22, 0.06, 0.08, 0, side * 0.2, 0, 0x7dd3fc],
        [0.06, 0.22, 0.08, side * 0.2, 0, 0, 0x7dd3fc],
        [0.13, 0.13, 0.1, side * 0.13, side * 0.13, 0, 0xbae6fd],
      ]),
    ]);
  }
  geometries.set(design, geometry);
  return geometry;
}
export function buildTrailMark() {
  const mark = new THREE.Mesh(trailGeometry('frost'), material);
  mark.visible = false;
  return mark;
}

/** Age is distance behind the runner; phase is frozen while paused. */
export function styleTrailMark(mark, design, age, phase, index, scale = 1) {
  mark.geometry = trailGeometry(design);
  mark.rotation.set(0, 0, 0);
  const fade = Math.max(0.08, 1 - age / 14);
  mark.scale.setScalar(fade * scale);
  const wave = Math.sin(phase * 3 + index * 1.7);
  if (design === 'rainbow') {
    mark.position.y = 0.045;
    mark.scale.x = scale;
  } else if (design === 'fire') {
    mark.position.y = 0.04;
    mark.scale.y *= 0.85 + wave * 0.2;
  } else {
    mark.position.y = 0.3 + age * 0.035 + wave * 0.12;
    mark.rotation.z = phase * (design === 'stars' ? 1.4 : -0.7) + index;
    mark.rotation.y = wave * 0.35;
  }
}


/** One emitter shared by the live runner and preview: same size, spacing, lifetime and motion. */
export function createTrailEffect(parent) {
  const samples = [];
  const marks = Array.from({ length: 18 }, () => {
    const mark = buildTrailMark();
    parent.add(mark);
    return mark;
  });
  return {
    reset() {
      samples.length = 0;
      marks.forEach((mark) => { mark.visible = false; });
    },
    draw(run, cosmetic, moving, reducedMotion = false) {
      const enabled = !!cosmetic && !reducedMotion;
      if (enabled && moving && run.status === 'running' && !run.airborne &&
          (!samples.length || run.distance - samples.at(-1).distance >= 0.8)) {
        const side = samples.length ? -samples.at(-1).side : 1;
        samples.push({ distance: run.distance, x: run.x, side });
        if (samples.length > marks.length) samples.shift();
      }
      marks.forEach((mark, i) => {
        const sample = samples[i];
        const age = sample ? run.distance - sample.distance : Infinity;
        mark.visible = enabled && age < 14 && age >= 0;
        if (!mark.visible) return;
        mark.position.set(sample.x + (cosmetic.design === 'rainbow' ? 0 : sample.side * 0.25), 0, age);
        styleTrailMark(mark, cosmetic.design, age, run.t, i);
      });
    },
  };
}
