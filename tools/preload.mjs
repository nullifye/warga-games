// Keeps each game's script preloads and the hub's prefetch list in step with the code.
//
//   node tools/preload.mjs          rewrite them
//   node tools/preload.mjs --check  exit 1 if they are out of date (tests/preload.test.mjs runs this)
//
// For each game page it follows the static imports from the page's module script, then:
//  * writes <link rel="modulepreload"> for every module between the markers in <head>, so the
//    browser fetches them all at once instead of discovering them one import level at a time;
//  * writes preload.json: each game's page, local stylesheets and scripts, which the hub
//    (nullifye/arcade) prefetches while idle so a tapped game opens almost at once.
// Run it after adding, removing or renaming an import, a stylesheet or a script.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, posix, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const GAMES = ['teka-kata', 'ular', 'duga-kata', 'kejar-lapan', '2048', 'blok', 'memori', 'congkak', '9balls', 'pemadam'];
// Files the hub doesn't prefetch: too big to fetch on the chance the game is played.
const PREFETCH_MAX_BYTES = 150_000;
const START = '<!-- modulepreload:start (tools/preload.mjs) -->';
const END = '<!-- modulepreload:end -->';

const rel = (file) => relative(ROOT, file).split('\\').join('/');

/** Static imports of one module (import … from, import '…', export … from); dynamic import() is skipped. */
function importsOf(file) {
  const src = readFileSync(file, 'utf8');
  const specs = [...src.matchAll(/^\s*(?:import|export)\s[^;]*?from\s*['"]([^'"]+)['"]|^\s*import\s*['"]([^'"]+)['"]/gm)]
    .map((m) => m[1] ?? m[2])
    .filter((s) => s.startsWith('.'));
  return specs.map((s) => resolve(dirname(file), s));
}

/** Every module reachable from `entry` by static imports, entry first. */
function moduleGraph(entry) {
  const seen = new Set();
  const visit = (file) => {
    if (seen.has(file)) return;
    if (!existsSync(file)) throw new Error(`${rel(entry)} imports missing ${rel(file)}`);
    seen.add(file);
    for (const dep of importsOf(file)) visit(dep);
  };
  visit(entry);
  return [...seen];
}

/** One game's page, with its modules and other local assets. */
export function analyse(game) {
  const page = join(ROOT, game, 'index.html');
  const html = readFileSync(page, 'utf8');
  const local = (href) => !/^[a-z]+:|^\/\//i.test(href);
  const at = (href) => resolve(dirname(page), href);
  const entry = html.match(/<script type="module" src="([^"]+)"/)?.[1];
  if (!entry) throw new Error(`${game}/index.html has no module script`);
  const modules = moduleGraph(at(entry));
  const styles = [...html.matchAll(/<link rel="stylesheet" href="([^"]+)"/g)].map((m) => m[1]).filter(local).map(at);
  const scripts = [...html.matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]).filter(local).map(at);
  return { page, html, entry: at(entry), modules, styles, scripts };
}

/** The <head> block of modulepreload links for a game (every module but the entry itself). */
export function preloadBlock(info) {
  const links = info.modules.filter((m) => m !== info.entry)
    .map((m) => `  <link rel="modulepreload" href="${posix.relative(posix.dirname(rel(info.page)), rel(m))}">`);
  return `${START}\n${links.join('\n')}\n  ${END}`;
}

export function withPreloads(info) {
  const block = preloadBlock(info);
  if (info.html.includes(START)) return info.html.replace(new RegExp(`${START}[\\s\\S]*?${END}`), block);
  // First run: put the block just before the module script.
  return info.html.replace(/( *)<script type="module" src=/, `$1${block}\n$1<script type="module" src=`);
}

/** preload.json: per game, the files worth prefetching (paths from the warga-games root). */
export function prefetchList() {
  const games = {};
  for (const game of GAMES) {
    const info = analyse(game);
    const files = [...info.styles, ...info.scripts, ...info.modules]
      .filter((f) => readFileSync(f).length <= PREFETCH_MAX_BYTES)
      .map(rel);
    games[game] = [`${game}/`, ...new Set(files)];
  }
  return `${JSON.stringify({ about: 'Written by tools/preload.mjs; the hub prefetches these while idle.', games }, null, 2)}\n`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const check = process.argv.includes('--check');
  const stale = [];
  for (const game of GAMES) {
    const info = analyse(game);
    const next = withPreloads(info);
    if (next !== info.html) { stale.push(`${game}/index.html`); if (!check) writeFileSync(info.page, next); }
  }
  const listFile = join(ROOT, 'preload.json');
  const list = prefetchList();
  if (!existsSync(listFile) || readFileSync(listFile, 'utf8') !== list) { stale.push('preload.json'); if (!check) writeFileSync(listFile, list); }
  if (check && stale.length) { console.error(`Out of date (run node tools/preload.mjs): ${stale.join(', ')}`); process.exit(1); }
  console.log(stale.length ? `Updated: ${stale.join(', ')}` : 'Up to date.');
}
