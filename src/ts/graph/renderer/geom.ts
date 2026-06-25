import type { Device, Link, LinkSide } from '../../types';
import { axisOf, type Axis } from '../path-geometry';

// ── Device geometry ──────────────────────────────────────────

export interface DeviceGeom {
  center: { x: number; y: number };
  size: { w: number; h: number };
}

/**
 * Read a device's rendered size from its DOM element and derive its visual
 * center. Combines what would otherwise be two separate `querySelector` calls
 * (size + center) into one. Falls back to typical defaults if the element
 * isn't in the DOM yet (first render before paint).
 */
export function readDeviceGeom(device: Device): DeviceGeom {
  const el = document.querySelector<HTMLElement>(`.device[data-device-id="${device.id}"]`);
  const w = el?.offsetWidth ?? 204;
  const h = el?.offsetHeight ?? 90;
  return {
    center: { x: device.x, y: device.y + h / 2 },
    size: { w, h },
  };
}

// ── Endpoint fan-out ─────────────────────────────────────────

const ENDPOINT_GAP = 6; // Visual separation between lines meeting at the same device
// Keep fan-out endpoints inset from the card's corners so connections don't
// emerge inside the rounded border-radius. Slightly larger than the card's
// 10 px border-radius so the line sits clearly on the straight part of the edge.
const CORNER_PADDING = 16;

export type LinkOffset = {
  sx: number; sy: number; tx: number; ty: number;
  sourceSide: LinkSide;
  targetSide: LinkSide;
};

/**
 * For each link, decide which side of each card the connection attaches to
 * and compute small endpoint offsets so multiple lines meeting at the same
 * device fan out instead of overlapping.
 *
 * Side resolution priority:
 *   1. `link.sourceSide` / `link.targetSide` — manual override always wins.
 *   2. Per-link heuristic: source side = direction toward target on the
 *      dominant axis; target side = opposite.
 *
 * Axis for the orthogonal path is taken from whichever side is set (manual
 * first, then auto). If only one side is set manually, the other is derived
 * to form a clean Z-shape on that axis.
 */
export function computeEndpointOffsets(
  links: Link[],
  deviceMap: Map<string, Device>,
  geom: (d: Device) => DeviceGeom,
): Map<string, LinkOffset> {
  type Endpoint = {
    linkId: string;
    end: 'source' | 'target';
    side: LinkSide;
    // Primary key: position of the *other* endpoint along this side's tangent.
    // (Top/bottom run along X → tangent is X; left/right along Y → tangent is Y.)
    sortKey: number;
    // Secondary key: position of the *other* endpoint perpendicular to the
    // tangent, sign-flipped so that when several targets share the primary key
    // (a column / row of targets), fan-out order along this side matches the
    // targets' depth ordering and the Z-shapes don't cross.
    //
    // For top/bottom sides: secondary = otherY * sign(thisX - otherX).
    //   Targets to the left of this device → ascending Y first (closer source
    //   endpoint reaches the nearer target). Targets to the right → reverse.
    // For left/right sides: secondary = otherX * sign(thisY - otherY).
    //
    // Degenerate case: when `thisX === otherX` (target directly under source
    // center), sign() returns 0 and the secondary key collapses to 0 for the
    // whole tied group → falls back to insertion order. Visually fine because
    // routes are symmetric in that configuration anyway.
    sortKey2: number;
  };

  const offsets = new Map<string, LinkOffset>();
  const byDevice = new Map<string, Endpoint[]>();

  for (const link of links) {
    const s = deviceMap.get(link.sourceId);
    const t = deviceMap.get(link.targetId);
    if (!s || !t) continue;

    const sc = geom(s).center;
    const tc = geom(t).center;
    const dx = tc.x - sc.x;
    const dy = tc.y - sc.y;

    // Axis: prefer whichever manual side is set; otherwise per-link dominant.
    const axis: Axis = link.sourceSide ? axisOf(link.sourceSide)
      : link.targetSide ? axisOf(link.targetSide)
      : (Math.abs(dx) > Math.abs(dy) ? 'horizontal' : 'vertical');
    const horizontal = axis === 'horizontal';

    // Auto sides: source faces target on the chosen axis; target faces source.
    const autoSourceSide: LinkSide = horizontal
      ? (dx > 0 ? 'right' : 'left')
      : (dy > 0 ? 'bottom' : 'top');
    const autoTargetSide: LinkSide = horizontal
      ? (dx > 0 ? 'left' : 'right')
      : (dy > 0 ? 'top' : 'bottom');

    const sourceSide: LinkSide = link.sourceSide ?? autoSourceSide;
    const targetSide: LinkSide = link.targetSide ?? autoTargetSide;

    offsets.set(link.id, { sx: 0, sy: 0, tx: 0, ty: 0, sourceSide, targetSide });

    if (!byDevice.has(link.sourceId)) byDevice.set(link.sourceId, []);
    if (!byDevice.has(link.targetId)) byDevice.set(link.targetId, []);
    const sourceRunsHorizontally = sourceSide === 'top' || sourceSide === 'bottom';
    const targetRunsHorizontally = targetSide === 'top' || targetSide === 'bottom';
    byDevice.get(link.sourceId)!.push({
      linkId: link.id, end: 'source', side: sourceSide,
      sortKey:  sourceRunsHorizontally ? tc.x : tc.y,
      sortKey2: sourceRunsHorizontally
        ? tc.y * Math.sign(sc.x - tc.x)
        : tc.x * Math.sign(sc.y - tc.y),
    });
    byDevice.get(link.targetId)!.push({
      linkId: link.id, end: 'target', side: targetSide,
      sortKey:  targetRunsHorizontally ? sc.x : sc.y,
      sortKey2: targetRunsHorizontally
        ? sc.y * Math.sign(tc.x - sc.x)
        : sc.x * Math.sign(tc.y - sc.y),
    });
  }

  for (const [deviceId, endpoints] of byDevice) {
    const device = deviceMap.get(deviceId);
    if (!device) continue;
    const { size } = geom(device);
    const groups = new Map<string, Endpoint[]>();
    for (const ep of endpoints) {
      if (!groups.has(ep.side)) groups.set(ep.side, []);
      groups.get(ep.side)!.push(ep);
    }
    for (const [side, group] of groups) {
      group.sort((a, b) => (a.sortKey - b.sortKey) || (a.sortKey2 - b.sortKey2));
      const n = group.length;
      const sideRunsHorizontally = side === 'top' || side === 'bottom';
      // Half-extent of the usable strip along the side's tangent. Subtract
      // CORNER_PADDING so the outermost endpoints don't sit on the card's
      // rounded corner.
      const maxOffset = Math.max(0, (sideRunsHorizontally ? size.w : size.h) / 2 - CORNER_PADDING);
      // If the natural spread would exceed maxOffset on either side, compress
      // the gap so all endpoints stay inside the padded strip.
      const naturalHalfSpan = ((n - 1) / 2) * ENDPOINT_GAP;
      const gap = naturalHalfSpan > maxOffset && n > 1
        ? (2 * maxOffset) / (n - 1)
        : ENDPOINT_GAP;
      group.forEach((ep, i) => {
        const offset = (i - (n - 1) / 2) * gap;
        const o = offsets.get(ep.linkId)!;
        if (sideRunsHorizontally) {
          // Top/bottom edges fan along X
          if (ep.end === 'source') o.sx = offset; else o.tx = offset;
        } else {
          // Left/right edges fan along Y
          if (ep.end === 'source') o.sy = offset; else o.ty = offset;
        }
      });
    }
  }

  return offsets;
}
