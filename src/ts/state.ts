import { loadState, saveState, getActiveMap, StorageQuotaError } from './storage';
import { renderAll } from './graph/renderer';
import type { AppState } from './types';

// -- Global app state -----------------------------------------

let state: AppState = loadState();
let selectedDeviceId: string | null = null;
// Multi-selection for select mode. Disjoint from `selectedDeviceId` in
// practice - entering select mode clears the single selection / panel, and
// committing a single-device click outside select mode clears the multi set.
let selectedDeviceIds: Set<string> = new Set();

// Event hooks - set by main.ts to wire UI actions without circular deps
const hooks = {
  // clientX/clientY are passed through so connect mode can derive the
  // target side from where on the card the tap landed.
  onDeviceClick: (_deviceId: string, _clientX: number, _clientY: number) => {},
  onDeviceContextMenu: (_deviceId: string, _x: number, _y: number) => {},
  onAfterRender: () => {},
};

export function setHooks(h: Partial<typeof hooks>): void {
  Object.assign(hooks, h);
}

export function getState(): AppState {
  return state;
}

export function setState(next: AppState): void {
  state = next;
  try {
    saveState(state);
  } catch (err) {
    // Storage failures are user-visible - silently dropping the save would
    // leave the in-memory state diverged from disk and the next reload would
    // discard their edits.
    if (err instanceof StorageQuotaError) alert(err.message);
    else throw err;
  }
  scheduleRender();
}

export function getSelectedDeviceId(): string | null {
  return selectedDeviceId;
}

export function setSelectedDeviceId(id: string | null): void {
  selectedDeviceId = id;
  scheduleRender();
}

export function getSelectedDeviceIds(): Set<string> {
  return selectedDeviceIds;
}

/**
 * Replace the multi-selection set. Pass an empty set (or new Set()) to clear.
 * Callers mutate state shape (devices/links), not this set, so we always
 * allocate a fresh Set here to keep the previous reference stable for renders
 * that captured it.
 */
export function setSelectedDeviceIds(ids: Iterable<string>): void {
  selectedDeviceIds = new Set(ids);
  scheduleRender();
}

let renderScheduled = false;

/**
 * Coalesce multiple render requests in the same tick into a single rAF-driven
 * render. Several callers can mutate state and request a render within one
 * event (e.g. a click that changes selection *and* state); without this each
 * would trigger a full `renderAll`. A drag's `pointermove` can also fire more
 * than once per frame - this collapses those to one render per frame.
 *
 * `render()` itself stays synchronous for the init path, which reads laid-out
 * geometry (centerContent) immediately after rendering.
 */
export function scheduleRender(): void {
  if (renderScheduled) return;
  renderScheduled = true;
  requestAnimationFrame(() => {
    renderScheduled = false;
    render();
  });
}

export function render(): void {
  const map = getActiveMap(state);
  renderAll(map, selectedDeviceId, selectedDeviceIds);
  hooks.onAfterRender();
}

// -- Device interaction callbacks (called from renderer) ------

export function onDeviceClick(deviceId: string, clientX: number, clientY: number): void {
  // Selection is owned by the hook (main.ts) so it can route the click -
  // e.g. connect mode treats a click as a command, not a selection. The hook
  // is responsible for calling setSelectedDeviceId if the click is a normal
  // "open panel" interaction.
  hooks.onDeviceClick(deviceId, clientX, clientY);
}

export function onDeviceContextMenu(deviceId: string, x: number, y: number): void {
  // Right-click only opens the menu - it does not select the device
  hooks.onDeviceContextMenu(deviceId, x, y);
}

export function onDeviceDragEnd(deviceId: string, x: number, y: number): void {
  const map = getActiveMap(state);
  const device = map.devices.find(d => d.id === deviceId);
  if (!device) return;
  device.x = x;
  device.y = y;
  map.updatedAt = new Date().toISOString();
  setState(state);
}
