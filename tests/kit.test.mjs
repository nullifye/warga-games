// The shared kit (shared/, see shared/README.md): what every game relies on, kept in step.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { GAMES, analyse } from '../tools/preload.mjs';

const SHARED = new URL('../shared/', import.meta.url);

test('every game uses the shared Papan Markah (shared/board.js), not a copy of its own', () => {
  for (const game of GAMES) {
    const { modules } = analyse(game);
    assert.ok(modules.some((m) => m.endsWith('/shared/board.js')), `${game} does not load shared/board.js`);
    for (const m of modules.filter((f) => !f.includes('/shared/'))) {
      const src = readFileSync(m, 'utf8');
      assert.ok(!/function (setTab|loadTab|boardMessage)\(/.test(src), `${game}: ${m} still has its own board code`);
    }
  }
});

test('every game page has the markup shared/board.js drives', () => {
  for (const game of GAMES) {
    const { html } = analyse(game);
    for (const need of ['id="screen-board"', 'id="lb-body"', 'id="board-sub"', 'id="btn-board-refresh"', 'data-tab="daily"', 'data-tab="alltime"', 'data-tab="campus"']) {
      assert.ok(html.includes(need), `${game}/index.html lacks ${need}`);
    }
  }
});

test('the kit is self-contained: shared modules import only from shared/ (a game on any host can copy it)', () => {
  for (const file of readdirSync(SHARED).filter((f) => f.endsWith('.js'))) {
    const src = readFileSync(new URL(file, SHARED), 'utf8');
    for (const [, spec] of src.matchAll(/(?:^|\n)\s*(?:import|export)\s[^;]*?from\s*['"]([^'"]+)['"]/g)) {
      assert.ok(spec.startsWith('./'), `shared/${file} imports ${spec} (outside the kit)`);
    }
    for (const [, spec] of src.matchAll(/import\(\s*['"]([^'"]+)['"]\s*\)/g)) {
      assert.ok(spec.startsWith('./'), `shared/${file} loads ${spec} (outside the kit)`);
    }
  }
});
