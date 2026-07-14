import { describe, it, expect } from 'vitest';
import { pathSegments, segmentsToPath, labelAnchor } from './path-geometry';

// -- pathSegments ------------------------------------------------

describe('pathSegments', () => {
  it('same-axis horizontal Z - 3 segments with bend leg', () => {
    const segs = pathSegments(0, 0, 200, 100, 'right', 'left');
    expect(segs).toHaveLength(3);
    expect(segs[0]).toEqual({ x1: 0, y1: 0, x2: 100, y2: 0 });
    expect(segs[1]).toEqual({ x1: 100, y1: 0, x2: 100, y2: 100 });
    expect(segs[2]).toEqual({ x1: 100, y1: 100, x2: 200, y2: 100 });
  });

  it('same-axis horizontal Z - honors custom bendAt', () => {
    const segs = pathSegments(0, 0, 200, 100, 'right', 'left', 50);
    expect(segs[0].x2).toBe(50);
    expect(segs[1].x1).toBe(50);
    expect(segs[2].x1).toBe(50);
  });

  it('same-axis horizontal - collapses to straight line under MIN_PERPENDICULAR', () => {
    const segs = pathSegments(0, 0, 200, 10, 'right', 'left');
    expect(segs).toHaveLength(1);
    expect(segs[0]).toEqual({ x1: 0, y1: 5, x2: 200, y2: 5 });
  });

  it('same-axis vertical Z - 3 segments with horizontal bend leg', () => {
    const segs = pathSegments(0, 0, 100, 200, 'bottom', 'top');
    expect(segs).toHaveLength(3);
    expect(segs[0]).toEqual({ x1: 0, y1: 0, x2: 0, y2: 100 });
    expect(segs[1]).toEqual({ x1: 0, y1: 100, x2: 100, y2: 100 });
    expect(segs[2]).toEqual({ x1: 100, y1: 100, x2: 100, y2: 200 });
  });

  it('same-axis vertical - collapses to straight line under MIN_PERPENDICULAR', () => {
    const segs = pathSegments(0, 0, 10, 200, 'bottom', 'top');
    expect(segs).toHaveLength(1);
    expect(segs[0]).toEqual({ x1: 5, y1: 0, x2: 5, y2: 200 });
  });

  it('mixed-axis L - source horizontal, corner at (x2, y1)', () => {
    const segs = pathSegments(0, 0, 200, 100, 'right', 'top');
    expect(segs).toHaveLength(2);
    expect(segs[0]).toEqual({ x1: 0, y1: 0, x2: 200, y2: 0 });
    expect(segs[1]).toEqual({ x1: 200, y1: 0, x2: 200, y2: 100 });
  });

  it('mixed-axis L - source vertical, corner at (x1, y2)', () => {
    const segs = pathSegments(0, 0, 200, 100, 'bottom', 'left');
    expect(segs).toHaveLength(2);
    expect(segs[0]).toEqual({ x1: 0, y1: 0, x2: 0, y2: 100 });
    expect(segs[1]).toEqual({ x1: 0, y1: 100, x2: 200, y2: 100 });
  });

  it('every emitted segment is axis-aligned', () => {
    const cases: Parameters<typeof pathSegments>[] = [
      [0, 0, 200, 100, 'right', 'left'],
      [0, 0, 100, 200, 'bottom', 'top'],
      [0, 0, 200, 100, 'right', 'top'],
      [0, 0, 200, 100, 'bottom', 'left'],
      [0, 0, 200, 10, 'right', 'left'],
    ];
    for (const args of cases) {
      for (const s of pathSegments(...args)) {
        expect(s.x1 === s.x2 || s.y1 === s.y2).toBe(true);
      }
    }
  });
});

// -- segmentsToPath ----------------------------------------------

describe('segmentsToPath', () => {
  it('straight segment - single M/L, no corners', () => {
    const segs = pathSegments(0, 0, 200, 10, 'right', 'left');
    expect(segmentsToPath(segs)).toBe('M 0 5 L 200 5');
  });

  it('horizontal Z - two rounded corners', () => {
    const segs = pathSegments(0, 0, 200, 100, 'right', 'left');
    expect(segmentsToPath(segs)).toBe(
      'M 0 0 L 90 0 Q 100 0 100 10 L 100 90 Q 100 100 110 100 L 200 100'
    );
  });

  it('vertical Z - two rounded corners', () => {
    const segs = pathSegments(0, 0, 100, 200, 'bottom', 'top');
    expect(segmentsToPath(segs)).toBe(
      'M 0 0 L 0 90 Q 0 100 10 100 L 90 100 Q 100 100 100 110 L 100 200'
    );
  });

  it('L source-horizontal - single rounded corner', () => {
    const segs = pathSegments(0, 0, 200, 100, 'right', 'top');
    expect(segmentsToPath(segs)).toBe('M 0 0 L 190 0 Q 200 0 200 10 L 200 100');
  });

  it('L source-vertical - single rounded corner', () => {
    const segs = pathSegments(0, 0, 200, 100, 'bottom', 'left');
    expect(segmentsToPath(segs)).toBe('M 0 0 L 0 90 Q 0 100 10 100 L 200 100');
  });

  it('over-tight Z - corner radius clamps to half the short middle segment', () => {
    // |dy| = 16 (just above MIN_PERPENDICULAR) -> Z with a 16-px middle leg.
    // Each corner radius clamps to 8, so the two corners meet with no straight
    // middle run - the "smooth S" case.
    const segs = pathSegments(0, 0, 200, 16, 'right', 'left');
    expect(segmentsToPath(segs)).toBe(
      'M 0 0 L 90 0 Q 100 0 100 8 L 100 8 Q 100 16 110 16 L 200 16'
    );
  });
});

// -- labelAnchor ------------------------------------------------

describe('labelAnchor', () => {
  it('straight - midpoint of the single segment', () => {
    const segs = pathSegments(0, 0, 200, 10, 'right', 'left');
    expect(labelAnchor(segs)).toEqual({ x: 100, y: 5 });
  });

  it('insets - centers on the visible span between cards, not center-to-center', () => {
    // Straight, length 200. Source half-extent 60, target half-extent 20 ->
    // visible span [60, 180], center 120 (vs 100 with no insets).
    const segs = [{ x1: 0, y1: 0, x2: 200, y2: 0 }];
    expect(labelAnchor(segs, 60, 20)).toEqual({ x: 120, y: 0 });
  });

  it('insets - falls back to the raw midpoint when the insets cross', () => {
    // start inset (200) > length (100) pushes the target out of (0, total).
    const segs = [{ x1: 0, y1: 0, x2: 100, y2: 0 }];
    expect(labelAnchor(segs, 200, 0)).toEqual({ x: 50, y: 0 });
  });

  it('L-shape - arc-length midpoint, on the long leg (not the corner)', () => {
    // Horizontal leg len 200 + vertical leg len 100 = 300; half-length 150
    // lands 3/4 along the horizontal leg, well clear of the corner at (200,0).
    const segs = pathSegments(0, 0, 200, 100, 'right', 'top');
    expect(labelAnchor(segs)).toEqual({ x: 150, y: 0 });
  });

  it('Z-shape (symmetric) - midpoint of the bend leg', () => {
    const segs = pathSegments(0, 0, 200, 100, 'right', 'left');
    expect(labelAnchor(segs)).toEqual({ x: 100, y: 50 });
  });

  it('4-segment detour - arc-length midpoint, not the indexed center segment', () => {
    // Lengths 100, 60, 200, 40 (total 400); half-length 200 lands 40 into the
    // third segment -> (140, 60). The old code returned segs[2]'s midpoint (200,60).
    const segs = [
      { x1: 0, y1: 0, x2: 100, y2: 0 },
      { x1: 100, y1: 0, x2: 100, y2: 60 },
      { x1: 100, y1: 60, x2: 300, y2: 60 },
      { x1: 300, y1: 60, x2: 300, y2: 100 },
    ];
    expect(labelAnchor(segs)).toEqual({ x: 140, y: 60 });
  });

  it('5-segment path - arc-length midpoint of the whole path', () => {
    // Lengths 50, 40, 300, 140, 50 (total 580); half-length 290 lands 200 into
    // the center segment -> (250,-40). The old code returned its midpoint (200,-40).
    const segs = [
      { x1: 0, y1: 0, x2: 50, y2: 0 },
      { x1: 50, y1: 0, x2: 50, y2: -40 },
      { x1: 50, y1: -40, x2: 350, y2: -40 },
      { x1: 350, y1: -40, x2: 350, y2: 100 },
      { x1: 350, y1: 100, x2: 400, y2: 100 },
    ];
    expect(labelAnchor(segs)).toEqual({ x: 250, y: -40 });
  });
});
