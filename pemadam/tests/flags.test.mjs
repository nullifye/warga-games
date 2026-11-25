import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FLAGS, AI_FLAGS } from '../js/flags.js';

// Official proportions (width : height).
const RATIO = {
  Malaysia: 2, Japan: 3 / 2, Indonesia: 3 / 2, Thailand: 3 / 2, Singapore: 3 / 2, Germany: 5 / 3,
  France: 3 / 2, Italy: 3 / 2, Netherlands: 3 / 2, Ukraine: 3 / 2, Bangladesh: 5 / 3, Poland: 8 / 5,
};

/** A stand-in 2D context that records what a flag draws. */
function recorder() {
  const shapes = [];
  return {
    shapes,
    fillStyle: '',
    fillRect(x, y, w, h) { shapes.push({ kind: 'rect', x, y, w, h, color: this.fillStyle }); },
    beginPath() { this.points = 0; this.circle = null; },
    moveTo() { this.points++; },
    lineTo() { this.points++; },
    closePath() {},
    arc(x, y, r) { this.circle = { x, y, r }; },
    fill() { shapes.push(this.circle ? { kind: 'disc', ...this.circle, color: this.fillStyle } : { kind: 'star', points: this.points / 2, color: this.fillStyle }); },
  };
}

test('every flag has its official proportions', () => {
  assert.deepEqual(Object.keys(FLAGS).sort(), Object.keys(RATIO).sort());
  for (const [k, f] of Object.entries(FLAGS)) assert.ok(Math.abs(f.w / f.h - RATIO[k]) < 1e-9, k);
});

test('the AI never gets Malaysia, and each of its flags has a Malay name', () => {
  assert.equal('Malaysia' in AI_FLAGS, false);
  assert.equal(Object.keys(AI_FLAGS).length, Object.keys(FLAGS).length - 1);
  assert.equal(AI_FLAGS.Japan, 'Jepun');
  assert.equal(AI_FLAGS.Singapore, 'Singapura');
});

test('Jalur Gemilang: 14 stripes red first, the canton, the crescent and a 14-point star', () => {
  const c = recorder();
  FLAGS.Malaysia.draw(c);
  const stripes = c.shapes.filter((s) => s.kind === 'rect' && s.w === 28);
  assert.equal(stripes.length, 14);
  assert.equal(stripes[0].color, '#cc0001');
  assert.ok(c.shapes.some((s) => s.kind === 'rect' && s.w === 14 && s.h === 8 && s.color === '#010066'));
  const [outer, inner] = c.shapes.filter((s) => s.kind === 'disc');
  assert.deepEqual([outer.x, outer.y, outer.r], [5.75, 4, 3]);
  assert.equal(inner.y, 4); // level: the crescent opens straight towards the star
  assert.ok(inner.x > outer.x);
  const star = c.shapes.find((s) => s.kind === 'star');
  assert.equal(star.points, 14);
  assert.equal(star.color, '#ffcc00');
});

test('Singapore: a crescent and five five-pointed stars in the red half', () => {
  const c = recorder();
  FLAGS.Singapore.draw(c);
  const stars = c.shapes.filter((s) => s.kind === 'star');
  assert.equal(stars.length, 5);
  assert.ok(stars.every((s) => s.points === 5 && s.color === '#ffffff'));
  const discs = c.shapes.filter((s) => s.kind === 'disc');
  assert.ok(discs.every((d) => d.y + d.r <= 18), 'all within the red half');
});
