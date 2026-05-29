import { Chess } from 'chess.js';
import type { GameRecord, MateBucket, Piece, PromotionPiece } from '../shared/types';
import type { RawGame } from './chessApi';

export function analyzeGame(g: RawGame, nick: string): GameRecord | null {
  if (g.rules !== 'chess') return null;
  const matedColor: 'white' | 'black' | null =
    g.white.result === 'checkmated' ? 'white' :
    g.black.result === 'checkmated' ? 'black' : null;
  if (!matedColor) return null;
  if (!g.pgn) return null;

  const nickLc = nick.toLowerCase();
  let myColor: 'white' | 'black';
  if (g.white.username.toLowerCase() === nickLc) myColor = 'white';
  else if (g.black.username.toLowerCase() === nickLc) myColor = 'black';
  else return null;

  const chess = new Chess();
  try {
    chess.loadPgn(g.pgn);
  } catch {
    return null;
  }
  const moves = chess.history({ verbose: true });
  if (moves.length === 0) return null;
  const last: any = moves[moves.length - 1];
  if (!String(last.san).endsWith('#')) return null;

  const flags: string = String(last.flags ?? '');
  const buckets: MateBucket[] = [];
  if (last.piece === 'k' && flags.includes('k')) {
    buckets.push({ kind: 'castle', side: 'king' });
  } else if (last.piece === 'k' && flags.includes('q')) {
    buckets.push({ kind: 'castle', side: 'queen' });
  } else if (flags.includes('e')) {
    buckets.push({ kind: 'enpassant' });
  } else if (last.promotion) {
    const promoted = last.promotion as PromotionPiece;
    buckets.push({ kind: 'piece', piece: promoted as Piece });
    buckets.push({ kind: 'promotion' });
  } else {
    buckets.push({ kind: 'piece', piece: last.piece as Piece });
  }

  const oppKey = myColor === 'white' ? 'black' : 'white';
  const delivered = myColor !== matedColor;

  return {
    url: g.url,
    endTime: g.end_time,
    timeClass: g.time_class,
    rated: g.rated,
    myColor,
    opponent: g[oppKey].username,
    opponentRating: g[oppKey].rating,
    myResult: g[myColor].result,
    delivered,
    buckets,
    plyCount: moves.length,
  };
}
