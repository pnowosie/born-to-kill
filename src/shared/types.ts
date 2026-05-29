export type Piece = 'p' | 'n' | 'b' | 'r' | 'q' | 'k';
export type PromotionPiece = 'n' | 'b' | 'r' | 'q';
export type TimeClass = 'bullet' | 'blitz' | 'rapid' | 'daily';

export type MateBucket =
  | { kind: 'piece'; piece: Piece }
  | { kind: 'castle'; side: 'king' | 'queen' }
  | { kind: 'enpassant' }
  | { kind: 'promotion' };

export interface GameRecord {
  url: string;
  endTime: number;
  timeClass: TimeClass;
  rated: boolean;
  myColor: 'white' | 'black';
  opponent: string;
  opponentRating: number;
  myResult: string;
  delivered: boolean;
  buckets: MateBucket[];
  plyCount: number;
}

export interface PlayerProfile {
  avatar?: string;
  name?: string;
  username: string;
  url: string;
}

// Per-month histogram of *all* games keyed by time class + rated flag, so the
// dashboard can show games/mates counts that respect the active filters without
// keeping a record for every non-mate game. See tallyKey().
export type GameTally = Record<string, number>;

export function tallyKey(timeClass: TimeClass, rated: boolean): string {
  return `${timeClass}|${rated ? 'r' : 'u'}`;
}

export type WorkerInbound = { type: 'start'; nick: string };

export type WorkerOutbound =
  | { type: 'player'; profile: PlayerProfile }
  | { type: 'tick'; month: string }
  | {
      type: 'month-done';
      gamesInMonth: number;
      matesInMonth: number;
      records: GameRecord[];
      tally: GameTally;
    }
  | { type: 'done' }
  | { type: 'error'; message: string };

export function bucketKey(b: MateBucket): string {
  switch (b.kind) {
    case 'piece':
      return `piece:${b.piece}`;
    case 'castle':
      return `castle:${b.side}`;
    case 'enpassant':
      return 'enpassant';
    case 'promotion':
      return 'promotion';
  }
}
