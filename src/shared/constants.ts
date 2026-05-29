import type { MateBucket, Piece } from './types';
import { bucketKey } from './types';

export interface BadgeMeta {
  key: string;
  title: string;
  bucket: MateBucket;
  image?: string;
  glyph?: string;
  cssClass?: string;
}

const piece = (p: Piece, title: string, image: string): BadgeMeta => ({
  key: bucketKey({ kind: 'piece', piece: p }),
  title,
  bucket: { kind: 'piece', piece: p },
  image,
});

export const BADGES: BadgeMeta[] = [
  piece('p', 'Killer Pawn', 'badges/pawn.png'),
  piece('n', 'Killer Knight', 'badges/knight.png'),
  piece('b', 'Killer Bishop', 'badges/bishop.png'),
  piece('r', 'Killer Rook', 'badges/rook.png'),
  piece('q', 'Killer Queen', 'badges/queen.png'),
  piece('k', 'Killer King', 'badges/king.png'),
  {
    key: bucketKey({ kind: 'castle', side: 'king' }),
    title: 'Castle Mate O-O',
    bucket: { kind: 'castle', side: 'king' },
    glyph: 'O-O#',
    cssClass: 'special',
  },
  {
    key: bucketKey({ kind: 'castle', side: 'queen' }),
    title: 'Castle Mate O-O-O',
    bucket: { kind: 'castle', side: 'queen' },
    glyph: 'O-O-O#',
    cssClass: 'special',
  },
  {
    key: bucketKey({ kind: 'enpassant' }),
    title: 'En Passant Mate',
    bucket: { kind: 'enpassant' },
    glyph: 'e.p.#',
    cssClass: 'special',
  },
  {
    key: bucketKey({ kind: 'promotion' }),
    title: 'Promotion Mate',
    bucket: { kind: 'promotion' },
    glyph: '♙→♛#',
    cssClass: 'special',
  },
];
