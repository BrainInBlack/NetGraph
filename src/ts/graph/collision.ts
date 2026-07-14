import type { Segment } from './path-geometry';

export interface Rect {
  left: number; right: number;
  top: number; bottom: number;
}

/**
 * Strict - a segment lying exactly on a rect edge doesn't count. Endpoints
 * touching an edge are fine; the segment must enter the interior.
 */
export function segmentIntersectsRect(seg: Segment, rect: Rect): boolean {
  const horizontal = seg.y1 === seg.y2;
  if (horizontal) {
    const y = seg.y1;
    if (y <= rect.top || y >= rect.bottom) return false;
    const lo = Math.min(seg.x1, seg.x2);
    const hi = Math.max(seg.x1, seg.x2);
    return hi > rect.left && lo < rect.right;
  }
  const x = seg.x1;
  if (x <= rect.left || x >= rect.right) return false;
  const lo = Math.min(seg.y1, seg.y2);
  const hi = Math.max(seg.y1, seg.y2);
  return hi > rect.top && lo < rect.bottom;
}

export function pathCollidesWith(segments: Segment[], rects: Iterable<Rect>): boolean {
  for (const seg of segments) {
    for (const rect of rects) {
      if (segmentIntersectsRect(seg, rect)) return true;
    }
  }
  return false;
}

/** Like `pathCollidesWith`, but skips two rects (the endpoint cards) by reference. */
export function pathCollidesExcluding(
  segments: Segment[], rects: Rect[], ignoreA: Rect, ignoreB: Rect,
): boolean {
  for (const rect of rects) {
    if (rect === ignoreA || rect === ignoreB) continue;
    for (const seg of segments) {
      if (segmentIntersectsRect(seg, rect)) return true;
    }
  }
  return false;
}
