import { getZoom, getPan } from './zoom';
import { snapToGrid } from '../util';
import { isSelectModeOn, isInSelection, hasClipboard } from './select-mode';
import { getSelectedDeviceIds } from '../state';

const canvasMenu = () => document.getElementById('ctx-menu')!;
const deviceMenu = () => document.getElementById('dev-ctx-menu')!;
const connMenu = () => document.getElementById('conn-ctx-menu')!;

/** Convert viewport (clientX/Y) to canvas coordinates, snapped to grid. */
function screenToCanvas(clientX: number, clientY: number): { x: number; y: number } {
  const canvas = document.getElementById('canvas')!;
  const rect = canvas.getBoundingClientRect();
  const zoom = getZoom();
  const pan = getPan();
  const x = (clientX - rect.left - pan.x) / zoom;
  const y = (clientY - rect.top - pan.y) / zoom;
  return { x: snapToGrid(x), y: snapToGrid(y) };
}

export function hideAllMenus(): void {
  canvasMenu().classList.add('hidden');
  deviceMenu().classList.add('hidden');
  connMenu().classList.add('hidden');
  const dropdown = document.getElementById('map-dropdown');
  dropdown?.classList.add('hidden');
  document.getElementById('map-selector-btn')?.classList.remove('open');
}

export function showCanvasContextMenu(x: number, y: number): void {
  const menu = canvasMenu();
  const selectMode = isSelectModeOn();
  const haveClip = hasClipboard();
  const haveSelection = getSelectedDeviceIds().size > 0;

  // Default: Add Device. In select mode, the menu becomes selection-centric;
  // Paste is also offered outside select mode whenever a clipboard exists, so
  // a copy-then-exit-mode-then-paste flow still works.
  const items: string[] = [];
  if (!selectMode) {
    items.push(`<div class="ctx-item" data-action="add-device"><span class="ctx-icon">＋</span>Add Device</div>`);
  }
  if (haveClip) {
    items.push(`<div class="ctx-item" data-action="paste"><span class="ctx-icon">⎘</span>Paste</div>`);
  }
  if (selectMode) {
    items.push(`<div class="ctx-item" data-action="select-all"><span class="ctx-icon">▦</span>Select All</div>`);
    if (haveSelection) {
      items.push(`<div class="ctx-separator"></div>`);
      items.push(`<div class="ctx-item" data-action="clear-selection"><span class="ctx-icon">∅</span>Clear Selection</div>`);
    }
  }
  menu.innerHTML = items.join('');
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;
  menu.classList.remove('hidden');

  menu.querySelector('[data-action="add-device"]')?.addEventListener('click', (e) => {
    e.stopPropagation();
    hideAllMenus();
    const pos = screenToCanvas(x, y);
    document.dispatchEvent(new CustomEvent('netgraph:add-device', { detail: pos }));
  });

  menu.querySelector('[data-action="paste"]')?.addEventListener('click', (e) => {
    e.stopPropagation();
    hideAllMenus();
    document.dispatchEvent(new CustomEvent('netgraph:paste', { detail: { x, y } }));
  });

  menu.querySelector('[data-action="select-all"]')?.addEventListener('click', (e) => {
    e.stopPropagation();
    hideAllMenus();
    document.dispatchEvent(new CustomEvent('netgraph:select-all'));
  });

  menu.querySelector('[data-action="clear-selection"]')?.addEventListener('click', (e) => {
    e.stopPropagation();
    hideAllMenus();
    document.dispatchEvent(new CustomEvent('netgraph:clear-selection'));
  });
}

export function showDeviceContextMenu(x: number, y: number, deviceId: string): void {
  const menu = deviceMenu();

  // When right-clicking a device that's part of a multi-selection, the menu
  // becomes group-centric (Copy / Duplicate / Delete Selection). Right-
  // clicking a non-selected device — even in select mode — falls back to
  // the per-device menu; that's the escape hatch for "edit this one without
  // disturbing the selection".
  if (isInSelection(deviceId)) {
    const count = getSelectedDeviceIds().size;
    menu.innerHTML = `
      <div class="ctx-item" data-action="copy-selection"><span class="ctx-icon">⎘</span>Copy <span class="ctx-count">${count}</span></div>
      <div class="ctx-item" data-action="duplicate-selection"><span class="ctx-icon">⧉</span>Duplicate <span class="ctx-count">${count}</span></div>
      <div class="ctx-separator"></div>
      <div class="ctx-item danger" data-action="delete-selection"><span class="ctx-icon">✕</span>Delete <span class="ctx-count">${count}</span></div>
    `;
    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;
    menu.classList.remove('hidden');

    menu.querySelector('[data-action="copy-selection"]')?.addEventListener('click', (e) => {
      e.stopPropagation();
      hideAllMenus();
      document.dispatchEvent(new CustomEvent('netgraph:copy-selection'));
    });
    menu.querySelector('[data-action="duplicate-selection"]')?.addEventListener('click', (e) => {
      e.stopPropagation();
      hideAllMenus();
      document.dispatchEvent(new CustomEvent('netgraph:duplicate-selection'));
    });
    menu.querySelector('[data-action="delete-selection"]')?.addEventListener('click', (e) => {
      e.stopPropagation();
      hideAllMenus();
      document.dispatchEvent(new CustomEvent('netgraph:delete-selection'));
    });
    return;
  }

  menu.innerHTML = `
    <div class="ctx-item" data-action="edit-device"><span class="ctx-icon">✎</span>Edit Device</div>
    <div class="ctx-item" data-action="add-device"><span class="ctx-icon">＋</span>Add Device</div>
    <div class="ctx-item" data-action="add-connection"><span class="ctx-icon">⇄</span>Add Connection</div>
    <div class="ctx-separator"></div>
    <div class="ctx-item danger" data-action="delete-device"><span class="ctx-icon">✕</span>Delete Device</div>
  `;
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;
  menu.classList.remove('hidden');

  menu.querySelector('[data-action="edit-device"]')?.addEventListener('click', (e) => {
    e.stopPropagation();
    hideAllMenus();
    document.dispatchEvent(new CustomEvent('netgraph:edit-device', { detail: { deviceId } }));
  });

  menu.querySelector('[data-action="add-device"]')?.addEventListener('click', (e) => {
    e.stopPropagation();
    hideAllMenus();
    // Create a new device and auto-connect it to this one
    document.dispatchEvent(new CustomEvent('netgraph:add-connected-device', { detail: { sourceId: deviceId } }));
  });

  menu.querySelector('[data-action="add-connection"]')?.addEventListener('click', (e) => {
    e.stopPropagation();
    hideAllMenus();
    document.dispatchEvent(new CustomEvent('netgraph:add-connection', { detail: { deviceId } }));
  });

  menu.querySelector('[data-action="delete-device"]')?.addEventListener('click', (e) => {
    e.stopPropagation();
    hideAllMenus();
    document.dispatchEvent(new CustomEvent('netgraph:delete-device', { detail: { deviceId } }));
  });
}

export function showConnectionContextMenu(x: number, y: number, linkId: string): void {
  const menu = connMenu();
  menu.innerHTML = `
    <div class="ctx-item" data-action="edit-connection"><span class="ctx-icon">✎</span>Edit Connection</div>
    <div class="ctx-separator"></div>
    <div class="ctx-item danger" data-action="delete-connection"><span class="ctx-icon">✕</span>Delete Connection</div>
  `;
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;
  menu.classList.remove('hidden');

  menu.querySelector('[data-action="edit-connection"]')?.addEventListener('click', (e) => {
    e.stopPropagation();
    hideAllMenus();
    document.dispatchEvent(new CustomEvent('netgraph:edit-connection', { detail: { linkId } }));
  });

  menu.querySelector('[data-action="delete-connection"]')?.addEventListener('click', (e) => {
    e.stopPropagation();
    hideAllMenus();
    document.dispatchEvent(new CustomEvent('netgraph:delete-connection', { detail: { linkId } }));
  });
}
