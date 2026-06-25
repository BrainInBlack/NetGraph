import { isSelectModeOn } from './select-mode';

const ZOOM_STEPS = [25, 33, 50, 67, 75, 80, 90, 100, 110, 125, 150, 175, 200];
const MIN_ZOOM = 10;
const MAX_ZOOM = 400;
// Grid sizes at 100% zoom — must match $grid-sm / $grid-lg in _variables.scss
const GRID_SM = 24;
const GRID_LG = 120;

let currentZoom = 100;
let panX = 0;
let panY = 0;

function applyTransform(): void {
  const levelValueEl = document.querySelector<HTMLElement>('#zoom-level .zoom-level-value');
  const transform = document.getElementById('canvas-transform');
  const canvas = document.getElementById('canvas');
  if (!transform || !canvas) return;

  if (levelValueEl) levelValueEl.textContent = `${Math.round(currentZoom)}%`;
  const scale = currentZoom / 100;
  transform.style.transform = `translate(${panX}px, ${panY}px) scale(${scale})`;
  transform.style.transformOrigin = '0 0';
  canvas.style.backgroundPosition = `${panX}px ${panY}px`;
  const sm = GRID_SM * scale;
  const lg = GRID_LG * scale;
  canvas.style.backgroundSize = `${lg}px ${lg}px, ${lg}px ${lg}px, ${sm}px ${sm}px, ${sm}px ${sm}px`;
}

export function initZoom(): void {
  const canvas = document.getElementById('canvas')!;

  /** Zoom anchored on a viewport point (defaults to canvas center). */
  function zoomTo(newZoom: number, anchorX?: number, anchorY?: number): void {
    const cx = anchorX ?? canvas.clientWidth / 2;
    const cy = anchorY ?? canvas.clientHeight / 2;
    const oldZoom = currentZoom;
    currentZoom = newZoom;
    const scaleChange = currentZoom / oldZoom;
    panX = cx - scaleChange * (cx - panX);
    panY = cy - scaleChange * (cy - panY);
    applyTransform();
  }

  document.getElementById('zoom-in')!.addEventListener('click', (e) => {
    e.stopPropagation();
    const next = ZOOM_STEPS.find(s => s > currentZoom);
    if (next) zoomTo(next);
  });

  document.getElementById('zoom-out')!.addEventListener('click', (e) => {
    e.stopPropagation();
    const next = [...ZOOM_STEPS].reverse().find(s => s < currentZoom);
    if (next) zoomTo(next);
  });

  // Zoom-level button: click anywhere on the pill fits content to the viewport.
  // Hover swap (% → "Fit") is pure CSS — see _zoom-bar.scss.
  document.getElementById('zoom-level')!.addEventListener('click', (e) => {
    e.stopPropagation();
    fitToContent();
  });

  // ── Canvas panning + pinch-zoom via pointer events ────────
  //
  // We use pointer events instead of mouse events so the same code handles
  // mouse, trackpad, and touch. Two-finger gestures on touch are detected by
  // tracking how many pointers are currently down on the canvas.
  let panning = false;
  let panStartX = 0;
  let panStartY = 0;
  let panOriginX = 0;
  let panOriginY = 0;
  const activePointers = new Map<number, { x: number; y: number }>();
  let pinchStartDistance = 0;
  let pinchStartZoom = 100;

  function distance(a: { x: number; y: number }, b: { x: number; y: number }): number {
    const dx = a.x - b.x, dy = a.y - b.y;
    return Math.hypot(dx, dy);
  }
  function midpoint(a: { x: number; y: number }, b: { x: number; y: number }): { x: number; y: number } {
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  }

  canvas.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return; // only primary mouse button
    const target = e.target as Element;
    // Skip targets that have their own pointer handlers (devices, connection
    // lines, context menus) — without this, a tap on a connection would also
    // prime a pan, doing extra work for nothing.
    if (target.closest?.('.device')) return;
    if (target.closest?.('.conn-group')) return;
    if (target.closest?.('.ctx-menu')) return;

    activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (activePointers.size === 1) {
      // First finger / mouse down — prime a pan, but don't classify as one yet.
      // (We always record the start point, even in select mode where pan is
      // suppressed — the *move* handler reads `isSelectModeOn()` to decide
      // whether to actually pan. Recording it unconditionally keeps panStartX
      // fresh so an out-of-mode pan can't jump from a stale anchor.)
      panning = false;
      panStartX = e.clientX;
      panStartY = e.clientY;
      panOriginX = panX;
      panOriginY = panY;
    } else if (activePointers.size === 2) {
      // Second finger — switch to pinch-zoom. Abandon any in-flight pan.
      panning = false;
      canvas.classList.remove('panning');
      const [a, b] = [...activePointers.values()];
      pinchStartDistance = distance(a, b);
      pinchStartZoom = currentZoom;
    }
  });

  canvas.addEventListener('pointermove', (e) => {
    if (!activePointers.has(e.pointerId)) return;
    activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (activePointers.size >= 2) {
      // Pinch — adjust zoom anchored on the midpoint between the two pointers
      const pts = [...activePointers.values()];
      const dist = distance(pts[0], pts[1]);
      if (pinchStartDistance > 0) {
        const target = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM,
          Math.round(pinchStartZoom * (dist / pinchStartDistance))));
        const rect = canvas.getBoundingClientRect();
        const mid = midpoint(pts[0], pts[1]);
        zoomTo(target, mid.x - rect.left, mid.y - rect.top);
      }
      return;
    }

    // Single-pointer drag belongs to the lasso when select mode is on. Two-
    // finger pinch above is unaffected so touch users can still zoom in mode.
    if (isSelectModeOn()) return;

    // Single-pointer pan
    const dx = e.clientX - panStartX;
    const dy = e.clientY - panStartY;
    if (!panning && (Math.abs(dx) > 3 || Math.abs(dy) > 3)) {
      panning = true;
      canvas.classList.add('panning');
      // Capture the pointer so a fast swipe off the canvas keeps panning
      canvas.setPointerCapture(e.pointerId);
    }
    if (panning) {
      panX = panOriginX + dx;
      panY = panOriginY + dy;
      applyTransform();
    }
  });

  function endPointer(e: PointerEvent): void {
    if (!activePointers.has(e.pointerId)) return;
    activePointers.delete(e.pointerId);
    if (activePointers.size < 2) pinchStartDistance = 0;
    if (activePointers.size === 0) canvas.classList.remove('panning');
  }
  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);

  // Suppress the synthesized click that follows a successful pan
  canvas.addEventListener('click', (e) => {
    if (panning) {
      e.stopImmediatePropagation();
      panning = false;
    }
  }, true);

  // Trackpads fire wheel faster than the display can paint; coalesce multiple
  // events per frame and apply the transform once on the next rAF.
  let wheelRafQueued = false;
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();

    const rect = canvas.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    const oldZoom = currentZoom;

    const factor = 1 - e.deltaY * 0.002;
    currentZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, currentZoom * factor));
    currentZoom = Math.round(currentZoom);
    if (currentZoom === oldZoom) {
      currentZoom = e.deltaY < 0 ? oldZoom + 1 : oldZoom - 1;
      currentZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, currentZoom));
    }

    const scaleChange = currentZoom / oldZoom;
    panX = cx - scaleChange * (cx - panX);
    panY = cy - scaleChange * (cy - panY);

    if (!wheelRafQueued) {
      wheelRafQueued = true;
      requestAnimationFrame(() => {
        wheelRafQueued = false;
        applyTransform();
      });
    }
  }, { passive: false });
}

export function getZoom(): number {
  return currentZoom / 100;
}

export function getPan(): { x: number; y: number } {
  return { x: panX, y: panY };
}

/**
 * Convert a viewport-space point (clientX/Y) into canvas-transform-space
 * coordinates — the same coord system that holds device positions and the
 * connections SVG. Returns (0, 0) if the canvas element isn't mounted.
 */
export function screenToCanvas(clientX: number, clientY: number): { x: number; y: number } {
  const canvas = document.getElementById('canvas');
  if (!canvas) return { x: 0, y: 0 };
  const rect = canvas.getBoundingClientRect();
  const scale = currentZoom / 100;
  return {
    x: (clientX - rect.left - panX) / scale,
    y: (clientY - rect.top - panY) / scale,
  };
}

/** Pan so the existing content is centered in the viewport, without changing zoom. */
export function centerContent(): void {
  const canvas = document.getElementById('canvas');
  const bounds = getContentBounds();
  if (!canvas || !bounds) {
    panX = 0;
    panY = 0;
    applyTransform();
    return;
  }
  const scale = currentZoom / 100;
  const contentW = bounds.maxX - bounds.minX;
  const contentH = bounds.maxY - bounds.minY;
  panX = (canvas.clientWidth - contentW * scale) / 2 - bounds.minX * scale;
  panY = (canvas.clientHeight - contentH * scale) / 2 - bounds.minY * scale;
  applyTransform();
}

/** Bounding box of all visible device cards in canvas coords, or null if empty. */
function getContentBounds(): { minX: number; minY: number; maxX: number; maxY: number } | null {
  const devices = document.querySelectorAll<HTMLElement>('#device-layer .device');
  if (devices.length === 0) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const el of devices) {
    // device.x is the top-center of the card (transform: translateX(-50%))
    const cx = parseInt(el.style.left) || 0;
    const y = parseInt(el.style.top) || 0;
    const w = el.offsetWidth || 200;
    const h = el.offsetHeight || 100;
    minX = Math.min(minX, cx - w / 2);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, cx + w / 2);
    maxY = Math.max(maxY, y + h);
  }
  return { minX, minY, maxX, maxY };
}

/**
 * Fit all devices into the viewport with padding, then apply the transform
 * in one go. Exposed so external callers (the zoom-level button, select
 * mode entry — where pan is disabled and a wide overview is more useful
 * than the user's prior tight zoom) can trigger a fit without re-implementing
 * the math or remembering to call `applyTransform` after.
 *
 * No-op-ish on empty maps: zoom resets to 100% and pan to (0, 0) so the
 * canvas isn't left at whatever weird state a previous fit produced.
 */
export function fitToContent(): void {
  const bounds = getContentBounds();
  if (!bounds) {
    currentZoom = 100;
    panX = 0;
    panY = 0;
    applyTransform();
    return;
  }

  const canvas = document.getElementById('canvas')!;
  const contentW = bounds.maxX - bounds.minX;
  const contentH = bounds.maxY - bounds.minY;
  if (contentW <= 0 || contentH <= 0) {
    currentZoom = 100;
    panX = 0;
    panY = 0;
    applyTransform();
    return;
  }

  const padding = 80;
  const viewW = canvas.clientWidth - padding * 2;
  const viewH = canvas.clientHeight - padding * 2;

  const scaleX = viewW / contentW;
  const scaleY = viewH / contentH;
  const fitScale = Math.min(scaleX, scaleY, 2);
  currentZoom = Math.max(MIN_ZOOM, Math.round(fitScale * 100));
  const scale = currentZoom / 100;

  panX = (canvas.clientWidth - contentW * scale) / 2 - bounds.minX * scale;
  panY = (canvas.clientHeight - contentH * scale) / 2 - bounds.minY * scale;
  applyTransform();
}
