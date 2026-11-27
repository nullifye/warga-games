import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COSMETICS, SLOTS, COSMETICS_TEST_UNLOCK, isUnlocked, equippedCosmetics, newlyUnlocked, progressionAfterRun, milestoneLabel, milestoneProgress } from '../js/cosmetics.js';
import { buildPlayer, buildCosmeticItem, voxelMat } from '../js/models.js';

const EARNED = COSMETICS.reduce((stats, item) => ({ ...stats, [item.metric]: Math.max(stats[item.metric] ?? 0, item.target) }), {});

test('all body-position slots have rewards with exact milestone boundaries', () => {
  assert.equal(new Set(COSMETICS.map((item) => item.id)).size, COSMETICS.length);
  for (const slot of Object.keys(SLOTS)) assert.ok(COSMETICS.some((item) => item.slot === slot));
  for (const item of COSMETICS) {
    assert.equal(isUnlocked({ [item.metric]: item.target - 1 }, item, false), false);
    assert.equal(isUnlocked({ [item.metric]: item.target }, item, false), true);
    assert.equal(isUnlocked({ [item.metric]: Infinity }, item, false), false);
  }
});

test('locked, unknown and wrong-slot equipment falls back to original', () => {
  const saved = { backpack: 'bag-mint', outfit: 'bag-gold', trail: 'missing', accessory: 'glasses' };
  assert.deepEqual(Object.values(equippedCosmetics({}, saved, false)), [null, null, null, null, null, null]);
  const unlocked = equippedCosmetics({ played: 100, bestDistance: 5000 }, saved, false);
  assert.equal(unlocked.back.id, 'bag-mint');
  assert.equal(unlocked.face.id, 'glasses');
  assert.equal(unlocked.outfit, null);
  assert.equal(unlocked.trail, null);
  assert.deepEqual(equippedCosmetics(null, null), { head: null, face: null, outfit: null, back: null, hand: null, trail: null });
});

test('existing stats earn rewards and results announce only new milestones', () => {
  const before = { played: 99, bestDistance: 4999 };
  const after = { played: 100, bestDistance: 5000 };
  assert.deepEqual(newlyUnlocked(before, after, false).map((item) => item.id), ['bag-mint', 'glasses']);
  assert.deepEqual(newlyUnlocked(after, after), []);
  assert.equal(equippedCosmetics(EARNED, { trail: 'trail-mint' }).trail.id, 'trail-mint');
});

test('each role renders all cosmetics without changing the selected equipment', () => {
  for (const role of ['pelajar', 'staf', 'alumni', 'awam']) {
    for (const item of COSMETICS) {
      const equipment = Object.freeze({ [item.slot]: Object.freeze({ ...item }) });
      const player = buildPlayer(role, equipment);
      assert.ok(player.group.children.length > 0);
      assert.equal(player.lLeg.hip.position.y, 0.92);
      player.group.traverse((obj) => {
        if (!obj.isMesh) return;
        assert.ok(Array.from(obj.geometry.attributes.position.array).every(Number.isFinite));
        obj.geometry.dispose();
        if (obj.material !== voxelMat) obj.material.dispose();
      });
    }
  }
});

test('bags have different silhouettes and headwear replaces default hats', () => {
  const sizes = [];
  for (const item of COSMETICS.filter((item) => item.slot === 'back' && item.design)) {
    const p = buildPlayer('pelajar', { back: item });
    const bag = p.group.getObjectByName(`cosmetic-bag-${item.design}`);
    assert.ok(bag, item.design);
    sizes.push(bag.children.map((child) => child.geometry.attributes.position.count).join(','));
  }
  assert.equal(new Set(sizes).size, 2);
  const cap = COSMETICS.find((item) => item.id === 'cap');
  const headVertices = (role) => buildPlayer(role, { head: cap }).head.children[0].geometry.attributes.position.count;
  assert.equal(headVertices('pelajar'), headVertices('alumni'));
  assert.equal(headVertices('pelajar'), headVertices('awam'));
  assert.ok(buildPlayer('staf', { back: COSMETICS.find((item) => item.id === 'katanas') }).group.getObjectByName('cosmetic-katanas'));
});

test('four trail designs share cached geometries and animate without changing equipment', async () => {
  const { buildTrailMark, trailGeometry, styleTrailMark } = await import('../js/trails.js');
  const trails = COSMETICS.filter((item) => item.slot === 'trail');
  assert.deepEqual(new Set(trails.map((item) => item.design)), new Set(['frost', 'stars', 'fire', 'rainbow']));
  const geometries = new Set();
  const mark = buildTrailMark();
  for (const item of trails) {
    const geometry = trailGeometry(item.design);
    geometries.add(geometry);
    assert.strictEqual(trailGeometry(item.design), geometry);
    assert.ok(Array.from(geometry.attributes.position.array).every(Number.isFinite));
    for (const age of [0, 5, 13]) {
      styleTrailMark(mark, item.design, age, 3, 2);
      assert.strictEqual(mark.geometry, geometry);
      assert.ok([mark.position.y, ...mark.scale.toArray(), mark.rotation.z].every(Number.isFinite));
    }
  }
  assert.equal(geometries.size, 4);
});


test('all items start locked and saved test selections cannot bypass milestones', () => {
  const stats = Object.freeze({ played: 0, bestDistance: 0 });
  assert.equal(COSMETICS_TEST_UNLOCK, false);
  for (const item of COSMETICS) {
    assert.equal(isUnlocked(stats, item), false);
    assert.equal(equippedCosmetics(stats, { [item.slot]: item.id })[item.slot], null);
    assert.equal(equippedCosmetics(EARNED, { [item.slot]: item.id })[item.slot].id, item.id);
    assert.ok(item.target > 0);
  }
});

test('shared trail emitter uses identical transforms for preview and game samples', async () => {
  const THREE = await import('../../shared/vendor/three.module.min.js');
  const { createTrailEffect } = await import('../js/trails.js');
  for (const cosmetic of COSMETICS.filter((item) => item.slot === 'trail')) {
    const game = new THREE.Group();
    const preview = new THREE.Group();
    const liveEmitter = createTrailEffect(game);
    const previewEmitter = createTrailEffect(preview);
    for (let tick = 0; tick < 120; tick++) {
      const run = { x: 0, distance: tick * 0.2, t: tick / 60, status: 'running', airborne: false };
      liveEmitter.draw(run, cosmetic, true);
      previewEmitter.draw(run, cosmetic, true);
    }
    assert.equal(game.children.length, 18);
    assert.deepEqual(preview.children.map((mark) => [mark.visible, mark.position.toArray(), mark.scale.toArray(), mark.rotation.toArray()]),
      game.children.map((mark) => [mark.visible, mark.position.toArray(), mark.scale.toArray(), mark.rotation.toArray()]));
    previewEmitter.draw({ distance: 24, t: 2 }, cosmetic, false, true);
    assert.ok(preview.children.every((mark) => !mark.visible));
    previewEmitter.reset();
    assert.ok(preview.children.every((mark) => !mark.visible));
  }
});


test('isolated accessory cards exclude the role’s default headwear and character geometry', () => {
  for (const [id, boxes] of [['glasses', 5], ['cap', 9], ['hat', 3], ['handheld', 4], ['mask', 8], ['trident', 9], ['briefcase', 6]]) {
    const item = COSMETICS.find((candidate) => candidate.id === id);
    for (const role of ['pelajar', 'staf', 'alumni', 'awam']) {
      const isolated = buildCosmeticItem(role, item);
      assert.equal(isolated.children.length, 1);
      const geometry = isolated.children[0].geometry;
      assert.equal(geometry.attributes.position.count, boxes * 36, `${role}: ${id}`);
      geometry.dispose();
    }
  }
});


test('old selections migrate into position slots and bags share the back slot with katanas', () => {
  const migrated = equippedCosmetics(EARNED, { backpack: 'bag-gold', accessory: 'katanas' });
  assert.equal(migrated.back.id, 'katanas');
  const cleared = equippedCosmetics(EARNED, { backpack: 'bag-gold', accessory: 'katanas', back: null });
  assert.equal(cleared.back, null);
  const selected = equippedCosmetics(EARNED, { back: 'bag-mint', head: 'cap', face: 'glasses', hand: 'handheld' });
  assert.equal(selected.back.id, 'bag-mint');
  assert.equal(selected.head.id, 'cap');
  assert.equal(selected.face.id, 'glasses');
  assert.equal(selected.hand.id, 'handheld');
  const player = buildPlayer('pelajar', selected);
  assert.ok(player.group.getObjectByName('cosmetic-bag-round'));
  assert.equal(player.group.getObjectByName('cosmetic-katanas'), undefined);
  const swords = buildPlayer('pelajar', migrated);
  assert.ok(swords.group.getObjectByName('cosmetic-katanas'));
  assert.equal(swords.group.getObjectByName('cosmetic-bag-cat'), undefined);
});


test('removed sling selections fall back to original and new items use face/hand slots', () => {
  assert.equal(COSMETICS.some((item) => item.id === 'bag-sling'), false);
  assert.equal(equippedCosmetics(EARNED, { back: 'bag-sling' }).back, null);
  assert.equal(equippedCosmetics(EARNED, { backpack: 'bag-sling' }).back, null);
  const selected = equippedCosmetics(EARNED, { face: 'beard', hand: 'briefcase', back: 'katanas' });
  assert.equal(selected.face.id, 'mask');
  assert.equal(selected.hand.id, 'briefcase');
  for (const role of ['pelajar', 'staf', 'alumni', 'awam']) {
    const player = buildPlayer(role, selected);
    const swords = player.group.getObjectByName('cosmetic-katanas');
    assert.strictEqual(swords.parent, player.torso);
    assert.ok(swords.getObjectByName('katana-harness'));
    assert.equal(swords.children.filter((part) => part.name !== 'katana-harness').length, 2);
    for (const sword of swords.children.filter((part) => part.name !== 'katana-harness')) assert.equal(sword.position.z, 0.35);
    // Exactly the arm and hand plus the six briefcase boxes; no duplicated role prop.
    assert.equal(player.rArm.children[0].geometry.attributes.position.count, 8 * 36);
  }
});


test('robe and vest change the clothing silhouette while sharing the runner joints', async () => {
  const THREE = await import('../../shared/vendor/three.module.min.js');
  const robe = COSMETICS.find((item) => item.design === 'robe');
  const vest = COSMETICS.find((item) => item.design === 'vest');
  const robeSize = new THREE.Box3().setFromObject(buildCosmeticItem('staf', robe)).getSize(new THREE.Vector3());
  const vestSize = new THREE.Box3().setFromObject(buildCosmeticItem('staf', vest)).getSize(new THREE.Vector3());
  assert.ok(robeSize.y > vestSize.y + 0.5);
  assert.ok(robeSize.x > vestSize.x);
  for (const role of ['pelajar', 'staf', 'alumni', 'awam']) {
    for (const outfit of [robe, vest]) {
      const player = buildPlayer(role, { outfit });
      assert.equal(player.lArm.position.x, -0.52);
      assert.equal(player.rArm.position.x, 0.52);
      assert.equal(player.lLeg.hip.position.y, 0.92);
      assert.equal(player.torso.position.y, 1.38);
    }
  }
});

test('new jetpack and trident render on every role and saved beard becomes the mask', () => {
  assert.equal(COSMETICS.some((item) => item.id === 'beard'), false);
  const selected = equippedCosmetics(EARNED, { face: 'beard', back: 'jetpack', hand: 'trident' });
  assert.equal(selected.face.id, 'mask');
  for (const role of ['pelajar', 'staf', 'alumni', 'awam']) {
    const player = buildPlayer(role, selected);
    assert.strictEqual(player.group.getObjectByName('cosmetic-jetpack').parent, player.torso);
    assert.equal(player.rArm.children[0].geometry.attributes.position.count, 11 * 36);
    const isolated = buildCosmeticItem(role, selected.back);
    assert.ok(isolated.getObjectByName('cosmetic-jetpack'));
  }
});


test('completed runs accumulate games, active seconds, distance, checkpoints, arrivals and pickups', () => {
  const before = Object.freeze({ played: 9, best: 400, bestDistance: 1200 });
  const run = { score: 300, distance: 640.5, t: 45.25, checkpoints: 2, status: 'arrived', picked: { points: 6, boost: 1, shield: 1, time: 2 } };
  const after = progressionAfterRun(before, run);
  assert.deepEqual(after, { played: 10, best: 400, bestDistance: 1200, totalDistance: 640.5, totalSeconds: 45.25, totalCheckpoints: 2, arrivals: 1, totalItems: 10 });
  const crashed = progressionAfterRun(after, { ...run, status: 'crashed', t: 10, distance: 100, checkpoints: 0, picked: {} });
  assert.equal(crashed.arrivals, 1);
  assert.equal(crashed.totalSeconds, 55.25);
  assert.equal(crashed.totalDistance, 740.5);
  assert.equal(crashed.played, 11);
  assert.equal(crashed.totalItems, 10);
  assert.equal(before.played, 9);
});

test('new cumulative milestones unlock only when their matching metric reaches the goal', () => {
  const metrics = new Set(COSMETICS.map((item) => item.metric));
  assert.deepEqual(metrics, new Set(['played', 'bestDistance', 'totalDistance', 'totalSeconds', 'totalCheckpoints', 'arrivals', 'totalItems']));
  for (const item of COSMETICS) {
    assert.ok(milestoneLabel(item));
    assert.ok(milestoneProgress({}, item));
    assert.deepEqual(newlyUnlocked({}, { [item.metric]: item.target }).filter((reward) => reward.id === item.id), [item]);
  }
  const timed = COSMETICS.find((item) => item.metric === 'totalSeconds');
  assert.match(milestoneLabel(timed), /minit/);
  assert.match(milestoneProgress({}, timed), /min/);
  assert.equal(progressionAfterRun({ totalSeconds: NaN }, { t: 60, distance: 1 }).totalSeconds, 60);
});
