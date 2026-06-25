/**
 * Connect mode — three sub-modes for wiring devices, tap-tap style.
 *
 * Sub-modes (sticky in-session, default Hub, reset on reload):
 *
 *   Hub      — anchor stays on the source. Tap A, tap B, tap C → A↔B, A↔C, …
 *              (one-to-many: a switch fanning out to endpoints)
 *   Single   — no persistent anchor. Tap A, tap B → A↔B → state resets to idle.
 *              Next tap starts a fresh connection.
 *   Advanced — same gestures as Single, but the connection editor opens
 *              immediately after each commit.
 *
 * Mechanics shared across all modes:
 *
 *   off ──(toggle)── idle ──(tap device)── anchored ──(tap handle)── side-picked
 *                            │   ▲                    │   ▲                │
 *                            │   │(unpin)             │   │(unpick)        │
 *                            └───┘                    └───┘                │
 *                                                      │                   │
 *                            (tap target — auto sides) │                   │ (tap target —
 *                                                      │                   │  explicit side)
 *                                                      ▼                   ▼
 *                                                   commit → branch on sub-mode
 *
 *   - Tap on empty canvas drops back one step (side-picked → anchored,
 *     anchored → idle).
 *   - Tap on the anchor cancels (anchored → idle), in any sub-mode.
 *   - Esc and the toolbar button exit the mode entirely.
 *
 * No dragging anywhere — same gesture across mouse and touch.
 */

import { getState, setState } from '../state';
import { getActiveMap } from '../storage';
import { generateId, getSvgRoot, linkExists } from '../util';
import { screenToCanvas } from './zoom';
import type { Link, LinkSide } from '../types';

const SVG_NS = 'http://www.w3.org/2000/svg';

type SubMode = 'hub' | 'single' | 'advanced';

function isSubMode(s: string | undefined): s is SubMode {
  return s === 'hub' || s === 'single' || s === 'advanced';
}

type ConnectState =
  | { mode: 'off' }
  | { mode: 'idle' }
  | { mode: 'anchored'; anchorId: string }
  | { mode: 'side-picked'; anchorId: string; sourceSide: LinkSide };

let state: ConnectState = { mode: 'off' };
let subMode: SubMode = 'hub';

// Ghost preview line — shown while an anchor is set, follows the cursor and
// snaps to the hovered device's center when one is under the pointer.
let ghostLine: SVGLineElement | null = null;
let lastPointer: { x: number; y: number } | null = null;

// Stable DOM refs, resolved once at init. The canvas and the connections SVG
// live in index.html for the app's lifetime, so there's no need to re-resolve.
let canvasEl: HTMLElement | null = null;
let connectionsSvg: SVGSVGElement | null = null;

/**
 * Re-sync every piece of connect-mode visual state to match `state`: the anchor
 * outline + handles, the indicator status line, and the ghost preview. Every
 * state transition calls this one function so none of the three can drift out
 * of sync. All three are cheap no-ops when there's nothing to show.
 */
function applyState(): void {
  refreshAnchorVisuals();
  updateIndicator();
  updateGhost();
}

export function initConnectMode(): void {
  canvasEl = document.getElementById('canvas');
  connectionsSvg = getSvgRoot('connections');

  document.getElementById('connect-toggle')?.addEventListener('click', toggleMode);

  // Sub-mode segmented control inside the indicator pill
  document.querySelectorAll<HTMLButtonElement>('.connect-submode').forEach(btn => {
    btn.addEventListener('click', () => {
      const next = btn.dataset.submode;
      if (!isSubMode(next) || next === subMode) return;
      setSubMode(next);
    });
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && state.mode !== 'off') exitMode();
  });

  // Renderer fires this after every render so we can re-mount the anchor
  // handles when device DOM is rebuilt. Also defensive: if the anchored
  // device was deleted (right-click → Delete, map switch, undo, …), drop
  // back to idle so the next tap doesn't commit a link with a dangling id.
  document.addEventListener('netgraph:after-render', () => {
    if (state.mode === 'anchored' || state.mode === 'side-picked') {
      const anchorId = state.anchorId;
      const map = getActiveMap(getState());
      if (!map.devices.some(d => d.id === anchorId)) {
        state = { mode: 'idle' };
      }
    }
    applyState();
  });

  // Track cursor while in connect mode so the ghost line can follow it.
  // Note: on touch, pointermove only fires while a finger is down, so the
  // ghost is effectively mouse-only between taps. That's by design — there's
  // no hover state on touch to chase.
  canvasEl?.addEventListener('pointermove', (e) => {
    if (state.mode === 'off') return;
    lastPointer = { x: e.clientX, y: e.clientY };
    updateGhost();
  });

  // Empty-canvas tap → step back: side-picked → anchored, anchored → idle.
  // Device clicks `stopPropagation`, so this only fires for genuine empty hits.
  canvasEl?.addEventListener('click', (e) => {
    if (state.mode === 'off') return;
    const target = e.target as HTMLElement;
    if (target.closest('.device') || target.closest('.connect-handle')) return;
    if (state.mode === 'side-picked') {
      state = { mode: 'anchored', anchorId: state.anchorId };
      applyState();
    } else if (state.mode === 'anchored') {
      state = { mode: 'idle' };
      applyState();
    }
  });
}

/**
 * Hook called by main.ts when a device is clicked. Returns true if the click
 * was consumed (so the caller skips selection/panel). `clientX/Y` is needed to
 * derive `targetSide` from where on the target card the tap landed.
 */
export function tryHandleDeviceClick(deviceId: string, clientX: number, clientY: number): boolean {
  if (state.mode === 'off') return false;

  if (state.mode === 'idle') {
    state = { mode: 'anchored', anchorId: deviceId };
    applyState();
    return true;
  }

  const anchorId = state.anchorId;
  if (deviceId === anchorId) {
    // Tapping the anchor cancels — back to idle (mode still on)
    state = { mode: 'idle' };
    applyState();
    return true;
  }

  // Reject duplicate connections — if A↔B already exists (in either direction),
  // the click is consumed but no link is created. The ghost line already
  // signals this in amber so the rejection isn't surprising.
  if (linkExists(getActiveMap(getState()).links, anchorId, deviceId)) {
    return true;
  }

  // Tap on a *different* device — commit a connection. Source side is the
  // picked handle (if any), target side is the edge of the target closest to
  // the tap point. Auto for unset sides.
  const targetEl = document.querySelector<HTMLElement>(`.device[data-device-id="${deviceId}"]`);
  const targetSide = targetEl ? closestSideToClient(targetEl, clientX, clientY) : undefined;
  const sourceSide = state.mode === 'side-picked' ? state.sourceSide : undefined;
  const newLinkId = createConnection(anchorId, deviceId, sourceSide, targetSide);

  // Branch on sub-mode for what happens next
  if (subMode === 'hub') {
    // Anchor stays — ready for the next target. Drop side-picked back to anchored.
    state = { mode: 'anchored', anchorId };
  } else {
    // Single + Advanced: no persistent anchor. Each connection is a fresh pair.
    state = { mode: 'idle' };
    if (subMode === 'advanced') {
      // Open the editor for the just-created link
      document.dispatchEvent(new CustomEvent('netgraph:edit-connection', { detail: { linkId: newLinkId } }));
    }
  }
  applyState();
  return true;
}

function toggleMode(): void {
  const turningOn = state.mode === 'off';
  if (turningOn) {
    // Mutually exclusive with select mode — only one canvas-level mode at a time.
    document.dispatchEvent(new CustomEvent('netgraph:enter-connect-mode'));
  }
  state = turningOn ? { mode: 'idle' } : { mode: 'off' };
  const on = state.mode !== 'off';
  document.getElementById('app')?.classList.toggle('connect-mode-on', on);
  document.getElementById('connect-toggle')?.setAttribute('aria-pressed', on ? 'true' : 'false');
  document.getElementById('connect-indicator')?.classList.toggle('hidden', !on);
  if (!on) lastPointer = null;
  applyState();
}

function exitMode(): void {
  state = { mode: 'off' };
  lastPointer = null;
  document.getElementById('app')?.classList.remove('connect-mode-on');
  document.getElementById('connect-toggle')?.setAttribute('aria-pressed', 'false');
  document.getElementById('connect-indicator')?.classList.add('hidden');
  applyState();
}

/** True when connect mode is currently on (in any sub-state). */
export function isConnectModeOn(): boolean {
  return state.mode !== 'off';
}

/** External exit hook — used by select-mode to enforce mutual exclusion. */
export function exitConnectMode(): void {
  if (state.mode !== 'off') exitMode();
}

function setSubMode(next: SubMode): void {
  subMode = next;
  document.querySelectorAll<HTMLButtonElement>('.connect-submode').forEach(btn => {
    btn.setAttribute('aria-pressed', btn.dataset.submode === next ? 'true' : 'false');
  });
  applyState();
}

/**
 * Refresh the indicator status line. Copy varies by `state` + `subMode` so the
 * user always knows what their next tap will do.
 */
function updateIndicator(): void {
  const el = document.getElementById('connect-indicator-status');
  if (!el) return;
  el.textContent = statusText();
}

function statusText(): string {
  if (state.mode === 'idle' || state.mode === 'off') {
    return 'Connection mode — tap a device to start';
  }
  const name = anchorName(state.anchorId);
  if (state.mode === 'side-picked') {
    return `Source side picked on ${name} — tap a target`;
  }
  switch (subMode) {
    case 'hub':
      return `Tap targets to connect to ${name}. Tap ${name} to cancel.`;
    case 'single':
      return `Tap a target to connect from ${name}. Tap ${name} to cancel.`;
    case 'advanced':
      return `Tap a target. Editor opens after the connection is made.`;
  }
}

function anchorName(id: string): string {
  const map = getActiveMap(getState());
  const d = map.devices.find(x => x.id === id);
  return d?.name || 'this device';
}

/**
 * Re-mount the anchor outline + handles on the right device. Called whenever
 * the state changes (toggle, anchor pin, handle pick) and after every render.
 */
function refreshAnchorVisuals(): void {
  // Clear existing anchor markup
  document.querySelectorAll<HTMLElement>('.device.connect-anchor').forEach(el => {
    el.classList.remove('connect-anchor');
    el.querySelectorAll('.connect-handle').forEach(h => h.remove());
  });
  if (state.mode !== 'anchored' && state.mode !== 'side-picked') return;

  const anchorEl = document.querySelector<HTMLElement>(`.device[data-device-id="${state.anchorId}"]`);
  if (!anchorEl) return;
  anchorEl.classList.add('connect-anchor');

  const pickedSide = state.mode === 'side-picked' ? state.sourceSide : null;
  for (const side of ['top', 'bottom', 'left', 'right'] as const) {
    const h = document.createElement('div');
    h.className = `connect-handle connect-handle-${side}`;
    if (side === pickedSide) h.classList.add('picked');
    h.dataset.side = side;
    h.addEventListener('click', onHandleClick);
    anchorEl.appendChild(h);
  }
}

function onHandleClick(e: MouseEvent): void {
  if (state.mode !== 'anchored' && state.mode !== 'side-picked') return;
  e.stopPropagation();
  e.preventDefault();
  const side = (e.currentTarget as HTMLElement).dataset.side as LinkSide;
  if (state.mode === 'side-picked' && state.sourceSide === side) {
    // Tap the picked handle again — unpick it
    state = { mode: 'anchored', anchorId: state.anchorId };
  } else {
    state = { mode: 'side-picked', anchorId: state.anchorId, sourceSide: side };
  }
  applyState();
}

/** Which edge of `deviceEl` is closest to (clientX, clientY)? */
function closestSideToClient(deviceEl: HTMLElement, clientX: number, clientY: number): LinkSide {
  const r = deviceEl.getBoundingClientRect();
  const dTop    = clientY - r.top;
  const dBottom = r.bottom - clientY;
  const dLeft   = clientX - r.left;
  const dRight  = r.right - clientX;
  const min = Math.min(dTop, dBottom, dLeft, dRight);
  if (min === dTop)    return 'top';
  if (min === dBottom) return 'bottom';
  if (min === dLeft)   return 'left';
  return 'right';
}

// ── Ghost preview line ───────────────────────────────────────
//
// Drawn inside the #connections SVG (same coord system as device positions,
// since both live under #canvas-transform). Source = anchor center, target =
// cursor position in canvas coords, or the hovered device's center if any.
// Pure visual feedback — it doesn't affect the committed connection.

function updateGhost(): void {
  if ((state.mode !== 'anchored' && state.mode !== 'side-picked') || lastPointer === null) {
    if (ghostLine) {
      ghostLine.remove();
      ghostLine = null;
    }
    return;
  }

  const anchorId = state.anchorId;
  const anchorEl = document.querySelector<HTMLElement>(`.device[data-device-id="${anchorId}"]`);
  if (!anchorEl) return;

  // Anchor center in canvas-transform coords. style.left already holds the
  // top-center x (devices use translateX(-50%)); add half-height for the y.
  const ax = parseInt(anchorEl.style.left) || 0;
  const ay = (parseInt(anchorEl.style.top) || 0) + anchorEl.offsetHeight / 2;

  // Cursor → canvas-transform coords
  const cursor = screenToCanvas(lastPointer.x, lastPointer.y);
  let tx = cursor.x;
  let ty = cursor.y;

  // Snap endpoint to a hovered device's center (anything other than the anchor itself)
  const hoverEl = document.elementFromPoint(lastPointer.x, lastPointer.y)?.closest<HTMLElement>('.device');
  let duplicate = false;
  if (hoverEl && hoverEl.dataset.deviceId && hoverEl.dataset.deviceId !== anchorId) {
    tx = parseInt(hoverEl.style.left) || 0;
    ty = (parseInt(hoverEl.style.top) || 0) + hoverEl.offsetHeight / 2;
    duplicate = linkExists(getActiveMap(getState()).links, anchorId, hoverEl.dataset.deviceId);
  }

  if (!ghostLine) {
    if (!connectionsSvg) return;
    ghostLine = document.createElementNS(SVG_NS, 'line') as SVGLineElement;
    ghostLine.classList.add('conn-ghost');
    connectionsSvg.appendChild(ghostLine);
  }
  ghostLine.setAttribute('x1', String(ax));
  ghostLine.setAttribute('y1', String(ay));
  ghostLine.setAttribute('x2', String(tx));
  ghostLine.setAttribute('y2', String(ty));
  ghostLine.classList.toggle('conn-ghost-duplicate', duplicate);
}

/**
 * Push a new wired link onto the active map. The caller guarantees `sourceId
 * !== targetId` (the click handler short-circuits self-taps), so this function
 * never has to defend against it. Returns the new link's id.
 */
function createConnection(
  sourceId: string,
  targetId: string,
  sourceSide: LinkSide | undefined,
  targetSide: LinkSide | undefined,
): string {
  const s = getState();
  const map = getActiveMap(s);
  const link: Link = {
    id: generateId(),
    sourceId,
    targetId,
    type: 'wired',
    sourceSide,
    targetSide,
  };
  map.links.push(link);
  map.updatedAt = new Date().toISOString();
  setState(s);
  return link.id;
}
