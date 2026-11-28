// Jalan's levels, made up as you play. A level is a row of road sections; each section has its
// ground (flat road, an open drain, a fake patch over a drain, a raised step, a hill, a hill with
// a tunnel through it, or a river with a bridge) and one trick. Level n has 2n tricks, so the road gets longer and nastier each level.
// The ground of a level stays put for the whole level; the tricks are rolled again after every
// death (rollTraps), so the road can't simply be learnt. tests/road.test.mjs builds many levels
// and checks each one can be finished.
import { H } from './road.js';

export const LEVEL_COUNT = 10;
export const SECTION = 9; // tiles in a plain section
/** Tiles each kind of ground takes. */
const WIDTH = { datar: 9, longkang: 9, palsu: 9, tangga: 9, bukit: 14, terowong: 15, sungai: 15 };
const START = 4; // tiles of safe road before the first section
const END = 9; // the last stretch, with the house

export const tricksFor = (level) => 2 * level;

// Names and hints, picked at random for each level of each game.
const NAMES = [
  'Jalan Pertama', 'Lorong Belakang', 'Jalan Kampung', 'Simpang Sibuk', 'Musim Durian', 'Jalan Taman',
  'Pasar Pagi', 'Jalan Bukit', 'Jalan Pantai', 'Jalan Pulang', 'Lorong Pening', 'Jalan Berliku',
  'Jalan Sungai', 'Jalan Terowong', 'Lorong Misteri', 'Jalan Pusing-Pusing', 'Lorong Kucing', 'Jalan Ke Hulu',
];
const HINTS = [
  'Jalan pulang yang mudah… kan?', 'Jalan pintas. Kononnya lagi cepat.', 'Tenang dan damai. Terlalu tenang.',
  'Semua orang nak cepat hari ni.', 'Bau harum di udara. Musim apa ya?', 'Banyak pokok, banyak burung.',
  'Ramai, bising, meriah.', 'Naik bukit, turun bukit. Penat!', 'Pokok kelapa sepanjang jalan.',
  'Jangan lupa bawa kunci rumah!', 'Pusing kiri, pusing kanan…', 'Kadang-kadang, kena patah balik.',
  'Ke depan belum tentu betul.', 'Ada sesuatu di belakang tadi…', 'Hati-hati. Jalan ni suka bergurau.',
];

/** The ground a section can have, and which tricks suit it. */
const GROUNDS = ['datar', 'datar', 'datar', 'terowong', 'terowong', 'sungai', 'sungai', 'bukit', 'longkang', 'palsu', 'tangga'];
// The tricks each ground can have, by what they make you do. Most make you turn back (BALIK) or
// mess with your head (PENING); fewer can be beaten by just jumping (LOMPAT).
const TRICKS = {
  datar: {
    balik: ['pagar', 'jentolak', 'pagar'],
    pening: ['peningPaku', 'peningLubang'],
    jangan: ['wayar', 'burungTinggi', 'rumahPalsu', 'pancut'],
    lompat: ['runtuh', 'paku', 'tembok', 'bonggol', 'lori', 'motor', 'kucing', 'bola', 'burungRendah', 'durian', 'kelapa', 'papan', 'pokok', 'tiang'],
  },
  longkang: { pening: ['pening'], lompat: ['pakuSeberang', 'runtuhSeberang', 'durianSeberang', 'burungRendah'] },
  palsu: { pening: ['pening'], lompat: ['pakuSeberang', 'durianSeberang', 'kucing'] },
  tangga: { jangan: ['burungTinggi'], lompat: ['runtuhTangga', 'pakuTangga', 'kelapa'] },
  bukit: { balik: ['batuGolek', 'bukitRuntuh'], lompat: ['pakuBukit'] },
  terowong: { balik: ['terowongTutup', 'terowongKurung', 'terowongMotor'] },
  sungai: { balik: ['jambatanBalik', 'jambatanBalik', 'jambatanRuntuh', 'jambatanSemua'], pening: ['jambatanKejar'], jangan: ['buaya'] },
};
const MIX = { balik: 0.5, pening: 0.17, jangan: 0.2, lompat: 0.13 };

/** A trick for a section of ground `g`: a kind of response picked by MIX, then a trick of it. */
function pickTrick(g, rng) {
  const kinds = Object.entries(TRICKS[g]);
  let x = rng() * kinds.reduce((n, [k]) => n + MIX[k], 0);
  for (const [k, list] of kinds) {
    x -= MIX[k];
    if (x < 0) return pick(rng, list);
  }
  return pick(rng, kinds[0][1]);
}

/**
 * Ledges up both sides of a tunnel's hill (section at a), for climbing over it whichever way
 * you're going: the front for going on, the back for coming back (say, for a key).
 */
const CLIMB = (a) => [[a + 1, 8], [a + 2, 8], [a + 3, 6], [a + 4, 6], [a + 12, 6], [a + 13, 6], [a + 14, 8]];

/** Hill heights (tiles above the road) at each offset into a 'bukit' section. */
const HILL = { 2: 1, 3: 2, 4: 3, 5: 4, 6: 4, 7: 4, 8: 4, 9: 3, 10: 2, 11: 1 };

const pick = (rng, list) => list[Math.floor(rng() * list.length)];

/**
 * The ground of level `n` (1-based): the sections, the map rows, and the scenery. The tricks
 * come separately from rollTraps().
 */
export function buildGround(n, rng = Math.random) {
  const count = tricksFor(n);
  const sections = [];
  let at = START;
  for (let i = 0; i < count; i++) {
    const ground = pick(rng, GROUNDS);
    sections.push({ x: at, ground });
    at += WIDTH[ground];
  }
  const w = at + END;
  const map = Array.from({ length: H }, () => Array(w).fill('.'));
  for (let x = 0; x < w; x++) map[10][x] = map[11][x] = '#';
  for (const { x, ground } of sections) {
    if (ground === 'longkang') {
      for (const dx of [4, 5]) [map[10][x + dx], map[11][x + dx]] = ['.', '~'];
    } else if (ground === 'palsu') {
      for (const dx of [4, 5]) [map[10][x + dx], map[11][x + dx]] = ['=', '~'];
    } else if (ground === 'tangga') {
      for (const dx of [3, 4, 5]) map[8][x + dx] = map[9][x + dx] = '#';
    } else if (ground === 'bukit') {
      for (const [dx, hgt] of Object.entries(HILL)) for (let y = 10 - hgt; y <= 9; y++) map[y][x + Number(dx)] = 'H';
    } else if (ground === 'terowong') {
      // A hill 6 high with a tunnel through its foot. (Ledges to climb it only appear when a
      // trick makes them needed.)
      for (let dx = 5; dx <= 11; dx++) for (let y = 4; y <= 8; y++) map[y][x + dx] = 'H';
    } else if (ground === 'sungai') {
      // A river under a bridge. (Ledges over it only appear when a trick springs.)
      for (let dx = 3; dx <= 10; dx++) [map[10][x + dx], map[11][x + dx]] = ['B', '~'];
    }
  }
  map[9][1] = 'S';
  map[9][w - 3] = 'E';
  // Scenery: trees, palms and lamp posts behind the road.
  const decor = [];
  for (let x = 2; x < w - 2; x += 3 + Math.floor(rng() * 4)) decor.push({ kind: pick(rng, ['pokok', 'kelapa', 'lampu', 'pokok']), x: x + rng() });
  return { n, name: pick(rng, NAMES), hint: pick(rng, HINTS), w, sections, map: map.map((r) => r.join('')), decor };
}

/** The trap(s) for one section starting at `a`, trick `kind`, on level `n`. */
function trapsFor(kind, a, n, rng) {
  const fast = (base, step) => base + step * (n - 1);
  const side = () => (rng() < 0.5 ? 'right' : 'left');
  switch (kind) {
    case 'runtuh':
      return [{ type: 'runtuh', at: [a + 3.6, a + 4.2], tiles: [[a + 5, 10], [a + 6, 10], [a + 5, 11], [a + 6, 11]] }];
    case 'paku':
      return [{ type: 'paku', at: [a + 3.6, a + 4.2], tiles: [[a + 5, 9], [a + 6, 9]] }];
    case 'tembok':
      return [{ type: 'tembok', at: [a + 4.6, a + 5.1], tiles: [[a + 6, 8], [a + 6, 9]] }];
    case 'bonggol':
      return [{ type: 'tembok', at: [a + 3.7, a + 4.2], tiles: [[a + 5, 9]] }];
    case 'lori':
      return [{ type: 'lori', at: [a + 2, a + 3], row: 9, from: rng() < 0.75 ? 'right' : 'left', speed: fast(12, 0.5) }];
    case 'motor':
      return [{ type: 'motor', at: [a + 2, a + 3], row: 9, from: side(), speed: fast(14, 0.6) }];
    case 'kucing':
      return [{ type: 'kucing', at: [a + 1.5, a + 2.5], row: 9, from: 'left', speed: fast(13, 0.4) }];
    case 'bola':
      return [{ type: 'bola', at: [a + 2, a + 3], row: 9, speed: fast(6, 0.3) }];
    case 'burungRendah':
      return [{ type: 'burung', at: [a + 1.5, a + 2.5], y: 9.35, speed: fast(9, 0.5) }];
    case 'burungTinggi':
      return [{ type: 'burung', at: [a + 1.5, a + 2.5], y: 8.02, speed: fast(9, 0.5) }];
    case 'durian':
    case 'kelapa':
      return [{ type: kind, at: [a + 4.1, a + 4.6], x: a + 5.8 + rng() * 0.4, y0: 5.5, speed: 8 }];
    case 'papan':
      return [{ type: 'papan', at: [a + 4, a + 4.6], x: a + 5.2, y0: 5.5, speed: 8 }];
    case 'pokok':
    case 'tiang':
      return [{ type: kind, at: [a + 3.6, a + 4.1], x: a + 5, row: 9 }];
    case 'jentolak':
      return [{ type: 'jentolak', at: [a + 3.4, a + 4], row: 9, speed: fast(5, 0.2), time: 1.3 }];
    case 'pancut':
      return [{ type: 'pancut', at: [a + 3.6, a + 4.2], x: a + 5, row: 9, on: 0.8, off: 0.9, bursts: 3 }];
    case 'wayar':
      return [{ type: 'wayar', at: [a + 3.2, a + 3.8], x: a + 4, w: 4.5, row: 9 }];
    case 'rumahPalsu':
      return [{ type: 'rumahPalsu', at: [a + 5, a + 5.6], house: a + 5.5, tiles: [[a + 5, 10], [a + 6, 10], [a + 7, 10], [a + 5, 11], [a + 6, 11], [a + 7, 11]] }];
    case 'pening':
      return [{ type: 'pening', at: [a + 2.8, a + 3.4], time: 3 }];
    // Dizzy on the open road, with something nasty just ahead: left is right, right is left.
    case 'peningPaku':
      return [{ type: 'pening', at: [a + 1.5, a + 2.1], time: 3 }, { type: 'paku', at: [a + 3.2, a + 3.8], tiles: [[a + 5, 9], [a + 6, 9]] }];
    case 'peningLubang':
      return [{ type: 'pening', at: [a + 1.5, a + 2.1], time: 3 }, { type: 'runtuh', at: [a + 3.2, a + 3.8], tiles: [[a + 5, 10], [a + 6, 10], [a + 5, 11], [a + 6, 11]] }];
    case 'pagar': {
      // A gate too tall to jump comes down ahead; the switch to open it is just behind you.
      const gate = [[a + 6, 6], [a + 6, 7], [a + 6, 8], [a + 6, 9]];
      const id = `pagar${a}`;
      return [
        { type: 'tembok', id, at: [a + 4.2, a + 4.8], tiles: gate },
        { type: 'suis', needs: id, at: [a + 0.6, a + 1.6], x: a + 1.1, tiles: gate },
      ];
    }
    // In a tunnel (a+5..a+11). The ledges up the hill's front only appear with the trick.
    case 'terowongTutup':
      return [
        { type: 'tembok', at: [a + 3.9, a + 4.4], rows: [8.5, 10], tiles: [[a + 5, 9]] },
        { type: 'muncul', at: [a + 3.9, a + 4.4], rows: [8.5, 10], tiles: CLIMB(a) },
      ];
    case 'terowongKurung':
      return [
        { type: 'tembok', at: [a + 9.8, a + 10.4], rows: [8.5, 10], tiles: [[a + 11, 9]] },
        { type: 'muncul', at: [a + 9.8, a + 10.4], rows: [8.5, 10], tiles: CLIMB(a) },
      ];
    case 'terowongMotor':
      // A motorbike roars through the tunnel at you: get back out, then jump it.
      return [{ type: 'motor', at: [a + 6.5, a + 7.2], rows: [8.5, 10], row: 9, from: 'right', speed: fast(10, 0.4) }];
    // At a river (bridge a+3..a+10). Ledges over it only pop up as the bridge goes.
    case 'jambatanRuntuh':
      // The far half drops: jump up to ledges that appear above.
      return [
        { type: 'runtuh', at: [a + 5.6, a + 6.2], rows: [8.5, 10], tiles: [7, 8, 9, 10].map((dx) => [a + dx, 10]) },
        { type: 'muncul', at: [a + 5.6, a + 6.2], rows: [8.5, 10], tiles: [6, 7, 10, 11].map((dx) => [a + dx, 8]) },
      ];
    case 'jambatanBalik':
      // It drops just ahead of you, and the only way across starts back on the bank: run back.
      return [
        { type: 'runtuh', at: [a + 5.3, a + 5.8], rows: [8.5, 10], tiles: [6, 7, 8, 9, 10].map((dx) => [a + dx, 10]) },
        { type: 'muncul', at: [a + 5.3, a + 5.8], rows: [8.5, 10], tiles: [2, 3, 6, 7, 10, 11].map((dx) => [a + dx, 8]) },
      ];
    case 'jambatanSemua':
      // The whole bridge goes a moment after you're on it: leap for the ledges that pop up.
      return [
        { type: 'runtuh', at: [a + 3.8, a + 4.4], rows: [8.5, 10], delay: 0.35, tiles: [3, 4, 5, 6, 7, 8, 9, 10].map((dx) => [a + dx, 10]) },
        { type: 'muncul', at: [a + 3.8, a + 4.4], rows: [8.5, 10], delay: 0.35, tiles: [5, 6, 9, 10].map((dx) => [a + dx, 8]) },
      ];
    case 'jambatanKejar':
      // The planks drop one by one behind you: don't stop!
      return [3, 4, 5, 6, 7, 8, 9, 10].map((dx, i) => ({ type: 'runtuh', at: [a + 3.6, a + 4.3], rows: [8.5, 10], delay: 0.1 + i * 0.16, tiles: [[a + dx, 10]] }));
    case 'buaya':
      return [{ type: 'buaya', at: [a + 2.6, a + 3.4], x: a + 6, row: 10, on: 0.7, off: 1.1, bursts: 4 }];
    // On a hill (top at a+5..a+8, 4 up).
    case 'batuGolek':
      return [{ type: 'batu', at: [a + 1.5, a + 2.5], x: a + 9, y: 4.7, speed: fast(3.5, 0.15) }];
    case 'bukitRuntuh':
      return [{ type: 'runtuh', at: [a + 5.3, a + 6], rows: [3, 6.5], delay: 0.1, tiles: [7, 8].flatMap((dx) => [6, 7, 8, 9, 10, 11].map((y) => [a + dx, y])) }];
    case 'pakuBukit':
      return [{ type: 'paku', at: [a + 5, a + 5.8], rows: [3, 6.5], tiles: [[a + 7, 5]] }];
    // On an open (or fake) drain at a+4..a+5: something waits on the far side.
    case 'pakuSeberang':
      return [{ type: 'paku', at: [a + 3.7, a + 4.5], tiles: [[a + 6, 9]] }];
    case 'runtuhSeberang':
      return [{ type: 'runtuh', at: [a + 6, a + 7.5], delay: 0.12, tiles: [[a + 6, 10], [a + 7, 10], [a + 6, 11], [a + 7, 11]] }];
    case 'durianSeberang':
      return [{ type: 'durian', at: [a + 3.9, a + 4.7], x: a + 6.2, y0: 5.5, speed: 8 }];
    // On a raised step at a+3..a+5: the far side caves in, or nails wait on top.
    case 'runtuhTangga':
      return [{ type: 'runtuh', at: [a + 3, a + 5.5], rows: [7, 8.5], tiles: [[a + 6, 10], [a + 7, 10], [a + 6, 11], [a + 7, 11]] }];
    case 'pakuTangga':
      return [{ type: 'paku', at: [a + 3.8, a + 4.4], rows: [6.5, 8.5], tiles: [[a + 5, 7]] }];
    default:
      return [];
  }
}

/**
 * Rolls the tricks for `ground` (from buildGround): one per section, picked at random from what
 * suits its ground, plus sometimes the house running off at the end. Returns a level definition
 * for parseLevel().
 */
export function rollTraps(ground, rng = Math.random) {
  const traps = [];
  const kinds = [];
  for (const { x, ground: g } of ground.sections) {
    const kind = pickTrick(g, rng);
    kinds.push(kind);
    traps.push(...trapsFor(kind, x, ground.n, rng));
  }
  // At the end: the house may run off, at the very last moment, to the other end of the last
  // stretch.
  const end = ground.w - END;
  const last = rng();
  if (last < 0.3) traps.push({ type: 'pintu', at: [ground.w - 4.2, ground.w - 3.6], to: [end + 1, 9] });
  else if (last < 0.8) {
    // The house is locked, and the key lies far back down the road: on the road, a bridge or a
    // hilltop, somewhere no trick changes.
    const touched = new Set(traps.flatMap((t) => (t.tiles ?? []).map(([x]) => x)));
    const spots = [];
    for (let x = Math.max(2, ground.w - 35); x <= ground.w - 14; x++) {
      if (touched.has(x)) continue;
      let y = 0;
      while (y < 12 && !'#HB'.includes(ground.map[y][x])) y++;
      // Only where you can always get to: the road, a bridge, a step or a plain hill; never the
      // top of a tunnel's hill (y 4), which may have no way up.
      if (y >= 6 && y < 12 && ground.map[y - 1][x] === '.') spots.push([x, y - 1]);
    }
    if (spots.length) traps.push({ type: 'kunci', at: [ground.w - 4.2, ground.w - 3.6], key: pick(rng, spots) });
  }
  return { name: ground.name, hint: ground.hint, map: ground.map, traps, decor: ground.decor, kinds };
}
