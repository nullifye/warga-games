// Kejar Lapan: drawing a run with Three.js. Reads the sim's state each frame; never changes it.
// Everything is built once (models.js) and pooled, so a long run doesn't grow memory.
import * as THREE from '../../shared/vendor/three.module.min.js';
import { createTrailEffect } from './trails.js';
import { campusAt } from './campus.js';
import { LANES, SHIELD } from './config.js';
import { checkpointAt, landmarkFor } from './course.js';
import { sliding } from './sim.js';
import {
  buildPlayer,
  buildObstacle,
  buildItem,
  buildLandmark,
  buildArch,
  setArchLabel,
  sceneryGeometry,
  skylineGeometry,
  roadTextures,
  skyTexture,
  voxelMat,
} from './models.js';

const SEG_LEN = 40;
const SEGMENTS = 7; // road from 40 m behind to 240 m ahead
const VIEW_AHEAD = 200; // obstacles and items are shown this far ahead…
const VIEW_BEHIND = 25; // …and kept this far behind
const CAM = { y: 4.9, z: 10.2, lookY: 1.8, lookZ: -14, fov: 60 };

/** Simple seeded random for scenery placement. */
function lcg(seed) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
}

/** A pool of objects per key: take() reuses a released one or builds a new one. */
function pool(scene, build) {
  const free = new Map();
  return {
    take(key) {
      const list = free.get(key);
      const obj = list?.pop() ?? build(key);
      obj.visible = true;
      if (!obj.parent) scene.add(obj);
      return obj;
    },
    release(key, obj) {
      obj.visible = false;
      if (!free.has(key)) free.set(key, []);
      free.get(key).push(obj);
    },
  };
}

export function createView(canvas, { reducedMotion = () => false } = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.BasicShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x93c5fd);
  scene.fog = new THREE.Fog(0xdbeafe, 70, 190);
  const fogTarget = new THREE.Color();

  const camera = new THREE.PerspectiveCamera(CAM.fov, 1, 0.1, 400);
  camera.position.set(0, CAM.y, CAM.z);
  camera.lookAt(0, CAM.lookY, CAM.lookZ);

  // Light: a sky/ground fill and a low morning sun from the front right.
  scene.add(new THREE.HemisphereLight(0xbae6fd, 0x365314, 1.6));
  scene.add(new THREE.AmbientLight(0xe0f2fe, 0.6));
  const sun = new THREE.DirectionalLight(0xfff1d6, 2.2);
  sun.position.set(18, 30, -12);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  Object.assign(sun.shadow.camera, { near: 1, far: 90, left: -20, right: 20, top: 30, bottom: -20 });
  sun.shadow.bias = -0.0008;
  sun.target.position.set(0, 0, -6);
  scene.add(sun, sun.target);

  // Sky box, sun disc and the far skyline: fixed to the camera's view, never move.
  const skyBox = new THREE.Mesh(
    new THREE.BoxGeometry(600, 300, 600),
    new THREE.MeshBasicMaterial({ map: skyTexture(), side: THREE.BackSide, fog: false }),
  );
  scene.add(skyBox);
  const sunDisc = new THREE.Mesh(new THREE.PlaneGeometry(24, 24), new THREE.MeshBasicMaterial({ color: 0xfef9c3, fog: false }));
  sunDisc.position.set(55, 62, -230);
  sunDisc.lookAt(0, 0, 0);
  scene.add(sunDisc);
  const skyline = new THREE.Mesh(skylineGeometry(), new THREE.MeshLambertMaterial({ vertexColors: true, fog: false }));
  skyline.position.z = -40;
  scene.add(skyline);

  // Road: segments that slide toward the camera and wrap round.
  const mats = roadTextures();
  const segGeo = {
    grass: new THREE.PlaneGeometry(180, SEG_LEN),
    road: new THREE.PlaneGeometry(11.6, SEG_LEN),
    walk: new THREE.BoxGeometry(3.2, 0.22, SEG_LEN),
  };
  const segments = [];
  // At most three scenery variants per area, shared by all seven recycled road segments.
  const sceneryCache = new Map();
  function areaScenery(id, variant) {
    const key = `${id}:${variant}`;
    if (!sceneryCache.has(key)) sceneryCache.set(key, sceneryGeometry(lcg(1000 + variant * 77), id));
    return sceneryCache.get(key);
  }
  for (let i = 0; i < SEGMENTS; i++) {
    const g = new THREE.Group();
    const grass = new THREE.Mesh(segGeo.grass, mats.grass.clone());
    grass.rotation.x = -Math.PI / 2;
    grass.position.y = -0.06;
    grass.receiveShadow = true;
    const road = new THREE.Mesh(segGeo.road, mats.road);
    road.rotation.x = -Math.PI / 2;
    road.receiveShadow = true;
    const walkL = new THREE.Mesh(segGeo.walk, mats.walk.clone());
    walkL.position.set(-7.4, 0.08, 0);
    walkL.receiveShadow = true;
    const walkR = walkL.clone();
    walkR.position.x = 7.4;
    const scenery = new THREE.Mesh(areaScenery('civic', i % 3), voxelMat);
    g.userData = { grass, walk: walkL, scenery, sceneryKey: null };
    g.add(grass, road, walkL, walkR, scenery);
    scene.add(g);
    segments.push(g);
  }

  // Dust in the morning light.
  const dustGeo = new THREE.BufferGeometry();
  const dustPos = new Float32Array(90 * 3);
  const r = lcg(7);
  for (let i = 0; i < 90; i++) dustPos.set([(r() - 0.5) * 32, 0.8 + r() * 10, -r() * 120], i * 3);
  dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
  const dust = new THREE.Points(dustGeo, new THREE.PointsMaterial({ color: 0xfef08a, size: 0.22, transparent: true, opacity: 0.75 }));
  scene.add(dust);

  // The player, rebuilt when the role changes.
  let player = null;
  let playerRole = null;
  let cosmetics = {};
  let ghostPlayer = null;
  let ghostRole = null;
  function syncGhost(run, ghost, now) {
    if (ghost && ghostRole !== ghost.role) {
      if (ghostPlayer) {
        scene.remove(ghostPlayer.group);
        ghostPlayer.group.traverse((obj) => {
          if (obj.isMesh) {
            obj.material.dispose();
            obj.geometry.dispose();
          }
        });
      }
      ghostPlayer = buildPlayer(ghost.role);
      ghostRole = ghost.role;
      ghostPlayer.group.traverse((obj) => {
        if (!obj.isMesh) return;
        obj.material = obj.material.clone();
        obj.material.transparent = true;
        obj.material.opacity = 0.35;
        obj.material.vertexColors = false;
        obj.material.depthWrite = false;
        obj.material.color.set(0x67e8f9);
        obj.castShadow = false;
      });
      scene.add(ghostPlayer.group);
    }
    if (!ghostPlayer) return;
    const offset = ghost ? z(run, ghost.distance) : Infinity;
    ghostPlayer.group.visible = !!ghost && offset >= -VIEW_AHEAD && offset <= VIEW_BEHIND;
    if (ghostPlayer.group.visible) {
      animatePlayer(ghost, now, ghostPlayer, offset);
      ghostPlayer.shield.visible = false;
    }
  }
  const blob = new THREE.Mesh(
    new THREE.PlaneGeometry(1.1, 1.1),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.28, depthWrite: false }),
  );
  blob.rotation.x = -Math.PI / 2;
  blob.position.y = 0.02;
  scene.add(blob);

  function setRole(role) {
    if (playerRole === role) return;
    if (player) {
      scene.remove(player.group);
      // Player geometry is unique; keep the shared voxel material alive.
      player.group.traverse((obj) => {
        if (!obj.isMesh) return;
        obj.geometry.dispose();
        if (obj.material !== voxelMat) obj.material.dispose();
      });
    }
    player = buildPlayer(role, cosmetics);
    playerRole = role;
    scene.add(player.group);
  }

  const trailEffect = createTrailEffect(scene);

  // Pools.
  const obstaclePool = pool(scene, (key) => {
    const [type, variant] = key.split(':');
    return buildObstacle(type, Number(variant));
  });
  const itemPool = pool(scene, (key) => {
    const [role, kind] = key.split(':');
    return buildItem(role, kind);
  });
  const shownObstacles = new Map(); // id → { key, obj }
  const shownItems = new Map();
  const landmarks = new Map(); // type → object
  const arches = [buildArch(), buildArch()];
  arches.forEach((a) => {
    a.visible = false;
    scene.add(a);
  });

  // Particles: a fixed pool of cubes.
  const partGeo = new THREE.BoxGeometry(0.16, 0.16, 0.16);
  const partMats = new Map();
  const partMat = (hex) => {
    if (!partMats.has(hex)) partMats.set(hex, new THREE.MeshBasicMaterial({ color: hex }));
    return partMats.get(hex);
  };
  const particles = Array.from({ length: 90 }, () => {
    const m = new THREE.Mesh(partGeo, partMat(0xffffff));
    m.visible = false;
    m.userData = { vx: 0, vy: 0, vz: 0, life: 0 };
    scene.add(m);
    return m;
  });
  let partNext = 0;
  function burst(x, y, z, hex, count = 14) {
    for (let i = 0; i < count; i++) {
      const p = particles[partNext];
      partNext = (partNext + 1) % particles.length;
      const a = Math.random() * Math.PI * 2;
      const sp = 2.5 + Math.random() * 5.5;
      p.material = partMat(hex);
      p.position.set(x, y, z);
      p.userData.vx = Math.cos(a) * sp;
      p.userData.vy = 2.5 + Math.random() * 5.5;
      p.userData.vz = Math.sin(a) * sp;
      p.userData.life = 0.45 + Math.random() * 0.25;
      p.visible = true;
    }
  }

  let shake = 0;
  let quality = 0;
  const frameTimes = [];

  function setQuality(level) {
    quality = level;
    renderer.setPixelRatio(level >= 1 ? 1 : Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.shadowMap.enabled = level < 2;
    sun.castShadow = level < 2;
    blob.visible = level >= 2;
    scene.traverse((o) => {
      if (o.material) o.material.needsUpdate = true;
    });
    resize();
  }

  function resize() {
    const w = canvas.clientWidth || 1;
    const h = canvas.clientHeight || 1;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    // Narrow phones: widen the view so all three lanes stay in sight.
    camera.fov = w / h < 0.6 ? 68 : CAM.fov;
    camera.updateProjectionMatrix();
  }

  /** Clears every pooled object, ready for a new run. */
  function reset(equipped = {}) {
    cosmetics = equipped;
    playerRole = null;
    trailEffect.reset();
    for (const [, v] of shownObstacles) obstaclePool.release(v.key, v.obj);
    for (const [, v] of shownItems) itemPool.release(v.key, v.obj);
    shownObstacles.clear();
    shownItems.clear();
    for (const p of particles) p.visible = false;
    shake = 0;
  }

  /** Effects for the sim's events this frame. */
  function onEvents(run, events) {
    for (const e of events) {
      if (e.type === 'jump') burst(run.x, 0.15, 0, 0xe2e8f0, 8);
      else if (e.type === 'land') burst(run.x, 0.12, 0, 0x9ca3af, 6);
      else if (e.type === 'pickup') {
        const colour = { points: 0xfacc15, boost: 0xf97316, shield: 0x22d3ee, time: 0xfde047 }[e.item.kind];
        burst(run.x, 1.3, 0, colour, 14);
      } else if (e.type === 'smash' || e.type === 'shieldBreak') {
        burst(run.x, 1.2, -1, e.type === 'smash' ? 0xf97316 : 0x22d3ee, 22);
      } else if (e.type === 'crash') {
        burst(run.x, 1.2, 0, 0xef4444, 26);
        if (!reducedMotion()) shake = 0.7;
      } else if (e.type === 'checkpoint' || e.type === 'arrived') {
        burst(run.x, 3, -4, 0xfacc15, 24);
      }
    }
  }

  const z = (run, at) => -(at - run.distance);

  function syncObstacles(run, now) {
    const seen = new Set();
    for (const o of run.course.obstacles) {
      if (run.finishAt != null && o.at > run.finishAt) continue;
      const wz = z(run, o.at);
      if (o.hit || wz < -VIEW_AHEAD || wz > VIEW_BEHIND) continue;
      seen.add(o.id);
      let v = shownObstacles.get(o.id);
      if (!v) {
        const key = `${o.type}:${o.type === 'car' ? o.id % 5 : 0}`;
        v = { key, obj: obstaclePool.take(key) };
        shownObstacles.set(o.id, v);
      }
      v.obj.position.set(laneX(o.lane), 0, wz);
      const bob = v.obj.userData.bob;
      if (bob) {
        bob.position.y = Math.abs(Math.sin(now * 0.008 + o.id)) * 0.42;
        bob.rotation.y = Math.sin(now * 0.004 + o.id) * 0.25;
      }
    }
    for (const [id, v] of shownObstacles) {
      if (!seen.has(id)) {
        obstaclePool.release(v.key, v.obj);
        shownObstacles.delete(id);
      }
    }
  }

  function syncItems(run, now) {
    const seen = new Set();
    for (const it of run.course.items) {
      if (run.finishAt != null && it.at > run.finishAt) continue;
      const wz = z(run, it.at);
      if (it.taken || wz < -VIEW_AHEAD || wz > VIEW_BEHIND) continue;
      seen.add(it.id);
      let v = shownItems.get(it.id);
      if (!v) {
        const key = `${run.role}:${it.kind}`;
        v = { key, obj: itemPool.take(key) };
        shownItems.set(it.id, v);
      }
      v.obj.position.set(laneX(it.lane), 1.25 + Math.sin(now * 0.005 + it.id) * 0.16, wz);
      v.obj.rotation.y = now * 0.0028 + it.id;
      for (const c of v.obj.children) if (c.userData.spin) c.rotation.set(now * 0.002, now * 0.003, 0);
    }
    for (const [id, v] of shownItems) {
      if (!seen.has(id)) {
        itemPool.release(v.key, v.obj);
        shownItems.delete(id);
      }
    }
  }

  function landmarkObj(type) {
    if (!landmarks.has(type)) {
      const obj = buildLandmark(type);
      scene.add(obj);
      landmarks.set(type, obj);
    }
    return landmarks.get(type);
  }

  function syncLandmarks(run) {
    for (const obj of landmarks.values()) obj.visible = false;
    arches.forEach((a) => (a.visible = false));
    // The gate at the start, then the last checkpoint passed and the next one.
    const gateZ = z(run, 18);
    if (gateZ < VIEW_BEHIND + 20) {
      const gate = landmarkObj('gate');
      gate.visible = true;
      gate.position.z = gateZ;
    }
    let a = 0;
    for (const k of [run.checkpoints - 1, run.checkpoints]) {
      if (k < 0) continue;
      if (run.finishAt != null && checkpointAt(k) > run.finishAt) continue;
      const wz = z(run, checkpointAt(k));
      if (wz < -VIEW_AHEAD - 20 || wz > VIEW_BEHIND + 25) continue;
      const lm = landmarkFor(k);
      const obj = landmarkObj(lm.type);
      obj.visible = true;
      obj.position.z = wz;
      const arch = arches[a++];
      const label = checkpointAt(k) === run.finishAt ? `TAMAT · ${lm.short}` : lm.short;
      if (arch.userData.label !== label) {
        setArchLabel(arch, label.toUpperCase());
        arch.userData.label = label;
      }
      arch.visible = true;
      arch.position.z = wz;
    }
  }

  function animatePlayer(run, now, p = player, offset = 0) {
    p.group.position.set(run.x, run.y, offset);
    p.group.rotation.y = 0;
    const lean = Math.max(-0.12, Math.min(0.12, (laneX(run.lane) - run.x) * -0.04));
    p.body.rotation.z = lean;
    if (sliding(run) && !run.airborne) {
      // Limbo: squashed and leaning back under the barrier.
      p.body.scale.y = 0.55;
      p.body.rotation.x = 0.42;
    } else {
      p.body.scale.y = 1;
      p.body.rotation.x = -0.08;
    }
    if (run.airborne) {
      // Model faces −z: a positive x rotation swings a limb forward.
      p.lLeg.hip.rotation.x = 0.6;
      p.lLeg.knee.rotation.x = -0.9;
      p.rLeg.hip.rotation.x = -0.3;
      p.rLeg.knee.rotation.x = -0.3;
      p.lArm.rotation.x = 2.6;
      p.rArm.rotation.x = 2.6;
    } else {
      const cycle = now * (0.015 + run.speed * 0.00024);
      const swing = Math.sin(cycle) * 0.85;
      p.lLeg.hip.rotation.x = swing;
      p.rLeg.hip.rotation.x = -swing;
      // Knees bend backward (the shin swings to +z).
      p.lLeg.knee.rotation.x = -Math.max(0, Math.sin(cycle - 0.5)) * 1.1;
      p.rLeg.knee.rotation.x = -Math.max(0, -Math.sin(cycle - 0.5)) * 1.1;
      p.lArm.rotation.x = -swing * 0.85;
      p.rArm.rotation.x = swing * 0.85;
      p.torso.position.y = 1.38 + Math.abs(Math.cos(cycle)) * 0.07;
    }
    p.shield.visible = run.shield;
    if (run.shield) {
      p.shield.rotation.y = now * 0.002;
      p.shield.scale.setScalar(1 + Math.sin(now * 0.008) * 0.025);
      const ending = run.shieldT <= SHIELD.warning;
      const fade = ending ? Math.max(0, run.shieldT / SHIELD.warning) : 1;
      // Use simulation time so the warning freezes during a pause. Reduced motion only fades.
      const blink = ending && !reducedMotion() ? (Math.sin(run.t * Math.PI * 4) >= 0 ? 1 : 0.18) : 1;
      for (const part of p.shield.children) {
        part.material.opacity = (part.material.wireframe ? 0.45 : 0.1) * fade * blink;
      }
    }
    if (p === player) {
      blob.position.x = run.x;
      blob.scale.setScalar(Math.max(0.4, 1 - run.y * 0.2));
    }
  }

  function animateParticles(dt) {
    for (const p of particles) {
      if (!p.visible) continue;
      const u = p.userData;
      u.life -= dt;
      if (u.life <= 0) {
        p.visible = false;
        continue;
      }
      p.position.x += u.vx * dt;
      p.position.y += u.vy * dt;
      p.position.z += u.vz * dt;
      u.vy -= 14 * dt;
      p.scale.setScalar(Math.max(0.01, u.life * 2));
    }
  }

  /** Draws `run` (any phase). `dt`: real seconds since the last frame; `moving`: the run is playing. */
  function draw(run, now, dt, moving, ghost = null) {
    setRole(run.role);
    const area = campusAt(run.distance);
    scene.fog.color.lerp(fogTarget.setHex(area.fog), dt ? Math.min(1, dt * 2) : 1);
    // Road segments wrap: each is placed by the distance run, so they keep pace with the sim.
    const off = run.distance % SEG_LEN;
    segments.forEach((g, i) => {
      g.position.z = SEG_LEN - i * SEG_LEN + off;
      const worldIndex = Math.floor(run.distance / SEG_LEN) + i - 1;
      const stretch = campusAt(worldIndex * SEG_LEN);
      const variant = ((worldIndex % 3) + 3) % 3;
      const key = `${stretch.id}:${variant}`;
      if (g.userData.sceneryKey !== key) {
        g.userData.scenery.geometry = areaScenery(stretch.id, variant);
        g.userData.sceneryKey = key;
        g.userData.grass.material.color.setHex(stretch.grass);
        g.userData.walk.material.color.setHex(stretch.walk);
      }
    });
    syncObstacles(run, now);
    syncItems(run, now);
    syncLandmarks(run);
    animatePlayer(run, run.status === 'arrived' ? run.t * 1000 : moving ? now : now * 0.25);
    syncGhost(run, ghost, ghost ? ghost.t * 1000 : now);
    trailEffect.draw(run, cosmetics.trail, moving, reducedMotion());
    animateParticles(dt);
    dust.rotation.y += dt * 0.04;

    // Camera: follows the player sideways and a little up; boost widens the view.
    const rm = reducedMotion();
    const k = Math.min(1, dt * 6);
    camera.position.x += (run.x * 0.35 - camera.position.x) * k;
    camera.position.y += (CAM.y + run.y * 0.25 - camera.position.y) * k;
    const baseFov = canvas.clientWidth / Math.max(1, canvas.clientHeight) < 0.6 ? 68 : CAM.fov;
    const fov = run.boostT > 0 && !rm ? baseFov + 10 : baseFov;
    camera.fov += (fov - camera.fov) * Math.min(1, dt * 7);
    camera.updateProjectionMatrix();
    let sx = 0;
    let sy = 0;
    if (shake > 0.01) {
      sx = (Math.random() - 0.5) * shake;
      sy = (Math.random() - 0.5) * shake;
      shake *= Math.pow(0.02, dt);
    }
    camera.position.x += sx;
    camera.position.y += sy;
    camera.lookAt(camera.position.x * 0.6, CAM.lookY, CAM.lookZ);
    renderer.render(scene, camera);
    camera.position.x -= sx;
    camera.position.y -= sy;

    // Adaptive quality: a slow device steps down (sharpness, then shadows), never back up.
    if (moving && quality < 2) {
      frameTimes.push(dt);
      if (frameTimes.length >= 90) {
        const avg = frameTimes.reduce((a, b) => a + b, 0) / frameTimes.length;
        frameTimes.length = 0;
        if (avg > 0.022) setQuality(quality + 1);
      }
    }
  }

  return {
    draw,
    reset,
    onEvents,
    resize,
    setQuality,
    get quality() {
      return quality;
    },
    info: () => renderer.info,
    renderer,
  };
}

const laneX = (lane) => LANES[lane];
