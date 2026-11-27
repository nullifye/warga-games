// The wardrobe renders the runner model and the same trail emitter used in-game.
import * as THREE from '../../shared/vendor/three.module.min.js';
import { createTrailEffect, buildTrailMark, styleTrailMark } from './trails.js';
import { buildPlayer, buildCosmeticItem, voxelMat } from './models.js';

export function createPreview(canvas, { thumbnail = false, width: outputWidth = 192, height: outputHeight = 160 } = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  renderer.setPixelRatio(thumbnail ? 1 : Math.min(devicePixelRatio || 1, 2));
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x64748b, 2.5));
  const light = new THREE.DirectionalLight(0xffffff, 2);
  light.position.set(-3, 5, -4);
  scene.add(light);
  const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 60);
  const platform = new THREE.Mesh(
    new THREE.CylinderGeometry(1.35, 1.45, 0.12, 32),
    new THREE.MeshLambertMaterial({ color: 0xddd6fe }),
  );
  platform.position.y = -0.08;
  const turntable = new THREE.Group();
  turntable.add(platform);
  scene.add(turntable);
  const trailGroup = new THREE.Group();
  turntable.add(trailGroup);
  const trailEffect = createTrailEffect(trailGroup);
  const trailRun = { x: 0, distance: 0, t: 0, status: 'running', airborne: false };
  let trailCosmetic = null;
  let active = false;
  let lastTime = 0;
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  let player;
  let key;
  let renderedWidth = 0;
  let renderedHeight = 0;

  function advanceTrail(dt, reduced = false) {
    trailRun.t += dt;
    trailRun.distance += 12 * dt;
    trailEffect.draw(trailRun, trailCosmetic, true, reduced);
  }
  function render(now = performance.now()) {
    const width = thumbnail ? outputWidth : canvas.clientWidth;
    const height = thumbnail ? outputHeight : canvas.clientHeight;
    if (!width || !height) return;
    if (width !== renderedWidth || height !== renderedHeight) {
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderedWidth = width;
      renderedHeight = height;
    }
    if (active && lastTime && !motion.matches) advanceTrail(Math.min(0.1, Math.max(0, (now - lastTime) / 1000)));
    else trailEffect.draw(trailRun, trailCosmetic, false, !thumbnail && motion.matches);
    lastTime = active ? now : 0;
    renderer.render(scene, camera);
  }
  function update(role, cosmetics) {
    const nextKey = JSON.stringify([role, cosmetics]);
    if (nextKey !== key) {
      if (player) {
        turntable.remove(player.group);
        player.group.traverse((obj) => {
          if (!obj.isMesh) return;
          obj.geometry.dispose();
          if (obj.material !== voxelMat) obj.material.dispose();
        });
      }
      player = buildPlayer(role, cosmetics);
      turntable.add(player.group);
      trailCosmetic = cosmetics.trail ?? null;
      trailEffect.reset();
      trailRun.distance = trailRun.t = 0;
      // Warm the emitter at 60 Hz so it immediately shows the same full trail as a run.
      for (let i = 0; i < 90; i++) advanceTrail(1 / 60);
      // Keep the pedestal and close-up avatar. View from behind when a trail is equipped,
      // so its full-size particles stream towards the camera just like the game.
      if (trailCosmetic) {
        camera.position.set(3.2, 3.1, 6.8);
        camera.lookAt(0, 1, 0.8);
      } else {
        camera.position.set(-3.4, 2.8, -5.4);
        camera.lookAt(0, 1.2, 0);
      }
      key = nextKey;
    }
    render();
  }
  const onMotionChange = () => {
    renderer.setAnimationLoop(active && !motion.matches ? render : null);
    lastTime = 0;
    if (active) render();
  };
  if (!thumbnail) motion.addEventListener('change', onMotionChange);
  return {
    update,
    rotate(direction) {
      turntable.rotation.y += direction * Math.PI / 2;
      render();
    },
    setActive(value) {
      if (active === value) return;
      active = value;
      lastTime = 0;
      renderer.setAnimationLoop(active && !motion.matches ? render : null);
      if (active) render();
    },
    portrait(role, cosmetics, angle = 0) {
      update(role, cosmetics);
      turntable.rotation.y = angle;
      // A fixed three-quarter running stance for collectible-style share cards.
      player.body.rotation.set(-0.08, 0, 0.04);
      player.lLeg.hip.rotation.x = -0.4;
      player.lLeg.knee.rotation.x = -0.25;
      player.rLeg.hip.rotation.x = 0.5;
      player.rLeg.knee.rotation.x = -0.65;
      player.lArm.rotation.x = 0.35;
      player.rArm.rotation.x = -0.8;
      player.head.rotation.y = -0.08;
      camera.position.set(-4.8, 3.1, -6.3);
      camera.lookAt(0, 1.35, 0);
      render();
      return canvas;
    },
    dispose() {
      active = false;
      renderer.setAnimationLoop(null);
      if (!thumbnail) motion.removeEventListener('change', onMotionChange);
      if (player) player.group.traverse((obj) => {
        if (!obj.isMesh) return;
        obj.geometry.dispose();
        if (obj.material !== voxelMat) obj.material.dispose();
      });
      platform.geometry.dispose();
      platform.material.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
    },
    snapshot(role, cosmetics, slot) {
      if (player) {
        player.group.removeFromParent();
        player.group.traverse((obj) => {
          if (!obj.isMesh) return;
          obj.geometry.dispose();
          if (obj.material !== voxelMat) obj.material.dispose();
        });
        player = null;
      }
      trailEffect.reset();
      platform.visible = false;
      const item = cosmetics[slot];
      const object = new THREE.Group();
      if (slot === 'trail' && item) {
        for (let i = 0; i < 4; i++) {
          const mark = buildTrailMark();
          mark.visible = true;
          mark.position.set(item.design === 'rainbow' ? 0 : (i % 2 ? 0.25 : -0.25), 0, i * 0.8);
          styleTrailMark(mark, item.design, i * 0.8, 1.5, i);
          object.add(mark);
        }
      } else object.add(buildCosmeticItem(role, item, slot));
      turntable.rotation.y = 0;
      scene.add(object);
      const bounds = new THREE.Box3().setFromObject(object);
      const center = bounds.getCenter(new THREE.Vector3());
      object.position.sub(center);
      const size = bounds.getSize(new THREE.Vector3());
      const distance = Math.max(size.x, size.y, size.z, 0.5) / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) * 1.4;
      const rear = slot === 'back';
      const direction = new THREE.Vector3(rear ? 0.3 : -0.35, 0.22, rear ? 1 : -1).normalize();
      camera.position.copy(direction.multiplyScalar(distance));
      camera.lookAt(0, 0, 0);
      render();
      const url = canvas.toDataURL('image/png');
      scene.remove(object);
      // Trail geometry/material is cached and shared with the runner.
      if (slot !== 'trail' || !item) object.traverse((obj) => {
        if (!obj.isMesh) return;
        obj.geometry.dispose();
        if (obj.material !== voxelMat) obj.material.dispose();
      });
      return url;
    },
    resize: () => render(),
  };
}
