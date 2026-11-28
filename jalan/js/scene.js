// Jalan's drawing on a 2D canvas: a sunny town behind, the road, the scenery, the
// tricks, the house and the little runner in a songkok. The camera follows the runner.
import { H, PLAYER, exitBox } from './road.js';
import { mulberry32 } from '../../shared/rng.js';

const TAU = Math.PI * 2;

const CLOUDS = (() => {
  const rng = mulberry32(3);
  return Array.from({ length: 5 }, () => ({ x: rng() * 1.2, y: 0.05 + rng() * 0.25, s: 0.6 + rng() * 0.8, v: 0.004 + rng() * 0.006 }));
})();

// Buildings far behind (they scroll slower than the road).
const TOWN = (() => {
  const rng = mulberry32(8);
  const out = [];
  for (let x = -2; x < 260; x += 1 + rng() * 1.6) out.push({ x, w: 1 + rng() * 1.4, h: 2 + rng() * 4.5, hue: Math.floor(rng() * 4) });
  return out;
})();

/** Particle effects and words, kept by the page across frames. */
export function createFx() {
  return { bits: [], words: [], shake: 0 };
}

export function burst(fx, x, y, color, n = 18) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * TAU;
    const v = 2 + Math.random() * 6;
    fx.bits.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 4, life: 0, max: 0.6 + Math.random() * 0.4, color, size: 0.08 + Math.random() * 0.1 });
  }
}

export function say(fx, x, y, text, color = '#fff') {
  fx.words.push({ x, y, text, color, t: 0 });
}

/**
 * The tile size and offset for `view` ({ w, h } CSS px): about 12 tiles across on a phone, the
 * camera on the runner, the road at the bottom.
 */
export function layout(view, s) {
  const ts = Math.floor(Math.min(view.w / 12, view.h / H));
  const span = ts * s.w;
  let ox;
  if (span <= view.w) ox = Math.floor((view.w - span) / 2);
  else {
    const px = (s.x + PLAYER.w / 2) * ts;
    ox = Math.round(Math.min(0, Math.max(view.w - span, view.w * 0.4 - px)));
  }
  return { ts, ox, oy: Math.floor(view.h - ts * H) };
}

const isRoad = (c) => c === '#' || c === '=';

function drawTile(ctx, s, x, y, ts, t) {
  const c = s.grid[y][x];
  const px = x * ts;
  const py = y * ts;
  if (isRoad(c)) {
    const above = y > 0 ? s.grid[y - 1][x] : '.';
    const top = !isRoad(above);
    if (y < 10) {
      // A raised concrete step.
      ctx.fillStyle = '#9aa3ad';
      ctx.fillRect(px, py, ts, ts);
      ctx.fillStyle = 'rgba(255,255,255,0.25)';
      if (top) ctx.fillRect(px, py, ts, ts * 0.14);
      ctx.fillStyle = 'rgba(0,0,0,0.12)';
      ctx.fillRect(px, py + ts * 0.9, ts, ts * 0.1);
    } else if (top) {
      ctx.fillStyle = '#3d4148';
      ctx.fillRect(px, py, ts, ts);
      ctx.fillStyle = '#555a62';
      ctx.fillRect(px, py, ts, ts * 0.18);
      if (x % 2 === 0) {
        ctx.fillStyle = 'rgba(255,255,255,0.85)';
        ctx.fillRect(px + ts * 0.2, py + ts * 0.42, ts * 0.6, ts * 0.1);
      }
    } else {
      ctx.fillStyle = (x + y) % 2 ? '#7a5532' : '#6f4c2c';
      ctx.fillRect(px, py, ts, ts);
    }
    // A fake patch ('=') looks exactly like road. No hints.
  } else if (c === 'H') {
    // Hill: earth, with grass on top.
    const above = y > 0 ? s.grid[y - 1][x] : '.';
    ctx.fillStyle = (x + y) % 2 ? '#7d5a36' : '#74532f';
    ctx.fillRect(px, py, ts, ts);
    if (above !== 'H') {
      ctx.fillStyle = '#4caf50';
      ctx.fillRect(px, py, ts, ts * 0.28);
      ctx.fillStyle = '#66c56a';
      ctx.fillRect(px, py, ts, ts * 0.1);
    }
  } else if (c === 'B') {
    // Bridge planks with a rope rail.
    ctx.fillStyle = '#a8743d';
    ctx.fillRect(px, py, ts, ts * 0.35);
    ctx.fillStyle = '#7a5226';
    ctx.fillRect(px + ts * 0.46, py, ts * 0.08, ts * 0.35);
    ctx.strokeStyle = '#d9c39a';
    ctx.lineWidth = Math.max(1, ts * 0.05);
    ctx.beginPath();
    ctx.moveTo(px, py - ts * 0.55);
    ctx.quadraticCurveTo(px + ts / 2, py - ts * 0.4, px + ts, py - ts * 0.55);
    ctx.stroke();
    ctx.fillStyle = '#7a5226';
    if (x % 2 === 0) ctx.fillRect(px, py - ts * 0.6, ts * 0.08, ts * 0.6);
  } else if (c === '.' && y > 0 && s.grid[y - 1][x] === 'H') {
    // Inside a tunnel: dark, with a lamp.
    ctx.fillStyle = '#2a2320';
    ctx.fillRect(px, py, ts, ts);
    if (x % 3 === 0) {
      ctx.fillStyle = 'rgba(255,214,120,0.8)';
      ctx.beginPath();
      ctx.arc(px + ts / 2, py + ts * 0.15, ts * 0.08, 0, TAU);
      ctx.fill();
    }
  } else if (c === 'W') {
    ctx.fillStyle = '#ff7a1a';
    ctx.fillRect(px + ts * 0.05, py, ts * 0.9, ts);
    ctx.fillStyle = '#fff';
    for (let k = 0; k < 2; k++) ctx.fillRect(px + ts * 0.05, py + ts * (0.15 + k * 0.45), ts * 0.9, ts * 0.18);
  } else if (c === 'L') {
    // A fallen trunk or post lying across the road.
    const post = s.fallen.some((f) => f.kind === 'tiang' && x >= f.x && x < f.x + 3);
    ctx.fillStyle = post ? '#8d99a6' : '#7a4a24';
    ctx.fillRect(px, py + ts * 0.25, ts, ts * 0.75);
    ctx.fillStyle = post ? '#b8c2cc' : '#a0662f';
    ctx.fillRect(px, py + ts * 0.3, ts, ts * 0.15);
  } else if (c === '^') {
    ctx.fillStyle = '#8a6a44';
    ctx.fillRect(px + ts * 0.05, py + ts * 0.82, ts * 0.9, ts * 0.18);
    ctx.fillStyle = '#c9d1d9';
    for (let k = 0; k < 3; k++) {
      const bx = px + ts * (0.12 + k * 0.28);
      ctx.beginPath();
      ctx.moveTo(bx, py + ts * 0.84);
      ctx.lineTo(bx + ts * 0.12, py + ts * 0.5);
      ctx.lineTo(bx + ts * 0.24, py + ts * 0.84);
      ctx.fill();
    }
  } else if (c === '~' && y > 0 && s.grid[y - 1][x] === '=') {
    // Under a fake patch the drain looks like plain earth too: no giveaway at all.
    ctx.fillStyle = (x + y) % 2 ? '#7a5532' : '#6f4c2c';
    ctx.fillRect(px, py, ts, ts);
  } else if (c === '~') {
    ctx.fillStyle = '#2f4f6f';
    ctx.fillRect(px, py, ts, ts);
    ctx.fillStyle = '#4f8fb8';
    ctx.fillRect(px, py + ts * (0.3 + Math.sin(t / 400 + x) * 0.04), ts, ts * 0.12);
  }
}

/** A tree, palm or lamp post standing at x (CSS px) on `base`. */
function tree(ctx, x, base, ts, kind, sway) {
  if (kind === 'kelapa') {
    ctx.strokeStyle = '#8a5a2b';
    ctx.lineWidth = ts * 0.18;
    ctx.beginPath();
    ctx.moveTo(x, base);
    ctx.quadraticCurveTo(x + ts * 0.4, base - ts * 1.6, x + ts * 0.2 + sway, base - ts * 3);
    ctx.stroke();
    ctx.fillStyle = '#3fa34d';
    const tx = x + ts * 0.2 + sway;
    const ty = base - ts * 3;
    for (let i = 0; i < 6; i++) {
      const a = -Math.PI / 2 + (i - 2.5) * 0.55;
      ctx.beginPath();
      ctx.moveTo(tx, ty);
      ctx.quadraticCurveTo(tx + Math.cos(a) * ts * 0.9, ty + Math.sin(a) * ts * 0.9 - ts * 0.2, tx + Math.cos(a) * ts * 1.4, ty + Math.sin(a) * ts * 1.4 + ts * 0.5);
      ctx.quadraticCurveTo(tx + Math.cos(a) * ts * 0.7, ty + Math.sin(a) * ts * 0.7, tx, ty);
      ctx.fill();
    }
    ctx.fillStyle = '#7a5a2a';
    for (const dx of [-0.15, 0.12]) {
      ctx.beginPath();
      ctx.arc(tx + dx * ts, ty + ts * 0.18, ts * 0.15, 0, TAU);
      ctx.fill();
    }
  } else if (kind === 'lampu') {
    ctx.fillStyle = '#5b6570';
    ctx.fillRect(x - ts * 0.06, base - ts * 3, ts * 0.12, ts * 3);
    ctx.fillRect(x - ts * 0.06, base - ts * 3, ts * 0.6, ts * 0.1);
    ctx.fillStyle = '#ffe9a0';
    ctx.beginPath();
    ctx.arc(x + ts * 0.5, base - ts * 2.85, ts * 0.13, 0, TAU);
    ctx.fill();
  } else {
    ctx.fillStyle = '#7a4a24';
    ctx.fillRect(x - ts * 0.12, base - ts * 1.6, ts * 0.24, ts * 1.6);
    ctx.fillStyle = '#3f9a4a';
    for (const [dx, dy, r] of [[0, -2.2, 0.9], [-0.55, -1.7, 0.6], [0.55, -1.75, 0.65], [0.1, -2.8, 0.55]]) {
      ctx.beginPath();
      ctx.arc(x + dx * ts + (dy < -2.5 ? sway : 0), base + dy * ts, r * ts, 0, TAU);
      ctx.fill();
    }
  }
}

function drawHouse(ctx, s, ts, t) {
  const e = exitBox(s);
  houseAt(ctx, (e.x + e.w / 2) * ts, (e.y + e.h) * ts, ts, t);
}

/** A little kampung house standing on `base` (CSS px), centred on cx. */
function houseAt(ctx, cx, base, ts, t) {
  const w = ts * 1.5;
  const h = ts * 1.1;
  ctx.save();
  ctx.translate(cx, base);
  ctx.fillStyle = '#6b4226';
  ctx.fillRect(-w / 2 + ts * 0.1, -ts * 0.2, ts * 0.1, ts * 0.2);
  ctx.fillRect(w / 2 - ts * 0.2, -ts * 0.2, ts * 0.1, ts * 0.2);
  ctx.fillStyle = '#c98b4a';
  ctx.fillRect(-w / 2, -h, w, h - ts * 0.2);
  ctx.fillStyle = '#a0522d';
  ctx.beginPath();
  ctx.moveTo(-w / 2 - ts * 0.15, -h + 1);
  ctx.lineTo(0, -h - ts * 0.6);
  ctx.lineTo(w / 2 + ts * 0.15, -h + 1);
  ctx.fill();
  ctx.fillStyle = '#5b3a1e';
  ctx.fillRect(-ts * 0.2, -h * 0.72, ts * 0.4, h * 0.52);
  ctx.fillStyle = '#ffe08a';
  ctx.fillRect(w / 2 - ts * 0.42, -h * 0.75, ts * 0.25, ts * 0.25);
  const bob = Math.sin(t / 200) * ts * 0.12;
  ctx.fillStyle = '#ffd54a';
  ctx.beginPath();
  ctx.moveTo(0, -h - ts * 0.75 + bob);
  ctx.lineTo(-ts * 0.22, -h - ts * 1.05 + bob);
  ctx.lineTo(ts * 0.22, -h - ts * 1.05 + bob);
  ctx.fill();
  ctx.restore();
}

function drawPlayer(ctx, s, ts, t) {
  const x = (s.x + PLAYER.w / 2) * ts;
  const y = (s.y + PLAYER.h) * ts;
  const running = Math.abs(s.vx) > 0.5 && s.ground;
  const squash = s.ground ? 1 : s.vy < 0 ? 1.12 : 0.95;
  const r = PLAYER.w * ts * 0.55;
  ctx.save();
  ctx.translate(x, y);
  ctx.strokeStyle = '#1f2a44';
  ctx.lineWidth = Math.max(2, ts * 0.1);
  ctx.lineCap = 'round';
  const stride = running ? Math.sin(t / 60) * ts * 0.15 : 0;
  for (const k of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(k * r * 0.35, -r * 0.55);
    ctx.lineTo(k * r * 0.35 + stride * k, 0);
    ctx.stroke();
  }
  ctx.scale(1 / squash, squash);
  ctx.fillStyle = '#2f9e6a';
  ctx.beginPath();
  ctx.ellipse(0, -r * 1.25, r, r * 0.95, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = '#f4c89a';
  ctx.beginPath();
  ctx.arc(0, -r * 1.55, r * 0.62, 0, TAU);
  ctx.fill();
  ctx.fillStyle = '#141414';
  ctx.fillRect(-r * 0.6, -r * 2.25, r * 1.2, r * 0.42);
  ctx.fillStyle = '#ffd54a';
  ctx.fillRect(-r * 0.6, -r * 1.88, r * 1.2, r * 0.06);
  const look = s.facing * r * 0.18;
  if (s.dead) {
    ctx.strokeStyle = '#141414';
    ctx.lineWidth = Math.max(1.5, ts * 0.05);
    for (const k of [-1, 1]) {
      const ex = look + k * r * 0.22;
      ctx.beginPath();
      ctx.moveTo(ex - r * 0.1, -r * 1.65);
      ctx.lineTo(ex + r * 0.1, -r * 1.45);
      ctx.moveTo(ex + r * 0.1, -r * 1.65);
      ctx.lineTo(ex - r * 0.1, -r * 1.45);
      ctx.stroke();
    }
  } else {
    ctx.fillStyle = '#141414';
    for (const k of [-1, 1]) {
      ctx.beginPath();
      ctx.arc(look + k * r * 0.22, -r * 1.55, r * 0.09, 0, TAU);
      ctx.fill();
    }
  }
  ctx.restore();
}

function lorry(ctx, h, ts) {
  const x = h.x * ts;
  const y = h.y * ts;
  const w = h.w * ts;
  const hh = h.h * ts;
  const right = h.vx > 0;
  ctx.save();
  ctx.translate(x + w / 2, y);
  if (!right) ctx.scale(-1, 1);
  ctx.fillStyle = '#d62828';
  ctx.fillRect(-w / 2, hh * 0.05, w * 0.66, hh * 0.7);
  ctx.fillStyle = '#ffb703';
  ctx.fillRect(w * 0.18, hh * 0.22, w * 0.32, hh * 0.53);
  ctx.fillStyle = '#9ad1ff';
  ctx.fillRect(w * 0.3, hh * 0.28, w * 0.16, hh * 0.2);
  ctx.fillStyle = '#222';
  for (const wx of [-w * 0.32, w * 0.05, w * 0.36]) {
    ctx.beginPath();
    ctx.arc(wx, hh * 0.82, hh * 0.17, 0, TAU);
    ctx.fill();
  }
  ctx.strokeStyle = 'rgba(255,255,255,0.7)';
  ctx.lineWidth = 2;
  for (let k = 0; k < 3; k++) {
    ctx.beginPath();
    ctx.moveTo(-w / 2 - ts * (0.3 + k * 0.15), hh * (0.2 + k * 0.2));
    ctx.lineTo(-w / 2 - ts * (0.9 + k * 0.2), hh * (0.2 + k * 0.2));
    ctx.stroke();
  }
  ctx.restore();
  ctx.fillStyle = '#fff';
  ctx.font = `800 ${Math.round(hh * 0.28)}px Lexend, sans-serif`;
  ctx.textAlign = 'center';
  ctx.fillText('LORI', x + w / 2 + (right ? -1 : 1) * w * 0.17, y + hh * 0.5);
}

function drawHazard(ctx, h, ts, t) {
  const cx = (h.x + h.w / 2) * ts;
  const cy = (h.y + h.h / 2) * ts;
  const dir = h.vx > 0 ? 1 : -1;
  switch (h.kind) {
    case 'lori':
      return lorry(ctx, h, ts);
    case 'jentolak': {
      // A big yellow bulldozer, blade first, a light flashing on the roof.
      const x = h.x * ts;
      const y = h.y * ts;
      const w = h.w * ts;
      const hh = h.h * ts;
      ctx.fillStyle = '#2b2b2b';
      ctx.fillRect(x + w * 0.1, y + hh * 0.78, w * 0.85, hh * 0.22);
      ctx.fillStyle = '#555';
      for (let k = 0; k < 5; k++) {
        ctx.beginPath();
        ctx.arc(x + w * (0.2 + k * 0.16), y + hh * 0.89, hh * 0.07, 0, TAU);
        ctx.fill();
      }
      ctx.fillStyle = '#f2b705';
      ctx.fillRect(x + w * 0.2, y + hh * 0.42, w * 0.75, hh * 0.38);
      ctx.fillRect(x + w * 0.45, y + hh * 0.08, w * 0.42, hh * 0.36);
      ctx.fillStyle = '#9ad1ff';
      ctx.fillRect(x + w * 0.52, y + hh * 0.14, w * 0.28, hh * 0.2);
      // The blade.
      ctx.fillStyle = '#8a8f96';
      ctx.fillRect(x, y + hh * 0.45, w * 0.14, hh * 0.55);
      ctx.fillRect(x + w * 0.1, y + hh * 0.6, w * 0.12, hh * 0.08);
      ctx.fillStyle = Math.floor(t / 150) % 2 ? '#ff7a1a' : '#ffd27a';
      ctx.beginPath();
      ctx.arc(x + w * 0.66, y + hh * 0.05, hh * 0.06, 0, TAU);
      ctx.fill();
      if (h.vx > 0) {
        ctx.fillStyle = '#fff';
        ctx.font = `800 ${Math.round(hh * 0.16)}px Lexend, sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillText('UNDUR', x + w * 0.58, y + hh * 0.66);
      }
      return;
    }
    case 'pancut': {
      // The grate, and the jet when it's on.
      const gx = h.x * ts;
      const base = (h.y + h.h) * ts;
      ctx.fillStyle = '#555a62';
      ctx.fillRect(gx - ts * 0.05, base - ts * 0.08, h.w * ts + ts * 0.1, ts * 0.1);
      if (h.on) {
        const g = ctx.createLinearGradient(gx, 0, gx + h.w * ts, 0);
        g.addColorStop(0, 'rgba(120,200,255,0.75)');
        g.addColorStop(0.5, 'rgba(235,250,255,0.95)');
        g.addColorStop(1, 'rgba(120,200,255,0.75)');
        ctx.fillStyle = g;
        const wob = Math.sin(t / 50) * ts * 0.05;
        ctx.fillRect(gx + wob, h.y * ts, h.w * ts, h.h * ts);
        ctx.fillStyle = 'rgba(200,235,255,0.9)';
        for (let k = 0; k < 6; k++) {
          const a = t / 120 + k;
          ctx.beginPath();
          ctx.arc(gx + h.w * ts / 2 + Math.cos(a) * ts * 0.7, h.y * ts + Math.abs(Math.sin(a)) * ts * 0.6, ts * 0.08, 0, TAU);
          ctx.fill();
        }
      } else {
        ctx.fillStyle = 'rgba(120,200,255,0.6)';
        ctx.fillRect(gx + h.w * ts * 0.3, base - ts * 0.3, h.w * ts * 0.4, ts * 0.22);
      }
      return;
    }
    case 'buaya': {
      if (!h.on) {
        // Just eyes above the water, waiting.
        ctx.fillStyle = '#3f6b2a';
        ctx.fillRect(cx - ts * 0.3, (h.y + h.h + 0.85) * ts, ts * 0.6, ts * 0.14);
        ctx.fillStyle = '#ffe14a';
        for (const ex of [-0.15, 0.15]) {
          ctx.beginPath();
          ctx.arc(cx + ex * ts, (h.y + h.h + 0.85) * ts, ts * 0.06, 0, TAU);
          ctx.fill();
        }
        return;
      }
      // Leaping, jaws open.
      const jaw = Math.abs(Math.sin(t / 90)) * 0.5;
      ctx.save();
      ctx.translate(cx, (h.y + h.h) * ts);
      ctx.fillStyle = '#4f8a2f';
      ctx.beginPath();
      ctx.ellipse(0, -h.h * ts * 0.45, h.w * ts * 0.32, h.h * ts * 0.5, 0, 0, TAU);
      ctx.fill();
      ctx.save();
      ctx.translate(0, -h.h * ts * 0.85);
      ctx.rotate(-jaw);
      ctx.fillRect(-ts * 0.05, -ts * 0.5, ts * 0.22, ts * 0.5);
      ctx.restore();
      ctx.save();
      ctx.translate(0, -h.h * ts * 0.85);
      ctx.rotate(jaw);
      ctx.fillRect(-ts * 0.17, -ts * 0.5, ts * 0.22, ts * 0.5);
      ctx.restore();
      ctx.fillStyle = '#fff';
      ctx.fillRect(-ts * 0.12, -h.h * ts * 1.0, ts * 0.24, ts * 0.06);
      ctx.fillStyle = '#ffe14a';
      ctx.beginPath();
      ctx.arc(ts * 0.1, -h.h * ts * 0.6, ts * 0.06, 0, TAU);
      ctx.fill();
      ctx.restore();
      return;
    }
    case 'batu': {
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(-t / 150);
      ctx.fillStyle = '#7d7f86';
      ctx.beginPath();
      for (let k = 0; k < 9; k++) {
        const a = (k / 9) * TAU;
        const rr = (h.w / 2) * ts * (0.85 + (k % 3) * 0.07);
        ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
      }
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.2)';
      ctx.beginPath();
      ctx.arc(-h.w * ts * 0.15, -h.w * ts * 0.15, h.w * ts * 0.15, 0, TAU);
      ctx.fill();
      ctx.restore();
      return;
    }
    case 'wayar': {
      // Two poles and a sagging live wire, sparking.
      const x0 = h.x * ts;
      const x1 = (h.x + h.w) * ts;
      const top = (h.y - 1.2) * ts;
      const ground = (h.y + 2.65) * ts;
      ctx.fillStyle = '#6b5b45';
      ctx.fillRect(x0 - ts * 0.08, top, ts * 0.16, ground - top);
      ctx.fillRect(x1 - ts * 0.08, top, ts * 0.16, ground - top);
      ctx.strokeStyle = '#1b1b1b';
      ctx.lineWidth = Math.max(2, ts * 0.07);
      ctx.beginPath();
      ctx.moveTo(x0, top + ts * 0.1);
      ctx.quadraticCurveTo((x0 + x1) / 2, (h.y + h.h) * ts + ts * 0.5, x1, top + ts * 0.1);
      ctx.stroke();
      ctx.strokeStyle = '#ffe14a';
      ctx.lineWidth = 2;
      for (let k = 0; k < 4; k++) {
        const sx = x0 + ((t / 7 + k * 53) % (x1 - x0));
        const u = (sx - x0) / (x1 - x0);
        const sy = top + ts * 0.1 + (1 - (2 * u - 1) ** 2) * ((h.y + h.h) * ts + ts * 0.5 - top - ts * 0.1) * 0.5;
        ctx.beginPath();
        ctx.moveTo(sx - 5, sy - 5);
        ctx.lineTo(sx + 2, sy);
        ctx.lineTo(sx - 2, sy + 2);
        ctx.lineTo(sx + 5, sy + 6);
        ctx.stroke();
      }
      return;
    }
    case 'motor': {
      ctx.save();
      ctx.translate(cx, (h.y + h.h) * ts);
      ctx.scale(dir, 1);
      ctx.fillStyle = '#222';
      for (const wx of [-0.55, 0.55]) {
        ctx.beginPath();
        ctx.arc(wx * ts, -0.22 * ts, 0.22 * ts, 0, TAU);
        ctx.fill();
      }
      ctx.fillStyle = '#1d6fd6';
      ctx.fillRect(-0.6 * ts, -0.55 * ts, 1.2 * ts, 0.25 * ts);
      ctx.fillStyle = '#333';
      ctx.fillRect(-0.15 * ts, -0.8 * ts, 0.3 * ts, 0.3 * ts);
      ctx.fillStyle = '#ffd54a';
      ctx.beginPath();
      ctx.arc(0.05 * ts, -0.92 * ts, 0.2 * ts, 0, TAU); // the rider's yellow helmet
      ctx.fill();
      ctx.restore();
      return;
    }
    case 'kucing': {
      ctx.save();
      ctx.translate(cx, (h.y + h.h) * ts);
      ctx.scale(dir, 1);
      const leg = Math.sin(t / 40) * 0.08 * ts;
      ctx.fillStyle = '#f08c2a';
      ctx.beginPath();
      ctx.ellipse(0, -0.3 * ts, 0.4 * ts, 0.2 * ts, 0, 0, TAU);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(0.38 * ts, -0.42 * ts, 0.16 * ts, 0, TAU);
      ctx.fill();
      for (const ex of [0.3, 0.44]) {
        ctx.beginPath();
        ctx.moveTo(ex * ts, -0.52 * ts);
        ctx.lineTo((ex + 0.04) * ts, -0.68 * ts);
        ctx.lineTo((ex + 0.1) * ts, -0.54 * ts);
        ctx.fill();
      }
      ctx.strokeStyle = '#f08c2a';
      ctx.lineWidth = 0.06 * ts;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(-0.38 * ts, -0.35 * ts);
      ctx.quadraticCurveTo(-0.6 * ts, -0.6 * ts, -0.5 * ts, -0.75 * ts);
      ctx.stroke();
      for (const lx of [-0.25, 0.2]) {
        ctx.beginPath();
        ctx.moveTo(lx * ts, -0.15 * ts);
        ctx.lineTo(lx * ts + leg, 0);
        ctx.stroke();
      }
      ctx.restore();
      return;
    }
    case 'bola': {
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(cx, cy, (h.w / 2) * ts, 0, TAU);
      ctx.fill();
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(-t / 120);
      ctx.fillStyle = '#141414';
      for (let k = 0; k < 5; k++) {
        const a = (k / 5) * TAU;
        ctx.beginPath();
        ctx.arc(Math.cos(a) * h.w * 0.25 * ts, Math.sin(a) * h.w * 0.25 * ts, h.w * 0.1 * ts, 0, TAU);
        ctx.fill();
      }
      ctx.restore();
      return;
    }
    case 'burung': {
      const flap = Math.sin(t / 60) * 0.25 * ts;
      ctx.fillStyle = '#3a3a48';
      ctx.beginPath();
      ctx.ellipse(cx, cy, 0.35 * ts, 0.18 * ts, 0, 0, TAU);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(cx - 0.1 * ts, cy);
      ctx.lineTo(cx + 0.05 * ts, cy - 0.35 * ts - flap);
      ctx.lineTo(cx + 0.25 * ts, cy);
      ctx.fill();
      ctx.fillStyle = '#ffb703';
      const bx = cx + dir * 0.35 * ts;
      ctx.beginPath();
      ctx.moveTo(bx, cy - 0.04 * ts);
      ctx.lineTo(bx + dir * 0.18 * ts, cy + 0.02 * ts);
      ctx.lineTo(bx, cy + 0.07 * ts);
      ctx.fill();
      return;
    }
    case 'durian':
    case 'kelapa': {
      const r = (h.w / 2) * ts;
      if (h.kind === 'durian') {
        ctx.fillStyle = '#5d7d2a';
        for (let k = 0; k < 12; k++) {
          const a = (k / 12) * TAU;
          ctx.beginPath();
          ctx.moveTo(cx + Math.cos(a - 0.2) * r * 0.85, cy + Math.sin(a - 0.2) * r * 0.85);
          ctx.lineTo(cx + Math.cos(a) * r * 1.3, cy + Math.sin(a) * r * 1.3);
          ctx.lineTo(cx + Math.cos(a + 0.2) * r * 0.85, cy + Math.sin(a + 0.2) * r * 0.85);
          ctx.fill();
        }
      }
      ctx.fillStyle = h.kind === 'durian' ? '#7fa33a' : '#7a5a2a';
      ctx.beginPath();
      ctx.arc(cx, cy, r * 0.95, 0, TAU);
      ctx.fill();
      return;
    }
    case 'papan':
      ctx.fillStyle = '#1f7a4d';
      ctx.fillRect(h.x * ts, h.y * ts, h.w * ts, h.h * ts);
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.strokeRect(h.x * ts + 2, h.y * ts + 2, h.w * ts - 4, h.h * ts - 4);
      ctx.fillStyle = '#fff';
      ctx.font = `700 ${Math.round(h.h * ts * 0.5)}px Lexend, sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText('RUMAH →', cx, cy + h.h * ts * 0.18);
      return;
    case 'pokok':
    case 'tiang': {
      // Toppling over toward the road.
      const k = 1 - Math.max(0, h.life) / 0.3;
      ctx.save();
      ctx.translate(h.x * ts, (h.y + h.h) * ts);
      ctx.rotate((Math.PI / 2) * k);
      tree(ctx, 0, 0, ts, h.kind === 'tiang' ? 'lampu' : 'pokok', 0);
      ctx.restore();
    }
  }
}

/** Draws a frame. `view`: { w, h, dpr }; `fx` effects; `dt` seconds since the last frame. */
export function drawScene(ctx, view, s, fx, t, dt) {
  const { w, h, dpr } = view;
  const { ts, ox, oy } = layout(view, s);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  // Dizzy: the whole world sways.
  if (s.dizzy > 0) {
    const k = Math.min(1, s.dizzy);
    ctx.translate(w / 2, h * 0.75);
    ctx.rotate(Math.sin(t / 160) * 0.07 * k);
    ctx.scale(1 + Math.sin(t / 230) * 0.03 * k, 1);
    ctx.translate(-w / 2, -h * 0.75);
  }

  const sky = ctx.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, '#7cc6f2');
  sky.addColorStop(1, '#d9f1ff');
  ctx.fillStyle = sky;
  ctx.fillRect(-w * 0.2, -h * 0.2, w * 1.4, h * 1.4);
  for (const c of CLOUDS) {
    const cx = ((((c.x + (t / 1000) * c.v + ox / w / 20) % 1.3) + 1.3) % 1.3 - 0.15) * w;
    const cy = c.y * h;
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    for (const [dx, dy, r] of [[0, 0, 22], [20, -8, 18], [38, 2, 16], [-18, 4, 14]]) {
      ctx.beginPath();
      ctx.arc(cx + dx * c.s, cy + dy * c.s, r * c.s, 0, TAU);
      ctx.fill();
    }
  }

  const shake = fx.shake > 0 ? (Math.random() - 0.5) * fx.shake * ts * 0.5 : 0;
  fx.shake = Math.max(0, fx.shake - dt * 3);

  // The town behind, half as fast as the road.
  ctx.save();
  ctx.translate(ox * 0.5, oy);
  const colors = ['#b8c4d6', '#c9b8d6', '#d6c4b8', '#b8d6c9'];
  const from = (-ox * 0.5) / ts - 2;
  const to = from + w / ts + 4;
  for (const b of TOWN) {
    if (b.x + b.w < from || b.x > to) continue;
    ctx.fillStyle = colors[b.hue];
    ctx.fillRect(b.x * ts, (10 - b.h) * ts, b.w * ts, b.h * ts);
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    for (let wy = 10 - b.h + 0.4; wy < 9.6; wy += 0.8) {
      for (let wx = b.x + 0.2; wx < b.x + b.w - 0.3; wx += 0.5) ctx.fillRect(wx * ts, wy * ts, ts * 0.2, ts * 0.3);
    }
  }
  ctx.restore();

  ctx.save();
  ctx.translate(ox + shake, oy);
  const x0 = Math.max(0, Math.floor(-ox / ts) - 1);
  const x1 = Math.min(s.w - 1, Math.ceil((w - ox) / ts) + 1);
  const near = (x) => x >= x0 - 3 && x <= x1 + 3;

  // Scenery behind the road, then trees and posts that are about to fall.
  for (const d of s.level.decor) if (near(d.x)) tree(ctx, d.x * ts, 10 * ts, ts, d.kind, Math.sin(t / 900 + d.x) * ts * 0.05);
  for (const trap of s.traps) {
    const def = trap.def;
    if ((def.type === 'pokok' || def.type === 'tiang') && !trap.done && near(def.x)) {
      tree(ctx, (def.x + 0.3) * ts, (def.row + 1) * ts, ts, def.type === 'tiang' ? 'lampu' : 'pokok', 0);
    }
  }

  for (const trap of s.traps) {
    // The switch only shows once its gate has come down.
    if (trap.def.type !== 'suis' || !near(trap.def.x)) continue;
    if (!s.traps.some((o) => o.def.id === trap.def.needs && o.done)) continue;
    const bx = trap.def.x * ts;
    const by = 10 * ts;
    ctx.fillStyle = '#5b6570';
    ctx.fillRect(bx - ts * 0.35, by - ts * 0.1, ts * 0.7, ts * 0.1);
    ctx.fillStyle = trap.done ? '#2fbf71' : '#e63946';
    ctx.fillRect(bx - ts * 0.22, by - (trap.done ? ts * 0.14 : ts * 0.26), ts * 0.44, trap.done ? ts * 0.06 : ts * 0.16);
    ctx.fillStyle = '#fff';
    ctx.font = `700 ${Math.round(ts * 0.26)}px Lexend, sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText('SUIS', bx, by - ts * 0.45);
  }
  for (const trap of s.traps) {
    if (trap.def.type === 'rumahPalsu' && !trap.done && near(trap.def.house)) houseAt(ctx, trap.def.house * ts, 10 * ts, ts, t);
  }
  for (let y = 0; y < H; y++) for (let x = x0; x <= x1; x++) drawTile(ctx, s, x, y, ts, t);
  // The road carries on past the level's ends.
  for (let y = 10; y < H; y++) {
    for (let x = -3; x < 0; x++) {
      ctx.save();
      ctx.translate(x * ts, 0);
      drawTile(ctx, s, 0, y, ts, t);
      ctx.restore();
    }
    for (let x = 1; x <= 3; x++) {
      ctx.save();
      ctx.translate(x * ts, 0);
      drawTile(ctx, s, s.w - 1, y, ts, t);
      ctx.restore();
    }
  }
  for (const d of s.debris) {
    ctx.fillStyle = '#3d4148';
    ctx.save();
    ctx.translate((d.x + 0.5) * ts, (d.y + 0.5) * ts);
    ctx.rotate(d.vy * 0.05);
    ctx.fillRect(-ts * 0.45, -ts * 0.45, ts * 0.9, ts * 0.9);
    ctx.restore();
  }
  drawHouse(ctx, s, ts, t);
  if (s.locked) {
    // A padlock on the door.
    const e = exitBox(s);
    const lx = (e.x + e.w / 2) * ts;
    const ly = (e.y + e.h) * ts - ts * 0.55;
    ctx.strokeStyle = '#ffd54a';
    ctx.lineWidth = Math.max(2, ts * 0.07);
    ctx.beginPath();
    ctx.arc(lx, ly - ts * 0.12, ts * 0.13, Math.PI, 0);
    ctx.stroke();
    ctx.fillStyle = '#ffd54a';
    ctx.fillRect(lx - ts * 0.18, ly - ts * 0.12, ts * 0.36, ts * 0.3);
  }
  if (s.key) {
    // The key, glowing and bobbing.
    const kx = (s.key.x + 0.5) * ts;
    const ky = (s.key.y + 0.5) * ts + Math.sin(t / 220) * ts * 0.1;
    const glow = ctx.createRadialGradient(kx, ky, 0, kx, ky, ts * 0.9);
    glow.addColorStop(0, 'rgba(255,230,120,0.7)');
    glow.addColorStop(1, 'rgba(255,230,120,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(kx - ts, ky - ts, ts * 2, ts * 2);
    ctx.strokeStyle = '#e0a800';
    ctx.lineWidth = Math.max(2, ts * 0.09);
    ctx.beginPath();
    ctx.arc(kx - ts * 0.18, ky, ts * 0.16, 0, TAU);
    ctx.moveTo(kx - ts * 0.02, ky);
    ctx.lineTo(kx + ts * 0.32, ky);
    ctx.moveTo(kx + ts * 0.2, ky);
    ctx.lineTo(kx + ts * 0.2, ky + ts * 0.12);
    ctx.moveTo(kx + ts * 0.3, ky);
    ctx.lineTo(kx + ts * 0.3, ky + ts * 0.1);
    ctx.stroke();
  }
  for (const hz of s.hazards) drawHazard(ctx, hz, ts, t);
  drawPlayer(ctx, s, ts, t);
  if (s.dizzy > 0) {
    ctx.fillStyle = '#ffe14a';
    ctx.font = `700 ${Math.round(ts * 0.4)}px Lexend, sans-serif`;
    ctx.textAlign = 'center';
    for (let k = 0; k < 3; k++) {
      const a = t / 180 + (k / 3) * TAU;
      ctx.fillText('★', (s.x + PLAYER.w / 2) * ts + Math.cos(a) * ts * 0.45, (s.y - 0.35) * ts + Math.sin(a) * ts * 0.12);
    }
  }

  fx.bits = fx.bits.filter((b) => {
    b.life += dt;
    b.vy += 30 * dt;
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    ctx.globalAlpha = Math.max(0, 1 - b.life / b.max);
    ctx.fillStyle = b.color;
    ctx.fillRect((b.x - b.size / 2) * ts, (b.y - b.size / 2) * ts, b.size * ts, b.size * ts);
    ctx.globalAlpha = 1;
    return b.life < b.max;
  });
  fx.words = fx.words.filter((m) => {
    m.t += dt;
    const k = m.t / 1.4;
    if (k >= 1) return false;
    ctx.globalAlpha = Math.min(1, 3 * (1 - k));
    ctx.font = `800 ${Math.max(14, Math.round(ts * 0.6))}px Lexend, sans-serif`;
    ctx.textAlign = 'center';
    // Kept on screen.
    const px = Math.min(w - ox - 100, Math.max(-ox + 100, m.x * ts));
    const py = (m.y - 0.6 - k * 0.8) * ts;
    ctx.lineWidth = 4;
    ctx.strokeStyle = 'rgba(20,20,30,0.75)';
    ctx.strokeText(m.text, px, py);
    ctx.fillStyle = m.color;
    ctx.fillText(m.text, px, py);
    ctx.globalAlpha = 1;
    return true;
  });
  ctx.restore();

  // An arrow at the screen's edge pointing back to the key, when it's off screen.
  if (s.key) {
    const sx = s.key.x * ts + ox;
    if (sx < 0 || sx > w) {
      const left = sx < 0;
      const ax = left ? 28 : w - 28;
      const ay = oy + (s.key.y + 0.5) * ts;
      ctx.fillStyle = '#ffd54a';
      ctx.strokeStyle = 'rgba(40,30,0,0.6)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(ax + (left ? -16 : 16), ay);
      ctx.lineTo(ax + (left ? 6 : -6), ay - 13);
      ctx.lineTo(ax + (left ? 6 : -6), ay + 13);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.font = '800 13px Lexend, sans-serif';
      ctx.textAlign = 'center';
      ctx.lineWidth = 3;
      ctx.strokeText('🔑', ax + (left ? 16 : -16), ay + 5);
      ctx.fillText('🔑', ax + (left ? 16 : -16), ay + 5);
    }
  }
}
