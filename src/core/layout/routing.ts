import type { Rect, Point } from '../model/types';

const STUB = 24;

export function routeEdge(fromRect: Rect, fromY: number, toRect: Rect, toY: number): Point[] {
  const aRight = fromRect.x + fromRect.w;
  const bRight = toRect.x + toRect.w;

  if (toRect.x - aRight >= STUB * 2) {
    const midX = (aRight + toRect.x) / 2;
    return [
      { x: aRight, y: fromY },
      { x: midX, y: fromY },
      { x: midX, y: toY },
      { x: toRect.x, y: toY },
    ];
  }
  if (fromRect.x - bRight >= STUB * 2) {
    const midX = (bRight + fromRect.x) / 2;
    return [
      { x: fromRect.x, y: fromY },
      { x: midX, y: fromY },
      { x: midX, y: toY },
      { x: bRight, y: toY },
    ];
  }
  const xOut = Math.max(aRight, bRight) + STUB;
  return [
    { x: aRight, y: fromY },
    { x: xOut, y: fromY },
    { x: xOut, y: toY },
    { x: bRight, y: toY },
  ];
}

export function pointsToPath(points: Point[]): string {
  return points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
}
