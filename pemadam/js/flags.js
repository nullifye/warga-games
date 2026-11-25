// The flags printed on the erasers, each drawn to its official construction in its own units
// (w × h, the official proportion) on a 2D canvas context. Yours is always Malaysia's; the AI's
// is one of the others, a different one each match.
//
// Sources: Malaysia, the construction sheet on Wikimedia Commons ("Flag of Malaysia
// (construction sheet).svg": 28 × 14 stripe units); Singapore, the 1959 construction sheet
// ("Construction Sheet of the Flag of Singapore.svg": 54 × 36 in) and the official red #EE2536;
// the others are plain stripes or a disc with the proportions given for each.

function star(c, cx, cy, outer, inner, points) {
  c.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / points, r = i % 2 ? inner : outer; // one point straight up
    if (i) c.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r); else c.moveTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
  }
  c.closePath();
  c.fill();
}
function disc(c, x, y, r, color) {
  c.fillStyle = color;
  c.beginPath();
  c.arc(x, y, r, 0, Math.PI * 2);
  c.fill();
}
/** Equal bands of colour, top to bottom (or hoist to fly when `across`), over w × h. */
function bands(c, w, h, colors, across = false) {
  colors.forEach((col, i) => {
    c.fillStyle = col;
    if (across) c.fillRect((w * i) / colors.length, 0, w / colors.length + 0.01, h);
    else c.fillRect(0, (h * i) / colors.length, w, h / colors.length + 0.01);
  });
}
const flag = (name, w, h, draw) => ({ name, w, h, draw: (c) => draw(c, w, h) });

export const FLAGS = {
  // Jalur Gemilang, 1:2. 14 equal stripes, red at the top; the blue canton is half the length
  // and 8 stripes deep. Crescent: outer circle at (5.75, 4) r 3, cut by a circle at (6 5/12, 4)
  // r 8/3, opening towards the 14-point star at (8.75, 4), radii 2.5 and 1.
  Malaysia: flag('Malaysia', 28, 14, (c, w) => {
    for (let i = 0; i < 14; i++) { c.fillStyle = i % 2 ? '#ffffff' : '#cc0001'; c.fillRect(0, i, w, 1.01); }
    c.fillStyle = '#010066';
    c.fillRect(0, 0, 14, 8);
    disc(c, 5.75, 4, 3, '#ffcc00');
    disc(c, 6 + 5 / 12, 4, 8 / 3, '#010066');
    c.fillStyle = '#ffcc00';
    star(c, 8.75, 4, 2.5, 1, 14);
  }),
  // 2:3, a red disc three fifths of the height across, centred.
  Japan: flag('Jepun', 3, 2, (c, w, h) => { bands(c, w, h, ['#ffffff']); disc(c, 1.5, 1, 0.6, '#bc002d'); }),
  // 2:3, red over white.
  Indonesia: flag('Indonesia', 3, 2, (c, w, h) => bands(c, w, h, ['#ce1126', '#ffffff'])),
  // 2:3, red, white, a double-width blue, white, red (1:1:2:1:1).
  Thailand: flag('Thailand', 3, 2, (c, w) => {
    let y = 0;
    for (const [col, u] of [['#a51931', 1], ['#f4f5f8', 1], ['#2d2a4a', 2], ['#f4f5f8', 1], ['#a51931', 1]]) {
      c.fillStyle = col;
      c.fillRect(0, y / 3, w, u / 3 + 0.01);
      y += u;
    }
  }),
  // 2:3 (54 × 36 in), red over white. In the red: a white crescent (circle at (11.406, 9),
  // r 6.625, cut by a red one of the same size 3 in towards the fly) facing five white stars
  // (outer r 1.725, inner 0.659, one point up) on a circle of r 3.8 at (15.03, 9), the first at
  // the top, then every 72°.
  Singapore: flag('Singapura', 54, 36, (c, w, h) => {
    bands(c, w, h, ['#ee2536', '#ffffff']);
    disc(c, 11.406, 9, 6.625, '#ffffff');
    disc(c, 14.405, 9, 6.625, '#ee2536');
    c.fillStyle = '#ffffff';
    for (let i = 0; i < 5; i++) {
      const a = -Math.PI / 2 + (i * Math.PI * 2) / 5;
      star(c, 15.03 + Math.cos(a) * 3.8, 9 + Math.sin(a) * 3.8, 1.725, 0.659, 5);
    }
  }),
  // 3:5, black, red, gold.
  Germany: flag('Jerman', 5, 3, (c, w, h) => bands(c, w, h, ['#000000', '#dd0000', '#ffce00'])),
  // 2:3, blue, white, red from the hoist.
  France: flag('Perancis', 3, 2, (c, w, h) => bands(c, w, h, ['#002395', '#ffffff', '#ed2939'], true)),
  // 2:3, green, white, red from the hoist.
  Italy: flag('Itali', 3, 2, (c, w, h) => bands(c, w, h, ['#009246', '#f1f2f1', '#ce2b37'], true)),
  // 2:3, red, white, blue.
  Netherlands: flag('Belanda', 3, 2, (c, w, h) => bands(c, w, h, ['#ae1c28', '#ffffff', '#21468b'])),
  // 2:3, blue over yellow.
  Ukraine: flag('Ukraine', 3, 2, (c, w, h) => bands(c, w, h, ['#0057b7', '#ffd700'])),
  // 3:5 (10 × 6), green; a red disc of radius 2 (a fifth of the length), its centre 4.5 from the
  // hoist (nearer the hoist), halfway down.
  Bangladesh: flag('Bangladesh', 10, 6, (c, w, h) => { bands(c, w, h, ['#006a4e']); disc(c, 4.5, 3, 2, '#f42a41'); }),
  // 5:8, white over red.
  Poland: flag('Poland', 8, 5, (c, w, h) => bands(c, w, h, ['#ffffff', '#dc143c'])),
};

/** The flags the AI's eraser may show (all but yours), with their Malay names. */
export const AI_FLAGS = Object.fromEntries(Object.entries(FLAGS).filter(([k]) => k !== 'Malaysia').map(([k, f]) => [k, f.name]));

/**
 * Paints `country`'s flag on a W × H canvas, in its own proportions and as large as fits inside
 * a narrow margin of `paper` (the eraser's rubber round the print), slightly worn.
 */
export function paintFlag(c, W, H, country, paper = '#f6f2e6') {
  const f = FLAGS[country] ?? FLAGS.Malaysia;
  c.fillStyle = paper;
  c.fillRect(0, 0, W, H);
  const m = H * 0.05;
  const s = Math.min((W - 2 * m) / f.w, (H - 2 * m) / f.h);
  const fw = f.w * s, fh = f.h * s, x0 = (W - fw) / 2, y0 = (H - fh) / 2;
  c.save();
  c.beginPath();
  c.roundRect(x0, y0, fw, fh, H * 0.02);
  c.clip();
  c.translate(x0, y0);
  c.scale(s, s);
  f.draw(c);
  c.restore();
  // Printed on rubber: a few specks of wear.
  c.save();
  c.globalAlpha = 0.06;
  for (let i = 0; i < 260; i++) {
    c.fillStyle = Math.random() < 0.5 ? '#000' : '#fff';
    c.fillRect(x0 + Math.random() * fw, y0 + Math.random() * fh, 1 + Math.random() * 3, 1 + Math.random() * 2);
  }
  c.restore();
}
