import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BALL_R, PLAY_LEFT, PLAY_RIGHT, PLAY_TOP, PLAY_BOTTOM, TOP_SPOT, HEAD_STRING_Y, POCKETS, AI_LEVELS,
  rack, lowestBall, cueBall, newShot, strike, tick, moving, judge, spotBall, validPlacement, returnCueBall,
  simulate, planShot, placeCueForAI, roundPoints, aimRay, tracePath, planSafety, planPushOut, acceptPush,
  bestShotScore,
} from '../js/rules.js';

function seeded(seed = 1) {
  let a = seed;
  return () => ((a = (a * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}
const b = (id, x, y) => ({ id, x, y, vx: 0, vy: 0, pocketed: false });
const onTable = (x) => x.x >= PLAY_LEFT + BALL_R - 0.01 && x.x <= PLAY_RIGHT - BALL_R + 0.01 && x.y >= PLAY_TOP + BALL_R - 0.01 && x.y <= PLAY_BOTTOM - BALL_R + 0.01;

test('the rack: 10 balls, the 1 at the front, the 9 in the middle, none touching', () => {
  const balls = rack(seeded());
  assert.deepEqual(balls.map((x) => x.id).sort((p, q) => p - q), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  const one = balls.find((x) => x.id === 1), nine = balls.find((x) => x.id === 9);
  assert.equal(one.y, Math.max(...balls.filter((x) => x.id).map((x) => x.y))); // nearest the cue ball
  assert.ok(Math.abs(nine.x - TOP_SPOT.x) < 0.01);
  for (let i = 0; i < balls.length; i++) for (let j = i + 1; j < balls.length; j++) {
    assert.ok(Math.hypot(balls[i].x - balls[j].x, balls[i].y - balls[j].y) >= BALL_R * 2, 'no overlap');
  }
  assert.ok(cueBall(balls).y > HEAD_STRING_Y);
  assert.equal(lowestBall(balls).id, 1);
});

test('a struck ball slows to a stop and never leaves the table, whatever the angle', () => {
  for (let k = 0; k < 72; k++) {
    for (const start of [[250, 480], [60, 60], [440, 900], [60, 480], [250, 70]]) {
      const balls = [b(0, ...start)];
      const shot = newShot(balls);
      strike(balls, (k / 72) * Math.PI * 2, 1);
      let n = 0;
      while (moving(balls) && n++ < 5000) tick(balls, shot);
      assert.ok(n < 5000, 'stops');
      const cue = balls[0];
      assert.ok(cue.pocketed || onTable(cue), `angle ${k}: ${cue.x.toFixed(1)},${cue.y.toFixed(1)}`);
    }
  }
});

test('a straight shot pots a ball, and records what it hit first', () => {
  // Cue, 1-ball and the top-left corner pocket in a line.
  const p = POCKETS[0];
  const balls = [b(0, 200, 400), b(1, 0, 0)];
  const ang = Math.atan2(p.y - 400, p.x - 200);
  balls[1].x = 200 + Math.cos(ang) * 120;
  balls[1].y = 400 + Math.sin(ang) * 120;
  const { shot } = simulate(balls, ang, 0.7);
  assert.equal(shot.firstHit, 1);
  assert.ok(shot.pocketed.includes(1));
  assert.ok(!shot.pocketed.includes(0));
});

test('fouls: scratch, no contact, wrong ball first, no pot and no cushion', () => {
  const base = { firstHit: 1, pocketed: [], railAfterContact: true, lowestBefore: 1 };
  assert.equal(judge(base).foul, null);
  assert.equal(judge({ ...base, pocketed: [0] }).foul, 'scratch');
  assert.equal(judge({ ...base, firstHit: null }).foul, 'miss');
  assert.equal(judge({ ...base, firstHit: 3 }).foul, 'wrong');
  assert.equal(judge({ ...base, railAfterContact: false }).foul, 'rail');
  assert.equal(judge({ ...base, railAfterContact: false, pocketed: [4] }).foul, null); // a pot is enough
});

test('potting keeps the turn; the 9 wins on a legal shot and is re-spotted on a foul', () => {
  const legal = judge({ firstHit: 1, pocketed: [1, 5], railAfterContact: false, lowestBefore: 1 });
  assert.deepEqual([legal.keepTurn, legal.potted, legal.win], [true, [1, 5], false]);
  const win = judge({ firstHit: 2, pocketed: [9], railAfterContact: true, lowestBefore: 2 });
  assert.equal(win.win, true);
  assert.equal(win.golden, false);
  assert.equal(judge({ firstHit: 1, pocketed: [9], railAfterContact: true, lowestBefore: 1 }, true).golden, true);
  const foulNine = judge({ firstHit: 1, pocketed: [9, 0], railAfterContact: true, lowestBefore: 1 });
  assert.deepEqual([foulNine.win, foulNine.respotNine, foulNine.potted], [false, true, []]);
});

test('re-spotting the 9 finds a free place on the spot line', () => {
  const balls = rack(seeded());
  const nine = balls.find((x) => x.id === 9);
  nine.pocketed = true;
  const blocker = balls.find((x) => x.id === 1);
  blocker.x = TOP_SPOT.x;
  blocker.y = TOP_SPOT.y;
  spotBall(balls, nine);
  assert.equal(nine.pocketed, false);
  for (const o of balls) if (o !== nine && !o.pocketed) assert.ok(Math.hypot(o.x - nine.x, o.y - nine.y) >= BALL_R * 2);
});

test('ball in hand: valid places, and the cue ball comes back onto the table', () => {
  const balls = rack(seeded());
  assert.equal(validPlacement(balls, 250, HEAD_STRING_Y - 50, true), false); // break: behind the head string only
  assert.equal(validPlacement(balls, 250, HEAD_STRING_Y - 50, false), true);
  const one = balls.find((x) => x.id === 1);
  assert.equal(validPlacement(balls, one.x + 5, one.y), false);
  const cue = cueBall(balls);
  cue.pocketed = true;
  returnCueBall(balls);
  assert.equal(cue.pocketed, false);
  assert.ok(validPlacement(balls, cue.x, cue.y));
});

test('the aim guide finds the first ball in the line', () => {
  const balls = [b(0, 250, 700), b(1, 250, 400), b(2, 250, 300)];
  const ray = aimRay(balls, -Math.PI / 2);
  assert.equal(ray.hit.id, 1);
  assert.ok(Math.abs(ray.y - (400 + BALL_R * 2)) < 0.01);
});

test('the AI aims at the lowest ball; Susah pots an easy shot', () => {
  const p = POCKETS[0];
  const balls = [b(0, 200, 400), b(1, 0, 0), b(5, 400, 800)];
  const ang = Math.atan2(p.y - 400, p.x - 200);
  balls[1].x = 200 + Math.cos(ang) * 140;
  balls[1].y = 400 + Math.sin(ang) * 140;
  const random = seeded(4);
  for (const level of Object.keys(AI_LEVELS)) {
    const plan = planShot(balls, level, false, random);
    assert.ok(Number.isFinite(plan.angle) && plan.power > 0 && plan.power <= 1, level);
  }
  let potted = 0;
  for (let i = 0; i < 10; i++) {
    const plan = planShot(balls, 'susah', false, random);
    const { shot } = simulate(balls, plan.angle, plan.power);
    if (judge(shot).potted.includes(1)) potted++;
  }
  assert.ok(potted >= 8, `Susah potted ${potted}/10`);
});

test('the AI places the cue ball legally when it has ball in hand', () => {
  const balls = rack(seeded());
  for (const x of balls) if (x.id > 0 && x.id < 6) x.pocketed = true;
  for (const level of Object.keys(AI_LEVELS)) {
    placeCueForAI(balls, level);
    const cue = cueBall(balls);
    assert.ok(validPlacement(balls, cue.x, cue.y), level);
  }
});

test('points: 100 a ball potted, plus the level bonus for a win', () => {
  assert.equal(roundPoints(3, false, 'susah'), 300);
  assert.equal(roundPoints(9, true, 'mudah'), 900 + AI_LEVELS.mudah.bonus);
  assert.equal(roundPoints(1, true, 'susah'), 100 + AI_LEVELS.susah.bonus); // a golden break
});

test('the extended guide traces cushion bounces, and stops at a ball or a pocket', () => {
  // Straight across to the right cushion and back: one bounce, back at the start's x.
  const lone = [b(0, 250, 300)];
  const across = tracePath(lone, lone[0], 0, { bounces: 1, maxLen: 2 * (PLAY_RIGHT - BALL_R - 250) });
  assert.equal(across.points.length, 3);
  assert.ok(Math.abs(across.points[1].x - (PLAY_RIGHT - BALL_R)) < 1e-6);
  assert.ok(Math.abs(across.points[2].x - 250) < 1e-6);
  // A diagonal reflects: the angle in equals the angle out.
  const diag = tracePath(lone, lone[0], -Math.PI / 4, { bounces: 1, maxLen: 300 });
  const [p0, p1, p2] = diag.points;
  const unit = (q, r) => { const l = Math.hypot(r.x - q.x, r.y - q.y); return [(r.x - q.x) / l, (r.y - q.y) / l]; };
  const [inX, inY] = unit(p0, p1), [outX, outY] = unit(p1, p2);
  assert.ok(Math.abs(inX + outX) < 1e-6 && Math.abs(inY - outY) < 1e-6, 'off the right cushion: x flips, y keeps');
  // A ball in the way stops it, at the ghost-ball spot.
  const blocked = tracePath([b(0, 250, 700), b(3, 250, 400)], { x: 250, y: 700 }, -Math.PI / 2);
  assert.equal(blocked.hit.id, 3);
  assert.ok(Math.abs(blocked.points.at(-1).y - (400 + BALL_R * 2)) < 1e-6);
  // Aimed straight at a corner pocket, it ends in the pocket.
  const p = POCKETS[0];
  const corner = tracePath(lone, lone[0], Math.atan2(p.y - 300, p.x - 250));
  assert.equal(corner.pocket, p);
});

test('a struck ball slides first, then rolls at 5/7 of its speed', () => {
  const balls = [b(0, 250, 840)];
  const shot = newShot(balls);
  strike(balls, -Math.PI / 2, 0.5);
  const v0 = Math.hypot(balls[0].vx, balls[0].vy);
  assert.equal(balls[0].sy, 0); // no spin yet: sliding
  let n = 0;
  while (Math.abs(balls[0].vy - balls[0].sy) > 1e-9 && n++ < 200) tick(balls, shot);
  const v = Math.hypot(balls[0].vx, balls[0].vy);
  assert.ok(n < 60, `rolls within a second (${n} ticks)`);
  assert.ok(v > v0 * 0.6 && v < v0 * (5 / 7) + 0.01, `${v.toFixed(2)} of ${v0.toFixed(2)}`);
});

test('a sliding cue ball stops dead on a full hit (stun); a rolling one follows through', () => {
  const run = (gap) => {
    // The cue ball straight below the object ball, `gap` away: close, it's still sliding at
    // contact; far, it has started rolling.
    const balls = [b(0, 250, 400 + gap), b(1, 250, 400)];
    const shot = newShot(balls);
    strike(balls, -Math.PI / 2, 0.45);
    let n = 0, highest = 400;
    while (moving(balls) && n++ < 3000) { tick(balls, shot); highest = Math.min(highest, balls[1].y); }
    // How far each went after the hit: the cue ball from where it touched, the object ball at its furthest.
    return { cueTravel: 400 + BALL_R * 2 - balls[0].y, objectTravel: 400 - highest };
  };
  const stun = run(BALL_R * 2 + 4), follow = run(420);
  assert.ok(stun.objectTravel > 100);
  assert.ok(Math.abs(stun.cueTravel) < 12, `stun: cue ball moved ${stun.cueTravel.toFixed(1)} after the hit`);
  assert.ok(follow.cueTravel > 40, `follow: cue ball went on ${follow.cueTravel.toFixed(1)}`);
});

test('spin: low draws the cue ball back after a full hit, high follows through further', () => {
  const run = (spinY) => {
    const balls = [b(0, 250, 640), b(1, 250, 400)];
    const shot = newShot(balls);
    strike(balls, -Math.PI / 2, 0.5, { x: 0, y: spinY });
    // After the hit: how far the cue ball went on (forward, up) and came back (down) from contact.
    const contact = 400 + BALL_R * 2;
    let n = 0, forward = 0, back = 0;
    while (moving(balls) && n++ < 4000) {
      tick(balls, shot);
      if (shot.firstHit === null) continue;
      forward = Math.max(forward, contact - balls[0].y);
      back = Math.max(back, balls[0].y - contact);
    }
    return { forward, back };
  };
  const draw = run(-1), stun = run(0), follow = run(1);
  assert.ok(draw.back > 60 && draw.forward < 5, `draw: back ${draw.back.toFixed(0)}, forward ${draw.forward.toFixed(0)}`);
  // A centre hit from here has started rolling, so it follows a little; topspin follows much further.
  assert.ok(follow.forward > stun.forward + 50, `follow ${follow.forward.toFixed(0)} vs centre ${stun.forward.toFixed(0)}`);
});

test('spin: right english sends the ball off a cushion to the right of where it came from', () => {
  const run = (spinX) => {
    const balls = [b(0, 250, 500)];
    const shot = newShot(balls);
    strike(balls, -Math.PI / 2, 0.5, { x: spinX, y: 0 });
    let n = 0, bounced = false;
    while (moving(balls) && n++ < 4000) { tick(balls, shot); if (balls[0].vy > 0) bounced = true; if (bounced && balls[0].y > 300) break; }
    return balls[0].x - 250;
  };
  assert.ok(run(1) > 8, `right: ${run(1).toFixed(1)}`);
  assert.ok(run(-1) < -8, `left: ${run(-1).toFixed(1)}`);
  assert.ok(Math.abs(run(0)) < 0.5);
});

test("the AI's plan includes its spin: centre for Mudah, a reachable strike point otherwise", () => {
  const balls = rack(seeded(9));
  const after = simulate(balls, -Math.PI / 2, 0.94).balls; // after a break
  const random = seeded(2);
  assert.deepEqual(planShot(after, 'mudah', false, random).spin, { x: 0, y: 0 });
  for (const level of ['sederhana', 'susah']) {
    const { spin } = planShot(after, level, false, random);
    assert.ok(Math.hypot(spin.x, spin.y) <= 1, level);
  }
});

test('push-out: anything goes but a scratch; nothing potted counts; the 9 comes back', () => {
  const push = (over) => judge({ firstHit: null, pocketed: [], railAfterContact: false, lowestBefore: 1, pushOut: true, ...over });
  assert.deepEqual([push().foul, push().push, push().keepTurn], [null, true, false]); // no contact: fine
  assert.equal(push({ firstHit: 5 }).foul, null); // the wrong ball: fine
  assert.equal(push({ pocketed: [0] }).foul, 'scratch');
  const nine = push({ firstHit: 1, pocketed: [9, 4] });
  assert.deepEqual([nine.win, nine.respotNine, nine.potted], [false, true, []]);
});

test('a safety is always legal, and leaves a worse shot than the table had', () => {
  const random = seeded(5);
  for (let k = 0; k < 4; k++) {
    const balls = simulate(rack(seeded(20 + k)), -Math.PI / 2, 0.94).balls; // after a break
    const cue = cueBall(balls);
    if (cue.pocketed) continue;
    const safe = planSafety(balls, 'susah', random);
    assert.ok(safe, 'found one');
    const after = simulate(balls, safe.angle, safe.power);
    const v = judge(after.shot);
    assert.equal(v.foul, null, `layout ${k}`);
    if (!v.keepTurn) assert.ok(bestShotScore(after.balls) <= Math.max(bestShotScore(balls), 100), `layout ${k}`);
  }
});

test('a push-out never scratches; the AI hands a bad push back and plays a good one', () => {
  const balls = simulate(rack(seeded(31)), -Math.PI / 2, 0.94).balls;
  const push = planPushOut(balls, seeded(3));
  assert.equal(push.kind, 'push');
  assert.ok(!simulate(balls, push.angle, push.power).shot.pocketed.includes(0));
  // An easy straight shot is worth playing; with the target hidden behind another ball it isn't.
  const p = POCKETS[0];
  const easy = [b(0, 200, 400), b(1, 0, 0)];
  const ang = Math.atan2(p.y - 400, p.x - 200);
  easy[1].x = 200 + Math.cos(ang) * 140;
  easy[1].y = 400 + Math.sin(ang) * 140;
  assert.equal(acceptPush(easy, 'susah'), true);
  const hidden = [b(0, 250, 800), b(2, 250, 600), b(1, 250, 540)];
  assert.equal(acceptPush(hidden, 'susah'), false);
  assert.equal(acceptPush(hidden, 'mudah'), true); // Mudah always plays
});
