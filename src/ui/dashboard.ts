import { BADGES, type BadgeMeta } from '../shared/constants';
import type { GameRecord, GameTally, TimeClass } from '../shared/types';
import { bucketKey } from '../shared/types';

interface BinSlot {
  delivered: number;
  received: number;
  records: GameRecord[];
}

interface Filters {
  timeClass: TimeClass | 'all';
  ratedOnly: boolean;
}

let allRecords: GameRecord[] = [];
let gameTally: GameTally = {};
let filters: Filters = { timeClass: 'all', ratedOnly: false };

export function reset() {
  allRecords = [];
  gameTally = {};
  render();
}

export function addMonth(records: GameRecord[], tally: GameTally) {
  if (records.length) allRecords.push(...records);
  for (const [k, n] of Object.entries(tally)) {
    gameTally[k] = (gameTally[k] ?? 0) + n;
  }
  render();
}

export function setFilter(partial: Partial<Filters>) {
  filters = { ...filters, ...partial };
  render();
}

function applyFilters(): GameRecord[] {
  return allRecords.filter((r) => {
    if (filters.timeClass !== 'all' && r.timeClass !== filters.timeClass) return false;
    if (filters.ratedOnly && !r.rated) return false;
    return true;
  });
}

// Counts that respect the active filters: mates come straight from the filtered
// records, games from the per-class tally (which includes non-mate games).
export function getStats(): { games: number; mates: number } {
  let games = 0;
  for (const [k, n] of Object.entries(gameTally)) {
    const [tc, rated] = k.split('|');
    if (filters.timeClass !== 'all' && tc !== filters.timeClass) continue;
    if (filters.ratedOnly && rated !== 'r') continue;
    games += n;
  }
  return { games, mates: applyFilters().length };
}

function bin(records: GameRecord[]): Map<string, BinSlot> {
  const bins = new Map<string, BinSlot>();
  for (const r of records) {
    for (const b of r.buckets) {
      const key = bucketKey(b);
      let slot = bins.get(key);
      if (!slot) {
        slot = { delivered: 0, received: 0, records: [] };
        bins.set(key, slot);
      }
      r.delivered ? slot.delivered++ : slot.received++;
      slot.records.push(r);
    }
  }
  return bins;
}

export function pickShortlist(records: GameRecord[]): GameRecord[] {
  const wins = records.filter((r) => r.delivered).sort((a, b) => a.plyCount - b.plyCount);
  const losses = records.filter((r) => !r.delivered).sort((a, b) => a.plyCount - b.plyCount);
  const reservedWins = wins.slice(0, Math.min(2, wins.length));
  const remaining = [...wins.slice(reservedWins.length), ...losses]
    .sort((a, b) => a.plyCount - b.plyCount)
    .slice(0, 5 - reservedWins.length);
  return [...reservedWins, ...remaining].sort((a, b) => a.plyCount - b.plyCount);
}

function renderRow(r: GameRecord): string {
  const verb = r.delivered ? 'won' : 'lost';
  const cls = r.delivered ? 'win' : 'loss';
  const moves = Math.ceil(r.plyCount / 2);
  const date = new Date(r.endTime * 1000).toISOString().slice(0, 10);
  return `<li class="row ${cls}">
    <span class="verdict">${verb} in ${moves}</span>
    <span class="opp">vs ${escapeHtml(r.opponent)} (${r.opponentRating || '?'})</span>
    <span class="date">${date}</span>
    <a class="link" href="${escapeAttr(r.url)}" target="_blank" rel="noopener" title="open on chess.com">↗</a>
  </li>`;
}

function renderBadge(meta: BadgeMeta, slot: BinSlot | undefined): string {
  const total = (slot?.delivered ?? 0) + (slot?.received ?? 0);
  const empty = total === 0 ? 'is-empty' : '';
  const visual = meta.image
    ? `<img class="badge-img" src="${meta.image}" alt="${escapeAttr(meta.title)}" />`
    : `<div class="badge-glyph"><span>${escapeHtml(meta.glyph || '?')}</span></div>`;
  const shortlist = slot ? pickShortlist(slot.records) : [];
  const shortlistHtml = shortlist.length
    ? `<ol class="shortlist">${shortlist.map(renderRow).join('')}</ol>`
    : `<p class="no-games">no games yet</p>`;
  return `<article class="badge ${empty} ${meta.cssClass || ''}">
    <div class="badge-visual">${visual}</div>
    <h3 class="badge-title">${escapeHtml(meta.title)}</h3>
    <div class="counters">
      <span class="count delivered" title="mates you delivered">${slot?.delivered ?? 0}</span>
      <span class="sep">/</span>
      <span class="count received" title="mates you got blundered into">${slot?.received ?? 0}</span>
    </div>
    <details class="disclosure">
      <summary>shortest games</summary>
      ${shortlistHtml}
    </details>
  </article>`;
}

export function render() {
  const filtered = applyFilters();
  const bins = bin(filtered);
  const root = document.getElementById('badge-wall');
  if (!root) return;
  root.innerHTML = BADGES.map((meta) => renderBadge(meta, bins.get(meta.key))).join('');
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}
function escapeAttr(s: string): string {
  return escapeHtml(s);
}
