import type { LinkSide } from '../types';
import { axisOf, signOf, pathSegments, type Segment } from './path-geometry';
import { segmentIntersectsRect, pathCollidesWith, pathCollidesExcluding, type Rect } from './collision';

const AVOIDANCE_PADDING = 16;

function hitsInner(segs: Segment[], rects: Rect[]): boolean {
  for (let i = 1; i < segs.length - 1; i++) {
    for (const rect of rects) {
      if (segmentIntersectsRect(segs[i], rect)) return true;
    }
  }
  return false;
}

/**
 * Push `coord` past any obstacle straddling `crossPos` on the perpendicular
 * axis, so a detour leg doesn't land inside a card. `dir` is +1 to push
 * right/down, -1 to push left/up; `isHorizontal` selects which axis `coord`
 * travels along.
 */
function pushPast(
  coord: number, crossPos: number, dir: 1 | -1,
  obstacles: Rect[], pad: number, isHorizontal: boolean,
): number {
  let result = coord;
  let changed = true;
  while (changed) {
    changed = false;
    for (const rect of obstacles) {
      if (isHorizontal) {
        if (crossPos <= rect.top || crossPos >= rect.bottom) continue;
        if (result > rect.left - pad && result < rect.right + pad) {
          result = dir > 0 ? rect.right + pad : rect.left - pad;
          changed = true;
        }
      } else {
        if (crossPos <= rect.left || crossPos >= rect.right) continue;
        if (result > rect.top - pad && result < rect.bottom + pad) {
          result = dir > 0 ? rect.bottom + pad : rect.top - pad;
          changed = true;
        }
      }
    }
  }
  return result;
}

/**
 * Obstacle-edge coordinates sorted by distance from `mid`, used as detour-leg
 * candidates. `vertical` true → returns y-coordinates (top/bottom edges);
 * false → x-coordinates (left/right edges).
 */
function collectCandidates(obstacles: Rect[], pad: number, mid: number, vertical: boolean): number[] {
  const candidates: number[] = [];
  for (const rect of obstacles) {
    if (vertical) candidates.push(rect.top - pad, rect.bottom + pad);
    else candidates.push(rect.left - pad, rect.right + pad);
  }
  candidates.sort((a, b) => Math.abs(a - mid) - Math.abs(b - mid));
  return candidates;
}

function nudgeL(
  x1: number, y1: number, x2: number, y2: number,
  sourceHorizontal: boolean,
  obstacles: Rect[],
): Segment[] | null {
  const pad = AVOIDANCE_PADDING;
  const cornerX = sourceHorizontal ? x2 : x1;
  const cornerY = sourceHorizontal ? y1 : y2;

  const candidates: { segs: Segment[]; dist: number }[] = [];

  for (const rect of obstacles) {
    for (const bx of [rect.left - pad, rect.right + pad]) {
      const segs: Segment[] = [
        { x1, y1, x2: bx, y2: y1 },
        { x1: bx, y1, x2: bx, y2 },
        { x1: bx, y1: y2, x2, y2 },
      ];
      candidates.push({
        segs: segs.filter(s => s.x1 !== s.x2 || s.y1 !== s.y2),
        dist: Math.abs(bx - cornerX),
      });
    }
    for (const by of [rect.top - pad, rect.bottom + pad]) {
      const segs: Segment[] = [
        { x1, y1, x2: x1, y2: by },
        { x1, y1: by, x2, y2: by },
        { x1: x2, y1: by, x2, y2 },
      ];
      candidates.push({
        segs: segs.filter(s => s.x1 !== s.x2 || s.y1 !== s.y2),
        dist: Math.abs(by - cornerY),
      });
    }
  }

  candidates.sort((a, b) => a.dist - b.dist);

  for (const { segs } of candidates) {
    if (!pathCollidesWith(segs, obstacles)) return segs;
  }

  return null;
}

function detourL(
  x1: number, y1: number, x2: number, y2: number,
  sourceSide: LinkSide,
  sourceHorizontal: boolean,
  obstacles: Rect[],
  sourceRect: Rect,
): Segment[] | null {
  const pad = AVOIDANCE_PADDING;
  const sSign = signOf(sourceSide);

  if (sourceHorizontal) {
    const baseExitX = (sSign > 0 ? sourceRect.right : sourceRect.left) + sSign * pad;
    const exitX = pushPast(baseExitX, y1, sSign, obstacles, pad, true);
    const candidates = collectCandidates(obstacles, pad, (y1 + y2) / 2, true);

    for (const detourY of candidates) {
      const segs: Segment[] = [
        { x1, y1, x2: exitX, y2: y1 },
        { x1: exitX, y1, x2: exitX, y2: detourY },
        { x1: exitX, y1: detourY, x2, y2: detourY },
        { x1: x2, y1: detourY, x2, y2 },
      ];
      const filtered = segs.filter(s => s.x1 !== s.x2 || s.y1 !== s.y2);
      if (!hitsInner(filtered, obstacles)) return filtered;
    }
  } else {
    const baseExitY = (sSign > 0 ? sourceRect.bottom : sourceRect.top) + sSign * pad;
    const exitY = pushPast(baseExitY, x1, sSign, obstacles, pad, false);
    const candidates = collectCandidates(obstacles, pad, (x1 + x2) / 2, false);

    for (const detourX of candidates) {
      const segs: Segment[] = [
        { x1, y1, x2: x1, y2: exitY },
        { x1, y1: exitY, x2: detourX, y2: exitY },
        { x1: detourX, y1: exitY, x2: detourX, y2 },
        { x1: detourX, y1: y2, x2, y2 },
      ];
      const filtered = segs.filter(s => s.x1 !== s.x2 || s.y1 !== s.y2);
      if (!hitsInner(filtered, obstacles)) return filtered;
    }
  }

  return null;
}

/**
 * Route a connection from (x1,y1) to (x2,y2) avoiding obstacle cards. Tries
 * default path → bend-nudge → multi-segment detour.
 *
 * Returns the chosen path plus `collides`: false when the path is fully clear,
 * true when nothing cleared (fallback to the default path) or a detour still
 * grazes a card. The caller uses `collides` directly — no need to re-scan.
 *
 * `allRects` is every device rect on the map; the two endpoint rects are
 * skipped by reference so the line may start/end inside its own cards.
 *
 * Special case — **face-away geometry**: when the chosen sides share an axis
 * and point in directions that would put the Z-shape bend *inside* the cards
 * (e.g. source='left' + target='right' with the target physically to the
 * right of the source), the default path is geometrically broken. We detect
 * this up-front and route a 5-segment U-shape that honors the chosen sides
 * by exiting past each card and looping perpendicular.
 */
export function routeConnection(
  x1: number, y1: number, x2: number, y2: number,
  sourceSide: LinkSide, targetSide: LinkSide,
  bendAt: number | undefined,
  allRects: Rect[],
  sourceRect: Rect,
  targetRect: Rect,
): { segs: Segment[]; collides: boolean } {
  const sameAxis = axisOf(sourceSide) === axisOf(targetSide);
  const horizontal = axisOf(sourceSide) === 'horizontal';
  // Materialize the per-link obstacle list (every rect except the two
  // endpoints) lazily: the common case is a default path that clears all
  // obstacles, and that check runs against `allRects` directly via
  // `pathCollidesExcluding`. Only the avoidance branches (face-away U-shape,
  // bend-nudge, detour) need the filtered array, so allocating it eagerly per
  // link per frame would churn the GC at 60 fps during drags for nothing.
  let obstacleList: Rect[] | null = null;
  const obstacles = (): Rect[] =>
    (obstacleList ??= allRects.filter(r => r !== sourceRect && r !== targetRect));

  // Face-away short-circuit. The default Z's bend would land inside the cards,
  // so the chosen sides wouldn't be visible. Route a U-shape that exits past
  // each card and loops around. Falls through to the default flow if no
  // U-shape candidate clears the obstacles.
  if (sameAxis && isFaceAway(sourceSide, targetSide, sourceRect, targetRect)) {
    const u = uShapeFaceAway(x1, y1, x2, y2, sourceSide, targetSide, horizontal, sourceRect, targetRect, obstacles());
    if (u) return { segs: u, collides: pathCollidesExcluding(u, allRects, sourceRect, targetRect) };
  }

  const defaultSegs = pathSegments(x1, y1, x2, y2, sourceSide, targetSide, bendAt);
  if (!pathCollidesExcluding(defaultSegs, allRects, sourceRect, targetRect)) {
    return { segs: defaultSegs, collides: false };
  }

  // A successful nudge is validated collision-free against every obstacle, so
  // `collides` is known false. A detour only validates its inner segments, so
  // its end legs may still graze a card — scan once to be sure.
  if (sameAxis) {
    if (defaultSegs.length === 3) {
      const defaultBend = horizontal ? defaultSegs[1].x1 : defaultSegs[1].y1;
      const nudged = nudgeBend(x1, y1, x2, y2, sourceSide, targetSide, horizontal, defaultBend, obstacles());
      if (nudged) return { segs: nudged, collides: false };
    }

    const detour = detourZ(x1, y1, x2, y2, sourceSide, targetSide, horizontal, obstacles(), sourceRect, targetRect);
    if (detour) return { segs: detour, collides: pathCollidesExcluding(detour, allRects, sourceRect, targetRect) };
  } else {
    const nudged = nudgeL(x1, y1, x2, y2, horizontal, obstacles());
    if (nudged) return { segs: nudged, collides: false };

    const detour = detourL(x1, y1, x2, y2, sourceSide, horizontal, obstacles(), sourceRect);
    if (detour) return { segs: detour, collides: pathCollidesExcluding(detour, allRects, sourceRect, targetRect) };
  }

  return { segs: defaultSegs, collides: true };
}

function nudgeBend(
  x1: number, y1: number, x2: number, y2: number,
  sourceSide: LinkSide, targetSide: LinkSide,
  horizontal: boolean,
  defaultBend: number,
  obstacles: Rect[],
): Segment[] | null {
  const candidates: number[] = [];
  for (const rect of obstacles) {
    if (horizontal) {
      candidates.push(rect.left - AVOIDANCE_PADDING, rect.right + AVOIDANCE_PADDING);
    } else {
      candidates.push(rect.top - AVOIDANCE_PADDING, rect.bottom + AVOIDANCE_PADDING);
    }
  }
  candidates.sort((a, b) => Math.abs(a - defaultBend) - Math.abs(b - defaultBend));

  for (const c of candidates) {
    const segs = pathSegments(x1, y1, x2, y2, sourceSide, targetSide, c);
    if (!pathCollidesWith(segs, obstacles)) return segs;
  }
  return null;
}

/**
 * Same-axis sides face away from each other when the target's chosen edge
 * sits in the *opposite* direction from where the source's chosen side
 * points. The default Z-shape's bend then lands between (or inside) the
 * cards rather than past their facing edges, hiding the chosen sides.
 */
function isFaceAway(
  sourceSide: LinkSide, targetSide: LinkSide,
  sourceRect: Rect, targetRect: Rect,
): boolean {
  if (axisOf(sourceSide) !== axisOf(targetSide)) return false;
  const horizontal = axisOf(sourceSide) === 'horizontal';
  const sSign = signOf(sourceSide);
  const tSign = signOf(targetSide);

  if (horizontal) {
    const sourceEdge = sSign > 0 ? sourceRect.right : sourceRect.left;
    const targetEdge = tSign > 0 ? targetRect.right : targetRect.left;
    return Math.sign(targetEdge - sourceEdge) !== sSign;
  }
  const sourceEdge = sSign > 0 ? sourceRect.bottom : sourceRect.top;
  const targetEdge = tSign > 0 ? targetRect.bottom : targetRect.top;
  return Math.sign(targetEdge - sourceEdge) !== sSign;
}

/**
 * 5-segment U-shape for face-away same-axis sides. Same structure as
 * `detourZ`, but the detour-leg candidates include the *endpoint rects'*
 * outer edges (so it works with no obstacles) in addition to obstacle
 * edges. Picks the candidate closest to the endpoint midpoint that doesn't
 * hit any obstacle's interior.
 */
function uShapeFaceAway(
  x1: number, y1: number, x2: number, y2: number,
  sourceSide: LinkSide, targetSide: LinkSide,
  horizontal: boolean,
  sourceRect: Rect, targetRect: Rect,
  obstacles: Rect[],
): Segment[] | null {
  const pad = AVOIDANCE_PADDING;
  const sSign = signOf(sourceSide);
  const tSign = signOf(targetSide);

  if (horizontal) {
    const baseExitX = (sSign > 0 ? sourceRect.right : sourceRect.left) + sSign * pad;
    const baseEntryX = (tSign > 0 ? targetRect.right : targetRect.left) + tSign * pad;
    const exitX = pushPast(baseExitX, y1, sSign, obstacles, pad, true);
    const entryX = pushPast(baseEntryX, y2, tSign, obstacles, pad, true);

    const midY = (y1 + y2) / 2;
    const candidates: number[] = [
      Math.min(sourceRect.top, targetRect.top) - pad,
      Math.max(sourceRect.bottom, targetRect.bottom) + pad,
      ...collectCandidates(obstacles, pad, midY, true),
    ];
    candidates.sort((a, b) => Math.abs(a - midY) - Math.abs(b - midY));

    for (const detourY of candidates) {
      const segs: Segment[] = [
        { x1, y1, x2: exitX, y2: y1 },
        { x1: exitX, y1, x2: exitX, y2: detourY },
        { x1: exitX, y1: detourY, x2: entryX, y2: detourY },
        { x1: entryX, y1: detourY, x2: entryX, y2: y2 },
        { x1: entryX, y1: y2, x2, y2 },
      ];
      const filtered = segs.filter(s => s.x1 !== s.x2 || s.y1 !== s.y2);
      if (!hitsInner(filtered, obstacles)) return filtered;
    }
    return null;
  }

  const baseExitY = (sSign > 0 ? sourceRect.bottom : sourceRect.top) + sSign * pad;
  const baseEntryY = (tSign > 0 ? targetRect.bottom : targetRect.top) + tSign * pad;
  const exitY = pushPast(baseExitY, x1, sSign, obstacles, pad, false);
  const entryY = pushPast(baseEntryY, x2, tSign, obstacles, pad, false);

  const midX = (x1 + x2) / 2;
  const candidates: number[] = [
    Math.min(sourceRect.left, targetRect.left) - pad,
    Math.max(sourceRect.right, targetRect.right) + pad,
    ...collectCandidates(obstacles, pad, midX, false),
  ];
  candidates.sort((a, b) => Math.abs(a - midX) - Math.abs(b - midX));

  for (const detourX of candidates) {
    const segs: Segment[] = [
      { x1, y1, x2: x1, y2: exitY },
      { x1, y1: exitY, x2: detourX, y2: exitY },
      { x1: detourX, y1: exitY, x2: detourX, y2: entryY },
      { x1: detourX, y1: entryY, x2, y2: entryY },
      { x1: x2, y1: entryY, x2, y2 },
    ];
    const filtered = segs.filter(s => s.x1 !== s.x2 || s.y1 !== s.y2);
    if (!hitsInner(filtered, obstacles)) return filtered;
  }
  return null;
}

function detourZ(
  x1: number, y1: number, x2: number, y2: number,
  sourceSide: LinkSide, targetSide: LinkSide,
  horizontal: boolean,
  obstacles: Rect[],
  sourceRect: Rect,
  targetRect: Rect,
): Segment[] | null {
  const pad = AVOIDANCE_PADDING;
  const sSign = signOf(sourceSide);
  const tSign = signOf(targetSide);

  if (horizontal) {
    const baseExitX = (sSign > 0 ? sourceRect.right : sourceRect.left) + sSign * pad;
    const baseEntryX = (tSign > 0 ? targetRect.right : targetRect.left) + tSign * pad;
    const exitX = pushPast(baseExitX, y1, sSign, obstacles, pad, true);
    const entryX = pushPast(baseEntryX, y2, tSign, obstacles, pad, true);
    const candidates = collectCandidates(obstacles, pad, (y1 + y2) / 2, true);

    for (const detourY of candidates) {
      const segs: Segment[] = [
        { x1, y1, x2: exitX, y2: y1 },
        { x1: exitX, y1, x2: exitX, y2: detourY },
        { x1: exitX, y1: detourY, x2: entryX, y2: detourY },
        { x1: entryX, y1: detourY, x2: entryX, y2: y2 },
        { x1: entryX, y1: y2, x2, y2 },
      ];
      const filtered = segs.filter(s => s.x1 !== s.x2 || s.y1 !== s.y2);
      if (!hitsInner(filtered, obstacles)) return filtered;
    }
  } else {
    const baseExitY = (sSign > 0 ? sourceRect.bottom : sourceRect.top) + sSign * pad;
    const baseEntryY = (tSign > 0 ? targetRect.bottom : targetRect.top) + tSign * pad;
    const exitY = pushPast(baseExitY, x1, sSign, obstacles, pad, false);
    const entryY = pushPast(baseEntryY, x2, tSign, obstacles, pad, false);
    const candidates = collectCandidates(obstacles, pad, (x1 + x2) / 2, false);

    for (const detourX of candidates) {
      const segs: Segment[] = [
        { x1, y1, x2: x1, y2: exitY },
        { x1, y1: exitY, x2: detourX, y2: exitY },
        { x1: detourX, y1: exitY, x2: detourX, y2: entryY },
        { x1: detourX, y1: entryY, x2, y2: entryY },
        { x1: x2, y1: entryY, x2, y2 },
      ];
      const filtered = segs.filter(s => s.x1 !== s.x2 || s.y1 !== s.y2);
      if (!hitsInner(filtered, obstacles)) return filtered;
    }
  }

  return null;
}
