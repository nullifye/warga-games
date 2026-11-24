import { initAppsWarga, closeMiniApp, notifyAppReady } from './appswarga.js';
import { initFromArked, backToArked } from './arked-link.js';
import { initProfile, loadProfile, withProfile } from './profile.js';
import { todayKL } from './rng.js';
import * as lb from './leaderboard.js';

const game = document.body.dataset.game;
const $ = (selector) => document.querySelector(selector);
let tab = 'daily';
let requestId = 0;
let submittedRound = -1;
let pendingResult = null;

function boardMessage(message, retry = false) {
  const box = document.createElement('div');
  box.className = 'lb-empty';
  const p = document.createElement('p');
  p.textContent = message;
  box.append(p);
  if (retry) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn btn-ghost';
    button.textContent = 'Cuba semula';
    button.addEventListener('click', loadBoard);
    box.append(button);
  }
  $('#warga-board-body').replaceChildren(box);
}

async function loadBoard() {
  const request = ++requestId;
  if (!lb.boardsConfigured()) return boardMessage('Papan markah belum dikonfigurasi.');
  boardMessage('Memuatkan…');
  const profile = loadProfile();
  try {
    const rows = tab === 'campus'
      ? await lb.topCampuses(game)
      : await lb.topPlayers(game, profile?.playerId, tab === 'daily' ? todayKL() : null);
    if (request !== requestId) return;
    if (!rows?.length) return boardMessage(tab === 'daily' ? 'Belum ada markah hari ini.' : 'Belum ada markah.');
    $('#warga-board-body').replaceChildren(tab === 'campus'
      ? lb.campusList(rows, profile?.campus)
      : lb.playersList(rows, { showPlays: tab === 'daily' }));
  } catch (error) {
    if (request === requestId) boardMessage(`Gagal memuatkan: ${error.message}`, true);
  }
}

function submitResult(result) {
  pendingResult = result;
  withProfile(async () => {
    if (pendingResult !== result) return;
    const status = $('#warga-submit');
    if (!lb.boardsConfigured()) return void (status.textContent = 'Papan markah belum dikonfigurasi.');
    status.textContent = 'Menghantar markah…';
    try {
      await lb.recordRound({ game, profile: loadProfile(), points: result.points, seconds: result.seconds });
      status.textContent = 'Markah direkodkan.';
    } catch (error) {
      status.replaceChildren();
      status.append(`Gagal menghantar: ${error.message} `);
      const retry = document.createElement('button');
      retry.type = 'button';
      retry.className = 'btn btn-link';
      retry.textContent = 'Cuba semula';
      retry.addEventListener('click', () => submitResult(result));
      status.append(retry);
    }
  });
}

window.addEventListener('warga-round', (event) => {
  const result = event.detail;
  if (result.round === submittedRound) return;
  submittedRound = result.round;
  if (result.points > 0) submitResult(result);
  else $('#warga-submit').textContent = 'Tiada markah untuk direkodkan.';
});

initFromArked();
initAppsWarga();
initProfile({ changed: () => { if ($('#warga-board-dialog').open) loadBoard(); } });
notifyAppReady();
$('#warga-hub').addEventListener('click', backToArked);
$('#warga-close').addEventListener('click', closeMiniApp);
$('#warga-board').addEventListener('click', () => { $('#warga-board-dialog').showModal(); loadBoard(); });
$('#warga-board-close').addEventListener('click', () => $('#warga-board-dialog').close());
$('#warga-board-refresh').addEventListener('click', loadBoard);
document.querySelectorAll('#warga-board-dialog [data-tab]').forEach((button) => button.addEventListener('click', () => {
  tab = button.dataset.tab;
  document.querySelectorAll('#warga-board-dialog [data-tab]').forEach((other) => other.setAttribute('aria-selected', String(other === button)));
  $('#warga-board-dialog .tabs').style.setProperty('--tab-index', String([...button.parentElement.children].indexOf(button)));
  loadBoard();
}));
