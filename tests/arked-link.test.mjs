import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cameFromHub, hubUrl, shareUrl } from '../shared/arked-link.js';

test('the hub address is the real hub wherever the game is hosted, local only on a dev server', () => {
  assert.equal(hubUrl({ hostname: 'nullifye.github.io', origin: 'https://nullifye.github.io' }), 'https://nullifye.github.io/arcade/');
  // A game on another host (contract: games may live anywhere) still goes back to the real hub.
  assert.equal(hubUrl({ hostname: 'my-game.vercel.app', origin: 'https://my-game.vercel.app' }), 'https://nullifye.github.io/arcade/');
  assert.equal(hubUrl({ hostname: 'localhost', origin: 'http://localhost:8080' }), 'http://localhost:8080/arcade/');
  assert.equal(hubUrl({ hostname: '127.0.0.1', origin: 'http://127.0.0.1:8080' }), 'http://127.0.0.1:8080/arcade/');
});

test('only a visit straight from the hub walks back through the history', () => {
  assert.equal(cameFromHub('https://nullifye.github.io/arcade/'), true);
  assert.equal(cameFromHub('https://nullifye.github.io/'), true); // cross-site: origin only
  assert.equal(cameFromHub('http://localhost:8080/arcade/'), true);
  assert.equal(cameFromHub(''), false);
  assert.equal(cameFromHub('https://nullifye.github.io/teka-kata/'), false);
  assert.equal(cameFromHub('https://evil.example/arcade/'), false);
});

test('shared links drop ?dari=arked and the screen', () => {
  assert.equal(shareUrl('https://nullifye.github.io/teka-kata/?dari=arked#/keputusan'), 'https://nullifye.github.io/teka-kata/');
  assert.equal(shareUrl('https://nullifye.github.io/teka-kata/#/keputusan'), 'https://nullifye.github.io/teka-kata/');
});
