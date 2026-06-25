import { describe, it, expect } from 'vitest';
import { computeEndpointOffsets, type DeviceGeom } from './geom';
import type { Device, Link } from '../../types';

// Helpers to keep test bodies short
function device(id: string, x: number, y: number): Device {
  return { id, name: id, type: 'server', x, y, tags: [], notes: '' };
}

function makeGeom(cards: Array<{ id: string; x: number; y: number; w?: number; h?: number }>) {
  const map = new Map<string, DeviceGeom>(
    cards.map(c => [c.id, {
      center: { x: c.x, y: c.y },
      size: { w: c.w ?? 200, h: c.h ?? 90 },
    }])
  );
  return (d: Device): DeviceGeom => map.get(d.id)!;
}

function link(id: string, sourceId: string, targetId: string, sourceSide?: Link['sourceSide'], targetSide?: Link['targetSide']): Link {
  return { id, sourceId, targetId, type: 'wired', sourceSide, targetSide };
}

// ── Tie-break for column-of-targets-below ───────────────────────
//
// Hub at the top, two columns of three targets each below. All targets share
// either an x value (column) so the primary sort key (target.x along the
// source's bottom tangent) ties; the secondary key should order them by depth
// so the Z-bends don't cross.

describe('computeEndpointOffsets — fan-out tie-break', () => {
  it('column of targets BELOW + LEFT of source: leftmost source endpoint → topmost target', () => {
    // Source bottom edge; target column to the LEFT of source's center.
    // Expected: leftmost endpoint (most negative sx) goes to the topmost target.
    const src = device('src', 500, 0);
    const t1  = device('t1',  200, 200); // top
    const t2  = device('t2',  200, 350); // middle
    const t3  = device('t3',  200, 500); // bottom
    const geom = makeGeom([
      { id: 'src', x: 500, y:  45 },
      { id: 't1',  x: 200, y: 245 },
      { id: 't2',  x: 200, y: 395 },
      { id: 't3',  x: 200, y: 545 },
    ]);
    const links = [
      link('L1', 'src', 't1', 'bottom', 'top'),
      link('L2', 'src', 't2', 'bottom', 'top'),
      link('L3', 'src', 't3', 'bottom', 'top'),
    ];
    const out = computeEndpointOffsets(links, new Map([
      ['src', src], ['t1', t1], ['t2', t2], ['t3', t3],
    ]), geom);

    // Leftmost endpoint on source.bottom (smallest sx) should be L1 (top target).
    const sx = [out.get('L1')!.sx, out.get('L2')!.sx, out.get('L3')!.sx];
    expect(sx[0]).toBeLessThan(sx[1]);
    expect(sx[1]).toBeLessThan(sx[2]);
  });

  it('column of targets BELOW + RIGHT of source: leftmost source endpoint → bottommost target', () => {
    // Mirror image: target column to the RIGHT of source. Closer source endpoint
    // (rightmost) should reach the topmost target; leftmost source → bottommost.
    const src = device('src', 100, 0);
    const t1  = device('t1',  500, 200); // top
    const t2  = device('t2',  500, 350); // middle
    const t3  = device('t3',  500, 500); // bottom
    const geom = makeGeom([
      { id: 'src', x: 100, y:  45 },
      { id: 't1',  x: 500, y: 245 },
      { id: 't2',  x: 500, y: 395 },
      { id: 't3',  x: 500, y: 545 },
    ]);
    const links = [
      link('L1', 'src', 't1', 'bottom', 'top'),
      link('L2', 'src', 't2', 'bottom', 'top'),
      link('L3', 'src', 't3', 'bottom', 'top'),
    ];
    const out = computeEndpointOffsets(links, new Map([
      ['src', src], ['t1', t1], ['t2', t2], ['t3', t3],
    ]), geom);

    // Leftmost endpoint (smallest sx) → bottommost target (L3).
    const sx = [out.get('L1')!.sx, out.get('L2')!.sx, out.get('L3')!.sx];
    expect(sx[0]).toBeGreaterThan(sx[1]); // L1 (top) is rightmost
    expect(sx[1]).toBeGreaterThan(sx[2]); // L3 (bottom) is leftmost
  });

  it('row of targets ABOVE + LEFT of source (left side fan-out): order matches column depth', () => {
    // Source's LEFT side; targets all at x=50, varying y. Targets above source.
    // Tangent runs along Y. Primary key = target.y, all tied? No — targets vary
    // in y here. Instead, test left-side fan-out with targets sharing y (a row).
    // Row of targets at y=100 to the left of source.
    const src = device('src', 500, 500);
    const t1  = device('t1',  100, 100); // leftmost
    const t2  = device('t2',  200, 100);
    const t3  = device('t3',  300, 100); // rightmost
    const geom = makeGeom([
      { id: 'src', x: 500, y: 545 },
      { id: 't1',  x: 100, y: 145 },
      { id: 't2',  x: 200, y: 145 },
      { id: 't3',  x: 300, y: 145 },
    ]);
    const links = [
      link('L1', 'src', 't1', 'left', 'right'),
      link('L2', 'src', 't2', 'left', 'right'),
      link('L3', 'src', 't3', 'left', 'right'),
    ];
    const out = computeEndpointOffsets(links, new Map([
      ['src', src], ['t1', t1], ['t2', t2], ['t3', t3],
    ]), geom);

    // Source side LEFT runs along Y. Primary key target.y is tied (all 145).
    // Targets are ABOVE source (sc.y > tc.y → sign positive → secondary = +tc.x).
    // Ascending: smallest tc.x first → L1 first.
    // Topmost endpoint on source.left (most negative sy) should be L1.
    const sy = [out.get('L1')!.sy, out.get('L2')!.sy, out.get('L3')!.sy];
    expect(sy[0]).toBeLessThan(sy[1]);
    expect(sy[1]).toBeLessThan(sy[2]);
  });

  it('preserves order when primary key is not tied', () => {
    // Sanity: when targets vary in their primary tangent coord, secondary
    // shouldn't disrupt the natural ordering.
    const src = device('src', 500, 0);
    const t1  = device('t1',  100, 300);
    const t2  = device('t2',  300, 300);
    const t3  = device('t3',  700, 300);
    const geom = makeGeom([
      { id: 'src', x: 500, y:  45 },
      { id: 't1',  x: 100, y: 345 },
      { id: 't2',  x: 300, y: 345 },
      { id: 't3',  x: 700, y: 345 },
    ]);
    const links = [
      link('L1', 'src', 't1', 'bottom', 'top'),
      link('L2', 'src', 't2', 'bottom', 'top'),
      link('L3', 'src', 't3', 'bottom', 'top'),
    ];
    const out = computeEndpointOffsets(links, new Map([
      ['src', src], ['t1', t1], ['t2', t2], ['t3', t3],
    ]), geom);

    // Ordered along source.bottom by target.x ascending.
    const sx = [out.get('L1')!.sx, out.get('L2')!.sx, out.get('L3')!.sx];
    expect(sx[0]).toBeLessThan(sx[1]);
    expect(sx[1]).toBeLessThan(sx[2]);
  });
});
