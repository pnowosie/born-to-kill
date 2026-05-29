# Plan — `born-to-kill`: chess.com checkmate stats, browser-only

## Context

A small, playful web app that answers one question for a chess.com player: **when you win (or get mated), which piece is doing the killing?** It pulls the player's full game archive from chess.com's public API, finds every game that ended in checkmate, and identifies the piece that delivered the mate — including special cases (castle-mate, en-passant-mate, promotion-mate). The output is a stats dashboard plus a leaderboard of the *shortest* mating games per piece, mirroring the spirit of chess.com's "Bishop Killer" / "Knight Killer" badges.

Constraints driving the design:
- **Browser-only.** No backend, no API keys, hosted on GitHub Pages.
- **Distributed-by-default rate-limiting.** The original worry about chess.com IP throttling is mostly resolved by their own docs: *serial* access is unlimited; only *parallel* requests get 429s. Combined with browser-per-user IP, we get the right behavior for free as long as we fetch one request at a time.
- **Heavy accounts must still be fast.** A multi-year power user can have thousands of games. Past months are immutable, so we cache hard with IndexedDB + ETag and only re-fetch the current month on revisit.

Scope chosen with the user:
- Vanilla TypeScript + Vite (small bundle, zero framework lock-in).
- Standard chess only (skip chess960, bughouse, KOTH, atomic, 3-check).
- All time classes (bullet / blitz / rapid / daily); UI-side filter to slice.
- Both rated and unrated games (UI-side filter to slice).
- Track **delivered** *and* **received** mates per piece (the user wants both — "I kill, and also if I blundered a mate").
- Hosted on GitHub Pages.

---

## Architecture at a glance

```
[ UI thread ]                          [ Web Worker ]
  nick input ─────────► startAnalysis(nick) ──► fetchPipeline ──┐
  progress events  ◄──── postMessage ─────────  parsePipeline ──┤
  live stats        ◄─── postMessage ─────────  aggregate ──────┘
                                                    │
                                                    ▼
                                              [ IndexedDB ]
                                              ├─ archives/{user}/{YYYY-MM} → { etag, lastModified, games }
                                              └─ meta/{user} → { lastFullScanAt, schemaVersion }
```

- **UI thread**: form, progress bar, charts, filters. Stays responsive — no heavy work.
- **Web worker**: HTTP fetches + PGN parsing + aggregation. Posts incremental updates so the dashboard fills in live.
- **IndexedDB**: per-month raw archive + ETag. Recomputed stats are *not* persisted — they're cheap to re-derive from cached raw data and that avoids stale-schema problems.

---

## External API surface (chess.com Published-Data API)

Three endpoints, no auth needed:

1. `GET https://api.chess.com/pub/player/{username}/games/archives` → `{ archives: ["…/2024/01", "…/2024/02", …] }`
2. `GET https://api.chess.com/pub/player/{username}/games/{YYYY}/{MM}` → `{ games: [{ pgn, end_time, time_class, time_control, rules, rated, white:{username,rating,result}, black:{username,rating,result}, url, … }, …] }`
3. (Not used) `…/pgn` variant — we want the JSON form to access `result` without parsing PGN.

Key field: each player's `result` is one of `"win" | "checkmated" | "resigned" | "timeout" | "abandoned" | "stalemate" | "agreed" | "repetition" | "insufficient" | "50move" | …`. If neither player is `"checkmated"`, **we skip PGN parsing** for that game.

Caching headers: responses include `ETag` and `Last-Modified`; we re-send them as `If-None-Match` / `If-Modified-Since` and accept `304 Not Modified` to use the cached JSON.

---

## Project layout

```
born-to-kill/
├─ index.html
├─ vite.config.ts
├─ tsconfig.json
├─ package.json
├─ src/
│  ├─ main.ts                 # bootstraps UI, wires worker
│  ├─ ui/
│  │  ├─ form.ts              # nick input + submit
│  │  ├─ progress.ts          # months fetched / games analyzed
│  │  ├─ dashboard.ts         # per-piece bars, specials counters, filters
│  │  └─ shortlist.ts         # shortest mating games table
│  ├─ worker/
│  │  ├─ analysis.worker.ts   # entry point; receives {nick}, emits events
│  │  ├─ chessApi.ts          # serial fetch + ETag + 429 backoff
│  │  ├─ pgnAnalyzer.ts       # chess.js replay → mating-piece extraction
│  │  ├─ aggregator.ts        # rolling stats (delivered/received × piece × time_class)
│  │  └─ db.ts                # IndexedDB wrapper (raw archives + ETag)
│  └─ shared/
│     ├─ types.ts             # GameRecord, MateBucket, Stats, WorkerEvent
│     └─ constants.ts         # piece keys, special-bucket keys
└─ .github/workflows/pages.yml  # build + deploy to GH Pages
```

Dependencies (one runtime, one dev):
- **`chess.js`** — PGN replay, `isCheckmate()`, `isEnPassant()`, `isKingsideCastle()`, `isQueensideCastle()`, `.piece`, `.promotion`.
- **`idb`** — tiny IndexedDB wrapper (saves writing the raw API by hand).

Charts: small hand-rolled SVG bars (no library needed for one bar chart and a counter row).

---

## Data model (`src/shared/types.ts`)

```ts
type Piece = 'p' | 'n' | 'b' | 'r' | 'q' | 'k';
type MateBucket =
  | { kind: 'piece'; piece: Piece }                      // p/n/b/r/q/k
  | { kind: 'castle'; side: 'king' | 'queen' }           // O-O# / O-O-O#
  | { kind: 'enpassant' }                                // exf6# e.p.
  | { kind: 'promotion'; promoted: Exclude<Piece,'p'|'k'> }; // pawn promotes & mates

interface GameRecord {
  url: string;              // chess.com game URL
  endTime: number;          // unix seconds
  timeClass: 'bullet' | 'blitz' | 'rapid' | 'daily';
  rated: boolean;
  myColor: 'white' | 'black';
  opponent: string;
  opponentRating: number;
  myResult: 'checkmated' | 'win' | string;  // only mate-ending games stored
  delivered: boolean;       // did I deliver the mate?
  buckets: MateBucket[];    // usually 1; promotion-mate produces 2 (promoted piece + promotion)
  plyCount: number;         // for "shortest wins" leaderboard
}
```

The aggregator builds totals on the fly from these records — nothing fancier needed.

---

## Worker pipeline (the meat of it)

`analysis.worker.ts` exposes one handler: `start({ nick })`. It runs three phases, each emitting progress events.

### Phase A — list archives
```ts
const { archives } = await fetchJson(`/pub/player/${nick}/games/archives`);
post({ type: 'archives', months: archives.length });
```

### Phase B — serial fetch, URL-immutability cache (the rate-limit-safe loop)
```ts
for (const url of archives) {
  const cached = await db.getMonth(nick, url);
  let games: RawGame[];
  if (cached && isPastMonth(url)) {
    games = cached.games;     // past months are immutable — trust the cache
  } else {
    const res = await fetchWithBackoff(url);   // current month, or first-ever
    games = (await res.json()).games ?? [];
    await db.putMonth(nick, url, { games, storedAt: Date.now() });
  }
  post({ type: 'month-done', url, gameCount: games.length });
  feedToAnalyzer(games);
}

function isPastMonth(monthUrl: string): boolean {
  const m = monthUrl.match(/\/(\d{4})\/(\d{1,2})\/?$/);
  if (!m) return false;
  const [, y, mo] = m;
  const now = new Date();
  return +y < now.getUTCFullYear()
      || (+y === now.getUTCFullYear() && +mo < now.getUTCMonth() + 1);
}
```

**Why no `If-None-Match` / `If-Modified-Since`?** chess.com's CORS preflight does NOT whitelist these headers, so any conditional request from a browser is blocked at preflight. The docs describe ETag support, but it only works from a server context. Since a monthly archive URL is by definition immutable once that month ends, we don't actually need the server to confirm — we just check `isPastMonth(url)` and trust the local cache. Only the current month re-fetches each session.

`fetchWithBackoff`: serial caller, on 429 respects `Retry-After` (or falls back to exponential 1s/2s/4s/8s capped at 30s). Never parallel; chess.com promises serial is unlimited.

### Phase C — analyze checkmate games
```ts
function feedToAnalyzer(games: RawGame[]) {
  for (const g of games) {
    if (g.rules !== 'chess') continue;                          // skip variants
    const mated = g.white.result === 'checkmated' ? 'white'
                : g.black.result === 'checkmated' ? 'black' : null;
    if (!mated) continue;                                       // skip non-mate endings

    const record = analyzePgn(g, nick, mated);                  // see pgnAnalyzer.ts
    if (record) aggregator.add(record);
  }
  post({ type: 'stats', snapshot: aggregator.snapshot() });
}
```

### `pgnAnalyzer.ts` — extracting the mating piece

This is the only piece of real logic. Uses `chess.js`:

```ts
import { Chess } from 'chess.js';

export function analyzePgn(g: RawGame, nick: string, matedColor: 'white'|'black'): GameRecord | null {
  const chess = new Chess();
  try { chess.loadPgn(g.pgn); } catch { return null; }
  const moves = chess.history({ verbose: true });
  if (moves.length === 0) return null;
  const last = moves[moves.length - 1];
  if (!last.san.endsWith('#')) return null;                     // sanity check

  // Bucket the move. A game lands in 1 bucket, except promotion-mate which lands in 2.
  const buckets: MateBucket[] = [];
  if (last.isKingsideCastle?.()) {
    buckets.push({ kind: 'castle', side: 'king' });
  } else if (last.isQueensideCastle?.()) {
    buckets.push({ kind: 'castle', side: 'queen' });
  } else if (last.isEnPassant?.()) {
    buckets.push({ kind: 'enpassant' });
  } else if (last.promotion) {
    // Count in BOTH the promoted-piece bucket AND the promotion bucket.
    buckets.push({ kind: 'piece', piece: last.promotion as Piece });
    buckets.push({ kind: 'promotion', promoted: last.promotion as any });
  } else {
    buckets.push({ kind: 'piece', piece: last.piece as Piece });
  }

  const myColor: 'white'|'black' =
    g.white.username.toLowerCase() === nick.toLowerCase() ? 'white' : 'black';
  const delivered = myColor !== matedColor;

  return {
    url: g.url, endTime: g.end_time, timeClass: g.time_class, rated: g.rated,
    myColor, opponent: g[myColor === 'white' ? 'black' : 'white'].username,
    opponentRating: g[myColor === 'white' ? 'black' : 'white'].rating,
    myResult: g[myColor].result, delivered, buckets,
    plyCount: moves.length,
  };
}
```

The aggregator iterates `record.buckets` and counts the same record once per bucket — so a promotion-to-bishop mate increments both `Killer Bishop` and `Promotion` tallies (and appears in both shortlists).

```ts
function add(record: GameRecord) {
  for (const b of record.buckets) {
    const key = bucketKey(b);            // stable string like "piece:b" or "promotion:n"
    const slot = this.bins[key] ??= { delivered: 0, received: 0, records: [] };
    record.delivered ? slot.delivered++ : slot.received++;
    slot.records.push(record);
  }
}
```

**Bucket conventions (decisions locked):**
- **Castle-mate**: its own bucket only, *not* a rook-mate. `last.piece` is `'k'` for castles; we override.
- **En-passant-mate**: its own bucket only, *not* a pawn-mate.
- **Promotion-mate**: counted in **two** buckets — the promoted piece (`Q`/`R`/`B`/`N`) AND a `Promotion` bucket. A pawn that promotes to a bishop and mates appears in both `Killer Bishop` and `Promotion` tallies/shortlists.
- **Discovered / king-move mate**: chess.js reports `piece: 'k'` because the king is what moved. We attribute to the king (`Killer King` bucket) — no discovery tracking. Simple, matches user spec.

---

## UI sketch

One page, three sections:

1. **Header**: nick input + "Analyze" button. While running: live progress (`Fetched 47/63 months · Analyzed 1,283 games · 142 mates found`).
2. **Filters**: a row above the badges — time class chips (`bullet / blitz / rapid / daily / all`), rated toggle. Filters re-derive stats from the in-memory `GameRecord[]` (no re-fetch).
3. **Badge wall** — see next section.

Stats update incrementally as months finish — feels live without any websocket nonsense.

---

## Badge wall (the centerpiece)

Visually inspired by chess.com's "Killer" badge set (Killer Pawn, Killer Knight, Killer Bishop, Killer Rook, Killer Queen, Killer King). Each bucket gets a tile:

```
┌─────────────────────────┐
│       [BADGE IMAGE]     │
│                         │
│      Killer Bishop      │
│                         │
│      14   /   3         │   ← green delivered  /  red received
│   (delivered)(blundered)│
│                         │
│   ▾ shortest games      │   ← <details>/<summary> disclosure
└─────────────────────────┘
```

- **Counters**: big number, two colors. Green = delivered (you mated), red = received (you got mated). If a bucket has zero of both, render the tile greyed out (like the locked badges in the chess.com screenshot).
- **Disclosure**: native `<details><summary>` (no JS framework needed) — clicking the chevron expands the tile to reveal the shortlist. Browser-built-in keyboard accessibility, no a11y plumbing.

### Shortlist logic (per bucket)

Up to **5 games**, sorted ascending by `plyCount` (fewer moves = top). Soft constraint: **prefer at least 2 wins** in the visible list, when wins exist in the bucket.

```ts
function pickShortlist(records: GameRecord[]): GameRecord[] {
  const wins   = records.filter(r => r.delivered).sort((a,b) => a.plyCount - b.plyCount);
  const losses = records.filter(r => !r.delivered).sort((a,b) => a.plyCount - b.plyCount);

  // Reserve up to 2 slots for the shortest wins (if any exist).
  const reservedWins = wins.slice(0, Math.min(2, wins.length));

  // Fill remaining slots with the globally shortest games NOT already picked.
  const remaining = [...wins.slice(reservedWins.length), ...losses]
    .sort((a,b) => a.plyCount - b.plyCount)
    .slice(0, 5 - reservedWins.length);

  return [...reservedWins, ...remaining].sort((a,b) => a.plyCount - b.plyCount);
}
```

This guarantees ≥2 wins when ≥2 exist, otherwise includes all wins available, and otherwise fills purely by shortest. The final return is re-sorted by ply so the display stays ordered.

### Row rendering inside the disclosure

```
🟢 won in 11 moves   vs OpponentName (1456)   2025-03-14   ↗ chess.com
🟢 won in 14 moves   vs OtherName (1389)      2025-01-02   ↗
🔴 lost in 17 moves  vs ThirdName (1502)      2024-11-20   ↗
🔴 lost in 19 moves  vs FourthName (1488)     2024-08-09   ↗
🔴 lost in 23 moves  vs FifthName (1521)      2024-05-30   ↗
```

Each row's `↗` is `<a href={GameRecord.url} target="_blank" rel="noopener">`.

### Specials (castle / en-passant / promotion)

The chess.com badge set doesn't have these. Three options, in order of cheap → fancy:
- **v1 (recommended)**: render specials as smaller "trophy" tiles below the main 6, using a CSS-styled SVG glyph (`♔→♖` for castle, `↗ e.p.` for en-passant, `♙→♕` for promotion) instead of a raster badge. Same counters + disclosure as the main badges.
- **v2**: hand-draw badges in the same orange-on-charcoal style (out of scope for now).

### Badge assets

Six PNGs cropped from the screenshot the user provided (`/Users/pnowosie/.claude/image-cache/12261413-fa2a-4523-92aa-df9e98d717c3/1.png`). Implementation step at execution time:
1. Inspect image dimensions with `sips -g pixelWidth -g pixelHeight`.
2. Crop the 6 active tiles (top row: Pawn, Knight, Bishop, Rook; bottom row first two: Queen, King) using `sips -c` or `magick convert ... -crop WxH+X+Y`, output to `public/badges/{pawn,knight,bishop,rook,queen,king}.png`. The two "locked" tiles are skipped.
3. The greyed-out empty state is a CSS `filter: grayscale(1) opacity(0.4)` on the same asset — no extra files needed.

**Asset caveat**: these badge graphics are chess.com's IP. Fine for personal/local use; if this ever goes public-public, swap in original artwork in the same visual style. Noting it so it's on the record.

---

## Caching & re-runs

- First run on a new nick: serial fetch every month → store raw JSON + ETag → parse only mate-ending games → render.
- Repeat run: every past month responds `304` (cheap), only the current month re-fetches its full JSON. Re-aggregation is cheap CPU.
- Schema version stamped on the DB; bump it to invalidate caches when `GameRecord` or bucketing logic changes.

---

## Performance budget

A heavy account: ~60 months × ~300 games = ~18,000 games. Of those, maybe ~1,500 end by checkmate (the rest are resignations / timeouts). PGN parsing those 1,500 with chess.js in a worker is well under 10 seconds on a modern laptop. Network is the bottleneck on the first run: 60 serial requests × ~150ms = ~10 seconds. Subsequent runs: all 304s, sub-second.

---

## Verification plan

1. **Local dev**: `npm create vite@latest born-to-kill -- --template vanilla-ts`, then `npm i chess.js idb`. `npm run dev` and try a few nicks:
   - A small fresh account (a few games, predictable buckets).
   - The user's own nick (real-world load).
   - A known account with chess960 games — confirm variants are filtered out.
2. **Unit test the analyzer**: hand-craft 8–10 PGN strings exercising each bucket (queen mate, rook mate, knight mate, smothered mate by knight, castle-mate via `O-O#`, `O-O-O#`, en-passant-mate, promotion-mate to Q, promotion-mate to N, discovered king-move mate). Run with `vitest`.
   Also unit-test `pickShortlist`: 4 cases — (a) ≥2 wins and ≥3 losses, expect 2 shortest wins + 3 shortest losses; (b) 1 win + 5 losses, expect 1 win + 4 losses; (c) 0 wins + 6 losses, expect 5 losses; (d) 7 wins + 2 losses, expect 5 shortest wins (the "prefer wins" floor never crowds out genuinely shorter games).
3. **Manual sanity check**: open chess.com for the same nick, eyeball that the "shortest queen mate" the app surfaces is actually a queen-mate on chess.com's site.
4. **Cache verification**: run twice in the same browser session, confirm the second run shows mostly 304s in DevTools Network panel (will require disabling Vite's dev caching to see honestly — easier to verify on built output).
5. **Rate-limit verification**: throttle to "slow 3G" in DevTools and confirm serial behavior — should never see a 429.
6. **Deploy to GH Pages**: `.github/workflows/pages.yml` builds with Vite and publishes `dist/` on push to main. Verify the live URL works end-to-end with a real nick.

---

## In v1, decisions locked

- **Promotion**: dual-bucket (promoted piece + Promotion). ✅
- **Aliases**: only the current nick the user types in is used; historical username changes on chess.com may mis-attribute color in old games — accepted trade-off. ✅
- **King-move mate**: attributed to king bucket; no discovered-check tracking. ✅
- **Deep link `?nick=foo`**: on page load, read `URLSearchParams.get('nick')`; if present, prefill the input and auto-submit. When user submits the form, `history.replaceState` to update the URL. One copy-pasteable share link per player. ✅
