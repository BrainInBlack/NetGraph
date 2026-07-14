import '../styles/main.scss';
import { getActiveMap } from './storage';
import { getState, getSelectedDeviceId, setSelectedDeviceId, setHooks, render, scheduleRender } from './state';
import { initToolbar } from './ui/toolbar';
import { initSidebar, openPanel, closePanel } from './ui/sidebar';
import { initModals } from './ui/modals';
import { initZoom, centerContent } from './ui/zoom';
import { initConnectMode, tryHandleDeviceClick } from './ui/connect-mode';
import { initSelectMode, tryHandleSelectDeviceClick } from './ui/select-mode';
import { initHelp } from './ui/help';
import { showCanvasContextMenu, showDeviceContextMenu, showConnectionContextMenu, hideAllMenus } from './ui/context-menu';
import { openIconManager } from './ui/icon-manager';
import { createLongPress } from './util';

// -- Init -----------------------------------------------------

function init(): void {
  const versionEl = document.getElementById('brand-version');
  if (versionEl) versionEl.textContent = `v${__APP_VERSION__}`;

  // Wire device interaction hooks (renderer -> UI)
  setHooks({
    onDeviceClick(deviceId: string, clientX: number, clientY: number) {
      hideAllMenus();
      // In select mode the click toggles the device's multi-selection
      // membership; in connect mode it's consumed for pin/commit. Either
      // way the single-select / panel path is skipped.
      if (tryHandleSelectDeviceClick(deviceId)) return;
      if (tryHandleDeviceClick(deviceId, clientX, clientY)) return;
      setSelectedDeviceId(deviceId);
      const map = getActiveMap(getState());
      const device = map.devices.find(d => d.id === deviceId);
      if (device) openPanel(device, map);
    },
    onDeviceContextMenu(deviceId: string, x: number, y: number) {
      hideAllMenus();
      showDeviceContextMenu(x, y, deviceId);
    },
    onAfterRender() {
      // Keep the detail panel in sync after edits/deletes
      const id = getSelectedDeviceId();
      if (id) {
        const map = getActiveMap(getState());
        const device = map.devices.find(d => d.id === id);
        if (device) openPanel(device, map);
        else closePanel();
      }
      // Notify connect-mode so it can reattach anchor handles if devices were rebuilt
      document.dispatchEvent(new CustomEvent('netgraph:after-render'));
    },
  });

  initToolbar();
  initSidebar();
  initModals();
  initZoom();
  initConnectMode();
  initSelectMode();
  initHelp();

  // Canvas click -> deselect
  const canvas = document.getElementById('canvas')!;
  canvas.addEventListener('click', (e) => {
    if (e.target === canvas || e.target === document.getElementById('canvas-transform')) {
      setSelectedDeviceId(null);
      closePanel();
      hideAllMenus();
    }
  });

  // Canvas right-click -> context menu (mouse). For touch, see long-press below.
  canvas.addEventListener('contextmenu', (e) => {
    if ((e.target as HTMLElement).closest('.device')) return;
    if ((e.target as Element).closest?.('.conn-group')) return;
    e.preventDefault();
    hideAllMenus();
    showCanvasContextMenu(e.clientX, e.clientY);
  });

  // Canvas long-press (touch) -> context menu. Skips device/connection targets
  // since those have their own long-press handlers.
  const canvasLongPress = createLongPress();
  canvas.addEventListener('pointerdown', (e) => {
    const target = e.target as HTMLElement;
    if (target.closest('.device') || target.closest('.conn-group')) return;
    canvasLongPress.start(e, () => {
      hideAllMenus();
      showCanvasContextMenu(e.clientX, e.clientY);
    });
  });
  canvas.addEventListener('pointermove', (e) => canvasLongPress.move(e));
  canvas.addEventListener('pointerup', () => canvasLongPress.cancel());
  canvas.addEventListener('pointercancel', () => canvasLongPress.cancel());

  // Connection right-click forwarded from renderer
  document.addEventListener('netgraph:connection-context-menu', ((e: CustomEvent) => {
    const { linkId, x, y } = e.detail;
    hideAllMenus();
    showConnectionContextMenu(x, y, linkId);
  }) as EventListener);

  // Manage Icons (toolbar dropdown entry)
  document.addEventListener('netgraph:manage-icons', () => openIconManager());

  // Global click -> dismiss menus
  document.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    if (!target.closest('.ctx-menu') && !target.closest('#map-selector-btn') && !target.closest('#map-dropdown')) {
      hideAllMenus();
    }
  });

  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      hideAllMenus();
      closePanel();
      setSelectedDeviceId(null);
    }
  });

  render();
  // Center the existing content in the viewport on load (without zooming)
  centerContent();

  // First paint can race ahead of CSS/font readiness - when that happens,
  // device cards measure with the wrong size and connection paths get pinned
  // to bad geometry until something forces a re-render. Re-route once fonts
  // settle and once the window finishes loading so paths recover without a
  // manual reload.
  document.fonts?.ready?.then(() => scheduleRender()).catch(() => {});
  if (document.readyState !== 'complete') {
    window.addEventListener('load', () => scheduleRender(), { once: true });
  }
}

document.addEventListener('DOMContentLoaded', init);
