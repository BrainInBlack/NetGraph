/**
 * Select mode — multi-selection on the canvas with copy / paste / duplicate.
 *
 *   off ──(toggle)── idle ──(canvas drag)── lassoing ──(release)── idle
 *                            ──(device tap)── toggles selection
 *                            ──(canvas right-click)── Paste / Select All / Clear
 *                            ──(selected device right-click)── Copy / Duplicate / Delete
 *
 * Mutually exclusive with connect mode — turning one on turns the other off.
 *
 * Multi-selection state lives in state.ts (`selectedDeviceIds`); this module
 * owns the mode flag, the lasso gesture, the in-memory clipboard, and the
 * group-drag math.
 */

import { getState, setState, getSelectedDeviceIds, setSelectedDeviceIds, setSelectedDeviceId } from '../state';
import { getActiveMap } from '../storage';
import { getSvgRoot, generateId, snapToGrid } from '../util';
import { screenToCanvas, fitToContent } from './zoom';
import { closePanel } from './sidebar';
import { hideAllMenus } from './context-menu';
import { exitConnectMode, isConnectModeOn } from './connect-mode';
import { buildClipboard, pasteClipboard, type Clipboard } from './clipboard';

const SVG_NS = 'http://www.w3.org/2000/svg';

type Mode = 'off' | 'idle' | 'lassoing';

interface LassoState {
  startClientX: number;
  startClientY: number;
  pointerId: number;
}

let mode: Mode = 'off';
let lasso: LassoState | null = null;
let lassoRect: SVGRectElement | null = null;
let clipboard: Clipboard | null = null;

/**
 * Per-device hit-test data captured once at lasso start. Device positions
 * (and therefore their viewport-space bounding rects) don't change during a
 * lasso — pan is suppressed in select mode, and the user is on empty canvas
 * so no device is being dragged either. Caching the centers means each
 * pointermove iterates a flat array of plain objects instead of running
 * `querySelectorAll('.device')` + `getBoundingClientRect()` per device per
 * frame. Cleared in `cancelLasso`.
 */
interface DeviceHit { id: string; cx: number; cy: number; }
let lassoHitCache: DeviceHit[] | null = null;

// Stable DOM refs, resolved once at init.
let canvasEl: HTMLElement | null = null;
let connectionsSvg: SVGSVGElement | null = null;

// Init guard — a second call would double-bind every listener and break
// state-machine assumptions (e.g. two pointerdown handlers racing to
// `setPointerCapture`). main.ts calls this once, but the guard keeps it
// honest if the boot path ever changes.
let initialized = false;

// ── Init ─────────────────────────────────────────────────────

export function initSelectMode(): void {
  if (initialized) return;
  initialized = true;
  canvasEl = document.getElementById('canvas');
  connectionsSvg = getSvgRoot('connections');

  document.getElementById('select-toggle')?.addEventListener('click', toggleMode);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && mode !== 'off') exitSelectMode();
  });

  // Lasso lifecycle. We bind on the canvas itself; the device drag handlers
  // and the connection groups stopPropagation on pointerdown, so this only
  // fires for genuine empty-canvas drags.
  canvasEl?.addEventListener('pointerdown', onCanvasPointerDown);
  canvasEl?.addEventListener('pointermove', onCanvasPointerMove);
  canvasEl?.addEventListener('pointerup', onCanvasPointerUp);
  canvasEl?.addEventListener('pointercancel', onCanvasPointerUp);

  // Mutual exclusion: connect mode turning on kicks select mode off.
  // (The reverse is enforced inline in enterSelectMode below.)
  document.addEventListener('netgraph:enter-connect-mode', () => {
    if (mode !== 'off') exitSelectMode();
  });

  // Action events from the context menus
  document.addEventListener('netgraph:copy-selection', () => copySelection());
  document.addEventListener('netgraph:duplicate-selection', () => duplicateSelection());
  document.addEventListener('netgraph:delete-selection', () => deleteSelection());
  document.addEventListener('netgraph:select-all', () => selectAll());
  document.addEventListener('netgraph:clear-selection', () => clearSelection());
  document.addEventListener('netgraph:paste', ((e: CustomEvent) => {
    pasteAtScreen(e.detail.x, e.detail.y);
  }) as EventListener);

  // After every render, prune any selected ids that no longer exist (active
  // map changed, delete elsewhere, etc.). Otherwise stale ids accumulate and
  // every "selected count" reads wrong.
  document.addEventListener('netgraph:after-render', () => {
    const ids = getSelectedDeviceIds();
    if (ids.size === 0) {
      updateIndicator();
      return;
    }
    const live = new Set(getActiveMap(getState()).devices.map(d => d.id));
    let pruned = false;
    const next = new Set<string>();
    for (const id of ids) {
      if (live.has(id)) next.add(id);
      else pruned = true;
    }
    if (pruned) setSelectedDeviceIds(next);
    updateIndicator();
  });
}

// ── External hooks ───────────────────────────────────────────

export function isSelectModeOn(): boolean {
  return mode !== 'off';
}

export function hasClipboard(): boolean {
  return clipboard !== null;
}

/**
 * Hook called by main.ts's onDeviceClick. In select mode a click toggles the
 * device in/out of the multi-selection — returns true so the single-select
 * path skips. Outside select mode this is a no-op (returns false).
 */
export function tryHandleSelectDeviceClick(deviceId: string): boolean {
  if (mode === 'off') return false;
  const ids = new Set(getSelectedDeviceIds());
  if (ids.has(deviceId)) ids.delete(deviceId);
  else ids.add(deviceId);
  setSelectedDeviceIds(ids);
  return true;
}

/**
 * True when a device-level context menu should show the multi-selection
 * actions (Copy / Duplicate / Delete Selection) instead of the per-device
 * menu. Only flips on for devices that are actually in the selection.
 */
export function isInSelection(deviceId: string): boolean {
  return mode !== 'off' && getSelectedDeviceIds().has(deviceId);
}

export function exitSelectMode(): void {
  mode = 'off';
  cancelLasso();
  setSelectedDeviceIds(new Set());
  document.getElementById('app')?.classList.remove('select-mode-on');
  document.getElementById('select-toggle')?.setAttribute('aria-pressed', 'false');
  document.getElementById('select-indicator')?.classList.add('hidden');
}

// ── Mode toggle + mutual exclusion ───────────────────────────

function toggleMode(): void {
  if (mode === 'off') enterSelectMode();
  else exitSelectMode();
}

function enterSelectMode(): void {
  // Mutually exclusive with connect mode — only one canvas-level mode at a time.
  if (isConnectModeOn()) exitConnectMode();
  // Entering select mode steals focus from the detail panel — the single-
  // select / panel interaction belongs to the default mode.
  setSelectedDeviceId(null);
  closePanel();
  hideAllMenus();

  mode = 'idle';
  document.getElementById('app')?.classList.add('select-mode-on');
  document.getElementById('select-toggle')?.setAttribute('aria-pressed', 'true');
  document.getElementById('select-indicator')?.classList.remove('hidden');
  updateIndicator();
  // Pan is suppressed in this mode (single-finger drag is the lasso), so an
  // off-screen device would otherwise be unreachable until the user exits.
  // Fitting on entry guarantees every device is visible and lassoable.
  fitToContent();
}

// ── Indicator ────────────────────────────────────────────────

function updateIndicator(): void {
  const el = document.getElementById('select-indicator-status');
  if (!el || mode === 'off') return;
  const n = getSelectedDeviceIds().size;
  if (n === 0) {
    el.textContent = 'Select mode — drag to lasso, tap a device to toggle';
  } else {
    el.textContent = `${n} selected — right-click for actions`;
  }
}

// ── Lasso ────────────────────────────────────────────────────

function onCanvasPointerDown(e: PointerEvent): void {
  if (mode !== 'idle') return;
  if (e.button !== 0 && e.pointerType === 'mouse') return;
  const target = e.target as Element;
  if (target.closest?.('.device') || target.closest?.('.conn-group') || target.closest?.('.ctx-menu')) {
    return;
  }
  // Block the pan handler in zoom.ts — see isSelectModeOn() check there.
  e.preventDefault();
  lasso = { startClientX: e.clientX, startClientY: e.clientY, pointerId: e.pointerId };
  canvasEl?.setPointerCapture(e.pointerId);
}

function onCanvasPointerMove(e: PointerEvent): void {
  if (!lasso || e.pointerId !== lasso.pointerId) return;
  // Promote to `lassoing` once the pointer has actually moved a bit, so a
  // plain click on the canvas doesn't draw a zero-sized rect for one frame.
  const moved = Math.abs(e.clientX - lasso.startClientX) > 2 || Math.abs(e.clientY - lasso.startClientY) > 2;
  if (!moved && mode === 'idle') return;
  if (mode === 'idle') {
    mode = 'lassoing';
    // One-shot device snapshot — see `lassoHitCache` doc above. Building it
    // at promotion (not at pointerdown) avoids the cost when the gesture
    // turns out to be a click rather than a drag.
    buildLassoHitCache();
  }
  drawLasso(lasso.startClientX, lasso.startClientY, e.clientX, e.clientY);
  // Live-update the selection so devices light up as the rect sweeps over
  // them, instead of only revealing the result on release. setSelectedDeviceIds
  // funnels through scheduleRender, which is rAF-coalesced — at most one
  // re-render per frame even if pointermove fires faster.
  applyLassoSelection(lasso.startClientX, lasso.startClientY, e.clientX, e.clientY);
}

function buildLassoHitCache(): void {
  const hits: DeviceHit[] = [];
  document.querySelectorAll<HTMLElement>('.device').forEach(el => {
    const id = el.dataset.deviceId;
    if (!id) return;
    const r = el.getBoundingClientRect();
    hits.push({ id, cx: r.left + r.width / 2, cy: r.top + r.height / 2 });
  });
  lassoHitCache = hits;
}

function onCanvasPointerUp(e: PointerEvent): void {
  if (!lasso || e.pointerId !== lasso.pointerId) return;
  const wasLassoing = mode === 'lassoing';
  cancelLasso();
  if (!wasLassoing) {
    // Plain canvas click in select mode → clear selection. Saves the user a
    // trip to the context menu for "I'm done; deselect everything".
    if (getSelectedDeviceIds().size > 0) setSelectedDeviceIds(new Set());
    return;
  }
  // Selection is already current — the last pointermove applied it. No
  // finalize pass needed; pointerup is just where we tear down the rect.
}

function drawLasso(x1: number, y1: number, x2: number, y2: number): void {
  if (!connectionsSvg) return;
  if (!lassoRect) {
    lassoRect = document.createElementNS(SVG_NS, 'rect') as SVGRectElement;
    lassoRect.classList.add('select-lasso');
    connectionsSvg.appendChild(lassoRect);
  }
  // SVG sits inside #canvas-transform → coords are canvas-transform-space.
  const a = screenToCanvas(x1, y1);
  const b = screenToCanvas(x2, y2);
  lassoRect.setAttribute('x', String(Math.min(a.x, b.x)));
  lassoRect.setAttribute('y', String(Math.min(a.y, b.y)));
  lassoRect.setAttribute('width', String(Math.abs(b.x - a.x)));
  lassoRect.setAttribute('height', String(Math.abs(b.y - a.y)));
}

function cancelLasso(): void {
  if (lasso && canvasEl?.hasPointerCapture(lasso.pointerId)) {
    canvasEl.releasePointerCapture(lasso.pointerId);
  }
  lasso = null;
  lassoRect?.remove();
  lassoRect = null;
  lassoHitCache = null;
  if (mode === 'lassoing') mode = 'idle';
}

/**
 * Recompute the multi-selection from the current lasso rect. Called from
 * every `pointermove` during a lasso drag, so devices light up live as the
 * rect sweeps over them. The set is computed each call (not accumulated) —
 * shrinking the rect drops devices back out, matching graphic-editor norms.
 *
 * Reads from `lassoHitCache` (snapshotted at lasso start) so there are zero
 * DOM reads per frame — just iteration over a flat array of precomputed
 * device centers in viewport coords.
 */
function applyLassoSelection(x1: number, y1: number, x2: number, y2: number): void {
  if (!lassoHitCache) return;
  const minX = Math.min(x1, x2), maxX = Math.max(x1, x2);
  const minY = Math.min(y1, y2), maxY = Math.max(y1, y2);

  const next = new Set<string>();
  for (const hit of lassoHitCache) {
    if (hit.cx >= minX && hit.cx <= maxX && hit.cy >= minY && hit.cy <= maxY) {
      next.add(hit.id);
    }
  }
  // Skip the set call when the membership didn't change — avoids triggering
  // a render every frame just to land on the same selection. (Pointermove
  // can fire many times along the same row of pixels.)
  const cur = getSelectedDeviceIds();
  if (cur.size === next.size) {
    let same = true;
    for (const id of next) {
      if (!cur.has(id)) { same = false; break; }
    }
    if (same) return;
  }
  setSelectedDeviceIds(next);
}

// ── Clipboard actions ────────────────────────────────────────

export function copySelection(): boolean {
  const ids = getSelectedDeviceIds();
  if (ids.size === 0) return false;
  const map = getActiveMap(getState());
  const clip = buildClipboard(map, ids);
  if (!clip) return false;
  clipboard = clip;
  return true;
}

export function duplicateSelection(): void {
  const ids = getSelectedDeviceIds();
  if (ids.size === 0) return;
  const s = getState();
  const map = getActiveMap(s);
  const clip = buildClipboard(map, ids);
  if (!clip) return;
  // Duplicate offset = two grid cells. Snap is applied by paste; the offset
  // sits on the grid already, so the snap is a no-op for grid-aligned sources.
  const out = pasteClipboard(clip, clip.centerX + 48, clip.centerY + 48, generateId, snapToGrid);
  map.devices.push(...out.devices);
  map.links.push(...out.links);
  map.updatedAt = new Date().toISOString();
  setState(s);
  setSelectedDeviceIds(out.newIds);
}

export function pasteAtScreen(clientX: number, clientY: number): void {
  if (!clipboard) return;
  const s = getState();
  const map = getActiveMap(s);
  // Cursor → canvas coords; centroid lands at the cursor. Note: clientX/Y is
  // captured at right-click time and replayed when the menu item fires. If
  // the user pans or zooms between right-clicking and clicking Paste, the
  // anchor will be off by the delta — but the context menu closes on outside-
  // click, so in practice the user can't pan/zoom while it's open.
  const anchor = screenToCanvas(clientX, clientY);
  const out = pasteClipboard(clipboard, anchor.x, anchor.y, generateId, snapToGrid);
  map.devices.push(...out.devices);
  map.links.push(...out.links);
  map.updatedAt = new Date().toISOString();
  setState(s);
  setSelectedDeviceIds(out.newIds);
}

export function deleteSelection(): void {
  const ids = getSelectedDeviceIds();
  if (ids.size === 0) return;
  const s = getState();
  const map = getActiveMap(s);
  // Remove devices in selection, and any link touching one of them (including
  // links that span into the non-selected set — those would otherwise dangle).
  map.devices = map.devices.filter(d => !ids.has(d.id));
  map.links = map.links.filter(l => !ids.has(l.sourceId) && !ids.has(l.targetId));
  // Also nuke hostId references on surviving devices that pointed into the
  // deleted set, so the panel/card doesn't render a "on <ghost>" subtitle.
  for (const d of map.devices) {
    if (d.hostId && ids.has(d.hostId)) d.hostId = undefined;
  }
  map.updatedAt = new Date().toISOString();
  setState(s);
  setSelectedDeviceIds(new Set());
}

function selectAll(): void {
  if (mode === 'off') return;
  const ids = new Set(getActiveMap(getState()).devices.map(d => d.id));
  setSelectedDeviceIds(ids);
}

function clearSelection(): void {
  setSelectedDeviceIds(new Set());
}

// ── Group drag ───────────────────────────────────────────────
//
// The renderer's drag handler asks this module whether a drag is a group
// drag (the dragged device is in the multi-selection); if so, it captures
// origin positions for the whole group at pointerdown and replays the
// dx/dy onto each one per frame via `applyGroupDrag`.

/** Snapshot of the group's origin positions at pointerdown. */
export interface GroupDragSnapshot {
  /** Map of deviceId → origin x. */
  origX: Map<string, number>;
  /** Map of deviceId → origin y. */
  origY: Map<string, number>;
}

/**
 * Capture origin positions for every selected device, returning null if the
 * dragged device isn't part of the multi-selection (i.e. this is a single-
 * device drag and the caller should use its usual path).
 */
export function beginGroupDrag(deviceId: string): GroupDragSnapshot | null {
  const ids = getSelectedDeviceIds();
  if (!ids.has(deviceId) || ids.size < 2) return null;
  const map = getActiveMap(getState());
  const origX = new Map<string, number>();
  const origY = new Map<string, number>();
  for (const d of map.devices) {
    if (ids.has(d.id)) {
      origX.set(d.id, d.x);
      origY.set(d.id, d.y);
    }
  }
  return { origX, origY };
}

/**
 * Replay a (dx, dy) delta (canvas units) onto every device in the group
 * snapshot, snapping each to the grid. Mutates the live device records.
 */
export function applyGroupDrag(snapshot: GroupDragSnapshot, dx: number, dy: number): void {
  const map = getActiveMap(getState());
  for (const d of map.devices) {
    const ox = snapshot.origX.get(d.id);
    const oy = snapshot.origY.get(d.id);
    if (ox === undefined || oy === undefined) continue;
    d.x = snapToGrid(ox + dx);
    d.y = snapToGrid(oy + dy);
  }
}

/**
 * Persist the post-drag positions of every device in the group. The state
 * has already been mutated in place by `applyGroupDrag` on each pointermove
 * — this call exists solely to bump `map.updatedAt` and trip the localStorage
 * write through `setState`.
 */
export function endGroupDrag(): void {
  const s = getState();
  const map = getActiveMap(s);
  map.updatedAt = new Date().toISOString();
  setState(s);
}
