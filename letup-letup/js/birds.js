// Letup-Letup's pieces: six round little birds drawn as SVG (the same on every phone). Each has a
// body colour far from the others (red, blue, green, yellow, purple, white) and its own headwear
// from campus life, so types are easy to tell apart at a glance.
//
// For speed on phones each bird is drawn as a few still images (poses: normal, blinking, wings up,
// worried) that the browser draws once and reuses for every bird of that colour (birdSrc). The
// board brings them to life by swapping poses now and then and gently bobbing the image, instead
// of animating 25 shapes inside each of 54 birds every frame.
const BIRDS = [
  // Red: the athlete, in a sweatband.
  { body: '#f03e3e', dark: '#a61e1e', belly: '#ffc9c9', tuft: true, hat: `
    <path d="M9.4 15.2c4.4-2.4 9.3-3.6 14.6-3.6s10.2 1.2 14.6 3.6l-.9 3.4c-4.2-2.1-8.8-3.1-13.7-3.1s-9.5 1-13.7 3.1z" fill="#fff" stroke="#a61e1e" stroke-width=".9"/>
    <path d="M9.9 16.9c4.3-2.2 9-3.3 14.1-3.3s9.8 1.1 14.1 3.3" fill="none" stroke="#1c7ed6" stroke-width="1.4"/>
    <path d="M38.4 16.6l4.3 1.6-1.2 3.2zM38.6 17.5l3.5 4.6-2.5.6z" fill="#fff" stroke="#a61e1e" stroke-width=".8" stroke-linejoin="round"/>` },
  // Blue: the bookworm, in round glasses.
  { body: '#228be6', dark: '#1864ab', belly: '#d0ebff', tuft: true, eyesExtra: `
    <g fill="none" stroke="#1d2b3a" stroke-width="1.5"><circle cx="18" cy="21.5" r="5.9"/><circle cx="30" cy="21.5" r="5.9"/><path d="M23.9 21h.2"/><path d="M12.1 20.5 9.5 19.3M35.9 20.5l2.6-1.2"/></g>` },
  // Green: in a black songkok.
  { body: '#40c057', dark: '#2b8a3e', belly: '#d3f9d8', hat: `
    <path d="M14.6 13.4 15.5 4.6c.1-1 5-1.8 8.5-1.8s8.4.8 8.5 1.8l.9 8.8c-2.8-1-5.9-1.5-9.4-1.5s-6.6.5-9.4 1.5z" fill="#212529"/>
    <path d="M15.5 4.6c.1-1 5-1.8 8.5-1.8s8.4.8 8.5 1.8c-1.6.8-4.8 1.3-8.5 1.3s-6.9-.5-8.5-1.3z" fill="#343a40"/>
    <path d="M17.3 7.4c2.1.6 4.3.9 6.7.9" fill="none" stroke="#495057" stroke-width=".8" stroke-linecap="round"/>` },
  // Yellow: the engineer, in a white safety helmet.
  { body: '#fcc419', dark: '#d9480f', belly: '#fff9db', beak: '#f76707', hat: `
    <path d="M12.4 13.2c0-5.8 5.2-10.4 11.6-10.4s11.6 4.6 11.6 10.4z" fill="#f8f9fa" stroke="#868e96" stroke-width="1.2"/>
    <path d="M8.8 13.2h30.4c.9 0 1.2 1.6.3 2-4.6 1.4-10.1 2.1-15.5 2.1s-10.9-.7-15.5-2.1c-.9-.4-.6-2 .3-2z" fill="#e9ecef" stroke="#868e96" stroke-width="1.1"/>
    <path d="M24 3v10M19.5 4.2l1.2 9M28.5 4.2l-1.2 9" stroke="#adb5bd" stroke-width="1.1"/>
    <path d="M16 7.5c1.2-1.7 2.8-2.8 4.6-3.3" fill="none" stroke="#fff" stroke-width="1.3" stroke-linecap="round"/>` },
  // Purple (UiTM's colour): the graduate, in a black mortarboard with a gold tassel.
  { body: '#ae3ec9', dark: '#702283', belly: '#f3d9fa', hat: `
    <path d="M15.5 13.5v-3.2c0-1.6 3.8-2.8 8.5-2.8s8.5 1.2 8.5 2.8v3.2c-2.5-1.1-5.3-1.6-8.5-1.6s-6 .5-8.5 1.6z" fill="#212529"/>
    <path d="M24 1.8 37.5 7.3 24 12.8 10.5 7.3z" fill="#343a40" stroke="#000" stroke-width="1.2" stroke-linejoin="round"/>
    <path d="M24 7.3l8.6 3.2v5.6" fill="none" stroke="#fab005" stroke-width="1.4" stroke-linecap="round"/>
    <circle cx="24" cy="7.3" r="1.2" fill="#fcc419"/><path d="M31.6 15.6h2l.5 3h-3z" fill="#fcc419"/>` },
  // White: with a pink ribbon bow (from Ijazah onwards).
  { body: '#f8f9fa', dark: '#868e96', belly: '#ffffff', hat: `
    <path d="M24 9.2 15.6 3.6c-1.3-.8-2.9.1-2.9 1.6v8c0 1.5 1.6 2.4 2.9 1.6z" fill="#f06595" stroke="#a61e4d" stroke-width="1.1" stroke-linejoin="round"/>
    <path d="M24 9.2l8.4-5.6c1.3-.8 2.9.1 2.9 1.6v8c0 1.5-1.6 2.4-2.9 1.6z" fill="#f06595" stroke="#a61e4d" stroke-width="1.1" stroke-linejoin="round"/>
    <rect x="21.3" y="6.4" width="5.4" height="5.6" rx="2" fill="#faa2c1" stroke="#a61e4d" stroke-width="1.1"/>` },
];

/** Each bird's body colour (its tile is tinted with it). */
export const BIRD_COLOURS = BIRDS.map((b) => b.body);
/** Feather colours for each bird, for the burst when one explodes. */
export const FEATHERS = BIRDS.map((b) => [b.body, b.belly, b.dark]);

/**
 * A bird's SVG in a pose: `blink` (eyes shut), `flap` (wings up), `worried` (looking up at the
 * top of a nearly full column).
 */
export function birdSvg(type, { blink = false, flap = false, worried = false } = {}) {
  const b = BIRDS[type];
  const tuft = b.tuft ? `<path d="M22 10.2c-.6-3 .7-5.4 3.1-6.2-1 1.8-.9 3.6.3 5.5.6-1.5 1.8-2.4 3.3-2.6-1.1 1.2-1.5 2.4-1.3 3.8" fill="${b.body}" stroke="${b.dark}" stroke-width="1.2" stroke-linejoin="round"/>` : '';
  const beak = b.beak ?? '#ffa94d';
  const wingL = flap ? ' transform="rotate(28 13.8 26.6)"' : '';
  const wingR = flap ? ' transform="rotate(-28 34.2 26.6)"' : '';
  const eyes = blink ? ' transform="translate(0 21.5) scale(1 .12) translate(0 -21.5)"' : '';
  const look = worried ? ' transform="translate(0 -1.6)"' : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" class="lt-bird" viewBox="0 0 48 48" aria-hidden="true" stroke-linecap="round" stroke-linejoin="round">
  <g class="lt-bob">
    <ellipse cx="24" cy="45" rx="11" ry="2" fill="#000" opacity=".18"/>
    <path d="M19 41.5v2.6M17.4 44.1h3.2M29 41.5v2.6M27.4 44.1h3.2" stroke="#e8590c" stroke-width="1.6"/>
    ${tuft}
    <circle cx="24" cy="26" r="16.5" fill="${b.body}" stroke="${b.dark}" stroke-width="1.8"/>
    <ellipse cx="24" cy="32.5" rx="10" ry="8" fill="${b.belly}"/>
    <path d="M13 17.5c2.5-3.6 6.3-5.6 10.5-5.9" fill="none" stroke="#fff" stroke-width="1.6" opacity=".45"/>
    <path class="wing"${wingL} d="M8.6 25.5c-2.6 2.4-3.1 6.6-1 9.4 2.6-.2 5.4-2.2 6.5-5.2.5-1.6-.1-3.4-1.6-4.3-1.3-.8-2.8-.7-3.9.1z" fill="${b.dark}"/>
    <path class="wing wing-r"${wingR} d="M39.4 25.5c2.6 2.4 3.1 6.6 1 9.4-2.6-.2-5.4-2.2-6.5-5.2-.5-1.6.1-3.4 1.6-4.3 1.3-.8 2.8-.7 3.9.1z" fill="${b.dark}"/>
    <ellipse cx="14.5" cy="28.5" rx="2.6" ry="1.6" fill="#ff8787" opacity=".55"/>
    <ellipse cx="33.5" cy="28.5" rx="2.6" ry="1.6" fill="#ff8787" opacity=".55"/>
    <g class="eyes"${eyes}>
      <ellipse cx="18" cy="21.5" rx="4.6" ry="5" fill="#fff" stroke="${b.dark}" stroke-width=".5"/><ellipse cx="30" cy="21.5" rx="4.6" ry="5" fill="#fff" stroke="${b.dark}" stroke-width=".5"/>
      <g class="pupils" fill="#1d2b3a"${look}><circle cx="18.6" cy="22.2" r="2.7"/><circle cx="29.4" cy="22.2" r="2.7"/></g>
      <circle cx="19.6" cy="20.8" r="1" fill="#fff"/><circle cx="30.4" cy="20.8" r="1" fill="#fff"/>
    </g>
    ${b.eyesExtra ?? ''}
    <path d="M20.6 27.4h6.8l-3.4 4.6z" fill="${beak}" stroke="#d9480f" stroke-width="1.1"/>
    <path d="M21.6 28.6h4.8" stroke="#d9480f" stroke-width=".8"/>
    ${b.hat ?? ''}
  </g>
</svg>`;
}

export const POSES = { normal: {}, blink: { blink: true }, flap: { flap: true }, worried: { worried: true } };
const srcCache = new Map();
/** A bird in a pose as an image address (made once, then reused by every bird of that colour). */
export function birdSrc(type, pose = 'normal') {
  const k = `${type}:${pose}`;
  if (!srcCache.has(k)) srcCache.set(k, `data:image/svg+xml;charset=utf-8,${encodeURIComponent(birdSvg(type, POSES[pose]))}`);
  return srcCache.get(k);
}

/** Decodes every bird's poses ahead of time, so the first blink or flap doesn't flicker. */
export function preloadBirds(types = BIRDS.length) {
  for (let t = 0; t < types; t++) {
    for (const pose of Object.keys(POSES)) {
      const img = new Image();
      img.src = birdSrc(t, pose);
      img.decode?.().catch(() => {});
    }
  }
}
