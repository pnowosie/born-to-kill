import { openDB, type IDBPDatabase } from 'idb';
import type { GameRecord } from '../shared/types';

// Bump whenever GameRecord shape or analyzer logic changes — invalidates cache.
export const SCHEMA_VERSION = 2;

export interface MonthCache {
  schemaVersion?: number;   // missing = legacy v1 (raw games only)
  gameCount?: number;
  records?: GameRecord[];
  games?: unknown[];        // legacy raw games; kept readable for one-shot migration
  storedAt: number;
}

const DB_NAME = 'btk';
const STORE = 'archives';
const VERSION = 1;

let dbPromise: Promise<IDBPDatabase> | null = null;
function db() {
  return (dbPromise ??= openDB(DB_NAME, VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    },
  }));
}

function key(nick: string, monthUrl: string) {
  return `${nick.toLowerCase()}::${monthUrl}`;
}

export async function getMonth(nick: string, monthUrl: string): Promise<MonthCache | undefined> {
  return (await db()).get(STORE, key(nick, monthUrl)) as Promise<MonthCache | undefined>;
}

export async function putMonth(nick: string, monthUrl: string, cache: MonthCache) {
  await (await db()).put(STORE, cache, key(nick, monthUrl));
}
