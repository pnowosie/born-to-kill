# born-to-kill

A browser-only chess.com checkmate-stats app. Type a chess.com nickname, the app pulls every monthly archive via the public API, finds every game that ended in checkmate, and tells you which piece delivered the mate.

Inspired by chess.com's *Killer Piece* badges.

## Why?

A friend was looking over my shoulder at a game I'd just won — a tidy short knight checkmate — and got that very specific shade of competitive-jealous. *"You know chess.com has a Killer Knight badge for that, right?"*

I did not.

Turns out chess.com quietly hands out **Killer Pawn / Knight / Bishop / Rook / Queen / King** badges when you mate with each piece. I checked. I had a few. I was inordinately proud of the *Killer King* — those discovered mates where the king sashays out of the way and a rook does the deed have a certain *flair*.

But chess.com's badge page only tells you *that* you earned each one. Not which mate was your shortest. Not how often you've been on the *receiving* end ("Killed By Knight" — the badge of shame they will never ship). So: this app. Type your nick, get your full kill/death ledger sorted by piece, plus three bonus categories chess.com doesn't cover at all: castle-mates, en-passant-mates, and pawn-promotion mates.

Built because chess is fun, stats are fun, and bragging rights are **especially** fun.

## Local dev

```sh
npm install
npm run dev
```

Build:

```sh
npm run build
```

## How it works

See [`docs/plan.md`](docs/plan.md).
