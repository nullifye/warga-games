// Jalan: the rules of a level, with no drawing or DOM, so tests can run them.
//
// A level is a grid of tiles (any width, H high), in tile units: x to the right, y down. The
// player runs and jumps from the start to the house. Traps wait for the player to reach a
// trigger, then (after a delay) spring: the road caves in, nails pop up, a lorry or motorbike
// races through, a bird swoops, a tree falls across the road, a durian, coconut or signboard
// drops, a wall rises, the house runs off. Some tricks need something other than a jump: a
// bulldozer too tall to jump drives at you (back away, then wait), a water jet spurts on and off
// (stop, then dash through a gap), a live wire sags over the road (don't jump), a fake house
// waits mid-level (don't touch it), and a dizzy spell swaps left and right. The road itself
// climbs hills (H), runs through tunnels and crosses rivers on bridges (B); a tunnel's gate can
// slam shut (go back and climb over), a bridge can give way, a crocodile leaps over it (wait),
// a boulder rolls down a hill, and a tall gate only opens from a switch you've just passed.
// At the end the house may be locked: its key then appears somewhere far back down the road. A death puts the player back at the start; the page
// then gives the level freshly rolled traps (gen.js), so the road can't simply be learnt.

export const H = 12;
export const DT = 1 / 60; // the simulation's fixed step
export const PLAYER = { w: 0.7, h: 0.9 };
const RUN = 7.5; // tiles per second
const GRAVITY = 80;
const HOLD = 0.6; // gravity while the jump is held and rising
const JUMP = 17;
const MAX_FALL = 25;
const COYOTE = 0.08; // seconds after leaving an edge a jump still works
const BUFFER = 0.1; // seconds a jump pressed just before landing still counts

/** Sizes of the things that move: width, height (tiles). */
export const SIZES = {
  lori: { w: 3.2, h: 1.6 },
  motor: { w: 1.6, h: 1.1 },
  kucing: { w: 0.85, h: 0.6 },
  bola: { w: 0.7, h: 0.7 },
  burung: { w: 0.9, h: 0.55 },
  durian: { w: 0.7, h: 0.7 },
  kelapa: { w: 0.6, h: 0.6 },
  papan: { w: 2, h: 0.5 },
  jentolak: { w: 3, h: 3.4 },
  batu: { w: 1.2, h: 1.2 },
  buaya: { w: 1.3, h: 1.4 },
};

/**
 * Builds a level from { name, hint, map: [H strings, all the same length], traps, decor }.
 * Map chars: '#' road, '.' air, 'S' start, 'E' the house, '^' nails, '~' drain water,
 * '=' a fake road tile (drawn like road, but nothing holds you up).
 */
export function parseLevel(def) {
  const grid = def.map.map((row) => [...row]);
  const w = grid[0]?.length ?? 0;
  if (grid.length !== H || grid.some((row) => row.length !== w)) throw new Error(`${def.name}: the map must be ${H} rows of equal length`);
  let start = null;
  let exit = null;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < w; x++) {
      if (grid[y][x] === 'S') [start, grid[y][x]] = [{ x, y }, '.'];
      if (grid[y][x] === 'E') [exit, grid[y][x]] = [{ x, y }, '.'];
    }
  }
  if (!start || !exit) throw new Error(`${def.name}: needs an S and an E`);
  return { name: def.name, hint: def.hint ?? '', w, grid, start, exit, traps: def.traps ?? [], decor: def.decor ?? [] };
}

/** A fresh attempt at `level`: the player at the start, every trap waiting. */
export function createAttempt(level) {
  return {
    level,
    w: level.w,
    grid: level.grid.map((row) => [...row]),
    x: level.start.x + (1 - PLAYER.w) / 2,
    y: level.start.y + 1 - PLAYER.h,
    vx: 0, vy: 0, ground: true, coyote: 0, buffer: 0, facing: 1, dizzy: 0,
    locked: false, key: null, // the house locked, and where its key lies
    t: 0,
    exit: { ...level.exit },
    traps: level.traps.map((def) => ({ def, setAt: null, done: false })),
    hazards: [], // things that kill on touch: { kind, x, y, w, h, vx, vy, falls?, life? }
    debris: [], // road falling away, for drawing: { x, y, vy }
    fallen: [], // trees that came down, for drawing: { x }
    dead: null, won: false,
  };
}

const solidChar = (c) => c === '#' || c === 'W' || c === 'L' || c === 'H' || c === 'B';

/** Is the tile at (tx, ty) something to stand on or bump into? */
export function solidAt(s, tx, ty) {
  if (tx < 0 || tx >= s.w) return true; // the ends of the level are walls
  if (ty < 0 || ty >= H) return false; // open above, and a fall below
  return solidChar(s.grid[ty][tx]);
}

function overlapsSolid(s, x, y, w, h) {
  for (let ty = Math.floor(y); ty <= Math.floor(y + h - 1e-6); ty++) {
    for (let tx = Math.floor(x); tx <= Math.floor(x + w - 1e-6); tx++) if (solidAt(s, tx, ty)) return true;
  }
  return false;
}

const hit = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

/** The player's box. */
export const body = (s) => ({ x: s.x, y: s.y, w: PLAYER.w, h: PLAYER.h });

/** The house: what the player must touch to finish. */
export const exitBox = (s) => ({ x: s.exit.x + 0.15, y: s.exit.y + 0.1, w: 0.7, h: 0.9 });

/** Everything that kills on touch right now, near x (static nails and drains, and hazards). */
export function deadly(s, near = null) {
  const out = [];
  const x0 = near == null ? 0 : Math.max(0, Math.floor(near) - 2);
  const x1 = near == null ? s.w - 1 : Math.min(s.w - 1, Math.floor(near) + 2);
  for (let y = 0; y < H; y++) {
    for (let x = x0; x <= x1; x++) {
      const c = s.grid[y][x];
      if (c === '^') out.push({ kind: 'paku', x: x + 0.15, y: y + 0.55, w: 0.7, h: 0.45 });
      if (c === '~') out.push({ kind: 'longkang', x, y: y + 0.3, w: 1, h: 0.7 });
    }
  }
  return out.concat(s.hazards.filter((h) => !h.harmless));
}

function fire(s, def, ev) {
  ev.push({ type: 'trap', trap: def.type });
  const size = SIZES[def.type];
  switch (def.type) {
    case 'runtuh':
      for (const [x, y] of def.tiles) {
        if (solidChar(s.grid[y][x])) s.debris.push({ x, y, vy: 0 });
        s.grid[y][x] = '.';
      }
      break;
    case 'paku':
      for (const [x, y] of def.tiles) s.grid[y][x] = '^';
      break;
    case 'tembok':
      for (const [x, y] of def.tiles) if (!hit(body(s), { x, y, w: 1, h: 1 })) s.grid[y][x] = 'W';
      break;
    case 'muncul':
      // A way out pops up only now: ledges that weren't there before.
      for (const [x, y] of def.tiles) if (!hit(body(s), { x, y, w: 1, h: 1 })) s.grid[y][x] = '#';
      break;
    case 'lori':
    case 'motor':
    case 'kucing': {
      // From off the side of the screen, along the road at `row` (a cat comes from behind).
      const fromLeft = def.from === 'left';
      const x = fromLeft ? s.x - 5 - size.w : s.x + 6;
      s.hazards.push({ kind: def.type, x, y: def.row + 1 - size.h, w: size.w, h: size.h, vx: (fromLeft ? 1 : -1) * def.speed, vy: 0 });
      break;
    }
    case 'burung':
      // A bird swoops in from ahead at `y` (low: jump it; high: don't jump into it).
      s.hazards.push({ kind: 'burung', x: s.x + 6, y: def.y, w: size.w, h: size.h, vx: -def.speed, vy: 0 });
      break;
    case 'bola':
      // A ball bouncing toward the player along the road.
      s.hazards.push({ kind: 'bola', x: s.x + 6, y: def.row + 1 - size.h - 1.5, w: size.w, h: size.h, vx: -def.speed, vy: 0, bounce: true });
      break;
    case 'durian':
    case 'kelapa':
    case 'papan':
      // It drops from just above the runner's head, not from the top of the sky.
      s.hazards.push({ kind: def.type, x: def.x, y: def.y0 ?? -1, w: size.w, h: size.h, vx: 0, vy: def.speed ?? 0, falls: true });
      break;
    case 'pokok':
    case 'tiang':
      // A tree or a lamp post crashes down across the road (deadly while it falls), then lies
      // there to be jumped.
      s.hazards.push({ kind: def.type, x: def.x + 0.2, y: def.row - 1.6, w: 2.8, h: 2.6, vx: 0, vy: 0, life: 0.3, log: def });
      break;
    case 'pintu':
      s.exit = { x: def.to[0], y: def.to[1] };
      break;
    case 'jentolak':
      // A bulldozer, too tall to jump, drives at the runner, stops, then reverses away.
      s.hazards.push({ kind: 'jentolak', x: s.x + 6, y: def.row + 1 - size.h, w: size.w, h: size.h, vx: -def.speed, vy: 0, drive: def.time });
      break;
    case 'pancut':
      // A water jet from a grate: on, off, on, off… then it stops for good.
      s.hazards.push({ kind: 'pancut', x: def.x + 0.1, y: def.row - 5, w: 0.8, h: 6, vx: 0, vy: 0, stay: true, on: true, timer: def.on, bursts: def.bursts, onTime: def.on, offTime: def.off });
      break;
    case 'wayar':
      // A live wire sags over the road at head height for a jumper: walk under it.
      s.hazards.push({ kind: 'wayar', x: def.x, y: def.row - 1.65, w: def.w, h: 0.75, vx: 0, vy: 0, stay: true });
      break;
    case 'rumahPalsu':
      // The fake house: the road under it caves in.
      for (const [x, y] of def.tiles) {
        if (solidChar(s.grid[y][x])) s.debris.push({ x, y, vy: 0 });
        s.grid[y][x] = '.';
      }
      break;
    case 'pening':
      s.dizzy = def.time;
      break;
    case 'kunci':
      s.locked = true;
      s.key = { x: def.key[0], y: def.key[1] };
      break;
    case 'suis':
      // The switch: the gate it belongs to opens.
      for (const [x, y] of def.tiles) if (s.grid[y][x] === 'W') s.grid[y][x] = '.';
      break;
    case 'buaya':
      // A crocodile leaps up over the bridge, again and again: wait for it to drop back.
      s.hazards.push({ kind: 'buaya', x: def.x + 0.1, y: def.row - size.h, w: size.w, h: size.h, vx: 0, vy: 0, stay: true, on: true, timer: def.on, bursts: def.bursts, onTime: def.on, offTime: def.off });
      break;
    case 'batu':
      // A boulder rolls down the hill toward the runner.
      s.hazards.push({ kind: 'batu', x: def.x, y: def.y, w: size.w, h: size.h, vx: -def.speed, vy: 0, bounce: true, bounceV: -6 });
      break;
  }
}

function moveHazards(s) {
  s.hazards = s.hazards.filter((h) => {
    if (h.falls) {
      h.vy = Math.min(MAX_FALL, h.vy + GRAVITY * 0.75 * DT);
      h.y += h.vy * DT;
      // It stops on the road and lies there harmless, for a moment.
      if (!h.harmless && overlapsSolid(s, h.x, h.y + h.h, h.w, 0.01)) {
        h.harmless = true;
        h.vy = 0;
        h.life = 0.6;
      }
      if (h.harmless) {
        h.vy = 0;
        h.life -= DT;
        return h.life > 0;
      }
      return h.y < H + 1;
    }
    if (h.bounce) {
      h.vy = Math.min(MAX_FALL, h.vy + GRAVITY * 0.75 * DT);
      h.x += h.vx * DT;
      h.y += h.vy * DT;
      if (h.vy > 0 && overlapsSolid(s, h.x, h.y + h.h, h.w, 0.01)) {
        h.y = Math.ceil(h.y + h.h) - h.h - 0.01;
        h.vy = h.bounceV ?? -11; // a ball bounces about two tiles high; a boulder lower
      }
      return h.y < H + 1 && h.x > s.x - 20;
    }
    if (h.kind === 'jentolak') {
      h.drive -= DT;
      if (h.drive <= 0 && h.vx < 0) h.vx = 9; // and back it goes
      h.x += h.vx * DT;
      return h.x < s.x + 25;
    }
    if (h.kind === 'pancut' || h.kind === 'buaya') {
      h.timer -= DT;
      if (h.timer <= 0) {
        h.on = !h.on;
        h.timer = h.on ? h.onTime : h.offTime;
        if (h.on) h.bursts -= 1;
      }
      h.harmless = !h.on;
      return h.bursts > 0 || h.on;
    }
    if (h.stay) return true;
    if (h.life != null) {
      h.life -= DT;
      if (h.life > 0) return true;
      if (h.log) {
        for (let x = h.log.x; x < h.log.x + 3; x++) if (s.grid[h.log.row][x] === '.') s.grid[h.log.row][x] = 'L';
        s.fallen.push({ x: h.log.x, row: h.log.row, kind: h.kind });
      }
      return false;
    }
    h.x += h.vx * DT;
    return h.x > s.x - 20 && h.x < s.x + 20;
  });
  s.debris = s.debris.filter((d) => {
    d.vy += GRAVITY * DT;
    d.y += d.vy * DT;
    return d.y < H + 2;
  });
}

/**
 * Moves the attempt on by one step (DT). `input`: { left, right, jump (held), jumpPressed (this
 * step) }. Returns what happened: [{ type: 'jump' | 'land' | 'trap' | 'die' | 'win', … }].
 */
export function step(s, input = {}) {
  const ev = [];
  if (s.dead || s.won) return ev;
  s.t += DT;

  // Traps: set off by where the player is, then fire after their delay.
  const cx = s.x + PLAYER.w / 2;
  const cy = s.y + PLAYER.h / 2;
  for (const trap of s.traps) {
    if (trap.done) continue;
    // A switch only works once the gate it opens has come down.
    if (trap.def.needs && !s.traps.some((o) => o.def.id === trap.def.needs && o.done)) continue;
    const { at, rows } = trap.def;
    if (trap.setAt == null && cx >= at[0] && cx <= at[1] && (!rows || (cy >= rows[0] && cy <= rows[1]))) trap.setAt = s.t;
    if (trap.setAt != null && s.t - trap.setAt >= (trap.def.delay ?? 0)) {
      trap.done = true;
      fire(s, trap.def, ev);
    }
  }

  // Running (left and right swapped while dizzy).
  s.dizzy = Math.max(0, s.dizzy - DT);
  const dir = ((input.right ? 1 : 0) - (input.left ? 1 : 0)) * (s.dizzy > 0 ? -1 : 1);
  if (dir) s.facing = dir;
  s.vx += (dir * RUN - s.vx) * Math.min(1, DT * (s.ground ? 22 : 12));
  // Jumping: a press is remembered a moment, and the edge forgives a moment.
  s.buffer = input.jumpPressed ? BUFFER : Math.max(0, s.buffer - DT);
  s.coyote = s.ground ? COYOTE : Math.max(0, s.coyote - DT);
  if (s.buffer > 0 && s.coyote > 0) {
    s.vy = -JUMP;
    s.buffer = 0;
    s.coyote = 0;
    s.ground = false;
    ev.push({ type: 'jump' });
  }
  const g = s.vy < 0 && input.jump ? GRAVITY * HOLD : GRAVITY;
  s.vy = Math.min(MAX_FALL, s.vy + g * DT);

  // Move across, then up or down, stopping at solid road.
  const nx = s.x + s.vx * DT;
  if (!overlapsSolid(s, nx, s.y, PLAYER.w, PLAYER.h)) s.x = nx;
  else {
    s.x = s.vx > 0 ? Math.ceil(s.x + PLAYER.w) - PLAYER.w - 1e-4 : Math.floor(s.x) + 1e-4;
    s.vx = 0;
  }
  const ny = s.y + s.vy * DT;
  const wasGround = s.ground;
  s.ground = false;
  if (!overlapsSolid(s, s.x, ny, PLAYER.w, PLAYER.h)) s.y = ny;
  else if (s.vy > 0) {
    s.y = Math.ceil(s.y + PLAYER.h) - PLAYER.h - 1e-4;
    s.vy = 0;
    s.ground = true;
    if (!wasGround) ev.push({ type: 'land' });
  } else {
    s.y = Math.floor(s.y) + 1e-4;
    s.vy = 0;
  }
  // Standing still on a road that has just gone: fall.
  if (s.ground && !overlapsSolid(s, s.x, s.y + PLAYER.h + 0.02, PLAYER.w, 0.01)) s.ground = false;

  moveHazards(s);

  const me = body(s);
  if (s.y > H + 0.5) {
    s.dead = 'lubang';
  } else {
    for (const d of deadly(s, s.x)) {
      if (hit(me, d)) {
        s.dead = d.kind;
        break;
      }
    }
  }
  if (!s.dead && s.key && hit(me, { x: s.key.x + 0.2, y: s.key.y + 0.2, w: 0.6, h: 0.7 })) {
    s.key = null;
    s.locked = false;
    ev.push({ type: 'kunciDapat' });
  }
  if (s.dead) ev.push({ type: 'die', cause: s.dead });
  else if (!s.locked && hit(me, exitBox(s))) {
    s.won = true;
    ev.push({ type: 'win' });
  }
  return ev;
}

/** Points for a level finished in `seconds` with `deaths` deaths: longer levels are worth more. */
export const levelPoints = (seconds, deaths, length = 40) =>
  Math.max(100, Math.round(length * 25 - deaths * 60 - seconds * 6));
