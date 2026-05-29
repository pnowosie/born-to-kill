import { reset, addRecords, setFilter, render } from './ui/dashboard';
import type { WorkerInbound, WorkerOutbound, TimeClass, PlayerProfile } from './shared/types';

const DEFAULT_AVATAR = 'badges/queen.png';

let worker: Worker | null = null;
const totals = { games: 0, mates: 0 };

const form = document.getElementById('nick-form') as HTMLFormElement;
const input = document.getElementById('nick-input') as HTMLInputElement;
const errorEl = document.getElementById('error')!;
const filtersEl = document.getElementById('filters')!;
const playerPane = document.getElementById('player-pane')!;
const playerAvatar = document.getElementById('player-avatar') as HTMLImageElement;
const playerLink = document.getElementById('player-link') as HTMLAnchorElement;
const statGames = document.getElementById('stat-games')!;
const statMates = document.getElementById('stat-mates')!;
const statusEl = document.getElementById('player-status')!;

function showError(text: string) {
  errorEl.textContent = text;
  errorEl.hidden = false;
}

function clearError() {
  errorEl.textContent = '';
  errorEl.hidden = true;
}

function showPlayer(profile: PlayerProfile) {
  playerAvatar.src = profile.avatar || DEFAULT_AVATAR;
  playerAvatar.onerror = () => {
    playerAvatar.onerror = null;
    playerAvatar.src = DEFAULT_AVATAR;
  };
  playerAvatar.alt = profile.username;
  playerLink.textContent = profile.name ? `${profile.name} (${profile.username})` : profile.username;
  playerLink.href = profile.url;
  playerPane.hidden = false;
}

function updateStats() {
  statGames.textContent = totals.games.toLocaleString();
  statMates.textContent = totals.mates.toLocaleString();
}

function start(nick: string) {
  worker?.terminate();
  reset();
  totals.games = 0;
  totals.mates = 0;
  updateStats();
  statusEl.textContent = '…loading';
  statusEl.className = 'player-status is-loading';
  playerPane.hidden = true;
  clearError();
  filtersEl.hidden = false;

  worker = new Worker(new URL('./worker/analysis.worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (e: MessageEvent<WorkerOutbound>) => {
    const msg = e.data;
    switch (msg.type) {
      case 'player':
        showPlayer(msg.profile);
        break;
      case 'tick':
        statusEl.textContent = `…loading ${msg.month}`;
        statusEl.className = 'player-status is-loading';
        break;
      case 'month-done':
        totals.games += msg.gamesInMonth;
        totals.mates += msg.matesInMonth;
        addRecords(msg.records);
        updateStats();
        break;
      case 'done':
        statusEl.textContent = '✅ done';
        statusEl.className = 'player-status is-done';
        break;
      case 'error':
        statusEl.textContent = '';
        showError(msg.message);
        break;
    }
  };
  worker.postMessage({ type: 'start', nick } as WorkerInbound);

  const params = new URLSearchParams(window.location.search);
  params.set('nick', nick);
  history.replaceState(null, '', `?${params.toString()}`);
}

form.addEventListener('submit', (e) => {
  e.preventDefault();
  const nick = input.value.trim();
  if (nick) start(nick);
});

document.querySelectorAll<HTMLButtonElement>('.chip').forEach((chip) => {
  chip.addEventListener('click', () => {
    document.querySelectorAll('.chip').forEach((c) => c.classList.remove('is-active'));
    chip.classList.add('is-active');
    setFilter({ timeClass: chip.dataset.tc as TimeClass | 'all' });
  });
});
document.getElementById('rated-only')?.addEventListener('change', (e) => {
  setFilter({ ratedOnly: (e.target as HTMLInputElement).checked });
});

render();

const initial = new URLSearchParams(window.location.search).get('nick');
if (initial) {
  input.value = initial;
  start(initial);
}
