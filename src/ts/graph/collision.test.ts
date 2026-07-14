import { describe, it, expect } from 'vitest';
import { pathSegments } from './path-geometry';
import { segmentIntersectsRect, pathCollidesWith, type Rect } from './collision';

// -- segmentIntersectsRect ---------------------------------------

const rect: Rect = { left: 100, right: 200, top: 100, bottom: 200 };

describe('segmentIntersectsRect', () => {
  it('horizontal segment crossing through the rect interior - intersects', () => {
    expect(segmentIntersectsRect({ x1: 0, y1: 150, x2: 300, y2: 150 }, rect)).toBe(true);
  });

  it('horizontal segment above the rect - no intersection', () => {
    expect(segmentIntersectsRect({ x1: 0, y1: 50, x2: 300, y2: 50 }, rect)).toBe(false);
  });

  it('horizontal segment lying exactly on top edge - strict, no intersection', () => {
    expect(segmentIntersectsRect({ x1: 0, y1: 100, x2: 300, y2: 100 }, rect)).toBe(false);
  });

  it('horizontal segment ending inside the rect - intersects', () => {
    expect(segmentIntersectsRect({ x1: 0, y1: 150, x2: 150, y2: 150 }, rect)).toBe(true);
  });

  it('horizontal segment ending exactly at left edge - strict, no intersection', () => {
    expect(segmentIntersectsRect({ x1: 0, y1: 150, x2: 100, y2: 150 }, rect)).toBe(false);
  });

  it('vertical segment crossing through the rect interior - intersects', () => {
    expect(segmentIntersectsRect({ x1: 150, y1: 0, x2: 150, y2: 300 }, rect)).toBe(true);
  });

  it('vertical segment to the left of the rect - no intersection', () => {
    expect(segmentIntersectsRect({ x1: 50, y1: 0, x2: 50, y2: 300 }, rect)).toBe(false);
  });

  it('vertical segment lying exactly on left edge - strict, no intersection', () => {
    expect(segmentIntersectsRect({ x1: 100, y1: 0, x2: 100, y2: 300 }, rect)).toBe(false);
  });
});

// -- pathCollidesWith --------------------------------------------

describe('pathCollidesWith', () => {
  it('Z-path crossing a third device cleanly through the bend leg', () => {
    // Source at (0, 50), target at (400, 50). Z with bend at x=200 (default
    // midpoint). The bend leg is vertical at x=200 from y=50 to y=50 - wait,
    // dy=0 here so this collapses. Use a y-offset to force a real Z.
    const segs = pathSegments(0, 0, 400, 100, 'right', 'left');
    const obstacle: Rect = { left: 180, right: 220, top: 30, bottom: 70 };
    expect(pathCollidesWith(segs, [obstacle])).toBe(true);
  });

  it('Z-path with bend routed around a device - no collision', () => {
    // Bend at x=50 (close to source). Obstacle sits between bend and target
    // at y=0 (segment 3), not on segment 3's y=100 path.
    const segs = pathSegments(0, 0, 400, 100, 'right', 'left', 50);
    // Place obstacle between source and target horizontally but above seg-1 (y=0)
    // and below seg-3 (y=100). seg-1 is at y=0, seg-3 is at y=100.
    // Rect spanning y from 30 to 70 sits ENTIRELY between the two horizontal
    // segments. The vertical bend leg at x=50 doesn't cross it (it's at x=50,
    // rect is from x=200 to x=300). So no collision.
    const obstacle: Rect = { left: 200, right: 300, top: 30, bottom: 70 };
    expect(pathCollidesWith(segs, [obstacle])).toBe(false);
  });

  it('straight horizontal fallback passing through a third device', () => {
    const segs = pathSegments(0, 0, 400, 5, 'right', 'left'); // |dy|=5 -> straight at y=2.5
    const obstacle: Rect = { left: 150, right: 250, top: 0, bottom: 50 };
    expect(pathCollidesWith(segs, [obstacle])).toBe(true);
  });

  it('L-path with the vertical leg cutting through a device', () => {
    const segs = pathSegments(0, 0, 300, 200, 'right', 'top'); // L, corner (300, 0)
    // Vertical leg at x=300 from y=0 to y=200. Obstacle straddling x=300.
    const obstacle: Rect = { left: 280, right: 320, top: 80, bottom: 120 };
    expect(pathCollidesWith(segs, [obstacle])).toBe(true);
  });

  it('empty obstacle list - never collides', () => {
    const segs = pathSegments(0, 0, 200, 100, 'right', 'left');
    expect(pathCollidesWith(segs, [])).toBe(false);
  });
});
