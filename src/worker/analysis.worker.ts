/// <reference lib="webworker" />
import { fetchArchives, fetchMonth, fetchPlayerProfile, type RawGame } from './chessApi';
import { analyzeGame } from './pgnAnalyzer';
import { getMonth, putMonth, SCHEMA_VERSION } from './db';
import type { WorkerInbound, WorkerOutbound, GameRecord } from '../shared/types';

declare const self: DedicatedWorkerGlobalScope;

self.onmessage = async (e: MessageEvent<WorkerInbound>) => {
  if (e.data.type !== 'start') return;
  const { nick } = e.data;
  try {
    const profile = await fetchPlayerProfile(nick);
    post({ type: 'player', profile });
    const archives = await fetchArchives(nick);

    for (const url of archives) {
      post({ type: 'tick', month: monthLabel(url) });
      const cached = await getMonth(nick, url);
      let records: GameRecord[];
      let gameCount: number;

      if (cached?.schemaVersion === SCHEMA_VERSION && cached.records && isCacheComplete(url, cached.storedAt)) {
        // Hot path: analyzed records cached, no parse, no network.
        records = cached.records;
        gameCount = cached.gameCount ?? records.length;
      } else if (cached?.games && isCacheComplete(url, cached.storedAt)) {
        // Legacy v1 entry: re-analyze in place (no refetch), upgrade the cache.
        const games = cached.games as RawGame[];
        records = analyzeAll(games, nick);
        gameCount = games.length;
        await putMonth(nick, url, {
          schemaVersion: SCHEMA_VERSION,
          gameCount,
          records,
          storedAt: Date.now(),
        });
      } else {
        // Network fetch: current month, or first-ever, or schema bump.
        const result = await fetchMonth(url);
        records = analyzeAll(result.games, nick);
        gameCount = result.games.length;
        await putMonth(nick, url, {
          schemaVersion: SCHEMA_VERSION,
          gameCount,
          records,
          storedAt: Date.now(),
        });
      }

      post({
        type: 'month-done',
        gamesInMonth: gameCount,
        matesInMonth: records.length,
        records,
      });
    }

    post({ type: 'done' });
  } catch (err) {
    post({ type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};

function post(msg: WorkerOutbound) {
  self.postMessage(msg);
}

function monthLabel(monthUrl: string): string {
  const m = monthUrl.match(/\/(\d{4})\/(\d{1,2})\/?$/);
  return m ? `${m[1]}/${m[2]}` : '';
}

function analyzeAll(games: RawGame[], nick: string): GameRecord[] {
  const out: GameRecord[] = [];
  for (const g of games) {
    const rec = analyzeGame(g, nick);
    if (rec) out.push(rec);
  }
  return out;
}

// Cache for a /YYYY/MM archive is trustworthy only if it was written AFTER
// that month ended — otherwise it might be a mid-month snapshot missing later
// games that have since been played.
function isCacheComplete(monthUrl: string, storedAt: number): boolean {
  const m = monthUrl.match(/\/(\d{4})\/(\d{1,2})\/?$/);
  if (!m) return false;
  const year = +m[1];
  const month = +m[2];
  const stored = new Date(storedAt);
  const sy = stored.getUTCFullYear();
  const sm = stored.getUTCMonth() + 1;
  return sy > year || (sy === year && sm > month);
}
