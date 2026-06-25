import { describe, it, expect } from 'vitest';
import { routeConnection } from './route';
import { pathSegments } from './path-geometry';
import { segmentIntersectsRect, type Rect } from './collision';
import type { Segment } from './path-geometry';

function hitsAny(segs: Segment[], rects: Rect[]): boolean {
  for (const seg of segs) {
    for (const rect of rects) {
      if (segmentIntersectsRect(seg, rect)) return true;
    }
  }
  return false;
}

const srcRect: Rect = { left: -60, right: 60, top: -30, bottom: 30 };
const tgtRect: Rect = { left: 340, right: 460, top: 70, bottom: 130 };

describe('routeConnection', () => {
  it('returns default path when no obstacles', () => {
    const { segs, collides } = routeConnection(0, 0, 400, 100, 'right', 'left', 200, [], srcRect, tgtRect);
    const expected = pathSegments(0, 0, 400, 100, 'right', 'left', 200);
    expect(segs).toEqual(expected);
    expect(collides).toBe(false);
  });

  it('returns default path when obstacles do not collide', () => {
    const obstacle: Rect = { left: 100, right: 130, top: 200, bottom: 250 };
    const { segs } = routeConnection(0, 0, 400, 100, 'right', 'left', 200, [obstacle], srcRect, tgtRect);
    const expected = pathSegments(0, 0, 400, 100, 'right', 'left', 200);
    expect(segs).toEqual(expected);
  });

  describe('bend-nudge', () => {
    it('shifts bend to clear a blocking card — horizontal Z', () => {
      // Obstacle blocks the vertical bend leg but doesn't span both y endpoints
      const obstacle: Rect = { left: 180, right: 220, top: 20, bottom: 80 };
      const { segs, collides } = routeConnection(0, 0, 400, 100, 'right', 'left', 200, [obstacle], srcRect, tgtRect);
      expect(segs).toHaveLength(3);
      expect(hitsAny(segs, [obstacle])).toBe(false);
      expect(collides).toBe(false);
    });

    it('shifts bend to clear a blocking card — vertical Z', () => {
      const obstacle: Rect = { left: 20, right: 80, top: 180, bottom: 220 };
      const src: Rect = { left: -60, right: 60, top: -30, bottom: 30 };
      const tgt: Rect = { left: 40, right: 160, top: 370, bottom: 430 };
      const { segs } = routeConnection(0, 0, 100, 400, 'bottom', 'top', 200, [obstacle], src, tgt);
      expect(segs).toHaveLength(3);
      expect(hitsAny(segs, [obstacle])).toBe(false);
    });

    it('nudges to closest edge of the blocking card', () => {
      const obstacle: Rect = { left: 190, right: 250, top: 20, bottom: 80 };
      const { segs } = routeConnection(0, 0, 400, 100, 'right', 'left', 200, [obstacle], srcRect, tgtRect);
      expect(segs).toHaveLength(3);
      const bendX = segs[1].x1;
      expect(bendX).toBe(190 - 16);
    });
  });

  describe('5-segment detour', () => {
    it('routes around when nudging cannot clear — horizontal Z', () => {
      const wide: Rect = { left: 70, right: 330, top: 20, bottom: 80 };
      const { segs, collides } = routeConnection(0, 0, 400, 100, 'right', 'left', 200, [wide], srcRect, tgtRect);
      expect(segs.length).toBeGreaterThanOrEqual(3);
      expect(hitsAny(segs, [wide])).toBe(false);
      expect(collides).toBe(false);
    });

    it('routes around when nudging cannot clear — vertical Z', () => {
      const tall: Rect = { left: 20, right: 80, top: 40, bottom: 360 };
      const src: Rect = { left: -60, right: 60, top: -30, bottom: 30 };
      const tgt: Rect = { left: 40, right: 160, top: 370, bottom: 430 };
      const { segs } = routeConnection(0, 0, 100, 400, 'bottom', 'top', 200, [tall], src, tgt);
      expect(segs.length).toBeGreaterThanOrEqual(3);
      expect(hitsAny(segs, [tall])).toBe(false);
    });

    it('detour segments are all axis-aligned', () => {
      const wide: Rect = { left: 70, right: 330, top: 20, bottom: 80 };
      const { segs } = routeConnection(0, 0, 400, 100, 'right', 'left', 200, [wide], srcRect, tgtRect);
      for (const seg of segs) {
        const isHorizontal = seg.y1 === seg.y2;
        const isVertical = seg.x1 === seg.x2;
        expect(isHorizontal || isVertical).toBe(true);
      }
    });
  });

  describe('straight-line collision', () => {
    it('detours around obstacle on a straight line', () => {
      // Nearly same y → straight line, obstacle blocks the middle
      const obstacle: Rect = { left: 180, right: 220, top: -20, bottom: 20 };
      const src: Rect = { left: -60, right: 60, top: -30, bottom: 30 };
      const tgt: Rect = { left: 340, right: 460, top: -30, bottom: 30 };
      const { segs } = routeConnection(0, 0, 400, 5, 'right', 'left', undefined, [obstacle], src, tgt);
      expect(segs.length).toBeGreaterThan(1);
      expect(hitsAny(segs, [obstacle])).toBe(false);
    });
  });

  describe('L-shape nudge', () => {
    it('promotes L to 3-segment to clear obstacle — source horizontal', () => {
      const obstacle: Rect = { left: 350, right: 450, top: -20, bottom: 20 };
      const { segs } = routeConnection(0, 0, 400, 100, 'right', 'top', undefined, [obstacle], srcRect, tgtRect);
      expect(segs.length).toBe(3);
      expect(hitsAny(segs, [obstacle])).toBe(false);
    });

    it('promotes L to 3-segment to clear obstacle — source vertical', () => {
      const obstacle: Rect = { left: -20, right: 20, top: 350, bottom: 450 };
      const src: Rect = { left: -60, right: 60, top: -30, bottom: 30 };
      const tgt: Rect = { left: 70, right: 190, top: 370, bottom: 430 };
      const { segs } = routeConnection(0, 0, 130, 400, 'bottom', 'left', undefined, [obstacle], src, tgt);
      expect(segs.length).toBe(3);
      expect(hitsAny(segs, [obstacle])).toBe(false);
    });

    it('nudges to closest obstacle edge', () => {
      const obstacle: Rect = { left: 180, right: 220, top: 20, bottom: 80 };
      const tgt: Rect = { left: 140, right: 260, top: 70, bottom: 130 };
      const { segs } = routeConnection(0, 0, 200, 100, 'right', 'top', undefined, [obstacle], srcRect, tgt);
      expect(segs.length).toBe(3);
      expect(hitsAny(segs, [obstacle])).toBe(false);
    });

    it('all nudged segments are axis-aligned', () => {
      const obstacle: Rect = { left: 350, right: 450, top: -20, bottom: 20 };
      const { segs } = routeConnection(0, 0, 400, 100, 'right', 'top', undefined, [obstacle], srcRect, tgtRect);
      for (const seg of segs) {
        expect(seg.y1 === seg.y2 || seg.x1 === seg.x2).toBe(true);
      }
    });
  });

  describe('L-shape detour', () => {
    it('routes around wide obstacle blocking L — source horizontal', () => {
      const wide: Rect = { left: 70, right: 390, top: -20, bottom: 20 };
      const { segs } = routeConnection(0, 0, 400, 100, 'right', 'top', undefined, [wide], srcRect, tgtRect);
      expect(segs.length).toBeGreaterThanOrEqual(3);
      expect(hitsAny(segs, [wide])).toBe(false);
    });

    it('routes around tall obstacle blocking L — source vertical', () => {
      const tall: Rect = { left: -20, right: 20, top: 40, bottom: 360 };
      const src: Rect = { left: -60, right: 60, top: -30, bottom: 30 };
      const tgt: Rect = { left: 70, right: 190, top: 370, bottom: 430 };
      const { segs } = routeConnection(0, 0, 130, 400, 'bottom', 'left', undefined, [tall], src, tgt);
      expect(segs.length).toBeGreaterThanOrEqual(3);
      expect(hitsAny(segs, [tall])).toBe(false);
    });

    it('detour segments are all axis-aligned', () => {
      const wide: Rect = { left: 70, right: 390, top: -20, bottom: 20 };
      const { segs } = routeConnection(0, 0, 400, 100, 'right', 'top', undefined, [wide], srcRect, tgtRect);
      for (const seg of segs) {
        expect(seg.y1 === seg.y2 || seg.x1 === seg.x2).toBe(true);
      }
    });
  });

  describe('L-shape no-collision passthrough', () => {
    it('returns default L when no obstacles collide', () => {
      const obstacle: Rect = { left: 100, right: 130, top: 200, bottom: 250 };
      const { segs } = routeConnection(0, 0, 400, 100, 'right', 'top', undefined, [obstacle], srcRect, tgtRect);
      const expected = pathSegments(0, 0, 400, 100, 'right', 'top');
      expect(segs).toEqual(expected);
    });
  });

  describe('U-shape — face-away same-axis sides', () => {
    // Face-away horizontal: source at center (0,0) with side='left' (faces -x),
    // target at center (400,100) with side='right' (faces +x). Both sides
    // point away from each other, so the default Z's bend would land between
    // the cards and hide the chosen sides. Must produce a 5-segment U.
    it('routes a 5-segment U-shape when horizontal sides face away', () => {
      const src: Rect = { left: -60, right: 60, top: -30, bottom: 30 };
      const tgt: Rect = { left: 340, right: 460, top: 70, bottom: 130 };
      const { segs, collides } = routeConnection(0, 0, 400, 100, 'left', 'right', undefined, [], src, tgt);
      expect(segs).toHaveLength(5);
      expect(collides).toBe(false);
      // First segment must exit leftward past source's left edge
      expect(segs[0].x2).toBeLessThanOrEqual(src.left);
      // Last segment must enter rightward — its start sits past target's right edge
      expect(segs[4].x1).toBeGreaterThanOrEqual(tgt.right);
    });

    it('routes a 5-segment U-shape when vertical sides face away', () => {
      // Source 'top' faces -y, target 'bottom' faces +y, target physically below.
      const src: Rect = { left: -60, right: 60, top: -30, bottom: 30 };
      const tgt: Rect = { left: -60, right: 60, top: 170, bottom: 230 };
      const { segs, collides } = routeConnection(0, 0, 0, 200, 'top', 'bottom', undefined, [], src, tgt);
      expect(segs).toHaveLength(5);
      expect(collides).toBe(false);
      expect(segs[0].y2).toBeLessThanOrEqual(src.top);
      expect(segs[4].y1).toBeGreaterThanOrEqual(tgt.bottom);
    });

    it('U-shape inner segments are axis-aligned', () => {
      const src: Rect = { left: -60, right: 60, top: -30, bottom: 30 };
      const tgt: Rect = { left: 340, right: 460, top: 70, bottom: 130 };
      const { segs } = routeConnection(0, 0, 400, 100, 'left', 'right', undefined, [], src, tgt);
      for (const s of segs) {
        expect(s.x1 === s.x2 || s.y1 === s.y2).toBe(true);
      }
    });

    it('U-shape picks an alternate detour when obstacle blocks the natural path', () => {
      const src: Rect = { left: -60, right: 60, top: -30, bottom: 30 };
      const tgt: Rect = { left: 340, right: 460, top: 70, bottom: 130 };
      // Plant a wide obstacle above both cards — should force the U to go below
      const obstacle: Rect = { left: -200, right: 600, top: -200, bottom: -100 };
      const { segs } = routeConnection(0, 0, 400, 100, 'left', 'right', undefined, [obstacle], src, tgt);
      expect(segs).toHaveLength(5);
      expect(hitsAny(segs, [obstacle])).toBe(false);
    });

    it('does not trigger U-shape when sides face each other (happy case stays Z)', () => {
      // Source 'right' + target 'left' with target to the right — happy case.
      const { segs } = routeConnection(0, 0, 400, 100, 'right', 'left', 200, [], srcRect, tgtRect);
      expect(segs).toHaveLength(3);
    });

    it('does not trigger U-shape on mixed-axis sides (L-shape unaffected)', () => {
      const { segs } = routeConnection(0, 0, 400, 100, 'right', 'top', undefined, [], srcRect, tgtRect);
      expect(segs).toHaveLength(2);
    });
  });

  describe('endpoint rects in allRects', () => {
    it('skips the endpoint cards by reference — line may start/end inside them', () => {
      // The path begins/ends at card centers, so it sits inside srcRect/tgtRect.
      // Passing them as members of allRects must not trigger a detour.
      const { segs } = routeConnection(0, 0, 400, 100, 'right', 'left', 200, [srcRect, tgtRect], srcRect, tgtRect);
      const expected = pathSegments(0, 0, 400, 100, 'right', 'left', 200);
      expect(segs).toEqual(expected);
    });

    it('routes around a real obstacle while ignoring endpoint cards in the same array', () => {
      const obstacle: Rect = { left: 180, right: 220, top: 20, bottom: 80 };
      const { segs } = routeConnection(0, 0, 400, 100, 'right', 'left', 200, [srcRect, obstacle, tgtRect], srcRect, tgtRect);
      expect(segs).toHaveLength(3);
      expect(hitsAny(segs, [obstacle])).toBe(false);
    });
  });
});
