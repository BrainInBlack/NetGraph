import type { LinkSide } from '../types';

// Below this perpendicular distance a Z collapses to a single straight segment
// at the midpoint, instead of squeezing in a sub-16-px bend leg that reads as a
// tiny S-curve.
export const MIN_PERPENDICULAR = 16;

export type Axis = 'horizontal' | 'vertical';

export const axisOf = (s: LinkSide): Axis =>
  (s === 'left' || s === 'right') ? 'horizontal' : 'vertical';

/** +1 if the side faces the positive direction (right/bottom), -1 otherwise. */
export const signOf = (s: LinkSide): 1 | -1 =>
  (s === 'right' || s === 'bottom') ? 1 : -1;

// Axis-aligned by construction — every Segment from pathSegments has either
// x1 === x2 or y1 === y2. segmentIntersectsRect and segmentsToPath both rely
// on this invariant.
export interface Segment {
  x1: number; y1: number;
  x2: number; y2: number;
}

const CORNER_RADIUS = 10;

/**
 * Underlying axis-aligned skeleton of an orthogonal connection path. Three
 * shapes — Z (3 segments, same-axis sides, perpendicular distance OK),
 * straight (1 segment, same-axis sides too close), L (2 segments, mixed-axis
 * sides). The renderer wraps these segments in rounded Q corners; the
 * collision check uses them directly. Single source of truth so the two
 * consumers can't drift.
 */
export function pathSegments(
  x1: number, y1: number, x2: number, y2: number,
  sourceSide: LinkSide, targetSide: LinkSide,
  bendAt?: number,
): Segment[] {
  const sourceHorizontal = axisOf(sourceSide) === 'horizontal';
  const targetHorizontal = axisOf(targetSide) === 'horizontal';
  const dx = x2 - x1;
  const dy = y2 - y1;

  if (sourceHorizontal === targetHorizontal) {
    if (sourceHorizontal) {
      if (Math.abs(dy) < MIN_PERPENDICULAR) {
        const y = (y1 + y2) / 2;
        return [{ x1, y1: y, x2, y2: y }];
      }
      const bx = bendAt ?? x1 + dx / 2;
      return [
        { x1, y1, x2: bx, y2: y1 },
        { x1: bx, y1, x2: bx, y2 },
        { x1: bx, y1: y2, x2, y2 },
      ];
    }
    if (Math.abs(dx) < MIN_PERPENDICULAR) {
      const x = (x1 + x2) / 2;
      return [{ x1: x, y1, x2: x, y2 }];
    }
    const by = bendAt ?? y1 + dy / 2;
    return [
      { x1, y1, x2: x1, y2: by },
      { x1, y1: by, x2, y2: by },
      { x1: x2, y1: by, x2, y2 },
    ];
  }

  if (sourceHorizontal) {
    return [
      { x1, y1, x2, y2: y1 },
      { x1: x2, y1, x2, y2 },
    ];
  }
  return [
    { x1, y1, x2: x1, y2 },
    { x1, y1: y2, x2, y2 },
  ];
}

/**
 * Label anchor point for a segment skeleton: the midpoint of the *visible* span
 * of the path. Endpoints sit at card centers (the cards cover the line ends), so
 * `startInset` / `endInset` are the lengths tucked under the source and target
 * cards — their half-extent along the exit/entry axis. We center on the span
 * between those two cards rather than on the raw center-to-center path, so the
 * label reads as centered *between the nodes*, not pulled toward the larger one.
 *
 * Walking by arc length (rather than picking a segment by index) keeps the label
 * on a straight run and off the corners, and stays centered even when the legs
 * are lopsided. With both insets 0 this is just the half-length midpoint.
 */
export function labelAnchor(
  segs: Segment[],
  startInset = 0,
  endInset = 0,
): { x: number; y: number } {
  if (segs.length === 0) return { x: 0, y: 0 };

  // Segments are axis-aligned, so length is the Manhattan delta.
  const lengths = segs.map(s => Math.abs(s.x2 - s.x1) + Math.abs(s.y2 - s.y1));
  const total = lengths.reduce((a, b) => a + b, 0);

  // Midpoint of the visible span [startInset, total - endInset]. If the insets
  // cross (cards overlapping / nearly touching), fall back to the raw midpoint.
  // Bounds are deliberately exclusive: a target of exactly 0 or `total` lands the
  // label on an endpoint (under a card), so treat that as a cross too.
  let target = (startInset + (total - endInset)) / 2;
  if (!(target > 0 && target < total)) target = total / 2;

  let remaining = target;
  for (let i = 0; i < segs.length; i++) {
    const len = lengths[i];
    // Land within this segment (or stop on the last one to absorb FP drift).
    if (remaining <= len || i === segs.length - 1) {
      const t = len === 0 ? 0 : remaining / len;
      const s = segs[i];
      return { x: s.x1 + (s.x2 - s.x1) * t, y: s.y1 + (s.y2 - s.y1) * t };
    }
    remaining -= len;
  }

  // Unreachable (loop always returns on the last segment), but keeps TS happy.
  const s = segs[0];
  return { x: (s.x1 + s.x2) / 2, y: (s.y1 + s.y2) / 2 };
}

/**
 * Serialize the segment skeleton as an SVG `d` string with rounded Q corners
 * at each junction. Segments are axis-aligned, so every junction is a 90°
 * turn. The corner radius is clamped to half the length of each adjacent
 * segment — for a Z's middle segment that's two corners sharing the run,
 * which is why an over-tight Z (just past MIN_PERPENDICULAR) draws as a
 * smooth S without a straight middle.
 */
export function segmentsToPath(segs: Segment[]): string {
  if (segs.length === 1) {
    const s = segs[0];
    return `M ${s.x1} ${s.y1} L ${s.x2} ${s.y2}`;
  }
  const r = CORNER_RADIUS;
  let path = `M ${segs[0].x1} ${segs[0].y1}`;
  for (let i = 0; i < segs.length - 1; i++) {
    const cur = segs[i];
    const next = segs[i + 1];
    const cx = cur.x2;
    const cy = cur.y2;
    const curLen = Math.abs(cur.x2 - cur.x1) + Math.abs(cur.y2 - cur.y1);
    const nextLen = Math.abs(next.x2 - next.x1) + Math.abs(next.y2 - next.y1);
    const rCur = Math.min(r, curLen / 2);
    const rNext = Math.min(r, nextLen / 2);
    const dxCur = Math.sign(cur.x2 - cur.x1);
    const dyCur = Math.sign(cur.y2 - cur.y1);
    const dxNext = Math.sign(next.x2 - next.x1);
    const dyNext = Math.sign(next.y2 - next.y1);
    path += ` L ${cx - rCur * dxCur} ${cy - rCur * dyCur}`;
    path += ` Q ${cx} ${cy} ${cx + rNext * dxNext} ${cy + rNext * dyNext}`;
  }
  const last = segs[segs.length - 1];
  path += ` L ${last.x2} ${last.y2}`;
  return path;
}
