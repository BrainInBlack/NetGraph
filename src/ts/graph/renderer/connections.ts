import type { Device, Link, LinkSide } from '../../types';
import { createLongPress, getSvgRoot, q } from '../../util';
import { axisOf, signOf, segmentsToPath, labelAnchor, MIN_PERPENDICULAR } from '../path-geometry';
import { type Rect } from '../collision';
import { routeConnection } from '../route';
import { type DeviceGeom, readDeviceGeom, type LinkOffset, computeEndpointOffsets } from './geom';

const SVG_NS = 'http://www.w3.org/2000/svg';
const CONN_FILTER_DEFS = `
  <defs>
    <filter id="conn-label-halo" x="-50%" y="-50%" width="200%" height="200%">
      <feMorphology in="SourceAlpha" operator="dilate" radius="2" result="thick"/>
      <feGaussianBlur in="thick" stdDeviation="2.2" result="blurred"/>
      <feFlood flood-color="rgb(13,13,15)" flood-opacity="0.92" result="color"/>
      <feComposite in="color" in2="blurred" operator="in" result="halo"/>
      <feMerge>
        <feMergeNode in="halo"/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>
  </defs>
`;

/**
 * Render or update connection lines.
 *
 * This runs on every frame during a drag, so it's tuned to mutate existing DOM
 * rather than rebuild it. Per-connection elements (the <g>, the two <path>s,
 * and the optional label) are created once when a link first appears and
 * thereafter only have their `d`/`x`/`y` attributes updated. Event listeners
 * are attached at creation time and persist across renders.
 */
export function renderConnections(links: Link[], devices: Device[]): void {
  const svg = getSvgRoot('connections')!;

  // <defs> only needs to be set up once
  if (!svg.querySelector('defs')) svg.innerHTML = CONN_FILTER_DEFS;

  const deviceMap = new Map(devices.map(d => [d.id, d]));

  // Cache device geometry once per render. Without this, computeEndpointOffsets
  // and the main loop would each call document.querySelector multiple times
  // per link - quadratic-ish under load. The cache reduces it to one DOM read
  // per device per frame.
  const geomCache = new Map<string, DeviceGeom>();
  const geom = (d: Device): DeviceGeom => {
    let g = geomCache.get(d.id);
    if (!g) {
      g = readDeviceGeom(d);
      geomCache.set(d.id, g);
    }
    return g;
  };

  const offsets = computeEndpointOffsets(links, deviceMap, geom);

  // One Rect per device per render - the collision check needs these for every
  // link, and allocating fresh inside the per-link loop would churn the GC at
  // 60 fps during drags. `allRects` is the same set as a flat array so
  // routeConnection gets a shared obstacle list instead of one per link.
  const rectsByDevice = new Map<string, Rect>();
  for (const d of devices) {
    const g = geom(d);
    rectsByDevice.set(d.id, {
      left:   g.center.x - g.size.w / 2,
      right:  g.center.x + g.size.w / 2,
      top:    g.center.y - g.size.h / 2,
      bottom: g.center.y + g.size.h / 2,
    });
  }
  const allRects = [...rectsByDevice.values()];

  // Index existing connection groups by linkId in a single pass - avoids the
  // O(n) per-link querySelector that would otherwise make this O(n²) overall.
  const existing = new Map<string, SVGGElement>();
  svg.querySelectorAll<SVGGElement>('g.conn-group').forEach(el => {
    const id = el.dataset.linkId;
    if (id) existing.set(id, el);
  });

  const seen = new Set<string>();
  for (const link of links) {
    const source = deviceMap.get(link.sourceId);
    const target = deviceMap.get(link.targetId);
    if (!source || !target) continue;
    seen.add(link.id);

    let g = existing.get(link.id);
    if (!g) {
      g = createConnectionGroup(svg, link);
      existing.set(link.id, g);
    }
    updateConnectionGroup(g, link, source, target, offsets, geom, rectsByDevice, allRects);
  }

  // Remove <g>s for links that no longer exist
  for (const [id, el] of existing) {
    if (!seen.has(id)) el.remove();
  }
}

function createConnectionGroup(svg: SVGSVGElement, link: Link): SVGGElement {
  const g = document.createElementNS(SVG_NS, 'g') as SVGGElement;
  g.classList.add('conn-group');
  g.dataset.linkId = link.id;

  const hitPath = document.createElementNS(SVG_NS, 'path');
  hitPath.classList.add('conn-hit');
  g.appendChild(hitPath);

  const linePath = document.createElementNS(SVG_NS, 'path');
  linePath.classList.add('conn-line');
  g.appendChild(linePath);

  // Hover-only action buttons (Edit / Delete). Anchored to the label point
  // in updateConnectionGroup. CSS gates visibility to connect mode + hover so
  // the buttons don't litter the normal canvas.
  const actionsFO = document.createElementNS(SVG_NS, 'foreignObject') as SVGForeignObjectElement;
  actionsFO.classList.add('conn-actions');
  actionsFO.setAttribute('width', '72');
  actionsFO.setAttribute('height', '32');
  const actionsHtml =
    `<div xmlns="http://www.w3.org/1999/xhtml" class="conn-actions-inner">
       <button class="conn-action-btn" data-action="edit" title="Edit connection" aria-label="Edit connection">✎</button>
       <button class="conn-action-btn conn-action-danger" data-action="delete" title="Delete connection" aria-label="Delete connection">✕</button>
     </div>`;
  actionsFO.innerHTML = actionsHtml;
  actionsFO.querySelector<HTMLButtonElement>('[data-action="edit"]')?.addEventListener('click', (e) => {
    e.stopPropagation();
    document.dispatchEvent(new CustomEvent('netgraph:edit-connection', { detail: { linkId: g.dataset.linkId } }));
  });
  actionsFO.querySelector<HTMLButtonElement>('[data-action="delete"]')?.addEventListener('click', (e) => {
    e.stopPropagation();
    document.dispatchEvent(new CustomEvent('netgraph:delete-connection', { detail: { linkId: g.dataset.linkId } }));
  });
  g.appendChild(actionsFO);

  // Listeners attached once; they persist across renders since we reuse the element
  g.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const linkId = g.dataset.linkId!;
    document.dispatchEvent(new CustomEvent('netgraph:connection-context-menu', {
      detail: { linkId, x: e.clientX, y: e.clientY },
    }));
  });

  // Touch - long-press substitutes for right-click
  const connLongPress = createLongPress();
  g.addEventListener('pointerdown', (e) => {
    connLongPress.start(e, () => {
      const linkId = g.dataset.linkId!;
      document.dispatchEvent(new CustomEvent('netgraph:connection-context-menu', {
        detail: { linkId, x: e.clientX, y: e.clientY },
      }));
    });
  });
  g.addEventListener('pointermove', (e) => connLongPress.move(e));
  g.addEventListener('pointerup', () => connLongPress.cancel());
  g.addEventListener('pointercancel', () => connLongPress.cancel());
  g.addEventListener('mouseenter', () => {
    document.querySelector(`.device[data-device-id="${g.dataset.from}"]`)?.classList.add('conn-highlight');
    document.querySelector(`.device[data-device-id="${g.dataset.to}"]`)?.classList.add('conn-highlight');
  });
  g.addEventListener('mouseleave', () => {
    document.querySelector(`.device[data-device-id="${g.dataset.from}"]`)?.classList.remove('conn-highlight');
    document.querySelector(`.device[data-device-id="${g.dataset.to}"]`)?.classList.remove('conn-highlight');
  });

  svg.appendChild(g);
  return g;
}

function updateConnectionGroup(
  g: SVGGElement,
  link: Link,
  source: Device,
  target: Device,
  offsets: Map<string, LinkOffset>,
  geom: (d: Device) => DeviceGeom,
  rectsByDevice: Map<string, Rect>,
  allRects: Rect[],
): void {
  // Endpoint metadata used by the mouseenter/mouseleave handlers
  g.dataset.from = link.sourceId;
  g.dataset.to = link.targetId;

  const sg = geom(source);
  const tg = geom(target);
  // Source/target sides are decided in computeEndpointOffsets - manual
  // overrides or auto-pair. Path renderer takes its overall axis from the
  // source side (so the source's exit direction is honored). When the user
  // sets mismatched sides on different axes, the path still draws as a Z on
  // the source's axis; they'll see the visual mismatch and can fix.
  const off = offsets.get(link.id);
  const sourceSide: LinkSide = off?.sourceSide ?? 'right';
  const targetSide: LinkSide = off?.targetSide ?? 'left';
  let sx = sg.center.x + (off?.sx ?? 0);
  let sy = sg.center.y + (off?.sy ?? 0);
  let tx = tg.center.x + (off?.tx ?? 0);
  let ty = tg.center.y + (off?.ty ?? 0);

  // Compute default bendAt for same-axis (Z-shape) connections, placed in the
  // gap between the cards' facing edges. Mixed-axis (L-shape) paths don't use
  // it. The face-away case (edges point apart) is left undefined here - route.ts
  // detects it and routes a U-shape, ignoring bendAt entirely.
  const sameAxis = axisOf(sourceSide) === axisOf(targetSide);
  const horizontal = axisOf(sourceSide) === 'horizontal';
  let bendAt: number | undefined;
  if (sameAxis) {
    const sourceEdgeCoord = horizontal
      ? sg.center.x + signOf(sourceSide) * sg.size.w / 2
      : sg.center.y + signOf(sourceSide) * sg.size.h / 2;
    const targetEdgeCoord = horizontal
      ? tg.center.x + signOf(targetSide) * tg.size.w / 2
      : tg.center.y + signOf(targetSide) * tg.size.h / 2;
    const facing = Math.sign(targetEdgeCoord - sourceEdgeCoord) === signOf(sourceSide);
    if (facing) {
      bendAt = (sourceEdgeCoord + targetEdgeCoord) / 2;

      // Straighten lined-up cards. If the two cards overlap on the perpendicular
      // axis - inset by MIN_PERPENDICULAR so the line lands on the flat part of
      // each edge, not a rounded corner - snap both endpoints to the shared
      // midpoint so the link draws as a single straight segment instead of a
      // small jog. The tolerated misalignment scales with card size (a tall card
      // overlaps across a wider offset than a short one). Skipped when fan-out
      // has spread this side's links along the perpendicular axis.
      const fannedOut = horizontal
        ? (off?.sy ?? 0) !== 0 || (off?.ty ?? 0) !== 0
        : (off?.sx ?? 0) !== 0 || (off?.tx ?? 0) !== 0;
      if (!fannedOut) {
        const sCenter = horizontal ? sg.center.y : sg.center.x;
        const tCenter = horizontal ? tg.center.y : tg.center.x;
        const sHalf = (horizontal ? sg.size.h : sg.size.w) / 2;
        const tHalf = (horizontal ? tg.size.h : tg.size.w) / 2;
        const lo = Math.max(sCenter - sHalf, tCenter - tHalf) + MIN_PERPENDICULAR;
        const hi = Math.min(sCenter + sHalf, tCenter + tHalf) - MIN_PERPENDICULAR;
        if (lo <= hi) {
          const mid = (lo + hi) / 2;
          if (horizontal) { sy = mid; ty = mid; } else { sx = mid; tx = mid; }
        }
      }
    }
  }

  const srcRect = rectsByDevice.get(link.sourceId)!;
  const tgtRect = rectsByDevice.get(link.targetId)!;

  const { segs, collides } = routeConnection(sx, sy, tx, ty, sourceSide, targetSide, bendAt, allRects, srcRect, tgtRect);
  const path = segmentsToPath(segs);

  const hitPath = q<SVGPathElement>(g, '.conn-hit');
  const linePath = q<SVGPathElement>(g, '.conn-line');
  hitPath.setAttribute('d', path);
  linePath.setAttribute('d', path);

  linePath.classList.toggle('conn-collision', collides);

  const wireless = link.type === 'wireless';
  linePath.classList.toggle('conn-wireless', wireless);
  linePath.classList.toggle('conn-wired', !wireless);

  // Inset the label past the part of the path hidden under each card so it
  // centers on the visible gap between the nodes, not the center-to-center path.
  // The hidden length is the card's half-extent along its exit/entry axis.
  const startInset = horizontal ? sg.size.w / 2 : sg.size.h / 2;
  const endInset = axisOf(targetSide) === 'horizontal' ? tg.size.w / 2 : tg.size.h / 2;
  const anchor = labelAnchor(segs, startInset, endInset);

  let labelEl = g.querySelector<SVGTextElement>('.conn-label');
  if (link.label) {
    if (!labelEl) {
      labelEl = document.createElementNS(SVG_NS, 'text');
      labelEl.classList.add('conn-label');
      labelEl.setAttribute('text-anchor', 'middle');
      labelEl.setAttribute('dominant-baseline', 'middle');
      g.appendChild(labelEl);
    }
    labelEl.setAttribute('x', String(anchor.x));
    labelEl.setAttribute('y', String(anchor.y));
    if (labelEl.textContent !== link.label) labelEl.textContent = link.label;
  } else if (labelEl) {
    labelEl.remove();
  }

  // Position the hover action toolbar centered on the label anchor, offset
  // upward so the buttons sit above the line (and above any label).
  const actionsFO = g.querySelector<SVGForeignObjectElement>('.conn-actions');
  if (actionsFO) {
    actionsFO.setAttribute('x', String(anchor.x - 36));
    actionsFO.setAttribute('y', String(anchor.y - 36));
  }
}
