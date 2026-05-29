import type { PlayerProfile } from '../shared/types';

const BASE = 'https://api.chess.com/pub';

export async function fetchPlayerProfile(nick: string): Promise<PlayerProfile> {
  const res = await fetchWithBackoff(`${BASE}/player/${encodeURIComponent(nick)}`);
  if (!res.ok) throw new Error(`player profile lookup failed: ${res.status}`);
  const body = await res.json();
  return {
    avatar: body.avatar,
    name: body.name,
    username: body.username ?? nick,
    url: body.url ?? `https://www.chess.com/member/${nick}`,
  };
}

export interface RawGame {
  url: string;
  pgn: string;
  end_time: number;
  time_class: 'bullet' | 'blitz' | 'rapid' | 'daily';
  time_control: string;
  rules: string;
  rated: boolean;
  white: { username: string; rating: number; result: string };
  black: { username: string; rating: number; result: string };
}

export async function fetchArchives(nick: string): Promise<string[]> {
  const res = await fetchWithBackoff(
    `${BASE}/player/${encodeURIComponent(nick)}/games/archives`
  );
  if (!res.ok) throw new Error(`archives lookup failed: ${res.status}`);
  const body = await res.json();
  return body.archives ?? [];
}

export interface MonthFetchResult {
  games: RawGame[];
}

// chess.com CORS doesn't whitelist If-None-Match / If-Modified-Since on the
// preflight, so conditional requests fail from the browser. We instead rely on
// the fact that past months are semantically immutable — see isPastMonth() in
// the worker — and trust the cache for any past-month hit.
export async function fetchMonth(monthUrl: string): Promise<MonthFetchResult> {
  const res = await fetchWithBackoff(monthUrl);
  if (!res.ok) throw new Error(`month fetch failed: ${res.status} ${monthUrl}`);
  const body = await res.json();
  return { games: body.games ?? [] };
}

async function fetchWithBackoff(url: string, init?: RequestInit): Promise<Response> {
  let delay = 1000;
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch(url, init);
    if (res.status !== 429) return res;
    const retryAfter = res.headers.get('Retry-After');
    const wait = retryAfter ? Number(retryAfter) * 1000 : delay;
    await sleep(wait);
    delay = Math.min(delay * 2, 30000);
  }
  throw new Error(`rate-limited after retries: ${url}`);
}

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}
