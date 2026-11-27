// The leaderboard screen (Papan Markah), the same in every game: the Hari Ini / Keseluruhan /
// Kampus tabs, loading, an empty board, and an error with Cuba semula. It always opens on Hari
// Ini; the tab chosen is kept only while the board is open.
//
// Part of the shared kit (see shared/README.md): it imports only from this folder, so a game on
// any host can use it. The page brings the markup, as every game's index.html has it:
//   .tabs [data-tab="daily" | "alltime" | "campus"]   the tabs (the pill slides via --tab-index)
//   #board-sub                                         the line under the title
//   #lb-body                                           the list, or a message
//   #btn-board-refresh                                 reloads the tab shown (optional)
// Showing the board screen and going back from it are the page's own (its routing).
import * as lb from './leaderboard.js';
import { loadProfile } from './profile.js';
import { todayKL } from './rng.js';

const SUBTITLES = {
  daily: () => 'Jumlah markah hari ini',
  alltime: () => 'Jumlah markah & masa bermain',
  campus: () => 'Jumlah markah semua pemain kampus',
};

function h(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text != null) e.textContent = text;
  return e;
}

/**
 * Wires the board for `game` (its id in arked_games). Returns { open(), refresh(), tab }:
 * open() shows Hari Ini (call it when the board screen is shown); refresh() reloads the tab.
 * `subtitles`: per-tab overrides of the line under the title, (date) => text, e.g. Teka Kata's
 * Hari Ini with the date. `root`: where the markup is (the document by default).
 */
export function createBoard({ game, subtitles = {}, root = document }) {
  const $ = (sel) => root.querySelector(sel);
  const buttons = [...root.querySelectorAll('.tabs [data-tab]')];
  let tab = 'daily';
  let request = 0; // a newer load (another tab, or a refresh) makes an older reply stale

  function message(text, retry) {
    const box = h('div', 'lb-empty');
    box.append(h('p', null, text));
    if (retry) {
      const b = h('button', 'btn btn-ghost', 'Cuba semula');
      b.type = 'button';
      b.addEventListener('click', retry);
      box.append(b);
    }
    $('#lb-body').replaceChildren(box);
  }

  async function load() {
    const mine = ++request;
    const shown = tab;
    const date = todayKL();
    $('#board-sub').textContent = (subtitles[shown] ?? SUBTITLES[shown])(date);
    if (!lb.boardsConfigured()) return message('Papan markah belum dikonfigurasi.');
    $('#lb-body').replaceChildren(h('div', 'lb-loading', 'Memuatkan…'));
    const profile = loadProfile();
    try {
      const rows = shown === 'campus'
        ? await lb.topCampuses(game)
        : await lb.topPlayers(game, profile?.playerId, shown === 'daily' ? date : null);
      if (mine !== request) return;
      if (!rows?.length) return message(shown === 'daily' ? 'Belum ada markah hari ini. Jadilah yang pertama!' : 'Belum ada markah.');
      $('#lb-body').replaceChildren(shown === 'campus'
        ? lb.campusList(rows, profile?.campus)
        : lb.playersList(rows, { showPlays: shown === 'daily' }));
    } catch (err) {
      if (mine === request) message(`Gagal memuatkan: ${err.message}`, load);
    }
  }

  function select(next) {
    tab = next;
    buttons.forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === next)));
    // Slides the selected-tab pill (css .tabs::before) to this tab.
    $('.tabs')?.style.setProperty('--tab-index', String(buttons.findIndex((b) => b.dataset.tab === next)));
    load();
  }

  for (const b of buttons) b.addEventListener('click', () => select(b.dataset.tab));
  $('#btn-board-refresh')?.addEventListener('click', load);

  return {
    open: () => select('daily'),
    refresh: load,
    get tab() { return tab; },
  };
}
