// Opened from Arked Warga, the game hub (https://nullifye.github.io/arcade/): the hub opens
// games with ?dari=arked, and a game then shows ‹ (back to Arked) instead of ✕.
//
// Going back walks the browser history to the hub's page, so the hub comes back as it was.
// If that can't work (e.g. the history was lost), it opens the hub's fixed address. The
// address is never taken from the link, so ?dari=arked can't send anyone elsewhere.
//
// Usage: initFromArked() once on load (adds html.from-arked); backToArked() on the ‹ button.

const HUB_HOST = 'nullifye.github.io';
// sessionStorage, per game (every game is on the same site): { base } = the history index of
// the game's first page after the hub, or null when it wasn't opened straight from the hub.
const flagKey = () => `arked.from:${location.pathname}`;

/**
 * The hub's address: always the real hub, wherever this game is hosted (GitHub Pages, Vercel, …);
 * only on a local dev server (tools/dev-server.mjs in arked) the local copy.
 */
export function hubUrl(here = location) {
  const local = here.hostname === 'localhost' || here.hostname === '127.0.0.1';
  return local ? `${here.origin}/arcade/` : `https://${HUB_HOST}/arcade/`;
}

const session = {
  get() {
    try {
      return JSON.parse(sessionStorage.getItem(flagKey()));
    } catch {
      return null;
    }
  },
  set(v) {
    try {
      if (v == null) sessionStorage.removeItem(flagKey());
      else sessionStorage.setItem(flagKey(), JSON.stringify(v));
    } catch {
      /* storage unavailable: going back uses the hub's address */
    }
  },
};

/** This history entry's index, stamped into history.state the first time we see it. */
function stampIndex() {
  const state = history.state && typeof history.state === 'object' ? history.state : {};
  if (Number.isInteger(state.arkedIdx)) return state.arkedIdx;
  // A new entry (a hash change pushes one) is the last in the history, so its index is length - 1.
  const idx = history.length - 1;
  try {
    history.replaceState({ ...state, arkedIdx: idx }, '');
  } catch {
    /* ignore */
  }
  return idx;
}

/** True when the previous page was Arked Warga's (any page on a local dev server counts). */
export function cameFromHub(referrer = document.referrer) {
  let ref;
  try {
    ref = new URL(referrer);
  } catch {
    return false; // no referrer: opened from a link, a bookmark or a new tab
  }
  if (ref.hostname === 'localhost' || ref.hostname === '127.0.0.1') return true;
  // Across sites the browser sends only the origin; on the same site, the full address.
  return ref.hostname === HUB_HOST && (ref.pathname === '/' || ref.pathname.startsWith('/arcade/'));
}

/** Call once on load. Returns true when the game was opened from Arked Warga. */
export function initFromArked() {
  const fromArked = new URLSearchParams(location.search).get('dari') === 'arked';
  if (!fromArked) {
    session.set(null);
    return false;
  }
  const nav = performance.getEntriesByType?.('navigation')?.[0]?.type;
  if (nav === 'navigate' || session.get() == null) {
    // A fresh visit. If it came straight from the hub, the hub's page is the one before this
    // in the history, so ‹ can go back to it; otherwise ‹ opens the hub's address.
    session.set({ base: cameFromHub() ? stampIndex() : null });
  } else {
    stampIndex(); // a reload, or back/forward: keep what the first visit found
  }
  window.addEventListener('hashchange', stampIndex);
  document.documentElement.classList.add('from-arked');
  return true;
}

/** This page's address for sharing, without ?dari=arked (that's only for the hub's own links). */
export function shareUrl(href = location.href) {
  const url = new URL(href);
  url.hash = '';
  url.searchParams.delete('dari');
  return url.href;
}

/** Back to the hub: through the history if possible, else to its address. */
export function backToArked() {
  const base = session.get()?.base;
  const idx = stampIndex();
  const steps = Number.isInteger(base) ? idx - base + 1 : 0;
  const fallback = () => location.assign(hubUrl());
  if (steps < 1 || steps > history.length - 1) return fallback();
  // If the history walk doesn't leave this page shortly, use the address instead.
  const timer = setTimeout(fallback, 700);
  window.addEventListener('pagehide', () => clearTimeout(timer), { once: true });
  history.go(-steps);
}
